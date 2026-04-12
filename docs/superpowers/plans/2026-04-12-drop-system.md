# Drop System Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ad-hoc `LootDrop[]` system with a unified `DropSpec` model that supports pools, weighted entries, generated equipment, consumables, materials, gold, keys, and "nothing" — used by mobs, rooms, and interactables alike.

**Architecture:** New pure `resolveDrops(ref, ctx)` roller in `server/src/DropResolver.ts`. New `DROP_SPECS` registry in `shared/src/dropSpecs.ts`. Every source type (`MobTemplate`, `Room`, `Interactable`, `BiomeDefinition`) carries a `drops: DropSpecRef`. `GameSession.resolveAndRouteDrops` is the single dispatch point that routes `DropResult[]` into the existing loot/gold/key subsystems. All equipment drops flow through `@caverns/itemgen`. No backwards compatibility shims — old types and helpers are deleted.

**Tech Stack:** TypeScript, Vitest, `@caverns/itemgen`, npm workspaces.

**Spec reference:** `docs/superpowers/specs/2026-04-12-drop-system-design.md`

---

## File Structure

**New files:**
- `shared/src/dropSpecs.ts` — named registry (`DROP_SPECS`) + validation helpers
- `server/src/DropResolver.ts` — pure `resolveDrops`, `mergeDropSpecs`, `collectConsumableManifest`
- `server/src/DropResolver.test.ts`
- `shared/src/dropSpecs.test.ts`

**Modified files:**
- `shared/src/types.ts` — add drop-spec types, add `Player.gold`, modify `MobTemplate`, `Room`, delete `LootDrop`/`GeneratedLootDrop`/`ConsumableLootDrop`
- `shared/src/data/types.ts` — modify `BiomeDefinition` (`roomDropSpecId`, `puzzleRewardSpecId`, delete `lootDensity`), modify `MobPoolEntry`
- `shared/src/messages.ts` — add `GoldUpdateMessage`
- `shared/src/content.ts` — rewrite mob `lootTable` → `drops`, delete old equipment items from `items`, update biome with new fields
- `shared/src/index.ts` — export new modules
- `server/src/GameSession.ts` — add `resolveAndRouteDrops`, `awardGoldToRoom`, `awardKeyToRoomParty`, extract `runLootFlow`, delete `rollMobLoot`/`isKeyItem`
- `server/src/PlayerManager.ts` — initialize `Player.gold = 0`, add `addGold`
- `server/src/ProceduralGenerator.ts` — rewrite Steps 6/7/8, delete `usedItemIds` path
- `server/src/ProceduralGenerator.test.ts` — update fixtures and assertions
- `server/src/GameSession.test.ts` — update fixtures and assertions
- `client/src/components/PlayerHUD.tsx` — display gold
- `client/src/store/gameStore.ts` — handle `gold_update` message

**Deleted types/functions:**
- `LootDrop`, `GeneratedLootDrop`, `ConsumableLootDrop` (shared/src/types.ts)
- `rollMobLoot`, `isKeyItem` (server/src/GameSession.ts)
- `LOOT_CONFIG.defaultLootWeights`, `LOOT_CONFIG.starterLootWeights`, `BiomeDefinition.lootDensity`, `Room.loot`, `RoomLoot`
- `rollRarity` paths in `ProceduralGenerator.ts`

---

## Execution order rationale

Phase A builds the new subsystem in isolation with no source-type changes — tests pass continuously. Phase B swaps all source types in one coordinated set of tasks; compilation breaks briefly but every task in the phase resolves it. Phase C cleans up dead code. Phase D wires the client-side gold HUD. Deleting dead code last keeps search-and-replace risk low.

---

## Phase A: New subsystem in isolation

### Task 1: Add drop-spec core types

**Files:**
- Modify: `shared/src/types.ts` (append after existing item types, around line 34)

- [ ] **Step 1: Add the drop-spec types to `shared/src/types.ts`**

Append this block immediately after the `Item` interface (line 33):

```ts
// === Drop Specs ===

export type DropSpecRef =
  | { dropSpecId: string }
  | { drops: DropSpec };

export interface DropSpec {
  pools: DropPool[];
}

export interface DropPool {
  rolls: number;
  entries: DropEntry[];
}

export type DropEntry =
  | ConsumableDropEntry
  | GeneratedDropEntry
  | MaterialDropEntry
  | GoldDropEntry
  | KeyDropEntry
  | NothingDropEntry;

export interface ConsumableDropEntry {
  type: 'consumable';
  consumableId: string;
  weight?: number;
}

export interface GeneratedDropEntry {
  type: 'generated';
  slot: EquipmentSlot;
  skullRating?: 1 | 2 | 3;
  skullOffset?: number;
  rarityWeights?: Partial<Record<Rarity, number>>;
  weight?: number;
}

export interface MaterialDropEntry {
  type: 'material';
  materialId: string;
  count: number;
  weight?: number;
}

export interface GoldDropEntry {
  type: 'gold';
  min: number;
  max: number;
  weight?: number;
}

export interface KeyDropEntry {
  type: 'key';
  keyId: string;
  weight?: number;
}

export interface NothingDropEntry {
  type: 'nothing';
  weight?: number;
}
```

- [ ] **Step 2: Verify shared builds**

Run: `npm run build --workspace=shared`
Expected: PASS — new types don't reference anything outside the file. `LootDrop` and the old loot types still exist and are still used elsewhere — they'll be deleted in Phase C.

- [ ] **Step 3: Commit**

```bash
git add shared/src/types.ts
git commit -m "feat(drops): add DropSpec core types"
```

