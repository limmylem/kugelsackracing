// Routes at scale (Phase 4 Step 2): a 50 km route through San Francisco's baked roads — worked out in full,
// then edited (a waypoint moved, as a drag does) with only the legs that changed routed again; followed by
// the tracker every frame along all of it; and dressed on the road (gates, signs, arrows) piece by piece as
// a car drives the whole way, the pieces made and thrown away by distance with no growth in memory.
//
//   npm run perf:route          (node --expose-gc: the memory figures need it)

import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import * as THREE from 'three';
import { transverseMercator } from '../map/build/format/projection.js';
import { createNetwork } from '../route/network.js';
import { buildRoute } from '../route/build.js';
import { compileRoute, newRoute } from '../route/model.js';
import { createTracker } from '../route/tracker.js';
import { at } from '../route/geometry.js';
import { createRouteDressing } from '../play/routeDressing.js';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const BUDGET = { compileMs: 6000, editMs: 900, previewMs: 250, trackerUs: 200, heapGrowthMB: 8, maxChunks: 20 };
let failed = 0;
const report = (pass, name, detail) => { if (!pass) failed++; console.log(`${pass ? '  ok  ' : ' FAIL '} ${name.padEnd(46)} ${detail}`); };
const gc = globalThis.gc ?? (() => {});
const heapMB = () => { gc(); gc(); return process.memoryUsage().heapUsed / 1e6; };

// (canvas textures in Node: a canvas that draws nothing)
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: (t, k) => k in t ? t[k] : () => {}, set: (t, k, v) => { t[k] = v; return true; } }) }) };

const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/map/sf/manifest.json'), 'utf8')), P = transverseMercator(m.projection.lat0, m.projection.lon0);
let t = performance.now();
const N = createNetwork(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'assets/map/sf/graph.json.gz')))), { P, region: 'sf', version: m.version });
console.log(`  road network: ${N.segs.length} segments in ${Math.round(performance.now() - t)} ms`);

// a 50 km tour: waypoints on the bigger roads, each a kilometre or so on from the last (seeded: the same tour every run)
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const main = N.mainPart({ reverseOneway: false, motorways: true, unpaved: false, tunnels: true });
const big = N.segs.filter(g => (g.rank ?? 0) >= 5 && g.length > 60 && main[g.from] && main[g.to] && g.structure === 'ground');
const waypoints = [];
let last = big[Math.floor(rnd() * big.length)];
for (let k = 0; k < 400 && waypoints.length < 44; k++) {
  const g = big[Math.floor(rnd() * big.length)], p = N.pointOn(g, g.length / 2), q = N.pointOn(last, last.length / 2), d = Math.hypot(p.x - q.x, p.z - q.z);
  if (waypoints.length && (d < 700 || d > 1500)) continue;
  const [lat, lon] = P.toLatLon(p.x, p.z);
  waypoints.push({ lat, lon }); last = g;
}
const route = { ...newRoute('sf', 'p2p'), waypoints };

t = performance.now();
const c = compileRoute(N, route);
const compileMs = performance.now() - t;
report(c.length >= 45000 && c.built.ok, 'a long route: routed', `${(c.length / 1000).toFixed(1)} km, ${waypoints.length} waypoints, ${c.built.segments.length} road pieces, ${c.line.length} points`);
report(compileMs < BUDGET.compileMs, 'worked out in full (routing, grid, checkpoints, shortcuts, checks)', `${Math.round(compileMs)} ms (budget ${BUDGET.compileMs}); ${c.checkpoints.length} checkpoints, ${c.allShortcuts.length} shortcuts looked at`);

// an edit: a waypoint in the middle moved 60 m — only its two legs routed again
const moved = clone(route), i = Math.floor(waypoints.length / 2);
moved.waypoints[i] = { lat: waypoints[i].lat + 0.0004, lon: waypoints[i].lon + 0.0003 };
t = performance.now(); buildRoute(N, moved); const previewMs = performance.now() - t;
t = performance.now(); compileRoute(N, moved); const editMs = performance.now() - t;
report(previewMs < BUDGET.previewMs, 'dragging a waypoint: the route as it moves', `${previewMs.toFixed(0)} ms a step (budget ${BUDGET.previewMs})`);
report(editMs < BUDGET.editMs, 'let go: grid, checkpoints, shortcuts again', `${editMs.toFixed(0)} ms (budget ${BUDGET.editMs})`);

// the tracker each frame (60 a second) along all 50 km
const T = createTracker({ line: c.line, startS: c.grid.startS, finishS: c.grid.finishS, checkpoints: c.checkpoints });
const s0 = c.grid.slots[0];
T.begin(s0.x, s0.z).start();
let frames = 0, events = 0;
t = performance.now();
for (let s = s0.s; s < c.length && !T.state.finished; s += 40 / 60) { const p = at(c.line, s); events += T.update(1 / 60, { x: p.x, z: p.z, vx: p.dx * 40, vz: p.dz * 40 }).length; frames++; }
const perFrame = (performance.now() - t) / frames * 1000;
report(T.state.finished && perFrame < BUDGET.trackerUs, 'the tracker, every frame', `${perFrame.toFixed(1)} µs a frame over ${frames} frames (budget ${BUDGET.trackerUs}); ${T.state.next} checkpoints, finished ${T.state.finished}`);

// the dressing driven past: pieces in and out by distance, memory level
const scene = new THREE.Group(), D = createRouteDressing({ THREE, parent: scene, compiled: c, guides: {} });
const heaps = [];
let maxChunks = 0, maxObjects = 0;
const h0 = heapMB();
for (let lap = 0; lap < 3; lap++) {
  for (let s = 0; s < c.length; s += 25) { const p = at(c.line, s); D.update(p.x, p.z); maxChunks = Math.max(maxChunks, D.stats.loaded); maxObjects = Math.max(maxObjects, D.stats.objects); }
  heaps.push(heapMB());
}
const growth = heaps.at(-1) - heaps[0];
report(maxChunks <= BUDGET.maxChunks, 'dressing: only the pieces near the car', `at most ${maxChunks} of ${D.stats.chunks} pieces at once (budget ${BUDGET.maxChunks}), ${maxObjects} objects, ${D.stats.items} things in all`);
report(globalThis.gc ? growth < BUDGET.heapGrowthMB : true, 'dressing: no growth, three times the length', globalThis.gc ? `heap ${h0.toFixed(1)} → ${heaps.map(h => h.toFixed(1)).join(' → ')} MB (growth ${growth.toFixed(1)} MB, budget ${BUDGET.heapGrowthMB})` : 'skipped: run with --expose-gc');
D.dispose();
report(scene.children.length === 0, 'dressing: all gone when done', `${scene.children.length} left`);

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
function clone(x) { return JSON.parse(JSON.stringify(x)); }
