"""Reproduce BENNYSFOOTBALL's own field and formation, discs vs sprites.

Every constant here is copied from js/constants.js and js/game.js (drawField,
formationPositions, makePlayer) so the comparison is of the change and nothing
else. This exists because the game cannot be screenshotted from here; it is a
faithful mock, not the running game.
"""
import json

import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H = 1000, 600
LEFT, RIGHT, TOP, BOTTOM = 80, 920, 120, 500
WIDTH, HEIGHT, END_ZONE = 840, 380, 70
PLAY_W = WIDTH - END_ZONE * 2
GOAL_L, GOAL_R = LEFT + END_ZONE, RIGHT - END_ZONE
MID_Y = (TOP + BOTTOM) / 2

PLAYER_HEX = "#d32f2f"      # Red
PLAYER_LIGHT = "#ff6659"
OPP_HEX = "#1565c0"         # Blue
OPP_LIGHT = "#5e92f3"


def yd_to_x(yd):
    return GOAL_L + (yd / 100.0) * PLAY_W


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def formation(los_yard=25):
    lx, my = yd_to_x(los_yard), MID_Y
    off = [(lx - 38, my), (lx - 52, my + 20), (lx - 8, my - 130),
           (lx - 8, my + 130), (lx - 8, my - 55), (lx - 12, my)]
    dfn = [(lx + 14, my - 12), (lx + 14, my + 12), (lx + 48, my),
           (lx + 26, my - 120), (lx + 26, my + 120), (lx + 95, my)]
    return off, dfn


def draw_field(d):
    d.rectangle([0, 0, W, H], fill=(0x0a, 0x14, 0x08))
    stripe_w = PLAY_W / 10
    for i in range(10):
        c = (0x2e, 0x7d, 0x32) if i % 2 == 0 else (0x27, 0x6b, 0x2c)
        d.rectangle([GOAL_L + i * stripe_w, TOP,
                     GOAL_L + (i + 1) * stripe_w, BOTTOM], fill=c)
    for x0, col in ((LEFT, PLAYER_HEX), (GOAL_R, OPP_HEX)):
        ov = Image.new("RGBA", (END_ZONE, HEIGHT), hex_rgb(col) + (230,))
        d._image.paste(ov, (int(x0), TOP), ov)
    for yd in range(5, 100, 5):
        d.line([yd_to_x(yd), TOP, yd_to_x(yd), BOTTOM], fill=(190, 200, 190), width=1)
    for yd in range(10, 100, 10):
        d.line([yd_to_x(yd), TOP, yd_to_x(yd), BOTTOM], fill=(225, 232, 225), width=2)
    h1, h2 = TOP + HEIGHT * 0.34, TOP + HEIGHT * 0.66
    for yd in range(1, 100):
        x = yd_to_x(yd)
        d.line([x, h1 - 5, x, h1 + 5], fill=(210, 220, 210), width=2)
        d.line([x, h2 - 5, x, h2 + 5], fill=(210, 220, 210), width=2)
    for gx in (GOAL_L, GOAL_R):
        d.line([gx, TOP, gx, BOTTOM], fill=(250, 252, 250), width=3)
    d.rectangle([LEFT, TOP, LEFT + WIDTH, TOP + HEIGHT], outline=(250, 252, 250), width=3)
    for px, dr in ((LEFT + 4, 1), (RIGHT - 4, -1)):
        d.line([px, MID_Y - 48, px, MID_Y + 48], fill=(255, 225, 77), width=5)
        d.line([px, MID_Y - 48, px + dr * 18, MID_Y - 48], fill=(255, 225, 77), width=5)
        d.line([px, MID_Y + 48, px + dr * 18, MID_Y + 48], fill=(255, 225, 77), width=5)


def shadow(img, cx, cy):
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(ov).ellipse([cx + 3 - 17, cy + 7 - 5.5, cx + 3 + 17, cy + 7 + 5.5],
                               fill=(0, 0, 0, 133))
    img.alpha_composite(ov)


