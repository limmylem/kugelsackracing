// @ts-nocheck — (the page's own modules are imported inside the browser: not this program's)
// Two windows of ONE browser, as a person tries multiplayer on their own computer (Phase 7 Step 1; the bug report:
// "the overlay said 2 players, but I couldn't see the other car in either window"). Unlike mp-browser.ts (two
// separate browsers, two accounts, the proving ground), both windows here share the browser's sign-in and open the
// world /?mp opens (the real world), and what's checked is what each window really DRAWS — read from its own 3D
// scene and its rendered pixels, not from the network code's idea of where the car should be:
//   1. the same sign-in in both windows (plain ?mp): one replaces the other — and the one replaced says so on
//      screen, with how to play two windows (?player=A / ?player=B), until it's dealt with
//   2. ?mp&player=A and ?mp&player=B: each a player of its own, in the same room; not on top of each other (both
//      arrive where the world puts every new car: the later one moves beside); each window draws the other's car —
//      visible, in the scene being drawn, on screen, its pixels in the rendered image — and when A drives (real key
//      presses), B draws it moving
//   3. A's window stops drawing frames (in the background: minimised, another tab): A stays in the room, B shows
//      A's car still there, paused; when A comes back and drives, B draws it moving again
//   4. F8 in B lists A: its distance, drawn, its last update; F9 in B puts B's car beside A's
//
//   node server/tools/mp-two-windows.ts [--local-libs]   (REDIS_URL; playwright-core and Chromium: PLAYWRIGHT_CORE,
//   CHROMIUM; jsDelivr, or CDN_LIBS with --local-libs — see mp-browser.ts)

import path from 'node:path';
import { Redis } from 'ioredis';
import { freshDatabase, testConfig, signUp } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
import { REPO_DIR } from '../src/config.ts';
import { startRt } from '../src/rt/server.ts';

const args = process.argv.slice(2);
const PORT = 8787, BASE = `http://localhost:${PORT}`, RT_PORT = 2742, REDIS = `${(process.env.REDIS_URL ?? 'redis://localhost:6379').replace(/\/\d+$/, '')}/13`;
const SECRET = 'mp-two-windows-secret-mp-two-windows-0123456789';
let pw: any;
try { pw = await import('playwright-core'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); }
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push(ok); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`); };

{ const r = new Redis(REDIS); await r.flushdb(); r.disconnect(); }
const rt = await startRt({ port: RT_PORT, redisUrl: REDIS, secret: SECRET, rt: { allowGuests: true, maxPlayers: 100, roomMaxClients: 16, netsim: true } });
const database = await freshDatabase('mptwowin');
const config = testConfig(database.url, { serveClient: true, logLevel: 'warn' }, { PUBLIC_URL: BASE, RT_URL: `ws://localhost:${RT_PORT}`, RT_SECRET: SECRET });
const app = await buildApp({ config });
await app.listen({ port: PORT, host: '127.0.0.1' });
await signUp(app, app.deps.mailer.outbox as any[], { email: 'me@example.com', name: 'Me Myself', ip: '10.9.4.1' });

const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-proxy-server', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
// ONE browser context: both windows share its cookies (its sign-in), as two windows of one browser do
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
const errors: string[] = [];
const A = await ctx.newPage(), B = await ctx.newPage();
if (process.env.MP_DEBUG_SERVER) await ctx.addInitScript(() => { (globalThis as any).__krMpTrace = {}; });
for (const [n, p] of [['A', A], ['B', B]] as const) {
  p.on('pageerror', (e: any) => errors.push(`${n}: ${e}`));
  if (process.env.MP_DEBUG) p.on('console', (m: any) => console.log(`[${n}] ${m.type()}: ${m.text().slice(0, 240)}`));
}
// signed in once: both windows have it
await A.goto(`${BASE}/account/`);
await A.evaluate(async () => { const { createApi } = await import('/account/api.js'); await createApi().auth('/sign-in/email', { email: 'me@example.com', password: 'correct horse battery' }); });

