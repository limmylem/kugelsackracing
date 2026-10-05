// A dressed track made into a world (Phase 5 Step 2; generator version 2 on): track/build.js's road, ground
// and course, plus what the dressing (track/dress.js) put round it — the run-off, the kerbs, the barriers,
// the pits, the scenery. Pure data, as track/build.js: the same arrays are the drawn meshes and the
// physics' colliders (physics/track.js trackShapes), so what you see is what the car hits and drives on.
//
// The road's cross-section, out from the middle either side: the road (banked), a strip beside it (a
// kerb's width: where kerbs lie, a verge elsewhere), the run-off out to the barrier (falling gently away),
// a short skirt down onto the ground behind the barrier. The run-off's colours and surfaces (grass,
// gravel, asphalt, sand) are the dressing's; a seam a few centimetres wide keeps each colour sharp.
// The kerbs are a mesh of their own over the road's edge: a flat kerb's ridged top (its rattle), a
// sausage kerb's hump behind it at chicanes; their own surfaces (physics/track.js paintQuads). The
// barriers: runs of pieces along the run-off's edge (and the pit wall), as Map v3's railings — their
// colliders are map/build/format/barriers.js's chained boxes. The ground is flattened under the run-off
// and blends into the land beyond the barriers.
//
//   buildDressed(gen, cfg, { progress }) → world data (as track/build.js's, and kerbs, paintQuads,
//     barriers, objects, colliders, dress, look)

import { dressTrack, RUNOFF, BARRIERS } from './dress.js';
import { PIT } from './gen/v2.js';
import { landGrid, heightAtOf, courseOf, fixWinding, BUILD_VERSION } from './build.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const r1 = x => Math.round(x * 10) / 10;
const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const quatY = yaw => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });

