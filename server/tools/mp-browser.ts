// @ts-nocheck — (the page's own modules are imported inside the browser: not this program's)
// Multiplayer in real browsers (Phase 7 Step 1's success check; docs/MULTIPLAYER.md): the API and a real-time
// server of their own, two players signed in, each in their own browser with the game open on ?mp — the same room.
// Both drive; each checks the other's car:
//   seen and moving, smoothly (no visible snap: net/measure.js on what was drawn, frame by frame); its wheels
//   turning; its brake lights on while its player brakes; its engine and tyres heard (a sound made for it); its
//   dents after its player knocks into something (garage.bump: a crash the usual way)
// and a third player — headless, the same network code as the game — watches both browsers' cars at a steady 60 fps
// and measures how smoothly they move (software rendering draws these pages at a few frames a second: too few to judge
// smoothness from the pages themselves, which is checked there too when they manage 20 fps);
// then a dropped connection: back by itself in the same room, the other player sees it pause and carry on;
// then all of it again on a bad network (150 ms, 30 ms jitter, 5% loss on both players' links).
//
//   node server/tools/mp-browser.ts [--local-libs] [--seconds 20]   (REDIS_URL; needs playwright-core and Chromium:
//   PLAYWRIGHT_CORE, CHROMIUM; and jsDelivr, or CDN_LIBS with --local-libs — see shop-browser.ts)

import path from 'node:path';
import { Redis } from 'ioredis';
import { freshDatabase, testConfig, signUp } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
import { REPO_DIR } from '../src/config.ts';
import { startRt } from '../src/rt/server.ts';
import { createSmoothness } from '../../net/measure.js';
import { createNetClient } from '../../net/client.js';
import { signTicket } from '../src/rt/tickets.ts';
import { transport } from './rt-bots.ts';
import { NET } from '../../net/settings.js';

const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const SECS = Number(arg('seconds', '20'));
const PORT = 8787, BASE = `http://localhost:${PORT}`, RT_PORT = 2741, REDIS = `${(process.env.REDIS_URL ?? 'redis://localhost:6379').replace(/\/\d+$/, '')}/12`;
const SECRET = 'mp-browser-secret-mp-browser-secret-0123456789';
let pw: any;
try { pw = await import('playwright-core'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); }
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push(ok); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`); };

{ const r = new Redis(REDIS); await r.flushdb(); r.disconnect(); }
const rt = await startRt({ port: RT_PORT, redisUrl: REDIS, secret: SECRET, rt: { allowGuests: true, maxPlayers: 100, roomMaxClients: 16, netsim: true } });
const database = await freshDatabase('mpbrowser');
const config = testConfig(database.url, { serveClient: true, logLevel: 'warn' }, { PUBLIC_URL: BASE, RT_URL: `ws://localhost:${RT_PORT}`, RT_SECRET: SECRET });
const app = await buildApp({ config });
await app.listen({ port: PORT, host: '127.0.0.1' });
for (const [email, name, ip] of [['ana@example.com', 'Ana Apex', '10.9.2.1'], ['ben@example.com', 'Ben Braking', '10.9.2.2']]) await signUp(app, app.deps.mailer.outbox as any[], { email, name, ip });

