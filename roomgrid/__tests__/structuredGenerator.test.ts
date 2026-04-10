import { describe, it, expect } from 'vitest';
import { StructuredGenerator } from '../src/generation/structuredGenerator.js';
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
      biomeId: 'crypt',
      strategy: 'structured',
      params: { subRoomCount: 3, corridorWidth: 1, featureChance: 0.3 },
      tileThemes: { floor: 'stone_tile', wall: 'carved_stone' },
    },
    roomType: 'chamber',
    ...overrides,
  };
}

describe('StructuredGenerator', () => {
  const gen = new StructuredGenerator();

  it('produces correct dimensions', () => {
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

  it('generates rooms that pass validation', () => {
    for (let i = 0; i < 5; i++) {
      const request = makeRequest();
      const config = gen.generate(request);
      const exits = request.exits.map(e => e.position);
      const result = validateRoom(config, exits, 0.15);
      expect(result.valid).toBe(true);
    }
  });

  it('contains rectangular floor regions (sub-rooms)', () => {
    const config = gen.generate(makeRequest());
    // There should be contiguous rectangular regions of floor
    // Simple check: count floor tiles, should be significantly more than just corridors
    let floorCount = 0;
    for (const row of config.tiles) {
      for (const t of row) {
        if (t === 'floor') floorCount++;
      }
    }
    // With 3 sub-rooms in a 20x15 grid, expect at least 40 floor tiles
    expect(floorCount).toBeGreaterThan(40);
  });

  it('border is walls except for exits', () => {
    const config = gen.generate(makeRequest());
    for (let x = 0; x < 20; x++) {
      if (x !== 0 && x !== 19) {
        // Not an exit position on top/bottom border
        expect(config.tiles[0][x]).toBe('wall');
        expect(config.tiles[14][x]).toBe('wall');
      }
    }
  });

  it('clears tiles adjacent to exits', () => {
    const request = makeRequest();
    const config = gen.generate(request);
    expect(TILE_PROPERTIES[config.tiles[7][1]].walkable).toBe(true);
    expect(TILE_PROPERTIES[config.tiles[7][18]].walkable).toBe(true);
  });

  it('applies hazard scatter', () => {
    const request = makeRequest({
      biomeConfig: {
        biomeId: 'crypt',
        strategy: 'structured',
        params: { subRoomCount: 3, hazardChance: 0.5 },
        tileThemes: {},
      },
    });
    const config = gen.generate(request);
    const hasHazard = config.tiles.some(row => row.some(t => t === 'hazard'));
    expect(hasHazard).toBe(true);
  });
});
