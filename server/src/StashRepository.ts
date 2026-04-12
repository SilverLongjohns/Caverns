import type { Kysely } from 'kysely';
import type { Item } from '@caverns/shared';
import type { Database, CharacterStashTable } from './db/types.js';

const DEFAULT_CAPACITY = 20;

export class StashRepository {
  constructor(private db: Kysely<Database>) {}

  async ensure(characterId: string): Promise<CharacterStashTable> {
    const initial = Array(DEFAULT_CAPACITY).fill(null);
    await this.db.insertInto('character_stash')
      .values({
        character_id: characterId,
        items: JSON.stringify(initial) as never,
        gold: 0,
        capacity: DEFAULT_CAPACITY,
      } as never)
      .onConflict((oc) => oc.column('character_id').doNothing())
      .execute();
    return this.get(characterId);
  }

  async get(characterId: string): Promise<CharacterStashTable> {
    const row = await this.db.selectFrom('character_stash')
      .selectAll()
      .where('character_id', '=', characterId)
      .executeTakeFirst();
    if (!row) throw new Error(`No stash for character ${characterId}`);
    return row;
  }

  async setItems(characterId: string, items: (Item | null)[]): Promise<void> {
    const row = await this.get(characterId);
    if (items.length > row.capacity) {
      throw new Error(`Stash items exceed capacity (${items.length} > ${row.capacity})`);
    }
    await this.db.updateTable('character_stash')
      .set({ items: JSON.stringify(items) as never })
      .where('character_id', '=', characterId)
      .execute();
  }
}
