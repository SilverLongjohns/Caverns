#!/usr/bin/env python3
"""Terrain tile post-processing: seam scoring/repair and palette matching.

Pure python3 + Pillow (no numpy dependency, per env rules).

Usage:
  python3 scripts/tiles/postprocess.py seam <in.png> [--repair] [--threshold 18] <out.png>
  python3 scripts/tiles/postprocess.py match <in.png> --ref <floor.png> <out.png>
  python3 scripts/tiles/postprocess.py sheet <dir> <out.png>
  python3 scripts/tiles/postprocess.py selftest
"""

import argparse
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

BAND = 8  # px cross-fade band used by repair_seam
DEFAULT_THRESHOLD = 18.0


# ---------------------------------------------------------------------------
# Seam scoring / repair
# ---------------------------------------------------------------------------

def seam_score(img: Image.Image) -> float:
    """Mean absolute RGB difference between column 0 & column w-1, plus row 0 & row h-1.

    Two independent means (columns pair, rows pair) are computed and summed,
    so a tile that only misaligns on one axis still registers a meaningful
    score, and a tile that misaligns on both axes scores proportionally higher.
    """
    rgb = img.convert("RGB")
    w, h = rgb.size
    px = rgb.load()

    col_total = 0.0
    for y in range(h):
        c0 = px[0, y]
        cN = px[w - 1, y]
        col_total += sum(abs(a - b) for a, b in zip(c0, cN)) / 3.0
    col_mean = col_total / h

    row_total = 0.0
    for x in range(w):
        r0 = px[x, 0]
        rN = px[x, h - 1]
        row_total += sum(abs(a - b) for a, b in zip(r0, rN)) / 3.0
    row_mean = row_total / w

    return col_mean + row_mean


def repair_seam(img: Image.Image) -> Image.Image:
    """Offset-wrap the tile by half in x/y, cross-fade an 8px band across the
    (now centered) seam, then wrap back so the tile keeps its original framing.
    """
    rgba = img.convert("RGBA")
    w, h = rgba.size
    src = rgba.load()
    ox, oy = w // 2, h // 2

    # Offset-wrap: rolled[y][x] = src[(x-ox) mod w, (y-oy) mod h].
    # This relocates the original wrap-edge discontinuity to the centre.
    rolled = [[list(src[(x - ox) % w, (y - oy) % h]) for x in range(w)] for y in range(h)]

    half = BAND // 2

    # Cross-fade the vertical seam band (columns around ox).
    lo, hi = ox - half, ox + half
    left_anchor = (lo - 1) % w
    right_anchor = hi % w
    n = hi - lo
    for y in range(h):
        left_val = rolled[y][left_anchor]
        right_val = rolled[y][right_anchor]
        for i, idx in enumerate(range(lo, hi)):
            alpha = (i + 1) / (n + 1)
            idx_mod = idx % w
            rolled[y][idx_mod] = [(1 - alpha) * l + alpha * r for l, r in zip(left_val, right_val)]

    # Cross-fade the horizontal seam band (rows around oy).
    lo, hi = oy - half, oy + half
    top_anchor = (lo - 1) % h
    bottom_anchor = hi % h
    n = hi - lo
    for x in range(w):
        top_val = rolled[top_anchor][x]
        bottom_val = rolled[bottom_anchor][x]
        for i, idx in enumerate(range(lo, hi)):
            alpha = (i + 1) / (n + 1)
            idx_mod = idx % h
            rolled[idx_mod][x] = [(1 - alpha) * t + alpha * b for t, b in zip(top_val, bottom_val)]

    # Wrap back: out[y][x] = rolled[(y+oy) mod h][(x+ox) mod w].
    out = Image.new("RGBA", (w, h))
    out_px = out.load()
    for y in range(h):
        for x in range(w):
            v = rolled[(y + oy) % h][(x + ox) % w]
            out_px[x, y] = tuple(int(round(min(255.0, max(0.0, c)))) for c in v)
    return out