export function buildDressed(gen, cfg, { progress = () => {} } = {}) {
  const T = gen.track, B = cfg.build, n = T.n, closed = T.closed, W = T.width / 2, KB = B.kerb, KW = KB.width, fall = B.runoffFall;
  progress('dressing', 0.02);
  const plan = dressTrack(gen, cfg), look = cfg.themes[plan.theme].look;
  progress('dressing', 0.2);
  // ---------- the centreline's frame (left normal: (tz, −tx)) ----------
  const tx = new Float64Array(n), tz = new Float64Array(n), tanB = new Float64Array(n), ds = T.length / (closed ? n : n - 1);
  for (let i = 0; i < n; i++) {
    const a = closed ? (i - 1 + n) % n : Math.max(0, i - 1), b = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    const dx = T.x[b] - T.x[a], dz = T.z[b] - T.z[a], m = Math.hypot(dx, dz) || 1;
    tx[i] = dx / m; tz[i] = dz / m; tanB[i] = Math.tan(T.bank[i] * Math.PI / 180);
  }
  const O = side => side > 0 ? plan.runoff.L : plan.runoff.R;
  const edgeH = (i, side) => T.h[i] + side * W * tanB[i];
  // the surface u m left of the centreline: the road (banked), beyond its edge falling gently away
  const surf = (i, u) => { const a = Math.abs(u); return a <= W ? T.h[i] + u * tanB[i] : edgeH(i, u > 0 ? 1 : -1) - fall * (a - W); };
  const at = (i, u) => [T.x[i] + tz[i] * u, T.z[i] - tx[i] * u];

  // ---------- the ground: flat under the run-off, blending into the land beyond the barriers ----------
  progress('ground', 0.25);
  const land = landGrid(T, B), { N, cell, half, heights, idx } = land;
  let oMax = 0;
  for (let i = 0; i < n; i++) oMax = Math.max(oMax, plan.runoff.L[i], plan.runoff.R[i]);
  const G = (N + 1) * (N + 1), reach = oMax + B.blend + 60, nearest = new Float32Array(G).fill(Infinity), near = new Int32Array(G).fill(-1);
  for (let i = 0; i < n; i++) {
    const c0 = Math.max(0, Math.floor((T.x[i] - reach + half) / cell)), c1 = Math.min(N, Math.ceil((T.x[i] + reach + half) / cell));
    const q0 = Math.max(0, Math.floor((T.z[i] - reach + half) / cell)), q1 = Math.min(N, Math.ceil((T.z[i] + reach + half) / cell));
    for (let c = c0; c <= c1; c++) { const vx = -half + c * cell - T.x[i]; for (let r = q0; r <= q1; r++) { const vz = -half + r * cell - T.z[i], d = vx * vx + vz * vz, k = idx(c, r); if (d < nearest[k]) { nearest[k] = d; near[k] = i; } } }
  }
  for (let c = 0; c <= N; c++) for (let r = 0; r <= N; r++) {
    const k = idx(c, r), i = near[k];
    if (i < 0) continue;
    const vx = -half + c * cell - T.x[i], vz = -half + r * cell - T.z[i], u = vx * tz[i] - vz * tx[i], along = vx * tx[i] + vz * tz[i];
    const beyond = !closed && ((i === 0 && along < 0) || (i === n - 1 && along > 0)) ? Math.abs(along) : 0;
    const side = u >= 0 ? 1 : -1, o = O(side)[i], lat = Math.abs(u);
    if (lat <= o + 0.8 && beyond <= 1) { heights[k] = surf(i, clamp(u, -o, o)) - 0.35; continue; }   // (under the road and run-off)
    const foot = surf(i, side * Math.min(lat, o)), h0 = heights[k], blend = B.blend + Math.min(60, Math.abs(h0 - foot) * 1.5);
    heights[k] = foot - 0.05 + (h0 - (foot - 0.05)) * smoothstep(0, blend, Math.hypot(Math.max(0, lat - o - 0.8), beyond));
  }
  const terrainAt = heightAtOf(land);
  progress('road', 0.4);

  // ---------- the road, the strip beside it and the run-off: 13 columns a cross-section ----------
  const COL = { road: [64, 66, 70], ...Object.fromEntries(RUNOFF.map(k => [k, rgb(look[k])])), verge: rgb(look.verge), ground: rgb(look.ground[0]) };
  // (out from the middle: the road's edge, the strip's inner seam, the strip's outer edge, the run-off's
  // seam, the barrier, the skirt)
  // (the strip beside the road: the kerbs' width and a lip of verge before the run-off proper begins — a
  // gravel trap a car's width out, not right against the kerb)
  const lipOf = o => Math.min(W + KW + B.lip, o - 0.2);
  const sideCols = i => s => { const o = O(s)[i], lip = lipOf(o); return [W, W + 0.03, lip, lip + 0.04, o, o + 0.8]; };
  const C = 13, rows = closed ? n + 1 : n;
  const positions = new Float32Array(rows * C * 3), colours = new Uint8Array(rows * C * 3);
  for (let j = 0; j < rows; j++) {
    const i = j % n, us = sideCols(i), L = us(1), R = us(-1);
    const row = [...L.slice().reverse().map(u => [u, 1]), [0, 0], ...R.map(u => [-u, -1])];
    row.forEach(([u, s], c) => {
      const [x, z] = at(i, u), k = (j * C + c) * 3, a = Math.abs(u);
      const sk = s && a > O(s)[i] + 0.5;
      positions[k] = x; positions[k + 2] = z;
      positions[k + 1] = sk ? Math.min(surf(i, s * O(s)[i]), terrainAt(x, z) + 0.02) : surf(i, u);
      const name = s ? RUNOFF[(s > 0 ? plan.surface.L : plan.surface.R)[i]] : 'road';
      colours.set(a <= W + 0.001 ? COL.road : sk ? COL.ground : a <= lipOf(O(s)[i]) + 0.001 ? (name === 'asphalt' ? COL.asphalt : COL.verge) : COL[name], k);
    });
  }
  const indices = new Uint32Array((rows - 1) * (C - 1) * 6);
  { let q = 0; for (let j = 0; j + 1 < rows; j++) for (let c = 0; c + 1 < C; c++) { const a = j * C + c, b = a + 1, d = a + C, e = d + 1; indices.set([a, d, b, b, d, e], q); q += 6; } }
  fixWinding(positions, indices);

  // ---------- kerbs ----------
  progress('kerbs', 0.5);
  const kerbs = kerbMeshes(plan, T, { tx, tz, ds, W, KB, edgeH, n, closed, fall });

  // ---------- surfaces: the strip and the run-off, then the kerbs (over the road's tarmac) ----------
  const quads = {};
  const quad = (name, i, i2, s, u0, u1) => {
    const a = at(i, s * u0), b = at(i, s * u1), c = at(i2, s * u1), d = at(i2, s * u0);
    (quads[name] ??= []).push(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]);
  };
  for (let j = 0; j + 1 < rows; j++) {
    const i = j % n, i2 = (j + 1) % n;
    for (const s of [1, -1]) {
      const name = RUNOFF[(s > 0 ? plan.surface.L : plan.surface.R)[i]], o = Math.min(O(s)[i], O(s)[i2]);
      const lip = lipOf(o);
      quad(name === 'asphalt' ? 'asphalt' : 'verge', i, i2, s, W, lip);
      quad(name, i, i2, s, lip, o);
    }
  }
  for (const k of kerbs.paint) quad(k.surface, k.i, k.i2, k.side, k.u0, k.u1);
  const order = ['verge', ...RUNOFF, 'kerb', 'sausage'];
  const paintQuads = order.filter(k => quads[k]).map(k => ({ surface: k, quads: Float32Array.from(quads[k]) }));
  const pts = [];
  for (let i = 0; i < n; i++) pts.push(r1(T.x[i]), r1(T.z[i]));
  const paintLines = [{ surface: 'tarmac', half: W, points: pts }];

  // ---------- barriers: each side's run along the run-off's edge, the pit wall; a sprint's ends closed ----------
  progress('barriers', 0.6);
  const { runs, fences } = barrierRuns(plan, T, cfg, { at, surf });

  // ---------- what stands about: on the ground (or the run-off), and what's solid ----------
  progress('scenery', 0.7);
  const cellN = 32, grid = new Map(), key = (a, b) => a * 100003 + b;
  for (let i = 0; i < n; i++) { const k = key(Math.floor(T.x[i] / cellN), Math.floor(T.z[i] / cellN)); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(i); }
  const nearestI = (x, z) => {
    let best = -1, bd = Infinity;
    for (let ring = 2; best < 0 && ring <= 12; ring += 5) {
      const a = Math.floor(x / cellN), b = Math.floor(z / cellN);
      for (let p = a - ring; p <= a + ring; p++) for (let q = b - ring; q <= b + ring; q++) for (const i of grid.get(key(p, q)) ?? []) { const d = (T.x[i] - x) ** 2 + (T.z[i] - z) ** 2; if (d < bd) { bd = d; best = i; } }
    }
    return best;
  };
  const groundAt = (x, z) => {
    const i = nearestI(x, z);
    if (i < 0) return terrainAt(x, z);
    const u = (x - T.x[i]) * tz[i] - (z - T.z[i]) * tx[i], s = u >= 0 ? 1 : -1;
    return Math.abs(u) <= O(s)[i] + 0.4 ? surf(i, u) : terrainAt(x, z);
  };
  const objects = plan.objects.map(o => ({ ...o, y: Math.round(groundAt(o.x, o.z) * 100) / 100 }));
  const colliders = [], box = (x, y, z, sx, sy, sz, yaw, material = 'concrete') => colliders.push({ kind: 'box', name: 'scenery', centre: [x, y + sy / 2, z], halfExtents: [sx / 2, sy / 2, sz / 2], rotation: quatY(yaw), material, hidden: true });
  for (const o of objects) {
    const yaw = Math.atan2(o.fx ?? 0, o.fz ?? 1);
    switch (o.k) {
      case 'grandstand': box(o.x, o.y, o.z, o.len, o.h, o.deep, yaw); break;
      case 'tower': box(o.x, o.y, o.z, 4, o.h, 4, yaw); break;
      case 'marshal': box(o.x, o.y, o.z, 2.2, 2.6, 2.2, yaw); break;
      case 'light': box(o.x, o.y, o.z, 0.8, o.h, 0.8, yaw, 'metal'); break;
      case 'building': box(o.x, o.y, o.z, o.w, o.h, o.d, yaw); break;
      case 'tree': { const r = (o.kind === 'palm' ? 0.18 : 0.24) * o.size, hh = 2.2 * o.size; colliders.push({ kind: 'capsule', name: 'tree', centre: [o.x, o.y + hh + r, o.z], radius: r, halfHeight: hh, rotation: { x: 0, y: 0, z: 0, w: 1 }, material: 'wood', hidden: true }); break; }
      case 'rock': { const s = o.kind === 'mesa' ? 6 * o.size : o.kind === 'crag' ? 2.4 * o.size : 1.3 * o.size; box(o.x, o.y - s * 0.3, o.z, s * 1.4, s * (o.kind === 'crag' ? 2.2 : 1.1), s * 1.2, o.turn, 'concrete'); break; }
      case 'gantry': case 'finish': case 'footbridge': {
        const i = o.i;
        for (const [s, d] of [[1, o.left], [-1, o.right]]) { const [x, z] = at(i, s * d); box(x, groundAt(x, z), z, 1.0, 7.5, 1.0, Math.atan2(tx[i], tz[i]), 'metal'); }
        break;
      }
      default: break;
    }
  }
  // the garages: behind their fronts (the pitbox barrier), along the pit lane
  if (plan.pit) {
    const P0 = plan.pit, s = P0.side, mid = W + (PIT.front + PIT.back) / 2, deep = PIT.back - PIT.front;
    for (let i = P0.from; i < P0.to; i += 6) {
      const i2 = Math.min(P0.to, i + 6), [xa, za] = at(i, s * mid), [xb, zb] = at(i2, s * mid), len = Math.hypot(xb - xa, zb - za);
      if (len < 0.5) continue;
      box((xa + xb) / 2, Math.min(surf(i, s * mid), surf(i2, s * mid)) - 0.3, (za + zb) / 2, len + 0.4, 8, deep - 0.4, Math.atan2(xb - xa, zb - za) + Math.PI / 2);
    }
  }

  // ---------- the course: a sprint's finish well before its end (room to stop) ----------
  progress('course', 0.78);
  // (its checkpoints as wide as the road and its run-off, out to the corridor: a car run wide into the
  // gravel is still on the track)
  const gateWidth = s => { const i = Math.min(n - 1, Math.max(0, Math.round(s / ds))) % n; return Math.min(T.width + 24, plan.runoff.L[i] + plan.runoff.R[i]); };
  const { course, grid: gr } = courseOf(gen, { margin: 12, finishS: closed ? null : plan.finish.s, gateWidth }, progress);
  // (its own start gantry, and a sprint's finish gantry, in place of the route's arch)
  course.guides = { ...course.guides, arch: false };
  const slot = gr.slots[0];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, T.x[i]); x1 = Math.max(x1, T.x[i]); z0 = Math.min(z0, T.z[i]); z1 = Math.max(z1, T.z[i]); }
  progress('done', 1);
  const P = plan;
  return {
    build: BUILD_VERSION, code: gen.code, hash: gen.hash, dressHash: P.hash, version: gen.version, params: gen.params, stats: gen.track.stats, attempts: gen.attempts, ms: gen.ms,
    closed, length: T.length, width: T.width, verge: KW, runoffFall: fall, theme: P.theme, look,
    centre: { x: Float32Array.from(T.x), z: Float32Array.from(T.z), h: Float32Array.from(T.h), bank: Float32Array.from(T.bank) },
    road: { positions, indices, colours, columns: C },
    kerbs: { positions: kerbs.positions, indices: kerbs.indices, render: kerbs.render },
    terrain: { n: N, size: land.size, heights },
    paintLines, paintQuads, surfaces: cfg.surfaces,
    barriers: { runs, fences, cfg: cfg.barriers },
    objects, colliders,
    dress: { version: P.version, theme: P.theme, variant: P.variant, hash: P.hash, start: P.start, finish: P.finish, corners: P.corners, kerbs: P.kerbs, pit: P.pit, runoff: P.runoff, surface: P.surface, barrier: P.barrier, fence: P.fence, speed: P.speed, line: P.line, brands: cfg.brands },
    spawn: { position: [slot.x, surf(nearestI(slot.x, slot.z), 0) + 0.6, slot.z], headingDeg: slot.heading },
    start: { s: gr.startS, slots: gr.slots.map(s => ({ x: s.x, z: s.z, h: s.h, heading: s.heading })) }, finish: { s: gr.finishS },
    bounds: [x0, z0, x1, z1], course,
  };
}

