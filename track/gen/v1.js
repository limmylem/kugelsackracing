// Track generator, version 1 (Phase 5 Step 1). FROZEN: a track code with version 1 must make the same
// track for ever, so nothing here may change once released — a better generator is a new file (v2.js)
// registered in track/generate.js, and this one stays for the tracks already made with it. Its numbers
// (styles, limits) are kept here for that reason, not in data/tracks.json. Everything uses track/det.js
// (deterministic arithmetic, its own sine and cosine, its own random numbers): the same seed and
// parameters give the same track, bit for bit, on any machine.
//
// How a track is made:
//   1. a sequence of elements, chosen by the seed and the style: the main straight, then corner groups —
//      single corners, fast sweepers, hairpins, chicanes, esses — with straights between them
//   2. each corner a clothoid in, an arc, a clothoid out (curvature changing steadily, never in a jump);
//      a circuit's corners scaled to turn exactly once round, and its straights' lengths solved so its
//      ends meet (heading and place): it closes with no kink
//   3. the curvature integrated into a path, resampled every ~2 m, centred
//   4. elevation from seeded waves (a circuit's periodic, so it ends at the height it started; a
//      hillclimb's on top of its climb), flattened at the start, scaled to keep within the gradient and
//      gradient-change limits; banking in fast corners, eased in and out
//   5. checks: length in range, no corner tighter than the minimum, curvature changing slowly enough,
//      gradients and banking in limits, a long enough start straight, and the track never coming close
//      to itself (run-off kept clear). Any failure: another attempt from a seed derived from this one.
//
//   generate({ seed, params }) → { ok, track, attempts: [{ attempt, reason }] } | { ok: false, error, attempts }
//     track: { closed, length, step, n, x, z, h, bank, k (curvature, 1/m: + turning right, clockwise seen from above — x east, z south), width, start: { s }, elements, stats }

import { rng, mix, sin, cos, sqrt, PI, fix } from '../det.js';

export const VERSION = 1;

const DEG = PI / 180;
export const STYLES = {
  flowing:   { groups: { corner: 4, sweeper: 4, esses: 3, chicane: 0.5, hairpin: 0.5 }, radius: [45, 160], straight: [60, 260], against: 0.3, mainStraight: [350, 650] },
  technical: { groups: { corner: 5, sweeper: 0.5, esses: 2, chicane: 2, hairpin: 2 }, radius: [22, 70], straight: [30, 160], against: 0.35, mainStraight: [250, 450] },
  fast:      { groups: { corner: 3, sweeper: 5, esses: 1, chicane: 1, hairpin: 0.3 }, radius: [70, 260], straight: [150, 600], against: 0.2, mainStraight: [550, 1000] },
  mixed:     { groups: { corner: 4, sweeper: 2, esses: 2, chicane: 1.5, hairpin: 1 }, radius: [28, 140], straight: [50, 380], against: 0.3, mainStraight: [400, 800] },
};
export const LIMITS = {
  minRadius: 14, maxCurvatureRate: 0.0022, clearance: 14, legRatio: 0.55,
  maxGrade: 0.1, maxGradeChange: 0.0012, crestGradeChange: 0.0026, maxBanking: 10, bankRamp: 40, bankEdgeGrade: 0.01,
  startStraight: 180, attempts: 60, step: 2, fastRadius: 45,
};

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function generate({ seed, params: p }) {
  const attempts = [];
  for (let a = 0; a < LIMITS.attempts; a++) {
    const r = rng(mix(seed, a)), out = attempt(r, p);
    if (out.ok) { attempts.push({ attempt: a, reason: null }); out.track.stats.attempts = a + 1; return { ok: true, track: out.track, attempts }; }
    attempts.push({ attempt: a, reason: out.reason });
  }
  return { ok: false, error: `No valid track in ${LIMITS.attempts} attempts (last: ${attempts.at(-1).reason})`, attempts };
}

