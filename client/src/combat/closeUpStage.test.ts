import { describe, it, expect } from 'vitest';
import { CLASS_DEFINITIONS, CLOSE_UP_CONFIG, type CombatParticipant } from '@caverns/shared';
import { stageFor, artChainFor, mirrorArt } from './closeUpStage.js';
import { MOB_CLOSE_UPS } from './mobCloseUpManifest.js';

const cls = CLASS_DEFINITIONS[0];
const hero: CombatParticipant = { id: 'p1', type: 'player', name: 'Hero', hp: 30, maxHp: 50, initiative: 5, className: cls.id };
const ally: CombatParticipant = { id: 'p2', type: 'player', name: 'Ally', hp: 20, maxHp: 50, initiative: 5, className: CLASS_DEFINITIONS[1].id };
const mob = (i: number): CombatParticipant => ({ id: `m${i}`, type: 'mob', name: `Rat ${i}`, hp: 10, maxHp: 15, initiative: 3, templateId: 'tunnel_rat' });
const parts = [hero, ally, mob(1), mob(2), mob(3), mob(4), mob(5)];
const active = (result: object, kind: 'ability' | 'crit' | 'kill' | 'strike' = 'ability') => ({
  id: 1, closeUp: { kind, durationMs: kind === 'strike' ? CLOSE_UP_CONFIG.strikeMs : CLOSE_UP_CONFIG.abilityMs }, participants: parts,
  result: { type: 'combat_action_result', actorName: 'x', ...result } as never,
});

describe('artChainFor', () => {
  it('every class, role and mob resolves to a non-empty chain ending in a stand-in', () => {
    for (const c of CLASS_DEFINITIONS) for (const role of ['attack', 'hurt', 'cast'] as const) {
      const chain = artChainFor({ type: 'player', className: c.id }, role);
      expect(chain.length, `${c.id}/${role}`).toBeGreaterThan(1);
      expect(chain[0]).toMatch(/^\/closeups\/classes\//);
    }
    const withArt = new Set(MOB_CLOSE_UPS);
    for (const id of ['__no_art_mob__', ...MOB_CLOSE_UPS]) {
      const chain = artChainFor({ type: 'mob', templateId: id }, 'attack');
      if (withArt.has(id)) expect(chain[0]).toBe(`/closeups/mobs/${id}.png`);
      else expect(chain.some((c) => c.startsWith('/closeups/mobs/'))).toBe(false);
    }
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

describe('strikes', () => {
  it('a player strike: strike variant, no title or subtitle, silent, damage number, player left', () => {
    const s = stageFor(active({ actorId: 'p1', action: 'attack', targetId: 'm1', damage: 4 }, 'strike'));
    expect(s.variant).toBe('strike');
    expect(s.title).toBe('');
    expect(s.subtitle).toBe('');
    expect(s.sound).toBeNull();
    expect(s.number).toEqual({ value: 4, kind: 'damage' });
    expect(s.left.map((a) => a.id)).toEqual(['p1']);
    expect(s.right.map((a) => a.id)).toEqual(['m1']);
  });
  it('mob strike on a player: player left (hurt), mob right (actor), enemy tone', () => {
    const s = stageFor(active({ actorId: 'm1', action: 'attack', targetId: 'p1', damage: 3 }, 'strike'));
    expect(s.variant).toBe('strike');
    expect(s.left.map((a) => [a.id, a.isActor])).toEqual([['p1', false]]);
    expect(s.right.map((a) => [a.id, a.isActor])).toEqual([['m1', true]]);
    expect(s.tone).toBe('enemy');
  });
  it('non-strike close-ups keep the full variant and a sound', () => {
    const s = stageFor(active({ actorId: 'p1', action: 'attack', targetId: 'm1', damage: 9, critMultiplier: 2 }, 'crit'));
    expect(s.variant).toBe('full');
    expect(s.sound).not.toBeNull();
  });
});

describe('ranged close-ups', () => {
  const rangedCls = CLASS_DEFINITIONS[0].id;
  const rangedParts = [
    { id: 'p1', type: 'player' as const, name: 'P', hp: 10, maxHp: 10, initiative: 1, className: rangedCls },
    { id: 'm1', type: 'mob' as const, name: 'M', hp: 10, maxHp: 10, initiative: 1, templateId: 'x' },
  ];
  const rangedActive = (r: Record<string, unknown>, kind: 'strike' | 'kill' = 'strike') => ({
    id: 1, result: { actorId: 'p1', actorName: 'P', targetId: 'm1', ...r }, participants: rangedParts,
    closeUp: { kind, durationMs: kind === 'kill' ? CLOSE_UP_CONFIG.killMs : CLOSE_UP_CONFIG.strikeMs },
  }) as never;

  it('shoot role: ranged pose first, then the attack pose, portrait, glyph', () => {
    const chain = artChainFor({ type: 'player', className: rangedCls }, 'shoot');
    expect(chain[0]).toBe(`/closeups/classes/${rangedCls}-ranged.png`);
    expect(chain[1]).toBe(`/closeups/classes/${rangedCls}-attack.png`);
  });
  it('a shot stages the shooter with the shoot chain (strike and kill)', () => {
    expect(stageFor(rangedActive({ action: 'shoot', hit: true, damage: 4 })).left[0].art[0]).toBe(`/closeups/classes/${rangedCls}-ranged.png`);
    expect(stageFor(rangedActive({ action: 'shoot', hit: true, damage: 4, targetDowned: true }, 'kill')).left[0].art[0]).toBe(`/closeups/classes/${rangedCls}-ranged.png`);
  });
  it('a miss: miss flag, no damage number, target not downed', () => {
    const st = stageFor(rangedActive({ action: 'shoot', hit: false, damage: 0 }));
    expect(st.miss).toBe(true);
    expect(st.number).toBeNull();
    expect(st.right[0].downed).toBe(false);
  });
  it('melee attacks are unchanged (attack pose, no miss)', () => {
    const st = stageFor(rangedActive({ action: 'attack', damage: 4 }));
    expect(st.left[0].art[0]).toBe(`/closeups/classes/${rangedCls}-attack.png`);
    expect(st.miss).toBe(false);
  });
});

describe('mirrorArt', () => {
  it('only mirrors stand-in art on the right; close-up art is authored facing the right way', () => {
    expect(mirrorArt('right', '/sprites/glyphs/mobs/x.png')).toBe(true);
    expect(mirrorArt('right', '/closeups/mobs/x.png')).toBe(false);
    expect(mirrorArt('left', '/sprites/glyphs/classes/x.png')).toBe(false);
    expect(mirrorArt('left', '/closeups/classes/x-attack.png')).toBe(false);
    expect(mirrorArt('right', undefined)).toBe(false);
  });
});
