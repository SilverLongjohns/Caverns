import { describe, it, expect, vi } from 'vitest';
import { resolveSetup, CLOSE_UP_CONFIG, CLASS_DEFINITIONS, getClassDefinition, type ServerMessage, type SandboxOverrides } from '@caverns/shared';
import { GameSession } from './GameSession.js';
import { buildSandboxContent, buildSandboxMobs, buildSandboxPlayer, SANDBOX_ROOM_ID } from './sandbox/sandboxContent.js';
import { installSeededRandom } from './sandbox/seededRandom.js';

const MOB_DELAY = 100;

function setup(overrides: SandboxOverrides = {}) {
  const r = resolveSetup('duel', overrides);
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
  // p1's prompt may still be held behind a close-up (e.g. the mob's strike); actions are refused until it is sent
  vi.advanceTimersByTime(Math.max(CLOSE_UP_CONFIG.abilityMs, CLOSE_UP_CONFIG.critMs, CLOSE_UP_CONFIG.killMs, CLOSE_UP_CONFIG.shotMs) + 100);
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

/** End p1's turns until a mob stands next to p1 (the duel mob walks in), then stop on p1's turn. */
function closeIn(session: GameSession) {
  const near = () => {
    const s = session.getArenaSnapshot(SANDBOX_ROOM_ID)!;
    const m = s.participants.find((p) => p.type === 'mob')!;
    const a = s.positions.p1, b = s.positions[m.id];
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 1;
  };
  for (let i = 0; i < 20 && !near(); i++) { toPlayerTurn(session); session.handleArenaEndTurn('p1'); }
  toPlayerTurn(session);
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
  it('accepts no player action before the delayed turn prompt is sent', () => {
    vi.useFakeTimers();
    let found = false;
    for (let seed = 1; seed <= 300 && !found; seed++) {
      const restore = installSeededRandom(seed);
      try {
        const { session, sent, className } = setup();
        toPlayerTurn(session);
        session.handleUseAbility('p1', selfAbility(className).id);
        // Only the case where p1's close-up is followed straight away by p1's own next turn
        if (session.getArenaSnapshot(SANDBOX_ROOM_ID)?.currentTurnId !== 'p1') { session.dispose(); continue; }
        found = true;
        const before = sent.length;
        session.handleArenaEndTurn('p1'); // clicked during the close-up, before any prompt arrived
        expect(session.getArenaSnapshot(SANDBOX_ROOM_ID)!.currentTurnId).toBe('p1');
        vi.advanceTimersByTime(CLOSE_UP_CONFIG.abilityMs + 50);
        const prompts = sent.slice(before).filter((m) => m.type === 'combat_turn');
        expect(prompts).toHaveLength(1);
        expect((prompts[0] as { currentTurnId: string }).currentTurnId).toBe('p1');
        session.dispose();
      } finally { restore(); }
    }
    vi.useRealTimers();
    expect(found, 'no seed produced back-to-back p1 turns').toBe(true);
  });
  it('arms the AFK skip for a disconnected player only after the close-up', () => {
    vi.useFakeTimers();
    let found = false;
    for (let seed = 1; seed <= 300 && !found; seed++) {
      const restore = installSeededRandom(seed);
      try {
        const { session, sent, className } = setup();
        toPlayerTurn(session);
        session.markDisconnected('p1');
        session.handleUseAbility('p1', selfAbility(className).id);
        if (session.getArenaSnapshot(SANDBOX_ROOM_ID)?.currentTurnId !== 'p1') { session.dispose(); continue; }
        found = true;
        const skipped = () => sent.some((m) => m.type === 'text_log' && /AFK/.test((m as { message: string }).message));
        vi.advanceTimersByTime(CLOSE_UP_CONFIG.abilityMs + 10_000 - 100);
        expect(skipped()).toBe(false);
        vi.advanceTimersByTime(200);
        expect(skipped()).toBe(true);
        session.dispose();
      } finally { restore(); }
    }
    vi.useRealTimers();
    expect(found, 'no seed produced back-to-back p1 turns').toBe(true);
  });

  it('area ability results list every target hit', () => {
    vi.useFakeTimers();
    const restore = installSeededRandom(4242);
    try {
      // Data-driven: any class with a non-passive enemy-area ability
      const cls = CLASS_DEFINITIONS.find((c) => c.abilities.some((a) => !a.passive && a.targetType === 'area_enemy'));
      expect(cls, 'data needs an area_enemy ability for this test').toBeDefined();
      const ability = cls!.abilities.find((a) => !a.passive && a.targetType === 'area_enemy')!;
      const { session, sent } = setup({ party: [cls!.id] });
      closeIn(session); // let the mob close in so the cast is in range
      const snap = session.getArenaSnapshot(SANDBOX_ROOM_ID)!;
      const mob = snap.participants.find((p) => p.type === 'mob')!;
      const before = sent.length;
      const pos = snap.positions[mob.id];
      session.handleUseAbility('p1', ability.id, undefined, pos.x, pos.y);
      const result = sent.slice(before).find((m) => m.type === 'combat_action_result') as { targetIds?: string[]; downedIds?: string[] } | undefined;
      expect(result, JSON.stringify(sent.slice(before).filter((m) => m.type === 'error'))).toBeDefined();
      expect(result!.targetIds).toContain(mob.id);
      expect(Array.isArray(result!.downedIds)).toBe(true);
      session.dispose();
    } finally { restore(); vi.useRealTimers(); }
  });

  it('delays combat_end after a mob kills the last player by the kill close-up', () => {
    vi.useFakeTimers();
    const restore = installSeededRandom(4242);
    try {
      const { session, sent } = setup();
      // test-only: leave the player one hit from death
      (session as unknown as { combats: Map<string, { getParticipant(id: string): { hp: number } }> })
        .combats.get(SANDBOX_ROOM_ID)!.getParticipant('p1').hp = 1;
      let killAt = -1;
      for (let t = 0; t < 60_000 && killAt < 0; t += 25) {
        if (session.getArenaSnapshot(SANDBOX_ROOM_ID)?.currentTurnId === 'p1') session.handleArenaEndTurn('p1');
        killAt = sent.findIndex((m) => m.type === 'combat_action_result' && (m as { targetDowned?: boolean }).targetDowned);
        if (killAt < 0) vi.advanceTimersByTime(25);
      }
      expect(killAt).toBeGreaterThanOrEqual(0);
      const ended = () => sent.slice(killAt).some((m) => m.type === 'combat_end');
      vi.advanceTimersByTime(CLOSE_UP_CONFIG.killMs - 100);
      expect(ended()).toBe(false);
      vi.advanceTimersByTime(200);
      expect(ended()).toBe(true);
      session.dispose();
    } finally { restore(); vi.useRealTimers(); }
  });
  it('an ordinary attack delays the next turn by the strike close-up', () => {
    vi.useFakeTimers();
    const restore = installSeededRandom(4242);
    try {
      const { session, sent } = setup();
      const mobId = session.getArenaSnapshot(SANDBOX_ROOM_ID)!.participants.find((p) => p.type === 'mob')!.id;
      // test-only: the attack must not kill (a kill would be a longer kill close-up)
      (session as unknown as { combats: Map<string, { getParticipant(id: string): { hp: number } }> })
        .combats.get(SANDBOX_ROOM_ID)!.getParticipant(mobId).hp = 9999;
      closeIn(session);
      const before = sent.length;
      session.handleCombatAction('p1', 'attack', mobId);
      expect(sent.slice(before).some((m) => m.type === 'combat_action_result')).toBe(true);
      const ms = msUntilNextAction(sent, before);
      expect(ms).toBeGreaterThanOrEqual(CLOSE_UP_CONFIG.strikeMs + MOB_DELAY);
      session.dispose();
    } finally { restore(); vi.useRealTimers(); }
  });

  it('a shot holds the next turn for the shot-length strike close-up (or the kill close-up if it downs the target)', () => {
    vi.useFakeTimers();
    const restore = installSeededRandom(4242);
    try {
      const { session, sent } = setup();
      closeIn(session);
      const mob = session.getArenaSnapshot(SANDBOX_ROOM_ID)!.participants.find((p) => p.type === 'mob')!;
      const before = sent.length;
      session.handleRangedAction('p1', 'shoot', mob.id);
      const res = sent.slice(before).find((m) => m.type === 'combat_action_result') as { targetDowned?: boolean };
      const expected = res?.targetDowned ? Math.max(CLOSE_UP_CONFIG.killMs, CLOSE_UP_CONFIG.shotMs) : CLOSE_UP_CONFIG.shotMs;
      expect(msUntilNextAction(sent, before)).toBeGreaterThanOrEqual(expected);
      session.dispose();
    } finally { restore(); vi.useRealTimers(); }
  });
});
