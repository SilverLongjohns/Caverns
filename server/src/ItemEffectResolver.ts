import type { EquippedEffect } from '@caverns/shared';

export interface EffectParticipant {
  id: string;
  type: 'player' | 'mob';
  name: string;
  hp: number;
  maxHp: number;
  damage: number;
  defense: number;
  initiative: number;
  alive: boolean;
}

export interface AttackEffectResult {
  bonusDamage: number;
  postDamageEffects: PostDamageEffect[];
  modifiedCritMultiplier?: number;
  flurryHits?: number;
  flurryDamagePerHit?: number;
  overchargeMultiplier?: number;
}

export interface PostDamageEffect {
  type: 'vampiric' | 'cleave' | 'venomous' | 'overwhelm';
  value: number;
  targetId?: string;
  duration?: number;
}

export interface DamageTakenResult {
  reflectDamage: number;
  interceptedDamage: number;
  guardianId?: string;
  deathwardTriggered: boolean;
  deathwardDefense?: number;
  deathwardDuration?: number;
}

export interface DeathPreventionResult {
  prevented: boolean;
  effectId?: string;
  reviveHp?: number;
  extraTurns?: number;
}

export interface ActivatedEffectResult {
  success: boolean;
  effectId: string;
  healing?: number;
  targetIds?: string[];
  selfDamage?: number;
  reviveHp?: number;
}

export interface PassiveStatModifiers {
  bonusDamage: number;
  bonusDefense: number;
  bonusInitiative: number;
  overrideDefense?: number;
}

export interface TurnStartResult {
  poisonDamage: number;
  defenseReduction: number;
  undyingExpired: boolean;
}

export interface CombatEffectState {
  momentumStacks: Map<string, number>;
  lastAction: Map<string, string>;
  rampageTotalDamage: Map<string, number>;
  predatorKills: Map<string, number>;
  siphonStacks: Map<string, number>;
  deathwardTriggered: Set<string>;
  overcharged: Set<string>;
  undyingTurns: Map<string, number>;
  poisoned: Map<string, { damage: number; turnsRemaining: number; sourceId: string }[]>;
  overwhelmDebuffs: Map<string, { reduction: number; turnsRemaining: number }[]>;
}

export class ItemEffectResolver {
  private state: CombatEffectState;
  private playerEffects: Map<string, EquippedEffect[]>;
  private usedDungeonEffects: Map<string, string[]>;

  constructor(
    playerEffectsMap: Map<string, EquippedEffect[]>,
    usedDungeonEffects: Map<string, string[]>,
  ) {
    this.playerEffects = playerEffectsMap;
    this.usedDungeonEffects = usedDungeonEffects;
    this.state = {
      momentumStacks: new Map(),
      lastAction: new Map(),
      rampageTotalDamage: new Map(),
      predatorKills: new Map(),
      siphonStacks: new Map(),
      deathwardTriggered: new Set(),
      overcharged: new Set(),
      undyingTurns: new Map(),
      poisoned: new Map(),
      overwhelmDebuffs: new Map(),
    };
  }

  registerPlayer(playerId: string, effects: EquippedEffect[], usedEffects: string[]): void {
    this.playerEffects.set(playerId, effects);
    if (usedEffects.length > 0) {
      this.usedDungeonEffects.set(playerId, [...usedEffects]);
    }
  }

  getEffects(participantId: string): EquippedEffect[] {
    return this.playerEffects.get(participantId) ?? [];
  }

  hasEffect(participantId: string, effectId: string): boolean {
    return this.getEffects(participantId).some(e => e.effectId === effectId);
  }

  getEffectParams(participantId: string, effectId: string): Record<string, number> | undefined {
    return this.getEffects(participantId).find(e => e.effectId === effectId)?.params;
  }

  isEffectConsumed(playerId: string, effectId: string): boolean {
    return this.usedDungeonEffects.get(playerId)?.includes(effectId) ?? false;
  }

  consumeEffect(playerId: string, effectId: string): void {
    const existing = this.usedDungeonEffects.get(playerId);
    if (existing) {
      if (!existing.includes(effectId)) {
        existing.push(effectId);
      }
    } else {
      this.usedDungeonEffects.set(playerId, [effectId]);
    }
  }

