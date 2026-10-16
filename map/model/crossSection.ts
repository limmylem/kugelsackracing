// Map v5's road cross-section (Step 2; MAP_README.md, 'Footpaths, kerbs and verges'): each side of a road, out from
// its drawn edge — kerb | verge | footpath | the property's edge — as part of the road surface model's mesh, so the
// terrain is shaped under all of it, the tyres know each piece's surface, and the tiles cut it like the road.
//
//  1. planCrossSections: each road side's plan (seg.xsec { L, R }): mapped sidewalks first (footway=sidewalk running
//     alongside within sidewalkSnap m: the footpath where it is, the road never moved), then the road's own tags
//     (sidewalk=no / separate / left / right / both), then the region style pack's default for its class — urban
//     sides only (urbanBuildings buildings within urbanReach m on that side), never on motorways, links, service
//     roads or tracks. A side where buildings stand within shopfrontWithin m of the kerb is paved to their walls (a
//     shopping street). Mapped, tagged or estimated: each side says which.
//  2. buildBands: the bands themselves, for a block of the bake. The road surface's own outline (its mesh's boundary
//     edges — exact, so the kerb's foot is the road's edge vertex for vertex, corners and all) is offset outwards
//     by each side's widths: a bevelled kerb face kerbHeight high over kerbBevel (drivable, nothing for a wheel to
//     catch on), its flat top, the verge, the footpath. Junction corners wrap with the road's own kerb round. The
//     pieces are joined (Clipper), the road itself taken out of them (nothing in a lane), the footpath out of the
//     verge, buildings out of both — then cut into cells of `cell` m (each cell's the same whichever block builds it)
//     and triangulated. Heights: the road edge's nearest point, plus the kerb (lowered to nothing within lowerAt m of
//     a crossing or a driveway's mouth, over lowerRamp m), plus the footpath's crossfall. A hole in the road no bigger
//     than islands.maxArea m² — a roundabout's middle, a junction's traffic island — is a raised island: a garden bed
//     behind the kerb (a roundabout's: mulch, low plants, a tree) or concrete. Skirts hang under the bands' outer
//     edges (drawn only).
//
//   planCrossSections({ segs, osm, buildings, style }) → stats      (sets seg.xsec)
//   buildBands({ mesh, segs, cells, style, cfg, buildings, lowerAt: [[x, z]…] }) → { mesh: Mesh (world, part per
//   triangle), plants: [x, y, z, scale, kind]…, stats }

import * as Clipper from 'clipper2-js';
import type { Seg } from './graph.ts';
import { triangulatePatch } from './topology.ts';
import { SURFACES, welder } from './surface.ts';
import type { Mesh } from './surface.ts';

export const PARTS = { road: 0, kerb: 1, verge: 2, footpath: 3, island: 4, garden: 5 } as const;
export interface Side { kerb: boolean; verge: number; footpath: number; paved: boolean; source: 'mapped' | 'tagged' | 'estimated' | 'none' }

const hex = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const smooth01 = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const NO_BANDS = new Set(['motorway', 'service', 'track']);
const ISLAND_SIDE: Side = { kerb: true, verge: 0, footpath: 0, paved: false, source: 'estimated' };
const meets = (b: number[], c: number[]) => b[0] <= c[2] && b[2] >= c[0] && b[1] <= c[3] && b[3] >= c[1];
const ringArea = (r: number[][]) => { let a = 0; for (let q = 0; q < r.length; q++) { const p = r[q], n = r[(q + 1) % r.length]; a += p[0] * n[1] - n[0] * p[1]; } return a / 2; };
// a ring cut to a box (Sutherland–Hodgman: a ring that leaves the box and comes back gets an edge along the box's side
// between — no area, which the joins and the triangulation drop)
function clipRing(ring: number[][], b: number[]) {
  let pts = ring;
  const sides: [(p: number[]) => boolean, (p: number[], q: number[]) => number[]][] = [
    [p => p[0] >= b[0], (p, q) => [b[0], p[1] + (q[1] - p[1]) * (b[0] - p[0]) / (q[0] - p[0])]],
    [p => p[0] <= b[2], (p, q) => [b[2], p[1] + (q[1] - p[1]) * (b[2] - p[0]) / (q[0] - p[0])]],
    [p => p[1] >= b[1], (p, q) => [p[0] + (q[0] - p[0]) * (b[1] - p[1]) / (q[1] - p[1]), b[1]]],
    [p => p[1] <= b[3], (p, q) => [p[0] + (q[0] - p[0]) * (b[3] - p[1]) / (q[1] - p[1]), b[3]]],
  ];
  for (const [inside, cut] of sides) {
    if (!pts.length) break;
    const out: number[][] = [];
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k], q = pts[(k + 1) % pts.length], pi = inside(p), qi = inside(q);
      if (pi) out.push(p);
      if (pi !== qi) out.push(cut(p, q));
    }
    pts = out;
  }
  return pts;
}
const insidePts = (poly: number[][], x: number, z: number) => { let c = false; for (let k = 0, a = poly[poly.length - 1]; k < poly.length; a = poly[k++]) { const b = poly[k]; if ((b[1] > z) !== (a[1] > z) && x < (a[0] - b[0]) * (z - b[1]) / (a[1] - b[1]) + b[0]) c = !c; } return c; };

