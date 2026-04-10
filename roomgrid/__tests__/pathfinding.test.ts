import { describe, it, expect } from 'vitest';
import { findPath } from '../src/pathfinding.js';
import type { Tile, Entity } from '../src/types.js';

function buildTiles(map: string[]): Tile[][] {
  return map.map(row =>
    [...row].map(ch => {
      if (ch === '#') return { type: 'wall' as const };
      if (ch === 'E') return { type: 'exit' as const };
      return { type: 'floor' as const };
    })
  );
}

describe('findPath', () => {
  it('returns direct path in open room', () => {
    const tiles = buildTiles([
      '.....',
      '.....',
      '.....',
    ]);
    const path = findPath(tiles, [], { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ x: 0, y: 0 });
    expect(path![path!.length - 1]).toEqual({ x: 4, y: 0 });
    expect(path!).toHaveLength(5);
  });

  it('finds path around wall', () => {
    const tiles = buildTiles([
      '...',
      '.#.',
      '...',
    ]);
    const path = findPath(tiles, [], { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ x: 0, y: 0 });
    expect(path![path!.length - 1]).toEqual({ x: 2, y: 2 });
    const hitsWall = path!.some(p => p.x === 1 && p.y === 1);
    expect(hitsWall).toBe(false);
  });

  it('returns null when no path exists', () => {
    const tiles = buildTiles([
      '.#.',
      '###',
      '.#.',
    ]);
    const path = findPath(tiles, [], { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path).toBeNull();
  });

  it('returns single point when start equals end', () => {
    const tiles = buildTiles(['...']);
    const path = findPath(tiles, [], { x: 1, y: 0 }, { x: 1, y: 0 });
    expect(path).toEqual([{ x: 1, y: 0 }]);
  });

  it('treats exit tiles as walkable', () => {
    const tiles = buildTiles([
      '..E',
    ]);
    const path = findPath(tiles, [], { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(path).not.toBeNull();
    expect(path!).toHaveLength(3);
  });

  it('avoids entity-occupied tiles when blockedByEntities is true', () => {
    const tiles = buildTiles([
      '...',
      '...',
      '...',
    ]);
    const entities: Entity[] = [
      { id: 'mob1', type: 'mob', position: { x: 1, y: 1 } },
    ];
    const path = findPath(tiles, entities, { x: 0, y: 0 }, { x: 2, y: 2 }, { blockedByEntities: true });
    expect(path).not.toBeNull();
    const hitsEntity = path!.some(p => p.x === 1 && p.y === 1);
    expect(hitsEntity).toBe(false);
  });

  it('ignores entities when blockedByEntities is false (default)', () => {
    const tiles = buildTiles([
      '...',
      '...',
      '...',
    ]);
    const entities: Entity[] = [
      { id: 'mob1', type: 'mob', position: { x: 1, y: 1 } },
    ];
    const path = findPath(tiles, entities, { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path).not.toBeNull();
    expect(path!).toHaveLength(3);
  });

  it('uses diagonal movement', () => {
    const tiles = buildTiles([
      '...',
      '...',
      '...',
    ]);
    const path = findPath(tiles, [], { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path).not.toBeNull();
    expect(path!).toHaveLength(3);
  });
});
