# Multi-Enemy Encounters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scale combat encounters to spawn multiple enemies based on party power, with a leader mob + skull-1 adds from the same biome.

**Architecture:** A new encounter config drives a power-budget formula that determines add count at room entry time. MobAIManager is refactored from single-mob-per-room to multi-mob-per-room. GameSession builds the mob list (leader + adds) and passes it to the existing CombatManager which already supports multiple mobs. Client store changes from single mob position per room to an array.

**Tech Stack:** TypeScript, Vitest, JSON config pattern (shared/src/data/)

---

### Task 1: Encounter Config

**Files:**
- Create: `shared/src/data/encounterConfig.json`
- Create: `shared/src/data/encounter.ts`
- Modify: `shared/src/data/configTypes.ts`
- Modify: `shared/src/index.ts`

- [ ] **Step 1: Create the config JSON**

Create `shared/src/data/encounterConfig.json`:

```json
{
  "baseline": 50,
  "step": 15,
  "maxAdds": 3,
  "addXpBonus": 5,
  "detectionRange": 1,
  "pursuitRange": 10
}
```

- [ ] **Step 2: Add the EncounterConfig interface**

In `shared/src/data/configTypes.ts`, add at the end of the file:

```typescript
export interface EncounterConfig {
  baseline: number;
  step: number;
  maxAdds: number;
  addXpBonus: number;
  detectionRange: number;
  pursuitRange: number;
}
```

- [ ] **Step 3: Create the typed wrapper**

Create `shared/src/data/encounter.ts`:

```typescript
import type { EncounterConfig } from './configTypes.js';
import config from './encounterConfig.json' with { type: 'json' };

export const ENCOUNTER_CONFIG: EncounterConfig = config;
```

- [ ] **Step 4: Re-export from shared index**

In `shared/src/index.ts`, add:

```typescript
export { ENCOUNTER_CONFIG } from './data/encounter.js';
```

- [ ] **Step 5: Build shared and verify**

Run: `npm run build --workspace=shared`
Expected: Builds with no errors.

- [ ] **Step 6: Commit**

---

### Task 2: MobAIManager Multi-Mob Refactor

**Files:**
- Modify: `server/src/MobAIManager.ts`
- Modify: `server/src/MobAIManager.test.ts`

This is the largest task. The `MobAIManager` currently tracks one mob per room. It needs to track an array of mobs per room.

- [ ] **Step 1: Update the MobRoom interface and imports**

In `server/src/MobAIManager.ts`, replace the hardcoded constants and `MobRoom` interface:

```typescript
import type { RoomGrid, GridPosition, GridDirection } from '@caverns/roomgrid';
import { chebyshevDistance, DIRECTION_OFFSETS } from '@caverns/roomgrid';
import type { MobInstance, ServerMessage } from '@caverns/shared';
import { ENCOUNTER_CONFIG } from '@caverns/shared';

const WANDER_INTERVAL_MS = 1500;
const PURSUIT_INTERVAL_MS = 600;
const IDLE_CHANCE = 0.3;
const MIN_SPAWN_DISTANCE_FROM_EXIT = 5;

interface MobEntry {
  mob: MobInstance;
  position: GridPosition;
}

interface MobRoom {
  roomId: string;
  grid: RoomGrid;
  mobs: MobEntry[];
  paused: boolean;
  pursuing: boolean;
  playerPositions: Map<string, GridPosition>;
}
```

- [ ] **Step 2: Update registerRoom to accept an array**

Replace the `registerRoom` method:

```typescript
registerRoom(roomId: string, grid: RoomGrid, mobs: MobInstance[]): void {
  const entries: MobEntry[] = [];

  for (const mob of mobs) {
    const spawnPos = this.findSpawnPosition(grid);

    grid.addEntity({
      id: mob.instanceId,
      type: 'mob',
      position: spawnPos,
    });

    entries.push({ mob, position: { ...spawnPos } });

    this.broadcastToRoom(roomId, {
      type: 'mob_spawn',
      roomId,
      mobId: mob.instanceId,
      mobName: mob.name,
      x: spawnPos.x,
      y: spawnPos.y,
    });
  }

  const mobRoom: MobRoom = {
    roomId,
    grid,
    mobs: entries,
    paused: false,
    pursuing: false,
    playerPositions: new Map(),
  };

  this.rooms.set(roomId, mobRoom);
}
```

- [ ] **Step 3: Update removeMob to remove all mobs**

Replace the `removeMob` method:

```typescript
removeMob(roomId: string): void {
  const room = this.rooms.get(roomId);
  if (!room) return;

  for (const entry of room.mobs) {
    room.grid.removeEntity(entry.mob.instanceId);
    this.broadcastToRoom(roomId, {
      type: 'mob_despawn',
      roomId,
      mobId: entry.mob.instanceId,
    });
  }
  this.rooms.delete(roomId);
}
```

- [ ] **Step 4: Update pauseMob and reactivateMob**

Replace both methods:

