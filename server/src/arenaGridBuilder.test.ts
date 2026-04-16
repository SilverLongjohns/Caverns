// server/src/arenaGridBuilder.test.ts
import { describe, it, expect } from 'vitest';
import { buildArenaGrid, placeStartingPositions } from './arenaGridBuilder.js';
import { TILE_PROPERTIES } from '@caverns/roomgrid';

describe('buildArenaGrid', () => {
  it('generates a grid with correct dimensions for a chamber', () => {
    const result = buildArenaGrid('chamber', 'starter');
    expect(result.width).toBe(30);
    expect(result.height).toBe(15);
    expect(result.tiles.length).toBe(15);
    expect(result.tiles[0].length).toBe(30);
  });

  it('generates a grid with correct dimensions for a tunnel', () => {
    const result = buildArenaGrid('tunnel', 'starter');
    expect(result.width).toBe(30);
    expect(result.height).toBe(8);
  });

  it('generates a grid with no exit tiles', () => {
    const result = buildArenaGrid('chamber', 'starter');
    for (const row of result.tiles) {
      for (const tile of row) {
        expect(tile).not.toBe('exit');
      }
    }
  });

  it('has walkable floor tiles inside the border', () => {
    const result = buildArenaGrid('chamber', 'starter');
    let floorCount = 0;
    for (let y = 1; y < result.height - 1; y++) {
      for (let x = 1; x < result.width - 1; x++) {
        const tile = result.tiles[y][x];
        if (TILE_PROPERTIES[tile as keyof typeof TILE_PROPERTIES]?.walkable) {
          floorCount++;
        }
      }
    }
    const interior = (result.width - 2) * (result.height - 2);
    expect(floorCount / interior).toBeGreaterThan(0.25);
  });

  it('applies biome theming when available', () => {
    const result = buildArenaGrid('chamber', 'fungal');
    expect(result.themes).toBeDefined();
  });
});

describe('placeStartingPositions', () => {
  it('places players in the left 3 columns and mobs in the right 3 columns', () => {
    const grid = buildArenaGrid('chamber', 'starter');
    const playerIds = ['p1', 'p2'];
    const mobIds = ['m1', 'm2'];
    const positions = placeStartingPositions(grid, playerIds, mobIds);

    for (const pid of playerIds) {
      expect(positions[pid]).toBeDefined();
      expect(positions[pid].x).toBeLessThanOrEqual(3);
      expect(positions[pid].x).toBeGreaterThanOrEqual(1);
    }
    for (const mid of mobIds) {
      expect(positions[mid]).toBeDefined();
      expect(positions[mid].x).toBeGreaterThanOrEqual(grid.width - 4);
      expect(positions[mid].x).toBeLessThanOrEqual(grid.width - 2);
    }
  });

  it('no two combatants share a position', () => {
    const grid = buildArenaGrid('chamber', 'starter');
    const playerIds = ['p1', 'p2', 'p3', 'p4'];
    const mobIds = ['m1', 'm2', 'm3'];
    const positions = placeStartingPositions(grid, playerIds, mobIds);

    const posSet = new Set<string>();
    for (const pos of Object.values(positions)) {
      const key = `${pos.x},${pos.y}`;
      expect(posSet.has(key)).toBe(false);
      posSet.add(key);
    }
  });

  it('all positions are on walkable tiles', () => {
    const grid = buildArenaGrid('chamber', 'starter');
    const positions = placeStartingPositions(grid, ['p1'], ['m1']);

    for (const pos of Object.values(positions)) {
      const tile = grid.tiles[pos.y][pos.x];
      const props = TILE_PROPERTIES[tile as keyof typeof TILE_PROPERTIES];
      expect(props?.walkable).toBe(true);
    }
  });
});