  trackAction(playerId: string, action: string): void {
    const last = this.state.lastAction.get(playerId);
    if (action === 'attack') {
      if (last === 'attack') {
        const current = this.state.momentumStacks.get(playerId) ?? 0;
        this.state.momentumStacks.set(playerId, current + 1);
      } else {
        // First attack in a streak — no stack yet, but record action
        this.state.momentumStacks.set(playerId, this.state.momentumStacks.get(playerId) ?? 0);
      }
    } else {
      // Non-attack action resets momentum
      this.state.momentumStacks.set(playerId, 0);
    }
    this.state.lastAction.set(playerId, action);
  }

  trackDamageDealt(playerId: string, damage: number): void {
    const current = this.state.rampageTotalDamage.get(playerId) ?? 0;
    this.state.rampageTotalDamage.set(playerId, current + damage);
  }

  trackKill(playerId: string): void {
    const current = this.state.predatorKills.get(playerId) ?? 0;
    this.state.predatorKills.set(playerId, current + 1);
  }

  getState(): CombatEffectState {
    return this.state;
  }

  getConsumedEffects(): Map<string, string[]> {
    return this.usedDungeonEffects;
  }

  incrementSiphonStacks(playerId: string): void {
    const current = this.state.siphonStacks.get(playerId) ?? 0;
    this.state.siphonStacks.set(playerId, current + 1);
  }

  resolveOnAttack(
    attacker: EffectParticipant,
    target: EffectParticipant,
    baseDamage: number,
    critMultiplier: number,
    allParticipants: EffectParticipant[],
    isFirstInTurnOrder: boolean = false,
  ): AttackEffectResult {
    const result: AttackEffectResult = {
      bonusDamage: 0,
      postDamageEffects: [],
    };

    const effects = this.getEffects(attacker.id);

    for (const effect of effects) {
      const p = effect.params;

      switch (effect.effectId) {
        case 'executioner': {
          const ratio = target.hp / target.maxHp;
          if (ratio < (p.hpThresholdPercent / 100)) {
            result.bonusDamage += p.bonusDamage;
          }
          break;
        }

        case 'momentum': {
          const stacks = this.state.momentumStacks.get(attacker.id) ?? 0;
          const cappedStacks = Math.min(stacks, p.maxStacks);
          result.bonusDamage += cappedStacks * p.damagePerStack;
          break;
        }

        case 'first_strike': {
          if (isFirstInTurnOrder) {
            result.bonusDamage += p.bonusDamage;
          }
          break;
        }

        case 'blade_storm': {
          if (attacker.initiative > target.initiative) {
            const diff = attacker.initiative - target.initiative;
            result.bonusDamage += Math.floor(diff * p.damagePerInitiativeDiff);
          }
          break;
        }

        case 'rampage': {
          const totalDamage = this.state.rampageTotalDamage.get(attacker.id) ?? 0;
          const bonus = Math.floor(totalDamage * p.damagePerPointDealt);
          result.bonusDamage += Math.min(bonus, p.maxBonus);
          break;
        }

        case 'brutal_impact': {
          if (critMultiplier > 1.0) {
            result.modifiedCritMultiplier = critMultiplier + (attacker.damage * p.critBonusPerDamage);
          }
          break;
        }

        case 'flurry': {
          const hits = Math.floor(attacker.initiative / p.hitsPerInitiativeThreshold);
          if (hits > 0) {
            result.flurryHits = hits;
            result.flurryDamagePerHit = Math.floor(baseDamage * p.bonusHitPercent);
          }
          break;
        }

        case 'vampiric': {
          result.postDamageEffects.push({
            type: 'vampiric',
            value: Math.floor(baseDamage * p.leechPercent),
          });
          break;
        }

        case 'cleave': {
          const otherEnemies = allParticipants.filter(
            e => e.id !== target.id && e.id !== attacker.id && e.alive && e.type !== attacker.type,
          );
          for (const enemy of otherEnemies) {
            result.postDamageEffects.push({
              type: 'cleave',
              value: Math.floor(baseDamage * p.splashPercent),
              targetId: enemy.id,
            });
          }
          break;
        }

        case 'venomous': {
          result.postDamageEffects.push({
            type: 'venomous',
            value: p.poisonDamage,
            targetId: target.id,
            duration: p.duration,
          });
          break;
        }

        case 'overwhelm': {
          result.postDamageEffects.push({
            type: 'overwhelm',
            value: Math.floor(attacker.damage * p.defenseReductionPercent),
            targetId: target.id,
            duration: p.duration,
          });
          break;
        }

        case 'overcharge': {
          if (this.state.overcharged.has(attacker.id)) {
            result.overchargeMultiplier = p.overchargeMultiplier;
            this.state.overcharged.delete(attacker.id);
          }
          break;
        }
      }
    }

    return result;
  }