# ---------------------------------------------------------------------------
# Palette matching
# ---------------------------------------------------------------------------

def _srgb_to_linear(c: float) -> float:
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _rgb_to_lab_one(rgb):
    r, g, b = rgb[0], rgb[1], rgb[2]
    rl, gl, bl = _srgb_to_linear(r), _srgb_to_linear(g), _srgb_to_linear(b)

    x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375
    y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750
    z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041

    xn, yn, zn = 0.95047, 1.0, 1.08883
    x, y, z = x / xn, y / yn, z / zn

    delta = 6.0 / 29.0

    def f(t):
        return t ** (1.0 / 3.0) if t > delta ** 3 else t / (3 * delta ** 2) + 4.0 / 29.0

    fx, fy, fz = f(x), f(y), f(z)
    l = 116 * fy - 16
    a = 500 * (fx - fy)
    bb = 200 * (fy - fz)
    return (l, a, bb)


def _mean_luma(pixels) -> float:
    """Mean perceptual luma (BT.709 weights) over an iterable of (r,g,b[,a])."""
    total = 0.0
    n = 0
    for p in pixels:
        r, g, b = p[0], p[1], p[2]
        total += 0.2126 * r + 0.7152 * g + 0.0722 * b
        n += 1
    return total / n if n else 0.0


def _iter_pixels(img: Image.Image):
    rgb = img.convert("RGB")
    w, h = rgb.size
    px = rgb.load()
    for y in range(h):
        for x in range(w):
            yield px[x, y]


def mean_luma_of_image(img: Image.Image) -> float:
    return _mean_luma(_iter_pixels(img))


def build_palette(ref: Image.Image, max_colors: int = 16):
    """Median-cut palette (up to `max_colors` colours actually used) from `ref`."""
    ref_rgb = ref.convert("RGB")
    quantized = ref_rgb.quantize(colors=max_colors, method=Image.MEDIANCUT)
    palette = quantized.getpalette()
    used_indices = sorted(idx for _, idx in quantized.getcolors())
    colors = [tuple(palette[i * 3:i * 3 + 3]) for i in used_indices]
    return colors


def palette_match(img: Image.Image, ref: Image.Image) -> Image.Image:
    """Remap `img` to `ref`'s palette (nearest colour in CIE Lab, alpha kept),
    then scale so mean luminance is within ±3% of `ref`'s.
    """
    rgba = img.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()

    palette_colors = build_palette(ref)
    palette_lab = [_rgb_to_lab_one(c) for c in palette_colors]
    target_luma = mean_luma_of_image(ref)

    src_pixels = [px[x, y] for y in range(h) for x in range(w)]

    def map_at_scale(scale: float):
        mapped = []
        for (r, g, b, a) in src_pixels:
            sr = min(255.0, max(0.0, r * scale))
            sg = min(255.0, max(0.0, g * scale))
            sb = min(255.0, max(0.0, b * scale))
            lab = _rgb_to_lab_one((sr, sg, sb))
            best_idx = 0
            best_d = None
            for i, pl in enumerate(palette_lab):
                d = (lab[0] - pl[0]) ** 2 + (lab[1] - pl[1]) ** 2 + (lab[2] - pl[2]) ** 2
                if best_d is None or d < best_d:
                    best_d = d
                    best_idx = i
            mapped.append((palette_colors[best_idx], a))
        return mapped

    best_mapped = None
    best_diff = None
    steps = 240
    lo_s, hi_s = 0.25, 4.0
    for i in range(steps):
        t = i / (steps - 1)
        s = lo_s * (hi_s / lo_s) ** t
        mapped = map_at_scale(s)
        luma = _mean_luma(c for c, _ in mapped)
        diff = abs(luma - target_luma)
        if best_diff is None or diff < best_diff:
            best_diff = diff
            best_mapped = mapped

    out = Image.new("RGBA", (w, h))
    out.putdata([(c[0], c[1], c[2], a) for c, a in best_mapped])
    return out


