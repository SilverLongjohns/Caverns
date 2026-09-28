#!/usr/bin/env python3
"""Pack a biome's terrain tiles into a sheet + manifest.

Pure python3 + Pillow (no numpy dependency, per env rules).

Usage:
  python3 scripts/tiles/pack.py <spec.json> <out_dir>

spec.json:
  { "tileSize": 24,
    "sets": { "rock": { "dir": "<path>", "pattern": "tile_{i}.png", "maskBit": "lower" }, ... },
    "floorVariants": ["<file>", ...],
    "stamps": { "hazard": "<file>", ... },
    "desaturate": 0.0 }

Writes <out_dir>/terrain.png (a sheet, 8 tiles wide) and <out_dir>/terrain.json (a
TerrainManifest: tileSize, sets keyed by UPPER-terrain mask "0".."15", floorVariants,
stamps), both as [col, row] positions into the sheet.

For each corner set, tiles are read at file index i = 0..15. With maskBit "lower" (the
file index's bit 1 means floor — the spike's convention), the stored upper-terrain mask
is 15 - i. With "upper" it's i unchanged. Layout order is always rock, then water, then
chasm (only the sets present in the spec), then floorVariants, then stamps, each laid at
the sheet position matching its source order (file index 0..15 for a set, list/dict order
otherwise) — independent of the manifest's mask-key remapping.

Exits non-zero (after printing to stderr) on a missing input file or a tile that isn't
tileSize x tileSize.
"""

import json
import math
import os
import sys

from PIL import Image

SHEET_COLS = 8
SET_ORDER = ("rock", "water", "chasm")


def die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def load_tile(path: str, tile_size: int) -> Image.Image:
    if not os.path.isfile(path):
        die(f"missing tile file: {path}")
    img = Image.open(path).convert("RGBA")
    if img.size != (tile_size, tile_size):
        die(f"wrong tile size for {path}: expected {tile_size}x{tile_size}, got {img.width}x{img.height}")
    return img


def desaturate_image(img: Image.Image, amount: float) -> Image.Image:
    """Blends each pixel toward its luminance by `amount` (0..1), keeping alpha."""
    rgba = img.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()
    out = Image.new("RGBA", (w, h))
    out_px = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
            nr = r + (luma - r) * amount
            ng = g + (luma - g) * amount
            nb = b + (luma - b) * amount
            out_px[x, y] = (
                int(round(min(255.0, max(0.0, nr)))),
                int(round(min(255.0, max(0.0, ng)))),
                int(round(min(255.0, max(0.0, nb)))),
                a,
            )
    return out


def main() -> None:
    if len(sys.argv) != 3:
        die("usage: python3 scripts/tiles/pack.py <spec.json> <out_dir>")
    spec_path, out_dir = sys.argv[1], sys.argv[2]

    if not os.path.isfile(spec_path):
        die(f"missing spec file: {spec_path}")
    with open(spec_path, "r", encoding="utf-8") as f:
        spec = json.load(f)

    tile_size = spec.get("tileSize")
    if not isinstance(tile_size, int) or tile_size <= 0:
        die("spec.tileSize must be a positive integer")

    desaturate = float(spec.get("desaturate", 0.0) or 0.0)

    # (kind, key, image) entries, in sheet layout order.
    entries: list[tuple[str, str, Image.Image]] = []
    # sets[setName][maskKeyStr] = image, for the manifest.
    manifest_sets: dict[str, dict[str, Image.Image]] = {}

    spec_sets = spec.get("sets", {}) or {}
    for set_name in SET_ORDER:
        set_spec = spec_sets.get(set_name)
        if set_spec is None:
            continue
        set_dir = set_spec.get("dir")
        pattern = set_spec.get("pattern")
        mask_bit = set_spec.get("maskBit", "upper")
        if not set_dir or not pattern:
            die(f"sets.{set_name} needs 'dir' and 'pattern'")
        if mask_bit not in ("lower", "upper"):
            die(f"sets.{set_name}.maskBit must be 'lower' or 'upper', got {mask_bit!r}")

        masks: dict[str, Image.Image] = {}
        for i in range(16):
            file_path = os.path.join(set_dir, pattern.format(i=i))
            img = load_tile(file_path, tile_size)
            mask = 15 - i if mask_bit == "lower" else i
            masks[str(mask)] = img
            entries.append(("set", f"{set_name}:{mask}", img))
        manifest_sets[set_name] = masks

    floor_variant_files = spec.get("floorVariants", []) or []
    floor_variants: list[Image.Image] = []
    for file_path in floor_variant_files:
        img = load_tile(file_path, tile_size)
        floor_variants.append(img)
        entries.append(("floorVariant", file_path, img))

    spec_stamps = spec.get("stamps", {}) or {}
    manifest_stamps: dict[str, Image.Image] = {}
    for stamp_name, file_path in spec_stamps.items():
        img = load_tile(file_path, tile_size)
        manifest_stamps[stamp_name] = img
        entries.append(("stamp", stamp_name, img))

    if not entries:
        die("spec has no tiles to pack (empty sets, floorVariants and stamps)")

    cols = SHEET_COLS
    rows = math.ceil(len(entries) / cols)
    sheet = Image.new("RGBA", (cols * tile_size, rows * tile_size), (0, 0, 0, 0))

    positions: dict[int, tuple[int, int]] = {}
    for idx, (kind, key, img) in enumerate(entries):
        col, row = idx % cols, idx // cols
        positions[idx] = (col, row)
        tile_img = desaturate_image(img, desaturate) if desaturate > 0.0 else img
        sheet.paste(tile_img, (col * tile_size, row * tile_size), tile_img)

    os.makedirs(out_dir, exist_ok=True)
    sheet_path = os.path.join(out_dir, "terrain.png")
    sheet.save(sheet_path)

    # Rebuild manifest position maps from the same iteration order used above.
    manifest_set_positions: dict[str, dict[str, list[int]]] = {name: {} for name in manifest_sets}
    manifest_floor_variant_positions: list[list[int]] = []
    manifest_stamp_positions: dict[str, list[int]] = {}

    idx = 0
    for set_name in SET_ORDER:
        masks = manifest_sets.get(set_name)
        if masks is None:
            continue
        for i in range(16):
            mask = 15 - i if spec_sets[set_name].get("maskBit", "upper") == "lower" else i
            col, row = positions[idx]
            manifest_set_positions[set_name][str(mask)] = [col, row]
            idx += 1
    for _ in floor_variant_files:
        col, row = positions[idx]
        manifest_floor_variant_positions.append([col, row])
        idx += 1
    for stamp_name in spec_stamps:
        col, row = positions[idx]
        manifest_stamp_positions[stamp_name] = [col, row]
        idx += 1

    manifest = {
        "tileSize": tile_size,
        "sets": manifest_set_positions,
        "floorVariants": manifest_floor_variant_positions,
        "stamps": manifest_stamp_positions,
    }
    manifest_path = os.path.join(out_dir, "terrain.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")

    print(f"Packed {len(entries)} tile(s) into {cols}x{rows} sheet ({sheet.width}x{sheet.height}px)")
    for set_name, masks in manifest_set_positions.items():
        print(f"  set {set_name}: {len(masks)} masks")
    print(f"  floorVariants: {len(manifest_floor_variant_positions)}")
    print(f"  stamps: {len(manifest_stamp_positions)} ({', '.join(manifest_stamp_positions) or 'none'})")
    if desaturate > 0.0:
        print(f"  desaturate: {desaturate}")
    print(f"  -> {sheet_path}")
    print(f"  -> {manifest_path}")


if __name__ == "__main__":
    main()
