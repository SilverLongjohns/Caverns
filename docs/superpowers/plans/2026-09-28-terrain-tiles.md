# Terrain Tiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ASCII terrain with 24px pixel-art tiles on a square 48×48 grid, in both exploration and the arena. It uses dual-grid corner autotiling (rock, water, chasm), stamps for hazard, bridge, exit and torch, floor variety, and fog. Real art is made for the starter biome; other biomes get a desaturated default.

**Architecture:**
- Each `TileGrid` carries its `biomeId`.
- The client loads `/tiles/<biome>/terrain.json` and `terrain.png`, falling back to `default`, then to ASCII.
- A pure `autotile` module turns a grid into per-cell draw layers: four dual-grid quadrants, plus a variety tile and a stamp.
- A pure `terrainDrawOps` turns those layers into `drawImage` operations.
- A `TerrainCanvas` paints the room's terrain once under the transparent `TileGridView` cells. The cells keep fog, highlights, clicks and units.
- Art is generated with PixelLab (corner tilesets at 24px, segmentation). Python/Pillow scripts post-process it (seam repair, palette match) and pack it into a sheet plus a manifest.

**Tech Stack:** TypeScript monorepo (npm workspaces), React + Zustand, Vitest, python3 + Pillow (WSL) for art scripts, PixelLab MCP.

**Spec:** `docs/superpowers/specs/2026-09-28-terrain-tiles-design.md` (read it first). Look reference: `art/mockups/tileset-spike/mock-A2.png`; spike tiles and `meta.json` are in `art/mockups/tileset-spike/A2/`.

**Deviations from the spec** (the spec is the authority; these are implementation choices that keep its behaviour):
1. **§4 rendering.** CSS can't clip a background layer to one quadrant of a cell, so terrain is painted on a single `<canvas>` per room (`TerrainCanvas`) under `TileGridView`, rather than as per-cell background images. Cells become transparent above it:
   - unseen cells are painted opaque black;
   - explored cells get a dark translucent overlay (spec: "dimmed");
   - arena highlights become translucent overlays.

   Same visible result, and the terrain is drawn once per room, not re-rendered every step.
2. **§4 biome source.** Instead of plumbing `DungeonContent.biomeId` to the client, `TileGrid` gains `biomeId?` (set by `buildTileGrid` and `buildArenaGrid`), so each grid names its own terrain.
3. **Mask convention.** PixelLab's spike sets index tiles with bit 1 meaning "floor". `terrain.json` normalises this at pack time to **bit 1 = upper terrain** (rock, water or chasm), so the autotiler has one convention.

**How to run things** (Node is installed on Windows):
- Client: `cmd.exe /c "cd client && npx vitest run && npx tsc --noEmit -p ."`
- Server: `cmd.exe /c "cd server && npx vitest run <file>"`. For the full suite: `cmd.exe /c "cd server && npx vitest run" > .sandbox/server.log 2>&1`, then read the tail and every `×` line.
- After changing `shared/`, run `cmd.exe /c "npm run build --workspace=shared"`.
- Python art scripts run **in WSL** (`python3`, with Pillow installed).
- Dev servers:
  - The client (`cmd.exe /c "npm run dev --workspace=client"`) hot-reloads.
  - The game server must run **without watch**: `cmd.exe /c "cd server && npx tsx --env-file=../.env src/index.ts --sandbox"`.
  - If ports 5173 or 3001 are already listening, use the running servers and don't kill them. Stop only servers you started, by PID. Server-side changes need a server restart; say so in your report so the controller can restart it.
- Screenshots:
  - Arena: `cmd.exe /c "node scripts/sandbox-drive.mjs duel --wait my-turn --shot <name>"`. Put the preset **unquoted** inside the `cmd.exe` string, and add `?seed=N` for determinism.
  - Exploration: `.sandbox/explore-shot.mjs http://localhost:5173` (git-ignored; logs in, goes to the town hub, then into a dungeon, and writes to `.sandbox/ui-revamp/`).
- Git: `git.exe`, explicit paths only, never push. End messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Global Constraints

