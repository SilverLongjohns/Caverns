import { findAbility, getClassDefinition, type CombatParticipant } from '@caverns/shared';
import type { ActiveCloseUp } from './closeUpGate.js';
import { getClassPortrait } from '../classPortraits.js';
import { getParticipantGlyph } from '../glyphs.js';

export interface StageActor { id: string; name: string; side: 'left' | 'right'; art: string[]; downed: boolean; isActor: boolean }
export interface Stage {
  layout: 'versus' | 'allies' | 'solo';
  left: StageActor[]; right: StageActor[]; extra: number;
  title: string; subtitle: string;
  number: { value: number; kind: 'damage' | 'heal' } | null;
  band: string; tone: 'player' | 'enemy'; sound: 'crack' | 'boom' | 'shimmer';
}

const MAX_TARGETS = 3;
const BAND = { crit: '#6b4a12', kill: '#5a0f0a', enemy: '#2a0808', fallback: '#4a3218' };

export function artChainFor(
  p: { type: 'player' | 'mob'; className?: string; templateId?: string },
  role: 'attack' | 'hurt' | 'cast',
  abilityArt?: string,
): string[] {
  const chain: string[] = [];
  if (p.type === 'mob') {
    if (p.templateId) chain.push(`/closeups/mobs/${p.templateId}.png`);
  } else {
    if (role === 'cast' && abilityArt) chain.push(abilityArt);
    if (p.className) chain.push(`/closeups/classes/${p.className}-${role === 'hurt' ? 'hurt' : 'attack'}.png`);
    const portrait = p.className ? getClassPortrait(p.className) : null;
    if (portrait) chain.push(portrait);
  }
  const glyph = getParticipantGlyph({ type: p.type, className: p.className, templateId: p.templateId });
  if (glyph) chain.push(glyph);
  return chain;
}

const shade = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(v * 0.35).toString(16).padStart(2, '0');
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`;
};

export function stageFor(active: ActiveCloseUp): Stage {
  const { result: r, participants, closeUp } = active;
  const byId = new Map(participants.map((p) => [p.id, p]));
  const actor = byId.get(r.actorId);
  const actorIsMob = actor?.type === 'mob';
  const ability = findAbility(r.abilityId, actor?.className);
  const targetType = ability?.targetType ?? 'enemy';

  const downed = new Set([...(r.downedIds ?? []), ...(r.targetDowned && r.targetId ? [r.targetId] : [])]);
  const toStage = (p: CombatParticipant | undefined, side: 'left' | 'right', isActor: boolean, role: 'attack' | 'hurt' | 'cast'): StageActor | null =>
    p ? { id: p.id, name: p.name, side, art: artChainFor(p, role, ability?.closeUp?.art), downed: downed.has(p.id), isActor } : null;

  const targetIds = r.targetIds ?? (r.targetId ? [r.targetId] : []);
  let layout: Stage['layout'] = 'versus';
  let left: StageActor[] = [];
  let right: StageActor[] = [];
  let extra = 0;

  if (actorIsMob) {
    // Enemy hit on a player: player (hurt) left, mob (attacking) right.
    left = [toStage(byId.get(r.targetId ?? ''), 'left', false, 'hurt')].filter(Boolean) as StageActor[];
    right = [toStage(actor, 'right', true, 'attack')].filter(Boolean) as StageActor[];
  } else {
    const casterRole = r.action === 'use_ability' ? 'cast' : 'attack';
    const caster = toStage(actor, 'left', true, casterRole);
    if (r.action === 'use_ability' && (targetType === 'ally' || targetType === 'area_ally')) {
      layout = 'allies';
      const allies = targetIds.filter((id) => id !== r.actorId).slice(0, 2).map((id) => toStage(byId.get(id), 'left', false, 'hurt'));
      left = [caster, ...allies].filter(Boolean) as StageActor[];
    } else if (r.action === 'use_ability' && targetType === 'none') {
      layout = 'solo';
      left = [caster].filter(Boolean) as StageActor[];
    } else {
      left = [caster].filter(Boolean) as StageActor[];
      const targets = targetIds.map((id) => toStage(byId.get(id), 'right', false, 'hurt')).filter(Boolean) as StageActor[];
      right = targets.slice(0, MAX_TARGETS);
      extra = Math.max(0, targets.length - MAX_TARGETS);
    }
  }

  const damage = r.damage ?? r.pendingDamage;
  const number = damage ? { value: damage, kind: 'damage' as const } : r.healing ? { value: r.healing, kind: 'heal' as const } : null;
  const anyDowned = downed.size > 0;
  const subtitle = anyDowned ? 'KILLED' : closeUp.kind === 'crit' ? 'CRITICAL' : (r.buffsApplied ?? []).map((b) => b.replace(/_/g, ' ')).join(' · ').toUpperCase();
  const derivedSound: Stage['sound'] = anyDowned ? 'boom' : (!damage && (r.healing || (r.buffsApplied ?? []).length)) ? 'shimmer' : 'crack';
  const sound = ability?.closeUp?.sound ?? derivedSound;
  const title = (r.abilityName ?? ability?.name ?? (closeUp.kind === 'kill' ? 'Killing Blow' : 'Critical Strike')).toUpperCase();

  const classColor = actor?.className ? getClassDefinition(actor.className)?.color : undefined;
  const band = actorIsMob ? BAND.enemy : closeUp.kind === 'kill' ? BAND.kill : closeUp.kind === 'crit' ? BAND.crit : classColor ? shade(classColor) : BAND.fallback;

  return { layout, left, right, extra, title, subtitle, number, band, tone: actorIsMob ? 'enemy' : 'player', sound };
}
