// Phase 6 Step 5: running the game (docs/OPERATIONS.md, docs/SUPPORT.md) — the public status; features switched off and
// maintenance without a deploy; the "please refresh" check for an old game; support and feedback with the game's version
// and device; an admin's answer by email; a player's whole history; the monitoring numbers; alerts sent once, again
// while they last, and when they're put right.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sql } from 'drizzle-orm';
import { CLIENT_PROTOCOL } from '@kr/shared';
import { testApp, Player, signUp, makeStaff } from './helpers.ts';
import { createMetrics } from '../src/ops/metrics.ts';
import { createAlerter, evaluate, DEFAULT_ALERTS } from '../src/ops/alerts.ts';

let T: Awaited<ReturnType<typeof testApp>>, boss: Player, ann: Player, ed: Player;
before(async () => {
  T = await testApp('ops', { env: { METRICS_TOKEN: 'metrics-token-0123456789' } });
  [boss, ann, ed] = await Promise.all([
    signUp(T.app, T.outbox, { email: 'boss@example.com', name: 'Bea Boss', ip: '10.80.0.1' }),
    signUp(T.app, T.outbox, { email: 'ann@example.com', name: 'Ann Apex', ip: '10.80.0.2' }),
    signUp(T.app, T.outbox, { email: 'ed@example.com', name: 'Ed Itor', ip: '10.80.0.3' }),
  ]);
  await makeStaff(T.app, boss, 'boss@example.com', 'admin');
  await makeStaff(T.app, ed, 'ed@example.com', 'editor');
});
after(async () => { await T?.close(); });
const put = (key: string, value: unknown, reason = 'Testing the switches') => boss.put(`/api/v1/admin/settings/${key}`, { key, value, reason });

test('the public status, and the game\'s API version (the browser\'s copy the same as the server\'s)', async () => {
  const s = await new Player(T.app, '10.80.1.1').get('/api/v1/status');
  assert.equal(s.status, 200); assert.equal(s.body.ok, true); assert.equal(s.body.database, 'up'); assert.equal(s.body.protocol, CLIENT_PROTOCOL);
  assert.equal(s.headers['cache-control'], 'no-store');
  const browser = fs.readFileSync(new URL('../../account/api.js', import.meta.url), 'utf8').match(/export const CLIENT_PROTOCOL = (\d+)/)![1];
  assert.equal(Number(browser), CLIENT_PROTOCOL, 'account/api.js and @kr/shared agree');
  const cfg = (await new Player(T.app, '10.80.1.2').get('/api/v1/client-config')).body;
  assert.equal(cfg.protocol, CLIENT_PROTOCOL); assert.equal(cfg.maintenance.on, false); assert.equal(cfg.botCheck, null);
});

test('a game too old for the server is told to refresh; a current one, or a tool that doesn\'t say, carries on', async () => {
  assert.equal((await ann.get('/api/v1/player', { headers: { 'x-kr-client': String(CLIENT_PROTOCOL) } })).status, 200);
  assert.equal((await ann.get('/api/v1/player')).status, 200);
  assert.equal((await put('client', { minProtocol: CLIENT_PROTOCOL + 1 })).status, 200);
  T.app.siteSettings.forget();
  const old = await ann.get('/api/v1/player', { headers: { 'x-kr-client': String(CLIENT_PROTOCOL) } });
  assert.equal(old.status, 426); assert.equal(old.body.error.code, 'CLIENT_TOO_OLD'); assert.match(old.body.error.message, /refresh/);
  assert.equal((await put('client', { minProtocol: 1 })).status, 200);
  T.app.siteSettings.forget();
  assert.equal((await ann.get('/api/v1/player', { headers: { 'x-kr-client': String(CLIENT_PROTOCOL) } })).status, 200, 'never below this build\'s own');
});

