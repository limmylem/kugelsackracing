// The benchmarks (Phase 8 Step 2; docs/PERFORMANCE.md): each scene (perf/bench.js) opened in a browser, set up, run for
// a while and measured — frame time (average, worst 1%), where it goes (rendering, physics, AI, audio, network,
// streaming, effects, the game's own, the browser's), stutters and their causes, memory, draw calls and how long the
// world took to become drivable — written to reports/performance/<label>.json and compared with data/performance.json's
// targets for the tier asked (and, with --baseline, with an earlier run).
//
//   node tools/bench.mjs [--scenes track_race,night_rain,city,pileup,roam] [--seconds 30] [--tier medium] [--preset high] [--label name]
//                        [--swiftshader] [--size 640x360] [--baseline reports/performance/baseline.json]
//                        [--alloc] [--cpu] [--gc] (where the garbage is made; where the main thread's time goes; each collection's pause)
//   (needs playwright-core and a Chromium: CHROMIUM=/path, else /opt/pw-browsers/chromium or Playwright's own; the roam
//   scene runs the game's servers here too, which need PostgreSQL with PostGIS: TEST_DATABASE_URL)
//
// On a machine with no graphics card (--swiftshader: the CPU draws every pixel) the frame times are the CPU's, far
// slower than any player's; the CPU-side stages (physics, AI, audio, network, streaming), the draw calls, memory and
// stutters' causes still compare from run to run.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname, args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/performance.json'), 'utf8'));
const scenes = (opt('--scenes', null) ?? Object.keys(cfg.benchmarks).join(',')).split(',').filter(Boolean);
const seconds = +opt('--seconds', cfg.run?.seconds ?? 30), tier = opt('--tier', 'medium'), label = opt('--label', new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'));
const soft = args.includes('--swiftshader'), size = opt('--size', null)?.split('x').map(Number);
// (the graphics preset: the tier's own, or --preset; "none" leaves the game to its own — what it was before presets)
const preset = opt('--preset', cfg.tiers[tier]?.preset ?? 'medium');
let pw;
try { pw = await import('playwright-core'); } catch { try { pw = await import('playwright'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); } }
const chromium = pw.chromium ?? pw.default?.chromium;
const exe = process.env.CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

// the busiest theme's generated track (most beside it), as tools/track-perf-browser.mjs picks it
async function busiestTrack() {
  const tcfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tracks.json'), 'utf8'));
  const { generateTrack } = await import('../track/generate.js'), { buildTrack } = await import('../track/build.js');
  let code = null, most = -1;
  for (const theme of ['countryside', 'forest', 'desert', 'coastal', 'mountain', 'street']) {
    const g = generateTrack({ seed: 777, params: { ...tcfg.presets.find(p => p.id === 'mixed_gp').params, theme } }), n = buildTrack(g, tcfg).objects.length;
    if (n > most) { most = n; code = g.code; }
  }
  return code;
}

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const server = spawn(process.execPath, [path.join(ROOT, 'tools/serve.mjs'), String(port)], { env: { ...process.env, HOST: '127.0.0.1' }, stdio: 'ignore' });
const staticBase = `http://127.0.0.1:${port}`;
for (let i = 0; i < 50; i++) { try { await fetch(`${staticBase}/data/performance.json`); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
// (free roam: the game's servers and the other players — server/tools/roam-host.ts; it needs PostgreSQL:
// TEST_DATABASE_URL — without it the scene is skipped)
let host = null;
if (scenes.some(s => cfg.benchmarks[s]?.roam)) {
  if (!process.env.TEST_DATABASE_URL) console.log('(roam skipped: it needs the game\'s servers, and they need PostgreSQL — TEST_DATABASE_URL)');
  else host = await (await import('../server/tools/roam-host.ts')).startRoamHost({ region: 'sf' });
}

// (the track's code is in the config — the busiest theme's, worked out once; busiestTrack() works it out again)
const trackCode = scenes.some(s => cfg.benchmarks[s]?.world === 'track') ? cfg.benchmarks.track_race.code ?? await busiestTrack() : null;
const flags = soft ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
const browser = await chromium.launch({ executablePath: exe, args: [...flags, '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'] });
const nm = path.join(ROOT, 'node_modules'), out = { label, at: new Date().toISOString(), tier, preset, seconds, software: soft, size, scenes: {} };
let failed = 0;
try {
  for (const name of scenes) {
    const B = cfg.benchmarks[name];
    if (!B) { console.log(`?? ${name}: no such benchmark`); failed++; continue; }
    if (B.roam && !host) continue;
    const base = B.roam ? host.base : staticBase;
    const ctx = await browser.newContext({ viewport: { width: size?.[0] ?? B.viewport?.[0] ?? 1280, height: size?.[1] ?? B.viewport?.[1] ?? 720 } });
    // (the libraries from this machine, not the CDN; no fonts from outside)
    await ctx.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', r => r.fulfill({ path: `${nm}/three/${new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', '')}`, contentType: 'text/javascript' }));
    await ctx.route('https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/**', r => r.fulfill({ path: `${nm}/@dimforge/rapier3d-compat/dist/rapier.mjs`, contentType: 'text/javascript' }));
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // (regions=all: the real world opens in San Francisco, as its baseline was measured there and the roam host is —
    // not in the game's own first region, data/map/baked.json inGame)
    const q = new URLSearchParams({ world: B.world, regions: 'all', ...(B.world === 'track' && { code: trackCode }), ...(B.questBot && { questBot: '' }), ...(preset !== 'none' && { graphics: preset }), ...(B.query ?? {}) });
    // (--network: loading over a normal home connection — data/performance.json network — for time-to-drivable; a new
    // browser profile each scene, so nothing's cached)
    if (args.includes('--network')) { const N = cfg.network, c = await ctx.newCDPSession(page); await c.send('Network.enable'); await c.send('Network.emulateNetworkConditions', { offline: false, latency: N.latencyMs, downloadThroughput: N.megabitsPerSecond * 1e6 / 8, uploadThroughput: 10e6 / 8 }); }
    const t0 = Date.now();
    await page.goto(`${base}/dev/world.html?${q}`);
    // drivable: the world on, the car let go (not spawning, not waiting for ground)
    // (on a track: built, dressed and its races ready — the car waits on the grid for one; elsewhere: the car let go, the
    // ground round it in)
    const ready = await page.waitForFunction(() => { const w = window.testWorld?.active; if (!w) return false; if (w.trackData) return !!w.quests; return !w.spawning && (!w.stream || w.stream.readyAround?.(...(p => [p.x, p.z])(w.sim.vehicle.body.translation()), 60)); }, null, { timeout: 300000 }).then(() => true, () => false);
    const loadMs = Date.now() - t0;
    if (!ready) { console.log(`FAIL ${name}: the world didn't become drivable in 5 minutes`); failed++; await ctx.close(); continue; }
    // (sound on, as a player has it: a key pressed)
    await page.keyboard.press('Shift');
    // (free roam: once this player's in, the others on the roads round them)
    if (B.roam) {
      const at = await page.waitForFunction(() => { const R = globalThis.__krRoam, w = window.testWorld?.active; if (!R?.RC?.home || globalThis.__krMp?.status !== 'online') return null; const p = w.sim.vehicle.body.translation(); return w.stream.toWorld(p.x, p.z); }, null, { timeout: 120000 }).then(h => h.jsonValue(), () => null);
      if (!at) { console.log(`FAIL ${name}: not in free roam (${await page.evaluate(() => globalThis.__krMp?.status ?? 'no multiplayer')})`); failed++; await ctx.close(); continue; }
      await host.addBots(B.roam.players - 1 - host.bots.length, at, B.roam.radiusM);
    }
    const set = await page.evaluate(async ([n, o]) => (await import('/perf/bench.js')).setup(n, o), [name, { ...B.options, ...(B.roam && { players: B.roam.players }) }]);
    if (!set?.ok) { console.log(`FAIL ${name}: ${set?.error ?? 'set-up failed'}`); failed++; await ctx.close(); continue; }
    // (--warmup 0: measured from the moment it's set up — what appears for the first time, its shaders, counted)
    await page.waitForTimeout(+(opt('--warmup', null) ?? B.warmup ?? cfg.run?.warmup ?? 5) * 1000);
    // (--alloc: where the garbage is made — Chrome's sampling heap profiler over the run, by function; --cpu: where the
    // main thread's time goes — its sampling profiler, by function's own time)
    // (the garbage itself, always: every allocation the sampling heap profiler sees, the ones collected since included —
    // the page's own measure, the heap's growth between frames, misses what's collected within a frame, and a software-
    // drawn frame is long enough for several collections)
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('HeapProfiler.startSampling', { samplingInterval: args.includes('--alloc') ? 16384 : 65536, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    if (args.includes('--cpu')) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); }
    // (--gc: every collection's pause on the page's main thread, from Chrome's trace — the quick ones, of the young
    // objects, and the full ones, of the whole heap — how many, how long, the longest)
    if (args.includes('--gc')) await browser.startTracing(page, { categories: ['devtools.timeline', 'v8'] });
    const r = await page.evaluate(async s => (await import('/perf/bench.js')).measure(s), B.seconds ?? seconds);
    if (args.includes('--gc')) {
      const T = JSON.parse(String(await browser.stopTracing())), ev = T.traceEvents ?? T;
      const main = new Set(ev.filter(e => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain').map(e => `${e.pid}:${e.tid}`));
      const g = { minor: [], major: [] };
      for (const e of ev) if (e.ph === 'X' && (e.name === 'MinorGC' || e.name === 'MajorGC') && main.has(`${e.pid}:${e.tid}`)) g[e.name === 'MinorGC' ? 'minor' : 'major'].push(e.dur / 1000);
      // (by simulated time: the physics makes most of the garbage, and drawn in software it runs behind real time)
      r.gc = Object.fromEntries(Object.entries(g).map(([k, a]) => [k, { count: a.length, perSimMinute: a.length / Math.max(1e-6, r.simSeconds) * 60, msPerSimSecond: a.reduce((x, y) => x + y, 0) / Math.max(1e-6, r.simSeconds), longestMs: Math.max(0, ...a) }]));
      console.log(`${''.padEnd(11)} collections on the main thread: quick ${r.gc.minor.count} (${r.gc.minor.msPerSimSecond.toFixed(1)} ms a simulated second, the longest ${r.gc.minor.longestMs.toFixed(1)} ms) · full ${r.gc.major.count} (${r.gc.major.perSimMinute.toFixed(1)} a simulated minute, ${r.gc.major.msPerSimSecond.toFixed(1)} ms a simulated second, the longest ${r.gc.major.longestMs.toFixed(1)} ms)`);
    }
    const where = f => `${f.functionName || '(anonymous)'} ${f.url.replace(/^.*?\/\/[^/]+\//, '').replace(/^https:\/\/cdn[^ ]*\/npm\//, '')}:${f.lineNumber + 1}`;
    const by = new Map();
    {
      // (split by what drives it — the simulation's steps and the replay's recording go with simulated time, the rest
      // of the frame with frames drawn, the rest — sound's messages, the network, timers — with real time; put back
      // together at 60 frames and one simulated second a second, as on a computer that keeps up: software drawing
      // runs a few frames a second, and the simulation slower than real time)
      const { profile } = await cdp.send('HeapProfiler.stopSampling'), kind = { sim: 0, frame: 0, other: 0 };
      const drives = (f, up) => (f.functionName === 'advance' && f.url.endsWith('physics/sim.js')) || (f.functionName === 'record' && f.url.endsWith('physics/replay.js')) ? 'sim'
        : up === 'other' && f.functionName === 'loop' && f.url.endsWith('testtrack/test-scene.js') ? 'frame' : up;
      const walk = (n, up) => { const k2 = drives(n.callFrame, up); if (n.selfSize) { const k = where(n.callFrame); by.set(k, (by.get(k) ?? 0) + n.selfSize); kind[k2] += n.selfSize; } for (const c of n.children) walk(c, k2); };
      walk(profile.head, 'other');
      const MB = 1048576, est = kind.sim / MB / Math.max(1e-6, r.simSeconds) + kind.frame / MB / Math.max(1, r.frames) * 60 + kind.other / MB / r.wallSeconds;
      r.garbage = { mbps: est, simMB: kind.sim / MB, frameMB: kind.frame / MB, otherMB: kind.other / MB, simSeconds: r.simSeconds, frames: r.frames, wallSeconds: r.wallSeconds, measuredMBps: (kind.sim + kind.frame + kind.other) / MB / r.wallSeconds };
      r.pageAllocMBps = r.allocMBps; r.allocMBps = est;
    }
    if (args.includes('--alloc')) {
      const total = [...by.values()].reduce((a, b) => a + b, 0) || 1;
      r.alloc = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => ({ at: k, share: +(v / total).toFixed(3) }));
      console.log(`${''.padEnd(11)} garbage by where it's made: ${r.alloc.slice(0, 12).map(x => `${(x.share * 100).toFixed(0)}% ${x.at}`).join(' · ')}`);
    }
    if (args.includes('--cpu')) {
      const { profile } = await cdp.send('Profiler.stop'), self = new Map(), dt = profile.timeDeltas, hits = new Map();
      for (let i = 0; i < profile.samples.length; i++) hits.set(profile.samples[i], (hits.get(profile.samples[i]) ?? 0) + (dt[i] ?? 0));
      let gc = 0, busy = 0;
      for (const n of profile.nodes) { const t = hits.get(n.id) ?? 0; if (!t || n.callFrame.functionName === '(idle)') continue; busy += t; if (n.callFrame.functionName === '(garbage collector)') gc += t; if (/^\((program|garbage collector)\)$/.test(n.callFrame.functionName)) continue; const k = where(n.callFrame); self.set(k, (self.get(k) ?? 0) + t); }
      const total = [...self.values()].reduce((a, b) => a + b, 0) || 1;
      // (the collector's share of the main thread's busy time)
      r.gcShare = gc / (busy || 1);
      console.log(`${''.padEnd(11)} garbage collection: ${(r.gcShare * 100).toFixed(1)}% of the main thread's busy time`);
      r.cpu = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => ({ at: k, share: +(v / total).toFixed(3) }));
      console.log(`${''.padEnd(11)} main thread by function: ${r.cpu.slice(0, 12).map(x => `${(x.share * 100).toFixed(1)}% ${x.at}`).join(' · ')}`);
    }
    r.loadMs = loadMs; r.note = set.note; r.errors = errors.slice(0, 5);
    out.scenes[name] = r;
    const T = cfg.tiers[tier]?.targets ?? {};
    const st = r.stages, top = Object.entries(st).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ');
    console.log(`${name.padEnd(11)} ${set.note} · ${r.frames} frames: avg ${r.avgMs.toFixed(1)} ms (${r.fps.toFixed(1)} fps), worst 1% ${r.worst1PctMs.toFixed(1)} ms (${r.low1PctFps.toFixed(1)} fps) · stages ms: ${top}`);
    console.log(`${''.padEnd(11)} stutters ${r.stutters.count} (${(r.stutters.share * 100).toFixed(2)}% of frames: ${Object.entries(r.stutters.byCause).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}; over 2× its own median ${(r.relStutters.share * 100).toFixed(2)}%) · ${Math.round(r.calls ?? 0)} draw calls, ${((r.triangles ?? 0) / 1000).toFixed(0)}k triangles · heap ${r.memory.heapMB?.toFixed(0)} MB, meshes ${r.memory.meshMB.toFixed(0)} MB, textures ${r.memory.textureMB.toFixed(0)} MB · physics ${r.physicsStep.per60thMs.toFixed(2)} ms per 60th of a second (${r.physicsStep.cars} cars) · audio thread ${r.audio ? (r.audio.share * 100).toFixed(1) + '%' : '—'} · drivable in ${(loadMs / 1000).toFixed(1)} s${errors.length ? ` · ${errors.length} page errors: ${errors[0]}` : ''}`);
    console.log(`${''.padEnd(11)} garbage ${r.allocMBps?.toFixed(1)} MB/s at 60 fps in real time (${r.garbage.measuredMBps.toFixed(1)} MB/s as it ran: ${r.garbage.simMB.toFixed(0)} MB in ${r.garbage.simSeconds.toFixed(1)} simulated s, ${r.garbage.frameMB.toFixed(0)} MB in ${r.frames} frames, ${r.garbage.otherMB.toFixed(0)} MB in ${r.garbage.wallSeconds.toFixed(0)} s; ${r.collections} collections) · draw calls ${r.draws?.total.calls} + ${r.draws?.total.shadow} for the shadows, by what: ${Object.entries(r.draws?.by ?? {}).slice(0, 10).map(([k, v]) => `${k} ${v.calls}+${v.shadow}`).join(', ')}`);
    console.log(`${''.padEnd(11)} shaders compiled while it ran: ${r.programsMade?.length ?? '—'}${r.programsMade?.length ? ` (${r.programsMade.join(', ')})` : ''}`);
    if (r.online) console.log(`${''.padEnd(11)} online: ${r.drawnOthers} other cars drawn, ${r.online.downKBs?.toFixed(1)} kB/s down, ${r.online.upKBs?.toFixed(1)} kB/s up, ping ${r.online.ping?.toFixed(0)} ms`);
    // (the main thread's own work a frame: every stage but the browser's — against the tier's budget)
    r.mainMs = Object.entries(r.stages).filter(([k]) => k !== 'other').reduce((a, [, v]) => a + v, 0);
    console.log(`${''.padEnd(11)} main thread ${r.mainMs.toFixed(1)} ms a frame (the ${tier} tier's budget ${T.mainThreadMs} ms${soft ? ': software rendering adds to physics and render, catching up' : ''}) · drivable in ${(loadMs / 1000).toFixed(1)} s (target ${T.timeToDrivableS} s${args.includes('--network') ? `, over ${cfg.network.megabitsPerSecond} Mbit/s` : ', no network limit'})`);
    if (T.fps && !soft && r.fps < T.fps) console.log(`${''.padEnd(11)} below the ${tier} tier's ${T.fps} fps`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
  await Promise.race([host?.stop().catch(e => console.log(`(the roam servers: ${e.message})`)), new Promise(r => setTimeout(r, 30000))]);
}
const dir = path.join(ROOT, 'reports/performance');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${label}.json`), JSON.stringify(out, null, 1));
console.log(`\nreports/performance/${label}.json${failed ? ` · ${failed} failed` : ''}`);

// the figures compared from run to run (--baseline; written on their own as <label>.metrics.json: small enough to keep
// in the repository — tests/perf/ci-baseline.json is one)
const METRIC = {
  'draw calls': r => (r.draws?.total.calls ?? r.calls ?? 0) + (r.draws?.total.shadow ?? 0), triangles: r => r.triangles ?? 0,
  'heap MB': r => r.memory?.heapMB ?? 0, 'meshes MB': r => r.memory?.meshMB ?? 0, 'textures MB': r => r.memory?.textureMB ?? 0,
  'garbage MB/s': r => r.allocMBps ?? 0, 'drivable s': r => (r.loadMs ?? 0) / 1000,
  ...Object.fromEntries(['physics', 'ai', 'game', 'network', 'audio', 'streaming', 'effects', 'render', 'input'].map(k => [`${k} ms`, r => r.stages?.[k] ?? 0])),
  'physics per 60th ms': r => r.physicsStep?.per60thMs ?? 0, 'shader stutters': r => r.stutters?.byCause?.['shader compile'] ?? 0,
};
const metricsOf = rep => ({ label: rep.label, at: rep.at, preset: rep.preset, compact: true, scenes: Object.fromEntries(Object.entries(rep.scenes).map(([n, r]) => [n, Object.fromEntries(Object.entries(METRIC).map(([m, f]) => [m, +(+f(r)).toFixed(3)]))])) });
fs.writeFileSync(path.join(dir, `${label}.metrics.json`), JSON.stringify(metricsOf(out), null, 1));

// --baseline: each scene against an earlier run's — what got worse by more than data/performance.json ci allows (warn,
// fail), what got better; written as Markdown too (--summary file: the CI job's summary)
const basePath = opt('--baseline', null);
if (basePath) {
  const C = cfg.ci, base = fs.existsSync(basePath) ? JSON.parse(fs.readFileSync(basePath, 'utf8')) : null, lines = [];
  let worse = 0, bad = 0;
  const B = base ? (base.compact ? base : metricsOf(base)) : null, N = metricsOf(out);
  if (!base) lines.push(`No baseline at ${basePath} yet: this run is the first (keep it as the baseline).`);
  else for (const [name, r] of Object.entries(N.scenes)) {
    const b = B.scenes?.[name];
    if (!b) { lines.push(`- ${name}: not in the baseline`); continue; }
    const rows = [];
    for (const m of Object.keys(METRIC)) {
      const was = b[m], now = r[m], tol = C.tolerance[m] ?? C.tolerance.default, floor = C.floor[m] ?? C.floor.default;
      if (!(was >= 0) || !(now >= 0)) continue;
      const change = (now - was) / Math.max(was, floor);
      const tag = change > tol.fail ? 'FAIL' : change > tol.warn ? 'warn' : change < -tol.warn ? 'better' : '';
      if (tag === 'FAIL') bad++; if (tag === 'warn') worse++;
      if (tag) rows.push(`${m} ${was.toFixed(2)} → ${now.toFixed(2)} (${change > 0 ? '+' : ''}${(change * 100).toFixed(0)}%) ${tag}`);
    }
    lines.push(`- **${name}**: ${rows.length ? rows.join(' · ') : 'within the tolerances'}`);
  }
  const text = `### Performance against ${basePath}\n\n${lines.join('\n')}\n\n${bad ? `**${bad} worse beyond the fail tolerance**` : worse ? `${worse} worse beyond the warning tolerance` : 'Nothing worse beyond the tolerances.'}\n`;
  console.log(`\n${text}`);
  const sum = opt('--summary', null);
  if (sum) fs.appendFileSync(sum, text);
  if (bad) failed++;
}
process.exit(failed ? 1 : 0);
