import { runner as migrationRunner } from 'node-pg-migrate';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export async function runMigrations(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const here = dirname(fileURLToPath(import.meta.url));
  // Dev: server/src/db/migrate.ts → ./migrations
  // Runtime (Dockerfile): server/dist/db/migrate.js → ../../src/db/migrations
  const candidates = [
    join(here, 'migrations'),
    join(here, '..', '..', 'src', 'db', 'migrations'),
  ];
  const { existsSync } = await import('fs');
  const dir = candidates.find((p) => existsSync(p));
  if (!dir) {
    console.warn('[migrate] no migrations directory found, skipping');
    return;
  }
  await migrationRunner({
    databaseUrl: url,
    dir,
    migrationsTable: 'pgmigrations',
    direction: 'up',
    count: Infinity,
    log: (msg: string) => console.log('[migrate]', msg),
  });
}
