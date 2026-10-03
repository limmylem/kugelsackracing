// Map v3's tests (MAP_README.md), headless, on the baked region in assets/map/<region>/ — decoded and
// collided with exactly as the game does (tests/map/harness.ts):
//
//   roads        every OSM node of every baked road: where the baked centre line has it against where
//                OpenStreetMap does (largest difference, target < 0.5 m); and the drawn road through it
//   height       200 random road points: the drawn road, the physics' surface and the road's smoothed
//                elevation profile agree within 0.1 m
//   seams        every pair of neighbouring tiles: the same heights along their shared edge (physics), the
//                drawn ground meeting there (and skirted), no step
//   datum        where LiDAR meets Copernicus: no step (the blend), and the two sources agreeing on the
//                ground once in one datum
//   rails        railings hit at 50, 100, 200 and 300 km/h, 15° and 60°: never through
//   streaming    a 20 km route at 200 km/h with the game's streamer: the ground always there
//   memory       the same run, past 100 tiles: memory and colliders level
//   determinism  a small area baked twice: identical tiles and graph, byte for byte
//   physics      the Phase 1 straight-line tests on a real road, against the car's targets
//
//   npm run test:map                          all
//   npm run test:map -- --only rails,height   some
//   npm run test:map -- --verbose             every measurement

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as THREE from 'three';
import { mapHarness } from './harness.ts';
import { createWorldStream } from '../../map/render/streamer.ts';
import { tileColliders } from '../../map/render/physics.ts';
import { barrierShape } from '../../map/format/barriers.ts';
import { createSimulation } from '../../physics/sim.js';
import { createRun, evaluate, pathThrough } from '../../physics/testSuite.js';
import { CarDamage } from '../../garage/carDamage.js';

const args = process.argv.slice(2), opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const only = opt('--only')?.split(',').map(s => s.trim()), verbose = args.includes('--verbose'), region = opt('--region') ?? 'sf';
const M = await mapHarness(region), { H, manifest, T, P } = M;
const perf = JSON.parse(fs.readFileSync(path.join(M.root, 'data/map/performance.json'), 'utf8'));
const CAR = 'starter_car', garage = H.garage(null, CAR), spec = garage.stats().spec;
const KMH = 1 / 3.6, IDLE = { device: 'wheel', throttle: 0, brake: 0, steer: 0, handbrake: false };
const rows: any[] = [];
const report = (test: string, name: string, pass: boolean, detail: string, skipped = false) => { rows.push({ test, name, pass, detail, skipped }); console.log(`${skipped ? ' skip ' : pass ? '  ok  ' : ' FAIL '} ${name.padEnd(46)} ${detail}`); };
const note = (s: string) => { if (verbose) console.log(`         ${s}`); };
const rng = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const tileOf = (x: number, z: number) => [Math.floor(x / T), Math.floor(z / T)];
const local = (x: number, z: number, [i, j]: number[]) => [x - (i + 0.5) * T, z - (j + 0.5) * T];
const baked = new Set(manifest.tiles.map(t => `${t.i}_${t.j}`)), isBaked = (x: number, z: number) => baked.has(tileOf(x, z).join('_'));
const quantile = (a: number[], q: number) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };

// the heights of a mesh (tile-local) at (x, z): every triangle's there
function meshHeights(m, x: number, z: number) {
  const out: number[] = [];
  if (!m) return out;
  const P_ = m.positions, I = m.indices, n = m.skirtFrom ?? I.length;
  for (let t = 0; t < n; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    if (Math.max(P_[a], P_[b], P_[c]) < x || Math.min(P_[a], P_[b], P_[c]) > x || Math.max(P_[a + 2], P_[b + 2], P_[c + 2]) < z || Math.min(P_[a + 2], P_[b + 2], P_[c + 2]) > z) continue;
    const d = (P_[b + 2] - P_[c + 2]) * (P_[a] - P_[c]) + (P_[c] - P_[b]) * (P_[a + 2] - P_[c + 2]);
    if (Math.abs(d) < 1e-9) continue;
    const l1 = ((P_[b + 2] - P_[c + 2]) * (x - P_[c]) + (P_[c] - P_[b]) * (z - P_[c + 2])) / d, l2 = ((P_[c + 2] - P_[a + 2]) * (x - P_[c]) + (P_[a] - P_[c]) * (z - P_[c + 2])) / d, l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    out.push(l1 * P_[a + 1] + l2 * P_[b + 1] + l3 * P_[c + 1]);
  }
  return out;
}
const rotate = (q, v: number[]) => { const r = new THREE.Vector3(v[0], v[1], v[2]).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w)); return [r.x, r.y, r.z]; };

