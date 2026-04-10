import { describe, it, expect } from 'vitest';
import { TILE_CHARS, WALL_CHARS, getWallChar, getTileChar } from '../src/rendering/tileChars.js';
import type { TileType } from '../src/types.js';

describe('TILE_CHARS', () => {
  it('maps every non-wall tile type to a character', () => {
    expect(TILE_CHARS.floor).toBe('.');
    expect(TILE_CHARS.exit).toBe('▓');
    expect(TILE_CHARS.water).toBe('~');
    expect(TILE_CHARS.chasm).toBe(' ');
    expect(TILE_CHARS.hazard).toBe('^');
    expect(TILE_CHARS.bridge).toBe('=');
  });
});

describe('WALL_CHARS', () => {
  it('has 16 entries for all neighbor masks', () => {
    expect(WALL_CHARS).toHaveLength(16);
  });

  it('maps isolated wall to box', () => {
    expect(WALL_CHARS[0]).toBe('□');
  });

  it('maps N+S to vertical double line', () => {
    expect(WALL_CHARS[3]).toBe('║');
  });

  it('maps E+W to horizontal double line', () => {
    expect(WALL_CHARS[12]).toBe('═');
  });

  it('maps all four to cross', () => {
    expect(WALL_CHARS[15]).toBe('╬');
  });
});

describe('getWallChar', () => {
  function wallCharAt(grid: TileType[][], x: number, y: number): string {
    return getWallChar(grid, x, y);
  }

  it('treats out-of-bounds as connected (border wall gets edge connections)', () => {
    const grid: TileType[][] = [['wall']];
    expect(wallCharAt(grid, 0, 0)).toBe('╬');
  });

  it('computes corner piece for top-left of walled room', () => {
    const grid: TileType[][] = [
      ['wall', 'wall', 'wall'],
      ['wall', 'floor', 'wall'],
      ['wall', 'wall', 'wall'],
    ];
    expect(wallCharAt(grid, 0, 0)).toBe('╬');
    expect(wallCharAt(grid, 1, 0)).toBe('╩');
  });

  it('computes vertical line for wall between floor tiles', () => {
    const grid: TileType[][] = [
      ['floor', 'wall', 'floor'],
      ['floor', 'wall', 'floor'],
      ['floor', 'wall', 'floor'],
    ];
    expect(wallCharAt(grid, 1, 1)).toBe('║');
  });

  it('computes horizontal line for wall between floor tiles', () => {
    const grid: TileType[][] = [
      ['floor', 'floor', 'floor'],
      ['wall',  'wall',  'wall'],
      ['floor', 'floor', 'floor'],
    ];
    expect(wallCharAt(grid, 1, 1)).toBe('═');
  });
});

describe('getTileChar', () => {
  it('returns period for floor', () => {
    const grid: TileType[][] = [['floor']];
    expect(getTileChar(grid, 0, 0)).toBe('.');
  });

  it('delegates to wall lookup for wall tiles', () => {
    const grid: TileType[][] = [
      ['wall', 'wall'],
      ['wall', 'floor'],
    ];
    expect(getTileChar(grid, 0, 0)).toBe('╬');
    expect(getTileChar(grid, 1, 0)).toBe('╩');
  });

  it('returns correct chars for all non-wall types', () => {
    const types: TileType[] = ['floor', 'exit', 'water', 'chasm', 'hazard', 'bridge'];
    const expected = ['.', '▓', '~', ' ', '^', '='];
    for (let i = 0; i < types.length; i++) {
      const grid: TileType[][] = [[types[i]]];
      expect(getTileChar(grid, 0, 0)).toBe(expected[i]);
    }
  });
});
