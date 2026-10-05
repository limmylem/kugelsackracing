// Track generator, version 3 (Phase 5 Step 4: variety and quality). FROZEN once released, like versions 1
// and 2 (a version-3 code makes the same track for ever; a better generator is version 4). Version 1's
// machinery — clothoid corners, a circuit's corners scaled to one lap and its straights solved so its
// ends meet, resampling, elevation waves, banking eased and twist-limited, the checks — with a new way of
// choosing the elements, for tracks that are good to race:
//
//   - corners by speed class: each corner group slow, medium or fast (by the style's mix), its radius
//     and angle from that class's ranges — a real mix, not the same corner again and again (a corner too
//     like the last is chosen again)
//   - flow: a slow corner is followed by a straight long enough to get going again (no brake, burst,
//     brake); two slow corners never come back to back with a short straight between them
//   - overtaking: the main straight runs into a slow corner, and a circuit long enough has a back
//     straight into another — long straights into heavy braking
//   - elevation interest: besides the waves, one to three hills or hollows, and the track's own crest
//     where it has one
//   - room for run-off: a fast corner's outside must have room for most of the run-off its speed asks for
//     (track/gen/space.js freeSpace), or the layout is passed over
//   - a pit lane's room, as version 2's (tried within the attempts)
//   - signature features (params.signatures, on by default; chosen by the seed from the style's): a long
//     hairpin at the end of a long straight, fast esses, a banked corner (banked beyond the preset's
//     banking), a big crest on a straight, a crossover (a figure of eight, one pass on a bridge over the
//     other — circuits with params.bridges)
//
//   generate({ seed, params }) → { ok, track, attempts } as version 1's; track also has: signature
//     { kind, from, to } (indices), zones [{ from, to, kind: 'crest' | 'bridge' }] (where the gradient may
//     change as fast as a crest's), bankMax (the banking allowed: the signature corner's), crossing
//     { i, j, angle, rise, lower: i, upper: j } (a crossover), pit { side }

import { rng, mix, sin, cos, sqrt, PI, fix } from '../det.js';
import { frameOf, freeSpace } from './space.js';

export const VERSION = 3;
const DEG = PI / 180;
export const LIMITS = {
  minRadius: 14, maxCurvatureRate: 0.0022, clearance: 14, legRatio: 0.55,
  maxGrade: 0.1, maxGradeChange: 0.0012, crestGradeChange: 0.0026, maxBanking: 10, bankRamp: 40, bankEdgeGrade: 0.01,
  startStraight: 180, attempts: 200, signatureTries: 100, step: 2, fastRadius: 45,
  // version 3's own
  signatureBank: 13, runoffRoom: 0.7, fastCorner: 38, crossingAngle: 45, bridgeRise: 8.5, bridgeHalf: 175, bridgeClear: 7.2, crossingFree: 70,
  afterSlow: 110, slowToMedium: 150, slowToSlow: 175, beforeSlow: 150, mainMin: 280, backStraight: [240, 420],
};
// each style: its corner classes' mix and its signature features (weights), the straights, the main straight
export const STYLES = {
  flowing:   { classes: { slow: 0.22, medium: 0.43, fast: 0.35 }, straight: [60, 240], mainStraight: [380, 650], against: 0.25, hairpin: 0.4, chicane: 0.3,
    signatures: { fast_esses: 3, banked_corner: 2, big_crest: 1.5, long_hairpin: 1, crossover: 1.5, none: 2 } },
  technical: { classes: { slow: 0.45, medium: 0.4, fast: 0.15 }, straight: [25, 140], mainStraight: [320, 500], against: 0.35, hairpin: 1.2, chicane: 1,
    signatures: { long_hairpin: 3, big_crest: 1, crossover: 1, fast_esses: 0.5, none: 2.5 } },
  fast:      { classes: { slow: 0.18, medium: 0.32, fast: 0.5 }, straight: [140, 560], mainStraight: [600, 1000], against: 0.2, hairpin: 0.3, chicane: 0.6,
    signatures: { banked_corner: 3, fast_esses: 2, big_crest: 2, long_hairpin: 1, none: 2.5 } },
  mixed:     { classes: { slow: 0.32, medium: 0.38, fast: 0.3 }, straight: [50, 360], mainStraight: [420, 800], against: 0.3, hairpin: 0.7, chicane: 0.6,
    signatures: { long_hairpin: 2, fast_esses: 2, banked_corner: 1, big_crest: 2, crossover: 1.5, none: 2.5 } },
};
// each corner class: its radius (m) and how far it turns (°)
export const CLASSES = { slow: { R: [16, 36], deg: [65, 135] }, medium: { R: [38, 95], deg: [35, 105] }, fast: { R: [100, 230], deg: [20, 70] } };
export const SIGNATURES = ['long_hairpin', 'fast_esses', 'banked_corner', 'big_crest', 'crossover'];
// the room a pit complex needs beside the main straight (version 2's measures)
export const PIT = { front: 14, room: 32, from: 15, ramp: 45, length: 420 };

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// (a smooth bump: 1 at its middle, 0 beyond ±w, its slope and curvature continuous)
const bump = (d, w) => { const u = Math.abs(d) / w; return u >= 1 ? 0 : (1 + cos(PI * u)) / 2; };

