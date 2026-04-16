# Character Creation Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove world-select from onboarding, auto-join a default world on login, and replace the character-create panel with a point-buy modal where class only gates starting items and abilities.

**Architecture:**
- On login/resume, the server ensures every account has exactly one implicit "Default" world and pre-selects it. The client skips the `world_select` view entirely.
- Class `baseStats` are flattened to a shared uniform baseline across all classes. Starting stats come from a 10-point point-buy seeded directly into `stat_allocations` (0–5 per stat across vitality/ferocity/toughness/speed/tactics). Class still dictates `starterWeaponId`, `starterOffhandId`, and abilities.
- A new `CharacterCreateModal` replaces `CharacterCreatePanel` with a three-column layout: portrait placeholder (left), class tabs + starter items + abilities (center), point-buy widget (right). It sends a `create_character` message with a `statPoints` payload; server validates and persists.
- Existing characters are wiped via a one-shot SQL migration so old stat spreads don't leak in.

**Tech Stack:** TypeScript monorepo (shared/server/client), npm workspaces, React + Zustand, Kysely/Postgres, Vitest, WebSocket JSON message protocol.

---

## File Structure

**Shared (`shared/src`):**
- Modify `data/classes.json` — flatten `baseStats` on every class to the uniform baseline.
- Create `data/characterCreationConfig.json` — point-buy budget + bounds config.
- Create `characterCreation.ts` — exports `CHARACTER_CREATION_CONFIG` and `validateStatPoints()`.
- Create `characterCreation.test.ts` — unit tests for validation.
- Modify `messages.ts` — add `statPoints` field to `CreateCharacterMessage`.
- Modify `index.ts` — re-export new module.

**Server (`server/src`):**
- Modify `WorldRepository.ts` — add `ensureDefaultWorld(accountId)`.
- Modify `WorldRepository.test.ts` — add ensureDefaultWorld tests.
- Modify `CharacterRepository.ts` — accept `statAllocations` in `CreateCharacterInput`, persist to `stat_allocations` column.
- Modify `CharacterRepository.test.ts` — update create test.
- Modify `index.ts` — auto-select default world in login/resume handlers; pass `statPoints` through `create_character` handler.
- Create `db/migrations/1744500000_wipe_characters.sql` — one-shot wipe.

**Client (`client/src`):**
- Modify `store/gameStore.ts` — drop `world_select` from `selectCurrentView`; auto-set `selectedWorldId` when `auth_result` or the first `world_list` arrives.
- Modify `App.tsx` — remove `world_select` case from the switch; drop `WorldSelect` import and its props from `useGameActions`.
- Modify `hooks/useGameActions.ts` — `createCharacter` accepts `statPoints`.
- Delete `components/WorldSelect.tsx`, `components/WorldCreatePanel.tsx`, `components/WorldJoinPanel.tsx` — no longer reachable.
- Delete `components/CharacterCreatePanel.tsx` — replaced.
- Create `components/CharacterCreateModal.tsx` — new point-buy UI.
- Create `components/CharacterCreateModal.test.tsx` — component tests (mounting + point-buy interactions).
- Modify `components/CharacterSelect.tsx` — mount `CharacterCreateModal` instead of `CharacterCreatePanel`.
- Modify `styles/index.css` — add styles for the new modal.

**Public assets:** no new PNGs (portrait slot uses a placeholder glyph for now, matching the stash panel pattern in `TownView.tsx`).

---

## Task 1: Flatten class baseStats

**Files:**
- Modify: `shared/src/data/classes.json`
- Modify: `server/src/GameSession.test.ts` (only if any test relies on class-specific baseStats)
- Test: `shared/src/classData.test.ts` (create if missing)

**Context:** Every class currently has unique `baseStats` (e.g. Shadowblade has maxHp 35, Vanguard 50). Going forward the baseline is uniform — derived stats come from the point-buy via `stat_allocations`. `computePlayerStats` in `shared/src/types.ts:254` already sums `classDef.baseStats` + allocations × perPoint, so flattening the JSON is enough; no code change is required in that function.

The uniform baseline matches `PLAYER_CONFIG.baseStats` from `shared/src/data/playerConfig.json` — check that file for the canonical values before editing. Use those exact numbers (do not hard-code numbers that might drift from the config).

- [ ] **Step 1: Read `shared/src/data/playerConfig.json` to capture the uniform baseline**

Run: `cat shared/src/data/playerConfig.json`
Note the `baseStats` object — use these exact fields as the uniform baseline when rewriting classes.json.

- [ ] **Step 2: Write a failing test locking in the flattened baseline**

Create `shared/src/classData.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CLASS_DEFINITIONS } from './classData.js';
import PLAYER_CONFIG from './data/playerConfig.json' with { type: 'json' };

describe('class baseStats are flattened', () => {
  it('every class uses the same baseline as PLAYER_CONFIG', () => {
    expect(CLASS_DEFINITIONS.length).toBeGreaterThan(0);
    for (const cls of CLASS_DEFINITIONS) {
      expect(cls.baseStats).toEqual(PLAYER_CONFIG.baseStats);
    }
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test --workspace=shared -- classData.test.ts`
Expected: FAIL — at least one class has mismatched `baseStats`.

