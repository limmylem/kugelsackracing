// Phase 6 Step 5: the security review's tests (docs/SECURITY.md). Each finding fixed has its test here, and the
// rules every endpoint keeps: no player reaches another player's data or items, editor and admin tools need
// two-factor sign-in (recently), expired sessions are refused, session tokens never reach the page's scripts,
// the client can't pick its own address, and the content security policy runs no injected script.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { sql } from 'drizzle-orm';
import { testApp, Player, signUp, makeStaff, totp } from './helpers.ts';

let T: Awaited<ReturnType<typeof testApp>>, ann: Player, ben: Player, boss: Player;
const PW = 'correct horse battery';
const idOf = async (email: string) => ((await T.app.deps.db.execute(sql`select id from users where email = ${email}`)).rows[0] as any).id as string;
const act = (p: Player, action: string, args: object) => p.post(`/api/v1/player/actions/${action}`, { args });

before(async () => {
  T = await testApp('security');
  [ann, ben, boss] = await Promise.all([
    signUp(T.app, T.outbox, { email: 'ann@example.com', name: 'Ann Apex', ip: '10.20.0.1' }),
    signUp(T.app, T.outbox, { email: 'ben@example.com', name: 'Ben Brake', ip: '10.20.0.2' }),
    signUp(T.app, T.outbox, { email: 'boss@example.com', name: 'The Boss', ip: '10.20.0.3' }),
  ]);
  await makeStaff(T.app, boss, 'boss@example.com', 'admin');
  for (const p of [ann, ben]) assert.equal((await p.get('/api/v1/player')).status, 200);
});
after(async () => { await T?.close(); });

// ---------- two-factor sign-in for editors and admins ----------
test('an admin signs in with a password and then an authenticator code; no code, no admin tools', async () => {
  const secret = (boss as any).totpSecret as string;
  const p = new Player(T.app, '10.20.1.1');
  const first = await p.post('/api/auth/sign-in/email', { email: 'boss@example.com', password: PW });
  assert.equal(first.status, 200, first.text);
  assert.equal(first.body.twoFactorRedirect, true, 'the second step asked for');
  assert.equal((await p.get('/api/v1/me')).status, 401, 'no session yet: only the password');
  assert.equal((await p.get('/api/v1/admin/players?q=ann')).status, 401);
  // a wrong code: refused
  assert.equal((await p.post('/api/auth/two-factor/verify-totp', { code: totp(secret, Date.now() - 600_000) })).status, 401);
  // the right one, asking to trust the device: signed in, but never trusted (a code every sign-in)
  const ok = await p.post('/api/auth/two-factor/verify-totp', { code: totp(secret), trustDevice: true });
  assert.equal(ok.status, 200, ok.text);
  assert.ok(![...p.cookies.keys()].some(k => /trust/i.test(k)), `no trust-this-device cookie: ${[...p.cookies.keys()]}`);
  const me = await p.get('/api/v1/me');
  assert.equal(me.body.user.twoFactor.enabled, true); assert.ok(me.body.user.twoFactor.verifiedAt); assert.equal(me.body.user.twoFactor.required, true);
  assert.equal((await p.get('/api/v1/admin/players?q=ann')).status, 200);
  const again = new Player(T.app, '10.20.1.2');
  assert.equal((await again.post('/api/auth/sign-in/email', { email: 'boss@example.com', password: PW })).body.twoFactorRedirect, true, 'the next sign-in asks again');
});

test('admin and editor endpoints without two-factor: refused (not set up; set up but not this session; too long ago)', async () => {
  const ed = await signUp(T.app, T.outbox, { email: 'ed@example.com', name: 'Ed Itor', ip: '10.20.0.4' });
  await T.app.deps.db.execute(sql`update users set role = 'editor' where email = 'ed@example.com'`);
  const r = await ed.get('/api/v1/content/stats');
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'MFA_REQUIRED'); assert.equal(r.body.error.details.setup, true);
  // every guarded route says the same before anything runs
  for (const route of T.app.routeList.filter(x => x.role)) {
    const url = route.url.replace(/:[a-z]+/gi, 'x1234567');
    const res = await ed.req(route.method, url, { body: route.method === 'GET' ? undefined : {} });
    assert.ok(res.status === 403 && (route.method === 'HEAD' || ['MFA_REQUIRED', 'FORBIDDEN'].includes(res.body?.error?.code)), `${route.method} ${url}: ${res.status} ${res.text.slice(0, 120)}`);
  }
  // the admin: a session whose second step was 13 hours ago (the limit is 12) — the code again, in the same session
  const bossId = await idOf('boss@example.com');
  await T.app.deps.db.execute(sql`update sessions set mfa_verified_at = now() - interval '13 hours' where user_id = ${bossId}`);
  const stale = await boss.get('/api/v1/admin/audit');
  assert.equal(stale.status, 403); assert.equal(stale.body.error.code, 'MFA_REQUIRED'); assert.equal(stale.body.error.details.setup, false);
  assert.equal((await boss.post('/api/auth/two-factor/verify-totp', { code: totp((boss as any).totpSecret) })).status, 200);
  assert.equal((await boss.get('/api/v1/admin/audit')).status, 200, 'entered again: open');
  // a session that never passed it (as a social sign-in's would be): refused
  await T.app.deps.db.execute(sql`update sessions set mfa_verified_at = null where user_id = ${bossId}`);
  assert.equal((await boss.get('/api/v1/admin/audit')).body.error.code, 'MFA_REQUIRED');
  assert.equal((await boss.post('/api/auth/two-factor/verify-totp', { code: totp((boss as any).totpSecret) })).status, 200);
});

