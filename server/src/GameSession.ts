import {
  type Room,
  type MobTemplate,
  type MobInstance,
  type Item,
  type Direction,
  type Player,
  type DungeonContent,
  type ServerMessage,
  DRIPPING_HALLS,
  clampCritMultiplier,
  clampDamageReduction,
  QTE_CONFIG,
} from '@caverns/shared';
import { PlayerManager } from './PlayerManager.js';
import { CombatManager, type CombatPlayerInfo } from './CombatManager.js';
import { LootManager } from './LootManager.js';

export class GameSession {
  private rooms: Map<string, Room>;
  private mobs: Map<string, MobTemplate>;
  private items: Map<string, Item>;
  private revealedRooms = new Set<string>();
  private clearedRooms = new Set<string>();
  private combats = new Map<string, CombatManager>();
  private playerManager = new PlayerManager();
  private lootManager: LootManager;
  private content: DungeonContent;
  private broadcast: (msg: ServerMessage) => void;
  private sendTo: (playerId: string, msg: ServerMessage) => void;
  private broadcastToRoom: (roomId: string, msg: ServerMessage) => void;
  private playerIds: string[] = [];
  private playerNames = new Map<string, string>();
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
    content?: DungeonContent
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
  }

  addPlayer(id: string, name: string): void {
    this.playerIds.push(id);
    this.playerNames.set(id, name);
  }

  startGame(): void {
    this.started = true;
    const entranceId = this.content.entranceRoomId;
    for (const pid of this.playerIds) {
      this.playerManager.addPlayer(pid, this.playerNames.get(pid)!, entranceId);
    }
    this.revealedRooms.add(entranceId);
    const entrance = this.rooms.get(entranceId)!;
    const revealedRoomMap: Record<string, Room> = {};
    revealedRoomMap[entranceId] = entrance;
    const playerMap: Record<string, Player> = {};
    for (const p of this.playerManager.getAllPlayers()) {
      playerMap[p.id] = p;
    }
    for (const pid of this.playerIds) {
      this.sendTo(pid, {
        type: 'game_start', playerId: pid,
        players: playerMap, rooms: revealedRoomMap, currentRoomId: entranceId,
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

  handleMove(playerId: string, direction: Direction): void {
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
    const currentRoom = this.rooms.get(player.roomId);
    if (!currentRoom) return;
    const targetRoomId = currentRoom.exits[direction];
    if (!targetRoomId) {
      this.sendTo(playerId, { type: 'error', message: `There is no exit to the ${direction}.` });
      return;
    }
    const targetRoom = this.rooms.get(targetRoomId);
    if (!targetRoom) return;
    this.playerManager.movePlayer(playerId, targetRoomId);
    const isNewRoom = !this.revealedRooms.has(targetRoomId);
    if (isNewRoom) {
      this.revealedRooms.add(targetRoomId);
      this.broadcast({ type: 'room_reveal', room: targetRoom });
    }
    this.broadcast({ type: 'player_moved', playerId, roomId: targetRoomId });
    this.broadcast({
      type: 'text_log',
      message: `${player.name} moves ${direction} to ${targetRoom.name}.`,
      logType: 'system',
    });
    this.sendTo(playerId, {
      type: 'text_log',
      message: `--- ${targetRoom.name} ---\n${targetRoom.description}\n\nExits: ${Object.keys(targetRoom.exits).join(', ')}`,
      logType: 'narration',
    });
    if (this.combats.has(targetRoomId)) {
      this.joinExistingCombat(playerId, targetRoomId);
      return;
    }
    if (targetRoom.encounter && !this.clearedRooms.has(targetRoomId)) {
      this.startCombat(targetRoomId, targetRoom.encounter.mobId);
    }
  }

  private startCombat(roomId: string, mobTemplateId: string): void {
    const template = this.mobs.get(mobTemplateId);
    if (!template) return;
    const mobInstance: MobInstance = {
      instanceId: `${template.id}_${Date.now()}`,
      templateId: template.id, name: template.name,
      maxHp: template.maxHp, hp: template.maxHp,
      damage: template.damage, defense: template.defense, initiative: template.initiative,
    };
    const playersInRoom = this.playerManager.getPlayersInRoom(roomId);
    const combatPlayers: CombatPlayerInfo[] = playersInRoom.map((p) => {
      const stats = this.playerManager.getComputedStats(p.id);
      return { id: p.id, name: p.name, hp: p.hp, maxHp: stats.maxHp, damage: stats.damage, defense: stats.defense, initiative: stats.initiative };
    });
    for (const p of playersInRoom) {
      this.playerManager.setStatus(p.id, 'in_combat');
      this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(p.id)! });
    }
    const combat = new CombatManager(roomId, combatPlayers, [mobInstance]);
    this.combats.set(roomId, combat);
    const skulls = '\u2620'.repeat(template.skullRating);
    this.broadcastToRoom(roomId, {
      type: 'text_log',
      message: `A ${template.name} appears! (${skulls})\n${template.description}`,
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
    });
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
          const currentRoom = this.rooms.get(p.roomId);
          const targetRoomId = currentRoom?.exits[fleeDirection];
          if (targetRoomId) {
            this.playerManager.movePlayer(playerId, targetRoomId);
            this.broadcast({ type: 'player_moved', playerId, roomId: targetRoomId });
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
      const delay = result === 'victory' ? 1000 : 0;
      setTimeout(() => this.finishCombat(roomId, result as 'victory' | 'flee' | 'wipe'), delay);
      return;
    }
    const currentId = combat.getCurrentTurnId();
    if (combat.isMobTurn(currentId)) {
      // Delay mob turns so attack animations play out before the next action
      setTimeout(() => this.processMobTurn(roomId, combat), 600);
    } else {
      this.broadcastTurnPrompt(combat);
    }
  }

  private finishCombat(roomId: string, result: 'victory' | 'flee' | 'wipe'): void {
    this.broadcastToRoom(roomId, { type: 'combat_end', result });
    this.combats.delete(roomId);
    for (const p of this.playerManager.getPlayersInRoom(roomId)) {
      if (p.status === 'in_combat') {
        this.playerManager.setStatus(p.id, 'exploring');
        this.broadcast({ type: 'player_update', player: this.playerManager.getPlayer(p.id)! });
      }
    }
    if (result === 'victory') {
      this.clearRoom(roomId);
      this.broadcastToRoom(roomId, { type: 'text_log', message: 'The enemies have been defeated!', logType: 'combat' });
      this.dropLoot(roomId);
      const room = this.rooms.get(roomId);
      if (room?.type === 'boss') {
        this.broadcast({ type: 'game_over', result: 'victory' });
      }
    }
    if (this.playerManager.allPlayersDowned()) {
      this.broadcast({ type: 'game_over', result: 'wipe' });
    }
  }

  private processMobTurn(roomId: string, combat: CombatManager): void {
    const mobId = combat.getCurrentTurnId();
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
        } else if (result.critMultiplier && result.critMultiplier <= 0.75) {
          message = `${result.actorName}'s strike goes wide — ${result.damage} damage to ${result.targetName}.`;
        } else {
          message = `${result.actorName} attacks ${result.targetName} for ${result.damage} damage!`;
        }
        if (result.targetDowned) message += ` ${result.targetName} goes down!`;
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
        const randomId = template.lootTable[Math.floor(Math.random() * template.lootTable.length)];
        const item = this.items.get(randomId);
        if (item) droppedItems.push({ ...item, id: `${item.id}_${this.nextLootInstanceId++}` });
      }
    }
    if (droppedItems.length === 0) return;
    const playerIds = this.playerManager.getPlayersInRoom(roomId)
      .filter((p) => p.status !== 'downed').map((p) => p.id);
    if (playerIds.length === 0) return;
    for (const item of droppedItems) {
      this.broadcastToRoom(roomId, { type: 'text_log', message: `[${item.rarity.toUpperCase()}] ${item.name} dropped!`, logType: 'loot' });
    }
    if (playerIds.length > 1) {
      this.broadcastToRoom(roomId, { type: 'loot_prompt', items: droppedItems, timeout: 15000 });
    }
    this.lootManager.startLootRound(roomId, droppedItems, playerIds);
  }

  private handleLootAwarded(item: Item, winnerId: string): void {
    const winner = this.playerManager.getPlayer(winnerId);
    const winnerName = winner?.name ?? 'Unknown';
    const roomId = winner?.roomId;
    const added = this.playerManager.addToInventory(winnerId, { ...item });
    if (!added) {
      if (roomId) {
        this.broadcastToRoom(roomId, { type: 'text_log', message: `${winnerName}'s inventory is full! ${item.name} is lost.`, logType: 'loot' });
      }
      return;
    }
    if (roomId) {
      this.broadcastToRoom(roomId, { type: 'loot_result', itemId: item.id, itemName: item.name, winnerId, winnerName });
      this.broadcastToRoom(roomId, { type: 'text_log', message: `${winnerName} receives ${item.name}!`, logType: 'loot' });
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

  getState() {
    return {
      players: this.playerManager.getAllPlayers(),
      revealedRooms: Array.from(this.revealedRooms),
      clearedRooms: Array.from(this.clearedRooms),
    };
  }
}
