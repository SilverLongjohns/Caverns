import type { AbilityEffect, ActiveBuff } from '@caverns/shared';

export interface ResolverParticipant {
  id: string;
  type: 'player' | 'mob';
  name: string;
  hp: number;
  maxHp: number;
  damage: number;
  defense: number;
  alive: boolean;
  buffs: ActiveBuff[];
}

export interface EffectResult {
  damage?: number;
  healing?: number;
  buffsApplied?: string[];
  targetDowned?: boolean;
}

type EffectHandler = (
  effect: AbilityEffect,
  caster: ResolverParticipant,
  target: ResolverParticipant | null,
  allParticipants: ResolverParticipant[],
) => EffectResult;

export class AbilityResolver {
  private handlers = new Map<string, EffectHandler>();

  constructor() {
    this.handlers.set('deal_damage', this.handleDealDamage.bind(this));
    this.handlers.set('heal', this.handleHeal.bind(this));
    this.handlers.set('apply_buff', this.handleApplyBuff.bind(this));
    this.handlers.set('taunt', this.handleTaunt.bind(this));
    this.handlers.set('skip_turn', this.handleSkipTurn.bind(this));
    this.handlers.set('prevent_down', this.handlePreventDown.bind(this));
  }

  resolveEffect(
    effect: AbilityEffect,
    caster: ResolverParticipant,
    target: ResolverParticipant | null,
    allParticipants: ResolverParticipant[],
  ): EffectResult {
    const handler = this.handlers.get(effect.type);
    if (!handler) return {};
    return handler(effect, caster, target, allParticipants);
  }

  resolveAllEffects(
    effects: AbilityEffect[],
    caster: ResolverParticipant,
    target: ResolverParticipant | null,
    allParticipants: ResolverParticipant[],
  ): EffectResult {
    const combined: EffectResult = {};
    for (const effect of effects) {
      const result = this.resolveEffect(effect, caster, target, allParticipants);
      if (result.damage) combined.damage = (combined.damage ?? 0) + result.damage;
      if (result.healing) combined.healing = (combined.healing ?? 0) + result.healing;
      if (result.buffsApplied) {
        combined.buffsApplied = [...(combined.buffsApplied ?? []), ...result.buffsApplied];
      }
      if (result.targetDowned) combined.targetDowned = true;
    }
    return combined;
  }

  tickBuffs(participant: ResolverParticipant): void {
    participant.buffs = participant.buffs
      .map(b => ({ ...b, turnsRemaining: b.turnsRemaining - 1 }))
      .filter(b => b.turnsRemaining > 0);
  }

  getBuffValue(participant: ResolverParticipant, buffType: string): number {
    return participant.buffs
      .filter(b => b.type === buffType)
      .reduce((sum, b) => sum + (b.value ?? 0), 0);
  }

  hasBuff(participant: ResolverParticipant, buffType: string): boolean {
    return participant.buffs.some(b => b.type === buffType);
  }

  private handleDealDamage(
    effect: AbilityEffect, caster: ResolverParticipant,
    target: ResolverParticipant | null,
  ): EffectResult {
    if (!target) return {};
    const multiplier = (effect.multiplier as number) ?? 1.0;
    const ignoreDefense = (effect.ignoreDefense as boolean) ?? false;
    const defense = ignoreDefense ? 0 : target.defense;
    const damage = Math.max(1, Math.floor((caster.damage - defense) * multiplier));
    target.hp = Math.max(0, target.hp - damage);
    const targetDowned = target.hp === 0;
    if (targetDowned) target.alive = false;
    return { damage, targetDowned };
  }

  private handleHeal(
    effect: AbilityEffect, _caster: ResolverParticipant,
    target: ResolverParticipant | null,
  ): EffectResult {
    if (!target) return {};
    const percent = (effect.percentMaxHp as number) ?? 0;
    const amount = Math.floor(target.maxHp * percent);
    const healed = Math.min(amount, target.maxHp - target.hp);
    target.hp += healed;
    return { healing: healed };
  }

  private handleApplyBuff(
    effect: AbilityEffect, caster: ResolverParticipant,
    _target: ResolverParticipant | null, allParticipants: ResolverParticipant[],
  ): EffectResult {
    const buffType = effect.buffType as string;
    const duration = (effect.duration as number) ?? 1;
    const value = effect.value as number | undefined;
    const targetScope = (effect.target as string) ?? 'self';
    const buff: ActiveBuff = { type: buffType, turnsRemaining: duration, sourcePlayerId: caster.id, value };

    const targets = this.resolveTargets(targetScope, caster, allParticipants);
    for (const t of targets) {
      // Replace existing buff of same type from same source (refresh)
      t.buffs = t.buffs.filter(b => !(b.type === buffType && b.sourcePlayerId === caster.id));
      t.buffs.push({ ...buff });
    }
    return { buffsApplied: [buffType] };
  }

  private handleTaunt(
    effect: AbilityEffect, caster: ResolverParticipant,
  ): EffectResult {
    const duration = (effect.duration as number) ?? 1;
    caster.buffs = caster.buffs.filter(b => b.type !== 'taunt');
    caster.buffs.push({ type: 'taunt', turnsRemaining: duration, sourcePlayerId: caster.id });
    return { buffsApplied: ['taunt'] };
  }

  private handleSkipTurn(
    effect: AbilityEffect, caster: ResolverParticipant,
    _target: ResolverParticipant | null, allParticipants: ResolverParticipant[],
  ): EffectResult {
    const duration = (effect.duration as number) ?? 1;
    const targetScope = (effect.targets as string) ?? 'all_enemies';
    const targets = this.resolveTargets(targetScope, caster, allParticipants);
    for (const t of targets) {
      t.buffs = t.buffs.filter(b => b.type !== 'skip_turn');
      t.buffs.push({ type: 'skip_turn', turnsRemaining: duration, sourcePlayerId: caster.id });
    }
    return { buffsApplied: ['skip_turn'] };
  }

  private handlePreventDown(
    effect: AbilityEffect, caster: ResolverParticipant,
    target: ResolverParticipant | null,
  ): EffectResult {
    if (!target) return {};
    const duration = (effect.duration as number) ?? 1;
    target.buffs = target.buffs.filter(b => b.type !== 'prevent_down');
    target.buffs.push({ type: 'prevent_down', turnsRemaining: duration, sourcePlayerId: caster.id });
    return { buffsApplied: ['prevent_down'] };
  }

  private resolveTargets(
    scope: string, caster: ResolverParticipant, allParticipants: ResolverParticipant[],
  ): ResolverParticipant[] {
    switch (scope) {
      case 'self': return [caster];
      case 'all_allies': return allParticipants.filter(p => p.type === caster.type && p.alive);
      case 'all_enemies': return allParticipants.filter(p => p.type !== caster.type && p.alive);
      default: return [caster];
    }
  }
}
