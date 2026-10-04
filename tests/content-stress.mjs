// World content at scale (Phase 4 Step 1): 50,000 markers on Earth — 20,000 scattered anywhere and 30,000
// round twenty cities, as real content would bunch up — then:
//   - nearby queries ("what's within X km") under their time limit, everywhere and in the busiest places
//   - the editor's camera flying and a car driving across many cells: the content work each frame (the
//     queries as it moves on, the markers' update — editor/markers3d.js, as the game and editor draw them)
//     within its share of the frame budget
//   - memory level while flying: cells and labels unloaded and disposed as they're left behind
//
//   node --expose-gc tests/content-stress.mjs        (npm run stress:content)

import fs from 'node:fs';
import * as THREE from 'three';
import { newItem } from '../content/quests.js';
import { contentChecker } from '../content/schema.js';
import { createLocalContentService } from '../content/service.js';
import { MemoryContentStorage } from '../content/storage.js';
import { offset, distanceKm } from '../content/geo.js';
import { createMarkers3d } from '../editor/markers3d.js';

const LIMITS = {
  queryP95Ms: 5, queryMaxMs: 25,           // "what's near": every query, everywhere
  frameP95Ms: 2, frameMaxMs: 12,           // the content's work in a frame (of a 16.7 ms frame)
  heapGrowthMB: 25,                        // flying 400 km over content
  loadedCells: 3000,                       // cells kept in memory, however far it flies
};
const json = f => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
const check = contentChecker(json('data/schemas/content-item.schema.json'), { economy: json('data/economy.json') });
const S = createLocalContentService({ storage: new MemoryContentStorage(), check, autosaveMs: null });
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const anywhere = () => ({ lat: Math.asin(2 * rnd() - 1) * 180 / Math.PI, lon: rnd() * 360 - 180 });
const CITIES = [[37.7749, -122.4194], [40.7128, -74.006], [51.5074, -0.1278], [48.8566, 2.3522], [35.6762, 139.6503], [-33.8688, 151.2093], [52.52, 13.405], [19.4326, -99.1332], [-23.5505, -46.6333], [55.7558, 37.6173], [1.3521, 103.8198], [28.6139, 77.209], [30.0444, 31.2357], [-1.2921, 36.8219], [64.1466, -21.9426], [-41.2865, 174.7762], [45.5017, -73.5673], [41.9028, 12.4964], [59.3293, 18.0686], [-34.6037, -58.3816]].map(([lat, lon]) => ({ lat, lon }));

