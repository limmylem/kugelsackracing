// Accounts end to end (Phase 6 Step 1): sign up (terms, minimum age, the display name's rules), verify by email,
// sign in, sign out, sign out everywhere, reset a password, a social login (an OAuth provider: the mock server,
// through Better Auth's generic OAuth — the same flow as Google's and Discord's), a guest who plays then signs up
// keeping their progress, changing a display name (filter, uniqueness, the limit), the data export, deleting
// the account.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { OAuth2Server } from 'oauth2-mock-server';
import { sql } from 'drizzle-orm';
import { testApp, Player, signUp, linkIn, path, birth } from './helpers.ts';

let T: Awaited<ReturnType<typeof testApp>>, oauth: OAuth2Server;
before(async () => {
  oauth = new OAuth2Server();
  await oauth.issuer.keys.generate('RS256');
  await oauth.start(0, '127.0.0.1');
  oauth.service.on('beforeUserinfo', (res: any) => { res.body = { sub: 'mock-user-1', email: 'ola@example.com', email_verified: true, name: 'Ola Nordmann' }; });
  oauth.service.on('beforeTokenSigning', (token: any) => { token.payload.sub = 'mock-user-1'; token.payload.email = 'ola@example.com'; token.payload.email_verified = true; token.payload.name = 'Ola Nordmann'; });
  T = await testApp('acct', { mockOAuth: { discoveryUrl: `${oauth.issuer.url}/.well-known/openid-configuration`, clientId: 'kr-test', clientSecret: 'kr-test-secret' } });
});
after(async () => { await T?.close(); await oauth?.stop(); });

test('sign up: the terms and the minimum age, a display name that is allowed and free; verified by email before signing in', async () => {
  const p = new Player(T.app);
  const base = { email: 'ada@example.com', password: 'correct horse battery', name: 'Ada Racer', acceptTerms: T.config.termsVersion, birthDate: birth(25) };
  // (no terms; too young; a name not allowed; a weak password)
  assert.equal((await p.post('/api/auth/sign-up/email', { ...base, acceptTerms: undefined })).status, 400);
  const young = await p.post('/api/auth/sign-up/email', { ...base, birthDate: birth(T.config.minAge - 1) });
  assert.equal(young.status, 400); assert.match(young.body.error.message, /at least 13/);
  const rude = await p.post('/api/auth/sign-up/email', { ...base, name: 'fuck racer' });
  assert.equal(rude.status, 400); assert.equal(rude.body.error.code, 'NAME_NOT_ALLOWED');
  assert.equal((await p.post('/api/auth/sign-up/email', { ...base, password: 'short' })).status, 400);
  const ok = await p.post('/api/auth/sign-up/email', base);
  assert.equal(ok.status, 200, ok.text);
  // (the same name in another case: taken)
  const dup = await new Player(T.app).post('/api/auth/sign-up/email', { ...base, email: 'other@example.com', name: 'ADA RACER' });
  assert.equal(dup.status, 400); assert.equal(dup.body.error.code, 'NAME_TAKEN');
  // not verified: no signing in
  const early = await p.post('/api/auth/sign-in/email', { email: base.email, password: base.password });
  assert.equal(early.status, 403);
  const mail = T.outbox.find(m => m.to === base.email && m.kind === 'verify-email')!;
  assert.ok(mail, 'a verification email');
  const v = await p.get(path(linkIn(mail)));
  assert.ok(v.status < 400, v.text);
  const me = await p.get('/api/v1/me');
  assert.equal(me.status, 200, me.text);
  assert.equal(me.body.user.displayName, 'Ada Racer'); assert.equal(me.body.user.role, 'player'); assert.equal(me.body.user.emailVerified, true);
  assert.equal(me.body.user.needsTerms, false); assert.equal(me.body.user.isGuest, false);
  // (the session cookie: httpOnly, SameSite=Lax)
  const set = String(v.headers['set-cookie'] ?? '');
  assert.match(set, /HttpOnly/i); assert.match(set, /SameSite=Lax/i);
  // (only the check's result is kept, never the birth date)
  const cols = (await T.app.deps.db.execute(sql`select column_name from information_schema.columns where table_name = 'users'`)).rows.map((r: any) => r.column_name);
  assert.ok(!cols.some((c: string) => /birth/.test(c)));
});

