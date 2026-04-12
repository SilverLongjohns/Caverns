import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import type { AuthProvider, AuthResult } from './AuthProvider.js';

export class NameAuthProvider implements AuthProvider {
  readonly id = 'name' as const;
  constructor(private db: Kysely<Database>) {}

  async authenticate(credentials: unknown): Promise<AuthResult | null> {
    if (!credentials || typeof credentials !== 'object') return null;
    const raw = (credentials as { name?: unknown }).name;
    if (typeof raw !== 'string') return null;
    const display = raw.trim();
    if (!display) return null;
    const providerId = display.toLowerCase();

    const existing = await this.db.selectFrom('accounts')
      .select('id')
      .where('auth_provider', '=', 'name')
      .where('provider_id', '=', providerId)
      .executeTakeFirst();
    if (existing) return { accountId: existing.id };

    const inserted = await this.db.insertInto('accounts')
      .values({ auth_provider: 'name', provider_id: providerId, display_name: display } as never)
      .returning('id')
      .executeTakeFirstOrThrow();
    return { accountId: inserted.id };
  }
}