# ---------------------------------------------------------------------------
# Contact sheet
# ---------------------------------------------------------------------------

def build_contact_sheet(directory: str, scale: int = 2, bg=(10, 10, 10, 255)) -> Image.Image:
    paths = sorted(p for p in os.listdir(directory) if p.lower().endswith(".png"))
    if not paths:
        raise ValueError(f"no PNG files found in {directory}")

    images = [(p, Image.open(os.path.join(directory, p)).convert("RGBA")) for p in paths]

    try:
        font = ImageFont.load_default()
    except Exception:
        font = None

    labels = [os.path.splitext(name)[0] for name, _ in images]

    # Measure label widths so text never overflows into the next cell.
    measurer = ImageDraw.Draw(Image.new("RGBA", (1, 1)))

    def text_width(s: str) -> int:
        bbox = measurer.textbbox((0, 0), s, font=font)
        return bbox[2] - bbox[0]

    label_h = 12
    inner_pad = 4  # gap between cell content and the next cell's border
    pad = 6
    cols = max(1, math.ceil(math.sqrt(len(images))))
    rows = math.ceil(len(images) / cols)

    max_img_w = max(im.width for _, im in images) * scale
    max_label_w = max((text_width(lbl) for lbl in labels), default=0)
    cell_content_w = max(max_img_w, max_label_w)
    cell_w = cell_content_w + inner_pad
    cell_h = max(im.height for _, im in images) * scale + inner_pad + label_h

    sheet_w = cols * cell_w + pad
    sheet_h = rows * cell_h + pad

    sheet = Image.new("RGBA", (sheet_w, sheet_h), bg)
    draw = ImageDraw.Draw(sheet)

    for i, ((name, im), label) in enumerate(zip(images, labels)):
        col = i % cols
        row = i // cols
        x0 = pad + col * cell_w
        y0 = pad + row * cell_h

        scaled = im.resize((im.width * scale, im.height * scale), resample=Image.NEAREST)
        sheet.paste(scaled, (x0, y0), scaled)

        draw.text((x0, y0 + scaled.height + 1), label, fill=(200, 200, 190, 255), font=font)

    return sheet


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

def _make_seam_test_image(size=32):
    """A tile with a hard discontinuity at both the x and y wrap edges."""
    img = Image.new("RGBA", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = x / (size - 1)
            r = int(40 + t * (210 - 40))
            g = int(r * 0.6)
            b = 60
            px[x, y] = (r, g, b, 255)
    for y in range(size):
        px[0, y] = (250, 250, 250, 255)
        px[size - 1, y] = (5, 5, 5, 255)
    for x in range(size):
        px[x, 0] = (250, 250, 250, 255)
        px[x, size - 1] = (5, 5, 5, 255)
    return img


def _make_palette_test_images():
    # Reference: four solid-colour quadrants -> a small, well-separated palette.
    ref = Image.new("RGB", (8, 8))
    ref_px = ref.load()
    quadrant_colors = [
        (40, 20, 15),   # dark umber (top-left)
        (25, 60, 55),   # dark teal (top-right)
        (90, 70, 30),   # amber-brown (bottom-left)
        (15, 15, 15),   # near-black (bottom-right)
    ]
    for y in range(8):
        for x in range(8):
            qx, qy = x // 4, y // 4
            ref_px[x, y] = quadrant_colors[qy * 2 + qx]

    # Source: a bright gradient (many distinct pixel values, none in ref's
    # palette) so the scale search has fine-grained control over which
    # pixels tip into which palette bin -- mirrors a real pale/warm tile.
    size = 16
    src = Image.new("RGBA", (size, size))
    src_px = src.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2.0 * (size - 1))
            r = int(150 + t * 90)
            g = int(120 + t * 90)
            b = int(150 + t * 80)
            src_px[x, y] = (r, g, b, 255)

    return src, ref