export function generate({ seed, params: p }) {
  const attempts = [];
  // (the signature: chosen once, by the seed — kept through the attempts, none only if it can't be had)
  const sig = signatureOf(rng(mix(seed, 0x5160)), p, STYLES[p.style]);
  for (let a = 0; a < LIMITS.attempts; a++) {
    const r = rng(mix(seed, 0x3a3 + a)), out = attempt(r, p, a < LIMITS.signatureTries ? sig : 'none');
    if (out.ok) { attempts.push({ attempt: a, reason: null }); out.track.stats.attempts = a + 1; return { ok: true, track: out.track, attempts }; }
    attempts.push({ attempt: a, reason: out.reason });
  }
  return { ok: false, error: `No valid track in ${LIMITS.attempts} attempts (last: ${attempts.at(-1).reason})`, attempts };
}

// ---------- 1, 2: elements ----------
function turn(th, R) {
  const rate = LIMITS.maxCurvatureRate, a = Math.abs(th);
  R = Math.max(R, LIMITS.minRadius, sqrt(1 / (a * rate)) * 1.02);
  const Lt = Math.max(1 / (R * rate) * 1.05, Math.min(R * 0.35, 90));
  const La = Math.max(0, a * R - Lt);
  const Lt2 = La > 0 ? Lt : a * R;
  return { kind: 'turn', th, R, Lt: Lt2, La };
}

// the signature feature this track gets (or none): by the seed, from its style's
function signatureOf(r, p, st) {
  if (p.signatures === false) return 'none';
  const w = { ...st.signatures };
  if (p.type !== 'circuit' || !p.bridges) delete w.crossover;
  if (p.type !== 'circuit') delete w.banked_corner;
  return r.weighted(w);
}

