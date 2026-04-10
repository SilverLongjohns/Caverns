import { describe, it, expect } from 'vitest';
import { RoomGrid } from '../src/RoomGrid.js';
import type { RoomGridConfig, Entity } from '../src/types.js';

function makeConfig(map: string[], exits?: RoomGridConfig['exits']): RoomGridConfig {
  const tiles = map.map(row =>
    [...row].map(ch => {
      if (ch === '#') return 'wall' as const;
      if (ch === 'E') return 'exit' as const;
      return 'floor' as const;
    })
  );
  return {
    width: tiles[0].length,
    height: tiles.length,
    tiles,
    exits,
  };
}

describe('RoomGrid constructor', () => {
  it('creates a grid from config', () => {
    const grid = new RoomGrid(makeConfig([
      '...',
      '.#.',
      '...',
    ]));
    expect(grid).toBeDefined();
  });

  it('throws if tile array dimensions mismatch config', () => {
    expect(() => new RoomGrid({
      width: 5,
      height: 3,
      tiles: [
        ['floor', 'floor', 'floor'],
        ['floor', 'floor', 'floor'],
        ['floor', 'floor', 'floor'],
      ],
    })).toThrow();
  });

  it('applies exit data to exit tiles', () => {
    const grid = new RoomGrid(makeConfig(
      ['..E'],
      [{ position: { x: 2, y: 0 }, data: { direction: 'east', targetRoomId: 'room2' } }]
    ));
    const tile = grid.getTile({ x: 2, y: 0 });
    expect(tile?.type).toBe('exit');
    expect(tile?.exit).toEqual({ direction: 'east', targetRoomId: 'room2' });
  });
});

describe('tile queries', () => {
  const grid = new RoomGrid(makeConfig([
    '...',
    '.#.',
    '..E',
  ]));

  it('getTile returns correct tile types', () => {
    expect(grid.getTile({ x: 0, y: 0 })?.type).toBe('floor');
    expect(grid.getTile({ x: 1, y: 1 })?.type).toBe('wall');
    expect(grid.getTile({ x: 2, y: 2 })?.type).toBe('exit');
  });

  it('getTile returns null for out of bounds', () => {
    expect(grid.getTile({ x: -1, y: 0 })).toBeNull();
    expect(grid.getTile({ x: 0, y: 5 })).toBeNull();
    expect(grid.getTile({ x: 3, y: 0 })).toBeNull();
  });

  it('isWalkable returns true for floor and exit', () => {
    expect(grid.isWalkable({ x: 0, y: 0 })).toBe(true);
    expect(grid.isWalkable({ x: 2, y: 2 })).toBe(true);
  });

  it('isWalkable returns false for wall and out of bounds', () => {
    expect(grid.isWalkable({ x: 1, y: 1 })).toBe(false);
    expect(grid.isWalkable({ x: -1, y: 0 })).toBe(false);
  });

  it('isInBounds checks grid boundaries', () => {
    expect(grid.isInBounds({ x: 0, y: 0 })).toBe(true);
    expect(grid.isInBounds({ x: 2, y: 2 })).toBe(true);
    expect(grid.isInBounds({ x: 3, y: 0 })).toBe(false);
    expect(grid.isInBounds({ x: 0, y: -1 })).toBe(false);
  });
});

