import type { DungeonContent, Item } from './types.js';

export const STARTER_WEAPON = {
  id: 'starter_sword',
  name: 'Rusty Shortsword',
  description: 'A dull blade with flecks of rust. Better than bare fists.',
  rarity: 'common' as const,
  slot: 'weapon' as const,
  stats: { damage: 5 },
};

export const STARTER_POTION = {
  id: 'minor_hp_potion',
  name: 'Minor Health Potion',
  description: 'A small vial of red liquid. Restores a bit of health.',
  rarity: 'common' as const,
  slot: 'consumable' as const,
  stats: { healAmount: 15 },
};

export const CLASS_STARTER_ITEMS: Record<string, { weapon: Item; offhand: Item }> = {
  vanguard: {
    weapon: {
      id: 'vanguard_iron_mace', name: 'Iron Mace',
      description: 'A heavy flanged mace. Reliable and brutal.',
      rarity: 'common', slot: 'weapon', stats: { damage: 2 },
    },
    offhand: {
      id: 'vanguard_tower_shield', name: 'Tower Shield',
      description: 'A tall shield of banded oak and iron.',
      rarity: 'common', slot: 'offhand', stats: { defense: 3 },
    },
  },
  shadowblade: {
    weapon: {
      id: 'shadowblade_twin_daggers', name: 'Twin Daggers',
      description: 'A matched pair of razor-sharp blades.',
      rarity: 'common', slot: 'weapon', stats: { damage: 3, initiative: 2 },
    },
    offhand: {
      id: 'shadowblade_smoke_cloak', name: 'Smoke Cloak',
      description: 'A dark cloak woven with alchemical fibers.',
      rarity: 'common', slot: 'offhand', stats: { defense: 1 },
    },
  },
  cleric: {
    weapon: {
      id: 'cleric_blessed_staff', name: 'Blessed Staff',
      description: 'A staff inscribed with protective glyphs.',
      rarity: 'common', slot: 'weapon', stats: { damage: 2, initiative: 1 },
    },
    offhand: {
      id: 'cleric_holy_symbol', name: 'Holy Symbol',
      description: 'A silver pendant radiating faint warmth.',
      rarity: 'common', slot: 'offhand', stats: { defense: 2 },
    },
  },
  artificer: {
    weapon: {
      id: 'artificer_repeating_crossbow', name: 'Repeating Crossbow',
      description: 'A compact crossbow with a mechanical reload mechanism.',
      rarity: 'common', slot: 'weapon', stats: { damage: 3 },
    },
    offhand: {
      id: 'artificer_toolkit', name: 'Toolkit',
      description: 'A leather case of springs, gears, and small explosives.',
      rarity: 'common', slot: 'offhand', stats: { defense: 1, initiative: 2 },
    },
  },
};

