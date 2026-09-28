import { describe, it, expect } from 'vitest';
import {
  ITEM_ARCHETYPES, ARCHETYPE_SLOTS, isItemArchetype, matchArchetype, archetypeFor, SLOT_DEFAULT_ARCHETYPE,
} from './itemArchetypes.js';
import { GUN_TYPES } from './combat/ranged.js';

describe('ITEM_ARCHETYPES', () => {
  it('has 23 unique archetypes, each valid for at least one slot', () => {
    expect(ITEM_ARCHETYPES).toHaveLength(23);
    expect(new Set(ITEM_ARCHETYPES).size).toBe(23);
    for (const a of ITEM_ARCHETYPES) expect(ARCHETYPE_SLOTS[a].length).toBeGreaterThan(0);
  });

  it('slot defaults are valid for their slot', () => {
    for (const [slot, a] of Object.entries(SLOT_DEFAULT_ARCHETYPE)) {
      expect(ARCHETYPE_SLOTS[a]).toContain(slot);
    }
  });
});

describe('matchArchetype', () => {
  it.each([
    ['weapon', 'Rusty Shortsword', 'blade'],
    ['weapon', 'Crude Iron Sword', 'blade'],
    ['weapon', 'Fine Bone Femur Flail', 'blunt'],
    ['weapon', 'Ember War Axe', 'axe'],
    ['weapon', 'Brine Harpoon', 'polearm'],
    ['weapon', 'Repeating Crossbow', 'ranged'],
    ['offhand', 'Steel Parrying Dagger', 'dagger'],
    ['offhand', 'Pearl Orb', 'focus'],
    ['offhand', 'Marrow Tome', 'tome'],
    ['armor', 'Leviathan Scale', 'armor_medium'],
    ['armor', 'Forge-Heart Cuirass', 'armor_heavy'],
    ['armor', 'Brine Weave', 'armor_light'],
    ['accessory', 'Tide Band', 'ring'],
    ['accessory', 'Pearl Earring', 'ring'],
    ['accessory', 'Vertebrae Necklace', 'amulet'],
    ['accessory', 'Rib Brooch', 'charm'],
    ['accessory', 'Inferno Circlet', 'circlet'],
    ['consumable', 'Greater Health Potion', 'potion_greater'],
    ['consumable', 'Minor Health Potion', 'potion'],
    ['consumable', 'Cave Moss Poultice', 'bandage'],
    ['consumable', 'Spirit Draught', 'elixir'],
    ['consumable', 'Depth Charge', 'bomb'],
  ] as const)('%s "%s" -> %s', (slot, name, expected) => {
    expect(matchArchetype(slot, name)).toBe(expected);
  });

  it('matches whole words only', () => {
    expect(matchArchetype('accessory', 'Staring Eye')).toBeNull();
    expect(matchArchetype('offhand', 'Shieldward')).toBeNull();
    expect(matchArchetype('weapon', 'Quartzlance')).toBeNull();
  });

  it('only considers archetypes valid for the slot', () => {
    // "charge" is a bomb keyword, but bombs are consumables
    expect(matchArchetype('weapon', 'Charge')).toBeNull();
    // "shield" is an offhand keyword
    expect(matchArchetype('armor', 'Shield Plate')).toBe('armor_heavy');
  });

  it('prefers the match that ends latest (the base type ends the name)', () => {
    // both "mantle" and "plate" are armor keywords; the later one is the base type
    expect(matchArchetype('armor', 'Mantle Plate')).toBe('armor_heavy');
    expect(matchArchetype('armor', 'Plate Mantle')).toBe('armor_light');
  });

  it('is case-insensitive and tolerates hyphens and apostrophes', () => {
    expect(matchArchetype('weapon', "EXECUTIONER'S AXE")).toBe('axe');
    expect(matchArchetype('armor', 'Forge-Heart Brigandine')).toBe('armor_medium');
  });
});

describe('archetypeFor', () => {
  it('uses a valid explicit archetype first', () => {
    expect(archetypeFor({ slot: 'weapon', name: 'Worldsplitter', archetype: 'blade' })).toBe('blade');
  });

  it('ignores an unknown explicit archetype and falls through', () => {
    expect(archetypeFor({ slot: 'weapon', name: 'Iron Mace', archetype: 'laser' })).toBe('blunt');
  });

  it('falls back to the slot default for keyword-less names', () => {
    expect(archetypeFor({ slot: 'weapon', name: 'Grimfang' })).toBe('blade');
    expect(archetypeFor({ slot: 'offhand', name: 'Aegis of the Fallen' })).toBe('shield');
    expect(archetypeFor({ slot: 'armor', name: 'Rotbloom' })).toBe('armor_light');
    expect(archetypeFor({ slot: 'accessory', name: 'Oathkeeper' })).toBe('amulet');
    expect(archetypeFor({ slot: 'consumable', name: 'Crushed Crystal Dust' })).toBe('consumable_misc');
  });

  it('isItemArchetype narrows strings', () => {
    expect(isItemArchetype('tome')).toBe(true);
    expect(isItemArchetype('laser')).toBe(false);
    expect(isItemArchetype(undefined)).toBe(false);
  });
});

it('every gun type name resolves to the ranged archetype in the ranged slot', () => {
  for (const name of Object.keys(GUN_TYPES)) {
    expect(archetypeFor({ slot: 'ranged', name: `Rusty ${name}` }), name).toBe('ranged');
  }
});
