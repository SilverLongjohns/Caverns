// Terrain art mockup renderer -- reusable for ANY biome, not just "starter".
//
// Emits terrain draw ops (using the REAL client/src/terrain/{autotile,terrainDrawOps,
// terrainManifest}.ts, imported read-only -- never modify those files from here) as JSON, for a
// python/Pillow compositor to render a room mockup at any cell size. This is how every terrain
// art round for this project was reviewed before install: it proves the packed sheet actually
// autotiles correctly (corner transitions, floor variants, bridge orientation, stamp placement)
// rather than eyeballing the raw tiles in isolation.
//
// Usage (from client/, via cmd.exe per env.md -- see .superpowers/sdd/*/env.md):
//   npx tsx scripts/terrain-mockup.mts <gridJsonPath> <manifestJsonPath> <cellPx> <outJsonPath>
//
//   <gridJsonPath>     a TileGrid JSON: { width, height, tiles: string[][], themes?:
//                      (string|null)[][] }. tiles values match what autotile.ts's `classify()`
//                      understands: 'floor' | 'wall' | 'pillar' | 'water' | 'chasm' | 'bridge' |
//                      'hazard' | 'exit', plus a wall cell can carry themes[y][x] = 'torch'. Hand-
//                      author one (see the example this project used for the starter biome,
//                      committed at art/tiles/starter/mockup-grid.json) or generate one from a
//                      real room/roomgrid source and dump it to JSON.
//   <manifestJsonPath> a biome's terrain.json (e.g. client/public/tiles/<biome>/terrain.json, or
//                      a work-in-progress pack's terrain.json before install).
//   <cellPx>           on-screen cell size in px (the game uses 48).
//   <outJsonPath>       where to write { width, height, tileSize, cellPx, ops: DrawOp[] }.
//
// The output ops are sx/sy/sw/sh (source rect in the terrain.png sheet) + dx/dy/dw/dh
// (destination rect in the room canvas) -- composite them by cropping the sheet and pasting, in
// order, onto a canvas of width*cellPx x height*cellPx. A python/Pillow example: read the ops
// JSON, `Image.open(terrainPngPath)`, then for each op `sheet.crop((sx,sy,sx+sw,sy+sh)).resize
// ((dw,dh))` pasted at (dx,dy) via alpha_composite. Overlay glyph sprites from
// client/public/sprites/glyphs/{classes,mobs,furnishings}/*.png afterward, and a fog overlay
// (unseen: solid black; explored: rgba(0,0,0,0.62), matching the game's own fog CSS) if wanted.

import { readFileSync, writeFileSync } from 'node:fs';
import { autotile } from '../src/terrain/autotile.js';
import { terrainDrawOps } from '../src/terrain/terrainDrawOps.js';
import { parseTerrainManifest } from '../src/terrain/terrainManifest.js';

const [gridPath, manifestPath, cellPxStr, outPath] = process.argv.slice(2);
if (!gridPath || !manifestPath || !cellPxStr || !outPath) {
  console.error('usage: terrain-mockup.mts <gridJsonPath> <manifestJsonPath> <cellPx> <outJsonPath>');
  process.exit(1);
}

const grid = JSON.parse(readFileSync(gridPath, 'utf-8'));
const manifestRaw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
const manifest = parseTerrainManifest(manifestRaw);
if (!manifest) {
  console.error('invalid terrain manifest');
  process.exit(1);
}

const cellPx = Number(cellPxStr);
const cells = autotile(grid, 'mockup-room', manifest);
const ops = terrainDrawOps(cells, manifest.tileSize, cellPx);

writeFileSync(
  outPath,
  JSON.stringify(
    {
      width: grid.width,
      height: grid.height,
      tileSize: manifest.tileSize,
      cellPx,
      ops,
    },
    null,
    0
  )
);

console.log(`wrote ${ops.length} draw ops for a ${grid.width}x${grid.height} grid to ${outPath}`);