// what a window has: its multiplayer state, and every other player's car it has made — straight from its 3D scene
const look = (P) => P.evaluate(async () => {
  const { debug } = await import('/testtrack/test-scene.js'), THREE = await import('three'), w = debug.active, S = debug.shared, M = (globalThis as any).__krMp;
  if (!w?.sim) return { ready: false };
  const me = w.sim.vehicle.body.translation(), cam = w.camera, canvas = S.renderer.domElement;
  const banner = document.getElementById('krMpBanner');
  const cars = [];
  for (const v of S.visuals ?? []) {
    if (v === w.carVis || !v.fixedPaint) continue;      // (another player's car: made with its own paint)
    const g = v.group; let root = g; while (root.parent) root = root.parent;
    const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3());
    const ndc = c.clone().project(cam);
    cars.push({ visible: g.visible, inScene: root === w.scene, pos: [c.x, c.y, c.z], fromMe: Math.hypot(c.x - me.x, c.z - me.z), ndc: [ndc.x, ndc.y, ndc.z], size: box.getSize(new THREE.Vector3()).toArray() });
  }
  return { ready: !w.spawning, file: w.file, me: [me.x, me.y, me.z], status: M?.status ?? null, message: M?.message ?? '', id: M?.net?.id ?? null, room: M?.net?.conn?.roomId ?? null,
    names: M ? [...M.net.players.values()].map(p => p.name) : [], banner: banner && !banner.hidden ? banner.textContent : null, cars, canvas: [canvas.width, canvas.height] };
});
// whether the other player's car is really in the rendered image: the scene drawn once with it and once without, the
// pixels compared over where it is on screen (the rest of the frame doesn't change between the two)
const pixels = (P) => P.evaluate(async () => {
  const { debug } = await import('/testtrack/test-scene.js'), THREE = await import('three'), w = debug.active, S = debug.shared;
  const R = S.renderer, gl = R.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const v = [...(S.visuals ?? [])].find(x => x !== w.carVis && x.fixedPaint);
  if (!v) return { car: false, changed: 0 };
  const box = new THREE.Box3().setFromObject(v.group), pts = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) pts.push(new THREE.Vector3(x, y, z).project(w.camera));
  const x0 = Math.max(0, Math.floor((Math.min(...pts.map(p => p.x)) + 1) / 2 * W)), x1 = Math.min(W, Math.ceil((Math.max(...pts.map(p => p.x)) + 1) / 2 * W));
  const y0 = Math.max(0, Math.floor((Math.min(...pts.map(p => p.y)) + 1) / 2 * H)), y1 = Math.min(H, Math.ceil((Math.max(...pts.map(p => p.y)) + 1) / 2 * H));
  if (x1 <= x0 || y1 <= y0 || pts.some(p => p.z > 1)) return { car: true, changed: 0, offScreen: true };
  const grab = () => { w.fxDraw.render(w.scene, w.camera); const b = new Uint8Array((x1 - x0) * (y1 - y0) * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(x0, y0, x1 - x0, y1 - y0, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
  const was = v.group.visible;
  v.group.visible = true; const on = grab();
  v.group.visible = false; const off = grab();
  v.group.visible = was;
  let changed = 0;
  for (let i = 0; i < on.length; i += 4) if (Math.abs(on[i] - off[i]) + Math.abs(on[i + 1] - off[i + 1]) + Math.abs(on[i + 2] - off[i + 2]) > 40) changed++;
  return { car: true, changed, box: [x1 - x0, y1 - y0] };
});
const until = async (fn, ms, every = 1000) => { for (const t = Date.now(); Date.now() - t < ms; await new Promise(r => setTimeout(r, every))) { const v = await fn().catch(() => null); if (v) return v; } return null; };
const drive = async (P, keys: string[], ms: number) => { for (const k of keys) await P.keyboard.down(k); await P.waitForTimeout(ms); for (const k of keys) await P.keyboard.up(k); };
const f = (x, d = 1) => Number.isFinite(x) ? x.toFixed(d) : '–';

try {
  // ---------- 1. both windows on the same sign-in ----------
  console.log('\n== 1. two windows, one sign-in: /?mp in both');
  await A.goto(`${BASE}/?mp`);
  await until(async () => (await look(A)).status === 'online', 240000);
  await B.goto(`${BASE}/?mp`);
  await until(async () => (await look(B)).status === 'online', 240000);
  const one = await until(async () => { const [a, b] = [await look(A), await look(B)]; return (a.banner || b.banner) ? [a, b] : null; }, 20000);
  const replaced = one?.find(x => x.banner);
  check('the same sign-in in two windows: the window replaced says so on screen, and how to play two windows', !!replaced && /another tab or device/.test(replaced.banner) && /player=A/.test(replaced.banner),
    replaced ? `"${replaced.banner}"` : 'neither window says anything (the other car just never appears)');

  // ---------- 2. a player of its own in each window ----------
  console.log('\n== 2. /?mp&player=A and /?mp&player=B, the world /?mp opens');
  await A.goto(`${BASE}/?mp&player=A`); await B.goto(`${BASE}/?mp&player=B`);
  const both = await until(async () => { const [a, b] = [await look(A), await look(B)]; return a.ready && b.ready && a.status === 'online' && b.status === 'online' && a.cars.length === 1 && b.cars.length === 1 ? [a, b] : null; }, 300000);
  const [a0, b0] = both ?? [await look(A), await look(B)];
  check('each window is a player of its own, both online in the same room, nobody else there (a window closed or reloaded leaves at once)', a0.status === 'online' && b0.status === 'online' && a0.room && a0.room === b0.room && a0.id !== b0.id && a0.names.join() === 'Player B' && b0.names.join() === 'Player A',
    `A: ${a0.status} #${a0.id} ${a0.room} sees ${JSON.stringify(a0.names)} · B: ${b0.status} #${b0.id} ${b0.room} sees ${JSON.stringify(b0.names)}${a0.message || b0.message ? ` · ${a0.message || b0.message}` : ''}`);
  // (moved beside, once both have landed)
  const apart = await until(async () => { const [a, b] = [await look(A), await look(B)]; const d = Math.hypot(a.me[0] - b.me[0], a.me[2] - b.me[2]); return d > 2.5 ? { a, b, d } : null; }, 30000);
  check('not on top of each other: the later one moved beside the first', !!apart, apart ? `${f(apart.d)} m apart` : 'both still where every new car arrives');
  for (const [who, P] of [['A draws B', A], ['B draws A', B]] as const) {
    const s = await until(async () => { const l = await look(P); const c = l.cars[0]; return c?.visible && c.inScene && Math.abs(c.ndc[0]) <= 1 && Math.abs(c.ndc[1]) <= 1 && c.ndc[2] < 1 ? l : null; }, 20000) ?? await look(P);
    const px = await pixels(P), c = s.cars[0];
    check(`${who}'s car: visible, in the scene being drawn, on screen, in the rendered image`, !!c && c.visible && c.inScene && Math.abs(c.ndc[0]) <= 1 && Math.abs(c.ndc[1]) <= 1 && c.ndc[2] < 1 && px.changed >= 50 && c.fromMe > 2.5,
      c ? `${f(c.fromMe)} m from its own car, on screen at (${f(c.ndc[0], 2)}, ${f(c.ndc[1], 2)}), ${px.changed} pixels of it in the frame${px.box ? ` (its box ${px.box.join('×')})` : ''}` : 'no car made for the other player');
  }
  // A drives (real key presses): B draws it moving — as far as A really went (B shows other cars a moment in the
  // past: it has a few seconds to catch up)
  const posA = async () => (await look(A)).me;
  const before = (await look(B)).cars[0]?.pos, a0p = await posA();
  await A.bringToFront();
  await drive(A, ['ArrowUp'], 10000);
  const a1p = await posA(), aWent = Math.hypot(a1p[0] - a0p[0], a1p[2] - a0p[2]);
  const drawnMoved = async () => { const l = await look(B); return before && l.cars[0] ? Math.hypot(l.cars[0].pos[0] - before[0], l.cars[0].pos[2] - before[2]) : 0; };
  await until(async () => (await drawnMoved()) > aWent * 0.5, 6000, 500);
  const after = await look(B), moved = await drawnMoved();
  if (process.env.MP_DEBUG_SERVER) console.log('SERVER', JSON.stringify(rt.rooms().map(r => r.metrics().perPlayer)));
  if (process.env.MP_DEBUG_SERVER) {
    const srv = Date.now();
    for (const [n, P] of [['A', A], ['B', B]] as const) console.log('CLOCK', n, await P.evaluate(() => { const M = (globalThis as any).__krMp; return JSON.stringify({ roomNow: M.net.roomNow(), wall: Date.now(), rtt: M.net.clock.rtt }); }));
    console.log('BVIEW', await B.evaluate(() => { const M = (globalThis as any).__krMp, p = [...M.net.players.values()][0], b = p.remote.buf; return JSON.stringify({ now: M.net.roomNow(), stats: p.remote.stats, n: b?.length, first: b?.[0]?.time, last: b?.[b.length - 1]?.time, lastPos: b?.[b.length - 1]?.pos, fps: (globalThis as any).__krFps }); }));
    const tr = await B.evaluate(() => { const t = (globalThis as any).__krMpTrace; const k = Object.keys(t)[0]; return (t[k] ?? []).slice(-12).map(f => [Math.round(f.at), f.pos.map(x => +x.toFixed(1)), Math.round(f.shownAt), f.extrapolating ? 'X' : '', f.correctionCm?.toFixed?.(0)]); });
    console.log('TRACE', JSON.stringify(tr));
  }
  check('A drives: B draws A\'s car moving, as far as A went', aWent > 1 && moved > aWent * 0.5 && after.cars[0]?.visible, `A drove ${f(aWent)} m; B drew it ${f(moved)} m further on`);

  // ---------- 3. A's window stops drawing frames (in the background) ----------
  console.log('\n== 3. A\'s window in the background (no frames drawn) for 20 s');
  // (as the browser does to a window in the background: no frames, and the page told it's hidden)
  await A.evaluate(() => { const g = globalThis as any; g.__rafQueue = []; g.__raf = g.requestAnimationFrame; g.requestAnimationFrame = (cb) => { g.__rafQueue.push(cb); return 0; };
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await A.waitForTimeout(20000);
  const [ah, bh] = [await look(A), await look(B)];
  const bHas = await B.evaluate(() => [...(globalThis as any).__krMp.net.players.values()].map(p => ({ status: p.status, paused: p.base ? !!(p.base.flags & 32) : null })));
  check('a window in the background stays in the room; the other sees its car still there, paused', ah.status === 'online' && bh.cars[0]?.visible && bHas.length === 1 && bHas[0].paused === true,
    `A: ${ah.status}${ah.message ? ` (${ah.message})` : ''} · B sees ${JSON.stringify(bHas)}, its car ${bh.cars[0]?.visible ? 'drawn' : 'not drawn'}`);
  await A.evaluate(() => { const g = globalThis as any; delete (document as any).visibilityState; delete (document as any).hidden; document.dispatchEvent(new Event('visibilitychange')); g.requestAnimationFrame = g.__raf; for (const cb of g.__rafQueue.splice(0)) g.requestAnimationFrame(cb); });
  const back0 = (await look(B)).cars[0]?.pos, b0p = await posA();
  await drive(A, ['ArrowUp'], 6000);
  const b1p = await posA(), backWent = Math.hypot(b1p[0] - b0p[0], b1p[2] - b0p[2]);
  const backDrawn = async () => { const p = (await look(B)).cars[0]?.pos; return back0 && p ? Math.hypot(p[0] - back0[0], p[2] - back0[2]) : 0; };
  await until(async () => (await backDrawn()) > backWent * 0.5, 6000, 500);
  const backMoved = await backDrawn();
  check('back in front: A drives, B draws it moving again, as far as A went', backWent > 1 && backMoved > backWent * 0.5, `A drove ${f(backWent)} m; B drew it ${f(backMoved)} m further on`);

  // ---------- 4. the overlay's list, and F9 ----------
  console.log('\n== 4. F8 (who\'s here) and F9 (beside the nearest player) in B');
  await B.bringToFront();
  await B.keyboard.press('F8');
  await B.waitForTimeout(800);
  const text = await B.evaluate(() => { const e = document.getElementById('krNet'); return e && !e.hidden ? e.textContent : null; });
  check('F8 lists the other player: its distance, whether it\'s drawn, its last update', !!text && /Player A/.test(text) && /\d+ m · drawn/.test(text) && /updated .* ago/.test(text), text ? text.split('\n').filter(l => /PLAYERS|Player A/.test(l)).join(' | ') : 'no overlay');
  const far = (await look(B)).cars[0]?.fromMe;
  await B.keyboard.press('F9');
  const near = await until(async () => { const l = await look(B); return l.ready && l.cars[0] && l.cars[0].fromMe < 6 ? l.cars[0].fromMe : null; }, 30000);
  check('F9 puts your car beside the nearest player', near != null, `${f(far)} m away, then ${f(near)} m`);

  check('no errors on the pages', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e: any) {
  check('ran to the end', false, e.stack ?? e.message);
} finally {
  if (process.env.MP_SHOTS) for (const [n, P] of [['A', A], ['B', B]] as const) await P.screenshot({ path: `${process.env.MP_SHOTS}/two-windows-${n}.png` }).catch(() => {});
  await browser.close(); await app.close(); await database.drop(); await rt.stop();
}
const failed = results.filter(r => !r).length;
console.log(failed ? `\n${failed} of ${results.length} failed` : `\n${results.length} of ${results.length} ok`);
process.exit(failed ? 1 : 0);
