// Map v4: building colliders kept off the roads. A building's collider is its footprint's convex pieces, foot to
// eaves (map/bake/extrude.ts). Where one reaches over a road surface at a height inside it (a footprint the road's
// width now overlaps, a passage under a building), the road wins: the piece minus the road surface (grown by
// roadClearance m) is what stays solid — cut into triangles, each a convex prism — or, if less than minHullArea m² is
// left, nothing (logged). Map v3 cut nothing: its colliders stood in lanes (MAP_V4_DIAGNOSIS.md, problem 3).
//
//   trimHulls(hulls (the tile's list: n, y0, y1, x, z…; tile-local), cx, cz, surface (map/model/mask.ts surfaceIndex),
//   cfg (v4 collision)) → { hulls, trimmed, dropped }

import * as Clipper from 'clipper2-js';
import libtess from 'libtess';

const S = 1000;
const path = (pts: number[][]) => { const p = new Clipper.Path64(); for (const [x, z] of pts) p.push(new Clipper.Point64(Math.round(x * S), Math.round(z * S))); if (Clipper.Clipper.area(p) < 0) p.reverse(); return p; };

export function trimHulls(H: ArrayLike<number>, cx: number, cz: number, surface: any, cfg: any) {
  const out: number[] = [], C = cfg.collision;
  let trimmed = 0, dropped = 0;
  for (let k = 0; k < H.length;) {
    const n = H[k], y0 = H[k + 1], y1 = H[k + 2], pts: number[][] = [];
    for (let q = 0; q < n; q++) pts.push([H[k + 3 + q * 2] + cx, H[k + 4 + q * 2] + cz]);
    k += 3 + n * 2;
    // (a sliver — a footprint's convex pieces can include one, metres long and a millimetre wide — is no building: as a
    // collider it's an invisible wall, its tip anywhere; gone, as the pieces trimmed below too small to matter)
    let a2 = 0; for (let q = 0; q < n; q++) { const p = pts[q], o = pts[(q + 1) % n]; a2 += p[0] * o[1] - o[0] * p[1]; }
    if (Math.abs(a2) / 2 < 0.25) { dropped++; continue; }
    const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]), r = C.roadClearance;
    // the road triangles reaching within r of it at a height within its span (slivers too: at the road's outer edge a
    // T-junction's stitch has no neighbour beyond it)
    const tris = surface.trianglesIn(Math.min(...xs) - r, Math.min(...zs) - r, Math.max(...xs) + r, Math.max(...zs) + r)
      .filter((t: any) => t.yHi > y0 - 0.3 && t.yLo < y1 && !apart(pts, t.pts, r));
    if (!tris.length) { out.push(n, y0, y1); for (const p of pts) out.push(p[0] - cx, p[1] - cz); continue; }
    // (each grown by r as a convex polygon of its own — its corners pushed out eight ways, their hull: Clipper's own
    // offsetting can hang on a soup of small triangles), together, taken off the piece
    const clip = new Clipper.Paths64();
    for (const t of tris) clip.push(path(convexHull(t.pts.flatMap((p: number[]) => OCT.map(([dx, dz]) => [p[0] + dx * r, p[1] + dz * r])))));
    const hull = new Clipper.Paths64(); hull.push(path(pts));
    const rest = Clipper.Clipper.Difference(hull, Clipper.Clipper.Union(clip, undefined, Clipper.FillRule.NonZero), Clipper.FillRule.NonZero);
    const before = Math.abs(Clipper.Clipper.area(hull[0])) / S / S, after = rest.reduce((a: number, p: any) => a + Clipper.Clipper.area(p), 0) / S / S;
    if (Math.abs(before - after) < 0.01) { out.push(n, y0, y1); for (const p of pts) out.push(p[0] - cx, p[1] - cz); continue; }
    if (after < C.minHullArea || after > before + 0.01) { dropped++; continue; }
    trimmed++;
    // (what's left, in triangles: each a convex piece — none with a corner still on the road at its height, a hair
    // in from the corner: the cut's last guard, the audit's own test)
    const onRoad = (x: number, z: number) => surface.heightsAt(x, z).some((h: any) => h.y > y0 - 0.3 && h.y < y1);
    for (const tri of tessellate(rest.map((p: any) => p.map((q: any) => [q.x / S, q.y / S])))) {
      if (area2(tri) / 2 < 0.25) continue;
      const mx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, mz = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
      if (onRoad(mx, mz) || tri.some(p => { const l = Math.hypot(p[0] - mx, p[1] - mz) || 1; return onRoad(p[0] - (p[0] - mx) / l * 0.1, p[1] - (p[1] - mz) / l * 0.1); })) continue;
      out.push(3, y0, y1); for (const p of tri) out.push(p[0] - cx, p[1] - cz);
    }
  }
  return { hulls: out, trimmed, dropped };
}

const OCT = Array.from({ length: 8 }, (_, a) => [Math.cos((a + 0.5) * Math.PI / 4) / Math.cos(Math.PI / 8), Math.sin((a + 0.5) * Math.PI / 4) / Math.cos(Math.PI / 8)]);
const area2 = (p: number[][]) => Math.abs((p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]));
// two convex polygons more than r apart along one of their sides' normals (then nothing of one is within r of the other)
function apart(A: number[][], B: number[][], r: number) {
  for (const poly of [A, B]) for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], nx = b[1] - a[1], nz = a[0] - b[0], L = Math.hypot(nx, nz);
    if (L < 1e-9) continue;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of A) { const d = (p[0] * nx + p[1] * nz) / L; if (d < a0) a0 = d; if (d > a1) a1 = d; }
    for (const p of B) { const d = (p[0] * nx + p[1] * nz) / L; if (d < b0) b0 = d; if (d > b1) b1 = d; }
    if (b0 > a1 + r || a0 > b1 + r) return true;
  }
  return false;
}
// a set of points' convex hull (Andrew's monotone chain), anticlockwise
function convexHull(pts: number[][]) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: number[][] = [], hi: number[][] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

let tess: any = null;
export function tessellate(rings: number[][][]) {
  if (!tess) {
    tess = new libtess.GluTesselator();
    tess.gluTessCallback(libtess.gluEnum.GLU_TESS_VERTEX_DATA, (d: number[], o: number[][]) => o.push(d));
    tess.gluTessCallback(libtess.gluEnum.GLU_TESS_BEGIN, () => {});
    tess.gluTessCallback(libtess.gluEnum.GLU_TESS_EDGE_FLAG, () => {});
    tess.gluTessCallback(libtess.gluEnum.GLU_TESS_COMBINE, (c: number[]) => [c[0], c[1]]);
    tess.gluTessProperty(libtess.gluEnum.GLU_TESS_WINDING_RULE, libtess.windingRule.GLU_TESS_WINDING_NONZERO);
    tess.gluTessNormal(0, 0, 1);
  }
  const o: number[][] = [];
  tess.gluTessBeginPolygon(o);
  for (const r of rings) { if (r.length < 3) continue; tess.gluTessBeginContour(); for (const p of r) tess.gluTessVertex([p[0], p[1], 0], p); tess.gluTessEndContour(); }
  tess.gluTessEndPolygon();
  const tris: number[][][] = [];
  for (let t = 0; t + 2 < o.length; t += 3) tris.push([o[t], o[t + 1], o[t + 2]]);
  return tris;
}
