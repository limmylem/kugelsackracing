// Map v3's terrain: the region's one height grid (map/format/grid.ts), from the elevation (map/bake/
// elevation.ts) shaped round what's built on it — in the grid itself, so the physics' heightfield (cut
// from it) and the drawn ground (meshed from it) are the same surface, and tiles cut from the one grid
// share their edges exactly:
//   · water: the sea at 0 m, lakes at their shore's level; the ground kept below them
//   · car parks, fuel stations: flattened to the plane that fits their ground best, sloping back outside
//   · roads: the ground under each road's corridor set just below its surface, then sloping back to the
//     natural ground (cuttings and embankments, 1 : `slope`); junctions under their joined surface
//   · bridges: no flattening; the ground kept below the deck wherever it would come through
//   · tunnels: the grid lowered under the tunnel (so nothing solid is in the way), and the natural ground
//     over it kept as a separate roof surface (`cover`), drawn and solid
// Then everything to the centimetre. Also: the land use (a class per grid point) for the ground's colours.
//
//   const T = shapeTerrain({ grid, dem, osm, roads, cfg })
//   T.heights (cm-exact Float32, W×H), T.classes (Uint8, W×H) + T.classNames, T.cover (Float32, NaN where
//   none), T.water ([{ level, rings }]), T.parking ([{ rings, plane }])

import type { Grid } from '../format/grid.ts';
import type { Area, OsmData } from './osmData.ts';
import { type RNode, type Seg, profileAt } from './roads.ts';

export interface TerrainCfg { sink: number; core: number; slope: number; maxBlend: number; bridgeClearance: number; tunnelCover: number; waterDepth: number; parkingMargin: number; wallReach?: number; underBridge?: number }

const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// every grid point inside a polygon (rings: outer first, holes after), by scanline
export function fillPolygon(g: Grid, rings: { x: number; z: number }[][], fn: (c: number, r: number) => void) {
  let za = Infinity, zb = -Infinity;
  for (const p of rings[0]) { za = Math.min(za, p.z); zb = Math.max(zb, p.z); }
  const r0 = Math.max(0, Math.ceil((za - g.z0) / g.cell)), r1 = Math.min(g.H - 1, Math.floor((zb - g.z0) / g.cell));
  for (let r = r0; r <= r1; r++) {
    const z = g.z0 + r * g.cell, xs: number[] = [];
    for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      if ((a.z > z) !== (b.z > z)) xs.push(a.x + (z - a.z) * (b.x - a.x) / (b.z - a.z));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - g.x0) / g.cell)), c1 = Math.min(g.W - 1, Math.floor((xs[k + 1] - g.x0) / g.cell));
      for (let c = c0; c <= c1; c++) fn(c, r);
    }
  }
}
const areaOf = (ring: { x: number; z: number }[]) => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j].x - ring[i].x) * (ring[j].z + ring[i].z); return Math.abs(a / 2); };

export const CLASSES = ['default', 'grass', 'park', 'forest', 'scrub', 'farmland', 'residential', 'commercial', 'industrial', 'sand', 'rock', 'wetland', 'parking', 'water', 'cemetery', 'pitch'];
function classOf(t: Record<string, string>): string | null {
  const v = t.landuse ?? t.leisure ?? t.natural ?? t.amenity;
  const map = {
    grass: 'grass', meadow: 'grass', village_green: 'grass', recreation_ground: 'park', park: 'park', garden: 'park', golf_course: 'park', playground: 'park', nature_reserve: 'park',
    forest: 'forest', wood: 'forest', scrub: 'scrub', heath: 'scrub', grassland: 'grass', farmland: 'farmland', orchard: 'farmland', vineyard: 'farmland', allotments: 'farmland',
    residential: 'residential', commercial: 'commercial', retail: 'commercial', industrial: 'industrial', railway: 'industrial', construction: 'industrial', military: 'industrial', port: 'industrial',
    sand: 'sand', beach: 'sand', bare_rock: 'rock', scree: 'rock', cliff: 'rock', wetland: 'wetland', parking: 'parking', fuel: 'parking', cemetery: 'cemetery', pitch: 'pitch',
  };
  return map[v] ?? null;
}
export const isWater = (t: Record<string, string>) => t.natural === 'water' || t.waterway === 'riverbank' || t.waterway === 'dock' || t.landuse === 'reservoir' || t.landuse === 'basin' || t.water !== undefined && t.natural === 'water';
export const isSea = (t: Record<string, string>) => ['sea', 'bay', 'ocean', 'strait'].includes(t.water);
export const isParking = (t: Record<string, string>) => (t.amenity === 'parking' && !['multi-storey', 'underground', 'rooftop'].includes(t.parking)) || t.amenity === 'fuel' || t.highway === 'services' || t.highway === 'rest_area';

