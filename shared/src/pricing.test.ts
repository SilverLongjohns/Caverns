import { describe, it, expect } from 'vitest';
import { priceItem, buyPrice, sellPrice } from './pricing.js';
import type { Item } from './types.js';

function mkItem(partial: Partial<Item>): Item {
  return {
    id: 'x', name: 'x', description: 'x',
    rarity: 'common', slot: 'weapon', stats: {},
    ...partial,
  };
}

describe('priceItem', () => {
  it('prices a common skull-1 weapon at slotBase * 1.0 * 1.0 = 40', () => {
    expect(priceItem(mkItem({ rarity: 'common', slot: 'weapon', skullRating: 1 }))).toBe(40);
  });

  it('applies rarity multiplier (uncommon = 2.0)', () => {
    expect(priceItem(mkItem({ rarity: 'uncommon', slot: 'weapon', skullRating: 1 }))).toBe(80);
  });

  it('applies skull multiplier (skull 2 = 2.5)', () => {
    expect(priceItem(mkItem({ rarity: 'common', slot: 'weapon', skullRating: 2 }))).toBe(100);
  });

  it('stacks multipliers (rare skull 3 weapon = 40 * 6 * 5 = 1200)', () => {
    expect(priceItem(mkItem({ rarity: 'rare', slot: 'weapon', skullRating: 3 }))).toBe(1200);
  });

  it('defaults skull 1 when item lacks skullRating', () => {
    expect(priceItem(mkItem({ rarity: 'common', slot: 'consumable' }))).toBe(15);
  });

  it('prices all slots at common skull 1', () => {
    expect(priceItem(mkItem({ slot: 'weapon' }))).toBe(40);
    expect(priceItem(mkItem({ slot: 'offhand' }))).toBe(30);
    expect(priceItem(mkItem({ slot: 'armor' }))).toBe(50);
    expect(priceItem(mkItem({ slot: 'accessory' }))).toBe(35);
    expect(priceItem(mkItem({ slot: 'consumable' }))).toBe(15);
  });
});

describe('buyPrice / sellPrice', () => {
  const item = mkItem({ rarity: 'common', slot: 'weapon', skullRating: 1 }); // base 40

  it('buyPrice multiplies by markup and rounds', () => {
    expect(buyPrice(item, 1.0)).toBe(40);
    expect(buyPrice(item, 1.25)).toBe(50);
  });

  it('sellPrice multiplies by sell fraction and rounds', () => {
    expect(sellPrice(item, 0.5)).toBe(20);
    expect(sellPrice(item, 0.4)).toBe(16);
  });

  it('sellPrice is never negative or zero for priced items', () => {
    expect(sellPrice(item, 0.01)).toBeGreaterThanOrEqual(1);
  });
});
