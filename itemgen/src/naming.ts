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

/** Name plus the (lowercase) base type it was built from; the base type drives the item's icon archetype. */
export function generateNameParts(
  slot: EquipmentSlot,
  rarity: Rarity,
  quality: Quality,
  materialName: string,
  fragments: NameFragments,
  rng: () => number,
): { name: string; baseType: string } {
  const rawBaseType = pick(fragments.baseTypes[slot], rng);
  const baseType = capitalize(rawBaseType);

  if (rarity === 'legendary') {
    const prefix = pick(fragments.prefixes, rng);
    const suffix = pick(fragments.suffixes, rng);
    return { name: `${prefix}${suffix}`, baseType: rawBaseType };
  }

  if (rarity === 'rare') {
    const adjective = capitalize(pick(fragments.adjectives, rng));
    return { name: `${adjective} ${materialName} ${baseType}`, baseType: rawBaseType };
  }

  // Common / Uncommon
  const qualityWord = QUALITY_WORDS[quality];
  if (qualityWord) {
    return { name: `${qualityWord} ${materialName} ${baseType}`, baseType: rawBaseType };
  }
  return { name: `${materialName} ${baseType}`, baseType: rawBaseType };
}

export function generateName(
  slot: EquipmentSlot,
  rarity: Rarity,
  quality: Quality,
  materialName: string,
  fragments: NameFragments,
  rng: () => number,
): string {
  return generateNameParts(slot, rarity, quality, materialName, fragments, rng).name;
}
