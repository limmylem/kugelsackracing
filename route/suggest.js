// Route suggestions (Phase 4 Step 5): a baked region's road graph scanned for good racing roads — twisty,
// few junctions, a good length — ranked by a score, each with the waypoints the route builder needs to
// follow it. Suggestions are only ever made into drafts for the author to review (the editor), never
// published. Pure.
//
//   suggestRoutes(N, { count, minKm, maxKm, seeds, rules }) → [{ score, km, features, waypoints: [{ lat, lon }],
//     line, roads: [names], why: [plain words] }]   (best first; no two sharing most of their roads)
//
// A walk starts on a road and keeps going the way a driver would — at each junction the road that turns
// least (the same road by name if it can) — until it's long enough, hits a dead end or comes back on
// itself; then it's scored: corners and how sharp they are, against junctions passed (and turns made at
// them: a city route), motorway, and a
// length that's about right. data/quests.json suggestions holds the weights.

import { DEFAULT_OPTIONS } from './network.js';
import { routeFeatures } from './stats.js';
import { withS } from './geometry.js';
import { buildRoute } from './build.js';

export const SUGGEST_DEFAULTS = {
  bestKm: 4, minKm: 1.5, maxKm: 8,
  weights: { corners: 0.35, sharpness: 0.6, hairpins: 0.15, junctions: 0.25, junctionTurns: 1.5, length: 1.2, motorway: 3, grade: 0.03 },
};

const headingAt = (sg, forward, atStart) => {
  const p = sg.points, n = p.length / 3;
  // (the way it leaves the node: from the end it starts at, a few metres in)
  const i0 = forward ? (atStart ? 0 : n - 2) : (atStart ? n - 1 : 1), i1 = forward ? (atStart ? 1 : n - 1) : (atStart ? n - 2 : 0);
  return Math.atan2(p[i1 * 3] - p[i0 * 3], p[i1 * 3 + 1] - p[i0 * 3 + 1]);
};
const turn = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return Math.abs(d); };

