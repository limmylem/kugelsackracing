// @ts-nocheck — (the page's own modules are imported inside the browser: not this program's)
// The deployment's layout, end to end in a real browser (docs/DEPLOYMENT.md), before any of it is online: the game,
// the API, the tiles and the real-time server each on an address of its own, as they will be —
//   http://ognistrada.test        the site build (tools/build-site.mjs --local), served as Cloudflare Pages
//                                 serves it (its _headers and _redirects)
//   http://api.ognistrada.test    the server in 'tools' mode (staging's and production's), its admin and editor
//                                 pages for their roles only;   ws://rt.ognistrada.test → the same server
//   http://tiles.ognistrada.test  assets/, as R2 serves it (byte ranges; CORS for our own addresses only)
//   http://evil.test              somewhere else
// Chromium maps every one of them to this machine. Checked:
//   sign up on the game's address → the emailed link (the API's address) → back on the game, signed in
//   the economy from the game's address: a purchase (the session cookie and the CSRF token across addresses)
//   and another tab's change arriving (server-sent events)
//   the admin page: signed out → sign in on the game's address → back to it; a player → refused; an admin → it
//   the editor's code: refused for a player; for an editor from the API's address, the modules it shares with
//   the game from the game's (loaded once)
//   map files: /assets/ on the game's address → the tiles address; a byte range; CORS refused elsewhere
//   the real-time stand-in: ping → pong from the game; refused from elsewhere
//   the API refuses other sites' pages
//
//   node server/tools/deploy-browser.ts

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { sql } from 'drizzle-orm';
import { freshDatabase, testConfig } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
import { REPO_DIR } from '../src/config.ts';

