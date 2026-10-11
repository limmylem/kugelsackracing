// Gameplay footage for the devlog video (DEVLOG.md). The game opens in a headless Chromium at phone size (540×960
// CSS pixels at 2× = 1080×1920), drops into a generated race track and lets the game's own autopilot drive the lap
// (the route test drive's autopilot: play/testDrive.js). Optionally a second car joins the same multiplayer room and
// drives the same lap a little ahead, so the other car on screen is a real online player.
//
// Frame by frame, not in real time: GitHub's runners have no GPU and the game draws a frame a second or so in
// software. So the page's requestAnimationFrame is taken over (an init script below — nothing in the game changes):
// each step advances the game exactly 1/fps of a second, the frame is screenshotted and piped into ffmpeg. The
// footage is smooth at any speed of machine. The game's own interface is hidden by CSS injected from here (a
// "recording mode" with no change to the game).
//
//   node capture/capture.mjs [--target local|live] [--shots capture/shots.json] [--out out/clips]
//                            [--multiplayer] [--fps 30] [--quick] [--max-seconds n]
//
//   --target local   (default) this checkout: tools/serve.mjs serves the game; with --multiplayer a real-time server
//                    runs in this process (server/src/rt/server.ts) and the join tickets are signed here
//   --target live    https://ognistrada.com, as a signed-out visitor. With --multiplayer both cars join one private
//                    room ("devlog@…") on the live real-time server with load-test tickets ("Bot <n>", no account,
//                    nothing counted — server/src/routes/rt.ts): needs LOADTEST_TOKEN in the environment. Never an
//                    account of anyone's, and never the admin's.
//   --quick          a short test run: every shot a second long (or --max-seconds), at 15 fps and half the size
//
// Writes <out>/<shot>.mp4 for each shot and <out>/clips.json (what was captured: names, lengths, size).
// Needs the game's own packages (npm ci at the repository's root: three.js and Rapier are served from there in local
// mode) and this folder's (npm ci in devlog/).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ffmpegCommand } from '../lib/ffmpeg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), DEVLOG = path.resolve(HERE, '..'), ROOT = path.resolve(DEVLOG, '..');
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; }, flag = n => args.includes(n);
const TARGET = opt('--target', process.env.DEVLOG_TARGET || 'local');
const QUICK = flag('--quick');
const FPS = +opt('--fps', QUICK ? 15 : 30);
const MAX_SECONDS = +opt('--max-seconds', QUICK ? 1 : 60);
const OUT = path.resolve(opt('--out', path.join(DEVLOG, 'out/clips')));
const SHOTS = JSON.parse(fs.readFileSync(path.resolve(opt('--shots', path.join(HERE, 'shots.json'))), 'utf8'));
const MULTI = flag('--multiplayer') || SHOTS.multiplayer === true;
const LIVE_GAME = opt('--game', 'https://ognistrada.com'), LIVE_API = opt('--api', 'https://api.ognistrada.com');
const PORT = 7781, RT_PORT = 2781;
if (!['local', 'live'].includes(TARGET)) { console.error('--target local or --target live'); process.exit(2); }
if (TARGET === 'live' && MULTI && !process.env.LOADTEST_TOKEN) {
  console.error('Multiplayer on the live site needs LOADTEST_TOKEN (the load test\'s token: DEVLOG.md). Leave out --multiplayer to film one car.');
  process.exit(2);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = s => console.log(`[${(performance.now() / 1000).toFixed(0).padStart(4)}s] ${s}`);
fs.mkdirSync(OUT, { recursive: true });

// ---------- the browser ----------
let chromium;
try { ({ chromium } = await import('playwright')); } catch { console.error('Run npm ci in devlog/ first (Playwright).'); process.exit(2); }
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  // (software WebGL: GitHub's runners have no GPU)
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
    ...(process.env.DEVLOG_NO_PROXY ? ['--no-proxy-server'] : [])],
});

