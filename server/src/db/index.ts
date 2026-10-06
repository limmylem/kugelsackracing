// The database connection: a node-postgres pool and Drizzle on it.

import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.ts';

export type Db = ReturnType<typeof openDb>['db'];

export function openDb(url: string, { max = 10 } = {}) {
  const pool = new pg.Pool({ connectionString: url, max, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000,
    // (Neon and other hosted Postgres: TLS when the URL asks for it — sslmode=require)
    ssl: /sslmode=(require|verify)/.test(url) ? { rejectUnauthorized: true } : undefined });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
export { schema };
