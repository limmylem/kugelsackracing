// Map v5's sports grounds and pools (Step 6; MAP_README.md, 'Landmarks and grounds'): what OSM maps as
// leisure=pitch (by its sport and shape) and leisure=swimming_pool, painted on the ground — the lines a ground of
// that sport and size has (their layout the sport's own, placed on the pitch's shape: estimated), a court's or
// cricket pitch's surface, a pool's water and its edge. Flat on the ground (groundAt), a few centimetres up; drawn
// with the road markings (meshes.fields), nothing solid.
//
//   an oval (its footprint near enough an ellipse) for australian_football: the boundary line, the centre square
//   (50 m), the centre circles (3 m and 10 m across), the 50 m arcs and goal squares at each end; for cricket the
//   boundary and the pitch (20.12 × 3.05 m) and its creases (both: both)
//   a rectangle for soccer, rugby, hockey, gaelic, baseball's outfield: the outline, the halfway line, the centre
//   circle, the boxes at each end (to scale on a small field)
//   tennis, netball, basketball, multi (small rectangles): the court's surface and its lines
//
//   buildFields({ areas, groundAt, style, cfg, box }) → { mesh: { positions, colours, indices }, stats }
//   (areas: OSM's whose box meets `box` — each built whole by every block it reaches: the tiles cut it)

import earcut from 'earcut';

const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const ringArea = (r: number[][]) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a / 2; };
function hull(points: number[][]) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: number[][] = [], hi: number[][] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
// the smallest rectangle round a ring: middle, long axis, half-lengths [along, across]
function minRect(ring: number[][]) {
  const pts = hull(ring);
  let best: any = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 1e-6) continue;
    const ux = (b[0] - a[0]) / l, uz = (b[1] - a[1]) / l;
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const p of pts) { const s = p[0] * ux + p[1] * uz, t = -p[0] * uz + p[1] * ux; s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
    const area = (s1 - s0) * (t1 - t0);
    if (!best || area < best.area) best = { area, ux, uz, s: [(s0 + s1) / 2, (s1 - s0) / 2], t: [(t0 + t1) / 2, (t1 - t0) / 2] };
  }
  if (!best) return null;
  const { ux, uz, s, t } = best, c = [s[0] * ux - t[0] * uz, s[0] * uz + t[0] * ux];
  return t[1] > s[1] ? { c, u: [-uz, ux], half: [t[1], s[1]], area: best.area } : { c, u: [ux, uz], half: [s[1], t[1]], area: best.area };
}