- **Cells are 48×48 in exploration and the arena, with no cell borders:** `CELL_W = CELL_H = 48`, `GRID_BORDER = 0`. Tiles are 24px art drawn at 2× with `imageSmoothingEnabled = false` or `image-rendering: pixelated`.
- **Dual-grid corner autotiling:**
  - Each cell draws four 24px-art quadrants. Each quadrant is the matching quarter of the corner tile at that cell corner's vertex.
  - A vertex's corner terrains are the four cells around it, and cells outside the map count as rock.
  - Terrain classes: `wall` is rock; `water` is water; `chasm` is chasm; `bridge` is water or chasm by its neighbours; everything else is floor.
  - A vertex mixing several upper terrains resolves by priority rock > chasm > water > floor: the highest wins, and the others count as floor for that vertex.
- **Floor variety:** about 15% of pure-floor cells (all four quadrants mask 0), chosen by `fnv1a32(\`${roomId}:${x},${y}\`)`.
- **Stamps:** `hazard`, `bridge_h`/`bridge_v`, `exit` and `torch` (on walls with `theme === 'torch'`).
- **Fallback order:** biome set, then `default` set, then ASCII (today's `TileGridView` characters). Missing art never renders blank.
- **Fog:** unseen is black; explored is terrain dimmed (translucent dark overlay) with no units; visible is full. The line-of-sight rules are unchanged.
- **Data-driven:** no code or test names a specific biome or tile. Biomes come from `terrain.json` and `art/tiles/recipes.json`.
- **Art gates:** confirm the PixelLab credit estimate with the user before generating. The user approves a contact sheet **and** a room mockup before install.
- **Reduced motion:** terrain is static. The existing unit and camera rules are unchanged.

## Review Focus

1. **A lone 1×1 pillar** must render rock quadrants, not vanish. Pinned in Task 3.
2. **Map edges:** out-of-bounds counts as rock, so rooms read as enclosed. Pinned in Task 3.
3. **Missing biome art, or a sheet that fails to load,** falls back to `default`, then ASCII, never blank. Pinned in Tasks 2 and 5.
4. **Arena targeting and move highlights must stay visible over tile art.** They used opaque `background !important`. Pinned in Task 5 (the CSS change, plus screenshot checks).
5. **Mixed rock/water vertices** resolve by priority without throwing. Pinned in Task 3.

---

## File Map

| File | Responsibility |
|---|---|
| `shared/src/types.ts` | `TileGrid.biomeId?` |
| `server/src/tileGridBuilder.ts`, `server/src/arenaGridBuilder.ts` | set `biomeId` |
| `client/src/terrain/terrainManifest.ts` (new) | `TerrainManifest` type, `parseTerrainManifest`, `useTerrainSet(biomeId)` loader with fallback |
| `client/src/terrain/autotile.ts` (new) | pure grid → `TerrainCell[][]` |
| `client/src/terrain/terrainDrawOps.ts` (new) | pure `TerrainCell` layers → `drawImage` ops |
| `client/src/components/grid/TerrainCanvas.tsx` (new) | paints the ops once per grid, biome and sheet |
| `client/src/components/grid/viewportMath.ts` | 48×48, border 0 |
| `client/src/components/grid/GlyphViewport.tsx` | mounts `TerrainCanvas`; passes `terrain` mode to `TileGridView` |
| `client/src/components/TileGridView.tsx` | `terrainMode`: no terrain chars, fog as overlays |
| `client/src/styles/index.css` | square cells, fog overlays, translucent highlights |
| `scripts/tiles/pack.py` (new), `scripts/tiles/postprocess.py` (new) | seam repair, palette match, packing, default set |
| `art/tiles/recipes.json` (new) | per-biome generation recipes |
| `client/public/tiles/{starter,default}/terrain.{png,json}` | packed sets |

---

### Task 1: `TileGrid` carries its biome

**Files:**
- Modify: `shared/src/types.ts` (the `TileGrid` interface, around line 168)
- Modify: `server/src/tileGridBuilder.ts:163-169` (return value) and `server/src/arenaGridBuilder.ts:~145` (return value)
- Test: `server/src/tileGridBuilder.test.ts`, `server/src/arenaGridBuilder.test.ts`

**Interfaces:**
- Produces `TileGrid.biomeId?: string`: the biome the grid was built for. It's optional for older data.

- [ ] **Step 1: Write the failing tests.** In `tileGridBuilder.test.ts`, following that file's room fixture:

```ts
it('the built grid records its biome', () => {
  const grid = buildTileGrid(makeRoom(), 'starter');
  expect(grid.biomeId).toBe('starter');
});
```

  In `arenaGridBuilder.test.ts`: `expect(buildArenaGrid('chamber', 'starter').biomeId).toBe('starter');`. Use the fixture helper names the files actually have. If `buildTileGrid` falls back to the starter config for an unknown biome, assert that `biomeId` still echoes the requested id.

- [ ] **Step 2: Run them and check they fail.** Run `cmd.exe /c "cd server && npx vitest run src/tileGridBuilder.test.ts src/arenaGridBuilder.test.ts"`. Expected: FAIL.

- [ ] **Step 3: Implement it.**
  - Add `/** Biome this grid was built for; selects its terrain tileset on the client. */ biomeId?: string;` to `TileGrid`.
  - Add `biomeId,` to both builders' return objects.
  - Rebuild shared.

- [ ] **Step 4: Check it passes.** Run the same tests (expected: PASS), then the full server suite to a log and `cmd.exe /c "cd client && npx tsc --noEmit -p ."`.

- [ ] **Step 5: Commit.** Message: "TileGrid records its biome for terrain tiles".

---

### Task 2: Terrain manifest, a provisional starter set, and the loader

**Files:**
- Create: `scripts/tiles/pack.py`
- Create: `client/public/tiles/starter/terrain.png` and `terrain.json` (**provisional**, packed from the spike's `art/mockups/tileset-spike/A2/`; Task 7 replaces them)
- Create: `client/public/tiles/default/terrain.png` and `terrain.json` (the starter set desaturated; regenerated in Task 7)
- Create: `client/src/terrain/terrainManifest.ts`, `client/src/terrain/terrainManifest.test.ts`

**Interfaces:**

```ts
export type SheetPos = [col: number, row: number];
export interface TerrainManifest {
  tileSize: number;                       // 24
  /** Corner sets keyed by UPPER-terrain mask (bit=1 ⇒ upper: NW<<3|NE<<2|SW<<1|SE). */
  sets: Partial<Record<'rock' | 'water' | 'chasm', Record<string, SheetPos>>>;
  floorVariants: SheetPos[];
  stamps: Partial<Record<'hazard' | 'bridge_h' | 'bridge_v' | 'exit' | 'torch', SheetPos>>;
}
export function parseTerrainManifest(raw: unknown): TerrainManifest | null;   // validates shape; null if invalid
export interface TerrainSet { biomeId: string; manifest: TerrainManifest; sheet: HTMLImageElement }
/** Loads /tiles/<biome>/terrain.{json,png}; on failure tries 'default'; resolves null ⇒ ASCII fallback. Cached per biome. */
export function useTerrainSet(biomeId: string | undefined): TerrainSet | null;
```

- [ ] **Step 1: Write `scripts/tiles/pack.py`** (python3 + Pillow). It takes a spec JSON describing tile files, and writes the sheet and manifest:

```
usage: python3 scripts/tiles/pack.py <spec.json> <out_dir>
spec.json:
{ "tileSize": 24,
  "sets": { "rock": { "dir": "<path>", "pattern": "tile_{i}.png", "maskBit": "lower" } , ... },
  "floorVariants": ["<file>", ...],
  "stamps": { "hazard": "<file>", ... },
  "desaturate": 0.0 }
```

  - For each set, it reads the 16 tiles `i = 0..15`. With `maskBit: "lower"` (the file index's bit 1 means floor, as in the spike's `meta.json`), the stored upper mask is `15 - i`. With `"upper"` it's `i`.
  - It lays every tile into a sheet 8 tiles wide: first the sets in order rock, water, chasm, then the variants, then the stamps.
  - It writes `terrain.png` and `terrain.json`, with keys as strings `"0"`..`"15"` and positions as `[col, row]`.
  - With `desaturate > 0`, it blends each pixel toward its luminance by that factor, keeping alpha.
  - It prints a summary and exits non-zero on a missing file or a wrong tile size.

- [ ] **Step 2: Pack the provisional sets.**
  - Write `art/tiles/provisional-starter.json`. The rock set is from `art/mockups/tileset-spike/A2/tile_{i}.png` with `maskBit: "lower"`. Read `A2/meta.json` to confirm that bit 1 means floor; if it says otherwise, use `"upper"`.
  - Include the five `floor_variant_*.png` as `floorVariants`, even though their palette is off; Task 7 fixes that.
  - No water, chasm or stamps yet: those tile types fall back to ASCII until Task 7.
  - Run `python3 scripts/tiles/pack.py art/tiles/provisional-starter.json client/public/tiles/starter`.
  - Run it again with `"desaturate": 0.6` into `client/public/tiles/default`.

- [ ] **Step 3: Write the failing tests.** In `terrainManifest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseTerrainManifest } from './terrainManifest.js';

const pub = resolve(__dirname, '../../public/tiles');
function pngSize(file: string) { const b = readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; }

describe('parseTerrainManifest', () => {
  it('rejects junk', () => {
    expect(parseTerrainManifest(null)).toBeNull();
    expect(parseTerrainManifest({ tileSize: 24 })).toBeNull();
    expect(parseTerrainManifest({ tileSize: 24, sets: { rock: { '0': ['a', 1] } }, floorVariants: [], stamps: {} })).toBeNull();
  });
  it('accepts a minimal manifest', () => {
    expect(parseTerrainManifest({ tileSize: 24, sets: { rock: { '0': [0, 0] } }, floorVariants: [], stamps: {} })).not.toBeNull();
  });
});

describe('shipped terrain sets', () => {
  const biomes = require('fs').readdirSync(pub) as string[];
  it('include a default set', () => { expect(biomes).toContain('default'); });
  for (const biome of biomes) {
    it(`${biome}: every position is inside its sheet; rock set is complete`, () => {
      const m = parseTerrainManifest(JSON.parse(readFileSync(resolve(pub, biome, 'terrain.json'), 'utf-8')))!;
      expect(m).not.toBeNull();
      const { w, h } = pngSize(resolve(pub, biome, 'terrain.png'));
      const all = [...Object.values(m.sets).flatMap((s) => Object.values(s!)), ...m.floorVariants, ...Object.values(m.stamps)] as [number, number][];
      for (const [c, r] of all) { expect((c + 1) * m.tileSize).toBeLessThanOrEqual(w); expect((r + 1) * m.tileSize).toBeLessThanOrEqual(h); }
      for (let i = 0; i < 16; i++) expect(m.sets.rock?.[String(i)], `rock mask ${i}`).toBeDefined();
    });
  }
});
```

  (Use an `import` for `readdirSync` instead of `require` if the project's lint or tsconfig forbids `require`.)

- [ ] **Step 4: Run them and check they fail,** then implement `terrainManifest.ts`:
  - `parseTerrainManifest` validates: numbers, `[int, int]` pairs, and mask keys `0`–`15`.
  - `useTerrainSet` is a hook with a module-level cache `Map<biomeId, Promise<TerrainSet | null>>`. It fetches `/tiles/${biome}/terrain.json`, parses it, then loads `terrain.png` into an `Image` and awaits `decode()`/`onload`. On any failure it tries `default`, and after that it resolves `null`.
  - It returns `null` while loading. Callers render ASCII until the set is ready, which is acceptable and brief.

- [ ] **Step 5: Check it passes,** with the client suite and tsc.
- [ ] **Step 6: Commit** the script, `art/tiles/provisional-starter.json`, both `client/public/tiles/*` sets, and the manifest module and its test. Message: "Terrain manifest, loader and provisional starter/default tile sets".

---

### Task 3: `autotile`, the pure dual-grid engine

**Files:**
- Create: `client/src/terrain/autotile.ts`, `client/src/terrain/autotile.test.ts`

**Interfaces:**

```ts
import type { SheetPos, TerrainManifest } from './terrainManifest.js';
export type TerrainClass = 'floor' | 'rock' | 'water' | 'chasm';
export interface TerrainCell {
  /** NW, NE, SW, SE quadrant sources: sheet tile + which quarter of it (qx, qy ∈ {0,1}). null ⇒ no art (caller falls back to ASCII). */
  quads: [Quad | null, Quad | null, Quad | null, Quad | null];
  variant: SheetPos | null;
  stamp: SheetPos | null;
}
export interface Quad { tile: SheetPos; qx: 0 | 1; qy: 0 | 1 }
export function classify(grid: { width: number; height: number; tiles: string[][] }, x: number, y: number): TerrainClass; // OOB ⇒ rock; bridge ⇒ water/chasm by neighbours
export function vertexTile(grid, vx: number, vy: number, m: TerrainManifest): SheetPos | null;   // vertex (vx,vy) ∈ [0..w]×[0..h]
export function autotile(grid: { width: number; height: number; tiles: string[][]; themes?: (string|null)[][] }, roomId: string, m: TerrainManifest): TerrainCell[][];
```

Rules:
- `vertexTile` reads the four cells around the vertex: `(vx-1,vy-1)` is the tile's NW corner, `(vx,vy-1)` NE, `(vx-1,vy)` SW, `(vx,vy)` SE.
- It picks the upper terrain for the vertex by priority rock > chasm > water. Corners of that class count as 1 and everything else as 0.
- If there's no upper terrain, the mask is 0 and the rock set is used (mask 0 is plain floor).
- It returns `m.sets[setFor(upper)]?.[mask]`, where the set is `rock`, `chasm` or `water`. It returns `null` if that set or mask is missing.
- A cell `(x, y)` takes:
  - NW = the SE quarter (`qx 1, qy 1`) of `vertexTile(x, y)`;
  - NE = the SW quarter (`qx 0, qy 1`) of `vertexTile(x+1, y)`;
  - SW = the NE quarter (`qx 1, qy 0`) of `vertexTile(x, y+1)`;
  - SE = the NW quarter (`qx 0, qy 0`) of `vertexTile(x+1, y+1)`.
- **Variant:** only when the cell is floor-class and all four of its vertices have mask 0, and `fnv1a32(\`${roomId}:${x},${y}\`) % 100 < 15`. The variant is `floorVariants[hash % len]`. Import `fnv1a32` from `../glyphs.js`.
- **Stamp:**
  - `hazard` tile → `stamps.hazard`;
  - `exit` → `stamps.exit`;
  - `bridge` → `bridge_h` if its left or right neighbours aren't water or chasm, else `bridge_v`;
  - a wall with `themes[y][x] === 'torch'` → `stamps.torch`;
  - a missing stamp is `null`, and the base still renders.
- **Bridge class:** `water` if any orthogonal neighbour is water, else `chasm`.

- [ ] **Step 1: Write the failing tests.** Build tiny grids from strings (`#` wall, `.` floor, `~` water, `X` chasm, `=` bridge, `^` hazard, `E` exit). Use a synthetic manifest where every set maps mask `i` to a distinct position, e.g. rock `[i, 0]`, water `[i, 1]`, chasm `[i, 2]`, so tests can read masks back from positions. Cover:
  - an all-floor 3×3 inside a wall border: the centre cell's four quads are all rock mask 0 (floor), and edge cells have rock bits toward the border;
  - out-of-bounds counts as rock: the corner cell of an all-floor grid (no wall border) has its outer quadrant fully rock;
  - **a lone 1×1 pillar** (`#` in the middle of floor): the pillar cell's four quads all come from tiles with non-zero masks; together they form the rock blob;
  - a straight wall edge, and inner and outer corners, give the expected masks;
  - a water pool: quads use the water set; a rock/water mixed vertex resolves to the rock set;
  - a bridge over water (horizontal and vertical orientation) and over a chasm;
  - stamps for hazard, exit and torch;
  - a missing set (manifest without `water`) gives `null` quads for water cells, with no throw;
  - variants: the same inputs give the same variants, and roughly 15% (between 8% and 25%) of the pure-floor cells of a big all-floor room get one.
- [ ] **Step 2: Run them and check they fail.** Run `cmd.exe /c "cd client && npx vitest run src/terrain/autotile.test.ts"`.
- [ ] **Step 3: Implement it** as specified. Keep it pure, with no DOM.
- [ ] **Step 4: Check it passes,** with the client suite and tsc.
- [ ] **Step 5: Commit.** Message: "Dual-grid terrain autotiler".

---

### Task 4: `terrainDrawOps` and `TerrainCanvas`

**Files:**
- Create: `client/src/terrain/terrainDrawOps.ts`, `client/src/terrain/terrainDrawOps.test.ts`
- Create: `client/src/components/grid/TerrainCanvas.tsx`

**Interfaces:**

```ts
export interface DrawOp { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number }
/** tileSize = art px (24); cell = screen px (48). */
export function terrainDrawOps(cells: TerrainCell[][], tileSize: number, cell: number): DrawOp[];
/** Paints precomputed cells (the caller runs autotile, so TileGridView can share the result). */
export function TerrainCanvas(props: { cells: TerrainCell[][]; width: number; height: number; set: TerrainSet; cell: number }): JSX.Element;
```

- **Quads:** a quadrant op takes a `tileSize/2` square from sheet `(tile[0]*ts + qx*ts/2, tile[1]*ts + qy*ts/2)` and draws it at the cell's quadrant `(x*cell + qxDest*cell/2, y*cell + qyDest*cell/2)`, sized `cell/2`. Here `qxDest`/`qyDest` is the quadrant's own position: NW = (0,0), NE = (1,0), SW = (0,1), SE = (1,1).
- **Variant and stamp:** each is a full tile → full cell.
- **Order:** quads, then the variant, then the stamp. `null` layers are skipped.

- [ ] **Step 1: Write the failing test.** Check that a single cell with known quads, a variant and a stamp produces exactly six ops with the expected source and destination rectangles, and that null layers produce no ops.
- [ ] **Step 2: Implement `terrainDrawOps`,** and check the test passes.
- [ ] **Step 3: Implement `TerrainCanvas`.**
  - It's a `<canvas>` sized `width*cell` × `height*cell`, absolutely positioned at `0,0` in the world layer, with `pointer-events: none` and `z-index` below the tile spans.
  - In a `useLayoutEffect` keyed on `[cells, set]`, it computes `terrainDrawOps(cells, …)`, sets `ctx.imageSmoothingEnabled = false`, and calls `ctx.drawImage(set.sheet, …)` for each op.
  - Cells whose quads are all `null` are left transparent; `TileGridView` draws their ASCII character (Task 5).
- [ ] **Step 4: Run the client suite and tsc.**
- [ ] **Step 5: Commit.** Message: "Terrain draw ops and canvas".

---

### Task 5: Square grid, terrain mode in the viewport, fog and highlight overlays

**Files:**
- Modify: `client/src/components/grid/viewportMath.ts` (+ test): `CELL_W = CELL_H = 48`, `GRID_BORDER = 0`; update the test expectations that hard-code 34/50/2 to use the constants.
- Modify: `client/src/components/grid/GlyphViewport.tsx`: `const set = useTerrainSet(grid.biomeId)`. When `set` is ready, compute `cells = useMemo(() => autotile(grid, roomKey, set.manifest), [grid, roomKey, set])` and render `<TerrainCanvas cells={cells} width={grid.width} height={grid.height} set={set} cell={CELL_W} />` before `TileGridView` inside the world layer, and pass `terrainMode` to `TileGridView`. Add a `roomKey?: string` prop (exploration passes `roomId`; the arena passes a stable key such as `'arena'`) for variant hashing.
- Modify: `client/src/components/ExplorationGrid.tsx` (pass `roomKey={roomId}`) and `ArenaGrid.tsx` (pass `roomKey="arena"`).
- Modify: `client/src/components/TileGridView.tsx`: add a `terrainMode?: boolean` prop. When it's true:
  - visible and explored cells render **no terrain character**, except cells whose terrain resolved to nothing. To know that, `GlyphViewport` passes an optional `asciiCells?: Set<string>` of `"x,y"` keys whose quads are all null, derived from the same `cells` memo it gives `TerrainCanvas`;
  - unseen cells render as `tile-unseen` (opaque black overlay);
  - explored cells get `tile-explored` (dark translucent overlay, **no opacity on the span**, because the span now carries only overlays and units);
  - entities and highlights work as now.
- Modify: `client/src/styles/index.css`:
  - Square cells: `.arena-grid-container.glyph-grid .room-row > span { width: 48px; height: 48px; }`. Remove the per-cell `border` (`.arena-grid-container .room-row span { border: … }`) and the `.room-grid` border **for `.glyph-grid` only** (other screens that use `TileGridView`, such as `WorldMapView`, keep theirs). Remove the `.tile-unseen` border fix from the exploration work if it becomes redundant.
  - `.entity-glyph` stays 48×48; drop any sideways-overflow compensation that no longer applies.
  - Fog in terrain mode:

```css
.glyph-grid.terrain .room-row .tile-unseen { background: #000; }
.glyph-grid.terrain .room-row .tile-explored { background: rgba(0, 0, 0, 0.62); opacity: 1; }
```

    (`GlyphViewport` adds a `terrain` class to its container when a set is active.)
  - Highlights become translucent over art. Check every highlight class and the ghost entity:

```css
.glyph-grid.terrain .arena-move-highlight { background: rgba(60, 200, 90, 0.22) !important; }
.glyph-grid.terrain .arena-path-trace { background: rgba(90, 230, 120, 0.38) !important; }
.glyph-grid.terrain .arena-range-highlight { background: rgba(80, 140, 230, 0.28) !important; }
.glyph-grid.terrain .arena-area-highlight { background: rgba(220, 50, 50, 0.32) !important; }
.glyph-grid.terrain .arena-shoot-range { background: rgba(230, 120, 40, 0.24) !important; }
```

  - Tune the alpha values from screenshots so they stay readable on both floor and rock.

- [ ] **Step 1: Update the `viewportMath` tests** to the constants (RED if needed), then change the constants.
- [ ] **Step 2: Implement the viewport, `TileGridView` and CSS changes** described above.
- [ ] **Step 3: Test the fallback.** Add a `TileGridView` unit test only if the client already has `@testing-library/react` or jsdom set up. If not, rely on `autotile`'s null-quad tests plus the screenshot check, and state that in the report.
- [ ] **Step 4: Run the client suite and tsc.**
- [ ] **Step 5: Screenshots** (restart nothing; Vite hot-reloads, but the server needs a restart for Task 1's `biomeId`. If `grid.biomeId` is missing, the viewport falls back to `default`, which is fine to verify, but say whether the server was restarted):
  - arena: duel `?seed=1` and boss-rat-king `?seed=1`, before (take them before starting Task 5 edits) and after. Also shoot-targeting (the tint and hit %), a move range and path trace, and a melee attack's effects;
  - exploration: a starter room, fog (all three states), a boss-sized room, and a torch wall. Water, chasm, hazard, bridge and exit show ASCII until Task 7 adds their art, which is expected.
  - Read every image. Check units sit centred on single tiles, highlights are readable over rock and floor, there are no blank cells, fog reads, and the arena is usable.
- [ ] **Step 6: Commit.** Message: "Square 48×48 grid with pixel terrain tiles (exploration + arena)".

---

### Task 6: Recipes and post-processing scripts

**Files:**
- Create: `art/tiles/recipes.json` (starter entry only)
- Create: `scripts/tiles/postprocess.py`

**`recipes.json` (starter):**

```json
{ "starter": {
  "palette": "dark charcoal-umber rock, dark dusty floor, low saturation, faint cold-green and dim amber relic-tech glints",
  "rock":  { "lower": "dark dusty cave floor, umber and charcoal grit, small gravel", "upper": "deep charcoal-umber rough cave rock mass, near-black in shadow, subtle darker rim where it meets the floor, a few barely visible rusted relic-tech cables" },
  "water": { "lower": "<same floor>", "upper": "still dark cave water, murky teal-black, faint reflections" },
  "chasm": { "lower": "<same floor>", "upper": "bottomless black chasm, jagged dark rock lip" },
  "variants": ["hairline cracks", "scattered gravel and rubble", "damp dark stain", "half-buried rusted relic-tech cable", "one tiny dim amber relic light"],
  "stamps": { "hazard": "glowing sickly-green toxic seep on cave floor", "bridge_h": "rickety horizontal plank-and-cable bridge", "bridge_v": "rickety vertical plank-and-cable bridge", "exit": "worn stone archway threshold with a faint arrow scratched into the floor", "torch": "small wall-mounted relic torch, warm amber flame" }
} }
```

(`<same floor>` means reuse the rock set's lower description; the generator task copies it in.)

**`postprocess.py`** (python3 + Pillow):
- `seam_score(img)` is the mean absolute RGB difference between column 0 and column w-1, plus row 0 and row h-1.
- `repair_seam(img)` offset-wraps the tile by half in x and y, cross-fades an 8px band across the seam, and wraps it back.
- `palette_match(img, ref)` builds a palette from `ref` (up to 16 colours, median cut). It maps each pixel of `img` to the nearest colour in CIE Lab, keeping alpha, then scales mean luminance to within ±3% of `ref`'s.
- CLI:
  - `python3 scripts/tiles/postprocess.py seam <in.png> [--repair] [--threshold 18] <out.png>` prints the score before and after;
  - `python3 scripts/tiles/postprocess.py match <in.png> --ref <floor.png> <out.png>`;
  - `python3 scripts/tiles/postprocess.py sheet <dir> <out.png>` builds a labelled 2× contact sheet on `#0a0a0a`.
- A self-test mode: `python3 scripts/tiles/postprocess.py selftest` builds synthetic images and asserts:
  - an image with a hard vertical seam scores high, and scores lower after repair;
  - `palette_match` output uses only palette colours (alpha aside);
  - its luminance matches within 3%.

  Run it and paste the output in the report.

- [ ] **Step 1: Write `recipes.json` and `postprocess.py`.**
- [ ] **Step 2: Run `selftest`** (expected: all asserts pass). Then run `seam` on `art/mockups/tileset-spike/A2/tile_15.png` (the spike floor) and `match` on one spike floor variant against it. Read the outputs and confirm the banding score drops and the variant darkens to the floor's palette.
- [ ] **Step 3: Commit** `recipes.json`, `postprocess.py` and any sample outputs under `art/tiles/starter/_postprocess-demo/`. Message: "Terrain art recipes and post-processing (seam repair, palette match)".

---

### Task 7: Starter art (PixelLab; user-gated) and install

**This task has user gates. Report and STOP at each, and the controller relays the user's answer:**
1. Before generating: `get_balance`, and an estimate of about 6–8 `create_tiles_pro` calls at roughly $0.10–0.20 each.
2. After generating and post-processing: the contact sheet plus the room mockup.

- [ ] **Step 1: Estimate.** Load the PixelLab tools with ToolSearch (`create_tiles_pro`, `get_tiles_pro`, `get_balance`). Report the balance and the estimate, then STOP.
- [ ] **Step 2: Generate** (after approval) from `recipes.json` starter. Everything is at 24px, `square_topdown`, `top-down`, `outline_mode: "segmentation"`:
  - rock set (`tile_feature: tileset`, description "1). <lower> 2). <upper>", as in the spike);
  - water set and chasm set (the same, with their lower and upper);
  - floor variants (style mode against the chosen rock-set floor tile, mask 0);
  - stamps (shape mode, numbered descriptions).
  - Save raw outputs and `get_tiles_pro` metadata (placement rules, and which bit means what) to `art/tiles/starter/raw/`.
- [ ] **Step 3: Post-process.**
  - Seam-check the plain floor tile and repair it if it's over threshold; record the scores.
  - `match` every variant and stamp against the floor tile.
  - Pack with `pack.py` into `art/tiles/starter/pack/`, not yet into `client/public`.
  - Build the contact sheet (`art/tiles/starter/_sheet.png`).
- [ ] **Step 4: Render the mockup.** Write `scripts/tiles/mockup.mjs`, or a python equivalent, that:
  - takes a real room grid (for example by calling the roomgrid generator for a `chamber` in the starter biome through a small node script, or loading a saved `TileGrid` JSON);
  - runs the **real** `autotile` logic; call `autotile.ts` via `npx tsx` from `client/`, or port it faithfully and document that;
  - draws at 48×48 with the sprites from `client/public/sprites/glyphs/` and a fog variant.

  Output `art/tiles/starter/_mock.png` and `_mock-fog.png`. Include water, a chasm with a bridge, a hazard, an exit and a torch wall in the room: edit the grid if the generator didn't place them. Read them yourself, then **STOP and report** the sheet and mockup paths plus your honest read.
- [ ] **Step 5: Install** (after the user approves; rerolls are the user's call).
  - Copy the pack to `client/public/tiles/starter/`.
  - Regenerate `default` with `desaturate 0.6` from the final starter pack.
  - Write `art/tiles/starter/chosen.json` (job ids, prompts, seam scores, post-process parameters).
  - Run the client suite (the manifest integrity test covers the new sets) and tsc.
  - Take exploration screenshots of a starter room with water, chasm, bridge, hazard, exit and torch in game, plus one arena duel.
- [ ] **Step 6: Commit** the installed sets, the art records, the raw outputs, the scripts and the mockups. Message: "Art: starter terrain tileset".

---

### Task 8: Verification, docs and memory

- [ ] **Step 1: Full suites:** shared, roomgrid, itemgen, server (to a log; read every `×`), client (vitest + tsc), and server tsc.
- [ ] **Step 2: `CLAUDE.md`** (commit it alone, and only if it has no unrelated uncommitted edits; otherwise report it):
  - "What's Working": "Pixel-art terrain tiles on a square 48×48 grid (exploration + arena): dual-grid corner autotiling, stamps, fog; starter biome art, other biomes use a desaturated default; ASCII fallback. Sets in `client/public/tiles/<biome>/`; recipes in `art/tiles/recipes.json`; scripts in `scripts/tiles/`."
  - Project structure: `client/src/terrain/`, `TerrainCanvas.tsx`.
- [ ] **Step 3: Memory.** Store a thinker `decision` memory with:
  - the canvas-under-transparent-cells rendering;
  - the upper-mask convention in `terrain.json`;
  - the PixelLab settings that worked (24px `create_tiles_pro` tileset with segmentation);
  - post-processing is required (palette match plus seam repair);
  - how to add a biome: recipe, then generate, then post-process, then pack, then the user gates.
