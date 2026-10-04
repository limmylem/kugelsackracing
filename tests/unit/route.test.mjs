// Routes (Phase 4 Step 2), on a small made-up road map whose answers are known, and on the baked San
// Francisco: routing between points (one-way streets, road options, locked roads, off-road legs, loops),
// the stored route's round trip, noticing the road data changed, checkpoints passed in order, the corridor and
// the wrong way, shortcut detection, the start grid and the route's numbers.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { createNetwork } from '../../route/network.js';
import { buildRoute } from '../../route/build.js';
import { compileRoute, bakeRoute, lineOf, reviewRoute, newRoute, saveCourse } from '../../route/model.js';
import { createTracker } from '../../route/tracker.js';
import { findShortcuts, crossings } from '../../route/checkpoints.js';
import { placeGrid } from '../../route/grid.js';
import { routeStats } from '../../route/stats.js';
import { at, resample } from '../../route/geometry.js';
import { validateRoute } from '../../route/validate.js';
import { transverseMercator } from '../../map/build/format/projection.js';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
// (a flat projection: 1° = 100 km, z south)
const P = { toXZ: (lat, lon) => [lon * 1e5, -lat * 1e5], toLatLon: (x, z) => [-z / 1e5, x / 1e5] };
const ll = (x, z) => { const [lat, lon] = P.toLatLon(x, z); return { lat, lon }; };

// The test map (metres, x east, z south):
//
//   (0,0)──A1──(200,0)───────A2 "Top Road"───────(1000,0)
//                 │                                  │
//          D "Cut Lane"                        B "East Road" (one-way, south)
//                 │                                  │
//   (0,600)─C1─(200,600)──────C2 "Bottom Road"───(1000,600)──M "Motorway"──(1800,600)
//
// plus a narrow alley N off (600,0) north, and a steep hill road H off (1800,600) south.
function testMap({ drop = null, stretch = null } = {}) {
  const pts = [[0, 0], [200, 0], [1000, 0], [0, 600], [200, 600], [1000, 600], [1800, 600], [600, 0], [600, -300], [1800, 1400]];
  const nodes = { osm: pts.map((_, i) => 100 + i), x: pts.map(p => p[0]), z: pts.map(p => p[1]), h: pts.map((_, i) => (i === 9 ? 120 : 10)), lat: [], lon: [] };
  for (const [x, z] of pts) { const { lat, lon } = ll(x, z); nodes.lat.push(lat); nodes.lon.push(lon); }
  const ways = [
    ['A1', 0, 1, 'Top Road', 'primary'], ['A2', 1, 7, 'Top Road', 'primary'], ['A3', 7, 2, 'Top Road', 'primary'], ['B', 2, 5, 'East Road', 'primary', { oneway: 1 }],
    ['C1', 3, 4, 'Bottom Road', 'primary'], ['C2', 4, 5, 'Bottom Road', 'primary'], ['D', 1, 4, 'Cut Lane', 'residential'],
    ['M', 5, 6, 'Motorway', 'motorway'], ['N', 7, 8, 'Narrow Alley', 'service', { width: 3 }], ['H', 6, 9, 'Hill Road', 'secondary'],
  ];
  const segs = [];
  ways.forEach(([name, a, b, label, cls, extra = {}], i) => {
    if (drop === name) return;
    const [ax, az] = pts[a], [bx, bz] = stretch === name ? [pts[b][0] + 30, pts[b][1]] : pts[b], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 50)), p = [];
    for (let k = 0; k <= n; k++) p.push(ax + (bx - ax) * k / n, az + (bz - az) * k / n, nodes.h[a] + (nodes.h[b] - nodes.h[a]) * k / n);
    segs.push({ id: i, from: a, to: b, way: 1000 + i, name: label, class: cls, rank: cls === 'service' ? 1 : 4, oneway: extra.oneway ?? 0, width: extra.width ?? 10, surface: 'asphalt', structure: null, points: p });
  });
  return createNetwork({ nodes, segs }, { P, region: 'test', version: drop || stretch ? 'v2' : 'v1' });
}
const names = r => [...new Set(r.segments.map(s => s.name))];

