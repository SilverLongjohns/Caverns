import type { GridPosition, ExitData, RoomGridConfig, TileType } from '../types.js';

export interface GenerationParams {
  // Cavern
  fillProbability?: number;
  smoothingPasses?: number;

  // Structured
  subRoomCount?: number;
  corridorWidth?: number;
  featureChance?: number;

  // Chasm
  chasmCount?: number;
  bridgeWidth?: number;

  // Shared
  minOpenPercent?: number;
  hazardChance?: number;
  waterChance?: number;
}

export interface BiomeGenerationConfig {
  biomeId: string;
  strategy: string;
  params: GenerationParams;
  tileThemes: Partial<Record<TileType, string>>;
}

export interface RoomGenerationRequest {
  width: number;
  height: number;
  exits: { position: GridPosition; data: ExitData }[];
  biomeConfig: BiomeGenerationConfig;
  roomType: string;
  seed?: number;
}

export interface RoomGenerator {
  generate(request: RoomGenerationRequest): RoomGridConfig;
}
