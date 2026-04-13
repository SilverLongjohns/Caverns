# Shop System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-character town shops with hybrid fixed + rotating stock, reroll-as-gold-sink, and a content-driven `ShopTemplate` system that scales to many shops across multiple towns.

**Architecture:** Shops are static `ShopTemplate`s in shared content, each referencing a `DropSpecRef` that feeds the existing loot pipeline (`resolveDrops` → `generateItem`) to materialize rotating stock. Per-character state lives in a new `character_shop_state` table keyed by `(character_id, shop_id)`, storing the materialized `Item[]` snapshot so prices and availability are stable between open and buy. Rotating stock only changes when the player spends gold to reroll (no time-based refresh). Fixed stock is infinite. Sell-back is a flat per-shop fraction of a pure `priceItem(item)` formula defined once in shared.

**Tech Stack:** TypeScript monorepo (`shared`/`server`/`client`/`itemgen`), Postgres + Kysely, WebSocket discriminated-union messages, React + Zustand, Vitest.

---

## File Structure

**Shared (`shared/src/`):**
- `pricing.ts` (new) — pure `priceItem(item)` + `buyPrice`/`sellPrice` helpers.
- `types.ts` (modify) — add optional `skullRating?: 1|2|3` to `Item`, add `'shop'` to `OverworldInteractable['kind']`, add `shopId?: string` to `OverworldInteractable`.
- `data/shops.ts` (new) — `ShopTemplate` interface + `SHOP_TEMPLATES` registry + shop-specific `DropSpec` entries registered into the existing drop-spec registry.
- `messages.ts` (modify) — add `ShopOpenMessage` (client→server reuses `overworld_interact`), `ShopBuyMessage`, `ShopSellMessage`, `ShopRerollMessage`, `ShopCloseMessage` (client-only), plus server→client `ShopOpenedMessage`, `ShopUpdatedMessage`, `ShopErrorMessage`.
- `overworld.ts` (modify) — place a `starter_general_store` interactable in the town.

**Itemgen (`itemgen/src/`):**
- `generate.ts` (modify) — have `generateItem` stamp `skullRating` onto the returned `Item`.

**Server (`server/src/`):**
- `db/migrations/1744400000_character_shop_state.sql` (new) — create `character_shop_state` table.
- `db/types.ts` (modify) — add `CharacterShopStateTable` and register on `Database`.
- `test-utils/testDb.ts` (modify) — mirror the new table inline.
- `ShopRepository.ts` (new) — `ensure`/`get`/`setRotating` CRUD.
- `ShopRepository.test.ts` (new) — DB round-trip tests (skip when no `DATABASE_URL`).
- `ShopManager.ts` (new) — pure logic: `generateRotating(template, ctx, rng)`, `applyBuy`, `applySell`, `applyReroll`. No DB.
- `ShopManager.test.ts` (new) — unit tests with fixed rng.
- `index.ts` (modify) — instantiate `ShopRepository`, route `overworld_interact` to shop when the standing interactable is `kind: 'shop'`, handle `shop_buy`/`shop_sell`/`shop_reroll`.

**Client (`client/src/`):**
- `hooks/useGameActions.ts` (modify) — add `shopBuy`, `shopSell`, `shopReroll`, `closeShop` senders. `interactOverworld` already exists and is reused to open.
- `store/gameStore.ts` (modify) — add `openShop` state + handlers for `shop_opened`/`shop_updated`/`shop_error`. Clear `openShop` on `dungeon_entered`.
- `components/ShopModal.tsx` (new) — three-section modal: fixed stock, rotating stock (with Reroll button), character inventory + gold for sell.
- `components/WorldView.tsx` (modify) — render `<ShopModal>` alongside `<StashModal>`.
- `App.tsx` (modify) — wire shop action senders into `WorldView` props.
- `styles/index.css` (modify) — `.shop-modal`, `.shop-section`, `.shop-slot`, `.shop-price`, `.shop-reroll-btn`.

---

## Task 1: Pricing module

**Files:**
- Create: `shared/src/pricing.ts`
- Create: `shared/src/pricing.test.ts`
- Modify: `shared/src/index.ts` (add re-export)

- [ ] **Step 1: Write the failing tests**

Create `shared/src/pricing.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { priceItem, buyPrice, sellPrice } from './pricing.js';
import type { Item } from './types.js';

function mkItem(partial: Partial<Item>): Item {
  return {
    id: 'x', name: 'x', description: 'x',
    rarity: 'common', slot: 'weapon', stats: {},
    ...partial,
  };
}

describe('priceItem', () => {
  it('prices a common skull-1 weapon at slotBase * 1.0 * 1.0 = 40', () => {
    expect(priceItem(mkItem({ rarity: 'common', slot: 'weapon', skullRating: 1 }))).toBe(40);
  });

  it('applies rarity multiplier (uncommon = 2.0)', () => {
    expect(priceItem(mkItem({ rarity: 'uncommon', slot: 'weapon', skullRating: 1 }))).toBe(80);
  });

  it('applies skull multiplier (skull 2 = 2.5)', () => {
    expect(priceItem(mkItem({ rarity: 'common', slot: 'weapon', skullRating: 2 }))).toBe(100);
  });

  it('stacks multipliers (rare skull 3 weapon = 40 * 6 * 5 = 1200)', () => {
    expect(priceItem(mkItem({ rarity: 'rare', slot: 'weapon', skullRating: 3 }))).toBe(1200);
  });

  it('defaults skull 1 when item lacks skullRating', () => {
    expect(priceItem(mkItem({ rarity: 'common', slot: 'consumable' }))).toBe(15);
  });

  it('prices all slots at common skull 1', () => {
    expect(priceItem(mkItem({ slot: 'weapon' }))).toBe(40);
    expect(priceItem(mkItem({ slot: 'offhand' }))).toBe(30);
    expect(priceItem(mkItem({ slot: 'armor' }))).toBe(50);
    expect(priceItem(mkItem({ slot: 'accessory' }))).toBe(35);
    expect(priceItem(mkItem({ slot: 'consumable' }))).toBe(15);
  });
});

describe('buyPrice / sellPrice', () => {
  const item = mkItem({ rarity: 'common', slot: 'weapon', skullRating: 1 }); // base 40

  it('buyPrice multiplies by markup and rounds', () => {
    expect(buyPrice(item, 1.0)).toBe(40);
    expect(buyPrice(item, 1.25)).toBe(50);
  });

  it('sellPrice multiplies by sell fraction and rounds', () => {
    expect(sellPrice(item, 0.5)).toBe(20);
    expect(sellPrice(item, 0.4)).toBe(16);
  });

  it('sellPrice is never negative or zero for priced items', () => {
    expect(sellPrice(item, 0.01)).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm test --workspace shared -- pricing
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement pricing**

Create `shared/src/pricing.ts`:

```typescript
import type { Item, ItemSlot, Rarity } from './types.js';