---

### Task 2: Empty drop-specs registry scaffold

**Files:**
- Create: `shared/src/dropSpecs.ts`
- Modify: `shared/src/index.ts`

- [ ] **Step 1: Create empty registry**

Write `shared/src/dropSpecs.ts`:

```ts
import type { DropSpec } from './types.js';

/**
 * Named drop specs referenced by DropSpecRef.dropSpecId.
 * See docs/superpowers/specs/2026-04-12-drop-system-design.md for authoring rules.
 */
export const DROP_SPECS: Record<string, DropSpec> = {};
```

- [ ] **Step 2: Re-export from shared index**

Modify `shared/src/index.ts` — add this line alongside existing exports:

```ts
export * from './dropSpecs.js';
```

- [ ] **Step 3: Build shared**

Run: `npm run build --workspace=shared`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add shared/src/dropSpecs.ts shared/src/index.ts
git commit -m "feat(drops): add empty DROP_SPECS registry scaffold"
```

---

### Task 3: DropResolver — test scaffolding and pickWeighted

**Files:**
- Create: `server/src/DropResolver.test.ts`
- Create: `server/src/DropResolver.ts`

- [ ] **Step 1: Write failing test for `pickWeighted` via `resolveDrops`**

Create `server/src/DropResolver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { DropSpec, Item } from '@caverns/shared';
import { resolveDrops } from './DropResolver.js';

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
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx vitest run server/src/DropResolver.test.ts`
Expected: FAIL — module `./DropResolver.js` not found.

- [ ] **Step 3: Create `DropResolver.ts` with minimal `resolveDrops` + `pickWeighted`**

Create `server/src/DropResolver.ts`:

```ts
import type {
  DropSpec, DropSpecRef, DropEntry, DropPool, Item,
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
    default:
      throw new Error(`resolveEntry: unsupported type ${(entry as { type: string }).type}`);
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run server/src/DropResolver.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add server/src/DropResolver.ts server/src/DropResolver.test.ts
git commit -m "feat(drops): DropResolver skeleton with pickWeighted + nothing entries"
```

---

### Task 4: Consumable entries

**Files:**
- Modify: `server/src/DropResolver.ts`
- Modify: `server/src/DropResolver.test.ts`

- [ ] **Step 1: Add failing test for consumable entries**

Append to `DropResolver.test.ts`:

```ts
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
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run server/src/DropResolver.test.ts`
Expected: FAIL — throws `unsupported type consumable`.

- [ ] **Step 3: Implement consumable case**

In `DropResolver.ts`, replace the `switch` in `resolveEntry`:

```ts
  switch (entry.type) {
    case 'nothing':
      return null;
    case 'consumable': {
      const item = ctx.itemsById.get(entry.consumableId);
      if (!item) throw new Error(`Unknown consumableId: ${entry.consumableId}`);
      return { kind: 'item', item };
    }
    default:
      throw new Error(`resolveEntry: unsupported type ${(entry as { type: string }).type}`);
  }
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run server/src/DropResolver.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/DropResolver.ts server/src/DropResolver.test.ts
git commit -m "feat(drops): resolve consumable entries"
```

---

### Task 5: Generated equipment entries

**Files:**
- Modify: `server/src/DropResolver.ts`
- Modify: `server/src/DropResolver.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `DropResolver.test.ts`:

```ts
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

  it('uses skullOffset when sourceSkullRating is set, clamping to [1,3]', () => {
    const spec: DropSpec = {
      pools: [{ rolls: 1, entries: [{ type: 'generated', slot: 'armor', skullOffset: 5 }] }],
    };
    const results = resolveDrops(
      { drops: spec },
      { ...emptyCtx, sourceSkullRating: 2, rng: seededRng(1) },
    );
    expect(results).toHaveLength(1);
    // clamp should have pushed 2+5=7 down to 3; we can't easily inspect itemgen output
    // but absence of a throw + slot check confirms the path was taken
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
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run server/src/DropResolver.test.ts`
Expected: FAIL — "unsupported type generated".

- [ ] **Step 3: Implement generated case + clampSkull**

In `DropResolver.ts`, add to the switch in `resolveEntry`:

```ts
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
```

At the bottom of the file, add:

```ts
function clampSkull(v: number): 1 | 2 | 3 {
  if (v < 1) return 1;
  if (v > 3) return 3;
  return v as 1 | 2 | 3;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run server/src/DropResolver.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/DropResolver.ts server/src/DropResolver.test.ts
git commit -m "feat(drops): resolve generated equipment entries"
```

---

### Task 6: Material, gold, key entries

**Files:**
- Modify: `server/src/DropResolver.ts`
- Modify: `server/src/DropResolver.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `DropResolver.test.ts`:

```ts
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
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run server/src/DropResolver.test.ts`
Expected: FAIL — "unsupported type material".

- [ ] **Step 3: Implement the three cases**

Add to the switch in `resolveEntry`:

```ts
    case 'material':
      return { kind: 'material', materialId: entry.materialId, count: entry.count };
    case 'gold': {
      const amount = entry.min + Math.floor(rng() * (entry.max - entry.min + 1));
      return { kind: 'gold', amount };
    }
    case 'key':
      return { kind: 'key', keyId: entry.keyId };
```

Remove the `default:` throw branch — the union is now exhaustive.

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run server/src/DropResolver.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/DropResolver.ts server/src/DropResolver.test.ts
git commit -m "feat(drops): resolve material/gold/key entries"
```

---

### Task 7: Registry lookup and weighted distribution test

**Files:**
- Modify: `server/src/DropResolver.test.ts`

- [ ] **Step 1: Add failing tests for registry lookup**

Append to `DropResolver.test.ts`:

```ts
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
    // Expected ratio 3:1. Generous tolerance.
    const ratio = ones / twos;
    expect(ratio).toBeGreaterThan(2.5);
    expect(ratio).toBeLessThan(3.5);
  });
```

- [ ] **Step 2: Run, verify pass**

Registry lookup is already implemented; these should pass immediately.

Run: `npx vitest run server/src/DropResolver.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 3: Commit**

```bash
git add server/src/DropResolver.test.ts
git commit -m "test(drops): registry lookup and distribution coverage"
```

---

### Task 8: `mergeDropSpecs` helper

**Files:**
- Modify: `server/src/DropResolver.ts`
- Modify: `server/src/DropResolver.test.ts`

- [ ] **Step 1: Add failing test**

Append to `DropResolver.test.ts`:

```ts
import { mergeDropSpecs } from './DropResolver.js';

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
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run server/src/DropResolver.test.ts`
Expected: FAIL — `mergeDropSpecs` not exported.

- [ ] **Step 3: Implement `mergeDropSpecs`**

Append to `DropResolver.ts`:

```ts
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
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run server/src/DropResolver.test.ts`
Expected: PASS (17 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/DropResolver.ts server/src/DropResolver.test.ts
git commit -m "feat(drops): mergeDropSpecs helper"
```

---

### Task 9: `collectConsumableManifest` helper

**Files:**
- Modify: `server/src/DropResolver.ts`
- Modify: `server/src/DropResolver.test.ts`

- [ ] **Step 1: Add failing test**

Append to `DropResolver.test.ts`:

```ts
import { collectConsumableManifest } from './DropResolver.js';

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
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run server/src/DropResolver.test.ts`
Expected: FAIL — `collectConsumableManifest` not exported.

- [ ] **Step 3: Implement**

Append to `DropResolver.ts`:

```ts
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
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run server/src/DropResolver.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/DropResolver.ts server/src/DropResolver.test.ts
git commit -m "feat(drops): collectConsumableManifest helper"
```

---

## Phase B: Swap sources, migrate content, integrate

Phase B introduces breaking type changes. Several tasks will leave the build broken until the phase completes. Run `npm run build` only at the end of Task 15. Within the phase, rely on targeted `vitest` runs.

### Task 10: Player gold field and gold_update message

**Files:**
- Modify: `shared/src/types.ts`
- Modify: `shared/src/messages.ts`
- Modify: `server/src/PlayerManager.ts`

- [ ] **Step 1: Add `gold` to `Player`**

In `shared/src/types.ts`, find the `Player` interface (line ~176) and add after `name`:

```ts
  gold: number;
```

- [ ] **Step 2: Add `GoldUpdateMessage` and add to the `ServerMessage` union**

In `shared/src/messages.ts`, add:

```ts
export interface GoldUpdateMessage {
  type: 'gold_update';
  playerId: string;
  gold: number;
}
```

And add `| GoldUpdateMessage` to the `ServerMessage` union (search for existing `PlayerUpdateMessage` and add alongside).

- [ ] **Step 3: Initialize `gold: 0` when creating a player**

In `server/src/PlayerManager.ts`, find where `Player` objects are constructed (search for `className:`). Add `gold: 0,` alongside other fields.

- [ ] **Step 4: Add `addGold` method**

Append a method to `PlayerManager`:

```ts
  addGold(playerId: string, amount: number): number {
    const player = this.players.get(playerId);
    if (!player) return 0;
    player.gold += amount;
    return player.gold;
  }
```

- [ ] **Step 5: Commit (build may fail; that's expected — Phase B is mid-flight)**

```bash
git add shared/src/types.ts shared/src/messages.ts server/src/PlayerManager.ts
git commit -m "feat(drops): add Player.gold and gold_update message"
```

---

### Task 11: Swap MobTemplate and Room to `drops`

**Files:**
- Modify: `shared/src/types.ts`
- Modify: `shared/src/data/types.ts`

- [ ] **Step 1: Replace `MobTemplate.lootTable` with `drops`**

In `shared/src/types.ts`, find `MobTemplate` (line ~140) and replace:

```ts
  lootTable: LootDrop[];
```

with:

```ts
  drops: DropSpecRef;
```

- [ ] **Step 2: Replace `Room.loot` with `drops` + `lootLocation`**

In `shared/src/types.ts`, find `Room` (line ~110) and replace the `loot?: RoomLoot[]` field (if present) with:

```ts
  drops?: DropSpecRef;
  lootLocation?: 'chest' | 'floor' | 'hidden';
```

Delete the `RoomLoot` interface if it exists as a standalone type.

- [ ] **Step 3: Update `MobPoolEntry`**

In `shared/src/data/types.ts`, replace `lootTable: LootDrop[]` with:

```ts
  drops: DropSpecRef;
```

Also in the import line at top, swap `LootDrop` for `DropSpecRef`.

- [ ] **Step 4: Update `BiomeDefinition`**

In `shared/src/data/types.ts`, modify `BiomeDefinition`:
- Delete `lootDensity: number;`
- Add `roomDropSpecId: string;`
- Add `puzzleRewardSpecId: string;`

- [ ] **Step 5: Commit (build still breaks; resolved by later tasks)**

```bash
git add shared/src/types.ts shared/src/data/types.ts
git commit -m "feat(drops): swap MobTemplate/Room/Biome to DropSpecRef"
```

---

### Task 12: Populate DROP_SPECS registry with fungal biome specs

**Files:**
- Modify: `shared/src/dropSpecs.ts`

- [ ] **Step 1: Add the fungal biome specs**

Replace the contents of `shared/src/dropSpecs.ts`:

```ts
import type { DropSpec } from './types.js';

export const DROP_SPECS: Record<string, DropSpec> = {
  // Mob specs (use skullOffset so one spec scales across tiers)
  fungal_mob_common: {
    pools: [
      { rolls: 1, entries: [
        { type: 'generated', slot: 'weapon',    skullOffset: 0, weight: 2 },
        { type: 'generated', slot: 'armor',     skullOffset: 0, weight: 2 },
        { type: 'generated', slot: 'accessory', skullOffset: 0, weight: 1 },
        { type: 'nothing',                                       weight: 5 },
      ]},
      { rolls: 1, entries: [
        { type: 'consumable', consumableId: 'healing_potion', weight: 1 },
        { type: 'nothing',                                     weight: 3 },
      ]},
      { rolls: 1, entries: [
        { type: 'gold', min: 2, max: 8 },
      ]},
    ],
  },

  fungal_mob_elite: {
    pools: [
      { rolls: 1, entries: [
        { type: 'generated', slot: 'weapon',    skullOffset: 0, weight: 3 },
        { type: 'generated', slot: 'armor',     skullOffset: 0, weight: 3 },
        { type: 'generated', slot: 'accessory', skullOffset: 0, weight: 2 },
        { type: 'nothing',                                       weight: 2 },
      ]},
      { rolls: 1, entries: [
        { type: 'consumable', consumableId: 'healing_potion' },
      ]},
      { rolls: 1, entries: [
        { type: 'gold', min: 8, max: 20 },
      ]},
    ],
  },

  fungal_boss: {
    pools: [
      { rolls: 1, entries: [
        { type: 'generated', slot: 'weapon', skullRating: 3,
          rarityWeights: { rare: 60, legendary: 40 } },
      ]},
      { rolls: 1, entries: [
        { type: 'generated', slot: 'armor', skullRating: 3,
          rarityWeights: { rare: 60, legendary: 40 } },
      ]},
      { rolls: 1, entries: [
        { type: 'gold', min: 40, max: 80 },
      ]},
    ],
  },

  // Room specs (absolute skullRating; rooms have no tier of their own)
  fungal_room_common: {
    pools: [
      { rolls: 1, entries: [
        { type: 'generated', slot: 'weapon', skullRating: 1, weight: 1 },
        { type: 'generated', slot: 'armor',  skullRating: 1, weight: 1 },
        { type: 'consumable', consumableId: 'healing_potion', weight: 2 },
        { type: 'nothing',                                     weight: 4 },
      ]},
      { rolls: 1, entries: [{ type: 'gold', min: 3, max: 10 }]},
    ],
  },

  fungal_puzzle_reward: {
    pools: [
      { rolls: 1, entries: [
        { type: 'generated', slot: 'weapon',    skullRating: 2, weight: 1 },
        { type: 'generated', slot: 'armor',     skullRating: 2, weight: 1 },
        { type: 'generated', slot: 'accessory', skullRating: 2, weight: 1 },
      ]},
      { rolls: 1, entries: [{ type: 'gold', min: 10, max: 25 }]},
    ],
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add shared/src/dropSpecs.ts
git commit -m "feat(drops): populate DROP_SPECS with fungal biome specs"
```

---

### Task 13: Registry validation test

**Files:**
- Create: `shared/src/dropSpecs.test.ts`

- [ ] **Step 1: Write validation test**

Create `shared/src/dropSpecs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DROP_SPECS } from './dropSpecs.js';
import { DRIPPING_HALLS } from './content.js';
import type { EquipmentSlot } from './types.js';

const VALID_SLOTS: EquipmentSlot[] = ['weapon', 'offhand', 'armor', 'accessory'];

describe('DROP_SPECS registry', () => {
  const consumableIds = new Set(
    DRIPPING_HALLS.items.filter((i) => i.slot === 'consumable').map((i) => i.id),
  );
  const starterGearIds = new Set(
    DRIPPING_HALLS.items.filter((i) => i.slot !== 'consumable').map((i) => i.id),
  );

  for (const [specId, spec] of Object.entries(DROP_SPECS)) {
    describe(`spec "${specId}"`, () => {
      it('has at least one pool', () => {
        expect(spec.pools.length).toBeGreaterThanOrEqual(1);
      });

      for (let i = 0; i < spec.pools.length; i++) {
        const pool = spec.pools[i];
        it(`pool[${i}] has rolls >= 1 and at least one entry`, () => {
          expect(pool.rolls).toBeGreaterThanOrEqual(1);
          expect(pool.entries.length).toBeGreaterThanOrEqual(1);
        });

        for (let j = 0; j < pool.entries.length; j++) {
          const entry = pool.entries[j];
          it(`pool[${i}].entries[${j}] has non-negative weight`, () => {
            expect(entry.weight ?? 1).toBeGreaterThanOrEqual(0);
          });

          if (entry.type === 'consumable') {
            it(`pool[${i}].entries[${j}] references a valid consumable`, () => {
              expect(consumableIds.has(entry.consumableId)).toBe(true);
              expect(starterGearIds.has(entry.consumableId)).toBe(false);
            });
          }
          if (entry.type === 'generated') {
            it(`pool[${i}].entries[${j}] has valid slot`, () => {
              expect(VALID_SLOTS).toContain(entry.slot);
            });
            it(`pool[${i}].entries[${j}] sets exactly one of skullRating/skullOffset`, () => {
              const hasAbs = entry.skullRating != null;
              const hasOff = entry.skullOffset != null;
              expect(hasAbs !== hasOff).toBe(true);
            });
          }
          if (entry.type === 'gold') {
            it(`pool[${i}].entries[${j}] has min <= max and non-negative`, () => {
              expect(entry.min).toBeGreaterThanOrEqual(0);
              expect(entry.max).toBeGreaterThanOrEqual(entry.min);
            });
          }
        }
      }
    });
  }
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run shared/src/dropSpecs.test.ts`
Expected: Depends on content migration status. If content still references old `LootDrop`, the build fails before tests run — that's fine for now; Task 14 resolves it.

- [ ] **Step 3: Commit**

```bash
git add shared/src/dropSpecs.test.ts
git commit -m "test(drops): DROP_SPECS registry validation"
```

---

### Task 14: Rewrite DRIPPING_HALLS mob and room content

**Files:**
- Modify: `shared/src/content.ts`

- [ ] **Step 1: Replace every mob `lootTable` with `drops`**

For each mob in `DRIPPING_HALLS.mobs`, replace:

```ts
lootTable: [{ slot: 'weapon', skullRating: 1 }, ...],
```

with:

```ts
drops: { dropSpecId: 'fungal_mob_common' }, // use fungal_mob_elite for skull-2 mobs; inline fungal_boss for the boss
```

The boss mob specifically gets `drops: { dropSpecId: 'fungal_boss' }`.

- [ ] **Step 2: Replace every `room.loot` with `drops` + `lootLocation`**

For each room in `DRIPPING_HALLS.rooms` that had `loot: [...]`, replace with:

```ts
drops: { dropSpecId: 'fungal_room_common' },
lootLocation: 'floor', // preserve whatever location the room originally used
```

If a room had no `loot`, leave `drops` unset.

- [ ] **Step 3: Update `BiomeDefinition`**

In the biome definition section of `content.ts`, remove `lootDensity: <n>` and add:

```ts
roomDropSpecId: 'fungal_room_common',
puzzleRewardSpecId: 'fungal_puzzle_reward',
```

- [ ] **Step 4: Remove equipment items from `items`**

Delete every entry from `DRIPPING_HALLS.items` whose `slot !== 'consumable'` EXCEPT the starter weapon and starter offhand (which are referenced by `PlayerManager` for starter loadouts). Verify the starter IDs by searching `grep -n starter server/src/PlayerManager.ts shared/src/content.ts`.

- [ ] **Step 5: Run shared tests**

Run: `npx vitest run shared/src/dropSpecs.test.ts shared/src/content.test.ts`
Expected: Registry test passes. `content.test.ts` may still fail on the old `lootTable` type-check test — if so, delete that specific test block (the generic mob-validity test); the new registry validation covers it.

- [ ] **Step 6: Commit**

```bash
git add shared/src/content.ts shared/src/content.test.ts
git commit -m "feat(drops): migrate DRIPPING_HALLS content to DropSpec"
```

---

### Task 15: GameSession integration

**Files:**
- Modify: `server/src/GameSession.ts`

- [ ] **Step 1: Delete `rollMobLoot` and `isKeyItem`**

Search for `private rollMobLoot` and `private isKeyItem` in `server/src/GameSession.ts` and delete both methods entirely.

- [ ] **Step 2: Add imports**

At the top of `GameSession.ts`, add:

```ts
import { resolveDrops, type DropResult } from './DropResolver.js';
import { DROP_SPECS } from '@caverns/shared';
import type { DropSpecRef } from '@caverns/shared';
```

Remove imports of `LootDrop`, `ConsumableLootDrop`, `GeneratedLootDrop`, and the direct `generateItem` import if only used by `rollMobLoot`.

- [ ] **Step 3: Add `resolveAndRouteDrops`**

Add this method to `GameSession`:

```ts
private resolveAndRouteDrops(
  roomId: string,
  ref: DropSpecRef,
  sourceSkullRating?: 1 | 2 | 3,
): void {
  const results = resolveDrops(ref, {
    sourceSkullRating,
    biomeId: this.biomeId,
    registry: DROP_SPECS,
    itemsById: this.items,
  });

  const itemsForLootFlow: Item[] = [];
  for (const result of results) {
    switch (result.kind) {
      case 'item':
        itemsForLootFlow.push({
          ...result.item,
          id: `${result.item.id}_${this.nextLootInstanceId++}`,
        });
        break;
      case 'gold':
        this.awardGoldToRoom(roomId, result.amount);
        break;
      case 'key':
        this.awardKeyToRoomParty(roomId, result.keyId);
        break;
      case 'material':
        this.broadcastToRoom(roomId, {
          type: 'text_log',
          message: `${result.count}× ${result.materialId} dropped (not yet collectible)`,
          logType: 'loot',
        });
        break;
    }
  }

  if (itemsForLootFlow.length > 0) {
    this.runLootFlow(roomId, itemsForLootFlow);
  }
}

private awardGoldToRoom(roomId: string, amount: number): void {
  const playerIds = this.playerManager
    .getPlayersInRoom(roomId)
    .filter((p) => p.status !== 'downed')
    .map((p) => p.id);
  if (playerIds.length === 0) return;
  for (const pid of playerIds) {
    const newTotal = this.playerManager.addGold(pid, amount);
    this.sendToPlayer(pid, { type: 'gold_update', playerId: pid, gold: newTotal });
  }
  this.broadcastToRoom(roomId, {
    type: 'text_log',
    message: `Everyone gains ${amount} gold.`,
    logType: 'loot',
  });
}

private awardKeyToRoomParty(roomId: string, keyId: string): void {
  const playerIds = this.playerManager
    .getPlayersInRoom(roomId)
    .filter((p) => p.status !== 'downed')
    .map((p) => p.id);
  if (playerIds.length > 0) {
    this.addKeyToParty(playerIds[0], keyId);
  }
}
```

- [ ] **Step 4: Extract `runLootFlow` from the existing `dropLoot`**

Find the existing `private dropLoot(roomId: string)` method. Extract the portion that handles `regularItems` (the need/greed prompt vs auto-award branching) into a new method:

```ts
private runLootFlow(roomId: string, regularItems: Item[]): void {
  if (regularItems.length === 0) return;
  const playerIds = this.playerManager
    .getPlayersInRoom(roomId)
    .filter((p) => p.status !== 'downed')
    .map((p) => p.id);
  if (playerIds.length === 0) return;

  const room = this.rooms.get(roomId);
  const location = room?.lootLocation ?? 'floor';
  const prefix =
    location === 'chest' ? 'A chest contains' :
    location === 'hidden' ? 'Hidden in the room:' :
    'On the floor:';

  for (const item of regularItems) {
    this.broadcastToRoom(roomId, {
      type: 'text_log',
      message: `${prefix} {${item.rarity}:${item.name}}`,
      logType: 'loot',
    });
  }

  // ... existing need/greed vs auto-award branching, using playerIds and regularItems
}
```

Copy the existing need/greed / auto-award branching code from `dropLoot` into `runLootFlow` after the text-log loop. Remove that code from `dropLoot`.

- [ ] **Step 5: Rewrite `dropLoot`**

Replace the body of `dropLoot` with:

```ts
private dropLoot(roomId: string): void {
  const room = this.rooms.get(roomId);
  if (!room) return;

  if (room.encounter) {
    const mob = this.mobs.get(room.encounter.mobId);
    if (mob) {
      this.resolveAndRouteDrops(roomId, mob.drops, room.encounter.skullRating);
    }
  }

  if (room.drops) {
    this.resolveAndRouteDrops(roomId, room.drops);
  }
}
```

- [ ] **Step 6: Build and run server tests**

Run: `npm run build --workspace=shared && npm run build --workspace=server && npx vitest run --config server/vitest.config.ts 2>&1 | tail -40`
Expected: Compilation passes. Tests may still fail in `ProceduralGenerator.test.ts` and `GameSession.test.ts` — addressed in the next tasks.

- [ ] **Step 7: Commit**

```bash
git add server/src/GameSession.ts
git commit -m "feat(drops): GameSession.resolveAndRouteDrops and gold/key/material routing"
```

---

### Task 16: ProceduralGenerator — key placement rewrite

**Files:**
- Modify: `server/src/ProceduralGenerator.ts`

- [ ] **Step 1: Replace the key placement block**

In `ProceduralGenerator.ts`, find the block around line 573-583:

```ts
if (!keyRoom.loot) keyRoom.loot = [];
keyRoom.loot.push({ itemId: finalBiome.keyItem.id, location: 'hidden' });
usedItemIds.add(finalBiome.keyItem.id);
```

Replace with:

```ts
const keyDropSpec: DropSpec = {
  pools: [{ rolls: 1, entries: [{ type: 'key', keyId: finalBiome.keyItem.id }] }],
};
keyRoom.drops = mergeDropSpecs(keyRoom.drops, { drops: keyDropSpec }, DROP_SPECS);
if (!keyRoom.lootLocation) keyRoom.lootLocation = 'hidden';
```

At the top of the file, add imports:

```ts
import { mergeDropSpecs } from './DropResolver.js';
import { DROP_SPECS, type DropSpec } from '@caverns/shared';
```

- [ ] **Step 2: Delete the synthetic key Item stub**

Find lines 713-723 (the block that pushes a synthetic `Item` with `rarity: 'unique'` into `usedItemsList`) and delete it. The key no longer needs to be an `Item`.

- [ ] **Step 3: Commit**

```bash
git add server/src/ProceduralGenerator.ts
git commit -m "feat(drops): procedural key placement via DropSpec"
```

---

### Task 17: ProceduralGenerator — room loot distribution rewrite

**Files:**
- Modify: `server/src/ProceduralGenerator.ts`

- [ ] **Step 1: Replace Step 6 (room loot distribution)**

Find the `// 6. Distribute loot` block (around lines 533-571). Replace the entire block with:

```ts
// 6. Assign room drop specs
for (const room of allRooms) {
  if (room.type === 'boss') continue;
  if (room.id === entranceRoomId) continue;
  const biome = getBiomeForRoom(room, biomes, zoneEntries, zoneCount);
  room.drops = { dropSpecId: biome.roomDropSpecId };

  // Preserve location flavor from the room chit, if any.
  const chitForRoom = allRoomChits.find((c) => room.id.startsWith(c.id + '_'));
  if (chitForRoom && chitForRoom.lootLocations.length > 0) {
    room.lootLocation = pick(chitForRoom.lootLocations) as 'chest' | 'floor' | 'hidden';
  }
}
```

- [ ] **Step 2: Delete `rollRarity`, `defaultRarityWeights`, `starterRarityWeights` declarations**

Delete the lines that declare `defaultRarityWeights` and `starterRarityWeights` (just above the old Step 6). Delete the `rollRarity` function at the bottom of the file (around line 911).

- [ ] **Step 3: Commit**

```bash
git add server/src/ProceduralGenerator.ts
git commit -m "feat(drops): procedural room loot via biome roomDropSpecId"
```

---

### Task 18: ProceduralGenerator — puzzle reward rewrite

**Files:**
- Modify: `server/src/ProceduralGenerator.ts`

- [ ] **Step 1: Replace puzzle reward block**

Find the puzzle-reward block (around lines 615-626):

```ts
if (!puzzleRoom.loot || puzzleRoom.loot.length === 0) {
  // ... rarity roll, allItems filter, push onto puzzleRoom.loot
}
```

Replace with:

```ts
if (!puzzleRoom.drops) {
  puzzleRoom.drops = { dropSpecId: biome.puzzleRewardSpecId };
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/ProceduralGenerator.ts
git commit -m "feat(drops): puzzle rewards via biome puzzleRewardSpecId"
```

---

### Task 19: ProceduralGenerator — manifest cleanup

**Files:**
- Modify: `server/src/ProceduralGenerator.ts`

- [ ] **Step 1: Collect the consumable manifest instead of `usedItemIds`**

Find the `usedItemIds` set and the loop that builds `usedItemsList` (around lines 700-723). Replace with:

```ts
// Collect every DropSpecRef in the dungeon and resolve its consumable/key references.
const allDropRefs: DropSpecRef[] = [];
for (const room of allRooms) {
  if (room.drops) allDropRefs.push(room.drops);
}
for (const mob of usedMobs) {
  if (mob.drops) allDropRefs.push(mob.drops);
}
const manifest = collectConsumableManifest(allDropRefs, DROP_SPECS);

const usedItemsList: Item[] = [];
for (const id of manifest.consumableIds) {
  const item = allItems.find((i) => i.id === id);
  if (item) usedItemsList.push(item);
}
// Starter gear is always needed, regardless of drops.
for (const id of STARTER_ITEM_IDS) {
  const item = allItems.find((i) => i.id === id);
  if (item && !usedItemsList.find((u) => u.id === id)) usedItemsList.push(item);
}
```

Define `STARTER_ITEM_IDS` as a top-level constant near the top of the file (or import it from wherever starter gear is configured):

```ts
const STARTER_ITEM_IDS = ['starter_weapon', 'starter_offhand'] as const;
```

Adjust the actual starter IDs to match the real ones in `content.ts` if different.

At the top of the file, add:

```ts
import { collectConsumableManifest } from './DropResolver.js';
import type { DropSpecRef } from '@caverns/shared';
```

`usedMobs` must track the `MobTemplate`s actually placed — if the existing code uses `usedMobIds: Set<string>`, build a parallel `usedMobs: MobTemplate[]` or resolve from IDs at manifest time.

- [ ] **Step 2: Delete `usedItemIds` and related tracking**

Remove all remaining references to `usedItemIds` and the old item-collection loop.

- [ ] **Step 3: Run server tests**

Run: `npx vitest run server/src/ProceduralGenerator.test.ts 2>&1 | tail -40`
Expected: Some failures likely; Task 20 updates the test fixtures.

- [ ] **Step 4: Commit**

```bash
git add server/src/ProceduralGenerator.ts
git commit -m "feat(drops): replace usedItemIds with collectConsumableManifest"
```

---

### Task 20: Update server test fixtures

**Files:**
- Modify: `server/src/GameSession.test.ts`
- Modify: `server/src/ProceduralGenerator.test.ts`
- Modify: `server/src/DungeonValidator.test.ts` (if present)

- [ ] **Step 1: Replace every `lootTable: []` with `drops: { drops: { pools: [] } }`**

Search: `grep -rn 'lootTable:' server/src/`

For every match in a `*.test.ts` file (mob/mob-pool fixtures), replace:

```ts
lootTable: []
```

with:

```ts
drops: { drops: { pools: [] } }
```

And delete any `location: 'floor'` / `loot: [...]` entries in room fixtures — replace with `drops: { drops: { pools: [] } }` if the test needs to verify loot, otherwise omit.

- [ ] **Step 2: Update biome fixtures in generator tests**

For every `BiomeDefinition` literal in `ProceduralGenerator.test.ts`, remove `lootDensity` and add:

```ts
roomDropSpecId: 'fungal_room_common',
puzzleRewardSpecId: 'fungal_puzzle_reward',
```

- [ ] **Step 3: Add gold-routing test to `GameSession.test.ts`**

Find an existing combat-victory test in the file and copy its setup as a template. Add this new test next to it:

```ts
it('awards gold to every non-downed player in the room when a mob drops gold', () => {
  const session = makeTestSession({
    mobs: [{
      id: 'gold_mob',
      name: 'Gold Mob',
      description: '',
      skullRating: 1,
      maxHp: 1,
      damage: 1,
      defense: 0,
      initiative: 1,
      drops: {
        drops: {
          pools: [{ rolls: 1, entries: [{ type: 'gold', min: 10, max: 10 }] }],
        },
      },
    }],
    rooms: [{
      id: 'r1', type: 'normal', name: 'Test', description: '',
      exits: {}, discovered: true,
      encounter: { mobId: 'gold_mob', skullRating: 1 },
    }],
  });

  const p1 = session.addPlayer('p1', 'Alice');
  const p2 = session.addPlayer('p2', 'Bob');
  session.startGame();

  // Drive combat to victory — use whatever helper the existing tests use
  // (e.g. `session.forceVictory('r1')` or repeated `session.submitCombatAction(...)`).
  runCombatToVictory(session, 'r1');

  expect(session.getPlayer('p1').gold).toBe(10);
  expect(session.getPlayer('p2').gold).toBe(10);
  expect(sentMessagesTo(session, 'p1')).toContainEqual(
    expect.objectContaining({ type: 'gold_update', gold: 10 }),
  );
  expect(sentMessagesTo(session, 'p2')).toContainEqual(
    expect.objectContaining({ type: 'gold_update', gold: 10 }),
  );
});
```

`makeTestSession`, `runCombatToVictory`, and `sentMessagesTo` are whatever helpers already exist in `GameSession.test.ts`. Read the top of the file to see the real helper names and adjust the test accordingly — do not introduce new helpers.

- [ ] **Step 4: Run all server tests**

Run: `npx vitest run --config server/vitest.config.ts 2>&1 | tail -60`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/GameSession.test.ts server/src/ProceduralGenerator.test.ts server/src/DungeonValidator.test.ts
git commit -m "test(drops): update server fixtures to DropSpec"
```

---

## Phase C: Delete dead code

### Task 21: Delete old loot types

**Files:**
- Modify: `shared/src/types.ts`
- Modify: `shared/src/content.test.ts`

- [ ] **Step 1: Delete the old loot type definitions**

In `shared/src/types.ts`, delete:

```ts
export interface GeneratedLootDrop { ... }
export interface ConsumableLootDrop { ... }
export type LootDrop = GeneratedLootDrop | ConsumableLootDrop;
```

- [ ] **Step 2: Update `shared/src/content.test.ts`**

Delete any `isConsumableLootDrop` / `isGeneratedLootDrop` helpers and the test block `it('all mob loot tables have valid LootDrop entries', ...)`. The new `dropSpecs.test.ts` covers registry validation.

- [ ] **Step 3: Build everything**

Run: `npm run build 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 4: Run every test suite**

Run: `npx vitest run 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/types.ts shared/src/content.test.ts
git commit -m "chore(drops): delete LootDrop/GeneratedLootDrop/ConsumableLootDrop"
```

---

### Task 22: Delete LOOT_CONFIG weight tables

**Files:**
- Modify: whichever file defines `LOOT_CONFIG` (search first)

- [ ] **Step 1: Find and delete `defaultLootWeights` / `starterLootWeights`**

Run: `grep -rn 'defaultLootWeights\|starterLootWeights' shared server client`

In each file matching, delete the weight-table definitions and any remaining references. If a file becomes empty, delete the file and remove it from its parent `index.ts`.

- [ ] **Step 2: Build and test**

Run: `npm run build 2>&1 | tail -10 && npx vitest run 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(drops): delete unused LOOT_CONFIG rarity weight tables"
```

---

## Phase D: Client gold HUD

### Task 23: Handle `gold_update` in the store

**Files:**
- Modify: `client/src/store/gameStore.ts`

- [ ] **Step 1: Add handler to `handleServerMessage`**

Find the `handleServerMessage` switch statement. Add:

```ts
case 'gold_update': {
  const player = state.players.find((p) => p.id === message.playerId);
  if (player) player.gold = message.gold;
  return { ...state };
}
```

If the store uses Immer or a different pattern, match the existing conventions in the file.

- [ ] **Step 2: Commit**

```bash
git add client/src/store/gameStore.ts
git commit -m "feat(drops): handle gold_update in game store"
```

---

### Task 24: Display gold in `PlayerHUD`

**Files:**
- Modify: `client/src/components/PlayerHUD.tsx`

- [ ] **Step 1: Render the gold value**

In `PlayerHUD.tsx`, find the JSX that renders the player's HP and stats. Add a gold row alongside, matching the existing styling pattern:

```tsx
<div className="player-hud__gold">
  <span className="player-hud__gold-label">GOLD</span>
  <span className="player-hud__gold-value">{player.gold}</span>
</div>
```

No new CSS required if the existing `player-hud__*` classes cover it; otherwise follow the neighboring pattern.

- [ ] **Step 2: Build the client**

Run: `npm run build --workspace=client 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 3: Manual sanity check**

Start the dev server and join a game:

```bash
npm run dev:server
# separate terminal:
npm run dev:client
```

Join as a single player, enter combat, defeat a mob whose drops spec includes gold, and verify the HUD updates.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/PlayerHUD.tsx
git commit -m "feat(drops): display gold in PlayerHUD"
```

---

## Final verification

### Task 25: Full build and test sweep

- [ ] **Step 1: Clean build**

Run: `npm run build 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 2: Full test run**

Run: `npx vitest run 2>&1 | tail -40`
Expected: PASS — all test files, including the new `DropResolver.test.ts`, `dropSpecs.test.ts`, and updated `GameSession.test.ts` / `ProceduralGenerator.test.ts`.

- [ ] **Step 3: Grep for dead references**

Run: `grep -rn 'LootDrop\|rollMobLoot\|isKeyItem\|lootTable\|rollRarity\|defaultLootWeights\|starterLootWeights\|lootDensity' shared server client`
Expected: No matches (or only matches in this plan document / the spec doc).

- [ ] **Step 4: End-to-end smoke**

Start dev server and client, join as two players, complete at least one combat in the generated fungal biome, verify:
- Items drop via the loot prompt.
- Gold credits both players.
- The key from a key room gets added to the party.
- No console errors on server or client.

- [ ] **Step 5: Commit (if any fixups were needed)**

```bash
git add -A
git commit -m "chore(drops): final cleanup after verification sweep"
```
