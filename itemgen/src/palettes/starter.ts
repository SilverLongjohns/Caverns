import type { BiomePalette } from '../types.js';

export const STARTER_PALETTE: BiomePalette = {
  biomeId: 'starter',
  materials: [
    { id: 'iron', name: 'Iron', statBias: { damage: 1.1, defense: 1.0 }, slots: ['weapon', 'armor', 'offhand'], tier: 1 },
    { id: 'leather', name: 'Leather', statBias: { defense: 1.1, initiative: 1.1 }, slots: ['armor', 'accessory'], tier: 1 },
    { id: 'wood', name: 'Wood', statBias: { damage: 0.9, maxHp: 1.1 }, slots: ['weapon', 'offhand', 'accessory'], tier: 1 },
    { id: 'steel', name: 'Steel', statBias: { damage: 1.2, defense: 1.1 }, slots: ['weapon', 'armor', 'offhand'], tier: 2 },
    { id: 'bronze', name: 'Bronze', statBias: { damage: 1.1, initiative: 1.2 }, slots: ['weapon', 'offhand', 'accessory'], tier: 2 },
    { id: 'silver', name: 'Silver', statBias: { damage: 1.2, initiative: 1.3 }, slots: ['weapon', 'armor', 'accessory'], tier: 3 },
    { id: 'mithril', name: 'Mithril', statBias: { damage: 1.3, defense: 1.3, initiative: 1.1 }, slots: ['weapon', 'armor', 'offhand', 'accessory'], tier: 3 },
  ],
  nameFragments: {
    adjectives: [
      'worn', 'polished', 'tempered', 'rusted', 'battered',
      'keen', 'sturdy', 'forged', 'ancient', 'crude',
      'hardened', 'sharpened', 'honed', 'weathered', 'reliable',
    ],
    prefixes: [
      'War', 'Stone', 'Iron', 'Steel', 'Guard',
      'Battle', 'True', 'Blade', 'Shield', 'Fort',
      'Hard', 'Grim', 'Valor', 'Crest', 'Edge',
    ],
    suffixes: [
      'strike', 'guard', 'breaker', 'bane', 'ward',
      'edge', 'hold', 'clash', 'wall', 'thrust',
      'cut', 'block', 'smash', 'parry', 'drive',
    ],
    baseTypes: {
      weapon: ['sword', 'axe', 'mace', 'dagger', 'spear', 'flail', 'hammer', 'club'],
      offhand: ['shield', 'buckler', 'round shield', 'kite shield', 'tower shield', 'parrying dagger'],
      armor: ['vest', 'tunic', 'mail', 'plate', 'brigandine', 'cuirass', 'hauberk', 'gambeson'],
      accessory: ['ring', 'amulet', 'pendant', 'bracelet', 'brooch', 'circlet', 'talisman'],
    },
  },
};
