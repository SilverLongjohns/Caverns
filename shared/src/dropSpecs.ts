import type { DropSpec } from './types.js';

/**
 * Named drop specs referenced by DropSpecRef.dropSpecId.
 * See docs/superpowers/specs/2026-04-12-drop-system-design.md for authoring rules.
 */
export const DROP_SPECS: Record<string, DropSpec> = {
  // Mob specs (use skullOffset so one spec scales across tiers)
  fungal_mob_common: {
    pools: [
      {
        rolls: 1,
        entries: [
          { type: 'generated', slot: 'weapon', skullOffset: 0, weight: 2 },
          { type: 'generated', slot: 'armor', skullOffset: 0, weight: 2 },
          { type: 'generated', slot: 'accessory', skullOffset: 0, weight: 1 },
          { type: 'nothing', weight: 5 },
        ],
      },
      {
        rolls: 1,
        entries: [
          { type: 'consumable', consumableId: 'hp_potion', weight: 1 },
          { type: 'nothing', weight: 3 },
        ],
      },
      {
        rolls: 1,
        entries: [{ type: 'gold', min: 2, max: 8 }],
      },
    ],
  },

  fungal_mob_elite: {
    pools: [
      {
        rolls: 1,
        entries: [
          { type: 'generated', slot: 'weapon', skullOffset: 0, weight: 3 },
          { type: 'generated', slot: 'armor', skullOffset: 0, weight: 3 },
          { type: 'generated', slot: 'accessory', skullOffset: 0, weight: 2 },
          { type: 'nothing', weight: 2 },
        ],
      },
      {
        rolls: 1,
        entries: [{ type: 'consumable', consumableId: 'hp_potion' }],
      },
      {
        rolls: 1,
        entries: [{ type: 'gold', min: 8, max: 20 }],
      },
    ],
  },

  fungal_boss: {
    pools: [
      {
        rolls: 1,
        entries: [
          {
            type: 'generated',
            slot: 'weapon',
            skullRating: 3,
            rarityWeights: { rare: 60, legendary: 40 },
          },
        ],
      },
      {
        rolls: 1,
        entries: [
          {
            type: 'generated',
            slot: 'armor',
            skullRating: 3,
            rarityWeights: { rare: 60, legendary: 40 },
          },
        ],
      },
      {
        rolls: 1,
        entries: [{ type: 'gold', min: 40, max: 80 }],
      },
    ],
  },

  // Room specs (absolute skullRating; rooms have no tier of their own)
  fungal_room_common: {
    pools: [
      {
        rolls: 1,
        entries: [
          { type: 'generated', slot: 'weapon', skullRating: 1, weight: 1 },
          { type: 'generated', slot: 'armor', skullRating: 1, weight: 1 },
          { type: 'consumable', consumableId: 'hp_potion', weight: 2 },
          { type: 'nothing', weight: 4 },
        ],
      },
      {
        rolls: 1,
        entries: [{ type: 'gold', min: 3, max: 10 }],
      },
    ],
  },

  fungal_puzzle_reward: {
    pools: [
      {
        rolls: 1,
        entries: [
          { type: 'generated', slot: 'weapon', skullRating: 2, weight: 1 },
          { type: 'generated', slot: 'armor', skullRating: 2, weight: 1 },
          { type: 'generated', slot: 'accessory', skullRating: 2, weight: 1 },
        ],
      },
      {
        rolls: 1,
        entries: [{ type: 'gold', min: 10, max: 25 }],
      },
    ],
  },
};
