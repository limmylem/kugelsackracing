// The real world's collision, built off the page's thread (a module Web Worker, run by ground.js):
// for each chunk the page wants, the OpenStreetMap roads round it (from the Overpass API, kept in the
// browser's cache so each area is only asked for once), the terrain heights round it (the page samples
// Cesium World Terrain, which only it can reach: asked for here in lattice blocks), then
// surface.js's buildChunk. Chunks are built nearest first, one at a time; the answer goes back with its
// arrays transferred, the road mesh split into pieces the page can add over several frames.
//
// Page → worker: { type: 'want', keys: ['j/i', …] } (nearest first; anything else is dropped),
//                { type: 'blocks', id, blocks: [[key, Float32Array]] }
// Worker → page: { type: 'needBlocks', id, blocks: [[bj, bi]] }, { type: 'built', chunk },
//                { type: 'status', … }

import { OSM_MARGIN, WORK_MARGIN, blocksFor, chunk as chunkOf, chunkAt, chunkSize, latticeSampler, mPerDegLat, mPerDegLon } from './chunks.js';
import { OSM_VERSION, OVERPASS, overpassQuery, readOverpass } from './osm.js';
import { buildChunk } from './surface.js';

const MAX_FETCHES = 1;               // one at a time: the public Overpass server is shared, and blocks
                                     // addresses that ask too much
const CACHE = 'drive-world-osm', CACHE_DAYS = 30;
const PIECES = 4;                    // the road mesh goes back as PIECES × PIECES parts

let wanted = [], building = false, fetching = 0, blockRequest = 0;
const osm = new Map();               // key → Promise of the chunk's roads (and buildings, barriers)
const failures = new Map();          // key → failed attempts at the map data
const blocks = new Map(), blockWaits = new Map();
const done = new Set();              // chunks sent (the page keeps them until it drops them)
const provisional = new Set();       // ...sent without their roads (the map was slow): sent again with them
const PROVISIONAL_AFTER = 15000;     // ms to wait for the map before sending a chunk with just its terrain
const stats = { fetched: 0, cached: 0, built: 0, errors: 0, lastError: null, overpassWait: 0 };

self.onmessage = e => {
  const m = e.data;
  if (m.type === 'want') {
    wanted = m.keys;
    for (const k of m.dropped ?? []) { done.delete(k); provisional.delete(k); partial.delete(k); }
    pump();
  } else if (m.type === 'blocks') {
    for (const [k, heights] of m.blocks) blocks.set(k, heights);
    blockWaits.get(m.id)?.();
    blockWaits.delete(m.id);
  } else if (m.type === 'forget') { done.clear(); provisional.clear(); partial.clear(); }
};
const status = extra => self.postMessage({ type: 'status', ...stats, fetching, building, queue: wanted.filter(k => !done.has(k)).length, ...extra });