export function suggestRoutes(N, { count = 12, minKm, maxKm, seeds = 600, rules = {} } = {}) {
  const R = { ...SUGGEST_DEFAULTS, ...rules, weights: { ...SUGGEST_DEFAULTS.weights, ...(rules.weights ?? {}) } };
  minKm ??= R.minKm; maxKm ??= R.maxKm;
  const O = DEFAULT_OPTIONS, main = N.mainPart(O), ok = (sg, fw) => N.allowed(sg, fw, O) && sg.class !== 'service' && !sg.link;
  // seeds: the curviest stretches of road first (their turning per metre), then the longest
  const curv = sg => { const p = sg.points; let t = 0; for (let k = 6; k < p.length; k += 3) t += turn(Math.atan2(p[k - 3] - p[k - 6], p[k - 2] - p[k - 5]), Math.atan2(p[k] - p[k - 3], p[k + 1] - p[k - 2])); return t / Math.max(20, sg.length); };
  const pool = N.segs.filter(sg => sg.length > 30 && ok(sg, true) && (!main || (main[sg.from] && main[sg.to]))).map(sg => ({ sg, c: curv(sg) })).sort((a, b) => b.c - a.c).slice(0, seeds);
  const out = [];
  for (const { sg: seed } of pool) {
    // walk on from the seed's end, as a driver would
    const steps = [{ sg: seed, forward: true }], used = new Set([seed]);
    let length = seed.length, junctions = 0, junctionTurns = 0, node = seed.to, head = headingAt(seed, true, false);
    while (length < maxKm * 1000) {
      const nexts = (N.adj[node] ?? []).filter(e => !used.has(e.sg) && ok(e.sg, e.forward));
      if (!nexts.length) break;
      if (N.degree[node] > 2) junctions++;
      const last = steps.at(-1).sg;
      nexts.sort((a, b) => (turn(head, headingAt(a.sg, a.forward, true)) - (a.sg.name && a.sg.name === last.name ? 0.6 : 0)) - (turn(head, headingAt(b.sg, b.forward, true)) - (b.sg.name && b.sg.name === last.name ? 0.6 : 0)));
      const e = nexts[0], t = turn(head, headingAt(e.sg, e.forward, true));
      if (t > 2.4) break;           // (only a U-turn left: stop)
      if (length + e.sg.length > maxKm * 1150) break;           // (not far past the longest wanted)
      // (turning off at a junction: a city route, not a racing road)
      if (N.degree[node] > 2 && t > 0.6) junctionTurns++;
      steps.push({ sg: e.sg, forward: e.forward }); used.add(e.sg);
      length += e.sg.length; node = e.to; head = headingAt(e.sg, e.forward, false);
    }
    if (length < minKm * 1000) continue;
    // its line (x, z, h, w), its features and score
    const pts = [];
    for (const { sg, forward } of steps) {
      const p = sg.points, n = p.length / 3;
      for (let j = 0; j < n; j++) { const k = forward ? j : n - 1 - j; if (pts.length && j === 0) continue; pts.push({ x: p[k * 3], z: p[k * 3 + 1], h: p[k * 3 + 2], w: sg.width ?? 7 }); }
    }
    const line = withS(pts), F = routeFeatures(line, { junctions });
    if (!F) continue;
    const W = R.weights, km = F.km, motor = steps.some(s => s.sg.class === 'motorway' || s.sg.class === 'trunk') ? 1 : 0;
    const score = W.corners * Math.min(F.cornersPerKm, 12) + W.sharpness * Math.min(F.sharpnessPerKm, 10) + W.hairpins * Math.min(F.hairpins, 12)
      - W.junctions * Math.min(F.junctionsPerKm ?? 0, 20) - W.junctionTurns * Math.min(junctionTurns / km, 10) - W.length * Math.abs(Math.log(km / R.bestKm)) - W.motorway * motor + W.grade * Math.min(F.maxGrade, 15);
    const roads = [...new Set(steps.map(s => s.sg.name).filter(Boolean))];
    const why = [`${km.toFixed(1)} km`, `${F.cornersPerKm.toFixed(1)} corners a km`, F.hairpins ? `${F.hairpins} hairpins` : null, `${(F.junctionsPerKm ?? 0).toFixed(1)} junctions a km`, motor ? 'motorway' : null].filter(Boolean);
    out.push({ score: Math.round(score * 100) / 100, km, features: F, line, segs: new Set(steps.map(s => s.sg)), roads, why });
  }
  // best first, none sharing most of its roads with a better one
  out.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const s of out) {
    if (picked.some(p => { let shared = 0; for (const g of s.segs) if (p.segs.has(g)) shared++; return shared / s.segs.size > 0.4; })) continue;
    picked.push(s);
    if (picked.length >= count) break;
  }
  // the waypoints the builder follows it by: the ends, and every ~600 m between — closer (300, 150 m) where
  // the builder would cut a corner of it (a shorter way between two of them), until it drives the same road
  const waypointsOf = (line, every) => {
    const L = line.at(-1).s, wps = [];
    for (let d = 0; d <= L; d += every) wps.push(line.find(p => p.s >= d) ?? line.at(-1));
    if (wps.at(-1) !== line.at(-1)) wps.push(line.at(-1));
    return wps.map(p => { const [lat, lon] = N.P.toLatLon(p.x, p.z); return { lat: Math.round(lat * 1e7) / 1e7, lon: Math.round(lon * 1e7) / 1e7 }; });
  };
  return picked.map(({ segs, ...s }) => {
    let waypoints = null;
    for (const every of [600, 300, 150]) {
      waypoints = waypointsOf(s.line, every);
      const b = buildRoute(N, { kind: 'p2p', waypoints, options: {} });
      if (Math.abs(b.length - s.line.at(-1).s) <= 0.02 * s.line.at(-1).s) break;
    }
    return { ...s, waypoints };
  });
}
