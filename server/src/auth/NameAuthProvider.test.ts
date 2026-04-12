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
