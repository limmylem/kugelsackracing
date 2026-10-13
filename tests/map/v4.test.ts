// Map v4's own tests (MAP_README.md, MAP_V4_REPORT.md): the six Map v3 road problems (MAP_V4_DIAGNOSIS.md), each
// measured on the region's Map v4 bake (assets/map/<region>/v4/), decoded and collided with as the game does
// (tests/map/harness.ts). Every limit is data/map/v4.json's `tests` (and collision.maxBumpAccel). Map v3's tests run on
// the same bake too (npm run test:map -- --map v4): road positions against OSM, heights, terrain seams, railings at
// 50–300 km/h, streaming, memory, determinism and the Phase 1 physics.
//
//   widths      1. roads wide enough: the drawn road's width across, against the model's (its class's table)
//   surface     2. one watertight surface: the tiles' road meshes joined — T-junction cracks, overlapping layers
//   edges       2. along every road edge just inside it: drawn road there (no holes), the collision surface with it,
//               the drawn ground (near and middle detail) never through it
//   colliders   3. no invisible objects: every collider has something drawn (audited as at bake time); no building,
//               railing or trunk collider over a lane; none left after a tile's unloaded
//   trees       4. no trees on roads or bridges: trunks off every road surface, crowns under no deck
//   junctions   5. every junction patch's joins with its roads: drawn road both sides, no step beyond the road's grade
//   bumps       5. a car straight across junctions, bridge ends and tile borders at 30, 80 and 150 km/h: the body's
//               vertical acceleration
//   lamps       6. street lighting: lamps along lit roads, none on a road, the nearest few lit for real
//   badspots    every known bad spot (data/map/known-bad-spots.json) in the bake, re-checked
//   seams       the road surface's vertices on every shared tile edge: the neighbour has each one
//
//   npm run test:map4 [-- --region adelaide] [--only widths,lamps] [--verbose] [--json out.json] [--dir <a bake elsewhere>]

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MeshoptDecoder } from 'meshoptimizer';
import { mapHarness } from './harness.ts';
import { decodeTile } from '../../map/format/tileFormat.ts';
import { terrainMeshes } from '../../map/format/terrainMesh.ts';
import { tileColliders } from '../../map/render/physics.ts';
import { auditTile } from '../../map/collision/audit.ts';
import { checkSurface } from '../../map/model/checks.ts';
import { lampLights } from '../../map/render/lamps.ts';
import { createSimulation } from '../../physics/sim.js';

const args = process.argv.slice(2), opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const only = opt('--only')?.split(',').map(s => s.trim()), verbose = args.includes('--verbose'), region = opt('--region') ?? 'adelaide';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'), DIR = opt('--dir') ? path.resolve(opt('--dir')!) : path.join(ROOT, 'assets/map', region, 'v4');
const M = await mapHarness(region, DIR), { H, manifest, T, P } = M;
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/map/v4.json'), 'utf8')), X = cfg.tests;
const model = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DIR, manifest.files.roadModel))).toString());
const KMH = 1 / 3.6, IDLE = { device: 'wheel', throttle: 0, brake: 0, steer: 0, handbrake: false };
const rows: any[] = [];
const report = (test: string, name: string, pass: boolean, detail: string, value: any = null) => { rows.push({ test, name, pass, detail, value }); console.log(`${pass ? '  ok  ' : ' FAIL '} ${name.padEnd(50)} ${detail}`); };
const note = (s: string) => { if (verbose) console.log(`         ${s}`); };
const rng = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const tileOf = (x: number, z: number) => [Math.floor(x / T), Math.floor(z / T)];
const baked = new Set(manifest.tiles.map((t: any) => `${t.i}_${t.j}`)), isBaked = (x: number, z: number) => baked.has(tileOf(x, z).join('_'));
const inner = (x: number, z: number) => { const [i, j] = tileOf(x, z); return [-1, 0, 1].every(a => [-1, 0, 1].every(b => baked.has(`${i + a}_${j + b}`))); };
const pct = (a: number, b: number) => (b ? (a / b * 100).toFixed(a / b < 0.001 ? 3 : 2) : '0') + '%';
const quantile = (a: number[], q: number) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN; };
const KERB = 3;   // (map/model/surface.ts SURFACES: the kerb's index)

// ---------- tiles, decoded as the worker does, a bounded number kept ----------
const lru = new Map<string, Promise<any>>();
function tile(i: number, j: number): Promise<any> {
  const key = `${i}_${j}`;
  if (!baked.has(key)) return Promise.resolve(null);
  if (lru.has(key)) { const p = lru.get(key)!; lru.delete(key); lru.set(key, p); return p; }
  const p = decodeTile(new Uint8Array(fs.readFileSync(path.join(DIR, 'tiles', `${key}.m3t`))), MeshoptDecoder).then((d: any) => { Object.assign(d.meshes, terrainMeshes(d)); d.idx = {}; return d; });
  lru.set(key, p);
  while (lru.size > 60) lru.delete(lru.keys().next().value!);
  return p;
}
// a mesh's triangles by a 4 m grid (tile-local): the heights there [{ y, t }] (skirts and walls, no area in plan, left out)
function triIndex(m: any, C = 4) {
  if (!m) return () => [] as { y: number; t: number }[];
  const P_ = m.positions, I = m.indices, n = m.skirtFrom ?? I.length, grid = new Map<number, number[]>(), key = (a: number, b: number) => (a + 4096) * 8192 + b + 4096;
  for (let t = 0; t < n; t += 3) {
    const xs = [P_[I[t] * 3], P_[I[t + 1] * 3], P_[I[t + 2] * 3]], zs = [P_[I[t] * 3 + 2], P_[I[t + 1] * 3 + 2], P_[I[t + 2] * 3 + 2]];
    for (let a = Math.floor(Math.min(...xs) / C); a <= Math.floor(Math.max(...xs) / C); a++) for (let b = Math.floor(Math.min(...zs) / C); b <= Math.floor(Math.max(...zs) / C); b++) { const k = key(a, b); (grid.get(k) ?? grid.set(k, []).get(k)!).push(t); }
  }
  return (x: number, z: number) => {
    const out: { y: number; t: number }[] = [];
    for (const t of grid.get(key(Math.floor(x / C), Math.floor(z / C))) ?? []) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, d = (P_[b + 2] - P_[c + 2]) * (P_[a] - P_[c]) + (P_[c] - P_[b]) * (P_[a + 2] - P_[c + 2]);
      if (Math.abs(d) < 1e-9) continue;
      const l1 = ((P_[b + 2] - P_[c + 2]) * (x - P_[c]) + (P_[c] - P_[b]) * (z - P_[c + 2])) / d, l2 = ((P_[c + 2] - P_[a + 2]) * (x - P_[c]) + (P_[a] - P_[c]) * (z - P_[c + 2])) / d, l3 = 1 - l1 - l2;
      if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
      out.push({ y: l1 * P_[a + 1] + l2 * P_[b + 1] + l3 * P_[c + 1], t });
    }
    return out;
  };
}
const idxOf = (d: any, name: string) => (d.idx[name] ??= triIndex(d.meshes[name]));
// the drawn road surface at a place (world frame): every layer's height there, and its surface (tarmac, kerb…)
async function roadAt(x: number, z: number) {
  const [i, j] = tileOf(x, z), d = await tile(i, j);
  if (!d) return null;
  const R = d.meshes.roads;
  return idxOf(d, 'roads')(x - (i + 0.5) * T, z - (j + 0.5) * T).map(h => ({ y: h.y, surf: R?.surfaces?.[h.t / 3] ?? 0 }));
}
async function groundAt(x: number, z: number, lod = 0) {
  const [i, j] = tileOf(x, z), d = await tile(i, j);
  if (!d) return null;
  const hs = idxOf(d, `terrain${lod}`)(x - (i + 0.5) * T, z - (j + 0.5) * T);
  return hs.length ? Math.max(...hs.map(h => h.y)) : null;
}
const nearest = (hs: { y: number }[] | null, y: number) => (hs?.length ? hs.reduce((a, b) => (Math.abs(b.y - y) < Math.abs(a.y - y) ? b : a)) : null);

