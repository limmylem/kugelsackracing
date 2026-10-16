// @ts-nocheck — (the page's own modules are imported inside the browser: not this program's)
// Opening the game in the region you were last in (the game page, index.html; testtrack/test-scene.js, play/roam.js):
//   A. the same browser: drive in Monaco, reload — the game opens in Monaco (remembered in this browser:
//      kr.lastRealWorld.v1), and San Francisco isn't built on the way
//   B. another computer, signed in: nothing remembered in this browser, but the account's free-roam place is in Monaco —
//      the first free roam goes back there (a note says so) and puts the car where it was left; a region chosen after
//      that is kept (not taken back to Monaco)
//   C. nothing saved, nothing remembered: San Francisco, as before
//   D. signed in, chosen in this browser since (the owner's report: to Adelaide, reloaded, landed in San Francisco): the
//      account's place is in San Francisco, saved 10 minutes ago; this browser went to Adelaide just now — reloaded with
//      ?mp it stays in Adelaide (no going back), and free roam saves Adelaide
//   E. signed in, left off in the region it opens in (San Francisco, 1.5 km from its spawn): the world is built at the
//      saved place straight away — the car is never at the spawn on the way — and free roam doesn't move it again
//
//   node server/tools/regions-browser.ts [--local-libs]   (needs PostgreSQL: TEST_DATABASE_URL; playwright-core and
//   Chromium: PLAYWRIGHT_CORE, CHROMIUM; jsDelivr, or CDN_LIBS with --local-libs — see mp-browser.ts)

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { sql } from 'drizzle-orm';
import { freshDatabase, testConfig, signUp } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
import { REPO_DIR } from '../src/config.ts';
import { startRt } from '../src/rt/server.ts';

const args = process.argv.slice(2);
const PORT = 8787, BASE = `http://localhost:${PORT}`, RT_PORT = 2744;
const SECRET = 'regions-browser-secret-regions-browser-0123456789';
let pw: any;
try { pw = await import('playwright-core'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); }
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push(!!ok); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`); };

// (one real-time process, no Redis)
const rt = await startRt({ port: RT_PORT, redisUrl: null, secret: SECRET, rt: { allowGuests: true, maxPlayers: 100, roomMaxClients: 16, netsim: true }, api: { url: BASE } });
const database = await freshDatabase('regions');
const config = testConfig(database.url, { serveClient: true, logLevel: 'warn' }, { PUBLIC_URL: BASE, RT_URL: `ws://localhost:${RT_PORT}`, RT_SECRET: SECRET });
const app: any = await buildApp({ config });
await app.listen({ port: PORT, host: '127.0.0.1' });
const far = await signUp(app, app.deps.mailer.outbox as any[], { email: 'far@example.com', name: 'Far Away', ip: '10.9.5.1' });
await signUp(app, app.deps.mailer.outbox as any[], { email: 'new@example.com', name: 'New Comer', ip: '10.9.5.2' });
const owner = await signUp(app, app.deps.mailer.outbox as any[], { email: 'owner@example.com', name: 'The Owner', ip: '10.9.5.3' });

