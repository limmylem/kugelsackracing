// Map v4's road graph (the first part of the road surface model, map/model/): OpenStreetMap's drivable ways
// as a planar graph — nodes at every intersection (a node shared by ways), every end, every change of layer or
// structure (a way's end: OSM splits ways there), and every tile-border crossing; segments between them carrying
// the original OSM point sequence (every OSM node exactly where OSM has it, and the curve points added between),
// class, lanes, one way, speed limit, name, surface, layer, bridge, tunnel and lit.
//
// Kept from Map v3 (map/bake/roads.ts): which ways are drivable, the joining of roads Overture's copy of OSM left
// unjoined (nodes within 0.5 m, loose ends lying on or pointing at a road), and one copy of a road given twice.
// New: curve points by how much the way turns (never folding a tight bend: more points there), and nodes where a
// road crosses a tile border (the surface is built whole and cut there, so both tiles get the same vertices).
//
//   const G = buildGraph(osm.roads, { cfg: v4 cfg, v3roads: bake.json roads (the joins), tileSize })
//   G.nodes: [{ id, x, z, lat, lon, segs, border }], G.segs: [Seg], G.joins

import type { Way } from '../bake/osmData.ts';
import { DRIVABLE, joinLooseEnds } from '../bake/roads.ts';
import { baseWidth } from './widths.ts';

export interface MNode { id: number; x: number; z: number; lat: number; lon: number; segs: number[]; border: boolean; kind?: 'junction' | 'joint' | 'end'; cluster?: number; h?: number; ground?: boolean; arms?: number }
export interface Seg {
  id: number; way: number; osmWay: number; from: number; to: number;
  tags?: Record<string, string>;   // (its way's tags: with a second copy's merged in, graph.mergeCopies)
  xs: number[]; zs: number[]; orig: boolean[]; osmNodes: (number | null)[]; lat: number[]; lon: number[]; s: number[];
  name: string | null; ref: string | null; cls: string; link: boolean; rank: number; oneway: number; maxspeed: number | null;
  lanesTag: number | null; widthTag: number | null; structure: 'ground' | 'bridge' | 'tunnel'; layer: number; surface: string; lit: 'yes' | 'no' | null;
  // (set by the later steps of the model)
  [k: string]: any;
}

export const RANK: Record<string, number> = { motorway: 9, trunk: 8, primary: 7, secondary: 6, tertiary: 5, unclassified: 4, residential: 4, road: 4, living_street: 3, busway: 3, service: 2, track: 1 };
const LINK: Record<string, string> = { motorway_link: 'motorway', trunk_link: 'trunk', primary_link: 'primary', secondary_link: 'secondary', tertiary_link: 'tertiary' };
const num = (v: string | undefined) => { const n = parseFloat(v ?? ''); return Number.isFinite(n) ? n : null; };
function speedKmh(v?: string) { if (!v) return null; const m = v.match(/^(\d+(?:\.\d+)?)\s*(mph)?/i); return m ? Math.round(+m[1] * (m[2] ? 1.609 : 1)) : null; }
const SURFACE: Record<string, string> = { paving_stones: 'cobbles', sett: 'cobbles', cobblestone: 'cobbles', concrete: 'concrete', 'concrete:plates': 'concrete', gravel: 'gravel', fine_gravel: 'gravel', unpaved: 'gravel', compacted: 'gravel', dirt: 'dirt', ground: 'dirt', earth: 'dirt', grass: 'grass', sand: 'sand' };

