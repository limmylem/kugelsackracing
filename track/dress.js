// Dressing a generated track (Phase 5 Step 2): what makes a layout a race circuit — kerbs, run-off sized to
// each corner's speed, barriers, the start area and pit lane, braking boards and corner numbers,
// grandstands, marshal posts, light towers, advertising, trees, rocks and buildings — chosen by the
// track's seed and its theme. Part of a version-2 track's identity, like its layout: it uses only exact
// arithmetic (track/det.js: + − × ÷, square roots, the seeded random numbers; the Phase 4 racing line and
// speed plan, route/racingLine.js, in its withExactMath), so the same track code gives the same dressing on every
// machine. Its rules are frozen with the generator version that uses them (DRESS_VERSION 1: generator
// version 2); the themes' dressing settings (data/tracks.json themes.*.dress) are part of it too — the
// pinned tracks (tests/fixtures/tracks-v2.json) say if they change. How it looks (colours, sky) isn't.
//
//   dressTrack(gen, cfg) → plan:
//     { version, theme, variant, n, closed, width, start: { s, i }, finish: { s, i },
//       speed (km/h at each centreline point, a reference race car's), line (its racing line, m left),
//       corners: [{ n, from, apex, to, side (inside: +1 left, −1 right), turn (°), radius, vEntry, vApex, vExit, kind, brakeFrom }],
//       kerbs: [{ side, from, len, type: 'flat' | 'sausage', corner, role: 'apex' | 'exit' | 'entry', by: 'line' (where the racing
//         line runs to the edge) | 'shape' (a bend the line doesn't reach the edge in: by its shape) }],
//       runoff: { L, R } (m from the centreline to the barrier), surface: { L, R } (RUNOFF index),
//       barrier: { L, R } (BARRIERS index), fence: { L, R } (catch fencing: 1), pit, objects: [...], hash }
//   RUNOFF, BARRIERS: what the indices mean.  blocked(plan, track, x, z, pad) → inside the barriers?

import { rng, mix, sqrt, fix, fnv, PI } from './det.js';
import { frameOf, freeSpace, pointGrid } from './gen/space.js';
import { PIT, pitSpan } from './gen/v2.js';
import { racingLine, speedPlan, withExactMath } from '../route/racingLine.js';

export const DRESS_VERSION = 1;
export const RUNOFF = ['grass', 'gravel', 'asphalt', 'sand'];
export const BARRIERS = ['armco', 'concrete', 'tyres', 'pitbox'];

