// Phase 7 Step 5: the game's last errors with a feedback message (account/errors.js → POST /api/v1/feedback { errors }):
// accepted as the game sends them, within tight limits (nothing else, nothing longer, at most 20); kept with the device
// info and shown to admins only (GET /admin/support: each ticket's errors apart from its device info).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CLIENT_PROTOCOL } from '@kr/shared';
import { testApp, signUp, makeStaff, type Player } from './helpers.ts';
import { scrub } from '../../account/errors.js';

let T: Awaited<ReturnType<typeof testApp>>, boss: Player, ann: Player;
before(async () => {
  T = await testApp('fberrors');
  [boss, ann] = await Promise.all([
    signUp(T.app, T.outbox, { email: 'boss@example.com', name: 'Bea Boss', ip: '10.82.0.1' }),
    signUp(T.app, T.outbox, { email: 'ann@example.com', name: 'Ann Apex', ip: '10.82.0.2' }),
  ]);
  await makeStaff(T.app, boss, 'boss@example.com', 'admin');
});
after(async () => { await T?.close(); });
const client = { version: 'abc1234', protocol: CLIENT_PROTOCOL, userAgent: 'Mozilla/5.0 Test', screen: '1920x1080' };
const err = (o: object = {}) => ({ at: '2026-10-09T10:00:00.000Z', kind: 'error', message: 'TypeError: x is undefined', source: 'https://ognistrada.com/play/mpScreens.js:12:5', stack: 'TypeError: x is undefined\n    at draw (https://ognistrada.com/play/mpScreens.js:12:5)', count: 3, ...o });

test('feedback with the game\'s errors: accepted, within limits; admins see them apart from the device info, players never', async () => {
  const ok = await ann.post('/api/v1/feedback', { message: 'The results screen froze after the race.', mood: 'dislike', client, errors: [err(), err({ kind: 'rejection', message: 'Failed to fetch', source: undefined, stack: undefined, count: 1 })] });
  assert.equal(ok.status, 200, ok.text);
  assert.equal((await ann.post('/api/v1/feedback', { message: 'No errors this time, all good.', client })).status, 200, 'errors are optional');
  // (tight limits: the message, the stack, how many, only these fields)
  const bad = async (body: object, why: string) => assert.equal((await ann.post('/api/v1/feedback', { message: 'Testing the limits here', client, ...body })).status, 400, why);
  await bad({ errors: [err({ message: 'x'.repeat(301) })] }, 'a message over 300 characters');
  await bad({ errors: [err({ stack: 'x'.repeat(1501) })] }, 'a stack over 1,500 characters');
  await bad({ errors: [err({ source: 'x'.repeat(301) })] }, 'a source over 300 characters');
  await bad({ errors: Array.from({ length: 21 }, () => err()) }, 'more than 20');
  await bad({ errors: [err({ cookie: 'x' })] }, 'anything else in one');
  await bad({ errors: [err({ kind: 'warning' })] }, 'an unknown kind');
  await bad({ errors: [err({ count: 0 })] }, 'a count below one');
  await bad({ errors: 'oops' }, 'not a list');
  // the admins: each ticket's errors, apart from its device info
  assert.equal((await ann.get('/api/v1/admin/support')).status, 403, 'players never see the list');
  const list = (await boss.get('/api/v1/admin/support?kind=feedback')).body.tickets;
  const froze = list.find((t: any) => /froze/.test(t.message)), fine = list.find((t: any) => /all good/.test(t.message));
  assert.equal(froze.errors.length, 2); assert.equal(froze.errors[0].count, 3); assert.equal(froze.errors[1].message, 'Failed to fetch');
  assert.equal(froze.client.version, 'abc1234'); assert.ok(!('errors' in froze.client), 'the device info without them');
  assert.deepEqual(fine.errors, []);
});

test('the game strips addresses before sending: no queries or fragments (tokens, invite codes), no emails; a stack keeps its line', () => {
  assert.equal(scrub('at f (https://ognistrada.com/play/x.js?v=12:10:5)'), 'at f (https://ognistrada.com/play/x.js:10:5)');
  assert.equal(scrub('GET https://api.ognistrada.com/api/v1/rt/ticket?token=abc#frag failed'), 'GET https://api.ognistrada.com/api/v1/rt/ticket failed');
  assert.equal(scrub('went to /account/?mode=sign-up&invite=ABCDE-FGHIJ then'), 'went to /account/ then');
  assert.equal(scrub('wss://rt.ognistrada.com/hub?ticket=xyz closed'), 'wss://rt.ognistrada.com/hub closed');
  assert.equal(scrub('mail ann@example.com, code=1234'), 'mail (email), code=…');
  assert.equal(scrub('Is this right? Yes.'), 'Is this right? Yes.');
  assert.equal(scrub('x'.repeat(400), 300).length, 300);
});
