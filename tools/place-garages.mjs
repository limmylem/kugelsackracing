// The starting garages (data/world/garages.json): a few drive-through garage buildings in each baked region
// (play/garageBuilding.js), placed from the region's road graph — beside a straight stretch of a wide road at ground
// level (no bridge or tunnel), away from junctions, with no road, building or tree where the forecourt, canopy and
// workshop stand,
// a drive from the region's spawn and well apart from each other. The server publishes them at start
// (server/src/content/garages.ts); without a server the game shows them as they are (content/client.js).
//
//   node tools/place-garages.mjs            (writes data/world/garages.json)
//   node tools/place-garages.mjs --check    (says what it would place; writes nothing)

import fs from 'node:fs';
import zlib from 'node:zlib';
import { transverseMercator } from '../map/build/format/projection.js';
import { decodeTile } from '../map/build/format/tileFormat.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { FOOTPRINT } from '../play/garageBuilding.js';
await MeshoptDecoder.ready;

const PER_REGION = 3, APART = 900;
// (looked for as strictly as the region allows: each tier a little less fussy, until it has its garages —
// a mountain pass or a crowded old town has fewer wide, straight roads)
const MAIN = ['primary', 'secondary', 'tertiary', 'trunk', 'unclassified'];
const TIERS = [
  { classes: MAIN, width: 9, piece: 70, junction: 55, near: [220, 2600] },
  { classes: MAIN, width: 7, piece: 55, junction: 45, near: [200, 4000] },
  { classes: [...MAIN, 'residential', 'road'], width: 5.5, piece: 45, junction: 40, near: [150, 6000] },
  { classes: [...MAIN, 'residential', 'road'], width: 4.5, piece: 36, junction: 32, near: [120, 12000] },
  { classes: [...MAIN, 'residential', 'road', 'track', 'service'], width: 3.5, piece: 26, junction: 25, near: [100, 20000] },
  { classes: [...MAIN, 'residential', 'road', 'track', 'service'], width: 3, piece: 14, junction: 20, near: [80, 20000] },
];
// (the building's footprint in its frame — x across, the workshop on +x; z along: play/garageBuilding.js)
// (beside the road, on its right: from the road's edge to behind the workshop — play/garageBuilding.js FOOTPRINT; other
// roads kept a road's half-width further off)
const FOOT = FOOTPRINT, ROAD_CLEAR = 5;
const check = process.argv.includes('--check');
const regions = JSON.parse(fs.readFileSync('data/map/baked.json', 'utf8')).regions;
const out = [];