// The page's animation frames, on our clock: window.__devlog.start() hands them over, step(ms) runs one frame at
// a time later by ms. (Before start() the game runs as usual: loading, building the track.)
const VIRTUAL_FRAMES = () => {
  const realRAF = window.requestAnimationFrame.bind(window), realCancel = window.cancelAnimationFrame.bind(window);
  let on = false, now = 0, seq = 0;
  const queue = new Map();
  window.requestAnimationFrame = cb => { if (!on) return realRAF(cb); const id = -(++seq); queue.set(id, cb); return id; };
  window.cancelAnimationFrame = id => (id < 0 ? queue.delete(id) : realCancel(id));
  window.__devlog = {
    start() { if (!on) { on = true; now = performance.now(); } return now; },
    step(ms) {
      now += ms;
      // (the game sets its last-frame time from the real clock now and then — a reset, a new car — and the real clock
      // runs ahead of ours: brought back, or the game would wait for our clock to catch up)
      const s = window.__devlogShared?.();
      if (s && s.last > now) s.last = now - ms;
      const cbs = [...queue.values()];
      queue.clear();
      for (const cb of cbs) { try { cb(now); } catch (e) { console.error(e); } }
      return cbs.length;
    },
  };
};
// "Recording mode": everything but the 3D view hidden (and, if wanted, the names over the other cars)
const RECORDING_CSS = names => `
  body * { visibility: hidden !important; }
  canvas.devlog-view, .devlog-keep, .devlog-keep * { visibility: visible !important; }
  ${names ? '' : '.devlog-keep { display: none !important; }'}
  * { cursor: none !important; }`;

const nm = path.join(ROOT, 'node_modules');
let esbuild = null;
const bundles = new Map();
// local mode: the libraries the pages load from jsDelivr served from this checkout instead (the same versions, as the
// game's own browser tests do: server/tools/roam-browser.ts --local-libs)
async function localLibs(ctx) {
  esbuild ??= await import(path.join(nm, 'esbuild/lib/main.js'));
  const bundle = async pkg => bundles.get(pkg) ?? bundles.set(pkg, (await esbuild.build({ stdin: { contents: `export * from '${pkg}';${pkg === 'pbf' ? ` export { PbfReader as default } from 'pbf';` : ''}`, resolveDir: ROOT }, bundle: true, format: 'esm', write: false, logLevel: 'silent' })).outputFiles[0].text).get(pkg);
  await ctx.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', r => r.fulfill({ path: `${nm}/three/${new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', '')}`, contentType: 'text/javascript' }));
  await ctx.route('https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/**', r => r.fulfill({ path: `${nm}/@dimforge/rapier3d-compat/dist/rapier.mjs`, contentType: 'text/javascript' }));
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/(pbf|@mapbox\/vector-tile)@/, async r => r.fulfill({ body: await bundle(/pbf@/.test(r.request().url()) ? 'pbf' : '@mapbox/vector-tile'), contentType: 'text/javascript' }));
  await ctx.route('https://cdn.jsdelivr.net/npm/maplibre-gl@*/dist/**', r => { const f = new URL(r.request().url()).pathname.split('/dist/')[1]; return r.fulfill({ path: `${nm}/maplibre-gl/dist/${f}`, contentType: f.endsWith('.css') ? 'text/css' : 'text/javascript' }); });
  // (nothing else from outside: fonts fall back to the system's, the old map's servers aren't needed)
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|openfreemap|demotiles|cesium/, r => r.abort());
}

// ---------- the game's address, and the second car's room ----------
let server = null, rt = null, ticketFor = null;
const base = TARGET === 'live' ? LIVE_GAME.replace(/\/$/, '') : `http://localhost:${PORT}`;
if (TARGET === 'local') {
  server = spawn(process.execPath, [path.join(ROOT, 'tools/serve.mjs'), String(PORT)], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, HOST: '127.0.0.1' } });
  for (let k = 0; k < 50; k++) { if (await fetch(`${base}/index.html`).then(r => r.ok, () => false)) break; await sleep(200); }
  if (MULTI) {
    // a real-time server of our own, guests allowed; the tickets signed here with its secret (a made-up one)
    const secret = `devlog-local-${Math.random().toString(36).slice(2)}-${Date.now()}-0123456789abcdef`;
    const { startRt } = await import(path.join(ROOT, 'server/src/rt/server.ts'));
    const { signTicket } = await import(path.join(ROOT, 'server/src/rt/tickets.ts'));
    const { PROTOCOL } = await import(path.join(ROOT, 'net/protocol.js'));
    rt = await startRt({ port: RT_PORT, host: '127.0.0.1', redisUrl: null, secret, rt: { allowGuests: true, maxPlayers: 20, roomMaxClients: 16, netsim: false } });
    ticketFor = async (who, name) => ({ ticket: signTicket(secret, { uid: `devlog-${who}`, name, role: 'player', guest: true }, 60), url: `ws://localhost:${RT_PORT}`, protocol: PROTOCOL, expiresIn: 60 });
  }
} else if (MULTI) {
  // the load test's tickets (server/src/routes/rt.ts): made-up guests, no account. The token is only ever sent to the API.
  let n = 190;
  ticketFor = async () => {
    const r = await fetch(`${LIVE_API}/api/v1/rt/ticket`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID(), 'x-kr-loadtest': process.env.LOADTEST_TOKEN }, body: JSON.stringify({ bot: n++ }) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ticket) throw new Error(`no ticket from the live API (${r.status}): is LOADTEST_TOKEN right?`);
    return j;
  };
}