// ---------- road positions ----------
async function roadsTest() {
  console.log('\nRoad positions: the baked centre lines against OpenStreetMap');
  const G = M.graph();
  // OpenStreetMap's own coordinates: re-read from the extract the bake used, when it's here
  const pbf = path.join(M.root, '.cache/map', region, `${region}.osm.pbf`);
  let osmNode: Map<number, [number, number]> | null = null;
  if (fs.existsSync(pbf)) {
    const { readPbf } = await import('../../map/bake/osmPbf.ts') as any;
    const want = new Set<number>(); for (const s of G.segs) for (const o of s.osm) want.add(o[1]);
    const d = readPbf(new Uint8Array(fs.readFileSync(pbf)), { wantWay: t => !!t.highway, wantRelation: () => false });
    osmNode = new Map([...d.nodes].filter(([id]) => want.has(id)).map(([id, c]) => [id, [c[1], c[0]]]));
  }
  let worst = 0, worstAt = null, n = 0, missing = 0, meshWorst = 0, meshN = 0;
  const rnd = rng(7);
  for (const s of G.segs) for (const [k, id, lat0, lon0] of s.osm) {
    const ll = osmNode?.get(id) ?? [lat0, lon0];
    if (!ll) { missing++; continue; }
    const [x, z] = P.toXZ(ll[0], ll[1]);
    if (!isBaked(x, z)) continue;
    const bx = s.points[k * 3], bz = s.points[k * 3 + 1], d = Math.hypot(bx - x, bz - z);
    n++; if (d > worst) { worst = d; worstAt = `${s.name ?? s.class} (OSM node ${id})`; }
    // the drawn road through it: a vertex of the road surface there (a ribbon's crown, or the junction's middle)
    if (rnd() < 0.05) {
      const t = tileOf(x, z), tile = await M.tile(t[0], t[1]), R = tile?.meshes.roads;
      if (!R) continue;
      const [lx, lz] = local(x, z, t);
      let best = Infinity;
      for (let v = 0; v < R.positions.length; v += 3) best = Math.min(best, Math.hypot(R.positions[v] - lx, R.positions[v + 2] - lz));
      const inJunction = meshHeights(R, lx, lz).length > 0 && best > 0.5;
      if (!inJunction) { meshWorst = Math.max(meshWorst, best); meshN++; }
    }
  }
  report('roads', 'baked centre lines vs OpenStreetMap', worst < 0.5 && n > 0, `${n.toLocaleString('en-GB')} OSM nodes ${osmNode ? '(re-read from the OSM extract)' : '(the graph\'s own copy: no extract here)'}: largest difference ${(worst * 100).toFixed(1)} cm${worstAt ? ` at ${worstAt}` : ''}`);
  report('roads', 'drawn road surface through every OSM node', meshWorst < 0.5 && meshN > 0, `${meshN} sampled nodes: the road surface has a vertex within ${(meshWorst * 100).toFixed(1)} cm of each (junctions: its middle)`);
}

