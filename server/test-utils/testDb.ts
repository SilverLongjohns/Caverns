import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import type { Database } from '../src/db/types.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

export async function createTestDb(): Promise<{ db: Kysely<Database>; cleanup: () => Promise<void> }> {
  if (!TEST_URL) throw new Error('TEST_DATABASE_URL or DATABASE_URL must be set for DB tests');
  const schema = `test_${randomUUID().replace(/-/g, '')}`;
  const pool = new Pool({ connectionString: TEST_URL });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  await sql.raw(`CREATE SCHEMA ${schema}`).execute(db);
  await sql.raw(`SET search_path TO ${schema}`).execute(db);
  await sql.raw(`CREATE EXTENSION IF NOT EXISTS pgcrypto`).execute(db);
  // Apply schema inline (mirrors migration). Keep in sync with 1744000000_init.sql.
  await sql.raw(`
    CREATE TABLE accounts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      auth_provider text NOT NULL,
      provider_id text NOT NULL,
      display_name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (auth_provider, provider_id)
    );
    CREATE TABLE characters (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name text NOT NULL,
      class text NOT NULL,
      level int NOT NULL DEFAULT 1,
      xp int NOT NULL DEFAULT 0,
      stat_allocations jsonb NOT NULL DEFAULT '{}',
      equipment jsonb NOT NULL DEFAULT '{}',
      inventory jsonb NOT NULL DEFAULT '[]',
      consumables jsonb NOT NULL DEFAULT '[]',
      gold int NOT NULL DEFAULT 0,
      keychain jsonb NOT NULL DEFAULT '[]',
      in_use boolean NOT NULL DEFAULT false,
      last_played_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE account_stash (
      account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      items jsonb NOT NULL DEFAULT '[]',
      gold int NOT NULL DEFAULT 0
    );
    CREATE TABLE sessions (
      token text PRIMARY KEY,
      account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    );
  `).execute(db);
  return {
    db,
    cleanup: async () => {
      await sql.raw(`DROP SCHEMA ${schema} CASCADE`).execute(db);
      await pool.end();
    },
  };
}