test('sign in, sign out; a wrong password; sign out everywhere ends every session', async () => {
  const a = await signUp(T.app, T.outbox, { email: 'bo@example.com', name: 'Bo Kart' });
  const b = new Player(T.app, '10.0.0.2');
  assert.equal((await b.post('/api/auth/sign-in/email', { email: 'bo@example.com', password: 'wrong password!!' })).status, 401);
  assert.equal((await b.post('/api/auth/sign-in/email', { email: 'bo@example.com', password: 'correct horse battery' })).status, 200);
  assert.equal((await b.get('/api/v1/me')).status, 200);
  assert.equal((await b.post('/api/auth/sign-out', {})).status, 200);
  assert.equal((await b.get('/api/v1/me')).status, 401);
  // two browsers signed in; sign out everywhere from one
  const c = new Player(T.app, '10.0.0.3');
  await c.post('/api/auth/sign-in/email', { email: 'bo@example.com', password: 'correct horse battery' });
  assert.equal((await c.get('/api/v1/me')).status, 200);
  assert.equal((await a.post('/api/v1/me/sign-out-everywhere')).status, 200);
  assert.equal((await a.get('/api/v1/me')).status, 401);
  assert.equal((await c.get('/api/v1/me')).status, 401);
});

test('password reset: by an emailed link; the old password stops working, other sessions end', async () => {
  const a = await signUp(T.app, T.outbox, { email: 'cy@example.com', name: 'Cy Speed' });
  const anon = new Player(T.app, '10.0.0.4');
  assert.equal((await anon.post('/api/auth/request-password-reset', { email: 'cy@example.com', redirectTo: '/reset' })).status, 200);
  // (no hint whether an address has an account)
  assert.equal((await anon.post('/api/auth/request-password-reset', { email: 'nobody@example.com', redirectTo: '/reset' })).status, 200);
  const mail = T.outbox.find(m => m.to === 'cy@example.com' && m.kind === 'reset-password')!;
  assert.ok(mail);
  const token = new URL(linkIn(mail)).pathname.split('/').pop()!;
  assert.equal((await anon.post('/api/auth/reset-password', { token, newPassword: 'a new long password' })).status, 200);
  assert.equal((await anon.post('/api/auth/reset-password', { token, newPassword: 'another long password' })).status, 400, 'a link works once');
  assert.equal((await new Player(T.app).post('/api/auth/sign-in/email', { email: 'cy@example.com', password: 'correct horse battery' })).status, 401);
  assert.equal((await new Player(T.app).post('/api/auth/sign-in/email', { email: 'cy@example.com', password: 'a new long password' })).status, 200);
  assert.equal((await a.get('/api/v1/me')).status, 401, 'the old session ended');
});

test('a social login (OAuth with PKCE): a new account, its name made to fit, the terms still to accept', async () => {
  const p = new Player(T.app, '10.0.0.5');
  const start = await p.post('/api/auth/sign-in/social', { provider: 'mock', callbackURL: '/' });
  assert.equal(start.status, 200, start.text);
  // (the provider's sign-in page — the mock signs in at once — and back to our callback)
  const auth = await fetch(start.body.url, { redirect: 'manual' });
  const back = auth.headers.get('location')!;
  assert.match(back, /\/api\/auth\/(oauth2\/)?callback\/mock\?/);
  const cb = await p.get(path(back));
  assert.ok(cb.status === 302 || cb.status === 200, `${cb.status} ${cb.text}`);
  const me = await p.get('/api/v1/me');
  assert.equal(me.status, 200, me.text);
  assert.equal(me.body.user.displayName, 'Ola Nordmann');
  assert.ok(me.body.user.providers.includes('mock'));
  assert.equal(me.body.user.needsTerms, true);
  // (nothing else until the terms are accepted)
  assert.equal((await p.patch('/api/v1/me/name', { displayName: 'Ola N' })).body.error.code, 'TERMS_REQUIRED');
  assert.equal((await p.post('/api/v1/me/terms', { termsVersion: T.config.termsVersion, birthDate: birth(9) })).status, 400, 'too young');
  assert.equal((await p.post('/api/v1/me/terms', { termsVersion: T.config.termsVersion, birthDate: birth(30) })).status, 200);
  assert.equal((await p.get('/api/v1/me')).body.user.needsTerms, false);
});

