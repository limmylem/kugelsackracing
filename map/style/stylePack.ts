// Map v5's region style packs (data/map/styles/*.json; MAP_README.md, 'Region style packs'): how a country's streets
// look where the map data doesn't say. The pack for a region is the first (by file name, generic.json aside) whose
// bboxes hold the region's middle, else generic.json; its id and name go in the manifest and the game's label.
//
//   const S = stylePackFor(region)   → the pack's settings, { id, name, crossSection, islands, vegetation, … }

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

export function stylePacks(dir = path.join(ROOT, 'data/map/styles')) {
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

export function stylePackFor(region: { bbox: number[] }, dir?: string) {
  const packs = stylePacks(dir), [w, s, e, n] = region.bbox, lon = (w + e) / 2, lat = (s + n) / 2;
  const hit = packs.find(p => p.id !== 'generic' && (p.bboxes ?? []).some((b: number[]) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]));
  const pack = hit ?? packs.find(p => p.id === 'generic');
  if (!pack) throw new Error('no generic style pack (data/map/styles/generic.json)');
  return pack;
}
