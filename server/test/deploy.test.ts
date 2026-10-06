// The server as it's deployed (docs/DEPLOYMENT.md): the player's address behind Cloudflare (believed only with the
// edge's secret), the API's own address in 'tools' mode (the game's pages sent to the game's address, the map files
// to the tiles address, its modules served), where everything is (site/config.js), and the health check's database
// fingerprint. (The whole layout in a browser: server/tools/deploy-browser.ts.)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { testApp, Player, signUp } from './helpers.ts';

const SECRET = 'edge-secret-edge-secret-0123456789';
let T: Awaited<ReturnType<typeof testApp>>;
before(async () => {
  T = await testApp('deploy', {
    overrides: { serveClient: 'tools' },
    env: { GAME_URL: 'http://game.example.test', TILES_URL: 'http://tiles.example.test', RT_URL: 'ws://rt.example.test', EDGE_SECRET: SECRET },
  });
});
after(async () => { await T?.close(); });

const signIn = async (headers: Record<string, string>) => {
  const p = new Player(T.app, '10.9.9.9');
  const r = await p.post('/api/auth/sign-in/email', { email: 'ip@example.com', password: 'correct horse battery' }, { headers });
  assert.equal(r.status, 200, r.text);
  return ((await T.app.deps.db.execute(sql`select ip_address from sessions order by created_at desc limit 1`)).rows[0] as any).ip_address;
};

test('the player\'s address: Cloudflare\'s CF-Connecting-IP with the edge\'s secret; otherwise what the host\'s proxy saw', async () => {
  await signUp(T.app, T.outbox, { email: 'ip@example.com', name: 'Ivy Ipsum', ip: '10.9.0.1' });
  assert.equal(await signIn({ 'x-kr-edge': SECRET, 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1, 172.70.1.1' }), '203.0.113.7');
  // (the wrong secret, or none: the address written in the request doesn't count — the last hop, the proxy's, does)
  assert.equal(await signIn({ 'x-kr-edge': 'not-the-secret-not-the-secret-0000', 'cf-connecting-ip': '203.0.113.8', 'x-forwarded-for': '198.51.100.2, 192.0.2.44' }), '192.0.2.44');
  assert.equal(await signIn({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.3, 192.0.2.45' }), '192.0.2.45');
});

test('the API\'s own address: the game\'s pages to the game\'s address, map files to the tiles address, modules served', async () => {
  const get = (url: string) => T.app.inject({ method: 'GET', url });
  for (const [url, to] of [['/', 'http://game.example.test/'], ['/index.html', 'http://game.example.test/index.html'], ['/account/', 'http://game.example.test/account/'], ['/account/?next=%2F', 'http://game.example.test/account/?next=%2F'], ['/assets/map/sf/manifest.json', 'http://tiles.example.test/assets/map/sf/manifest.json']]) {
    const r = await get(url);
    assert.equal(r.statusCode, 302, url); assert.equal(r.headers.location, to, url);
  }
  // (the admin page's modules, and the ones it shares with the game: served — they're the game's own, public)
  for (const url of ['/account/api.js', '/site/urls.js', '/garage/data.js']) assert.equal((await get(url)).statusCode, 200, url);
  // the admin page, signed out: to sign in on the game's address, and back
  const admin = await get('/admin/');
  assert.equal(admin.statusCode, 302);
  assert.equal(admin.headers.location, `http://game.example.test/account/?${new URLSearchParams({ next: 'http://localhost:8787/admin/' })}`);
  assert.equal((await get('/editor/editor.js')).statusCode, 302);
  // where everything is
  const cfg = await get('/site/config.js');
  // (and the pages may reach them: on this computer they're http:// and ws://, which 'https:' doesn't cover)
  const csp = String((await get('/site/urls.js')).headers['content-security-policy']);
  assert.match(csp, /connect-src [^;]*http:\/\/tiles\.example\.test[^;]*ws:\/\/rt\.example\.test/);
  assert.match(csp, /worker-src [^;]*https:\/\/cdn\.jsdelivr\.net/);
  assert.match(cfg.body, /"api":""/); assert.match(cfg.body, /"game":"http:\/\/game\.example\.test"/); assert.match(cfg.body, /"tiles":"http:\/\/tiles\.example\.test"/); assert.match(cfg.body, /"rt":"ws:\/\/rt\.example\.test"/);
});

test('CORS: the game\'s address may read the API (and the request id); others may not', async () => {
  const ok = await T.app.inject({ method: 'GET', url: '/api/v1/health', headers: { origin: 'http://game.example.test' } });
  assert.equal(ok.headers['access-control-allow-origin'], 'http://game.example.test');
  assert.equal(ok.headers['access-control-allow-credentials'], 'true');
  assert.match(String(ok.headers['access-control-expose-headers']), /x-request-id/);
  const no = await T.app.inject({ method: 'GET', url: '/api/v1/health', headers: { origin: 'http://evil.example' } });
  assert.equal(no.headers['access-control-allow-origin'], undefined);
});

test('health: which database, as a fingerprint (staging\'s and production\'s must differ)', async () => {
  const h = JSON.parse((await T.app.inject({ method: 'GET', url: '/api/v1/health' })).body);
  assert.match(h.dbId, /^[0-9a-f]{10}$/);
  assert.ok(!JSON.stringify(h).includes('postgres'), 'nothing of the connection string itself');
});

test('the game\'s own files don\'t count against the per-address limit (the API does)', async () => {
  const lim = { max: 20, windowSec: 60 }, big = { max: 100000, windowSec: 60 };
  const L = await testApp('deploy_limit', { overrides: { serveClient: true, rateLimits: { global: lim, auth: big, signUp: big, write: big } } });
  try {
    const files: { statusCode: number }[] = [];
    for (let i = 0; i < 40; i++) files.push(await L.app.inject({ method: 'GET', url: '/garage/data.js', headers: { 'x-forwarded-for': '10.77.0.1' } }));
    assert.ok(files.every(r => r.statusCode === 200), `${files.filter(r => r.statusCode !== 200).length} of 40 refused`);
    const api: { statusCode: number }[] = [];
    for (let i = 0; i < 25; i++) api.push(await L.app.inject({ method: 'GET', url: '/api/v1/health', headers: { 'x-forwarded-for': '10.77.0.2' } }));
    assert.ok(api.some(r => r.statusCode === 429), 'the API is limited');
  } finally { await L.close(); }
});
