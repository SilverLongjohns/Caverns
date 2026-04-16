// server/src/ArenaCombatManager.test.ts
import { describe, it, expect } from 'vitest';
import { ArenaCombatManager } from './ArenaCombatManager.js';
import type { TileGrid } from '@caverns/shared';
import type { MobInstance } from '@caverns/shared';
import type { CombatPlayerInfo } from './CombatManager.js';

function makeGrid(): TileGrid {
  // 8x6 open arena — walls on border, floor inside
  const tiles: string[][] = [];
  for (let y = 0; y < 6; y++) {
    const row: string[] = [];
    for (let x = 0; x < 8; x++) {
      row.push(y === 0 || y === 5 || x === 0 || x === 7 ? 'wall' : 'floor');
    }
    tiles.push(row);
  }
  return { width: 8, height: 6, tiles };
}

function makePlayer(id: string = 'p1'): CombatPlayerInfo {
  return { id, name: 'Alice', hp: 50, maxHp: 50, damage: 10, defense: 2, initiative: 6 };
}

function makeMob(id: string = 'mob1'): MobInstance {
  return {
    instanceId: id, templateId: 'goblin', name: 'Goblin',
    maxHp: 20, hp: 20, damage: 8, defense: 2, initiative: 4,
  };
}

describe('ArenaCombatManager', () => {
  it('initializes with grid and positions', () => {
    const grid = makeGrid();
    const positions = { p1: { x: 1, y: 2 }, mob1: { x: 6, y: 2 } };
    const arena = new ArenaCombatManager('room1', grid, [makePlayer()], [makeMob()], positions);
    expect(arena.getPosition('p1')).toEqual({ x: 1, y: 2 });
    expect(arena.getPosition('mob1')).toEqual({ x: 6, y: 2 });
  });

  it('calculates movement points from initiative', () => {
    const grid = makeGrid();
    const positions = { p1: { x: 1, y: 2 }, mob1: { x: 6, y: 2 } };
    const arena = new ArenaCombatManager('room1', grid, [makePlayer()], [makeMob()], positions);
    expect(arena.getMovementPoints('p1')).toBe(5);  // floor(6/2) + 2
    expect(arena.getMovementPoints('mob1')).toBe(4); // floor(4/2) + 2
  });

  it('validates and executes a move', () => {
    const grid = makeGrid();
    const positions = { p1: { x: 1, y: 2 }, mob1: { x: 6, y: 2 } };
    const arena = new ArenaCombatManager('room1', grid, [makePlayer()], [makeMob()], positions);
    arena.startTurn('p1');
    const result = arena.handleMove('p1', { x: 3, y: 2 });
    expect(result.success).toBe(true);
    expect(arena.getPosition('p1')).toEqual({ x: 3, y: 2 });
    expect(result.movementRemaining).toBe(3); // 5 - 2 tiles
  });

  it('rejects move to impassable tile', () => {
    const grid = makeGrid();
    const positions = { p1: { x: 1, y: 1 }, mob1: { x: 6, y: 2 } };
    const arena = new ArenaCombatManager('room1', grid, [makePlayer()], [makeMob()], positions);
    arena.startTurn('p1');
    const result = arena.handleMove('p1', { x: 0, y: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects move when not enough movement points', () => {
    const grid = makeGrid();
    const positions = { p1: { x: 1, y: 1 }, mob1: { x: 6, y: 4 } };
    const arena = new ArenaCombatManager('room1', grid, [makePlayer()], [makeMob()], positions);
    arena.startTurn('p1');
    arena.handleMove('p1', { x: 6, y: 1 }); // uses all 5 MP
    const result = arena.handleMove('p1', { x: 6, y: 2 });
    expect(result.success).toBe(false);
  });

  it('validates attack requires adjacency', () => {
    const grid = makeGrid();
    const positions = { p1: { x: 1, y: 2 }, mob1: { x: 6, y: 2 } };
    const arena = new ArenaCombatManager('room1', grid, [makePlayer()], [makeMob()], positions);
    arena.startTurn('p1');
    expect(arena.validateAttack('p1', 'mob1')).toBe(false);
  });

  it('allows attack when adjacent', () => {
    const grid = makeGrid();
    const positions = { p1: { x: 5, y: 2 }, mob1: { x: 6, y: 2 } };
    const arena = new ArenaCombatManager('room1', grid, [makePlayer()], [makeMob()], positions);
    arena.startTurn('p1');
    expect(arena.validateAttack('p1', 'mob1')).toBe(true);
  });

  it('supports move-act-move pattern', () => {
    const grid = makeGrid();
    const positions = { p1: { x: 1, y: 2 }, mob1: { x: 6, y: 2 } };
    const arena = new ArenaCombatManager('room1', grid, [makePlayer()], [makeMob()], positions);
    arena.startTurn('p1');
    arena.handleMove('p1', { x: 3, y: 2 });
    expect(arena.getTurnState('p1')?.movementRemaining).toBe(3);
    arena.markActionTaken('p1');
    expect(arena.getTurnState('p1')?.actionTaken).toBe(true);
    const result = arena.handleMove('p1', { x: 4, y: 2 });
    expect(result.success).toBe(true);
    expect(result.movementRemaining).toBe(2);
  });

  it('resolves mob AI: attacks if already adjacent', () => {
    const grid = makeGrid();
    const positions = { p1: { x: 2, y: 2 }, mob1: { x: 3, y: 2 } };
    const arena = new ArenaCombatManager('room1', grid, [makePlayer()], [makeMob()], positions);
    arena.startTurn('mob1');
    const { combat: mobResult } = arena.resolveMobTurn('mob1');
    expect(mobResult).not.toBeNull();
    expect(mobResult!.action).toBe('attack');
  });

  it('mob moves toward player and attacks if it reaches adjacency', () => {
    const grid = makeGrid();
    // Mob at x=6, player at x=1, distance 5. Mob has initiative 4 -> 4 MP.
    // Mob pathfinds to (2,2) adjacent to player at (1,2) — exactly 4 steps.
    const positions = { p1: { x: 1, y: 2 }, mob1: { x: 6, y: 2 } };
    const arena = new ArenaCombatManager('room1', grid, [makePlayer()], [makeMob()], positions);
    arena.startTurn('mob1');
    const { combat: mobResult, path } = arena.resolveMobTurn('mob1');
    expect(mobResult).not.toBeNull();
    expect(mobResult!.action).toBe('attack');
    expect(path.length).toBe(4); // walked 4 steps
    const mobPos = arena.getPosition('mob1');
    expect(mobPos!.x).toBe(2); // moved to adjacency
  });

  it('mob moves toward player but cannot attack if too far', () => {
    const grid = makeGrid();
    // Use a wider grid so mob can't reach adjacency
    const wideTiles: string[][] = [];
    for (let y = 0; y < 6; y++) {
      const row: string[] = [];
      for (let x = 0; x < 12; x++) {
        row.push(y === 0 || y === 5 || x === 0 || x === 11 ? 'wall' : 'floor');
      }
      wideTiles.push(row);
    }
    const wideGrid: TileGrid = { width: 12, height: 6, tiles: wideTiles };
    // Mob at x=10, player at x=1, distance 9. Mob has 4 MP — can't reach.
    const positions = { p1: { x: 1, y: 2 }, mob1: { x: 10, y: 2 } };
    const arena = new ArenaCombatManager('room1', wideGrid, [makePlayer()], [makeMob()], positions);
    arena.startTurn('mob1');
    const { combat: mobResult, path } = arena.resolveMobTurn('mob1');
    expect(mobResult).toBeNull(); // moved but couldn't reach
    expect(path.length).toBe(4); // walked 4 steps
    const mobPos = arena.getPosition('mob1');
    expect(mobPos!.x).toBeLessThan(10);
    expect(mobPos!.x).toBe(6); // moved 4 tiles closer
  });

  it('exposes all positions for broadcasting', () => {
    const grid = makeGrid();
    const positions = { p1: { x: 1, y: 2 }, mob1: { x: 6, y: 2 } };
    const arena = new ArenaCombatManager('room1', grid, [makePlayer()], [makeMob()], positions);
    const allPos = arena.getAllPositions();
    expect(allPos).toEqual(positions);
  });

  it('identifies edge tiles for fleeing', () => {
    const grid = makeGrid();
    const positions = { p1: { x: 1, y: 1 }, mob1: { x: 6, y: 2 } };
    const arena = new ArenaCombatManager('room1', grid, [makePlayer()], [makeMob()], positions);
    expect(arena.canFlee('p1')).toBe(true);
  });

  it('cannot flee from interior tile', () => {
    const grid = makeGrid();
    const positions = { p1: { x: 3, y: 3 }, mob1: { x: 6, y: 2 } };
    const arena = new ArenaCombatManager('room1', grid, [makePlayer()], [makeMob()], positions);
    expect(arena.canFlee('p1')).toBe(false);
  });

  it('applies hazard damage when moving onto a hazard tile', () => {
    const tiles: string[][] = [];
    for (let y = 0; y < 6; y++) {
      const row: string[] = [];
      for (let x = 0; x < 8; x++) {
        row.push(y === 0 || y === 5 || x === 0 || x === 7 ? 'wall' : 'floor');
      }
      tiles.push(row);
    }
    tiles[2][3] = 'hazard';
    const grid: TileGrid = { width: 8, height: 6, tiles };

    const positions = { p1: { x: 2, y: 2 }, mob1: { x: 6, y: 2 } };
    const arena = new ArenaCombatManager('room1', grid, [makePlayer()], [makeMob()], positions);
    arena.startTurn('p1');
    const result = arena.handleMove('p1', { x: 3, y: 2 });
    expect(result.success).toBe(true);
    expect(result.hazardDamage).toBe(5);
    expect(arena.getCombatManager().getPlayerHp('p1')).toBe(45);
  });
});