// segments' centre-line pieces by cell: the nearest road to a point (its side: + left). (A junction's internal
// segments too, withInternal: a small roundabout's ring is one junction's)
function segIndex(segs: Seg[], C = 16, withInternal = false) {
  const grid = new Map<number, number[]>(), key = (i: number, j: number) => (i + 50000) * 100000 + j + 50000, pieces: [Seg, number][] = [];
  for (const g of segs) {
    if (g.internal && !withInternal) continue;
    for (let k = 0; k + 1 < g.xs.length; k++) {
      const id = pieces.length; pieces.push([g, k]);
      for (let i = Math.floor(Math.min(g.xs[k], g.xs[k + 1]) / C); i <= Math.floor(Math.max(g.xs[k], g.xs[k + 1]) / C); i++) for (let j = Math.floor(Math.min(g.zs[k], g.zs[k + 1]) / C); j <= Math.floor(Math.max(g.zs[k], g.zs[k + 1]) / C); j++) (grid.get(key(i, j)) ?? grid.set(key(i, j), []).get(key(i, j))!).push(id);
    }
  }
  return (x: number, z: number, r: number, dir?: [number, number], minCos = 0.8) => {
    let best: { g: Seg; k: number; t: number; d: number; off: number } | null = null;
    const seen = new Set<number>();
    for (let i = Math.floor((x - r) / C); i <= Math.floor((x + r) / C); i++) for (let j = Math.floor((z - r) / C); j <= Math.floor((z + r) / C); j++) for (const id of grid.get(key(i, j)) ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      const [g, k] = pieces[id], ax = g.xs[k], az = g.zs[k], dx = g.xs[k + 1] - ax, dz = g.zs[k + 1] - az, L = Math.hypot(dx, dz);
      if (L < 1e-6) continue;
      if (dir && Math.abs((dx * dir[0] + dz * dir[1]) / L) < minCos) continue;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (L * L))), px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
      if (d > r || (best && d >= best.d)) continue;
      best = { g, k, t, d, off: ((x - ax) * -dz + (z - az) * dx) / L };
    }
    return best;
  };
}

