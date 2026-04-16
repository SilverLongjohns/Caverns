// server/src/ArenaCombatManager.ts
import type { TileGrid, MobInstance, CombatState, CombatActionResultMessage } from '@caverns/shared';
import { CombatManager, type CombatPlayerInfo } from './CombatManager.js';
import type { EquippedEffect } from '@caverns/shared';
import {
  findPath,
  pathCost,
  isAdjacent,
  isEdgeTile,
  getMovementCost,
} from './arenaMovement.js';

interface TurnState {
  movementRemaining: number;
  actionTaken: boolean;
}

export class ArenaCombatManager {
  private grid: TileGrid;
  private positions: Map<string, { x: number; y: number }>;
  private combatManager: CombatManager;
  private turnStates: Map<string, TurnState> = new Map();

  constructor(
    roomId: string,
    grid: TileGrid,
    players: CombatPlayerInfo[],
    mobs: MobInstance[],
    initialPositions: Record<string, { x: number; y: number }>,
    playerEffects?: Map<string, EquippedEffect[]>,
    usedDungeonEffects?: Map<string, string[]>,
  ) {
    this.grid = grid;
    this.positions = new Map(Object.entries(initialPositions));
    this.combatManager = new CombatManager(roomId, players, mobs, playerEffects, usedDungeonEffects);
  }

  getCombatManager(): CombatManager { return this.combatManager; }
  getGrid(): TileGrid { return this.grid; }

  getPosition(id: string): { x: number; y: number } | undefined {
    return this.positions.get(id);
  }

  getAllPositions(): Record<string, { x: number; y: number }> {
    return Object.fromEntries(this.positions);
  }

  getMovementPoints(id: string): number {
    const participant = this.combatManager.getParticipant(id);
    if (!participant) return 0;
    return Math.floor(participant.initiative / 2) + 2;
  }

  startTurn(id: string): void {
    this.turnStates.set(id, {
      movementRemaining: this.getMovementPoints(id),
      actionTaken: false,
    });
  }

  getTurnState(id: string): TurnState | undefined {
    return this.turnStates.get(id);
  }

  markActionTaken(id: string): void {
    const state = this.turnStates.get(id);
    if (state) state.actionTaken = true;
  }

  private getOccupied(excludeId?: string): Set<string> {
    const occupied = new Set<string>();
    for (const [id, pos] of this.positions) {
      if (id === excludeId) continue;
      const participant = this.combatManager.getParticipant(id);
      if (participant?.alive) {
        occupied.add(`${pos.x},${pos.y}`);
      }
    }
    return occupied;
  }

  handleMove(
    id: string,
    target: { x: number; y: number },
  ): { success: boolean; movementRemaining: number; path?: { x: number; y: number }[]; hazardDamage?: number } {
    const turnState = this.turnStates.get(id);
    if (!turnState || turnState.movementRemaining <= 0) {
      return { success: false, movementRemaining: turnState?.movementRemaining ?? 0 };
    }

    const currentPos = this.positions.get(id);
    if (!currentPos) return { success: false, movementRemaining: 0 };

    const occupied = this.getOccupied(id);
    const path = findPath(this.grid, currentPos, target, turnState.movementRemaining, occupied);
    if (!path) {
      return { success: false, movementRemaining: turnState.movementRemaining };
    }

    const cost = pathCost(this.grid, path);
    turnState.movementRemaining -= cost;
    this.positions.set(id, target);

    // Check for hazard damage at destination
    let hazardDamage = 0;
    const destTile = this.grid.tiles[target.y][target.x];
    if (destTile === 'hazard') {
      hazardDamage = 5;
      this.combatManager.applyDamage(id, hazardDamage);
    }

    return { success: true, movementRemaining: turnState.movementRemaining, path, hazardDamage };
  }

  validateAttack(attackerId: string, targetId: string): boolean {
    const attackerPos = this.positions.get(attackerId);
    const targetPos = this.positions.get(targetId);
    if (!attackerPos || !targetPos) return false;
    return isAdjacent(attackerPos, targetPos);
  }

  canFlee(id: string): boolean {
    const pos = this.positions.get(id);
    if (!pos) return false;
    return isEdgeTile(this.grid, pos);
  }

  removeFromArena(id: string): void {
    this.positions.delete(id);
  }

