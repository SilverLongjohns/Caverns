// server/src/ArenaCombatManager.test.ts
import { describe, it, expect } from 'vitest';
import { ArenaCombatManager } from './ArenaCombatManager.js';
import type { TileGrid } from '@caverns/shared';
import type { MobInstance } from '@caverns/shared';
import type { CombatPlayerInfo } from './CombatManager.js';
import { hitChance, type RangedProfile } from '@caverns/shared';

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
  describe('mob targeting', () => {
    it('a taunted mob walks to the taunter and damages only the taunter', () => {
      const grid = makeGrid();
      // mob starts next to p2; the taunter p1 is a few tiles away
      const positions = { p1: { x: 1, y: 2 }, p2: { x: 5, y: 3 }, mob1: { x: 5, y: 2 } };
      const arena = new ArenaCombatManager('room1', grid, [makePlayer('p1'), makePlayer('p2')], [makeMob()], positions);
      arena.getParticipant('p1')!.buffs.push({ type: 'taunt', turnsRemaining: 2, sourcePlayerId: 'p1' });
      const { combat, path } = arena.resolveMobTurn('mob1');
      expect(path.length).toBeGreaterThan(0);
      expect(arena.getCombatManager().getPlayerHp('p2')).toBe(50);
      if (combat) expect(combat.targetId).toBe('p1');
    });

    it('falls back to normal targeting when the taunter is walled off', () => {
      const grid = makeGrid();
      // seal the taunter into the (1,1) corner
      grid.tiles[1][2] = 'wall';
      grid.tiles[2][1] = 'wall';
      const positions = { p1: { x: 1, y: 1 }, p2: { x: 5, y: 3 }, mob1: { x: 5, y: 2 } };
      const arena = new ArenaCombatManager('room1', grid, [makePlayer('p1'), makePlayer('p2')], [makeMob()], positions);
      arena.getParticipant('p1')!.buffs.push({ type: 'taunt', turnsRemaining: 2, sourcePlayerId: 'p1' });
      const { combat } = arena.resolveMobTurn('mob1');
      expect(combat?.targetId).toBe('p2');
      expect(arena.getCombatManager().getPlayerHp('p1')).toBe(50);
    });

    it('damages the player it is adjacent to, never a distant one', () => {
      for (let i = 0; i < 30; i++) {
        const grid = makeGrid();
        const positions = { p1: { x: 1, y: 1 }, p2: { x: 5, y: 3 }, mob1: { x: 5, y: 2 } };
        const arena = new ArenaCombatManager('room1', grid, [makePlayer('p1'), makePlayer('p2')], [makeMob()], positions);
        const { combat } = arena.resolveMobTurn('mob1');
        expect(combat?.targetId).toBe('p2');
        expect(arena.getCombatManager().getPlayerHp('p1')).toBe(50);
      }
    });
  });
});

const prof: RangedProfile = { shotDamage: 9, range: 3, magazine: 2, marksmanship: 2 };
const gunner = (): CombatPlayerInfo => ({ ...makePlayer(), ranged: prof });

