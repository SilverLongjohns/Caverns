import { describe, it, expect, vi } from 'vitest';
import { resolveSetup, CLOSE_UP_CONFIG, getClassDefinition, type ServerMessage } from '@caverns/shared';
import { GameSession } from './GameSession.js';
import { buildSandboxContent, buildSandboxMobs, buildSandboxPlayer, SANDBOX_ROOM_ID } from './sandbox/sandboxContent.js';
import { installSeededRandom } from './sandbox/seededRandom.js';

const MOB_DELAY = 100;

function setup() {
  const r = resolveSetup('duel', {});
  if (!r.ok) throw new Error(r.error);
  const sent: ServerMessage[] = [];
  const session = new GameSession((m) => sent.push(m), (_to, m) => sent.push(m), buildSandboxContent(r.setup));
  session.addPrebuiltPlayer(buildSandboxPlayer('p1', r.setup.party[0], SANDBOX_ROOM_ID));
  session.setTiming({ mobTurnDelayMs: MOB_DELAY });
  session.startGame();
  session.startArenaCombat(SANDBOX_ROOM_ID, buildSandboxMobs(r.setup));
  return { session, sent, className: r.setup.party[0].className as string };
}

/** Let mob turns play out (fake timers) until it's p1's turn. */
function toPlayerTurn(session: GameSession) {
  for (let i = 0; i < 200 && session.getArenaSnapshot(SANDBOX_ROOM_ID)!.currentTurnId !== 'p1'; i++) vi.advanceTimersByTime(50);
  expect(session.getArenaSnapshot(SANDBOX_ROOM_ID)!.currentTurnId).toBe('p1');
}

/** Data-driven: the first non-passive self-target ability of the duel player's class. */
function selfAbility(className: string) {
  const a = getClassDefinition(className)!.abilities.find((x) => !x.passive && x.targetType === 'none');
  expect(a, `class ${className} needs a self-target ability for this test`).toBeDefined();
  return a!;
}

const isNextAction = (m: ServerMessage) =>
  m.type === 'combat_turn' || (m.type === 'combat_action_result' && (m as { actorId?: string }).actorId !== 'p1')
  || (m.type === 'arena_positions_update' && !!(m as { moverId?: string }).moverId && (m as { moverId?: string }).moverId !== 'p1');

/** Advance fake time in small steps; return ms elapsed until the next turn's first message (or -1). */
function msUntilNextAction(sent: ServerMessage[], from: number, maxMs = 6000, step = 25): number {
  for (let t = 0; t <= maxMs; t += step) {
    if (sent.slice(from).some(isNextAction)) return t;
    vi.advanceTimersByTime(step);
  }
  return -1;
}

describe('close-up pacing', () => {
  it('delays the next turn by the close-up duration after a qualifying ability', () => {
    vi.useFakeTimers();
    const restore = installSeededRandom(4242);
    try {
      const { session, sent, className } = setup();
      toPlayerTurn(session);
      const before = sent.length;
      session.handleUseAbility('p1', selfAbility(className).id);
      const ms = msUntilNextAction(sent, before);
      expect(ms).toBeGreaterThanOrEqual(CLOSE_UP_CONFIG.abilityMs + MOB_DELAY);
      session.dispose();
    } finally { restore(); vi.useRealTimers(); }
  });

  it('adds no delay when closeUpScale is 0 (simulations)', () => {
    vi.useFakeTimers();
    const restore = installSeededRandom(4242);
    try {
      const { session, sent, className } = setup();
      session.setTiming({ closeUpScale: 0 });
      toPlayerTurn(session);
      const before = sent.length;
      session.handleUseAbility('p1', selfAbility(className).id);
      const ms = msUntilNextAction(sent, before);
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThan(500);
      session.dispose();
    } finally { restore(); vi.useRealTimers(); }
  });

  it('adds no delay for results that do not qualify (end turn)', () => {
    vi.useFakeTimers();
    const restore = installSeededRandom(4242);
    try {
      const { session, sent } = setup();
      toPlayerTurn(session);
      const before = sent.length;
      session.handleArenaEndTurn('p1');
      const ms = msUntilNextAction(sent, before);
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThan(500);
      session.dispose();
    } finally { restore(); vi.useRealTimers(); }
  });
});