test('a feature switched off: its requests refused with the admins\' message, the rest carries on; back on, it works', async () => {
  assert.equal((await ann.put('/api/v1/admin/settings/features', { key: 'features', value: { shop: { on: false, message: '' } }, reason: 'Me' })).status, 403, 'admins only');
  assert.equal((await put('features', { shop: { on: false, message: 'The shop is shut while we fix a price bug.' } }, '')).status, 400, 'a reason');
  assert.equal((await put('features', { shop: { on: false, message: 'The shop is shut while we fix a price bug.' } })).status, 200);
  T.app.siteSettings.forget();
  const r = await ann.post('/api/v1/player/actions/buyPart', { args: { partId: 'cold_air_intake' } });
  assert.equal(r.status, 503); assert.equal(r.body.error.code, 'FEATURE_OFF'); assert.equal(r.body.error.message, 'The shop is shut while we fix a price bug.');
  assert.equal((await ann.get('/api/v1/player/used-lot')).body.error.code, 'FEATURE_OFF');
  assert.equal((await ann.post('/api/v1/player/actions/markHint', { args: { id: 'firstDamage' } })).status, 200, 'the rest of the game');
  assert.equal((await new Player(T.app, '10.80.2.1').get('/api/v1/status')).body.features.shop, false);
  assert.equal((await put('features', { shop: { on: true, message: '' } })).status, 200);
  T.app.siteSettings.forget();
  assert.equal((await ann.post('/api/v1/player/actions/buyPart', { args: { partId: 'cold_air_intake' } })).status, 200);
  // a gradual rollout: on for half the players — each always on the same side
  assert.equal((await put('features', { replays: { on: true, message: 'Coming soon for you.', percent: 50 } })).status, 200);
  T.app.siteSettings.forget();
  const { bucketOf } = await import('../src/ops/settings.ts');
  const annId = (await ann.get('/api/v1/me')).body.user.id, inside = bucketOf(annId, 'replays') < 50;
  const rep = await ann.post('/api/v1/replays', {});
  assert.equal(rep.body?.error?.code === 'FEATURE_OFF', !inside, `Ann's bucket ${bucketOf(annId, 'replays')}: ${rep.status}`);
  const buckets = Array.from({ length: 400 }, (_, i) => bucketOf(`user${i}`, 'replays') < 50).filter(Boolean).length;
  assert.ok(buckets > 160 && buckets < 240, `about half: ${buckets}/400`);
  assert.equal((await put('features', { replays: { on: true, message: '', percent: 100 } })).status, 200);
  T.app.siteSettings.forget();
  const logged = (await T.app.deps.db.execute(sql`select count(*) as n from audit_log where action = 'setting-features'`)).rows[0] as any;
  assert.equal(Number(logged.n), 4);
});

test('maintenance: players get the message (and the status says so); editors and admins carry on', async () => {
  assert.equal((await put('maintenance', { on: true, message: 'Upgrading the database: back soon.', until: '18:00 UTC' })).status, 200);
  T.app.siteSettings.forget();
  const r = await ann.get('/api/v1/player');
  assert.equal(r.status, 503); assert.equal(r.body.error.code, 'MAINTENANCE'); assert.equal(r.body.error.message, 'Upgrading the database: back soon.'); assert.equal(r.body.error.details.until, '18:00 UTC');
  assert.ok(r.headers['retry-after']);
  const st = await new Player(T.app, '10.80.3.1').get('/api/v1/status');
  assert.equal(st.body.maintenance.on, true); assert.equal(st.body.ok, false);
  assert.equal((await ann.get('/api/v1/me')).status, 200, 'who you are still answers (the game shows the message)');
  assert.equal((await ed.get('/api/v1/content/stats')).status, 200, 'editors carry on');
  assert.equal((await boss.get('/api/v1/admin/audit')).status, 200, 'admins carry on');
  assert.equal((await put('maintenance', { on: false, message: '', until: null })).status, 200);
  T.app.siteSettings.forget();
  assert.equal((await ann.get('/api/v1/player')).status, 200);
});

