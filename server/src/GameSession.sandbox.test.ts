import { describe, it, expect, vi } from 'vitest';
import { resolveSetup, type ServerMessage } from '@caverns/shared';
import { GameSession } from './GameSession.js';
import { buildSandboxContent, buildSandboxMobs, buildSandboxPlayer, SANDBOX_ROOM_ID } from './sandbox/sandboxContent.js';
import { installSeededRandom } from './sandbox/seededRandom.js';

function makeSession(overrides: Record<string, unknown> = {}, onGameOver?: () => void) {
  const r = resolveSetup('duel', overrides);
  if (!r.ok) throw new Error(r.error);
  const sent: { to: string | null; msg: ServerMessage }[] = [];
  const session = new GameSession(
    (msg) => sent.push({ to: null, msg }),
    (to, msg) => sent.push({ to, msg }),
    buildSandboxContent(r.setup),
    onGameOver,
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
    const restoreRandom = installSeededRandom(12345);
    try {
      const { session, sent, setup } = makeSession();
      session.setTiming({ mobTurnDelayMs: 0 });
      session.startGame();
      session.startArenaCombat(SANDBOX_ROOM_ID, buildSandboxMobs(setup));

      // Turn order reshuffles randomly each round (see CombatManager.rollInitiativeOrder),
      // so with a 1-player-vs-1-mob duel it's not guaranteed the mob acts immediately after
      // the player. Seed the RNG and end no-op player turns until a mob turn is pending,
      // bounding the loop so a regression here fails loudly instead of hanging.
      for (let i = 0; i < 10 && session.getArenaSnapshot(SANDBOX_ROOM_ID)!.currentTurnId === 'p1'; i++) {
        session.handleArenaEndTurn('p1');
      }
      expect(session.getArenaSnapshot(SANDBOX_ROOM_ID)!.currentTurnId).toBe('tunnel_rat_0');

      const before = sent.length;
      vi.advanceTimersByTime(1); // a 600 ms default delay would not have fired yet
      expect(sent.some((s) =>
        (s.msg.type === 'arena_positions_update' && (s.msg as { moverId?: string }).moverId === 'tunnel_rat_0') ||
        (s.msg.type === 'combat_action_result' && (s.msg as { actorId?: string }).actorId === 'tunnel_rat_0')
      )).toBe(true);
      expect(sent.length).toBeGreaterThan(before);
      session.dispose();
    } finally {
      restoreRandom();
      vi.useRealTimers();
    }
  });

  it('dispose suppresses the delayed boss game_over after a victory is already scheduled', async () => {
    vi.useFakeTimers();
    try {
      let gameOverCalled = false;
      const { session, sent } = makeSession({ room: 'boss' }, () => { gameOverCalled = true; });
      session.setTiming({ mobTurnDelayMs: 0, victoryDelayMs: 0, postVictoryLootDelayMs: 5000, closeUpScale: 0 });
      session.startGame();

      // Give the mob 1 hp so a single player attack kills it and ends combat in 'victory'.
      const r = resolveSetup('duel', { room: 'boss' });
      if (!r.ok) throw new Error(r.error);
      const lowHpMobs = buildSandboxMobs(r.setup).map((m) => ({ ...m, hp: 1 }));
      session.startArenaCombat(SANDBOX_ROOM_ID, lowHpMobs);

      // Right after starting combat it is always p1's turn: either p1 went first in
      // initiative, or the mob went first and (being far away) just moved, handing the
      // turn back to p1 synchronously — see the flow in GameSession.startCombat.
      expect(session.getArenaSnapshot(SANDBOX_ROOM_ID)!.currentTurnId).toBe('p1');

      // Force the mob adjacent to the player so the attack is valid regardless of the
      // (procedurally generated, non-deterministic-in-shape) boss arena layout.
      const combat = (session as unknown as { combats: Map<string, { getPosition(id: string): { x: number; y: number } | undefined; positions: Map<string, { x: number; y: number }> }> }).combats.get(SANDBOX_ROOM_ID)!;
      const playerPos = combat.getPosition('p1')!;
      combat.positions.set('tunnel_rat_0', { x: playerPos.x + 1, y: playerPos.y });

      session.handleCombatAction('p1', 'attack', 'tunnel_rat_0');
      // Combat is now complete (mob at 0 hp); afterCombatTurn scheduled finishCombat at
      // victoryDelayMs=0. Flush it (async-aware, since the boss callback awaits
      // finalizeGracefulEnd) so finishCombat runs and schedules the boss game_over timeout
      // at postVictoryLootDelayMs=5000.
      await vi.advanceTimersByTimeAsync(0);
      expect(sent.some((s) => s.msg.type === 'combat_end')).toBe(true);
      expect(sent.some((s) => s.msg.type === 'game_over')).toBe(false);

      // Dispose before the boss game_over timeout fires. dispose() cannot cancel this raw
      // setTimeout (it isn't tracked anywhere), so the guard inside the callback itself is
      // what must suppress it.
      session.dispose();
      const before = sent.length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(sent.length).toBe(before);
      expect(sent.some((s) => s.msg.type === 'game_over')).toBe(false);
      expect(gameOverCalled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('dispose suppresses the delayed wipe game_over as well', async () => {
    let gameOverCalled = false;
    const { session, sent } = makeSession({}, () => { gameOverCalled = true; });
    session.startGame();

    // Drive the exact finishCombat('wipe') path directly: down the only player, then finish
    // combat as a wipe. finalizeWipe() resolves on the microtask queue (no real timers
    // involved here, since there's no CharacterRepository/ActiveSessionMap wired up), so
    // dispose() right after must beat that .then() callback for the guard to matter.
    (session as unknown as { playerManager: { takeDamage(id: string, amount: number): void } }).playerManager.takeDamage('p1', 9999);
    (session as unknown as { finishCombat(roomId: string, result: 'wipe'): void }).finishCombat(SANDBOX_ROOM_ID, 'wipe');
    expect(sent.some((s) => s.msg.type === 'combat_end')).toBe(true);
    expect(sent.some((s) => s.msg.type === 'game_over')).toBe(false);

    session.dispose();
    const before = sent.length;
    // Flush the microtask queue so finalizeWipe()'s .then() callback runs.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(sent.length).toBe(before);
    expect(sent.some((s) => s.msg.type === 'game_over')).toBe(false);
    expect(gameOverCalled).toBe(false);
  });
});
