import type { Item, ItemSlot, Rarity } from './types.js';

const SLOT_BASE: Record<ItemSlot, number> = {
  weapon: 40,
  offhand: 30,
  armor: 50,
  accessory: 35,
  consumable: 15,
};

const SKULL_MULT: Record<1 | 2 | 3, number> = {
  1: 1.0,
  2: 2.5,
  3: 6.0,
};

const RARITY_MULT: Record<Rarity, number> = {
  common: 1.0,
  uncommon: 2.0,
  rare: 5.0,
  legendary: 12.0,
  unique: 25.0,
};

/** Deterministic base price for an item. No RNG. */
export function priceItem(item: Item): number {
  const skull = (item.skullRating ?? 1) as 1 | 2 | 3;
  return Math.round(
    SLOT_BASE[item.slot] * SKULL_MULT[skull] * RARITY_MULT[item.rarity],
  );
}

export function buyPrice(item: Item, markup: number): number {
  return Math.max(1, Math.round(priceItem(item) * markup));
}

export function sellPrice(item: Item, sellBackPct: number): number {
  return Math.max(1, Math.round(priceItem(item) * sellBackPct));
}
