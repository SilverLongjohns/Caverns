import type {
  MobInstance,
  CombatState,
  CombatParticipant,
  CombatActionResultMessage,
  Direction,
} from '@caverns/shared';

export interface CombatPlayerInfo {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  damage: number;
  defense: number;
  initiative: number;
}

interface InternalParticipant {
  id: string;
  type: 'player' | 'mob';
  name: string;
  hp: number;
  maxHp: number;
  damage: number;
  defense: number;
  initiative: number;
  isDefending: boolean;
  alive: boolean;
}

export class CombatManager {
  private roomId: string;
  private participants: Map<string, InternalParticipant> = new Map();
  private turnOrder: string[] = [];
  private turnIndex = 0;
  private roundNumber = 1;

  constructor(roomId: string, players: CombatPlayerInfo[], mobs: MobInstance[]) {
    this.roomId = roomId;
    for (const p of players) {
      this.participants.set(p.id, {
        id: p.id, type: 'player', name: p.name,
        hp: p.hp, maxHp: p.maxHp, damage: p.damage,
        defense: p.defense, initiative: p.initiative,
        isDefending: false, alive: true,
      });
    }
    for (const m of mobs) {
      this.participants.set(m.instanceId, {
        id: m.instanceId, type: 'mob', name: m.name,
        hp: m.hp, maxHp: m.maxHp, damage: m.damage,
        defense: m.defense, initiative: m.initiative,
        isDefending: false, alive: true,
      });
    }
    this.rollInitiativeOrder();
  }

  private rollInitiativeOrder(): void {
    const alive = Array.from(this.participants.values()).filter((p) => p.alive);
    alive.sort((a, b) => b.initiative + Math.random() * 5 - (a.initiative + Math.random() * 5));
    this.turnOrder = alive.map((p) => p.id);
    this.turnIndex = 0;
  }

  getCurrentTurnId(): string {
    return this.turnOrder[this.turnIndex];
  }

  advanceTurn(): void {
    this.turnIndex++;
    while (this.turnIndex < this.turnOrder.length && !this.participants.get(this.turnOrder[this.turnIndex])?.alive) {
      this.turnIndex++;
    }
    if (this.turnIndex >= this.turnOrder.length) {
      this.roundNumber++;
      for (const p of this.participants.values()) { p.isDefending = false; }
      this.rollInitiativeOrder();
    }
  }

  addPlayer(player: CombatPlayerInfo): void {
    this.participants.set(player.id, {
      id: player.id, type: 'player', name: player.name,
      hp: player.hp, maxHp: player.maxHp, damage: player.damage,
      defense: player.defense, initiative: player.initiative,
      isDefending: false, alive: true,
    });
  }

  resolvePlayerAction(playerId: string, action: {
    action: 'attack' | 'defend' | 'use_item' | 'flee';
    targetId?: string; itemDamage?: number; itemHealing?: number; fleeDirection?: Direction;
  }): Partial<CombatActionResultMessage> | null {
    const actor = this.participants.get(playerId);
    if (!actor || !actor.alive) return null;

    switch (action.action) {
      case 'attack': {
        const target = this.participants.get(action.targetId!);
        if (!target || !target.alive) return null;
        const effectiveDefense = target.isDefending ? target.defense * 2 : target.defense;
        const damage = Math.max(1, actor.damage - effectiveDefense);
        target.hp = Math.max(0, target.hp - damage);
        const targetDowned = target.hp === 0;
        if (targetDowned) target.alive = false;
        return {
          actorId: playerId, actorName: actor.name, action: 'attack',
          targetId: target.id, targetName: target.name, damage,
          targetHp: target.hp, targetMaxHp: target.maxHp, targetDowned,
        };
      }
      case 'defend': {
        actor.isDefending = true;
        return { actorId: playerId, actorName: actor.name, action: 'defend' };
      }
      case 'use_item': {
        if (action.itemDamage && action.targetId) {
          const target = this.participants.get(action.targetId);
          if (!target || !target.alive) return null;
          target.hp = Math.max(0, target.hp - action.itemDamage);
          const targetDowned = target.hp === 0;
          if (targetDowned) target.alive = false;
          return {
            actorId: playerId, actorName: actor.name, action: 'use_item',
            targetId: target.id, targetName: target.name, damage: action.itemDamage,
            targetHp: target.hp, targetMaxHp: target.maxHp, targetDowned,
          };
        }
        if (action.itemHealing) {
          const healed = Math.min(action.itemHealing, actor.maxHp - actor.hp);
          actor.hp += healed;
          return { actorId: playerId, actorName: actor.name, action: 'use_item', healing: healed, actorHp: actor.hp };
        }
        return null;
      }
      case 'flee': {
        let totalOpportunityDamage = 0;
        for (const p of this.participants.values()) {
          if (p.type === 'mob' && p.alive) totalOpportunityDamage += Math.floor(p.damage / 2);
        }
        actor.hp = Math.max(0, actor.hp - totalOpportunityDamage);
        actor.alive = false;
        const actorDowned = actor.hp === 0;
        return {
          actorId: playerId, actorName: actor.name, action: 'flee',
          damage: totalOpportunityDamage, actorHp: actor.hp, actorDowned,
          fled: true, fleeDirection: action.fleeDirection,
        };
      }
    }
  }

