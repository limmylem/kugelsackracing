// Generated tracks' performance and stability (Phase 5 Step 4; npm run test:track-perf), against
// data/tracks.json performance.detail:
//   - 50 different tracks loaded in a row, as the game does (made, built, dressed for drawing at high
//     detail, a physics world on it), then dropped: each within the load target, and memory not growing
//     (the heap and buffers from the 10th to the 50th)
//   - each detail level (low, medium, high) on the busiest theme: the dressing's draw calls and triangles,
//     and the CPU's share of a frame in an 8-car race — the physics (two steps a frame at 60 fps), the
//     dressing's per-frame updates (trees near and far, the crowd) and the race replay's recording —
//     within the level's budget. (The GPU's share: tools/track-perf-browser.mjs, in a browser.)
//
//   node --expose-gc tests/track-perf.ts [--tracks 50] [--only loads,levels]

import fs from 'node:fs';
import * as THREE from 'three';
import { harness } from './harness.mjs';
import { runRace } from './map/raceHarness.ts';
import { generateTrack } from '../track/generate.js';
import { buildTrack, trackWorld, trackProjection } from '../track/build.js';
import { dressMeshes } from '../track/renderDress.js';
import { tvCameras } from '../track/cameras.js';
import { nearestOnTrack } from '../track/scene.js';
import { viewCourse } from '../route/model.js';
import { createSimulation } from '../physics/sim.js';
import { createRaceRecording } from '../race/raceReplay.js';

// (Node has no canvas: the signs' texture atlas drawn on a stand-in that does nothing)
(globalThis as any).OffscreenCanvas ??= class { width: number; height: number; constructor(w: number, h: number) { this.width = w; this.height = h; } getContext() { return new Proxy({}, { get: (t: any, k) => k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : () => {}, set: (t: any, k, v) => { t[k] = v; return true; } }); } };

