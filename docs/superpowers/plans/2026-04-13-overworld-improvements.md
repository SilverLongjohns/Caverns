# Overworld Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the starter overworld feel like a proper town + menacing dungeon approach: dungeon-style hard walls, NPC houses with signs, pillars flanking the dungeon portal, and party-union line-of-sight with seen-once fog of war.

**Architecture:** Reuse existing infrastructure wherever possible. `TileGridView` already renders `visibleTiles`/`exploredTiles` with three-state fog and supports per-tile `themes`. `@caverns/roomgrid` already exports `getVisibleTiles` with Bresenham LoS. The overworld map just needs (a) a themes grid so walls render with the dungeon rock palette, (b) new tile kinds for house walls / pillars / signs, (c) client-side LoS computation from the party union, and (d) a `visitedTiles` Set on the client that accumulates across overworld ticks.

**Tech Stack:** TypeScript, React, Zustand, `@caverns/roomgrid` LoS utilities, existing `TileGridView` rendering.

---

## File Structure

**Shared (`shared/src/overworld.ts`):**
- Extend `TileKind` with `'pillar'`.
- Add optional `themes?: (string | null)[][]` to `OverworldMap`.
- Extend `OverworldInteractable.kind` with `'sign'` and add optional `tooltip?: string`.
- Re-author `STARTER_ROWS` so the town has 2–3 small houses with door-gap openings and the dungeon entrance is flanked by pillar tiles. Add sign interactables outside each house.
- Emit a themes grid mapping every `wall` to `'rock'`, `floor` (dungeon portal tile) to `'dirt'`, etc., so the overworld borrows the dungeon-standard palette.

**Client:**
- `client/src/store/gameStore.ts` — add `visitedTiles: Record<string, Set<string>>` keyed by worldId; compute on every `world_state` / `overworld_tick`.
- `client/src/components/WorldView.tsx` — compute `visibleTiles` each render (party union via `getVisibleTiles`), pass both sets and the map's `themes` grid to `TileGridView`.
- `client/src/components/SignTooltip.tsx` (new) — cursor-follow tooltip rendered when hovering a sign tile.
- `client/src/styles/index.css` — minor additions: `.tile-pillar`, sign glyph color, tooltip styling.

---

### Task 1: Add pillar + sign types and theme grid to overworld

**Files:**
- Modify: `shared/src/overworld.ts`

- [ ] **Step 1: Extend types**

```ts
export type TileKind =
  | 'floor'
  | 'wall'
  | 'grass'
  | 'path'
  | 'water'
  | 'town_floor'
  | 'door'
  | 'pillar';

export interface OverworldInteractable {
  id: string;
  x: number;
  y: number;
  kind: 'stash' | 'npc' | 'shop' | 'sign';
  label: string;
  shopId?: string;
  tooltip?: string;
}

export interface OverworldMap {
  id: string;
  name: string;
  width: number;
  height: number;
  tiles: TileKind[][];
  themes?: (string | null)[][];
  spawnTile: { x: number; y: number };
  regions: OverworldRegion[];
  portals: OverworldPortal[];
  interactables: OverworldInteractable[];
}
```

- [ ] **Step 2: Update LEGEND and add `isWalkable` pillar rule**

```ts
const LEGEND: Record<string, TileKind> = {
  '#': 'wall',
  '.': 'grass',
  '-': 'path',
  '~': 'water',
  ':': 'town_floor',
  '+': 'door',
  'f': 'floor',
  'P': 'pillar',
};

export function isWalkable(kind: TileKind): boolean {
  return kind !== 'wall' && kind !== 'water' && kind !== 'pillar';
}
```

- [ ] **Step 3: Redesign `STARTER_ROWS`**

Replace the existing 40×40 ASCII with 2–3 discrete houses inside the town bounds (each with an interior `:` floor, `#` walls, one `.` grass door-gap opening onto the central path), spawn remains at (6,14), portal floor stays `f` at (37,15) flanked by pillars `P` at (37,13), (37,17), (36,14), (36,16), (38,14), (38,16). Keep the water patch. Ensure each row is exactly 40 chars.

