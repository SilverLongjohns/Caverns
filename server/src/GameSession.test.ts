import { describe, it, expect } from 'vitest';
import { GameSession } from './GameSession.js';

describe('GameSession', () => {
  function createSession() {
    const messages: { playerId: string; msg: any }[] = [];
    const broadcast = (msg: any) => {
      messages.push({ playerId: '__broadcast__', msg });
    };
    const sendTo = (playerId: string, msg: any) => {
      messages.push({ playerId, msg });
    };
    const session = new GameSession(broadcast, sendTo);
    session.addPlayer('p1', 'Alice');
    session.addPlayer('p2', 'Bob');
    session.startGame();
    return { session, messages };
  }

  it('starts game with players in entrance room', () => {
    const { session } = createSession();
    expect(session.getPlayerRoom('p1')).toBe('entrance');
    expect(session.getPlayerRoom('p2')).toBe('entrance');
  });

  it('reveals entrance room on game start', () => {
    const { session } = createSession();
    expect(session.isRoomRevealed('entrance')).toBe(true);
  });

  it('moves a player to an adjacent room', () => {
    const { session, messages } = createSession();
    messages.length = 0;
    session.handleMove('p1', 'north');
    expect(session.getPlayerRoom('p1')).toBe('fungal_grotto');
  });

  it('rejects move to invalid direction', () => {
    const { session, messages } = createSession();
    messages.length = 0;
    session.handleMove('p1', 'west');
    expect(session.getPlayerRoom('p1')).toBe('entrance');
    const errorMsg = messages.find((m) => m.msg.type === 'error');
    expect(errorMsg).toBeDefined();
  });

  it('reveals new room when a player enters it', () => {
    const { session } = createSession();
    expect(session.isRoomRevealed('fungal_grotto')).toBe(false);
    session.handleMove('p1', 'north');
    expect(session.isRoomRevealed('fungal_grotto')).toBe(true);
  });

  it('triggers combat when entering a room with mobs', () => {
    const { session, messages } = createSession();
    messages.length = 0;
    session.handleMove('p1', 'north');
    const combatStart = messages.find((m) => m.msg.type === 'combat_start');
    expect(combatStart).toBeDefined();
  });

  it('does not trigger combat in a cleared room', () => {
    const { session, messages } = createSession();
    session.handleMove('p1', 'north');
    session.clearRoom('fungal_grotto');
    session.handleMove('p1', 'south');
    messages.length = 0;
    session.handleMove('p1', 'north');
    const combatStart = messages.find((m) => m.msg.type === 'combat_start');
    expect(combatStart).toBeUndefined();
  });

  it('prevents movement while in combat', () => {
    const { session, messages } = createSession();
    session.handleMove('p1', 'north');
    messages.length = 0;
    session.handleMove('p1', 'south');
    expect(session.getPlayerRoom('p1')).toBe('fungal_grotto');
    const errorMsg = messages.find((m) => m.msg.type === 'error');
    expect(errorMsg).toBeDefined();
  });
});
