# Overworld Phase 1 — Schema & Membership

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **No git commits — user manages git themselves. Skip any commit steps.**

**Goal:** Add `worlds` and `world_members` tables, bind every character to a world, nuke pre-existing characters, and introduce a world-select screen between login and character select. No overworld gameplay yet — this phase is pure plumbing so Phase 2 can wire a `WorldSession` on top of it.

**Context:** `docs/superpowers/plans/2026-04-12-overworld-feature.md`

**Phase roadmap:** This is phase 1 of 6. Phases 1 and 2 are intended to ship as one PR — when Phase 1 lands on disk, start Phase 2 immediately without cutting a release.

---

## Decisions locked in this phase

1. **Existing characters are destroyed, not migrated.** The migration drops all rows from `characters` before adding the `world_id NOT NULL` column. Accounts are preserved; characters are gone.
2. **Character → world binding is permanent.** `characters.world_id` is NOT NULL and has no update path. Creating a character requires specifying which world it belongs to.
3. **An account can be in multiple worlds.** `world_members` is a true many-to-many. The UI lets the user pick which world they're operating in, and character-list queries are filtered by that selection.
4. **World names are free-form text, 1–32 chars, unique per owner.** No global uniqueness — two owners can both have a world named "Caverns." One owner cannot.
5. **Joining a world uses an invite code.** Each world has a short (6-char) invite code exposed only to members. An account with the code can join the world. Owners can regenerate the code (deferred to Phase 1.5 if it complicates things — see Open Questions).
6. **Owner cannot leave their own world.** Ownership transfer is deferred. For v1, worlds are effectively bound to their creator.
7. **Default world on first login.** When an authenticated account has zero worlds, the client's world-select screen auto-opens the "Create World" form instead of showing an empty list. No auto-creation.

---

## File structure

### New files

**Server:**
- `server/src/db/migrations/1744200000_worlds.sql` — add worlds tables, drop existing characters, add `world_id` to characters
- `server/src/WorldRepository.ts` — CRUD for `worlds` + `world_members`
- `server/src/WorldRepository.test.ts`

**Shared:**
- Nothing new in Phase 1. Message types for world operations are added to `shared/src/messages.ts`.

**Client:**
- `client/src/components/WorldSelect.tsx` — lists worlds, "Create World" form, "Join World" form
- `client/src/components/WorldCreatePanel.tsx` — world name input, submit
- `client/src/components/WorldJoinPanel.tsx` — invite code input, submit
- No new styles — reuse the `.lobby` shell + `CaveBackground` pattern from `LoginScreen.tsx` / `CharacterSelect.tsx`.

### Modified files

**Server:**
- `server/src/db/types.ts` — add `WorldsTable`, `WorldMembersTable`, extend `CharactersTable` with `world_id` and `overworld_pos`
- `server/src/CharacterRepository.ts` — `create` takes `worldId`, `listForAccount` gains an optional `worldId` filter, add `listForWorld(accountId, worldId)`
- `server/src/index.ts` — new message routing: `list_worlds`, `create_world`, `join_world`, `select_world`. `select_character` validates the character belongs to a world the account is a member of. `create_character` requires a selected world.
- `server/src/characterAdapter.ts` — carry `world_id` + `overworld_pos` through the snapshot helpers (no behavior change yet; just field plumbing)

**Shared:**
- `shared/src/messages.ts` — new client messages: `list_worlds`, `create_world { name }`, `join_world { inviteCode }`, `select_world { worldId }`. New server messages: `world_list { worlds: WorldSummary[] }`, `world_selected { worldId }`, `world_error { reason }`. New type `WorldSummary { id, name, ownerDisplayName, memberCount, inviteCode? }` (invite code only included for members).

**Client:**
- `client/src/App.tsx` — insert world-select step between login and character-select. Only render CharacterSelect / CharacterCreatePanel after a world has been selected.
- `client/src/store/gameStore.ts` — new state: `worlds: WorldSummary[]`, `selectedWorldId: string | null`. New handlers for `world_list`, `world_selected`, `world_error`. Character list is now filtered / refetched after world selection.
- `client/src/hooks/useGameActions.ts` — new senders: `listWorlds`, `createWorld(name)`, `joinWorld(inviteCode)`, `selectWorld(worldId)`
- `client/src/components/CharacterCreatePanel.tsx` — title / subtitle now shows "Creating character in <worldName>"; the server uses `selectedWorldId` from the connection context, no UI field needed.

### Files NOT touched in Phase 1

These are explicitly out of scope for this phase even if they feel relevant:

- `server/src/GameSession.ts` — no world awareness yet
- `server/src/Lobby.ts` — the old lobby flow keeps working unchanged
- `server/src/PlayerManager.ts` — no world-related changes
- Any overworld map, tile, or movement code

