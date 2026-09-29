import { describe, it, expect, afterEach } from 'vitest';
import { DRIPPING_HALLS } from '@caverns/shared';
import { GameSession } from './GameSession.js';

// Every session this file creates; disposed after each test so no mob-AI timers outlive it.
const liveSessions: GameSession[] = [];
afterEach(() => {
  for (const session of liveSessions.splice(0)) session.dispose();
});

export function createParkSession(players: string[] = ['p1', 'p2']) {
  const messages: { playerId: string; msg: any }[] = [];
  // A private copy of the content: tests (and startGame) mutate rooms, which must not leak between sessions.
  // Messages are captured as sent over the wire (serialized at send time), not as live references.
  const wire = (msg: any) => JSON.parse(JSON.stringify(msg));
  const session = new GameSession(
    (msg: any) => messages.push({ playerId: '__broadcast__', msg: wire(msg) }),
    (playerId: string, msg: any) => messages.push({ playerId, msg: wire(msg) }),
    structuredClone(DRIPPING_HALLS),
  );
  liveSessions.push(session);
  for (const id of players) session.addPlayer(id, id === 'p1' ? 'Alice' : 'Bob');
  session.startGame();
  for (const id of players) session.attachCharacterContext(id, { accountId: `acc-${id}`, characterId: `char-${id}` });
  messages.length = 0;
  return { session, s: session as any, messages };
}

describe('GameSession away seats', () => {
  it('a disconnected seat outside a fight is away and hidden from mob AI', () => {
    const { session, s, messages } = createParkSession();
    const roomId = session.getPlayerRoom('p1')!;
    session.markDisconnected('p1');
    expect(session.isAway('p1')).toBe(true);
    expect(s.playerManager.getPlayer('p1').away).toBe(true);
    expect(s.mobAIManager.rooms.get(roomId)?.playerPositions.has('p1') ?? false).toBe(false);
    expect(messages.some((m) => m.msg.type === 'player_update' && m.msg.player.id === 'p1' && m.msg.player.away)).toBe(true);
    session.markConnected('p1');
    expect(session.isAway('p1')).toBe(false);
    expect(s.playerManager.getPlayer('p1').away).toBeUndefined();
  });

  it('a disconnected seat inside a fight is not away (AFK rules apply instead)', () => {
    const { session, s } = createParkSession();
    s.playerManager.setStatus('p1', 'in_combat');
    session.markDisconnected('p1');
    expect(session.isDisconnected('p1')).toBe(true);
    expect(session.isAway('p1')).toBe(false);
  });

  it('mob detection does not open a fight when only away seats are present', () => {
    // Arm the entrance with a live encounter so detection has something to start.
    const arm = () => {
      const created = createParkSession(['p1']);
      const roomId = created.session.getPlayerRoom('p1')!;
      const template = created.s.content.mobs[0];
      created.s.rooms.get(roomId).encounter = { mobId: template.id, skullRating: 1 };
      created.s.roomMobInstances.set(roomId, [{
        instanceId: 'm1', templateId: template.id, name: template.name,
        maxHp: 5, hp: 5, damage: 1, defense: 0, initiative: 0,
      }]);
      return { ...created, roomId };
    };

    // Control: with p1 present, the same setup does open a fight.
    const present = arm();
    present.s.handleMobDetection(present.roomId, 'm1');
    expect(present.s.combats.has(present.roomId)).toBe(true);

    const away = arm();
    away.session.markDisconnected('p1');
    away.s.handleMobDetection(away.roomId, 'm1');
    expect(away.s.combats.has(away.roomId)).toBe(false);
    expect(away.s.playerManager.getPlayer('p1').status).not.toBe('in_combat');
  });

  it('a fight started by a present player leaves the away seat out', () => {
    const { session, s } = createParkSession();
    const roomId = session.getPlayerRoom('p1')!;
    session.markDisconnected('p2');
    const mob = { instanceId: 'm1', templateId: s.content.mobs[0].id, name: 'Rat', maxHp: 5, hp: 5, damage: 1, defense: 0, initiative: 0 };
    session.startArenaCombat(roomId, [mob]);
    const ids = s.combats.get(roomId).getState().participants.map((p: any) => p.id);
    expect(ids).toContain('p1');
    expect(ids).not.toContain('p2');
    expect(s.playerManager.getPlayer('p2').status).not.toBe('in_combat');
  });

  it('rekeySeat moves the seat and tells everyone', () => {
    const { session, s, messages } = createParkSession();
    s.rekeySeat('p1', 'x1');
    expect(session.getPlayerRoom('x1')).toBeDefined();
    expect(session.getPlayerRoom('p1')).toBeUndefined();
    expect(session.getCharacterIdFor('x1')).toBe('char-p1');
    expect(messages.some((m) => m.msg.type === 'seat_rekeyed' && m.msg.oldId === 'p1' && m.msg.newId === 'x1')).toBe(true);
  });
});

