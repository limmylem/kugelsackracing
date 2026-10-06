// The determinism test (Phase 6 Step 3): recorded runs replayed from their inputs in Node (the server) and in
// browsers, their state compared bit for bit after every simulated second.
//
//   node tests/determinism/run.ts record [--runs 100] [--seconds 30] [--npc-runs 20] [--out dir]
//     drives generated tracks (every preset) with the test driver, recording each physics step's input as
//     it's applied (quantized); some runs with three more cars, each replaying its own recorded inputs
//   node tests/determinism/run.ts replay [--in dir] [--rapier compat|deterministic] [--label node]
//     replays every run in this process → <dir>/hashes-<label>.json
//   node tests/determinism/run.ts browsers [--in dir] [--rapier …] [--browsers chromium,firefox,webkit]
//     the same in each browser (Playwright) → <dir>/hashes-<browser>.json
//   node tests/determinism/run.ts compare [--in dir]
//     every hashes file against the recording's: runs identical, and where the first difference was

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { harness, root } from '../harness.mjs';
import { createAutopilot } from '../../route/autopilot.js';
import { createSimulation } from '../../physics/sim.js';
import { nearestOnTrack } from '../../track/scene.js';
import { generateTrack } from '../../track/generate.js';
import { trackFor, replay, quantize, inputAt, encodeInputs, decodeInputs, patchMath } from './probe.js';
if (process.env.DET_MATH) patchMath(process.env.DET_MATH, process.env.DET_MATH === 'all' ? { ...(await import(path.join(root, '.cache/determinism/detmath.mjs'))) } : null);

const [cmd = 'compare', ...args] = process.argv.slice(2);
const opt = (n: string, d: any) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const dir = path.resolve(opt('--out', opt('--in', path.join(root, '.cache/determinism'))));
fs.mkdirSync(dir, { recursive: true });
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'data/tracks.json'), 'utf8'));
const CAR = 'starter_car';

async function rapierOf(kind: string) {
  if (kind === 'deterministic') {
    const m: any = await import(process.env.RAPIER_DETERMINISTIC ?? '@dimforge/rapier3d-deterministic-compat');
    const R = m.default ?? m; await R.init(); return R;
  }
  const H: any = await harness(); return H.RAPIER;
}

// a car's driving inputs from the test driver, each quantized before it's applied
function pilotFor(T: any, steerNoise: (i: number) => number) {
  const pilot = createAutopilot(T.course.line, { loop: T.course.loop });
  const out: number[] = [];
  let i = 0;
  const drive = (v: any, dt: number) => {
    const b = v.body, p = b.translation(), q = b.rotation(), l = b.linvel();
    const fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y), m = Math.hypot(fx, fz) || 1;
    const c = pilot.drive({ x: p.x, z: p.z, fx: fx / m, fz: fz / m, speed: (l.x * fx + l.z * fz) / m, dt });
    const qd = quantize({ steer: c.steer + steerNoise(i++), throttle: c.throttle, brake: c.brake });
    out.push(...qd);
    return inputAt(Uint8Array.from(qd), 0);
  };
  return { drive, inputs: () => Uint8Array.from(out) };
}

if (cmd === 'record') {
  const N = +opt('--runs', 100), seconds = +opt('--seconds', 30), npcRuns = +opt('--npc-runs', 20);
  const H: any = await harness(), spec = H.garage(null, CAR).stats().spec, sockets = H.socketsOf(spec);
  const runs: any[] = [];
  const presets = cfg.presets;
  for (let k = 0, seed = 1; runs.length < N; seed++) {
    const g = generateTrack({ seed, params: presets[k % presets.length].params });
    if (!g.ok) continue;
    k++;
    const T = trackFor(g.code, cfg), withNpcs = runs.length < npcRuns;
    const sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets, track: T.track });
    const slots = T.course.grid.slots, put = (s: any) => ({ position: [s.x, nearestOnTrack(T.data, s.x, s.z).h + 0.6, s.z], headingDeg: s.heading });
    sim.resetCar(put(slots[0]));
    // (a little weaving, different every run: more of the physics than a tidy line)
    const wobble = (r: number) => (i: number) => 0.25 * Math.sin(i / (40 + 7 * (r % 5))) * ((r % 3) / 2);
    const me = pilotFor(T, wobble(runs.length));
    const npcs = withNpcs ? [1, 2, 3].map(j => { const P = pilotFor(T, wobble(runs.length + j)); sim.addCar(put(slots[j % slots.length]), P.drive); return P; }) : [];
    for (let i = 0; i < seconds * H.settings.stepHz; i++) sim.step(me.drive(sim.vehicle, sim.dt));
    sim.vehicle.world.free();
    runs.push({ code: g.code, car: CAR, inputs: encodeInputs(me.inputs()), npcs: npcs.map(P => ({ inputs: encodeInputs(P.inputs()) })) });
    process.stdout.write(`\r  recorded ${runs.length} of ${N}`);
  }
  fs.writeFileSync(path.join(dir, 'runs.json'), JSON.stringify({ format: 1, seconds, stepHz: H.settings.stepHz, runs }));
  console.log(`\n${N} runs (${npcRuns} with three more cars) → ${path.join(dir, 'runs.json')}`);
}

