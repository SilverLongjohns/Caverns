# Client-Side Tile Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-authored ASCII template system with a data-driven tile grid renderer powered by `TileType[][]` grids.

**Architecture:** Pure tile-character lookup functions live in `@caverns/roomgrid` (testable). A `TileGrid` type is added to `shared` Room type. A new `TileGridView` React component renders grids with box-drawing walls, animated water, and entity overlays. `RoomView` is rewritten to use it, and the old template system is deleted.

**Tech Stack:** React, Zustand, TypeScript, Vitest (for roomgrid tests)

**Note on Room type vs separate store field:** The spec proposed a separate `tileGrid` store field, but since the store already holds `rooms: Record<string, Room>`, adding `tileGrid` directly to the `Room` type is simpler — no separate field, no stale-data bugs when switching between revealed rooms. This plan uses that approach.

**Note on server integration:** Sub-project 4 (GameSession integration) will have the server populate `tileGrid` on rooms. Until then, the client generates a basic fallback grid from each room's exits and dimensions. This means the rendering infrastructure is fully testable now.

---

### File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `roomgrid/src/rendering/tileChars.ts` | Tile-to-ASCII lookup, wall neighbor mask, `getTileChar()` |
| Create | `roomgrid/src/rendering/index.ts` | Re-exports rendering module |
| Create | `roomgrid/__tests__/tileChars.test.ts` | Tests for tile char lookup and wall character selection |
| Modify | `roomgrid/src/index.ts` | Add rendering re-export |
| Modify | `shared/src/types.ts` | Add `TileGrid` interface, add `tileGrid?` to `Room` |
| Create | `client/src/components/TileGridView.tsx` | Grid renderer with wall lookup, water animation, entity overlay |
| Modify | `client/src/components/RoomView.tsx` | Replace template rendering with TileGridView, add fallback grid |
| Modify | `client/src/styles/index.css` | New `.tile-*` and `.entity-*` classes, remove old `.char-*` |
| Delete | `shared/src/data/roomTemplates.ts` | Old template system |
| Modify | `shared/src/index.ts` | Remove roomTemplates export |

---

### Task 1: Tile Character Data & Wall Lookup

Pure functions for converting tile types to ASCII characters, including the box-drawing wall neighbor lookup.

**Files:**
- Create: `roomgrid/src/rendering/tileChars.ts`
- Create: `roomgrid/__tests__/tileChars.test.ts`
- Create: `roomgrid/src/rendering/index.ts`
- Modify: `roomgrid/src/index.ts`

- [ ] **Step 1: Write failing tests for tile character lookup**