describe('GameSession park / resume', () => {
  it('refuses to park in a fight, while downed, or with a loot roll pending', () => {
    const { session, s } = createParkSession();
    s.playerManager.setStatus('p1', 'in_combat');
    expect(session.park('p1')).toEqual({ ok: false, reason: "You can't do that during a fight." });
    s.playerManager.setStatus('p1', 'downed');
    expect(session.park('p1')).toEqual({ ok: false, reason: "You can't do that while downed." });
    s.playerManager.setStatus('p1', 'exploring');
    s.lootManager.startLootRound('r', [{ id: 'i1', name: 'Rock' }], ['p1', 'p2']);
    expect(session.park('p1')).toEqual({ ok: false, reason: 'Finish the loot roll first.' });
  });

  it('parks the seat under a placeholder id, away from mobs', () => {
    const { session, s, messages } = createParkSession();
    const roomId = session.getPlayerRoom('p1')!;
    const res = session.park('p1');
    expect(res).toEqual({ ok: true, characterId: 'char-p1', seatId: 'parked:char-p1' });
    expect(session.getPlayerRoom('p1')).toBeUndefined();
    expect(session.isParked('char-p1')).toBe(true);
    expect(session.findSeatByCharacter('char-p1')).toBe('parked:char-p1');
    expect(session.getParkedRoomName('char-p1')).toBe(s.rooms.get(roomId).name);
    expect(session.isAway('parked:char-p1')).toBe(true);
    expect(s.mobAIManager.rooms.get(roomId)?.playerPositions.has('parked:char-p1') ?? false).toBe(false);
    expect(messages.some((m) => m.msg.type === 'text_log' && /steps back into the shadows/.test(m.msg.message))).toBe(true);
  });

  it('resumes a parked seat onto a new connection with a dungeon snapshot', () => {
    const { session, messages } = createParkSession();
    session.park('p1');
    messages.length = 0;
    expect(session.resumeParked('char-p1', 'p1c')).toBe(true);
    expect(session.isParked('char-p1')).toBe(false);
    expect(session.findSeatByCharacter('char-p1')).toBe('p1c');
    expect(session.isAway('p1c')).toBe(false);
    expect(messages.some((m) => m.playerId === 'p1c' && m.msg.type === 'game_start' && m.msg.playerId === 'p1c')).toBe(true);
    // A second resume (e.g. another tab) finds nothing parked.
    expect(session.resumeParked('char-p1', 'p1d')).toBe(false);
  });

  it('resuming into a room with a fight the seat is not in sends no arena view', () => {
    const { session, s, messages } = createParkSession();
    const roomId = session.getPlayerRoom('p1')!;
    session.park('p2');
    const mob = { instanceId: 'm1', templateId: s.content.mobs[0].id, name: 'Rat', maxHp: 5, hp: 5, damage: 1, defense: 0, initiative: 0 };
    session.startArenaCombat(roomId, [mob]);
    messages.length = 0;
    expect(session.resumeParked('char-p2', 'p2c')).toBe(true);
    const toResumer = messages.filter((m) => m.playerId === 'p2c').map((m) => m.msg.type);
    expect(toResumer).toContain('game_start');
    expect(toResumer).not.toContain('arena_combat_start');
    expect(toResumer).not.toContain('combat_turn');
  });

  it("the resumer's own game_start does not show them as away", () => {
    const { session, messages } = createParkSession();
    session.park('p1');
    messages.length = 0;
    session.resumeParked('char-p1', 'p1c');
    const start = messages.find((m) => m.playerId === 'p1c' && m.msg.type === 'game_start')!.msg;
    expect(start.players.p1c.away).toBeUndefined();
    // Everyone else still hears the seat is back.
    expect(messages.some((m) => m.msg.type === 'player_update' && m.msg.player.id === 'p1c' && !m.msg.player.away)).toBe(true);
  });

  it('releaseConnection keeps a fighting seat in the run as dropped', () => {
    const { session, s } = createParkSession();
    s.playerManager.setStatus('p1', 'in_combat');
    expect(session.releaseConnection('p1')).toBe('dropped:char-p1');
    expect(session.isDisconnected('dropped:char-p1')).toBe(true);
    expect(session.findSeatByCharacter('char-p1')).toBe('dropped:char-p1');
  });
});

