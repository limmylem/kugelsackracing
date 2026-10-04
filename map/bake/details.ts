// Map v3's details, all deterministic (from coordinates and feature ids, never Math.random):
//  · railings, walls and fences — OSM's barrier lines, in pieces of at most 4 m on the ground, as tall as
//    their type above the higher side's ground (walls reaching down to the lower side); and where OSM
//    often lacks them, estimated ones (flag 1): both sides of every bridge, motorway edges and medians,
//    road edges with a steep drop in the elevation data beside them. Pieces: [x0, y0, z0, x1, y1, z1, h, flags].
//  · trees — OSM's single trees and tree rows, and woods and parks filled at their density
//  · street names along the roads, and a sign at each junction of two named roads
//
//   barriers(osm, roads, terrain, cfg) → { [type]: number[] } (world frame)
//   trees(osm, terrain, cfg) → number[] (x, y, z, scale, kind)
//   labels(roads) → { labels: [x, y, z, angle, nameIndex, halfWidth], signs: [x, y, z, angle, name, name], names }

import type { Grid } from '../format/grid.ts';
import type { OsmData } from './osmData.ts';
import { type RNode, type Seg, profileAt } from './roads.ts';
import { sampleGrid } from './terrain.ts';

export const ESTIMATED = 1;
const rng = (seed: number) => () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const WALLS = new Set(['wall', 'retaining_wall', 'city_wall', 'parapet', 'jersey_barrier']);

export function barriers({ osm, nodes, segs, grid, heights, dem, cfg }: { osm: OsmData; nodes: RNode[]; segs: Seg[]; grid: Grid; heights: Float32Array; dem: Float32Array; cfg: any }) {
  const B = cfg.barriers, out: Record<string, number[]> = {};
  const ground = (x: number, z: number) => sampleGrid(grid, heights, x, z);
  const natural = (x: number, z: number) => sampleGrid(grid, dem, x, z);
  const add = (type: string, a: number[], b: number[], h: number, flags: number) => (out[type] ??= []).push(a[0], a[1], a[2], b[0], b[1], b[2], h, flags);
  // the roads' drawn surfaces (wider than many streets are): no railing, wall or fence stands on one
  const RC = 24, roadGrid = new Map<string, [Seg, number][]>();
  for (const g of segs) for (let k = 0; k + 1 < g.xs.length; k++) {
    for (let i = Math.floor(Math.min(g.xs[k], g.xs[k + 1]) / RC); i <= Math.floor(Math.max(g.xs[k], g.xs[k + 1]) / RC); i++) for (let j = Math.floor(Math.min(g.zs[k], g.zs[k + 1]) / RC); j <= Math.floor(Math.max(g.zs[k], g.zs[k + 1]) / RC); j++) { const key = `${i},${j}`; (roadGrid.get(key) ?? roadGrid.set(key, []).get(key)!).push([g, k]); }
  }
  const onOtherRoad = (x: number, z: number, y: number, own: Seg | null) => {
    for (const [o, k] of roadGrid.get(`${Math.floor(x / RC)},${Math.floor(z / RC)}`) ?? []) {
      if (o === own) continue;
      const ax = o.xs[k], az = o.zs[k], dx = o.xs[k + 1] - ax, dz = o.zs[k + 1] - az, L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) > o.width / 2 + 0.3) continue;
      if (Math.abs(o.h[k] + (o.h[k + 1] - o.h[k]) * t - y) < 2.5) return true;
    }
    return false;
  };
  // mapped ones (but not across a road: a fence drawn over a street, a gate's opening, a wall the road's
  // drawn width now covers)
  for (const w of osm.lines) {
    const type = w.tags.barrier;
    if (!type || !B.types[type]) continue;
    const T = B.types[type];
    for (let q = 0; q + 1 < w.nodes.length; q++) {
      const a = w.nodes[q], b = w.nodes[q + 1], l = Math.hypot(b.x - a.x, b.z - a.z), parts = Math.max(1, Math.ceil(l / 4));
      for (let p = 0; p < parts; p++) {
        const x0 = a.x + (b.x - a.x) * p / parts, z0 = a.z + (b.z - a.z) * p / parts, x1 = a.x + (b.x - a.x) * (p + 1) / parts, z1 = a.z + (b.z - a.z) * (p + 1) / parts;
        const nx = -(z1 - z0) / (l / parts || 1), nz = (x1 - x0) / (l / parts || 1), reach = WALLS.has(type) ? [1.2, 2.5, 4] : [1.2];
        const end = (x: number, z: number) => { const line = ground(x, z), sides = reach.flatMap(r => [ground(x + nx * r, z + nz * r), ground(x - nx * r, z - nz * r)]); return { foot: WALLS.has(type) ? Math.min(line, sides[0], sides[1]) : line, top: Math.max(line, ...sides) }; };
        const A = end(x0, z0), Bb = end(x1, z1), h = Math.min(T.height + 4, Math.max(A.top - A.foot, Bb.top - Bb.foot) + T.height);
        if (onOtherRoad((x0 + x1) / 2, (z0 + z1) / 2, (A.foot + Bb.foot) / 2, null)) continue;
        add(type, [x0, A.foot, z0], [x1, Bb.foot, z1], h, 0);
      }
    }
  }
  // estimated ones, along road edges — never standing on another road (where a slip road or another
  // bridge joins, the edge runs across its lanes: no wall there)
  const A = B.auto, junctionAt = nodes.map(n => n.segs.length >= 3);

  for (const g of segs) {
    const L = g.s[g.s.length - 1];
    if (L < A.minRun && g.structure !== 'bridge') continue;
    const motorway = A.motorways.includes(g.cls) && !g.link;
    for (const side of [-1, 1]) {
      // which kind each point gets (or none)
      const kinds = g.xs.map((x, k) => {
        const s = g.s[k], nearJ = (junctionAt[g.from] && s < A.skipNearJunction) || (junctionAt[g.to] && L - s < A.skipNearJunction);
        if (g.structure === 'bridge') return A.bridges ? 'parapet' : null;
        if (g.structure === 'tunnel' || nearJ) return null;
        if (motorway) return 'guard_rail';
        const a = Math.max(0, k - 1), b = Math.min(g.xs.length - 1, k + 1), dx = g.xs[b] - g.xs[a], dz = g.zs[b] - g.zs[a], l = Math.hypot(dx, dz) || 1;
        const ex = x - dz / l * side * (g.width / 2 + A.reach), ez = g.zs[k] + dx / l * side * (g.width / 2 + A.reach);
        return g.h[k] - natural(ex, ez) > A.drop ? 'guard_rail' : null;
      });
      // runs of the same kind, long enough
      let k0 = 0;
      for (let k = 1; k <= g.xs.length; k++) {
        if (k < g.xs.length && kinds[k] === kinds[k0]) continue;
        const type = kinds[k0], run = g.s[k - 1] - g.s[k0];
        if (type && k - 1 > k0 && (run >= A.minRun || type === 'parapet')) {
          const edge = (q: number) => {
            const a = Math.max(0, q - 1), b = Math.min(g.xs.length - 1, q + 1), dx = g.xs[b] - g.xs[a], dz = g.zs[b] - g.zs[a], l = Math.hypot(dx, dz) || 1, o = g.width / 2 + A.offset;
            const x = g.xs[q] - dz / l * side * o, z = g.zs[q] + dx / l * side * o, y = g.structure === 'bridge' ? g.h[q] - 0.02 * g.width / 2 : Math.max(ground(x, z), g.h[q] - 0.3);
            return [x, y, z];
          };
          for (let q = k0; q < k - 1; q++) { const a = edge(q), b = edge(q + 1); if (!onOtherRoad((a[0] + b[0]) / 2, (a[2] + b[2]) / 2, (a[1] + b[1]) / 2, g)) add(type, a, b, B.types[type].height, ESTIMATED); }
        }
        k0 = k;
      }
    }
  }
  return out;
}

