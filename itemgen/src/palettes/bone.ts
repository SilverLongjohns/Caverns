import type { BiomePalette } from '../types.js';

export const BONE_PALETTE: BiomePalette = {
  biomeId: 'bone',
  materials: [
    { id: 'marrow', name: 'Marrow', statBias: { maxHp: 1.2, damage: 0.9 }, slots: ['weapon', 'armor', 'accessory'], tier: 1 },
    { id: 'femur', name: 'Femur', statBias: { damage: 1.1, defense: 0.9 }, slots: ['weapon', 'offhand'], tier: 1 },
    { id: 'skull', name: 'Skull', statBias: { damage: 1.2, initiative: 1.0 }, slots: ['weapon', 'offhand', 'accessory'], tier: 2 },
    { id: 'rib', name: 'Rib', statBias: { defense: 1.1, initiative: 1.1 }, slots: ['armor', 'offhand', 'weapon'], tier: 2 },
    { id: 'vertebrae', name: 'Vertebrae', statBias: { defense: 1.2, maxHp: 1.1 }, slots: ['armor', 'accessory'], tier: 2 },
    { id: 'ossified', name: 'Ossified', statBias: { defense: 1.3, damage: 1.2 }, slots: ['weapon', 'armor', 'offhand'], tier: 3 },
    { id: 'deathbone', name: 'Deathbone', statBias: { damage: 1.4, maxHp: 1.2, initiative: 1.1 }, slots: ['weapon', 'accessory', 'armor'], tier: 3 },
  ],
  nameFragments: {
    adjectives: [
      'bleached', 'rattling', 'splintered', 'hollow', 'cracked',
      'yellowed', 'dry', 'ancient', 'cursed', 'grim',
      'fleshless', 'calcified', 'marrow-less', 'pale', 'sundered',
    ],
    prefixes: [
      'Bone', 'Death', 'Grave', 'Skull', 'Crypt',
      'Marrow', 'Ossuary', 'Relic', 'Rot', 'Dread',
      'Pale', 'Ghast', 'Tomb', 'Wight', 'Cairn',
    ],
    suffixes: [
      'rattle', 'crack', 'snap', 'gnaw', 'grind',
      'crunch', 'splinter', 'shatter', 'break', 'cleave',
      'hollow', 'bleach', 'whiten', 'calcify', 'ossify',
    ],
    baseTypes: {
      weapon: ['bone club', 'femur flail', 'rib blade', 'skull maul', 'marrow spear', 'vertebrae staff', 'ossified axe', 'deathbone sword'],
      offhand: ['skull cap shield', 'rib buckler', 'bone ward', 'femur round shield', 'ossified orb', 'marrow tome'],
      armor: ['bone weave', 'rib cage mail', 'skull plate', 'marrow vest', 'ossified hauberk', 'vertebrae mantle', 'deathbone cuirass'],
      accessory: ['finger bone ring', 'vertebrae necklace', 'skull amulet', 'bone pendant', 'marrow charm', 'ossified circlet', 'rib brooch'],
    },
  },
};
