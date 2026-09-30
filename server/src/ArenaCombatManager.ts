// server/src/ArenaCombatManager.ts
import type { TileGrid, MobInstance, CombatState, CombatActionResultMessage } from '@caverns/shared';
import { CombatManager, type CombatPlayerInfo } from './CombatManager.js';
import type { EquippedEffect } from '@caverns/shared';
import { chebyshev, hitChance, hasLineOfSight, isValidTeleportDestination, type TeleportEffect } from '@caverns/shared';
import {
  findPath,
  pathCost,
  isAdjacent,
  isEdgeTile,
  getMovementCost,
} from './arenaMovement.js';

const HAZARD_DAMAGE = 5;
const isWalkableTile = (tile: string) => getMovementCost(tile) !== Infinity;

interface TurnState {
  movementRemaining: number;
  actionTaken: boolean;
  /** Free-action ability ids used this turn. */
  freeActionsUsed: Set<string>;
}

export type TeleportOutcome =
  | { ok: false }
  | { ok: true; from: { x: number; y: number }; hazardDamage: number; hp: number; downed: boolean };

export type ShotCheck = { ok: true; distance: number; hitChance: number } | { ok: false; reason: string };
type ArenaActionOutcome = { ok: true; result: Partial<CombatActionResultMessage> } | { ok: false; reason: string };

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

  /** Reconnect: re-key position and turn state as well as the combat participant. */
  replaceParticipantId(oldId: string, newId: string): void {
    for (const m of [this.positions, this.turnStates] as Map<string, unknown>[]) {
      if (m.has(oldId)) { m.set(newId, m.get(oldId)); m.delete(oldId); }
    }
    this.combatManager.replaceParticipantId(oldId, newId);
  }
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
      freeActionsUsed: new Set(),
    });
  }

  getTurnState(id: string): TurnState | undefined {
    return this.turnStates.get(id);
  }

  markActionTaken(id: string): void {
    const state = this.turnStates.get(id);
    if (state) state.actionTaken = true;
  }

  markFreeActionUsed(id: string, abilityId: string): void {
    this.turnStates.get(id)?.freeActionsUsed.add(abilityId);
  }

  /** Teleport a unit to `to` if the effect allows it. No movement points are spent; hazards still bite. */
  teleport(id: string, to: { x: number; y: number }, effect: TeleportEffect): TeleportOutcome {
    const from = this.positions.get(id);
    const participant = this.combatManager.getParticipant(id);
    if (!from || !participant) return { ok: false };
    const valid = isValidTeleportDestination(
      { grid: this.grid, from, effect, initiative: participant.initiative, occupied: this.getOccupied(id), isWalkable: isWalkableTile },
      to,
    );
    if (!valid) return { ok: false };
    this.positions.set(id, { x: to.x, y: to.y });
    let hazardDamage = 0;
    let downed = false;
    if (this.grid.tiles[to.y][to.x] === 'hazard') {
      hazardDamage = HAZARD_DAMAGE;
      downed = this.combatManager.applyDamage(id, hazardDamage)?.targetDowned ?? false;
    }
    return { ok: true, from: { ...from }, hazardDamage, hp: participant.hp, downed };
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
      hazardDamage = HAZARD_DAMAGE;
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

    const occupied = this.getOccupied(mobId);
    const alive = this.combatManager.getAlivePlayers();
    // A taunting player is the only valid target while it can be reached.
    const taunter = alive.find((id) => this.combatManager.getParticipant(id)?.buffs.some((b) => b.type === 'taunt'));
    const candidates = taunter ? [taunter] : alive;
    let result = this.approachAndAttack(mobId, mobPos, candidates, occupied, turnState);
    if (!result && taunter) result = this.approachAndAttack(mobId, mobPos, alive, occupied, turnState);
    return result ?? { combat: null, path: [] };
  }

  /** Attack an adjacent candidate, or walk toward the nearest reachable one. Null if none is reachable. */
  private approachAndAttack(
    mobId: string,
    mobPos: { x: number; y: number },
    alivePlayers: string[],
    occupied: Set<string>,
    turnState: { movementRemaining: number },
  ): { combat: Partial<CombatActionResultMessage> | null; path: { x: number; y: number }[] } | null {
    // Check if already adjacent to any player — attack immediately
    for (const playerId of alivePlayers) {
      const playerPos = this.positions.get(playerId);
      if (!playerPos) continue;
      if (isAdjacent(mobPos, playerPos)) {
        return { combat: this.combatManager.resolveMobTurn(mobId, playerId), path: [] };
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

    if (!bestTarget || !bestPath) return null;

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
      return { combat: this.combatManager.resolveMobTurn(mobId, bestTarget), path: walkedPath };
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
    // Place the new player on a free walkable tile near existing players
    this.placeNewPlayer(player.id);
  }

  private placeNewPlayer(id: string): void {
    const occupied = this.getOccupied();
    // Gather existing player positions to spawn near them
    const playerPositions: { x: number; y: number }[] = [];
    for (const [pid, pos] of this.positions) {
      if (pid === id) continue;
      const p = this.combatManager.getParticipant(pid);
      if (p && p.type === 'player' && p.alive) playerPositions.push(pos);
    }
    // Try tiles adjacent to existing players first, then any walkable tile
    const candidates: { x: number; y: number; dist: number }[] = [];
    for (let y = 0; y < this.grid.height; y++) {
      for (let x = 0; x < this.grid.width; x++) {
        if (getMovementCost(this.grid.tiles[y][x]) === Infinity) continue;
        if (occupied.has(`${x},${y}`)) continue;
        const minDist = playerPositions.length > 0
          ? Math.min(...playerPositions.map(p => Math.abs(p.x - x) + Math.abs(p.y - y)))
          : 0;
        candidates.push({ x, y, dist: minDist });
      }
    }
    candidates.sort((a, b) => a.dist - b.dist);
    if (candidates.length > 0) {
      this.positions.set(id, { x: candidates[0].x, y: candidates[0].y });
    }
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

  checkShot(attackerId: string, targetId: string): ShotCheck {
    const gun = this.combatManager.getRanged(attackerId);
    if (!gun) return { ok: false, reason: 'You have no gun equipped.' };
    if (gun.ammo <= 0) return { ok: false, reason: 'Out of ammo — reload first.' };
    const attacker = this.combatManager.getParticipant(attackerId);
    const target = this.combatManager.getParticipant(targetId);
    if (!target?.alive || target.type === attacker?.type) return { ok: false, reason: 'Not a valid target.' };
    const from = this.positions.get(attackerId);
    const to = this.positions.get(targetId);
    if (!from || !to) return { ok: false, reason: 'Not a valid target.' };
    if (!hasLineOfSight(this.grid, from, to, gun.profile.range)) return { ok: false, reason: 'Target is out of range or line of sight.' };
    const distance = chebyshev(from, to);
    return { ok: true, distance, hitChance: hitChance(distance, gun.profile.marksmanship) };
  }

  shoot(attackerId: string, targetId: string, rng: () => number = Math.random): ArenaActionOutcome {
    const check = this.checkShot(attackerId, targetId);
    if (!check.ok) return check;
    const result = this.combatManager.resolveShot(attackerId, targetId, rng() < check.hitChance, check.hitChance);
    return result ? { ok: true, result } : { ok: false, reason: 'Cannot shoot now.' };
  }

  reload(id: string): ArenaActionOutcome {
    const gun = this.combatManager.getRanged(id);
    if (!gun) return { ok: false, reason: 'You have no gun equipped.' };
    const result = this.combatManager.reload(id);
    return result ? { ok: true, result } : { ok: false, reason: 'Already fully loaded.' };
  }
}