describe('entity management', () => {
  function makeGrid() {
    return new RoomGrid(makeConfig([
      '...',
      '.#.',
      '...',
    ]));
  }

  it('addEntity places an entity on a floor tile', () => {
    const grid = makeGrid();
    grid.addEntity({ id: 'p1', type: 'player', position: { x: 0, y: 0 } });
    expect(grid.getEntity('p1')).toEqual({ id: 'p1', type: 'player', position: { x: 0, y: 0 } });
  });

  it('addEntity throws on wall tile', () => {
    const grid = makeGrid();
    expect(() => grid.addEntity({ id: 'p1', type: 'player', position: { x: 1, y: 1 } })).toThrow();
  });

  it('addEntity throws on out of bounds', () => {
    const grid = makeGrid();
    expect(() => grid.addEntity({ id: 'p1', type: 'player', position: { x: -1, y: 0 } })).toThrow();
  });

  it('removeEntity removes an entity', () => {
    const grid = makeGrid();
    grid.addEntity({ id: 'p1', type: 'player', position: { x: 0, y: 0 } });
    grid.removeEntity('p1');
    expect(grid.getEntity('p1')).toBeNull();
  });

  it('getEntity returns null for unknown id', () => {
    const grid = makeGrid();
    expect(grid.getEntity('nope')).toBeNull();
  });

  it('getEntitiesAt returns all entities at position', () => {
    const grid = makeGrid();
    grid.addEntity({ id: 'p1', type: 'player', position: { x: 0, y: 0 } });
    grid.addEntity({ id: 'i1', type: 'interactable', position: { x: 0, y: 0 } });
    expect(grid.getEntitiesAt({ x: 0, y: 0 })).toHaveLength(2);
  });

  it('getEntitiesAt returns empty for unoccupied tile', () => {
    const grid = makeGrid();
    expect(grid.getEntitiesAt({ x: 2, y: 2 })).toEqual([]);
  });

  it('getEntitiesByType returns filtered list', () => {
    const grid = makeGrid();
    grid.addEntity({ id: 'p1', type: 'player', position: { x: 0, y: 0 } });
    grid.addEntity({ id: 'm1', type: 'mob', position: { x: 2, y: 0 } });
    grid.addEntity({ id: 'p2', type: 'player', position: { x: 0, y: 2 } });
    expect(grid.getEntitiesByType('player')).toHaveLength(2);
    expect(grid.getEntitiesByType('mob')).toHaveLength(1);
    expect(grid.getEntitiesByType('interactable')).toHaveLength(0);
  });
});

describe('moveEntity', () => {
  function makeGrid() {
    return new RoomGrid(makeConfig(
      [
        '..E',
        '.#.',
        '...',
      ],
      [{ position: { x: 2, y: 0 }, data: { direction: 'east', targetRoomId: 'room2' } }]
    ));
  }

  it('moves entity to empty floor tile', () => {
    const grid = makeGrid();
    grid.addEntity({ id: 'p1', type: 'player', position: { x: 0, y: 0 } });
    const result = grid.moveEntity('p1', 'e');
    expect(result.success).toBe(true);
    expect(result.newPosition).toEqual({ x: 1, y: 0 });
    expect(result.events).toEqual([]);
    expect(grid.getEntity('p1')?.position).toEqual({ x: 1, y: 0 });
  });

  it('fails to move into wall', () => {
    const grid = makeGrid();
    grid.addEntity({ id: 'p1', type: 'player', position: { x: 0, y: 1 } });
    const result = grid.moveEntity('p1', 'e');
    expect(result.success).toBe(false);
    expect(result.events).toEqual([]);
    expect(grid.getEntity('p1')?.position).toEqual({ x: 0, y: 1 });
  });

  it('fails to move out of bounds', () => {
    const grid = makeGrid();
    grid.addEntity({ id: 'p1', type: 'player', position: { x: 0, y: 0 } });
    const result = grid.moveEntity('p1', 'w');
    expect(result.success).toBe(false);
    expect(result.events).toEqual([]);
  });

  it('triggers exit event on exit tile', () => {
    const grid = makeGrid();
    grid.addEntity({ id: 'p1', type: 'player', position: { x: 1, y: 0 } });
    const result = grid.moveEntity('p1', 'e');
    expect(result.success).toBe(true);
    expect(result.newPosition).toEqual({ x: 2, y: 0 });
    expect(result.events).toEqual([
      { type: 'exit', exit: { direction: 'east', targetRoomId: 'room2' } },
    ]);
  });

  it('triggers combat event when player moves to mob tile — player stays in place', () => {
    const grid = makeGrid();
    grid.addEntity({ id: 'p1', type: 'player', position: { x: 0, y: 2 } });
    grid.addEntity({ id: 'm1', type: 'mob', position: { x: 1, y: 2 } });
    const result = grid.moveEntity('p1', 'e');
    expect(result.success).toBe(true);
    expect(result.newPosition).toEqual({ x: 0, y: 2 }); // stays in place
    expect(result.events).toEqual([
      { type: 'combat', entityId: 'm1' },
    ]);
  });

  it('triggers interact event when player moves to interactable tile', () => {
    const grid = makeGrid();
    grid.addEntity({ id: 'p1', type: 'player', position: { x: 0, y: 2 } });
    grid.addEntity({ id: 'i1', type: 'interactable', position: { x: 1, y: 2 } });
    const result = grid.moveEntity('p1', 'e');
    expect(result.success).toBe(true);
    expect(result.newPosition).toEqual({ x: 1, y: 2 }); // moves onto tile
    expect(result.events).toEqual([
      { type: 'interact', entityId: 'i1' },
    ]);
  });

  it('moves diagonally', () => {
    const grid = makeGrid();
    grid.addEntity({ id: 'p1', type: 'player', position: { x: 0, y: 0 } });
    const result = grid.moveEntity('p1', 'se');
    // (1,1) is a wall, so this should fail
    expect(result.success).toBe(false);

    grid.addEntity({ id: 'p2', type: 'player', position: { x: 2, y: 2 } });
    const result2 = grid.moveEntity('p2', 'nw');
    // (1,1) is wall — fail
    expect(result2.success).toBe(false);
  });

  it('mob-to-mob movement does not trigger combat', () => {
    const grid = makeGrid();
    grid.addEntity({ id: 'm1', type: 'mob', position: { x: 0, y: 2 } });
    grid.addEntity({ id: 'm2', type: 'mob', position: { x: 1, y: 2 } });
    const result = grid.moveEntity('m1', 'e');
    expect(result.success).toBe(true);
    expect(result.newPosition).toEqual({ x: 1, y: 2 });
    expect(result.events).toEqual([]);
  });

  it('returns failed result for unknown entity id', () => {
    const grid = makeGrid();
    const result = grid.moveEntity('nope', 'n');
    expect(result.success).toBe(false);
    expect(result.events).toEqual([]);
  });
});