  resolveOnDamageTaken(
    target: EffectParticipant,
    attacker: EffectParticipant,
    incomingDamage: number,
    isDefending: boolean,
    allParticipants: EffectParticipant[],
  ): DamageTakenResult {
    const result: DamageTakenResult = {
      reflectDamage: 0,
      interceptedDamage: 0,
      deathwardTriggered: false,
    };

    const effects = this.getEffects(target.id);

    for (const effect of effects) {
      const p = effect.params;

      switch (effect.effectId) {
        case 'thorns': {
          result.reflectDamage += p.flatDamage;
          break;
        }

        case 'reflect': {
          if (isDefending) {
            result.reflectDamage += Math.floor(incomingDamage * p.reflectPercent);
          }
          break;
        }

        case 'deathward': {
          const hpAfterDamage = target.hp - incomingDamage;
          const threshold = target.maxHp * p.hpThresholdPercent;
          if (
            hpAfterDamage < threshold &&
            hpAfterDamage > 0 &&
            !this.state.deathwardTriggered.has(target.id)
          ) {
            this.state.deathwardTriggered.add(target.id);
            result.deathwardTriggered = true;
            result.deathwardDefense = p.deathwardDefense;
            result.deathwardDuration = p.deathwardDuration;
          }
          break;
        }

        case 'guardian': {
          // Guardian is checked on allies, not self — handled below
          break;
        }
      }
    }

    // Check OTHER allies for guardian effect
    const allies = allParticipants.filter(
      p => p.id !== target.id && p.type === target.type && p.alive,
    );
    for (const ally of allies) {
      const allyEffects = this.getEffects(ally.id);
      const guardianEffect = allyEffects.find(e => e.effectId === 'guardian');
      if (guardianEffect) {
        result.interceptedDamage = Math.floor(incomingDamage * guardianEffect.params.interceptPercent);
        result.guardianId = ally.id;
        break; // Only one guardian intercepts
      }
    }

    return result;
  }

  resolvePassiveStats(participant: EffectParticipant): PassiveStatModifiers {
    const result: PassiveStatModifiers = {
      bonusDamage: 0,
      bonusDefense: 0,
      bonusInitiative: 0,
    };

    const effects = this.getEffects(participant.id);

    for (const effect of effects) {
      const p = effect.params;

      switch (effect.effectId) {
        case 'fortify': {
          result.bonusDefense += Math.floor(participant.maxHp * p.defensePerHpPercent);
          break;
        }

        case 'glass_cannon': {
          result.bonusDamage += Math.floor(participant.defense * p.damagePerDefense);
          result.overrideDefense = 0;
          break;
        }

        case 'berserk': {
          const missingHpRatio = 1 - (participant.hp / participant.maxHp);
          result.bonusDamage += Math.floor(p.maxBonusDamage * missingHpRatio);
          break;
        }

        case 'predator': {
          const kills = this.state.predatorKills.get(participant.id) ?? 0;
          result.bonusInitiative += kills * p.initiativePerKill;
          break;
        }

        case 'siphon_armor': {
          const stacks = this.state.siphonStacks.get(participant.id) ?? 0;
          result.bonusDefense += stacks * p.defensePerHit;
          break;
        }
      }
    }

    return result;
  }

  resolveOnDeath(participant: EffectParticipant): DeathPreventionResult {
    // self_revive takes priority
    if (this.hasEffect(participant.id, 'self_revive') && !this.isEffectConsumed(participant.id, 'self_revive')) {
      const p = this.getEffectParams(participant.id, 'self_revive')!;
      this.consumeEffect(participant.id, 'self_revive');
      const reviveHp = Math.max(1, Math.floor(participant.maxHp * p.revivePercent));
      return { prevented: true, effectId: 'self_revive', reviveHp };
    }

    // undying_fury second priority
    if (this.hasEffect(participant.id, 'undying_fury') && !this.isEffectConsumed(participant.id, 'undying_fury')) {
      const p = this.getEffectParams(participant.id, 'undying_fury')!;
      this.consumeEffect(participant.id, 'undying_fury');
      this.state.undyingTurns.set(participant.id, p.extraTurns);
      return { prevented: true, effectId: 'undying_fury', extraTurns: p.extraTurns };
    }

    return { prevented: false };
  }

