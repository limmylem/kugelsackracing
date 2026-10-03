// Bakes a region of the world into static files (WORLD_README.md): its map features
// (tools/world/features.mjs) and elevation (tools/world/dem.mjs) turned, tile by 512 m tile, into
// everything the game draws and collides with (tools/world/bakeTile.mjs → world/tileFormat.js), and a
// manifest listing the tiles. The game only ever downloads these: nothing is fetched from a map server,
// no terrain is built and no building extruded while you play.
//
//   npm run world:bake -- --region sf                       the whole region
//   npm run world:bake -- --region sf --area 37.7942,-122.3954,2   a 2 km square round a place (a slice)
//   npm run world:bake -- --region sf --workers 4           tiles baked in parallel (default: cores − 1)
//
// Output: assets/world/<region>/manifest.json and assets/world/<region>/tiles/<i>_<j>.dwt. Tiles
// already baked with the same inputs are kept (--force bakes them all again).

import fs from 'node:fs';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { MeshoptEncoder } from 'meshoptimizer';
import { collectFeatures } from './features.mjs';
import { openDem, GLO30 } from './dem.mjs';
import { bakeTile, BAKE_VERSION } from './bakeTile.mjs';
import { bakeFar, FAR } from './bakeFar.mjs';
import { projection } from '../../world/projection.js';
import { encodeTile, FORMAT_VERSION } from '../../world/tileFormat.js';
import { simplify } from './tiler.mjs';
import { ATTRIBUTION } from '../../world/attribution.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));

// ---------- the features, on the region's frame, findable by place ----------
export function indexFeatures(features, P, limit = null) {
  const G = 256, cells = new Map(), out = [];
  // (cells only over the region: the ocean, a county reach far beyond it)
  const L = limit ?? [-Infinity, -Infinity, Infinity, Infinity], clampA = (v, k) => Math.floor(Math.max(L[k], Math.min(L[k + 2], v)) / G);
  const proj = c => P.toXZ(c[1], c[0]);
  for (const f of features) {
    const g = f.geometry;
    let xy, type;
    if (g.type === 'Point') { xy = proj(g.coordinates); type = 'point'; }
    else if (g.type === 'LineString') { xy = [g.coordinates.map(proj)]; type = 'line'; }
    else if (g.type === 'MultiLineString') { xy = g.coordinates.map(l => l.map(proj)); type = 'line'; }
    else if (g.type === 'Polygon') { xy = g.coordinates.map(r => r.map(proj)); type = 'area'; }
    else if (g.type === 'MultiPolygon') { xy = g.coordinates.map(p => p.map(r => r.map(proj))); type = 'area'; }
    else continue;
    const pts = type === 'point' ? [xy] : g.type === 'MultiPolygon' ? xy.flat(2) : xy.flat();
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    const e = { ...f, xy, type, bbox: [x0, z0, x1, z1] }, k = out.push(e) - 1;
    if (x1 < L[0] || x0 > L[2] || z1 < L[1] || z0 > L[3]) continue;
    for (let a = clampA(x0, 0); a <= clampA(x1, 0); a++) for (let b = clampA(z0, 1); b <= clampA(z1, 1); b++) { const key = `${a},${b}`; (cells.get(key) ?? cells.set(key, []).get(key)).push(k); }
  }
  return {
    count: out.length,
    query(x0, z0, x1, z1) {
      const seen = new Set(), res = [];
      for (let a = clampA(x0, 0); a <= clampA(x1, 0); a++) for (let b = clampA(z0, 1); b <= clampA(z1, 1); b++) for (const k of cells.get(`${a},${b}`) ?? []) {
        if (seen.has(k)) continue; seen.add(k);
        const f = out[k];
        if (f.bbox[2] >= x0 && f.bbox[0] <= x1 && f.bbox[3] >= z0 && f.bbox[1] <= z1) res.push(f);
      }
      return res;
    },
  };
}

// The region's frame: its origin (from its config, or the middle of its box)
export const originOf = region => region.origin ?? [+((region.bbox[1] + region.bbox[3]) / 2).toFixed(4), +((region.bbox[0] + region.bbox[2]) / 2).toFixed(4)];

async function context(regionId) {
  const region = readJson(`data/world/regions/${regionId}.json`), cfg = readJson('data/world/bake.json');
  const [lat0, lon0] = originOf(region), P = projection(lat0, lon0);
  const cacheDir = path.join(root, '.cache/world');
  const { features } = await collectFeatures({ region, bbox: region.bbox, release: region.sources.overture.release, osmFile: region.sources.osm?.pbf ?? null, cacheDir, root, log: () => {} });
  const [ax, az1] = P.toXZ(region.bbox[1], region.bbox[0]), [ax1, az] = P.toXZ(region.bbox[3], region.bbox[2]), m = 2000;
  const index = indexFeatures(features, P, [ax - m, az - m, ax1 + m, az1 + m]);
  const dem = await openDem(region.dem ?? {}, { cacheDir, bbox: [region.bbox[1], region.bbox[0], region.bbox[3], region.bbox[2]] });
  return { region, cfg, P, index, dem };
}