test('support and feedback: sent with the game\'s version and device, five a day; admins read them, answer by email, close them', async () => {
  const client = { version: 'abc1234', protocol: CLIENT_PROTOCOL, userAgent: 'Mozilla/5.0 Test', platform: 'Linux', screen: '1920x1080', gpu: 'ANGLE (Test GPU)', language: 'en-GB', fps: 58 };
  const s = await ann.post('/api/v1/support', { category: 'bug', message: 'My car fell through the bridge in Monaco.', client });
  assert.equal(s.status, 200, s.text);
  assert.equal((await ann.post('/api/v1/support', { category: 'bug', message: 'Too short', client })).status, 400);
  assert.equal((await ann.post('/api/v1/support', { category: 'bug', message: 'Something long enough here', client: { ...client, cookie: 'x' } })).status, 400, 'only what the form sends');
  assert.equal((await ann.post('/api/v1/feedback', { message: 'Love the Stelvio pass!', mood: 'love', client })).status, 200);
  for (let i = 0; i < 3; i++) await ann.post('/api/v1/feedback', { message: `More thoughts number ${i}`, client });
  assert.equal((await ann.post('/api/v1/feedback', { message: 'One too many', client })).status, 429);
  // a guest, with an email to answer
  const g = new Player(T.app, '10.80.4.1');
  await g.post('/api/auth/sign-in/anonymous', {});
  assert.equal((await g.post('/api/v1/support', { category: 'account', message: 'How do I keep my progress?', contactEmail: 'guest@example.com', client })).status, 200);
  assert.equal((await new Player(T.app, '10.80.4.2').post('/api/v1/support', { category: 'bug', message: 'Not signed in at all', client })).status, 401);
  // the admins
  assert.equal((await ann.get('/api/v1/admin/support')).status, 403);
  const list = (await boss.get('/api/v1/admin/support?kind=support')).body.tickets;
  const mine = list.find((t: any) => t.message.includes('bridge'));
  assert.equal(mine.player.name, 'Ann Apex'); assert.equal(mine.client.gpu, 'ANGLE (Test GPU)'); assert.equal(mine.client.version, 'abc1234');
  const reply = await boss.post(`/api/v1/admin/support/${mine.id}/reply`, { message: 'Thanks! Fixed in tonight\'s update.' });
  assert.equal(reply.status, 200, reply.text);
  const mail = T.outbox.find(m => m.kind === 'support-reply')!;
  assert.equal(mail.to, 'ann@example.com'); assert.match(mail.text, /Fixed in tonight/);
  assert.ok(!(await boss.get('/api/v1/admin/support?kind=support')).body.tickets.some((t: any) => t.id === mine.id), 'closed');
  const guestTicket = list.find((t: any) => t.player?.guest);
  assert.equal(guestTicket.player.email, 'guest@example.com');
});

test('a player\'s whole history for admins: ledger, results, reports, flags, support, admin actions, linked accounts', async () => {
  const annId = (await ann.get('/api/v1/me')).body.user.id;
  await boss.post(`/api/v1/admin/players/${annId}/money`, { amount: 500, reason: 'Sorry about the bridge' });
  const h = await boss.get(`/api/v1/admin/players/${annId}/history`);
  assert.equal(h.status, 200, h.text);
  assert.equal(h.body.player.name, 'Ann Apex'); assert.ok(h.body.player.money > 0);
  for (const k of ['ledger', 'results', 'reportsAbout', 'reportsBy', 'flags', 'support', 'adminActions', 'linkedAccounts', 'addresses']) assert.ok(Array.isArray(h.body[k]), k);
  assert.ok(h.body.ledger.some((l: any) => l.reason === 'Sorry about the bridge' && l.byAdmin));
  assert.ok(h.body.support.length >= 1);
  assert.ok(h.body.adminActions.some((a: any) => a.action === 'view-history'), 'looking is logged too');
  assert.equal((await ann.get(`/api/v1/admin/players/${annId}/history`)).status, 403);
  // find by name, email or id
  for (const q of ['ann apex', 'ann@example', annId]) assert.ok((await boss.get(`/api/v1/admin/players?q=${encodeURIComponent(q)}`)).body.players.some((p: any) => p.id === annId), q);
});

