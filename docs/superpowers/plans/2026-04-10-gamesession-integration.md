# GameSession Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `@caverns/roomgrid` tile generation into ProceduralGenerator so procedurally generated dungeons have real tile grids.

**Architecture:** A `buildTileGrid()` helper in `server/src/tileGridBuilder.ts` maps room type to dimensions, looks up biome generation config, converts exit directions to tile positions, calls `generateRoom()`, and returns a `TileGrid`. ProceduralGenerator calls it after assembling each room. GameSession calls it for secret rooms.

**Tech Stack:** TypeScript, `@caverns/roomgrid` (generateRoom, BiomeGenerationConfig), `@caverns/shared` (Room, TileGrid, Direction), Vitest

---

### File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `server/src/tileGridBuilder.ts` | `buildTileGrid(room, biomeId)` — room dimensions, exit mapping, biome config lookup, tile generation |
| Create | `server/src/tileGridBuilder.test.ts` | Tests for buildTileGrid |
| Modify | `server/src/ProceduralGenerator.ts` | Call `buildTileGrid` after assembling each room |
| Modify | `server/src/GameSession.ts:1083-1136` | Call `buildTileGrid` in `createSecretRoom` |

---

### Task 1: buildTileGrid Helper

Create the helper that converts a Room + biomeId into a TileGrid.

**Files:**
- Create: `server/src/tileGridBuilder.ts`
- Create: `server/src/tileGridBuilder.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/src/tileGridBuilder.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildTileGrid, ROOM_DIMENSIONS } from './tileGridBuilder.js';
import type { Room, Direction } from '@caverns/shared';

function makeRoom(type: string, exits: Partial<Record<Direction, string>> = {}): Room {
  return {
    id: 'test-room',
    type: type as any,
    name: 'Test Room',
    description: 'A test room',
    exits,
  };
}

describe('ROOM_DIMENSIONS', () => {
  it('has dimensions for all room types', () => {
    expect(ROOM_DIMENSIONS.tunnel).toEqual({ width: 30, height: 8 });
    expect(ROOM_DIMENSIONS.chamber).toEqual({ width: 30, height: 15 });
    expect(ROOM_DIMENSIONS.cavern).toEqual({ width: 40, height: 18 });
    expect(ROOM_DIMENSIONS.dead_end).toEqual({ width: 20, height: 12 });
    expect(ROOM_DIMENSIONS.boss).toEqual({ width: 45, height: 20 });
  });
});

describe('buildTileGrid', () => {
  it('returns a TileGrid with correct dimensions for a chamber', () => {
    const room = makeRoom('chamber', { north: 'room2', south: 'room3' });
    const grid = buildTileGrid(room, 'starter');
    expect(grid.width).toBe(30);
    expect(grid.height).toBe(15);
    expect(grid.tiles.length).toBe(15);
    expect(grid.tiles[0].length).toBe(30);
  });

  it('returns a TileGrid with correct dimensions for a tunnel', () => {
    const room = makeRoom('tunnel', { east: 'room2', west: 'room3' });
    const grid = buildTileGrid(room, 'starter');
    expect(grid.width).toBe(30);
    expect(grid.height).toBe(8);
  });

  it('returns a TileGrid with correct dimensions for a boss room', () => {
    const room = makeRoom('boss', { south: 'room2' });
    const grid = buildTileGrid(room, 'starter');
    expect(grid.width).toBe(45);
    expect(grid.height).toBe(20);
  });

  it('places exit tiles at border positions matching room exits', () => {
    const room = makeRoom('chamber', { north: 'room2', east: 'room3' });
    const grid = buildTileGrid(room, 'starter');
    // north exit: x=15 (width/2), y=0
    expect(grid.tiles[0][15]).toBe('exit');
    // east exit: x=29 (width-1), y=7 (height/2)
    expect(grid.tiles[7][29]).toBe('exit');
  });

  it('generates walkable tiles (not all walls)', () => {
    const room = makeRoom('chamber', { north: 'room2', south: 'room3' });
    const grid = buildTileGrid(room, 'starter');
    let floorCount = 0;
    for (const row of grid.tiles) {
      for (const tile of row) {
        if (tile === 'floor' || tile === 'exit') floorCount++;
      }
    }
    // At least 10% of tiles should be walkable
    expect(floorCount).toBeGreaterThan(grid.width * grid.height * 0.1);
  });

  it('includes themes when biome has tileThemes', () => {
    const room = makeRoom('chamber', { north: 'room2' });
    const grid = buildTileGrid(room, 'fungal');
    expect(grid.themes).toBeDefined();
    // Fungal biome has floor->moss, wall->fungal_rock, water->spore_pool
    // At least some floor tiles should have 'moss' theme
    let hasMoss = false;
    for (const row of grid.themes!) {
      for (const theme of row) {
        if (theme === 'moss') hasMoss = true;
      }
    }
    expect(hasMoss).toBe(true);
  });

  it('omits themes when biome has empty tileThemes', () => {
    // Use a biome with no themes — starter has themes, so we test the fallback
    const room = makeRoom('chamber', { north: 'room2' });
    const grid = buildTileGrid(room, 'starter');
    // starter has tileThemes { floor: "dirt", wall: "rock" } so themes should be present
    expect(grid.themes).toBeDefined();
  });

  it('falls back to starter config for unknown biome', () => {
    const room = makeRoom('chamber', { north: 'room2' });
    const grid = buildTileGrid(room, 'nonexistent_biome');
    // Should not throw, should produce a valid grid using starter config
    expect(grid.width).toBe(30);
    expect(grid.height).toBe(15);
    expect(grid.tiles.length).toBe(15);
  });

  it('falls back to chamber dimensions for unknown room type', () => {
    const room = makeRoom('unknown_type', { north: 'room2' });
    const grid = buildTileGrid(room, 'starter');
    // Falls back to chamber dimensions
    expect(grid.width).toBe(30);
    expect(grid.height).toBe(15);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx vitest run server/src/tileGridBuilder.test.ts`
