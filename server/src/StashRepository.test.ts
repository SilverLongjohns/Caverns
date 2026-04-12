import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../test-utils/testDb.js';
import { StashRepository } from './StashRepository.js';
import { CharacterRepository } from './CharacterRepository.js';
import type { Kysely } from 'kysely';
import type { Database } from './db/types.js';
import type { Item } from '@caverns/shared';

describe.skipIf(!process.env.DATABASE_URL)('StashRepository', () => {
  let db: Kysely<Database>;
  let cleanup: () => Promise<void>;
  let repo: StashRepository;
  let chars: CharacterRepository;
  let accountId: string;
  let worldId: string;
  let characterId: string;

  beforeEach(async () => {
    ({ db, cleanup } = await createTestDb());
    repo = new StashRepository(db);
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

  it('ensure creates an empty row with 20 null slots', async () => {
    const row = await repo.ensure(characterId);
    expect(row.character_id).toBe(characterId);
    expect(row.capacity).toBe(20);
    expect(row.items.length).toBe(20);
    expect(row.items.every((i) => i === null)).toBe(true);
  });

  it('ensure is idempotent on an existing row', async () => {
    const fake: Item = { id: 'x', name: 'X', kind: 'weapon', slot: 'weapon' } as unknown as Item;
    await repo.ensure(characterId);
    await repo.setItems(characterId, [fake, ...Array(19).fill(null)]);
    const second = await repo.ensure(characterId);
    expect(second.items[0]).toMatchObject({ id: 'x' });
  });

  it('setItems round-trips', async () => {
    await repo.ensure(characterId);
    const fake: Item = { id: 'potion', name: 'Potion', kind: 'consumable' } as unknown as Item;
    const items = Array(20).fill(null) as (Item | null)[];
    items[5] = fake;
    await repo.setItems(characterId, items);
    const reloaded = await repo.get(characterId);
    expect(reloaded.items[5]).toMatchObject({ id: 'potion' });
    expect(reloaded.items[0]).toBeNull();
  });

  it('setItems rejects arrays larger than capacity', async () => {
    await repo.ensure(characterId);
    const tooMany = Array(21).fill(null) as (Item | null)[];
    await expect(repo.setItems(characterId, tooMany)).rejects.toThrow(/capacity/i);
  });
});