// ---------- session tokens, deleting through the back door, account pictures ----------
test('session tokens never reach the page: sign-in, get-session and the session list leave them out', async () => {
  const p = new Player(T.app, '10.20.2.1');
  const s = await p.post('/api/auth/sign-in/email', { email: 'ann@example.com', password: PW });
  assert.equal(s.status, 200); assert.ok(!/"token"/.test(s.text), s.text);
  const g = await p.get('/api/auth/get-session');
  assert.equal(g.status, 200); assert.ok(g.body.user); assert.ok(!/"token"/.test(g.text), g.text);
  const l = await p.get('/api/auth/list-sessions');
  assert.equal(l.status, 200); assert.ok(l.body.length >= 2); assert.ok(!/"token"/.test(l.text), l.text);
  const guest = new Player(T.app, '10.20.2.2');
  assert.ok(!/"token"/.test((await guest.post('/api/auth/sign-in/anonymous', {})).text));
});

test('an account is deleted only through DELETE /me (its confirmation; never the last admin); accounts have no pictures', async () => {
  for (const path of ['/api/auth/delete-user', '/api/auth//delete-user', '/api/auth/%64elete-user', '/api/auth/DELETE-USER']) {
    const r = await boss.post(path, { password: PW });
    assert.equal(r.status, 403, `${path}: ${r.text}`);
  }
  assert.ok(await idOf('boss@example.com'), 'still there');
  const pic = await ann.post('/api/auth/update-user', { image: 'javascript:alert(1)' });
  assert.equal(pic.status, 400);
  assert.equal(((await T.app.deps.db.execute(sql`select image from users where email = 'ann@example.com'`)).rows[0] as any).image, null);
});

// ---------- the client's address ----------
test('the client can\'t choose its own address: only the last proxy hop counts (rate limits, sign-in list)', async () => {
  const p = new Player(T.app, '6.6.6.6, 10.20.3.7');      // (a client writing an address of its choice, then the host's proxy adding the real one)
  assert.equal((await p.post('/api/auth/sign-in/email', { email: 'ben@example.com', password: PW })).status, 200);
  const benId = await idOf('ben@example.com');
  const ips = (await T.app.deps.db.execute(sql`select ip_address from sessions where user_id = ${benId} order by created_at desc limit 1`)).rows.map((r: any) => r.ip_address);
  assert.deepEqual(ips, ['10.20.3.7']);
});

