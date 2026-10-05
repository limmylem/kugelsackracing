// Quests at scale (Phase 4 Step 5): 50,000 published quests, each with its own route, on real roads in every
// baked region (data/map/baked.json) — the routes made from each region's road graph (route/suggest.js and
// random drives between junctions, compiled as the editor saves them), the quests rated from them, bunched
// the way real content would be (Monaco: thousands within 3 km). Then, against the performance targets:
//   - the world content service holding them: import, memory, nearby queries in the densest places
//   - the maps (minimap and full map): the quest features built for them when the player moves on
//   - the quest finder (the full map's panel): loading every region's quests, the filters and "Recommended"
//   - the free-roam notice: checked twice a second over everything near
//   - the editor: its area queries over drafts, and "Check everything" (content/bulk.js) over all 100,000 items
//   - free roam at 200 km/h through the densest area with the game's own content layer (play/contentLayer.js:
//     queries, markers, the maps, the quest cards popping up and their routes loading): no frame over budget
//
//   node --expose-gc --max-old-space-size=8192 tests/quest-stress.mjs       (npm run stress:quests)
//   --quests N   fewer quests (a quicker look)

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import * as THREE from 'three';
import { newItem, MARKER_KINDS } from '../content/quests.js';
import { applyTemplate } from '../content/templates.js';
import { contentChecker } from '../content/schema.js';
import { makeRater } from '../content/rating.js';
import { validateAll } from '../content/bulk.js';
import { offset, distanceKm } from '../content/geo.js';
import { createNetwork, DEFAULT_OPTIONS } from '../route/network.js';
import { suggestRoutes } from '../route/suggest.js';
import { newRoute, saveCourse, viewCourse } from '../route/model.js';
import { transverseMercator } from '../map/build/format/projection.js';
import { filterQuests, recommend, createNotifier, defaultFilters, regionOf } from '../quest/finder.js';
import { createMarkers3d } from '../editor/markers3d.js';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname), read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const args = process.argv.slice(2), opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const TOTAL = +(opt('--quests') ?? 50000);
const LIMITS = {
  importS: 120,                                  // 100,000 items in (quests and their routes)
  queryP95Ms: 8, queryMaxMs: 40,                 // the game's "what's near" (3 km, up to 2,000), densest places
  mapsMs: 8,                                     // the maps' quest features, built when the player moves on
  finderMs: 400,                                 // the finder: every quest in every region loaded, filtered, recommended (opening the full map;
                                                 // then kept 20 s) — a menu opening, not a frame in play
  finderFilterMs: 100,                           // a filter changed (the quests already loaded)
  noticeMs: 1,                                   // the notice's check (twice a second)
  editorQueryP95Ms: 15,                          // the editor's area query (drafts, 3 km)
  bulkS: 120,                                    // "Check everything", 100,000 items (a batch the editor runs on request)
  frameP95Ms: 2, frameMaxMs: 12,                 // free roam: the content's work in a frame (of 16.7 ms)
};
const config = read('data/quests.json'), economy = read('data/economy.json'), classes = read('data/classes.json').classes;
const cars = Object.fromEntries(read('data/cars/index.json').cars.map(f => { const c = read(`data/cars/${f}`); return [c.id ?? f.split('/')[0], { name: c.name, class: c.class ?? null }]; }));
const check = contentChecker(read('data/schemas/content-item.schema.json'), { economy, classes, cars }), rate = makeRater({ config, classes });
const results = [], report = (name, ok, detail) => { results.push(ok); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name.padEnd(50)} ${detail}`); };
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
const mb = () => { globalThis.gc?.(); return process.memoryUsage().heapUsed / 1e6; };
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// ---------- the routes: real ones, from every baked region's road graph ----------
// (shares of the 50,000: the busier the region, the more; Monaco small and packed — the densest place)
const SHARE = { sf: 0.36, monaco: 0.1, tokyo: 0.14, stelvio: 0.12, munich: 0.12, mk: 0.16 };
const regions = read('data/map/baked.json').regions, R = {};
let t0 = performance.now();
for (const r of regions) {
  const dir = path.join(ROOT, path.dirname(r.manifest)), manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const P = transverseMercator(manifest.projection.lat0, manifest.projection.lon0);
  const N = createNetwork(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, manifest.files.graph))).toString()), { P, region: r.id, version: manifest.version, bbox: manifest.bbox });
  const pool = [];
  const add = waypoints => {
    const { course, location } = saveCourse(N, { ...newRoute(r.id, 'p2p'), waypoints });
    if (location && course.stats && !course.problems.some(p => p.level === 'error') && course.length > 600 && (course.checkpoints?.length ?? 0) >= 2) pool.push({ course, location });
  };
  // the suggestions (twisty roads), then drives between random junctions of the main road network, 0.8–4 km apart
  for (const s of suggestRoutes(N, { count: 30 })) add(s.waypoints);
  const main = N.mainPart(DEFAULT_OPTIONS), nodes = [];
  for (let k = 0; k < N.nodes.x.length; k++) if ((!main || main[k]) && N.inside(N.nodes.x[k], N.nodes.z[k])) nodes.push(k);
  const ll = k => { const [lat, lon] = P.toLatLon(N.nodes.x[k], N.nodes.z[k]); return { lat, lon }; };
  for (let tries = 0; pool.length < (+opt('--routes') || 120) && tries < 600; tries++) {
    const a = ll(nodes[Math.floor(rnd() * nodes.length)]), b = ll(nodes[Math.floor(rnd() * nodes.length)]), km = distanceKm(a, b);
    if (km < 0.8 || km > 4) continue;
    add([a, b]);
  }
  R[r.id] = { ...r, P, N, pool };
}
const poolSize = Object.values(R).reduce((a, r) => a + r.pool.length, 0);
console.log(`Quests at scale: ${TOTAL.toLocaleString('en-GB')} quests with routes · ${poolSize} real routes made in ${((performance.now() - t0) / 1000).toFixed(1)} s (${Object.values(R).map(r => `${r.id} ${r.pool.length}`).join(', ')})`);

// ---------- 50,000 quests and their routes ----------
// (each quest from one of the editor's templates, in turn: every type but pink slips, rivals or not)
const TEMPLATES = read('data/content/quest-templates.json').templates.filter(t => t.quest.type !== 'pink_slip');
const entries = [], now = '2026-10-05T00:00:00Z', byRegion = {};
let n = 0;
for (const r of Object.values(R)) {
  const count = r.id === regions.at(-1).id ? TOTAL - n : Math.round(TOTAL * SHARE[r.id]);
  byRegion[r.id] = count;
  for (let k = 0; k < count; k++, n++) {
    const src = r.pool[Math.floor(rnd() * r.pool.length)], id = n.toString(36).padStart(6, '0');
    const route = { ...newItem('route', { id: `route_s${id}`, location: src.location, region: r.id, now, name: `Route ${n}` }), course: src.course, location: src.location };
    // (the quest a little way from its route's start: they don't all stack on one spot)
    let at = offset(src.location, rnd() * 0.12, rnd() * 360);
    if (!regionOf(at, [r])) at = { lat: src.location.lat, lon: src.location.lon };
    const q0 = applyTemplate(newItem('quest', { id: `quest_s${id}`, location: { ...at, alt: src.location.alt, heading: src.location.heading }, now }), TEMPLATES[n % TEMPLATES.length], { road: `Road ${n % 97}` });
    const quest = rate({ ...q0, route: route.id }, { route });
    const pub = it => ({ draft: it, published: { ...it, status: 'published', publishedAt: now } });
    entries.push(pub(route), pub(quest));
  }
}
const { createLocalContentService } = await import('../content/service.js');
const { MemoryContentStorage } = await import('../content/storage.js');
// (the stored cells outside the JS heap, as IndexedDB keeps them in the browser: only what the service has
// loaded is on the heap)
class OffHeapStorage extends MemoryContentStorage {
  async getCells(keys) { this.reads += keys.length; return new Map(keys.map(k => [k, this.cells.has(k) ? JSON.parse(this.cells.get(k).toString()) : null])); }
  async putCells(map) { for (const [k, v] of map) { this.writes++; if (v) this.cells.set(k, Buffer.from(JSON.stringify(v))); else this.cells.delete(k); } }
}
const S = createLocalContentService({ storage: new OffHeapStorage(), check, autosaveMs: null });
const heap0 = mb();
t0 = performance.now();
const imp = await S.importContent({ format: 'world-content', version: 3, entries });
if (imp.skipped.length) console.log(`  skipped, e.g.: ${JSON.stringify(imp.skipped.slice(0, 3))}`);
await S.flush();
await S._forget();                      // (as a game starting: everything from storage, loaded as it's asked for)
const importS = (performance.now() - t0) / 1000, made = entries.length;
entries.length = 0;                     // (the service has them now: this copy let go)
// (the heap with everything loaded at once — the worst case: a player who's been everywhere, or the finder,
// which reads every quest; routes' courses kept as text till read: content/service.js)
for (const c of Object.values(R)) { const [w0, s0, e0, n0] = c.bbox; await S.query({ lat: (s0 + n0) / 2, lon: (w0 + e0) / 2, km: 15, view: 'published' }); }
const st0 = await S.stats(), heap1 = mb();
report(`${made.toLocaleString('en-GB')} items in (quests and routes)`, imp.imported === made && importS <= LIMITS.importS,
  `${imp.imported} imported in ${importS.toFixed(1)} s (limit ${LIMITS.importS}), ${imp.skipped.length} skipped · heap ${heap0.toFixed(0)} → ${heap1.toFixed(0)} MB with all ${st0.loadedCells} cells loaded (weight ${st0.loadedWeight}) · ${Object.entries(byRegion).map(([k, v]) => `${k} ${v}`).join(', ')}`);

// the densest place: of 300 quests picked at random, the one with the most others within 1 km
const centres = Object.values(R).map(r => { const [w0, s0, e0, n0] = r.bbox; return { id: r.id, lat: (s0 + n0) / 2, lon: (w0 + e0) / 2 }; });
let densest = null;
const sample = [];
for (const c of centres) sample.push(...(await S.query({ ...c, km: 5, view: 'published', kinds: ['quest'], limit: 5000 })).items.map(x => x.item));
for (let k = 0; k < 300; k++) {
  const q = sample[Math.floor(rnd() * sample.length)], c = { id: regionOf(q.location, regions)?.id, lat: q.location.lat, lon: q.location.lon };
  const r = await S.query({ ...c, km: 1, view: 'published', kinds: ['quest'], limit: 100000 });
  if (!densest || r.items.length > densest.n) densest = { ...c, n: r.items.length };
}
console.log(`  the densest place: ${densest.id} (${densest.n.toLocaleString('en-GB')} quests within 1 km of its middle)`);

// ---------- nearby queries: the game's (3 km, published, switched on, markers) ----------
const near = (c, km) => offset(c, Math.sqrt(rnd()) * km, rnd() * 360);
for (const [label, where] of [['in the densest place', () => near(densest, 1)], ['anywhere in the baked regions', () => near(centres[Math.floor(rnd() * centres.length)], 3)]]) {
  const ms = []; let found = 0;
  for (let k = 0; k < 300; k++) { const at = where(), a = performance.now(); const r = await S.query({ ...at, km: 3, view: 'published', offered: true, kinds: MARKER_KINDS, limit: 2000 }); ms.push(performance.now() - a); found += r.items.length; }
  report(`what's near (3 km), ${label}`, pct(ms, 0.95) <= LIMITS.queryP95Ms && Math.max(...ms) <= LIMITS.queryMaxMs, `p95 ${pct(ms, 0.95).toFixed(2)} ms, worst ${Math.max(...ms).toFixed(2)} ms (limits ${LIMITS.queryP95Ms} / ${LIMITS.queryMaxMs}) · ${(found / 300).toFixed(0)} found on average`);
}

