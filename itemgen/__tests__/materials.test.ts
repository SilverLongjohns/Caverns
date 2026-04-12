import { describe, it, expect } from 'vitest';
import { registerPalette, getPalette, rollMaterial } from '../src/materials.js';
import { createRng } from '../src/rng.js';
import type { BiomePalette } from '../src/types.js';

const testPalette: BiomePalette = {
  biomeId: 'test',
  materials: [
    { id: 'iron', name: 'Iron', statBias: { damage: 1.0 }, slots: ['weapon', 'armor'], tier: 1 },
    { id: 'steel', name: 'Steel', statBias: { damage: 1.2 }, slots: ['weapon', 'armor'], tier: 2 },
    { id: 'mythril', name: 'Mythril', statBias: { damage: 1.5 }, slots: ['weapon'], tier: 3 },
  ],
  nameFragments: {
    adjectives: ['sharp'],
    prefixes: ['Iron'],
    suffixes: ['bane'],
    baseTypes: { weapon: ['sword'], offhand: ['shield'], armor: ['plate'], accessory: ['ring'] },
  },
};

describe('material registry', () => {
  it('registers and retrieves palettes by biome ID', () => {
    registerPalette(testPalette);
    expect(getPalette('test')).toBe(testPalette);
  });

  it('throws on unknown biome ID', () => {
    expect(() => getPalette('nonexistent')).toThrow();
  });
});

describe('rollMaterial', () => {
  it('only returns materials matching the requested slot', () => {
    registerPalette(testPalette);
    const rng = createRng(42);
    for (let i = 0; i < 50; i++) {
      const mat = rollMaterial(testPalette, 'weapon', 3, rng);
      expect(mat.slots).toContain('weapon');
    }
  });

  it('skull-1 only rolls tier-1 materials', () => {
    registerPalette(testPalette);
    const rng = createRng(42);
    for (let i = 0; i < 100; i++) {
      const mat = rollMaterial(testPalette, 'weapon', 1, rng);
      expect(mat.tier).toBe(1);
    }
  });

  it('skull-3 can roll all tiers', () => {
    registerPalette(testPalette);
    const rng = createRng(42);
    const tiers = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const mat = rollMaterial(testPalette, 'weapon', 3, rng);
      tiers.add(mat.tier);
    }
    expect(tiers.has(1)).toBe(true);
    expect(tiers.has(2)).toBe(true);
    expect(tiers.has(3)).toBe(true);
  });

  it('throws if no materials match the slot', () => {
    registerPalette(testPalette);
    const rng = createRng(42);
    expect(() => rollMaterial(testPalette, 'accessory', 1, rng)).toThrow();
  });
});
