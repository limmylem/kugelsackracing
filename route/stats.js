// A route's numbers, pure: its length, how many turns and the sharpest, the climbing and descending, the
// roads it uses (in order) and an estimate of the time a starter car takes: the fastest it can go through
// each corner (grip), braking for the corners ahead and accelerating out of them, up to its top speed.
//
//   routeStats(line, { loop, segments, car }) → { length, turns, sharpest, climb, descent, maxGrade, minAlt,
//                                                  maxAlt, estimatedTime, roads }

import { radiusAt, at } from './geometry.js';

// the starter car, roughly (a small hatchback on road tyres): top speed, grip, acceleration, braking (m/s, m/s²)
export const STARTER_CAR = { vmax: 46, grip: 8.0, accel: 2.6, brake: 7.5 };

const heading = (line, k) => { const a = line[Math.max(0, k - 1)], b = line[Math.min(line.length - 1, k + 1)]; return Math.atan2(b.x - a.x, b.z - a.z); };
const turnBetween = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

// the corners: runs of points tighter than 120 m radius that turn at least 30° in all
export function corners(line, loop = false) {
  const out = [], n = line.length;
  if (n < 3) return out;
  const r = line.map(p => radiusAt(line, p.s, 12, loop));
  let k = 0;
  while (k < n) {
    if (r[k] >= 120) { k++; continue; }
    const k0 = k;
    let tight = r[k], kt = k;
    while (k < n && r[k] < 120) { if (r[k] < tight) { tight = r[k]; kt = k; } k++; }
    const angle = turnBetween(heading(line, Math.max(0, k0 - 3)), heading(line, Math.min(n - 1, k + 2)));
    if (Math.abs(angle) * 180 / Math.PI >= 30) out.push({ s: line[kt].s, from: line[k0].s, to: line[Math.min(n - 1, k)].s, radius: tight, angle: angle * 180 / Math.PI, way: angle > 0 ? 'left' : 'right' });
  }
  return out;
}

// the fastest the car can take the line: corner speeds, then braking back from each and accelerating out
export function speedProfile(line, car = STARTER_CAR, loop = false) {
  const n = line.length, v = new Float64Array(n);
  for (let k = 0; k < n; k++) v[k] = Math.min(car.vmax, Math.sqrt(car.grip * radiusAt(line, line[k].s, 12, loop)));
  // (a standing start)
  if (!loop) v[0] = 0;
  const passes = loop ? 2 : 1;
  for (let p = 0; p < passes; p++) for (let k = 1; k < n; k++) { const ds = line[k].s - line[k - 1].s; v[k] = Math.min(v[k], Math.sqrt(v[k - 1] ** 2 + 2 * car.accel * ds)); }
  for (let p = 0; p < passes; p++) for (let k = n - 2; k >= 0; k--) { const ds = line[k + 1].s - line[k].s; v[k] = Math.min(v[k], Math.sqrt(v[k + 1] ** 2 + 2 * car.brake * ds)); }
  return v;
}

export function estimateTime(line, car = STARTER_CAR, loop = false) {
  const v = speedProfile(line, car, loop);
  let t = 0;
  for (let k = 1; k < line.length; k++) t += (line[k].s - line[k - 1].s) / Math.max(1, (v[k] + v[k - 1]) / 2);
  return t;
}

export function routeStats(line, { loop = false, segments = [], car = STARTER_CAR } = {}) {
  if (line.length < 2) return { length: 0, turns: 0, sharpest: null, climb: 0, descent: 0, maxGrade: 0, minAlt: 0, maxAlt: 0, estimatedTime: 0, roads: [] };
  const cs = corners(line, loop);
  let climb = 0, descent = 0, maxGrade = 0, minAlt = Infinity, maxAlt = -Infinity;
  for (let k = 0; k < line.length; k++) {
    const h = line[k].h;
    minAlt = Math.min(minAlt, h); maxAlt = Math.max(maxAlt, h);
    if (k) { const dh = h - line[k - 1].h; if (dh > 0) climb += dh; else descent -= dh; }
  }
  // (grade over 20 m, the road's own slope rather than the terrain's noise)
  const L = line.at(-1).s;
  for (let s = 0; s + 20 <= L; s += 10) maxGrade = Math.max(maxGrade, Math.abs(at(line, s + 20).h - at(line, s).h) / 20);
  const roads = [];
  for (const sg of segments) { const name = sg.name ?? null; if (name && roads.at(-1) !== name) roads.push(name); }
  const sharp = cs.reduce((m, c) => !m || c.radius < m.radius ? c : m, null);
  const r1 = x => Math.round(x * 10) / 10;
  return {
    length: Math.round(L), turns: cs.length,
    sharpest: sharp ? { s: Math.round(sharp.s), radius: r1(sharp.radius), angle: Math.round(sharp.angle), way: sharp.way } : null,
    climb: Math.round(climb), descent: Math.round(descent), maxGrade: r1(maxGrade * 100), minAlt: Math.round(minAlt), maxAlt: Math.round(maxAlt),
    estimatedTime: r1(estimateTime(line, car, loop)), roads,
  };
}
