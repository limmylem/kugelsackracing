// A route as stored (the `route` of a content item of kind 'route') and as compiled for the editor and the
// game. Pure.
//
// Stored:
//   { kind: 'p2p' | 'loop', region, waypoints: [{ lat, lon, lock?, offRoad? }], options,
//     grid: { count, startS?, adjust: { [slot]: { s, d } } },
//     checkpointMode: 'auto' | 'manual', spacing, checkpoints: [{ id, s, lat, lon, width?, required, timeExtension, auto }],
//     guides: { arrows, signs, gates, arch }, roads: 'closed' | 'open', corridor: { margin },
//     path: encoded centreline (lat/lon/alt/width), length, stats, referenceTime,
//     roadData: { region, version, osmDate, segments: [{ key, length, name }] }, review: { needed, segments } }
//
//   compileRoute(N, route) → { built, line, loop, length, grid, checkpoints, gates, shortcuts, stats, roadCheck, problems }
//   bakeRoute(N, route, compiled?) → the route with its path, road data, checkpoints and stats brought up to date
//   lineOf(route, P) → the stored centreline in the region's frame (to drive it without the road graph)
//   reviewRoute(N, route) → the route marked as needing review if the roads it was made on have changed

import { buildRoute, routeOptions } from './build.js';
import { encodeLine, decodeLine, withS } from './geometry.js';
import { routeStats } from './stats.js';
import { placeGrid, gateAt, GRID } from './grid.js';
import { findShortcuts, autoCheckpoints, reattach, isCovered, mergeCuts, CHECKPOINTS } from './checkpoints.js';
import { validateRoute, checkRoadData } from './validate.js';

export const GUIDES = { arrows: true, signs: true, gates: true, arch: true };

export function newRoute(region, kind = 'p2p') {
  return { kind, region, waypoints: [], options: routeOptions(), grid: { count: GRID.count, adjust: {} }, checkpointMode: 'auto', spacing: CHECKPOINTS.spacing, checkpoints: [], guides: { ...GUIDES }, roads: 'closed', corridor: { margin: 8 }, path: null, length: 0, stats: null, referenceTime: null, roadData: null, review: null };
}

export function compileRoute(N, route) {
  const loop = route.kind === 'loop';
  const built = buildRoute(N, { kind: route.kind, waypoints: route.waypoints ?? [], options: route.options });
  const line = built.line, L = built.length ?? 0;
  const out = { built, line, loop, length: L, grid: null, checkpoints: [], gates: [], shortcuts: [], allShortcuts: [], stats: null, roadCheck: route.roadData ? checkRoadData(N, route.roadData) : null, lostCheckpoints: [], problems: [] };
  if (route.region && N.region && route.region !== N.region) built.problems.push({ level: 'error', field: 'region', message: `This route is in another region (${route.region}).` });
  if (line.length < 2) { out.problems = validateRoute(out); return out; }
  out.grid = placeGrid(line, { count: route.grid?.count ?? GRID.count, loop, nodes: built.nodes, startS: route.grid?.startS ?? null, adjust: route.grid?.adjust ?? {} });
  out.allShortcuts = findShortcuts(N, built, { loop });
  if ((route.checkpointMode ?? 'auto') === 'auto') {
    out.checkpoints = autoCheckpoints(line, { loop, startS: out.grid.startS, finishS: out.grid.finishS, spacing: route.spacing ?? CHECKPOINTS.spacing, shortcuts: out.allShortcuts, nodes: built.nodes });
    // (an auto checkpoint keeps its settings if one is still where it was)
    for (const c of out.checkpoints) {
      const was = (route.checkpoints ?? []).find(o => Math.abs(o.s - c.s) < 15);
      if (was) Object.assign(c, { required: was.required ?? true, timeExtension: was.timeExtension ?? 0, width: was.width ?? null });
    }
  } else {
    const { kept, lost } = reattach(line, route.checkpoints ?? [], N.P.toXZ);
    out.checkpoints = kept.sort((a, b) => order(a.s) - order(b.s));
    out.lostCheckpoints = lost;
  }
  function order(s) { return loop ? (((s - out.grid.startS) % L) + L) % L : s; }
  out.gates = out.checkpoints.map(c => ({ ...gateAt(line, c.s, { width: c.width ?? null, loop }), roadWidth: gateAt(line, c.s, { loop, margin: 0 }).width, id: c.id, required: c.required !== false }));
  out.start = gateAt(line, out.grid.startS, { loop });
  out.finish = loop ? out.start : gateAt(line, out.grid.finishS, { loop });
  // (the shortcuts to show: the uncovered ones first, each bunch as its biggest)
  for (const cut of out.allShortcuts) cut.covered = isCovered(cut, out.checkpoints, L, loop);
  out.shortcuts = [...mergeCuts(out.allShortcuts.filter(c => !c.covered), L, loop), ...mergeCuts(out.allShortcuts.filter(c => c.covered), L, loop)];
  out.stats = routeStats(line, { loop, segments: built.segments });
  out.problems = validateRoute(out);
  return out;
}