// ---------- the road model's roads: along each, its centre, normal (left) and half widths ----------
const segs = model.segs.map((g: any) => {
  const n = g.points.length / 3, xs: number[] = [], zs: number[] = [], hs: number[] = [], s = [0];
  for (let k = 0; k < n; k++) { xs.push(g.points[k * 3]); zs.push(g.points[k * 3 + 1]); hs.push(g.points[k * 3 + 2]); if (k) s.push(s[k - 1] + Math.hypot(xs[k] - xs[k - 1], zs[k] - zs[k - 1])); }
  return { ...g, xs, zs, hs, s, L: s[n - 1] };
});
const segById = new Map(segs.map((g: any) => [g.id, g]));
function rowAt(g: any, s: number) {
  const S = g.s, n = S.length;
  let k = 0; while (k + 2 < n && S[k + 1] < s) k++;
  const t = Math.max(0, Math.min(1, (s - S[k]) / ((S[k + 1] - S[k]) || 1))), dx = g.xs[k + 1] - g.xs[k], dz = g.zs[k + 1] - g.zs[k], l = Math.hypot(dx, dz) || 1;
  const lerp = (a: number[]) => a[k] + (a[k + 1] - a[k]) * t;
  return { x: lerp(g.xs), z: lerp(g.zs), h: lerp(g.hs), tx: dx / l, tz: dz / l, nx: -dz / l, nz: dx / l, hwL: g.half[k * 2] + (g.half[(k + 1) * 2] - g.half[k * 2]) * t, hwR: g.half[k * 2 + 1] + (g.half[(k + 1) * 2 + 1] - g.half[k * 2 + 1]) * t };
}
// (a road's own stretch: past its junctions' trims)
const span = (g: any, pad = 0) => [Math.max(0, g.trim[0]) + pad, g.L - Math.max(0, g.trim[1]) - pad];
const drivableRoads = segs.filter((g: any) => !g.internal && g.L > 1);

// ---------- 1. widths ----------
async function widthsTest() {
  console.log('\n1. Road widths: the drawn road across, against the model');
  const rnd = rng(41), ratios: number[] = [], byClass = new Map<string, number[]>();
  const cand = drivableRoads.filter((g: any) => g.structure === 'ground' && !g.adjusted && span(g, 3)[1] > span(g, 3)[0]);
  let tries = 0, worst = { r: Infinity, at: '' };
  while (ratios.length < 400 && tries++ < 20000) {
    const g = cand[Math.floor(rnd() * cand.length)], [a, b] = span(g, 3), r = rowAt(g, a + rnd() * (b - a));
    if (!inner(r.x, r.z)) continue;
    // (out from the centre, 5 cm at a time, while there's road at its height)
    const reach = async (sd: number, max: number) => { let o = 0; for (; o < max + 3; o += 0.05) { const hs = await roadAt(r.x + r.nx * o * sd, r.z + r.nz * o * sd); if (!hs?.some(h => Math.abs(h.y - r.h) < 0.6)) break; } return o; };
    const want = r.hwL + r.hwR;
    if (want < 2) continue;
    const got = (await reach(1, r.hwL)) + (await reach(-1, r.hwR)), q = got / want;
    ratios.push(q);
    const cls = g.link ? `${g.class}_link` : g.class;
    (byClass.get(cls) ?? byClass.set(cls, []).get(cls)!).push(got);
    if (q < worst.r) worst = { r: q, at: `${g.name ?? g.class} at ${r.x.toFixed(0)}, ${r.z.toFixed(0)} (${got.toFixed(2)} of ${want.toFixed(2)} m)` };
  }
  const p5 = quantile(ratios, 0.05);
  report('widths', `${ratios.length} cross-sections`, p5 >= X.widthShare, `drawn width ≥ ${(p5 * 100).toFixed(1)}% of the model's in 95% of them (limit ${(X.widthShare * 100).toFixed(0)}%), narrowest ${worst.at}`, { p5 });
  const cls = [...byClass].filter(([, v]) => v.length >= 5).sort((a, b) => quantile(b[1], 0.5) - quantile(a[1], 0.5));
  report('widths', 'drawn widths by class (median)', true, cls.map(([k, v]) => `${k} ${quantile(v, 0.5).toFixed(1)} m`).join(', '), Object.fromEntries(cls.map(([k, v]) => [k, +quantile(v, 0.5).toFixed(2)])));
}

