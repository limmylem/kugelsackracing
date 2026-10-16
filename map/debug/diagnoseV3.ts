// Map v4 Step 0 (MAP_V4_DIAGNOSIS.md): the six known Map v3 problems measured in a baked v3 region, with
// coordinates, before anything changes. Reads the baked tiles and road graph as the game does (tests/map/
// harness.ts), and for every road segment in the area samples its centreline every `step` m across its width:
//   holes      no road triangle under a point the road's own width covers (a piece "cut out")
//   pokes      the drawn terrain (each level of detail) above the road surface there (ground through the road)
//   overlaps   two road triangles over one point within 0.5 m of each other but not level (z-fighting, a step)
//   trees      a tree whose crown reaches a road surface or a bridge deck over it; a trunk collider in a lane
//   hulls      a building's collider over a road surface at the road's height
//   barriers   a railing's collider over a road surface
//   widths     the drawn widths by road class
//   lamps      what lighting there is (none in v3) and what OSM has
//
//   node map/debug/diagnoseV3.ts --region adelaide [--around lat,lon,km]… [--json out.json]

import fs from 'node:fs';
import path from 'node:path';
import { mapHarness } from '../../tests/map/harness.ts';
import { barrierBoxes } from '../format/barriers.ts';

const args = process.argv.slice(2), opts = (n: string) => args.flatMap((a, i) => (a === n ? [args[i + 1]] : []));
const region = opts('--region')[0] ?? 'adelaide', step = 2;
const M = await mapHarness(region), G = M.graph(), T = M.T;
const areas = (opts('--around').length ? opts('--around') : [`${M.manifest.spawn.lat},${M.manifest.spawn.lon},2.5`]).map(s => { const [la, lo, km] = s.split(',').map(Number); const [x, z] = M.P.toXZ(la, lo); return { x, z, r: km * 1000 }; });
const inArea = (x: number, z: number) => areas.some(a => Math.abs(x - a.x) <= a.r && Math.abs(z - a.z) <= a.r);

// the tiles over the areas, decoded with their terrain meshes
const keys = new Set<string>();
for (const a of areas) for (let j = Math.floor((a.z - a.r) / T); j <= Math.floor((a.z + a.r) / T); j++) for (let i = Math.floor((a.x - a.r) / T); i <= Math.floor((a.x + a.r) / T); i++) keys.add(`${i}_${j}`);
const tiles = new Map<string, any>();
for (const k of keys) { const [i, j] = k.split('_').map(Number); const d = await M.tile(i, j); if (d) tiles.set(k, { i, j, d }); }
console.log(`${region}: ${tiles.size} tiles decoded over ${areas.length} area(s)`);

// a grid of world-frame triangles per mesh kind, for point queries: [ax, ay, az, bx, by, bz, cx, cy, cz]
const C = 4;
function triIndex(meshName: (k: string) => boolean, maxTri = Infinity) {
  const grid = new Map<string, Float64Array[]>();
  for (const { i, j, d } of tiles.values()) for (const [name, m] of Object.entries<any>(d.meshes)) {
    if (!meshName(name)) continue;
    const cx = (i + 0.5) * T, cz = (j + 0.5) * T, P = m.positions, I = m.indices, end = Math.min(I.length, m.skirtFrom ?? Infinity, maxTri * 3);
    for (let t = 0; t < end; t += 3) {
      const v = [I[t], I[t + 1], I[t + 2]], tri = new Float64Array(9);
      v.forEach((q, k) => { tri[k * 3] = P[q * 3] + cx; tri[k * 3 + 1] = P[q * 3 + 1]; tri[k * 3 + 2] = P[q * 3 + 2] + cz; });
      const x0 = Math.min(tri[0], tri[3], tri[6]), x1 = Math.max(tri[0], tri[3], tri[6]), z0 = Math.min(tri[2], tri[5], tri[8]), z1 = Math.max(tri[2], tri[5], tri[8]);
      if (x1 - x0 < 1e-6 && z1 - z0 < 1e-6) continue;
      for (let a = Math.floor(x0 / C); a <= Math.floor(x1 / C); a++) for (let b = Math.floor(z0 / C); b <= Math.floor(z1 / C); b++) { const key = `${a},${b}`; (grid.get(key) ?? grid.set(key, []).get(key)!).push(tri); }
    }
  }
  // the heights of every triangle over (x, z) (upright ones skipped)
  return (x: number, z: number) => {
    const out: number[] = [];
    for (const t of grid.get(`${Math.floor(x / C)},${Math.floor(z / C)}`) ?? []) {
      const d = (t[5] - t[8]) * (t[0] - t[6]) + (t[6] - t[3]) * (t[2] - t[8]);
      if (Math.abs(d) < 1e-9) continue;
      const l1 = ((t[5] - t[8]) * (x - t[6]) + (t[6] - t[3]) * (z - t[8])) / d, l2 = ((t[8] - t[2]) * (x - t[6]) + (t[0] - t[6]) * (z - t[8])) / d, l3 = 1 - l1 - l2;
      if (l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) out.push(l1 * t[1] + l2 * t[4] + l3 * t[7]);
    }
    return out;
  };
}
const roadAt = triIndex(n => n === 'roads');
const terrainAt = [0, 1].map(l => triIndex(n => n === `terrain${l}`));
const nodeH = G.nodes.h, junctionNodes = new Set<number>();
{ const deg = new Map<number, number>(); for (const s of G.segs) { deg.set(s.from, (deg.get(s.from) ?? 0) + 1); deg.set(s.to, (deg.get(s.to) ?? 0) + 1); } for (const [n, d] of deg) if (d >= 3) junctionNodes.add(n); }

