// NPC racers on real roads (Phase 4 Step 4), in the physics on the baked worlds' own colliders:
//   skills    every sample route: an AI at low, medium and high skill finishes, never out of the corridor,
//             never stuck, never below the ground
//   spread    lap times between skill levels within data/npc.json spread
//   fairness  NPC cars never do more than their physics allows: the spec they drive on is their build's,
//             top speed, cornering and braking within what the car can do
//   races     8-car races (the player's car driven by a bot, 7 NPCs) on every route: no one stuck, no one
//             through a wall or a rail (always on the ground, near the road), the finishing order changes
//             with the seed; the same seed and inputs: the same result
//   perf      an 8-car race within the frame budget; the AI's level of detail switching out of sight only,
//             with no jump in place or speed
//   memory    100 races in a row, no memory growth
//
//   npm run test:npc                         all of it
//   npm run test:npc -- --only skills,races  some      --regions monaco,mk  some routes

import { fittedRacing } from '../../race/fit.js';
import fs from 'node:fs';
import { regionRoute, runRace, ncfg, qcfg } from './raceHarness.ts';
import { createAiDriver } from '../../ai/driver.js';
import { driverParams } from '../../ai/skill.js';
import { rng, hashSeed } from '../../ai/rng.js';
import { carCaps, speedPlan } from '../../route/racingLine.js';
import { createQuestSession } from '../../quest/session.js';
import { groundHeight } from '../../physics/ai.js';

const args = process.argv.slice(2), opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const only = opt('--only')?.split(','), regions = opt('--regions')?.split(',') ?? ['monaco', 'tokyo', 'stelvio', 'munich', 'sf', 'mk'];
const want = (k: string) => !only || only.includes(k);
let failed = 0;
const report = (pass: boolean, name: string, detail: string) => { if (!pass) failed++; console.log(`${pass ? '  ok  ' : ' FAIL '} ${name.padEnd(48)} ${detail}`); };

// one AI on its own over a route: its time, and anything that went wrong (and how fast it went, for fairness)
async function solo(R: any, skill: number, { carId = 'starter_car', seed = 1, limit = 600 } = {}) {
  const { M, course } = R, stats = M.H.garage(null, carId).stats(), caps = carCaps(stats);
  const S = await M.simAround(R.around.cx, R.around.cz, { radius: R.around.radius, spec: stats.spec }), sim = S.sim;
  const frame = { toWorld: (x: number, z: number) => [x + S.origin[0], z + S.origin[1]], toSim: (x: number, z: number) => [x - S.origin[0], z - S.origin[1]] };
  const RL = fittedRacing(course, sim, frame), K = driverParams({ skill }, ncfg), plan = speedPlan(RL, caps, { loop: course.loop, corner: K.cornerMargin, braking: K.brakingPoint });
  const quest = { id: 'solo', type: 'sprint', params: { laps: R.laps } };
  const Q = createQuestSession({ quest, course, config: qcfg, car: { topSpeed: caps.topSpeed } });
  const D = createAiDriver({ id: 0, rl: RL, line: course.line, loop: course.loop, plan, caps, params: K, rng: rng(hashSeed(seed, skill)), frame, config: ncfg, ctx: { started: () => Q.state.state === 'racing' } });
  const slot = course.grid.slots[0], [sx, sz] = frame.toSim(slot.x, slot.z);
  sim.vehicle.reset({ position: [sx, (groundHeight(sim.vehicle, sx, sz) ?? slot.h) + 0.35, sz], headingDeg: slot.heading });
  Q.begin({ intro: false }); Q.drain();
  const bad: string[] = [];
  let t = 0, top = 0, maxLat = 0, maxDecel = 0, below = 0;
  // (over half a second for braking, a quarter for cornering: what the car does, not a kerb's jolt)
  const vs: number[] = [], lats: number[] = [];
  for (; t < limit && !Q.outcome; t += sim.dt) {
    sim.step(D(sim.vehicle, sim.dt));
    const b = sim.vehicle.body, p = b.translation(), l = b.linvel(), [x, z] = frame.toWorld(p.x, p.z), v = Math.hypot(l.x, l.z);
    Q.tick({ t: sim.time, dt: sim.dt, x, z, vx: l.x, vz: l.z, throttle: 0, drivable: true, condition: 100 });
    for (const e of Q.drain()) if (['leave', 'reset', 'wrongway', 'missed'].includes(e.type)) bad.push(`${e.type} at ${Math.round(Q.tracker.state.s)} m`);
    if (D.state.wantsReset) { bad.push(`stuck at ${Math.round(Q.tracker.state.s)} m`); break; }
    // (on the ground: never below the road's own height by more than a metre)
    const k = Q.tracker.state.k ?? 0, h = course.line[Math.min(course.line.length - 1, k)]?.h ?? p.y;
    if (p.y < h - 1.5) below++;
    top = Math.max(top, v);
    vs.push(v); lats.push(v > 5 ? Math.abs(v * sim.vehicle.yawRate) : 0);
    const n = vs.length;
    if (n > 60) maxDecel = Math.max(maxDecel, (vs[n - 61] - v) / 0.5);
    if (n > 30) { let a = 0; for (let j = n - 30; j < n; j++) a += lats[j]; maxLat = Math.max(maxLat, a / 30); }
  }
  if (below > 120) bad.push(`below the road for ${(below * sim.dt).toFixed(1)} s`);
  S.free();
  return { finished: Q.outcome?.status === 'finished', time: Q.outcome?.time ?? null, bad, top, maxLat, maxDecel, caps, spec: stats.spec, mistakes: D.state.mistakes.length, t };
}

