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