  resolveMobTurn(mobId: string): Partial<CombatActionResultMessage> | null {
    const mob = this.participants.get(mobId);
    if (!mob || !mob.alive || mob.type !== 'mob') return null;
    const alivePlayers = Array.from(this.participants.values()).filter((p) => p.type === 'player' && p.alive);
    if (alivePlayers.length === 0) return null;
    const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
    const effectiveDefense = target.isDefending ? target.defense * 2 : target.defense;
    const damage = Math.max(1, mob.damage - effectiveDefense);
    target.hp = Math.max(0, target.hp - damage);
    const targetDowned = target.hp === 0;
    if (targetDowned) target.alive = false;
    return {
      actorId: mobId, actorName: mob.name, action: 'attack',
      targetId: target.id, targetName: target.name, damage,
      targetHp: target.hp, targetMaxHp: target.maxHp, targetDowned,
    };
  }

  isComplete(): boolean {
    const aliveMobs = Array.from(this.participants.values()).filter((p) => p.type === 'mob' && p.alive);
    const alivePlayers = Array.from(this.participants.values()).filter((p) => p.type === 'player' && p.alive);
    return aliveMobs.length === 0 || alivePlayers.length === 0;
  }

  getResult(): 'victory' | 'flee' | 'wipe' | 'ongoing' {
    const aliveMobs = Array.from(this.participants.values()).filter((p) => p.type === 'mob' && p.alive);
    const alivePlayers = Array.from(this.participants.values()).filter((p) => p.type === 'player' && p.alive);
    if (aliveMobs.length === 0) return 'victory';
    if (alivePlayers.length === 0) {
      const anyFled = Array.from(this.participants.values()).some((p) => p.type === 'player' && !p.alive && p.hp > 0);
      return anyFled ? 'flee' : 'wipe';
    }
    return 'ongoing';
  }

  getState(): CombatState {
    const participants: CombatParticipant[] = Array.from(this.participants.values())
      .filter((p) => p.alive)
      .map((p) => ({ id: p.id, type: p.type, name: p.name, hp: p.hp, maxHp: p.maxHp, initiative: p.initiative }));
    return {
      roomId: this.roomId, participants,
      turnOrder: this.turnOrder.filter((id) => this.participants.get(id)?.alive),
      currentTurnId: this.getCurrentTurnId(), roundNumber: this.roundNumber,
    };
  }

  getDeadMobIds(): string[] {
    return Array.from(this.participants.values()).filter((p) => p.type === 'mob' && !p.alive).map((p) => p.id);
  }

  getAlivePlayers(): string[] {
    return Array.from(this.participants.values()).filter((p) => p.type === 'player' && p.alive).map((p) => p.id);
  }

  getPlayerHp(playerId: string): number {
    return this.participants.get(playerId)?.hp ?? 0;
  }

  isPlayerTurn(participantId: string): boolean {
    const p = this.participants.get(participantId);
    return this.getCurrentTurnId() === participantId && p?.type === 'player' && p.alive;
  }

  isMobTurn(participantId: string): boolean {
    const p = this.participants.get(participantId);
    return this.getCurrentTurnId() === participantId && p?.type === 'mob' && p.alive;
  }
}
