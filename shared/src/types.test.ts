import { describe, it, expect } from 'vitest';
import { computePlayerStats, createPlayer } from './types.js';

describe('computePlayerStats', () => {
  it('returns base stats with no equipment', () => {
    const player = createPlayer('p1', 'TestPlayer', 'room1');
    const stats = computePlayerStats(player);
    expect(stats.damage).toBe(5);
    expect(stats.defense).toBe(2);
    expect(stats.maxHp).toBe(50);
    expect(stats.initiative).toBe(5);
  });

  it('adds weapon damage', () => {
    const player = createPlayer('p1', 'TestPlayer', 'room1');
    player.equipment.weapon = {
      id: 'w1', name: 'Sword', description: '', rarity: 'common',
      slot: 'weapon', stats: { damage: 10 },
    };
    const stats = computePlayerStats(player);
    expect(stats.damage).toBe(15);
  });

  it('sums stats from all equipment slots', () => {
    const player = createPlayer('p1', 'TestPlayer', 'room1');
    player.equipment.weapon = {
      id: 'w1', name: 'Sword', description: '', rarity: 'common',
      slot: 'weapon', stats: { damage: 10 },
    };
    player.equipment.armor = {
      id: 'a1', name: 'Plate', description: '', rarity: 'uncommon',
      slot: 'armor', stats: { defense: 5, maxHp: 10 },
    };
    player.equipment.accessory = {
      id: 'ac1', name: 'Ring', description: '', rarity: 'rare',
      slot: 'accessory', stats: { initiative: 3 },
    };
    const stats = computePlayerStats(player);
    expect(stats.damage).toBe(15);
    expect(stats.defense).toBe(7);
    expect(stats.maxHp).toBe(60);
    expect(stats.initiative).toBe(8);
  });
});
