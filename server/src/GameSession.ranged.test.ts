import { describe, it, expect, vi } from 'vitest';
import { resolveSetup, CLOSE_UP_CONFIG, type ServerMessage, type SandboxOverrides } from '@caverns/shared';
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
  vi.advanceTimersByTime(Math.max(CLOSE_UP_CONFIG.abilityMs, CLOSE_UP_CONFIG.critMs, CLOSE_UP_CONFIG.killMs) + 100);
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

const results = (sent: ServerMessage[], from: number) =>
  sent.slice(from).filter((m) => m.type === 'combat_action_result') as Extract<ServerMessage, { type: 'combat_action_result' }>[];
const errors = (sent: ServerMessage[], from: number) => sent.slice(from).filter((m) => m.type === 'error');

describe('GameSession ranged actions', () => {
  it('the duel player enters combat loaded (starter gun)', () => {
    vi.useFakeTimers(); const restore = installSeededRandom(4242);
    try {
      const { session } = setup();
      const cm = (session as unknown as { combats: Map<string, { getCombatManager(): { getRanged(id: string): unknown } }> }).combats.get(SANDBOX_ROOM_ID)!;
      expect(cm.getCombatManager().getRanged('p1')).toMatchObject({ ammo: expect.any(Number) });
      session.dispose();
    } finally { restore(); vi.useRealTimers(); }
  });

  it('shoot (in reach) broadcasts a shoot result and ends the turn', () => {
    vi.useFakeTimers(); const restore = installSeededRandom(4242);
    try {
      const { session, sent } = setup();
      closeIn(session);
      const mob = session.getArenaSnapshot(SANDBOX_ROOM_ID)!.participants.find((p) => p.type === 'mob')!;
      const before = sent.length;
      session.handleRangedAction('p1', 'shoot', mob.id);
      const r = results(sent, before);
      expect(r[0]).toMatchObject({ action: 'shoot', actorId: 'p1', targetId: mob.id, hit: expect.any(Boolean) });
      expect(session.getArenaSnapshot(SANDBOX_ROOM_ID)!.currentTurnId).not.toBe('p1');
      session.dispose();
    } finally { restore(); vi.useRealTimers(); }
  });

  it('reload when full is refused with an error and does not end the turn', () => {
    vi.useFakeTimers(); const restore = installSeededRandom(4242);
    try {
      const { session, sent } = setup();
      toPlayerTurn(session);
      const before = sent.length;
      session.handleRangedAction('p1', 'reload');
      expect(errors(sent, before).length).toBe(1);
      expect(session.getArenaSnapshot(SANDBOX_ROOM_ID)!.currentTurnId).toBe('p1');
      session.dispose();
    } finally { restore(); vi.useRealTimers(); }
  });

  it('no gun: shoot and reload are refused without consuming the turn', () => {
    vi.useFakeTimers(); const restore = installSeededRandom(4242);
    try {
      const r = resolveSetup('duel', {});
      if (!r.ok) throw new Error(r.error);
      const sent: ServerMessage[] = [];
      const session = new GameSession((m) => sent.push(m), (_t, m) => sent.push(m), buildSandboxContent(r.setup));
      const p = buildSandboxPlayer('p1', r.setup.party[0], SANDBOX_ROOM_ID);
      p.equipment.ranged = null;
      session.addPrebuiltPlayer(p);
      session.setTiming({ mobTurnDelayMs: MOB_DELAY });
      session.startGame();
      session.startArenaCombat(SANDBOX_ROOM_ID, buildSandboxMobs(r.setup));
      toPlayerTurn(session);
      const mob = session.getArenaSnapshot(SANDBOX_ROOM_ID)!.participants.find((x) => x.type === 'mob')!;
      const before = sent.length;
      session.handleRangedAction('p1', 'shoot', mob.id);
      session.handleRangedAction('p1', 'reload');
      expect(errors(sent, before).length).toBe(2);
      expect(results(sent, before).length).toBe(0);
      expect(session.getArenaSnapshot(SANDBOX_ROOM_ID)!.currentTurnId).toBe('p1');
      session.dispose();
    } finally { restore(); vi.useRealTimers(); }
  });

  it('shoot then reload restores the magazine', () => {
    vi.useFakeTimers(); const restore = installSeededRandom(4242);
    try {
      const { session, sent } = setup();
      closeIn(session);
      const mob = session.getArenaSnapshot(SANDBOX_ROOM_ID)!.participants.find((p) => p.type === 'mob')!;
      session.handleRangedAction('p1', 'shoot', mob.id);
      toPlayerTurn(session);
      const before = sent.length;
      session.handleRangedAction('p1', 'reload');
      const r = results(sent, before);
      const magazine = (session as unknown as {
        combats: Map<string, { getCombatManager(): { getRanged(id: string): { profile: { magazine: number } } | null } }>;
      }).combats.get(SANDBOX_ROOM_ID)!.getCombatManager().getRanged('p1')!.profile.magazine;
      expect(r[0]).toMatchObject({ action: 'reload', actorId: 'p1' });
      expect(r[0].ammo).toBe(magazine);
      session.dispose();
    } finally { restore(); vi.useRealTimers(); }
  });
});
