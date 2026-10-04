// A route's racing line, pure: where across the road to drive (minimum curvature: straightening every bend
// as far as the road's width allows, a safety margin from the edges), and how fast a given car can take
// it — corner speeds from its grip (and downforce), braking zones worked backwards from each corner, the
// acceleration out of them from its power, drag and traction. Baked with the route when it's saved (the
// offsets: route/model.js), worked out per car at the start of a race from its real numbers.
//
//   racingLine(line, { loop, margin }) → { d: Float32Array (m left of the centreline), points: [{ x, z, h, s, w, d, k }], length }
//   carCaps(stats) → { mass, grip, brake, power, topSpeed, cda, downforce, traction }   (garage stats: totals + spec)
//   speedPlan(rl, caps, { loop, corner, braking, start }) → Float32Array, m/s at each point
//   lapTime(rl, v) → s     encodeOffsets(d) / decodeOffsets(str, n)

const G = 9.81, RHO = 1.225;

// the curvature at each point of a polyline (1/m, + left): from the turn between its neighbours `span` away
function curvatures(pts, loop, span = 2) {
  const n = pts.length, k = new Float32Array(n);
  const at = i => pts[loop ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))];
  for (let i = 0; i < n; i++) {
    const a = at(i - span), b = pts[i], c = at(i + span);
    const ax = b.x - a.x, az = b.z - a.z, bx = c.x - b.x, bz = c.z - b.z;
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz), lc = Math.hypot(c.x - a.x, c.z - a.z);
    if (la < 1e-6 || lb < 1e-6 || lc < 1e-6) continue;
    // (x east, z south: a left turn is ax·bz − az·bx < 0)
    k[i] = -2 * (ax * bz - az * bx) / (la * lb * lc);
  }
  return k;
}

