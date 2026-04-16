import type { BiomePalette } from '../types.js';

export const DRIPPING_HALLS_PALETTE: BiomePalette = {
  biomeId: 'fungal',
  materials: [
    { id: 'bone', name: 'Bone', statBias: { damage: 1.2, defense: 0.8 }, slots: ['weapon', 'offhand', 'accessory'], tier: 1 },
    { id: 'chitin', name: 'Chitin', statBias: { defense: 1.2, initiative: 0.8 }, slots: ['armor', 'offhand'], tier: 1 },
    { id: 'mycelium', name: 'Mycelium', statBias: { maxHp: 1.3, damage: 1.0, defense: 1.0 }, slots: ['weapon', 'armor', 'accessory'], tier: 2 },
    { id: 'crystal', name: 'Crystal', statBias: { damage: 1.2, initiative: 1.2 }, slots: ['weapon', 'offhand', 'accessory'], tier: 2 },
    { id: 'sporecap', name: 'Sporecap', statBias: { defense: 1.2, maxHp: 1.2, initiative: 0.8 }, slots: ['armor', 'offhand'], tier: 2 },
    { id: 'deepstone', name: 'Deepstone', statBias: { defense: 1.3, damage: 1.2 }, slots: ['weapon', 'armor'], tier: 3 },
    { id: 'biolume', name: 'Biolume', statBias: { initiative: 1.3, maxHp: 1.2 }, slots: ['offhand', 'accessory'], tier: 3 },
  ],
  nameFragments: {
    adjectives: [
      'gleaming', 'festering', 'whispering', 'pulsing', 'gnarled',
      'luminous', 'rotting', 'calcified', 'dripping', 'encrusted',
      'writhing', 'pallid', 'iridescent', 'thorned', 'humming',
    ],
    prefixes: [
      'Spore', 'Gloom', 'Bone', 'Dread', 'Rot',
      'Pale', 'Deep', 'Myc', 'Hypha', 'Crypt',
      'Dark', 'Blight', 'Murk', 'Wither', 'Shade',
    ],
    suffixes: [
      'bane', 'fang', 'shatter', 'maw', 'grip',
      'thorn', 'bloom', 'root', 'cap', 'stalk',
      'crawl', 'bite', 'rend', 'spore', 'wilt',
    ],
    baseTypes: {
      weapon: ['dagger', 'blade', 'mace', 'staff', 'cleaver', 'maul', 'spear', 'axe'],
      offhand: ['buckler', 'shield', 'orb', 'lantern', 'tome', 'ward'],
      armor: ['wrap', 'vest', 'plate', 'mail', 'hauberk', 'mantle'],
      accessory: ['amulet', 'ring', 'charm', 'pendant', 'circlet', 'brooch'],
    },
  },
};