// ---------- the maps: the features for the nearest 2,000 (as play/contentLayer.js toMaps builds them) ----------
const profile = { xp: 2400, money: 40000, quests: {} };
{
  const r = await S.query({ ...densest, km: 3, view: 'published', offered: true, kinds: MARKER_KINDS, limit: 2000 }), items = r.items.map(x => x.item);
  // (a played history: some attempted, some with medals)
  for (const it of items.slice(0, 300)) profile.quests[it.id] = { attempts: 2, completed: rnd() > 0.4, medal: ['gold', 'silver', 'bronze', null][Math.floor(rnd() * 4)] };
  const ms = [];
  for (let k = 0; k < 20; k++) {
    const a = performance.now();
    const features = items.map(it => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [it.location.lon, it.location.lat] }, properties: { id: it.id, kind: it.kind, name: it.name, status: 'published', ...(it.kind === 'quest' ? { state: profile.quests[it.id]?.completed ? 'completed' : profile.quests[it.id]?.attempts ? 'attempted' : 'new', medal: profile.quests[it.id]?.medal ?? null } : {}) } }));
    structuredClone(features);          // (what handing them to the map's worker costs)
    ms.push(performance.now() - a);
  }
  report('the maps: 2,000 quest markers handed over', pct(ms, 0.5) <= LIMITS.mapsMs, `median ${pct(ms, 0.5).toFixed(2)} ms, worst ${Math.max(...ms).toFixed(2)} ms (limit ${LIMITS.mapsMs}), when the player has moved 250 m`);
}

