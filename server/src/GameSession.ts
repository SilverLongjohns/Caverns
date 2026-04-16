import {
  type Room,
  type MobTemplate,
  type MobInstance,
  type Item,
  type Direction,
  type Player,
  type DungeonContent,
  type ServerMessage,
  type GridDirection,
  type DropSpecRef,
  DROP_SPECS,
  DRIPPING_HALLS,
  clampCritMultiplier,
  clampDamageReduction,
  QTE_CONFIG,
  ENERGY_CONFIG,
  LOOT_CONFIG,
  TIMING_CONFIG,
  DUNGEON_CONFIG,
  PROGRESSION_CONFIG,
  ENCOUNTER_CONFIG,
  getClassDefinition,
  getPlayerEquippedEffects,
  computePlayerStats,
  type EquippedEffect,
  type EquipmentSlot,
} from '@caverns/shared';
import { resolveDrops, type DropResult } from './DropResolver.js';
import { generateItem } from '@caverns/itemgen';
import { PlayerManager } from './PlayerManager.js';
import { type CombatPlayerInfo } from './CombatManager.js';
import { ArenaCombatManager } from './ArenaCombatManager.js';
import { buildArenaGrid, placeStartingPositions } from './arenaGridBuilder.js';
import { LootManager } from './LootManager.js';
import { AbilityResolver } from './AbilityResolver.js';
import { InteractionResolver } from './InteractionResolver.js';
import { buildTileGrid } from './tileGridBuilder.js';
import { RoomGrid } from '@caverns/roomgrid';
import type { RoomGridConfig, TileType, GridPosition } from '@caverns/roomgrid';
import { hasLineOfSight, isAdjacent } from './arenaMovement.js';
import { MobAIManager } from './MobAIManager.js';
import { exitPosition } from './tileGridBuilder.js';
import type { CharacterRepository } from './CharacterRepository.js';
import type { ActiveSessionMap } from './ActiveSessionMap.js';
import { playerFromCharacter, characterSnapshotFromPlayer } from './characterAdapter.js';
import type { InteractableDefinition, InteractableInstance, MobPoolEntry } from '@caverns/shared';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename_gs = fileURLToPath(import.meta.url);
const __dirname_gs = dirname(__filename_gs);
const allInteractableDefs: InteractableDefinition[] = JSON.parse(
  readFileSync(resolve(__dirname_gs, '../../shared/src/data/interactables.json'), 'utf-8')
);
const allMobPool: MobPoolEntry[] = JSON.parse(
  readFileSync(resolve(__dirname_gs, '../../shared/src/data/mobPool.json'), 'utf-8')
);
const allItemsList: Item[] = JSON.parse(
  readFileSync(resolve(__dirname_gs, '../../shared/src/data/items.json'), 'utf-8')
);
const allUniqueItemsList: Item[] = JSON.parse(
  readFileSync(resolve(__dirname_gs, '../../shared/src/data/uniqueItems.json'), 'utf-8')
);
const allItemsById = new Map<string, Item>(
  [...allItemsList, ...allUniqueItemsList].map(i => [i.id, i])
);

export interface GameSessionOrigin {
  worldId: string;
  portalId: string;
  portalPos: { x: number; y: number };
}

export class GameSession {
  private rooms: Map<string, Room>;
  private mobs: Map<string, MobTemplate>;
  private items: Map<string, Item>;
  private revealedRooms = new Set<string>();
  private clearedRooms = new Set<string>();
  private roomDropsProcessed = new Set<string>();
  private solvedPuzzles = new Set<string>();
  private activePuzzleSolver = new Map<string, string>(); // roomId -> playerId
  private combats = new Map<string, ArenaCombatManager>();
  private playerManager = new PlayerManager();
  private lootManager: LootManager;
  private content: DungeonContent;
  private broadcast: (msg: ServerMessage) => void;
  private sendTo: (playerId: string, msg: ServerMessage) => void;
  private broadcastToRoom: (roomId: string, msg: ServerMessage) => void;
  private playerIds: string[] = [];
  private playerNames = new Map<string, string>();
  // Per-connection account/character context (Task 14+). Populated from index.ts
  // when a character is attached via attachCharacterContext().
  private connectionContexts = new Map<string, { accountId: string; characterId: string }>();
  // Pre-hydrated players (from DB) staged before startGame runs.
  private hydratedPlayers = new Map<string, Player>();
  // Tracks which connections are currently disconnected (for AFK auto-skip).
  private disconnectedConnections = new Set<string>();
  // Debounced gold snapshot timers.
  private goldWriteTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Whether lifecycle cleanup has already run so we don't double-snapshot.
  private lifecycleCleanedUp = false;
  private abilityResolver = new AbilityResolver();
  private interactionResolver!: InteractionResolver;
  private playerClasses = new Map<string, string>(); // playerId -> className
  private secretRoomLinks = new Map<string, { secretRoomId: string; sourceRoomId: string }>(); // interactableInstanceId -> secret room
  private nextSecretRoomId = 1;
  private roomGrids = new Map<string, RoomGrid>();
  private mobAIManager!: MobAIManager;
  private playerGridPositions = new Map<string, GridPosition>();
  private lastGridMove = new Map<string, number>();
  private roomMobInstances = new Map<string, MobInstance[]>();
  private biomeId: string;
  private started = false;
  private pendingDefend: {
    roomId: string;
    targetId: string;
    mobId: string;
    rawDamage: number;
    timeout: ReturnType<typeof setTimeout>;
  } | null = null;

  constructor(
    broadcast: (msg: ServerMessage) => void,
    sendTo: (playerId: string, msg: ServerMessage) => void,
    content?: DungeonContent,
    private onGameOver?: (origin?: GameSessionOrigin) => void,
    private characters: CharacterRepository | null = null,
    private activeSessions: ActiveSessionMap | null = null,
    public readonly sessionId: string = 'dev-session',
    private readonly origin?: GameSessionOrigin,
  ) {
    this.broadcast = broadcast;
    this.sendTo = sendTo;
    this.broadcastToRoom = (roomId: string, msg: ServerMessage) => {
      for (const p of this.playerManager.getPlayersInRoom(roomId)) {
        this.sendTo(p.id, msg);
      }
    };
    this.content = content ?? DRIPPING_HALLS;
    this.biomeId = this.content.biomeId;
    this.rooms = new Map(this.content.rooms.map((r) => [r.id, r]));
    this.mobs = new Map(this.content.mobs.map((m) => [m.id, m]));
    this.items = new Map(this.content.items.map((i) => [i.id, i]));
    this.interactionResolver = new InteractionResolver(allInteractableDefs, this.content.items);
    this.lootManager = new LootManager(
      (item, winnerId) => { this.handleLootAwarded(item, winnerId); },
      () => { this.broadcast({ type: 'loot_prompt', items: [], timeout: 0 }); },
      (playerId, itemName, choice) => {
        const player = this.playerManager.getPlayer(playerId);
        if (!player) return;
        this.broadcastToRoom(player.roomId, {
          type: 'text_log',
          message: `${player.name} selects ${choice.toUpperCase()} on ${itemName}.`,
          logType: 'loot',
        });
      },
      (itemName, rolls, winnerId) => {
        if (rolls.length === 0) return;
        const roomId = this.playerManager.getPlayer(rolls[0].playerId)?.roomId;
        if (!roomId) return;
        const rollLines = rolls.map((r) => {
          const name = this.playerManager.getPlayer(r.playerId)?.name ?? 'Unknown';
          return `  ${name} rolled ${r.roll}`;
        }).join('\n');
        this.broadcastToRoom(roomId, {
          type: 'text_log',
          message: `Roll-off for ${itemName}:\n${rollLines}`,
          logType: 'loot',
        });
      },
    );
    this.mobAIManager = new MobAIManager(this.broadcastToRoom);
    this.mobAIManager.onDetection = (roomId: string, mobId: string) => {
      this.handleMobDetection(roomId, mobId);
    };
    this.mobAIManager.onPursuitStart = (roomId: string, mobId: string, x: number, y: number) => {
      this.broadcast({ type: 'mob_alert', roomId, mobId, x, y });
    };
  }

  addPlayer(id: string, name: string, className: string = 'vanguard'): void {
    this.playerIds.push(id);
    this.playerNames.set(id, name);
    this.playerClasses.set(id, className);
  }

  /**
   * Register an account/character context for a connection. Called from
   * index.ts after a character has been selected and the lobby start_game
   * fires. Enables snapshot/reconnect flows.
   */
  attachCharacterContext(connectionId: string, ctx: { accountId: string; characterId: string }): void {
    this.connectionContexts.set(connectionId, ctx);
  }

  markDisconnected(connectionId: string): void {
    this.disconnectedConnections.add(connectionId);
  }

  markConnected(connectionId: string): void {
    this.disconnectedConnections.delete(connectionId);
  }

  hasPlayer(connectionId: string): boolean {
    return this.playerManager.getPlayer(connectionId) != null;
  }

  getPlayerName(connectionId: string): string | undefined {
    return this.playerNames.get(connectionId);
  }

  getOrigin(): GameSessionOrigin | undefined {
    return this.origin;
  }

  getAllConnectionIds(): string[] {
    return [...this.playerIds];
  }

  /**
   * Hydrate a player from the persisted character row. Called from index.ts
   * before startGame(). Also attaches the connection to the active sessions map.
   */
  async hydratePlayerFromCharacter(
    connectionId: string,
    accountId: string,
    characterId: string,
  ): Promise<boolean> {
    if (!this.characters) return false;
    const row = await this.characters.getById(characterId);
    if (!row) return false;
    // roomId gets overwritten in startGame with the actual entrance id.
    const player = playerFromCharacter(row, connectionId, this.content.entranceRoomId);
    this.hydratedPlayers.set(connectionId, player);
    this.connectionContexts.set(connectionId, { accountId, characterId });
    this.activeSessions?.attach(accountId, this.sessionId);
    return true;
  }

  findConnectionByAccount(accountId: string): string | undefined {
    for (const [conn, ctx] of this.connectionContexts) {
      if (ctx.accountId === accountId) return conn;
    }
    return undefined;
  }

  getCharacterIdFor(connectionId: string): string | undefined {
    return this.connectionContexts.get(connectionId)?.characterId;
  }

  private async snapshotPlayer(playerId: string): Promise<void> {
    if (!this.characters) return;
    const player = this.playerManager.getPlayer(playerId);
    if (!player) return;
    const ctx = this.connectionContexts.get(playerId);
    if (!ctx?.characterId) return;
    try {
      await this.characters.snapshot(ctx.characterId, characterSnapshotFromPlayer(player));
    } catch (err) {
      console.error('[GameSession] snapshotPlayer failed', err);
    }
  }