---

## Task list

### Task 1: Schema migration

**Files:**
- Create: `server/src/db/migrations/1744200000_worlds.sql`

- [ ] **Step 1: Write the up migration**

```sql
-- Up Migration

CREATE TABLE worlds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  seed             bigint NOT NULL DEFAULT 0,
  owner_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  invite_code      text NOT NULL,
  state            jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_account_id, name),
  UNIQUE (invite_code)
);
CREATE INDEX worlds_owner_idx ON worlds(owner_account_id);

CREATE TABLE world_members (
  world_id   uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, account_id)
);
CREATE INDEX world_members_account_idx ON world_members(account_id);

-- Nuke existing characters so we can add a NOT NULL world_id without backfill.
DELETE FROM characters;

ALTER TABLE characters
  ADD COLUMN world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  ADD COLUMN overworld_pos jsonb;

CREATE INDEX characters_world_id_idx ON characters(world_id);
```

- [ ] **Step 2: Write the down migration**

```sql
-- Down Migration
ALTER TABLE characters DROP COLUMN IF EXISTS overworld_pos;
ALTER TABLE characters DROP COLUMN IF EXISTS world_id;
DROP TABLE IF EXISTS world_members;
DROP TABLE IF EXISTS worlds;
```

- [ ] **Step 3: Run the migration locally**

```
npm run migrate -w server
```

Verify `\dt` in psql shows `worlds` and `world_members`, and `\d characters` shows the new columns. Confirm the existing characters table is empty.

### Task 2: Kysely types

**Files:**
- Modify: `server/src/db/types.ts`

- [ ] **Step 1: Add `WorldsTable` and `WorldMembersTable` interfaces**

```ts
export interface WorldsTable {
  id: string;
  name: string;
  seed: number | string; // bigint comes back as string from pg
  owner_account_id: string;
  invite_code: string;
  state: Record<string, unknown>;
  created_at: Date;
}

export interface WorldMembersTable {
  world_id: string;
  account_id: string;
  joined_at: Date;
}
```

- [ ] **Step 2: Extend `CharactersTable`**

Add `world_id: string;` and `overworld_pos: { x: number; y: number } | null;`.

- [ ] **Step 3: Register tables in `Database`**

```ts
export interface Database {
  accounts: AccountsTable;
  characters: CharactersTable;
  account_stash: AccountStashTable;
  sessions: SessionsTable;
  worlds: WorldsTable;
  world_members: WorldMembersTable;
}
```

### Task 3: `WorldRepository`

**Files:**
- Create: `server/src/WorldRepository.ts`
- Create: `server/src/WorldRepository.test.ts`

- [ ] **Step 1: Implement the repository**

```ts
export class WorldRepository {
  constructor(private db: Kysely<Database>) {}

  async create(ownerAccountId: string, name: string): Promise<WorldsTable>;
  async getById(id: string): Promise<WorldsTable | undefined>;
  async getByInviteCode(code: string): Promise<WorldsTable | undefined>;
  async listForAccount(accountId: string): Promise<WorldsTable[]>;
  async addMember(worldId: string, accountId: string): Promise<void>;
  async removeMember(worldId: string, accountId: string): Promise<void>;
  async isMember(worldId: string, accountId: string): Promise<boolean>;
  async snapshotState(worldId: string, state: Record<string, unknown>): Promise<void>;
  async countMembers(worldId: string): Promise<number>;
}
```

Invite code: 6 uppercase alphanumeric chars, generated at `create` time. Retry up to 5 times on uniqueness collision; throw on further failure.

`create` must also insert the owner into `world_members` as the first member, in the same transaction.

`listForAccount` joins `worlds` with `world_members` filtered by `account_id` and returns world rows (with invite_code, since the caller is a member).

- [ ] **Step 2: Write tests**

Use the existing `testDb` helper. Cover:
- Create world → owner is auto-added as member
- Create two worlds for the same owner with the same name → second throws
- Two different owners can create worlds with the same name
- `getByInviteCode` returns the right world
- `addMember` is idempotent (or documented as not — pick one, document, test)
- `isMember` returns true for owner, true for added member, false for non-member
- `listForAccount` returns every world the account is a member of, both owned and joined

### Task 4: Shared message types

**Files:**
- Modify: `shared/src/messages.ts`

- [ ] **Step 1: Add client message types**

```ts
| { type: 'list_worlds' }
| { type: 'create_world'; name: string }
| { type: 'join_world'; inviteCode: string }
| { type: 'select_world'; worldId: string }
```

- [ ] **Step 2: Add server message types**

```ts
| { type: 'world_list'; worlds: WorldSummary[] }
| { type: 'world_selected'; worldId: string }
| { type: 'world_error'; reason: string }
```

