import { describe, it, expect, vi } from 'vitest';
import { resolveSetup, SANDBOX_PRESETS } from '@caverns/shared';
import { simulateFight } from './simulate.js';
import { GameSession } from '../GameSession.js';

function setupFor(id: string, seed: number) {
  const r = resolveSetup(id, { seed });
  if (!r.ok) throw new Error(r.error);
  return r.setup;
}

describe('simulateFight', () => {
  describe.each(SANDBOX_PRESETS.map((p) => p.id))('preset %s', (id) => {
    it.each([1, 2, 3])('seed %i finishes cleanly', async (seed) => {
      const res = await simulateFight(setupFor(id, seed), { maxRounds: 100 });
      expect(res.errors).toEqual([]);
      expect(['victory', 'wipe']).toContain(res.result);
      expect(res.actions).toBeGreaterThan(0);
    }, 30_000);
  });

  it('replays identically for the same seed', async () => {
    const a = await simulateFight(setupFor('showcase', 11));
    const b = await simulateFight(setupFor('showcase', 11));
    const pick = (r: typeof a) => ({ result: r.result, rounds: r.rounds, actions: r.actions, damageDealt: r.damageDealt, damageTaken: r.damageTaken });
    expect(pick(b)).toEqual(pick(a));
  }, 30_000);

  it('restores Math.random afterwards', async () => {
    const original = Math.random;
    await simulateFight(setupFor('duel', 5));
    expect(Math.random).toBe(original);
  });

  it('resolves with an error result (not a hang) when a bot action throws', async () => {
    const original = Math.random;
    const spy = vi.spyOn(GameSession.prototype, 'handleArenaEndTurn').mockImplementation(() => {
      throw new Error('boom');
    });
    try {
      const res = await simulateFight(setupFor('duel', 1));
      expect(res.result).toBe('error');
      expect(res.errors[0]).toContain('boom');
      expect(Math.random).toBe(original);
    } finally {
      spy.mockRestore();
    }
  }, 5_000);
});
