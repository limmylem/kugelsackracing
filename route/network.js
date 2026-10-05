// The road network routes are found on: a baked region's road graph (map/format/graph.ts — OpenStreetMap's
// drivable ways, cut at junctions, with heights and widths), ready for shortest paths. Pure.
//
//   const N = createNetwork(graph, { P, region, version, bbox })      P: the region's projection (toXZ / toLatLon)
//     bbox: [west, south, east, north] — the baked map's (its manifest's). The graph reaches past it (whole
//     OSM ways), but the ground doesn't: N.inside(x, z), N.outsideOf(line) → { metres, at } of a line beyond it
//   N.nearest(x, z, options, reach) → { seg, s, x, z, h, d }   the nearest road a route may use
//   N.path(a, b, options) → { pieces: [{ seg, s0, s1 }], length } | { error }   a → b (positions on roads)
//   N.allowed(seg, forward, options)   N.keyOf(seg) → 'way:fromNode:toNode' (OSM's ids: stable between bakes)
//
// Options (a route's): reverseOneway (drive one-way roads against their way), motorways, unpaved, tunnels
// — each true to allow; ferries are never used (the graph has none anyway).

export const DEFAULT_OPTIONS = { reverseOneway: false, motorways: true, unpaved: false, tunnels: true, offRoad: false };
const UNPAVED = new Set(['gravel', 'dirt', 'grass', 'sand', 'unpaved', 'compacted', 'ground']);
const MOTORWAY = new Set(['motorway', 'motorway_link']);
const GRID = 50;

export class Heap {
  constructor() { this.a = []; }
  push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
}

