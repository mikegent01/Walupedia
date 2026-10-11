#!/usr/bin/env python3
"""A figure antialiased onto the magenta field must not keep a purple rim after the cut.

Draws a grey disc and a dark-blue disc on #FF00FF at 4x and downsamples (so every edge pixel is a
real figure/field mix), cuts it with tools/make-token-plates.py, and counts visible pixels that still
lean magenta (red and blue both well over green). Needs Pillow + numpy; skips without them.
"""
import importlib.util
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    import numpy as np
    from PIL import Image, ImageDraw
except ImportError:
    print("skip: Pillow/numpy not installed")
    sys.exit(0)

spec = importlib.util.spec_from_file_location("mtp", os.path.join(ROOT, "tools", "make-token-plates.py"))
mtp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mtp)


def purple(path):
    a = np.asarray(Image.open(path).convert("RGBA")).astype(int)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    vis = al > 8
    return int(vis.sum()), int((vis & (np.minimum(r, b) - g > 25)).sum())


def main():
    big = Image.new("RGB", (1200, 800), (255, 0, 255))
    d = ImageDraw.Draw(big)
    d.ellipse((120, 120, 520, 680), fill=(120, 120, 120))
    d.ellipse((640, 160, 1080, 640), fill=(30, 40, 90))
    small = big.resize((300, 200), Image.LANCZOS)          # antialiased edges: every rim pixel is a mix
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = os.path.join(tmp, "src.png"), os.path.join(tmp, "plate.png")
        small.save(src)
        mtp.cut(src, dst)
        mtp.heal(dst)
        visible, tinted = purple(dst)
    ok = visible > 5000 and tinted == 0
    print(("ok   " if ok else "FAIL ") + f"cut: {visible} visible px, {tinted} still magenta-tinted")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
