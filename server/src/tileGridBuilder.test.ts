import { describe, it, expect } from 'vitest';
import { buildTileGrid, ROOM_DIMENSIONS } from './tileGridBuilder.js';
import type { Room, Direction } from '@caverns/shared';

function makeRoom(type: string, exits: Partial<Record<Direction, string>> = {}): Room {
  return {
    id: 'test-room',
    type: type as any,
    name: 'Test Room',
    description: 'A test room',
    exits,
  };
}

describe('ROOM_DIMENSIONS', () => {
  it('has dimensions for all room types', () => {
    expect(ROOM_DIMENSIONS.tunnel).toEqual({ width: 30, height: 8 });
    expect(ROOM_DIMENSIONS.chamber).toEqual({ width: 30, height: 15 });
    expect(ROOM_DIMENSIONS.cavern).toEqual({ width: 40, height: 18 });
    expect(ROOM_DIMENSIONS.dead_end).toEqual({ width: 20, height: 12 });
    expect(ROOM_DIMENSIONS.boss).toEqual({ width: 45, height: 20 });
  });
});

describe('buildTileGrid', () => {
  it('returns a TileGrid with correct dimensions for a chamber', () => {
    const room = makeRoom('chamber', { north: 'room2', south: 'room3' });
    const grid = buildTileGrid(room, 'starter');
    expect(grid.width).toBe(30);
    expect(grid.height).toBe(15);
    expect(grid.tiles.length).toBe(15);
    expect(grid.tiles[0].length).toBe(30);
  });

  it('returns a TileGrid with correct dimensions for a tunnel', () => {
    const room = makeRoom('tunnel', { east: 'room2', west: 'room3' });
    const grid = buildTileGrid(room, 'starter');
    expect(grid.width).toBe(30);
    expect(grid.height).toBe(8);
  });

  it('returns a TileGrid with correct dimensions for a boss room', () => {
    const room = makeRoom('boss', { south: 'room2' });
    const grid = buildTileGrid(room, 'starter');
    expect(grid.width).toBe(45);
    expect(grid.height).toBe(20);
  });

  it('places exit tiles at border positions matching room exits', () => {
    const room = makeRoom('chamber', { north: 'room2', east: 'room3' });
    const grid = buildTileGrid(room, 'starter');
    // north exit: x=15 (width/2), y=0
    expect(grid.tiles[0][15]).toBe('exit');
    // east exit: x=29 (width-1), y=7 (height/2)
    expect(grid.tiles[7][29]).toBe('exit');
  });

  it('generates walkable tiles (not all walls)', () => {
    const room = makeRoom('chamber', { north: 'room2', south: 'room3' });
    const grid = buildTileGrid(room, 'starter');
    let floorCount = 0;
    for (const row of grid.tiles) {
      for (const tile of row) {
        if (tile === 'floor' || tile === 'exit') floorCount++;
      }
    }
    expect(floorCount).toBeGreaterThan(grid.width * grid.height * 0.1);
  });

  it('includes themes when biome has tileThemes', () => {
    const room = makeRoom('chamber', { north: 'room2' });
    const grid = buildTileGrid(room, 'fungal');
    expect(grid.themes).toBeDefined();
    let hasMoss = false;
    for (const row of grid.themes!) {
      for (const theme of row) {
        if (theme === 'moss') hasMoss = true;
      }
    }
    expect(hasMoss).toBe(true);
  });

  it('starter biome includes themes', () => {
    const room = makeRoom('chamber', { north: 'room2' });
    const grid = buildTileGrid(room, 'starter');
    expect(grid.themes).toBeDefined();
  });

  it('falls back to starter config for unknown biome', () => {
    const room = makeRoom('chamber', { north: 'room2' });
    const grid = buildTileGrid(room, 'nonexistent_biome');
    expect(grid.width).toBe(30);
    expect(grid.height).toBe(15);
    expect(grid.tiles.length).toBe(15);
  });

  it('falls back to chamber dimensions for unknown room type', () => {
    const room = makeRoom('unknown_type', { north: 'room2' });
    const grid = buildTileGrid(room, 'starter');
    expect(grid.width).toBe(30);
    expect(grid.height).toBe(15);
  });
});