export function buildFields({ areas, groundAt, style, cfg, box }: { areas: any[]; groundAt: (x: number, z: number) => number; style: any; cfg: any; box: number[] }) {
  const F = cfg.fields, S = style.fields, out = { positions: [] as number[], colours: [] as number[], indices: [] as number[] };
  const stats: Record<string, number> = { ovals: 0, rectangles: 0, courts: 0, cricketPitches: 0, pools: 0, plain: 0 };
  const cLine = hex(S.line), up = F.lift;
  const vtx = (x: number, z: number, c: number[], lift = up) => { out.positions.push(x, groundAt(x, z) + lift, z); out.colours.push(c[0], c[1], c[2], 255); return out.positions.length / 3 - 1; };
  // (faces up: anticlockwise seen from above — x east, z south)
  const tri = (a: number, b: number, c: number) => { const P = out.positions, ny = (P[b * 3 + 2] - P[a * 3 + 2]) * (P[c * 3] - P[a * 3]) - (P[b * 3] - P[a * 3]) * (P[c * 3 + 2] - P[a * 3 + 2]); if (ny < 0) out.indices.push(a, c, b); else out.indices.push(a, b, c); };
  // a line along points (open or closed), w m wide, each piece no longer than step m (it follows the ground)
  const line = (pts: number[][], closed = false, w = F.lineWidth, c = cLine) => {
    const P = closed ? [...pts, pts[0]] : pts;
    for (let k = 0; k + 1 < P.length; k++) {
      const [ax, az] = P[k], [bx, bz] = P[k + 1], L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-3) continue;
      const n = Math.max(1, Math.ceil(L / F.step)), nx = -(bz - az) / L * w / 2, nz = (bx - ax) / L * w / 2;
      for (let q = 0; q < n; q++) {
        const f0 = q / n, f1 = (q + 1) / n, x0 = ax + (bx - ax) * f0, z0 = az + (bz - az) * f0, x1 = ax + (bx - ax) * f1, z1 = az + (bz - az) * f1;
        const a = vtx(x0 + nx, z0 + nz, c), b = vtx(x1 + nx, z1 + nz, c), d = vtx(x1 - nx, z1 - nz, c), e = vtx(x0 - nx, z0 - nz, c);
        tri(a, b, d); tri(a, d, e);
      }
    }
  };
  // a filled polygon (a court's surface, a pool's water), its triangles no bigger than the ground's cells: split
  // along a grid of step m first, so it lies on the ground
  const fill = (ring: number[][], c: number[], lift = up * 0.5) => {
    const tris = earcut(ring.flat());
    for (let t = 0; t < tris.length; t += 3) {
      const A = ring[tris[t]], B = ring[tris[t + 1]], C = ring[tris[t + 2]], L = Math.max(Math.hypot(B[0] - A[0], B[1] - A[1]), Math.hypot(C[0] - B[0], C[1] - B[1]), Math.hypot(A[0] - C[0], A[1] - C[1]));
      const n = Math.max(1, Math.min(16, Math.ceil(L / F.step)));
      // (each triangle cut n ways along each side: n² small ones)
      const at = (i: number, j: number) => [A[0] + (B[0] - A[0]) * i / n + (C[0] - A[0]) * j / n, A[1] + (B[1] - A[1]) * i / n + (C[1] - A[1]) * j / n];
      const ids = new Map<string, number>(), id = (i: number, j: number) => { const k = `${i},${j}`; let v = ids.get(k); if (v === undefined) { const p = at(i, j); v = vtx(p[0], p[1], c, lift); ids.set(k, v); } return v; };
      for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) { tri(id(i, j), id(i + 1, j), id(i, j + 1)); if (i + j < n - 1) tri(id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)); }
    }
  };
  // a point on the pitch's frame: s along its long axis, t across, from its middle
  for (const a of areas) {
    const t = a.tags, ring0 = a.parts?.[0]?.[0];
    if (!ring0 || ring0.length < 4) continue;
    const ring = ring0.map((p: any) => [p.x, p.z]);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    if (x1 < box[0] || x0 > box[2] || z1 < box[1] || z0 > box[3]) continue;
    const A = Math.abs(ringArea(ring)), R = minRect(ring);
    if (!R || A < 20) continue;
    const { c: [cx, cz], u: [ux, uz], half: [L, W] } = R, at = (s: number, q: number) => [cx + ux * s - uz * q, cz + uz * s + ux * q];
    if (t.leisure === 'swimming_pool') {
      // a pool: its water, and its coping round it
      fill(ring, hex(S.pool), up);
      line(ring, true, F.coping, hex(S.coping));
      stats.pools++;
      continue;
    }
    const sports = String(t.sport ?? '').split(';').map(s => s.trim());
    const fillRatio = A / R.area, oval = Math.abs(fillRatio - Math.PI / 4) < F.ovalTolerance && L > F.ovalMin;
    const has = (...s: string[]) => s.some(x => sports.includes(x));
    if (oval && has('australian_football', 'cricket')) {
      // the boundary: the ellipse a little inside the footprint
      const bL = L - F.boundaryIn, bW = W - F.boundaryIn, ell = (k: number, n: number) => at(bL * Math.cos(k / n * 2 * Math.PI), bW * Math.sin(k / n * 2 * Math.PI));
      const N = Math.max(48, Math.ceil(2 * Math.PI * Math.sqrt((bL * bL + bW * bW) / 2) / F.step));
      line(Array.from({ length: N }, (_, k) => ell(k, N)), true);
      if (has('australian_football')) {
        // the centre square, the centre circles
        const h = Math.min(25, bW * 0.45);
        line([at(-h, -h), at(h, -h), at(h, h), at(-h, h)], true);
        for (const r of [1.5, 5]) line(Array.from({ length: 32 }, (_, k) => at(r * Math.cos(k / 32 * 2 * Math.PI), r * Math.sin(k / 32 * 2 * Math.PI))), true);
        // at each end: the goal square, and the 50 m arc round the goal, inside the boundary
        for (const sd of [-1, 1]) {
          const gx = sd * bL;
          line([at(gx, -3.2), at(gx - sd * 9, -3.2), at(gx - sd * 9, 3.2), at(gx, 3.2)]);
          const r = Math.min(50, bL * 0.6), arc: number[][] = [];
          for (let k = 0; k <= 60; k++) { const ang = Math.PI / 2 + (k / 60) * Math.PI, s = gx + sd * r * Math.cos(ang), q = r * Math.sin(ang); if ((s / bL) ** 2 + (q / bW) ** 2 <= 1) arc.push(at(s, q)); else if (arc.length) { line(arc.splice(0)); } }
          if (arc.length > 1) line(arc);
        }
      }
      if (has('cricket')) {
        // the pitch: its strip (worn, the colour of the soil) and its creases, along the long axis
        const pl = 10.06 + 1.22, pw = 1.52 + 0.6;
        fill([at(-pl, -pw), at(pl, -pw), at(pl, pw), at(-pl, pw)], hex(S.cricketPitch));
        for (const sd of [-1, 1]) { line([at(sd * 10.06, -1.32), at(sd * 10.06, 1.32)], false, 0.08); line([at(sd * 8.84, -pw), at(sd * 8.84, pw)], false, 0.08); }
        stats.cricketPitches++;
      }
      stats.ovals++;
      continue;
    }
    if (has('tennis', 'netball', 'basketball', 'multi', 'futsal', 'volleyball', 'badminton', 'four_square') && L < F.courtMax) {
      // a court: its surface and its outline, the centre line; tennis's service lines too
      const colour = has('tennis') ? S.courts.tennis : has('netball') ? S.courts.netball : has('basketball') ? S.courts.basketball : S.courts.default;
      fill([at(-L, -W), at(L, -W), at(L, W), at(-L, W)], hex(colour));
      const iL = Math.max(1, L - F.courtIn), iW = Math.max(1, W - F.courtIn);
      line([at(-iL, -iW), at(iL, -iW), at(iL, iW), at(-iL, iW)], true, 0.06);
      line([at(0, -iW), at(0, iW)], false, 0.06);
      if (has('tennis')) { const sv = Math.min(iL * 0.54, 6.4); for (const sd of [-1, 1]) line([at(sd * sv, -iW * 0.75), at(sd * sv, iW * 0.75)], false, 0.06); line([at(-sv, 0), at(sv, 0)], false, 0.06); }
      if (has('netball')) for (const sd of [-1, 1]) line([at(sd * iL / 3, -iW), at(sd * iL / 3, iW)], false, 0.06);
      stats.courts++;
      continue;
    }
    if (has('soccer', 'rugby_union', 'rugby_league', 'rugby', 'field_hockey', 'gaelic_games', 'american_football', 'lacrosse', 'touch') && !oval && fillRatio > 0.8) {
      // a rectangle: the outline, the halfway line, the centre circle, the boxes at each end (to the field's scale)
      const iL = L - F.rectIn, iW = W - F.rectIn, k = Math.min(1, iL / 52.5);
      line([at(-iL, -iW), at(iL, -iW), at(iL, iW), at(-iL, iW)], true);
      line([at(0, -iW), at(0, iW)]);
      line(Array.from({ length: 40 }, (_, q) => at(9.15 * k * Math.cos(q / 40 * 2 * Math.PI), 9.15 * k * Math.sin(q / 40 * 2 * Math.PI))), true);
      if (has('soccer')) for (const sd of [-1, 1]) {
        const bl = 16.5 * k, bw = Math.min(iW, 20.15 * k), gl = 5.5 * k, gw = Math.min(iW, 9.16 * k);
        line([at(sd * iL, -bw), at(sd * (iL - bl), -bw), at(sd * (iL - bl), bw), at(sd * iL, bw)]);
        line([at(sd * iL, -gw), at(sd * (iL - gl), -gw), at(sd * (iL - gl), gw), at(sd * iL, gw)]);
      } else for (const sd of [-1, 1]) line([at(sd * iL * 0.6, -iW), at(sd * iL * 0.6, iW)]);
      stats.rectangles++;
      continue;
    }
    stats.plain++;
  }
  return { mesh: out, stats };
}
