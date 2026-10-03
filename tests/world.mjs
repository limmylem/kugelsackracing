// The baked world's tests (the low-poly real world, tools/world/bake.mjs), headless, on the tiles in
// assets/world/<region>/ — decoded and collided with exactly as the game does (tests/worldHarness.mjs):
//
//   height     at every test spot, 20 random points on the drawn roads: the physics' surface there is the
//              drawn road's (within 0.1 m); the drawn ground is just under the road (never through it,
//              never far below: no floating roads); a car put down there sits on its four tyres, on what's
//              drawn under each. The elevation data's own height there is reported (cuttings and
//              embankments differ from it on purpose).
//   rails      railings, parapets and walls hit at 50, 100, 200 and 300 km/h, shallow and steep: no car
//              ever ends up through one, and every hit reaches the damage model.
//   streaming  a 20 km route through the region at 200 km/h, with the game's own streamer
//              (world/streamer.js) and tiles arriving as slowly as data/world/performance.json's network
//              says: the ground under the car is always there (it never has to wait for loading).
//   memory     the same run, past 100 tiles loaded and dropped: memory and colliders stay flat.
//   physics    the Phase 1 test suite's straight-line tests (0–100, quarter mile, 100–0, the same at
//              any frame rate) on a real road, against the car's targets.
//
//   npm run test:world                         all of them
//   npm run test:world -- --only rails,height  some
//   npm run test:world -- --region sf          another baked region
//   npm run test:world -- --verbose            every measurement

import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { worldHarness } from './worldHarness.mjs';
import { createWorldStream } from '../world/streamer.js';
import { tileColliders } from '../world/tilePhysics.js';
import { barrierShape } from '../world/barriers.js';
import { createSimulation } from '../physics/sim.js';
import { createRun, evaluate, pathThrough } from '../physics/testSuite.js';
import { CarDamage } from '../garage/carDamage.js';

const args = process.argv.slice(2), opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const only = opt('--only')?.split(',').map(s => s.trim()), verbose = args.includes('--verbose'), region = opt('--region') ?? 'sf';
const W = await worldHarness(region), { H, manifest, T } = W;
const perf = JSON.parse(fs.readFileSync(path.join(W.root, 'data/world/performance.json'), 'utf8'));
const CAR = 'starter_car', garage = H.garage(null, CAR), spec = garage.stats().spec;
const KMH = 1 / 3.6, IDLE = { device: 'wheel', throttle: 0, brake: 0, steer: 0, handbrake: false };
const rows = [];
const report = (test, name, pass, detail) => { rows.push({ test, name, pass, detail }); console.log(`${pass ? '  ok  ' : ' FAIL '} ${name.padEnd(46)} ${detail}`); };
const note = s => { if (verbose) console.log(`         ${s}`); };
const rng = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const spots = manifest.spots ?? [];

