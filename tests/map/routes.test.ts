// Routes on real roads (Phase 4 Step 2): one route in each of five baked regions in five countries —
// city streets (Monaco), a city's steep streets (Tokyo, Shibuya), a mountain pass (Stelvio), a motorway
// (Munich, A9) and a loop through roundabouts (Milton Keynes) — and the game's own San Francisco; each
// routed from a few clicks, then driven in
// the physics on the baked world's own colliders by a simple autopilot (route/autopilot.js) from grid slot
// 1 to the finish, through every checkpoint in order, with the tracker (route/tracker.js) watching: no
// resets, never off the route, never the wrong way.
//
//   npm run test:routes                      all five
//   npm run test:routes -- --only stelvio    one
//   npm run test:routes -- --verbose         the drive, every few seconds

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { mapHarness } from './harness.ts';
import { createNetwork } from '../../route/network.js';
import { compileRoute, newRoute } from '../../route/model.js';
import { createTracker } from '../../route/tracker.js';
import { createAutopilot } from '../../route/autopilot.js';
import { REAL_ROUTES } from './realRoutes.ts';


const args = process.argv.slice(2), opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const only = opt('--only')?.split(','), verbose = args.includes('--verbose');
let failed = 0;
const report = (pass: boolean, name: string, detail: string) => { if (!pass) failed++; console.log(`${pass ? '  ok  ' : ' FAIL '} ${name.padEnd(44)} ${detail}`); };

for (const [region, R] of Object.entries(REAL_ROUTES)) {
  if (only && !only.includes(region)) continue;
  const M = await mapHarness(region), { H, manifest, P } = M;
  const N = createNetwork(M.graph(), { P, region, version: manifest.version });
  const route = { ...newRoute(region, R.kind), waypoints: R.waypoints.map(([lat, lon]) => ({ lat, lon })) };
  const t0 = performance.now(), c = compileRoute(N, route), ms = performance.now() - t0;
  const errors = c.problems.filter(p => p.level === 'error');
  report(errors.length === 0 && c.length > 1000, `${region}: routes (${R.what})`, `${(c.length / 1000).toFixed(2)} km, ${c.stats?.turns} turns, ${Math.round(ms)} ms${errors.length ? ` — ${errors.map(e => e.message).join('; ')}` : ''}`);
  if (errors.length) continue;
  const classes = new Set(c.built.segments.map(s => N.byKey.get(s.key).class));
  const wantRoads = (R.roads ?? []).every(n => c.stats.roads.includes(n)), wantClasses = (R.classes ?? []).every(k => classes.has(k));
  report(wantRoads && wantClasses && c.built.uturns.length === 0 && (c.stats.turns >= (R.minTurns ?? 0)), `${region}: the roads expected`, `${c.stats.roads.slice(0, 6).join(', ')}${c.stats.roads.length > 6 ? '…' : ''}${R.classes ? ` [${[...classes].join(', ')}]` : ''}; U-turns ${c.built.uturns.length}`);

  // the drive: every tile of the region loaded (they're small), the car on grid slot 1
  const xs = c.line.map(p => p.x), zs = c.line.map(p => p.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2, radius = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2 + 300;
  const spec = H.garage(null, 'starter_car').stats().spec;
  const S = await M.simAround(cx, cz, { radius, spec });
  const sim = S.sim, v = sim.vehicle, slot = c.grid.slots[0];
  const place = (x: number, z: number, heading: number, h: number) => { const [sx, sz] = S.toSim(x, z), y = S.ground(x, z, h + 30, false, 200) ?? h; sim.resetCar({ position: [sx, y + 0.3, sz], headingDeg: heading }); };
  place(slot.x, slot.z, slot.heading, slot.h);
  const T = createTracker({ line: c.line, loop: c.loop, startS: c.grid.startS, finishS: c.grid.finishS, checkpoints: c.checkpoints, laps: R.laps ?? 1 });
  T.begin(slot.x, slot.z).start();
  // (left- or right-hand traffic doesn't matter on closed roads: the middle of the road)
  const A = createAutopilot(c.line, { loop: c.loop });
  const dt = 1 / 120, limit = Math.max(120, c.stats.estimatedTime * 3);
  const ev: any[] = [];
  let t = 0, worstOff = 0, top = 0;
  for (; t < limit && !T.state.finished; t += dt) {
    const b = v.body, p = b.translation(), q = b.rotation(), lin = b.linvel();
    // (the car's forward: its +z turned by its rotation)
    const fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y), fm = Math.hypot(fx, fz) || 1;
    const wx = p.x + S.origin[0], wz = p.z + S.origin[1], speed = lin.x * fx / fm + lin.z * fz / fm;
    top = Math.max(top, speed);
    const cmd = A.drive({ x: wx, z: wz, fx: fx / fm, fz: fz / fm, speed, dt });
    sim.step({ device: 'wheel', throttle: cmd.throttle, brake: cmd.brake, steer: cmd.steer, handbrake: false });
    for (const e of T.update(dt, { x: wx, z: wz, vx: lin.x, vz: lin.z })) {
      ev.push({ ...e, t });
      if (e.type === 'reset') { place(e.point.x, e.point.z, e.point.heading, e.point.h); T.resetTo(e.point); }
    }
    worstOff = Math.max(worstOff, Math.abs(T.state.d) - (c.line[Math.min(c.line.length - 1, T.state.k ?? 0)]?.w ?? 0) / 2);
    if (verbose && Math.round(t * 120) % 120 === 0) console.log(`         ${t.toFixed(0)} s  ${T.state.s.toFixed(0)} m  ${(speed * 3.6).toFixed(0)} km/h (want ${(cmd.target * 3.6).toFixed(0)})  across ${T.state.d.toFixed(1)} m  throttle ${cmd.throttle.toFixed(2)} brake ${cmd.brake.toFixed(2)} steer ${cmd.steer.toFixed(2)}  y ${(p.y - c.line[T.state.k].h).toFixed(2)} gear ${v.drivetrain?.gear}`);
  }
  S.free();
  const cps = ev.filter(e => e.type === 'checkpoint').length, bad = ev.filter(e => ['reset', 'leave', 'wrongway', 'missed'].includes(e.type));
  report(T.state.finished && cps === c.checkpoints.length * (R.laps ?? 1) && bad.length === 0, `${region}: driven to the finish`,
    `${T.state.finished ? `${T.state.time.toFixed(1)} s` : `not finished (${(T.state.s / 1000).toFixed(2)} km in ${t.toFixed(0)} s)`}, ${cps}/${c.checkpoints.length * (R.laps ?? 1)} checkpoints, top ${(top * 3.6).toFixed(0)} km/h, estimate ${c.stats.estimatedTime} s${bad.length ? `; ${bad.map(e => `${e.type} at ${e.t.toFixed(0)} s`).slice(0, 4).join(', ')}` : ''}`);
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
