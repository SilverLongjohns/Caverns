import type { ItemSlot } from './types.js';

// Icon archetypes: every item resolves to one, and each has a 32x32 icon at
// client/public/ui/icons/items/<archetype>.png.
export const ITEM_ARCHETYPES = [
  'blade', 'dagger', 'blunt', 'axe', 'polearm', 'staff', 'ranged',
  'shield', 'focus', 'tome',
  'armor_light', 'armor_medium', 'armor_heavy',
  'ring', 'amulet', 'charm', 'circlet',
  'potion', 'potion_greater', 'bandage', 'elixir', 'bomb', 'consumable_misc',
] as const;

export type ItemArchetype = (typeof ITEM_ARCHETYPES)[number];

const ARCHETYPE_SET = new Set<string>(ITEM_ARCHETYPES);

export function isItemArchetype(v: unknown): v is ItemArchetype {
  return typeof v === 'string' && ARCHETYPE_SET.has(v);
}

export const ARCHETYPE_SLOTS: Record<ItemArchetype, readonly ItemSlot[]> = {
  blade: ['weapon'], dagger: ['weapon', 'offhand'], blunt: ['weapon'], axe: ['weapon'],
  polearm: ['weapon'], staff: ['weapon'], ranged: ['weapon', 'ranged'],
  shield: ['offhand'], focus: ['offhand'], tome: ['offhand'],
  armor_light: ['armor'], armor_medium: ['armor'], armor_heavy: ['armor'],
  ring: ['accessory'], amulet: ['accessory'], charm: ['accessory'], circlet: ['accessory'],
  potion: ['consumable'], potion_greater: ['consumable'], bandage: ['consumable'],
  elixir: ['consumable'], bomb: ['consumable'], consumable_misc: ['consumable'],
};

export const SLOT_DEFAULT_ARCHETYPE: Record<ItemSlot, ItemArchetype> = {
  weapon: 'blade', offhand: 'shield', armor: 'armor_light', accessory: 'amulet', consumable: 'consumable_misc',
  ranged: 'ranged',
};

// Whole-word keywords (lowercase; multi-word allowed). Covers every base type in itemgen's palettes.
const KEYWORDS: Record<ItemArchetype, readonly string[]> = {
  blade: ['sword', 'blade', 'cutlass', 'katana', 'shortsword'],
  dagger: ['dagger', 'daggers', 'stiletto', 'claws', 'gauntlets'],
  blunt: ['mace', 'maul', 'club', 'hammer', 'flail'],
  axe: ['axe', 'cleaver'],
  polearm: ['spear', 'lance', 'harpoon', 'trident'],
  staff: ['staff'],
  ranged: ['crossbow', 'bow', 'gun', 'autogun', 'rifle', 'pistol', 'sidearm', 'scattergun', 'blunderbuss', 'repeater'],
  shield: ['shield', 'buckler', 'ward', 'bulwark', 'guard'],
  focus: ['orb', 'focus', 'lantern', 'symbol', 'horn', 'gauntlet', 'toolkit', 'cloak'],
  tome: ['tome'],
  armor_light: ['wrap', 'vest', 'tunic', 'gambeson', 'weave', 'mantle', 'greaves', 'harness'],
  armor_medium: ['mail', 'hauberk', 'brigandine', 'scale'],
  armor_heavy: ['plate', 'cuirass', 'helm'],
  ring: ['ring', 'band', 'earring'],
  amulet: ['amulet', 'pendant', 'necklace', 'talisman'],
  charm: ['charm', 'brooch', 'plume'],
  circlet: ['circlet', 'bracelet', 'crown'],
  potion: ['potion'],
  potion_greater: ['greater health potion', 'greater potion'],
  bandage: ['bandage', 'salve', 'poultice', 'paste'],
  elixir: ['elixir', 'draught', 'tonic', 'flask'],
  bomb: ['bomb', 'charge', 'grenade', 'pod'],
  consumable_misc: [],
};

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
}

/** Keyword match restricted to archetypes valid for `slot`. The match ending latest wins; ties go to the longer keyword. */
export function matchArchetype(slot: ItemSlot, text: string): ItemArchetype | null {
  const w = words(text);
  let best: { archetype: ItemArchetype; end: number; len: number } | null = null;
  for (const archetype of ITEM_ARCHETYPES) {
    if (!ARCHETYPE_SLOTS[archetype].includes(slot)) continue;
    for (const kw of KEYWORDS[archetype]) {
      const k = kw.split(' ');
      for (let i = 0; i + k.length <= w.length; i++) {
        if (!k.every((part, j) => w[i + j] === part)) continue;
        const end = i + k.length;
        if (!best || end > best.end || (end === best.end && k.length > best.len)) {
          best = { archetype, end, len: k.length };
        }
      }
    }
  }
  return best?.archetype ?? null;
}

export function archetypeFor(item: { slot: ItemSlot; name: string; archetype?: string }): ItemArchetype {
  if (isItemArchetype(item.archetype) && ARCHETYPE_SLOTS[item.archetype].includes(item.slot)) return item.archetype;
  return matchArchetype(item.slot, item.name) ?? SLOT_DEFAULT_ARCHETYPE[item.slot];
}
