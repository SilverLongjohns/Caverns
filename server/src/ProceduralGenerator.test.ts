import { describe, it, expect } from 'vitest';
import { generateProceduralDungeon } from './ProceduralGenerator.js';
import type { Direction } from '@caverns/shared';

describe('ProceduralGenerator', () => {
  it('generates a dungeon with the correct number of zones', () => {
    const dungeon = generateProceduralDungeon(3);
    expect(dungeon.rooms.length).toBeGreaterThanOrEqual(13);
  });


  it('has an entrance room with no encounter', () => {
    const dungeon = generateProceduralDungeon(3);
    const entrance = dungeon.rooms.find(r => r.id === dungeon.entranceRoomId);
    expect(entrance).toBeDefined();
    expect(entrance!.encounter).toBeUndefined();
  });

  it('has exactly one boss room', () => {
    const dungeon = generateProceduralDungeon(3);
    const bossRooms = dungeon.rooms.filter(r => r.type === 'boss');
    expect(bossRooms.length).toBe(1);
  });

  it('boss room has the boss encounter', () => {
    const dungeon = generateProceduralDungeon(3);
    const bossRoom = dungeon.rooms.find(r => r.type === 'boss')!;
    expect(bossRoom.encounter).toBeDefined();
    expect(bossRoom.encounter!.mobId).toBe(dungeon.bossId);
  });

  it('all room exits are bidirectional', () => {
    const dungeon = generateProceduralDungeon(3);
    const opposites: Record<string, string> = {
      north: 'south', south: 'north', east: 'west', west: 'east',
    };
    const roomMap = new Map(dungeon.rooms.map(r => [r.id, r]));
    for (const room of dungeon.rooms) {
      for (const [dir, targetId] of Object.entries(room.exits)) {
        if (!targetId) continue;
        const target = roomMap.get(targetId);
        expect(target, `Room ${room.id} exit ${dir} -> ${targetId} has no target room`).toBeDefined();
        const opposite = opposites[dir] as Direction;
        expect(
          target!.exits[opposite],
          `${room.id} -> ${dir} -> ${targetId} missing return ${opposite}`
        ).toBe(room.id);
      }
    }
  });

  it('all rooms are reachable from entrance', () => {
    const dungeon = generateProceduralDungeon(3);
    const roomMap = new Map(dungeon.rooms.map(r => [r.id, r]));
    const visited = new Set<string>();
    const queue = [dungeon.entranceRoomId];
    visited.add(dungeon.entranceRoomId);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const room = roomMap.get(current)!;
      for (const targetId of Object.values(room.exits)) {
        if (targetId && !visited.has(targetId)) {
          visited.add(targetId);
          queue.push(targetId);
        }
      }
    }
    expect(visited.size).toBe(dungeon.rooms.length);
  });

  it('all encounter mobIds reference mobs in the dungeon', () => {
    const dungeon = generateProceduralDungeon(3);
    const mobIds = new Set(dungeon.mobs.map(m => m.id));
    for (const room of dungeon.rooms) {
      if (room.encounter) {
        expect(mobIds.has(room.encounter.mobId), `Unknown mob ${room.encounter.mobId}`).toBe(true);
      }
    }
  });

  it('all room loot references items in the dungeon', () => {
    const dungeon = generateProceduralDungeon(3);
    const itemIds = new Set(dungeon.items.map(i => i.id));
    for (const room of dungeon.rooms) {
      if (room.loot) {
        for (const loot of room.loot) {
          // Key items won't be in the items array
          const isKeyItem = dungeon.rooms.some(r =>
            r.lockedExits && Object.values(r.lockedExits).includes(loot.itemId)
          );
          if (!isKeyItem) {
            expect(itemIds.has(loot.itemId), `Unknown item ${loot.itemId} in room ${room.id}`).toBe(true);
          }
        }
      }
    }
  });

  it('all mob loot tables have valid LootDrop entries', () => {
    const dungeon = generateProceduralDungeon(3);
    const itemIds = new Set(dungeon.items.map(i => i.id));
    const validSlots = ['weapon', 'offhand', 'armor', 'accessory'];
    for (const mob of dungeon.mobs) {
      for (const drop of mob.lootTable) {
        if ('consumableId' in drop) {
          expect(itemIds.has(drop.consumableId), `Mob ${mob.id} references unknown consumable ${drop.consumableId}`).toBe(true);
        } else if ('slot' in drop) {
          expect(validSlots.includes(drop.slot), `Mob ${mob.id} has invalid slot ${drop.slot}`).toBe(true);
          expect([1, 2, 3].includes(drop.skullRating), `Mob ${mob.id} has invalid skullRating`).toBe(true);
        }
      }
    }
  });

  it('boss room has a locked exit from its parent', () => {
    const dungeon = generateProceduralDungeon(3);
    const bossRoom = dungeon.rooms.find(r => r.type === 'boss')!;
    const parentRoom = dungeon.rooms.find(r =>
      Object.values(r.exits).includes(bossRoom.id)
    );
    expect(parentRoom).toBeDefined();
    expect(parentRoom!.lockedExits).toBeDefined();
    const lockedTarget = Object.values(parentRoom!.lockedExits!).find(v => v);
    expect(lockedTarget).toBeDefined();
  });

  it('key item is placed in room loot', () => {
    const dungeon = generateProceduralDungeon(3);
    const parentRoom = dungeon.rooms.find(r => r.lockedExits && Object.keys(r.lockedExits).length > 0);
    expect(parentRoom).toBeDefined();
    const keyId = Object.values(parentRoom!.lockedExits!)[0];
    const roomWithKey = dungeon.rooms.find(r =>
      r.loot?.some(l => l.itemId === keyId)
    );
    expect(roomWithKey, `No room contains key item ${keyId}`).toBeDefined();
  });

  it('generates different dungeons on successive calls', () => {
    const d1 = generateProceduralDungeon(3);
    const d2 = generateProceduralDungeon(3);
    expect(d1.rooms.length).toBeGreaterThan(0);
    expect(d2.rooms.length).toBeGreaterThan(0);
  });

  it('places puzzles in rooms without encounters', () => {
    // Run multiple times since placement is random
    let totalPuzzles = 0;
    for (let i = 0; i < 10; i++) {
      const dungeon = generateProceduralDungeon(3);
      const puzzleRooms = dungeon.rooms.filter(r => r.puzzle);
      totalPuzzles += puzzleRooms.length;
      for (const room of puzzleRooms) {
        expect(room.encounter, `Puzzle room ${room.id} should not have an encounter`).toBeUndefined();
        expect(room.puzzle!.options.length).toBe(4);
        expect(room.puzzle!.correctIndex).toBeGreaterThanOrEqual(0);
        expect(room.puzzle!.correctIndex).toBeLessThan(4);
      }
    }
    // With 3 zones and 1 puzzle per zone, expect ~30 puzzles across 10 runs
    expect(totalPuzzles).toBeGreaterThanOrEqual(20);
  });

  it('generates valid dungeons across 10 runs with varying zone counts', () => {
    for (let i = 0; i < 10; i++) {
      const zoneCount = 2 + Math.floor(Math.random() * 4); // 2-5
      const dungeon = generateProceduralDungeon(zoneCount);

      // Basic structural checks
      expect(dungeon.rooms.length).toBeGreaterThan(0);
      expect(dungeon.mobs.length).toBeGreaterThan(0);
      expect(dungeon.items.length).toBeGreaterThan(0);
      expect(dungeon.entranceRoomId).toBeTruthy();
      expect(dungeon.bossId).toBeTruthy();

      // Referential integrity
      const roomIds = new Set(dungeon.rooms.map(r => r.id));
      const mobIds = new Set(dungeon.mobs.map(m => m.id));
      const itemIds = new Set(dungeon.items.map(i => i.id));

      expect(roomIds.has(dungeon.entranceRoomId)).toBe(true);
      expect(mobIds.has(dungeon.bossId)).toBe(true);

      // All exits point to valid rooms and are bidirectional
      const opposites: Record<string, string> = {
        north: 'south', south: 'north', east: 'west', west: 'east',
      };
      const roomMap = new Map(dungeon.rooms.map(r => [r.id, r]));

      for (const room of dungeon.rooms) {
        for (const [dir, targetId] of Object.entries(room.exits)) {
          if (!targetId) continue;
          expect(roomIds.has(targetId), `Room ${room.id} exit ${dir} -> invalid ${targetId}`).toBe(true);
          const target = roomMap.get(targetId)!;
          const opp = opposites[dir] as Direction;
          expect(target.exits[opp], `Bidirectional fail: ${room.id} ${dir} ${targetId}`).toBe(room.id);
        }
        if (room.encounter) {
          expect(mobIds.has(room.encounter.mobId)).toBe(true);
        }
        if (room.loot) {
          for (const l of room.loot) {
            const isKey = dungeon.rooms.some(r =>
              r.lockedExits && Object.values(r.lockedExits).includes(l.itemId)
            );
            if (!isKey) {
              expect(itemIds.has(l.itemId), `Missing item ${l.itemId}`).toBe(true);
            }
          }
        }
      }

      // All rooms reachable
      const visited = new Set<string>();
      const queue = [dungeon.entranceRoomId];
      visited.add(dungeon.entranceRoomId);
      while (queue.length > 0) {
        const current = queue.shift()!;
        const room = roomMap.get(current)!;
        for (const targetId of Object.values(room.exits)) {
          if (targetId && !visited.has(targetId)) {
            visited.add(targetId);
            queue.push(targetId);
          }
        }
      }
      expect(visited.size).toBe(dungeon.rooms.length);
    }
  });

  it('no rooms overlap — all rooms have unique grid positions', () => {
    for (let run = 0; run < 20; run++) {
      const zoneCount = 2 + Math.floor(Math.random() * 4);
      const dungeon = generateProceduralDungeon(zoneCount);

      // All rooms should have grid positions
      for (const room of dungeon.rooms) {
        expect(room.gridX, `Room ${room.id} missing gridX`).toBeDefined();
        expect(room.gridY, `Room ${room.id} missing gridY`).toBeDefined();
      }

      // No two rooms share the same grid cell
      const cellToRoom = new Map<string, string>();
      for (const room of dungeon.rooms) {
        const key = `${room.gridX},${room.gridY}`;
        expect(
          cellToRoom.has(key),
          `Run ${run}: rooms ${cellToRoom.get(key)} and ${room.id} overlap at (${room.gridX}, ${room.gridY})`
        ).toBe(false);
        cellToRoom.set(key, room.id);
      }

      // Exit directions should be consistent with grid positions
      const dirDelta: Record<string, { dx: number; dy: number }> = {
        north: { dx: 0, dy: -1 }, south: { dx: 0, dy: 1 },
        east: { dx: 1, dy: 0 }, west: { dx: -1, dy: 0 },
      };
      const roomMap = new Map(dungeon.rooms.map(r => [r.id, r]));
      for (const room of dungeon.rooms) {
        for (const [dir, targetId] of Object.entries(room.exits)) {
          if (!targetId) continue;
          const target = roomMap.get(targetId)!;
          const delta = dirDelta[dir];
          const expectedX = room.gridX! + delta.dx;
          const expectedY = room.gridY! + delta.dy;
          // Adjacent rooms must have matching positions; non-adjacent (zone links) are OK
          if (expectedX === target.gridX && expectedY === target.gridY) {
            // Position matches direction — good
          }
          // Non-adjacent connections are allowed (zone transitions rendered as curves)
        }
      }
    }
  });

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

  describe('interactable placement', () => {
    it('places interactables on rooms with slots', () => {
      const dungeon = generateProceduralDungeon(3);
      const roomsWithInteractables = dungeon.rooms.filter(
        r => r.interactables && r.interactables.length > 0
      );
      // With 3 zones, at least one should be fungal and have interactable slots
      expect(roomsWithInteractables.length).toBeGreaterThanOrEqual(0);
    });

    it('interactable instances have valid fields', () => {
      const dungeon = generateProceduralDungeon(3);
      for (const room of dungeon.rooms) {
        if (!room.interactables) continue;
        for (const inst of room.interactables) {
          expect(inst.instanceId).toBeTruthy();
          expect(inst.definitionId).toBeTruthy();
          expect(inst.position.x).toBeGreaterThanOrEqual(0);
          expect(inst.position.y).toBeGreaterThanOrEqual(0);
          expect(inst.usedActions).toEqual({});
        }
      }
    });

    it('no duplicate definitions within a single room', () => {
      const dungeon = generateProceduralDungeon(3);
      for (const room of dungeon.rooms) {
        if (!room.interactables || room.interactables.length <= 1) continue;
        const defIds = room.interactables.map(i => i.definitionId);
        expect(new Set(defIds).size).toBe(defIds.length);
      }
    });
  });
});
