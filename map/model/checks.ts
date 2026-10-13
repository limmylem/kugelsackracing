// Checks on Map v4's road surface (the tests, the bake's log and map/debug/): is it one watertight surface?
//   cracks     an edge of the surface that only one triangle has, lying along another such edge (a T-junction:
//              two pieces meeting with their vertices in different places — a crack light shows through)
//   overlaps   a spot two solid triangles of the same level cover, at heights within 0.5 m (z-fighting, a step)
//   steps      where two solid triangles share an edge's two ends in plan but not in height (a step)
//   folds      a road's outline (left edge out, right edge back) that crosses itself
//
//   checkSurface(mesh, segs?) → { triangles, boundaryEdges, cracks: [...], overlaps: [...], folds: [...] }

import { selfIntersects } from './geom.ts';
import { rowAt } from './geom.ts';
import { welder } from './surface.ts';

export function checkSurface(mesh: { positions: number[] | Float32Array; indices: number[] | Uint32Array; solid?: number[] | Uint8Array; level?: number[] | Uint8Array }, { segs = null as any[] | null, sampleEvery = 1, maxReports = 50, region = null as null | [number, number, number, number] } = {}) {
  const P = mesh.positions, I = mesh.indices;
  const inRegion = (x: number, z: number) => !region || (x >= region[0] && x <= region[2] && z >= region[1] && z <= region[3]);
  // (with a region, only the triangles reaching into it, or within a few metres: everything a point in it is judged by)
  const keep = new Uint8Array(I.length / 3);
  for (let t = 0; t < I.length; t += 3) {
    if (mesh.solid && !mesh.solid[t / 3]) continue;
    if (region) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, m = 4;
      if (Math.max(P[a], P[b], P[c]) < region[0] - m || Math.min(P[a], P[b], P[c]) > region[2] + m || Math.max(P[a + 2], P[b + 2], P[c + 2]) < region[1] - m || Math.min(P[a + 2], P[b + 2], P[c + 2]) > region[3] + m) continue;
    }
    keep[t / 3] = 1;
  }
  const solid = (t: number) => keep[t] === 1;
  // ---- welded edges (1 mm)
  const ids = welder(), pos: number[][] = [];
  const weld = (v: number) => { const i = ids(Math.round(P[v * 3] * 1000), Math.round(P[v * 3 + 1] * 1000), Math.round(P[v * 3 + 2] * 1000)); if (i === pos.length) pos.push([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]); return i; };
  const tw: number[] = [];
  let triangles = 0;
  for (let t = 0; t < I.length; t += 3) {
    if (!solid(t / 3)) continue;
    const a = weld(I[t]), b = weld(I[t + 1]), c = weld(I[t + 2]);
    if (a === b || b === c || a === c) continue;
    triangles++;
    tw.push(a, b, c);
  }
  // (each edge kept with its lower end: those only one triangle has are the outline)
  const NW = pos.length, deg = new Int32Array(NW + 1);
  for (let k = 0; k < tw.length; k += 3) for (let e = 0; e < 3; e++) deg[Math.min(tw[k + e], tw[k + (e + 1) % 3]) + 1]++;
  for (let p = 0; p < NW; p++) deg[p + 1] += deg[p];
  const fill = deg.slice(0, NW), other = new Int32Array(deg[NW]);
  for (let k = 0; k < tw.length; k += 3) for (let e = 0; e < 3; e++) { const p = tw[k + e], q = tw[k + (e + 1) % 3]; other[fill[Math.min(p, q)]++] = Math.max(p, q); }
  const boundary: number[][] = [];
  for (let p = 0; p < NW; p++) for (let i = deg[p]; i < deg[p + 1]; i++) { let c = 0; for (let j = deg[p]; j < deg[p + 1]; j++) if (other[j] === other[i]) c++; if (c === 1) boundary.push([p, other[i]]); }
  // ---- cracks: a boundary edge's vertex lying inside another boundary edge (in plan and height)
  const C = 2, grid = new Map<number, number[]>(), ck = (x: number, z: number) => (x + 1e6) * 2e6 + z + 1e6;
  boundary.forEach(([p, q], i) => { const a = pos[p], b = pos[q]; for (let x = Math.floor(Math.min(a[0], b[0]) / C); x <= Math.floor(Math.max(a[0], b[0]) / C); x++) for (let z = Math.floor(Math.min(a[2], b[2]) / C); z <= Math.floor(Math.max(a[2], b[2]) / C); z++) { const k = ck(x, z); (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); } });
  const cracks: any[] = [];
  let crackCount = 0;
  boundary.forEach(([p, q]) => {
    for (const v of [p, q]) {
      const pt = pos[v];
      if (!inRegion(pt[0], pt[2])) continue;
      for (const j of grid.get(ck(Math.floor(pt[0] / C), Math.floor(pt[2] / C))) ?? []) {
        const [r, s] = boundary[j];
        if (r === v || s === v) continue;
        const a = pos[r], b = pos[s], dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L2 = dx * dx + dz * dz;
        if (L2 < 1e-8) continue;
        const t = ((pt[0] - a[0]) * dx + (pt[2] - a[2]) * dz) / L2;
        if (t <= 0.001 || t >= 0.999) continue;
        const d = Math.abs((pt[0] - a[0]) * dz - (pt[2] - a[2]) * dx) / Math.sqrt(L2), dh = Math.abs(a[1] + dy * t - pt[1]);
        if (d < 0.003 && dh < 0.05) { crackCount++; if (cracks.length < maxReports) cracks.push({ at: [+pt[0].toFixed(2), +pt[1].toFixed(2), +pt[2].toFixed(2)], gap: +d.toFixed(4), step: +dh.toFixed(3) }); }
      }
    }
  });
  // ---- overlaps: each solid triangle's middle, covered by another solid triangle of its level near its height
  const TC = 4, tgrid = new Map<number, number[]>();
  for (let t = 0; t < I.length; t += 3) {
    if (!solid(t / 3)) continue;
    const xs = [I[t], I[t + 1], I[t + 2]].map(v => P[v * 3]), zs = [I[t], I[t + 1], I[t + 2]].map(v => P[v * 3 + 2]);
    for (let x = Math.floor(Math.min(...xs) / TC); x <= Math.floor(Math.max(...xs) / TC); x++) for (let z = Math.floor(Math.min(...zs) / TC); z <= Math.floor(Math.max(...zs) / TC); z++) { const k = ck(x, z); (tgrid.get(k) ?? tgrid.set(k, []).get(k)!).push(t); }
  }
  const overlaps: any[] = [];
  let overlapCount = 0, sampled = 0;
  for (let t = 0; t < I.length; t += 3 * sampleEvery) {
    if (!solid(t / 3)) continue;
    const v = [I[t], I[t + 1], I[t + 2]], cx = (P[v[0] * 3] + P[v[1] * 3] + P[v[2] * 3]) / 3, cy = (P[v[0] * 3 + 1] + P[v[1] * 3 + 1] + P[v[2] * 3 + 1]) / 3, cz = (P[v[0] * 3 + 2] + P[v[1] * 3 + 2] + P[v[2] * 3 + 2]) / 3;
    if (!inRegion(cx, cz)) continue;
    // (a sliver's middle sits on its own edges: not a sample)
    const area = Math.abs((P[v[1] * 3] - P[v[0] * 3]) * (P[v[2] * 3 + 2] - P[v[0] * 3 + 2]) - (P[v[2] * 3] - P[v[0] * 3]) * (P[v[1] * 3 + 2] - P[v[0] * 3 + 2])) / 2;
    if (area < 0.01) continue;
    sampled++;
    for (const u of tgrid.get(ck(Math.floor(cx / TC), Math.floor(cz / TC))) ?? []) {
      if (u === t || (mesh.level && mesh.level[u / 3] !== mesh.level[t / 3])) continue;
      const h = heightIn(P, I, u, cx, cz, 1e-4);
      if (h == null || Math.abs(h - cy) > 0.5) continue;
      overlapCount++;
      if (overlaps.length < maxReports) overlaps.push({ at: [+cx.toFixed(2), +cy.toFixed(2), +cz.toFixed(2)], dh: +(h - cy).toFixed(3) });
      break;
    }
  }
  // ---- folds: each road's outline
  const folds: any[] = [];
  if (segs) for (const g of segs) {
    if (g.internal || !g.nx) continue;
    const L = g.s[g.s.length - 1], s0 = Math.max(0, g.trim0), s1 = L - Math.max(0, g.trim1);
    if (s1 - s0 < 0.1) continue;
    const ss = [s0, ...g.s.filter((v: number) => v > s0 && v < s1), s1], rows = ss.map(s => rowAt(g, s));
    const left = rows.map(r => [r.x + r.nx * r.hwL * r.mitre, r.z + r.nz * r.hwL * r.mitre]), right = rows.map(r => [r.x - r.nx * r.hwR * r.mitre, r.z - r.nz * r.hwR * r.mitre]);
    // (after unfolding, a run of equal points is fine; the outline is what's drawn)
    const ring = dedupe([...left, ...right.reverse()]);
    if (ring.length >= 4 && selfIntersects(ring, 1e-6) && inRegion(g.xs[0], g.zs[0])) folds.push({ seg: g.id, name: g.name, at: [+g.xs[0].toFixed(1), +g.zs[0].toFixed(1)] });
  }
  return { triangles, boundaryEdges: boundary.length, cracks, crackCount, overlaps, overlapCount, sampled, folds };
}
const dedupe = (r: number[][]) => r.filter((p, i) => { const q = r[(i + 1) % r.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6; });
export function heightIn(P: ArrayLike<number>, I: ArrayLike<number>, t: number, x: number, z: number, eps = 0) {
  const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
  const d = (P[b + 2] - P[c + 2]) * (P[a] - P[c]) + (P[c] - P[b]) * (P[a + 2] - P[c + 2]);
  if (Math.abs(d) < 1e-12) return null;
  const l1 = ((P[b + 2] - P[c + 2]) * (x - P[c]) + (P[c] - P[b]) * (z - P[c + 2])) / d, l2 = ((P[c + 2] - P[a + 2]) * (x - P[c]) + (P[a] - P[c]) * (z - P[c + 2])) / d, l3 = 1 - l1 - l2;
  // (strictly inside, by eps of its own share: a shared edge isn't an overlap)
  if (l1 <= eps || l2 <= eps || l3 <= eps) return null;
  return l1 * P[a + 1] + l2 * P[b + 1] + l3 * P[c + 1];
}
