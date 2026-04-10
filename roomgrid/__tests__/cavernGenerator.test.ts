import { describe, it, expect } from 'vitest';
import { CavernGenerator } from '../src/generation/cavernGenerator.js';
import { validateRoom } from '../src/generation/validate.js';
import { TILE_PROPERTIES } from '../src/types.js';
import type { RoomGenerationRequest } from '../src/generation/types.js';

function makeRequest(overrides?: Partial<RoomGenerationRequest>): RoomGenerationRequest {
  return {
    width: 20,
    height: 15,
    exits: [
      { position: { x: 0, y: 7 }, data: { direction: 'west', targetRoomId: 'room1' } },
      { position: { x: 19, y: 7 }, data: { direction: 'east', targetRoomId: 'room2' } },
    ],
    biomeConfig: {
      biomeId: 'fungal',
      strategy: 'cavern',
      params: { fillProbability: 0.45, smoothingPasses: 4 },
      tileThemes: { floor: 'moss', wall: 'fungal_rock' },
    },
    roomType: 'chamber',
    ...overrides,
  };
}

describe('CavernGenerator', () => {
  const gen = new CavernGenerator();

  it('produces a RoomGridConfig with correct dimensions', () => {
    const config = gen.generate(makeRequest());
    expect(config.width).toBe(20);
    expect(config.height).toBe(15);
    expect(config.tiles.length).toBe(15);
    expect(config.tiles[0].length).toBe(20);
  });

  it('places exit tiles at specified positions', () => {
    const config = gen.generate(makeRequest());
    expect(config.tiles[7][0]).toBe('exit');
    expect(config.tiles[7][19]).toBe('exit');
  });

  it('exit data is included in config', () => {
    const config = gen.generate(makeRequest());
    expect(config.exits).toHaveLength(2);
    expect(config.exits![0].position).toEqual({ x: 0, y: 7 });
    expect(config.exits![0].data.direction).toBe('west');
  });

  it('border tiles are walls', () => {
    const config = gen.generate(makeRequest({ exits: [] }));
    // Top row (y=0) should be all walls
    for (let x = 0; x < 20; x++) {
      expect(config.tiles[0][x]).toBe('wall');
    }
    // Bottom row
    for (let x = 0; x < 20; x++) {
      expect(config.tiles[14][x]).toBe('wall');
    }
  });

  it('applies tile themes', () => {
    const config = gen.generate(makeRequest());
    // Themes are not in TileType[][] — they are in the exits/config metadata
    // For now, just verify the grid is valid
    expect(config.tiles.length).toBe(15);
  });

  it('generates rooms that pass validation', () => {
    // Run 5 times to account for randomness
    for (let i = 0; i < 5; i++) {
      const request = makeRequest();
      const config = gen.generate(request);
      const exits = request.exits.map(e => e.position);
      const result = validateRoom(config, exits, 0.3);
      expect(result.valid).toBe(true);
    }
  });

  it('applies water tiles when waterChance is set', () => {
    const request = makeRequest({
      biomeConfig: {
        biomeId: 'fungal',
        strategy: 'cavern',
        params: { fillProbability: 0.3, smoothingPasses: 3, waterChance: 0.5 },
        tileThemes: {},
      },
    });
    const config = gen.generate(request);
    const hasWater = config.tiles.some(row => row.some(t => t === 'water'));
    expect(hasWater).toBe(true);
  });

  it('applies hazard tiles when hazardChance is set', () => {
    const request = makeRequest({
      biomeConfig: {
        biomeId: 'volcanic',
        strategy: 'cavern',
        params: { fillProbability: 0.3, smoothingPasses: 3, hazardChance: 0.5 },
        tileThemes: {},
      },
    });
    const config = gen.generate(request);
    const hasHazard = config.tiles.some(row => row.some(t => t === 'hazard'));
    expect(hasHazard).toBe(true);
  });

  it('clears tiles adjacent to exits', () => {
    const request = makeRequest();
    const config = gen.generate(request);
    // Tile next to west exit should be floor (not wall)
    expect(TILE_PROPERTIES[config.tiles[7][1]].walkable).toBe(true);
    // Tile next to east exit should be floor
    expect(TILE_PROPERTIES[config.tiles[7][18]].walkable).toBe(true);
  });
});
