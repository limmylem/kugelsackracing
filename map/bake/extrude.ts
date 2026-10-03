// @ts-nocheck — the footprint extrusion ported as it was from v2 (tools/world/buildings.mjs, tested there)
// (Map v3: heights are decided before this — buildingHeights in map/bake/buildingMerge.ts — and come in as props.h)
// Buildings for the baked world: each footprint raised to its height (its height tag; else floors ×
// a storey; else the usual height for its kind, or for its footprint's size), its roof from its roof
// shape (flat, gabled, hipped, pyramidal, skillion, dome — flat when it isn't known, or the footprint is
// too irregular for the shape), coloured by its tags or a palette for its kind, its walls given window
// coordinates (one texture repeat a bay wide and a storey high) by the window pattern of its kind. Its
// collider: the footprint cut into convex pieces (so an L-shaped block doesn't fill its corner),
// each raised from its foot to its eaves.
//
//   extrude({ id, rings: [[[x, z], …], …] (outer, then holes), props }, ground(x, z), cfg) →
//     { style, windows, walls: Part, roof: Part, hulls: [{ points: [x, z, …], y0, y1 }], top, landmark }
//   Part: { positions: number[], colours: number[] (rgba bytes), uvs?: number[], indices: number[] }

import * as THREE from 'three';

const hashOf = id => { let h = (id % 2147483647) | 0; h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); return (h ^ (h >>> 15)) >>> 0; };
export const rgb = hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const ringArea = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a / 2; };
const clean = r => { const out = []; for (const p of r) { const l = out.at(-1); if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.05) out.push(p); } if (out.length > 2 && Math.hypot(out[0][0] - out.at(-1)[0], out[0][1] - out.at(-1)[1]) < 0.05) out.pop(); return out; };

// the smallest rectangle round a ring (rotating the hull's edges): { c: [x, z], u (long axis), half: [along, across], area }
function minRect(ring) {
  const pts = hull2d(ring);
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 1e-6) continue;
    const ux = (b[0] - a[0]) / l, uz = (b[1] - a[1]) / l;
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const p of pts) { const s = p[0] * ux + p[1] * uz, t = -p[0] * uz + p[1] * ux; s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
    const area = (s1 - s0) * (t1 - t0);
    if (!best || area < best.area) best = { area, ux, uz, s: [(s0 + s1) / 2, (s1 - s0) / 2], t: [(t0 + t1) / 2, (t1 - t0) / 2] };
  }
  if (!best) return null;
  let { ux, uz, s, t } = best;
  const c = [s[0] * ux - t[0] * uz, s[0] * uz + t[0] * ux];
  // long axis first
  if (t[1] > s[1]) return { c, u: [-uz, ux], half: [t[1], s[1]], area: best.area };
  return { c, u: [ux, uz], half: [s[1], t[1]], area: best.area };
}
export function hull2d(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// a footprint in triangles: [[a, b, c], …] as indices into its points (outer then holes, concatenated)
function triangulate(rings) {
  const v = r => r.map(([x, z]) => new THREE.Vector2(x, z));
  try { return THREE.ShapeUtils.triangulateShape(v(rings[0]), rings.slice(1).map(v)); } catch { return []; }
}
// The footprint in convex pieces (triangles merged across their shared edges while the result stays convex)
export function convexPieces(rings, tris) {
  const pts = rings.flat();
  let polys = tris.map(t => [...t]);
  const isConvex = poly => { let sign = 0; for (let i = 0; i < poly.length; i++) { const a = pts[poly[i]], b = pts[poly[(i + 1) % poly.length]], c = pts[poly[(i + 2) % poly.length]]; const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]); if (Math.abs(cr) < 1e-9) continue; const s = Math.sign(cr); if (sign && s !== sign) return false; sign = s; } return true; };
  if (polys.length > 400) return polys;          // (very complex footprints: triangles as they are)
  for (let merged = true; merged;) {
    merged = false;
    outer: for (let a = 0; a < polys.length; a++) for (let b = a + 1; b < polys.length; b++) {
      const A = polys[a], B = polys[b];
      for (let i = 0; i < A.length; i++) {
        const p = A[i], q = A[(i + 1) % A.length], j = B.findIndex((x, k) => x === q && B[(k + 1) % B.length] === p);
        if (j < 0) continue;
        // A … p q …, B … q p …: A's run from q round to p, then B's from p round to q, without repeats
        const out = [];
        for (let k = 0; k < A.length; k++) out.push(A[(i + 1 + k) % A.length]);
        for (let k = 2; k < B.length; k++) out.push(B[(j + k) % B.length]);
        if (!isConvex(out)) continue;
        polys[a] = out; polys.splice(b, 1); merged = true;
        break outer;
      }
    }
  }
  return polys;
}

