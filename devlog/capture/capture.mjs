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
//                            [--multiplayer] [--fps 30] [--quick] [--max-seconds n] [--size 540x960]
//
//   --size WxH       the page's size in CSS pixels, drawn at 2× (540x960: the devlog's 1080×1920; 960x540: the
//                    trailer's 1920×1080 — trailer/shots.json)
//
// A shots file has either one track and its shots (the devlog's), or "runs": each a generated track ({ track, shots,
// multiplayer? }) or a real region driven along real roads ({ region, waypoints: [[lat, lon], …], shots }) — the
// region's road network bakes a course through the waypoints (route/model.js bakeRoute, as the multiplayer routes are)
// and the same autopilot drives it.
//
//   --target local   (default) this checkout: tools/serve.mjs serves the game; with --multiplayer a real-time server
//                    runs in this process (server/src/rt/server.ts) and the join tickets are signed here
//   --target live    https://ognistrada.com, as a signed-out visitor. With --multiplayer both cars join one private
//                    room ("devlog@…") on the live real-time server with load-test tickets ("Bot <n>", no account,
//                    nothing counted — server/src/routes/rt.ts): needs LOADTEST_TOKEN in the environment. Never an
//                    account of anyone's, and never the admin's.
//   --quick          a short test run: every shot a second long (or --max-seconds), at 15 fps and half the size
//   --no-sound       pictures only (by default each clip has the game's own sound: below)
//
// The sound: the game's own (engines, tyres, the other car, the world: audio/system.js), rendered in step with the
// pictures. The camera window's AudioContext is an OfflineAudioContext in disguise (an init script; the game is
// unchanged): rendered only when told to, 1/fps of a second after each frame — so a frame that took two seconds to draw
// still has exactly its 1/30 s of sound — and each shot's stretch of it put into its clip.
//
// Writes <out>/<shot>.mp4 for each shot and <out>/clips.json (what was captured: names, lengths, size).
// Needs the game's own packages (npm ci at the repository's root: three.js and Rapier are served from there in local
// mode) and this folder's (npm ci in devlog/).

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ffmpegCommand } from '../lib/ffmpeg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), DEVLOG = path.resolve(HERE, '..'), ROOT = path.resolve(DEVLOG, '..');
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; }, flag = n => args.includes(n);
const TARGET = opt('--target', process.env.DEVLOG_TARGET || 'local');
const QUICK = flag('--quick');
const SOUND = !flag('--no-sound'), SAMPLE_RATE = 48000;
const FPS = +opt('--fps', QUICK ? 15 : 30);
const MAX_SECONDS = +opt('--max-seconds', QUICK ? 1 : 60);
const [VIEW_W, VIEW_H] = opt('--size', '540x960').split('x').map(Number);
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
const launch = () => chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  // (software WebGL: GitHub's runners have no GPU)
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
    ...(process.env.DEVLOG_NO_PROXY ? ['--no-proxy-server'] : [])],
});
const browser = await launch();
// (the second car: a browser of its own — in the same one its small frames would wait behind the camera car's big
// ones in their shared graphics process)
let rivalBrowser = null;

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
// (the names over other cars, on the camera car's screen only: the live site's load-test guests read "Bot 190" — shown
// as "Rival")
const RIVAL_NAME = () => {
  const fix = el => { if (el.nodeType === 3 && /^Bot \d+$/.test(el.textContent)) el.textContent = 'Rival'; };
  new MutationObserver(ms => { for (const m of ms) { if (m.type === 'characterData') fix(m.target); for (const n of m.addedNodes ?? []) { fix(n); n.childNodes?.forEach(fix); } } })
    .observe(document, { subtree: true, childList: true, characterData: true });
};
// The game's sound, rendered in step with the frames: AudioContext made an OfflineAudioContext (one, the length of the
// run), its rendering paused and resumed by window.__devlogAudio.advance(ms) — run after each frame — so the sound's
// clock is the frames' own. (The game never sees the difference: resume/suspend/close are no-ops it may call freely.)
const OFFLINE_AUDIO = ({ sampleRate, seconds }) => {
  const Offline = window.OfflineAudioContext;
  if (!Offline) return;
  let made = null;
  function DevlogAudioContext() {
    if (made) return made;
    const ctx = new Offline({ numberOfChannels: 2, length: Math.ceil(sampleRate * seconds), sampleRate });
    const suspendAt = ctx.suspend.bind(ctx), carryOn = ctx.resume.bind(ctx), q = 128 / sampleRate;
    ctx.resume = () => Promise.resolve();
    ctx.suspend = () => Promise.resolve();
    ctx.close = () => Promise.resolve();
    let started = false, target = 0, rendered = null;
    window.__devlogAudio = {
      ctx,
      get time() { return ctx.currentTime; },
      async advance(ms) {
        target += ms / 1000;
        const t = Math.round(target / q) * q;
        if (t <= ctx.currentTime + q / 2 || t >= seconds - q) return ctx.currentTime;
        // (a moment first for the game's messages to its audio thread — the engines' state — to arrive)
        await new Promise(r => setTimeout(r, 4));
        const at = suspendAt(t);
        if (!started) { started = true; rendered = ctx.startRendering(); } else await carryOn();
        await at;
        return ctx.currentTime;
      },
      // the rest rendered, and the stretches wanted taken out: [{ from, seconds }] → base64 of 16-bit stereo
      async take(segments) {
        if (!started) { started = true; rendered = ctx.startRendering(); } else await carryOn();
        const buf = await rendered, L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
        return segments.map(({ from, seconds: n }) => {
          const a = Math.round(from * sampleRate), len = Math.round(n * sampleRate), pcm = new Int16Array(len * 2);
          let peak = 0;
          for (let i = 0; i < len; i++) for (const [c, ch] of [[0, L], [1, R]]) { const v = ch[a + i] ?? 0; peak = Math.max(peak, Math.abs(v)); pcm[i * 2 + c] = Math.max(-32768, Math.min(32767, Math.round(v * 32767))); }
          let bin = '';
          const bytes = new Uint8Array(pcm.buffer);
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
          return { pcm: btoa(bin), peak };
        });
      },
    };
    made = ctx;
    return ctx;
  }
  window.AudioContext = DevlogAudioContext;
  window.webkitAudioContext = DevlogAudioContext;
};
// a WAV file from 16-bit stereo samples
function wav(pcm, sampleRate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 4, 28); h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
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