export function planCrossSections({ segs, osm, buildings, style, classAt = () => 'default' }: { segs: Seg[]; osm: any; buildings: any[]; style: any; classAt?: (x: number, z: number) => string }) {
  const X = style.crossSection, stats = { sides: 0, mapped: 0, tagged: 0, estimated: 0, none: 0, paved: 0, sidewalkPoints: 0 };
  const near = segIndex(segs), wayTags = new Map<number, Record<string, string>>(osm.roads.map((w: any) => [w.id, w.tags]));
  // (buildings' middles and outlines, by 20 m cell: how urban a side is, how close its walls come)
  const BC = 20, bGrid = new Map<number, number[]>(), bKey = (i: number, j: number) => (i + 50000) * 100000 + j + 50000;
  const mids = buildings.map((b: any) => { const r = b.rings[0]; let x = 0, z = 0; for (const p of r) { x += p[0]; z += p[1]; } return [x / r.length, z / r.length]; });
  buildings.forEach((b: any, q: number) => { const r = b.rings[0]; const cells = new Set<number>(); for (const p of r) cells.add(bKey(Math.floor(p[0] / BC), Math.floor(p[1] / BC))); cells.add(bKey(Math.floor(mids[q][0] / BC), Math.floor(mids[q][1] / BC))); for (const c of cells) (bGrid.get(c) ?? bGrid.set(c, []).get(c)!).push(q); });
  const buildingsNear = (x: number, z: number, r: number) => { const out = new Set<number>(); for (let i = Math.floor((x - r) / BC); i <= Math.floor((x + r) / BC); i++) for (let j = Math.floor((z - r) / BC); j <= Math.floor((z + r) / BC); j++) for (const q of bGrid.get(bKey(i, j)) ?? []) out.add(q); return out; };
  // (mapped sidewalks: every few metres along each, the road it runs beside and how far out)
  const mapped = new Map<string, number[]>();
  for (const w of osm.roads) {
    const t = w.tags;
    if (!(t.footway === 'sidewalk' || t.path === 'sidewalk' || (t.highway === 'footway' && t.footway === 'sidewalk'))) continue;
    for (let q = 0; q + 1 < w.nodes.length; q++) {
      const a = w.nodes[q], b = w.nodes[q + 1], L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 0.5) continue;
      const dir: [number, number] = [(b.x - a.x) / L, (b.z - a.z) / L];
      for (let s = 0; s < L; s += 4) {
        const x = a.x + dir[0] * s, z = a.z + dir[1] * s, hit = near(x, z, X.sidewalkSnap, dir);
        if (!hit) continue;
        const key = `${hit.g.id}:${hit.off > 0 ? 'L' : 'R'}`;
        (mapped.get(key) ?? mapped.set(key, []).get(key)!).push(Math.abs(hit.off));
        stats.sidewalkPoints++;
      }
    }
  }
  const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };
  for (const g of segs) {
    if (g.internal) continue;
    const tags = g.tags ?? wayTags.get(g.way) ?? {}, cls = g.link ? 'link' : g.cls, spec = X.byClass[cls] ?? { kerb: false, footpath: 0, verge: 0 };
    const driveway = g.cls === 'service' && (tags.service === 'driveway' || tags.service === 'parking_aisle' || tags.service === 'drive-through');
    (g as any).driveway = driveway;
    const out: any = {};
    for (const sd of ['L', 'R'] as const) {
      stats.sides++;
      const sign = sd === 'L' ? 1 : -1, hw = Math.max(...(sd === 'L' ? g.hwL : g.hwR));
      const none: Side = { kerb: false, verge: 0, footpath: 0, paved: false, source: 'none' };
      if (g.structure !== 'ground' || driveway || NO_BANDS.has(g.cls) || cls === 'link') { out[sd] = none; stats.none++; continue; }
      // (the side's buildings: how many, and how close their walls come to the road's edge — the closest, and the
      // middle of the closest at each place along it)
      let count = 0, wall = Infinity, houses = 0, typed = 0;
      const walls: number[] = [];
      for (let k = 0; k < g.xs.length; k += Math.max(1, Math.floor(g.xs.length / 8))) {
        const nx = g.nx[k], nz = g.nz[k];
        let here = Infinity;
        for (const q of buildingsNear(g.xs[k], g.zs[k], X.urbanReach)) {
          if (buildings[q].props?.b === 'roof' || buildings[q].props?.mh > 0.5) continue;
          const [mx, mz] = mids[q], off = (mx - g.xs[k]) * nx + (mz - g.zs[k]) * nz;
          if (off * sign <= 0 || Math.hypot(mx - g.xs[k], mz - g.zs[k]) > X.urbanReach) continue;
          count++;
          const bt = buildings[q].props?.b;
          if (bt && bt !== 'yes') { typed++; if (X.houseBuildings.includes(bt)) houses++; }
          // (the wall straight out from the road there: the ray along the side's normal, against the building's edges)
          const r = buildings[q].rings[0], ox = g.xs[k], oz = g.zs[k], dx = nx * sign, dz = nz * sign;
          for (let e = 0; e < r.length; e++) {
            const a = r[e], b = r[(e + 1) % r.length], ex = b[0] - a[0], ez = b[1] - a[1], den = dx * ez - dz * ex;
            if (Math.abs(den) < 1e-9) continue;
            const t = ((a[0] - ox) * ez - (a[1] - oz) * ex) / den, u = ((a[0] - ox) * dz - (a[1] - oz) * dx) / den;
            if (t > 0 && u >= 0 && u <= 1) here = Math.min(here, t - hw);
          }
        }
        if (Number.isFinite(here)) { walls.push(here); wall = Math.min(wall, here); }
      }
      walls.sort((p, q) => p - q);
      const typical = walls.length ? walls[walls.length >> 1] : Infinity;
      const urban = count >= X.urbanBuildings;
      // (OSM's left and right are the way's, along it: the model's 'L', along the normal, is its right — map/model/geom.ts)
      const osmSide = sd === 'L' ? 'right' : 'left', sw = tags.sidewalk ?? '', swSide = tags[`sidewalk:${osmSide}`] ?? '';
      const taggedNo = sw === 'no' || sw === 'none' || sw === 'separate' || swSide === 'no' || swSide === 'separate' || ((sw === 'left' || sw === 'right') && sw !== osmSide);
      const taggedYes = sw === 'both' || swSide === 'yes' || sw === osmSide;
      const m = mapped.get(`${g.id}:${sd}`);
      let side: Side;
      const kerbW = X.kerbBevel + X.kerbTop;
      if (m && m.length >= 2) {
        // (the mapped footpath's middle where it's drawn; the verge what's between it and the kerb)
        const off = median(m), fp = Math.max(1, spec.footpath || 1.5), verge = Math.max(0, off - hw - kerbW - fp / 2);
        side = { kerb: true, verge, footpath: fp, paved: false, source: 'mapped' }; stats.mapped++;
      } else if (taggedNo && !taggedYes) {
        side = { kerb: spec.kerb && urban, verge: spec.kerb && urban ? Math.min(spec.verge, 1) : 0, footpath: 0, paved: false, source: 'tagged' }; stats.tagged++;
      } else if (taggedYes || (spec.kerb && urban)) {
        side = { kerb: spec.kerb || taggedYes, verge: spec.verge, footpath: spec.footpath || (taggedYes ? 1.5 : 0), paved: false, source: taggedYes ? 'tagged' : 'estimated' };
        if (taggedYes) stats.tagged++; else stats.estimated++;
      } else { side = none; stats.none++; }
      // (walls close to the kerb in a shopping or business street — the land use there commercial or industrial, or the
      // walls closer than pavedWithin anywhere: paved to them, no verge. Close along the side, typically — the middle of
      // its walls — not one house's veranda or a corner shop: a street of houses with front gardens isn't paved; the
      // footpath then runs to the closest wall, never under one)
      // (the land use behind the walls — the road reserve in front of them has none)
      const mid = g.xs.length >> 1, back = hw + (Number.isFinite(typical) ? typical + 2 : 10), lu = classAt(g.xs[mid] + g.nx[mid] * sign * back, g.zs[mid] + g.nz[mid] * sign * back);
      // (a street of houses — the land use residential, or most of its typed buildings houses — paved only if its walls
      // are typically within pavedWithinHouses m: a terrace's, right behind the footpath)
      const houseSide = lu === 'residential' || (typed > 0 && houses >= typed / 2);
      // (and a side of shops, offices or flats — typed buildings, most not houses — counts as a shopping street wherever
      // the land use isn't mapped)
      const shops = typical < X.shopfrontWithin && (X.pavedLanduse.includes(lu) || (typed > 0 && !houseSide) || typical < (houseSide ? X.pavedWithinHouses : X.pavedWithin));
      if (side.kerb && shops && wall > kerbW + 0.8) { side.paved = true; side.verge = 0; side.footpath = Math.max(side.footpath, wall - kerbW); stats.paved++; }
      out[sd] = side;
    }
    (g as any).xsec = out;
  }
  return stats;
}