async function bakeOne(ctx, i, j, outDir) {
  await MeshoptEncoder.ready;
  const tile = await bakeTile({ i, j, P: ctx.P, index: ctx.index, dem: ctx.dem, cfg: ctx.cfg, regionId: ctx.region.id });
  const bytes = zlib.gzipSync(encodeTile(tile, MeshoptEncoder), { level: 9 });
  fs.writeFileSync(path.join(outDir, `${i}_${j}.dwt`), bytes);
  return { i, j, bytes: bytes.length, dem: tile.header.dem, stats: tile.header.stats, landmarks: tile.header.landmarks, names: tile.header.names.length };
}

if (!isMainThread) {
  // a worker: its own copy of everything, then tiles as they're handed out
  const ctx = await context(workerData.region);
  parentPort.on('message', async m => {
    if (m === 'done') process.exit(0);
    try { parentPort.postMessage({ ok: true, result: await bakeOne(ctx, m.i, m.j, workerData.outDir) }); }
    catch (e) { parentPort.postMessage({ ok: false, i: m.i, j: m.j, error: e.stack ?? String(e) }); }
  });
  parentPort.postMessage({ ready: true });
} else if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2), opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const regionId = opt('--region') ?? 'sf', force = args.includes('--force');
  const region = readJson(`data/world/regions/${regionId}.json`), cfg = readJson('data/world/bake.json');
  const T = cfg.tileSize, [lat0, lon0] = originOf(region), P = projection(lat0, lon0);
  const outDir = path.join(root, 'assets/world', regionId, 'tiles'), manifestFile = path.join(root, 'assets/world', regionId, 'manifest.json');
  fs.mkdirSync(outDir, { recursive: true });
  const t0 = performance.now();
  // which tiles: the whole region, or a square round a place
  let box;
  if (opt('--area')) { const [la, lo, km] = opt('--area').split(',').map(Number), [x, z] = P.toXZ(la, lo), h = km * 500; box = [x - h, z - h, x + h, z + h]; }
  else { const [x0, z1] = P.toXZ(region.bbox[1], region.bbox[0]), [x1, z0] = P.toXZ(region.bbox[3], region.bbox[2]); box = [x0, z0, x1, z1]; }
  const want = [];
  for (let j = Math.floor(box[1] / T); j < Math.ceil(box[3] / T); j++) for (let i = Math.floor(box[0] / T); i < Math.ceil(box[2] / T); i++) want.push([i, j]);
  // (nearest the spawn first: a slice is drivable soonest)
  const [sx, sz] = P.toXZ(region.spawn.lat, region.spawn.lon);
  want.sort((a, b) => Math.hypot((a[0] + 0.5) * T - sx, (a[1] + 0.5) * T - sz) - Math.hypot((b[0] + 0.5) * T - sx, (b[1] + 0.5) * T - sz));
  const old = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null;
  const inputs = `${BAKE_VERSION}/${FORMAT_VERSION}/${cfg.version}/${region.sources.overture.release}`;
  const keep = new Map((old?.inputs === inputs ? old.tiles : []).filter(t => fs.existsSync(path.join(outDir, `${t.i}_${t.j}.dwt`))).map(t => [`${t.i}_${t.j}`, t]));
  const todo = want.filter(([i, j]) => force || !keep.has(`${i}_${j}`));
  console.log(`Baking ${region.name}: ${want.length} tiles (${todo.length} to bake), ${T} m each`);
  console.log('  gathering features and elevation…');
  const workers = Math.max(1, Math.min(todo.length, +(opt('--workers') ?? Math.max(1, os.cpus().length - 1))));
  const results = [];
  if (todo.length) {
    const queue = todo.slice(), pool = [];
    await new Promise((resolve, reject) => {
      let live = workers;
      for (let w = 0; w < workers; w++) {
        const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { region: regionId, outDir }, resourceLimits: { maxOldGenerationSizeMb: 6144 } });
        pool.push(worker);
        const next = () => { const t = queue.shift(); if (t) worker.postMessage({ i: t[0], j: t[1] }); else { worker.postMessage('done'); if (--live === 0) resolve(); } };
        worker.on('message', m => {
          if (m.ready) return next();
          if (!m.ok) { console.error(`  tile ${m.i}_${m.j} failed: ${m.error}`); results.push({ i: m.i, j: m.j, failed: true }); return next(); }
          results.push(m.result);
          const r = m.result;
          console.log(`  ${String(results.length).padStart(4)}/${todo.length}  tile ${r.i}_${r.j}: ${(r.bytes / 1024).toFixed(0)} kB, ${r.stats.roads} roads, ${r.stats.buildings} buildings, ${r.stats.trees} trees, ${Object.values(r.stats.barriers).reduce((a, b) => a + b, 0)} railing pieces (${(r.stats.ms / 1000).toFixed(1)} s)`);
          next();
        });
        worker.on('error', reject);
      }
    });
  }
  let ctxMain = null;
  const getCtx = async () => ctxMain ??= await context(regionId);
  // the far world: the whole region, for the distance (unless --no-far)
  let far = old?.inputs === inputs ? old.far ?? null : null;
  if (!args.includes('--no-far') && (!far || force || args.includes('--far'))) {
    console.log('  the far world (the whole region, coarse)…');
    const t1 = performance.now(), ctx = await getCtx();
    await MeshoptEncoder.ready;
    const [ax, az1] = P.toXZ(region.bbox[1], region.bbox[0]), [ax1, az] = P.toXZ(region.bbox[3], region.bbox[2]);
    const chunks = await bakeFar({ P, index: ctx.index, dem: ctx.dem, cfg, region, bounds: [ax, az, ax1, az1] });
    far = { size: FAR.chunk, chunks: chunks.map(c => { const bytes = zlib.gzipSync(encodeTile(c.tile, MeshoptEncoder), { level: 9 }); fs.writeFileSync(path.join(outDir, `far_${c.a}_${c.b}.dwt`), bytes); return { a: c.a, b: c.b, bytes: bytes.length, landmarks: c.tile.header.landmarks.length }; }) };
    console.log(`  far: ${far.chunks.length} chunks, ${(far.chunks.reduce((a, c) => a + c.bytes, 0) / 1e6).toFixed(1)} MB, ${far.chunks.reduce((a, c) => a + c.landmarks, 0)} landmarks (${((performance.now() - t1) / 1000).toFixed(0)} s)`);
  }
  // the places a driver knows by name (the HUD's suburb and town): their outlines, simplified
  const ctx = await getCtx(), places = [];
  for (const f of ctx.index.query(...(() => { const [ax, az1] = P.toXZ(region.bbox[1], region.bbox[0]), [ax1, az] = P.toXZ(region.bbox[3], region.bbox[2]); return [ax, az, ax1, az1]; })())) {
    if (f.layer !== 'places') continue;
    if (f.geometry.type === 'Point') { places.push({ name: f.props.n, kind: f.props.k, point: f.xy.map(v => Math.round(v)) }); continue; }
    const polys = (f.geometry.type === 'Polygon' ? [f.xy] : f.xy).map(p => simplify(p[0], 12).map(([x, z]) => [Math.round(x), Math.round(z)])).filter(r => r.length >= 3);
    if (polys.length) places.push({ name: f.props.n, kind: f.props.k, rings: polys });
  }
  const spots = (region.spots ?? []).map(sp => ({ ...sp, xz: P.toXZ(sp.lat, sp.lon).map(v => +v.toFixed(1)) }));
  const failed = results.filter(r => r.failed);
  const tiles = [...keep.values(), ...results.filter(r => !r.failed)].filter((t, k, a) => a.findIndex(u => u.i === t.i && u.j === t.j) === k).sort((a, b) => a.j - b.j || a.i - b.i);
  const dem = (await openDem(region.dem ?? {}, { cacheDir: path.join(root, '.cache/world'), bbox: [region.bbox[1], region.bbox[0], region.bbox[3], region.bbox[2]] })).describe();
  const manifest = {
    _note: 'A baked region of the world (npm run world:bake; WORLD_README.md): its frame (origin, projection), its tiles and what made them. The game reads this first.',
    region: regionId, name: region.name, version: `${inputs}/${new Date().toISOString().slice(0, 10)}`, inputs, baked: new Date().toISOString(),
    origin: [lat0, lon0], projection: 'mercator-local', tileSize: T, cell: cfg.cell, bbox: region.bbox, spawn: { ...region.spawn, xz: [sx, sz] },
    surfaces: Object.fromEntries(Object.entries(cfg.surfaces).filter(([k]) => !k.startsWith('_'))), barriers: cfg.barriers,
    attribution: [...ATTRIBUTION.sources, ...dem.map(d => ({ name: d.name, licence: d.attribution, url: d.name === GLO30.name ? 'https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model' : 'https://www.usgs.gov/3d-elevation-program' }))],
    dem, map: `assets/world/${regionId}.pmtiles`,
    far, spots, places,
    tiles: tiles.map(t => ({ i: t.i, j: t.j, bytes: t.bytes, dem: t.dem, landmarks: t.landmarks ?? [] })),
  };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1) + '\n');
  const total = tiles.reduce((a, t) => a + t.bytes, 0);
  console.log(`Wrote ${path.relative(root, manifestFile)}: ${tiles.length} tiles, ${(total / 1e6).toFixed(1)} MB (${((performance.now() - t0) / 1000).toFixed(0)} s)${failed.length ? ` — ${failed.length} failed` : ''}`);
  process.exit(failed.length ? 1 : 0);
}