- [ ] **Step 3: Add `WorldSummary` type**

```ts
export interface WorldSummary {
  id: string;
  name: string;
  ownerDisplayName: string;
  memberCount: number;
  isOwner: boolean;
  inviteCode: string; // always present — only sent to members
}
```

- [ ] **Step 4: `create_character` now requires a selected world**

No schema change to the message — the server validates the connection's `selectedWorldId` context. Document the invariant in a comment above the message type.

### Task 5: Server message handlers

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Instantiate `WorldRepository` alongside other repos**

In the DB init block next to `characterRepo`, create `worldRepo = new WorldRepository(db)`. Pass it through to the message switch via closure (same pattern as `characterRepo`).

- [ ] **Step 2: Add `selectedWorldId` to connection context**

`connectionAccounts` values gain an optional `selectedWorldId: string | null`. Initialize to `null` on login. This is the per-connection "which world am I currently operating in" marker.

- [ ] **Step 3: Handle `list_worlds`**

```ts
case 'list_worlds': {
  const ctx = connectionAccounts.get(playerId);
  if (!ctx || !worldRepo) { sendTo(playerId, { type: 'world_error', reason: 'Not logged in' }); break; }
  const rows = await worldRepo.listForAccount(ctx.accountId);
  const summaries = await Promise.all(rows.map(async (w) => ({
    id: w.id,
    name: w.name,
    ownerDisplayName: /* lookup via accountRepo or join */,
    memberCount: await worldRepo.countMembers(w.id),
    isOwner: w.owner_account_id === ctx.accountId,
    inviteCode: w.invite_code,
  })));
  sendTo(playerId, { type: 'world_list', worlds: summaries });
  break;
}
```

Consider adding `ownerDisplayName` to `listForAccount`'s returned shape via a join instead of N+1 lookups. Acceptable either way for v1.

- [ ] **Step 4: Handle `create_world`**

Validate: logged in, name is 1–32 chars, trimmed, not empty. On success, call `worldRepo.create`, then re-send `world_list` so the client refreshes.

- [ ] **Step 5: Handle `join_world`**

Validate: logged in, invite code matches an existing world, account is not already a member. Call `addMember`, re-send `world_list`.

- [ ] **Step 6: Handle `select_world`**

Validate: account is a member of the target world. Set `ctx.selectedWorldId = msg.worldId`. Respond with `world_selected { worldId }`. Then fetch and send `character_list` filtered to that world.

- [ ] **Step 7: Update `select_character`**

Validate that the character's `world_id` matches `ctx.selectedWorldId`. Reject with `world_error` if not.

- [ ] **Step 8: Update `create_character`**

Validate `ctx.selectedWorldId` is set. Pass it through to `characterRepo.create`. Reject with `world_error` if no world is selected.

- [ ] **Step 9: Update `character_list` scoping**

Anywhere the server currently sends `character_list` (after login, after create, after delete), the list must now be scoped to `ctx.selectedWorldId`. If no world is selected, send an empty list.

### Task 6: `CharacterRepository` updates

**Files:**
- Modify: `server/src/CharacterRepository.ts`
- Modify: `server/src/CharacterRepository.test.ts` (if it exists; create if not)

- [ ] **Step 1: `create` takes a `worldId`**

Signature becomes `create(accountId: string, worldId: string, input: CreateCharacterInput)`. Insert the `world_id` column alongside the existing values.

- [ ] **Step 2: Rename `listForAccount` → `listForWorld`**

New signature: `listForWorld(accountId: string, worldId: string)`. Filters on both columns so an account in multiple worlds sees only the selected world's characters. Update all call sites in `index.ts`.

- [ ] **Step 3: `overworld_pos` round-trips**

`snapshot` accepts `overworld_pos` and writes it. `getById` returns it. No behavior in Phase 1 actually writes it — this is plumbing for Phase 3.

### Task 7: `characterAdapter` plumbing

**Files:**
- Modify: `server/src/characterAdapter.ts`

- [ ] **Step 1: Carry `world_id` and `overworld_pos` through `CharacterSnapshot`**

Add the fields to the `CharacterSnapshot` interface. `characterFromPlayer` preserves them from the source character row (they don't come from `Player` state — nothing in-game mutates them yet). `playerFromCharacter` ignores them (Player type doesn't need to know).

This keeps the snapshot path field-complete so Phase 3 can write positions without schema work.

### Task 8: Client state

**Files:**
- Modify: `client/src/store/gameStore.ts`

- [ ] **Step 1: Add world state**

```ts
worlds: WorldSummary[];
selectedWorldId: string | null;
```

Initial values: `[]` and `null`.

- [ ] **Step 2: Handle new server messages**

