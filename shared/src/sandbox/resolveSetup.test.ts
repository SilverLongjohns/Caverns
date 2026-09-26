import { describe, it, expect } from 'vitest';
import { resolveSetup, parseSandboxQuery, buildSandboxQuery, findSandboxItem } from './resolveSetup.js';
import { SANDBOX_PRESETS } from './presets.js';

describe('SANDBOX_PRESETS', () => {
  it('every preset resolves without overrides', () => {
    for (const p of SANDBOX_PRESETS) {
      const r = resolveSetup(p.id);
      expect(r, p.id).toMatchObject({ ok: true });
    }
  });

  it('has unique ids', () => {
    const ids = SANDBOX_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('resolveSetup', () => {
  it('fills defaults from the preset', () => {
    const r = resolveSetup('duel');
    if (!r.ok) throw new Error(r.error);
    expect(r.setup).toEqual({
      presetId: 'duel', label: 'Duel', roomType: 'tunnel', biome: 'starter',
      mobs: ['tunnel_rat'], seed: 1,
      party: [{ className: 'vanguard', level: 1, name: 'Templar', equipment: {} }],
    });
  });

  it('applies every override', () => {
    const r = resolveSetup('duel', {
      room: 'boss', biome: 'fungal', mobs: ['mycelium_king', 'fungal_crawler'],
      party: ['cleric', 'cleric'], level: 3, seed: 42,
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.setup.roomType).toBe('boss');
    expect(r.setup.biome).toBe('fungal');
    expect(r.setup.mobs).toEqual(['mycelium_king', 'fungal_crawler']);
    expect(r.setup.party.map((m) => m.name)).toEqual(['Suturist 1', 'Suturist 2']);
    expect(r.setup.party.every((m) => m.level === 3)).toBe(true);
    expect(r.setup.seed).toBe(42);
  });

  it.each([
    [{ room: 'ballroom' }, 'room type "ballroom"'],
    [{ biome: 'moon' }, 'biome "moon"'],
    [{ mobs: ['dragon'] }, 'mob "dragon"'],
    [{ mobs: [] }, 'at least one mob'],
    [{ party: ['wizard'] }, 'class "wizard"'],
    [{ party: [] }, 'between 1 and 4'],
    [{ level: 0 }, 'level'],
    [{ level: Number.NaN }, 'level'],
    [{ seed: Number.NaN }, 'seed'],
  ])('rejects %j', (overrides, fragment) => {
    const r = resolveSetup('duel', overrides);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.toLowerCase()).toContain(fragment.toLowerCase());
  });

  it('rejects an unknown preset and lists known ones', () => {
    const r = resolveSetup('nope');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('duel');
  });

  it('finds preset equipment with the slots the showcase preset relies on', () => {
    // Wrong-slot equipment can only come from a preset (URL overrides can't set gear);
    // the "every preset resolves" test above catches a mis-slotted preset item.
    expect(findSandboxItem('worldsplitter')?.slot).toBe('weapon');
    expect(findSandboxItem('aegis_of_the_fallen')?.slot).toBe('offhand');
  });
});

describe('parseSandboxQuery / buildSandboxQuery', () => {
  it('returns null without a sandbox param', () => {
    expect(parseSandboxQuery('?foo=1')).toBeNull();
  });

  it('parses every override', () => {
    expect(parseSandboxQuery('?sandbox=duel&room=boss&biome=bone&mobs=a,b&party=vanguard,cleric&level=2&seed=7')).toEqual({
      preset: 'duel',
      overrides: { room: 'boss', biome: 'bone', mobs: ['a', 'b'], party: ['vanguard', 'cleric'], level: 2, seed: 7 },
    });
  });

  it('keeps malformed numbers as NaN so resolveSetup rejects them', () => {
    const q = parseSandboxQuery('?sandbox=duel&seed=abc');
    expect(Number.isNaN(q?.overrides.seed)).toBe(true);
    const r = resolveSetup(q!.preset, q!.overrides);
    expect(r.ok).toBe(false);
  });

  it('round-trips', () => {
    const overrides = { room: 'cavern', mobs: ['tunnel_rat', 'tunnel_rat'], seed: 3 };
    expect(parseSandboxQuery(buildSandboxQuery('duel', overrides))).toEqual({ preset: 'duel', overrides });
  });
});
