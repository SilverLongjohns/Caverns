import { describe, it, expect } from 'vitest';
import { GameSession } from './GameSession.js';
import { ArenaCombatManager } from './ArenaCombatManager.js';

// A reload mid-run reattaches the new connection; the client only enters the
// dungeon view on game_start, so reattach must resend a full snapshot.
describe('GameSession.reattachConnection', () => {
  function createSession() {
    const messages: { playerId: string; msg: any }[] = [];
    const session = new GameSession(
      (msg: any) => messages.push({ playerId: '__broadcast__', msg }),
      (playerId: string, msg: any) => messages.push({ playerId, msg }),
    );
    session.addPlayer('p1', 'Alice');
    session.addPlayer('p2', 'Bob');
    session.startGame();
    messages.length = 0;
    return { session, messages };
  }

  it('sends the new connection a game_start snapshot keyed by its new id', () => {
    const { session, messages } = createSession();
    const roomId = session.getPlayerRoom('p1')!;
    expect(session.reattachConnection('p1', 'p1b')).toBe(true);

    const start = messages.find((m) => m.playerId === 'p1b' && m.msg.type === 'game_start')?.msg;
    expect(start).toBeDefined();
    expect(start.playerId).toBe('p1b');
    expect(start.currentRoomId).toBe(roomId);
    expect(start.rooms[roomId]).toBeDefined();
    expect(start.players.p1b?.name).toBe('Alice');
    expect(start.players.p1).toBeUndefined();
    expect(start.players.p2).toBeDefined();
    expect(start.playerPositions.p1b).toBeDefined();
  });

  it('resends the running arena combat when the room is mid-fight', () => {
    const { session, messages } = createSession();
    const s = session as any;
    const roomId = session.getPlayerRoom('p1')!;
    s.combats.set(roomId, {
      getGrid: () => ({ width: 1, height: 1, tiles: [['floor']] }),
      getAllPositions: () => ({}),
      getCombatState: () => ({ roomId }),
      cancelAfkTimer: () => {},
      replaceParticipantId: () => {},
      // p1 is in this fight (re-keyed to p1b by the reattach).
      getParticipant: (id: string) => (id === 'p1b' ? { id } : undefined),
      getState: () => ({ roomId, currentTurnId: 'm1', roundNumber: 1 }),
    });
    session.reattachConnection('p1', 'p1b');

    const types = messages.filter((m) => m.playerId === 'p1b').map((m) => m.msg.type);
    expect(types).toContain('arena_combat_start');
    expect(types.indexOf('game_start')).toBeLessThan(types.indexOf('arena_combat_start'));
  });
  it('lets the reattached connection keep moving on the room grid', () => {
    const { session, messages } = createSession();
    const s = session as any;
    session.reattachConnection('p1', 'p1b');
    const roomId = session.getPlayerRoom('p1b')!;
    const grid = s.roomGrids.get(roomId);
    expect(grid.getEntity('p1b')).not.toBeNull();
    expect(grid.getEntity('p1')).toBeNull();
    const start = { ...s.playerGridPositions.get('p1b') };
    const dir = (['n', 's', 'e', 'w'] as const).find((d) => {
      const delta = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[d];
      return grid.isWalkable({ x: start.x + delta[0], y: start.y + delta[1] });
    })!;
    messages.length = 0;
    session.handleGridMove('p1b', dir);
    expect(s.playerGridPositions.get('p1b')).not.toEqual(start);
  });
});

describe('GameSession.reattachConnection mid-combat', () => {
  it('re-keys the running combat and re-prompts the reconnected player on their turn', () => {
    const messages: { playerId: string; msg: any }[] = [];
    const session = new GameSession(
      (msg: any) => messages.push({ playerId: '__broadcast__', msg }),
      (playerId: string, msg: any) => messages.push({ playerId, msg }),
    );
    session.addPlayer('p1', 'Alice');
    session.startGame();
    const s = session as any;
    const roomId = session.getPlayerRoom('p1')!;
    const tiles = [['floor', 'floor', 'floor']];
    const combat = new ArenaCombatManager(roomId, { width: 3, height: 1, tiles },
      [{ id: 'p1', name: 'Alice', hp: 50, maxHp: 50, damage: 5, defense: 2, initiative: 99 }],
      [{ instanceId: 'm1', templateId: 'x', name: 'Rat', maxHp: 5, hp: 5, damage: 1, defense: 0, initiative: 0 }],
      { p1: { x: 0, y: 0 }, m1: { x: 2, y: 0 } });
    // Force p1's turn regardless of the initiative roll.
    const cm = combat.getCombatManager() as any;
    cm.turnOrder = ['p1', 'm1']; cm.turnIndex = 0;
    combat.startTurn('p1');
    s.combats.set(roomId, combat);
    s.playerManager.setStatus('p1', 'in_combat');
    session.markDisconnected('p1');
    messages.length = 0;

    session.reattachConnection('p1', 'p1b');

    expect(combat.getCombatManager().getCurrentTurnId()).toBe('p1b');
    expect(combat.getPosition('p1b')).toEqual({ x: 0, y: 0 });
    const toNew = messages.filter((m) => m.playerId === 'p1b').map((m) => m.msg);
    const start = toNew.find((m) => m.type === 'arena_combat_start');
    expect(start.positions.p1b).toEqual({ x: 0, y: 0 });
    expect(start.combat.participants.some((p: any) => p.id === 'p1b')).toBe(true);
    const turn = toNew.find((m) => m.type === 'combat_turn');
    expect(turn?.currentTurnId).toBe('p1b');
    expect(toNew.findIndex((m) => m.type === 'combat_turn')).toBeGreaterThan(toNew.indexOf(start));
  });
});
