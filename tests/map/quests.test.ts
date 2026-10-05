// Quests driven for real (Phase 4 Step 3): each quest type on a real route, driven start to finish in the
// physics on the baked world's own colliders by the simple test driver (route/autopilot.js), through the
// game's own quest controller (play/questController.js) and PlayerService — the fee taken, the countdown,
// the timing, the result validated and paid. Then the same scripted run at 30, 60 and 144 frames a
// second (the physics' fixed ticks underneath): the same time to the millisecond. Then 50 restarts and
// quits: the fees right, and no memory growing.
//
//   npm run test:quests                   all of it
//   npm run test:quests -- --only fps     one part (types, fps, restarts)

import { mapHarness } from './harness.ts';
import { createNetwork } from '../../route/network.js';
import { newRoute, saveCourse, viewCourse } from '../../route/model.js';
import { createAutopilot } from '../../route/autopilot.js';
import { createQuestController } from '../../play/questController.js';
import { LocalPlayerService } from '../../garage/player/service.js';
import { MemoryStorage } from '../../garage/player/storage.js';
import { MemoryRecordStore } from '../../quest/recordStore.js';
import { validateResult } from '../../quest/validate.js';
import { rewardsOf } from '../../content/quests.js';
import { REAL_ROUTES } from './realRoutes.ts';
import fs from 'node:fs';

const args = process.argv.slice(2), only = (() => { const i = args.indexOf('--only'); return i >= 0 ? args[i + 1].split(',') : null; })();
let failed = 0;
const report = (pass: boolean, name: string, detail: string) => { if (!pass) failed++; console.log(`${pass ? '  ok  ' : ' FAIL '} ${name.padEnd(46)} ${detail}`); };
const config = JSON.parse(fs.readFileSync(new URL('../../data/quests.json', import.meta.url), 'utf8'));

// the route: Monaco's, from the routes test
const region = 'monaco', R = REAL_ROUTES[region];
const M = await mapHarness(region), { H, manifest, P } = M;
const N = createNetwork(M.graph(), { P, region, version: manifest.version });
const { course: stored } = saveCourse(N, { ...newRoute(region, R.kind), waypoints: R.waypoints.map(([lat, lon]) => ({ lat, lon })) });
const course: any = viewCourse(stored, P);
const xs = course.line.map(p => p.x), zs = course.line.map(p => p.z);
const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2, radius = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2 + 300;
const spec = H.garage(null, 'starter_car').stats().spec;
// (a fresh simulation for each run that's compared: nothing of the car carried over from the one before)
let S = await M.simAround(cx, cz, { radius, spec }), sim = S.sim;
const dt = sim.dt;
async function freshSim() { S.free(); S = await M.simAround(cx, cz, { radius, spec }); sim = S.sim; }
console.log(`  ${region}: ${(course.length / 1000).toFixed(2)} km, ${course.gates.length} checkpoints, estimate ${stored.stats.estimatedTime} s, route version ${course.version}`);

async function playerService() {
  const p = new LocalPlayerService({ db: H.db, storage: new MemoryStorage(), quests: { config, recordings: new MemoryRecordStore() } });
  await p.init();
  await p.addMoney(1e6);
  return p;
}

// The game's adapters for the Node physics: the car put down on the road, held, let go, reset
function adapters() {
  let held = false, throttle = 0;
  const v = () => sim.vehicle;
  const place = (pt: any, speed = 0) => {
    const [sx, sz] = S.toSim(pt.x, pt.z), y = S.ground(pt.x, pt.z, pt.h + 30, false, 200) ?? pt.h;
    sim.resetCar({ position: [sx, y + 0.3, sz], headingDeg: pt.heading, speed });
  };
  const holdStep = sim.onStep(() => { if (!held) return; const b = v().body; b.setLinvel({ x: 0, y: Math.min(0, b.linvel().y), z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true); });
  return {
    setThrottle(t: number) { throttle = t; },
    get held() { return held; },
    onStep: (fn: any) => sim.onStep(s => fn(s.time, s.dt)),
    place: (pt: any) => place(pt),
    hold() { held = true; },
    release({ speed = 0 } = {}) {
      held = false;
      if (speed > 0) { const b = v().body, q = b.rotation(), fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y), m = Math.hypot(fx, fz) || 1; b.setLinvel({ x: fx / m * speed, y: 0, z: fz / m * speed }, true); }
    },
    resetTo: (pt: any) => place(pt),
    ready: () => true,
    carState() {
      const b = v().body, p = b.translation(), q = b.rotation(), l = b.linvel();
      const fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y), m = Math.hypot(fx, fz) || 1;
      return { x: p.x + S.origin[0], y: p.y, z: p.z + S.origin[1], q: [q.x, q.y, q.z, q.w], vx: l.x, vy: l.y, vz: l.z, fx: fx / m, fz: fz / m, throttle, drivable: true, condition: 100, impulse: 0 };
    },
    free() { holdStep(); },
  };
}