const ll = (x: number, z: number) => M.P.toLatLon(x, z).map(v => +v.toFixed(6));
const found: Record<string, any[]> = { holes: [], holesAtJunctions: [], pokes0: [], pokes1: [], overlaps: [], steps: [] };
let samples = 0, segsSeen = 0;
for (const s of G.segs) {
  const P = s.points, n = P.length / 3;
  if (!inArea(P[0], P[1])) continue;
  segsSeen++;
  const hw = s.width / 2;
  let along = 0;
  for (let k = 0; k + 1 < n; k++) {
    const ax = P[k * 3], az = P[k * 3 + 1], ah = P[k * 3 + 2], bx = P[k * 3 + 3], bz = P[k * 3 + 4], bh = P[k * 3 + 5], L = Math.hypot(bx - ax, bz - az) || 1e-9, ux = (bx - ax) / L, uz = (bz - az) / L;
    for (let d = (step - (along % step)) % step; d < L; d += step) {
      const x = ax + ux * d, z = az + uz * d, h = ah + (bh - ah) * d / L, total = along + d, Ls = segLength(s);
      // (how far from a junction: the junction fans there)
      const nearJ = (junctionNodes.has(s.from) && total < hw * 2.5 + 2) || (junctionNodes.has(s.to) && Ls - total < hw * 2.5 + 2);
      for (const f of [-0.85, -0.5, 0, 0.5, 0.85]) {
        const px = x - uz * f * hw, pz = z + ux * f * hw;
        samples++;
        const hs = roadAt(px, pz).filter(y => Math.abs(y - h) < 1.5);
        const where = { at: ll(px, pz), xz: [+px.toFixed(1), +pz.toFixed(1)], seg: s.id, name: s.name, class: s.class, structure: s.structure, offset: f };
        if (!hs.length) { (nearJ ? found.holesAtJunctions : found.holes).push(where); continue; }
        const top = Math.max(...hs);
        if (s.structure === 'ground') for (const lod of [0, 1]) {
          const th = terrainAt[lod](px, pz).filter(y => y < top + 3);
          const t = th.length ? Math.max(...th) : -Infinity;
          if (t > top + 0.01) found[`pokes${lod}`].push({ ...where, above: +(t - top).toFixed(2) });
        }
        // (two road surfaces over one spot, close in height: overlapping copies)
        const near = hs.filter(y => Math.abs(y - top) < 0.5);
        if (near.length > 1) { const spread = Math.max(...near) - Math.min(...near); (spread > 0.02 ? found.steps : found.overlaps).push({ ...where, spread: +spread.toFixed(3), nearJunction: nearJ }); }
      }
    }
    along += L;
  }
}
function segLength(s: any) { let L = 0; const P = s.points; for (let k = 3; k < P.length; k += 3) L += Math.hypot(P[k] - P[k - 3], P[k + 1] - P[k - 2]); return L; }