- [ ] **Step 4: Flatten `baseStats` on every class in `classes.json`**

For each entry in `shared/src/data/classes.json`, replace the `baseStats` object with the baseline you captured in Step 1. Leave `starterWeaponId`, `starterOffhandId`, and `abilities` untouched.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test --workspace=shared -- classData.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full shared + server suites**

Run: `npm test --workspace=shared && npm test --workspace=server`
Expected: all green. If `GameSession.test.ts` asserts on class-specific HP (grep it for `maxHp: 35`, `maxHp: 50`, etc.), update those assertions to the new baseline — do not change the test intent, just the numbers.

- [ ] **Step 7: Commit**

```bash
git add shared/src/data/classes.json shared/src/classData.test.ts server/src/GameSession.test.ts
git commit -m "feat(classes): flatten class baseStats to uniform baseline"
```

---

## Task 2: Shared character creation config + validation

**Files:**
- Create: `shared/src/data/characterCreationConfig.json`
- Create: `shared/src/characterCreation.ts`
- Create: `shared/src/characterCreation.test.ts`
- Modify: `shared/src/index.ts`
- Modify: `shared/src/messages.ts`

- [ ] **Step 1: Create the config file**

Create `shared/src/data/characterCreationConfig.json`:

```json
{
  "pointBudget": 10,
  "perStatMin": 0,
  "perStatMax": 5,
  "statIds": ["vitality", "ferocity", "toughness", "speed", "tactics"]
}
```

- [ ] **Step 2: Write failing validation tests**

Create `shared/src/characterCreation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateStatPoints, CHARACTER_CREATION_CONFIG } from './characterCreation.js';

describe('validateStatPoints', () => {
  it('accepts a valid spread that uses the full budget', () => {
    const result = validateStatPoints({ vitality: 5, ferocity: 5, toughness: 0, speed: 0, tactics: 0 });
    expect(result.ok).toBe(true);
  });

  it('accepts spreads that under-spend the budget', () => {
    const result = validateStatPoints({ vitality: 2, ferocity: 2, toughness: 2, speed: 2, tactics: 0 });
    expect(result.ok).toBe(true);
  });

  it('rejects spreads that exceed the budget', () => {
    const result = validateStatPoints({ vitality: 5, ferocity: 5, toughness: 1, speed: 0, tactics: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/budget/i);
  });

  it('rejects stats above perStatMax', () => {
    const result = validateStatPoints({ vitality: 6, ferocity: 0, toughness: 0, speed: 0, tactics: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/max/i);
  });

  it('rejects negative stat values', () => {
    const result = validateStatPoints({ vitality: -1, ferocity: 0, toughness: 0, speed: 0, tactics: 0 });
    expect(result.ok).toBe(false);
  });

  it('rejects unknown stat ids', () => {
    const result = validateStatPoints({ vitality: 2, ferocity: 0, toughness: 0, speed: 0, tactics: 0, bogus: 1 } as Record<string, number>);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unknown/i);
  });

  it('exposes config constants', () => {
    expect(CHARACTER_CREATION_CONFIG.pointBudget).toBe(10);
    expect(CHARACTER_CREATION_CONFIG.perStatMax).toBe(5);
    expect(CHARACTER_CREATION_CONFIG.statIds).toHaveLength(5);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test --workspace=shared -- characterCreation.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement the module**

Create `shared/src/characterCreation.ts`:

```ts
import configJson from './data/characterCreationConfig.json' with { type: 'json' };

export interface CharacterCreationConfig {
  pointBudget: number;
  perStatMin: number;
  perStatMax: number;
  statIds: string[];
}

export const CHARACTER_CREATION_CONFIG: CharacterCreationConfig = configJson as CharacterCreationConfig;

export type StatPoints = Record<string, number>;

export type ValidateResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validateStatPoints(points: StatPoints): ValidateResult {
  const { pointBudget, perStatMin, perStatMax, statIds } = CHARACTER_CREATION_CONFIG;
  const allowed = new Set(statIds);
  let total = 0;
  for (const [id, value] of Object.entries(points)) {
    if (!allowed.has(id)) return { ok: false, reason: `unknown stat id: ${id}` };
    if (!Number.isInteger(value)) return { ok: false, reason: `stat ${id} must be an integer` };
    if (value < perStatMin) return { ok: false, reason: `stat ${id} below min (${perStatMin})` };
    if (value > perStatMax) return { ok: false, reason: `stat ${id} above max (${perStatMax})` };
    total += value;
  }
  if (total > pointBudget) return { ok: false, reason: `total ${total} exceeds budget ${pointBudget}` };
  return { ok: true };
}