// The line the racing line is worked out on: the centreline smoothed (a map's sharp vertex, a hairpin
// drawn as two straight lines meeting, becomes a bend) and resampled every 2 m, each point knowing how far
// it lies off the real centreline (dev, + left) and how wide the road is there — so the racing line's
// limits are always the real road's edges.
export function referenceLine(line, loop = false, { step = 2, passes = 12 } = {}) {
  const n0 = line.length;
  // resample
  let pts = [];
  for (let i = 0; i < n0 - (loop ? 0 : 1); i++) {
    const a = line[i], b = line[(i + 1) % n0], L = Math.hypot(b.x - a.x, b.z - a.z), m = Math.max(1, Math.round(L / step));
    for (let j = 0; j < m; j++) { const t = j / m; pts.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, h: a.h + (b.h - a.h) * t, w: t < 0.5 ? a.w : b.w, src: i + t }); }
  }
  if (!loop) pts.push({ x: line[n0 - 1].x, z: line[n0 - 1].z, h: line[n0 - 1].h, w: line[n0 - 1].w, src: n0 - 1 });
  const n = pts.length;
  // smooth (the ends of an open route stay put)
  for (let it = 0; it < passes; it++) {
    const c = pts.map(p => [p.x, p.z]);
    for (let i = 0; i < n; i++) {
      if (!loop && (i === 0 || i === n - 1)) continue;
      const a = c[(i - 1 + n) % n], b = c[(i + 1) % n];
      pts[i].x = (a[0] + 2 * c[i][0] + b[0]) / 4; pts[i].z = (a[1] + 2 * c[i][1] + b[1]) / 4;
    }
  }
  // how far off the real centreline each point now is (+ left of it), and the road there
  let k = 0;
  for (const p of pts) {
    let best = null;
    for (let j = Math.max(0, Math.floor(p.src) - 4); j <= Math.min(n0 - (loop ? 1 : 2), Math.floor(p.src) + 4); j++) {
      const a = line[j], b = line[(j + 1) % n0], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1e-9, t = clamp((((p.x - a.x) * dx + (p.z - a.z) * dz) / L2), 0, 1);
      const qx = a.x + dx * t, qz = a.z + dz * t, dist = Math.hypot(p.x - qx, p.z - qz);
      if (!best || dist < best.dist) best = { dist, dev: ((p.x - qx) * dz - (p.z - qz) * dx) / Math.sqrt(L2), w: t < 0.5 ? a.w : b.w, h: a.h + (b.h - a.h) * t };
    }
    p.dev = best?.dev ?? 0; p.w = best?.w ?? p.w; p.h = best?.h ?? p.h;
    k++;
  }
  return pts;
}
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// each point's limits across (from its reference point, + left): the road's edges less the margin, the
// road's narrowest within 8 m either way (a car is long, and where a road narrows there's a corner)
function bounds(ref, loop, margin, limits = null) {
  const n = ref.length, lo = new Float32Array(n), hi = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let w = Infinity;
    for (let j = -4; j <= 4; j++) { const q = loop ? ((i + j) % n + n) % n : clamp(i + j, 0, n - 1); w = Math.min(w, ref[q].w); }
    // (a narrow street: the mapped width is an estimate and there are walls at its edge — nearer the middle)
    // (and the outer tenth of a road either side not counted: kerbs, gutters, parked cars, a step to
    // the road beside it — real roads are less than their mapped width)
    const half = Math.max(0, w * 0.4 - margin - Math.max(0, 7 - w) * 0.4);
    lo[i] = -half - ref[i].dev; hi[i] = half - ref[i].dev;
    if (lo[i] > hi[i]) lo[i] = hi[i] = (lo[i] + hi[i]) / 2;
  }
  // a hairpin's inside (a bend under 15 m radius): not cut — a mountain road's mapped width is least true
  // on the inside of its hairpins, where there's a bank or a drop
  const K = curvatures(ref, loop, 6);
  for (let i = 0; i < n; i++) {
    let k = 0;
    for (let j = -6; j <= 6; j++) { const q = loop ? ((i + j) % n + n) % n : clamp(i + j, 0, n - 1); if (Math.abs(K[q]) > Math.abs(k)) k = K[q]; }
    if (Math.abs(k) < 1 / 15) continue;
    // (+ curvature: a left bend, its inside to the left)
    if (k > 0) hi[i] = Math.max(lo[i], Math.min(hi[i], 0.4 - ref[i].dev));
    else lo[i] = Math.min(hi[i], Math.max(lo[i], -0.4 - ref[i].dev));
  }
  // what's really there (fitRacingLine: the world's walls, banks and kerbs, measured): never past them —
  // where the gap's narrower than the limits, through its middle
  if (limits) for (let i = 0; i < n; i++) {
    const L = limits[i];
    if (!L) continue;
    if (L.lo > L.hi) { lo[i] = hi[i] = (L.lo + L.hi) / 2; continue; }
    lo[i] = Math.max(lo[i], L.lo); hi[i] = Math.min(hi[i], L.hi);
    if (lo[i] > hi[i]) { const m = clamp((lo[i] + hi[i]) / 2, L.lo, L.hi); lo[i] = hi[i] = m; }
  }
  return { lo, hi };
}

// Minimum curvature within the road: each point pulled along its normal towards the straight line between
// its neighbours (coarse to fine: neighbours far apart first, so a long bend is straightened as a whole,
// then near), kept inside the road. The ends of an open route stay on the centreline (the grid, the line).
export function racingLine(line, { loop = false, margin = 1.1, passes = [32, 16, 8, 4, 2, 1], iterations = 50, limits = null } = {}) {
  const ref = referenceLine(line, loop), n = ref.length, d = new Float32Array(n);
  if (n < 5) return withPoints(ref, d, loop, margin, limits);
  const { lo, hi } = bounds(ref, loop, margin, limits);
  // (each point's left normal)
  const nx = new Float32Array(n), nz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = ref[loop ? (i - 1 + n) % n : Math.max(0, i - 1)], b = ref[loop ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const tx = b.x - a.x, tz = b.z - a.z, L = Math.hypot(tx, tz) || 1;
    nx[i] = tz / L; nz[i] = -tx / L;
  }
  // an open route: the first and last 30 m back to the real centreline (the grid, the finish gate)
  const S = new Float32Array(n);
  for (let i = 1; i < n; i++) S[i] = S[i - 1] + Math.hypot(ref[i].x - ref[i - 1].x, ref[i].z - ref[i - 1].z);
  if (!loop) for (let i = 0; i < n; i++) { const e = Math.min(S[i], S[n - 1] - S[i]); if (e < 30) { const f = e / 30; lo[i] = lo[i] * f - ref[i].dev * (1 - f); hi[i] = hi[i] * f - ref[i].dev * (1 - f); d[i] = -ref[i].dev * (1 - f); } }
  for (let i = 0; i < n; i++) d[i] = clamp(d[i], lo[i], hi[i]);
  const px = i => ref[i].x + nx[i] * d[i], pz = i => ref[i].z + nz[i] * d[i];
  const idx = i => loop ? ((i % n) + n) % n : i;
  for (const span of passes) {
    for (let it = 0; it < iterations; it++) {
      for (let i = 0; i < n; i++) {
        // (the point where the line's second difference is smoothest — its fourth difference zero: the
        // least bending, not the shortest way, which would be straight lines kinked at the edges)
        const a = i - 2 * span, b = i - span, c = i + span, e = i + 2 * span;
        let mx, mz;
        if (!loop && (a < 0 || e >= n)) {
          if (!loop && (b < 0 || c >= n)) continue;
          mx = (px(idx(b)) + px(idx(c))) / 2; mz = (pz(idx(b)) + pz(idx(c))) / 2;
        } else {
          mx = (-px(idx(a)) + 4 * px(idx(b)) + 4 * px(idx(c)) - px(idx(e))) / 6;
          mz = (-pz(idx(a)) + 4 * pz(idx(b)) + 4 * pz(idx(c)) - pz(idx(e))) / 6;
        }
        const want = d[i] + ((mx - px(i)) * nx[i] + (mz - pz(i)) * nz[i]);
        d[i] = clamp(d[i] + (want - d[i]) * 0.5, lo[i], hi[i]);
      }
    }
  }
  return withPoints(ref, d, loop, margin, limits);
}

