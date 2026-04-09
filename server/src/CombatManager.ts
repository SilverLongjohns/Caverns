import type {
  MobInstance,
  CombatState,
  CombatParticipant,
  CombatActionResultMessage,
  Direction,
  ActiveBuff,
  EquippedEffect,
} from '@caverns/shared';
import { ItemEffectResolver } from './ItemEffectResolver.js';

export interface CombatPlayerInfo {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  damage: number;
  defense: number;
  initiative: number;
  className?: string;
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
  className?: string;
  buffs: ActiveBuff[];
}

export class CombatManager {
  private roomId: string;
  private participants: Map<string, InternalParticipant> = new Map();
  private turnOrder: string[] = [];
  private turnIndex = 0;
  private roundNumber = 1;
  private effectResolver: ItemEffectResolver;

  constructor(
    roomId: string,
    players: CombatPlayerInfo[],
    mobs: MobInstance[],
    playerEffects?: Map<string, EquippedEffect[]>,
    usedDungeonEffects?: Map<string, string[]>,
  ) {
    this.roomId = roomId;
    this.effectResolver = new ItemEffectResolver(
      playerEffects ?? new Map(),
      usedDungeonEffects ?? new Map(),
    );
    for (const p of players) {
      this.participants.set(p.id, {
        id: p.id, type: 'player', name: p.name,
        hp: p.hp, maxHp: p.maxHp, damage: p.damage,
        defense: p.defense, initiative: p.initiative,
        isDefending: false, alive: true, className: p.className, buffs: [],
      });
    }
    for (const m of mobs) {
      this.participants.set(m.instanceId, {
        id: m.instanceId, type: 'mob', name: m.name,
        hp: m.hp, maxHp: m.maxHp, damage: m.damage,
        defense: m.defense, initiative: m.initiative,
        isDefending: false, alive: true, buffs: [],
      });
    }
    this.rollInitiativeOrder();
  }

  private rollInitiativeOrder(): void {
    // Tick buffs for all alive participants at round start
    for (const p of this.participants.values()) {
      if (p.alive) {
        p.buffs = p.buffs
          .map(b => ({ ...b, turnsRemaining: b.turnsRemaining - 1 }))
          .filter(b => b.turnsRemaining > 0);
      }
    }

    const alive = Array.from(this.participants.values()).filter((p) => p.alive);
    alive.sort((a, b) => b.initiative + Math.random() * 5 - (a.initiative + Math.random() * 5));
    this.turnOrder = alive.map((p) => p.id);
    this.turnIndex = 0;
  }

