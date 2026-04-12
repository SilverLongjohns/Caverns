import { describe, it, expect } from 'vitest';
import type { DropSpec, DropSpecRef, Item } from '@caverns/shared';
import {
  resolveDrops,
  mergeDropSpecs,
  collectConsumableManifest,
} from './DropResolver.js';

function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const emptyCtx = {
  biomeId: 'fungal',
  registry: {},
  itemsById: new Map<string, Item>(),
};

describe('resolveDrops', () => {
  it('returns empty array for a spec with only nothing entries', () => {
    const spec: DropSpec = {
      pools: [{ rolls: 3, entries: [{ type: 'nothing' }] }],
    };
    const results = resolveDrops({ drops: spec }, { ...emptyCtx, rng: seededRng(1) });
    expect(results).toEqual([]);
  });

  it('resolves a consumable entry via itemsById', () => {
    const potion: Item = {
      id: 'healing_potion',
      name: 'Healing Potion',
      description: 'Heals.',
      rarity: 'common',
      slot: 'consumable',
      stats: {},
    };
    const results = resolveDrops(
      { drops: { pools: [{ rolls: 1, entries: [{ type: 'consumable', consumableId: 'healing_potion' }] }] } },
      { ...emptyCtx, itemsById: new Map([['healing_potion', potion]]), rng: seededRng(1) },
    );
    expect(results).toEqual([{ kind: 'item', item: potion }]);
  });

  it('throws when a consumable entry references an unknown id', () => {
    expect(() =>
      resolveDrops(
        { drops: { pools: [{ rolls: 1, entries: [{ type: 'consumable', consumableId: 'missing' }] }] } },
        { ...emptyCtx, rng: seededRng(1) },
      ),
    ).toThrow(/Unknown consumableId/);
  });

  it('calls generateItem with absolute skullRating', () => {
    const spec: DropSpec = {
      pools: [{ rolls: 1, entries: [{ type: 'generated', slot: 'weapon', skullRating: 2 }] }],
    };
    const results = resolveDrops({ drops: spec }, { ...emptyCtx, rng: seededRng(1) });
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('item');
    const item = (results[0] as { kind: 'item'; item: Item }).item;
    expect(item.slot).toBe('weapon');
  });

  it('forwards rarityWeights to itemgen so the generated item respects them', () => {
    const spec: DropSpec = {
      pools: [{ rolls: 1, entries: [{
        type: 'generated',
        slot: 'weapon',
        skullRating: 2,
        rarityWeights: { legendary: 1 },
      }] }],
    };
    // Run several times with different seeds; every generated item must be legendary.
    for (let seed = 1; seed <= 10; seed++) {
      const results = resolveDrops({ drops: spec }, { ...emptyCtx, rng: seededRng(seed) });
      const item = (results[0] as { kind: 'item'; item: Item }).item;
      expect(item.rarity).toBe('legendary');
    }
  });

  it('uses skullOffset when sourceSkullRating is set, clamping to [1,3]', () => {
    const spec: DropSpec = {
      pools: [{ rolls: 1, entries: [{ type: 'generated', slot: 'armor', skullOffset: 5 }] }],
    };
    const results = resolveDrops(
      { drops: spec },
      { ...emptyCtx, sourceSkullRating: 2, rng: seededRng(1) },
    );
    expect(results).toHaveLength(1);
    expect((results[0] as { kind: 'item'; item: Item }).item.slot).toBe('armor');
  });

  it('throws when skullOffset is used without sourceSkullRating', () => {
    const spec: DropSpec = {
      pools: [{ rolls: 1, entries: [{ type: 'generated', slot: 'weapon', skullOffset: 0 }] }],
    };
    expect(() =>
      resolveDrops({ drops: spec }, { ...emptyCtx, rng: seededRng(1) }),
    ).toThrow(/skullOffset requires sourceSkullRating/);
  });

  it('throws when both skullRating and skullOffset are set', () => {
    const spec: DropSpec = {
      pools: [{ rolls: 1, entries: [{ type: 'generated', slot: 'weapon', skullRating: 1, skullOffset: 0 }] }],
    };
    expect(() =>
      resolveDrops({ drops: spec }, { ...emptyCtx, rng: seededRng(1) }),
    ).toThrow(/cannot set both/);
  });

  it('throws when neither skullRating nor skullOffset is set', () => {
    const spec: DropSpec = {
      pools: [{ rolls: 1, entries: [{ type: 'generated', slot: 'weapon' }] }],
    };
    expect(() =>
      resolveDrops({ drops: spec }, { ...emptyCtx, rng: seededRng(1) }),
    ).toThrow(/must set either/);
  });

  it('resolves a material entry', () => {
    const results = resolveDrops(
      { drops: { pools: [{ rolls: 1, entries: [{ type: 'material', materialId: 'spore', count: 2 }] }] } },
      { ...emptyCtx, rng: seededRng(1) },
    );
    expect(results).toEqual([{ kind: 'material', materialId: 'spore', count: 2 }]);
  });

  it('resolves a gold entry as a uniform integer in [min,max]', () => {
    const results = resolveDrops(
      { drops: { pools: [{ rolls: 1, entries: [{ type: 'gold', min: 5, max: 5 }] }] } },
      { ...emptyCtx, rng: seededRng(1) },
    );
    expect(results).toEqual([{ kind: 'gold', amount: 5 }]);
  });

  it('resolves a key entry', () => {
    const results = resolveDrops(
      { drops: { pools: [{ rolls: 1, entries: [{ type: 'key', keyId: 'crystal_key' }] }] } },
      { ...emptyCtx, rng: seededRng(1) },
    );
    expect(results).toEqual([{ kind: 'key', keyId: 'crystal_key' }]);
  });

  it('resolves a dropSpecId via the registry', () => {
    const spec: DropSpec = {
      pools: [{ rolls: 1, entries: [{ type: 'gold', min: 3, max: 3 }] }],
    };
    const results = resolveDrops(
      { dropSpecId: 'test_spec' },
      { ...emptyCtx, registry: { test_spec: spec }, rng: seededRng(1) },
    );
    expect(results).toEqual([{ kind: 'gold', amount: 3 }]);
  });

  it('throws on unknown dropSpecId', () => {
    expect(() =>
      resolveDrops({ dropSpecId: 'nope' }, { ...emptyCtx, rng: seededRng(1) }),
    ).toThrow(/Unknown dropSpecId/);
  });

  it('roughly respects weighted distribution', () => {
    const spec: DropSpec = {
      pools: [{ rolls: 1, entries: [
        { type: 'gold', min: 1, max: 1, weight: 3 },
        { type: 'gold', min: 2, max: 2, weight: 1 },
      ]}],
    };
    let ones = 0;
    let twos = 0;
    const rng = seededRng(42);
    for (let i = 0; i < 4000; i++) {
      const r = resolveDrops({ drops: spec }, { ...emptyCtx, rng });
      if ((r[0] as { kind: 'gold'; amount: number }).amount === 1) ones++;
      else twos++;
    }
    const ratio = ones / twos;
    expect(ratio).toBeGreaterThan(2.5);
    expect(ratio).toBeLessThan(3.5);
  });
});

