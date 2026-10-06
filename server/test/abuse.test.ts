// Phase 6 Step 5: abuse protection (docs/ABUSE.md) — the bot check on signing up, signing in and becoming a guest;
// the closed beta's invite codes; accounts linked by a browser or an address, flagged for review (never banned by
// themselves); players' reports and the admins' queue; names kept for the team.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { testApp, Player, signUp, makeStaff, birth, linkIn, path } from './helpers.ts';
import { nameProblem } from '../src/names.ts';
import { scanForAbuse } from '../src/abuse/detect.ts';
import { createBotCheck } from '../src/abuse/botCheck.ts';

const PW = 'correct horse battery';
// (the bot check as Cloudflare would answer: a token that says "human" passes, anything else fails)
const checks: { token?: string; ip: string }[] = [];
const fakeBotCheck = async (token: string | undefined, ip: string) => { checks.push({ token, ip }); return token === 'human' ? { ok: true as const } : { ok: false as const, reason: 'invalid-input-response' }; };

let T: Awaited<ReturnType<typeof testApp>>, boss: Player;
before(async () => {
  T = await testApp('abuse', { botCheck: fakeBotCheck });
  boss = await signUpChecked('boss@example.com', 'Bea Boss', '10.30.0.1');
  await makeStaff(T.app, boss, 'boss@example.com', 'admin');
});
after(async () => { await T?.close(); });

// signing up with the check passed (the helpers' signUp doesn't send it), then confirming the email and signing in
async function signUpChecked(email: string, name: string, ip: string, extra: Record<string, unknown> = {}, device?: string) {
  const p = new Player(T.app, ip), h = { 'x-bot-check': 'human', ...(device ? { 'x-kr-device': device } : {}) };
  const r = await p.post('/api/auth/sign-up/email', { email, password: PW, name, acceptTerms: T.config.termsVersion, birthDate: birth(25), ...extra }, { headers: h });
  if (r.status !== 200) throw Object.assign(new Error(`sign-up ${email}: ${r.status} ${r.text}`), { res: r });
  const mail = [...T.outbox].reverse().find(m => m.to === email && m.kind === 'verify-email')!;
  await p.get(path(linkIn(mail)), { headers: h });
  if (!p.cookies.size) await p.post('/api/auth/sign-in/email', { email, password: PW }, { headers: h });
  return p;
}
const idOf = async (email: string) => ((await T.app.deps.db.execute(sql`select id from users where email = ${email}`)).rows[0] as any).id as string;

test('the bot check: signing up, signing in and becoming a guest need it; the rest of the API doesn\'t', async () => {
  const p = new Player(T.app, '10.30.1.1');
  const body = { email: 'bot@example.com', password: PW, name: 'Bot Bert', acceptTerms: T.config.termsVersion, birthDate: birth(30) };
  const no = await p.post('/api/auth/sign-up/email', body);
  assert.equal(no.status, 403); assert.equal(no.body.error.code, 'BOT_CHECK');
  const bad = await p.post('/api/auth/sign-up/email', body, { headers: { 'x-bot-check': 'robot' } });
  assert.equal(bad.body.error.code, 'BOT_CHECK');
  assert.equal(((await T.app.deps.db.execute(sql`select count(*) as n from users where email = 'bot@example.com'`)).rows[0] as any).n, '0', 'no account made');
  for (const url of ['/api/auth/sign-in/email', '/api/auth//sign-in/anonymous']) assert.equal((await p.post(url, { email: 'boss@example.com', password: PW })).body.error.code, 'BOT_CHECK', url);
  assert.equal((await p.post('/api/auth/sign-in/anonymous', {}, { headers: { 'x-bot-check': 'human' } })).status, 200, 'a guest with the check passed');
  assert.equal(checks.at(-1)!.ip, '10.30.1.1', 'checked against the player\'s own address');
  assert.equal((await new Player(T.app, '10.30.1.2').get('/api/v1/tracks/today')).status, 200, 'the rest needs none');
  // a thousand sign-ups from bots: none get through (and nothing is made)
  let through = 0;
  for (let i = 0; i < 40; i++) { const r = await new Player(T.app, `10.31.${i}.1`).post('/api/auth/sign-up/email', { ...body, email: `bot${i}@example.com`, name: `Bot ${i}x` }, { headers: { 'x-bot-check': `x${i}` } }); if (r.status === 200) through++; }
  assert.equal(through, 0);
  // the real verifier: refuses a missing answer without asking Cloudflare, and refuses (not waves through) when it can't reach it
  const real = createBotCheck({ secret: 's', fetchImpl: (async () => { throw new Error('down'); }) as any });
  assert.deepEqual(await real(undefined, '1.2.3.4'), { ok: false, reason: 'missing' });
  assert.equal((await real('tok', '1.2.3.4')).ok, false);
  const yes = createBotCheck({ secret: 's', fetchImpl: (async (_u: string, o: any) => { assert.equal(o.body.get('remoteip'), '1.2.3.4'); return { json: async () => ({ success: true }) }; }) as any });
  assert.deepEqual(await yes('tok', '1.2.3.4'), { ok: true });
});

