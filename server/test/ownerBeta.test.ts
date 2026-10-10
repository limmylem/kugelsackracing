// The closed beta online and the owner (ADMIN_EMAIL): the owner's own address signs up without an invite code — nobody
// can make codes before there's an admin — and becomes an admin only once that email is confirmed (roles.test.ts);
// any other address still needs a code.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { testApp, Player, birth } from './helpers.ts';

let T: Awaited<ReturnType<typeof testApp>>;
before(async () => { T = await testApp('ownerbeta', { env: { ADMIN_EMAIL: 'Owner@Example.com' }, overrides: { closedBeta: true } }); });
after(async () => { await T?.close(); });

const signUp = (email: string, name: string, ip: string) => new Player(T.app, ip).post('/api/auth/sign-up/email', { email, password: 'correct horse battery', name, acceptTerms: T.config.termsVersion, birthDate: birth(30) }, { headers: { 'x-bot-check': 'human' } });

test('the closed beta: the owner\'s address signs up without a code (an admin once confirmed); anyone else needs one', async () => {
  assert.equal((await new Player(T.app).get('/api/v1/client-config')).body.closedBeta, true);
  const other = await signUp('someone@example.com', 'Some One', '10.40.0.1');
  assert.equal(other.status, 403); assert.equal(other.body.error.code, 'INVITE_REQUIRED');
  const owner = await signUp('owner@EXAMPLE.com', 'The Owner', '10.40.0.2');
  assert.equal(owner.status, 200, owner.text);
  const role = async () => ((await T.app.deps.db.execute(sql`select role from users where lower(email) = 'owner@example.com'`)).rows[0] as any)?.role;
  assert.equal(await role(), 'player', 'not an admin before the email is confirmed');
  const mail = T.outbox.find(m => m.to === 'owner@example.com' && m.kind === 'verify-email');
  assert.ok(mail, 'the confirmation email sent');
});