```typescript
pauseMob(roomId: string): void {
  const room = this.rooms.get(roomId);
  if (!room) return;

  room.paused = true;
  for (const entry of room.mobs) {
    room.grid.removeEntity(entry.mob.instanceId);
    this.broadcastToRoom(roomId, {
      type: 'mob_despawn',
      roomId,
      mobId: entry.mob.instanceId,
    });
  }
}

reactivateMob(roomId: string): void {
  const room = this.rooms.get(roomId);
  if (!room) return;

  room.paused = false;
  for (const entry of room.mobs) {
    room.grid.addEntity({
      id: entry.mob.instanceId,
      type: 'mob',
      position: { ...entry.position },
    });

    this.broadcastToRoom(roomId, {
      type: 'mob_spawn',
      roomId,
      mobId: entry.mob.instanceId,
      mobName: entry.mob.name,
      x: entry.position.x,
      y: entry.position.y,
    });
  }
}
```

- [ ] **Step 5: Update getMobPosition → getMobPositions and getMobId → getMobIds**

Replace both getter methods:

```typescript
getMobPositions(roomId: string): GridPosition[] {
  const room = this.rooms.get(roomId);
  if (!room) return [];
  return room.mobs.map(e => ({ ...e.position }));
}

getMobIds(roomId: string): string[] {
  const room = this.rooms.get(roomId);
  if (!room) return [];
  return room.mobs.map(e => e.mob.instanceId);
}
```

- [ ] **Step 6: Update checkDetection for multi-mob**

Replace the `checkDetection` method:

```typescript
checkDetection(roomId: string): void {
  const room = this.rooms.get(roomId);
  if (!room || room.paused) return;

  for (const entry of room.mobs) {
    for (const playerPos of room.playerPositions.values()) {
      const dist = chebyshevDistance(entry.position, playerPos);
      if (dist <= ENCOUNTER_CONFIG.detectionRange) {
        this.onDetection?.(roomId, entry.mob.instanceId);
        return;
      }
    }
  }
}
```

- [ ] **Step 7: Update the tick method for multi-mob**

Replace the `tick` method. Each mob moves independently, but pursuit/idle is room-wide. The key change: iterate `room.mobs` instead of using a single `room.mob`/`room.mobPosition`.

```typescript
private tick(pursuitTick: boolean): void {
  const directions = Object.keys(DIRECTION_OFFSETS) as GridDirection[];

  for (const room of this.rooms.values()) {
    if (room.paused) continue;

    // Find nearest player to any mob
    let nearestPlayer: GridPosition | null = null;
    let nearestDist = Infinity;
    for (const playerPos of room.playerPositions.values()) {
      for (const entry of room.mobs) {
        const dist = chebyshevDistance(entry.position, playerPos);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestPlayer = playerPos;
        }
      }
    }

    const pursuing = nearestPlayer !== null && nearestDist <= ENCOUNTER_CONFIG.pursuitRange;

    // Fire alert on transition to pursuit
    if (pursuing && !room.pursuing) {
      room.pursuing = true;
      // Find the mob closest to the nearest player for alert position
      let alertMob = room.mobs[0];
      let alertDist = Infinity;
      for (const entry of room.mobs) {
        const dist = chebyshevDistance(entry.position, nearestPlayer!);
        if (dist < alertDist) {
          alertDist = dist;
          alertMob = entry;
        }
      }
      this.onPursuitStart?.(room.roomId, alertMob.mob.instanceId, alertMob.position.x, alertMob.position.y);
    } else if (!pursuing) {
      room.pursuing = false;
    }

    // Pursuing rooms only act on pursuit ticks, wandering rooms only on wander ticks
    if (pursuing !== pursuitTick) continue;

    if (!pursuing) {
      if (Math.random() < IDLE_CHANCE) continue;
    }

    // Move each mob independently
    for (const entry of room.mobs) {
      let moveDirections: GridDirection[];
      if (pursuing) {
        // Find this mob's nearest player
        let thisTarget: GridPosition = nearestPlayer!;
        let thisDist = Infinity;
        for (const playerPos of room.playerPositions.values()) {
          const dist = chebyshevDistance(entry.position, playerPos);
          if (dist < thisDist) {
            thisDist = dist;
            thisTarget = playerPos;
          }
        }
        moveDirections = [...directions].sort((a, b) => {
          const oa = DIRECTION_OFFSETS[a];
          const ob = DIRECTION_OFFSETS[b];
          const posA = { x: entry.position.x + oa.dx, y: entry.position.y + oa.dy };
          const posB = { x: entry.position.x + ob.dx, y: entry.position.y + ob.dy };
          return chebyshevDistance(posA, thisTarget) - chebyshevDistance(posB, thisTarget);
        });
      } else {
        moveDirections = [...directions].sort(() => Math.random() - 0.5);
      }

      for (const dir of moveDirections) {
        const result = room.grid.moveEntity(entry.mob.instanceId, dir);
        if (result.success && result.newPosition) {
          entry.position = { ...result.newPosition };

          this.broadcastToRoom(room.roomId, {
            type: 'mob_position',
            roomId: room.roomId,
            mobId: entry.mob.instanceId,
            x: result.newPosition.x,
            y: result.newPosition.y,
          });

          this.checkDetection(room.roomId);
          break;
        }
      }
    }
  }
}
```

- [ ] **Step 8: Update tests**

