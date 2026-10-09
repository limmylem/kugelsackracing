// The rollback drill (Phase 6 Step 5; docs/OPERATIONS.md "Rolling back"): a broken release deployed to a staging-like
// database and rolled back, the way a deploy and the rollback workflow do it:
//   1. version A (this code) serving, with players
//   2. release B deployed: its migration applied first (additive, as the migrations test makes every one) — a new column
//      and a new table — then B's server, which has a bug: its garage requests fail (500)
//   3. the alert for server errors fires within its first check (ops/alerts.ts) — the owner would be told
//   4. rolled back: B stopped, A started again on the database as B left it (B's migration stays: a rollback never undoes
//      one); A migrates (nothing to do, nothing fails), serves every request, the books balance; the alert clears
// Writes reports/rollback-test.md; exits 1 if any of it didn't happen.
//
//   TEST_DATABASE_URL=postgres://… node server/tools/rollback-test.ts

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { freshDatabase, testConfig, Player, signUp } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db/index.ts';
import { MIGRATIONS_DIR, migrateDb } from '../src/db/migrate.ts';
import { REPO_DIR } from '../src/config.ts';
import { evaluate, healthNow } from '../src/ops/alerts.ts';

const steps: { step: string; ok: boolean; note: string }[] = [];
const check = (step: string, ok: boolean, note = '') => { steps.push({ step, ok, note }); console.log(`${ok ? '✔' : '✖'} ${step}${note ? ` — ${note}` : ''}`); };
const database = await freshDatabase('rollback');
const config = testConfig(database.url);
const traffic = async (app: any, players: Player[], rounds = 3) => {
  const codes: Record<number, number> = {};
  for (let r = 0; r < rounds; r++) for (const p of players) { p.app = app; const x = await p.get('/api/v1/player'); codes[x.status] = (codes[x.status] ?? 0) + 1; }
  return codes;
};

try {
  // 1. version A
  let app: any = await buildApp({ config }); await app.ready();
  const players: Player[] = [];
  for (let i = 0; i < 8; i++) players.push(await signUp(app, app.deps.mailer.outbox, { email: `rb${i}@example.com`, name: `Roll Back ${i}x`, ip: `10.95.0.${i}` }));
  const a1 = await traffic(app, players);
  check('version A serves', (a1[200] ?? 0) === players.length * 3, JSON.stringify(a1));
  await app.close();

  // 2. release B: its migration, then its (broken) server
  const bDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kr-release-b-'));
  fs.cpSync(MIGRATIONS_DIR, bDir, { recursive: true });
  fs.writeFileSync(path.join(bDir, '0099_release_b.sql'), `-- release B's migration (the drill): only adds\nALTER TABLE "users" ADD COLUMN IF NOT EXISTS "release_b_note" text;--> statement-breakpoint\nCREATE TABLE IF NOT EXISTS "release_b_things" ("id" bigserial PRIMARY KEY, "user_id" text, "made" timestamp with time zone DEFAULT now() NOT NULL);\n`);
  const jf = path.join(bDir, 'meta/_journal.json'), j = JSON.parse(fs.readFileSync(jf, 'utf8')), last = j.entries.at(-1);
  j.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1000, tag: '0099_release_b' }); fs.writeFileSync(jf, JSON.stringify(j, null, 2));
  { const { db, pool } = openDb(database.url, { max: 1 }); await migrate(db, { migrationsFolder: bDir }); await pool.end(); }
  app = await buildApp({ config, fault: /^\/api\/v1\/player/ }); await app.ready();
  const b = await traffic(app, players);
  check('release B deployed: its migration applied, its garage requests failing', (b[500] ?? 0) === players.length * 3, JSON.stringify(b));

  // 3. the alert
  const hb = await healthNow(app.deps.db, null, app.tracks), firing = evaluate(app.metrics, hb, config.alerts);
  check('the server-errors alert fires on its first check', firing.has('errors'), firing.get('errors') ?? 'nothing fired');
  await app.close();

  // 4. rolled back
  await migrateDb(database.url);
  check('version A\'s migrations run against B\'s database: nothing to do, nothing fails', true);
  app = await buildApp({ config }); await app.ready();
  const a2 = await traffic(app, players);
  check('version A serves again on B\'s schema', (a2[200] ?? 0) === players.length * 3, JSON.stringify(a2));
  const buy = await players[0].post('/api/v1/player/actions/buyPart', { args: { partId: 'cold_air_intake' } });
  check('and writes work (a purchase)', buy.status === 200, String(buy.status));
  const cols = (await app.deps.db.execute(sql`select column_name from information_schema.columns where table_name = 'users' and column_name = 'release_b_note'`)).rows.length;
  check('B\'s column is still there (a rollback never undoes a migration), and A ignores it', cols === 1);
  const books = (await app.deps.db.execute(sql`select count(*)::int as n from player_economy e where e.balance <> coalesce((select balance_after from ledger l where l.user_id = e.user_id order by id desc limit 1), 0)`)).rows[0] as any;
  check('the books balance', books.n === 0, `${books.n} balances off`);
  const ha = await healthNow(app.deps.db, null, app.tracks), cleared = evaluate(app.metrics, ha, config.alerts);
  check('the alert clears', !cleared.has('errors'));
  await app.close();
  fs.rmSync(bDir, { recursive: true, force: true });
} catch (e: any) {
  check('the drill ran to the end', false, String(e?.message ?? e));
} finally { await database.drop().catch(() => {}); }

const ok = steps.every(s => s.ok);
fs.mkdirSync(path.join(REPO_DIR, 'reports'), { recursive: true });
fs.writeFileSync(path.join(REPO_DIR, 'reports/rollback-test.md'), `# Rollback drill\n\n${new Date().toISOString()} · ${ok ? '**passed**' : '**FAILED**'}\n\nA broken release (an additive migration, and a bug failing every garage request) deployed to a staging-like database, caught by the server-errors alert, and rolled back to the previous version on the newer schema (server/tools/rollback-test.ts).\n\n${steps.map(s => `- ${s.ok ? '✔' : '✖'} ${s.step}${s.note ? ` — ${s.note}` : ''}`).join('\n')}\n\nOnline: Actions → rollback → the commit (docs/DEPLOYMENT.md "Rolling back").\n`);
console.log(ok ? '\nRollback drill passed.' : '\nRollback drill FAILED.');
process.exit(ok ? 0 : 1);
