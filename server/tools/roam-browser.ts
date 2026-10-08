// Free roam in the game, in the browser (Phase 7 Step 4; docs/FREE_ROAM.md): two windows as Player A and Player B
// (?mp&player=A, ?mp&player=B), driven into the Milton Keynes region — the real game, its real-world map and zones. What's
// checked is what each window really shows: the other car drawn in its 3D scene with its name over it, the other player on
// the minimap (once their location is shared), the free-roam screen (F6) listing who's near, inspecting a car, a challenge
// asked from the screen and answered from the prompt (its route on the map), chat, and the contact and passive settings in
// the HUD. One real-time process, no Redis.
//
//   node server/tools/roam-browser.ts [--local-libs]        (needs PostgreSQL with PostGIS: TEST_DATABASE_URL; Chromium)

import path from 'node:path';
import { freshDatabase, testConfig } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
import { REPO_DIR } from '../src/config.ts';
import { startRt } from '../src/rt/server.ts';

const args = process.argv.slice(2);
const PORT = 8787, BASE = `http://localhost:${PORT}`, RT_PORT = 2743;
const SECRET = 'roam-browser-secret-roam-browser-secret-0123456789';
let pw: any;
try { pw = await import('playwright-core'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); }
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push(!!ok); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (f: () => any, ms: number, every = 400) => { for (const t = Date.now(); Date.now() - t < ms; await sleep(every)) { const v = await f(); if (v) return v; } return null; };

process.env.ROAM_ZONE_TILES ??= '4';
const rt = await startRt({ port: RT_PORT, redisUrl: null, secret: SECRET, rt: { allowGuests: true, maxPlayers: 100, roomMaxClients: 64, netsim: true }, api: { url: BASE } });
const database = await freshDatabase('roambrowser');
const app: any = await buildApp({ config: testConfig(database.url, { serveClient: true, logLevel: 'warn' }, { PUBLIC_URL: BASE, RT_URL: `ws://localhost:${RT_PORT}`, RT_SECRET: SECRET }) });
await app.listen({ port: PORT, host: '127.0.0.1' });

const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-proxy-server', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 640, height: 420 } });
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
for (const [n, p] of [['A', A], ['B', B]] as const) {
  p.on('pageerror', (e: any) => errors.push(`${n}: ${e}`));
  if (process.env.MP_DEBUG) p.on('console', (m: any) => console.log(`[${n}] ${m.type()}: ${m.text().slice(0, 240)}`));
}

// what a window shows: its free roam, the other cars drawn in its scene (and on screen), the labels, the map's players
const look = (P: any) => P.evaluate(async () => {
  const { debug } = await import('/testtrack/test-scene.js'), THREE = await import('three'), w = debug.active, S = debug.shared, R = (globalThis as any).__krRoam;
  if (!w?.sim) return { ready: false };
  const me = w.sim.vehicle.body.translation(), cam = w.camera, cars = [];
  for (const v of S.visuals ?? []) {
    if (v === w.carVis || !v.fixedPaint) continue;
    const g = v.group; let root = g; while (root.parent) root = root.parent;
    const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3()), ndc = c.clone().project(cam);
    cars.push({ visible: g.visible, inScene: root === w.scene, fromMe: Math.hypot(c.x - me.x, c.z - me.z), onScreen: Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z < 1 });
  }
  const labels = [...document.querySelectorAll('div')].filter(d => d.style.position === 'absolute' && d.style.transform?.includes('translate(-50%, -100%)') && !d.hidden).map(d => d.textContent);
  return { ready: !w.spawning && !!w.stream, file: w.file, region: R?.RC.home ? 'roam' : null, zone: R?.RC.home ?? null, group: R?.RC.group ?? null, status: R?.net.status ?? null, me: [me.x, me.y, me.z], cars, labels,
    map: R?.state.map?.map((p: any) => p.name) ?? [], hud: document.getElementById('roamHud')?.textContent ?? '', touch: R?.state.touch ?? null, toasts: [...document.querySelectorAll('#roamToasts div')].map(d => d.textContent) };
});
const panel = (P: any) => P.evaluate(() => ({ open: document.getElementById('roamPanel')?.classList.contains('open'), text: document.getElementById('roamPanel')?.textContent ?? '', prompt: (document.getElementById('roamPrompt') as any)?.style.display === 'block' ? document.getElementById('roamPrompt')!.textContent : null }));
// a real click on what's drawn — and if something covers it, what
const click = async (P: any, sel: string) => {
  try { await P.click(sel, { timeout: 20000, force: true }); }
  catch (e: any) { const why = await P.evaluate((s: string) => { const el = document.querySelector(s) as HTMLElement | null; if (!el) return 'not there'; const r = el.getBoundingClientRect(), at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return `at ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)}, visible ${el.offsetParent !== null}; on top: ${at?.id || at?.tagName} ${(at as any)?.className ?? ''}`; }, sel); throw new Error(`clicking ${sel}: ${why}`); }
};
// the free-roam screen open (F6), whatever was open before
const openPanel = async (P: any) => { await P.bringToFront(); if (!(await panel(P)).open) await P.keyboard.press('F6'); if (!(await panel(P)).open) await P.evaluate(() => (document.querySelector('#roamHud button') as HTMLElement)?.click()); };