Rewrite `server/src/MobAIManager.test.ts`. All existing tests need to pass `[mob]` (array) to `registerRoom`, and use `getMobPositions`/`getMobIds` instead of `getMobPosition`/`getMobId`. Add new multi-mob tests.

Replace the entire test file:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RoomGrid } from '@caverns/roomgrid';
import type { RoomGridConfig, TileType } from '@caverns/roomgrid';
import type { MobInstance, ServerMessage } from '@caverns/shared';
import { MobAIManager } from './MobAIManager.js';

function makeGrid(width = 20, height = 20, exits: RoomGridConfig['exits'] = []): RoomGrid {
  const tiles: TileType[][] = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) return 'wall';
      return 'floor';
    })
  );
  return new RoomGrid({ width, height, tiles, exits });
}

function makeGridWithExit(width = 20, height = 20): RoomGrid {
  const tiles: TileType[][] = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) return 'wall';
      return 'floor';
    })
  );
  const exitX = Math.floor(width / 2);
  tiles[0][exitX] = 'exit';
  return new RoomGrid({
    width,
    height,
    tiles,
    exits: [{ position: { x: exitX, y: 0 }, data: { direction: 'north', targetRoomId: 'room2' } }],
  });
}

function makeMob(instanceId = 'mob-1'): MobInstance {
  return {
    instanceId,
    templateId: 'slime',
    name: 'Slime',
    maxHp: 20,
    hp: 20,
    damage: 3,
    defense: 1,
    initiative: 2,
  };
}