const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-proxy-server', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const errors: string[] = [];
async function playerPage(email: string) {
  const ctx = await browser.newContext({ viewport: { width: Number(arg('width', '240')), height: Number(arg('height', '160')) } });   // (small: software rendering draws faster)
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cesium|openfreemap|demotiles/, (r: any) => r.abort());
  if (args.includes('--local-libs')) {
    const nm = path.join(REPO_DIR, 'node_modules'), LIBS = process.env.CDN_LIBS ?? REPO_DIR, esbuild = await import('esbuild'), bundles = new Map();
    await ctx.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', (r: any) => r.fulfill({ path: `${nm}/three/${new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', '')}`, contentType: 'text/javascript' }));
    await ctx.route('https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/**', (r: any) => r.fulfill({ path: `${nm}/@dimforge/rapier3d-compat/dist/rapier.mjs`, contentType: 'text/javascript' }));
    await ctx.route('https://cdn.jsdelivr.net/npm/maplibre-gl@*/dist/**', (r: any) => { const f = new URL(r.request().url()).pathname.split('/dist/')[1]; return r.fulfill({ path: `${nm}/maplibre-gl/dist/${f}`, contentType: f.endsWith('.css') ? 'text/css' : 'text/javascript' }); });
    const bundle = async (pkg: string) => bundles.get(pkg) ?? bundles.set(pkg, (await esbuild.build({ stdin: { contents: `export * from '${pkg}'; export { default } from '${pkg}';`, resolveDir: LIBS }, bundle: true, format: 'esm', write: false, logLevel: 'silent' }).catch(() => esbuild.build({ stdin: { contents: `export * from '${pkg}';`, resolveDir: LIBS }, bundle: true, format: 'esm', write: false }))).outputFiles[0].text).get(pkg);
    await ctx.route(/cdn\.jsdelivr\.net\/npm\/(pbf|@mapbox\/vector-tile)@/, async (r: any) => r.fulfill({ body: await bundle(/pbf@/.test(r.request().url()) ? 'pbf' : '@mapbox/vector-tile'), contentType: 'text/javascript' }));
  }
  await ctx.addInitScript(() => { (globalThis as any).__krMpTrace = {}; });
  const page = await ctx.newPage();
  page.on('pageerror', (e: any) => errors.push(`${email}: ${e}`));
  if (process.env.MP_DEBUG) page.on('console', (m: any) => { if (m.type() !== 'debug') console.log(`[${email.slice(0, 3)}] ${m.type()}: ${m.text().slice(0, 300)}`); });
  await page.goto(`${BASE}/account/`);
  await page.evaluate(async (email: string) => { const { createApi } = await import('/account/api.js'); await createApi().auth('/sign-in/email', { email, password: 'correct horse battery' }); }, email);
  return { ctx, page, email };
}
// the game open on the multiplayer room, its world ready and joined
// (the proving ground: a light world, so two pages draw it at a decent rate under software rendering)
const WORLD = 'Proving ground';
async function ready(P) {
  for (let t = Date.now(); Date.now() - t < 120000;) {
    if (await P.page.evaluate(async () => { const { debug } = await import('/testtrack/test-scene.js'), w = debug.active; return !!(w && w.sim && !w.spawning); }).catch(() => false)) return;
    await P.page.waitForTimeout(500);
  }
}
async function open(P, query: string) {
  await P.page.goto(`${BASE}/?mp=browser-test${query}`);
  await P.page.waitForSelector('#worlds button', { timeout: 180000 });
  await ready(P);
  await P.page.click(`#worlds button:has-text("${WORLD}")`);
  await P.page.waitForFunction(w => (globalThis as any).__krMp?.status === 'online' && /proving/.test((globalThis as any).__krMp?.net?.conn?.roomId ? document.title + location.href + w : ''), WORLD, { timeout: 5000 }).catch(() => {});
  await ready(P);
  await P.page.waitForFunction(() => { const m = (globalThis as any).__krMp; return m?.status === 'online' && m.net.players.size >= 0; }, null, { timeout: 120000 });
  await P.page.evaluate(() => { (globalThis as any).__krMpTrace = {}; });
}
// (real key presses: the game's input listens to the page's keyboard)
const drive = async (P, keys: string[], ms: number) => {
  for (const k of keys) await P.page.keyboard.down(k);
  await P.page.waitForTimeout(ms);
  for (const k of keys) await P.page.keyboard.up(k);
};
// what one page drew of the other's car: smoothness (net/measure.js), how far it went, wheels, lights, sound, dents
async function seen(P) {
  const tr = await P.page.evaluate(() => (globalThis as any).__krMpTrace);
  const ids = Object.keys(tr), list = ids.length ? tr[ids[0]] : [];
  const M = createSmoothness({ snapCm: NET.interp.snapCm });
  let moved = 0;
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    M.frame({ ...f, pos: f.pos, vel: f.vel, rot: f.rot, ang: f.ang }, f.dt);
    if (i) moved += Math.hypot(f.pos[0] - list[i - 1].pos[0], f.pos[2] - list[i - 1].pos[2]);
  }
  const spins = new Set(list.map(f => f.spin?.toFixed(2)));
  return { frames: list.length, moved, ...M.result(), wheels: spins.size, brake: list.some(f => f.flags & 1), sound: list.some(f => f.sound), dents: Math.max(0, ...list.map(f => f.dents)), fps: list.length / Math.max(0.001, list.reduce((a, f) => a + f.dt, 0)) };
}

