import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RoomGrid } from '@caverns/roomgrid';
import type { RoomGridConfig, TileType } from '@caverns/roomgrid';
import type { MobInstance, ServerMessage } from '@caverns/shared';
import { MobAIManager } from './MobAIManager.js';

// Build a small walkable grid with no exits for simple tests
function makeGrid(width = 20, height = 20, exits: RoomGridConfig['exits'] = []): RoomGrid {
  const tiles: TileType[][] = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) return 'wall';
      return 'floor';
    })
  );
  return new RoomGrid({ width, height, tiles, exits });
}

// Grid with an exit at north center
function makeGridWithExit(width = 20, height = 20): RoomGrid {
  const tiles: TileType[][] = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) return 'wall';
      return 'floor';
    })
  );
  const exitX = Math.floor(width / 2);
  tiles[0][exitX] = 'exit';
  return new RoomGrid({
    width,
    height,
    tiles,
    exits: [{ position: { x: exitX, y: 0 }, data: { direction: 'north', targetRoomId: 'room2' } }],
  });
}

function makeMob(instanceId = 'mob-1'): MobInstance {
  return {
    instanceId,
    templateId: 'slime',
    name: 'Slime',
    maxHp: 20,
    hp: 20,
    damage: 3,
    defense: 1,
    initiative: 2,
  };
}

