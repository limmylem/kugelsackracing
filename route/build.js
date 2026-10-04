// A route built from its waypoints: each leg the shortest way by road between them (route/network.js), a
// locked road driven end to end, an off-road leg a straight line (only if the route allows it), a loop
// closed back to its start. Gives the centreline the game drives (resampled every 4 m, lightly smoothed,
// the road's width at each point), the OSM road segments used (their ids, so a change to the map can be
// found later), the junctions it passes and any U-turns at waypoints. Pure.
//
//   buildRoute(N, { kind: 'p2p' | 'loop', waypoints: [{ lat, lon, lock?, offRoad? }], options })
//     → { ok, line, length, legs, segments, nodes, uturns, problems }

import { DEFAULT_OPTIONS } from './network.js';
import { resample, smooth, project } from './geometry.js';

export function routeOptions(o) { return { ...DEFAULT_OPTIONS, ...(o ?? {}) }; }

// where each waypoint is on the roads (a locked road: its two ends, in the way it's to be driven)
function stopsOf(N, spec, o) {
  const stops = [], problems = [];
  spec.waypoints.forEach((w, i) => {
    const [x, z] = N.P.toXZ(w.lat, w.lon);
    if (w.lock) {
      const sg = N.byKey.get(w.lock.key);
      if (!sg) { problems.push({ level: 'error', field: `waypoints.${i}`, message: `Waypoint ${i + 1} locks a road that no longer exists in the OSM data.` }); stops.push({ i, x, z, broken: true }); return; }
      const dir = w.lock.dir === -1 ? -1 : 1, near = 0.5, L = sg.length;
      if (!N.allowed(sg, dir > 0, o)) problems.push({ level: 'error', field: `waypoints.${i}`, message: `Waypoint ${i + 1} locks ${sg.name ?? 'a road'} the wrong way down a one-way street.` });
      stops.push({ i, seg: sg, s: dir > 0 ? Math.min(near, L / 2) : Math.max(L - near, L / 2), x, z, lock: true });
      stops.push({ i, seg: sg, s: dir > 0 ? Math.max(L - near, L / 2) : Math.min(near, L / 2), x, z, lock: true, forced: true });
      return;
    }
    const cands = w.offRoad ? [N.nearest(x, z, o, 150)].filter(Boolean) : N.candidates(x, z, o, 150);
    const at = cands[0];
    if (!at && !w.offRoad) { problems.push({ level: 'error', field: `waypoints.${i}`, message: `Waypoint ${i + 1} isn't near a road this route may use.` }); stops.push({ i, x, z, broken: true }); return; }
    const stop = c => ({ i, seg: c?.seg ?? null, s: c?.s ?? 0, x: w.offRoad || !c ? x : c.x, z: w.offRoad || !c ? z : c.z, h: c?.h ?? null, offRoad: !!w.offRoad, d: c?.d ?? null });
    stops.push({ ...stop(at), alts: w.offRoad ? null : cands.map(stop) });
  });
  return { stops, problems };
}

// a piece of a segment as points (s0 → s1, either way)
function piecePoints(N, { seg, s0, s1 }) {
  const out = [N.pointOn(seg, s0)], c = seg.cum, p = seg.points;
  if (s1 >= s0) { for (let k = 0; k < c.length; k++) if (c[k] > s0 && c[k] < s1) out.push({ x: p[k * 3], z: p[k * 3 + 1], h: p[k * 3 + 2] }); }
  else { for (let k = c.length - 1; k >= 0; k--) if (c[k] < s0 && c[k] > s1) out.push({ x: p[k * 3], z: p[k * 3 + 1], h: p[k * 3 + 2] }); }
  out.push(N.pointOn(seg, s1));
  return out.map(q => ({ x: q.x, z: q.z, h: q.h, w: seg.width ?? 7 }));
}