// the car the run-off is sized for: a quick race car (more than a road car can do: room to spare)
const REF = { mass: 1250, grip: 1.2, brake: 11.5, power: 330000, topSpeed: 80, cda: 0.7, downforce: 0.9, traction: 0.75, rolling: 0.012, turnRadius: 0 };
// the rules (frozen with this dressing version)
const K = {
  cornerK: 1 / 350, merge: 6, minTurn: 8,
  kerb: { near: 0.35, extend: 4, min: 8, entryShare: 0.8, entryKmh: 80, sausageKmh: 170 },
  // run-off beyond the road's edge for a speed v (m/s): a + b·v², times the theme's scale
  runoff: { a: 3.7, b: 0.0134, inside: 0.4, after: 0.3, before: 0.6, slope: 0.35, approach: 120, past: 60 },
  fastKmh: 150, mediumKmh: 95, tyresKmh: 150, concreteBelow: 4, gap: 1,
};
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function dressTrack(gen, cfg) {
  const T = gen.track, p = gen.params, theme = p.theme, rules = cfg.themes[theme]?.dress ?? cfg.themes.countryside.dress;
  const r = rng(mix(mix(gen.seed, 0xd7e5), p.dressing ?? 0));
  const F = frameOf(T), n = F.n, closed = F.closed, ds = F.ds, W = T.width / 2;
  const wrap = i => closed ? ((i % n) + n) % n : clamp(i, 0, n - 1);
  const inRange = i => closed || (i >= 0 && i < n);
  const DEG = 180 / PI;

  // ---------- the speed: the Phase 4 racing line and speed plan, for the reference car ----------
  const line = [];
  for (let i = 0; i < n; i++) line.push({ x: T.x[i], z: T.z[i], h: T.h[i], w: T.width });
  const { rl, v } = withExactMath(() => { const rl = racingLine(line, { loop: closed }); return { rl, v: speedPlan(rl, REF, { loop: closed, corner: 1, braking: 1, start: closed ? null : 0 }) }; });
  const m = rl.points.length, map = i => m === n ? i : Math.min(m - 1, Math.round(i * (m - 1) / Math.max(1, n - 1)));
  const speed = new Float32Array(n), off = new Float32Array(n);
  for (let i = 0; i < n; i++) { speed[i] = fix(v[map(i)] * 3.6, 10); off[i] = fix(rl.points[map(i)].d, 100); }
  const lim = 0.4 * T.width - 1.1;          // (how far from the middle the racing line may go: route/racingLine.js bounds)

  // ---------- corners ----------
  const corners = [];
  {
    const segs = [];
    let cur = null;
    for (let i = 0; i < n; i++) {
      const k = T.k[i], sg = Math.abs(k) >= K.cornerK ? (k > 0 ? 1 : -1) : 0;
      if (sg && cur && cur.sg === sg && i - cur.to <= K.merge) { cur.to = i; continue; }
      if (sg) { cur = { sg, from: i, to: i }; segs.push(cur); }
    }
    // (a circuit's last bend running on into its first)
    if (closed && segs.length > 1 && segs[0].from === 0 && segs.at(-1).to === n - 1 && segs[0].sg === segs.at(-1).sg) { const l = segs.pop(); segs[0].from = l.from - n; }
    for (const sgm of segs) {
      let turn = 0, kmax = 0, apex = sgm.from, vmin = Infinity;
      for (let j = sgm.from; j <= sgm.to; j++) { const i = wrap(j); turn += T.k[i] * ds; kmax = Math.max(kmax, Math.abs(T.k[i])); if (speed[i] < vmin) { vmin = speed[i]; apex = j; } }
      if (Math.abs(turn) * DEG < K.minTurn) continue;
      corners.push({ from: sgm.from, apex, to: sgm.to, side: sgm.sg > 0 ? -1 : 1, turn: fix(turn * DEG, 10), radius: fix(1 / kmax, 10), vApex: vmin });
    }
    corners.sort((a, b) => a.from - b.from);
    corners.forEach((c, q) => {
      const prevTo = q ? corners[q - 1].to : (closed ? corners.at(-1).to - n : -Infinity);
      let ve = 0, bf = c.apex;
      for (let j = c.from; j >= Math.max(prevTo, c.from - Math.round(400 / ds)); j--) { if (!inRange(j)) break; ve = Math.max(ve, speed[wrap(j)]); }
      // (braking from where the speed starts to fall towards the apex)
      for (let j = c.apex; j > c.apex - Math.round(500 / ds); j--) { if (!inRange(j - 1) || speed[wrap(j - 1)] < speed[wrap(j)] - 0.05) break; bf = j - 1; }
      const nextFrom = q + 1 < corners.length ? corners[q + 1].from : (closed ? corners[0].from + n : n - 1);
      let vx = 0;
      for (let j = c.to; j <= Math.min(nextFrom, c.to + Math.round(200 / ds)); j++) { if (!inRange(j)) break; vx = Math.max(vx, speed[wrap(j)]); }
      Object.assign(c, { n: q + 1, vEntry: fix(ve, 10), vApex: fix(c.vApex, 10), vExit: fix(vx, 10), brakeFrom: bf, kind: Math.abs(c.turn) >= 140 ? 'hairpin' : c.radius >= 120 ? 'sweeper' : 'corner' });
    });
    for (let q = 0; q + 1 < corners.length; q++) {
      const a = corners[q], b = corners[q + 1];
      if (a.side !== b.side && (b.from - a.to) * ds <= 40 && Math.abs(a.turn) <= 100 && Math.abs(b.turn) <= 100 && Math.max(a.vApex, b.vApex) < K.kerb.sausageKmh) a.kind = b.kind = 'chicane';
    }
  }

  // ---------- kerbs: where the racing line runs to the edge (the apex inside, the entry and exit outside) ----------
  const kerbs = [];
  const near = (i, side) => off[wrap(i)] * side >= lim - K.kerb.near;
  const grow = (j, side, lo, hi) => { let a = j, b = j; while (a - 1 >= lo && inRange(a - 1) && near(a - 1, side)) a--; while (b + 1 <= hi && inRange(b + 1) && near(b + 1, side)) b++; return [a, b]; };
  const addKerb = (side, a, b, type, c, role, by = 'line') => {
    const e = Math.round(K.kerb.extend / ds); a -= e; b += e;
    if (!closed) { a = Math.max(0, a); b = Math.min(n - 1, b); }
    const len = b - a + 1;
    if (len * ds >= K.kerb.min) kerbs.push({ side, from: wrap(a), len, type, corner: c.n, role, by });
  };
  for (const c of corners) {
    const lo = c.from - Math.round(80 / ds), hi = c.to + Math.round(80 / ds), out = -c.side;
    // the apex: inside
    if (near(c.apex, c.side)) { const [a, b] = grow(c.apex, c.side, lo, hi); addKerb(c.side, a, b, 'flat', c, 'apex'); if (p.sausages && c.kind === 'chicane') { const q = Math.round((b - a) * 0.15); addKerb(c.side, a + q, b - q, 'sausage', c, 'apex'); } }
    else if (Math.abs(c.turn) >= 25) { const h = Math.round(clamp(Math.abs(c.to - c.from) * ds * 0.3, 8, 30) / ds); addKerb(c.side, c.apex - h, c.apex + h, 'flat', c, 'apex', 'shape'); }
    // the exit: outside, after the apex
    let e = -1;
    for (let j = c.apex; j <= hi; j++) { if (!inRange(j)) break; if (near(j, out)) { e = j; break; } }
    if (e >= 0) { const [a, b] = grow(e, out, c.apex, hi); addKerb(out, a, b, 'flat', c, 'exit'); }
    else if (Math.abs(c.turn) >= 45) addKerb(out, c.to - Math.round(5 / ds), c.to + Math.round(clamp(10 + c.vExit * 0.15, 12, 45) / ds), 'flat', c, 'exit', 'shape');
    // the entry: outside, before the turn-in (most corners)
    if (c.vEntry >= K.kerb.entryKmh && r.float() < K.kerb.entryShare) {
      let s0 = -1;
      for (let j = c.apex; j >= lo; j--) { if (!inRange(j)) break; if (near(j, out)) { s0 = j; break; } }
      if (s0 >= 0) { const [a, b] = grow(s0, out, lo, c.apex); addKerb(out, a, Math.min(b, c.apex), 'flat', c, 'entry'); }
    }
  }
  kerbs.sort((a, b) => a.side - b.side || a.from - b.from || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));

  // ---------- run-off: how much room each side needs, from the speed there ----------
  const R0 = rules.runoff, size = kmh => { const ms = kmh / 3.6; return clamp((K.runoff.a + K.runoff.b * ms * ms) * R0.scale, R0.min, R0.max); };
  const need = { L: new Float64Array(n).fill(R0.min), R: new Float64Array(n).fill(R0.min) };
  const kindL = new Int8Array(n).fill(-1), kindR = new Int8Array(n).fill(-1);       // (which corner's zone: the run-off type)
  const zoneTypes = [], zoneWant = [];
  for (const c of corners) {
    const out = -c.side, A = out > 0 ? need.L : need.R, B = c.side > 0 ? need.L : need.R, Z = out > 0 ? kindL : kindR;
    const from = Math.min(c.brakeFrom, c.from - Math.round(K.runoff.approach / 4 / ds)), to = c.to + Math.round(K.runoff.past / ds);
    const want = size(c.vEntry), cls = c.vEntry >= K.fastKmh ? 'fast' : c.vEntry >= K.mediumKmh ? 'medium' : 'slow';
    const z = zoneTypes.push(RUNOFF.indexOf(r.weighted(R0[cls]))) - 1;
    zoneWant.push(want);
    for (let j = from; j <= to; j++) { if (!inRange(j)) continue; const i = wrap(j); A[i] = Math.max(A[i], want); if (Z[i] < 0 || want >= zoneWant[Z[i]]) Z[i] = z; }
    for (let j = c.from; j <= c.to; j++) { if (!inRange(j)) continue; const i = wrap(j); B[i] = Math.max(B[i], size(c.vApex) * K.runoff.inside); }
  }
  // (on after a corner, where a car going off ends up; a shorter run up to it)
  const spread = A => {
    const laps = closed ? 2 : 1;
    for (let q = 0; q < laps * n; q++) { const i = q % n, j = closed ? (i + n - 1) % n : i - 1; if (j >= 0 && (closed || q > 0)) A[i] = Math.max(A[i], A[j] - K.runoff.after * ds); }
    for (let q = laps * n - 1; q >= 0; q--) { const i = q % n, j = closed ? (i + 1) % n : i + 1; if (j < n && (closed || q < laps * n - 1)) A[i] = Math.max(A[i], A[j] - K.runoff.before * ds); }
  };
  spread(need.L); spread(need.R);

  // ---------- the barriers' line: the run-off's outer edge, within the room there is ----------
  const free = freeSpace(T, F, { reach: 160, gap: K.gap });
  const o = { L: new Float64Array(n), R: new Float64Array(n) };
  for (let i = 0; i < n; i++) { o.L[i] = Math.min(W + need.L[i], free.L[i]); o.R[i] = Math.min(W + need.R[i], free.R[i]); }
  // the pit side: the lane and the garages' fronts, along the main straight
  let pit = null;
  if (T.pit?.side && p.pitLane) {
    const side = T.pit.side, A = side > 0 ? o.L : o.R, fr = side > 0 ? free.L : free.R;
    const [s0, s1] = pitSpan(T), e0 = Math.round(s0 / ds), pa = Math.round((s0 + PIT.ramp) / ds), x1 = Math.round(s1 / ds), pb = Math.round((s1 - PIT.ramp) / ds);
    for (let i = e0; i <= x1; i++) {
      const up = i < pa ? (i - e0) / (pa - e0) : i > pb ? (x1 - i) / (x1 - pb) : 1;
      A[i] = Math.max(A[i], Math.min(fr[i], W + 1.2 + (PIT.front - 1.2) * up));
    }
    pit = { side, entry: e0, from: pa, to: pb, exit: x1, garages: Math.max(1, Math.floor((pb - pa) * ds / 12)) };
  }
  // never jagged: the most it can have that's never steeper along the track than `slope` (only ever less)
  const smooth = A => {
    const laps = closed ? 2 : 1, d = K.runoff.slope * ds;
    for (let q = 0; q < laps * n; q++) { const i = q % n, j = closed ? (i + n - 1) % n : i - 1; if (j >= 0 && (closed || q > 0)) A[i] = Math.min(A[i], A[j] + d); }
    for (let q = laps * n - 1; q >= 0; q--) { const i = q % n, j = closed ? (i + 1) % n : i + 1; if (j < n && (closed || q < laps * n - 1)) A[i] = Math.min(A[i], A[j] + d); }
    for (let i = 0; i < n; i++) A[i] = fix(Math.max(A[i], W + 1.6), 100);
  };
  smooth(o.L); smooth(o.R);
  if (pit) { const A = pit.side > 0 ? o.L : o.R; for (let i = pit.from; i <= pit.to; i++) A[i] = fix(W + PIT.front, 100); }

  // what's in the run-off, and the barrier at its edge
  const surface = { L: new Uint8Array(n), R: new Uint8Array(n) }, barrier = { L: new Uint8Array(n), R: new Uint8Array(n) }, fence = { L: new Uint8Array(n), R: new Uint8Array(n) };
  const straightType = RUNOFF.indexOf(R0.straight), base = BARRIERS.indexOf(rules.barrier);
  for (const [sd, Z, O] of [['L', kindL, o.L], ['R', kindR, o.R]]) {
    for (let i = 0; i < n; i++) {
      surface[sd][i] = Z[i] >= 0 ? zoneTypes[Z[i]] : straightType;
      barrier[sd][i] = O[i] - W < K.concreteBelow ? BARRIERS.indexOf('concrete') : base;
      if (rules.fence === 'all') fence[sd][i] = 1;
    }
  }
  // tyre walls where a fast corner's run-off ends (apex on: where a car going off arrives)
  for (const c of corners) {
    if (c.vEntry < K.tyresKmh) continue;
    const sd = -c.side > 0 ? 'L' : 'R';
    for (let j = c.apex; j <= c.to + Math.round(K.runoff.past / ds); j++) if (inRange(j)) barrier[sd][wrap(j)] = BARRIERS.indexOf('tyres');
  }
  if (pit) { const sd = pit.side > 0 ? 'L' : 'R'; for (let i = pit.entry; i <= pit.exit; i++) { surface[sd][i] = RUNOFF.indexOf('asphalt'); if (i >= pit.from && i <= pit.to) barrier[sd][i] = BARRIERS.indexOf('pitbox'); else barrier[sd][i] = BARRIERS.indexOf('concrete'); } }

  // ---------- the start line ----------
  // (as route/grid.js placeGrid puts it: a circuit's where track/build.js asks; a sprint's just ahead of its grid)
  const cols = T.width >= 6.4 ? 2 : 1, span = 6 + Math.ceil(8 / cols) * 8 + (cols > 1 ? 4 : 0);
  const startS = closed ? clamp(T.start.straight * 0.45, 60, 220) : Math.min(span + 2, T.length * 0.5), startI = Math.round(startS / ds);
  // (a sprint's finish: well before its end — room to stop)
  const finishS = closed ? startS : Math.max(T.length * 0.5, T.length - Math.min(200, T.length * 0.08)), finishI = Math.round(finishS / ds);
  const plan = { version: DRESS_VERSION, theme, variant: p.dressing ?? 0, n, closed, width: T.width, start: { s: fix(startS, 100), i: startI }, finish: { s: fix(finishS, 100), i: finishI }, speed, line: off, corners, kerbs, runoff: { L: Float32Array.from(o.L), R: Float32Array.from(o.R) }, surface, barrier, fence, pit, objects: [] };

  // ---------- scenery ----------
  placeScenery(plan, T, F, rules, r, cfg);
  plan.hash = hashPlan(plan);
  return plan;
}

