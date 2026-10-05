// A generated track checked again from what came out (Phase 5 Step 1's tests): not the generator's own
// checks, but the same rules measured afresh on its centreline, heights and banking — so a bug in the
// generator that let a bad track through would show here.
//
//   checkTrack(gen.track, params, LIMITS) → [problem, …] (empty: it passes)
//     closes (a circuit: no gap, no kink, the same height), the tightest corner, how fast the curvature
//     changes, clearance from itself, its length, gradients, gradient changes, banking and how fast it twists

export function checkTrack(t, p, L) {
  const out = [], n = t.n, closed = t.closed, X = t.x, Z = t.z, H = t.h, ds = t.length / (closed ? n : n - 1);
  const idx = i => closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
  // closing: the last point a step from the first, heading on round with no kink
  if (closed) {
    const gap = Math.hypot(X[0] - X[n - 1], Z[0] - Z[n - 1]);
    if (Math.abs(gap - ds) > 0.05) out.push(`the ends are ${gap.toFixed(3)} m apart (a step is ${ds.toFixed(3)} m)`);
  }
  const head = i => Math.atan2(Z[idx(i + 1)] - Z[idx(i)], X[idx(i + 1)] - X[idx(i)]);
  const turn = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  // curvature over ±3 steps (12 m: the 2 m points' rounding smoothed out)
  const span = 3, kap = [];
  for (let i = 0; i < n; i++) {
    if (!closed && (i < span || i >= n - span - 1)) { kap.push(0); continue; }
    kap.push(turn(head(i - span), head(i + span - 1)) / (2 * span * ds));
  }
  let kmax = 0, rate = 0;
  for (let i = 0; i < n; i++) {
    kmax = Math.max(kmax, Math.abs(kap[i]));
    if (closed || (i > span && i < n - span - 2)) rate = Math.max(rate, Math.abs(kap[idx(i + 1)] - kap[i]) / ds);
  }
  if (1 / kmax < L.minRadius * 0.92) out.push(`a corner of ${(1 / kmax).toFixed(1)} m radius (at least ${L.minRadius} m)`);
  // (the discrete estimate is noisy: a third over the rate's limit before it counts)
  if (rate > L.maxCurvatureRate * 1.35) out.push(`the curvature changes at ${rate.toFixed(5)} /m² (at most ${L.maxCurvatureRate})`);
  if (closed) { const k = Math.abs(turn(head(n - 2), head(n - 1)) - turn(head(n - 1), head(0))); if (k > 0.01) out.push(`a kink of ${(k * 180 / Math.PI).toFixed(2)}° where the ends meet`); }
  // clearance: never nearer itself than the road and its run-off (a hairpin's legs, nearer by the way along)
  const D = t.width + 2 * L.clearance, cell = D, grid = new Map(), key = (a, b) => `${a},${b}`;
  for (let i = 0; i < n; i++) { const k = key(Math.floor(X[i] / cell), Math.floor(Z[i] / cell)); (grid.get(k) ?? grid.set(k, []).get(k)).push(i); }
  clear: for (let i = 0; i < n; i++) {
    const ci = Math.floor(X[i] / cell), cj = Math.floor(Z[i] / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const j of grid.get(key(ci + a, cj + b)) ?? []) {
      if (j <= i) continue;
      let along = (j - i) * ds; if (closed) along = Math.min(along, t.length - along);
      const need = Math.min(D, L.legRatio * along) - 2 * ds, d = Math.hypot(X[i] - X[j], Z[i] - Z[j]);
      if (need > 0 && d < need) { out.push(`it comes within ${d.toFixed(1)} m of itself at ${Math.round(i * ds)} m / ${Math.round(j * ds)} m`); break clear; }
    }
  }
  // length
  if (t.length < p.lengthKm[0] * 1000 - 1 || t.length > p.lengthKm[1] * 1000 + 1) out.push(`${(t.length / 1000).toFixed(3)} km long (${p.lengthKm.join('–')} wanted)`);
  // gradients, their changes, and a circuit back at its own height
  const glim = p.crests ? L.crestGradeChange : L.maxGradeChange;
  let g = 0, gc = 0, prev = null;
  for (let i = 1; i < (closed ? n + 1 : n); i++) { const gi = (H[idx(i)] - H[i - 1]) / ds; g = Math.max(g, Math.abs(gi)); if (prev != null) gc = Math.max(gc, Math.abs(gi - prev) / ds); prev = gi; }
  if (g > L.maxGrade + 0.003) out.push(`a ${(g * 100).toFixed(1)}% gradient (at most ${L.maxGrade * 100}%)`);
  if (gc > glim * 1.2) out.push(`its gradient changes at ${gc.toFixed(5)} /m (at most ${glim})`);
  let b = 0; for (let i = 0; i < n; i++) b = Math.max(b, Math.abs(t.bank[i]));
  if (b > Math.min(p.banking, L.maxBanking) + 0.011) out.push(`${b.toFixed(2)}° of banking (at most ${Math.min(p.banking, L.maxBanking)}°)`);
  if (!p.banking && b > 0) out.push('banking where none was asked for');
  // the road never twisting faster than its edge's limit against the middle
  if (L.bankEdgeGrade) {
    let tw = 0;
    for (let i = 1; i < (closed ? n + 1 : n); i++) { const j = idx(i), d = Math.hypot(t.x[j] - t.x[i - 1], t.z[j] - t.z[i - 1]) || ds; tw = Math.max(tw, Math.abs(Math.tan(t.bank[j] * Math.PI / 180) - Math.tan(t.bank[i - 1] * Math.PI / 180)) * t.width / 2 / d); }
    if (tw > L.bankEdgeGrade * 1.04 + 0.0101 * Math.PI / 180 * t.width / 2 / ds)   // (banking is kept to hundredths of a degree)
      out.push(`its banking twists the road's edge at ${(tw * 100).toFixed(2)}% (at most ${L.bankEdgeGrade * 100}%)`);
  }
  return out;
}