describe('MobAIManager', () => {
  let broadcast: ReturnType<typeof vi.fn<(roomId: string, msg: ServerMessage) => void>>;
  let manager: MobAIManager;

  beforeEach(() => {
    vi.useFakeTimers();
    broadcast = vi.fn<(roomId: string, msg: ServerMessage) => void>();
    manager = new MobAIManager(broadcast);
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
  });

  // --- registerRoom ---

  it('registerRoom places mob on the grid', () => {
    const grid = makeGrid();
    const mob = makeMob();
    manager.registerRoom('room-1', grid, [mob]);

    const positions = manager.getMobPositions('room-1');
    expect(positions.length).toBe(1);
    expect(positions[0].x).toBeGreaterThanOrEqual(0);
    expect(positions[0].y).toBeGreaterThanOrEqual(0);

    const entity = grid.getEntity(mob.instanceId);
    expect(entity).not.toBeNull();
    expect(entity!.type).toBe('mob');
  });

  it('registerRoom places mob at least 5 tiles from exits', () => {
    const width = 20;
    const height = 20;

    for (let i = 0; i < 20; i++) {
      const testGrid = makeGridWithExit(width, height);
      const testMob = makeMob(`mob-test-${i}`);
      const testManager = new MobAIManager(vi.fn());
      testManager.registerRoom('room-x', testGrid, [testMob]);

      const positions = testManager.getMobPositions('room-x');
      expect(positions.length).toBe(1);

      const exitPos = { x: Math.floor(width / 2), y: 0 };
      const dist = Math.max(Math.abs(positions[0].x - exitPos.x), Math.abs(positions[0].y - exitPos.y));
      expect(dist).toBeGreaterThanOrEqual(5);
      testManager.destroy();
    }
  });

  it('registerRoom broadcasts mob_spawn', () => {
    const grid = makeGrid();
    const mob = makeMob();
    manager.registerRoom('room-1', grid, [mob]);

    expect(broadcast).toHaveBeenCalledWith('room-1', expect.objectContaining({
      type: 'mob_spawn',
      roomId: 'room-1',
      mobId: mob.instanceId,
      mobName: mob.name,
    }));
  });

  // --- Multi-mob ---

  it('registerRoom places multiple mobs on the grid', () => {
    const grid = makeGrid();
    const mob1 = makeMob('mob-1');
    const mob2 = makeMob('mob-2');
    const mob3 = makeMob('mob-3');
    manager.registerRoom('room-1', grid, [mob1, mob2, mob3]);

    const positions = manager.getMobPositions('room-1');
    expect(positions.length).toBe(3);

    const ids = manager.getMobIds('room-1');
    expect(ids).toContain('mob-1');
    expect(ids).toContain('mob-2');
    expect(ids).toContain('mob-3');

    expect(grid.getEntity('mob-1')).not.toBeNull();
    expect(grid.getEntity('mob-2')).not.toBeNull();
    expect(grid.getEntity('mob-3')).not.toBeNull();
  });

  it('registerRoom broadcasts mob_spawn for each mob', () => {
    const grid = makeGrid();
    const mob1 = makeMob('mob-1');
    const mob2 = makeMob('mob-2');
    manager.registerRoom('room-1', grid, [mob1, mob2]);

    const spawns = broadcast.mock.calls.filter(([, msg]) => msg.type === 'mob_spawn');
    expect(spawns.length).toBe(2);
  });

  // --- Wandering ---

  it('mob moves after tick interval (mob_position messages broadcast)', () => {
    const grid = makeGrid();
    const mob = makeMob();
    manager.registerRoom('room-1', grid, [mob]);

    vi.spyOn(Math, 'random').mockReturnValue(0.9);

    broadcast.mockClear();
    vi.advanceTimersByTime(1500);

    const posMessages = broadcast.mock.calls
      .filter(([, msg]: [string, ServerMessage]) => msg.type === 'mob_position');
    expect(posMessages.length).toBeGreaterThanOrEqual(1);
  });

  it('mob does not move after removeMob', () => {
    const grid = makeGrid();
    const mob = makeMob();
    manager.registerRoom('room-1', grid, [mob]);
    manager.removeMob('room-1');

    broadcast.mockClear();
    vi.advanceTimersByTime(3000);

    const posMessages = broadcast.mock.calls
      .filter(([, msg]: [string, ServerMessage]) => msg.type === 'mob_position');
    expect(posMessages.length).toBe(0);
  });

  // --- Detection ---

  it('fires onDetection when player within detection range', () => {
    const grid = makeGrid();
    const mob = makeMob();
    manager.registerRoom('room-1', grid, [mob]);

    const detectionFn = vi.fn();
    manager.onDetection = detectionFn;

    const positions = manager.getMobPositions('room-1');
    // Place player adjacent (distance 1)
    manager.addPlayer('room-1', 'player-1', { x: positions[0].x + 1, y: positions[0].y });

    expect(detectionFn).toHaveBeenCalledWith('room-1', mob.instanceId);
  });

  it('fires onDetection when any mob in room is within range', () => {
    const grid = makeGrid();
    const mob1 = makeMob('mob-1');
    const mob2 = makeMob('mob-2');
    manager.registerRoom('room-1', grid, [mob1, mob2]);

    const detectionFn = vi.fn();
    manager.onDetection = detectionFn;

    // Place player adjacent to the second mob
    const positions = manager.getMobPositions('room-1');
    manager.addPlayer('room-1', 'player-1', { x: positions[1].x + 1, y: positions[1].y });

    expect(detectionFn).toHaveBeenCalled();
  });

  it('does not fire onDetection when player is far away', () => {
    const grid = makeGrid(20, 20);
    const mob = makeMob();
    manager.registerRoom('room-1', grid, [mob]);

    const detectionFn = vi.fn();
    manager.onDetection = detectionFn;

    const positions = manager.getMobPositions('room-1');
    const farX = positions[0].x <= 10 ? positions[0].x + 8 : positions[0].x - 8;
    manager.addPlayer('room-1', 'player-1', { x: farX, y: positions[0].y });

    expect(detectionFn).not.toHaveBeenCalled();
  });

  // --- reactivateMob ---

  it('reactivateMob resumes wandering after reactivation', () => {
    const grid = makeGrid();
    const mob = makeMob();
    manager.registerRoom('room-1', grid, [mob]);
    manager.pauseMob('room-1');

    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    broadcast.mockClear();
    vi.advanceTimersByTime(1500);

    let posMessages = broadcast.mock.calls
      .filter(([, msg]: [string, ServerMessage]) => msg.type === 'mob_position');
    expect(posMessages.length).toBe(0);

    manager.reactivateMob('room-1');
    broadcast.mockClear();
    vi.advanceTimersByTime(1500);

    posMessages = broadcast.mock.calls
      .filter(([, msg]: [string, ServerMessage]) => msg.type === 'mob_position');
    expect(posMessages.length).toBeGreaterThanOrEqual(1);
  });

  it('reactivateMob broadcasts mob_spawn for all mobs', () => {
    const grid = makeGrid();
    const mob1 = makeMob('mob-1');
    const mob2 = makeMob('mob-2');
    manager.registerRoom('room-1', grid, [mob1, mob2]);
    manager.pauseMob('room-1');

    broadcast.mockClear();
    manager.reactivateMob('room-1');

    const spawns = broadcast.mock.calls.filter(([, msg]) => msg.type === 'mob_spawn');
    expect(spawns.length).toBe(2);
  });

  // --- checkDetection ---

  it('checkDetection works for external player movement checks', () => {
    const grid = makeGrid();
    const mob = makeMob();
    manager.registerRoom('room-1', grid, [mob]);

    const detectionFn = vi.fn();
    manager.onDetection = detectionFn;

    const positions = manager.getMobPositions('room-1');
    const farX = positions[0].x <= 10 ? positions[0].x + 8 : positions[0].x - 8;
    manager.addPlayer('room-1', 'player-1', { x: farX, y: positions[0].y });
    expect(detectionFn).not.toHaveBeenCalled();

    manager.updatePlayerPosition('room-1', 'player-1', { x: positions[0].x, y: positions[0].y });
    manager.checkDetection('room-1');
    expect(detectionFn).toHaveBeenCalledWith('room-1', mob.instanceId);
  });

  // --- pauseMob ---

  it('pauseMob pauses wandering and broadcasts mob_despawn for all mobs', () => {
    const grid = makeGrid();
    const mob1 = makeMob('mob-1');
    const mob2 = makeMob('mob-2');
    manager.registerRoom('room-1', grid, [mob1, mob2]);

    broadcast.mockClear();
    manager.pauseMob('room-1');

    const despawns = broadcast.mock.calls.filter(([, msg]) => msg.type === 'mob_despawn');
    expect(despawns.length).toBe(2);

    expect(grid.getEntity('mob-1')).toBeNull();
    expect(grid.getEntity('mob-2')).toBeNull();

    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    broadcast.mockClear();
    vi.advanceTimersByTime(3000);

    const posMessages = broadcast.mock.calls
      .filter(([, msg]: [string, ServerMessage]) => msg.type === 'mob_position');
    expect(posMessages.length).toBe(0);
  });

  // --- removeMob ---

  it('removeMob removes all mobs and broadcasts despawn for each', () => {
    const grid = makeGrid();
    const mob1 = makeMob('mob-1');
    const mob2 = makeMob('mob-2');
    manager.registerRoom('room-1', grid, [mob1, mob2]);

    broadcast.mockClear();
    manager.removeMob('room-1');

    const despawns = broadcast.mock.calls.filter(([, msg]) => msg.type === 'mob_despawn');
    expect(despawns.length).toBe(2);

    expect(grid.getEntity('mob-1')).toBeNull();
    expect(grid.getEntity('mob-2')).toBeNull();
    expect(manager.hasRoom('room-1')).toBe(false);
  });
});
```

- [ ] **Step 9: Run tests**

Run: `npx vitest run server/src/MobAIManager.test.ts`
Expected: All tests pass.

- [ ] **Step 10: Commit**

---

### Task 3: GameSession — Encounter Scaling and Multi-Mob Spawning

**Files:**
- Modify: `server/src/GameSession.ts`

This task changes all the places that create `MobInstance` objects and call `registerRoom`. Instead of creating one mob, we calculate party power, determine add count, and build an array of mobs.

- [ ] **Step 1: Add imports and mob pool loading**

In `server/src/GameSession.ts`, add `ENCOUNTER_CONFIG` to the shared import and load the mob pool data:

Add `ENCOUNTER_CONFIG` to the existing import from `'@caverns/shared'` (line 0-23).

After the `allInteractableDefs` load (around line 44), add:

```typescript
import type { MobPoolEntry } from '@caverns/shared';