export function emptyStatPoints(): StatPoints {
  const out: StatPoints = {};
  for (const id of CHARACTER_CREATION_CONFIG.statIds) out[id] = 0;
  return out;
}
```

- [ ] **Step 5: Re-export from the shared barrel**

Edit `shared/src/index.ts` — add the new export alongside the other `export * from './x.js';` lines:

```ts
export * from './characterCreation.js';
```

- [ ] **Step 6: Extend the `create_character` message schema**

Edit `shared/src/messages.ts` — find `CreateCharacterMessage` (~line 115) and add the new field:

```ts
export interface CreateCharacterMessage {
  type: 'create_character';
  name: string;
  class: string;
  statPoints: Record<string, number>;
}
```

- [ ] **Step 7: Run the shared suite**

Run: `npm test --workspace=shared`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add shared/src/characterCreation.ts shared/src/characterCreation.test.ts \
        shared/src/data/characterCreationConfig.json shared/src/index.ts \
        shared/src/messages.ts
git commit -m "feat(shared): add character creation point-buy config + validation"
```

---

## Task 3: Default world auto-provision

**Files:**
- Modify: `server/src/WorldRepository.ts`
- Modify: `server/src/WorldRepository.test.ts`
- Modify: `server/src/index.ts`

**Context:** Login and resume currently set `selectedWorldId: null` in the connection context, forcing the client through `world_select`. We want: on every successful auth, the server guarantees the account owns one world named "Default" and stamps its id onto `ctx.selectedWorldId`, then emits the character list for it straight away.

- [ ] **Step 1: Write failing repository test**

Add to `server/src/WorldRepository.test.ts`:

```ts
  it('ensureDefaultWorld creates a Default world on first call and reuses it after', async () => {
    const ownerAccountId = await createAccount(db, 'jake');
    const first = await repo.ensureDefaultWorld(ownerAccountId);
    expect(first.name).toBe('Default');
    expect(first.owner_account_id).toBe(ownerAccountId);
    expect(await repo.isMember(first.id, ownerAccountId)).toBe(true);

    const second = await repo.ensureDefaultWorld(ownerAccountId);
    expect(second.id).toBe(first.id);

    const list = await repo.listForAccount(ownerAccountId);
    expect(list.filter((w) => w.name === 'Default')).toHaveLength(1);
  });
```