const edgeOfBake = (t: number[]) => [-1, 0, 1].some(di => [-1, 0, 1].some(dj => !baked.has(`${t[0] + di}_${t[1] + dj}`)));
// ---------- height ----------
async function heightTest() {
  console.log('\nHeights: 200 random road points — drawn road, physics, the smoothed elevation profile');
  const G = M.graph(), rnd = rng(20261003), pts: any[] = [];
  const segs = G.segs.filter(s => s.structure !== 'tunnel' && s.points.length >= 6 && isBaked(s.points[0], s.points[1]));
  for (let tries = 0; pts.length < 200 && tries < 20000; tries++) {
    const s = segs[Math.floor(rnd() * segs.length)], k = Math.floor(rnd() * (s.points.length / 3));
    const x = s.points[k * 3], z = s.points[k * 3 + 1], h = s.points[k * 3 + 2];
    if (!isBaked(x, z)) continue;
    pts.push({ x, z, h, s });
  }
  let worstVis = 0, worstPhys = 0, worstAt = '', dem: number[] = [], edgeSkips = 0;
  const sims = new Map<string, any>();
  for (const p of pts) {
    const t = tileOf(p.x, p.z), key = t.join('_'), tile = await M.tile(t[0], t[1]), [lx, lz] = local(p.x, p.z, t);
    // the drawn road there (the one nearest the profile: a bridge over another road is another road)
    // (a road triangle is in the tile its middle's in: near an edge, the neighbour's)
    const vs: number[] = [];
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const tt = await M.tile(t[0] + di, t[1] + dj); if (tt) vs.push(...meshHeights(tt.meshes.roads, ...local(p.x, p.z, [t[0] + di, t[1] + dj]) as [number, number])); }
    const vis = vs.sort((a, b) => Math.abs(a - p.h) - Math.abs(b - p.h))[0];
    if (vis === undefined && [-1, 0, 1].some(di => [-1, 0, 1].some(dj => !baked.has(`${t[0] + di}_${t[1] + dj}`)))) { edgeSkips++; continue; }
    if (!sims.has(key)) sims.set(key, await M.simAround(p.x, p.z, { radius: 10 }));
    // (what a wheel on this road stands on: the first solid ground below a point just over its surface)
    const S = sims.get(key), phys = S.ground(p.x, p.z, p.h + 0.1, true, 3);
    if (phys === null && edgeOfBake(t)) { edgeSkips++; continue; }
    const dv = vis === undefined ? Infinity : Math.abs(vis - p.h), dp = phys === null ? Infinity : Math.abs(phys - p.h);
    if (Math.max(dv, dp) > Math.max(worstVis, worstPhys)) worstAt = `${p.s.name ?? p.s.class} (${p.s.structure})`;
    worstVis = Math.max(worstVis, dv); worstPhys = Math.max(worstPhys, dp);
    note(`${p.s.name ?? p.s.class} (seg ${p.s.id}, ${p.s.structure}, at ${p.x}, ${p.z}): profile ${p.h.toFixed(2)}, drawn ${vis?.toFixed(3)}, physics ${phys?.toFixed(3)}`);
    const hf = tile.heightfield, N1 = hf.n + 1, c = Math.round((lx + T / 2) / (T / hf.n)), r = Math.round((lz + T / 2) / (T / hf.n));
    if (p.s.structure === 'ground') dem.push(p.h - hf.heights[Math.min(N1 - 1, r) + Math.min(N1 - 1, c) * N1]);
    if (sims.size > 30) sims.clear();
  }
  const pass = worstVis <= 0.1 && worstPhys <= 0.1;
  report('height', `${pts.length - edgeSkips} road points${edgeSkips ? ` (${edgeSkips} at the bake's edge left out)` : ''}`, pass, `drawn road ≤ ${worstVis.toFixed(3)} m from the profile, physics ≤ ${worstPhys.toFixed(3)} m${pass ? '' : ` (worst on ${worstAt})`} · ground under the road ${quantile(dem, 0.5)?.toFixed(2)} m below it (median)`);
}

// ---------- seams ----------
async function seamsTest() {
  console.log('\nSeams: the shared edges of neighbouring tiles');
  let pairs = 0, stepPhys = 0, stepVis = 0, gapVis = 0;
  for (const t of manifest.tiles) for (const [di, dj] of [[1, 0], [0, 1]]) {
    if (!baked.has(`${t.i + di}_${t.j + dj}`)) continue;
    const a = await M.tile(t.i, t.j), b = await M.tile(t.i + di, t.j + dj), N1 = a.heightfield.n + 1, n = N1 - 1;
    pairs++;
    // physics: the heightfields' shared points (and so the colliders' shared edge)
    for (let k = 0; k < N1; k++) {
      const ha = di ? a.heightfield.heights[k + n * N1] : a.heightfield.heights[n + k * N1], hb = di ? b.heightfield.heights[k] : b.heightfield.heights[0 + k * N1];
      stepPhys = Math.max(stepPhys, Math.abs(ha - hb));
    }
    // drawn: the two terrain meshes (level 0) along the edge, every metre
    for (let s = -T / 2 + 0.5; s < T / 2; s += 1) {
      const pa = di ? [T / 2 - 1e-6, s] : [s, T / 2 - 1e-6], pb = di ? [-T / 2 + 1e-6, s] : [s, -T / 2 + 1e-6];
      const ya = meshHeights(a.meshes.terrain0, pa[0], pa[1])[0], yb = meshHeights(b.meshes.terrain0, pb[0], pb[1])[0];
      if (ya === undefined || yb === undefined) { gapVis++; continue; }
      stepVis = Math.max(stepVis, Math.abs(ya - yb));
    }
  }
  const skirted = (await M.tile(manifest.tiles[0].i, manifest.tiles[0].j)).meshes.terrain0.skirtFrom > 0;
  report('seams', `${pairs} shared tile edges`, stepPhys === 0 && gapVis === 0 && stepVis <= 0.08 && skirted, `physics: identical (largest step ${stepPhys} m) · drawn: largest step ${stepVis.toFixed(3)} m (each mesh within its 4 cm error of the shared heights), ${gapVis} holes, edges skirted`);
}

// ---------- datum and blend ----------
async function datumTest() {
  console.log('\nElevation: one datum, and no step where LiDAR meets Copernicus');
  // across the blend: at each point where the source changes, the change in slope there (a step shows as
  // a kink in the second difference), against the same anywhere else
  let boundary = 0, worstKink = 0, baseline: number[] = [];
  for (const t of manifest.tiles) {
    const d = await M.tile(t.i, t.j), Gd = d.grids.dem, hf = d.heightfield, N1 = hf.n + 1, H_ = hf.heights;
    if (!Gd) continue;
    const src = (c: number, r: number) => Gd.data[r * N1 + c], h = (c: number, r: number) => H_[r + c * N1];
    for (let r = 1; r < N1 - 1; r += 1) for (let c = 1; c < N1 - 1; c++) {
      const kink = Math.abs(h(c + 1, r) - 2 * h(c, r) + h(c - 1, r));
      const edge = (src(c, r) === 3) !== (src(c + 1, r) === 3) || (src(c, r) === 1 && src(c + 1, r) === 2) || (src(c, r) === 2 && src(c + 1, r) === 1);
      if (edge && src(c, r) && src(c + 1, r)) { boundary++; worstKink = Math.max(worstKink, kink); }
      else if (src(c, r) === 2 && baseline.length < 200000 && (c * 7 + r) % 13 === 0) baseline.push(kink);
    }
  }
  const p99 = quantile(baseline, 0.99) ?? 0;
  if (!boundary) report('datum', 'LiDAR ↔ Copernicus blend', true, 'no LiDAR / Copernicus boundary in the baked tiles (the slice is all LiDAR or sea)', true);
  else report('datum', `LiDAR ↔ Copernicus blend (${boundary} boundary points)`, worstKink <= Math.max(0.5, 2 * p99), `largest kink across the boundary ${worstKink.toFixed(2)} m, against ${p99.toFixed(2)} m (99th percentile) inside Copernicus alone: no step`);
  // the datum: both sources in EGM2008 should agree on open ground (Copernicus is a surface model, so a
  // median over open land, not every point)
  const dir = path.join(M.root, '.cache/map', region, 'dem'), files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const lidar = files.find(f => /^src0-.*\.tif$/.test(f)), cop = files.find(f => /^src1-.*\.tif$/.test(f));
  const shifts = manifest.sources.elevation.map(s => `${s.name.split(' (')[0]}: ${s.conversion} (${s.shift >= 0 ? '+' : ''}${(s.shift ?? 0).toFixed(3)} m)`).join('; ');
  if (!lidar || !cop) { report('datum', 'one vertical datum (EGM2008)', manifest.sources.verticalDatum.startsWith('EGM2008'), `from the manifest: ${shifts}`, false); return; }
  const { fromFile } = await import('geotiff');
  const read = async (f: string) => (await (await (await fromFile(path.join(dir, f))).getImage()).readRasters() as any)[0];
  const A = await read(lidar), B = await read(cop), diffs: number[] = [];
  for (let k = 0; k < A.length; k += 97) if (A[k] > -9000 && B[k] > -9000 && B[k] !== 0 && A[k] > 1) diffs.push(B[k] - A[k]);
  // (the open ground: Copernicus' lowest readings over the LiDAR's bare earth — its roofs and trees are
  // only ever above; a datum mismatch would shift these too)
  const med = quantile(diffs, 0.5) ?? 0, p5 = quantile(diffs, 0.05) ?? 0, p10 = quantile(diffs, 0.1) ?? 0;
  report('datum', 'one vertical datum (EGM2008)', Math.abs(p5) < 1.0, `${shifts} · where both cover the ground, Copernicus − LiDAR: ${p5.toFixed(2)} m (5th percentile: open ground), ${p10.toFixed(2)} m (10th), ${med.toFixed(2)} m (median: roofs, trees)`);
}

// ---------- rails ----------
async function railRuns(S, [x, z]: number[], min = 30) {
  const runs: any[] = [];
  for (const key of S.loaded.keys()) {
    const [i, j] = key.split('_').map(Number), d = await M.tile(i, j), ox = (i + 0.5) * T, oz = (j + 0.5) * T;
    for (const [name, L] of Object.entries<any>(d.lists)) {
      if (!name.startsWith('barrier_')) continue;
      const D = L.data, type = name.slice(8), st = L.stride;
      let run: number[][] | null = null, est = 0;
      const flush = () => {
        if (!run || run.length < 2) return;
        const a = run[0], b = run[run.length - 1], len = Math.hypot(b[0] - a[0], b[2] - a[2]);
        if (len < min) return;
        const ux = (b[0] - a[0]) / len, uz = (b[2] - a[2]) / len, off = Math.max(...run.map(p => Math.abs((p[0] - a[0]) * -uz + (p[2] - a[2]) * ux)));
        if (off < 0.6) runs.push({ type, a, b, len, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], u: [ux, uz], dist: Math.hypot((a[0] + b[0]) / 2 - x, (a[2] + b[2]) / 2 - z), estimated: est });
      };
      for (let k = 0; k + 5 < D.length; k += st) {
        const p0 = [D[k] + ox, D[k + 1], D[k + 2] + oz], p1 = [D[k + 3] + ox, D[k + 4], D[k + 5] + oz];
        if (run && Math.hypot(run[run.length - 1][0] - p0[0], run[run.length - 1][2] - p0[2]) < 0.05) run.push(p1);
        else { flush(); run = [p0, p1]; est = D[k + 7] ?? 0; }
      }
      flush();
    }
  }
  return runs.sort((p, q) => p.dist - q.dist);
}
async function railFoot(run) {
  const k = tileOf(run.mid[0], run.mid[2]), d = await M.tile(k[0], k[1]), L = d?.lists[`barrier_${run.type}`];
  if (!L) return null;
  let best = null, bd = 3;
  for (let q = 0; q + 5 < L.data.length; q += L.stride) {
    const x = (L.data[q] + L.data[q + 3]) / 2 + (k[0] + 0.5) * T, z = (L.data[q + 2] + L.data[q + 5]) / 2 + (k[1] + 0.5) * T, dd = Math.hypot(x - run.mid[0], z - run.mid[2]);
    if (dd < bd) { bd = dd; best = { foot: (L.data[q + 1] + L.data[q + 4]) / 2, h: L.data[q + 6] }; }
  }
  return best;
}
async function railTest() {
  console.log('\nRailings: hit at 50–300 km/h, shallow and steep — never through');
  const cc = await (await import('../harness.mjs') as any).crashContext(), car = H.db.cars[CAR];
  const spots = manifest.spots ?? [];
  const kinds = ['guard_rail', 'parapet', 'jersey_barrier', 'wall', 'retaining_wall', 'fence'], candidates = new Map<string, any[]>(kinds.map(k => [k, []]));
  const prefer = { guard_rail: 'mountain', parapet: 'bridge', jersey_barrier: 'interchange' };
  const places = spots.length ? spots : [{ id: 'spawn', name: 'spawn', xz: manifest.spawn.xz }];
  for (const spot of places) {
    const S = await M.simAround(spot.xz[0], spot.xz[1], { radius: 600 });
    for (const r of await railRuns(S, spot.xz)) if (kinds.includes(r.type)) candidates.get(r.type)!.push({ ...r, spot, rank: (prefer[r.type] === spot.id ? 0 : 1e6) + (r.type === 'parapet' ? -r.mid[1] * 100 : r.dist) });
  }
  const half = spec.bodyCollider.halfExtents, centre = spec.bodyCollider.centre;
  let tested = 0;
  for (const type of kinds) for (const run of candidates.get(type)!.sort((p, q) => p.rank - q.rank).slice(0, 12)) {
    const S = await M.simAround(run.mid[0], run.mid[2], { radius: 300 }), sh = barrierShape(run.type, manifest.barriers), at = await railFoot(run);
    if (!at) continue;
    const sideAt = (sd: number, d: number) => [run.mid[0] - run.u[1] * d * sd, run.mid[2] + run.u[0] * d * sd];
    const roadSide = (sd: number) => [2, 3.5, 5].some(d => { const [x, z] = sideAt(sd, d), k = tileOf(x, z), t = M.cached(k[0], k[1]); return !!t?.meshes.roads && meshHeights(t.meshes.roads, ...local(x, z, k) as [number, number]).some(y => Math.abs(y - at.foot) < 1.2); });
    const approach = (sd: number) => { const ys = [1.5, 3, 5].map(d => S.ground(...sideAt(sd, d) as [number, number], at.foot + at.h + 6, true, 30)); return ys.every(y => y != null && Math.abs(y - ys[0]) < 0.8) && at.foot + at.h - ys[0] > 0.7; };
    const sides = [1, -1].filter(sd => roadSide(sd) && approach(sd));
    if (!sides.length) continue;
    tested++;
    let worst = 0, through = 0, unhit = 0, undamaged = 0, n_ = 0;
    for (const side of sides) for (const kmh of [50, 100, 200, 300]) for (const deg of [15, 60]) {
      const n = [-run.u[1] * side, run.u[0] * side], S2 = await M.simAround(run.mid[0], run.mid[2], { radius: 300 }), v = S2.sim.vehicle, a = deg * Math.PI / 180;
      const dir = [run.u[0] * Math.cos(a) - n[0] * Math.sin(a), run.u[1] * Math.cos(a) - n[1] * Math.sin(a)];
      const reach = half[0] * Math.cos(a) + half[2] * Math.sin(a) + sh.colliderThickness / 2 + 0.3, back = reach / Math.sin(a);
      const sx = run.mid[0] - dir[0] * back, sz = run.mid[2] - dir[1] * back, y = S2.ground(sx, sz, at.foot + 6, true, 12) ?? at.foot;
      const [px, pz] = S2.toSim(sx, sz);
      S2.sim.resetCar({ position: [px, y + 0.05, pz], headingDeg: Math.atan2(dir[0], dir[1]) * 180 / Math.PI, speed: kmh * KMH });
      const damage = new CarDamage({ car, build: garage.build, view: garage.view, boxes: cc.boxesOf(car), rules: H.db.damage });
      let hits = 0, deepest = 0;
      for (let s = 0; s < 2 / S2.sim.dt; s++) {
        S2.sim.step(IDLE);
        for (const im of v.sensor.take()) if (im.other === 'world') { hits++; damage.hit(im); }
        const p = v.body.translation(), q = v.body.rotation();
        for (const cx of [-1, 1]) for (const cz of [-1, 1]) {
          const c = rotate(q, [centre[0] + cx * half[0], centre[1], centre[2] + cz * half[2]]), wx = p.x + c[0] + S2.origin[0], wz = p.z + c[2] + S2.origin[1];
          if (Math.abs((wx - run.mid[0]) * run.u[0] + (wz - run.mid[2]) * run.u[1]) > run.len / 2 - 1) continue;
          deepest = Math.max(deepest, -((wx - run.mid[0]) * n[0] + (wz - run.mid[2]) * n[1]) - sh.colliderThickness / 2);
        }
      }
      const p = v.body.translation(), wx = p.x + S2.origin[0], wz = p.z + S2.origin[1], along = (wx - run.mid[0]) * run.u[0] + (wz - run.mid[2]) * run.u[1];
      const centreThrough = (wx - run.mid[0]) * n[0] + (wz - run.mid[2]) * n[1] < -sh.colliderThickness / 2 && Math.abs(along) < run.len / 2;
      const hurt = (damage.damage.shell?.condition ?? 100) < 100 || Object.values<any>(damage.owned).some(x => x.condition < 100 || Object.keys(x.damage ?? {}).length);
      n_++; worst = Math.max(worst, deepest);
      if (centreThrough || deepest > 0.6) through++;
      if (!hits) unhit++;
      if (kmh >= 100 && !hurt) undamaged++;
      note(`${type} side ${side}, ${kmh} km/h ${deg}°: ${hits} hits, deepest ${deepest.toFixed(2)} m${centreThrough ? ' THROUGH' : ''}`);
    }
    report('rails', `${type.replace('_', ' ')}${run.estimated ? ' (estimated)' : ''} at ${run.spot.name}`, !through && !unhit && !undamaged, `${n_} hits, 50–300 km/h at 15° and 60°: ${through ? `${through} THROUGH` : 'none through'}, deepest corner ${worst.toFixed(2)} m into it${unhit ? `, ${unhit} missed it` : ''}${undamaged ? `, ${undamaged} left no damage` : ', every hit reached the damage model'}`);
    break;
  }
  if (!tested) report('rails', 'railings', false, 'no railing beside a road in the baked tiles');
}

