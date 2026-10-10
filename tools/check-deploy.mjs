// Checks production as players reach it (docs/DEPLOYMENT.md "Checks"): run by the deploy workflow after each deploy,
// by the check workflow on demand, and by hand. Everything here over the internet, through Cloudflare:
//   every address over HTTPS with a valid certificate; http:// sent to https://; www → the game
//   HSTS (once it's on: --hsts)
//   the game's page and where it says everything is (multiplayer on); the API's health (production, its database)
//   CORS: the game's address may read the API and the tiles, another site may not
//   the tiles: a byte range (206), and the second time from Cloudflare's cache
//   the real-time server (through the tunnel): /health ok, the same commit as the API and the game, the round trip's
//   time; the API's /status says "rt":"up" (it hears from it)
//   the admin and editor pages: not for someone signed out
//
//   node tools/check-deploy.mjs [--www] [--hsts]
//   (the addresses are production's unless given: --game https://ognistrada.com --api https://api.ognistrada.com
//   --tiles https://tiles.ognistrada.com --rt wss://rt.ognistrada.com; --env production, the only one there is)

const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; }, has = n => args.includes(n);
const G = opt('--game', 'https://ognistrada.com'), API = opt('--api', 'https://api.ognistrada.com'), TILES = opt('--tiles', 'https://tiles.ognistrada.com');
const RT = opt('--rt', 'wss://rt.ognistrada.com'), RT_HTTPS = RT.replace(/^wss:/, 'https:'), ENV = opt('--env', 'production');
if (ENV !== 'production') { console.error('--env production (there is no other environment: docs/DEPLOYMENT.md)'); process.exit(2); }
const EVIL = 'https://example.org';
let failed = 0;
const check = (ok, name, detail = '') => { if (!ok) failed++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`); };
const get = (url, init = {}) => fetch(url, { redirect: 'manual', ...init });
const tryIt = async (name, fn) => { try { await fn(); } catch (e) { check(false, name, e.cause?.code ?? e.message); } };
const short = v => String(v ?? '?').slice(0, 7);

// ---------- HTTPS everywhere ----------
for (const [name, base] of [['the game', G], ['the API', `${API}/api/v1/health`], ['the tiles', `${TILES}/assets/map/sf/manifest.json`], ['real time', `${RT_HTTPS}/health`]]) {
  await tryIt(`${name}: HTTPS`, async () => {
    const r = await get(base);                            // (a certificate that isn't valid fails here)
    check(r.status < 400, `${name}: HTTPS with a valid certificate`, `${new URL(base).host} → ${r.status}`);
    const plain = await get(base.replace(/^https:/, 'http:'));
    check([301, 302, 307, 308].includes(plain.status) && (plain.headers.get('location') ?? '').startsWith('https://'), `${name}: http:// goes to https://`, `${plain.status} → ${plain.headers.get('location')}`);
    if (has('--hsts')) check(/max-age=\d{7,}/.test(r.headers.get('strict-transport-security') ?? ''), `${name}: HSTS`, r.headers.get('strict-transport-security') ?? 'none');
  });
}
if (has('--www')) await tryIt('www', async () => {
  const www = G.replace('https://', 'https://www.'), r = await get(`${www}/account/?a=1`);
  check(r.status === 301 && r.headers.get('location') === `${G}/account/?a=1`, 'www goes to the game (path and query kept)', `${r.status} → ${r.headers.get('location')}`);
});

// ---------- the API ----------
let health = null;
await tryIt('the API', async () => {
  health = await (await fetch(`${API}/api/v1/health`)).json();
  check(health.ok && health.env === ENV && health.db === 'ok', 'the API: healthy, production, its database answering', JSON.stringify(health));
  const ok = await fetch(`${API}/api/v1/health`, { headers: { origin: G } });
  check(ok.headers.get('access-control-allow-origin') === G && ok.headers.get('access-control-allow-credentials') === 'true', 'CORS: the game may read the API (with its cookie)');
  // (the browser asks first for a request with the game's own headers: every one of them must be allowed)
  const pre = await fetch(`${API}/api/v1/health`, { method: 'OPTIONS', headers: { origin: G, 'access-control-request-method': 'GET', 'access-control-request-headers': 'x-kr-client,x-kr-device,x-bot-check,content-type' } });
  const allowed = (pre.headers.get('access-control-allow-headers') ?? '').toLowerCase();
  check(pre.status < 400 && ['x-kr-client', 'x-kr-device', 'x-bot-check'].every(h => allowed.includes(h)), 'CORS: the game\'s own headers allowed (the browser\'s preflight)', `${pre.status} ${allowed || 'none'}`);
  const no = await fetch(`${API}/api/v1/health`, { headers: { origin: EVIL } });
  check(!no.headers.get('access-control-allow-origin'), 'CORS: another site may not read the API');
  for (const p of ['/admin/', '/editor/editor.js']) {
    const r = await get(`${API}${p}`);
    check(r.status === 302 && (r.headers.get('location') ?? '').startsWith(`${G}/account/`), `${p} on the API's address: signed out → sent to sign in`, `${r.status} → ${r.headers.get('location')}`);
  }
});

