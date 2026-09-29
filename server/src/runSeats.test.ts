import { describe, it, expect } from 'vitest';
import { seatIsReconnectable, releaseSupersededConnection, lockReleasedOnClose, characterDeleteBlocker } from './runSeats.js';
import { ActiveSessionMap } from './ActiveSessionMap.js';

describe('seatIsReconnectable', () => {
  it('never hands a parked seat to a reconnect', () => {
    expect(seatIsReconnectable('parked:c1', true, false)).toBe(false);
    expect(seatIsReconnectable('parked:c1', false, false)).toBe(false);
  });

  it('takes a dropped placeholder or any disconnected seat', () => {
    expect(seatIsReconnectable('dropped:c1', true, false)).toBe(true);
    expect(seatIsReconnectable('player_3', true, true)).toBe(true);
  });

  it('takes a connection seat only when its socket is not live', () => {
    expect(seatIsReconnectable('player_3', false, false)).toBe(true);
    expect(seatIsReconnectable('player_3', false, true)).toBe(false);
  });

  it('refuses a connected placeholder seat', () => {
    expect(seatIsReconnectable('dropped:c1', false, false)).toBe(false);
  });
});

describe('seat takeover and the late socket close', () => {
  it("a taken-over connection's late close does not release the character lock", () => {
    const accounts = new Map<string, { characterId?: string }>([
      ['player_1', { characterId: 'c1' }],
      ['player_2', { characterId: 'c1' }],
    ]);
    // player_2 (a reload) takes over player_1's seat before player_1's socket has closed.
    releaseSupersededConnection(accounts, 'player_1');
    expect(accounts.get('player_1')!.characterId).toBeUndefined();
    expect(accounts.get('player_2')!.characterId).toBe('c1');
    // player_1's close runs after the takeover: it is no longer routed into the run.
    expect(lockReleasedOnClose(accounts.get('player_1'), false)).toBeUndefined();
  });

  it('leaves the account entry alone when the seat was a placeholder', () => {
    const accounts = new Map<string, { characterId?: string }>([['parked:c1', { characterId: 'c1' }]]);
    releaseSupersededConnection(accounts, 'parked:c1');
    expect(accounts.get('parked:c1')!.characterId).toBe('c1');
  });

  it('a close outside any run releases the held character; one still in a run does not', () => {
    expect(lockReleasedOnClose({ characterId: 'c1' }, false)).toBe('c1');
    expect(lockReleasedOnClose({ characterId: 'c1' }, true)).toBeUndefined();
    expect(lockReleasedOnClose(undefined, false)).toBeUndefined();
  });
});

describe('characterDeleteBlocker', () => {
  it('refuses to delete a character still seated in a run (parked or not)', () => {
    const runs = new ActiveSessionMap();
    runs.attach('c1', 'acc', 'run-1');
    expect(characterDeleteBlocker(runs, 'c1')).toBe('That character is still in a dungeon run.');
  });

  it('allows deleting a character that is not in a run', () => {
    const runs = new ActiveSessionMap();
    runs.attach('c1', 'acc', 'run-1');
    expect(characterDeleteBlocker(runs, 'c2')).toBeNull();
    runs.detachCharacter('c1');
    expect(characterDeleteBlocker(runs, 'c1')).toBeNull();
  });
});
