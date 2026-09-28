import type { Item, Rarity } from '@caverns/shared';
import { matchArchetype, SLOT_DEFAULT_ARCHETYPE, GUN_TYPES } from '@caverns/shared';
import type { ItemGenerationRequest } from './types.js';
import { createRng } from './rng.js';
import { getPalette, rollMaterial } from './materials.js';
import { rollQuality } from './quality.js';
import { generateStats } from './stats.js';
import { generateNameParts } from './naming.js';

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

function rollRarityFromWeights(
  weights: Partial<Record<Rarity, number>>,
  rng: () => number,
): Rarity {
  const entries = (Object.entries(weights) as [Rarity, number | undefined][])
    .filter(([, w]) => w != null && w > 0) as [Rarity, number][];
  if (entries.length === 0) return rollRarity(rng);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = rng() * total;
  for (const [rarity, w] of entries) {
    roll -= w;
    if (roll <= 0) return rarity;
  }
  return entries[entries.length - 1][0];
}

export function generateItem(request: ItemGenerationRequest): Item {
  const { slot, skullRating, biomeId, seed } = request;
  const rng = createRng(seed);
  const palette = getPalette(biomeId);

  // Roll rarity — explicit rarity wins; otherwise use provided weights, else defaults
  const rarity =
    request.rarity ??
    (request.rarityWeights
      ? rollRarityFromWeights(request.rarityWeights, rng)
      : rollRarity(rng));

  // Roll material
  const material = rollMaterial(palette, slot, skullRating, rng);

  // Roll quality
  const quality = rollQuality(rng);

  // Generate stats
  const stats = generateStats(slot, skullRating, material, quality, rng);

  // Generate name
  const { name, baseType: nameBaseType } = generateNameParts(slot, rarity, quality, material.name, palette.nameFragments, rng);

  // Build description. Legendary names carry no base type, so their icon follows the description's base type.
  let description: string;
  let iconBaseType = nameBaseType;
  if (rarity === 'legendary') {
    const qualityWord = quality === 'standard' ? 'a' : `a ${quality}`;
    const baseTypes = palette.nameFragments.baseTypes[slot];
    const baseType = baseTypes[Math.floor(rng() * baseTypes.length)];
    iconBaseType = baseType;
    description = `${name} — ${qualityWord} ${material.name.toLowerCase()} ${baseType}.`;
  } else {
    description = `A ${quality === 'standard' ? '' : quality + ' '}${material.name.toLowerCase()} ${slot}.`;
  }

  if (slot === 'ranged') {
    const gun = GUN_TYPES[iconBaseType];
    if (!gun) throw new Error(`Ranged base type '${iconBaseType}' has no GUN_TYPES entry`);
    stats.damage = Math.max(1, Math.round((stats.damage ?? 1) * gun.damageMult));
    stats.range = gun.range;
    stats.magazine = gun.magazine;
  }

  // Generate unique ID using RNG for determinism
  const idSuffix = Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0');
  const id = `gen_${slot}_${idSuffix}`;
  const archetype = matchArchetype(slot, iconBaseType) ?? SLOT_DEFAULT_ARCHETYPE[slot];

  return { id, name, description, rarity, slot, stats, skullRating, archetype };
}
