import type { Item, Rarity } from '@caverns/shared';
import type { ItemGenerationRequest } from './types.js';
import { createRng } from './rng.js';
import { getPalette, rollMaterial } from './materials.js';
import { rollQuality } from './quality.js';
import { generateStats } from './stats.js';
import { generateName } from './naming.js';

const RARITY_WEIGHTS: { rarity: Rarity; weight: number }[] = [
  { rarity: 'common',    weight: 40 },
  { rarity: 'uncommon',  weight: 35 },
  { rarity: 'rare',      weight: 20 },
  { rarity: 'legendary', weight: 5 },
];

const RARITY_TOTAL = RARITY_WEIGHTS.reduce((s, r) => s + r.weight, 0);

function rollRarity(rng: () => number): Rarity {
  let roll = rng() * RARITY_TOTAL;
  for (const entry of RARITY_WEIGHTS) {
    roll -= entry.weight;
    if (roll <= 0) return entry.rarity;
  }
  return 'common';
}

export function generateItem(request: ItemGenerationRequest): Item {
  const { slot, skullRating, biomeId, seed } = request;
  const rng = createRng(seed);
  const palette = getPalette(biomeId);

  // Roll rarity
  const rarity = request.rarity ?? rollRarity(rng);

  // Roll material
  const material = rollMaterial(palette, slot, skullRating, rng);

  // Roll quality
  const quality = rollQuality(rng);

  // Generate stats
  const stats = generateStats(slot, skullRating, material, quality, rng);

  // Generate name
  const name = generateName(slot, rarity, quality, material.name, palette.nameFragments, rng);

  // Build description
  let description: string;
  if (rarity === 'legendary') {
    const qualityWord = quality === 'standard' ? 'a' : `a ${quality}`;
    const baseTypes = palette.nameFragments.baseTypes[slot];
    const baseType = baseTypes[Math.floor(rng() * baseTypes.length)];
    description = `${name} — ${qualityWord} ${material.name.toLowerCase()} ${baseType}.`;
  } else {
    description = `A ${quality === 'standard' ? '' : quality + ' '}${material.name.toLowerCase()} ${slot}.`;
  }

  // Generate unique ID using RNG for determinism
  const idSuffix = Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0');
  const id = `gen_${slot}_${idSuffix}`;

  return { id, name, description, rarity, slot, stats };
}
