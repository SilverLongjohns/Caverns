import type { DropSpec } from '../types.js';

export interface ShopFixedEntry {
  consumableId: string;
}

export interface ShopTemplate {
  id: string;
  name: string;
  fixedStock: ShopFixedEntry[];
  rotatingDropSpecId: string;
  rotatingSlotCount: number;
  rerollCost: number;
  buyMarkup: number;
  sellBackPct: number;
}

export const SHOP_DROP_SPECS: Record<string, DropSpec> = {
  shop_starter_general: {
    pools: [
      {
        rolls: 1,
        entries: [
          { type: 'generated', slot: 'weapon',    skullRating: 1, weight: 3 },
          { type: 'generated', slot: 'offhand',   skullRating: 1, weight: 2 },
          { type: 'generated', slot: 'armor',     skullRating: 1, weight: 3 },
          { type: 'generated', slot: 'accessory', skullRating: 1, weight: 2 },
        ],
      },
    ],
  },
};

export const SHOP_TEMPLATES: Record<string, ShopTemplate> = {
  starter_general_store: {
    id: 'starter_general_store',
    name: 'General Store',
    fixedStock: [
      { consumableId: 'minor_hp_potion' },
      { consumableId: 'hp_potion' },
    ],
    rotatingDropSpecId: 'shop_starter_general',
    rotatingSlotCount: 4,
    rerollCost: 25,
    buyMarkup: 1.0,
    sellBackPct: 0.5,
  },
};
