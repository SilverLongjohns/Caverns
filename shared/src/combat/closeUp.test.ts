import { describe, it, expect } from 'vitest';
import { CLASS_DEFINITIONS } from '../classData.js';
import { CLOSE_UP_CONFIG, CLOSE_UP_SOUNDS, closeUpFor, closeUpForParticipants, findAbility } from './closeUp.js';

const player = { actorType: 'player' as const, targetType: 'mob' as const, isPassiveAbility: false };
const mobHit = { actorType: 'mob' as const, targetType: 'player' as const, isPassiveAbility: false };

describe('closeUpFor', () => {
  it('every non-passive ability in the data gets an ability close-up; passives never do', () => {
    for (const cls of CLASS_DEFINITIONS) {
      for (const a of cls.abilities) {
        const r = closeUpFor({ action: 'use_ability', abilityId: a.id }, { ...player, isPassiveAbility: a.passive });
        if (a.passive) expect(r, a.id).toBeNull();
        else expect(r, a.id).toEqual({ kind: 'ability', durationMs: CLOSE_UP_CONFIG.abilityMs });
      }
    }
  });
  it('an ability that kills is still an ability close-up', () => {
    expect(closeUpFor({ action: 'use_ability', targetDowned: true }, player)?.kind).toBe('ability');
  });
  it('player basic attacks: kill beats crit beats strike', () => {
    expect(closeUpFor({ action: 'attack', targetDowned: true, critMultiplier: 2 }, player))
      .toEqual({ kind: 'kill', durationMs: CLOSE_UP_CONFIG.killMs });
    expect(closeUpFor({ action: 'attack', critMultiplier: 1.5 }, player))
      .toEqual({ kind: 'crit', durationMs: CLOSE_UP_CONFIG.critMs });
    expect(closeUpFor({ action: 'attack', critMultiplier: 1 }, player))
      .toEqual({ kind: 'strike', durationMs: CLOSE_UP_CONFIG.strikeMs });
    expect(closeUpFor({ action: 'attack' }, player)?.kind).toBe('strike');
  });
  it('mob hits on players: kill, crit or strike, including hits landed through the defend prompt', () => {
    expect(closeUpFor({ action: 'attack', targetDowned: true }, mobHit)?.kind).toBe('kill');
    expect(closeUpFor({ action: 'attack', critMultiplier: 2 }, mobHit)?.kind).toBe('crit');
    expect(closeUpFor({ action: 'attack' }, mobHit)).toEqual({ kind: 'strike', durationMs: CLOSE_UP_CONFIG.strikeMs });
    expect(closeUpFor({ action: 'defend', targetDowned: true }, mobHit)?.kind).toBe('kill');
    expect(closeUpFor({ action: 'defend' }, mobHit)?.kind).toBe('strike');
  });
  it('never fires for defend, items, flee, the defend-QTE preview, or mob-on-mob', () => {
    expect(closeUpFor({ action: 'defend' }, { ...player, targetType: undefined })).toBeNull();
    expect(closeUpFor({ action: 'use_item', targetDowned: true }, player)).toBeNull();
    expect(closeUpFor({ action: 'use_item_effect', targetDowned: true }, player)).toBeNull();
    expect(closeUpFor({ action: 'flee' }, player)).toBeNull();
    expect(closeUpFor({ action: 'attack', defendQte: true, targetDowned: true }, mobHit)).toBeNull();
    expect(closeUpFor({ action: 'attack', targetDowned: true }, { ...mobHit, targetType: 'mob' })).toBeNull();
  });
});

describe('closeUpForParticipants', () => {
  const firstActive = CLASS_DEFINITIONS.flatMap((c) => c.abilities.map((a) => ({ c, a }))).find(({ a }) => !a.passive)!;
  const parts = [
    { id: 'p1', type: 'player' as const, className: firstActive.c.id },
    { id: 'm1', type: 'mob' as const },
  ];
  it('resolves actor and target sides from participants', () => {
    expect(closeUpForParticipants({ action: 'attack', actorId: 'm1', targetId: 'p1', targetDowned: true }, parts)?.kind).toBe('kill');
    expect(closeUpForParticipants({ action: 'use_ability', actorId: 'p1', abilityId: firstActive.a.id }, parts)?.kind).toBe('ability');
  });
  it('assumes the opposite side when the target is missing', () => {
    expect(closeUpForParticipants({ action: 'attack', actorId: 'p1', targetId: 'gone', targetDowned: true }, parts)?.kind).toBe('kill');
  });
  it('returns null for an unknown actor', () => {
    expect(closeUpForParticipants({ action: 'attack', actorId: 'ghost', critMultiplier: 3 }, parts)).toBeNull();
  });
});

describe('data integrity', () => {
  it('strikes are shorter than every other close-up', () => {
    expect(CLOSE_UP_CONFIG.strikeMs).toBeGreaterThan(0);
    expect(CLOSE_UP_CONFIG.strikeMs).toBeLessThan(Math.min(CLOSE_UP_CONFIG.critMs, CLOSE_UP_CONFIG.killMs, CLOSE_UP_CONFIG.abilityMs));
  });
  it('every closeUp block in the data is valid', () => {
    for (const cls of CLASS_DEFINITIONS) {
      if (cls.color !== undefined) expect(cls.color, cls.id).toMatch(/^#[0-9a-fA-F]{6}$/);
      for (const a of cls.abilities) {
        if (a.closeUp?.sound !== undefined) expect(CLOSE_UP_SOUNDS, a.id).toContain(a.closeUp.sound);
        if (a.closeUp?.art !== undefined) expect(a.closeUp.art, a.id).toMatch(/^\/closeups\//);
      }
    }
  });
  it('findAbility finds any ability by id, optionally within a class', () => {
    for (const cls of CLASS_DEFINITIONS) for (const a of cls.abilities) {
      expect(findAbility(a.id)?.id).toBe(a.id);
      expect(findAbility(a.id, cls.id)?.id).toBe(a.id);
    }
    expect(findAbility('does-not-exist')).toBeUndefined();
    expect(findAbility(undefined)).toBeUndefined();
  });
});
