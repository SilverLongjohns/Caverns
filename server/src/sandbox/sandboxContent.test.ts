import { describe, it, expect } from 'vitest';
import { resolveSetup, getClassDefinition, PROGRESSION_CONFIG } from '@caverns/shared';
import { buildSandboxContent, buildSandboxMobs, buildSandboxPlayer, SANDBOX_ROOM_ID } from './sandboxContent.js';

function setup(presetId: string, overrides = {}) {
  const r = resolveSetup(presetId, overrides);
  if (!r.ok) throw new Error(r.error);
  return r.setup;
}

describe('buildSandboxContent', () => {
  it('builds a single room of the requested type and biome', () => {
    const content = buildSandboxContent(setup('duel', { room: 'cavern', biome: 'bone' }));
    expect(content.biomeId).toBe('bone');
    expect(content.entranceRoomId).toBe(SANDBOX_ROOM_ID);
    expect(content.rooms).toHaveLength(1);
    expect(content.rooms[0]).toMatchObject({ id: SANDBOX_ROOM_ID, type: 'cavern', exits: {} });
    expect(content.rooms[0].encounter).toBeUndefined();
    expect(content.mobs.map((m) => m.id)).toEqual(['tunnel_rat']);
  });
});

describe('buildSandboxMobs', () => {
  it('gives duplicate mobs distinct instance ids', () => {
    const mobs = buildSandboxMobs(setup('duel', { mobs: ['tunnel_rat', 'tunnel_rat', 'goblin_scrapper'] }));
    expect(mobs.map((m) => m.instanceId)).toEqual(['tunnel_rat_0', 'tunnel_rat_1', 'goblin_scrapper_2']);
    expect(mobs[0].hp).toBe(mobs[0].maxHp);
    expect(mobs[0].templateId).toBe('tunnel_rat');
  });
});

describe('buildSandboxPlayer', () => {
  it('level 1 uses class base HP', () => {
    const s = setup('duel');
    const p = buildSandboxPlayer('p1', s.party[0], SANDBOX_ROOM_ID);
    expect(p.maxHp).toBe(getClassDefinition('vanguard')!.baseStats.maxHp);
    expect(p.hp).toBe(p.maxHp);
    expect(p.level).toBe(1);
  });

  it('spreads stat points by level and applies equipment', () => {
    const s = setup('showcase');
    const p = buildSandboxPlayer('p1', s.party[0], SANDBOX_ROOM_ID);
    const points = (3 - 1) * PROGRESSION_CONFIG.statPointsPerLevel;
    const spent = Object.values(p.statAllocations).reduce((a, b) => a + b, 0);
    expect(spent).toBe(points);
    expect(p.equipment.weapon?.id).toBe('worldsplitter');
    expect(p.equipment.offhand?.id).toBe('aegis_of_the_fallen');
  });
});