describe('GameSession leaveRun', () => {
  const potion = (n: number) => ({ id: 'potion', name: `Potion ${n}`, slot: 'consumable', rarity: 'common', stats: {} }) as any;

  it('pays 25 gold and removes the seat', async () => {
    const { session, s, messages } = createParkSession();
    s.playerManager.getPlayer('p1').gold = 30;
    const res = await session.leaveRun('p1', { kind: 'gold' });
    expect(res).toEqual({ ok: true, characterId: 'char-p1', remainingSeats: 1 });
    expect(session.getPlayerRoom('p1')).toBeUndefined();
    expect(session.findSeatByCharacter('char-p1')).toBeUndefined();
    expect(messages.some((m) => m.msg.type === 'party_member_left' && m.msg.playerId === 'p1')).toBe(true);
  });

  it('refuses gold it cannot pay', async () => {
    const { session, s } = createParkSession();
    s.playerManager.getPlayer('p1').gold = 24;
    expect(await session.leaveRun('p1', { kind: 'gold' })).toEqual({ ok: false, reason: 'You need 25 gold.' });
  });

  it('takes only the chosen pouch slot', async () => {
    const { session, s } = createParkSession();
    const p = s.playerManager.getPlayer('p1');
    p.consumables = [potion(0), null, potion(2), null, null, null];
    let snap: any;
    s.characters = { snapshot: async (_id: string, saved: any) => { snap = saved; } };
    await session.leaveRun('p1', { kind: 'item', source: 'consumables', index: 2 });
    expect(snap.consumables.map((c: any) => c?.name ?? null)).toEqual(['Potion 0', null, null, null, null, null]);
  });

  it('rejects an empty or out-of-range slot', async () => {
    const { session } = createParkSession();
    expect(await session.leaveRun('p1', { kind: 'item', source: 'inventory', index: 99 }))
      .toEqual({ ok: false, reason: 'There is no item in that slot.' });
  });

  it('allows free only when nothing is payable', async () => {
    const { session, s } = createParkSession();
    const p = s.playerManager.getPlayer('p1');
    p.gold = 0; p.inventory = p.inventory.map(() => null); p.consumables = [potion(0), null, null, null, null, null];
    expect(await session.leaveRun('p1', { kind: 'free' })).toEqual({ ok: false, reason: 'You can still pay the toll.' });
    p.consumables = p.consumables.map(() => null);
    expect((await session.leaveRun('p1', { kind: 'free' })).ok).toBe(true);
  });

  it('is refused in a fight and reports zero seats left for a solo run', async () => {
    const { session, s } = createParkSession(['p1']);
    s.playerManager.getPlayer('p1').gold = 100;
    s.playerManager.setStatus('p1', 'in_combat');
    expect(await session.leaveRun('p1', { kind: 'gold' })).toEqual({ ok: false, reason: "You can't do that during a fight." });
    s.playerManager.setStatus('p1', 'exploring');
    expect(await session.leaveRun('p1', { kind: 'gold' })).toEqual({ ok: true, characterId: 'char-p1', remainingSeats: 0 });
  });

  it('two leaveRun calls in the same tick take the toll once and refuse the second', async () => {
    const { session, s } = createParkSession();
    s.playerManager.getPlayer('p1').gold = 60;
    const snaps: any[] = [];
    s.characters = { snapshot: async (_id: string, snap: any) => { snaps.push(snap); } };
    const first = session.leaveRun('p1', { kind: 'gold' });
    const second = session.leaveRun('p1', { kind: 'gold' });
    expect(await first).toEqual({ ok: true, characterId: 'char-p1', remainingSeats: 1 });
    expect(await second).toEqual({ ok: false, reason: 'You are not in this run.' });
    expect(snaps.filter((snap) => snap.gold !== undefined).map((snap) => snap.gold)).toEqual([35]);
  });

  it('a seat that is leaving cannot park or be pulled into a fight while its save is pending', async () => {
    const { session, s } = createParkSession();
    const roomId = session.getPlayerRoom('p1')!;
    s.playerManager.getPlayer('p1').gold = 30;
    let release!: () => void;
    s.characters = { snapshot: () => new Promise<void>((r) => { release = r; }) };
    const leaving = session.leaveRun('p1', { kind: 'gold' });
    // The DB write is still pending: the seat must already be gone.
    expect(session.park('p1')).toEqual({ ok: false, reason: 'You are not in this run.' });
    expect(session.getPlayerRoom('p1')).toBeUndefined();
    expect(s.mobAIManager.rooms.get(roomId)?.playerPositions.has('p1') ?? false).toBe(false);
    release();
    expect((await leaving).ok).toBe(true);
    expect(session.isParked('char-p1')).toBe(false);
  });

  it('a parked survivor keeps the run alive when the present party is downed', () => {
    const { session, s } = createParkSession();
    session.park('p2');
    s.playerManager.setStatus('p1', 'downed');
    expect(s.playerManager.allPlayersDowned()).toBe(false);
  });
});