// which road each waypoint means, where there's a choice (the two carriageways of a dual carriageway, a
// road beside another): the choice that makes the shortest route without turning back on itself
const UTURN = 3000, CLICK = 20;          // (m of route: a U-turn; a metre further from where the waypoint was put)
// a leg between two places on the roads, remembered (an edit to a long route re-routes only what changed)
const optKey = o => `${+!!o.reverseOneway}${+!!o.motorways}${+!!o.unpaved}${+!!o.tunnels}`;
function legPath(N, a, b, o) {
  const cache = N.legCache ??= new Map(), key = `${a.seg.id}:${a.s.toFixed(2)}>${b.seg.id}:${b.s.toFixed(2)}|${optKey(o)}`;
  let r = cache.get(key);
  if (r) { cache.delete(key); cache.set(key, r); return r; }
  r = N.path(a, b, o);
  cache.set(key, r);
  if (cache.size > 4000) cache.delete(cache.keys().next().value);
  return r;
}

function choose(N, stops, loop, o) {
  if (stops.some(s => s.broken) || stops.length < 2) return stops;
  const order = loop ? [...stops.keys(), 0] : [...stops.keys()];
  const opts = k => stops[k].alts?.length ? stops[k].alts : [stops[k]];
  const cache = new Map();
  const leg = (ka, ia, kb, ib) => {
    const key = `${ka}.${ia}>${kb}.${ib}`;
    if (cache.has(key)) return cache.get(key);
    const a = opts(ka)[ia], b = opts(kb)[ib];
    let r;
    if (b.offRoad) r = { length: Math.hypot(b.x - a.x, b.z - a.z), pieces: null };
    else if (stops[kb].forced) r = { length: Math.abs(b.s - a.s), pieces: [{ seg: b.seg, s0: a.s, s1: b.s }] };
    else if (!a.seg) r = { length: Infinity };
    else r = legPath(N, { seg: a.seg, s: a.s }, { seg: b.seg, s: b.s }, o);
    if (r.error) r = { length: Infinity };
    cache.set(key, r);
    return r;
  };
  const turnsBack = (inp, out) => { const p = inp?.pieces?.at(-1), q = out?.pieces?.[0]; return !!(p && q && p.seg === q.seg && Math.sign(p.s1 - p.s0) === -Math.sign(q.s1 - q.s0) && Math.abs(q.s1 - q.s0) > 1); };
  let best = null;
  for (let first = 0; first < opts(order[0]).length; first++) {
    // (a loop ends where it began: the same choice)
    let layer = opts(order[0]).map((c, i) => i === first ? { cost: CLICK * (c.d ?? 0), path: [i], last: null } : null);
    for (let n = 1; n < order.length; n++) {
      const ka = order[n - 1], kb = order[n], closing = loop && n === order.length - 1;
      layer = opts(kb).map((c, ib) => {
        if (closing && ib !== first) return null;
        let pick = null;
        layer.forEach((st, ia) => {
          if (!st) return;
          const r = leg(ka, ia, kb, ib), cost = st.cost + r.length + (turnsBack(st.last, r) ? UTURN : 0) + (closing ? 0 : CLICK * (c.d ?? 0));
          if (!pick || cost < pick.cost) pick = { cost, path: [...st.path, ib], last: r };
        });
        return pick;
      });
    }
    for (const st of layer) if (st && (!best || st.cost < best.cost)) best = st;
  }
  if (!best || !Number.isFinite(best.cost)) return stops;
  return stops.map((s, k) => s.alts?.length ? { ...s, ...s.alts[best.path[k]], alts: s.alts } : s);
}