// ---------- the map data ----------
const bboxOf = c => {
  const dLat = OSM_MARGIN / mPerDegLat(c.latC), dLon = OSM_MARGIN / mPerDegLon(c.latC);
  return [c.lat0 - dLat, c.lon0 - dLon, c.lat1 + dLat, c.lon1 + dLon];
};
const cacheKey = key => new URL(`/__osm-cache/v${OSM_VERSION}/${key}.json`, self.location.origin).href;
async function fromCache(key) {
  try {
    const hit = await (await caches.open(CACHE)).match(cacheKey(key));
    if (!hit) return null;
    if (Date.now() - +(hit.headers.get('x-fetched') || 0) > CACHE_DAYS * 864e5) return null;
    return await hit.json();
  } catch { return null; }
}
async function toCache(key, text) {
  try { await (await caches.open(CACHE)).put(cacheKey(key), new Response(text, { headers: { 'content-type': 'application/json', 'x-fetched': String(Date.now()) } })); } catch { /* not kept */ }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
// After the server says no (busy, too many requests, or nothing at all: a refusal comes without the
// headers the browser needs to show it, so it's just "failed to fetch"), nothing more is asked until
// overpassFree; the wait doubles each time in a row (10 s … 5 min) and starts again after a success
let overpassFree = 0, refusals = 0;
const backOff = retryAfter => { refusals++; overpassFree = Date.now() + Math.max(retryAfter * 1000 || 0, Math.min(300000, 10000 * 2 ** (refusals - 1))); stats.overpassWait = Math.round((overpassFree - Date.now()) / 1000); };
// (the map is asked for in order: chunks the page wants, nearest first, then the neighbours they're
// built with)
const line = new Map();
const priority = key => { const i = wanted.indexOf(key); if (i >= 0) return i; const j = wanted.findIndex(k => neighbours(k).includes(key)); return j >= 0 ? 1000 + j : 5000; };
const myTurn = key => { let best = null, bp = Infinity; for (const k of line.keys()) { const p = priority(k); if (p < bp) { bp = p; best = k; } } return best === key; };
async function fetchOverpass(key, c) {
  line.set(key, true);
  try { while (fetching >= MAX_FETCHES || Date.now() < overpassFree || !myTurn(key)) await sleep(500); } finally { line.delete(key); }
  fetching++;
  status();
  try {
    const [s, w, n, e] = bboxOf(c), ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 150000);
    let r;
    try { r = await fetch(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: overpassQuery(s, w, n, e) }), signal: ctrl.signal }); }
    catch (err) { backOff(0); throw new Error(`Overpass didn't answer (${err.name === 'AbortError' ? 'timed out' : 'refused'})`); }
    finally { clearTimeout(timer); }
    if (r.status === 429 || r.status >= 500) { backOff(+r.headers.get('retry-after')); throw new Error(`Overpass is busy (${r.status})`); }
    if (!r.ok) throw new Error(`Overpass answered ${r.status}`);
    const text = await r.text(), json = JSON.parse(text);
    if (json.remark && /runtime error|timed out|out of memory/i.test(json.remark)) { backOff(0); throw new Error(`Overpass: ${json.remark}`); }
    refusals = 0; stats.overpassWait = 0;
    stats.fetched++;
    toCache(key, text);
    return json;
  } finally { fetching--; }
}
// The chunk's map data: from the cache, else Overpass (retrying: the public server is often busy)
const asked = new Map();             // key → when its map was first asked for
const got = new Map();               // key → its map data, once it's here
function mapData(key) {
  if (!asked.has(key)) asked.set(key, Date.now());
  if (!osm.has(key)) {
    osm.set(key, (async () => {
      const c = chunkOf(...key.split('/').map(Number));
      const cached = await fromCache(key);
      if (cached) { stats.cached++; return readOverpass(cached); }
      for (let attempt = 0; ; attempt++) {
        try { return readOverpass(await fetchOverpass(key, c)); }
        catch (err) {
          failures.set(key, attempt + 1);
          stats.errors++; stats.lastError = String(err.message || err);
          status();
          if (!wanted.includes(key)) { osm.delete(key); throw err; }
          await sleep(1000);                   // (then it queues behind the server's wait)
        }
      }
    })());
    osm.get(key).then(d => { got.set(key, d); if (got.size > 64) got.delete(got.keys().next().value); }, () => {});
    if (osm.size > 64) osm.delete(osm.keys().next().value);
  }
  return osm.get(key);
}

// ---------- terrain heights (the page samples them) ----------
async function terrainFor(c) {
  const { width, height } = chunkSize(c), m = WORK_MARGIN + 80 + Math.max(width, height) / 2;
  const dLat = m / mPerDegLat(c.latC), dLon = m / mPerDegLon(c.latC);
  const need = blocksFor(c.latC - dLat, c.lonC - dLon, c.latC + dLat, c.lonC + dLon);
  const missing = need.filter(([bj, bi]) => !blocks.has(`${bj}/${bi}`));
  if (missing.length) {
    const id = ++blockRequest;
    await new Promise(resolve => { blockWaits.set(id, resolve); self.postMessage({ type: 'needBlocks', id, blocks: missing }); });
  }
  const mine = new Map(need.map(([bj, bi]) => [`${bj}/${bi}`, blocks.get(`${bj}/${bi}`)]));
  // (keep the lattice from growing without end: the page has its own copy)
  if (blocks.size > 400) for (const k of [...blocks.keys()].slice(0, blocks.size - 300)) if (!mine.has(k)) blocks.delete(k);
  return latticeSampler(mine);
}