describe('GameSession away seats after combat ends', () => {
  it('a seat that disconnected mid-fight becomes away once the fight ends', () => {
    const { session, s } = createParkSession();
    const roomId = session.getPlayerRoom('p1')!;
    s.playerManager.setStatus('p1', 'in_combat');
    s.playerManager.setStatus('p2', 'in_combat');
    session.markDisconnected('p2');
    // Mid-fight: AFK rules apply, not away.
    expect(session.isAway('p2')).toBe(false);
    expect(s.playerManager.getPlayer('p2').away).toBeUndefined();

    // finishCombat's own status-flip loop is what must sync awayness (clearRoom
    // runs after it and only fires on a 'victory' result, so it can't be relied on).
    s.finishCombat(roomId, 'flee');

    expect(session.isAway('p2')).toBe(true);
    expect(s.playerManager.getPlayer('p2').away).toBe(true);
    expect(s.mobAIManager.rooms.get(roomId)?.playerPositions.has('p2') ?? false).toBe(false);
  });
});

describe('GameSession puzzle solver release', () => {
  it('leaveRun frees a puzzle the leaving seat was solving', async () => {
    const { session, s } = createParkSession();
    const roomId = session.getPlayerRoom('p1')!;
    s.activePuzzleSolver.set(roomId, 'p1');
    s.playerManager.getPlayer('p1').gold = 30;
    await session.leaveRun('p1', { kind: 'gold' });
    expect(s.activePuzzleSolver.has(roomId)).toBe(false);
  });

  it('park frees a puzzle the parking seat was solving', () => {
    const { session, s } = createParkSession();
    const roomId = session.getPlayerRoom('p1')!;
    s.activePuzzleSolver.set(roomId, 'p1');
    session.park('p1');
    expect(s.activePuzzleSolver.has(roomId)).toBe(false);
  });
});