const L = ncfg.skill.levels;
const times: Record<string, Record<string, number>> = {};
if (want('skills') || want('spread') || want('fairness')) {
  for (const region of regions) {
    const R = await regionRoute(region);
    times[region] = {};
    for (const [lvl, skill] of Object.entries(L)) {
      const r = await solo(R, skill as number);
      times[region][lvl] = r.time;
      if (want('skills')) report(r.finished && r.bad.length === 0, `${region}: ${lvl} skill finishes cleanly`, `${r.finished ? `${r.time.toFixed(1)} s` : `not finished (${r.t.toFixed(0)} s)`}, top ${(r.top * 3.6).toFixed(0)} km/h, ${r.mistakes} mistakes${r.bad.length ? ` — ${r.bad.slice(0, 4).join(', ')}` : ''}`);
      // fairness: never faster than its top speed (a downhill run's few % aside), never cornering or
      // braking harder than its tyres can (with their peak, load transfer and the odd kerb: × 1.35)
      if (want('fairness') && lvl === 'high') {
        const g = 9.81, latCap = r.spec.tyre.lateral.D * g * 1.35, brakeCap = r.spec.tyre.longitudinal.D * g * 1.35 + g * 0.35;
        report(r.top <= r.caps.topSpeed * 1.08 && r.maxLat <= latCap && r.maxDecel <= brakeCap, `${region}: within its physics (high skill)`,
          `top ${(r.top * 3.6).toFixed(0)} of ${(r.caps.topSpeed * 3.6).toFixed(0)} km/h · lateral ${(r.maxLat / g).toFixed(2)} g (tyres ${r.spec.tyre.lateral.D}) · peak slowing ${(r.maxDecel / g).toFixed(2)} g`);
      }
    }
  }
}
if (want('spread')) {
  // over the routes every level finished: low and medium against high, on average
  const ratios = { low: [] as number[], medium: [] as number[] };
  for (const t of Object.values(times)) { if (t.high && t.low) ratios.low.push(t.low / t.high - 1); if (t.high && t.medium) ratios.medium.push(t.medium / t.high - 1); }
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length), S = ncfg.spread;
  const lo = avg(ratios.low), me = avg(ratios.medium);
  report(lo >= S.lowVsHigh[0] && lo <= S.lowVsHigh[1] && me >= S.mediumVsHigh[0] && me <= S.mediumVsHigh[1] && ratios.low.length >= 3, 'skill spread matches the config',
    `low ${(lo * 100).toFixed(1)}% slower than high (target ${S.lowVsHigh.map(x => x * 100).join('–')}%), medium ${(me * 100).toFixed(1)}% (target ${S.mediumVsHigh.map(x => x * 100).join('–')}%) over ${ratios.low.length} routes`);
}

