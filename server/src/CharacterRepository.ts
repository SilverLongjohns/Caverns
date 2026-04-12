import type { Kysely } from 'kysely';
import { CLASS_STARTER_ITEMS, STARTER_POTION } from '@caverns/shared';
import type { Database, CharactersTable } from './db/types.js';
import type { CharacterSnapshot } from './characterAdapter.js';

const SLOT_CAP = 3;

function starterEquipment(className: string) {
  const starter = CLASS_STARTER_ITEMS[className];
  return {
    weapon: starter ? { ...starter.weapon } : null,
    offhand: starter ? { ...starter.offhand } : null,
    armor: null,
    accessory: null,
  };
}

function starterConsumables() {
  const pouch: (typeof STARTER_POTION | null)[] = Array(6).fill(null);
  pouch[0] = { ...STARTER_POTION };
  pouch[1] = { ...STARTER_POTION };
  return pouch;
}

export interface CreateCharacterInput {
  name: string;
  class: string;
}

export class CharacterRepository {
  constructor(private db: Kysely<Database>) {}

  async listForWorld(accountId: string, worldId: string): Promise<CharactersTable[]> {
    return this.db.selectFrom('characters')
      .selectAll()
      .where('account_id', '=', accountId)
      .where('world_id', '=', worldId)
      .orderBy('created_at', 'asc')
      .execute();
  }

  async getById(id: string): Promise<CharactersTable | undefined> {
    return this.db.selectFrom('characters').selectAll()
      .where('id', '=', id).executeTakeFirst();
  }

  async create(accountId: string, worldId: string, input: CreateCharacterInput): Promise<CharactersTable> {
    const existing = await this.listForWorld(accountId, worldId);
    if (existing.length >= SLOT_CAP) throw new Error('Character slot limit reached');
    const inserted = await this.db.insertInto('characters')
      .values({
        account_id: accountId,
        world_id: worldId,
        name: input.name.trim(),
        class: input.class,
        equipment: JSON.stringify(starterEquipment(input.class)),
        inventory: JSON.stringify(Array(7).fill(null)),
        consumables: JSON.stringify(starterConsumables()),
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
        stat_allocations: JSON.stringify(snap.stat_allocations) as never,
        equipment: JSON.stringify(snap.equipment) as never,
        inventory: JSON.stringify(snap.inventory) as never,
        consumables: JSON.stringify(snap.consumables) as never,
        gold: snap.gold,
        keychain: JSON.stringify(snap.keychain) as never,
        last_played_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
  }

  async snapshotOverworldPos(id: string, pos: { x: number; y: number }): Promise<void> {
    await this.db.updateTable('characters')
      .set({
        overworld_pos: JSON.stringify(pos) as never,
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
        equipment: JSON.stringify({ weapon: null, offhand: null, armor: null, accessory: null }) as never,
        inventory: JSON.stringify(Array(7).fill(null)) as never,
        consumables: JSON.stringify(Array(6).fill(null)) as never,
        gold: 0,
        keychain: JSON.stringify([]) as never,
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

  async clearInUseForAccount(accountId: string): Promise<number> {
    const result = await this.db.updateTable('characters')
      .set({ in_use: false })
      .where('account_id', '=', accountId)
      .where('in_use', '=', true)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0);
  }
}
