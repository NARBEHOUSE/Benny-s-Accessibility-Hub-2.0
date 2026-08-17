"""Render the coverage highlights exactly as game.js draws them.

Shape plus colour is how the open / covered / doubled state is read, so this
reproduces drawShape() from game.js faithfully — same radii, same stroke
widths, same order, same palette — and puts the disc and the sprite side by
side. The sprite is much taller than the disc it replaced and stands almost
entirely ABOVE the container origin the shape is centred on, so the geometry
that framed a disc no longer frames a player.

  python3 highlightcheck.py
"""
import json

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

import fieldmock as fm

# cbHighlightColor / cbGlowAlpha, normal mode, from js/constants.js
COVER = [
    ("OPEN",    "#2196f3", 0.32, "circle"),
    ("COVERED", "#ffb300", 0.36, "triangle"),
    ("DOUBLED", "#ff4040", 0.44, "square"),
]
TURF, TURF_ALT = (0x2e, 0x7d, 0x32), (0x27, 0x6b, 0x2c)


def draw_shape(d, kind, px, py, scale, col, fill_alpha, stroke_w, shadow_w):
    """A faithful port of drawShape() in game.js."""
    tr = 26 * scale
    hs = 22 * scale
    if kind == "circle":
        if fill_alpha > 0:
            d.ellipse([px - tr - 4, py - tr - 4, px + tr + 4, py + tr + 4],
                      fill=col + (int(fill_alpha * 255),))
        if shadow_w > 0:
            d.ellipse([px - tr, py - tr, px + tr, py + tr],
                      outline=(0, 0, 0, 191), width=shadow_w)
        d.ellipse([px - tr, py - tr, px + tr, py + tr],
                  outline=col + (255,), width=stroke_w)
    elif kind == "triangle":
        pts = [(px, py - tr), (px - tr * .866, py + tr * .5),
               (px + tr * .866, py + tr * .5)]
        if fill_alpha > 0:
            d.polygon(pts, fill=col + (int(fill_alpha * 255),))
        if shadow_w > 0:
            d.line(pts + [pts[0]], fill=(0, 0, 0, 191), width=shadow_w)
        d.line(pts + [pts[0]], fill=col + (255,), width=stroke_w)
    else:
        box = [px - hs, py - hs, px + hs, py + hs]
        if fill_alpha > 0:
            d.rectangle(box, fill=col + (int(fill_alpha * 255),))
        if shadow_w > 0:
            d.rectangle(box, outline=(0, 0, 0, 191), width=shadow_w)
        d.rectangle(box, outline=col + (255,), width=stroke_w)


def player_cell(base, jers, meta, team_hex, d_idx, f_idx, h):
    """The composited player as an RGBA image, so its alpha can be dilated."""
    sz = meta["frameWidth"]
    b = base[f_idx * sz:(f_idx + 1) * sz, d_idx * sz:(d_idx + 1) * sz]
    j = jers[f_idx * sz:(f_idx + 1) * sz, d_idx * sz:(d_idx + 1) * sz].astype(float)
    j[..., :3] *= np.asarray(fm.hex_rgb(team_hex), dtype=float) / 255.0
    cell = Image.new("RGBA", (sz, sz), (0, 0, 0, 0))
    cell.alpha_composite(Image.fromarray(j.clip(0, 255).astype(np.uint8), "RGBA"))
    cell.alpha_composite(Image.fromarray(b, "RGBA"))
    return cell.resize((h, h), Image.LANCZOS)


def glow_for(cell, col, radius=6, falloff=5):
    """A coloured aura hugging the figure's own outline.

    Ben's suggestion. Unlike a shape it cannot be mislocated, because it is
    derived from the silhouette itself — it frames whatever pose is on screen.
    """
    a = cell.split()[3]
    inner = a.filter(ImageFilter.MaxFilter(2 * radius + 1))
    outer = inner.filter(ImageFilter.MaxFilter(2 * falloff + 1)).filter(
        ImageFilter.GaussianBlur(falloff))
    out = Image.new("RGBA", cell.size, (0, 0, 0, 0))
    for mask, alpha in ((outer, 0.55), (inner, 0.95)):
        layer = Image.new("RGBA", cell.size, col + (0,))
        layer.putalpha(mask.point(lambda v: int(v * alpha)))
        out.alpha_composite(layer)
    return out


