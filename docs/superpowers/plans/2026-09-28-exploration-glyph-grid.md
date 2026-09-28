# Exploration Glyph Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exploration renders on the same polished glyph grid as the arena:
- 34×50 cells;
- sprites for players, mobs and furnishings;
- a camera that follows the player;
- a fog-aware minimap;
- tweened steps.

Interactables stay ASCII with a glow. The arena looks exactly as it does now.

**Architecture:**
- Pull the camera, sizing, minimap and edge fades out of `ArenaGrid` into a shared `GlyphViewport` (pure maths in `viewportMath.ts`).
- `ArenaGrid` becomes a combat layer on top of it.
- A new `ExplorationGrid` is an exploration layer on top of it:
  - props (furnishings, interactables) are drawn inline in the tile cells;
  - players and mobs are drawn on a floating layer and slide between cells with CSS transitions.
- The server adds `templateId` to `mob_spawn` and a definition `id` to `Furnishing`, so the client can look up sprites.

**Deviation from the spec:** the spec describes `GlyphViewport` as having `inline` and `floating` unit modes. Here, `GlyphViewport` renders only inline entities and gives callers a `children` slot inside the world layer. Exploration's floating units live in that slot (in `ExplorationGrid`), which keeps the viewport API smaller. The behaviour is the same.

**Tech Stack:** TypeScript monorepo (npm workspaces `shared`, `server`, `client`, `roomgrid`, `itemgen`), React + Zustand, Vitest, PixelLab MCP (art).

**Spec:** `docs/superpowers/specs/2026-09-28-exploration-glyph-grid-design.md` (read it first).

**How to run things** (Node is installed on Windows, not WSL):
- Shared tests: `cmd.exe /c "cd shared && npx vitest run <file>"`. After changing `shared/`, rebuild it before server or client work: `cmd.exe /c "npm run build --workspace=shared"`.
- Server tests: `cmd.exe /c "cd server && npx vitest run <file>"`. For the full suite, redirect to a log and read the tail and every `×` line: `cmd.exe /c "cd server && npx vitest run" > .sandbox/server.log 2>&1`.
- Client: `cmd.exe /c "cd client && npx vitest run && npx tsc --noEmit -p ."`
- Dev servers:
  - the client with `cmd.exe /c "npm run dev --workspace=client"`;
  - the game server **without watch mode**, because `tsx watch` hangs on this machine: `cmd.exe /c "cd server && npx tsx --env-file=../.env src/index.ts --sandbox"`.

  Run both in the background, and stop them afterwards by killing the Windows PIDs listening on ports 5173 and 3001 (`netstat -ano | findstr LISTENING`, then `taskkill /PID <pid> /T /F`).
- Screenshots:
  - Arena: `cmd.exe /c "node scripts/sandbox-drive.mjs \"duel\" --wait my-turn --shot <name>"`. See the USAGE header in `scripts/sandbox-drive.mjs`.
  - Exploration: `.sandbox/explore-shot.mjs` (git-ignored; it logs in, goes to the town hub, then into a dungeon). Read it before using it. Output goes to `.sandbox/shots/`.
- Git: use `git.exe`, and stage and commit **explicit paths only**. The working tree may hold unrelated changes, so never use `-A`. Never push. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Global Constraints

- **Data-driven:** no code, CSS or test may name a specific furnishing, mob or class. Sprite ids live in `client/src/glyphManifest.ts`.
- **Missing art never breaks rendering:** anything without a sprite shows its ASCII character.
- **The arena must look the same after the refactor.** Before-and-after sandbox screenshots must match visually.
- **Cell geometry:** `CELL_W = 34`, `CELL_H = 50`, `GRID_BORDER = 2` (a 1px grid border on each side). Cell (x, y) starts at `left = 1 + x·34`, `top = 1 + y·50` in world-layer pixels.
- **Exploration steps** slide over `EXPLORE_TIMING.stepMs = 120` (linear). This must stay below the server's 150ms move rate. A jump of more than one tile (Chebyshev) snaps. A room change snaps, and so does the camera.
- **Reduced motion** (`prefersReducedMotion()` from `client/src/ui/motion.ts`): no step slides and no camera glide.
- **Exploration camera:** always follows the local player. No manual arrow-key panning, because arrow keys and WASD still move the player through `useGridMovement`. Clicking the minimap lets you peek; the next move re-centres.
- **The exploration minimap** draws only explored tiles, and units only on currently visible tiles.
- **Interactables stay ASCII,** with a phosphor glow. A furnishing that is also interactable shows the furnishing sprite and gets the interactable glow.
- **Combat still cuts to a separate arena.** Don't touch server combat setup.

## Review Focus

Inputs the spec implies but no feature test would naturally cover. Each is pinned to a test in the task named.

1. **A furnishing and an interactable at the same tile** (every interactable furnishing) must produce exactly one entity: the sprite if one exists, with the interactable class. Pinned in Task 4.
2. **A mob with no `templateId`** (an old message, or a mob without a glyph) must render as its first letter, not blank. Pinned in Task 4.
3. **A room with a combat in progress** must not show that room's wandering mobs. Pinned in Task 4.
4. **A grid smaller than the viewport** (no camera needed) must have camera x and y at 0 and no minimap, whatever the focus. Pinned in Task 2.
5. **Changing rooms** must not slide the player from the old room's coordinates. Pinned in Task 5 (the jump detection lives in `viewportMath.isStep`, tested in Task 2).

---

## File Map

| File | Responsibility |
|---|---|
| `shared/src/messages.ts` | `MobSpawnMessage.templateId` |
| `shared/src/types.ts` | `Furnishing.id?` |
| `server/src/MobAIManager.ts` | send `templateId` in both `mob_spawn` broadcasts |
| `server/src/furnishingPlacer.ts` | set `id: def.id` |
| `client/src/store/gameStore.ts` | `mobPositions` entries carry `templateId?` |
| `client/src/components/grid/viewportMath.ts` (new) | geometry, fit, clamp, centre, step, minimap-tile selection |
| `client/src/components/grid/GlyphViewport.tsx` (new) | camera, sizing, minimap, edges, world layer, pan keys, glide |
| `client/src/components/ArenaGrid.tsx` | combat layer on `GlyphViewport` |
| `client/src/glyphManifest.ts`, `client/src/glyphs.ts` | `FURNISHING_GLYPHS`, `getFurnishingGlyph` |
| `client/src/exploration/explorationEntities.ts` (new) | pure entity building (props inline, units floating) |
| `client/src/components/ExplorationGrid.tsx` (new) | exploration layer: floating units, alert, glide |
| `client/src/components/RoomView.tsx` | keeps LoS and explored logic; renders `ExplorationGrid` |
| `client/src/styles/index.css` | layout, interactable glow, self marker, floating units |
| `client/public/sprites/glyphs/furnishings/*.png`, `art/candidates/furnishings/*` | art (Task 6) |

---

### Task 1: Protocol — mob `templateId`, furnishing `id`