// ---------- building, nearest first ----------
// The chunks all round one (edges and corners)
const neighbourCache = new Map();
function neighbours(key) {
  if (!neighbourCache.has(key)) {
    const c = chunkOf(...key.split('/').map(Number)), e = 0.0005, out = new Set();
    for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) {
      const lat = c.lat0 - e + (c.lat1 - c.lat0 + 2 * e) * a / 4, lon = c.lon0 - e + (c.lon1 - c.lon0 + 2 * e) * b / 4;
      out.add(chunkAt(lat, lon).key);
    }
    out.delete(key);
    neighbourCache.set(key, [...out]);
  }
  return neighbourCache.get(key);
}
// Roads from several chunks' map data, each road once
function mergeRoads(datas) {
  const byId = new Map();
  for (const d of datas) for (const r of d.roads) if (!byId.has(r.id)) byId.set(r.id, r);
  return [...byId.values()];
}
const versions = new Map(), partial = new Set();
async function pump() {
  // start the map data coming for the next few in line
  for (const key of wanted.filter(k => !done.has(k)).slice(0, 4)) mapData(key);
  if (building) return;
  const key = wanted.find(k => !done.has(k));
  if (!key) {
    // nothing to build: fetch ahead the neighbours the chunks built so far will want
    for (const k of wanted) for (const n of neighbours(k)) mapData(n);
    status(); return;
  }
  building = true;
  status();
  try {
    // the map, or (if it's slow to come, and this chunk hasn't been sent yet) just the terrain for
    // now, so there's ground: the roads follow when the map arrives
    const patience = Math.max(0, PROVISIONAL_AFTER - (Date.now() - (asked.get(key) ?? Date.now())));
    const data = provisional.has(key) ? await mapData(key) : await Promise.race([mapData(key), sleep(patience).then(() => null)]);
    if (!wanted.includes(key)) return;
    // with the roads from all round it too (so bridges and tunnels that run on into the next chunks
    // come out the same in each)
    const near = neighbours(key), have = near.filter(k => got.has(k)), complete = have.length === near.length;
    const c = chunkOf(...key.split('/').map(Number)), terrain = await terrainFor(c);
    if (!wanted.includes(key)) return;
    const r = buildChunk({ chunk: c, terrain, roads: data ? mergeRoads([data, ...have.map(k => got.get(k))]) : [] });
    done.add(key);
    const version = (versions.get(key) ?? 0) + 1;
    versions.set(key, version);
    if (data) provisional.delete(key);
    else {
      provisional.add(key);
      mapData(key).then(() => { if (provisional.has(key)) { done.delete(key); pump(); } }, () => {});
    }
    // built before all its neighbours' roads were in, with a bridge or tunnel: again when they are
    if (data && !complete && (r.stats.bridges || r.stats.tunnels)) {
      partial.add(key);
      for (const k of near) mapData(k);
      // (only if more of them did come: while the map server's refusing, it stays as it is)
      Promise.allSettled(near.map(k => osm.get(k))).then(() => { if (near.some(k => got.has(k) && !have.includes(k)) && partial.delete(key) && wanted.includes(key)) { done.delete(key); pump(); } });
    } else partial.delete(key);
    stats.built++;
    const parts = splitMesh(r.meshes.roads, r.heightfield.size);
    const transfer = [r.heightfield.heights.buffer, ...parts.flatMap(p => [p.vertices.buffer, p.indices.buffer, p.surfaces.buffer])];
    for (const m of [r.meshes.walls, r.meshes.cover]) if (m.indices.length) transfer.push(m.vertices.buffer, m.indices.buffer);
    self.postMessage({ type: 'built', chunk: { key, version, provisional: !data, partial: partial.has(key), frame: r.frame, heightfield: r.heightfield, roads: parts, walls: r.meshes.walls, cover: r.meshes.cover, surfaces: r.surfaces, stats: r.stats } }, transfer);
  } catch (err) {
    stats.lastError = String(err.message || err);
  } finally {
    building = false;
    status();
    setTimeout(pump, 0);
  }
}

// The road mesh in PIECES × PIECES parts by where each triangle is (so adding one to the physics
// world is a small job)
function splitMesh(mesh, size) {
  const { vertices: v, indices: ix, surfaces: sf } = mesh, cell = size / PIECES, parts = [];
  const bins = Array.from({ length: PIECES * PIECES }, () => []);
  for (let t = 0; t < ix.length / 3; t++) {
    const a = ix[3 * t] * 3, cx = (v[a] + v[ix[3 * t + 1] * 3] + v[ix[3 * t + 2] * 3]) / 3, cz = (v[a + 2] + v[ix[3 * t + 1] * 3 + 2] + v[ix[3 * t + 2] * 3 + 2]) / 3;
    const bx = Math.max(0, Math.min(PIECES - 1, Math.floor((cx + size / 2) / cell))), bz = Math.max(0, Math.min(PIECES - 1, Math.floor((cz + size / 2) / cell)));
    bins[bz * PIECES + bx].push(t);
  }
  for (const tris of bins) {
    if (!tris.length) continue;
    const map = new Map(), verts = [], idx = new Uint32Array(tris.length * 3), surfaces = new Uint8Array(tris.length);
    tris.forEach((t, k) => {
      surfaces[k] = sf[t];
      for (let j = 0; j < 3; j++) {
        const old = ix[3 * t + j];
        let nv = map.get(old);
        if (nv === undefined) { nv = verts.length / 3; map.set(old, nv); verts.push(v[old * 3], v[old * 3 + 1], v[old * 3 + 2]); }
        idx[3 * k + j] = nv;
      }
    });
    parts.push({ vertices: Float32Array.from(verts), indices: idx, surfaces });
  }
  return parts;
}