describe('MobAIManager', () => {
  let broadcast: ReturnType<typeof vi.fn<(roomId: string, msg: ServerMessage) => void>>;
  let manager: MobAIManager;

  beforeEach(() => {
    vi.useFakeTimers();
    broadcast = vi.fn<(roomId: string, msg: ServerMessage) => void>();
    manager = new MobAIManager(broadcast);
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
  });

  // --- registerRoom ---

  it('registerRoom places mob on the grid', () => {
    const grid = makeGrid();
    const mob = makeMob();
    manager.registerRoom('room-1', grid, [mob]);

    const positions = manager.getMobPositions('room-1');
    expect(positions.length).toBe(1);
    expect(positions[0].x).toBeGreaterThanOrEqual(0);
    expect(positions[0].y).toBeGreaterThanOrEqual(0);

    // Entity should be in the grid
    const entity = grid.getEntity(mob.instanceId);
    expect(entity).not.toBeNull();
    expect(entity!.type).toBe('mob');
  });

  it('registerRoom places mob at least 5 tiles from exits', () => {
    const width = 20;
    const height = 20;
    const grid = makeGridWithExit(width, height);
    const mob = makeMob();

    // Run many times to rule out lucky random
    for (let i = 0; i < 20; i++) {
      const testGrid = makeGridWithExit(width, height);
      const testMob = makeMob(`mob-test-${i}`);
      const testManager = new MobAIManager(vi.fn());
      testManager.registerRoom('room-x', testGrid, [testMob]);

      const positions = testManager.getMobPositions('room-x');
      expect(positions.length).toBe(1);
      const pos = positions[0];

      // Exit is at (10, 0). Chebyshev distance from pos to exit should be >= 5
      const exitPos = { x: Math.floor(width / 2), y: 0 };
      const dist = Math.max(Math.abs(pos.x - exitPos.x), Math.abs(pos.y - exitPos.y));
      expect(dist).toBeGreaterThanOrEqual(5);
      testManager.destroy();
    }
  });

  it('registerRoom broadcasts mob_spawn', () => {
    const grid = makeGrid();
    const mob = makeMob();
    manager.registerRoom('room-1', grid, [mob]);

    expect(broadcast).toHaveBeenCalledWith('room-1', expect.objectContaining({
      type: 'mob_spawn',
      roomId: 'room-1',
      mobId: mob.instanceId,
      mobName: mob.name,
    }));
  });

  it('registerRoom places multiple mobs on the grid', () => {
    const grid = makeGrid();
    const mob1 = makeMob('mob-1');
    const mob2 = makeMob('mob-2');
    const mob3 = makeMob('mob-3');
    manager.registerRoom('room-1', grid, [mob1, mob2, mob3]);

    const positions = manager.getMobPositions('room-1');
    expect(positions.length).toBe(3);

    const ids = manager.getMobIds('room-1');
    expect(ids).toContain('mob-1');
    expect(ids).toContain('mob-2');
    expect(ids).toContain('mob-3');

    // All entities should be in the grid
    expect(grid.getEntity('mob-1')).not.toBeNull();
    expect(grid.getEntity('mob-2')).not.toBeNull();
    expect(grid.getEntity('mob-3')).not.toBeNull();
  });

  it('registerRoom broadcasts mob_spawn for each mob', () => {
    const grid = makeGrid();
    const mob1 = makeMob('mob-1');
    const mob2 = makeMob('mob-2');
    manager.registerRoom('room-1', grid, [mob1, mob2]);

    const spawnMessages = broadcast.mock.calls
      .filter(([, msg]: [string, ServerMessage]) => msg.type === 'mob_spawn');
    expect(spawnMessages.length).toBe(2);
  });

  // --- Wandering ---

  it('mob moves after tick interval (mob_position messages broadcast)', () => {
    const grid = makeGrid();
    const mob = makeMob();
    manager.registerRoom('room-1', grid, [mob]);

    // Force non-idle by mocking Math.random to never idle
    vi.spyOn(Math, 'random').mockReturnValue(0.9); // > 0.3, won't idle; sort returns consistent order

    broadcast.mockClear();
    vi.advanceTimersByTime(1500);

    const posMessages = broadcast.mock.calls
      .filter(([, msg]: [string, ServerMessage]) => msg.type === 'mob_position');
    expect(posMessages.length).toBeGreaterThanOrEqual(1);
  });

  it('mob does not move after removeMob', () => {
    const grid = makeGrid();
    const mob = makeMob();
    manager.registerRoom('room-1', grid, [mob]);
    manager.removeMob('room-1');

    broadcast.mockClear();
    vi.advanceTimersByTime(3000);

    const posMessages = broadcast.mock.calls
      .filter(([, msg]: [string, ServerMessage]) => msg.type === 'mob_position');
    expect(posMessages.length).toBe(0);
  });

  // --- Detection ---

  it('fires onDetection when player within detection range', () => {
    const grid = makeGrid();
    const mob = makeMob();
    manager.registerRoom('room-1', grid, [mob]);

    const detectionFn = vi.fn();
    manager.onDetection = detectionFn;

    const mobPos = manager.getMobPositions('room-1')[0];
    // Place player adjacent (distance 1)
    manager.addPlayer('room-1', 'player-1', { x: mobPos.x + 1, y: mobPos.y });

    expect(detectionFn).toHaveBeenCalledWith('room-1', mob.instanceId);
  });

  it('does not fire onDetection when player is far away', () => {
    const grid = makeGrid(20, 20);
    const mob = makeMob();
    manager.registerRoom('room-1', grid, [mob]);

    const detectionFn = vi.fn();
    manager.onDetection = detectionFn;

    const mobPos = manager.getMobPositions('room-1')[0];
    // Place player far away (distance > detection range)
    const farX = mobPos.x <= 10 ? mobPos.x + 8 : mobPos.x - 8;
    const farY = mobPos.y;
    manager.addPlayer('room-1', 'player-1', { x: farX, y: farY });

    expect(detectionFn).not.toHaveBeenCalled();
  });

  it('fires onDetection when any mob in room is within range', () => {
    const grid = makeGrid();
    const mob1 = makeMob('mob-1');
    const mob2 = makeMob('mob-2');
    manager.registerRoom('room-1', grid, [mob1, mob2]);

    const detectionFn = vi.fn();
    manager.onDetection = detectionFn;

    // Place player adjacent to second mob's position
    const positions = manager.getMobPositions('room-1');
    const mob2Pos = positions[1];
    manager.addPlayer('room-1', 'player-1', { x: mob2Pos.x, y: mob2Pos.y });

    expect(detectionFn).toHaveBeenCalledWith('room-1', expect.any(String));
  });

  // --- reactivateMob ---

  it('reactivateMob resumes wandering after reactivation', () => {
    const grid = makeGrid();
    const mob = makeMob();
    manager.registerRoom('room-1', grid, [mob]);
    manager.pauseMob('room-1');

    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    broadcast.mockClear();
    vi.advanceTimersByTime(1500);

    // No position messages while paused
    let posMessages = broadcast.mock.calls
      .filter(([, msg]: [string, ServerMessage]) => msg.type === 'mob_position');
    expect(posMessages.length).toBe(0);

    // Reactivate and advance
    manager.reactivateMob('room-1');
    broadcast.mockClear();
    vi.advanceTimersByTime(1500);

    posMessages = broadcast.mock.calls
      .filter(([, msg]: [string, ServerMessage]) => msg.type === 'mob_position');
    expect(posMessages.length).toBeGreaterThanOrEqual(1);
  });

  it('reactivateMob broadcasts mob_spawn for all mobs', () => {
    const grid = makeGrid();
    const mob1 = makeMob('mob-1');
    const mob2 = makeMob('mob-2');
    manager.registerRoom('room-1', grid, [mob1, mob2]);
    manager.pauseMob('room-1');

    broadcast.mockClear();
    manager.reactivateMob('room-1');

    const spawnMessages = broadcast.mock.calls
      .filter(([, msg]: [string, ServerMessage]) => msg.type === 'mob_spawn');
    expect(spawnMessages.length).toBe(2);
  });

  // --- checkDetection ---

  it('checkDetection works for external player movement checks', () => {
    const grid = makeGrid();
    const mob = makeMob();
    manager.registerRoom('room-1', grid, [mob]);

    const detectionFn = vi.fn();
    manager.onDetection = detectionFn;

    const mobPos = manager.getMobPositions('room-1')[0];
    // Start player far away
    const farX = mobPos.x <= 10 ? mobPos.x + 8 : mobPos.x - 8;
    manager.addPlayer('room-1', 'player-1', { x: farX, y: mobPos.y });
    expect(detectionFn).not.toHaveBeenCalled();

    // Move player close
    manager.updatePlayerPosition('room-1', 'player-1', { x: mobPos.x, y: mobPos.y });
    manager.checkDetection('room-1');
    expect(detectionFn).toHaveBeenCalledWith('room-1', mob.instanceId);
  });

  // --- pauseMob ---

  it('pauseMob pauses wandering and broadcasts mob_despawn', () => {
    const grid = makeGrid();
    const mob = makeMob();
    manager.registerRoom('room-1', grid, [mob]);

    broadcast.mockClear();
    manager.pauseMob('room-1');

    expect(broadcast).toHaveBeenCalledWith('room-1', expect.objectContaining({
      type: 'mob_despawn',
      roomId: 'room-1',
      mobId: mob.instanceId,
    }));

    // Mob entity should be removed from grid
    expect(grid.getEntity(mob.instanceId)).toBeNull();

    // No moves happen while paused
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    broadcast.mockClear();
    vi.advanceTimersByTime(3000);

    const posMessages = broadcast.mock.calls
      .filter(([, msg]: [string, ServerMessage]) => msg.type === 'mob_position');
    expect(posMessages.length).toBe(0);
  });

  it('pauseMob pauses wandering and broadcasts mob_despawn for all mobs', () => {
    const grid = makeGrid();
    const mob1 = makeMob('mob-1');
    const mob2 = makeMob('mob-2');
    manager.registerRoom('room-1', grid, [mob1, mob2]);

    broadcast.mockClear();
    manager.pauseMob('room-1');

    const despawnMessages = broadcast.mock.calls
      .filter(([, msg]: [string, ServerMessage]) => msg.type === 'mob_despawn');
    expect(despawnMessages.length).toBe(2);

    // Both mob entities should be removed from grid
    expect(grid.getEntity('mob-1')).toBeNull();
    expect(grid.getEntity('mob-2')).toBeNull();
  });

  // --- removeMob ---

  it('removeMob removes all mobs and broadcasts despawn for each', () => {
    const grid = makeGrid();
    const mob1 = makeMob('mob-1');
    const mob2 = makeMob('mob-2');
    manager.registerRoom('room-1', grid, [mob1, mob2]);

    broadcast.mockClear();
    manager.removeMob('room-1');

    const despawnMessages = broadcast.mock.calls
      .filter(([, msg]: [string, ServerMessage]) => msg.type === 'mob_despawn');
    expect(despawnMessages.length).toBe(2);

    // Room should be fully removed
    expect(manager.hasRoom('room-1')).toBe(false);
    expect(grid.getEntity('mob-1')).toBeNull();
    expect(grid.getEntity('mob-2')).toBeNull();
  });
});
