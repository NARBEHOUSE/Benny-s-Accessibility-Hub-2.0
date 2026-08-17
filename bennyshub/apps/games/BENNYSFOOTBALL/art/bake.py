"""Bake a WAM model into Phaser-ready directional sprite sheets.

WAM's rasterizer writes opaque RGB with a solid background and no anti-aliasing,
so alpha has to be recovered here: render on a chroma background at 4x, key it
exactly (no AA means no fringe), add the black outline the hub's art style uses,
then downsample with premultiplied alpha.

Team colour is a runtime tint, so each frame is split into two layers. The
jersey layer is found by rendering twice with different jersey palette entries
and differencing -- that captures occlusion exactly, which a material-id pass
would not.

Frames where the carrier has the ball are rendered from a composition of the
player with the football grafted into their hand, so it is skinned to the arm
and occludes correctly. See DEFAULT_CLIPS.

  python3 bake.py gridiron.wam --contact           # choose a camera pitch
  python3 bake.py gridiron.wam --pitch 30 -o ../images/players
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

import wam.animation as wanim
import wam.mesh as wmesh
import wam.parser as wparser
import wam.render as wrender
import wam.skeleton as wskel

# Chroma for the background and for the jersey-difference probe. Neither can
# occur in the model: the palette has no pure primaries.
BG = (1.0, 0.0, 1.0)
JERSEY_PROBE = (0.0, 1.0, 0.0)

# Flatter and brighter than the inspection default (0.34, 0.60, 0.16): a sprite
# read at 26px wants form without deep shadow, and the jersey layer is about to
# be multiplied by a saturated team colour.
LIGHT = (0.55, 0.46, 0.14)


# Which rows the atlas carries, and which of them show the ball in hand.
# `ball` is a frame range rather than a flag because the transfer happens
# mid-clip: a throw starts with the ball and ends without it, a catch the other
# way round. Baking the handover into the frames is more accurate than anything
# the game could do by toggling a separate sprite.
#
# Only `run` needs both an empty-handed and a carrying row set. Every call site
# of tackleShake passes the ball carrier, only the quarterback throws, and only
# a receiver catches — so those three clips are carrier-only, which is what
# keeps this to 36 rows instead of 56.
DEFAULT_CLIPS = [
    {"name": "run",       "anim": "run",    "frames": 8},
    {"name": "run_carry", "anim": "run",    "frames": 8, "ball": "all"},
    {"name": "throw",     "anim": "throw",  "frames": 8, "ball": "0-4"},
    {"name": "catch",     "anim": "catch",  "frames": 6, "ball": "4-5"},
    {"name": "tackle",    "anim": "tackle", "frames": 6, "ball": "all",
     "ground": True},
]


class Source:
    """A posable model: the plain player, or the player composed with a ball."""

    def __init__(self, model, bones, bone_order, mesh):
        self.model, self.bones, self.bone_order, self.mesh = \
            model, bones, bone_order, mesh
        self.V, self.T, self.M = mesh.arrays()


def order_bones(bones):
    """Parents before children, which is what global_transforms requires.

    A composition's bone dict is not guaranteed to be in that order, and
    relying on insertion order would fail silently by skinning to a stale
    parent transform.
    """
    out, seen = [], set()

    def visit(b):
        if b.name in seen:
            return
        if b.parent is not None:
            visit(b.parent)
        seen.add(b.name)
        out.append(b)
    for b in bones.values():
        visit(b)
    return out


def load(path):
    model = wparser.parse_file(path)
    bones, bone_order = wskel.solve(model)
    mesh = wmesh.build(model, bones)
    return Source(model, bones, bone_order, mesh)


def load_composition(wamset_path, name):
    """The player with the ball grafted in, from the .wamset."""
    import wam.modelset as wmodelset
    _, models, _ = wmodelset.compile_set(wamset_path, quiet=True)
    if name not in models:
        raise SystemExit("no composition %r in %s (have %s)"
                         % (name, wamset_path, sorted(models)))
    c = models[name]
    return Source(c.model, c.bones, order_bones(c.bones), c.mesh)


def parse_ball_range(spec, frames):
    """'all' | '0-4' | None -> a set of frame indices that show the ball."""
    if spec in (None, "", "none"):
        return set()
    if spec == "all":
        return set(range(frames))
    lo, _, hi = spec.partition("-")
    return set(range(int(lo), int(hi if hi else lo) + 1))


def posed_frames(src, anim_name, frames):
    """Vertex arrays for one animation, one per sampled frame."""
    if anim_name in (None, "rest"):
        return [src.V]
    anim = next((a for a in src.model.anims if a["name"] == anim_name), None)
    if anim is None:
        raise SystemExit("no such anim: %s (have %s)"
                         % (anim_name, [a["name"] for a in src.model.anims]))
    out = []
    for i in range(frames):
        # Phase 1.0 of a loop is phase 0, so a looping clip stops short of it.
        ph = i / frames if anim["loop"] else i / max(frames - 1, 1)
        rots = wanim.anim_rotations_at(src.model, src.bones, anim, ph)
        out.append(wanim.skin_verts(src.mesh, src.bones, src.bone_order, rots))
    return out


def is_loop(src, anim_name):
    a = next((x for x in src.model.anims if x["name"] == anim_name), None)
    return bool(a and a.get("loop"))


def keep_mask(rgb):
    """True where the model is, False on background.

    render_view lays the background down as `bg * gradient` with the gradient
    running 1.03..0.93 down the frame, so background pixels are NOT equal to
    BG and an exact match keys only the middle band. The gradient is
    multiplicative, though, so magenta's zero green channel stays zero -- and
    no material in the palette gets near it (the darkest, sock #2b3038, lands
    at green 0.10 even under pure ambient).
    """
    return ~((rgb[..., 1] < 0.05) & (rgb[..., 0] > 0.4) & (rgb[..., 2] > 0.4))


def material_colors(mesh, jersey_probe=False):
    colors = [list(rgb) for _, rgb in mesh.materials]
    if jersey_probe:
        for i, (name, _) in enumerate(mesh.materials):
            if name == "jersey":
                colors[i] = list(JERSEY_PROBE)
    return colors


def render_pair(V, T, M, mesh, yaw, pitch, px, center, dist):
    """Render one frame twice and return (rgb, jersey_mask)."""
    common = dict(yaw_deg=yaw, pitch_deg=pitch, width=px, height=px,
                  center=center, dist=dist, bg=BG, ambient=LIGHT)
    plain = wrender.render_view(V, T, M, material_colors(mesh), **common)
    probe = wrender.render_view(V, T, M, material_colors(mesh, True), **common)
    jersey = np.abs(plain - probe).max(axis=2) > 0.02
    return plain, jersey


def glow_rgba(keep, radius=22, falloff=20, blur=16):
    """A white aura traced from the figure's own outline, for the game to tint.

    Radii are in SUPERSAMPLED pixels (4x), so 22 is about 5-6px of halo on the
    finished 64px cell — roughly a tenth of the figure's height, which is what
    made it read at game size. A third of that vanished on turf.

    Baked rather than done with Phaser's preFX so it works on the Canvas
    renderer too — this is the cue that tells the player who is open, and it
    must not quietly vanish on a machine that fails to get WebGL.
    """
    a = Image.fromarray((keep * 255).astype(np.uint8), "L")
    inner = a.filter(ImageFilter.MaxFilter(2 * radius + 1))
    outer = inner.filter(ImageFilter.MaxFilter(2 * falloff + 1)).filter(
        ImageFilter.GaussianBlur(blur))
    ai = np.asarray(inner, dtype=np.float64) / 255.0
    ao = np.asarray(outer, dtype=np.float64) / 255.0
    alpha = np.maximum(ai * 0.95, ao * 0.55)
    # White, so a Phaser tint yields the coverage colour exactly.
    return np.ones(keep.shape + (3,), dtype=np.float64), alpha


def to_rgba(rgb, keep, outline_px=0, silhouette=None,
            outline_rgb=(0.06, 0.06, 0.08)):
    """Key the chroma background out and optionally ring the shape in black.

    `silhouette` is the mask the outline grows from, and it is deliberately
    separate from `keep`: the layer being written holds only part of the
    figure, so growing the ring from that part alone would draw a black line
    down the seam between the layers instead of around the player.
    """
    alpha = keep.astype(np.float64)
    out_rgb = np.where(keep[..., None], rgb, 0.0)
    if outline_px > 0:
        sil = keep if silhouette is None else silhouette
        grown = Image.fromarray((sil * 255).astype(np.uint8), "L")
        grown = grown.filter(ImageFilter.MaxFilter(2 * outline_px + 1))
        ring = (np.asarray(grown, dtype=np.float64) / 255.0 > 0.5) & ~sil
        out_rgb = np.where(ring[..., None], np.asarray(outline_rgb), out_rgb)
        alpha = np.maximum(alpha, ring.astype(np.float64))
    return out_rgb, alpha


def downsample(rgb, alpha, size):
    """Resize with premultiplied alpha so edges do not bleed toward black."""
    pm = (rgb * alpha[..., None] * 255).clip(0, 255).astype(np.uint8)
    a8 = (alpha * 255).clip(0, 255).astype(np.uint8)
    pm_s = np.asarray(Image.fromarray(pm, "RGB")
                      .resize((size, size), Image.LANCZOS), dtype=np.float64)
    a_s = np.asarray(Image.fromarray(a8, "L")
                     .resize((size, size), Image.LANCZOS), dtype=np.float64)
    safe = np.maximum(a_s, 1e-6)[..., None]
    rgb_s = (pm_s / safe * 255.0).clip(0, 255)
    return np.dstack([rgb_s, a_s[..., None]]).astype(np.uint8)


def normalize_jersey(rgba):
    """Lift the jersey layer so a Phaser tint yields close to the team hex.

    Tinting multiplies, so a jersey that renders at 0.7 grey would return the
    team colour at 70% strength -- visibly washed out against the endzone
    painted in that same hex.
    """
    a = rgba[..., 3].astype(np.float64) / 255.0
    lit = rgba[..., :3].astype(np.float64)[a > 0.5]
    if lit.size == 0:
        return rgba
    peak = np.percentile(lit, 96)
    if peak < 1.0:
        return rgba
    scaled = (rgba[..., :3].astype(np.float64) * (245.0 / peak)).clip(0, 255)
    return np.dstack([scaled, rgba[..., 3:]]).astype(np.uint8)


def parse_anim_specs(text):
    """`run:8,tackle:6:ground` -> [(name, frames, ground), ...]."""
    out = []
    for spec in text.split(","):
        if not spec.strip():
            continue
        parts = spec.split(":")
        out.append((parts[0],
                    int(parts[1]) if len(parts) > 1 and parts[1] else 8,
                    "ground" in parts[2:]))
    return out


def ground_frames(frames, rest_y):
    """Translate each frame so its lowest point sits back on the field.

    WAM has no root translation an animation can reach: `shift` is parsed on a
    pose, but anim_rotations_at blends only pitch/yaw/roll/tilt, so it never
    arrives and editing it changes nothing. Rotating the root instead pivots
    the whole body about the pelvis head, which lifts the feet — a fall
    authored that way levitated 0.21 above the field while every model check
    still passed. Supplying the translation here is both the only place it can
    happen and the right one: these are sprites, and a falling sprite is a
    figure travelling down its own frame.
    """
    return [np.column_stack([V[:, 0], V[:, 1] + (rest_y - V[:, 1].min()), V[:, 2]])
            for V in frames]


def build(path, wamset, pitch, dirs, size, ss, outline, outdir, clip_defs):
    plain = load(path)
    held = load_composition(wamset, "carry") if wamset else None
    rest_y = float(plain.V[:, 1].min())

    clips = []
    for cd in clip_defs:
        n = cd["frames"]
        ball = parse_ball_range(cd.get("ball"), n)
        if ball and held is None:
            raise SystemExit("clip %r wants the ball but no .wamset was given"
                             % cd["name"])
        # Pose each source once, then take each frame from whichever one is
        # holding the ball at that point in the clip.
        posed = {False: posed_frames(plain, cd["anim"], n)}
        if ball:
            posed[True] = posed_frames(held, cd["anim"], n)
        frames = []
        for i in range(n):
            has = i in ball
            V = posed[has][i]
            frames.append((V, held if has else plain))
        if cd.get("ground"):
            grounded = ground_frames([f[0] for f in frames], rest_y)
            frames = [(g, s) for g, (_, s) in zip(grounded, frames)]
        clips.append({"name": cd["name"], "frames": frames,
                      "ground": bool(cd.get("ground")),
                      "loop": is_loop(plain, cd["anim"]),
                      "ball": sorted(ball)})

    yaws = [360.0 * d / dirs for d in range(dirs)]
    px = size * ss
    total_rows = sum(len(c["frames"]) for c in clips)

    # One framing across every pose of every clip AND every direction, or the
    # player changes size when it turns, strides, or starts a new action.
    allV = np.concatenate([V for c in clips for V, _ in c["frames"]])
    center = (allV.min(axis=0) + allV.max(axis=0)) / 2
    dist = max(wrender.fit_distance(allV, center,
                                    wrender.orbit_basis(y, pitch),
                                    28.0, 1.0, 1.14)
               for y in yaws)

    base = np.zeros((total_rows * size, dirs * size, 4), dtype=np.uint8)
    jers = np.zeros_like(base)
    glow = np.zeros_like(base)
    anims, row = {}, 0
    for c in clips:
        anims[c["name"]] = {"row": row, "frames": len(c["frames"]),
                            "loop": c["loop"], "ground": c["ground"],
                            "ballFrames": c["ball"]}
        for V, src in c["frames"]:
            for di, yaw in enumerate(yaws):
                rgb, jmask = render_pair(V, src.T, src.M, src.mesh,
                                         yaw, pitch, px, center, dist)
                keep = keep_mask(rgb)
                # The ring lives on the base layer so a tint never colours it.
                b_rgb, b_a = to_rgba(rgb, keep & ~jmask, outline, silhouette=keep)
                j_rgb, j_a = to_rgba(rgb, keep & jmask, 0)
                y0, x0 = row * size, di * size
                g_rgb, g_a = glow_rgba(keep)
                base[y0:y0 + size, x0:x0 + size] = downsample(b_rgb, b_a, size)
                jers[y0:y0 + size, x0:x0 + size] = normalize_jersey(
                    downsample(j_rgb, j_a, size))
                glow[y0:y0 + size, x0:x0 + size] = downsample(g_rgb, g_a, size)
            row += 1

    # Where the feet land inside a frame, measured off the alpha rather than
    # guessed, so the game can seat the sprite on its existing shadow ellipse
    # instead of having the offset hand-tuned by eye. Taken from the FIRST clip
    # only: that is the standing/running player the shadow has to line up with,
    # and a tackle deliberately travels down its frame.
    solid = np.maximum(base[..., 3], jers[..., 3]) > 128
    n0 = len(clips[0]["frames"])
    # Per cell-row, not globally: the lowest row of the whole atlas belongs to
    # whichever frame sits lowest in the sheet, which says nothing about how
    # far down the foot sits inside a cell.
    per_cell = solid[:n0 * size].reshape(n0, size, -1).any(axis=2)
    lows = [np.where(r)[0].max() for r in per_cell if r.any()]
    foot_frac = float((max(lows) + 1) / size) if lows else 1.0

    os.makedirs(outdir, exist_ok=True)
    stem = os.path.join(outdir, plain.model.name)
    Image.fromarray(base, "RGBA").save(stem + "_base.png")
    Image.fromarray(jers, "RGBA").save(stem + "_jersey.png")
    Image.fromarray(glow, "RGBA").save(stem + "_glow.png")
    meta = {"frameWidth": size, "frameHeight": size, "directions": dirs,
            "pitch": pitch, "yaws": yaws, "rows": total_rows,
            "footFrac": round(foot_frac, 4), "anims": anims}
    with open(stem + ".json", "w") as fh:
        json.dump(meta, fh, indent=2)
    print("wrote %s_base.png / _jersey.png / _glow.png  (%d dirs x %d rows @ %dpx)"
          % (stem, dirs, total_rows, size))
    for name, a in anims.items():
        print("   %-8s rows %2d..%-2d  %s%s"
              % (name, a["row"], a["row"] + a["frames"] - 1,
                 "loop" if a["loop"] else "one-shot",
                 ", grounded" if a["ground"] else ""))
    return stem


def contact(path, pitches, dirs, size, outdir):
    """One row per candidate pitch, at true sprite size, for choosing a camera."""
    src = load(path)
    V, T, M = src.V, src.T, src.M
    mesh = src.mesh
    yaws = [360.0 * d / dirs for d in range(dirs)]
    pad, scale = 6, 4          # blow the thumbnails back up to be legible
    sheet = Image.new("RGB", (dirs * (size * scale + pad) + pad,
                              len(pitches) * (size * scale + pad) + pad),
                      (46, 92, 46))
    for pi, pitch in enumerate(pitches):
        center = (V.min(axis=0) + V.max(axis=0)) / 2
        dist = max(wrender.fit_distance(V, center,
                                        wrender.orbit_basis(y, pitch),
                                        28.0, 1.0, 1.14) for y in yaws)
        for di, yaw in enumerate(yaws):
            rgb, jmask = render_pair(V, T, M, mesh, yaw, pitch, size * 4,
                                     center, dist)
            keep = keep_mask(rgb)
            c_rgb, c_a = to_rgba(rgb, keep, 6)
            small = downsample(c_rgb, c_a, size)
            im = Image.fromarray(small, "RGBA").resize(
                (size * scale, size * scale), Image.NEAREST)
            sheet.paste(im, (pad + di * (size * scale + pad),
                             pad + pi * (size * scale + pad)), im)
    os.makedirs(outdir, exist_ok=True)
    out = os.path.join(outdir, "%s_contact.png" % model.name)
    sheet.save(out)
    print("wrote %s   rows top-to-bottom: pitch %s"
          % (out, ", ".join(str(p) for p in pitches)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model")
    ap.add_argument("--pitch", type=float, default=42.0)
    ap.add_argument("--dirs", type=int, default=8)
    ap.add_argument("--wamset", default="gridiron.wamset",
                    help="set file holding the `carry` composition — the "
                         "player with the ball grafted into their hand")
    ap.add_argument("--size", type=int, default=64)
    ap.add_argument("--ss", type=int, default=4, help="supersample factor")
    ap.add_argument("--outline", type=int, default=7,
                    help="outline radius in supersampled pixels")
    ap.add_argument("-o", "--outdir", default="sprites")
    ap.add_argument("--contact", action="store_true",
                    help="compare camera pitches instead of baking")
    ap.add_argument("--pitches", default="20,32,42,55,68")
    a = ap.parse_args()
    if a.contact:
        contact(a.model, [float(p) for p in a.pitches.split(",")],
                a.dirs, a.size, a.outdir)
    else:
        build(a.model, a.wamset, a.pitch, a.dirs, a.size, a.ss,
              a.outline, a.outdir, DEFAULT_CLIPS)


if __name__ == "__main__":
    main()
