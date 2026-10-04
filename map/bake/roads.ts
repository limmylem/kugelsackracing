// Map v3's roads: OpenStreetMap's drivable ways turned into the road graph, height profiles and the road
// surface — every original OSM node kept exactly where it is.
//
//  1. The graph: nodes where ways meet or end, segments between them (name, class, lanes, one way,
//     speed limit, width, bridge / tunnel / layer; lanes and width marked estimated when not tagged).
//  2. Curves: where the way bends gently between far-apart nodes, points added on a cubic (Hermite,
//     centripetal Catmull-Rom tangents) through the original nodes — never moving them. Sharp corners
//     (a turn of more than `corner`°) stay corners.
//  3. Heights: the elevation sampled along every way, spikes removed (a running median) and smoothed
//     (a Gaussian, `smooth` m) — driveable, still following real hills; every junction one height that all
//     its roads meet; bridges and tunnels running smoothly between the heights where they meet the ground.
//  4. The surface: a ribbon for each segment (crown and camber, edges skirted down under the ground),
//     cut back at junctions, and each junction one fan of triangles joining the cut ends — one joined
//     surface, no overlaps, no gaps, no steps. Line markings along the ribbons.
//
//   const R = buildRoads(osm.roads, elevation, cfg)
//   R.nodes, R.segs, R.mesh (world coordinates), R.markings, R.junctions (for the terrain)

import type { Way } from './osmData.ts';

export const DRIVABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'road', 'busway', 'track',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
// (rank: how major; lanes / lane width when not tagged)
const CLASS = {
  motorway: { rank: 9, lanes: 3, lane: 3.6, shoulder: 1.5 }, trunk: { rank: 8, lanes: 2, lane: 3.5, shoulder: 0.8 }, primary: { rank: 7, lanes: 2, lane: 3.4, shoulder: 0.4 },
  secondary: { rank: 6, lanes: 2, lane: 3.3, shoulder: 0.3 }, tertiary: { rank: 5, lanes: 2, lane: 3.2, shoulder: 0.2 }, unclassified: { rank: 4, lanes: 2, lane: 3.0, shoulder: 0 },
  residential: { rank: 4, lanes: 2, lane: 3.0, shoulder: 0 }, living_street: { rank: 3, lanes: 2, lane: 2.8, shoulder: 0 }, road: { rank: 4, lanes: 2, lane: 3.0, shoulder: 0 },
  busway: { rank: 3, lanes: 2, lane: 3.2, shoulder: 0 }, service: { rank: 2, lanes: 1, lane: 3.2, shoulder: 0 }, track: { rank: 1, lanes: 1, lane: 3.0, shoulder: 0 },
};
const LINK = { motorway_link: 'motorway', trunk_link: 'trunk', primary_link: 'primary', secondary_link: 'secondary', tertiary_link: 'tertiary' };

export interface RoadCfg {
  densify: number; corner: number; smooth: number; median: number; camber: number; skirt: number; skirtDrop: number; markingWidth: number;
  dash: number; gap: number; minJunctionCut: number;
  widthScale?: number; minWidth?: number; joinOnto?: number; joinPointing?: number;
}
export interface RNode { id: number; x: number; z: number; lat: number; lon: number; segs: number[]; h: number; junction: boolean; ground: boolean }
export interface Seg {
  id: number; way: number; osmWay: number; from: number; to: number;
  xs: number[]; zs: number[]; orig: boolean[]; osmNodes: (number | null)[]; lat: number[]; lon: number[];
  s: number[]; h: number[]; raw: number[]; smooth: number[];
  name: string | null; cls: string; link: boolean; rank: number; lanes: number; lanesEstimated: boolean; oneway: number; maxspeed: number | null;
  width: number; widthEstimated: boolean; structure: 'ground' | 'bridge' | 'tunnel'; layer: number; surface: string; cut: [number, number];
}
export interface Mesh { positions: number[]; colours: number[]; indices: number[]; surfaces: number[]; segOf: number[] }

const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const num = (v: string | undefined) => { const n = parseFloat(v ?? ''); return Number.isFinite(n) ? n : null; };
function speedKmh(v?: string) { if (!v) return null; const m = v.match(/^(\d+(?:\.\d+)?)\s*(mph)?/i); return m ? Math.round(+m[1] * (m[2] ? 1.609 : 1)) : null; }

