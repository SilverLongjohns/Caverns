import { describe, it, expect } from 'vitest';
import type { ServerMessage } from '@caverns/shared';
import { FX_TIMING, fxExpire, fxReceive, initialBoardFx, lungeDir, type BoardFx, type FxCtx } from './boardFx.js';

const hit = (o: object) => ({ type: 'combat_action_result', actorName: 'x', action: 'attack', ...o }) as unknown as ServerMessage;
const walk = (moverId: string, steps: number) =>
  ({ type: 'arena_positions_update', positions: {}, moverId, path: Array.from({ length: steps }, (_, i) => ({ x: i, y: 0 })) }) as unknown as ServerMessage;
const ctx = (over: Partial<FxCtx> = {}): FxCtx => ({
  now: 1000,
  positions: { p1: { x: 2, y: 2 }, m1: { x: 3, y: 2 }, m2: { x: 3, y: 3 } },
  participants: [{ id: 'p1', type: 'player' }, { id: 'm1', type: 'mob' }, { id: 'm2', type: 'mob' }],
  ...over,
});
const kinds = (fx: BoardFx[]) => fx.map((f) => f.kind);

describe('lungeDir', () => {
  it('points along the dominant axis toward the target', () => {
    expect(lungeDir({ x: 2, y: 2 }, { x: 3, y: 2 })).toBe('right');
    expect(lungeDir({ x: 2, y: 2 }, { x: 1, y: 2 })).toBe('left');
    expect(lungeDir({ x: 2, y: 2 }, { x: 2, y: 5 })).toBe('down');
    expect(lungeDir({ x: 2, y: 2 }, { x: 2, y: 0 })).toBe('up');
    expect(lungeDir({ x: 2, y: 2 }, { x: 4, y: 3 })).toBe('right');
    expect(lungeDir({ x: 2, y: 2 }, { x: 2, y: 2 })).toBeNull();
  });
});

describe('fxReceive', () => {
  it('a damaging hit gives a lunge, a tear and a number', () => {
    const s = fxReceive(initialBoardFx(), hit({ actorId: 'p1', targetId: 'm1', damage: 5 }), ctx());
    expect(kinds(s.fx)).toEqual(['lunge', 'tear', 'number']);
    const [lunge, tear, num] = s.fx as [Extract<BoardFx, { kind: 'lunge' }>, Extract<BoardFx, { kind: 'tear' }>, Extract<BoardFx, { kind: 'number' }>];
    expect(lunge).toMatchObject({ unitId: 'p1', dir: 'right', delayMs: 0, until: 1000 + FX_TIMING.lungeMs });
    expect(tear).toMatchObject({ unitId: 'm1', delayMs: FX_TIMING.hitDelayMs });
    expect(num).toMatchObject({ tile: { x: 3, y: 2 }, value: 5, tone: 'mob', offset: 0, delayMs: FX_TIMING.hitDelayMs });
  });
  it('number tone: player target amber, 1 damage grey', () => {
    const onPlayer = fxReceive(initialBoardFx(), hit({ actorId: 'm1', targetId: 'p1', damage: 3 }), ctx());
    expect(onPlayer.fx.find((f) => f.kind === 'number')).toMatchObject({ tone: 'player' });
    const chip = fxReceive(initialBoardFx(), hit({ actorId: 'p1', targetId: 'm1', damage: 1 }), ctx());
    expect(chip.fx.find((f) => f.kind === 'number')).toMatchObject({ tone: 'chip' });
  });
  it('area results tear every target and show the total once, above the first target', () => {
    const s = fxReceive(initialBoardFx(), hit({ actorId: 'p1', action: 'use_ability', targetIds: ['m1', 'm2'], damage: 8 }), ctx());
    expect(s.fx.filter((f) => f.kind === 'tear').map((f) => (f as { unitId: string }).unitId)).toEqual(['m1', 'm2']);
    expect(s.fx.filter((f) => f.kind === 'number')).toEqual([expect.objectContaining({ value: 8, tile: { x: 3, y: 2 } })]);
  });
  it('no effects for non-damaging results, defend previews, or results with no target', () => {
    const base = initialBoardFx();
    for (const m of [
      hit({ actorId: 'p1', targetId: 'm1' }),
      hit({ actorId: 'm1', targetId: 'p1', pendingDamage: 4, defendQte: true }),
      hit({ actorId: 'p1', damage: 3 }),
      { type: 'combat_turn', currentTurnId: 'p1' } as unknown as ServerMessage,
    ]) expect(fxReceive(base, m, ctx()).fx).toBe(base.fx);
  });
  it('missing attacker position: no lunge; missing target position falls back to the last known tile, else no number', () => {
    const seen = fxReceive(initialBoardFx(), walk('zz', 0), ctx()); // records last known tiles
    const gone = ctx({ positions: { m1: { x: 3, y: 2 } } });
    const s1 = fxReceive(seen, hit({ actorId: 'p1', targetId: 'm1', damage: 2 }), ctx({ positions: { m1: { x: 3, y: 2 } } }));
    expect(kinds(s1.fx)).toEqual(['tear', 'number']);
    const s2 = fxReceive(seen, hit({ actorId: 'm1', targetId: 'p1', damage: 2 }), gone);
    expect(s2.fx.find((f) => f.kind === 'number')).toMatchObject({ tile: { x: 2, y: 2 } });
    const s3 = fxReceive(initialBoardFx(), hit({ actorId: 'm1', targetId: 'ghost', damage: 2 }), ctx());
    expect(s3.fx.find((f) => f.kind === 'number')).toBeUndefined();
  });
  it("a mover's effects wait behind its active walk", () => {
    const walking = fxReceive(initialBoardFx(), walk('m1', 3), ctx());
    const wait = 3 * FX_TIMING.walkStepMs + FX_TIMING.walkTailMs;
    const s = fxReceive(walking, hit({ actorId: 'm1', targetId: 'p1', damage: 3 }), ctx({ now: 1100 }));
    expect(s.fx.find((f) => f.kind === 'lunge')).toMatchObject({ delayMs: wait - 100 });
    expect(s.fx.find((f) => f.kind === 'number')).toMatchObject({ delayMs: wait - 100 + FX_TIMING.hitDelayMs });
    const later = fxReceive(walking, hit({ actorId: 'm1', targetId: 'p1', damage: 3 }), ctx({ now: 1000 + wait + 50 }));
    expect(later.fx.find((f) => f.kind === 'lunge')).toMatchObject({ delayMs: 0 });
  });
  it('numbers on the same tile are offset', () => {
    const a = fxReceive(initialBoardFx(), hit({ actorId: 'p1', targetId: 'm1', damage: 2 }), ctx());
    const b = fxReceive(a, hit({ actorId: 'p1', targetId: 'm1', damage: 3 }), ctx({ now: 1050 }));
    expect(b.fx.filter((f) => f.kind === 'number').map((f) => (f as { offset: number }).offset)).toEqual([0, 1]);
  });
});

describe('fxExpire', () => {
  it('drops finished effects and keeps the array when nothing expired', () => {
    const s = fxReceive(initialBoardFx(), hit({ actorId: 'p1', targetId: 'm1', damage: 5 }), ctx());
    expect(fxExpire(s, 1000)).toBe(s);
    expect(kinds(fxExpire(s, 1000 + FX_TIMING.lungeMs + 1).fx)).toEqual(['tear', 'number']);
    expect(fxExpire(s, 1000 + 10_000).fx).toEqual([]);
  });
});