function layout(r, p, st, target, sig) {
  const circuit = p.type === 'circuit', sigma = r.float() < 0.5 ? 1 : -1;
  const scale = clamp(target / 4000, 0.45, 1.6);
  const els = [];
  const mainLen = Math.max(LIMITS.startStraight, Math.min(r.range(st.mainStraight[0], st.mainStraight[1]), target * 0.28));
  // (a circuit's main straight long enough to overtake on, however the closing goes)
  els.push({ kind: 'straight', L: mainLen, min: circuit ? Math.min(clamp(target * 0.13, LIMITS.startStraight, LIMITS.mainMin), mainLen) : LIMITS.startStraight, main: true });
  const n = r.int(p.corners[0], p.corners[1]);
  const fig8 = sig === 'crossover';
  // the corners' classes: the first after the main straight slow (heavy braking at its end); a back
  // straight into another slow one; the rest by the style's mix
  const cls = [];
  for (let g = 0; g < n; g++) cls.push(r.weighted(st.classes));
  cls[0] = 'slow';
  const back = circuit && n >= 5 && target >= 1800 ? r.int(2, n - 3) : -1;
  if (back >= 0) cls[back + 1] = 'slow';
  // (flow: slow after slow, mostly medium instead — the others get a long straight between them, below)
  for (let g = 1; g < n; g++) if (cls[g] === 'slow' && cls[g - 1] === 'slow' && g !== back + 1 && r.float() < 0.6) cls[g] = 'medium';
  // (somewhere for the signature)
  const sg = sig !== 'none' && sig !== 'big_crest' && sig !== 'crossover' ? r.int(1, Math.max(1, n - 2)) : -1;
  // a figure of eight: two lobes, each turning ±(180° + the crossing angle) — the first half of the groups
  // one way, the second the other
  const half = fig8 ? Math.max(2, Math.floor(n / 2)) : n;
  const lobeDir = g => fig8 ? (g < half ? sigma : -sigma) : sigma;
  const dir = g => circuit ? (fig8 ? lobeDir(g) : (r.float() < st.against ? -sigma : sigma)) : (r.float() < 0.5 ? 1 : -1);
  let switchback = r.float() < 0.5 ? 1 : -1, prev = null;
  // a corner of a class, not too like the last one
  const pick = (c, d) => {
    const C = CLASSES[c];
    for (let t = 0; t < 4; t++) {
      const R = r.range(C.R[0], C.R[1]), deg = r.range(C.deg[0], C.deg[1]);
      if (!prev || t === 3 || Math.abs(R - prev.R) / Math.max(R, prev.R) > 0.18 || Math.abs(deg - prev.deg) > 22 || Math.sign(d) !== prev.d) { prev = { R, deg, d: Math.sign(d) }; return { R, deg }; }
    }
  };
  let crestAt = -1;
  for (let g = 0; g < n; g++) {
    const c = cls[g], d = dir(g);
    if (g === sg) {
      // ---------- signature features ----------
      if (sig === 'long_hairpin') {
        els.push({ kind: 'straight', L: r.range(200, 320) * scale, min: 160 * scale });
        els.push({ ...turn((circuit ? sigma : (switchback = -switchback)) * r.range(168, 182) * DEG, r.range(24, 34)), group: g, hairpin: true, signature: sig });
      } else if (sig === 'fast_esses') {
        const m = r.int(3, 4);
        let e = r.float() < 0.5 ? 1 : -1;
        for (let k = 0; k < m; k++) { els.push({ ...turn(e * r.range(26, 44) * DEG, r.range(115, 185)), group: g, signature: sig }); if (k < m - 1) els.push({ kind: 'straight', L: r.range(0, 14), min: 0 }); e = -e; }
      } else if (sig === 'banked_corner') {
        els.push({ ...turn(sigma * r.range(125, 185) * DEG, r.range(85, 150)), group: g, banked: true, signature: sig });
      }
      prev = null;
    } else if (c === 'slow') {
      const kind = r.weighted({ corner: 3, hairpin: circuit ? st.hairpin : st.hairpin * 0.4, chicane: g === 0 ? 0 : st.chicane });
      if (kind === 'hairpin') els.push({ ...turn((circuit ? (fig8 ? lobeDir(g) : sigma) : (switchback = -switchback)) * r.range(150, 180) * DEG, r.range(LIMITS.minRadius + 2, 28)), group: g, scalable: true, hairpin: true });
      else if (kind === 'chicane') {
        const s = r.float() < 0.5 ? 1 : -1, a = r.range(24, 42) * DEG, R = r.range(22, 38);
        els.push({ ...turn(s * a, R), group: g }, { kind: 'straight', L: r.range(0, 12), min: 0 }, { ...turn(-s * a, R), group: g });
      } else { const k = pick('slow', d); els.push({ ...turn(d * k.deg * DEG, k.R), group: g, scalable: true }); }
    } else if (c === 'medium') {
      if (r.float() < 0.25) {
        const m = 2; let e = r.float() < 0.5 ? 1 : -1;
        for (let k = 0; k < m; k++) { els.push({ ...turn(e * r.range(30, 60) * DEG, r.range(CLASSES.medium.R[0], CLASSES.medium.R[1])), group: g, scalable: fig8 ? false : true }); if (k < m - 1) els.push({ kind: 'straight', L: r.range(0, 20), min: 0 }); e = -e; }
      } else { const k = pick('medium', d); els.push({ ...turn(d * k.deg * DEG, k.R), group: g, scalable: true }); }
    } else { const k = pick('fast', d); els.push({ ...turn(d * k.deg * DEG, k.R), group: g, scalable: true }); }
    // the straight after it: long enough after a slow corner; the back straight long; the crest's straight long
    if (g < n - 1 || !circuit) {
      let L = r.range(st.straight[0], st.straight[1]) * scale, min = 0;
      // (a short track's a little less: the flow rules' straights in step with its length)
      const fs = clamp(target / 3000, 0.7, 1);
      if (c === 'slow' && g !== sg) { min = (cls[g + 1] === 'medium' ? LIMITS.slowToMedium : LIMITS.afterSlow) * fs; L = Math.max(L, min * 1.15); }
      if (c === 'slow' && cls[g + 1] === 'slow' && g !== sg) { min = Math.max(min, LIMITS.slowToSlow * fs); L = Math.max(L, min * 1.1); }
      // (into a slow corner: a straight long enough to make its braking a braking zone, not a stab)
      if (cls[g + 1] === 'slow' && g + 1 !== sg) { min = Math.max(min, LIMITS.beforeSlow * fs); L = Math.max(L, min * 1.1); }
      if (g === back) { const B = LIMITS.backStraight; min = Math.max(min, B[0] * scale); L = Math.max(L, r.range(B[0], B[1]) * scale); }
      if (sig === 'big_crest' && crestAt < 0 && g === Math.floor(n / 2)) { L = Math.max(L, r.range(360, 480)); min = Math.max(min, 350); }
      const e = { kind: 'straight', L, min, ...(g === back ? { back: true } : {}) };
      if (sig === 'big_crest' && crestAt < 0 && g === Math.floor(n / 2)) { e.crest = true; crestAt = els.length; }
      els.push(e);
    }
  }
  // the straights stretched or shrunk towards the length wanted (the corners as they are; never under their minimum)
  const turnLen = els.reduce((a, e) => a + (e.kind === 'turn' ? 2 * e.Lt + e.La : 0), 0), other = els.reduce((a, e) => a + (e.kind === 'straight' && !e.main ? e.L : 0), 0);
  if (other > 0) { const f = clamp((target - turnLen - mainLen) / other, 0.3, 3); for (const e of els) if (e.kind === 'straight' && !e.main) e.L = Math.max(e.min ?? 0, e.L * f); }
  if (circuit) {
    // turning once round (a figure of eight: each lobe ±(180° + the crossing angle), the lap 0° in all)
    const want = fig8 ? [sigma * (PI + r.range(55, 95) * DEG), -sigma * 0] : null;
    const groupsOf = side => els.map((e, i) => [e, i]).filter(([e]) => e.kind === 'turn' && (fig8 ? (e.group < half) === side : true));
    const lobes = fig8 ? [[true, want[0]], [false, -want[0]]] : [[true, sigma * 2 * PI]];
    for (const [side, total] of lobes) {
      const list = groupsOf(side), s = Math.sign(total);
      let main = 0, oth = 0;
      for (const [e] of list) { if (e.scalable && Math.sign(e.th) === s) main += e.th; else oth += e.th; }
      if (!main) return { reason: 'no corners the circuit\'s way round' };
      const f = (total - oth) / main;
      if (f < 0.45 || f > 2.1) return { reason: `its corners don't add up to ${fig8 ? 'a lobe' : 'one lap'} (×${fix(f, 100)} needed)` };
      for (const [e, i] of list) {
        if (!e.scalable || Math.sign(e.th) !== s) continue;
        if (Math.abs(e.th * f) > 200 * DEG) return { reason: 'a corner would turn more than 200°' };
        els[i] = { ...e, ...turn(e.th * f, e.R) };
      }
    }
  }
  return { els, sigma };
}

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

