import type { EquipmentSlot } from '@caverns/shared';
import type { BiomePalette, MaterialDef } from './types.js';

const registry = new Map<string, BiomePalette>();

export function registerPalette(palette: BiomePalette): void {
  registry.set(palette.biomeId, palette);
}

export function getPalette(biomeId: string): BiomePalette {
  const palette = registry.get(biomeId);
  if (!palette) throw new Error(`Unknown biome palette: ${biomeId}`);
  return palette;
}

const TIER_WEIGHTS: Record<number, Record<number, number>> = {
  1: { 1: 100, 2: 0,  3: 0 },
  2: { 1: 35,  2: 60, 3: 5 },
  3: { 1: 12,  2: 60, 3: 28 },
};

export function rollMaterial(
  palette: BiomePalette,
  slot: EquipmentSlot,
  skullRating: number,
  rng: () => number,
): MaterialDef {
  const weights = TIER_WEIGHTS[skullRating] ?? TIER_WEIGHTS[1];

  const candidates = palette.materials.filter(m => m.slots.includes(slot));
  if (candidates.length === 0) {
    throw new Error(`No materials for slot '${slot}' in biome '${palette.biomeId}'`);
  }

  const tierTotal = Object.values(weights).reduce((a, b) => a + b, 0);
  let tierRoll = rng() * tierTotal;
  let selectedTier = 1;
  for (const [tier, weight] of Object.entries(weights)) {
    tierRoll -= weight;
    if (tierRoll <= 0) {
      selectedTier = Number(tier);
      break;
    }
  }

  let tierCandidates = candidates.filter(m => m.tier === selectedTier);

  if (tierCandidates.length === 0) {
    for (const fallbackTier of [selectedTier - 1, selectedTier + 1, 1, 2, 3]) {
      tierCandidates = candidates.filter(m => m.tier === fallbackTier);
      if (tierCandidates.length > 0) break;
    }
  }

  return tierCandidates[Math.floor(rng() * tierCandidates.length)];
}