  resolveOnTurnStart(participantId: string): TurnStartResult {
    const result: TurnStartResult = {
      poisonDamage: 0,
      defenseReduction: 0,
      undyingExpired: false,
    };

    // Poison tick
    const poisons = this.state.poisoned.get(participantId);
    if (poisons) {
      for (const poison of poisons) {
        result.poisonDamage += poison.damage;
        poison.turnsRemaining -= 1;
      }
      const remaining = poisons.filter(p => p.turnsRemaining > 0);
      if (remaining.length === 0) {
        this.state.poisoned.delete(participantId);
      } else {
        this.state.poisoned.set(participantId, remaining);
      }
    }

    // Overwhelm debuffs
    const debuffs = this.state.overwhelmDebuffs.get(participantId);
    if (debuffs) {
      for (const debuff of debuffs) {
        result.defenseReduction += debuff.reduction;
        debuff.turnsRemaining -= 1;
      }
      const remaining = debuffs.filter(d => d.turnsRemaining > 0);
      if (remaining.length === 0) {
        this.state.overwhelmDebuffs.delete(participantId);
      } else {
        this.state.overwhelmDebuffs.set(participantId, remaining);
      }
    }

    // Undying fury countdown
    if (this.state.undyingTurns.has(participantId)) {
      const turns = this.state.undyingTurns.get(participantId)! - 1;
      if (turns <= 0) {
        result.undyingExpired = true;
        this.state.undyingTurns.delete(participantId);
      } else {
        this.state.undyingTurns.set(participantId, turns);
      }
    }

    return result;
  }

  applyPostDamageEffects(effects: PostDamageEffect[]): void {
    for (const effect of effects) {
      switch (effect.type) {
        case 'venomous': {
          if (effect.targetId !== undefined) {
            const existing = this.state.poisoned.get(effect.targetId) ?? [];
            existing.push({
              damage: effect.value,
              turnsRemaining: effect.duration ?? 1,
              sourceId: 'poison',
            });
            this.state.poisoned.set(effect.targetId, existing);
          }
          break;
        }

        case 'overwhelm': {
          if (effect.targetId !== undefined) {
            const existing = this.state.overwhelmDebuffs.get(effect.targetId) ?? [];
            existing.push({
              reduction: effect.value,
              turnsRemaining: effect.duration ?? 1,
            });
            this.state.overwhelmDebuffs.set(effect.targetId, existing);
          }
          break;
        }
      }
    }
  }

  resolveActivatedEffect(
    playerId: string,
    effectId: string,
    caster: EffectParticipant,
    target: EffectParticipant | undefined,
    allParticipants: EffectParticipant[],
  ): ActivatedEffectResult {
    const params = this.getEffectParams(playerId, effectId);
    if (params === undefined) {
      return { success: false, effectId };
    }

    switch (effectId) {
      case 'overcharge': {
        const selfDamage = Math.floor(caster.maxHp * params.selfDamagePercent);
        this.state.overcharged.add(playerId);
        return { success: true, effectId, selfDamage };
      }

      case 'revive_once': {
        if (this.isEffectConsumed(playerId, effectId)) {
          return { success: false, effectId };
        }
        if (!target || target.alive) {
          return { success: false, effectId };
        }
        const reviveHp = Math.max(1, Math.floor(target.maxHp * params.revivePercent));
        this.consumeEffect(playerId, effectId);
        return { success: true, effectId, reviveHp, targetIds: [target.id] };
      }

      case 'rally': {
        const healing = Math.floor(caster.maxHp * params.healPercent);
        const allies = allParticipants.filter(p => p.type === caster.type && p.alive);
        return { success: true, effectId, healing, targetIds: allies.map(p => p.id) };
      }

      default:
        return { success: false, effectId };
    }
  }

  resolvePartyBuffs(allParticipants: EffectParticipant[]): Map<string, number> {
    const result = new Map<string, number>();

    for (const participant of allParticipants) {
      const effects = this.getEffects(participant.id);
      const partyBuff = effects.find(e => e.effectId === 'party_buff');
      if (partyBuff) {
        const allies = allParticipants.filter(p => p.type === participant.type);
        for (const ally of allies) {
          const current = result.get(ally.id) ?? 0;
          result.set(ally.id, current + partyBuff.params.bonusDamage);
        }
      }
    }

    return result;
  }
}
