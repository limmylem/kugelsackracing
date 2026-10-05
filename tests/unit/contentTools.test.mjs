// Phase 4 Step 5: the content tools — quest templates, route suggestions from a road graph, and bulk
// validation after a rebake or a rules change.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { newItem, TYPES, problems } from '../../content/quests.js';
import { applyTemplate } from '../../content/templates.js';
import { contentChecker } from '../../content/schema.js';
import { makeRater } from '../../content/rating.js';
import { validateAll } from '../../content/bulk.js';
import { createNetwork } from '../../route/network.js';
import { suggestRoutes } from '../../route/suggest.js';
import { routeStats } from '../../route/stats.js';
import { resample, encodeLine } from '../../route/geometry.js';

const json = p => JSON.parse(fs.readFileSync(new URL(`../../${p}`, import.meta.url)));
const config = json('data/quests.json'), economy = json('data/economy.json'), classes = json('data/classes.json').classes, T = json('data/content/quest-templates.json').templates;
const check = contentChecker(json('data/schemas/content-item.schema.json'), { economy, classes, cars: {} }), rate = makeRater({ config, classes });
const SF = { lat: 37.7936, lon: -122.3965 };

test('quest templates: every one makes a valid quest of its type, named for its road, with no money in it', () => {
  assert.ok(T.length >= 6);
  for (const t of T) {
    const q = applyTemplate(newItem('quest', { id: 'quest_tmpl0001', location: SF }), t, { road: 'Conzelman Road' });
    assert.equal(q.type, t.quest.type ?? 'sprint', t.id);
    assert.deepEqual(check.shape(q), [], t.id);
    if (t.quest.name?.includes('{road}')) assert.match(q.name, /Conzelman Road/);
    if (t.quest.npc) assert.deepEqual(q.npc, t.quest.npc);
    assert.equal(q.fee, undefined); assert.equal(q.rewards, undefined);
    // what's left for the author is the route (and anything the type can't know)
    const errors = problems(q, { economy, classes }).filter(p => p.level === 'error').map(p => p.field);
    assert.ok(errors.every(f => ['params.finish', 'params.destination', 'route', 'params.opponentCar', 'params.checkpoints'].includes(f)), `${t.id}: ${errors}`);
  }
  assert.throws(() => applyTemplate(newItem('quest', { id: 'quest_tmpl0002', location: SF }), { id: 'bad', quest: { type: 'hovercraft' } }));
});

// a made-up region: a long twisty road up a hill (few junctions), and a grid of straight streets
function region() {
  const nodes = { osm: [], lat: [], lon: [], x: [], z: [], h: [] }, segs = [];
  const node = (x, z, h = 0) => { nodes.osm.push(nodes.x.length + 1); nodes.lat.push(0); nodes.lon.push(0); nodes.x.push(x); nodes.z.push(z); nodes.h.push(h); return nodes.x.length - 1; };
  const seg = (from, to, pts, extra = {}) => segs.push({ id: segs.length, from, to, way: 1000 + segs.length, name: extra.name ?? null, class: extra.class ?? 'residential', rank: 4, link: false, lanes: 2, oneway: 0, maxspeed: null, width: extra.width ?? 7, structure: 'ground', layer: 0, surface: 'asphalt', points: pts.flat(), osm: [] });
  // the twisty road: switchbacks, 600 m legs, cut into pieces at a few junctions
  let prev = node(0, 0, 0), x = 0, z = 0, h = 0, dir = 1;
  for (let leg = 0; leg < 8; leg++) {
    const pts = [[x, z, h]];
    for (let d = 20; d <= 600; d += 20) pts.push([x + dir * d, z + 30 * Math.sin(d / 60), h + d * 0.05]);
    x += dir * 600; h += 30;
    for (let a = Math.PI / 8; a <= Math.PI; a += Math.PI / 8) pts.push([x + dir * 15 * Math.sin(a), z + 15 - 15 * Math.cos(a), h]);
    z += 30; dir = -dir;
    const next = node(pts.at(-1)[0], pts.at(-1)[1], pts.at(-1)[2]);
    seg(prev, next, pts, { name: 'Hill Road' });
    prev = next;
  }
  // the grid: 200 m blocks, straight, a junction at every corner
  const g = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) g.push(node(5000 + i * 200, j * 200));
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    const a = g[i * 6 + j];
    if (i < 5) seg(a, g[(i + 1) * 6 + j], [[5000 + i * 200, j * 200, 0], [5200 + i * 200, j * 200, 0]], { name: `Street ${j}` });
    if (j < 5) seg(a, g[i * 6 + j + 1], [[5000 + i * 200, j * 200, 0], [5000 + i * 200, j * 200 + 200, 0]], { name: `Avenue ${i}` });
  }
  // (the hill road reached from the grid, as a real region's roads are joined up: both ends)
  seg(g[0], 0, [[5000, 0, 0], [0, 0, 0]], { name: 'Link Road', class: 'tertiary' });
  seg(prev, g[5], [[nodes.x[prev], nodes.z[prev], nodes.h[prev]], [5000, 1000, 0]], { name: 'Top Road', class: 'tertiary' });
  return { version: 1, region: 'test', nodes, segs };
}