const args = process.argv.slice(2), opt = (n: string, d: any) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const only = opt('--only', null)?.split(','), want = (k: string) => !only || only.includes(k);
const cfg = JSON.parse(fs.readFileSync(new URL('../data/tracks.json', import.meta.url), 'utf8')), DT = cfg.performance.detail, P = cfg.presets;
const H: any = await harness(), spec = H.garage(null, 'starter_car').stats().spec;
let failed = 0;
const report = (ok: boolean, name: string, detail: string) => { if (!ok) failed++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${name.padEnd(54)} ${detail}`); };
const memory = () => { (globalThis as any).gc?.(); (globalThis as any).gc?.(); const m = process.memoryUsage(); return (m.heapUsed + m.external + m.arrayBuffers) / 1e6; };
const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
const simOn = (data: any, world: any) => {
  const sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets: H.socketsOf(spec), track: world });
  const reset = sim.resetCar.bind(sim);
  sim.resetCar = (pose: any) => { const [x, y, z] = pose.position; reset({ ...pose, position: [x, nearestOnTrack(data, x, z, y || null).h + 0.6, z] }); };
  return sim;
};
const drawn = (R: any) => { let calls = 0, tris = 0; R.group.traverse((o: any) => { if (!o.isMesh || !o.visible) return; let up = o.parent, shown = true; while (up) { if (!up.visible) shown = false; up = up.parent; } if (!shown) return; const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3; if (o.isInstancedMesh && !o.count) return; calls++; tris += n * (o.isInstancedMesh ? o.count : 1); }); return { calls, tris }; };

// ---------- 50 tracks in a row ----------
if (want('loads')) {
  const N = +opt('--tracks', 50), times: number[] = [], mem: number[] = [], themes = ['countryside', 'forest', 'desert', 'coastal', 'mountain', 'street'];
  const high = DT.levels.high;
  for (let k = 0; k < N; k++) {
    const pr = P[k % P.length], params = pr.params.theme === 'auto' ? { ...pr.params, theme: themes[k % themes.length] } : pr.params;
    const t0 = performance.now();
    const gen = generateTrack({ seed: 9001 + 7 * k, params });
    if (!gen.ok) { report(false, `track ${k}`, gen.error); continue; }
    const data: any = buildTrack(gen, cfg), world = trackWorld(data), course = viewCourse(data.course, trackProjection);
    const dress = dressMeshes(THREE, data, { detail: high }), cams = tvCameras(data), sim = simOn(data, world);
    dress.update(new THREE.PerspectiveCamera());
    times.push((performance.now() - t0) / 1000);
    // (dropped: the next one in its place)
    dress.dispose(); sim.vehicle.world.free();
    void course; void cams;
    if (k % 10 === 9) mem.push(memory());
  }
  const worst = Math.max(...times), grow = mem.at(-1)! - mem[0];
  console.log(`        load: median ${pct(times, 0.5).toFixed(2)} s, slowest ${worst.toFixed(2)} s · memory every 10 tracks ${mem.map(m => m.toFixed(0)).join(' → ')} MB`);
  report(worst <= DT.targets.high.loadSeconds, `${N} tracks in a row: each loaded within the target`, `slowest ${worst.toFixed(2)} s (target ${DT.targets.high.loadSeconds} s), median ${pct(times, 0.5).toFixed(2)} s`);
  report(grow <= DT.targets.memoryGrowthMb, `${N} tracks in a row: memory not growing`, `${grow >= 0 ? '+' : ''}${grow.toFixed(1)} MB from the 10th to the ${N}th (at most ${DT.targets.memoryGrowthMb} MB)`);
}

// ---------- each detail level: draw calls, triangles, the CPU's frame in an 8-car race ----------
if (want('levels')) {
  // the busiest theme: the one whose dressing has the most in it
  const pr = P.find((p: any) => p.id === 'mixed_gp');
  let busiest: any = null;
  for (const theme of ['countryside', 'forest', 'desert', 'coastal', 'mountain', 'street']) {
    const gen = generateTrack({ seed: 777, params: { ...pr.params, theme } }), data: any = buildTrack(gen, cfg);
    if (!busiest || data.objects.length > busiest.data.objects.length) busiest = { theme, gen, data };
  }
  const { data, theme } = busiest, world = trackWorld(data), course = viewCourse(data.course, trackProjection);
  console.log(`        the busiest theme: ${theme} (${data.objects.length} things beside the track)`);
  // the race: 8 cars, its physics time a frame (as the game: two steps), and the replay's recording
  const sim = simOn(data, world), rec = createRaceRecording({ hz: 20 });
  let recMs = 0, next = 0;
  const onStep = ({ sim: s }: any) => {
    if (s.time < next) return;
    next = s.time + 0.05;
    const t0 = performance.now(), list = [s.vehicle, ...(s.cars ?? []).map((c: any) => c.vehicle)].filter(Boolean).map((v: any, i: number) => { const p = v.body.translation(), q = v.body.rotation(), l = v.body.linvel(); return { id: i, x: p.x, y: p.y, z: p.z, q: [q.x, q.y, q.z, q.w], vx: l.x, vy: l.y, vz: l.z }; });
    rec.sample(s.time, list); recMs += performance.now() - t0;
  };
  const S = { sim, origin: [0, 0], toSim: (x: number, z: number) => [x, z], ground: (x: number, z: number) => nearestOnTrack(data, x, z).h, free() { sim.vehicle.world.free(); } };
  const xs = course.line.map((p: any) => p.x), zs = course.line.map((p: any) => p.z);
  const R = { region: 'track', M: { H }, course, stored: data.course, laps: 1, around: { cx: 0, cz: 0, radius: Math.max(...xs.map(Math.abs), ...zs.map(Math.abs)) } };
  const out: any = await runRace(R, { npcs: 7, seed: 3, playerSkill: 0.75, S, onStep, limit: 300 });
  S.free();
  const physicsFrame = out.ms / out.steps * 2, recFrame = recMs / Math.max(1, out.steps) * 2, cars = out.standings.length;
  console.log(`        ${cars} cars, ${out.standings.filter((s: any) => s.status === 'finished').length} finished · physics ${physicsFrame.toFixed(2)} ms a frame · recording ${(recFrame * 1000).toFixed(1)} µs a frame (${(JSON.stringify(rec.finish()).length / 1024).toFixed(0)} kB)`);
  for (const level of ['low', 'medium', 'high']) {
    const L = DT.levels[level], T = DT.targets[level];
    const t0 = performance.now(), dress = dressMeshes(THREE, data, { detail: L }), buildMs = performance.now() - t0;
    // the camera round the lap: the dressing's updates a frame (worst of the 95%)
    const cam = new THREE.PerspectiveCamera(), C = data.centre, n = C.x.length, upd: number[] = [];
    let draws = { calls: 0, tris: 0 };
    for (let k = 0; k < 600; k++) {
      const i = Math.floor(k / 600 * n);
      cam.position.set(C.x[i], C.h[i] + 2, C.z[i]);
      const u0 = performance.now(); dress.update(cam); upd.push(performance.now() - u0);
      if (k % 100 === 0) { const d = drawn(dress); if (d.calls > draws.calls) draws = d; }
    }
    const cpu = physicsFrame + pct(upd, 0.95) + recFrame;
    dress.dispose();
    report(draws.calls <= T.drawCalls && cpu <= T.cpuFrameMs, `${level} detail: draw calls and the CPU's frame within budget`, `${draws.calls} draw calls (at most ${T.drawCalls}), ${(draws.tris / 1000).toFixed(0)}k triangles, CPU ${cpu.toFixed(2)} ms a frame (physics ${physicsFrame.toFixed(2)} + dressing ${pct(upd, 0.95).toFixed(2)} + recording ${recFrame.toFixed(3)}; budget ${T.cpuFrameMs}) · built in ${buildMs.toFixed(0)} ms`);
  }
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
