// Timing a run, pure: a gate (a line across the road: route/grid.js gateAt) is crossed when the car's
// path from one physics tick to the next cuts it, going the way of the route. Where along that tick it
// was cut gives the time between the two ticks — so a time doesn't depend on how often the screen is
// drawn, or even on the tick rate, beyond a straight line between ticks.
//
//   crossing(gate, a, b) → f in [0, 1] (where along a → b it crossed) | null       a, b: { x, z }
//   crossTime(gate, prev, cur) → the time it crossed | null                         prev, cur: { x, z, t }

export function crossing(g, a, b) {
  // (the route's way: only crossing forwards counts)
  const mx = b.x - a.x, mz = b.z - a.z;
  if (mx * g.dx + mz * g.dz <= 0) return null;
  const ex = g.x2 - g.x1, ez = g.z2 - g.z1, den = mx * ez - mz * ex;
  if (Math.abs(den) < 1e-12) return null;
  const wx = g.x1 - a.x, wz = g.z1 - a.z;
  const f = (wx * ez - wz * ex) / den, u = (wx * mz - wz * mx) / den;
  return f >= 0 && f <= 1 && u >= 0 && u <= 1 ? f : null;
}

export function crossTime(g, prev, cur) {
  const f = crossing(g, prev, cur);
  return f === null ? null : prev.t + (cur.t - prev.t) * f;
}

// (a time for people: 1:23.456)
export function fmtTime(t, digits = 3) {
  if (t == null || !Number.isFinite(t)) return '–';
  const neg = t < 0, a = Math.abs(t), m = Math.floor(a / 60), s = a - m * 60;
  return `${neg ? '−' : ''}${m}:${s.toFixed(digits).padStart(digits + 3, '0')}`;
}
export function fmtDelta(d) { return d == null ? '' : `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(3)}`; }