const P = { game: 8811, api: 8812, tiles: 8813, evil: 8814 };
const U = { game: `http://ognistrada.test:${P.game}`, api: `http://api.ognistrada.test:${P.api}`, tiles: `http://tiles.ognistrada.test:${P.tiles}`, rt: `ws://rt.ognistrada.test:${P.api}`, evil: `http://evil.test:${P.evil}` };
let pw: any;
try { pw = await import('playwright-core'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); }
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push(ok); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`); };
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.pmtiles': 'application/octet-stream', '.gz': 'application/gzip' };

// ---------- the site, built as for staging (http here) ----------
const siteDir = path.join(REPO_DIR, '.cache/site/local');
execFileSync('node', [path.join(REPO_DIR, 'tools/build-site.mjs'), '--env', 'staging', '--local', '--out', siteDir, '--game', U.game, '--api', U.api, '--tiles', U.tiles, '--rt', U.rt], { stdio: 'inherit' });

// as Cloudflare Pages serves it: _redirects (in order, :splat), _headers (the /* block), index.html for a folder
const redirects = fs.readFileSync(path.join(siteDir, '_redirects'), 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => { const [from, to, code] = l.trim().split(/\s+/); return { from, to, code: Number(code ?? 302) }; });
const headerBlock = fs.readFileSync(path.join(siteDir, '_headers'), 'utf8').split('\n/')[0].split('\n').filter(l => /^\s+\S+:/.test(l)).map(l => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; });
const pages = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url!, U.game).pathname);
  for (const r of redirects) {
    const re = new RegExp(`^${r.from.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '(.*)')}$`), m = p.match(re);
    if (m) { res.writeHead(r.code, { location: r.to.replace(':splat', m[1] ?? '') }); res.end(); return; }
  }
  // (this test only: the libraries the import maps take from jsDelivr, which this machine can't reach)
  if (p.startsWith('/node_modules/')) { const f = path.join(REPO_DIR, p); if (f.startsWith(path.join(REPO_DIR, 'node_modules')) && fs.existsSync(f)) { res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'text/javascript', ...Object.fromEntries(headerBlock) }); fs.createReadStream(f).pipe(res); return; } }
  let file = path.join(siteDir, p.endsWith('/') ? `${p}index.html` : p);
  if (!file.startsWith(siteDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', ...Object.fromEntries(headerBlock) });
  fs.createReadStream(file).pipe(res);
});
// (the editor's test page: the main page's import map — with its lines for the editor's code — and the libraries local)
{
  const index = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8'), map = JSON.parse(index.match(/<script type="importmap">([\s\S]*?)<\/script>/)![1]);
  Object.assign(map.imports, { three: '/node_modules/three/build/three.module.js', 'three/addons/': '/node_modules/three/examples/jsm/', '@dimforge/rapier3d-compat': '/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs' });
  fs.writeFileSync(path.join(siteDir, 'editor-test.html'), `<!doctype html><meta charset="utf-8"><script src="/site/config.js"></script><script type="importmap">${JSON.stringify(map)}</script><title>editor test</title>`);
}
// as R2 on its own address serves assets/: byte ranges, CORS for our addresses only
const allowed = [U.game, U.api];
const tiles = http.createServer((req, res) => {
  const origin = req.headers.origin, cors = origin && allowed.includes(origin) ? { 'access-control-allow-origin': origin, 'access-control-expose-headers': 'content-range, content-length, etag, accept-ranges', vary: 'Origin' } : {};
  if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'access-control-allow-headers': 'range', 'access-control-allow-methods': 'GET, HEAD' }); res.end(); return; }
  const p = decodeURIComponent(new URL(req.url!, U.tiles).pathname), file = path.join(REPO_DIR, p);
  if (!p.startsWith('/assets/') || !file.startsWith(path.join(REPO_DIR, 'assets')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, cors); res.end(); return; }
  const size = fs.statSync(file).size, range = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ''));
  const base = { ...cors, 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=3600' };
  if (range) {
    const a = Number(range[1]), b = Math.min(size - 1, range[2] ? Number(range[2]) : size - 1);
    res.writeHead(206, { ...base, 'content-range': `bytes ${a}-${b}/${size}`, 'content-length': b - a + 1 });
    fs.createReadStream(file, { start: a, end: b }).pipe(res);
  } else { res.writeHead(200, { ...base, 'content-length': size }); fs.createReadStream(file).pipe(res); }
});
const evil = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>elsewhere</title>'); });

const database = await freshDatabase('deploy');
const config = testConfig(database.url, { serveClient: 'tools', logLevel: (process.env.LOG as any) ?? 'warn' }, { PUBLIC_URL: U.api, GAME_URL: U.game, TILES_URL: U.tiles, RT_URL: U.rt });
const app = await buildApp({ config });
await app.listen({ port: P.api, host: '127.0.0.1' });
await Promise.all([[pages, P.game], [tiles, P.tiles], [evil, P.evil]].map(([s, port]: any) => new Promise<void>(r => s.listen(port, '127.0.0.1', r))));
const outbox = app.deps.mailer.outbox as any[];
const linkFor = async (to: string, kind: string) => {
  for (let k = 0; k < 50; k++) { const m = [...outbox].reverse().find(x => x.to === to && x.kind === kind); if (m) return m.text.match(/https?:\/\/\S+/)[0] as string; await new Promise(r => setTimeout(r, 100)); }
  throw new Error(`no ${kind} mail for ${to}`);
};
const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-proxy-server', '--host-resolver-rules=MAP *.ognistrada.test 127.0.0.1, MAP ognistrada.test 127.0.0.1, MAP evil.test 127.0.0.1'] });
const errors: string[] = [], failedRequests: string[] = [];
let lastPage: any = null;
const newPage = async () => {
  const ctx = await browser.newContext(), page = await ctx.newPage();
  page.on('pageerror', (e: any) => errors.push(String(e)));
  page.on('console', (m: any) => { if (m.type() === 'error' && !/net::ERR_FAILED|ERR_BLOCKED|status of 40[134]|Cross-Origin-Opener-Policy header has been ignored|from origin 'http:\/\/evil\.test/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('dialog', (d: any) => d.accept());
  page.on('requestfailed', (r: any) => failedRequests.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r: any) => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`); });
  lastPage = page;
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/, (r: any) => r.abort());
  return { ctx, page };
};
const signUp = async (page: any, email: string, name: string) => {
  await page.goto(`${U.game}/account/?mode=sign-up&next=/account/`);
  await page.fill('input[autocomplete=nickname]', name);
  await page.waitForSelector('.hint.good', { timeout: 5000 });
  await page.fill('input[type=email]', email);
  await page.fill('input[autocomplete=new-password]', 'correct horse battery');
  await page.fill('input[type=date]', '1995-05-05');
  await page.check('input[type=checkbox]');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Check your email');
  const link = await linkFor(email, 'verify-email');
  await page.goto(link);
  // (the account page, verified, goes on to where it was going: wait for that)
  await page.waitForURL((u: URL) => u.origin === U.game && !u.search.includes('verified'), { timeout: 10000 });
  await page.waitForLoadState('networkidle');
  return link;
};
const me = (page: any) => page.evaluate(async () => { const { createApi } = await import('/account/api.js'); return (await createApi().get('/me').catch(e => ({ error: e.code }))).user ?? null; });
const idOf = async (email: string) => ((await app.deps.db.execute(sql`select id from users where email = ${email}`)).rows[0] as any).id;