export function shapeTerrain({ grid: g, dem, osm, nodes, segs, junctions, cfg }: { grid: Grid; dem: Float32Array; osm: OsmData; nodes: RNode[]; segs: Seg[]; junctions: { ring: number[][]; centre: number[] }[]; cfg: TerrainCfg }) {
  const N = g.W * g.H, h = Float32Array.from(dem), classes = new Uint8Array(N);
  const xOf = (c: number) => g.x0 + c * g.cell, zOf = (r: number) => g.z0 + r * g.cell;
  // ---- land use (largest first: smaller areas inside win)
  const areas = osm.areas.map(a => ({ a, cls: isWater(a.tags) ? 'water' : classOf(a.tags), size: areaOf(a.parts[0][0]) })).filter(x => x.cls).sort((p, q) => q.size - p.size);
  for (const { a, cls } of areas) { const k = CLASSES.indexOf(cls!); for (const rings of a.parts) fillPolygon(g, rings, (c, r) => { classes[r * g.W + c] = k; }); }
  // ---- water: flat, the ground kept below it
  const water: { level: number; rings: { x: number; z: number }[][]; sea: boolean; id: number }[] = [];
  for (const a of osm.areas.filter(a => isWater(a.tags)).sort((p, q) => p.id - q.id)) {
    for (const rings of a.parts) {
      const sea = isSea(a.tags);
      let level = 0;
      if (!sea) {
        // (a lake's level: low on its shore — the 10th percentile of the ground round its edge)
        const hs = rings[0].filter((_, q, arr) => q % Math.max(1, Math.floor(arr.length / 80)) === 0).map(p => sampleGrid(g, dem, p.x, p.z)).sort((p, q) => p - q);
        level = hs.length ? hs[Math.floor(hs.length * 0.1)] : 0;
        if (a.tags.leisure === 'swimming_pool' || a.tags.water === 'pool') continue;
      }
      water.push({ level, rings, sea, id: a.id });
      fillPolygon(g, rings, (c, r) => { const k = r * g.W + c; h[k] = Math.min(h[k], level - cfg.waterDepth); });
    }
  }
  // ---- car parks and fuel stations: a fitted plane
  const parking: { rings: { x: number; z: number }[][]; plane: number[]; id: number; tags: Record<string, string> }[] = [];
  const soft = new Float32Array(N), softT = new Float32Array(N);
  for (const a of osm.areas.filter(a => isParking(a.tags)).sort((p, q) => p.id - q.id)) {
    for (const rings of a.parts) {
      if (areaOf(rings[0]) > 80000) continue;
      const pts: number[][] = [];
      fillPolygon(g, rings, (c, r) => pts.push([xOf(c), zOf(r), dem[r * g.W + c], c, r]));
      if (pts.length < 4) continue;
      const plane = fitPlane(pts);
      if (Math.hypot(plane[0], plane[1]) > 0.15) continue;      // (too steep to be one flat car park)
      parking.push({ rings, plane, id: a.id, tags: a.tags });
      for (const p of pts) h[p[4] * g.W + p[3]] = plane[0] * p[0] + plane[1] * p[1] + plane[2];
      // (outside it, a margin sloping back)
      let xa = Infinity, za = Infinity, xb = -Infinity, zb = -Infinity;
      for (const p of rings[0]) { xa = Math.min(xa, p.x); xb = Math.max(xb, p.x); za = Math.min(za, p.z); zb = Math.max(zb, p.z); }
      const m = cfg.parkingMargin;
      forBox(g, xa - m, za - m, xb + m, zb + m, (c, r) => {
        const x = xOf(c), z = zOf(r), d = distToRing(x, z, rings[0]);
        if (d <= 0 || d > m) return;
        const w = 1 - smoothstep(0, m, d), k = r * g.W + c;
        if (w > soft[k]) { soft[k] = w; softT[k] = plane[0] * x + plane[1] * z + plane[2]; }
      });
    }
  }
  // ---- roads: the corridor under each ground road, then the slopes back
  const hardKey = new Float32Array(N).fill(Infinity), hardT = new Float32Array(N), hardSurf = new Uint8Array(N);
  const SURF = { tarmac: 1, concrete: 2, cobbles: 3, gravel: 4, dirt: 5, grass: 6, sand: 7 };
  const cover = new Float32Array(N).fill(NaN);
  for (const sg of segs) {
    const hw = sg.width / 2, drop = (sg.oneway ? 0.6 : 1) * 0.02 * hw;
    for (let q = 0; q + 1 < sg.xs.length; q++) {
      const ax = sg.xs[q], az = sg.zs[q], bx = sg.xs[q + 1], bz = sg.zs[q + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
      const reach = sg.structure === 'ground' ? hw + cfg.core + cfg.maxBlend : hw + 1.5;
      forBox(g, Math.min(ax, bx) - reach, Math.min(az, bz) - reach, Math.max(ax, bx) + reach, Math.max(az, bz) + reach, (c, r) => {
        const x = xOf(c), z = zOf(r), t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)), d = Math.hypot(x - ax - dx * t, z - az - dz * t);
        if (d > reach) return;
        const k = r * g.W + c, s = sg.s[q] + (sg.s[q + 1] - sg.s[q]) * t, y = profileAt(sg, s), surf = y - drop * Math.min(1, d / hw);
        if (sg.structure === 'bridge') { if (d <= hw + 1.5) h[k] = Math.min(h[k], y - cfg.bridgeClearance); return; }
        if (sg.structure === 'tunnel') {
          if (d > hw + 1.5) return;
          if (dem[k] - y > cfg.tunnelCover) { cover[k] = dem[k]; h[k] = Math.min(h[k], y - 1); }
          else if (d - hw < hardKey[k]) { hardKey[k] = d - hw; hardT[k] = surf - cfg.sink; }      // (the open cut at its mouths)
          return;
        }
        if (d <= hw + cfg.core) { if (d - hw < hardKey[k]) { hardKey[k] = d - hw; hardT[k] = surf - cfg.sink; hardSurf[k] = SURF[sg.surface] ?? 1; } return; }
        const edge = y - drop - cfg.sink, blendW = Math.max(1.5, Math.min(cfg.maxBlend, Math.abs(dem[k] - edge) * cfg.slope));
        if (d > hw + cfg.core + blendW) return;
        const w = 1 - smoothstep(0, blendW, d - hw - cfg.core);
        if (w > soft[k]) { soft[k] = w; softT[k] = edge; }
      });
    }
  }
  // junctions: under the joined surface (its fan from the node to the ring) — on the ground only: a
  // junction on a bridge (a slip road joining on the deck) or in a tunnel is no shape for the ground
  for (const j of junctions as { node?: number; ring: number[][]; centre: number[] }[]) {
    if (j.node != null && nodes[j.node] && !nodes[j.node].ground) continue;
    const [cx, cy, cz] = j.centre;
    for (let q = 0; q < j.ring.length; q++) {
      const a = j.ring[q], b = j.ring[(q + 1) % j.ring.length];
      forTriangle(g, [cx, cy, cz], a, b, (c, r, y) => { const k = r * g.W + c; hardKey[k] = -1; hardT[k] = y - cfg.sink; hardSurf[k] ||= 1; });
    }
  }
  for (let k = 0; k < N; k++) {
    if (hardKey[k] !== Infinity) h[k] = hardT[k];
    else if (soft[k] > 0) h[k] = h[k] + (softT[k] - h[k]) * soft[k];
  }
  // ---- walls and fences: no lip of ground along them. A LiDAR DTM often keeps some of a thin wall as a
  // ridge (the filter that takes buildings out misses it), and a median wall between two carriageways
  // keeps the ground of the strip the roads were cut down through — either way a lip a car hits before
  // the wall. Each side's shaped ground, taken clear of it (cfg.wallReach and half as far again out) and
  // carried in to the line, is as high as the ground near it may be: a ridge is cut away, a retaining
  // wall's real step kept (each side its own level, the step at the line). Only ever down; never a road.
  const reach = cfg.wallReach ?? 3, shaped = Float32Array.from(h);
  for (const w of osm.lines) {
    if (!w.tags.barrier) continue;
    for (let k = 0; k + 1 < w.nodes.length; k++) {
      const p = w.nodes[k], q = w.nodes[k + 1], len = Math.hypot(q.x - p.x, q.z - p.z);
      if (len < 0.01) continue;
      const ux = (q.x - p.x) / len, uz = (q.z - p.z) / len, nx = -uz, nz = ux;
      forBox(g, Math.min(p.x, q.x) - reach, Math.min(p.z, q.z) - reach, Math.max(p.x, q.x) + reach, Math.max(p.z, q.z) + reach, (c, r) => {
        const x = xOf(c), z = zOf(r), along = (x - p.x) * ux + (z - p.z) * uz, d = (x - p.x) * nx + (z - p.z) * nz;
        if (along < 0 || along > len || Math.abs(d) >= reach) return;
        const bx = p.x + ux * along, bz = p.z + uz * along;
        // (that side's ground carried in, its slope no steeper than the terrain's own limit)
        const side = (sd: number) => {
          const h1 = sampleGrid(g, shaped, bx + nx * sd * reach, bz + nz * sd * reach), h2 = sampleGrid(g, shaped, bx + nx * sd * reach * 1.5, bz + nz * sd * reach * 1.5);
          return h1 + Math.max(-cfg.slope, Math.min(cfg.slope, (h1 - h2) / (reach * 0.5))) * (reach - Math.abs(d));
        };
        // (within a cell of the line, where a road runs along the low side: the lower side's level. A step
        // can only be as sharp as the grid; its slope then lies behind the wall, under its collider, not
        // as a ramp in front of it where cars come from. Elsewhere — a sea wall, a terrace — each side
        // keeps its own.)
        let target = side(d < 0 ? -1 : 1);
        if (Math.abs(d) < g.cell) {
          const a = side(-1), b = side(1), low = a < b ? -1 : 1;
          const road = [2, 4, 6].some(t => { const cc = Math.round((bx + nx * low * t - g.x0) / g.cell), rr = Math.round((bz + nz * low * t - g.z0) / g.cell); return cc >= 0 && rr >= 0 && cc < g.W && rr < g.H && hardKey[rr * g.W + cc] !== Infinity; });
          if (road) target = Math.min(a, b);
        }
        const i = r * g.W + c;
        if (hardKey[i] === Infinity && h[i] > target) h[i] = target;
      });
    }
  }
  // (bridges again: nothing the slopes raised may come through a deck. And under a deck, away from its
  // ends, a clear space: the elevation there is often the deck itself — a surface model sees bridges —
  // which would stand as a bank beside a road passing under. Road surfaces under it only keep clear.)
  const under = cfg.underBridge ?? 5;
  for (const sg of segs) if (sg.structure === 'bridge') {
    const L = sg.s[sg.s.length - 1], fromGround = nodes[sg.from]?.ground, toGround = nodes[sg.to]?.ground;
    for (let q = 0; q + 1 < sg.xs.length; q++) {
      const ax = sg.xs[q], az = sg.zs[q], bx = sg.xs[q + 1], bz = sg.zs[q + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9, reach = sg.width / 2 + 1.5;
      forBox(g, Math.min(ax, bx) - reach, Math.min(az, bz) - reach, Math.max(ax, bx) + reach, Math.max(az, bz) + reach, (c, r) => {
        const x = xOf(c), z = zOf(r), t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        if (Math.hypot(x - ax - dx * t, z - az - dz * t) > reach) return;
        const s = sg.s[q] + (sg.s[q + 1] - sg.s[q]) * t, end = Math.min(fromGround ? s : Infinity, toGround ? L - s : Infinity);
        const k = r * g.W + c, clear = hardKey[k] !== Infinity ? cfg.bridgeClearance : Math.max(cfg.bridgeClearance, Math.min(under, end * 0.35));
        h[k] = Math.min(h[k], profileAt(sg, s) - clear);
      });
    }
  }
  // to the centimetre (what the tiles store, exactly)
  for (let k = 0; k < N; k++) { h[k] = Math.round(h[k] * 100) / 100; if (cover[k] === cover[k]) cover[k] = Math.round(cover[k] * 100) / 100; }
  // (what's underfoot: the road's surface on roads, tarmac in car parks; 0 elsewhere — the land use decides)
  // (which points are car park, not road: the car park's surface is drawn there, the road's elsewhere)
  const parkingCell = new Uint8Array(N);
  for (const pk of parking) fillPolygon(g, pk.rings, (c, r) => { const k = r * g.W + c; if (!hardSurf[k]) parkingCell[k] = 1; hardSurf[k] ||= 1; });
  return { parkingCell, heights: h, classes, classNames: CLASSES, cover, water, parking, roadSurface: hardSurf, surfaceNames: ['none', ...Object.keys(SURF)] };
}

