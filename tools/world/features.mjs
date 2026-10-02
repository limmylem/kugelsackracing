// A region's map features (world/schema.js layers, longitude / latitude), gathered from its sources —
// Overture Maps, and an OpenStreetMap extract when there is one — with the hand-made building changes
// applied. The map tiles (tools/world/build.mjs) and the baked world (tools/world/bake.mjs) both start
// from this, so they agree feature for feature. Kept in .cache/world/<region>/ once gathered.
//
//   await collectFeatures({ region, bbox, release, osmFile, cacheDir, root, log }) → { features, counts }

import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import { overtureRows } from './overture.mjs';
import { THEMES, featuresFrom } from './fromOverture.mjs';
import { osmFeatures } from './fromOsm.mjs';
import { idOf } from '../../world/schema.js';

export const FEATURES_VERSION = 2;          // (part of the cache key: bump when the adapters change)

export async function collectFeatures({ region, bbox, release, osmFile = null, cacheDir, root, log = () => {} }) {
  const key = [FEATURES_VERSION, region.id, release, osmFile ? path.basename(osmFile) + fs.statSync(osmFile).mtimeMs : 'no-osm', bbox.map(v => v.toFixed(5)).join(',')].join('|');
  const file = path.join(cacheDir, region.id, `features-${hash(key)}.bin`);
  let out = null;
  if (fs.existsSync(file)) { out = v8.deserialize(fs.readFileSync(file)); log(`  features from the cache (${out.features.length.toLocaleString('en-GB')})`); }
  else {
    // (a margin round the box: roads and areas reaching in from outside it are cut at its edge, not lost)
    const margin = 0.004, wide = [bbox[0] - margin, bbox[1] - margin, bbox[2] + margin, bbox[3] + margin];
    const features = [], counts = {};
    for (const [type, T] of Object.entries(THEMES)) {
      // with an OSM extract, only the buildings (and the ocean, land cover, places) come from Overture
      if (osmFile && !['building', 'building_part', 'land_cover', 'water', 'division'].includes(type)) continue;
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
    out = { features, counts };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, v8.serialize(out));
  }
  // hand-made changes to buildings (by tile feature id, or the source's id)
  const overridesFile = path.join(root, 'data/world/overrides', `${region.id}.json`);
  if (fs.existsSync(overridesFile)) {
    const O = JSON.parse(fs.readFileSync(overridesFile, 'utf8')).buildings ?? {}, byId = new Map(Object.entries(O).map(([k, v]) => [/^\d+$/.test(k) ? +k : idOf(k), v]));
    let changed = 0;
    const F = out.features;
    for (let i = F.length - 1; i >= 0; i--) {
      const f = F[i], o = f.layer === 'buildings' && byId.get(f.id);
      if (!o) continue;
      if (o.remove) F.splice(i, 1); else Object.assign(f.props, o);
      changed++;
    }
    if (byId.size) log(`  overrides: ${changed} of ${byId.size} buildings changed`);
  }
  return out;
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h.toString(16); }
