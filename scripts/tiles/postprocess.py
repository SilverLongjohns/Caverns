#!/usr/bin/env python3
"""Terrain tile post-processing: seam scoring/repair and palette matching.

Pure python3 + Pillow (no numpy dependency, per env rules).

Usage:
  python3 scripts/tiles/postprocess.py seam <in.png> [--repair] [--band 4] [--threshold 3.0] <out.png>
  python3 scripts/tiles/postprocess.py match <in.png> --ref <floor.png> <out.png>
  python3 scripts/tiles/postprocess.py cutout <in.png> [--tolerance 12] [--border 1] [--feather 0] <out.png>
  python3 scripts/tiles/postprocess.py cleanalpha <in.png> [--threshold 128] [--min-speck 3] [--min-hole 3] <out.png>
  python3 scripts/tiles/postprocess.py grade <in.png> --sample <sample.png> --ref <ref.png> <out.png>
  python3 scripts/tiles/postprocess.py fill <in.png> [--amplitude 6] [--inset 8] [--seed 0] [--repair] <out.png>
  python3 scripts/tiles/postprocess.py sheet <dir> <out.png>
  python3 scripts/tiles/postprocess.py preview <in.png> [--reps 4] [--scale 8] <out.png>
  python3 scripts/tiles/postprocess.py selftest
"""

import argparse
import math
import os
import random
import sys
from collections import deque

from PIL import Image, ImageDraw, ImageFont

DEFAULT_BAND = 4  # px cross-fade band used by _eased_edge_blend (controller ruling R4: 4, not the brief's 8)
DEFAULT_THRESHOLD = 18.0  # legacy seam_score threshold (kept for the `seam` CLI's reference line)
DEFAULT_BAND_THRESHOLD = 1.0  # band_score (per-axis std of column/row mean luma) threshold
DEFAULT_EDGE_RATIO_THRESHOLD = 1.6  # edge-crossing gradient vs interior gradient: above this, blend the edge
DEFAULT_CUTOUT_TOLERANCE = 12.0  # Lab distance from a border colour cluster, below which a pixel is background
DEFAULT_CUTOUT_BORDER = 1  # px ring sampled to find the border's dominant colour(s)
DEFAULT_CUTOUT_FEATHER = 0  # px soft-edge radius applied to the cutout alpha mask (off by default --
                             # a feather ramp leaves semi-transparent fringe pixels, which read as
                             # sloppy/anti-aliased blur in pixel art rather than a clean cut; use
                             # `cleanalpha` to binarize + tidy the edge instead)
DEFAULT_CLEAN_THRESHOLD = 128  # alpha binarize threshold: >= this -> 255, else 0
DEFAULT_CLEAN_MIN_SPECK = 3  # opaque connected components smaller than this (px), other than the
                              # main subject, are removed as stray specks
DEFAULT_CLEAN_MIN_HOLE = 3  # transparent connected components smaller than this (px) that are fully
                             # enclosed (don't touch the image border) are filled in as pinholes
DEFAULT_GRADE_CHROMA_CLAMP = (0.3, 1.5)  # sanity clamp on the derived chroma_scale
DEFAULT_GRADE_L_OFFSET_CLAMP = 40.0  # sanity clamp (abs) on the derived L offset
DEFAULT_FILL_AMPLITUDE = 6.0  # +/- per-pixel luma jitter (deterministic) layered over the flat base
DEFAULT_FILL_INSET = 8  # px inset defining the centre sample box used as the flat base colour
DEFAULT_FILL_SEED = 0  # seed for the deterministic per-pixel noise (same seed -> same output)


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
# Solid-fill rebuild (mask-15 "fully surrounded" tile -- see fill_tile)
# ---------------------------------------------------------------------------

