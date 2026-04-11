import type { RoomGrid, GridPosition, GridDirection } from '@caverns/roomgrid';
import { chebyshevDistance, DIRECTION_OFFSETS } from '@caverns/roomgrid';
import type { MobInstance, ServerMessage } from '@caverns/shared';

const WANDER_INTERVAL_MS = 1500;
const PURSUIT_INTERVAL_MS = 600;
const IDLE_CHANCE = 0.3;
const DETECTION_RANGE = 2;
const PURSUIT_RANGE = 10;
const MIN_SPAWN_DISTANCE_FROM_EXIT = 5;

interface MobRoom {
  roomId: string;
  grid: RoomGrid;
  mob: MobInstance;
  mobPosition: GridPosition;
  paused: boolean;
  pursuing: boolean;
  playerPositions: Map<string, GridPosition>;
}

export class MobAIManager {
  private rooms = new Map<string, MobRoom>();
  private wanderIntervalId: ReturnType<typeof setInterval>;
  private pursuitIntervalId: ReturnType<typeof setInterval>;
  public onDetection: ((roomId: string, mobId: string) => void) | null = null;
  public onPursuitStart: ((roomId: string, mobId: string, x: number, y: number) => void) | null = null;

  constructor(private broadcastToRoom: (roomId: string, msg: ServerMessage) => void) {
    this.wanderIntervalId = setInterval(() => this.tick(false), WANDER_INTERVAL_MS);
    this.pursuitIntervalId = setInterval(() => this.tick(true), PURSUIT_INTERVAL_MS);
  }

  registerRoom(roomId: string, grid: RoomGrid, mob: MobInstance): void {
    const spawnPos = this.findSpawnPosition(grid);

    grid.addEntity({
      id: mob.instanceId,
      type: 'mob',
      position: spawnPos,
    });

    const mobRoom: MobRoom = {
      roomId,
      grid,
      mob,
      mobPosition: { ...spawnPos },
      paused: false,
      pursuing: false,
      playerPositions: new Map(),
    };

    this.rooms.set(roomId, mobRoom);

    this.broadcastToRoom(roomId, {
      type: 'mob_spawn',
      roomId,
      mobId: mob.instanceId,
      mobName: mob.name,
      x: spawnPos.x,
      y: spawnPos.y,
    });
  }

  removeMob(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.grid.removeEntity(room.mob.instanceId);
    this.rooms.delete(roomId);

    this.broadcastToRoom(roomId, {
      type: 'mob_despawn',
      roomId,
      mobId: room.mob.instanceId,
    });
  }

  pauseMob(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.paused = true;
    room.grid.removeEntity(room.mob.instanceId);

    this.broadcastToRoom(roomId, {
      type: 'mob_despawn',
      roomId,
      mobId: room.mob.instanceId,
    });
  }

  reactivateMob(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.paused = false;
    room.grid.addEntity({
      id: room.mob.instanceId,
      type: 'mob',
      position: { ...room.mobPosition },
    });

    this.broadcastToRoom(roomId, {
      type: 'mob_spawn',
      roomId,
      mobId: room.mob.instanceId,
      mobName: room.mob.name,
      x: room.mobPosition.x,
      y: room.mobPosition.y,
    });
  }