// ---------- where things can't go ----------
// inside the barriers (or within pad of them) of any part of the track: the nearest centreline point's
// cross-section says (a place in one part's run-off is nearer that part than any other: the barriers
// keep to the halfway line)
export function blockedBy(plan, T, F, G) {
  const n = F.n, W = T.width / 2;
  return (x, z, pad) => {
    let best = -1, bd = Infinity;
    for (const rr of [90, 200]) { G.near(x, z, rr, j => { const dx = x - T.x[j], dz = z - T.z[j], d = dx * dx + dz * dz; if (d < bd || (d === bd && j < best)) { bd = d; best = j; } }); if (best >= 0 && bd <= rr * rr) break; }
    if (best < 0) return false;
    const dx = x - T.x[best], dz = z - T.z[best], u = dx * F.lx[best] + dz * F.lz[best], a = dx * F.tx[best] + dz * F.tz[best];
    // (the barrier's line between this cross-section and the next one along, towards the place)
    const A = u >= 0 ? plan.runoff.L : plan.runoff.R, j = F.closed ? (best + (a >= 0 ? 1 : n - 1)) % n : clamp(best + (a >= 0 ? 1 : -1), 0, n - 1);
    const reach = A[best] + (A[j] - A[best]) * clamp(Math.abs(a) / F.ds, 0, 1);
    // (beyond a point-to-point track's ends: its end barriers, 10 m out)
    if (!F.closed && ((best === 0 && a < -F.ds) || (best === n - 1 && a > F.ds))) return Math.abs(a) <= 10 + pad && Math.abs(u) <= Math.max(plan.runoff.L[best], plan.runoff.R[best], W) + pad;
    return Math.abs(u) <= reach + pad;
  };
}

