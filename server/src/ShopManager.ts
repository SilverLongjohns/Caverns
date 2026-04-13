import type { Item, ShopTemplate, ShopView } from '@caverns/shared';
import { buyPrice, sellPrice, SHOP_DROP_SPECS } from '@caverns/shared';
import { resolveDrops } from './DropResolver.js';

export interface GenerateCtx {
  biomeId: string;
  rng: () => number;
}

export function generateRotating(
  template: ShopTemplate,
  ctx: GenerateCtx,
): (Item | null)[] {
  const out: (Item | null)[] = [];
  const itemsByIdEmpty = new Map<string, Item>();
  for (let i = 0; i < template.rotatingSlotCount; i++) {
    const results = resolveDrops(
      { dropSpecId: template.rotatingDropSpecId },
      {
        biomeId: ctx.biomeId,
        registry: SHOP_DROP_SPECS,
        itemsById: itemsByIdEmpty,
        rng: ctx.rng,
      },
    );
    const itemResult = results.find((r) => r.kind === 'item');
    out.push(itemResult && itemResult.kind === 'item' ? itemResult.item : null);
  }
  return out;
}

export function buildShopView(
  template: ShopTemplate,
  rotating: (Item | null)[],
  itemsById: Map<string, Item>,
): ShopView {
  return {
    shopId: template.id,
    name: template.name,
    fixed: template.fixedStock.map((e) => {
      const item = itemsById.get(e.consumableId);
      if (!item) throw new Error(`Unknown consumableId in shop fixed stock: ${e.consumableId}`);
      return {
        consumableId: e.consumableId,
        item,
        price: buyPrice(item, template.buyMarkup),
      };
    }),
    rotating: rotating.map((item) => ({
      item,
      price: item ? buyPrice(item, template.buyMarkup) : null,
    })),
    rerollCost: template.rerollCost,
    sellBackPct: template.sellBackPct,
  };
}

// ==== Buy / Sell / Reroll ====

export type OpResult<S> =
  | { ok: true; state: S }
  | { ok: false; reason: string };

interface BuyState {
  gold: number;
  inventory: (Item | null)[];
  consumables: (Item | null)[];
}

function firstFreeSlot(slots: (Item | null)[]): number {
  return slots.findIndex((s) => s === null);
}

export function applyBuyFixed(
  template: ShopTemplate,
  state: BuyState,
  index: number,
  itemsById: Map<string, Item>,
): OpResult<BuyState> {
  const entry = template.fixedStock[index];
  if (!entry) return { ok: false, reason: 'invalid_index' };
  const item = itemsById.get(entry.consumableId);
  if (!item) return { ok: false, reason: 'unknown_item' };
  const price = buyPrice(item, template.buyMarkup);
  if (state.gold < price) return { ok: false, reason: 'not_enough_gold' };

  const target = item.slot === 'consumable' ? 'consumables' : 'inventory';
  const slots = target === 'consumables' ? state.consumables : state.inventory;
  const free = firstFreeSlot(slots);
  if (free === -1) return { ok: false, reason: 'no_space' };

  const nextSlots = [...slots];
  nextSlots[free] = { ...item };
  return {
    ok: true,
    state: {
      gold: state.gold - price,
      inventory: target === 'inventory' ? nextSlots : state.inventory,
      consumables: target === 'consumables' ? nextSlots : state.consumables,
    },
  };
}

interface RotatingBuyState extends BuyState {
  rotating: (Item | null)[];
}

export function applyBuyRotating(
  template: ShopTemplate,
  state: RotatingBuyState,
  index: number,
): OpResult<RotatingBuyState> {
  const item = state.rotating[index];
  if (!item) return { ok: false, reason: 'slot_empty' };
  const price = buyPrice(item, template.buyMarkup);
  if (state.gold < price) return { ok: false, reason: 'not_enough_gold' };

  const target = item.slot === 'consumable' ? 'consumables' : 'inventory';
  const slots = target === 'consumables' ? state.consumables : state.inventory;
  const free = firstFreeSlot(slots);
  if (free === -1) return { ok: false, reason: 'no_space' };

  const nextSlots = [...slots];
  nextSlots[free] = item;
  const nextRotating = [...state.rotating];
  nextRotating[index] = null;

  return {
    ok: true,
    state: {
      gold: state.gold - price,
      inventory: target === 'inventory' ? nextSlots : state.inventory,
      consumables: target === 'consumables' ? nextSlots : state.consumables,
      rotating: nextRotating,
    },
  };
}

export function applySell(
  template: ShopTemplate,
  state: BuyState,
  from: 'inventory' | 'consumables',
  fromIndex: number,
): OpResult<BuyState> {
  const slots = from === 'inventory' ? state.inventory : state.consumables;
  const item = slots[fromIndex];
  if (!item) return { ok: false, reason: 'slot_empty' };
  const price = sellPrice(item, template.sellBackPct);

  const nextSlots = [...slots];
  nextSlots[fromIndex] = null;
  return {
    ok: true,
    state: {
      gold: state.gold + price,
      inventory: from === 'inventory' ? nextSlots : state.inventory,
      consumables: from === 'consumables' ? nextSlots : state.consumables,
    },
  };
}

interface RerollState {
  gold: number;
  rotating: (Item | null)[];
}

export function applyReroll(
  template: ShopTemplate,
  state: RerollState,
  ctx: GenerateCtx,
): OpResult<RerollState> {
  if (state.gold < template.rerollCost) return { ok: false, reason: 'not_enough_gold' };
  const rotating = generateRotating(template, ctx);
  return {
    ok: true,
    state: {
      gold: state.gold - template.rerollCost,
      rotating,
    },
  };
}
