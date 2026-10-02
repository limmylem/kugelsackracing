// The collision surface for one chunk of the real world, built from OpenStreetMap roads and terrain
// heights (pure data, no rendering library: it runs in a Web Worker, and in the tests).
//
//  1. Roads become a network of points every few metres (points shared where roads meet).
//  2. Each point gets a height: the terrain under it, smoothed along the road (so the road is smooth
//     even where the terrain data is bumpy). Bridges and tunnels don't follow the ground: they run from
//     where they meet it at one end to the other. Where a road crosses over another on a higher layer,
//     it's lifted to clear it, with ramps either side no steeper than GRADE (and tunnels are kept under
//     the ground and under roads above them the same way). At a junction the major road keeps its
//     own heights, and the minor road takes the major road's surface where they overlap.
//  3. Roads become ribbons: level across (apart from a slight camber from the crown), their real width
//     (from the lanes / width tags), their edges tucked down under the terrain beside them.
//  4. The terrain is a height grid (Rapier heightfield) that meets the roads at their edges: under a
//     road it sits just below it, beside it it blends back to the natural ground (cuttings through
//     hills, embankments across dips), under bridges it's kept well below them, and where a tunnel runs
//     deep under a hill it drops away beneath the tunnel (the tunnel's walls) with a separate roof mesh
//     at the ground's height over it (so it's open at the portals).
//
// Everything is in the chunk's own local frame (physics/geo.js LocalFrame at its centre: x east, y up,
// z south), and depends only on the map and the terrain lattice round it, so neighbouring chunks come
// out the same where they meet.

import { LocalFrame } from '../physics/geo.js';
import { CELL, OVERLAP, WORK_MARGIN, chunkAt, chunkSize, mPerDegLat, mPerDegLon } from './chunks.js';
import { roadInfo } from './osm.js';

