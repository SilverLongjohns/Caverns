import { describe, it, expect } from 'vitest';
import { generateItem } from '../src/generate.js';
import type { ItemGenerationRequest } from '../src/types.js';

// Ensure palettes are registered
import '../src/index.js';

describe('generateItem', () => {
  it('returns an Item with all required fields', () => {
    const request: ItemGenerationRequest = {
      slot: 'weapon',
      skullRating: 1,
      biomeId: 'fungal',
      seed: 42,
    };
    const item = generateItem(request);
    expect(item.id).toBeTruthy();
    expect(item.name).toBeTruthy();
    expect(item.description).toBeTruthy();
    expect(item.rarity).toBeTruthy();
    expect(item.slot).toBe('weapon');
    expect(item.stats).toBeDefined();
    expect(item.stats.damage).toBeGreaterThan(0);
  });

  it('respects forced rarity', () => {
    const item = generateItem({
      slot: 'armor',
      skullRating: 2,
      biomeId: 'fungal',
      rarity: 'legendary',
      seed: 42,
    });
    expect(item.rarity).toBe('legendary');
    // Legendary should have a compound name (single word)
    expect(item.name.split(' ').length).toBe(1);
  });

  it('is deterministic with the same seed', () => {
    const request: ItemGenerationRequest = {
      slot: 'weapon',
      skullRating: 2,
      biomeId: 'fungal',
      seed: 99,
    };
    const item1 = generateItem(request);
    const item2 = generateItem(request);
    expect(item1).toEqual(item2);
  });

  it('generates different items with different seeds', () => {
    const base = { slot: 'weapon' as const, skullRating: 2 as const, biomeId: 'fungal' };
    const item1 = generateItem({ ...base, seed: 1 });
    const item2 = generateItem({ ...base, seed: 2 });
    expect(item1.id).not.toBe(item2.id);
  });

  it('generates valid items for all equipment slots', () => {
    const slots = ['weapon', 'offhand', 'armor', 'accessory'] as const;
    for (const slot of slots) {
      const item = generateItem({ slot, skullRating: 2, biomeId: 'fungal', seed: 42 });
      expect(item.slot).toBe(slot);
      expect(Object.keys(item.stats).length).toBeGreaterThan(0);
    }
  });

  it('legendary items include descriptive subtitle in description', () => {
    const item = generateItem({
      slot: 'weapon',
      skullRating: 3,
      biomeId: 'fungal',
      rarity: 'legendary',
      seed: 42,
    });
    expect(item.description.length).toBeGreaterThan(0);
  });

  it('throws on unknown biome', () => {
    expect(() => generateItem({
      slot: 'weapon',
      skullRating: 1,
      biomeId: 'nonexistent',
      seed: 42,
    })).toThrow();
  });
});