// ---------- the bands ----------

const S = 1000;   // (Clipper's integer grid: mm)
const P64 = (pts: number[][]) => { const p = new Clipper.Path64(); for (const [x, z] of pts) p.push(new Clipper.Point64(Math.round(x * S), Math.round(z * S))); return p; };
// (wound positive: under the non-zero rule a piece wound the other way would cancel another where they overlap)
const POS = (pts: number[][]) => { const p = P64(pts); if (Clipper.Clipper.area(p) < 0) p.reverse(); return p; };
// (fresh points every time: Clipper2-js can stall on paths that share points with an operation's output — the same
// workaround as map/model/topology.ts's copyPaths) — and tidied: an operation's output can repeat a point and carry
// rings of no area, and fed back in, those make Clipper2-js drop whole pieces (Rundle Street's footpath, 4 m of it)
const paths = (list: any[]) => {
  const o = new Clipper.Paths64();
  for (const p of list) {
    const c = new Clipper.Path64();
    for (const pt of p) { const l = c[c.length - 1]; if (!l || l.x !== pt.x || l.y !== pt.y) c.push(new Clipper.Point64(pt.x, pt.y)); }
    while (c.length > 1 && c[0].x === c[c.length - 1].x && c[0].y === c[c.length - 1].y) c.pop();
    if (c.length >= 3 && Clipper.Clipper.area(c) !== 0) o.push(c);
  }
  return o;
};
const NZ = Clipper.FillRule.NonZero;