  resolveMobTurn(mobId: string): { combat: Partial<CombatActionResultMessage> | null; path: { x: number; y: number }[] } {
    const mobPos = this.positions.get(mobId);
    if (!mobPos) return { combat: null, path: [] };

    const participant = this.combatManager.getParticipant(mobId);
    if (!participant || !participant.alive || participant.type !== 'mob') return { combat: null, path: [] };

    this.startTurn(mobId);
    const turnState = this.turnStates.get(mobId)!;

    const alivePlayers = this.combatManager.getAlivePlayers();
    const occupied = this.getOccupied(mobId);

    // Check if already adjacent to any player — attack immediately
    for (const playerId of alivePlayers) {
      const playerPos = this.positions.get(playerId);
      if (!playerPos) continue;
      if (isAdjacent(mobPos, playerPos)) {
        return { combat: this.combatManager.resolveMobTurn(mobId), path: [] };
      }
    }

    // Not adjacent — find nearest player and move toward them
    let bestTarget: string | null = null;
    let bestPath: { x: number; y: number }[] | null = null;
    let bestDistance = Infinity;

    for (const playerId of alivePlayers) {
      const playerPos = this.positions.get(playerId);
      if (!playerPos) continue;

      const adjacentTiles = [
        { x: playerPos.x - 1, y: playerPos.y },
        { x: playerPos.x + 1, y: playerPos.y },
        { x: playerPos.x, y: playerPos.y - 1 },
        { x: playerPos.x, y: playerPos.y + 1 },
      ].filter(t =>
        t.x >= 0 && t.x < this.grid.width &&
        t.y >= 0 && t.y < this.grid.height &&
        getMovementCost(this.grid.tiles[t.y][t.x]) !== Infinity &&
        !occupied.has(`${t.x},${t.y}`)
      );

      for (const adjTile of adjacentTiles) {
        const path = findPath(this.grid, mobPos, adjTile, 999, occupied);
        if (path && path.length < bestDistance) {
          bestTarget = playerId;
          bestPath = path;
          bestDistance = path.length;
        }
      }
    }

    if (!bestTarget || !bestPath) return { combat: null, path: [] };

    // Move along path as far as movement allows, track the walked path
    const walkedPath: { x: number; y: number }[] = [];
    for (const step of bestPath) {
      const cost = getMovementCost(this.grid.tiles[step.y][step.x]);
      if (turnState.movementRemaining < cost) break;
      turnState.movementRemaining -= cost;
      this.positions.set(mobId, step);
      walkedPath.push(step);
    }

    // Attack if now adjacent after moving
    const finalMobPos = this.positions.get(mobId)!;
    const targetPos = this.positions.get(bestTarget);
    if (targetPos && isAdjacent(finalMobPos, targetPos)) {
      return { combat: this.combatManager.resolveMobTurn(mobId), path: walkedPath };
    }

    return { combat: null, path: walkedPath };
  }

  setPosition(id: string, pos: { x: number; y: number }): void {
    this.positions.set(id, pos);
  }

  // CombatManager delegates
  getCombatState(): CombatState { return this.combatManager.getState(); }
  getState(): CombatState { return this.combatManager.getState(); }
  getCurrentTurnId(): string { return this.combatManager.getCurrentTurnId(); }
  advanceTurn(): void { this.combatManager.advanceTurn(); }
  isComplete(): boolean { return this.combatManager.isComplete(); }
  getResult(): 'victory' | 'flee' | 'wipe' | 'ongoing' { return this.combatManager.getResult(); }
  isPlayerTurn(id: string): boolean { return this.combatManager.isPlayerTurn(id); }
  isMobTurn(id: string): boolean { return this.combatManager.isMobTurn(id); }
  getDeadMobIds(): string[] { return this.combatManager.getDeadMobIds(); }
  getAlivePlayers(): string[] { return this.combatManager.getAlivePlayers(); }
  getPlayerHp(id: string): number { return this.combatManager.getPlayerHp(id); }
  getEffectResolver() { return this.combatManager.getEffectResolver(); }
  getConsumedEffects() { return this.combatManager.getConsumedEffects(); }
  cancelAfkTimer(): void { this.combatManager.cancelAfkTimer(); }
  armAfkTimer(playerId: string, isAfk: () => boolean, onSkip: () => void, delayMs?: number): void {
    this.combatManager.armAfkTimer(playerId, isAfk, onSkip, delayMs);
  }
  addPlayer(player: CombatPlayerInfo, effects?: EquippedEffect[], usedEffects?: string[]): void {
    this.combatManager.addPlayer(player, effects, usedEffects);
  }
  resolvePlayerAction(playerId: string, action: Parameters<CombatManager['resolvePlayerAction']>[1]) {
    return this.combatManager.resolvePlayerAction(playerId, action);
  }
  applyDamage(targetId: string, damage: number) {
    return this.combatManager.applyDamage(targetId, damage);
  }
  applyDefendDamage(targetId: string, rawDamage: number, damageReduction: number) {
    return this.combatManager.applyDefendDamage(targetId, rawDamage, damageReduction);
  }
  applyHealing(targetId: string, healing: number) {
    return this.combatManager.applyHealing(targetId, healing);
  }
  getParticipant(id: string): ReturnType<CombatManager['getParticipant']> {
    return this.combatManager.getParticipant(id);
  }
  getParticipantsArray() {
    return this.combatManager.getParticipantsArray();
  }
}
