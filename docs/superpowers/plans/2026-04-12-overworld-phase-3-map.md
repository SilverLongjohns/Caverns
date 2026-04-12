# Overworld Phase 3 — Map Rendering & Static Town

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **No git commits — user manages git themselves. Skip any commit steps.**

**Goal:** Replace the Phase 2 stub `WorldView` with a real rendered tile map. Ship one hand-authored overworld map containing one town, a spawn tile, a stash-NPC interactable marker, and a dungeon-portal marker. Characters appear on the map at their spawn or last-known position. No movement and no interactions yet — clicking a tile does nothing, stepping onto the stash or portal does nothing. Those come in Phases 4–6.

**Context:** `docs/superpowers/plans/2026-04-12-overworld-feature.md`

**Depends on:** Phase 2 (`docs/superpowers/plans/2026-04-12-overworld-phase-2-session.md`) — `WorldSession`, `worldConnections`, `currentView === 'in_world'`, stub `WorldView` component this phase replaces.

**Ships alone.** Do not bundle with Phase 4 — Phase 4 (movement + tick loop) is a focused-review phase.

---

## Decisions locked in this phase

1. **Map authoring lives in code.** `shared/src/overworld.ts` defines types and exports `OVERWORLD_MAPS: Record<string, OverworldMap>`. V1 ships one map with id `'starter'`. No JSON files, no runtime loader, no editor.
2. **One map per world for v1.** Every world uses the `'starter'` map. Later, worlds can reference a map ID or a procedural seed, but for now `WorldSession` hardcodes the starter map lookup. Flagged as a TODO in the session constructor.
3. **Tile palette is a strict enum.** `floor | wall | grass | path | water | town_floor | door`. The server and client both understand the same set. Adding tiles later is a shared-types change. No ad-hoc strings.
4. **Map size: 40×40.** Big enough to feel like an overworld, small enough that every player's screen can show the whole map without camera math. Phase 3 does not introduce a viewport — the full map renders, the character sprites are just overlays. Camera/scroll is a Phase 4.5 concern if the map grows.
5. **Reuse `TileGridView` as-is.** The existing dungeon renderer already takes a `tileGrid` + `entities` overlay list and supports `visibleTiles`/`exploredTiles` for fog of war. For the overworld, pass no `visibleTiles` arg so everything renders fully visible (the component already treats absent = fully visible). Characters render as `EntityOverlay` rows.
6. **CSS classes follow the existing convention.** New tile types get `.tile-floor`, `.tile-grass`, `.tile-path`, `.tile-town_floor`, `.tile-door`, etc. — matching the `tile-{type}` pattern the dungeon renderer already relies on. Styles live in `client/src/styles/index.css` next to the existing tile classes.
7. **Character overlay = single char.** Phase 3 renders each member as a single ASCII char (`@` for self, `o` for others), colored by class. Fancier sprites are not in scope.
8. **Server holds authoritative positions.** On `WorldSession.addConnection`, the server reads the character's `overworld_pos` from the DB; if null, it uses the map's `spawnTile`. The position is included in `world_state` and `world_member_joined` broadcasts.
9. **No persistence of position changes this phase.** Since nothing moves, `overworld_pos` is read-only in Phase 3. Phase 4 writes it.

---

## File structure

### New files

**Shared:**
- `shared/src/overworld.ts` — `TileKind`, `OverworldRegion`, `OverworldPortal`, `OverworldInteractable`, `OverworldMap` types + `OVERWORLD_MAPS` export
- `shared/src/overworld.test.ts` — map integrity tests (spawn tile walkable, portals on walkable tiles, etc.)

**Client:**
- `client/src/components/WorldMapView.tsx` — wraps `TileGridView`, subscribes to world state, renders character overlays

### Modified files

**Shared:**
- `shared/src/index.ts` — re-export `overworld` module
- `shared/src/messages.ts` — `world_state` gains a `map: OverworldMap` field; `WorldMemberSummary` gains a `pos: { x: number; y: number }` field