for (const r of regions) {
  const manifest = JSON.parse(fs.readFileSync(r.manifest, 'utf8')), base = r.manifest.replace(/manifest\.json$/, '');
  const G = JSON.parse(zlib.gunzipSync(fs.readFileSync(base + manifest.files.graph)));
  const P = transverseMercator(manifest.projection.lat0, manifest.projection.lon0);
  const [sx, sz] = manifest.spawn.xz;
  // junctions: nodes three or more roads meet at
  const deg = new Map();
  for (const s of G.segs) for (const n of [s.from, s.to]) deg.set(n, (deg.get(n) ?? 0) + 1);
  const junctions = [];
  for (const [n, d] of deg) if (d >= 3) junctions.push([G.nodes.x[n], G.nodes.z[n]]);
  // every road piece on a grid (for "is another road through the footprint?")
  const grid = new Map(), cell = 60, key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  G.segs.forEach((s, si) => { for (let k = 0; k + 5 < s.points.length; k += 3) { const kk = key(s.points[k], s.points[k + 1]); (grid.get(kk) ?? grid.set(kk, []).get(kk)).push([si, k]); } });
  const near = (x, z) => { const out = []; const i = Math.floor(x / cell), j = Math.floor(z / cell); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) out.push(...(grid.get(`${i + a},${j + b}`) ?? [])); return out; };

  // what's built or growing there: the tiles' roofs (rasterised on a 2 m grid) and trees (3 m round), in the region's frame
  const T_SIZE = manifest.grid.tileSize, CELL = 2, tiles = new Map();
  async function tileCells(i, j) {
    const k = `${i}_${j}`;
    if (tiles.has(k)) return tiles.get(k);
    const cells = new Set(), file = `${base}tiles/${k}.m3t`;
    tiles.set(k, cells);
    if (!fs.existsSync(file)) return cells;
    const t = await decodeTile(new Uint8Array(zlib.gunzipSync(fs.readFileSync(file))), MeshoptDecoder);
    const cx = (i + 0.5) * T_SIZE, cz = (j + 0.5) * T_SIZE, mark = (x, z) => cells.add(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    const roofs = t.meshes.roofs;
    if (roofs) {
      const P_ = roofs.positions, I = roofs.indices;
      for (let n = 0; n + 2 < I.length; n += 3) {
        const a = I[n] * 3, b = I[n + 1] * 3, c = I[n + 2] * 3;
        const ax = P_[a] + cx, az = P_[a + 2] + cz, bx = P_[b] + cx, bz = P_[b + 2] + cz, qx = P_[c] + cx, qz = P_[c + 2] + cz;
        const area = (bx - ax) * (qz - az) - (qx - ax) * (bz - az);
        if (Math.abs(area) < 1e-6) continue;
        for (let gx = Math.floor(Math.min(ax, bx, qx) / CELL); gx <= Math.floor(Math.max(ax, bx, qx) / CELL); gx++) for (let gz = Math.floor(Math.min(az, bz, qz) / CELL); gz <= Math.floor(Math.max(az, bz, qz) / CELL); gz++) {
          // (a cell is built on if any of its corners or its middle is under the roof)
          for (const [ox, oz] of [[0.5, 0.5], [0, 0], [1, 0], [0, 1], [1, 1]]) {
            const px = (gx + ox) * CELL, pz = (gz + oz) * CELL;
            const w1 = ((bx - px) * (qz - pz) - (qx - px) * (bz - pz)) / area, w2 = ((qx - px) * (az - pz) - (ax - px) * (qz - pz)) / area, w3 = 1 - w1 - w2;
            if (w1 >= 0 && w2 >= 0 && w3 >= 0) { cells.add(`${gx},${gz}`); break; }
          }
        }
      }
    }
    const trees = t.lists.trees;
    if (trees) for (let n = 0; n + 2 < trees.data.length; n += trees.stride) { const x = trees.data[n] + cx, z = trees.data[n + 2] + cz; for (let a = -3; a <= 3; a += 1.5) for (let b = -3; b <= 3; b += 1.5) if (a * a + b * b <= 9) mark(x + a, z + b); }
    return cells;
  }
  async function occupied(x, z) { const cells = await tileCells(Math.floor(x / T_SIZE), Math.floor(z / T_SIZE)); return cells.has(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`); }
  // (the footprint clear of buildings and trees: every 1.5 m over it)
  async function clearOfBuildings(c) {
    const rx = -c.fz, rz = c.fx;
    for (let lx = FOOT.x0; lx <= FOOT.x1; lx += 1.5) for (let lz = FOOT.z0; lz <= FOOT.z1; lz += 1.5) {
      const x = c.x + rx * lx - c.fx * lz, z = c.z + rz * lx - c.fz * lz;
      if (await occupied(x, z)) return false;
    }
    return true;
  }

  // candidates: the middle of a long straight piece of a wide road on the ground
  const candidates = T => { const cand = [], CLASSES = new Set(T.classes), PIECE = T.piece, JUNCTION_M = T.junction, NEAR = T.near;
  G.segs.forEach((s, si) => {
    if (!CLASSES.has(s.class) || s.link || (s.structure && s.structure !== 'ground') || (s.layer ?? 0) !== 0 || (s.width ?? 0) < T.width) return;
    // (a straight stretch: PIECE metres along the road whose chord is within 2% of its length — the graph's points
    // can be a few metres apart, so a stretch spans several of them)
    const p = s.points, arc = [0];
    for (let k = 3; k < p.length; k += 3) arc.push(arc[arc.length - 1] + Math.hypot(p[k] - p[k - 3], p[k + 1] - p[k - 2]));
    for (let k = 0, e = 0; k + 5 < p.length; k += 3) {
      const ki = k / 3;
      if (e < ki) e = ki;
      while (e < arc.length - 1 && arc[e] - arc[ki] < PIECE) e++;
      if (arc[e] - arc[ki] < PIECE) break;
      const ax = p[k], az = p[k + 1], bx = p[e * 3], bz = p[e * 3 + 1], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.98 * (arc[e] - arc[ki])) continue;
      const x = (ax + bx) / 2, z = (az + bz) / 2, d = Math.hypot(x - sx, z - sz);
      if (d < NEAR[0] || d > NEAR[1]) continue;
      // (inside the region's box — data/map/baked.json, what the game and the editor call the region — with room to spare)
      { const [la, lo] = P.toLatLon(x, z), m = 0.0015; if (!(lo > r.bbox[0] + m && lo < r.bbox[2] - m && la > r.bbox[1] + m && la < r.bbox[3] - m)) continue; }
      if (junctions.some(([jx, jz]) => Math.hypot(jx - x, jz - z) < JUNCTION_M)) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      // the way through: the road's way (a one-way street: its way only); the workshop on the clear side
      const ways = s.oneway === 1 ? [[ux, uz]] : s.oneway === -1 ? [[-ux, -uz]] : [[ux, uz], [-ux, -uz]];
      for (const [fx, fz] of ways) {
        const rx = -fz, rz = fx;   // (right of forward in x east / z south: forward (sin b, −cos b) → right (cos b, sin b))
        // (no road through it — this one's own pieces too, should it bend into the forecourt)
        const blocked = near(x, z).some(([sj, kk]) => {
          const q = G.segs[sj].points, clear = sj === si ? 0 : ROAD_CLEAR;
          for (let t = 0; t <= 1; t += 0.125) {
            const px = q[kk] + (q[kk + 3] - q[kk]) * t - x, pz = q[kk + 1] + (q[kk + 4] - q[kk + 1]) * t - z;
            const lx = px * rx + pz * rz, lz = -(px * fx + pz * fz);
            if (lx > FOOT.x0 - clear && lx < FOOT.x1 + clear && lz > FOOT.z0 - clear && lz < FOOT.z1 + clear) return true;
          }
          return false;
        });
        if (blocked) continue;
        const h = (p[k + 2] + p[e * 3 + 2]) / 2, bearing = ((Math.atan2(fx, -fz) * 180 / Math.PI) + 360) % 360;
        cand.push({ x, z, h, bearing, d, fx, fz, road: s.name ?? null, cls: s.class, width: s.width });
      }
    }
  });
  return cand; };
  // pick: nearest the spawn first (a short drive), each after well apart from those picked — the strictest tier first
  // (apart: 900 m, or a fifth of a small region's size)
  const [w0, s0] = P.toXZ(r.bbox[1], r.bbox[0]), [e0, n0] = P.toXZ(r.bbox[3], r.bbox[2]), apart = Math.min(APART, Math.hypot(e0 - w0, n0 - s0) / 5);
  const picked = [];
  let cand = [];
  for (const T of TIERS) {
    if (picked.length >= PER_REGION) break;
    cand = candidates(T).sort((a, b) => a.d - b.d);
    for (const c of cand) {
      if (picked.length >= PER_REGION) break;
      if (picked.some(p => Math.hypot(p.x - c.x, p.z - c.z) < apart)) continue;
      if (!(await clearOfBuildings(c))) continue;
      picked.push(c);
    }
  }
  const names = new Set();
  picked.forEach((c, n) => {
    const [lat, lon] = P.toLatLon(c.x, c.z);
    let name = c.road ? `${c.road} Garage` : `${r.name} Garage`;
    for (let k = 2; names.has(name); k++) name = `${c.road ? `${c.road} Garage` : `${r.name} Garage`} ${k}`;
    names.add(name);
    out.push({
      id: `garage_side${r.id}${n + 1}`, region: r.id, name,
      location: { lat: Math.round(lat * 1e7) / 1e7, lon: Math.round(lon * 1e7) / 1e7, alt: Math.round(c.h * 100) / 100, heading: Math.round(c.bearing * 10) / 10, altFrom: 'road' },
      road: c.road ? { name: c.road, class: c.cls, source: 'graph' } : null,
    });
  });
  console.log(`${r.id}: ${picked.length} of ${cand.length} candidates — ${picked.map(c => `${c.road ?? '(unnamed)'} ${Math.round(c.d)} m from spawn, ${c.width} m wide`).join(' · ')}`);
}
if (!check) {
  fs.mkdirSync('data/world', { recursive: true });
  // (the earlier starting garages not in this set: archived where nobody's touched them since — server/src/content/garages.ts)
  let before = { garages: [], retired: [] };
  try { before = JSON.parse(fs.readFileSync('data/world/garages.json', 'utf8')); } catch { /* the first */ }
  const ids = new Set(out.map(g => g.id)), retired = [...new Set([...(before.retired ?? []), ...(before.garages ?? []).map(g => g.id)])].filter(id => !ids.has(id));
  fs.writeFileSync('data/world/garages.json', JSON.stringify({ _note: 'The starting garages: drive-through garage buildings in each baked region (world content of kind garage), each beside its road on the right of its heading. Made by node tools/place-garages.mjs from the road graphs; published by the server at start (server/src/content/garages.ts) and shown without a server too (content/client.js). Edit them in the world editor like any other garage. retired: earlier starting garages, archived where nobody has changed them since.', garages: out, retired }, null, 2) + '\n');
  console.log(`data/world/garages.json: ${out.length} garages`);
}