// ---------- shared ----------
// the heights of a mesh (tile-local) at (x, z): every triangle's there
function meshHeights(m, x, z) {
  const out = [];
  if (!m) return out;
  const P = m.positions, I = m.indices;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    if (Math.max(P[a], P[b], P[c]) < x || Math.min(P[a], P[b], P[c]) > x || Math.max(P[a + 2], P[b + 2], P[c + 2]) < z || Math.min(P[a + 2], P[b + 2], P[c + 2]) > z) continue;
    const d = (P[b + 2] - P[c + 2]) * (P[a] - P[c]) + (P[c] - P[b]) * (P[a + 2] - P[c + 2]);
    if (Math.abs(d) < 1e-9) continue;
    const l1 = ((P[b + 2] - P[c + 2]) * (x - P[c]) + (P[c] - P[b]) * (z - P[c + 2])) / d, l2 = ((P[c + 2] - P[a + 2]) * (x - P[c]) + (P[a] - P[c]) * (z - P[c + 2])) / d, l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    out.push(l1 * P[a + 1] + l2 * P[b + 1] + l3 * P[c + 1]);
  }
  return out;
}
// the height of a mesh (tile-local) at (x, z): its triangle there (the one nearest `near`, for layered
// roads), or null
function meshHeight(m, x, z, near = null) {
  if (!m) return null;
  const P = m.positions, I = m.indices;
  let best = null;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    if (Math.max(P[a], P[b], P[c]) < x || Math.min(P[a], P[b], P[c]) > x || Math.max(P[a + 2], P[b + 2], P[c + 2]) < z || Math.min(P[a + 2], P[b + 2], P[c + 2]) > z) continue;
    const d = (P[b + 2] - P[c + 2]) * (P[a] - P[c]) + (P[c] - P[b]) * (P[a + 2] - P[c + 2]);
    if (Math.abs(d) < 1e-9) continue;
    const l1 = ((P[b + 2] - P[c + 2]) * (x - P[c]) + (P[c] - P[b]) * (z - P[c + 2])) / d, l2 = ((P[c + 2] - P[a + 2]) * (x - P[c]) + (P[a] - P[c]) * (z - P[c + 2])) / d, l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    const y = l1 * P[a + 1] + l2 * P[b + 1] + l3 * P[c + 1];
    if (near == null) return y;
    if (best == null || Math.abs(y - near) < Math.abs(best - near)) best = y;
  }
  return best;
}
const tileOf = (x, z) => [Math.floor(x / T), Math.floor(z / T)];
const local = (x, z, [i, j]) => [x - (i + 0.5) * T, z - (j + 0.5) * T];
// what's drawn at a place (world frame) nearest a height: road, car park, footpath or the ground
// (top: the highest at or below it, what's seen from above)
async function drawnHeight(x, z, near, top = false) {
  const k = tileOf(x, z), d = await W.tile(...k);
  if (!d) return null;
  const [lx, lz] = local(x, z, k);
  let best = null;
  for (const name of ['roads', 'paved', 'paths', 'cover', 'terrain0']) {
    for (const y of meshHeights(d.meshes[name], lx, lz)) {
      if (top ? y <= near + 1e-3 && (best == null || y > best) : best == null || Math.abs(y - near) < Math.abs(best - near)) best = y;
    }
  }
  return best;
}
// the ground's colliders only (terrain, roads, car parks, paths): what the tyres stand on
const groundOnly = c => c.userData?.material === 'ground';
function groundRay(S, x, z, fromY, reach = 50) {
  const [sx, sz] = S.toSim(x, z), R = H.RAPIER;
  const hit = S.sim.vehicle.world.castRay(new R.Ray({ x: sx, y: fromY, z: sz }, { x: 0, y: -1, z: 0 }), reach, true, undefined, undefined, undefined, S.sim.vehicle.body, groundOnly);
  return hit ? fromY - hit.timeOfImpact : null;
}
// random points on a place's roads: on the named streets within `radius` (length-weighted), up to
// 1.5 m either side of the centre line, at the drawn road's surface there (the top one: a bridge over
// a street is what's seen)
async function roadPoints(S, [x, z], count, rnd, radius = 250) {
  const segs = [];
  for (const key of S.loaded.keys()) {
    const [i, j] = key.split('_').map(Number), d = await W.tile(i, j), L = d.lists.streets?.data;
    if (!L || !d.meshes.roads) continue;
    for (let q = 0; q < L.length; q += 6) {
      const ax = L[q] + (i + 0.5) * T, az = L[q + 1] + (j + 0.5) * T, bx = L[q + 2] + (i + 0.5) * T, bz = L[q + 3] + (j + 0.5) * T, l = Math.hypot(bx - ax, bz - az);
      if (l > 0.5 && Math.hypot((ax + bx) / 2 - x, (az + bz) / 2 - z) < radius) segs.push({ ax, az, bx, bz, l });
    }
  }
  const total = segs.reduce((s, q) => s + q.l, 0), out = [];
  for (let tries = 0; out.length < count && segs.length && tries < count * 20; tries++) {
    let r = rnd() * total, g = segs[segs.length - 1];
    for (const q of segs) { r -= q.l; if (r <= 0) { g = q; break; } }
    const t = rnd(), side = (rnd() * 2 - 1) * 1.5, ux = (g.bx - g.ax) / g.l, uz = (g.bz - g.az) / g.l;
    const px = g.ax + (g.bx - g.ax) * t - uz * side, pz = g.az + (g.bz - g.az) * t + ux * side, k = tileOf(px, pz), d = await W.tile(...k);
    if (!d?.meshes.roads) continue;
    const ys = meshHeights(d.meshes.roads, ...local(px, pz, k));
    if (!ys.length) continue;
    out.push({ x: px, y: Math.max(...ys), z: pz, tile: k, heading: Math.atan2(ux, uz) * 180 / Math.PI });
  }
  return out;
}
// the nearest street's direction at a place (degrees, the game's heading: 0 = +z), or 0
async function streetHeading(x, z) {
  const k = tileOf(x, z), d = await W.tile(...k), S = d?.lists.streets?.data;
  if (!S) return 0;
  const [lx, lz] = local(x, z, k);
  let best = 8, h = 0;
  for (let q = 0; q < S.length; q += 6) {
    const ax = S[q], az = S[q + 1], dx = S[q + 2] - ax, dz = S[q + 3] - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((lx - ax) * dx + (lz - az) * dz) / l2)), dd = Math.hypot(lx - ax - dx * t, lz - az - dz * t);
    if (dd < best) { best = dd; h = Math.atan2(dx, dz) * 180 / Math.PI; }
  }
  return h;
}
let elevation = undefined;
async function demAt(lat, lon) {
  if (elevation === undefined) {
    elevation = null;
    try {
      const reg = JSON.parse(fs.readFileSync(path.join(W.root, 'data/world/regions', `${region}.json`), 'utf8'));
      const files = (reg.dem?.local ?? []).flatMap(L => L.files).map(f => path.join(W.root, '.cache/world/dem', path.basename(f)));
      if (files.length && files.every(f => fs.existsSync(f))) {
        const { openDem } = await import('../tools/world/dem.mjs'), b = reg.bbox, dem = await openDem(reg.dem, { cacheDir: path.join(W.root, '.cache/world'), bbox: [b[1], b[0], b[3], b[2]] });
        elevation = { dem, samplers: new Map() };
      }
    } catch { elevation = null; }
  }
  if (!elevation) return null;
  const key = `${Math.floor(lat * 100)}_${Math.floor(lon * 100)}`;
  if (!elevation.samplers.has(key)) elevation.samplers.set(key, await elevation.dem.sampler([Math.floor(lat * 100) / 100, Math.floor(lon * 100) / 100, Math.floor(lat * 100) / 100 + 0.01, Math.floor(lon * 100) / 100 + 0.01]));
  return elevation.samplers.get(key).height(lat, lon);
}
const quantile = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
const rotate = (q, [x, y, z]) => { const v = new THREE.Vector3(x, y, z).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w)); return [v.x, v.y, v.z]; };

