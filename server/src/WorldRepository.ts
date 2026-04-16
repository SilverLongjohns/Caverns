import type { Kysely } from 'kysely';
import type { Database, WorldsTable } from './db/types.js';

const INVITE_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const INVITE_CODE_LENGTH = 6;
const INVITE_CODE_MAX_RETRIES = 5;

function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_CODE_CHARS[Math.floor(Math.random() * INVITE_CODE_CHARS.length)];
  }
  return code;
}

export class WorldRepository {
  constructor(private db: Kysely<Database>) {}

  async create(ownerAccountId: string, name: string): Promise<WorldsTable> {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 32) {
      throw new Error('World name must be between 1 and 32 characters');
    }

    for (let attempt = 0; attempt < INVITE_CODE_MAX_RETRIES; attempt++) {
      const inviteCode = generateInviteCode();
      try {
        const world = await this.db.transaction().execute(async (trx) => {
          const inserted = await trx.insertInto('worlds')
            .values({
              name: trimmed,
              owner_account_id: ownerAccountId,
              invite_code: inviteCode,
              state: JSON.stringify({}) as never,
            } as never)
            .returningAll()
            .executeTakeFirstOrThrow();

          await trx.insertInto('world_members')
            .values({
              world_id: inserted.id,
              account_id: ownerAccountId,
            } as never)
            .execute();

          return inserted as WorldsTable;
        });
        return world;
      } catch (err: unknown) {
        const isUniqueViolation =
          err instanceof Error &&
          'code' in err &&
          (err as { code?: string }).code === '23505';
        const isInviteCodeConflict =
          isUniqueViolation &&
          err instanceof Error &&
          err.message.includes('invite_code');

        if (isInviteCodeConflict && attempt < INVITE_CODE_MAX_RETRIES - 1) {
          // Retry with a new code
          continue;
        }
        throw err;
      }
    }

    throw new Error('Failed to generate a unique invite code after maximum retries');
  }

  async getById(id: string): Promise<WorldsTable | undefined> {
    return this.db.selectFrom('worlds')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async getByInviteCode(code: string): Promise<WorldsTable | undefined> {
    return this.db.selectFrom('worlds')
      .selectAll()
      .where('invite_code', '=', code)
      .executeTakeFirst();
  }

  async listForAccount(accountId: string): Promise<WorldsTable[]> {
    return this.db.selectFrom('worlds')
      .innerJoin('world_members', 'world_members.world_id', 'worlds.id')
      .selectAll('worlds')
      .where('world_members.account_id', '=', accountId)
      .orderBy('worlds.created_at', 'asc')
      .execute();
  }

  // Idempotent: ON CONFLICT DO NOTHING means re-adding an existing member is a safe no-op.
  async addMember(worldId: string, accountId: string): Promise<void> {
    await this.db.insertInto('world_members')
      .values({ world_id: worldId, account_id: accountId } as never)
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  async removeMember(worldId: string, accountId: string): Promise<void> {
    await this.db.deleteFrom('world_members')
      .where('world_id', '=', worldId)
      .where('account_id', '=', accountId)
      .execute();
  }

  async isMember(worldId: string, accountId: string): Promise<boolean> {
    const row = await this.db.selectFrom('world_members')
      .select('account_id')
      .where('world_id', '=', worldId)
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    return row !== undefined;
  }

  async snapshotState(worldId: string, state: Record<string, unknown>): Promise<void> {
    await this.db.updateTable('worlds')
      .set({ state: JSON.stringify(state) as never })
      .where('id', '=', worldId)
      .execute();
  }

  async ensureDefaultWorld(accountId: string): Promise<WorldsTable> {
    const owned = await this.db.selectFrom('worlds')
      .selectAll()
      .where('owner_account_id', '=', accountId)
      .where('name', '=', 'Default')
      .orderBy('created_at', 'asc')
      .executeTakeFirst();
    if (owned) return owned as WorldsTable;
    return this.create(accountId, 'Default');
  }

  async countMembers(worldId: string): Promise<number> {
    const result = await this.db.selectFrom('world_members')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('world_id', '=', worldId)
      .executeTakeFirstOrThrow();
    return Number(result.count);
  }
}