export const SURFACE = {
  spacing: 4,              // m between road points
  camber: 0.02,            // crossfall from the crown to the edge (two-way roads)
  camberOneway: 0.015,
  skirt: 0.8, skirtDrop: 0.15,   // past its edge a road dips this much over this width, under the ground
  sink: 0.03,              // the terrain is kept this far under a road's surface
  flat: 1.0,               // m of ground at road level beside a road, before it blends back
  shoulderMin: 4, shoulderMax: 18, shoulderPerMetre: 1.5,   // m it takes to blend back (more where the road is far above / below)
  smoothLambda: 0.06,      // how firmly road heights hold to the terrain (lower: smoother)
  smoothIterations: 40,
  grade: 0.04,             // steepest ramp up to a bridge, or down into a tunnel
  rampMax: 0.12,           // ...unless it has to meet a street junction sooner
  rampEase: 12,            // m over which a ramp leaving a street junction steepens to that
  clearance: 5.6,          // m between two roads where one passes over the other
  tunnelDepth: 7,          // a tunnel runs at least this far under the ground where it can
  covered: 6,              // the ground over a tunnel is its roof where it's this far above the road
  slotDepth: 4,            // under a tunnel's roof the terrain drops this far below the road (its walls)
  slotMargin: 1.2,         // m either side of a tunnel's road that's still inside the tunnel
  underBridge: 3,          // the ground under a bridge is kept this far below it
  parapet: 0.9,            // m: bridge walls
  abutment: 20,            // m at each end of a bridge without walls (where it meets the road)
  minHalfWidth: 2.2,       // m: a road shares the gap with another beside it, but keeps at least this
  conformReach: 10,        // m past a major road's edge that a minor road still follows its surface
  conformLength: 70,       // m along a minor road from a junction that it's shaped by it
  freeReach: 1500,         // m past the work area that bridges and tunnels are kept whole
};
const R_CURVE = 6371000, RAD = Math.PI / 180;
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- a small binary heap ----------
class Heap {
  constructor(before) { this.a = []; this.before = before; }
  get size() { return this.a.length; }
  push(k, v) {
    const a = this.a; a.push([k, v]);
    for (let i = a.length - 1; i > 0;) { const p = (i - 1) >> 1; if (!this.before(a[i][0], a[p][0])) break; [a[i], a[p]] = [a[p], a[i]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && this.before(a[l][0], a[m][0])) m = l;
        if (r < a.length && this.before(a[r][0], a[m][0])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }
}

// Build a chunk's collision.
//   chunk: from chunks.js; terrain(lat, lon) → metres above the ellipsoid (chunks.js latticeSampler);
//   roads: readOverpass(...).roads for the chunk's area and its margin; options: overrides of SURFACE
// Returns { frame: { lat, lon, height } (degrees, m), heightfield: { n, size, heights (Float32Array,
// column-major, columns east, rows south) }, meshes: { roads, walls, cover: { vertices, indices,
// surfaces? } }, surfaces (names by code), stats }
//
// options.projection: build a square of a flat frame instead (the baked world, world/projection.js):
// { size (m), toXZ(lat, lon), toLatLon(x, z) — both relative to the square's middle — and heights as
// they are (no curve) }. The chunk then needs only its { key, latC, lonC }.
export function buildChunk({ chunk, terrain, roads, options = {} }) {
  const O = { ...SURFACE, ...options }, t0 = now(), PJ = options.projection;
  const cell = options.cell ?? CELL, overlap = options.overlap ?? OVERLAP, workMargin = options.workMargin ?? WORK_MARGIN;
  const { latC, lonC } = chunk, { width, height } = PJ ? { width: PJ.size, height: PJ.size } : chunkSize(chunk);
  const S = Math.ceil((Math.max(width, height) + 2 * overlap) / cell) * cell, n = Math.round(S / cell), half = S / 2, work = half + workMargin;
  const h0 = PJ ? 0 : Math.round(terrain(latC, lonC) * 10) / 10;
  const frame = PJ ? null : new LocalFrame(latC * RAD, lonC * RAD, h0), mLatC = mPerDegLat(latC), tanC = Math.tan(latC * RAD);

  // ---- local frame ↔ map ----
  const toXZ = PJ ? PJ.toXZ : (lat, lon) => { const p = frame.geodeticToLocal(lat * RAD, lon * RAD, h0); return [p[0], p[2]]; };
  const toLatLon = PJ ? PJ.toLatLon : (x, z) => { const lat = latC + (-z - x * x * tanC / (2 * R_CURVE)) / mLatC; return [lat, lonC + x / mPerDegLon(lat)]; };
  const localY = PJ ? h => h : (h, x, z) => h - h0 - (x * x + z * z) / (2 * R_CURVE);     // (the ground curves away from the tangent plane)
  // (far out along a bridge or tunnel there may be no terrain: NaN)
  const terrainAt = (lat, lon) => { try { return terrain(lat, lon); } catch { return NaN; } };
  const groundAt = (x, z) => { const [la, lo] = toLatLon(x, z); return localY(terrainAt(la, lo), x, z); };
  const mine = PJ ? (x, z) => x >= -half && x < half && z >= -half && z < half : (x, z) => { const [la, lo] = toLatLon(x, z); return chunkAt(la, lo).key === chunk.key; };

  // ---------- 1. the road network ----------
  const V = { x: [], z: [], T: [], ways: [], adj: [] };      // points: position, terrain height, ways through it, neighbours [id, length, way]
  const nodeVertex = new Map();
  const vertex = (x, z, T) => { const id = V.x.length; V.x.push(x); V.z.push(z); V.T.push(T); V.ways.push([]); V.adj.push([]); return id; };
  const ways = [];                                             // { id, info, verts, s (arc length at each) }
  const surfaceCodes = [], surfaceCode = name => { let k = surfaceCodes.indexOf(name); if (k < 0) { k = surfaceCodes.length; surfaceCodes.push(name); } return k; };

  // clip each road to the work area (a road leaving it ends at its edge, at a point of its own).
  // Bridges and tunnels are kept whole much further out: their heights run from end to end, so every
  // chunk they pass through has to see all of them to agree on them
  const runs = [];
  for (const r of roads) {
    const info = roadInfo(r.tags), m = r.lat.length, xs = new Float64Array(m), zs = new Float64Array(m);
    const L = info.kind === 'ground' ? work + 60 : work + O.freeReach;
    for (let i = 0; i < m; i++) [xs[i], zs[i]] = toXZ(r.lat[i], r.lon[i]);
    let cur = null;
    const point = (i, t, end) => t === 0 ? [r.nodes[i], r.lat[i], r.lon[i], xs[i], zs[i]] : t === 1 ? [r.nodes[i + 1], r.lat[i + 1], r.lon[i + 1], xs[i + 1], zs[i + 1]]
      : [`${r.id}:${i}:${end}`, r.lat[i] + (r.lat[i + 1] - r.lat[i]) * t, r.lon[i] + (r.lon[i + 1] - r.lon[i]) * t, xs[i] + (xs[i + 1] - xs[i]) * t, zs[i] + (zs[i + 1] - zs[i]) * t];
    const finish = () => { if (cur && cur.length > 1) runs.push({ id: r.id, info, nodes: cur.map(p => p[0]), lat: Float64Array.from(cur, p => p[1]), lon: Float64Array.from(cur, p => p[2]), x: Float64Array.from(cur, p => p[3]), z: Float64Array.from(cur, p => p[4]) }); cur = null; };
    for (let i = 0; i + 1 < m; i++) {
      const seg = clipSegment(xs[i], zs[i], xs[i + 1], zs[i + 1], L);
      if (!seg) { finish(); continue; }
      if (!cur) cur = [point(i, seg[0], 'a')];
      cur.push(point(i, seg[1], 'b'));
      if (seg[1] < 1) finish();
    }
    finish();
  }

  // points every O.spacing metres or so along each road: every map node (shared where roads meet),
  // and each stretch between two nodes split evenly (by itself, so every chunk puts the same points in
  // the same places)
  for (const run of runs) {
    const m = run.nodes.length;
    const nodeV = i => {
      const id = run.nodes[i];
      let v = nodeVertex.get(id);
      if (v === undefined) { v = vertex(run.x[i], run.z[i], localY(terrainAt(run.lat[i], run.lon[i]), run.x[i], run.z[i])); nodeVertex.set(id, v); }
      return v;
    };
    const verts = [nodeV(0)];
    for (let i = 0; i + 1 < m; i++) {
      const parts = Math.max(1, Math.round(Math.hypot(run.x[i + 1] - run.x[i], run.z[i + 1] - run.z[i]) / O.spacing));
      for (let p = 1; p < parts; p++) {
        const t = p / parts, x = run.x[i] + (run.x[i + 1] - run.x[i]) * t, z = run.z[i] + (run.z[i + 1] - run.z[i]) * t;
        verts.push(vertex(x, z, groundAt(x, z)));
      }
      verts.push(nodeV(i + 1));
    }
    const wi = ways.length, s = [0];
    for (let i = 1; i < verts.length; i++) {
      const a = verts[i - 1], b = verts[i], len = Math.hypot(V.x[b] - V.x[a], V.z[b] - V.z[a]);
      s.push(s[i - 1] + len);
      if (len < 1e-6) continue;
      V.adj[a].push([b, len, wi]); V.adj[b].push([a, len, wi]);
    }
    for (const v of verts) if (!V.ways[v].includes(wi)) V.ways[v].push(wi);
    ways.push({ id: run.id, info: run.info, verts, s, surface: surfaceCode(run.info.surface) });
  }
  const NV = V.x.length;
  const kindOf = v => V.ways[v].some(w => ways[w].info.kind === 'ground') ? 'ground' : ways[V.ways[v][0]]?.info.kind ?? 'ground';

  // ---------- junctions: which road is the major one ----------
  const junction = new Array(NV).fill(null);
  for (let v = 0; v < NV; v++) {
    const adj = V.adj[v];
    if (adj.length < 3 || new Set(adj.map(a => a[2])).size < 2) continue;
    const arms = adj.map(([u, len, w]) => ({ u, w, info: ways[w].info, dx: (V.x[u] - V.x[v]) / len, dz: (V.z[u] - V.z[v]) / len }));
    const top = Math.max(...arms.map(a => a.info.rank)), best = arms.filter(a => a.info.rank === top);
    let major = null, straightest = -0.85;
    for (let i = 0; i < best.length; i++) for (let j = i + 1; j < best.length; j++) {
      const d = best[i].dx * best[j].dx + best[i].dz * best[j].dz;
      if (d < straightest) { straightest = d; major = [best[i], best[j]]; }
    }
    if (!major) major = [best.sort((a, b) => b.info.width - a.info.width || ways[a.w].id - ways[b.w].id)[0]];
    junction[v] = { major, minor: arms.filter(a => !major.includes(a)), majorWays: new Set(major.map(a => a.w)) };
  }

  // ---------- 2. heights along the roads ----------
  const h = new Float64Array(NV), anchored = new Uint8Array(NV), depthIn = new Float64Array(NV);   // (depthIn: m from the nearest end of a bridge / tunnel)
  for (let v = 0; v < NV; v++) if (kindOf(v) === 'ground') { anchored[v] = 1; h[v] = V.T[v]; }
  // bridges and tunnels: from the heights where they meet the ground, by how far along they are
  const seen = new Uint8Array(NV);
  for (let v0 = 0; v0 < NV; v0++) {
    if (anchored[v0] || seen[v0]) continue;
    const comp = [], anchors = new Set(), queue = [v0];
    seen[v0] = 1;
    while (queue.length) {
      const v = queue.pop(); comp.push(v);
      for (const [u] of V.adj[v]) { if (anchored[u]) anchors.add(u); else if (!seen[u]) { seen[u] = 1; queue.push(u); } }
    }
    // (an end that leads nowhere in the map data here rests on the ground there)
    for (const v of comp) if (V.adj[v].length === 1 && Number.isFinite(V.T[v])) anchors.add(v);
    for (const a of [...anchors]) if (!Number.isFinite(V.T[a])) anchors.delete(a);
    if (!anchors.size) { for (const v of comp) { h[v] = Number.isFinite(V.T[v]) ? V.T[v] : 0; depthIn[v] = Infinity; } continue; }
    const inComp = new Set(comp), num = new Float64Array(comp.length), den = new Float64Array(comp.length), index = new Map(comp.map((v, i) => [v, i]));
    for (const v of comp) depthIn[v] = Infinity;
    for (const a of anchors) {
      const dist = dijkstra(V, [a], 1e9, u => inComp.has(u) || u === a);
      for (const [v, d] of dist) { const i = index.get(v); if (i === undefined) continue; if (d > 0) { num[i] += V.T[a] / d; den[i] += 1 / d; } if (d < depthIn[v]) depthIn[v] = d; }
    }
    for (let i = 0; i < comp.length; i++) { const v = comp[i]; h[v] = anchors.has(v) ? V.T[v] : den[i] ? num[i] / den[i] : Number.isFinite(V.T[v]) ? V.T[v] : 0; }
  }
  // smoothing along the roads (at a junction only along the major road)
  const neighbours = v => junction[v] ? junction[v].major.map(a => a.u) : V.adj[v].map(a => a[0]);
  const smooth = (iterations, lambda, fixed = null) => {
    const next = new Float64Array(NV);
    for (let it = 0; it < iterations; it++) {
      for (let v = 0; v < NV; v++) {
        // (with the point itself in the average: without it, a zigzag from one point to the next
        // flips each round instead of fading)
        const nb = neighbours(v), l = anchored[v] && !(fixed && fixed[v]) ? lambda : 0;
        let sum = l * V.T[v] + h[v], w = l + 1;
        for (const u of nb) { sum += h[u]; w += 1; }
        next[v] = sum / w;
      }
      h.set(next);
      if (fixed) clampAll();
    }
  };
  const LB = new Float64Array(NV).fill(-Infinity), UB = new Float64Array(NV).fill(Infinity);
  const clampAll = () => { for (let v = 0; v < NV; v++) { if (h[v] > UB[v]) h[v] = UB[v]; if (h[v] < LB[v]) h[v] = LB[v]; } };
  smooth(O.smoothIterations, O.smoothLambda);

  // where roads on different layers cross, the one above ground rises to clear the one under it and
  // the one below ground sinks to pass under the one over it (a road at ground level stays there),
  // with ramps either side no steeper than the grade. Layer by layer, working up from the ground (and
  // down from it), so each clears the one it crosses as that one ends up; deep inside long tunnels,
  // they also keep under the ground.
  const edges = new SegmentGrid(16);
  for (let w = 0; w < ways.length; w++) { const vs = ways[w].verts; for (let i = 1; i < vs.length; i++) edges.add(w, i, V.x[vs[i - 1]], V.z[vs[i - 1]], V.x[vs[i]], V.z[vs[i]], ways[w].info.halfWidth); }
  const camberOf = info => info.oneway ? O.camberOneway : O.camber;
  const surfaceOnWay = (w, i, t, d) => { const vs = ways[w].verts, info = ways[w].info; return h[vs[i - 1]] + (h[vs[i]] - h[vs[i - 1]]) * t - camberOf(info) * Math.min(d, info.halfWidth); };
  // a bridge that humps over several roads stays up between them (a tunnel under several stays down),
  // easing by at most 1% between them, and only coming back to the ground as fast as the ramps allow
  const fillBetween = (layer) => {
    const sign = layer > 0 ? 1 : -1, mine = new Uint8Array(NV);
    for (let v = 0; v < NV; v++) if (!anchored[v] && V.ways[v].some(w => ways[w].info.layer === layer && ways[w].info.kind !== 'ground')) mine[v] = 1;
    if (!mine.some(Boolean)) return;
    const F = new Float64Array(NV).fill(sign > 0 ? -Infinity : Infinity), A = new Float64Array(NV).fill(sign > 0 ? Infinity : -Infinity);
    for (let v = 0; v < NV; v++) { if (mine[v]) F[v] = h[v]; else if (anchored[v]) A[v] = h[v]; }
    spreadBound(V, F, 0.01, sign, u => mine[u]);
    spreadBound(V, A, O.grade, -sign, u => mine[u] || anchored[u]);
    let changed = false;
    for (let v = 0; v < NV; v++) {
      if (!mine[v]) continue;
      const fill = sign > 0 ? Math.min(F[v], A[v]) : Math.max(F[v], A[v]);
      if (sign > 0 ? fill > h[v] : fill < h[v]) { h[v] = fill; changed = true; }
    }
    if (changed) smooth(8, O.smoothLambda, mine);
  };
  // Street junctions at ground level are pinned: a ramp being lifted (or sunk) doesn't carry the
  // streets it joins with it, it steepens (up to O.rampMax) to meet them
  const pinned = new Uint8Array(NV);
  for (let v = 0; v < NV; v++) if (anchored[v] && V.adj[v].length >= 3 && new Set(V.adj[v].filter(a => ways[a[2]].info.kind === 'ground').map(a => a[2])).size >= 2) pinned[v] = 1;
  // (how high / low a road can get this far from its nearest pinned junction: the grade growing
  // from nothing to O.rampMax over the first O.rampEase metres, like a real vertical curve)
  const reachUp = new Float64Array(NV).fill(Infinity), reachDown = new Float64Array(NV).fill(-Infinity);
  const pins = []; for (let v = 0; v < NV; v++) if (pinned[v]) pins.push(v);
  const { dist: pinDist, from: pinFrom } = nearestSource(V, pins, 400);
  for (const [v, d] of pinDist) {
    const rise = d < O.rampEase ? O.rampMax * d * d / (2 * O.rampEase) : O.rampMax * (d - O.rampEase / 2);
    reachUp[v] = h[pinFrom.get(v)] + rise; reachDown[v] = h[pinFrom.get(v)] - rise;
  }
  const layers = [...new Set(ways.map(w => w.info.layer))];
  const layerOrder = [...layers.filter(l => l > 0).sort((a, b) => a - b), ...layers.filter(l => l < 0).sort((a, b) => b - a)];
  const direction = (w, i) => { const vs = ways[w].verts, a = vs[Math.max(0, i - 1)], b = vs[Math.min(vs.length - 1, i === 0 ? 1 : i)], dx = V.x[b] - V.x[a], dz = V.z[b] - V.z[a], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
  for (const layer of layerOrder) {
    const up = layer > 0, B = new Float64Array(NV).fill(up ? -Infinity : Infinity);
    let any = false;
    for (let w = 0; w < ways.length; w++) {
      if (ways[w].info.layer !== layer) continue;
      ways[w].verts.forEach((v, iv) => {
        if (!up && ways[w].info.kind === 'tunnel' && depthIn[v] > 120 && V.T[v] - O.tunnelDepth < B[v]) { B[v] = V.T[v] - O.tunnelDepth; any = true; }
        const hits = edges.near(V.x[v], V.z[v], 0.5).filter(e => up ? ways[e.w].info.layer < layer : ways[e.w].info.layer > layer);
        if (!hits.length) return;
        // (roads joined right here aren't crossing; nor is a ramp peeling off the road it joins just
        // along: a road it's joined to further on, but crosses at an angle, is)
        const joined = connectedWays(V, v, 25), nearby = connectedWays(V, v, 150), [ux, uz] = direction(w, iv);
        for (const e of hits) {
          const [ex, ez] = direction(e.w, e.i), angle = Math.acos(Math.min(1, Math.abs(ux * ex + uz * ez)));
          const skip = joined.has(e.w) || (nearby.has(e.w) && angle < 0.45);
          if (options.trace?.(ways[w], ways[e.w], skip, V.x[v], V.z[v]) || skip) continue;
          const sf = surfaceOnWay(e.w, e.i, e.t, e.d);
          B[v] = up ? Math.max(B[v], sf + O.clearance) : Math.min(B[v], sf - O.clearance);
          any = true;
        }
      });
    }
    if (!any) continue;
    spreadBound(V, B, O.grade, up ? 1 : -1, u => !pinned[u]);
    for (let v = 0; v < NV; v++) B[v] = up ? Math.min(B[v], reachUp[v]) : Math.max(B[v], reachDown[v]);
    roundBound(V, B, 30);
    for (let v = 0; v < NV; v++) { if (up) LB[v] = Math.max(LB[v], B[v]); else UB[v] = Math.min(UB[v], B[v]); }
    const constrained = new Uint8Array(NV);
    for (let v = 0; v < NV; v++) if (LB[v] > h[v] - 0.5 || UB[v] < h[v] + 0.5) constrained[v] = 1;
    clampAll();
    smooth(12, O.smoothLambda, constrained);
    fillBetween(layer);
  }
  const profileTime = now();

  // ---------- 3. ribbons ----------
  // each road's cross-section at each of its points: skirt, edge, crown, edge, skirt (x, y, z each)
  const sections = ways.map((way, w) => {
    const vs = way.verts, m = vs.length, info = way.info, hw = info.halfWidth, c = camberOf(info), P = new Float64Array(m * 15);
    let joined = null;
    for (let i = 0; i < m; i++) {
      const v = vs[i];
      // direction along the road here (through a plain joint with the next road, if that's all it is)
      let ax, az, bx, bz;
      const prev = i > 0 ? vs[i - 1] : continuation(V, v, vs[1]), next = i < m - 1 ? vs[i + 1] : continuation(V, v, vs[m - 2]);
      if (prev !== null) { ax = V.x[v] - V.x[prev]; az = V.z[v] - V.z[prev]; } else { ax = V.x[next] - V.x[v]; az = V.z[next] - V.z[v]; }
      if (next !== null) { bx = V.x[next] - V.x[v]; bz = V.z[next] - V.z[v]; } else { bx = ax; bz = az; }
      const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
      let tx = ax / la + bx / lb, tz = az / la + bz / lb; const lt = Math.hypot(tx, tz) || 1; tx /= lt; tz /= lt;
      // (the edges keep their distance from both pieces of road either side of a bend)
      const nx = tz, nz = -tx, miter = Math.min(2.5, 1 / Math.max(0.4, tx * ax / la + tz * az / la));
      // how far out each side goes: its half width, unless another road (not joined to it) runs
      // alongside at a different height, when the two share the gap between them (by their widths)
      const ext = [hw, hw];
      for (const e of edges.near(V.x[v], V.z[v], hw + O.skirt)) {
        if (e.w === w) continue;
        const other = ways[e.w].info, vs2 = ways[e.w].verts, hOther = h[vs2[e.i - 1]] + (h[vs2[e.i]] - h[vs2[e.i - 1]]) * e.t;
        if (Math.abs(hOther - h[v]) < 0.25 || e.d < 0.5) continue;
        const ox = V.x[vs2[e.i]] - V.x[vs2[e.i - 1]], oz = V.z[vs2[e.i]] - V.z[vs2[e.i - 1]];
        if (Math.abs(ox * tx + oz * tz) < 0.87 * Math.hypot(ox, oz)) continue;        // (alongside, not crossing)
        const qx = V.x[vs2[e.i - 1]] + ox * e.t, qz = V.z[vs2[e.i - 1]] + oz * e.t;
        const side = (qx - V.x[v]) * nx + (qz - V.z[v]) * nz > 0 ? 1 : 0;      // (0: the −n side, 1: the +n side)
        const limit = Math.max(O.minHalfWidth, e.d * hw / (hw + other.halfWidth));
        if (limit >= ext[side]) continue;
        if ((joined ??= connectedWays(V, v, 40)).has(e.w)) continue;
        ext[side] = limit;
      }
      joined = null;
      const [eL, eR] = ext, skL = eL < hw ? 0.3 : O.skirt, skR = eR < hw ? 0.3 : O.skirt;
      const offsets = [-(eL + skL), -eL, 0, eR, eR + skR], ys = [h[v] - c * eL - O.skirtDrop, h[v] - c * eL, h[v], h[v] - c * eR, h[v] - c * eR - O.skirtDrop];
      for (let k = 0; k < 5; k++) { const o = offsets[k] * (k === 2 ? 0 : miter); P[i * 15 + k * 3] = V.x[v] + nx * o; P[i * 15 + k * 3 + 1] = ys[k]; P[i * 15 + k * 3 + 2] = V.z[v] + nz * o; }
    }
    return P;
  });
  // minor roads take the major road's surface where they meet it, fading back to their own
  for (let v = 0; v < NV; v++) {
    const J = junction[v];
    if (!J) continue;
    const segs = [];
    for (const a of J.major) {
      const pts = [{ v, s: 0 }, ...walk(ways, V, a.w, v, a.u, O.conformLength + 30)];
      for (let i = 1; i < pts.length; i++) segs.push({ a: pts[i - 1].v, b: pts[i].v, info: ways[a.w].info });
    }
    const majorSurface = (x, z) => {
      let best = null;
      for (const sg of segs) {
        const ax = V.x[sg.a], az = V.z[sg.a], dx = V.x[sg.b] - ax, dz = V.z[sg.b] - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(x - ax - dx * t, z - az - dz * t);
        if (!best || d < best.d) best = { d, y: h[sg.a] + (h[sg.b] - h[sg.a]) * t - camberOf(sg.info) * Math.min(d, sg.info.halfWidth), hw: sg.info.halfWidth };
      }
      return best;
    };
    for (const arm of J.minor) {
      if (J.majorWays.has(arm.w)) continue;
      const way = ways[arm.w], P = sections[arm.w], m = way.verts.length, idx = way.verts.indexOf(v), step = way.verts[idx + 1] === arm.u ? 1 : -1;
      for (let i = idx, s = 0; ;) {
        const fade = 1 - smoothstep(0.5 * O.conformLength, O.conformLength, s);
        for (let k = 0; k < 5; k++) {
          const o = i * 15 + k * 3, ms = majorSurface(P[o], P[o + 2]);
          if (!ms) continue;
          const w = (1 - smoothstep(ms.hw, ms.hw + O.conformReach, ms.d)) * fade, target = ms.y - (k === 0 || k === 4 ? O.skirtDrop : 0);
          P[o + 1] += (target - P[o + 1]) * w;
        }
        const j = i + step;
        if (j < 0 || j >= m) break;
        s += Math.abs(way.s[j] - way.s[i]); i = j;
        if (s > O.conformLength) break;
      }
    }
  }

  // the ribbons as triangles, and a grid of their pieces (for the terrain and the bridge walls)
  const roadMesh = new MeshBuilder(), wallMesh = new MeshBuilder(), coverMesh = new MeshBuilder();
  const pieces = new PieceGrid(16);
  const covered = ways.map((way, w) => way.info.kind !== 'tunnel' ? null : way.verts.map((v, i) => {
    const P = sections[w], o = i * 15 + 6;
    return groundAt(P[o], P[o + 2]) - P[o + 1] >= O.covered;
  }));
  for (let w = 0; w < ways.length; w++) {
    const P = sections[w], m = ways[w].verts.length, kind = ways[w].info.kind;
    for (let i = 0; i + 1 < m; i++) {
      const a = i * 15, b = (i + 1) * 15;
      const role = kind === 'bridge' ? 'bridge' : kind === 'tunnel' && covered[w][i] && covered[w][i + 1] ? 'tunnel' : 'ground';
      pieces.add({ w, i, P, a, b, role });
      const cx = (P[a + 6] + P[b + 6]) / 2, cz = (P[a + 8] + P[b + 8]) / 2;
      if (!mine(cx, cz)) continue;
      for (let k = 0; k < 4; k++) roadMesh.quad(P, a + k * 3, a + (k + 1) * 3, b + (k + 1) * 3, b + k * 3, ways[w].surface);
    }
  }
  // bridge walls, except at the ends and where another road runs alongside at the same height
  for (let w = 0; w < ways.length; w++) {
    const way = ways[w];
    if (way.info.kind !== 'bridge') continue;
    const P = sections[w], m = way.verts.length, L = way.s[m - 1];
    const endIsAbutment = v => V.ways[v].some(x => ways[x].info.kind !== 'bridge');
    const fromStart = endIsAbutment(way.verts[0]) ? O.abutment : 0, fromEnd = endIsAbutment(way.verts[m - 1]) ? O.abutment : 0;
    for (let i = 0; i + 1 < m; i++) {
      if (way.s[i] < fromStart || L - way.s[i + 1] < fromEnd) continue;
      const a = i * 15, b = (i + 1) * 15;
      if (!mine((P[a + 6] + P[b + 6]) / 2, (P[a + 8] + P[b + 8]) / 2)) continue;
      for (const [edge, skirt] of [[1, 0], [3, 4]]) {
        const ex = (P[a + edge * 3] + P[b + edge * 3]) / 2, ez = (P[a + edge * 3 + 2] + P[b + edge * 3 + 2]) / 2, ey = (P[a + edge * 3 + 1] + P[b + edge * 3 + 1]) / 2;
        const ox = (P[a + skirt * 3] + P[b + skirt * 3]) / 2 - ex, oz = (P[a + skirt * 3 + 2] + P[b + skirt * 3 + 2]) / 2 - ez, ol = Math.hypot(ox, oz) || 1;
        const qx = ex + ox / ol * 1.4, qz = ez + oz / ol * 1.4;
        if (pieces.surfacesAt(qx, qz, p => p.w !== w).some(y => Math.abs(y - ey) < 2)) continue;
        const pa = [P[a + edge * 3] + ox / ol * 0.25, P[a + edge * 3 + 1], P[a + edge * 3 + 2] + oz / ol * 0.25], pb = [P[b + edge * 3] + ox / ol * 0.25, P[b + edge * 3 + 1], P[b + edge * 3 + 2] + oz / ol * 0.25];
        wallMesh.quadPoints([pa[0], pa[1] - 0.3, pa[2]], [pb[0], pb[1] - 0.3, pb[2]], [pb[0], pb[1] + O.parapet, pb[2]], [pa[0], pa[1] + O.parapet, pa[2]]);
      }
    }
  }
  const ribbonTime = now();

  // ---------- 4. the terrain ----------
  const N1 = n + 1, count = N1 * N1;
  const nat = new Float64Array(count), acc = new Float64Array(count), accW = new Float64Array(count), maxW = new Float64Array(count);
  const inside = new Float64Array(count).fill(Infinity), underBridge = new Float64Array(count).fill(Infinity), slot = new Float64Array(count).fill(Infinity);
  const X = c => -half + c * cell, idx = (c, r) => r + c * N1;
  for (let c = 0; c <= n; c++) for (let r = 0; r <= n; r++) nat[idx(c, r)] = groundAt(X(c), X(r));
  const reach = O.flat + O.shoulderMax + O.skirt;
  // (covered tunnels first: the open cutting at a tunnel's mouth doesn't reach into the covered part)
  const order = [...pieces.all].sort((p, q) => (q.role === 'tunnel') - (p.role === 'tunnel'));
  for (const p of order) {
    const fromTunnel = ways[p.w].info.kind === 'tunnel';
    const P = p.P, a = p.a, b = p.b;
    // the road surface between its edges: [L_a, C_a, R_a, R_b, C_b, L_b]
    const L0 = a + 3, C0 = a + 6, R0 = a + 9, L1 = b + 3, C1 = b + 6, R1 = b + 9;
    const grow = p.role === 'ground' ? reach : p.role === 'tunnel' ? O.slotMargin : 1;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const o of [L0, R0, L1, R1]) { x0 = Math.min(x0, P[o]); x1 = Math.max(x1, P[o]); z0 = Math.min(z0, P[o + 2]); z1 = Math.max(z1, P[o + 2]); }
    const c0 = Math.max(0, Math.floor((x0 - grow + half) / cell)), c1 = Math.min(n, Math.ceil((x1 + grow + half) / cell));
    const r0 = Math.max(0, Math.floor((z0 - grow + half) / cell)), r1 = Math.min(n, Math.ceil((z1 + grow + half) / cell));
    for (let c = c0; c <= c1; c++) {
      const x = X(c);
      for (let r = r0; r <= r1; r++) {
        const z = X(r), k = idx(c, r);
        const y = surfaceIn(P, L0, C0, R0, L1, C1, R1, x, z);
        if (p.role !== 'ground') {
          // under a bridge (and just beside it): the ground's kept well below; round a tunnel: its slot
          let yy = y;
          if (yy === null) { const ed = edgeDistance(P, L0, R0, L1, R1, x, z); if (ed.e <= grow) yy = ed.y; }
          if (yy === null) continue;
          if (p.role === 'bridge') underBridge[k] = Math.min(underBridge[k], yy - O.underBridge);
          else slot[k] = Math.min(slot[k], yy);
          continue;
        }
        if (fromTunnel && slot[k] < Infinity) continue;
        if (y !== null) { inside[k] = Math.min(inside[k], y - O.sink); maxW[k] = 1; acc[k] += y - O.sink; accW[k] += 1; continue; }
        const { e, y: ye } = edgeDistance(P, L0, R0, L1, R1, x, z);
        const shoulder = Math.min(O.shoulderMax, Math.max(O.shoulderMin, O.shoulderPerMetre * Math.abs(nat[k] - ye)));
        const wgt = e <= O.flat ? 1 : 1 - smoothstep(O.flat, O.flat + shoulder, e);
        if (wgt <= 0) continue;
        const w4 = wgt ** 4;
        acc[k] += w4 * (ye - O.sink); accW[k] += w4; if (wgt > maxW[k]) maxW[k] = wgt;
      }
    }
  }
  const heights = new Float32Array(count), isSlot = new Uint8Array(count), roof = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    let y = Math.min(nat[k], underBridge[k]);
    if (accW[k] > 0) y += (acc[k] / accW[k] - y) * maxW[k];
    if (inside[k] < y) y = inside[k];
    if (slot[k] < Infinity) {
      if (nat[k] - slot[k] >= O.covered) { roof[k] = y; isSlot[k] = 1; y = slot[k] - O.slotDepth; }
      else y = Math.min(y, slot[k] - O.sink);
    }
    heights[k] = y;
  }
  // the roof over covered tunnels: the ground's surface over the slot, open where the ground beside
  // it is low (the portals)
  for (let c = 0; c < n; c++) for (let r = 0; r < n; r++) {
    const ks = [idx(c, r), idx(c + 1, r), idx(c + 1, r + 1), idx(c, r + 1)];
    if (!ks.some(k => isSlot[k])) continue;
    const tunnelY = Math.min(...ks.filter(k => isSlot[k]).map(k => slot[k]));
    if (!ks.every(k => isSlot[k] || heights[k] >= tunnelY + O.covered - 1)) continue;
    const pts = ks.map((k, j) => [X(j === 1 || j === 2 ? c + 1 : c), isSlot[k] ? roof[k] : heights[k], X(j >= 2 ? r + 1 : r)]);
    coverMesh.quadPoints(...pts);
  }
  const terrainTime = now();

  const tris = roadMesh.triangles + wallMesh.triangles + coverMesh.triangles;
  return {
    key: chunk.key,
    frame: { lat: latC, lon: lonC, height: h0 },
    heightfield: { n, size: S, heights },
    meshes: { roads: roadMesh.build(true), walls: wallMesh.build(), cover: coverMesh.build() },
    surfaces: surfaceCodes,
    stats: { roads: ways.length, points: NV, triangles: tris, bridges: ways.filter(w => w.info.kind === 'bridge').length, tunnels: ways.filter(w => w.info.kind === 'tunnel').length,
      ms: { profile: Math.round(profileTime - t0), ribbons: Math.round(ribbonTime - profileTime), terrain: Math.round(terrainTime - ribbonTime) } },
    // (for the tests and the debug view: every road's points and heights, in the local frame)
    debug: options.debug ? { ways: ways.map(w => ({ id: w.id, info: w.info, points: w.verts.map(v => [V.x[v], h[v], V.z[v]]), terrain: w.verts.map(v => V.T[v]), bounds: w.verts.map(v => [LB[v], UB[v]]) })), groundAt } : undefined,
    // (the baked world: each road as it was laid — its points, heights, cross-sections — and the ground
    // as it was before the roads, for the railings, markings, labels and kerbs built along them)
    ways: options.keepWays ? ways.map((w, k) => ({ id: w.id, info: w.info, points: w.verts.map(v => [V.x[v], h[v], V.z[v]]), junctions: w.verts.map(v => V.adj[v].length >= 3 ? 1 : 0), sections: sections[k], natural: w.verts.map(v => V.T[v]), tunnel: covered[k] })) : undefined,
    groundAt: options.keepWays ? groundAt : undefined,
  };
}

const now = () => (globalThis.performance ?? Date).now();

// The part of a segment inside the square |x|, |z| ≤ r, as [t0, t1] along it (null: none) — Liang–Barsky
function clipSegment(x0, z0, x1, z1, r) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dz = z1 - z0;
  for (const [p, q] of [[-dx, x0 + r], [dx, r - x0], [-dz, z0 + r], [dz, r - z0]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return t1 - t0 > 1e-9 ? [t0, t1] : null;
}

// The neighbour of v that carries on from `from` when v is just a joint between two roads (null otherwise)
function continuation(V, v, from) {
  const adj = V.adj[v];
  if (adj.length !== 2) return null;
  return adj[0][0] === from ? adj[1][0] : adj[1][0] === from ? adj[0][0] : null;
}

// Points along a way from vertex v, starting towards u, up to `length` metres: [{ v, s }]
function walk(ways, V, w, v, u, length) {
  const vs = ways[w].verts, i0 = vs.indexOf(v);
  if (i0 < 0) return [];
  const step = vs[i0 + 1] === u ? 1 : -1, out = [];
  for (let i = i0 + step; i >= 0 && i < vs.length; i += step) {
    const s = Math.abs(ways[w].s[i] - ways[w].s[i0]);
    out.push({ v: vs[i], s });
    if (s > length) break;
  }
  return out;
}

// Shortest distances along the network from some points (up to maxDist), over points allowed(u)
function dijkstra(V, from, maxDist, allowed = () => true) {
  const dist = new Map(), heap = new Heap((a, b) => a < b);
  for (const v of from) { dist.set(v, 0); heap.push(0, v); }
  while (heap.size) {
    const [d, v] = heap.pop();
    if (d > dist.get(v)) continue;
    for (const [u, len] of V.adj[v]) {
      const nd = d + len;
      if (nd > maxDist || !allowed(u) || nd >= (dist.get(u) ?? Infinity)) continue;
      dist.set(u, nd); heap.push(nd, u);
    }
  }
  return dist;
}
// Distances along the network to the nearest of some points (up to maxDist), and which one it is
function nearestSource(V, sources, maxDist) {
  const dist = new Map(), from = new Map(), heap = new Heap((a, b) => a < b);
  for (const v of sources) { dist.set(v, 0); from.set(v, v); heap.push(0, v); }
  while (heap.size) {
    const [d, v] = heap.pop();
    if (d > dist.get(v)) continue;
    for (const [u, len] of V.adj[v]) {
      const nd = d + len;
      if (nd > maxDist || nd >= (dist.get(u) ?? Infinity)) continue;
      dist.set(u, nd); from.set(u, from.get(v)); heap.push(nd, u);
    }
  }
  return { dist, from };
}
// The ways reachable from v within `length` metres along the network
function connectedWays(V, v, length) {
  const out = new Set();
  for (const u of dijkstra(V, [v], length).keys()) for (const w of V.ways[u]) out.add(w);
  return out;
}

// A bound that must hold at some points (lower: sign +1, upper: −1) spread along the network, easing
// off by `grade` per metre: the ramps either side of a bridge or tunnel
function spreadBound(V, B, grade, sign, allowed = () => true) {
  const heap = new Heap(sign > 0 ? (a, b) => a > b : (a, b) => a < b);
  for (let v = 0; v < B.length; v++) if (Number.isFinite(B[v])) heap.push(B[v], v);
  while (heap.size) {
    const [b, v] = heap.pop();
    if (b !== B[v]) continue;
    for (const [u, len] of V.adj[v]) {
      if (!allowed(u)) continue;
      const nb = b - sign * grade * len;
      if (sign > 0 ? nb > B[u] : nb < B[u]) { B[u] = nb; heap.push(nb, u); }
    }
  }
}
// ...rounded off along the network, so a ramp starts and tops out gently (which takes a little off the
// top: the clearance allows for it)
function roundBound(V, B, iterations) {
  const next = Float64Array.from(B);
  for (let it = 0; it < iterations; it++) {
    for (let v = 0; v < B.length; v++) {
      if (!Number.isFinite(B[v])) continue;
      let sum = B[v], w = 1;
      for (const [u] of V.adj[v]) if (Number.isFinite(B[u])) { sum += B[u]; w++; }
      next[v] = sum / w;
    }
    B.set(next);
  }
}

// Height of a road piece's surface at (x, z) if it's inside it (between its edges), else null.
// Offsets into P: the left edge, crown and right edge at each end of the piece.
function surfaceIn(P, L0, C0, R0, L1, C1, R1, x, z) {
  return tri(P, L0, C0, C1, x, z) ?? tri(P, L0, C1, L1, x, z) ?? tri(P, C0, R0, R1, x, z) ?? tri(P, C0, R1, C1, x, z);
}
function tri(P, a, b, c, x, z) {
  const ax = P[a], az = P[a + 2], bx = P[b], bz = P[b + 2], cx = P[c], cz = P[c + 2];
  const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(d) < 1e-12) return null;
  const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2;
  if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) return null;
  return l1 * P[a + 1] + l2 * P[b + 1] + l3 * P[c + 1];
}
// Distance from (x, z) to a piece's nearer edge, and the edge's height there: { e, y }
function edgeDistance(P, L0, R0, L1, R1, x, z) {
  const one = (a, b) => {
    const ax = P[a], az = P[a + 2], dx = P[b] - ax, dz = P[b + 2] - az, l2 = dx * dx + dz * dz || 1e-12;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    return { e: Math.hypot(x - ax - dx * t, z - az - dz * t), y: P[a + 1] + (P[b + 1] - P[a + 1]) * t };
  };
  const l = one(L0, L1), r = one(R0, R1);
  return l.e < r.e ? l : r;
}

