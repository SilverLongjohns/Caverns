import { describe, it, expect } from 'vitest';
import { createGenerator, generateRoom } from '../src/generation/factory.js';
import { validateRoom } from '../src/generation/validate.js';
import type { RoomGenerationRequest } from '../src/generation/types.js';

function makeRequest(strategy: string, overrides?: Partial<RoomGenerationRequest>): RoomGenerationRequest {
  return {
    width: 20,
    height: 15,
    exits: [
      { position: { x: 0, y: 7 }, data: { direction: 'west', targetRoomId: 'room1' } },
      { position: { x: 19, y: 7 }, data: { direction: 'east', targetRoomId: 'room2' } },
    ],
    biomeConfig: {
      biomeId: 'test',
      strategy,
      params: {},
      tileThemes: {},
    },
    roomType: 'chamber',
    ...overrides,
  };
}

describe('createGenerator', () => {
  it('returns CavernGenerator for "cavern"', () => {
    const gen = createGenerator('cavern');
    expect(gen).toBeDefined();
  });

  it('returns StructuredGenerator for "structured"', () => {
    const gen = createGenerator('structured');
    expect(gen).toBeDefined();
  });

  it('returns ChasmGenerator for "chasm"', () => {
    const gen = createGenerator('chasm');
    expect(gen).toBeDefined();
  });

  it('throws for unknown strategy', () => {
    expect(() => createGenerator('unknown')).toThrow();
  });
});

describe('generateRoom', () => {
  it('generates a valid cavern room', () => {
    const request = makeRequest('cavern');
    const config = generateRoom(request);
    expect(config.width).toBe(20);
    expect(config.height).toBe(15);
    const result = validateRoom(config, request.exits.map(e => e.position), 0.3);
    expect(result.valid).toBe(true);
  });

  it('generates a valid structured room', () => {
    const request = makeRequest('structured', {
      biomeConfig: {
        biomeId: 'test',
        strategy: 'structured',
        params: { minOpenPercent: 0.15 },
        tileThemes: {},
      },
    });
    const config = generateRoom(request);
    // Verify it's not a fallback (no checkerboard water)
    const hasWater = config.tiles.some(row => row.some(t => t === 'water'));
    expect(hasWater).toBe(false);
    const result = validateRoom(config, request.exits.map(e => e.position), 0.15);
    expect(result.valid).toBe(true);
  });

  it('generates a valid chasm room', () => {
    const request = makeRequest('chasm');
    const config = generateRoom(request);
    const result = validateRoom(config, request.exits.map(e => e.position), 0.2);
    expect(result.valid).toBe(true);
  });

  it('returns fallback room with checkerboard water on repeated failure', () => {
    // Use impossible params that will always fail validation: 99% fill, require 99% open
    const request = makeRequest('cavern', {
      biomeConfig: {
        biomeId: 'test',
        strategy: 'cavern',
        params: { fillProbability: 0.99, smoothingPasses: 10, minOpenPercent: 0.99 },
        tileThemes: {},
      },
    });
    const config = generateRoom(request);
    // Fallback: should have checkerboard water pattern
    const hasWater = config.tiles.some(row => row.some(t => t === 'water'));
    expect(hasWater).toBe(true);
    // Should still have correct dimensions
    expect(config.width).toBe(20);
    expect(config.height).toBe(15);
    // Should have exit tiles
    expect(config.tiles[7][0]).toBe('exit');
    expect(config.tiles[7][19]).toBe('exit');
  });
});
