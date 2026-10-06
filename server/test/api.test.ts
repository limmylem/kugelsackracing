// The API's defences (Phase 6 Step 1): security headers; CORS for the game's own origin only; CSRF on every
// cookie-session write; writes applied once (Idempotency-Key: replayed, refused when reused for another
// request, needed on every write, per account); invalid, malicious, oversized and malformed requests
// refused cleanly in the one error format; rate limits (stricter on signing in and up); and the logs never
// holding a password, a token, a cookie or a secret query value.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { testApp, Player, signUp, linkIn, path, PUBLIC_URL, makeStaff } from './helpers.ts';
import { newItem } from '../../content/quests.js';

const logs: string[] = [];
let T: Awaited<ReturnType<typeof testApp>>, ed: Player, pl: Player;
before(async () => {
  T = await testApp('api', { overrides: { logLevel: 'info' }, logStream: { write: (m: string) => { logs.push(m); } } });
  ed = await signUp(T.app, T.outbox, { email: 'ed@example.com', name: 'Ed Itor', ip: '10.4.0.1' });
  pl = await signUp(T.app, T.outbox, { email: 'pl@example.com', name: 'Pla Yer', ip: '10.4.0.2' });
  await makeStaff(T.app, ed, 'ed@example.com', 'editor');
});
after(async () => { await T?.close(); });

const errShape = (r: any, status: number, code?: string) => {
  assert.equal(r.status, status, r.text);
  assert.equal(typeof r.body?.error?.message, 'string', r.text);
  assert.match(r.body.error.requestId, /^[0-9a-f-]{36}$/);
  if (code) assert.equal(r.body.error.code, code);
  assert.ok(!/at .*\.(ts|js):\d+/.test(r.text), 'no stack traces');
};
const quest = () => newItem('quest', { location: { lat: 37.79, lon: -122.39 }, type: 'sprint' } as any);

test('security headers on every answer; HSTS where it\'s served over HTTPS', async () => {
  const r = await new Player(T.app).get('/api/v1/health');
  assert.equal(r.status, 200);
  const h = r.headers;
  assert.match(String(h['content-security-policy']), /default-src 'self'/);
  assert.match(String(h['content-security-policy']), /frame-ancestors 'none'/);
  assert.match(String(h['content-security-policy']), /object-src 'none'/);
  assert.equal(h['x-content-type-options'], 'nosniff');
  assert.ok(h['x-frame-options']);
  assert.ok(h['referrer-policy']);
  assert.match(String(h['x-request-id']), /^[0-9a-f-]{36}$/);
  assert.equal(h['x-powered-by'], undefined);
  // (staging and production: HTTPS only; HSTS once it's switched on — HSTS=on, docs/DEPLOYMENT.md)
  const P = await testApp('api_prod', { env: { APP_ENV: 'staging', PUBLIC_URL: 'https://kr-staging.example.com' } });
  const Q = await testApp('api_hsts', { env: { APP_ENV: 'staging', PUBLIC_URL: 'https://kr-staging.example.com', HSTS: 'on' } });
  try {
    const s = await P.app.inject({ method: 'GET', url: '/api/v1/health' });
    assert.equal(s.headers['strict-transport-security'], undefined);
    assert.match(String(s.headers['content-security-policy']), /upgrade-insecure-requests/);
    const q = await Q.app.inject({ method: 'GET', url: '/api/v1/health' });
    assert.match(String(q.headers['strict-transport-security']), /max-age=31536000; includeSubDomains/);
  } finally { await P.close(); await Q.close(); }
});

