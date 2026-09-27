import { describe, it, expect } from 'vitest';
import { ITEM_ARCHETYPES } from '@caverns/shared';
import { itemIconSrc, actionIconSrc, slotGlyph, RELIC_FRAME_SRC } from './iconPaths.js';

describe('iconPaths', () => {
  it('maps items to archetype icons', () => {
    expect(itemIconSrc({ slot: 'weapon', name: 'Iron Mace' })).toBe('/ui/icons/items/blunt.png');
    expect(itemIconSrc({ slot: 'weapon', name: 'Worldsplitter', archetype: 'blade' })).toBe('/ui/icons/items/blade.png');
    expect(itemIconSrc({ slot: 'consumable', name: 'Mystery Goo' })).toBe('/ui/icons/items/consumable_misc.png');
  });

  it('every archetype has a path under /ui/icons/items', () => {
    for (const a of ITEM_ARCHETYPES) {
      expect(itemIconSrc({ slot: 'weapon', name: '', archetype: a } as never)).toMatch(/^\/ui\/icons\/items\/[a-z_]+\.png$/);
    }
  });

  it('maps actions and frame', () => {
    expect(actionIconSrc('end_turn')).toBe('/ui/icons/actions/end_turn.png');
    expect(RELIC_FRAME_SRC).toBe('/ui/relic_frame.png');
  });

  it('has a glyph for every slot', () => {
    for (const s of ['weapon', 'offhand', 'armor', 'accessory', 'consumable'] as const) {
      expect(slotGlyph(s)).toHaveLength(1);
    }
  });
});