// ---------- height ----------
// (the drawn ground may sit as far under a road as the road's edge dips: the skirt hides the gap)
const skirt = JSON.parse(fs.readFileSync(path.join(W.root, 'data/world/bake.json'), 'utf8')).terrain.skirtDrop + 0.02;
async function heightTest() {
  console.log('\nHeights: the drawn roads, the physics and the ground at every test spot');
  const rnd = rng(20261002);
  for (const spot of spots) {
    const S = await W.simAround(...spot.xz, { radius: 300 }), pts = await roadPoints(S, spot.xz, 20, rnd);
    if (pts.length < 20) { report('height', spot.name, false, `only ${pts.length} road points (is it baked?)`); continue; }
    let physWorst = 0, over = 0, under = 0, onBridge = 0, covered = 0, tyreWorst = 0, settledBad = 0;
    const demDiff = [];
    for (const p of pts) {
      // what the tyres would stand on there (the first solid ground below) against what's drawn on top
      const phys = groundRay(S, p.x, p.z, p.y + 0.5), top = await drawnHeight(p.x, p.z, p.y + 0.5, true);
      physWorst = Math.max(physWorst, phys == null || top == null ? Infinity : Math.abs(phys - top));
      // the drawn ground under the road: just below it (bridges and tunnels apart)
      const d = await W.tile(...p.tile), [lx, lz] = local(p.x, p.z, p.tile), ground = meshHeight(d.meshes.terrain0, lx, lz), gap = p.y - ground;
      if (gap > 1) onBridge++;
      else if (gap < -0.5) covered++;
      else {
        over = Math.max(over, -gap); under = Math.max(under, gap);
        const [lat, lon] = W.P.toLatLon(p.x, p.z), dem = await demAt(lat, lon);
        if (dem != null) demDiff.push(p.y - dem);
      }
      note(`${spot.name}: road ${p.y.toFixed(2)}, tyres would be on ${phys?.toFixed(3)}, drawn on top ${top?.toFixed(3)}, the ground ${gap >= 0 ? `${gap.toFixed(3)} below` : `${(-gap).toFixed(3)} OVER`} it`);
    }
    // a car put down on the first five: on four tyres, each on what's drawn
    for (const p of pts.slice(0, 5)) {
      const v = S.sim.vehicle;
      S.sim.resetCar({ position: [...S.toSim(p.x, p.z)].flatMap((c, k) => k === 0 ? [c, p.y + 0.05] : [c]), headingDeg: p.heading });
      for (let s = 0; s < 1.5 / S.sim.dt; s++) S.sim.step(IDLE);        // (parked: the hold keeps it still)
      const four = v.wheels.every(w => w.grounded), moved = Math.hypot(v.body.translation().x - S.toSim(p.x, p.z)[0], v.body.translation().z - S.toSim(p.x, p.z)[1]);
      if (!four || moved > 0.6) { settledBad++; note(`${spot.name}: the car at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}: ${v.wheels.map(w => w.grounded ? 'on' : 'OFF').join(' ')}, moved ${moved.toFixed(2)} m`); }
      for (const w of v.wheels) if (w.grounded) {
        const [wx, wz] = [w.contact[0] + S.origin[0], w.contact[2] + S.origin[1]], drawn = await drawnHeight(wx, wz, w.contact[1]);
        if (drawn != null) tyreWorst = Math.max(tyreWorst, Math.abs(w.contact[1] - drawn));
      }
    }
    const dem = demDiff.length ? ` · roads against the elevation data: median ${quantile(demDiff.map(Math.abs), 0.5).toFixed(2)} m, most ${Math.max(...demDiff.map(Math.abs)).toFixed(1)} m` : '';
    const pass = physWorst <= 0.1 && over <= 0.02 && under <= skirt && tyreWorst <= 0.1 && !settledBad;
    report('height', `${spot.name} (${spot.kind})`, pass, `physics vs drawn ≤ ${physWorst.toFixed(3)} m · the drawn ground ${under.toFixed(2)} m under the road at most${over > 0 ? `, ${over.toFixed(2)} m over it` : ''} (${onBridge} on bridges, ${covered} in tunnels) · tyres on the drawn surface within ${tyreWorst.toFixed(3)} m${settledBad ? ` · ${settledBad} of 5 cars didn't settle` : ''}${dem}`);
  }
}

// ---------- rails ----------
// straight runs of railing near a place: pieces end to end, nearly in line, at least `min` m long
async function railRuns(S, [x, z], min = 30) {
  const runs = [];
  for (const key of S.loaded.keys()) {
    const [i, j] = key.split('_').map(Number), d = await W.tile(i, j), ox = (i + 0.5) * T, oz = (j + 0.5) * T;
    for (const [name, L] of Object.entries(d.lists)) {
      if (!name.startsWith('barrier_')) continue;
      const D = L.data, type = name.slice(8), st = L.stride;
      let run = null;
      const flush = () => {
        if (!run || run.length < 2) return;
        const a = run[0], b = run[run.length - 1], len = Math.hypot(b[0] - a[0], b[2] - a[2]);
        if (len < min) return;
        const ux = (b[0] - a[0]) / len, uz = (b[2] - a[2]) / len, off = Math.max(...run.map(p => Math.abs((p[0] - a[0]) * -uz + (p[2] - a[2]) * ux)));
        if (off < 0.6) runs.push({ type, a, b, len, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], u: [ux, uz], dist: Math.hypot((a[0] + b[0]) / 2 - x, (a[2] + b[2]) / 2 - z) });
      };
      for (let k = 0; k + 5 < D.length; k += st) {
        const p0 = [D[k] + ox, D[k + 1], D[k + 2] + oz], p1 = [D[k + 3] + ox, D[k + 4], D[k + 5] + oz];
        if (run && Math.hypot(run.at(-1)[0] - p0[0], run.at(-1)[2] - p0[2]) < 0.05) run.push(p1);
        else { flush(); run = [p0, p1]; }
      }
      flush();
    }
  }
  return runs.sort((p, q) => p.dist - q.dist);
}
// the tyre surface at a place (world frame), from its tile's surface grid
function surfaceNameAt(x, z) {
  const k = tileOf(x, z), d = W.cached?.(k[0], k[1]), G = d?.grids.surface;
  if (!G) return null;
  const lx = x - k[0] * T, lz = z - k[1] * T, c = Math.min(G.n - 1, Math.max(0, Math.floor(lx / G.cell))), r = Math.min(G.n - 1, Math.max(0, Math.floor(lz / G.cell)));
  return G.names[G.data[r * G.n + c]];
}
// a run's foot at its middle: the piece there
async function railFoot(run) {
  const k = tileOf(run.mid[0], run.mid[2]), d = await W.tile(...k), L = d?.lists[`barrier_${run.type}`];
  if (!L) return null;
  let best = null, bd = 3;
  for (let q = 0; q + 5 < L.data.length; q += L.stride) {
    const x = (L.data[q] + L.data[q + 3]) / 2 + (k[0] + 0.5) * T, z = (L.data[q + 2] + L.data[q + 5]) / 2 + (k[1] + 0.5) * T, dd = Math.hypot(x - run.mid[0], z - run.mid[2]);
    if (dd < bd) { bd = dd; best = { foot: (L.data[q + 1] + L.data[q + 4]) / 2, h: L.stride > 6 ? L.data[q + 6] : barrierShape(run.type, manifest.barriers).height }; }
  }
  return best;
}
async function railTest() {
  console.log('\nRailings: hit at speed, shallow and steep — never through');
  const ctx = (await import('./harness.mjs')).crashContext, cc = await ctx(), car = H.db.cars[CAR];
  // (one run of each kind, the ones along roads first)
  // (one run of each kind: guard rails on the mountain road, parapets on the bridge, concrete barriers
  // at the interchange where there are; the nearest a car could actually drive into)
  const kinds = ['guard_rail', 'parapet', 'jersey_barrier', 'wall', 'retaining_wall', 'fence'], candidates = new Map(kinds.map(k => [k, []]));
  const prefer = { guard_rail: 'mountain', parapet: 'bridge', jersey_barrier: 'interchange' };
  for (const spot of spots) {
    const S = await W.simAround(...spot.xz, { radius: 600 });
    for (const r of await railRuns(S, spot.xz)) if (kinds.includes(r.type)) candidates.get(r.type).push({ ...r, spot, rank: (prefer[r.type] === spot.id ? 0 : 1e6) + (r.type === 'parapet' ? -r.mid[1] * 100 : r.dist) });   // (a bridge's parapets: the highest deck)
  }
  const half = spec.bodyCollider.halfExtents, centre = spec.bodyCollider.centre;
  let tested = 0;
  for (const type of kinds) for (const run of candidates.get(type).sort((p, q) => p.rank - q.rank).slice(0, 12)) {
    const S = await W.simAround(run.mid[0], run.mid[2], { radius: 300 }), sh = barrierShape(run.type, manifest.barriers);
    // the side a car would come from: road beside it, level, the railing standing well above it
    const at = await railFoot(run);
    if (!at) continue;
    const sideAt = (sd, d) => [run.mid[0] - run.u[1] * d * sd, run.mid[2] + run.u[0] * d * sd];
    // (a drawn road at the railing's own level: on a bridge the deck, not what's under it)
    const roadSide = sd => [2, 3.5, 5].some(d => { const [x, z] = sideAt(sd, d), k = tileOf(x, z), t = W.cached(...k); return !!t?.meshes.roads && meshHeights(t.meshes.roads, ...local(x, z, k)).some(y => Math.abs(y - at.foot) < 1.2); });
    const approach = sd => { const ys = [1.5, 3, 5].map(d => groundRay(S, ...sideAt(sd, d), at.foot + at.h + 6, 30)); return ys.every(y => y != null && Math.abs(y - ys[0]) < 0.8) && at.foot + at.h - ys[0] > 0.7; };
    const sides = [1, -1].filter(sd => roadSide(sd) && approach(sd));
    note(`${run.type} at ${run.spot.name} (${run.mid.map(v => v.toFixed(0)).join(', ')}): road ${[1, -1].map(roadSide)}, approach ${[1, -1].map(approach)}, foot ${at.foot.toFixed(1)} h ${at.h.toFixed(2)}`);
    if (!sides.length) continue;
    const foot = at.foot;
    tested++;
    let worst = 0, through = 0, unhit = 0, undamaged = 0, n_ = 0;
    const lines = [];
    for (const side of sides) for (const kmh of [50, 100, 200, 300]) for (const [label, deg] of [['shallow', 15], ['steep', 60]]) {
      const n = [-run.u[1] * side, run.u[0] * side];          // (the side's normal, out of the rail)
      const S2 = await W.simAround(run.mid[0], run.mid[2], { radius: 300 }), v = S2.sim.vehicle, a = deg * Math.PI / 180;
      // heading into the rail at that angle, aimed at the run's middle, the body just clear of it
      const dir = [run.u[0] * Math.cos(a) - n[0] * Math.sin(a), run.u[1] * Math.cos(a) - n[1] * Math.sin(a)];
      const reach = half[0] * Math.cos(a) + half[2] * Math.sin(a) + sh.colliderThickness / 2 + 0.3, back = reach / Math.sin(a);
      const sx = run.mid[0] - dir[0] * back, sz = run.mid[2] - dir[1] * back, y = groundRay(S2, sx, sz, foot + 6, 12) ?? foot;
      const [px, pz] = S2.toSim(sx, sz);
      S2.sim.resetCar({ position: [px, y + 0.05, pz], headingDeg: Math.atan2(dir[0], dir[1]) * 180 / Math.PI, speed: kmh * KMH });
      const damage = new CarDamage({ car, build: garage.build, view: garage.view, boxes: cc.boxesOf(car), rules: H.db.damage });
      let hits = 0, deepest = 0;
      for (let s = 0; s < 2 / S2.sim.dt; s++) {
        S2.sim.step(IDLE);
        for (const im of v.sensor.take()) if (im.other === 'world') { hits++; damage.hit(im); }
        // how far past the rail's road-side face any corner of the body got (the far side: through it)
        const p = v.body.translation(), q = v.body.rotation();
        for (const cx of [-1, 1]) for (const cz of [-1, 1]) {
          const c = rotate(q, [centre[0] + cx * half[0], centre[1], centre[2] + cz * half[2]]), wx = p.x + c[0] + S2.origin[0], wz = p.z + c[2] + S2.origin[1];
          const along = (wx - run.mid[0]) * run.u[0] + (wz - run.mid[2]) * run.u[1];
          if (Math.abs(along) > run.len / 2 - 1) continue;      // (round the ends doesn't count)
          const past = -((wx - run.mid[0]) * n[0] + (wz - run.mid[2]) * n[1]) - sh.colliderThickness / 2;
          deepest = Math.max(deepest, past);
        }
      }
      const p = v.body.translation(), wx = p.x + S2.origin[0], wz = p.z + S2.origin[1], along = (wx - run.mid[0]) * run.u[0] + (wz - run.mid[2]) * run.u[1];
      const centreThrough = (wx - run.mid[0]) * n[0] + (wz - run.mid[2]) * n[1] < -sh.colliderThickness / 2 && Math.abs(along) < run.len / 2;
      const shell = damage.damage.shell?.condition ?? 100, hurt = shell < 100 || Object.values(damage.owned).some(x => x.condition < 100 || Object.keys(x.damage ?? {}).length);
      n_++;
      worst = Math.max(worst, deepest);
      if (centreThrough || deepest > 0.6) through++;
      if (!hits) unhit++;
      if (kmh >= 100 && !hurt) undamaged++;
      lines.push(`side ${side > 0 ? 'A' : 'B'}, ${kmh} km/h ${label}: ${hits} hits, deepest ${deepest.toFixed(2)} m past its face, shell ${shell.toFixed(0)}%${centreThrough ? ' THROUGH' : ''}`);
    }
    for (const l of lines) note(`${run.type} at ${run.spot.name}: ${l}`);
    report('rails', `${run.type.replace('_', ' ')} (${run.spot.name}, ${run.len.toFixed(0)} m run)`, !through && !unhit && !undamaged,
      `${n_} hits at 50–300 km/h, 15° and 60°, from ${sides.length === 2 ? 'both sides' : 'the road side'}: ${through ? `${through} THROUGH` : 'none through'}, deepest corner ${worst.toFixed(2)} m into it${unhit ? `, ${unhit} never touched it` : ''}${undamaged ? `, ${undamaged} left no damage` : ', every hit damaged the car'}`);
    break;
  }
  if (!tested) report('rails', 'railings', false, 'no railing beside a road at any test spot');
}

