import type { Kysely } from 'kysely';
import type { Item } from '@caverns/shared';
import type { Database, CharacterShopStateTable } from './db/types.js';

export class ShopRepository {
  constructor(private db: Kysely<Database>) {}

  async ensure(characterId: string, shopId: string): Promise<CharacterShopStateTable> {
    await this.db.insertInto('character_shop_state')
      .values({
        character_id: characterId,
        shop_id: shopId,
        rotating_items: JSON.stringify([]) as never,
      } as never)
      .onConflict((oc) => oc.columns(['character_id', 'shop_id']).doNothing())
      .execute();
    return this.get(characterId, shopId);
  }

  async get(characterId: string, shopId: string): Promise<CharacterShopStateTable> {
    const row = await this.db.selectFrom('character_shop_state')
      .selectAll()
      .where('character_id', '=', characterId)
      .where('shop_id', '=', shopId)
      .executeTakeFirst();
    if (!row) throw new Error(`No shop state for ${characterId} / ${shopId}`);
    return row;
  }

  async setRotating(
    characterId: string,
    shopId: string,
    items: (Item | null)[],
  ): Promise<void> {
    await this.db.updateTable('character_shop_state')
      .set({
        rotating_items: JSON.stringify(items) as never,
        updated_at: new Date(),
      })
      .where('character_id', '=', characterId)
      .where('shop_id', '=', shopId)
      .execute();
  }
}
