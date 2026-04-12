import type { RoomType, InteractableSlot, DropSpecRef } from '../types.js';

export interface RoomChit {
  id: string;
  type: RoomType;
  name: string;
  description: string;
  biomes: string[];
  maxExits: number;
  lootLocations: ('chest' | 'floor' | 'hidden')[];
  interactableSlots?: InteractableSlot[];
}

export interface MobPoolEntry {
  id: string;
  name: string;
  description: string;
  skullRating: 1 | 2 | 3;
  biomes: string[];
  baseStats: {
    maxHp: number;
    damage: number;
    defense: number;
    initiative: number;
  };
  drops: DropSpecRef;
}

export interface PuzzleTemplate {
  id: string;
  biomes: string[];
  description: string;
  options: string[];
  correctIndex: number;
}

export interface BiomeDefinition {
  id: string;
  name: string;
  transitionText: string;
  roomCount: { min: number; max: number };
  mobDensity: number;
  skull1Weight: number;
  skull2Weight: number;
  roomDropSpecId: string;
  puzzleRewardSpecId: string;
  isStarter?: boolean;
  bossRoom: {
    name: string;
    description: string;
  };
  keyItem: {
    id: string;
    name: string;
    description: string;
  };
}
