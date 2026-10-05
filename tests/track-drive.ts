// Generated tracks driven (Phase 5 Step 1; npm run test:track-drive):
//   - physics: the Phase 1 Step 6 tests on a generated track — 0–100, the quarter mile, 100–0 and the
//     30/60/144 fps check down its main straight, a robot's flying lap of it, and ten cars at once —
//     against the car's own targets (tests/targets/), as on the test centre
//   - driveability: random tracks over every preset, each driven start to finish by the simple test
//     driver (route/autopilot.js) through the Phase 4 tracker, and by the Phase 4 AI (the NPCs' driver,
//     tests/map/raceHarness.ts) — never out of the corridor, never stuck
//   - races: 8-car NPC races on some of them — everyone finishes, no one stuck
//
//   node tests/track-drive.ts [--tracks 100] [--races 10] [--only physics,drive,races]

import fs from 'node:fs';
import { harness } from './harness.mjs';
import { runRace, ncfg } from './map/raceHarness.ts';
import { generateTrack } from '../track/generate.js';
import { buildTrack, trackWorld, trackProjection } from '../track/build.js';
import { nearestOnTrack } from '../track/scene.js';
import { viewCourse } from '../route/model.js';
import { createAutopilot } from '../route/autopilot.js';
import { createTracker } from '../route/tracker.js';
import { createSimulation } from '../physics/sim.js';
import { createRun, evaluate, pathThrough } from '../physics/testSuite.js';