function integrate(ps) {
  const pts = [{ s: 0, x: 0, z: 0, phi: 0, k: 0, el: ps[0]?.el ?? 0 }];
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
      pts.push({ s, x, z, phi, k: q.k0 + dk * (u0 + ds), el: q.el });
    }
  }
  return pts;
}

function close(els) {
  const ps = pieces(els), dense = integrate(ps), end = dense.at(-1);
  let s = 0;
  const heads = [];
  for (const q of ps) { if (els[q.el].kind === 'straight') { const at = dense.find(d => d.s >= s - 1e-9) ?? end; heads.push({ el: q.el, phi: at.phi }); } s += q.L; }
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
      if (e.L < (e.min ?? 0)) { const back = (e.min ?? 0) - e.L; e.L = e.min ?? 0; ex += back * ux; ez += back * uz; fixed.add(h.el); clamped = true; }
    }
    if (!clamped) break;
  }
  if (Math.abs(ex) > 0.05 || Math.abs(ez) > 0.05) return { reason: 'its ends couldn\'t be made to meet' };
  return { ok: true };
}
function headingBefore(els, i) { let phi = 0; for (let k = 0; k < i; k++) if (els[k].kind === 'turn') phi += els[k].th; return phi; }

function resampleClosed(dense, closed, step) {
  const L = dense.at(-1).s, n = Math.max(8, Math.round(L / step)), ds = L / n, out = [];
  const gx = closed ? dense.at(-1).x - dense[0].x : 0, gz = closed ? dense.at(-1).z - dense[0].z : 0;
  let k = 0;
  for (let i = 0; i <= n; i++) {
    const s = i === n ? L : i * ds;
    while (k < dense.length - 2 && dense[k + 1].s < s) k++;
    const a = dense[k], b = dense[k + 1], t = b.s > a.s ? clamp((s - a.s) / (b.s - a.s), 0, 1) : 0;
    out.push({ s, x: a.x + (b.x - a.x) * t - gx * s / L, z: a.z + (b.z - a.z) * t - gz * s / L, k: a.k + (b.k - a.k) * t, el: t < 0.5 ? a.el : b.el });
  }
  if (closed) out.pop();
  return { pts: out, L, ds };
}

