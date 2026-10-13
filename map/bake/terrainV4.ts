// Map v4's ground round the roads, in the region's one height grid (so the drawn terrain and the physics'
// heightfield, both cut from it, match), from the road surface model and nothing else:
//  · every grid point under a ground-level road triangle (ribbons, junction patches; tunnel mouths where the
//    ground over them is thin) is set `sink` m under the road's surface there; every point within `margin` m of
//    the surface (at least the grid cell's diagonal, so no terrain triangle that touches a road can rise into it)
//    `sink` m under the nearest road point's height; beyond, sloping back to the natural ground (1 : slope, over
//    minBlend to maxBlend m — cuttings and embankments)
//  · bridges: the ground under every deck kept bridgeClearance under it (more, up to underBridge, away from the
//    deck's ends: a surface model often has the deck as ground)
//  · tunnels: where the ground over the road is more than tunnelCover, the grid lowered under the road and the
//    natural ground kept as the tunnel's roof (`cover`)
// The rest (land use, water, car parks, walls) is Map v3's shapeTerrain, run without roads first.
//
//   const T = shapeTerrainV4({ grid, dem, osm, model, cfg (v4), v3cfg })   → as v3's: heights, classes, cover,
//   roadSurface (per grid point: 0 none, else the surface code), parkingCell, water, parking; + road (Uint8: 1 under a
//   road surface, 2 within its margin)

import type { Grid } from '../format/grid.ts';
import type { OsmData } from './osmData.ts';
import { shapeTerrain } from './terrain.ts';
import { SURFACES } from '../model/surface.ts';

