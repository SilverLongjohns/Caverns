import type {
  DropSpec, DropSpecRef, DropEntry, Item,
} from '@caverns/shared';
import { generateItem } from '@caverns/itemgen';

export interface DropContext {
  sourceSkullRating?: 1 | 2 | 3;
  biomeId: string;
  registry: Record<string, DropSpec>;
  itemsById: Map<string, Item>;
  rng?: () => number;
}

export type DropResult =
  | { kind: 'item';     item: Item }
  | { kind: 'gold';     amount: number }
  | { kind: 'material'; materialId: string; count: number }
  | { kind: 'key';      keyId: string };

export function resolveDrops(ref: DropSpecRef, ctx: DropContext): DropResult[] {
  const spec = resolveSpecRef(ref, ctx.registry);
  const results: DropResult[] = [];
  const rng = ctx.rng ?? Math.random;
  for (const pool of spec.pools) {
    for (let i = 0; i < pool.rolls; i++) {
      const entry = pickWeighted(pool.entries, rng);
      const result = resolveEntry(entry, ctx, rng);
      if (result) results.push(result);
    }
  }
  return results;
}

function resolveSpecRef(ref: DropSpecRef, registry: Record<string, DropSpec>): DropSpec {
  if ('dropSpecId' in ref) {
    const spec = registry[ref.dropSpecId];
    if (!spec) throw new Error(`Unknown dropSpecId: ${ref.dropSpecId}`);
    return spec;
  }
  return ref.drops;
}

function pickWeighted(entries: DropEntry[], rng: () => number): DropEntry {
  const total = entries.reduce((sum, e) => sum + (e.weight ?? 1), 0);
  let roll = rng() * total;
  for (const entry of entries) {
    roll -= entry.weight ?? 1;
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1];
}

function resolveEntry(
  entry: DropEntry,
  ctx: DropContext,
  rng: () => number,
): DropResult | null {
  switch (entry.type) {
    case 'nothing':
      return null;
    case 'consumable': {
      const item = ctx.itemsById.get(entry.consumableId);
      if (!item) throw new Error(`Unknown consumableId: ${entry.consumableId}`);
      return { kind: 'item', item };
    }
    case 'generated': {
      if (entry.skullRating != null && entry.skullOffset != null) {
        throw new Error('GeneratedDropEntry cannot set both skullRating and skullOffset');
      }
      let skull: 1 | 2 | 3;
      if (entry.skullRating != null) {
        skull = entry.skullRating;
      } else if (entry.skullOffset != null) {
        if (ctx.sourceSkullRating == null) {
          throw new Error('skullOffset requires sourceSkullRating in context');
        }
        skull = clampSkull(ctx.sourceSkullRating + entry.skullOffset);
      } else {
        throw new Error('GeneratedDropEntry must set either skullRating or skullOffset');
      }
      const item = generateItem({
        slot: entry.slot,
        skullRating: skull,
        biomeId: ctx.biomeId,
        rarityWeights: entry.rarityWeights,
      });
      return { kind: 'item', item };
    }
    case 'material':
      return { kind: 'material', materialId: entry.materialId, count: entry.count };
    case 'gold': {
      const amount = entry.min + Math.floor(rng() * (entry.max - entry.min + 1));
      return { kind: 'gold', amount };
    }
    case 'key':
      return { kind: 'key', keyId: entry.keyId };
  }
}

function clampSkull(v: number): 1 | 2 | 3 {
  if (v < 1) return 1;
  if (v > 3) return 3;
  return v as 1 | 2 | 3;
}

export function mergeDropSpecs(
  a: DropSpecRef | undefined,
  b: DropSpecRef | undefined,
  registry: Record<string, DropSpec>,
): DropSpecRef | undefined {
  if (!a) return b;
  if (!b) return a;
  const specA = resolveSpecRef(a, registry);
  const specB = resolveSpecRef(b, registry);
  return { drops: { pools: [...specA.pools, ...specB.pools] } };
}

export interface ConsumableManifest {
  consumableIds: Set<string>;
  keyIds: Set<string>;
}

export function collectConsumableManifest(
  refs: DropSpecRef[],
  registry: Record<string, DropSpec>,
): ConsumableManifest {
  const consumableIds = new Set<string>();
  const keyIds = new Set<string>();
  for (const ref of refs) {
    const spec = resolveSpecRef(ref, registry);
    for (const pool of spec.pools) {
      for (const entry of pool.entries) {
        if (entry.type === 'consumable') consumableIds.add(entry.consumableId);
        if (entry.type === 'key') keyIds.add(entry.keyId);
      }
    }
  }
  return { consumableIds, keyIds };
}
