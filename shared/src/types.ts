import type { ActiveBuff } from './classTypes.js';
import { getClassDefinition } from './classData.js';
import { PLAYER_CONFIG } from './data/player.js';
import { ENERGY_CONFIG } from './data/energy.js';
import { PROGRESSION_CONFIG } from './data/progression.js';

// === Directions ===
export type Direction = 'north' | 'south' | 'east' | 'west';
export type GridDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

// === Items ===
export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary' | 'unique';
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
  effect?: string;
  effectParams?: Record<string, number>;
}

// === Interactables ===
export type InteractableSize = 'small' | 'medium' | 'large';
export type OutcomeType = 'loot' | 'hazard' | 'intel' | 'secret' | 'flavor' | 'reveal_room';

export interface InteractableSlot {
  position: { x: number; y: number };
  size: InteractableSize;
}

export interface OutcomeTable {
  weights: Partial<Record<OutcomeType, number>>;
}

export interface InteractableAction {
  id: string;
  label: string;
  requiresClass?: string;
  multiplayerOnly?: boolean;
  repeatable?: boolean;
  outcomes: OutcomeTable;
  narration?: Partial<Record<OutcomeType, string[]>>;
}

export interface InteractableDefinition {
  id: string;
  name: string;
  asciiChar: string;
  biomes: string[];
  slotSize: InteractableSize;
  actions: InteractableAction[];
}

export interface InteractableInstance {
  definitionId: string;
  instanceId: string;
  position: { x: number; y: number };
  usedActions: Record<string, string>; // actionId -> playerName who used it
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

export interface RoomPuzzle {
  id: string;
  description: string;
  options: string[];
  correctIndex: number;
}

export interface Furnishing {
  x: number;
  y: number;
  char: string;
  name: string;
  interactable: boolean;
}

export interface TileGrid {
  width: number;
  height: number;
  tiles: string[][];
  themes?: (string | null)[][];
  furnishings?: Furnishing[];
}

export interface Room {
  id: string;
  type: RoomType;
  name: string;
  description: string;
  exits: Partial<Record<Direction, string>>;
  encounter?: RoomEncounter;
  loot?: RoomLoot[];
  lockedExits?: Partial<Record<Direction, string>>;
  puzzle?: RoomPuzzle;
  gridX?: number;
  gridY?: number;
  tileGrid?: TileGrid;
  interactables?: InteractableInstance[];
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

export const CONSUMABLE_SLOTS = PLAYER_CONFIG.consumableSlots;
export const INVENTORY_SLOTS = PLAYER_CONFIG.inventorySlots;

export interface Player {
  id: string;
  name: string;
  className: string;
  maxHp: number;
  hp: number;
  roomId: string;
  equipment: Equipment;
  consumables: (Item | null)[];
  inventory: (Item | null)[];
  status: PlayerStatus;
  keychain: string[];
  energy: number;
  usedEffects: string[];
  xp: number;
  level: number;
  unspentStatPoints: number;
  statAllocations: Record<string, number>;
}

export const BASE_STATS = PLAYER_CONFIG.baseStats;

export interface ComputedStats {
  maxHp: number;
  damage: number;
  defense: number;
  initiative: number;
  maxEnergy: number;
}

export function computePlayerStats(player: Player): ComputedStats {
  const classDef = getClassDefinition(player.className);
  const base = classDef?.baseStats ?? BASE_STATS;
  const stats: ComputedStats = { ...base, maxEnergy: ENERGY_CONFIG.maxEnergy };
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

  // Apply stat point allocations
  const { statDefinitions } = PROGRESSION_CONFIG;
  for (const def of statDefinitions) {
    const points = player.statAllocations[def.id] ?? 0;
    if (points <= 0) continue;
    const bonus = points * def.perPoint;
    const stat = def.internalStat as keyof ComputedStats;
    if (stat in stats) {
      (stats[stat] as number) += bonus;
    }
  }

  return stats;
}

export interface EquippedEffect {
  effectId: string;
  params: Record<string, number>;
  sourceItemId: string;
}

export function getPlayerEquippedEffects(player: Player): EquippedEffect[] {
  const effects: EquippedEffect[] = [];
  const slots: (Item | null)[] = [
    player.equipment.weapon,
    player.equipment.offhand,
    player.equipment.armor,
    player.equipment.accessory,
  ];
  for (const item of slots) {
    if (item?.effect && item.effectParams) {
      effects.push({
        effectId: item.effect,
        params: item.effectParams,
        sourceItemId: item.id,
      });
    }
  }
  return effects;
}

export function createPlayer(id: string, name: string, roomId: string, className: string = 'vanguard'): Player {
  const classDef = getClassDefinition(className);
  const maxHp = classDef?.baseStats.maxHp ?? BASE_STATS.maxHp;
  return {
    id,
    name,
    className,
    maxHp,
    hp: maxHp,
    roomId,
    equipment: { weapon: null, offhand: null, armor: null, accessory: null },
    consumables: Array(CONSUMABLE_SLOTS).fill(null),
    inventory: Array(INVENTORY_SLOTS).fill(null),
    status: 'exploring',
    keychain: [],
    energy: ENERGY_CONFIG.startingEnergy,
    usedEffects: [],
    xp: 0,
    level: 1,
    unspentStatPoints: 0,
    statAllocations: {},
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
  className?: string;
  buffs?: ActiveBuff[];
  energy?: number;
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
  zoneTransitions?: Record<string, string>;
}
