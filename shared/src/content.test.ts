import { describe, it, expect } from 'vitest';
import { DRIPPING_HALLS } from './content.js';
import { DROP_SPECS } from './dropSpecs.js';
import type { Direction } from './types.js';

describe('Dripping Halls dungeon content', () => {
  it('has an entrance room', () => {
    const entrance = DRIPPING_HALLS.rooms.find(
      (r) => r.id === DRIPPING_HALLS.entranceRoomId
    );
    expect(entrance).toBeDefined();
  });

  it('has a boss room with the boss mob', () => {
    const bossRoom = DRIPPING_HALLS.rooms.find((r) => r.type === 'boss');
    expect(bossRoom).toBeDefined();
    expect(bossRoom!.encounter?.mobId).toBe(DRIPPING_HALLS.bossId);
  });

  it('all room exits reference valid room IDs', () => {
    const roomIds = new Set(DRIPPING_HALLS.rooms.map((r) => r.id));
    for (const room of DRIPPING_HALLS.rooms) {
      for (const [dir, targetId] of Object.entries(room.exits)) {
        expect(roomIds.has(targetId!), `Room ${room.id} exit ${dir} -> ${targetId} is invalid`).toBe(true);
      }
    }
  });

  it('all encounter mobIds reference valid mob templates', () => {
    const mobIds = new Set(DRIPPING_HALLS.mobs.map((m) => m.id));
    for (const room of DRIPPING_HALLS.rooms) {
      if (room.encounter) {
        expect(mobIds.has(room.encounter.mobId), `Room ${room.id} references unknown mob ${room.encounter.mobId}`).toBe(true);
      }
    }
  });

  it('all room drop spec refs resolve to a registered DropSpec', () => {
    for (const room of DRIPPING_HALLS.rooms) {
      if (!room.drops) continue;
      if ('dropSpecId' in room.drops) {
        expect(DROP_SPECS[room.drops.dropSpecId], `Room ${room.id} references unknown drop spec ${room.drops.dropSpecId}`).toBeDefined();
      } else {
        expect(room.drops.drops.pools.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('all mob drop spec refs resolve to a registered DropSpec', () => {
    for (const mob of DRIPPING_HALLS.mobs) {
      if ('dropSpecId' in mob.drops) {
        expect(DROP_SPECS[mob.drops.dropSpecId], `Mob ${mob.id} references unknown drop spec ${mob.drops.dropSpecId}`).toBeDefined();
      } else {
        expect(mob.drops.drops.pools.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('has 10 rooms', () => {
    expect(DRIPPING_HALLS.rooms.length).toBe(10);
  });

  it('has a biomeId', () => {
    expect(DRIPPING_HALLS.biomeId).toBeDefined();
    expect(typeof DRIPPING_HALLS.biomeId).toBe('string');
  });

  it('room exits are bidirectional', () => {
    const opposites: Record<string, string> = {
      north: 'south', south: 'north', east: 'west', west: 'east',
    };
    for (const room of DRIPPING_HALLS.rooms) {
      for (const [dir, targetId] of Object.entries(room.exits)) {
        const target = DRIPPING_HALLS.rooms.find((r) => r.id === targetId)!;
        const opposite = opposites[dir] as Direction;
        expect(
          target.exits[opposite],
          `Room ${room.id} -> ${dir} -> ${targetId} has no return path ${opposites[dir]}`
        ).toBe(room.id);
      }
    }
  });
});
