// Map v4's exclusion mask and road-surface index (the road surface model, map/model/): what keeps trees, lamps,
// railings, signs and buildings' colliders off the roads, from the model itself.
//
//   const S = surfaceIndex(model)        point queries against every solid road triangle (any layer):
//     S.heightsAt(x, z) → [{ y, level, seg }]   S.near(x, z, r, yLo?, yHi?) → is any road surface within r m (at a
//     height in [yLo, yHi])?
//   const X = exclusionMask(model, osm, bounds, cfg, tileSize)   a raster (cfg.exclusion.cell m) per tile, bits:
//     1 a road surface (any layer), 2 within buffer m of one, 4 under a bridge deck (its footprint + deckMargin),
//     8 a railway or a tunnel portal
//     X.at(x, z) → bits   X.tile(i, j) → { n, cell, data } (the tile's grid, for the file and the debug view)
//     X.crownFree(x, z, r) → nothing masked under a crown of radius r there (trees)

import type { OsmData } from '../bake/osmData.ts';

export const MASK = { road: 1, buffer: 2, deck: 4, rail: 8 } as const;

export function surfaceIndex(model: any, cell = 4) {
  const M = model.surface.mesh, P = M.positions, I = M.indices, grid = new Map<number, number[]>();
  const key = (a: number, b: number) => a * 1000003 + b;
  for (let t = 0; t < I.length; t += 3) {
    if (!M.solid[t / 3]) continue;
    const xs = [P[I[t] * 3], P[I[t + 1] * 3], P[I[t + 2] * 3]], zs = [P[I[t] * 3 + 2], P[I[t + 1] * 3 + 2], P[I[t + 2] * 3 + 2]];
    for (let a = Math.floor(Math.min(...xs) / cell); a <= Math.floor(Math.max(...xs) / cell); a++) for (let b = Math.floor(Math.min(...zs) / cell); b <= Math.floor(Math.max(...zs) / cell); b++) { const k = key(a, b); (grid.get(k) ?? grid.set(k, []).get(k)!).push(t); }
  }
  const inTri = (t: number, x: number, z: number) => {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, d = (P[b + 2] - P[c + 2]) * (P[a] - P[c]) + (P[c] - P[b]) * (P[a + 2] - P[c + 2]);
    if (Math.abs(d) < 1e-12) return null;
    const l1 = ((P[b + 2] - P[c + 2]) * (x - P[c]) + (P[c] - P[b]) * (z - P[c + 2])) / d, l2 = ((P[c + 2] - P[a + 2]) * (x - P[c]) + (P[a] - P[c]) * (z - P[c + 2])) / d, l3 = 1 - l1 - l2;
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) return null;
    return l1 * P[a + 1] + l2 * P[b + 1] + l3 * P[c + 1];
  };
  const heightsAt = (x: number, z: number) => {
    const out: { y: number; level: number; seg: number }[] = [];
    for (const t of grid.get(key(Math.floor(x / cell), Math.floor(z / cell))) ?? []) { const y = inTri(t, x, z); if (y != null) out.push({ y, level: M.level[t / 3], seg: M.seg[t / 3] }); }
    return out;
  };
  // (within r: the point and a ring of points round it — enough at the scales used: a trunk, a lamp's foot, a rail)
  const near = (x: number, z: number, r = 0, yLo = -Infinity, yHi = Infinity) => {
    const pts = r > 0 ? [[0, 0], ...Array.from({ length: 8 }, (_, a) => [Math.cos(a * Math.PI / 4) * r, Math.sin(a * Math.PI / 4) * r])] : [[0, 0]];
    return pts.some(([dx, dz]) => heightsAt(x + dx, z + dz).some(h => h.y >= yLo && h.y <= yHi));
  };
  // the solid road triangles over a box (plan [[x, z]×3] and their heights' range), for cutting colliders off the road
  const trianglesIn = (x0: number, z0: number, x1: number, z1: number) => {
    const seen = new Set<number>(), out: { pts: number[][]; yLo: number; yHi: number }[] = [];
    for (let a = Math.floor(x0 / cell); a <= Math.floor(x1 / cell); a++) for (let b = Math.floor(z0 / cell); b <= Math.floor(z1 / cell); b++) for (const t of grid.get(key(a, b)) ?? []) {
      if (seen.has(t)) continue;
      seen.add(t);
      const v = [I[t], I[t + 1], I[t + 2]];
      out.push({ pts: v.map(q => [P[q * 3], P[q * 3 + 2]]), yLo: Math.min(...v.map(q => P[q * 3 + 1])), yHi: Math.max(...v.map(q => P[q * 3 + 1])) });
    }
    return out;
  };
  return { heightsAt, near, trianglesIn };
}