try {
  const A = await playerPage('ana@example.com'), B = await playerPage('ben@example.com');
  if (process.env.MP_KEYS) {
    await open(A, '');
    const sp = () => A.page.evaluate(async () => { const { debug } = await import('/testtrack/test-scene.js'); return debug.active.sim.vehicle.forwardSpeed().toFixed(2); });
    console.log('before', await sp());
    await A.page.keyboard.down('ArrowUp'); await A.page.waitForTimeout(4000); console.log('ArrowUp', await sp()); await A.page.keyboard.up('ArrowUp');
    await A.page.mouse.click(500, 400); await A.page.keyboard.down('KeyW'); await A.page.waitForTimeout(4000); console.log('W after click', await sp()); await A.page.keyboard.up('KeyW');
    await A.page.screenshot({ path: '/tmp/claude-0/-home-user-kugelsackracing/202b5f01-8d02-523e-9843-aa64f9622167/scratchpad/keys.png' });
    throw new Error('keys done');
  }
  if (process.env.MP_PEEK) {
    await A.page.goto(`${BASE}/?mp=browser-test`);
    await A.page.waitForTimeout(45000);
    await A.page.screenshot({ path: '/tmp/claude-0/-home-user-kugelsackracing/202b5f01-8d02-523e-9843-aa64f9622167/scratchpad/peek.png' });
    console.log('STATE', await A.page.evaluate(async () => { const { debug } = await import('/testtrack/test-scene.js'); return JSON.stringify({ site: (globalThis as any).KR_SITE, mp: (globalThis as any).__krMp?.status ?? null, msg: (globalThis as any).__krMp?.message, active: debug.active?.file ?? null, url: location.href }); }));
    throw new Error('peek done');
  }
  for (const [phase, query] of [['a clean network', ''], ['150 ms, 30 ms jitter, 5% loss on both players\' links', `&netsim=${NET.targets.smooth.latencyMs},${NET.targets.smooth.jitterMs},${NET.targets.smooth.loss}`]]) {
    console.log(`\n== ${phase}`);
    await Promise.all([open(A, query), open(B, query)]);
    // (both in the proving ground's room, and seeing each other)
    await Promise.all([A, B].map(P => P.page.waitForFunction(() => (globalThis as any).__krMp?.net.players.size === 1, null, { timeout: 60000 }).catch(() => {})));
    const same = await Promise.all([A, B].map(P => P.page.evaluate(() => (globalThis as any).__krMp.net.conn.roomId)));
    check(`${phase}: both players in the same room`, same[0] === same[1], same.join(' / '));
    // a third player, headless, watching both at 60 fps from the same room
    const W = createNetClient({ transport, endpoint: `http://localhost:${RT_PORT}` as any, world: await A.page.evaluate(() => (globalThis as any).__krMpWorld), netsim: query ? { latencyMs: NET.targets.smooth.latencyMs, jitterMs: NET.targets.smooth.jitterMs, loss: NET.targets.smooth.loss } : null, getTicket: async () => ({ ticket: signTicket(SECRET, { uid: `watcher-${Date.now()}`, name: 'Watcher', role: 'player', guest: false }, 60), url: '' }) });
    await W.connect();
    const watched = new Map<number, ReturnType<typeof createSmoothness>>(), watchedMoved = new Map<number, number>();
    let watching = true, wLast = performance.now();
    const watcher = (async () => { while (watching) { await new Promise(r => setTimeout(r, 16)); const now = performance.now(), dt = (now - wLast) / 1000; wLast = now; W.update(dt, null); for (const c of W.sample(dt)) { if (!c.pose) continue; let m = watched.get(c.id); if (!m) watched.set(c.id, m = createSmoothness({ snapCm: NET.interp.snapCm })); m.frame(c.pose, dt); watchedMoved.set(c.id, (watchedMoved.get(c.id) ?? 0) + Math.hypot(...c.pose.vel) * dt); } } })();
    // both drive (A brakes now and then: its brake lights), A knocks into something halfway
    const t0 = Date.now();
    await Promise.all([
      (async () => { while (Date.now() - t0 < SECS * 1000) { await drive(A, ['ArrowUp'], 6000); await drive(A, ['ArrowDown'], 1500); } })(),
      (async () => { while (Date.now() - t0 < SECS * 1000) await drive(B, ['ArrowUp', Math.random() < 0.5 ? 'ArrowLeft' : 'ArrowRight'], 1500); })(),
      (async () => { await new Promise(r => setTimeout(r, SECS * 500)); await A.page.evaluate(() => (globalThis as any).garage.bump(11, 'front')); })(),
    ]);
    await new Promise(r => setTimeout(r, 1500));
    watching = false; await watcher; await W.leave();
    const wr = [...watched.entries()].map(([id, m]) => ({ id, moved: watchedMoved.get(id) ?? 0, ...m.result() }));
    check(`${phase}: both browsers' cars, watched at 60 fps by a third player: moving smoothly`, wr.length === 2 && wr.every(r => r.snaps === 0 && r.moved > 3),
      wr.map(r => `#${r.id}: ${r.frames} frames, moved ${r.moved.toFixed(0)} m, ${r.snaps} snaps (worst ${r.worstJumpCm} cm)`).join(' · '));
    if (process.env.MP_DEBUG) for (const P of [A, B]) console.log('DBG', P.email, await P.page.evaluate(async () => { const { debug } = await import('/testtrack/test-scene.js'), w = debug.active, v = w.sim.vehicle, p = v.body.translation(); return JSON.stringify({ file: w.file, pos: [p.x.toFixed(1), p.z.toFixed(1)], speed: v.forwardSpeed().toFixed(1), hold: !!w.pinned, spawning: !!w.spawning, focus: document.hasFocus(), vis: document.visibilityState, traceIds: Object.keys((globalThis as any).__krMpTrace), players: (globalThis as any).__krMp.net.players.size }); }));
    const bSawA = await seen(B), aSawB = await seen(A);
    for (const [who, s] of [['Ben sees Ana\'s car', bSawA], ['Ana sees Ben\'s car', aSawB]] as const)
      check(`${phase}: ${who}, drawn and moving${s.fps >= 20 ? ', smoothly' : ''}`, s.frames > 20 && s.moved > 3 && (s.fps < 20 || s.snaps === 0), `${s.frames} frames at ${s.fps.toFixed(0)} fps, moved ${s.moved.toFixed(0)} m${s.fps >= 20 ? `, ${s.snaps} snaps (worst ${s.worstJumpCm} cm)` : ' (too few frames a second here to judge smoothness from the page: the 60 fps watcher does)'}`);
    check(`${phase}: the other car's wheels turn, its brake lights and sound follow its player`, bSawA.wheels > 10 && aSawB.wheels > 10 && bSawA.brake && bSawA.sound && aSawB.sound, `wheel angles seen ${bSawA.wheels}/${aSawB.wheels}; Ana's brake lights seen by Ben: ${bSawA.brake}; sound ${bSawA.sound}/${aSawB.sound}`);
    check(`${phase}: Ana's crash dents her car in Ben's game too`, bSawA.dents > 0, `${bSawA.dents} dents`);
    // a dropped connection: Ana's game reconnects by itself; Ben sees her car pause, then carry on
    const away = B.page.evaluate(() => new Promise(r => { const off = (globalThis as any).__krMp.net.on('roster', m => { if (m.status?.status === 'away') { off(); r(true); } }); setTimeout(() => r(false), 15000); }));
    await A.page.evaluate(() => (globalThis as any).__krMp.net.conn.breakConnection());
    const sawAway = await away;
    await A.page.waitForFunction(() => (globalThis as any).__krMp.status === 'online', null, { timeout: 30000 }).catch(() => {});
    await drive(A, ['ArrowUp'], 3000);
    const back = await B.page.evaluate(() => { const p = [...(globalThis as any).__krMp.net.players.values()][0]; return { status: p?.status, states: p?.remote.stats.states }; });
    check(`${phase}: a dropped connection comes back by itself; the other player sees the car pause, then carry on`, sawAway && back.status === 'here' && (await A.page.evaluate(() => (globalThis as any).__krMp.status)) === 'online', `Ben saw Ana away: ${sawAway}; then ${back.status}`);
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
