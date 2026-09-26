import type { SandboxPreset } from './types.js';

const FULL_PARTY = (level: number) => [
  { className: 'vanguard', level },
  { className: 'shadowblade', level },
  { className: 'cleric', level },
  { className: 'artificer', level },
];

export const SANDBOX_PRESETS: SandboxPreset[] = [
  { id: 'duel', label: 'Duel', party: [{ className: 'vanguard' }], mobs: ['tunnel_rat'], roomType: 'tunnel', biome: 'starter', seed: 1 },
  {
    id: 'showcase', label: 'Showcase (all classes)', roomType: 'cavern', biome: 'starter', seed: 7,
    party: [
      { className: 'vanguard', level: 3, equipment: { weapon: 'worldsplitter', offhand: 'aegis_of_the_fallen' } },
      { className: 'shadowblade', level: 3 },
      { className: 'cleric', level: 3 },
      { className: 'artificer', level: 3 },
    ],
    mobs: ['cave_troll', 'goblin_scrapper', 'alpha_wolf', 'feral_miner'],
  },
  { id: 'starter-pack', label: 'Shallow Warrens pack', party: [{ className: 'vanguard' }, { className: 'cleric' }], mobs: ['goblin_scrapper', 'tunnel_rat', 'warren_spider'], roomType: 'chamber', biome: 'starter' },
  { id: 'fungal-pack', label: 'Fungal Depths pack', party: [{ className: 'shadowblade', level: 2 }, { className: 'cleric', level: 2 }], mobs: ['sporecap_brute', 'fungal_crawler', 'spore_shambler'], roomType: 'chamber', biome: 'fungal' },
  { id: 'crystal-pack', label: 'Crystal Caverns pack', party: [{ className: 'vanguard', level: 3 }, { className: 'artificer', level: 3 }], mobs: ['geode_golem', 'shard_beetle', 'prism_wisp', 'crystal_spider'], roomType: 'cavern', biome: 'crystal' },
  { id: 'flooded-pack', label: 'Drowned Passages pack', party: [{ className: 'shadowblade', level: 3 }, { className: 'vanguard', level: 3 }], mobs: ['abyssal_angler', 'cave_eel', 'tide_crawler'], roomType: 'cavern', biome: 'flooded' },
  { id: 'bone-pack', label: 'Ossuary Halls pack', party: [{ className: 'vanguard', level: 4 }, { className: 'cleric', level: 4 }], mobs: ['lich_remnant', 'bone_rattler', 'skull_sentinel', 'grave_warden'], roomType: 'cavern', biome: 'bone' },
  { id: 'volcanic-pack', label: 'Magma Rifts pack', party: [{ className: 'artificer', level: 4 }, { className: 'vanguard', level: 4 }], mobs: ['obsidian_sentinel', 'cinder_imp', 'lava_slime'], roomType: 'chamber', biome: 'volcanic' },
  { id: 'boss-rat-king', label: 'Boss: The Rat King', party: FULL_PARTY(3), mobs: ['the_rat_king', 'tunnel_rat', 'tunnel_rat'], roomType: 'boss', biome: 'starter' },
  { id: 'boss-mycelium-king', label: 'Boss: The Mycelium King', party: FULL_PARTY(4), mobs: ['mycelium_king', 'fungal_crawler', 'spore_shambler'], roomType: 'boss', biome: 'fungal' },
  { id: 'boss-prismatic-colossus', label: 'Boss: The Prismatic Colossus', party: FULL_PARTY(5), mobs: ['prismatic_colossus', 'shard_beetle', 'prism_wisp'], roomType: 'boss', biome: 'crystal' },
  { id: 'boss-drowned-leviathan', label: 'Boss: The Drowned Leviathan', party: FULL_PARTY(5), mobs: ['the_drowned_leviathan', 'cave_eel', 'drowned_shambler'], roomType: 'boss', biome: 'flooded' },
  { id: 'boss-charnel-king', label: 'Boss: The Charnel King', party: FULL_PARTY(6), mobs: ['the_charnel_king', 'bone_rattler', 'skull_sentinel'], roomType: 'boss', biome: 'bone' },
  { id: 'boss-forge-titan', label: 'Boss: The Forge Titan', party: FULL_PARTY(6), mobs: ['the_forge_titan', 'cinder_imp', 'magma_beetle'], roomType: 'boss', biome: 'volcanic' },
];