  getEffectResolver(): ItemEffectResolver { return this.effectResolver; }
  getConsumedEffects(): Map<string, string[]> { return this.effectResolver.getConsumedEffects(); }

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
      this.rollInitiativeOrder();
    }
  }

  addPlayer(player: CombatPlayerInfo, effects?: EquippedEffect[], usedEffects?: string[]): void {
    this.participants.set(player.id, {
      id: player.id, type: 'player', name: player.name,
      hp: player.hp, maxHp: player.maxHp, damage: player.damage,
      defense: player.defense, initiative: player.initiative,
      isDefending: false, alive: true, className: player.className, buffs: [],
    });
    if (effects) {
      this.effectResolver.registerPlayer(player.id, effects, usedEffects ?? []);
    }
  }

  resolvePlayerAction(playerId: string, action: {
    action: 'attack' | 'defend' | 'use_item' | 'flee' | 'use_ability';
    targetId?: string; itemDamage?: number; itemHealing?: number; fleeDirection?: Direction;
    critMultiplier?: number; abilityId?: string;
  }): Partial<CombatActionResultMessage> | null {
    const actor = this.participants.get(playerId);
    if (!actor || !actor.alive) return null;
    actor.isDefending = false;

    switch (action.action) {
      case 'attack': {
        const target = this.participants.get(action.targetId!);
        if (!target || !target.alive) return null;

        // Item effects: passive stat mods
        const passiveMods = this.effectResolver.resolvePassiveStats(actor);
        const targetPassiveMods = this.effectResolver.resolvePassiveStats(target);

        // Effective stats with passive mods
        let actorDamage = actor.damage + passiveMods.bonusDamage;
        let targetDefense = target.defense + targetPassiveMods.bonusDefense;
        if (targetPassiveMods.overrideDefense !== undefined) {
          targetDefense = 0;
        }

        // Party buff
        const partyBuffs = this.effectResolver.resolvePartyBuffs(
          Array.from(this.participants.values()),
        );
        actorDamage += partyBuffs.get(actor.id) ?? 0;

        // Item effects: on-attack
        const isFirst = this.turnOrder[0] === actor.id;
        const attackEffects = this.effectResolver.resolveOnAttack(
          { ...actor, damage: actorDamage, defense: targetDefense },
          { ...target, defense: targetDefense },
          actorDamage,
          action.critMultiplier ?? 1.0,
          Array.from(this.participants.values()),
          isFirst,
        );
        actorDamage += attackEffects.bonusDamage;

        // Crit modification (brutal_impact)
        const finalMultiplier = attackEffects.modifiedCritMultiplier ?? (action.critMultiplier ?? 1.0);

        // Overcharge
        const overchargeMultiplier = attackEffects.overchargeMultiplier ?? 1.0;

        const effectiveDefense = target.isDefending ? targetDefense * 2 : targetDefense;
        const damage = Math.max(1, Math.floor((actorDamage - effectiveDefense) * finalMultiplier * overchargeMultiplier));
        target.hp = Math.max(0, target.hp - damage);

        // Track for momentum and rampage
        this.effectResolver.trackAction(actor.id, 'attack');
        this.effectResolver.trackDamageDealt(actor.id, damage);

        // Siphon armor
        if (this.effectResolver.hasEffect(actor.id, 'siphon_armor')) {
          this.effectResolver.incrementSiphonStacks(actor.id);
        }

        // Post-damage effects
        let itemEffectHealing: number | undefined;
        const vampEffect = attackEffects.postDamageEffects.find(e => e.type === 'vampiric');
        if (vampEffect) {
          const healed = Math.min(vampEffect.value, actor.maxHp - actor.hp);
          actor.hp += healed;
          if (healed > 0) itemEffectHealing = healed;
        }

        let itemEffectDamage: number | undefined;
        // Cleave splash
        for (const effect of attackEffects.postDamageEffects.filter(e => e.type === 'cleave')) {
          const splashTarget = this.participants.get(effect.targetId!);
          if (splashTarget && splashTarget.alive) {
            splashTarget.hp = Math.max(0, splashTarget.hp - effect.value);
            if (splashTarget.hp === 0) splashTarget.alive = false;
            itemEffectDamage = (itemEffectDamage ?? 0) + effect.value;
          }
        }

        // Flurry bonus hits
        if (attackEffects.flurryHits && attackEffects.flurryDamagePerHit) {
          for (let i = 0; i < attackEffects.flurryHits; i++) {
            if (target.alive) {
              target.hp = Math.max(0, target.hp - attackEffects.flurryDamagePerHit);
              if (target.hp === 0) target.alive = false;
              itemEffectDamage = (itemEffectDamage ?? 0) + attackEffects.flurryDamagePerHit;
            }
          }
        }

        // Apply state-tracked effects (venomous, overwhelm)
        this.effectResolver.applyPostDamageEffects(attackEffects.postDamageEffects);

        // Death prevention
        let targetDowned = target.hp === 0;
        let itemEffect: string | undefined;
        if (targetDowned && target.type === 'player') {
          const deathResult = this.effectResolver.resolveOnDeath(target);
          if (deathResult.prevented) {
            targetDowned = false;
            target.alive = true;
            target.hp = deathResult.reviveHp ?? 1;
            itemEffect = deathResult.effectId;
          }
        }
        if (targetDowned) target.alive = false;

        // Track kills
        if (targetDowned) this.effectResolver.trackKill(actor.id);

        return {
          actorId: playerId, actorName: actor.name, action: 'attack',
          targetId: target.id, targetName: target.name, damage,
          targetHp: target.hp, targetMaxHp: target.maxHp, targetDowned,
          critMultiplier: finalMultiplier,
          itemEffect, itemEffectDamage, itemEffectHealing,
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
      case 'use_ability': {
        return {
          actorId: playerId, actorName: actor.name, action: 'use_ability',
          abilityId: action.abilityId,
        };
      }
    }
  }

  resolveMobTurn(mobId: string): Partial<CombatActionResultMessage> | null {
    const mob = this.participants.get(mobId);
    if (!mob || !mob.alive || mob.type !== 'mob') return null;

    // Check if mob should skip turn (smoke bomb)
    if (mob.buffs.some(b => b.type === 'skip_turn')) {
      mob.buffs = mob.buffs.filter(b => b.type !== 'skip_turn');
      return { actorId: mobId, actorName: mob.name, action: 'defend' };
    }

    const alivePlayers = Array.from(this.participants.values()).filter((p) => p.type === 'player' && p.alive);
    if (alivePlayers.length === 0) return null;

    // Check for taunting player
    const taunter = alivePlayers.find(p => p.buffs.some(b => b.type === 'taunt'));
    let target: InternalParticipant;
    if (taunter) {
      target = taunter;
    } else {
      target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
    }

    // Apply defense buffs
    const bonusDefense = target.buffs
      .filter(b => b.type === 'defense_flat')
      .reduce((sum, b) => sum + (b.value ?? 0), 0);
    const defenseMultiplier = target.buffs
      .filter(b => b.type === 'defense_multiply')
      .reduce((mult, b) => mult * (b.value ?? 1), 1);
    const effectiveDefense = target.isDefending
      ? Math.floor((target.defense + bonusDefense) * defenseMultiplier * 2)
      : Math.floor((target.defense + bonusDefense) * defenseMultiplier);

    const rawDamage = Math.max(1, mob.damage - effectiveDefense);

    if (target.isDefending) {
      return {
        actorId: mobId, actorName: mob.name, action: 'attack',
        targetId: target.id, targetName: target.name,
        pendingDamage: rawDamage, defendQte: true,
        targetHp: target.hp, targetMaxHp: target.maxHp,
      };
    }

    // Item effects: damage taken
    const damageTakenResult = this.effectResolver.resolveOnDamageTaken(
      target, mob, rawDamage, false,
      Array.from(this.participants.values()),
    );

    // Guardian intercept
    let actualDamage = rawDamage;
    if (damageTakenResult.interceptedDamage > 0 && damageTakenResult.guardianId) {
      const guardian = this.participants.get(damageTakenResult.guardianId);
      if (guardian && guardian.alive) {
        guardian.hp = Math.max(0, guardian.hp - damageTakenResult.interceptedDamage);
        if (guardian.hp === 0) guardian.alive = false;
        actualDamage -= damageTakenResult.interceptedDamage;
      }
    }

    // Apply damage
    const hasPreventDown = target.buffs.some(b => b.type === 'prevent_down');
    target.hp = Math.max(hasPreventDown ? 1 : 0, target.hp - actualDamage);
    if (hasPreventDown && target.hp === 1) {
      target.buffs = target.buffs.filter(b => b.type !== 'prevent_down');
    }

    // Thorns + reflect damage
    let itemEffectDamage: number | undefined;
    if (damageTakenResult.reflectDamage > 0) {
      mob.hp = Math.max(0, mob.hp - damageTakenResult.reflectDamage);
      if (mob.hp === 0) mob.alive = false;
      itemEffectDamage = damageTakenResult.reflectDamage;
    }

    // Deathward buff
    if (damageTakenResult.deathwardTriggered && damageTakenResult.deathwardDefense) {
      target.buffs.push({
        type: 'defense_flat',
        turnsRemaining: damageTakenResult.deathwardDuration ?? 2,
        sourcePlayerId: target.id,
        value: damageTakenResult.deathwardDefense,
      });
    }

    // Death prevention
    let targetDowned = target.hp === 0;
    let itemEffect: string | undefined;
    if (targetDowned) {
      const deathResult = this.effectResolver.resolveOnDeath(target);
      if (deathResult.prevented) {
        targetDowned = false;
        target.alive = true;
        target.hp = deathResult.reviveHp ?? 1;
        itemEffect = deathResult.effectId;
      }
    }
    if (targetDowned) target.alive = false;

    return {
      actorId: mobId, actorName: mob.name, action: 'attack',
      targetId: target.id, targetName: target.name, damage: actualDamage,
      targetHp: target.hp, targetMaxHp: target.maxHp, targetDowned,
      itemEffect, itemEffectDamage,
    };
  }

  applyDamage(targetId: string, damage: number): { targetDowned: boolean; newHp: number } | null {
    const target = this.participants.get(targetId);
    if (!target || !target.alive) return null;
    const hasPreventDown = target.buffs.some(b => b.type === 'prevent_down');
    target.hp = Math.max(hasPreventDown ? 1 : 0, target.hp - damage);
    const targetDowned = target.hp === 0;
    if (targetDowned) target.alive = false;
    if (hasPreventDown && target.hp === 1) {
      target.buffs = target.buffs.filter(b => b.type !== 'prevent_down');
    }
    return { targetDowned, newHp: target.hp };
  }

  applyHealing(targetId: string, healing: number): number {
    const target = this.participants.get(targetId);
    if (!target || !target.alive) return 0;
    const healed = Math.min(healing, target.maxHp - target.hp);
    target.hp += healed;
    return healed;
  }

  getParticipant(id: string) {
    return this.participants.get(id) ?? null;
  }

  getParticipantsArray(): Array<{
    id: string; type: 'player' | 'mob'; name: string;
    hp: number; maxHp: number; damage: number; defense: number;
    initiative: number; alive: boolean; buffs: ActiveBuff[];
  }> {
    return Array.from(this.participants.values());
  }

  applyDefendDamage(targetId: string, rawDamage: number, damageReduction: number): Partial<CombatActionResultMessage> | null {
    const target = this.participants.get(targetId);
    if (!target || !target.alive) return null;
    const finalDamage = Math.max(1, Math.floor(rawDamage * (1 - damageReduction)));
    target.hp = Math.max(0, target.hp - finalDamage);
    const targetDowned = target.hp === 0;
    if (targetDowned) target.alive = false;
    return {
      targetId: target.id, targetName: target.name, damage: finalDamage,
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
      .map((p) => ({
        id: p.id, type: p.type, name: p.name, hp: p.hp, maxHp: p.maxHp, initiative: p.initiative,
        className: p.className,
        buffs: p.buffs.length > 0 ? [...p.buffs] : undefined,
      }));
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