test('routing: along the roads, one-way streets, road options, locked roads, off-road legs, loops', () => {
  const N = testMap();
  // (50,0) → (1000,300) → (50,600): Top Road, East Road down, Bottom Road back
  const r = buildRoute(N, { kind: 'p2p', waypoints: [ll(50, 0), ll(1000, 300), ll(50, 600)] });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.deepEqual(names(r), ['Top Road', 'East Road', 'Bottom Road']);
  assert.ok(Math.abs(r.length - (950 + 600 + 950)) < 15, `${r.length} m`);
  // the way back: East Road is one-way south, so the route goes round by Cut Lane…
  const back = buildRoute(N, { kind: 'p2p', waypoints: [ll(900, 600), ll(900, 0)] });
  assert.equal(back.ok, true);
  assert.deepEqual(names(back), ['Bottom Road', 'Cut Lane', 'Top Road']);
  // …unless the route may drive one-way streets backwards
  const rev = buildRoute(N, { kind: 'p2p', waypoints: [ll(900, 600), ll(900, 0)], options: { reverseOneway: true } });
  assert.ok(names(rev).includes('East Road') && rev.length < back.length);
  // no motorways: the far end can't be reached
  const noM = buildRoute(N, { kind: 'p2p', waypoints: [ll(100, 600), ll(1800, 1000)], options: { motorways: false } });
  assert.equal(noM.ok, false);
  assert.ok(noM.problems.some(p => /check its road options|isn't near a road this route may use/.test(p.message)), JSON.stringify(noM.problems));
  // a locked road: driven end to end, though the short way is elsewhere
  const lock = buildRoute(N, { kind: 'p2p', waypoints: [ll(50, 0), { ...ll(200, 300), lock: { key: N.keyOf(N.segs.find(s => s.name === 'Cut Lane')), dir: 1 } }, ll(50, 600)] });
  assert.deepEqual(names(lock), ['Top Road', 'Cut Lane', 'Bottom Road']);
  // an off-road leg: only if the route allows it
  const off = [ll(50, 0), { ...ll(100, 300), offRoad: true }];
  assert.equal(buildRoute(N, { kind: 'p2p', waypoints: off }).ok, false);
  assert.match(buildRoute(N, { kind: 'p2p', waypoints: off }).problems[0].message, /off-road: allow off-road/);
  assert.equal(buildRoute(N, { kind: 'p2p', waypoints: off, options: { offRoad: true } }).ok, true);
  // a loop: back to where it started, closed
  const loop = buildRoute(N, { kind: 'loop', waypoints: [ll(500, 0), ll(1000, 300), ll(500, 600)] });
  assert.equal(loop.ok, true);
  const a = loop.line[0], b = loop.line.at(-1);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 1, 'closed');
  assert.ok(Math.abs(loop.length - 2 * (800 + 600)) < 30, `${loop.length} m`);
  // a waypoint nowhere near a road
  assert.match(buildRoute(N, { kind: 'p2p', waypoints: [ll(50, 0), ll(600, 300)] }).problems[0].message, /isn't near a road/);
});

test('a route saved and loaded: the same line, checkpoints, grid and numbers', () => {
  const N = testMap();
  const route = { ...newRoute('test', 'p2p'), waypoints: [ll(50, 0), ll(1000, 300), ll(50, 600)] };
  const c = compileRoute(N, route), baked = bakeRoute(N, route, c);
  const back = JSON.parse(JSON.stringify(baked));
  const line = lineOf(back, P);
  assert.equal(line.length, c.line.length);
  for (let k = 0; k < line.length; k += 17) assert.ok(Math.hypot(line[k].x - c.line[k].x, line[k].z - c.line[k].z) < 0.2 && Math.abs(line[k].h - c.line[k].h) < 0.01 && line[k].w === c.line[k].w);
  assert.deepEqual(back.roadData.segments.map(s => s.key), [...new Set(c.built.segments.map(s => s.key))]);
  assert.equal(back.roadData.version, 'v1');
  const again = compileRoute(N, back);
  assert.deepEqual(again.checkpoints.map(x => Math.round(x.s)), c.checkpoints.map(x => Math.round(x.s)));
  assert.equal(again.grid.startS, c.grid.startS);
  assert.deepEqual(again.stats, c.stats);
  // hand-placed checkpoints: kept by where they are through a change to the route
  const manual = { ...back, checkpointMode: 'manual', checkpoints: back.checkpoints.slice(0, 2) };
  const moved = compileRoute(N, { ...manual, waypoints: [ll(30, 0), ...manual.waypoints.slice(1)] });
  assert.equal(moved.checkpoints.length, 2);
  assert.ok(Math.abs(moved.checkpoints[0].s - (back.checkpoints[0].s + 20)) < 3, `${moved.checkpoints[0].s} vs ${back.checkpoints[0].s}`);
});

test('road data changed under a route: marked for review, with the roads affected', () => {
  const N1 = testMap();
  const route = bakeRoute(N1, { ...newRoute('test', 'p2p'), waypoints: [ll(50, 0), ll(1000, 300), ll(50, 600)] });
  assert.equal(reviewRoute(N1, route), route, 'same roads: nothing to do');
  // East Road's gone from the map
  const gone = reviewRoute(testMap({ drop: 'B' }), route);
  assert.equal(gone.review.needed, true);
  assert.deepEqual(gone.review.missing.map(m => m.name), ['East Road']);
  assert.ok(gone.review.segments.includes(N1.keyOf(N1.segs.find(s => s.name === 'East Road'))));
  const c = compileRoute(testMap({ drop: 'B' }), route);
  assert.ok(c.problems.some(p => p.level === 'error' && /Route uses a road that no longer exists in OSM data \(East Road\)/.test(p.message)), JSON.stringify(c.problems));
  // Bottom Road's changed shape
  const moved = reviewRoute(testMap({ stretch: 'C2' }), route);
  assert.equal(moved.review.needed, true);
  assert.deepEqual(moved.review.altered.map(m => m.name), ['Bottom Road']);
  assert.equal(moved.review.missing.length, 0);
  // baked again on the new map: reviewed
  assert.equal(bakeRoute(testMap({ stretch: 'C2' }), moved).review, null);
});

// drive a line at a speed, from s0, with a hook to move the car elsewhere now and then
function drive(T, line, { from = 0, speed = 20, dt = 0.05, loop = false, until = 1e9, hook = null, max = 20000 } = {}) {
  const ev = []; let s = from;
  for (let i = 0; i < max && !T.state.finished && s < until; i++) {
    s += speed * dt;
    let p = at(line, s, loop), car = { x: p.x, z: p.z, vx: p.dx * speed, vz: p.dz * speed };
    if (hook) { const h = hook(s, car, ev); if (h?.s != null) { s = h.s; p = at(line, s, loop); car = { x: p.x, z: p.z, vx: p.dx * speed, vz: p.dz * speed }; } else if (h) car = h; }
    for (const e of T.update(dt, car)) ev.push({ ...e, at: s });
  }
  return ev;
}

test('checkpoints are passed in order: skipping one is "missed", and there is no finish without it', () => {
  const line = resample([{ x: 0, z: 0, h: 0, w: 10 }, { x: 2000, z: 0, h: 0, w: 10 }]);
  const cps = [400, 800, 1200, 1600].map((s, i) => ({ id: `c${i}`, s, required: true }));
  cps.push({ id: 'bonus', s: 1000, required: false, timeExtension: 5 });
  const T = createTracker({ line, startS: 50, finishS: 1950, checkpoints: cps });
  T.begin(10, 0).start();
  // jump from 700 to 900 (as if by a shortcut): past checkpoint 2 without going through it
  const ev = drive(T, line, { from: 10, hook: s => (s > 700 && s < 705 ? { s: 900 } : null) });
  const types = ev.map(e => e.type + (e.number ?? ''));
  assert.deepEqual(types.slice(0, 2), ['start', 'checkpoint1']);
  assert.ok(types.includes('missed2'), types.join(' '));
  assert.ok(!types.includes('finish'), 'no finish without checkpoint 2');
  assert.ok(ev.find(e => e.type === 'missed').message.includes('Missed checkpoint 2'));
  // in order: every one, the bonus with its extension, then the finish
  const T2 = createTracker({ line, startS: 50, finishS: 1950, checkpoints: cps });
  T2.begin(10, 0).start();
  const ev2 = drive(T2, line, { from: 10 });
  assert.deepEqual(ev2.map(e => e.type + (e.bonus ? '+' : '') + (e.number ?? '')), ['start', 'checkpoint1', 'checkpoint2', 'checkpoint+', 'checkpoint3', 'checkpoint4', 'finish']);
  assert.equal(T2.state.extension, 5);
  assert.ok(Math.abs(ev2.at(-1).time - 1940 / 20) < 0.2, `${ev2.at(-1).time}`);
  // laps on a loop: the checkpoints again each lap
  const ring = resample(Array.from({ length: 65 }, (_, k) => ({ x: 300 * Math.cos(k * Math.PI / 32), z: 300 * Math.sin(k * Math.PI / 32), h: 0, w: 10 })));
  const L = ring.at(-1).s, T3 = createTracker({ line: ring, loop: true, startS: 40, checkpoints: [{ id: 'a', s: L / 3, required: true }, { id: 'b', s: 2 * L / 3, required: true }], laps: 3 });
  T3.begin(ring[2].x, ring[2].z).start();
  const ev3 = drive(T3, ring, { from: ring[2].s, loop: true });
  assert.deepEqual(ev3.map(e => e.type + (e.number ?? '')), ['start', 'checkpoint1', 'checkpoint2', 'lap', 'checkpoint1', 'checkpoint2', 'lap', 'checkpoint1', 'checkpoint2', 'finish']);
  assert.equal(T3.state.lapTimes.length, 3);
});

test('the corridor and the wrong way: "Return to route", then a reset to the last checkpoint; driving backwards', () => {
  const line = resample([{ x: 0, z: 0, h: 0, w: 10 }, { x: 2000, z: 0, h: 0, w: 10 }]);
  const T = createTracker({ line, startS: 50, finishS: 1950, checkpoints: [{ id: 'c', s: 500, required: true }], resetSpacing: 10000 });
  T.begin(10, 0).start();
  // off to the side (30 m: outside 5 + 8) from 700 m on
  const ev = drive(T, line, { from: 10, until: 1000, hook: (s, car) => (s > 700 ? { ...car, z: 30 } : null) });
  const leave = ev.find(e => e.type === 'leave'), reset = ev.find(e => e.type === 'reset');
  assert.equal(leave.message, 'Return to route');
  assert.ok(Math.abs(leave.at - 720) < 3, `warned after a second (${leave.at})`);
  assert.ok(Math.abs(reset.at - 800) < 3, `reset after five (${reset.at})`);
  assert.ok(Math.abs(reset.point.s - 500) < 1 && Math.abs(reset.point.heading - 90) < 1, `to the last checkpoint, facing along: ${JSON.stringify(reset.point)}`);
  T.resetTo(reset.point);
  assert.equal(T.state.offRoute, false);
  // back on the road: no warning
  const T2 = createTracker({ line, startS: 50, finishS: 1950, checkpoints: [] });
  T2.begin(10, 0).start();
  assert.ok(!drive(T2, line, { from: 10, until: 600, hook: (s, car) => ({ ...car, z: 9 }) }).some(e => e.type === 'leave'), 'on the verge, inside the margin');
  // the wrong way: after a second and a half
  const T3 = createTracker({ line, startS: 50, finishS: 1950, checkpoints: [] });
  T3.begin(1000, 0).start();
  const ev3 = drive(T3, line, { from: 1000, until: 1400, hook: (s, car) => ({ x: 2000 - s, z: 0, vx: -20, vz: 0 }) });
  const w = ev3.find(e => e.type === 'wrongway');
  assert.ok(w && Math.abs(w.at - 1030) < 2, `${w?.at}`);
  assert.equal(T3.state.wrongWay, true);
});

test('shortcuts on the test map: another road joining two parts, the route close to itself, crossing itself', () => {
  const N = testMap();
  const built = buildRoute(N, { kind: 'p2p', waypoints: [ll(50, 0), ll(1000, 300), ll(50, 600)] });
  const cuts = findShortcuts(N, built);
  const cut = cuts.find(c => c.kind === 'road');
  assert.ok(cut, JSON.stringify(cuts));
  assert.equal(cut.via, 'Cut Lane');
  assert.equal(cut.gap, 600);
  assert.ok(Math.abs(cut.a - 150) < 6 && Math.abs(cut.b - 2350) < 10 && Math.abs(cut.saving - 1600) < 15, JSON.stringify(cut));
  // the compiled route puts a checkpoint inside it; without one, a warning
  const route = { ...newRoute('test', 'p2p'), waypoints: built.line.length ? [ll(50, 0), ll(1000, 300), ll(50, 600)] : [], spacing: 0 };
  const c = compileRoute(N, route);
  assert.ok(c.checkpoints.some(x => x.s > cut.a && x.s < cut.b && x.reason === 'shortcut'));
  assert.ok(!c.problems.some(p => /shortcut/.test(p.message)));
  const bare = compileRoute(N, { ...route, checkpointMode: 'manual', checkpoints: [] });
  const warn = bare.problems.find(p => /Possible shortcut via Cut Lane/.test(p.message));
  assert.ok(warn && warn.level === 'warning', JSON.stringify(bare.problems));
  // close to itself: a hairpin whose two legs are 12 m apart
  const hair = resample([{ x: 0, z: 0, h: 0, w: 8 }, { x: 600, z: 0, h: 0, w: 8 }, { x: 600, z: 12, h: 0, w: 8 }, { x: 0, z: 12, h: 0, w: 8 }]);
  const near = findShortcuts(null, { line: hair, length: hair.at(-1).s, segments: [], nodes: [], loop: false });
  assert.ok(near.some(n => n.kind === 'near' && n.gap <= 14 && n.saving > 900), JSON.stringify(near));
  // crossing itself: a figure of eight
  const eight = resample([{ x: 0, z: 0 }, { x: 400, z: 400 }, { x: 400, z: 0 }, { x: 0, z: 400 }, { x: 0, z: 800 }].map(p => ({ ...p, h: 0, w: 8 })));
  const x = crossings(eight);
  assert.equal(x.length, 1);
  assert.ok(Math.abs(x[0].a - Math.hypot(200, 200)) < 5, JSON.stringify(x));
});

test('validation: plain-English errors and warnings', () => {
  const N = testMap();
  const short = compileRoute(N, { ...newRoute('test', 'p2p'), waypoints: [ll(300, 0), ll(500, 0)] });
  assert.ok(short.problems.some(p => p.level === 'error' && /^Route is under 500 m \(it's 200 m\)/.test(p.message)), JSON.stringify(short.problems));
  const one = compileRoute(N, { ...newRoute('test', 'p2p'), waypoints: [ll(300, 0)] });
  assert.match(one.problems[0].message, /at least two waypoints/);
  // a grid slot nudged off the road
  const r = { ...newRoute('test', 'p2p'), waypoints: [ll(50, 0), ll(1000, 300), ll(50, 600)], grid: { count: 8, adjust: { 6: { d: 9 } } } };
  assert.ok(compileRoute(N, r).problems.some(p => p.level === 'error' && p.message === 'Grid slot 7 is off the road.'));
  // a crossing with no checkpoint is an error
  const eight = { line: resample([{ x: 0, z: 0 }, { x: 400, z: 400 }, { x: 400, z: 0 }, { x: 0, z: 400 }, { x: 0, z: 800 }].map(p => ({ ...p, h: 0, w: 8 }))) };
  const c = { built: { line: eight.line, problems: [], uturns: [] }, length: eight.line.at(-1).s, loop: false, grid: { startS: 0, finishS: eight.line.at(-1).s, problems: [] }, checkpoints: [], shortcuts: crossings(eight.line) };
  assert.ok(validateRoute(c).some(p => p.level === 'error' && /^Route crosses itself without a checkpoint/.test(p.message)));
  c.checkpoints = [{ id: 'x', s: 500, required: true }];
  assert.ok(!validateRoute(c).some(p => /crosses itself/.test(p.message)));
});

test('the start grid: side by side on a wide road, single file on a narrow one; slope and junction warnings', () => {
  const wide = resample([{ x: 0, z: 0, h: 0, w: 10 }, { x: 600, z: 0, h: 0, w: 10 }]);
  const g = placeGrid(wide, { count: 8 });
  assert.equal(g.columns, 2); assert.equal(g.slots.length, 8); assert.deepEqual(g.problems, []);
  assert.ok(g.slots.every(s => s.s < g.startS && s.s > 0 && Math.abs(s.heading - 90) < 0.5), 'behind the line, facing along');
  assert.equal(g.slots[0].d, -g.slots[1].d, 'two columns');
  assert.ok(g.slots[2].s < g.slots[0].s && g.slots[1].s < g.slots[0].s, 'staggered rows');
  const narrow = placeGrid(resample([{ x: 0, z: 0, h: 0, w: 5 }, { x: 600, z: 0, h: 0, w: 5 }]), { count: 6 });
  assert.equal(narrow.columns, 1);
  assert.ok(narrow.problems.some(p => /too narrow for side-by-side slots/.test(p.message)));
  const steep = placeGrid(resample([{ x: 0, z: 0, h: 0, w: 10 }, { x: 600, z: 0, h: 60, w: 10 }]), { count: 8 });
  assert.ok(steep.problems.some(p => /steep slope \(10%\)/.test(p.message)));
  const across = placeGrid(wide, { count: 8, nodes: [{ s: 20, degree: 4 }] });
  assert.ok(across.problems.some(p => /across a junction/.test(p.message)));
  assert.equal(placeGrid(wide, { count: 3 }).slots.length, 3, 'configurable');
});

test('the route\'s numbers: length, turns, sharpest corner, climb, estimated time, road names', () => {
  const N = testMap();
  const built = buildRoute(N, { kind: 'p2p', waypoints: [ll(50, 0), ll(1000, 300), ll(50, 600)] });
  const s = routeStats(built.line, { segments: built.segments });
  assert.equal(s.turns, 2);
  assert.ok(s.sharpest.radius < 30 && s.sharpest.way === 'right', JSON.stringify(s.sharpest));
  assert.deepEqual(s.roads, ['Top Road', 'East Road', 'Bottom Road']);
  assert.ok(s.estimatedTime > 2500 / 46 && s.estimatedTime < 2500 / 15, `${s.estimatedTime} s`);
  const hill = buildRoute(N, { kind: 'p2p', waypoints: [ll(1000, 600), ll(1800, 1300)] });
  const h = routeStats(hill.line, { segments: hill.segments });
  assert.ok(h.climb > 95 && h.climb < 115 && h.descent === 0, `${h.climb} up`);
});

test('San Francisco: a route by real roads, its grid, checkpoints and a drive round it', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/map/sf/manifest.json')));
  const Psf = transverseMercator(m.projection.lat0, m.projection.lon0);
  const G = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'assets/map/sf/graph.json.gz'))));
  const N = createNetwork(G, { P: Psf, region: 'sf', version: m.version });
  const route = { ...newRoute('sf', 'p2p'), waypoints: [{ lat: 37.7936, lon: -122.3955 }, { lat: 37.7880, lon: -122.4075 }, { lat: 37.7765, lon: -122.4170 }] };
  const t = performance.now(), c = compileRoute(N, route), ms = performance.now() - t;
  assert.ok(ms < 2000, `${ms} ms`);
  assert.deepEqual(c.problems.filter(p => p.level === 'error'), []);
  assert.ok(c.stats.roads.includes('Market Street') && c.stats.roads[0] === 'Spear Street', c.stats.roads.join(', '));
  assert.ok(c.length > 3000 && c.length < 4500);
  assert.equal(c.grid.slots.length, 8);
  assert.ok(c.shortcuts.every(s => s.covered));
  const T = createTracker({ line: c.line, startS: c.grid.startS, finishS: c.grid.finishS, checkpoints: c.checkpoints });
  T.begin(c.grid.slots[0].x, c.grid.slots[0].z).start();
  const ev = drive(T, c.line, { from: c.grid.slots[0].s });
  assert.equal(ev.filter(e => e.type === 'checkpoint').length, c.checkpoints.length);
  assert.equal(ev.at(-1).type, 'finish');
  assert.ok(!ev.some(e => ['leave', 'wrongway', 'missed'].includes(e.type)));
});

