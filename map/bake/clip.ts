// Map v4: the road surface (built whole, in world coordinates: map/model/surface.ts) cut into tiles. Each triangle is
// clipped to the tile's square (Sutherland–Hodgman) and fanned again; a point where an edge crosses a border is worked
// out from the edge's two ends in one fixed order (whichever end sorts first), then put on the 1 cm grid — so the two
// tiles either side of a border get exactly the same vertices along it, and the surface carries on across it with no
// crack or step. Vertices shared within a tile are one vertex (the collision mesh is connected: Rapier's
// internal-edge fix needs that).
//
//   snapMesh(mesh, q)                       every position to the q m grid (world frame), once, before cutting
//   bucketTriangles(mesh, tileSize, pad)    tile key → the triangles touching that tile (its square grown by pad)
//   clipToBox(mesh, tris, box, { cx, cz, solidOnly, weld, q })  → { positions, colours, indices, surfaces } (tile-local)

import { welder } from '../model/surface.ts';

export function snapMesh(mesh: { positions: number[] }, q = 0.01) { const P = mesh.positions; for (let i = 0; i < P.length; i++) P[i] = Math.round(P[i] / q) * q; }

export function bucketTriangles(mesh: { positions: number[]; indices: number[] }, tileSize: number, pad = 0, keep: (t: number) => boolean = () => true) {
  const P = mesh.positions, I = mesh.indices, out = new Map<string, number[]>();
  for (let t = 0; t < I.length; t += 3) {
    if (!keep(t / 3)) continue;
    const xs = [P[I[t] * 3], P[I[t + 1] * 3], P[I[t + 2] * 3]], zs = [P[I[t] * 3 + 2], P[I[t + 1] * 3 + 2], P[I[t + 2] * 3 + 2]];
    const i0 = Math.floor((Math.min(...xs) - pad) / tileSize), i1 = Math.floor((Math.max(...xs) + pad) / tileSize), j0 = Math.floor((Math.min(...zs) - pad) / tileSize), j1 = Math.floor((Math.max(...zs) + pad) / tileSize);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = `${i}_${j}`; (out.get(k) ?? out.set(k, []).get(k)!).push(t); }
  }
  return out;
}

type V = [number, number, number, number, number, number, number];   // x, y, z, r, g, b, a
const order = (a: V, b: V) => (a[0] !== b[0] ? a[0] < b[0] : a[2] !== b[2] ? a[2] < b[2] : a[1] <= b[1]);
// where the edge a–b meets the line (axis = value): from its lower end, whichever way round it's given
function cross(a: V, b: V, axis: 0 | 2, value: number, q: number): V {
  const [p, r] = order(a, b) ? [a, b] : [b, a], t = (value - p[axis]) / (r[axis] - p[axis]);
  const out = p.map((v, k) => v + (r[k] - v) * t) as V;
  out[axis] = value;
  for (const k of [0, 1, 2]) if (k !== axis) out[k] = Math.round(out[k] / q) * q;
  for (const k of [3, 4, 5, 6]) out[k] = Math.round(out[k]);
  return out;
}
function clipPoly(poly: V[], axis: 0 | 2, value: number, keepBelow: boolean, q: number) {
  const out: V[] = [], inside = (v: V) => (keepBelow ? v[axis] <= value : v[axis] >= value);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) out.push(cross(a, b, axis, value, q));
  }
  return out;
}

