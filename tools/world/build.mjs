// Builds a region's map: its open map data turned into the world's vector tiles (world/schema.js layers,
// world/tiles.js zooms) in one PMTiles file (world/pmtiles.js), ready for any static host or CDN. Run it
// once per region (and again for fresher data); the game only ever reads the file.
//
//   npm run world:build -- --region sf                 data/world/regions/sf.json → assets/world/sf.pmtiles
//   npm run world:build -- --region sf --osm x.osm.pbf  roads, land use, water, details from an OSM extract
//   npm run world:build -- --region sf --bbox w,s,e,n   just part of it (a quick look; written next to it)
//   npm run world:build -- --region sf --release latest the newest Overture release
//
// Sources: Overture Maps (buildings: footprints, heights, floors, roof shapes, colours and materials
// where known; and, without an OSM extract, its OpenStreetMap-derived roads, land use, water, car parks
// and details), an OpenStreetMap extract (tools/world/osmPbf.mjs) when there is one. Hand-made changes
// to buildings: data/world/overrides/<region>.json. What's downloaded is cached in .cache/world/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { overtureRows, latestRelease } from './overture.mjs';
import { THEMES, featuresFrom } from './fromOverture.mjs';
import { osmFeatures } from './fromOsm.mjs';
import { tileFeatures } from './tiler.mjs';
import { encodeTile } from '../../world/mvt.js';
import { writePmtiles } from '../../world/pmtiles.js';
import { LAYERS, SCHEMA_VERSION, idOf } from '../../world/schema.js';
import { ATTRIBUTION } from '../../world/attribution.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2), opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const regionId = opt('--region') ?? 'sf';
const region = JSON.parse(fs.readFileSync(path.join(root, 'data/world/regions', `${regionId}.json`), 'utf8'));
const bbox = opt('--bbox') ? opt('--bbox').split(',').map(Number) : region.bbox;
const partial = !!opt('--bbox');
const release = opt('--release') === 'latest' ? await latestRelease() : opt('--release') ?? region.sources.overture.release;
const osmFile = opt('--osm') ?? region.sources.osm?.pbf ?? null;
const out = path.join(root, opt('--out') ?? (partial ? region.output.replace(/\.pmtiles$/, '.part.pmtiles') : region.output));
const cacheDir = path.join(root, '.cache/world');
const t0 = performance.now(), tty = process.stdout.isTTY;
const log = (m, progress = false) => { if (progress && !tty) return; process.stdout.write(`${tty ? '\r\x1b[K' : ''}${m}${progress ? '' : '\n'}`); };

log(`Building ${region.name} (${regionId}): ${bbox.join(', ')}`);
log(`  Overture ${release}${osmFile ? `, OpenStreetMap from ${osmFile}` : ''}`);
// (a margin round the box: roads and areas reaching in from outside it are cut at its edge, not lost)
const margin = 0.004, wide = [bbox[0] - margin, bbox[1] - margin, bbox[2] + margin, bbox[3] + margin];
const features = [];
const counts = {};
for (const [type, T] of Object.entries(THEMES)) {
  // with an OSM extract, only the buildings (and the ocean, land cover) come from Overture
  if (osmFile && !['building', 'building_part', 'land_cover', 'water'].includes(type)) continue;
  const t = performance.now();
  const rows = await overtureRows({ release, theme: T.theme, type: T.type, bbox: wide, columns: T.columns, cacheDir, log });
  let fs_ = featuresFrom(type, rows);
  if (osmFile && type === 'water') fs_ = fs_.filter(f => f.props.k === 'ocean' || f.props.k === 'sea' || f.props.k === 'bay');
  for (const f of fs_) features.push(f);
  counts[type] = { rows: rows.length, features: fs_.length };
  log(`  ${type}: ${rows.length.toLocaleString('en-GB')} rows → ${fs_.length.toLocaleString('en-GB')} features (${((performance.now() - t) / 1000).toFixed(1)} s)`);
}
if (osmFile) {
  const t = performance.now(), fs_ = await osmFeatures(path.resolve(osmFile), { bbox: wide, log });
  for (const f of fs_) features.push(f);
  counts.osm = { features: fs_.length };
  log(`  OpenStreetMap: ${fs_.length.toLocaleString('en-GB')} features (${((performance.now() - t) / 1000).toFixed(1)} s)`);
}

