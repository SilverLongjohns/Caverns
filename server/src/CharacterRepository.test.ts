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
  let worldId: string;

  beforeEach(async () => {
    ({ db, cleanup } = await createTestDb());
    repo = new CharacterRepository(db);
    const acc = await db.insertInto('accounts')
      .values({ auth_provider: 'name', provider_id: 'alice', display_name: 'Alice' } as never)
      .returning('id').executeTakeFirstOrThrow();
    accountId = acc.id;
    const world = await db.insertInto('worlds')
      .values({
        name: 'Test World',
        owner_account_id: accountId,
        invite_code: 'TEST01',
        state: JSON.stringify({}) as never,
      } as never)
      .returning('id').executeTakeFirstOrThrow();
    worldId = world.id;
  });
  afterEach(async () => { await cleanup(); });

  it('creates and lists characters', async () => {
    await repo.create(accountId, worldId, { name: 'Slasher', class: 'vanguard', statAllocations: {} });
    await repo.create(accountId, worldId, { name: 'Sparker', class: 'pyromancer', statAllocations: {} });
    const list = await repo.listForWorld(accountId, worldId);
    expect(list.length).toBe(2);
    expect(list.map((c) => c.name).sort()).toEqual(['Slasher', 'Sparker']);
  });

  it('rejects creation past the slot cap', async () => {
    await repo.create(accountId, worldId, { name: 'A', class: 'vanguard', statAllocations: {} });
    await repo.create(accountId, worldId, { name: 'B', class: 'vanguard', statAllocations: {} });
    await repo.create(accountId, worldId, { name: 'C', class: 'vanguard', statAllocations: {} });
    await expect(repo.create(accountId, worldId, { name: 'D', class: 'vanguard', statAllocations: {} })).rejects.toThrow(/slot/i);
  });

  it('deletes a character', async () => {
    const c = await repo.create(accountId, worldId, { name: 'Doomed', class: 'vanguard', statAllocations: {} });
    await repo.delete(accountId, c.id);
    expect((await repo.listForWorld(accountId, worldId)).length).toBe(0);
  });

  it('writes a snapshot', async () => {
    const c = await repo.create(accountId, worldId, { name: 'Alice', class: 'vanguard', statAllocations: {} });
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
    const c = await repo.create(accountId, worldId, { name: 'Alice', class: 'vanguard', statAllocations: {} });
    await repo.markInUse(c.id, true);
    expect((await repo.getById(c.id))?.in_use).toBe(true);
    await repo.markInUse(c.id, false);
    expect((await repo.getById(c.id))?.in_use).toBe(false);
  });

  it('wipes carry but keeps progression', async () => {
    const c = await repo.create(accountId, worldId, { name: 'Alice', class: 'vanguard', statAllocations: {} });
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
    const c = await repo.create(accountId, worldId, { name: 'Alice', class: 'vanguard', statAllocations: {} });
    await repo.markInUse(c.id, true);
    const cleared = await repo.clearAllInUse();
    expect(cleared).toBeGreaterThanOrEqual(1);
    expect((await repo.getById(c.id))?.in_use).toBe(false);
  });

  it('persists statAllocations from create input', async () => {
    const ch = await repo.create(accountId, worldId, {
      name: 'Hero',
      class: 'vanguard',
      statAllocations: { vitality: 3, ferocity: 2 },
    });
    expect(ch.stat_allocations).toEqual({ vitality: 3, ferocity: 2 });
  });
});