export function clipToBox(mesh: { positions: number[]; colours: number[]; indices: number[]; surfaces?: number[]; solid?: number[] }, tris: number[], box: [number, number, number, number], { cx = 0, cz = 0, weld = true, q = 0.01 } = {}) {
  const P = mesh.positions, C = mesh.colours, I = mesh.indices, [x0, z0, x1, z1] = box;
  const positions: number[] = [], colours: number[] = [], indices: number[] = [], surfaces: number[] = [], ids = welder();
  // (welded by position on the q grid and colour: a vertex's number is its weld number, so a new one is the next)
  const vert = (v: V) => {
    if (weld) { const k = ids(Math.round(v[0] / q), Math.round(v[1] / q), Math.round(v[2] / q), (v[3] * 256 + v[4]) * 256 + v[5]); if (k < positions.length / 3) return k; }
    const k = positions.length / 3;
    positions.push(v[0] - cx, v[1], v[2] - cz); colours.push(v[3], v[4], v[5], v[6]);
    return k;
  };
  const get = (i: number): V => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2], C[i * 4], C[i * 4 + 1], C[i * 4 + 2], C[i * 4 + 3]];
  // (a vertex of the mesh as it is — what vert(get(i)) gives, with nothing made on the way)
  const vertOf = (i: number) => {
    if (weld) { const k = ids(Math.round(P[i * 3] / q), Math.round(P[i * 3 + 1] / q), Math.round(P[i * 3 + 2] / q), (C[i * 4] * 256 + C[i * 4 + 1]) * 256 + C[i * 4 + 2]); if (k < positions.length / 3) return k; }
    const k = positions.length / 3;
    positions.push(P[i * 3] - cx, P[i * 3 + 1], P[i * 3 + 2] - cz); colours.push(C[i * 4], C[i * 4 + 1], C[i * 4 + 2], C[i * 4 + 3]);
    return k;
  };
  for (const t of tris) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const mx = Math.min(P[a], P[b], P[c]), Mx = Math.max(P[a], P[b], P[c]), mz = Math.min(P[a + 2], P[b + 2], P[c + 2]), Mz = Math.max(P[a + 2], P[b + 2], P[c + 2]);
    if (Mx < x0 || mx > x1 || Mz < z0 || mz > z1) continue;
    // (wholly inside: as it is — most of them)
    if (mx >= x0 && Mx <= x1 && mz >= z0 && Mz <= z1) {
      const v0 = vertOf(I[t]), v1 = vertOf(I[t + 1]), v2 = vertOf(I[t + 2]);
      if (v0 === v1 || v1 === v2 || v0 === v2) continue;
      indices.push(v0, v1, v2);
      if (mesh.surfaces) surfaces.push(mesh.surfaces[t / 3]);
      continue;
    }
    const tri = [get(I[t]), get(I[t + 1]), get(I[t + 2])];
    let poly: V[] = tri;
    const xs = tri.map(v => v[0]), zs = tri.map(v => v[2]);
    if (Math.max(...xs) < x0 || Math.min(...xs) > x1 || Math.max(...zs) < z0 || Math.min(...zs) > z1) continue;
    if (Math.min(...xs) < x0) poly = clipPoly(poly, 0, x0, false, q);
    if (poly.length >= 3 && Math.max(...xs) > x1) poly = clipPoly(poly, 0, x1, true, q);
    if (poly.length >= 3 && Math.min(...zs) < z0) poly = clipPoly(poly, 2, z0, false, q);
    if (poly.length >= 3 && Math.max(...zs) > z1) poly = clipPoly(poly, 2, z1, true, q);
    if (poly.length < 3) continue;
    // (a fan from its first point — the polygon's convex: a triangle cut by a box)
    const v = poly.map(vert);
    for (let k = 1; k + 1 < v.length; k++) {
      if (v[0] === v[k] || v[k] === v[k + 1] || v[0] === v[k + 1]) continue;
      // (no area left: a sliver along the border, from the cut — the model's own stitches, uncut, are kept: they close
      // T-junctions)
      const ax = positions[v[0] * 3], az = positions[v[0] * 3 + 2], area = (positions[v[k] * 3] - ax) * (positions[v[k + 1] * 3 + 2] - az) - (positions[v[k + 1] * 3] - ax) * (positions[v[k] * 3 + 2] - az);
      if (Math.abs(area) < 1e-8 && (mesh.solid?.[t / 3] ?? 1) && poly !== tri) continue;
      indices.push(v[0], v[k], v[k + 1]);
      if (mesh.surfaces) surfaces.push(mesh.surfaces[t / 3]);
    }
  }
  return { positions, colours, indices, surfaces };
}