async function openGame({ who, width, height, scale, track, region = null, room, names, on = browser, audioSeconds = 0 }) {
  const ctx = await on.newContext({ viewport: { width, height }, deviceScaleFactor: scale, reducedMotion: 'no-preference' });
  if (TARGET === 'local') await localLibs(ctx);
  await ctx.addInitScript(VIRTUAL_FRAMES);
  if (TARGET === 'live') await ctx.addInitScript(RIVAL_NAME);
  if (audioSeconds) await ctx.addInitScript(OFFLINE_AUDIO, { sampleRate: SAMPLE_RATE, seconds: audioSeconds });
  // (the game asks the API for a join ticket for "player <who>": answered here — locally signed, or the live
  // load-test ticket — so neither car is anyone's account)
  if (ticketFor) await ctx.route(/\/api\/v1\/rt\/ticket$/, async r => {
    try { r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(await ticketFor(who, who === 'rec' ? 'Ognistrada' : 'Rival')) }); }
    catch (e) { console.error(`  ticket: ${e.message}`); r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"OFFLINE","message":"no ticket"}}' }); }
  });
  // (locally there's no API: the CSRF token the game asks for before any request that writes, made up — only the
  // ticket request above uses it)
  if (ticketFor && TARGET === 'local') await ctx.route(/\/api\/v1\/csrf$/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"token":"devlog-local"}' }));
  // (a real region: as a returning player, the first launch's screens already seen; the music off — the trailer
  // has its own, unbroken across the cuts)
  if (region) await ctx.addInitScript(() => {
    localStorage.setItem('ognistrada.photosensitivity.v1', '2026-01-01');
    localStorage.setItem('ognistrada.onboarding.v1', JSON.stringify({ welcome: 'offline', starter: 'starter_car', tutorial: 'skipped' }));
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`  [${who}] page error: ${String(e.message).slice(0, 300)}`));
  if (process.env.DEVLOG_DEBUG) page.on('console', m => console.log(`  [${who}] ${m.type()}: ${m.text().slice(0, 300)}`));
  if (region) {
    // (its world opened straight: dev/world.html, the same scene as the game's page, at the high graphics preset)
    const world = region === 'sf' ? 'map_v3' : `map_v3.json?region=${region}&_=`;
    await page.goto(`${base}/dev/world.html?${new URLSearchParams({ world, graphics: 'high' })}`, { waitUntil: 'load', timeout: 120000 });
  } else {
    const q = new URLSearchParams({ track });
    // (multiplayer: a room of its own, and each window its own player — the ticket for it answered above)
    if (room) { q.set('mp', room); q.set('player', who); } else q.set('mp', '0');
    await page.goto(`${base}/?${q}`, { waitUntil: 'load', timeout: 120000 });
  }
  // the track built (or the region's map streamed in round the car), the car on it, nothing still loading
  const ready = () => page.evaluate(async () => {
    const { debug } = await import('/testtrack/test-scene.js');
    window.__devlogShared = () => debug.shared;
    const w = debug.active, st = w?.stream?.status;
    return !!(w?.sim && (w.trackData || (st && st.tiles > 0 && !st.loading)) && !w.spawning && debug.shared?.renderer);
  }).catch(() => false);
  const why = () => page.evaluate(async () => { const { debug } = await import('/testtrack/test-scene.js'); const w = debug.active; return JSON.stringify({ file: w?.file, sim: !!w?.sim, track: !!w?.trackData, stream: w?.stream?.status ?? null, spawning: !!w?.spawning }); }).catch(e => e.message);
  for (let t = Date.now(), k = 0; !(await ready()); await sleep(1000), k++) {
    if (Date.now() - t > 240000) throw new Error(`${who}: the ${region ? 'region' : 'track'} didn't load in 4 minutes: ${await why()}`);
    if (k % 30 === 29) log(`  still loading: ${await why()}`);
  }
  // (anything asking for a key press or a click at the start — a sign-in hint, a cookie note — out of the way)
  // (a key press is also what starts the game's sound: browsers allow it only after one)
  await page.keyboard.press('Escape').catch(() => {});
  if (audioSeconds) {
    const up = () => page.evaluate(async () => !!(await import('/audio/system.js')).audioSystem() && !!window.__devlogAudio).catch(() => false);
    let ok = false;
    for (let k = 0; k < 40 && !(ok = await up()); k++) await sleep(500);
    log(ok ? '  the game\'s sound is on (rendered in step with the frames)' : '  the game\'s sound didn\'t start: these clips are silent');
  }
  // (the game's own music silent in the clips: a video adds its own over the cuts)
  if (region || SHOTS.runs) await page.evaluate(() => globalThis.__krMusic?.stop?.()).catch(() => {});
  await page.addStyleTag({ content: RECORDING_CSS(names) });
  await page.evaluate(() => { window.__devlogShared().renderer.domElement.classList.add('devlog-view'); });
  return { ctx, page };
}

