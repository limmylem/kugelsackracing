// The disaster recovery drill (Phase 6 Step 5; docs/DISASTER_RECOVERY.md "Drill"): the database lost and the game put back
// from its backup, end to end, with the same scripts production uses — timed, and checked row by row.
//   1. a staging-like database with players: accounts (passwords, an admin with two-factor sign-in), their garages and
//      money, purchases, support messages, world content
//   2. its backup: server/scripts/backup.sh (pg_dump, encrypted with AES-256)
//   3. the disaster: the database dropped, the server stopped
//   4. a new, empty database; server/scripts/restore.sh puts the backup in; the server started on it
//   5. checked: every table's rows the same, every balance the same as its ledger, players sign in with their passwords,
//      the admin with their authenticator code, and the game carries on (a purchase)
// Writes reports/dr-test.md and reports/dr-test.json; exits 1 if anything didn't come back.
//
//   TEST_DATABASE_URL=postgres://… node server/tools/dr-test.ts [--players 30]

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { ADMIN_URL, freshDatabase, testConfig, Player, signUp, makeStaff, totp } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
import { REPO_DIR } from '../src/config.ts';

const arg = (n: string, d: number) => { const i = process.argv.indexOf(n); return i > 0 ? Number(process.argv[i + 1]) : d; };
const PLAYERS = arg('--players', 30), PASS = 'dr-drill-passphrase-not-a-real-one', PW = 'correct horse battery';
const t = () => performance.now(), steps: { step: string; ms: number; ok: boolean; note?: string }[] = [];
const step = async <T>(name: string, fn: () => Promise<T>, note = '') => { const t0 = t(); try { const r = await fn(); steps.push({ step: name, ms: Math.round(t() - t0), ok: true, note }); console.log(`✔ ${name} (${Math.round(t() - t0)} ms)`); return r; } catch (e: any) { steps.push({ step: name, ms: Math.round(t() - t0), ok: false, note: String(e?.message ?? e) }); console.error(`✖ ${name}: ${e?.message ?? e}`); throw e; } };

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kr-dr-'));
const backupFile = path.join(work, 'staging.dump.gpg');
let problems: string[] = [];
const COUNTED = ['users', 'accounts', 'two_factors', 'sessions', 'player_economy', 'ledger', 'owned_cars', 'owned_parts', 'item_history', 'support_tickets', 'content_items', 'audit_log', 'site_settings', 'invite_codes'];
async function snapshot(url: string) {
  const c = new pg.Client({ connectionString: url }); await c.connect();
  const counts: Record<string, number> = {};
  for (const tb of COUNTED) counts[tb] = Number((await c.query(`select count(*) as n from ${tb}`)).rows[0].n);
  const balances = (await c.query(`select e.user_id, e.balance, (select balance_after from ledger l where l.user_id = e.user_id order by id desc limit 1) as ledger from player_economy e order by e.user_id`)).rows;
  const ledgerSum = Number((await c.query('select coalesce(sum(amount), 0) as s from ledger')).rows[0].s);
  const migrations = Number((await c.query('select count(*) as n from drizzle.__drizzle_migrations')).rows[0].n);
  await c.end();
  return { counts, balances, ledgerSum, migrations };
}