const args = process.argv.slice(2), opt = (n: string, d: any) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const only = opt('--only', null)?.split(','), want = (k: string) => !only || only.includes(k);
const cfg = JSON.parse(fs.readFileSync(new URL('../data/tracks.json', import.meta.url), 'utf8')), P = cfg.presets;
const H: any = await harness(), CAR = 'starter_car', spec = H.garage(null, CAR).stats().spec;
let failed = 0;
const report = (ok: boolean, name: string, detail: string) => { if (!ok) failed++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${name.padEnd(50)} ${detail}`); };

function makeTrack(spec_: any) {
  const gen = generateTrack(spec_);
  if (!gen.ok) throw new Error(gen.error);
  const data = buildTrack(gen, cfg), course: any = viewCourse(data.course, trackProjection);
  return { gen, data, track: trackWorld(data), course };
}
// the simulation on a track, cars put down on its road (not at height 0)
function simOn(T: any, spec_ = spec) {
  const sim = createSimulation(H.RAPIER, { settings: H.settings, spec: spec_, sockets: H.socketsOf(spec_), track: T.track });
  const reset = sim.resetCar.bind(sim);
  sim.resetCar = (pose: any) => { const [x, , z] = pose.position; reset({ ...pose, position: [x, nearestOnTrack(T.data, x, z).h + 0.6, z] }); };
  return sim;
}

// ---------- physics: Phase 1 Step 6's tests on a generated track ----------
if (want('physics')) {
  // a grand prix circuit with a main straight long enough for the quarter mile (the first seed that has
  // one). (Not a high-speed one: Phase 1's lap robot was tuned on the test centre's circuit and weaves in
  // 130–150 km/h sweepers — its steering, not the track: the drive tests below take those.)
  let T: any = null;
  for (let seed = 1; !T; seed++) { const g = generateTrack({ seed, params: P.find((p: any) => p.id === 'mixed_gp').params }); if (g.ok && g.track.start.straight >= 650 && g.track.stats.elevationRange < 20) T = makeTrack({ code: g.code }); }
  const C = T.data.centre, n = C.x.length;
  const pts: number[][] = []; for (let i = 0; i < n; i++) pts.push([C.x[i], C.z[i]]);
  // down the main straight and on along the track (the straight-line tests follow the road)
  const ahead = pts.slice(2, Math.min(n, 2 + Math.round(1400 / T.data.length * n)));
  const path_ = pathThrough(ahead, 2), h = Math.atan2(path_.points[0].tx, path_.points[0].tz);
  const strip = { x: ahead[0][0], z: ahead[0][1], h, remaining: ahead.length * (T.data.length / n), path: path_ };
  // the lap: the circuit as a closed road, its start line where the course's is
  const st = T.course.start, every = Math.max(1, Math.round(4 / (T.data.length / n)));
  const road = { name: 'Generated circuit', closed: true, width: T.data.width, startLine: [st.x, st.z], points: pts.filter((_, i) => i % every === 0) };
  const track = { ...T.track, roads: [road], tests: { circuit: { road: 0, startBefore: 150 } } };
  const prepare = (sim: any) => { const reset = sim.resetCar.bind(sim); sim.resetCar = (pose: any) => { const [x, , z] = pose.position; reset({ ...pose, position: [x, nearestOnTrack(T.data, x, z).h + 0.4, z] }); }; };
  const targets = JSON.parse(fs.readFileSync(new URL(`./targets/${CAR}.json`, import.meta.url), 'utf8'));
  const ctx = { RAPIER: H.RAPIER, settings: H.settings, spec, sockets: H.socketsOf(spec), track, place: () => ({ strip, T: track.tests }), prepare, pace: targets.pace };
  console.log(`Physics on ${T.gen.code} (${(T.data.length / 1000).toFixed(2)} km, main straight ${Math.round(T.gen.track.start.straight)} m)`);
  for (const id of ['zeroTo100', 'quarterMile', 'braking', 'framerate', 'lap', 'physicsCost']) {
    const run = createRun(ctx, id);
    while (!run.done) run.next(5000);
    // (the lap's target is the test centre's circuit: on another circuit, what counts is a clean lap)
    const row = evaluate([run.result], id === 'lap' ? {} : targets)[0], t = row.target;
    const value = row.value == null ? (row.pass ? 'yes' : 'no') : `${row.value.toFixed(row.digits)} ${row.unit}`;
    report(row.pass, `${row.name} on a generated track`, `${value}${t ? ` (target ${t.min ?? ''}–${t.max ?? ''})` : ''} ${row.detail ?? ''}`);
  }
}

// ---------- driveability: the test driver and the Phase 4 AI on random tracks ----------
function autopilotRun(T: any) {
  const sim = simOn(T), c = T.course, slot = c.grid.slots[0];
  sim.resetCar({ position: [slot.x, 0, slot.z], headingDeg: slot.heading });
  const pilot = createAutopilot(c.line, { loop: c.loop });
  const tr = createTracker({ line: c.line, loop: c.loop, startS: c.grid.startS, finishS: c.grid.finishS, checkpoints: c.checkpoints, laps: 1 });
  const p0 = sim.vehicle.body.translation(); tr.begin(p0.x, p0.z); tr.start();
  const limit = Math.max(240, (T.data.course.stats.estimatedTime ?? 100) * 3);
  let t = 0, done = false, off = 0, resets = 0, slow = 0, stuck = 0;
  while (t < limit && !done) {
    const b = sim.vehicle.body, p = b.translation(), q = b.rotation(), v = b.linvel();
    const fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y), m = Math.hypot(fx, fz) || 1;
    const cmd = pilot.drive({ x: p.x, z: p.z, fx: fx / m, fz: fz / m, speed: (v.x * fx + v.z * fz) / m, dt: sim.dt });
    sim.step({ throttle: cmd.throttle, brake: cmd.brake, steer: cmd.steer, handbrake: false, device: 'wheel' });
    t += sim.dt;
    for (const e of tr.update(sim.dt, { x: p.x, z: p.z, vx: v.x, vz: v.z })) { if (e.type === 'finish') done = true; if (e.type === 'reset') resets++; }
    if (tr.state.offRoute) off += sim.dt;
    if (t > 8 && Math.hypot(v.x, v.z) < 1) { if ((slow += sim.dt) > 4) stuck++; } else slow = 0;
  }
  sim.vehicle.world.free();
  return { done, t, off, resets, stuck: stuck > 0 };
}
async function aiRun(T: any, { npcs = 0, seed = 1, skill = 0.7 } = {}) {
  const sim = simOn(T);
  const S = { sim, origin: [0, 0], toSim: (x: number, z: number) => [x, z], ground: (x: number, z: number) => nearestOnTrack(T.data, x, z).h, free() { sim.vehicle.world.free(); } };
  const xs = T.course.line.map((p: any) => p.x), zs = T.course.line.map((p: any) => p.z);
  const R = { region: 'track', M: { H }, course: T.course, stored: T.data.course, laps: 1, around: { cx: 0, cz: 0, radius: Math.max(...xs.map(Math.abs), ...zs.map(Math.abs)) } };
  let off = 0, sampled = 0;
  const onStep = ({ C, sim: s }: any) => { if (Math.round(s.time * 120) % 12) return; const tr = C.session?.tracker?.state; if (tr && C.state === 'racing') { sampled++; if (tr.offRoute) off++; } };
  const out: any = await runRace(R, { npcs, seed, playerSkill: skill, S, onStep, limit: Math.max(300, (T.data.course.stats.estimatedTime ?? 100) * 3) });
  S.free();
  return { out, offShare: sampled ? off / sampled : 0 };
}

if (want('drive')) {
  const N = +opt('--tracks', 100), fails: string[] = [];
  let pilotOk = 0, aiOk = 0, km = 0;
  const t0 = performance.now();
  for (let k = 0; k < N; k++) {
    const pr = P[k % P.length], T = makeTrack({ seed: 4243 * k + 11, params: pr.params });
    km += T.data.length / 1000;
    const a = autopilotRun(T);
    if (a.done && a.off === 0 && !a.stuck && a.resets === 0) pilotOk++; else fails.push(`test driver, ${pr.id} ${T.gen.code}: ${a.done ? '' : 'did not finish; '}${a.off ? `${a.off.toFixed(1)} s out of the corridor; ` : ''}${a.stuck ? 'stuck; ' : ''}${a.resets ? `${a.resets} resets` : ''}`);
    const { out, offShare } = await aiRun(T, { seed: k });
    const res = out.res?.outcome, okAi = res?.status === 'finished' && out.botResets === 0 && offShare === 0;
    if (okAi) aiOk++; else fails.push(`Phase 4 AI, ${pr.id} ${T.gen.code}: ${res?.status ?? 'no result'}${out.botResets ? `, ${out.botResets} resets (stuck or off)` : ''}${offShare ? `, ${(offShare * 100).toFixed(1)}% of the time out of the corridor` : ''}`);
    if ((k + 1) % 10 === 0) console.log(`        ${k + 1} of ${N} tracks · ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  }
  for (const f of fails.slice(0, 12)) console.log(`        ${f}`);
  report(pilotOk === N, `the test driver round ${N} random tracks`, `${pilotOk} of ${N} clean (finished, in the corridor, never stuck) · ${km.toFixed(0)} km`);
  report(aiOk === N, `the Phase 4 AI round ${N} random tracks`, `${aiOk} of ${N} clean (finished, no resets, in the corridor)`);
}

// ---------- 8-car races ----------
if (want('races')) {
  const N = +opt('--races', 10);
  let clean = 0;
  const notes: string[] = [];
  for (let k = 0; k < N; k++) {
    const pr = P[k % P.length], T = makeTrack({ seed: 977 * k + 5, params: pr.params });
    const { out } = await aiRun(T, { npcs: 7, seed: k, skill: 0.75 });
    const stuck = out.events.filter((e: any) => e.type === 'npc-stuck').length, finished = out.standings.filter((s: any) => s.status === 'finished').length;
    if (finished === 8 && stuck === 0) clean++;
    notes.push(`${pr.id} ${(T.data.length / 1000).toFixed(1)} km: ${finished}/8 finished, ${stuck} stuck, ${out.events.filter((e: any) => e.type === 'npc-reset').length} resets, winner ${out.standings[0]?.name}`);
  }
  for (const n of notes) console.log(`        ${n}`);
  report(clean === N, `8-car NPC races on ${N} generated tracks`, `${clean} of ${N}: everyone finished, no one stuck`);
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
