#!/usr/bin/env python3
"""One-off compositor: turns terrain-mockup.mts draw ops into a rendered room PNG.

Usage: python3 composite_mock.py <ops.json> <sheet.png> <out.png>
"""
import json
import sys

from PIL import Image

ops_path, sheet_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]

data = json.load(open(ops_path))
sheet = Image.open(sheet_path).convert("RGBA")
w, h, cellPx = data["width"], data["height"], data["cellPx"]

canvas = Image.new("RGBA", (w * cellPx, h * cellPx), (18, 18, 22, 255))

for op in data["ops"]:
    tile = sheet.crop((op["sx"], op["sy"], op["sx"] + op["sw"], op["sy"] + op["sh"]))
    if (op["dw"], op["dh"]) != tile.size:
        tile = tile.resize((op["dw"], op["dh"]), Image.NEAREST)
    canvas.alpha_composite(tile, (op["dx"], op["dy"]))

canvas.save(out_path)
print(f"wrote {out_path} ({canvas.width}x{canvas.height})")
