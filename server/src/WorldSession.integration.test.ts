import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ServerMessage } from '@caverns/shared';
import { WorldSession, type AddConnectionArgs, type OutboundDungeonHandle } from './WorldSession.js';
import type { WorldRepository } from './WorldRepository.js';
import type { CharacterRepository } from './CharacterRepository.js';

const PORTAL = { x: 37, y: 15 };
const PORTAL_ID = 'starter_portal';

function makeArgs(connectionId: string, overrides: Partial<AddConnectionArgs> = {}): AddConnectionArgs {
  return {
    connectionId,
    accountId: `acc_${connectionId}`,
    characterId: `char_${connectionId}`,
    displayName: `User${connectionId}`,
    characterName: `Char${connectionId}`,
    className: 'vanguard',
    level: 1,
    savedPos: PORTAL,
    ...overrides,
  };
}

describe('WorldSession dungeon entry / return integration', () => {
  let session: WorldSession;
  let sendTo: ReturnType<typeof vi.fn>;
  let broadcast: ReturnType<typeof vi.fn>;
  let snapshotOverworldPos: ReturnType<typeof vi.fn>;
  let nextSessionId = 0;

  function fakeHandle(party: { connectionId: string; characterId: string }[]): OutboundDungeonHandle {
    return {
      sessionId: `dungeon_${++nextSessionId}`,
      portalId: PORTAL_ID,
      portalPos: PORTAL,
      party: party.map((p) => ({
        connectionId: p.connectionId,
        accountId: `acc_${p.connectionId}`,
        characterId: p.characterId,
        displayName: `User${p.connectionId}`,
        characterName: `Char${p.connectionId}`,
        className: 'vanguard',
        level: 1,
      })),
    };
  }

  /**
   * Mirror the orchestration index.ts performs around beginDungeonEntry:
   *   beginDungeonEntry → registerOutboundDungeon → removePartyForDungeon
   * Returns the handle.
   */
  function enterDungeonAs(requesterConnId: string): OutboundDungeonHandle {
    const result = session.beginDungeonEntry(requesterConnId);
    if (result.status !== 'ok') throw new Error(`begin failed: ${result.status}`);
    const handle = fakeHandle(result.party.map((p) => ({ connectionId: p.connectionId, characterId: p.characterId })));
    session.registerOutboundDungeon(handle);
    session.removePartyForDungeon(handle.party.map((p) => p.connectionId));
    return handle;
  }

  beforeEach(() => {
    nextSessionId = 0;
    sendTo = vi.fn();
    broadcast = vi.fn();
    snapshotOverworldPos = vi.fn().mockResolvedValue(undefined);
    session = new WorldSession({
      worldId: 'w1',
      worldName: 'Test World',
      worldRepo: {} as WorldRepository,
      characterRepo: { snapshotOverworldPos } as unknown as CharacterRepository,
      broadcast: broadcast as (msg: ServerMessage, exceptConnectionId?: string) => void,
      sendTo: sendTo as (connectionId: string, msg: ServerMessage) => void,
    });
  });

  afterEach(async () => {
    for (const m of session.getMembers()) {
      await session.removeConnection(m.connectionId);
    }
  });

  it('full enter → victory return flow re-admits the party at the portal', async () => {
    await session.addConnection(makeArgs('c1'));
    await session.addConnection(makeArgs('c2'));
    expect(session.setReadyAtPortal('c1')).toBe('ok');
    expect(session.setReadyAtPortal('c2')).toBe('ok');

    const handle = enterDungeonAs('c1');
    expect(handle.party.map((p) => p.connectionId).sort()).toEqual(['c1', 'c2']);
    expect(session.memberCount()).toBe(0);
    expect(session.outboundDungeonCount()).toBe(1);

    sendTo.mockClear();
    broadcast.mockClear();
    await session.returnFromDungeon(handle.sessionId, new Set(['c1', 'c2']));

    expect(session.outboundDungeonCount()).toBe(0);
    expect(session.memberCount()).toBe(2);
    expect(session.getMembers().every((m) => m.pos.x === PORTAL.x && m.pos.y === PORTAL.y)).toBe(true);
    expect(snapshotOverworldPos).toHaveBeenCalledWith('char_c1', PORTAL);
    expect(snapshotOverworldPos).toHaveBeenCalledWith('char_c2', PORTAL);
    expect(sendTo).toHaveBeenCalledWith('c1', { type: 'dungeon_returned' });
    expect(sendTo).toHaveBeenCalledWith('c2', { type: 'dungeon_returned' });
  });

  it('wipe (no survivors) snapshots all party members but re-admits none', async () => {
    await session.addConnection(makeArgs('c1'));
    await session.addConnection(makeArgs('c2'));
    session.setReadyAtPortal('c1');
    session.setReadyAtPortal('c2');
    const handle = enterDungeonAs('c1');

    sendTo.mockClear();
    await session.returnFromDungeon(handle.sessionId, new Set());

    expect(session.outboundDungeonCount()).toBe(0);
    expect(session.memberCount()).toBe(0);
    expect(snapshotOverworldPos).toHaveBeenCalledWith('char_c1', PORTAL);
    expect(snapshotOverworldPos).toHaveBeenCalledWith('char_c2', PORTAL);
    expect(sendTo).not.toHaveBeenCalledWith('c1', { type: 'dungeon_returned' });
    expect(sendTo).not.toHaveBeenCalledWith('c2', { type: 'dungeon_returned' });
  });

  it('removeConnection refuses teardown while a dungeon is outbound', async () => {
    await session.addConnection(makeArgs('c1'));
    await session.addConnection(makeArgs('c2'));
    session.setReadyAtPortal('c1');
    session.setReadyAtPortal('c2');
    const handle = enterDungeonAs('c1');

    // No live members, but the dungeon is still out — session must persist.
    const teardown = await session.removeConnection('ghost');
    expect(teardown).toBe('still_active');

    // Add a bystander, then remove them: still_active because outboundDungeons.size > 0.
    await session.addConnection(makeArgs('c3'));
    const result = await session.removeConnection('c3');
    expect(result).toBe('still_active');

    // Once the dungeon returns and that solo member also leaves, it can be torn down.
    await session.returnFromDungeon(handle.sessionId, new Set());
    expect(session.outboundDungeonCount()).toBe(0);
  });

  it('disconnect mid-dungeon: snapshots happen for everyone, only live conns re-enter', async () => {
    await session.addConnection(makeArgs('c1'));
    await session.addConnection(makeArgs('c2'));
    session.setReadyAtPortal('c1');
    session.setReadyAtPortal('c2');
    const handle = enterDungeonAs('c1');

    // c2 disconnects mid-dungeon (their ws is gone) — only c1 is in activeConnIds.
    sendTo.mockClear();
    await session.returnFromDungeon(handle.sessionId, new Set(['c1']));

    expect(session.memberCount()).toBe(1);
    expect(session.hasMember('c1')).toBe(true);
    expect(session.hasMember('c2')).toBe(false);
    // Both characters got their portal pos snapshotted so c2's next login lands at the portal.
    expect(snapshotOverworldPos).toHaveBeenCalledWith('char_c1', PORTAL);
    expect(snapshotOverworldPos).toHaveBeenCalledWith('char_c2', PORTAL);
    expect(sendTo).toHaveBeenCalledWith('c1', { type: 'dungeon_returned' });
    expect(sendTo).not.toHaveBeenCalledWith('c2', { type: 'dungeon_returned' });
  });

  it('two parties on the same portal track separate outbound dungeons', async () => {
    // Party A musters and enters.
    await session.addConnection(makeArgs('a1'));
    await session.addConnection(makeArgs('a2'));
    session.setReadyAtPortal('a1');
    session.setReadyAtPortal('a2');
    const handleA = enterDungeonAs('a1');
    expect(session.outboundDungeonCount()).toBe(1);

    // After party A leaves, the muster is cleared. Party B forms at the same portal.
    await session.addConnection(makeArgs('b1'));
    await session.addConnection(makeArgs('b2'));
    session.setReadyAtPortal('b1');
    session.setReadyAtPortal('b2');
    const handleB = enterDungeonAs('b1');
    expect(handleB.sessionId).not.toBe(handleA.sessionId);
    expect(session.outboundDungeonCount()).toBe(2);

    // outboundDungeonSessionIdFor maps each connection to its own dungeon.
    expect(session.outboundDungeonSessionIdFor('a1')).toBe(handleA.sessionId);
    expect(session.outboundDungeonSessionIdFor('a2')).toBe(handleA.sessionId);
    expect(session.outboundDungeonSessionIdFor('b1')).toBe(handleB.sessionId);
    expect(session.outboundDungeonSessionIdFor('b2')).toBe(handleB.sessionId);

    // Returns are independent.
    await session.returnFromDungeon(handleA.sessionId, new Set(['a1', 'a2']));
    expect(session.outboundDungeonCount()).toBe(1);
    expect(session.hasMember('a1') && session.hasMember('a2')).toBe(true);

    await session.returnFromDungeon(handleB.sessionId, new Set(['b1', 'b2']));
    expect(session.outboundDungeonCount()).toBe(0);
    expect(session.memberCount()).toBe(4);
  });

  it('beginDungeonEntry rejects requesters who are not on a portal or not ready', async () => {
    // c1 not on portal
    await session.addConnection(makeArgs('c1', { savedPos: { x: 6, y: 14 } }));
    expect(session.beginDungeonEntry('c1').status).toBe('not_on_portal');

    // c2 on portal but not ready
    await session.addConnection(makeArgs('c2'));
    expect(session.beginDungeonEntry('c2').status).toBe('not_ready');

    // After ready, succeeds.
    session.setReadyAtPortal('c2');
    expect(session.beginDungeonEntry('c2').status).toBe('ok');
  });
});