export function trees({ osm, grid, heights, classes, hardRoad, segs = [], cfg }: { osm: OsmData; grid: Grid; heights: Float32Array; classes: Uint8Array; hardRoad: Uint8Array; segs?: Seg[]; cfg: any }) {
  const T = cfg.trees, out: number[] = [], ground = (x: number, z: number) => sampleGrid(grid, heights, x, z);
  // (never on a road: off its surface in the grid, and clear of its drawn width — wider than the street
  // often is — by a metre; a tree on a bridge's or tunnel's line is under or over it: those don't count)
  const RC = 24, roadGrid = new Map<string, [number, number, number, number, number][]>();
  for (const g of segs) if (g.structure === 'ground') for (let k = 0; k + 1 < g.xs.length; k++) {
    const p: [number, number, number, number, number] = [g.xs[k], g.zs[k], g.xs[k + 1], g.zs[k + 1], g.width / 2 + 1];
    for (let i = Math.floor((Math.min(p[0], p[2]) - p[4]) / RC); i <= Math.floor((Math.max(p[0], p[2]) + p[4]) / RC); i++) for (let j = Math.floor((Math.min(p[1], p[3]) - p[4]) / RC); j <= Math.floor((Math.max(p[1], p[3]) + p[4]) / RC); j++) { const key = `${i},${j}`; (roadGrid.get(key) ?? roadGrid.set(key, []).get(key)!).push(p); }
  }
  const onRoad = (x: number, z: number) => (roadGrid.get(`${Math.floor(x / RC)},${Math.floor(z / RC)}`) ?? []).some(([ax, az, bx, bz, r]) => { const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); return Math.hypot(x - ax - dx * t, z - az - dz * t) < r; });
  const free = (x: number, z: number) => { const c = Math.round((x - grid.x0) / grid.cell), r = Math.round((z - grid.z0) / grid.cell); if (c < 0 || r < 0 || c >= grid.W || r >= grid.H) return false; const k = r * grid.W + c; return !hardRoad[k] && !onRoad(x, z); };
  for (const p of osm.points) if (p.tags.natural === 'tree' && free(p.x, p.z)) { const R = rng(p.id); out.push(p.x, ground(p.x, p.z), p.z, 0.85 + R() * 0.4, 0); }
  for (const w of osm.lines) if (w.tags.natural === 'tree_row') {
    const R = rng(w.id);
    for (let q = 0; q + 1 < w.nodes.length; q++) { const a = w.nodes[q], b = w.nodes[q + 1], l = Math.hypot(b.x - a.x, b.z - a.z); for (let s = 0; s < l; s += T.spacing) { const x = a.x + (b.x - a.x) * s / l, z = a.z + (b.z - a.z) * s / l; if (free(x, z)) out.push(x, ground(x, z), z, 0.8 + R() * 0.4, 0); } }
  }
  // woods and parks: a cell grid over each, a tree in a cell when its hash says so (density per hectare)
  for (const a of osm.areas) {
    const kind = a.tags.landuse === 'forest' || a.tags.natural === 'wood' ? 'forest' : a.tags.leisure === 'park' ? 'park' : a.tags.natural === 'scrub' ? 'scrub' : a.tags.landuse === 'cemetery' ? 'cemetery' : a.tags.leisure === 'garden' ? 'garden' : a.tags.leisure === 'golf_course' ? 'golf' : null;
    const d = kind ? T.density[kind] : 0;
    if (!d) continue;
    const step = Math.sqrt(10000 / d), R = rng(a.id);
    for (const rings of a.parts) {
      let xa = Infinity, za = Infinity, xb = -Infinity, zb = -Infinity;
      for (const p of rings[0]) { xa = Math.min(xa, p.x); xb = Math.max(xb, p.x); za = Math.min(za, p.z); zb = Math.max(zb, p.z); }
      for (let x = Math.floor(xa / step) * step; x < xb; x += step) for (let z = Math.floor(za / step) * step; z < zb; z += step) {
        const tx = x + R() * step, tz = z + R() * step, s = 0.75 + R() * 0.55, conifer = kind === 'forest' && R() < 0.6;
        if (!inRings(tx, tz, rings) || !free(tx, tz)) continue;
        out.push(tx, ground(tx, tz), tz, s, conifer ? 1 : 0);
      }
    }
  }
  return out;
}
function inRings(x: number, z: number, rings: { x: number; z: number }[][]) {
  let c = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if ((ring[i].z > z) !== (ring[j].z > z) && x < (ring[j].x - ring[i].x) * (z - ring[i].z) / (ring[j].z - ring[i].z) + ring[i].x) c = !c;
  return c;
}