**Server:**
- `server/src/WorldSession.ts` — constructor loads the map, `addConnection` resolves positions, `world_state` includes map + positions, broadcasts include positions
- `server/src/WorldSession.test.ts` — extend lifecycle tests with position resolution assertions

**Client:**
- `client/src/components/WorldView.tsx` — replaces stub body with `<WorldMapView />` + the existing "members" sidebar
- `client/src/store/gameStore.ts` — add `worldMap: OverworldMap | null`, store member positions in `worldMembers[].pos`, handle `world_state` / `world_member_joined` updates to carry positions
- `client/src/styles/index.css` — add overworld tile CSS classes

### Files NOT touched in Phase 3

- `server/src/index.ts` — no routing changes
- `client/src/hooks/useGameActions.ts` — no new senders
- Anything related to movement, ticks, pathfinding, or interaction

---

## Task list

### Task 1: Shared overworld types

**Files:**
- Create: `shared/src/overworld.ts`
- Modify: `shared/src/index.ts`

- [ ] **Step 1: Define the types**

```ts
export type TileKind =
  | 'floor'        // generic walkable outdoor
  | 'wall'         // impassable
  | 'grass'        // walkable, outdoor visual
  | 'path'         // walkable, road visual
  | 'water'        // impassable, animated (reuses dungeon water renderer)
  | 'town_floor'   // walkable, town interior
  | 'door';        // walkable, region boundary marker

export interface OverworldRegion {
  id: string;
  name: string;            // "Whispering Hollow"
  kind: 'town' | 'wild';
  bounds: { x: number; y: number; width: number; height: number };
}

export interface OverworldPortal {
  id: string;
  x: number;
  y: number;
  dungeonKind: 'standard'; // extensible
  label?: string;
}

export interface OverworldInteractable {
  id: string;
  x: number;
  y: number;
  kind: 'stash' | 'npc'; // v1 just has stash; 'npc' is a placeholder
  label: string;
}

export interface OverworldMap {
  id: string;
  name: string;
  width: number;
  height: number;
  tiles: TileKind[][];       // [y][x]
  spawnTile: { x: number; y: number };
  regions: OverworldRegion[];
  portals: OverworldPortal[];
  interactables: OverworldInteractable[];
}

export function isWalkable(kind: TileKind): boolean {
  return kind !== 'wall' && kind !== 'water';
}

export function getTile(map: OverworldMap, x: number, y: number): TileKind | null {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
  return map.tiles[y][x];
}
```

- [ ] **Step 2: Author the starter map**

Create `'starter'` — a 40×40 map. Hand-draw it inline in the file as a string array then convert to the `TileKind[][]` shape. Shape guidance:

- Outer border: `wall`
- Bulk of the map: `grass`
- A town in the top-left quadrant (~10×10 `town_floor`) surrounded by `wall` with two `door` tiles on the east and south edges
- Inside the town: one `stash` interactable near the middle
- A `path` running from the town doors to two landmarks: the map spawn point (south-center on `grass`) and a dungeon portal (east edge, marked `floor` with a portal entry above it)
- Scattered `water` tiles for visual interest
- Spawn tile: a walkable tile just outside the town's south door

Keep it ugly but correct. Aesthetics come later.

- [ ] **Step 3: Export via `OVERWORLD_MAPS`**

```ts
export const OVERWORLD_MAPS: Record<string, OverworldMap> = {
  starter: /* ... */,
};
```

- [ ] **Step 4: `shared/src/index.ts` re-export**

```ts
export * from './overworld.js';
```

### Task 2: Map integrity tests

**Files:**
- Create: `shared/src/overworld.test.ts`

- [ ] **Step 1: Assertions for the starter map**

- `tiles` has exactly `height` rows and each row has exactly `width` columns
- `spawnTile` is in bounds and on a walkable tile
- Every portal is in bounds and on a walkable tile
- Every interactable is in bounds and on a walkable tile
- Every region's bounds are in bounds
- The map is connected: a BFS from `spawnTile` reaches every portal and every interactable, traversing only walkable tiles
- No duplicate portal IDs, no duplicate interactable IDs

