import closeUpConfig from '../data/closeUpConfig.json' with { type: 'json' };
import { CLASS_DEFINITIONS } from '../classData.js';
import type { AbilityDefinition } from '../classTypes.js';
import type { CombatActionResultMessage } from '../messages.js';
import type { CombatParticipant } from '../types.js';

export const CLOSE_UP_CONFIG: { abilityMs: number; critMs: number; killMs: number; strikeMs: number; impactAt: number; maxQueued: number } = closeUpConfig;

export type CloseUpKind = 'ability' | 'crit' | 'kill' | 'strike';
export interface CloseUp { kind: CloseUpKind; durationMs: number }
export type CloseUpSound = 'crack' | 'boom' | 'shimmer';
export const CLOSE_UP_SOUNDS: readonly CloseUpSound[] = ['crack', 'boom', 'shimmer'];

type Side = 'player' | 'mob';
interface Ctx { actorType: Side; targetType?: Side; isPassiveAbility: boolean }

const DURATION_KEY: Record<CloseUpKind, 'abilityMs' | 'critMs' | 'killMs' | 'strikeMs'> = {
  ability: 'abilityMs', crit: 'critMs', kill: 'killMs', strike: 'strikeMs',
};
const make = (kind: CloseUpKind): CloseUp => ({ kind, durationMs: CLOSE_UP_CONFIG[DURATION_KEY[kind]] });

/** Whether a combat result earns a close-up, and which kind. Data-driven: never names an ability. Ordinary hits are strikes. */
export function closeUpFor(r: Partial<CombatActionResultMessage>, ctx: Ctx): CloseUp | null {
  if (r.defendQte) return null; // preview of an incoming hit, not the hit itself
  if (ctx.actorType === 'player') {
    if (r.action === 'use_ability') return ctx.isPassiveAbility ? null : make('ability');
    if (r.action === 'attack') {
      if (r.targetDowned) return make('kill');
      if ((r.critMultiplier ?? 1) > 1) return make('crit');
      return make('strike');
    }
    return null;
  }
  // Mob actor: only hits that land on a player. A mob hit resolved through the defend QTE arrives as 'defend'.
  if (ctx.targetType !== 'player') return null;
  if (r.action !== 'attack' && r.action !== 'defend') return null;
  if (r.targetDowned) return make('kill');
  if ((r.critMultiplier ?? 1) > 1) return make('crit');
  return make('strike');
}

export function findAbility(abilityId: string | undefined, className?: string): AbilityDefinition | undefined {
  if (!abilityId) return undefined;
  const classes = className ? CLASS_DEFINITIONS.filter((c) => c.id === className) : CLASS_DEFINITIONS;
  for (const c of classes) {
    const a = c.abilities.find((x) => x.id === abilityId);
    if (a) return a;
  }
  return className ? findAbility(abilityId) : undefined;
}

/** closeUpFor with sides and passivity resolved from the combat's participants. */
export function closeUpForParticipants(
  r: Partial<CombatActionResultMessage>,
  participants: Pick<CombatParticipant, 'id' | 'type' | 'className'>[],
): CloseUp | null {
  const actor = participants.find((p) => p.id === r.actorId);
  if (!actor) return null;
  const target = r.targetId ? participants.find((p) => p.id === r.targetId) : undefined;
  const targetType: Side | undefined = target ? target.type : r.targetId ? (actor.type === 'player' ? 'mob' : 'player') : undefined;
  const ability = findAbility(r.abilityId, actor.className);
  return closeUpFor(r, { actorType: actor.type, targetType, isPassiveAbility: ability?.passive ?? false });
}
