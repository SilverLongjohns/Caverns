#!/usr/bin/env python3
"""Terrain tile post-processing: seam scoring/repair and palette matching.

Pure python3 + Pillow (no numpy dependency, per env rules).

Usage:
  python3 scripts/tiles/postprocess.py seam <in.png> [--repair] [--band 4] [--threshold 3.0] <out.png>
  python3 scripts/tiles/postprocess.py match <in.png> --ref <floor.png> <out.png>
  python3 scripts/tiles/postprocess.py sheet <dir> <out.png>
  python3 scripts/tiles/postprocess.py preview <in.png> [--reps 4] [--scale 8] <out.png>
  python3 scripts/tiles/postprocess.py selftest
"""

import argparse
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

DEFAULT_BAND = 4  # px cross-fade band used by _eased_edge_blend (controller ruling R4: 4, not the brief's 8)
DEFAULT_THRESHOLD = 18.0  # legacy seam_score threshold (kept for the `seam` CLI's reference line)
DEFAULT_BAND_THRESHOLD = 1.0  # band_score (per-axis std of column/row mean luma) threshold
DEFAULT_EDGE_RATIO_THRESHOLD = 1.6  # edge-crossing gradient vs interior gradient: above this, blend the edge


def _smoothstep(t: float) -> float:
    t = min(1.0, max(0.0, t))
    return t * t * (3.0 - 2.0 * t)


# ---------------------------------------------------------------------------
# Seam / banding scoring
# ---------------------------------------------------------------------------