const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function shapeTerrainV4({ grid: g, dem, osm, model, cfg, v3cfg }: { grid: Grid; dem: Float32Array; osm: OsmData; model: any; cfg: any; v3cfg: any }) {
  const T3 = shapeTerrain({ grid: g, dem, osm, nodes: [], segs: [], junctions: [], cfg: v3cfg.terrain });
  const h = T3.heights, N = g.W * g.H, Tc = cfg.terrain, M = model.surface.mesh, P = M.positions, I = M.indices;
  // (shapeTerrain rounded to the centimetre: the roads' shaping below starts from that and rounds again)
  const surf = new Float32Array(N).fill(NaN), code = new Uint8Array(N), road = new Uint8Array(N), cover = T3.cover;
  const deck = new Float32Array(N).fill(Infinity);
  const SURF_CODE: Record<string, number> = { tarmac: 1, concrete: 2, cobbles: 3, gravel: 4, dirt: 5, grass: 6, sand: 7 };
  const xOf = (c: number) => g.x0 + c * g.cell, zOf = (r: number) => g.z0 + r * g.cell;
  // ---- 1. the road surface over every grid point (ground and tunnel level; bridges separately)
  const tunnelSegs = new Set(model.segs.filter((s: any) => s.structure === 'tunnel').map((s: any) => s.id));
  const forTri = (t: number, fn: (k: number, y: number) => void) => {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, ax = P[a], az = P[a + 2], bx = P[b], bz = P[b + 2], cx = P[c], cz = P[c + 2];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-12) return;
    const c0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - g.x0) / g.cell)), c1 = Math.min(g.W - 1, Math.floor((Math.max(ax, bx, cx) - g.x0) / g.cell));
    const r0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - g.z0) / g.cell)), r1 = Math.min(g.H - 1, Math.floor((Math.max(az, bz, cz) - g.z0) / g.cell));
    for (let r = r0; r <= r1; r++) for (let cc = c0; cc <= c1; cc++) {
      const x = xOf(cc), z = zOf(r), l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      fn(r * g.W + cc, l1 * P[a + 1] + l2 * P[b + 1] + l3 * P[c + 1]);
    }
  };
  for (let t = 0; t < I.length; t += 3) {
    if (!M.solid[t / 3]) continue;
    const lv = M.level[t / 3], sg = M.seg[t / 3], sname = SURFACES[M.surfaces[t / 3]] ?? 'tarmac';
    if (lv === 1) { forTri(t, (k, y) => { deck[k] = Math.min(deck[k], y); }); continue; }
    if (lv === 2 || (sg >= 0 && tunnelSegs.has(sg))) {
      // (a tunnel: under thick ground, the grid kept clear under the road and the ground over it kept as its roof)
      forTri(t, (k, y) => { if (dem[k] - y > Tc.tunnelCover) { if (cover[k] !== cover[k]) cover[k] = h[k]; h[k] = Math.min(h[k], y - 1); } else { surf[k] = Number.isNaN(surf[k]) ? y : Math.min(surf[k], y); code[k] = SURF_CODE[sname] ?? 1; } });
      continue;
    }
    forTri(t, (k, y) => { surf[k] = Number.isNaN(surf[k]) ? y : Math.min(surf[k], y); if (sname !== 'kerb') code[k] = SURF_CODE[sname] ?? 1; else code[k] ||= 1; });
  }
  // ---- 2. the nearest road point to every grid point near one (two-pass chamfer propagation of the nearest source)
  const src = new Int32Array(N).fill(-1);
  for (let k = 0; k < N; k++) if (surf[k] === surf[k]) { src[k] = k; road[k] = 1; }
  const reach = Tc.margin + Tc.maxBlend, d2of = (k: number, s: number) => { const dc = (k % g.W) - (s % g.W), dr = Math.floor(k / g.W) - Math.floor(s / g.W); return (dc * dc + dr * dr) * g.cell * g.cell; };
  const relax = (k: number, n: number) => { const s = src[n]; if (s < 0) return; if (src[k] < 0 || d2of(k, s) < d2of(k, src[k])) src[k] = s; };
  const W = g.W, Hh = g.H;
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
  // ---- 3. the ground: under the surface and its margin sink under it, then sloping back
  let shaped = 0;
  for (let k = 0; k < N; k++) {
    const s = src[k];
    if (s < 0) continue;
    const d = Math.sqrt(d2of(k, s));
    if (d > reach) continue;
    const top = surf[s] - Tc.sink;
    if (road[k] || d <= Tc.margin) { h[k] = Math.min(top, lowest[k]); if (!road[k]) road[k] = 2; shaped++; continue; }
    const blend = Math.max(Tc.minBlend, Math.min(Tc.maxBlend, Math.abs(dem[k] - top) * Tc.slope));
    if (d > Tc.margin + blend) continue;
    const w = 1 - smoothstep(0, blend, d - Tc.margin);
    h[k] = h[k] + (top - h[k]) * w;
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
  // (and a grid point just beside a deck: the deck's edge comes between grid points)
  for (let k = 0; k < N; k++) {
    if (deck[k] !== Infinity) continue;
    const c = k % W, r = Math.floor(k / W);
    let low = Infinity;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const cc = c + dc, rr = r + dr; if (cc < 0 || rr < 0 || cc >= W || rr >= Hh) continue; low = Math.min(low, deck[rr * W + cc]); }
    if (low !== Infinity && road[k] !== 1 && h[k] > low - Tc.bridgeClearance) h[k] = low - Tc.bridgeClearance;
  }
  // to the centimetre (what the tiles store, exactly)
  for (let k = 0; k < N; k++) { h[k] = Math.round(h[k] * 100) / 100; if (cover[k] === cover[k]) cover[k] = Math.round(cover[k] * 100) / 100; }
  // (what's underfoot: the road's surface where there is one; car parks elsewhere)
  const parkingCell = new Uint8Array(N), roadSurface = new Uint8Array(N);
  for (let k = 0; k < N; k++) { if (code[k]) roadSurface[k] = code[k]; else if (T3.roadSurface[k]) { roadSurface[k] = T3.roadSurface[k]; parkingCell[k] = 1; } }
  return { ...T3, heights: h, cover, roadSurface, parkingCell, road, deck, shaped };
}
