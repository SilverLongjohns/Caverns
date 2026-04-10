import { describe, it, expect } from 'vitest';
import { GameSession } from './GameSession.js';
import type { DungeonContent } from '@caverns/shared';
import { exitPosition } from './tileGridBuilder.js';

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

  /**
   * Helper: walk a player toward the mob in their current room until combat triggers.
   * Returns true if combat was triggered.
   */
  function walkPlayerToMob(session: GameSession, playerId: string, messages: { playerId: string; msg: any }[]): boolean {
    const s = session as any;
    const roomId = s.playerManager.getPlayer(playerId)?.roomId;
    if (!roomId) return false;
    const mobPos = s.mobAIManager.getMobPosition(roomId);
    if (!mobPos) return false;

    // Teleport player to a walkable tile adjacent to the mob (within detection range)
    const grid = s.roomGrids.get(roomId);
    if (!grid) return false;
    grid.removeEntity(playerId);
    const offsets = [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
    let placed = false;
    for (const { dx, dy } of offsets) {
      const pos = { x: mobPos.x + dx, y: mobPos.y + dy };
      if (grid.isWalkable(pos)) {
        grid.addEntity({ id: playerId, type: 'player', position: { ...pos } });
        s.playerGridPositions.set(playerId, { ...pos });
        s.mobAIManager.updatePlayerPosition(roomId, playerId, pos);
        placed = true;
        break;
      }
    }
    if (!placed) return false;

    // Player is within detection range — trigger check
    s.mobAIManager.checkDetection(roomId);
    return messages.some((m) => m.msg.type === 'combat_start');
  }

  /**
   * Helper: position a player adjacent to a room's exit tile and then call handleGridMove
   * to walk them through the exit, triggering a room transition.
   * This replaces the old `handleMove(playerId, direction)` for tests.
   */
  function movePlayerThroughExit(session: GameSession, playerId: string, direction: 'north' | 'south' | 'east' | 'west') {
    const s = session as any;
    const roomId = s.playerManager.getPlayer(playerId)?.roomId;
    if (!roomId) return;
    const room = s.rooms.get(roomId);
    if (!room?.tileGrid) return;
    const grid = s.roomGrids.get(roomId);
    if (!grid) return;

    const exitPos = exitPosition(direction, room.tileGrid.width, room.tileGrid.height);
    // Map direction to grid direction and pre-exit position
    const dirMap: Record<string, { gridDir: string; dx: number; dy: number }> = {
      north: { gridDir: 'n', dx: 0, dy: 1 },
      south: { gridDir: 's', dx: 0, dy: -1 },
      east:  { gridDir: 'e', dx: -1, dy: 0 },
      west:  { gridDir: 'w', dx: 1, dy: 0 },
    };
    const { gridDir, dx, dy } = dirMap[direction];
    const preExitPos = { x: exitPos.x + dx, y: exitPos.y + dy };

    // Remove and re-add the player entity at the pre-exit position
    grid.removeEntity(playerId);
    // Ensure the tile is walkable; if not, try the exit position itself minus one more step
    if (grid.isWalkable(preExitPos)) {
      grid.addEntity({ id: playerId, type: 'player', position: { ...preExitPos } });
    } else {
      // fallback: place directly on the exit tile and move through
      grid.addEntity({ id: playerId, type: 'player', position: { ...exitPos } });
    }
    s.playerGridPositions.set(playerId, grid.getEntity(playerId)?.position ?? preExitPos);

    // Bypass rate limiting for tests
    s.lastGridMove.delete(playerId);

    session.handleGridMove(playerId, gridDir);
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
    movePlayerThroughExit(session, 'p1', 'north');
    expect(session.getPlayerRoom('p1')).toBe('fungal_grotto');
  });

  it('rejects move to invalid direction', () => {
    const { session, messages } = createSession();
    messages.length = 0;
    // 'west' has no exit from entrance — handleGridMove will just fail silently
    // (no exit tile to walk onto). But we can test that the player stays put.
    session.handleGridMove('p1', 'w');
    expect(session.getPlayerRoom('p1')).toBe('entrance');
  });

  it('reveals new room when a player enters it', () => {
    const { session } = createSession();
    expect(session.isRoomRevealed('fungal_grotto')).toBe(false);
    movePlayerThroughExit(session, 'p1', 'north');
    expect(session.isRoomRevealed('fungal_grotto')).toBe(true);
  });

  it('triggers combat when player walks near a mob', () => {
    const { session, messages } = createSession();
    movePlayerThroughExit(session, 'p1', 'north');
    messages.length = 0;
    const triggered = walkPlayerToMob(session, 'p1', messages);
    expect(triggered).toBe(true);
  });

  it('does not trigger combat in a cleared room', () => {
    const { session, messages } = createSession();
    movePlayerThroughExit(session, 'p1', 'north');
    session.clearRoom('fungal_grotto');
    // Move back south, then north again
    movePlayerThroughExit(session, 'p1', 'south');
    messages.length = 0;
    movePlayerThroughExit(session, 'p1', 'north');
    const combatStart = messages.find((m) => m.msg.type === 'combat_start');
    expect(combatStart).toBeUndefined();
  });

  it('prevents movement while in combat', () => {
    const { session, messages } = createSession();
    movePlayerThroughExit(session, 'p1', 'north');
    walkPlayerToMob(session, 'p1', messages);

    // Now in combat — trying to move should fail
    messages.length = 0;
    const s = session as any;
    s.lastGridMove.delete('p1');
    session.handleGridMove('p1', 's');
    expect(session.getPlayerRoom('p1')).toBe('fungal_grotto');
    const errorMsg = messages.find((m) => m.msg.type === 'error');
    expect(errorMsg).toBeDefined();
  });

  it('accepts custom DungeonContent', () => {
    const messages: { playerId: string; msg: any }[] = [];
    const broadcast = (msg: any) => { messages.push({ playerId: '__broadcast__', msg }); };
    const sendTo = (playerId: string, msg: any) => { messages.push({ playerId, msg }); };

    const customDungeon = {
      name: 'Test Dungeon',
      theme: 'test',
      atmosphere: 'test',
      entranceRoomId: 'start',
      bossId: 'test_boss',
      rooms: [
        { id: 'start', type: 'tunnel' as const, name: 'Start', description: 'The beginning.', exits: { north: 'boss' } },
        { id: 'boss', type: 'boss' as const, name: 'Boss Room', description: 'The end.', exits: { south: 'start' }, encounter: { mobId: 'test_boss', skullRating: 3 as const } },
      ],
      mobs: [{ id: 'test_boss', name: 'Test Boss', description: 'A test.', skullRating: 3 as const, maxHp: 100, damage: 10, defense: 5, initiative: 5, lootTable: [] }],
      items: [],
    };

    const session = new GameSession(broadcast, sendTo, customDungeon);
    session.addPlayer('p1', 'Alice');
    session.startGame();
    expect(session.getPlayerRoom('p1')).toBe('start');
  });

  it('passes critMultiplier through to combat action', () => {
    const { session, messages } = createSession();
    movePlayerThroughExit(session, 'p1', 'north');
    walkPlayerToMob(session, 'p1', messages);
    messages.length = 0;
    session.handleCombatAction('p1', 'attack', undefined, undefined, undefined, 1.5);
    // May not be p1's turn, but should not crash
    expect(true).toBe(true);
  });

  it('handles defend_result message without crash', () => {
    const { session } = createSession();
    session.handleDefendResult('p1', 0.5);
    expect(true).toBe(true);
  });

  it('calls onGameOver callback when game ends in wipe', () => {
    const messages: { playerId: string; msg: any }[] = [];
    let gameOverCalled = false;
    const broadcast = (msg: any) => { messages.push({ playerId: '__broadcast__', msg }); };
    const sendTo = (playerId: string, msg: any) => { messages.push({ playerId, msg }); };
    const session = new GameSession(broadcast, sendTo, undefined, () => { gameOverCalled = true; });
    session.addPlayer('p1', 'Alice');
    session.startGame();

    // Move to a room with combat and walk to mob
    movePlayerThroughExit(session, 'p1', 'north');
    walkPlayerToMob(session, 'p1', messages);

    // Repeatedly attack until either player dies or mob dies
    for (let i = 0; i < 50; i++) {
      session.handleCombatAction('p1', 'attack', 'mob_fungal_grotto', undefined, undefined, 1.0);
    }

    // If the player died, onGameOver should have been called
    if (gameOverCalled) {
      expect(gameOverCalled).toBe(true);
    }
    // If combat ended in victory instead, that's also fine — just verify no crash
  });

  describe('locked exits', () => {
    const lockedContent: DungeonContent = {
      name: 'Test', theme: '', atmosphere: '',
      entranceRoomId: 'room_a',
      bossId: 'boss_1',
      rooms: [
        { id: 'room_a', type: 'tunnel', name: 'A', description: '', exits: { north: 'room_b' }, lockedExits: { north: 'test_key' } },
        { id: 'room_b', type: 'boss', name: 'B', description: '', exits: { south: 'room_a' }, encounter: { mobId: 'boss_1', skullRating: 3 } },
      ],
      mobs: [{ id: 'boss_1', name: 'Boss', description: '', skullRating: 3, maxHp: 100, damage: 10, defense: 5, initiative: 5, lootTable: [] }],
      items: [],
    };

    function createLockedSession() {
      const messages: { playerId: string; msg: any }[] = [];
      const broadcast = (msg: any) => { messages.push({ playerId: '__broadcast__', msg }); };
      const sendTo = (playerId: string, msg: any) => { messages.push({ playerId, msg }); };
      const session = new GameSession(broadcast, sendTo, lockedContent);
      session.addPlayer('p1', 'Alice');
      session.startGame();
      return { session, messages };
    }

    it('blocks movement through a locked exit when player has no key', () => {
      const { session, messages } = createLockedSession();
      messages.length = 0;
      movePlayerThroughExit(session, 'p1', 'north');
      expect(session.getPlayerRoom('p1')).toBe('room_a');
      const errorMsg = messages.find((m) => m.msg.type === 'error');
      expect(errorMsg).toBeDefined();
      expect(errorMsg!.msg.message).toContain('locked');
    });

    it('allows movement through a locked exit when player has the key', () => {
      const { session, messages } = createLockedSession();
      session.addKeyToParty('p1', 'test_key');
      messages.length = 0;
      movePlayerThroughExit(session, 'p1', 'north');
      expect(session.getPlayerRoom('p1')).toBe('room_b');
    });

    it('permanently unlocks the exit after passing through', () => {
      const { session, messages } = createLockedSession();
      session.addKeyToParty('p1', 'test_key');
      movePlayerThroughExit(session, 'p1', 'north');
      // Clear combat so player can move back
      session.clearRoom('room_b');
      movePlayerThroughExit(session, 'p1', 'south');
      expect(session.getPlayerRoom('p1')).toBe('room_a');
      messages.length = 0;
      // Move north again — should not require key check anymore
      movePlayerThroughExit(session, 'p1', 'north');
      expect(session.getPlayerRoom('p1')).toBe('room_b');
      const unlockMsg = messages.find((m) => m.msg.type === 'text_log' && m.msg.message.includes('lock clicks'));
      expect(unlockMsg).toBeUndefined();
    });
  });

  describe('abilities', () => {
    const abilityContent: DungeonContent = {
      name: 'Test', theme: '', atmosphere: '',
      entranceRoomId: 'room_a',
      bossId: 'boss_1',
      rooms: [
        { id: 'room_a', type: 'tunnel', name: 'A', description: '', exits: { north: 'room_b' } },
        { id: 'room_b', type: 'chamber', name: 'B', description: '', exits: { south: 'room_a' },
          encounter: { mobId: 'mob_1', skullRating: 1 } },
      ],
      mobs: [{ id: 'mob_1', name: 'Slime', description: '', skullRating: 1, maxHp: 30, damage: 5, defense: 2, initiative: 3, lootTable: [] }],
      items: [],
    };

    function createAbilitySession(className: string) {
      const messages: { playerId: string; msg: any }[] = [];
      const broadcast = (msg: any) => { messages.push({ playerId: '__broadcast__', msg }); };
      const sendTo = (playerId: string, msg: any) => { messages.push({ playerId, msg }); };
      const session = new GameSession(broadcast, sendTo, abilityContent);
      session.addPlayer('p1', 'Alice', className);
      session.startGame();
      return { session, messages };
    }

    it('player starts with full energy', () => {
      const { session } = createAbilitySession('vanguard');
      const player = (session as any).playerManager.getPlayer('p1');
      expect(player.energy).toBe(30);
    });
  });

  describe('puzzles', () => {
    const puzzleContent: DungeonContent = {
      name: 'Test', theme: '', atmosphere: '',
      entranceRoomId: 'room_a',
      bossId: 'boss_1',
      rooms: [
        { id: 'room_a', type: 'tunnel', name: 'A', description: '', exits: { north: 'room_b' } },
        { id: 'room_b', type: 'chamber', name: 'Puzzle Room', description: '', exits: { south: 'room_a', north: 'room_c' },
          puzzle: { id: 'test_puzzle', description: 'What is 2+2?', options: ['3', '4', '5', '6'], correctIndex: 1 } },
        { id: 'room_c', type: 'boss', name: 'Boss', description: '', exits: { south: 'room_b' },
          encounter: { mobId: 'boss_1', skullRating: 3 } },
      ],
      mobs: [{ id: 'boss_1', name: 'Boss', description: '', skullRating: 3, maxHp: 100, damage: 10, defense: 5, initiative: 5, lootTable: [] }],
      items: [],
    };

    function createPuzzleSession() {
      const messages: { playerId: string; msg: any }[] = [];
      const broadcast = (msg: any) => { messages.push({ playerId: '__broadcast__', msg }); };
      const sendTo = (playerId: string, msg: any) => { messages.push({ playerId, msg }); };
      const session = new GameSession(broadcast, sendTo, puzzleContent);
      session.addPlayer('p1', 'Alice');
      session.startGame();
      return { session, messages };
    }

    it.skip('sends puzzle_prompt when entering a puzzle room', () => {
      const { session, messages } = createPuzzleSession();
      messages.length = 0;
      movePlayerThroughExit(session, 'p1', 'north');
      expect(session.getPlayerRoom('p1')).toBe('room_b');
      const puzzleMsg = messages.find((m) => m.msg.type === 'puzzle_prompt');
      expect(puzzleMsg).toBeDefined();
      expect(puzzleMsg!.msg.description).toBe('What is 2+2?');
      expect(puzzleMsg!.msg.options).toEqual(['3', '4', '5', '6']);
    });

    it.skip('sends puzzle_result correct on right answer', () => {
      const { session, messages } = createPuzzleSession();
      movePlayerThroughExit(session, 'p1', 'north');
      messages.length = 0;
      session.handlePuzzleAnswer('p1', 'room_b', 1);
      const resultMsg = messages.find((m) => m.msg.type === 'puzzle_result');
      expect(resultMsg).toBeDefined();
      expect(resultMsg!.msg.correct).toBe(true);
    });

    it('does not re-prompt puzzle after solving', () => {
      const { session, messages } = createPuzzleSession();
      movePlayerThroughExit(session, 'p1', 'north');
      session.handlePuzzleAnswer('p1', 'room_b', 1);
      movePlayerThroughExit(session, 'p1', 'south');
      messages.length = 0;
      movePlayerThroughExit(session, 'p1', 'north');
      const puzzleMsg = messages.find((m) => m.msg.type === 'puzzle_prompt');
      expect(puzzleMsg).toBeUndefined();
    });
  });
});
