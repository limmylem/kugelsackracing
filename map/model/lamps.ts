// Map v4's street lamps (the road surface model, map/model/): where they stand, from OSM first and the model second.
//  1. OSM's lamps (highway=street_lamp, man_made=street_lamp): each where it's mapped — unless it falls on a road
//     surface or under a deck (the data's wrong there: dropped)
//  2. estimated ones, flagged, along every lit road (lit=yes; or untagged in a built-up area — its ground is
//     residential, commercial, industrial or a car park — on a lit class; never lit=no, never service or track):
//     every spacing m at the kerb (offset m outside the visual edge), both sides staggered on wide roads, one side
//     (the same side all along a road) on narrow ones; motorways at their spacing; tunnels continuous on the wall;
//     one at a corner of every junction of a lit road; two at each mapped crossing. A mapped lamp within mappedRadius
//     stands in for an estimated one. Never in a lane or on any road surface (the surface index), never under a deck
//     (the exclusion mask)
// Each lamp: [x, y (its foot), z, height, yaw (the way its arm points: over the road), flags (1 estimated, 2 tunnel,
// 4 junction), and the pool of light under its head: its height there (the road's, else the ground's) and that surface's
// slope (dy/dx, dy/dz: the pool lies on it)] — the tiles' `lamps` list.
//
//   const L = placeLamps({ model, osm, cfg, surface (surfaceIndex), mask (exclusionMask), groundAt, classAt })
//   L.lamps (flat, stride 6), L.stats

import type { OsmData } from '../bake/osmData.ts';
import { rowAt, at } from './geom.ts';
import { MASK } from './mask.ts';

export const LAMP_STRIDE = 9, LAMP_ESTIMATED = 1, LAMP_TUNNEL = 2, LAMP_JUNCTION = 4;

// is a road lit (the rule the lamps follow): lit=yes and tunnels; never lit=no or the unlit classes; motorways and the
// always-lit classes everywhere; the other urban classes where the ground at its middle is built up
export function roadLit(g: any, cfg: any, classAt: (x: number, z: number) => string) {
  const Lc = cfg.lamps, cls = g.link ? 'link' : g.cls;
  if (g.lit === 'no' || Lc.unlitClasses.includes(cls)) return false;
  if (g.lit === 'yes' || g.structure === 'tunnel' || Lc.motorwayClasses.includes(cls) || (Lc.alwaysLitClasses ?? []).includes(cls)) return true;
  if (!Lc.urbanClasses.includes(cls)) return false;
  const m = rowAt(g, g.s[g.s.length - 1] / 2);
  return ['residential', 'commercial', 'industrial', 'parking'].includes(classAt(m.x, m.z));
}

