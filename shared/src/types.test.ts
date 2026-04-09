import { describe, it, expect } from 'vitest';
import { computePlayerStats, createPlayer, getPlayerEquippedEffects } from './types.js';
import type { InteractableInstance, InteractableDefinition, OutcomeType } from './types.js';

describe('createPlayer', () => {
  it('initializes with empty keychain', () => {
    const player = createPlayer('p1', 'Alice', 'room1');
    expect(player.keychain).toEqual([]);
  });

  it('initializes usedEffects as empty array', () => {
    const player = createPlayer('p1', 'Alice', 'room1');
    expect(player.usedEffects).toEqual([]);
  });
});

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

describe('getPlayerEquippedEffects', () => {
  it('extracts effects from equipped items', () => {
    const player = createPlayer('p1', 'TestPlayer', 'room1');
    player.equipment.weapon = {
      id: 'w1', name: 'Vampiric Blade', description: '', rarity: 'rare',
      slot: 'weapon', stats: { damage: 8 },
      effect: 'vampiric', effectParams: { drainPercent: 20 },
    };
    player.equipment.armor = {
      id: 'a1', name: 'Thornmail', description: '', rarity: 'uncommon',
      slot: 'armor', stats: { defense: 4 },
      effect: 'thorns', effectParams: { returnPercent: 15 },
    };
    const effects = getPlayerEquippedEffects(player);
    expect(effects).toHaveLength(2);
    expect(effects[0]).toEqual({ effectId: 'vampiric', params: { drainPercent: 20 }, sourceItemId: 'w1' });
    expect(effects[1]).toEqual({ effectId: 'thorns', params: { returnPercent: 15 }, sourceItemId: 'a1' });
  });

  it('skips items without effects', () => {
    const player = createPlayer('p1', 'TestPlayer', 'room1');
    player.equipment.weapon = {
      id: 'w1', name: 'Plain Sword', description: '', rarity: 'common',
      slot: 'weapon', stats: { damage: 5 },
    };
    player.equipment.armor = {
      id: 'a1', name: 'Leather Vest', description: '', rarity: 'common',
      slot: 'armor', stats: { defense: 2 },
      effect: 'thorns',
      // no effectParams — should be skipped
    };
    const effects = getPlayerEquippedEffects(player);
    expect(effects).toHaveLength(0);
  });

  it('returns empty array when no equipment is worn', () => {
    const player = createPlayer('p1', 'TestPlayer', 'room1');
    const effects = getPlayerEquippedEffects(player);
    expect(effects).toEqual([]);
  });
});

describe('Interactable types', () => {
  it('InteractableInstance has required fields', () => {
    const instance: InteractableInstance = {
      definitionId: 'fungal_glowing_cluster',
      instanceId: 'int_001',
      position: { x: 5, y: 3 },
      usedActions: {},
    };
    expect(instance.usedActions).toEqual({});
  });

  it('InteractableDefinition actions have outcome weights', () => {
    const def: InteractableDefinition = {
      id: 'test',
      name: 'Test',
      asciiChar: '?',
      biomes: ['fungal'],
      slotSize: 'small',
      actions: [
        { id: 'examine', label: 'Examine', outcomes: { weights: { loot: 40, hazard: 15, intel: 15, secret: 10, flavor: 20 } } },
      ],
    };
    expect(def.actions).toHaveLength(1);
    expect(def.actions[0].outcomes.weights.loot).toBe(40);
  });
});
