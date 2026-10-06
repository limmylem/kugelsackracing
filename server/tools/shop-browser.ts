// @ts-nocheck — (the page's own modules are imported inside the browser: not this program's)
// The shop, the dealership and selling in a real browser (Phase 6 Step 4's success check): a server of its own
// (a fresh database), the game's own page and garage, signed in —
//   the shop: parts that fit this car (on at first), a locked one with what unlocks it; compare one (the numbers,
//   the dyno before and after, a test drive with it), buy and install it in one go; buy one to the inventory
//   and refund it; a kit bought and fitted
//   the dealership: the showroom's views; today's used lot (the same as the server's), a used car bought
//   selling: a car sold keeping its valuable parts (a confirmation first); several parts sold at once; the
//   buy/sell history; every change the server's (the ledger matches)
//
//   node server/tools/shop-browser.ts [--shots dir]     (needs playwright-core and Chromium: PLAYWRIGHT_CORE, CHROMIUM;
//   and jsDelivr, or CDN_LIBS — see local-check.ts — with --local-libs)

import path from 'node:path';
import { sql } from 'drizzle-orm';
import { freshDatabase, testConfig, signUp } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
import { REPO_DIR } from '../src/config.ts';

const args = process.argv.slice(2), shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const PORT = Number(process.env.PORT ?? 8787), BASE = `http://localhost:${PORT}`;
let pw: any;
try { pw = await import('playwright-core'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); }
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push(ok); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`); };

const database = await freshDatabase('shopbrowser');
// (the test helpers make players from localhost:8787's address: trusted too, on another port)
const config = testConfig(database.url, { serveClient: true, logLevel: 'warn' }, { PUBLIC_URL: BASE, ...(PORT !== 8787 ? { TRUSTED_ORIGINS: 'http://localhost:8787' } : {}) });
const app = await buildApp({ config });
await app.listen({ port: PORT, host: '127.0.0.1' });
await signUp(app, app.deps.mailer.outbox as any[], { email: 'sam@example.com', name: 'Sam Shopper', ip: '10.9.0.3' });
await signUp(app, app.deps.mailer.outbox as any[], { email: 'boss@example.com', name: 'Boss Admin', ip: '10.9.0.4' });
await app.deps.db.execute(sql`update users set role = 'admin' where email = 'boss@example.com'`);
const sam = ((await app.deps.db.execute(sql`select id from users where email = 'sam@example.com'`)).rows[0] as any).id as string;

const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-proxy-server', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors: string[] = [];
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.route(/fonts\.(googleapis|gstatic)\.com|cesium|openfreemap|demotiles/, (r: any) => r.abort());
if (args.includes('--local-libs')) {
  const nm = path.join(REPO_DIR, 'node_modules'), LIBS = process.env.CDN_LIBS ?? REPO_DIR, esbuild = await import('esbuild'), bundles = new Map();
  await ctx.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', (r: any) => r.fulfill({ path: `${nm}/three/${new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', '')}`, contentType: 'text/javascript' }));
  await ctx.route('https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/**', (r: any) => r.fulfill({ path: `${nm}/@dimforge/rapier3d-compat/dist/rapier.mjs`, contentType: 'text/javascript' }));
  await ctx.route('https://cdn.jsdelivr.net/npm/maplibre-gl@*/dist/**', (r: any) => { const f = new URL(r.request().url()).pathname.split('/dist/')[1]; return r.fulfill({ path: `${nm}/maplibre-gl/dist/${f}`, contentType: f.endsWith('.css') ? 'text/css' : 'text/javascript' }); });
  const bundle = async (pkg: string) => bundles.get(pkg) ?? bundles.set(pkg, (await esbuild.build({ stdin: { contents: `export * from '${pkg}'; export { default } from '${pkg}';`, resolveDir: LIBS }, bundle: true, format: 'esm', write: false, logLevel: 'silent' }).catch(() => esbuild.build({ stdin: { contents: `export * from '${pkg}';`, resolveDir: LIBS }, bundle: true, format: 'esm', write: false }))).outputFiles[0].text).get(pkg);
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/(pbf|@mapbox\/vector-tile)@/, async (r: any) => r.fulfill({ body: await bundle(/pbf@/.test(r.request().url()) ? 'pbf' : '@mapbox/vector-tile'), contentType: 'text/javascript' }));
}
const page = await ctx.newPage();
page.on('pageerror', (e: any) => errors.push(String(e)));
page.on('framenavigated', (f: any) => { if (f === page.mainFrame()) console.log('NAV', f.url()); });
page.on('console', (m: any) => { if (/reload|navigat/i.test(m.text())) console.log('CONSOLE', m.text()); });
const shot = async (name: string) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
// (a button that asks "are you sure?" by changing: both clicks at once — the page is slow under software rendering)
const twice = async (sel: string) => { const tap = () => page.evaluate((sel: string) => (document.querySelector(`#garage-root ${sel}`) as HTMLElement)?.click(), sel); await tap(); await tap(); await page.waitForTimeout(250); };
const click = async (sel: string) => { await page.click(`#garage-root ${sel}`); await page.waitForTimeout(250); };
const money = () => page.evaluate(async () => (await import('/garage/garage.js')).debug.workshop.money);
const workshop = (fn: string) => page.evaluate(new Function(`return import('/garage/garage.js').then(m => { const w = m.debug.workshop; return (${fn})(w); })`) as any);
const toast = () => page.evaluate(() => document.querySelector('#garage-root .g-toast')?.textContent ?? '');
const ledger = async () => (await app.deps.db.execute(sql`select kind, amount, reason from ledger where user_id = ${sam} order by id desc`)).rows as any[];