const r1 = x => Math.round(x * 10) / 10;

export function bakeRoute(N, route, compiled = compileRoute(N, route)) {
  const c = compiled, P = N.P, next = { ...route };
  if (!c.line.length) return { ...next, path: null, length: 0, stats: null };
  next.path = encodeLine(c.line.map(p => { const [lat, lon] = P.toLatLon(p.x, p.z); return { lat, lon, h: p.h, w: p.w }; }));
  next.length = Math.round(c.length);
  next.stats = c.stats;
  next.checkpoints = c.checkpoints.map(cp => { const g = c.gates.find(x => x.id === cp.id), [lat, lon] = P.toLatLon(g.x, g.z); return { id: cp.id, s: r1(cp.s), lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, width: cp.width ?? null, required: cp.required !== false, timeExtension: cp.timeExtension ?? 0, auto: !!cp.auto }; });
  next.grid = { ...(route.grid ?? {}), count: route.grid?.count ?? GRID.count, adjust: route.grid?.adjust ?? {}, startS: route.grid?.startS ?? null, at: r1(c.grid.startS), finish: r1(c.grid.finishS) };
  // (the roads it was made on, to notice when the map changes under it)
  const seen = new Map();
  for (const s of c.built.segments) if (!seen.has(s.key)) seen.set(s.key, { key: s.key, length: s.length, name: s.name ?? null });
  next.roadData = { region: N.region, version: N.version, osmDate: N.osmDate ?? null, segments: [...seen.values()] };
  next.review = null;
  return next;
}

export function lineOf(route, P) {
  if (!route?.path) return [];
  return withS(decodeLine(route.path).map(p => { const [x, z] = P.toXZ(p.lat, p.lon); return { x, z, h: p.h, w: p.w }; }));
}

// on load: the roads under the route checked against the map now; changed → needs review, and which
export function reviewRoute(N, route) {
  if (!route?.roadData) return route;
  const R = checkRoadData(N, route.roadData);
  if (!R.changed) return route.review?.needed ? { ...route, review: null } : route;
  return { ...route, review: { needed: true, version: N.version, missing: R.missing, altered: R.altered, segments: [...R.missing, ...R.altered].map(m => m.key) } };
}

// what the editor saves for a route item: the course baked (with its problems, so they're known without
// the road map) and the item's place (the start line, facing along the road)
export function saveCourse(N, route) {
  const c = compileRoute(N, route), course = bakeRoute(N, route, c);
  course.problems = c.problems.map(p => ({ level: p.level, field: p.field ?? '', message: p.message }));
  let location = null;
  if (c.line.length) {
    const g = c.start, [lat, lon] = N.P.toLatLon(g.x, g.z);
    location = { lat: Math.round(lat * 1e7) / 1e7, lon: Math.round(lon * 1e7) / 1e7, alt: Math.round(g.h * 10) / 10, heading: Math.round(((g.heading % 360) + 360) % 360 * 10) / 10 % 360, altFrom: 'road' };
  }
  return { course, location, compiled: c };
}