// how tall, when the map doesn't say
export function heightOf(props, area, C) {
  if (props.h > 0) return props.h;
  const roofExtra = props.rs && props.rs !== 'flat' ? 1.5 : 0;
  if (props.fl > 0) return props.fl * C.storey + roofExtra;
  if (props.b && C.defaultHeight[props.b] != null) return C.defaultHeight[props.b];
  for (const [a, h] of C.byArea) if (area <= a) return h;
  return C.defaultHeight['*'];
}

class Part {
  constructor(uv) { this.positions = []; this.colours = []; this.uvs = uv ? [] : null; this.indices = []; }
  vertex(x, y, z, c, u = 0, v = 0) { this.positions.push(x, y, z); this.colours.push(c[0], c[1], c[2], 255); if (this.uvs) this.uvs.push(u, v); return this.positions.length / 3 - 1; }
  tri(a, b, c) { this.indices.push(a, b, c); }
}

export function extrude(b, ground, C) {
  const rings = b.rings.map(clean).filter(r => r.length >= 3);
  if (!rings.length) return null;
  // outer anticlockwise seen from above (x east, z south: positive area in this sum), holes the other way
  if (ringArea(rings[0]) < 0) rings[0].reverse();
  for (let k = 1; k < rings.length; k++) if (ringArea(rings[k]) > 0) rings[k].reverse();
  const area = Math.abs(ringArea(rings[0])) - rings.slice(1).reduce((a, r) => a + Math.abs(ringArea(r)), 0);
  if (area < 4) return null;
  const P = b.props, h0 = hashOf(b.id);
  const style = C.style[P.b] ?? 'default', pal = C.palettes[style] ?? C.palettes.default;
  const facade = rgb(P.fc ?? pal.facade[h0 % pal.facade.length]), roofC = rgb(P.rc ?? pal.roof[(h0 >>> 8) % pal.roof.length]);
  const shade = (c, k) => c.map(v => Math.max(0, Math.min(255, Math.round(v * k))));
  // the ground: lowest under its walls (they go down to it), and in its middle (heights are from there)
  const outer = rings[0];
  let gMin = Infinity, cx = 0, cz = 0;
  for (const [x, z] of outer) { gMin = Math.min(gMin, ground(x, z)); cx += x; cz += z; }
  cx /= outer.length; cz /= outer.length;
  const gC = ground(cx, cz), height = heightOf(P, area, C);
  const top = gC + height, foot = P.mh > 0 ? gC + P.mh : gMin - 0.4;
  if (top - foot < 1) return null;
  // the roof's shape: pitched ones only on footprints near enough to a rectangle
  let shape = ['gabled', 'hipped', 'pyramidal', 'skillion', 'dome', 'onion', 'round', 'half-hipped', 'gambrel', 'mansard', 'saltbox'].includes(P.rs) ? P.rs : 'flat';
  const rect = shape !== 'flat' ? minRect(outer) : null;
  if (['gabled', 'hipped', 'half-hipped', 'gambrel', 'mansard', 'saltbox', 'skillion'].includes(shape) && (!rect || rings.length > 1 || area / rect.area < 0.82 || outer.length > 12)) shape = 'flat';
  if (shape === 'half-hipped' || shape === 'mansard') shape = 'hipped';
  if (shape === 'gambrel' || shape === 'saltbox') shape = 'gabled';
  if (shape === 'round' || shape === 'onion') shape = 'dome';
  const short = rect ? 2 * rect.half[1] : Math.sqrt(area);
  const rh = shape === 'flat' ? 0 : Math.min(P.rh ?? (shape === 'pyramidal' ? 0.45 * short : shape === 'dome' ? 0.5 * short : shape === 'skillion' ? 0.18 * short : 0.32 * short), Math.max(0.5, (top - foot) * 0.6));
  const eave = top - rh;
  const walls = new Part(true), roof = new Part(false), storey = C.storey, bay = 3;
  // walls: each edge a quad from the foot to the eaves (the top of a skillion's slope)
  const along = rect ? (x, z) => (x - rect.c[0]) * rect.u[0] + (z - rect.c[1]) * rect.u[1] : () => 0;
  const across = rect ? (x, z) => -(x - rect.c[0]) * rect.u[1] + (z - rect.c[1]) * rect.u[0] : () => 0;
  const wallTop = shape === 'skillion' ? (x, z) => eave + rh * (across(x, z) / rect.half[1] + 1) / 2 : () => eave;
  for (const r of rings) {
    let s = 0;
    for (let i = 0; i < r.length; i++) {
      const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length], l = Math.hypot(bx - ax, bz - az);
      if (l < 0.05) continue;
      // (one colour for the whole building: the lighting shades its faces, and the corners are shared)
      const c = facade, ta = wallTop(ax, az), tb = wallTop(bx, bz);
      const v0 = walls.vertex(ax, foot, az, c, s / bay, (foot - gC) / storey), v1 = walls.vertex(bx, foot, bz, c, (s + l) / bay, (foot - gC) / storey);
      const v2 = walls.vertex(bx, tb, bz, c, (s + l) / bay, (tb - gC) / storey), v3 = walls.vertex(ax, ta, az, c, s / bay, (ta - gC) / storey);
      walls.tri(v0, v1, v2); walls.tri(v0, v2, v3);
      s += l;
    }
  }
  const tris = triangulate(rings), pts = rings.flat();
  if (shape === 'flat' || shape === 'skillion') {
    const base = roof.positions.length / 3;
    for (const [x, z] of pts) roof.vertex(x, wallTop(x, z), z, roofC);
    for (const [a, b2, c] of tris) roof.tri(base + a, base + c, base + b2);
  } else if (shape === 'pyramidal' || (shape !== 'dome' && !rect)) {
    const apex = roof.vertex(cx, top, cz, roofC);
    for (let i = 0; i < outer.length; i++) {
      const [ax, az] = outer[i], [bx, bz] = outer[(i + 1) % outer.length], k = 0.85 + 0.15 * (((bx - ax) + (bz - az)) / (Math.hypot(bx - ax, bz - az) || 1) * 0.5 + 0.5);
      const c = shade(roofC, k), a = roof.vertex(ax, eave, az, c), b2 = roof.vertex(bx, eave, bz, c), ap = roof.vertex(cx, top, cz, c);
      roof.tri(a, ap, b2);
    }
    void apex;
  } else if (shape === 'dome') {
    const steps = 4, ringPts = k => outer.map(([x, z]) => [cx + (x - cx) * Math.cos(k * Math.PI / 2 / steps), eave + rh * Math.sin(k * Math.PI / 2 / steps), cz + (z - cz) * Math.cos(k * Math.PI / 2 / steps)]);
    for (let k = 0; k < steps; k++) {
      const A = ringPts(k), B = ringPts(k + 1), c = shade(roofC, 0.85 + 0.15 * k / steps);
      for (let i = 0; i < outer.length; i++) {
        const j = (i + 1) % outer.length, a = roof.vertex(...A[i], c), b2 = roof.vertex(...A[j], c), d = roof.vertex(...B[j], c), e = roof.vertex(...B[i], c);
        roof.tri(a, e, d); roof.tri(a, d, b2);
      }
    }
  } else {
    // gabled and hipped, on the footprint's rectangle (its walls are the footprint's, up to the eaves;
    // the roof covers the rectangle, the gable ends filled with wall)
    const { c: [rx, rz], u: [ux, uz], half: [L0, W] } = rect, along_ = P.ro === 'across';
    const [Lx, Lz, Wx, Wz, L, Wd] = along_ ? [-uz, ux, ux, uz, W, L0] : [ux, uz, -uz, ux, L0, W];
    const at = (s, t, y) => [rx + Lx * s + Wx * t, y, rz + Lz * s + Wz * t];
    const inset = shape === 'hipped' ? Math.min(Wd, L * 0.9) : 0;
    const R0 = at(-L + inset, 0, top), R1 = at(L - inset, 0, top);
    const E = [at(-L, -Wd, eave), at(L, -Wd, eave), at(L, Wd, eave), at(-L, Wd, eave)];
    const face = (pts_, k) => { const c = shade(roofC, k), ids = pts_.map(p => roof.vertex(...p, c)); for (let i = 1; i + 1 < ids.length; i++) roof.tri(ids[0], ids[i + 1], ids[i]); };
    face([E[0], E[1], R1, R0], 0.95); face([E[2], E[3], R0, R1], 0.82);
    if (shape === 'hipped') { face([E[1], E[2], R1], 0.9); face([E[3], E[0], R0], 0.88); }
    else for (const [a, b2, r] of [[E[1], E[2], R1], [E[3], E[0], R0]]) {
      const c = shade(facade, 0.92), ia = walls.vertex(...a, c, 0, (eave - gC) / storey), ib = walls.vertex(...b2, c, 2 * Wd / bay, (eave - gC) / storey), ir = walls.vertex(...r, c, Wd / bay, (top - gC) / storey);
      walls.tri(ia, ib, ir);
    }
  }
  // the collider: convex pieces of the footprint, from the foot to most of the roof
  const pieces = convexPieces(rings, tris), y1 = shape === 'flat' ? top : eave + rh * 0.5;
  const hulls = pieces.filter(p => p.length >= 3).map(p => ({ points: p.flatMap(k => pts[k]), y0: foot, y1 }));
  const kind = P.b ?? '', landmark = top - gC >= C.landmark.height || (C.landmark.kinds.includes(kind) && area >= C.landmark.minArea);
  return { style, windows: C.windows[style] ?? C.windows.default, walls, roof, hulls, top, foot, height: top - gC, landmark, centre: [cx, cz] };
}