describe('ArenaCombatManager ranged', () => {
  it('in range with LoS: ok, with the shared hit chance', () => {
    const a = new ArenaCombatManager('r', makeGrid(), [gunner()], [makeMob()], { p1: { x: 1, y: 2 }, mob1: { x: 4, y: 2 } });
    expect(a.checkShot('p1', 'mob1')).toEqual({ ok: true, distance: 3, hitChance: hitChance(3, prof.marksmanship) });
  });
  it('out of range is refused', () => {
    const a = new ArenaCombatManager('r', makeGrid(), [gunner()], [makeMob()], { p1: { x: 1, y: 2 }, mob1: { x: 5, y: 2 } });
    expect(a.checkShot('p1', 'mob1')).toMatchObject({ ok: false });
  });
  it('a wall in between blocks the shot', () => {
    const g = makeGrid(); g.tiles[2][3] = 'wall';
    const a = new ArenaCombatManager('r', g, [gunner()], [makeMob()], { p1: { x: 1, y: 2 }, mob1: { x: 4, y: 2 } });
    expect(a.checkShot('p1', 'mob1')).toMatchObject({ ok: false });
  });
  it('adjacent targets can be shot', () => {
    const a = new ArenaCombatManager('r', makeGrid(), [gunner()], [makeMob()], { p1: { x: 1, y: 2 }, mob1: { x: 2, y: 2 } });
    expect(a.checkShot('p1', 'mob1').ok).toBe(true);
  });
  it('refuses: no gun, empty, own side, dead or unknown target', () => {
    const noGun = new ArenaCombatManager('r', makeGrid(), [makePlayer()], [makeMob()], { p1: { x: 1, y: 2 }, mob1: { x: 2, y: 2 } });
    expect(noGun.checkShot('p1', 'mob1')).toMatchObject({ ok: false });
    const a = new ArenaCombatManager('r', makeGrid(), [gunner(), { ...makePlayer('p2') }], [makeMob()], { p1: { x: 1, y: 2 }, p2: { x: 1, y: 3 }, mob1: { x: 2, y: 2 } });
    expect(a.checkShot('p1', 'p2')).toMatchObject({ ok: false });
    expect(a.checkShot('p1', 'ghost')).toMatchObject({ ok: false });
    a.getCombatManager().applyDamage('mob1', 999);
    expect(a.checkShot('p1', 'mob1')).toMatchObject({ ok: false });
  });
  it('shoot rolls against hitChance with the injected rng', () => {
    const pos = { p1: { x: 1, y: 2 }, mob1: { x: 4, y: 2 } };
    const hc = hitChance(3, prof.marksmanship);
    const hitA = new ArenaCombatManager('r', makeGrid(), [gunner()], [makeMob()], pos);
    const hit = hitA.shoot('p1', 'mob1', () => hc - 0.01);
    expect(hit.ok && hit.result.hit).toBe(true);
    const missA = new ArenaCombatManager('r', makeGrid(), [gunner()], [makeMob()], pos);
    const miss = missA.shoot('p1', 'mob1', () => hc);
    expect(miss.ok && miss.result.hit).toBe(false);
    expect(miss.ok && miss.result.damage).toBe(0);
  });
  it('a refused shot spends no ammo', () => {
    const a = new ArenaCombatManager('r', makeGrid(), [gunner()], [makeMob()], { p1: { x: 1, y: 2 }, mob1: { x: 6, y: 2 } });
    expect(a.shoot('p1', 'mob1').ok).toBe(false);
    expect(a.getCombatManager().getRanged('p1')!.ammo).toBe(prof.magazine);
  });
  it('reload wraps CombatManager.reload with a reason when refused', () => {
    const a = new ArenaCombatManager('r', makeGrid(), [gunner()], [makeMob()], { p1: { x: 1, y: 2 }, mob1: { x: 2, y: 2 } });
    expect(a.reload('p1')).toMatchObject({ ok: false });
    a.shoot('p1', 'mob1', () => 0);
    expect(a.reload('p1')).toMatchObject({ ok: true, result: { action: 'reload', ammo: prof.magazine } });
  });
});

describe('ArenaCombatManager.replaceParticipantId (reconnect)', () => {
  it('moves the participant, position, turn and effects to the new id', () => {
    const grid = makeGrid();
    const arena = new ArenaCombatManager('room1', grid, [makePlayer('p1')], [makeMob()],
      { p1: { x: 1, y: 2 }, mob1: { x: 6, y: 2 } },
      new Map([['p1', []]]));
    const cm = arena.getCombatManager();
    const firstTurn = cm.getCurrentTurnId();
    arena.startTurn('p1');
    cm.getParticipant('p1')!.buffs.push({ type: 'taunt', turnsRemaining: 2, sourcePlayerId: 'p1' });

    arena.replaceParticipantId('p1', 'p1b');

    expect(arena.getPosition('p1b')).toEqual({ x: 1, y: 2 });
    expect(arena.getPosition('p1')).toBeUndefined();
    expect(arena.getTurnState('p1b')).toBeDefined();
    const p = cm.getParticipant('p1b')!;
    expect(p.id).toBe('p1b');
    expect(p.buffs[0].sourcePlayerId).toBe('p1b');
    expect(cm.getParticipant('p1')).toBeFalsy();
    expect(cm.getCurrentTurnId()).toBe(firstTurn === 'p1' ? 'p1b' : firstTurn);
    expect(cm.getState().participants.some((x) => x.id === 'p1b')).toBe(true);
  });
});