Create `roomgrid/__tests__/tileChars.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TILE_CHARS, WALL_CHARS, getWallChar, getTileChar } from '../src/rendering/tileChars.js';
import type { TileType } from '../src/types.js';

describe('TILE_CHARS', () => {
  it('maps every non-wall tile type to a character', () => {
    expect(TILE_CHARS.floor).toBe('.');
    expect(TILE_CHARS.exit).toBe('▓');
    expect(TILE_CHARS.water).toBe('~');
    expect(TILE_CHARS.chasm).toBe(' ');
    expect(TILE_CHARS.hazard).toBe('^');
    expect(TILE_CHARS.bridge).toBe('=');
  });
});

describe('WALL_CHARS', () => {
  it('has 16 entries for all neighbor masks', () => {
    expect(WALL_CHARS).toHaveLength(16);
  });

  it('maps isolated wall to box', () => {
    expect(WALL_CHARS[0]).toBe('□');
  });

  it('maps N+S to vertical double line', () => {
    expect(WALL_CHARS[3]).toBe('║');
  });

  it('maps E+W to horizontal double line', () => {
    expect(WALL_CHARS[12]).toBe('═');
  });

  it('maps all four to cross', () => {
    expect(WALL_CHARS[15]).toBe('╬');
  });
});

describe('getWallChar', () => {
  // Helper: create a grid and get the wall char at a position
  function wallCharAt(grid: TileType[][], x: number, y: number): string {
    return getWallChar(grid, x, y);
  }

  it('treats out-of-bounds as connected (border wall gets edge connections)', () => {
    // Single wall tile at 0,0 in a 1x1 grid: all 4 neighbors OOB = all connected = mask 15
    const grid: TileType[][] = [['wall']];
    expect(wallCharAt(grid, 0, 0)).toBe('╬');
  });

  it('computes corner piece for top-left of walled room', () => {
    // 3x3 grid, all walls
    const grid: TileType[][] = [
      ['wall', 'wall', 'wall'],
      ['wall', 'floor', 'wall'],
      ['wall', 'wall', 'wall'],
    ];
    // Top-left (0,0): N=OOB(connected), S=wall(connected), E=wall(connected), W=OOB(connected) = 15
    expect(wallCharAt(grid, 0, 0)).toBe('╬');
    // Top-middle (1,0): N=OOB, S=floor(not), E=wall, W=wall = 1+0+4+8 = 13 = ╩
    expect(wallCharAt(grid, 1, 0)).toBe('╩');
  });

  it('computes vertical line for wall between floor tiles', () => {
    const grid: TileType[][] = [
      ['floor', 'wall', 'floor'],
      ['floor', 'wall', 'floor'],
      ['floor', 'wall', 'floor'],
    ];
    // (1,1): N=wall, S=wall, E=floor, W=floor = 1+2+0+0 = 3
    expect(wallCharAt(grid, 1, 1)).toBe('║');
  });

  it('computes horizontal line for wall between floor tiles', () => {
    const grid: TileType[][] = [
      ['floor', 'floor', 'floor'],
      ['wall',  'wall',  'wall'],
      ['floor', 'floor', 'floor'],
    ];
    // (1,1): N=floor, S=floor, E=wall, W=wall = 0+0+4+8 = 12
    expect(wallCharAt(grid, 1, 1)).toBe('═');
  });
});

describe('getTileChar', () => {
  it('returns period for floor', () => {
    const grid: TileType[][] = [['floor']];
    expect(getTileChar(grid, 0, 0)).toBe('.');
  });

  it('delegates to wall lookup for wall tiles', () => {
    const grid: TileType[][] = [
      ['wall', 'wall'],
      ['wall', 'floor'],
    ];
    // (0,0): N=OOB, S=wall, E=wall, W=OOB = 1+2+4+8=15... wait
    // N=OOB(connected)=1, S=wall(connected)=2, E=wall(connected)=4, W=OOB(connected)=8 = 15
    expect(getTileChar(grid, 0, 0)).toBe('╬');
    // (1,0): N=OOB=1, S=floor=0, E=OOB=4, W=wall=8 = 13
    expect(getTileChar(grid, 1, 0)).toBe('╩');
  });

  it('returns correct chars for all non-wall types', () => {
    const types: TileType[] = ['floor', 'exit', 'water', 'chasm', 'hazard', 'bridge'];
    const expected = ['.', '▓', '~', ' ', '^', '='];
    for (let i = 0; i < types.length; i++) {
      const grid: TileType[][] = [[types[i]]];
      expect(getTileChar(grid, 0, 0)).toBe(expected[i]);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns/roomgrid && npx vitest run __tests__/tileChars.test.ts`
Expected: FAIL — cannot find module `../src/rendering/tileChars.js`

- [ ] **Step 3: Implement tile character lookup**

Create `roomgrid/src/rendering/tileChars.ts`:

```ts
import type { TileType } from '../types.js';

/** ASCII character for each non-wall tile type. Walls use WALL_CHARS via neighbor lookup. */
export const TILE_CHARS: Record<Exclude<TileType, 'wall'>, string> = {
  floor:  '.',
  exit:   '▓',
  water:  '~',
  chasm:  ' ',
  hazard: '^',
  bridge: '=',
};

/**
 * Box-drawing characters indexed by 4-bit neighbor mask.
 * Bit layout: N=1, S=2, E=4, W=8.
 * A neighbor is "connected" if it is a wall tile or out of bounds.
 */
export const WALL_CHARS: string[] = [
  '□', // 0:  isolated
  '║', // 1:  N
  '║', // 2:  S
  '║', // 3:  N+S
  '═', // 4:  E
  '╚', // 5:  N+E
  '╔', // 6:  S+E
  '╠', // 7:  N+S+E
  '═', // 8:  W
  '╝', // 9:  N+W
  '╗', // 10: S+W
  '╣', // 11: N+S+W
  '═', // 12: E+W
  '╩', // 13: N+E+W
  '╦', // 14: S+E+W
  '╬', // 15: N+S+E+W
];

/** Returns the box-drawing character for a wall tile based on its cardinal neighbors. */
export function getWallChar(tiles: TileType[][], x: number, y: number): string {
  const height = tiles.length;
  const width = tiles[0].length;

  let mask = 0;
  // N (y-1)
  if (y === 0 || tiles[y - 1][x] === 'wall') mask |= 1;
  // S (y+1)
  if (y === height - 1 || tiles[y + 1][x] === 'wall') mask |= 2;
  // E (x+1)
  if (x === width - 1 || tiles[y][x + 1] === 'wall') mask |= 4;
  // W (x-1)
  if (x === 0 || tiles[y][x - 1] === 'wall') mask |= 8;

  return WALL_CHARS[mask];
}

/** Returns the ASCII character for any tile at (x, y). */
export function getTileChar(tiles: TileType[][], x: number, y: number): string {
  const type = tiles[y][x];
  if (type === 'wall') return getWallChar(tiles, x, y);
  return TILE_CHARS[type];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns/roomgrid && npx vitest run __tests__/tileChars.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Add re-exports**

Create `roomgrid/src/rendering/index.ts`:

```ts
export { TILE_CHARS, WALL_CHARS, getWallChar, getTileChar } from './tileChars.js';
```

Add to `roomgrid/src/index.ts` (append after existing exports):

```ts
export * from './rendering/index.js';
```

- [ ] **Step 6: Run full roomgrid test suite**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns/roomgrid && npx vitest run`
Expected: All tests pass (existing 106 + new tileChars tests)

- [ ] **Step 7: Commit**

```bash
git add roomgrid/src/rendering/tileChars.ts roomgrid/src/rendering/index.ts roomgrid/__tests__/tileChars.test.ts roomgrid/src/index.ts
git commit -m "feat(roomgrid): add tile character lookup and box-drawing wall chars"
```

---

### Task 2: Add TileGrid Type to Shared Room Type

Add the `TileGrid` interface and an optional `tileGrid` field on `Room` so the protocol can carry tile data.

**Files:**
- Modify: `shared/src/types.ts:92-105`

- [ ] **Step 1: Add TileGrid interface and update Room type**

In `shared/src/types.ts`, add the `TileGrid` interface before the `Room` interface (before line 92), then add `tileGrid?` to `Room`:

Add after line 91 (after `RoomPuzzle` interface closing brace):

```ts
export interface TileGrid {
  width: number;
  height: number;
  tiles: string[][];
  themes?: (string | null)[][];
}
```

Add `tileGrid?: TileGrid;` to the `Room` interface, after `gridY?`:

```ts
export interface Room {
  id: string;
  type: RoomType;
  name: string;
  description: string;
  exits: Partial<Record<Direction, string>>;
  encounter?: RoomEncounter;
  loot?: RoomLoot[];
  lockedExits?: Partial<Record<Direction, string>>;
  puzzle?: RoomPuzzle;
  gridX?: number;
  gridY?: number;
  tileGrid?: TileGrid;
  interactables?: InteractableInstance[];
}
```

