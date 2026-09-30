import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveSetup, CLOSE_UP_CONFIG, CLASS_DEFINITIONS, teleportEffectOf, teleportDestinations, type ServerMessage, type SandboxOverrides } from '@caverns/shared';
import { TILE_PROPERTIES, type TileType } from '@caverns/roomgrid';
import { GameSession } from './GameSession.js';
import { buildSandboxContent, buildSandboxMobs, buildSandboxPlayer, SANDBOX_ROOM_ID } from './sandbox/sandboxContent.js';
import { installSeededRandom } from './sandbox/seededRandom.js';

// Data-driven: any class with a free-action tile teleport.
const cls = CLASS_DEFINITIONS.find((c) => c.abilities.some((a) => !a.passive && a.targetType === 'tile' && a.freeAction && teleportEffectOf(a)));
const ability = cls?.abilities.find((a) => !a.passive && a.targetType === 'tile' && a.freeAction && teleportEffectOf(a));

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; vi.useRealTimers(); });

function setup(overrides: SandboxOverrides = {}) {
  vi.useFakeTimers();
  restore = installSeededRandom(4242);
  const r = resolveSetup('duel', { party: [cls!.id], ...overrides });
  if (!r.ok) throw new Error(r.error);
  const sent: ServerMessage[] = [];
  const session = new GameSession((m) => sent.push(m), (_to, m) => sent.push(m), buildSandboxContent(r.setup));
  session.addPrebuiltPlayer(buildSandboxPlayer('p1', r.setup.party[0], SANDBOX_ROOM_ID));
  session.setTiming({ mobTurnDelayMs: 100 });
  session.startGame();
  session.startArenaCombat(SANDBOX_ROOM_ID, buildSandboxMobs(r.setup));
  for (let i = 0; i < 200 && session.getArenaSnapshot(SANDBOX_ROOM_ID)!.currentTurnId !== 'p1'; i++) vi.advanceTimersByTime(50);
  vi.advanceTimersByTime(Math.max(CLOSE_UP_CONFIG.abilityMs, CLOSE_UP_CONFIG.critMs, CLOSE_UP_CONFIG.killMs, CLOSE_UP_CONFIG.shotMs) + 100);
  expect(session.getArenaSnapshot(SANDBOX_ROOM_ID)!.currentTurnId).toBe('p1');
  return { session, sent };
}

type Internals = { combats: Map<string, { getParticipant(id: string): { hp: number; initiative: number }; getGrid(): { tiles: string[][] }; getTurnState(id: string): { actionTaken: boolean; freeActionsUsed: Set<string> } }> };
const combatOf = (s: GameSession) => (s as unknown as Internals).combats.get(SANDBOX_ROOM_ID)!;
const walkable = (t: string) => TILE_PROPERTIES[t as TileType]?.walkable ?? false;
const playerOf = (s: GameSession) =>
  (s as unknown as { playerManager: { getPlayer(id: string): { energy: number } } }).playerManager.getPlayer('p1');

function destinations(session: GameSession) {
  const snap = session.getArenaSnapshot(SANDBOX_ROOM_ID)!;
  const occupied = new Set(Object.entries(snap.positions).filter(([id]) => id !== 'p1').map(([, p]) => `${p.x},${p.y}`));
  return teleportDestinations({
    grid: snap.grid, from: snap.positions.p1, effect: teleportEffectOf(ability!)!,
    initiative: combatOf(session).getParticipant('p1').initiative, occupied, isWalkable: walkable,
  });
}

