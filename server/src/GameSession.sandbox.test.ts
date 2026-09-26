import { describe, it, expect, vi } from 'vitest';
import { resolveSetup, type ServerMessage } from '@caverns/shared';
import { GameSession } from './GameSession.js';
import { buildSandboxContent, buildSandboxMobs, buildSandboxPlayer, SANDBOX_ROOM_ID } from './sandbox/sandboxContent.js';

function makeSession() {
  const r = resolveSetup('duel');
  if (!r.ok) throw new Error(r.error);
  const sent: { to: string | null; msg: ServerMessage }[] = [];
  const session = new GameSession(
    (msg) => sent.push({ to: null, msg }),
    (to, msg) => sent.push({ to, msg }),
    buildSandboxContent(r.setup),
  );
  session.addPrebuiltPlayer(buildSandboxPlayer('p1', r.setup.party[0], SANDBOX_ROOM_ID));
  return { session, sent, setup: r.setup };
}

describe('GameSession sandbox hooks', () => {
  it('starts arena combat directly and exposes a snapshot', () => {
    const { session, sent, setup } = makeSession();
    session.startGame();
    expect(sent.some((s) => s.to === 'p1' && s.msg.type === 'game_start')).toBe(true);

    session.startArenaCombat(SANDBOX_ROOM_ID, buildSandboxMobs(setup));
    expect(sent.some((s) => s.to === 'p1' && s.msg.type === 'arena_combat_start')).toBe(true);

    const snap = session.getArenaSnapshot(SANDBOX_ROOM_ID)!;
    expect(snap).not.toBeNull();
    expect(snap.participants.map((p) => p.id).sort()).toEqual(['p1', 'tunnel_rat_0']);
    expect(snap.positions.p1).toBeDefined();
    expect(snap.grid.width).toBe(30); // tunnel
    session.dispose();
  });

  it('dispose stops pending mob turns from emitting', () => {
    vi.useFakeTimers();
    try {
      const { session, sent, setup } = makeSession();
      session.startGame();
      session.startArenaCombat(SANDBOX_ROOM_ID, buildSandboxMobs(setup));
      session.dispose();
      const before = sent.length;
      vi.advanceTimersByTime(60_000);
      expect(sent.length).toBe(before);
      expect(session.getArenaSnapshot(SANDBOX_ROOM_ID)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('setTiming overrides the mob turn delay', () => {
    vi.useFakeTimers();
    try {
      const { session, sent, setup } = makeSession();
      session.setTiming({ mobTurnDelayMs: 0 });
      session.startGame();
      session.startArenaCombat(SANDBOX_ROOM_ID, buildSandboxMobs(setup));
      const snap = session.getArenaSnapshot(SANDBOX_ROOM_ID)!;
      if (snap.currentTurnId === 'p1') session.handleArenaEndTurn('p1');
      const before = sent.length;
      vi.advanceTimersByTime(1); // a 600 ms default delay would not have fired yet
      expect(sent.length).toBeGreaterThan(before);
      session.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
