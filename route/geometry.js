// Route geometry, pure: a route's centreline is a list of points { x, z, h, w } in a region's metric frame
// (x east, z south, h metres above sea level, w the road's width there) with s, the distance along it.
//
//   resample(points, step) → evenly spaced points (s added)
//   at(line, s) → { x, z, h, w, dx, dz } (dx, dz: the way along, unit)
//   project(line, x, z, { from, to, hint }) → { s, d (signed: + left), k } nearest point on the line
//   radiusAt(line, s, span) → the corner's radius there (Infinity on a straight)
//   encodeLine / decodeLine: lat/lon (1e-6°) and heights (cm) as compact strings (the stored route)

export const STEP = 4;                              // m between a route's centreline points

export function withS(points) {
  let s = 0;
  return points.map((p, i) => { if (i) s += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z); return { ...p, s }; });
}

// evenly spaced points along a polyline (its corners kept within half a step)
export function resample(points, step = STEP) {
  const src = withS(points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z) > 1e-3));
  if (src.length < 2) return src.map(p => ({ ...p, s: 0 }));
  const L = src.at(-1).s, n = Math.max(1, Math.round(L / step)), out = [];
  let k = 0;
  for (let i = 0; i <= n; i++) {
    const s = L * i / n;
    while (k < src.length - 2 && src[k + 1].s < s) k++;
    const a = src[k], b = src[k + 1], t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, h: a.h + (b.h - a.h) * t, w: t < 0.5 ? a.w : b.w, s });
  }
  return out;
}

// a light smoothing (corners eased over a few metres, the ends kept): the road's own shape, not a racing line
export function smooth(line, passes = 2) {
  let p = line;
  for (let n = 0; n < passes; n++) p = p.map((q, i) => i === 0 || i === p.length - 1 ? q : { ...q, x: (p[i - 1].x + 2 * q.x + p[i + 1].x) / 4, z: (p[i - 1].z + 2 * q.z + p[i + 1].z) / 4 });
  return withS(p);
}

// the point at s (clamped; for a loop pass loop: true to wrap)
export function at(line, s, loop = false) {
  const L = line.at(-1).s;
  if (loop && L > 0) s = ((s % L) + L) % L; else s = Math.max(0, Math.min(L, s));
  // (evenly spaced: straight to the piece)
  const step = L / (line.length - 1 || 1);
  let k = Math.min(line.length - 2, Math.max(0, Math.floor(s / step)));
  while (k > 0 && line[k].s > s) k--;
  while (k < line.length - 2 && line[k + 1].s < s) k++;
  const a = line[k], b = line[Math.min(k + 1, line.length - 1)], len = b.s - a.s || 1, t = Math.max(0, Math.min(1, (s - a.s) / len));
  const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len, m = Math.hypot(dx, dz) || 1;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, h: a.h + (b.h - a.h) * t, w: t < 0.5 ? a.w : b.w, dx: dx / m, dz: dz / m, s, k };
}

// the nearest point of the line to (x, z), looked for between from and to (indices; all by default)
export function project(line, x, z, { from = 0, to = line.length - 1 } = {}) {
  let best = null;
  for (let k = Math.max(0, from); k < Math.min(line.length - 1, to); k++) {
    const a = line[k], b = line[k + 1], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2)), px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(x - px, z - pz);
    if (!best || d < best.dist) best = { dist: d, k, t, s: a.s + (b.s - a.s) * t, x: px, z: pz, dx, dz };
  }
  if (!best) return null;
  const m = Math.hypot(best.dx, best.dz) || 1;
  // (signed: + to the left of the way along, z being south)
  best.d = (x - best.x) * best.dz / m - (z - best.z) * best.dx / m;
  best.w = line[best.k].w;
  return best;
}

// the radius of the corner at s: the circle through the points span m before and after
export function radiusAt(line, s, span = 12, loop = false) {
  const a = at(line, s - span, loop), b = at(line, s, loop), c = at(line, s + span, loop);
  const ab = Math.hypot(b.x - a.x, b.z - a.z), bc = Math.hypot(c.x - b.x, c.z - b.z), ca = Math.hypot(a.x - c.x, a.z - c.z);
  const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  return Math.abs(cross) < 1e-6 ? Infinity : (ab * bc * ca) / (2 * Math.abs(cross));
}
// which way it turns at s: +1 left, -1 right (z south)
export function turnAt(line, s, span = 12, loop = false) {
  const a = at(line, s - span, loop), b = at(line, s, loop), c = at(line, s + span, loop);
  return Math.sign((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x)) * -1;
}

// ---- compact storage (Google's polyline algorithm, at 1e-6°; heights in cm the same way) ----
function encodeInts(values) {
  let out = '', prev = 0;
  for (const v of values) {
    let d = v - prev; prev = v;
    d = d < 0 ? ~(d << 1) : d << 1;
    while (d >= 0x20) { out += String.fromCharCode((0x20 | (d & 0x1f)) + 63); d >>>= 5; }
    out += String.fromCharCode(d + 63);
  }
  return out;
}
function decodeInts(str) {
  const out = []; let i = 0, prev = 0;
  while (i < str.length) {
    let shift = 0, r = 0, b;
    do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    prev += r & 1 ? ~(r >> 1) : r >> 1;
    out.push(prev);
  }
  return out;
}
// points { lat, lon, h, w } → strings (each a delta-coded list: lat and lon at 1e-6°, heights in cm, widths in dm)
export function encodeLine(points) {
  return { lat: encodeInts(points.map(p => Math.round(p.lat * 1e6))), lon: encodeInts(points.map(p => Math.round(p.lon * 1e6))), h: encodeInts(points.map(p => Math.round(p.h * 100))), w: encodeInts(points.map(p => Math.round(p.w * 10))), n: points.length };
}
export function decodeLine({ lat, lon, h, w, n }) {
  const la = decodeInts(lat), lo = decodeInts(lon), hs = decodeInts(h), ws = decodeInts(w), out = [];
  for (let i = 0; i < n; i++) out.push({ lat: la[i] / 1e6, lon: lo[i] / 1e6, h: hs[i] / 100, w: ws[i] / 10 });
  return out;
}