// ---------- a figure of eight's crossing ----------
// where the centreline crosses itself: exactly once, at a wide angle, away from the corners and the start
function crossingOf(X, Z, n, ds, els, pts) {
  const hits = [];
  const seg = i => [X[i], Z[i], X[(i + 1) % n], Z[(i + 1) % n]];
  const cell = 40, grid = new Map(), key = (a, b) => a * 100003 + b;
  for (let i = 0; i < n; i++) { const k = key(Math.floor(X[i] / cell), Math.floor(Z[i] / cell)); (grid.get(k) ?? grid.set(k, []).get(k)).push(i); }
  for (let i = 0; i < n; i++) {
    const [ax, az, bx, bz] = seg(i);
    for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) for (const j of grid.get(key(Math.floor(ax / cell) + da, Math.floor(az / cell) + db)) ?? []) {
      if (j <= i + 4 || (i === 0 && j >= n - 4)) continue;
      const [cx, cz, dx, dz] = seg(j), ex = bx - ax, ez = bz - az, fx = dx - cx, fz = dz - cz, den = ex * fz - ez * fx;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((cx - ax) * fz - (cz - az) * fx) / den, u = ((cx - ax) * ez - (cz - az) * ex) / den;
      if (t >= 0 && t < 1 && u >= 0 && u < 1) {
        const dot = (ex * fx + ez * fz) / (sqrt(ex * ex + ez * ez) * sqrt(fx * fx + fz * fz));
        hits.push({ i, j, angle: Math.acos(Math.min(1, Math.abs(dot))) / DEG });
      }
    }
  }
  if (hits.length !== 1) return { reason: hits.length ? `it crosses itself ${hits.length} times` : 'its figure of eight never crosses' };
  const h = hits[0];
  if (h.angle < LIMITS.crossingAngle) return { reason: `its crossing is at ${Math.round(h.angle)}° (at least ${LIMITS.crossingAngle}°)` };
  // both passes straight (or nearly) for the bridge's length, and clear of the start
  const span = Math.round(60 / ds);
  for (const c of [h.i, h.j]) {
    if (c * ds < LIMITS.startStraight + 120 || (n - c) * ds < 120) return { reason: 'its crossing is on the start straight' };
    for (let k = -span; k <= span; k++) if (Math.abs(pts[(c + k + n) % n].k) > 1 / 250) return { reason: 'its crossing is in a corner' };
  }
  return { ok: true, ...h };
}

// ---------- 4: elevation and banking ----------
function elevation(r, p, pts, L, ds, closed, startZone, { crestAt = null, crossing = null }) {
  const n = pts.length, base = p.crests ? LIMITS.crestGradeChange : LIMITS.maxGradeChange;
  const K = 6, waves = [];
  for (let k = 1; k <= K; k++) waves.push({ k: closed ? k : r.range(0.6, 1.4) * k, a: r.range(0.35, 1) / (k * sqrt(k)), ph: r.range(0, 2 * PI) });
  // hills and hollows: one to three, somewhere along it
  const hills = [], nh = r.int(1, 3);
  for (let k = 0; k < nh; k++) hills.push({ s: r.range(startZone + 100, L - 100), a: (r.float() < 0.5 ? -1 : 1) * r.range(0.35, 0.7), w: r.range(90, 200) });
  const dist = (a, b) => { const d = Math.abs(a - b); return closed ? Math.min(d, L - d) : d; };
  const raw = pts.map(q => waves.reduce((h, w) => h + w.a * sin(2 * PI * w.k * q.s / L + w.ph), 0) + hills.reduce((h, b) => h + b.a * bump(dist(q.s, b.s), b.w), 0));
  const flatW = q => { const d = q.s < startZone ? 0 : closed ? Math.min(q.s - startZone, L - q.s) : q.s - startZone; return smoothstep(0, 80, d); };
  // (a crossover: the lower pass kept level for the bridge — the waves fading out there)
  const quiet = q => crossing ? 1 - bump(dist(q.s, crossing.i * ds), LIMITS.bridgeHalf + 60) : 1;
  const h0 = raw[0];
  let wv = raw.map((h, i) => (h - h0) * flatW(pts[i]) * quiet(pts[i]));
  let lo = Infinity, hi = -Infinity;
  for (const h of wv) { lo = Math.min(lo, h); hi = Math.max(hi, h); }
  const amp = hi - lo > 1e-9 ? p.elevation / (hi - lo) : 0;
  wv = wv.map(h => h * amp);
  // the track's own crest (a big one, on a long straight) and the bridge's rise: their own size, their
  // own zones where the gradient may change as fast as a crest's
  const zones = [], fixedH = new Array(n).fill(0);
  if (crestAt != null) {
    const w = 170, A = Math.max(6, Math.min(7.5, p.elevation * 0.25 + 5));
    zones.push({ from: Math.round((crestAt - w) / ds), to: Math.round((crestAt + w) / ds), kind: 'crest' });
    for (let i = 0; i < n; i++) fixedH[i] += A * bump(dist(pts[i].s, crestAt), w);
  }
  if (crossing) {
    const sj = crossing.j * ds, w = LIMITS.bridgeHalf;
    zones.push({ from: Math.round((sj - w) / ds), to: Math.round((sj + w) / ds), kind: 'bridge' });
    for (let i = 0; i < n; i++) fixedH[i] += LIMITS.bridgeRise * bump(dist(pts[i].s, sj), w);
  }
  let trend = new Array(n).fill(0);
  if (!closed && p.climb) {
    const g = pts.map(q => smoothstep(startZone, startZone + 150, q.s) * smoothstep(L, L - 150, q.s));
    let acc = 0;
    trend = g.map(v => { const t = acc; acc += v * ds; return t; });
    const total = trend.at(-1) || 1;
    trend = trend.map(t => t / total * p.climb);
    let gmax = 0;
    for (let i = 1; i < n; i++) gmax = Math.max(gmax, Math.abs(trend[i] - trend[i - 1]) / ds);
    if (gmax > LIMITS.maxGrade * 0.85) return { reason: `its climb is too steep for its length (${Math.round(gmax * 100)}%)` };
  }
  const inZone = i => zones.some(z => i >= z.from && i <= z.to);
  const grades = h => { let g = 0, c = 0, prev = null; for (let i = 1; i < (closed ? n + 1 : n); i++) { const gi = (h[i % n] - h[i - 1]) / ds; g = Math.max(g, Math.abs(gi)); if (prev != null) { const lim = inZone(i % n) ? LIMITS.crestGradeChange : base; c = Math.max(c, Math.abs(gi - prev) / ds / lim); } prev = gi; } return { g, c }; };
  let hs = wv.map((w, i) => w + trend[i] + fixedH[i]);
  for (let round = 0; round < 14; round++) {
    const G = grades(hs);
    if (G.g <= LIMITS.maxGrade * 0.98 && G.c <= 0.85) break;          // (a margin: heights are kept to the millimetre)
    const f = Math.min(G.g > LIMITS.maxGrade ? LIMITS.maxGrade / G.g : 1, G.c > 1 ? 1 / G.c : 1) * 0.97;
    wv = wv.map(w => w * f);
    hs = wv.map((w, i) => w + trend[i] + fixedH[i]);
  }
  const G = grades(hs);
  if (G.g > LIMITS.maxGrade + 0.002 || G.c > 1.1) return { reason: 'its hills are too steep' };
  return { h: hs, zones };
}