// ---------- streaming and memory ----------
// a route through the test spots (straight lines between them), the first `km` of it, points every 2 m
function spotRoute(km) {
  const order = ['city', 'tunnel', 'interchange', 'mountain', 'suburb', 'coast', 'carpark', 'bridge'], pts = [manifest.spawn.xz, ...order.map(k => spots.find(s => s.id === k)?.xz).filter(Boolean)];
  const out = [];
  for (let q = 0; q + 1 < pts.length; q++) {
    const [ax, az] = pts[q], [bx, bz] = pts[q + 1], l = Math.hypot(bx - ax, bz - az);
    for (let s = 0; s < l; s += 2) { out.push([ax + (bx - ax) * s / l, az + (bz - az) * s / l]); if (out.length * 2 >= km * 1000) return out; }
  }
  return out;
}
async function streamingTest() {
  console.log(`\nStreaming: ${perf.streaming.routeKm} km at ${perf.streaming.speedKmh} km/h, tiles over a ${perf.network.megabytesPerSecond} MB/s, ${perf.network.latencyMs} ms network`);
  const route = spotRoute(perf.streaming.routeKm), speed = perf.streaming.speedKmh * KMH, N = perf.network;
  const missing = new Set();
  for (const [x, z] of route) { const [i, j] = tileOf(x, z); if (!manifest.tiles.some(t => t.i === i && t.j === j)) missing.add(`${i}_${j}`); }
  if (missing.size) { report('streaming', 'the route is baked', false, `${missing.size} tiles on the route aren't baked (npm run world:bake -- --region ${region})`); return; }
  // the game's streamer, headless: tiles decoded here, delivered when the network would have
  let clock = 0, pipeFree = 0;
  const pending = [], decodeMs = [];
  const loadTile = async key => {
    const [i, j] = key.split('_').map(Number), bytes = manifest.tiles.find(t => t.i === i && t.j === j).bytes, t0 = performance.now();
    const tile = await W.tile(i, j);
    decodeMs.push(performance.now() - t0);
    const start = Math.max(clock, pipeFree);
    pipeFree = start + bytes / (N.megabytesPerSecond * 1e6) * 1000;
    return new Promise(resolve => pending.push({ at: pipeFree + N.latencyMs + perf.targets.tileDecodeMs, resolve: () => resolve({ type: 'tile', key, tile, bytes, cached: false, ms: 0 }) }));
  };
  const [sx, sz] = route[0], track = { surfaces: manifest.surfaces, offRoad: 'grass', spawn: { position: [0, 0, 0], headingDeg: 0 }, roads: [] };
  const sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets: H.socketsOf(spec), track });
  const m2 = { ...manifest, spawn: { ...manifest.spawn, xz: [sx, sz] } };
  const S = await createWorldStream({ manifestUrl: null, scene: new THREE.Scene(), sim, RAPIER: H.RAPIER, options: { headless: true, manifest: m2, loadTile, now: () => clock } });
  const body = sim.vehicle.body, dt = 1 / 60;
  const step = async (x, z, vx, vz) => {
    clock += dt * 1000;
    for (let k = pending.length - 1; k >= 0; k--) if (pending[k].at <= clock) { pending[k].resolve(); pending.splice(k, 1); }
    await new Promise(r => setImmediate(r));
    const [px, pz] = S.toSim(x, z), y = body.translation().y;
    body.setTranslation({ x: px, y, z: pz }, true); body.setLinvel({ x: vx, y: 0, z: vz }, true); body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    const out = S.update([px, y, pz], [vx, 0, vz], dt);
    sim.step(IDLE);
    return out;
  };
  // the start: as the game does, wait for the ground (the time to drivable, with this network)
  let waited = 0;
  while (!S.readyAround(...S.toSim(sx, sz), 30) && waited < 60) { await step(sx, sz, 0, 0); waited += dt; }
  const gc = globalThis.gc ?? (() => {}), mem = [];
  let notReady = 0, falls = 0, worstAhead = Infinity, seen = new Set(), dropped = 0, maxTiles = 0, maxColliders = 0, frames = 0;
  const startHeap = (gc(), process.memoryUsage().heapUsed);
  let along = 0, k = 0;
  while (k + 1 < route.length) {
    along += speed * dt;
    k = Math.min(route.length - 1, Math.floor(along / 2));
    const [x, z] = route[k], [nx, nz] = route[Math.min(route.length - 1, k + 1)], l = Math.hypot(nx - x, nz - z) || 1;
    await step(x, z, (nx - x) / l * speed, (nz - z) / l * speed);
    frames++;
    // the ground under the car: there, and solid
    const [px, pz] = S.toSim(x, z);
    if (!S.readyAround(px, pz, 0)) notReady++;
    else if (S.groundBelow(px, pz, 900, 2000) == null) falls++;
    // how far ahead along the route the ground is ready
    if (frames % 15 === 0) {
      let ahead = 0;
      for (let q = k; q < route.length && ahead < 400; q += 10, ahead += 20) if (!S.readyAround(...S.toSim(...route[q]), 0)) break;
      worstAhead = Math.min(worstAhead, ahead);
    }
    for (const key of S.tiles.keys()) seen.add(key);
    dropped = seen.size - S.tiles.size;
    maxTiles = Math.max(maxTiles, S.tiles.size); maxColliders = Math.max(maxColliders, S.status.colliders);
    if (frames % 600 === 0) { gc(); mem.push({ km: along / 1000, tiles: seen.size, heap: process.memoryUsage().heapUsed, colliders: S.status.colliders, held: S.tiles.size }); note(`${(along / 1000).toFixed(1)} km: ${seen.size} tiles loaded so far, ${S.tiles.size} held, ${S.status.colliders} colliders, heap ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB`); }
  }
  const pass = !notReady && !falls;
  report('streaming', `${(along / 1000).toFixed(1)} km at ${perf.streaming.speedKmh} km/h`, pass,
    `${notReady ? `ground not ready under the car for ${(notReady * dt).toFixed(1)} s` : 'the ground was always ready'}${falls ? `, ${falls} frames with nothing under the car` : ''} · ready ≥ ${worstAhead === Infinity ? '—' : worstAhead} m ahead at worst · first ground after ${(waited).toFixed(1)} s · ${seen.size} tiles in, ${maxTiles} at once · decode ${quantile(decodeMs, 0.5)?.toFixed(0)} ms median`);
  // memory: after the first 30 tiles, it should stay level however many more come and go
  const base = mem.find(m => m.tiles >= 30) ?? mem[0], last = mem.at(-1);
  if (!base || seen.size < 100) { report('memory', '100 tiles in and out', false, `only ${seen.size} tiles loaded on the route`); return; }
  const growth = (last.heap - base.heap) / 1e6;
  const memPass = growth < perf.targets.memoryGrowthMB && last.held <= maxTiles && dropped >= seen.size - maxTiles;
  report('memory', `${seen.size} tiles in, ${dropped} dropped again`, memPass, `heap ${(base.heap / 1e6).toFixed(0)} MB at ${base.tiles} tiles → ${(last.heap / 1e6).toFixed(0)} MB at ${last.tiles} (${growth >= 0 ? '+' : ''}${growth.toFixed(0)} MB, at most ${perf.targets.memoryGrowthMB}) · colliders at most ${maxColliders}, ${last.colliders} at the end · from ${(startHeap / 1e6).toFixed(0)} MB before`);
  S.dispose();
}

