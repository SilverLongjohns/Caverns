import { describe, it, expect } from 'vitest';
import { DROP_SPECS } from './dropSpecs.js';
import { DRIPPING_HALLS } from './content.js';
import type { EquipmentSlot } from './types.js';

const VALID_SLOTS: EquipmentSlot[] = ['weapon', 'offhand', 'armor', 'accessory'];

describe('DROP_SPECS registry', () => {
  const consumableIds = new Set(
    DRIPPING_HALLS.items.filter((i) => i.slot === 'consumable').map((i) => i.id),
  );
  const starterGearIds = new Set(
    DRIPPING_HALLS.items.filter((i) => i.slot !== 'consumable').map((i) => i.id),
  );

  for (const [specId, spec] of Object.entries(DROP_SPECS)) {
    describe(`spec "${specId}"`, () => {
      it('has at least one pool', () => {
        expect(spec.pools.length).toBeGreaterThanOrEqual(1);
      });

      for (let i = 0; i < spec.pools.length; i++) {
        const pool = spec.pools[i];
        it(`pool[${i}] has rolls >= 1 and at least one entry`, () => {
          expect(pool.rolls).toBeGreaterThanOrEqual(1);
          expect(pool.entries.length).toBeGreaterThanOrEqual(1);
        });

        for (let j = 0; j < pool.entries.length; j++) {
          const entry = pool.entries[j];
          it(`pool[${i}].entries[${j}] has non-negative weight`, () => {
            expect(entry.weight ?? 1).toBeGreaterThanOrEqual(0);
          });

          if (entry.type === 'consumable') {
            it(`pool[${i}].entries[${j}] references a valid consumable`, () => {
              expect(consumableIds.has(entry.consumableId)).toBe(true);
              expect(starterGearIds.has(entry.consumableId)).toBe(false);
            });
          }
          if (entry.type === 'generated') {
            it(`pool[${i}].entries[${j}] has valid slot`, () => {
              expect(VALID_SLOTS).toContain(entry.slot);
            });
            it(`pool[${i}].entries[${j}] sets exactly one of skullRating/skullOffset`, () => {
              const hasAbs = entry.skullRating != null;
              const hasOff = entry.skullOffset != null;
              expect(hasAbs !== hasOff).toBe(true);
            });
          }
          if (entry.type === 'gold') {
            it(`pool[${i}].entries[${j}] has min <= max and non-negative`, () => {
              expect(entry.min).toBeGreaterThanOrEqual(0);
              expect(entry.max).toBeGreaterThanOrEqual(entry.min);
            });
          }
        }
      }
    });
  }
});