// ---------- streaming and memory ----------
async function streamingTest() {
  console.log(`\nStreaming: ${perf.streaming.routeKm} km at ${perf.streaming.speedKmh} km/h over a ${perf.network.megabytesPerSecond} MB/s, ${perf.network.latencyMs} ms network`);
  // a route: along the road graph's biggest roads, joined end to end where they meet (real roads, at speed)
  const spots = manifest.spots ?? [], order = ['city', 'tunnel', 'interchange', 'mountain', 'suburb', 'coast', 'carpark', 'roundabout', 'bridge'];
  const pts = [manifest.spawn.xz, ...order.map(k => spots.find(s => s.id === k)?.xz).filter(Boolean)];
  const route: number[][] = [];
  for (let q = 0; q + 1 < pts.length && route.length * 2 < perf.streaming.routeKm * 1000; q++) {
    const [ax, az] = pts[q], [bx, bz] = pts[q + 1], l = Math.hypot(bx - ax, bz - az);
    for (let s = 0; s < l && route.length * 2 < perf.streaming.routeKm * 1000; s += 2) route.push([ax + (bx - ax) * s / l, az + (bz - az) * s / l]);
  }
  const off = route.filter(([x, z]) => !isBaked(x, z)).length;
  if (route.length * 2 < perf.streaming.routeKm * 1000 * 0.99 || off) { report('streaming', 'the route is baked', false, `${(route.length * 2 / 1000).toFixed(1)} km of route, ${off} points off the baked tiles (bake the full region)`); return; }
  const speed = perf.streaming.speedKmh * KMH, N = perf.network;
  let clock = 0, pipeFree = 0;
  const pending: any[] = [];
  const loadTile = async (key: string) => {
    const [i, j] = key.split('_').map(Number), bytes = manifest.tiles.find(t => t.i === i && t.j === j).bytes, tile = await M.tile(i, j);
    const start = Math.max(clock, pipeFree);
    pipeFree = start + bytes / (N.megabytesPerSecond * 1e6) * 1000;
    return new Promise(resolve => pending.push({ at: pipeFree + N.latencyMs + perf.targets.tileDecodeMs, resolve: () => resolve({ type: 'tile', key, tile, bytes, cached: false, ms: 0 }) }));
  };
  const [sx, sz] = route[0], track = { surfaces: manifest.surfaces, offRoad: 'grass', spawn: { position: [0, 0, 0], headingDeg: 0 }, roads: [] };
  const sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets: H.socketsOf(spec), track });
  const S = await createWorldStream({ manifestUrl: null, scene: new THREE.Scene(), sim, RAPIER: H.RAPIER, options: { headless: true, manifest: { ...manifest, spawn: { ...manifest.spawn, xz: [sx, sz] } }, loadTile, now: () => clock } });
  const body = sim.vehicle.body, dt = 1 / 60;
  const step = async (x: number, z: number, vx: number, vz: number) => {
    clock += dt * 1000;
    for (let k = pending.length - 1; k >= 0; k--) if (pending[k].at <= clock) { pending[k].resolve(); pending.splice(k, 1); }
    await new Promise(r => setImmediate(r));
    const [px, pz] = S.toSim(x, z), y = body.translation().y;
    body.setTranslation({ x: px, y, z: pz }, true); body.setLinvel({ x: vx, y: 0, z: vz }, true); body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    S.update([px, y, pz], [vx, 0, vz], dt);
    sim.step(IDLE);
  };
  let waited = 0;
  while (!S.readyAround(...S.toSim(sx, sz) as [number, number], 30) && waited < 60) { await step(sx, sz, 0, 0); waited += dt; }
  const gc = (globalThis as any).gc ?? (() => {}), mem: any[] = [];
  let notReady = 0, falls = 0, worstAhead = Infinity, maxTiles = 0, maxColliders = 0, frames = 0;
  const seen = new Set<string>();
  let along = 0, k = 0;
  while (k + 1 < route.length) {
    along += speed * dt; k = Math.min(route.length - 1, Math.floor(along / 2));
    const [x, z] = route[k], [nx, nz] = route[Math.min(route.length - 1, k + 1)], l = Math.hypot(nx - x, nz - z) || 1;
    await step(x, z, (nx - x) / l * speed, (nz - z) / l * speed);
    frames++;
    const [px, pz] = S.toSim(x, z);
    if (!S.readyAround(px, pz, 0)) notReady++;
    else if (S.groundBelow(px, pz, 900, 2000) == null) falls++;
    if (frames % 15 === 0 && frames > 120 && k < route.length - 200) {
      let ahead = 0;
      for (let q = k; q < route.length && ahead < 400; q += 10, ahead += 20) if (!S.readyAround(...S.toSim(route[q][0], route[q][1]) as [number, number], 0)) break;
      worstAhead = Math.min(worstAhead, ahead);
    }
    for (const key of S.tiles.keys()) seen.add(key);
    maxTiles = Math.max(maxTiles, S.tiles.size); maxColliders = Math.max(maxColliders, S.status.colliders);
    if (frames % 600 === 0) { gc(); mem.push({ tiles: seen.size, heap: process.memoryUsage().heapUsed, colliders: S.status.colliders, held: S.tiles.size }); }
  }
  report('streaming', `${(along / 1000).toFixed(1)} km at ${perf.streaming.speedKmh} km/h`, !notReady && !falls, `${notReady ? `ground not ready under the car for ${(notReady * dt).toFixed(1)} s` : 'the ground was always ready'}${falls ? `, ${falls} frames with nothing under the car` : ''} · ready ≥ ${worstAhead === Infinity ? '—' : worstAhead} m ahead at worst · first ground after ${waited.toFixed(1)} s · ${seen.size} tiles in, ${maxTiles} at once`);
  const base = mem.find(m => m.tiles >= 30) ?? mem[0], last = mem[mem.length - 1], dropped = seen.size - S.tiles.size;
  if (!base || seen.size < 100) report('memory', '100 tiles in and out', false, `only ${seen.size} tiles on the route`);
  else { const growth = (last.heap - base.heap) / 1e6; report('memory', `${seen.size} tiles in, ${dropped} dropped again`, growth < perf.targets.memoryGrowthMB, `heap ${(base.heap / 1e6).toFixed(0)} MB at ${base.tiles} tiles → ${(last.heap / 1e6).toFixed(0)} MB at ${last.tiles} (${growth >= 0 ? '+' : ''}${growth.toFixed(0)} MB, at most ${perf.targets.memoryGrowthMB}) · colliders at most ${maxColliders}`); }
  S.dispose();
}