test('the closed beta: signing up needs an invite code (used up, expired, revoked: refused); guests and new social accounts wait', async () => {
  const set = (on: boolean) => boss.put('/api/v1/admin/settings/closedBeta', { key: 'closedBeta', value: { on }, reason: 'Closed beta testing' });
  assert.equal((await set(true)).status, 200);
  try {
  assert.equal((await new Player(T.app, '10.30.2.9').get('/api/v1/client-config')).body.closedBeta, true);
  const made = await boss.post('/api/v1/admin/invites', { count: 2, maxUses: 1, days: 30, note: 'Friends' });
  assert.equal(made.status, 200); assert.equal(made.body.codes.length, 2);
  const [code, other] = made.body.codes;
  await assert.rejects(signUpChecked('nocode@example.com', 'No Code', '10.30.2.1'), (e: any) => e.res.body.error.code === 'INVITE_REQUIRED');
  await assert.rejects(signUpChecked('wrong@example.com', 'Wrong Code', '10.30.2.2', { inviteCode: 'NOPE-NOPE' }), (e: any) => e.res.body.error.code === 'INVITE_REQUIRED');
  const ok = await signUpChecked('invited@example.com', 'Ivy Invited', '10.30.2.3', { inviteCode: code.toLowerCase() });
  assert.equal((await ok.get('/api/v1/me')).status, 200);
  await assert.rejects(signUpChecked('again@example.com', 'Al Again', '10.30.2.4', { inviteCode: code }), (e: any) => e.res.body.error.code === 'INVITE_REQUIRED', 'used up');
  // a sign-up that fails (a taken name) gives its code back
  await assert.rejects(signUpChecked('dup@example.com', 'Ivy Invited', '10.30.2.5', { inviteCode: other }));
  assert.equal(((await T.app.deps.db.execute(sql`select uses from invite_codes where code = ${other}`)).rows[0] as any).uses, 0);
  // revoked
  assert.equal((await boss.post(`/api/v1/admin/invites/${other}/revoke`, { reason: 'Leaked on a forum' })).status, 200);
  await assert.rejects(signUpChecked('rev@example.com', 'Rev Oked', '10.30.2.6', { inviteCode: other }), (e: any) => e.res.body.error.code === 'INVITE_REQUIRED');
  // guests wait
  const g = await new Player(T.app, '10.30.2.7').post('/api/auth/sign-in/anonymous', {}, { headers: { 'x-bot-check': 'human' } });
  assert.equal(g.status, 403); assert.equal(g.body.error.code, 'INVITE_REQUIRED');
  // the admin's list: who used which
  const list = (await boss.get('/api/v1/admin/invites')).body.invites;
  const used = list.find((x: any) => x.code === code);
  assert.equal(used.uses, 1); assert.equal(used.usedBy[0].name, 'Ivy Invited');
  assert.equal(list.find((x: any) => x.code === other).revoked, true);
  } finally { assert.equal((await set(false)).status, 200); }
  assert.equal((await new Player(T.app, '10.30.2.8').post('/api/auth/sign-in/anonymous', {}, { headers: { 'x-bot-check': 'human' } })).status, 200, 'open again');
});

test('names kept for the team, and offensive ones, are refused however they\'re written', () => {
  for (const n of ['Admin', '4dm1n', 'Mod Team', 'Kugelsack Support', 'Official Racer', 'Ognistrada', 'GameMaster']) assert.ok(nameProblem(n), n);
  for (const n of ['Ann Apex', 'Modular', 'Admiral Ackbar', 'Racer-ABCDE', 'Guest-ABC234']) assert.equal(nameProblem(n), null, n);
});