// ---------- 1 & 2: the graph, with curves ----------
function densified(nodes: { x: number; z: number }[], cfg: RoadCfg) {
  const n = nodes.length, out: { x: number; z: number; orig: boolean; k: number }[] = [];
  // tangents (centripetal Catmull-Rom), none at sharp corners and the ends
  const dir = (a, b) => { const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
  const curve = new Array(n).fill(false), T = new Array(n).fill(null);
  for (let i = 1; i < n - 1; i++) {
    const a = dir(nodes[i - 1], nodes[i]), b = dir(nodes[i], nodes[i + 1]), turn = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]))) * 180 / Math.PI;
    if (turn < cfg.corner && turn > 0.5) {
      curve[i] = true;
      const d0 = Math.sqrt(Math.hypot(nodes[i].x - nodes[i - 1].x, nodes[i].z - nodes[i - 1].z)), d1 = Math.sqrt(Math.hypot(nodes[i + 1].x - nodes[i].x, nodes[i + 1].z - nodes[i].z));
      const tx = (nodes[i].x - nodes[i - 1].x) / d0 / (d0 + d1) * d1 + (nodes[i + 1].x - nodes[i].x) / d1 / (d0 + d1) * d0, tz = (nodes[i].z - nodes[i - 1].z) / d0 / (d0 + d1) * d1 + (nodes[i + 1].z - nodes[i].z) / d1 / (d0 + d1) * d0;
      const l = Math.hypot(tx, tz) || 1;
      T[i] = [tx / l, tz / l];
    }
  }
  for (let i = 0; i < n; i++) {
    out.push({ x: nodes[i].x, z: nodes[i].z, orig: true, k: i });
    if (i === n - 1) break;
    const a = nodes[i], b = nodes[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L <= cfg.densify || (!curve[i] && !curve[i + 1])) continue;
    // a cubic through a and b, tangent to the way at curved nodes, along the chord at corners and ends
    const c = [(b.x - a.x) / L, (b.z - a.z) / L], ta = T[i] ?? c, tb = T[i + 1] ?? c, m = Math.ceil(L / cfg.densify);
    for (let q = 1; q < m; q++) {
      const t = q / m, h00 = 2 * t ** 3 - 3 * t * t + 1, h10 = t ** 3 - 2 * t * t + t, h01 = -2 * t ** 3 + 3 * t * t, h11 = t ** 3 - t * t;
      out.push({ x: h00 * a.x + h10 * L * ta[0] + h01 * b.x + h11 * L * tb[0], z: h00 * a.z + h10 * L * ta[1] + h01 * b.z + h11 * L * tb[1], orig: false, k: i });
    }
  }
  return out;
}

// a way's lanes and width: OSM's when tagged (lanes, width), else its class's (marked estimated); then
// the game's widening (cfg.widthScale, at least cfg.minWidth: easier to stay on — the centre line stays
// exactly OpenStreetMap's)
function sizeOf(t: Record<string, string>, cfg: RoadCfg) {
  const base = LINK[t.highway] ?? t.highway, C = CLASS[base] ?? CLASS.road;
  const oneway = t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout' || (base === 'motorway' && t.oneway !== 'no') ? 1 : t.oneway === '-1' ? -1 : 0;
  const lanesTag = num(t.lanes), lanes = lanesTag ?? (t.highway.endsWith('_link') ? 1 : oneway ? Math.max(1, Math.ceil(C.lanes / 2)) : C.lanes);
  const widthTag = num(t.width), real = widthTag && widthTag >= 2 && widthTag <= 60 ? widthTag : lanes * C.lane + 2 * C.shoulder;
  return { base, C, oneway, lanesTag, lanes, widthTag, width: Math.max(cfg.minWidth ?? 0, real * (cfg.widthScale ?? 1)) };
}

// Roads that meet where OSM doesn't say so: a way's loose end that lies on another road (or within
// cfg.joinOnto of its edge), or stops short of it pointing at it (within cfg.joinPointing), is joined to
// it — a node put into the other way there (one already within 1.5 m is used), the end carried to it.
// Overture's copy of OSM loses the junction node where a side road meets a main road between its shape
// points, which left T-junctions unjoined: a gap, or a road lying on another at its own height. Only
// the same layer and structure; a road running alongside (not pointing at it) is left alone.
// First: points that are one point (within 0.5 m) but two nodes — Overture's segments meet at
// coordinates a few millimetres apart, so a road and its continuation (onto a bridge too) came out as
// two loose ends. A way's end and another way's end become one node (any layer: that's how a road goes
// onto a bridge); a way's end on another's shape point of the same layer and structure too. One node
// per group (union-find, the lowest id), so two ends can't swap.
function mergeCloseNodes(ways: Way[]) {
  const R = 0.5, parent = new Map<number, number>(), byId = new Map<number, any>();
  const find = (id: number): number => { let r = id; while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!; return r; };
  const unite = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb)); };
  const kind = (t: Record<string, string>) => `${t.layer ?? 0}|${t.bridge && t.bridge !== 'no' ? 'b' : t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'culvert' ? 't' : 'g'}`;
  const C = 2, grid = new Map<string, { p: any; end: boolean; k: string; wi: number }[]>();
  ways.forEach((w, wi) => w.nodes.forEach((p, i) => {
    byId.set(p.id, p);
    const key = `${Math.floor(p.x / C)},${Math.floor(p.z / C)}`;
    (grid.get(key) ?? grid.set(key, []).get(key)!).push({ p, end: i === 0 || i === w.nodes.length - 1, k: kind(w.tags), wi });
  }));
  for (const [key, list] of grid) {
    const [cx, cz] = key.split(',').map(Number);
    for (const e of list) {
      if (!e.end) continue;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const o of grid.get(`${cx + a},${cz + b}`) ?? []) {
        if (o.wi === e.wi || o.p.id === e.p.id || Math.hypot(o.p.x - e.p.x, o.p.z - e.p.z) > R) continue;
        if (o.end || o.k === e.k) unite(e.p.id, o.p.id);
      }
    }
  }
  let n = 0;
  for (const w of ways) w.nodes = w.nodes.map(p => { const r = find(p.id); if (r !== p.id) { n++; return byId.get(r); } return p; });
  // (a way that now visits one node twice in a row: once)
  for (const w of ways) w.nodes = w.nodes.filter((p, i) => i === 0 || p.id !== w.nodes[i - 1].id);
  return n;
}

