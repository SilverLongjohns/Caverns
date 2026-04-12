import type { BiomePalette } from '../types.js';

export const VOLCANIC_PALETTE: BiomePalette = {
  biomeId: 'volcanic',
  materials: [
    { id: 'slag', name: 'Slag', statBias: { damage: 1.0, defense: 1.1 }, slots: ['weapon', 'armor', 'offhand'], tier: 1 },
    { id: 'ember', name: 'Ember', statBias: { damage: 1.2, initiative: 1.0 }, slots: ['weapon', 'accessory'], tier: 1 },
    { id: 'obsidian', name: 'Obsidian', statBias: { damage: 1.3, initiative: 1.1 }, slots: ['weapon', 'offhand', 'accessory'], tier: 2 },
    { id: 'magma', name: 'Magma', statBias: { damage: 1.2, maxHp: 1.1 }, slots: ['weapon', 'offhand', 'accessory', 'armor'], tier: 2 },
    { id: 'cinder', name: 'Cinder', statBias: { defense: 1.2, initiative: 1.1 }, slots: ['armor', 'offhand'], tier: 2 },
    { id: 'inferno', name: 'Inferno', statBias: { damage: 1.4, initiative: 1.2 }, slots: ['weapon', 'accessory', 'armor'], tier: 3 },
    { id: 'forge-heart', name: 'Forge-Heart', statBias: { damage: 1.3, defense: 1.3, maxHp: 1.2 }, slots: ['weapon', 'armor', 'offhand', 'accessory'], tier: 3 },
  ],
  nameFragments: {
    adjectives: [
      'smouldering', 'molten', 'scorched', 'searing', 'blazing',
      'volcanic', 'ashen', 'cinder-hot', 'infernal', 'forge-tempered',
      'pyroclastic', 'superheated', 'charred', 'incandescent', 'igneous',
    ],
    prefixes: [
      'Flame', 'Ash', 'Forge', 'Ember', 'Slag',
      'Inferno', 'Magma', 'Cinder', 'Pyro', 'Char',
      'Scorch', 'Blaze', 'Lava', 'Smelt', 'Ignite',
    ],
    suffixes: [
      'scorch', 'burn', 'blaze', 'sear', 'melt',
      'forge', 'ignite', 'smelt', 'char', 'erupt',
      'combust', 'incinerate', 'fuse', 'temper', 'kindle',
    ],
    baseTypes: {
      weapon: ['cleaver', 'war axe', 'slag hammer', 'ember blade', 'obsidian dagger', 'magma spear', 'inferno maul', 'volcanic sword'],
      offhand: ['cinder buckler', 'magma ward', 'obsidian shield', 'slag round shield', 'ember orb', 'forge-heart focus'],
      armor: ['cinder mail', 'volcanic plate', 'slag vest', 'magma hauberk', 'forge-heart cuirass', 'obsidian mantle', 'ember brigandine'],
      accessory: ['ember band', 'magma ring', 'volcanic amulet', 'cinder pendant', 'obsidian charm', 'inferno circlet', 'forge-heart brooch'],
    },
  },
};