const allMobPool: MobPoolEntry[] = JSON.parse(
  readFileSync(resolve(__dirname_gs, '../../shared/src/data/mobPool.json'), 'utf-8')
);
```

- [ ] **Step 2: Add helper methods for encounter scaling**

Add these private methods to the `GameSession` class, before `debugTeleport`:

```typescript
private calculatePartyPower(): number {
  let totalPower = 0;
  for (const player of this.playerManager.getAllPlayers()) {
    const stats = this.playerManager.getComputedStats(player.id);
    totalPower += stats.damage + stats.defense + Math.floor(stats.maxHp / 5);
  }
  return totalPower;
}

private calculateAddCount(): number {
  const power = this.calculatePartyPower();
  const raw = Math.floor((power - ENCOUNTER_CONFIG.baseline) / ENCOUNTER_CONFIG.step);
  return Math.max(0, Math.min(raw, ENCOUNTER_CONFIG.maxAdds));
}

private inferBiome(roomId: string): string {
  const zoneMatch = roomId.match(/_z(\d+)_/);
  if (!zoneMatch) return 'starter';
  const prefix = roomId.slice(0, roomId.indexOf(`_z${zoneMatch[1]}_`));
  const clean = prefix.replace(/^multi_/, '');
  return clean.split('_')[0] || 'starter';
}