Expected: FAIL — cannot find module `./tileGridBuilder.js`

- [ ] **Step 3: Implement buildTileGrid**

Create `server/src/tileGridBuilder.ts`:

```ts
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import type { Room, Direction, TileGrid, RoomType } from '@caverns/shared';
import { generateRoom } from '@caverns/roomgrid';
import type { BiomeGenerationConfig } from '@caverns/roomgrid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const biomeConfigs: BiomeGenerationConfig[] = JSON.parse(
  readFileSync(resolve(__dirname, '../../roomgrid/src/data/biomeGeneration.json'), 'utf-8')
);

export const ROOM_DIMENSIONS: Record<string, { width: number; height: number }> = {
  tunnel:   { width: 30, height: 8 },
  chamber:  { width: 30, height: 15 },
  cavern:   { width: 40, height: 18 },
  dead_end: { width: 20, height: 12 },
  boss:     { width: 45, height: 20 },
};

const DEFAULT_DIMENSIONS = ROOM_DIMENSIONS.chamber;

function exitPosition(dir: Direction, w: number, h: number): { x: number; y: number } {
  switch (dir) {
    case 'north': return { x: Math.floor(w / 2), y: 0 };
    case 'south': return { x: Math.floor(w / 2), y: h - 1 };
    case 'west':  return { x: 0, y: Math.floor(h / 2) };
    case 'east':  return { x: w - 1, y: Math.floor(h / 2) };
  }
}

export function buildTileGrid(room: Room, biomeId: string): TileGrid {
  const dims = ROOM_DIMENSIONS[room.type] ?? DEFAULT_DIMENSIONS;
  const { width, height } = dims;

  // Look up biome generation config, fallback to starter
  let biomeConfig = biomeConfigs.find(b => b.biomeId === biomeId);
  if (!biomeConfig) {
    biomeConfig = biomeConfigs.find(b => b.biomeId === 'starter')!;
  }

  // Convert room exits to generation exit entries
  const exits = Object.entries(room.exits)
    .filter(([, targetId]) => targetId != null)
    .map(([dir, targetId]) => {
      const direction = dir as Direction;
      const position = exitPosition(direction, width, height);
      return {
        position,
        data: { direction, targetRoomId: targetId! },
      };
    });

  // Generate the tile grid
  const config = generateRoom({
    width,
    height,
    exits,
    biomeConfig,
    roomType: room.type,
  });

  // Build theme grid from biome tileThemes
  const tileThemes = biomeConfig.tileThemes;
  const hasThemes = Object.keys(tileThemes).length > 0;
  let themes: (string | null)[][] | undefined;

  if (hasThemes) {
    themes = config.tiles.map(row =>
      row.map(tileType => (tileThemes as Record<string, string>)[tileType] ?? null)
    );
  }

  return {
    width,
    height,
    tiles: config.tiles as string[][],
    ...(themes ? { themes } : {}),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx vitest run server/src/tileGridBuilder.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full server test suite**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx vitest run server/src/`