def seam_score(img: Image.Image) -> float:
    """Mean absolute RGB difference between column 0 & column w-1, plus row 0 & row h-1.

    LEGACY metric, kept for reference/continuity with earlier reports. This
    only measures the single edge-crossing discontinuity; it does NOT detect
    low-frequency per-column/per-row luminance drift, which is what actually
    produces visible banding when a tile is repeated (see `band_score`).
    Forcing this metric to exactly zero (a bug in an earlier round) makes the
    two wrap-edge columns/rows literally identical, which reads as a doubled
    column/row when tiled -- do not gate repairs on this alone.
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


def band_score(img: Image.Image, reps: int = 3):
    """Low-frequency per-column / per-row mean-luminance DRIFT that repeats
    at the tile period once the tile is placed edge-to-edge -- this, not a
    single hard edge discontinuity, is what actually produces visible
    banding (some columns/rows are systematically lighter or darker than
    others, and that pattern repeats every `tile width` pixels).

    The image is tiled `reps`x`reps`, per-column (and per-row) mean luma is
    measured across the tiled image and folded back to one tile period
    (mathematically this just reproduces the original tile's own per-column/
    row means, since tiling only repeats content -- tiling first is done
    anyway so the metric is explicitly defined in terms of "what repeats at
    the tile period" rather than relying on that equivalence silently).
    Returns (col_std, row_std): the std of those folded per-axis means
    (equivalently, after removing their own mean, since subtracting a
    constant doesn't change a std). High values on either axis mean that
    axis will show visible banding when tiled.
    """
    rgb = img.convert("RGB")
    w, h = rgb.size
    tiled = Image.new("RGB", (w * reps, h * reps))
    for j in range(reps):
        for i in range(reps):
            tiled.paste(rgb, (i * w, j * h))
    tpx = tiled.load()
    tw, th = tiled.size

    col_sum = [0.0] * w
    for x in range(tw):
        c = x % w
        for y in range(th):
            r, g, b = tpx[x, y]
            col_sum[c] += _luma(r, g, b)
    col_means = [s / th for s in col_sum]

    row_sum = [0.0] * h
    for y in range(th):
        rr = y % h
        for x in range(tw):
            r, g, b = tpx[x, y]
            row_sum[rr] += _luma(r, g, b)
    row_means = [s / tw for s in row_sum]

    _cm, col_std = _mean_and_std(col_means)
    _rm, row_std = _mean_and_std(row_means)
    return col_std, row_std


def edge_interior_gradient(img: Image.Image):
    """Compares the wrap-edge crossing gradient (|col w-1 -> col 0|, and the
    row equivalent) to the TYPICAL interior neighbour-to-neighbour gradient.

    A well-behaved seamless tile has these close to each other (ratio near
    1.0): the step across the wrap looks like just another normal step of
    texture, not a hard cut and not an artificially perfect match either.
    Forcing the ratio to ~0 (matching columns/rows made byte-identical) is
    itself a defect -- it reads as a doubled column/row when tiled.
    """
    rgb = img.convert("RGB")
    w, h = rgb.size
    px = rgb.load()

    def diff(a, b):
        return sum(abs(u - v) for u, v in zip(a, b)) / 3.0

    col_edge = sum(diff(px[0, y], px[w - 1, y]) for y in range(h)) / h
    col_interior_vals = [diff(px[x, y], px[x + 1, y]) for y in range(h) for x in range(w - 1)]
    col_interior = sum(col_interior_vals) / len(col_interior_vals) if col_interior_vals else 0.0

    row_edge = sum(diff(px[x, 0], px[x, h - 1]) for x in range(w)) / w
    row_interior_vals = [diff(px[x, y], px[x, y + 1]) for x in range(w) for y in range(h - 1)]
    row_interior = sum(row_interior_vals) / len(row_interior_vals) if row_interior_vals else 0.0

    col_ratio = (col_edge / col_interior) if col_interior else (0.0 if col_edge == 0 else float("inf"))
    row_ratio = (row_edge / row_interior) if row_interior else (0.0 if row_edge == 0 else float("inf"))

    return {
        "col_edge": col_edge, "col_interior": col_interior, "col_ratio": col_ratio,
        "row_edge": row_edge, "row_interior": row_interior, "row_ratio": row_ratio,
    }


def _flatten_axis_drift(buf, w: int, h: int, axis: str):
    """Subtract each column's (axis='col') or row's (axis='row') deviation
    of mean luma from the whole tile's mean luma -- a per-column/row
    luminance OFFSET, clamped, alpha untouched. This removes the DC bias a
    column/row carries while leaving every pixel's deviation from its own
    column/row mean exactly as it was (offset is constant per column/row, so
    it cancels out of that deviation) -- i.e. it kills the low-frequency
    drift that causes banding without touching high-frequency texture.
    """
    if axis == "col":
        lines = range(w)

        def get(i, j):
            return buf[j][i]

        def set_(i, j, v):
            buf[j][i] = v

        other = h
    else:
        lines = range(h)

        def get(i, j):
            return buf[i][j]

        def set_(i, j, v):
            buf[i][j] = v

        other = w

    means = []
    for i in lines:
        s = sum(_luma(get(i, j)[0], get(i, j)[1], get(i, j)[2]) for j in range(other))
        means.append(s / other)
    global_mean = sum(means) / len(means)

    for i in lines:
        offset = global_mean - means[i]
        if offset == 0:
            continue
        for j in range(other):
            px4 = get(i, j)
            set_(i, j, [min(255.0, max(0.0, c + offset)) for c in px4[:3]] + [px4[3]])


def _eased_edge_blend(img: Image.Image, band: int = DEFAULT_BAND) -> Image.Image:
    """Offset-wrap the tile by half in x/y, feather the (now centered) seam
    across `band` px on each axis, then wrap back so the tile keeps its
    original framing.

    The feather is a cross-dissolve of REAL texture pulled from both sides of
    the seam (not a two-point gradient between two fixed anchor pixels): each
    band pixel blends a sample stretched in from the left/top exterior with a
    sample stretched in from the right/bottom exterior, weighted by an eased
    (smoothstep) curve. At the two ends of the band the weight is exactly 0
    or 1, so the band matches its untouched neighbour pixel-for-pixel there
    (no new hard edge introduced) while still carrying genuine texture/noise
    across the middle of the band instead of flattening it into a gradient.
    Pixels further than `band/2` from the wrap edges are left byte-identical.

    Unlike an earlier round, this does NOT force the two wrap-edge columns
    (or rows) to become exactly equal -- doing that makes them byte-
    identical, which reads as a doubled column/row when the tile repeats.
    `repair_seam` only calls this when `edge_interior_gradient` says the
    edge-crossing step is still clearly abnormal after the drift flatten.
    """
    rgba = img.convert("RGBA")
    w, h = rgba.size
    src = rgba.load()
    ox, oy = w // 2, h // 2

    # Offset-wrap: rolled[y][x] = src[(x-ox) mod w, (y-oy) mod h].
    # This relocates the original wrap-edge discontinuity to the centre.
    rolled = [[list(src[(x - ox) % w, (y - oy) % h]) for x in range(w)] for y in range(h)]
    snapshot = [row[:] for row in rolled]  # pristine copy: real texture source for both sides

    half = max(1, band // 2)

    # --- vertical seam band (columns around ox) -----------------------
    lo, hi = ox - half, ox + half
    n = hi - lo
    for y in range(h):
        for i in range(n):
            idx = (lo + i) % w
            t = i / (n - 1) if n > 1 else 0.5
            weight = _smoothstep(t)
            j = n - 1 - i
            left_src = snapshot[y][(lo - 1 - i) % w]
            right_src = snapshot[y][(hi + j) % w]
            rolled[y][idx] = [(1 - weight) * l + weight * r for l, r in zip(left_src, right_src)]

    # --- horizontal seam band (rows around oy) -------------------------
    lo, hi = oy - half, oy + half
    n = hi - lo
    for x in range(w):
        for i in range(n):
            idx = (lo + i) % h
            t = i / (n - 1) if n > 1 else 0.5
            weight = _smoothstep(t)
            j = n - 1 - i
            top_src = snapshot[(lo - 1 - i) % h][x]
            bottom_src = snapshot[(hi + j) % h][x]
            rolled[idx][x] = [(1 - weight) * top_v + weight * bot_v for top_v, bot_v in zip(top_src, bottom_src)]

    # Wrap back: out[y][x] = rolled[(y+oy) mod h][(x+ox) mod w].
    out = Image.new("RGBA", (w, h))
    out_px = out.load()
    for y in range(h):
        for x in range(w):
            v = rolled[(y + oy) % h][(x + ox) % w]
            out_px[x, y] = tuple(int(round(min(255.0, max(0.0, c)))) for c in v)
    return out


def repair_seam(img: Image.Image, band: int = DEFAULT_BAND,
                 ratio_threshold: float = DEFAULT_EDGE_RATIO_THRESHOLD) -> Image.Image:
    """Fix tiling banding in two stages:

    1. Flatten low-frequency per-column and per-row luminance drift (see
       `_flatten_axis_drift`) -- this is the actual cause of the periodic
       banding a tiled render shows, and it preserves high-frequency texture
       exactly (a per-line constant offset cancels out of every pixel's
       deviation from its own line's mean).
    2. Only if `edge_interior_gradient` on the flattened result still shows
       an abnormal edge-crossing step (ratio above `ratio_threshold` on
       either axis) is the narrow eased cross-dissolve (`_eased_edge_blend`)
       additionally applied. Most tiles -- including the real spike floor --
       never need this second stage once the drift is gone.
    """
    rgba = img.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()
    buf = [[list(px[x, y]) for x in range(w)] for y in range(h)]

    _flatten_axis_drift(buf, w, h, axis="col")
    _flatten_axis_drift(buf, w, h, axis="row")

    flattened = Image.new("RGBA", (w, h))
    flat_px = flattened.load()
    for y in range(h):
        for x in range(w):
            v = buf[y][x]
            flat_px[x, y] = (int(round(v[0])), int(round(v[1])), int(round(v[2])), int(round(v[3])))

    grad = edge_interior_gradient(flattened)
    if grad["col_ratio"] > ratio_threshold or grad["row_ratio"] > ratio_threshold:
        return _eased_edge_blend(flattened, band=band)
    return flattened


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


def _luma(r: float, g: float, b: float) -> float:
    """Perceptual luma (BT.709 weights), 0-255 scale."""
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _mean_luma(pixels) -> float:
    """Mean perceptual luma (BT.709 weights) over an iterable of (r,g,b[,a])."""
    total = 0.0
    n = 0
    for p in pixels:
        total += _luma(p[0], p[1], p[2])
        n += 1
    return total / n if n else 0.0


def _mean_and_std(values):
    n = len(values)
    mean = sum(values) / n
    var = sum((v - mean) ** 2 for v in values) / n
    return mean, math.sqrt(var)


def _linear_to_srgb(c: float) -> float:
    c = min(1.0, max(0.0, c))
    return 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1.0 / 2.4)) - 0.055


def _lab_to_rgb_one(lab):
    """Inverse of _rgb_to_lab_one: CIE Lab (D65) -> sRGB (0-255, clamped)."""
    l, a, b = lab
    fy = (l + 16.0) / 116.0
    fx = fy + a / 500.0
    fz = fy - b / 200.0
    delta = 6.0 / 29.0

    def finv(t):
        return t ** 3 if t > delta else 3 * delta ** 2 * (t - 4.0 / 29.0)

    xn, yn, zn = 0.95047, 1.0, 1.08883
    x = xn * finv(fx)
    y = yn * finv(fy)
    z = zn * finv(fz)

    r = x * 3.2404542 + y * -1.5371385 + z * -0.4985314
    g = x * -0.9692660 + y * 1.8760108 + z * 0.0415560
    bl = x * 0.0556434 + y * -0.2040259 + z * 1.0572252

    R = round(_linear_to_srgb(r) * 255)
    G = round(_linear_to_srgb(g) * 255)
    B = round(_linear_to_srgb(bl) * 255)
    return (max(0, min(255, R)), max(0, min(255, G)), max(0, min(255, B)))


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


DEFAULT_RAMP_STEPS = 65
DEFAULT_RAMP_L_STEP = 1.0
DEFAULT_MAX_DOMINANT = 8
RAMP_HUE_TOLERANCE = 1.5  # max allowed Lab a/b drift of a ramp shade from its anchor hue


def _find_ingamut_shade(l: float, a0: float, b0: float, tolerance: float = RAMP_HUE_TOLERANCE, steps: int = 24):
    """Find an sRGB colour at lightness `l` on the hue line through (a0,b0).

    Near L=0/100 a saturated (a0,b0) falls outside the sRGB gamut; per-channel
    clamping then shifts the *achieved* hue away from the anchor (e.g. a
    near-black shade clamps to a spurious reddish tint). Instead of dropping
    that shade (which leaves gaps at exactly the extremes a low-key floor
    reference needs), this walks chroma down from 1.0x toward 0x along the
    SAME hue angle until the round-tripped colour is back within `tolerance`
    of the requested hue -- i.e. it desaturates gracefully toward grey rather
    than drifting to a wrong hue, and it always returns a value (worst case,
    fully desaturated grey at that lightness is always in gamut).
    """
    for i in range(steps + 1):
        scale = 1.0 - i / steps
        a, b = a0 * scale, b0 * scale
        rgb = _lab_to_rgb_one((l, a, b))
        achieved = _rgb_to_lab_one(rgb)
        if math.hypot(achieved[1] - a, achieved[2] - b) <= tolerance:
            return rgb
    return _lab_to_rgb_one((l, 0.0, 0.0))


def build_hue_families(ref: Image.Image, max_dominant: int = DEFAULT_MAX_DOMINANT,
                        ramp_steps: int = DEFAULT_RAMP_STEPS, l_step: float = DEFAULT_RAMP_L_STEP):
    """For each dominant colour in `ref`, synthesize a full-coverage ramp of
    darker/lighter shades at the SAME hue (graceful desaturation near the
    gamut edges instead of gaps -- see `_find_ingamut_shade`). This gives a
    tight, low-variance reference palette real headroom to preserve a
    variant's own local contrast, while every synthesized shade still sits
    within `RAMP_HUE_TOLERANCE` of one of the reference's real hue families.
    """
    dominant = build_palette(ref, max_colors=max_dominant)
    half = (ramp_steps - 1) / 2.0
    families = []
    for c in dominant:
        l0, a0, b0 = _rgb_to_lab_one(c)
        ramp = []
        for k in range(ramp_steps):
            l = min(100.0, max(0.0, l0 + (k - half) * l_step))
            rgb = _find_ingamut_shade(l, a0, b0)
            ramp.append((_luma(*rgb), rgb))
        families.append({"anchor_lab": (l0, a0, b0), "ramp": ramp})
    return families


def palette_match(img: Image.Image, ref: Image.Image) -> Image.Image:
    """Remap `img` to `ref`'s hue families (nearest hue in CIE Lab a/b,
    alpha kept), choosing a shade within that hue's synthesized value ramp
    so that: the mean luma matches `ref`'s mean luma, and each pixel's OWN
    deviation from its source image's mean luma is preserved (not crushed
    toward the reference's often much lower variance) -- this keeps a
    variant's local contrast/detail intact instead of flattening it into a
    plain-looking floor.
    """
    rgba = img.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()
    pixels = [px[x, y] for y in range(h) for x in range(w)]

    lab_src = [_rgb_to_lab_one((r, g, b)) for r, g, b, a in pixels]
    src_lumas = [_luma(r, g, b) for r, g, b, a in pixels]
    src_mean, _src_std = _mean_and_std(src_lumas)

    ref_mean = mean_luma_of_image(ref)
    families = build_hue_families(ref)

    # Pre-resolve each pixel's hue family once (it never depends on `bias`).
    pixel_families = [
        min(families, key=lambda f: (f["anchor_lab"][1] - a_src) ** 2 + (f["anchor_lab"][2] - b_src) ** 2)
        for _l_src, a_src, b_src in lab_src
    ]

    def map_at_bias(bias: float):
        out = []
        achieved = []
        for (r, g, b, a), y_src, fam in zip(pixels, src_lumas, pixel_families):
            # Preserve this pixel's own deviation from its source's mean,
            # just re-centred on the reference's mean (+ bias) -- this is
            # what keeps contrast instead of crushing it flat.
            target_y = min(255.0, max(0.0, ref_mean + bias + (y_src - src_mean)))
            best_y, best_rgb = min(fam["ramp"], key=lambda t: abs(t[0] - target_y))
            out.append((best_rgb[0], best_rgb[1], best_rgb[2], a))
            achieved.append(best_y)
        return out, achieved

    # Nearest-available-shade snapping is a per-family step function of the
    # target, so a naive single pass can land with a systematic mean offset
    # (families clip/round asymmetrically). Iteratively correct a constant
    # bias so the REALIZED mean luma actually converges on ref_mean, tracking
    # the best attempt seen in case of a small residual oscillation.
    bias = 0.0
    best_out, best_achieved = map_at_bias(bias)
    best_mean, _ = _mean_and_std(best_achieved)
    best_diff = abs(best_mean - ref_mean)
    for _ in range(8):
        if best_diff <= max(0.1, 0.005 * ref_mean):
            break
        bias += ref_mean - best_mean
        out, achieved = map_at_bias(bias)
        mean_y, _ = _mean_and_std(achieved)
        diff = abs(mean_y - ref_mean)
        if diff < best_diff:
            best_out, best_achieved, best_mean, best_diff = out, achieved, mean_y, diff

    out = Image.new("RGBA", (w, h))
    out.putdata(best_out)
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


def build_tiled_preview(img: Image.Image, reps: int = 4, scale: int = 8) -> Image.Image:
    """Tile `img` `reps`x`reps` and scale it up `scale`x (nearest-neighbour)
    -- the actual visual check for banding: does the repeated tile show a
    periodic stripe pattern at this reduced-zoom, real-render-ish scale.
    """
    rgb = img.convert("RGBA")
    w, h = rgb.size
    tiled = Image.new("RGBA", (w * reps, h * reps))
    for j in range(reps):
        for i in range(reps):
            tiled.paste(rgb, (i * w, j * h))
    return tiled.resize((tiled.width * scale, tiled.height * scale), resample=Image.NEAREST)


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

def _make_band_test_image(size=32):
    """A tile with a deliberate low-frequency per-column (and per-row)
    brightness DRIFT -- the actual cause of periodic banding when tiled --
    layered over deterministic high-frequency texture noise, so a repair
    can be checked both for killing the drift AND for keeping the texture.
    """
    img = Image.new("RGBA", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            col_drift = (x / (size - 1)) * 70.0   # 0..70 across columns
            row_drift = (y / (size - 1)) * 40.0   # 0..40 across rows
            noise = ((x * 13 + y * 29) % 17) - 8  # deterministic +/-8 texture
            v = 90.0 + col_drift + row_drift + noise
            v = max(0, min(255, int(round(v))))
            px[x, y] = (v, v, v, 255)
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


def _make_low_variance_ref(size=16):
    """Mimics the real spike floor: a narrow cluster of near-black umber
    shades (deterministic pattern, no randomness, so the test is stable).
    """
    ref = Image.new("RGB", (size, size))
    ref_px = ref.load()
    shades = [(40, 34, 28), (44, 38, 32), (38, 33, 27)]
    for y in range(size):
        for x in range(size):
            ref_px[x, y] = shades[(x * 7 + y * 3) % len(shades)]
    return ref


def _make_detailed_variant(size=16):
    """A pale/warm variant with real local contrast (like a stamped decal) --
    the kind of source that previously got crushed flat by a low-variance ref.
    """
    src = Image.new("RGBA", (size, size))
    src_px = src.load()
    for y in range(size):
        for x in range(size):
            base = 150 + 40 * ((x + y) % 3)
            r = min(255, base + 40)
            g = min(255, base + 10)
            b = max(0, base - 30)
            src_px[x, y] = (r, g, b, 255)
    return src


def _texture_std(img: Image.Image):
    """Std of each pixel's luma deviation from a two-way (column mean + row
    mean - global mean) baseline -- the high-frequency texture component,
    with BOTH the low-frequency column drift and the low-frequency row
    drift factored out (not just one axis, so a repair that flattens both
    axes isn't unfairly penalized for "losing" what was actually the other
    axis's drift, not real texture). Used to check a repair preserves
    texture rather than just flattening everything.
    """
    rgb = img.convert("RGB")
    w, h = rgb.size
    px = rgb.load()
    col_means = [sum(_luma(*px[x, y]) for y in range(h)) / h for x in range(w)]
    row_means = [sum(_luma(*px[x, y]) for x in range(w)) / w for y in range(h)]
    global_mean = sum(col_means) / w
    residuals = [
        _luma(*px[x, y]) - col_means[x] - row_means[y] + global_mean
        for x in range(w) for y in range(h)
    ]
    _m, std = _mean_and_std(residuals)
    return std


def selftest() -> bool:
    ok = True

    # --- band scoring / repair ----------------------------------------------
    band_img = _make_band_test_image()
    w0, h0 = band_img.size
    band_before = band_score(band_img)
    grad_before = edge_interior_gradient(band_img)
    texture_before = _texture_std(band_img)
    print(f"[selftest] band_score before repair: col={band_before[0]:.3f} row={band_before[1]:.3f}")
    print(f"[selftest] edge/interior ratio before: col={grad_before['col_ratio']:.2f} row={grad_before['row_ratio']:.2f}")

    if not (max(band_before) > 15.0):
        print("  FAIL: expected the deliberate column/row drift to score high on band_score (>15)")
        ok = False
    else:
        print("  OK: deliberately drifted image scores high on band_score")

    repaired = repair_seam(band_img, band=DEFAULT_BAND)
    band_after = band_score(repaired)
    grad_after = edge_interior_gradient(repaired)
    texture_after = _texture_std(repaired)
    print(f"[selftest] band_score after repair:  col={band_after[0]:.3f} row={band_after[1]:.3f}")
    print(f"[selftest] edge/interior ratio after:  col={grad_after['col_ratio']:.2f} row={grad_after['row_ratio']:.2f}")

    if not (band_after[0] < band_before[0] * 0.3 and band_after[1] < band_before[1] * 0.3):
        print("  FAIL: expected band_score to drop substantially (< 30% of original) on both axes")
        ok = False
    else:
        print("  OK: band_score dropped substantially on both axes")

    texture_ratio = (texture_after / texture_before) if texture_before else 1.0
    print(f"[selftest] texture std before {texture_before:.3f}  after {texture_after:.3f}  "
          f"ratio {texture_ratio * 100:.1f}%")
    if texture_ratio < 0.80:
        print("  FAIL: high-frequency texture std dropped below 80% of original (over-smoothed)")
        ok = False
    else:
        print("  OK: high-frequency texture mostly preserved (>=80%)")

    px_in = band_img.load()
    px_out = repaired.load()
    input_edges_identical = all(px_in[0, y] == px_in[w0 - 1, y] for y in range(h0))
    output_edges_identical = all(px_out[0, y] == px_out[w0 - 1, y] for y in range(h0))
    if output_edges_identical and not input_edges_identical:
        print("  FAIL: repair forced edge columns to become byte-identical (doubled-column bug)")
        ok = False
    else:
        print("  OK: repair did not force edge columns to become identical")

    # A previous round's bug forced seam_score to exactly 0 by making the
    # edge columns/rows literally identical. Guard against that regressing:
    # the legacy score should be low-ish but not suspiciously exactly zero
    # given this fixture still has real texture noise crossing the edge.
    legacy_after = seam_score(repaired)
    print(f"[selftest] legacy seam_score after repair: {legacy_after:.3f}")
    if legacy_after == 0.0:
        print("  FAIL: legacy seam_score is exactly 0 -- likely an edge-equality bug, not a real repair")
        ok = False
    else:
        print("  OK: legacy seam_score is nonzero (edges are similar, not forced-identical)")

    # --- palette matching (well-separated palette, sanity baseline) --------
    src, ref = _make_palette_test_images()
    families = build_hue_families(ref)
    ramp_colors = {rgb for f in families for _y, rgb in f["ramp"]}
    matched = palette_match(src, ref)
    matched_rgb_data = list(_iter_pixels(matched))
    unique_pixels = set(matched_rgb_data)

    print(f"[selftest] ramp-derived colours available: {len(ramp_colors)}")
    print(f"[selftest] matched output colours: {sorted(unique_pixels)}")

    if not unique_pixels.issubset(ramp_colors):
        print("  FAIL: matched output uses colours outside ref's hue-family ramps")
        ok = False
    else:
        print("  OK: matched output uses only ref-derived hue-family colours")

    target_luma = mean_luma_of_image(ref)
    out_luma = _mean_luma(matched_rgb_data)
    rel_diff = abs(out_luma - target_luma) / target_luma if target_luma else 0.0
    print(f"[selftest] ref luma: {target_luma:.3f}  matched luma: {out_luma:.3f}  rel diff: {rel_diff * 100:.2f}%")

    if rel_diff > 0.03 + 1e-9:
        print("  FAIL: matched luminance not within 3% of ref")
        ok = False
    else:
        print("  OK: matched luminance within 3% of ref")

    # --- palette matching (LOW-VARIANCE ref, like the real spike floor) ----
    # This is the case the review flagged: a real floor's own palette spans
    # very few luma units, so naive nearest-colour matching crushes a
    # detailed variant flat. Assert contrast survives via the value ramps.
    low_ref = _make_low_variance_ref()
    detailed_src = _make_detailed_variant()

    src_lumas = [_luma(*p[:3]) for p in _iter_pixels(detailed_src)]
    src_mean, src_std = _mean_and_std(src_lumas)

    matched2 = palette_match(detailed_src, low_ref)
    matched2_lumas = [_luma(*p[:3]) for p in _iter_pixels(matched2)]
    m_mean, m_std = _mean_and_std(matched2_lumas)
    ref_mean2 = mean_luma_of_image(low_ref)

    mean_rel_diff = abs(m_mean - ref_mean2) / ref_mean2 if ref_mean2 else 0.0
    std_ratio = (m_std / src_std) if src_std else 1.0

    print(f"[selftest] low-variance ref mean luma: {ref_mean2:.3f}")
    print(f"[selftest] detailed source: mean {src_mean:.3f} std {src_std:.3f}")
    print(f"[selftest] matched (low-var ref): mean {m_mean:.3f} std {m_std:.3f}  "
          f"mean rel diff {mean_rel_diff * 100:.2f}%  std ratio {std_ratio * 100:.1f}%")

    if mean_rel_diff > 0.03 + 1e-9:
        print("  FAIL: matched mean luma not within 3% of a low-variance ref")
        ok = False
    else:
        print("  OK: matched mean luma within 3% of a low-variance ref")

    if std_ratio < 0.60 - 1e-9:
        print("  FAIL: matched std below 60% of source std (contrast crushed)")
        ok = False
    else:
        print("  OK: matched std retains >=60% of source std (contrast preserved)")

    # Hue check: compare HUE ANGLE (atan2(b,a)), not raw a/b distance, since a
    # legitimately desaturated near-black/near-white shade has small a,b by
    # design (see _find_ingamut_shade) -- that's graceful desaturation, not
    # hue drift. Near-neutral output pixels (negligible chroma) have no
    # meaningful hue to compare and trivially pass.
    low_families = build_hue_families(low_ref)
    family_angles = [math.atan2(f["anchor_lab"][2], f["anchor_lab"][1]) for f in low_families]
    NEUTRAL_CHROMA = 3.0
    max_hue_angle_deg = 0.0
    for p in _iter_pixels(matched2):
        l_out, a_out, b_out = _rgb_to_lab_one(p[:3])
        chroma = math.hypot(a_out, b_out)
        if chroma < NEUTRAL_CHROMA:
            continue
        angle = math.atan2(b_out, a_out)
        diff_deg = min(math.degrees(abs(math.atan2(math.sin(angle - fa), math.cos(angle - fa)))) for fa in family_angles)
        max_hue_angle_deg = max(max_hue_angle_deg, diff_deg)
    print(f"[selftest] max hue-angle drift from any (non-neutral) output pixel to its nearest ref hue family: {max_hue_angle_deg:.1f} deg")

    if max_hue_angle_deg > 20.0:
        print("  FAIL: some output pixels drifted to a different hue family")
        ok = False
    else:
        print("  OK: every non-neutral output pixel stays in one of ref's hue families")

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
    p_seam.add_argument("--band", type=int, default=DEFAULT_BAND)
    p_seam.add_argument("--threshold", type=float, default=DEFAULT_BAND_THRESHOLD)
    p_seam.add_argument("--ratio-threshold", type=float, default=DEFAULT_EDGE_RATIO_THRESHOLD)

    p_match = sub.add_parser("match")
    p_match.add_argument("input")
    p_match.add_argument("output")
    p_match.add_argument("--ref", required=True)

    p_sheet = sub.add_parser("sheet")
    p_sheet.add_argument("input_dir")
    p_sheet.add_argument("output")

    p_preview = sub.add_parser("preview")
    p_preview.add_argument("input")
    p_preview.add_argument("output")
    p_preview.add_argument("--reps", type=int, default=4)
    p_preview.add_argument("--scale", type=int, default=8)

    sub.add_parser("selftest")

    args = parser.parse_args(argv)

    if args.cmd == "selftest":
        passed = selftest()
        sys.exit(0 if passed else 1)

    elif args.cmd == "seam":
        img = Image.open(args.input)
        band_before = band_score(img)
        grad_before = edge_interior_gradient(img)
        legacy_before = seam_score(img)

        def _report(label, band_vals, grad, legacy):
            print(f"band_score {label}: col={band_vals[0]:.3f} row={band_vals[1]:.3f}")
            print(f"edge/interior ratio {label}: col={grad['col_ratio']:.2f} "
                  f"(edge {grad['col_edge']:.3f} / interior {grad['col_interior']:.3f})  "
                  f"row={grad['row_ratio']:.2f} (edge {grad['row_edge']:.3f} / interior {grad['row_interior']:.3f})")
            print(f"(legacy seam_score {label}: {legacy:.3f})")

        if args.repair:
            out_img = repair_seam(img, band=args.band, ratio_threshold=args.ratio_threshold)
            band_after = band_score(out_img)
            grad_after = edge_interior_gradient(out_img)
            legacy_after = seam_score(out_img)
            out_img.save(args.output)
            _report("before", band_before, grad_before, legacy_before)
            _report("after ", band_after, grad_after, legacy_after)
            max_after = max(band_after)
            status = "OK" if max_after <= args.threshold else "WARN"
            print(f"{status}: band_score after (max axis) {max_after:.3f} vs threshold {args.threshold}")
        else:
            # No repair ran -- report only the single measured state, not a
            # fabricated "after" as if a repair had happened.
            out_img = img
            out_img.save(args.output)
            _report("", band_before, grad_before, legacy_before)
            max_before = max(band_before)
            status = "OK" if max_before <= args.threshold else "WARN"
            print(f"{status}: band_score (max axis) {max_before:.3f} vs threshold {args.threshold}")

    elif args.cmd == "match":
        img = Image.open(args.input)
        ref = Image.open(args.ref)

        src_lumas = [_luma(*p[:3]) for p in _iter_pixels(img)]
        before_mean, before_std = _mean_and_std(src_lumas)

        out_img = palette_match(img, ref)

        out_lumas = [_luma(*p[:3]) for p in _iter_pixels(out_img)]
        after_mean, after_std = _mean_and_std(out_lumas)
        ref_mean = mean_luma_of_image(ref)

        out_img.save(args.output)
        std_ratio = (after_std / before_std * 100.0) if before_std else 100.0
        mean_diff_pct = (abs(after_mean - ref_mean) / ref_mean * 100.0) if ref_mean else 0.0
        print(f"luma before: mean {before_mean:.3f}  std {before_std:.3f}")
        print(f"luma after:  mean {after_mean:.3f}  std {after_std:.3f}")
        print(f"ref luma:    mean {ref_mean:.3f}")
        print(f"mean diff vs ref: {mean_diff_pct:.2f}%   std retained: {std_ratio:.1f}% of source")

    elif args.cmd == "sheet":
        sheet = build_contact_sheet(args.input_dir)
        sheet.save(args.output)
        print(f"wrote contact sheet to {args.output}")

    elif args.cmd == "preview":
        img = Image.open(args.input)
        preview = build_tiled_preview(img, reps=args.reps, scale=args.scale)
        preview.save(args.output)
        print(f"wrote {args.reps}x{args.reps} tiled preview at {args.scale}x to {args.output} "
              f"({preview.width}x{preview.height})")


if __name__ == "__main__":
    main()