test('CORS: the game\'s own origin only, with cookies; others get nothing', async () => {
  const pre = (origin: string) => T.app.inject({ method: 'OPTIONS', url: '/api/v1/me', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-csrf-token,idempotency-key' } });
  const ok = await pre(PUBLIC_URL);
  assert.equal(ok.headers['access-control-allow-origin'], PUBLIC_URL);
  assert.equal(ok.headers['access-control-allow-credentials'], 'true');
  const evil = await pre('https://evil.example.com');
  assert.equal(evil.headers['access-control-allow-origin'], undefined);
  const get = await T.app.inject({ method: 'GET', url: '/api/v1/health', headers: { origin: 'https://evil.example.com' } });
  assert.equal(get.headers['access-control-allow-origin'], undefined);
  // (Better Auth checks the origin of its own writes too: a sign-in from another site is refused)
  const cross = await new Player(T.app).post('/api/auth/sign-in/email', { email: 'pl@example.com', password: 'correct horse battery' }, { headers: { origin: 'https://evil.example.com' } });
  assert.equal(cross.status, 403, cross.text);
});

test('CSRF: a write riding on the session cookie needs the token; a stale or another session\'s token is refused', async () => {
  const none = await pl.post('/api/v1/me/sign-out-everywhere', {}, { csrf: false });
  errShape(none, 403, 'CSRF');
  const wrong = await pl.post('/api/v1/me/sign-out-everywhere', {}, { csrf: false, headers: { 'x-csrf-token': 'forged-token-value' } });
  errShape(wrong, 403, 'CSRF');
  // (another browser's token, with its secret cookie: not this one's)
  const other = new Player(T.app, '10.4.0.9');
  await other.refreshCsrf();
  const stolen = await pl.post('/api/v1/content/items', quest(), { csrf: false, headers: { 'x-csrf-token': other.csrf! } });
  assert.equal(stolen.status, 403);
  // (still signed in: none of those did anything)
  assert.equal((await pl.get('/api/v1/me')).status, 200);
  // the CSRF cookie: httpOnly, SameSite=Strict, signed
  const c = await T.app.inject({ method: 'GET', url: '/api/v1/csrf' });
  assert.match(String(c.headers['set-cookie']), /kr_csrf=.*HttpOnly.*SameSite=Strict/i);
  assert.equal(c.headers['cache-control'], 'no-store');
});

test('idempotency: a retried write is applied once; a key reused for something else is refused; every write needs one; keys are per account', async () => {
  const key = crypto.randomUUID(), body = { ...quest(), name: 'Once only' };
  const a = await ed.post('/api/v1/content/items', body, { key });
  assert.equal(a.status, 200, a.text);
  const b = await ed.post('/api/v1/content/items', body, { key });
  assert.equal(b.status, 200);
  assert.equal(b.headers['idempotent-replayed'], 'true');
  assert.deepEqual(b.body, a.body, 'the same answer');
  const n = (await T.app.deps.db.execute(sql`select count(*)::int as n from content_items where data->>'name' = 'Once only'`)).rows[0] as any;
  assert.equal(n.n, 1, 'one item made');
  // the same key for another request
  errShape(await ed.post('/api/v1/content/items', { ...body, name: 'Something else' }, { key }), 422, 'IDEMPOTENCY_MISMATCH');
  // none; a bad one
  errShape(await ed.post('/api/v1/content/items', body, { key: null }), 400, 'IDEMPOTENCY_KEY_REQUIRED');
  errShape(await ed.post('/api/v1/content/items', body, { headers: { 'idempotency-key': 'short' } }), 400);
  errShape(await ed.post('/api/v1/content/items', body, { headers: { 'idempotency-key': 'has spaces and <tags>' } }), 400);
  // another account's same key: its own
  await makeStaff(T.app, pl, 'pl@example.com', 'editor');
  const c = await pl.post('/api/v1/content/items', { ...body, name: 'Theirs' }, { key });
  assert.equal(c.status, 200); assert.equal(c.headers['idempotent-replayed'], undefined);
  await T.app.deps.db.execute(sql`update users set role = 'player' where email = 'pl@example.com'`);
  // the same write twice at once: applied once (one runs; the other waits its turn or is told it's running)
  const k2 = crypto.randomUUID(), twice = { ...quest(), name: 'At once' };
  const [x, y] = await Promise.all([ed.post('/api/v1/content/items', twice, { key: k2 }), ed.post('/api/v1/content/items', twice, { key: k2 })]);
  assert.deepEqual([x.status, y.status].sort(), x.status === y.status ? [200, 200] : [200, 409]);
  assert.equal(((await T.app.deps.db.execute(sql`select count(*)::int as n from content_items where data->>'name' = 'At once'`)).rows[0] as any).n, 1);
});

test('bad requests are refused cleanly: malformed, the wrong type, too big, malicious, out of range — one error format, nothing leaked', async () => {
  // malformed JSON; not JSON; an empty body where one's needed
  errShape(await ed.post('/api/v1/content/items', undefined, { raw: '{"kind": "quest", ', headers: { 'content-type': 'application/json' } }), 400);
  errShape(await ed.post('/api/v1/content/items', undefined, { raw: 'kind=quest', headers: { 'content-type': 'application/x-www-form-urlencoded' } }), 415, 'UNSUPPORTED_MEDIA_TYPE');
  errShape(await ed.post('/api/v1/content/items', undefined, { raw: '<xml/>', headers: { 'content-type': 'text/xml' } }), 415);
  // too big (the default limit is 1 MiB)
  errShape(await ed.post('/api/v1/content/items', { ...quest(), description: 'x'.repeat(1_200_000) }), 413, 'PAYLOAD_TOO_LARGE');
  // out of range, wrong types, unknown kinds
  errShape(await new Player(T.app).get('/api/v1/content?lat=91&lon=0&km=1'), 400, 'VALIDATION');
  errShape(await new Player(T.app).get('/api/v1/content?lat=abc&lon=0&km=1'), 400, 'VALIDATION');
  errShape(await new Player(T.app).get('/api/v1/content?lat=0&lon=0&km=1&limit=99999999'), 400, 'VALIDATION');
  errShape(await new Player(T.app).get('/api/v1/content?lat=0&lon=0'), 400, 'VALIDATION');
  errShape(await ed.post('/api/v1/content/items', { ...quest(), kind: 'spaceship' }), 400, 'VALIDATION');
  errShape(await ed.post('/api/v1/content/items', { ...quest(), location: { lat: 'north', lon: 0 } }), 400, 'VALIDATION');
  errShape(await ed.post('/api/v1/content/items', [1, 2, 3]), 400);
  errShape(await ed.post('/api/v1/content/items', 'a string'), 400);
  errShape(await ed.post('/api/v1/content/items', null), 400);
  // path parameters: traversal, odd characters
  errShape(await ed.get('/api/v1/content/items/..%2F..%2Fetc%2Fpasswd?view=draft'), 400);
  errShape(await ed.get(`/api/v1/content/items/${'a'.repeat(200)}?view=draft`), 400);
  errShape(await ed.get('/api/v1/content/items/x%00y?view=draft'), 400);
  // injection: inert text
  const sqli = await ed.get(`/api/v1/content/items/${encodeURIComponent("q' or '1'='1")}`);
  assert.equal(sqli.status, 400);
  const name = await pl.get(`/api/v1/me/name-check?name=${encodeURIComponent("Robert'); DROP TABLE users;--")}`);
  assert.equal(name.status, 200); assert.equal(name.body.available, false);
  assert.equal(((await T.app.deps.db.execute(sql`select count(*)::int as n from users`)).rows[0] as any).n >= 2, true, 'users still there');
  // prototype pollution: kept as plain data, never on Object.prototype
  const proto = await ed.post('/api/v1/content/items', undefined, { raw: JSON.stringify(quest()).replace(/^\{/, '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},'), headers: { 'content-type': 'application/json' } });
  assert.ok([200, 400].includes(proto.status), proto.text);
  assert.equal(({} as any).polluted, undefined);
  // a script in a name: refused by the name rules (and the pages only ever show text)
  const xss = await pl.patch('/api/v1/me/name', { displayName: '<script>alert(1)</script>' });
  assert.equal(xss.status, 400);
  // an unknown route: the same format
  errShape(await new Player(T.app).get('/api/v1/nothing-here'), 404, 'NOT_FOUND');
  errShape(await new Player(T.app).post('/api/v2/content', {}), 404);
  // a very long URL and a header flood: refused, the server still up
  const long = await T.app.inject({ method: 'GET', url: `/api/v1/content?lat=0&lon=0&km=1&kinds=${'quest,'.repeat(2000)}` });
  assert.equal(long.statusCode, 400);
  assert.equal((await new Player(T.app).get('/api/v1/health')).status, 200);
});

test('rate limits: per address, stricter on signing in and signing up; per account for writes', async () => {
  const L = await testApp('api_rate', { overrides: { rateLimits: { global: { max: 30, windowSec: 60 }, auth: { max: 3, windowSec: 60 }, signUp: { max: 2, windowSec: 3600 }, write: { max: 4, windowSec: 60 } } } });
  try {
    // signing in: 3 a minute from an address
    const p = new Player(L.app, '10.5.0.1');
    for (let k = 0; k < 3; k++) assert.equal((await p.post('/api/auth/sign-in/email', { email: 'x@example.com', password: 'wrong password!' })).status, 401);
    const limited = await p.post('/api/auth/sign-in/email', { email: 'x@example.com', password: 'wrong password!' });
    errShape(limited, 429, 'RATE_LIMITED');
    assert.ok(Number(limited.headers['retry-after']) > 0);
    // (another address isn't held up)
    assert.equal((await new Player(L.app, '10.5.0.2').post('/api/auth/sign-in/email', { email: 'x@example.com', password: 'wrong password!' })).status, 401);
    // signing up: 2 an hour from an address
    const s = new Player(L.app, '10.5.0.3');
    for (let k = 0; k < 2; k++) await s.post('/api/auth/sign-up/email', { email: `s${k}@example.com`, password: 'correct horse battery', name: `Signer ${k}`, acceptTerms: L.config.termsVersion, birthDate: '1990-01-01' });
    errShape(await s.post('/api/auth/sign-up/email', { email: 's9@example.com', password: 'correct horse battery', name: 'Signer Nine', acceptTerms: L.config.termsVersion, birthDate: '1990-01-01' }), 429, 'RATE_LIMITED');
    // writes: 4 a minute an account (whichever address they come from)
    const w = await signUp(L.app, L.outbox, { email: 'w@example.com', name: 'Writer Wren', ip: '10.5.0.5' });
    for (let k = 0; k < 4; k++) assert.equal((await w.del('/api/v1/replays/rp_nothing_here_123')).status, 404);
    w.ip = '10.5.0.6';
    errShape(await w.del('/api/v1/replays/rp_nothing_here_123'), 429, 'RATE_LIMITED');
    // everything from one address: 30 a minute
    const g = new Player(L.app, '10.5.0.4');
    let last = 0;
    for (let k = 0; k < 31; k++) last = (await g.get('/api/v1/health')).status;
    assert.equal(last, 429);
  } finally { await L.close(); }
});

test('the logs never hold a password, a token, a cookie or a secret in a URL', async () => {
  const p = new Player(T.app, '10.4.0.7');
  await p.post('/api/auth/sign-up/email', { email: 'logs@example.com', password: 'hunter2-hunter2-secret', name: 'Log Watcher', acceptTerms: T.config.termsVersion, birthDate: '1990-01-01' });
  const verify = linkIn(T.outbox.find(m => m.to === 'logs@example.com')!);
  await p.get(path(verify));
  await p.post('/api/auth/request-password-reset', { email: 'logs@example.com', redirectTo: '/reset' });
  const reset = linkIn([...T.outbox].reverse().find(m => m.to === 'logs@example.com' && m.kind === 'reset-password')!);
  await p.get(path(reset));
  await p.post('/api/auth/sign-in/email', { email: 'logs@example.com', password: 'wrong-password-oops' });
  await p.get('/api/v1/me');
  const all = logs.join('\n');
  assert.ok(logs.length > 5, 'request logs written');
  const token = new URL(verify).searchParams.get('token')!, resetToken = path(reset).split('/').pop()!.split('?')[0];
  for (const secret of ['hunter2-hunter2-secret', 'wrong-password-oops', token, resetToken, ...[...p.cookies.values()].map(v => decodeURIComponent(v).split('.')[0])]) {
    if (secret && secret.length > 8) assert.ok(!all.includes(secret), `a secret in the logs: ${secret.slice(0, 6)}… in ${logs.find(l => l.includes(secret))?.slice(0, 400)}`);
  }
  assert.ok(all.includes('[redacted]'), 'secret query values shown as [redacted]');
  // (and the outbox's mail bodies aren't logged either: only that a mail was sent)
  assert.ok(!all.includes('Reset your Kugelsack Racing password'));
});
