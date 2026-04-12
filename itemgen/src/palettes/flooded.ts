import type { BiomePalette } from '../types.js';

export const FLOODED_PALETTE: BiomePalette = {
  biomeId: 'flooded',
  materials: [
    { id: 'driftwood', name: 'Driftwood', statBias: { damage: 0.9, maxHp: 1.1 }, slots: ['weapon', 'offhand', 'accessory'], tier: 1 },
    { id: 'barnacle', name: 'Barnacle', statBias: { defense: 1.2, initiative: 0.9 }, slots: ['armor', 'offhand'], tier: 1 },
    { id: 'coral', name: 'Coral', statBias: { damage: 1.1, defense: 1.1 }, slots: ['weapon', 'armor', 'accessory'], tier: 2 },
    { id: 'pearl', name: 'Pearl', statBias: { initiative: 1.2, maxHp: 1.2 }, slots: ['offhand', 'accessory', 'armor'], tier: 2 },
    { id: 'brine', name: 'Brine', statBias: { damage: 1.2, initiative: 1.1 }, slots: ['weapon', 'offhand', 'accessory'], tier: 2 },
    { id: 'abyssal', name: 'Abyssal', statBias: { damage: 1.3, maxHp: 1.2 }, slots: ['weapon', 'armor', 'accessory'], tier: 3 },
    { id: 'leviathan', name: 'Leviathan', statBias: { defense: 1.4, maxHp: 1.3 }, slots: ['armor', 'offhand', 'weapon'], tier: 3 },
  ],
  nameFragments: {
    adjectives: [
      'corroded', 'briny', 'sunken', 'waterlogged', 'salt-crusted',
      'barnacled', 'drowned', 'murky', 'tidal', 'fathomless',
      'drenched', 'sodden', 'submerged', 'brackish', 'abyssal',
    ],
    prefixes: [
      'Tide', 'Depth', 'Brine', 'Wave', 'Surge',
      'Current', 'Abyss', 'Torrent', 'Reef', 'Kelp',
      'Ebb', 'Shoal', 'Drift', 'Maelstrom', 'Chasm',
    ],
    suffixes: [
      'crash', 'surge', 'tide', 'current', 'undertow',
      'lash', 'swell', 'drift', 'drown', 'sink',
      'pull', 'ebb', 'flow', 'breach', 'plunge',
    ],
    baseTypes: {
      weapon: ['cutlass', 'harpoon', 'trident', 'coral blade', 'driftwood club', 'brine lance', 'sea axe', 'abyssal spear'],
      offhand: ['shell shield', 'driftwood buckler', 'coral ward', 'barnacle shield', 'pearl orb', 'brine focus'],
      armor: ['barnacle mail', 'coral plate', 'pearl vest', 'abyssal hauberk', 'leviathan scale', 'brine weave', 'driftwood mantle'],
      accessory: ['pearl earring', 'shell pendant', 'coral ring', 'brine amulet', 'abyssal charm', 'tide band', 'driftwood brooch'],
    },
  },
};