// ---------- the quest finder: every region's quests (the full map's panel) ----------
const car = { className: 'D', rating: 380, kw: 110, kg: 1150 };
{
  const { loadAll } = await import('../play/questFinder.js');
  const ctx = { profile, car, economy, config, at: densest };
  const a = performance.now();
  const all = await loadAll(S, regions);
  const loaded = performance.now() - a, b = performance.now();
  const rec = recommend(all, ctx), shown = filterQuests(all, defaultFilters(), ctx), counts = regions.map(r => all.filter(q => regionOf(q.location, [r])).length);
  const opened = loaded + performance.now() - b;
  const c = performance.now();
  filterQuests(all, { ...defaultFilters(), type: 'drift', stars: '3', car: 'suits my car' }, ctx);
  const filtered = performance.now() - c;
  report('the finder: every quest in every region', all.length === TOTAL && counts.reduce((a, b) => a + b, 0) === TOTAL, `${all.length.toLocaleString('en-GB')} of ${TOTAL.toLocaleString('en-GB')} quests listed (regions: ${regions.map((r, k) => `${r.id} ${counts[k]}`).join(', ')})`);
  report('the finder: opening the full map', opened <= LIMITS.finderMs, `${opened.toFixed(0)} ms (limit ${LIMITS.finderMs}): loaded in ${loaded.toFixed(0)} ms, ${rec.length} recommended, ${shown.length.toLocaleString('en-GB')} shown by the filters`);
  report('the finder: a filter changed', filtered <= LIMITS.finderFilterMs, `${filtered.toFixed(1)} ms (limit ${LIMITS.finderFilterMs})`);
}

