import { describe, it, expect } from 'vitest';
import { GUN_TYPES } from '@caverns/shared';
import { generateItem } from './generate.js';

// Ensure palettes are registered
import './index.js';

describe('generateItem skullRating stamp', () => {
  it('returns item with matching skullRating', () => {
    const item = generateItem({ slot: 'weapon', skullRating: 2, biomeId: 'fungal', seed: 42 });
    expect(item.skullRating).toBe(2);
  });

  it('skullRating 3 is preserved', () => {
    const item = generateItem({ slot: 'armor', skullRating: 3, biomeId: 'fungal', seed: 99 });
    expect(item.skullRating).toBe(3);
  });
});

describe('ranged generation', () => {
  it('produces valid guns across biomes, skulls and seeds', () => {
    for (const biomeId of ['starter', 'fungal', 'crystal', 'flooded', 'bone', 'volcanic']) {
      for (const skullRating of [1, 2, 3] as const) {
        for (let seed = 1; seed <= 20; seed++) {
          const item = generateItem({ slot: 'ranged', skullRating, biomeId, seed });
          expect(item.slot).toBe('ranged');
          expect(item.archetype).toBe('ranged');
          expect(item.stats.damage).toBeGreaterThanOrEqual(1);
          const type = Object.values(GUN_TYPES).find((g) => g.range === item.stats.range && g.magazine === item.stats.magazine);
          expect(type, `${biomeId}/${skullRating}/${seed}: ${item.name}`).toBeDefined();
        }
      }
    }
  });
});