try {
  console.log('== Two windows, Player A and Player B, into Milton Keynes with ?mp');
  // (?view=600: the world loaded 600 m round the car — drawn in software, the city is slow)
  for (const [n, P] of [['A', A], ['B', B]] as const) await P.goto(`${BASE}/?mp&player=${n}&view=600`);
  for (const [n, P] of [['A', A], ['B', B]] as const) {
    await until(async () => { const b = P.locator('[data-k="later"]'); if (await b.isVisible().catch(() => false)) await b.click().catch(() => {}); return P.evaluate(async () => !!(await import('/testtrack/test-scene.js')).enter).catch(() => false); }, 120000, 1000);
    void P.evaluate(async () => { const m = await import('/testtrack/test-scene.js'); await m.enter('scenes/map_v3.json?region=mk'); }).catch((e: any) => console.log(`  ${n}: entering Milton Keynes failed: ${e?.message}`));
  }
  const both = await until(async () => { const [a, b] = [await look(A), await look(B)]; return a.ready && b.ready && a.zone && b.zone && a.status === 'online' && b.status === 'online' ? [a, b] : null; }, 300000, 1500);
  const [a0, b0] = both ?? [await look(A), await look(B)];
  // (the region's spawn is where four zones meet: each may be at home in another, in every one of them, the same instance group)
  const zonesOf = (P: any) => P.evaluate(() => (globalThis as any).__krRoam.RC.zones);
  const [za, zb] = [await zonesOf(A), await zonesOf(B)];
  check('both in free roam in Milton Keynes, in the same instance (placed together: players near), each in the other\'s home zone too', a0.group && a0.group === b0.group && za.includes(b0.zone) && zb.includes(a0.zone), `A home ${a0.zone} of ${za.join(' ')} · B home ${b0.zone} of ${zb.join(' ')} · instance ${a0.group}/${b0.group}`);
  // (B beside A — F9, the development key)
  await B.bringToFront(); await B.keyboard.press('F9');
  for (const [who, P] of [['A draws B', A], ['B draws A', B]] as const) {
    const s = await until(async () => { const l = await look(P); const c = l.cars.find((x: any) => x.visible && x.inScene); return c ? l : null; }, 30000) ?? await look(P);
    const c = s.cars.find((x: any) => x.visible && x.inScene);
    check(`${who}'s car: drawn in the scene${c?.onScreen ? ', on screen' : ''}`, !!c, c ? `${c.fromMe.toFixed(1)} m away` : JSON.stringify(s.cars));
  }
  const lb = await until(async () => { const l = await look(A); return l.labels.some((t: string) => /Player B/.test(t)) ? l : null; }, 15000);
  check('A sees "Player B" over the car', !!lb, JSON.stringify((lb ?? await look(A)).labels));

  // the minimap: B shares where they are with everyone (the settings tab: a real click), and A's map has B
  await openPanel(B);
  await click(B, '#roamPanel nav button[data-tab="settings"]');
  await click(B, '#roamPanel input[data-set="location"][value="everyone"]');
  const onMap = await until(async () => { const l = await look(A); return l.map.includes('Player B') ? l : null; }, 15000, 1000);
  check('B shares their location with everyone: B on A\'s minimap and full map', !!onMap, JSON.stringify((onMap ?? await look(A)).map));
  await click(B, '#roamPanel input[data-set="location"][value="nobody"]');
  const offMap = await until(async () => { const l = await look(A); return !l.map.includes('Player B') ? l : null; }, 15000, 1000);
  check('… and with nobody: gone from A\'s map', !!offMap);
  const nameNow = await until(async () => { const l = await look(A); return l.labels.some((t: string) => /Driver/.test(t)) ? l : null; }, 10000);
  check('… and to A (not a friend) B is now "Driver" over the car', !!nameNow, JSON.stringify((nameNow ?? await look(A)).labels));

  // the free-roam screen: who's near, inspect
  await openPanel(A);
  const near = await until(async () => { const p = await panel(A); return p.open && /Driver|Player B/.test(p.text) ? p : null; }, 10000);
  check('A\'s free-roam screen (F6): B listed nearby', !!near, (near ?? await panel(A)).text.slice(0, 160));
  await click(A, '#roamPanel button[data-a="inspect"]');
  const ins = await until(async () => { const p = await panel(A); return p.prompt && /car/.test(p.prompt) ? p : null; }, 8000);
  check('inspect: B\'s car — its model, class and rating, parts', !!ins, ins?.prompt?.slice(0, 160) ?? '');
  await click(A, '#roamPrompt button');

  // a challenge from the screen; B's prompt with its route; declined
  await click(A, '#roamPanel button[data-a="challenge"]');
  await click(A, '#roamPanel button[data-a="ch"][data-type="sprint"]');
  const inv = await until(async () => { const p = await panel(B); return p.prompt && /challenges you/.test(p.prompt) ? p : null; }, 15000);
  check('A challenges B to a sprint: B\'s prompt, with the route (its length, where to)', !!inv && /km|m to/.test(inv.prompt ?? ''), inv?.prompt?.slice(0, 200) ?? '');
  await B.bringToFront();
  await click(B, '#roamPrompt button[data-yes="0"]');
  const no = await until(async () => { const l = await look(A); return l.toasts.some((t: string) => /said no/.test(t)) ? l : null; }, 8000);
  check('B declines: A is told', !!no);

  // chat: nearby
  await A.bringToFront();
  await click(A, '#roamPanel nav button[data-tab="chat"]');
  await A.fill('#roamChatIn', 'see you at the roundabout');
  await click(A, '#roamPanel button[data-a="send"]');
  const heard = await until(async () => { const l = await look(B); return l.toasts.some((t: string) => /roundabout/.test(t)) ? l : null; }, 8000);
  check('nearby chat: B hears A', !!heard);

  // contact: both on → the HUD says so; passive mode for B → a ghost to everyone, and A can't challenge them
  for (const P of [A, B]) { await openPanel(P); await click(P, '#roamPanel nav button[data-tab="settings"]'); await click(P, '#roamPanel input[data-set="contact"]'); }
  const both2 = await until(async () => { const [a, b] = [await look(A), await look(B)]; return /CONTACT 1/.test(a.hud) && /CONTACT 1/.test(b.hud) ? [a, b] : null; }, 10000);
  check('contact on in both: each touches the other (the HUD: CONTACT 1)', !!both2, `${(await look(A)).hud} / ${(await look(B)).hud}`);
  await B.bringToFront(); await click(B, '#roamPanel input[data-set="passive"]');
  const pas = await until(async () => { const [a, b] = [await look(A), await look(B)]; return /PASSIVE/.test(b.hud) && !/CONTACT 1/.test(a.hud) ? [a, b] : null; }, 10000);
  check('B in passive mode: a ghost to A (A\'s HUD: no contact), B\'s HUD says PASSIVE', !!pas, `${(await look(A)).hud} / ${(await look(B)).hud}`);
} catch (e: any) {
  check('the test ran', false, e?.stack ?? String(e));
} finally {
  if (errors.length) console.log(`page errors:\n${errors.slice(0, 10).join('\n')}`);
  await browser.close().catch(() => {});
  await app.close(); await rt.stop(); await database.drop();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed} of ${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
