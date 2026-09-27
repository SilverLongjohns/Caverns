import { describe, it, expect } from 'vitest';
import { matchArchetype, ARCHETYPE_SLOTS } from '@caverns/shared';
import type { EquipmentSlot } from '@caverns/shared';
import { generateItem } from './generate.js';
import { getPalette } from './materials.js';
import './index.js'; // registers palettes

const SLOTS: EquipmentSlot[] = ['weapon', 'offhand', 'armor', 'accessory'];
const BIOMES = ['fungal', 'starter', 'crystal', 'flooded', 'bone', 'volcanic'];

function sample() {
  const out = [];
  for (const biomeId of BIOMES) for (const slot of SLOTS) for (const seed of [1, 7, 42, 99, 1234])
    for (const rarity of ['common', 'rare', 'legendary'] as const)
      out.push(generateItem({ slot, skullRating: 2, biomeId, seed, rarity }));
  return out;
}

describe('itemgen determinism', () => {
  it('seeded output is unchanged apart from archetype', () => {
    const items = sample().map(({ archetype: _a, ...rest }) => rest);
    expect(items).toMatchSnapshot();
  });
});

describe('itemgen archetypes', () => {
  it('every palette base type maps to an archetype valid for its slot', () => {
    for (const biomeId of BIOMES) {
      const palette = getPalette(biomeId);
      for (const slot of SLOTS) {
        for (const baseType of palette.nameFragments.baseTypes[slot]) {
          const a = matchArchetype(slot, baseType);
          expect(a, `${biomeId}/${slot}/${baseType}`).not.toBeNull();
          expect(ARCHETYPE_SLOTS[a!]).toContain(slot);
        }
      }
    }
  });

  it('generated items carry an archetype valid for their slot', () => {
    for (const item of sample()) {
      expect(item.archetype, item.name).toBeDefined();
      expect(ARCHETYPE_SLOTS[item.archetype!]).toContain(item.slot);
    }
  });
});
