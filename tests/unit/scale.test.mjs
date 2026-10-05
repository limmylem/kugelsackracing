// Phase 4 Step 5 at scale: the content service's nearest-first query (a quickselect when there are far more
// than asked for) gives exactly what sorting everything would; checking everything works on the items
// without one giant JSON string; and routes stay on the baked map — the road graph reaches past its edge,
// so a route past it is an error, and route suggestions never go there.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { newItem } from '../../content/quests.js';
import { createLocalContentService } from '../../content/service.js';
import { MemoryContentStorage } from '../../content/storage.js';
import { offset } from '../../content/geo.js';
import { createNetwork, DEFAULT_OPTIONS } from '../../route/network.js';
import { newRoute, saveCourse, viewCourse } from '../../route/model.js';
import { suggestRoutes } from '../../route/suggest.js';
import { transverseMercator } from '../../map/build/format/projection.js';
import { termsOf, filterQuests, defaultFilters } from '../../quest/finder.js';

const json = f => JSON.parse(fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'));
const check = Object.assign(() => [], { shape: () => [] });
let seed = 9; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

test('the nearest-first query: with a limit far under what\'s there, exactly the nearest, in order', async () => {
  const S = createLocalContentService({ storage: new MemoryContentStorage(), check, autosaveMs: null }), C0 = { lat: 43.74, lon: 7.42 }, entries = [];
  for (let k = 0; k < 3000; k++) { const it = newItem(k % 3 ? 'quest' : 'poi', { id: `x_${k}`, location: { ...offset(C0, Math.sqrt(rnd()) * 2.5, rnd() * 360), alt: 0, heading: 0 }, now: '2026-10-05T00:00:00Z' }); entries.push({ draft: it, published: { ...it, status: 'published' } }); }
  await S.importContent({ format: 'world-content', version: 3, entries });
  for (const [km, limit] of [[3, 200], [3, 1], [1, 50], [3, 5000], [0.2, 10]]) {
    const all = (await S.query({ ...C0, km, view: 'published' })).items, some = (await S.query({ ...C0, km, view: 'published', limit })).items;
    assert.deepEqual(some.map(x => x.item.id), all.slice(0, limit).map(x => x.item.id), `${km} km, ${limit}`);
    for (let i = 1; i < some.length; i++) assert.ok(some[i].km >= some[i - 1].km);
  }
  assert.deepEqual((await S.query({ ...C0, km: 3, view: 'published', limit: 0 })).items, []);
  // checking everything: the items as they are, the same as the export's
  const a = await S.exportContent({ as: 'entries' }), b = JSON.parse((await S.exportContent({})).json);
  assert.equal(a.count, 3000);
  assert.deepEqual(a.entries, b.entries);
});

test('memory stays bounded however content bunches up: cells kept by weight (a route ~20 markers), the request\'s own always', async () => {
  const S = createLocalContentService({ storage: new MemoryContentStorage(), check, autosaveMs: null, maxWeight: 3000 }), entries = [];
  // four packed places 30 km apart, each 400 quests with their routes: 8,400 weight each
  const places = [0, 1, 2, 3].map(k => offset({ lat: 46.5, lon: 10.4 }, 30 * k, 90));
  for (const [p, at] of places.entries()) for (let k = 0; k < 400; k++) {
    const loc = { ...offset(at, rnd() * 1.5, rnd() * 360), alt: 0, heading: 0 };
    const r = newItem('route', { id: `route_w${p}_${k}`, location: loc, now: '2026-10-05T00:00:00Z', region: 'stelvio' }), q = newItem('quest', { id: `quest_w${p}_${k}`, location: loc, now: '2026-10-05T00:00:00Z' });
    q.route = r.id; entries.push({ draft: q, published: { ...q, status: 'published' } }, { draft: r, published: { ...r, status: 'published' } });
  }
  await S.importContent({ format: 'world-content', version: 3, entries });
  await S.flush();
  await S._forget();
  for (let round = 0; round < 3; round++) for (const at of places) {
    const r = await S.query({ ...at, km: 3, view: 'published', kinds: ['quest'] });
    assert.equal(r.items.length, 400, 'every quest there, whatever was let go before');
    const st = await S.stats();
    // (what this query needed stays, even past the budget; nothing else does)
    assert.ok(st.loadedWeight <= 3000 + 8400 + 100, `${st.loadedWeight} held after a query at place ${places.indexOf(at)}`);
  }
  // exporting everything a cell at a time: all of it, the budget kept as it goes
  const ex = await S.exportContent({ as: 'entries' });
  assert.equal(ex.count, 3200);
  assert.ok((await S.stats()).loadedWeight <= 3000 + 8400 + 100);
});

test('a route as loaded keeps its course as text until read: the same when read, written out or cloned', async () => {
  const S = createLocalContentService({ storage: new MemoryContentStorage(), check, autosaveMs: null }), loc = { lat: 46.53, lon: 10.45, alt: 0, heading: 0 };
  const r = newItem('route', { id: 'route_lazy0001', location: loc, now: '2026-10-05T00:00:00Z', region: 'stelvio' });
  r.course = { ...r.course, path: 'abc'.repeat(500), length: 1234, stats: { length: 1234, maxGrade: 7 }, roadData: [{ key: 'x', n: 3 }] };
  await S.importContent({ format: 'world-content', version: 3, entries: [{ draft: r, published: { ...r, status: 'published' } }] });
  await S.flush(); await S._forget();
  const [hit] = (await S.query({ ...loc, km: 1, view: 'published' })).items, it = hit.item;
  // (written out — as JSON, and as IndexedDB clones it — without anything having read it)
  assert.deepEqual(JSON.parse(JSON.stringify(it)).course, r.course);
  assert.deepEqual(structuredClone(it).course, r.course);
  assert.equal(it.course.length, 1234);
  assert.equal(it.course, it.course, 'parsed once');
  assert.deepEqual((await S.get('route_lazy0001', { view: 'published' })).item.course, r.course);
  // changed through the service: the new course, kept and loaded again
  const u = await S.update('route_lazy0001', { ...(await S.get('route_lazy0001')).item, course: { ...r.course, length: 999 } });
  assert.ok(u.ok, u.error);
  await S.flush(); await S._forget();
  assert.equal((await S.get('route_lazy0001')).item.course.length, 999);
});

test('the finder works its quests\' terms out once each, and lists them nearest first', () => {
  const economy = json('data/economy.json'), config = json('data/quests.json'), at = { lat: 37.79, lon: -122.4 };
  const quests = Array.from({ length: 400 }, (_, k) => { const q = newItem('quest', { id: `quest_t${k}`, location: { ...offset(at, rnd() * 20, rnd() * 360), alt: 0, heading: 0 } }); q.rating = { stars: 1 + k % 5, km: 2 }; return q; });
  const t = termsOf(quests[0], economy);
  assert.equal(termsOf(quests[0], economy), t, 'the same object: worked out once');
  const list = filterQuests(quests, defaultFilters(), { profile: { quests: {} }, car: null, economy, config, at });
  assert.equal(list.length, 400);
  for (let i = 1; i < list.length; i++) assert.ok(list[i].km >= list[i - 1].km);
});

test('routes stay on the baked map: past its edge is an error; suggestions only on it', () => {
  const m = json('assets/map/monaco/manifest.json'), P = transverseMercator(m.projection.lat0, m.projection.lon0);
  const G = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL(`../../assets/map/monaco/${m.files.graph}`, import.meta.url))).toString());
  const N = createNetwork(G, { P, region: 'monaco', version: m.version, bbox: m.bbox }), open = createNetwork(JSON.parse(JSON.stringify(G)), { P, region: 'monaco', version: m.version });
  // (the graph does reach past the edge)
  let outside = 0;
  for (let k = 0; k < N.nodes.x.length; k++) if (!N.inside(N.nodes.x[k], N.nodes.z[k])) outside++;
  assert.ok(outside > 100, `${outside} junctions past the edge`);
  // inside: as before
  const inner = saveCourse(N, { ...newRoute('monaco', 'p2p'), waypoints: [{ lat: 43.7395, lon: 7.4275 }, { lat: 43.7433, lon: 7.4298 }] });
  assert.ok(!inner.course.problems.some(p => /edge of the baked map/.test(p.message)));
  // out to a junction past the edge: an error, with how far — and without the bbox, no such check
  const main = N.mainPart(DEFAULT_OPTIONS);
  let far = null;
  for (let k = 0; k < N.nodes.x.length && !far; k++) if (main[k] && !N.inside(N.nodes.x[k], N.nodes.z[k])) { const [lat, lon] = P.toLatLon(N.nodes.x[k], N.nodes.z[k]); const c = saveCourse(N, { ...newRoute('monaco', 'p2p'), waypoints: [{ lat: 43.7395, lon: 7.4275 }, { lat, lon }] }); if (c.course.length > 0) far = { lat, lon, c }; }
  const err = far.c.course.problems.find(p => /edge of the baked map/.test(p.message));
  assert.ok(err && err.level === 'error', JSON.stringify(far.c.course.problems));
  assert.ok(!saveCourse(open, { ...newRoute('monaco', 'p2p'), waypoints: [{ lat: 43.7395, lon: 7.4275 }, far] }).course.problems.some(p => /edge of the baked map/.test(p.message)));
  // the fast check inside agrees with the exact one, everywhere
  for (let k = 0; k < 2000; k++) { const x = (rnd() - 0.5) * 6000, z = (rnd() - 0.5) * 6000, [lat, lon] = P.toLatLon(x, z); assert.equal(N.inside(x, z), lon >= m.bbox[0] && lon <= m.bbox[2] && lat >= m.bbox[1] && lat <= m.bbox[3], `${x}, ${z}`); }
  // suggestions: every point of every one on the map
  for (const s of suggestRoutes(N, { count: 8 })) for (const p of s.line) assert.ok(N.inside(p.x, p.z));
  // and the course as the game views it: the racing line worked out only when asked for
  const v = viewCourse(inner.course, P);
  assert.ok(Object.keys(v).includes('racing') && v.racing.points?.length > 0);
});
