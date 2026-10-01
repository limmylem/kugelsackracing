// Low-poly shapes for the part generators, in the game's flat-shaded style: lists of triangles
// [[a, b, c], …] (each point [x, y, z], metres, +x left, +y up, +z forward), every one closed (no
// holes) so the importer can weigh it from its volume. Built on tools/content/shapes.mjs (box, lathe,
// extrude, sweep…) with what the mechanical parts need on top: bevelled boxes, capped tubes along
// paths with rounded bends, rings, prisms from any outline (concave too), aerofoils, and mirroring
// for left / right pairs.

import { ShapeUtils, Vector2 } from 'three';
import { box, lathe, moved, rotated, scaled } from '../../content/shapes.mjs';

export { box, lathe, moved, rotated, scaled };

// ---------- vectors ----------
export const add = (a, b) => a.map((v, i) => v + b[i]);
export const sub = (a, b) => a.map((v, i) => v - b[i]);
export const mul = (a, k) => a.map(v => v * k);
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = a => Math.hypot(...a);
export const unit = a => mul(a, 1 / (len(a) || 1));
export const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const centroid = pts => mul(pts.reduce(add, [0, 0, 0]), 1 / pts.length);
// (a triangle wound so its normal points along `want`)
export const facing = ([a, b, c], want) => dot(cross(sub(b, a), sub(c, a)), want) < 0 ? [a, c, b] : [a, b, c];

// ---------- transforms ----------
// Mirrored left to right (x → −x), still facing out
export const mirrorX = tris => tris.map(([a, b, c]) => [[-a[0], a[1], a[2]], [-c[0], c[1], c[2]], [-b[0], b[1], b[2]]]);
// The shape and its mirror image: a left / right pair from the left-hand one
export const pair = tris => [...tris, ...mirrorX(tris)];
// n copies turned round an axis through the origin
export const around = (tris, n, axis = 'x', phase = 0) => Array.from({ length: n }, (_, i) => rotated(tris, axis, phase + i * Math.PI * 2 / n)).flat();
// Turned so +y points along `dir` (a unit vector), then moved to `at`
export function aligned(tris, dir, at = [0, 0, 0]) {
  const d = unit(dir), up = [0, 1, 0], c = dot(up, d);
  if (c > 0.9999) return moved(tris, at);
  if (c < -0.9999) return moved(rotated(tris, 'x', Math.PI), at);
  const axis = unit(cross(up, d)), ang = Math.acos(c), s = Math.sin(ang), k = 1 - Math.cos(ang);
  const R = p => add(add(mul(p, Math.cos(ang)), mul(cross(axis, p), s)), mul(axis, dot(axis, p) * k));
  return moved(tris.map(t => t.map(R)), at);
}
export const count = tris => tris.length;

// ---------- solids ----------

// A ring of points round an axis: n points at radius r, centre c, axis 'x' | 'y' | 'z', from angle a0
export function circle(c, r, n, axis = 'z', a0 = 0) {
  return Array.from({ length: n }, (_, i) => {
    const a = a0 + i * Math.PI * 2 / n, u = r * Math.cos(a), v = r * Math.sin(a);
    return axis === 'x' ? [c[0], c[1] + u, c[2] + v] : axis === 'y' ? [c[0] + u, c[1], c[2] + v] : [c[0] + u, c[1] + v, c[2]];
  });
}

// Rings of points (each the same count, in order round) joined into a closed solid: the side faces
// between neighbouring rings, and a cap over the first and last (a fan: convex rings)
export function loft(rings, { caps = true } = {}) {
  const out = [], n = rings[0].length, mids = rings.map(centroid);
  for (let i = 0; i + 1 < rings.length; i++) {
    const A = rings[i], B = rings[i + 1], m = lerp(mids[i], mids[i + 1], 0.5);
    for (let k = 0; k < n; k++) {
      const a = A[k], b = A[(k + 1) % n], c = B[(k + 1) % n], d = B[k];
      for (const t of [[a, b, c], [a, c, d]]) if (len(cross(sub(t[1], t[0]), sub(t[2], t[0]))) > 1e-12) out.push(facing(t, sub(centroid(t), m)));
    }
  }
  if (caps) {
    const cap = (ring, mid, away) => { for (let k = 0; k < n; k++) { const t = [mid, ring[k], ring[(k + 1) % n]]; if (len(cross(sub(t[1], t[0]), sub(t[2], t[0]))) > 1e-12) out.push(facing(t, away)); } };
    const L = rings.length - 1;
    cap(rings[0], mids[0], sub(mids[0], mids[1]));
    cap(rings[L], mids[L], sub(mids[L], mids[L - 1]));
  }
  return out;
}

