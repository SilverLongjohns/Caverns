import type { ItemStats, EquipmentSlot } from '@caverns/shared';
import type { MaterialDef, Quality } from './types.js';
import { getQualityMultiplier } from './quality.js';

interface StatRange {
  min: number;
  max: number;
}

type SlotStatRanges = Record<number, StatRange>;

export const BASE_STAT_RANGES: Record<EquipmentSlot, SlotStatRanges> = {
  weapon:    { 1: { min: 2, max: 4 },  2: { min: 5, max: 8 },   3: { min: 10, max: 14 } },
  offhand:   { 1: { min: 1, max: 2 },  2: { min: 3, max: 4 },   3: { min: 5, max: 7 } },
  armor:     { 1: { min: 1, max: 3 },  2: { min: 3, max: 5 },   3: { min: 5, max: 8 } },
  accessory: { 1: { min: 3, max: 5 },  2: { min: 6, max: 10 },  3: { min: 10, max: 15 } },
};

/** Ceiling = next skull tier's floor. Skull-3 has no ceiling. */
export const STAT_CEILINGS: Record<EquipmentSlot, Record<number, number | null>> = {
  weapon:    { 1: 5,  2: 10, 3: null },
  offhand:   { 1: 3,  2: 5,  3: null },
  armor:     { 1: 3,  2: 5,  3: null },
  accessory: { 1: 6,  2: 10, 3: null },
};

const PRIMARY_STAT: Record<EquipmentSlot, keyof ItemStats> = {
  weapon: 'damage',
  offhand: 'defense',
  armor: 'defense',
  accessory: 'damage', // placeholder — accessories pick a random primary
};

const ACCESSORY_STATS: (keyof ItemStats)[] = ['maxHp', 'damage', 'defense', 'initiative'];

const VARIANCE = 0.15;

function rollInRange(min: number, max: number, rng: () => number): number {
  return min + rng() * (max - min);
}

function applyVariance(value: number, rng: () => number): number {
  const factor = 1 + (rng() * 2 - 1) * VARIANCE;
  return value * factor;
}

export function generateStats(
  slot: EquipmentSlot,
  skullRating: number,
  material: MaterialDef,
  quality: Quality,
  rng: () => number,
): ItemStats {
  const range = BASE_STAT_RANGES[slot][skullRating];
  const ceiling = STAT_CEILINGS[slot][skullRating];
  const qualityMult = getQualityMultiplier(quality);

  const primaryStat = slot === 'accessory'
    ? ACCESSORY_STATS[Math.floor(rng() * ACCESSORY_STATS.length)]
    : PRIMARY_STAT[slot];

  let baseValue = rollInRange(range.min, range.max, rng);

  const bias = material.statBias[primaryStat as keyof typeof material.statBias] ?? 1.0;
  baseValue *= bias;

  baseValue *= qualityMult;

  baseValue = applyVariance(baseValue, rng);

  let finalValue = Math.max(1, Math.round(baseValue));
  if (ceiling !== null) {
    finalValue = Math.min(finalValue, ceiling);
  }

  const stats: ItemStats = {};
  stats[primaryStat] = finalValue;

  return stats;
}