export function buildRoute(N, spec) {
  const o = routeOptions(spec.options), loop = spec.kind === 'loop';
  const got = stopsOf(N, spec, o), problems = got.problems;
  const stops = choose(N, got.stops, loop, o);
  const legs = [], raw = [], segments = [], nodes = [], uturns = [];
  if (spec.waypoints.length < 2) return { ok: false, line: [], length: 0, legs, segments, nodes, uturns, problems: [...problems, { level: 'error', field: 'waypoints', message: 'A route needs at least two waypoints: click the map to add them.' }] };
  const order = loop ? [...stops, stops[0]] : stops;
  let along = 0;
  const addPoints = pts => { for (const q of pts) { if (raw.length) { const r = raw.at(-1), d = Math.hypot(q.x - r.x, q.z - r.z); if (d < 1e-3) continue; along += d; } raw.push({ ...q, sRaw: along }); } };
  for (let k = 0; k + 1 < order.length; k++) {
    const a = order[k], b = order[k + 1], label = `waypoint ${a.i + 1} and ${b.i + 1}`;
    if (a.broken || b.broken) { legs.push({ from: a.i, to: b.i, error: 'broken' }); continue; }
    // off-road: a straight line (the route must allow it)
    if (b.offRoad && !b.lock) {
      if (!o.offRoad) { problems.push({ level: 'error', field: `waypoints.${b.i}`, message: `The leg into waypoint ${b.i + 1} is off-road: allow off-road for this route, or put the waypoint on a road.` }); legs.push({ from: a.i, to: b.i, error: 'off-road' }); continue; }
      const ha = a.h ?? N.pointOn(a.seg, a.s).h, hb = b.h ?? ha;
      const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 4)), pts = [];
      for (let j = 0; j <= n; j++) pts.push({ x: a.x + (b.x - a.x) * j / n, z: a.z + (b.z - a.z) * j / n, h: ha + (hb - ha) * j / n, w: 6 });
      addPoints(pts); legs.push({ from: a.i, to: b.i, length: L, offRoad: true });
      continue;
    }
    const r = b.forced ? { pieces: [{ seg: b.seg, s0: a.s, s1: b.s }], length: Math.abs(b.s - a.s) } : legPath(N, { seg: a.seg, s: a.s }, { seg: b.seg, s: b.s }, o);
    if (r.error) { problems.push({ level: 'error', field: `waypoints.${b.i}`, message: `No road between ${label} that this route may use${o.motorways && o.unpaved && o.reverseOneway && o.tunnels ? '' : ' (check its road options)'}.` }); legs.push({ from: a.i, to: b.i, error: 'no road' }); continue; }
    // a U-turn at a: back the way it came
    const prevPiece = legs.at(-1)?.pieces?.at(-1), first = r.pieces[0];
    if (prevPiece && prevPiece.seg === first.seg && Math.sign(prevPiece.s1 - prevPiece.s0) === -Math.sign(first.s1 - first.s0) && Math.abs(first.s1 - first.s0) > 1) uturns.push(a.i);
    for (const p of r.pieces) {
      const forward = p.s1 >= p.s0;
      addPoints(piecePoints(N, p));
      segments.push({ key: N.keyOf(p.seg), way: p.seg.way, dir: forward ? 1 : -1, length: Math.round(p.seg.length * 10) / 10, covered: Math.round(Math.abs(p.s1 - p.s0) * 10) / 10, name: p.seg.name ?? null });
      // (a whole road: its end junction is passed)
      const endNode = forward ? (p.s1 >= p.seg.length - 1e-6 ? p.seg.to : null) : (p.s1 <= 1e-6 ? p.seg.from : null);
      if (endNode != null) nodes.push({ node: endNode, sRaw: along, degree: N.degree[endNode], x: N.nodes.x[endNode], z: N.nodes.z[endNode] });
    }
    legs.push({ from: a.i, to: b.i, length: r.length, pieces: r.pieces });
  }
  if (loop && legs.length && legs.at(-1)?.pieces && legs[0]?.pieces) {
    const last = legs.at(-1).pieces.at(-1), first = legs[0].pieces[0];
    if (last.seg === first.seg && Math.sign(last.s1 - last.s0) === -Math.sign(first.s1 - first.s0)) uturns.push(stops[0].i);
  }
  if (raw.length < 2) return { ok: false, line: [], length: 0, legs, segments, nodes, uturns, problems };
  const line = smooth(resample(raw), 1);
  // the junctions passed, on the finished line
  for (const nd of nodes) { const p = project(line, nd.x, nd.z, { from: Math.max(0, Math.floor(nd.sRaw / 4) - 30), to: Math.floor(nd.sRaw / 4) + 30 }); nd.s = p ? p.s : nd.sRaw; }
  return { ok: !problems.some(p => p.level === 'error'), line, length: line.at(-1).s, legs, segments, nodes, uturns, problems, loop };
}