// ---------- 1, 2: elements ----------
// a turn of angle th (radians, signed: + left) at radius R: its clothoids long enough for the curvature
// rate, and the radius opened up for a small angle so they fit
function turn(th, R) {
  const rate = LIMITS.maxCurvatureRate, a = Math.abs(th);
  R = Math.max(R, LIMITS.minRadius, sqrt(1 / (a * rate)) * 1.02);
  const Lt = Math.max(1 / (R * rate) * 1.05, Math.min(R * 0.35, 90));
  const La = Math.max(0, a * R - Lt);
  const Lt2 = La > 0 ? Lt : a * R;          // (no arc left: all clothoid)
  return { kind: 'turn', th, R, Lt: Lt2, La };
}

function layout(r, p, st, target) {
  const sigma = p.type === 'circuit' ? (r.float() < 0.5 ? 1 : -1) : (r.float() < 0.5 ? 1 : -1);
  const scale = clamp(target / 4000, 0.45, 1.6);
  const els = [];
  const mainLen = Math.max(LIMITS.startStraight, Math.min(r.range(st.mainStraight[0], st.mainStraight[1]), target * 0.28));
  els.push({ kind: 'straight', L: mainLen, min: LIMITS.startStraight, main: true });
  const n = r.int(p.corners[0], p.corners[1]);
  // (a circuit's corners mostly its own way round; a sprint's either way, its hairpins switching back)
  const dir = () => p.type === 'circuit' ? (r.float() < st.against ? -sigma : sigma) : (r.float() < 0.5 ? 1 : -1);
  let switchback = r.float() < 0.5 ? 1 : -1;
  for (let g = 0; g < n; g++) {
    const kind = r.weighted(st.groups), R0 = r.range(st.radius[0], st.radius[1]);
    if (kind === 'corner') els.push({ ...turn(dir() * r.range(35, 120) * DEG, R0), group: g, scalable: true });
    else if (kind === 'sweeper') els.push({ ...turn(dir() * r.range(25, 75) * DEG, Math.max(R0, 80) * r.range(1.1, 1.8)), group: g, scalable: true });
    else if (kind === 'hairpin') els.push({ ...turn((p.type === 'circuit' ? sigma : (switchback = -switchback)) * r.range(150, 180) * DEG, r.range(LIMITS.minRadius + 2, Math.max(LIMITS.minRadius + 8, st.radius[0]))), group: g, scalable: true, hairpin: true });
    else if (kind === 'chicane') {
      const d = r.float() < 0.5 ? 1 : -1, a = r.range(22, 42) * DEG, R = r.range(st.radius[0], st.radius[0] * 1.6);
      els.push({ ...turn(d * a, R), group: g }, { kind: 'straight', L: r.range(0, 12), min: 0 }, { ...turn(-d * a, R), group: g });
    } else {                                 // esses: two or three, each the other way
      const m = r.int(2, 3);
      let d = r.float() < 0.5 ? 1 : -1;
      for (let k = 0; k < m; k++) { els.push({ ...turn(d * r.range(30, 70) * DEG, R0 * r.range(0.8, 1.3)), group: g, scalable: true }); if (k < m - 1) els.push({ kind: 'straight', L: r.range(0, 20), min: 0 }); d = -d; }
    }
    if (g < n - 1 || p.type === 'p2p') els.push({ kind: 'straight', L: r.range(st.straight[0], st.straight[1]) * scale, min: 0 });
  }
  // the straights stretched or shrunk towards the length wanted (the corners as they are)
  const turnLen = els.reduce((a, e) => a + (e.kind === 'turn' ? 2 * e.Lt + e.La : 0), 0), other = els.reduce((a, e) => a + (e.kind === 'straight' && !e.main ? e.L : 0), 0);
  if (other > 0) { const f = clamp((target - turnLen - mainLen) / other, 0.3, 3); for (const e of els) if (e.kind === 'straight' && !e.main) e.L *= f; }
  if (p.type === 'circuit') {
    // turning exactly once round: the corners that go the circuit's way scaled to make it up
    let main = 0, other = 0;
    for (const e of els) if (e.kind === 'turn') { if (e.scalable && Math.sign(e.th) === sigma) main += e.th; else other += e.th; }
    if (!main) return { reason: 'no corners the circuit\'s way round' };
    const f = (sigma * 2 * PI - other) / main;
    if (f < 0.55 || f > 1.8) return { reason: `its corners don't add up to one lap (×${fix(f, 100)} needed)` };
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      if (e.kind !== 'turn' || !e.scalable || Math.sign(e.th) !== sigma) continue;
      if (Math.abs(e.th * f) > 200 * DEG) return { reason: 'a corner would turn more than 200°' };
      els[i] = { ...e, ...turn(e.th * f, e.R) };
    }
  }
  return { els, sigma };
}

