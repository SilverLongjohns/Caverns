import type { Quality } from './types.js';

export interface QualityTier {
  quality: Quality;
  multiplier: number;
  weight: number;
}

export const QUALITY_TIERS: QualityTier[] = [
  { quality: 'crude',      multiplier: 0.8,  weight: 20 },
  { quality: 'standard',   multiplier: 1.0,  weight: 45 },
  { quality: 'fine',        multiplier: 1.15, weight: 25 },
  { quality: 'superior',   multiplier: 1.3,  weight: 8 },
  { quality: 'masterwork', multiplier: 1.5,  weight: 2 },
];

const TOTAL_WEIGHT = QUALITY_TIERS.reduce((sum, t) => sum + t.weight, 0);

export function rollQuality(rng: () => number): Quality {
  let roll = rng() * TOTAL_WEIGHT;
  for (const tier of QUALITY_TIERS) {
    roll -= tier.weight;
    if (roll <= 0) return tier.quality;
  }
  return 'standard';
}

export function getQualityMultiplier(quality: Quality): number {
  return QUALITY_TIERS.find(t => t.quality === quality)!.multiplier;
}
