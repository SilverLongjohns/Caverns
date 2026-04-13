import { describe, it, expect } from 'vitest';
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
