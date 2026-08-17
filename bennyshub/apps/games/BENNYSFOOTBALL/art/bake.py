"""Bake a WAM model into Phaser-ready directional sprite sheets.

WAM's rasterizer writes opaque RGB with a solid background and no anti-aliasing,
so alpha has to be recovered here: render on a chroma background at 4x, key it
exactly (no AA means no fringe), add the black outline the hub's art style uses,
then downsample with premultiplied alpha.

Team colour is a runtime tint, so each frame is split into two layers. The
jersey layer is found by rendering twice with different jersey palette entries
and differencing -- that captures occlusion exactly, which a material-id pass
would not.

  python3 bake.py gridiron.wam --contact          # choose a camera pitch
  python3 bake.py gridiron.wam --pitch 42          # write the sheets
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


def load(path):
    model = wparser.parse_file(path)
    bones, bone_order = wskel.solve(model)
    mesh = wmesh.build(model, bones)
    return model, bones, bone_order, mesh


def posed_frames(model, bones, bone_order, mesh, anim_name, frames):
    """Return a list of vertex arrays, one per animation frame."""
    V, _, _ = mesh.arrays()
    if anim_name in (None, "rest"):
        return [V]
    anim = next((a for a in model.anims if a["name"] == anim_name), None)
    if anim is None:
        raise SystemExit("no such anim: %s (have %s)"
                         % (anim_name, [a["name"] for a in model.anims]))
    out = []
    for i in range(frames):
        # Phase 1.0 of a loop is phase 0, so a looping clip stops short of it.
        ph = i / frames if anim["loop"] else i / max(frames - 1, 1)
        rots = wanim.anim_rotations_at(model, bones, anim, ph)
        out.append(wanim.skin_verts(mesh, bones, bone_order, rots))
    return out


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


def build(path, pitch, dirs, anim_specs, size, ss, outline, outdir):
    model, bones, bone_order, mesh = load(path)
    V0, T, M = mesh.arrays()
    rest_y = float(V0[:, 1].min())

    clips = []
    for name, n, ground in parse_anim_specs(anim_specs):
        poses = posed_frames(model, bones, bone_order, mesh, name, n)
        if ground:
            poses = ground_frames(poses, rest_y)
        src = next((a for a in model.anims if a["name"] == name), {})
        clips.append({"name": name, "poses": poses, "ground": ground,
                      "loop": bool(src.get("loop"))})

    yaws = [360.0 * d / dirs for d in range(dirs)]
    px = size * ss
    total_rows = sum(len(c["poses"]) for c in clips)

    # One framing across every pose of every clip AND every direction, or the
    # player changes size when it turns, strides, or starts a new action.
    allV = np.concatenate([p for c in clips for p in c["poses"]])
    center = (allV.min(axis=0) + allV.max(axis=0)) / 2
    dist = max(wrender.fit_distance(allV, center,
                                    wrender.orbit_basis(y, pitch),
                                    28.0, 1.0, 1.14)
               for y in yaws)

    base = np.zeros((total_rows * size, dirs * size, 4), dtype=np.uint8)
    jers = np.zeros_like(base)
    anims, row = {}, 0
    for c in clips:
        anims[c["name"]] = {"row": row, "frames": len(c["poses"]),
                            "loop": c["loop"], "ground": c["ground"]}
        for V in c["poses"]:
            for di, yaw in enumerate(yaws):
                rgb, jmask = render_pair(V, T, M, mesh, yaw, pitch, px,
                                         center, dist)
                keep = keep_mask(rgb)
                # The ring lives on the base layer so a tint never colours it.
                b_rgb, b_a = to_rgba(rgb, keep & ~jmask, outline, silhouette=keep)
                j_rgb, j_a = to_rgba(rgb, keep & jmask, 0)
                y0, x0 = row * size, di * size
                base[y0:y0 + size, x0:x0 + size] = downsample(b_rgb, b_a, size)
                jers[y0:y0 + size, x0:x0 + size] = normalize_jersey(
                    downsample(j_rgb, j_a, size))
            row += 1

    # Where the feet land inside a frame, measured off the alpha rather than
    # guessed, so the game can seat the sprite on its existing shadow ellipse
    # instead of having the offset hand-tuned by eye. Taken from the FIRST clip
    # only: that is the standing/running player the shadow has to line up with,
    # and a tackle deliberately travels down its frame.
    solid = np.maximum(base[..., 3], jers[..., 3]) > 128
    n0 = len(clips[0]["poses"])
    # Per cell-row, not globally: the lowest row of the whole atlas belongs to
    # whichever frame sits lowest in the sheet, which says nothing about how
    # far down the foot sits inside a cell.
    per_cell = solid[:n0 * size].reshape(n0, size, -1).any(axis=2)
    lows = [np.where(r)[0].max() for r in per_cell if r.any()]
    foot_frac = float((max(lows) + 1) / size) if lows else 1.0

    os.makedirs(outdir, exist_ok=True)
    stem = os.path.join(outdir, model.name)
    Image.fromarray(base, "RGBA").save(stem + "_base.png")
    Image.fromarray(jers, "RGBA").save(stem + "_jersey.png")
    meta = {"frameWidth": size, "frameHeight": size, "directions": dirs,
            "pitch": pitch, "yaws": yaws, "rows": total_rows,
            "footFrac": round(foot_frac, 4), "anims": anims}
    with open(stem + ".json", "w") as fh:
        json.dump(meta, fh, indent=2)
    print("wrote %s_base.png / _jersey.png  (%d dirs x %d rows @ %dpx)"
          % (stem, dirs, total_rows, size))
    for name, a in anims.items():
        print("   %-8s rows %2d..%-2d  %s%s"
              % (name, a["row"], a["row"] + a["frames"] - 1,
                 "loop" if a["loop"] else "one-shot",
                 ", grounded" if a["ground"] else ""))
    return stem


def contact(path, pitches, dirs, size, outdir):
    """One row per candidate pitch, at true sprite size, for choosing a camera."""
    model, bones, bone_order, mesh = load(path)
    _, T, M = mesh.arrays()
    V, _, _ = mesh.arrays()
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
    ap.add_argument("--anims", default="run:8,throw:8,catch:6,tackle:6:ground",
                    help="name:frames[:ground], comma separated. The first clip"
                         " defines the foot line the game seats sprites by.")
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
        build(a.model, a.pitch, a.dirs, a.anims, a.size, a.ss,
              a.outline, a.outdir)


if __name__ == "__main__":
    main()