export function labels({ nodes, segs, cfg }: { nodes: RNode[]; segs: Seg[]; cfg: any }) {
  const names: string[] = [], nameOf = (s: string) => { let k = names.indexOf(s); if (k < 0) { k = names.length; names.push(s); } return k; };
  const labels: number[] = [], signs: number[] = [];
  // (a way's name along it every so often, on its longer segments)
  for (const g of segs) {
    if (!g.name || g.structure === 'tunnel') continue;
    const L = g.s[g.s.length - 1];
    if (L < cfg.labels.minLength) continue;
    for (let at = Math.min(L / 2, cfg.labels.every / 2); at < L; at += cfg.labels.every) {
      let k = 1; while (k < g.s.length - 1 && g.s[k] < at) k++;
      const dx = g.xs[k] - g.xs[k - 1], dz = g.zs[k] - g.zs[k - 1], t = (at - g.s[k - 1]) / ((g.s[k] - g.s[k - 1]) || 1);
      labels.push(g.xs[k - 1] + dx * t, profileAt(g, at) + 0.04, g.zs[k - 1] + dz * t, Math.atan2(-dz, dx), nameOf(g.name), g.width / 2);
    }
  }
  for (const n of nodes) {
    if (n.segs.length < 3) continue;
    const named = [...new Map(n.segs.map(i => segs[i]).filter(g => g.name).sort((a, b) => b.rank - a.rank).map(g => [g.name, g])).values()];
    if (named.length < 2) continue;
    const g = named[0];
    const hw = Math.max(...n.segs.map(i => segs[i].width / 2)) + 1.6;
    const a = Math.atan2(g.zs[1] - g.zs[0], g.xs[1] - g.xs[0]);
    const x = n.x + Math.cos(a + Math.PI / 4) * hw * 1.2, z = n.z + Math.sin(a + Math.PI / 4) * hw * 1.2;
    signs.push(x, n.h, z, -a, nameOf(named[0].name!), nameOf(named[1].name!));
  }
  return { labels, signs, names };
}