test('routes as world content: the shape, a quest linked to one (laps need a loop), published together, flagged when the roads change', async () => {
  const { newItem, problems } = await import('../../content/quests.js');
  const { contentChecker } = await import('../../content/schema.js');
  const { createLocalContentService } = await import('../../content/service.js');
  const { MemoryContentStorage } = await import('../../content/storage.js');
  const json = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  const economy = json('data/economy.json'), check = contentChecker(json('data/schemas/content-item.schema.json'), { economy });
  const N = testMap();
  const make = (kind, waypoints) => {
    const it = newItem('route', { id: `route_${kind}0001`, location: { ...ll(50, 0), alt: 0, heading: 0 }, region: 'test', routeKind: kind });
    const s = saveCourse(N, { ...it.course, waypoints });
    return { ...it, name: `A ${kind}`, course: s.course, location: s.location };
  };
  const p2p = make('p2p', [ll(50, 0), ll(1000, 300), ll(50, 600)]), loop = make('loop', [ll(500, 0), ll(1000, 300), ll(500, 600)]);
  assert.deepEqual(check.shape(p2p), []); assert.deepEqual(check.shape(loop), []);
  assert.deepEqual(problems(p2p).filter(p => p.level === 'error'), []);
  assert.ok(JSON.stringify(p2p).length < 30000, `${JSON.stringify(p2p).length} bytes`);
  // a draft route with nothing drawn can't be published
  const empty = newItem('route', { id: 'route_empty0001', location: { ...ll(0, 0), alt: 0, heading: 0 }, region: 'test' });
  assert.deepEqual(check.shape(empty), []);
  assert.match(problems(empty)[0].message, /Draw the route/);
  // a quest on a route: laps need a loop, a delivery goes somewhere
  const quest = (type, route, laps = 1) => { const q = newItem('quest', { id: 'quest_r0000001', location: { ...route.location }, type }); q.route = route.id; if ('laps' in q.params) q.params.laps = laps; return q; };
  const errs = (q, route) => problems(q, { economy, route }).filter(p => p.level === 'error').map(p => p.message);
  assert.deepEqual(errs(quest('sprint', p2p), p2p), [], 'a sprint needs no finish line of its own with a route');
  assert.ok(errs(quest('time_trial', p2p, 3), p2p).some(m => /3 laps need a loop route/.test(m)));
  assert.ok(!errs(quest('time_trial', loop, 3), loop).some(m => /laps/.test(m)));
  assert.ok(errs(quest('delivery', loop), loop).some(m => /delivery needs a point-to-point route/.test(m)));
  assert.ok(errs(quest('sprint', p2p), null).some(m => /doesn't exist/.test(m)));
  const far = { ...quest('sprint', p2p), location: { ...ll(1800, 1400), alt: 0, heading: 0 } };
  assert.ok(problems(far, { economy, route: p2p }).some(p => p.level === 'warning' && /from its route's start/.test(p.message)));
  // through the service: publishing the quest publishes its route; one route serves two quests
  let k = 0;
  const S = createLocalContentService({ storage: new MemoryContentStorage(), check, autosaveMs: null, newId: kind => `${kind}_${String(++k).padStart(6, '0')}` });
  const r = (await S.create(p2p)).item;
  const q1 = (await S.create({ ...quest('sprint', r), id: undefined })).item, q2 = (await S.create({ ...quest('drift', r), id: undefined, params: { scoreTarget: 1000, timeLimitSeconds: null } })).item;
  assert.equal((await S.get(r.id, { view: 'published' })).item, null);
  const pub = await S.publish(q1.id);
  assert.ok(pub.ok, pub.error);
  assert.equal(pub.route.id, r.id);
  assert.equal((await S.get(r.id, { view: 'published' })).item.status, 'published');
  const pub2 = await S.publish(q2.id);
  assert.ok(pub2.ok && pub2.route === null, 'the route is already published as it is');
  // the roads under it change: flagged for review, and quests on it can't be published until it's checked
  const changed = { ...r.course, ...reviewRoute(testMap({ drop: 'B' }), r.course) };
  await S.update(r.id, { course: changed });
  assert.ok(problems((await S.get(r.id)).item).some(p => p.level === 'error' && /no longer exists in OSM data \(East Road\)/.test(p.message)));
  const blocked = await S.publish(q1.id);
  assert.ok(!blocked.ok && /has problems to fix first: Route uses a road that no longer exists in OSM data/.test(blocked.error), blocked.error);
  // the game's markers don't include routes
  const { MARKER_KINDS } = await import('../../content/quests.js');
  assert.ok(!MARKER_KINDS.includes('route'));
});
