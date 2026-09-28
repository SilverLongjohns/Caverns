import { archetypeFor } from '@caverns/shared';
import type { Item, ItemSlot } from '@caverns/shared';

export const RELIC_FRAME_SRC = '/ui/relic_frame.png';

export type ActionIcon = 'move' | 'attack' | 'defend' | 'abilities' | 'items' | 'flee' | 'end_turn';

export function itemIconSrc(item: Pick<Item, 'slot' | 'name' | 'archetype'>): string {
  return `/ui/icons/items/${archetypeFor(item)}.png`;
}

export function actionIconSrc(action: ActionIcon): string {
  return `/ui/icons/actions/${action}.png`;
}

// Text stand-ins for empty sockets and failed icon loads.
const SLOT_GLYPHS: Record<ItemSlot, string> = {
  weapon: '†', offhand: '◘', armor: '▣', accessory: '○', consumable: '¡', ranged: '¬',
};

export function slotGlyph(slot: ItemSlot): string {
  return SLOT_GLYPHS[slot];
}
