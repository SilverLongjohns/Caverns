# Account & Character Persistence — Design

**Date:** 2026-04-12
**Status:** Approved, ready for plan

## Goal

Add accounts and persistent characters to Caverns so players can run multiple
dungeons over time. First pass uses a name-only "log in" flow with the auth
provider abstracted so OAuth slots in later. Persistence covers character
progression, equipment, and gold; supports mid-run reconnection.

## Storage

**Database:** Postgres (Railway-managed in production, docker-compose locally).
**Driver:** `pg`. **Query layer:** Kysely (type-safe, codegen-free).
**Migrations:** `node-pg-migrate` with SQL files run via `npm run migrate`.

Connection from `process.env.DATABASE_URL`. Railway injects this when the
Postgres service is linked to the app service. Local dev uses a
`docker-compose.yml` Postgres container.

### Schema

```sql
accounts (
  id            uuid primary key default gen_random_uuid(),
  auth_provider text not null,
  provider_id   text not null,
  display_name  text not null,
  created_at    timestamptz not null default now(),
  unique (auth_provider, provider_id)
)

characters (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references accounts(id) on delete cascade,
  name              text not null,
  class             text not null,
  level             int  not null default 1,
  xp                int  not null default 0,
  stat_allocations  jsonb not null default '{}',
  equipment         jsonb not null default '{}',
  inventory         jsonb not null default '[]',
  consumables       jsonb not null default '[]',
  gold              int  not null default 0,
  keychain          jsonb not null default '[]',
  in_use            boolean not null default false,
  last_played_at    timestamptz,
  created_at        timestamptz not null default now()
)

account_stash (
  account_id  uuid primary key references accounts(id) on delete cascade,
  items       jsonb not null default '[]',
  gold        int   not null default 0
)

sessions (
  token       text primary key,
  account_id  uuid not null references accounts(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
)
```

JSON blobs match the existing in-memory shapes from `shared/src/types.ts` —
`Equipment`, `Item[]`, `Record<string, number>` for `stat_allocations`,
`string[]` for `keychain`. No type drift.

## Authentication

### Provider abstraction

```ts
interface AuthProvider {
  id: 'name' | 'google' | 'discord';
  authenticate(credentials: unknown): Promise<{ accountId: string } | null>;
}
```

### NameAuthProvider (the only implementation in this pass)

- Takes `{ name: string }`.
- Normalizes: trim + lowercase.
- Looks up `(auth_provider='name', provider_id=normalized)`.
- Creates the account on first sight (`display_name` = original casing).
- Returns `{ accountId }`.

OAuth providers slot in later as new implementations, no schema changes.

### Sessions

- On successful auth, server generates a 32-byte random token, inserts a
  `sessions` row with `expires_at = now() + 30 days`.
- Client stores token in `localStorage` under `caverns.session`.
- On page load, client sends `resume_session { token }`. Server validates
  (exists, not expired), returns `auth_result`. Invalid → falls back to login.
- Logout deletes the row and clears `localStorage`.

### New WS messages

**Client → Server:**
- `login { name }`
- `resume_session { token }`
- `logout`
- `select_character { characterId }`
- `create_character { name, class }`
- `delete_character { characterId }`
- `set_ready { ready }`

**Server → Client:**
- `auth_result { token, account, characters }`
- `auth_error { reason }`
- `character_list { characters }`
- `lobby_state` (extended to include each player's character card and ready
  state)

## Lobby & Character Flow

### Screens (client)

1. **Login** — single name input + Enter button. Sends `login`. On success,
   stores token, advances to character select.
2. **Character Select** — three slot cards:
   - **Empty slot:** "Create" panel with name input + class picker (uses
     existing `getClassDefinition` data).
   - **Filled slot:** displays `<name> · Lv N <class> · <gold>g · last played
     <relative date>` with **Resume** and **Delete** buttons. Delete prompts
     for confirmation.
3. **Lobby** — same screen as today, but each player row shows their character
   card (name, level, class) instead of just a name. Each player has a
   **Ready** toggle. Host's **Start Game** button is disabled until all
   players are ready.

### Server flow

- `select_character` marks the character `in_use=true` and attaches it to the
  WS connection's session. Broadcasts updated `lobby_state`.
- `set_ready` broadcasts.
- `start_game` (host only) only fires when all players are ready. Hydrates the
  in-memory `Player` from each character row instead of a blank starter.
