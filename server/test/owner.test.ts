// Signing up on this computer (development: requireEmailVerification and staffMfa.required off) and the owner. A new
// email account is signed in at once — no email sent, nothing to confirm; the owner (ADMIN_EMAIL) is an admin as soon as
// the account is made; tools/make-owner.ts makes (or promotes) an owner by hand. The owner's admin tools open without
// an authenticator app here. Online (requireEmailVerification on) none of this changes: roles.test.ts.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { testApp, Player, birth } from './helpers.ts';
import { makeOwner } from '../src/owner.ts';

let T: Awaited<ReturnType<typeof testApp>>;
before(async () => { T = await testApp('owner', { env: { ADMIN_EMAIL: 'Me@Example.com' }, overrides: { requireEmailVerification: false, staffMfa: { required: false, maxAgeHours: 12 } } }); });
after(async () => { await T?.close(); });

test('signing up needs no email: signed in at once, nothing sent; the client is told so', async () => {
  const cfg = await new Player(T.app).get('/api/v1/client-config');
  assert.equal(cfg.body.emailVerification, false);
  const p = new Player(T.app, '10.9.0.1');
  const r = await p.post('/api/auth/sign-up/email', { email: 'racer@example.com', password: 'correct horse battery', name: 'Racer One', acceptTerms: T.config.termsVersion, birthDate: birth(25) });
  assert.equal(r.status, 200, r.text);
  assert.equal(T.outbox.filter(m => m.to === 'racer@example.com').length, 0, 'no email sent');
  const me = await p.get('/api/v1/me');
  assert.equal(me.status, 200, me.text);
  assert.equal(me.body.user.displayName, 'Racer One');
  // (and signing in again later works without a confirmed email)
  const q = new Player(T.app, '10.9.0.2');
  assert.equal((await q.post('/api/auth/sign-in/email', { email: 'racer@example.com', password: 'correct horse battery' })).status, 200);
});

test('the owner (ADMIN_EMAIL) is an admin as soon as they sign up, with every control, no authenticator app needed here', async () => {
  const p = new Player(T.app, '10.9.0.3');
  assert.equal((await p.post('/api/auth/sign-up/email', { email: 'me@example.com', password: 'correct horse battery', name: 'The Owner', acceptTerms: T.config.termsVersion, birthDate: birth(30) })).status, 200);
  const me = await p.get('/api/v1/me');
  assert.equal(me.body.user.role, 'admin');
  // (an admin endpoint and an editor one both open)
  assert.equal((await p.get('/api/v1/admin/mp/dashboard')).status, 200);
  const editor = T.app.routeList.find(r => r.role === 'editor' && r.method === 'GET' && !r.url.includes(':'));
  assert.ok(editor, 'an editor route');
  assert.equal((await p.get(editor!.url)).status, 200, editor!.url);
});

test('make-owner: an existing account made the owner (email confirmed, terms accepted), logged once', async () => {
  const p = new Player(T.app, '10.9.0.4');
  await p.post('/api/auth/sign-up/email', { email: 'later@example.com', password: 'correct horse battery', name: 'Later Owner', acceptTerms: T.config.termsVersion, birthDate: birth(30) });
  const db = T.app.deps.db;
  assert.equal((await makeOwner(db, 'LATER@example.com', T.config.termsVersion))?.name, 'Later Owner');
  await makeOwner(db, 'later@example.com', T.config.termsVersion);
  const u = (await db.execute(sql`select id, role, email_verified from users where email = 'later@example.com'`)).rows[0] as any;
  assert.equal(u.role, 'admin'); assert.equal(u.email_verified, true);
  assert.equal((await db.execute(sql`select 1 from audit_log where action = 'owner-admin' and target_id = ${u.id}`)).rows.length, 1);
  assert.equal(await makeOwner(db, 'nobody@example.com', T.config.termsVersion), null);
});
