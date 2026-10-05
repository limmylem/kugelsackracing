// A generated track's paint (Phase 5 Step 1): white edge lines, the chequered start and finish lines and
// the grid's boxes, a few centimetres above the road and drawn over it. Paint only — nothing here
// collides (the road's surface is track/build.js's mesh).
//
//   trackMarkings(THREE, data) → THREE.Group (world frame)
//   trackMeshes(THREE, data, { spectators }) → THREE.Group (the whole track to look at; .dress: a dressed
//     track's track/renderDress.js meshes, .runoff(on): its run-off's colours on or off)

import { dressMeshes } from './renderDress.js';
import { PIT } from './gen/v2.js';

export function trackMarkings(THREE, D) {
  const C = D.centre, n = C.x.length, closed = D.closed, W = D.width / 2, step = D.length / (closed ? n : n - 1);
  const tan = i => { const a = closed ? (i - 1 + n) % n : Math.max(0, i - 1), b = closed ? (i + 1) % n : Math.min(n - 1, i + 1), dx = C.x[b] - C.x[a], dz = C.z[b] - C.z[a], m = Math.hypot(dx, dz) || 1; return [dx / m, dz / m]; };
  const tanB = i => Math.tan(C.bank[i] * Math.PI / 180);
  // a point u m left of the centreline at index i, just above the surface
  const pt = (i, u, lift = 0.03) => { const [tx, tz] = tan(i); return [C.x[i] + tz * u, C.h[i] + Math.max(-W, Math.min(W, u)) * tanB(i) + lift, C.z[i] - tx * u]; };
  const indexAt = s => { const f = s / step; return closed ? ((Math.round(f) % n) + n) % n : Math.max(0, Math.min(n - 1, Math.round(f))); };
  const pos = [], col = [], idx = [];
  const quad = (a, b, c, d, rgb) => { const k = pos.length / 3; pos.push(...a, ...b, ...c, ...d); for (let q = 0; q < 4; q++) col.push(...rgb); idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); };
  const WHITE = [0.92, 0.92, 0.9], BLACK = [0.08, 0.08, 0.09];
  // edge lines: 25 cm wide, 30 cm in from each edge
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const j = (i + 1) % n;
    for (const side of [1, -1]) { const u0 = side * (W - 0.3), u1 = side * (W - 0.55); quad(pt(i, u0), pt(i, u1), pt(j, u0), pt(j, u1), WHITE); }
  }
  // a chequered line across the road at s (two rows of squares)
  const chequer = s => {
    const i = indexAt(s), [tx, tz] = tan(i), sq = 0.6, cols = Math.max(2, Math.round(2 * W / sq));
    for (let r = 0; r < 2; r++) for (let c = 0; c < cols; c++) {
      const u0 = W - c * (2 * W / cols), u1 = W - (c + 1) * (2 * W / cols), a0 = r * sq - sq, a1 = a0 + sq;
      const P = (u, a) => { const p = pt(i, u, 0.035); return [p[0] + tx * a, p[1], p[2] + tz * a]; };
      quad(P(u0, a0), P(u1, a0), P(u0, a1), P(u1, a1), (r + c) % 2 ? WHITE : BLACK);
    }
  };
  chequer(D.start.s);
  if (!closed) chequer(D.finish.s);
  // the grid's boxes: an open box in front of each slot (a line across, two short sides)
  for (const g of D.start.slots ?? []) {
    const hd = g.heading * Math.PI / 180, fx = Math.sin(hd), fz = Math.cos(hd), lx = fz, lz = -fx, h = g.h + 0.035, w = 1.2, front = 2.8;
    const at = (a, u) => [g.x + fx * a + lx * u, h, g.z + fz * a + lz * u];
    quad(at(front, w), at(front, -w), at(front - 0.2, w), at(front - 0.2, -w), WHITE);
    for (const u of [w, -w + 0.2]) quad(at(front, u), at(front, u - 0.2), at(front - 1.6, u), at(front - 1.6, u - 0.2), WHITE);
  }
  // a dressed track's pit lane (Phase 5 Step 2): the entry and exit lines (from the track's edge to the pit
  // wall's ends: not to be crossed), the speed-limit lines across the lane, the line between its fast lane
  // and the garages' working lane
  const P0 = D.dress?.pit;
  if (P0) {
    const s = P0.side, wall = W + PIT.wall, lane = W + PIT.front, mid = W + PIT.front - 5;
    // (beyond the road's edge the run-off falls away: the paint follows it)
    const ground = (i, u) => { const p = pt(i, u, 0.035); p[1] -= Math.max(0, Math.abs(u) - W) * (D.runoffFall ?? 0.02); return p; };
    const diag = (i0, u0, i1, u1) => { const m = Math.max(2, Math.abs(i1 - i0)); for (let k = 0; k < m; k++) { const a = i0 + (i1 - i0) * k / m, b = i0 + (i1 - i0) * (k + 1) / m, ua = u0 + (u1 - u0) * k / m, ub = u0 + (u1 - u0) * (k + 1) / m; quad(ground(Math.round(a), s * ua), ground(Math.round(a), s * (ua + 0.3)), ground(Math.round(b), s * ub), ground(Math.round(b), s * (ub + 0.3)), WHITE); } };
    diag(P0.entry, W, P0.from, wall - 0.3); diag(P0.to, wall - 0.3, P0.exit, W);
    for (const i of [P0.from, P0.to]) { const j = i + (i === P0.from ? 1 : -1); quad(ground(i, s * (wall + 0.4)), ground(i, s * lane), ground(j, s * (wall + 0.4)), ground(j, s * lane), WHITE); }
    for (let i = P0.from; i < P0.to; i += 2) quad(ground(i, s * mid), ground(i, s * (mid + 0.15)), ground(i + 1, s * mid), ground(i + 1, s * (mid + 0.15)), WHITE);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  mesh.name = 'track-markings'; mesh.receiveShadow = true;
  const g = new THREE.Group(); g.add(mesh);
  return g;
}