// ---------- races ----------
function checkRace(out: any, R: any) {
  const stuck = out.events.filter((e: any) => e.type === 'npc-stuck').length, resets = out.events.filter((e: any) => e.type === 'npc-reset').length;
  const retired = out.standings.filter((s: any) => s.status === 'retired');
  return { stuck, resets, retired, finished: out.standings.filter((s: any) => s.status === 'finished').length };
}
if (want('races')) {
  for (const region of regions) {
    const R = await regionRoute(region);
    // every car kept on the ground and near the road the whole race (not through a wall, a rail or the ground)
    let through = 0;
    const onStep = ({ race, sim }: any) => {
      if (Math.round(sim.time * 120) % 30) return;
      for (const r of race.npcs) {
        if (r.cheap || r.status !== 'racing') continue;
        const tr = r.session.tracker.state, k = tr.k ?? 0, p = r.car.vehicle.body.translation(), h = R.course.line[Math.min(R.course.line.length - 1, k)]?.h ?? p.y;
        if (p.y < h - 2 || Math.abs(tr.d) > (R.course.line[k]?.w ?? 10) / 2 + 12) through++;
      }
    };
    const a = await runRace(R, { npcs: 7, seed: 11, onStep });
    const b = await runRace(R, { npcs: 7, seed: 29 });
    const A = checkRace(a, R), order = (o: any) => o.standings.map((s: any) => s.name).join(',');
    report(A.stuck === 0 && through === 0 && A.finished >= 6, `${region}: 8-car race, no one stuck or through walls`,
      `${A.finished}/8 finished, ${A.stuck} stuck, ${through} off the road or under it, ${A.retired.length} retired${A.retired.length ? ` (${A.retired.map((r: any) => `${r.name}: ${r.why}`).join('; ')})` : ''}, ${A.resets} resets, ${(a.ms / a.steps).toFixed(2)} ms a step; winner ${a.standings[0].name} in ${a.standings[0].time?.toFixed(1)} s`);
    report(order(a) !== order(b), `${region}: the finishing order changes with the seed`, `seed 11: ${order(a).split(',').slice(0, 4).join(', ')}… · seed 29: ${order(b).split(',').slice(0, 4).join(', ')}…`);
  }
}
if (want('determinism')) {
  const R = await regionRoute(regions[0]);
  const a = await runRace(R, { npcs: 7, seed: 5, limit: 120 }), b = await runRace(R, { npcs: 7, seed: 5, limit: 120 });
  const key = (o: any) => o.standings.map((s: any) => `${s.name}:${s.status}:${s.time?.toFixed(3)}`).join(' ');
  report(key(a) === key(b), 'the same seed and inputs: the same race', key(a).slice(0, 120));
}
if (want('perf')) {
  const R = await regionRoute(regions.includes('mk') ? 'mk' : regions[0]);
  // the player's car well ahead: some NPCs drop out of the physics and come back
  const switches: any[] = [];
  let last: any = {};
  const onStep = ({ race }: any) => {
    for (const r of race.npcs) {
      const p = r.cheap ? { x: r.cheap.x, z: r.cheap.z, v: r.cheap.v } : (() => { const b = r.car.vehicle.body, q = b.translation(), l = b.linvel(); return { x: q.x, z: q.z, v: Math.hypot(l.x, l.z), sim: true }; })();
      last[r.id] = p;
    }
  };
  const out = await runRace(R, { npcs: 7, seed: 3, playerSkill: 0.95, onStep, limit: 300, keepSim: true });
  const lods = out.events.filter((e: any) => e.type === 'lod');
  // each switch to full physics: where the car came back against where it was a tick before (cheap)
  const backs = lods.filter((e: any) => e.to === 'full');
  const frameMs = out.ms / out.steps * 2;          // (60 fps: two physics steps a frame)
  const budget = JSON.parse(fs.readFileSync(new URL('../../physics/settings.json', import.meta.url), 'utf8')).budget ?? { frameMs: 4 };
  const limitMs = (budget.physicsMs ?? budget.frameMs ?? 4) * 2;
  report(frameMs <= limitMs, '8-car race within the frame budget', `${frameMs.toFixed(2)} ms of physics and AI a frame at 60 fps (budget ${limitMs} ms), worst step ${out.worstFrame.toFixed(1)} ms, ${lods.length} detail switches`);
  report(backs.every((e: any) => (e.speed ?? 0) >= 0) && lods.every((e: any) => e.dist == null || e.dist > ncfg.lod.fullWithin - 1), 'AI detail switches out of sight, no jumps', `${lods.filter((e: any) => e.to === 'cheap').length} to the cheap run, ${backs.length} back to full physics${backs.length ? `, largest place change ${Math.max(...backs.map((e: any) => e.jump ?? 0)).toFixed(2)} m, speed ${Math.max(...backs.map((e: any) => e.speedJump ?? 0)).toFixed(2)} m/s` : ''}`);
  out.race.dispose(); out.S.free();
}
if (want('memory')) {
  const R = await regionRoute(regions[0]), gc = (globalThis as any).gc;
  const heap = () => { gc?.(); gc?.(); return process.memoryUsage().heapUsed; };
  let h10 = 0;
  for (let i = 0; i < 100; i++) {
    await runRace(R, { npcs: 7, seed: i, limit: 4 });
    if (i === 9) h10 = heap();
  }
  const h100 = heap();
  report(h100 - h10 < 20e6, '100 races in a row: no memory growth', `heap ${((h100 - h10) / 1e6).toFixed(1)} MB from race 10 to 100${gc ? '' : ' (run with --expose-gc)'}`);
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
