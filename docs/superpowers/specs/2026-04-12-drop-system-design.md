# Drop System Redesign

**Date:** 2026-04-12
**Status:** Draft — awaiting review

## Problem

Today every loot-producing source (mobs, rooms, interactables) rolls drops through ad-hoc code. `MobTemplate.lootTable: LootDrop[]` is a flat list where `rollMobLoot` picks exactly one random entry. `room.loot` is a separate flat list of item IDs. Interactables (per `INTERACTABLES.md`) don't have a drop system yet and were going to grow a third shape.

This does not support the drops we want to author:

- "One random between weapon / accessory / consumable, plus a guaranteed handful of gold"
- "Two crafting materials"
- "One guaranteed key + a loot roll"
- "30% chance of a weapon, otherwise nothing"
- "Small chest drops gear one tier worse than the mobs in the room"

It also duplicates authoring: if three fungal mobs share the same drop pattern, we copy the table three times.

## Goals

1. One unified drop specification used by every loot source.
2. Expressive enough to author the patterns above without special cases.
3. Expandable: new entry types (materials, gold, keys) slot in without refactoring existing ones.
4. Shared tables to keep authoring DRY, with inline escapes for one-offs.
5. Pure, testable roller with injectable RNG.
6. No backwards compatibility — content rewritten, old types deleted.

## Non-Goals

- Material storage / crafting system (separate spec).
- Gold spending, vendors, UI treatment beyond a HUD number (separate spec).
- Nested drop tables (`poolId` references inside pools). YAGNI — if authoring pain shows up later, add them.
- Pool-level `chance` field. Use weighted `nothing` entries instead.

## Design Overview

**Pattern:** Minecraft-style loot pools (groups) combined with procedural item generation. Each source owns a `DropSpec` — either inline, or a reference to a named spec in a central registry. A `DropSpec` contains one or more `DropPool`s, each of which is rolled `rolls` times (with replacement). Each roll picks one weighted entry from the pool's entries.

**Key shapes:**

- A source declares `drops: DropSpecRef` — `{ dropSpecId }` or `{ drops: DropSpec }`.
- A `DropPool` has `rolls: number` and `entries: DropEntry[]`.
- `DropEntry` is a discriminated union covering every drop type: consumable reference, generated equipment, crafting material, gold range, dungeon key, or nothing.
- A pure `resolveDrops(ref, ctx)` function returns a `DropResult[]` the game session routes.

## Core Types

Defined in `shared/src/types.ts`. The existing `LootDrop`, `GeneratedLootDrop`, and `ConsumableLootDrop` types are deleted.

```ts
// === Drop specs ===

export type DropSpecRef =
  | { dropSpecId: string }            // lookup in DROP_SPECS registry
  | { drops: DropSpec };              // inline

export interface DropSpec {
  pools: DropPool[];
}

export interface DropPool {
  rolls: number;                      // how many times to roll this pool (with replacement)
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
  weight?: number;                    // default 1
}

export interface GeneratedDropEntry {
  type: 'generated';
  slot: EquipmentSlot;
  // Exactly one of skullRating / skullOffset must be set.
  // - skullRating: absolute tier. Required for room/interactable specs, since
  //   those sources do not carry a skullRating of their own.
  // - skullOffset: relative to source skullRating. Only valid in specs used by
  //   mobs (or any future source with its own tier). Resolver throws if used
  //   in a context without sourceSkullRating.
  skullRating?: 1 | 2 | 3;
  skullOffset?: number;               // added to source skullRating; clamped to [1,3]
  rarityWeights?: Partial<Record<Rarity, number>>;
  weight?: number;
}

export interface MaterialDropEntry {
  type: 'material';
  materialId: string;
  count: number;                      // fixed count; range support can be added later
  weight?: number;
}

export interface GoldDropEntry {
  type: 'gold';
  min: number;                        // inclusive
  max: number;                        // inclusive
  weight?: number;
}

export interface KeyDropEntry {
  type: 'key';
  keyId: string;                      // base key ID (matches room.lockedExits values)
  weight?: number;
}

export interface NothingDropEntry {
  type: 'nothing';
  weight?: number;
}
```

