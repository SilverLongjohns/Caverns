# Pixel-Art Terrain Tiles (Modular Tileset)

**Date:** 2026-09-28
**Branch:** `feature/terrain-tiles`, from `feature/exploration-glyph-grid` at `4aa787b`. It depends on the shared `GlyphViewport` from that branch, which is not yet merged.
**Status:** Design approved section by section; pending spec review.
**Look reference:** `art/mockups/tileset-spike/mock-A2.png` (the round-2 spike). `mock-A`, `mock-B` and `B/` are the rejected alternatives.

## Intent

Terrain is still drawn with font characters: box-drawing walls, dotted floors, `~` water. It now sits under multi-colour pixel sprites.

This spec replaces it with **pixel-art terrain tiles** that snap together automatically:
- rock and floor autotile from their neighbours;
- water and chasm have proper edges;
- hazards, bridges, exits and torches are drawn as tiles.

It covers both exploration and the arena. The grid becomes **square 48×48 cells**, so every unit stands exactly on one tile.

### User decisions (2026-09-28)

- **"Modular tileset"** means pixel-art terrain tiles that autotile from their neighbours, per biome. It does not mean a room-building kit, and it does not mean ASCII-style glyph tiles.
- **Square 48×48 cells for both exploration and the arena.** Tiles are 24px art drawn at 2×, the same scale as the glyph sprites. Rejected: keeping 34×50 cells (PixelLab only makes square tiles), and square cells in exploration only.
- **Look:** flat top-down, corner-autotiled rock mass and floor (spike style A, round 2): dark charcoal and umber, seamless, with subtle relic-tech. Rejected: the 3/4 building kit (spike B), which read as architecture rather than cave and doesn't support 24px cleanly.
- **Scope:** the full system, plus complete art for the **starter biome**. Other biomes use a neutral default set until their own art batches, each gated on a contact sheet.

### Hard rules carried over

- **Data-driven:** biome tile recipes, tile sets and stamps come from data files. No code names a specific biome or tile.
- **Missing art never renders blank.** Fallback order: the biome's set, then the default set, then today's ASCII character.
- **Fog keeps its three states:** unseen is black, explored is dimmed, visible is full.
- **Reduced motion:** terrain has no animation that ignores it. Water is static, or its animation is disabled under reduced motion.
- **Every art spend is confirmed with the user before generating,** and every install goes through a contact sheet plus a room mockup approved by the user.

## 1. Grid geometry

- `client/src/components/grid/viewportMath.ts`: `CELL_W = CELL_H = 48`. `GRID_BORDER` stays at 2, or drops to 0 if the tile art makes the cell border redundant; decide from screenshots and document it. `cellOrigin`, `fitViewport` and the minimap follow automatically.
- Glyph cell CSS (`.arena-grid-container.glyph-grid .room-row > span`): 48×48, terrain as a background image. The 1px cell border goes if tiles join seamlessly; keep a hairline only if the playtest says the grid is needed for tactics.
- `.entity-glyph` stays 48×48 and now exactly fills a cell. Remove the sideways-overflow compensation.
- Exploration (`ExplorationGrid` floating units) and the arena (`ArenaGrid` inline units, path animation, board effects, hit labels) both read the geometry from `viewportMath`, so no per-mode constants.

## 2. Autotiling

A pure module, `client/src/terrain/autotile.ts`, with unit tests. It doesn't need to be shared with the server, which never renders.