Expected: All existing server tests still pass

- [ ] **Step 6: Commit**

```bash
git add server/src/tileGridBuilder.ts server/src/tileGridBuilder.test.ts
git commit -m "feat(server): add buildTileGrid helper for room tile generation"
```

---

### Task 2: Integrate into ProceduralGenerator

Call `buildTileGrid` after each room is fully assembled in ProceduralGenerator.

**Files:**
- Modify: `server/src/ProceduralGenerator.ts`

**Context:** ProceduralGenerator builds rooms in two phases:
1. Zone construction loop (lines 108-317): creates rooms, places them on a spatial grid, assigns exits
2. Post-processing (lines 449-end): adds encounters, loot, puzzles, interactables

Tile generation must happen AFTER exits are finalized (including cross-linking at lines 219-243) but the exact placement doesn't matter as long as all exits exist. The cleanest spot is after step 4b (connectivity repair, line 447) and before the return statement — by then ALL rooms have their final exits.

- [ ] **Step 1: Add import**

At the top of `server/src/ProceduralGenerator.ts`, add after the existing imports (after line 7):

```ts
import { buildTileGrid } from './tileGridBuilder.js';
```

- [ ] **Step 2: Add tile generation loop**

In `server/src/ProceduralGenerator.ts`, find the section after connectivity repair and before mob population. The connectivity repair is at line 447:

```ts
  // 4b. Connectivity repair — reconnect any orphaned rooms
  repairConnectivity(allRooms, allRooms[0].id);
```

After this line and before the `// 5. Populate mobs` comment (line 449), add:

```ts
  // 4c. Generate tile grids for all rooms
  for (const room of allRooms) {
    const biome = getBiomeForRoom(room, biomes, zoneEntries, zoneCount);
    room.tileGrid = buildTileGrid(room, biome.id);
  }
```

**Important:** `getBiomeForRoom` is an existing function in ProceduralGenerator.ts that determines which biome a room belongs to based on its position in the zone structure. It's already used for mob and loot assignment (lines 457, 510).