try {
  await page.goto(`${BASE}/account/`);
  await page.evaluate(async () => { const { createApi } = await import('/account/api.js'); await createApi().auth('/sign-in/email', { email: 'sam@example.com', password: 'correct horse battery' }); });
  // (money for a few cars)
  await app.economy.state({ id: sam, name: 'Sam' });
  await app.economy.adminMoney({ id: sam, name: 'Sam' }, sam, 120_000, 'Browser test: money to shop with');
  await page.goto(`${BASE}/`);
  await page.waitForSelector('#worlds button', { timeout: 120000 });
  // (the world ready first: a world switch while one's loading is ignored)
  for (let t = Date.now(); Date.now() - t < 180000;) {
    if (await page.evaluate(async () => { const { debug } = await import('/testtrack/test-scene.js'), w = debug.active; return !!(w && w.sim && !w.spawning); }).catch(() => false)) break;
    await page.waitForTimeout(1000);
  }
  await page.click('#worlds button:has-text("Garage")');
  await page.waitForSelector('#garage-root .g-top', { timeout: 120000 });
  await page.waitForFunction(async () => !!(await import('/garage/garage.js')).debug.workshop, null, { timeout: 60000 });
  check('the garage, signed in: the server\'s player service', await workshop('w => w.service.constructor.name') === 'RemotePlayerService');

  // ---------- the shop ----------
  await click('[data-act="tab:shop"]');
  await page.waitForSelector('#garage-root .g-shop-grid .g-card');
  const fitsOn = await page.$eval('#garage-root [data-act="shop-fits"]', (b: any) => b.getAttribute('aria-pressed'));
  const cards = await page.$$eval('#garage-root .g-shop-grid .g-card', (l: any[]) => l.length);
  check('the shop: "Fits my car" on at first, the parts that fit', fitsOn === 'true' && cards > 20, `${cards} cards`);
  await page.selectOption('#garage-root [data-field="shop.tier"]', 'race');
  await page.waitForTimeout(300);
  const lock = await page.$eval('#garage-root .g-card.locked .lock', (e: any) => e.textContent).catch(() => null);
  const lockedBuy = await page.$eval('#garage-root .g-card.locked [data-act^="buy:"]', (b: any) => b.disabled).catch(() => null);
  check('…a race part is locked, with what unlocks it, and can\'t be bought', /level 5/.test(lock ?? '') && lockedBuy === true, lock ?? '');
  await page.selectOption('#garage-root [data-field="shop.tier"]', 'all');
  await page.selectOption('#garage-root [data-field="shop.brand"]', { index: 1 }).catch(() => {});
  await page.waitForTimeout(200);
  const branded = await page.$$eval('#garage-root .g-shop-grid .g-card .label', (l: any[]) => l.map(e => e.textContent));
  check('…by maker', branded.length > 0 && branded.every((t: string) => t.includes('·')), `${branded.length} by one maker`);
  await page.selectOption('#garage-root [data-field="shop.brand"]', 'all');
  await shot('shop');
  // compare: the cold air intake on this car
  await click('[data-act="try:cold_air_intake"]');
  await page.waitForSelector('#garage-root [data-act="install"]');
  const compare = await page.evaluate(() => ({ dyno: !!document.querySelector('#garage-root .g-minidyno svg path'), rows: document.querySelectorAll('#garage-root .g-table .item').length, drive: !document.querySelector('#garage-root [data-act="try-drive"]')?.disabled, only: !!document.querySelector('#garage-root [data-key="buy-only"]') }));
  check('compare: the numbers, the dyno before and after, a test drive with it, buy only', compare.dyno && compare.rows >= 5 && compare.drive && compare.only, JSON.stringify(compare));
  await shot('compare');
  const m0 = await money();
  await click('[data-act="install"]');
  await page.waitForFunction(async () => { const w = (await import('/garage/garage.js')).debug.workshop; return w.sockets().some((s: any) => s.part?.id === 'cold_air_intake') && !w.service.pending; }, null, { timeout: 20000 });
  const m1 = await money();
  check('…buy and install in one step', m0 - m1 === 350, `${m0} → ${m1}`);
  // buy to the inventory, then refund it
  await click('[data-act="tab:shop"]');
  await page.fill('#garage-root [data-field="shop.q"]', 'strut brace');
  await page.waitForTimeout(300);
  await click('[data-act="buy:strut_brace"]');
  await page.waitForFunction(async () => !(await import('/garage/garage.js')).debug.workshop.service.pending, null, { timeout: 20000 });
  const brace = await workshop(`w => Object.values(w.profile.parts).find(x => x.partId === 'strut_brace' && !x.installedOn)?.instanceId`);
  await click('[data-act="tab:inventory"]');
  await page.fill('#garage-root [data-field="inv.q"]', 'strut brace');
  await page.waitForTimeout(300);
  await twice(`[data-act="refund:${brace}"]`);
  await page.waitForFunction(async () => !(await import('/garage/garage.js')).debug.workshop.service.pending, null, { timeout: 20000 });
  check('buy to the inventory, then refund it (unused, in the window)', await money() === m1 && !(await workshop(`w => !!w.profile.parts['${brace}']`)), `${await money()} · ${await toast()}`);
  // a kit, bought and fitted
  await click('[data-act="tab:shop"]');
  await click('[data-act="shop-section:kits"]');
  await shot('kits');
  const m2 = await money();
  await click('[data-act="kit-fit:kit_street_brakes"]');
  await page.waitForFunction(async () => { const w = (await import('/garage/garage.js')).debug.workshop; return w.sockets().some((s: any) => s.part?.id === 'brakes_street') && !w.service.pending; }, null, { timeout: 20000 });
  check('a kit: bought for less, every part fitted', m2 - await money() === 552, `${m2 - await money()}`);

  // ---------- the dealership ----------
  await click('[data-act="tab:dealer"]');
  await page.waitForSelector('#garage-root [data-act="dealer-view:interior"]');
  await click('[data-act="dealer-view:interior"]');
  check('the showroom: the interior (the driver\'s door opens)', await page.evaluate(async () => (await import('/garage/garage.js')).debug.scene.view === 'interior'));
  await shot('showroom-interior');
  await click('[data-act="dealer-lot:used"]');
  await page.waitForSelector('#garage-root [data-act^="used-car:"]', { timeout: 30000 });
  const shown = await page.$$eval('#garage-root [data-act^="used-car:"]', (l: any[]) => l.map(e => e.dataset.act.slice(9)));
  const served = (await app.inject({ method: 'GET', url: '/api/v1/player/used-lot', headers: { cookie: (await ctx.cookies()).map((c: any) => `${c.name}=${c.value}`).join('; ') } })).json();
  check('today\'s used lot: the server\'s', shown.length > 0 && JSON.stringify(shown) === JSON.stringify(served.listings.map((l: any) => l.id)), `${shown.length} cars`);
  const pick = served.listings.filter((l: any) => !['S', 'X', 'A'].includes(l.class)).sort((a: any, b: any) => a.price - b.price)[0];
  await click(`[data-act="used-car:${pick.id}"]`);
  await page.waitForSelector('#garage-root .g-used-history');
  await shot('used');
  const m3 = await money();
  await twice(`[data-act="used-buy:${pick.id}"]`);
  await page.waitForFunction(async () => Object.keys((await import('/garage/garage.js')).debug.workshop.profile.cars).length === 2, null, { timeout: 20000 });
  await page.waitForFunction(async () => !(await import('/garage/garage.js')).debug.workshop.service.pending, null, { timeout: 20000 });
  check('a used car bought, as it was on the lot', m3 - await money() === pick.price, `${pick.name} ${pick.price} · ${m3 - await money()} · ${await toast()}`);

  // ---------- selling ----------
  const usedCar = await workshop(`w => Object.values(w.profile.cars).find(c => c.used)?.carInstanceId`);
  await click('[data-act="tab:parts"]');
  await click('[data-act="pop:garage"]');
  await click(`[data-act="sell-car:${usedCar}"]`);
  await page.waitForSelector('#garage-root [data-act="sell-car-confirm"]');
  await click('[data-act="sell-keep-valuable"]');
  const kept = await page.$$eval('#garage-root .g-keep input:checked', (l: any[]) => l.length);
  await shot('sell-car');
  const m4 = await money();
  await click('[data-act="sell-car-confirm"]');
  await page.waitForFunction(async () => Object.keys((await import('/garage/garage.js')).debug.workshop.profile.cars).length === 1, null, { timeout: 20000 });
  const got = await money() - m4;
  check('a car sold (a confirmation first), its valuable parts kept, for less than it cost', got > 0 && got < pick.price, `+${got} (paid ${pick.price}), ${kept} kept`);
  // several spare parts at once
  await click('[data-act="tab:inventory"]');
  await page.fill('#garage-root [data-field="inv.q"]', '');
  await click('[data-act="inv-pick-mode"]');
  await click('[data-act="inv-pick-all"]');
  const n = await page.$$eval('#garage-root .g-pick input:checked', (l: any[]) => l.length);
  await click('[data-act="inv-sell-picked"]');
  await page.waitForSelector('#garage-root [data-act="inv-sell-confirm"]');
  await click('[data-act="inv-sell-confirm"]');
  await page.waitForFunction(async () => { const w = (await import('/garage/garage.js')).debug.workshop; return !w.service.pending && Object.values(w.profile.parts).every((x: any) => x.installedOn); }, null, { timeout: 20000 });
  check('several spare parts sold at once', n > 0, `${n} parts`);
  await click('[data-act="inv-view:history"]');
  const history = await page.$$eval('#garage-root .g-history .h', (l: any[]) => l.length);
  await shot('history');
  check('the buy/sell history', history >= 6, `${history} entries`);
  const L = await ledger(), kinds = L.map((r: any) => r.kind);
  check('every change the server\'s: purchases, a refund, sales in the ledger', ['purchase', 'refund', 'sale'].every(k => kinds.includes(k)) && Number((await app.deps.db.execute(sql`select balance from player_economy where user_id = ${sam}`)).rows[0].balance) === await money(), kinds.slice(0, 10).join(', '));
  // ---------- the admin page: the catalogue, a sale scheduled (the game's prices follow), tomorrow's lot, the dashboard ----------
  const ap = await ctx.browser().newContext({ viewport: { width: 1500, height: 950 } }).then((c: any) => c.newPage());
  ap.on('pageerror', (e: any) => errors.push(String(e)));
  ap.on('dialog', (d: any) => d.type() === 'prompt' ? d.accept('Browser test: a brake sale') : d.accept());
  await ap.goto(`${BASE}/admin/`);
  await ap.evaluate(async () => { const { createApi } = await import('/account/api.js'); await createApi().auth('/sign-in/email', { email: 'boss@example.com', password: 'correct horse battery' }); });
  await ap.goto(`${BASE}/admin/`);
  await ap.click('#tabs button:has-text("Shop")');
  await ap.waitForSelector('text=Schedule a sale');
  const rows = await ap.$$eval('tbody tr[data-text]', (l: any[]) => l.length);
  const lotRows = await ap.waitForSelector('text=(tomorrow)', { timeout: 20000 }).then(() => true).catch(() => false);
  check('admin: the catalogue, and tomorrow\'s used lot previewed', rows > 400 && lotRows, `${rows} parts`);
  const form = ap.locator('.action:has-text("Schedule a sale")');
  const start = new Date(Date.now() - 60_000).toISOString().slice(0, 16), end = new Date(Date.now() + 3_600_000).toISOString().slice(0, 16);
  await form.locator('input[placeholder="sale_id"]').fill('brake_sale');
  await form.locator('input[placeholder^="Name"]').fill('Brake week');
  const dates = form.locator('input[type="datetime-local"]'); await dates.nth(0).fill(start); await dates.nth(1).fill(end);
  await form.locator('input[type="number"]').fill('20');
  await form.locator('select').selectOption('categories');
  await form.locator('input[placeholder^="ids"]').fill('brakes');
  await form.locator('button:has-text("Schedule sale")').click();
  await ap.waitForSelector('text=ON NOW', { timeout: 20000 });
  const cfg = (await app.inject({ method: 'GET', url: '/api/v1/player/config' })).json();
  const { offer } = await import('../../garage/shop.js'), { loadGarageData } = await import('../../garage/data.js'), fs = await import('node:fs');
  const { db: gd } = await loadGarageData(async (f: string) => JSON.parse(fs.readFileSync(path.join(REPO_DIR, f), 'utf8')));
  const o = offer({ ...gd, economy: cfg.economy }, 'part', 'brakes_sport');
  check('…a sale scheduled from the admin page: the game\'s prices follow', o.sale?.name === 'Brake week' && o.price === Math.round(o.list * 0.8), `${o.list} → ${o.price}`);
  await ap.click('#tabs button:has-text("Shop dashboard")');
  await ap.waitForSelector('text=Top sellers');
  const top = await ap.$$eval('section table tbody tr', (l: any[]) => l.length);
  if (shots) await ap.screenshot({ path: path.join(shots, 'admin-dashboard.png'), fullPage: true });
  check('admin: the shop dashboard (top sellers, spend by category, items nobody buys)', top > 3, `${top} rows`);
  check('no errors on the page', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (err: any) {
  check('ran to the end', false, err.stack ?? err.message);
  if (errors.length) console.log('page errors:\n  ' + errors.slice(0, 6).join('\n  '));
  await shot('failed');
} finally {
  await browser.close();
  await app.close();
  await database.drop?.();
}
const failed = results.filter(r => !r).length;
console.log(failed ? `\n${failed} of ${results.length} failed` : `\n${results.length} of ${results.length} ok`);
process.exit(failed ? 1 : 0);