describe('mergeDropSpecs', () => {
  const registry: Record<string, DropSpec> = {
    base: { pools: [{ rolls: 1, entries: [{ type: 'gold', min: 1, max: 1 }] }] },
  };

  it('concatenates pools from two inline specs', () => {
    const a: DropSpec = { pools: [{ rolls: 1, entries: [{ type: 'nothing' }] }] };
    const b: DropSpec = { pools: [{ rolls: 2, entries: [{ type: 'gold', min: 5, max: 5 }] }] };
    const merged = mergeDropSpecs({ drops: a }, { drops: b }, registry);
    expect(merged).toEqual({
      drops: {
        pools: [
          { rolls: 1, entries: [{ type: 'nothing' }] },
          { rolls: 2, entries: [{ type: 'gold', min: 5, max: 5 }] },
        ],
      },
    });
  });

  it('resolves registry refs before concatenating', () => {
    const b: DropSpec = { pools: [{ rolls: 1, entries: [{ type: 'gold', min: 9, max: 9 }] }] };
    const merged = mergeDropSpecs({ dropSpecId: 'base' }, { drops: b }, registry);
    const inline = (merged as { drops: DropSpec }).drops;
    expect(inline.pools).toHaveLength(2);
    expect(inline.pools[0].entries[0]).toEqual({ type: 'gold', min: 1, max: 1 });
    expect(inline.pools[1].entries[0]).toEqual({ type: 'gold', min: 9, max: 9 });
  });

  it('returns the other side when one is undefined', () => {
    const a: DropSpec = { pools: [{ rolls: 1, entries: [{ type: 'nothing' }] }] };
    expect(mergeDropSpecs(undefined, { drops: a }, registry)).toEqual({ drops: a });
    expect(mergeDropSpecs({ drops: a }, undefined, registry)).toEqual({ drops: a });
  });
});

describe('collectConsumableManifest', () => {
  it('collects consumableId and keyId references from all specs', () => {
    const registry: Record<string, DropSpec> = {
      mob_common: {
        pools: [{ rolls: 1, entries: [
          { type: 'consumable', consumableId: 'healing_potion' },
          { type: 'nothing' },
        ]}],
      },
    };
    const refs: DropSpecRef[] = [
      { dropSpecId: 'mob_common' },
      { drops: { pools: [{ rolls: 1, entries: [
        { type: 'consumable', consumableId: 'mana_potion' },
        { type: 'key', keyId: 'crystal_key' },
      ]}] } },
    ];
    const manifest = collectConsumableManifest(refs, registry);
    expect(manifest.consumableIds).toEqual(new Set(['healing_potion', 'mana_potion']));
    expect(manifest.keyIds).toEqual(new Set(['crystal_key']));
  });
});
