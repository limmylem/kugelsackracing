// Geometry for Map v4's road surface model: a segment's cross-section at any distance along it (one function used
// by the ribbons, the junction patches, the terrain, the masks and the lamps — so they all agree), polylines and
// their intersections, polygons.
//
//   prepareNormals(g)             per point: the sideways unit normal (−dz, dx) of the way through it, and the mitre
//                                 scale (so a bend's edge stays parallel), unless a joint has set its end's
//   rowAt(g, s) → { x, z, nx, nz, ml, mr, hwL, hwR, dL, dR }   the cross-section s m along (from → to)
//   edgeAt(g, s, side, which)     a point of it: side +1 left / −1 right; which 'visual' | 'drivable' | number (×)

import type { Seg } from './graph.ts';

export function prepareNormals(g: Seg, maxMitre = 1.6) {
  const n = g.xs.length;
  g.nx ??= new Array(n); g.nz ??= new Array(n); g.mitre ??= new Array(n);
  for (let k = 0; k < n; k++) {
    if (g.fixedNormal?.[k]) continue;
    const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1);
    let x0 = g.xs[k] - g.xs[a], z0 = g.zs[k] - g.zs[a], x1 = g.xs[b] - g.xs[k], z1 = g.zs[b] - g.zs[k];
    const l0 = Math.hypot(x0, z0), l1 = Math.hypot(x1, z1);
    if (l0 < 1e-9) { x0 = x1; z0 = z1; } else { x0 /= l0; z0 /= l0; }
    if (l1 < 1e-9) { x1 = x0; z1 = z0; } else { x1 /= l1; z1 /= l1; }
    if (l0 < 1e-9 && l1 < 1e-9) { x0 = x1 = 1; z0 = z1 = 0; }
    let tx = x0 + x1, tz = z0 + z1, tl = Math.hypot(tx, tz);
    if (tl < 1e-6) { tx = x1; tz = z1; tl = 1; }
    tx /= tl; tz /= tl;
    // (the mitre: a bend's edges kept the same distance from both pieces either side, up to maxMitre)
    const cosHalf = Math.max(1e-6, tx * x1 + tz * z1);
    g.nx[k] = -tz; g.nz[k] = tx; g.mitre[k] = Math.min(maxMitre, 1 / cosHalf);
  }
}

export function indexAt(g: Seg, s: number) {
  const S = g.s, n = S.length;
  if (s <= 0) return 0;
  if (s >= S[n - 1]) return n - 2;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
  return Math.min(lo, n - 2);
}

export function rowAt(g: Seg, s: number) {
  const k = indexAt(g, s), S = g.s, span = (S[k + 1] - S[k]) || 1, t = Math.max(0, Math.min(1, (s - S[k]) / span)), L = S[S.length - 1];
  let x = g.xs[k] + (g.xs[k + 1] - g.xs[k]) * t, z = g.zs[k] + (g.zs[k + 1] - g.zs[k]) * t;
  // (past an end: straight on, along the last piece — a dead end's cap)
  if (s < 0 || s > L) { const e = s < 0 ? 0 : S.length - 1, o = s < 0 ? 1 : S.length - 2, dx = g.xs[e] - g.xs[o], dz = g.zs[e] - g.zs[o], l = Math.hypot(dx, dz) || 1, over = s < 0 ? -s : s - L; x = g.xs[e] + dx / l * over; z = g.zs[e] + dz / l * over; }
  let nx = g.nx[k] + (g.nx[k + 1] - g.nx[k]) * t, nz = g.nz[k] + (g.nz[k + 1] - g.nz[k]) * t;
  const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
  const mitre = g.mitre[k] + (g.mitre[k + 1] - g.mitre[k]) * t;
  const lerp = (a: number[]) => a[k] + (a[k + 1] - a[k]) * t;
  return { s, x, z, nx, nz, mitre, hwL: lerp(g.hwL), hwR: lerp(g.hwR), dL: lerp(g.dL), dR: lerp(g.dR) };
}

// a point of a row's cross-section: side +1 left (along the normal), −1 right; at `off` m from the centre line
export const at = (r: any, off: number) => [r.x + r.nx * off * r.mitre, r.z + r.nz * off * r.mitre];

// where two polylines cross first, walking along the first: { i, t, j, u, x, z } (piece i of a at t, piece j of b at u)
export function firstCrossing(a: number[][], b: number[][]) {
  let best: any = null;
  for (let i = 0; i + 1 < a.length; i++) {
    const p = a[i], r = [a[i + 1][0] - p[0], a[i + 1][1] - p[1]];
    for (let j = 0; j + 1 < b.length; j++) {
      const q = b[j], s = [b[j + 1][0] - q[0], b[j + 1][1] - q[1]], den = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(den) < 1e-12) continue;
      const t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den, u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den;
      if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) continue;
      if (!best || i + t < best.i + best.t) best = { i, t, j, u, x: p[0] + r[0] * t, z: p[1] + r[1] * t };
    }
    if (best && best.i === i) break;
  }
  return best;
}

export function polygonArea(ring: number[][]) { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]); return a / 2; }

// does a closed ring cross itself? (O(n²): the rings here are small)
export function selfIntersects(ring: number[][], eps = 1e-7) {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = ring[j], d = ring[(j + 1) % n];
      const d1 = orient(c, d, a), d2 = orient(c, d, b), d3 = orient(a, b, c), d4 = orient(a, b, d);
      if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) return true;
    }
  }
  return false;
}
const orient = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

export function pointInRings(x: number, z: number, rings: number[][][]) {
  let c = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if ((ring[i][1] > z) !== (ring[j][1] > z) && x < (ring[j][0] - ring[i][0]) * (z - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c;
  return c;
}

// the distance from a point to a segment, and where along it (0..1)
export function toSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-12, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2));
  return { d: Math.hypot(px - ax - dx * t, pz - az - dz * t), t };
}