// The barriers: each side's runs (one type each, end to end: no gaps) along the run-off's edge, the pit wall,
// a sprint's ends closed across; the catch fencing's runs (drawn only). Pieces: 7 numbers each (both
// feet, its height) — map/build/format/barriers.js makes their colliders.
//   barrierRuns(plan, track, cfg, { at, surf }?) → { runs: [{ type, side, pieces: Float32Array }], fences: [[x, y, z, …]] }
export function barrierRuns(plan, T, cfg, geo = null) {
  const n = T.n, closed = T.closed, W = T.width / 2, fall = cfg.build.runoffFall;
  let at = geo?.at, surf = geo?.surf;
  if (!at) {
    const tx = new Float64Array(n), tz = new Float64Array(n), tanB = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = closed ? (i - 1 + n) % n : Math.max(0, i - 1), b = closed ? (i + 1) % n : Math.min(n - 1, i + 1), dx = T.x[b] - T.x[a], dz = T.z[b] - T.z[a], m = Math.hypot(dx, dz) || 1;
      tx[i] = dx / m; tz[i] = dz / m; tanB[i] = Math.tan(T.bank[i] * Math.PI / 180);
    }
    at = (i, u) => [T.x[i] + tz[i] * u, T.z[i] - tx[i] * u];
    surf = (i, u) => { const a = Math.abs(u), side = u > 0 ? 1 : -1, e = T.h[i] + side * W * tanB[i]; return a <= W ? T.h[i] + u * tanB[i] : e - fall * (a - W); };
  }
  const O = side => side > 0 ? plan.runoff.L : plan.runoff.R;
  const BT = cfg.barriers.types, runs = [], fences = [];
  const push = (type, side, flat) => { if (flat.length) runs.push({ type, side, pieces: Float32Array.from(flat) }); };
  for (const s of [1, -1]) {
    const A = O(s), Ty = s > 0 ? plan.barrier.L : plan.barrier.R, Fe = s > 0 ? plan.fence.L : plan.fence.R;
    const P = i => { const [x, z] = at(i, s * A[i]); return [x, surf(i, s * A[i]), z]; };
    let cur = null, flat = [], fence = null;
    const segs = closed ? n : n - 1;
    for (let k = 0; k < segs; k++) {
      const i = k, i2 = (k + 1) % n, type = BARRIERS[Ty[i]];
      if (type !== cur) { push(cur, s, flat); flat = []; cur = type; }
      flat.push(...P(i), ...P(i2), BT[type].height);
      // catch fencing: on top of the barrier (posts and mesh: drawn only)
      if (Fe[i] && Fe[i2]) { if (!fence) { fence = [...P(i)]; fences.push(fence); } fence.push(...P(i2)); } else fence = null;
    }
    push(cur, s, flat);
  }
  if (!closed) for (const [i, type] of [[0, 'armco'], [n - 1, 'tyres']]) {
    // (across the end, from one side's barrier to the other's, 2 m pieces)
    const a = plan.runoff.L[i], b = -plan.runoff.R[i], m = Math.max(1, Math.round((a - b) / 2)), flat = [];
    const P = u => { const [x, z] = at(i, u); return [x, surf(i, u), z]; };
    for (let q = 0; q < m; q++) flat.push(...P(a + (b - a) * q / m), ...P(a + (b - a) * (q + 1) / m), BT[type].height);
    push(type, 0, flat);
  }
  if (plan.pit) {
    const P0 = plan.pit, s = P0.side, flat = [], fence = [];
    const P = i => { const [x, z] = at(i, s * (W + PIT.wall)); return [x, surf(i, s * (W + PIT.wall)), z]; };
    for (let i = P0.from; i < P0.to; i++) flat.push(...P(i), ...P(i + 1), BT.pitwall.height);
    for (let i = P0.from; i <= P0.to; i++) fence.push(...P(i));
    push('pitwall', s, flat); fences.push(fence);
  }

  return { runs, fences };
}