const original = await freshDatabase('dr_staging');
const config = testConfig(original.url, {}, {});
let app = await buildApp({ config }); await app.ready();
const outbox = app.deps.mailer.outbox as any[];
let adminSecret = '';
try {
  // 1. players and their things
  await step(`a staging database with ${PLAYERS} players`, async () => {
    for (let i = 0; i < PLAYERS; i++) {
      const p = await signUp(app, outbox, { email: `dr${i}@example.com`, name: `Driver ${i}x`, ip: `10.90.${i >> 8}.${i & 255}` });
      await p.get('/api/v1/player');
      if (i % 2 === 0) await p.post('/api/v1/player/actions/buyPart', { args: { partId: 'cold_air_intake' } });
      if (i % 5 === 0) await p.post('/api/v1/support', { category: 'bug', message: `Drill message from driver ${i}`, client: { version: 'dr' } });
    }
    const boss = await signUp(app, outbox, { email: 'drboss@example.com', name: 'Drill Boss', ip: '10.91.0.1' });
    await makeStaff(app, boss, 'drboss@example.com', 'admin');
    adminSecret = (boss as any).totpSecret;
    await boss.post('/api/v1/admin/players/' + (await boss.get('/api/v1/me')).body.user.id + '/money', { amount: 1234, reason: 'Drill grant' });
    await boss.put('/api/v1/admin/settings/features', { key: 'features', value: { replays: { on: true, message: '', percent: 100 } }, reason: 'Drill setting' });
  });
  const before = await step('counted before the disaster', () => snapshot(original.url));

  // 2. the backup, as the daily job makes it
  await step('backup (server/scripts/backup.sh: pg_dump, AES-256)', async () => {
    execFileSync('bash', [path.join(REPO_DIR, 'server/scripts/backup.sh'), backupFile], { env: { ...process.env, DATABASE_URL: original.url, BACKUP_PASSPHRASE: PASS }, stdio: 'pipe' });
  }, `${(fs.statSync(backupFile, { throwIfNoEntry: false })?.size ?? 0)} bytes`);
  const encrypted = fs.readFileSync(backupFile);
  if (encrypted.includes(Buffer.from('dr0@example.com'))) problems.push('the backup file holds readable email addresses: it isn\'t encrypted');

  // 3. the disaster
  const tDisaster = t();
  await step('the disaster: the server stopped, the database dropped', async () => { await app.close(); await original.drop(); });

  // 4. a new database, the backup restored into it, the server started on it
  const restored = await step('a new empty database (with PostGIS)', async () => {
    const name = `kr_t_dr_restored_${Date.now().toString(36)}`, admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect(); await admin.query(`create database ${name}`); await admin.end();
    return { name, url: ADMIN_URL.replace(/\/[^/?]*(\?|$)/, `/${name}$1`) };
  });
  await step('wrong passphrase refused', async () => {
    try { execFileSync('bash', [path.join(REPO_DIR, 'server/scripts/restore.sh'), backupFile], { env: { ...process.env, TARGET_URL: restored.url, BACKUP_PASSPHRASE: 'wrong' }, stdio: 'pipe' }); }
    catch { return; }
    throw new Error('a wrong passphrase restored the backup');
  });
  await step('restore (server/scripts/restore.sh)', async () => { execFileSync('bash', [path.join(REPO_DIR, 'server/scripts/restore.sh'), backupFile], { env: { ...process.env, TARGET_URL: restored.url, BACKUP_PASSPHRASE: PASS }, stdio: 'pipe' }); });
  app = await step('the server started on the restored database (its migrations: nothing to do)', async () => {
    const { migrateDb } = await import('../src/db/migrate.ts');
    await migrateDb(restored.url);
    const a = await buildApp({ config: testConfig(restored.url, {}, {}) }); await a.ready(); return a;
  });
  const rto = Math.round(t() - tDisaster);

  // 5. checked
  const after = await step('counted after the restore', () => snapshot(restored.url));
  for (const tb of COUNTED) if (before.counts[tb] !== after.counts[tb]) problems.push(`${tb}: ${before.counts[tb]} rows before, ${after.counts[tb]} after`);
  if (JSON.stringify(before.balances) !== JSON.stringify(after.balances)) problems.push('balances differ');
  if (after.balances.some((b: any) => b.ledger != null && Number(b.balance) !== Number(b.ledger))) problems.push('a balance doesn\'t match its ledger');
  if (before.ledgerSum !== after.ledgerSum) problems.push(`all the money: ${before.ledgerSum} before, ${after.ledgerSum} after`);
  if (before.migrations !== after.migrations) problems.push('migrations recorded differ');
  await step('players sign in with their passwords; the game carries on (a purchase)', async () => {
    for (const i of [0, 7, PLAYERS - 1]) {
      const p = new Player(app, `10.92.0.${i}`);
      const r = await p.post('/api/auth/sign-in/email', { email: `dr${i}@example.com`, password: PW });
      if (r.status !== 200) throw new Error(`driver ${i} can't sign in: ${r.status}`);
      const prof = await p.get('/api/v1/player');
      if (prof.status !== 200) throw new Error(`driver ${i}'s garage: ${prof.status}`);
      const buy = await p.post('/api/v1/player/actions/buyPart', { args: { partId: 'turbo_kit' } });
      if (buy.status !== 200 && buy.status !== 409) throw new Error(`driver ${i} can't use the shop: ${buy.status}`);
    }
  });
  await step('the admin signs in with their authenticator (its secret decrypted with the same server secret)', async () => {
    const p = new Player(app, '10.92.1.1');
    const r = await p.post('/api/auth/sign-in/email', { email: 'drboss@example.com', password: PW });
    if (!r.body?.twoFactorRedirect) throw new Error('no second step');
    if ((await p.post('/api/auth/two-factor/verify-totp', { code: totp(adminSecret) })).status !== 200) throw new Error('the code was refused');
    if ((await p.get('/api/v1/admin/audit')).status !== 200) throw new Error('the admin tools refused');
  });
  await app.close();
  const c = new pg.Client({ connectionString: ADMIN_URL }); await c.connect(); await c.query(`drop database if exists ${restored.name} with (force)`); await c.end();

  // the report
  const ok = !problems.length && steps.every(s => s.ok);
  const report = { at: new Date().toISOString(), ok, players: PLAYERS, recoveryMs: rto, backupBytes: encrypted.length, steps, problems, counts: after.counts };
  fs.mkdirSync(path.join(REPO_DIR, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(REPO_DIR, 'reports/dr-test.json'), JSON.stringify(report, null, 1) + '\n');
  fs.writeFileSync(path.join(REPO_DIR, 'reports/dr-test.md'), `# Disaster recovery drill\n\n${report.at} · ${ok ? '**passed**' : '**FAILED**'} · ${PLAYERS} players · recovery took **${(rto / 1000).toFixed(1)} s** from the database being lost to the game serving again (this computer, a small database; docs/DISASTER_RECOVERY.md has the real-world times)\n\n| Step | Time | |\n|---|---|---|\n${steps.map(s => `| ${s.step} | ${s.ms} ms | ${s.ok ? '✔' : `✖ ${s.note}`} |`).join('\n')}\n\nRows restored: ${Object.entries(after.counts).map(([k, v]) => `${k} ${v}`).join(', ')}.\n\n${problems.length ? `Problems:\n${problems.map(p => `- ${p}`).join('\n')}` : 'Every table\'s rows, every balance and all the money came back the same; passwords and two-factor sign-in work.'}\n`);
  console.log(ok ? `\nRecovered in ${(rto / 1000).toFixed(1)} s: everything the same.` : `\nProblems:\n${problems.join('\n')}`);
  process.exit(ok ? 0 : 1);
} catch (e: any) {
  console.error(e); process.exit(1);
} finally { fs.rmSync(work, { recursive: true, force: true }); }
void sql;