The connectivity test is the important one — a hand-authored map is very easy to break by accidentally walling off the town.

### Task 3: Message + summary types

**Files:**
- Modify: `shared/src/messages.ts`

- [ ] **Step 1: Extend `WorldMemberSummary`**

```ts
export interface WorldMemberSummary {
  connectionId: string;
  characterId: string;
  characterName: string;
  displayName: string;
  className: string;
  level: number;
  pos: { x: number; y: number };
}
```

- [ ] **Step 2: Extend `world_state`**

```ts
| {
    type: 'world_state';
    worldId: string;
    worldName: string;
    map: OverworldMap;
    members: WorldMemberSummary[];
  }
```

Import `OverworldMap` from `./overworld.js`.

- [ ] **Step 3: `world_member_joined` already carries `member`**

No structural change — but the summary it embeds now includes `pos` via the type update in Step 1. Document that other members receive the joiner's starting position via this message.

### Task 4: `WorldSession` map + positions

**Files:**
- Modify: `server/src/WorldSession.ts`
- Modify: `server/src/WorldSession.test.ts`

- [ ] **Step 1: Load the map in the constructor**

```ts
import { OVERWORLD_MAPS } from '@caverns/shared';
import type { OverworldMap } from '@caverns/shared';

// in constructor:
// TODO(post-v1): resolve map ID from worldRepo row. For now, every world uses 'starter'.
this.map = OVERWORLD_MAPS.starter;
if (!this.map) throw new Error('starter overworld map missing');
```

Hold it as `private readonly map: OverworldMap`.

- [ ] **Step 2: Extend `WorldSessionMember` with `pos`**

```ts
export interface WorldSessionMember {
  // ... existing fields
  pos: { x: number; y: number };
}
```

- [ ] **Step 3: Resolve position on `addConnection`**

Caller (index.ts) passes in the character row. Inside `addConnection`:

```ts
const startPos = resolveStartPos(character.overworld_pos, this.map);
const member: WorldSessionMember = { ...args, pos: startPos };
```

Helper:

```ts
function resolveStartPos(saved: { x: number; y: number } | null, map: OverworldMap) {
  if (saved && isWalkable(getTile(map, saved.x, saved.y) ?? 'wall')) {
    return saved;
  }
  return map.spawnTile;
}
```

The walkability check defends against a saved position that landed on a now-impassable tile due to map edits — fall back to spawn.

- [ ] **Step 4: Include map in `world_state`**

The `world_state` payload sent to the joining connection becomes:

```ts
{
  type: 'world_state',
  worldId: this.worldId,
  worldName: this.worldName,
  map: this.map,
  members: this.getMembers(), // summaries with positions
}
```

`getMembers()` maps `WorldSessionMember` → `WorldMemberSummary`, including `pos`.

- [ ] **Step 5: `world_member_joined` includes position**

Broadcast to other members carries the new member's summary with `pos`. No extra work beyond the type update — the summary includes position now.

- [ ] **Step 6: Update `WorldSession.addConnection` signature**

Accept the full character row (or at least the `overworld_pos` field) so the session can resolve positions without hitting the DB itself. Document that the caller is responsible for fetching the character before calling `addConnection`.

- [ ] **Step 7: Extend lifecycle tests**

Add tests:
- First joiner with `overworld_pos: null` → position set to `spawnTile`
- First joiner with a valid saved position → position preserved
- First joiner with a saved position on a wall tile → fallback to spawn
- `world_state` payload sent to the joiner contains the map and all member positions
- `world_member_joined` broadcast contains the new member's position

### Task 5: Server routing — pass character row

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: `select_character` passes position to `WorldSession`**

The existing `select_character` handler already fetches the character row via `characterRepo.getById` (Phase 1). Pass that whole row (or the `overworld_pos` field) into `session.addConnection` as part of the member args.