// A way's points with curve points added: a cubic (Hermite, centripetal Catmull–Rom tangents) between OSM's
// nodes where the way bends gently, with enough points that it turns at most maxTurnPerPoint° between two, and
// at most densify m apart; sharp corners (more than `corner`°) stay corners. OSM's own nodes never move.
// Map v5 (cfg.continuous): ghost neighbours before the first node and after the last — the next point of the road that
// continues this way there — so its end tangents carry through (Overture's copy of OSM splits roads into a way between
// every two junctions: each split was a kink); and a turn sharper than `corner` stays a corner only where both its legs
// are at least cornerMinLeg m (a hairpin's nodes a few metres apart are a curve).
export function densify(nodes: { x: number; z: number }[], cfg: { densify: number; maxTurnPerPoint: number; corner: number; straightSpacing?: number; cornerMinLeg?: number }, ghost: { prev?: { x: number; z: number } | null; next?: { x: number; z: number } | null } = {}) {
  const n = nodes.length, out: { x: number; z: number; orig: boolean; k: number }[] = [];
  const nb = (i: number) => (i < 0 ? ghost.prev ?? null : i >= n ? ghost.next ?? null : nodes[i]);
  const dir = (a: any, b: any) => { const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
  const T: (number[] | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const P0 = nb(i - 1), P2 = nb(i + 1), P1 = nodes[i];
    if (!P0 || !P2) continue;
    const a = dir(P0, P1), b = dir(P1, P2), turn = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]))) * 180 / Math.PI;
    const legs = Math.min(Math.hypot(P1.x - P0.x, P1.z - P0.z), Math.hypot(P2.x - P1.x, P2.z - P1.z));
    if ((turn >= cfg.corner && !(cfg.cornerMinLeg && legs < cfg.cornerMinLeg && turn < 150)) || turn <= 0.5) continue;
    const d0 = Math.sqrt(Math.hypot(P1.x - P0.x, P1.z - P0.z)) || 1e-6, d1 = Math.sqrt(Math.hypot(P2.x - P1.x, P2.z - P1.z)) || 1e-6;
    const tx = (P1.x - P0.x) / d0 / (d0 + d1) * d1 + (P2.x - P1.x) / d1 / (d0 + d1) * d0, tz = (P1.z - P0.z) / d0 / (d0 + d1) * d1 + (P2.z - P1.z) / d1 / (d0 + d1) * d0;
    const l = Math.hypot(tx, tz) || 1;
    T[i] = [tx / l, tz / l];
  }
  for (let i = 0; i < n; i++) {
    out.push({ x: nodes[i].x, z: nodes[i].z, orig: true, k: i });
    if (i === n - 1) break;
    const a = nodes[i], b = nodes[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L < 1e-6) continue;
    const c = [(b.x - a.x) / L, (b.z - a.z) / L], ta = T[i] ?? c, tb = T[i + 1] ?? c;
    if (!T[i] && !T[i + 1]) {
      // (straight between two corners or ends: points every straightSpacing m all the same — the road's height
      // profile follows the ground's hills between OSM's nodes, which can be hundreds of metres apart)
      const m = Math.ceil(L / (cfg.straightSpacing ?? Infinity));
      for (let q = 1; q < m; q++) out.push({ x: a.x + (b.x - a.x) * q / m, z: a.z + (b.z - a.z) * q / m, orig: false, k: i });
      continue;
    }
    const turn = Math.acos(Math.max(-1, Math.min(1, ta[0] * tb[0] + ta[1] * tb[1]))) * 180 / Math.PI;
    const m = Math.max(Math.ceil(L / cfg.densify), Math.ceil(turn / cfg.maxTurnPerPoint));
    for (let q = 1; q < m; q++) {
      const t = q / m, h00 = 2 * t ** 3 - 3 * t * t + 1, h10 = t ** 3 - 2 * t * t + t, h01 = -2 * t ** 3 + 3 * t * t, h11 = t ** 3 - t * t;
      out.push({ x: h00 * a.x + h10 * L * ta[0] + h01 * b.x + h11 * L * tb[0], z: h00 * a.z + h10 * L * ta[1] + h01 * b.z + h11 * L * tb[1], orig: false, k: i });
    }
  }
  return out;
}

// (Map v5: a way's nodes less those within minNodeGap m of the last one kept — a few decimetres of zigzag in OSM's
// line, a kink when the curve goes through every one; its ends and every node another road shares are always kept)
export function thinNodes<T extends { id: number; x: number; z: number }>(nodes: T[], uses: Map<number, number>, gap: number): T[] {
  const n = nodes.length, must = (i: number) => i === 0 || i === n - 1 || (uses.get(nodes[i].id) ?? 0) > 1;
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    const p = nodes[i];
    if (!must(i)) {
      const a = out[out.length - 1];
      let j = i + 1; while (j < n - 1 && !must(j)) j++;
      if (Math.hypot(p.x - a.x, p.z - a.z) < gap || Math.hypot(nodes[j].x - p.x, nodes[j].z - p.z) < gap) continue;
    }
    out.push(p);
  }
  return out;
}

