import type { BiomePalette } from '../types.js';

export const CRYSTAL_PALETTE: BiomePalette = {
  biomeId: 'crystal',
  materials: [
    { id: 'quartz', name: 'Quartz', statBias: { damage: 1.1, initiative: 1.1 }, slots: ['weapon', 'offhand', 'accessory'], tier: 1 },
    { id: 'geode', name: 'Geode', statBias: { defense: 1.2, maxHp: 1.0 }, slots: ['armor', 'offhand', 'accessory'], tier: 1 },
    { id: 'amethyst', name: 'Amethyst', statBias: { initiative: 1.2, maxHp: 1.1 }, slots: ['weapon', 'accessory', 'armor'], tier: 2 },
    { id: 'prism', name: 'Prism', statBias: { damage: 1.2, initiative: 1.2 }, slots: ['weapon', 'offhand', 'accessory'], tier: 2 },
    { id: 'lattice', name: 'Lattice', statBias: { defense: 1.2, maxHp: 1.1 }, slots: ['armor', 'offhand'], tier: 2 },
    { id: 'diamond', name: 'Diamond', statBias: { damage: 1.4, initiative: 1.2 }, slots: ['weapon', 'offhand', 'accessory'], tier: 3 },
    { id: 'resonance', name: 'Resonance', statBias: { maxHp: 1.3, initiative: 1.4, damage: 1.1 }, slots: ['armor', 'accessory', 'weapon'], tier: 3 },
  ],
  nameFragments: {
    adjectives: [
      'shimmering', 'prismatic', 'faceted', 'gleaming', 'radiant',
      'refracting', 'brilliant', 'crystalline', 'translucent', 'luminous',
      'scintillating', 'sparking', 'humming', 'resonant', 'fractured',
    ],
    prefixes: [
      'Prism', 'Shard', 'Gleam', 'Ray', 'Refract',
      'Beam', 'Lens', 'Facet', 'Signal', 'Quartz',
      'Veil', 'Glint', 'Shine', 'Focus', 'Hue',
    ],
    suffixes: [
      'lance', 'flash', 'beam', 'glare', 'pulse',
      'spark', 'shard', 'glint', 'ray', 'burst',
      'dazzle', 'refract', 'gleam', 'shine', 'hum',
    ],
    baseTypes: {
      weapon: ['shard blade', 'crystal sword', 'quartz dagger', 'prism lance', 'facet spear', 'resonance staff', 'geode maul', 'lattice axe'],
      offhand: ['crystal buckler', 'prism focus', 'quartz ward', 'facet shield', 'lattice orb', 'shard tome'],
      armor: ['crystal mail', 'lattice vest', 'prism plate', 'geode hauberk', 'quartz mantle', 'facet cuirass', 'resonance wrap'],
      accessory: ['crystal pendant', 'prism ring', 'quartz amulet', 'facet circlet', 'shard charm', 'resonance band', 'geode brooch'],
    },
  },
};
