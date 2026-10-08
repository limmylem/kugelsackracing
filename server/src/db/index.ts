// The database connection: a node-postgres pool and Drizzle on it.

import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.ts';

export type Db = ReturnType<typeof openDb>['db'];

export function openDb(url: string, { max = 10 } = {}) {
  const pool = new pg.Pool({ connectionString: url, max, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000,
    // (Neon and other hosted Postgres: TLS when the URL asks for it — sslmode=require)
    ssl: /sslmode=(require|verify)/.test(url) ? { rejectUnauthorized: true } : undefined });
  // (an idle connection the database closed — a restart, a failover, an administrator: the pool drops it and opens
  // another when needed; unhandled, node-postgres's error would end the process)
  pool.on('error', e => console.warn(`database: an idle connection was closed (${e.message})`));
  const db = drizzle(pool, { schema });
  return { pool, db };
}
export { schema };
