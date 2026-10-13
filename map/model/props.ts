// Map v4's trees and railings (the road surface model, map/model/), deterministic from coordinates and feature ids:
//  · trees — OSM's single trees and tree rows, woods and parks filled at their density (as Map v3) — each kept only
//    if nothing in the exclusion mask lies under its crown (its crown's radius, not its trunk's: every road surface on
//    every layer and its buffer, the ground under every bridge deck, railways, tunnel portals), and not on a car park
//  · railings — OSM's barrier lines, in pieces of at most `piece` m, each tested along its whole length and its
//    collider's thickness against every road surface at its height (a fence drawn across a street, a wall the road
//    now covers: dropped); and estimated ones (flagged) from the model: both sides of every bridge deck, motorway
//    edges, and road edges with the ground dropping steeply beside them — at the road's visual edge + offset, chained
//    piece to piece with no gaps, never within skipNearJunction of a junction patch, never over another road
//   trees(...) → number[] (x, y, z, scale, kind)   barriers(...) → { [type]: number[] (x0, y0, z0, x1, y1, z1, h, flags) }

import type { OsmData } from '../bake/osmData.ts';
import { rowAt, at } from './geom.ts';

export const ESTIMATED = 1;
const rng = (seed: number) => () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const WALLS = new Set(['wall', 'retaining_wall', 'city_wall', 'parapet', 'jersey_barrier']);
function inRings(x: number, z: number, rings: { x: number; z: number }[][]) {
  let c = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if ((ring[i].z > z) !== (ring[j].z > z) && x < (ring[j].x - ring[i].x) * (z - ring[i].z) / (ring[j].z - ring[i].z) + ring[i].x) c = !c;
  return c;
}

// box: the area's bounds when there are some (the bake's block): woods and parks wholly outside it skipped (each one's
// own random sequence: the trees inside are the same either way)
export function treesV4({ osm, groundAt, onPaved, mask, cfg, v3cfg, inArea, box = null }: { osm: OsmData; groundAt: (x: number, z: number) => number; onPaved: (x: number, z: number) => boolean; mask: any; cfg: any; v3cfg: any; inArea: (x: number, z: number) => boolean; box?: [number, number, number, number] | null }) {
  const T = v3cfg.trees, X = cfg.exclusion, out: number[] = [], stats = { placed: 0, rejected: 0 };
  // (a tree of this scale's crown: the drawn canopy is 0.75 × 4 × scale m round — crownRadius × 4 × scale is checked)
  const ok = (x: number, z: number, s: number) => { if (!inArea(x, z)) return false; const free = !onPaved(x, z) && mask.crownFree(x, z, X.crownRadius * 4 * s); if (!free) stats.rejected++; return free; };
  const add = (x: number, z: number, s: number, kind: number) => { out.push(x, groundAt(x, z), z, s, kind); stats.placed++; };
  for (const p of osm.points) if (p.tags.natural === 'tree') { const R = rng(p.id), s = 0.85 + R() * 0.4; if (ok(p.x, p.z, s)) add(p.x, p.z, s, 0); }
  for (const w of osm.lines) if (w.tags.natural === 'tree_row') {
    const R = rng(w.id);
    for (let q = 0; q + 1 < w.nodes.length; q++) { const a = w.nodes[q], b = w.nodes[q + 1], l = Math.hypot(b.x - a.x, b.z - a.z); for (let s = 0; s < l; s += T.spacing) { const x = a.x + (b.x - a.x) * s / l, z = a.z + (b.z - a.z) * s / l, sc = 0.8 + R() * 0.4; if (ok(x, z, sc)) add(x, z, sc, 0); } }
  }
  for (const a of osm.areas) {
    const kind = a.tags.landuse === 'forest' || a.tags.natural === 'wood' ? 'forest' : a.tags.leisure === 'park' ? 'park' : a.tags.natural === 'scrub' ? 'scrub' : a.tags.landuse === 'cemetery' ? 'cemetery' : a.tags.leisure === 'garden' ? 'garden' : a.tags.leisure === 'golf_course' ? 'golf' : null;
    const d = kind ? T.density[kind] : 0;
    if (!d) continue;
    const step = Math.sqrt(10000 / d);
    const ext = a.parts.map(rings => { let xa = Infinity, za = Infinity, xb = -Infinity, zb = -Infinity; for (const p of rings[0]) { xa = Math.min(xa, p.x); xb = Math.max(xb, p.x); za = Math.min(za, p.z); zb = Math.max(zb, p.z); } return [xa, za, xb, zb]; });
    if (box && ext.every(([xa, za, xb, zb]) => xb + step < box[0] || xa - step > box[2] || zb + step < box[1] || za - step > box[3])) continue;
    const R = rng(a.id);
    for (const [q, rings] of a.parts.entries()) {
      const [xa, za, xb, zb] = ext[q];
      for (let x = Math.floor(xa / step) * step; x < xb; x += step) for (let z = Math.floor(za / step) * step; z < zb; z += step) {
        const tx = x + R() * step, tz = z + R() * step, s = 0.75 + R() * 0.55, conifer = kind === 'forest' && R() < 0.6;
        if (!inArea(tx, tz) || !inRings(tx, tz, rings) || !ok(tx, tz, s)) continue;
        add(tx, tz, s, conifer ? 1 : 0);
      }
    }
  }
  return { trees: out, stats };
}