// ---------- the free-roam notice ----------
{
  const r = await S.query({ ...densest, km: 3, view: 'published', offered: true, kinds: MARKER_KINDS, limit: 2000 }), items = r.items.map(x => x.item);
  const N = createNotifier({ profile, config }), ms = [];
  let shown = 0;
  for (let k = 0; k < 600; k++) { const a = performance.now(); if (N.check(items, near(densest, 1), k * 0.5)) shown++; ms.push(performance.now() - a); }
  report('the notice: checked twice a second', pct(ms, 0.99) <= LIMITS.noticeMs, `p99 ${pct(ms, 0.99).toFixed(3)} ms (limit ${LIMITS.noticeMs}) over 2,000 near · ${shown} notices in 5 minutes (one at most every ${config.finding?.notice?.everySeconds ?? 45} s)`);
}

// ---------- the editor: area queries over drafts, markers, and checking everything ----------
{
  const ms = [];
  for (let k = 0; k < 100; k++) { const at = near(densest, 2), a = performance.now(); await S.query({ ...at, km: 3, view: 'draft', limit: 4000 }); ms.push(performance.now() - a); }
  report('the editor: area queries (drafts, 3 km)', pct(ms, 0.95) <= LIMITS.editorQueryP95Ms, `p95 ${pct(ms, 0.95).toFixed(2)} ms (limit ${LIMITS.editorQueryP95Ms})`);
  const doc = await S.exportContent({ area: null, views: ['draft', 'published'], as: 'entries' });
  const big = await S.exportContent({});
  report('the editor: exporting everything', big.ok || /export an area at a time/.test(big.error), big.ok ? `${(big.json.length / 1e6).toFixed(0)} MB` : `refused in plain words: "${big.error}"`);
  const a = performance.now(), networks = Object.fromEntries(Object.values(R).map(r => [r.id, r.N]));
  const list = validateAll(doc.entries, { check, rate, networks }), s = (performance.now() - a) / 1000, checked = doc.entries.length;
  doc.entries = null;
  const errors = list.filter(x => x.reasons.some(q => q.level === 'error'));
  report('the editor: "Check everything", every item', s <= LIMITS.bulkS && errors.length === 0, `${checked.toLocaleString('en-GB')} items in ${s.toFixed(1)} s (limit ${LIMITS.bulkS}) · ${list.length} to look at, ${errors.length} with errors${errors.length ? `: ${errors[0].reasons[0].text}` : ''}`);
}