test('accounts on the same browser, sign-up bursts, farm groups and impossible earnings are flagged — for review, never banned', async () => {
  const device = crypto.randomUUID();
  const a = await signUpChecked('fa@example.com', 'Farm Aa', '10.40.0.1', {}, device);
  const b = await signUpChecked('fb@example.com', 'Farm Bb', '10.40.0.2', {}, device);
  const c = await signUpChecked('fc@example.com', 'Farm Cc', '10.40.0.3', {}, device);
  // (requests made from each, with the game's device id: the links recorded)
  for (const p of [a, b, c]) assert.equal((await p.get('/api/v1/player', { headers: { 'x-kr-device': device } })).status, 200);
  await new Promise(r => setTimeout(r, 200));
  const stored = (await T.app.deps.db.execute(sql`select value from account_signals where kind = 'device'`)).rows.map((r: any) => r.value);
  assert.ok(stored.length >= 3 && stored.every((v: string) => v !== device && /^[0-9a-f]{32}$/.test(v)), 'the device id itself is never stored');
  // each earns, then sells everything: accounts feeding another
  const give = async (email: string, amount: number, kind: string) => {
    const id = await idOf(email), last = (await T.app.deps.db.execute(sql`select balance_after from ledger where user_id = ${id} order by id desc limit 1`)).rows[0] as any;
    await T.app.deps.db.execute(sql`insert into ledger (user_id, amount, balance_after, kind, reason) values (${id}, ${amount}, ${Number(last?.balance_after ?? 0) + amount}, ${kind}, ${kind === 'reward' ? 'Quest reward' : 'Sold a part'})`);
  };
  for (const e of ['fa@example.com', 'fb@example.com', 'fc@example.com']) { await give(e, 5000, 'reward'); await give(e, 900, 'sale'); }
  await give('fa@example.com', 90_000, 'reward');             // (more in an hour than the game pays)
  // a burst: four accounts from one address in a day
  for (let i = 0; i < 4; i++) await signUpChecked(`burst${i}@example.com`, `Burst ${i}x`, '10.50.0.9');
  const r = await boss.post('/api/v1/admin/abuse/scan');
  assert.equal(r.status, 200, r.text);
  const flags = (await boss.get('/api/v1/admin/flags')).body.flags;
  const kinds = new Set(flags.map((f: any) => f.kind));
  for (const k of ['shared-device', 'farm-group', 'earning-rate', 'signup-burst']) assert.ok(kinds.has(k), `${k}: ${[...kinds]}`);
  const farm = flags.find((f: any) => f.kind === 'farm-group');
  assert.deepEqual(farm.accounts.map((x: any) => x.name).sort(), ['Farm Aa', 'Farm Bb', 'Farm Cc']);
  assert.ok(flags.every((f: any, i: number) => i === 0 || flags[i - 1].score >= f.score || flags[i - 1].status !== f.status), 'highest score first');
  // nobody was banned by it
  assert.equal(((await T.app.deps.db.execute(sql`select count(*) as n from users where banned`)).rows[0] as any).n, '0');
  // scanned again: the same flags, not new ones
  const before = flags.length;
  await boss.post('/api/v1/admin/abuse/scan');
  assert.equal((await boss.get('/api/v1/admin/flags')).body.flags.length, before);
  // reviewed: dismissed with a reason (logged), off the open queue
  assert.equal((await boss.post(`/api/v1/admin/flags/${farm.id}`, { status: 'dismissed', note: 'x' })).status, 400, 'a reason');
  assert.equal((await boss.post(`/api/v1/admin/flags/${farm.id}`, { status: 'dismissed', note: 'Three siblings, one laptop' })).status, 200);
  assert.ok(!(await boss.get('/api/v1/admin/flags')).body.flags.some((f: any) => f.id === farm.id));
  assert.equal(((await T.app.deps.db.execute(sql`select count(*) as n from audit_log where action = 'flag-dismissed'`)).rows[0] as any).n, '1');
  // and players can't see or run any of it
  assert.equal((await a.get('/api/v1/admin/flags')).status, 403);
  assert.equal((await a.post('/api/v1/admin/abuse/scan')).status, 403);
  void scanForAbuse;
});