try {
  // ---------- signing up across addresses ----------
  const { ctx, page } = await newPage();
  const link = await signUp(page, 'pia@example.com', 'Pia Pitlane');
  check('the emailed link is on the API\'s address', link.startsWith(U.api), link.slice(0, 60));
  const pia = await me(page);
  check('back on the game\'s address, signed in (the API\'s cookie, sent from the game)', pia?.displayName === 'Pia Pitlane' && new URL(page.url()).origin === U.game, page.url());
  check('the page knows where everything is', await page.evaluate(() => JSON.stringify(globalThis.KR_SITE)) === JSON.stringify({ env: 'staging', api: U.api, game: U.game, tiles: U.tiles, rt: U.rt }));

  // ---------- the economy: writes (CSRF) and server-sent events across addresses ----------
  const start = (p: any) => p.evaluate(async () => {
    const { account } = await import('/account/session.js'), { loadGarageData } = await import('/garage/data.js'), { RemotePlayerService } = await import('/garage/player/remote.js');
    const A = await account(), { db } = await loadGarageData(async (f: string) => (await fetch(`/${f}`)).json());
    const cfg = await A.api.get('/player/config'); db.economy = cfg.economy;
    const P = (window as any).P = new RemotePlayerService({ api: A.api, db, quests: { config: cfg.quests } });
    await P.init(); return P.profile.money;
  });
  const page2 = await ctx.newPage(); await page2.goto(`${U.game}/account/`);
  const m0 = await start(page); await start(page2);
  const bought = await page.evaluate(async () => { const r = await (window as any).P.buyPart('cold_air_intake'); return { ok: r.ok, money: r.updatedState.money, error: r.error }; });
  check('a purchase from the game\'s address (cookie and CSRF token across addresses)', bought.ok && bought.money === m0 - 350, JSON.stringify(bought));
  await page2.waitForFunction((m: number) => (window as any).P.profile.money === m, bought.money, { timeout: 8000 }).then(() => check('the other tab heard it (server-sent events from the API\'s address)', true), () => check('the other tab heard it (server-sent events from the API\'s address)', false));

  // ---------- map files ----------
  const a = await page.evaluate(async () => {
    const { assetUrl } = await import('/site/urls.js');
    const viaRedirect = await fetch('/assets/map/sf/manifest.json').then(r => ({ ok: r.ok, url: r.url })).catch(e => ({ ok: false, url: String(e) }));
    const direct = assetUrl('/assets/map/sf/map.pmtiles');
    const r = await fetch(direct, { headers: { range: 'bytes=0-127' } });
    return { viaRedirect, direct, status: r.status, length: (await r.arrayBuffer()).byteLength, range: r.headers.get('content-range') };
  });
  check('map files: /assets/ on the game\'s address goes to the tiles address', a.viaRedirect.ok && a.viaRedirect.url.startsWith(U.tiles), JSON.stringify(a.viaRedirect));
  check('map files: straight from the tiles address, a byte range (PMTiles)', a.direct.startsWith(U.tiles) && a.status === 206 && a.length === 128 && /^bytes 0-127\//.test(a.range ?? ''), JSON.stringify(a));

  // ---------- the real-time stand-in ----------
  const rtPing = (p: any) => p.evaluate((url: string) => new Promise(resolve => {
    const ws = new WebSocket(`${url}/rt/health`), t0 = performance.now();
    ws.onopen = () => ws.send(JSON.stringify({ type: 'ping', t: 7 }));
    ws.onmessage = e => { const m = JSON.parse(e.data); ws.close(); resolve({ pong: m.type === 'pong' && m.t === 7, ms: Math.round(performance.now() - t0) }); };
    ws.onclose = e => resolve({ pong: false, code: e.code });
    setTimeout(() => resolve({ pong: false, timeout: true }), 5000);
  }), U.rt);
  const pong = await rtPing(page);
  check('real time: ping → pong from the game\'s address (WebSocket)', pong.pong === true, JSON.stringify(pong));

  // ---------- the admin page ----------
  const r403 = await page.goto(`${U.api}/admin/`);
  check('the admin page: a player is refused', r403!.status() === 403);
  await app.deps.db.execute(sql`update users set role = 'admin' where email = 'pia@example.com'`);
  await page.goto(`${U.api}/admin/`);
  await page.waitForSelector('text=Recent admin actions', { timeout: 10000 }).then(() => check('the admin page: an admin gets it (on the API\'s address)', true), () => check('the admin page: an admin gets it (on the API\'s address)', false, page.url()));

  // ---------- the editor's code ----------
  await page.goto(`${U.game}/editor-test.html`);
  const ed = await page.evaluate(async (api: string) => {
    const { importTool } = await import('/site/urls.js');
    const m = await importTool('editor/editor.js').then(m => typeof m.createEditor, e => `refused: ${e.message}`);
    const loaded = performance.getEntriesByType('resource').map((e: any) => e.name);
    return { m, fromApi: loaded.filter(n => n.startsWith(api) && !n.startsWith(`${api}/api/`)).map(n => n.slice(api.length)), shared: loaded.filter(n => /\/garage\/session\.js$/.test(n)) };
  }, U.api);
  check('the editor\'s code: an editor (admin) gets it from the API\'s address', ed.m === 'function', JSON.stringify(ed).slice(0, 200));
  check('…and the modules it shares with the game from the game\'s (once)', ed.fromApi.length > 0 && ed.fromApi.every((n: string) => n.startsWith('/editor/')) && ed.shared.every((n: string) => n.startsWith(U.game)), JSON.stringify(ed.fromApi.filter((n: string) => !n.startsWith('/editor/'))).slice(0, 200));

  // a player, signed out at first
  const { page: p2 } = await newPage();
  await p2.goto(`${U.api}/admin/`);
  check('the admin page, signed out: sent to sign in on the game\'s address, to come back', p2.url().startsWith(`${U.game}/account/`) && decodeURIComponent(p2.url()).includes(`next=${U.api}/admin/`), p2.url());
  await signUp(p2, 'ola@example.com', 'Ola Nordmann');
  await p2.goto(`${U.game}/editor-test.html`);
  const refused = await p2.evaluate(async () => { const { importTool } = await import('/site/urls.js'); return importTool('editor/editor.js').then(() => 'loaded', e => 'refused'); });
  check('the editor\'s code: a player is refused', refused === 'refused', refused);
  const access = await p2.evaluate(async () => { const m = await import('/editor/access.js').catch(e => null); return m ? typeof m.editorAccess : 'missing'; });
  check('editor/access.js (whether the editor\'s button shows) is still on the game\'s address', access === 'function', access);

  // ---------- other sites ----------
  const { page: e } = await newPage();
  await e.goto(`${U.evil}/`);
  const elsewhere = await e.evaluate(async (U: any) => {
    const api = await fetch(`${U.api}/api/v1/health`, { credentials: 'include' }).then(() => 'read', () => 'refused');
    const t = await fetch(`${U.tiles}/assets/map/sf/manifest.json`).then(() => 'read', () => 'refused');
    const ws = await new Promise(resolve => { const s = new WebSocket(`${U.rt}/rt/health`); s.onopen = () => s.send('ping'); s.onmessage = () => resolve('answered'); s.onclose = (ev: any) => resolve(`closed ${ev.code}`); setTimeout(() => resolve('timeout'), 4000); });
    return { api, tiles: t, ws };
  }, U);
  check('another site\'s page: the API, the tiles and the real-time server refuse it', elsewhere.api === 'refused' && elsewhere.tiles === 'refused' && elsewhere.ws === 'closed 1008', JSON.stringify(elsewhere));
  check('no errors on the pages', errors.length === 0, errors.join('\n   '));
  void idOf;
} catch (err: any) {
  check('ran to the end', false, err.stack ?? err.message);
  if (errors.length) console.log('page errors:\n  ' + errors.slice(0, 8).join('\n  '));
  console.log('failed requests:\n  ' + failedRequests.filter(x => !/googleapis|gstatic|jsdelivr/.test(x)).slice(0, 12).join('\n  '));
  if (lastPage) console.log('last page', lastPage.url(), (await lastPage.evaluate(() => document.body?.innerText ?? '').catch(() => '')).slice(0, 400));
} finally {
  await browser.close();
  await app.close();
  for (const s of [pages, tiles, evil]) s.close();
  await database.drop();
}
const failed = results.filter(r => !r).length;
console.log(failed ? `\n${failed} of ${results.length} failed` : `\n${results.length} of ${results.length} ok`);
process.exitCode = failed ? 1 : 0;
