// Brings a database up to date: every migration in server/drizzle/ not yet applied, in order (Drizzle's
// migrator keeps its own table of what's been applied). Run by `npm run db:migrate`, by the server on start
// (so a deploy migrates before it serves), and by the tests on a fresh database.

import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { openDb } from './index.ts';
import { SERVER_DIR } from '../config.ts';

export const MIGRATIONS_DIR = path.join(SERVER_DIR, 'drizzle');

// (one at a time: a deploy can start the new server while the old one still runs, and two starting together
// mustn't both apply the same migration — a lock held on the one connection while it migrates; the other waits,
// then finds nothing left to do. Migrations only ever add to the schema, so the old server keeps working
// meanwhile and after a rollback: docs/DEPLOYMENT.md)
const LOCK = 7_461_002_301;
export async function migrateDb(url: string) {
  const { db, pool } = openDb(url, { max: 1 });
  try {
    await pool.query('select pg_advisory_lock($1)', [LOCK]);
    try { await migrate(db, { migrationsFolder: MIGRATIONS_DIR }); }
    finally { await pool.query('select pg_advisory_unlock($1)', [LOCK]).catch(() => {}); }
  } finally { await pool.end(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }
  migrateDb(url).then(() => console.log('database up to date')).catch(e => { console.error(e.message); process.exit(1); });
}
