import { describe, it, expect } from 'vitest';
import type { Item, ShopTemplate } from '@caverns/shared';
import {
  generateRotating,
  buildShopView,
  applyBuyFixed,
  applyBuyRotating,
  applySell,
  applyReroll,
} from './ShopManager.js';

const itemsById = new Map<string, Item>([
  ['minor_hp_potion', {
    id: 'minor_hp_potion', name: 'Minor Health Potion', description: '',
    rarity: 'common', slot: 'consumable', stats: { healAmount: 15 },
  }],
  ['hp_potion', {
    id: 'hp_potion', name: 'Health Potion', description: '',
    rarity: 'uncommon', slot: 'consumable', stats: { healAmount: 25 },
  }],
]);

const template: ShopTemplate = {
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
};

function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

describe('generateRotating', () => {
  it('returns exactly rotatingSlotCount items', () => {
    const items = generateRotating(template, { biomeId: 'fungal', rng: seededRng(1) });
    expect(items).toHaveLength(4);
    expect(items.every((i) => i !== null)).toBe(true);
  });
});

describe('buildShopView', () => {
  it('prices fixed stock with buyMarkup', () => {
    const view = buildShopView(template, [null, null, null, null], itemsById);
    expect(view.fixed[0].consumableId).toBe('minor_hp_potion');
    expect(view.fixed[0].price).toBe(15); // common consumable skull1 * 1.0 markup
    expect(view.fixed[1].price).toBe(30); // uncommon consumable
  });

  it('maps rotating items with prices and nulls', () => {
    const rotating: (Item | null)[] = [
      { id: 'a', name: 'A', description: '', rarity: 'common', slot: 'weapon', stats: {}, skullRating: 1 },
      null, null, null,
    ];
    const view = buildShopView(template, rotating, itemsById);
    expect(view.rotating[0].item?.id).toBe('a');
    expect(view.rotating[0].price).toBe(40);
    expect(view.rotating[1].item).toBeNull();
    expect(view.rotating[1].price).toBeNull();
  });
});

describe('applyBuyFixed', () => {
  it('deducts gold, adds item to consumables pouch', () => {
    const state = {
      gold: 100,
      inventory: [null, null, null, null, null, null, null],
      consumables: [null, null, null, null, null, null],
    };
    const result = applyBuyFixed(template, state, 0, itemsById);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.gold).toBe(85); // 100 - 15
    expect(result.state.consumables[0]?.id).toBe('minor_hp_potion');
  });

  it('fails when out of gold', () => {
    const state = {
      gold: 5,
      inventory: [null], consumables: [null],
    };
    const result = applyBuyFixed(template, state, 0, itemsById);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_enough_gold');
  });

  it('fails when consumables pouch is full', () => {
    const fullItem: Item = { id: 'x', name: '', description: '', rarity: 'common', slot: 'consumable', stats: {} };
    const state = {
      gold: 100,
      inventory: [null],
      consumables: Array(6).fill(fullItem),
    };
    const result = applyBuyFixed(template, state, 0, itemsById);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_space');
  });
});

describe('applyBuyRotating', () => {
  it('deducts gold, places item in inventory, clears rotating slot', () => {
    const weapon: Item = {
      id: 'w1', name: 'W', description: '', rarity: 'common', slot: 'weapon',
      stats: { damage: 3 }, skullRating: 1,
    };
    const state = {
      gold: 100,
      inventory: [null, null, null, null, null, null, null],
      consumables: [null, null, null, null, null, null],
      rotating: [weapon, null, null, null] as (Item | null)[],
    };
    const result = applyBuyRotating(template, state, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.gold).toBe(60); // 100 - 40
    expect(result.state.inventory[0]?.id).toBe('w1');
    expect(result.state.rotating[0]).toBeNull();
  });

  it('fails when slot is already bought (null)', () => {
    const state = {
      gold: 100, inventory: [null], consumables: [null],
      rotating: [null, null, null, null] as (Item | null)[],
    };
    const result = applyBuyRotating(template, state, 0);
    expect(result.ok).toBe(false);
  });
});

describe('applySell', () => {
  it('pays sellPrice, removes item', () => {
    const weapon: Item = {
      id: 'w1', name: 'W', description: '', rarity: 'common', slot: 'weapon',
      stats: {}, skullRating: 1,
    };
    const state = {
      gold: 0,
      inventory: [weapon, null] as (Item | null)[],
      consumables: [null],
    };
    const result = applySell(template, state, 'inventory', 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.gold).toBe(20); // 40 * 0.5
    expect(result.state.inventory[0]).toBeNull();
  });

  it('fails when slot is empty', () => {
    const state = { gold: 0, inventory: [null], consumables: [null] };
    const result = applySell(template, state, 'inventory', 0);
    expect(result.ok).toBe(false);
  });
});

describe('applyReroll', () => {
  it('deducts cost, regenerates rotating', () => {
    const state = {
      gold: 100,
      rotating: [null, null, null, null] as (Item | null)[],
    };
    const result = applyReroll(template, state, { biomeId: 'fungal', rng: seededRng(7) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.gold).toBe(75);
    expect(result.state.rotating).toHaveLength(4);
    expect(result.state.rotating.every((i) => i !== null)).toBe(true);
  });

  it('fails when not enough gold', () => {
    const state = { gold: 10, rotating: [null, null, null, null] };
    const result = applyReroll(template, state, { biomeId: 'fungal', rng: seededRng(7) });
    expect(result.ok).toBe(false);
  });
});
