// Checks an environment as players will reach it (docs/DEPLOYMENT.md "Checks"): run by the deploy workflow after each
// deploy, and by hand. Everything here over the internet, through Cloudflare:
//   every address over HTTPS with a valid certificate; http:// sent to https://; www → the game
//   HSTS (once it's on: --hsts)
//   the game's page and where it says everything is; the API's health (this environment, its database)
//   CORS: the game's address may read the API and the tiles, another site may not
//   the tiles: a byte range (206), and the second time from Cloudflare's cache
//   real time: WebSocket ping → pong through Cloudflare, the round trip's time
//   the admin and editor pages: not for someone signed out
//   staging and production apart: different databases (--other <its API address>)
//
//   node tools/check-deploy.mjs --game https://ognistrada.com --api https://api.ognistrada.com \
//     --tiles https://tiles.ognistrada.com --rt wss://rt.ognistrada.com --env production [--www] [--hsts] [--other https://staging-api.ognistrada.com]

const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; }, has = n => args.includes(n);
const G = opt('--game'), API = opt('--api'), TILES = opt('--tiles'), RT = opt('--rt'), ENV = opt('--env'), OTHER = opt('--other', null);
if (!G || !API || !TILES || !RT || !ENV) { console.error('--game --api --tiles --rt --env'); process.exit(2); }
const EVIL = 'https://example.org';
let failed = 0;
const check = (ok, name, detail = '') => { if (!ok) failed++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`); };
const get = (url, init = {}) => fetch(url, { redirect: 'manual', ...init });
const tryIt = async (name, fn) => { try { await fn(); } catch (e) { check(false, name, e.cause?.code ?? e.message); } };
// (a free server asleep: its first answer can take most of a minute)
const wake = async url => { for (let i = 0; i < 12; i++) { try { const r = await fetch(url); if (r.status < 500) return r; } catch { /* waking */ } await new Promise(r => setTimeout(r, 10_000)); } return fetch(url); };

// ---------- HTTPS everywhere ----------
await wake(`${API}/api/v1/health`);
for (const [name, base] of [['the game', G], ['the API', `${API}/api/v1/health`], ['the tiles', `${TILES}/assets/map/sf/manifest.json`], ['real time', `${RT.replace(/^wss:/, 'https:')}/api/v1/health`]]) {
  await tryIt(`${name}: HTTPS`, async () => {
    const r = await get(base);                            // (a certificate that isn't valid fails here)
    check(r.status < 400 || (r.status >= 300 && r.status < 400), `${name}: HTTPS with a valid certificate`, `${new URL(base).host} → ${r.status}`);
    const plain = await get(base.replace(/^https:/, 'http:'));
    check([301, 302, 307, 308].includes(plain.status) && (plain.headers.get('location') ?? '').startsWith('https://'), `${name}: http:// goes to https://`, `${plain.status} → ${plain.headers.get('location')}`);
    if (has('--hsts')) check(/max-age=\d{7,}/.test(r.headers.get('strict-transport-security') ?? ''), `${name}: HSTS`, r.headers.get('strict-transport-security') ?? 'none');
  });
}
if (has('--www')) await tryIt('www', async () => {
  const www = G.replace('https://', 'https://www.'), r = await get(`${www}/account/?a=1`);
  check(r.status === 301 && r.headers.get('location') === `${G}/account/?a=1`, 'www goes to the game (path and query kept)', `${r.status} → ${r.headers.get('location')}`);
});

// ---------- the game and the API ----------
await tryIt('the game', async () => {
  const page = await (await fetch(G)).text(), cfg = await (await fetch(`${G}/site/config.js`)).text();
  check(page.includes('/site/config.js'), 'the game\'s page loads its settings first');
  const want = { env: ENV, api: API, game: G, tiles: TILES, rt: RT };
  const said = JSON.parse(cfg.match(/Object\.freeze\((\{.*\})\)/)?.[1] ?? '{}');
  check(JSON.stringify(said) === JSON.stringify(want), 'the game knows where everything is', cfg.trim().slice(0, 160));
  const asset = await get(`${G}/assets/map/sf/manifest.json`);
  check(asset.status === 302 && (asset.headers.get('location') ?? '').startsWith(TILES), 'the game\'s /assets/ goes to the tiles address', `${asset.status} → ${asset.headers.get('location')}`);
  const admin = await get(`${G}/admin/`);
  check([301, 302].includes(admin.status) && (admin.headers.get('location') ?? '').startsWith(API), 'the game\'s /admin/ goes to the API\'s', `${admin.status}`);
  const editor = await get(`${G}/editor/editor.js`);
  check(editor.status !== 200 || !(await editor.text()).includes('createEditor'), 'the editor\'s code isn\'t on the game\'s address');
});
let health = null;
await tryIt('the API', async () => {
  health = await (await fetch(`${API}/api/v1/health`)).json();
  check(health.ok && health.env === ENV && health.db === 'ok', 'the API: healthy, this environment, its database answering', JSON.stringify(health));
  const ok = await fetch(`${API}/api/v1/health`, { headers: { origin: G } });
  check(ok.headers.get('access-control-allow-origin') === G && ok.headers.get('access-control-allow-credentials') === 'true', 'CORS: the game may read the API (with its cookie)');
  const no = await fetch(`${API}/api/v1/health`, { headers: { origin: EVIL } });
  check(!no.headers.get('access-control-allow-origin'), 'CORS: another site may not read the API');
  for (const p of ['/admin/', '/editor/editor.js']) {
    const r = await get(`${API}${p}`);
    check(r.status === 302 && (r.headers.get('location') ?? '').startsWith(`${G}/account/`), `${p} on the API's address: signed out → sent to sign in`, `${r.status} → ${r.headers.get('location')}`);
  }
});
if (OTHER) await tryIt('apart', async () => {
  const other = await (await wake(`${OTHER}/api/v1/health`)).json();
  check(other.env !== ENV && other.dbId && health?.dbId && other.dbId !== health.dbId, 'staging and production: different databases', `${ENV} ${health?.dbId} · ${other.env} ${other.dbId}`);
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
  const times = [], url = `${RT}/rt/health`;
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    let n = 0, t0 = 0;
    const ping = () => { t0 = performance.now(); ws.send(JSON.stringify({ type: 'ping', t: n })); };
    ws.onopen = ping;
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.type === 'pong' && m.t === n) { times.push(performance.now() - t0); if (++n < 10) ping(); else { ws.close(); resolve(); } } };
    ws.onerror = () => reject(new Error('WebSocket error'));
    ws.onclose = e => { if (n < 10) reject(new Error(`closed ${e.code} ${e.reason}`)); };
    setTimeout(() => reject(new Error('no answer in 20 s')), 20_000);
  });
  times.sort((a, b) => a - b);
  check(times.length === 10, 'real time: WebSocket ping → pong through Cloudflare', `10 round trips: median ${times[5].toFixed(0)} ms, best ${times[0].toFixed(0)} ms, worst ${times[9].toFixed(0)} ms (from ${process.env.GITHUB_ACTIONS ? 'GitHub\'s runner' : 'here'})`);
});

console.log(failed ? `\n${failed} check(s) failed` : '\nevery check passed');
process.exitCode = failed ? 1 : 0;
