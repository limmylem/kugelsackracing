// Map v4's ground round the roads, in the region's one height grid (so the drawn terrain and the physics'
// heightfield, both cut from it, match), from the road surface model and nothing else:
//  · every grid point under a ground-level road triangle (ribbons, junction patches; tunnel mouths where the
//    ground over them is thin) is set `sink` m under the road's surface there; every point within `margin` m of
//    the surface (at least the grid cell's diagonal, so no terrain triangle that touches a road can rise into it)
//    `sink` m under the lowest road surface within that margin; beyond, sloping back to the natural ground (1 :
//    slope, over minBlend to maxBlend m — cuttings and embankments)
//  · bridges: the ground under every deck kept bridgeClearance under it (more, up to underBridge, away from the
//    deck's ends: a surface model often has the deck as ground)
//  · tunnels: where the ground over the road is more than tunnelCover, the grid lowered under the road and the
//    natural ground kept as the tunnel's roof (`cover`)
// The rest (land use, water, car parks, walls) is Map v3's shapeTerrain, run without roads first, once, for the
// whole region; the roads are then shaped in one block at a time (map/bake/bakeV4.ts: the road surface is built a
// block at a time), each from the unshaped ground in a window reaching past the block, kept only for the block's
// own grid points — so two blocks agree exactly on the points they share.
//
//   const T = terrainBaseV4({ grid, dem, osm, v3cfg })   → as v3's: heights, classes, cover, roadSurface (per grid
//     point: 0 none, else the surface code), parkingCell, water, parking; + road (Uint8: 1 under a road surface, 2
//     within its margin), shaped (a count)
//   shapeRoadsV4(T, { grid, dem, mesh (the block's road surface), model, cfg (v4), box: [x0, z0, x1, z1] })

import type { Grid } from '../format/grid.ts';
import type { OsmData } from './osmData.ts';
import { shapeTerrain } from './terrain.ts';
import { SURFACES } from '../model/surface.ts';

const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const SURF_CODE: Record<string, number> = { tarmac: 1, concrete: 2, cobbles: 3, gravel: 4, dirt: 5, grass: 6, sand: 7 };

export function terrainBaseV4({ grid: g, dem, osm, v3cfg }: { grid: Grid; dem: Float32Array; osm: OsmData; v3cfg: any }) {
  const T3 = shapeTerrain({ grid: g, dem, osm, nodes: [], segs: [], junctions: [], cfg: v3cfg.terrain });
  const N = g.W * g.H, parkingCell = new Uint8Array(N), roadSurface = new Uint8Array(N);
  // (what's underfoot: car parks until a road's shaped in)
  for (let k = 0; k < N; k++) if (T3.roadSurface[k]) { roadSurface[k] = T3.roadSurface[k]; parkingCell[k] = 1; }
  return { ...T3, base: Float32Array.from(T3.heights), coverBase: Float32Array.from(T3.cover), parkBase: Uint8Array.from(T3.roadSurface), roadSurface, parkingCell, road: new Uint8Array(N), shaped: 0 };
}