describe('visibility', () => {
  it('getVisibleTiles returns visible positions', () => {
    const grid = new RoomGrid(makeConfig([
      '.....',
      '.....',
      '..#..',
      '.....',
      '.....',
    ]));
    const visible = grid.getVisibleTiles({ x: 2, y: 0 }, 2);
    expect(visible.length).toBeGreaterThan(0);
    for (const p of visible) {
      const dist = Math.max(Math.abs(p.x - 2), Math.abs(p.y - 0));
      expect(dist).toBeLessThanOrEqual(2);
    }
  });

  it('hasLineOfSight returns true with clear path', () => {
    const grid = new RoomGrid(makeConfig([
      '.....',
      '.....',
      '.....',
    ]));
    expect(grid.hasLineOfSight({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
  });

  it('hasLineOfSight returns false when wall blocks', () => {
    const grid = new RoomGrid(makeConfig([
      '.....',
      '..#..',
      '.....',
    ]));
    expect(grid.hasLineOfSight({ x: 2, y: 0 }, { x: 2, y: 2 })).toBe(false);
  });
});

describe('pathfinding', () => {
  it('findPath finds a path around obstacles', () => {
    const grid = new RoomGrid(makeConfig([
      '...',
      '.#.',
      '...',
    ]));
    const path = grid.findPath({ x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ x: 0, y: 0 });
    expect(path![path!.length - 1]).toEqual({ x: 2, y: 2 });
  });

  it('findPath returns null for unreachable target', () => {
    const grid = new RoomGrid(makeConfig([
      '.#.',
      '###',
      '.#.',
    ]));
    const path = grid.findPath({ x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path).toBeNull();
  });

  it('findPath respects blockedByEntities option', () => {
    const grid = new RoomGrid(makeConfig([
      '...',
      '...',
      '...',
    ]));
    grid.addEntity({ id: 'm1', type: 'mob', position: { x: 1, y: 1 } });
    const path = grid.findPath({ x: 0, y: 0 }, { x: 2, y: 2 }, { blockedByEntities: true });
    expect(path).not.toBeNull();
    const hitsEntity = path!.some(p => p.x === 1 && p.y === 1);
    expect(hitsEntity).toBe(false);
  });
});