// curvature pieces: { L, k0, k1 } (curvature changing linearly along each)
function pieces(els) {
  const out = [];
  for (const [i, e] of els.entries()) {
    if (e.kind === 'straight') { out.push({ L: e.L, k0: 0, k1: 0, el: i }); continue; }
    const k = e.th > 0 ? 1 / e.R : -1 / e.R;
    out.push({ L: e.Lt, k0: 0, k1: k, el: i });
    if (e.La > 0) out.push({ L: e.La, k0: k, k1: k, el: i });
    out.push({ L: e.Lt, k0: k, k1: 0, el: i });
  }
  return out;
}

// the path: x, z, heading every ds (0.5 m), each piece integrated on its own sub-steps (midpoint)
function integrate(ps) {
  const pts = [{ s: 0, x: 0, z: 0, phi: 0, k: 0 }];
  let x = 0, z = 0, phi = 0, s = 0;
  for (const q of ps) {
    if (q.L <= 0) continue;
    const m = Math.max(1, Math.ceil(q.L / 0.5)), ds = q.L / m, dk = (q.k1 - q.k0) / q.L;
    for (let j = 0; j < m; j++) {
      const u0 = j * ds, um = u0 + ds / 2;
      const phim = phi + q.k0 * (um - u0) + dk * (um * um - u0 * u0) / 2;
      x += ds * cos(phim); z += ds * sin(phim);
      phi += q.k0 * ds + dk * ((u0 + ds) * (u0 + ds) - u0 * u0) / 2;
      s += ds;
      pts.push({ s, x, z, phi, k: q.k0 + dk * (u0 + ds) });
    }
  }
  return pts;
}

// a circuit's ends brought together by changing its straights' lengths (the least change, weighted by
// how long each is): positions depend on the straights' lengths linearly, their headings being fixed
function close(els) {
  const ps = pieces(els), dense = integrate(ps), end = dense.at(-1);
  // each straight's heading (the path's heading where it is)
  let s = 0;
  const heads = [];
  for (const q of ps) { if (els[q.el].kind === 'straight') { const at = dense.find(d => d.s >= s - 1e-9) ?? end; heads.push({ el: q.el, phi: at.phi }); } s += q.L; }
  // (a straight of length 0 still counts: it can grow)
  for (const [i, e] of els.entries()) if (e.kind === 'straight' && e.L <= 0 && !heads.some(h => h.el === i)) heads.push({ el: i, phi: headingBefore(els, i) });
  let ex = end.x, ez = end.z;
  const fixed = new Set();
  for (let round = 0; round < 8; round++) {
    const free = heads.filter(h => !fixed.has(h.el));
    if (free.length < 2) return { reason: 'not enough straights to close it' };
    let a = 0, b = 0, c = 0;
    const w = h => 30 + els[h.el].L, u = h => [cos(h.phi), sin(h.phi)];
    for (const h of free) { const [ux, uz] = u(h), W = w(h); a += W * ux * ux; b += W * ux * uz; c += W * uz * uz; }
    const det = a * c - b * b;
    if (Math.abs(det) < 1e-6) return { reason: 'its straights all run the same way: it can\'t close' };
    const lx = (-ex * c + ez * b) / det, lz = (ex * b - ez * a) / det;
    let clamped = false;
    for (const h of free) {
      const [ux, uz] = u(h), dL = w(h) * (ux * lx + uz * lz), e = els[h.el];
      e.L += dL; ex += dL * ux; ez += dL * uz;
      if (e.L < e.min) { const back = e.min - e.L; e.L = e.min; ex += back * ux; ez += back * uz; fixed.add(h.el); clamped = true; }
    }
    if (!clamped) break;
  }
  if (Math.abs(ex) > 0.05 || Math.abs(ez) > 0.05) return { reason: 'its ends couldn\'t be made to meet' };
  return { ok: true };
}
function headingBefore(els, i) { let phi = 0; for (let k = 0; k < i; k++) if (els[k].kind === 'turn') phi += els[k].th; return phi; }

