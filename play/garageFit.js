// Fitting a garage to where it stands (play/garageBuilding.js): the road beside it as it really is — its edge, straight
// or curving, and its surface's height — and the ground round it. From those: how the garage leans (the road's slope),
// how high its floor sits (just above the highest ground under the forecourt, so none shows through), and its two
// driveways — each leaving the road's real edge running along it, on the road's own surface until it's off the road,
// then rising smoothly into the lane, never under the ground beside it. Pure: the road and ground come in as functions.
//
// All in the garage's frame (turned to its heading, not leaning): x to the right, z back (−z ahead), y from the road's
// height at the garage's place.
//
//   fitGarage({ road(x, z) → the road surface's height there or null off it, terrain(x, z) → the ground's or null, dims,
//     carve (the ground can be cut away under it — map/render/streamer.ts carve: then the floor stays at the road's
//     level and the driveways rise only to it; without, they're lifted over the ground) })
//   → { found (the road was), pitch, floorY, courtDepth (how far the forecourt's sides go down), edge(z) → { x, y },
//       driveways: [{ zs, word, rows: [{ t, a: [x, y, z], b: [x, y, z], ga, gb (the ground under a, b) }], grade, lift }], exits: { [-1 | 1]: { x, z, dx, dz } }, quality: { floorY, grade (the steepest
//       either driveway gets), lift (the most one's raised over its plain rise), pitch, found, cut (the most ground above
//       the surface: cut away), fill (the most surface above the ground: filled) } }
//   dims: { SIDE, LANE_HALF, LANE_END, COURT: { x0, x1, z0, z1 } (the building's frame), FAR, NEAR, STEPS }

const smooth01 = t => t * t * (3 - 2 * t);
const bezier = (P, t) => { const u = 1 - t; return [0, 1].map(i => u * u * u * P[0][i] + 3 * u * u * t * P[1][i] + 3 * u * t * t * P[2][i] + t * t * t * P[3][i]); };
const ABOVE_GROUND = 0.08;      // m: the forecourt and driveways at least this far over the ground (its drawn mesh is within 0.04)
const FLOOR_MAX = 3;            // m: the most the floor is raised over the road for high ground (past that, the ground wins)