private buildEncounterMobs(roomId: string, leaderTemplate: MobTemplate): MobInstance[] {
  const leader: MobInstance = {
    instanceId: `${leaderTemplate.id}_${Date.now()}`,
    templateId: leaderTemplate.id,
    name: leaderTemplate.name,
    maxHp: leaderTemplate.maxHp,
    hp: leaderTemplate.maxHp,
    damage: leaderTemplate.damage,
    defense: leaderTemplate.defense,
    initiative: leaderTemplate.initiative,
  };

  const addCount = this.calculateAddCount();
  const biome = this.inferBiome(roomId);
  const skull1Adds = allMobPool.filter(m => m.skullRating === 1 && m.biomes.includes(biome));

  const mobs: MobInstance[] = [leader];

  for (let i = 0; i < addCount && skull1Adds.length > 0; i++) {
    const addEntry = skull1Adds[Math.floor(Math.random() * skull1Adds.length)];
    const addTemplate = this.mobs.get(addEntry.id);
    if (!addTemplate) continue;
    mobs.push({
      instanceId: `${addTemplate.id}_${Date.now()}_add${i}`,
      templateId: addTemplate.id,
      name: addTemplate.name,
      maxHp: addTemplate.maxHp,
      hp: addTemplate.maxHp,
      damage: addTemplate.damage,
      defense: addTemplate.defense,
      initiative: addTemplate.initiative,
    });
  }

  return mobs;
}
```

- [ ] **Step 3: Replace all single-mob registerRoom calls**

There are 4 places in GameSession that create a single `MobInstance` and call `this.mobAIManager.registerRoom(roomId, grid, mobInstance)`. Replace each one.

**Location 1: Entrance room (~line 178)**

Replace:
```typescript
if (entrance.encounter && !this.clearedRooms.has(entranceId)) {
  const template = this.mobs.get(entrance.encounter.mobId);
  if (template) {
    const mobInstance: MobInstance = {
      instanceId: `${template.id}_${Date.now()}`,
      templateId: template.id, name: template.name,
      maxHp: template.maxHp, hp: template.maxHp,
      damage: template.damage, defense: template.defense, initiative: template.initiative,
    };
    this.mobAIManager.registerRoom(entranceId, entranceGrid, mobInstance);
  }
}
```

With:
```typescript
if (entrance.encounter && !this.clearedRooms.has(entranceId)) {
  const template = this.mobs.get(entrance.encounter.mobId);
  if (template) {
    const mobs = this.buildEncounterMobs(entranceId, template);
    this.mobAIManager.registerRoom(entranceId, entranceGrid, mobs);
  }
}
```

**Location 2: Room transition via grid move (~line 412)**

Replace the block:
```typescript
if (targetRoom.encounter && !this.clearedRooms.has(targetRoomId)) {
  const template = this.mobs.get(targetRoom.encounter.mobId);
  if (template) {
    const mobInstance: MobInstance = {
      instanceId: `${template.id}_${Date.now()}`,
      templateId: template.id, name: template.name,
      maxHp: template.maxHp, hp: template.maxHp,
      damage: template.damage, defense: template.defense, initiative: template.initiative,
    };
    this.mobAIManager.registerRoom(targetRoomId, newGrid, mobInstance);
  }
}
```

With:
```typescript
if (targetRoom.encounter && !this.clearedRooms.has(targetRoomId)) {
  const template = this.mobs.get(targetRoom.encounter.mobId);
  if (template) {
    const mobs = this.buildEncounterMobs(targetRoomId, template);
    this.mobAIManager.registerRoom(targetRoomId, newGrid, mobs);
  }
}
```

**Location 3: Flee into new room (~line 657)**

Same replacement pattern — find the block inside the flee handler that creates a single `mobInstance` and registers it, replace with `buildEncounterMobs` + array.

**Location 4: Teleport into new room (~line 1449)**

Same replacement pattern in the `teleportPlayer` method.

- [ ] **Step 4: Update startCombat to accept mob instances**

Replace the `startCombat` method signature and body. Instead of looking up the template and creating one mob, it receives the pre-built array:

```typescript
private startCombat(roomId: string, mobInstances: MobInstance[]): void {
  if (mobInstances.length === 0) return;
  const playersInRoom = this.playerManager.getPlayersInRoom(roomId);
  const combatPlayers: CombatPlayerInfo[] = playersInRoom.map((p) => {
    const stats = this.playerManager.getComputedStats(p.id);
    return { id: p.id, name: p.name, hp: p.hp, maxHp: stats.maxHp, damage: stats.damage, defense: stats.defense, initiative: stats.initiative, className: p.className };
  });
  const playerEffects = new Map<string, EquippedEffect[]>();
  const usedDungeonEffects = new Map<string, string[]>();
  for (const p of playersInRoom) {
    playerEffects.set(p.id, getPlayerEquippedEffects(p));
    usedDungeonEffects.set(p.id, [...(p.usedEffects ?? [])]);
  }
  for (const p of playersInRoom) {
    this.playerManager.setStatus(p.id, 'in_combat');
    this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(p.id)! });
  }
  const combat = new CombatManager(roomId, combatPlayers, mobInstances, playerEffects, usedDungeonEffects);
  this.combats.set(roomId, combat);

  // Build encounter text
  const leader = mobInstances[0];
  const leaderTemplate = this.mobs.get(leader.templateId);
  const skulls = '\u2620'.repeat(leaderTemplate?.skullRating ?? 1);
  let encounterText: string;
  if (mobInstances.length === 1) {
    encounterText = `A ${leader.name} appears! (${skulls})\n${leaderTemplate?.description ?? ''}`;
  } else {
    const addNames: Record<string, number> = {};
    for (let i = 1; i < mobInstances.length; i++) {
      const name = mobInstances[i].name;
      addNames[name] = (addNames[name] ?? 0) + 1;
    }
    const addList = Object.entries(addNames)
      .map(([name, count]) => count > 1 ? `${count} ${name}s` : `a ${name}`)
      .join(' and ');
    encounterText = `A ${leader.name} appears with ${addList}! (${skulls})\n${leaderTemplate?.description ?? ''}`;
  }

  this.broadcastToRoom(roomId, { type: 'text_log', message: encounterText, logType: 'combat' });
  this.broadcastToRoom(roomId, { type: 'combat_start', combat: combat.getState() });
  const firstTurnId = combat.getCurrentTurnId();
  if (combat.isMobTurn(firstTurnId)) {
    this.processMobTurn(roomId, combat);
  } else {
    this.broadcastTurnPrompt(combat);
  }
}
```

- [ ] **Step 5: Update handleMobDetection to pass mob instances**

The `handleMobDetection` callback fires when any mob gets close. It needs to grab the mob instances from MobAIManager (they're tracked there) and pass them to `startCombat`. But MobAIManager doesn't expose the `MobInstance` objects — just IDs and positions. We need to store the spawned mob instances on the room so we can retrieve them for combat.

Add a new field to GameSession:

```typescript
private roomMobInstances = new Map<string, MobInstance[]>();
```

In `buildEncounterMobs`, after building the array, store it:

```typescript
// At the end of buildEncounterMobs, before return:
this.roomMobInstances.set(roomId, mobs);
return mobs;
```

Update `handleMobDetection`:

```typescript
private handleMobDetection(roomId: string, mobId: string): void {
  if (this.combats.has(roomId)) return;
  if (this.clearedRooms.has(roomId)) return;

  const room = this.rooms.get(roomId);
  if (!room?.encounter) return;

  this.mobAIManager.pauseMob(roomId);
  const mobs = this.roomMobInstances.get(roomId) ?? [];
  if (mobs.length === 0) return;
  this.startCombat(roomId, mobs);
}
```

Also update the puzzle-fail random encounter spawn (around line 1206). This spawns a skull-1 mob as a surprise combat — no adds needed since it's a punishment:

```typescript
if (Math.random() < DUNGEON_CONFIG.encounterSpawnChance) {
  const skull1Mobs = this.content.mobs.filter(m => m.skullRating === 1);
  if (skull1Mobs.length > 0) {
    const mob = skull1Mobs[Math.floor(Math.random() * skull1Mobs.length)];
    this.broadcastToRoom(roomId, {
      type: 'text_log',
      message: 'The failed attempt has attracted something...',
      logType: 'combat',
    });
    const mobInstance: MobInstance = {
      instanceId: `${mob.id}_${Date.now()}`,
      templateId: mob.id, name: mob.name,
      maxHp: mob.maxHp, hp: mob.maxHp,
      damage: mob.damage, defense: mob.defense, initiative: mob.initiative,
    };
    this.startCombat(roomId, [mobInstance]);
  }
}
```

- [ ] **Step 6: Update XP award in finishCombat**

In `finishCombat`, the XP calculation needs to add `addXpBonus` per add mob. Replace the XP block (around line 780):

```typescript
if (result === 'victory') {
  this.clearRoom(roomId);
  this.mobAIManager.removeMob(roomId);
  this.roomMobInstances.delete(roomId);
  this.broadcastToRoom(roomId, { type: 'text_log', message: 'The enemies have been defeated!', logType: 'combat' });
  this.fireVictoryPassives(roomId);
  // Award XP to all players
  const room = this.rooms.get(roomId);
  const skullRating = room?.encounter?.skullRating ?? 1;
  const baseXp = PROGRESSION_CONFIG.xpPerSkull[String(skullRating)] ?? PROGRESSION_CONFIG.xpPerSkull['1'] ?? 0;
  // Count add mobs from combat participants (non-player participants minus 1 for leader)
  const combatMobCount = combat ? Array.from((combat as any).participants.values()).filter((p: any) => p.type === 'mob').length : 1;
  const addCount = Math.max(0, combatMobCount - 1);
  const xpAmount = baseXp + (addCount * ENCOUNTER_CONFIG.addXpBonus);
  if (xpAmount > 0) {
    const mobName = room?.encounter?.mobId ? this.mobs.get(room.encounter.mobId)?.name ?? 'enemy' : 'enemy';
    this.broadcast({ type: 'text_log', message: `Gained ${xpAmount} XP from defeating ${mobName}!`, logType: 'system' });
    for (const p of this.playerManager.getAllPlayers()) {
      this.playerManager.awardXp(p.id, xpAmount);
      const levelsGained = this.playerManager.checkLevelUp(p.id);
      if (levelsGained > 0) {
        const updatedPlayer = this.playerManager.getPlayer(p.id)!;
        updatedPlayer.hp = computePlayerStats(updatedPlayer).maxHp;
        updatedPlayer.maxHp = computePlayerStats(updatedPlayer).maxHp;
        this.broadcast({ type: 'text_log', message: `${p.name} reached level ${updatedPlayer.level}!`, logType: 'system' });
        this.broadcast({ type: 'level_up', playerId: p.id, newLevel: updatedPlayer.level });
      }
      this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(p.id)! });
    }
  }
  this.dropLoot(roomId);