// ---------- 3: resampled every ~step m ----------
function resampleClosed(dense, closed, step) {
  const L = dense.at(-1).s, n = Math.max(8, Math.round(L / step)), ds = L / n, out = [];
  // (a circuit: whatever the integration left of a gap closed along its length)
  const gx = closed ? dense.at(-1).x - dense[0].x : 0, gz = closed ? dense.at(-1).z - dense[0].z : 0;
  let k = 0;
  for (let i = 0; i <= n; i++) {
    const s = i === n ? L : i * ds;
    while (k < dense.length - 2 && dense[k + 1].s < s) k++;
    const a = dense[k], b = dense[k + 1], t = b.s > a.s ? clamp((s - a.s) / (b.s - a.s), 0, 1) : 0;
    out.push({ s, x: a.x + (b.x - a.x) * t - gx * s / L, z: a.z + (b.z - a.z) * t - gz * s / L, k: a.k + (b.k - a.k) * t });
  }
  if (closed) out.pop();                     // (the last point is the first again)
  return { pts: out, L, ds };
}

// ---------- 4: elevation and banking ----------
function elevation(r, p, pts, L, ds, closed, startZone) {
  const n = pts.length, lim = p.crests ? LIMITS.crestGradeChange : LIMITS.maxGradeChange;
  const K = 6, waves = [];
  for (let k = 1; k <= K; k++) waves.push({ k: closed ? k : r.range(0.6, 1.4) * k, a: r.range(0.35, 1) / (k * sqrt(k)), ph: r.range(0, 2 * PI) });
  const raw = pts.map(q => waves.reduce((h, w) => h + w.a * sin(2 * PI * w.k * q.s / L + w.ph), 0));
  // the start straight kept flat (the grid and the line), the waves easing in either side
  const flatW = q => { const d = q.s < startZone ? 0 : closed ? Math.min(q.s - startZone, L - q.s) : q.s - startZone; return smoothstep(0, 80, d); };
  const h0 = raw[0];
  let wv = raw.map((h, i) => (h - h0) * flatW(pts[i]));
  let lo = Infinity, hi = -Infinity;
  for (const h of wv) { lo = Math.min(lo, h); hi = Math.max(hi, h); }
  const amp = hi - lo > 1e-9 ? p.elevation / (hi - lo) : 0;
  wv = wv.map(h => h * amp);
  // a hillclimb's climb: steady, eased in and out
  let trend = new Array(n).fill(0);
  if (!closed && p.climb) {
    const g = pts.map(q => smoothstep(startZone, startZone + 150, q.s) * smoothstep(L, L - 150, q.s));
    let acc = 0;
    trend = g.map((v, i) => { const t = acc; acc += v * ds; return t; });
    const total = trend.at(-1) || 1;
    trend = trend.map(t => t / total * p.climb);
    let gmax = 0;
    for (let i = 1; i < n; i++) gmax = Math.max(gmax, Math.abs(trend[i] - trend[i - 1]) / ds);
    if (gmax > LIMITS.maxGrade * 0.85) return { reason: `its climb is too steep for its length (${Math.round(gmax * 100)}%)` };
  }
  // the waves scaled down until the gradients keep to the limits (the climb as it is)
  const grades = h => { let g = 0, c = 0, prev = null; for (let i = 1; i < (closed ? n + 1 : n); i++) { const gi = (h[i % n] - h[i - 1]) / ds; g = Math.max(g, Math.abs(gi)); if (prev != null) c = Math.max(c, Math.abs(gi - prev) / ds); prev = gi; } return { g, c }; };
  let hs = wv.map((w, i) => w + trend[i]);
  for (let round = 0; round < 12; round++) {
    const G = grades(hs);
    if (G.g <= LIMITS.maxGrade && G.c <= lim) break;
    const f = Math.min(G.g > LIMITS.maxGrade ? LIMITS.maxGrade / G.g : 1, G.c > lim ? lim / G.c : 1) * 0.97;
    wv = wv.map(w => w * f);
    hs = wv.map((w, i) => w + trend[i]);
  }
  return { h: hs };
}