// the route test drive with its autopilot, round the track's own course (as dev/world.html?world=track&drive=1 does)
const startAutopilot = (page, { region = null, waypoints = null } = {}) => page.evaluate(async ({ laps, region, waypoints }) => {
  const { debug, testDriveRoute } = await import('/testtrack/test-scene.js');
  const { viewCourse, bakeRoute, newRoute } = await import('/route/model.js');
  window.__devlogDrive = 'running';
  let course, compiled;
  if (region) {
    // (a real region: a course baked through the waypoints on its road network — the shortest way by road between
    // each — then drawn and driven as the editor's test drive does)
    const game = debug.active.questGame, N = await game.network();
    course = bakeRoute(N, { ...newRoute(region, 'p2p'), waypoints: waypoints.map(([lat, lon]) => ({ lat, lon })), grid: { count: 1, adjust: {} } });
    compiled = viewCourse(course, game.projection);
  } else {
    const { trackProjection } = await import('/track/build.js');
    course = debug.active.trackData.course;
    compiled = viewCourse(course, trackProjection);
  }
  const r = await testDriveRoute({ compiled, item: { course }, laps: region ? 1 : laps, autopilot: true, onDone: res => { window.__devlogDrive = res ? 'done' : 'ended'; } });
  if (r && r.ok === false) return r.error;
  return null;
}, { laps: 3, region, waypoints });
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
  return `${M.status ?? M.net?.status ?? '?'}; ${o.length ? o.map(x => `${x.name} ${Math.round(x.distM)} m away, ${x.drawn ? 'drawn' : `not drawn${x.why ? ` (${x.why})` : ''}`}${x.onScreen ? ', on screen' : ''}, last heard ${Math.round(x.ageMs ?? -1)} ms ago`).join(' · ') : 'no other car'}`;
}).catch(e => `(${e.message})`);
const step = (page, ms) => page.evaluate(m => window.__devlog.step(m), ms);
// (the names over other cars: marked to be kept when "names" is on)
const keepLabels = page => page.evaluate(() => { for (const el of document.querySelectorAll('div')) if (el.style.position === 'absolute' && el.style.transform === 'translate(-50%, -100%)' && el.textContent.length < 40) el.classList.add('devlog-keep'); });