(Use the existing `createAccount` helper if present in the test file; if there isn't one, look at how other tests in `WorldRepository.test.ts` seed an account and reuse that pattern.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=server -- WorldRepository.test.ts`
Expected: FAIL — `ensureDefaultWorld` does not exist.

- [ ] **Step 3: Implement `ensureDefaultWorld`**

Add to `server/src/WorldRepository.ts` inside the `WorldRepository` class:

```ts
  async ensureDefaultWorld(accountId: string): Promise<WorldsTable> {
    const owned = await this.db.selectFrom('worlds')
      .selectAll()
      .where('owner_account_id', '=', accountId)
      .where('name', '=', 'Default')
      .orderBy('created_at', 'asc')
      .executeTakeFirst();
    if (owned) return owned as WorldsTable;
    return this.create(accountId, 'Default');
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace=server -- WorldRepository.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the default world into login and resume handlers**

Edit `server/src/index.ts`. In the `login` handler (around line 274), after `connectionAccounts.set(...)` and before `sendAuthResult`, insert:

```ts
        if (worldRepo) {
          const defaultWorld = await worldRepo.ensureDefaultWorld(result.accountId);
          const ctx = connectionAccounts.get(playerId);
          if (ctx) ctx.selectedWorldId = defaultWorld.id;
        }
```

Then replace the `sendWorldList` call with a `sendCharacterListForWorld` call so the client jumps straight into character-select:

```ts
        await sendAuthResult(ws, result.accountId, token);
        const ctx = connectionAccounts.get(playerId);
        if (ctx?.selectedWorldId) {
          await sendCharacterListForWorld(ws, result.accountId, ctx.selectedWorldId);
        }
```

Apply the same change to the `resume_session` handler (around line 290). Remove the `await sendWorldList(...)` lines from both handlers.

- [ ] **Step 6: Update `sendAuthResult` to include the selected world id**

Edit `server/src/index.ts` — `sendAuthResult` currently sends `characters: []`. Change its signature and body:

```ts
async function sendAuthResult(
  ws: WebSocket,
  accountId: string,
  token: string,
  selectedWorldId: string | null,
): Promise<void> {
  if (!characterRepo || !db) return;
  const acc = await db
    .selectFrom('accounts')
    .select(['id', 'display_name'])
    .where('id', '=', accountId)
    .executeTakeFirstOrThrow();
  sendToWs(ws, {
    type: 'auth_result',
    token,
    account: { id: acc.id, displayName: acc.display_name },
    characters: [],
    selectedWorldId,
  });
}
```

Update both call-sites (login and resume) to pass `ctx?.selectedWorldId ?? null`.

- [ ] **Step 7: Extend `AuthResultMessage` with the new field**

Edit `shared/src/messages.ts` — find the `AuthResultMessage` interface and add:

```ts
  selectedWorldId: string | null;
```

- [ ] **Step 8: Run the server suite**

Run: `npm test --workspace=server`
Expected: all green. If any other test calls `sendAuthResult` or asserts on `auth_result` shape, update it to include `selectedWorldId`.

- [ ] **Step 9: Commit**

```bash
git add server/src/WorldRepository.ts server/src/WorldRepository.test.ts \
        server/src/index.ts shared/src/messages.ts
git commit -m "feat(server): auto-provision default world on login + resume"
```

---

## Task 4: Server accepts point-buy on character create

**Files:**
- Modify: `server/src/CharacterRepository.ts`
- Modify: `server/src/CharacterRepository.test.ts`
- Modify: `server/src/index.ts`

**Context:** `CharacterRepository.create` currently doesn't take stat allocations. We extend its input shape and persist the JSON to `stat_allocations`. The `create_character` server handler validates the incoming `statPoints` using `validateStatPoints` and bails with `auth_error` if invalid.

- [ ] **Step 1: Write failing repository test**

Add to `server/src/CharacterRepository.test.ts`:

```ts
  it('persists statAllocations from create input', async () => {
    const accountId = await createAccount(db, 'jake');
    const world = await worldRepo.create(accountId, 'W');
    const ch = await charRepo.create(accountId, world.id, {
      name: 'Hero',
      class: 'vanguard',
      statAllocations: { vitality: 3, ferocity: 2 },
    });
    expect(ch.stat_allocations).toEqual({ vitality: 3, ferocity: 2 });
  });
```

(Use the existing account/world setup pattern in the test file.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace=server -- CharacterRepository.test.ts`
Expected: FAIL — `CreateCharacterInput` has no `statAllocations` field.

- [ ] **Step 3: Extend `CreateCharacterInput` and `create()`**

Edit `server/src/CharacterRepository.ts`:

```ts
export interface CreateCharacterInput {
  name: string;
  class: string;
  statAllocations: Record<string, number>;
}
```

Then in `create()` add `stat_allocations` to the values object:

```ts
    const inserted = await this.db.insertInto('characters')
      .values({
        account_id: accountId,
        world_id: worldId,
        name: input.name.trim(),
        class: input.class,
        stat_allocations: JSON.stringify(input.statAllocations) as never,
        equipment: JSON.stringify(starterEquipment(input.class)),
        inventory: JSON.stringify(Array(7).fill(null)),
        consumables: JSON.stringify(starterConsumables()),
      } as never)
      .returningAll()
      .executeTakeFirstOrThrow();
```

- [ ] **Step 4: Update any existing repository tests that call `create()` without `statAllocations`**

Grep the test file for `charRepo.create(` / `characterRepo.create(` and add `statAllocations: {}` to each call where the new field is missing.

Run: `npm test --workspace=server -- CharacterRepository.test.ts`
Expected: PASS.

- [ ] **Step 5: Validate + forward `statPoints` in the `create_character` handler**

Edit `server/src/index.ts` — the `create_character` case (around line 417):

```ts
      case 'create_character': {
        const ctx = connectionAccounts.get(playerId);
        if (!ctx || !characterRepo) {
          sendTo(playerId, { type: 'auth_error', reason: 'Not logged in' });
          break;
        }
        if (!ctx.selectedWorldId) {
          sendTo(playerId, { type: 'world_error', reason: 'No world selected' });
          break;
        }
        const validation = validateStatPoints(msg.statPoints);
        if (!validation.ok) {
          sendTo(playerId, { type: 'auth_error', reason: `Invalid stats: ${validation.reason}` });
          break;
        }
        try {
          await characterRepo.create(ctx.accountId, ctx.selectedWorldId, {
            name: msg.name,
            class: msg.class,
            statAllocations: msg.statPoints,
          });
        } catch (e) {
          sendTo(playerId, { type: 'auth_error', reason: (e as Error).message });
          break;
        }
        await sendCharacterListForWorld(ws, ctx.accountId, ctx.selectedWorldId);
        break;
      }
```

Add the import at the top of the file:

```ts
import { validateStatPoints } from '@caverns/shared';
```

(If `@caverns/shared` already appears in an import line, append `validateStatPoints` to its named imports instead of adding a new line.)

- [ ] **Step 6: Run the server suite**

Run: `npm test --workspace=server`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add server/src/CharacterRepository.ts server/src/CharacterRepository.test.ts \
        server/src/index.ts
git commit -m "feat(server): accept and validate point-buy on create_character"
```

---

## Task 5: Wipe existing characters

**Files:**
- Create: `server/src/db/migrations/1744500000_wipe_characters.sql`

**Context:** Existing characters were rolled under the old class-based stat model and have empty `stat_allocations`. Per the design decision, we wipe them. The migration is a one-shot `DELETE FROM characters` — worlds, accounts, and sessions are preserved. This is a no-op on fresh installs.

- [ ] **Step 1: Create the migration**

Create `server/src/db/migrations/1744500000_wipe_characters.sql`:

```sql
-- One-shot wipe after character creation revamp.
-- Existing rows were created under the old class-based stat model and no longer round-trip cleanly.
DELETE FROM character_stash;
DELETE FROM character_shop_state;
DELETE FROM characters;
```

(Order matters: stash and shop state reference `characters.id` by FK. If grep shows other tables with FKs into `characters`, add their deletes first.)

- [ ] **Step 2: Verify FK dependencies**

Run: grep for `REFERENCES characters` in `server/src/db/migrations/` to confirm which tables depend on characters.

Update the migration if additional FK tables exist — add `DELETE FROM <table>;` lines for each, above the `DELETE FROM characters;` line.

- [ ] **Step 3: Run the server suite**

Run: `npm test --workspace=server`
Expected: all green (the test DB applies all migrations, so the wipe runs against empty tables and is a no-op).

- [ ] **Step 4: Commit**

```bash
git add server/src/db/migrations/1744500000_wipe_characters.sql
git commit -m "feat(db): wipe existing characters for point-buy revamp"
```

---

## Task 6: Client store + routing skip world_select

**Files:**
- Modify: `client/src/store/gameStore.ts`
- Modify: `client/src/App.tsx`
- Modify: `client/src/hooks/useGameActions.ts`

**Context:** With the server auto-selecting a world on auth, the client no longer needs the `world_select` view. The `auth_result` message now carries `selectedWorldId`; the store writes it on receipt. `selectCurrentView` collapses to login → character_select → in_world → in_dungeon.

- [ ] **Step 1: Handle `selectedWorldId` in the `auth_result` case**

Edit `client/src/store/gameStore.ts` — find the `case 'auth_result':` handler and set `selectedWorldId` from the message:

```ts
      case 'auth_result':
        set(() => ({
          authStatus: 'authenticated',
          account: msg.account,
          characters: msg.characters,
          selectedWorldId: msg.selectedWorldId,
          authError: null,
        }));
        break;
```

(Copy the exact shape the existing handler uses for other fields — this snippet shows only the new line to insert. If the existing handler sets other fields, keep them.)

- [ ] **Step 2: Drop `world_select` from `selectCurrentView`**

Edit `client/src/store/gameStore.ts:748`:

```ts
export function selectCurrentView(state: GameStore): ClientView {
  if (state.connectionStatus === 'disconnected') return 'connecting';
  if (state.generationStatus === 'generating' || state.generationStatus === 'failed') return 'generating';
  if (state.gameOver) return 'game_over';
  if (state.connectionStatus === 'in_game') return 'in_dungeon';
  if (state.currentWorld) return 'in_world';
  if (state.authStatus === 'authenticated') return 'character_select';
  if (state.authStatus === 'unauthenticated') return 'login';
  return 'connecting';
}
```

Also remove `'world_select'` from the `ClientView` union at the top of the file (~line 20).

- [ ] **Step 3: Remove the `world_select` case from `App.tsx`**

Edit `client/src/App.tsx` — delete the `case 'world_select':` block entirely, and remove the `WorldSelect` import at the top of the file. Also drop `onList`, `onSelect`, `onCreate`, `onJoin` world-related props where they're passed from this file (they live on `actions` so they don't need to be wired any more).

- [ ] **Step 4: Extend `createCharacter` in `useGameActions`**

Edit `client/src/hooks/useGameActions.ts` — find the `createCharacter` function and update its signature:

```ts
  const createCharacter = useCallback((name: string, className: string, statPoints: Record<string, number>) => {
    send({ type: 'create_character', name, class: className, statPoints });
  }, [send]);
```

- [ ] **Step 5: Typecheck + build the client**

Run: `npm run build --workspace=client`
Expected: clean build. If TypeScript complains about `world_select`, missing `selectedWorldId`, or the `createCharacter` signature, fix the call-sites rather than suppressing the error.

- [ ] **Step 6: Commit**

```bash
git add client/src/store/gameStore.ts client/src/App.tsx client/src/hooks/useGameActions.ts
git commit -m "feat(client): skip world_select view, consume auto-selected world"
```

---

## Task 7: CharacterCreateModal (point-buy UI)

**Files:**
- Create: `client/src/components/CharacterCreateModal.tsx`
- Create: `client/src/components/CharacterCreateModal.test.tsx`
- Modify: `client/src/components/CharacterSelect.tsx`
- Modify: `client/src/styles/index.css`
- Delete: `client/src/components/CharacterCreatePanel.tsx`

**Context:** The modal replaces `CharacterCreatePanel`. Layout: left column holds a square portrait placeholder (using the same `.town-portrait` base class as `TownView.tsx:44`, which already has scanline/vignette overlays, and the `town-portrait-placeholder` glyph for now); center column holds a class tab row, starter item readouts (weapon + offhand pulled from `getClassDefinition(className).starterWeaponId` / `starterOffhandId`, resolved via `CLASS_STARTER_ITEMS` export in shared), and an abilities list (from the class definition); right column holds the point-buy widget with one row per stat, `−` and `+` buttons, a numeric readout, and a "Points remaining: X / 10" header.

Stat display names come from `progressionConfig.json` `statDefinitions`, which you can pull via `PROGRESSION_CONFIG.statDefinitions` from `@caverns/shared`.

- [ ] **Step 1: Write failing component tests**

Create `client/src/components/CharacterCreateModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CharacterCreateModal } from './CharacterCreateModal.js';