**Files:**
- Modify: `shared/src/messages.ts:612-619` (`MobSpawnMessage`)
- Modify: `shared/src/types.ts:160-166` (`Furnishing`)
- Modify: `server/src/MobAIManager.ts:54-61` and `:123-130`
- Modify: `server/src/furnishingPlacer.ts:181-187`
- Modify: `client/src/store/gameStore.ts:103` (the `mobPositions` type) and `:720-730` (the `mob_spawn` handler)
- Test: `server/src/MobAIManager.test.ts`, `server/src/furnishingPlacer.test.ts`

**Interfaces:**
- Produces:
  - `MobSpawnMessage.templateId: string`
  - `Furnishing.id?: string`
  - store `mobPositions[roomId][i].templateId?: string`

- [ ] **Step 1: Write the failing tests.** In `server/src/MobAIManager.test.ts`, extend the existing `'registerRoom broadcasts mob_spawn'` test's `expect.objectContaining({...})` with `templateId: mob.templateId,`. Then add:

```ts
  it('reactivated mobs re-broadcast mob_spawn with templateId', () => {
    const grid = makeGrid();
    const mob = makeMob();
    manager.registerRoom('room-1', grid, [mob]);
    manager.pauseMob('room-1', mob.instanceId);
    broadcast.mockClear();
    manager.reactivateMob('room-1', mob.instanceId);
    expect(broadcast).toHaveBeenCalledWith('room-1', expect.objectContaining({
      type: 'mob_spawn', mobId: mob.instanceId, templateId: mob.templateId,
    }));
  });
```

