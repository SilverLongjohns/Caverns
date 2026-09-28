import { describe, it, expect } from 'vitest';
import type { TileGrid } from '@caverns/shared';
import type { ArenaSnapshot } from '../GameSession.js';
import { isAdjacent } from '../arenaMovement.js';
import { decideTurn } from './autoPlayer.js';

function grid(rows: string[]): TileGrid {
  return {
    width: rows[0].length,
    height: rows.length,
    tiles: rows.map((r) => [...r].map((c) => (c === '#' ? 'wall' : 'floor'))),
  };
}

const OPEN = grid([
  '########',
  '#......#',
  '#......#',
  '#......#',
  '#......#',
  '########',
]);

function snap(partial: Partial<ArenaSnapshot>): ArenaSnapshot {
  return {
    grid: OPEN, positions: {}, participants: [], currentTurnId: 'p1',
    roundNumber: 1, movementRemaining: 5, ...partial,
  };
}

const P1 = { id: 'p1', type: 'player' as const, hp: 50 };

describe('decideTurn', () => {
  it('attacks the weakest adjacent enemy', () => {
    const actions = decideTurn(snap({
      positions: { p1: { x: 2, y: 2 }, m1: { x: 3, y: 2 }, m2: { x: 2, y: 3 } },
      participants: [P1, { id: 'm1', type: 'mob', hp: 20 }, { id: 'm2', type: 'mob', hp: 5 }],
    }), 'p1');
    expect(actions).toEqual([{ type: 'attack', targetId: 'm2' }, { type: 'end_turn' }]);
  });

  it('moves next to a reachable enemy, then attacks', () => {
    const s = snap({
      positions: { p1: { x: 1, y: 1 }, m1: { x: 5, y: 1 } },
      participants: [P1, { id: 'm1', type: 'mob', hp: 20 }],
    });
    const actions = decideTurn(s, 'p1');
    expect(actions[0].type).toBe('move');
    const dest = actions[0] as { x: number; y: number };
    expect(isAdjacent(dest, { x: 5, y: 1 })).toBe(true);
    expect(actions.slice(1)).toEqual([{ type: 'attack', targetId: 'm1' }, { type: 'end_turn' }]);
  });

  it('moves closer when no enemy is reachable this turn', () => {
    const actions = decideTurn(snap({
      movementRemaining: 1,
      positions: { p1: { x: 1, y: 1 }, m1: { x: 6, y: 4 } },
      participants: [P1, { id: 'm1', type: 'mob', hp: 20 }],
    }), 'p1');
    expect(actions).toHaveLength(2);
    expect(actions[0].type).toBe('move');
    const dest = actions[0] as { x: number; y: number };
    expect(Math.abs(dest.x - 6) + Math.abs(dest.y - 4)).toBeLessThan(5 + 3);
    expect(actions[1]).toEqual({ type: 'end_turn' });
  });

  it('mobs target players', () => {
    const actions = decideTurn(snap({
      currentTurnId: 'm1',
      positions: { p1: { x: 2, y: 2 }, m1: { x: 3, y: 2 } },
      participants: [P1, { id: 'm1', type: 'mob', hp: 20 }],
    }), 'm1');
    expect(actions[0]).toEqual({ type: 'attack', targetId: 'p1' });
  });

  it('ends the turn when fully blocked', () => {
    const walled = grid([
      '#####',
      '#.#.#',
      '#####',
    ]);
    const actions = decideTurn(snap({
      grid: walled,
      positions: { p1: { x: 1, y: 1 }, m1: { x: 3, y: 1 } },
      participants: [P1, { id: 'm1', type: 'mob', hp: 20 }],
    }), 'p1');
    expect(actions).toEqual([{ type: 'end_turn' }]);
  });

  it('ends the turn when there are no enemies', () => {
    expect(decideTurn(snap({ positions: { p1: { x: 1, y: 1 } }, participants: [P1] }), 'p1'))
      .toEqual([{ type: 'end_turn' }]);
  });

  it('does not move through occupied allies to reach enemies', () => {
    const corridor = grid([
      '#######',
      '#.....#',
      '#######',
    ]);
    const actions = decideTurn(snap({
      grid: corridor,
      movementRemaining: 5,
      positions: { p1: { x: 1, y: 1 }, p2: { x: 2, y: 1 }, m1: { x: 5, y: 1 } },
      participants: [P1, { id: 'p2', type: 'player', hp: 30 }, { id: 'm1', type: 'mob', hp: 20 }],
    }), 'p1');
    expect(actions).toEqual([{ type: 'end_turn' }]);
  });
});

const rangedGrid = { width: 10, height: 5, tiles: Array.from({ length: 5 }, () => Array(10).fill('floor')) };
const snapOf = (ranged: { ammo: number; magazine: number; range: number; marksmanship: number } | undefined, mobX: number) => ({
  grid: rangedGrid, currentTurnId: 'p1', roundNumber: 1, movementRemaining: 0,
  positions: { p1: { x: 1, y: 2 }, m1: { x: mobX, y: 2 } },
  participants: [{ id: 'p1', type: 'player' as const, hp: 50, ranged }, { id: 'm1', type: 'mob' as const, hp: 10 }],
});
describe('bot ranged', () => {
  it('shoots a non-adjacent enemy in range when loaded', () => {
    expect(decideTurn(snapOf({ ammo: 2, magazine: 2, range: 5, marksmanship: 2 }, 4), 'p1')[0]).toEqual({ type: 'shoot', targetId: 'm1' });
  });
  it('still melees an adjacent enemy', () => {
    expect(decideTurn(snapOf({ ammo: 2, magazine: 2, range: 5, marksmanship: 2 }, 2), 'p1')[0]).toEqual({ type: 'attack', targetId: 'm1' });
  });
  it('reloads when empty and nothing is adjacent', () => {
    expect(decideTurn(snapOf({ ammo: 0, magazine: 2, range: 5, marksmanship: 2 }, 4), 'p1')[0]).toEqual({ type: 'reload' });
  });
  it('mobs (no ranged) keep the old behaviour', () => {
    expect(decideTurn(snapOf(undefined, 4), 'p1').some((a) => a.type === 'shoot' || a.type === 'reload')).toBe(false);
  });
});
