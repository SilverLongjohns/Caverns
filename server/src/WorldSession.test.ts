import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ServerMessage } from '@caverns/shared';
import { WorldSession, type WorldSessionMember } from './WorldSession.js';
import type { WorldRepository } from './WorldRepository.js';
import type { CharacterRepository } from './CharacterRepository.js';

function makeMember(connectionId: string, overrides: Partial<WorldSessionMember> = {}): WorldSessionMember {
  return {
    connectionId,
    accountId: `acc_${connectionId}`,
    characterId: `char_${connectionId}`,
    displayName: `User${connectionId}`,
    characterName: `Char${connectionId}`,
    className: 'vanguard',
    level: 1,
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

  it('sends world_state to the joining connection on add', async () => {
    await session.addConnection(makeMember('c1'));
    expect(sendTo).toHaveBeenCalledWith('c1', expect.objectContaining({
      type: 'world_state',
      worldId: 'w1',
      worldName: 'Test World',
      members: expect.arrayContaining([expect.objectContaining({ connectionId: 'c1' })]),
    }));
  });

  it('broadcasts world_member_joined to others (excluding the joiner)', async () => {
    await session.addConnection(makeMember('c1'));
    await session.addConnection(makeMember('c2'));
    expect(broadcast).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'world_member_joined',
        member: expect.objectContaining({ connectionId: 'c2' }),
      }),
      'c2',
    );
  });

  it('removeConnection on last member returns destroyed and broadcasts world_member_left', async () => {
    await session.addConnection(makeMember('c1'));
    const result = await session.removeConnection('c1');
    expect(result).toBe('destroyed');
    expect(broadcast).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'world_member_left', connectionId: 'c1', characterId: 'char_c1' }),
    );
  });

  it('removeConnection with remaining members returns still_active', async () => {
    await session.addConnection(makeMember('c1'));
    await session.addConnection(makeMember('c2'));
    const result = await session.removeConnection('c1');
    expect(result).toBe('still_active');
    expect(session.memberCount()).toBe(1);
  });

  it('removeConnection on non-member is a no-op that returns still_active', async () => {
    await session.addConnection(makeMember('c1'));
    const result = await session.removeConnection('ghost');
    expect(result).toBe('still_active');
    expect(session.memberCount()).toBe(1);
  });

  it('getMembers returns the expected summary shape', async () => {
    await session.addConnection(makeMember('c1', { characterName: 'Alice', level: 5 }));
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
    await session.addConnection(makeMember('c1'));
    await session.addConnection(makeMember('c2'));
    expect(session.memberCount()).toBe(2);
    await session.removeConnection('c1');
    expect(session.memberCount()).toBe(1);
  });
});