export const DRIPPING_HALLS: DungeonContent = {
  name: 'The Dripping Halls',
  theme: 'A waterlogged cave system with bioluminescent fungi and ancient stonework.',
  atmosphere: 'Water drips constantly. The air is thick and humid. Faint blue-green light pulses from fungal clusters on the walls.',
  biomeId: 'fungal',
  entranceRoomId: 'entrance',
  bossId: 'mycelium_king',

  rooms: [
    {
      id: 'entrance',
      type: 'tunnel',
      name: 'Cavern Mouth',
      description: 'A narrow opening leads into darkness. Water trickles down the moss-covered walls. The air smells of damp earth and something faintly sweet.',
      exits: { north: 'fungal_grotto', east: 'dripping_tunnel' },
    },
    {
      id: 'fungal_grotto',
      type: 'chamber',
      name: 'Fungal Grotto',
      description: 'A low-ceilinged chamber carpeted in luminous mushrooms. Water pools in the center, reflecting the eerie glow.',
      exits: { south: 'entrance', north: 'spore_den', east: 'crystal_pool' },
      encounter: { mobId: 'fungal_crawler', skullRating: 1 },
    },
    {
      id: 'dripping_tunnel',
      type: 'tunnel',
      name: 'Dripping Tunnel',
      description: 'Water streams down the walls in thin rivulets. The tunnel slopes gently downward. Glowing lichen marks the path.',
      exits: { west: 'entrance', north: 'crystal_pool', east: 'lurker_den' },
      drops: { dropSpecId: 'fungal_room_common' },
      lootLocation: 'floor',
    },
    {
      id: 'crystal_pool',
      type: 'chamber',
      name: 'Crystal Pool',
      description: 'A wide chamber centered around a still pool. Crystalline formations jut from the walls, refracting the bioluminescent light into rainbows.',
      exits: { south: 'dripping_tunnel', west: 'fungal_grotto', north: 'mushroom_cathedral', east: 'hidden_cache' },
      encounter: { mobId: 'cave_lurker', skullRating: 1 },
    },
    {
      id: 'spore_den',
      type: 'chamber',
      name: 'Spore Den',
      description: 'Thick clouds of luminescent spores drift through the air. Massive mushroom caps form a canopy overhead. Something large shuffles in the haze.',
      exits: { south: 'fungal_grotto', east: 'mushroom_cathedral' },
      encounter: { mobId: 'fungal_crawler', skullRating: 1 },
    },
    {
      id: 'lurker_den',
      type: 'dead_end',
      name: "Lurker's Alcove",
      description: 'A cramped alcove littered with bones and old equipment. Something was nesting here.',
      exits: { west: 'dripping_tunnel' },
      encounter: { mobId: 'cave_lurker', skullRating: 1 },
      drops: { dropSpecId: 'fungal_room_common' },
      lootLocation: 'floor',
    },
    {
      id: 'mushroom_cathedral',
      type: 'cavern',
      name: 'Mushroom Cathedral',
      description: 'An enormous cavern with towering mushroom stalks reaching up like pillars. The ceiling is lost in darkness above. A deep thrumming vibration fills the space.',
      exits: { south: 'crystal_pool', west: 'spore_den', north: 'throne_antechamber' },
      encounter: { mobId: 'sporecap_brute', skullRating: 2 },


    },
    {
      id: 'hidden_cache',
      type: 'dead_end',
      name: 'Hidden Cache',
      description: 'Behind a curtain of hanging roots, a small hollow in the rock reveals a forgotten stash. Someone hid supplies here long ago.',
      exits: { west: 'crystal_pool' },
      drops: { dropSpecId: 'fungal_room_common' },
      lootLocation: 'chest',
    },
    {
      id: 'throne_antechamber',
      type: 'tunnel',
      name: 'Throne Antechamber',
      description: 'The fungal growth here is unnervingly organized — mushrooms line the walls in symmetric rows as if planted deliberately. The air vibrates with a low pulse. A massive archway opens to the north.',
      exits: { south: 'mushroom_cathedral', north: 'boss_room' },
      drops: { dropSpecId: 'fungal_room_common' },
      lootLocation: 'floor',
    },
    {
      id: 'boss_room',
      type: 'boss',
      name: 'Throne of the Mycelium King',
      description: 'A vast domed chamber pulsing with bioluminescence. At its center, a towering mass of interwoven fungal tendrils shaped vaguely like a seated figure on a throne of living mushroom. Spore clouds billow with each of its movements.',
      exits: { south: 'throne_antechamber' },
      encounter: { mobId: 'mycelium_king', skullRating: 3 },
    },
  ],

  mobs: [
    {
      id: 'fungal_crawler',
      name: 'Fungal Crawler',
      description: 'A dog-sized insect coated in phosphorescent spores.',
      skullRating: 1,
      maxHp: 25,
      damage: 8,
      defense: 2,
      initiative: 4,
      drops: { dropSpecId: 'fungal_mob_common' },
    },
    {
      id: 'cave_lurker',
      name: 'Cave Lurker',
      description: 'A pale, eyeless humanoid that clings to the ceiling and drops on prey.',
      skullRating: 1,
      maxHp: 20,
      damage: 10,
      defense: 1,
      initiative: 6,
      drops: { dropSpecId: 'fungal_mob_common' },
    },
    {
      id: 'sporecap_brute',
      name: 'Sporecap Brute',
      description: 'A hulking fungal creature with a massive mushroom cap for a head. Swings tree-trunk arms with devastating force.',
      skullRating: 2,
      maxHp: 60,
      damage: 14,
      defense: 5,
      initiative: 3,
      drops: { dropSpecId: 'fungal_mob_elite' },
    },
    {
      id: 'mycelium_king',
      name: 'The Mycelium King',
      description: 'A towering mass of interwoven fungal tendrils shaped vaguely like a man. Spore clouds billow with each movement.',
      skullRating: 3,
      maxHp: 200,
      damage: 25,
      defense: 8,
      initiative: 5,
      drops: { dropSpecId: 'fungal_boss' },
    },
  ],

  items: [
    // === Consumables ===
    { id: 'leather_scraps', name: 'Leather Scrap Bandage', description: 'Makeshift bandages from old leather. Not great, but better than bleeding.', rarity: 'common', slot: 'consumable', stats: { healAmount: 10 } },
    { id: 'hp_potion', name: 'Health Potion', description: 'A standard healing draught. Tastes like mushroom soup.', rarity: 'uncommon', slot: 'consumable', stats: { healAmount: 25 } },
    { id: 'hp_potion_large', name: 'Greater Health Potion', description: 'A large flask of potent healing liquid. Glows faintly.', rarity: 'rare', slot: 'consumable', stats: { healAmount: 40 } },
    { id: 'elixir', name: 'Fungal Elixir', description: 'A shimmering elixir distilled from rare bioluminescent fungi.', rarity: 'rare', slot: 'consumable', stats: { healAmount: 50 } },
    { id: 'throwing_spore', name: 'Volatile Spore Pod', description: 'A bulging spore pod that explodes on impact. Handle with care.', rarity: 'uncommon', slot: 'consumable', stats: { damage: 20 } },
  ],
};