def fill_tile(img: Image.Image, amplitude: float = DEFAULT_FILL_AMPLITUDE, inset: int = DEFAULT_FILL_INSET,
              seed: int = DEFAULT_FILL_SEED) -> Image.Image:
    """Rebuilds a seamless solid-fill tile from `img`'s OWN interior colour, for a set's mask-15
    tile (the vertex where all four corners are the same upper terrain, e.g. the middle of a wide
    chasm band or a big pool) -- these are the only corner-set tiles that get placed edge-to-edge
    against COPIES OF THEMSELVES many times in a row/column, so any baked decal (a lighter rim
    around a darker "pit", as the raw generated chasm/water mask-15 tiles have) repeats at the tile
    period and reads as an obvious grate/lattice lawn once tiled -- see the review evidence
    (.sandbox/terrain-art/shot-3.png: a 3-wide chasm band shows a clear grid of pit+rim squares).

    The fix is NOT a new generation (zero PixelLab spend): it samples `img`'s own deep-interior
    colour (a small inset box at the tile centre, away from any rim near the edges) as a flat base,
    then lays deterministic low-amplitude per-pixel luma jitter over the WHOLE tile (same jitter
    added to all three channels, so hue is preserved exactly -- this is what keeps chasm reading as
    near-black void and water as its own dark teal, "a subtle teal texture", rather than introducing
    a new colour). Alpha is copied from the same interior sample (these tiles have no transparency).

    No blob, no decal, no directional gradient -- every pixel is independently jittered from the
    same base, so there is nothing FOR the tile period to expose as a repeating shape; `repair_seam`
    (called separately, same as any other tile) additionally guards against any residual low-
    frequency drift the noise might have introduced by chance.
    """
    rgba = img.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()

    cx0, cy0 = min(inset, w // 2 - 1), min(inset, h // 2 - 1)
    cx1, cy1 = max(w - inset, cx0 + 2), max(h - inset, cy0 + 2)
    samples = [px[x, y] for y in range(cy0, cy1) for x in range(cx0, cx1)]
    base = tuple(sum(s[i] for s in samples) / len(samples) for i in range(3))
    base_alpha = round(sum(s[3] for s in samples) / len(samples))

    rng = random.Random(seed)
    out = Image.new("RGBA", (w, h))
    out_px = out.load()
    for y in range(h):
        for x in range(w):
            jitter = rng.uniform(-amplitude, amplitude)
            out_px[x, y] = tuple(
                int(round(min(255.0, max(0.0, base[c] + jitter)))) for c in range(3)
            ) + (base_alpha,)
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
# Background cutout (border-connected flood fill in Lab space)
# ---------------------------------------------------------------------------

def _lab_dist(a, b) -> float:
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


def _cluster_border_labs(border_labs, cluster_tolerance: float = 6.0, min_share: float = 0.05):
    """Greedy single-pass clustering of border pixel Lab values into a small set of dominant
    background colours (a plain background gives one cluster; an outlined/vignetted border can
    give two or three). Clusters covering less than `min_share` of the border are dropped as
    noise (stray subject pixels that happen to touch the edge)."""
    clusters = []  # each: [lab (running mean), count]
    for lab in border_labs:
        best = None
        best_d = None
        for c in clusters:
            d = _lab_dist(lab, c[0])
            if best_d is None or d < best_d:
                best, best_d = c, d
        if best is not None and best_d <= cluster_tolerance:
            n = best[1]
            best[0] = [(best[0][i] * n + lab[i]) / (n + 1) for i in range(3)]
            best[1] = n + 1
        else:
            clusters.append([list(lab), 1])

    total = sum(c[1] for c in clusters)
    kept = [tuple(c[0]) for c in clusters if total and c[1] / total >= min_share]
    return kept if kept else [tuple(clusters[0][0])]


ALL_SIDES = ("top", "bottom", "left", "right")


def _border_ring_coords(w, h, border, sides):
    for y in range(h):
        for x in range(w):
            if ("top" in sides and y < border) or ("bottom" in sides and y >= h - border) \
                    or ("left" in sides and x < border) or ("right" in sides and x >= w - border):
                yield x, y


def _on_selected_border(x, y, w, h, sides):
    return (("top" in sides and y == 0) or ("bottom" in sides and y == h - 1)
            or ("left" in sides and x == 0) or ("right" in sides and x == w - 1))


def _connected_components(mask, w, h):
    """4-connected components of True cells in `mask` (a list-of-lists of bool). Returns a list
    of pixel-coordinate lists, one per component."""
    seen = [[False] * w for _ in range(h)]
    components = []
    for sy in range(h):
        for sx in range(w):
            if not mask[sy][sx] or seen[sy][sx]:
                continue
            comp = []
            seen[sy][sx] = True
            q = deque([(sx, sy)])
            while q:
                x, y = q.popleft()
                comp.append((x, y))
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if 0 <= nx < w and 0 <= ny < h and mask[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True
                        q.append((nx, ny))
            components.append(comp)
    return components


def cleanalpha(img: Image.Image, threshold: float = DEFAULT_CLEAN_THRESHOLD,
               min_speck: int = DEFAULT_CLEAN_MIN_SPECK, min_hole: int = DEFAULT_CLEAN_MIN_HOLE) -> Image.Image:
    """Tidies a cutout's alpha channel for pixel art, where partial alpha reads as an anti-aliased
    smear rather than a clean cut:

    1. Binarizes alpha: every pixel becomes fully opaque (255) or fully transparent (0), split at
       `threshold`. No pixel keeps a partial value.
    2. Removes stray opaque specks: 4-connected opaque components smaller than `min_speck` px,
       other than the single largest opaque component (the main subject, always kept regardless of
       its own size), are cut to transparent.
    3. Fills small enclosed transparent pinholes: 4-connected transparent components smaller than
       `min_hole` px that do NOT touch the image border (so they're holes IN the subject, not the
       real surrounding background) are filled opaque, coloured by the mean RGB of the opaque
       pixels immediately orthogonally adjacent to the hole.

    Colour channels of already-opaque, already-large-enough pixels are left untouched.
    """
    rgba = img.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()

    opaque = [[px[x, y][3] >= threshold for x in range(w)] for y in range(h)]

    # --- 2. remove stray opaque specks ---------------------------------------------------------
    opaque_components = _connected_components(opaque, w, h)
    if opaque_components:
        main = max(opaque_components, key=len)
        for comp in opaque_components:
            if comp is main:
                continue
            if len(comp) < min_speck:
                for x, y in comp:
                    opaque[y][x] = False

    # --- 3. fill small enclosed transparent pinholes -------------------------------------------
    transparent = [[not opaque[y][x] for x in range(w)] for y in range(h)]
    transparent_components = _connected_components(transparent, w, h)
    fills = {}  # (x, y) -> RGB fill colour
    for comp in transparent_components:
        touches_border = any(x == 0 or x == w - 1 or y == 0 or y == h - 1 for x, y in comp)
        if touches_border or len(comp) >= min_hole:
            continue
        comp_set = set(comp)
        neighbour_rgbs = []
        for x, y in comp:
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in comp_set and opaque[ny][nx]:
                    neighbour_rgbs.append(px[nx, ny][:3])
        if not neighbour_rgbs:
            continue  # fully isolated hole with no opaque rim (shouldn't happen for a real hole)
        n = len(neighbour_rgbs)
        fill_rgb = (
            round(sum(c[0] for c in neighbour_rgbs) / n),
            round(sum(c[1] for c in neighbour_rgbs) / n),
            round(sum(c[2] for c in neighbour_rgbs) / n),
        )
        for x, y in comp:
            fills[(x, y)] = fill_rgb
            opaque[y][x] = True

    out = Image.new("RGBA", (w, h))
    out_px = out.load()
    for y in range(h):
        for x in range(w):
            if not opaque[y][x]:
                out_px[x, y] = (0, 0, 0, 0)
            elif (x, y) in fills:
                r, g, b = fills[(x, y)]
                out_px[x, y] = (r, g, b, 255)
            else:
                r, g, b, _a = px[x, y]
                out_px[x, y] = (r, g, b, 255)
    return out


def cutout(img: Image.Image, tolerance: float = DEFAULT_CUTOUT_TOLERANCE,
           border: int = DEFAULT_CUTOUT_BORDER, feather: int = DEFAULT_CUTOUT_FEATHER,
           sides=ALL_SIDES, keep_dark_l=None, clean: bool = True,
           min_speck: int = DEFAULT_CLEAN_MIN_SPECK, min_hole: int = DEFAULT_CLEAN_MIN_HOLE) -> Image.Image:
    """Removes the background of an opaque square tile, leaving the subject on transparency.

    1. Samples the outer `border`-px ring to find the dominant background colour(s) (clustered
       in Lab space -- handles a border with more than one background shade).
    2. Flood-fills from every border pixel whose colour is within `tolerance` (Lab distance) of
       one of those clusters, walking only through orthogonally-adjacent pixels that are ALSO
       within tolerance. Only background reachable from the edge this way is removed, so an
       enclosed subject-coloured hole or an interior fleck that happens to match the background
       colour but isn't connected to the border is left alone.
    3. Feathers the resulting hard alpha edge by `feather` px (a Gaussian blur of the alpha mask,
       then `min()` with the original alpha -- this only ever softens the cut, never adds a halo
       by raising alpha beyond what a pixel already had).

    `sides` restricts which edges of the tile are trusted as "known background" for sampling AND
    seeding the flood fill (default: all four). Use this for a tile whose subject is DESIGNED to
    reach some edges on purpose (e.g. a bridge segment meant to tile seamlessly along its span
    axis) -- e.g. `sides=("top","bottom")` for a horizontally-spanning bridge, so the subject's
    own colour touching the left/right edges is never mistaken for background.

    `keep_dark_l`, if given, is a Lab L threshold below which a pixel is NEVER classified as
    background, no matter its Lab distance to a border cluster and no matter whether it touches
    the border. This is for a subject whose own interior is intentionally a near-black void (e.g.
    a doorway opening onto darkness) that happens to touch the tile edge (since it recedes "off
    tile") -- without this, that void gets sampled into the border colour clusters and the whole
    connected dark region is flood-filled away as if it were background, leaving a hole that shows
    the art BEHIND the stamp instead of the void the artist actually painted.

    `clean`, if true (the default), runs `cleanalpha` on the result before returning -- binarizes
    alpha (no partial/fringe pixels), drops stray opaque specks and fills small enclosed pinholes.
    `feather` defaults to 0 (off): a soft alpha ramp reads as an anti-aliased smear in pixel art,
    not a clean cut, so it's opt-in only; `clean` is the intended way to tidy an edge now.
    """
    rgba = img.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()

    lab_grid = [[_rgb_to_lab_one(px[x, y][:3]) for x in range(w)] for y in range(h)]

    border_labs = [lab_grid[y][x] for x, y in _border_ring_coords(w, h, border, sides)]
    bg_labs = _cluster_border_labs(border_labs)

    def is_bg(lab) -> bool:
        if keep_dark_l is not None and lab[0] <= keep_dark_l:
            return False
        return min(_lab_dist(lab, bl) for bl in bg_labs) <= tolerance

    remove = [[False] * w for _ in range(h)]
    q = deque()
    for y in range(h):
        for x in range(w):
            on_border = _on_selected_border(x, y, w, h, sides)
            if on_border and not remove[y][x] and is_bg(lab_grid[y][x]):
                remove[y][x] = True
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h and not remove[ny][nx] and is_bg(lab_grid[ny][nx]):
                remove[ny][nx] = True
                q.append((nx, ny))

    out = Image.new("RGBA", (w, h))
    out_px = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            out_px[x, y] = (r, g, b, 0 if remove[y][x] else a)

    if feather > 0:
        # Bounded multi-source BFS distance (capped at `feather`) from removed pixels, into the
        # KEPT side only. Only kept pixels within `feather` px of the cut get a linear alpha
        # ramp; everything deeper than that stays byte-identical to the un-feathered cutout. This
        # is deliberately NOT a whole-image Gaussian blur -- a blur's effective spread is wider
        # than its `radius` parameter and was eating well into small subjects/flecks.
        inf = feather + 1
        dist = [[inf] * w for _ in range(h)]
        dq = deque()
        for y in range(h):
            for x in range(w):
                if remove[y][x]:
                    dist[y][x] = 0
                    dq.append((x, y))
        while dq:
            x, y = dq.popleft()
            d = dist[y][x]
            if d >= feather:
                continue
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < w and 0 <= ny < h and dist[ny][nx] > d + 1:
                    dist[ny][nx] = d + 1
                    dq.append((nx, ny))

        out_px = out.load()
        for y in range(h):
            for x in range(w):
                if remove[y][x]:
                    continue
                d = dist[y][x]
                if d > feather:
                    continue
                factor = d / (feather + 1)
                r, g, b, a = out_px[x, y]
                out_px[x, y] = (r, g, b, int(round(a * factor)))

    if clean:
        out = cleanalpha(out, min_speck=min_speck, min_hole=min_hole)

    return out


def cutout_removed_fraction(img: Image.Image, tolerance: float = DEFAULT_CUTOUT_TOLERANCE,
                             border: int = DEFAULT_CUTOUT_BORDER, sides=ALL_SIDES) -> float:
    """Fraction of border-ring pixels classified as background (diagnostic for the CLI/report)."""
    rgba = img.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()
    ring = list(_border_ring_coords(w, h, border, sides))
    labs = [_rgb_to_lab_one(px[x, y][:3]) for x, y in ring]
    bg_labs = _cluster_border_labs(labs)
    hits = sum(1 for lab in labs if min(_lab_dist(lab, bl) for bl in bg_labs) <= tolerance)
    return hits / len(labs) if labs else 0.0


# ---------------------------------------------------------------------------
# Global grade (uniform Lab luminance offset + chroma scale vs a reference)
# ---------------------------------------------------------------------------

def mean_lab_l_chroma(img: Image.Image):
    """Mean (L, chroma) over every pixel of `img`, chroma = hypot(a, b) in CIE Lab."""
    labs = [_rgb_to_lab_one(p) for p in _iter_pixels(img)]
    n = len(labs)
    l_mean = sum(l for l, _a, _b in labs) / n
    c_mean = sum(math.hypot(a, b) for _l, a, b in labs) / n
    return l_mean, c_mean


def compute_grade(sample_img: Image.Image, ref_img: Image.Image):
    """Derives ONE (l_offset, chroma_scale) transform from comparing `sample_img`'s mean Lab
    (L, chroma) against `ref_img`'s -- meant to be computed ONCE from a single representative
    sample (e.g. the plain floor tile) against a reference mockup/crop, then applied IDENTICALLY
    to every tile in a terrain family via `apply_grade`. This is deliberately not a per-tile
    `palette_match`: it preserves each tile's own hue and relative identity (water stays teal,
    chasm stays near-black) while uniformly shifting the whole family's tone, so transitions
    between rock/water/chasm/floor-variants stay consistent with each other."""
    l_cur, c_cur = mean_lab_l_chroma(sample_img)
    l_ref, c_ref = mean_lab_l_chroma(ref_img)
    l_offset = max(-DEFAULT_GRADE_L_OFFSET_CLAMP, min(DEFAULT_GRADE_L_OFFSET_CLAMP, l_ref - l_cur))
    raw_scale = (c_ref / c_cur) if c_cur > 1e-6 else 1.0
    chroma_scale = max(DEFAULT_GRADE_CHROMA_CLAMP[0], min(DEFAULT_GRADE_CHROMA_CLAMP[1], raw_scale))
    return {
        "l_offset": l_offset, "chroma_scale": chroma_scale,
        "l_cur": l_cur, "c_cur": c_cur, "l_ref": l_ref, "c_ref": c_ref,
        "raw_chroma_scale": raw_scale,
    }


def apply_grade(img: Image.Image, grade) -> Image.Image:
    """Applies a `compute_grade` transform to every pixel of `img` (alpha untouched): a uniform
    Lab L offset (additive, clamped to [0, 100]) and a's/b's uniform scale by `chroma_scale`
    (same hue angle, just less/more saturated)."""
    rgba = img.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()
    out = Image.new("RGBA", (w, h))
    out_px = out.load()
    l_offset = grade["l_offset"]
    cs = grade["chroma_scale"]
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            l, aa, bb = _rgb_to_lab_one((r, g, b))
            l2 = min(100.0, max(0.0, l + l_offset))
            r2, g2, b2 = _lab_to_rgb_one((l2, aa * cs, bb * cs))
            out_px[x, y] = (r2, g2, b2, a)
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

    # --- cutout (background removal) ----------------------------------------
    # Fixture: a flat-ish (small deterministic noise) background filling a tile, with a solid,
    # sharp-edged subject square in the middle in a clearly different hue -- mirrors a stamp
    # tile (background colour + isolated subject).
    size = 32
    lo, hi = 8, size - 8
    bg_base = (60, 55, 50)
    subject_color = (40, 170, 90, 255)
    fixture = Image.new("RGBA", (size, size), (0, 0, 0, 255))
    fpx = fixture.load()
    for y in range(size):
        for x in range(size):
            if lo <= x < hi and lo <= y < hi:
                fpx[x, y] = subject_color
            else:
                noise = ((x * 7 + y * 13) % 5) - 2  # deterministic +/-2 background noise
                fpx[x, y] = (bg_base[0] + noise, bg_base[1] + noise, bg_base[2] + noise, 255)

    cut = cutout(fixture)
    cpx = cut.load()
    w, h = cut.size

    corner_alphas = [cpx[0, 0][3], cpx[w - 1, 0][3], cpx[0, h - 1][3], cpx[w - 1, h - 1][3]]
    print(f"[selftest] cutout corner alphas (expect 0): {corner_alphas}")
    if max(corner_alphas) > 5:
        print("  FAIL: border corners were not cut to (near-)zero alpha")
        ok = False
    else:
        print("  OK: border corners cut to (near-)zero alpha")

    bg_total = bg_removed = 0
    for y in range(h):
        for x in range(w):
            if not (lo <= x < hi and lo <= y < hi):
                bg_total += 1
                if cpx[x, y][3] == 0:
                    bg_removed += 1
    bg_removed_frac = bg_removed / bg_total if bg_total else 0.0
    print(f"[selftest] background pixels fully removed: {bg_removed_frac * 100:.1f}%")
    if bg_removed_frac < 0.85:
        print("  FAIL: expected >=85% of the noisy background to be cut")
        ok = False
    else:
        print("  OK: the noisy background was flood-filled away, not just the flat corners")

    # Interior of the subject (inset past where a `feather=1` ramp could reach) must stay
    # byte-for-byte opaque -- only the cut edge itself is allowed to be softened.
    inset = 2
    subject_total = subject_opaque = 0
    for y in range(lo + inset, hi - inset):
        for x in range(lo + inset, hi - inset):
            subject_total += 1
            if cpx[x, y][3] >= 250:
                subject_opaque += 1
    subject_opaque_frac = subject_opaque / subject_total if subject_total else 0.0
    print(f"[selftest] subject interior pixels kept opaque: {subject_opaque_frac * 100:.1f}%")
    if subject_opaque_frac < 0.99:
        print("  FAIL: expected the subject's interior to stay opaque (subject eaten by the cutout)")
        ok = False
    else:
        print("  OK: the subject's interior was preserved, not eaten by the flood fill")

    # A subject-coloured fleck sitting IN the background but not touching the border, and not
    # 4-connected to it through background-coloured pixels, must survive (border-connectivity,
    # not just colour distance, gates removal). Sized so its centre sits outside the 1px feather
    # ramp, so this isolates connectivity correctness from feather softening.
    fixture2 = fixture.copy()
    f2px = fixture2.load()
    for yy in range(2, 8):
        for xx in range(2, 8):
            f2px[xx, yy] = subject_color
    cut2 = cutout(fixture2)
    c2px = cut2.load()
    fleck_center_alpha = c2px[4, 4][3]
    fleck_opaque_count = sum(1 for yy in range(2, 8) for xx in range(2, 8) if c2px[xx, yy][3] > 0)
    print(f"[selftest] isolated subject-coloured fleck: centre alpha {fleck_center_alpha}, "
          f"{fleck_opaque_count}/36 px non-zero")
    if fleck_center_alpha < 250 or fleck_opaque_count < 30:
        print("  FAIL: an enclosed subject-coloured region was removed even though it never touched the border")
        ok = False
    else:
        print("  OK: only background reachable from the border was removed")

    # --- keep_dark_l: a doorway-to-darkness subject whose own void touches the border ----------
    # Fixture: light grey background (like a stone frame/floor), with a near-black void in the
    # lower-middle that reaches the BOTTOM edge (mirrors an exit stamp: the passage "recedes off
    # tile" so its own dark interior necessarily touches the border). Without protection, that
    # void gets sampled into the border colour clusters and the whole connected dark region --
    # not just the true light-grey background -- is flood-filled away.
    dsize = 32
    void_x0, void_x1 = 10, 22
    void_y0 = 18
    light_bg = (150, 148, 145)
    void_color = (6, 5, 5, 255)
    door_fixture = Image.new("RGBA", (dsize, dsize), (0, 0, 0, 255))
    dfpx = door_fixture.load()
    for y in range(dsize):
        for x in range(dsize):
            if void_x0 <= x < void_x1 and void_y0 <= y < dsize:
                dfpx[x, y] = void_color
            else:
                n = ((x * 5 + y * 11) % 5) - 2
                dfpx[x, y] = (light_bg[0] + n, light_bg[1] + n, light_bg[2] + n, 255)

    without_protection = cutout(door_fixture, keep_dark_l=None)
    with_protection = cutout(door_fixture, keep_dark_l=15.0)
    wpx, ppx = without_protection.load(), with_protection.load()
    void_probe = (16, dsize - 2)  # deep inside the void, on the border row

    unprotected_alpha = wpx[void_probe][3]
    protected_alpha = ppx[void_probe][3]
    print(f"[selftest] doorway-void probe alpha: without keep_dark_l={unprotected_alpha}, "
          f"with keep_dark_l=15 -> {protected_alpha}")
    if unprotected_alpha > 50:
        print("  NOTE: fixture didn't reproduce the failure (void survived even unprotected) -- "
              "keep_dark_l test is inconclusive on this fixture, not a pass/fail signal on its own")
    if protected_alpha < 250:
        print("  FAIL: keep_dark_l did not protect the near-black void that touches the border")
        ok = False
    else:
        print("  OK: keep_dark_l kept the border-touching dark void opaque")

    # The light background must still be removed normally even with keep_dark_l active.
    bg_probe = (2, 2)
    bg_alpha_with_protection = ppx[bg_probe][3]
    print(f"[selftest] background probe alpha with keep_dark_l active: {bg_alpha_with_protection}")
    if bg_alpha_with_protection != 0:
        print("  FAIL: keep_dark_l over-protected -- the real light background was not cut")
        ok = False
    else:
        print("  OK: the real background is still cut normally with keep_dark_l active")

    # --- cleanalpha: feathered edges + stray specks + a pinhole -----------------------------
    csize = 32
    subject_color = (60, 150, 90, 255)
    clean_fixture = Image.new("RGBA", (csize, csize), (0, 0, 0, 0))
    cfpx = clean_fixture.load()
    sub_lo, sub_hi = 8, 24
    pinhole = {(14, 14), (15, 14)}  # size 2 < default min_hole (3) -> should be filled
    for y in range(csize):
        for x in range(csize):
            if sub_lo <= x < sub_hi and sub_lo <= y < sub_hi:
                cfpx[x, y] = (0, 0, 0, 0) if (x, y) in pinhole else subject_color
    # feathered ramp just outside the subject's edge, both directions of the threshold
    for y in range(sub_lo, sub_hi):
        cfpx[sub_lo - 1, y] = subject_color[:3] + (64,)   # below threshold -> should become 0
        cfpx[sub_hi, y] = subject_color[:3] + (180,)      # above threshold -> should become 255
    for x in range(sub_lo, sub_hi):
        cfpx[x, sub_lo - 1] = subject_color[:3] + (64,)
        cfpx[x, sub_hi] = subject_color[:3] + (180,)
    # stray opaque specks, isolated in the background, sizes < default min_speck (3)
    speck_pixels = [(2, 2), (3, 2), (28, 5)]
    for x, y in speck_pixels:
        cfpx[x, y] = subject_color

    cleaned = cleanalpha(clean_fixture)
    clpx = cleaned.load()

    all_alphas = [clpx[x, y][3] for y in range(csize) for x in range(csize)]
    non_binary = sum(1 for a in all_alphas if a not in (0, 255))
    print(f"[selftest] cleanalpha: non-binary alpha pixels remaining: {non_binary}")
    if non_binary != 0:
        print("  FAIL: expected every output pixel's alpha to be exactly 0 or 255")
        ok = False
    else:
        print("  OK: alpha fully binarized, no fringe")

    specks_gone = all(clpx[x, y][3] == 0 for x, y in speck_pixels)
    print(f"[selftest] cleanalpha: stray specks removed: {specks_gone}")
    if not specks_gone:
        print("  FAIL: a stray opaque speck survived cleanalpha")
        ok = False
    else:
        print("  OK: stray specks removed")

    pinhole_filled = all(clpx[x, y][3] == 255 for x, y in pinhole)
    print(f"[selftest] cleanalpha: pinhole filled: {pinhole_filled}")
    if not pinhole_filled:
        print("  FAIL: the enclosed pinhole was not filled")
        ok = False
    else:
        print("  OK: enclosed pinhole filled")

    subject_intact = all(
        clpx[x, y][3] == 255
        for y in range(sub_lo, sub_hi) for x in range(sub_lo, sub_hi)
        if (x, y) not in pinhole
    )
    print(f"[selftest] cleanalpha: main subject unchanged: {subject_intact}")
    if not subject_intact:
        print("  FAIL: cleanalpha altered the main subject's own opaque pixels")
        ok = False
    else:
        print("  OK: main subject left unchanged")

    # --- fill_tile: rebuilding a mask-15 "pit + rim" grate into a flat, seamless fill -----------
    # Fixture mirrors the real bug: a dark near-black interior "pit" with a lighter rim near the
    # edges (see .sandbox/terrain-art/shot-3.png) -- this is exactly what reads as a repeating
    # grate/lattice once the tile is placed edge-to-edge many times.
    gsize = 24
    grate = Image.new("RGBA", (gsize, gsize), (0, 0, 0, 255))
    grate_px = grate.load()
    rim_color = (14, 14, 14)
    for y in range(gsize):
        for x in range(gsize):
            near_edge = x < 4 or x >= gsize - 4 or y < 4 or y >= gsize - 4
            grate_px[x, y] = rim_color + (255,) if near_edge else (0, 0, 0, 255)

    grate_corner_before = grate_px[0, 0]
    grate_center_before = grate_px[gsize // 2, gsize // 2]
    print(f"[selftest] fill fixture (grate): corner {grate_corner_before} vs centre {grate_center_before}")

    filled = fill_tile(grate, amplitude=3.0, inset=8, seed=1)
    filled_px = filled.load()
    filled_corner = filled_px[0, 0]
    filled_center = filled_px[gsize // 2, gsize // 2]
    corner_center_diff = sum(abs(a - b) for a, b in zip(filled_corner[:3], filled_center[:3])) / 3.0
    print(f"[selftest] fill result: corner {filled_corner} centre {filled_center} "
          f"(mean abs diff {corner_center_diff:.2f})")
    if corner_center_diff > 6.0:
        print("  FAIL: corner still clearly differs from centre -- the rim/pit pattern survived")
        ok = False
    else:
        print("  OK: corner and centre are close -- no rim/pit pattern left to form a lattice")

    fill_band = band_score(filled)
    print(f"[selftest] fill band_score (pre-repair): col={fill_band[0]:.3f} row={fill_band[1]:.3f}")
    if max(fill_band) > DEFAULT_BAND_THRESHOLD:
        print(f"  FAIL: fill band_score above threshold {DEFAULT_BAND_THRESHOLD} before repair")
        ok = False
    else:
        print("  OK: fill band_score within threshold even before repair_seam")

    fill_alphas = {p[3] for p in filled.getdata()}
    print(f"[selftest] fill alpha values: {fill_alphas}")
    if fill_alphas != {255}:
        print("  FAIL: fill_tile did not preserve full opacity from the sampled interior")
        ok = False
    else:
        print("  OK: fill stays fully opaque, matching its opaque source")

    filled_again = fill_tile(grate, amplitude=3.0, inset=8, seed=1)
    print(f"[selftest] fill determinism: identical output for the same seed: {list(filled.getdata()) == list(filled_again.getdata())}")
    if list(filled.getdata()) != list(filled_again.getdata()):
        print("  FAIL: fill_tile is not deterministic for a fixed seed")
        ok = False
    else:
        print("  OK: fill_tile is deterministic for a fixed seed")

    # Hue preservation: a coloured (teal-ish) fixture should stay teal-ish, not drift grey/other hue,
    # since the same jitter is added to all three channels (only luma moves, not hue).
    teal_fixture = Image.new("RGBA", (gsize, gsize), (16, 25, 25, 255))
    tfpx = teal_fixture.load()
    for y in range(4, gsize - 4):
        for x in range(4, gsize - 4):
            tfpx[x, y] = (11, 20, 20, 255)
    teal_filled = fill_tile(teal_fixture, amplitude=3.0, inset=8, seed=2)
    teal_hue_diffs = []
    for p in teal_filled.getdata():
        r, g, b, _a = p
        teal_hue_diffs.append(abs((g - r) - (20 - 11)) + abs((b - r) - (20 - 11)))
    max_hue_drift = max(teal_hue_diffs)
    print(f"[selftest] fill hue preservation: max per-pixel (g-r)/(b-r) drift from source ratio: {max_hue_drift}")
    if max_hue_drift > 1:
        print("  FAIL: fill_tile's per-pixel jitter drifted hue instead of only luma")
        ok = False
    else:
        print("  OK: fill_tile preserves hue exactly (equal jitter on all three channels)")

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

    p_cutout = sub.add_parser("cutout")
    p_cutout.add_argument("input")
    p_cutout.add_argument("output")
    p_cutout.add_argument("--tolerance", type=float, default=DEFAULT_CUTOUT_TOLERANCE)
    p_cutout.add_argument("--border", type=int, default=DEFAULT_CUTOUT_BORDER)
    p_cutout.add_argument("--feather", type=int, default=DEFAULT_CUTOUT_FEATHER)
    p_cutout.add_argument("--sides", default="top,bottom,left,right",
                           help="comma list of top,bottom,left,right edges trusted as background (default: all)")
    p_cutout.add_argument("--keep-dark", type=float, default=None,
                           help="never cut a pixel with Lab L at or below this value (protects an intentional near-black void subject)")
    p_cutout.add_argument("--no-clean", action="store_true", help="skip the cleanalpha pass (keep raw/feathered alpha)")
    p_cutout.add_argument("--min-speck", type=int, default=DEFAULT_CLEAN_MIN_SPECK)
    p_cutout.add_argument("--min-hole", type=int, default=DEFAULT_CLEAN_MIN_HOLE)

    p_cleanalpha = sub.add_parser("cleanalpha")
    p_cleanalpha.add_argument("input")
    p_cleanalpha.add_argument("output")
    p_cleanalpha.add_argument("--threshold", type=float, default=DEFAULT_CLEAN_THRESHOLD)
    p_cleanalpha.add_argument("--min-speck", type=int, default=DEFAULT_CLEAN_MIN_SPECK)
    p_cleanalpha.add_argument("--min-hole", type=int, default=DEFAULT_CLEAN_MIN_HOLE)

    p_grade = sub.add_parser("grade")
    p_grade.add_argument("input")
    p_grade.add_argument("output")
    p_grade.add_argument("--sample", required=True, help="representative tile (e.g. the plain floor) to derive the transform from")
    p_grade.add_argument("--ref", required=True, help="reference image/crop to grade toward")

    p_fill = sub.add_parser("fill")
    p_fill.add_argument("input")
    p_fill.add_argument("output")
    p_fill.add_argument("--amplitude", type=float, default=DEFAULT_FILL_AMPLITUDE)
    p_fill.add_argument("--inset", type=int, default=DEFAULT_FILL_INSET)
    p_fill.add_argument("--seed", type=int, default=DEFAULT_FILL_SEED)
    p_fill.add_argument("--repair", action="store_true", help="run repair_seam on the result")
    p_fill.add_argument("--band", type=int, default=DEFAULT_BAND)
    p_fill.add_argument("--ratio-threshold", type=float, default=DEFAULT_EDGE_RATIO_THRESHOLD)
    p_fill.add_argument("--threshold", type=float, default=DEFAULT_BAND_THRESHOLD)

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

    elif args.cmd == "cutout":
        img = Image.open(args.input)
        sides = tuple(s.strip() for s in args.sides.split(",") if s.strip())
        before_frac = cutout_removed_fraction(img, tolerance=args.tolerance, border=args.border, sides=sides)
        out_img = cutout(img, tolerance=args.tolerance, border=args.border, feather=args.feather, sides=sides,
                          keep_dark_l=args.keep_dark, clean=not args.no_clean,
                          min_speck=args.min_speck, min_hole=args.min_hole)
        out_img.save(args.output)
        alphas = [p[3] for p in out_img.convert("RGBA").getdata()]
        transparent_frac = sum(1 for a in alphas if a == 0) / len(alphas)
        partial_frac = sum(1 for a in alphas if 0 < a < 255) / len(alphas)
        print(f"border pixels classified as background: {before_frac * 100:.1f}%")
        print(f"whole-tile fully-transparent pixels after cutout: {transparent_frac * 100:.1f}%")
        print(f"partial-alpha (fringe) pixels remaining: {partial_frac * 100:.1f}%")

    elif args.cmd == "cleanalpha":
        img = Image.open(args.input)
        before_alphas = [p[3] for p in img.convert("RGBA").getdata()]
        before_partial = sum(1 for a in before_alphas if 0 < a < 255)
        out_img = cleanalpha(img, threshold=args.threshold, min_speck=args.min_speck, min_hole=args.min_hole)
        out_img.save(args.output)
        after_alphas = [p[3] for p in out_img.convert("RGBA").getdata()]
        after_partial = sum(1 for a in after_alphas if 0 < a < 255)
        after_opaque = sum(1 for a in after_alphas if a == 255)
        print(f"partial-alpha pixels: {before_partial} before -> {after_partial} after")
        print(f"opaque pixels after: {after_opaque}/{len(after_alphas)}")

    elif args.cmd == "grade":
        img = Image.open(args.input)
        sample = Image.open(args.sample)
        ref = Image.open(args.ref)
        g = compute_grade(sample, ref)
        out_img = apply_grade(img, g)
        out_img.save(args.output)
        print(f"sample: L={g['l_cur']:.2f} chroma={g['c_cur']:.2f}")
        print(f"ref:    L={g['l_ref']:.2f} chroma={g['c_ref']:.2f}")
        print(f"transform: l_offset={g['l_offset']:+.2f}  chroma_scale={g['chroma_scale']:.3f} "
              f"(raw {g['raw_chroma_scale']:.3f})")

    elif args.cmd == "fill":
        img = Image.open(args.input)
        out_img = fill_tile(img, amplitude=args.amplitude, inset=args.inset, seed=args.seed)
        if args.repair:
            out_img = repair_seam(out_img, band=args.band, ratio_threshold=args.ratio_threshold)
        band = band_score(out_img)
        grad = edge_interior_gradient(out_img)
        out_img.save(args.output)
        print(f"band_score: col={band[0]:.3f} row={band[1]:.3f}")
        print(f"edge/interior ratio: col={grad['col_ratio']:.2f} row={grad['row_ratio']:.2f}")
        status = "OK" if max(band) <= args.threshold else "WARN"
        print(f"{status}: band_score (max axis) {max(band):.3f} vs threshold {args.threshold}")

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
