// A generated track's quality score (Phase 5 Step 4): 0–100 from what's measured on it, each part 0–1,
// weighted by data/tracks.json quality.weights. Pure and deterministic (the same track, the same score
// everywhere: the day's and week's tracks are picked by it), from the layout and its dressing plan
// (track/dress.js: its corners, the race car's speed all the way round, the run-off) — except the AI
// races' closeness, which needs the physics and is only part of the score when one has been raced
// (the test page, the variety report, the tests: `ai`).
//
//   qualityOf(gen, plan, cfg, { ai }) → { score, gate, parts: { variety, flow, overtaking, elevation, safety, ai? },
//                                         measures: {…}, notes: [plain words] }
//     score: every part there is (ai too, if given); gate: the deterministic parts only — what the day's,
//     week's and quick tracks must reach (quality.min)
//   aiCloseness(results, { lapLength }) → 0–1 from an NPC race's results (the field's spread, the
//     overtakes)
//   layoutSignature(gen) → a short description of the layout's shape   similarity(a, b) → 0–1

import { frameOf, freeSpace } from './gen/space.js';

const clamp01 = x => Math.max(0, Math.min(1, x));

export function qualityOf(gen, plan, cfg, { ai = null } = {}) {
  const Q = cfg.quality, T = gen.track, n = T.n, ds = T.length / (T.closed ? n : n - 1), closed = T.closed;
  const S = plan.speed, C = plan.corners, notes = [];
  const wrap = i => closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
  const M = {};

  // ---------- corner variety: slow, medium and fast corners in a mix, not the same corner again and again ----------
  {
    const V = Q.variety, cls = c => c.vApex < V.slowBelow ? 'slow' : c.vApex < V.fastFrom ? 'medium' : 'fast';
    const counts = { slow: 0, medium: 0, fast: 0 };
    for (const c of C) counts[cls(c)]++;
    const total = C.length || 1, sh = Object.values(counts).map(k => k / total);
    const entropy = -sh.reduce((a, p) => a + (p > 0 ? p * Math.log(p) : 0), 0) / Math.log(3);
    let same = 0;
    for (let q = 0; q < C.length; q++) {
      const a = C[q], b = C[(q + 1) % C.length];
      if (!closed && q === C.length - 1) break;
      if (a === b) continue;
      if (Math.abs(a.radius - b.radius) / Math.max(a.radius, b.radius) < V.sameRadius && Math.abs(Math.abs(a.turn) - Math.abs(b.turn)) < V.sameTurn && Math.sign(a.turn) === Math.sign(b.turn)) same++;
    }
    const repeat = same / Math.max(1, C.length - (closed ? 0 : 1));
    M.corners = { ...counts, total: C.length, repeat: Math.round(repeat * 100) / 100, kinds: [...new Set(C.map(c => c.kind))] };
    const few = clamp01((C.length - 2) / Math.max(1, V.enough - 2));
    M.varietyParts = { entropy: Math.round(entropy * 100) / 100, few: Math.round(few * 100) / 100 };
    var variety = clamp01((V.mix * entropy + (1 - V.mix) * (1 - repeat / V.repeatFull)) * few);
    if (counts.slow === 0) notes.push('no slow corners'); if (counts.fast === 0) notes.push('no fast corners');
    if (repeat > 0.3) notes.push('the same corner again and again');
  }

  // ---------- flow: no stop-start (heavy braking, a short burst, heavy braking again) ----------
  // the braking zones: the speed falling from a peak to a trough
  const zones = [];
  {
    const peaks = [];
    const lo = closed ? 0 : 1, hi = closed ? n : n - 1;
    for (let i = lo; i < hi; i++) {
      const a = S[wrap(i - 1)], b = S[i], c = S[wrap(i + 1)];
      if (b >= a && b > c) peaks.push(i);
    }
    for (const p of peaks) {
      let j = p, steps = 0;
      while (steps < n && S[wrap(j + 1)] <= S[wrap(j)] + 1e-6) { j++; steps++; if (!closed && j >= n - 1) break; }
      const drop = S[p] - S[wrap(j)];
      // (a sprint's end: the car stopping after the finish, not a corner)
      if (!closed && j * ds > T.length - 200) continue;
      if (drop >= Q.flow.brakeDrop) zones.push({ from: p, to: j, vTop: S[p], vMin: S[wrap(j)], drop });
    }
    zones.sort((a, b) => a.from - b.from);
    // the run up to each zone: from the last zone's trough to this zone's peak
    zones.forEach((z, k) => { const prev = zones[k - 1] ?? (closed ? zones.at(-1) : null); const from = prev ? prev.to - (k === 0 ? n : 0) : (closed ? z.from - n : 0); z.run = Math.max(0, (z.from - from) * ds); });
    const F = Q.flow, awkward = zones.filter(z => z.run < F.minRun && z.drop >= F.heavyDrop).length;
    M.flow = { brakingZones: zones.length, stopStart: awkward };
    var flow = clamp01(1 - awkward / Math.max(F.allow, zones.length * F.share));
    if (awkward >= 2) notes.push(`${awkward} stop-start sections`);
  }

  // ---------- overtaking: long straights into heavy braking ----------
  {
    const O = Q.overtaking, good = zones.filter(z => z.vTop >= O.minTop && z.drop >= O.minDrop && z.run >= O.minRun);
    M.overtaking = { chances: good.length, best: good.length ? Math.round(Math.max(...good.map(z => z.drop))) : 0 };
    const want = !closed ? O.wantSprint : T.length < O.shortTrack ? O.wantShort : O.want;
    var overtaking = clamp01(good.length / want);
    if (!good.length) notes.push('no real overtaking chance');
  }

  // ---------- elevation interest: crests, dips, corners up and down hill ----------
  {
    const E = Q.elevation, w = Math.max(1, Math.round(E.window / ds)), H = T.h;
    let crests = 0, dips = 0;
    for (let i = closed ? 0 : w; i < (closed ? n : n - w); i++) {
      let max = true, min = true, lo = Infinity, hi = -Infinity;
      for (let k = -w; k <= w; k++) { if (!k) continue; const v = H[wrap(i + k)]; if (v >= H[i]) max = false; if (v <= H[i]) min = false; lo = Math.min(lo, v); hi = Math.max(hi, v); }
      if (max && H[i] - lo >= E.prominence) crests++;
      if (min && hi - H[i] >= E.prominence) dips++;
    }
    let sloped = 0;
    for (const c of C) { const i = wrap(c.apex), g = Math.abs(H[wrap(i + 3)] - H[wrap(i - 3)]) / (6 * ds); if (g >= E.cornerGrade) sloped++; }
    const range = T.stats.elevationRange ?? 0;
    M.elevation = { crests, dips, slopedCorners: sloped, range };
    var elevation = clamp01(E.crests * clamp01((crests + dips) / E.wantCrests) + E.corners * clamp01(sloped / E.wantSloped) + E.range * clamp01(range / E.wantRange));
  }

  // ---------- safety: run-off for the speed; no spot where a fast car has nowhere to go ----------
  {
    const Sf = Q.safety, W = T.width / 2, RO = cfg.themes[plan.theme]?.dress?.runoff ?? {}, scale = RO.scale ?? 1, most = Math.min(Sf.capMetres, RO.max ?? Sf.capMetres);
    let sum = 0, wsum = 0, danger = [];
    for (const c of C) {
      const i = wrap(c.apex), outside = -c.side > 0 ? plan.runoff.L[i] : plan.runoff.R[i];        // (track/dress.js: its outside is −side)
      // (what the theme's run-off rule would give it, at most the theme's most: a street circuit's walls are close by design)
      const v = c.vEntry, ms = c.vApex / 3.6, need = Math.min(most, (3.7 + 0.0134 * ms * ms) * scale) * Sf.share;
      const have = outside - W, ratio = clamp01(have / need), wt = v * v;
      sum += ratio * wt; wsum += wt;
      if (c.vApex >= Sf.fastApex && ratio < Sf.dangerRatio) danger.push({ n: c.n, v: Math.round(c.vApex), have: Math.round(have), need: Math.round(need) });
    }
    // a fast stretch with another part of the track (or its barriers) just beyond its edge: a car off
    // there could reach it (a crossover's bridge aside — one passes over the other)
    const F = frameOf(T), free = freeSpace(T, F, { reach: 60 }), X = T.crossing;
    let run = 0;
    for (let i = 0; i < n + (closed ? 1 : 0); i++) {
      const j = i % n, nearBridge = X && [X.i, X.j].some(c => Math.min(Math.abs(j - c), n - Math.abs(j - c)) * ds < 90);
      const close = !nearBridge && S[j] >= Sf.closeKmh && Math.min(free.L[j], free.R[j]) - W < Sf.closeMetres;
      if (close) run++;
      if ((!close || i === n) && run * ds >= 20) { danger.push({ at: Math.round((j - run / 2) * ds), close: true }); }
      if (!close) run = 0;
    }
    M.safety = { runoffShare: wsum ? Math.round(sum / wsum * 100) / 100 : 1, dangerous: danger, scale };
    var safety = clamp01((wsum ? sum / wsum : 1) - danger.length * Sf.dangerCost);
    for (const d of danger.slice(0, 2)) notes.push(d.close ? `${d.at} m along: another part of the track just beyond a fast stretch` : `turn ${d.n}: ${d.have} m of run-off at ${d.v} km/h (${d.need} m wanted)`);
  }

  const parts = { variety, flow, overtaking, elevation, safety };
  if (ai != null) parts.ai = ai;
  const W = Q.weights, sumOf = keys => { let s = 0, w = 0; for (const k of keys) { s += W[k] * parts[k]; w += W[k]; } return w ? 100 * s / w : 0; };
  const r1 = x => Math.round(x * 10) / 10;
  const det = ['variety', 'flow', 'overtaking', 'elevation', 'safety'];
  return { score: r1(sumOf(Object.keys(parts))), gate: r1(sumOf(det)), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v * 1000) / 1000])), measures: M, notes };
}