(Check the real names and signatures of `pauseMob` and `reactivateMob` in `MobAIManager.ts:76-130`, and adapt. If `makeMob` doesn't set `templateId`, give it one.)

In `server/src/furnishingPlacer.test.ts`, reusing that file's existing `buildTiles` fixture from the "places furnishings within count limits" test:

```ts
  it('every placed furnishing carries its definition id', () => {
    const tiles = buildTiles([ /* same layout as the "places furnishings within count limits" test */ ]);
    const result = placeFurnishings(tiles, 10, 8, 'chamber', 'starter', new Set());
    expect(result.furnishings.length).toBeGreaterThan(0);
    for (const f of result.furnishings) {
      expect(typeof f.id).toBe('string');
      expect(f.id!.length).toBeGreaterThan(0);
    }
  });
```

- [ ] **Step 2: Run them and check they fail.** Run `cmd.exe /c "cd server && npx vitest run src/MobAIManager.test.ts src/furnishingPlacer.test.ts"`. Expected: FAIL, because `templateId` and `id` are missing.

- [ ] **Step 3: Implement it.**
  - `shared/src/messages.ts`: add `templateId: string;` to `MobSpawnMessage` after `mobName`.
  - `shared/src/types.ts`: add to `Furnishing`: `/** Furnishing definition id (server/src/data/furnishingData.json); optional for rooms serialised before it existed. */ id?: string;`
  - `MobAIManager.ts`: add `templateId: mob.templateId,` to the first broadcast and `templateId: entry.mob.templateId,` to the second.
  - `furnishingPlacer.ts`: add `id: def.id,` to the `furnishings.push({...})`.
  - `gameStore.ts`:
    - change the `mobPositions` type to `Record<string, { mobId: string; mobName: string; templateId?: string; x: number; y: number }[]>`;
    - in `mob_spawn`, push `{ mobId: msg.mobId, mobName: msg.mobName, templateId: msg.templateId, x: msg.x, y: msg.y }`.

- [ ] **Step 4: Check it passes.** Rebuild shared and run the same tests (expected: PASS). Then run the full server suite to a log (no `×`), and `cmd.exe /c "cd client && npx tsc --noEmit -p ."` (clean).

- [ ] **Step 5: Commit** these paths: `shared/src/messages.ts`, `shared/src/types.ts`, `server/src/MobAIManager.ts`, `server/src/MobAIManager.test.ts`, `server/src/furnishingPlacer.ts`, `server/src/furnishingPlacer.test.ts`, `client/src/store/gameStore.ts`. Message: "Send mob templateId and furnishing definition id to the client".

---

### Task 2: `viewportMath` — pure geometry and camera maths

**Files:**
- Create: `client/src/components/grid/viewportMath.ts`
- Create: `client/src/components/grid/viewportMath.test.ts`

**Interfaces:**
- Produces:
  - Constants `CELL_W`, `CELL_H`, `GRID_BORDER`, `MINIMAP_PX`, `MINIMAP_GAP`, `PAN_STEP`, `MINIMAP_COLORS`.
  - `fitViewport(availW: number, availH: number, gridW: number, gridH: number): { cols: number; rows: number; needsCamera: boolean }`
  - `clampCam(cam: Pt, gridW: number, gridH: number, cols: number, rows: number): Pt`
  - `centreOn(pos: Pt, cols: number, rows: number): Pt`
  - `cellOrigin(x: number, y: number): { left: number; top: number }`
  - `isStep(a: Pt, b: Pt): boolean`, which is true only for a Chebyshev distance of exactly 1.
  - `minimapTiles(grid: { width: number; height: number; tiles: string[][] }, explored?: Set<string>): { x: number; y: number; type: string }[]`
  - Here `type Pt = { x: number; y: number }`.

- [ ] **Step 1: Write the failing test.** In `viewportMath.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CELL_W, CELL_H, GRID_BORDER, MINIMAP_PX, MINIMAP_GAP, fitViewport, clampCam, centreOn, cellOrigin, isStep, minimapTiles } from './viewportMath.js';

describe('fitViewport', () => {
  it('no camera when the whole grid fits', () => {
    const f = fitViewport(10 * CELL_W + GRID_BORDER, 6 * CELL_H + GRID_BORDER, 10, 6);
    expect(f).toEqual({ cols: 10, rows: 6, needsCamera: false });
  });
  it('camera when the grid is wider than the space; rows leave room for the minimap', () => {
    const availH = 12 * CELL_H + GRID_BORDER;
    const f = fitViewport(20 * CELL_W + GRID_BORDER, availH, 45, 10);
    expect(f.needsCamera).toBe(true);
    expect(f.cols).toBe(20);
    expect(f.rows).toBe(Math.min(10, Math.floor((availH - GRID_BORDER - (10 * MINIMAP_PX + MINIMAP_GAP)) / CELL_H)));
  });
  it('never returns less than 1x1', () => {
    expect(fitViewport(0, 0, 30, 8)).toMatchObject({ cols: 1, rows: 1 });
  });
});

describe('camera', () => {
  it('clamps into the grid', () => {
    expect(clampCam({ x: -5, y: -5 }, 40, 18, 20, 8)).toEqual({ x: 0, y: 0 });
    expect(clampCam({ x: 99, y: 99 }, 40, 18, 20, 8)).toEqual({ x: 20, y: 10 });
  });
  it('a grid smaller than the view always clamps to 0,0', () => {
    expect(clampCam(centreOn({ x: 9, y: 5 }, 30, 15), 10, 6, 10, 6)).toEqual({ x: 0, y: 0 });
  });
  it('centreOn puts the focus in the middle', () => {
    expect(centreOn({ x: 15, y: 9 }, 11, 7)).toEqual({ x: 10, y: 6 });
  });
});

describe('cellOrigin / isStep', () => {
  it('cell origin includes the 1px grid border', () => {
    expect(cellOrigin(0, 0)).toEqual({ left: GRID_BORDER / 2, top: GRID_BORDER / 2 });
    expect(cellOrigin(3, 2)).toEqual({ left: GRID_BORDER / 2 + 3 * CELL_W, top: GRID_BORDER / 2 + 2 * CELL_H });
  });
  it('isStep is true only for a one-tile move (incl. diagonal)', () => {
    expect(isStep({ x: 1, y: 1 }, { x: 2, y: 1 })).toBe(true);
    expect(isStep({ x: 1, y: 1 }, { x: 2, y: 2 })).toBe(true);
    expect(isStep({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(false);
    expect(isStep({ x: 1, y: 1 }, { x: 3, y: 1 })).toBe(false);
  });
});

describe('minimapTiles', () => {
  const grid = { width: 3, height: 2, tiles: [['wall', 'floor', 'floor'], ['wall', 'water', 'floor']] };
  it('all tiles without fog', () => {
    expect(minimapTiles(grid)).toHaveLength(6);
  });
  it('only explored tiles with fog', () => {
    expect(minimapTiles(grid, new Set(['1,0', '1,1']))).toEqual([
      { x: 1, y: 0, type: 'floor' }, { x: 1, y: 1, type: 'water' },
    ]);
  });
});
```

- [ ] **Step 2: Run it and check it fails.** Run `cmd.exe /c "cd client && npx vitest run src/components/grid/viewportMath.test.ts"`. Expected: FAIL, because the module can't be resolved.

- [ ] **Step 3: Implement it.** Move the constants and formulas verbatim from `ArenaGrid.tsx:14-24,142-154`:

```ts
// Shared glyph-grid geometry and camera maths (arena + exploration). Pure; see GlyphViewport.
export type Pt = { x: number; y: number };

// Fixed cell box: 16x24 at 2x (32x48) plus a 1px border on each side. Glyph art is 24x24 at 2x,
// so wider sprites overflow the cell sideways (see .entity-glyph in index.css).
export const CELL_W = 34;
export const CELL_H = 50;
export const GRID_BORDER = 2;
export const PAN_STEP = 2;
export const MINIMAP_PX = 4;
export const MINIMAP_GAP = 8;

export const MINIMAP_COLORS: Record<string, string> = {
  wall: '#4a4a40', floor: '#12301a', water: '#2a5a9a', chasm: '#050505',
  hazard: '#6a1a1a', bridge: '#5a4428', exit: '#2a6a2a', pillar: '#6a6458',
};

export function fitViewport(availW: number, availH: number, gridW: number, gridH: number) {
  const fitCols = Math.floor((availW - GRID_BORDER) / CELL_W);
  const fitRows = Math.floor((availH - GRID_BORDER) / CELL_H);
  const needsCamera = fitCols < gridW || fitRows < gridH;
  const minimapH = gridH * MINIMAP_PX + MINIMAP_GAP;
  const cols = Math.max(1, Math.min(gridW, fitCols));
  const rows = Math.max(1, Math.min(gridH,
    needsCamera ? Math.floor((availH - GRID_BORDER - minimapH) / CELL_H) : fitRows));
  return { cols, rows, needsCamera };
}

export function clampCam(c: Pt, gridW: number, gridH: number, cols: number, rows: number): Pt {
  return {
    x: Math.max(0, Math.min(gridW - cols, c.x)),
    y: Math.max(0, Math.min(gridH - rows, c.y)),
  };
}

export function centreOn(pos: Pt, cols: number, rows: number): Pt {
  return { x: pos.x - Math.floor(cols / 2), y: pos.y - Math.floor(rows / 2) };
}

/** Top-left of cell (x, y) in world-layer pixels. */
export function cellOrigin(x: number, y: number): { left: number; top: number } {
  return { left: GRID_BORDER / 2 + x * CELL_W, top: GRID_BORDER / 2 + y * CELL_H };
}

/** A single-tile move (orthogonal or diagonal): slide it. Anything else snaps. */
export function isStep(a: Pt, b: Pt): boolean {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) === 1;
}

/** Tiles the minimap draws: all of them, or only explored ones when fog is on. */
export function minimapTiles(grid: { width: number; height: number; tiles: string[][] }, explored?: Set<string>) {
  const out: { x: number; y: number; type: string }[] = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (explored && !explored.has(`${x},${y}`)) continue;
      out.push({ x, y, type: grid.tiles[y][x] });
    }
  }
  return out;
}
```

Note: `clampCam` for a grid smaller than the view gives `min(gridW-cols, x)`, which is at most 0 because `cols` is capped to `gridW` by `fitViewport`. The test covers it.

- [ ] **Step 4: Check it passes.** Run the same command as step 2. Expected: PASS.

- [ ] **Step 5: Commit** both files. Message: "Extract glyph-grid geometry and camera maths".

---

### Task 3: `GlyphViewport`, and `ArenaGrid` rebuilt on it (no visual change)

**Files:**
- Create: `client/src/components/grid/GlyphViewport.tsx`
- Modify: `client/src/components/ArenaGrid.tsx` (delete the camera, minimap, edge and viewport code and use `GlyphViewport`; keep the entities, board effects, path animation, `FxNumbers`/`FxOverlay`, and `getCellRect`)
- Modify: `client/src/components/ArenaView.tsx` (drop the unused `movementRange`/`isTargeting` props if you remove them from `ArenaGrid`)

**Interfaces:**
- Consumes: everything in `viewportMath` (Task 2); `TileGridView`/`EntityOverlay`.
- Produces:

```ts
export interface GlyphViewportProps {
  grid: TileGrid;
  /** Drawn inside the tile cells (TileGridView). */
  entities: EntityOverlay[];
  /** Camera target; null leaves the camera where it is. */
  focus: { x: number; y: number } | null;
  /** Arrow keys pan the camera (arena). Off in exploration, where arrows move the player. */
  panKeys: boolean;
  /** Dots on the minimap (already fog-filtered by the caller). */
  minimapUnits: { x: number; y: number; side: 'player' | 'mob' }[];
  visibleTiles?: Set<string>;
  exploredTiles?: Set<string>;
  onTileClick?: (x: number, y: number) => void;
  onTileHover?: (x: number, y: number) => void;
  onTileHoverEnd?: () => void;
  tileHighlights?: Map<string, string>;
  /** Camera glide: undefined = the CSS default (arena, 0.28s ease-out); a number = linear ms; 0 = snap. */
  cameraGlideMs?: number;
  minimapTitle?: string;
  /** World-layer ref, for callers that position overlays inside it (arena animation, fx). */
  worldRef?: React.RefObject<HTMLDivElement | null>;
  /** Rendered inside the world layer (moves with the camera). */
  children?: React.ReactNode;
}
export function GlyphViewport(props: GlyphViewportProps): JSX.Element
```

- [ ] **Step 1: Take the "before" arena screenshots** on the unchanged code.
  - Start the dev client and server (see the header).
  - Run `node scripts/sandbox-drive.mjs "duel" --wait my-turn --shot before-duel` and `node scripts/sandbox-drive.mjs "boss-rat-king" --wait my-turn --shot before-boss`. The boss room is big enough to need the camera and minimap.
  - Keep both PNG paths.

- [ ] **Step 2: Write `GlyphViewport.tsx`.** It's a move of `ArenaGrid.tsx:132-210` and `:275-313`, generalised:

```tsx
import { useEffect, useLayoutEffect, useRef, useState, useCallback, type ReactNode, type RefObject } from 'react';
import type { TileGrid } from '@caverns/shared';
import { TileGridView, type EntityOverlay } from '../TileGridView.js';
import { CELL_W, CELL_H, GRID_BORDER, PAN_STEP, MINIMAP_PX, MINIMAP_COLORS, fitViewport, clampCam as clamp, centreOn, minimapTiles } from './viewportMath.js';

export interface GlyphViewportProps { /* exactly as in Interfaces above */ }

export function GlyphViewport({
  grid, entities, focus, panKeys, minimapUnits, visibleTiles, exploredTiles,
  onTileClick, onTileHover, onTileHoverEnd, tileHighlights, cameraGlideMs,
  minimapTitle = 'Click to move the view', worldRef: worldRefProp, children,
}: GlyphViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ownWorldRef = useRef<HTMLDivElement>(null);
  const worldRef = worldRefProp ?? ownWorldRef;
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const [avail, setAvail] = useState({ w: 0, h: 0 });
  const [cam, setCam] = useState({ x: 0, y: 0 });
  // With an explicit glide, don't animate the very first placement (e.g. entering a room).
  const [settled, setSettled] = useState(false);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setAvail({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { cols, rows, needsCamera } = fitViewport(avail.w, avail.h, grid.width, grid.height);
  const clampCam = useCallback((c: { x: number; y: number }) => clamp(c, grid.width, grid.height, cols, rows),
    [grid.width, grid.height, cols, rows]);
  const view = clampCam(cam);

  useEffect(() => {
    if (!focus) return;
    setCam(clampCam(centreOn(focus, cols, rows)));
    if (avail.w > 0 && !settled) requestAnimationFrame(() => setSettled(true));
  }, [focus?.x, focus?.y, clampCam, cols, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!panKeys || !needsCamera) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[e.key];
      if (!d) return;
      e.preventDefault();
      setCam((c) => clampCam({ x: clampCam(c).x + d[0] * PAN_STEP, y: clampCam(c).y + d[1] * PAN_STEP }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panKeys, needsCamera, clampCam]);

  useEffect(() => {
    const cv = minimapRef.current;
    if (!cv || !needsCamera) return;
    cv.width = grid.width * MINIMAP_PX;
    cv.height = grid.height * MINIMAP_PX;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#070605';
    ctx.fillRect(0, 0, cv.width, cv.height);
    for (const t of minimapTiles(grid, exploredTiles)) {
      ctx.fillStyle = MINIMAP_COLORS[t.type] ?? MINIMAP_COLORS.floor;
      ctx.fillRect(t.x * MINIMAP_PX, t.y * MINIMAP_PX, MINIMAP_PX, MINIMAP_PX);
    }
    for (const u of minimapUnits) {
      ctx.fillStyle = u.side === 'player' ? '#4488ff' : '#ff4444';
      ctx.fillRect(u.x * MINIMAP_PX, u.y * MINIMAP_PX, MINIMAP_PX, MINIMAP_PX);
    }
    ctx.strokeStyle = '#d4a857';
    ctx.strokeRect(view.x * MINIMAP_PX + 0.5, view.y * MINIMAP_PX + 0.5, cols * MINIMAP_PX - 1, rows * MINIMAP_PX - 1);
  }, [needsCamera, grid, exploredTiles, minimapUnits, view.x, view.y, cols, rows]);

  const onMinimapClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * grid.width;
    const y = ((e.clientY - r.top) / r.height) * grid.height;
    setCam(clampCam({ x: Math.round(x - cols / 2), y: Math.round(y - rows / 2) }));
  };

  const transition = cameraGlideMs === undefined ? undefined
    : (!settled || cameraGlideMs === 0) ? 'none' : `transform ${cameraGlideMs}ms linear`;

  return (
    <div className="arena-grid-container glyph-grid" ref={containerRef}>
      <div className="arena-viewport" style={{ width: cols * CELL_W + GRID_BORDER, height: rows * CELL_H + GRID_BORDER }}>
        <div className="arena-world" ref={worldRef}
          style={{ transform: `translate(${-view.x * CELL_W}px, ${-view.y * CELL_H}px)`, transition }}>
          <TileGridView tileGrid={grid} entities={entities} visibleTiles={visibleTiles} exploredTiles={exploredTiles}
            onTileClick={onTileClick} onTileHover={onTileHover} onTileHoverEnd={onTileHoverEnd} tileHighlights={tileHighlights} />
          {children}
        </div>
        {view.x > 0 && <div className="arena-edge arena-edge-l" />}
        {view.x + cols < grid.width && <div className="arena-edge arena-edge-r" />}
        {view.y > 0 && <div className="arena-edge arena-edge-t" />}
        {view.y + rows < grid.height && <div className="arena-edge arena-edge-b" />}
      </div>
      {needsCamera && <canvas ref={minimapRef} className="arena-minimap" onClick={onMinimapClick} title={minimapTitle} />}
    </div>
  );
}
```

The class names (`arena-grid-container glyph-grid`, `arena-viewport`, `arena-world`, `arena-edge*`, `arena-minimap`) are kept deliberately, so all the existing glyph CSS applies to both views unchanged. Renaming them would risk the arena's look for no gain.

- [ ] **Step 3: Rebuild `ArenaGrid` on it.**
  - **Delete from `ArenaGrid.tsx`:** the constants, `MINIMAP_COLORS`, the `containerRef`/`minimapRef`/`avail`/`cam` state, the ResizeObserver, `clampCam`, the follow effect, the pan effect, the minimap effect, `onMinimapClick`, and the viewport/world/edge/minimap JSX.
  - **Keep:** `getEntityChar`, `getEntityClass`, `getCellRect`, the `unitFx`/`numbers`/`overlayFx` memos, the `entities` memo, the path-animation effect (it still uses `worldRef` and `overlayRef`), `FxNumbers`, `FxOverlay`.
  - **Keep** a `worldRef = useRef<HTMLDivElement>(null)` in `ArenaGrid` and pass it as `worldRef` to `GlyphViewport`.
  - **Render:**

```tsx
  const focusId = animatingId ?? currentTurnId;
  const focus = focusId ? positions[focusId] ?? null : null;
  const minimapUnits = useMemo(() => participants.flatMap((p) => {
    const pos = positions[p.id];
    return pos ? [{ x: pos.x, y: pos.y, side: p.type }] : [];
  }), [participants, positions]);

  return (
    <GlyphViewport grid={grid} entities={entities} focus={focus} panKeys minimapUnits={minimapUnits}
      onTileClick={onTileClick} onTileHover={onTileHover} onTileHoverEnd={onTileHoverEnd}
      tileHighlights={tileHighlights} worldRef={worldRef}
      minimapTitle="Click to move the view · arrow keys pan">
      <span ref={overlayRef} className="arena-anim-entity" style={{ display: 'none', position: 'absolute', pointerEvents: 'none' }} />
      <FxNumbers numbers={numbers} worldRef={worldRef} />
      <FxOverlay fx={overlayFx} hitLabels={hitLabels} positions={positions} worldRef={worldRef} />
    </GlyphViewport>
  );
```

  - **`focus` stability:** the object reference changes each render, but the follow effect depends on `focus?.x` and `focus?.y`, so it behaves like the old `focusPos` dependencies.
  - **Unused props:** remove `movementRange` and `isTargeting` from `ArenaGridProps` and from the `<ArenaGrid …>` call in `ArenaView.tsx`. They were unused.

- [ ] **Step 4: Run tests and typecheck.** Run `cmd.exe /c "cd client && npx vitest run && npx tsc --noEmit -p ."`. Expected: all pass, and tsc is clean.

- [ ] **Step 5: Take the "after" screenshots and compare.**
  - Restart the client if Vite didn't hot-reload.
  - Take `after-duel` and `after-boss` with the same commands as step 1.
  - Read all four PNGs. The duel and boss views must match: cells, sprites, camera framing, minimap, edge fades.
  - Also run one `--attack-nearest` shot to confirm the lunge, numbers and close-up still line up.
  - Report the paths and what you compared in the report.

- [ ] **Step 6: Commit** `GlyphViewport.tsx`, `ArenaGrid.tsx` and `ArenaView.tsx`. Message: "Extract GlyphViewport from ArenaGrid (no visual change)".

---

### Task 4: Furnishing glyph lookup and exploration entity building

**Files:**
- Modify: `client/src/glyphManifest.ts` (add `FURNISHING_GLYPHS`)
- Modify: `client/src/glyphs.ts` (add `getFurnishingGlyph`)
- Create: `client/src/exploration/explorationEntities.ts`
- Create: `client/src/exploration/explorationEntities.test.ts`
- Create: `client/src/glyphs.test.ts`

**Interfaces:**
- Consumes: `getParticipantGlyph`, and `EntityOverlay` from `components/TileGridView`.
- Produces:
  - `FURNISHING_GLYPHS: readonly string[]` (empty until Task 6).
  - `getFurnishingGlyph(id?: string): string | null`.
  - `buildExplorationEntities(input: ExplorationInput): { props: EntityOverlay[]; units: FloatUnit[] }`, with:

```ts
export interface FloatUnit { id: string; x: number; y: number; side: 'player' | 'mob'; sprite: string | null; char: string; className: string }
export interface ExplorationInput {
  interactables: { x: number; y: number; char: string; used: boolean }[];
  furnishings: { x: number; y: number; char: string; interactable: boolean; id?: string }[];
  /** Already [] when this room has a combat running. */
  mobs: { mobId: string; mobName: string; templateId?: string; x: number; y: number }[];
  players: { id: string; className: string; x: number; y: number }[];
  localPlayerId: string;
  /** undefined = no fog (show everything). */
  visibleTiles?: Set<string>;
  /** Injected so tests don't depend on shipped art. Default: getFurnishingGlyph. */
  furnishingGlyph?: (id?: string) => string | null;
}
```

- [ ] **Step 1: Write the failing tests.**

`client/src/glyphs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getFurnishingGlyph } from './glyphs.js';
import { FURNISHING_GLYPHS } from './glyphManifest.js';

describe('getFurnishingGlyph', () => {
  it('null for missing or unknown ids', () => {
    expect(getFurnishingGlyph(undefined)).toBeNull();
    expect(getFurnishingGlyph('__not_a_furnishing__')).toBeNull();
  });
  it('a sprite path for every manifest id', () => {
    for (const id of FURNISHING_GLYPHS) expect(getFurnishingGlyph(id)).toBe(`/sprites/glyphs/furnishings/${id}.png`);
  });
});
```

`client/src/exploration/explorationEntities.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CLASS_GLYPHS, MOB_GLYPHS } from '../glyphManifest.js';
import { buildExplorationEntities, type ExplorationInput } from './explorationEntities.js';

const cls = CLASS_GLYPHS[0];
const mobT = MOB_GLYPHS[0];
const base = (over: Partial<ExplorationInput> = {}): ExplorationInput => ({
  interactables: [], furnishings: [], mobs: [], players: [], localPlayerId: 'p1', ...over,
});
const withGlyph = (id?: string) => (id === 'furn_a' ? '/sprites/glyphs/furnishings/furn_a.png' : null);

describe('buildExplorationEntities', () => {
  it('players and mobs are floating units with sprites; props are inline', () => {
    const out = buildExplorationEntities(base({
      players: [{ id: 'p1', className: cls, x: 1, y: 1 }],
      mobs: [{ mobId: 'm1', mobName: 'Thing', templateId: mobT, x: 3, y: 1 }],
      furnishings: [{ x: 5, y: 1, char: '╥', interactable: false, id: 'furn_a' }],
      furnishingGlyph: withGlyph,
    }));
    expect(out.units.map((u) => u.id).sort()).toEqual(['m1', 'p1']);
    expect(out.units.find((u) => u.id === 'p1')).toMatchObject({ side: 'player', sprite: `/sprites/glyphs/classes/${cls}.png` });
    expect(out.units.find((u) => u.id === 'm1')).toMatchObject({ side: 'mob', sprite: `/sprites/glyphs/mobs/${mobT}.png` });
    expect(out.props).toEqual([expect.objectContaining({ x: 5, y: 1, sprite: '/sprites/glyphs/furnishings/furn_a.png', className: 'entity-furnishing' })]);
  });
  it('the local player is marked', () => {
    const out = buildExplorationEntities(base({ players: [{ id: 'p1', className: cls, x: 1, y: 1 }, { id: 'p2', className: cls, x: 2, y: 1 }] }));
    expect(out.units.find((u) => u.id === 'p1')!.className).toContain('entity-self');
    expect(out.units.find((u) => u.id === 'p2')!.className).not.toContain('entity-self');
  });
  it('fallbacks: unknown class → @, mob without templateId → first letter, furnishing without art → its char', () => {
    const out = buildExplorationEntities(base({
      players: [{ id: 'p1', className: '__none__', x: 1, y: 1 }],
      mobs: [{ mobId: 'm1', mobName: 'goblin', x: 2, y: 1 }],
      furnishings: [{ x: 3, y: 1, char: '╥', interactable: false, id: '__none__' }],
      furnishingGlyph: withGlyph,
    }));
    expect(out.units.find((u) => u.id === 'p1')).toMatchObject({ sprite: null, char: '@' });
    expect(out.units.find((u) => u.id === 'm1')).toMatchObject({ sprite: null, char: 'G' });
    expect(out.props[0]).toMatchObject({ sprite: null, char: '╥' });
  });
  it('an interactable furnishing (same tile as its interactable) is ONE entity: furnishing sprite + interactable class', () => {
    const out = buildExplorationEntities(base({
      interactables: [{ x: 4, y: 2, char: '⊞', used: false }],
      furnishings: [{ x: 4, y: 2, char: '⊞', interactable: true, id: 'furn_a' }],
      furnishingGlyph: withGlyph,
    }));
    expect(out.props).toHaveLength(1);
    expect(out.props[0]).toMatchObject({ x: 4, y: 2, sprite: '/sprites/glyphs/furnishings/furn_a.png', className: 'entity-interactable' });
  });
  it('plain interactables stay ASCII; used ones are dimmed', () => {
    const out = buildExplorationEntities(base({ interactables: [{ x: 1, y: 1, char: 'Ω', used: false }, { x: 2, y: 1, char: '¤', used: true }] }));
    expect(out.props).toEqual([
      expect.objectContaining({ x: 1, y: 1, char: 'Ω', sprite: null, className: 'entity-interactable' }),
      expect.objectContaining({ x: 2, y: 1, char: '¤', sprite: null, className: 'entity-interactable-used' }),
    ]);
  });
  it('fog hides props and units outside visibleTiles; undefined shows all', () => {
    const input = base({
      players: [{ id: 'p1', className: cls, x: 1, y: 1 }],
      mobs: [{ mobId: 'm1', mobName: 'x', templateId: mobT, x: 8, y: 1 }],
      interactables: [{ x: 9, y: 1, char: 'Ω', used: false }],
    });
    const fogged = buildExplorationEntities({ ...input, visibleTiles: new Set(['1,1']) });
    expect(fogged.units.map((u) => u.id)).toEqual(['p1']);
    expect(fogged.props).toEqual([]);
    const open = buildExplorationEntities(input);
    expect(open.units).toHaveLength(2);
    expect(open.props).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run them and check they fail.** Run `cmd.exe /c "cd client && npx vitest run src/glyphs.test.ts src/exploration/explorationEntities.test.ts"`. Expected: FAIL.

- [ ] **Step 3: Implement it.**

  `glyphManifest.ts`, append:

```ts
// Furnishing definition ids (server/src/data/furnishingData.json) with a glyph PNG in client/public/sprites/glyphs/furnishings/.
export const FURNISHING_GLYPHS: readonly string[] = [];
```

  `glyphs.ts`: import `FURNISHING_GLYPHS` and add:

```ts
const furnishingGlyphs = new Set<string>(FURNISHING_GLYPHS);

export function getFurnishingGlyph(id?: string): string | null {
  return id && furnishingGlyphs.has(id) ? `/sprites/glyphs/furnishings/${id}.png` : null;
}
```

  `client/src/exploration/explorationEntities.ts`:

```ts
import type { EntityOverlay } from '../components/TileGridView.js';
import { getParticipantGlyph, getFurnishingGlyph } from '../glyphs.js';

export interface FloatUnit { id: string; x: number; y: number; side: 'player' | 'mob'; sprite: string | null; char: string; className: string }
export interface ExplorationInput { /* exactly as in Interfaces above */ }

/** Exploration entities: props (furnishings, interactables) sit in tile cells; players and mobs float (they slide). */
export function buildExplorationEntities(input: ExplorationInput): { props: EntityOverlay[]; units: FloatUnit[] } {
  const glyphFor = input.furnishingGlyph ?? getFurnishingGlyph;
  const seen = (x: number, y: number) => !input.visibleTiles || input.visibleTiles.has(`${x},${y}`);

  // Props: one entity per tile. A furnishing provides the sprite; an interactable on the same tile provides the class.
  const byTile = new Map<string, EntityOverlay>();
  for (const f of input.furnishings) {
    byTile.set(`${f.x},${f.y}`, {
      x: f.x, y: f.y, char: f.char, sprite: glyphFor(f.id),
      className: f.interactable ? 'entity-interactable' : 'entity-furnishing',
    });
  }
  for (const it of input.interactables) {
    const key = `${it.x},${it.y}`;
    const cls = it.used ? 'entity-interactable-used' : 'entity-interactable';
    const existing = byTile.get(key);
    byTile.set(key, existing ? { ...existing, className: cls } : { x: it.x, y: it.y, char: it.char, sprite: null, className: cls });
  }
  const props = [...byTile.values()].filter((e) => seen(e.x, e.y));

  const units: FloatUnit[] = [];
  for (const p of input.players) {
    if (!seen(p.x, p.y)) continue;
    units.push({
      id: p.id, x: p.x, y: p.y, side: 'player', char: '@',
      sprite: getParticipantGlyph({ type: 'player', className: p.className }),
      className: p.id === input.localPlayerId ? 'entity-player entity-self' : 'entity-player',
    });
  }
  for (const m of input.mobs) {
    if (!seen(m.x, m.y)) continue;
    units.push({
      id: m.mobId, x: m.x, y: m.y, side: 'mob', char: (m.mobName[0] ?? '?').toUpperCase(),
      sprite: getParticipantGlyph({ type: 'mob', templateId: m.templateId }),
      className: 'entity-mob',
    });
  }
  return { props, units };
}
```

  (Check that `getParticipantGlyph`'s `Pick<CombatParticipant, 'type' | 'className' | 'templateId'>` accepts these object literals. If `className` or `templateId` are required there, pass `undefined` explicitly or widen the parameter type to optional fields.)

- [ ] **Step 4: Check it passes.** Run the same command as step 2 (expected: PASS). Then run the client suite and tsc.

- [ ] **Step 5: Commit** these 5 files. Message: "Furnishing glyph lookup and pure exploration entity building".

---

### Task 5: `ExplorationGrid`, with `RoomView` and the layout on it

**Files:**
- Create: `client/src/components/ExplorationGrid.tsx`
- Modify: `client/src/components/RoomView.tsx` (keep the LoS and explored logic; replace the `entities` memo and `TileGridView` with `ExplorationGrid`)
- Modify: `client/src/styles/index.css` (room layout fill, floating units, self marker, interactable glow, alert)

**Interfaces:**
- Consumes: `GlyphViewport` (Task 3), `buildExplorationEntities`/`FloatUnit` (Task 4), `cellOrigin`/`isStep`/`CELL_W`/`CELL_H` (Task 2), `prefersReducedMotion`.
- Produces:
  - `export const EXPLORE_TIMING = { stepMs: 120 } as const;`
  - `ExplorationGrid` with props `{ roomId: string; grid: TileGrid; props: EntityOverlay[]; units: FloatUnit[]; localPlayerId: string; visibleTiles?: Set<string>; exploredTiles?: Set<string>; alert: { x: number; y: number } | null }`.

- [ ] **Step 1: Write `ExplorationGrid.tsx`.**

```tsx
import { useEffect, useMemo, useRef } from 'react';
import type { TileGrid } from '@caverns/shared';
import type { EntityOverlay } from './TileGridView.js';
import { GlyphViewport } from './grid/GlyphViewport.js';
import { CELL_W, CELL_H, cellOrigin, isStep } from './grid/viewportMath.js';
import type { FloatUnit } from '../exploration/explorationEntities.js';
import { prefersReducedMotion } from '../ui/motion.js';

/** Must stay below the server's 150ms grid-move rate so held keys walk smoothly. */
export const EXPLORE_TIMING = { stepMs: 120 } as const;

interface Props {
  roomId: string;
  grid: TileGrid;
  props: EntityOverlay[];
  units: FloatUnit[];
  localPlayerId: string;
  visibleTiles?: Set<string>;
  exploredTiles?: Set<string>;
  alert: { x: number; y: number } | null;
}

export function ExplorationGrid({ roomId, grid, props, units, localPlayerId, visibleTiles, exploredTiles, alert }: Props) {
  const reduced = prefersReducedMotion();
  const me = units.find((u) => u.id === localPlayerId) ?? null;
  const minimapUnits = useMemo(() => units.map((u) => ({ x: u.x, y: u.y, side: u.side })), [units]);
  return (
    // key: a room change remounts the viewport, so the camera and units snap instead of sliding across rooms
    <GlyphViewport key={roomId} grid={grid} entities={props} focus={me ? { x: me.x, y: me.y } : null}
      panKeys={false} minimapUnits={minimapUnits} visibleTiles={visibleTiles} exploredTiles={exploredTiles}
      cameraGlideMs={reduced ? 0 : EXPLORE_TIMING.stepMs} minimapTitle="Click to look around · moving re-centres">
      <div className="explore-units">
        {units.map((u) => <FloatingUnit key={u.id} unit={u} reduced={reduced} />)}
      </div>
      {alert && (
        <span className="mob-alert explore-alert"
          style={{ left: cellOrigin(alert.x, alert.y).left, top: cellOrigin(alert.x, alert.y).top, width: CELL_W }}>!</span>
      )}
    </GlyphViewport>
  );
}

function FloatingUnit({ unit, reduced }: { unit: FloatUnit; reduced: boolean }) {
  const prev = useRef({ x: unit.x, y: unit.y });
  const slide = !reduced && isStep(prev.current, unit);
  useEffect(() => { prev.current = { x: unit.x, y: unit.y }; }, [unit.x, unit.y]);
  const { left, top } = cellOrigin(unit.x, unit.y);
  return (
    <span className={`explore-unit ${unit.className}`}
      style={{
        width: CELL_W, height: CELL_H,
        transform: `translate(${left}px, ${top}px)`,
        transition: slide ? `transform ${EXPLORE_TIMING.stepMs}ms linear` : 'none',
      }}>
      {unit.sprite ? <span className="entity-glyph" style={{ backgroundImage: `url(${unit.sprite})` }} /> : unit.char}
    </span>
  );
}
```

- [ ] **Step 2: Wire `RoomView.tsx`.**
  - Keep: the imports it still needs, `isFullyUsed`, all the store selectors, `tileGrid`, `visibleTiles`, and the explored-merge effect.
  - Replace the `entities` memo (`:101-173`) with:

```tsx
  const { props, units } = useMemo(() => {
    if (!room || !tileGrid) return { props: [], units: [] };
    const inCombatHere = !!activeCombat && activeCombat.roomId === currentRoomId;
    return buildExplorationEntities({
      interactables: (room.interactables ?? []).flatMap((inst) => {
        const def = getInteractableDefinition(inst.definitionId);
        return def ? [{ x: inst.position.x, y: inst.position.y, char: def.asciiChar, used: isFullyUsed(inst) }] : [];
      }),
      furnishings: tileGrid.furnishings ?? [],
      mobs: inCombatHere ? [] : (mobPositions[currentRoomId] ?? []),
      players: Object.values(players).flatMap((p) => {
        const pos = p.roomId === currentRoomId ? playerPositions[p.id] : undefined;
        return pos ? [{ id: p.id, className: p.className, x: pos.x, y: pos.y }] : [];
      }),
      localPlayerId: playerId,
      visibleTiles,
    });
  }, [room, tileGrid, activeCombat, players, currentRoomId, playerId, mobPositions, playerPositions, visibleTiles]);
```

  - Render:

```tsx
  return (
    <div className="room-view">
      <div className="room-title">{room.name}</div>
      <TorchHUD />
      <ExplorationGrid roomId={currentRoomId} grid={tileGrid} props={props} units={units} localPlayerId={playerId}
        visibleTiles={visibleTiles} exploredTiles={exploredTiles}
        alert={mobAlert && mobAlert.roomId === currentRoomId && visibleTiles?.has(`${mobAlert.x},${mobAlert.y}`) ? { x: mobAlert.x, y: mobAlert.y } : null} />
    </div>
  );
```

  - Remove the now-unused `CLASS_COLORS` code, and the `TileGridView` and `EntityOverlay` imports if nothing else uses them.

- [ ] **Step 3: Add the CSS** (append near the glyph-grid block in `index.css`, around line 2790):

```css
/* === Exploration on the glyph grid === */
.room-area { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.room-view { flex: 1; min-height: 0; justify-content: flex-start; }
.room-view > .arena-grid-container { width: 100%; }

/* Players and mobs float above the terrain and slide between cells */
.explore-units { position: absolute; left: 0; top: 0; pointer-events: none; z-index: 3; }
.explore-unit {
  position: absolute; left: 0; top: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 30px; line-height: 1; will-change: transform;
}
.explore-unit .entity-glyph {
  display: block; flex: none; width: 48px; height: 48px;
  background-size: 100% 100%; background-repeat: no-repeat; image-rendering: pixelated;
}
/* Always find yourself: a soft phosphor halo on the local player */
.glyph-grid .entity-self .entity-glyph { filter: drop-shadow(0 0 3px #7dff9a) drop-shadow(0 0 1px #7dff9a); }
/* Usable things glow; spent ones don't */
.glyph-grid .entity-interactable { color: #ffd98a; text-shadow: 0 0 6px #ffb000, 0 0 2px #ffb000; }
.glyph-grid .entity-interactable .entity-glyph { filter: drop-shadow(0 0 4px #ffb000); }
.glyph-grid .entity-interactable-used { opacity: 0.45; text-shadow: none; }
.explore-alert { position: absolute; z-index: 4; text-align: center; pointer-events: none; }
@media (prefers-reduced-motion: reduce) { .explore-unit { transition: none !important; } }
```

  - Adjust the layout rules if the screenshot shows `.room-view` not filling the main panel, or the log and action bar getting squeezed. Tune `min-height`/`flex`, keeping the log and action bar visible.
  - Check that the `.room-view` `min-height: 420px` rule (`index.css:1048`) doesn't fight the new flex rule.
  - Check that the existing `.mob-alert` animation still works with `position: absolute`.
  - `.glyph-grid .entity-player`/`.entity-mob` already draw the faction underline, and they apply to `.explore-unit` too because they're scoped to `.glyph-grid`.

- [ ] **Step 4: Run tests and typecheck.** Run `cmd.exe /c "cd client && npx vitest run && npx tsc --noEmit -p ."`. Expected: PASS.

- [ ] **Step 5: Check it visually.**
  - Start the dev servers.
  - Read `.sandbox/explore-shot.mjs` and extend its steps if needed (it's git-ignored, so edits are local). Capture:
    - the dungeon entrance with fog;
    - mid-walk: press and hold a direction and screenshot about 60ms into a step;
    - a visible mob (and its alert if you can trigger one);
    - furnishings (ASCII until Task 6);
    - an interactable with the glow;
    - a room change through an exit;
    - the minimap in a large room.
  - Read the screenshots. Confirm:
    - the camera centres on the player;
    - the explored-dim versus visible-bright fog reads correctly;
    - there's no double-drawn prop;
    - mob letters or sprites appear only in visible tiles;
    - the arena still looks as before (one sandbox duel shot).
  - List the paths and your observations in the report.

- [ ] **Step 6: Commit** `ExplorationGrid.tsx`, `RoomView.tsx` and `index.css`. Message: "Exploration renders on the glyph grid: sprites, follow camera, tweened steps, fog minimap".

---

### Task 6: Furnishing sprites (PixelLab, user-approved)

**Files:**
- Create: `scripts/glyphs/furnishing-prompts.mjs` (builds the prompts from `server/src/data/furnishingData.json`)
- Create: `art/candidates/furnishings/raw/*.png`, `art/candidates/furnishings/_sheet.png`, `art/candidates/furnishings/chosen.json`, `art/candidates/furnishings/jobs.txt`
- Create: `client/public/sprites/glyphs/furnishings/<id>.png`
- Modify: `client/src/glyphManifest.ts` (`FURNISHING_GLYPHS` = the installed ids)

**This task has a user approval gate: generate, build the contact sheet, then STOP. The controller shows the user and relays their picks. Install only the picked candidates.**

- [ ] **Step 1: Learn the glyph recipe.**
  - Read `art/candidates/glyphs/chosen.json` and the message of commit `e7d9de1` (`git.exe show --stat e7d9de1`, and the message) for how the mob and class glyphs were made: the tool, the size and the cleanup.
  - Known facts:
    - PixelLab `create_1_direction_object` at 24px returns 64 candidates per call.
    - Glyphs are normalised bottom-aligned and drawn at 48×48.
    - Sheet grid lines are stripped and edge fragments dropped.
    - Portrait style references can't be used with the 24px object tool.

- [ ] **Step 2: Check the budget.**
  - Load the PixelLab tools with ToolSearch: `get_balance`, `create_1_direction_object`, `get_object` (or whatever get tool the create result names).
  - Call `get_balance`.
  - The subscription is exhausted until 2026-10-23, so this runs on credits.
  - Report the balance and the estimated spend (22 calls) back to the controller **before** generating, and stop there. The controller confirms with the user.

- [ ] **Step 3: Generate (after the controller confirms).**
  - `furnishing-prompts.mjs` reads `furnishingData.json` and, for each entry, prints `{ id, prompt }`, where the prompt is: `"<name>, a piece of cave furniture, strange post-collapse relic-tech, multi-colour pixel-art game object, top-down 3/4 view, isolated on transparent background, no floor"`, with the biome in the style clause. It never hand-writes per-item prompts.
  - Submit one job per furnishing, at most 10 at a time.
  - Save candidates to `art/candidates/furnishings/raw/<id>-<n>.png` (keep at most 8 per id: the first 8 usable, non-fragment candidates).
  - Record job ids in `jobs.txt`.
  - Clean and normalise as the arena glyphs were: 24×24, bottom-aligned, transparent.

- [ ] **Step 4: Build the contact sheet.**
  - `art/candidates/furnishings/_sheet.png`: one row per furnishing, labelled `<id>`, candidates labelled `-<n>`, upscaled 2× nearest-neighbour, on a dark background like the game's cells. (python3 + Pillow is available in WSL.)
  - Read the sheet and recommend a pick per id, with one-line reasons (reads at 48px, relic-tech style, matches its name).
  - **STOP and report.** Don't install.

- [ ] **Step 5: Install the user's picks** (the controller relays them).
  - Copy each pick to `client/public/sprites/glyphs/furnishings/<id>.png`.
  - Set `FURNISHING_GLYPHS` to the installed ids (in `furnishingData.json` order).
  - Write `art/candidates/furnishings/chosen.json` with `{ id: { file, job_id, index, prompt } }`.
  - Run `cmd.exe /c "cd client && npx vitest run src/glyphs.test.ts && npx tsc --noEmit -p ."`. This checks that every manifest id resolves.
  - Take one exploration screenshot showing furnishings with sprites.

- [ ] **Step 6: Commit** the installed PNGs, `glyphManifest.ts`, the script, `art/candidates/furnishings/{_sheet.png,chosen.json,jobs.txt}` and the raw candidates. Message: "Art: furnishing glyph sprites".

---

### Task 7: Verification, docs and memory

**Files:**
- Modify: `CLAUDE.md` (the exploration line under "What's Working"; `GlyphViewport` in the project structure)

- [ ] **Step 1: Full suites.** Run shared, roomgrid, itemgen, server (to a log; read every `×`), and client (vitest + tsc), plus server tsc. Everything must be green.
- [ ] **Step 2: `CLAUDE.md`.**
  - Under "What's Working", add: "Exploration renders on the shared glyph grid (`client/src/components/grid/GlyphViewport.tsx`): class/mob/furnishing sprites, follow camera, tweened steps, fog-aware minimap. Interactables stay ASCII with a glow."
  - In the project structure, add `components/grid/` (GlyphViewport, viewportMath), `ExplorationGrid.tsx`, and `exploration/explorationEntities.ts`.
  - Commit `CLAUDE.md` alone. If it already has unrelated uncommitted edits by the user, don't commit it: interactive staging (`add -p`) isn't available. Report it instead.
- [ ] **Step 3: Memory.** Store a thinker `decision` memory (load `mcp__thinker__memory_store` via ToolSearch) with:
  - the `GlyphViewport` split (inline versus floating units, `cameraGlideMs`, kept `arena-*` class names);
  - `EXPLORE_TIMING.stepMs`;
  - the furnishing art recipe and where the picks live;
  - that `mob_spawn` carries `templateId`.