const results = [], report = (name, ok, detail) => { results.push(ok); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name.padEnd(46)} ${detail}`); };
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
const mb = () => { globalThis.gc?.(); return process.memoryUsage().heapUsed / 1e6; };

console.log('World content at scale: 50,000 markers');
// ---------- 50,000 markers ----------
const entries = [];
for (let k = 0; k < 50000; k++) {
  const at = k < 20000 ? anywhere() : offset(CITIES[k % 20], Math.sqrt(rnd()) * 15, rnd() * 360);
  const it = newItem(['quest', 'poi', 'spawn'][k % 3], { id: `x_${k.toString(36).padStart(6, '0')}`, location: { ...at, alt: 0, heading: Math.floor(rnd() * 360) }, now: '2026-10-04T00:00:00Z', name: `Marker ${k}` });
  if (it.kind === 'quest') it.params.finish = { ...offset(at, 1, 90), alt: 0, heading: 0 };
  entries.push({ draft: it, ...(k % 2 === 0 ? { published: { ...it, status: 'published', publishedAt: '2026-10-04T00:00:00Z' } } : {}) });
}
let t = performance.now();
const imp = await S.importContent({ format: 'world-content', version: 2, entries });
report('50,000 markers in', imp.imported === 50000, `${imp.imported} imported in ${((performance.now() - t) / 1000).toFixed(1)} s (${imp.skipped.length} skipped)`);
await S.flush();

// ---------- nearby queries ----------
for (const [label, where] of [['anywhere', anywhere], ['in the busiest cities', () => offset(CITIES[Math.floor(rnd() * 20)], rnd() * 8, rnd() * 360)]]) {
  for (const km of [1, 3, 10]) {
    const ms = [];
    let found = 0;
    for (let k = 0; k < 300; k++) { const at = where(), a = performance.now(); const r = await S.query({ ...at, km, view: 'published', offered: true }); ms.push(performance.now() - a); found += r.items.length; }
    const p95 = pct(ms, 0.95), max = Math.max(...ms);
    report(`within ${km} km, ${label}`, p95 <= LIMITS.queryP95Ms && max <= LIMITS.queryMaxMs, `p95 ${p95.toFixed(2)} ms, worst ${max.toFixed(2)} ms (limits ${LIMITS.queryP95Ms} / ${LIMITS.queryMaxMs}) · ${(found / 300).toFixed(0)} found on average`);
  }
}

// ---------- flying and driving: the content's work each frame ----------
// (a scene with the markers as the game and the editor draw them; no GPU here — this is the JS side)
async function travel(label, { speed, km, requeryM, radiusKm, view, around }) {
  // (metres round the start: x east, z south)
  const mx = l => (l.lon - around.lon) * Math.cos(around.lat * Math.PI / 180) * 111320, mz = l => -(l.lat - around.lat) * 110540;
  const scene = new THREE.Scene(), M = createMarkers3d({ THREE, parent: scene, place: it => [mx(it.location), it.location.alt, mz(it.location)] });
  const frames = [], dt = 1 / 60, steps = Math.round(km * 1000 / speed / dt), heap0 = mb();
  let at = { ...around }, last = null, heading = 30, heapMid = null, queries = 0, mostDrawn = 0, mostLabels = 0;
  for (let k = 0; k < steps; k++) {
    // (a wandering route through the city and beyond)
    heading += around.loop ? 360 * speed * dt / (2 * Math.PI * around.loop * 1000) : Math.sin(k / 400) * 0.5;
    at = offset(at, speed * dt / 1000, heading);
    const a = performance.now();
    if (!last || distanceKm(last, at) * 1000 > requeryM) { const r = await S.query({ ...at, km: radiusKm, view, limit: 4000 }); M.setItems(r.items.map(x => x.item)); last = at; queries++; }
    M.update({ x: mx(at), y: 30, z: mz(at) });
    frames.push(performance.now() - a);
    mostDrawn = Math.max(mostDrawn, M.stats.drawn); mostLabels = Math.max(mostLabels, M.stats.labels);
    if (k === Math.floor(steps / 4)) heapMid = mb();
  }
  const heap1 = mb(), stats = M.stats, kids = M.group.children.length;
  M.dispose();
  const p95 = pct(frames, 0.95), max = Math.max(...frames);
  report(`${label}: content work a frame`, p95 <= LIMITS.frameP95Ms && max <= LIMITS.frameMaxMs, `p95 ${p95.toFixed(2)} ms, worst ${max.toFixed(2)} ms (limits ${LIMITS.frameP95Ms} / ${LIMITS.frameMaxMs}) over ${frames.length} frames, ${queries} area queries, up to ${mostDrawn} markers and ${mostLabels} labels at once`);
  const s = await S.stats();
  report(`${label}: memory level`, heap1 - heapMid <= LIMITS.heapGrowthMB && s.loadedCells <= LIMITS.loadedCells && kids <= 3 + 16, `heap ${heap0.toFixed(0)} → ${heapMid.toFixed(0)} (a quarter of the way) → ${heap1.toFixed(0)} MB at the end · ${s.loadedCells} cells in memory · at the end ${stats.drawn} markers, ${stats.labels} labels (${kids} objects in the scene: the rest disposed)`);
}
// (the flight: loops round three cities in turn and the empty country between them; the drive: round and
// round a city's busy middle)
await travel('editor camera flying 400 km at 250 m/s', { speed: 250, km: 400, requeryM: 400, radiusKm: 3, view: 'draft', around: { ...CITIES[1], loop: 9 } });
await travel('car driving 40 km at 200 km/h in a city', { speed: 55.6, km: 40, requeryM: 250, radiusKm: 3, view: 'published', around: { ...offset(CITIES[0], 4, 0), loop: 4 } });

// ---------- the worst case: 5,000 crowded within 3 km of the player ----------
{
  const crowd = [], C0 = { lat: 37.7936, lon: -122.3965 };
  for (let k = 0; k < 5000; k++) { const it = newItem('poi', { id: `crowd_${k.toString(36).padStart(5, '0')}`, location: { ...offset(C0, Math.sqrt(rnd()) * 2.9, rnd() * 360), alt: 0, heading: 0 }, now: '2026-10-04T00:00:00Z', name: `Crowd ${k}` }); crowd.push({ draft: it, published: { ...it, status: 'published' } }); }
  await S.importContent({ format: 'world-content', version: 2, entries: crowd });
  const scene = new THREE.Scene(), mx = l => (l.lon - C0.lon) * Math.cos(C0.lat * Math.PI / 180) * 111320, mz = l => -(l.lat - C0.lat) * 110540;
  const M = createMarkers3d({ THREE, parent: scene, place: it => [mx(it.location), 0, mz(it.location)] });
  const a = performance.now(), r = await S.query({ ...C0, km: 3, view: 'published', limit: 4000 }), q = performance.now() - a;
  M.setItems(r.items.map(x => x.item));
  const ms = [];
  for (let k = 0; k < 600; k++) { const b = performance.now(); M.update({ x: Math.sin(k / 50) * 800, y: 20, z: Math.cos(k / 50) * 800 }); ms.push(performance.now() - b); }
  const st = M.stats; M.dispose();
  report('5,000 within 3 km: drawn capped, still quick', pct(ms, 0.95) <= LIMITS.frameP95Ms * 2 && st.drawn <= 1500 && q <= LIMITS.queryMaxMs * 2, `the query ${q.toFixed(1)} ms (${r.items.length} items, the nearest 4,000 kept) · marker update p95 ${pct(ms, 0.95).toFixed(2)} ms · ${st.drawn} drawn (cap 1,500), ${st.labels} labels, ${st.drawCalls} draw calls`);
}

const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed} of ${results.length} passed${failed ? ` — ${failed} failed` : ''}`);
process.exit(failed ? 1 : 0);