test('a guest plays, then signs up: their records and replays come with them', async () => {
  const g = new Player(T.app, '10.0.0.6');
  assert.equal((await g.post('/api/auth/sign-in/anonymous', {})).status, 200);
  let me = await g.get('/api/v1/me');
  assert.equal(me.body.user.isGuest, true); assert.match(me.body.user.displayName, /^Guest-/); assert.equal(me.body.user.needsTerms, true);
  const guestId = me.body.user.id;
  assert.equal((await g.post('/api/v1/me/terms', { termsVersion: T.config.termsVersion, birthDate: birth(20) })).status, 200);
  // (their progress on the server: a record and a replay)
  await T.app.deps.db.execute(sql`insert into track_records (user_id, code, version, car_class, best_time, best_lap) values (${guestId}, 'TEST', 3, 'D', 80, 40)`);
  await T.app.deps.db.execute(sql`insert into replays (id, owner_id, title, duration, cars, bytes, data) values ('rp_guest', ${guestId}, 'mine', 80, 3, 10, '\\x00'::bytea)`);
  // sign up in the same browser (the guest's session still on it), verify — the link moves everything
  const up = await g.post('/api/auth/sign-up/email', { email: 'dee@example.com', password: 'correct horse battery', name: 'Dee Drift', acceptTerms: T.config.termsVersion, birthDate: birth(20) });
  assert.equal(up.status, 200, up.text);
  const mail = T.outbox.find(m => m.to === 'dee@example.com' && m.kind === 'verify-email')!;
  assert.ok((await g.get(path(linkIn(mail)))).status < 400);
  me = await g.get('/api/v1/me');
  assert.equal(me.body.user.isGuest, false); assert.equal(me.body.user.displayName, 'Dee Drift');
  const newId = me.body.user.id;
  assert.notEqual(newId, guestId);
  const rec = (await T.app.deps.db.execute(sql`select user_id from track_records where code = 'TEST'`)).rows;
  assert.deepEqual(rec.map((r: any) => r.user_id), [newId]);
  const rp = (await T.app.deps.db.execute(sql`select owner_id from replays where id = 'rp_guest'`)).rows;
  assert.equal((rp[0] as any).owner_id, newId);
  assert.equal((await T.app.deps.db.execute(sql`select 1 from users where id = ${guestId}`)).rows.length, 0, 'the guest account is gone');
});

test('display names: checked, changed once, then not again for 30 days; a name only through our endpoint', async () => {
  const p = await signUp(T.app, T.outbox, { email: 'eve@example.com', name: 'Eve Apex' });
  await signUp(T.app, T.outbox, { email: 'fin@example.com', name: 'Fin Line' });
  assert.equal((await p.get('/api/v1/me/name-check?name=fin%20line')).body.available, false);
  assert.equal((await p.get('/api/v1/me/name-check?name=sh1t')).body.available, false);
  assert.equal((await p.get('/api/v1/me/name-check?name=Eve%20Zero')).body.available, true);
  assert.equal((await p.patch('/api/v1/me/name', { displayName: 'Fin Line' })).body.error.code, 'NAME_TAKEN');
  assert.equal((await p.patch('/api/v1/me/name', { displayName: '  x' })).status, 400);
  assert.equal((await p.patch('/api/v1/me/name', { displayName: 'Eve Zero' })).status, 200);
  assert.equal((await p.get('/api/v1/me')).body.user.displayName, 'Eve Zero');
  const again = await p.patch('/api/v1/me/name', { displayName: 'Eve Again' });
  assert.equal(again.status, 429); assert.equal(again.body.error.code, 'NAME_CHANGE_TOO_SOON');
  // (Better Auth's own update-user can't change it)
  assert.equal((await p.post('/api/auth/update-user', { name: 'Sneaky Name' })).status, 400);
  assert.equal((await p.get('/api/v1/me')).body.user.displayName, 'Eve Zero');
});

test('data export, then account deletion: the player\'s data goes, a password or a fresh sign-in needed', async () => {
  const p = await signUp(T.app, T.outbox, { email: 'gus@example.com', name: 'Gus Grip' });
  const id = (await p.get('/api/v1/me')).body.user.id;
  await T.app.deps.db.execute(sql`insert into track_records (user_id, code, version, car_class, best_time) values (${id}, 'GUS', 3, 'D', 70)`);
  const ex = await p.get('/api/v1/me/export');
  assert.equal(ex.status, 200);
  assert.equal(ex.body.account.email, 'gus@example.com');
  assert.equal(ex.body.trackRecords.length, 1);
  assert.ok(!JSON.stringify(ex.body).includes('scrypt') && !ex.text.includes('"password"'), 'no password hash in the export');
  assert.match(String(ex.headers['content-disposition']), /attachment/);
  assert.equal((await p.del('/api/v1/me', { confirm: 'nope' })).status, 400);
  assert.equal((await p.del('/api/v1/me', { confirm: 'DELETE', password: 'wrong password!!' })).status, 403);
  const gone = await p.del('/api/v1/me', { confirm: 'DELETE', password: 'correct horse battery' });
  assert.equal(gone.status, 200, gone.text);
  assert.equal((await p.get('/api/v1/me')).status, 401);
  assert.equal((await T.app.deps.db.execute(sql`select 1 from users where id = ${id}`)).rows.length, 0);
  assert.equal((await T.app.deps.db.execute(sql`select 1 from track_records where user_id = ${id}`)).rows.length, 0);
  assert.equal((await new Player(T.app).post('/api/auth/sign-in/email', { email: 'gus@example.com', password: 'correct horse battery' })).status, 401);
});