async function openGame({ who, width, height, scale, track, room, names }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, reducedMotion: 'no-preference' });
  if (TARGET === 'local') await localLibs(ctx);
  await ctx.addInitScript(VIRTUAL_FRAMES);
  // (the game asks the API for a join ticket for "player <who>": answered here — locally signed, or the live
  // load-test ticket — so neither car is anyone's account)
  if (ticketFor) await ctx.route(/\/api\/v1\/rt\/ticket$/, async r => {
    try { r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await ticketFor(who, who === 'rec' ? 'Ognistrada' : 'Rival')) }); }
    catch (e) { console.error(`  ticket: ${e.message}`); r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"OFFLINE","message":"no ticket"}}' }); }
  });
  // (locally there's no API: the CSRF token the game asks for before any request that writes, made up — only the
  // ticket request above uses it)
  if (ticketFor && TARGET === 'local') await ctx.route(/\/api\/v1\/csrf$/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"token":"devlog-local"}' }));
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`  [${who}] page error: ${String(e.message).slice(0, 300)}`));
  if (process.env.DEVLOG_DEBUG) page.on('console', m => console.log(`  [${who}] ${m.type()}: ${m.text().slice(0, 300)}`));
  const q = new URLSearchParams({ track });
  // (multiplayer: a room of its own, and each window its own player — the ticket for it answered above)
  if (room) { q.set('mp', room); q.set('player', who); } else q.set('mp', '0');
  await page.goto(`${base}/?${q}`, { waitUntil: 'load', timeout: 120000 });
  // the track built, the car on it, nothing still loading
  const ready = () => page.evaluate(async () => {
    const { debug } = await import('/testtrack/test-scene.js');
    window.__devlogShared = () => debug.shared;
    const w = debug.active;
    return !!(w?.sim && w.trackData && !w.spawning && debug.shared?.renderer);
  }).catch(() => false);
  for (let t = Date.now(); !(await ready()); await sleep(1000)) if (Date.now() - t > 240000) throw new Error(`${who}: the track didn't load in 4 minutes`);
  // (anything asking for a key press or a click at the start — a sign-in hint, a cookie note — out of the way)
  await page.keyboard.press('Escape').catch(() => {});
  await page.addStyleTag({ content: RECORDING_CSS(names) });
  await page.evaluate(() => { window.__devlogShared().renderer.domElement.classList.add('devlog-view'); });
  return { ctx, page };
}