export function buildGraph(roads: Way[], { cfg, v3roads, tileSize }: { cfg: any; v3roads: any; tileSize: number }) {
  // (copies: the joins add nodes to ways; the caller's OSM data stays as read)
  let ways = roads.filter(w => DRIVABLE.has(w.tags.highway) && w.tags.area !== 'yes').map(w => ({ ...w, nodes: [...w.nodes] }));
  // one copy of a road given twice (the copy that knows its layer). (Map v5, graph.mergeCopies: the other copy's tags
  // fill in what the kept one lacks — Overture's copy of OSM gives a bridge twice, one copy with its name and layer,
  // the other with OSM's lanes, turn lanes, cycle lanes and footpaths)
  {
    const keyOf = (w: Way) => { const f = w.nodes.map(p => `${p.x.toFixed(1)},${p.z.toFixed(1)}`), b = [...f].reverse(); const a = f.join(';'), r = b.join(';'); return a < r ? a : r; };
    const kept = new Map<string, number>(), score = (x: Way) => Math.abs(num(x.tags.layer) ?? 0) * 2 + (x.tags.bridge || x.tags.tunnel ? 1 : 0);
    const keys = ways.map(keyOf);
    ways.forEach((w, i) => { const k = keys[i], j = kept.get(k); if (j === undefined || score(w) > score(ways[j])) kept.set(k, i); });
    const keep = new Set(kept.values());
    if (cfg.graph.mergeCopies) ways.forEach((w, i) => {
      if (keep.has(i)) return;
      const K = ways[kept.get(keys[i])!], same = K.nodes[0].id === w.nodes[0].id;
      // (only what doesn't depend on the way's direction, unless both run the same way)
      const t = { ...K.tags };
      for (const [k, v] of Object.entries(w.tags)) if (t[k] === undefined && (same || !/(^|:)(forward|backward|left|right)(:|$)|^oneway$/.test(k))) t[k] = v;
      K.tags = t;
    });
    ways = ways.filter((_, i) => keep.has(i));
  }
  // (an end within a road's own width — Map v4's — joined to it)
  const halfOf = (t: Record<string, string>) => {
    const base = LINK[t.highway] ?? t.highway, oneway = t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout' || (base === 'motorway' && t.oneway !== 'no') ? 1 : 0;
    return baseWidth({ cls: base, link: !!LINK[t.highway], oneway, lanesTag: num(t.lanes), widthTag: num(t.width) } as any, cfg.widths).visual / 2;
  };
  const joins = joinLooseEnds(ways, v3roads, halfOf);
  ways = ways.filter(w => w.nodes.length >= 2);
  const uses = new Map<number, number>();
  for (const w of ways) w.nodes.forEach((p, i) => uses.set(p.id, (uses.get(p.id) ?? 0) + (i === 0 || i === w.nodes.length - 1 ? 2 : 1)));
  // (Map v5: the road continuing each way at its ends — the way ending there whose first leg turns least from this one's
  // last, within continueMaxTurn°, preferring the same name, then the same class — for densify's ghost neighbours)
  const endsAt = new Map<number, { w: Way; atStart: boolean }[]>();
  if (cfg.graph.continuous) for (const w of ways) for (const atStart of [true, false]) { const p = w.nodes[atStart ? 0 : w.nodes.length - 1]; (endsAt.get(p.id) ?? endsAt.set(p.id, []).get(p.id)!).push({ w, atStart }); }
  const ghostsOf = (w: Way) => {
    const pick = (atStart: boolean) => {
      const n = w.nodes.length, end = w.nodes[atStart ? 0 : n - 1], inner = w.nodes[atStart ? 1 : n - 2];
      if (!inner) return null;
      const ux = end.x - inner.x, uz = end.z - inner.z, ul = Math.hypot(ux, uz) || 1;
      let best: { p: any; score: number } | null = null;
      for (const o of endsAt.get(end.id) ?? []) {
        if (o.w === w) continue;
        const q = o.w.nodes[o.atStart ? 1 : o.w.nodes.length - 2]; if (!q) continue;
        const vx = q.x - end.x, vz = q.z - end.z, vl = Math.hypot(vx, vz) || 1, turn = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uz * vz) / (ul * vl)))) * 180 / Math.PI;
        if (turn > (cfg.graph.continueMaxTurn ?? 75)) continue;
        const score = turn - (o.w.tags.name && o.w.tags.name === w.tags.name ? 60 : 0) - (o.w.tags.highway === w.tags.highway ? 20 : 0);
        if (!best || score < best.score) best = { p: q, score };
      }
      return best?.p ?? null;
    };
    return { prev: pick(true), next: pick(false) };
  };
  const nodes: MNode[] = [], nodeIdx = new Map<number | string, number>(), segs: Seg[] = [];
  const nodeOf = (key: number | string, p: { x: number; z: number; lat: number; lon: number }, border = false) => {
    let k = nodeIdx.get(key);
    if (k === undefined) { k = nodes.length; nodeIdx.set(key, k); nodes.push({ id: typeof key === 'number' ? key : -nodes.length - 1, x: p.x, z: p.z, lat: p.lat, lon: p.lon, segs: [], border }); }
    return k;
  };
  for (const w of ways) {
    const t = w.tags, base = LINK[t.highway] ?? t.highway, link = !!LINK[t.highway];
    const oneway = t.oneway === 'yes' || t.oneway === '1' || t.oneway === 'true' || t.junction === 'roundabout' || t.junction === 'circular' || (base === 'motorway' && t.oneway !== 'no') ? 1 : t.oneway === '-1' || t.oneway === 'reverse' ? -1 : 0;
    const structure = t.bridge && t.bridge !== 'no' ? 'bridge' : t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'culvert' ? 'tunnel' : 'ground';
    const wn = cfg.graph.minNodeGap ? thinNodes(w.nodes, uses, cfg.graph.minNodeGap) : w.nodes;
    const dense = densify(wn, cfg.graph, cfg.graph.continuous ? ghostsOf(w) : {});
    // the points: OSM's (with their ids and lat/lon) and the curve's; then cut where the way crosses a tile border
    let pts = dense.map(d => ({ x: d.x, z: d.z, orig: d.orig, osm: d.orig ? wn[d.k].id : null, lat: d.orig ? wn[d.k].lat : NaN, lon: d.orig ? wn[d.k].lon : NaN, node: d.orig && ((uses.get(wn[d.k].id) ?? 0) > 1 || d === dense[0] || d === dense[dense.length - 1]) ? wn[d.k] : null as any, border: false }));
    if (cfg.graph.borderNodes) pts = withBorderPoints(pts, tileSize, w.nodes[0]);
    let start = 0;
    for (let q = 1; q < pts.length; q++) {
      const d = pts[q];
      if (!d.node && !d.border) continue;
      const part = pts.slice(start, q + 1), a = pts[start], b = d;
      const xs = part.map(p => p.x), zs = part.map(p => p.z), s = [0];
      for (let k = 1; k < part.length; k++) s.push(s[k - 1] + Math.hypot(xs[k] - xs[k - 1], zs[k] - zs[k - 1]));
      if (s[s.length - 1] < 0.05) { start = q; continue; }
      const keyA = a.border ? `b${a.x.toFixed(3)},${a.z.toFixed(3)},${w.id}` : a.node.id, keyB = b.border ? `b${b.x.toFixed(3)},${b.z.toFixed(3)},${w.id}` : b.node.id;
      const seg: Seg = {
        id: segs.length, way: w.id, osmWay: num(t['osm:way']) ?? w.id, tags: t,
        from: nodeOf(keyA, a.border ? a : a.node, a.border), to: nodeOf(keyB, b.border ? b : b.node, b.border),
        xs, zs, orig: part.map(p => p.orig), osmNodes: part.map(p => p.osm), lat: part.map(p => p.lat), lon: part.map(p => p.lon), s,
        name: t.name ?? null, ref: t.ref ?? null, cls: base, link, rank: RANK[base] ?? 2, oneway, maxspeed: speedKmh(t.maxspeed),
        lanesTag: num(t.lanes), widthTag: num(t.width), structure, layer: num(t.layer) ?? 0, surface: SURFACE[t.surface] ?? (base === 'track' ? 'gravel' : 'tarmac'),
        lit: t.lit === 'yes' || t.lit === '24/7' || t.lit === 'automatic' ? 'yes' : t.lit === 'no' ? 'no' : null,
        roundabout: t.junction === 'roundabout' || t.junction === 'circular',
      };
      segs.push(seg); nodes[seg.from].segs.push(seg.id); nodes[seg.to].segs.push(seg.id);
      start = q;
    }
  }
  // (two segments between the same two places — the same nodes, or two at the same spot: a tile border's, which is each
  // way's own — the same length near enough, on one line: one road given twice)
  {
    const len = (g: Seg) => g.s[g.s.length - 1], best = new Map<string, Seg>(), drop = new Set<Seg>();
    const score = (g: Seg) => Math.abs(g.layer) * 2 + (g.structure !== 'ground' ? 1 : 0) + g.xs.length * 1e-6;
    const at = (k: number) => `${nodes[k].x.toFixed(1)},${nodes[k].z.toFixed(1)}`;
    for (const g of segs) {
      if (g.from === g.to) continue;
      const a = at(g.from), b = at(g.to), k = a < b ? `${a}:${b}` : `${b}:${a}`, o = best.get(k);
      if (!o) { best.set(k, g); continue; }
      if (Math.abs(len(o) - len(g)) > Math.max(1, 0.1 * len(o)) || o.structure !== g.structure) continue;
      const same = (o.from === g.from && o.to === g.to) || (o.from === g.to && o.to === g.from);
      const mid = (x: Seg) => { const k2 = x.xs.length >> 1; return [x.xs[k2], x.zs[k2]]; }, [ax, az] = mid(o), [bx, bz] = mid(g);
      if (Math.hypot(ax - bx, az - bz) > (same ? 3 : 0.5) && o.xs.length > 2 && g.xs.length > 2) continue;
      if (score(g) > score(o)) { drop.add(o); best.set(k, g); } else drop.add(g);
    }
    if (drop.size) {
      const kept = segs.filter(g => !drop.has(g));
      segs.length = 0;
      for (const n of nodes) n.segs = [];
      for (const g of kept) { g.id = segs.length; segs.push(g); nodes[g.from].segs.push(g.id); nodes[g.to].segs.push(g.id); }
    }
  }
  // (a segment that starts and ends at one node — a tiny loop — and nodes nothing uses any more: gone)
  return { nodes, segs, joins };
}