// ---------- determinism ----------
async function determinismTest() {
  console.log('\nDeterminism: the same area baked twice');
  if (!fs.existsSync(path.join(M.root, '.cache/map', region, `${region}.osm.pbf`))) { report('determinism', 'baking twice', true, 'needs the bake\'s inputs in .cache/map (run a bake first)', true); return; }
  const { bake } = await import('../../map/bake/bake.ts');
  const [la, lo] = [manifest.spawn.lat, manifest.spawn.lon], dirs = [0, 1].map(k => fs.mkdtempSync(path.join(os.tmpdir(), `map-det-${k}-`)));
  for (const out of dirs) await bake({ regionId: region, area: `${la},${lo},0.6`, out, log: () => {} });
  const files = (d: string) => [...fs.readdirSync(path.join(d, 'tiles')).map(f => `tiles/${f}`), ...fs.readdirSync(path.join(d, 'far')).map(f => `far/${f}`), 'graph.json.gz'];
  const a = files(dirs[0]), diff = a.filter(f => !fs.readFileSync(path.join(dirs[0], f)).equals(fs.readFileSync(path.join(dirs[1], f))));
  report('determinism', `${a.length} files baked twice`, diff.length === 0 && a.length > 3, diff.length ? `${diff.length} differ: ${diff.slice(0, 5).join(', ')}` : 'identical, byte for byte (tiles, far layer, road graph)');
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}