// ---------- the Phase 1 tests on a real road ----------
async function physicsTest() {
  const spot = spots.find(s => s.id === 'coast') ?? spots[0];
  console.log(`\nThe straight-line tests on a real road: ${spot.name}`);
  // the longest straight-ish stretch of the named road there
  const S0 = await W.simAround(...spot.xz, { radius: 1200 }), segs = [];
  for (const key of S0.loaded.keys()) {
    const [i, j] = key.split('_').map(Number), d = await W.tile(i, j), L = d.lists.streets?.data, names = d.header.names;
    if (!L) continue;
    for (let q = 0; q < L.length; q += 6) if (names[L[q + 4]] === spot.name) segs.push([[L[q] + (i + 0.5) * T, L[q + 1] + (j + 0.5) * T], [L[q + 2] + (i + 0.5) * T, L[q + 3] + (j + 0.5) * T]]);
  }
  // (chained end to end, one carriageway)
  const chains = [];
  for (const s of segs) { const c = chains.find(c => Math.hypot(c.at(-1)[0] - s[0][0], c.at(-1)[1] - s[0][1]) < 0.5); if (c) c.push(s[1]); else chains.push([s[0], s[1]]); }
  for (let merged = true; merged;) { merged = false; for (const a of chains) for (const b of chains) if (a !== b && a.length && b.length && Math.hypot(a.at(-1)[0] - b[0][0], a.at(-1)[1] - b[0][1]) < 0.5) { a.push(...b.slice(1)); b.length = 0; merged = true; } }
  const lengthOf = c => c.reduce((s, p, q) => q ? s + Math.hypot(p[0] - c[q - 1][0], p[1] - c[q - 1][1]) : 0, 0);
  const road = chains.filter(c => c.length).sort((a, b) => lengthOf(b) - lengthOf(a))[0];
  if (!road || lengthOf(road) < 900) { report('physics', 'a real road', false, `no stretch of ${spot.name} long enough (${road ? lengthOf(road).toFixed(0) : 0} m)`); return; }
  // resampled every 2 m, in the simulations' frame (origin at the start's tile)
  const pts = [];
  for (let q = 0, s = 0; q + 1 < road.length; q++) { const [a, b] = [road[q], road[q + 1]], l = Math.hypot(b[0] - a[0], b[1] - a[1]); for (; s < l; s += 2) pts.push([a[0] + (b[0] - a[0]) * s / l, a[1] + (b[1] - a[1]) * s / l]); s -= l; }
  // (only the part that's baked, its longest unbroken stretch)
  const baked = ([x, z]) => { const [i, j] = tileOf(x, z); return manifest.tiles.some(t => t.i === i && t.j === j); };
  let bestRun = [], cur = [];
  for (const p of pts) { if (baked(p)) { cur.push(p); if (cur.length > bestRun.length) bestRun = cur; } else cur = []; }
  // (and of that, the longest stretch within a metre of a straight line: these are straight-line tests)
  let best = [0, 0];
  for (let a = 0, b = 1; b < bestRun.length; b++) {
    const off = (a_, b_) => { const [ax, az] = bestRun[a_], [bx, bz] = bestRun[b_], l = Math.hypot(bx - ax, bz - az) || 1; let m = 0; for (let q = a_; q <= b_; q += 3) m = Math.max(m, Math.abs((bestRun[q][0] - ax) * (bz - az) - (bestRun[q][1] - az) * (bx - ax)) / l); return m; };
    while (a < b && off(a, b) > 1) a++;
    if (b - a > best[1] - best[0]) best = [a, b];
  }
  pts.length = 0; pts.push(...bestRun.slice(best[0], best[1] + 1));
  if (pts.length * 2 < 900) { report('physics', 'a real road', false, `only ${pts.length * 2} m of ${spot.name} baked`); return; }
  const origin = [Math.floor(pts[0][0] / T) * T, Math.floor(pts[0][1] / T) * T], simPts = pts.map(([x, z]) => [x - origin[0], z - origin[1]]);
  const path_ = pathThrough(simPts, 2), h = Math.atan2(path_.points[0].tx, path_.points[0].tz);
  const strip = { x: simPts[0][0], z: simPts[0][1], h, remaining: pts.length * 2, path: path_ };
  // every simulation gets the tiles along it, and its cars put down on the road
  const tiles = new Set(pts.flatMap(([x, z]) => { const [i, j] = tileOf(x, z); return [-1, 0, 1].flatMap(a => [-1, 0, 1].map(b => `${i + a}_${j + b}`)); }));
  const decoded = [];
  for (const key of tiles) { const [i, j] = key.split('_').map(Number), d = await W.tile(i, j); if (d) decoded.push({ i, j, d }); }
  const prepare = sim => {
    for (const { i, j, d } of decoded) sim.addStatic({ position: [(i + 0.5) * T - origin[0], 0, (j + 0.5) * T - origin[1]] }, tileColliders(d, H.RAPIER, manifest.barriers).pieces);
    sim.step(IDLE);
    // tyre grip from the tiles' surface grid, as the game's streamer gives it
    const surfaces = Object.entries(manifest.surfaces).map(([name, v]) => ({ name, ...v }));
    sim.vehicle.surfaceAt = (x, z) => { const n = surfaceNameAt(x + origin[0], z + origin[1]); return surfaces.find(q => q.name === n) ?? surfaces[0]; };
    const reset = sim.resetCar.bind(sim), R = H.RAPIER;
    sim.resetCar = pose => {
      const [x, , z] = pose.position, hit = sim.vehicle.world.castRay(new R.Ray({ x, y: 900, z }, { x: 0, y: -1, z: 0 }), 2000, true, undefined, undefined, undefined, sim.vehicle.body, groundOnly);
      reset({ ...pose, position: [x, hit ? 900 - hit.timeOfImpact : 0, z] });
    };
  };
  const targets = JSON.parse(fs.readFileSync(path.join(W.root, `tests/targets/${CAR}.json`), 'utf8'));
  const track = { surfaces: manifest.surfaces, offRoad: 'grass', spawn: { position: [strip.x, 0, strip.z], headingDeg: 0 }, roads: [] };
  const ctx = { RAPIER: H.RAPIER, settings: H.settings, spec, sockets: H.socketsOf(spec), track, place: () => ({ strip }), prepare, pace: targets.pace };
  for (const id of ['zeroTo100', 'quarterMile', 'braking', 'framerate']) {
    const run = createRun(ctx, id);
    while (!run.done) { run.next(process.env.TRACE ? 60 : 5000); if (process.env.TRACE && run.sim) { const b = run.sim.vehicle.body, p = b.translation(), l = b.linvel(); note(`${id} t ${run.sim.time.toFixed(1)} pos ${p.x.toFixed(1)},${p.y.toFixed(2)},${p.z.toFixed(1)} v ${l.x.toFixed(1)},${l.y.toFixed(1)},${l.z.toFixed(1)} wheels ${run.sim.vehicle.wheels.map(w => w.grounded ? w.surface?.name : "-").join(",")} kmh ${(run.sim.vehicle.forwardSpeed() * 3.6).toFixed(0)}`); } }
    const row = evaluate([run.result], targets)[0], t = row.target;
    const value = row.value == null ? (row.pass ? 'yes' : 'no') : `${row.value.toFixed(row.digits)} ${row.unit}`;
    report('physics', `${row.name} on ${spot.name}`, row.pass, `${value}${t ? ` (target ${t.min ?? ''}–${t.max ?? ''})` : ''} ${row.detail ?? ''}`);
  }
}

const TESTS = { height: heightTest, rails: railTest, streaming: streamingTest, physics: physicsTest };
const t0 = performance.now();
console.log(`The baked world's tests: ${manifest.name} (${manifest.tiles.length} tiles, bake ${manifest.version})`);
for (const [id, fn] of Object.entries(TESTS)) if (!only || only.includes(id) || (id === 'streaming' && only.includes('memory'))) await fn();
const failed = rows.filter(r => !r.pass);
console.log(`\n${rows.length - failed.length} of ${rows.length} passed in ${((performance.now() - t0) / 1000).toFixed(0)} s${failed.length ? ` — failed: ${failed.map(r => `${r.test}: ${r.name}`).join('; ')}` : ''}\n`);
process.exit(failed.length ? 1 : 0);