function banking(p, pts, ds) {
  const maxB = Math.min(p.banking, LIMITS.maxBanking);
  if (!maxB) return pts.map(() => 0);
  const target = pts.map(q => { const R = Math.abs(q.k) > 1e-9 ? 1 / Math.abs(q.k) : Infinity; return R >= LIMITS.fastRadius && R < 2000 ? Math.sign(q.k) * maxB * clamp(150 / R, 0, 1) : 0; });
  // eased in and out: a moving average over bankRamp
  const w = Math.max(1, Math.round(LIMITS.bankRamp / ds / 2)), n = pts.length;
  const eased = target.map((_, i) => { let s = 0; for (let k = -w; k <= w; k++) s += target[Math.min(n - 1, Math.max(0, i + k))]; return s / (2 * w + 1); });
  // and never twisting faster than a real road's: the edge rising or falling against the middle by at
  // most bankEdgeGrade (in esses and quick chicanes the banking can't build before it has to turn
  // the other way, so there's less of it). The largest such banking under the eased banking: its size,
  // level where it changes from one way to the other, limited (a distance transform, two passes each
  // way round), its way kept
  const rate = LIMITS.bankEdgeGrade / (p.width / 2) * 180 / PI * ds, closed = p.type === 'circuit', laps = closed ? 2 : 1;
  const limit = v => {
    for (let a = 0; a < laps * n; a++) { const i = a % n, j = closed ? (i + n - 1) % n : i - 1; if (j >= 0 && a > 0) v[i] = Math.min(v[i], v[j] + rate); }
    for (let a = laps * n - 1; a >= 0; a--) { const i = a % n, j = closed ? (i + 1) % n : i + 1; if (j < n && a < laps * n - 1) v[i] = Math.min(v[i], v[j] + rate); }
    return v;
  };
  const size = eased.map((b, i) => {
    const prev = eased[closed ? (i + n - 1) % n : Math.max(0, i - 1)], next = eased[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    return b * prev < 0 || b * next < 0 ? 0 : Math.abs(b);
  });
  const M = limit(size);
  return eased.map((b, i) => b < 0 ? -M[i] : M[i]);
}

// ---------- 5: checks ----------
function selfClear(x, z, s, L, closed, width) {
  const D = width + 2 * LIMITS.clearance, n = x.length, cell = D, grid = new Map(), key = (i, j) => i * 65536 + j;
  for (let i = 0; i < n; i++) { const k = key(Math.floor(x[i] / cell) + 32768 & 0xffff, Math.floor(z[i] / cell) + 32768 & 0xffff); (grid.get(k) ?? grid.set(k, []).get(k)).push(i); }
  for (let i = 0; i < n; i++) {
    const ci = Math.floor(x[i] / cell), cj = Math.floor(z[i] / cell);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      for (const j of grid.get(key(ci + di + 32768 & 0xffff, cj + dj + 32768 & 0xffff)) ?? []) {
        if (j <= i) continue;
        let along = Math.abs(s[j] - s[i]);
        if (closed) along = Math.min(along, L - along);
        const need = Math.min(D, LIMITS.legRatio * along), dx = x[j] - x[i], dz = z[j] - z[i];
        if (dx * dx + dz * dz < need * need) return `it comes within ${Math.round(sqrt(dx * dx + dz * dz))} m of itself (${Math.round(need)} m needed) at ${Math.round(s[i])} m and ${Math.round(s[j])} m`;
      }
    }
  }
  return null;
}

