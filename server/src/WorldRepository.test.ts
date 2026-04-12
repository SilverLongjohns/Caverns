import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../test-utils/testDb.js';
import { WorldRepository } from './WorldRepository.js';
import type { Kysely } from 'kysely';
import type { Database } from './db/types.js';

describe.skipIf(!process.env.DATABASE_URL)('WorldRepository', () => {
  let db: Kysely<Database>;
  let cleanup: () => Promise<void>;
  let repo: WorldRepository;
  let accountId: string;
  let accountId2: string;

  beforeEach(async () => {
    ({ db, cleanup } = await createTestDb());
    repo = new WorldRepository(db);

    const acc1 = await db.insertInto('accounts')
      .values({ auth_provider: 'name', provider_id: 'alice', display_name: 'Alice' } as never)
      .returning('id').executeTakeFirstOrThrow();
    accountId = acc1.id;

    const acc2 = await db.insertInto('accounts')
      .values({ auth_provider: 'name', provider_id: 'bob', display_name: 'Bob' } as never)
      .returning('id').executeTakeFirstOrThrow();
    accountId2 = acc2.id;
  });

  afterEach(async () => { await cleanup(); });

  it('create returns a row and auto-adds owner as a member', async () => {
    const world = await repo.create(accountId, 'Caverns');
    expect(world.id).toBeTruthy();
    expect(world.name).toBe('Caverns');
    expect(world.owner_account_id).toBe(accountId);
    expect(world.invite_code).toMatch(/^[A-Z0-9]{6}$/);

    const isMember = await repo.isMember(world.id, accountId);
    expect(isMember).toBe(true);
  });

  it('two worlds with the same name for the same owner throws a unique constraint', async () => {
    await repo.create(accountId, 'Caverns');
    await expect(repo.create(accountId, 'Caverns')).rejects.toThrow();
  });

  it('two different owners can both create worlds named "Caverns" without conflict', async () => {
    const w1 = await repo.create(accountId, 'Caverns');
    const w2 = await repo.create(accountId2, 'Caverns');
    expect(w1.id).not.toBe(w2.id);
    expect(w1.name).toBe('Caverns');
    expect(w2.name).toBe('Caverns');
  });

  it('getByInviteCode returns the correct world; unknown code returns undefined', async () => {
    const world = await repo.create(accountId, 'MyWorld');
    const found = await repo.getByInviteCode(world.invite_code);
    expect(found?.id).toBe(world.id);

    const notFound = await repo.getByInviteCode('XXXXXX');
    expect(notFound).toBeUndefined();
  });

  it('getById returns the world; unknown id returns undefined', async () => {
    const world = await repo.create(accountId, 'MyWorld');
    const found = await repo.getById(world.id);
    expect(found?.id).toBe(world.id);

    const notFound = await repo.getById('00000000-0000-0000-0000-000000000000');
    expect(notFound).toBeUndefined();
  });

  it('addMember adds a member; calling addMember twice is idempotent', async () => {
    const world = await repo.create(accountId, 'MyWorld');

    await repo.addMember(world.id, accountId2);
    expect(await repo.isMember(world.id, accountId2)).toBe(true);

    // Second call should not throw
    await expect(repo.addMember(world.id, accountId2)).resolves.not.toThrow();
    expect(await repo.countMembers(world.id)).toBe(2);
  });

  it('isMember returns true for owner, true for added member, false for non-member', async () => {
    const world = await repo.create(accountId, 'MyWorld');

    expect(await repo.isMember(world.id, accountId)).toBe(true);

    await repo.addMember(world.id, accountId2);
    expect(await repo.isMember(world.id, accountId2)).toBe(true);

    const acc3 = await db.insertInto('accounts')
      .values({ auth_provider: 'name', provider_id: 'carol', display_name: 'Carol' } as never)
      .returning('id').executeTakeFirstOrThrow();
    expect(await repo.isMember(world.id, acc3.id)).toBe(false);
  });

  it('listForAccount returns all worlds the account belongs to (owned and joined), ordered by created_at', async () => {
    // Alice owns w1, Bob owns w2, Alice joins w2
    const w1 = await repo.create(accountId, 'World One');
    const w2 = await repo.create(accountId2, 'World Two');
    await repo.addMember(w2.id, accountId);

    const list = await repo.listForAccount(accountId);
    expect(list.length).toBe(2);
    // Order by created_at asc — w1 was created first
    expect(list[0].id).toBe(w1.id);
    expect(list[1].id).toBe(w2.id);
  });

  it('countMembers returns 1 after create, 2 after addMember, 1 after removeMember', async () => {
    const world = await repo.create(accountId, 'MyWorld');
    expect(await repo.countMembers(world.id)).toBe(1);

    await repo.addMember(world.id, accountId2);
    expect(await repo.countMembers(world.id)).toBe(2);

    await repo.removeMember(world.id, accountId2);
    expect(await repo.countMembers(world.id)).toBe(1);
  });

  it('removeMember removes the row', async () => {
    const world = await repo.create(accountId, 'MyWorld');
    await repo.addMember(world.id, accountId2);
    expect(await repo.isMember(world.id, accountId2)).toBe(true);

    await repo.removeMember(world.id, accountId2);
    expect(await repo.isMember(world.id, accountId2)).toBe(false);
  });

  it('snapshotState round-trips a jsonb value correctly', async () => {
    const world = await repo.create(accountId, 'MyWorld');
    const state = { floor: 1, bossDefeated: false, treasures: ['gold', 'gems'] };

    await repo.snapshotState(world.id, state);

    const reloaded = await repo.getById(world.id);
    expect(reloaded?.state).toEqual(state);
  });
});
