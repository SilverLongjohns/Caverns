import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore, selectCurrentView } from './gameStore.js';

const player = (id: string, name: string) => ({ id, name, roomId: 'r1', hp: 10, maxHp: 10, status: 'exploring' }) as any;

describe('gameStore park-run messages', () => {
  beforeEach(() => {
    useGameStore.setState({
      authStatus: 'authenticated', connectionStatus: 'in_game', playerId: 'p1',
      players: { p1: player('p1', 'Alice'), p2: player('p2', 'Bob') },
      playerPositions: { p1: { x: 1, y: 1 }, p2: { x: 2, y: 2 } },
      rooms: { r1: { id: 'r1' } as any }, currentRoomId: 'r1', currentWorld: null,
    } as any);
  });

  it('run_parked leaves the dungeon for character select', () => {
    useGameStore.setState({ generationStatus: 'failed' });
    useGameStore.getState().handleServerMessage({ type: 'run_parked' });
    const s = useGameStore.getState();
    expect(s.connectionStatus).toBe('connected');
    expect(s.players).toEqual({});
    expect(s.exploredTiles.size).toBe(0);
    expect(s.generationStatus).toBe('idle');
    expect(s.generationError).toBeNull();
    expect(selectCurrentView(s)).toBe('character_select');
  });

  it('party_member_left drops the seat', () => {
    useGameStore.getState().handleServerMessage({ type: 'party_member_left', playerId: 'p2' });
    const s = useGameStore.getState();
    expect(s.players.p2).toBeUndefined();
    expect(s.playerPositions.p2).toBeUndefined();
  });

  it("party_member_left about the local player is ignored (dungeon_returned handles the exit)", () => {
    useGameStore.getState().handleServerMessage({ type: 'party_member_left', playerId: 'p1' });
    const s = useGameStore.getState();
    expect(s.players.p1?.name).toBe('Alice');
    expect(s.playerPositions.p1).toEqual({ x: 1, y: 1 });
  });

  it('seat_rekeyed renames the seat', () => {
    useGameStore.getState().handleServerMessage({ type: 'seat_rekeyed', oldId: 'p2', newId: 'parked:c2' });
    const s = useGameStore.getState();
    expect(s.players['parked:c2']?.name).toBe('Bob');
    expect(s.players['parked:c2']?.id).toBe('parked:c2');
    expect(s.playerPositions['parked:c2']).toEqual({ x: 2, y: 2 });
    expect(s.players.p2).toBeUndefined();
  });
});
