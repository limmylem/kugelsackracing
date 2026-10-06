// The credits and licences screen's list (Phase 6 Step 5): every data source the world is made from (each baked
// region's manifest: OpenStreetMap, Overture Maps, the elevation sources), the tools the maps were baked with,
// the libraries the game loads, the fonts, and every package the server runs with its licence (package-lock.json's
// production packages). Written to account/credits.json; account/credits.html shows it.
//
//   npm run credits            write it
//   npm run credits -- --check  exit 1 if it's out of date (CI: a new package or region without its credit)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const out = path.join(root, 'account/credits.json');

// ---------- the world's data ----------
const data = new Map();
for (const r of read('data/map/baked.json').regions) {
  let m; try { m = read(r.manifest); } catch { continue; }
  for (const a of m.attribution ?? []) {
    const k = a.name, d = data.get(k) ?? { name: a.name, url: a.url ?? null, licence: a.licence, text: a.text ?? null, regions: [] };
    d.regions.push(r.name); data.set(k, d);
  }
}
const geoid = { name: 'Geoid grids (PROJ-data: NOAA GEOID18, NGA EGM2008)', url: 'https://cdn.proj.org', licence: 'Public domain / open', text: null, regions: ['all'] };

// ---------- what the game loads in the browser (from jsDelivr), and the fonts ----------
const pkgVersion = n => { try { return read(`node_modules/${n}/package.json`).version; } catch { return null; } };
const browser = [
  { name: 'three.js', version: '0.160.0', licence: 'MIT', url: 'https://threejs.org', by: 'three.js authors' },
  { name: 'Rapier (rapier3d-compat)', version: '0.21.0', licence: 'Apache-2.0', url: 'https://rapier.rs', by: 'Dimforge' },
  { name: 'MapLibre GL JS', version: pkgVersion('maplibre-gl'), licence: 'BSD-3-Clause', url: 'https://maplibre.org', by: 'MapLibre contributors' },
  { name: 'PMTiles', version: pkgVersion('pmtiles'), licence: 'BSD-3-Clause', url: 'https://github.com/protomaps/PMTiles', by: 'Protomaps' },
  { name: 'pbf', version: '4', licence: 'BSD-3-Clause', url: 'https://github.com/mapbox/pbf', by: 'Mapbox' },
  { name: 'vector-tile', version: '2', licence: 'BSD-3-Clause', url: 'https://github.com/mapbox/vector-tile-js', by: 'Mapbox' },
  { name: 'Zod (the shared data formats)', version: pkgVersion('zod'), licence: 'MIT', url: 'https://zod.dev', by: 'Colin McDonnell' },
  { name: 'Cloudflare Turnstile (the bot check, when on)', version: null, licence: 'Cloudflare terms of service', url: 'https://www.cloudflare.com/products/turnstile/', by: 'Cloudflare' },
];
const fonts = [
  { name: 'Barlow and Barlow Condensed', licence: 'SIL Open Font License 1.1', url: 'https://fonts.google.com/specimen/Barlow', by: 'Jeremy Tribby' },
  { name: 'JetBrains Mono', licence: 'SIL Open Font License 1.1', url: 'https://www.jetbrains.com/lp/mono/', by: 'JetBrains' },
];
const tools = [
  { name: 'Planetiler', licence: 'Apache-2.0' }, { name: 'GDAL', licence: 'MIT' }, { name: 'Osmium (run as a tool)', licence: 'GPL-3.0' },
  { name: 'meshoptimizer', licence: 'MIT' }, { name: 'Martini', licence: 'ISC' },
];
const own = [
  { name: 'Car models, parts and paints', note: 'Made for the game.' },
  { name: 'Engine, crash and interface sounds', note: 'Made by the game\'s own sound tools (tools/sounds.mjs): synthesised, no recordings.' },
  { name: 'Generated tracks and their scenery', note: 'Made by the game.' },
];

// ---------- the server's packages ----------
const lock = read('package-lock.json').packages;
const server = Object.entries(lock)
  .filter(([k, v]) => k.startsWith('node_modules/') && !v.dev && !v.link)
  .map(([k, v]) => ({ name: k.slice(k.lastIndexOf('node_modules/') + 13), version: v.version, licence: v.license ?? 'see package' }))
  .sort((a, b) => a.name.localeCompare(b.name));
const byLicence = server.reduce((m, p) => (m[p.licence] = (m[p.licence] ?? 0) + 1, m), {});

const doc = {
  _note: 'Written by tools/credits.mjs (npm run credits): don\'t edit by hand.',
  data: [...data.values(), geoid], tools, browser, fonts, own,
  server: { count: server.length, byLicence, packages: server },
};
const text = JSON.stringify(doc, null, 1) + '\n';
if (process.argv.includes('--check')) {
  const now = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (now !== text) { console.error('account/credits.json is out of date: run npm run credits'); process.exit(1); }
  console.log('Credits up to date.');
} else {
  fs.writeFileSync(out, text);
  console.log(`account/credits.json: ${doc.data.length} data sources, ${browser.length} browser libraries, ${server.length} server packages (${Object.entries(byLicence).map(([k, n]) => `${n} ${k}`).join(', ')})`);
}
