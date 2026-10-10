// @ts-nocheck — (the page's own modules are imported inside the browser: not this program's)
// Multiplayer races in the browser, as a person plays them (Phase 7 Step 2; the user's testing notes: "every browser test
// must check what is actually drawn on screen"). Two windows of one browser play as Player A and Player B (?mp&player=A
// and ?mp&player=B, the development identities) and bots fill the grid. ONE real-time process, no Redis. What's checked
// is what each window really shows — each screen visible, in the window, not covered by anything (the element at its
// middle is itself), its text against the server's own state, and its pixels in a screenshot — so each check fails if
// the screen is wrong, missing or hidden:
//   1. the menu, a private lobby and its invite code; B joins with the code (typed in, Join clicked); both lobby
//      screens list everyone with their car, ready state and rank; nothing of a race drawn over it; chat (the filter,
//      and a mute)
//   2. loading: the loading screen in both windows while the route loads
//   3. the countdown: the five red lights drawn, then out — each window timed to the server's goAt within a few ms
//   4. the race: each window's HUD shows its own place as the server has it, and the standings in the server's order;
//      the other cars drawn in the 3D view
//   5. the results: provisional, then confirmed — the table in the server's confirmed order with each player's pay and
//      rank, the podium's top three, A's and B's own runs (timed by the game) passing the check — then a rematch vote
//      back to the lobby screen; "Add friend" on a bot's row, clicked: "Request sent" (Phase 7 Step 5)
//   6. the rematch: B watches instead (spectating a lobby you're in): the bar names the car its camera is on, that car
//      on screen; → another car; the in-car and TV cameras
//   7. a quick race: both click Quick race and are matched into one race, its loading and lights drawn
// Two windows, not more: drawing the city in software, each needs ~15 frames a second for its physics to keep real time.
//
//   node server/tools/mp-browser-race.ts [--local-libs]   (TEST_DATABASE_URL; playwright-core and Chromium as
//   mp-two-windows.ts; MP_SHOTS=dir keeps screenshots)

import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';
import { freshDatabase, testConfig, signUp } from '../test/helpers.ts';
import { buildApp } from '../src/app.ts';
import { REPO_DIR } from '../src/config.ts';
import { startRt } from '../src/rt/server.ts';
import { courseOf } from '../src/rt/mp.ts';
import { seedMpRoutes } from './seed-mp-routes.ts';
import { createMpSession } from '../../mp/client.js';
import { createRaceBot } from '../../mp/bot.js';
import { transport } from './rt-bots.ts';

const args = process.argv.slice(2);
// (--quick: the setup, then only the quick race — for working on it)
const QUICK_ONLY = args.includes('--quick');
const PORT = 8787, BASE = `http://localhost:${PORT}`, RT_PORT = 2744, SECRET = 'mp-browser-race-secret-mp-browser-race-0123456789';
const MP = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'data/multiplayer.json'), 'utf8'));
const QCFG = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'data/quests.json'), 'utf8'));
// (the bots: slower than a person's car, so everyone's in by the finish window)
const SLOW = { ...MP.npc, topSpeed: 11, accelG: 0.25 };
// (down Market Street to the Ferry Building: towards the bay, so less of the city in view — drawn in software, it's slow)
const ROUTE = { id: 'route_mpsftest', region: 'sf', name: 'Market Street Dash', kind: 'p2p', what: 'the browser test\'s short sprint', waypoints: [[37.7905, -122.3995], [37.7936, -122.3955]] };
let pw: any;
try { pw = await import('playwright-core'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); }
const results: boolean[] = [], lines: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push(ok); const l = `${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`; console.log(l); lines.push(l); };
const section = (s: string) => { console.log(`\n== ${s}`); lines.push('', `## ${s}`, ''); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms, every = 500) => { for (const t = Date.now(); Date.now() - t < ms; await sleep(every)) { const v = await fn().catch(() => null); if (v) return v; } return null; };

const database = await freshDatabase('mpbrowser');
const config = testConfig(database.url, { serveClient: true, logLevel: 'warn' }, { PUBLIC_URL: BASE, RT_URL: `ws://localhost:${RT_PORT}`, RT_SECRET: SECRET });
const app: any = await buildApp({ config });
await app.listen({ port: PORT, host: '127.0.0.1' });
await seedMpRoutes(app.content, { regions: [], extra: [ROUTE] });
// (the real-time server's warnings — kicks by the live checks, failures — shown at the end if anything failed)
const rtLog: string[] = [];
const rt = await startRt({ port: RT_PORT, secret: SECRET, redisUrl: null, rt: { allowGuests: true, maxPlayers: 200, roomMaxClients: 64, netsim: true }, api: { url: `http://localhost:${PORT}` }, quickVenue: { '*': { kind: 'route', id: ROUTE.id } }, log: (m: string, e: any) => { if (/fail|kick|flag/.test(m) || process.env.MP_DEBUG) rtLog.push(`${new Date().toISOString().slice(11, 19)} ${m} ${JSON.stringify(e ?? {})}`); } });
const raceOf = (roomId: string) => rt.races().find((r: any) => r.roomId === roomId);
const courseFor = async v => courseOf(await app.mp.venue(v.venue));

// bot players: real accounts, their own connections (mp/bot.js)
let made = 0;
async function bots(n: number) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = ++made, p = await signUp(app, app.deps.mailer.outbox, { email: `bot${k}@example.com`, name: `Bot ${k}`, ip: `10.77.${k}.1` });
    const ticket = async () => { const r = await p.post('/api/v1/rt/ticket', {}); if (r.status !== 200) throw new Error(r.text); return r.body; };
    const session = createMpSession({ transport, endpoint: `http://localhost:${RT_PORT}`, getTicket: ticket });
    out.push({ session, name: `Bot ${k}`, bot: createRaceBot({ session, courseFor, quests: QCFG, cfg: SLOW, skill: 0.8 }) });
  }
  return out;
}

