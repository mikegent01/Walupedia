#!/usr/bin/env python3
"""Cut the flat background out of the full-body sprites (transparent PNGs).

``tools/fullbody-portraits.py`` asks Qwen for a plain flat light-grey
background; this removes it. Per image: the background colour is the median of
the border pixels; every pixel close to it AND connected to the border is
background (a flood fill, so a white glove or grey coat inside the outline
survives). Enclosed pockets of the exact background colour (the gap between
an arm and the body) go too when they are big enough to be air, not cloth.
A 2-pixel band along the cut gets a soft alpha and the grey is un-mixed from
its colour so no halo is left on a dark map.

The flat original is copied to ``portraits/fullbody-flat/`` first (once), so a
bad cut can be redone with other tolerances: ``--from-flat``. Images that
already carry transparency are skipped.

Needs Pillow, numpy and scipy (ComfyUI's own Python has them).

  python tools/cutout-fullbody.py                      # every sprite
  python tools/cutout-fullbody.py --only wario,mr_t --from-flat --tol 24
  python tools/cutout-fullbody.py --preview out.jpg    # contact sheet on a dark checker, writes nothing else
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "Reputation-Matrix2", "portraits", "fullbody")
FLAT = os.path.join(ROOT, "Reputation-Matrix2", "portraits", "fullbody-flat")


def cut(rgb, tol, hole_tol, hole_min, band, floor=True):
    a = rgb.astype(np.float32)
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(border, axis=0)
    dist = np.abs(a - bg).max(axis=2)

    near = dist < tol
    labels, _ = ndimage.label(near)
    edge_labels = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    edge_labels = edge_labels[edge_labels > 0]
    background = np.isin(labels, edge_labels)

    # floor shadow: the grey "ground" oval Qwen paints under the feet —
    # colourless, fairly smooth (a grainy gradient, not cloth texture), at most
    # ~90 levels darker than the background, only in the strip just above the
    # figure's lowest point (feet level), touching the background already found.
    # It becomes a soft see-through black shadow instead of an opaque grey blob.
    shadow = np.zeros(dist.shape, bool)
    if floor:
        sat = a.max(axis=2) - a.min(axis=2)
        lum = a.mean(axis=2)
        sd = np.sqrt(np.maximum(ndimage.uniform_filter(lum * lum, 5) - ndimage.uniform_filter(lum, 5) ** 2, 0))
        cand = (sat < 12) & (lum > bg.mean() - 90) & (lum < bg.mean() + 20) & (sd < 18) & ~background
        rows = np.where((~background).any(axis=1))[0]
        lowest = int(rows.max()) if rows.size else cand.shape[0]
        cand[: max(0, lowest - int(cand.shape[0] * 0.07))] = False
        pl, n = ndimage.label(cand)
        if n:
            touch = np.unique(pl[ndimage.binary_dilation(background, iterations=2) & cand])
            shadow = np.isin(pl, touch[touch > 0])
            shadow = ndimage.binary_closing(shadow, iterations=2) & cand
        background |= shadow

    # enclosed air: tighter colour match, and big enough not to be a highlight
    tight = (dist < hole_tol) & ~background
    hl, n = ndimage.label(tight)
    if n:
        sizes = ndimage.sum(np.ones_like(dist), hl, index=np.arange(1, n + 1))
        keep = np.where(sizes >= hole_min)[0] + 1
        background |= np.isin(hl, keep)

    alpha = np.where(background, 0.0, 1.0).astype(np.float32)
    # soft band: pixels of the figure within `band` px of the cut fade by colour distance
    grown = ndimage.binary_dilation(background, iterations=band) & ~background
    soft = np.clip((dist - tol * 0.5) / (tol * 2.5), 0.0, 1.0)
    alpha = np.where(grown, np.minimum(alpha, np.maximum(soft, 0.0)), alpha)

    # un-mix the background from semi-transparent edge pixels
    am = alpha[..., None]
    with np.errstate(divide="ignore", invalid="ignore"):
        fg = np.where(am > 0.02, (a - bg * (1.0 - am)) / np.maximum(am, 1e-3), a)
    fg = np.clip(fg, 0, 255)
    if shadow.any():
        lum = a.mean(axis=2)
        dark = np.clip((bg.mean() - lum) / max(bg.mean(), 1.0) * 1.8, 0.0, 0.55)
        dark = ndimage.gaussian_filter(np.where(shadow, dark, 0.0), 1.5)
        put = shadow | (alpha == 0)
        alpha = np.where(put & (alpha < dark), dark, alpha)
        fg = np.where((put & (dark > 0.01))[..., None] & (am[..., 0:1] < 0.02), 0.0, fg)
    out = np.dstack([fg, alpha * 255.0]).round().astype(np.uint8)
    return out, bg, float(background.mean())


def has_alpha(img):
    if img.mode not in ("RGBA", "LA"):
        return False
    # Qwen's PNGs carry an alpha channel with a few near-opaque pixels; only a
    # real cut (a sizeable share of fully clear pixels) counts as done.
    return float((np.asarray(img.getchannel("A")) < 10).mean()) > 0.05


def checker(w, h, a=(40, 40, 48), b=(64, 64, 74), s=24):
    yy, xx = np.mgrid[0:h, 0:w]
    m = ((yy // s + xx // s) % 2)[..., None]
    return np.where(m, np.array(b), np.array(a)).astype(np.uint8)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--only", help="comma-separated stems")
    ap.add_argument("--from-flat", action="store_true", help="recut from the flat backup even if already cut")
    ap.add_argument("--tol", type=float, default=18, help="colour distance counted as background (0-255)")
    ap.add_argument("--hole-tol", type=float, default=8, help="tighter distance for enclosed pockets")
    ap.add_argument("--hole-min", type=int, default=600, help="smallest enclosed pocket (px) treated as air")
    ap.add_argument("--keep-floor", action="store_true", help="leave pale floor patches under the feet")
    ap.add_argument("--band", type=int, default=2, help="soft-edge width in px")
    ap.add_argument("--preview", help="write a contact sheet (jpg) of the results on a dark checker; no files changed")
    args = ap.parse_args(argv)

    only = {s.strip() for s in (args.only or "").split(",") if s.strip()}
    files = sorted(f for f in os.listdir(SRC) if f.lower().endswith(".png") and (not only or os.path.splitext(f)[0] in only))
    done = skipped = 0
    tiles = []
    for fn in files:
        path = os.path.join(SRC, fn)
        flat = os.path.join(FLAT, fn)
        if args.from_flat and os.path.isfile(flat):
            src_img = Image.open(flat)
        else:
            src_img = Image.open(path)
            if has_alpha(src_img):
                skipped += 1
                continue
        rgb = np.asarray(src_img.convert("RGB"))
        out, bg, frac = cut(rgb, args.tol, args.hole_tol, args.hole_min, args.band, not args.keep_floor)
        flag = "" if 0.25 < frac < 0.92 else "  <- check: background share looks off"
        print(f"  {fn:<40} bg {tuple(int(x) for x in bg)}  removed {frac:5.1%}{flag}")
        if args.preview:
            h, w = out.shape[:2]
            al = out[..., 3:4] / 255.0
            comp = (out[..., :3] * al + checker(w, h) * (1 - al)).astype(np.uint8)
            tiles.append(Image.fromarray(comp).resize((240, int(240 * h / w))))
            continue
        if not os.path.isfile(flat):
            os.makedirs(FLAT, exist_ok=True)
            shutil.copy2(path, flat)
        Image.fromarray(out, "RGBA").save(path, optimize=True)
        done += 1
    if args.preview and tiles:
        cols = min(6, len(tiles))
        rows = (len(tiles) + cols - 1) // cols
        th = max(t.height for t in tiles)
        sheet = Image.new("RGB", (240 * cols, th * rows), (30, 30, 36))
        for i, t in enumerate(tiles):
            sheet.paste(t, ((i % cols) * 240, (i // cols) * th))
        sheet.save(args.preview, quality=85)
        print(f"cutout-fullbody: preview of {len(tiles)} -> {args.preview}")
        return 0
    print(f"cutout-fullbody: {done} cut, {skipped} already transparent (flat originals in {os.path.relpath(FLAT, ROOT)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