// share: m past the box whose ground is kept too (the next block works it out the same) — at least as far as what
// stands on the ground in the box's tiles reaches out
export function shapeRoadsV4(T: any, { grid: g, dem, mesh: M, model, cfg, box, share = 40, tube = null }: { grid: Grid; dem: Float32Array; mesh: any; model: any; cfg: any; box: [number, number, number, number]; share?: number; tube?: Uint8Array | null }) {
  const Tc = cfg.terrain, P = M.positions, I = M.indices;
  // ---- the window: the box and its share, and far enough past them that every road reaching their points is in
  const reachM = Tc.margin + Tc.maxBlend + share;
  const c0 = Math.max(0, Math.floor((box[0] - reachM - g.x0) / g.cell)), c1 = Math.min(g.W - 1, Math.ceil((box[2] + reachM - g.x0) / g.cell));
  const r0 = Math.max(0, Math.floor((box[1] - reachM - g.z0) / g.cell)), r1 = Math.min(g.H - 1, Math.ceil((box[3] + reachM - g.z0) / g.cell));
  const W = c1 - c0 + 1, Hh = r1 - r0 + 1, N = W * Hh;
  const G = (k: number) => (r0 + Math.floor(k / W)) * g.W + c0 + (k % W);            // (window point → grid point)
  const h = new Float32Array(N), cover = new Float32Array(N), surf = new Float32Array(N).fill(NaN), code = new Uint8Array(N), road = new Uint8Array(N), deck = new Float32Array(N).fill(Infinity);
  for (let k = 0; k < N; k++) { const q = G(k); h[k] = T.base[q]; cover[k] = T.coverBase[q]; }
  const xOf = (c: number) => g.x0 + (c0 + c) * g.cell, zOf = (r: number) => g.z0 + (r0 + r) * g.cell;
  // ---- 1. the road surface over every point (ground and tunnel level; bridges separately)
  const tunnelSegs = new Set(model.segs.filter((s: any) => s.structure === 'tunnel').map((s: any) => s.id));
  const forTri = (t: number, fn: (k: number, y: number) => void) => {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, ax = P[a], az = P[a + 2], bx = P[b], bz = P[b + 2], cx = P[c], cz = P[c + 2];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-12) return;
    const ca = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - g.x0) / g.cell) - c0), cb = Math.min(W - 1, Math.floor((Math.max(ax, bx, cx) - g.x0) / g.cell) - c0);
    const ra = Math.max(0, Math.ceil((Math.min(az, bz, cz) - g.z0) / g.cell) - r0), rb = Math.min(Hh - 1, Math.floor((Math.max(az, bz, cz) - g.z0) / g.cell) - r0);
    for (let r = ra; r <= rb; r++) for (let cc = ca; cc <= cb; cc++) {
      const x = xOf(cc), z = zOf(r), l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      fn(r * W + cc, l1 * P[a + 1] + l2 * P[b + 1] + l3 * P[c + 1]);
    }
  };
  // (a point over a tunnel's trench: the height of the tunnel road under it — what's shaped there for a road over the
  // hill is the ground over the tunnel, its cover, never the trench)
  const tunnelTris: number[] = [], trench = new Float32Array(N).fill(NaN);
  for (let t = 0; t < I.length; t += 3) {
    if (!M.solid[t / 3]) continue;
    const lv = M.level[t / 3], sg = M.seg[t / 3], sname = SURFACES[M.surfaces[t / 3]] ?? 'tarmac';
    if (lv === 1) { forTri(t, (k, y) => { deck[k] = Math.min(deck[k], y); }); continue; }
    if (lv === 2 || (sg >= 0 && tunnelSegs.has(sg))) {
      // (a tunnel: under thick ground, the grid kept clear under the road and the ground over it kept as its roof)
      // (Map v5: in the tube or not as its tube's triangles say — map/model/tunnels.ts — the trench under exactly them)
      const inTube = tube ? tube[t / 3] === 1 : null;
      forTri(t, (k, y) => { if (inTube ?? dem[G(k)] - y > Tc.tunnelCover) { if (cover[k] !== cover[k]) cover[k] = h[k]; h[k] = Math.min(h[k], y - 1); trench[k] = Math.min(trench[k] === trench[k] ? trench[k] : Infinity, y); } else { surf[k] = Number.isNaN(surf[k]) ? y : Math.min(surf[k], y); code[k] = SURF_CODE[sname] ?? 1; } });
      if (Tc.tunnelPad && inTube !== false) tunnelTris.push(t);
      continue;
    }
    forTri(t, (k, y) => { surf[k] = Number.isNaN(surf[k]) ? y : Math.min(surf[k], y); if (sname !== 'kerb') code[k] = SURF_CODE[sname] ?? 1; else code[k] ||= 1; });
  }
  // (Map v5, tunnelPad: the trench under thick ground widened tunnelPad m past the tunnel road's edges — clear of the
  // tube's walls (map/model/tunnels.ts), the ground over it kept as its roof — where no road's surface is)
  if (Tc.tunnelPad) for (const t of tunnelTris) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, ys = Math.min(P[a + 1], P[b + 1], P[c + 1]), pad = Tc.tunnelPad;
    const tx = [P[a], P[b], P[c]], tz = [P[a + 2], P[b + 2], P[c + 2]];
    const ca = Math.max(0, Math.ceil((Math.min(...tx) - pad - g.x0) / g.cell) - c0), cb = Math.min(W - 1, Math.floor((Math.max(...tx) + pad - g.x0) / g.cell) - c0);
    const ra = Math.max(0, Math.ceil((Math.min(...tz) - pad - g.z0) / g.cell) - r0), rb = Math.min(Hh - 1, Math.floor((Math.max(...tz) + pad - g.z0) / g.cell) - r0);
    for (let r = ra; r <= rb; r++) for (let cc = ca; cc <= cb; cc++) {
      const k = r * W + cc;
      // (not where an open road at about the tunnel's own level is — its approach, in a cutting — but under a road over
      // the hill, yes: that road's ground is the cover, shaped to it below)
      if ((surf[k] === surf[k] && surf[k] < ys + Tc.tunnelCover - 1) || dem[G(k)] - ys <= Tc.tunnelCover) continue;
      const x = xOf(cc), z = zOf(r);
      let d = Infinity;
      for (let e = 0; e < 3; e++) { const ex = tx[(e + 1) % 3] - tx[e], ez = tz[(e + 1) % 3] - tz[e], l2 = ex * ex + ez * ez || 1e-12, f = Math.max(0, Math.min(1, ((x - tx[e]) * ex + (z - tz[e]) * ez) / l2)); d = Math.min(d, Math.hypot(x - tx[e] - ex * f, z - tz[e] - ez * f)); }
      if (d > pad) continue;
      if (cover[k] !== cover[k]) cover[k] = h[k];
      h[k] = Math.min(h[k], ys - 1);
      trench[k] = Math.min(trench[k] === trench[k] ? trench[k] : Infinity, ys);
    }
  }
  // ---- 2. the nearest road point to every point near one (two-pass chamfer propagation of the nearest source)
  const src = new Int32Array(N).fill(-1);
  for (let k = 0; k < N; k++) if (surf[k] === surf[k]) { src[k] = k; road[k] = 1; }
  const reach = Tc.margin + Tc.maxBlend, d2of = (k: number, s: number) => { const dc = (k % W) - (s % W), dr = Math.floor(k / W) - Math.floor(s / W); return (dc * dc + dr * dr) * g.cell * g.cell; };
  const relax = (k: number, n: number) => { const s = src[n]; if (s < 0) return; if (src[k] < 0 || d2of(k, s) < d2of(k, src[k])) src[k] = s; };
  for (let r = 0; r < Hh; r++) for (let c = 0; c < W; c++) { const k = r * W + c; if (c > 0) relax(k, k - 1); if (r > 0) { relax(k, k - W); if (c > 0) relax(k, k - W - 1); if (c + 1 < W) relax(k, k - W + 1); } }
  for (let r = Hh - 1; r >= 0; r--) for (let c = W - 1; c >= 0; c--) { const k = r * W + c; if (c + 1 < W) relax(k, k + 1); if (r + 1 < Hh) { relax(k, k + W); if (c + 1 < W) relax(k, k + W + 1); if (c > 0) relax(k, k + W - 1); } }
  // (within the margin: under the lowest road surface within reach, not just the nearest — between two roads at
  // different heights the ground must be under both)
  const lowest = new Float32Array(N).fill(Infinity), mr = Math.ceil(Tc.margin / g.cell);
  for (let k = 0; k < N; k++) {
    if (road[k] !== 1) continue;
    const c = k % W, r = Math.floor(k / W), y = surf[k] - Tc.sink;
    for (let dr = -mr; dr <= mr; dr++) for (let dc = -mr; dc <= mr; dc++) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= W || rr >= Hh || (dc * dc + dr * dr) * g.cell * g.cell > Tc.margin * Tc.margin) continue;
      const q = rr * W + cc; if (y < lowest[q]) lowest[q] = y;
    }
  }
  // (and under the ground-level road's every edge within reach — sampled every metre along each triangle's sides, half a
  // metre further: its edges are its lowest points, and on a steep crossfall can be lower than any grid point under the
  // road near them; then no corner of a grid cell the road's edge crosses stands over it)
  const reachE = Tc.margin + 0.5;
  const under = (vx: number, vy: number, vz: number) => {
    const ca = Math.max(0, Math.ceil((vx - reachE - g.x0) / g.cell) - c0), cb = Math.min(W - 1, Math.floor((vx + reachE - g.x0) / g.cell) - c0);
    const ra = Math.max(0, Math.ceil((vz - reachE - g.z0) / g.cell) - r0), rb = Math.min(Hh - 1, Math.floor((vz + reachE - g.z0) / g.cell) - r0);
    for (let r = ra; r <= rb; r++) for (let cc = ca; cc <= cb; cc++) {
      const dx = xOf(cc) - vx, dz = zOf(r) - vz;
      if (dx * dx + dz * dz > reachE * reachE) continue;
      const q = r * W + cc; if (vy < lowest[q]) lowest[q] = vy;
    }
  };
  for (let t = 0; t < I.length; t += 3) {
    if (!M.solid[t / 3] || M.level[t / 3] !== 0 || (M.seg[t / 3] >= 0 && tunnelSegs.has(M.seg[t / 3]))) continue;
    for (let e = 0; e < 3; e++) {
      const a = I[t + e] * 3, b = I[t + (e + 1) % 3] * 3, L = Math.hypot(P[b] - P[a], P[b + 2] - P[a + 2]), n = Math.max(1, Math.ceil(L));
      for (let k = 0; k < n; k++) { const f = k / n; under(P[a] + (P[b] - P[a]) * f, P[a + 1] + (P[b + 1] - P[a + 1]) * f - Tc.sink, P[a + 2] + (P[b + 2] - P[a + 2]) * f); }
    }
  }
  // ---- 3. the ground: under the surface and its margin sink under it, then sloping back
  let shaped = 0;
  for (let k = 0; k < N; k++) {
    const s = src[k];
    if (s < 0) continue;
    const d = Math.sqrt(d2of(k, s));
    if (d > reach) continue;
    const top = surf[s] - Tc.sink;
    // (over a tube — Map v5 — its trench kept; the ground over it shaped instead, and only for a road well over the
    // tunnel, never the tunnel's own approach)
    if (trench[k] === trench[k]) {
      if (cover[k] !== cover[k] || top < trench[k] + Tc.tunnelCover - 1) continue;
      if (road[k] || d <= Tc.margin) { cover[k] = Math.min(top, lowest[k] >= trench[k] + Tc.tunnelCover - 1 ? lowest[k] : Infinity); continue; }
      const bl = Math.max(Tc.minBlend, Math.min(Tc.maxBlend, Math.abs(dem[G(k)] - top) * Tc.slope));
      if (d <= Tc.margin + bl) { const w = 1 - smoothstep(0, bl, d - Tc.margin); cover[k] = cover[k] + (top - cover[k]) * w; }
      continue;
    }
    if (road[k] || d <= Tc.margin) { h[k] = Math.min(top, lowest[k]); if (!road[k]) road[k] = 2; continue; }
    const blend = Math.max(Tc.minBlend, Math.min(Tc.maxBlend, Math.abs(dem[G(k)] - top) * Tc.slope));
    if (d <= Tc.margin + blend) { const w = 1 - smoothstep(0, blend, d - Tc.margin); h[k] = h[k] + (top - h[k]) * w; }
    // (a point within the margin of a road's edge, if not of any point under the road: under that edge too)
    if (lowest[k] < h[k]) h[k] = lowest[k];
  }
  // ---- 4. under bridges: the ground kept clear of the deck (more away from its ends, where it isn't a ground road)
  const bridgeEnds: number[][] = [];
  for (const sg of model.segs) if (sg.structure === 'bridge') for (const nk of [sg.from, sg.to]) { const n = model.nodes[nk]; if (n.ground) bridgeEnds.push([n.x, n.z]); }
  const EC = 64, endGrid = new Map<string, number[][]>();
  for (const p of bridgeEnds) { const key = `${Math.floor(p[0] / EC)},${Math.floor(p[1] / EC)}`; (endGrid.get(key) ?? endGrid.set(key, []).get(key)!).push(p); }
  const nearestEnd = (x: number, z: number) => { let best = 200; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const p of endGrid.get(`${Math.floor(x / EC) + a},${Math.floor(z / EC) + b}`) ?? []) best = Math.min(best, Math.hypot(p[0] - x, p[1] - z)); return best; };
  for (let k = 0; k < N; k++) {
    if (deck[k] === Infinity) continue;
    const clear = road[k] === 1 ? Tc.bridgeClearance : Math.max(Tc.bridgeClearance, Math.min(Tc.underBridge, nearestEnd(xOf(k % W), zOf(Math.floor(k / W))) * 0.35));
    if (h[k] > deck[k] - clear) h[k] = deck[k] - clear;
  }
  // (and a point just beside a deck: the deck's edge comes between grid points)
  for (let k = 0; k < N; k++) {
    if (deck[k] !== Infinity) continue;
    const c = k % W, r = Math.floor(k / W);
    let low = Infinity;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const cc = c + dc, rr = r + dr; if (cc < 0 || rr < 0 || cc >= W || rr >= Hh) continue; low = Math.min(low, deck[rr * W + cc]); }
    if (low !== Infinity && road[k] !== 1 && h[k] > low - Tc.bridgeClearance) h[k] = low - Tc.bridgeClearance;
  }
  // ---- 5. into the region's grid, to the centimetre (what the tiles store, exactly): the block's own points and those
  // within `share` m of it — as far as its tiles' buildings, railings and car parks look for the ground — which the next
  // block works out the same (every road within reach of them is in both windows: the window reaches share m further)
  const inBox = (x: number, z: number) => x >= box[0] - 1e-6 && x <= box[2] + 1e-6 && z >= box[1] - 1e-6 && z <= box[3] + 1e-6;
  const inShare = (x: number, z: number) => x >= box[0] - share && x <= box[2] + share && z >= box[1] - share && z <= box[3] + share;
  for (let k = 0; k < N; k++) {
    const x = xOf(k % W), z = zOf(Math.floor(k / W));
    if (!inShare(x, z)) continue;
    const q = G(k);
    T.heights[q] = Math.round(h[k] * 100) / 100;
    T.cover[q] = cover[k] === cover[k] ? Math.round(cover[k] * 100) / 100 : NaN;
    T.road[q] = road[k];
    // (what's underfoot: the road's surface where there is one; car parks elsewhere)
    if (code[k]) { T.roadSurface[q] = code[k]; T.parkingCell[q] = 0; } else if (T.parkBase[q]) { T.roadSurface[q] = T.parkBase[q]; T.parkingCell[q] = 1; } else { T.roadSurface[q] = 0; T.parkingCell[q] = 0; }
    if (road[k] && inBox(x, z)) shaped++;
  }
  T.shaped += shaped;
  return T;
}