function placeScenery(plan, T, F, rules, r, cfg) {
  const n = F.n, ds = F.ds, W = T.width / 2, closed = F.closed, wrap = i => closed ? ((i % n) + n) % n : clamp(i, 0, n - 1);
  const G = pointGrid(T, 40), blocked = blockedBy(plan, T, F, G), objs = plan.objects;
  const O = s => s > 0 ? plan.runoff.L : plan.runoff.R;
  // a place `out` m beyond the barrier at centreline point i, on a side
  const beside = (i, side, out) => { const o = O(side)[i] + out; return [T.x[i] + side * F.lx[i] * o, T.z[i] + side * F.lz[i] * o]; };
  // what's taken: big things, as circles
  const taken = [], free = (x, z, rad) => { for (const c of taken) { const dx = x - c[0], dz = z - c[1], q = rad + c[2]; if (dx * dx + dz * dz < q * q) return false; } return true; };
  // the insides of corners, kept clear for the view through them (tall things)
  const views = [];
  for (const c of plan.corners) {
    if (Math.abs(c.turn) < 30) continue;
    const poly = [];
    for (let j = c.from - 8; j <= c.to + 8; j++) { if (!closed && (j < 0 || j >= n)) continue; const i = wrap(j); poly.push(...beside(i, c.side, 0)); }
    if (poly.length >= 6) views.push(poly);
  }
  const inView = (x, z) => views.some(P => inside(P, x, z));
  // the world's edge: the ground goes margin m round the track
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, T.x[i]); x1 = Math.max(x1, T.x[i]); z0 = Math.min(z0, T.z[i]); z1 = Math.max(z1, T.z[i]); }
  const edge = cfg.build.margin - 25, onGround = (x, z) => x > x0 - edge && x < x1 + edge && z > z0 - edge && z < z1 + edge;
  // a rectangle's footprint (centre, facing (fx, fz), along × deep) clear of the track, the views and what's there
  const footprintClear = (x, z, fx, fz, along, deep, pad, tall = true) => {
    const ax = -fz, az = fx;          // (along the front)
    for (const [u, w] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0, 0], [-0.5, 0], [0.5, 0], [0, -0.5], [0, 0.5]]) {
      const px = x + ax * along * u + fx * deep * w, pz = z + az * along * u + fz * deep * w;
      if (!onGround(px, pz) || blocked(px, pz, pad) || (tall && inView(px, pz))) return false;
    }
    return true;
  };
  const face = (i, side) => [-side * F.lx[i], -side * F.lz[i]];        // (towards the track)
  // a sign or board (wide m) mounted just behind the barrier at i: behind its furthest point that wide,
  // and both its ends clear — null where it won't fit (the barrier swinging in or out there)
  const mount = (i, side, out, wide) => {
    const k = Math.ceil(wide / 2 / ds) + 1, A = O(side);
    let o = A[i];
    for (let d = -k; d <= k; d++) { const j = closed ? wrap(i + d) : i + d; if (j >= 0 && j < n) o = Math.max(o, A[j]); }
    const x = T.x[i] + side * F.lx[i] * (o + out), z = T.z[i] + side * F.lz[i] * (o + out);
    for (const e of [-wide / 2, 0, wide / 2]) if (blocked(x + F.tx[i] * e, z + F.tz[i] * e, 0.25)) return null;
    return [x, z];
  };
  const add = o => { for (const k of Object.keys(o)) if (typeof o[k] === 'number' && k !== 'i' && k !== 'n' && k !== 'brand' && k !== 'd' && k !== 'rows') o[k] = fix(o[k], 100); objs.push(o); return o; };
  const markFence = (cx, cz, side, reach) => { const F2 = side > 0 ? plan.fence.L : plan.fence.R; for (let i = 0; i < n; i++) { const [bx, bz] = beside(i, side, 0), dx = bx - cx, dz = bz - cz; if (dx * dx + dz * dz <= reach * reach) F2[i] = 1; } };
  const S = plan.start.i;

  // ---------- the start: the light gantry over the line, the timing tower ----------
  add({ k: 'gantry', i: S, x: T.x[S], z: T.z[S], fx: F.tx[S], fz: F.tz[S], left: plan.runoff.L[S] + 1.4, right: plan.runoff.R[S] + 1.4 });
  if (!closed) { const Fi = plan.finish.i; add({ k: 'finish', i: Fi, x: T.x[Fi], z: T.z[Fi], fx: F.tx[Fi], fz: F.tz[Fi], left: plan.runoff.L[Fi] + 1.4, right: plan.runoff.R[Fi] + 1.4 }); }
  const pitSide = plan.pit?.side ?? 0, standSide = pitSide ? -pitSide : (plan.runoff.L[S] >= plan.runoff.R[S] ? 1 : -1);
  {
    const towerSide = pitSide || -standSide;
    for (const di of [6, 12, 20, -10, 30]) {
      const i = wrap(S + Math.round(di / ds)), [x, z] = beside(i, towerSide, pitSide ? PIT.back - PIT.front + 6 : 6), [fx, fz] = face(i, towerSide);
      if (footprintClear(x, z, fx, fz, 5, 5, 1)) { add({ k: 'tower', i, x, z, fx, fz, h: 18 }); taken.push([x, z, 5]); break; }
    }
  }
  // the pits: the garages' row (track/build.js draws it from plan.pit), kept clear
  if (plan.pit) { const P = plan.pit; for (let i = P.from; i <= P.to; i += 4) { const [x, z] = beside(i, P.side, (PIT.back - PIT.front) / 2); taken.push([x, z, 12]); } }

  // ---------- grandstands: the main straight, then the outsides of the slowest corners ----------
  const G0 = rules.grandstands;
  const stand = (i, side, lengths, main = false) => {
    for (const len of lengths) {
      const deep = clamp(len * 0.2, 10, 18), [x, z] = beside(i, side, 6 + deep / 2), [fx, fz] = face(i, side);
      if (!footprintClear(x, z, fx, fz, len, deep, 2) || !free(x, z, len / 2)) continue;
      const rows = Math.round(clamp(deep / 0.9, 8, 18));
      add({ k: 'grandstand', i, side, x, z, fx, fz, len, deep, h: fix(rows * 0.55 + 4, 100), rows, main: main ? 1 : 0 });
      taken.push([x, z, len / 2]); markFence(x, z, side, len / 2 + 12);
      return true;
    }
    return false;
  };
  let stands = 0;
  if (G0 > 0) { for (const di of [0, 30, -30, 60]) if (stand(wrap(S + Math.round(di / ds)), standSide, [120, 100, 80, 60], true)) { stands++; break; } }
  const slow = plan.corners.filter(c => c.kind === 'hairpin' || c.vApex < 120).sort((a, b) => (b.kind === 'hairpin') - (a.kind === 'hairpin') || a.vApex - b.vApex || a.n - b.n);
  for (const c of slow) {
    if (stands >= G0) break;
    const lens = [r.int(50, 75), 45, 35];
    for (const j of [c.apex, c.from, c.to]) if (stand(wrap(j), -c.side, lens)) { stands++; break; }
  }

  // ---------- marshal posts, light towers ----------
  {
    const every = Math.round(rules.marshalEvery / ds);
    let side = 1;
    for (let j = Math.round(every / 2); j < n; j += every) {
      const c = plan.corners.find(c => c.from - j > 0 && (c.from - j) * ds < 120);
      const sd = c ? -c.side : (side = -side);
      for (const dj of [0, 10, -10, 20]) {
        const i = wrap(j + dj), [x, z] = beside(i, sd, 2.4), [fx, fz] = face(i, sd);
        if (onGround(x, z) && !blocked(x, z, 0.8) && free(x, z, 1.5)) { add({ k: 'marshal', i, x, z, fx, fz }); taken.push([x, z, 1.5]); break; }
      }
    }
  }
  for (let q = 0; q < (rules.lightTowers ?? 0); q++) {
    const j = Math.round((q + 0.5) / rules.lightTowers * n), sd = q % 2 ? 1 : -1;
    for (const dj of [0, 8, -8, 16, -16]) {
      const i = wrap(j + dj), [x, z] = beside(i, sd, 5), [fx, fz] = face(i, sd);
      if (onGround(x, z) && !blocked(x, z, 2) && !inView(x, z) && free(x, z, 2)) { add({ k: 'light', i, x, z, fx, fz, h: 26 }); taken.push([x, z, 2]); break; }
    }
  }

  // ---------- braking boards and corner numbers (behind the barrier, before each corner) ----------
  plan.corners.forEach((c, q) => {
    const prevTo = q ? plan.corners[q - 1].to : (closed ? plan.corners.at(-1).to - n : 0), out = -c.side;
    if (c.vEntry - c.vApex >= 50 && (c.apex - c.brakeFrom) * ds >= 60) {
      for (const d of [300, 200, 100]) {
        const j = c.from - Math.round(d / ds);
        if (j <= prevTo + Math.round(10 / ds) || (!closed && j < 0)) continue;
        const i = wrap(j), m = mount(i, out, 0.7, 1.3), [fx, fz] = face(i, out);
        if (m) add({ k: 'brakeboard', i, x: m[0], z: m[1], fx, fz, d });
      }
    }
    const j = Math.max(prevTo + 1, c.from - Math.round(25 / ds));
    if (closed || j >= 0) { const i = wrap(j), m = mount(i, out, 0.7, 1.2), [fx, fz] = face(i, out); if (m) add({ k: 'cornersign', i, x: m[0], z: m[1], fx, fz, n: c.n }); }
  });

  // ---------- advertising: boards behind the barrier on the straights, and by the grandstands ----------
  {
    const brands = cfg.brands.length, every = Math.round(36 / ds);
    let count = 0;
    for (const side of [1, -1]) for (let i = 0; i < n && count < rules.boards; i += every) {
      const Fe = side > 0 ? plan.fence.L : plan.fence.R, straight = Math.abs(T.k[i]) < 1 / 500;
      if (!straight && !Fe[i]) continue;
      if (r.float() > (Fe[i] ? 0.9 : 0.45)) continue;
      const m = mount(i, side, 0.75, 6), [fx, fz] = face(i, side);
      if (!m) continue;
      add({ k: 'board', i, x: m[0], z: m[1], fx, fz, brand: r.int(0, brands - 1) }); count++;
    }
  }

  // ---------- a footbridge over a straight (not the main one) ----------
  if (r.float() < (rules.footbridge ?? 0)) {
    const start = closed ? Math.round((T.start.straight + 60) / ds) : Math.round(120 / ds), tries = [];
    for (let i = start; i < n - Math.round(60 / ds); i += Math.round(20 / ds)) {
      let ok = true;
      for (let j = i - Math.round(25 / ds); j <= i + Math.round(25 / ds) && ok; j++) if (Math.abs(T.k[wrap(j)]) > 1 / 900) ok = false;
      if (ok && plan.runoff.L[i] <= W + 30 && plan.runoff.R[i] <= W + 30) tries.push(i);
    }
    while (tries.length) {
      const i = tries.splice(r.int(0, tries.length - 1), 1)[0], [ax, az] = beside(i, 1, 2.5), [bx, bz] = beside(i, -1, 2.5);
      if (onGround(ax, az) && onGround(bx, bz) && !blocked(ax, az, 1) && !blocked(bx, bz, 1) && free(ax, az, 3) && free(bx, bz, 3)) {
        add({ k: 'footbridge', i, x: T.x[i], z: T.z[i], fx: F.tx[i], fz: F.tz[i], left: plan.runoff.L[i] + 2.5, right: plan.runoff.R[i] + 2.5, brand: r.int(0, cfg.brands.length - 1) });
        taken.push([ax, az, 3], [bx, bz, 3]);
        break;
      }
    }
  }

  // ---------- buildings: a street circuit's city blocks along it; elsewhere a few, well away ----------
  const B = rules.buildings;
  if (B?.count) {
    let placed = 0;
    if (B.style === 'city') {
      for (const side of [1, -1]) for (let j = 0; j < n && placed < B.count; j += Math.round(r.range(22, 34) / ds)) {
        const i = wrap(j), along = r.range(14, 30), deep = r.range(12, 24), [x, z] = beside(i, side, 7 + deep / 2), [fx, fz] = face(i, side);
        if (footprintClear(x, z, fx, fz, along, deep, 2) && free(x, z, Math.max(along, deep) / 2)) {
          add({ k: 'building', i, x, z, fx, fz, w: along, d: deep, h: r.range(B.height[0], B.height[1]), style: B.style }); taken.push([x, z, Math.max(along, deep) / 2]); placed++;
        }
      }
    } else {
      for (let t = 0; t < B.count * 20 && placed < B.count; t++) {
        const i = r.int(0, n - 1), side = r.float() < 0.5 ? 1 : -1, along = r.range(10, 22), deep = r.range(8, 14), [x, z] = beside(i, side, r.range(50, 160)), [fx, fz] = face(i, side);
        if (footprintClear(x, z, fx, fz, along, deep, 8) && free(x, z, Math.max(along, deep) / 2 + 6)) {
          add({ k: 'building', i, x, z, fx, fz, w: along, d: deep, h: r.range(B.height[0], B.height[1]), style: B.style }); taken.push([x, z, Math.max(along, deep) / 2 + 4]); placed++;
        }
      }
    }
  }

  // ---------- trees: clumps and single ones round the track; rocks ----------
  const scatter = (spec, kind, pad, gap, tall) => {
    if (!spec?.count) return;
    const kinds = spec.kinds, grid = new Map(), cell = 8, key = (a, b) => a * 100003 + b;
    const room = (x, z) => { const a = Math.floor(x / cell), b = Math.floor(z / cell); for (let p = a - 1; p <= a + 1; p++) for (let q = b - 1; q <= b + 1; q++) for (const [tx, tz] of grid.get(key(p, q)) ?? []) { const dx = x - tx, dz = z - tz; if (dx * dx + dz * dz < gap * gap) return false; } return true; };
    const put = (x, z) => { const k = key(Math.floor(x / cell), Math.floor(z / cell)); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push([x, z]); };
    let placed = 0;
    const clumps = Math.max(1, spec.clumps ?? 1), per = Math.ceil(spec.count / clumps);
    for (let c = 0; c < clumps * 3 && placed < spec.count; c++) {
      // (a clump's centre: beside the track at some distance out, anywhere round it)
      const i = r.int(0, n - 1), side = r.float() < 0.5 ? 1 : -1, [cx, cz] = beside(i, side, r.range(spec.near ?? 8, spec.far ?? 180)), rad = r.range(20, 70);
      for (let t = 0; t < per * 2 && placed < spec.count; t++) {
        const x = cx + (r.float() + r.float() - 1) * rad, z = cz + (r.float() + r.float() - 1) * rad;
        if (!onGround(x, z) || blocked(x, z, pad) || (tall && inView(x, z)) || !free(x, z, 0.5) || !room(x, z)) continue;
        put(x, z);
        add({ k: kind, x, z, kind: r.weighted(kinds), size: r.range(0.7, 1.35), turn: r.range(0, 6.283) });
        placed++;
      }
    }
  };
  scatter(rules.trees, 'tree', 4, 3.2, true);
  scatter(rules.rocks, 'rock', 3, 2.5, false);
}