function setup(overrides: { onCreate?: (n: string, c: string, p: Record<string, number>) => void } = {}) {
  const onCreate = overrides.onCreate ?? vi.fn();
  const onCancel = vi.fn();
  render(<CharacterCreateModal onCreate={onCreate} onCancel={onCancel} />);
  return { onCreate, onCancel };
}

describe('CharacterCreateModal', () => {
  it('starts with 10 points remaining and all stats at 0', () => {
    setup();
    expect(screen.getByText(/10\s*\/\s*10/)).toBeTruthy();
  });

  it('decrements remaining points when a stat is incremented', () => {
    setup();
    const plusButtons = screen.getAllByRole('button', { name: '+' });
    fireEvent.click(plusButtons[0]);
    expect(screen.getByText(/9\s*\/\s*10/)).toBeTruthy();
  });

  it('blocks incrementing beyond perStatMax', () => {
    setup();
    const plusButtons = screen.getAllByRole('button', { name: '+' });
    for (let i = 0; i < 6; i++) fireEvent.click(plusButtons[0]);
    expect(screen.getByText(/5\s*\/\s*10/)).toBeTruthy(); // capped at 5 points used on that stat
  });

  it('blocks incrementing when the budget is exhausted', () => {
    setup();
    const plusButtons = screen.getAllByRole('button', { name: '+' });
    // Spend all 10 on stats 0 and 1 (5 each).
    for (let i = 0; i < 5; i++) fireEvent.click(plusButtons[0]);
    for (let i = 0; i < 5; i++) fireEvent.click(plusButtons[1]);
    expect(screen.getByText(/0\s*\/\s*10/)).toBeTruthy();
    // Further clicks on any + should be no-ops.
    fireEvent.click(plusButtons[2]);
    expect(screen.getByText(/0\s*\/\s*10/)).toBeTruthy();
  });

  it('disables Create until a name is entered', () => {
    setup();
    const createBtn = screen.getByRole('button', { name: /create/i });
    expect((createBtn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/name/i), { target: { value: 'Hero' } });
    expect((createBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('calls onCreate with name, class id, and current stat spread', () => {
    const onCreate = vi.fn();
    setup({ onCreate });
    fireEvent.change(screen.getByPlaceholderText(/name/i), { target: { value: 'Hero' } });
    const plusButtons = screen.getAllByRole('button', { name: '+' });
    fireEvent.click(plusButtons[0]);
    fireEvent.click(plusButtons[0]);
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(onCreate).toHaveBeenCalledWith('Hero', expect.any(String), expect.objectContaining({ vitality: 2 }));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace=client -- CharacterCreateModal`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement the modal**

Create `client/src/components/CharacterCreateModal.tsx`:

```tsx
import { useMemo, useState } from 'react';
import {
  CLASS_DEFINITIONS,
  CLASS_STARTER_ITEMS,
  PROGRESSION_CONFIG,
  CHARACTER_CREATION_CONFIG,
  emptyStatPoints,
} from '@caverns/shared';
import type { StatPoints } from '@caverns/shared';
import { CaveBackground } from './CaveBackground.js';

interface Props {
  onCreate: (name: string, className: string, statPoints: StatPoints) => void;
  onCancel: () => void;
}

export function CharacterCreateModal({ onCreate, onCancel }: Props) {
  const [name, setName] = useState('');
  const [className, setClassName] = useState(CLASS_DEFINITIONS[0]?.id ?? 'vanguard');
  const [points, setPoints] = useState<StatPoints>(() => emptyStatPoints());

  const spent = useMemo(
    () => Object.values(points).reduce((sum, n) => sum + n, 0),
    [points],
  );
  const remaining = CHARACTER_CREATION_CONFIG.pointBudget - spent;

  const statDefs = useMemo(
    () => PROGRESSION_CONFIG.statDefinitions.filter((d) => CHARACTER_CREATION_CONFIG.statIds.includes(d.id)),
    [],
  );

  const classDef = CLASS_DEFINITIONS.find((c) => c.id === className);
  const starter = CLASS_STARTER_ITEMS[className];

  const adjust = (id: string, delta: number): void => {
    setPoints((prev) => {
      const current = prev[id] ?? 0;
      const next = current + delta;
      if (next < CHARACTER_CREATION_CONFIG.perStatMin) return prev;
      if (next > CHARACTER_CREATION_CONFIG.perStatMax) return prev;
      if (delta > 0 && remaining <= 0) return prev;
      return { ...prev, [id]: next };
    });
  };

  const canCreate = name.trim().length > 0;

  return (
    <div className="lobby">
      <CaveBackground />
      <img src="/Caverns_Logo.png" alt="Caverns" className="lobby-logo" />
      <p className="lobby-subtitle">Create Character</p>
      <div className="char-create-modal">
        <aside className="char-create-portrait-col">
          <div className="town-portrait char-create-portrait">
            <span className="town-portrait-placeholder">☉</span>
          </div>
          <input
            autoFocus
            className="char-create-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            maxLength={20}
          />
        </aside>

        <section className="char-create-class-col">
          <div className="char-create-class-tabs">
            {CLASS_DEFINITIONS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`char-create-class-tab ${className === c.id ? 'char-create-class-tab-selected' : ''}`}
                onClick={() => setClassName(c.id)}
              >
                {c.displayName}
              </button>
            ))}
          </div>
          {classDef && (
            <>
              <p className="char-create-class-desc">{classDef.description}</p>
              <div className="char-create-loadout">
                <h4>Starting Gear</h4>
                <ul>
                  {starter?.weapon && <li>{starter.weapon.name}</li>}
                  {starter?.offhand && <li>{starter.offhand.name}</li>}
                </ul>
              </div>
              <div className="char-create-abilities">
                <h4>Abilities</h4>
                <ul>
                  {classDef.abilities.map((a) => (
                    <li key={a.id}>
                      <strong>{a.name}</strong> — {a.description}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </section>

        <aside className="char-create-stats-col">
          <div className="char-create-points-header">
            Points: {remaining} / {CHARACTER_CREATION_CONFIG.pointBudget}
          </div>
          <div className="char-create-stats">
            {statDefs.map((def) => (
              <div key={def.id} className="char-create-stat-row">
                <span className="char-create-stat-name">{def.displayName}</span>
                <button type="button" onClick={() => adjust(def.id, -1)}>−</button>
                <span className="char-create-stat-value">{points[def.id] ?? 0}</span>
                <button type="button" onClick={() => adjust(def.id, +1)}>+</button>
              </div>
            ))}
          </div>
        </aside>
      </div>
      <div className="lobby-choose">
        <button
          className="lobby-start"
          onClick={() => onCreate(name.trim(), className, points)}
          disabled={!canCreate}
        >
          Create
        </button>
        <button className="lobby-start" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
```

Before using `CLASS_STARTER_ITEMS` and `PROGRESSION_CONFIG`, grep the shared barrel to confirm the exact export names:

Run: `grep -n "CLASS_STARTER_ITEMS\|PROGRESSION_CONFIG" shared/src/index.ts shared/src/classData.ts shared/src/progression.ts`

Adjust the imports to whatever the real export names are. Do not invent names.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace=client -- CharacterCreateModal`
Expected: PASS.

- [ ] **Step 5: Add styles**

Edit `client/src/styles/index.css` — append:

```css
.char-create-modal {
  display: grid;
  grid-template-columns: 160px 1fr 200px;
  gap: 1rem;
  max-width: 720px;
  width: 90vw;
  padding: 1rem;
  border: 2px solid #d4af37;
  background: #0b0d0a;
  color: #d4d4c8;
}
.char-create-portrait-col { display: flex; flex-direction: column; gap: 0.75rem; }
.char-create-portrait { width: 100%; height: 160px; }
.char-create-name { padding: 0.4rem; background: #13140e; border: 1px solid #3a2e1a; color: #d4d4c8; }
.char-create-class-col { min-width: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.char-create-class-tabs { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.char-create-class-tab {
  background: #13140e; border: 1px solid #3a2e1a; color: #d4d4c8;
  padding: 0.3rem 0.6rem; cursor: pointer;
}
.char-create-class-tab-selected { border-color: #d4af37; color: #d4af37; }
.char-create-class-desc { color: #9a8a52; font-style: italic; margin: 0; font-size: 0.85rem; }
.char-create-loadout h4, .char-create-abilities h4 {
  margin: 0 0 0.2rem 0; color: #a89968; font-size: 0.8rem; text-transform: uppercase;
}
.char-create-loadout ul, .char-create-abilities ul { margin: 0; padding-left: 1rem; font-size: 0.85rem; }
.char-create-stats-col { display: flex; flex-direction: column; gap: 0.5rem; }
.char-create-points-header { color: #d4af37; font-weight: bold; text-align: center; }
.char-create-stats { display: flex; flex-direction: column; gap: 0.3rem; }
.char-create-stat-row {
  display: grid; grid-template-columns: 1fr 28px 28px 28px; align-items: center; gap: 0.3rem;
}
.char-create-stat-row button {
  background: #13140e; border: 1px solid #3a2e1a; color: #d4af37; cursor: pointer;
}
.char-create-stat-value { text-align: center; color: #d4d4c8; }
```

- [ ] **Step 6: Mount the modal from CharacterSelect and drop CharacterCreatePanel**

Edit `client/src/components/CharacterSelect.tsx`:

```tsx
import { useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { CharacterSlotCard } from './CharacterSlotCard.js';
import { CharacterCreateModal } from './CharacterCreateModal.js';
import { CaveBackground } from './CaveBackground.js';
import type { StatPoints } from '@caverns/shared';

interface Props {
  onSelect: (id: string) => void;
  onCreate: (name: string, className: string, statPoints: StatPoints) => void;
  onDelete: (id: string) => void;
  onLogout: () => void;
}

const SLOT_CAP = 3;

export function CharacterSelect({ onSelect, onCreate, onDelete, onLogout }: Props) {
  const characters = useGameStore((s) => s.characters);
  const account = useGameStore((s) => s.account);
  const [creatingSlot, setCreatingSlot] = useState<number | null>(null);

  if (creatingSlot !== null) {
    return (
      <CharacterCreateModal
        onCreate={(name, cls, pts) => {
          onCreate(name, cls, pts);
          setCreatingSlot(null);
        }}
        onCancel={() => setCreatingSlot(null)}
      />
    );
  }

  return (
    <div className="lobby">
      <CaveBackground />
      <img src="/Caverns_Logo.png" alt="Caverns" className="lobby-logo" />
      <p className="lobby-subtitle">Choose your character</p>
      {account && <p className="char-select-greeting">Welcome, {account.displayName}</p>}
      <div className="char-slot-grid">
        {Array.from({ length: SLOT_CAP }).map((_, i) => (
          <CharacterSlotCard
            key={i}
            slotIndex={i}
            character={characters[i]}
            onCreate={() => setCreatingSlot(i)}
            onResume={onSelect}
            onDelete={onDelete}
          />
        ))}
      </div>
      <button className="char-select-logout" onClick={onLogout}>
        Logout
      </button>
    </div>
  );
}
```

Delete `client/src/components/CharacterCreatePanel.tsx`.

- [ ] **Step 7: Update the App.tsx call-site of `onCreate`**

Edit `client/src/App.tsx` — find where `<CharacterSelect onCreate={actions.createCharacter} ... />` is rendered. No functional change is needed because `actions.createCharacter` now takes the third argument; TypeScript will enforce this. Run the build to confirm.

Run: `npm run build --workspace=client`
Expected: clean build.

- [ ] **Step 8: Run the client suite**

Run: `npm test --workspace=client`
Expected: all green.

- [ ] **Step 9: Delete orphan world-select components**

Delete:

```bash
rm client/src/components/WorldSelect.tsx
rm client/src/components/WorldCreatePanel.tsx
rm client/src/components/WorldJoinPanel.tsx
```

Remove any imports of these files that still exist. Run the client build again:

Run: `npm run build --workspace=client`
Expected: clean build.

- [ ] **Step 10: Commit**

```bash
git add client/src/components/CharacterCreateModal.tsx \
        client/src/components/CharacterCreateModal.test.tsx \
        client/src/components/CharacterSelect.tsx \
        client/src/styles/index.css \
        client/src/App.tsx
git rm client/src/components/CharacterCreatePanel.tsx \
       client/src/components/WorldSelect.tsx \
       client/src/components/WorldCreatePanel.tsx \
       client/src/components/WorldJoinPanel.tsx
git commit -m "feat(client): point-buy character create modal, drop world select"
```

---

## Task 8: End-to-end smoke

**Files:** none (manual verification step).

- [ ] **Step 1: Start the dev server**

In a Windows terminal from the repo root:

```
npm run dev:server
npm run dev:client
```

- [ ] **Step 2: Walk through the onboarding in the browser**

1. Log in with a new account name.
2. Confirm you land directly on **Character Select** (no world screen).
3. Click an empty slot → the point-buy modal opens.
4. Type a name, click class tabs, confirm starting gear and abilities update.
5. Distribute 10 points across stats; confirm + buttons stop at 5 per stat and at 0 remaining.
6. Click **Create** → the character appears in the slot grid.
7. Select the character → enter the town → confirm combat stats look reasonable (HP/damage/defense/initiative reflect the spread, not the pre-revamp class baselines).

- [ ] **Step 3: Log out and back in**

Confirm that after logout + login the same account still lands on character select with the default world implicitly selected.

- [ ] **Step 4: Commit any follow-up fixes**

If the smoke test surfaces a bug, fix it with a focused commit referencing the failure.

---

## Self-Review Notes

**Spec coverage:**
- Auto-join default world → Task 3.
- Class gates items + abilities only → Task 1 (baseStats flattened).
- Point-buy UI with portrait slot → Task 7.
- Show starting items and abilities in the modal → Task 7.
- Wipe existing characters → Task 5.

**Type consistency:**
- `StatPoints` defined once in `shared/src/characterCreation.ts`, reused in messages/server/client.
- `CreateCharacterInput.statAllocations` (repository) vs `CreateCharacterMessage.statPoints` (wire) — intentional: wire uses the user-facing term, server translates at the handler boundary.

**Known gaps:**
- Portrait PNGs not yet available — Task 7 uses the same placeholder glyph pattern TownView already uses for the stash panel. Swap later when assets land.
- Level-up allocation in PlayerHUD still works unchanged; point-buy seeds `stat_allocations` and level-up keeps adding to it.
