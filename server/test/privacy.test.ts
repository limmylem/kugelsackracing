// Phase 6 Step 5: personal data (docs/PRIVACY_DATA.md) — only the cookies the game needs, ever; data kept only as long
// as the retention rules say; an account's deletion leaving nothing personal behind; its export holding everything.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { testApp, Player, signUp, makeStaff, totp } from './helpers.ts';
import { runRetention } from '../src/ops/retention.ts';

let T: Awaited<ReturnType<typeof testApp>>;
const cookies = new Set<string>();
const PW = 'correct horse battery';
before(async () => { T = await testApp('privacy'); });
after(async () => { await T?.close(); });
const idOf = async (email: string) => ((await T.app.deps.db.execute(sql`select id from users where email = ${email}`)).rows[0] as any)?.id as string | undefined;
// (every cookie the server sets, whatever the flow)
const watch = (p: Player) => { const req = p.req.bind(p); p.req = async (...a: Parameters<Player['req']>) => { const r = await req(...a); const set = r.headers['set-cookie']; for (const c of [set].flat().filter(Boolean) as string[]) cookies.add(c.split('=')[0]); return r; }; return p; };

test('only the cookies the game needs: signing in, two-factor, guests, the CSRF token — no tracking, nothing else', async () => {
  const a = watch(await signUp(T.app, T.outbox, { email: 'ann@example.com', name: 'Ann Apex', ip: '10.70.0.1' }));
  await a.get('/api/v1/player'); await a.get('/api/v1/csrf'); await a.post('/api/v1/player/actions/markHint', { args: { id: 'firstDamage' } });
  await makeStaff(T.app, a, 'ann@example.com', 'editor');
  const b = watch(new Player(T.app, '10.70.0.2'));
  await b.post('/api/auth/sign-in/email', { email: 'ann@example.com', password: PW });
  await b.post('/api/auth/two-factor/verify-totp', { code: totp((a as any).totpSecret) });
  await b.get('/api/v1/tracks/today'); await b.get('/');
  const g = watch(new Player(T.app, '10.70.0.3'));
  await g.post('/api/auth/sign-in/anonymous', {});
  await g.post('/api/v1/me/sign-out-everywhere');
  // (Better Auth's session, its cached copy and "don't remember me", the two-factor step, our CSRF token)
  const NEEDED = /^(__Secure-)?kr[._](session_token|session_data|dont_remember|two_factor|csrf)$/;
  const other = [...cookies].filter(c => !NEEDED.test(c));
  assert.deepEqual(other, [], `cookies that aren't necessary: ${other}`);
  assert.ok(cookies.size >= 3, [...cookies].join(', '));
});

test('retention: old guests, expired sessions, old account links, support, reports and logs go; recent ones and real accounts stay', async () => {
  const db = T.app.deps.db;
  // a guest nobody has played for 40 days, and one from yesterday
  const old = new Player(T.app, '10.71.0.1'), fresh = new Player(T.app, '10.71.0.2');
  await old.post('/api/auth/sign-in/anonymous', {}); await fresh.post('/api/auth/sign-in/anonymous', {});
  const oldId = (await old.get('/api/v1/me')).body.user.id, freshId = (await fresh.get('/api/v1/me')).body.user.id;
  await old.post('/api/v1/me/terms', { termsVersion: T.config.termsVersion, birthDate: '1990-01-01' });
  await old.get('/api/v1/player');
  await db.execute(sql`update users set created_at = now() - interval '40 days', updated_at = now() - interval '40 days' where id = ${oldId}`);
  await db.execute(sql`update sessions set updated_at = now() - interval '40 days', created_at = now() - interval '40 days' where user_id = ${oldId}`);
  await db.execute(sql`update player_economy set updated_at = now() - interval '40 days' where user_id = ${oldId}`);
  // a full account that hasn't played for a year: stays (only guests expire)
  const ben = await signUp(T.app, T.outbox, { email: 'ben@example.com', name: 'Ben Brake', ip: '10.71.0.3' });
  const benId = (await idOf('ben@example.com'))!;
  await db.execute(sql`update users set created_at = now() - interval '400 days', updated_at = now() - interval '400 days' where id = ${benId}`);
  await db.execute(sql`update sessions set expires_at = now() - interval '30 days' where user_id = ${benId}`);
  // old and new things that link accounts, support messages, reports, the admins' log
  await db.execute(sql`insert into account_signals (user_id, kind, value, first_seen, last_seen) values (${benId}, 'ip', '10.9.9.9', now() - interval '200 days', now() - interval '100 days'), (${benId}, 'ip', '10.9.9.8', now(), now())`);
  await db.execute(sql`insert into support_tickets (user_id, kind, message, client, created_at) values (${benId}, 'support', 'Old message here', '{}', now() - interval '400 days'), (${benId}, 'feedback', 'New message here', '{}', now())`);
  await db.execute(sql`insert into audit_log (actor_id, action, target_id, at) values (${benId}, 'old-thing', ${benId}, now() - interval '800 days'), (${benId}, 'new-thing', ${benId}, now())`);
  const dry = await runRetention(db, T.config.retention, { dryRun: true });
  assert.equal(dry.deleted.guests, 1); assert.ok(dry.deleted.sessions >= 1); assert.equal(dry.deleted.accountSignals, 1); assert.equal(dry.deleted.support, 1); assert.equal(dry.deleted.audit, 1);
  assert.ok(await db.execute(sql`select 1 from users where id = ${oldId}`).then(r => r.rows.length), 'a dry run deletes nothing');
  const r = await runRetention(db, T.config.retention);
  assert.deepEqual({ ...r.deleted, sessions: 0, verifications: 0 }, { ...dry.deleted, sessions: 0, verifications: 0 });
  assert.equal((await db.execute(sql`select 1 from users where id = ${oldId}`)).rows.length, 0, 'the old guest is gone');
  assert.equal((await db.execute(sql`select 1 from player_economy where user_id = ${oldId}`)).rows.length, 0, 'with its save');
  assert.equal((await db.execute(sql`select 1 from users where id = ${freshId}`)).rows.length, 1, 'yesterday\'s guest stays');
  assert.equal((await db.execute(sql`select 1 from users where id = ${benId}`)).rows.length, 1, 'a full account stays');
  assert.deepEqual((await db.execute(sql`select value from account_signals where user_id = ${benId} and kind = 'ip' order by value`)).rows.map((x: any) => x.value), ['10.9.9.8']);
  assert.deepEqual((await db.execute(sql`select message from support_tickets where user_id = ${benId}`)).rows.map((x: any) => x.message), ['New message here']);
  assert.deepEqual((await db.execute(sql`select action from audit_log where target_id = ${benId} and action in ('old-thing', 'new-thing')`)).rows.map((x: any) => x.action), ['new-thing']);
  assert.equal((await db.execute(sql`select 1 from sessions where user_id = ${benId}`)).rows.length, 0, 'expired sessions gone');
  // run again: nothing more
  assert.equal((await runRetention(db, T.config.retention)).deleted.guests, 0);
  void ben;
});