// hand-made changes to buildings (by tile feature id, or the source's id)
const overridesFile = path.join(root, 'data/world/overrides', `${regionId}.json`);
if (fs.existsSync(overridesFile)) {
  const O = JSON.parse(fs.readFileSync(overridesFile, 'utf8')).buildings ?? {}, byId = new Map(Object.entries(O).map(([k, v]) => [/^\d+$/.test(k) ? +k : idOf(k), v]));
  let changed = 0;
  for (let i = features.length - 1; i >= 0; i--) {
    const f = features[i], o = f.layer === 'buildings' && byId.get(f.id);
    if (!o) continue;
    if (o.remove) features.splice(i, 1); else Object.assign(f.props, o);
    changed++;
  }
  if (byId.size) log(`  overrides: ${changed} of ${byId.size} buildings changed`);
}

// the tiles
const t1 = performance.now();
const tiles = tileFeatures(features, { zooms: [10, 12, 14], bbox });
log(`  ${tiles.size} tiles cut (${((performance.now() - t1) / 1000).toFixed(1)} s)`);
const encoded = [], perLayer = {};
for (const t of tiles.values()) {
  const extent = t.z === 14 ? 8192 : 4096;
  const data = encodeTile(Object.entries(t.layers).map(([name, fs_]) => ({ name, extent, features: fs_ })));
  encoded.push({ z: t.z, x: t.x, y: t.y, data });
  if (t.z === 14) for (const [name, fs_] of Object.entries(t.layers)) { const L = perLayer[name] ??= { features: 0 }; L.features += fs_.length; }
}
const metadata = {
  name: region.name, region: regionId, description: `${region.name}: the world's map (Drive World)`, version: SCHEMA_VERSION, schema: SCHEMA_VERSION, type: 'overlay', format: 'pbf',
  attribution: ATTRIBUTION.html, attributions: ATTRIBUTION.sources,
  bounds: bbox, spawn: region.spawn, built: new Date().toISOString(),
  sources: { overture: release, osm: osmFile ? path.basename(osmFile) : null },
  vector_layers: LAYERS.filter(l => perLayer[l]).map(id => ({ id, minzoom: 10, maxzoom: 14, fields: {} })),
  counts,
};
const bytes = await writePmtiles({ tiles: encoded, metadata, bounds: bbox, center: [region.spawn.lon, region.spawn.lat, 14] });
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, bytes);
const z14 = encoded.filter(t => t.z === 14), sizes = z14.map(t => t.data.length).sort((a, b) => a - b);
log(`  z14: ${z14.length} tiles, ${(sizes.reduce((a, b) => a + b, 0) / 1e6).toFixed(1)} MB before compression, largest ${(sizes.at(-1) / 1e3).toFixed(0)} kB, median ${(sizes[sizes.length >> 1] / 1e3).toFixed(0)} kB`);
log(`  features at z14: ${Object.entries(perLayer).map(([k, v]) => `${k} ${v.features.toLocaleString('en-GB')}`).join(', ')}`);
log(`Wrote ${path.relative(root, out)}: ${(bytes.length / 1e6).toFixed(1)} MB, ${encoded.length} tiles (${((performance.now() - t0) / 1000).toFixed(0)} s)`);

// the game's list of regions (data/world/regions.json): which map file covers where
if (!partial) {
  const indexFile = path.join(root, 'data/world/regions.json');
  const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : { _note: 'The regions the world has maps for (written by npm run world:build): the game reads the map tiles of the one it is in.', regions: [] };
  index.regions = [...index.regions.filter(r => r.id !== regionId), { id: regionId, name: region.name, bbox, spawn: region.spawn, url: path.relative(root, out).split(path.sep).join('/'), built: metadata.built, bytes: bytes.length }].sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
}
