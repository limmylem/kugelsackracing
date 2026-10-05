// Dressed tracks driven (Phase 5 Step 2; npm run test:dress-drive), against data/tracks.json dressTests
// and performance:
//   - run-off: at every corner of a dozen tracks, a car going straight on where it turns in, at the racing
//     line's speed (the reference car's: what the run-off is sized for), braking hard — it stops before
//     the barrier, or hits it slowly enough, on most corners
//   - barriers: every type hit at 50, 150 and 300 km/h at 15°, 45° and 90° — never through; every hit
//     reaches the Phase 3 damage model; a tyre wall does less damage than concrete at the same speed
//   - gravel: driven into at speed, it slows a car hard; a car rolling in slowly is beached (it can't
//     drive out)
//   - kerbs: the Phase 4 AI on a line that uses them (out to the road's edge and onto the kerbs) — round
//     every track with its wheels on the kerbs, never losing control (no resets, no spins)
//   - an 8-car race on dressed tracks: everyone finishes; the physics' time a frame within its budget
//
//   node tests/track-dress-drive.ts [--only runoff,barriers,gravel,kerbs,races] [--tracks 12]

import fs from 'node:fs';
import { harness, crashContext } from './harness.mjs';
import { runRace } from './map/raceHarness.ts';
import { generateTrack, THEMES } from '../track/generate.js';
import { buildTrack, trackWorld, trackProjection } from '../track/build.js';
import { RUNOFF } from '../track/dress.js';
import { nearestOnTrack } from '../track/scene.js';
import { viewCourse } from '../route/model.js';
import { createSimulation } from '../physics/sim.js';
import { CarDamage } from '../garage/carDamage.js';
import { outcome } from '../garage/crashSuite.js';