export function createNetwork(G, { P = null, region = null, version = null, bbox = null } = {}) {
  const segs = G.segs, nodes = G.nodes, n = nodes.x.length;
  // each segment's length and the distance along it at each of its points
  for (const sg of segs) {
    if (sg.cum) continue;
    const p = sg.points, cum = [0];
    for (let k = 3; k < p.length; k += 3) cum.push(cum.at(-1) + Math.hypot(p[k] - p[k - 3], p[k + 1] - p[k - 2]));
    sg.cum = cum; sg.length = cum.at(-1);
  }
  const adj = Array.from({ length: n }, () => []);
  for (const sg of segs) { adj[sg.from].push({ sg, forward: true, to: sg.to }); adj[sg.to].push({ sg, forward: false, to: sg.from }); }
  const degree = adj.map(l => l.length);
  const grid = new Map();
  for (const sg of segs) {
    const p = sg.points;
    for (let k = 0; k + 5 < p.length; k += 3) {
      const x0 = Math.min(p[k], p[k + 3]), x1 = Math.max(p[k], p[k + 3]), z0 = Math.min(p[k + 1], p[k + 4]), z1 = Math.max(p[k + 1], p[k + 4]);
      for (let i = Math.floor(x0 / GRID); i <= Math.floor(x1 / GRID); i++) for (let j = Math.floor(z0 / GRID); j <= Math.floor(z1 / GRID); j++) { const key = `${i},${j}`; (grid.get(key) ?? grid.set(key, []).get(key)).push([sg, k / 3]); }
    }
  }
  const osmNode = i => nodes.osm?.[i] ?? i;
  const keyOf = sg => `${sg.way}:${osmNode(sg.from)}:${osmNode(sg.to)}`;
  const byKey = new Map(segs.map(sg => [keyOf(sg), sg]));

  function allowed(sg, forward, o = DEFAULT_OPTIONS) {
    if (!o.reverseOneway && ((sg.oneway === 1 && !forward) || (sg.oneway === -1 && forward))) return false;
    if (!o.motorways && MOTORWAY.has(sg.class)) return false;
    if (!o.unpaved && UNPAVED.has(sg.surface)) return false;
    if (!o.tunnels && sg.structure === 'tunnel') return false;
    if (sg.class === 'ferry' || sg.ferry) return false;
    return true;
  }
  const usable = (sg, o) => allowed(sg, true, o) || allowed(sg, false, o);

  // a point at s along a segment
  function pointOn(sg, s) {
    const c = sg.cum, p = sg.points;
    s = Math.max(0, Math.min(sg.length, s));
    let k = 0, hi = c.length - 1;
    while (hi - k > 1) { const m = (k + hi) >> 1; if (c[m] <= s) k = m; else hi = m; }
    const k2 = Math.min(k + 1, c.length - 1), t = c[k2] > c[k] ? (s - c[k]) / (c[k2] - c[k]) : 0;
    const i = k * 3, j = k2 * 3, dx = p[j] - p[i], dz = p[j + 1] - p[i + 1], m = Math.hypot(dx, dz) || 1;
    return { x: p[i] + dx * t, z: p[i + 1] + dz * t, h: p[i + 2] + (p[j + 2] - p[i + 2]) * t, dx: dx / m, dz: dz / m };
  }

  // the roads a route can both reach and leave under these options: the largest strongly connected part of
  // the network (a one-way alley that dead-ends, or a scrap of road cut off at the region's edge, isn't)
  const mains = new Map();
  function mainPart(o) {
    const key = `${!!o.reverseOneway}${!!o.motorways}${!!o.unpaved}${!!o.tunnels}`;
    if (mains.has(key)) return mains.get(key);
    const out = Array.from({ length: n }, () => []), inn = Array.from({ length: n }, () => []);
    for (const sg of segs) { if (allowed(sg, true, o)) { out[sg.from].push(sg.to); inn[sg.to].push(sg.from); } if (allowed(sg, false, o)) { out[sg.to].push(sg.from); inn[sg.from].push(sg.to); } }
    const seen = new Uint8Array(n), order = [];
    for (let r = 0; r < n; r++) { if (seen[r]) continue; const st = [[r, 0]]; seen[r] = 1; while (st.length) { const top = st[st.length - 1]; if (top[1] < out[top[0]].length) { const v = out[top[0]][top[1]++]; if (!seen[v]) { seen[v] = 1; st.push([v, 0]); } } else { order.push(top[0]); st.pop(); } } }
    const comp = new Int32Array(n).fill(-1), size = [];
    for (let i = order.length - 1; i >= 0; i--) { const r = order[i]; if (comp[r] >= 0) continue; const c = size.length; let k = 0; const st = [r]; comp[r] = c; while (st.length) { const u = st.pop(); k++; for (const v of inn[u]) if (comp[v] < 0) { comp[v] = c; st.push(v); } } size.push(k); }
    const big = size.indexOf(Math.max(...size)), inMain = new Uint8Array(n);
    for (let i = 0; i < n; i++) inMain[i] = comp[i] === big ? 1 : 0;
    mains.set(key, inMain);
    return inMain;
  }

  // the nearest road a route may use (and get on and off: the main part); alleys and service roads only
  // if they're clearly nearer (a click by a street means the street)
  function nearest(x, z, o = DEFAULT_OPTIONS, reach = 80, filter = null) {
    let best = null;
    const main = mainPart(o);
    const r = Math.ceil(reach / GRID);
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (const [sg, k] of grid.get(`${Math.floor(x / GRID) + a},${Math.floor(z / GRID) + b}`) ?? []) {
      if (!usable(sg, o) || (filter && !filter(sg)) || !(main[sg.from] && main[sg.to])) continue;
      const p = sg.points, i = k * 3, ax = p[i], az = p[i + 1], dx = p[i + 3] - ax, dz = p[i + 4] - az, L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)), px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
      const score = d + ((sg.rank ?? 4) < 3 ? 15 : 0);
      if (d <= reach && (!best || score < best.score)) best = { seg: sg, s: sg.cum[k] + (sg.cum[k + 1] - sg.cum[k]) * t, x: px, z: pz, h: p[i + 2] + (p[i + 5] - p[i + 2]) * t, d, score };
    }
    return best;
  }

  // the few roads near a point a waypoint might mean (each road's nearest place; the other carriageway of a
  // dual carriageway among them), best first
  function candidates(x, z, o = DEFAULT_OPTIONS, reach = 80, limit = 4, slack = 30) {
    // (roads off the main part too — a motorway leaving the region is one — but behind those on it: the
    // route's chooser keeps only places it can get to and on from)
    const main = mainPart(o), per = new Map(), r = Math.ceil(reach / GRID);
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (const [sg, k] of grid.get(`${Math.floor(x / GRID) + a},${Math.floor(z / GRID) + b}`) ?? []) {
      if (!usable(sg, o)) continue;
      const p = sg.points, i = k * 3, ax = p[i], az = p[i + 1], dx = p[i + 3] - ax, dz = p[i + 4] - az, L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)), px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
      if (d > reach) continue;
      const score = d + ((sg.rank ?? 4) < 3 ? 15 : 0) + (main[sg.from] && main[sg.to] ? 0 : 40), had = per.get(sg);
      if (!had || score < had.score) per.set(sg, { seg: sg, s: sg.cum[k] + (sg.cum[k + 1] - sg.cum[k]) * t, x: px, z: pz, h: p[i + 2] + (p[i + 5] - p[i + 2]) * t, d, score });
    }
    // (one per way: the nearest piece of each road)
    const byWay = new Map(), all = [...per.values()].sort((u, v) => u.score - v.score);
    for (const c of all) if (!byWay.has(c.seg.way) && c.score <= all[0].score + slack + 40) byWay.set(c.seg.way, c);
    return [...byWay.values()].slice(0, limit);
  }

  // the shortest way from a to b (positions { seg, s }) under the options
  function path(a, b, o = DEFAULT_OPTIONS) {
    const sa = a.seg, sb = b.seg;
    const direct = [];
    if (sa === sb) {
      if (b.s >= a.s && allowed(sa, true, o)) direct.push({ cost: b.s - a.s, pieces: [{ seg: sa, s0: a.s, s1: b.s }] });
      if (b.s < a.s && allowed(sa, false, o)) direct.push({ cost: a.s - b.s, pieces: [{ seg: sa, s0: a.s, s1: b.s }] });
    }
    const bp = pointOn(sb, b.s);
    const h = i => Math.hypot(nodes.x[i] - bp.x, nodes.z[i] - bp.z);
    const dist = new Float64Array(n).fill(Infinity), prev = new Array(n), heap = new Heap();
    // (from a: along its segment to either end, where its way allows)
    if (allowed(sa, true, o)) { const c = sa.length - a.s; if (c < dist[sa.to]) { dist[sa.to] = c; prev[sa.to] = { start: true, piece: { seg: sa, s0: a.s, s1: sa.length } }; heap.push(c + h(sa.to), sa.to); } }
    if (allowed(sa, false, o)) { const c = a.s; if (c < dist[sa.from]) { dist[sa.from] = c; prev[sa.from] = { start: true, piece: { seg: sa, s0: a.s, s1: 0 } }; heap.push(c + h(sa.from), sa.from); } }
    // (into b: from either end of its segment)
    const endFrom = allowed(sb, true, o) ? b.s : Infinity, endTo = allowed(sb, false, o) ? sb.length - b.s : Infinity;
    let best = direct.length ? Math.min(...direct.map(d => d.cost)) : Infinity, bestEnd = null;
    const done = new Uint8Array(n);
    while (heap.size) {
      const [f, u] = heap.pop();
      if (done[u]) continue;
      done[u] = 1;
      if (f >= best) break;
      if (u === sb.from && dist[u] + endFrom < best) { best = dist[u] + endFrom; bestEnd = { node: u, piece: { seg: sb, s0: 0, s1: b.s } }; }
      if (u === sb.to && dist[u] + endTo < best) { best = dist[u] + endTo; bestEnd = { node: u, piece: { seg: sb, s0: sb.length, s1: b.s } }; }
      for (const e of adj[u]) {
        if (!allowed(e.sg, e.forward, o)) continue;
        const c = dist[u] + e.sg.length;
        if (c < dist[e.to]) { dist[e.to] = c; prev[e.to] = { from: u, piece: { seg: e.sg, s0: e.forward ? 0 : e.sg.length, s1: e.forward ? e.sg.length : 0 } }; heap.push(c + h(e.to), e.to); }
      }
    }
    if (best === Infinity) return { error: 'no road' };
    if (!bestEnd) return { pieces: direct.sort((x, y) => x.cost - y.cost)[0].pieces, length: best };
    const pieces = [bestEnd.piece];
    for (let u = bestEnd.node; ;) { const p = prev[u]; pieces.unshift(p.piece); if (p.start) break; u = p.from; }
    return { pieces: pieces.filter(p => Math.abs(p.s1 - p.s0) > 1e-6 || pieces.length === 1), length: best };
  }

  // the baked map's edge (no bbox or projection: everywhere's inside). Most points are well inside: a box
  // in metres inside the map's edge (its edges sampled, projected) answers those without the projection
  let core = null;
  if (bbox && P) {
    const [w, so, e, n] = bbox, xs = { w: [], e: [] }, zs = { s: [], n: [] };
    for (let k = 0; k <= 16; k++) {
      const lat = so + (n - so) * k / 16, lon = w + (e - w) * k / 16;
      xs.w.push(P.toXZ(lat, w)[0]); xs.e.push(P.toXZ(lat, e)[0]);
      zs.s.push(P.toXZ(so, lon)[1]); zs.n.push(P.toXZ(n, lon)[1]);
    }
    // (z grows southwards: north is the smaller z) — 2 m in from the edge, for the curvature between samples
    core = { x0: Math.max(...xs.w) + 2, x1: Math.min(...xs.e) - 2, z0: Math.max(...zs.n) + 2, z1: Math.min(...zs.s) - 2 };
  }
  function inside(x, z) {
    if (!bbox || !P) return true;
    if (x > core.x0 && x < core.x1 && z > core.z0 && z < core.z1) return true;
    const [lat, lon] = P.toLatLon(x, z);
    return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
  }
  function outsideOf(line) {
    let metres = 0, at = null;
    for (let k = 0; k < line.length; k++) {
      if (inside(line[k].x, line[k].z)) continue;
      at ??= k;
      if (k > 0) metres += Math.hypot(line[k].x - line[k - 1].x, line[k].z - line[k - 1].z);
    }
    return { metres, at };
  }
  return { G, P, region, version, bbox, segs, nodes, degree, adj, keyOf, byKey, allowed, usable, pointOn, nearest, candidates, path, osmNode, mainPart, inside, outsideOf };
}