// The kerbs: a flat kerb's ridged top over the road's edge (its rattle: every other half-ridge lower), a
// sausage kerb's hump just behind it. Physics gets each kerb as one shared-vertex strip (its triangles
// joined: the internal edges smoothed, physics/sim.js); the drawing, the same shape in blocks of colour.
function kerbMeshes(plan, T, { tx, tz, ds, W, KB, edgeH, n, closed, fall }) {
  const pos = [], ind = [], rpos = [], rcol = [], rind = [], paint = [];
  const RED = [198, 40, 40], WHITE = [235, 235, 232], YELLOW = [235, 196, 30], BLACK = [30, 30, 32];
  const sub = KB.ridge / 2, h = KB.height, sh = KB.sausageHeight, u0 = KB.width + 0.06;
  const PROF = {
    flat: [[-0.05, 0.002], [0.1, 1], [KB.width - 0.08, 1], [KB.width + 0.02, -0.03]],
    sausage: [[u0, -0.03], [u0 + 0.08, 0.6], [u0 + 0.18, 1], [u0 + KB.sausageWidth - 0.18, 1], [u0 + KB.sausageWidth - 0.08, 0.6], [u0 + KB.sausageWidth, -0.03]],
  };
  for (const k of plan.kerbs) {
    const prof = PROF[k.type], top = k.type === 'flat' ? h : sh, s = k.side, len = (k.len - 1) * ds, m = Math.max(2, Math.round(len / sub));
    const rowsAt = [];
    let lastI = -1;
    for (let q = 0; q <= m; q++) {
      const f = k.from + (k.len - 1) * q / m, a = Math.floor(f), t = f - a, i = closed ? ((a % n) + n) % n : Math.min(n - 1, a), i2 = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
      const cx = T.x[i] + (T.x[i2] - T.x[i]) * t, cz = T.z[i] + (T.z[i2] - T.z[i]) * t;
      let ux = tx[i] + (tx[i2] - tx[i]) * t, uz = tz[i] + (tz[i2] - tz[i]) * t; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
      const base = edgeH(i, s) + (edgeH(i2, s) - edgeH(i, s)) * t;
      // (the ends ramped down to nothing; the flat kerb's ridges)
      const ramp = Math.min(1, q / 2, (m - q) / 2), ridge = k.type === 'flat' ? (q % 2 ? 1 : 0.45) : 1;
      rowsAt.push(prof.map(([u, hp]) => {
        const lift = hp > 0 ? hp * top * ridge * ramp : hp;
        // (beyond the road's edge the run-off falls away: the kerb's foot follows it)
        return [cx + uz * s * (W + u), base + lift - (u > 0 ? fall * u * (hp <= 0 ? 1 : 0) : 0), cz - ux * s * (W + u)];
      }));
      if (q < m && i !== lastI) {
        lastI = i;
        paint.push({ surface: k.type === 'flat' ? 'kerb' : 'sausage', i, i2: closed ? (i + 1) % n : Math.min(n - 1, i + 1), side: s, u0: W + prof[0][0], u1: W + prof.at(-1)[0] });
      }
    }
    // physics: one strip, shared vertices
    const P0 = pos.length / 3, w = prof.length;
    for (const r of rowsAt) for (const p of r) pos.push(...p);
    for (let q = 0; q < m; q++) for (let c = 0; c + 1 < w; c++) { const a = P0 + q * w + c, b = a + 1, d = a + w, e = d + 1; ind.push(a, d, b, b, d, e); }
    // drawn: each block its own colour (red and white every ridge; a sausage yellow and black)
    for (let q = 0; q < m; q++) {
      const colour = k.type === 'flat' ? (Math.floor(q / 2) % 2 ? WHITE : RED) : (Math.floor(q / 2) % 2 ? BLACK : YELLOW);
      const R0 = rpos.length / 3;
      for (const p of rowsAt[q]) { rpos.push(...p); rcol.push(...colour); }
      for (const p of rowsAt[q + 1]) { rpos.push(...p); rcol.push(...colour); }
      for (let c = 0; c + 1 < w; c++) { const a = R0 + c, b = a + 1, d = a + w, e = d + 1; rind.push(a, d, b, b, d, e); }
    }
  }
  const positions = Float32Array.from(pos), indices = Uint32Array.from(ind), rp = Float32Array.from(rpos), ri = Uint32Array.from(rind);
  fixWinding(positions, indices); fixWinding(rp, ri);
  return { positions, indices, render: { positions: rp, colours: Uint8Array.from(rcol), indices: ri }, paint };
}
