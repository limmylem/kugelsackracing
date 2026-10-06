// Brings a database up to date: every migration in server/drizzle/ not yet applied, in order (Drizzle's
// migrator keeps its own table of what's been applied). Run by `npm run db:migrate`, by the server on start
// (so a deploy migrates before it serves), and by the tests on a fresh database.

import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { openDb } from './index.ts';
import { SERVER_DIR } from '../config.ts';

export const MIGRATIONS_DIR = path.join(SERVER_DIR, 'drizzle');

export async function migrateDb(url: string) {
  const { db, pool } = openDb(url, { max: 1 });
  try { await migrate(db, { migrationsFolder: MIGRATIONS_DIR }); }
  finally { await pool.end(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }
  migrateDb(url).then(() => console.log('database up to date')).catch(e => { console.error(e.message); process.exit(1); });
}