// The racing line fitted to the world: at each point of the reference line, rays across the road at
// kerb height and a little above (probe.cast) find what's really there — a wall, a bank, a kerb the map's
// width doesn't know of — and the line is worked out again inside it (a car's half width and a little
// from each). Where there's no ground loaded (probe.ground: null), the mapped width stands.
//   fitRacingLine(line, { loop, margin }, probe: { ground(x, z, h) → y | null, cast(x, y, z, dx, dz, len) → distance | null }) → racing line
export function fitRacingLine(line, { loop = false, margin = 1.1 } = {}, probe) {
  const ref = referenceLine(line, loop), n = ref.length, limits = new Array(n).fill(null), half = 1.15;
  let fitted = 0;
  for (let i = 0; i < n; i++) {
    const p = ref[i], a = ref[loop ? (i - 1 + n) % n : Math.max(0, i - 1)], b = ref[loop ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const tx = b.x - a.x, tz = b.z - a.z, L = Math.hypot(tx, tz) || 1, nx = tz / L, nz = -tx / L;
    const y = probe.ground(p.x, p.z, p.h);
    if (y == null) continue;
    const reach = p.w / 2 + 3;
    const side = sign => { let d = reach; for (const up of [0.35, 0.9]) { const h = probe.cast(p.x, y + up, p.z, nx * sign, nz * sign, reach); if (h != null) d = Math.min(d, h); } return d; };
    const l = side(1), r = side(-1);
    if (l < 0.25 && r < 0.25) continue;          // (the reference point itself in something: no measure)
    limits[i] = { lo: -(r - half), hi: l - half, gap: l + r };
    fitted++;
  }
  const rl = racingLine(line, { loop, margin, limits });
  rl.fitted = fitted / n;
  return rl;
}

// The line's points from its reference line and offsets (s along the racing line itself, its curvature,
// and how far it may move either way: left, right)
export function withPoints(ref, d, loop = false, margin = 1.1, limits = null) {
  if (ref.length && ref[0].dev === undefined) ref = referenceLine(ref, loop);
  const n = ref.length, pts = new Array(n), B = bounds(ref, loop, margin, limits);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = ref[loop ? (i - 1 + n) % n : Math.max(0, i - 1)], b = ref[loop ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const tx = b.x - a.x, tz = b.z - a.z, L = Math.hypot(tx, tz) || 1, di = d[i] ?? 0, x = ref[i].x + tz / L * di, z = ref[i].z - tx / L * di;
    if (i) s += Math.hypot(x - pts[i - 1].x, z - pts[i - 1].z);
    pts[i] = { x, z, h: ref[i].h, w: ref[i].w, s, d: di + ref[i].dev, k: 0, left: Math.max(0, B.hi[i] - di), right: Math.max(0, di - B.lo[i]) };
    if (limits?.[i]?.gap != null) pts[i].gap = limits[i].gap;
  }
  // (over 12 m: what a car drives through, not a kink between two points)
  const k = curvatures(pts, loop, 6);
  for (let i = 0; i < n; i++) pts[i].k = k[i];
  const length = loop ? s + Math.hypot(pts[0].x - pts[n - 1].x, pts[0].z - pts[n - 1].z) : s;
  return { d, points: pts, length };
}

// the starter car's numbers (the editor's preview, without the garage): from its stats
export const STARTER_CAPS = { mass: 1150, grip: 0.836, brake: 9.48, power: 76900, topSpeed: 53.6, cda: 0.722, downforce: 0, traction: 0.546, rolling: 0.012, turnRadius: 4.1 };

// What a car can do, from the garage's numbers for its build (its parts, its tuning): grip (g, cornering),
// braking (m/s², from its 100–0), power at the wheels, top speed, drag and downforce, traction
export function carCaps(stats) {
  const t = stats.totals, s = stats.spec, E = t.rating.estimates;
  const mass = t.mass, aero = s.aero ?? {};
  const lift = (aero.front?.liftCoefficient ?? 0) + (aero.rear?.liftCoefficient ?? 0);
  const layout = s.drivetrain?.layout ?? 'RWD';
  return {
    mass, grip: E.grip, brake: (100 / 3.6) ** 2 / (2 * E.braking),
    power: t.peakPower.kw * 1000 * (s.drivetrain?.efficiency ?? 0.9), topSpeed: E.topSpeed / 3.6,
    cda: (aero.dragCoefficient ?? 0.35) * (aero.frontalArea ?? 2), downforce: Math.max(0, -lift) * (aero.frontalArea ?? 2),
    traction: (layout === 'AWD' || layout === '4WD' ? 0.95 : 0.52) * (s.tyre?.longitudinal?.D ?? 1),
    rolling: s.tyre?.rollingResistance ?? 0.012,
    // (the tightest it can turn: the wheelbase over the tangent of full lock)
    turnRadius: wheelbaseOf(s) / Math.tan(((s.steering?.maxWheelRotation ?? 900) / 2 / (s.steering?.ratio ?? 15)) * Math.PI / 180),
  };
}

const wheelbaseOf = s => { const m = s.suspension?.mounts ?? s.wheels?.mounts; if (m?.FL && m?.RL) return Math.abs(m.FL[2] - m.RL[2]); return s.wheelbase ?? 2.6; };

// The speed a car can carry at each point of the racing line. corner: the share of its grip it corners at
// (a driver's margin); braking: the share of its braking it brakes with; start: the speed at the first
// point (0: a standing start; null on a loop)
export function speedPlan(rl, caps, { loop = false, corner = 0.95, braking = 0.9, start = 0, slope = true } = {}) {
  const P = rl.points, n = P.length, v = new Float32Array(n);
  const mu = caps.grip * corner * G;
  for (let i = 0; i < n; i++) {
    const k = Math.max(1e-4, Math.abs(smoothK(P, i, loop)));
    // (with downforce: v²k = μ(g + ½ρ·A·Cl·v²/m))
    const den = k - corner * caps.grip * 0.5 * RHO * caps.downforce / caps.mass;
    v[i] = Math.min(caps.topSpeed, den > 0 ? Math.sqrt(mu / den) : caps.topSpeed);
    // a bend about as tight as the car can turn at all: walking pace, with the whole road
    if (caps.turnRadius && 1 / k < caps.turnRadius * 1.6) v[i] = Math.min(v[i], 3.5);
    // (a squeeze the world's narrower than the map says — measured, fitRacingLine: walking pace through
    // a gap little wider than a car, picking up as it opens)
    const gap = rl.points[i].gap;
    if (gap != null && gap < 3.4) v[i] = Math.min(v[i], 3 + Math.max(0, gap - 2.2) * 6);
    // over a crest the road drops away: a hop (the ground curving away at up to 0.9 g), not a launch;
    // into a sharp dip, the squash kept to 0.8 g on top of its weight (it doesn't bottom out)
    if (slope) {
      const hAt = j => P[loop ? ((j % n) + n) % n : Math.max(0, Math.min(n - 1, j))].h;
      let crest = 0, dip = 0;
      for (const m of [1, 3]) {
        const span = Math.max(1, (P[Math.min(n - 1, i + m)]?.s ?? 0) - (P[Math.max(0, i - m)]?.s ?? 0)) / 2;
        const c = (hAt(i + m) - 2 * hAt(i) + hAt(i - m)) / (span * span);
        crest = Math.min(crest, c); dip = Math.max(dip, c);
      }
      if (crest < 0) v[i] = Math.min(v[i], Math.sqrt(0.9 * G / -crest));
      if (dip > 0) v[i] = Math.min(v[i], Math.sqrt(0.8 * G / dip));
      // a steep descent (over 8%): steady — some of the grip goes on holding the car back, and a car
      // going downhill fast is light on the road
      const ia = Math.max(0, i - 3), ib = Math.min(n - 1, i + 3), g = (P[ib].h - P[ia].h) / Math.max(1, P[ib].s - P[ia].s);
      if (g < -0.08) v[i] *= Math.max(0.45, 1 - (-g - 0.08) * 2.5);
    }
  }
  const ds = i => Math.max(0.1, P[i + 1].s - P[i].s);
  const grade = (i, j) => slope ? (P[j].h - P[i].h) / Math.max(0.5, Math.hypot(P[j].x - P[i].x, P[j].z - P[i].z)) : 0;
  // accelerating out: traction and power, less drag, rolling and the hill; only the grip left from cornering
  const accel = (i, vi) => {
    const lat = vi * vi * Math.abs(P[i].k) / Math.max(1e-3, mu), left = Math.sqrt(Math.max(0.05, 1 - Math.min(1, lat) ** 2));
    const a = Math.min(caps.traction * G * left, caps.power / (caps.mass * Math.max(3, vi)));
    return a - 0.5 * RHO * caps.cda * vi * vi / caps.mass - caps.rolling * G;
  };
  const decel = (i, vi) => {
    const lat = vi * vi * Math.abs(P[i].k) / Math.max(1e-3, mu), left = Math.sqrt(Math.max(0.1, 1 - Math.min(1, lat) ** 2));
    return caps.brake * braking * left + 0.5 * RHO * caps.cda * vi * vi / caps.mass;
  };
  const passes = loop ? 2 : 1;
  if (!loop && start != null) v[0] = Math.min(v[0], start);
  for (let p = 0; p < passes; p++) for (let i = 0; i < n - (loop ? 0 : 1); i++) {
    const j = (i + 1) % n, d = loop && i === n - 1 ? Math.hypot(P[0].x - P[i].x, P[0].z - P[i].z) : ds(i);
    const a = accel(i, v[i]) - G * grade(i, j);
    v[j] = Math.min(v[j], Math.sqrt(Math.max(0, v[i] * v[i] + 2 * Math.max(0, a) * d)));
  }
  for (let p = 0; p < passes; p++) for (let i = n - (loop ? 1 : 2); i >= 0; i--) {
    const j = (i + 1) % n, d = loop && i === n - 1 ? Math.hypot(P[0].x - P[i].x, P[0].z - P[i].z) : ds(i);
    const b = decel(j, v[j]) + G * grade(i, j);
    v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * Math.max(0.5, b) * d));
  }
  return v;
}
// (the curvature a car feels: the sharpest within a few metres, so a short kink isn't averaged away)
function smoothK(P, i, loop) {
  const n = P.length, at = j => P[loop ? ((j % n) + n) % n : Math.max(0, Math.min(n - 1, j))].k;
  let s = 0;
  for (let j = -1; j <= 1; j++) s += at(i + j);
  return Math.max(Math.abs(s / 3), Math.abs(at(i)) * 0.8);
}

export function lapTime(rl, v, { from = 0, to = rl.points.length - 1 } = {}) {
  const P = rl.points;
  let t = 0;
  for (let i = from; i < to; i++) t += (P[i + 1].s - P[i].s) / Math.max(0.5, (v[i] + v[i + 1]) / 2);
  return t;
}

// the offsets stored with the route: decimetres, delta-coded, base 36 joined
export function encodeOffsets(d) {
  let prev = 0;
  return Array.from(d, x => { const q = Math.round(x * 10), r = q - prev; prev = q; return r.toString(36); }).join(',');
}
export function decodeOffsets(str, n) {
  const out = new Float32Array(n);
  if (!str) return out;
  let prev = 0;
  str.split(',').forEach((t, i) => { if (i < n) { prev += parseInt(t, 36); out[i] = prev / 10; } });
  return out;
}
