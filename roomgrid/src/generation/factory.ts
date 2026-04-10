import type { TileType, RoomGridConfig } from '../types.js';
import type { RoomGenerator, RoomGenerationRequest } from './types.js';
import { CavernGenerator } from './cavernGenerator.js';
import { StructuredGenerator } from './structuredGenerator.js';
import { ChasmGenerator } from './chasmGenerator.js';
import { validateRoom } from './validate.js';

const MAX_ATTEMPTS = 10;

export function createGenerator(strategy: string): RoomGenerator {
  switch (strategy) {
    case 'cavern':
      return new CavernGenerator();
    case 'structured':
      return new StructuredGenerator();
    case 'chasm':
      return new ChasmGenerator();
    default:
      throw new Error(`Unknown generation strategy: ${strategy}`);
  }
}

export function generateRoom(request: RoomGenerationRequest): RoomGridConfig {
  const generator = createGenerator(request.biomeConfig.strategy);
  const minOpen = request.biomeConfig.params.minOpenPercent ?? 0.25;
  const exitPositions = request.exits.map(e => e.position);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const config = generator.generate(request);
    const result = validateRoom(config, exitPositions, minOpen);
    if (result.valid) return config;
  }

  console.warn(
    `[roomgrid] All ${MAX_ATTEMPTS} generation attempts failed for biome ${request.biomeConfig.biomeId}, using fallback room`
  );
  return generateFallbackRoom(request);
}

function generateFallbackRoom(request: RoomGenerationRequest): RoomGridConfig {
  const { width, height, exits } = request;
  const tiles: TileType[][] = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      if (y === 0 || y === height - 1 || x === 0 || x === width - 1) {
        return 'wall' as TileType;
      }
      // Checkerboard water pattern — unmistakable during testing
      if ((x + y) % 2 === 0) {
        return 'water' as TileType;
      }
      return 'floor' as TileType;
    })
  );

  // Place exits
  for (const exit of exits) {
    tiles[exit.position.y][exit.position.x] = 'exit';
  }

  return {
    width,
    height,
    tiles,
    exits: exits.map(e => ({ position: e.position, data: e.data })),
  };
}