// the route test drive with its autopilot, round the track's own course (as dev/world.html?world=track&drive=1 does)
const startAutopilot = page => page.evaluate(async laps => {
  const { debug, testDriveRoute } = await import('/testtrack/test-scene.js');
  const { viewCourse } = await import('/route/model.js'), { trackProjection } = await import('/track/build.js');
  const course = debug.active.trackData.course;
  window.__devlogDrive = 'running';
  const r = await testDriveRoute({ compiled: viewCourse(course, trackProjection), item: { course }, laps, autopilot: true, onDone: res => { window.__devlogDrive = res ? 'done' : 'ended'; } });
  if (r && r.ok === false) return r.error;
  return null;
}, 3);
const camera = (page, name) => page.evaluate(async n => {
  const { CAMERAS } = await import('/testtrack/camera.js');
  const s = window.__devlogShared(), i = CAMERAS.indexOf(n);
  if (i >= 0) s.camMode = i;
}, name);
// what the camera car's multiplayer says: online or not, and the other cars it draws (play/multiplayer.js others())
const othersSeen = page => page.evaluate(() => {
  const M = globalThis.__krMp;
  if (!M) return 'not online (no multiplayer started)';
  const o = M.others?.() ?? [];
  return `${M.status ?? M.net?.status ?? '?'}; ${o.length ? o.map(x => `${x.name} ${Math.round(x.distM)} m away${x.onScreen ? ', on screen' : ''}`).join(' · ') : 'no other car'}`;
}).catch(e => `(${e.message})`);
const step = (page, ms) => page.evaluate(m => window.__devlog.step(m), ms);
// (the names over other cars: marked to be kept when "names" is on)
const keepLabels = page => page.evaluate(() => { for (const el of document.querySelectorAll('div')) if (el.style.position === 'absolute' && el.style.transform === 'translate(-50%, -100%)' && el.textContent.length < 40) el.classList.add('devlog-keep'); });