// ---------- the Phase 1 tests on a real road ----------
async function physicsTest() {
  const G = M.graph(), spot = (manifest.spots ?? []).find(s => s.id === 'coast');
  // the longest straight stretch of one road (or chain of segments of it) in the baked tiles
  const byName = new Map<string, any[]>();
  for (const s of G.segs) if (s.name && s.structure === 'ground' && (spot ? s.name === spot.name : s.rank >= 5)) (byName.get(s.name) ?? byName.set(s.name, []).get(s.name)!).push(s);
  let best: number[][] = [], bestName = '';
  for (const [name, list] of byName) {
    // chain segments end to end (one carriageway)
    const chains: number[][][] = [];
    for (const s of list) { const pts: number[][] = []; for (let k = 0; k < s.points.length; k += 3) pts.push([s.points[k], s.points[k + 1]]); const c = chains.find(c => Math.hypot(c[c.length - 1][0] - pts[0][0], c[c.length - 1][1] - pts[0][1]) < 0.5); if (c) c.push(...pts.slice(1)); else chains.push(pts); }
    for (let merged = true; merged;) { merged = false; for (const a of chains) for (const b of chains) if (a !== b && a.length && b.length && Math.hypot(a[a.length - 1][0] - b[0][0], a[a.length - 1][1] - b[0][1]) < 0.5) { a.push(...b.slice(1)); b.length = 0; merged = true; } }
    for (const c of chains) {
      // its longest part within a metre of a straight line, all baked
      for (let a = 0, b = 1; b < c.length; b++) {
        if (!isBaked(c[b][0], c[b][1])) { a = b + 1; continue; }
        const offFn = (a_: number, b_: number) => { const [ax, az] = c[a_], [bx, bz] = c[b_], l = Math.hypot(bx - ax, bz - az) || 1; let m = 0; for (let q = a_; q <= b_; q++) m = Math.max(m, Math.abs((c[q][0] - ax) * (bz - az) - (c[q][1] - az) * (bx - ax)) / l); return m; };
        while (a < b && offFn(a, b) > 1) a++;
        const len = Math.hypot(c[b][0] - c[a][0], c[b][1] - c[a][1]), bl = best.length ? Math.hypot(best[best.length - 1][0] - best[0][0], best[best.length - 1][1] - best[0][1]) : 0;
        if (len > bl) { best = c.slice(a, b + 1); bestName = name; }
      }
    }
  }
  const L = best.length ? Math.hypot(best[best.length - 1][0] - best[0][0], best[best.length - 1][1] - best[0][1]) : 0;
  console.log(`\nThe Phase 1 straight-line tests on a real road: ${bestName} (${L.toFixed(0)} m straight)`);
  if (L < 900) { report('physics', 'a real road', false, `the longest straight baked road is ${L.toFixed(0)} m (900 m needed: bake the full region)`); return; }
  const pts: number[][] = [];
  for (let s = 0; s < L; s += 2) pts.push([best[0][0] + (best[best.length - 1][0] - best[0][0]) * s / L, best[0][1] + (best[best.length - 1][1] - best[0][1]) * s / L]);
  const origin = [Math.floor(pts[0][0] / T) * T, Math.floor(pts[0][1] / T) * T], simPts = pts.map(([x, z]) => [x - origin[0], z - origin[1]]);
  const path_ = pathThrough(simPts, 2), h = Math.atan2(path_.points[0].tx, path_.points[0].tz);
  const strip = { x: simPts[0][0], z: simPts[0][1], h, remaining: pts.length * 2, path: path_ };
  const keys = new Set(pts.flatMap(([x, z]) => { const [i, j] = tileOf(x, z); return [-1, 0, 1].flatMap(a => [-1, 0, 1].map(b => `${i + a}_${j + b}`)); }));
  const decoded: any[] = [];
  for (const key of keys) { const [i, j] = key.split('_').map(Number), d = await M.tile(i, j); if (d) decoded.push({ i, j, d }); }
  const surfaces = Object.entries<any>(manifest.surfaces).map(([name, s]) => ({ name, ...s }));
  const prepare = (sim) => {
    for (const { i, j, d } of decoded) sim.addStatic({ position: [(i + 0.5) * T - origin[0], 0, (j + 0.5) * T - origin[1]] }, tileColliders(d, H.RAPIER, manifest.barriers).pieces);
    sim.step(IDLE);
    sim.vehicle.surfaceAt = (x: number, z: number) => { const wx = x + origin[0], wz = z + origin[1], t = M.cached(Math.floor(wx / T), Math.floor(wz / T)), Gs = t?.grids.surface; if (!Gs) return surfaces[0]; const c = Math.min(Gs.n - 1, Math.floor((wx - Math.floor(wx / T) * T) / Gs.cell)), r = Math.min(Gs.n - 1, Math.floor((wz - Math.floor(wz / T) * T) / Gs.cell)); return surfaces.find(q => q.name === Gs.names[Gs.data[r * Gs.n + c]]) ?? surfaces[0]; };
    const reset = sim.resetCar.bind(sim), R = H.RAPIER;
    sim.resetCar = pose => { const [x, , z] = pose.position, hit = sim.vehicle.world.castRay(new R.Ray({ x, y: 900, z }, { x: 0, y: -1, z: 0 }), 2000, true, undefined, undefined, undefined, sim.vehicle.body, c => c.userData?.material === 'ground'); reset({ ...pose, position: [x, hit ? 900 - hit.timeOfImpact : 0, z] }); };
  };
  const targets = JSON.parse(fs.readFileSync(path.join(M.root, `tests/targets/${CAR}.json`), 'utf8'));
  const ctx = { RAPIER: H.RAPIER, settings: H.settings, spec, sockets: H.socketsOf(spec), track: { surfaces: manifest.surfaces, offRoad: 'grass', spawn: { position: [strip.x, 0, strip.z], headingDeg: 0 }, roads: [] }, place: () => ({ strip }), prepare, pace: targets.pace };
  for (const id of ['zeroTo100', 'quarterMile', 'braking', 'framerate']) {
    const run = createRun(ctx, id);
    while (!run.done) run.next(5000);
    const row = evaluate([run.result], targets)[0], t = row.target;
    report('physics', `${row.name} on ${bestName}`, row.pass, `${row.value == null ? (row.pass ? 'yes' : 'no') : `${row.value.toFixed(row.digits)} ${row.unit}`}${t ? ` (target ${t.min ?? ''}–${t.max ?? ''})` : ''} ${row.detail ?? ''}`);
  }
}

const TESTS: Record<string, () => Promise<void>> = { roads: roadsTest, height: heightTest, seams: seamsTest, datum: datumTest, rails: railTest, streaming: streamingTest, determinism: determinismTest, physics: physicsTest };
const t0 = performance.now();
console.log(`Map v3's tests: ${manifest.name} (${manifest.tiles.length} tiles, bake ${manifest.version})`);
for (const [id, fn] of Object.entries(TESTS)) if (!only || only.includes(id) || (id === 'streaming' && only.includes('memory'))) await fn();
const failed = rows.filter(r => !r.pass);
console.log(`\n${rows.length - failed.length} of ${rows.length} passed${rows.some(r => r.skipped) ? ` (${rows.filter(r => r.skipped).length} skipped)` : ''} in ${((performance.now() - t0) / 1000).toFixed(0)} s${failed.length ? ` — failed: ${failed.map(r => `${r.test}: ${r.name}`).join('; ')}` : ''}\n`);
process.exit(failed.length ? 1 : 0);