- `world_list`: set `worlds`, clear `selectedWorldId` if the current selection is no longer in the list.
- `world_selected`: set `selectedWorldId`.
- `world_error`: surface via an existing error toast / inline message pattern.

- [ ] **Step 3: Clear world state on logout**

The existing logout handler clears auth state — extend it to also clear `worlds` and `selectedWorldId`.

### Task 9: Client actions

**Files:**
- Modify: `client/src/hooks/useGameActions.ts`

- [ ] **Step 1: Add senders**

```ts
listWorlds: () => send({ type: 'list_worlds' }),
createWorld: (name: string) => send({ type: 'create_world', name }),
joinWorld: (inviteCode: string) => send({ type: 'join_world', inviteCode }),
selectWorld: (worldId: string) => {
  send({ type: 'select_world', worldId });
  useGameStore.setState({ selectedWorldId: worldId });
},
```

Optimistic `selectedWorldId` set mirrors the existing `selectCharacter` pattern.

### Task 10: `WorldSelect` screen

**Files:**
- Create: `client/src/components/WorldSelect.tsx`
- Create: `client/src/components/WorldCreatePanel.tsx`
- Create: `client/src/components/WorldJoinPanel.tsx`

- [ ] **Step 1: `WorldSelect.tsx`**

Layout matches `CharacterSelect.tsx`: `.lobby` shell + `CaveBackground` + logo + subtitle. Body renders:

- If `worlds.length === 0`: show an empty-state message and auto-switch to the create-world sub-view.
- Otherwise: list each world as a card showing name, member count, owner indicator, and the invite code. Clicking a card calls `selectWorld(id)`.
- Bottom row: "Create World" and "Join World" buttons that toggle sub-views.

On mount, call `listWorlds()` to refresh.

- [ ] **Step 2: `WorldCreatePanel.tsx`**

Name input (DOS-prompt style, matching `LoginScreen.tsx`), 1–32 char validation, submit → `createWorld(name)`. Cancel → back to list.

- [ ] **Step 3: `WorldJoinPanel.tsx`**

6-char invite code input (similar to the 4-char room code input in `Lobby.tsx`), submit → `joinWorld(code)`. Cancel → back to list.

### Task 11: `App.tsx` routing

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Insert WorldSelect between auth and character select**

After login, the render order is: `LoginScreen` → `WorldSelect` → `CharacterSelect` → (existing lobby flow). The gating condition:

- `authStatus === 'authenticated'` and `!selectedWorldId` → render `WorldSelect`
- `authStatus === 'authenticated'` and `selectedWorldId` and `!selectedCharacterId` → render `CharacterSelect`

Leave the existing in-lobby and in-game branches untouched. The old lobby flow still runs after character selection, exactly as today.

### Task 12: Smoke test path

- [ ] **Step 1: Manual walkthrough**

1. Log in as a fresh account. Expect empty world list → auto-open create form.
2. Create world "Test World." Expect it to appear in the list with invite code visible.
3. Select it. Expect transition to CharacterSelect with an empty character list.
4. Create character. Expect it to appear.
5. Enter the existing lobby flow (unchanged). Expect it to work.
6. Log out. Log in as a second account. Expect empty world list.
7. Join with the invite code from account #1. Expect the world to appear.
8. Select it. Expect CharacterSelect to be empty (account #2 has no characters in this world yet).
9. Create a second character. Both accounts can now see each other as members of the same world.

- [ ] **Step 2: Integration check — existing flow still works**

Confirm that after selecting a world and a character, the existing lobby → start game → dungeon flow runs exactly as before. Phase 1 must not break any existing gameplay.

---

## Open questions to resolve during implementation

1. **Ownership of `ownerDisplayName` lookup.** Join in the repository layer, or N+1 via the account repo? Either is fine; pick one in Task 5 and stay consistent.
2. **Invite code rotation.** Not exposed in UI in Phase 1. If a world's invite code needs rotating during testing, the plan is "just re-create the world." Add a rotate endpoint in Phase 1.5 if the user asks.
3. **Self-join protection.** If the owner tries to join their own world via `join_world`, return a friendly `world_error` rather than silently succeeding. Test it.
4. **Empty-state auto-open.** The UX of "zero worlds → auto-open create" can feel surprising. If it does, change to "show an empty state with a prominent Create button" — purely cosmetic.

---

## Done when

- All tasks checked off.
- Manual smoke test (Task 12) passes end-to-end.
- `npm run test -w server` passes, including the new `WorldRepository` tests.
- `npm run build` in client and server is clean.
- Old lobby flow post-character-select is unchanged and still playable.
- A fresh DB bootstrapped from migrations (not from an existing dev DB) produces the expected schema with `worlds`, `world_members`, and `characters.world_id`.
