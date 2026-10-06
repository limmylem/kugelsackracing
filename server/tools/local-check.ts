// @ts-nocheck — (the page's own modules are imported inside the browser: not this program's)
// The game on this computer, checked end to end (docs/SERVER.md "Running it on your computer"): run while
// `docker compose up` is running. In Chromium, against the real stack —
//   the server healthy; the map files on their own address (byte ranges, CORS for the game only)
//   sign up on the account page → the confirmation email in Mailpit → its link → signed in
//   forgot the password → the reset email in Mailpit → a new password → signed in with it
//   the game itself: the page loads, the world streams in (its tiles from the tiles address, in byte ranges),
//   the car drives, the garage's shop sells a part (the server's economy)
//
//   node server/tools/local-check.ts [--game http://localhost:8787] [--tiles http://localhost:8788] [--mail http://localhost:8025]
// (The game's pages load three.js, Rapier and MapLibre from jsDelivr; with --local-libs they come from this
// repository's node_modules instead — for a machine that can't reach jsDelivr.)

import path from 'node:path';
import crypto from 'node:crypto';
import { REPO_DIR } from '../src/config.ts';

const args = process.argv.slice(2), opt = (n: string, d: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const GAME = opt('--game', 'http://localhost:8787'), TILES = opt('--tiles', 'http://localhost:8788'), MAIL = opt('--mail', 'http://localhost:8025');
let pw: any;
try { pw = await import('playwright-core'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); }
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push(ok); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`); };

// ---------- Mailpit: the newest email to an address, of a kind ----------
const mailTo = async (to: string, subject: RegExp) => {
  for (let k = 0; k < 60; k++) {
    const list = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
    const m = (list.messages ?? []).find((x: any) => subject.test(x.Subject));
    if (m) { const full = await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json(); return { subject: m.Subject, link: full.Text.match(/https?:\/\/\S+/)?.[0] as string }; }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`no "${subject}" email for ${to} in Mailpit`);
};

// ---------- the server and the tiles ----------
const health = await (await fetch(`${GAME}/api/v1/health`)).json().catch(() => null);
check('the server: healthy, its database answering', health?.ok === true && health?.db === 'ok', JSON.stringify(health));
const range = await fetch(`${TILES}/assets/map/sf/map.pmtiles`, { headers: { range: 'bytes=0-511', origin: GAME } });
check('the map files: a byte range from the tiles address, CORS for the game', range.status === 206 && (await range.arrayBuffer()).byteLength === 512 && range.headers.get('access-control-allow-origin') === GAME, `${range.status} ${range.headers.get('content-range')}`);
const other = await fetch(`${TILES}/assets/map/sf/manifest.json`, { headers: { origin: 'http://example.org' } });
check('the map files: no CORS for another site', !other.headers.get('access-control-allow-origin'));

const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-proxy-server', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors: string[] = [];
const newPage = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await ctx.newPage();
  page.on('pageerror', (e: any) => errors.push(String(e)));
  page.on('dialog', (d: any) => d.accept());
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cesium/, (r: any) => r.abort());
  if (args.includes('--local-libs')) {
    const nm = path.join(REPO_DIR, 'node_modules');
    await ctx.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', (r: any) => r.fulfill({ path: `${nm}/three/${new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', '')}`, contentType: 'text/javascript' }));
    await ctx.route('https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/**', (r: any) => r.fulfill({ path: `${nm}/@dimforge/rapier3d-compat/dist/rapier.mjs`, contentType: 'text/javascript' }));
    await ctx.route('https://cdn.jsdelivr.net/npm/maplibre-gl@*/dist/**', (r: any) => { const f = new URL(r.request().url()).pathname.split('/dist/')[1]; return r.fulfill({ path: `${nm}/maplibre-gl/dist/${f}`, contentType: f.endsWith('.css') ? 'text/css' : 'text/javascript' }); });
    // (jsDelivr's +esm bundles these with what they import: the same here, with esbuild, from the versions the
    // import map names — LIBS: a folder with pbf@4 and @mapbox/vector-tile@2 installed)
    const LIBS = process.env.CDN_LIBS ?? REPO_DIR;
    const bundles = new Map<string, string>();
    const bundle = async (pkg: string) => bundles.get(pkg) ?? bundles.set(pkg, (await (await import('esbuild')).build({ stdin: { contents: `export * from '${pkg}'; export { default } from '${pkg}';`, resolveDir: LIBS }, bundle: true, format: 'esm', write: false, logLevel: 'silent' }).catch(async () => (await import('esbuild')).build({ stdin: { contents: `export * from '${pkg}';`, resolveDir: LIBS }, bundle: true, format: 'esm', write: false }))).outputFiles[0].text).get(pkg)!;
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/(pbf|@mapbox\/vector-tile)@/, async (r: any) => r.fulfill({ body: await bundle(/pbf@/.test(r.request().url()) ? 'pbf' : '@mapbox/vector-tile'), contentType: 'text/javascript' }));
  }
  return { ctx, page };
};