test('route suggestions: twisty roads with few junctions ranked first, a good length, never overlapping, with waypoints', () => {
  const N = createNetwork(region(), { P: { toLatLon: (x, z) => [-z / 1e5, x / 1e5], toXZ: (lat, lon) => [lon * 1e5, -lat * 1e5] }, region: 'test', version: 1 });
  const S = suggestRoutes(N, { count: 5, minKm: 1.5, maxKm: 6 });
  assert.ok(S.length >= 1);
  assert.equal(S[0].roads[0], 'Hill Road', 'the hill road first');
  assert.ok(S[0].features.hairpins >= 2 && S[0].km >= 1.5 && S[0].km <= 6.7);
  for (const s of S) { assert.ok(s.waypoints.length >= 2); assert.ok(s.why.length); }
  for (let i = 1; i < S.length; i++) assert.ok(S[i].score <= S[i - 1].score);
  // (a grid of straight streets, if suggested at all, scores below the hill)
  const grid = S.filter(s => s.roads.some(r => /Street|Avenue/.test(r)));
  for (const s of grid) assert.ok(s.score < S[0].score);
});

test('bulk validation: what a rebake or a rules change leaves needing a look, with the reasons', () => {
  const t = '2026-10-01T00:00:00.000Z';
  const line = resample([{ x: 0, z: 0, h: 0, w: 8 }, { x: 3000, z: 0, h: 0, w: 8 }], 4);
  const path = encodeLine(line.map(p => ({ lat: -p.z / 1e5, lon: p.x / 1e5, h: 0, w: 8 })));
  const route = { ...newItem('route', { id: 'route_bulk0001', location: SF, region: 'test', now: t }), name: 'Bulk route' };
  route.course = { ...route.course, path, length: 3000, stats: routeStats(line), roadData: { region: 'test', version: 1, segments: [{ key: '1:1:2', length: 3000, name: 'Gone Road' }] } };
  const quest = { ...newItem('quest', { id: 'quest_bulk0001', location: SF, now: t }), route: route.id, name: 'Bulk quest', rating: { stars: 5, km: 9 } };
  const orphan = { ...newItem('quest', { id: 'quest_bulk0002', location: SF, now: t }), route: 'route_gone0001', name: 'Orphan quest' };
  const series = { ...newItem('series', { id: 'series_bulk0001', location: SF, now: t }), name: 'Bulk series', quests: [quest.id, orphan.id, 'quest_gone0001'] };
  const fine = { ...newItem('poi', { id: 'poi_bulk0001', location: SF, now: t }), name: 'A view' };
  const entries = [route, quest, orphan, series, fine].map(it => ({ draft: { ...it, status: 'published', publishedAt: t }, published: { ...it, status: 'published', publishedAt: t }, archived: null }));
  const N = createNetwork({ version: 2, region: 'test', nodes: { osm: [], lat: [], lon: [], x: [], z: [], h: [] }, segs: [] }, { region: 'test', version: 2 });
  const out = validateAll(entries, { check, rate, networks: { test: N } }), by = Object.fromEntries(out.map(x => [x.id, x]));
  assert.ok(!by[fine.id], 'nothing to say about the point of interest');
  assert.match(by[route.id].reasons.map(r => r.text).join(' '), /roads under it changed when the map was baked again \(1 gone/);
  assert.match(by[quest.id].reasons.map(r => r.text).join(' '), /rating is out of date \(5★ 9 km → \d★ 3 km\)/);
  assert.match(by[orphan.id].reasons.map(r => r.text).join(' '), /route "route_gone0001" is gone/);
  assert.match(by[series.id].reasons.map(r => r.text).join(' '), /quest "quest_gone0001" is gone/);
  assert.ok(out.findIndex(x => x.id === route.id) < out.length, 'errors first');
  // a region not loaded: said so, not guessed
  assert.match(validateAll(entries, { check, rate, networks: {} }).find(x => x.id === route.id).reasons.map(r => r.text).join(' '), /isn't loaded here/);
});
