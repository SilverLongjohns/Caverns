import type { Direction } from '@caverns/shared';

// === Tiles ===
export type TileType = 'floor' | 'wall' | 'exit' | 'water' | 'chasm' | 'hazard' | 'bridge';

export interface ExitData {
  direction: Direction;
  targetRoomId: string;
}

export interface Tile {
  type: TileType;
  exit?: ExitData;
  theme?: string;
}

// === Tile Properties ===
export interface TileProperties {
  walkable: boolean;
  blocksLOS: boolean;
  damageOnEntry?: number;
}

export const TILE_PROPERTIES: Record<TileType, TileProperties> = {
  floor:  { walkable: true,  blocksLOS: false },
  wall:   { walkable: false, blocksLOS: true },
  exit:   { walkable: true,  blocksLOS: false },
  water:  { walkable: true,  blocksLOS: false },
  chasm:  { walkable: false, blocksLOS: false },
  hazard: { walkable: true,  blocksLOS: false, damageOnEntry: 5 },
  bridge: { walkable: true,  blocksLOS: false },
};

// === Positions ===
export interface GridPosition {
  x: number;
  y: number;
}

// === Entities ===
export type EntityType = 'player' | 'mob' | 'interactable';

export interface Entity {
  id: string;
  type: EntityType;
  position: GridPosition;
}

// === Config ===
export interface RoomGridConfig {
  width: number;
  height: number;
  tiles: TileType[][];
  exits?: { position: GridPosition; data: ExitData }[];
}

// === Movement ===
export type GridDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export type MoveEvent =
  | { type: 'combat'; entityId: string }
  | { type: 'exit'; exit: ExitData }
  | { type: 'interact'; entityId: string }
  | { type: 'hazard'; damage: number };

export interface MoveResult {
  success: boolean;
  newPosition?: GridPosition;
  events: MoveEvent[];
}

// === Pathfinding ===
export interface PathfindingOpts {
  blockedByEntities?: boolean;
}

// === Distance ===
export function chebyshevDistance(a: GridPosition, b: GridPosition): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// === Direction Offsets ===
export const DIRECTION_OFFSETS: Record<GridDirection, { dx: number; dy: number }> = {
  n:  { dx:  0, dy: -1 },
  s:  { dx:  0, dy:  1 },
  e:  { dx:  1, dy:  0 },
  w:  { dx: -1, dy:  0 },
  ne: { dx:  1, dy: -1 },
  nw: { dx: -1, dy: -1 },
  se: { dx:  1, dy:  1 },
  sw: { dx: -1, dy:  1 },
};
