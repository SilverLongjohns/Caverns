import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { Database } from './types.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.warn('[db] DATABASE_URL not set — DB features disabled');
}

export const pool = url
  ? new Pool({ connectionString: url, max: 10 })
  : null;

export const db: Kysely<Database> | null = pool
  ? new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
  : null;

export function requireDb(): Kysely<Database> {
  if (!db) throw new Error('DATABASE_URL not configured');
  return db;
}
