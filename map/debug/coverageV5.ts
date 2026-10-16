// Map v5 Step 0's data coverage for a region (MAP_V5_DIAGNOSIS.md): what the region's OSM extract and Overture give
// Map v5 to work with —
//   · roads: the share with sidewalk tags, and the separately mapped footpaths (footway=sidewalk / crossing)
//   · buildings: the share with a type, height, levels, roof shape and colour, in OSM and in Overture
//   · places: POIs with a brand (OSM brand / brand:wikidata, Overture Places' brand), and how many the
//     name-suggestion-index recognises by name
//   · street furniture and structures: traffic signals, lamps, power poles and lines, bus stops, crossings, trees,
//     barriers, bridges, tunnels, roundabouts
// Read only.
//   node map/debug/coverageV5.ts --region adelaide [--json <out.json>] [--places <cached places.json>]

import fs from 'node:fs';
import path from 'node:path';
import { readPbf } from '../bake/osmPbf.ts';
import { osmExtract } from '../bake/sources.ts';
import { overtureRows } from '../bake/overture.ts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const args = process.argv.slice(2), opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const region = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/map/regions', `${opt('--region') ?? 'adelaide'}.json`), 'utf8'));
const cacheDir = path.join(ROOT, '.cache/map', region.id);
const src = await osmExtract(region, { cacheDir, log: () => {} });
const D: any = (readPbf as any)(new Uint8Array(fs.readFileSync(src.file)), { wantWay: () => true, wantRelation: () => true, wantNode: (t: any) => Object.keys(t).length > 0 });

const DRIVABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'road', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
const pct = (a: number, b: number) => (b ? Math.round(1000 * a / b) / 10 : 0);
const count = (list: any[], f: (t: any) => boolean) => list.reduce((n, x) => n + (f(x.tags) ? 1 : 0), 0);
const ways = [...D.ways.values()], nodes = D.points;
const lenOf = (w: any) => { let L = 0; for (let k = 1; k < w.refs.length; k++) { const a = D.nodes.get(w.refs[k - 1]), b = D.nodes.get(w.refs[k]); if (a && b) L += Math.hypot((b[0] - a[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), (b[1] - a[1]) * 110540); } return L; };
// (the extract's nodes aren't all loaded: only the ones its ways need — every way's then)

const roads = ways.filter(w => DRIVABLE.has(w.tags.highway));
const sidewalkTagged = roads.filter(w => Object.keys(w.tags).some(k => /^sidewalk(:|$)/.test(k)));
const footways = ways.filter(w => w.tags.highway === 'footway' || w.tags.highway === 'path' || w.tags.highway === 'pedestrian');
const sidewalks = footways.filter(w => w.tags.footway === 'sidewalk'), crossingsW = footways.filter(w => w.tags.footway === 'crossing');
const buildings = ways.filter(w => w.tags.building && w.tags.building !== 'no');
const bt = (f: (t: any) => boolean) => pct(count(buildings, f), buildings.length);

const out: any = {
  region: region.id, osm: src.source ?? 'geofabrik', date: src.date ?? null,
  roads: {
    drivableWays: roads.length, withSidewalkTag: sidewalkTagged.length, withSidewalkTagPct: pct(sidewalkTagged.length, roads.length),
    withLanes: pct(count(roads, t => !!t.lanes), roads.length), withWidth: pct(count(roads, t => !!t.width), roads.length), withLit: pct(count(roads, t => !!t.lit), roads.length),
    withSurface: pct(count(roads, t => !!t.surface), roads.length), withMaxspeed: pct(count(roads, t => !!t.maxspeed), roads.length),
    withDestination: count(roads, t => Object.keys(t).some(k => k.startsWith('destination'))), withTurnLanes: count(roads, t => !!t['turn:lanes']),
    withIncline: count(roads, t => !!t.incline), withCuttingEmbankment: count(roads, t => !!t.cutting || !!t.embankment), withRef: count(roads, t => !!t.ref),
    separateSidewalks: sidewalks.length, separateSidewalkKm: Math.round(sidewalks.reduce((a, w) => a + lenOf(w), 0) / 100) / 10,
    crossingWays: crossingsW.length, footwaysAll: footways.length,
  },
  buildings: {
    osm: buildings.length, withType: bt(t => t.building !== 'yes'), withHeight: bt(t => !!t.height), withLevels: bt(t => !!t['building:levels']),
    withRoofShape: bt(t => !!t['roof:shape']), withColour: bt(t => !!t['building:colour'] || !!t['roof:colour']), withMaterial: bt(t => !!t['building:material'] || !!t['roof:material']),
    parts: count(ways, t => !!t['building:part']),
  },
  points: {} as Record<string, number>, structures: {} as Record<string, number>, brands: {} as any,
};
const P = (label: string, f: (t: any) => boolean) => { out.points[label] = count(nodes, f) + count(ways.filter(w => !w.tags.building), f); };
P('traffic signals', t => t.highway === 'traffic_signals');
P('street lamps', t => t.highway === 'street_lamp');
P('stop signs', t => t.highway === 'stop');
P('give-way signs', t => t.highway === 'give_way');
P('crossings', t => t.highway === 'crossing' || t.footway === 'crossing');
P('kerb points', t => !!t.kerb || t.barrier === 'kerb');
P('bus stops', t => t.highway === 'bus_stop' || (t.public_transport === 'platform' && t.bus === 'yes'));
P('bus shelters', t => t.shelter === 'yes' || t.amenity === 'shelter');
P('power poles', t => t.power === 'pole');
P('power towers', t => t.power === 'tower');
P('power lines', t => t.power === 'line' || t.power === 'minor_line');
P('trees', t => t.natural === 'tree');
P('tree rows', t => t.natural === 'tree_row');
P('barriers', t => !!t.barrier && t.barrier !== 'kerb');
P('benches', t => t.amenity === 'bench' || t.leisure === 'picnic_table');
P('bins', t => t.amenity === 'waste_basket' || t.amenity === 'recycling');
P('post boxes', t => t.amenity === 'post_box');
P('fire hydrants', t => t.emergency === 'fire_hydrant');
P('bollards', t => t.barrier === 'bollard');
P('bicycle parking', t => t.amenity === 'bicycle_parking');
P('traffic calming', t => !!t.traffic_calming);
P('railway stations', t => t.railway === 'station' || t.public_transport === 'station');
P('level crossings', t => t.railway === 'level_crossing' || t.railway === 'crossing');
P('sports pitches', t => t.leisure === 'pitch');
P('places of worship', t => t.amenity === 'place_of_worship');
P('schools', t => t.amenity === 'school');
P('fuel stations', t => t.amenity === 'fuel');
P('fast food', t => t.amenity === 'fast_food');
P('supermarkets', t => t.shop === 'supermarket');
P('shops (any)', t => !!t.shop);
P('with wikidata / wikipedia', t => !!t.wikidata || !!t.wikipedia);
P('tourism / historic', t => !!t.tourism || !!t.historic);
const S = (label: string, f: (t: any) => boolean) => { out.structures[label] = count(ways, f); };
S('bridges (ways)', t => !!t.highway && !!t.bridge && t.bridge !== 'no');
S('tunnels (ways)', t => !!t.highway && !!t.tunnel && t.tunnel !== 'no');
S('roundabouts (junction=roundabout)', t => t.junction === 'roundabout' || t.junction === 'circular');
S('railway lines', t => ['rail', 'light_rail', 'tram'].includes(t.railway));
S('electrified railway', t => !!t.electrified && t.electrified !== 'no');
S('car parks', t => t.amenity === 'parking');
S('parks', t => t.leisure === 'park');
// brands: OSM's own, and Overture Places'
const osmBranded = [...nodes, ...ways].filter((x: any) => x.tags.brand || x.tags['brand:wikidata']);
out.brands.osm = { withBrand: osmBranded.length, withBrandWikidata: osmBranded.filter((x: any) => x.tags['brand:wikidata']).length };
const placesFile = opt('--places');
const places: any[] = placesFile && fs.existsSync(placesFile) ? JSON.parse(fs.readFileSync(placesFile, 'utf8'))
  : (await overtureRows({ release: region.overture.release, theme: 'places', type: 'place', bbox: region.bbox, columns: ['id', 'names', 'brand', 'confidence', 'taxonomy', 'basic_category'], cacheDir: path.join(ROOT, '.cache/map') }));
const branded = places.filter(p => p.brand?.wikidata || p.brand?.names?.primary);
out.brands.overture = { places: places.length, withBrand: branded.length, withBrandWikidata: branded.filter(p => p.brand?.wikidata).length, confident: places.filter(p => (p.confidence ?? 0) >= 0.5).length };
// (the name-suggestion-index, by brand name or name: how many of the places it would recognise as a chain)
const nsiFile = path.join(ROOT, '.cache/map/nsi/package/dist/json/nsi.min.json');
if (fs.existsSync(nsiFile)) {
  const N = JSON.parse(fs.readFileSync(nsiFile, 'utf8')).nsi, byName = new Map<string, string>();
  const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
  for (const [k, v] of Object.entries<any>(N)) if (k.startsWith('brands/')) for (const it of v.items) { const q = it.tags?.['brand:wikidata']; if (!q) continue; for (const n of [it.displayName, it.tags.brand, it.tags.name, ...(it.matchNames ?? [])]) if (n) byName.set(norm(n), q); }
  let hit = 0;
  for (const p of places) { const n = p.brand?.names?.primary ?? p.names?.primary; if (p.brand?.wikidata || (n && byName.has(norm(n)))) hit++; }
  out.brands.nsiRecognised = hit;
}
// each teleport spot (--spots): what's mapped within `--radius` m of it, by the kinds Map v5 draws (and Map v4 drew)
const spotsFile = opt('--spots');
if (spotsFile) {
  const R = +(opt('--radius') ?? 120), spots = JSON.parse(fs.readFileSync(spotsFile, 'utf8')).spots;
  const near = (lat: number, lon: number, la: number, lo: number) => Math.hypot((la - lat) * 110540, (lo - lon) * 111320 * Math.cos(lat * Math.PI / 180)) < R;
  const wayMid = (w: any) => { let a = 0, b = 0, n = 0; for (const r of w.refs) { const c = D.nodes.get(r); if (c) { a += c[1]; b += c[0]; n++; } } return n ? [a / n, b / n] : [NaN, NaN]; };
  const wm = new Map(ways.map(w => [w.id, wayMid(w)]));
  const kinds: [string, (t: any) => boolean][] = [
    ['sidewalks (separate)', t => t.footway === 'sidewalk'], ['crossings', t => t.highway === 'crossing' || t.footway === 'crossing'], ['kerb points', t => !!t.kerb || t.barrier === 'kerb'],
    ['driveways', t => t.service === 'driveway'], ['traffic signals', t => t.highway === 'traffic_signals'], ['stop / give way', t => t.highway === 'stop' || t.highway === 'give_way'],
    ['street lamps', t => t.highway === 'street_lamp'], ['bus stops', t => t.highway === 'bus_stop'], ['power poles / lines', t => !!t.power], ['trees', t => t.natural === 'tree' || t.natural === 'tree_row'],
    ['benches / bins / bike racks', t => ['bench', 'waste_basket', 'bicycle_parking', 'recycling'].includes(t.amenity)], ['barriers (fences, walls, hedges)', t => !!t.barrier && t.barrier !== 'kerb'],
    ['buildings', t => !!t.building], ['buildings with a type', t => !!t.building && t.building !== 'yes'], ['buildings with height or levels', t => !!t.building && (!!t.height || !!t['building:levels'])],
    ['sports pitches', t => t.leisure === 'pitch'], ['parks / playgrounds', t => t.leisure === 'park' || t.leisure === 'playground'], ['car parks', t => t.amenity === 'parking'], ['railway', t => !!t.railway],
  ];
  out.spots = spots.map((s: any) => {
    const c: Record<string, number> = {};
    for (const [label, f] of kinds) c[label] = nodes.filter((p: any) => f(p.tags) && near(s.lat, s.lon, p.lat, p.lon)).length + ways.filter(w => f(w.tags) && near(s.lat, s.lon, ...(wm.get(w.id) as [number, number]))).length;
    const pl = places.filter(p => p.geometry?.coordinates && near(s.lat, s.lon, p.geometry.coordinates[1], p.geometry.coordinates[0]) && (p.confidence ?? 0) >= 0.5);
    c['Overture places'] = pl.length; c['with a brand'] = pl.filter(p => p.brand?.names?.primary || p.brand?.wikidata).length;
    return { id: s.id, name: s.name, counts: c, brands: [...new Set(pl.filter(p => p.brand?.names?.primary).map(p => p.brand.names.primary))].slice(0, 12) };
  });
}
if (opt('--json')) fs.writeFileSync(opt('--json')!, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