const SLOT_BASE: Record<ItemSlot, number> = {
  weapon: 40,
  offhand: 30,
  armor: 50,
  accessory: 35,
  consumable: 15,
};

const SKULL_MULT: Record<1 | 2 | 3, number> = {
  1: 1.0,
  2: 2.5,
  3: 6.0,
};

const RARITY_MULT: Record<Rarity, number> = {
  common: 1.0,
  uncommon: 2.0,
  rare: 5.0,
  legendary: 12.0,
  unique: 25.0,
};

/** Deterministic base price for an item. No RNG. */
export function priceItem(item: Item): number {
  const skull = (item.skullRating ?? 1) as 1 | 2 | 3;
  return Math.round(
    SLOT_BASE[item.slot] * SKULL_MULT[skull] * RARITY_MULT[item.rarity],
  );
}

export function buyPrice(item: Item, markup: number): number {
  return Math.max(1, Math.round(priceItem(item) * markup));
}

export function sellPrice(item: Item, sellBackPct: number): number {
  return Math.max(1, Math.round(priceItem(item) * sellBackPct));
}
```

- [ ] **Step 4: Add `skullRating` to `Item` in `shared/src/types.ts`**

Find the `Item` interface and add:

```typescript
export interface Item {
  id: string;
  name: string;
  description: string;
  rarity: Rarity;
  slot: ItemSlot;
  stats: ItemStats;
  effect?: string;
  effectParams?: Record<string, number>;
  skullRating?: 1 | 2 | 3;
}
```

- [ ] **Step 5: Re-export from `shared/src/index.ts`**

Add:
```typescript
export * from './pricing.js';
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm test --workspace shared -- pricing
```

Expected: PASS (all 10 tests).

- [ ] **Step 7: Typecheck everything**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm run typecheck
```

Expected: PASS. The new optional `skullRating` field must not break any existing call site.

- [ ] **Step 8: Commit**

```bash
git add shared/src/pricing.ts shared/src/pricing.test.ts shared/src/types.ts shared/src/index.ts
git commit -m "feat(shared): add pure item pricing module"
```

---

## Task 2: Stamp skullRating onto generated items

**Files:**
- Modify: `itemgen/src/generate.ts`
- Modify: `itemgen/src/generate.test.ts` (or add a new one if none)

- [ ] **Step 1: Find the `generateItem` return statement** in `itemgen/src/generate.ts` (currently around line 82):

```typescript
return { id, name, description, rarity, slot, stats };
```

- [ ] **Step 2: Write a failing test**

Find the itemgen test file (`itemgen/src/generate.test.ts` if it exists, else create it) and add:

```typescript
import { describe, it, expect } from 'vitest';
import { generateItem } from './generate.js';

describe('generateItem skullRating stamp', () => {
  it('returns item with matching skullRating', () => {
    const item = generateItem({ slot: 'weapon', skullRating: 2, biomeId: 'cavern', seed: 42 });
    expect(item.skullRating).toBe(2);
  });

  it('skullRating 3 is preserved', () => {
    const item = generateItem({ slot: 'armor', skullRating: 3, biomeId: 'cavern', seed: 99 });
    expect(item.skullRating).toBe(3);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm test --workspace itemgen -- generate
```

Expected: FAIL — `skullRating` is undefined.

- [ ] **Step 4: Modify `generateItem` return**

```typescript
return { id, name, description, rarity, slot, stats, skullRating };
```

- [ ] **Step 5: Run the test**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm test --workspace itemgen -- generate
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add itemgen/src/generate.ts itemgen/src/generate.test.ts
git commit -m "feat(itemgen): stamp skullRating on generated items"
```

---

## Task 3: ShopTemplate content + drop specs

**Files:**
- Create: `shared/src/data/shops.ts`
- Create: `shared/src/data/shops.test.ts`
- Modify: `shared/src/index.ts` (re-export)

- [ ] **Step 1: Write the failing test**

Create `shared/src/data/shops.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SHOP_TEMPLATES, SHOP_DROP_SPECS } from './shops.js';

