import { describe, it, expect } from 'vitest';
import items from './data/items.json' with { type: 'json' };
import uniqueItems from './data/uniqueItems.json' with { type: 'json' };
import { STARTER_WEAPON, STARTER_POTION, CLASS_STARTER_ITEMS, DRIPPING_HALLS } from './content.js';
import { isItemArchetype, ARCHETYPE_SLOTS } from './itemArchetypes.js';
import type { ItemSlot } from './types.js';

type Authored = { id: string; slot: string; archetype?: unknown };

const all: Authored[] = [
  ...(items as Authored[]),
  ...(uniqueItems as Authored[]),
  STARTER_WEAPON as Authored,
  STARTER_POTION as Authored,
  ...Object.values(CLASS_STARTER_ITEMS).flatMap((c) => [c.weapon, c.offhand] as Authored[]),
  ...(DRIPPING_HALLS.items as Authored[]),
];

describe('hand-authored item archetypes', () => {
  it.each(all.map((i) => [i.id, i] as const))('%s has a valid archetype for its slot', (_id, item) => {
    expect(isItemArchetype(item.archetype)).toBe(true);
    if (isItemArchetype(item.archetype)) {
      expect(ARCHETYPE_SLOTS[item.archetype]).toContain(item.slot as ItemSlot);
    }
  });
});