- [ ] **Step 2: Verify shared package compiles**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx tsc --noEmit -p shared/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add shared/src/types.ts
git commit -m "feat(shared): add TileGrid type and optional tileGrid field on Room"
```

---

### Task 3: CSS — New Tile and Entity Classes

Add the new `.tile-*` and `.entity-*` CSS classes. The old `.char-*` classes are kept for now (removed in Task 5 alongside the template code).

**Files:**
- Modify: `client/src/styles/index.css`

- [ ] **Step 1: Add tile type CSS classes**

In `client/src/styles/index.css`, add after the `.room-row` block (after line 1024):

```css
/* === Tile Type Colors === */
.tile-floor    { color: #223322; }
.tile-wall     { color: #336633; }
.tile-exit     { color: #44ff44; }
.tile-water    { color: #3355aa; }
.tile-chasm    { color: #111111; }
.tile-hazard   { color: #aa3333; }
.tile-bridge   { color: #665533; }

/* === Theme Color Overrides === */
.tile-theme-moss_stone   { color: #2a5a2a; }
.tile-theme-carved_stone { color: #556677; }
.tile-theme-obsidian     { color: #332211; }
.tile-theme-deep_water   { color: #2244aa; }

.tile-theme-lava {
  color: #ff4400;
  text-shadow: 0 0 4px #ff2200, 0 0 8px #aa0000;
  animation: lava-pulse 2s ease-in-out infinite;
}

@keyframes lava-pulse {
  0%, 100% { text-shadow: 0 0 4px #ff2200, 0 0 8px #aa0000; }
  50% { text-shadow: 0 0 8px #ff4400, 0 0 16px #cc2200; }
}

/* === Entity Overlay Classes === */
.entity-mob {
  color: #ff3333;
  font-weight: 800;
}

.entity-interactable {
  color: #ffaa33;
  cursor: pointer;
  transition: color 0.15s, text-shadow 0.15s;
}

.entity-interactable:hover {
  color: #ffcc55;
  text-shadow: 0 0 4px #ffaa33;
}

.entity-interactable.entity-selected {
  color: #ffcc55;
  text-shadow: 0 0 6px #ffaa33, 0 0 12px #ff8800;
  animation: interactable-pulse 1.5s ease-in-out infinite;
}

.entity-interactable-used {
  color: #665522;
  cursor: pointer;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/styles/index.css
git commit -m "feat(client): add tile type and entity overlay CSS classes"
```

---

### Task 4: TileGridView Component

New React component that renders a `TileGrid` with box-drawing walls, animated water, and entity overlays.

**Files:**
- Create: `client/src/components/TileGridView.tsx`

**Context:** This component is used by `RoomView.tsx` (wired up in Task 5). It imports `getTileChar` from `@caverns/roomgrid` for tile-to-character conversion. It receives entity overlays as props — it doesn't read game state directly.

- [ ] **Step 1: Create TileGridView component**

Create `client/src/components/TileGridView.tsx`:

```tsx
import { useState, useEffect, memo } from 'react';
import { getTileChar } from '@caverns/roomgrid';

export interface EntityOverlay {
  x: number;
  y: number;
  char: string;
  className: string;
  entityId?: string;
  style?: React.CSSProperties;
}

interface TileGridViewProps {
  tileGrid: {
    width: number;
    height: number;
    tiles: string[][];
    themes?: (string | null)[][];
  };
  entities: EntityOverlay[];
  selectedEntityId?: string | null;
  onEntityClick?: (entityId: string) => void;
}

/** Animated water tile that randomly toggles between ~ and ≈ */
const WaterChar = memo(function WaterChar() {
  const [char, setChar] = useState('~');
  useEffect(() => {
    const id = setInterval(() => {
      setChar((c) => (c === '~' ? '≈' : '~'));
    }, 800 + Math.random() * 700);
    return () => clearInterval(id);
  }, []);
  return <>{char}</>;
});

export function TileGridView({ tileGrid, entities, selectedEntityId, onEntityClick }: TileGridViewProps) {
  const { width, height, tiles, themes } = tileGrid;

  // Build entity lookup: "x,y" -> EntityOverlay
  const entityMap = new Map<string, EntityOverlay>();
  for (const entity of entities) {
    entityMap.set(`${entity.x},${entity.y}`, entity);
  }

  const rows: React.ReactNode[] = [];
  for (let y = 0; y < height; y++) {
    const cells: React.ReactNode[] = [];
    for (let x = 0; x < width; x++) {
      const entity = entityMap.get(`${x},${y}`);
      const tileType = tiles[y][x];
      const theme = themes?.[y]?.[x];

      if (entity) {
        // Entity takes priority over tile
        const isSelected = entity.entityId === selectedEntityId;
        const className = [
          entity.className,
          isSelected ? 'entity-selected' : '',
        ].filter(Boolean).join(' ');

        if (entity.entityId && onEntityClick) {
          cells.push(
            <span
              key={x}
              className={className}
              style={entity.style}
              onClick={() => onEntityClick(entity.entityId!)}
              title={isSelected ? entity.entityId : undefined}
            >
              {entity.char}
            </span>
          );
        } else {
          cells.push(
            <span key={x} className={className} style={entity.style}>
              {entity.char}
            </span>
          );
        }
      } else {
        // Render tile
        const tileClass = theme
          ? `tile-${tileType} tile-theme-${theme}`
          : `tile-${tileType}`;

        if (tileType === 'water') {
          cells.push(
            <span key={x} className={tileClass}>
              <WaterChar />
            </span>
          );
        } else {
          const char = getTileChar(tiles as any, x, y);
          cells.push(
            <span key={x} className={tileClass}>
              {char}
            </span>
          );
        }
      }
    }
    rows.push(
      <div key={y} className="room-row">
        {cells}
      </div>
    );
  }

  return (
    <pre className="room-grid">
      {rows}
    </pre>
  );
}
```

- [ ] **Step 2: Verify client compiles**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx tsc --noEmit -p client/tsconfig.json`
Expected: No errors (component not wired up yet, just needs to compile)

- [ ] **Step 3: Commit**

```bash
git add client/src/components/TileGridView.tsx
git commit -m "feat(client): add TileGridView component with wall lookup and water animation"
```

---

### Task 5: RoomView Rewrite & Template Removal

Replace the template-based rendering in `RoomView.tsx` with `TileGridView`, add a fallback grid generator for rooms without `tileGrid`, remove the old template system files and CSS.

**Files:**
- Modify: `client/src/components/RoomView.tsx`
- Delete: `shared/src/data/roomTemplates.ts`
- Modify: `shared/src/index.ts:9`
- Modify: `client/src/styles/index.css` (remove old `.char-*` classes)

**Context:**
- Current `RoomView.tsx` imports `getTemplateForRoom` from `@caverns/shared` and renders template lines with interactable overlays.
- After this task, it renders `<TileGridView>` with entity overlays assembled from store state.
- Until the server populates `tileGrid` (sub-project 4), a client-side `buildFallbackGrid()` generates a simple walled room with exits.
- The `Room` type (from `shared/src/types.ts`) has fields: `exits: Partial<Record<Direction, string>>` mapping directions to target room IDs. The fallback uses this to place exit tiles on the border.

- [ ] **Step 1: Rewrite RoomView.tsx**

Replace the entire contents of `client/src/components/RoomView.tsx` with:

```tsx
import { useMemo } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { getInteractableDefinition } from '@caverns/shared';
import type { Room, InteractableInstance, Direction, TileGrid } from '@caverns/shared';
import { TileGridView } from './TileGridView.js';
import type { EntityOverlay } from './TileGridView.js';

const FALLBACK_WIDTH = 30;
const FALLBACK_HEIGHT = 12;

/** Exit positions on the border for each direction, given room dimensions. */
function exitPosition(dir: Direction, w: number, h: number): { x: number; y: number } {
  switch (dir) {
    case 'north': return { x: Math.floor(w / 2), y: 0 };
    case 'south': return { x: Math.floor(w / 2), y: h - 1 };
    case 'west':  return { x: 0, y: Math.floor(h / 2) };
    case 'east':  return { x: w - 1, y: Math.floor(h / 2) };
  }
}

/** Generates a simple walled room with floor interior and exits. Used until server provides tileGrid. */
function buildFallbackGrid(room: Room): TileGrid {
  const w = FALLBACK_WIDTH;
  const h = FALLBACK_HEIGHT;
  const tiles: string[][] = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => {
      if (y === 0 || y === h - 1 || x === 0 || x === w - 1) return 'wall';
      return 'floor';
    })
  );

  // Place exits
  for (const dir of Object.keys(room.exits) as Direction[]) {
    const pos = exitPosition(dir, w, h);
    tiles[pos.y][pos.x] = 'exit';
    // Clear adjacent interior tile so exit is reachable
    if (dir === 'north' && pos.y + 1 < h) tiles[pos.y + 1][pos.x] = 'floor';
    if (dir === 'south' && pos.y - 1 >= 0) tiles[pos.y - 1][pos.x] = 'floor';
    if (dir === 'west' && pos.x + 1 < w) tiles[pos.y][pos.x + 1] = 'floor';
    if (dir === 'east' && pos.x - 1 >= 0) tiles[pos.y][pos.x - 1] = 'floor';
  }

  return { width: w, height: h, tiles };
}

function isFullyUsed(instance: InteractableInstance): boolean {
  const def = getInteractableDefinition(instance.definitionId);
  if (!def) return false;
  const nonRepeatable = def.actions.filter((a) => !a.repeatable);
  if (nonRepeatable.length === 0) return false;
  return nonRepeatable.every((a) => a.id in instance.usedActions);
}

interface RoomViewProps {
  onInteract: (interactableId: string) => void;
}

export function RoomView({ onInteract }: RoomViewProps) {
  const rooms = useGameStore((s) => s.rooms);
  const currentRoomId = useGameStore((s) => s.currentRoomId);
  const selectedInteractableId = useGameStore((s) => s.selectedInteractableId);
  const selectInteractable = useGameStore((s) => s.selectInteractable);
  const players = useGameStore((s) => s.players);
  const playerId = useGameStore((s) => s.playerId);
  const activeCombat = useGameStore((s) => s.activeCombat);

  const room = rooms[currentRoomId];

  const tileGrid = useMemo(() => {
    if (!room) return null;
    return room.tileGrid ?? buildFallbackGrid(room);
  }, [room]);

  const entities = useMemo<EntityOverlay[]>(() => {
    if (!room || !tileGrid) return [];
    const overlays: EntityOverlay[] = [];

    // Interactables
    if (room.interactables) {
      for (const inst of room.interactables) {
        const def = getInteractableDefinition(inst.definitionId);
        if (!def) continue;
        const used = isFullyUsed(inst);
        overlays.push({
          x: inst.position.x,
          y: inst.position.y,
          char: def.asciiChar,
          className: used ? 'entity-interactable-used' : 'entity-interactable',
          entityId: inst.instanceId,
        });
      }
    }

    // Mobs in combat (rendered at fixed positions in the grid)
    if (activeCombat && activeCombat.roomId === currentRoomId) {
      const mobs = activeCombat.participants.filter((p) => p.type === 'mob');
      const centerX = Math.floor(tileGrid.width / 2);
      const centerY = Math.floor(tileGrid.height / 2);
      mobs.forEach((mob, i) => {
        overlays.push({
          x: centerX + i * 2 - Math.floor(mobs.length / 2),
          y: centerY - 1,
          char: mob.name[0],
          className: 'entity-mob',
        });
      });
    }

    // Players in this room
    const playersInRoom = Object.values(players).filter((p) => p.roomId === currentRoomId);
    const centerX = Math.floor(tileGrid.width / 2);
    const centerY = Math.floor(tileGrid.height / 2);
    playersInRoom.forEach((player, i) => {
      overlays.push({
        x: centerX + i * 2 - Math.floor(playersInRoom.length / 2),
        y: centerY + 1,
        char: '@',
        className: 'entity-player',
        style: { color: player.id === playerId ? '#44ff44' : '#88cc88' },
      });
    });

    return overlays;
  }, [room, tileGrid, activeCombat, players, currentRoomId, playerId]);

  if (!room || !tileGrid) return null;

  const handleEntityClick = (entityId: string) => {
    if (selectedInteractableId === entityId) {
      selectInteractable(null);
      useGameStore.setState({ pendingInteractActions: null });
    } else {
      selectInteractable(entityId);
      useGameStore.setState({ pendingInteractActions: null });
      onInteract(entityId);
    }
  };

  return (
    <div className="room-view">
      <div className="room-title">{room.name}</div>
      <TileGridView
        tileGrid={tileGrid}
        entities={entities}
        selectedEntityId={selectedInteractableId}
        onEntityClick={handleEntityClick}
      />
    </div>
  );
}
```

- [ ] **Step 2: Delete roomTemplates.ts and remove its export**

Delete `shared/src/data/roomTemplates.ts`.

In `shared/src/index.ts`, remove this line:

```ts
export * from './data/roomTemplates.js';
```

- [ ] **Step 3: Remove old CSS classes**

In `client/src/styles/index.css`, remove the following blocks (lines ~1026-1063):

```css
.char-wall {
  color: #336633;
}

.char-floor {
  color: #223322;
}

.char-exit {
  color: #44ff44;
}

.char-interactable {
  color: #ffaa33;
  cursor: pointer;
  transition: color 0.15s, text-shadow 0.15s;
}

.char-interactable:hover {
  color: #ffcc55;
  text-shadow: 0 0 4px #ffaa33;
}

.char-interactable.char-selected {
  color: #ffcc55;
  text-shadow: 0 0 6px #ffaa33, 0 0 12px #ff8800;
  animation: interactable-pulse 1.5s ease-in-out infinite;
}

.char-interactable-used {
  color: #665522;
  cursor: pointer;
}

@keyframes interactable-pulse {
  0%, 100% { text-shadow: 0 0 6px #ffaa33, 0 0 12px #ff8800; }
  50% { text-shadow: 0 0 3px #ffaa33, 0 0 6px #ff8800; }
}
```

Also remove the `.room-text` class if it exists (it was only used by the old template renderer).

- [ ] **Step 4: Verify everything compiles**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx tsc --noEmit -p client/tsconfig.json && npx tsc --noEmit -p shared/tsconfig.json`
Expected: No errors

- [ ] **Step 5: Check for any remaining references to old templates**

Search for `getTemplateForRoom`, `roomTemplates`, `RoomTemplate`, `.char-wall`, `.char-floor`, `.char-exit`, `.room-text` across the codebase. Remove or update any remaining references.

- [ ] **Step 6: Run full test suite**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns/roomgrid && npx vitest run`
Expected: All roomgrid tests pass

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx vitest run`
Expected: All tests pass (shared tests should still pass since Room type change is backward-compatible)

- [ ] **Step 7: Commit**

```bash
git add client/src/components/RoomView.tsx client/src/components/TileGridView.tsx client/src/styles/index.css shared/src/types.ts shared/src/index.ts
git rm shared/src/data/roomTemplates.ts
git commit -m "feat: replace template system with TileGridView renderer

Replaces hand-authored ASCII room templates with data-driven tile grid
rendering. Adds box-drawing wall characters, animated water tiles, and
entity overlays. Includes fallback grid generator until server provides
tileGrid data."
```