// ---------- free roam at 200 km/h through the densest area, with the game's own content layer ----------
{
  // (the page round it: a do-nothing DOM, fetch from the repository, no IndexedDB — the content service
  // the layer asks is this one)
  const el = () => ({ style: {}, dataset: {}, children: [], addEventListener() {}, appendChild() {}, remove() {}, querySelector: () => null, set innerHTML(v) { this._html = v; } });
  globalThis.document ??= { getElementById: () => null, createElement: el, head: el(), body: el() };
  globalThis.innerWidth ??= 1280; globalThis.innerHeight ??= 720;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async u => typeof u === 'string' && !/^https?:/.test(u) ? new Response(fs.readFileSync(path.join(ROOT, u))) : realFetch(u);
  const client = await import('../content/client.js'), C = await client.worldContent();
  // (the densest region's quests and routes, from the service that has them all)
  const [w0, s0, e0, n0] = R[densest.id].bbox, mid = { lat: (s0 + n0) / 2, lon: (w0 + e0) / 2 };
  const local = await S.exportContent({ area: { ...mid, km: Math.hypot((e0 - w0) * 111 * Math.cos(mid.lat * Math.PI / 180), (n0 - s0) * 111) / 2 + 2 }, views: ['published'], as: 'entries' });
  await C.service.importContent({ format: 'world-content', version: 3, entries: local.entries.map(e => ({ draft: e.published, published: e.published })) });
  local.entries = null;
  await C.service.flush(); await C.service._forget();
  const { createContentLayer } = await import('../play/contentLayer.js');
  const region = R[densest.id], P = region.P, centre = P.toXZ(densest.lat, densest.lon);
  // the questUi's work as a card pops up: its route loaded and drawn on the maps (once a route)
  const courses = new Map(); let cardMs = 0, cards = 0;
  const questCard = it => {
    cards++;
    C.service.get(it.route, { view: 'published' }).then(r => { const a = performance.now(); if (!courses.has(it.route)) { const c = viewCourse(r.item.course, P); courses.set(it.route, c); c.line.map(p => P.toLatLon(p.x, p.z)); } cardMs += performance.now() - a; });
    return true;
  };
  let mapsMs = 0, mapsFeeds = 0;
  const w = { stream: { projection: P, toWorld: (x, z) => [x, z], world: new THREE.Group() }, maps: { setContent(f) { const a = performance.now(); structuredClone(f); mapsMs += performance.now() - a; mapsFeeds++; } } };
  let queryMs = 0;
  { const q = C.service.query; C.service.query = async (...a) => { const t = performance.now(); try { return await q.apply(C.service, a); } finally { queryMs += performance.now() - t; } }; }
  const L = createContentLayer({ THREE, world: w, carNow: () => car, questCard, stateOf: id => ({ state: profile.quests[id] ? 'attempted' : 'new' }), busy: () => false });
  let markMs = 0;
  for (const m of ['setItems', 'update']) { const f = L.markers[m].bind(L.markers); L.markers[m] = (...a) => { const t = performance.now(); try { return f(...a); } finally { markMs += performance.now() - t; } }; }
  const camera = new THREE.PerspectiveCamera();
  const flush = () => new Promise(r => setImmediate(r));
  // (round and round the middle at 200 km/h, wandering in and out: 20 km)
  const speed = 200 / 3.6, dt = 1 / 60, steps = Math.round(20000 / speed / dt), frames = [];
  let heading = 0, radius = 900, x = centre[0] + radius, z = centre[1], worst = null, arrival = 0, heapA = 0;
  for (let k = 0; k < steps; k++) {
    radius = 500 + 700 * (0.5 + 0.5 * Math.sin(k / 900));
    heading += speed * dt / radius;
    x = centre[0] + Math.cos(heading) * radius; z = centre[1] + Math.sin(heading) * radius;
    camera.position.set(x, 4, z);
    const c0 = cardMs, m0 = mapsMs, q0 = queryMs, k0 = markMs, a = performance.now();
    L.frame(dt, [x, 0, z], camera);
    await flush();        // (the queries and route loads answered within the frame: counted in it)
    // (the first second: arriving — the area's content loaded, behind fast travel's loading screen)
    if (k < 60) { arrival += performance.now() - a; if (k === 59) heapA = mb(); continue; }
    frames.push(performance.now() - a);
    if (!worst || frames.at(-1) > worst.ms) worst = { ms: frames.at(-1), card: cardMs - c0, maps: mapsMs - m0, query: queryMs - q0, marks: markMs - k0, k };
  }
  const heapB = mb();
  L.dispose();
  const p95 = pct(frames, 0.95), max = Math.max(...frames);
  report('free roam at 200 km/h, densest area: a frame\'s work', p95 <= LIMITS.frameP95Ms && max <= LIMITS.frameMaxMs,
    `p95 ${p95.toFixed(2)} ms, worst ${max.toFixed(2)} ms (limits ${LIMITS.frameP95Ms} / ${LIMITS.frameMaxMs}; worst frame (${worst.k}): ${worst.query.toFixed(1)} ms the query, ${worst.marks.toFixed(1)} ms the markers, ${worst.card.toFixed(1)} ms a route, ${worst.maps.toFixed(1)} ms the maps) over ${frames.length} frames · ${mapsFeeds} map updates, ${cards} cards, ${courses.size} routes loaded · arriving (the first second, the area's content loaded): ${arrival.toFixed(0)} ms`);
  report('free roam at 200 km/h: memory level', heapB - heapA <= 50, `heap ${heapA.toFixed(0)} → ${heapB.toFixed(0)} MB over 20 km (from a second in)`);
  globalThis.fetch = realFetch;
}

const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed} of ${results.length} passed${failed ? ` — ${failed} failed` : ''}`);
process.exit(failed ? 1 : 0);