describe('tile teleport abilities', () => {
  it('data has a free-action tile teleport to test', () => {
    expect(ability, 'classes.json needs a free-action tile teleport ability').toBeDefined();
  });

  it('teleports, spends energy, and keeps the turn going', () => {
    const { session, sent } = setup();
    const to = destinations(session).find((t) => combatOf(session).getGrid().tiles[t.y][t.x] !== 'hazard')!;
    const from = session.getArenaSnapshot(SANDBOX_ROOM_ID)!.positions.p1;
    const energy0 = playerOf(session).energy;
    const before = sent.length;
    session.handleUseAbility('p1', ability!.id, undefined, to.x, to.y);
    const out = sent.slice(before);
    expect(out.filter((m) => m.type === 'error')).toEqual([]);
    expect(playerOf(session).energy).toBe(energy0 - ability!.energyCost);
    expect(session.getArenaSnapshot(SANDBOX_ROOM_ID)!.positions.p1).toEqual(to);
    const result = out.find((m) => m.type === 'combat_action_result') as { teleportFrom?: unknown; teleportTo?: unknown; abilityId?: string };
    expect(result).toMatchObject({ abilityId: ability!.id, teleportFrom: from, teleportTo: to });
    vi.advanceTimersByTime(5000);
    expect(session.getArenaSnapshot(SANDBOX_ROOM_ID)!.currentTurnId).toBe('p1');
    expect(combatOf(session).getTurnState('p1').actionTaken).toBe(false);
    session.dispose();
  });

  it('refuses a second use in the same turn', () => {
    const { session, sent } = setup();
    const [a] = destinations(session);
    session.handleUseAbility('p1', ability!.id, undefined, a.x, a.y);
    const [b] = destinations(session);
    const before = sent.length;
    session.handleUseAbility('p1', ability!.id, undefined, b.x, b.y);
    expect(sent.slice(before).some((m) => m.type === 'error')).toBe(true);
    expect(session.getArenaSnapshot(SANDBOX_ROOM_ID)!.positions.p1).toEqual(a);
    session.dispose();
  });

  it('still works after the turn\'s action is taken', () => {
    const { session, sent } = setup();
    combatOf(session).getTurnState('p1').actionTaken = true; // test-only: as if the player had already attacked
    const [to] = destinations(session);
    const before = sent.length;
    session.handleUseAbility('p1', ability!.id, undefined, to.x, to.y);
    expect(sent.slice(before).filter((m) => m.type === 'error')).toEqual([]);
    expect(session.getArenaSnapshot(SANDBOX_ROOM_ID)!.positions.p1).toEqual(to);
    session.dispose();
  });

  it('rejects an invalid tile without spending energy or the use', () => {
    const { session, sent } = setup();
    const from = session.getArenaSnapshot(SANDBOX_ROOM_ID)!.positions.p1;
    const before = sent.length;
    session.handleUseAbility('p1', ability!.id, undefined, from.x, from.y); // own tile is never valid
    const out = sent.slice(before);
    expect(out.some((m) => m.type === 'error')).toBe(true);
    expect(out.some((m) => m.type === 'player_update')).toBe(false);
    expect(combatOf(session).getTurnState('p1').freeActionsUsed.has(ability!.id)).toBe(false);
    session.dispose();
  });

  it('refuses without enough energy', () => {
    const { session, sent } = setup();
    playerOf(session).energy = ability!.energyCost - 1;
    const [to] = destinations(session);
    const before = sent.length;
    session.handleUseAbility('p1', ability!.id, undefined, to.x, to.y);
    expect(sent.slice(before).some((m) => m.type === 'error')).toBe(true);
    session.dispose();
  });

  it('a hazard landing that downs the caster ends their turn', () => {
    const { session, sent } = setup();
    const combat = combatOf(session);
    const [to] = destinations(session);
    combat.getGrid().tiles[to.y][to.x] = 'hazard'; // test-only terrain edit
    combat.getParticipant('p1').hp = 1;
    const before = sent.length;
    session.handleUseAbility('p1', ability!.id, undefined, to.x, to.y);
    const result = sent.slice(before).find((m) => m.type === 'combat_action_result') as { actorDowned?: boolean; actorHp?: number };
    expect(result.actorDowned).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(session.getArenaSnapshot(SANDBOX_ROOM_ID)?.currentTurnId ?? null).not.toBe('p1');
    session.dispose();
  });
});