// where the far player left off in free roam: in Monaco, on a road about 150 m from the region's spawn (Casino Square),
// as the zone servers save it (server/src/roam/service.ts save)
const SAVED = { region: 'monaco', pos: [417.54, 53.31, -272.31], heading: 90 };
const farId = (await far.get('/api/v1/me')).body.user.id as string;
await app.deps.db.execute(sql`insert into roam_players (user_id, region, pos, heading, saved_at) values (${farId}, ${SAVED.region}, ${JSON.stringify(SAVED.pos)}::jsonb, ${SAVED.heading}, now())`);
// (the owner's: San Francisco, on a road near the Embarcadero, 10 minutes ago)
const ownerId = (await owner.get('/api/v1/me')).body.user.id as string;
await app.deps.db.execute(sql`insert into roam_players (user_id, region, pos, heading, saved_at) values (${ownerId}, 'sf', ${JSON.stringify([3597.88, 2.87, -2563.44])}::jsonb, 315, now() - interval '10 minutes')`);
// (E: someone who left off in San Francisco about 1.5 km from its spawn, on a road from its road graph)
const sfer = await signUp(app, app.deps.mailer.outbox as any[], { email: 'sfer@example.com', name: 'Sf Er', ip: '10.9.5.4' });
const SF_SAVED = (() => {
  const G = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(REPO_DIR, 'assets/map/sf/graph.json.gz'))).toString('utf8'));
  const M = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'assets/map/sf/manifest.json'), 'utf8')), [sx, sz] = M.spawn.xz;
  for (const g of G.segs) {
    if (g.structure !== 'ground' || !['primary', 'secondary', 'tertiary'].includes(g.class) || g.points.length < 12) continue;
    const k = (g.points.length / 3 >> 1) * 3, [x, z, h] = g.points.slice(k, k + 3);
    const d = Math.hypot(x - sx, z - sz);
    if (d < 1400 || d > 1800) continue;
    const [nx, nz] = g.points.slice(k + 3, k + 5), heading = Math.atan2(nx - x, nz - z) * 180 / Math.PI;
    return { region: 'sf', pos: [x, h, z], heading, spawn: [sx, sz], road: g.name };
  }
  throw new Error('no road 1.4–1.8 km from the spawn');
})();
const sferId = (await sfer.get('/api/v1/me')).body.user.id as string;
await app.deps.db.execute(sql`insert into roam_players (user_id, region, pos, heading, saved_at) values (${sferId}, 'sf', ${JSON.stringify(SF_SAVED.pos)}::jsonb, ${SF_SAVED.heading}, now() - interval '2 minutes')`);
const savedOf = async (uid: string) => (await app.deps.db.execute(sql`select region, pos, saved_at from roam_players where user_id = ${uid}`)).rows[0] as any;