const args = process.argv.slice(2), opt = (n: string, d: any) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const only = opt('--only', null)?.split(','), want = (k: string) => !only || only.includes(k);
const cfg = JSON.parse(fs.readFileSync(new URL('../data/tracks.json', import.meta.url), 'utf8')), DT = cfg.dressTests, PERF = cfg.performance, P = (id: string) => cfg.presets.find((p: any) => p.id === id).params;
const H: any = await harness(), CAR = 'starter_car', spec = H.garage(null, CAR).stats().spec;
let failed = 0;
const report = (ok: boolean, name: string, detail: string) => { if (!ok) failed++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${name.padEnd(54)} ${detail}`); };
const IDLE = { device: 'wheel', throttle: 0, brake: 0, steer: 0, handbrake: false };

function makeTrack(spec_: any) {
  const gen = generateTrack(spec_);
  if (!gen.ok) throw new Error(gen.error);
  const t0 = performance.now(), data: any = buildTrack(gen, cfg), ms = performance.now() - t0;
  return { gen, data, track: trackWorld(data), course: viewCourse(data.course, trackProjection), ms };
}
const simOn = (T: any, spec_ = spec) => createSimulation(H.RAPIER, { settings: H.settings, spec: spec_, sockets: H.socketsOf(spec_), track: T.track });
const frame = (T: any) => {
  const C = T.data.centre, n = C.x.length;
  const dir = (i: number) => { const a = (i - 1 + n) % n, b = (i + 1) % n, dx = C.x[b] - C.x[a], dz = C.z[b] - C.z[a], m = Math.hypot(dx, dz); return [dx / m, dz / m]; };
  return { C, n, dir, W: T.data.width / 2, Dr: T.data.dress };
};
const BARRIER_MATERIALS = new Set(['metal', 'concrete', 'tyres']);
// how far past the barrier line nearest it a place is (m; − on the track's side). The pit wall: past its line.
function pastBarrier(T: any, x: number, z: number, pitWall = false) {
  const { C, n, dir, W, Dr } = frame(T), t = nearestOnTrack(T.data, x, z), i = t.i, [tx, tz] = dir(i);
  const u = (x - C.x[i]) * tz - (z - C.z[i]) * tx, side = u >= 0 ? 1 : -1;
  if (pitWall && Dr.pit?.side === side && i >= Dr.pit.from && i <= Dr.pit.to) return Math.abs(u) - (W + 2.5) - 0.3;
  return Math.abs(u) - (side > 0 ? Dr.runoff.L[i] : Dr.runoff.R[i]);
}

// ---------- run-off: straight on at every corner ----------
if (want('runoff')) {
  const N = +opt('--tracks', DT.runoff.tracks), rows: any[] = [];
  let pass = 0, total = 0;
  for (let k = 0; k < N; k++) {
    const pr = cfg.presets[k % cfg.presets.length], theme = THEMES[k % THEMES.length], T = makeTrack({ seed: 5150 + k, params: { ...pr.params, theme } });
    const { C, n, dir, Dr } = frame(T), sim = simOn(T);
    for (const c of Dr.corners) {
      if (Math.abs(c.turn) < 20) continue;
      const i = ((c.from % n) + n) % n, v0 = Dr.speed[i] / 3.6, [tx, tz] = dir(i), off = Dr.line[i];
      const x = C.x[i] + tz * off, z = C.z[i] - tx * off;
      sim.resetCar({ position: [x, nearestOnTrack(T.data, x, z).h + 0.6, z], headingDeg: Math.atan2(tx, tz) * 180 / Math.PI, speed: v0 });
      sim.vehicle.sensor.take();
      let t = 0, hit: number | null = null, stopped = false;
      while (t < 25 && hit == null && !stopped) {
        const b = sim.vehicle.body, v = b.linvel(), sp = Math.hypot(v.x, v.z);
        sim.step({ ...IDLE, brake: t > 0.25 ? 1 : 0 });
        t += sim.dt;
        for (const e of sim.vehicle.sensor.take()) if (e.other === 'world' && BARRIER_MATERIALS.has(e.material) && !e.under) { hit = sp; break; }
        if (sp < 0.5 && t > 1) stopped = true;
      }
      const ok = stopped || (hit != null && (hit * 3.6 <= DT.runoff.maxImpactKmh || hit <= DT.runoff.slowedTo * v0));
      total++; if (ok) pass++;
      rows.push({ track: pr.id, theme, corner: c.n, kmh: Math.round(v0 * 3.6), outcome: stopped ? 'stopped' : hit != null ? `hit at ${Math.round(hit * 3.6)} km/h` : 'still going', ok });
    }
    sim.vehicle.world.free();
  }
  for (const r of rows.filter(r => !r.ok).slice(0, 6)) console.log(`        ${r.track} (${r.theme}) T${r.corner} at ${r.kmh} km/h: ${r.outcome}`);
  const share = pass / Math.max(1, total);
  report(share >= DT.runoff.minShare, `run-off: straight on at ${total} corners`, `${pass} of ${total} (${Math.round(share * 100)}%) stop, or hit at most ${DT.runoff.maxImpactKmh} km/h or ${Math.round(DT.runoff.slowedTo * 100)}% of the speed (target ${Math.round(DT.runoff.minShare * 100)}%)`);
}

// ---------- barriers: every type, 50 / 150 / 300 km/h, 15° / 45° / 90° ----------
if (want('barriers')) {
  const ctx: any = await crashContext(), car = ctx.db.cars[CAR], gar = ctx.garage(CAR);
  // tracks with every barrier type: a fast countryside circuit (armco, tyre walls) with a pit lane (the pit
  // wall, the garages' fronts), a street circuit (concrete)
  const tracks = [makeTrack({ seed: 77, params: { ...P('high_speed'), theme: 'countryside', pitLane: true } }), makeTrack({ seed: 78, params: { ...P('street_circuit'), theme: 'street' } })];
  const found: Record<string, any> = {};
  for (const T of tracks) for (const run of T.data.barriers.runs) {
    if (found[run.type]) continue;
    // a straight stretch of it: four pieces in a line
    for (let k = 7; k + 28 < run.pieces.length; k += 7) {
      const p = run.pieces, a = [p[k], p[k + 1], p[k + 2]], b = [p[k + 24], p[k + 25], p[k + 26]], m = [p[k + 10], p[k + 12]];
      const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz), mid = [(a[0] + b[0]) / 2, (a[2] + b[2]) / 2];
      if (L < 6 || Math.hypot(m[0] - mid[0], m[1] - mid[1]) > 0.05) continue;
      // (which side is the track's: towards the nearest centreline point)
      const t = nearestOnTrack(T.data, mid[0], mid[1]), tx = dx / L, tz = dz / L;
      let nx = tz, nz = -tx;
      if ((t.x - mid[0]) * nx + (t.z - mid[1]) * nz < 0) { nx = -nx; nz = -nz; }
      found[run.type] = { T, x: mid[0], y: (a[1] + b[1]) / 2, z: mid[1], tx, tz, nx, nz, thick: T.data.barriers.cfg.types[run.type].thickness };
      break;
    }
  }
  // each hit: the car `D` m short of the barrier, already going at the speed, at the angle to it
  const hit = (B: any, T: any, type: string, kmh: number, ang: number) => {
    const sim = simOn(T);
    const a = ang * Math.PI / 180, hx = B.tx * Math.cos(a) - B.nx * Math.sin(a), hz = B.tz * Math.cos(a) - B.nz * Math.sin(a), D = 7;
    const sx = B.x - hx * D + B.nx * 1.3, sz = B.z - hz * D + B.nz * 1.3;
    sim.resetCar({ position: [sx, B.y + 0.7, sz], headingDeg: Math.atan2(hx, hz) * 180 / Math.PI, speed: kmh / 3.6 });
    sim.vehicle.sensor.take();
    const dmg = new CarDamage({ car, build: gar.build, view: gar.view, boxes: ctx.boxesOf(car), rules: ctx.db.damage }), hits: number[] = [];
    let worst = Infinity, hitIt = false, beyondAll = -Infinity, first: any = null;
    for (let t = 0; t < 2.5; t += sim.dt) {
      sim.step(IDLE);
      for (const e of sim.vehicle.sensor.take()) { hits.push(e.strength); dmg.hit(e); if (BARRIER_MATERIALS.has(e.material)) { hitIt = true; first ??= e; } }
      // (how far on the track's side of the barrier's line the car is: through it, it'd be − its thickness
      // and more — there, and as it slides along it: past the barrier line nearest it)
      const p = sim.vehicle.body.translation();
      if (Math.hypot(p.x - B.x, p.z - B.z) < 6) worst = Math.min(worst, (p.x - B.x) * B.nx + (p.z - B.z) * B.nz);
      beyondAll = Math.max(beyondAll, pastBarrier(B.T, p.x, p.z, type === 'pitwall'));
    }
    sim.vehicle.world.free();
    const o = outcome(ctx.db, { car, damage: dmg }, hits, ctx.targets);
    return { type, kmh, ang, through: worst < -(B.thick / 2 + 0.5) || beyondAll > B.thick / 2 + 0.5, hitIt, strength: o.strength, repair: o.repair.full, minCondition: o.minCondition, first: first && { material: first.material, closing: +first.closing.toFixed(1), strength: +first.strength.toFixed(1) } };
  };
  const results: any[] = [];
  for (const [type, B] of Object.entries(found) as any) for (const kmh of DT.barrier.speeds) for (const ang of DT.barrier.angles) results.push(hit(B, B.T, type, kmh, ang));
  const through = results.filter(r => r.through), missed = results.filter(r => !r.hitIt);
  if (args.includes('--verbose')) for (const r of results) console.log(`        ${JSON.stringify(r)}`);
  report(Object.keys(found).length >= 5 && !through.length && !missed.length, `barriers: ${Object.keys(found).join(', ')} at ${DT.barrier.speeds.join('/')} km/h, ${DT.barrier.angles.join('/')}°`,
    `${results.length} hits, ${through.length} through${through.length ? ` (${through.map(r => `${r.type} ${r.kmh} km/h ${r.ang}°`).join(', ')})` : ''}, ${missed.length} not reaching the damage model`);
  // a tyre wall against concrete: the same wall, the same hits, built of concrete instead
  const B = found.tyres, D0 = B.T.data, asConcrete = { ...B.T, track: trackWorld({ ...D0, barriers: { ...D0.barriers, runs: D0.barriers.runs.map((r: any) => r.type === 'tyres' ? { ...r, type: 'concrete' } : r) } }) };
  const pairs = results.filter(r => r.type === 'tyres').map(r => [r, hit(B, asConcrete, 'concrete', r.kmh, r.ang)]);
  const softer = pairs.filter(([t, c]) => t.repair < c.repair || (t.repair <= c.repair + 5 && t.strength < c.strength));
  if (args.includes('--verbose')) for (const [t, c] of pairs) console.log(`        tyres ${JSON.stringify(t)}\n        concrete ${JSON.stringify(c)}`);
  report(pairs.length > 0 && softer.length === pairs.length, 'barriers: a tyre wall does less damage than concrete there',
    pairs.filter(([t]) => t.ang === 90).map(([t, c]) => `${t.kmh} km/h head-on: repair ${t.repair} vs ${c.repair}, condition ${t.minCondition} vs ${c.minCondition}`).join(' · ') + ` · softer in ${softer.length} of ${pairs.length} hits`);
}

// ---------- gravel: slows hard; a car rolling in slowly is beached ----------
if (want('gravel')) {
  const T = makeTrack({ seed: 3, params: { ...P('fast_flowing'), theme: 'countryside' } }), { C, n, dir, W, Dr } = frame(T), sim = simOn(T);
  let best = -1, bw = 0, side = 1;
  for (const s of [1, -1]) for (let i = 0; i < n; i++) { const su = (s > 0 ? Dr.surface.L : Dr.surface.R)[i], o = (s > 0 ? Dr.runoff.L : Dr.runoff.R)[i]; if (RUNOFF[su] === 'gravel' && o - W > bw) { bw = o - W; best = i; side = s; } }
  const [tx, tz] = dir(best), nx = tz * side, nz = -tx * side;
  const run = (kmh: number, beach = false) => {
    const a = 30 * Math.PI / 180, hx = tx * Math.cos(a) + nx * Math.sin(a), hz = tz * Math.cos(a) + nz * Math.sin(a);
    const sx = C.x[best] + nx * (W - 2) - hx * 6, sz = C.z[best] + nz * (W - 2) - hz * 6;
    sim.resetCar({ position: [sx, C.h[best] + 0.6, sz], headingDeg: Math.atan2(hx, hz) * 180 / Math.PI, speed: kmh / 3.6 });
    let t = 0, tIn = -1, vIn = 0, stopT: number | null = null, moved = 0, at: any = null;
    while (t < 16) {
      const b = sim.vehicle.body, v = b.linvel(), sp = Math.hypot(v.x, v.z);
      if (tIn < 0 && sim.vehicle.wheels.some((w: any) => w.surface?.name === 'gravel')) { tIn = t; vIn = sp; }
      if (tIn >= 0 && stopT == null && sp < 0.3) { stopT = t; const p = b.translation(); at = [p.x, p.z]; }
      const go = beach && stopT != null && t > stopT + 0.5;
      sim.step({ ...IDLE, throttle: go ? 1 : 0 });
      t += sim.dt;
    }
    if (at) { const p = sim.vehicle.body.translation(); moved = Math.hypot(p.x - at[0], p.z - at[1]); }
    return { kmh, vIn: vIn * 3.6, decel: stopT != null ? vIn / (stopT - tIn) : 0, stopped: stopT != null, moved };
  };
  const runs = DT.gravel.speeds.map((k: number) => run(k)), slow = run(DT.gravel.beachedBelowKmh - 10, true);
  report(runs.every((r: any) => r.stopped && r.decel >= DT.gravel.minDecel), `gravel: driven in at ${DT.gravel.speeds.join(' / ')} km/h`, runs.map((r: any) => `${r.kmh} km/h: stopped at ${r.decel.toFixed(1)} m/s² on average`).join(' · ') + ` (at least ${DT.gravel.minDecel})`);
  report(slow.stopped && slow.moved < 1, `gravel: rolling in at ${slow.kmh} km/h, then full throttle`, `beached: moved ${slow.moved.toFixed(2)} m in 15 s of trying`);
  sim.vehicle.world.free();
}

// ---------- kerbs: the AI on a line that uses them ----------
if (want('kerbs')) {
  const N = Math.min(8, +opt('--tracks', 8)), lines: string[] = [];
  let clean = 0, onKerbs = 0;
  for (let k = 0; k < N; k++) {
    const pr = cfg.presets[(k * 3) % cfg.presets.length], T: any = makeTrack({ seed: 610 + k, params: { ...pr.params, theme: THEMES[k % THEMES.length] } });
    // (the line allowed out to the road's edge and a little over, onto the kerbs: route/racingLine.js keeps a
    // margin and the outer tenth of a road's width, so its width here is widened to match)
    const W = T.data.width / 2, wide = (W + 1.3) / 0.4;
    for (const p of T.course.line) p.w = wide;
    const sim = simOn(T);
    const S = { sim, origin: [0, 0], toSim: (x: number, z: number) => [x, z], ground: (x: number, z: number) => nearestOnTrack(T.data, x, z).h, free() { sim.vehicle.world.free(); } };
    const xs = T.course.line.map((p: any) => p.x), zs = T.course.line.map((p: any) => p.z);
    const R = { region: 'track', M: { H }, course: T.course, stored: T.data.course, laps: 1, around: { cx: 0, cz: 0, radius: Math.max(...xs.map(Math.abs), ...zs.map(Math.abs)) } };
    let kerbSteps = 0, steps = 0, spin = 0;
    const onStep = ({ sim: s }: any) => {
      const v = s.vehicle; steps++;
      if (v.wheels.some((w: any) => w.surface?.name === 'kerb')) kerbSteps++;
      const av = v.body.angvel(); if (Math.abs(av.y) > 2.2 && Math.hypot(v.body.linvel().x, v.body.linvel().z) > 8) spin++;
    };
    const out: any = await runRace(R, { npcs: 0, seed: k, playerSkill: 0.85, S, onStep, limit: Math.max(300, (T.data.course.stats.estimatedTime ?? 100) * 3) });
    S.free();
    const res = out.res?.outcome, ok = res?.status === 'finished' && out.botResets === 0 && spin < 12;
    if (ok) clean++;
    if (kerbSteps > 0) onKerbs++;
    lines.push(`${pr.id}: ${res?.status ?? 'no result'}${out.botResets ? `, ${out.botResets} resets` : ''}, wheels on kerbs ${(kerbSteps / Math.max(1, steps) * 100).toFixed(1)}% of the lap${spin >= 12 ? ', spun' : ''}`);
  }
  for (const l of lines) console.log(`        ${l}`);
  report(clean === N && onKerbs === N, `kerbs: the Phase 4 AI using them on ${N} tracks`, `${clean} of ${N} clean (finished, no resets, no spins), on the kerbs on ${onKerbs} of ${N}`);
}

// ---------- 8-car races on dressed tracks: everyone finishes, the physics within budget ----------
if (want('races')) {
  const notes: string[] = [];
  let clean = 0, worstFrame = 0;
  const list = [['high_speed', 'countryside'], ['street_circuit', 'street'], ['mixed_gp', 'forest']];
  for (const [id, theme] of list) {
    const T = makeTrack({ seed: 4040, params: { ...P(id), theme } }), sim = simOn(T);
    const S = { sim, origin: [0, 0], toSim: (x: number, z: number) => [x, z], ground: (x: number, z: number) => nearestOnTrack(T.data, x, z).h, free() { sim.vehicle.world.free(); } };
    const xs = T.course.line.map((p: any) => p.x), zs = T.course.line.map((p: any) => p.z);
    const R = { region: 'track', M: { H }, course: T.course, stored: T.data.course, laps: 1, around: { cx: 0, cz: 0, radius: Math.max(...xs.map(Math.abs), ...zs.map(Math.abs)) } };
    const out: any = await runRace(R, { npcs: 7, seed: 3, playerSkill: 0.75, S, limit: 600 });
    S.free();
    const finished = out.standings.filter((s: any) => s.status === 'finished').length, stuck = out.events.filter((e: any) => e.type === 'npc-stuck').length;
    // (a frame at 60 fps is two physics steps)
    const frameMs = out.ms / out.steps * 2;
    worstFrame = Math.max(worstFrame, frameMs);
    if (finished === 8) clean++;
    notes.push(`${id} (${theme}, ${T.data.barriers.runs.reduce((a: number, r: any) => a + r.pieces.length / 7, 0)} barrier pieces): ${finished}/8 finished, ${stuck} stuck, physics ${frameMs.toFixed(2)} ms a frame`);
  }
  for (const n of notes) console.log(`        ${n}`);
  report(clean === list.length && worstFrame <= PERF.physicsMs8Cars, '8-car races on dressed tracks', `${clean} of ${list.length} with everyone finishing; physics at most ${worstFrame.toFixed(2)} ms a frame (budget ${PERF.physicsMs8Cars})`);
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