function banking(p, pts, ds, bankZone) {
  const maxB = Math.min(p.banking, LIMITS.maxBanking), sigB = bankZone ? LIMITS.signatureBank : 0;
  if (!maxB && !sigB) return pts.map(() => 0);
  const target = pts.map((q, i) => {
    const R = Math.abs(q.k) > 1e-9 ? 1 / Math.abs(q.k) : Infinity;
    if (bankZone && i >= bankZone.from && i <= bankZone.to && R < 2000) return Math.sign(q.k) * sigB * clamp(110 / R, 0.6, 1);
    return maxB && R >= LIMITS.fastRadius && R < 2000 ? Math.sign(q.k) * maxB * clamp(150 / R, 0, 1) : 0;
  });
  const w = Math.max(1, Math.round(LIMITS.bankRamp / ds / 2)), n = pts.length, closed = p.type === 'circuit';
  const eased = target.map((_, i) => { let s = 0; for (let k = -w; k <= w; k++) s += target[closed ? ((i + k) % n + n) % n : Math.min(n - 1, Math.max(0, i + k))]; return s / (2 * w + 1); });
  const rate = LIMITS.bankEdgeGrade / (p.width / 2) * 180 / PI * ds, laps = closed ? 2 : 1;
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
function selfClear(x, z, s, L, closed, width, crossing, ds) {
  const D = width + 2 * LIMITS.clearance, n = x.length, cell = D, grid = new Map(), key = (i, j) => i * 65536 + j;
  const near = (i, c) => { const d = Math.abs(i - c); return Math.min(d, n - d) * ds <= LIMITS.crossingFree; };
  for (let i = 0; i < n; i++) { const k = key(Math.floor(x[i] / cell) + 32768 & 0xffff, Math.floor(z[i] / cell) + 32768 & 0xffff); (grid.get(k) ?? grid.set(k, []).get(k)).push(i); }
  for (let i = 0; i < n; i++) {
    const ci = Math.floor(x[i] / cell), cj = Math.floor(z[i] / cell);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      for (const j of grid.get(key(ci + di + 32768 & 0xffff, cj + dj + 32768 & 0xffff)) ?? []) {
        if (j <= i) continue;
        // (the crossing: the two passes meet there, one over the other)
        if (crossing && ((near(i, crossing.i) && near(j, crossing.j)) || (near(i, crossing.j) && near(j, crossing.i)))) continue;
        let along = Math.abs(s[j] - s[i]);
        if (closed) along = Math.min(along, L - along);
        const need = Math.min(D, LIMITS.legRatio * along), dx = x[j] - x[i], dz = z[j] - z[i];
        if (dx * dx + dz * dz < need * need) return `it comes within ${Math.round(sqrt(dx * dx + dz * dz))} m of itself (${Math.round(need)} m needed) at ${Math.round(s[i])} m and ${Math.round(s[j])} m`;
      }
    }
  }
  return null;
}
// room for the run-off a fast corner needs on its outside (the speed rule track/dress.js sizes it by,
// from an estimate of the corner's speed), and for the pit complex
function roomChecks(T, p) {
  const F = frameOf(T), free = freeSpace(T, F, { reach: 120 }), W = T.width / 2, n = T.n;
  for (let i = 0; i < n; i++) {
    const k = T.k[i];
    if (Math.abs(k) < 1 / 400) continue;
    const v = Math.min(80, sqrt(11 * (1 / Math.abs(k))));
    if (v < LIMITS.fastCorner) continue;
    // (the room as the dressing can use it: its run-off never widens faster than 0.35 m a metre along,
    // so a pinch nearby narrows it here too)
    const A = k > 0 ? free.L : free.R, w = Math.round(60 / F.ds);       // (k > 0: turning right — its outside on the left)
    let room = A[i];
    for (let d = -w; d <= w; d++) { const j = T.closed ? ((i + d) % n + n) % n : i + d; if (j >= 0 && j < n) room = Math.min(room, A[j] + 0.35 * Math.abs(d) * F.ds); }
    const need = (3.7 + 0.0134 * v * v) * LIMITS.runoffRoom, outside = room - W;
    if (outside < need) return { reason: `no room for run-off outside a ${Math.round(v * 3.6)} km/h corner at ${Math.round(i * F.ds)} m (${Math.round(outside)} m, ${Math.round(need)} m wanted)` };
  }
  if (p.pitLane && p.type === 'circuit') {
    const need = W + PIT.room, s0 = PIT.from, s1 = Math.min(T.start.straight - PIT.from, PIT.from + PIT.length), a = Math.ceil(s0 / F.ds), b = Math.floor(s1 / F.ds);
    const ok = A => { for (let i = a; i <= b; i++) if (A[i] < need) return false; return true; };
    const side = b - a > (2 * PIT.ramp + 24) / F.ds ? (ok(free.L) ? 1 : ok(free.R) ? -1 : 0) : 0;
    if (!side) return { reason: 'no room for a pit lane beside its main straight' };
    return { ok: true, pit: { side } };
  }
  return { ok: true };
}