test('monitoring: requests, errors, answer times, players, the database, the queues; the metrics endpoint needs its token', async () => {
  for (let i = 0; i < 5; i++) await ann.get('/api/v1/player');
  const m = await boss.get('/api/v1/admin/monitoring');
  assert.equal(m.status, 200, m.text);
  assert.ok(m.body.now.requests > 5 && m.body.now.activePlayers >= 2, JSON.stringify(m.body.now).slice(0, 200));
  assert.equal(m.body.database.ok, true); assert.ok(m.body.series.length >= 10);
  assert.ok(m.body.hour.routes.some((r: any) => r.route === 'GET /api/v1/player'));
  assert.ok('waiting' in m.body.verification && 'madeLastHour' in m.body.economy && 'reports' in m.body.queues);
  assert.equal((await ann.get('/api/v1/admin/monitoring')).status, 403);
  const anon = new Player(T.app, '10.80.5.1');
  assert.equal((await anon.get('/api/v1/metrics')).status, 401);
  const p = await anon.get('/api/v1/metrics', { headers: { authorization: 'Bearer metrics-token-0123456789' } });
  assert.equal(p.status, 200); assert.match(p.text, /kr_requests_5m \d+/); assert.match(p.text, /kr_db_up 1/);
  // retention's dry run from the admin page
  const r = await boss.post('/api/v1/admin/retention', { dryRun: true });
  assert.equal(r.status, 200); assert.equal(r.body.dryRun, true); assert.ok('guests' in r.body.deleted);
});

test('alerts: each problem sent once, again an hour later if it lasts, and when it\'s fixed — by email and to a phone', async () => {
  let t = Date.parse('2026-10-07T10:00:00Z');
  const M = createMetrics({ now: () => t });
  const sent: { to?: string; subject: string; text: string }[] = [], hooks: string[] = [];
  const A = createAlerter({ db: T.app.deps.db, mailer: { send: async m => { sent.push(m); } }, email: 'owner@example.com', webhook: 'https://ntfy.sh/kr-test', env: 'test', rules: DEFAULT_ALERTS, log: () => {},
    fetchImpl: (async (_u: string, o: any) => { hooks.push(String(o.body)); return new Response('ok'); }) as any });
  const healthy = { db: { ok: true, ms: 3, waiting: 0, total: 2, idle: 2 }, queue: { waiting: 0, oldestMs: 0 }, money: { lastHour: 1000, weekHourly: 900 } };
  // a burst of server errors and slow answers
  for (let i = 0; i < 40; i++) M.record({ route: 'GET /api/v1/player', status: i % 4 ? 200 : 500, ms: i % 2 ? 2500 : 80, userId: `u${i}` });
  let now = evaluate(M, healthy, DEFAULT_ALERTS);
  assert.deepEqual([...now.keys()].sort(), ['errors', 'slow']);
  assert.deepEqual((await A.check(now)).sort(), ['errors', 'slow']);
  assert.equal(sent.length, 2); assert.equal(sent[0].to, 'owner@example.com'); assert.equal(hooks.length, 2);
  assert.deepEqual(await A.check(now), [], 'not sent again within the hour');
  // the database, the queue, the money
  const bad = { db: { ok: false, ms: 0, waiting: 0, total: 0, idle: 0 }, queue: { waiting: 50, oldestMs: 300_000 }, money: { lastHour: 9_000_000, weekHourly: 1000 } };
  now = evaluate(M, bad, DEFAULT_ALERTS);
  for (const k of ['database', 'queue', 'money']) assert.ok(now.has(k), k);
  assert.match(now.get('money')!, /Unusual money creation/);
  // an hour on: what's still wrong is sent again; then everything fixed: "Fixed" for each
  await T.app.deps.db.execute(sql`update alerts set sent_at = now() - interval '61 minutes' where key in ('errors', 'slow')`);
  const again = await A.check(evaluate(M, healthy, DEFAULT_ALERTS));
  assert.deepEqual(again.sort(), ['errors', 'slow']);
  assert.ok(sent.some(m => m.subject.includes('Still: errors')));
  t += 10 * 60000;
  const fixed = await A.check(evaluate(M, healthy, DEFAULT_ALERTS));
  assert.deepEqual(fixed.sort(), ['errors:resolved', 'slow:resolved']);
  assert.ok(sent.some(m => m.subject === '[test] Fixed: errors'));
  const rows = (await T.app.deps.db.execute(sql`select key, state from alerts order by key`)).rows as any[];
  assert.ok(rows.every(r => r.state === 'resolved'));
  // too few requests to judge: nothing
  const quiet = createMetrics({ now: () => t });
  quiet.record({ route: 'GET /x', status: 500, ms: 5000 });
  assert.equal(evaluate(quiet, healthy, DEFAULT_ALERTS).size, 0);
});