// Segments of the road network in a grid, for "which roads pass near here"
class SegmentGrid {
  constructor(cell) { this.cell = cell; this.map = new Map(); this.segs = []; }
  add(w, i, ax, az, bx, bz, hw) {
    const s = { w, i, ax, az, bx, bz, hw }, k = this.segs.push(s) - 1, c = this.cell, r = hw + 1;
    for (let gx = Math.floor((Math.min(ax, bx) - r) / c); gx <= Math.floor((Math.max(ax, bx) + r) / c); gx++)
      for (let gz = Math.floor((Math.min(az, bz) - r) / c); gz <= Math.floor((Math.max(az, bz) + r) / c); gz++) {
        const key = gx * 100003 + gz;
        let list = this.map.get(key);
        if (!list) this.map.set(key, list = []);
        list.push(k);
      }
  }
  // segments whose footprint (half width + extra) contains (x, z): [{ w, i, t, d }]
  near(x, z, extra) {
    const list = this.map.get(Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell)) ?? [], out = [];
    for (const k of list) {
      const s = this.segs[k], dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz || 1e-12;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2)), d = Math.hypot(x - s.ax - dx * t, z - s.az - dz * t);
      if (d <= s.hw + extra) out.push({ w: s.w, i: s.i, t, d });
    }
    return out;
  }
}
// Road pieces (between two cross-sections) in a grid, for "what road surface is here"
class PieceGrid {
  constructor(cell) { this.cell = cell; this.map = new Map(); this.all = []; }
  add(p) {
    const k = this.all.push(p) - 1, P = p.P, c = this.cell;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const o of [p.a + 3, p.a + 9, p.b + 3, p.b + 9]) { x0 = Math.min(x0, P[o]); x1 = Math.max(x1, P[o]); z0 = Math.min(z0, P[o + 2]); z1 = Math.max(z1, P[o + 2]); }
    for (let gx = Math.floor(x0 / c); gx <= Math.floor(x1 / c); gx++)
      for (let gz = Math.floor(z0 / c); gz <= Math.floor(z1 / c); gz++) {
        const key = gx * 100003 + gz;
        let list = this.map.get(key);
        if (!list) this.map.set(key, list = []);
        list.push(k);
      }
  }
  // heights of the road surfaces at (x, z), of the pieces passing the filter
  surfacesAt(x, z, filter = () => true) {
    const out = [];
    for (const k of this.map.get(Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell)) ?? []) {
      const p = this.all[k];
      if (!filter(p)) continue;
      const y = surfaceIn(p.P, p.a + 3, p.a + 6, p.a + 9, p.b + 3, p.b + 6, p.b + 9, x, z);
      if (y !== null) out.push(y);
    }
    return out;
  }
}

// Triangles collected into flat arrays (x, y, z per vertex; three indices per triangle)
class MeshBuilder {
  constructor() { this.v = []; this.i = []; this.s = []; }
  get triangles() { return this.i.length / 3; }
  quadPoints(a, b, c, d, surface = 0) {
    const base = this.v.length / 3;
    this.v.push(...a, ...b, ...c, ...d);
    this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.s.push(surface, surface);
  }
  quad(P, a, b, c, d, surface) { this.quadPoints([P[a], P[a + 1], P[a + 2]], [P[b], P[b + 1], P[b + 2]], [P[c], P[c + 1], P[c + 2]], [P[d], P[d + 1], P[d + 2]], surface); }
  build(withSurfaces = false) {
    const out = { vertices: Float32Array.from(this.v), indices: Uint32Array.from(this.i) };
    if (withSurfaces) out.surfaces = Uint8Array.from(this.s);
    return out;
  }
}
