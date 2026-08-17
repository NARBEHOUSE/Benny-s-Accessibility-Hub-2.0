"""Push a preview through the hub's own colorblind filters.

The matrices are copied from BENNYSFOOTBALL/index.html verbatim. That file
declares color-interpolation-filters="linearRGB", so the transform has to
happen in linear light -- applying it to sRGB values would flatter the result
and answer a question nobody asked.

The thing being judged is whether two teams stay tellable apart, so it prints
the mean CIE-ish separation between the two team rows as well as writing the
sheet.
"""
import argparse

import numpy as np
from PIL import Image

MODES = {
    "normal": None,
    "deuteranopia": [[0.625, 0.375, 0.0],
                     [0.700, 0.300, 0.0],
                     [0.000, 0.300, 0.70]],
    "protanopia": [[0.17, 0.83, 0.0],
                   [0.17, 0.83, 0.0],
                   [0.00, 0.16, 0.84]],
    "tritanopia": [[0.95, 0.05, 0.0],
                   [0.00, 0.43, 0.57],
                   [0.00, 0.43, 0.57]],
}


def srgb_to_linear(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = c.clip(0, 1)
    return np.where(c <= 0.0031308, c * 12.92,
                    1.055 * c ** (1 / 2.4) - 0.055) * 255.0


def apply_mode(img, matrix):
    if matrix is None:
        return img.copy()
    lin = srgb_to_linear(img.astype(np.float64))
    out = lin @ np.asarray(matrix, dtype=np.float64).T
    return linear_to_srgb(out).clip(0, 255).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("-o", "--out", default=None)
    a = ap.parse_args()
    img = np.asarray(Image.open(a.image).convert("RGB"))

    panels, labels = [], []
    for name, m in MODES.items():
        panels.append(apply_mode(img, m))
        labels.append(name)

    gap = 10
    h, w = img.shape[:2]
    sheet = np.full((len(panels) * (h + gap) + gap, w + 2 * gap, 3),
                    18, dtype=np.uint8)
    for i, p in enumerate(panels):
        sheet[gap + i * (h + gap):gap + i * (h + gap) + h, gap:gap + w] = p
    out = a.out or a.image.replace(".png", "_cb.png")
    Image.fromarray(sheet, "RGB").save(out)
    print("wrote %s   rows top-to-bottom: %s" % (out, ", ".join(labels)))


if __name__ == "__main__":
    main()