// inArea: which pieces to make — by each piece's middle (a tile holds the pieces whose middle is in it), so a block of the
// bake makes exactly its own tiles' pieces, each the same as a whole-area bake's; box: the area's bounds, when it has
// some (a quick way past the lines nowhere near it)
export function barriersV4({ osm, model, groundAt, demAt, surface, cfg, v3cfg, inArea, box = null }: { osm: OsmData; model: any; groundAt: (x: number, z: number) => number; demAt: (x: number, z: number) => number; surface: any; cfg: any; v3cfg: any; inArea: (x: number, z: number) => boolean; box?: [number, number, number, number] | null }) {
  const misses = (xs: number[], zs: number[], r: number) => !!box && (Math.max(...xs) + r < box[0] || Math.min(...xs) - r > box[2] || Math.max(...zs) + r < box[1] || Math.min(...zs) - r > box[3]);
  const B = v3cfg.barriers, A = cfg.barriers, out: Record<string, number[]> = {}, stats = { mapped: 0, mappedDropped: 0, estimated: 0, estimatedDropped: 0 };
  const add = (type: string, a: number[], b: number[], h: number, flags: number) => (out[type] ??= []).push(a[0], a[1], a[2], b[0], b[1], b[2], h, flags);
  // (a piece stands on a road surface if any point along it — and either side of it by half its collider's thickness — is
  // over a road surface between its foot and its top)
  const onRoad = (a: number[], b: number[], h: number, thick: number) => {
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]), n = Math.max(2, Math.ceil(L / 0.5)), nx = L ? -(b[2] - a[2]) / L : 0, nz = L ? (b[0] - a[0]) / L : 0, half = thick / 2 + 0.05;
    for (let q = 0; q <= n; q++) {
      const t = q / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
      for (const o of [0, half, -half]) if (surface.heightsAt(x + nx * o, z + nz * o).some((s: any) => s.y > y - 1 && s.y < y + h)) return true;
    }
    return false;
  };
  const thick = (type: string) => Math.max(B.minThickness, B.types[type]?.thickness ?? 0.3);
  // ---- OSM's
  for (const w of osm.lines) {
    const type = w.tags.barrier;
    if (!type || !B.types[type]) continue;
    const T = B.types[type];
    for (let q = 0; q + 1 < w.nodes.length; q++) {
      const a = w.nodes[q], b = w.nodes[q + 1], l = Math.hypot(b.x - a.x, b.z - a.z), parts = Math.max(1, Math.ceil(l / A.piece));
      if (misses([a.x, b.x], [a.z, b.z], 1)) continue;
      for (let p = 0; p < parts; p++) {
        const x0 = a.x + (b.x - a.x) * p / parts, z0 = a.z + (b.z - a.z) * p / parts, x1 = a.x + (b.x - a.x) * (p + 1) / parts, z1 = a.z + (b.z - a.z) * (p + 1) / parts;
        if (!inArea((x0 + x1) / 2, (z0 + z1) / 2)) continue;
        const nx = -(z1 - z0) / (l / parts || 1), nz = (x1 - x0) / (l / parts || 1), reach = WALLS.has(type) ? [1.2, 2.5, 4] : [1.2];
        const end = (x: number, z: number) => { const line = groundAt(x, z), sides = reach.flatMap(r => [groundAt(x + nx * r, z + nz * r), groundAt(x - nx * r, z - nz * r)]); return { foot: WALLS.has(type) ? Math.min(line, sides[0], sides[1]) : line, top: Math.max(line, ...sides) }; };
        const E0 = end(x0, z0), E1 = end(x1, z1), h = Math.min(T.height + 4, Math.max(E0.top - E0.foot, E1.top - E1.foot) + T.height);
        const pa = [x0, E0.foot, z0], pb = [x1, E1.foot, z1];
        if (onRoad(pa, pb, h, thick(type))) { stats.mappedDropped++; continue; }
        add(type, pa, pb, h, 0); stats.mapped++;
      }
    }
  }
  // ---- estimated, from the model
  for (const g of model.segs) {
    if (g.internal) continue;
    const L = g.s[g.s.length - 1], motorway = g.cls === 'motorway' && !g.link, bridge = g.structure === 'bridge';
    if (g.structure === 'tunnel') continue;
    const s0 = Math.max(0, g.trim0) + (g.trim0 > 0 ? A.skipNearJunction : 0), s1 = L - Math.max(0, g.trim1) - (g.trim1 > 0 ? A.skipNearJunction : 0);
    if (s1 - s0 < (bridge ? 2 : A.minRun)) continue;
    if (misses(g.xs, g.zs, Math.max(...g.hwL, ...g.hwR) + A.offset + 2)) continue;
    // (the rows along it: its points between the trims, and the trims themselves)
    const ss = [s0, ...g.s.filter((v: number) => v > s0 + 0.5 && v < s1 - 0.5), s1];
    // (long pieces split: a railing follows the ground)
    const rows: number[] = [];
    for (let q = 0; q + 1 < ss.length; q++) { const n = Math.max(1, Math.ceil((ss[q + 1] - ss[q]) / A.piece)); for (let p = 0; p < n; p++) rows.push(ss[q] + (ss[q + 1] - ss[q]) * p / n); }
    rows.push(s1);
    for (const side of [1, -1]) {
      const kinds = rows.map(s => {
        if (bridge) return 'parapet';
        if (motorway) return 'guard_rail';
        const r = rowAt(g, s), hw = side > 0 ? r.hwL : r.hwR, [ex, ez] = at(r, side * (hw + A.reach)), y = sampleH(g, s);
        return y - demAt(ex, ez) > A.drop ? 'guard_rail' : null;
      });
      let k0 = 0;
      for (let k = 1; k <= rows.length; k++) {
        if (k < rows.length && kinds[k] === kinds[k0]) continue;
        const type = kinds[k0], run = rows[k - 1] - rows[k0];
        if (type && k - 1 > k0 && (run >= A.minRun || type === 'parapet')) {
          const edge = (s: number) => { const r = rowAt(g, s), hw = side > 0 ? r.hwL : r.hwR, [x, z] = at(r, side * (hw + A.offset)), top = sampleH(g, s) - 0.02 * hw; return [x, bridge ? top : Math.max(groundAt(x, z), top - 0.3), z]; };
          for (let q = k0; q < k - 1; q++) {
            const a = edge(rows[q]), b = edge(rows[q + 1]);
            if (!inArea((a[0] + b[0]) / 2, (a[2] + b[2]) / 2)) continue;
            if (onRoad(a, b, B.types[type].height, thick(type))) { stats.estimatedDropped++; continue; }
            add(type, a, b, B.types[type].height, ESTIMATED); stats.estimated++;
          }
        }
        k0 = k;
      }
    }
  }
  // (by type in a fixed order: a tile's lists the same whichever block made it)
  return { barriers: Object.fromEntries(Object.keys(out).sort().map(k => [k, out[k]])), stats };
}
function sampleH(g: any, s: number) { const S = g.s; let k = 0; while (k + 2 < S.length && S[k + 1] < s) k++; const t = Math.max(0, Math.min(1, (s - S[k]) / ((S[k + 1] - S[k]) || 1))); return g.h[k] + (g.h[k + 1] - g.h[k]) * t; }
