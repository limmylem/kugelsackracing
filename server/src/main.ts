// The server (docs/SERVER.md): settings from the environment (config.ts — secrets only there), the database
// brought up to date (every migration in drizzle/), then the API and the game on one port. A clean stop on
// SIGTERM (a deploy): requests in flight finish, the database pool closes. A crash (an exception nothing caught):
// one JSON line in the log, to Sentry, and out with 1 — Docker starts it again (Phase 7 Step 5).
//
//   node --env-file-if-exists=server/.env server/src/main.ts      (npm run server, npm run server:dev)

import { loadConfig } from './config.ts';
import { migrateDb } from './db/migrate.ts';
import { buildApp, scrubUrl } from './app.ts';
import { initSentry, flushSentry, exitOnCrash } from './sentry.ts';

const config = loadConfig(process.env);
const report = initSentry(config, scrubUrl);
exitOnCrash('the API', report);
await migrateDb(config.databaseUrl);
const app = await buildApp({ config, onUnexpected: report ?? undefined });
await app.listen({ port: config.port, host: config.host });
app.log.info({ env: config.env, version: config.version ?? 'dev', url: config.publicUrl }, 'listening');

let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, async () => {
  if (stopping) return;
  stopping = true;
  app.log.info({ sig }, 'stopping');
  const force = setTimeout(() => process.exit(1), 15_000);
  try { await app.close(); await flushSentry(); } finally { clearTimeout(force); process.exit(0); }
});