```

Also clean up `roomMobInstances` in the flee case:

In `finishCombat`, in the `if (result === 'flee')` block, leave `roomMobInstances` intact (mobs are still in the room). The `reactivateMob` call already handles re-spawning them visually.

- [ ] **Step 7: Commit**

---

### Task 4: GameSession Tests

**Files:**
- Modify: `server/src/GameSession.test.ts`

- [ ] **Step 1: Update walkPlayerToMob helper**

The `walkPlayerToMob` helper uses `getMobPosition` (singular). Update to use `getMobPositions`:

```typescript
function walkPlayerToMob(session: GameSession, playerId: string, messages: { playerId: string; msg: any }[]): boolean {
  const s = session as any;
  const roomId = s.playerManager.getPlayer(playerId)?.roomId;
  if (!roomId) return false;
  const positions = s.mobAIManager.getMobPositions(roomId);
  if (positions.length === 0) return false;
  const mobPos = positions[0]; // Use first mob for positioning

  const grid = s.roomGrids.get(roomId);
  if (!grid) return false;
  grid.removeEntity(playerId);
  const offsets = [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
  let placed = false;
  for (const { dx, dy } of offsets) {
    const pos = { x: mobPos.x + dx, y: mobPos.y + dy };
    if (grid.isWalkable(pos)) {
      grid.addEntity({ id: playerId, type: 'player', position: { ...pos } });
      s.playerGridPositions.set(playerId, { ...pos });
      s.mobAIManager.updatePlayerPosition(roomId, playerId, pos);
      placed = true;
      break;
    }
  }
  if (!placed) return false;

  s.mobAIManager.checkDetection(roomId);
  return messages.some((m) => m.msg.type === 'combat_start');
}
```

- [ ] **Step 2: Add encounter scaling tests**

Add these tests to the existing `describe('GameSession', ...)` block:

```typescript
it('calculateAddCount returns 0 for low party power', () => {
  const { session } = createSession();
  const s = session as any;
  // Fresh 2-player party should be below baseline
  const addCount = s.calculateAddCount();
  expect(addCount).toBe(0);
});

it('combat_start includes multiple participants when adds are present', () => {
  const { session, messages } = createSession();
  const s = session as any;
  // Artificially inflate party power to trigger adds
  for (const player of s.playerManager.getAllPlayers()) {
    player.statAllocations = { ferocity: 20, toughness: 20, vitality: 20 };
  }
  // Walk player to mob to trigger combat
  const triggered = walkPlayerToMob(session, 'p1', messages);
  if (triggered) {
    const combatStart = messages.find(m => m.msg.type === 'combat_start');
    const mobs = combatStart.msg.combat.participants.filter((p: any) => p.type === 'mob');
    expect(mobs.length).toBeGreaterThan(1);
  }
});
```

- [ ] **Step 3: Run all tests**

Run: `npx vitest run server/src/GameSession.test.ts`
Expected: All tests pass.

- [ ] **Step 4: Commit**

---

### Task 5: Client Store — Multi-Mob Positions

**Files:**
- Modify: `client/src/store/gameStore.ts`

- [ ] **Step 1: Update the mobPositions type**

In the `GameStore` interface, change:

```typescript
mobPositions: Record<string, { mobId: string; mobName: string; x: number; y: number }>;
```

To:

```typescript
mobPositions: Record<string, { mobId: string; mobName: string; x: number; y: number }[]>;
```

- [ ] **Step 2: Update mob_spawn handler**

Replace the `mob_spawn` case:

```typescript
case 'mob_spawn':
  set((state) => {
    const existing = state.mobPositions[msg.roomId] ?? [];
    return {
      mobPositions: {
        ...state.mobPositions,
        [msg.roomId]: [...existing, { mobId: msg.mobId, mobName: msg.mobName, x: msg.x, y: msg.y }],
      },
    };
  });
  break;
```

- [ ] **Step 3: Update mob_position handler**

Replace the `mob_position` case:

```typescript
case 'mob_position':
  set((state) => {
    const existing = state.mobPositions[msg.roomId];
    if (!existing) return {};
    return {
      mobPositions: {
        ...state.mobPositions,
        [msg.roomId]: existing.map(m =>
          m.mobId === msg.mobId ? { ...m, x: msg.x, y: msg.y } : m
        ),
      },
    };
  });
  break;
```

- [ ] **Step 4: Update mob_despawn handler**

Replace the `mob_despawn` case:

```typescript
case 'mob_despawn':
  set((state) => {
    const existing = state.mobPositions[msg.roomId];
    if (!existing) return {};
    const filtered = existing.filter(m => m.mobId !== msg.mobId);
    if (filtered.length === 0) {
      const { [msg.roomId]: _, ...rest } = state.mobPositions;
      return { mobPositions: rest };
    }
    return {
      mobPositions: {
        ...state.mobPositions,
        [msg.roomId]: filtered,
      },
    };
  });
  break;
```

- [ ] **Step 5: Commit**

---

### Task 6: Client RoomView — Render Multiple Mobs

**Files:**
- Modify: `client/src/components/RoomView.tsx`

- [ ] **Step 1: Update mob overlay rendering**

In `RoomView.tsx`, replace the mob overlay section (around line 52-63):

```typescript
// Mob (pre-combat wandering) — from mobPositions store
if (!activeCombat || activeCombat.roomId !== currentRoomId) {
  const mobDataList = mobPositions[currentRoomId];
  if (mobDataList) {
    for (const mobData of mobDataList) {
      overlays.push({
        x: mobData.x,
        y: mobData.y,
        char: mobData.mobName[0] ?? '?',
        className: 'entity-mob',
      });
    }
  }
}
```

- [ ] **Step 2: Commit**

---

### Task 7: Build, Run Full Tests, Manual Verification

- [ ] **Step 1: Build shared package**

Run: `npm run build --workspace=shared`
Expected: No errors.

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 3: Manual test**

Start the server and client. Verify:
1. Solo player at level 1 sees a single mob in rooms — no adds
2. With 4 players or after leveling up, additional mobs appear in rooms
3. All mobs wander independently
4. All mobs pursue together when one detects a player
5. Combat starts with all mobs as participants
6. After combat victory, XP text shows correct amount (base + add bonus)
7. Fleeing and re-entering a room shows the mobs again (flee bug fix)
8. Debug "give item" works for equipping gear to boost power and test scaling

- [ ] **Step 4: Commit**