// A cylinder along an axis from a to b (positions along it), radius r, `sides` faces round; centre
// offsets the axis line ([u, v] across it)
export function cylinder(axis, r, a, b, sides = 12, { at = [0, 0, 0], r2 = r, phase = Math.PI / sides } = {}) {
  const ring = (w, rr) => circle(axis === 'x' ? [w, 0, 0] : axis === 'y' ? [0, w, 0] : [0, 0, w], rr, sides, axis, phase).map(p => add(p, at));
  return loft([ring(a, r), ring(b, r2)]);
}

// A thick ring (a washer, a rim's lip) round an axis: inner and outer radius, from a to b along it
export function annulus(axis, rIn, rOut, a, b, sides = 24, at = [0, 0, 0]) {
  return lathe([[rIn, a], [rOut, a], [rOut, b], [rIn, b], [rIn, a]], sides, axis).map(t => t.map(p => add(p, at)));
}

// A doughnut round an axis: ring radius R, tube radius r
export function torus(axis, R, r, sides = 20, tubeSides = 6, at = [0, 0, 0]) {
  const prof = Array.from({ length: tubeSides + 1 }, (_, i) => { const a = i * Math.PI * 2 / tubeSides; return [R + r * Math.cos(a), r * Math.sin(a)]; });
  return lathe(prof, sides, axis).map(t => t.map(p => add(p, at)));
}

// A box with its edges chamfered by `bevel` (the game's slightly softened low-poly look); along
// `axis` the ends are chamfered too
export function bevelBox(min, max, bevel = 0.005) {
  const size = sub(max, min), b = Math.min(bevel, ...size.map(s => s * 0.3));
  if (b < 1e-4) return box(min, max);
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const oct = (z, i) => {
    const X0 = x0 + i, X1 = x1 - i, Y0 = y0 + i, Y1 = y1 - i, c = b;
    return [[X0 + c, Y0, z], [X1 - c, Y0, z], [X1, Y0 + c, z], [X1, Y1 - c, z], [X1 - c, Y1, z], [X0 + c, Y1, z], [X0, Y1 - c, z], [X0, Y0 + c, z]];
  };
  return loft([oct(z0, b), oct(z0 + b, 0), oct(z1 - b, 0), oct(z1, b)]);
}

