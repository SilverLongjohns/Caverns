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
} from '@caverns/shared';
import { PlayerManager } from './PlayerManager.js';
import { CombatManager, type CombatPlayerInfo } from './CombatManager.js';
import { LootManager } from './LootManager.js';
import { AbilityResolver } from './AbilityResolver.js';
import { InteractionResolver } from './InteractionResolver.js';
import { buildTileGrid } from './tileGridBuilder.js';
import { RoomGrid } from '@caverns/roomgrid';
import type { RoomGridConfig, TileType, GridPosition } from '@caverns/roomgrid';
import { MobAIManager } from './MobAIManager.js';
import { exitPosition } from './tileGridBuilder.js';
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

export class GameSession {
  private rooms: Map<string, Room>;
  private mobs: Map<string, MobTemplate>;
  private items: Map<string, Item>;
  private revealedRooms = new Set<string>();
  private clearedRooms = new Set<string>();
  private solvedPuzzles = new Set<string>();
  private activePuzzleSolver = new Map<string, string>(); // roomId -> playerId
  private combats = new Map<string, CombatManager>();
  private playerManager = new PlayerManager();
  private lootManager: LootManager;
  private content: DungeonContent;
  private broadcast: (msg: ServerMessage) => void;
  private sendTo: (playerId: string, msg: ServerMessage) => void;
  private broadcastToRoom: (roomId: string, msg: ServerMessage) => void;
  private playerIds: string[] = [];
  private playerNames = new Map<string, string>();
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
    private onGameOver?: () => void
  ) {
    this.broadcast = broadcast;
    this.sendTo = sendTo;
    this.broadcastToRoom = (roomId: string, msg: ServerMessage) => {
      for (const p of this.playerManager.getPlayersInRoom(roomId)) {
        this.sendTo(p.id, msg);
      }
    };
    this.content = content ?? DRIPPING_HALLS;
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
      const className = this.playerClasses.get(pid) ?? 'vanguard';
      this.playerManager.addPlayer(pid, this.playerNames.get(pid)!, entranceId, className);
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
          // Move player back off the interactable tile
          const oppositeDir = this.getOppositeGridDir(direction);
          if (oppositeDir) {
            grid.moveEntity(playerId, oppositeDir as GridDirection);
            const entity = grid.getEntity(playerId);
            if (entity) {
              this.playerGridPositions.set(playerId, { ...entity.position });
              this.mobAIManager.updatePlayerPosition(player.roomId, playerId, entity.position);
              // Broadcast corrected position so client stays in sync
              this.broadcastToRoom(player.roomId, {
                type: 'player_position',
                playerId,
                roomId: player.roomId,
                x: entity.position.x,
                y: entity.position.y,
              });
            }
          }
          // Open interaction menu
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
    const combat = new CombatManager(roomId, combatPlayers, mobInstances, playerEffects, usedDungeonEffects);
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
    this.broadcastToRoom(roomId, { type: 'combat_start', combat: combat.getState() });
    const firstTurnId = combat.getCurrentTurnId();
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
    this.broadcastToRoom(roomId, { type: 'combat_start', combat: combat.getState() });
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

  private afterCombatTurn(roomId: string, combat: CombatManager): void {
    if (combat.isComplete()) {
      const result = combat.getResult();
      // Delay combat end on victory so the client disintegration animation plays
      const delay = result === 'victory' ? TIMING_CONFIG.victoryDelayMs : 0;
      setTimeout(() => this.finishCombat(roomId, result as 'victory' | 'flee' | 'wipe'), delay);
      return;
    }
    const currentId = combat.getCurrentTurnId();
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
      const allParticipants = combat.getParticipantsArray();
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
        }
      }
      this.dropLoot(roomId);
      if (room?.type === 'boss') {
        // Delay so loot prompt and victory text are visible before game_over
        setTimeout(() => {
          this.broadcast({ type: 'game_over', result: 'victory' });
          this.onGameOver?.();
        }, TIMING_CONFIG.postVictoryLootDelayMs);
      }
    }
    if (this.playerManager.allPlayersDowned()) {
      this.broadcast({ type: 'game_over', result: 'wipe' });
      this.onGameOver?.();
    }
  }

  private processMobTurn(roomId: string, combat: CombatManager): void {
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

    const result = combat.resolveMobTurn(mobId);
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

  private broadcastTurnPrompt(combat: CombatManager): void {
    const state = combat.getState();
    this.broadcastToRoom(state.roomId, { type: 'combat_turn', currentTurnId: state.currentTurnId, roundNumber: state.roundNumber });
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

  /** Strip the _N instance suffix added by dropLoot (e.g. "crystal_key_3" → "crystal_key"). */
  private stripInstanceSuffix(instanceId: string): string {
    const lastUnderscore = instanceId.lastIndexOf('_');
    if (lastUnderscore === -1) return instanceId;
    const suffix = instanceId.slice(lastUnderscore + 1);
    // Only strip if the suffix is a pure number (instance counter)
    if (/^\d+$/.test(suffix)) return instanceId.slice(0, lastUnderscore);
    return instanceId;
  }

  private isKeyItem(itemId: string): boolean {
    for (const room of this.rooms.values()) {
      if (room.lockedExits) {
        for (const keyId of Object.values(room.lockedExits)) {
          if (keyId === itemId) return true;
        }
      }
    }
    return false;
  }

  private rollMobLoot(lootTable: string[], skullRating: number): Item | undefined {
    const weights = LOOT_CONFIG.skullRarityWeights[String(skullRating)]
      ?? LOOT_CONFIG.skullRarityWeights['2'];

    // Resolve items and assign weights by rarity
    const candidates: { item: Item; weight: number }[] = [];
    for (const itemId of lootTable) {
      const item = this.items.get(itemId);
      if (item) {
        candidates.push({ item, weight: weights[item.rarity] ?? 1 });
      }
    }
    if (candidates.length === 0) return undefined;

    // Weighted random pick
    const total = candidates.reduce((sum, c) => sum + c.weight, 0);
    let roll = Math.random() * total;
    for (const c of candidates) {
      roll -= c.weight;
      if (roll <= 0) return c.item;
    }
    return candidates[0].item;
  }

  private nextLootInstanceId = 1;

  private dropLoot(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const droppedItems: Item[] = [];
    if (room.loot) {
      for (const lootEntry of room.loot) {
        const item = this.items.get(lootEntry.itemId);
        if (item) droppedItems.push({ ...item, id: `${item.id}_${this.nextLootInstanceId++}` });
      }
    }
    if (room.encounter) {
      const template = this.mobs.get(room.encounter.mobId);
      if (template && template.lootTable.length > 0) {
        const item = this.rollMobLoot(template.lootTable, room.encounter.skullRating);
        if (item) droppedItems.push({ ...item, id: `${item.id}_${this.nextLootInstanceId++}` });
      }
    }
    // Separate key items from regular loot.
    // Item IDs have an instance suffix (e.g. "crystal_key_3"), so strip it to
    // match the base ID stored in room.lockedExits.
    const regularItems: Item[] = [];
    const foundKeyBaseIds: string[] = [];
    for (const item of droppedItems) {
      const baseId = this.stripInstanceSuffix(item.id);
      if (this.isKeyItem(baseId)) {
        foundKeyBaseIds.push(baseId);
      } else {
        regularItems.push(item);
      }
    }

    const playerIds = this.playerManager.getPlayersInRoom(roomId)
      .filter((p) => p.status !== 'downed').map((p) => p.id);

    // Award keys to party (use the base ID so it matches lockedExits)
    for (const keyId of foundKeyBaseIds) {
      if (playerIds.length > 0) {
        this.addKeyToParty(playerIds[0], keyId);
      }
    }

    if (regularItems.length === 0) return;
    if (playerIds.length === 0) return;
    for (const item of regularItems) {
      this.broadcastToRoom(roomId, { type: 'text_log', message: `{${item.rarity}:${item.name}} dropped!`, logType: 'loot' });
    }
    if (playerIds.length > 1) {
      this.broadcastToRoom(roomId, { type: 'loot_prompt', items: regularItems, timeout: LOOT_CONFIG.timeoutMs });
    }
    this.lootManager.startLootRound(roomId, regularItems, playerIds);
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
    const lootOverride = isSecretRoom
      ? this.content.items.filter(i => i.rarity === 'rare' || i.rarity === 'legendary' || i.rarity === 'unique')
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
      const newGrid = this.createRoomGrid(targetRoomId);
      if (targetRoom.encounter && !this.clearedRooms.has(targetRoomId)) {
        const template = this.mobs.get(targetRoom.encounter.mobId);
        if (template) {
          const mobs = this.buildEncounterMobs(targetRoomId, template);
          this.mobAIManager.registerRoom(targetRoomId, newGrid, mobs);
        }
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
    // Ensure room grid exists (may not if room was only revealed via debugRevealAll)
    if (!this.roomGrids.has(roomId)) {
      this.createRoomGrid(roomId);
    }
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

  handleUseAbility(playerId: string, abilityId: string, targetId?: string): void {
    const player = this.playerManager.getPlayer(playerId);
    if (!player || player.status !== 'in_combat') return;

    const combat = this.combats.get(player.roomId);
    if (!combat || combat.getCurrentTurnId() !== playerId) return;

    const classDef = getClassDefinition(player.className);
    if (!classDef) return;

    const ability = classDef.abilities.find(a => a.id === abilityId && !a.passive);
    if (!ability) return;

    if (!this.playerManager.hasEnergy(playerId, ability.energyCost)) {
      this.sendTo(playerId, { type: 'error', message: `Not enough energy for ${ability.name}.` });
      return;
    }

    // Resolve ability effects through AbilityResolver
    const participants = combat.getParticipantsArray();
    const caster = participants.find(p => p.id === playerId);
    const target = targetId ? participants.find(p => p.id === targetId) : null;
    if (!caster) return;

    const result = this.abilityResolver.resolveAllEffects(ability.effects, caster, target ?? null, participants);

    // Spend energy
    this.playerManager.spendEnergy(playerId, ability.energyCost);

    // Broadcast result
    const targetParticipant = targetId ? participants.find(p => p.id === targetId) : null;
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

    // Narrate
    this.narrateAbility(player.roomId, player.name, ability.name, targetParticipant?.name, result);

    this.playerManager.regenEnergy(playerId, ENERGY_CONFIG.regenPerTurn);
    // Sync player update (energy changed)
    this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(playerId)! });

    // Handle target downed by ability
    if (result.targetDowned && targetId) {
      const targetPlayer = this.playerManager.getPlayer(targetId);
      if (targetPlayer) {
        this.playerManager.takeDamage(targetId, 999);
        this.broadcast({ type: 'player_update', player: targetPlayer });
      }
    }

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
    if (!template || template.lootTable.length === 0) return;
    const item = this.rollMobLoot(template.lootTable, room.encounter.skullRating);
    if (!item) return;

    const playerIds = this.playerManager.getPlayersInRoom(roomId)
      .filter(p => p.status !== 'downed').map(p => p.id);
    if (playerIds.length === 0) return;

    const instanceItem = { ...item, id: `${item.id}_${this.nextLootInstanceId++}` };
    this.broadcastToRoom(roomId, {
      type: 'text_log',
      message: `[${instanceItem.rarity.toUpperCase()}] ${instanceItem.name} found by pickpocket!`,
      logType: 'loot',
    });
    this.lootManager.startLootRound(roomId, [instanceItem], playerIds);
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