- [ ] **Step 4: Build a themes grid in `STARTER_MAP`**

```ts
function buildStarterThemes(tiles: TileKind[][]): (string | null)[][] {
  return tiles.map((row) =>
    row.map((t) => {
      if (t === 'wall' || t === 'pillar') return 'rock';
      if (t === 'floor') return 'dirt';
      return null;
    }),
  );
}

const STARTER_TILES = parseRows(STARTER_ROWS);
const STARTER_MAP: OverworldMap = {
  // ...existing fields...
  tiles: STARTER_TILES,
  themes: buildStarterThemes(STARTER_TILES),
  // ...
};
```

- [ ] **Step 5: Add sign interactables**

Place one `{ kind: 'sign', ... tooltip: '...' }` entry per house beside its door (e.g. stash sign, shop sign). Give them distinct ids (`starter_sign_stash`, `starter_sign_shop`).

- [ ] **Step 6: Build shared workspace**

Run: `npm run build --workspace=shared`
Expected: clean tsc.

- [ ] **Step 7: Commit**

```bash
git add shared/src/overworld.ts
git commit -m "feat(overworld): add pillar/sign tiles, theme grid, house layout"
```

---

### Task 2: Client renders new tiles with dungeon theme

**Files:**
- Modify: `client/src/components/TileGridView.tsx`
- Modify: `client/src/components/WorldView.tsx`
- Modify: `client/src/styles/index.css`

- [ ] **Step 1: Map pillar tile in TileGridView charLookup**

Ensure pillar renders as `‖` (or `▌`) and picks up `tile-pillar` class. The existing `tile-wall.tile-theme-rock` styling covers regular walls; pillars use their own class so they visually pop.

- [ ] **Step 2: Pass `themes` into TileGridView from WorldView**

In `WorldView.tsx`, when building the grid for `TileGridView`, pass `themes={map.themes}` (fall back to `undefined` if absent).

- [ ] **Step 3: Add pillar + sign CSS**

```css
.tile-pillar { color: #8a8070; text-shadow: 0 0 3px rgba(138, 128, 112, 0.4); }
.tile-sign   { color: #d9b36a; }
```

- [ ] **Step 4: Manual verify**

Run dev client, join starter world, confirm walls render with dungeon rock theme and pillars flank the portal.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/TileGridView.tsx client/src/components/WorldView.tsx client/src/styles/index.css
git commit -m "feat(client): render overworld pillars + themed walls"
```

---

### Task 3: Sign interactables with cursor-follow tooltip

**Files:**
- Create: `client/src/components/SignTooltip.tsx`
- Modify: `client/src/components/WorldView.tsx`

- [ ] **Step 1: SignTooltip component**

```tsx
import { useEffect, useState } from 'react';

export function SignTooltip({ text }: { text: string | null }) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const onMove = (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);
  if (!text) return null;
  return (
    <div
      className="sign-tooltip"
      style={{ left: pos.x + 14, top: pos.y + 14 }}
    >
      {text}
    </div>
  );
}
```

Add minimal CSS (`position: fixed; pointer-events: none; background: #1a1812; border: 1px solid #d9b36a; padding: 4px 8px;`).

- [ ] **Step 2: Hover detection in WorldView**

Track `hoveredSign: string | null`. When the grid cell under the pointer contains a sign interactable, set its tooltip text; clear otherwise. Render `<SignTooltip text={hoveredSign} />`.

- [ ] **Step 3: Signs are non-interactive on click**