export function joinLooseEnds(ways: Way[], cfg: RoadCfg) {
  const onto = cfg.joinOnto ?? 1, pointing = cfg.joinPointing ?? 6, reach = 30;
  const merged = mergeCloseNodes(ways);
  const uses = new Map<number, number>();
  for (const w of ways) w.nodes.forEach((p, i) => uses.set(p.id, (uses.get(p.id) ?? 0) + (i === 0 || i === w.nodes.length - 1 ? 2 : 1)));
  const kind = (t: Record<string, string>) => `${t.layer ?? 0}|${t.bridge && t.bridge !== 'no' ? 'b' : t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'culvert' ? 't' : 'g'}`;
  const C = 25, grid = new Map<string, [number, number][]>(), cell = (x: number, z: number) => `${Math.floor(x / C)},${Math.floor(z / C)}`;
  ways.forEach((w, wi) => { for (let i = 0; i + 1 < w.nodes.length; i++) { const k = cell((w.nodes[i].x + w.nodes[i + 1].x) / 2, (w.nodes[i].z + w.nodes[i + 1].z) / 2); (grid.get(k) ?? grid.set(k, []).get(k)!).push([wi, i]); } });
  const half = ways.map(w => sizeOf(w.tags, cfg).width / 2), kinds = ways.map(w => kind(w.tags));
  const inserts = new Map<number, { i: number; t: number; p: any }[]>(), joins: { wi: number; atStart: boolean; p: any }[] = [];
  let nextId = 9e15;
  ways.forEach((w, wi) => {
    if (w.nodes.length < 2) return;
    for (const atStart of [true, false]) {
      const e = atStart ? w.nodes[0] : w.nodes[w.nodes.length - 1], prev = atStart ? w.nodes[1] : w.nodes[w.nodes.length - 2];
      if (uses.get(e.id) !== 2) continue;                    // (joined already, or a way's two ends at one node)
      const ux = e.x - prev.x, uz = e.z - prev.z, ul = Math.hypot(ux, uz) || 1;
      let best: any = null;
      const [cx, cz] = [Math.floor(e.x / C), Math.floor(e.z / C)];
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (const [oi, i] of grid.get(`${cx + a},${cz + b}`) ?? []) {
        if (oi === wi || kinds[oi] !== kinds[wi]) continue;
        const o = ways[oi], A = o.nodes[i], B = o.nodes[i + 1], dx = B.x - A.x, dz = B.z - A.z, L2 = dx * dx + dz * dz || 1e-9;
        const t = Math.max(0, Math.min(1, ((e.x - A.x) * dx + (e.z - A.z) * dz) / L2)), px = A.x + dx * t, pz = A.z + dz * t, d = Math.hypot(e.x - px, e.z - pz);
        if (d > reach) continue;
        const edge = d - half[oi], cos = d < 1e-6 ? 1 : (ux * (px - e.x) + uz * (pz - e.z)) / (ul * d);
        if (!(edge <= onto || (cos > 0.7 && edge <= pointing))) continue;
        if (!best || d < best.d) best = { d, oi, i, t, px, pz, A, B };
      }
      if (!best) continue;
      const { oi, i, t, A, B } = best, o = ways[oi];
      // (the other way's own end, if the meeting point is within its half width of it — no stub left
      // beyond the junction; else a node of it within 1.5 m; else a new one on its line)
      const ends = [o.nodes[0], o.nodes[o.nodes.length - 1]];
      let p = ends.find(q => Math.hypot(q.x - best.px, q.z - best.pz) < Math.max(1.5, half[oi])) ?? [A, B].find(q => Math.hypot(q.x - best.px, q.z - best.pz) < 1.5) ?? null;
      if (!p) {
        p = { id: nextId++, x: best.px, z: best.pz, lat: A.lat + (B.lat - A.lat) * t, lon: A.lon + (B.lon - A.lon) * t, joined: true };
        (inserts.get(oi) ?? inserts.set(oi, []).get(oi)!).push({ i, t, p });
      }
      if (o.nodes.some(q => q.id === e.id)) continue;
      joins.push({ wi, atStart, p });
    }
  });
  for (const [oi, list] of inserts) {
    list.sort((a, b) => b.i - a.i || b.t - a.t);              // (from the far end, so earlier indices hold)
    for (const { i, p } of list) ways[oi].nodes.splice(i + 1, 0, p);
  }
  for (const { wi, atStart, p } of joins) {
    const w = ways[wi], e = atStart ? w.nodes[0] : w.nodes[w.nodes.length - 1];
    if (e === p) continue;
    const same = Math.hypot(e.x - p.x, e.z - p.z) < 0.05;
    if (atStart) same ? (w.nodes[0] = p) : w.nodes.unshift(p);
    else same ? (w.nodes[w.nodes.length - 1] = p) : w.nodes.push(p);
  }
  return { merged, joined: joins.length, inserted: [...inserts.values()].reduce((a, l) => a + l.length, 0) };
}

