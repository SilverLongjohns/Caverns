// === Directions ===
export type Direction = 'north' | 'south' | 'east' | 'west';

// === Items ===
export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';
export type EquipmentSlot = 'weapon' | 'offhand' | 'armor' | 'accessory';
export type ItemSlot = EquipmentSlot | 'consumable';

export interface ItemStats {
  damage?: number;
  defense?: number;
  maxHp?: number;
  initiative?: number;
  healAmount?: number;
}

export interface Item {
  id: string;
  name: string;
  description: string;
  rarity: Rarity;
  slot: ItemSlot;
  stats: ItemStats;
}

// === Rooms ===
export type RoomType = 'tunnel' | 'chamber' | 'cavern' | 'dead_end' | 'boss';

export interface RoomEncounter {
  mobId: string;
  skullRating: 1 | 2 | 3;
}

export interface RoomLoot {
  itemId: string;
  location: 'chest' | 'floor' | 'hidden';
}

export interface Room {
  id: string;
  type: RoomType;
  name: string;
  description: string;
  exits: Partial<Record<Direction, string>>;
  encounter?: RoomEncounter;
  loot?: RoomLoot[];
}

// === Mobs ===
export interface MobTemplate {
  id: string;
  name: string;
  description: string;
  skullRating: 1 | 2 | 3;
  maxHp: number;
  damage: number;
  defense: number;
  initiative: number;
  lootTable: string[];
}

export interface MobInstance {
  instanceId: string;
  templateId: string;
  name: string;
  maxHp: number;
  hp: number;
  damage: number;
  defense: number;
  initiative: number;
}

// === Players ===
export type PlayerStatus = 'exploring' | 'in_combat' | 'downed';

export interface Equipment {
  weapon: Item | null;
  offhand: Item | null;
  armor: Item | null;
  accessory: Item | null;
}

export const CONSUMABLE_SLOTS = 6;
export const INVENTORY_SLOTS = 7;

export interface Player {
  id: string;
  name: string;
  maxHp: number;
  hp: number;
  roomId: string;
  equipment: Equipment;
  consumables: (Item | null)[];
  inventory: (Item | null)[];
  status: PlayerStatus;
}

export const BASE_STATS = {
  maxHp: 50,
  damage: 5,
  defense: 2,
  initiative: 5,
};

export interface ComputedStats {
  maxHp: number;
  damage: number;
  defense: number;
  initiative: number;
}

export function computePlayerStats(player: Player): ComputedStats {
  const stats: ComputedStats = { ...BASE_STATS };
  const slots: (Item | null)[] = [
    player.equipment.weapon,
    player.equipment.offhand,
    player.equipment.armor,
    player.equipment.accessory,
  ];
  for (const item of slots) {
    if (!item) continue;
    stats.damage += item.stats.damage ?? 0;
    stats.defense += item.stats.defense ?? 0;
    stats.maxHp += item.stats.maxHp ?? 0;
    stats.initiative += item.stats.initiative ?? 0;
  }
  return stats;
}

export function createPlayer(id: string, name: string, roomId: string): Player {
  return {
    id,
    name,
    maxHp: BASE_STATS.maxHp,
    hp: BASE_STATS.maxHp,
    roomId,
    equipment: { weapon: null, offhand: null, armor: null, accessory: null },
    consumables: Array(CONSUMABLE_SLOTS).fill(null),
    inventory: Array(INVENTORY_SLOTS).fill(null),
    status: 'exploring',
  };
}

// === Combat State (shared for client rendering) ===
export interface CombatParticipant {
  id: string;
  type: 'player' | 'mob';
  name: string;
  hp: number;
  maxHp: number;
  initiative: number;
}

export interface CombatState {
  roomId: string;
  participants: CombatParticipant[];
  turnOrder: string[];
  currentTurnId: string;
  roundNumber: number;
}

// === Loot ===
export interface LootPrompt {
  items: Item[];
  timeout: number;
  roomId: string;
}

// === Dungeon Content ===
export interface DungeonContent {
  name: string;
  theme: string;
  atmosphere: string;
  rooms: Room[];
  mobs: MobTemplate[];
  items: Item[];
  bossId: string;
  entranceRoomId: string;
}