// box: the area's bounds when it has some (the bake's block): OSM's lamps further than 50 m from it skipped (a mapped
// lamp stands in for estimated ones mappedRadius m round it, no further); the counts only of the lamps inside it
export function placeLamps({ model, osm, cfg, surface, mask, groundAt, classAt, box = null }: { model: any; osm: OsmData; cfg: any; surface: any; mask: any; groundAt: (x: number, z: number) => number; classAt: (x: number, z: number) => string; box?: [number, number, number, number] | null }) {
  const inBox = (x: number, z: number, r = 0) => !box || (x >= box[0] - r && x < box[2] + r && z >= box[1] - r && z < box[3] + r);
  const Lc = cfg.lamps, out: number[] = [], stats = { mapped: 0, mappedDropped: 0, estimated: 0, junction: 0, tunnel: 0, crossing: 0, rejected: 0 };
  // (lamps already placed, on a grid: for the mapped-stands-in and spacing checks)
  const C = 32, grid = new Map<string, number[]>();
  const put = (x: number, y: number, z: number, h: number, yaw: number, flags: number) => { out.push(x, y, z, h, yaw, flags, y, 0, 0); const k = `${Math.floor(x / C)},${Math.floor(z / C)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(out.length - LAMP_STRIDE); };
  const near = (x: number, z: number, r: number, onlyMapped = false) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const k of grid.get(`${Math.floor(x / C) + a},${Math.floor(z / C) + b}`) ?? []) { if (onlyMapped && out[k + 5] & LAMP_ESTIMATED) continue; if (Math.hypot(out[k] - x, out[k + 2] - z) < r) return true; } return false; };
  // (a lamp's foot: never on a road surface — a little clearance for the pole — and never under a deck)
  const clear = (x: number, z: number, onDeck = false) => !surface.near(x, z, 0.25) && (onDeck || !(mask.at(x, z) & MASK.deck));
  // ---- 1. OSM's
  for (const p of osm.points) {
    if (p.tags.highway !== 'street_lamp' && p.tags.man_made !== 'street_lamp') continue;
    if (!inBox(p.x, p.z, 50)) continue;
    if (!clear(p.x, p.z)) { if (inBox(p.x, p.z)) stats.mappedDropped++; continue; }
    // (its arm over the nearest road: towards it)
    put(p.x, groundAt(p.x, p.z), p.z, Lc.height, nearestRoadYaw(model, p.x, p.z), 0); if (inBox(p.x, p.z)) stats.mapped++;
  }
  // ---- 2. estimated, along each lit road
  const motorway = new Set(Lc.motorwayClasses), litSeg = new Map<number, boolean>();
  for (const g of model.segs) {
    if (g.internal) continue;
    const cls = g.link ? 'link' : g.cls, L = g.s[g.s.length - 1], lit = roadLit(g, cfg, classAt);
    litSeg.set(g.id, lit);
    if (!lit) continue;
    const tunnel = g.structure === 'tunnel', bridge = g.structure === 'bridge';
    const spacing = tunnel ? Lc.spacing.tunnel : motorway.has(cls) ? Lc.spacing.motorway : Lc.spacing.urban;
    const s0 = Math.max(0, g.trim0) + Lc.skipNearJunction, s1 = L - Math.max(0, g.trim1) - Lc.skipNearJunction;
    if (s1 <= s0) continue;
    const wide = g.visual >= Lc.bothSidesWidth || tunnel, side0 = (g.id % 2) ? 1 : -1;
    // (spaced along the road from a phase its id sets, so roads joined end to end don't bunch their lamps)
    const phase = ((g.id * 7919) % 1000) / 1000 * spacing;
    let n = 0;
    for (let s = s0 + phase; s <= s1; s += wide && !tunnel ? spacing / 2 : spacing, n++) {
      const sides = tunnel ? [1, -1] : [wide ? (n % 2 ? 1 : -1) : side0];
      for (const side of sides) {
        const r = rowAt(g, s);
        // (where the kerb's taken — another road beside it, a ramp — a little further out, then the other side)
        let x = NaN, z = NaN, at_ = side;
        const tries: [number, number][] = tunnel ? [[side, 0.15]] : [[side, Lc.offset], [side, Lc.offset + 1], [side, Lc.offset + 2], [-side, Lc.offset], [-side, Lc.offset + 1]];
        for (const [sd, off] of tries) { const hw2 = sd > 0 ? r.hwL : r.hwR, p = at(r, sd * (hw2 + off)); if (clear(p[0], p[1], bridge)) { x = p[0]; z = p[1]; at_ = sd; break; } }
        if (Number.isNaN(x)) { stats.rejected++; continue; }
        if (near(x, z, Lc.mappedRadius, true)) continue;
        const y = bridge || tunnel ? sampleSurface(g, s, at_ * (at_ > 0 ? r.hwL : r.hwR)) : groundAt(x, z);
        // (the arm points over the road: from the lamp back across)
        const yaw = Math.atan2(-at_ * r.nx, -at_ * r.nz);
        put(x, y, z, tunnel ? Lc.tunnelHeight : Lc.height, yaw, LAMP_ESTIMATED | (tunnel ? LAMP_TUNNEL : 0));
        if (inBox(x, z)) tunnel ? stats.tunnel++ : stats.estimated++;
      }
    }
  }
  // ---- junctions: one at a corner of each junction of a lit road (outside its first arm's trimmed end, on the left)
  for (const c of model.clusters) {
    const lit = c.arms.filter((A: any) => litSeg.get(A.seg.id));
    if (!lit.length) continue;
    // (two corners on a big junction)
    for (const A of lit.slice(0, lit.length >= 4 ? 2 : 1)) {
      const g = A.seg, s = A.atStart ? A.trim : g.s[g.s.length - 1] - A.trim, r = rowAt(g, s), side = A.atStart ? 1 : -1, hw = side > 0 ? r.hwL : r.hwR;
      const [x, z] = at(r, side * (hw + Lc.offset));
      if (near(x, z, 6) || !clear(x, z)) continue;
      put(x, groundAt(x, z), z, Lc.height, Math.atan2(-side * r.nx, -side * r.nz), LAMP_ESTIMATED | LAMP_JUNCTION); if (inBox(x, z)) stats.junction++;
    }
  }
  // ---- crossings: a lamp each side of every mapped crossing on a road
  const crossings = new Set(osm.points.filter(p => p.tags.highway === 'crossing').map(p => p.id));
  for (const g of model.segs) {
    if (g.internal) continue;
    for (let k = 0; k < g.xs.length; k++) {
      const id = g.osmNodes[k];
      if (id == null || !crossings.has(id)) continue;
      const r = rowAt(g, g.s[k]);
      for (const side of [1, -1]) {
        const hw = side > 0 ? r.hwL : r.hwR, [x, z] = at(r, side * (hw + Lc.offset));
        if (near(x, z, 4) || !clear(x, z)) continue;
        put(x, groundAt(x, z), z, Lc.height, Math.atan2(-side * r.nx, -side * r.nz), LAMP_ESTIMATED); if (inBox(x, z)) stats.crossing++;
      }
    }
  }
  // ---- each one's pool of light: under its head, on the road there (the surface nearest its foot's height, a plane
  // through it and four points round it), else on the ground
  for (let k = 0; k < out.length; k += LAMP_STRIDE) {
    const hx = out[k] + Math.sin(out[k + 4]) * Lc.arm, hz = out[k + 2] + Math.cos(out[k + 4]) * Lc.arm, foot = out[k + 1];
    const roadAt = (x: number, z: number, near: number) => { let best: number | null = null; for (const h of surface.heightsAt(x, z)) if (best === null || Math.abs(h.y - near) < Math.abs(best - near)) best = h.y; return best; };
    // (a lamp set back from the kerb: the road its light reaches, along its arm's way — the pool lies at that road's
    // height, so the road doesn't hide it)
    let y0: number | null = null, px = hx, pz = hz;
    for (let t = 0; t <= Lc.poolRadius * 0.6 && y0 === null; t += 0.5) { px = hx + Math.sin(out[k + 4]) * t; pz = hz + Math.cos(out[k + 4]) * t; y0 = roadAt(px, pz, foot + 0.5); }
    if (y0 === null) { out[k + 6] = groundAt(hx, hz); continue; }
    const d = Lc.poolRadius / 2, at2 = (dx: number, dz: number) => roadAt(px + dx, pz + dz, y0!);
    const xa = at2(d, 0), xb = at2(-d, 0), za = at2(0, d), zb = at2(0, -d);
    const gx = xa !== null && xb !== null ? (xa - xb) / (2 * d) : xa !== null ? (xa - y0) / d : xb !== null ? (y0 - xb) / d : 0;
    const gz = za !== null && zb !== null ? (za - zb) / (2 * d) : za !== null ? (za - y0) / d : zb !== null ? (y0 - zb) / d : 0;
    const sx = Math.max(-0.3, Math.min(0.3, gx)), sz = Math.max(-0.3, Math.min(0.3, gz));
    // (the plane's height under the head, where the pool's middle is)
    out[k + 6] = y0 + sx * (hx - px) + sz * (hz - pz); out[k + 7] = sx; out[k + 8] = sz;
  }
  // (and which roads the rule lit: the tests measure the lighting along those)
  return { lamps: out, stats, lit: litSeg };
}

// a road's surface height at s, off m to its left (its profile less camber: near enough for a lamp's foot on a deck)
function sampleSurface(g: any, s: number, off: number) {
  const S = g.s; let k = 0; while (k + 2 < S.length && S[k + 1] < s) k++;
  const t = Math.max(0, Math.min(1, (s - S[k]) / ((S[k + 1] - S[k]) || 1)));
  return g.h[k] + (g.h[k + 1] - g.h[k]) * t - 0.02 * Math.abs(off);
}
// the direction (yaw, as three.js turns about y: 0 along +z) from a point to the nearest road centre line
function nearestRoadYaw(model: any, x: number, z: number) {
  let best = Infinity, yaw = 0;
  const idx = (model.__segGrid ??= (() => { const G = new Map<string, [any, number][]>(); for (const g of model.segs) for (let k = 0; k + 1 < g.xs.length; k++) { const key = `${Math.floor(g.xs[k] / 40)},${Math.floor(g.zs[k] / 40)}`; (G.get(key) ?? G.set(key, []).get(key)!).push([g, k]); } return G; })());
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const [g, k] of idx.get(`${Math.floor(x / 40) + a},${Math.floor(z / 40) + b}`) ?? []) {
    const ax = g.xs[k], az = g.zs[k], dx = g.xs[k + 1] - ax, dz = g.zs[k + 1] - az, L2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)), px = ax + dx * t, pz = az + dz * t, d = Math.hypot(px - x, pz - z);
    if (d < best) { best = d; yaw = Math.atan2(px - x, pz - z); }
  }
  return yaw;
}