// ---------- 2. one surface ----------
// the tiles round the spawn and the bad spots, nearest first
function chosenTiles(n: number) {
  const centres = [manifest.spawn.xz, ...badSpots().map((b: any) => b.xz)];
  return manifest.tiles.map((t: any) => ({ t, d: Math.min(...centres.map((c: number[]) => Math.hypot((t.i + 0.5) * T - c[0], (t.j + 0.5) * T - c[1]))) })).sort((a: any, b: any) => a.d - b.d).slice(0, n).map((x: any) => x.t);
}
function badSpots() {
  const all = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/map/known-bad-spots.json'), 'utf8')).spots ?? []; } catch { return []; } })();
  return all.filter((b: any) => b.region === region).map((b: any) => ({ ...b, xz: P.toXZ(b.lat, b.lon) })).filter((b: any) => isBaked(b.xz[0], b.xz[1]));
}
async function surfaceTest() {
  console.log('\n2. One watertight road surface: the tiles\' road meshes joined');
  const list = chosenTiles(X.surfaceTiles), pos: number[] = [], idx: number[] = [], solid: number[] = [];
  for (const t of list) {
    const d = await tile(t.i, t.j), R = d?.meshes.roads;
    if (!R) continue;
    const base = pos.length / 3, cx = (t.i + 0.5) * T, cz = (t.j + 0.5) * T;
    for (let v = 0; v < R.positions.length; v += 3) pos.push(R.positions[v] + cx, R.positions[v + 1], R.positions[v + 2] + cz);
    for (let k = 0; k < R.indices.length; k += 3) {
      const a = R.indices[k] * 3, b = R.indices[k + 1] * 3, c = R.indices[k + 2] * 3, P_ = R.positions;
      // (solid: the surface you drive on — not a skirt, a kerb's face or a deck's side, standing up: two corners one
      // over the other. A stitch of no area, closing a T-junction, is the surface)
      const up = (p: number, q: number) => Math.abs(P_[p] - P_[q]) < 1e-6 && Math.abs(P_[p + 2] - P_[q + 2]) < 1e-6;
      idx.push(base + R.indices[k], base + R.indices[k + 1], base + R.indices[k + 2]); solid.push(up(a, b) || up(b, c) || up(c, a) ? 0 : 1);
    }
  }
  const c = checkSurface({ positions: pos, indices: idx, solid }, { sampleEvery: 2, maxReports: 1e9 });
  // (not on a tile's edge: the joined tiles' own outer edge cuts roads off — the seams test has the edges between tiles)
  const onBorder = (x: number, z: number) => [x, z].some(v => Math.abs(v - Math.round(v / T) * T) < 0.01);
  const all = c.cracks.filter((q: any) => !onBorder(q.at[0], q.at[2]));
  // (inside the road — road all round it, 3 cm out every way: a seam you could see through — or a notch in the road's
  // own outline, where it ends anyway)
  const inside: any[] = [];
  for (const q of all) { let round = true; for (let a = 0; a < 8 && round; a++) { const hs = await roadAt(q.at[0] + Math.cos(a * Math.PI / 4) * 0.03, q.at[2] + Math.sin(a * Math.PI / 4) * 0.03); if (!hs?.some(h => Math.abs(h.y - q.at[1]) < 0.1)) round = false; } if (round) inside.push(q); }
  const per100k = inside.length / c.triangles * 1e5;
  report('surface', `${list.length} tiles joined, ${(c.triangles / 1000).toFixed(0)}k triangles`, per100k <= X.maxCracksPer100k, `${inside.length} T-junction cracks inside the road (${per100k.toFixed(2)} per 100k triangles, limit ${X.maxCracksPer100k}), ${all.length - inside.length} more in its outline; each under 3 mm${inside.length ? `, e.g. at ${inside.slice(0, 2).map((q: any) => q.at.join(', ')).join('; ')}` : ''} — Map v3: 5,421 holes along edges and 9,364 at junctions in 1.26M samples`, { cracks: inside.length, outline: all.length - inside.length, per100k });
  report('surface', 'overlapping road surfaces', c.overlapCount / c.sampled <= X.maxOverlapShare, `${c.overlapCount} of ${c.sampled.toLocaleString('en-GB')} sampled triangles have another solid one within 0.5 m over or under them (${pct(c.overlapCount, c.sampled)}, limit ${pct(X.maxOverlapShare, 1)}; Map v3: 6.5%)`, { share: c.overlapCount / c.sampled });
}

