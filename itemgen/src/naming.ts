import type { EquipmentSlot, Rarity } from '@caverns/shared';
import type { NameFragments, Quality } from './types.js';

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const QUALITY_WORDS: Record<Quality, string | null> = {
  crude: 'Crude',
  standard: null,
  fine: 'Fine',
  superior: 'Superior',
  masterwork: 'Masterwork',
};

export function generateName(
  slot: EquipmentSlot,
  rarity: Rarity,
  quality: Quality,
  materialName: string,
  fragments: NameFragments,
  rng: () => number,
): string {
  const baseType = capitalize(pick(fragments.baseTypes[slot], rng));

  if (rarity === 'legendary') {
    const prefix = pick(fragments.prefixes, rng);
    const suffix = pick(fragments.suffixes, rng);
    return `${prefix}${suffix}`;
  }

  if (rarity === 'rare') {
    const adjective = capitalize(pick(fragments.adjectives, rng));
    return `${adjective} ${materialName} ${baseType}`;
  }

  // Common / Uncommon
  const qualityWord = QUALITY_WORDS[quality];
  if (qualityWord) {
    return `${qualityWord} ${materialName} ${baseType}`;
  }
  return `${materialName} ${baseType}`;
}