// the points of a polyline with one added wherever it crosses a tile border (x or z a multiple of the tile size),
// each such point a border node; lat/lon interpolated
function withBorderPoints(pts: any[], T: number, ref: any) {
  const out: any[] = [pts[0]];
  for (let q = 1; q < pts.length; q++) {
    const a = pts[q - 1], b = pts[q], cuts: number[] = [];
    for (const [ka, kb] of [[a.x, b.x], [a.z, b.z]]) {
      const lo = Math.min(ka, kb), hi = Math.max(ka, kb);
      for (let m = Math.ceil(lo / T); m * T < hi; m++) if (m * T > lo) { const t = (m * T - ka) / (kb - ka); if (t > 1e-6 && t < 1 - 1e-6) cuts.push(t); }
    }
    cuts.sort((x, y) => x - y);
    for (const t of cuts) {
      const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, orig: false, osm: null, lat: NaN, lon: NaN, node: null, border: true };
      // (exactly on the border in the coordinate it crosses)
      if (Math.abs(p.x / T - Math.round(p.x / T)) < 1e-6) p.x = Math.round(p.x / T) * T;
      if (Math.abs(p.z / T - Math.round(p.z / T)) < 1e-6) p.z = Math.round(p.z / T) * T;
      // (not right on top of one of OSM's own nodes)
      const prev = out[out.length - 1];
      if (Math.hypot(p.x - prev.x, p.z - prev.z) < 0.05 || Math.hypot(p.x - b.x, p.z - b.z) < 0.05) continue;
      out.push(p);
    }
    out.push(b);
  }
  void ref;
  return out;
}
