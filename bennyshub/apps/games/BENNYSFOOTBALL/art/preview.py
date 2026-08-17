"""Composite baked sprites the way Phaser will, to judge them at game size.

The only question that matters is whether a player reads on the actual field,
at the actual size, in the actual team colours -- and against the opponent.
Everything before this is a proxy for it.

  python3 preview.py ../images/players/gridiron                 # facings
  python3 preview.py ../images/players/gridiron --anim tackle   # one action
"""
import argparse
import json

import numpy as np
from PIL import Image

# Straight from js/constants.js
TEAMS = {"Red": "#d32f2f", "Blue": "#1565c0", "Green": "#2e7d32",
         "Gold": "#f9a825", "Purple": "#6a1b9a", "Orange": "#ef6c00",
         "Teal": "#00838f", "Pink": "#c2185b", "Navy": "#283593",
         "Black": "#37474f"}
TURF = (0x2e, 0x7d, 0x32)
TURF_ALT = (0x27, 0x6b, 0x2c)


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def tint(rgba, color):
    """Phaser's tint is a multiply, so reproduce exactly that."""
    out = rgba.astype(np.float64).copy()
    out[..., :3] *= np.asarray(color, dtype=np.float64) / 255.0
    return out.clip(0, 255).astype(np.uint8)


def over(dst, src):
    """Alpha-composite src (RGBA uint8) onto dst (RGB float 0..255)."""
    a = src[..., 3:4].astype(np.float64) / 255.0
    return dst * (1 - a) + src[..., :3].astype(np.float64) * a


def cell(base, jers, meta, team, row, d):
    """One composited frame: atlas row `row`, direction column `d`."""
    s = meta["frameWidth"]
    b = base[row * s:(row + 1) * s, d * s:(d + 1) * s]
    j = jers[row * s:(row + 1) * s, d * s:(d + 1) * s]
    out = np.zeros((s, s, 3), dtype=np.float64)
    out = over(out, tint(j, hex_rgb(TEAMS[team])))
    out = over(out, b)
    alpha = np.maximum(b[..., 3], j[..., 3]).astype(np.float64)
    return np.dstack([out, alpha[..., None]])


def field(w, h):
    """Turf with the game's own 5-yard stripes, so contrast is judged for real."""
    img = np.zeros((h, w, 3), dtype=np.float64)
    stripe = max(w // 10, 1)
    for x in range(w):
        img[:, x] = TURF if (x // stripe) % 2 == 0 else TURF_ALT
    for x in range(0, w, stripe):
        img[:, x:x + 1] = np.array([255, 255, 255]) * .35 + img[:, x:x + 1] * .65
    return img


def grid(base, jers, meta, rows, px, pad):
    """rows: list of lists of (team, atlas_row, direction)."""
    cw = int(px * 1.2)
    canvas = field(cw * max(len(r) for r in rows) + pad,
                   cw * len(rows) + pad)
    for ri, row in enumerate(rows):
        for ci, (team, arow, d) in enumerate(row):
            spr = cell(base, jers, meta, team, arow, d)
            im = Image.fromarray(spr.clip(0, 255).astype(np.uint8), "RGBA")
            im = im.resize((px, px), Image.LANCZOS)
            sa = np.asarray(im, dtype=np.uint8)
            y0 = ri * cw + (cw - px) // 2
            x0 = ci * cw + (cw - px) // 2
            win = canvas[y0:y0 + px, x0:x0 + px]
            canvas[y0:y0 + px, x0:x0 + px] = over(win, sa)
    return canvas.clip(0, 255).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stem", help="e.g. ../images/players/gridiron")
    ap.add_argument("--teams", default="Red,Blue")
    ap.add_argument("--anim", default=None,
                    help="show every frame of one clip instead of every facing")
    ap.add_argument("--dirs", default="6,7",
                    help="direction columns to show in --anim mode")
    ap.add_argument("--scales", default="1,2,4")
    ap.add_argument("--display", type=int, default=46)
    a = ap.parse_args()

    meta = json.load(open(a.stem + ".json"))
    base = np.asarray(Image.open(a.stem + "_base.png").convert("RGBA"))
    jers = np.asarray(Image.open(a.stem + "_jersey.png").convert("RGBA"))
    teams = a.teams.split(",")

    panels = []
    for scale in [int(s) for s in a.scales.split(",")]:
        if a.anim:
            clip = meta["anims"][a.anim]
            rows = [[(teams[0], clip["row"] + f, int(d))
                     for f in range(clip["frames"])]
                    for d in a.dirs.split(",")]
        else:
            run = meta["anims"]["run"]
            rows = [[(t, run["row"] + (d % run["frames"]), d)
                     for d in range(meta["directions"])] for t in teams]
        panels.append(grid(base, jers, meta, rows, a.display * scale, 6))

    width = max(p.shape[1] for p in panels)
    sheet = np.full((sum(p.shape[0] + 8 for p in panels), width, 3), 20,
                    dtype=np.uint8)
    y = 0
    for p in panels:
        sheet[y:y + p.shape[0], :p.shape[1]] = p
        y += p.shape[0] + 8
    out = a.stem + ("_%s.png" % a.anim if a.anim else "_preview.png")
    Image.fromarray(sheet, "RGB").save(out)
    print("wrote %s" % out)


if __name__ == "__main__":
    main()