export function exclusionMask(model: any, osm: OsmData, bounds: [number, number, number, number], cfg: any, tileSize: number) {
  const X = cfg.exclusion, cell = X.cell, per = Math.round(tileSize / cell), tiles = new Map<string, Uint8Array>();
  const tileOf = (x: number, z: number) => `${Math.floor(x / tileSize)}_${Math.floor(z / tileSize)}`;
  const inBounds = (x: number, z: number) => x >= bounds[0] - tileSize && x <= bounds[2] + tileSize && z >= bounds[1] - tileSize && z <= bounds[3] + tileSize;
  const set = (x: number, z: number, bit: number) => {
    if (!inBounds(x, z)) return;
    const i = Math.floor(x / tileSize), j = Math.floor(z / tileSize), k = `${i}_${j}`;
    let d = tiles.get(k); if (!d) { d = new Uint8Array(per * per); tiles.set(k, d); }
    const c = Math.min(per - 1, Math.floor((x - i * tileSize) / cell)), r = Math.min(per - 1, Math.floor((z - j * tileSize) / cell));
    d[r * per + c] |= bit;
  };
  const get = (x: number, z: number) => { const i = Math.floor(x / tileSize), j = Math.floor(z / tileSize), d = tiles.get(`${i}_${j}`); if (!d) return 0; const c = Math.min(per - 1, Math.max(0, Math.floor((x - i * tileSize) / cell))), r = Math.min(per - 1, Math.max(0, Math.floor((z - j * tileSize) / cell))); return d[r * per + c]; };
  // ---- every solid road triangle's cells (cells whose middles are in it), any layer; decks separately
  const M = model.surface.mesh, P = M.positions, I = M.indices;
  const fill = (t: number, fn: (x: number, z: number) => void) => {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, ax = P[a], az = P[a + 2], bx = P[b], bz = P[b + 2], cx = P[c], cz = P[c + 2];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-12) return;
    for (let x = Math.floor(Math.min(ax, bx, cx) / cell) * cell + cell / 2; x <= Math.max(ax, bx, cx); x += cell) for (let z = Math.floor(Math.min(az, bz, cz) / cell) * cell + cell / 2; z <= Math.max(az, bz, cz); z += cell) {
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      if (l1 >= -1e-9 && l2 >= -1e-9 && l1 + l2 <= 1 + 1e-9) fn(x, z);
    }
  };
  const roadCells: number[][] = [], deckCells: number[][] = [];
  for (let t = 0; t < I.length; t += 3) {
    if (!M.solid[t / 3]) continue;
    fill(t, (x, z) => { set(x, z, MASK.road); roadCells.push([x, z]); if (M.level[t / 3] === 1) deckCells.push([x, z]); });
    // (a thin triangle with no cell middle in it still marks the cell its own middle is in)
    const mx = (P[I[t] * 3] + P[I[t + 1] * 3] + P[I[t + 2] * 3]) / 3, mz = (P[I[t] * 3 + 2] + P[I[t + 1] * 3 + 2] + P[I[t + 2] * 3 + 2]) / 3;
    set(mx, mz, MASK.road);
  }
  // ---- buffers: round every road cell (buffer m), under every deck cell (deckMargin m)
  const disc = (x: number, z: number, r: number, bit: number) => { for (let dx = -r; dx <= r + 1e-9; dx += cell) for (let dz = -r; dz <= r + 1e-9; dz += cell) if (dx * dx + dz * dz <= r * r + 1e-9) set(x + dx, z + dz, bit); };
  for (const [x, z] of roadCells) disc(x, z, X.buffer, MASK.buffer);
  for (const [x, z] of deckCells) disc(x, z, X.deckMargin, MASK.deck);
  // ---- railways (their lines, railway m each side) and tunnel portals (portal m round each end that meets the ground)
  for (const w of osm.lines) {
    const r = w.tags.railway;
    if (!r || !['rail', 'light_rail', 'narrow_gauge', 'subway', 'monorail', 'preserved', 'funicular'].includes(r) || w.tags.tunnel === 'yes' || w.tags.bridge === 'yes') continue;
    for (let q = 0; q + 1 < w.nodes.length; q++) {
      const a = w.nodes[q], b = w.nodes[q + 1], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / cell));
      if (!inBounds(a.x, a.z) && !inBounds(b.x, b.z)) continue;
      for (let s = 0; s <= n; s++) disc(a.x + (b.x - a.x) * s / n, a.z + (b.z - a.z) * s / n, X.railway, MASK.rail);
    }
  }
  for (const g of model.segs) if (g.structure === 'tunnel') for (const nk of [g.from, g.to]) { const n = model.nodes[nk]; if (n.ground) disc(n.x, n.z, X.portal, MASK.rail); }
  return {
    at: get,
    tile: (i: number, j: number) => ({ n: per, cell, data: tiles.get(`${i}_${j}`) ?? new Uint8Array(per * per) }),
    // nothing masked (road, buffer, deck, railway) under a crown of radius r — its middle and two rings of points
    crownFree(x: number, z: number, r: number, bits = MASK.road | MASK.buffer | MASK.deck | MASK.rail) {
      if (get(x, z) & bits) return false;
      for (const f of [0.5, 1]) for (let a = 0; a < 12; a++) if (get(x + Math.cos(a * Math.PI / 6) * r * f, z + Math.sin(a * Math.PI / 6) * r * f) & bits) return false;
      return true;
    },
    tiles, tileOf,
  };
}