// a run: the controller started, then the physics advanced a frame at a time at fps, the test driver's
// input worked out for each physics step (so the frame rate doesn't change what it does)
async function play(quest: any, { fps = 60, startMode = null, player = null as any, limit = 600 } = {}) {
  player ??= await playerService();
  const A = adapters(), pilot = createAutopilot(course.line, { loop: course.loop });
  const C = createQuestController({ quest, course, config, player, car: { instanceId: player.profile.currentCar, carId: 'starter_car', topSpeed: 70 }, adapters: A, startMode });
  const st = await C.start({ intro: false });
  if (!st.ok) { A.free(); C.dispose(); return { error: st.error }; }
  const input = () => {
    if (C.state !== 'racing') { A.setThrottle(0); return { device: 'wheel', throttle: 0, brake: 1, steer: 0, handbrake: false }; }
    const c = A.carState(), sp = c.vx * c.fx + c.vz * c.fz;
    const cmd = pilot.drive({ x: c.x, z: c.z, fx: c.fx, fz: c.fz, speed: sp, dt });
    A.setThrottle(cmd.throttle);
    return { device: 'wheel', throttle: cmd.throttle, brake: cmd.brake, steer: cmd.steer, handbrake: false };
  };
  let t = 0;
  for (; t < limit && !C.ending; t += 1 / fps) sim.advance(1 / fps, input);
  const res = C.ending ? await C.ending : null;
  A.free(); C.dispose();
  return { res, C, player, t };
}

const base = { kind: 'quest', version: 3, updated: '2026-01-01T00:00:00Z', route: 'r', fee: 100, rewards: { tier: 'standard' }, entry: { classes: [], minLevel: 1 }, enabled: true };
const est = stored.stats.estimatedTime;
const TYPES: any[] = [
  { id: 'sprint', type: 'sprint', params: { laps: 1 } },
  { id: 'time_trial', type: 'time_trial', params: { laps: 1, targetSeconds: Math.round(est * 2) } },
  { id: 'checkpoint', type: 'checkpoint', params: { laps: 1, timeLimitSeconds: Math.round(est * 4) } },
  { id: 'drift', type: 'drift', params: { scoreTarget: 300 } },
  { id: 'delivery', type: 'delivery', params: { cargo: { name: 'Flowers', massKg: 20, fragile: true }, damagePenalty: 0.5, timeLimitSeconds: Math.round(est * 4) } },
  { id: 'rolling', type: 'sprint', params: { laps: 1, start: 'rolling' } },
];

if (!only || only.includes('types')) {
  for (const T of TYPES) {
    const quest = { ...base, id: `q_${T.id}`, name: T.id, type: T.type, params: T.params };
    const { res, player, error } = await play(quest) as any;
    if (error) { report(false, `${T.id}: started`, error); continue; }
    const o = res?.outcome, v = res?.result ? validateResult(res.result, { quest, course, config }) : null, pay = res?.pay;
    report(o?.status === 'finished' && v?.ok && pay?.valid && player.profile.quests[quest.id].completed,
      `${T.id}: driven to the finish, a valid result`,
      `${o ? `${o.status} ${o.time?.toFixed(3) ?? ''} s${o.score != null ? `, score ${o.score}` : ''}${o.medal ? `, ${o.medal}` : ''}, ${o.splits.length}/${course.gates.filter(g => g.required).length} checkpoints, paid ${pay?.money ?? 0}` : 'no outcome'}${v && !v.ok ? ` — ${v.problems.join('; ')}` : ''}${o?.text ? ` (${o.text})` : ''}`);
  }
}

if (!only || only.includes('fps')) {
  const quest = { ...base, id: 'q_fps', name: 'fps', type: 'sprint', params: { laps: 1 } };
  const times: number[] = [];
  for (const fps of [30, 60, 144]) { await freshSim(); const { res } = await play(quest, { fps }) as any; times.push(res?.outcome?.time ?? NaN); }
  const spread = Math.max(...times) - Math.min(...times);
  report(spread <= 0.001, 'the same run at 30, 60, 144 fps', `${times.map(t => t.toFixed(4)).join(' / ')} s (spread ${(spread * 1000).toFixed(3)} ms)`);
}

if (!only || only.includes('restarts')) {
  // (a Club-tier quest, so its entry costs something: the fee comes from its tier — data/economy.json — and
  // the player is levelled up to it)
  const player = await playerService(), quest: any = { ...base, id: 'q_restart', name: 'restart', type: 'sprint', params: { laps: 1 }, rating: { stars: 4, km: 1.15 } };
  const fee = rewardsOf(quest, player.db.economy).fee;
  await player.addXp(5000);
  const A = adapters(), m0 = player.profile.money;
  const C = createQuestController({ quest, course, config, player, car: { instanceId: player.profile.currentCar, topSpeed: 70 }, adapters: A });
  const gc = (globalThis as any).gc;
  const heap = () => { gc?.(); gc?.(); return process.memoryUsage().heapUsed; };
  await C.start({ intro: false });
  let h0 = 0;
  for (let i = 0; i < 50; i++) {
    for (let k = 0; k < 30; k++) sim.advance(1 / 60, { device: 'wheel', throttle: 0, brake: 1, steer: 0, handbrake: false });
    if (i % 2) await C.restart({ intro: false });
    else { await C.quit(); await C.start({ intro: false }); }
    if (i === 9) h0 = heap();
  }
  await C.quit();
  const h1 = heap(), listeners = (sim as any).onStep(() => {}); listeners();
  const P = player.profile.quests[quest.id];
  // 51 starts (the first and 50 more), every one charged (restarts aren't free in the config)
  report(fee > 0 && m0 - player.profile.money === 51 * fee && P.attempts === 51 && P.dnfs === 51, '50 restarts and quits: fees and attempts right', `paid ${m0 - player.profile.money} for 51 starts (${fee} each), ${P.attempts} attempts, ${P.dnfs} DNFs`);
  report(h1 - h0 < 4e6, '50 restarts and quits: no memory growth', `heap ${((h1 - h0) / 1e6).toFixed(2)} MB from restart 10 to 50${gc ? '' : ' (run with --expose-gc)'}`);
  A.free(); C.dispose();
}

S.free();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
