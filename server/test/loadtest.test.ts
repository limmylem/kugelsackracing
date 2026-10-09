// The load test's join tickets (Phase 7 Step 5; routes/rt.ts, server/tools/online-bots.ts): with LOADTEST_TOKEN set, the
// token in x-kr-loadtest and { bot: n } (1–200) → a ticket for a made-up guest "loadtest-<n>" with no account — in the
// closed beta, past the bot check, not counted by the per-address limits; logged without the token. Unset or wrong: the
// route answers exactly as it always has.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { testApp, Player } from './helpers.ts';
import { verifyTicket, loadtestBot } from '../src/rt/tickets.ts';
import { loadConfig } from '../src/config.ts';
import { isLoadtest } from '../src/routes/rt.ts';

const TOKEN = 'loadtest-token-for-the-tests-0123456789abcdef';
const ask = (p: Player, body: unknown, token?: string) => p.post('/api/v1/rt/ticket', body, { headers: token ? { 'x-kr-loadtest': token } : {} });
// (what an answer says, less the parts that differ every time)
const same = (r: { status: number; body: any }) => ({ status: r.status, code: r.body?.error?.code ?? null, message: r.body?.error?.message ?? null });

test('without the token set, or with a wrong one, the route is as it was', async () => {
  for (const env of [{}, { LOADTEST_TOKEN: TOKEN }] as Record<string, string>[]) {
    const T = await testApp('loadtest_off', { env });
    try {
      const p = new Player(T.app, '10.61.0.1');
      for (const token of [TOKEN, 'wrong-wrong-wrong-wrong-wrong-wrong-0123', '']) {
        if ('LOADTEST_TOKEN' in env && token === TOKEN) continue;
        assert.deepEqual(same(await ask(p, { bot: 3 }, token)), same(await ask(p, { bot: 3 })), `bot body, token ${token ? 'wrong' : 'none'}`);
        assert.deepEqual(same(await ask(p, {}, token)), same(await ask(p, {})));
        assert.equal((await ask(p, {}, token)).status, 401, 'no session: no ticket');
      }
    } finally { await T.close(); }
  }
});

test('the right token: a made-up guest\'s ticket, no account, closed beta and bot check or not; the bot range', async () => {
  const lines: string[] = [];
  const T = await testApp('loadtest_on', { env: { LOADTEST_TOKEN: TOKEN, RT_URL: 'ws://localhost:2811' }, overrides: { closedBeta: true, logLevel: 'info' }, botCheck: async () => ({ ok: false, reason: 'always' }), logStream: { write: (m: string) => { lines.push(m); } } });
  try {
    const p = new Player(T.app, '10.61.0.2');
    assert.equal((await p.get('/api/v1/client-config')).body.closedBeta, true);
    const users0 = Number(((await T.app.deps.db.execute(sql`select count(*) as n from users`)).rows[0] as any).n);
    const r = await ask(p, { bot: 7 }, TOKEN);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.url, 'ws://localhost:2811');
    const t = verifyTicket(T.config.rtSecret, r.body.ticket)!;
    assert.equal(t.uid, 'loadtest-7'); assert.equal(t.name, 'Bot 7'); assert.equal(t.guest, true); assert.equal(t.role, 'player');
    // (the real-time server knows it for a load-test bot: its free-roam place isn't saved, its races and runs not handed in)
    assert.ok(loadtestBot(t.uid)); assert.ok(!loadtestBot('dev-player-a')); assert.ok(!loadtestBot(undefined));
    assert.deepEqual(t.mp?.rating, { mu: 25, sigma: 25 / 3, races: 0 }); assert.deepEqual(t.mp?.blocked, []); assert.equal(t.mp?.cooldownUntil, null);
    assert.equal(Number(((await T.app.deps.db.execute(sql`select count(*) as n from users`)).rows[0] as any).n), users0, 'no account made');
    assert.equal(verifyTicket(T.config.rtSecret, (await ask(p, { bot: 1 }, TOKEN)).body.ticket)!.uid, 'loadtest-1');
    assert.equal(verifyTicket(T.config.rtSecret, (await ask(p, { bot: 200 }, TOKEN)).body.ticket)!.uid, 'loadtest-200');
    for (const bad of [{ bot: 0 }, { bot: 201 }, { bot: 1.5 }, { bot: '3' }, {}, { bot: 3, player: 'A' }, null]) assert.equal((await ask(p, bad, TOKEN)).status, 400, JSON.stringify(bad));
    // (an ordinary request in the closed beta with the bot check refusing everything: still no ticket without a session)
    assert.equal((await ask(p, {})).status, 401);
    // logged: each use, counted — never the token
    const logged = lines.filter(l => l.includes('load-test ticket'));
    assert.equal(logged.length, 3);
    assert.match(logged.at(-1)!, /"uses":3/);
    assert.ok(!lines.some(l => l.includes(TOKEN)), 'the token never in the log');
  } finally { await T.close(); }
});

test('the per-address limits: the bots\' tickets aren\'t counted; everything else still is', async () => {
  const L = { max: 3, windowSec: 60 };
  const T = await testApp('loadtest_rl', { env: { LOADTEST_TOKEN: TOKEN }, overrides: { rateLimits: { global: L, auth: L, signUp: L, write: L } } });
  try {
    const p = new Player(T.app, '10.61.0.3');
    for (let n = 1; n <= 20; n++) assert.equal((await ask(p, { bot: n }, TOKEN)).status, 200, `bot ${n}`);
    const others: number[] = [];
    for (let i = 0; i < 5; i++) others.push((await p.get('/api/v1/client-config')).status);
    assert.deepEqual(others, [200, 200, 200, 429, 429], 'the address\'s own requests counted as ever');
    // (a wrong token is an ordinary request: counted, and limited)
    assert.equal((await ask(p, { bot: 1 }, 'wrong-wrong-wrong-wrong-wrong-wrong-0123')).status, 429);
  } finally { await T.close(); }
});

test('LOADTEST_TOKEN: at least 32 characters; isLoadtest only for the ticket route', () => {
  const env = { APP_ENV: 'test', PUBLIC_URL: 'http://localhost:8787', DATABASE_URL: 'postgres://x', BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123456789' };
  assert.throws(() => loadConfig({ ...env, LOADTEST_TOKEN: 'short' }), /LOADTEST_TOKEN/);
  assert.equal(loadConfig(env).loadtestToken, null);
  assert.equal(loadConfig({ ...env, LOADTEST_TOKEN: TOKEN }).loadtestToken, TOKEN);
  const req = (method: string, url: string, token?: string) => ({ method, url, headers: token ? { 'x-kr-loadtest': token } : {} });
  assert.equal(isLoadtest(TOKEN, req('POST', '/api/v1/rt/ticket', TOKEN)), true);
  assert.equal(isLoadtest(TOKEN, req('POST', '/api/v1//rt/ticket?x=1', TOKEN)), true);
  assert.equal(isLoadtest(TOKEN, req('POST', '/api/v1/rt/ticket', TOKEN.slice(1))), false);
  assert.equal(isLoadtest(TOKEN, req('POST', '/api/v1/me', TOKEN)), false);
  assert.equal(isLoadtest(TOKEN, req('GET', '/api/v1/rt/ticket', TOKEN)), false);
  assert.equal(isLoadtest(null, req('POST', '/api/v1/rt/ticket', TOKEN)), false);
  assert.equal(isLoadtest(TOKEN, req('POST', '/api/v1/rt/ticket')), false);
});