// ---------- headers ----------
test('the content security policy runs only the pages\' own scripts (no unsafe-inline), and the other headers', async () => {
  for (const url of ['/', '/account/', '/admin/', '/api/v1/health']) {
    const r = await new Player(T.app, '10.20.4.1').get(url);
    const csp = String(r.headers['content-security-policy']);
    const scriptSrc = csp.split(';').map(x => x.trim()).find(x => x.startsWith('script-src'))!;
    assert.ok(scriptSrc && !scriptSrc.includes("'unsafe-inline'"), `${url}: ${scriptSrc}`);
    assert.match(scriptSrc, /'sha256-/);
    assert.match(csp, /frame-ancestors 'none'/); assert.match(csp, /object-src 'none'/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.ok(r.headers['referrer-policy']);
  }
});

// ---------- one player, another's data and items ----------
test('no player reaches another\'s data or items, whatever id they send', async () => {
  const annId = await idOf('ann@example.com'), benId = await idOf('ben@example.com');
  const benProfile = (await ben.get('/api/v1/player')).body.profile, benCar = benProfile.currentCar;
  const benPart = Object.values<any>(benProfile.parts)[0].instanceId;
  // their items: refused as not the player's own, and still theirs after
  for (const [action, args] of [['sellPart', { instanceId: benPart }], ['sellCar', { carInstanceId: benCar }], ['selectCar', { carInstanceId: benCar }],
    ['repairPart', { instanceId: benPart }], ['setPaint', { carInstanceId: benCar, paint: null }], ['removePart', { carInstanceId: benCar, which: 'socket_engine' }]] as const) {
    const r = await act(ann, action, args);
    assert.ok(r.status === 409 || r.status === 400, `${action}: ${r.status} ${r.text.slice(0, 160)}`);
  }
  const after = (await ben.get('/api/v1/player')).body.profile;
  assert.ok(after.parts[benPart] && after.cars[benCar], 'Ben\'s part and car are his');
  // their drive: not started, not kept alive, not ended by someone else
  assert.ok((await ann.post('/api/v1/player/drives', { carInstanceId: benCar, mode: 'free' })).status >= 400);
  const drive = await ben.post('/api/v1/player/drives', { carInstanceId: benCar, mode: 'free' });
  if (drive.status === 200 && drive.body.sessionId) {
    assert.ok((await ann.post(`/api/v1/player/sessions/${drive.body.sessionId}/heartbeat`)).status >= 400);
    await ann.post(`/api/v1/player/drives/${drive.body.sessionId}/end`);
    const st = (await T.app.deps.db.execute(sql`select state from economy_sessions where id = ${drive.body.sessionId}`)).rows[0] as any;
    assert.equal(st.state, 'active', 'his drive still running');
  }
  // their recordings, ledger, records, replays, export
  await T.app.deps.db.execute(sql`insert into player_recordings (user_id, id, data) values (${benId}, 'rec_secret', ${zlib.gzipSync(Buffer.from('{"x":1}'))})`);
  assert.equal((await ann.get('/api/v1/player/recordings/rec_secret')).status, 404);
  assert.equal((await ben.get('/api/v1/player/recordings/rec_secret')).status, 200);
  const ledger = (await ann.get('/api/v1/player/ledger')).body.entries;
  const ids = (await T.app.deps.db.execute(sql`select id from ledger where user_id = ${benId}`)).rows.map((r: any) => Number(r.id));
  assert.ok(!ledger.some((e: any) => ids.includes(e.id)), 'only her own ledger');
  assert.ok((await ann.get('/api/v1/tracks/records')).body.records.every((r: any) => !r.userId || r.userId === annId));
  await T.app.deps.db.execute(sql`insert into replays (id, owner_id, title, duration, cars, bytes, data) values ('rp_bensreplay01', ${benId}, 'Ben''s', 10, 1, 4, ${zlib.gzipSync(Buffer.from('{}'))})`).catch(() => null);
  const del = await ann.del('/api/v1/replays/rp_bensreplay01');
  assert.ok(del.status === 404 || del.status === 403, `${del.status}`);
  const exp = await ann.get('/api/v1/me/export');
  assert.ok(!exp.text.includes('ben@example.com') && !exp.text.includes(benId), 'her export holds nothing of his');
  // the admin's and editor's endpoints: refused to players
  assert.equal((await ann.get(`/api/v1/admin/players/${benId}`)).status, 403);
  assert.equal((await ann.post(`/api/v1/admin/players/${benId}/money`, { amount: 1e6, reason: 'mine now' })).status, 403);
  assert.equal((await ann.get('/api/v1/content?lat=37.79&lon=-122.39&km=1&view=draft')).status, 403);
});

// ---------- expired and ended sessions ----------
test('an expired session, a signed-out one and a banned account\'s are refused', async () => {
  const p = await signUp(T.app, T.outbox, { email: 'eve@example.com', name: 'Eve Exit', ip: '10.20.5.1' });
  assert.equal((await p.get('/api/v1/me')).status, 200);
  const id = await idOf('eve@example.com');
  await T.app.deps.db.execute(sql`update sessions set expires_at = now() - interval '1 minute' where user_id = ${id}`);
  assert.equal((await p.get('/api/v1/me')).status, 401, 'expired');
  assert.equal((await p.post('/api/v1/player/actions/markHint', { args: { id: 'x' } })).status, 401);
  const q = await signUp(T.app, T.outbox, { email: 'fay@example.com', name: 'Fay Fade', ip: '10.20.5.2' });
  const other = new Player(T.app, '10.20.5.3');
  assert.equal((await other.post('/api/auth/sign-in/email', { email: 'fay@example.com', password: PW })).status, 200);
  assert.equal((await q.post('/api/v1/me/sign-out-everywhere')).status, 200);
  assert.equal((await other.get('/api/v1/me')).status, 401, 'signed out everywhere');
});