async function edgesTest() {
  console.log('\n2. Road edges: holes, the collision surface, the ground through the road');
  let n = 0, holes = 0, through0 = 0, through1 = 0, phys = 0, physBad = 0, worstPhys = 0;
  const holeAt: string[] = [], throughAt: string[] = [], rnd = rng(5), sims = new Map<string, any>();
  for (const g of drivableRoads) {
    if (g.structure === 'tunnel') continue;
    const [a, b] = span(g, 1);
    for (let s = a; s <= b; s += X.edgeSpacing) {
      const r = rowAt(g, s);
      if (!inner(r.x, r.z)) continue;
      for (const sd of [1, -1]) {
        const off = (sd > 0 ? r.hwL : r.hwR) - X.edgeInset;
        if (off < 0.5) continue;
        const x = r.x + r.nx * off * sd, z = r.z + r.nz * off * sd;
        n++;
        const hit = nearest((await roadAt(x, z))?.filter(h => Math.abs(h.y - r.h) < 1) ?? null, r.h);
        if (!hit) { holes++; if (holeAt.length < 4) holeAt.push(`${g.name ?? g.class} ${x.toFixed(1)}, ${z.toFixed(1)}`); continue; }
        if (g.structure === 'ground') {
          const g0 = await groundAt(x, z, 0), g1 = await groundAt(x, z, 1);
          if (g0 != null && g0 > hit.y + 0.005) { through0++; if (throughAt.length < 4) throughAt.push(`${g.name ?? g.class} ${x.toFixed(1)}, ${z.toFixed(1)} (+${((g0 - hit.y) * 100).toFixed(0)} cm)`); }
          if (g1 != null && g1 > hit.y + 0.005) through1++;
        }
        // (the collision surface under a wheel there: a sample of them, near the spawn)
        if (rnd() < 0.02 && Math.hypot(x - manifest.spawn.xz[0], z - manifest.spawn.xz[1]) < 900) {
          const key = tileOf(x, z).join('_');
          if (!sims.has(key)) { if (sims.size >= 4) { for (const q of sims.values()) q.free(); sims.clear(); } sims.set(key, await M.simAround(x, z, { radius: 10 })); }
          const y = sims.get(key).ground(x, z, hit.y + 0.4, true, 1.5);
          phys++;
          // (from the drawn road surface there — where two overlap, the car rides the upper: the overlaps are test 2's)
          const dy = y == null ? Infinity : Math.min(...((await roadAt(x, z)) ?? [hit]).filter((h: any) => Math.abs(h.y - hit.y) < 0.5).map((h: any) => Math.abs(y - h.y)));
          worstPhys = Math.max(worstPhys, dy);
          if (dy > X.maxPhysicsGap) { physBad++; note(`physics ${y?.toFixed(3)} vs drawn ${hit.y.toFixed(3)} at ${x.toFixed(2)}, ${z.toFixed(2)} (${g.name ?? g.class}, ${g.structure}, side ${sd})`); }
        }
      }
    }
  }
  for (const q of sims.values()) q.free();
  report('edges', `${n.toLocaleString('en-GB')} points ${X.edgeInset} m inside road edges`, holes / n <= X.maxHoleShare, `${holes} with no drawn road (${pct(holes, n)}, limit ${pct(X.maxHoleShare, 1)}; Map v3: 0.43%)${holeAt.length ? ` e.g. ${holeAt.join('; ')}` : ''}`, { holes, n });
  report('edges', 'the drawn ground never through the road', through0 / n <= X.maxGroundThroughShare && through1 / n <= X.maxGroundThroughShare * 5, `near detail ${through0} (${pct(through0, n)}), middle detail ${through1} (${pct(through1, n)}) of them under the ground (limits ${pct(X.maxGroundThroughShare, 1)}, ${pct(X.maxGroundThroughShare * 5, 1)}; Map v3: 1.44%, 22.99%)${throughAt.length ? ` e.g. ${throughAt.join('; ')}` : ''}`, { through0, through1, n });
  report('edges', `the collision surface under ${phys} of them`, physBad === 0 && phys > 0, `within ${(worstPhys * 100).toFixed(1)} cm of the drawn road (limit ${(X.maxPhysicsGap * 100).toFixed(0)} cm)`, { worstPhys });
}

