import { describe, it, expect, vi, afterEach } from 'vitest';
import { GameSession } from './GameSession.js';
import { DRIPPING_HALLS } from '@caverns/shared';

// A fight can reach afterCombatTurn more than once after it completes (e.g. a player's
// killing blow while a mob-turn timer is still pending). Ending it twice crashed the server.
describe('GameSession combat end is idempotent', () => {
  afterEach(() => vi.useRealTimers());

  it('ends a completed fight once even if afterCombatTurn runs twice', () => {
    vi.useFakeTimers();
    const messages: any[] = [];
    const session = new GameSession((m: any) => messages.push(m), (_p: string, m: any) => messages.push(m), structuredClone(DRIPPING_HALLS));
    session.setTiming({ victoryDelayMs: 50, mobTurnDelayMs: 10, closeUpScale: 0 } as any);
    session.addPlayer('p1', 'Alice');
    session.startGame();
    const s = session as any;
    const roomId = session.getPlayerRoom('p1')!;
    const mob = { instanceId: 'm1', templateId: s.content.mobs[0].id, name: 'Rat', maxHp: 5, hp: 5, damage: 1, defense: 0, initiative: 0 };
    session.startArenaCombat(roomId, [mob]);
    const combat = s.combats.get(roomId);
    combat.applyDamage('m1', 999); // victory
    expect(combat.isComplete()).toBe(true);

    s.afterCombatTurn(roomId, combat);
    s.afterCombatTurn(roomId, combat); // late duplicate (e.g. stale mob-turn timer)
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    expect(messages.filter((m) => m.type === 'combat_end')).toHaveLength(1);
    session.dispose();
  });
});