def selftest() -> bool:
    ok = True

    # --- seam scoring / repair -------------------------------------------------
    seam_img = _make_seam_test_image()
    before = seam_score(seam_img)
    repaired = repair_seam(seam_img)
    after = seam_score(repaired)
    print(f"[selftest] seam score before repair: {before:.3f}")
    print(f"[selftest] seam score after repair:  {after:.3f}")

    if not (before > 50):
        print("  FAIL: expected hard-seam image to score high (>50)")
        ok = False
    else:
        print("  OK: hard-seam image scores high")

    if not (after < before):
        print("  FAIL: expected repaired score to be lower than before")
        ok = False
    else:
        print("  OK: repaired score is lower")

    # --- palette matching --------------------------------------------------
    src, ref = _make_palette_test_images()
    palette_colors = set(build_palette(ref))
    matched = palette_match(src, ref)
    matched_rgb_data = list(_iter_pixels(matched))
    unique_pixels = set(matched_rgb_data)

    print(f"[selftest] ref palette colours: {sorted(palette_colors)}")
    print(f"[selftest] matched output colours: {sorted(unique_pixels)}")

    if not unique_pixels.issubset(palette_colors):
        print("  FAIL: matched output uses colours outside the ref palette")
        ok = False
    else:
        print("  OK: matched output uses only palette colours")

    target_luma = mean_luma_of_image(ref)
    out_luma = _mean_luma(matched_rgb_data)
    rel_diff = abs(out_luma - target_luma) / target_luma if target_luma else 0.0
    print(f"[selftest] ref luma: {target_luma:.3f}  matched luma: {out_luma:.3f}  rel diff: {rel_diff * 100:.2f}%")

    if rel_diff > 0.03 + 1e-9:
        print("  FAIL: matched luminance not within 3% of ref")
        ok = False
    else:
        print("  OK: matched luminance within 3% of ref")

    print()
    print("SELFTEST " + ("PASSED" if ok else "FAILED"))
    return ok


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_seam = sub.add_parser("seam")
    p_seam.add_argument("input")
    p_seam.add_argument("output")
    p_seam.add_argument("--repair", action="store_true")
    p_seam.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD)

    p_match = sub.add_parser("match")
    p_match.add_argument("input")
    p_match.add_argument("output")
    p_match.add_argument("--ref", required=True)

    p_sheet = sub.add_parser("sheet")
    p_sheet.add_argument("input_dir")
    p_sheet.add_argument("output")

    sub.add_parser("selftest")

    args = parser.parse_args(argv)

    if args.cmd == "selftest":
        passed = selftest()
        sys.exit(0 if passed else 1)

    elif args.cmd == "seam":
        img = Image.open(args.input)
        before = seam_score(img)
        if args.repair:
            out_img = repair_seam(img)
            after = seam_score(out_img)
        else:
            out_img = img
            after = before
        out_img.save(args.output)
        print(f"seam score before: {before:.3f}")
        print(f"seam score after:  {after:.3f}")
        flag = after if args.repair else before
        status = "OK" if flag <= args.threshold else "WARN"
        print(f"{status}: {'after' if args.repair else 'score'} {flag:.3f} vs threshold {args.threshold}")

    elif args.cmd == "match":
        img = Image.open(args.input)
        ref = Image.open(args.ref)
        before_luma = mean_luma_of_image(img)
        out_img = palette_match(img, ref)
        after_luma = mean_luma_of_image(out_img)
        ref_luma = mean_luma_of_image(ref)
        out_img.save(args.output)
        print(f"luma before: {before_luma:.3f}")
        print(f"luma after:  {after_luma:.3f}")
        print(f"ref luma:    {ref_luma:.3f}")

    elif args.cmd == "sheet":
        sheet = build_contact_sheet(args.input_dir)
        sheet.save(args.output)
        print(f"wrote contact sheet to {args.output}")


if __name__ == "__main__":
    main()
