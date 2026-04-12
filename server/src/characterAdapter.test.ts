import { describe, it, expect } from 'vitest';
import { playerFromCharacter, characterSnapshotFromPlayer } from './characterAdapter.js';
import type { CharactersTable } from './db/types.js';

const baseCharacter = (): CharactersTable => ({
  id: 'char-1',
  account_id: 'acc-1',
  name: 'Alice',
  class: 'vanguard',
  level: 5,
  xp: 120,
  stat_allocations: { strength: 2 },
  equipment: { weapon: null, offhand: null, armor: null, accessory: null },
  inventory: Array(7).fill(null),
  consumables: Array(6).fill(null),
  gold: 42,
  keychain: ['rusty_key'],
  in_use: false,
  last_played_at: null,
  created_at: new Date(),
});

describe('characterAdapter', () => {
  it('hydrates a Player from a character row', () => {
    const p = playerFromCharacter(baseCharacter(), 'conn-1', 'room-1');
    expect(p.id).toBe('conn-1');
    expect(p.name).toBe('Alice');
    expect(p.className).toBe('vanguard');
    expect(p.level).toBe(5);
    expect(p.xp).toBe(120);
    expect(p.gold).toBe(42);
    expect(p.keychain).toEqual(['rusty_key']);
    expect(p.statAllocations).toEqual({ strength: 2 });
    expect(p.roomId).toBe('room-1');
    expect(p.hp).toBeGreaterThan(0);
    expect(p.maxHp).toBe(p.hp);
  });

  it('extracts a snapshot from a Player', () => {
    const p = playerFromCharacter(baseCharacter(), 'conn-1', 'room-1');
    p.gold = 99;
    p.xp = 200;
    const snap = characterSnapshotFromPlayer(p);
    expect(snap.gold).toBe(99);
    expect(snap.xp).toBe(200);
    expect(snap.equipment).toEqual(p.equipment);
    expect(snap.inventory).toEqual(p.inventory);
    expect(snap.consumables).toEqual(p.consumables);
    expect(snap.keychain).toEqual(p.keychain);
    expect(snap.stat_allocations).toEqual(p.statAllocations);
    expect(snap.level).toBe(p.level);
  });
});