  addPlayer(roomId: string, playerId: string, position: GridPosition): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.playerPositions.set(playerId, { ...position });
    this.checkDetection(roomId);
  }

  removePlayer(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.playerPositions.delete(playerId);
  }

  updatePlayerPosition(roomId: string, playerId: string, position: GridPosition): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.playerPositions.set(playerId, { ...position });
  }

  getMobPosition(roomId: string): GridPosition | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    return { ...room.mobPosition };
  }

  getMobId(roomId: string): string | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    return room.mob.instanceId;
  }

  hasRoom(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  checkDetection(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room || room.paused) return;

    for (const playerPos of room.playerPositions.values()) {
      const dist = chebyshevDistance(room.mobPosition, playerPos);
      if (dist <= DETECTION_RANGE) {
        this.onDetection?.(roomId, room.mob.instanceId);
        return;
      }
    }
  }

  destroy(): void {
    clearInterval(this.wanderIntervalId);
    clearInterval(this.pursuitIntervalId);
  }

  private findSpawnPosition(grid: RoomGrid): GridPosition {
    const w = (grid as any).width as number;
    const h = (grid as any).height as number;

    // Collect exit tile positions (border tiles that are exits)
    const exitPositions: GridPosition[] = [];
    for (let x = 0; x < w; x++) {
      for (const y of [0, h - 1]) {
        const tile = grid.getTile({ x, y });
        if (tile?.type === 'exit') exitPositions.push({ x, y });
      }
    }
    for (let y = 1; y < h - 1; y++) {
      for (const x of [0, w - 1]) {
        const tile = grid.getTile({ x, y });
        if (tile?.type === 'exit') exitPositions.push({ x, y });
      }
    }

    // Collect walkable non-exit tiles far enough from all exits
    const farCandidates: GridPosition[] = [];
    const anyCandidates: GridPosition[] = [];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const pos = { x, y };
        const tile = grid.getTile(pos);
        if (!tile || !grid.isWalkable(pos) || tile.type === 'exit') continue;

        anyCandidates.push(pos);

        if (exitPositions.length === 0) {
          farCandidates.push(pos);
          continue;
        }

        const minDist = Math.min(...exitPositions.map(ep => chebyshevDistance(pos, ep)));
        if (minDist >= MIN_SPAWN_DISTANCE_FROM_EXIT) {
          farCandidates.push(pos);
        }
      }
    }

    const pool = farCandidates.length > 0 ? farCandidates : anyCandidates;
    if (pool.length === 0) {
      throw new Error('No walkable tiles found for mob spawn');
    }

    const idx = Math.floor(Math.random() * pool.length);
    return pool[idx];
  }

  private tick(pursuitTick: boolean): void {
    const directions = Object.keys(DIRECTION_OFFSETS) as GridDirection[];

    for (const room of this.rooms.values()) {
      if (room.paused) continue;

      // Find nearest player
      let nearestPlayer: GridPosition | null = null;
      let nearestDist = Infinity;
      for (const playerPos of room.playerPositions.values()) {
        const dist = chebyshevDistance(room.mobPosition, playerPos);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestPlayer = playerPos;
        }
      }

      const pursuing = nearestPlayer && nearestDist <= PURSUIT_RANGE;

      // Fire alert on transition to pursuit
      if (pursuing && !room.pursuing) {
        room.pursuing = true;
        this.onPursuitStart?.(room.roomId, room.mob.instanceId, room.mobPosition.x, room.mobPosition.y);
      } else if (!pursuing) {
        room.pursuing = false;
      }

      // Pursuing rooms only act on pursuit ticks, wandering rooms only on wander ticks
      if (pursuing !== pursuitTick) continue;

      if (!pursuing) {
        if (Math.random() < IDLE_CHANCE) continue;
      }

      let moveDirections: GridDirection[];
      if (pursuing) {
        moveDirections = [...directions].sort((a, b) => {
          const oa = DIRECTION_OFFSETS[a];
          const ob = DIRECTION_OFFSETS[b];
          const posA = { x: room.mobPosition.x + oa.dx, y: room.mobPosition.y + oa.dy };
          const posB = { x: room.mobPosition.x + ob.dx, y: room.mobPosition.y + ob.dy };
          return chebyshevDistance(posA, nearestPlayer!) - chebyshevDistance(posB, nearestPlayer!);
        });
      } else {
        moveDirections = [...directions].sort(() => Math.random() - 0.5);
      }

      for (const dir of moveDirections) {
        const result = room.grid.moveEntity(room.mob.instanceId, dir);
        if (result.success && result.newPosition) {
          room.mobPosition = { ...result.newPosition };

          this.broadcastToRoom(room.roomId, {
            type: 'mob_position',
            roomId: room.roomId,
            mobId: room.mob.instanceId,
            x: result.newPosition.x,
            y: result.newPosition.y,
          });

          this.checkDetection(room.roomId);
          break;
        }
      }
    }
  }
}