// ---------- a run: one page (and the rival's), the shots in order along the lap ----------
async function run(shots, { track, multiplayer }) {
  const room = multiplayer ? `devlog-${Date.now().toString(36)}` : null;
  const rec = await openGame({ who: 'rec', width: 540, height: 960, scale: QUICK ? 1 : 2, track, room, names: !!SHOTS.names });
  log(`the game is up${room ? `: room ${room}` : ''}`);
  // (held still from here: it waits, drawing nothing, until it's stepped)
  await rec.page.evaluate(() => window.__devlog.start());
  let rival = null;
  if (multiplayer) {
    rival = await openGame({ who: 'rival', width: 320, height: 240, scale: 1, track, room, names: false });
    log('the second car is up');
    await rival.page.evaluate(() => window.__devlog.start());
    const e = await startAutopilot(rival.page); if (e) throw new Error(`rival: ${e}`);
    // the rival goes first: a head start (game seconds), so it's on the road ahead of the camera car
    for (let k = 0; k < Math.round((SHOTS.rivalHeadStart ?? 1.5) * 20); k++) { await step(rival.page, 50); await sleep(60); }
  }
  const e = await startAutopilot(rec.page); if (e) throw new Error(e);
  const dt = 1000 / FPS;
  let t = 0;                        // game seconds since the autopilot started
  // Both pages step together, and each step takes the same real time (the period): the other car's states then
  // arrive evenly, as they would from a player, and it moves smoothly on screen
  let period = multiplayer ? null : 0;
  const advance = async (ms, shoot) => {
    const t0 = performance.now();
    if (rival) await step(rival.page, ms);
    await step(rec.page, ms);
    // (the page's screenshot: the 3D view and any names over the cars; the frame is drawn while it's taken)
    const shot = shoot ? await rec.page.screenshot({ type: 'jpeg', quality: 92, animations: 'allow', caret: 'initial', timeout: 60000 }) : null;
    if (period) { const left = period - (performance.now() - t0); if (left > 0) await sleep(left); }
    t += ms / 1000;
    return { shot, took: performance.now() - t0 };
  };
  if (multiplayer) {
    // (how long a step takes on this machine, screenshot and all: the period a little longer than that)
    const took = [];
    for (let k = 0; k < 6; k++) took.push((await advance(dt, true)).took);
    period = Math.min(4000, Math.max(...took.slice(2)) * 1.25);
    log(`a frame takes about ${Math.round(Math.max(...took.slice(2)))} ms: one every ${Math.round(period)} ms`);
    if (names()) await keepLabels(rec.page);
  }
  const made = [];
  for (const s of shots) {
    const seconds = Math.min(s.seconds, MAX_SECONDS);
    // to where the shot starts: fast — big steps (the physics still runs every one of its own), drawn tiny
    if (t < (s.at ?? 0) - 1e-6) {
      const ratio = multiplayer ? null : await rec.page.evaluate(() => { const r = window.__devlogShared().renderer, was = r.getPixelRatio(); r.setPixelRatio(0.125); return was; });
      while (t < (s.at ?? 0) - 1e-6) await advance(multiplayer ? dt : Math.min(250, ((s.at ?? 0) - t) * 1000), false);
      if (ratio) await rec.page.evaluate(was => window.__devlogShared().renderer.setPixelRatio(was), ratio);
    }
    await camera(rec.page, s.camera ?? 'chase');
    if (multiplayer) log(`  ${s.name}: ${await othersSeen(rec.page)}`);
    if (names()) await keepLabels(rec.page);
    const file = path.join(OUT, `${s.name}.mp4`);
    const [bin, ffArgs, ffOpts] = ffmpegCommand(['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file]);
    const ff = spawn(bin, ffArgs, { ...ffOpts, stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((res, rej) => ff.on('close', c => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
    const frames = Math.round(seconds * FPS);
    const t0 = performance.now();
    for (let f = 0; f < frames; f++) {
      const { shot } = await advance(dt, true);
      if (!ff.stdin.write(shot)) await new Promise(r => ff.stdin.once('drain', r));
      if (f % FPS === FPS - 1) log(`  ${s.name}: ${f + 1}/${frames} frames (${((performance.now() - t0) / (f + 1)).toFixed(0)} ms a frame)`);
    }
    ff.stdin.end();
    await done;
    made.push({ name: s.name, file: path.relative(DEVLOG, file), seconds, fps: FPS, multiplayer: !!multiplayer, camera: s.camera ?? 'chase', label: s.label ?? null });
    log(`${s.name}: ${seconds} s → ${path.relative(process.cwd(), file)}`);
  }
  await rec.ctx.close();
  if (rival) await rival.ctx.close();
  return made;
}
const names = () => !!SHOTS.names;

let clips = [], failed = false;
try {
  const solo = SHOTS.shots.filter(s => !s.multiplayer), duo = SHOTS.shots.filter(s => s.multiplayer);
  if (solo.length) clips.push(...await run(solo, { track: SHOTS.track, multiplayer: false }));
  // (the second car's part failing leaves the solo shots: the video's still made, and the run says why)
  if (duo.length && MULTI) {
    try { clips.push(...await run(duo, { track: SHOTS.multiplayerTrack ?? SHOTS.track, multiplayer: true })); }
    catch (e) { console.error(`${process.env.GITHUB_ACTIONS ? '::warning::' : ''}The multiplayer shots failed (the video is made without them): ${String(e.message ?? e).split('\n')[0]}`); if (process.env.DEVLOG_DEBUG) console.error(e.stack); }
  } else if (duo.length) log(`(${duo.length} multiplayer shot${duo.length > 1 ? 's' : ''} left out: --multiplayer films them)`);
} catch (e) {
  failed = true;
  console.error(`capture failed: ${e.stack ?? e}`);
} finally {
  await browser.close().catch(() => {});
  server?.kill();
  if (rt) { try { await rt.stop?.(); } catch {} }
}
const order = new Map(SHOTS.shots.map((s, i) => [s.name, i]));
clips.sort((a, b) => order.get(a.name) - order.get(b.name));
fs.writeFileSync(path.join(OUT, 'clips.json'), JSON.stringify({ target: TARGET, track: SHOTS.track, size: QUICK ? [540, 960] : [1080, 1920], fps: FPS, made: new Date().toISOString(), clips }, null, 2) + '\n');
log(`${clips.length} clip${clips.length === 1 ? '' : 's'} in ${path.relative(process.cwd(), OUT)}`);
process.exit(failed || !clips.length ? 1 : 0);