  private scheduleGoldSnapshot(playerId: string): void {
    const existing = this.goldWriteTimers.get(playerId);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      this.goldWriteTimers.delete(playerId);
      void this.snapshotPlayer(playerId);
    }, 500);
    this.goldWriteTimers.set(playerId, t);
  }

  /**
   * Rekey a player slot from an old connection id to a new one and send a
   * catch-up snapshot to the new socket. Used by the resume_session flow.
   */
  reattachConnection(oldConnectionId: string, newConnectionId: string): boolean {
    const player = this.playerManager.getPlayer(oldConnectionId);
    if (!player) return false;
    this.playerManager.replacePlayerId(oldConnectionId, newConnectionId);
    // Transfer our internal tracking.
    const ctx = this.connectionContexts.get(oldConnectionId);
    if (ctx) {
      this.connectionContexts.set(newConnectionId, ctx);
      this.connectionContexts.delete(oldConnectionId);
    }
    const gridPos = this.playerGridPositions.get(oldConnectionId);
    if (gridPos) {
      this.playerGridPositions.set(newConnectionId, gridPos);
      this.playerGridPositions.delete(oldConnectionId);
    }
    const name = this.playerNames.get(oldConnectionId);
    if (name !== undefined) {
      this.playerNames.set(newConnectionId, name);
      this.playerNames.delete(oldConnectionId);
    }
    const cls = this.playerClasses.get(oldConnectionId);
    if (cls !== undefined) {
      this.playerClasses.set(newConnectionId, cls);
      this.playerClasses.delete(oldConnectionId);
    }
    const idx = this.playerIds.indexOf(oldConnectionId);
    if (idx >= 0) this.playerIds[idx] = newConnectionId;
    // Cancel any AFK timer — the player is back.
    for (const combat of this.combats.values()) {
      combat.cancelAfkTimer();
    }
    // Send catch-up state.
    const refreshed = this.playerManager.getPlayer(newConnectionId);
    if (refreshed) {
      const room = this.rooms.get(refreshed.roomId);
      if (room) this.sendTo(newConnectionId, { type: 'room_reveal', room });
      this.sendTo(newConnectionId, { type: 'player_update', player: refreshed });
    }
    return true;
  }

  startGame(): void {
    this.started = true;

    // Generate tile grids for rooms that don't have one (e.g., DRIPPING_HALLS)
    for (const [, room] of this.rooms) {
      if (!room.tileGrid) {
        room.tileGrid = buildTileGrid(room, 'starter');
      }
    }

    const entranceId = this.content.entranceRoomId;
    for (const pid of this.playerIds) {
      const hydrated = this.hydratedPlayers.get(pid);
      if (hydrated) {
        hydrated.roomId = entranceId;
        // Inject into PlayerManager's internal map via replacePlayerId trick:
        // add a blank then overwrite with hydrated fields.
        this.playerManager.addHydratedPlayer(hydrated);
        // Also sync name/class so downstream code using playerNames is correct.
        this.playerNames.set(pid, hydrated.name);
        this.playerClasses.set(pid, hydrated.className);
        // Immediately snapshot so last_played_at updates.
        void this.snapshotPlayer(pid);
      } else {
        const className = this.playerClasses.get(pid) ?? 'vanguard';
        this.playerManager.addPlayer(pid, this.playerNames.get(pid)!, entranceId, className);
      }
    }
    this.revealedRooms.add(entranceId);
    const entrance = this.rooms.get(entranceId)!;
    const revealedRoomMap: Record<string, Room> = {};
    revealedRoomMap[entranceId] = entrance;
    const playerMap: Record<string, Player> = {};
    for (const p of this.playerManager.getAllPlayers()) {
      playerMap[p.id] = p;
    }

    // Create RoomGrid for entrance
    const entranceGrid = this.createRoomGrid(entranceId);

    // If entrance has an encounter, register mob
    if (entrance.encounter && !this.clearedRooms.has(entranceId)) {
      const template = this.mobs.get(entrance.encounter.mobId);
      if (template) {
        const mobs = this.buildEncounterMobs(entranceId, template);
        this.mobAIManager.registerRoom(entranceId, entranceGrid, mobs);
      }
    }

    const entranceCenter = this.findWalkableCenter(entranceId);
    const playerPositions: Record<string, { x: number; y: number }> = {};
    for (const pid of this.playerIds) {
      this.playerGridPositions.set(pid, { ...entranceCenter });
      playerPositions[pid] = { ...entranceCenter };
      entranceGrid.addEntity({ id: pid, type: 'player', position: { ...entranceCenter } });
      this.mobAIManager.addPlayer(entranceId, pid, entranceCenter);
    }

    for (const pid of this.playerIds) {
      this.sendTo(pid, {
        type: 'game_start', playerId: pid,
        players: playerMap, rooms: revealedRoomMap, currentRoomId: entranceId,
        playerPositions,
      });
    }
    this.broadcast({
      type: 'text_log',
      message: `--- ${entrance.name} ---\n${entrance.description}\n\nExits: ${Object.keys(entrance.exits).join(', ')}`,
      logType: 'narration',
    });
  }

  getPlayerRoom(playerId: string): string | undefined {
    return this.playerManager.getPlayer(playerId)?.roomId;
  }

  isRoomRevealed(roomId: string): boolean {
    return this.revealedRooms.has(roomId);
  }

  clearRoom(roomId: string): void {
    this.clearedRooms.add(roomId);
    this.combats.delete(roomId);
    for (const p of this.playerManager.getPlayersInRoom(roomId)) {
      if (p.status === 'in_combat') {
        this.playerManager.setStatus(p.id, 'exploring');
      }
    }
  }

  private checkTorchPickup(playerId: string, roomId: string, pos: { x: number; y: number }): void {
    const room = this.rooms.get(roomId);
    if (!room?.tileGrid?.themes) return;

    const { themes, tiles } = room.tileGrid;
    // Check 4 orthogonal neighbors for torch-themed wall tiles
    const neighbors = [
      { x: pos.x, y: pos.y - 1 },
      { x: pos.x, y: pos.y + 1 },
      { x: pos.x - 1, y: pos.y },
      { x: pos.x + 1, y: pos.y },
    ];

    for (const n of neighbors) {
      if (n.y < 0 || n.y >= themes.length) continue;
      if (n.x < 0 || n.x >= (themes[0]?.length ?? 0)) continue;
      if (themes[n.y][n.x] === 'torch' && tiles[n.y][n.x] === 'wall') {
        // Remove torch from room data
        themes[n.y][n.x] = null;

        // Broadcast pickup
        this.broadcastToRoom(roomId, {
          type: 'torch_pickup',
          playerId,
          position: { x: n.x, y: n.y },
          fuel: 60,
        } as any);

        this.broadcastToRoom(roomId, {
          type: 'text_log',
          message: 'You grab a torch from the wall. The shadows retreat.',
          logType: 'narration',
        });

        return; // Only pick up one torch per move
      }
    }
  }

  /**
   * BFS from an exit tile to find the nearest walkable tile that has at least
   * 2 walkable cardinal neighbors, so the player isn't boxed in.
   */
  private findSpawnNearExit(grid: RoomGrid, exitPos: GridPosition): GridPosition {
    const visited = new Set<string>();
    const queue: GridPosition[] = [];

    // Seed BFS with cardinal neighbors of the exit
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const pos = { x: exitPos.x + dx, y: exitPos.y + dy };
      const key = `${pos.x},${pos.y}`;
      if (!visited.has(key) && grid.isWalkable(pos)) {
        visited.add(key);
        queue.push(pos);
      }
    }

    while (queue.length > 0) {
      const pos = queue.shift()!;
      // Count walkable cardinal neighbors
      let walkableNeighbors = 0;
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        if (grid.isWalkable({ x: pos.x + dx, y: pos.y + dy })) walkableNeighbors++;
      }
      if (walkableNeighbors >= 2) return pos;

      // Expand BFS
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const next = { x: pos.x + dx, y: pos.y + dy };
        const key = `${next.x},${next.y}`;
        if (!visited.has(key) && grid.isWalkable(next)) {
          visited.add(key);
          queue.push(next);
        }
      }
    }

    // Fallback: just use first walkable neighbor of exit
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const pos = { x: exitPos.x + dx, y: exitPos.y + dy };
      if (grid.isWalkable(pos)) return pos;
    }
    return exitPos;
  }

  private findWalkableCenter(roomId: string): GridPosition {
    const grid = this.roomGrids.get(roomId)!;
    const room = this.rooms.get(roomId)!;
    const w = room.tileGrid!.width;
    const h = room.tileGrid!.height;
    const center: GridPosition = { x: Math.floor(w / 2), y: Math.floor(h / 2) };
    if (grid.isWalkable(center)) return center;
    // Spiral outward to find nearest walkable tile
    for (let r = 1; r < Math.max(w, h); r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const pos: GridPosition = { x: center.x + dx, y: center.y + dy };
          if (grid.isWalkable(pos)) return pos;
        }
      }
    }
    return center; // fallback
  }

  private createRoomGrid(roomId: string): RoomGrid {
    const room = this.rooms.get(roomId)!;
    const tileGrid = room.tileGrid!;
    const tiles = tileGrid.tiles as unknown as TileType[][];
    const exits: RoomGridConfig['exits'] = [];

    const allExits = { ...room.lockedExits, ...room.exits };
    for (const [dir, targetId] of Object.entries(allExits)) {
      if (!targetId) continue;
      const pos = exitPosition(dir as any, tileGrid.width, tileGrid.height);
      exits.push({ position: pos, data: { direction: dir as any, targetRoomId: targetId } });
    }

    const grid = new RoomGrid({ width: tileGrid.width, height: tileGrid.height, tiles, exits });

    // Add interactable entities to the grid (skip if position isn't walkable)
    if (room.interactables) {
      for (const inst of room.interactables) {
        if (grid.isWalkable(inst.position)) {
          grid.addEntity({ id: inst.instanceId, type: 'interactable', position: { ...inst.position } });
        }
      }
    }

    this.roomGrids.set(roomId, grid);
    return grid;
  }

  handleGridMove(playerId: string, direction: string): void {
    const player = this.playerManager.getPlayer(playerId);
    if (!player) return;
    if (player.status === 'in_combat') {
      this.sendTo(playerId, { type: 'error', message: 'You cannot move while in combat. Use Flee to escape.' });
      return;
    }
    if (player.status === 'downed') {
      this.sendTo(playerId, { type: 'error', message: 'You are downed and cannot move.' });
      return;
    }

    // Rate limit: 150ms between moves
    const now = Date.now();
    const lastMove = this.lastGridMove.get(playerId) ?? 0;
    if (now - lastMove < 150) return;
    this.lastGridMove.set(playerId, now);

    const grid = this.roomGrids.get(player.roomId);
    if (!grid) return;

    const moveResult = grid.moveEntity(playerId, direction as GridDirection);
    if (!moveResult.success) return;

    // Update position tracking
    if (moveResult.newPosition) {
      this.playerGridPositions.set(playerId, { ...moveResult.newPosition });
      this.mobAIManager.updatePlayerPosition(player.roomId, playerId, moveResult.newPosition);
      this.broadcastToRoom(player.roomId, {
        type: 'player_position',
        playerId,
        roomId: player.roomId,
        x: moveResult.newPosition.x,
        y: moveResult.newPosition.y,
      });
    }

    if (moveResult.newPosition) {
      this.checkTorchPickup(playerId, player.roomId, moveResult.newPosition);
    }

    // Handle events from the move
    for (const event of moveResult.events) {
      switch (event.type) {
        case 'exit': {
          const exitDir: Direction = event.exit.direction;
          const targetRoomId = event.exit.targetRoomId;
          const currentRoom = this.rooms.get(player.roomId)!;
          const targetRoom = this.rooms.get(targetRoomId);
          if (!targetRoom) break;

          // Check if exit is locked
          const lockedKeyId = currentRoom.lockedExits?.[exitDir];
          if (lockedKeyId) {
            const playersInRoom = this.playerManager.getPlayersInRoom(player.roomId);
            const hasKey = playersInRoom.some(p => p.keychain.includes(lockedKeyId));
            if (!hasKey) {
              // Move player back off the exit tile
              const oppositeGridDir = this.getOppositeGridDir(direction);
              if (oppositeGridDir) {
                grid.moveEntity(playerId, oppositeGridDir as GridDirection);
              }
              this.sendTo(playerId, { type: 'error', message: 'This passage is locked. You need a key to proceed.' });
              return;
            }
            // Unlock permanently
            delete currentRoom.lockedExits![exitDir];
            this.broadcastToRoom(player.roomId, {
              type: 'text_log',
              message: 'The lock clicks open. The passage is now clear.',
              logType: 'system',
            });
          }

          // Remove player from current room grid and mob AI
          const oldRoomId = player.roomId;
          grid.removeEntity(playerId);
          this.mobAIManager.removePlayer(oldRoomId, playerId);

          // Move player via playerManager
          this.playerManager.movePlayer(playerId, targetRoomId);

          // Reveal new room if needed
          if (!this.revealedRooms.has(targetRoomId)) {
            this.revealedRooms.add(targetRoomId);
            this.broadcast({ type: 'room_reveal', room: targetRoom });
          }
          // Create RoomGrid and register mob if grid doesn't exist yet
          if (!this.roomGrids.has(targetRoomId)) {
            const newGrid = this.createRoomGrid(targetRoomId);
            if (targetRoom.encounter && !this.clearedRooms.has(targetRoomId)) {
              const template = this.mobs.get(targetRoom.encounter.mobId);
              if (template) {
                const mobs = this.buildEncounterMobs(targetRoomId, template);
                this.mobAIManager.registerRoom(targetRoomId, newGrid, mobs);
              }
            }
          }

          // Spawn player near opposite exit in new room, on a tile with room to move
          const oppositeDir = this.getOppositeDirection(exitDir);
          const newRoomGrid = this.roomGrids.get(targetRoomId)!;
          const exitPos = exitPosition(oppositeDir, targetRoom.tileGrid!.width, targetRoom.tileGrid!.height);
          const spawnPos = this.findSpawnNearExit(newRoomGrid, exitPos);
          this.playerGridPositions.set(playerId, { ...spawnPos });
          newRoomGrid.addEntity({ id: playerId, type: 'player', position: { ...spawnPos } });
          this.mobAIManager.addPlayer(targetRoomId, playerId, spawnPos);
          this.checkTorchPickup(playerId, targetRoomId, spawnPos);

          // Broadcast player_moved with coordinates
          this.broadcast({ type: 'player_moved', playerId, roomId: targetRoomId, x: spawnPos.x, y: spawnPos.y });
          this.broadcast({
            type: 'text_log',
            message: `${player.name} moves ${exitDir} to ${targetRoom.name}.`,
            logType: 'system',
          });
          this.sendTo(playerId, {
            type: 'text_log',
            message: `--- ${targetRoom.name} ---\n${targetRoom.description}\n\nExits: ${Object.keys(targetRoom.exits).join(', ')}`,
            logType: 'narration',
          });
          if (this.content.zoneTransitions?.[targetRoomId]) {
            this.broadcast({
              type: 'text_log',
              message: this.content.zoneTransitions[targetRoomId],
              logType: 'narration',
            });
          }

          // Fire on_room_enter passive triggers
          this.firePassiveTrigger(playerId, 'on_room_enter', targetRoomId);

          // Join existing combat if one is already in progress
          if (this.combats.has(targetRoomId)) {
            this.joinExistingCombat(playerId, targetRoomId);
          }
          return; // Exit event handled, stop processing other events
        }
        case 'hazard': {
          this.playerManager.takeDamage(playerId, event.damage);
          this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(playerId)! });
          this.broadcastToRoom(player.roomId, {
            type: 'text_log',
            message: `${player.name} takes ${event.damage} damage from a hazard!`,
            logType: 'combat',
          });
          break;
        }
        case 'interact': {
          // Open interaction menu — player stays on the tile
          this.handleInteract(playerId, event.entityId);
          return;
        }
        case 'combat':
          // No-op: handled by mob detection check below
          break;
      }
    }

    // Check mob detection after movement
    this.checkMobDetection(player.roomId);
  }

  private checkMobDetection(roomId: string): void {
    this.mobAIManager.checkDetection(roomId);
  }

  private getOppositeDirection(dir: Direction): Direction {
    switch (dir) {
      case 'north': return 'south';
      case 'south': return 'north';
      case 'east': return 'west';
      case 'west': return 'east';
    }
  }

  private getOppositeGridDir(dir: string): string | null {
    const opposites: Record<string, string> = {
      n: 's', s: 'n', e: 'w', w: 'e', ne: 'sw', nw: 'se', se: 'nw', sw: 'ne',
    };
    return opposites[dir] ?? null;
  }

  private handleMobDetection(roomId: string, mobId: string): void {
    if (this.combats.has(roomId)) return;
    if (this.clearedRooms.has(roomId)) return;

    const room = this.rooms.get(roomId);
    if (!room?.encounter) return;

    this.mobAIManager.pauseMob(roomId);
    const mobs = this.roomMobInstances.get(roomId) ?? [];
    if (mobs.length === 0) return;
    this.startCombat(roomId, mobs);
  }

  private startCombat(roomId: string, mobInstances: MobInstance[]): void {
    if (mobInstances.length === 0) return;
    const leaderTemplate = this.mobs.get(mobInstances[0].templateId);
    const playersInRoom = this.playerManager.getPlayersInRoom(roomId);
    const combatPlayers: CombatPlayerInfo[] = playersInRoom.map((p) => {
      const stats = this.playerManager.getComputedStats(p.id);
      return { id: p.id, name: p.name, hp: p.hp, maxHp: stats.maxHp, damage: stats.damage, defense: stats.defense, initiative: stats.initiative, className: p.className };
    });
    const playerEffects = new Map<string, EquippedEffect[]>();
    const usedDungeonEffects = new Map<string, string[]>();
    for (const p of playersInRoom) {
      playerEffects.set(p.id, getPlayerEquippedEffects(p));
      usedDungeonEffects.set(p.id, [...(p.usedEffects ?? [])]);
    }
    for (const p of playersInRoom) {
      this.playerManager.setStatus(p.id, 'in_combat');
      this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(p.id)! });
    }
    // Generate arena grid
    const biomeId = this.content.biomeId;
    const room = this.rooms.get(roomId)!;
    const arenaGrid = buildArenaGrid(room.type, biomeId);
    const playerIds = combatPlayers.map(p => p.id);
    const mobInstanceIds = mobInstances.map(m => m.instanceId);
    const positions = placeStartingPositions(arenaGrid, playerIds, mobInstanceIds);

    const combat = new ArenaCombatManager(
      roomId, arenaGrid, combatPlayers, mobInstances, positions,
      playerEffects, usedDungeonEffects,
    );
    this.combats.set(roomId, combat);

    // Build encounter text
    const skulls = leaderTemplate ? '\u2620'.repeat(leaderTemplate.skullRating) : '\u2620';
    const description = leaderTemplate?.description ?? '';
    let encounterText: string;
    if (mobInstances.length === 1) {
      encounterText = `A ${mobInstances[0].name} appears! (${skulls})\n${description}`;
    } else {
      // Group adds (everything after leader) by name
      const adds = mobInstances.slice(1);
      const addCounts = new Map<string, number>();
      for (const add of adds) {
        addCounts.set(add.name, (addCounts.get(add.name) ?? 0) + 1);
      }
      const addParts: string[] = [];
      for (const [name, count] of addCounts) {
        if (count === 1) {
          addParts.push(`a ${name}`);
        } else {
          addParts.push(`${count} ${name}s`);
        }
      }
      encounterText = `A ${mobInstances[0].name} appears with ${addParts.join(' and ')}! (${skulls})\n${description}`;
    }

    this.broadcastToRoom(roomId, {
      type: 'text_log',
      message: encounterText,
      logType: 'combat',
    });
    this.broadcastToRoom(roomId, {
      type: 'arena_combat_start',
      tileGrid: arenaGrid,
      positions,
      combat: combat.getCombatState(),
    } as any);
    const firstTurnId = combat.getCurrentTurnId();
    combat.startTurn(firstTurnId);
    if (combat.isMobTurn(firstTurnId)) {
      this.processMobTurn(roomId, combat);
    } else {
      this.broadcastTurnPrompt(combat);
    }
  }

  private joinExistingCombat(playerId: string, roomId: string): void {
    const combat = this.combats.get(roomId);
    if (!combat) return;
    const player = this.playerManager.getPlayer(playerId)!;
    const stats = this.playerManager.getComputedStats(playerId);
    this.playerManager.setStatus(playerId, 'in_combat');
    this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(playerId)! });
    combat.addPlayer({
      id: playerId, name: player.name, hp: player.hp,
      maxHp: stats.maxHp, damage: stats.damage, defense: stats.defense, initiative: stats.initiative,
      className: player.className,
    }, getPlayerEquippedEffects(player), [...(player.usedEffects ?? [])]);
    this.broadcastToRoom(roomId, { type: 'text_log', message: `${player.name} joins the fight!`, logType: 'combat' });
    this.broadcastToRoom(roomId, {
      type: 'arena_combat_start',
      tileGrid: combat.getGrid(),
      positions: combat.getAllPositions(),
      combat: combat.getCombatState(),
    } as any);
  }

  handleArenaMove(playerId: string, targetX: number, targetY: number): void {
    const player = this.playerManager.getPlayer(playerId);
    if (!player || player.status !== 'in_combat') return;
    const combat = this.combats.get(player.roomId);
    if (!combat || !combat.isPlayerTurn(playerId)) return;

    const result = combat.handleMove(playerId, { x: targetX, y: targetY });
    if (result.success) {
      this.broadcastToRoom(player.roomId, {
        type: 'arena_positions_update',
        positions: combat.getAllPositions(),
        movementRemaining: result.movementRemaining,
        path: result.path,
        moverId: playerId,
      } as any);
    } else {
      this.sendTo(playerId, { type: 'error', message: 'Cannot move there.' });
    }
  }

  handleArenaEndTurn(playerId: string): void {
    const player = this.playerManager.getPlayer(playerId);
    if (!player || player.status !== 'in_combat') return;
    const combat = this.combats.get(player.roomId);
    if (!combat || !combat.isPlayerTurn(playerId)) return;
    combat.cancelAfkTimer();
    combat.advanceTurn();
    this.afterCombatTurn(player.roomId, combat);
  }

  handleCombatAction(
    playerId: string,
    action: 'attack' | 'defend' | 'use_item' | 'flee',
    targetId?: string, itemIndex?: number, fleeDirection?: Direction,
    critMultiplier?: number
  ): void {
    const player = this.playerManager.getPlayer(playerId);
    if (!player || player.status !== 'in_combat') return;
    const combat = this.combats.get(player.roomId);
    if (!combat || !combat.isPlayerTurn(playerId)) return;
    combat.cancelAfkTimer();
    // Validate adjacency for attack
    if (action === 'attack' && targetId) {
      if (!combat.validateAttack(playerId, targetId)) {
        this.sendTo(playerId, { type: 'error', message: 'Target is not adjacent.' });
        return;
      }
    }
    // Validate flee requires edge tile
    if (action === 'flee') {
      if (!combat.canFlee(playerId)) {
        this.sendTo(playerId, { type: 'error', message: 'Must be on an edge tile to flee.' });
        return;
      }
    }
    let itemDamage: number | undefined;
    let itemHealing: number | undefined;
    if (action === 'use_item' && itemIndex !== undefined) {
      const consumeResult = this.playerManager.useConsumable(playerId, itemIndex);
      if (!consumeResult) {
        this.sendTo(playerId, { type: 'error', message: 'No item in that slot.' });
        return;
      }
      itemDamage = consumeResult.damage;
      itemHealing = consumeResult.healing;
      this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(playerId)! });
    }
    const clampedCrit = action === 'attack' && critMultiplier !== undefined
      ? clampCritMultiplier(critMultiplier) : undefined;
    const combatRoomId = player.roomId;
    const result = combat.resolvePlayerAction(playerId, {
      action, targetId, itemDamage, itemHealing, fleeDirection,
      critMultiplier: clampedCrit,
    });
    if (result) {
      this.broadcastToRoom(combatRoomId, { type: 'combat_action_result', ...result } as any);
      this.narrateCombatAction(combatRoomId, result);
    }
    combat.markActionTaken(playerId);
    if (action === 'flee' && result?.fled) {
      this.playerManager.setStatus(playerId, 'exploring');
      // Send combat_end to the fleeing player before moving them out of the room,
      // since broadcastToRoom in afterCombatTurn won't reach them after the move.
      this.sendTo(playerId, { type: 'combat_end', result: 'flee' });
      if (result.actorDowned) {
        this.playerManager.takeDamage(playerId, 999);
      } else {
        const p = this.playerManager.getPlayer(playerId)!;
        p.hp = result.actorHp ?? p.hp;
        if (fleeDirection) {
          const oldRoomId = p.roomId;
          const currentRoom = this.rooms.get(oldRoomId);
          const targetRoomId = currentRoom?.exits[fleeDirection];
          if (targetRoomId) {
            // Remove player from old room grid and mob AI
            const oldGrid = this.roomGrids.get(oldRoomId);
            if (oldGrid) oldGrid.removeEntity(playerId);
            this.mobAIManager.removePlayer(oldRoomId, playerId);

            this.playerManager.movePlayer(playerId, targetRoomId);
            const targetRoom = this.rooms.get(targetRoomId);
            const isNewRoom = !this.revealedRooms.has(targetRoomId);
            if (isNewRoom) {
              this.revealedRooms.add(targetRoomId);
              if (targetRoom) {
                this.broadcast({ type: 'room_reveal', room: targetRoom });
                const newGrid = this.createRoomGrid(targetRoomId);
                // Register mob if room has uncleared encounter
                if (targetRoom.encounter && !this.clearedRooms.has(targetRoomId)) {
                  const template = this.mobs.get(targetRoom.encounter.mobId);
                  if (template) {
                    const mobs = this.buildEncounterMobs(targetRoomId, template);
                    this.mobAIManager.registerRoom(targetRoomId, newGrid, mobs);
                  }
                }
              }
            }

            // Calculate spawn position in new room
            const oppositeDir = this.getOppositeDirection(fleeDirection);
            const newRoomGrid = this.roomGrids.get(targetRoomId);
            let fleeX = 0, fleeY = 0;
            if (newRoomGrid && targetRoom?.tileGrid) {
              const spawnPos = exitPosition(oppositeDir, targetRoom.tileGrid.width, targetRoom.tileGrid.height);
              fleeX = spawnPos.x;
              fleeY = spawnPos.y;
              this.playerGridPositions.set(playerId, { x: fleeX, y: fleeY });
              newRoomGrid.addEntity({ id: playerId, type: 'player', position: { x: fleeX, y: fleeY } });
              this.mobAIManager.addPlayer(targetRoomId, playerId, { x: fleeX, y: fleeY });
            }

            this.broadcast({ type: 'player_moved', playerId, roomId: targetRoomId, x: fleeX, y: fleeY });
          }
        }
      }
      this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(playerId)! });
    }
    if (result?.targetDowned) {
      const target = this.playerManager.getPlayer(result.targetId!);
      if (target) {
        this.playerManager.takeDamage(result.targetId!, 999);
        this.broadcast({ type: 'player_update', player: target });
      }
    }
    this.playerManager.regenEnergy(playerId, ENERGY_CONFIG.regenPerTurn);
    this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(playerId)! });
    combat.advanceTurn();
    this.afterCombatTurn(combatRoomId, combat);
  }

  handleDefendResult(playerId: string, damageReduction: number): void {
    if (!this.pendingDefend || this.pendingDefend.targetId !== playerId) return;
    clearTimeout(this.pendingDefend.timeout);
    const { roomId, rawDamage } = this.pendingDefend;
    const clamped = clampDamageReduction(damageReduction);
    this.resolveDefend(roomId, playerId, rawDamage, clamped);
  }

  private resolveDefend(roomId: string, targetId: string, rawDamage: number, damageReduction: number): void {
    this.pendingDefend = null;
    const combat = this.combats.get(roomId);
    if (!combat) return;
    const damageResult = combat.applyDefendDamage(targetId, rawDamage, damageReduction);
    if (damageResult) {
      this.broadcastToRoom(roomId, { type: 'combat_action_result', ...damageResult, action: 'defend' } as any);
      this.narrateDefendResult(roomId, damageResult, damageReduction);
      if (damageResult.targetId && damageResult.damage) {
        const targetPlayer = this.playerManager.getPlayer(damageResult.targetId);
        if (targetPlayer) {
          this.playerManager.takeDamage(damageResult.targetId, damageResult.damage);
          this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(damageResult.targetId)! });
        }
      }
    }
    combat.advanceTurn();
    this.afterCombatTurn(roomId, combat);
  }

  private afterCombatTurn(roomId: string, combat: ArenaCombatManager): void {
    if (combat.isComplete()) {
      const result = combat.getResult();
      // Delay combat end on victory so the client disintegration animation plays
      const delay = result === 'victory' ? TIMING_CONFIG.victoryDelayMs : 0;
      setTimeout(() => this.finishCombat(roomId, result as 'victory' | 'flee' | 'wipe'), delay);
      return;
    }
    const currentId = combat.getCurrentTurnId();
    combat.startTurn(currentId);
    if (combat.isMobTurn(currentId)) {
      // Delay mob turns so attack animations play out before the next action
      setTimeout(() => this.processMobTurn(roomId, combat), TIMING_CONFIG.mobTurnDelayMs);
    } else {
      this.broadcastTurnPrompt(combat);
    }
  }

  private finishCombat(roomId: string, result: 'victory' | 'flee' | 'wipe'): void {
    const combat = this.combats.get(roomId);
    if (combat) {
      const consumed = combat.getConsumedEffects();
      for (const [playerId, effects] of consumed) {
        const player = this.playerManager.getPlayer(playerId);
        if (player) {
          for (const eff of effects) {
            if (!player.usedEffects.includes(eff)) {
              player.usedEffects.push(eff);
            }
          }
        }
      }
    }
    this.broadcastToRoom(roomId, { type: 'combat_end', result });
    if (result === 'flee') {
      this.mobAIManager.reactivateMob(roomId);
    }
    this.combats.delete(roomId);
    for (const p of this.playerManager.getPlayersInRoom(roomId)) {
      if (p.status === 'in_combat') {
        this.playerManager.setStatus(p.id, 'exploring');
        this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(p.id)! });
      }
    }
    if (result === 'victory') {
      this.clearRoom(roomId);
      this.mobAIManager.removeMob(roomId);
      this.roomMobInstances.delete(roomId);
      this.broadcastToRoom(roomId, { type: 'text_log', message: 'The enemies have been defeated!', logType: 'combat' });
      this.fireVictoryPassives(roomId);
      // Award XP to all players
      const room = this.rooms.get(roomId);
      const skullRating = room?.encounter?.skullRating ?? 1;
      const baseXp = PROGRESSION_CONFIG.xpPerSkull[String(skullRating)] ?? PROGRESSION_CONFIG.xpPerSkull['1'] ?? 0;
      const allParticipants = combat!.getParticipantsArray();
      const combatMobCount = allParticipants.filter(p => p.type === 'mob').length;
      const addCount = Math.max(0, combatMobCount - 1);
      const xpAmount = baseXp + (addCount * ENCOUNTER_CONFIG.addXpBonus);
      if (xpAmount > 0) {
        const mobName = room?.encounter?.mobId ? this.mobs.get(room.encounter.mobId)?.name ?? 'enemy' : 'enemy';
        this.broadcast({ type: 'text_log', message: `Gained ${xpAmount} XP from defeating ${mobName}!`, logType: 'system' });
        for (const p of this.playerManager.getAllPlayers()) {
          this.playerManager.awardXp(p.id, xpAmount);
          const levelsGained = this.playerManager.checkLevelUp(p.id);
          if (levelsGained > 0) {
            const updatedPlayer = this.playerManager.getPlayer(p.id)!;
            // Heal to full on level up
            updatedPlayer.hp = computePlayerStats(updatedPlayer).maxHp;
            updatedPlayer.maxHp = computePlayerStats(updatedPlayer).maxHp;
            this.broadcast({ type: 'text_log', message: `${p.name} reached level ${updatedPlayer.level}!`, logType: 'system' });
            this.broadcast({ type: 'level_up', playerId: p.id, newLevel: updatedPlayer.level });
          }
          this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(p.id)! });
          void this.snapshotPlayer(p.id);
        }
      }
      this.dropLoot(roomId);
      if (room?.type === 'boss') {
        // Delay so loot prompt and victory text are visible before game_over
        setTimeout(async () => {
          await this.finalizeGracefulEnd();
          this.broadcast({ type: 'game_over', result: 'victory' });
          this.onGameOver?.(this.origin);
        }, TIMING_CONFIG.postVictoryLootDelayMs);
      }
    }
    if (this.playerManager.allPlayersDowned()) {
      void this.finalizeWipe().then(() => {
        this.broadcast({ type: 'game_over', result: 'wipe' });
        this.onGameOver?.(this.origin);
      });
    }
  }

  private async finalizeGracefulEnd(): Promise<void> {
    if (this.lifecycleCleanedUp) return;
    this.lifecycleCleanedUp = true;
    for (const player of this.playerManager.getAllPlayers()) {
      await this.snapshotPlayer(player.id);
      const ctx = this.connectionContexts.get(player.id);
      if (ctx?.characterId && this.characters) {
        try { await this.characters.markInUse(ctx.characterId, false); } catch (e) { console.error(e); }
      }
      if (ctx?.accountId) this.activeSessions?.detach(ctx.accountId);
    }
  }

  private async finalizeWipe(): Promise<void> {
    if (this.lifecycleCleanedUp) return;
    this.lifecycleCleanedUp = true;
    for (const player of this.playerManager.getAllPlayers()) {
      const ctx = this.connectionContexts.get(player.id);
      if (ctx?.characterId && this.characters) {
        try { await this.characters.wipe(ctx.characterId); } catch (e) { console.error(e); }
      }
      if (ctx?.accountId) this.activeSessions?.detach(ctx.accountId);
    }
  }

  /**
   * Called from index.ts when a room is torn down because all clients have
   * disconnected. Snapshots surviving characters and releases in_use locks.
   */
  async cleanup(): Promise<void> {
    if (this.lifecycleCleanedUp) return;
    this.lifecycleCleanedUp = true;
    // Flush any pending debounced gold writes immediately.
    for (const t of this.goldWriteTimers.values()) clearTimeout(t);
    this.goldWriteTimers.clear();
    for (const player of this.playerManager.getAllPlayers()) {
      await this.snapshotPlayer(player.id);
      const ctx = this.connectionContexts.get(player.id);
      if (ctx?.characterId && this.characters) {
        try { await this.characters.markInUse(ctx.characterId, false); } catch (e) { console.error(e); }
      }
      if (ctx?.accountId) this.activeSessions?.detach(ctx.accountId);
    }
  }

  private processMobTurn(roomId: string, combat: ArenaCombatManager): void {
    const mobId = combat.getCurrentTurnId();

    const resolver = combat.getEffectResolver();
    const turnStartResult = resolver.resolveOnTurnStart(mobId);
    if (turnStartResult.poisonDamage > 0) {
      const dmgResult = combat.applyDamage(mobId, turnStartResult.poisonDamage);
      this.broadcastToRoom(roomId, {
        type: 'text_log', message: `Poison deals ${turnStartResult.poisonDamage} damage!`, logType: 'combat',
      });
      if (dmgResult?.targetDowned) {
        combat.advanceTurn();
        this.afterCombatTurn(roomId, combat);
        return;
      }
    }

    const { combat: result, path: mobPath } = combat.resolveMobTurn(mobId);
    // Broadcast mob position after arena movement (include path for animation)
    this.broadcastToRoom(roomId, {
      type: 'arena_positions_update',
      positions: combat.getAllPositions(),
      movementRemaining: 0,
      moverId: mobId,
      path: mobPath.length > 0 ? mobPath : undefined,
    } as any);
    if (!result) {
      combat.advanceTurn();
      this.afterCombatTurn(roomId, combat);
      return;
    }

    if (result.defendQte && result.targetId && result.pendingDamage !== undefined) {
      this.broadcastToRoom(roomId, { type: 'combat_action_result', ...result } as any);
      this.narrateDefendQteStart(roomId, result);
      const timeout = setTimeout(() => {
        this.resolveDefend(roomId, result.targetId!, result.pendingDamage!, 0);
      }, QTE_CONFIG.defendTimeoutMs);
      this.pendingDefend = {
        roomId, targetId: result.targetId, mobId,
        rawDamage: result.pendingDamage, timeout,
      };
      return;
    }

    this.broadcastToRoom(roomId, { type: 'combat_action_result', ...result } as any);
    this.narrateCombatAction(roomId, result);
    if (result.targetId && result.damage) {
      const targetPlayer = this.playerManager.getPlayer(result.targetId);
      if (targetPlayer) {
        this.playerManager.takeDamage(result.targetId, result.damage);
        this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(result.targetId)! });
      }
    }
    combat.advanceTurn();
    this.afterCombatTurn(roomId, combat);
  }

  private broadcastTurnPrompt(combat: ArenaCombatManager): void {
    const state = combat.getState();
    this.broadcastToRoom(state.roomId, { type: 'combat_turn', currentTurnId: state.currentTurnId, roundNumber: state.roundNumber });
    // Send initial movement remaining for the new turn
    const currentTurn = state.currentTurnId;
    const turnState = combat.getTurnState(currentTurn);
    if (turnState) {
      this.broadcastToRoom(state.roomId, {
        type: 'arena_positions_update',
        positions: combat.getAllPositions(),
        movementRemaining: turnState.movementRemaining,
        moverId: currentTurn,
      } as any);
    }
    // If this turn belongs to a disconnected player, arm the AFK auto-skip.
    const turnId = state.currentTurnId;
    if (turnId && this.playerManager.getPlayer(turnId) && this.disconnectedConnections.has(turnId)) {
      const roomId = state.roomId;
      combat.armAfkTimer(
        turnId,
        () => this.disconnectedConnections.has(turnId),
        () => {
          combat.advanceTurn();
          this.broadcastToRoom(roomId, { type: 'text_log', message: `${this.playerNames.get(turnId) ?? 'Player'} is AFK — turn skipped.`, logType: 'system' });
          this.afterCombatTurn(roomId, combat);
        },
      );
    }
  }

  private narrateCombatAction(roomId: string, result: any): void {
    let message = '';
    switch (result.action) {
      case 'attack': {
        if (result.critMultiplier && result.critMultiplier >= 2.0) {
          message = `${result.actorName} lands a PERFECT hit on ${result.targetName} for ${result.damage} damage!`;
        } else if (result.critMultiplier && result.critMultiplier >= 1.5) {
          message = `${result.actorName} lands a critical hit on ${result.targetName} for ${result.damage} damage!`;
        } else {
          message = `${result.actorName} attacks ${result.targetName} for ${result.damage} damage!`;
        }
        if (result.targetDowned) message += ` ${result.targetName} goes down!`;
        if (result.itemEffect === 'self_revive') {
          message += ` But a Phoenix Plume ignites — ${result.targetName} rises from the ashes!`;
        }
        if (result.itemEffect === 'undying_fury') {
          message += ` ${result.targetName} refuses to fall — fueled by undying fury!`;
        }
        if (result.itemEffectHealing) {
          message += ` (Leeched ${result.itemEffectHealing} HP)`;
        }
        if (result.itemEffectDamage) {
          message += ` (${result.itemEffectDamage} splash damage)`;
        }
        break;
      }
      case 'defend':
        message = `${result.actorName} takes a defensive stance.`;
        break;
      case 'use_item':
        if (result.healing) message = `${result.actorName} uses an item and heals for ${result.healing} HP.`;
        else if (result.damage) message = `${result.actorName} uses an item on ${result.targetName} for ${result.damage} damage!`;
        break;
      case 'flee':
        message = `${result.actorName} flees ${result.fleeDirection ?? 'away'}!`;
        if (result.damage) message += ` Takes ${result.damage} opportunity damage!`;
        break;
    }
    if (message) this.broadcastToRoom(roomId, { type: 'text_log', message, logType: 'combat' });
  }

  private narrateDefendQteStart(roomId: string, result: any): void {
    const message = `${result.actorName} attacks ${result.targetName}! Brace for impact...`;
    this.broadcastToRoom(roomId, { type: 'text_log', message, logType: 'combat' });
  }

  private narrateDefendResult(roomId: string, result: any, reduction: number): void {
    let message: string;
    if (reduction >= 0.75) {
      message = `${result.targetName} perfectly blocks the attack! Takes only ${result.damage} damage.`;
    } else if (reduction >= 0.5) {
      message = `${result.targetName} blocks the attack well! Takes ${result.damage} damage.`;
    } else if (reduction >= 0.25) {
      message = `${result.targetName} grazes the block — takes ${result.damage} damage.`;
    } else {
      message = `${result.targetName} fails to block — takes ${result.damage} damage!`;
    }
    if (result.targetDowned) message += ` ${result.targetName} goes down!`;
    this.broadcastToRoom(roomId, { type: 'text_log', message, logType: 'combat' });
  }

  addKeyToParty(playerId: string, keyId: string): void {
    this.playerManager.addKeyToAll(keyId);
    const player = this.playerManager.getPlayer(playerId);
    if (player) {
      for (const p of this.playerManager.getAllPlayers()) {
        this.broadcast({ type: 'player_update', player: p });
        void this.snapshotPlayer(p.id);
      }
      this.broadcastToRoom(player.roomId, {
        type: 'text_log',
        message: 'A key has been found! The party receives the key.',
        logType: 'loot',
      });
    }

    // Unlock the corresponding door immediately and broadcast the room update
    for (const room of this.rooms.values()) {
      if (!room.lockedExits) continue;
      for (const [dir, lockedKeyId] of Object.entries(room.lockedExits)) {
        if (lockedKeyId === keyId) {
          delete room.lockedExits[dir as Direction];
          this.broadcast({ type: 'room_reveal', room });
          this.broadcast({
            type: 'text_log',
            message: 'A distant lock clicks open...',
            logType: 'system',
          });
        }
      }
    }
  }

  private nextLootInstanceId = 1;

  private resolveAndRouteDrops(
    roomId: string,
    ref: DropSpecRef,
    sourceSkullRating?: 1 | 2 | 3,
  ): void {
    const results: DropResult[] = resolveDrops(ref, {
      sourceSkullRating,
      biomeId: this.biomeId,
      registry: DROP_SPECS,
      itemsById: this.items,
    });

    const itemsForLootFlow: Item[] = [];
    for (const result of results) {
      switch (result.kind) {
        case 'item':
          itemsForLootFlow.push({
            ...result.item,
            id: `${result.item.id}_${this.nextLootInstanceId++}`,
          });
          break;
        case 'gold':
          this.awardGoldToRoom(roomId, result.amount);
          break;
        case 'key':
          this.awardKeyToRoomParty(roomId, result.keyId);
          break;
        case 'material':
          this.broadcastToRoom(roomId, {
            type: 'text_log',
            message: `${result.count}x ${result.materialId} dropped (not yet collectible)`,
            logType: 'loot',
          });
          break;
      }
    }

    if (itemsForLootFlow.length > 0) {
      this.runLootFlow(roomId, itemsForLootFlow);
    }
  }

  private awardGoldToRoom(roomId: string, amount: number): void {
    const playerIds = this.playerManager
      .getPlayersInRoom(roomId)
      .filter((p) => p.status !== 'downed')
      .map((p) => p.id);
    if (playerIds.length === 0) return;
    for (const pid of playerIds) {
      const newTotal = this.playerManager.addGold(pid, amount);
      this.sendTo(pid, { type: 'gold_update', playerId: pid, gold: newTotal });
      this.scheduleGoldSnapshot(pid);
    }
    this.broadcastToRoom(roomId, {
      type: 'text_log',
      message: `Everyone gains ${amount} gold.`,
      logType: 'loot',
    });
  }

  private awardKeyToRoomParty(roomId: string, keyId: string): void {
    const playerIds = this.playerManager
      .getPlayersInRoom(roomId)
      .filter((p) => p.status !== 'downed')
      .map((p) => p.id);
    if (playerIds.length > 0) {
      this.addKeyToParty(playerIds[0], keyId);
    }
  }

  private runLootFlow(roomId: string, regularItems: Item[]): void {
    if (regularItems.length === 0) return;
    const playerIds = this.playerManager.getPlayersInRoom(roomId)
      .filter((p) => p.status !== 'downed').map((p) => p.id);
    if (playerIds.length === 0) return;

    const room = this.rooms.get(roomId);
    const location = room?.lootLocation ?? 'floor';
    const prefix =
      location === 'chest' ? 'A chest contains' :
      location === 'hidden' ? 'Hidden in the room:' :
      'On the floor:';

    for (const item of regularItems) {
      this.broadcastToRoom(roomId, {
        type: 'text_log',
        message: `${prefix} {${item.rarity}:${item.name}}`,
        logType: 'loot',
      });
    }
    if (playerIds.length > 1) {
      this.broadcastToRoom(roomId, { type: 'loot_prompt', items: regularItems, timeout: LOOT_CONFIG.timeoutMs });
    }
    this.lootManager.startLootRound(roomId, regularItems, playerIds);
  }

  private dropLoot(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    if (room.encounter) {
      const mob = this.mobs.get(room.encounter.mobId);
      if (mob) {
        this.resolveAndRouteDrops(roomId, mob.drops, room.encounter.skullRating);
      }
    }

    if (room.drops && !this.roomDropsProcessed.has(roomId)) {
      this.roomDropsProcessed.add(roomId);
      this.resolveAndRouteDrops(roomId, room.drops, room.encounter?.skullRating);
    }
  }

  private handleLootAwarded(item: Item, winnerId: string): void {
    const winner = this.playerManager.getPlayer(winnerId);
    const winnerName = winner?.name ?? 'Unknown';
    const roomId = winner?.roomId;
    const added = this.playerManager.addToInventory(winnerId, { ...item });
    if (!added) {
      if (roomId) {
        this.broadcastToRoom(roomId, { type: 'text_log', message: `${winnerName}'s inventory is full! {${item.rarity}:${item.name}} is lost.`, logType: 'loot' });
      }
      return;
    }
    if (roomId) {
      this.broadcastToRoom(roomId, { type: 'loot_result', itemId: item.id, itemName: item.name, winnerId, winnerName });
      this.broadcastToRoom(roomId, { type: 'text_log', message: `${winnerName} receives {${item.rarity}:${item.name}}!`, logType: 'loot' });
    }
    this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(winnerId)! });
    void this.snapshotPlayer(winnerId);
  }

  handleLootChoice(playerId: string, itemId: string, choice: 'need' | 'greed' | 'pass'): void {
    this.lootManager.submitChoice(playerId, itemId, choice);
  }

  handleRevive(playerId: string, targetPlayerId: string): void {
    const player = this.playerManager.getPlayer(playerId);
    const target = this.playerManager.getPlayer(targetPlayerId);
    if (!player || !target) return;
    if (player.roomId !== target.roomId) {
      this.sendTo(playerId, { type: 'error', message: 'Target is not in your room.' });
      return;
    }
    if (target.status !== 'downed') {
      this.sendTo(playerId, { type: 'error', message: 'Target is not downed.' });
      return;
    }
    this.playerManager.revivePlayer(targetPlayerId);
    this.broadcast({ type: 'text_log', message: `${player.name} revives ${target.name}!`, logType: 'system' });
    this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(targetPlayerId)! });
  }

  handleEquipItem(playerId: string, inventoryIndex: number): void {
    const player = this.playerManager.getPlayer(playerId);
    if (!player) return;
    if (player.status === 'in_combat') {
      this.sendTo(playerId, { type: 'error', message: 'Cannot manage inventory during combat.' });
      return;
    }
    const success = this.playerManager.equipFromInventory(playerId, inventoryIndex);
    if (!success) {
      this.sendTo(playerId, { type: 'error', message: 'Cannot equip that item.' });
      return;
    }
    this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(playerId)! });
    void this.snapshotPlayer(playerId);
  }

  handleDropItem(playerId: string, inventoryIndex: number): void {
    const player = this.playerManager.getPlayer(playerId);
    if (!player) return;
    if (player.status === 'in_combat') {
      this.sendTo(playerId, { type: 'error', message: 'Cannot manage inventory during combat.' });
      return;
    }
    const item = this.playerManager.removeFromInventory(playerId, inventoryIndex);
    if (!item) return;
    this.broadcastToRoom(player.roomId, {
      type: 'text_log', message: `${player.name} discards ${item.name}.`, logType: 'system',
    });
    this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(playerId)! });
    void this.snapshotPlayer(playerId);
  }

  handleUseConsumable(playerId: string, consumableIndex: number): void {
    const player = this.playerManager.getPlayer(playerId);
    if (!player) return;
    if (player.status === 'in_combat') {
      this.sendTo(playerId, { type: 'error', message: 'Use items through combat actions during combat.' });
      return;
    }
    const item = player.consumables[consumableIndex];
    if (!item) return;
    const result = this.playerManager.useConsumable(playerId, consumableIndex);
    if (!result) return;
    if (result.healing) {
      this.broadcastToRoom(player.roomId, {
        type: 'text_log', message: `${player.name} uses ${item.name} and recovers ${result.healing} HP.`, logType: 'system',
      });
    }
    this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(playerId)! });
    void this.snapshotPlayer(playerId);
  }

  handleAllocateStat(playerId: string, statId: string, points: number): void {
    const result = this.playerManager.allocateStat(playerId, statId, points);
    if (!result) {
      this.sendTo(playerId, { type: 'error', message: 'Cannot allocate stat point.' });
      return;
    }
    const player = this.playerManager.getPlayer(playerId)!;
    // Sync maxHp with computed stats
    const stats = computePlayerStats(player);
    player.maxHp = stats.maxHp;
    this.broadcast({ type: 'player_update', player });
    void this.snapshotPlayer(playerId);
  }

  private sendPuzzlePrompt(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room?.puzzle) return;
    if (this.activePuzzleSolver.has(roomId) || this.solvedPuzzles.has(roomId)) return;
    this.activePuzzleSolver.set(roomId, playerId);
    this.sendTo(playerId, {
      type: 'puzzle_prompt',
      roomId,
      puzzleId: room.puzzle.id,
      description: room.puzzle.description,
      options: room.puzzle.options,
    });
  }

  handlePuzzleAnswer(playerId: string, roomId: string, answerIndex: number): void {
    const player = this.playerManager.getPlayer(playerId);
    if (!player || player.roomId !== roomId) return;
    if (this.solvedPuzzles.has(roomId)) return;
    if (this.activePuzzleSolver.get(roomId) !== playerId) return;

    const room = this.rooms.get(roomId);
    if (!room?.puzzle) return;

    this.solvedPuzzles.add(roomId);
    this.activePuzzleSolver.delete(roomId);
    const correct = answerIndex === room.puzzle.correctIndex;

    this.broadcastToRoom(roomId, { type: 'puzzle_result', roomId, correct });

    if (correct) {
      this.broadcastToRoom(roomId, {
        type: 'text_log',
        message: 'Correct! A hidden compartment opens, revealing treasure.',
        logType: 'loot',
      });
      this.dropLoot(roomId);
    } else {
      this.broadcastToRoom(roomId, {
        type: 'text_log',
        message: 'Wrong answer. The mechanism clicks shut permanently.',
        logType: 'system',
      });
      // 25% chance to spawn a mob — pick a skull-1 mob from the dungeon
      if (Math.random() < DUNGEON_CONFIG.encounterSpawnChance) {
        const skull1Mobs = this.content.mobs.filter(m => m.skullRating === 1);
        if (skull1Mobs.length > 0) {
          const mob = skull1Mobs[Math.floor(Math.random() * skull1Mobs.length)];
          this.broadcastToRoom(roomId, {
            type: 'text_log',
            message: 'The failed attempt has attracted something...',
            logType: 'combat',
          });
          const mobInstance: MobInstance = {
            instanceId: `${mob.id}_${Date.now()}`,
            templateId: mob.id, name: mob.name,
            maxHp: mob.maxHp, hp: mob.maxHp,
            damage: mob.damage, defense: mob.defense, initiative: mob.initiative,
          };
          this.startCombat(roomId, [mobInstance]);
        }
      }
    }
  }

  handleInteract(playerId: string, interactableId: string): void {
    const player = this.playerManager.getPlayer(playerId);
    if (!player) return;

    if (player.status !== 'exploring') {
      this.sendTo(playerId, { type: 'error', message: 'You cannot interact while in combat.' });
      return;
    }

    const room = this.rooms.get(player.roomId);
    if (!room) return;

    if (this.combats.has(player.roomId)) {
      this.sendTo(playerId, { type: 'error', message: 'Cannot interact during combat.' });
      return;
    }

    // Handle return portal interactable
    const instance = room.interactables?.find(i => i.instanceId === interactableId);
    if (instance?.definitionId === '_return_portal') {
      this.sendTo(playerId, {
        type: 'interact_actions',
        interactableId,
        interactableName: 'Passage',
        actions: [{
          id: '_return_passage',
          label: 'Return',
          locked: false,
          used: false,
        }],
      });
      return;
    }

    const isSolo = this.playerIds.length === 1;
    const result = this.interactionResolver.getActions(
      interactableId,
      room,
      player.className,
      isSolo,
    );

    if ('error' in result) {
      this.sendTo(playerId, { type: 'error', message: result.error });
      return;
    }

    const actions = [...result.actions];

    // Inject portal action if this interactable has a secret room
    if (this.secretRoomLinks.has(interactableId)) {
      actions.push({
        id: '_enter_passage',
        label: 'Enter passage',
        locked: false,
        used: false,
      });
    }

    this.sendTo(playerId, {
      type: 'interact_actions',
      interactableId,
      interactableName: result.name,
      actions,
    });
  }

  handleInteractAction(playerId: string, interactableId: string, actionId: string): void {
    const player = this.playerManager.getPlayer(playerId);
    if (!player) return;

    if (player.status !== 'exploring') {
      this.sendTo(playerId, { type: 'error', message: 'You cannot interact while in combat.' });
      return;
    }

    const room = this.rooms.get(player.roomId);
    if (!room) return;

    if (this.combats.has(player.roomId)) {
      this.sendTo(playerId, { type: 'error', message: 'Cannot interact during combat.' });
      return;
    }

    // Handle portal actions (enter passage / return)
    if (actionId === '_enter_passage') {
      const link = this.secretRoomLinks.get(interactableId);
      if (link) {
        this.teleportPlayer(playerId, link.secretRoomId, 'You step through the hidden passage...');
      }
      return;
    }
    if (actionId === '_return_passage') {
      // Find which secret room this return portal belongs to
      for (const [, link] of this.secretRoomLinks) {
        if (link.secretRoomId === player.roomId) {
          this.teleportPlayer(playerId, link.sourceRoomId, 'You step back through the passage...');
          return;
        }
      }
      return;
    }

    const isSolo = this.playerIds.length === 1;
    const isSecretRoom = player.roomId.startsWith('secret_');
    // Secret-room loot is freshly generated from itemgen so it never pulls
    // from the static content pool (which is just consumables + starter gear
    // in procedural dungeons). Bias rarity heavily toward rare+ since these
    // rooms are a reward.
    const lootOverride = isSecretRoom
      ? this.buildSecretRoomLootPool()
      : undefined;
    const result = this.interactionResolver.resolve(
      playerId,
      player.name,
      interactableId,
      actionId,
      room,
      player.className,
      isSolo,
      lootOverride,
    );

    if (result.error) {
      this.sendTo(playerId, { type: 'error', message: result.error });
      return;
    }

    // Send private result to the interacting player
    this.sendTo(playerId, {
      type: 'interact_result',
      interactableId,
      actionId,
      narration: result.narration!,
      outcome: {
        type: result.outcomeType!,
        loot: result.lootItem,
        damage: result.damage,
        intel: result.intel,
      },
    });

    // Broadcast state change to all players in room
    this.broadcastToRoom(player.roomId, {
      type: 'interactable_state',
      interactableId,
      actionId,
      usedBy: player.name,
    });

    // Apply mechanical effects
    if (result.damage) {
      this.playerManager.takeDamage(playerId, result.damage);
      this.broadcastToRoom(player.roomId, {
        type: 'player_update',
        player: this.playerManager.getPlayer(playerId)!,
      });
      this.broadcastToRoom(player.roomId, {
        type: 'text_log',
        message: `${player.name} takes ${result.damage} damage from a hazard!`,
        logType: 'combat',
      });
    }

    if (result.lootItem) {
      const added = this.playerManager.addToInventory(playerId, result.lootItem);
      if (added) {
        this.broadcastToRoom(player.roomId, {
          type: 'text_log',
          message: `${player.name} found {${result.lootItem.rarity}:${result.lootItem.name}}!`,
          logType: 'loot',
        });
        this.broadcastToRoom(player.roomId, {
          type: 'player_update',
          player: this.playerManager.getPlayer(playerId)!,
        });
      } else {
        this.sendTo(playerId, {
          type: 'text_log',
          message: 'Your inventory is full. The item is lost.',
          logType: 'system',
        });
      }
    }

    // Create secret room on reveal_room / secret outcome
    if ((result.outcomeType === 'reveal_room' || result.outcomeType === 'secret') && !this.secretRoomLinks.has(interactableId)) {
      this.createSecretRoom(interactableId, player.roomId);
      this.broadcastToRoom(player.roomId, {
        type: 'text_log',
        message: 'A hidden passage has opened nearby...',
        logType: 'narration',
      });
      // Immediately show the "Enter passage" action so the player doesn't have to re-walk
      const def = allInteractableDefs.find(d => d.id === room.interactables?.find(i => i.instanceId === interactableId)?.definitionId);
      this.sendTo(playerId, {
        type: 'interact_actions',
        interactableId,
        interactableName: def?.name ?? 'Passage',
        actions: [{
          id: '_enter_passage',
          label: 'Enter passage',
          locked: false,
          used: false,
        }],
      });
    } else {
      // Re-send the updated actions menu so the player can keep interacting
      this.handleInteract(playerId, interactableId);
    }
  }

  private teleportPlayer(playerId: string, targetRoomId: string, narration: string): void {
    const player = this.playerManager.getPlayer(playerId);
    if (!player) return;

    const targetRoom = this.rooms.get(targetRoomId);
    if (!targetRoom) return;

    const oldRoomId = player.roomId;

    // Remove player from old room grid and mob AI
    const oldGrid = this.roomGrids.get(oldRoomId);
    if (oldGrid) oldGrid.removeEntity(playerId);
    this.mobAIManager.removePlayer(oldRoomId, playerId);

    this.playerManager.movePlayer(playerId, targetRoomId);

    if (!this.revealedRooms.has(targetRoomId)) {
      this.revealedRooms.add(targetRoomId);
      this.broadcast({ type: 'room_reveal', room: targetRoom });
    }
    if (!this.roomGrids.has(targetRoomId)) {
      this.createRoomGrid(targetRoomId);
    }
    if (
      targetRoom.encounter &&
      !this.clearedRooms.has(targetRoomId) &&
      !this.roomMobInstances.has(targetRoomId)
    ) {
      const template = this.mobs.get(targetRoom.encounter.mobId);
      if (template) {
        const grid = this.roomGrids.get(targetRoomId)!;
        const mobs = this.buildEncounterMobs(targetRoomId, template);
        this.mobAIManager.registerRoom(targetRoomId, grid, mobs);
      }
    }

    // Add player to new room grid at center
    const spawnPos = this.findWalkableCenter(targetRoomId);
    this.playerGridPositions.set(playerId, { ...spawnPos });
    const newGrid = this.roomGrids.get(targetRoomId);
    if (newGrid) {
      newGrid.addEntity({ id: playerId, type: 'player', position: { ...spawnPos } });
      this.mobAIManager.addPlayer(targetRoomId, playerId, spawnPos);
    }

    this.broadcast({ type: 'player_moved', playerId, roomId: targetRoomId, x: spawnPos.x, y: spawnPos.y });
    this.sendTo(playerId, {
      type: 'text_log',
      message: `${narration}\n\n--- ${targetRoom.name} ---\n${targetRoom.description}`,
      logType: 'narration',
    });
  }

  private calculatePartyPower(): number {
    let totalPower = 0;
    for (const player of this.playerManager.getAllPlayers()) {
      const stats = this.playerManager.getComputedStats(player.id);
      totalPower += stats.damage + stats.defense + Math.floor(stats.maxHp / 5);
    }
    return totalPower;
  }

  private calculateAddCount(): number {
    const power = this.calculatePartyPower();
    const raw = Math.floor((power - ENCOUNTER_CONFIG.baseline) / ENCOUNTER_CONFIG.step);
    return Math.max(0, Math.min(raw, ENCOUNTER_CONFIG.maxAdds));
  }

  private inferBiome(roomId: string): string {
    const zoneMatch = roomId.match(/_z(\d+)_/);
    if (!zoneMatch) return 'starter';
    const prefix = roomId.slice(0, roomId.indexOf(`_z${zoneMatch[1]}_`));
    const clean = prefix.replace(/^multi_/, '');
    return clean.split('_')[0] || 'starter';
  }

  private buildEncounterMobs(roomId: string, leaderTemplate: MobTemplate): MobInstance[] {
    const leader: MobInstance = {
      instanceId: `${leaderTemplate.id}_${Date.now()}`,
      templateId: leaderTemplate.id,
      name: leaderTemplate.name,
      maxHp: leaderTemplate.maxHp,
      hp: leaderTemplate.maxHp,
      damage: leaderTemplate.damage,
      defense: leaderTemplate.defense,
      initiative: leaderTemplate.initiative,
    };

    const addCount = this.calculateAddCount();
    const biome = this.inferBiome(roomId);
    const skull1Adds = allMobPool.filter(m => m.skullRating === 1 && m.biomes.includes(biome));

    const mobs: MobInstance[] = [leader];

    for (let i = 0; i < addCount && skull1Adds.length > 0; i++) {
      const addEntry = skull1Adds[Math.floor(Math.random() * skull1Adds.length)];
      mobs.push({
        instanceId: `${addEntry.id}_${Date.now()}_add${i}`,
        templateId: addEntry.id,
        name: addEntry.name,
        maxHp: addEntry.baseStats.maxHp,
        hp: addEntry.baseStats.maxHp,
        damage: addEntry.baseStats.damage,
        defense: addEntry.baseStats.defense,
        initiative: addEntry.baseStats.initiative,
      });
    }

    this.roomMobInstances.set(roomId, mobs);
    return mobs;
  }

  debugTeleport(playerId: string, roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.teleportPlayer(playerId, roomId, 'You are teleported through space...');
  }

  debugGiveItem(playerId: string, itemId: string): void {
    const item = allItemsById.get(itemId);
    if (!item) return;
    const added = this.playerManager.addToInventory(playerId, { ...item });
    if (!added) {
      this.sendTo(playerId, { type: 'error', message: 'Inventory full' });
      return;
    }
    const player = this.playerManager.getPlayer(playerId);
    if (player) {
      this.sendTo(playerId, { type: 'player_update', player });
      this.sendTo(playerId, { type: 'text_log', message: `[Debug] Received ${item.name}`, logType: 'system' });
    }
  }

  debugRevealAll(playerId: string): void {
    for (const [roomId, room] of this.rooms) {
      if (!this.revealedRooms.has(roomId)) {
        this.revealedRooms.add(roomId);
        this.sendTo(playerId, { type: 'room_reveal', room });
      }
    }
  }

  private buildSecretRoomLootPool(): Item[] {
    const slots: EquipmentSlot[] = ['weapon', 'offhand', 'armor', 'accessory'];
    const pool: Item[] = [];
    for (const slot of slots) {
      pool.push(
        generateItem({
          slot,
          skullRating: 2,
          biomeId: this.biomeId,
          rarityWeights: { rare: 70, legendary: 25, uncommon: 5 },
        }),
      );
    }
    return pool;
  }

  private createSecretRoom(interactableId: string, sourceRoomId: string): void {
    const roomId = `secret_${this.nextSecretRoomId++}`;

    // Pick 4 random interactable definitions from the dungeon's biomes
    const biomeIds = new Set<string>();
    for (const room of this.rooms.values()) {
      // Infer biome from room id prefix
      const prefix = room.id.split('_')[0];
      if (prefix) biomeIds.add(prefix);
    }
    const biomesArray = [...biomeIds];

    const candidates = allInteractableDefs.filter(d =>
      d.biomes.some(b => biomesArray.includes(b))
    );

    const shuffled = [...candidates].sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, 4);

    // Position interactables within the 20x12 dead_end grid interior
    const slotPositions = [
      { x: 4, y: 3 },
      { x: 10, y: 3 },
      { x: 15, y: 3 },
      { x: 7, y: 7 },
    ];

    const interactables: InteractableInstance[] = picked.map((def, i) => ({
      definitionId: def.id,
      instanceId: `${roomId}_int_${i}`,
      position: slotPositions[i],
      usedActions: {},
    }));

    // Add the return portal interactable
    interactables.push({
      definitionId: '_return_portal',
      instanceId: `${roomId}_portal`,
      position: { x: 10, y: 9 },
      usedActions: {},
    });

    const secretRoom: Room = {
      id: roomId,
      type: 'dead_end',
      name: 'Hidden Alcove',
      description: 'A concealed chamber, untouched for ages. Strange objects line the walls, and the air hums with latent energy.',
      exits: {},
      interactables,
    };

    secretRoom.tileGrid = buildTileGrid(secretRoom, 'starter');
    this.rooms.set(roomId, secretRoom);
    this.secretRoomLinks.set(interactableId, { secretRoomId: roomId, sourceRoomId });
  }

  handleUseAbility(playerId: string, abilityId: string, targetId?: string, targetX?: number, targetY?: number): void {
    const player = this.playerManager.getPlayer(playerId);
    if (!player || player.status !== 'in_combat') return;

    const combat = this.combats.get(player.roomId);
    if (!combat || !combat.isPlayerTurn(playerId)) return;

    const classDef = getClassDefinition(player.className);
    if (!classDef) return;

    const ability = classDef.abilities.find(a => a.id === abilityId && !a.passive);
    if (!ability) return;

    if (!this.playerManager.hasEnergy(playerId, ability.energyCost)) {
      this.sendTo(playerId, { type: 'error', message: `Not enough energy for ${ability.name}.` });
      return;
    }

    // Check if action already taken this turn
    const turnState = combat.getTurnState(playerId);
    if (turnState?.actionTaken) {
      this.sendTo(playerId, { type: 'error', message: 'Action already taken this turn.' });
      return;
    }

    const participants = combat.getParticipantsArray();
    const caster = participants.find((p: { id: string }) => p.id === playerId);
    if (!caster) return;

    // --- Area ability (area_enemy / area_ally) ---
    if (ability.targetType === 'area_enemy' || ability.targetType === 'area_ally') {
      if (targetX === undefined || targetY === undefined) {
        this.sendTo(playerId, { type: 'error', message: 'Area ability requires target coordinates.' });
        return;
      }

      const casterPos = combat.getPosition(playerId);
      if (!casterPos) return;
      const targetTile = { x: targetX, y: targetY };

      if (ability.range && !hasLineOfSight(combat.getGrid(), casterPos, targetTile, ability.range)) {
        this.sendTo(playerId, { type: 'error', message: 'Target out of range or blocked.' });
        return;
      }

      // Find all valid targets within areaRadius (Manhattan distance)
      const radius = ability.areaRadius ?? 0;
      const isEnemy = ability.targetType === 'area_enemy';
      const hitTargets = participants.filter((p: { alive: boolean; type: string; id: string }) => {
        if (!p.alive) return false;
        if (isEnemy ? (p.type === caster.type || p.id === playerId) : (p.type !== caster.type)) return false;
        const pos = combat.getPosition(p.id);
        if (!pos) return false;
        return Math.abs(pos.x - targetX) + Math.abs(pos.y - targetY) <= radius;
      });

      // Resolve effects against each target individually
      let totalDamage = 0;
      let totalHealing = 0;
      const allBuffs: string[] = [];
      const downedTargets: string[] = [];

      for (const hitTarget of hitTargets) {
        const result = this.abilityResolver.resolveAllEffects(ability.effects, caster, hitTarget, participants);
        if (result.damage) totalDamage += result.damage;
        if (result.healing) totalHealing += result.healing;
        if (result.buffsApplied) allBuffs.push(...result.buffsApplied);
        if (result.targetDowned) downedTargets.push(hitTarget.id);

        // Sync healing to PlayerManager
        if (result.healing) {
          const targetPlayer = this.playerManager.getPlayer(hitTarget.id);
          if (targetPlayer) {
            this.playerManager.healPlayer(hitTarget.id, result.healing);
            this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(hitTarget.id)! });
          }
        }
      }

      this.playerManager.spendEnergy(playerId, ability.energyCost);

      // Broadcast combined result
      this.broadcastToRoom(player.roomId, {
        type: 'combat_action_result',
        actorId: playerId,
        actorName: player.name,
        action: 'use_ability',
        abilityId: ability.id,
        abilityName: ability.name,
        damage: totalDamage || undefined,
        healing: totalHealing || undefined,
        buffsApplied: allBuffs.length > 0 ? allBuffs : undefined,
      } as any);

      // Narrate
      if (hitTargets.length > 0) {
        const hitNames = hitTargets.map((t: { name: string }) => t.name).join(', ');
        if (totalDamage) {
          this.broadcastToRoom(player.roomId, { type: 'text_log', message: `${player.name} uses ${ability.name}, hitting ${hitNames} for ${totalDamage} total damage!`, logType: 'combat' });
        } else {
          this.broadcastToRoom(player.roomId, { type: 'text_log', message: `${player.name} uses ${ability.name}, affecting ${hitNames}!`, logType: 'combat' });
        }
      } else {
        this.broadcastToRoom(player.roomId, { type: 'text_log', message: `${player.name} uses ${ability.name}, but hits nothing!`, logType: 'combat' });
      }

      // Handle downed targets
      for (const downedId of downedTargets) {
        const targetPlayer = this.playerManager.getPlayer(downedId);
        if (targetPlayer) {
          this.playerManager.takeDamage(downedId, 999);
          this.broadcast({ type: 'player_update', player: targetPlayer });
        }
      }

      combat.markActionTaken(playerId);
      this.playerManager.regenEnergy(playerId, ENERGY_CONFIG.regenPerTurn);
      this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(playerId)! });
      combat.advanceTurn();
      this.afterCombatTurn(player.roomId, combat);
      return;
    }

    // --- Ranged single-target ability (has range, not area) ---
    if (ability.range && ability.targetType === 'enemy') {
      if (!targetId) {
        this.sendTo(playerId, { type: 'error', message: 'Ability requires a target.' });
        return;
      }

      const casterPos = combat.getPosition(playerId);
      const targetPos = combat.getPosition(targetId);
      if (!casterPos || !targetPos) return;

      if (!hasLineOfSight(combat.getGrid(), casterPos, targetPos, ability.range)) {
        this.sendTo(playerId, { type: 'error', message: 'Target out of range or blocked.' });
        return;
      }

      // Fall through to standard single-target resolution below
    }

    // --- Melee-range enemy ability (no range field) ---
    if (!ability.range && ability.targetType === 'enemy' && targetId) {
      const casterPos = combat.getPosition(playerId);
      const targetPos = combat.getPosition(targetId);
      if (!casterPos || !targetPos || !isAdjacent(casterPos, targetPos)) {
        this.sendTo(playerId, { type: 'error', message: 'Target is not adjacent.' });
        return;
      }
    }

    // --- Flanking bonus: boost effect multiplier when caster + ally both adjacent ---
    let effectsToUse = ability.effects;
    if (ability.flankingMultiplier && targetId) {
      const casterPos = combat.getPosition(playerId);
      const targetPos = combat.getPosition(targetId);
      if (casterPos && targetPos && isAdjacent(casterPos, targetPos)) {
        const allyAdjacent = participants.some((p: { id: string; type: string; hp: number }) => {
          if (p.id === playerId || p.type !== 'player' || p.hp <= 0) return false;
          const allyPos = combat.getPosition(p.id);
          return allyPos ? isAdjacent(allyPos, targetPos) : false;
        });
        if (allyAdjacent) {
          effectsToUse = ability.effects.map(e =>
            e.type === 'deal_damage' ? { ...e, multiplier: ability.flankingMultiplier } : e
          );
        }
      }
    }

    // --- Standard single-target / self resolution ---
    const target = targetId ? participants.find((p: { id: string }) => p.id === targetId) : null;
    const result = this.abilityResolver.resolveAllEffects(effectsToUse, caster, target ?? null, participants);

    if (result.healing && targetId) {
      const targetPlayer = this.playerManager.getPlayer(targetId);
      if (targetPlayer) {
        this.playerManager.healPlayer(targetId, result.healing);
        this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(targetId)! });
      }
    }

    this.playerManager.spendEnergy(playerId, ability.energyCost);

    const targetParticipant = targetId ? participants.find((p: { id: string }) => p.id === targetId) : null;
    this.broadcastToRoom(player.roomId, {
      type: 'combat_action_result',
      actorId: playerId,
      actorName: player.name,
      action: 'use_ability',
      abilityId: ability.id,
      abilityName: ability.name,
      targetId,
      targetName: targetParticipant?.name,
      damage: result.damage,
      healing: result.healing,
      targetHp: targetParticipant?.hp,
      targetMaxHp: targetParticipant?.maxHp,
      targetDowned: result.targetDowned,
      buffsApplied: result.buffsApplied,
    } as any);

    this.narrateAbility(player.roomId, player.name, ability.name, targetParticipant?.name, result);

    if (result.targetDowned && targetId) {
      const targetPlayer = this.playerManager.getPlayer(targetId);
      if (targetPlayer) {
        this.playerManager.takeDamage(targetId, 999);
        this.broadcast({ type: 'player_update', player: targetPlayer });
      }
    }

    combat.markActionTaken(playerId);
    this.playerManager.regenEnergy(playerId, ENERGY_CONFIG.regenPerTurn);
    this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(playerId)! });
    combat.advanceTurn();
    this.afterCombatTurn(player.roomId, combat);
  }

  private narrateAbility(
    roomId: string, actorName: string, abilityName: string,
    targetName: string | undefined, result: { damage?: number; healing?: number; buffsApplied?: string[] },
  ): void {
    let message: string;
    if (result.damage) {
      message = `${actorName} uses ${abilityName} on ${targetName} for ${result.damage} damage!`;
    } else if (result.healing) {
      message = `${actorName} uses ${abilityName} on ${targetName}, restoring ${result.healing} HP!`;
    } else {
      message = `${actorName} uses ${abilityName}!`;
    }
    this.broadcastToRoom(roomId, { type: 'text_log', message, logType: 'combat' });
  }

  private firePassiveTrigger(playerId: string, trigger: string, roomId: string): void {
    const player = this.playerManager.getPlayer(playerId);
    if (!player) return;
    const classDef = getClassDefinition(player.className);
    if (!classDef) return;

    for (const ability of classDef.abilities) {
      if (!ability.passive || ability.trigger !== trigger) continue;

      for (const effect of ability.effects) {
        if (effect.type === 'scout_adjacent') {
          this.handleScoutAdjacent(playerId, roomId);
        }
      }
    }
  }

  private handleScoutAdjacent(playerId: string, roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const threats: Partial<Record<Direction, boolean>> = {};
    for (const [dir, targetId] of Object.entries(room.exits)) {
      if (!targetId) continue;
      const adjacentRoom = this.rooms.get(targetId);
      if (adjacentRoom) {
        threats[dir as Direction] = !!(adjacentRoom.encounter && !this.clearedRooms.has(targetId));
      }
    }
    this.sendTo(playerId, { type: 'scout_result' as any, roomId, adjacentThreats: threats });
  }

  private fireVictoryPassives(roomId: string): void {
    const playersInRoom = this.playerManager.getPlayersInRoom(roomId)
      .filter(p => p.status !== 'downed');

    for (const player of playersInRoom) {
      const classDef = getClassDefinition(player.className);
      if (!classDef) continue;

      for (const ability of classDef.abilities) {
        if (!ability.passive || ability.trigger !== 'on_combat_victory') continue;

        for (const effect of ability.effects) {
          if (effect.type === 'extra_loot_roll') {
            const chance = (effect.chance as number) ?? 0;
            if (Math.random() < chance) {
              this.handleExtraLootRoll(roomId);
              this.broadcastToRoom(roomId, {
                type: 'text_log',
                message: `${player.name}'s quick fingers find extra loot!`,
                logType: 'loot',
              });
            }
            return; // Only one pickpocket roll per combat
          }
        }
      }
    }
  }

  private handleExtraLootRoll(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room?.encounter) return;
    const template = this.mobs.get(room.encounter.mobId);
    if (!template) return;
    this.resolveAndRouteDrops(roomId, template.drops, room.encounter.skullRating);
  }

  handleItemEffectAction(playerId: string, effectId: string, targetId?: string): void {
    const player = this.playerManager.getPlayer(playerId);
    if (!player || player.status !== 'in_combat') return;
    const combat = this.combats.get(player.roomId);
    if (!combat || !combat.isPlayerTurn(playerId)) return;

    const resolver = combat.getEffectResolver();
    const participants = combat.getParticipantsArray();
    const caster = participants.find(p => p.id === playerId);
    const target = targetId ? participants.find(p => p.id === targetId) : undefined;
    if (!caster) return;

    const result = resolver.resolveActivatedEffect(playerId, effectId, caster, target, participants);
    if (!result.success) {
      this.sendTo(playerId, { type: 'error', message: 'Cannot use that ability right now.' });
      return;
    }

    if (result.selfDamage) {
      combat.applyDamage(playerId, result.selfDamage);
    }
    if (result.reviveHp && result.targetIds?.[0]) {
      const reviveTargetId = result.targetIds[0];
      const combatParticipant = combat.getParticipant(reviveTargetId);
      if (combatParticipant) {
        (combatParticipant as any).alive = true;
        (combatParticipant as any).hp = result.reviveHp;
      }
      this.playerManager.revivePlayer(reviveTargetId, result.reviveHp);
      this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(reviveTargetId)! });
    }
    if (result.healing && result.targetIds) {
      for (const allyId of result.targetIds) {
        combat.applyHealing(allyId, result.healing);
        const allyPlayer = this.playerManager.getPlayer(allyId);
        if (allyPlayer) {
          this.playerManager.healPlayer(allyId, result.healing);
          this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(allyId)! });
        }
      }
    }

    this.broadcastToRoom(player.roomId, {
      type: 'combat_action_result',
      actorId: playerId, actorName: player.name, action: 'use_item_effect',
      itemEffect: effectId, itemEffectHealing: result.healing,
      itemEffectDamage: result.selfDamage, targetId,
    } as any);

    this.narrateItemEffect(player.roomId, player.name, effectId, result);
    this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(playerId)! });

    combat.advanceTurn();
    this.afterCombatTurn(player.roomId, combat);
  }

  private narrateItemEffect(roomId: string, actorName: string, effectId: string, result: any): void {
    let message = '';
    switch (effectId) {
      case 'overcharge':
        message = `${actorName} activates Overcharge! Power surges through their weapon...`;
        break;
      case 'revive_once':
        message = `${actorName} uses the Aegis to pull an ally back from death!`;
        break;
      case 'rally':
        message = `${actorName} rallies the party! Everyone is healed for ${result.healing} HP.`;
        break;
    }
    if (message) this.broadcastToRoom(roomId, { type: 'text_log', message, logType: 'combat' });
  }

  getState() {
    return {
      players: this.playerManager.getAllPlayers(),
      revealedRooms: Array.from(this.revealedRooms),
      clearedRooms: Array.from(this.clearedRooms),
    };
  }
}