export function fitGarage({ road, terrain = () => null, dims, carve = false }) {
  const { SIDE, LANE_HALF: L, LANE_END: LE, COURT, FAR: DIMS_FAR, NEAR: DIMS_NEAR, STEPS = 40 } = dims;

  // ---- the road's right edge, every metre along, followed outwards from the garage's place ----
  const ZR = Math.ceil(LE + DIMS_FAR + 12), X0 = -16, X1 = SIDE + COURT.x0 - 0.6, DX = 0.25;
  const runsAt = z => {
    const out = [];
    let x0 = null;
    for (let x = X0; x <= X1 + 1e-9; x += DX) {
      const on = road(x, z) != null;
      if (on && x0 == null) x0 = x;
      if (!on && x0 != null) { out.push([x0, x - DX]); x0 = null; }
    }
    if (x0 != null) out.push([x0, X1]);
    return out;
  };
  const nearest = (runs, x) => runs.reduce((best, r) => { const d = x >= r[0] && x <= r[1] ? 0 : Math.min(Math.abs(x - r[0]), Math.abs(x - r[1])); return !best || d < best.d ? { r, d } : best; }, null);
  // (the edge to a couple of cm: between the last point on the road and the first off it)
  const refine = (xin, z) => { if (xin >= X1) return X1; let xout = xin + DX; for (let k = 0; k < 6; k++) { const m = (xin + xout) / 2; if (road(m, z) != null) xin = m; else xout = m; } return xin; };
  const raw = new Map();      // z → { x, y, mid } (the edge, its height, the road's middle there)
  const first = nearest(runsAt(0), 0);
  if (first && first.d < 3) {
    const at0 = { x: refine(first.r[1], 0), mid: (first.r[0] + first.r[1]) / 2 };
    raw.set(0, at0);
    for (const dir of [-1, 1]) {
      let prev = first.r, prevEdge = at0.x;
      for (let i = 1; i <= ZR; i++) {
        const z = i * dir, c = nearest(runsAt(z), (prev[0] + prev[1]) / 2);
        if (!c || c.d > 2.5) continue;
        let x = refine(c.r[1], z);
        // (a side road or a car park joining: the edge jumps out — it carries on where it was going instead)
        if (x > prevEdge + 1.2) x = prevEdge;
        raw.set(z, { x, mid: (c.r[0] + Math.min(c.r[1], x)) / 2 });
        prev = [c.r[0], x]; prevEdge = x;
      }
    }
  }
  const found = raw.size >= 8;
  // every metre: filled in from the neighbours where it wasn't seen, then smoothed (a road's edge has no kinks)
  const zs = []; for (let z = -ZR; z <= ZR; z++) zs.push(z);
  const filled = key => {
    const known = zs.filter(z => raw.has(z));
    return zs.map(z => {
      if (!found) return key === 'x' ? 4.6 : 0;
      if (raw.has(z)) return raw.get(z)[key];
      const lo = known.filter(k => k < z).pop(), hi = known.find(k => k > z);
      if (lo == null) return raw.get(hi)[key];
      if (hi == null) return raw.get(lo)[key];
      return raw.get(lo)[key] + (raw.get(hi)[key] - raw.get(lo)[key]) * (z - lo) / (hi - lo);
    });
  };
  const soften = (v, w) => v.map((_, i) => { let s = 0, n = 0; for (let k = -w; k <= w; k++) { const j = Math.min(v.length - 1, Math.max(0, i + k)); s += v[j]; n++; } return s / n; });
  const ex = soften(filled('x'), 2), mids = filled('mid');
  const ey = soften(zs.map((z, i) => road(ex[i] - 0.15, z) ?? road(mids[i], z) ?? 0), 1);
  const lerpAt = (v, z) => { const f = Math.min(zs.length - 1.000001, Math.max(0, z + ZR)), i = Math.floor(f), t = f - i; return v[i] + (v[i + 1] - v[i]) * t; };
  const edge = z => ({ x: lerpAt(ex, z), y: lerpAt(ey, z) });

  // ---- the lean: the road's middle 14 m ahead and behind ----
  const midY = z => road(lerpAt(mids, z), z);
  const ahead = midY(-14), behind = midY(14);
  const pitch = ahead != null && behind != null ? Math.max(-0.3, Math.min(0.3, Math.atan2(ahead - behind, 28))) : 0;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  // (the building's frame — x from the lane's middle, y from its floor — into this one, leaning)
  const lean = (xb, yb, zb, floorY) => { const y = floorY + yb; return [SIDE + xb, y * cp - zb * sp, y * sp + zb * cp]; };

  // ---- the floor: where the ground's carved out for it, at the ground's middle height under it (cut and fill balanced),
  // from 0.3 m under the road's level to just over it (the driveways' climb to it stays gentle); else above the highest ground
  // under it ----
  let floorY = 0;
  if (carve) {
    const under = [];
    for (let xb = COURT.x0; xb <= COURT.x1 + 1e-9; xb += 1.5) for (let zb = COURT.z0; zb <= COURT.z1 + 1e-9; zb += 1.5) {
      const [x, y, z] = lean(xb, 0, zb, 0), t = terrain(x, z);
      if (t != null) under.push((t - y) / cp);
    }
    under.sort((a, b) => a - b);
    if (under.length) floorY = Math.max(-0.3, Math.min(0.05, under[Math.floor(under.length / 2)]));
  }
  else for (let xb = COURT.x0; xb <= COURT.x1 + 1e-9; xb += 1.5) for (let zb = COURT.z0; zb <= COURT.z1 + 1e-9; zb += 1.5) {
    const [x, , z] = lean(xb, 0, zb, 0), t = terrain(x, z);
    if (t == null) continue;
    floorY = Math.max(floorY, (t + ABOVE_GROUND + zb * sp) / cp - 0.04);
  }
  floorY = Math.min(FLOOR_MAX, floorY);

  // ---- the driveways: a few ways of laying them (leaving the road nearer or further along), the smoothest kept ----
  const layOut = (FAR, NEAR) => [[1, 'IN'], [-1, 'OUT']].map(([s, word]) => {
    const endA = lean(L, 0.06, s * LE, floorY), endB = lean(-L, 0.06, s * LE, floorY), zLE = endA[2];
    const at = z => [edge(z).x - 0.3, z];
    const zf = s * (LE + FAR), zn = s * (LE + NEAR);   // (FAR, NEAR: this layout's)
    // far edge: off the road furthest from the lane, sweeping into the lane's far side; near edge: rounding off the road
    // into its near side
    const far = [at(zf), at(zf - s * 6), [endA[0], zLE + s * 4], [endA[0], zLE]];
    const near = [at(zn), at(zn - s * 2.5), [endB[0], zLE + s * 3], [endB[0], zLE]];
    const A = [], Bv = [];
    for (let k = 0; k <= STEPS; k++) { const t = k / STEPS; A.push(bezier(far, t)); Bv.push(bezier(near, t)); }
    // heights along each edge: the road's own surface while on it, then a smooth rise from where it leaves to the
    // forecourt's level by where it reaches the forecourt, then just over the forecourt (flush with the lane) to the lane
    const inCourt = ([x, z]) => x >= SIDE + COURT.x0 - 1e-6 && Math.abs(z / cp) <= Math.max(-COURT.z0, COURT.z1);
    const courtTop = ([, z]) => (floorY + 0.06) * cp - (z / cp) * sp;
    const heights = (pts, endY) => {
      const onRoad = pts.map(([x, z]) => road(x, z));
      let d = onRoad.findIndex(y => y == null);
      if (d < 0) d = pts.length - 1;
      let c = pts.findIndex((p, k) => k >= d && inCourt(p));
      if (c < 0) c = pts.length - 1;
      // (the rise over the road's own slope — along it the road's still climbing or falling under it)
      const tp = Math.tan(pitch), lv = (y, z) => y + z * tp;
      const r0 = lv(d > 0 ? onRoad[d - 1] : (road(...at(pts[0][1])) ?? edge(pts[0][1]).y), pts[Math.max(0, d - 1)][1]), rc = lv(c === pts.length - 1 ? endY : courtTop(pts[c]), pts[c][1]);
      return pts.map((p, k) => k < d ? onRoad[k] : k < c ? r0 + (rc - r0) * smooth01((k - d + 1) / (c - d + 1)) - p[1] * tp : k === pts.length - 1 ? endY : courtTop(p));
    };
    const ya = heights(A, endA[1]), yb = heights(Bv, endB[1]);
    // above the ground beside it: what each row needs lifting by, spread smoothly (never at its ends, nor on the road)
    const need = pts => pts.map(() => 0);
    const la = need(A), lb = need(Bv);
    for (let k = 1; k < STEPS; k++) {
      let lift = 0;
      for (const u of [0, 0.25, 0.5, 0.75, 1]) {
        const x = A[k][0] + (Bv[k][0] - A[k][0]) * u, z = A[k][1] + (Bv[k][1] - A[k][1]) * u;
        if (road(x, z) != null) continue;
        const t = terrain(x, z);
        if (t != null) lift = Math.max(lift, t + ABOVE_GROUND - (ya[k] + (yb[k] - ya[k]) * u));
      }
      if (carve) continue;
      if (road(...A[k]) == null) la[k] = lift;
      if (road(...Bv[k]) == null) lb[k] = lift;
    }
    const spread = (req, pts) => {
      const free = pts.map(([x, z], k) => k > 0 && k < STEPS && road(x, z) == null), l = [...req];
      for (let it = 0; it < 60; it++) for (let k = 1; k < STEPS; k++) if (free[k]) l[k] = Math.max(req[k], (l[k - 1] + l[k + 1]) / 2);
      return l;
    };
    const fa = spread(la, A), fb = spread(lb, Bv);
    // (and the ground under each edge: how far down its side goes)
    const rows = A.map((p, k) => ({ t: k / STEPS, a: [p[0], ya[k] + fa[k], p[1]], b: [Bv[k][0], yb[k] + fb[k], Bv[k][1]], ga: terrain(p[0], p[1]), gb: terrain(Bv[k][0], Bv[k][1]) }));
    // (how steep it gets along either edge — over the road's own slope, which it follows — and how far it was lifted over
    // the ground)
    let grade = 0;
    const tp = Math.tan(pitch), level = p => p[1] + p[2] * tp;
    for (let k = 1; k <= STEPS; k++) for (const e of ['a', 'b']) { const p0 = rows[k - 1][e], p1 = rows[k][e], run = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]); if (run > 0.05) grade = Math.max(grade, Math.abs(level(p1) - level(p0)) / run); }
    return { zs: s, word, rows, grade, lift: Math.max(...fa, ...fb) };
  });
  let driveways = null, grade = Infinity, lift = 0;
  for (const [FAR, NEAR] of [[DIMS_FAR, DIMS_NEAR], [DIMS_FAR - 3, DIMS_NEAR - 1], [DIMS_FAR + 3, DIMS_NEAR + 1], [DIMS_FAR - 5, DIMS_NEAR - 1.5]]) {
    const d = layOut(FAR, NEAR), g = Math.max(...d.map(x => x.grade));
    if (g < grade - 0.005) { driveways = d; grade = g; lift = Math.max(...d.map(x => x.lift)); }
  }

  // ---- where you come out: on the road beside the way out, in its nearside lane, along it ----
  const exits = {};
  for (const side of [-1, 1]) {
    const s = side < 0 ? -1 : 1, z = s * (LE + DIMS_FAR + 4), e = edge(z), dx = (edge(z + s).x - edge(z - s).x), dz = 2 * s, n = Math.hypot(dx, dz);
    exits[side] = { x: e.x - 2.3, z, dx: dx / n, dz: dz / n };
  }
  // (how good a place it is — tools/place-garages.mjs keeps to good ones, the editor says when it isn't: how much ground
  // is cut away for it (the most it stands above the surface: a wall that high beside it) and filled under it (the
  // most the surface stands over the ground: a skirt that deep))
  let cut = 0, fill = 0;
  const against = (x, z, y) => { if (road(x, z) != null) return; const t = terrain(x, z); if (t == null) return; cut = Math.max(cut, t - y); fill = Math.max(fill, y - t); };
  for (let xb = COURT.x0; xb <= COURT.x1 + 1e-9; xb += 1.5) for (let zb = COURT.z0; zb <= COURT.z1 + 1e-9; zb += 1.5) { const [x, y, z] = lean(xb, 0.04, zb, floorY); against(x, z, y); }
  // (how deep the forecourt's sides go: to the lowest ground under it)
  const courtDepth = Math.max(1.5, Math.min(25, fill + 0.6));
  for (const d of driveways) for (const r of d.rows) for (const u of [0, 0.5, 1]) against(r.a[0] + (r.b[0] - r.a[0]) * u, r.a[2] + (r.b[2] - r.a[2]) * u, r.a[1] + (r.b[1] - r.a[1]) * u);
  const quality = { floorY, grade, lift, pitch, found, cut, fill };
  return { found, pitch, floorY, courtDepth, edge, driveways, exits, quality };
}