// An NPC race's closeness, 0–1 (data/tracks.json quality.ai): the finishers' times bunched up (the spread
// from first to last against the race's length) and places changing hands
export function aiCloseness(results, { raceTime, overtakes = 0, cars = null }, cfg) {
  const A = cfg.quality.ai, done = results.filter(r => r.status === 'finished' && r.time != null).map(r => r.time).sort((a, b) => a - b);
  if (done.length < 2) return 0;
  const spread = (done.at(-1) - done[0]) / Math.max(1, done[0]);   // (first to last, as a share of the winner's time)
  const bunched = clamp01(1 - spread / A.fullSpread), passes = clamp01(overtakes / ((cars ?? done.length) * A.passesPerCar));
  return Math.round((A.bunched * bunched + (1 - A.bunched) * passes) * 1000) / 1000;
}

// ---------- the layout's shape, to tell tracks apart ----------
// its curvature along it (64 bins of its length, as a share of a lap), the turns' sizes in order, its length
export function layoutSignature(gen) {
  const T = gen.track, n = T.n, B = 64, bins = new Array(B).fill(0), ds = T.length / (T.closed ? n : n - 1);
  for (let i = 0; i < n; i++) bins[Math.min(B - 1, Math.floor(i / n * B))] += T.k[i] * ds;
  return { closed: T.closed, length: T.length, bins: bins.map(v => Math.round(v * 1000) / 1000) };
}
// how alike two layouts are, 0–1: the best match of their curvature (either way round, from any start: a
// circuit run backwards or started elsewhere is the same circuit), and their lengths
export function similarity(a, b) {
  if (a.closed !== b.closed) return 0;
  const B = a.bins.length, na = Math.hypot(...a.bins) || 1, nb = Math.hypot(...b.bins) || 1;
  let best = -1;
  for (const flip of [1, -1]) for (const rev of [false, true]) {
    const bb = rev ? b.bins.slice().reverse().map(v => v * flip) : b.bins.map(v => v * flip);
    for (let s = 0; s < (a.closed ? B : 1); s++) {
      let dot = 0;
      for (let i = 0; i < B; i++) dot += a.bins[i] * bb[(i + s) % B];
      best = Math.max(best, dot / (na * nb));
    }
  }
  const len = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  return Math.round(clamp01(best) * len * 1000) / 1000;
}