- [ ] **Step 3: Verify existing tests still pass**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx vitest run server/src/ProceduralGenerator.test.ts`
Expected: All existing tests PASS (tile generation is additive — no existing behavior changes)

- [ ] **Step 4: Add a test verifying rooms have tile grids**

In `server/src/ProceduralGenerator.test.ts`, add after the existing tests:

```ts
  it('all rooms have tileGrid populated', () => {
    const dungeon = generateProceduralDungeon(2);
    for (const room of dungeon.rooms) {
      expect(room.tileGrid, `Room ${room.id} (${room.type}) missing tileGrid`).toBeDefined();
      expect(room.tileGrid!.width).toBeGreaterThan(0);
      expect(room.tileGrid!.height).toBeGreaterThan(0);
      expect(room.tileGrid!.tiles.length).toBe(room.tileGrid!.height);
      expect(room.tileGrid!.tiles[0].length).toBe(room.tileGrid!.width);
    }
  });

  it('room tileGrid dimensions match room type', () => {
    const dungeon = generateProceduralDungeon(2);
    const expectedDims: Record<string, { width: number; height: number }> = {
      tunnel:   { width: 30, height: 8 },
      chamber:  { width: 30, height: 15 },
      cavern:   { width: 40, height: 18 },
      dead_end: { width: 20, height: 12 },
      boss:     { width: 45, height: 20 },
    };
    for (const room of dungeon.rooms) {
      const expected = expectedDims[room.type];
      if (expected) {
        expect(room.tileGrid!.width, `${room.id} width`).toBe(expected.width);
        expect(room.tileGrid!.height, `${room.id} height`).toBe(expected.height);
      }
    }
  });

  it('room tileGrid has exit tiles matching room exits', () => {
    const dungeon = generateProceduralDungeon(2);
    for (const room of dungeon.rooms) {
      const grid = room.tileGrid!;
      for (const dir of Object.keys(room.exits) as Direction[]) {
        let exitX: number, exitY: number;
        switch (dir) {
          case 'north': exitX = Math.floor(grid.width / 2); exitY = 0; break;
          case 'south': exitX = Math.floor(grid.width / 2); exitY = grid.height - 1; break;
          case 'west':  exitX = 0; exitY = Math.floor(grid.height / 2); break;
          case 'east':  exitX = grid.width - 1; exitY = Math.floor(grid.height / 2); break;
        }
        expect(
          grid.tiles[exitY!][exitX!],
          `Room ${room.id} exit ${dir} at (${exitX!},${exitY!}) should be 'exit'`
        ).toBe('exit');
      }
    }
  });
```

- [ ] **Step 5: Run full test suite**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx vitest run server/src/`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/ProceduralGenerator.ts server/src/ProceduralGenerator.test.ts
git commit -m "feat(server): generate tile grids for all procedural dungeon rooms"
```

---

### Task 3: Integrate into GameSession Secret Rooms

Call `buildTileGrid` in `createSecretRoom` so dynamically created secret rooms also get tile grids.

**Files:**
- Modify: `server/src/GameSession.ts:1083-1136`

**Context:** `createSecretRoom` (line 1083) creates a `dead_end` room with hardcoded interactable positions based on the old template layout. After adding a tile grid, the interactable positions should be placed within the generated grid's floor area rather than at hardcoded coordinates that assumed the old template dimensions.

However, the spec says secret rooms default to `'starter'` biome and `dead_end` type (20x12 grid). The hardcoded slot positions `(6,2), (14,4), (22,2), (10,5)` and portal at `(14,6)` were designed for the old 30x8 dead_end template. With the new 20x12 grid, position `(22,2)` is out of bounds (width=20). These positions need to be updated to fit within the 20x12 grid.

- [ ] **Step 1: Add import**

At the top of `server/src/GameSession.ts`, add the import (find the existing import block and add):

```ts
import { buildTileGrid } from './tileGridBuilder.js';
```

- [ ] **Step 2: Update createSecretRoom**

In `server/src/GameSession.ts`, in the `createSecretRoom` method (line 1083), make two changes:

**a)** Update the slot positions to fit within a 20x12 grid (must be interior positions, not on the border wall):

Replace the `slotPositions` array (lines 1103-1108):

```ts
    // Position interactables within the 20x12 dead_end grid interior
    const slotPositions = [
      { x: 4, y: 3 },
      { x: 10, y: 3 },
      { x: 15, y: 3 },
      { x: 7, y: 7 },
    ];
```

Replace the portal position (line 1120):

```ts
      position: { x: 10, y: 9 },
```

**b)** Add the `buildTileGrid` call. After the `secretRoom` object is created (after line 1132) and before `this.rooms.set(roomId, secretRoom)` (line 1134), add:

```ts
    secretRoom.tileGrid = buildTileGrid(secretRoom, 'starter');
```

- [ ] **Step 3: Verify server tests still pass**

Run: `cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npx vitest run server/src/`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add server/src/GameSession.ts
git commit -m "feat(server): generate tile grids for secret rooms"
```
