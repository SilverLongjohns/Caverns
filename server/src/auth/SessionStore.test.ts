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
