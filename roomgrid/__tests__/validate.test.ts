import { describe, it, expect } from 'vitest';
import { validateRoom } from '../src/generation/validate.js';
import type { RoomGridConfig } from '../src/types.js';

function makeConfig(map: string[]): RoomGridConfig {
  const tiles = map.map(row =>
    [...row].map(ch => {
      if (ch === '#') return 'wall' as const;
      if (ch === 'E') return 'exit' as const;
      if (ch === 'C') return 'chasm' as const;
      if (ch === '=') return 'bridge' as const;
      return 'floor' as const;
    })
  );
  return { width: tiles[0].length, height: tiles.length, tiles };
}

describe('validateRoom', () => {
  it('valid room with connected exits passes', () => {
    const config = makeConfig([
      'E...E',
      '.....',
      '.....',
    ]);
    const result = validateRoom(config, [{ x: 0, y: 0 }, { x: 4, y: 0 }], 0.4);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('disconnected exits fail connectivity', () => {
    const config = makeConfig([
      'E.#.E',
      '..#..',
      '..#..',
    ]);
    const result = validateRoom(config, [{ x: 0, y: 0 }, { x: 4, y: 0 }], 0.4);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('connect'))).toBe(true);
  });

  it('too few open tiles fails open space check', () => {
    const config = makeConfig([
      'E####',
      '#####',
      '####E',
    ]);
    const result = validateRoom(config, [{ x: 0, y: 0 }, { x: 4, y: 2 }], 0.4);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('open'))).toBe(true);
  });

  it('exit not in bounds fails', () => {
    const config = makeConfig([
      '...',
      '...',
    ]);
    const result = validateRoom(config, [{ x: 10, y: 10 }], 0.4);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('bounds'))).toBe(true);
  });

  it('single exit always passes connectivity', () => {
    const config = makeConfig([
      'E....',
      '.....',
    ]);
    const result = validateRoom(config, [{ x: 0, y: 0 }], 0.4);
    expect(result.valid).toBe(true);
  });

  it('chasm tiles count as non-walkable for open space', () => {
    // 3x3, 5 chasms + 2 exits + 2 floor = only 4 walkable out of 9 = 0.44
    const config = makeConfig([
      'E.C',
      'CCC',
      'C.E',
    ]);
    const result = validateRoom(config, [{ x: 0, y: 0 }, { x: 2, y: 2 }], 0.5);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('open'))).toBe(true);
  });

  it('bridge tiles count as walkable', () => {
    const config = makeConfig([
      'E=E',
    ]);
    const result = validateRoom(config, [{ x: 0, y: 0 }, { x: 2, y: 0 }], 0.4);
    expect(result.valid).toBe(true);
  });
});