def panel(mode, marker_dy, base, jers, meta, font, title, scale=1.0):
    """One column: three coverage states, drawn the way the game draws them."""
    cw, ch = 200, 190
    img = Image.new("RGBA", (cw, ch * len(COVER) + 34), (0, 0, 0, 255))
    for x in range(cw):
        img.paste(Image.new("RGBA", (1, img.height),
                            (TURF if (x // 20) % 2 == 0 else TURF_ALT) + (255,)),
                  (x, 0))
    d = ImageDraw.Draw(img, "RGBA")
    d.text((8, 8), title, font=font, fill=(255, 255, 255),
           stroke_width=3, stroke_fill=(0, 0, 0))

    H, FOOT = 52, 8
    for i, (label, hexc, alpha, kind) in enumerate(COVER):
        col = fm.hex_rgb(hexc)
        cx, cy = cw // 2, 34 + i * ch + ch // 2
        # markerGfx is depth 1: anything marking the player goes down first.
        if mode in ("disc", "shape"):
            draw_shape(d, kind, cx, cy + marker_dy, scale, col, alpha, 6, 9)
        if mode in ("glow", "glowshape"):
            cell = player_cell(base, jers, meta, "#d32f2f", 6,
                               meta["anims"]["run"]["row"], H)
            sy = FOOT - (meta["footFrac"] - 0.5) * H
            g = glow_for(cell, col)
            img.alpha_composite(g, (int(cx - H / 2), int(cy + sy - H / 2)))
        if mode == "glowshape":
            # Shape kept as a badge above the helmet so status still has a
            # non-colour channel.
            draw_shape(d, kind, cx, cy - 46, 0.42, col, 0.9, 3, 5)
        if mode == "disc":
            fm.disc(img, cx, cy, "#d32f2f", "#ff6659", "WR", font)
        else:
            fm.sprite(img, cx, cy, base, jers, meta, "#d32f2f",
                      6, meta["anims"]["run"]["row"], "WR", font)
        d.text((8, 34 + i * ch + 8), label, font=font, fill=(255, 255, 255),
               stroke_width=3, stroke_fill=(0, 0, 0))
    return img


def main():
    stem = "../images/players/gridiron"
    meta = json.load(open(stem + ".json"))
    base = np.asarray(Image.open(stem + "_base.png").convert("RGBA"))
    jers = np.asarray(Image.open(stem + "_jersey.png").convert("RGBA"))
    try:
        font = ImageFont.truetype(
            "/System/Library/Fonts/Supplemental/Arial Black.ttf", 13)
    except OSError:
        font = ImageFont.load_default()

    def sheet(cols, path):
        w = sum(c.width + 8 for c in cols)
        out = Image.new("RGB", (w, cols[0].height), (16, 16, 16))
        x = 0
        for c in cols:
            out.paste(c.convert("RGB"), (x, 0))
            x += c.width + 8
        out.save(path)
        print("wrote", path)

    sheet([
        panel("disc", 0, base, jers, meta, font, "DISC (original)"),
        panel("shape", 0, base, jers, meta, font, "SPRITE, as now"),
        panel("shape", -16, base, jers, meta, font, "SPRITE, re-centred"),
    ], "out/highlights.png")

    # How much colour survives around the taller figure, at three sizes.
    sheet([
        panel("disc", 0, base, jers, meta, font, "DISC (reference)"),
        panel("sprite", -16, base, jers, meta, font, "re-centred 1.0x", 1.0),
        panel("sprite", -16, base, jers, meta, font, "re-centred 1.3x", 1.3),
        panel("sprite", -16, base, jers, meta, font, "re-centred 1.6x", 1.6),
    ], "out/highlight_sizes.png")

    # Ben's idea, against today's cue and against the re-centred shape.
    sheet([
        panel("disc", 0, base, jers, meta, font, "TODAY (disc+shape)"),
        panel("shape", -16, base, jers, meta, font, "shape, re-centred", 1.10),
        panel("glow", 0, base, jers, meta, font, "GLOW only"),
        panel("glowshape", 0, base, jers, meta, font, "GLOW + shape badge"),
    ], "out/highlight_glow.png")


if __name__ == "__main__":
    main()