try {
  // ---------- signing up, confirming by email, resetting the password ----------
  const email = `local-${crypto.randomBytes(3).toString('hex')}@example.com`, name = `Local ${crypto.randomBytes(2).toString('hex')}`;
  const { page } = await newPage();
  await page.goto(`${GAME}/account/?mode=sign-up&next=/account/`);
  await page.fill('input[autocomplete=nickname]', name);
  await page.waitForSelector('.hint.good', { timeout: 8000 });
  await page.fill('input[type=email]', email);
  await page.fill('input[autocomplete=new-password]', 'correct horse battery');
  await page.fill('input[type=date]', '1995-05-05');
  await page.check('input[type=checkbox]');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Check your email');
  const verify = await mailTo(email, /confirm/i);
  check('sign up: the confirmation email arrives in Mailpit', !!verify.link, verify.subject);
  await page.goto(verify.link);
  await page.waitForURL((u: URL) => u.pathname.startsWith('/account') && !u.search.includes('verified'), { timeout: 15000 });
  await page.waitForSelector(`h2:text("${name}")`, { timeout: 15000 });
  check('its link confirms the account and signs in', true);
  await page.click('section:has(h2:text("Signing out")) button:text("Sign out")');
  await page.waitForSelector('h2:text("Sign in")');
  await page.click('text=Forgot your password?');
  await page.fill('input[type=email]', email); await page.click('button[type=submit]');
  await page.waitForFunction(() => /on its way/.test(document.querySelector('#msg')?.textContent ?? ''));
  const reset = await mailTo(email, /reset|password/i);
  check('forgot the password: the reset email arrives in Mailpit', !!reset.link, reset.subject);
  await page.goto(reset.link);
  await page.waitForSelector('h2:text("Choose a new password")', { timeout: 15000 });
  const pws = await page.$$('input[type=password]');
  await pws[0].fill('a brand new password'); await pws[1].fill('a brand new password');
  await page.click('button[type=submit]');
  await page.waitForSelector('h2:text("Sign in")');
  await page.fill('input[type=email]', email); await page.fill('input[type=password]', 'a brand new password');
  await Promise.all([page.waitForURL((u: URL) => !u.pathname.startsWith('/account'), { timeout: 15000 }).catch(() => {}), page.click('button[type=submit]')]);
  const me = await page.evaluate(async () => (await (await fetch('/api/v1/me')).json()).user?.displayName);
  check('…a new password, and signed in with it', me === name, me);

  // ---------- the game ----------
  const tiles: number[] = [];
  page.on('response', (r: any) => { if (r.url().startsWith(TILES)) tiles.push(r.status()); });
  const t0 = Date.now();
  await page.goto(`${GAME}/`);
  // (polled from here: waitForFunction would take the async check's promise itself as its answer)
  let world: any = null;
  while (!world && Date.now() - t0 < 180000) {
    world = await page.evaluate(async () => {
      const { debug } = await import('/testtrack/test-scene.js'), w = debug.active;
      return w && w.sim && !w.spawning ? { file: w.file, streamed: !!(w.track?.mapV3 || w.track?.streamed) } : null;
    }).catch(() => null);
    if (!world) await page.waitForTimeout(1000);
  }
  world ??= {};
  check('the game: the page loads and the world is ready', !!world.file, `${world.file} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  await page.waitForTimeout(8000);
  check('…its map streams in from the tiles address (byte ranges)', !world.streamed || (tiles.length > 0 && tiles.some(s => s === 206)), `${tiles.length} requests, ${tiles.filter(s => s === 206).length} byte ranges, ${tiles.filter(s => s >= 400).length} failed`);
  // drive: full throttle for two seconds, the car moves
  const moved = await page.evaluate(async () => {
    const { debug } = await import('/testtrack/test-scene.js'), b = debug.active.sim.vehicle.body, p0 = b.translation();
    for (let i = 0; i < 240; i++) debug.active.sim.step({ throttle: 1, brake: 0, steer: 0, handbrake: false, device: 'wheel' });
    const p1 = b.translation(); return Math.hypot(p1.x - p0.x, p1.z - p0.z);
  });
  check('…the car drives', moved > 3, `${moved.toFixed(1)} m in 2 s`);
  // the shop: a part bought through the server's economy
  const bought = await page.evaluate(async () => {
    const { garageSession } = await import('/garage/session.js'), S = await garageSession();
    const m0 = S.player.profile.money, r = await S.player.buyPart('cold_air_intake');
    return { kind: S.player.constructor.name, ok: r.ok, spent: m0 - r.updatedState.money };
  });
  check('…the garage\'s shop sells a part, through the server', bought.kind === 'RemotePlayerService' && bought.ok && bought.spent > 0, JSON.stringify(bought));
  check('no errors on the pages', errors.length === 0, errors.slice(0, 4).join(' | '));
} catch (err: any) {
  check('ran to the end', false, err.stack ?? err.message);
  if (errors.length) console.log('page errors:\n  ' + errors.slice(0, 6).join('\n  '));
} finally {
  await browser.close();
}
const failed = results.filter(r => !r).length;
console.log(failed ? `\n${failed} of ${results.length} failed` : `\n${results.length} of ${results.length} ok`);
process.exitCode = failed ? 1 : 0;