test('reports: a player reports another (not themselves, not too often, once while open); the admins resolve them', async () => {
  const rex = await signUpChecked('rex@example.com', 'Rex Rude', '10.60.0.1');
  const amy = await signUpChecked('amy@example.com', 'Amy Ace', '10.60.0.2');
  const zed = await signUpChecked('zed@example.com', 'Zed Zoom', '10.60.0.3');
  const r1 = await amy.post('/api/v1/reports', { targetName: 'rex rude', kind: 'name', details: 'His name is a slur in my language' });
  assert.equal(r1.status, 200, r1.text); assert.equal(r1.body.already, false);
  assert.equal((await amy.post('/api/v1/reports', { targetName: 'Rex Rude', kind: 'name', details: 'Again, the same name' })).body.already, true, 'once while open');
  assert.equal((await zed.post('/api/v1/reports', { targetName: 'Rex Rude', kind: 'name', details: 'Offensive name on the board' })).status, 200);
  assert.equal((await zed.post('/api/v1/reports', { targetName: 'Rex Rude', kind: 'cheating', details: 'Impossible lap time', ref: { eventId: 'daily-x' } })).status, 200);
  assert.equal((await amy.post('/api/v1/reports', { targetName: 'Amy Ace', kind: 'other', details: 'Testing myself' })).status, 400, 'not yourself');
  assert.equal((await amy.post('/api/v1/reports', { targetName: 'Nobody Here', kind: 'other', details: 'Who is this' })).status, 404);
  assert.equal((await amy.post('/api/v1/reports', { targetName: 'Rex Rude', kind: 'other', details: 'x' })).status, 400, 'say what happened');
  // (her reports today: ten, the most there can be)
  const amyId = await idOf('amy@example.com'), zedId = await idOf('zed@example.com');
  for (let i = 0; i < 9; i++) await T.app.deps.db.execute(sql`insert into reports (reporter_id, target_id, target_name, kind, details, status) values (${amyId}, ${zedId}, 'Zed Zoom', ${REPORT(i)}, ${`Report ${i}`}, 'resolved')`);
  const many = await amy.post('/api/v1/reports', { targetName: 'Bea Boss', kind: 'other', details: 'One more report' });
  assert.equal(many.status, 429, 'ten a day');
  // the queue: Rex first (two players reported him); players can't see it
  assert.equal((await amy.get('/api/v1/admin/reports')).status, 403);
  const q = (await boss.get('/api/v1/admin/reports')).body.reports;
  assert.equal(q[0].target.name, 'Rex Rude'); assert.equal(q[0].target.openReporters, 2);
  const nameReport = q.find((x: any) => x.target.name === 'Rex Rude' && x.kind === 'name');
  // resolved: renamed (both name reports closed), logged; Rex can choose a new one now
  const res = await boss.post(`/api/v1/admin/reports/${nameReport.id}/resolve`, { action: 'rename', note: 'Offensive name' });
  assert.equal(res.status, 200, res.text); assert.equal(res.body.closed, 2);
  const me = (await rex.get('/api/v1/me')).body.user;
  assert.match(me.displayName, /^Racer-/); assert.equal(me.nameChangeAvailableAt, null);
  assert.equal(((await T.app.deps.db.execute(sql`select count(*) as n from audit_log where action = 'report-rename'`)).rows[0] as any).n, '1');
  // the cheating report: a week's suspension
  const cheat = (await boss.get('/api/v1/admin/reports')).body.reports.find((x: any) => x.kind === 'cheating');
  assert.equal((await boss.post(`/api/v1/admin/reports/${cheat.id}/resolve`, { action: 'suspend', days: 7, note: 'Lap time not possible' })).status, 200);
  assert.ok([401, 403].includes((await rex.get('/api/v1/player')).status), 'suspended (signed out, and refused)');
  const again = await new Player(T.app, '10.60.0.9').post('/api/auth/sign-in/email', { email: 'rex@example.com', password: PW }, { headers: { 'x-bot-check': 'human' } });
  assert.equal(again.status, 403, 'can\'t sign in while suspended');
});
const REPORT = (i: number) => (['cheating', 'name', 'behaviour', 'other'] as const)[i % 4];