- On disconnect mid-lobby: clear `in_use`, drop from lobby.
- On disconnect mid-run: keep `in_use=true`, character stays in the world,
  reconnection path available (see below).

### Character "in use" lock

Prevents the same character from being selected in two simultaneous lobbies.
Cleared on:
- Session end (graceful or all-clients-disconnect)
- Server boot (clear all stale `in_use` rows on startup)
- Manual unstick (out of scope for now; flagged for admin tools later)

## Run Lifecycle & Persistence

A `CharacterRepository` wraps all writes so call sites stay clean.

### Write triggers

| Event                          | Fields written                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| `start_game`                   | `last_played_at` only (snapshot is the loaded character)                                    |
| Level up                       | `level`, `xp`, `stat_allocations`                                                           |
| Gold change                    | `gold` (debounced 500ms)                                                                    |
| Equip / unequip / drop         | `equipment`, `inventory`                                                                    |
| Consumable use / pickup        | `consumables`                                                                               |
| Keychain change                | `keychain`                                                                                  |
| Graceful run end (boss / exit) | Full snapshot, clear `in_use`                                                               |
| Wipe                           | Reset `equipment`, `inventory`, `consumables`, `gold`, `keychain` to empty/zero. Keep `level`, `xp`, `stat_allocations`. Clear `in_use` |
| All clients disconnect mid-run | Full snapshot of last-known state, clear `in_use` (treated as a save point, not a wipe)     |

### Hydration / snapshot helpers

Two pure functions in shared (or server) code:

- `playerFromCharacter(character, roomId, connectionId): Player` — creates the
  in-memory `Player` for the run.
- `characterFromPlayer(player): CharacterUpdate` — extracts the persistable
  fields for snapshotting.

The current `Player` interface already carries every persisted field. No
in-game shape changes needed.

## Reconnection

### Mechanics

- Server maintains an in-memory `accountId → activeSessionId` map for accounts
  currently in a run.
- On `resume_session`, after token validation:
  - If the account is in the active map, re-attach the new WS to the existing
    player slot and reply with the current room and combat state.
  - Otherwise, route to the lobby normally.
- The disconnected player's character stays in the world (`hp`, position,
  inventory all intact) until the session ends or they reconnect.

### Combat turn handling

- If a disconnected player's turn comes up, server starts a 10-second timer.
- On expiry, **skip** their turn and advance initiative.
- Reconnect mid-timer cancels the skip.
- AFK players cycle through skipped turns indefinitely without blocking the
  party.

### Edge cases

- All clients disconnect → run ends, snapshot, clear `in_use`. Same as today's
  cleanup path.
- Server crash / reboot → in-memory map is lost, everyone returns to the
  lobby with their last snapshot. (Matches Fork A — no save-game persistence.)
- Reconnect after run already ended (boss cleared, wipe, or all-disconnect
  cleanup ran) → routes to lobby normally; the active-map lookup misses.

## Scope

### In scope

- Postgres + Kysely + node-pg-migrate
- Four tables: `accounts`, `characters`, `account_stash`, `sessions`
- `AuthProvider` interface + `NameAuthProvider`
- Login screen, character select screen (3 slots), updated lobby screen with
  ready toggles
- New WS messages listed above
- `CharacterRepository` with all write triggers
- Wipe = reset carry, keep progression
- `in_use` lock with boot-time clear
- Mid-run reconnection (memory-only; Fork A)
- 10-second combat turn auto-skip for AFK players
- `docker-compose.yml` for local Postgres
- Railway `DATABASE_URL` linking documentation

### Out of scope (flagged for later)

- Save-game style session persistence (Fork B)
- Stash UI (table exists, no consumer)
- OAuth providers (interface ready, no implementations)
- Password reset / account recovery
- Character rename or stat re-spec
- Multiple characters per player in the same run
- Admin tools (manual `in_use` unstick, character migration)

## Risks

- **Crash window for debounced writes.** Up to 500ms of gold changes can be
  lost on hard crash. Acceptable for vertical slice.
- **`in_use` strand on crash.** Mitigated by boot-time clear. Server restart
  unlocks every character — acceptable trade.
- **AFK turn-cycling.** A permanently disconnected player will keep getting
  skipped every initiative cycle. Acceptable; their party isn't blocked.
- **Active-session map is memory-only.** A server crash drops everyone to the
  lobby with their last snapshot — matches the chosen Fork A model.
- **Postgres adds a hard dependency** for local dev. Mitigated by
  `docker-compose.yml`. Alternative is running a local Postgres directly.
