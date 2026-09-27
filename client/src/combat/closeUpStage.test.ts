import { describe, it, expect } from 'vitest';
import { CLASS_DEFINITIONS, CLOSE_UP_CONFIG, type CombatParticipant } from '@caverns/shared';
import { stageFor, artChainFor } from './closeUpStage.js';

const cls = CLASS_DEFINITIONS[0];
const hero: CombatParticipant = { id: 'p1', type: 'player', name: 'Hero', hp: 30, maxHp: 50, initiative: 5, className: cls.id };
const ally: CombatParticipant = { id: 'p2', type: 'player', name: 'Ally', hp: 20, maxHp: 50, initiative: 5, className: CLASS_DEFINITIONS[1].id };
const mob = (i: number): CombatParticipant => ({ id: `m${i}`, type: 'mob', name: `Rat ${i}`, hp: 10, maxHp: 15, initiative: 3, templateId: 'tunnel_rat' });
const parts = [hero, ally, mob(1), mob(2), mob(3), mob(4), mob(5)];
const active = (result: object, kind: 'ability' | 'crit' | 'kill' = 'ability') => ({
  id: 1, closeUp: { kind, durationMs: CLOSE_UP_CONFIG.abilityMs }, participants: parts,
  result: { type: 'combat_action_result', actorName: 'x', ...result } as never,
});

describe('artChainFor', () => {
  it('every class, role and mob resolves to a non-empty chain ending in a stand-in', () => {
    for (const c of CLASS_DEFINITIONS) for (const role of ['attack', 'hurt', 'cast'] as const) {
      const chain = artChainFor({ type: 'player', className: c.id }, role);
      expect(chain.length, `${c.id}/${role}`).toBeGreaterThan(1);
      expect(chain[0]).toMatch(/^\/closeups\/classes\//);
    }
    expect(artChainFor({ type: 'mob', templateId: 'tunnel_rat' }, 'attack')).toEqual(['/closeups/mobs/tunnel_rat.png', '/sprites/glyphs/mobs/tunnel_rat.png']);
  });
  it('an ability art path from data goes first', () => {
    expect(artChainFor({ type: 'player', className: cls.id }, 'cast', '/closeups/abilities/x.png')[0]).toBe('/closeups/abilities/x.png');
  });
});

describe('stageFor (data-driven over every ability)', () => {
  it('stages every non-passive ability without naming it', () => {
    for (const c of CLASS_DEFINITIONS) for (const a of c.abilities.filter((x) => !x.passive)) {
      const caster = { ...hero, className: c.id };
      const s = stageFor({ ...active({ action: 'use_ability', actorId: 'p1', abilityId: a.id, abilityName: a.name, targetId: a.targetType === 'ally' ? 'p2' : a.targetType === 'enemy' ? 'm1' : undefined, targetIds: a.targetType.startsWith('area') ? ['m1', 'm2'] : undefined }), participants: [caster, ally, mob(1), mob(2)] });
      expect(s.title, a.id).toBe(a.name.toUpperCase());
      expect(s.left[0]?.id, a.id).toBe('p1');
      if (a.targetType === 'none') expect(s.layout, a.id).toBe('solo');
      if (a.targetType === 'ally' || a.targetType === 'area_ally') expect(s.layout, a.id).toBe('allies');
      if (a.targetType === 'enemy' || a.targetType === 'area_enemy') expect(s.layout, a.id).toBe('versus');
    }
  });
  it('area hits show at most 3 targets plus "+N"', () => {
    // Data-driven: an area-enemy ability if the data has one (caster set to its class), else an unknown id (stages as versus).
    const area = CLASS_DEFINITIONS.flatMap((c) => c.abilities.map((ab) => ({ c, ab }))).find(({ ab }) => ab.targetType === 'area_enemy');
    const caster = area ? { ...hero, className: area.c.id } : hero;
    const s = stageFor({ ...active({ action: 'use_ability', actorId: 'p1', abilityId: area?.ab.id ?? '__area__', abilityName: 'Blast', targetIds: ['m1', 'm2', 'm3', 'm4', 'm5'], downedIds: ['m2'] }), participants: [caster, ally, mob(1), mob(2), mob(3), mob(4), mob(5)] });
    expect(s.right).toHaveLength(3);
    expect(s.extra).toBe(2);
    expect(s.right.find((a) => a.id === 'm2')?.downed).toBe(true);
  });
  it('an unknown targetType stages as versus', () => {
    const s = stageFor({ ...active({ action: 'use_ability', actorId: 'p1', abilityId: '__nope__', abilityName: 'Odd', targetId: 'm1' }) });
    expect(s.layout).toBe('versus');
  });
  it('mob kill on a player: mob on the right, player on the left, enemy tone', () => {
    const s = stageFor(active({ action: 'attack', actorId: 'm1', targetId: 'p1', targetDowned: true, damage: 12 }, 'kill'));
    expect(s.left[0].id).toBe('p1');
    expect(s.right[0].id).toBe('m1');
    expect(s.right[0].isActor).toBe(true);
    expect(s.tone).toBe('enemy');
    expect(s.subtitle).toBe('KILLED');
    expect(s.sound).toBe('boom');
  });
  it('player crit: CRITICAL, crack, damage number', () => {
    const s = stageFor(active({ action: 'attack', actorId: 'p1', targetId: 'm1', critMultiplier: 2, damage: 14 }, 'crit'));
    expect(s.subtitle).toBe('CRITICAL');
    expect(s.number).toEqual({ value: 14, kind: 'damage' });
    expect(s.sound).toBe('crack');
  });
  it('healing with no damage defaults to shimmer and a heal number', () => {
    const s = stageFor(active({ action: 'use_ability', actorId: 'p1', abilityId: '__heal__', abilityName: 'Mend', targetId: 'p2', healing: 9 }));
    expect(s.number).toEqual({ value: 9, kind: 'heal' });
    expect(s.sound).toBe('shimmer');
  });
});