- **Dual-grid corner autotiling** (the standard way to use Wang corner sets):
  - The PixelLab corner sets encode each tile by a 4-bit mask of which of its corners are "upper" terrain (`NW<<3 | NE<<2 | SW<<1 | SE`, per the spike's `meta.json`).
  - A corner tile is conceptually centred on a **grid vertex**. Its four corners are the terrains of the four **cells** around that vertex; cells outside the map count as rock.
  - Each 48×48 cell is therefore drawn as **four 24×24 quadrants**. Each quadrant is the matching quarter of the dual tile at that cell corner:
    - the NW quadrant is the SE quarter of the tile at the cell's top-left vertex;
    - the NE quadrant is the SW quarter of the tile at the top-right vertex;
    - and so on for SW and SE.
  - Result: a lone 1×1 pillar renders as a rock blob, rock never eats floor cells, and edges stay organic and seamless.
- **Terrain classes for the corner test:**
  - `wall` is rock;
  - `water` is water;
  - `chasm` is chasm;
  - everything else is floor;
  - `bridge` counts as its underlying water or chasm (decided by its neighbours) and gets a stamp on top.
- **Which set a dual tile uses:**
  - vertices touching only floor and rock use the **rock set**;
  - floor and water use the **water set**;
  - floor and chasm use the **chasm set**.
  - A vertex mixing rock with water or chasm has no dedicated set. Resolve it by priority: rock > chasm > water > floor, treating the lower-priority "upper" terrain as floor for that vertex. Document this and test it. Tiny seams there are acceptable.
- **Layers per cell:**
  - four quadrant layers (from the dual tiles);
  - then an optional floor variety tile (full-cell, only when all four quadrants are pure floor, mask 0);
  - then an optional stamp (hazard, bridge, exit marker, torch).
- **Variety:** the floor variant is picked by `fnv1a32(\`${roomId}:${x},${y}\`)`. That's the existing helper in `client/src/glyphs.ts`; move it somewhere shared if needed. About 15% of pure-floor cells get a variant, deterministically.
- **Output:** `terrainFor(grid, roomId, biome): TerrainCell[][]`, where each `TerrainCell` lists its layers as sheet positions. It's memoised per room and grid.

## 3. Tile types

| Tile type | Rendering |
|---|---|
| `floor` | rock set, mask 0, plus an optional variety tile |
| `wall` (incl. pillars) | rock set, corner-autotiled |
| `water` | water corner set (floor to water). Themed water (`mineral_pool`, `spore_pool`, `deep_water`) uses a biome override set if the data provides one, else the default water. |
| `chasm` | chasm corner set (floor to void). If a biome lacks one, use single void tiles with an edge. |
| `bridge` | the underlying set (water or chasm) plus a bridge stamp, oriented horizontally or vertically by its neighbours |
| `hazard` | floor plus a hazard stamp |
| `exit` | floor plus an exit stamp (a doorway or arrow mark, so exits stay findable) |
| wall with `theme: 'torch'` | rock plus a torch stamp (small flame sprite). The existing torch glow and vision logic is unchanged. |

(The arena swaps `exit` for `floor` already, so no exit stamps appear in combat.)

## 4. Rendering

- `TileGridView` keeps its one span per cell. That keeps fog classes, `tileHighlights`, click and hover, and the entity overlay.
- For each cell it renders the layers as stacked background images from the biome sheet:
  - the four quadrants are each `url(sheet)` with a `background-position` pointing at the right quarter of the right dual tile, and a `background-size`/position that places it in the cell's matching 24×24 quadrant (48×48 cell, sheet scaled 2×);
  - then the variety and stamp layers;
  - all with `image-rendering: pixelated`.
  - A small pure helper turns `TerrainCell` layers into CSS `background-*` strings, and is unit-tested.
- **Fog:**
  - unseen is black: no background at all;
  - explored is the same layers dimmed by a filter, e.g. `brightness(0.35) saturate(0.6)`, replacing today's text opacity;
  - visible is full.
- **Arena targeting highlights, move range and path trace** now sit over tiles. Restyle them as translucent overlays (a coloured inset or `::after` fill) so they read on the art. The arena must stay fully usable; check every highlight class.
- **Minimap:** unchanged (colour per tile type). Optionally take colours from each tile set's average; nice to have, not required.
- **ASCII fallback:** if a biome sheet fails to load or a tile type has no mapping, the cell renders today's character. Keep the existing `getTileChar` path behind a flag on `TileGridView`, and use it for the fallback.
- **Biome source:** exploration uses the dungeon's biome, `DungeonContent.biomeId`. Check the client has it; add it to the client store from `game_start` if it doesn't. The arena uses the same biome, from the arena combat start or the current dungeon.

## 5. Art pipeline

- **Recipe data:** `art/tiles/recipes.json`, one entry per biome, with:
  - rock, floor, water and chasm descriptions;
  - palette notes;
  - stamp descriptions (hazard, bridge, exit, torch);
  - variety descriptions.

  Start with `starter` only.
- **Generator** (`scripts/tiles/generate.mjs`, or run by an agent with the MCP tools, following the recipe):
  - **Rock and floor corner set:** `create_tiles_pro` with `tile_type: square_topdown`, `tile_view: top-down`, `tile_feature: tileset`, `tile_size: 24`, `outline_mode: segmentation`.
  - **Water and chasm corner sets:** the same call with a transition description. Use `create_topdown_tileset` only if 24px quality is poor; it's 16/32 only, so it would need rescaling, which should be avoided.
  - **Stamps:** `create_tiles_pro` shape mode, 24px, segmentation, numbered descriptions.
  - **Floor variety:** style mode against the chosen floor tile.
- **Post-processing** (`scripts/tiles/postprocess.py`, Pillow):
  1. **Seam check:** measure the wrap discontinuity of each floor candidate (the left/right and top/bottom edge pixel difference). Pick the lowest. If it's above a threshold, repair it by offset-wrapping and blending the seam, then re-check.
  2. **Palette match:** remap variety and stamp tiles onto the floor tile's palette (nearest colour in a perceptual space), then match mean luminance. This fixes the spike's "pale stamped squares".
  3. **Pack:** one sheet per biome, `client/public/tiles/<biome>/terrain.png`, laid out in 24px cells, plus `client/public/tiles/<biome>/terrain.json`:

```json
{ "tileSize": 24,
  "sets": { "rock": { "masks": { "0": [c, r], "1": [c, r], "…": "…" } }, "water": { "…": "…" }, "chasm": { "…": "…" } },
  "floorVariants": [[c, r], "…"],
  "stamps": { "hazard": [c, r], "bridge_h": [c, r], "bridge_v": [c, r], "exit": [c, r], "torch": [c, r] } }
```

  - A **default set** (`client/public/tiles/default/`) is the starter set desaturated by the script. Biomes without art use it.
- **Approval gates:**
  1. Before generating: confirm the balance and the estimate with the user. Starter is about $0.70–1.50; the subscription is exhausted until 2026-10-23.
  2. After post-processing: a contact sheet (`art/tiles/<biome>/_sheet.png`) **and** a room mockup rendered with the real autotiler at 48×48, with sprites and fog (`art/tiles/<biome>/_mock.png`). The user approves or asks for rerolls before install.
- **Provenance:** `art/tiles/<biome>/chosen.json` records the job ids, prompts, picks and post-processing parameters.

## 6. Out of scope

- Art for the biomes other than starter (they use the default set).
- Animated water.
- Terrain lighting or shadows beyond what's baked into the tiles.
- Changing room generation or the tile vocabulary.
- An ASCII terrain toggle in settings. The ASCII fallback exists only for missing art.
- Isometric or 3/4 views.

## 7. Testing

- **Unit tests:**
  - **`autotile`:**
    - dual-grid masks for a straight wall edge, inner and outer corners, a lone 1×1 pillar (must produce rock quadrants, not pure floor) and a 2×2 pillar;
    - rock on the map border (out-of-bounds counts as rock);
    - the mixed-terrain vertex priority;
    - the CSS layer helper produces the right positions for each quadrant;
    - water next to rock;
    - bridge over water and over chasm (horizontal and vertical);
    - hazard, exit and torch stamps;
    - floor variants stay stable for the same room and tile, and occur at about 15%;
    - fallback when a set or tile type is missing.
  - **`viewportMath`:** updated for 48×48.
  - **Manifest integrity:** every `terrain.json` position is inside its sheet's dimensions, read from the PNG header. Every tile type resolves to a set, a stamp or the fallback.
- **Arena:**
  - before-and-after screenshots (duel, and boss with the camera and minimap), compared by eye. The change is intended.
  - Check that targeting highlights, move range, path trace, hit % labels, bolts, board effects and close-ups all still line up with the square cells.
- **Exploration:** screenshots of:
  - a starter room;
  - water;
  - a chasm with a bridge;
  - an exit;
  - torches;
  - the three fog states;
  - a boss-sized room, with render time noted.
- **Full suites** green (shared, server, client with `tsc`).
