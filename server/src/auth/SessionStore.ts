import { randomBytes } from 'crypto';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionInfo {
  token: string;
  accountId: string;
  expiresAt: Date;
}

export class SessionStore {
  constructor(private db: Kysely<Database>) {}

  async create(accountId: string, ttlMs: number = DEFAULT_TTL_MS): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.db.insertInto('sessions')
      .values({ token, account_id: accountId, expires_at: expiresAt } as never)
      .execute();
    return token;
  }

  async resolve(token: string): Promise<SessionInfo | null> {
    const row = await this.db.selectFrom('sessions')
      .select(['token', 'account_id', 'expires_at'])
      .where('token', '=', token)
      .executeTakeFirst();
    if (!row) return null;
    if (row.expires_at.getTime() <= Date.now()) return null;
    return { token: row.token, accountId: row.account_id, expiresAt: row.expires_at };
  }

  async delete(token: string): Promise<void> {
    await this.db.deleteFrom('sessions').where('token', '=', token).execute();
  }

  async clearExpired(): Promise<number> {
    const result = await this.db.deleteFrom('sessions')
      .where('expires_at', '<=', new Date())
      .executeTakeFirst();
    return Number(result.numDeletedRows ?? 0);
  }
}
