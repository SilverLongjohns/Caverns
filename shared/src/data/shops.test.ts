import { describe, it, expect } from 'vitest';
import { SHOP_TEMPLATES, SHOP_DROP_SPECS } from './shops.js';

describe('SHOP_TEMPLATES', () => {
  it('registers starter_general_store', () => {
    const tpl = SHOP_TEMPLATES['starter_general_store'];
    expect(tpl).toBeDefined();
    expect(tpl.id).toBe('starter_general_store');
    expect(tpl.fixedStock.length).toBeGreaterThan(0);
    expect(tpl.rotatingSlotCount).toBeGreaterThan(0);
    expect(tpl.rerollCost).toBeGreaterThan(0);
    expect(tpl.sellBackPct).toBeGreaterThan(0);
    expect(tpl.sellBackPct).toBeLessThanOrEqual(1);
    expect(tpl.buyMarkup).toBeGreaterThan(0);
  });

  it('every template references a valid drop spec id', () => {
    for (const tpl of Object.values(SHOP_TEMPLATES)) {
      expect(SHOP_DROP_SPECS[tpl.rotatingDropSpecId]).toBeDefined();
    }
  });

  it('every fixed-stock consumableId resolves to an item id (string present)', () => {
    for (const tpl of Object.values(SHOP_TEMPLATES)) {
      for (const entry of tpl.fixedStock) {
        expect(typeof entry.consumableId).toBe('string');
        expect(entry.consumableId.length).toBeGreaterThan(0);
      }
    }
  });
});