This is a small change — just ensure `addConnection` gets everything it needs in one call, no N+1 DB hits inside the session.

### Task 6: Client store

**Files:**
- Modify: `client/src/store/gameStore.ts`

- [ ] **Step 1: Add `worldMap` state**

```ts
worldMap: OverworldMap | null;
```

Initialized to `null`.

- [ ] **Step 2: `world_state` handler stores map + members**

```ts
case 'world_state':
  set({
    currentWorld: { id: msg.worldId, name: msg.worldName },
    worldMap: msg.map,
    worldMembers: msg.members,
  });
  recomputeView();
  break;
```

- [ ] **Step 3: `world_member_joined` / `world_member_left` update with positions**

`world_member_joined` adds the new member (with its `pos`) to the list. `world_member_left` removes by `connectionId`.

- [ ] **Step 4: Clear on leave/logout**

Also clear `worldMap` in the existing leave/logout cleanup path.

### Task 7: `WorldMapView` component

**Files:**
- Create: `client/src/components/WorldMapView.tsx`

- [ ] **Step 1: Component shape**

```tsx
export function WorldMapView() {
  const worldMap = useGameStore((s) => s.worldMap);
  const worldMembers = useGameStore((s) => s.worldMembers);
  const myConnectionId = useGameStore((s) => s.playerId);

  if (!worldMap) return null;

  const tileGrid = useMemo(() => ({
    width: worldMap.width,
    height: worldMap.height,
    tiles: worldMap.tiles, // TileGridView expects string[][], TileKind is a string subtype
    themes: undefined,
  }), [worldMap]);

  const entities: EntityOverlay[] = useMemo(() => {
    const list: EntityOverlay[] = [];

    // Interactables first so characters render on top
    for (const it of worldMap.interactables) {
      list.push({
        x: it.x,
        y: it.y,
        char: it.kind === 'stash' ? '$' : '!',
        className: 'overworld-interactable',
      });
    }
    for (const p of worldMap.portals) {
      list.push({ x: p.x, y: p.y, char: '>', className: 'overworld-portal' });
    }
    for (const m of worldMembers) {
      const isSelf = m.connectionId === myConnectionId;
      list.push({
        x: m.pos.x,
        y: m.pos.y,
        char: isSelf ? '@' : 'o',
        className: `overworld-member class-${m.className}${isSelf ? ' overworld-self' : ''}`,
      });
    }

    return list;
  }, [worldMap, worldMembers, myConnectionId]);

  return <TileGridView tileGrid={tileGrid} entities={entities} />;
}
```

- [ ] **Step 2: Handle entity stacking**

If two members stand on the same tile, `TileGridView` will draw whichever comes last in the entities array. That's acceptable for Phase 3. Collision and multi-occupant rendering are Phase 4+ concerns.

### Task 8: `WorldView` body swap

**Files:**
- Modify: `client/src/components/WorldView.tsx`

- [ ] **Step 1: Replace stub body**

Replace the Phase 2 placeholder body with:

- Left column: `<WorldMapView />` wrapped in a container that centers the map
- Right column: the existing "members online" list from the stub (keep it — useful for seeing the party even if the map gets busy)
- Bottom: "Leave World" button (existing)

Layout mimics the `game-layout` + `main-column` + `side-column` pattern used by the in-game view. Reuse those CSS classes if possible so the overworld screen feels consistent with the rest of the app.

### Task 9: Tile CSS

**Files:**
- Modify: `client/src/styles/index.css`

- [ ] **Step 1: Add overworld tile classes**

Near the existing `.tile-floor`, `.tile-wall`, `.tile-water` rules, add:

- `.tile-grass` — dim green on dark
- `.tile-path` — warm gray, slightly brighter than grass
- `.tile-town_floor` — wood-tone
- `.tile-door` — yellow/gold accent