function attempt(r, p) {
  const st = STYLES[p.style], Lmin = p.lengthKm[0] * 1000, Lmax = p.lengthKm[1] * 1000, closed = p.type === 'circuit';
  const target = r.range(Lmin, Lmax);
  const lay = layout(r, p, st, target);
  if (!lay.els) return { ok: false, reason: lay.reason };
  const els = lay.els;
  if (closed) { const c = close(els); if (!c.ok) return { ok: false, reason: c.reason }; }
  // curvature: never tighter than the minimum, never changing too fast
  const ps = pieces(els);
  for (const q of ps) {
    if (Math.abs(q.k0) > 1 / LIMITS.minRadius + 1e-9 || Math.abs(q.k1) > 1 / LIMITS.minRadius + 1e-9) return { ok: false, reason: 'a corner tighter than the minimum radius' };
    if (q.L > 0 && Math.abs(q.k1 - q.k0) / q.L > LIMITS.maxCurvatureRate * 1.001) return { ok: false, reason: 'the curvature changes too suddenly' };
  }
  const dense = integrate(ps);
  const { pts, L, ds } = resampleClosed(dense, closed, LIMITS.step);
  if (L < Lmin || L > Lmax) return { ok: false, reason: `${(L / 1000).toFixed(2)} km long (${p.lengthKm[0]}–${p.lengthKm[1]} km wanted)` };
  if (els[0].L < LIMITS.startStraight - 1e-6) return { ok: false, reason: 'its start straight is too short' };
  // (the start straight: the grid and the start line; the waves and banking leave it level)
  const startZone = Math.min(els[0].L, 260);
  const E = elevation(r, p, pts, L, ds, closed, startZone);
  if (!E.h) return { ok: false, reason: E.reason };
  const bank = banking(p, pts, ds);
  // centred on the origin, at fixed precision
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const q of pts) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const n = pts.length, X = new Float64Array(n), Z = new Float64Array(n), H = new Float64Array(n), B = new Float64Array(n), Kc = new Float64Array(n), S = new Float64Array(n);
  for (let i = 0; i < n; i++) { X[i] = fix(pts[i].x - cx); Z[i] = fix(pts[i].z - cz); H[i] = fix(E.h[i]); B[i] = fix(bank[i], 100); Kc[i] = fix(pts[i].k, 1e6); S[i] = fix(pts[i].s); }
  const why = selfClear(X, Z, S, L, closed, p.width);
  if (why) return { ok: false, reason: why };
  // gradients and banking, as they finally are
  const lim = p.crests ? LIMITS.crestGradeChange : LIMITS.maxGradeChange;
  let gmax = 0, cmax = 0, prev = null, bmax = 0, climb = 0, hlo = Infinity, hhi = -Infinity;
  for (let i = 1; i < (closed ? n + 1 : n); i++) {
    const dh = H[i % n] - H[i - 1], g = dh / ds;
    gmax = Math.max(gmax, Math.abs(g)); if (prev != null) cmax = Math.max(cmax, Math.abs(g - prev) / ds); prev = g;
    if (dh > 0) climb += dh;
  }
  for (let i = 0; i < n; i++) { bmax = Math.max(bmax, Math.abs(B[i])); hlo = Math.min(hlo, H[i]); hhi = Math.max(hhi, H[i]); }
  if (gmax > LIMITS.maxGrade + 0.002) return { ok: false, reason: `a ${Math.round(gmax * 100)}% gradient` };
  if (cmax > lim * 1.15) return { ok: false, reason: 'its gradient changes too suddenly' };
  if (bmax > Math.min(p.banking, LIMITS.maxBanking) + 0.01) return { ok: false, reason: 'too much banking' };
  // stats
  const turns = els.filter(e => e.kind === 'turn');
  const straights = []; let run = 0;
  for (const e of els) { if (e.kind === 'straight') run += e.L; else { straights.push(run); run = 0; } }
  straights.push(closed ? run + (straights[0] ?? 0) : run);
  const stats = {
    length: Math.round(L), corners: turns.filter(e => Math.abs(e.th) >= 15 * DEG).length, groups: new Set(turns.map(e => e.group)).size,
    tightest: Math.round(Math.min(...turns.map(e => e.R)) * 10) / 10, longestStraight: Math.round(Math.max(...straights)),
    elevationRange: Math.round((hhi - hlo) * 10) / 10, climb: Math.round(climb), maxGrade: Math.round(gmax * 1000) / 10, maxBanking: Math.round(bmax * 10) / 10,
    rise: closed ? 0 : Math.round(H[n - 1] - H[0]), hairpins: turns.filter(e => Math.abs(e.th) >= 150 * DEG).length,
  };
  const elements = els.map(e => e.kind === 'straight' ? { kind: 'straight', L: fix(e.L, 10) } : { kind: 'turn', deg: fix(e.th / DEG, 10), R: fix(e.R, 10), Lt: fix(e.Lt, 10), La: fix(e.La, 10) });
  return { ok: true, track: { version: VERSION, closed, length: fix(L), step: fix(ds, 1e6), n, x: X, z: Z, h: H, bank: B, k: Kc, width: p.width, start: { s: 0, straight: fix(els[0].L, 10) }, elements, stats } };
}