export function sampleGrid(g: Grid, a: Float32Array, x: number, z: number) {
  const fc = Math.max(0, Math.min(g.W - 1.000001, (x - g.x0) / g.cell)), fr = Math.max(0, Math.min(g.H - 1.000001, (z - g.z0) / g.cell)), c = Math.floor(fc), r = Math.floor(fr), tx = fc - c, tz = fr - r, k = r * g.W + c;
  return (a[k] * (1 - tx) + a[k + 1] * tx) * (1 - tz) + (a[k + g.W] * (1 - tx) + a[k + g.W + 1] * tx) * tz;
}
function forBox(g: Grid, xa: number, za: number, xb: number, zb: number, fn: (c: number, r: number) => void) {
  const c0 = Math.max(0, Math.ceil((xa - g.x0) / g.cell)), c1 = Math.min(g.W - 1, Math.floor((xb - g.x0) / g.cell)), r0 = Math.max(0, Math.ceil((za - g.z0) / g.cell)), r1 = Math.min(g.H - 1, Math.floor((zb - g.z0) / g.cell));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) fn(c, r);
}
function forTriangle(g: Grid, A: number[], B: number[], C: number[], fn: (c: number, r: number, y: number) => void) {
  const xa = Math.min(A[0], B[0], C[0]), xb = Math.max(A[0], B[0], C[0]), za = Math.min(A[2], B[2], C[2]), zb = Math.max(A[2], B[2], C[2]);
  const d = (B[2] - C[2]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[2] - C[2]);
  if (Math.abs(d) < 1e-9) return;
  forBox(g, xa, za, xb, zb, (c, r) => {
    const x = g.x0 + c * g.cell, z = g.z0 + r * g.cell;
    const l1 = ((B[2] - C[2]) * (x - C[0]) + (C[0] - B[0]) * (z - C[2])) / d, l2 = ((C[2] - A[2]) * (x - C[0]) + (A[0] - C[0]) * (z - C[2])) / d, l3 = 1 - l1 - l2;
    if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) fn(c, r, l1 * A[1] + l2 * B[1] + l3 * C[1]);
  });
}
function distToRing(x: number, z: number, ring: { x: number; z: number }[]) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
    best = Math.min(best, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
  }
  return best;
}
// least squares plane y = a·x + b·z + c (centred, for precision)
function fitPlane(pts: number[][]) {
  let mx = 0, mz = 0, my = 0;
  for (const p of pts) { mx += p[0]; mz += p[1]; my += p[2]; }
  mx /= pts.length; mz /= pts.length; my /= pts.length;
  let sxx = 0, sxz = 0, szz = 0, sxy = 0, szy = 0;
  for (const p of pts) { const x = p[0] - mx, z = p[1] - mz, y = p[2] - my; sxx += x * x; sxz += x * z; szz += z * z; sxy += x * y; szy += z * y; }
  const det = sxx * szz - sxz * sxz;
  const a = det ? (sxy * szz - szy * sxz) / det : 0, b = det ? (szy * sxx - sxy * sxz) / det : 0;
  return [a, b, my - a * mx - b * mz];
}
export type { Area };