const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-proxy-server', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const errors: string[] = [];
// a browser of its own (another computer): its own storage and sign-in; every free-roam note kept as it's shown
async function computer(name: string) {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 320 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cesium|openfreemap|demotiles/, (r: any) => r.abort());
  if (args.includes('--local-libs')) {
    const nm = path.join(REPO_DIR, 'node_modules'), LIBS = process.env.CDN_LIBS ?? REPO_DIR, esbuild = await import('esbuild'), bundles = new Map();
    await ctx.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', (r: any) => r.fulfill({ path: `${nm}/three/${new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', '')}`, contentType: 'text/javascript' }));
    await ctx.route('https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/**', (r: any) => r.fulfill({ path: `${nm}/@dimforge/rapier3d-compat/dist/rapier.mjs`, contentType: 'text/javascript' }));
    await ctx.route('https://cdn.jsdelivr.net/npm/maplibre-gl@*/dist/**', (r: any) => { const f = new URL(r.request().url()).pathname.split('/dist/')[1]; return r.fulfill({ path: `${nm}/maplibre-gl/dist/${f}`, contentType: f.endsWith('.css') ? 'text/css' : 'text/javascript' }); });
    const bundle = async (pkg: string) => bundles.get(pkg) ?? bundles.set(pkg, (await esbuild.build({ stdin: { contents: `export * from '${pkg}'; export { default } from '${pkg}';`, resolveDir: LIBS }, bundle: true, format: 'esm', write: false, logLevel: 'silent' }).catch(() => esbuild.build({ stdin: { contents: `export * from '${pkg}';`, resolveDir: LIBS }, bundle: true, format: 'esm', write: false }))).outputFiles[0].text).get(pkg);
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/(pbf|@mapbox\/vector-tile)@/, async (r: any) => r.fulfill({ body: await bundle(/pbf@/.test(r.request().url()) ? 'pbf' : '@mapbox/vector-tile'), contentType: 'text/javascript' }));
  }
  await ctx.addInitScript(() => { const g = globalThis as any; g.__toasts = []; new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if ((n as any).parentElement?.id === 'roamToasts' && n.textContent) g.__toasts.push(n.textContent); }).observe(document, { childList: true, subtree: true }); });
  const P = await ctx.newPage();
  P.on('pageerror', (e: any) => errors.push(`${name}: ${e}`));
  if (process.env.MP_DEBUG) P.on('console', (m: any) => console.log(`[${name}] ${m.type()}: ${m.text().slice(0, 240)}`));
  if (process.env.MP_DEBUG) P.on('requestfailed', (r: any) => console.log(`[${name}] failed: ${r.url().slice(0, 200)} ${r.failure()?.errorText ?? ''}`));
  return { ctx, P };
}
const signIn = (P, email) => P.goto(`${BASE}/account/`).then(() => P.evaluate(async (e) => { const { createApi } = await import('/account/api.js'); await createApi().auth('/sign-in/email', { email: e, password: 'correct horse battery' }); }, email));
const open = async (P, url) => {
  // (every baked region: these cases are about choosing between them — data/map/baked.json's inGame keeps the game to
  // Adelaide otherwise)
  await P.goto(`${url}${url.includes('?') ? '&' : '?'}regions=all`);
  // (the first-launch question, if it's asked: later)
  await until(async () => { const b = P.locator('[data-k="later"]'); if (await b.isVisible().catch(() => false)) await b.click().catch(() => {}); return P.evaluate(async () => !!(await import('/testtrack/test-scene.js')).debug.active).catch(() => false); }, 240000, 1000);
};

// what a window has: the world being driven (its region), the car's place in the region's map frame, free roam's room,
// the notes free roam showed, what this browser remembers
const look = (P) => P.evaluate(async () => {
  const { debug } = await import('/testtrack/test-scene.js'), w = debug.active, g = globalThis as any;
  let stored = null; try { stored = JSON.parse(localStorage.getItem('kr.lastRealWorld.v1') ?? 'null'); } catch { /* none */ }
  if (!w?.sim) return { ready: false, stored, toasts: g.__toasts ?? [] };
  const p = w.sim.vehicle.body.translation(), xz = w.stream ? w.stream.toWorld(p.x, p.z) : [p.x, p.z];
  return { ready: !w.spawning && !!w.stream, file: w.file, manifest: w.track?.mapV3?.manifest ?? null, region: w.track?.mapV3?.manifest?.match(/assets\/map\/([^/]+)\//)?.[1] ?? null,
    xz, roam: g.__krMpWorld ?? null, roamOn: !!g.__krRoam, stored, toasts: g.__toasts ?? [] };
});
const until = async (fn, ms, every = 1000) => { for (const t = Date.now(); Date.now() - t < ms; await new Promise(r => setTimeout(r, every))) { const v = await fn().catch(() => null); if (v) return v; } return null; };
const enter = (P, file) => void P.evaluate(async (f) => { const m = await import('/testtrack/test-scene.js'); await m.enter(f); }, file).catch((e: any) => console.log(`  entering ${file} failed: ${e?.message}`));
const f = (x, d = 1) => Number.isFinite(x) ? x.toFixed(d) : '–';

try {
  // ---------- A. the same browser ----------
  console.log('\n== A. the same browser: drive in Monaco, reload');
  {
    const { ctx, P } = await computer('A');
    await open(P, `${BASE}/?view=600`);
    const sf = await until(async () => { const l = await look(P); return l.ready ? l : null; }, 300000) ?? await look(P);
    check('the first time: San Francisco (nothing remembered; opening isn\'t a choice: at 0)', sf.region === 'sf' && sf.stored?.file === 'scenes/map_v3.json' && sf.stored?.at === 0, `${sf.region} · remembered ${JSON.stringify(sf.stored)}`);
    const t0 = Date.now();
    enter(P, 'scenes/map_v3.json?region=monaco');
    const mc = await until(async () => { const l = await look(P); return l.ready && l.region === 'monaco' ? l : null; }, 300000) ?? await look(P);
    check('to Monaco: this browser remembers it, and when', mc.region === 'monaco' && mc.stored?.file === 'scenes/map_v3.json?region=monaco' && mc.stored?.at >= t0 && mc.stored?.at <= Date.now(), `${mc.region} · remembered ${JSON.stringify(mc.stored)}`);
    const asked: string[] = [];
    P.on('request', (r: any) => asked.push(new URL(r.url()).pathname));
    await P.reload();
    await until(async () => { const b = P.locator('[data-k="later"]'); if (await b.isVisible().catch(() => false)) await b.click().catch(() => {}); return P.evaluate(async () => !!(await import('/testtrack/test-scene.js')).debug.active).catch(() => false); }, 240000, 1000);
    const again = await until(async () => { const l = await look(P); return l.ready ? l : null; }, 300000) ?? await look(P);
    const sfAsked = asked.filter(u => u.includes('/assets/map/sf/')), monacoAsked = asked.filter(u => u.includes('/assets/map/monaco/'));
    check('reloaded: the game opens in Monaco', again.region === 'monaco' && /assets\/map\/monaco\//.test(again.manifest ?? ''), `${again.region} (${again.manifest})`);
    check('…and San Francisco isn\'t built on the way (nothing of it asked for)', sfAsked.length === 0 && monacoAsked.length > 0, `${sfAsked.length} San Francisco files asked for${sfAsked.length ? ` (${sfAsked.slice(0, 3).join(', ')})` : ''}, ${monacoAsked.length} Monaco files`);
    await ctx.close();
  }

  // ---------- B. another computer, signed in ----------
  console.log('\n== B. another computer, signed in: left off in Monaco (free roam), nothing in this browser');
  {
    const me = (await far.get('/api/v1/roam/me')).body;
    check('the API has the place saved (Monaco, on a road)', me.garage === false && me.region === 'monaco', JSON.stringify({ garage: me.garage, region: me.region, pos: me.pos, why: me.why }));
    const { ctx, P } = await computer('B');
    await signIn(P, 'far@example.com');
    await open(P, `${BASE}/?mp&view=600`);
    const first = await look(P);
    check('nothing remembered in this browser: it starts in San Francisco', first.stored == null || (first.stored.file === 'scenes/map_v3.json' && first.stored.at === 0), `remembered ${JSON.stringify(first.stored)}, ${first.region ?? 'building'}`);
    const there = await until(async () => { const l = await look(P); return l.ready && l.region === 'monaco' && l.roam === 'roam:monaco' && Math.hypot(l.xz[0] - SAVED.pos[0], l.xz[1] - SAVED.pos[2]) < 5 ? l : null; }, 600000) ?? await look(P);
    const d = there.xz ? Math.hypot(there.xz[0] - SAVED.pos[0], there.xz[1] - SAVED.pos[2]) : NaN;
    check('free roam goes back to Monaco by itself', there.region === 'monaco' && there.roam === 'roam:monaco', `${there.region}, free roam ${there.roam}`);
    check('…the car where it was left (within 5 m)', d < 5, `${f(d)} m from the saved spot (at ${there.xz?.map(v => f(v)).join(', ')})`);
    check('…and a note said it was going back (nothing about another region)', there.toasts.some(t => /Going back to monaco/.test(t)) && !there.toasts.some(t => /You left off in/.test(t)), JSON.stringify(there.toasts));
    // (a region chosen after that: kept)
    const said = there.toasts.filter(t => /Going back/.test(t)).length;
    enter(P, 'scenes/map_v3.json');
    const sfNow = await until(async () => { const l = await look(P); return l.ready && l.region === 'sf' && l.roam === 'roam:sf' ? l : null; }, 300000);
    await P.waitForTimeout(30000);
    const later = await look(P);
    check('then to San Francisco: kept, not taken back to Monaco', !!sfNow && later.region === 'sf' && later.roam === 'roam:sf' && later.toasts.filter(t => /Going back/.test(t)).length === said,
      `${later.region}, free roam ${later.roam} · notes since: ${JSON.stringify(later.toasts.slice(there.toasts.length))}`);
    check('…and this browser remembers San Francisco now', later.stored?.file === 'scenes/map_v3.json' && later.stored?.at > 0, JSON.stringify(later.stored));
    await ctx.close();
  }

  // ---------- C. nothing saved, nothing remembered ----------
  console.log('\n== C. nothing saved, nothing remembered');
  {
    const { ctx, P } = await computer('C');
    await signIn(P, 'new@example.com');
    await open(P, `${BASE}/?mp&view=600`);
    const sf = await until(async () => { const l = await look(P); return l.ready && l.roam === 'roam:sf' ? l : null; }, 300000) ?? await look(P);
    await P.waitForTimeout(20000);
    const later = await look(P);
    check('San Francisco, free roam there, and it stays', sf.region === 'sf' && later.region === 'sf' && later.roam === 'roam:sf' && !later.toasts.some(t => /Going back/.test(t)),
      `${later.region}, free roam ${later.roam} · notes ${JSON.stringify(later.toasts)}`);
    await ctx.close();
  }

  // ---------- D. chosen in this browser since ----------
  console.log('\n== D. signed in: the place saved in San Francisco 10 minutes ago; this browser went to Adelaide just now; reloaded with ?mp');
  {
    const { ctx, P } = await computer('D');
    await signIn(P, 'owner@example.com');
    // (without ?mp: no free roam, so nothing saved meanwhile — only this browser's choice)
    await open(P, `${BASE}/?view=600`);
    await until(async () => { const l = await look(P); return l.ready ? l : null; }, 300000);
    const t0 = Date.now();
    enter(P, 'scenes/map_v3.json?region=adelaide');
    const ad = await until(async () => { const l = await look(P); return l.ready && l.region === 'adelaide' ? l : null; }, 300000) ?? await look(P);
    check('to Adelaide: this browser remembers it, and when (just now)', ad.region === 'adelaide' && ad.stored?.file === 'scenes/map_v3.json?region=adelaide' && ad.stored?.at >= t0, `${ad.region} · remembered ${JSON.stringify(ad.stored)}`);
    const asked: string[] = [];
    P.on('request', (r: any) => asked.push(new URL(r.url()).pathname));
    await open(P, `${BASE}/?mp&view=600`);
    const on = await until(async () => { const l = await look(P); return l.ready && l.roam ? l : null; }, 300000) ?? await look(P);
    await P.waitForTimeout(30000);
    const later = await look(P), sfAsked = asked.filter(u => u.includes('/assets/map/sf/'));
    check('reloaded with ?mp: it stays in Adelaide, free roam there', on.region === 'adelaide' && later.region === 'adelaide' && later.roam === 'roam:adelaide', `${on.region} then ${later.region}, free roam ${later.roam}`);
    check('…no going back to San Francisco (no note of it, nothing of it asked for)', !later.toasts.some(t => /Going back/.test(t)) && sfAsked.length === 0, `notes ${JSON.stringify(later.toasts)} · ${sfAsked.length} San Francisco files asked for`);
    const saved = await until(async () => { const r = await savedOf(ownerId); return r?.region === 'adelaide' ? r : null; }, 90000, 2000) ?? await savedOf(ownerId);
    check('…and free roam saves Adelaide', saved?.region === 'adelaide', JSON.stringify(saved));
    await ctx.close();
  }

  // ---------- E. left off in the region it opens in: loaded there straight away ----------
  console.log(`\n== E. signed in: left off in San Francisco on ${SF_SAVED.road ?? 'a road'}, ${f(Math.hypot(SF_SAVED.pos[0] - SF_SAVED.spawn[0], SF_SAVED.pos[2] - SF_SAVED.spawn[1]), 0)} m from its spawn; opened with ?mp`);
  {
    const { ctx, P } = await computer('E');
    await signIn(P, 'sfer@example.com');
    // (every place the car is seen at, from the world's first moment: never at the spawn)
    await ctx.addInitScript(() => { const g = globalThis as any; g.__seen = []; setInterval(async () => { try { const { debug } = await import('/testtrack/test-scene.js'), w = debug.active; if (!w?.stream) return; const p = w.sim.vehicle.body.translation(); g.__seen.push(w.stream.toWorld(p.x, p.z)); } catch { /* not yet */ } }, 100); });
    await open(P, `${BASE}/?mp&view=600`);
    const at = await until(async () => { const l = await look(P); return l.ready && l.roam === 'roam:sf' ? l : null; }, 300000) ?? await look(P);
    await P.waitForTimeout(8000);
    const later = await look(P), seen = await P.evaluate(() => (globalThis as any).__seen as number[][]);
    const d = (xz: number[]) => Math.hypot(xz[0] - SF_SAVED.pos[0], xz[1] - SF_SAVED.pos[2]), nearSpawn = seen.filter(xz => Math.hypot(xz[0] - SF_SAVED.spawn[0], xz[1] - SF_SAVED.spawn[1]) < 400).length;
    check('the world opens at the saved place: the car lands there first (within 5 m)', at.region === 'sf' && d(at.xz) < 5, `${f(d(at.xz))} m from it`);
    check('…never at the region\'s spawn on the way (no second trip)', seen.length > 0 && nearSpawn === 0 && seen.every(xz => d(xz) < 60), `${seen.length} places seen, ${nearSpawn} near the spawn, farthest ${f(Math.max(...seen.map(d)))} m from the saved spot`);
    check('…and stays there with free roam on, saying so', d(later.xz) < 60 && later.toasts.some(t => /Back where you left off/.test(t)), `${f(d(later.xz))} m · notes ${JSON.stringify(later.toasts)}`);
    await ctx.close();
  }

  check('no errors on the pages', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e: any) {
  check('ran to the end', false, e.stack ?? e.message);
} finally {
  await browser.close(); await app.close(); await database.drop(); await rt.stop();
}
const failed = results.filter(r => !r).length;
console.log(failed ? `\n${failed} of ${results.length} failed` : `\n${results.length} of ${results.length} ok`);
process.exit(failed ? 1 : 0);