def disc(img, cx, cy, body, light, label, font):
    shadow(img, cx, cy)
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dd = ImageDraw.Draw(ov)
    dd.ellipse([cx - 13, cy - 13, cx + 13, cy + 13],
               fill=hex_rgb(body), outline=(0, 0, 0), width=3)
    dd.ellipse([cx - 4 - 4, cy - 4 - 4, cx - 4 + 4, cy - 4 + 4],
               fill=hex_rgb(light) + (153,))
    img.alpha_composite(ov)
    tw = ImageDraw.Draw(img)
    tw.text((cx, cy), label, font=font, fill=(255, 255, 255),
            anchor="mm", stroke_width=2, stroke_fill=(0, 0, 0))


def sprite(img, cx, cy, base, jers, meta, team_hex, d_idx, f_idx, label, font):
    s, dirs = meta["frameWidth"], meta["directions"]
    h, foot_off = 52, 8
    # Row 0 of the run clip: the standing/contact frame.
    f_idx = meta["anims"]["run"]["row"] + f_idx
    b = base[f_idx * s:(f_idx + 1) * s, d_idx * s:(d_idx + 1) * s].astype(np.float64)
    j = jers[f_idx * s:(f_idx + 1) * s, d_idx * s:(d_idx + 1) * s].astype(np.float64)
    j[..., :3] *= np.asarray(hex_rgb(team_hex), dtype=np.float64) / 255.0
    cell = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    cell.alpha_composite(Image.fromarray(j.clip(0, 255).astype(np.uint8), "RGBA"))
    cell.alpha_composite(Image.fromarray(b.clip(0, 255).astype(np.uint8), "RGBA"))
    cell = cell.resize((h, h), Image.LANCZOS)
    shadow(img, cx, cy)
    sy = foot_off - (meta["footFrac"] - 0.5) * h
    img.alpha_composite(cell, (int(round(cx - h / 2)), int(round(cy + sy - h / 2))))
    ImageDraw.Draw(img).text((cx, cy + sy - h * 0.46), label, font=font,
                             fill=(255, 255, 255), anchor="mm",
                             stroke_width=2, stroke_fill=(0, 0, 0))


def panel(mode, base, jers, meta, font, title_font):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    d = ImageDraw.Draw(img)
    d._image = img
    draw_field(d)
    off, dfn = formation(25)
    off_lbl = ["QB", "RB", "WR", "WR", "TE", "OL"]
    def_lbl = ["DL", "DL", "LB", "CB", "CB", "S"]
    # Offense drives right (dir 6); the defense faces them (dir 2).
    rows = ([(p, l, PLAYER_HEX, PLAYER_LIGHT, 6) for p, l in zip(off, off_lbl)]
            + [(p, l, OPP_HEX, OPP_LIGHT, 2) for p, l in zip(dfn, def_lbl)])
    # Painter's order matches the game's y-sort: higher y draws on top.
    for (cx, cy), lbl, hexc, light, di in sorted(rows, key=lambda r: r[0][1]):
        if mode == "disc":
            disc(img, cx, cy, hexc, light, lbl, font)
        else:
            sprite(img, cx, cy, base, jers, meta, hexc, di, 0, lbl, font)
    d.text((14, 10), "CLASSIC — flat colour discs" if mode == "disc"
           else "3D — baked WAM sprites, jersey tinted per team",
           font=title_font, fill=(255, 255, 255), stroke_width=3,
           stroke_fill=(0, 0, 0))
    return img


def main():
    stem = ("/Users/egd/projects/volunteer-work/Benny-s-Accessibility-Hub-2.0/"
            "bennyshub/apps/games/BENNYSFOOTBALL/images/players/gridiron")
    meta = json.load(open(stem + ".json"))
    base = np.asarray(Image.open(stem + "_base.png").convert("RGBA"))
    jers = np.asarray(Image.open(stem + "_jersey.png").convert("RGBA"))
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Black.ttf", 9)
        tfont = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Black.ttf", 18)
    except OSError:
        font = tfont = ImageFont.load_default()

    a = panel("disc", base, jers, meta, font, tfont)
    b = panel("sprite", base, jers, meta, font, tfont)
    out = Image.new("RGB", (W, H * 2 + 8), (16, 16, 16))
    out.paste(a.convert("RGB"), (0, 0))
    out.paste(b.convert("RGB"), (0, H + 8))
    import os
    os.makedirs("out", exist_ok=True)
    out.save("out/fieldmock.png")
    print("wrote out/fieldmock.png")


if __name__ == "__main__":
    main()
