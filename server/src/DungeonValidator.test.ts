import { describe, it, expect } from 'vitest';
import { validateDungeon } from './DungeonValidator.js';
import { DRIPPING_HALLS } from '@caverns/shared';

describe('DungeonValidator', () => {
  it('accepts a valid dungeon (DRIPPING_HALLS)', () => {
    const errors = validateDungeon(DRIPPING_HALLS, { minRooms: 6, maxRooms: 16 });
    expect(errors).toEqual([]);
  });

  it('rejects missing entranceRoomId reference', () => {
    const dungeon = {
      ...DRIPPING_HALLS,
      entranceRoomId: 'nonexistent_room',
    };
    const errors = validateDungeon(dungeon, { minRooms: 6, maxRooms: 16 });
    expect(errors).toContainEqual(expect.stringContaining('entranceRoomId'));
  });

  it('rejects missing bossId reference', () => {
    const dungeon = {
      ...DRIPPING_HALLS,
      bossId: 'nonexistent_mob',
    };
    const errors = validateDungeon(dungeon, { minRooms: 6, maxRooms: 16 });
    expect(errors).toContainEqual(expect.stringContaining('bossId'));
  });

  it('rejects room encounter referencing nonexistent mob', () => {
    const dungeon = {
      ...DRIPPING_HALLS,
      rooms: DRIPPING_HALLS.rooms.map((r) =>
        r.id === 'fungal_grotto'
          ? { ...r, encounter: { mobId: 'fake_mob', skullRating: 1 as const } }
          : r
      ),
    };
    const errors = validateDungeon(dungeon, { minRooms: 6, maxRooms: 16 });
    expect(errors).toContainEqual(expect.stringContaining('fake_mob'));
  });

  it('rejects room loot referencing nonexistent item', () => {
    const dungeon = {
      ...DRIPPING_HALLS,
      rooms: DRIPPING_HALLS.rooms.map((r) =>
        r.id === 'fungal_grotto'
          ? { ...r, loot: [{ itemId: 'fake_item', location: 'chest' as const }] }
          : r
      ),
    };
    const errors = validateDungeon(dungeon, { minRooms: 6, maxRooms: 16 });
    expect(errors).toContainEqual(expect.stringContaining('fake_item'));
  });

  it('rejects mob lootTable referencing nonexistent item', () => {
    const dungeon = {
      ...DRIPPING_HALLS,
      mobs: DRIPPING_HALLS.mobs.map((m) =>
        m.id === 'fungal_crawler'
          ? { ...m, lootTable: ['nonexistent_weapon'] }
          : m
      ),
    };
    const errors = validateDungeon(dungeon, { minRooms: 6, maxRooms: 16 });
    expect(errors).toContainEqual(expect.stringContaining('nonexistent_weapon'));
  });

  it('rejects non-bidirectional exits', () => {
    const dungeon = {
      ...DRIPPING_HALLS,
      rooms: DRIPPING_HALLS.rooms.map((r) =>
        r.id === 'entrance'
          ? { ...r, exits: { north: 'fungal_grotto', east: 'dripping_tunnel', west: 'boss_room' } }
          : r
      ),
    };
    const errors = validateDungeon(dungeon, { minRooms: 6, maxRooms: 16 });
    expect(errors).toContainEqual(expect.stringContaining('bidirectional'));
  });

  it('rejects disconnected rooms', () => {
    const orphanRoom = {
      id: 'orphan',
      type: 'tunnel' as const,
      name: 'Orphan Room',
      description: 'Unreachable.',
      exits: {},
    };
    const dungeon = {
      ...DRIPPING_HALLS,
      rooms: [...DRIPPING_HALLS.rooms, orphanRoom],
    };
    const errors = validateDungeon(dungeon, { minRooms: 6, maxRooms: 20 });
    expect(errors).toContainEqual(expect.stringContaining('unreachable'));
  });

  it('rejects duplicate room IDs', () => {
    const dungeon = {
      ...DRIPPING_HALLS,
      rooms: [...DRIPPING_HALLS.rooms, DRIPPING_HALLS.rooms[0]],
    };
    const errors = validateDungeon(dungeon, { minRooms: 6, maxRooms: 20 });
    expect(errors).toContainEqual(expect.stringContaining('Duplicate'));
  });

  it('rejects room count outside range', () => {
    const errors = validateDungeon(DRIPPING_HALLS, { minRooms: 20, maxRooms: 30 });
    expect(errors).toContainEqual(expect.stringContaining('Room count'));
  });

  it('rejects entrance room with encounter', () => {
    const dungeon = {
      ...DRIPPING_HALLS,
      rooms: DRIPPING_HALLS.rooms.map((r) =>
        r.id === 'entrance'
          ? { ...r, encounter: { mobId: 'fungal_crawler', skullRating: 1 as const } }
          : r
      ),
    };
    const errors = validateDungeon(dungeon, { minRooms: 6, maxRooms: 16 });
    expect(errors).toContainEqual(expect.stringContaining('Entrance room'));
  });

  it('rejects dungeon with no boss room', () => {
    const dungeon = {
      ...DRIPPING_HALLS,
      rooms: DRIPPING_HALLS.rooms.map((r) =>
        r.type === 'boss' ? { ...r, type: 'chamber' as const } : r
      ),
    };
    const errors = validateDungeon(dungeon, { minRooms: 6, maxRooms: 16 });
    expect(errors).toContainEqual(expect.stringContaining('boss room'));
  });
});
