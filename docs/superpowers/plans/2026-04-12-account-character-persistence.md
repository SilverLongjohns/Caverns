# Account & Character Persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **No git commits — user manages git themselves. Skip any commit steps.**

**Goal:** Add Postgres-backed accounts and persistent characters with mid-run reconnection so players can run multiple dungeons over time.

**Architecture:** Postgres + Kysely query builder + node-pg-migrate. AuthProvider abstraction with a `NameAuthProvider` for now (OAuth-ready). Three pre-game client screens (login → character select → lobby) replace today's single lobby. Character state hydrated into `Player` on `start_game` and snapshotted via a `CharacterRepository` on each significant state change. Reconnection via an in-memory `accountId → sessionId` map; AFK combat turns auto-skip after 10s.

**Tech Stack:** Postgres 16, `pg`, Kysely, node-pg-migrate, docker-compose for local dev. Existing TS monorepo, Vitest, ws.

**Spec:** `docs/superpowers/specs/2026-04-12-account-character-persistence-design.md`

---

## File Structure

### New files

**Server:**
- `server/src/db/connection.ts` — Kysely instance + connection pool from `DATABASE_URL`
- `server/src/db/types.ts` — Kysely `Database` interface (table types)
- `server/src/db/migrations/1744000000_init.sql` — initial schema migration
- `server/src/auth/AuthProvider.ts` — interface
- `server/src/auth/NameAuthProvider.ts` — implementation
- `server/src/auth/SessionStore.ts` — token CRUD
- `server/src/auth/index.ts` — exports
- `server/src/CharacterRepository.ts` — list/create/delete/snapshot, JSON adapters
- `server/src/characterAdapter.ts` — `playerFromCharacter` / `characterFromPlayer` helpers
- `server/src/ActiveSessionMap.ts` — `accountId → sessionId` lookup for reconnection
- `server/src/db/connection.test.ts` — basic connectivity check (skipped if no DB)
- `server/src/auth/NameAuthProvider.test.ts`
- `server/src/auth/SessionStore.test.ts`
- `server/src/CharacterRepository.test.ts`
- `server/src/characterAdapter.test.ts`
- `server/src/ActiveSessionMap.test.ts`
- `server/test-utils/testDb.ts` — spin up an isolated test schema per test file

**Client:**
- `client/src/components/LoginScreen.tsx`
- `client/src/components/CharacterSelect.tsx`
- `client/src/components/CharacterSlotCard.tsx`
- `client/src/components/CharacterCreatePanel.tsx`
- `client/src/auth/sessionStorage.ts` — localStorage wrapper

**Root:**
- `docker-compose.yml` — local Postgres
- `.env.example` — `DATABASE_URL` template

### Modified files

- `package.json` (root + server) — add `pg`, `kysely`, `node-pg-migrate`, scripts
- `shared/src/messages.ts` — new client/server message types
- `server/src/index.ts` — boot-time `clearAllInUse()` + `clearExpiredSessions()`, route new messages
- `server/src/Lobby.ts` — track per-player character + ready state
- `server/src/GameSession.ts` — hydrate from character row, snapshot on triggers, wipe handling, reconnection reattach, AFK turn skip
- `server/src/CombatManager.ts` — AFK turn timer hook
- `client/src/App.tsx` — route auth screens before lobby
- `client/src/store/gameStore.ts` — auth state, character list, session token, new message handlers
- `client/src/hooks/useGameActions.ts` — new action senders
- `client/src/hooks/useWebSocket.ts` — auto-resume on connect if token present
- `client/src/components/Lobby.tsx` — character cards in player list, ready toggle
- `client/src/styles/index.css` — login / character select styling

---

## Phase A — Database foundation

### Task 1: Add dependencies and docker-compose

**Files:**
- Modify: `package.json` (root)
- Modify: `server/package.json`
- Create: `docker-compose.yml`
- Create: `.env.example`
- Modify: `Dockerfile` (env vars only)

- [ ] **Step 1: Install server deps**

Run from repo root:
```
npm install --workspace=server pg kysely
npm install --workspace=server -D @types/pg node-pg-migrate
```

- [ ] **Step 2: Add migrate scripts to `server/package.json`**

Add to the `"scripts"` block:
```json
"migrate": "node-pg-migrate -m src/db/migrations -t pgmigrations --envPath ../.env up",
"migrate:down": "node-pg-migrate -m src/db/migrations -t pgmigrations --envPath ../.env down"
```

- [ ] **Step 3: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: caverns
      POSTGRES_PASSWORD: caverns
      POSTGRES_DB: caverns
    ports:
      - "5432:5432"
    volumes:
      - caverns-pgdata:/var/lib/postgresql/data
volumes:
  caverns-pgdata:
```

- [ ] **Step 4: Create `.env.example`**

```
DATABASE_URL=postgres://caverns:caverns@localhost:5432/caverns
```

- [ ] **Step 5: Verify compose starts**

Run: `docker compose up -d postgres`
Expected: container runs, `docker compose ps` shows `postgres` healthy.

### Task 2: Initial migration

**Files:**
- Create: `server/src/db/migrations/1744000000_init.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- Up Migration
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_provider text NOT NULL,
  provider_id   text NOT NULL,
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (auth_provider, provider_id)
);

