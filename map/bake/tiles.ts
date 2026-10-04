// Map v3's tiles: each 512 m square cut from the region-wide baked data — its heightfield the region
// grid's points over it (so neighbours share their edge points exactly), its terrain colours and tyre
// surfaces from the same grid, the road and junction triangles whose middles are in it, car parks (their
// surface at their plane, kerbs, bay lines), tunnel roofs, water, buildings, railings, trees, street
// names and signs, and the roads' names for the HUD. All in the tile's own frame (its middle at 0, 0).
// Encoded by map/format/tileFormat.ts.
//
//   const T = tileBuilder({...global data}); T.tile(i, j) → Tile; T.far(a, b) → Tile (the far layer)

import earcut from 'earcut';
import type { Grid } from '../format/grid.ts';
import type { Tile } from '../format/tileFormat.ts';
import type { Mesh, Seg } from './roads.ts';
import type { Building } from './buildingMerge.ts';
import { extrude, rgb } from './extrude.ts';
import { sampleGrid } from './terrain.ts';

class Part {
  positions: number[] = []; colours: number[] = []; indices: number[] = []; uvs: number[] | null; surfaces: number[] | null;
  constructor(uv = false, surfaces = false) { this.uvs = uv ? [] : null; this.surfaces = surfaces ? [] : null; }
  get empty() { return !this.indices.length; }
  vertex(x: number, y: number, z: number, c: number[], u = 0, v = 0) { this.positions.push(x, y, z); this.colours.push(c[0], c[1], c[2], c[3] ?? 255); if (this.uvs) this.uvs.push(u, v); return this.positions.length / 3 - 1; }
  tri(a: number, b: number, c: number, s = 0) { this.indices.push(a, b, c); if (this.surfaces) this.surfaces.push(s); }
  // a triangle facing up
  upTri(a: number, b: number, c: number, s = 0) { const P = this.positions, ny = (P[b * 3 + 2] - P[a * 3 + 2]) * (P[c * 3] - P[a * 3]) - (P[b * 3] - P[a * 3]) * (P[c * 3 + 2] - P[a * 3 + 2]); if (ny < 0) this.tri(a, c, b, s); else this.tri(a, b, c, s); }
  add(o: any, dx: number, dz: number) { const base = this.positions.length / 3; for (let k = 0; k < o.positions.length; k += 3) this.positions.push(o.positions[k] + dx, o.positions[k + 1], o.positions[k + 2] + dz); this.colours.push(...o.colours); if (this.uvs) this.uvs.push(...(o.uvs ?? new Array(o.positions.length / 3 * 2).fill(0))); for (const k of o.indices) this.indices.push(base + k); }
  out() { return { positions: Float32Array.from(this.positions), colours: Uint8Array.from(this.colours), uvs: this.uvs ? Float32Array.from(this.uvs) : null, indices: Uint32Array.from(this.indices), surfaces: this.surfaces ? Uint8Array.from(this.surfaces) : null }; }
}
// a polygon (rings of {x, z}) clipped to an axis-aligned box (Sutherland–Hodgman per ring)
function clipRing(ring: number[][], x0: number, z0: number, x1: number, z1: number) {
  let pts = ring;
  const edges: [(p: number[]) => boolean, (a: number[], b: number[]) => number[]][] = [
    [p => p[0] >= x0, (a, b) => { const t = (x0 - a[0]) / (b[0] - a[0]); return [x0, a[1] + (b[1] - a[1]) * t]; }],
    [p => p[0] <= x1, (a, b) => { const t = (x1 - a[0]) / (b[0] - a[0]); return [x1, a[1] + (b[1] - a[1]) * t]; }],
    [p => p[1] >= z0, (a, b) => { const t = (z0 - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, z0]; }],
    [p => p[1] <= z1, (a, b) => { const t = (z1 - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, z1]; }],
  ];
  for (const [inside, cut] of edges) {
    const out: number[][] = [];
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; const ia = inside(a), ib = inside(b); if (ia) out.push(a); if (ia !== ib) out.push(cut(a, b)); }
    pts = out;
    if (!pts.length) break;
  }
  return pts;
}
const bucketKey = (i: number, j: number) => `${i}_${j}`;