// a point inside a polygon (flat x, z list): even-odd crossing
function inside(P, x, z) {
  let c = false;
  for (let a = 0, b = P.length - 2; a < P.length; b = a, a += 2) {
    const xa = P[a], za = P[a + 1], xb = P[b], zb = P[b + 1];
    if ((za > z) !== (zb > z) && x < (xb - xa) * (z - za) / (zb - za) + xa) c = !c;
  }
  return c;
}

function hashPlan(P) {
  const v = [P.version, P.n, P.start.s];
  for (const A of [P.runoff.L, P.runoff.R, P.surface.L, P.surface.R, P.barrier.L, P.barrier.R, P.fence.L, P.fence.R]) for (const x of A) v.push(x);
  for (const k of P.kerbs) v.push(k.side, k.from, k.len, k.type === 'flat' ? 1 : 2);
  for (const c of P.corners) v.push(c.n, c.from, c.apex, c.to, c.side, c.vEntry, c.vApex);
  if (P.pit) v.push(P.pit.side, P.pit.entry, P.pit.from, P.pit.to, P.pit.exit);
  const kinds = {};
  for (const o of P.objects) { v.push((kinds[o.k] ??= Object.keys(kinds).length + 1), o.x, o.z, o.fx ?? 0, o.fz ?? 0); }
  return fnv(v);
}