`sign` kind should NOT open any modal or send `overworld_interact`. They exist purely for tooltips.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/SignTooltip.tsx client/src/components/WorldView.tsx client/src/styles/index.css
git commit -m "feat(overworld): cursor-follow sign tooltips"
```

---

### Task 4: Party-union line-of-sight + seen-once fog

**Files:**
- Modify: `client/src/store/gameStore.ts`
- Modify: `client/src/components/WorldView.tsx`

- [ ] **Step 1: Add `visitedTiles` to store**

```ts
visitedTiles: Record<string, Set<string>>; // key: worldId, value: "x,y" set
```

Initialize empty. On `world_state`, ensure an entry for `worldId` exists. On initial entry (new world or rejoin), seed with the spawn tile only — do NOT pre-seed with party positions or the full map.

- [ ] **Step 2: Adapt roomgrid LoS for overworld tiles**

`getVisibleTiles` expects `Tile[][]` with a `.type` field. Build a lightweight adapter inside `WorldView.tsx`:

```ts
import { getVisibleTiles } from '@caverns/roomgrid';

function toLosTiles(map: OverworldMap) {
  return map.tiles.map((row) =>
    row.map((kind) => ({
      type: kind === 'wall' || kind === 'pillar' ? 'wall' : 'floor',
    })),
  );
}
```

Only `wall` and `pillar` block LoS. Doors are decorative gaps already rendered as grass.

- [ ] **Step 3: Compute visible set each render**

```ts
const losTiles = useMemo(() => toLosTiles(map), [map]);
const visible = useMemo(() => {
  const set = new Set<string>();
  for (const m of members) {
    for (const p of getVisibleTiles(losTiles, { x: m.pos.x, y: m.pos.y }, 200)) {
      set.add(`${p.x},${p.y}`);
    }
  }
  return set;
}, [losTiles, members]);
```

Use a large range (200) so LoS is effectively distance-unlimited; walls/pillars are the only constraint.

- [ ] **Step 4: Fold visible into visitedTiles**

After computing `visible`, dispatch a store action that unions it into `visitedTiles[worldId]`. Persist the serialized set to `localStorage` keyed by worldId so fog survives reloads.

- [ ] **Step 5: Pass sets to TileGridView**

```tsx
<TileGridView
  tiles={...}
  themes={map.themes}
  visibleTiles={visible}
  exploredTiles={store.visitedTiles[worldId]}
/>
```

Remember `TileGridView` already hides entities on explored-but-not-visible tiles; that's what we want. Interactables and portals must stay visible on remembered tiles — handle that by rendering portals/interactables as a separate overlay above the grid (or by whitelisting those tile positions in the visible set). Simplest: keep an `alwaysVisible` set of interactable + portal coordinates and union it into `visible` before passing down.

- [ ] **Step 6: Manual smoke test**

Walk the party through the town. Confirm:
- Spawn tile only is visible on first entry.
- Walls block LoS (you can't see inside houses until you step through the doorway).
- Previously visited tiles render dimmed with no enemies/players on them.
- Shops/stash/portal icons remain visible on remembered tiles.
- Reloading the page preserves fog.

- [ ] **Step 7: Commit**

```bash
git add client/src/store/gameStore.ts client/src/components/WorldView.tsx
git commit -m "feat(overworld): party-union LoS with seen-once fog"
```

---

### Task 5: Final smoke pass

- [ ] Start dev server + client, join starter world, verify every change visually.
- [ ] Hover each sign → tooltip shows correct text near cursor.
- [ ] Approach dungeon portal → pillars visible, menacing.
- [ ] Step one tile into a house → interior revealed; step back out → interior dims to remembered state with entities hidden.
- [ ] Reload browser → fog state persists.
- [ ] Run `npm run build --workspace=shared && npm run build --workspace=client`.

---

## Self-Review Notes

- Pillar tiles are non-walkable AND block LoS (new tile kind added to both `isWalkable` and the LoS adapter).
- Doors are purely decorative gaps; no new door handling required.
- `getVisibleTiles` is reused unchanged — no new LoS code.
- `TileGridView`'s existing three-state rendering is reused — no new rendering code.
- Persistence is localStorage only; server does not track overworld fog.
