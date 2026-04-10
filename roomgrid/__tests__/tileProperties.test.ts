import { describe, it, expect } from 'vitest';
import { RoomGrid } from '../src/RoomGrid.js';
import type { RoomGridConfig } from '../src/types.js';
import { TILE_PROPERTIES } from '../src/types.js';

describe('TILE_PROPERTIES', () => {
  it('defines properties for all tile types', () => {
    const types = ['floor', 'wall', 'exit', 'water', 'chasm', 'hazard', 'bridge'] as const;
    for (const t of types) {
      expect(TILE_PROPERTIES[t]).toBeDefined();
      expect(typeof TILE_PROPERTIES[t].walkable).toBe('boolean');
      expect(typeof TILE_PROPERTIES[t].blocksLOS).toBe('boolean');
    }
  });

  it('wall blocks movement and LOS', () => {
    expect(TILE_PROPERTIES.wall.walkable).toBe(false);
    expect(TILE_PROPERTIES.wall.blocksLOS).toBe(true);
  });

  it('chasm blocks movement but not LOS', () => {
    expect(TILE_PROPERTIES.chasm.walkable).toBe(false);
    expect(TILE_PROPERTIES.chasm.blocksLOS).toBe(false);
  });

  it('hazard is walkable with damage', () => {
    expect(TILE_PROPERTIES.hazard.walkable).toBe(true);
    expect(TILE_PROPERTIES.hazard.damageOnEntry).toBe(5);
  });

  it('water and bridge are walkable', () => {
    expect(TILE_PROPERTIES.water.walkable).toBe(true);
    expect(TILE_PROPERTIES.bridge.walkable).toBe(true);
  });
});

describe('expanded tile walkability', () => {
  function makeGrid(tiles: string[]): RoomGrid {
    const tileRows = tiles.map(row =>
      [...row].map(ch => {
        if (ch === '#') return 'wall' as const;
        if (ch === 'E') return 'exit' as const;
        if (ch === '~') return 'water' as const;
        if (ch === 'C') return 'chasm' as const;
        if (ch === '!') return 'hazard' as const;
        if (ch === '=') return 'bridge' as const;
        return 'floor' as const;
      })
    );
    return new RoomGrid({
      width: tileRows[0].length,
      height: tileRows.length,
      tiles: tileRows,
    });
  }

  it('water tiles are walkable', () => {
    const grid = makeGrid(['~.~']);
    expect(grid.isWalkable({ x: 0, y: 0 })).toBe(true);
  });

  it('chasm tiles are not walkable', () => {
    const grid = makeGrid(['.C.']);
    expect(grid.isWalkable({ x: 1, y: 0 })).toBe(false);
  });

  it('bridge tiles are walkable', () => {
    const grid = makeGrid(['.=.']);
    expect(grid.isWalkable({ x: 1, y: 0 })).toBe(true);
  });

  it('hazard tiles are walkable', () => {
    const grid = makeGrid(['.!.']);
    expect(grid.isWalkable({ x: 1, y: 0 })).toBe(true);
  });

  it('chasm does not block LOS', () => {
    const grid = makeGrid([
      '...',
      '.C.',
      '...',
    ]);
    expect(grid.hasLineOfSight({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(true);
  });

  it('player stepping on hazard emits hazard event', () => {
    const grid = makeGrid(['.!.']);
    grid.addEntity({ id: 'p1', type: 'player', position: { x: 0, y: 0 } });
    const result = grid.moveEntity('p1', 'e');
    expect(result.success).toBe(true);
    expect(result.events).toEqual([{ type: 'hazard', damage: 5 }]);
  });

  it('mob stepping on hazard does not emit hazard event', () => {
    const grid = makeGrid(['.!.']);
    grid.addEntity({ id: 'm1', type: 'mob', position: { x: 0, y: 0 } });
    const result = grid.moveEntity('m1', 'e');
    expect(result.success).toBe(true);
    expect(result.events).toEqual([]);
  });
});
