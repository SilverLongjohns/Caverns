import { describe, it, expect } from 'vitest';
import { ChasmGenerator } from '../src/generation/chasmGenerator.js';
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
      biomeId: 'volcanic',
      strategy: 'chasm',
      params: { chasmCount: 2, bridgeWidth: 2 },
      tileThemes: { floor: 'basalt', chasm: 'void', bridge: 'stone_bridge' },
    },
    roomType: 'cavern',
    ...overrides,
  };
}

describe('ChasmGenerator', () => {
  const gen = new ChasmGenerator();

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

  it('contains chasm tiles', () => {
    const config = gen.generate(makeRequest());
    const hasChasms = config.tiles.some(row => row.some(t => t === 'chasm'));
    expect(hasChasms).toBe(true);
  });

  it('contains bridge tiles', () => {
    const config = gen.generate(makeRequest());
    const hasBridges = config.tiles.some(row => row.some(t => t === 'bridge'));
    expect(hasBridges).toBe(true);
  });

  it('generates rooms that pass validation', () => {
    for (let i = 0; i < 5; i++) {
      const request = makeRequest();
      const config = gen.generate(request);
      const exits = request.exits.map(e => e.position);
      const result = validateRoom(config, exits, 0.2);
      expect(result.valid).toBe(true);
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
        biomeId: 'volcanic',
        strategy: 'chasm',
        params: { chasmCount: 1, bridgeWidth: 2, hazardChance: 0.5 },
        tileThemes: {},
      },
    });
    const config = gen.generate(request);
    const hasHazard = config.tiles.some(row => row.some(t => t === 'hazard'));
    expect(hasHazard).toBe(true);
  });
});
