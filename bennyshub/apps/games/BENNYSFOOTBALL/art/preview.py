"""Composite baked sprites the way Phaser will, to judge them at game size.

The only question that matters is whether a player reads on the actual field,
at the actual size, in the actual team colours -- and against the opponent.
Everything before this is a proxy for it.
"""
import argparse
import json
import os

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


def player(base, jers, team, d, f, size):
    b = base[f * size:(f + 1) * size, d * size:(d + 1) * size]
    j = jers[f * size:(f + 1) * size, d * size:(d + 1) * size]
    cell = np.zeros((size, size, 3), dtype=np.float64)
    alpha = np.maximum(b[..., 3], j[..., 3])
    cell = over(cell, tint(j, hex_rgb(TEAMS[team])))
    cell = over(cell, b)
    return np.dstack([cell, alpha[..., None].astype(np.float64)])


def field(w, h):
    """Turf with the game's own 5-yard stripes, so contrast is judged for real."""
    img = np.zeros((h, w, 3), dtype=np.float64)
    stripe = max(w // 10, 1)
    for x in range(w):
        img[:, x] = TURF if (x // stripe) % 2 == 0 else TURF_ALT
    for x in range(0, w, stripe):
        img[:, x:x + 1] = np.array([255, 255, 255]) * 0.35 + img[:, x:x + 1] * 0.65
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stem", help="e.g. sprites/gridiron_run")
    ap.add_argument("--teams", default="Red,Blue")
    ap.add_argument("--scales", default="1,2,4")
    ap.add_argument("--display", type=int, default=34,
                    help="on-field height in world px (circles are 26 across)")
    a = ap.parse_args()

    meta = json.load(open(a.stem + ".json"))
    size, dirs, frames = meta["frameWidth"], meta["directions"], meta["frames"]
    base = np.asarray(Image.open(a.stem + "_base.png").convert("RGBA"))
    jers = np.asarray(Image.open(a.stem + "_jersey.png").convert("RGBA"))
    teams = a.teams.split(",")
    scales = [int(s) for s in a.scales.split(",")]

    rows = []
    for scale in scales:
        px = a.display * scale
        cell = int(px * 1.25)
        row_h = cell * len(teams)
        canvas = field(cell * dirs, row_h)
        for ti, team in enumerate(teams):
            for d in range(dirs):
                # frame chosen per direction so the strip shows the whole cycle
                f = d % frames
                spr = player(base, jers, team, d, f, size)
                im = Image.fromarray(spr.clip(0, 255).astype(np.uint8), "RGBA")
                im = im.resize((px, px), Image.LANCZOS)
                sa = np.asarray(im, dtype=np.uint8)
                y0 = ti * cell + (cell - px) // 2
                x0 = d * cell + (cell - px) // 2
                win = canvas[y0:y0 + px, x0:x0 + px]
                canvas[y0:y0 + px, x0:x0 + px] = over(win, sa)
        rows.append(canvas.clip(0, 255).astype(np.uint8))

    width = max(r.shape[1] for r in rows)
    total = sum(r.shape[0] + 8 for r in rows)
    sheet = np.full((total, width, 3), 20, dtype=np.uint8)
    y = 0
    for r in rows:
        sheet[y:y + r.shape[0], :r.shape[1]] = r
        y += r.shape[0] + 8
    out = a.stem + "_preview.png"
    Image.fromarray(sheet, "RGB").save(out)
    print("wrote %s  (rows: %s x display height %dpx, teams %s)"
          % (out, scales, a.display, teams))


if __name__ == "__main__":
    main()