**Design notes:**

- `DropSpecRef` is a union (not `{ dropSpecId?, drops? }`) so a source cannot have both or neither.
- Only **mobs** carry a `skullRating`. Rooms and interactables do not. This means:
  - Generated entries in **mob specs** may use either `skullRating` (absolute) or `skullOffset` (relative to the mob's rating). `skullOffset: 0` means "inherit the mob's rating"; `-1` means "one tier worse".
  - Generated entries in **room / interactable specs** must use absolute `skullRating`. Using `skullOffset` in a room or interactable spec throws at resolution time (no source rating to offset from).
  - A shared spec intended for mobs won't work for rooms unless every generated entry in it uses absolute `skullRating`. In practice, mob specs and room specs will usually be separate.
- `weight` is optional; omitted means 1. Keeps common entries terse.
- `NothingDropEntry` is how a pool expresses "may produce nothing" — no pool-level `chance` field.

## The Roller

New file `server/src/DropResolver.ts`. Pure function, no dependency on `GameSession` or any stateful subsystem. Tests pass a seeded RNG for deterministic assertions.

```ts
import type {
  DropSpec, DropSpecRef, DropEntry, Item, EquipmentSlot, Rarity,
} from '@caverns/shared';
import { generateItem } from '@caverns/itemgen';

export interface DropContext {
  sourceSkullRating?: 1 | 2 | 3;      // only set when the source is a mob; omitted for rooms/interactables
  biomeId: string;
  registry: Record<string, DropSpec>;
  itemsById: Map<string, Item>;
  rng?: () => number;                 // defaults to Math.random
}

export type DropResult =
  | { kind: 'item';     item: Item }
  | { kind: 'gold';     amount: number }
  | { kind: 'material'; materialId: string; count: number }
  | { kind: 'key';      keyId: string };

export function resolveDrops(ref: DropSpecRef, ctx: DropContext): DropResult[] {
  const spec = resolveSpecRef(ref, ctx.registry);
  const results: DropResult[] = [];
  for (const pool of spec.pools) {
    for (let i = 0; i < pool.rolls; i++) {
      const entry = pickWeighted(pool.entries, ctx.rng ?? Math.random);
      const result = resolveEntry(entry, ctx);
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

function resolveEntry(entry: DropEntry, ctx: DropContext): DropResult | null {
  switch (entry.type) {
    case 'nothing':
      return null;
    case 'consumable': {
      const item = ctx.itemsById.get(entry.consumableId);
      if (!item) throw new Error(`Unknown consumableId: ${entry.consumableId}`);
      return { kind: 'item', item };
    }
    case 'generated': {
      // Exactly one of skullRating / skullOffset must be set on the entry.
      let skull: 1 | 2 | 3;
      if (entry.skullRating != null && entry.skullOffset != null) {
        throw new Error(`GeneratedDropEntry cannot set both skullRating and skullOffset`);
      }
      if (entry.skullRating != null) {
        skull = entry.skullRating;
      } else if (entry.skullOffset != null) {
        if (ctx.sourceSkullRating == null) {
          throw new Error(`skullOffset requires sourceSkullRating in context (use skullRating for room/interactable specs)`);
        }
        skull = clampSkull(ctx.sourceSkullRating + entry.skullOffset);
      } else {
        throw new Error(`GeneratedDropEntry must set either skullRating or skullOffset`);
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
      const rng = ctx.rng ?? Math.random;
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
```

**Properties:**

- **Pure.** No I/O, no game state, no side effects. Trivially unit-tested.
- **Fails loud.** Unknown `dropSpecId` / `consumableId` throws at resolution time — registry-level validation (below) catches these at CI instead.
- **Single dispatch.** `GameSession` calls `resolveDrops` in one place and routes the typed `DropResult[]` to the right subsystems.

## Registry

New file `shared/src/dropSpecs.ts`:

```ts
import type { DropSpec } from './types.js';

export const DROP_SPECS: Record<string, DropSpec> = {
  // Mob spec — uses skullOffset so one spec scales across skull-1/2/3 mobs.
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

  fungal_mob_elite: { /* tuned variant of common */ },
  fungal_boss:      { /* guaranteed weapon + gold + key entry */ },

  // Room spec — absolute skullRating since rooms have no tier of their own.
  // Authored per zone depth, so the generator picks the right spec per zone.
  fungal_room_shallow: {
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

  fungal_room_deep: { /* skullRating: 2 or 3 variants */ },

  // Interactable spec — same rule: absolute skullRating.
  small_chest_t1: {
    pools: [
      { rolls: 1, entries: [
        { type: 'generated', slot: 'weapon', skullRating: 1, weight: 1 },
        { type: 'generated', slot: 'armor',  skullRating: 1, weight: 1 },
        { type: 'consumable', consumableId: 'healing_potion', weight: 2 },
      ]},
      { rolls: 1, entries: [{ type: 'gold', min: 5, max: 15 }]},
    ],
  },
};
```

Kept in `shared/` so both server (roller) and any future client preview tooling can reach it.

**Registry validation test** (`dropSpecs.test.ts`):

- Every referenced `consumableId` resolves to an item in the dungeon's items list AND that item has `slot: 'consumable'`. Referencing equipment via `consumableId` fails the test.
- Every `slot` in a `GeneratedDropEntry` is a valid `EquipmentSlot`.
- Every `GeneratedDropEntry` sets exactly one of `skullRating` / `skullOffset` (never both, never neither).
- Every `rolls >= 1` and `entries.length >= 1`.
- Every `weight >= 0`.
- Every gold entry has `min <= max`, both non-negative.
- No `DropSpec` references a starter-gear item ID (starter loadout only — enforced so drops never produce a duplicate starter weapon/offhand).

## Source Type Changes

Every loot-producing source uses the same field name and type.

```ts
// MobTemplate
export interface MobTemplate {
  // ... existing fields ...
  drops: DropSpecRef;                 // was: lootTable: LootDrop[]
}

// Room
export interface Room {
  // ... existing fields ...
  drops?: DropSpecRef;                // was: loot?: RoomLoot[]
}

// Interactable (per INTERACTABLES.md)
export interface Interactable {
  // ... existing fields ...
  drops?: DropSpecRef;
}

// Player — new gold field
export interface Player {
  // ... existing ...
  gold: number;                       // initialized to 0
}
```

New server→client message:

```ts
{ type: 'gold_update'; playerId: string; gold: number }
```

## GameSession Integration

`rollMobLoot` is deleted. `dropLoot` is simplified: everything runs through a new `resolveAndRouteDrops` helper.

```ts
private resolveAndRouteDrops(
  roomId: string,
  ref: DropSpecRef,
  sourceSkullRating?: 1 | 2 | 3,      // set for mob drops; omitted for room/interactable drops
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
        itemsForLootFlow.push({ ...result.item, id: `${result.item.id}_${this.nextLootInstanceId++}` });
        break;
      case 'gold':
        this.awardGoldToRoom(roomId, result.amount);
        break;
      case 'key':
        this.awardKeyToRoomParty(roomId, result.keyId);
        break;
      case 'material':
        // TODO(materials): plug into material storage once that system lands.
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
```

**Helper semantics:**

- `awardGoldToRoom` — each non-downed player in the room receives the full rolled amount (personal gold, not split). Emits one summary log line (`"Everyone gains {n} gold."`) and a `gold_update` message per player.
- `awardKeyToRoomParty` — adds the key to the first living player's party key inventory. Replaces the existing string-match `isKeyItem` branch.
- `runLootFlow` — the existing need/greed / auto-award path, extracted from the tail of `dropLoot` into its own method. When emitting the "X dropped!" text log entries, it reads `room.lootLocation` (if set) to flavor the copy (`"A chest contains X"`, `"Hidden in the room: X"`, default `"X dropped!"`).

`dropLoot` becomes a thin shell:

- **Encounter (mob) drops** — call `resolveAndRouteDrops(roomId, mob.drops, encounter.skullRating)`. The mob's rating is the one valid source rating.
- **Room drops** — call `resolveAndRouteDrops(roomId, room.drops)` with no source rating. Any `generated` entry in the room's spec must use absolute `skullRating`; using `skullOffset` here throws.
- **Interactable drops** — same as room drops: `resolveAndRouteDrops(roomId, interactable.drops)` with no source rating. Called from wherever interactable resolution happens.

## Content Migration

- Rewrite every mob in `shared/src/content.ts` with `drops: { dropSpecId: '...' }` (or inline for one-offs like the boss). Mob specs may use `skullOffset`.
- Rewrite every room with `loot` into a `drops` field. Room specs must use absolute `skullRating` on any generated entries.
- `MobPoolEntry` in `shared/src/data/types.ts` gains a `drops: DropSpecRef` field to match `MobTemplate`.
- Test fixtures (`GameSession.test.ts`, `ProceduralGenerator.test.ts`, etc.) replace `lootTable: []` with `drops: { drops: { pools: [] } }`.
- Delete `LootDrop`, `GeneratedLootDrop`, `ConsumableLootDrop`, `rollMobLoot`, `isKeyItem`. No shims, no re-exports.
- The subsections below cover the non-trivial `ProceduralGenerator` rewrites: key placement, room loot distribution, consumable manifest, and the itemgen boundary.

### Procedural key placement

`ProceduralGenerator.ts` currently places the biome key by pushing onto `keyRoom.loot`:

```ts
if (!keyRoom.loot) keyRoom.loot = [];
keyRoom.loot.push({ itemId: finalBiome.keyItem.id, location: 'hidden' });
```

Under the new system `room.loot` is gone and keys are an explicit entry type. The generator constructs an inline `DropSpec` with a single guaranteed key entry and merges it into the chosen room:

```ts
const keyDropSpec: DropSpec = {
  pools: [{ rolls: 1, entries: [{ type: 'key', keyId: finalBiome.keyItem.id }] }],
};

keyRoom.drops = mergeDropSpecs(keyRoom.drops, { drops: keyDropSpec });
```

`mergeDropSpecs(a, b)` is a small helper (in `DropResolver.ts` or a `dropSpecUtils.ts`) that concatenates the pools of two inline specs into a new inline spec. If either side is a `dropSpecId` reference, it resolves it first via the registry, then concatenates. This is the one place the generator needs to combine authored drops with injected ones — the rest of the system treats `drops` as immutable.

The `location: 'hidden'` modifier does not carry over into the `DropSpec` — the drop-spec system is UI-agnostic. The key room can still set `keyRoom.lootLocation = 'hidden'` (the room-level flavor field described below) so the text log reads "Hidden in the room: {key}". The key-placement path should set `lootLocation` when it's not already set, preferring not to overwrite an existing value.

Also removed: the biome key item's synthetic `rarity: 'unique', slot: 'accessory'` stub in `ProceduralGenerator.ts:714-722`. Under the new system the key is emitted as a `DropResult` with `kind: 'key'` and routed directly to the party key inventory — it never becomes an `Item` in the first place. The biome's `keyItem` definition only needs `{ id, name, description }`.

### Procedural room loot distribution

`ProceduralGenerator.ts:540-571` currently rolls per-room `Math.random() < biome.lootDensity`, rolls a rarity from `biome.defaultLootWeights`, picks an item from `allItems` of that rarity, and pushes onto `room.loot` with a `location` drawn from the room chit's `lootLocations`. The puzzle-room reward path at `ProceduralGenerator.ts:615-626` uses the same rarity-picking logic, always `location: 'hidden'`.

Both of these move into the authored drop-spec system. The generator stops rolling rarities and picking items itself — that logic lives in named `DropSpec`s.

**Generator changes:**

- Delete the `rollRarity` / `candidateItems = allItems.filter(...)` paths in Step 6 and Step 8.
- Biome content gains two new fields:

  ```ts
  interface Biome {
    // ... existing ...
    roomDropSpecId: string;        // assigned to every non-entrance, non-boss room in this biome
    puzzleRewardSpecId: string;    // assigned to puzzle rooms as their reward drops
  }
  ```

- Step 6 becomes a trivial loop: `room.drops = { dropSpecId: biome.roomDropSpecId }`. The generator performs no rarity rolls, no density rolls, no rating math.
- Step 8 (puzzle rewards) becomes: `puzzleRoom.drops = { dropSpecId: biome.puzzleRewardSpecId }`, applied only if the puzzle room has no drops yet (preserves the "guarantee puzzle rooms have reward loot" intent).
- Delete `LOOT_CONFIG.defaultLootWeights`, `LOOT_CONFIG.starterLootWeights`, and `biome.lootDensity`. Drop density and rarity distribution are now expressed purely as weights inside the named spec: `nothing`-entry weight controls density, `generated` entry weights and `rarityWeights` control rarity.

**How is the room's skull tier determined?**

There is no runtime "room rating" calculation. The skull tier of a room's drops is whatever the authored spec says — each `generated` entry inside `biome.roomDropSpecId`'s spec carries an absolute `skullRating`. Early biomes' specs author `skullRating: 1`; late biomes author `skullRating: 2`; the final biome authors `skullRating: 3`. The tier lever lives entirely in content authoring.

If a biome needs to span multiple tiers (e.g. a very long biome where shallow rooms feel weak by the time you reach the deep part), the intended solution is to split the biome into two biome entries in content, each declaring its own `roomDropSpecId`. The zone system already supports biome-per-zone, so this is a content-only change. Adding a per-depth spec table to the biome shape is deliberately deferred until authoring pain demonstrates the need.

**`location` field (chest / floor / hidden):**

The `location` hint does **not** move into the `DropSpec` — the drop system stays UI-agnostic. It becomes a sibling field on the room, populated by the generator from the room chit's `lootLocations`:

```ts
export interface Room {
  // ... existing ...
  drops?: DropSpecRef;
  lootLocation?: 'chest' | 'floor' | 'hidden';   // placement flavor, consumed by UI + text log
}
```

`GameSession` reads `room.lootLocation` when emitting the "X dropped!" text log so the copy still reads "A chest contains…" / "Hidden in the room…" / "On the floor…". Converting these into real interactables is a separate, later refactor (not in this spec).

### Consumable manifest

`usedItemIds` / `collectedItemIds` in `ProceduralGenerator.ts` currently accumulate every item ID actually placed, and the generator returns only those as the dungeon's item manifest (driving which items the client preloads).

Under the new system, generated equipment doesn't commit to specific item IDs at generation time — `itemgen` produces items at drop-resolution time. Only consumables and keys have stable IDs worth listing.

**Replacement:** a `collectConsumableManifest(dungeon)` helper walks every `DropSpecRef` in the dungeon (mob templates, room `drops`, interactable `drops`, and any inline specs), resolves them via `DROP_SPECS`, and returns the set of `consumableId`s and `keyId`s they reference. That set plus all items already referenced by content (starter gear, puzzle items, etc.) becomes the dungeon's item manifest.

Generated equipment is not listed in the manifest — the client doesn't need to preload anything for it, because `itemgen` output is self-describing per drop.

`allItems` in the generator shrinks to consumables only (the item-generation plan already anticipates this). `allUniqueItems` survives only if there are still hand-authored unique items; otherwise it's deleted. Rarity-based filtering over `allItems` is gone.

### itemgen is the only source of equipment drops

All equipment that enters the game as a drop comes from `@caverns/itemgen` via the `generated` entry type. This is a hard rule of the design:

- **`DropEntry.consumable`** — only valid for items with `slot: 'consumable'` in content. The registry validation test (`dropSpecs.test.ts`) asserts that every `consumableId` referenced by a `ConsumableDropEntry` resolves to an item whose slot is `'consumable'`. Referencing a weapon/armor/accessory by `consumableId` is a test failure.
- **`DropEntry.generated`** — the only way to drop equipment. The roller calls `generateItem({ slot, skullRating, biomeId, rarityWeights })` using the source's skull rating (with `skullOffset`) and the `GameSession`'s `biomeId`. itemgen handles rarity rolling, naming, stats, and material palette selection — the drop system does not duplicate any of that.
- **`DropEntry.key`** — emits a `DropResult { kind: 'key' }` which is routed to the party key inventory. Keys are never `Item`s and never go through itemgen.
- **Hand-authored equipment in `content.ts`** — the remaining hand-authored entries (starter weapon, starter offhand in `DRIPPING_HALLS.items`) are for **starter loadouts only**, given at game start in `PlayerManager`. They are never referenced by any `DropSpec`. A lint-level content test asserts no `DropSpec` references these starter-gear IDs.

**Biome palettes drive generated drops.** itemgen already auto-registers biome palettes (`DRIPPING_HALLS_PALETTE`, `STARTER_PALETTE`, etc.) and selects materials/naming from the palette matching `biomeId`. The drop system passes `ctx.biomeId` through unchanged — adding a new biome means registering its palette with itemgen, not touching the drop system.

**`rarityWeights` flow.** `GeneratedDropEntry.rarityWeights` passes through to itemgen's `generateItem` unchanged. This lets a named spec like `fungal_boss` say "this guaranteed weapon rolls rare 60% / epic 40%" without the drop system needing to know how itemgen uses it.

## Testing

- **`DropResolver.test.ts`** — the primary test file.
  - Seeded RNG assertions for each entry type.
  - Weighted distribution test: roll a pool 10,000 times with a seeded RNG, assert observed frequencies within tolerance of expected weights.
  - `skullRating` (absolute) and `skullOffset` (relative) paths both resolve correctly.
  - `skullOffset` clamping at both ends.
  - `skullOffset` without `sourceSkullRating` throws.
  - `skullRating` + `skullOffset` both set throws.
  - Neither set throws.
  - Inline spec and registry lookup both work.
  - Unknown `dropSpecId` / `consumableId` throws.
  - `nothing` entry produces no result.
  - Multi-pool spec aggregates results in order.
  - `mergeDropSpecs` — concatenates two inline specs' pools, resolves a `dropSpecId` side via the registry, preserves order.
- **`dropSpecs.test.ts`** — registry validation: referenced IDs exist, consumables have `slot: 'consumable'`, weights non-negative, gold ranges valid, exactly one skull field set, no starter-gear references.
- **`collectConsumableManifest.test.ts`** — walks a synthetic dungeon with mob / room / interactable specs (inline and registry), returns the expected set of consumable and key IDs.
- **`GameSession.test.ts`** — updated assertions for gold routing (personal, all-players-in-room), key routing (matches old behavior), material TODO log emission, `lootLocation` flavor in text logs, existing loot flow unaffected for plain item drops.
- **`ProceduralGenerator.test.ts`** — updated for the Step 6 / Step 8 rewrite: rooms receive a `drops` field pointing at the biome's `roomDropSpecId`, puzzle rooms use `puzzleRewardSpecId`, no room has `loot` left, `lootLocation` is populated from the chit, no reference to deleted `LOOT_CONFIG.defaultLootWeights`.

## Open Questions

None. All design decisions locked in brainstorming:

- Pool roll semantics: N rolls with replacement.
- Entry types: consumable, generated, material, gold, key, nothing.
- Weights per entry; no pool-level chance; `nothing` entries express drop chance.
- Hybrid registry: `dropSpecId` reference OR inline `drops`.
- Gold is personal (each player gets full amount).
- Materials are a new standalone concept; storage deferred.
- Keys are an explicit entry type; string-match deleted.
- Skull tier: mob drops use `skullOffset` relative to the mob's rating; room and interactable drops use absolute `skullRating` (these sources have no rating of their own).
- Scope: mobs + rooms + interactables, plus full content rewrite. No backwards compat.

## Out of Scope

- Material storage / crafting system.
- Gold spending, vendors, shop UI.
- Nested pool references (shared sub-pools within a spec).
- Context-dependent drops (luck, difficulty, player level).