The exact colors are creative — aim for consistency with the existing CRT palette. Each rule needs both the base color and the `.tile-explored` variant (dimmer) in case fog ever comes to the overworld.

- [ ] **Step 2: Overlay classes**

- `.overworld-interactable` — bright cyan, slight pulse animation
- `.overworld-portal` — red/orange with glow
- `.overworld-member` — class-colored
- `.overworld-self` — brighter, maybe with the existing `.level-up-glow`-like subtle effect
- `.overworld-member.class-vanguard`, `.overworld-member.class-cleric`, etc. — per-class accent colors (pull from `classData.ts` if those colors already exist)

- [ ] **Step 3: Layout classes**

Any `.world-layout` / `.world-map-container` / `.world-side-column` rules needed for Task 8's layout. Keep them next to the existing `.game-layout` section.

### Task 10: Smoke test

- [ ] **Step 1: Single-player map render**

1. Log in → create world → create character → select character.
2. Expect: `WorldView` renders the starter map, with `@` on the spawn tile, the stash `$` inside the town, and the portal `>` at its authored position.
3. Resize the browser. Expect: map stays rendered, no layout breakage. (If it does break, that's CSS to fix in Task 9 — don't defer.)

- [ ] **Step 2: Multiplayer map render**

1. Second tab → join world → create character → select character.
2. Expect: tab 1 sees a second `o` sprite appear on the spawn tile. Tab 2 sees its own `@` plus tab 1's `o`.
3. Close tab 2. Expect: tab 1 sees the `o` disappear after WorldSession teardown logic runs.

- [ ] **Step 3: Position persistence (plumbing only)**

`overworld_pos` stays `null` for characters because nothing writes it. Verify in the DB directly: `SELECT id, name, overworld_pos FROM characters;` — all should have `null` or `{"x": ..., "y": ...}` only if something else populated them. Either outcome is fine for Phase 3; this test is just a sanity check that nothing errors.

- [ ] **Step 4: Regression check**

Exit the world → return to character select → re-enter. Expect: map still renders, no stale state from the previous visit leaking through.

---

## Known rough edges to leave alone

- **No camera.** The whole 40×40 map renders at once. If it doesn't fit on a small screen, add scrolling in Phase 4.5, not now.
- **Entity stacking.** Multiple characters on the same tile render as a single char. Acceptable until Phase 4 introduces movement and stacking becomes visible.
- **No tooltips.** Hovering a portal or stash does nothing. The authored `label` fields exist but aren't rendered. Fine.
- **Static map for every world.** Every world loads `'starter'`. If you want to smoke-test multiple worlds, they all look identical. Flagged as TODO.

---

## Open questions to resolve during implementation

1. **`TileGridView` string-type assumption.** It takes `tiles: string[][]` and internally uses `getTileChar` from `@caverns/roomgrid`. Will that work with `TileKind` strings it has never seen? Check before Task 7. If it doesn't, two options: (a) extend `getTileChar` to handle overworld tile kinds, or (b) introduce a `charLookup` prop on `TileGridView` so the overworld can provide its own char mapping. (b) is cleaner but touches more files — pick based on what the function looks like.
2. **Class colors source.** Is there an existing mapping from className to color? If yes, reuse. If no, ad-hoc colors in CSS are fine for v1.
3. **Authoring ergonomics.** 40×40 hand-authored via a string array is tolerable but tedious. If it's actively painful, define a small multiline string template + parser — still code, still deterministic, but easier to edit. Don't build a full loader.

---

## Done when

- All tasks checked off.
- `npm run test -w shared` passes, including new `overworld.test.ts` (map integrity).
- `npm run test -w server` passes, including `WorldSession` position resolution tests.
- `npm run build` in client and server is clean.
- Manual smoke test (Task 10) passes two-tab end-to-end: both players see each other on the map at spawn.
- The rendered map shows walls, grass, path, town floor, door, water, a stash `$` in town, and a portal `>` on the east edge.
- No character position ever renders outside the map bounds. No character renders on a wall.