// The whole track to look at (the generator page's fly-through): its ground, its road and its paint, from
// the same arrays as its colliders
export function trackMeshes(THREE, D, { spectators = 'high' } = {}) {
  const g = new THREE.Group(), T = D.terrain, V = T.n + 1, cell = T.size / T.n, half = T.size / 2;
  const pos = new Float32Array(V * V * 3), col = new Float32Array(V * V * 3);
  let lo = Infinity, hi = -Infinity;
  for (const h of T.heights) { lo = Math.min(lo, h); hi = Math.max(hi, h); }
  const a = new THREE.Color(D.look?.ground?.[0] ?? '#5f7c47'), b = new THREE.Color(D.look?.ground?.[1] ?? '#9aa86a'), c = new THREE.Color();
  for (let cc = 0; cc < V; cc++) for (let r = 0; r < V; r++) {
    const i = r * V + cc, h = T.heights[r + cc * V];
    pos.set([-half + cc * cell, h, -half + r * cell], i * 3);
    c.copy(a).lerp(b, hi > lo ? (h - lo) / (hi - lo) : 0); col.set([c.r, c.g, c.b], i * 3);
  }
  const idx = [];
  for (let r = 0; r < T.n; r++) for (let cc = 0; cc < T.n; cc++) { const i00 = r * V + cc, i10 = i00 + 1, i01 = i00 + V, i11 = i01 + 1; idx.push(i00, i01, i10, i10, i01, i11); }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); tg.setAttribute('color', new THREE.BufferAttribute(col, 3)); tg.setIndex(idx); tg.computeVertexNormals();
  g.add(new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ vertexColors: true })));
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.BufferAttribute(D.road.positions, 3)); rg.setAttribute('color', new THREE.BufferAttribute(D.road.colours, 3, true)); rg.setIndex(new THREE.BufferAttribute(D.road.indices, 1)); rg.computeVertexNormals();
  g.add(new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })));
  g.add(trackMarkings(THREE, D));
  if (D.dress) {
    g.dress = dressMeshes(THREE, D, { spectators });
    g.add(g.dress.group);
    // (the run-off's colours off: beyond the road's edges, the ground's colour)
    const full = rg.attributes.color.array.slice(), plain = full.slice(), col = D.road.columns, gc = new THREE.Color(D.look.ground[0]);
    for (let v = 0; v < plain.length / 3; v++) { const k = v % col; if (k < 5 || k > 7) plain.set([gc.r * 255, gc.g * 255, gc.b * 255], v * 3); }
    g.runoff = on => { rg.attributes.color.array.set(on ? full : plain); rg.attributes.color.needsUpdate = true; };
  }
  return g;
}