// ---------- 3. colliders ----------
async function collidersTest() {
  console.log('\n3. Colliders: something drawn for each, none over a lane, none left behind');
  const list = manifest.tiles.length <= X.auditTiles ? manifest.tiles : chosenTiles(X.auditTiles);
  const surface = { heightsAt: (x: number, z: number) => (isBaked(x, z) ? syncRoad(x, z) : null) };
  // (the audit asks for heights synchronously: the tiles it needs, loaded first)
  let problems: any[] = [], pieces = 0, overLane: string[] = [], overLaneN = 0;
  const byKind: Record<string, number> = {};
  for (const t of list) {
    const d = await tile(t.i, t.j);
    for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) await tile(t.i + a, t.j + b).then(q => { if (q) loaded.set(`${t.i + a}_${t.j + b}`, q); });
    const cx = (t.i + 0.5) * T, cz = (t.j + 0.5) * T;
    problems.push(...auditTile(d, { cx, cz, surface, barriersCfg: manifest.barriers }).map(p => ({ tile: `${t.i}_${t.j}`, ...p })));
    const { pieces: ps } = tileColliders(d, FAKE, manifest.barriers, { treeShare: 1 });
    for (const p of ps) {
      pieces++; const kind = p.userData.kind; byKind[kind] = (byKind[kind] ?? 0) + 1;
      if (kind !== 'building' && kind !== 'barrier' && kind !== 'tree') continue;
      // (its footprint's middle and corners, pulled 10 cm in: a drivable (not kerb) road surface at a height inside it?)
      const s = p.shape, pts: number[][] = [];
      let y0 = -Infinity, y1 = Infinity;
      if (kind === 'building') { const q = s.points, m = q.length / 6; let mx = 0, mz = 0; for (let k = 0; k < m; k++) { mx += q[k * 6]; mz += q[k * 6 + 2]; } mx /= m; mz /= m; pts.push([mx, mz]); for (let k = 0; k < m; k++) { const x = q[k * 6], z = q[k * 6 + 2], l = Math.hypot(x - mx, z - mz) || 1; pts.push([x - (x - mx) / l * 0.1, z - (z - mz) / l * 0.1]); } y0 = Math.min(q[1], q[4]); y1 = Math.max(q[1], q[4]); }
      else if (kind === 'barrier') { pts.push([s.centre[0], s.centre[2]]); y0 = s.centre[1] - s.halfExtents[1]; y1 = s.centre[1] + s.halfExtents[1]; }
      else { pts.push([s.centre[0], s.centre[2]]); y0 = s.centre[1] - s.half; y1 = s.centre[1] + s.half; }
      const bad = pts.some(([x, z]) => (syncRoad(x + cx, z + cz) ?? []).some((h: any) => h.surf !== KERB && h.y > y0 - 0.3 && h.y < y1));
      if (bad) { overLaneN++; if (overLane.length < 4) overLane.push(`${kind} at ${(pts[0][0] + cx).toFixed(1)}, ${(pts[0][1] + cz).toFixed(1)}`); }
    }
    for (const k of [...loaded.keys()]) if (!lru.has(k)) loaded.delete(k);
  }
  report('colliders', `${list.length} tiles, ${pieces.toLocaleString('en-GB')} colliders audited`, problems.length === 0, problems.length ? `${problems.length} with nothing drawn there: ${problems.slice(0, 3).map(p => `${p.kind} at ${p.at.join(', ')} (${p.why})`).join('; ')}` : `every one has something drawn (${Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  report('colliders', 'no building, railing or trunk over a lane', overLaneN === 0, overLaneN ? `${overLaneN}: ${overLane.join('; ')}` : `none (Map v3: 1,302 building and 685 railing collider points over lanes)`, { overLaneN });
  // no orphans: a tile's colliders all gone when it's unloaded
  const [sx, sz] = manifest.spawn.xz, S = await M.simAround(sx, sz, { radius: 600 }), world = S.sim.vehicle.world, car = S.sim.vehicle.body.handle;
  const others = () => { let n = 0; world.forEachCollider((c: any) => { if (c.parent()?.handle !== car) n++; }); return n; };
  const bare = createSimulation(H.RAPIER, { settings: H.settings, spec: H.garage().stats().spec, sockets: H.socketsOf(H.garage().stats().spec), track: { surfaces: manifest.surfaces, offRoad: 'grass', spawn: { position: [0, 0, 0], headingDeg: 0 }, roads: [] } });
  let base = 0; bare.vehicle.world.forEachCollider((c: any) => { if (c.parent()?.handle !== bare.vehicle.body.handle) base++; }); bare.vehicle.world.free();
  const before = others();
  for (const h of S.loaded.values()) S.sim.removeStatic(h);
  const after = others();
  report('colliders', `${S.loaded.size} tiles loaded and unloaded`, after === base && before > base, `${before - base} colliders in, ${after - base} left after unloading`);
  S.free();
}
const loaded = new Map<string, any>();
const syncRoad = (x: number, z: number) => { const [i, j] = tileOf(x, z), d = loaded.get(`${i}_${j}`); if (!d) return []; const R = d.meshes.roads; return idxOf(d, 'roads')(x - (i + 0.5) * T, z - (j + 0.5) * T).map(h => ({ y: h.y, surf: R?.surfaces?.[h.t / 3] ?? 0 })); };
const desc = () => { const d: any = {}; d.setTranslation = () => d; d.setRotation = () => d; d.setFriction = () => d; d.setRestitution = () => d; return d; };
const FAKE = { TriMeshFlags: { FIX_INTERNAL_EDGES: 1 }, ColliderDesc: { heightfield: desc, trimesh: desc, convexHull: desc, cuboid: desc, cylinder: desc } };

// ---------- 4. trees ----------
async function treesTest() {
  console.log('\n4. Trees: off every road, under no bridge');
  let n = 0, trunks = 0, crowns = 0; const at: string[] = [];
  for (const t of manifest.tiles) {
    const d = await tile(t.i, t.j), L = d?.lists.trees;
    if (!L) continue;
    const cx = (t.i + 0.5) * T, cz = (t.j + 0.5) * T;
    for (let k = 0; k < L.data.length; k += L.stride) {
      const x = L.data[k] + cx, y = L.data[k + 1], z = L.data[k + 2] + cz, sc = L.data[k + 3] * 4, conifer = !!L.data[k + 4];
      const r = sc * (conifer ? 0.55 : 0.75), top = y + sc * (conifer ? 2.95 : 1.95);
      n++;
      // the trunk: no road surface within half a metre, at its foot's height or above it
      let hit = false;
      for (const [dx, dz] of [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) if ((await roadAt(x + dx, z + dz))?.some(h => h.y > y - 1 && h.y < top)) hit = true;
      if (hit) { trunks++; if (at.length < 4) at.push(`trunk at ${x.toFixed(1)}, ${z.toFixed(1)}`); continue; }
      // the crown: no deck (a road over its foot) within its radius, below its top
      let deck = false;
      for (let a = 0; a < 8 && !deck; a++) for (const f of [0.5, 1]) { const px = x + Math.cos(a * Math.PI / 4) * r * f, pz = z + Math.sin(a * Math.PI / 4) * r * f; if ((await roadAt(px, pz))?.some(h => h.y > y + 1.5 && h.y < top)) deck = true; }
      if (deck) { crowns++; if (at.length < 4) at.push(`crown through a deck at ${x.toFixed(1)}, ${z.toFixed(1)}`); }
    }
  }
  report('trees', `${n.toLocaleString('en-GB')} trees`, trunks === 0 && crowns === 0 && n > 0, `${trunks} trunks on a road, ${crowns} crowns through a bridge deck${at.length ? `: ${at.join('; ')}` : ''} (Map v3: 9 trunks in lanes, 5 crowns through the Hackney Road bridge)`, { trunks, crowns, n });
}

// ---------- 5. junctions ----------
async function junctionsTest() {
  console.log('\n5. Junctions: every patch\'s joins with its roads');
  let joins = 0, samples = 0, holes = 0, steps = 0, worst = 0; const at: string[] = [];
  for (const J of model.junctions) {
    for (const [segId, atStart, trim] of J.arms) {
      const g: any = segById.get(segId);
      if (!g || g.internal || g.structure === 'tunnel' || g.L < trim + 1.5 || trim < 0.5) continue;
      const s = atStart ? trim : g.L - trim, into = atStart ? -1 : 1, r0 = rowAt(g, s);
      if (!inner(r0.x, r0.z)) continue;
      joins++;
      for (let q = -0.8; q <= 0.8001; q += 0.2) {
        const off = q >= 0 ? q * r0.hwL : q * r0.hwR;
        // four points along the road through the join: two in the patch, two on the road; a step is the middle
        // difference against the two either side (the road's own grade drops out)
        // (along a straight line through the join, its direction there: a bend just past it doesn't move the samples)
        const ys: (number | null)[] = [];
        for (const ds of [-0.9, -0.3, 0.3, 0.9]) {
          const x = r0.x + r0.nx * off - r0.tx * ds * into, z = r0.z + r0.nz * off - r0.tz * ds * into, ref = r0.h;
          ys.push(nearest((await roadAt(x, z))?.filter(h => Math.abs(h.y - ref) < 1.2) ?? null, ref)?.y ?? null);
        }
        samples++;
        if (ys.some(y => y == null)) { holes++; note(`hole: junction ${J.id} seg ${g.id} ${g.name ?? g.class} (${g.structure}, trim ${trim}) at ${r0.x.toFixed(1)}, ${r0.z.toFixed(1)} off ${off.toFixed(1)}: ${ys.map(y => y?.toFixed(2)).join(' ')}`); if (at.length < 4) at.push(`hole at ${r0.x.toFixed(1)}, ${r0.z.toFixed(1)} (${g.name ?? g.class})`); continue; }
        const [a, b, c, d] = ys as number[], step = Math.abs((c - b) - ((b - a) + (d - c)) / 2);
        worst = Math.max(worst, step);
        if (step > X.maxStep) { steps++; note(`step ${(step * 100).toFixed(1)} cm: junction ${J.id} seg ${g.id} ${g.name ?? g.class} (${g.structure}, trim ${trim}) at ${r0.x.toFixed(1)}, ${r0.z.toFixed(1)} off ${off.toFixed(1)}: ${ys.map(y => y?.toFixed(3)).join(' ')}`); if (at.length < 4) at.push(`${(step * 100).toFixed(1)} cm step at ${r0.x.toFixed(1)}, ${r0.z.toFixed(1)} (${g.name ?? g.class})`); }
      }
    }
  }
  report('junctions', `${joins.toLocaleString('en-GB')} joins, ${samples.toLocaleString('en-GB')} across them`, holes / samples <= X.maxJoinHoleShare && steps / samples <= X.maxStepShare && joins > 0, `${holes} with no road (${pct(holes, samples)}, limit ${pct(X.maxJoinHoleShare, 1)}), ${steps} steps over ${(X.maxStep * 100).toFixed(0)} cm (${pct(steps, samples)}, limit ${pct(X.maxStepShare, 1)}; largest ${(worst * 100).toFixed(1)} cm)${at.length ? `: ${at.join('; ')}` : ''} — Map v3: 9,364 holes at junctions in 1.26M samples (0.74%)`, { holes, steps, worst, samples });
}

// ---------- 5. bumps ----------
// straight runs across a junction, a bridge's end and a tile border, nearest the spawn: [{ kind, pts (world), at }]
function bumpRuns() {
  const runs: any[] = [], [sx, sz] = manifest.spawn.xz;
  const straight = (pts: number[][]) => { const [a, b] = [pts[0], pts[pts.length - 1]], l = Math.hypot(b[0] - a[0], b[1] - a[1]); return l > 60 && Math.max(...pts.map(p => Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / l)) < 0.6; };
  const along = (g: any, s0: number, s1: number) => { const out: number[][] = []; const n = Math.max(2, Math.ceil(Math.abs(s1 - s0) / 2)); for (let k = 0; k <= n; k++) { const r = rowAt(g, s0 + (s1 - s0) * k / n); out.push([r.x, r.z, r.h]); } return out; };
  // (two roads meeting end to end, straight on: through a junction or off a bridge)
  const ends = new Map<number, { g: any; atStart: boolean }[]>();
  for (const g of drivableRoads) for (const [n, atStart] of [[g.from, true], [g.to, false]] as [number, boolean][]) (ends.get(n) ?? ends.set(n, []).get(n)!).push({ g, atStart });
  for (const [node, list] of ends) for (let p = 0; p < list.length; p++) for (let q = p + 1; q < list.length; q++) {
    const A = list[p], B = list[q];
    if (A.g.structure === 'tunnel' || B.g.structure === 'tunnel' || A.g.L < 45 || B.g.L < 45) continue;
    const kind = A.g.structure !== B.g.structure ? 'bridge end' : model.nodes[node][3] === 2 ? 'junction' : null;
    if (!kind) continue;
    const inA = A.atStart ? along(A.g, 40, 0) : along(A.g, A.g.L - 40, A.g.L), outB = B.atStart ? along(B.g, 0, 40) : along(B.g, B.g.L, B.g.L - 40), pts = [...inA, ...outB.slice(1)];
    if (!straight(pts) || !pts.every(p => inner(p[0], p[1]))) continue;
    runs.push({ kind, pts, at: [model.nodes[node][0], model.nodes[node][1]], name: A.g.name ?? B.g.name ?? A.g.class });
  }
  for (const g of drivableRoads) {
    if (g.structure !== 'ground' || g.L < 90) continue;
    for (let s = 40; s + 40 < g.L; s += 10) {
      const a = rowAt(g, s - 5), b = rowAt(g, s + 5);
      if (Math.floor(a.x / T) === Math.floor(b.x / T) && Math.floor(a.z / T) === Math.floor(b.z / T)) continue;
      const pts = along(g, s - 40, s + 40);
      if (straight(pts) && pts.every(p => inner(p[0], p[1]))) { runs.push({ kind: 'tile border', pts, at: [rowAt(g, s).x, rowAt(g, s).z], name: g.name ?? g.class }); break; }
    }
  }
  const d = (r: any) => Math.hypot(r.at[0] - sx, r.at[1] - sz);
  return ['junction', 'bridge end', 'tile border'].flatMap(k => runs.filter(r => r.kind === k).sort((a, b) => d(a) - d(b)).slice(0, 3));
}
// the peak vertical acceleration (m/s², beyond gravity) of a car's body straight along a run at a speed, within 15 m of
// its crossing: the body's vertical speed averaged over 50 ms (what a driver feels, not one physics step's jolt)
async function bumpPeak(S: any, run: any, kmh: number) {
  const v = S.sim.vehicle, [x0, z0] = run.pts[0], [x1, z1] = run.pts[1], heading = Math.atan2(x1 - x0, z1 - z0) * 180 / Math.PI, y = S.ground(x0, z0, run.pts[0][2] + 2, true, 5) ?? run.pts[0][2];
  const [px, pz] = S.toSim(x0, z0);
  S.sim.resetCar({ position: [px, y + 0.05, pz], headingDeg: heading, speed: kmh * KMH });
  const dt = S.sim.dt, total = Math.hypot(run.pts[run.pts.length - 1][0] - x0, run.pts[run.pts.length - 1][1] - z0), win = Math.max(1, Math.round(0.05 / dt)), vs: number[] = [];
  let prev: number | null = null, peak = 0;
  for (let k = 0; k < (total / (kmh * KMH) + 0.5) / dt; k++) {
    S.sim.step(IDLE);
    const p = v.body.translation(), wx = p.x + S.origin[0], wz = p.z + S.origin[1];
    vs.push(v.body.linvel().y); if (vs.length > win) vs.shift();
    const avg = vs.reduce((a, b) => a + b, 0) / vs.length;
    if (prev != null && Math.hypot(wx - run.at[0], wz - run.at[1]) < 15 && k * dt > 0.25 && Math.abs(avg - prev) / dt > peak) { peak = Math.abs(avg - prev) / dt; S.peakAt = [wx, wz]; }
    prev = avg;
  }
  return peak;
}
async function bumpsTest() {
  console.log(`\n5. Bumps: straight across junctions, bridge ends and tile borders at ${X.bumpSpeeds.join(', ')} km/h (and the same on Map v3's bake)`);
  const limitAt = (kmh: number) => X.bumpLimits?.[kmh] ?? cfg.collision.maxBumpAccel, runs = bumpRuns(), byKind = new Map<string, number[]>(), v3By = new Map<string, number[]>();
  let over = 0;
  const M3 = fs.existsSync(path.join(ROOT, 'assets/map', region, 'manifest.json')) ? await mapHarness(region) : null;
  let worst = { a: 0, at: '' };
  for (const run of runs) {
    const mid = run.pts[Math.floor(run.pts.length / 2)], S = await M.simAround(mid[0], mid[1], { radius: 120 });
    const S3 = M3 ? await M3.simAround(mid[0], mid[1], { radius: 120 }) : null;
    for (const kmh of X.bumpSpeeds) {
      const peak = await bumpPeak(S, run, kmh);
      if (peak > limitAt(kmh)) over++;
      if (S3) (v3By.get(run.kind) ?? v3By.set(run.kind, []).get(run.kind)!).push(await bumpPeak(S3, run, kmh));
      (byKind.get(run.kind) ?? byKind.set(run.kind, []).get(run.kind)!).push(peak);
      if (peak > worst.a) worst = { a: peak, at: `${run.kind} on ${run.name} at ${kmh} km/h (${run.at.map((q: number) => q.toFixed(0)).join(', ')})` };
      note(`${run.kind} ${run.name} ${kmh} km/h: ${peak.toFixed(1)} m/s² at ${(S as any).peakAt?.map((q: number) => q.toFixed(1)).join(', ')} (run ${run.pts[0].slice(0, 2).map((q: number) => q.toFixed(1))} → ${run.pts[run.pts.length - 1].slice(0, 2).map((q: number) => q.toFixed(1))})`);
    }
    S.free(); S3?.free();
  }
  const kinds = [...byKind].map(([k, v]) => `${k}s ${v.length / X.bumpSpeeds.length} × ${X.bumpSpeeds.length}: ≤ ${Math.max(...v).toFixed(1)}${v3By.has(k) ? ` (v3 ${Math.max(...v3By.get(k)!).toFixed(1)})` : ''}`).join(', ');
  report('bumps', `${runs.length} crossings × ${X.bumpSpeeds.length} speeds`, over === 0 && runs.length > 0, `${kinds} m/s² (limits ${X.bumpSpeeds.map((k: number) => `${limitAt(k)} at ${k} km/h`).join(', ')}; ${over} over); worst ${worst.at}`, { worst: worst.a, byKind: Object.fromEntries([...byKind].map(([k, v]) => [k, Math.max(...v)])), v3: Object.fromEntries([...v3By].map(([k, v]) => [k, Math.max(...v)])) });
}
// ---------- 6. lamps ----------
async function lampsTest() {
  console.log('\n6. Street lighting');
  const lamps: number[][] = [];
  let onRoad = 0, est = 0; const at: string[] = [];
  for (const t of manifest.tiles) {
    const d = await tile(t.i, t.j), L = d?.lists.lamps;
    if (!L) continue;
    const cx = (t.i + 0.5) * T, cz = (t.j + 0.5) * T;
    for (let k = 0; k < L.data.length; k += L.stride) {
      const x = L.data[k] + cx, y = L.data[k + 1], z = L.data[k + 2] + cz;
      lamps.push([x, z]); if (L.data[k + 5] & 1) est++;
      if ((await roadAt(x, z))?.some(h => h.surf !== KERB && Math.abs(h.y - y) < 1.5)) { onRoad++; if (at.length < 3) at.push(`${x.toFixed(1)}, ${z.toFixed(1)}`); }
    }
  }
  report('lamps', `${lamps.length.toLocaleString('en-GB')} lamps (${est.toLocaleString('en-GB')} estimated)`, onRoad === 0 && lamps.length > 0, `${onRoad} standing on a road's lanes${at.length ? ` (${at.join('; ')})` : ''} (Map v3: no lamps at all)`, { lamps: lamps.length, estimated: est });
  // along every road the bake lit (lit=yes, the always-lit classes and motorways everywhere, urban classes in built-up
  // areas: the road model file's `lamps`; an older bake without it: every lit class): within lampReach m of one
  const C = 32, grid = new Map<string, number[][]>();
  for (const p of lamps) { const k = `${Math.floor(p[0] / C)},${Math.floor(p[1] / C)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(p); }
  const near = (x: number, z: number, r: number) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const p of grid.get(`${Math.floor(x / C) + a},${Math.floor(z / C) + b}`) ?? []) if (Math.hypot(p[0] - x, p[1] - z) < r) return true; return false; };
  const lit = new Set([...cfg.lamps.urbanClasses, ...cfg.lamps.motorwayClasses]);
  let n = 0, covered = 0;
  for (const g of drivableRoads) {
    if (g.structure === 'tunnel' || g.lit === 'no' || (g.lamps !== undefined ? !g.lamps : !lit.has(g.link ? 'link' : g.class))) continue;
    for (let s = 5; s < g.L - 5; s += 10) { const r = rowAt(g, s); if (!inner(r.x, r.z)) continue; n++; if (near(r.x, r.z, X.lampReach)) covered++; }
  }
  report('lamps', `${n.toLocaleString('en-GB')} points along lit roads`, covered / n >= X.lampCoverage, `${pct(covered, n)} have a lamp within ${X.lampReach} m (at least ${pct(X.lampCoverage, 1)})`, { coverage: covered / n });
  // the real lights: the nearest few, the farthest of them fading in as the next one out comes near
  const THREE = await import('three'), scene = new THREE.Scene(), Lr = lampLights(scene, manifest.lamps), cam = new THREE.PerspectiveCamera();
  const group = new THREE.Group(); scene.add(group);
  const heads = new Float32Array([0, 8, 5, 0, 8, 40, 0, 8, 75, 0, 8, 110, 0, 8, 145, 0, 8, 180, 0, 8, 215, 0, 8, 250, 0, 8, 285]);
  Lr.frame(cam, 1, [{ group, heads }]);
  const N = manifest.lamps.realLights, on = Lr.lights.filter(l => l.intensity > 0), zs = on.map(l => l.position.z).sort((a, b) => a - b);
  const nearestN = zs.length === N && zs.every((z, k) => z === heads[k * 3 + 2]);
  Lr.frame(cam, 0, [{ group, heads }]);
  const offByDay = Lr.lights.every(l => l.intensity === 0);
  report('lamps', `the nearest ${N} as real lights`, nearestN && offByDay, `${on.length} lit at night, the nearest ${N} (${zs.map(z => z.toFixed(0)).join(', ')} m); farthest at ${(Lr.lights[N - 1].intensity / (manifest.lamps.realLightIntensity) * 100).toFixed(0)}% (fading in); all off by day: ${offByDay}`);
  Lr.dispose();
}

// ---------- bad spots ----------
async function badSpotsTest() {
  const list = badSpots();
  console.log(`\nKnown bad spots: ${list.length} in this bake`);
  for (const b of list) {
    const [bx, bz] = b.xz, R = X.badSpotRadius;
    let pts = 0, holes = 0, through = 0, physBad = 0;
    const S = await M.simAround(bx, bz, { radius: R + 20 });
    // (on the road: within a road's drawn half width, less 20 cm, of its centre — every layer)
    for (const g of drivableRoads) {
      if (g.structure === 'tunnel') continue;
      for (let s = 0; s <= g.L; s += 1) {
        const r = rowAt(g, s);
        if (Math.abs(r.x - bx) > R + 15 || Math.abs(r.z - bz) > R + 15) continue;
        for (let o = -r.hwR + 0.2; o <= r.hwL - 0.2; o += 1) {
          const x = r.x + r.nx * o, z = r.z + r.nz * o;
          if (Math.abs(x - bx) > R || Math.abs(z - bz) > R) continue;
          pts++;
          const hit = nearest((await roadAt(x, z))?.filter(h => Math.abs(h.y - r.h) < 2) ?? null, r.h);
          if (!hit) { holes++; note(`hole at ${x.toFixed(2)}, ${z.toFixed(2)} (${g.name ?? g.class}, ${g.structure}, h ${r.h.toFixed(2)}): drawn ${(await roadAt(x, z))?.map(h => h.y.toFixed(2)).join(' ')}`); continue; }
          if (g.structure === 'ground') { const g0 = await groundAt(x, z, 0); if (g0 != null && g0 > hit.y + 0.005) through++; }
          // (on a drawn road surface there — where two overlap, the car rides the upper: the overlaps are test 2's)
          const y = S.ground(x, z, hit.y + 0.4, true, 1.5), drawn = (await roadAt(x, z)) ?? [];
          if (y == null || !drawn.some((h: any) => Math.abs(y - h.y) <= X.maxPhysicsGap)) { physBad++; note(`off the collision surface at ${x.toFixed(2)}, ${z.toFixed(2)} (${g.name ?? g.class}): physics ${y?.toFixed(3)}, drawn ${drawn.map((h: any) => h.y.toFixed(3)).join(' ')}`); }
        }
      }
    }
    S.free();
    report('badspots', `${(b.road ?? b.note ?? '').slice(0, 44)}`, pts > 0 && holes === 0 && through === 0 && physBad === 0, `${pts} road points within ${R} m: ${holes} holes, ${through} under the ground, ${physBad} off the collision surface`, { holes, through, physBad, pts });
  }
}

// ---------- seams ----------
async function seamsTest() {
  console.log('\nSeams: the road surface\'s vertices on shared tile edges');
  let pairs = 0, verts = 0, unmatched = 0;
  for (const t of manifest.tiles) for (const [di, dj] of [[1, 0], [0, 1]]) {
    if (!baked.has(`${t.i + di}_${t.j + dj}`)) continue;
    const a = (await tile(t.i, t.j))?.lists.roadBorder?.data, b = (await tile(t.i + di, t.j + dj))?.lists.roadBorder?.data;
    if (!a || !b) continue;
    pairs++;
    const half = T / 2, key = (u: number, y: number) => `${Math.round(u * 100)},${Math.round(y * 100)}`, have = new Set<string>();
    // (b's vertices on its near edge, by their place along it and height; a's on its far edge must be among them)
    for (let k = 0; k < b.length; k += 4) if (Math.abs((di ? b[k] : b[k + 2]) + half) < 1e-3) have.add(key(di ? b[k + 2] : b[k], b[k + 1]));
    for (let k = 0; k < a.length; k += 4) {
      if (Math.abs((di ? a[k] : a[k + 2]) - half) > 1e-3) continue;
      verts++;
      const u = di ? a[k + 2] : a[k], y = a[k + 1];
      if (![-1, 0, 1].some(e => [-1, 0, 1].some(f => have.has(key(u + e / 100, y + f / 100))))) unmatched++;
    }
  }
  report('seams', `${pairs} shared tile edges`, unmatched === 0 && verts > 0, `${verts.toLocaleString('en-GB')} road vertices on them: ${unmatched} without their neighbour's (within 1 cm)`, { unmatched, verts });
}

const TESTS: Record<string, () => Promise<void>> = { widths: widthsTest, surface: surfaceTest, edges: edgesTest, colliders: collidersTest, trees: treesTest, junctions: junctionsTest, bumps: bumpsTest, lamps: lampsTest, badspots: badSpotsTest, seams: seamsTest };
const t0 = performance.now();
console.log(`Map v4's tests: ${manifest.name} (${manifest.tiles.length} tiles, roads ${manifest.roadModel.version}, bake ${manifest.version})`);
for (const [id, fn] of Object.entries(TESTS)) if (!only || only.includes(id)) await fn();
const failed = rows.filter(r => !r.pass);
console.log(`\n${rows.length - failed.length} of ${rows.length} passed in ${((performance.now() - t0) / 1000).toFixed(0)} s${failed.length ? ` — failed: ${failed.map(r => `${r.test}: ${r.name}`).join('; ')}` : ''}\n`);
if (opt('--json')) fs.writeFileSync(opt('--json')!, JSON.stringify({ region, bake: manifest.version, tiles: manifest.tiles.length, rows }, null, 1));
process.exit(failed.length ? 1 : 0);
