import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ServerMessage } from '@caverns/shared';
import { OVERWORLD_MAPS } from '@caverns/shared';
import { WorldSession, type AddConnectionArgs } from './WorldSession.js';
import type { WorldRepository } from './WorldRepository.js';
import type { CharacterRepository } from './CharacterRepository.js';

function makeArgs(connectionId: string, overrides: Partial<AddConnectionArgs> = {}): AddConnectionArgs {
  return {
    connectionId,
    accountId: `acc_${connectionId}`,
    characterId: `char_${connectionId}`,
    displayName: `User${connectionId}`,
    characterName: `Char${connectionId}`,
    className: 'vanguard',
    level: 1,
    savedPos: null,
    ...overrides,
  };
}

describe('WorldSession', () => {
  let session: WorldSession;
  let sendTo: ReturnType<typeof vi.fn>;
  let broadcast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendTo = vi.fn();
    broadcast = vi.fn();
    session = new WorldSession({
      worldId: 'w1',
      worldName: 'Test World',
      worldRepo: {} as WorldRepository,
      characterRepo: {} as CharacterRepository,
      broadcast: broadcast as (msg: ServerMessage, exceptConnectionId?: string) => void,
      sendTo: sendTo as (connectionId: string, msg: ServerMessage) => void,
    });
  });

  it('sends world_state with map and members to the joining connection on add', async () => {
    await session.addConnection(makeArgs('c1'));
    expect(sendTo).toHaveBeenCalledWith('c1', expect.objectContaining({
      type: 'world_state',
      worldId: 'w1',
      worldName: 'Test World',
      map: OVERWORLD_MAPS.starter,
      members: expect.arrayContaining([expect.objectContaining({
        connectionId: 'c1',
        pos: OVERWORLD_MAPS.starter.spawnTile,
      })]),
    }));
  });

  it('uses saved position when walkable', async () => {
    const map = OVERWORLD_MAPS.starter;
    const saved = { x: map.spawnTile.x + 1, y: map.spawnTile.y };
    await session.addConnection(makeArgs('c1', { savedPos: saved }));
    const members = session.getMembers();
    expect(members[0].pos).toEqual(saved);
  });

  it('falls back to spawn when saved position is on a wall', async () => {
    await session.addConnection(makeArgs('c1', { savedPos: { x: 0, y: 0 } }));
    const members = session.getMembers();
    expect(members[0].pos).toEqual(OVERWORLD_MAPS.starter.spawnTile);
  });

  it('includes the joining member position in world_member_joined', async () => {
    await session.addConnection(makeArgs('c1'));
    await session.addConnection(makeArgs('c2'));
    expect(broadcast).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'world_member_joined',
        member: expect.objectContaining({
          connectionId: 'c2',
          pos: OVERWORLD_MAPS.starter.spawnTile,
        }),
      }),
      'c2',
    );
  });

  it('broadcasts world_member_joined to others (excluding the joiner)', async () => {
    await session.addConnection(makeArgs('c1'));
    await session.addConnection(makeArgs('c2'));
    expect(broadcast).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'world_member_joined',
        member: expect.objectContaining({ connectionId: 'c2' }),
      }),
      'c2',
    );
  });

  it('removeConnection on last member returns destroyed and broadcasts world_member_left', async () => {
    await session.addConnection(makeArgs('c1'));
    const result = await session.removeConnection('c1');
    expect(result).toBe('destroyed');
    expect(broadcast).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'world_member_left', connectionId: 'c1', characterId: 'char_c1' }),
    );
  });

  it('removeConnection with remaining members returns still_active', async () => {
    await session.addConnection(makeArgs('c1'));
    await session.addConnection(makeArgs('c2'));
    const result = await session.removeConnection('c1');
    expect(result).toBe('still_active');
    expect(session.memberCount()).toBe(1);
  });

  it('removeConnection on non-member is a no-op that returns still_active', async () => {
    await session.addConnection(makeArgs('c1'));
    const result = await session.removeConnection('ghost');
    expect(result).toBe('still_active');
    expect(session.memberCount()).toBe(1);
  });

  it('getMembers returns the expected summary shape', async () => {
    await session.addConnection(makeArgs('c1', { characterName: 'Alice', level: 5 }));
    const members = session.getMembers();
    expect(members).toEqual([
      expect.objectContaining({
        connectionId: 'c1',
        characterId: 'char_c1',
        characterName: 'Alice',
        level: 5,
      }),
    ]);
  });

  it('memberCount reflects additions and removals', async () => {
    expect(session.memberCount()).toBe(0);
    await session.addConnection(makeArgs('c1'));
    await session.addConnection(makeArgs('c2'));
    expect(session.memberCount()).toBe(2);
    await session.removeConnection('c1');
    expect(session.memberCount()).toBe(1);
  });
});