function attempt(r, p, sig) {
  const st = STYLES[p.style], Lmin = p.lengthKm[0] * 1000, Lmax = p.lengthKm[1] * 1000, closed = p.type === 'circuit';
  const target = r.range(Lmin, Lmax);
  const lay = layout(r, p, st, target, sig);
  if (!lay.els) return { ok: false, reason: lay.reason };
  const els = lay.els;
  if (closed) { const c = close(els); if (!c.ok) return { ok: false, reason: c.reason }; }
  const ps = pieces(els);
  for (const q of ps) {
    if (Math.abs(q.k0) > 1 / LIMITS.minRadius + 1e-9 || Math.abs(q.k1) > 1 / LIMITS.minRadius + 1e-9) return { ok: false, reason: 'a corner tighter than the minimum radius' };
    if (q.L > 0 && Math.abs(q.k1 - q.k0) / q.L > LIMITS.maxCurvatureRate * 1.001) return { ok: false, reason: 'the curvature changes too suddenly' };
  }
  // (far too long — a closing that stretched a straight out of all reason — turned down before it's
  // drawn out, point by point: the same reason, the same attempts, as when it was)
  const length = ps.reduce((a, q) => a + Math.max(0, q.L), 0);
  if (!(length < Lmax * 1.5)) return { ok: false, reason: `${(length / 1000).toFixed(2)} km long (${p.lengthKm[0]}–${p.lengthKm[1]} km wanted)` };
  const dense = integrate(ps);
  const { pts, L, ds } = resampleClosed(dense, closed, LIMITS.step);
  if (L < Lmin || L > Lmax) return { ok: false, reason: `${(L / 1000).toFixed(2)} km long (${p.lengthKm[0]}–${p.lengthKm[1]} km wanted)` };
  if (els[0].L < LIMITS.startStraight - 1e-6) return { ok: false, reason: 'its start straight is too short' };
  const startZone = Math.min(els[0].L, 260);
  // centred on the origin, at fixed precision
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const q of pts) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const n = pts.length, X = new Float64Array(n), Z = new Float64Array(n), H = new Float64Array(n), B = new Float64Array(n), Kc = new Float64Array(n), S = new Float64Array(n);
  for (let i = 0; i < n; i++) { X[i] = fix(pts[i].x - cx); Z[i] = fix(pts[i].z - cz); Kc[i] = fix(pts[i].k, 1e6); S[i] = fix(pts[i].s); }
  // a figure of eight: its one crossing, where it is
  let crossing = null;
  if (sig === 'crossover') { const c = crossingOf(X, Z, n, ds, els, pts); if (!c.ok) return { ok: false, reason: c.reason }; crossing = c; }
  const why = selfClear(X, Z, S, L, closed, p.width, crossing, ds);
  if (why) return { ok: false, reason: why };
  // the signature's place (indices): its elements' points
  const sigEls = new Set(els.map((e, i) => e.signature ? i : -1).filter(i => i >= 0));
  let sigFrom = -1, sigTo = -1;
  pts.forEach((q, i) => { if (sigEls.has(q.el)) { if (sigFrom < 0) sigFrom = i; sigTo = i; } });
  const crestEl = els.findIndex(e => e.crest);
  let crestAt = null;
  if (crestEl >= 0) { let a = -1, b = -1; pts.forEach((q, i) => { if (q.el === crestEl) { if (a < 0) a = i; b = i; } }); if (a >= 0 && (b - a) * ds >= 330) crestAt = ((a + b) / 2) * ds; }
  if (sig === 'big_crest' && crestAt == null) return { ok: false, reason: 'no straight long enough for its crest' };
  const E = elevation(r, p, pts, L, ds, closed, startZone, { crestAt, crossing });
  if (!E.h) return { ok: false, reason: E.reason };
  const bankZone = sig === 'banked_corner' && sigFrom >= 0 ? { from: sigFrom, to: sigTo } : null;
  const bank = banking(p, pts, ds, bankZone);
  for (let i = 0; i < n; i++) { H[i] = fix(E.h[i]); B[i] = fix(bank[i], 100); }
  // the bridge: the upper pass far enough over the lower
  let cross = null;
  if (crossing) {
    const rise = H[crossing.j] - H[crossing.i];
    if (rise < LIMITS.bridgeClear) return { ok: false, reason: `its bridge is only ${rise.toFixed(1)} m over the road below` };
    cross = { i: crossing.i, j: crossing.j, angle: fix(crossing.angle, 10), rise: fix(rise, 100), lower: crossing.i, upper: crossing.j };
  }
  const lim = p.crests ? LIMITS.crestGradeChange : LIMITS.maxGradeChange;
  const inZone = i => E.zones.some(z => i >= z.from && i <= z.to);
  let gmax = 0, cmax = 0, prev = null, bmax = 0, climb = 0, hlo = Infinity, hhi = -Infinity;
  for (let i = 1; i < (closed ? n + 1 : n); i++) {
    const dh = H[i % n] - H[i - 1], g = dh / ds;
    gmax = Math.max(gmax, Math.abs(g)); if (prev != null) cmax = Math.max(cmax, Math.abs(g - prev) / ds / (inZone(i % n) ? LIMITS.crestGradeChange : lim)); prev = g;
    if (dh > 0) climb += dh;
  }
  for (let i = 0; i < n; i++) { bmax = Math.max(bmax, Math.abs(B[i])); hlo = Math.min(hlo, H[i]); hhi = Math.max(hhi, H[i]); }
  const bankMax = Math.max(Math.min(p.banking, LIMITS.maxBanking), bankZone ? LIMITS.signatureBank : 0);
  if (gmax > LIMITS.maxGrade + 0.002) return { ok: false, reason: `a ${Math.round(gmax * 100)}% gradient` };
  if (cmax > 1.15) return { ok: false, reason: 'its gradient changes too suddenly' };
  if (bmax > bankMax + 0.01) return { ok: false, reason: 'too much banking' };
  const turns = els.filter(e => e.kind === 'turn');
  const straights = []; let run = 0;
  for (const e of els) { if (e.kind === 'straight') run += e.L; else { straights.push(run); run = 0; } }
  straights.push(closed ? run + (straights[0] ?? 0) : run);
  const stats = {
    length: Math.round(L), corners: turns.filter(e => Math.abs(e.th) >= 15 * DEG).length, groups: new Set(turns.map(e => e.group)).size,
    tightest: Math.round(Math.min(...turns.map(e => e.R)) * 10) / 10, longestStraight: Math.round(Math.max(...straights)),
    elevationRange: Math.round((hhi - hlo) * 10) / 10, climb: Math.round(climb), maxGrade: Math.round(gmax * 1000) / 10, maxBanking: Math.round(bmax * 10) / 10,
    rise: closed ? 0 : Math.round(H[n - 1] - H[0]), hairpins: turns.filter(e => Math.abs(e.th) >= 150 * DEG).length, signature: sig,
  };
  const elements = els.map(e => e.kind === 'straight' ? { kind: 'straight', L: fix(e.L, 10), ...(e.back ? { back: true } : {}), ...(e.crest ? { crest: true } : {}) } : { kind: 'turn', deg: fix(e.th / DEG, 10), R: fix(e.R, 10), Lt: fix(e.Lt, 10), La: fix(e.La, 10), ...(e.signature ? { signature: e.signature } : {}) });
  const track = { version: VERSION, closed, length: fix(L), step: fix(ds, 1e6), n, x: X, z: Z, h: H, bank: B, k: Kc, width: p.width, start: { s: 0, straight: fix(els[0].L, 10) }, elements, stats,
    signature: sig === 'none' ? null : { kind: sig, from: sigFrom >= 0 ? sigFrom : null, to: sigTo >= 0 ? sigTo : null, ...(crestAt != null ? { at: Math.round(crestAt / ds) } : {}), ...(cross ? { at: cross.j } : {}) },
    zones: E.zones, bankMax, ...(cross ? { crossing: cross } : {}) };
  // room for run-off and the pits
  const room = roomChecks(track, p);
  if (!room.ok) return { ok: false, reason: room.reason };
  if (room.pit) track.pit = room.pit;
  return { ok: true, track };
}