CREATE TABLE characters (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name              text NOT NULL,
  class             text NOT NULL,
  level             int  NOT NULL DEFAULT 1,
  xp                int  NOT NULL DEFAULT 0,
  stat_allocations  jsonb NOT NULL DEFAULT '{}',
  equipment         jsonb NOT NULL DEFAULT '{}',
  inventory         jsonb NOT NULL DEFAULT '[]',
  consumables       jsonb NOT NULL DEFAULT '[]',
  gold              int  NOT NULL DEFAULT 0,
  keychain          jsonb NOT NULL DEFAULT '[]',
  in_use            boolean NOT NULL DEFAULT false,
  last_played_at    timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX characters_account_id_idx ON characters(account_id);

CREATE TABLE account_stash (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  items      jsonb NOT NULL DEFAULT '[]',
  gold       int   NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  token       text PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_account_id_idx ON sessions(account_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

-- Down Migration
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS account_stash;
DROP TABLE IF EXISTS characters;
DROP TABLE IF EXISTS accounts;
```

- [ ] **Step 2: Run migration**

Run: `npm run migrate --workspace=server`
Expected: `Migrations complete`. Verify with `psql $DATABASE_URL -c "\dt"` — sees 4 tables.

### Task 3: Kysely connection + types

**Files:**
- Create: `server/src/db/types.ts`
- Create: `server/src/db/connection.ts`

- [ ] **Step 1: Write `db/types.ts`**

```ts
import type { Equipment, Item } from '@caverns/shared';

export interface AccountsTable {
  id: string;
  auth_provider: string;
  provider_id: string;
  display_name: string;
  created_at: Date;
}

export interface CharactersTable {
  id: string;
  account_id: string;
  name: string;
  class: string;
  level: number;
  xp: number;
  stat_allocations: Record<string, number>;
  equipment: Equipment;
  inventory: (Item | null)[];
  consumables: (Item | null)[];
  gold: number;
  keychain: string[];
  in_use: boolean;
  last_played_at: Date | null;
  created_at: Date;
}

export interface AccountStashTable {
  account_id: string;
  items: Item[];
  gold: number;
}

export interface SessionsTable {
  token: string;
  account_id: string;
  created_at: Date;
  expires_at: Date;
}

export interface Database {
  accounts: AccountsTable;
  characters: CharactersTable;
  account_stash: AccountStashTable;
  sessions: SessionsTable;
}
```

- [ ] **Step 2: Write `db/connection.ts`**

```ts
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { Database } from './types.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.warn('[db] DATABASE_URL not set — DB features disabled');
}

export const pool = url
  ? new Pool({ connectionString: url, max: 10 })
  : null;

export const db: Kysely<Database> | null = pool
  ? new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
  : null;

export function requireDb(): Kysely<Database> {
  if (!db) throw new Error('DATABASE_URL not configured');
  return db;
}
```

- [ ] **Step 3: Build server**

Run: `npm run build --workspace=server`
Expected: clean build.

### Task 4: Test DB harness

**Files:**
- Create: `server/test-utils/testDb.ts`

- [ ] **Step 1: Write test harness**

```ts
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import type { Database } from '../src/db/types.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

export async function createTestDb(): Promise<{ db: Kysely<Database>; cleanup: () => Promise<void> }> {
  if (!TEST_URL) throw new Error('TEST_DATABASE_URL or DATABASE_URL must be set for DB tests');
  const schema = `test_${randomUUID().replace(/-/g, '')}`;
  const pool = new Pool({ connectionString: TEST_URL });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  await sql.raw(`CREATE SCHEMA ${schema}`).execute(db);
  await sql.raw(`SET search_path TO ${schema}`).execute(db);
  await sql.raw(`CREATE EXTENSION IF NOT EXISTS pgcrypto`).execute(db);
  // Apply schema inline (mirrors migration). Keep in sync with 1744000000_init.sql.
  await sql.raw(`
    CREATE TABLE accounts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      auth_provider text NOT NULL,
      provider_id text NOT NULL,
      display_name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (auth_provider, provider_id)
    );
    CREATE TABLE characters (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name text NOT NULL,
      class text NOT NULL,
      level int NOT NULL DEFAULT 1,
      xp int NOT NULL DEFAULT 0,
      stat_allocations jsonb NOT NULL DEFAULT '{}',
      equipment jsonb NOT NULL DEFAULT '{}',
      inventory jsonb NOT NULL DEFAULT '[]',
      consumables jsonb NOT NULL DEFAULT '[]',
      gold int NOT NULL DEFAULT 0,
      keychain jsonb NOT NULL DEFAULT '[]',
      in_use boolean NOT NULL DEFAULT false,
      last_played_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE account_stash (
      account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      items jsonb NOT NULL DEFAULT '[]',
      gold int NOT NULL DEFAULT 0
    );
    CREATE TABLE sessions (
      token text PRIMARY KEY,
      account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    );
  `).execute(db);
  return {
    db,
    cleanup: async () => {
      await sql.raw(`DROP SCHEMA ${schema} CASCADE`).execute(db);
      await pool.end();
    },
  };
}
```

- [ ] **Step 2: Verify it can spin up**

Create a throwaway test in `server/src/db/connection.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createTestDb } from '../../test-utils/testDb.js';

describe.skipIf(!process.env.DATABASE_URL)('test db harness', () => {
  it('creates and drops a schema', async () => {
    const { db, cleanup } = await createTestDb();
    const result = await db.selectFrom('accounts').selectAll().execute();
    expect(result).toEqual([]);
    await cleanup();
  });
});
```

Run: `npm test --workspace=server -- connection`
Expected: PASS (or skipped if `DATABASE_URL` not set in CI).

---

## Phase B — Auth backend

### Task 5: AuthProvider interface + NameAuthProvider

**Files:**
- Create: `server/src/auth/AuthProvider.ts`
- Create: `server/src/auth/NameAuthProvider.ts`
- Create: `server/src/auth/NameAuthProvider.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createTestDb } from '../../test-utils/testDb.js';
import { NameAuthProvider } from './NameAuthProvider.js';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';

