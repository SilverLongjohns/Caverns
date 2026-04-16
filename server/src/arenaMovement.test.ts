// server/src/arenaMovement.test.ts
import { describe, it, expect } from 'vitest';
import { getMovementRange, findPath, getMovementCost } from './arenaMovement.js';
import type { TileGrid } from '@caverns/shared';

function makeGrid(tiles: string[][]): TileGrid {
  return {
    width: tiles[0].length,
    height: tiles.length,
    tiles,
  };
}

// Simple 5x5 open grid with walls on border
const openGrid = makeGrid([
  ['wall','wall','wall','wall','wall'],
  ['wall','floor','floor','floor','wall'],
  ['wall','floor','floor','floor','wall'],
  ['wall','floor','floor','floor','wall'],
  ['wall','wall','wall','wall','wall'],
]);

describe('getMovementCost', () => {
  it('returns 1 for floor tiles', () => {
    expect(getMovementCost('floor')).toBe(1);
  });

  it('returns 2 for water tiles', () => {
    expect(getMovementCost('water')).toBe(2);
  });

  it('returns 1 for bridge tiles', () => {
    expect(getMovementCost('bridge')).toBe(1);
  });

  it('returns 1 for hazard tiles', () => {
    expect(getMovementCost('hazard')).toBe(1);
  });

  it('returns Infinity for wall tiles', () => {
    expect(getMovementCost('wall')).toBe(Infinity);
  });

  it('returns Infinity for chasm tiles', () => {
    expect(getMovementCost('chasm')).toBe(Infinity);
  });
});

describe('getMovementRange', () => {
  it('returns reachable tiles within movement points', () => {
    const occupied = new Set<string>();
    const range = getMovementRange(openGrid, { x: 2, y: 2 }, 2, occupied);
    expect(range.has('2,2')).toBe(true);  // self
    expect(range.has('2,1')).toBe(true);  // north
    expect(range.has('2,3')).toBe(true);  // south
    expect(range.has('1,2')).toBe(true);  // west
    expect(range.has('3,2')).toBe(true);  // east
    expect(range.has('1,1')).toBe(true);  // NW (2 steps)
    expect(range.has('3,3')).toBe(true);  // SE (2 steps)
  });

  it('does not include wall tiles', () => {
    const occupied = new Set<string>();
    const range = getMovementRange(openGrid, { x: 1, y: 1 }, 3, occupied);
    expect(range.has('0,0')).toBe(false);
    expect(range.has('0,1')).toBe(false);
  });

  it('does not include tiles occupied by other units', () => {
    const occupied = new Set<string>(['2,2']);
    const range = getMovementRange(openGrid, { x: 1, y: 2 }, 3, occupied);
    expect(range.has('2,2')).toBe(false);
    // But can still reach tiles beyond if path exists
    expect(range.has('3,2')).toBe(true); // go around via row 1 or 3
  });

  it('water costs 2 movement points', () => {
    const waterGrid = makeGrid([
      ['wall','wall','wall','wall','wall'],
      ['wall','floor','water','floor','wall'],
      ['wall','floor','floor','floor','wall'],
      ['wall','wall','wall','wall','wall'],
    ]);
    const occupied = new Set<string>();
    const range = getMovementRange(waterGrid, { x: 1, y: 1 }, 2, occupied);
    expect(range.has('2,1')).toBe(true);  // water tile itself (costs 2)
    expect(range.has('3,1')).toBe(false); // can't afford floor after water
  });
});

describe('findPath', () => {
  it('returns a valid path between two reachable points', () => {
    const occupied = new Set<string>();
    const path = findPath(openGrid, { x: 1, y: 1 }, { x: 3, y: 3 }, 4, occupied);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(0);
    expect(path![path!.length - 1]).toEqual({ x: 3, y: 3 });
  });

  it('returns null when target is out of movement range', () => {
    const occupied = new Set<string>();
    const path = findPath(openGrid, { x: 1, y: 1 }, { x: 3, y: 3 }, 2, occupied);
    expect(path).toBeNull();
  });

  it('returns null when target is a wall', () => {
    const occupied = new Set<string>();
    const path = findPath(openGrid, { x: 1, y: 1 }, { x: 0, y: 0 }, 5, occupied);
    expect(path).toBeNull();
  });

  it('paths around occupied tiles', () => {
    const occupied = new Set<string>(['2,1', '2,2', '2,3']);
    const path = findPath(openGrid, { x: 1, y: 2 }, { x: 3, y: 2 }, 10, occupied);
    // All paths through column 2 are blocked, no way around in 3x3 interior
    expect(path).toBeNull();
  });
});