// trees, buildings and railings against the road surfaces
const trees: any[] = [], hulls: any[] = [], bars: any[] = [];
let treeCount = 0;
for (const { i, j, d } of tiles.values()) {
  const cx = (i + 0.5) * T, cz = (j + 0.5) * T;
  const Tr = d.lists.trees?.data ?? [];
  for (let k = 0; k < Tr.length; k += 5) {
    treeCount++;
    const x = Tr[k] + cx, y = Tr[k + 1], z = Tr[k + 2] + cz, sc = Tr[k + 3] * 4, conifer = Tr[k + 4] === 1, crownR = sc * (conifer ? 0.55 : 0.75), top = y + sc * (conifer ? 2.95 : 1.95);
    // the trunk (its collider: radius 0.25) in a road; the crown over any road surface between its foot and its top
    // (the trunk's collider — radius 0.25 — anywhere in a road at its foot's level; the crown through a road
    // surface above the ground it stands on — a bridge deck or a road on a bank — not a canopy over a kerb)
    const trunk = [0, 1, 2, 3].some(a => roadAt(x + Math.cos(a * Math.PI / 2) * 0.25, z + Math.sin(a * Math.PI / 2) * 0.25).some(h => h > y - 0.5 && h < y + 2));
    let crown = null;
    for (let a = 0; a < 9 && crown == null; a++) { const r = a ? crownR * 0.7 : 0, px = x + Math.cos(a * Math.PI / 4) * r, pz = z + Math.sin(a * Math.PI / 4) * r; const hs = roadAt(px, pz).filter(h => h > y + 2.5 && h < top); if (hs.length) crown = Math.max(...hs); }
    if (trunk || crown != null) trees.push({ at: ll(x, z), xz: [+x.toFixed(1), +z.toFixed(1)], trunkInRoad: trunk, deckThroughCrown: crown != null ? +(crown - y).toFixed(1) : null, base: +y.toFixed(2) });
  }
  const H = d.lists.hulls?.data ?? [];
  for (let k = 0; k < H.length;) {
    const nn = H[k], y0 = H[k + 1], y1 = H[k + 2], pts: number[][] = [];
    for (let q = 0; q < nn; q++) pts.push([H[k + 3 + q * 2] + cx, H[k + 4 + q * 2] + cz]);
    k += 3 + nn * 2;
    let mx = 0, mz = 0; for (const p of pts) { mx += p[0]; mz += p[1]; } mx /= nn; mz /= nn;
    // (the hull's corners pulled 0.3 m in, and its middle: a road surface under any at its height)
    for (const p of [...pts.map(p => [p[0] + (mx - p[0]) * 0.1, p[1] + (mz - p[1]) * 0.1]), [mx, mz]]) {
      const hs = roadAt(p[0], p[1]).filter(h => h > y0 - 0.3 && h < y1);
      if (hs.length) { hulls.push({ at: ll(p[0], p[1]), xz: [+p[0].toFixed(1), +p[1].toFixed(1)], hull: [+y0.toFixed(1), +y1.toFixed(1)], road: +hs[0].toFixed(2) }); break; }
    }
  }
  for (const [name, L] of Object.entries<any>(d.lists)) {
    if (!name.startsWith('barrier_')) continue;
    for (const b of barrierBoxes(name.slice(8), L.data, M.manifest.barriers, L.stride)) {
      const x = b.centre[0] + cx, z = b.centre[2] + cz, hs = roadAt(x, z).filter(h => Math.abs(h - (b.centre[1] - b.halfExtents[1])) < 1.5);
      if (hs.length) bars.push({ type: name.slice(8), at: ll(x, z), xz: [+x.toFixed(1), +z.toFixed(1)] });
    }
  }
}

// widths by class (the drawn width), and what OSM tagged
const widths: Record<string, number[]> = {};
for (const s of G.segs) (widths[s.class] ??= []).push(s.width);
const med = (a: number[]) => { const b = a.slice().sort((p, q) => p - q); return b[b.length >> 1]; };
const pct = (n: number) => `${n} (${(100 * n / samples).toFixed(2)}% of samples)`;
const report = {
  region, areas: areas.map(a => ({ ...a, latLon: ll(a.x, a.z) })), tiles: tiles.size, segments: segsSeen, samples, trees: treeCount,
  counts: Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.length])), treesOnRoads: trees.length, treesTrunkInRoad: trees.filter(t => t.trunkInRoad).length, treesThroughDecks: trees.filter(t => t.deckThroughCrown != null && !t.trunkInRoad).length, hullsOnRoads: hulls.length, barriersOnRoads: bars.length,
  widths: Object.fromEntries(Object.entries(widths).map(([k, v]) => [k, { n: v.length, median: med(v), min: Math.min(...v), max: Math.max(...v) }])),
  examples: { ...Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.filter((_, q) => q % Math.max(1, Math.floor(v.length / 12)) === 0).slice(0, 12)])), trees: trees.slice(0, 12), treesThroughDecks: trees.filter(t => t.deckThroughCrown != null && !t.trunkInRoad).slice(0, 12), hulls: hulls.slice(0, 12), barriers: bars.slice(0, 12) },
};
console.log(`segments ${segsSeen}, samples ${samples}`);
for (const [k, v] of Object.entries(found)) console.log(`  ${k}: ${pct(v.length)}`);
console.log(`  trees on roads: ${trees.length} of ${treeCount} (trunk in a lane ${report.treesTrunkInRoad}; crown through a deck or road above ${report.treesThroughDecks})`);
console.log(`  building colliders on roads: ${hulls.length}; railing colliders on roads: ${bars.length}`);
console.log('  widths (drawn) by class:', Object.entries(report.widths).map(([k, v]: any) => `${k} ${v.median}`).join(', '));
const out = opts('--json')[0];
if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 1)); console.log(`wrote ${out}`); }