const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-proxy-server', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
// (the windows' libraries: from the CDN, or this computer's copies with --local-libs — see mp-two-windows.ts)
const nm = path.join(REPO_DIR, 'node_modules'), LIBS = process.env.CDN_LIBS ?? REPO_DIR, bundles = new Map();
async function prepare(ctx) {
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cesium|openfreemap|demotiles/, (r: any) => r.abort());
  if (!args.includes('--local-libs')) return ctx;
  const esbuild = await import('esbuild');
  await ctx.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', (r: any) => r.fulfill({ path: `${nm}/three/${new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', '')}`, contentType: 'text/javascript' }));
  await ctx.route('https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/**', (r: any) => r.fulfill({ path: `${nm}/@dimforge/rapier3d-compat/dist/rapier.mjs`, contentType: 'text/javascript' }));
  await ctx.route('https://cdn.jsdelivr.net/npm/maplibre-gl@*/dist/**', (r: any) => { const f = new URL(r.request().url()).pathname.split('/dist/')[1]; return r.fulfill({ path: `${nm}/maplibre-gl/dist/${f}`, contentType: f.endsWith('.css') ? 'text/css' : 'text/javascript' }); });
  const bundle = async (pkg: string) => bundles.get(pkg) ?? bundles.set(pkg, (await esbuild.build({ stdin: { contents: `export * from '${pkg}'; export { default } from '${pkg}';`, resolveDir: LIBS }, bundle: true, format: 'esm', write: false, logLevel: 'silent' }).catch(() => esbuild.build({ stdin: { contents: `export * from '${pkg}';`, resolveDir: LIBS }, bundle: true, format: 'esm', write: false }))).outputFiles[0].text).get(pkg);
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/(pbf|@mapbox\/vector-tile)@/, async (r: any) => r.fulfill({ body: await bundle(/pbf@/.test(r.request().url()) ? 'pbf' : '@mapbox/vector-tile'), contentType: 'text/javascript' }));
  return ctx;
}
// A and B: one browser's two windows (sharing its cookies, as two windows do)
const ctx = await prepare(await browser.newContext({ viewport: { width: 520, height: 380 } }));
const errors: string[] = [];
const errorCounts = new Map<string, number>();
const pages: Record<string, any> = {};
for (const n of ['A', 'B']) {
  const P = pages[n] = await ctx.newPage();
  // (with where it came from: the first lines of its stack — and how many times, not each one)
  P.on('pageerror', (e: any) => { const at = String(e?.stack ?? '').split('\n').slice(1, 4).map(x => x.trim().replace(/https?:\/\/[^/]+\//, '')).join(' < '), key = `${n}: ${e} (${at})`; errorCounts.set(key, (errorCounts.get(key) ?? 0) + 1); if (errorCounts.get(key) === 1) errors.push(key); });
  P.on('dialog', (d: any) => d.accept(d.type() === 'prompt' ? 'Rude in the chat, again and again.' : undefined));
  if (process.env.MP_DEBUG) P.on('console', (m: any) => console.log(`[${n}] ${m.type()}: ${m.text().slice(0, 240)}`));
}
const { A, B } = pages;

// ---------- what a window shows ----------
// an element as drawn: there, visible (nothing hiding it or anything round it), in the window, and on top where it is
// (the element at its middle is itself or inside it) — its text and where
const seen = (P, sel) => P.evaluate(sel => {
  const e = document.querySelector(sel);
  if (!e) return { ok: false, why: 'not on the page' };
  // (what the browser makes of it — not what the page meant: a hidden attribute some CSS overrides is still drawn)
  for (let x = e; x; x = x.parentElement) { const c = getComputedStyle(x); if (c.display === 'none' || c.visibility === 'hidden' || Number(c.opacity) === 0) return { ok: false, why: `hidden (${x.id || x.className || x.tagName})` }; }
  const r = e.getBoundingClientRect(), x0 = Math.max(0, r.left), y0 = Math.max(0, r.top), x1 = Math.min(innerWidth, r.right), y1 = Math.min(innerHeight, r.bottom);
  if (x1 - x0 < 2 || y1 - y0 < 2) return { ok: false, why: 'outside the window' };
  const was = e.style.pointerEvents; e.style.pointerEvents = 'auto';
  const top = document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2);
  e.style.pointerEvents = was;
  if (!top || !(top === e || e.contains(top))) return { ok: false, why: `covered by ${top?.id || top?.className || top?.tagName}` };
  return { ok: true, text: e.innerText, rect: [x0, y0, x1, y1] };
}, sel);
// an element's text in each frame the window painted it (requestAnimationFrame runs once a frame, just before it's
// drawn; drawn as \`seen\` has it): a screen that's up for less than this test's polling still counts if it was painted
const recordTexts = (P, sel) => P.evaluate(sel => {
  const g = globalThis as any; g.__texts ??= {}; const log = g.__texts[sel] = [];
  const drawn = e => {
    for (let x = e; x; x = x.parentElement) { const c = getComputedStyle(x); if (c.display === 'none' || c.visibility === 'hidden' || Number(c.opacity) === 0) return false; }
    const r = e.getBoundingClientRect(), x0 = Math.max(0, r.left), y0 = Math.max(0, r.top), x1 = Math.min(innerWidth, r.right), y1 = Math.min(innerHeight, r.bottom);
    if (x1 - x0 < 2 || y1 - y0 < 2) return false;
    const was = e.style.pointerEvents; e.style.pointerEvents = 'auto';
    const top = document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2);
    e.style.pointerEvents = was;
    return !!top && (top === e || e.contains(top));
  };
  const frame = () => { const e = document.querySelector(sel), t = e && drawn(e) ? e.textContent : null; if (t && t !== log.at(-1)?.t) log.push({ t, at: performance.now() }); requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
}, sel);
const textsPainted = (P, sel) => P.evaluate(sel => (globalThis as any).__texts?.[sel] ?? [], sel);
const shown = (P, sel, ms) => until(async () => { const s = await seen(P, sel); return s.ok ? s : null; }, ms, 100);
// its pixels in a screenshot: how many look like colour c ([r, g, b], within tol), and how many distinct colours
async function pixels(P, rect, c = null, tol = 70) {
  const [x0, y0, x1, y1] = rect, buf = await P.screenshot({ clip: { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) } });
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  let match = 0; const colours = new Set();
  for (let i = 0; i < data.length; i += info.channels) {
    colours.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
    if (c && Math.abs(data[i] - c[0]) + Math.abs(data[i + 1] - c[1]) + Math.abs(data[i + 2] - c[2]) < tol) match++;
  }
  return { match, colours: colours.size, total: data.length / info.channels };
}
const state = P => P.evaluate(() => { const S = (globalThis as any).__krMpS, R = (globalThis as any).__krMpRace; return S ? { phase: S.phase, raceId: S.raceId, myUid: S.myUid, roomId: S.lobby?.roomId ?? null, race: R?.state ?? null, watching: R?.watching ?? null, code: S.lobby?.code ?? null } : null; });
// (what a window's race is doing — for the details when a check fails)
const diag = P => P.evaluate(async () => {
  const { debug } = await import('/testtrack/test-scene.js'), w = debug.active, R = (globalThis as any).__krMpRace, S = (globalThis as any).__krMpS, r = R?.run;
  const p = w?.sim.vehicle.body.translation();
  return JSON.stringify({ phase: S?.phase, race: R?.state, progress: R?.progress, err: r?.error, released: r?.released, Q: r?.Q?.state.state, slot: r?.slot, me: S?.me && { role: S.me.role, slot: S.me.slot, status: S.me.status }, spawning: w?.spawning, held: !!w?.held, pinned: w?.pinned, simT: w?.sim.time?.toFixed(1), pos: p && [p.x, p.y, p.z].map(x => Math.round(x)), fps: Math.round((globalThis as any).__krFps ?? 0), auto: R?.auto });
}).catch(e => `(no answer: ${e.message})`);
const click = async (P, sel) => { await P.locator(sel).first().click({ timeout: 60000 }); };
const shot = async (P, name) => { if (process.env.MP_SHOTS) await P.screenshot({ path: `${process.env.MP_SHOTS}/browser-race-${name}.png` }).catch(() => {}); };
// the other cars drawn in a window's 3D view (as play/multiplayer.js made them): visible, in the scene, on screen
const carsDrawn = P => P.evaluate(async () => {
  const { debug } = await import('/testtrack/test-scene.js'), THREE = await import('three'), w = debug.active, S = debug.shared;
  if (!w) return [];
  const out = [];
  for (const v of S.visuals ?? []) {
    if (v === w.carVis || !v.fixedPaint || !v.group.visible) continue;
    let root = v.group; while (root.parent) root = root.parent;
    const c = new THREE.Box3().setFromObject(v.group).getCenter(new THREE.Vector3()), ndc = c.clone().project(w.camera);
    out.push({ inScene: root === w.scene, onScreen: Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z < 1, ndc: [ndc.x, ndc.y] });
  }
  return out;
});

try {
  section('Setup: two windows on the real world, as Player A and Player B');
  // (they drive with the autopilot once it's GO: ?mpauto)
  // (?view=600: the world loaded 600 m round the car, not 1.4 km — drawn in software, the city is slow)
  const extra = process.env.MP_QUERY ? `&${process.env.MP_QUERY}` : '';
  await A.goto(`${BASE}/?mp&player=A&mpauto&view=600${extra}`); await B.goto(`${BASE}/?mp&player=B&mpauto&view=600${extra}`);
  const up = await until(async () => (await Promise.all([A, B].map(P => P.evaluate(() => !!(globalThis as any).__krMpS?.hubConn)))).every(Boolean), 300000, 1000);
  check('each window is online for races (the hub joined)', !!up);
  for (const P of [A, B]) await recordTexts(P, '#mpResults h2');
  // (not signed in to the site: the welcome asks — a person picks "Just drive", as here — and the Multiplayer button
  // is then there to click)
  for (const P of [A, B]) { const b = P.locator('[data-k="later"]'); if (await b.isVisible().catch(() => false)) await b.click(); }
  const btn = await Promise.all([A, B].map(P => until(async () => { const s = await seen(P, '#mpButton'); return s.ok ? s : null; }, 20000)));
  check('the Multiplayer button drawn in each window', btn.every(Boolean), btn.map((s, i) => s ? '' : `${'AB'[i]}: missing`).join(' '));
  const fps = () => Promise.all([A, B].map(P => P.evaluate(() => { const g = globalThis as any; return g.__krMpFrameMs ? (1000 / g.__krMpFrameMs).toFixed(1) : Math.round(g.__krFps ?? 0); })));
  console.log(`  (frames a second: ${(await fps()).join(', ')})`);

  let crew: any[] = [];
  if (!QUICK_ONLY) {
  // ---------- 1. the menu, a private lobby, the code ----------
  section('1. The lobby: a private lobby, joined with its code; chat');
  await A.bringToFront(); await click(A, '#mpButton');
  const menuA = await until(async () => { const s = await seen(A, '#mpMenu'); return s.ok && /Quick race/.test(s.text) ? s : null; }, 15000);
  check('the Multiplayer button opens the menu, drawn', !!menuA, menuA ? 'Quick race · Private lobby · Custom lobby · Join with a code · Lobbies · Friends · Party' : (await seen(A, '#mpMenu')).why);
  await click(A, '#mpMenu [data-private]');
  const lobbyA = await until(async () => { const s = await seen(A, '#mpLobby [data-code]'); return s.ok && /^[A-Z0-9]{6}$/.test(s.text.trim()) ? s : null; }, 20000);
  const code = lobbyA?.text.trim(), stA = await state(A), server = stA?.roomId ? raceOf(stA.roomId) : null;
  check('a private lobby: its screen drawn, with the invite code the server gave it', !!lobbyA && server?.code === code, `code ${code ?? '—'} on screen, ${server?.code ?? '—'} on the server`);
  // (the test's own short route, and one lap: the host's settings — then the screen must say so)
  await A.evaluate(id => (globalThis as any).__krMpS.send({ t: 'settings', settings: { venue: { kind: 'route', id }, laps: 1 } }), ROUTE.id);
  const venueA = await until(async () => { const s = await seen(A, '#mpLobby [data-venue]'); return s.ok && s.text.includes(ROUTE.name) ? s : null; }, 15000);
  check('the host\'s venue on the lobby screen', !!venueA, venueA?.text ?? (await seen(A, '#mpLobby [data-venue]')).text);
  await B.bringToFront(); await B.keyboard.press('F7');
  await until(async () => (await seen(B, '#mpMenu [data-code]')).ok, 15000);
  await B.locator('#mpMenu [data-code]').fill(code ?? '');
  await click(B, '#mpMenu [data-joincode]');
  const both = await until(async () => {
    const [a, b] = [await seen(A, '#mpLobby [data-players]'), await seen(B, '#mpLobby [data-players]')];
    return a.ok && b.ok && /Player A/.test(a.text) && /Player B/.test(a.text) && /Player A/.test(b.text) && /Player B/.test(b.text) ? [a, b] : null;
  }, 30000);
  check('B joins with the code (typed in, Join clicked): both lobby screens list both players', !!both, both ? both.map(x => x.text.split('\n').filter(l => /Player/.test(l)).join(' | ')).join(' ‖ ') : `A: ${(await seen(A, '#mpLobby [data-players]')).why ?? 'no B'} · B: ${(await seen(B, '#mpLobby [data-players]')).why ?? 'no A'}`);
  const roomId = stA.roomId, R0 = raceOf(roomId);
  // bots in the empty places (by the lobby's id), ready
  crew = await bots(3); (globalThis as any).__crew = crew;
  for (const x of crew) { await x.session.joinLobby(roomId); x.session.send({ t: 'ready', v: true }); }
  const five = await until(async () => { const s = await seen(A, '#mpLobby [data-players]'); return s.ok && crew.every(x => s.text.includes(x.name)) ? s : null; }, 20000);
  const rows = five?.text.split('\n').filter(l => /Player|Bot/.test(l)) ?? [];
  // (each row: the car and its class, ready or not, the rank — as the server has them)
  const viewOk = !!five && R0.lobbyView().players.filter(p => p.role === 'racer').every(p => { const row = rows.find(l => l.includes(p.name)); return row && row.includes(p.car?.name ?? '§') && (p.ready ? /\bReady\b/.test(row) : /Not ready/.test(row)) && row.includes(p.tier?.name ?? '§'); });
  check('the lobby screen: each player with their car and class, ready or not, and rank — as the server has them', viewOk, rows.join(' | '));
  // (and nothing of a race over it: no lights, no race HUD, no results)
  const stray = [];
  for (const [n, P] of [['A', A], ['B', B]]) for (const sel of ['#mpLights', '#mpHud', '#mpResults', '#mpLoading']) if ((await seen(P, sel)).ok) stray.push(`${n} ${sel}`);
  check('in the lobby, none of the race\'s screens drawn (lights, HUD, results, loading)', !stray.length, stray.join(', ') || 'none');
  // (and free roam still on underneath, as it was: the lobby's room isn't another tab of the same account)
  const roam = [];
  for (const [n, P] of [['A', A], ['B', B]]) { const b = await seen(P, '#krMpBanner'); roam.push({ n, banner: b.ok ? b.text : null, status: await P.evaluate(() => (globalThis as any).__krMp?.net.status ?? null) }); }
  check('in the lobby, free roam still online in each window (no disconnected banner drawn)', roam.every(x => !x.banner && x.status === 'online'), roam.map(x => `${x.n}: ${x.status}${x.banner ? ` · “${x.banner}”` : ''}`).join(' · '));
  // chat: the filter, then a mute
  await A.bringToFront();
  await A.locator('#mpLobby [data-chat]').fill('hello you shit drivers'); await A.locator('#mpLobby [data-chat]').press('Enter');
  // (B scrolls down to the chat, as a person would: in a window this small the lobby's columns stack)
  // (scrolled to each time: the window is small, and the lobby redraws as players come and go)
  const chatB = await until(async () => { await B.locator('#mpLobby [data-chatlog]').scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {}); const s = await seen(B, '#mpLobby [data-chatlog]'); return s.ok && /hello you \*+ drivers/.test(s.text) ? s : null; }, 10000);
  check('chat: A\'s message drawn in B\'s lobby, the swear word starred out', !!chatB, chatB?.text.split('\n').at(-1) ?? `B's log: ${(x => x.ok ? JSON.stringify(x.text) : x.why)(await seen(B, '#mpLobby [data-chatlog]'))} · B's session: ${await B.evaluate(() => { const S = (globalThis as any).__krMpS; return JSON.stringify({ chat: S.chat.map((m: any) => m.text), muted: [...S.muted], phase: S.phase, notices: S.notices.slice(-3) }); })} · the server: ${JSON.stringify({ chat: R0.chat.map((m: any) => m.text), players: [...R0.players.values()].map((p: any) => `${p.t.name}:${p.client.sessionId}`) })}`);
  await B.bringToFront();
  await click(B, `#mpLobby [data-who="${stA.myUid}"]`); await click(B, '#mpLobby [data-mute]');
  await A.bringToFront();
  await A.locator('#mpLobby [data-chat]').fill('can you hear me'); await A.locator('#mpLobby [data-chat]').press('Enter');
  await sleep(1500);
  for (const P of [A, B]) await P.locator('#mpLobby [data-chatlog]').scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
  const muted = await seen(B, '#mpLobby [data-chatlog]'), mineA = await seen(A, '#mpLobby [data-chatlog]');
  check('a mute: B no longer sees A\'s messages (A still does)', muted.ok && !/can you hear me/.test(muted.text) && /can you hear me/.test(mineA.text ?? ''), `B: ${JSON.stringify(muted.text?.split('\n').slice(-2))}`);
  await shot(A, '1-lobby-A'); await shot(B, '1-lobby-B');
  // ready, and the host starts it (clicks)
  await click(B, '#mpLobby button[data-ready]'); await A.bringToFront(); await click(A, '#mpLobby button[data-ready]');
  const readyAll = await until(async () => { const s = await seen(A, '#mpLobby [data-players]'); return s.ok && !/Not ready/.test(s.text) ? s : null; }, 10000);
  check('Ready clicked in both windows: everyone ready on the host\'s screen', !!readyAll, readyAll ? '' : (await seen(A, '#mpLobby [data-players]')).text);
  await A.bringToFront(); await click(A, '#mpLobby [data-start]');

  // ---------- 2. loading ----------
  section('2. Loading');
  const [loadA, loadB] = await Promise.all([shown(A, '#mpLoading', 20000), shown(B, '#mpLoading', 20000)]);
  check('the loading screen drawn in both windows, naming the route', !!loadA && !!loadB && loadA.text.includes(ROUTE.name) && loadB.text.includes(ROUTE.name), `${loadA?.text.split('\n').join(' / ') ?? 'A: none'} ‖ ${loadB?.text.split('\n')[0] ?? 'B: none'}`);
  await shot(A, '2-loading-A');
  // (the screencasts, from here through the countdown)
  const screencast = async P => {
    const cdp = await P.context().newCDPSession(P), frames: any[] = [];
    cdp.on('Page.screencastFrame', async (f: any) => { frames.push({ at: f.metadata.timestamp * 1000, data: f.data, meta: f.metadata }); if (frames.length > 600) frames.shift(); try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch { /* stopped */ } });
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
    return { frames, stop: async () => { try { await cdp.send('Page.stopScreencast'); } catch { /* gone */ } await cdp.detach().catch(() => {}); } };
  };
  const [castA, castB] = await Promise.all([screencast(A), screencast(B)]);

  // ---------- 3. the countdown ----------
  const R = raceOf(roomId);
  // (the runs are checked in a moment here — about a frame, drawn in software: the race server's confirmation held
  // back, as if the checks were slow, until both windows have painted the provisional results; then let through)
  let holdConfirm = true;
  { const poll = R.pollResults; R.pollResults = function (...a) { return holdConfirm ? Promise.resolve() : poll.apply(this, a); }; }
  const hudOk = async (P, who) => {
    const s = await seen(P, '#mpHud'), st = await state(P);
    if (!s.ok || !st) return null;
    const list = R.race.standings(R.raceNow), me = list.find(x => x.pid === st.myUid);
    const pos = s.text.match(/(\d+)(st|nd|rd|th)\s*\/\s*(\d+)/);
    // (the standings' rows as drawn — the HUD is on screen: seen above)
    const names = (await P.evaluate(() => [...document.querySelectorAll('#mpHud [data-standings] tr')].map(tr => tr.cells[1]?.innerText.replace(/ ⚠$/, '').trim()))).map(n => n === 'You' ? who : n);
    const want = list.map(x => x.name);
    return pos && me && Number(pos[1]) === me.place && Number(pos[3]) === list.length && names.join('|') === want.join('|') ? { text: s.text, place: me.place, names } : null;
  };
  section('3. The countdown: the lights on the server\'s clock');
  // (what each window paints, frame by frame — Chrome's screencast: a page drawing a frame a second takes longer to
  // screenshot than the lights are lit). The lights' place, once they're up; then in every frame painted, how much of
  // it is the lights' red, or their green
  const lightsRect = P => until(async () => P.evaluate(() => { const e = document.getElementById('mpLights'), c = e && getComputedStyle(e), r = e?.getBoundingClientRect(); return e && c.display !== 'none' && r.width > 2 ? [r.left, r.top, r.right, r.bottom, innerWidth] : null; }), 180000, 100);
  const [rectA, rectB] = await Promise.all([lightsRect(A), lightsRect(B)]);
  const outAt = await until(async () => { const v = await Promise.all([A, B].map(P => P.evaluate(() => (globalThis as any).__krMpLightsOut ?? null))); return v.every(Boolean) ? v : null; }, 30000, 200);
  await sleep(4000);                                                  // (the green for a moment after GO, then gone)
  const paint = async (cast, rect) => {
    const out = { red: 0, green: 0, firstGreenAt: null as number | null, frames: cast.frames.length };
    if (!rect) return out;
    for (const f of cast.frames) {
      const img = sharp(Buffer.from(f.data, 'base64')), { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
      const k = info.width / rect[4], x0 = Math.floor(rect[0] * k), y0 = Math.floor((rect[1] - (f.meta.offsetTop ?? 0)) * k), x1 = Math.ceil(rect[2] * k), y1 = Math.ceil((rect[3] - (f.meta.offsetTop ?? 0)) * k);
      let red = 0, green = 0;
      for (let y = Math.max(0, y0); y < Math.min(info.height, y1); y++) for (let x = Math.max(0, x0); x < Math.min(info.width, x1); x++) {
        const i = (y * info.width + x) * info.channels, R = data[i], G = data[i + 1], B = data[i + 2];
        if (R > 200 && G < 110 && B < 100) red++; else if (G > 170 && R < 130 && B < 150) green++;
      }
      if (red > 150) out.red++;
      if (green > 100 && red < 50) { out.green++; out.firstGreenAt ??= f.at; }
    }
    return out;
  };
  const [PA, PB] = [await paint(castA, rectA), await paint(castB, rectB)];
  await castA.stop(); await castB.stop();
  check('the red lights drawn in both windows (in the frames they painted), then out', PA.red > 0 && PB.red > 0, `A: ${PA.red} frames with the red lights of ${PA.frames} painted · B: ${PB.red} of ${PB.frames}`);
  await shot(A, '3-lights-A');
  const outs = await until(async () => { const v = await Promise.all([A, B].map(P => P.evaluate(() => { const g = globalThis as any; return g.__krMpLightsOut ? { out: g.__krMpLightsOut, aim: g.__krMpLightsAim, frameMs: g.__krMpFrameMs ?? 1000 / Math.max(1, g.__krFps ?? 60) } : null; }))); return v.every(x => x) ? v : null; }, 20000, 100);
  const greenA = PA.green && PB.green ? { match: Math.min(PA.green, PB.green) } : null;
  void outAt;
  // (each window's clock against the server's: when it aimed to put the lights out; then that it did, within a frame —
  // a page drawing a few frames a second can't change them any sooner)
  const serverGo = R.epoch + R.race.goAt, aims = (outs ?? []).map(o => o.aim - serverGo), lags = (outs ?? []).map(o => o.out - o.aim);
  const painted = [PA, PB].map(p => p.firstGreenAt != null ? p.firstGreenAt - serverGo : null);
  check('lights out: in each window, timed to the server\'s goAt within a few ms, put out within a frame of it, and the green painted', !!outs && aims.every(d => Math.abs(d) < 10) && outs.every((o, i) => lags[i] >= -1 && lags[i] < o.frameMs * 1.5 + 20) && !!greenA,
    outs ? outs.map((o, i) => `${'AB'[i]}: aimed ${aims[i].toFixed(1)} ms from the server's, out ${lags[i].toFixed(1)} ms after (a frame: ${o.frameMs.toFixed(0)} ms), green on screen ${painted[i] != null ? `${painted[i].toFixed(0)} ms after GO` : 'never'}`).join(' · ') : 'never went out');
  console.log(`  (frames a second: ${(await fps()).join(', ')})`);

  // ---------- 4. the race ----------
  section('4. The race: live positions, the other cars');
  // each window's HUD: its own place as the server has it, the standings in the server's order
  const [hudA, hudB] = await Promise.all([until(() => hudOk(A, 'Player A'), 150000, 300), until(() => hudOk(B, 'Player B'), 150000, 300)]);
  if (!hudA || !hudB) console.log(`  (A: ${await diag(A)})\n  (B: ${await diag(B)})`);
  check('the race HUD in each window: its own place, and the standings in the server\'s order', !!hudA && !!hudB, hudA && hudB ? `A ${hudA.place}${['st', 'nd', 'rd'][hudA.place - 1] ?? 'th'}, B ${hudB.place}${['st', 'nd', 'rd'][hudB.place - 1] ?? 'th'} · ${hudA.names.join(', ')}` : `A: ${(await seen(A, '#mpHud')).text ?? (await seen(A, '#mpHud')).why} · server: ${R.race.standings(R.raceNow).map(x => `${x.place}. ${x.name}`).join(', ')}`);
  await shot(A, '4-race-A'); await shot(B, '4-race-B');
  // (in each window's scene; and in front of the camera, in the picture, in at least one — the leader's are behind it)
  const drawnAB = await until(async () => { const c = [await carsDrawn(A), await carsDrawn(B)]; return c.every(x => x.filter(y => y.inScene).length >= 2) && c.some(x => x.some(y => y.inScene && y.onScreen)) ? c : null; }, 30000);
  check('the other cars drawn in each window\'s 3D view (the other player\'s and the bots\'), and in the picture', !!drawnAB, drawnAB ? drawnAB.map((c, i) => `${'AB'[i]}: ${c.length} cars, ${c.filter(x => x.onScreen).length} on screen`).join(' · ') : `${(await carsDrawn(A)).length} and ${(await carsDrawn(B)).length} drawn`);
  console.log(`  (15 s in: A ${await diag(A)})\n  (B ${await diag(B)})`);

  // ---------- 5. the results ----------
  section('5. The results: provisional, then confirmed; the podium; a rematch');
  // (the runs are often checked within a second or two: what each window painted, frame by frame — see recordTexts)
  const prov = await until(async () => { const t = await Promise.all([A, B].map(P => textsPainted(P, '#mpResults h2'))); return t.every(x => x.some(y => /provisional/i.test(y.t))) ? t : null; }, 300000, 500);
  check('the results screen drawn as soon as the race ends, marked provisional (in both windows)', !!prov, prov ? prov.map((t, i) => `${'AB'[i]}: ${t.map(x => x.t.trim()).join(' → ')}`).join(' · ') : `A ${JSON.stringify(await textsPainted(A, '#mpResults h2'))} · B ${JSON.stringify(await textsPainted(B, '#mpResults h2'))} · ${(await seen(A, '#mpResults')).why ?? 'drawn'} · ${await diag(A)}`);
  holdConfirm = false;
  await shot(A, '5-provisional-A');
  const conf = await until(async () => { const s = await seen(A, '#mpResults h2'); return s.ok && /confirmed/i.test(s.text) ? s : null; }, 120000, 500);
  const view = conf ? await app.mp.raceView((await state(A)).raceId) : null;
  const tableA = await seen(A, '#mpResults [data-results]'), tableB = await seen(B, '#mpResults [data-results]');
  const order = view?.confirmed?.map(r => r.name) ?? [];
  const rowsOf = (t, who) => (t.text ?? '').split('\n').filter(l => /^\d+\./.test(l.trim())).map(l => l.replace(/^\d+\.\s*/, '').replace(/^You/, who));
  const rA = rowsOf(tableA, 'Player A'), rB = rowsOf(tableB, 'Player B');
  const inOrder = rows => order.length && rows.length === order.length && order.every((n, i) => rows[i].startsWith(n));
  const payOk = view?.confirmed?.every(r => r.npc || !r.pay?.money || rA.find(l => l.startsWith(r.name))?.includes(r.pay.money.toLocaleString('en-GB')));
  check('confirmed: both windows show the table in the server\'s confirmed order, each finisher\'s pay on it', !!conf && tableA.ok && tableB.ok && inOrder(rA) && inOrder(rB) && !!payOk, conf ? `${rA.join(' | ')}` : 'never confirmed');
  const runs = view?.confirmed?.filter(r => /^Player/.test(r.name)) ?? [];
  check('A\'s and B\'s own runs (timed by the game on the server\'s clock) pass the check: both confirmed finishers', runs.length === 2 && runs.every(r => r.status === 'finished'), runs.map(r => `${r.name} ${r.status}${r.problems?.length ? ` (${r.problems[0]})` : ''}`).join(', '));
  const pod = await seen(A, '#mpResults [data-podium]'), top3 = view?.confirmed?.filter(r => r.status === 'finished').slice(0, 3).map(r => r.name) ?? [];
  const podNames = (pod.text ?? '').split('\n').map(l => l.replace(/^\d\.\s*/, '').replace(/^You$/, 'Player A'));
  check('the podium: the top three, drawn', pod.ok && top3.length === 3 && top3.every(n => podNames.includes(n)), pod.ok ? `${pod.text.split('\n').join(' · ')}` : pod.why);
  const tierA = await seen(A, '#mpResults [data-mytier]'), mine = view?.confirmed?.find(r => r.name === 'Player A');
  check('A\'s rank change and pay shown, as the server confirmed them', tierA.ok && !!mine && tierA.text.includes(mine.rank.after.name) && (!mine.pay?.money || tierA.text.includes(mine.pay.money.toLocaleString('en-GB'))), tierA.text ?? tierA.why);
  // (Phase 7 Step 5) "Add friend" on the results: on each person's row but your own, none on an NPC's; clicked, "Request sent"
  const fr = await A.evaluate(() => [...document.querySelectorAll('#mpResults [data-results] tr[data-uid]')].map(tr => ({ uid: tr.getAttribute('data-uid'), name: tr.children[1]?.textContent ?? '', add: !!tr.querySelector('[data-befriend]') })));
  const botRow = fr.find(r => /^Bot/.test(r.name)), addOk = !!botRow?.add && fr.filter(r => /NPC/.test(r.name) || r.name === 'You').every(r => !r.add);
  if (botRow?.add) { await A.bringToFront(); await click(A, `#mpResults tr[data-uid="${botRow.uid}"] [data-befriend]`); }
  const sent = botRow?.add ? await until(async () => { const s = await seen(A, `#mpResults tr[data-uid="${botRow.uid}"] [data-sent]`); return s.ok ? s : null; }, 10000, 200) : null;
  const asked = botRow ? await until(async () => (await app.mp.friends(botRow.uid)).friends.find(x => x.name === 'Player A')?.status === 'incoming', 10000, 300) : null;
  check('the results: "Add friend" on each person\'s row (not yours, not an NPC\'s); clicked, it says "Request sent" and the request is made', addOk && !!sent && !!asked, `${fr.map(r => `${r.name.trim()}${r.add ? ' [Add friend]' : ''}`).join(' | ')} · after: ${sent?.text ?? 'no "Request sent"'} · the bot has the request: ${!!asked}`);
  await shot(A, '5-confirmed-A'); await shot(B, '5-confirmed-B');
  // the rematch: A and B vote (clicks), with a bot: back to the lobby screen
  await A.bringToFront(); await click(A, '#mpResults [data-rematch]'); await B.bringToFront(); await click(B, '#mpResults [data-rematch]');
  crew[0].session.send({ t: 'rematch', v: true });
  const backA = await until(async () => { const s = await seen(A, '#mpLobby [data-players]'); return s.ok ? s : null; }, 15000), backB = await until(async () => { const s = await seen(B, '#mpLobby [data-players]'); return s.ok ? s : null; }, 15000);
  check('a rematch voted for (clicked): both windows back on the lobby screen, together, nothing of the race left over it', !!backA && !!backB && /Player B/.test(backA.text) && /Player A/.test(backB.text), backA && backB ? '' : `A: ${(await seen(A, '#mpLobby [data-players]')).why} · B: ${(await seen(B, '#mpLobby [data-players]')).why}`);
  await shot(A, '5-rematch-A');

  // ---------- 6. the rematch, B watching ----------
  section('6. The rematch: B watches instead');
  await B.bringToFront(); await click(B, '#mpLobby [data-spectate]');
  for (const x of crew) x.session.send({ t: 'ready', v: true });
  await A.bringToFront(); await click(A, '#mpLobby button[data-ready]'); await click(A, '#mpLobby [data-start]');
  // the watching bar names a car; the camera is on that car
  const watchB = await until(async () => { const s = await seen(B, '#mpWatch [data-watching]'), st = await state(B); return s.ok && st?.watching?.id != null ? { s, st } : null; }, 240000, 1000);
  const onCar = async () => B.evaluate(async () => {
    const { debug } = await import('/testtrack/test-scene.js'), THREE = await import('three'), w = debug.active, R = (globalThis as any).__krMpRace, id = R.watching?.id, c = R.drawn?.car(id);
    if (!c?.handle) return null;
    const g = c.handle.vis.group, p = new THREE.Box3().setFromObject(g).getCenter(new THREE.Vector3()).project(w.camera);
    return { name: c.name, ndc: [p.x, p.y, p.z], dist: w.camera.position.distanceTo(g.position) };
  });
  const v1 = watchB ? await until(async () => { const o = await onCar(); return o && Math.abs(o.ndc[0]) < 0.6 && Math.abs(o.ndc[1]) < 0.8 && o.ndc[2] < 1 && o.dist < 20 ? o : null; }, 20000) : null;
  check('B watching (Watch instead, in the lobby): the bar says whose car, and the chase camera is on that car', !!v1 && watchB.s.text.includes(v1.name), watchB ? `${watchB.s.text} · that car ${v1 ? `on screen at (${v1.ndc[0].toFixed(2)}, ${v1.ndc[1].toFixed(2)}), ${v1.dist.toFixed(1)} m away` : 'not on screen'}` : `B: ${(await seen(B, '#mpWatch')).why} · ${await diag(B)}`);
  await shot(B, '6-watching-B');
  await B.bringToFront(); await B.keyboard.press('ArrowRight');
  const v2 = await until(async () => { const s = await seen(B, '#mpWatch [data-watching]'), o = await onCar(); return s.ok && o && o.name !== v1?.name && s.text.includes(o.name) ? { s, o } : null; }, 8000);
  check('→ switches to another car: the bar and the camera follow it', !!v2, v2 ? `${v1?.name} → ${v2.s.text}` : (await seen(B, '#mpWatch')).text);
  await B.keyboard.press('KeyC');
  const cam2 = await until(async () => { const s = await seen(B, '#mpWatch [data-camera]'), o = await onCar(); return s.ok && /In car/.test(s.text) && o && o.dist < 3 ? { s, o } : null; }, 8000);
  await B.keyboard.press('KeyC');
  const cam3 = await until(async () => { const s = await seen(B, '#mpWatch [data-camera]'), o = await onCar(); return s.ok && /TV/.test(s.text) && o && Math.abs(o.ndc[0]) <= 1 && Math.abs(o.ndc[1]) <= 1 ? { s, o } : null; }, 8000);
  check('B switches the camera: in the car, then a TV camera beside the route (the car still in view)', !!cam2 && !!cam3, `${cam2 ? `in car (${cam2.o.dist.toFixed(1)} m)` : 'no in-car view'} · ${cam3 ? `TV (${cam3.o.dist.toFixed(0)} m away)` : 'no TV view'}`);
  await shot(B, '6-tv-B');
  // (the race to its end, for the next part)
  if (!(await until(async () => (await state(A))?.phase === 'results', 300000, 1000))) console.log(`  (race 2 didn't end: A ${await diag(A)})\n  (server: ${JSON.stringify(R.race.standings(R.raceNow).map(x => [x.name, x.status, x.away]))})`);

  }

  // ---------- 7. a quick race ----------
  section('7. A quick race: both click Quick race');
  if (!QUICK_ONLY) for (const P of [A, B]) { await P.bringToFront(); await until(async () => (await seen(P, '#mpResults [data-leaveres]')).ok, 30000); await click(P, '#mpResults [data-leaveres]'); }
  else for (const P of [A, B]) { await P.bringToFront(); await click(P, '#mpButton'); }
  for (const x of crew) await x.session.close();
  for (const P of [A, B]) { await P.bringToFront(); await until(async () => (await seen(P, '#mpMenu [data-quick]')).ok, 15000); await click(P, '#mpMenu [data-quick]'); }
  const quick = await until(async () => { const [a, b] = [await state(A), await state(B)]; return a?.roomId && a.roomId === b?.roomId ? [a, b] : null; }, 60000);
  const qLoad = quick ? await Promise.all([shown(A, '#mpLoading', 30000), shown(B, '#mpLoading', 30000)]) : null;
  const why = async P => P.evaluate(() => { const S = (globalThis as any).__krMpS; return JSON.stringify({ phase: S.phase, room: S.lobby?.roomId ?? null, race: !!S.race, party: S.party?.id ?? null, notices: S.notices.slice(-4), toasts: document.querySelector('#mpToasts')?.textContent ?? '', menu: (document.querySelector('#mpMenu') as any)?.innerText?.split('\n').slice(0, 8).join(' / ') ?? '' }); });
  const queued = () => JSON.stringify(rt.queues().flatMap((q: any) => [...q.entries.values()].map((e: any) => ({ name: e.name, waited: Math.round((Date.now() - e.since) / 1000), pings: e.pings, party: e.party, ...e.player, uid: undefined }))));
  check('matched into one quick race, and its loading screen drawn in both windows', !!quick && !!qLoad?.[0] && !!qLoad?.[1], quick ? `${raceOf(quick[0].roomId)?.kind} race; ${qLoad?.[0] ? qLoad[0].text.split('\n')[0] : 'no loading screen'}` : `not matched · A ${await why(A)} · B ${await why(B)} · the queue: ${queued()} · races on the server: ${rt.races().map((r: any) => `${r.kind}:${[...r.players.values()].map((p: any) => p.t.name).join('+')}`).join(', ')}`);
  const qLights = await until(async () => { const s = await seen(A, '#mpLights'); return s.ok ? s : null; }, 180000, 100);
  check('the quick race reaches its countdown: the lights drawn', !!qLights);

  check('no errors on the pages', errors.length === 0, errors.slice(0, 3).map(e => `${e} ×${errorCounts.get(e)}`).join(' | '));
} catch (e: any) {
  check('ran to the end', false, e.stack ?? e.message);
} finally {
  if (process.env.MP_SHOTS) for (const [n, P] of Object.entries(pages)) await P.screenshot({ path: `${process.env.MP_SHOTS}/browser-race-end-${n}.png` }).catch(() => {});
  await browser.close(); await rt.stop(); await app.close(); await database.drop();
}
if (results.some(r => !r)) { console.log(`\n(the real-time server's warnings:\n${rtLog.slice(-20).join('\n') || 'none'})`); console.log(`(the bots: ${(globalThis as any).__crew?.map((x: any) => x.bot.log.slice(-4).join(' | ')).join('\n  ') ?? '—'})`); }
const failed = results.filter(r => !r).length, summary = failed ? `${failed} of ${results.length} failed` : `${results.length} of ${results.length} ok`;
fs.mkdirSync(path.join(REPO_DIR, 'reports'), { recursive: true });
fs.writeFileSync(path.join(REPO_DIR, 'reports/mp-browser-race.md'), `# Multiplayer races in the browser\n\n${new Date().toISOString()}. ${summary}. One real-time process, no Redis.\n${lines.join('\n')}\n`);
console.log(`\n${summary}`);
process.exit(failed ? 1 : 0);
