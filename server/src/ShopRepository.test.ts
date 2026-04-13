import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../test-utils/testDb.js';
import { ShopRepository } from './ShopRepository.js';
import { CharacterRepository } from './CharacterRepository.js';
import type { Kysely } from 'kysely';
import type { Database } from './db/types.js';
import type { Item } from '@caverns/shared';

describe.skipIf(!process.env.DATABASE_URL)('ShopRepository', () => {
  let db: Kysely<Database>;
  let cleanup: () => Promise<void>;
  let repo: ShopRepository;
  let chars: CharacterRepository;
  let accountId: string;
  let worldId: string;
  let characterId: string;

  beforeEach(async () => {
    ({ db, cleanup } = await createTestDb());
    repo = new ShopRepository(db);
    chars = new CharacterRepository(db);
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
    const c = await chars.create(accountId, worldId, { name: 'Alice', class: 'vanguard' });
    characterId = c.id;
  });

  afterEach(async () => { await cleanup(); });

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
    } as unknown as Item;
    await repo.ensure(characterId, 'starter_general_store');
    await repo.setRotating(characterId, 'starter_general_store', [item, null, null, null]);
    const row = await repo.get(characterId, 'starter_general_store');
    expect(row.rotating_items).toHaveLength(4);
    expect(row.rotating_items[0]?.id).toBe('gen_weapon_abc123');
    expect(row.rotating_items[1]).toBeNull();
  });
});