export function buildRoads(roads: Way[], heightAt: (x: number, z: number) => number, cfg: RoadCfg) {
  // (copies: the joins add nodes to ways, and the caller's OSM data stays as read)
  let ways = roads.filter(w => DRIVABLE.has(w.tags.highway) && w.tags.area !== 'yes').map(w => ({ ...w, nodes: [...w.nodes] }));
  const joinStats = joinLooseEnds(ways, cfg);
  ways = ways.filter(w => w.nodes.length >= 2);      // (a way shorter than the merge distance: gone into its node)
  // nodes shared by ways (or met twice), and every way's ends: the graph's nodes
  const uses = new Map<number, number>();
  for (const w of ways) w.nodes.forEach((p, i) => uses.set(p.id, (uses.get(p.id) ?? 0) + (i === 0 || i === w.nodes.length - 1 ? 2 : 1)));
  const nodes: RNode[] = [], nodeIdx = new Map<number, number>(), segs: Seg[] = [];
  const nodeOf = (p) => { let k = nodeIdx.get(p.id); if (k === undefined) { k = nodes.length; nodeIdx.set(p.id, k); nodes.push({ id: p.id, x: p.x, z: p.z, lat: p.lat, lon: p.lon, segs: [], h: 0, junction: false, ground: false }); } return k; };
  for (const w of ways) {
    const t = w.tags, { base, C, oneway, lanesTag, lanes, widthTag, width } = sizeOf(t, cfg);
    const structure = t.bridge && t.bridge !== 'no' ? 'bridge' : t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'culvert' ? 'tunnel' : 'ground';
    const surf = { paving_stones: 'cobbles', sett: 'cobbles', cobblestone: 'cobbles', concrete: 'concrete', gravel: 'gravel', fine_gravel: 'gravel', unpaved: 'gravel', compacted: 'gravel', dirt: 'dirt', ground: 'dirt', grass: 'grass', sand: 'sand' }[t.surface] ?? (base === 'track' ? 'gravel' : 'tarmac');
    const dense = densified(w.nodes, cfg);
    // split at graph nodes
    let start = 0;
    for (let q = 1; q < dense.length; q++) {
      const d = dense[q];
      if (!(d.orig && ((uses.get(w.nodes[d.k].id) ?? 0) > 1 || q === dense.length - 1))) continue;
      const part = dense.slice(start, q + 1), a = w.nodes[dense[start].k], b = w.nodes[d.k];
      const xs = part.map(p => p.x), zs = part.map(p => p.z), s = [0];
      for (let k = 1; k < part.length; k++) s.push(s[k - 1] + Math.hypot(xs[k] - xs[k - 1], zs[k] - zs[k - 1]));
      if (s[s.length - 1] < 0.05) { start = q; continue; }
      const seg: Seg = {
        id: segs.length, way: w.id, osmWay: num(t['osm:way']) ?? w.id, from: nodeOf(a), to: nodeOf(b),
        xs, zs, orig: part.map(p => p.orig), osmNodes: part.map(p => (p.orig ? w.nodes[p.k].id : null)),
        lat: part.map(p => (p.orig ? w.nodes[p.k].lat : NaN)), lon: part.map(p => (p.orig ? w.nodes[p.k].lon : NaN)),
        s, h: [], raw: [], smooth: [],
        name: t.name ?? t.ref ?? null, cls: base, link: !!LINK[t.highway], rank: C.rank, lanes, lanesEstimated: lanesTag === null, oneway, maxspeed: speedKmh(t.maxspeed),
        width, widthEstimated: widthTag === null, structure, layer: num(t.layer) ?? 0, surface: surf, cut: [0, 0],
      };
      segs.push(seg); nodes[seg.from].segs.push(seg.id); nodes[seg.to].segs.push(seg.id);
      start = q;
    }
  }
  // ---------- 3: heights ----------
  for (const g of segs) {
    g.raw = g.xs.map((x, k) => heightAt(x, g.zs[k]));
    // spikes out (a running median over a few points), then a Gaussian along the road
    const med = g.raw.map((_, k) => { const w = g.raw.slice(Math.max(0, k - cfg.median), k + cfg.median + 1).sort((a, b) => a - b); return w[w.length >> 1]; });
    g.smooth = g.s.map((sk) => { let a = 0, wsum = 0; for (let q = 0; q < g.s.length; q++) { const d = g.s[q] - sk; if (Math.abs(d) > 3 * cfg.smooth) continue; const wt = Math.exp(-d * d / (2 * cfg.smooth * cfg.smooth)); a += wt * med[q]; wsum += wt; } return a / wsum; });
  }
  // a junction's height: where its ground roads meet (their smoothed heights there, averaged)
  for (const n of nodes) {
    const ground = n.segs.map(i => segs[i]).filter(g => g.structure === 'ground');
    n.ground = ground.length > 0;
    const hs = ground.map(g => (nodes[g.from] === n ? g.smooth[0] : g.smooth[g.smooth.length - 1]));
    n.h = hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : heightAt(n.x, n.z);
  }
  // bridges and tunnels: their inner nodes from the ground nodes they're anchored to (by distance along
  // the structure), so the deck runs smoothly from end to end
  const seen = new Set<number>();
  for (const g0 of segs) {
    if (g0.structure === 'ground' || seen.has(g0.id)) continue;
    const comp: Seg[] = [], stack = [g0];
    seen.add(g0.id);
    while (stack.length) { const g = stack.pop()!; comp.push(g); for (const nk of [g.from, g.to]) if (!nodes[nk].ground) for (const si of nodes[nk].segs) { const o = segs[si]; if (o.structure !== 'ground' && !seen.has(o.id)) { seen.add(o.id); stack.push(o); } } }
    const compNodes = [...new Set(comp.flatMap(g => [g.from, g.to]))], anchors = compNodes.filter(k => nodes[k].ground);
    if (!anchors.length) continue;
    // distance along the structure from each anchor (Dijkstra; few nodes)
    const dist = anchors.map(a => { const d = new Map([[a, 0]]), q = [a]; while (q.length) { q.sort((x, y) => d.get(x)! - d.get(y)!); const u = q.shift()!; for (const g of comp) { const v = g.from === u ? g.to : g.to === u ? g.from : -1; if (v < 0) continue; const nd = d.get(u)! + g.s[g.s.length - 1]; if (nd < (d.get(v) ?? Infinity)) { d.set(v, nd); q.push(v); } } } return d; });
    for (const k of compNodes) {
      if (nodes[k].ground) continue;
      let a = 0, wsum = 0;
      anchors.forEach((an, q) => { const d = dist[q].get(k); if (d === undefined) return; const w = 1 / Math.max(d, 1) ** 2; a += w * nodes[an].h; wsum += w; });
      nodes[k].h = wsum ? a / wsum : heightAt(nodes[k].x, nodes[k].z);
    }
  }
  // each segment: its smoothed profile bent to meet its two nodes' heights (bridges and tunnels: eased
  // straight between them)
  for (const g of segs) {
    const L = g.s[g.s.length - 1], ha = nodes[g.from].h, hb = nodes[g.to].h;
    if (g.structure !== 'ground') g.h = g.s.map(s => { const t = s / L, e = t * t * (3 - 2 * t) * 0.5 + t * 0.5; return ha + (hb - ha) * e; });
    else { const da = ha - g.smooth[0], db = hb - g.smooth[g.smooth.length - 1]; g.h = g.smooth.map((v, k) => v + da + (db - da) * (g.s[k] / L)); }
  }
  // (a junction: three roads or more; or two of different widths; or two that both leave the same way — a fork)
  const away = (k: number, g: Seg) => { const a = g.from === k ? 0 : g.xs.length - 1, b = g.from === k ? Math.min(1, g.xs.length - 1) : Math.max(0, g.xs.length - 2), dx = g.xs[b] - g.xs[a], dz = g.zs[b] - g.zs[a], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
  nodes.forEach((n, k) => {
    const two = n.segs.length === 2 ? n.segs.map(i => segs[i]) : null;
    const fork = two && (two[0] === two[1] || (() => { const a = away(k, two[0]), b = away(k, two[1]); return a[0] * b[0] + a[1] * b[1] > 0; })());
    n.junction = n.segs.length >= 3 || (!!two && (Math.abs(two[0].width - two[1].width) > 0.3 || fork));
  });
  return { nodes, segs, joins: joinStats, ...buildSurface(nodes, segs, cfg) };
}

// the height of a segment at arc length s (its profile, linear between points)
export function profileAt(g: Seg, s: number) {
  if (s <= 0) return g.h[0];
  for (let k = 1; k < g.s.length; k++) if (g.s[k] >= s) { const t = (s - g.s[k - 1]) / ((g.s[k] - g.s[k - 1]) || 1); return g.h[k - 1] + (g.h[k] - g.h[k - 1]) * t; }
  return g.h[g.h.length - 1];
}
// a point and direction at arc length s
function pointAt(g: Seg, s: number) {
  let k = 1;
  while (k < g.s.length - 1 && g.s[k] < s) k++;
  const t = Math.max(0, Math.min(1, (s - g.s[k - 1]) / ((g.s[k] - g.s[k - 1]) || 1)));
  const dx = g.xs[k] - g.xs[k - 1], dz = g.zs[k] - g.zs[k - 1], l = Math.hypot(dx, dz) || 1;
  return { x: g.xs[k - 1] + dx * t, z: g.zs[k - 1] + dz * t, dx: dx / l, dz: dz / l };
}

// ---------- 4: the surface ----------
function buildSurface(nodes: RNode[], segs: Seg[], cfg: RoadCfg) {
  const mesh: Mesh = { positions: [], colours: [], indices: [], surfaces: [], segOf: [] };
  const marks: Mesh = { positions: [], colours: [], indices: [], surfaces: [], segOf: [] };
  const ASPHALT = [74, 76, 80], CONCRETE = [150, 148, 142], GRAVEL = [146, 128, 104], COBBLE = [118, 106, 96];
  const colourOf = (g: Seg) => g.surface === 'concrete' ? CONCRETE : g.surface === 'gravel' || g.surface === 'dirt' ? GRAVEL : g.surface === 'cobbles' ? COBBLE : ASPHALT;
  const vtx = (M: Mesh, x: number, y: number, z: number, c: number[]) => { M.positions.push(x, y, z); M.colours.push(c[0], c[1], c[2], 255); return M.positions.length / 3 - 1; };
  // a triangle facing up (or, for upright ones, as given)
  const tri = (M: Mesh, a: number, b: number, c: number, surface: number, seg: number, up = true) => {
    const P = M.positions, ax = P[a * 3], az = P[a * 3 + 2], ny = (P[b * 3 + 2] - az) * (P[c * 3] - ax) - (P[b * 3] - ax) * (P[c * 3 + 2] - az);
    if (up && ny < 0) M.indices.push(a, c, b); else M.indices.push(a, b, c);
    M.surfaces.push(surface); M.segOf.push(seg);
  };
  const SURF = { tarmac: 0, concrete: 1, cobbles: 2, gravel: 3, dirt: 4, grass: 5, sand: 6 };
  // where each segment's ribbon stops short of a junction
  const cutAt = (n: RNode, g: Seg) => {
    if (!n.junction) return 0;
    const hw = Math.max(...n.segs.map(i => segs[i].width / 2));
    return Math.min(hw * 1.15 + cfg.minJunctionCut, g.s[g.s.length - 1] * 0.45);
  };
  for (const g of segs) g.cut = [cutAt(nodes[g.from], g), cutAt(nodes[g.to], g)];
  // the cross-section's sideways direction at each point (shared at a plain two-way meeting of segments)
  const sideAtNode = new Map<number, [number, number]>();
  for (const [k, n] of nodes.entries()) {
    if (n.junction || n.segs.length !== 2) continue;
    const ds = n.segs.map(i => { const g = segs[i], away = g.from === k ? pointAt(g, 0.01) : pointAt(g, g.s[g.s.length - 1] - 0.01); return g.from === k ? [away.dx, away.dz] : [-away.dx, -away.dz]; });
    // (along the road through the node: from the first segment's direction into it, to the second's out)
    const tx = ds[1][0] - ds[0][0], tz = ds[1][1] - ds[0][1], l = Math.hypot(tx, tz) || 1;
    sideAtNode.set(k, [-tz / l, tx / l]);
  }
  const rows = (g: Seg) => {
    // the points between the cuts, the cut points themselves included
    const L = g.s[g.s.length - 1], [c0, c1] = g.cut, out: { s: number; x: number; z: number; side: [number, number] }[] = [];
    const sides = g.xs.map((_, k) => {
      const a = Math.max(0, k - 1), b = Math.min(g.xs.length - 1, k + 1), dx = g.xs[b] - g.xs[a], dz = g.zs[b] - g.zs[a], l = Math.hypot(dx, dz) || 1;
      return [-dz / l, dx / l] as [number, number];
    });
    const ends: [number, number][] = [[g.from, 0], [g.to, g.xs.length - 1]];
    for (const [nk, k] of ends) { const sv = sideAtNode.get(nk); if (sv) { const dir = sides[k]; sides[k] = sv[0] * dir[0] + sv[1] * dir[1] >= 0 ? sv : [-sv[0], -sv[1]]; } }
    const at = (s: number) => { const p = pointAt(g, s); return { s, x: p.x, z: p.z, side: [-p.dz, p.dx] as [number, number] }; };
    if (c0 > 0) out.push(at(c0));
    for (let k = 0; k < g.xs.length; k++) if (g.s[k] > c0 + 0.05 && g.s[k] < L - c1 - 0.05 || (c0 === 0 && k === 0) || (c1 === 0 && k === g.xs.length - 1)) out.push({ s: g.s[k], x: g.xs[k], z: g.zs[k], side: sides[k] });
    if (c1 > 0) out.push(at(L - c1));
    // (a road that ends — a dead end — runs half a metre past its last node, so the node's on it)
    const deadEnd = (nk: number) => nodes[nk].segs.length === 1;
    if (deadEnd(g.from) && out.length) { const p = pointAt(g, 0.01); out.unshift({ s: -0.5, x: g.xs[0] - p.dx * 0.5, z: g.zs[0] - p.dz * 0.5, side: out[0].side }); }
    if (deadEnd(g.to) && out.length) { const p = pointAt(g, L - 0.01); out.push({ s: L + 0.5, x: g.xs[g.xs.length - 1] + p.dx * 0.5, z: g.zs[g.zs.length - 1] + p.dz * 0.5, side: out[out.length - 1].side }); }
    return out;
  };
  // the cross-section at a row: [skirt L, edge L, crown, edge R, skirt R] (x, y, z)
  const section = (g: Seg, r) => {
    const hw = g.width / 2, y = profileAt(g, r.s), drop = (g.oneway ? 0.6 : 1) * cfg.camber * hw, [sx, sz] = r.side;
    const P = (o: number, dy: number) => [r.x + sx * o, y + dy, r.z + sz * o];
    const skirt = g.structure === 'bridge' ? 0 : cfg.skirt;
    return [P(-hw - skirt, -drop - (skirt ? cfg.skirtDrop : 0)), P(-hw, -drop), P(0, 0), P(hw, -drop), P(hw + skirt, -drop - (skirt ? cfg.skirtDrop : 0))];
  };
  const ends = new Map<string, number[][]>();   // `${seg}:${0|1}` → the cut section (for the junction fans)
  for (const g of segs) {
    const R = rows(g);
    if (R.length < 2) continue;
    const col = colourOf(g), sf = SURF[g.surface] ?? 0, secs = R.map(r => section(g, r));
    const ids = secs.map(sec => sec.map(p => vtx(mesh, p[0], p[1], p[2], col)));
    for (let q = 0; q + 1 < ids.length; q++) for (let c = 0; c < 4; c++) { tri(mesh, ids[q][c], ids[q + 1][c], ids[q + 1][c + 1], sf, g.id); tri(mesh, ids[q][c], ids[q + 1][c + 1], ids[q][c + 1], sf, g.id); }
    ends.set(`${g.id}:0`, secs[0]); ends.set(`${g.id}:1`, secs[secs.length - 1]);
    // bridges: the deck's sides, a metre down
    if (g.structure === 'bridge') for (const c of [1, 3]) for (let q = 0; q + 1 < secs.length; q++) {
      const a = secs[q][c], b = secs[q + 1][c], dk = [120, 118, 112];
      const i0 = vtx(mesh, a[0], a[1], a[2], dk), i1 = vtx(mesh, b[0], b[1], b[2], dk), i2 = vtx(mesh, b[0], b[1] - 1.2, b[2], dk), i3 = vtx(mesh, a[0], a[1] - 1.2, a[2], dk);
      tri(mesh, i0, i1, i2, sf, g.id, false); tri(mesh, i0, i2, i3, sf, g.id, false); tri(mesh, i0, i2, i1, sf, g.id, false); tri(mesh, i0, i3, i2, sf, g.id, false);
    }
    // markings: a dashed centre line on two-way roads of two lanes and more, lane lines, edge lines on
    // the big roads — thin strips 2 cm over the surface
    const lines: { off: number; dashed: boolean; colour: number[] }[] = [];
    const hw = g.width / 2;
    if (g.cls !== 'service' && g.cls !== 'track' && g.lanes >= 2) {
      if (!g.oneway) { lines.push({ off: 0, dashed: g.rank < 6, colour: [226, 182, 58] }); for (let l = 1; l < g.lanes / 2; l++) { const o = hw * 2 * l / g.lanes; lines.push({ off: o, dashed: true, colour: [232, 232, 226] }, { off: -o, dashed: true, colour: [232, 232, 226] }); } }
      else for (let l = 1; l < g.lanes; l++) lines.push({ off: -hw + g.width * l / g.lanes, dashed: true, colour: [232, 232, 226] });
      if (g.rank >= 6) lines.push({ off: hw - 0.35, dashed: false, colour: [232, 232, 226] }, { off: -hw + 0.35, dashed: false, colour: g.oneway && g.rank >= 8 ? [226, 182, 58] : [232, 232, 226] });
    }
    for (const ln of lines) {
      const period = cfg.dash + cfg.gap;
      for (let q = 0; q + 1 < R.length; q++) {
        let s0 = R[q].s, s1 = R[q + 1].s;
        const segments: [number, number][] = [];
        if (!ln.dashed) segments.push([s0, s1]);
        else for (let p = Math.floor(s0 / period) * period; p < s1; p += period) { const a = Math.max(s0, p), b = Math.min(s1, p + cfg.dash); if (b > a + 0.1) segments.push([a, b]); }
        for (const [a, b] of segments) {
          const pa = pointAt(g, a), pb = pointAt(g, b), side = R[q].side, w = cfg.markingWidth / 2;
          const ya = profileAt(g, a) - (Math.abs(ln.off) / hw) * (g.oneway ? 0.6 : 1) * cfg.camber * hw + 0.02, yb = profileAt(g, b) - (Math.abs(ln.off) / hw) * (g.oneway ? 0.6 : 1) * cfg.camber * hw + 0.02;
          const P = (p, o, y) => vtx(marks, p.x + side[0] * o, y, p.z + side[1] * o, ln.colour);
          const i0 = P(pa, ln.off - w, ya), i1 = P(pb, ln.off - w, yb), i2 = P(pb, ln.off + w, yb), i3 = P(pa, ln.off + w, ya);
          tri(marks, i0, i1, i2, 0, g.id); tri(marks, i0, i2, i3, 0, g.id);
        }
      }
    }
  }
  // junctions: one fan from the node joining every road's cut end, its outer edge skirted
  const junctions: { node: number; ring: number[][]; centre: number[] }[] = [];
  for (const [k, n] of nodes.entries()) {
    if (!n.junction) continue;
    const arms = n.segs.map(i => {
      const g = segs[i], atStart = g.from === k, sec = ends.get(`${g.id}:${atStart ? 0 : 1}`);
      if (!sec) return null;
      const p = atStart ? pointAt(g, g.cut[0]) : pointAt(g, g.s[g.s.length - 1] - g.cut[1]);
      const ang = Math.atan2(p.z - n.z, p.x - n.x);
      // (the two edge points, ordered round the node)
      const [a, b] = [sec[1], sec[3]], ca = Math.atan2(a[2] - n.z, a[0] - n.x), cb = Math.atan2(b[2] - n.z, b[0] - n.x);
      const da = ((ca - ang + 3 * Math.PI) % (2 * Math.PI)) - Math.PI, db = ((cb - ang + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      // (its crown too: along each road's centre line the joined surface follows that road's profile)
      return { ang, pts: da < db ? [a, sec[2], b] : [b, sec[2], a], g };
    }).filter(Boolean).sort((p, q) => p.ang - q.ang);
    if (arms.length < 2) continue;
    // (the arms all to one side — a fork's tip: a point behind the node too, so the fan surrounds it)
    let gapAt = -1, gap = 0;
    for (let q = 0; q < arms.length; q++) { const a = arms[q].ang, b = q + 1 < arms.length ? arms[q + 1].ang : arms[0].ang + 2 * Math.PI; if (b - a > gap) { gap = b - a; gapAt = q; } }
    if (gap > Math.PI * 0.9) {
      const mid = arms[gapAt].ang + gap / 2, r = Math.min(...arms.map(a => a.g.width / 2)) * 0.6, p = [n.x + Math.cos(mid) * r, n.h - cfg.camber * r, n.z + Math.sin(mid) * r];
      arms.splice(gapAt + 1, 0, { ang: mid, pts: [p, p, p], g: arms[gapAt].g });
    }
    const ring = arms.flatMap(a => a.pts), g0 = arms[0].g, col = colourOf(g0), sf = SURF[g0.surface] ?? 0;
    const c = vtx(mesh, n.x, n.h, n.z, col), ids = ring.map(p => vtx(mesh, p[0], p[1], p[2], col));
    for (let q = 0; q < ids.length; q++) tri(mesh, c, ids[q], ids[(q + 1) % ids.length], sf, g0.id);
    // the edges between arms: skirts down under the ground
    for (let q = 2; q < ring.length; q += 3) {
      const a = ring[q], b = ring[(q + 1) % ring.length], dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1;
      let ox = dz / l, oz = -dx / l;
      if ((a[0] + b[0]) / 2 + ox - n.x < 0 === (a[0] + b[0]) / 2 - n.x < 0 && Math.hypot((a[0] + b[0]) / 2 + ox - n.x, (a[2] + b[2]) / 2 + oz - n.z) < Math.hypot((a[0] + b[0]) / 2 - n.x, (a[2] + b[2]) / 2 - n.z)) { ox = -ox; oz = -oz; }
      const i0 = vtx(mesh, a[0], a[1], a[2], col), i1 = vtx(mesh, b[0], b[1], b[2], col), i2 = vtx(mesh, b[0] + ox * cfg.skirt, b[1] - cfg.skirtDrop, b[2] + oz * cfg.skirt, col), i3 = vtx(mesh, a[0] + ox * cfg.skirt, a[1] - cfg.skirtDrop, a[2] + oz * cfg.skirt, col);
      tri(mesh, i0, i1, i2, sf, g0.id); tri(mesh, i0, i2, i3, sf, g0.id);
    }
    junctions.push({ node: k, ring, centre: [n.x, n.h, n.z] });
  }
  return { mesh, marks, junctions };
}
