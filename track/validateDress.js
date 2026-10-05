// A dressed track checked again from what came out (Phase 5 Step 2), not trusting how it was made — the
// dressing's tests use it (tests/track-dress.mjs, tests/unit/trackDress.test.mjs), and it's shown to
// catch broken dressings:
//   - nothing stands inside the barriers of any part of the track (on the track, its kerbs or run-off):
//     every tree, rock, building, grandstand, tower, post and board is beyond the barrier line nearest it
//   - every grandstand's whole footprint is beyond the barrier, clear of the run-off
//   - the barriers have no gaps: each side's pieces end to end all round (a circuit's back to its start,
//     a sprint's two sides joined across its ends)
//   - kerbs are on the right side of their corner (the apex's inside, the entry's and exit's outside),
//     where the racing line goes (those put there because it does)
//   - the run-off never narrower than the kerb strip, never jagged along the track
//
//   checkDressing(track, plan, { runs }) → [problem, …] (none: all good)

export function checkDressing(T, P, { runs }) {
  const out = [], n = T.n, closed = T.closed, W = T.width / 2, ds = T.length / (closed ? n : n - 1);
  // the frame (ordinary maths: a check, not the dressing)
  const tx = new Float64Array(n), tz = new Float64Array(n);
  for (let i = 0; i < n; i++) { const a = closed ? (i - 1 + n) % n : Math.max(0, i - 1), b = closed ? (i + 1) % n : Math.min(n - 1, i + 1), dx = T.x[b] - T.x[a], dz = T.z[b] - T.z[a], m = Math.hypot(dx, dz) || 1; tx[i] = dx / m; tz[i] = dz / m; }
  const cell = 25, grid = new Map(), key = (a, b) => `${a},${b}`;
  for (let i = 0; i < n; i++) { const k = key(Math.floor(T.x[i] / cell), Math.floor(T.z[i] / cell)); (grid.get(k) ?? grid.set(k, []).get(k)).push(i); }
  const nearest = (x, z) => {
    let best = -1, bd = Infinity;
    // (searching ring by ring: after cells r round, everything within r cells' width has been seen)
    for (let r = 1; r <= 15 && (best < 0 || Math.sqrt(bd) > (r - 2) * cell); r += 2) {
      const a = Math.floor(x / cell), b = Math.floor(z / cell);
      for (let p = a - r; p <= a + r; p++) for (let q = b - r; q <= b + r; q++) for (const i of grid.get(key(p, q)) ?? []) { const d = (T.x[i] - x) ** 2 + (T.z[i] - z) ** 2; if (d < bd) { bd = d; best = i; } }
    }
    return best;
  };
  // how far a place is beyond the barrier there (− inside it); a sprint's ends: beyond its end barriers
  const beyond = (x, z) => {
    const i = nearest(x, z);
    if (i < 0) return Infinity;
    const dx = x - T.x[i], dz = z - T.z[i], u = dx * tz[i] - dz * tx[i], a = dx * tx[i] + dz * tz[i];
    if (!closed && ((i === 0 && a < -ds) || (i === n - 1 && a > ds))) return Math.max(Math.abs(a) - 1, Math.abs(u) - Math.max(P.runoff.L[i], P.runoff.R[i]));
    const A = u >= 0 ? P.runoff.L : P.runoff.R, j = closed ? (i + (a >= 0 ? 1 : n - 1)) % n : Math.min(n - 1, Math.max(0, i + (a >= 0 ? 1 : -1)));
    return Math.abs(u) - (A[i] + (A[j] - A[i]) * Math.min(1, Math.abs(a) / ds));
  };
  const rect = (o, along, deep) => { const ax = -o.fz, az = o.fx; return [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0, 0]].map(([u, w]) => [o.x + ax * along * u + o.fx * deep * w, o.z + az * along * u + o.fz * deep * w]); };
  // ---------- nothing inside the barriers ----------
  const NEED = { tree: 1.5, rock: 0.8, building: 0.5, grandstand: 1, tower: 0.5, marshal: 0.3, light: 0.3, board: 0.2, brakeboard: 0.2, cornersign: 0.2 };
  let inside = 0;
  const bad = [];
  for (const o of P.objects) {
    const need = NEED[o.k];
    if (need == null) continue;
    const pts = o.k === 'grandstand' ? rect(o, o.len, o.deep) : o.k === 'building' ? rect(o, o.w, o.d) : o.k === 'tower' ? rect(o, 4, 4) : o.k === 'board' ? rect(o, 6, 0) : [[o.x, o.z]];
    const worst = Math.min(...pts.map(([x, z]) => beyond(x, z)));
    if (worst < need) { inside++; if (bad.length < 3) bad.push(`${o.k} at ${o.x.toFixed(0)}, ${o.z.toFixed(0)} (${worst.toFixed(1)} m beyond the barrier, ${need} needed)`); }
  }
  if (inside) out.push(`${inside} things inside the barriers: ${bad.join('; ')}`);
  // ---------- the barriers: no gaps ----------
  const close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-3;
  const ends = r => [[r.pieces[0], r.pieces[1], r.pieces[2]], [r.pieces.at(-4), r.pieces.at(-3), r.pieces.at(-2)]];
  for (const side of [1, -1]) {
    const R = runs.filter(r => r.side === side && r.type !== 'pitwall');
    if (!R.length) { out.push(`no barrier on the ${side > 0 ? 'left' : 'right'}`); continue; }
    for (const r of R) for (let k = 7; k + 6 < r.pieces.length; k += 7) if (!close([r.pieces[k - 4], r.pieces[k - 3], r.pieces[k - 2]], [r.pieces[k], r.pieces[k + 1], r.pieces[k + 2]])) { out.push(`a gap in a ${r.type} barrier at ${r.pieces[k].toFixed(0)}, ${r.pieces[k + 2].toFixed(0)}`); break; }
    for (let q = 0; q + 1 < R.length; q++) if (!close(ends(R[q])[1], ends(R[q + 1])[0])) out.push(`a gap between the ${R[q].type} and ${R[q + 1].type} barriers at ${ends(R[q])[1][0].toFixed(0)}, ${ends(R[q])[1][2].toFixed(0)}`);
    if (closed && !close(ends(R.at(-1))[1], ends(R[0])[0])) out.push(`the ${side > 0 ? 'left' : 'right'} barrier doesn't close round the circuit`);
  }
  if (!closed) {
    const caps = runs.filter(r => r.side === 0), L = runs.filter(r => r.side === 1), R = runs.filter(r => r.side === -1);
    if (caps.length < 2) out.push('a sprint\'s ends not closed by barriers');
    else if (L.length && R.length) {
      const [c0, c1] = caps;
      if (!close(ends(c0)[0], ends(L[0])[0]) || !close(ends(c0)[1], ends(R[0])[0])) out.push('the start\'s end barrier doesn\'t join the sides\'');
      if (!close(ends(c1)[0], ends(L.at(-1))[1]) || !close(ends(c1)[1], ends(R.at(-1))[1])) out.push('the finish\'s end barrier doesn\'t join the sides\'');
    }
  }
  // ---------- kerbs on the right side, where the racing line goes ----------
  const byN = new Map(P.corners.map(c => [c.n, c]));
  let wrongSide = 0, offLine = 0;
  for (const k of P.kerbs) {
    const c = byN.get(k.corner);
    if (!c) continue;
    const want = k.role === 'apex' ? c.side : -c.side;
    if (k.side !== want) wrongSide++;
    const mid = (k.from + Math.floor(k.len / 2)) % n;
    if (k.type === 'flat' && k.by !== 'shape' && P.line[mid] * k.side <= 0) offLine++;
  }
  if (wrongSide) out.push(`${wrongSide} kerbs on the wrong side of their corner`);
  if (offLine) out.push(`${offLine} of ${P.kerbs.length} kerbs where the racing line doesn't go`);
  // ---------- the run-off: never narrower than the kerb strip, never jagged ----------
  for (const [name, A] of [['left', P.runoff.L], ['right', P.runoff.R]]) {
    let thin = 0, jag = 0;
    for (let i = 0; i < n; i++) {
      if (A[i] < W + 1.5) thin++;
      const j = closed ? (i + 1) % n : i + 1;
      if (j < n && Math.abs(A[j] - A[i]) > 0.36 * ds + 0.02 && !(P.pit && i >= P.pit.from - 1 && i <= P.pit.to)) jag++;
    }
    if (thin) out.push(`the ${name} run-off is narrower than the kerbs at ${thin} points`);
    if (jag) out.push(`the ${name} barrier jumps out or in suddenly at ${jag} points`);
  }
  return out;
}