export function buildBands({ mesh: M, outlines, segs, cells, style, cfg, buildings = [], lowerAt = [] }: { mesh: Mesh; outlines: { level: number; rings: number[][][] }[]; segs: Seg[]; cells: [number, number, number, number][]; style: any; cfg: any; buildings?: any[]; lowerAt?: number[][] }) {
  const X = style.crossSection, IS = style.islands, colours = X.colours, P = M.positions, I = M.indices;
  const kerbW = X.kerbBevel + X.kerbTop;
  const stats = { edges: 0, loops: 0, cells: 0, triangles: 0, islands: 0, gardens: 0, plants: 0, kerbM: 0, footpathM2: 0, vergeM2: 0 };
  const out: Mesh & { part: number[] } = { positions: [], colours: [], indices: [], surfaces: [], solid: [], level: [], seg: [], part: [] };
  const plants: number[] = [];
  const nearSeg = segIndex(segs), nearAny = segIndex(segs, 16, true);
  // 1. the road's outline: the boundary edges of its solid triangles (welded by position, mm), every level counted — a
  //    ground road meeting a deck isn't an edge there — and the ground's own (for what the road covers)
  const nV = P.length / 3, wid = new Int32Array(nV), weld = welder(nV);
  for (let v = 0; v < nV; v++) { wid[v] = weld(Math.round(P[v * 3] * 1000), Math.round(P[v * 3 + 1] * 1000), Math.round(P[v * 3 + 2] * 1000)); }
  const W = weld.count(), rep = new Int32Array(W).fill(-1);
  for (let v = 0; v < nV; v++) if (rep[wid[v]] < 0) rep[wid[v]] = v;
  const roadTri = (t: number) => M.solid[t / 3] && (!(M as any).part || !(M as any).part[t / 3]);
  const ekey = (a: number, b: number) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
  const countAll = new Map<number, number>();
  for (let t = 0; t < I.length; t += 3) {
    if (!roadTri(t)) continue;
    for (let e = 0; e < 3; e++) { const k = ekey(wid[I[t + e]], wid[I[t + (e + 1) % 3]]); countAll.set(k, (countAll.get(k) ?? 0) + 1); }
  }
  // (the ground road's edges that are the whole surface's edge — a ground road meeting a deck isn't one — each with the
  // way outwards: away from its triangle's third corner)
  const bandEdges: { a: number; b: number; nx: number; nz: number; seg: number }[] = [];
  for (let t = 0; t < I.length; t += 3) {
    if (!roadTri(t) || M.level[t / 3] !== 0) continue;
    for (let e = 0; e < 3; e++) {
      const va = I[t + e], vb = I[t + (e + 1) % 3], vc = I[t + (e + 2) % 3], a = wid[va], b = wid[vb];
      if (a === b || countAll.get(ekey(a, b)) !== 1) continue;
      const ax = P[va * 3], az = P[va * 3 + 2], dx = P[vb * 3] - ax, dz = P[vb * 3 + 2] - az, L = Math.hypot(dx, dz);
      if (L < 1e-4) continue;
      let nx = -dz / L, nz = dx / L;
      if ((P[vc * 3] - ax) * nx + (P[vc * 3 + 2] - az) * nz > 0) { nx = -nx; nz = -nz; }
      bandEdges.push({ a, b, nx, nz, seg: M.seg[t / 3] });
    }
  }
  // (what the ground road covers: its pieces' outlines joined — a ribbon's edges, a patch's rings, holes and all — and
  // the holes in that: islands, or land between roads)
  const ground = outlines.filter(o => o.level === 0);
  const piecePaths = ground.map(o => o.rings.map((r, q) => { const ccw = ringArea(r) > 0; return P64(q === 0 ? (ccw ? r : r.slice().reverse()) : (ccw ? r.slice().reverse() : r)); }));
  const pieceBox = ground.map(o => { const r = o.rings[0]; return [Math.min(...r.map(p => p[0])), Math.min(...r.map(p => p[1])), Math.max(...r.map(p => p[0])), Math.max(...r.map(p => p[1]))]; });
  // (the pieces near a box, each cut to it first — a ribbon runs far past a cell — then joined)
  const roadIn = (b: number[]) => { const list: any[] = []; ground.forEach((o, q) => { if (!meets(pieceBox[q], b)) return; o.rings.forEach((r, k) => { const c = clipRing(r, b); if (c.length < 3) return; const ccw = ringArea(c) > 0; list.push(P64(k === 0 ? (ccw ? c : c.reverse()) : (ccw ? c.reverse() : c))); }); }); return Clipper.Clipper.Union(paths(list), undefined, NZ); };
  const allRoad = Clipper.Clipper.Union(paths(piecePaths.flat()), undefined, NZ);
  const loops: number[][][] = allRoad.map((p: any) => p.map((pt: any) => [pt.x / S, pt.y / S]));
  stats.loops = loops.length;
  const X0 = (w: number) => P[rep[w] * 3], Y0 = (w: number) => P[rep[w] * 3 + 1], Z0 = (w: number) => P[rep[w] * 3 + 2];
  // (islands: the ground road's holes no bigger than maxArea with no building on them — a roundabout's middle, a
  // junction's traffic island — and the roundabouts among them: round enough, ringed by roads going round them)
  const outerSign = Math.sign(loops.reduce((a, l) => (Math.abs(ringArea(l)) > Math.abs(a) ? ringArea(l) : a), 0)) || 1;
  const islands: { pts: number[][]; box: number[]; area: number; round: boolean; cx: number; cz: number; r: number; ring: number[] }[] = [];
  for (const pts of loops) {
    const A = ringArea(pts);
    if (Math.sign(A) === outerSign || Math.abs(A) > IS.maxArea || Math.abs(A) < 1) continue;
    if (buildings.some((b: any) => { const p = b.rings[0][0]; return insidePts(pts, p[0], p[1]); })) continue;
    let per = 0, cx = 0, cz = 0; for (let q = 0; q < pts.length; q++) { per += Math.hypot(pts[(q + 1) % pts.length][0] - pts[q][0], pts[(q + 1) % pts.length][1] - pts[q][1]); cx += pts[q][0]; cz += pts[q][1]; }
    cx /= pts.length; cz /= pts.length;
    const compact = 4 * Math.PI * Math.abs(A) / (per * per);
    const hits = pts.filter((_, q) => q % 3 === 0).map(p => nearAny(p[0], p[1], 30)).filter(Boolean) as { g: Seg; k: number }[], ring = hits.map(h => h.g);
    // (and circulating: its roads all going round it the same way — clockwise seen from above where traffic keeps
    // left. A block between a divided road's carriageways is ringed by one-way roads going opposite ways)
    // (and curving round it: its roads' directions all the way round, no gap of more than maxTurnGap° between them —
    // two divided roads crossing ring a hole with one-way roads going round it too, but in four directions only)
    // (each ring road's way: its one-way's, else the way it's drawn — OSM draws a roundabout's ring the way its traffic
    // goes, and Overture's copy, with no junction=roundabout, leaves the ring two-way)
    const ways = hits.map(h => { const g = h.g, sd = g.oneway || 1, dx = (g.xs[h.k + 1] - g.xs[h.k]) * sd, dz = (g.zs[h.k + 1] - g.zs[h.k]) * sd; return { turn: Math.sign((g.xs[h.k] - cx) * dz - (g.zs[h.k] - cz) * dx), a: Math.atan2(dz, dx) }; });
    const turning = ways.map(w => w.turn), angles = ways.map(w => w.a).sort((p, q) => p - q);
    const gap = angles.length ? Math.max(...angles.map((a, q) => (q + 1 < angles.length ? angles[q + 1] - a : angles[0] + 2 * Math.PI - a))) * 180 / Math.PI : 360;
    const sense = (style.drivingSide ?? 'left') === 'right' ? -1 : 1, circulates = turning.length > 0 && turning.filter(t => t === sense).length >= turning.length * IS.circulating && gap <= IS.maxTurnGap;
    const round = compact >= IS.roundness && ring.length > 0 && circulates;
    islands.push({ pts, box: [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))], area: Math.abs(A), round, cx, cz, r: Math.sqrt(Math.abs(A) / Math.PI), ring: [...new Set(ring.map(g => g.id))] });
  }
  const inIsland = (x: number, z: number) => islands.some(s => x >= s.box[0] && x <= s.box[2] && z >= s.box[1] && z <= s.box[3] && insidePts(s.pts, x, z));
  // 2. each band edge's side of the road (its nearest segment's), and each outline vertex's widths: the most of its
  //    edges' (a corner between two arms takes the wider)
  const sideOf = (x: number, z: number) => { const h = nearSeg(x, z, 30); if (!h) return null; const xs = (h.g as any).xsec; return xs ? { side: xs[h.off >= 0 ? 'L' : 'R'] as Side, g: h.g } : null; };
  const vW = new Map<number, { k: number; v: number; f: number; nx: number; nz: number; n: number; paved: boolean; seg: number }>();
  const eSide: (Side | null)[] = [];
  for (const E of bandEdges) {
    const mx = (X0(E.a) + X0(E.b)) / 2 + E.nx * 0.5, mz = (Z0(E.a) + Z0(E.b)) / 2 + E.nz * 0.5, s = sideOf(mx, mz);
    // (an island's edge: always a kerb, nothing else — the island fills the rest)
    const sd = inIsland(mx - E.nx * 0.2, mz - E.nz * 0.2) ? ISLAND_SIDE : s && s.side.kerb ? s.side : null;
    eSide.push(sd);
    for (const w of [E.a, E.b]) {
      const o = vW.get(w) ?? vW.set(w, { k: 0, v: 0, f: 0, nx: 0, nz: 0, n: 0, paved: false, seg: s?.g.id ?? E.seg }).get(w)!;
      o.nx += E.nx; o.nz += E.nz; o.n++;
      if (sd) { o.k = kerbW; o.v = Math.max(o.v, sd.verge); o.f = Math.max(o.f, sd.footpath); o.paved ||= sd.paved; }
    }
  }
  for (const o of vW.values()) { const l = Math.hypot(o.nx, o.nz); if (l > 1e-9) { o.nx /= l; o.nz /= l; } const tot = o.k + o.v + o.f; if (tot > X.maxBand) { const f = X.maxBand / tot; o.v *= f; o.f *= f; } }
  // (the mitre at each vertex: its two edges' offsets kept parallel, at most 2×)
  const mitre = new Map<number, number>();
  for (const E of bandEdges) for (const w of [E.a, E.b]) { const o = vW.get(w)!, c = Math.max(0.5, E.nx * o.nx + E.nz * o.nz); mitre.set(w, Math.max(mitre.get(w) ?? 1, Math.min(2, 1 / c))); }
  const off = (w: number, d: number) => { const o = vW.get(w)!, m = mitre.get(w) ?? 1; return [X0(w) + o.nx * d * m, Z0(w) + o.nz * d * m]; };
  // 3. the pieces: each edge's quads, by what they are
  const quads: Record<'kerb' | 'verge' | 'footpath', any[]> = { kerb: [], verge: [], footpath: [] };
  const qbox: Record<'kerb' | 'verge' | 'footpath', number[][]> = { kerb: [], verge: [], footpath: [] };
  bandEdges.forEach((E, q) => {
    if (!eSide[q]) return;
    stats.edges++;
    const A = vW.get(E.a)!, B = vW.get(E.b)!;
    const layers: ['kerb' | 'verge' | 'footpath', number, number, number, number][] = [['kerb', 0, 0, A.k, B.k], ['verge', A.k, B.k, A.k + A.v, B.k + B.v], ['footpath', A.k + A.v, B.k + B.v, A.k + A.v + A.f, B.k + B.v + B.f]];
    for (const [name, a0, b0, a1, b1] of layers) {
      if (a1 - a0 < 0.02 && b1 - b0 < 0.02) continue;
      const pts = [off(E.a, a0), off(E.b, b0), off(E.b, b1), off(E.a, a1)];
      quads[name].push(POS(pts));
      qbox[name].push([Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))]);
    }
    stats.kerbM += Math.hypot(X0(E.b) - X0(E.a), Z0(E.b) - Z0(E.a));
  });
  // (the pieces by cell of the cut — `cell` m squares on the grid — each one in every cell its box meets)
  const CS = cells.length ? cells[0][2] - cells[0][0] : 64, cellKey = (c: number[]) => `${Math.round(c[0] / CS)},${Math.round(c[1] / CS)}`;
  const qcell: Record<string, Map<string, number[]>> = { kerb: new Map(), verge: new Map(), footpath: new Map() };
  for (const name of ['kerb', 'verge', 'footpath'] as const) qbox[name].forEach((b, q) => { for (let i = Math.floor((b[0] - 1) / CS); i <= Math.floor((b[2] + 1) / CS); i++) for (let j = Math.floor((b[1] - 1) / CS); j <= Math.floor((b[3] + 1) / CS); j++) { const k = `${i},${j}`; (qcell[name].get(k) ?? qcell[name].set(k, []).get(k)!).push(q); } });
  // 4. heights: the road's edge nearest a point (its height there, and how far), the kerb lowered near crossings and
  //    driveways' mouths
  const EC = 6, eGrid = new Map<number, number[]>(), eKey = (i: number, j: number) => (i + 50000) * 100000 + j + 50000;
  const allEdges = bandEdges.map(E => [X0(E.a), Y0(E.a), Z0(E.a), X0(E.b), Y0(E.b), Z0(E.b)]);
  allEdges.forEach((e, q) => { for (let i = Math.floor(Math.min(e[0], e[3]) / EC); i <= Math.floor(Math.max(e[0], e[3]) / EC); i++) for (let j = Math.floor(Math.min(e[2], e[5]) / EC); j <= Math.floor(Math.max(e[2], e[5]) / EC); j++) (eGrid.get(eKey(i, j)) ?? eGrid.set(eKey(i, j), []).get(eKey(i, j))!).push(q); });
  const edgeNear = (x: number, z: number) => {
    let best = { d: Infinity, h: NaN, q: -1 };
    for (let r = 1; r <= 3 && best.q < 0; r++) for (let i = Math.floor(x / EC) - r; i <= Math.floor(x / EC) + r; i++) for (let j = Math.floor(z / EC) - r; j <= Math.floor(z / EC) + r; j++) for (const q of eGrid.get(eKey(i, j)) ?? []) {
      const e = allEdges[q], dx = e[3] - e[0], dz = e[5] - e[2], L2 = dx * dx + dz * dz || 1e-12, t = Math.max(0, Math.min(1, ((x - e[0]) * dx + (z - e[2]) * dz) / L2)), d = Math.hypot(x - e[0] - dx * t, z - e[2] - dz * t);
      if (d < best.d) best = { d, h: e[1] + (e[4] - e[1]) * t, q };
    }
    return best;
  };
  const LG = 8, lGrid = new Map<number, number[][]>();
  for (const p of lowerAt) { const k = eKey(Math.floor(p[0] / LG), Math.floor(p[1] / LG)); (lGrid.get(k) ?? lGrid.set(k, []).get(k)!).push(p); }
  const lowered = (x: number, z: number) => { let d = Infinity; for (let i = Math.floor(x / LG) - 1; i <= Math.floor(x / LG) + 1; i++) for (let j = Math.floor(z / LG) - 1; j <= Math.floor(z / LG) + 1; j++) for (const p of lGrid.get(eKey(i, j)) ?? []) d = Math.min(d, Math.hypot(p[0] - x, p[1] - z)); return smooth01((d - X.lowerAt) / X.lowerRamp); };
  const heightAt = (x: number, z: number, part: number, isl?: { cx: number; cz: number; r: number }) => {
    const e = edgeNear(x, z);
    if (e.q < 0) return NaN;
    const kH = X.kerbHeight * lowered(x, z), up = kH * smooth01(e.d / X.kerbBevel);
    if (part === PARTS.kerb) return e.h + up;
    if (part === PARTS.garden && isl) return e.h + kH + IS.mound * smooth01(1 - Math.hypot(x - isl.cx, z - isl.cz) / Math.max(1, isl.r));
    return e.h + up + X.crossfall * Math.max(0, e.d - kerbW);
  };
  // 5. cell by cell: joined, the road and buildings taken out, cut to the cell, triangulated
  // (only what stands on the ground: a verandah over the footpath — building=roof — or anything raised off it doesn't
  // take the footpath's place)
  const standing = buildings.filter((b: any) => b.props?.b !== 'roof' && b.props?.b !== 'carport' && !(b.props?.mh > 0.5));
  const bPaths = standing.map((b: any) => POS(b.rings[0])), bBox = standing.map((b: any) => { const r = b.rings[0]; return [Math.min(...r.map((p: number[]) => p[0])), Math.min(...r.map((p: number[]) => p[1])), Math.max(...r.map((p: number[]) => p[0])), Math.max(...r.map((p: number[]) => p[1]))]; });
  const C = Clipper.Clipper;
  const colOf: Record<number, number[]> = { [PARTS.kerb]: hex(colours.kerb), [PARTS.verge]: hex(colours.verge), [PARTS.footpath]: hex(colours.footpath), [PARTS.island]: hex(colours.island), [PARTS.garden]: hex(colours.mulch) };
  const surfOf: Record<number, number> = { [PARTS.kerb]: SURFACES.indexOf('kerb'), [PARTS.verge]: SURFACES.indexOf('grass'), [PARTS.footpath]: SURFACES.indexOf(X.footpathSurface === 'concrete' ? 'footpath' : X.footpathSurface), [PARTS.island]: SURFACES.indexOf('concrete'), [PARTS.garden]: SURFACES.indexOf('dirt') };
  for (const cell of cells) {
    const box = [cell[0] - 1, cell[1] - 1, cell[2] + 1, cell[3] + 1];
    const cellPath = P64([[cell[0], cell[1]], [cell[2], cell[1]], [cell[2], cell[3]], [cell[0], cell[3]]]);
    const pick = (name: 'kerb' | 'verge' | 'footpath') => { const ids = qcell[name].get(cellKey(cell)) ?? []; return ids.map(q => quads[name][q]); };
    const kq = pick('kerb'), vq = pick('verge'), fq = pick('footpath');
    const isl = islands.filter(s => meets(s.box, box));
    if (!kq.length && !vq.length && !fq.length && !isl.length) continue;
    stats.cells++;
    const road = roadIn([box[0] - 12, box[1] - 12, box[2] + 12, box[3] + 12]);
    const bld = bPaths.filter((_, q) => meets(bBox[q], box)), islP = isl.map(s => POS(s.pts));
    // (each a difference of the pieces, joined, less what takes the place first: the road, then the kerb, then the
    // footpath; buildings and islands out of the footpath and verge)
    // (each piece set joined on its own first, and each set taken out too: Clipper2-js stalls on many raw quads sharing
    // edges in one difference, and loops for good in doHorizontal on a difference whose clip is the road's, kerb's,
    // footpath's and buildings' rings overlapping — a verge in Enfield, -34.8616, 138.6228. Joined under the same rule,
    // the clip is the same ground)
    const U = (list: any[]) => C.Union(paths(list), undefined, NZ);
    const kU = U(kq), fU = U(fq), vU = U(vq), roadU = U(road), roadKerb = U([...roadU, ...kU]);
    const footCut = U([...roadKerb, ...bld, ...islP]);
    const kerb = C.Difference(paths(kU), paths(roadU), NZ);
    const foot = C.Difference(paths(fU), paths(footCut), NZ);
    const verge = C.Difference(paths(vU), paths(U([...footCut, ...fU])), NZ);
    // (islands: their whole hole, less the kerb round it; nothing else in them)
    const islandPieces: { p: any; s: typeof islands[number] }[] = [];
    for (const s of isl) islandPieces.push({ p: C.Difference(paths([POS(s.pts)]), paths(roadKerb), NZ), s });
    const emit = (shape: any, part: number, isl?: typeof islands[number]) => {
      const clipped = C.Intersect(paths(shape), paths([cellPath]), NZ).filter((p: any) => Math.abs(C.area(p)) > 0.0004 * S * S);
      if (!clipped.length) return;
      // (on the tiles' 1 cm grid, as the road's own vertices are — so the tiles' welding moves nothing — each ring's
      // repeats dropped)
      const q = cfg.surface.quantum ?? 0.01;
      const rings = clipped.map((p: any) => { const r: number[][] = []; for (const pt of p) { const v = [Math.round(pt.x / S / q) * q, Math.round(pt.y / S / q) * q], l = r[r.length - 1]; if (!l || Math.abs(l[0] - v[0]) > 1e-9 || Math.abs(l[1] - v[1]) > 1e-9) r.push(v); } while (r.length > 1 && Math.abs(r[0][0] - r[r.length - 1][0]) < 1e-9 && Math.abs(r[0][1] - r[r.length - 1][1]) < 1e-9) r.pop(); return r; }).filter((r: number[][]) => r.length >= 3);
      if (!rings.length) return;
      const tris = triangulatePatch([rings]);
      const vid = new Map<string, number>();
      const v = (p: number[]) => { const k = `${p[0]},${p[1]}`; let i = vid.get(k); if (i === undefined) { const y = heightAt(p[0], p[1], part, isl); i = out.positions.length / 3; out.positions.push(p[0], Number.isFinite(y) ? y : 0, p[1]); const c = colOf[part]; out.colours.push(c[0], c[1], c[2], 255); vid.set(k, i); } return i; };
      const seg = nearSeg((cell[0] + cell[2]) / 2, (cell[1] + cell[3]) / 2, 400)?.g.id ?? -1;
      for (const t of tris) {
        const a = v(t[0]), b = v(t[1]), c = v(t[2]), Pp = out.positions;
        const ny = (Pp[b * 3 + 2] - Pp[a * 3 + 2]) * (Pp[c * 3] - Pp[a * 3]) - (Pp[b * 3] - Pp[a * 3]) * (Pp[c * 3 + 2] - Pp[a * 3 + 2]);
        if (Math.abs(ny) < 1e-8) continue;
        if (ny < 0) out.indices.push(a, c, b); else out.indices.push(a, b, c);
        out.surfaces.push(surfOf[part]); out.solid.push(1); out.level.push(0); out.seg.push(seg); out.part.push(part);
        stats.triangles++;
        const area = Math.abs(ny) / 2;
        if (part === PARTS.footpath) stats.footpathM2 += area; else if (part === PARTS.verge) stats.vergeM2 += area;
      }
    };
    emit(kerb, PARTS.kerb); emit(foot, PARTS.footpath); emit(verge, PARTS.verge);
    // (a roundabout's: a garden bed; a small traffic island concrete; a bigger one grassed)
    for (const { p, s } of islandPieces) emit(p, s.round ? PARTS.garden : s.area < IS.paveBelow ? PARTS.island : PARTS.verge, s);
  }
  // (islands' planting, once each — the cell holding its middle: low plants round it, a tree in a roundabout's middle)
  for (const s of islands) {
    const mine = cells.some(c => s.cx >= c[0] && s.cx < c[2] && s.cz >= c[1] && s.cz < c[3]);
    if (!mine) continue;
    stats.islands++;
    if (!s.round) continue;
    stats.gardens++;
    const y0 = heightAt(s.cx, s.cz, PARTS.garden, s);
    if (s.r >= IS.treeRadius && Number.isFinite(y0)) plants.push(s.cx, y0, s.cz, 1.1, 0);
    for (let ring = 0.45; ring < 0.9; ring += 0.35) {
      const n = Math.max(4, Math.floor(2 * Math.PI * s.r * ring / IS.plantSpacing));
      for (let q = 0; q < n; q++) {
        const a = (q + ring) / n * 2 * Math.PI, x = s.cx + Math.cos(a) * s.r * ring, z = s.cz + Math.sin(a) * s.r * ring, y = heightAt(x, z, PARTS.garden, s);
        if (Number.isFinite(y)) { plants.push(x, y, z, 0.35, 2); stats.plants++; }
      }
    }
  }
  // (the roundabouts: their middles, island radii and ring roads — map/model/furniture.ts signs their entries)
  return { mesh: out, plants, stats, roundabouts: islands.filter(s => s.round).map(s => ({ x: s.cx, z: s.cz, r: s.r, ring: s.ring })) };
}