// ---------- the game ----------
await tryIt('the game', async () => {
  const page = await (await fetch(G)).text(), cfg = await (await fetch(`${G}/site/config.js`)).text();
  check(page.includes('/site/config.js'), 'the game\'s page loads its settings first');
  const said = JSON.parse(cfg.match(/Object\.freeze\((\{.*\})\)/)?.[1] ?? '{}');
  const want = { env: ENV, api: API, game: G, tiles: TILES, rt: RT, multiplayer: true };
  check(Object.entries(want).every(([k, v]) => said[k] === v), 'the game knows where everything is (multiplayer on)', cfg.trim().split('\n').pop().slice(0, 200));
  check(!!health?.version && String(health.version).startsWith(said.version ?? '-'), 'the game is the commit the API runs', `game ${said.version} · API ${short(health?.version)}`);
  const asset = await get(`${G}/assets/map/sf/manifest.json`);
  check(asset.status === 302 && (asset.headers.get('location') ?? '').startsWith(TILES), 'the game\'s /assets/ goes to the tiles address', `${asset.status} → ${asset.headers.get('location')}`);
  const admin = await get(`${G}/admin/`);
  check([301, 302].includes(admin.status) && (admin.headers.get('location') ?? '').startsWith(API), 'the game\'s /admin/ goes to the API\'s', `${admin.status}`);
  const editor = await get(`${G}/editor/editor.js`);
  check(editor.status !== 200 || !(await editor.text()).includes('createEditor'), 'the editor\'s code isn\'t on the game\'s address');
});

// ---------- the tiles ----------
await tryIt('the tiles', async () => {
  const url = `${TILES}/assets/map/sf/map.pmtiles`;
  const first = await fetch(url, { headers: { range: 'bytes=0-16383', origin: G } });
  const body = await first.arrayBuffer();
  check(first.status === 206 && body.byteLength === 16384 && /^bytes 0-16383\//.test(first.headers.get('content-range') ?? ''), 'tiles: a byte range (PMTiles)', `${first.status} ${first.headers.get('content-range')}`);
  check(first.headers.get('access-control-allow-origin') === G, 'tiles: CORS for the game', first.headers.get('access-control-allow-origin') ?? 'none');
  let hit = '';
  for (let i = 0; i < 3 && hit !== 'HIT'; i++) { hit = (await fetch(url, { headers: { range: 'bytes=0-16383', origin: G } })).headers.get('cf-cache-status') ?? ''; }
  check(hit === 'HIT', 'tiles: from Cloudflare\'s cache the second time', `cf-cache-status ${hit || 'none'}`);
  const api = await fetch(url, { headers: { range: 'bytes=0-15', origin: API } });
  check(api.headers.get('access-control-allow-origin') === API, 'tiles: CORS for the API\'s address too (the editor), even from the cache', api.headers.get('access-control-allow-origin') ?? 'none');
  const evil = await fetch(url, { headers: { range: 'bytes=0-15', origin: EVIL } });
  check(!evil.headers.get('access-control-allow-origin'), 'tiles: no CORS for another site', evil.headers.get('access-control-allow-origin') ?? 'none');
});

// ---------- real time ----------
await tryIt('real time', async () => {
  // (ten round trips through Cloudflare and the tunnel to the real-time server's /health; the first opens the connection)
  const times = [];
  let rt = null;
  for (let i = 0; i < 11; i++) {
    const t0 = performance.now(), r = await fetch(`${RT_HTTPS}/health`, { headers: { 'cache-control': 'no-cache' } });
    rt = await r.json();
    if (i > 0) times.push(performance.now() - t0);
  }
  check(rt?.ok === true && rt.draining !== true, 'real time: the server\'s /health is ok (and it isn\'t stopping)', JSON.stringify(rt));
  check(!!rt?.version && rt.version === health?.version, 'real time: the same commit as the API', `rt ${short(rt?.version)} · API ${short(health?.version)}`);
  times.sort((a, b) => a - b);
  console.log(`       real time: 10 round trips: median ${times[5].toFixed(0)} ms, best ${times[0].toFixed(0)} ms, worst ${times[9].toFixed(0)} ms (from ${process.env.GITHUB_ACTIONS ? 'GitHub\'s runner, in the US' : 'here'})`);
  const status = await (await fetch(`${API}/api/v1/status`)).json();
  check(status.rt === 'up', 'real time: the API hears from it (/api/v1/status "rt":"up")', `rt ${status.rt ?? 'not said'}`);
});

console.log(failed ? `\n${failed} check(s) failed` : '\nevery check passed');
process.exitCode = failed ? 1 : 0;