export function tileBuilder(D: {
  region: any; grid: Grid; cfg: any; heights: Float32Array; classes: Uint8Array; classNames: string[]; roadSurface: Uint8Array; surfaceNames: string[]; cover: Float32Array; demSource: Uint8Array; demSources: any[];
  water: any[]; parking: any[]; parkingCell: Uint8Array; mesh: Mesh; marks: Mesh; segs: Seg[]; buildings: Building[]; barriers: Record<string, number[]>; trees: number[]; labels: { labels: number[]; signs: number[]; names: string[] }; bays: { x: number; z: number }[][];
}) {
  const { grid: g, cfg } = D, T = g.tileSize, per = T / g.cell, N1 = per + 1;
  const pal = Object.fromEntries(Object.entries(cfg.colours).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, rgb(v as string)]));
  const ground = (x: number, z: number) => sampleGrid(g, D.heights, x, z);
  // where roads run (every few metres of every centreline, its surface's height): a building a road runs
  // through — a passage under it, a covered street — is solid only above the road's clearance
  const roadPts = new Map<string, number[]>(), RC = 32;
  for (const sg of D.segs) {
    for (let q = 0; q + 1 < sg.xs.length; q++) {
      const L = Math.hypot(sg.xs[q + 1] - sg.xs[q], sg.zs[q + 1] - sg.zs[q]), n = Math.max(1, Math.ceil(L / 3));
      for (let k = 0; k < n; k++) { const t = k / n, x = sg.xs[q] + (sg.xs[q + 1] - sg.xs[q]) * t, z = sg.zs[q] + (sg.zs[q + 1] - sg.zs[q]) * t, key = `${Math.floor(x / RC)},${Math.floor(z / RC)}`; (roadPts.get(key) ?? roadPts.set(key, []).get(key)!).push(x, z, sg.h[q] + (sg.h[q + 1] - sg.h[q]) * t); }
    }
  }
  const inRing = (x: number, z: number, r: number[][]) => { let inside = false; for (let a = 0, b = r.length - 1; a < r.length; b = a++) if ((r[a][1] > z) !== (r[b][1] > z) && x < (r[b][0] - r[a][0]) * (z - r[a][1]) / (r[b][1] - r[a][1]) + r[a][0]) inside = !inside; return inside; };
  // (the heights of the road surfaces inside a footprint)
  const roadThrough = (ring: number[][]) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    const hs: number[] = [];
    for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let i = Math.floor(x0 / RC); i <= Math.floor(x1 / RC); i++) for (let j = Math.floor(z0 / RC); j <= Math.floor(z1 / RC); j++) {
      const L = roadPts.get(`${i},${j}`); if (!L) continue;
      for (let k = 0; k < L.length; k += 3) if (L[k] > x0 && L[k] < x1 && L[k + 1] > z0 && L[k + 1] < z1 && inRing(L[k], L[k + 1], ring)) hs.push(L[k + 2]);
    }
    return hs;
  };
  const PASSAGE = cfg.buildings?.passageClearance ?? 4.5;
  // the ground roads' edges (drawn widths: wider than the street often is), for buildings that stand on
  // them: their corners back to the road's edge, so the road's drivable all across
  const edgeGrid = new Map<string, [number, number, number, number, number][]>(), EC = 32;
  for (const sg of D.segs) {
    if (sg.structure !== 'ground') continue;
    for (let q = 0; q + 1 < sg.xs.length; q++) {
      const piece: [number, number, number, number, number] = [sg.xs[q], sg.zs[q], sg.xs[q + 1], sg.zs[q + 1], sg.width / 2 + 0.3];
      for (let i = Math.floor((Math.min(piece[0], piece[2]) - piece[4]) / EC); i <= Math.floor((Math.max(piece[0], piece[2]) + piece[4]) / EC); i++) for (let j = Math.floor((Math.min(piece[1], piece[3]) - piece[4]) / EC); j <= Math.floor((Math.max(piece[1], piece[3]) + piece[4]) / EC); j++) { const key = `${i},${j}`; (edgeGrid.get(key) ?? edgeGrid.set(key, []).get(key)!).push(piece); }
    }
  }
  const offRoad = (x: number, z: number): [number, number] => {
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const [ax, az, bx, bz, hw] of edgeGrid.get(`${Math.floor(x / EC)},${Math.floor(z / EC)}`) ?? []) {
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
        if (d >= hw || d < 1e-6) continue;
        x = px + (x - px) / d * hw; z = pz + (z - pz) / d * hw; moved = true;
      }
      if (!moved) break;
    }
    return [x, z];
  };
  // ---- everything bucketed by the tile its middle's in
  const tileOf = (x: number, z: number) => bucketKey(Math.floor(x / T), Math.floor(z / T));
  const buckets = new Map<string, any>();
  const B = (k: string) => buckets.get(k) ?? buckets.set(k, { road: [], mark: [], buildings: [], barriers: {}, trees: [], labels: [], signs: [], segs: new Set<number>() }).get(k);
  for (const [name, M] of [['road', D.mesh], ['mark', D.marks]] as const) for (let t = 0; t < M.indices.length; t += 3) {
    const a = M.indices[t], b = M.indices[t + 1], c = M.indices[t + 2], P = M.positions;
    B(tileOf((P[a * 3] + P[b * 3] + P[c * 3]) / 3, (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3))[name].push(t);
  }
  D.buildings.forEach((b, k) => { const r = b.rings[0]; let x = 0, z = 0; for (const p of r) { x += p[0]; z += p[1]; } B(tileOf(x / r.length, z / r.length)).buildings.push(k); });
  for (const [type, P] of Object.entries(D.barriers)) for (let k = 0; k + 7 < P.length; k += 8) (B(tileOf((P[k] + P[k + 3]) / 2, (P[k + 2] + P[k + 5]) / 2)).barriers[type] ??= []).push(k);
  for (let k = 0; k < D.trees.length; k += 5) B(tileOf(D.trees[k], D.trees[k + 2])).trees.push(k);
  for (let k = 0; k < D.labels.labels.length; k += 6) B(tileOf(D.labels.labels[k], D.labels.labels[k + 2])).labels.push(k);
  for (let k = 0; k < D.labels.signs.length; k += 6) B(tileOf(D.labels.signs[k], D.labels.signs[k + 2])).signs.push(k);
  for (const s of D.segs) for (let q = 0; q < s.xs.length; q++) B(tileOf(s.xs[q], s.zs[q])).segs.add(s.id);

  const SURF_NAMES = ['tarmac', 'concrete', 'cobbles', 'kerb', 'gravel', 'dirt', 'grass', 'sand'];
  const roadSurfName = (code: number) => ({ 1: 'tarmac', 2: 'concrete', 3: 'cobbles', 4: 'gravel', 5: 'dirt', 6: 'grass', 7: 'sand' })[code] ?? 'tarmac';
  const groundSurf = (cls: string) => cls === 'sand' ? 'sand' : cls === 'rock' ? 'gravel' : cls === 'parking' ? 'tarmac' : 'grass';

  function tile(i: number, j: number): Tile {
    const cx = (i + 0.5) * T, cz = (j + 0.5) * T, x0 = i * T, z0 = j * T, half = T / 2, key = bucketKey(i, j), b = buckets.get(key) ?? B(key);
    const [oc, or] = [(i - g.i0) * per, (j - g.j0) * per];
    const at = (c: number, r: number) => (or + r) * g.W + (oc + c);
    // ---- heightfield (column by column, as Rapier and the terrain mesher take it), colours, surfaces
    const heights = new Float32Array(N1 * N1), terrain = new Uint8Array(N1 * N1), palette: number[][] = [], palIdx = new Map<string, number>();
    const srcCount = [0, 0, 0, 0];
    for (let c = 0; c < N1; c++) for (let r = 0; r < N1; r++) heights[r + c * N1] = D.heights[at(c, r)];
    for (let r = 0; r < N1; r++) for (let c = 0; c < N1; c++) {
      const k = at(c, r), name = D.classNames[D.classes[k]];
      srcCount[D.demSource[k]]++;
      let col = name === 'water' ? pal.underwater ?? pal.default : pal[name] ?? pal.default;
      if (name !== 'water' && !D.roadSurface[k]) {
        const c0 = Math.max(0, c - 1), c1 = Math.min(per, c + 1), r0 = Math.max(0, r - 1), r1 = Math.min(per, r + 1);
        const slope = Math.hypot((D.heights[at(c1, r)] - D.heights[at(c0, r)]) / ((c1 - c0) * g.cell), (D.heights[at(c, r1)] - D.heights[at(c, r0)]) / ((r1 - r0) * g.cell));
        if (slope > cfg.terrain.rockSlope) col = pal.rock ?? col;
      }
      const ck = col.join(',');
      if (!palIdx.has(ck)) { palIdx.set(ck, palette.length); palette.push(col.slice(0, 3)); }
      terrain[r * N1 + c] = palIdx.get(ck)!;
    }
    // which elevation source each point's from (0 sea, 1 LiDAR, 2 Copernicus, 3 the blend between)
    const demGrid = new Uint8Array(N1 * N1);
    for (let r = 0; r < N1; r++) for (let c = 0; c < N1; c++) demGrid[r * N1 + c] = D.demSource[at(c, r)];
    const surface = new Uint8Array(per * per);
    for (let r = 0; r < per; r++) for (let c = 0; c < per; c++) { const k = at(c, r), rs = D.roadSurface[k]; surface[r * per + c] = SURF_NAMES.indexOf(rs ? roadSurfName(rs) : groundSurf(D.classNames[D.classes[k]])); }
    // ---- roads, junctions, markings (their triangles whose middles are here)
    const local = (M: Mesh, list: number[], withSurf: boolean) => {
      const part = new Part(false, withSurf), remap = new Map<number, number>();
      for (const t of list) {
        const ids = [M.indices[t], M.indices[t + 1], M.indices[t + 2]].map(v => { let k = remap.get(v); if (k === undefined) { k = part.vertex(M.positions[v * 3] - cx, M.positions[v * 3 + 1], M.positions[v * 3 + 2] - cz, M.colours.slice(v * 4, v * 4 + 4)); remap.set(v, k); } return k; });
        part.tri(ids[0], ids[1], ids[2], withSurf ? SURF_NAMES.indexOf(roadSurfName((M.surfaces[t / 3] ?? 0) + 1)) : 0);
      }
      return part;
    };
    const roads = local(D.mesh, b.road, true), marks = local(D.marks, b.mark, false);
    // ---- car parks: their surface (just over the ground they flattened), kerbs where no road meets them,
    // bay lines; and the tunnels' roofs (the natural ground over them)
    const paved = new Part(false, true), cover = new Part(false, true), water = new Part();
    const pk = pal.parking ?? [110, 110, 110], kerbC = [190, 188, 182], bayC = [230, 230, 224];
    for (const p of D.parking) {
      const [a, bb, pc] = p.plane, y = (x: number, z: number) => a * x + bb * z + pc + 0.02;
      p.bayY = y;
      // its surface: the grid's cells inside it (on its plane, 2 cm over the ground flattened to it), but not
      // where a road runs through it (the road's surface is the one there)
      let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
      for (const q of p.rings[0]) { bx0 = Math.min(bx0, q.x); bx1 = Math.max(bx1, q.x); bz0 = Math.min(bz0, q.z); bz1 = Math.max(bz1, q.z); }
      if (bx1 < x0 || bx0 > x0 + T || bz1 < z0 || bz0 > z0 + T) continue;
      const c0 = Math.max(0, Math.floor((bx0 - x0) / g.cell)), c1 = Math.min(per - 1, Math.ceil((bx1 - x0) / g.cell)), r0 = Math.max(0, Math.floor((bz0 - z0) / g.cell)), r1 = Math.min(per - 1, Math.ceil((bz1 - z0) / g.cell));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const x = x0 + (c + 0.5) * g.cell, z = z0 + (r + 0.5) * g.cell;
        if (!inPoly(x, z, p.rings)) continue;
        const ks = [at(c, r), at(c + 1, r), at(c + 1, r + 1), at(c, r + 1)];
        if (ks.some(k => D.roadSurface[k] && !D.parkingCell[k])) continue;
        const v = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([dc, dr]) => { const X = x0 + (c + dc) * g.cell, Z = z0 + (r + dr) * g.cell; return paved.vertex(X - cx, y(X, Z), Z - cz, pk); });
        paved.upTri(v[0], v[1], v[2], SURF_NAMES.indexOf('tarmac')); paved.upTri(v[0], v[2], v[3], SURF_NAMES.indexOf('tarmac'));
      }
      // kerbs round it (0.12 m high, 0.25 wide), open where a road comes in
      const ring = p.rings[0];
      for (let q = 0; q < ring.length; q++) {
        const A = ring[q], Bp = ring[(q + 1) % ring.length], l = Math.hypot(Bp.x - A.x, Bp.z - A.z);
        for (let s = 0; s < l; s += 2) {
          const t0 = s / l, t1 = Math.min(1, (s + 2) / l), xa = A.x + (Bp.x - A.x) * t0, za = A.z + (Bp.z - A.z) * t0, xb = A.x + (Bp.x - A.x) * t1, zb = A.z + (Bp.z - A.z) * t1, mx = (xa + xb) / 2, mz = (za + zb) / 2;
          if (Math.floor(mx / T) !== i || Math.floor(mz / T) !== j) continue;
          const cc = Math.round((mx - g.x0) / g.cell), rr = Math.round((mz - g.z0) / g.cell), onRoad = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => { const k = (rr + dr) * g.W + cc + dc; return D.roadSurface[k] && !D.parkingCell[k]; });
          if (onRoad) continue;
          const nx = -(zb - za) / (l * (t1 - t0) || 1) * 0.125, nz = (xb - xa) / (l * (t1 - t0) || 1) * 0.125, ya = y(xa, za), yb = y(xb, zb);
          const v = [[xa - nx, ya + 0.12, za - nz], [xb - nx, yb + 0.12, zb - nz], [xb + nx, yb + 0.12, zb + nz], [xa + nx, ya + 0.12, za + nz]].map(p3 => paved.vertex(p3[0] - cx, p3[1], p3[2] - cz, kerbC));
          const kc = SURF_NAMES.indexOf('kerb');
          paved.upTri(v[0], v[1], v[2], kc); paved.upTri(v[0], v[2], v[3], kc);
          for (const [e0, e1] of [[0, 1], [3, 2]]) { const lo0 = paved.vertex(paved.positions[v[e0] * 3], paved.positions[v[e0] * 3 + 1] - 0.16, paved.positions[v[e0] * 3 + 2], kerbC), lo1 = paved.vertex(paved.positions[v[e1] * 3], paved.positions[v[e1] * 3 + 1] - 0.16, paved.positions[v[e1] * 3 + 2], kerbC); paved.tri(v[e0], v[e1], lo1, kc); paved.tri(v[e0], lo1, lo0, kc); paved.tri(v[e0], lo1, v[e1], kc); paved.tri(v[e0], lo0, lo1, kc); }
        }
      }
      p.bayY = y;
    }
    // bay lines: each mapped parking space's outline, painted on the car park it's in
    for (const bay of D.bays) {
      let mx = 0, mz = 0; for (const q of bay) { mx += q.x; mz += q.z; } mx /= bay.length; mz /= bay.length;
      if (Math.floor(mx / T) !== i || Math.floor(mz / T) !== j) continue;
      const host = D.parking.find(p => inPoly(mx, mz, p.rings));
      const y = host ? host.bayY : (x: number, z: number) => ground(x, z) + 0.03;
      for (let q = 0; q < bay.length; q++) {
        const A = bay[q], Bq = bay[(q + 1) % bay.length], l = Math.hypot(Bq.x - A.x, Bq.z - A.z) || 1, nx = -(Bq.z - A.z) / l * 0.06, nz = (Bq.x - A.x) / l * 0.06;
        const v = [[A.x - nx, A.z - nz], [Bq.x - nx, Bq.z - nz], [Bq.x + nx, Bq.z + nz], [A.x + nx, A.z + nz]].map(([x, z]) => marks.vertex(x - cx, y(x, z) + 0.01, z - cz, bayC));
        marks.upTri(v[0], v[1], v[2]); marks.upTri(v[0], v[2], v[3]);
      }
    }
    for (let r = 0; r < per; r++) for (let c = 0; c < per; c++) {
      const ks = [at(c, r), at(c + 1, r), at(c + 1, r + 1), at(c, r + 1)];
      if (ks.some(k => D.cover[k] !== D.cover[k])) continue;
      const v = ks.map((k, q) => cover.vertex(-half + (c + (q === 1 || q === 2 ? 1 : 0)) * g.cell, D.cover[k], -half + (r + (q >= 2 ? 1 : 0)) * g.cell, pal.default));
      cover.upTri(v[0], v[1], v[2], SURF_NAMES.indexOf('grass')); cover.upTri(v[0], v[2], v[3], SURF_NAMES.indexOf('grass'));
    }
    // ---- water: flat at its level, clipped to the tile
    for (const w of D.water) {
      const rings = w.rings.map(r => clipRing(r.map(q => [q.x, q.z]), x0, z0, x0 + T, z0 + T)).filter(r => r.length >= 3);
      if (!rings.length || rings[0].length < 3) continue;
      const flat = rings.flat(), holes: number[] = []; let n = 0;
      rings.forEach((r, k) => { if (k) holes.push(n); n += r.length; });
      const tris = earcut(flat.flat(), holes), ids = flat.map(q => water.vertex(q[0] - cx, w.level, q[1] - cz, [63, 127, 176]));
      for (let t = 0; t < tris.length; t += 3) water.upTri(ids[tris[t]], ids[tris[t + 1]], ids[tris[t + 2]]);
    }
    // ---- buildings (each in the tile its middle's in)
    const wallsBy: Record<string, Part> = {}, roofs = new Part(), hulls: number[] = [], landmarks: any[] = [];
    const bCfg = cfg.buildings;
    let buildingCount = 0, estimatedHeights = 0;
    for (const k of b.buildings) {
      const bd = D.buildings[k];
      // (a footprint the road runs right through is a passage, below: only corners standing on its edge move)
      const corner = (q: number[]) => { const [x, z] = offRoad(q[0], q[1]); return [x - cx, z - cz]; };
      const rings = bd.rings.map(r => r.map(q => corner(q)));
      const e = extrude({ id: bd.id, rings, props: bd.props }, (x: number, z: number) => ground(x + cx, z + cz), bCfg);
      if (!e) continue;
      buildingCount++; if (bd.estimated) estimatedHeights++;
      (wallsBy[e.windows] ??= new Part(true)).add(e.walls, 0, 0);
      roofs.add(e.roof, 0, 0);
      // (a road through it: solid only from its clearance up)
      const through = roadThrough(bd.rings[0]);
      for (const h of e.hulls) {
        // (a road passing through its height — not one far above it on a bridge, nor in a tunnel below)
        const inside = through.filter(y => y > h.y0 - 3 && y < h.y1 - 0.5);
        const y0 = inside.length ? Math.max(h.y0, Math.max(...inside) + PASSAGE) : h.y0;
        if (h.y1 - y0 > 0.5) hulls.push(h.points.length / 2, y0, h.y1, ...h.points);
      }
      if (e.landmark) landmarks.push({ id: bd.id, centre: [e.centre[0] + cx, e.centre[1] + cz], top: e.top, height: e.height, name: bd.props.name ?? null });
    }
    // ---- lists
    const names: string[] = [], nameOf = (s: string | null) => { if (!s) return -1; let k = names.indexOf(s); if (k < 0) { k = names.length; names.push(s); } return k; };
    const barrierLists = Object.fromEntries(Object.entries(b.barriers as Record<string, number[]>).map(([type, ks]) => [`barrier_${type}`, { stride: 8, quantum: 0.01, data: Float32Array.from(ks.flatMap(k => { const P = D.barriers[type]; return [P[k] - cx, P[k + 1], P[k + 2] - cz, P[k + 3] - cx, P[k + 4], P[k + 5] - cz, P[k + 6], P[k + 7]]; })) }]));
    const trees = b.trees.flatMap(k => [D.trees[k] - cx, D.trees[k + 1], D.trees[k + 2] - cz, D.trees[k + 3], D.trees[k + 4]]).slice(0, cfg.trees.maxPerTile * 5);
    const labels = b.labels.flatMap(k => { const L = D.labels.labels; return [L[k] - cx, L[k + 1], L[k + 2] - cz, L[k + 3], nameOf(D.labels.names[L[k + 4]]), L[k + 5]]; });
    const signs = b.signs.flatMap(k => { const S = D.labels.signs; return [S[k] - cx, S[k + 1], S[k + 2] - cz, S[k + 3], nameOf(D.labels.names[S[k + 4]]), nameOf(D.labels.names[S[k + 5]])]; });
    // the roads here, for where-am-I: [ax, az, bx, bz, name, rank, segment id] per piece of centreline
    const roadList: number[] = [];
    for (const id of [...b.segs].sort((p, q) => p - q)) { const s = D.segs[id]; for (let q = 0; q + 1 < s.xs.length; q++) { const mx = (s.xs[q] + s.xs[q + 1]) / 2, mz = (s.zs[q] + s.zs[q + 1]) / 2; if (Math.floor(mx / T) !== i || Math.floor(mz / T) !== j) continue; roadList.push(s.xs[q] - cx, s.zs[q] - cz, s.xs[q + 1] - cx, s.zs[q + 1] - cz, nameOf(s.name), s.rank, s.id); } }
    const best = srcCount.indexOf(Math.max(srcCount[1], srcCount[2], srcCount[3]));
    const demOf = (k: number) => k === 1 ? D.demSources.find(s => s.kind === 'lidar-dtm') : k === 2 ? D.demSources.find(s => s.kind === 'dsm') : null;
    const dem = best === 3 ? { name: `${demOf(1)?.name} + ${demOf(2)?.name} (blended)`, resolution: demOf(1)?.resolution } : srcCount[1] + srcCount[2] + srcCount[3] === 0 ? { name: 'sea', resolution: null } : { name: demOf(best)?.name, resolution: demOf(best)?.resolution };
    const meshes: Record<string, any> = {};
    for (const [name, p] of [['roads', roads], ['markings', marks], ['paved', paved], ['cover', cover], ['water', water], ['roofs', roofs], ...Object.entries(wallsBy).map(([k, p]) => [`walls_${k}`, p])] as [string, Part][]) if (!p.empty) meshes[name] = p.out();
    return {
      header: {
        region: D.region.id, key, i, j, size: T, centre: [cx, cz], names, landmarks, positionQuantum: 0.01,
        terrain: { palette, lodErrors: cfg.terrain.lodErrors },
        dem: { ...dem, share: { lidar: srcCount[1] / (N1 * N1), copernicus: srcCount[2] / (N1 * N1), blend: srcCount[3] / (N1 * N1), sea: srcCount[0] / (N1 * N1) } },
        stats: { buildings: buildingCount, estimatedHeights, roads: b.segs.size, trees: trees.length / 5, barriers: Object.fromEntries(Object.entries(b.barriers as Record<string, number[]>).map(([t, l]) => [t, l.length])), estimatedBarriers: Object.entries(b.barriers as Record<string, number[]>).reduce((n, [t, ks]) => n + ks.filter(k => D.barriers[t][k + 7] === 1).length, 0) },
      },
      meshes,
      lists: {
        trees: { stride: 5, quantum: 0.02, data: Float32Array.from(trees) }, hulls: { stride: 1, quantum: 0.02, data: Float32Array.from(hulls) },
        labels: { stride: 6, data: Float32Array.from(labels) }, signs: { stride: 6, data: Float32Array.from(signs) }, roads: { stride: 7, quantum: 0.02, data: Float32Array.from(roadList) },
        ...barrierLists,
      },
      grids: { surface: { n: per, cell: g.cell, names: SURF_NAMES, data: surface }, terrain: { n: N1, cell: g.cell, data: terrain }, dem: { n: N1, cell: g.cell, names: ['sea', 'lidar', 'copernicus', 'blend'], data: demGrid } },
      heightfield: { n: per, size: T, heights, quantum: 0.01 },
    };
  }

  // the far layer: 4096 m chunks — the ground every 16 m, tall buildings as blocks, landmarks whole
  const FAR = 4096, FCELL = 16;
  function far(a: number, bk: number): Tile {
    const n = FAR / FCELL, N = n + 1, cx = (a + 0.5) * FAR, cz = (bk + 0.5) * FAR, step = FCELL / g.cell;
    const heights = new Float32Array(N * N), terrain = new Uint8Array(N * N), palette: number[][] = [], palIdx = new Map<string, number>();
    for (let c = 0; c < N; c++) for (let r = 0; r < N; r++) {
      const x = cx - FAR / 2 + c * FCELL, z = cz - FAR / 2 + r * FCELL, gc = Math.round((x - g.x0) / g.cell), gr = Math.round((z - g.z0) / g.cell);
      const inside = gc >= 0 && gr >= 0 && gc < g.W && gr < g.H, k = gr * g.W + gc;
      heights[r + c * N] = inside ? Math.round(D.heights[k] * 10) / 10 : -1.5;
      const name = inside ? D.classNames[D.classes[k]] : 'water', col = name === 'water' ? pal.underwater ?? pal.default : pal[name] ?? pal.default, ck = col.join(',');
      if (!palIdx.has(ck)) { palIdx.set(ck, palette.length); palette.push(col.slice(0, 3)); }
      terrain[r * N + c] = palIdx.get(ck)!;
    }
    void step;
    const blocks = new Part(), lw = new Part(true), lr = new Part(), landmarks: any[] = [];
    D.buildings.forEach(bd => {
      const r0 = bd.rings[0]; let mx = 0, mz = 0; for (const p of r0) { mx += p[0]; mz += p[1]; } mx /= r0.length; mz /= r0.length;
      if (mx < cx - FAR / 2 || mx >= cx + FAR / 2 || mz < cz - FAR / 2 || mz >= cz + FAR / 2) return;
      if (!(bd.props.h >= 24) && !cfg.buildings.landmark.kinds.includes(bd.props.b)) return;
      const e = extrude({ id: bd.id, rings: bd.rings.map(r => r.map(q => [q[0] - cx, q[1] - cz])), props: bd.props }, (x: number, z: number) => ground(x + cx, z + cz), cfg.buildings);
      if (!e) return;
      if (e.landmark) { lw.add(e.walls, 0, 0); lr.add(e.roof, 0, 0); landmarks.push({ id: bd.id, centre: [e.centre[0] + cx, e.centre[1] + cz], top: e.top, height: e.height, name: bd.props.name ?? null }); return; }
      if (e.height < 24) return;
      blocks.add(e.walls, 0, 0); blocks.add(e.roof, 0, 0);
    });
    const meshes: Record<string, any> = {};
    if (!blocks.empty) { const o = blocks.out(); meshes.blocks = { ...o, uvs: null }; }
    if (!lw.empty) meshes.landmark_walls = lw.out();
    if (!lr.empty) meshes.landmark_roofs = lr.out();
    return { header: { region: D.region.id, key: `far_${a}_${bk}`, a, b: bk, size: FAR, centre: [cx, cz], far: true, landmarks, terrain: { palette, lodErrors: [1.8] } }, meshes, lists: {}, grids: { terrain: { n: N, cell: FCELL, data: terrain } }, heightfield: { n, size: FAR, heights, quantum: 0.1 } };
  }
  return { tile, far, FAR };
}
function inPoly(x: number, z: number, rings: { x: number; z: number }[][]) {
  let c = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if ((ring[i].z > z) !== (ring[j].z > z) && x < (ring[j].x - ring[i].x) * (z - ring[i].z) / (ring[j].z - ring[i].z) + ring[i].x) c = !c;
  return c;
}