if (cmd === 'replay') {
  const kind = opt('--rapier', 'compat'), label = opt('--label', `node-${kind}`) + (process.env.DET_MATH ? `-det${process.env.DET_MATH}` : '');
  const R = await rapierOf(kind), H: any = await harness(), spec = H.garage(null, CAR).stats().spec, sockets = H.socketsOf(spec);
  const { runs } = JSON.parse(fs.readFileSync(path.join(dir, 'runs.json'), 'utf8'));
  const t0 = performance.now(), out = runs.map((r: any) => {
    const T = trackFor(r.code, cfg);
    return replay({ RAPIER: R, settings: H.settings, spec, sockets, T, inputs: decodeInputs(r.inputs), npcs: r.npcs.map((n: any) => ({ inputs: decodeInputs(n.inputs) })) });
  });
  fs.writeFileSync(path.join(dir, `hashes-${label}.json`), JSON.stringify({ label, rapier: kind, ms: performance.now() - t0, runs: out }));
  console.log(`${label}: ${out.length} runs replayed in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}

if (cmd === 'browsers') {
  const kind = opt('--rapier', 'compat'), names = opt('--browsers', 'chromium').split(',');
  let pw: any;
  try { pw = await import('playwright'); } catch { try { pw = await import('playwright-core'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); } }
  const rapierUrl = kind === 'deterministic' ? '/@rapier-det/dist/rapier.mjs' : '/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs';
  const detDir = process.env.RAPIER_DETERMINISTIC_DIR ?? path.join(root, 'node_modules/@dimforge/rapier3d-deterministic-compat');
  // a static server for the game's files and the runs
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url!, 'http://x').pathname);
    const file = u === '/runs.json' ? path.join(dir, 'runs.json') : u === '/page.html' ? path.join(root, 'tests/determinism/page.html') : u.startsWith('/@rapier-det/') ? path.join(detDir, u.slice(13)) : path.join(root, u);
    if (!file.startsWith(root) && !file.startsWith(dir) && !file.startsWith(detDir)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (e, b) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': file.endsWith('.js') || file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); res.end(b); });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port;
  for (const name of names) {
    const launch = name === 'chromium' && fs.existsSync('/opt/pw-browsers/chromium') && !process.env.CI ? { executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' } : {};
    const browser = await pw[name].launch(launch), page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e: any) => errors.push(String(e)));
    page.on('console', (m: any) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('response', (r: any) => { if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
    await page.goto(`http://127.0.0.1:${port}/page.html?rapier=${encodeURIComponent(rapierUrl)}${process.env.DET_MATH ? `&detmath=${process.env.DET_MATH}` : ''}`);
    const t0 = performance.now();
    const out = await page.evaluate(() => (window as any).runAll(), null).catch((e: any) => ({ error: String(e) }));
    if (out.error || errors.length || !Array.isArray(out)) { console.log(`${name}: failed — ${out.error ?? ''} ${errors.slice(0, 8).join(' | ')}`); await browser.close(); continue; }
    const version = browser.version();
    const label = `${opt('--tag', '') ? `${opt('--tag', '')}-` : ''}${name}-${kind}${process.env.DET_MATH ? `-det${process.env.DET_MATH}` : ''}`;
    fs.writeFileSync(path.join(dir, `hashes-${label}.json`), JSON.stringify({ label, browser: `${name} ${version}`, rapier: kind, ms: performance.now() - t0, runs: out }));
    console.log(`${name} ${version}: ${out.length} runs replayed in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    await browser.close();
  }
  server.close();
}

if (cmd === 'compare') {
  const files = fs.readdirSync(dir).filter(f => /^hashes-.*\.json$/.test(f)).sort();
  const sets = files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const ref = sets.find(s => s.label === (opt('--ref', null) ?? `node-${sets[0]?.rapier ?? 'compat'}`)) ?? sets[0];
  if (!ref) { console.log('nothing to compare'); process.exit(1); }
  let bad = 0;
  for (const s of sets) {
    const same = s.runs.filter((r: any, i: number) => r.hash === ref.runs[i]?.hash).length;
    const firstDiff = s.runs.map((r: any, i: number) => { const a = ref.runs[i]?.seconds ?? [], k = r.seconds.findIndex((h: string, j: number) => h !== a[j]); return k; }).filter((k: number) => k >= 0);
    const ok = same === ref.runs.length && s.runs.length === ref.runs.length;
    // (the platform's own maths: shown, not failed — what the experiment is compared against)
    if (!ok && !/platform/.test(s.label)) bad++;
    console.log(`${ok ? '  same ' : ' DIFFS '} ${`${s.label}${s.browser ? ` (${s.browser})` : ''}`.padEnd(58)} rapier ${s.rapier.padEnd(13)} ${same} of ${ref.runs.length} runs identical to ${ref.label}${firstDiff.length ? `; first difference after ${Math.min(...firstDiff) + 1} s (median ${firstDiff.sort((a: number, b: number) => a - b)[firstDiff.length >> 1] + 1} s)` : ''}  (${(s.ms / 1000).toFixed(1)} s)`);
  }
  process.exitCode = bad ? 1 : 0;
}