test('deleting an account removes or anonymises everything of theirs; the export holds all of it first', async () => {
  const db = T.app.deps.db;
  const cat = await signUp(T.app, T.outbox, { email: 'cat@example.com', name: 'Cat Curb', ip: '10.72.0.1' });
  const dan = await signUp(T.app, T.outbox, { email: 'dan@example.com', name: 'Dan Drift', ip: '10.72.0.2' });
  const catId = (await idOf('cat@example.com'))!, danId = (await idOf('dan@example.com'))!;
  const device = crypto.randomUUID();
  await cat.get('/api/v1/player', { headers: { 'x-kr-device': device } });
  await new Promise(r => setTimeout(r, 100));
  await cat.post('/api/v1/support', { category: 'bug', message: 'The garage door is stuck open', client: { version: 'test', screen: '1920x1080' } });
  await cat.post('/api/v1/reports', { targetName: 'Dan Drift', kind: 'behaviour', details: 'Rammed me at the start' });
  await dan.post('/api/v1/reports', { targetName: 'Cat Curb', kind: 'name', details: 'A rude name I think' });
  await db.execute(sql`insert into abuse_flags (kind, key, user_ids, score, evidence) values ('shared-device', ${`t:${catId}`}, array[${catId}, ${danId}]::text[], 40, '{}'), ('earning-rate', ${`t2:${catId}`}, array[${catId}]::text[], 60, '{}')`);
  // the export: everything
  const ex = (await cat.get('/api/v1/me/export')).body;
  for (const k of ['account', 'sessions', 'economy', 'ledger', 'cars', 'parts', 'accountLinks', 'reportsMade', 'reportsAboutYou', 'supportMessages', 'twoFactor']) assert.ok(k in ex, `export has ${k}`);
  assert.ok(ex.economy && ex.ledger.length >= 1 && ex.cars.length >= 1, 'the economy is in it');
  assert.ok(ex.accountLinks.some((l: any) => l.kind === 'device') && !JSON.stringify(ex).includes(device), 'links, scrambled');
  assert.equal(ex.supportMessages[0].message, 'The garage door is stuck open');
  assert.ok(!JSON.stringify(ex.reportsAboutYou).includes('dan') && !JSON.stringify(ex.reportsAboutYou).includes(danId), 'who reported them stays private');
  // deleted
  assert.equal((await cat.del('/api/v1/me', { confirm: 'DELETE', password: PW })).status, 200);
  const left = async (q: ReturnType<typeof sql>) => Number(((await db.execute(q)).rows[0] as any).n);
  assert.equal(await left(sql`select count(*) as n from users where id = ${catId}`), 0);
  for (const t of ['sessions', 'accounts', 'player_economy', 'ledger', 'owned_cars', 'owned_parts', 'account_signals', 'support_tickets', 'two_factors', 'player_recordings', 'track_results'])
    assert.equal(await left(sql`select count(*) as n from ${sql.raw(t)} where user_id = ${catId}`), 0, t);
  assert.equal(await left(sql`select count(*) as n from reports where target_id = ${catId}`), 0, 'reports about them');
  assert.equal(await left(sql`select count(*) as n from reports where reporter_id = ${catId}`), 0, 'their name off the reports they made');
  assert.equal(await left(sql`select count(*) as n from reports where target_id = ${danId} and reporter_id is null`), 1, 'which stay for Dan\'s admins to see, anonymous');
  assert.equal(await left(sql`select count(*) as n from abuse_flags where ${catId} = any(user_ids)`), 0, 'off every flag');
  assert.equal(await left(sql`select count(*) as n from abuse_flags where key = ${`t2:${catId}`}`), 0, 'a flag of only them: gone');
  assert.equal(await left(sql`select count(*) as n from idempotency_keys where scope = ${`u:${catId}`}`), 0);
});