describe.skipIf(!process.env.DATABASE_URL)('NameAuthProvider', () => {
  let db: Kysely<Database>;
  let cleanup: () => Promise<void>;
  let provider: NameAuthProvider;

  beforeEach(async () => {
    ({ db, cleanup } = await createTestDb());
    provider = new NameAuthProvider(db);
  });
  afterEach(async () => { await cleanup(); });

  it('creates an account on first login', async () => {
    const result = await provider.authenticate({ name: 'Alice' });
    expect(result).not.toBeNull();
    expect(result!.accountId).toBeDefined();
    const row = await db.selectFrom('accounts').selectAll().executeTakeFirst();
    expect(row?.display_name).toBe('Alice');
    expect(row?.provider_id).toBe('alice');
  });

  it('returns the same accountId on second login', async () => {
    const a = await provider.authenticate({ name: 'Alice' });
    const b = await provider.authenticate({ name: '  ALICE  ' });
    expect(a!.accountId).toBe(b!.accountId);
  });

  it('rejects empty names', async () => {
    expect(await provider.authenticate({ name: '' })).toBeNull();
    expect(await provider.authenticate({ name: '   ' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm test --workspace=server -- NameAuthProvider`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `AuthProvider.ts`**

```ts
export interface AuthResult {
  accountId: string;
}

export interface AuthProvider {
  readonly id: 'name' | 'google' | 'discord';
  authenticate(credentials: unknown): Promise<AuthResult | null>;
}
```

- [ ] **Step 4: Implement `NameAuthProvider.ts`**

```ts
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import type { AuthProvider, AuthResult } from './AuthProvider.js';

export class NameAuthProvider implements AuthProvider {
  readonly id = 'name' as const;
  constructor(private db: Kysely<Database>) {}

  async authenticate(credentials: unknown): Promise<AuthResult | null> {
    if (!credentials || typeof credentials !== 'object') return null;
    const raw = (credentials as { name?: unknown }).name;
    if (typeof raw !== 'string') return null;
    const display = raw.trim();
    if (!display) return null;
    const providerId = display.toLowerCase();

    const existing = await this.db.selectFrom('accounts')
      .select('id')
      .where('auth_provider', '=', 'name')
      .where('provider_id', '=', providerId)
      .executeTakeFirst();
    if (existing) return { accountId: existing.id };

    const inserted = await this.db.insertInto('accounts')
      .values({ auth_provider: 'name', provider_id: providerId, display_name: display } as never)
      .returning('id')
      .executeTakeFirstOrThrow();
    return { accountId: inserted.id };
  }
}
```

- [ ] **Step 5: Run test, expect pass**

Run: `npm test --workspace=server -- NameAuthProvider`
Expected: 3 passed.

### Task 6: SessionStore

**Files:**
- Create: `server/src/auth/SessionStore.ts`
- Create: `server/src/auth/SessionStore.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../test-utils/testDb.js';
import { SessionStore } from './SessionStore.js';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';

describe.skipIf(!process.env.DATABASE_URL)('SessionStore', () => {
  let db: Kysely<Database>;
  let cleanup: () => Promise<void>;
  let store: SessionStore;
  let accountId: string;

  beforeEach(async () => {
    ({ db, cleanup } = await createTestDb());
    store = new SessionStore(db);
    const acc = await db.insertInto('accounts')
      .values({ auth_provider: 'name', provider_id: 'alice', display_name: 'Alice' } as never)
      .returning('id').executeTakeFirstOrThrow();
    accountId = acc.id;
  });
  afterEach(async () => { await cleanup(); });

  it('creates and resolves a session', async () => {
    const token = await store.create(accountId);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    const got = await store.resolve(token);
    expect(got?.accountId).toBe(accountId);
  });

  it('returns null for unknown tokens', async () => {
    expect(await store.resolve('nope')).toBeNull();
  });

  it('returns null for expired tokens', async () => {
    const token = await store.create(accountId, -1000);
    expect(await store.resolve(token)).toBeNull();
  });

  it('deletes a token on logout', async () => {
    const token = await store.create(accountId);
    await store.delete(token);
    expect(await store.resolve(token)).toBeNull();
  });

  it('clears expired tokens', async () => {
    await store.create(accountId, -1000);
    await store.create(accountId, 60_000);
    const removed = await store.clearExpired();
    expect(removed).toBe(1);
  });
});
```

- [ ] **Step 2: Implementation**

```ts
import { randomBytes } from 'crypto';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionInfo {
  token: string;
  accountId: string;
  expiresAt: Date;
}

export class SessionStore {
  constructor(private db: Kysely<Database>) {}

  async create(accountId: string, ttlMs: number = DEFAULT_TTL_MS): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.db.insertInto('sessions')
      .values({ token, account_id: accountId, expires_at: expiresAt } as never)
      .execute();
    return token;
  }

  async resolve(token: string): Promise<SessionInfo | null> {
    const row = await this.db.selectFrom('sessions')
      .select(['token', 'account_id', 'expires_at'])
      .where('token', '=', token)
      .executeTakeFirst();
    if (!row) return null;
    if (row.expires_at.getTime() <= Date.now()) return null;
    return { token: row.token, accountId: row.account_id, expiresAt: row.expires_at };
  }

  async delete(token: string): Promise<void> {
    await this.db.deleteFrom('sessions').where('token', '=', token).execute();
  }

  async clearExpired(): Promise<number> {
    const result = await this.db.deleteFrom('sessions')
      .where('expires_at', '<=', new Date())
      .executeTakeFirst();
    return Number(result.numDeletedRows ?? 0);
  }
}
```

- [ ] **Step 3: Tests pass**

Run: `npm test --workspace=server -- SessionStore`
Expected: 5 passed.

---

## Phase C — Character backend

### Task 7: characterAdapter (Player ↔ Character helpers)

**Files:**
- Create: `server/src/characterAdapter.ts`
- Create: `server/src/characterAdapter.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { playerFromCharacter, characterSnapshotFromPlayer } from './characterAdapter.js';
import type { CharactersTable } from './db/types.js';

const baseCharacter = (): CharactersTable => ({
  id: 'char-1',
  account_id: 'acc-1',
  name: 'Alice',
  class: 'vanguard',
  level: 5,
  xp: 120,
  stat_allocations: { strength: 2 },
  equipment: { weapon: null, offhand: null, armor: null, accessory: null },
  inventory: Array(7).fill(null),
  consumables: Array(6).fill(null),
  gold: 42,
  keychain: ['rusty_key'],
  in_use: false,
  last_played_at: null,
  created_at: new Date(),
});

describe('characterAdapter', () => {
  it('hydrates a Player from a character row', () => {
    const p = playerFromCharacter(baseCharacter(), 'conn-1', 'room-1');
    expect(p.id).toBe('conn-1');
    expect(p.name).toBe('Alice');
    expect(p.className).toBe('vanguard');
    expect(p.level).toBe(5);
    expect(p.xp).toBe(120);
    expect(p.gold).toBe(42);
    expect(p.keychain).toEqual(['rusty_key']);
    expect(p.statAllocations).toEqual({ strength: 2 });
    expect(p.roomId).toBe('room-1');
    expect(p.hp).toBeGreaterThan(0);
    expect(p.maxHp).toBe(p.hp);
  });

  it('extracts a snapshot from a Player', () => {
    const p = playerFromCharacter(baseCharacter(), 'conn-1', 'room-1');
    p.gold = 99;
    p.xp = 200;
    const snap = characterSnapshotFromPlayer(p);
    expect(snap.gold).toBe(99);
    expect(snap.xp).toBe(200);
    expect(snap.equipment).toEqual(p.equipment);
    expect(snap.inventory).toEqual(p.inventory);
    expect(snap.consumables).toEqual(p.consumables);
    expect(snap.keychain).toEqual(p.keychain);
    expect(snap.stat_allocations).toEqual(p.statAllocations);
    expect(snap.level).toBe(p.level);
  });
});
```

- [ ] **Step 2: Implementation**

```ts
import type { Player } from '@caverns/shared';
import { computePlayerStats } from '@caverns/shared';
import type { CharactersTable } from './db/types.js';

export type CharacterSnapshot = Pick<
  CharactersTable,
  'name' | 'class' | 'level' | 'xp' | 'stat_allocations' | 'equipment' |
  'inventory' | 'consumables' | 'gold' | 'keychain'
>;

export function playerFromCharacter(
  character: CharactersTable,
  connectionId: string,
  roomId: string,
): Player {
  const player: Player = {
    id: connectionId,
    name: character.name,
    className: character.class,
    maxHp: 0,
    hp: 0,
    roomId,
    equipment: character.equipment,
    consumables: character.consumables,
    inventory: character.inventory,
    status: 'exploring',
    keychain: [...character.keychain],
    energy: 0,
    usedEffects: [],
    xp: character.xp,
    level: character.level,
    unspentStatPoints: 0,
    statAllocations: { ...character.stat_allocations },
    gold: character.gold,
  };
  const stats = computePlayerStats(player);
  player.maxHp = stats.maxHp;
  player.hp = stats.maxHp;
  player.energy = stats.maxEnergy;
  return player;
}

export function characterSnapshotFromPlayer(p: Player): CharacterSnapshot {
  return {
    name: p.name,
    class: p.className,
    level: p.level,
    xp: p.xp,
    stat_allocations: p.statAllocations,
    equipment: p.equipment,
    inventory: p.inventory,
    consumables: p.consumables,
    gold: p.gold,
    keychain: p.keychain,
  };
}
```

- [ ] **Step 3: Tests pass**

Run: `npm test --workspace=server -- characterAdapter`
Expected: 2 passed.

### Task 8: CharacterRepository

**Files:**
- Create: `server/src/CharacterRepository.ts`
- Create: `server/src/CharacterRepository.test.ts`

- [ ] **Step 1: Failing test (covers list/create/delete/update/wipe/in-use lock)**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../test-utils/testDb.js';
import { CharacterRepository } from './CharacterRepository.js';
import type { Kysely } from 'kysely';
import type { Database } from './db/types.js';

describe.skipIf(!process.env.DATABASE_URL)('CharacterRepository', () => {
  let db: Kysely<Database>;
  let cleanup: () => Promise<void>;
  let repo: CharacterRepository;
  let accountId: string;

  beforeEach(async () => {
    ({ db, cleanup } = await createTestDb());
    repo = new CharacterRepository(db);
    const acc = await db.insertInto('accounts')
      .values({ auth_provider: 'name', provider_id: 'alice', display_name: 'Alice' } as never)
      .returning('id').executeTakeFirstOrThrow();
    accountId = acc.id;
  });
  afterEach(async () => { await cleanup(); });

  it('creates and lists characters', async () => {
    await repo.create(accountId, { name: 'Slasher', class: 'vanguard' });
    await repo.create(accountId, { name: 'Sparker', class: 'pyromancer' });
    const list = await repo.listForAccount(accountId);
    expect(list.length).toBe(2);
    expect(list.map((c) => c.name).sort()).toEqual(['Slasher', 'Sparker']);
  });

  it('rejects creation past the slot cap', async () => {
    await repo.create(accountId, { name: 'A', class: 'vanguard' });
    await repo.create(accountId, { name: 'B', class: 'vanguard' });
    await repo.create(accountId, { name: 'C', class: 'vanguard' });
    await expect(repo.create(accountId, { name: 'D', class: 'vanguard' })).rejects.toThrow(/slot/i);
  });

  it('deletes a character', async () => {
    const c = await repo.create(accountId, { name: 'Doomed', class: 'vanguard' });
    await repo.delete(accountId, c.id);
    expect((await repo.listForAccount(accountId)).length).toBe(0);
  });

  it('writes a snapshot', async () => {
    const c = await repo.create(accountId, { name: 'Alice', class: 'vanguard' });
    await repo.snapshot(c.id, {
      name: 'Alice', class: 'vanguard', level: 3, xp: 50,
      stat_allocations: { strength: 1 },
      equipment: { weapon: null, offhand: null, armor: null, accessory: null },
      inventory: Array(7).fill(null), consumables: Array(6).fill(null),
      gold: 75, keychain: ['k1'],
    });
    const reloaded = await repo.getById(c.id);
    expect(reloaded?.level).toBe(3);
    expect(reloaded?.gold).toBe(75);
    expect(reloaded?.keychain).toEqual(['k1']);
  });

  it('marks and clears in_use', async () => {
    const c = await repo.create(accountId, { name: 'Alice', class: 'vanguard' });
    await repo.markInUse(c.id, true);
    expect((await repo.getById(c.id))?.in_use).toBe(true);
    await repo.markInUse(c.id, false);
    expect((await repo.getById(c.id))?.in_use).toBe(false);
  });

  it('wipes carry but keeps progression', async () => {
    const c = await repo.create(accountId, { name: 'Alice', class: 'vanguard' });
    await repo.snapshot(c.id, {
      name: 'Alice', class: 'vanguard', level: 4, xp: 90,
      stat_allocations: { strength: 1 },
      equipment: { weapon: null, offhand: null, armor: null, accessory: null },
      inventory: Array(7).fill(null), consumables: Array(6).fill(null),
      gold: 200, keychain: ['k'],
    });
    await repo.wipe(c.id);
    const w = await repo.getById(c.id);
    expect(w?.level).toBe(4);
    expect(w?.xp).toBe(90);
    expect(w?.stat_allocations).toEqual({ strength: 1 });
    expect(w?.gold).toBe(0);
    expect(w?.keychain).toEqual([]);
    expect(w?.in_use).toBe(false);
  });

  it('clearAllInUse releases stranded locks', async () => {
    const c = await repo.create(accountId, { name: 'Alice', class: 'vanguard' });
    await repo.markInUse(c.id, true);
    const cleared = await repo.clearAllInUse();
    expect(cleared).toBeGreaterThanOrEqual(1);
    expect((await repo.getById(c.id))?.in_use).toBe(false);
  });
});
```

- [ ] **Step 2: Implementation**

```ts
import type { Kysely } from 'kysely';
import type { Database, CharactersTable } from './db/types.js';
import type { CharacterSnapshot } from './characterAdapter.js';

const SLOT_CAP = 3;

export interface CreateCharacterInput {
  name: string;
  class: string;
}

export class CharacterRepository {
  constructor(private db: Kysely<Database>) {}

  async listForAccount(accountId: string): Promise<CharactersTable[]> {
    return this.db.selectFrom('characters')
      .selectAll()
      .where('account_id', '=', accountId)
      .orderBy('created_at', 'asc')
      .execute();
  }

  async getById(id: string): Promise<CharactersTable | undefined> {
    return this.db.selectFrom('characters').selectAll()
      .where('id', '=', id).executeTakeFirst();
  }

  async create(accountId: string, input: CreateCharacterInput): Promise<CharactersTable> {
    const existing = await this.listForAccount(accountId);
    if (existing.length >= SLOT_CAP) throw new Error('Character slot limit reached');
    const inserted = await this.db.insertInto('characters')
      .values({
        account_id: accountId,
        name: input.name.trim(),
        class: input.class,
        equipment: { weapon: null, offhand: null, armor: null, accessory: null },
        inventory: Array(7).fill(null),
        consumables: Array(6).fill(null),
      } as never)
      .returningAll()
      .executeTakeFirstOrThrow();
    return inserted as CharactersTable;
  }

  async delete(accountId: string, characterId: string): Promise<void> {
    await this.db.deleteFrom('characters')
      .where('id', '=', characterId)
      .where('account_id', '=', accountId)
      .execute();
  }

  async snapshot(id: string, snap: CharacterSnapshot): Promise<void> {
    await this.db.updateTable('characters')
      .set({
        name: snap.name,
        class: snap.class,
        level: snap.level,
        xp: snap.xp,
        stat_allocations: snap.stat_allocations as never,
        equipment: snap.equipment as never,
        inventory: snap.inventory as never,
        consumables: snap.consumables as never,
        gold: snap.gold,
        keychain: snap.keychain as never,
        last_played_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
  }

  async markInUse(id: string, inUse: boolean): Promise<void> {
    await this.db.updateTable('characters')
      .set({ in_use: inUse })
      .where('id', '=', id)
      .execute();
  }

  async wipe(id: string): Promise<void> {
    await this.db.updateTable('characters')
      .set({
        equipment: { weapon: null, offhand: null, armor: null, accessory: null } as never,
        inventory: Array(7).fill(null) as never,
        consumables: Array(6).fill(null) as never,
        gold: 0,
        keychain: [] as never,
        in_use: false,
      })
      .where('id', '=', id)
      .execute();
  }

  async clearAllInUse(): Promise<number> {
    const result = await this.db.updateTable('characters')
      .set({ in_use: false })
      .where('in_use', '=', true)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0);
  }
}
```

- [ ] **Step 3: Tests pass**

Run: `npm test --workspace=server -- CharacterRepository`
Expected: 7 passed.

### Task 9: ActiveSessionMap

**Files:**
- Create: `server/src/ActiveSessionMap.ts`
- Create: `server/src/ActiveSessionMap.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { ActiveSessionMap } from './ActiveSessionMap.js';

describe('ActiveSessionMap', () => {
  it('attaches and looks up an account', () => {
    const m = new ActiveSessionMap();
    m.attach('acc-1', 'session-A');
    expect(m.get('acc-1')).toBe('session-A');
  });

  it('detach by accountId removes the entry', () => {
    const m = new ActiveSessionMap();
    m.attach('acc-1', 'session-A');
    m.detach('acc-1');
    expect(m.get('acc-1')).toBeUndefined();
  });

  it('detachSession removes all accounts on that session', () => {
    const m = new ActiveSessionMap();
    m.attach('acc-1', 'sess-A');
    m.attach('acc-2', 'sess-A');
    m.attach('acc-3', 'sess-B');
    m.detachSession('sess-A');
    expect(m.get('acc-1')).toBeUndefined();
    expect(m.get('acc-2')).toBeUndefined();
    expect(m.get('acc-3')).toBe('sess-B');
  });

  it('clear empties everything', () => {
    const m = new ActiveSessionMap();
    m.attach('acc-1', 'sess-A');
    m.clear();
    expect(m.get('acc-1')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Implementation**

```ts
export class ActiveSessionMap {
  private accountToSession = new Map<string, string>();

  attach(accountId: string, sessionId: string): void {
    this.accountToSession.set(accountId, sessionId);
  }

  detach(accountId: string): void {
    this.accountToSession.delete(accountId);
  }

  detachSession(sessionId: string): void {
    for (const [accountId, sid] of this.accountToSession) {
      if (sid === sessionId) this.accountToSession.delete(accountId);
    }
  }

  get(accountId: string): string | undefined {
    return this.accountToSession.get(accountId);
  }

  clear(): void {
    this.accountToSession.clear();
  }
}
```

- [ ] **Step 3: Tests pass**

Run: `npm test --workspace=server -- ActiveSessionMap`
Expected: 4 passed.

---

## Phase D — Shared message protocol

### Task 10: New message types

**Files:**
- Modify: `shared/src/messages.ts`

- [ ] **Step 1: Add new client → server messages**

In `shared/src/messages.ts`, add to the `ClientMessage` union and define each:

```ts
export interface LoginMessage {
  type: 'login';
  name: string;
}
export interface ResumeSessionMessage {
  type: 'resume_session';
  token: string;
}
export interface LogoutMessage {
  type: 'logout';
}
export interface CreateCharacterMessage {
  type: 'create_character';
  name: string;
  class: string;
}
export interface SelectCharacterMessage {
  type: 'select_character';
  characterId: string;
}
export interface DeleteCharacterMessage {
  type: 'delete_character';
  characterId: string;
}
export interface SetReadyMessage {
  type: 'set_ready';
  ready: boolean;
}
```

Add them to the `ClientMessage` union.

- [ ] **Step 2: Add new server → client messages**

```ts
export interface CharacterSummary {
  id: string;
  name: string;
  className: string;
  level: number;
  gold: number;
  lastPlayedAt: string | null;
  inUse: boolean;
}
export interface AccountSummary {
  id: string;
  displayName: string;
}
export interface AuthResultMessage {
  type: 'auth_result';
  token: string;
  account: AccountSummary;
  characters: CharacterSummary[];
}
export interface AuthErrorMessage {
  type: 'auth_error';
  reason: string;
}
export interface CharacterListMessage {
  type: 'character_list';
  characters: CharacterSummary[];
}
```

Add them to the `ServerMessage` union.

- [ ] **Step 3: Extend `LobbyStateMessage` (or the existing lobby snapshot type) with per-player character + ready info**

Find the existing `LobbyStateMessage` (or whatever ships current lobby state) and extend its player entry shape:

```ts
export interface LobbyPlayer {
  connectionId: string;
  accountId: string;
  displayName: string;
  isHost: boolean;
  ready: boolean;
  character?: { id: string; name: string; className: string; level: number };
}
```

Update `LobbyStateMessage.players` to use `LobbyPlayer[]`.

- [ ] **Step 4: Build shared**

Run: `npm run build --workspace=shared`
Expected: clean.

---

## Phase E — Server message handlers

### Task 11: Auth + character message routing

**Files:**
- Modify: `server/src/index.ts`
- Create: `server/src/handlers/authHandlers.ts`
- Create: `server/src/handlers/characterHandlers.ts`

- [ ] **Step 1: Wire DB-backed services into server boot**

In `server/src/index.ts`, near the top of module init:

```ts
import { db, requireDb } from './db/connection.js';
import { NameAuthProvider } from './auth/NameAuthProvider.js';
import { SessionStore } from './auth/SessionStore.js';
import { CharacterRepository } from './CharacterRepository.js';
import { ActiveSessionMap } from './ActiveSessionMap.js';

const nameAuth = db ? new NameAuthProvider(db) : null;
const sessions = db ? new SessionStore(db) : null;
const characters = db ? new CharacterRepository(db) : null;
const activeSessions = new ActiveSessionMap();

if (characters) {
  await characters.clearAllInUse();
}
if (sessions) {
  await sessions.clearExpired();
}
```

Note: top-level `await` requires the module is ESM (it already is).

- [ ] **Step 2: Track per-connection auth state**

The server already maps `WebSocket → connectionId`. Add a parallel `connectionAccounts: Map<string, { accountId: string; sessionToken: string; characterId?: string }>` near other connection state.

```ts
const connectionAccounts = new Map<string, {
  accountId: string;
  sessionToken: string;
  characterId?: string;
}>();
```

- [ ] **Step 3: Route the new messages**

In the giant `handleClientMessage` switch in `server/src/index.ts`, add cases:

```ts
case 'login': {
  if (!nameAuth || !sessions) {
    sendTo(ws, { type: 'auth_error', reason: 'Database unavailable' });
    break;
  }
  const result = await nameAuth.authenticate({ name: msg.name });
  if (!result) {
    sendTo(ws, { type: 'auth_error', reason: 'Invalid name' });
    break;
  }
  const token = await sessions.create(result.accountId);
  connectionAccounts.set(connectionId, { accountId: result.accountId, sessionToken: token });
  await sendAuthResult(ws, result.accountId, token);
  break;
}

case 'resume_session': {
  if (!sessions || !characters) {
    sendTo(ws, { type: 'auth_error', reason: 'Database unavailable' });
    break;
  }
  const info = await sessions.resolve(msg.token);
  if (!info) {
    sendTo(ws, { type: 'auth_error', reason: 'Session expired' });
    break;
  }
  connectionAccounts.set(connectionId, { accountId: info.accountId, sessionToken: info.token });
  await sendAuthResult(ws, info.accountId, info.token);
  // Reconnection reattach handled in Task 16.
  break;
}

case 'logout': {
  const ctx = connectionAccounts.get(connectionId);
  if (ctx && sessions) await sessions.delete(ctx.sessionToken);
  connectionAccounts.delete(connectionId);
  break;
}

case 'create_character': {
  const ctx = connectionAccounts.get(connectionId);
  if (!ctx || !characters) { sendTo(ws, { type: 'auth_error', reason: 'Not logged in' }); break; }
  try {
    await characters.create(ctx.accountId, { name: msg.name, class: msg.class });
  } catch (e) {
    sendTo(ws, { type: 'auth_error', reason: (e as Error).message });
    break;
  }
  const list = await characters.listForAccount(ctx.accountId);
  sendTo(ws, { type: 'character_list', characters: list.map(toSummary) });
  break;
}

case 'delete_character': {
  const ctx = connectionAccounts.get(connectionId);
  if (!ctx || !characters) break;
  await characters.delete(ctx.accountId, msg.characterId);
  const list = await characters.listForAccount(ctx.accountId);
  sendTo(ws, { type: 'character_list', characters: list.map(toSummary) });
  break;
}

case 'select_character': {
  const ctx = connectionAccounts.get(connectionId);
  if (!ctx || !characters) break;
  const ch = await characters.getById(msg.characterId);
  if (!ch || ch.account_id !== ctx.accountId) { sendTo(ws, { type: 'error', message: 'Character not found' }); break; }
  if (ch.in_use) { sendTo(ws, { type: 'error', message: 'Character already in use' }); break; }
  await characters.markInUse(ch.id, true);
  ctx.characterId = ch.id;
  // Wire selected character into lobby (Task 12).
  lobby.attachCharacterToConnection(connectionId, {
    id: ch.id, name: ch.name, className: ch.class, level: ch.level,
  });
  break;
}

case 'set_ready': {
  lobby.setReady(connectionId, msg.ready);
  break;
}
```

- [ ] **Step 4: Add helpers (same file or `handlers/authHandlers.ts`)**

```ts
async function sendAuthResult(ws: WebSocket, accountId: string, token: string) {
  if (!characters || !db) return;
  const acc = await db.selectFrom('accounts').select(['id', 'display_name']).where('id', '=', accountId).executeTakeFirstOrThrow();
  const list = await characters.listForAccount(accountId);
  sendTo(ws, {
    type: 'auth_result',
    token,
    account: { id: acc.id, displayName: acc.display_name },
    characters: list.map(toSummary),
  });
}

function toSummary(row: { id: string; name: string; class: string; level: number; gold: number; last_played_at: Date | null; in_use: boolean }) {
  return {
    id: row.id,
    name: row.name,
    className: row.class,
    level: row.level,
    gold: row.gold,
    lastPlayedAt: row.last_played_at?.toISOString() ?? null,
    inUse: row.in_use,
  };
}
```

(If you split into `handlers/authHandlers.ts`, export these and import them in `index.ts`.)

- [ ] **Step 5: Build server**

Run: `npm run build --workspace=server`
Expected: clean. Tests still pass: `npm test --workspace=server`.

### Task 12: Lobby tracks characters + ready state

**Files:**
- Modify: `server/src/Lobby.ts`

- [ ] **Step 1: Extend Lobby's per-player state**

Add:

```ts
interface LobbyEntry {
  connectionId: string;
  accountId: string;
  displayName: string;
  isHost: boolean;
  ready: boolean;
  character?: { id: string; name: string; className: string; level: number };
}
```

Replace the existing in-memory player list with `Map<string, LobbyEntry>` keyed by connectionId.

- [ ] **Step 2: New methods**

```ts
attachCharacterToConnection(connectionId: string, character: NonNullable<LobbyEntry['character']>): void {
  const entry = this.entries.get(connectionId);
  if (!entry) return;
  entry.character = character;
  entry.ready = false; // re-pick = unready
  this.broadcastLobbyState();
}

setReady(connectionId: string, ready: boolean): void {
  const entry = this.entries.get(connectionId);
  if (!entry || !entry.character) return;
  entry.ready = ready;
  this.broadcastLobbyState();
}

allReady(): boolean {
  return [...this.entries.values()].every((e) => e.character && e.ready);
}
```

- [ ] **Step 3: Update `start_game` gate**

Wherever `start_game` is currently allowed to fire (host check), add:

```ts
if (!lobby.allReady()) {
  sendTo(ws, { type: 'error', message: 'Not all players are ready' });
  break;
}
```

- [ ] **Step 4: Build + test**

Run: `npm run build --workspace=server && npm test --workspace=server`
Expected: clean and green (existing lobby tests may need updating to provide character + ready state).

### Task 13: GameSession hydrates Player from character

**Files:**
- Modify: `server/src/GameSession.ts`

- [ ] **Step 1: Take CharacterRepository + ActiveSessionMap as constructor deps**

```ts
constructor(
  // ...existing params...
  private characters: CharacterRepository | null,
  private activeSessions: ActiveSessionMap,
  private sessionId: string,
) { /* ... */ }
```

- [ ] **Step 2: Replace blank-Player creation in `start_game` flow**

Wherever the session currently calls `createPlayer(...)` for each lobby entry, replace with:

```ts
if (this.characters && entry.character) {
  const row = await this.characters.getById(entry.character.id);
  if (row) {
    const player = playerFromCharacter(row, entry.connectionId, entranceRoomId);
    this.playerManager.addPlayer(player);
    this.activeSessions.attach(row.account_id, this.sessionId);
    await this.characters.snapshot(row.id, characterSnapshotFromPlayer(player));
    continue;
  }
}
// Fallback for DB-less mode
this.playerManager.addPlayer(createPlayer(entry.connectionId, entry.displayName, entranceRoomId));
```

- [ ] **Step 3: Build + test**

Run: `npm run build --workspace=server && npm test --workspace=server`
Expected: clean. Existing tests that construct GameSession need to pass `null, new ActiveSessionMap(), 'test-session'`.

### Task 14: Snapshot write triggers in GameSession

**Files:**
- Modify: `server/src/GameSession.ts`

- [ ] **Step 1: Add `snapshotPlayer(playerId)` helper**

```ts
private async snapshotPlayer(playerId: string): Promise<void> {
  if (!this.characters) return;
  const player = this.playerManager.getPlayer(playerId);
  if (!player) return;
  const ctx = this.connectionContexts.get(playerId);
  if (!ctx?.characterId) return;
  await this.characters.snapshot(ctx.characterId, characterSnapshotFromPlayer(player));
}
```

(`connectionContexts` is the new per-connection account/character map passed in from `index.ts` — wire it through GameSession's constructor.)

- [ ] **Step 2: Add a debounced gold writer**

```ts
private goldWriteTimers = new Map<string, NodeJS.Timeout>();

private scheduleGoldSnapshot(playerId: string): void {
  const existing = this.goldWriteTimers.get(playerId);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    this.goldWriteTimers.delete(playerId);
    void this.snapshotPlayer(playerId);
  }, 500);
  this.goldWriteTimers.set(playerId, t);
}
```

- [ ] **Step 3: Hook the snapshot calls**

In each of these GameSession code sites, add the appropriate call:

| Site | Call |
| ---- | ---- |
| Level-up handler | `await this.snapshotPlayer(playerId);` |
| Equip / drop / unequip | `await this.snapshotPlayer(playerId);` |
| Consumable use / pickup | `await this.snapshotPlayer(playerId);` |
| Keychain change (key pickup, locked-exit consume) | `await this.snapshotPlayer(playerId);` |
| `awardGoldToRoom` (or wherever gold lands on a player) | `this.scheduleGoldSnapshot(playerId);` |

- [ ] **Step 4: Build + test**

Run: `npm run build --workspace=server && npm test --workspace=server`
Expected: clean and green.

### Task 15: Run-end handlers (graceful, wipe, all-disconnect)

**Files:**
- Modify: `server/src/GameSession.ts`

- [ ] **Step 1: Graceful end snapshot**

In the boss-defeated / victory branch, before clearing the session:

```ts
for (const player of this.playerManager.getAllPlayers()) {
  await this.snapshotPlayer(player.id);
  const ctx = this.connectionContexts.get(player.id);
  if (ctx?.characterId && this.characters) {
    await this.characters.markInUse(ctx.characterId, false);
  }
  if (ctx?.accountId) this.activeSessions.detach(ctx.accountId);
}
```

- [ ] **Step 2: Wipe handler**

In the wipe-detected branch (all players downed):

```ts
for (const player of this.playerManager.getAllPlayers()) {
  const ctx = this.connectionContexts.get(player.id);
  if (ctx?.characterId && this.characters) {
    await this.characters.wipe(ctx.characterId);
  }
  if (ctx?.accountId) this.activeSessions.detach(ctx.accountId);
}
```

(`wipe` already clears `in_use`.)

- [ ] **Step 3: All-clients-disconnect path**

In the existing cleanup path that fires when the session has no remaining clients:

```ts
for (const player of this.playerManager.getAllPlayers()) {
  await this.snapshotPlayer(player.id);
  const ctx = this.connectionContexts.get(player.id);
  if (ctx?.characterId && this.characters) {
    await this.characters.markInUse(ctx.characterId, false);
  }
  if (ctx?.accountId) this.activeSessions.detach(ctx.accountId);
}
```

- [ ] **Step 4: Build + test**

Run: `npm run build --workspace=server && npm test --workspace=server`
Expected: clean and green.

### Task 16: Reconnection reattach

**Files:**
- Modify: `server/src/index.ts`
- Modify: `server/src/GameSession.ts`

- [ ] **Step 1: Add `GameSession.reattachConnection(oldConnectionId, newConnectionId, ws)`**

```ts
reattachConnection(oldConnectionId: string, newConnectionId: string, ws: WebSocket): boolean {
  const player = this.playerManager.getPlayer(oldConnectionId);
  if (!player) return false;
  this.playerManager.replacePlayerId(oldConnectionId, newConnectionId);
  this.clientSockets.set(newConnectionId, ws);
  this.clientSockets.delete(oldConnectionId);
  // Send a full state catch-up
  this.sendCatchUp(newConnectionId);
  return true;
}

private sendCatchUp(connectionId: string): void {
  const player = this.playerManager.getPlayer(connectionId);
  if (!player) return;
  const room = this.rooms.get(player.roomId);
  this.sendTo(connectionId, { type: 'room_reveal', room, /* ... */ });
  if (this.activeCombat) this.sendTo(connectionId, { type: 'combat_state', /* ... */ });
  this.sendTo(connectionId, { type: 'player_update', player });
}
```

(`PlayerManager.replacePlayerId` is a small helper — add it: just rekey the internal map.)

- [ ] **Step 2: Wire reattach in `resume_session` handler**

After successful `sessions.resolve`:

```ts
const existingSessionId = activeSessions.get(info.accountId);
if (existingSessionId) {
  const session = activeSessionsById.get(existingSessionId);
  if (session) {
    // Find old connectionId in this session for that account
    const oldConn = session.findConnectionByAccount(info.accountId);
    if (oldConn) {
      session.reattachConnection(oldConn, connectionId, ws);
      connectionAccounts.set(connectionId, { accountId: info.accountId, sessionToken: info.token, characterId: session.getCharacterIdFor(oldConn) });
      return; // skip lobby routing
    }
  }
}
```

(`activeSessionsById` is the existing session-id-keyed map in `index.ts`. `findConnectionByAccount` and `getCharacterIdFor` are new GameSession helpers — small lookups against `connectionContexts`.)

- [ ] **Step 3: Build + test**

Run: `npm run build --workspace=server && npm test --workspace=server`
Expected: clean and green.

### Task 17: AFK combat turn auto-skip

**Files:**
- Modify: `server/src/CombatManager.ts`
- Modify: `server/src/GameSession.ts`

- [ ] **Step 1: Add a 10s skip timer when an AFK player's turn starts**

In `CombatManager`, after `currentTurnId` advances to a player:

```ts
private afkTimer: NodeJS.Timeout | null = null;

private armAfkTimer(playerId: string, isAfk: () => boolean, onSkip: () => void): void {
  this.cancelAfkTimer();
  this.afkTimer = setTimeout(() => {
    if (isAfk()) onSkip();
  }, 10_000);
}

cancelAfkTimer(): void {
  if (this.afkTimer) {
    clearTimeout(this.afkTimer);
    this.afkTimer = null;
  }
}
```

- [ ] **Step 2: Hook from GameSession**

When advancing combat turn, after determining `currentTurnId`:

```ts
const id = this.activeCombat.currentTurnId;
const isPlayer = this.playerManager.getPlayer(id) != null;
if (isPlayer) {
  this.combatManager.armAfkTimer(
    id,
    () => !this.clientSockets.has(id),
    () => {
      this.combatManager.advanceTurn(); // existing helper
      this.broadcastCombatState();
    },
  );
}
```

When a player reconnects (Task 16) or takes any combat action: `this.combatManager.cancelAfkTimer();`.

- [ ] **Step 3: Build + test**

Run: `npm run build --workspace=server && npm test --workspace=server`
Expected: clean and green.

---

## Phase F — Client UI

### Task 18: Auth state in the store

**Files:**
- Modify: `client/src/store/gameStore.ts`
- Create: `client/src/auth/sessionStorage.ts`

- [ ] **Step 1: Add session storage helper**

```ts
const KEY = 'caverns.session';

export function loadSessionToken(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function saveSessionToken(token: string): void {
  try { localStorage.setItem(KEY, token); } catch { /* ignore */ }
}

export function clearSessionToken(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
```

- [ ] **Step 2: Extend the store**

Add to `gameStore`'s state:

```ts
authStatus: 'unauthenticated' | 'authenticated' | 'character_selected';
account: { id: string; displayName: string } | null;
characters: CharacterSummary[];
selectedCharacterId: string | null;
authError: string | null;
```

Default `authStatus: 'unauthenticated'`.

- [ ] **Step 3: Add message handlers**

In `handleServerMessage`, add cases:

```ts
case 'auth_result':
  saveSessionToken(msg.token);
  set({
    authStatus: 'authenticated',
    account: msg.account,
    characters: msg.characters,
    authError: null,
  });
  break;

case 'auth_error':
  set({ authError: msg.reason });
  break;

case 'character_list':
  set({ characters: msg.characters });
  break;
```

- [ ] **Step 4: Build client**

Run: `npm run build --workspace=client`
Expected: clean.

### Task 19: Auto-resume on connect

**Files:**
- Modify: `client/src/hooks/useWebSocket.ts`

- [ ] **Step 1: After ws opens, attempt resume**

In the ws `onopen` handler (or wherever the initial messages are sent):

```ts
const token = loadSessionToken();
if (token) {
  ws.send(JSON.stringify({ type: 'resume_session', token }));
}
```

If there's no token, the user lands on the login screen.

- [ ] **Step 2: Build + smoke**

Run: `npm run build --workspace=client`
Expected: clean.

### Task 20: Login screen

**Files:**
- Create: `client/src/components/LoginScreen.tsx`
- Modify: `client/src/hooks/useGameActions.ts`

- [ ] **Step 1: Add `login` action sender**

In `useGameActions.ts`:

```ts
login: (name: string) => send({ type: 'login', name }),
logout: () => send({ type: 'logout' }),
createCharacter: (name: string, className: string) => send({ type: 'create_character', name, class: className }),
selectCharacter: (characterId: string) => send({ type: 'select_character', characterId }),
deleteCharacter: (characterId: string) => send({ type: 'delete_character', characterId }),
setReady: (ready: boolean) => send({ type: 'set_ready', ready }),
```

- [ ] **Step 2: Build LoginScreen**

```tsx
import { useState } from 'react';
import { useGameStore } from '../store/gameStore.js';

interface Props { onLogin: (name: string) => void }

export function LoginScreen({ onLogin }: Props) {
  const [name, setName] = useState('');
  const error = useGameStore((s) => s.authError);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) onLogin(name.trim());
  };
  return (
    <div className="screen-center">
      <h1>Caverns</h1>
      <form onSubmit={submit} className="login-form">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter your name"
          maxLength={32}
        />
        <button type="submit" disabled={!name.trim()}>Enter</button>
      </form>
      {error && <p className="auth-error">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Build client**

Run: `npm run build --workspace=client`
Expected: clean.

### Task 21: Character select screen

**Files:**
- Create: `client/src/components/CharacterSelect.tsx`
- Create: `client/src/components/CharacterSlotCard.tsx`
- Create: `client/src/components/CharacterCreatePanel.tsx`

- [ ] **Step 1: SlotCard component**

```tsx
import type { CharacterSummary } from '@caverns/shared';

interface Props {
  slotIndex: number;
  character?: CharacterSummary;
  onCreate: () => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
}

function relative(date: string | null): string {
  if (!date) return 'never';
  const ms = Date.now() - new Date(date).getTime();
  const days = Math.floor(ms / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

export function CharacterSlotCard({ slotIndex, character, onCreate, onResume, onDelete }: Props) {
  if (!character) {
    return (
      <div className="char-slot char-slot-empty" onClick={onCreate}>
        <div className="char-slot-number">Slot {slotIndex + 1}</div>
        <div className="char-slot-empty-label">+ Create character</div>
      </div>
    );
  }
  return (
    <div className="char-slot char-slot-filled">
      <div className="char-slot-name">{character.name}</div>
      <div className="char-slot-meta">Lv {character.level} · {character.className}</div>
      <div className="char-slot-meta">{character.gold}g · last {relative(character.lastPlayedAt)}</div>
      <div className="char-slot-actions">
        <button onClick={() => onResume(character.id)} disabled={character.inUse}>
          {character.inUse ? 'In use' : 'Resume'}
        </button>
        <button className="char-slot-delete" onClick={() => {
          if (confirm(`Delete ${character.name}?`)) onDelete(character.id);
        }}>Delete</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: CreatePanel component**

```tsx
import { useState } from 'react';
import { CLASS_DEFINITIONS } from '@caverns/shared';

interface Props {
  onCreate: (name: string, className: string) => void;
  onCancel: () => void;
}

export function CharacterCreatePanel({ onCreate, onCancel }: Props) {
  const [name, setName] = useState('');
  const [className, setClassName] = useState(CLASS_DEFINITIONS[0]?.id ?? 'vanguard');
  return (
    <div className="char-create">
      <h2>Create Character</h2>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" maxLength={20} />
      <div className="char-create-classes">
        {CLASS_DEFINITIONS.map((c) => (
          <label key={c.id}>
            <input type="radio" checked={className === c.id} onChange={() => setClassName(c.id)} />
            {c.name}
          </label>
        ))}
      </div>
      <div className="char-create-actions">
        <button onClick={() => onCreate(name.trim(), className)} disabled={!name.trim()}>Create</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
```

(If `CLASS_DEFINITIONS` isn't directly exported from shared, look up the existing class registry export — there is one based on `getClassDefinition`.)

- [ ] **Step 3: CharacterSelect screen**

```tsx
import { useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { CharacterSlotCard } from './CharacterSlotCard.js';
import { CharacterCreatePanel } from './CharacterCreatePanel.js';

interface Props {
  onSelect: (id: string) => void;
  onCreate: (name: string, className: string) => void;
  onDelete: (id: string) => void;
}

const SLOT_CAP = 3;

export function CharacterSelect({ onSelect, onCreate, onDelete }: Props) {
  const characters = useGameStore((s) => s.characters);
  const [creatingSlot, setCreatingSlot] = useState<number | null>(null);

  if (creatingSlot !== null) {
    return (
      <CharacterCreatePanel
        onCreate={(name, cls) => { onCreate(name, cls); setCreatingSlot(null); }}
        onCancel={() => setCreatingSlot(null)}
      />
    );
  }

  return (
    <div className="screen-center">
      <h1>Choose your character</h1>
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
    </div>
  );
}
```

- [ ] **Step 4: Build client**

Run: `npm run build --workspace=client`
Expected: clean.

### Task 22: App routing through new screens

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Read auth status and render**

Replace the `connected` / `in_lobby` branch:

```tsx
const authStatus = useGameStore((s) => s.authStatus);
// ...
} else if (authStatus === 'unauthenticated') {
  content = <LoginScreen onLogin={actions.login} />;
} else if (authStatus === 'authenticated') {
  content = (
    <CharacterSelect
      onSelect={actions.selectCharacter}
      onCreate={actions.createCharacter}
      onDelete={actions.deleteCharacter}
    />
  );
} else if (connectionStatus === 'connected' || connectionStatus === 'in_lobby') {
  content = <Lobby onJoin={actions.joinLobby} onStart={actions.startGame} onSetDifficulty={actions.setDifficulty} />;
}
```

The store should set `authStatus = 'character_selected'` on `select_character` ack (or transition through `lobby_state` arrival). Adjust `handleServerMessage` so that the first `lobby_state` for an authenticated client sets `authStatus = 'character_selected'`.

- [ ] **Step 2: Build client**

Run: `npm run build --workspace=client`
Expected: clean.

### Task 23: Lobby ready toggle + character cards

**Files:**
- Modify: `client/src/components/Lobby.tsx`

- [ ] **Step 1: Render character info per player**

Replace the existing player-name list with:

```tsx
{lobbyPlayers.map((p) => (
  <div key={p.connectionId} className="lobby-player-row">
    <div className="lobby-player-name">{p.displayName}{p.isHost && ' (host)'}</div>
    {p.character ? (
      <div className="lobby-player-char">{p.character.name} · Lv {p.character.level} {p.character.className}</div>
    ) : (
      <div className="lobby-player-char muted">no character</div>
    )}
    <div className={`lobby-player-ready ${p.ready ? 'ready' : ''}`}>{p.ready ? 'READY' : '...'}</div>
  </div>
))}
```

- [ ] **Step 2: Local "Ready" toggle**

```tsx
<button onClick={() => setReady(!myReady)} className="lobby-ready-btn">
  {myReady ? 'Unready' : 'Ready'}
</button>
```

- [ ] **Step 3: Disable Start until everyone ready**

```tsx
<button onClick={onStart} disabled={!allReady}>Start Game</button>
```

- [ ] **Step 4: Build client**

Run: `npm run build --workspace=client`
Expected: clean.

### Task 24: Styling

**Files:**
- Modify: `client/src/styles/index.css`

- [ ] **Step 1: Add classes for the new components**

Match existing CRT theme (no new colors or effects):

```css
.login-form { display: flex; gap: 0.5rem; margin-top: 1rem; }
.login-form input { background: #000; color: #d4ffd4; border: 1px solid #2a4a2a; padding: 0.5rem; }

.char-slot-grid { display: flex; gap: 1rem; margin-top: 1rem; }
.char-slot {
  border: 1px solid #2a4a2a;
  padding: 1rem; min-width: 14rem;
  background: rgba(0, 20, 0, 0.3);
}
.char-slot-empty { cursor: pointer; opacity: 0.6; text-align: center; }
.char-slot-name { font-size: 1.2rem; color: #d4ffd4; }
.char-slot-meta { color: #80b080; font-size: 0.85rem; }
.char-slot-actions { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
.char-slot-delete { color: #d47080; }

.lobby-player-row { display: flex; gap: 1rem; align-items: center; }
.lobby-player-ready.ready { color: #d4ffd4; }
.lobby-player-ready { color: #80b080; }
.lobby-ready-btn { margin-top: 1rem; }

.auth-error { color: #d47080; }
```

- [ ] **Step 2: Build client**

Run: `npm run build --workspace=client`
Expected: clean.

---

## Phase G — Verification

### Task 25: Final sweep

- [ ] **Step 1: Migrate the dev DB**

Run: `docker compose up -d postgres && npm run migrate --workspace=server`
Expected: schema applied.

- [ ] **Step 2: Full build + test**

Run: `npm run build && npx vitest run`
Expected: all workspaces build, all tests green (DB-touching suites only run when `DATABASE_URL` is set).

- [ ] **Step 3: Manual smoke checklist (browser)**

  1. First visit → Login screen. Enter "Alice" → land on Character Select with 3 empty slots.
  2. Create "Slasher" (vanguard). Slot 1 fills.
  3. Reload page → resume drops you back at Character Select (token saved).
  4. Resume Slasher → lobby shows you with character card, Ready toggle visible.
  5. Click Ready → toggle reflects. Start Game enables (host, solo).
  6. Start a run, kill a mob, pick up gold + an item, check `psql` that `gold` and `inventory` updated.
  7. Reload mid-run → resume drops you back into the dungeon at the same room (reconnection).
  8. Wipe (debug-kill the party) → character row's `equipment`, `inventory`, `gold`, `keychain` all cleared, `level`/`xp` preserved.

- [ ] **Step 4: Railway deployment notes**

Add to `README.md` (or create `docs/deployment.md`) a short section:

```
1. Add a Railway Postgres service.
2. Link it to the app service so DATABASE_URL is auto-injected.
3. Set RUN_MIGRATIONS_ON_BOOT=true OR run `npm run migrate -w server` from a one-off task before first deploy.
```

(If you want auto-migrate on boot, add a small `await runMigrations()` call near the top of `index.ts` before `clearAllInUse` — node-pg-migrate exposes a programmatic API.)

---

## Spec coverage check

- **Storage** → Tasks 1–4
- **AuthProvider abstraction + NameAuthProvider** → Task 5
- **Sessions table + token flow** → Task 6
- **WS message protocol** → Task 10
- **Lobby flow / character select / ready** → Tasks 11, 12, 22, 23
- **CharacterRepository + write triggers** → Tasks 8, 14
- **Hydration / snapshot helpers** → Task 7
- **Wipe semantics** → Tasks 8, 15
- **`in_use` lock + boot clear** → Tasks 8, 11, 15
- **Reconnection + active session map** → Tasks 9, 16
- **AFK turn skip** → Task 17
- **Client login / character select / lobby UI** → Tasks 18–24
- **Local Postgres via docker-compose** → Task 1
- **Railway DATABASE_URL docs** → Task 25