describe('SHOP_TEMPLATES', () => {
  it('registers starter_general_store', () => {
    const tpl = SHOP_TEMPLATES['starter_general_store'];
    expect(tpl).toBeDefined();
    expect(tpl.id).toBe('starter_general_store');
    expect(tpl.fixedStock.length).toBeGreaterThan(0);
    expect(tpl.rotatingSlotCount).toBeGreaterThan(0);
    expect(tpl.rerollCost).toBeGreaterThan(0);
    expect(tpl.sellBackPct).toBeGreaterThan(0);
    expect(tpl.sellBackPct).toBeLessThanOrEqual(1);
    expect(tpl.buyMarkup).toBeGreaterThan(0);
  });

  it('every template references a valid drop spec id', () => {
    for (const tpl of Object.values(SHOP_TEMPLATES)) {
      expect(SHOP_DROP_SPECS[tpl.rotatingDropSpecId]).toBeDefined();
    }
  });

  it('every fixed-stock consumableId resolves to an item id (string present)', () => {
    for (const tpl of Object.values(SHOP_TEMPLATES)) {
      for (const entry of tpl.fixedStock) {
        expect(typeof entry.consumableId).toBe('string');
        expect(entry.consumableId.length).toBeGreaterThan(0);
      }
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm test --workspace shared -- shops
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `shared/src/data/shops.ts`**

```typescript
import type { DropSpec } from '../types.js';

export interface ShopFixedEntry {
  consumableId: string;
}

export interface ShopTemplate {
  id: string;
  name: string;
  fixedStock: ShopFixedEntry[];
  rotatingDropSpecId: string;
  rotatingSlotCount: number;
  rerollCost: number;
  buyMarkup: number;
  sellBackPct: number;
}

export const SHOP_DROP_SPECS: Record<string, DropSpec> = {
  shop_starter_general: {
    pools: [
      {
        rolls: 1,
        entries: [
          { type: 'generated', slot: 'weapon',    skullRating: 1, weight: 3 },
          { type: 'generated', slot: 'offhand',   skullRating: 1, weight: 2 },
          { type: 'generated', slot: 'armor',     skullRating: 1, weight: 3 },
          { type: 'generated', slot: 'accessory', skullRating: 1, weight: 2 },
        ],
      },
    ],
  },
};

export const SHOP_TEMPLATES: Record<string, ShopTemplate> = {
  starter_general_store: {
    id: 'starter_general_store',
    name: 'General Store',
    fixedStock: [
      { consumableId: 'minor_hp_potion' },
      { consumableId: 'hp_potion' },
    ],
    rotatingDropSpecId: 'shop_starter_general',
    rotatingSlotCount: 4,
    rerollCost: 25,
    buyMarkup: 1.0,
    sellBackPct: 0.5,
  },
};
```

- [ ] **Step 4: Re-export from `shared/src/index.ts`**

Add:
```typescript
export * from './data/shops.js';
```

- [ ] **Step 5: Run tests**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm test --workspace shared -- shops
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/src/data/shops.ts shared/src/data/shops.test.ts shared/src/index.ts
git commit -m "feat(shared): add ShopTemplate registry with starter general store"
```

---

## Task 4: Messages for shop protocol

**Files:**
- Modify: `shared/src/messages.ts`

- [ ] **Step 1: Add client→server messages**

Find the section after `StashWithdrawMessage` and add:

```typescript
export interface ShopBuyMessage {
  type: 'shop_buy';
  shopId: string;
  slotType: 'fixed' | 'rotating';
  index: number;
}

export interface ShopSellMessage {
  type: 'shop_sell';
  shopId: string;
  from: 'inventory' | 'consumables';
  fromIndex: number;
}

export interface ShopRerollMessage {
  type: 'shop_reroll';
  shopId: string;
}
```

- [ ] **Step 2: Add them to the `ClientMessage` union**

```typescript
export type ClientMessage =
  | ...
  | StashDepositMessage
  | StashWithdrawMessage
  | ShopBuyMessage
  | ShopSellMessage
  | ShopRerollMessage;
```

- [ ] **Step 3: Add server→client messages**

Near `StashOpenedMessage`:

```typescript
export interface ShopFixedSlotView {
  consumableId: string;
  item: Item;
  price: number;
}

export interface ShopRotatingSlotView {
  item: Item | null;
  price: number | null;
}

export interface ShopView {
  shopId: string;
  name: string;
  fixed: ShopFixedSlotView[];
  rotating: ShopRotatingSlotView[];
  rerollCost: number;
  sellBackPct: number;
}

export interface ShopOpenedMessage {
  type: 'shop_opened';
  shop: ShopView;
  gold: number;
  character: CharacterItemsView;
}

export interface ShopUpdatedMessage {
  type: 'shop_updated';
  shop: ShopView;
  gold: number;
  character: CharacterItemsView;
}

export interface ShopErrorMessage {
  type: 'shop_error';
  reason: string;
}
```

- [ ] **Step 4: Add to `ServerMessage` union**

```typescript
export type ServerMessage =
  | ...
  | StashOpenedMessage
  | StashUpdatedMessage
  | StashErrorMessage
  | ShopOpenedMessage
  | ShopUpdatedMessage
  | ShopErrorMessage;
```

- [ ] **Step 5: Typecheck**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/src/messages.ts
git commit -m "feat(shared): add shop protocol messages"
```

---

## Task 5: `character_shop_state` migration + db types

**Files:**
- Create: `server/src/db/migrations/1744400000_character_shop_state.sql`
- Modify: `server/src/db/types.ts`
- Modify: `server/test-utils/testDb.ts`

- [ ] **Step 1: Create the migration**

Create `server/src/db/migrations/1744400000_character_shop_state.sql`:

```sql
-- Up Migration

CREATE TABLE character_shop_state (
  character_id   uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  shop_id        text NOT NULL,
  rotating_items jsonb NOT NULL DEFAULT '[]',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, shop_id)
);

-- Down Migration

DROP TABLE IF EXISTS character_shop_state;
```

- [ ] **Step 2: Add `CharacterShopStateTable` in `server/src/db/types.ts`**

```typescript
export interface CharacterShopStateTable {
  character_id: string;
  shop_id: string;
  rotating_items: (Item | null)[];
  created_at: Date;
  updated_at: Date;
}
```

And in the `Database` interface:

```typescript
export interface Database {
  accounts: AccountsTable;
  characters: CharactersTable;
  character_stash: CharacterStashTable;
  character_shop_state: CharacterShopStateTable;
  sessions: SessionsTable;
  worlds: WorldsTable;
  world_members: WorldMembersTable;
}
```

- [ ] **Step 3: Mirror the table inline in `server/test-utils/testDb.ts`**

Find the `CREATE TABLE character_stash` block and append after it, before the closing `` ` ``:

```sql
CREATE TABLE character_shop_state (
  character_id   uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  shop_id        text NOT NULL,
  rotating_items jsonb NOT NULL DEFAULT '[]',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, shop_id)
);
```

- [ ] **Step 4: Typecheck and run existing server tests**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm run typecheck
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm test --workspace server
```

Expected: typecheck PASS, all existing server tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/db/migrations/1744400000_character_shop_state.sql server/src/db/types.ts server/test-utils/testDb.ts
git commit -m "feat(server): add character_shop_state table"
```

---

## Task 6: ShopRepository

**Files:**
- Create: `server/src/ShopRepository.ts`
- Create: `server/src/ShopRepository.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/src/ShopRepository.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Kysely } from 'kysely';
import type { Database } from './db/types.js';
import type { Item } from '@caverns/shared';
import { createTestDb } from '../test-utils/testDb.js';
import { ShopRepository } from './ShopRepository.js';

const hasDb = !!(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL);

describe.skipIf(!hasDb)('ShopRepository', () => {
  let db: Kysely<Database>;
  let cleanup: () => Promise<void>;
  let repo: ShopRepository;
  let characterId: string;

  beforeEach(async () => {
    const made = await createTestDb();
    db = made.db;
    cleanup = made.cleanup;
    repo = new ShopRepository(db);

    const account = await db.insertInto('accounts')
      .values({ auth_provider: 'test', provider_id: 'p1', display_name: 'T' } as never)
      .returning('id').executeTakeFirstOrThrow();
    const char = await db.insertInto('characters')
      .values({
        account_id: account.id,
        world_id: '00000000-0000-0000-0000-000000000000',
        name: 'C', class: 'fighter',
      } as never)
      .returning('id').executeTakeFirstOrThrow();
    characterId = char.id;
  });

  afterEach(() => cleanup());

  it('ensure() creates an empty row if missing', async () => {
    const row = await repo.ensure(characterId, 'starter_general_store');
    expect(row.character_id).toBe(characterId);
    expect(row.shop_id).toBe('starter_general_store');
    expect(row.rotating_items).toEqual([]);
  });

  it('ensure() is idempotent', async () => {
    await repo.ensure(characterId, 'starter_general_store');
    await repo.ensure(characterId, 'starter_general_store');
    const row = await repo.get(characterId, 'starter_general_store');
    expect(row).toBeDefined();
  });

  it('setRotating() round-trips items', async () => {
    const item: Item = {
      id: 'gen_weapon_abc123', name: 'Iron Blade', description: '',
      rarity: 'common', slot: 'weapon', stats: { damage: 3 }, skullRating: 1,
    };
    await repo.ensure(characterId, 'starter_general_store');
    await repo.setRotating(characterId, 'starter_general_store', [item, null, null, null]);
    const row = await repo.get(characterId, 'starter_general_store');
    expect(row.rotating_items).toHaveLength(4);
    expect(row.rotating_items[0]?.id).toBe('gen_weapon_abc123');
    expect(row.rotating_items[1]).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm test --workspace server -- ShopRepository
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `server/src/ShopRepository.ts`**

```typescript
import type { Kysely } from 'kysely';
import type { Item } from '@caverns/shared';
import type { Database, CharacterShopStateTable } from './db/types.js';

export class ShopRepository {
  constructor(private db: Kysely<Database>) {}

  async ensure(characterId: string, shopId: string): Promise<CharacterShopStateTable> {
    await this.db.insertInto('character_shop_state')
      .values({
        character_id: characterId,
        shop_id: shopId,
        rotating_items: JSON.stringify([]) as never,
      } as never)
      .onConflict((oc) => oc.columns(['character_id', 'shop_id']).doNothing())
      .execute();
    return this.get(characterId, shopId);
  }

  async get(characterId: string, shopId: string): Promise<CharacterShopStateTable> {
    const row = await this.db.selectFrom('character_shop_state')
      .selectAll()
      .where('character_id', '=', characterId)
      .where('shop_id', '=', shopId)
      .executeTakeFirst();
    if (!row) throw new Error(`No shop state for ${characterId} / ${shopId}`);
    return row;
  }

  async setRotating(
    characterId: string,
    shopId: string,
    items: (Item | null)[],
  ): Promise<void> {
    await this.db.updateTable('character_shop_state')
      .set({
        rotating_items: JSON.stringify(items) as never,
        updated_at: new Date(),
      })
      .where('character_id', '=', characterId)
      .where('shop_id', '=', shopId)
      .execute();
  }
}
```

- [ ] **Step 4: Run tests (will skip if no DB)**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm test --workspace server -- ShopRepository
```

Expected: PASS (or SKIP — acceptable if no DB configured).

- [ ] **Step 5: Commit**

```bash
git add server/src/ShopRepository.ts server/src/ShopRepository.test.ts
git commit -m "feat(server): add ShopRepository"
```

---

## Task 7: ShopManager pure logic

**Files:**
- Create: `server/src/ShopManager.ts`
- Create: `server/src/ShopManager.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/src/ShopManager.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { Item, ShopTemplate } from '@caverns/shared';
import {
  generateRotating,
  buildShopView,
  applyBuyFixed,
  applyBuyRotating,
  applySell,
  applyReroll,
} from './ShopManager.js';

const itemsById = new Map<string, Item>([
  ['minor_hp_potion', {
    id: 'minor_hp_potion', name: 'Minor Health Potion', description: '',
    rarity: 'common', slot: 'consumable', stats: { healAmount: 15 },
  }],
  ['hp_potion', {
    id: 'hp_potion', name: 'Health Potion', description: '',
    rarity: 'uncommon', slot: 'consumable', stats: { healAmount: 25 },
  }],
]);

const template: ShopTemplate = {
  id: 'starter_general_store',
  name: 'General Store',
  fixedStock: [
    { consumableId: 'minor_hp_potion' },
    { consumableId: 'hp_potion' },
  ],
  rotatingDropSpecId: 'shop_starter_general',
  rotatingSlotCount: 4,
  rerollCost: 25,
  buyMarkup: 1.0,
  sellBackPct: 0.5,
};

function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

describe('generateRotating', () => {
  it('returns exactly rotatingSlotCount items', () => {
    const items = generateRotating(template, { biomeId: 'cavern', rng: seededRng(1) });
    expect(items).toHaveLength(4);
    expect(items.every((i) => i !== null)).toBe(true);
  });
});

describe('buildShopView', () => {
  it('prices fixed stock with buyMarkup', () => {
    const view = buildShopView(template, [null, null, null, null], itemsById);
    expect(view.fixed[0].consumableId).toBe('minor_hp_potion');
    expect(view.fixed[0].price).toBe(15); // common consumable skull1 * 1.0 markup
    expect(view.fixed[1].price).toBe(30); // uncommon consumable
  });

  it('maps rotating items with prices and nulls', () => {
    const rotating: (Item | null)[] = [
      { id: 'a', name: 'A', description: '', rarity: 'common', slot: 'weapon', stats: {}, skullRating: 1 },
      null, null, null,
    ];
    const view = buildShopView(template, rotating, itemsById);
    expect(view.rotating[0].item?.id).toBe('a');
    expect(view.rotating[0].price).toBe(40);
    expect(view.rotating[1].item).toBeNull();
    expect(view.rotating[1].price).toBeNull();
  });
});

describe('applyBuyFixed', () => {
  it('deducts gold, adds item to consumables pouch', () => {
    const state = {
      gold: 100,
      inventory: [null, null, null, null, null, null, null],
      consumables: [null, null, null, null, null, null],
    };
    const result = applyBuyFixed(template, state, 0, itemsById);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.gold).toBe(85); // 100 - 15
    expect(result.state.consumables[0]?.id).toBe('minor_hp_potion');
  });

  it('fails when out of gold', () => {
    const state = {
      gold: 5,
      inventory: [null], consumables: [null],
    };
    const result = applyBuyFixed(template, state, 0, itemsById);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_enough_gold');
  });

  it('fails when consumables pouch is full', () => {
    const state = {
      gold: 100,
      inventory: [null],
      consumables: Array(6).fill({ id: 'x', name: '', description: '', rarity: 'common', slot: 'consumable', stats: {} } as Item),
    };
    const result = applyBuyFixed(template, state, 0, itemsById);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_space');
  });
});

describe('applyBuyRotating', () => {
  it('deducts gold, places item in inventory, clears rotating slot', () => {
    const weapon: Item = {
      id: 'w1', name: 'W', description: '', rarity: 'common', slot: 'weapon',
      stats: { damage: 3 }, skullRating: 1,
    };
    const state = {
      gold: 100,
      inventory: [null, null, null, null, null, null, null],
      consumables: [null, null, null, null, null, null],
      rotating: [weapon, null, null, null] as (Item | null)[],
    };
    const result = applyBuyRotating(template, state, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.gold).toBe(60); // 100 - 40
    expect(result.state.inventory[0]?.id).toBe('w1');
    expect(result.state.rotating[0]).toBeNull();
  });

  it('fails when slot is already bought (null)', () => {
    const state = {
      gold: 100, inventory: [null], consumables: [null],
      rotating: [null, null, null, null] as (Item | null)[],
    };
    const result = applyBuyRotating(template, state, 0);
    expect(result.ok).toBe(false);
  });
});

describe('applySell', () => {
  it('pays sellPrice, removes item', () => {
    const weapon: Item = {
      id: 'w1', name: 'W', description: '', rarity: 'common', slot: 'weapon',
      stats: {}, skullRating: 1,
    };
    const state = {
      gold: 0,
      inventory: [weapon, null] as (Item | null)[],
      consumables: [null],
    };
    const result = applySell(template, state, 'inventory', 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.gold).toBe(20); // 40 * 0.5
    expect(result.state.inventory[0]).toBeNull();
  });

  it('fails when slot is empty', () => {
    const state = { gold: 0, inventory: [null], consumables: [null] };
    const result = applySell(template, state, 'inventory', 0);
    expect(result.ok).toBe(false);
  });
});

describe('applyReroll', () => {
  it('deducts cost, regenerates rotating', () => {
    const state = {
      gold: 100,
      rotating: [null, null, null, null] as (Item | null)[],
    };
    const result = applyReroll(template, state, { biomeId: 'cavern', rng: seededRng(7) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.gold).toBe(75);
    expect(result.state.rotating).toHaveLength(4);
    expect(result.state.rotating.every((i) => i !== null)).toBe(true);
  });

  it('fails when not enough gold', () => {
    const state = { gold: 10, rotating: [null, null, null, null] };
    const result = applyReroll(template, state, { biomeId: 'cavern', rng: seededRng(7) });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm test --workspace server -- ShopManager
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `server/src/ShopManager.ts`**

```typescript
import type { Item, ShopTemplate, ShopView } from '@caverns/shared';
import { buyPrice, sellPrice, SHOP_DROP_SPECS } from '@caverns/shared';
import { resolveDrops } from './DropResolver.js';

export interface GenerateCtx {
  biomeId: string;
  rng: () => number;
}

export function generateRotating(
  template: ShopTemplate,
  ctx: GenerateCtx,
): (Item | null)[] {
  const out: (Item | null)[] = [];
  const itemsByIdEmpty = new Map<string, Item>();
  for (let i = 0; i < template.rotatingSlotCount; i++) {
    const results = resolveDrops(
      { dropSpecId: template.rotatingDropSpecId },
      {
        biomeId: ctx.biomeId,
        registry: SHOP_DROP_SPECS,
        itemsById: itemsByIdEmpty,
        rng: ctx.rng,
      },
    );
    const itemResult = results.find((r) => r.kind === 'item');
    out.push(itemResult && itemResult.kind === 'item' ? itemResult.item : null);
  }
  return out;
}

export function buildShopView(
  template: ShopTemplate,
  rotating: (Item | null)[],
  itemsById: Map<string, Item>,
): ShopView {
  return {
    shopId: template.id,
    name: template.name,
    fixed: template.fixedStock.map((e) => {
      const item = itemsById.get(e.consumableId);
      if (!item) throw new Error(`Unknown consumableId in shop fixed stock: ${e.consumableId}`);
      return {
        consumableId: e.consumableId,
        item,
        price: buyPrice(item, template.buyMarkup),
      };
    }),
    rotating: rotating.map((item) => ({
      item,
      price: item ? buyPrice(item, template.buyMarkup) : null,
    })),
    rerollCost: template.rerollCost,
    sellBackPct: template.sellBackPct,
  };
}

// ==== Buy / Sell / Reroll ====

export type OpResult<S> =
  | { ok: true; state: S }
  | { ok: false; reason: string };

interface BuyState {
  gold: number;
  inventory: (Item | null)[];
  consumables: (Item | null)[];
}

function firstFreeSlot(slots: (Item | null)[]): number {
  return slots.findIndex((s) => s === null);
}

export function applyBuyFixed(
  template: ShopTemplate,
  state: BuyState,
  index: number,
  itemsById: Map<string, Item>,
): OpResult<BuyState> {
  const entry = template.fixedStock[index];
  if (!entry) return { ok: false, reason: 'invalid_index' };
  const item = itemsById.get(entry.consumableId);
  if (!item) return { ok: false, reason: 'unknown_item' };
  const price = buyPrice(item, template.buyMarkup);
  if (state.gold < price) return { ok: false, reason: 'not_enough_gold' };

  // Fixed stock is always consumables per spec; route to consumables pouch.
  const target = item.slot === 'consumable' ? 'consumables' : 'inventory';
  const slots = target === 'consumables' ? state.consumables : state.inventory;
  const free = firstFreeSlot(slots);
  if (free === -1) return { ok: false, reason: 'no_space' };

  const nextSlots = [...slots];
  nextSlots[free] = { ...item };
  return {
    ok: true,
    state: {
      gold: state.gold - price,
      inventory: target === 'inventory' ? nextSlots : state.inventory,
      consumables: target === 'consumables' ? nextSlots : state.consumables,
    },
  };
}

interface RotatingBuyState extends BuyState {
  rotating: (Item | null)[];
}

export function applyBuyRotating(
  template: ShopTemplate,
  state: RotatingBuyState,
  index: number,
): OpResult<RotatingBuyState> {
  const item = state.rotating[index];
  if (!item) return { ok: false, reason: 'slot_empty' };
  const price = buyPrice(item, template.buyMarkup);
  if (state.gold < price) return { ok: false, reason: 'not_enough_gold' };

  const target = item.slot === 'consumable' ? 'consumables' : 'inventory';
  const slots = target === 'consumables' ? state.consumables : state.inventory;
  const free = firstFreeSlot(slots);
  if (free === -1) return { ok: false, reason: 'no_space' };

  const nextSlots = [...slots];
  nextSlots[free] = item;
  const nextRotating = [...state.rotating];
  nextRotating[index] = null;

  return {
    ok: true,
    state: {
      gold: state.gold - price,
      inventory: target === 'inventory' ? nextSlots : state.inventory,
      consumables: target === 'consumables' ? nextSlots : state.consumables,
      rotating: nextRotating,
    },
  };
}

export function applySell(
  template: ShopTemplate,
  state: BuyState,
  from: 'inventory' | 'consumables',
  fromIndex: number,
): OpResult<BuyState> {
  const slots = from === 'inventory' ? state.inventory : state.consumables;
  const item = slots[fromIndex];
  if (!item) return { ok: false, reason: 'slot_empty' };
  const price = sellPrice(item, template.sellBackPct);

  const nextSlots = [...slots];
  nextSlots[fromIndex] = null;
  return {
    ok: true,
    state: {
      gold: state.gold + price,
      inventory: from === 'inventory' ? nextSlots : state.inventory,
      consumables: from === 'consumables' ? nextSlots : state.consumables,
    },
  };
}

interface RerollState {
  gold: number;
  rotating: (Item | null)[];
}

export function applyReroll(
  template: ShopTemplate,
  state: RerollState,
  ctx: GenerateCtx,
): OpResult<RerollState> {
  if (state.gold < template.rerollCost) return { ok: false, reason: 'not_enough_gold' };
  const rotating = generateRotating(template, ctx);
  return {
    ok: true,
    state: {
      gold: state.gold - template.rerollCost,
      rotating,
    },
  };
}
```

- [ ] **Step 4: Run tests**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm test --workspace server -- ShopManager
```

Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add server/src/ShopManager.ts server/src/ShopManager.test.ts
git commit -m "feat(server): add ShopManager pure logic"
```

---

## Task 8: Wire shop handlers into `server/src/index.ts`

**Files:**
- Modify: `server/src/index.ts`

**Context:** The existing `overworld_interact` handler inspects the interactable under the player and opens a stash. We extend it to also route to shops. `shop_buy`/`shop_sell`/`shop_reroll` are new. Also: refuse shop ops for players currently inside a dungeon via `dungeonConnections.has(playerId)`, mirroring stash behaviour.

- [ ] **Step 1: Instantiate `ShopRepository` near the other repos**

Near where `StashRepository` is instantiated, add:

```typescript
import { ShopRepository } from './ShopRepository.js';
// ...
const shopRepo = new ShopRepository(db);
```

- [ ] **Step 2: Add a helper to build and persist shop state**

Add a private helper in `index.ts` (near the stash helpers):

```typescript
import type { ShopTemplate } from '@caverns/shared';
import { SHOP_TEMPLATES } from '@caverns/shared';
import {
  generateRotating,
  buildShopView,
  applyBuyFixed,
  applyBuyRotating,
  applySell,
  applyReroll,
} from './ShopManager.js';

async function openShopForPlayer(
  playerId: string,
  characterId: string,
  shopId: string,
): Promise<void> {
  const template = SHOP_TEMPLATES[shopId];
  if (!template) {
    send(playerId, { type: 'shop_error', reason: 'unknown_shop' });
    return;
  }

  await shopRepo.ensure(characterId, shopId);
  let state = await shopRepo.get(characterId, shopId);

  // First-time open: seed rotating stock.
  if (state.rotating_items.length === 0) {
    const rotating = generateRotating(template, { biomeId: 'cavern', rng: Math.random });
    await shopRepo.setRotating(characterId, shopId, rotating);
    state = await shopRepo.get(characterId, shopId);
  }

  const character = await characterRepo.getById(characterId);
  if (!character) {
    send(playerId, { type: 'shop_error', reason: 'unknown_character' });
    return;
  }

  const view = buildShopView(template, state.rotating_items, ITEMS_BY_ID);
  send(playerId, {
    type: 'shop_opened',
    shop: view,
    gold: character.gold,
    character: { inventory: character.inventory, consumables: character.consumables },
  });
}
```

Note: `ITEMS_BY_ID` should match the map the rest of the server uses. If the codebase names it differently (e.g. `itemsById`), reuse that identifier. Grep first:

```bash
grep -rn "itemsById\|ITEMS_BY_ID" server/src/index.ts
```

Use whatever is already defined.

- [ ] **Step 3: Route `overworld_interact` to shops**

Find the existing `case 'overworld_interact':` block. After looking up the interactable (currently routes to stash on `kind === 'stash'`), add a shop branch:

```typescript
case 'overworld_interact': {
  const session = getWorldSession(playerId);
  if (!session) break;
  const interactable = session.getInteractableAtMember(playerId, msg.interactableId);
  if (!interactable) break;

  const member = session.getMember(playerId);
  if (!member) break;

  if (interactable.kind === 'stash') {
    await openStashForPlayer(playerId, member.characterId);
  } else if (interactable.kind === 'shop') {
    const shopId = interactable.shopId;
    if (!shopId) {
      send(playerId, { type: 'shop_error', reason: 'shop_missing_id' });
      break;
    }
    await openShopForPlayer(playerId, member.characterId, shopId);
  }
  break;
}
```

(If `session.getMember(playerId)` doesn't exist yet, use whatever method currently exposes the world member — grep for how the stash flow retrieves `characterId`.)

- [ ] **Step 4: Add `shop_buy` handler**

```typescript
case 'shop_buy': {
  if (dungeonConnections.has(playerId)) {
    send(playerId, { type: 'shop_error', reason: 'in_dungeon' });
    break;
  }
  const session = getWorldSession(playerId);
  if (!session) break;
  const member = session.getMember(playerId);
  if (!member) break;
  const template = SHOP_TEMPLATES[msg.shopId];
  if (!template) {
    send(playerId, { type: 'shop_error', reason: 'unknown_shop' });
    break;
  }

  const character = await characterRepo.getById(member.characterId);
  if (!character) break;
  const state = await shopRepo.get(member.characterId, msg.shopId);

  let result;
  if (msg.slotType === 'fixed') {
    result = applyBuyFixed(
      template,
      { gold: character.gold, inventory: character.inventory, consumables: character.consumables },
      msg.index,
      ITEMS_BY_ID,
    );
  } else {
    result = applyBuyRotating(
      template,
      {
        gold: character.gold,
        inventory: character.inventory,
        consumables: character.consumables,
        rotating: state.rotating_items,
      },
      msg.index,
    );
  }

  if (!result.ok) {
    send(playerId, { type: 'shop_error', reason: result.reason });
    break;
  }

  await characterRepo.snapshotInventory(member.characterId, result.state.inventory, result.state.consumables);
  await characterRepo.setGold(member.characterId, result.state.gold);
  if ('rotating' in result.state) {
    await shopRepo.setRotating(member.characterId, msg.shopId, result.state.rotating);
  }

  const latest = await shopRepo.get(member.characterId, msg.shopId);
  send(playerId, {
    type: 'shop_updated',
    shop: buildShopView(template, latest.rotating_items, ITEMS_BY_ID),
    gold: result.state.gold,
    character: { inventory: result.state.inventory, consumables: result.state.consumables },
  });
  break;
}
```

Note: if `characterRepo.setGold` doesn't exist yet, grep for the existing gold-update pattern and reuse it (likely a direct `updateTable('characters').set({ gold }).where(...)` call — add a method to the repo if needed).

- [ ] **Step 5: Add `shop_sell` handler**

```typescript
case 'shop_sell': {
  if (dungeonConnections.has(playerId)) {
    send(playerId, { type: 'shop_error', reason: 'in_dungeon' });
    break;
  }
  const session = getWorldSession(playerId);
  if (!session) break;
  const member = session.getMember(playerId);
  if (!member) break;
  const template = SHOP_TEMPLATES[msg.shopId];
  if (!template) {
    send(playerId, { type: 'shop_error', reason: 'unknown_shop' });
    break;
  }
  const character = await characterRepo.getById(member.characterId);
  if (!character) break;

  const result = applySell(
    template,
    { gold: character.gold, inventory: character.inventory, consumables: character.consumables },
    msg.from,
    msg.fromIndex,
  );
  if (!result.ok) {
    send(playerId, { type: 'shop_error', reason: result.reason });
    break;
  }

  await characterRepo.snapshotInventory(member.characterId, result.state.inventory, result.state.consumables);
  await characterRepo.setGold(member.characterId, result.state.gold);

  const latest = await shopRepo.get(member.characterId, msg.shopId);
  send(playerId, {
    type: 'shop_updated',
    shop: buildShopView(template, latest.rotating_items, ITEMS_BY_ID),
    gold: result.state.gold,
    character: { inventory: result.state.inventory, consumables: result.state.consumables },
  });
  break;
}
```

- [ ] **Step 6: Add `shop_reroll` handler**

```typescript
case 'shop_reroll': {
  if (dungeonConnections.has(playerId)) {
    send(playerId, { type: 'shop_error', reason: 'in_dungeon' });
    break;
  }
  const session = getWorldSession(playerId);
  if (!session) break;
  const member = session.getMember(playerId);
  if (!member) break;
  const template = SHOP_TEMPLATES[msg.shopId];
  if (!template) {
    send(playerId, { type: 'shop_error', reason: 'unknown_shop' });
    break;
  }
  const character = await characterRepo.getById(member.characterId);
  if (!character) break;
  const state = await shopRepo.get(member.characterId, msg.shopId);

  const result = applyReroll(
    template,
    { gold: character.gold, rotating: state.rotating_items },
    { biomeId: 'cavern', rng: Math.random },
  );
  if (!result.ok) {
    send(playerId, { type: 'shop_error', reason: result.reason });
    break;
  }

  await characterRepo.setGold(member.characterId, result.state.gold);
  await shopRepo.setRotating(member.characterId, msg.shopId, result.state.rotating);

  send(playerId, {
    type: 'shop_updated',
    shop: buildShopView(template, result.state.rotating, ITEMS_BY_ID),
    gold: result.state.gold,
    character: { inventory: character.inventory, consumables: character.consumables },
  });
  break;
}
```

- [ ] **Step 7: Typecheck and run server tests**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm run typecheck
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm test --workspace server
```

Expected: typecheck PASS, all existing server tests PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(server): wire shop handlers into WebSocket routing"
```

---

## Task 9: Place a shop interactable in the starter town

**Files:**
- Modify: `shared/src/overworld.ts`

- [ ] **Step 1: Add `shop` to the `kind` union and add `shopId`**

In `OverworldInteractable`:

```typescript
export interface OverworldInteractable {
  id: string;
  x: number;
  y: number;
  kind: 'stash' | 'npc' | 'shop';
  label: string;
  shopId?: string;
}
```

- [ ] **Step 2: Add the interactable entry**

Find the `interactables:` array in `STARTER_MAP` and add a shop next to the existing stash. Pick a walkable `town_floor` tile — looking at the rows, `(8,6)` is inside the town room:

```typescript
interactables: [
  {
    id: 'starter_stash',
    x: 6,
    y: 6,
    kind: 'stash',
    label: 'Adventurer\u2019s Stash',
  },
  {
    id: 'starter_shop',
    x: 8,
    y: 6,
    kind: 'shop',
    label: 'General Store',
    shopId: 'starter_general_store',
  },
],
```

- [ ] **Step 3: Typecheck**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add shared/src/overworld.ts
git commit -m "feat(shared): place starter general store in starter town"
```

---

## Task 10: Client store + action senders

**Files:**
- Modify: `client/src/hooks/useGameActions.ts`
- Modify: `client/src/store/gameStore.ts`

- [ ] **Step 1: Add shop senders**

In `useGameActions.ts`, alongside the stash senders, add:

```typescript
shopBuy: (shopId: string, slotType: 'fixed' | 'rotating', index: number) =>
  send({ type: 'shop_buy', shopId, slotType, index }),
shopSell: (shopId: string, from: 'inventory' | 'consumables', fromIndex: number) =>
  send({ type: 'shop_sell', shopId, from, fromIndex }),
shopReroll: (shopId: string) => send({ type: 'shop_reroll', shopId }),
closeShop: () => useGameStore.setState({ openShop: null, shopError: null }),
```

- [ ] **Step 2: Add store state**

In `gameStore.ts`, near `openStash`:

```typescript
openShop: ShopView & { gold: number; character: CharacterItemsView } | null;
shopError: string | null;
```

Initial state:

```typescript
openShop: null,
shopError: null,
```

(Import `ShopView` and `CharacterItemsView` from `@caverns/shared`.)

- [ ] **Step 3: Add message handlers**

Inside `handleServerMessage`, add:

```typescript
case 'shop_opened':
  set({
    openShop: {
      ...msg.shop,
      gold: msg.gold,
      character: msg.character,
    },
    shopError: null,
  });
  break;

case 'shop_updated':
  set({
    openShop: {
      ...msg.shop,
      gold: msg.gold,
      character: msg.character,
    },
    shopError: null,
  });
  break;

case 'shop_error':
  set({ shopError: msg.reason });
  break;
```

- [ ] **Step 4: Clear `openShop` on `dungeon_entered`**

Find the existing `case 'dungeon_entered':` block and add `openShop: null, shopError: null,` to the `set({...})` call.

- [ ] **Step 5: Typecheck**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/hooks/useGameActions.ts client/src/store/gameStore.ts
git commit -m "feat(client): add shop store state and action senders"
```

---

## Task 11: ShopModal component

**Files:**
- Create: `client/src/components/ShopModal.tsx`
- Modify: `client/src/components/WorldView.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/styles/index.css`

- [ ] **Step 1: Create `ShopModal.tsx`**

```tsx
import { useGameStore } from '../store/gameStore.js';
import type { Item } from '@caverns/shared';

interface Props {
  onBuy: (shopId: string, slotType: 'fixed' | 'rotating', index: number) => void;
  onSell: (shopId: string, from: 'inventory' | 'consumables', fromIndex: number) => void;
  onReroll: (shopId: string) => void;
  onClose: () => void;
}

export function ShopModal({ onBuy, onSell, onReroll, onClose }: Props) {
  const shop = useGameStore((s) => s.openShop);
  const error = useGameStore((s) => s.shopError);
  if (!shop) return null;

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="shop-modal" onClick={stop}>
        <header className="shop-modal-header">
          <h2>{shop.name}</h2>
          <div className="shop-gold">{shop.gold}g</div>
          <button className="shop-close-btn" onClick={onClose}>×</button>
        </header>

        {error && <div className="shop-error">{error}</div>}

        <section className="shop-section">
          <h3>Staples</h3>
          <div className="shop-row">
            {shop.fixed.map((slot, i) => (
              <button
                key={`fixed-${i}`}
                className="shop-slot"
                onClick={() => onBuy(shop.shopId, 'fixed', i)}
                disabled={shop.gold < slot.price}
                title={slot.item.description}
              >
                <div className="shop-slot-name">{slot.item.name}</div>
                <div className="shop-price">{slot.price}g</div>
              </button>
            ))}
          </div>
        </section>

        <section className="shop-section">
          <div className="shop-section-header">
            <h3>Wares</h3>
            <button
              className="shop-reroll-btn"
              onClick={() => onReroll(shop.shopId)}
              disabled={shop.gold < shop.rerollCost}
            >
              Reroll ({shop.rerollCost}g)
            </button>
          </div>
          <div className="shop-row">
            {shop.rotating.map((slot, i) => (
              <button
                key={`rot-${i}`}
                className="shop-slot"
                onClick={() => slot.item && onBuy(shop.shopId, 'rotating', i)}
                disabled={!slot.item || (slot.price != null && shop.gold < slot.price)}
                title={slot.item?.description ?? 'Bought'}
              >
                {slot.item ? (
                  <>
                    <div className={`shop-slot-name rarity-${slot.item.rarity}`}>{slot.item.name}</div>
                    <div className="shop-price">{slot.price}g</div>
                  </>
                ) : (
                  <div className="shop-slot-empty">—</div>
                )}
              </button>
            ))}
          </div>
        </section>

        <section className="shop-section">
          <h3>Your Inventory (click to sell at {Math.round(shop.sellBackPct * 100)}%)</h3>
          <div className="shop-row">
            {shop.character.inventory.map((item, i) => (
              <SellSlot key={`inv-${i}`} item={item} onClick={() => item && onSell(shop.shopId, 'inventory', i)} />
            ))}
          </div>
          <div className="shop-row">
            {shop.character.consumables.map((item, i) => (
              <SellSlot key={`con-${i}`} item={item} onClick={() => item && onSell(shop.shopId, 'consumables', i)} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function SellSlot({ item, onClick }: { item: Item | null; onClick: () => void }) {
  return (
    <button className="shop-slot" onClick={onClick} disabled={!item} title={item?.description ?? ''}>
      {item ? <div className={`shop-slot-name rarity-${item.rarity}`}>{item.name}</div> : <div className="shop-slot-empty">—</div>}
    </button>
  );
}
```

- [ ] **Step 2: Render it in `WorldView.tsx`**

Add to the props type and destructure:

```typescript
interface Props {
  // ... existing props
  onShopBuy: (shopId: string, slotType: 'fixed' | 'rotating', index: number) => void;
  onShopSell: (shopId: string, from: 'inventory' | 'consumables', fromIndex: number) => void;
  onShopReroll: (shopId: string) => void;
  onShopClose: () => void;
}
```

Inside the render, alongside `<StashModal />`:

```tsx
<ShopModal
  onBuy={onShopBuy}
  onSell={onShopSell}
  onReroll={onShopReroll}
  onClose={onShopClose}
/>
```

Import at the top:
```typescript
import { ShopModal } from './ShopModal.js';
```

- [ ] **Step 3: Wire props in `App.tsx`**

In the `<WorldView>` render, add the new prop bindings:

```tsx
<WorldView
  // ... existing props
  onShopBuy={actions.shopBuy}
  onShopSell={actions.shopSell}
  onShopReroll={actions.shopReroll}
  onShopClose={actions.closeShop}
/>
```

- [ ] **Step 4: Add CSS**

Append to `client/src/styles/index.css`:

```css
.shop-modal {
  background: #0b0d0a;
  border: 2px solid #d4af37;
  padding: 1rem 1.5rem;
  max-width: 720px;
  width: 90vw;
  max-height: 85vh;
  overflow-y: auto;
  color: #d4d4c8;
  font-family: inherit;
}

.shop-modal-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  border-bottom: 1px solid #444;
  padding-bottom: 0.5rem;
  margin-bottom: 0.75rem;
}

.shop-modal-header h2 { flex: 1; margin: 0; color: #d4af37; }
.shop-gold { color: #d4af37; font-weight: bold; }
.shop-close-btn {
  background: transparent; border: 1px solid #555; color: #ccc;
  width: 28px; height: 28px; font-size: 18px; cursor: pointer;
}

.shop-error {
  background: #2a0a0a; color: #ff8080; padding: 0.4rem 0.6rem;
  margin-bottom: 0.5rem; border: 1px solid #661515;
}

.shop-section { margin-bottom: 1rem; }
.shop-section h3 { margin: 0 0 0.4rem 0; color: #a89968; font-size: 0.9rem; text-transform: uppercase; }

.shop-section-header {
  display: flex; align-items: center; justify-content: space-between;
}

.shop-reroll-btn {
  background: #1a1a12; border: 1px solid #d4af37; color: #d4af37;
  padding: 0.3rem 0.7rem; cursor: pointer;
}
.shop-reroll-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.shop-row { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.4rem; }
.shop-slot {
  background: #13140e;
  border: 1px solid #333;
  color: inherit;
  padding: 0.5rem 0.6rem;
  min-width: 120px;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
}
.shop-slot:hover:not(:disabled) { border-color: #d4af37; }
.shop-slot:disabled { opacity: 0.4; cursor: not-allowed; }

.shop-slot-name { font-size: 0.85rem; }
.shop-slot-empty { color: #555; text-align: center; }
.shop-price { color: #d4af37; font-size: 0.8rem; margin-top: 0.2rem; }
```

- [ ] **Step 5: Typecheck and build the client**

```bash
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm run typecheck
cd /mnt/c/Users/jakeh/WebstormProjects/Caverns && npm run build --workspace client
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/ShopModal.tsx client/src/components/WorldView.tsx client/src/App.tsx client/src/styles/index.css
git commit -m "feat(client): add ShopModal with buy/sell/reroll"
```

---

## Task 12: End-to-end smoke test

**Files:**
- None (manual)

- [ ] **Step 1: Start server and client**

```bash
npm run dev:server
npm run dev:client
```

- [ ] **Step 2: Log in, pick a character, enter the starter world**

- [ ] **Step 3: Walk onto tile (8,6)** — press `E` or click the tile while standing on it.

Expected: `ShopModal` opens with 2 staples, 4 rotating wares, character gold in header.

- [ ] **Step 4: Buy a staple** (e.g. minor_hp_potion for 15g).

Expected: gold decrements, consumable appears in pouch, modal updates.

- [ ] **Step 5: Buy a rotating item**.

Expected: gold decrements, item appears in inventory, slot becomes "—".

- [ ] **Step 6: Sell an item back**.

Expected: gold increments by 50% of base price, slot clears.

- [ ] **Step 7: Reroll** (if enough gold).

Expected: gold decrements by 25, rotating stock replaced with 4 fresh items.

- [ ] **Step 8: Close modal, walk to portal, enter dungeon**.

Expected: `openShop` cleared on `dungeon_entered`; on return no residual shop state.

- [ ] **Step 9: Report any issues back to the controller for follow-up**.

---

## Self-Review Notes

- **Spec coverage:** Hybrid stock (Task 3 fixed + rotating), per-character state (Task 5 composite PK), reroll as gold sink (Task 7 `applyReroll`, Task 8 handler, Task 11 button), multi-shop ready (keyed by `shop_id`, template registry, `shopId` on interactables). Pricing via pure function reused for buy and sell.
- **Base rates:** The user expects to adjust these — all knobs (`SLOT_BASE`, `SKULL_MULT`, `RARITY_MULT`, `rerollCost`, `buyMarkup`, `sellBackPct`) are isolated in two files (`shared/src/pricing.ts` and `shared/src/data/shops.ts`) so tuning is a one-file change each.
- **No `setGold`/`getMember`/`ITEMS_BY_ID` assumptions:** Task 8 flags these as "grep first, reuse existing" to avoid rot if the codebase has renamed them.