// ---------- a run: one page (and the rival's), the shots in order along the lap ----------
async function run(shots, { track, region = null, waypoints = null, multiplayer }) {
  const room = multiplayer ? `devlog-${Date.now().toString(36)}` : null;
  // (the sound's length: the whole run in game time, and a little over)
  const audioSeconds = SOUND ? Math.max(...shots.map(s => (s.at ?? 0) + Math.min(s.seconds, MAX_SECONDS))) + 4 : 0;
  const rec = await openGame({ who: 'rec', width: VIEW_W, height: VIEW_H, scale: QUICK ? 1 : 2, track, region, room, names: !!SHOTS.names, audioSeconds });
  const sound = audioSeconds && await rec.page.evaluate(() => !!window.__devlogAudio).catch(() => false);
  log(`the game is up${room ? `: room ${room}` : ''}`);
  // (held still from here: it waits, drawing nothing, until it's stepped)
  await rec.page.evaluate(() => window.__devlog.start());
  let rival = null;
  if (multiplayer) {
    rivalBrowser ??= await launch();
    rival = await openGame({ who: 'rival', width: 320, height: 240, scale: 1, track, room, names: false, on: rivalBrowser });
    log('the second car is up');
    // (nobody watches it: drawn tiny, so its steps are quick)
    await rival.page.evaluate(() => { window.__devlog.start(); window.__devlogShared().renderer.setPixelRatio(0.25); });
    const e = await startAutopilot(rival.page); if (e) throw new Error(`rival: ${e}`);
    // the rival goes first: a head start (game seconds), so it's on the road ahead of the camera car
    for (let k = 0; k < Math.round((SHOTS.rivalHeadStart ?? 1.5) * 20); k++) { await step(rival.page, 50); await sleep(60); }
  }
  const e = await startAutopilot(rec.page, { region, waypoints }); if (e) throw new Error(e);
  const dt = 1000 / FPS;
  let t = 0;                        // game seconds since the autopilot started
  // Both pages go forward the same game time each frame, and each frame takes the same real time (the period). The
  // camera car's frame is slow (a second or more to draw); the rival takes its share of game time in small steps
  // spread over the period (one about every RIVAL_STEP_MS), so its car states reach the server at a steady, ordinary
  // pace — states seconds apart are stamped unevenly by the game's clock and refused (net/client.js stampNow,
  // server/src/rt/checks.ts) — and its car moves smoothly on the camera car's screen
  const RIVAL_STEP_MS = 700;
  let period = multiplayer ? null : 0;
  const advance = async (ms, shoot) => {
    const t0 = performance.now();
    let rivalSteps = null;
    if (rival && !period) await step(rival.page, ms);
    else if (rival) {
      const n = Math.max(1, Math.round(period / RIVAL_STEP_MS));
      rivalSteps = (async () => { for (let i = 0; i < n; i++) { await step(rival.page, ms / n); const wait = t0 + (i + 1) * period / n - performance.now(); if (wait > 0) await sleep(wait); } })();
    }
    await step(rec.page, ms);
    // (the sound for the time from this frame to the next)
    if (sound) await rec.page.evaluate(m => window.__devlogAudio.advance(m), ms);
    // (the page's screenshot: the 3D view and any names over the cars; the frame is drawn while it's taken)
    const shot = shoot ? await rec.page.screenshot({ type: 'jpeg', quality: 92, animations: 'allow', caret: 'initial', timeout: 60000 }) : null;
    if (rivalSteps) await rivalSteps;
    if (period) { const left = period - (performance.now() - t0); if (left > 0) await sleep(left); }
    t += ms / 1000;
    return { shot, took: performance.now() - t0 };
  };
  if (multiplayer) {
    // (how long a step takes on this machine, screenshot and all: the period a little longer than that)
    const took = [];
    for (let k = 0; k < 6; k++) took.push((await advance(dt, true)).took);
    period = +process.env.DEVLOG_PERIOD || Math.min(4000, Math.max(...took.slice(2)) * 1.25);
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
    const soundFrom = sound ? await rec.page.evaluate(() => window.__devlogAudio.time) : null;
    const t0 = performance.now();
    for (let f = 0; f < frames; f++) {
      const { shot } = await advance(dt, true);
      if (!ff.stdin.write(shot)) await new Promise(r => ff.stdin.once('drain', r));
      if (f % FPS === FPS - 1) log(`  ${s.name}: ${f + 1}/${frames} frames (${((performance.now() - t0) / (f + 1)).toFixed(0)} ms a frame)`);
    }
    ff.stdin.end();
    await done;
    if (multiplayer) log(`  ${s.name}, at its end: ${await othersSeen(rec.page)}`);
    made.push({ name: s.name, file: path.relative(DEVLOG, file), seconds, fps: FPS, multiplayer: !!multiplayer, camera: s.camera ?? 'chase', label: s.label ?? null, region, soundFrom, sound: false });
    log(`${s.name}: ${seconds} s → ${path.relative(process.cwd(), file)}`);
  }
  // the sound: the rest of the run rendered, each shot's stretch of it into its clip (a failure here leaves the clips
  // silent, never lost)
  if (sound) {
    try {
      const parts = await rec.page.evaluate(segs => window.__devlogAudio.take(segs), made.map(m => ({ from: m.soundFrom, seconds: m.seconds })));
      for (const [i, m] of made.entries()) {
        const file = path.join(DEVLOG, m.file), tmpWav = file.replace(/\.mp4$/, '.wav'), tmpMp4 = file.replace(/\.mp4$/, '.sound.mp4');
        fs.writeFileSync(tmpWav, wav(Buffer.from(parts[i].pcm, 'base64'), SAMPLE_RATE));
        const [bin, a, o] = ffmpegCommand(['-y', '-loglevel', 'error', '-i', file, '-i', tmpWav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', tmpMp4]);
        execFileSync(bin, a, o);
        fs.renameSync(tmpMp4, file); fs.rmSync(tmpWav);
        m.sound = true; m.soundPeak = +parts[i].peak.toFixed(3);
        log(`  ${m.name}: sound added (loudest ${(20 * Math.log10(Math.max(1e-6, parts[i].peak))).toFixed(1)} dBFS)`);
      }
    } catch (e) { console.error(`${process.env.GITHUB_ACTIONS ? '::warning::' : ''}The game's sound couldn't be added (the clips stay silent): ${String(e.message ?? e).split('\n')[0]}`); }
  }
  await rec.ctx.close();
  if (rival) await rival.ctx.close();
  return made;
}
const names = () => !!SHOTS.names;

let clips = [], failed = false;
try {
  // (a shots file of runs — the trailer's: each a track or a region, filmed in turn; else the devlog's one track)
  const runs = SHOTS.runs ?? [{ track: SHOTS.track, shots: SHOTS.shots }];
  for (const R of runs) {
    const solo = R.shots.filter(s => !s.multiplayer && !R.multiplayer), duo = R.shots.filter(s => s.multiplayer || R.multiplayer);
    try {
      if (solo.length) clips.push(...await run(solo, { track: R.track, region: R.region ?? null, waypoints: R.waypoints ?? null, multiplayer: false }));
    } catch (e) { if (!SHOTS.runs) throw e; console.error(`${process.env.GITHUB_ACTIONS ? '::warning::' : ''}A run failed (${R.region ?? R.track}): ${String(e.message ?? e).split('\n')[0]}`); }
    // (the second car's part failing leaves the solo shots: the video's still made, and the run says why)
    if (duo.length && MULTI) {
      try { clips.push(...await run(duo, { track: SHOTS.multiplayerTrack ?? R.track, multiplayer: true })); }
      catch (e) { console.error(`${process.env.GITHUB_ACTIONS ? '::warning::' : ''}The multiplayer shots failed (the video is made without them): ${String(e.message ?? e).split('\n')[0]}`); if (process.env.DEVLOG_DEBUG) console.error(e.stack); }
    } else if (duo.length) log(`(${duo.length} multiplayer shot${duo.length > 1 ? 's' : ''} left out: --multiplayer films them)`);
  }
} catch (e) {
  failed = true;
  console.error(`capture failed: ${e.stack ?? e}`);
} finally {
  await browser.close().catch(() => {});
  await rivalBrowser?.close().catch(() => {});
  server?.kill();
  if (rt) { try { await rt.stop?.(); } catch {} }
}
const order = new Map((SHOTS.runs ? SHOTS.runs.flatMap(R => R.shots) : SHOTS.shots).map((s, i) => [s.name, i]));
clips.sort((a, b) => order.get(a.name) - order.get(b.name));
fs.writeFileSync(path.join(OUT, 'clips.json'), JSON.stringify({ target: TARGET, track: SHOTS.track, size: QUICK ? [VIEW_W, VIEW_H] : [VIEW_W * 2, VIEW_H * 2], fps: FPS, made: new Date().toISOString(), clips }, null, 2) + '\n');
log(`${clips.length} clip${clips.length === 1 ? '' : 's'} in ${path.relative(process.cwd(), OUT)}`);
process.exit(failed || !clips.length ? 1 : 0);