// A prism: an outline [[u, v], …] (any simple polygon, concave too) in the plane across `axis`, pushed
// from a to b along it, capped. (u, v) is (y, z) across x, (x, z) across y, (x, y) across z.
export function prism(outline, a, b, axis = 'x') {
  const at = (u, v, w) => axis === 'x' ? [w, u, v] : axis === 'y' ? [u, w, v] : [u, v, w];
  const ax = axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1], dir = b > a ? 1 : -1;
  let pts = outline.map(p => [p[0], p[1]]);
  if (pts.length > 2 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts = pts.slice(0, -1);
  const n = pts.length, area = pts.reduce((s, p, i) => { const q = pts[(i + 1) % n]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2, sgn = area >= 0 ? 1 : -1;
  const out = [];
  // sides: each edge's outward normal in the plane, in 3D
  for (let i = 0; i < n; i++) {
    const [u0, v0] = pts[i], [u1, v1] = pts[(i + 1) % n], nu = (v1 - v0) * sgn, nv = -(u1 - u0) * sgn;
    const want = sub(at(nu, nv, 0), at(0, 0, 0)), A = at(u0, v0, a), B = at(u1, v1, a), C = at(u1, v1, b), D = at(u0, v0, b);
    out.push(facing([A, B, C], want), facing([A, C, D], want));
  }
  // caps: triangulated (three.js ear clipping), facing out of each end
  const faces = ShapeUtils.triangulateShape(pts.map(([u, v]) => new Vector2(u, v)), []);
  for (const [i, j, k] of faces) {
    out.push(facing([at(...pts[i], a), at(...pts[j], a), at(...pts[k], a)], mul(ax, -dir)));
    out.push(facing([at(...pts[i], b), at(...pts[j], b), at(...pts[k], b)], mul(ax, dir)));
  }
  return out;
}

// ---------- tubes ----------

// A path's corners rounded: each inner corner replaced by an arc of `steps` segments, radius r (or
// less, where the legs are short)
export function roundPath(points, r, steps = 3) {
  if (points.length < 3 || r <= 0) return points;
  const out = [points[0]];
  for (let i = 1; i + 1 < points.length; i++) {
    const p = points[i], a = unit(sub(points[i - 1], p)), b = unit(sub(points[i + 1], p)), cosT = Math.min(1, Math.max(-1, dot(a, b)));
    const theta = Math.acos(cosT);
    if (theta > Math.PI - 0.02) { out.push(p); continue; }        // (straight on)
    const legMax = Math.min(len(sub(points[i - 1], p)), len(sub(points[i + 1], p))) * 0.45;
    const d = Math.min(r / Math.tan(theta / 2), legMax), p0 = add(p, mul(a, d)), p1 = add(p, mul(b, d));
    // a quadratic curve from p0 to p1 with p as its control point: close enough to an arc
    for (let s = 0; s <= steps; s++) { const t = s / steps; out.push(add(add(mul(p0, (1 - t) ** 2), mul(p, 2 * t * (1 - t))), mul(p1, t * t))); }
  }
  out.push(points.at(-1));
  return out;
}

// A round tube of radius r along a path (points), `sides` faces round, its ends capped; corners turn
// without twisting (parallel-transported frames). bend: round the path's corners to this radius first.
export function tube(path, r, { sides = 8, bend = 0, bendSteps = 3, closed = false } = {}) {
  const P = bend ? roundPath(path, bend, bendSteps) : path;
  if (closed) return closedTube(P, r, sides);
  const tangents = P.map((p, i) => unit(sub(P[Math.min(i + 1, P.length - 1)], P[Math.max(i - 1, 0)])));
  let u = Math.abs(tangents[0][1]) < 0.9 ? unit(cross(tangents[0], [0, 1, 0])) : unit(cross(tangents[0], [1, 0, 0]));
  const rings = [];
  for (let i = 0; i < P.length; i++) {
    const t = tangents[i];
    u = unit(sub(u, mul(t, dot(u, t))));
    const v = cross(t, u);
    rings.push(Array.from({ length: sides }, (_, s) => { const a = (s + 0.5) * Math.PI * 2 / sides; return add(P[i], add(mul(u, r * Math.cos(a)), mul(v, r * Math.sin(a)))); }));
  }
  return loft(rings);
}
// (a loop of tube: no caps, the last ring joined to the first)
function closedTube(P, r, sides) {
  const n = P.length, out = [];
  const rings = P.map((p, i) => {
    const t = unit(sub(P[(i + 1) % n], P[(i - 1 + n) % n])), up = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], u = unit(cross(t, up)), v = cross(t, u);
    return Array.from({ length: sides }, (_, s) => { const a = (s + 0.5) * Math.PI * 2 / sides; return add(p, add(mul(u, r * Math.cos(a)), mul(v, r * Math.sin(a)))); });
  });
  for (let i = 0; i < n; i++) {
    const A = rings[i], B = rings[(i + 1) % n], m = lerp(P[i], P[(i + 1) % n], 0.5);
    for (let k = 0; k < sides; k++) {
      const a = A[k], b = A[(k + 1) % sides], c = B[(k + 1) % sides], d = B[k];
      out.push(facing([a, b, c], sub(centroid([a, b, c]), m)), facing([a, c, d], sub(centroid([a, c, d]), m)));
    }
  }
  return out;
}
// A straight tube from a to b
export const rod = (a, b, r, sides = 8) => tube([a, b], r, { sides });

// A flat bar (a rectangle w × h across it) along a path, ends capped: brackets, rails, straps
export function bar(path, w, h, { bend = 0, up = [0, 1, 0] } = {}) {
  const P = bend ? roundPath(path, bend) : path, rings = [];
  for (let i = 0; i < P.length; i++) {
    const t = unit(sub(P[Math.min(i + 1, P.length - 1)], P[Math.max(i - 1, 0)]));
    let u = cross(t, up); if (len(u) < 1e-6) u = cross(t, [1, 0, 0]); u = unit(u);
    const v = cross(u, t);
    rings.push([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => add(P[i], add(mul(u, a * w / 2), mul(v, b * h / 2)))));
  }
  return loft(rings);
}

// ---------- profiles ----------

// An aerofoil's outline across the span, [[y, z], …] (prism(…, 'x') makes the wing): chord from z =
// lead (front) back to lead − chord, `thick` of the chord thick, cambered so it pushes down (the flat
// side up, like a race wing), at height y0; angle (degrees) tips the trailing edge up
export function aerofoil(chord, thick = 0.12, { lead = 0, y0 = 0, camber = 0.04, angle = 0, n = 6 } = {}) {
  const t = thick * chord, top = [], bottom = [];
  for (let i = 0; i <= n; i++) {
    const x = i / n, th = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4), c = -camber * chord * 4 * x * (1 - x);
    top.push([c + th, x]); bottom.push([c - th, x]);
  }
  const a = angle * Math.PI / 180;
  const pts = [...top, ...bottom.slice(1, -1).reverse()].map(([y, x]) => {
    const z = -x * chord, yy = y;
    return [y0 + yy * Math.cos(a) - z * Math.sin(a), lead + z * Math.cos(a) + yy * Math.sin(a)];
  });
  return pts;
}

// A rounded rectangle's outline [[u, v], …], corner radius r, `steps` per corner
export function roundedRect(w, h, r, steps = 2, [cu, cv] = [0, 0]) {
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4);
  const out = [], cs = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, Math.PI / 2], [-w / 2 + r, -h / 2 + r, Math.PI], [w / 2 - r, -h / 2 + r, Math.PI * 1.5]];
  for (const [x, y, a0] of cs) for (let s = 0; s <= steps; s++) { const a = a0 + (Math.PI / 2) * s / steps; out.push([cu + x + r * Math.cos(a), cv + y + r * Math.sin(a)]); }
  return out;
}
