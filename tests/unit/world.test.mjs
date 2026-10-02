// The world's map data (world/, tools/world/, realworld/mapTiles.js): vector tiles and PMTiles files
// written and read the same as the reference libraries do; features cut at tile edges so a road meets
// itself exactly in the next tile, buildings kept whole; OpenStreetMap tags and Overture rows sorted into
// the same layers and fields; an OpenStreetMap extract read; and the collision built from the tiles —
// the same data the drawing reads — on the San Francisco test region.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { VectorTile } from '@mapbox/vector-tile';
import * as PbfModule from 'pbf';
import * as ref from 'pmtiles';
import { root } from '../harness.mjs';
import { PbfReader, PbfWriter } from '../../world/pbf.js';
import { decodeTile, encodeTile, LINE, POINT, POLYGON } from '../../world/mvt.js';
import { decodeDirectory, encodeDirectory, openPmtiles, tileIdToZxy, writePmtiles, zxyToTileId } from '../../world/pmtiles.js';
import { lonLatToTile, tileBounds, tileToLonLat, tilesInBbox } from '../../world/tiles.js';
import { classifyOsm, colour, idOf, metres } from '../../world/schema.js';
import { tileFeatures } from '../../tools/world/tiler.mjs';
import { building, segment, base } from '../../tools/world/fromOverture.mjs';
import { osmFeatures } from '../../tools/world/fromOsm.mjs';
import { createMapReader, tagsOf } from '../../realworld/mapTiles.js';
import { buildChunk } from '../../realworld/surface.js';
import { chunkAt } from '../../realworld/chunks.js';

const Pbf = PbfModule.default ?? PbfModule.Pbf ?? Object.values(PbfModule).find(v => typeof v === 'function');
const fileSource = bytes => ({ read: async (o, l) => bytes.subarray(o, o + l) });
// a fetch over a file in memory, answering byte ranges as a static host does
const rangeFetch = bytes => async (url, { headers }) => {
  const [, a, b] = headers.Range.match(/bytes=(\d+)-(\d+)/);
  return new Response(bytes.slice(+a, +b + 1), { status: 206 });
};

test('protobuf: varints to 2^53, zigzag, doubles, strings, nested messages', () => {
  const w = new PbfWriter(8);
  for (const v of [0, 1, 127, 128, 300, 2 ** 31, 2 ** 32 + 5, 2 ** 52 + 3]) w.tag(1, 0).varint(v);
  for (const v of [0, -1, 1, -123456, 2 ** 40, -(2 ** 40)]) w.tag(2, 0).svarint(v);
  w.tag(3, 1).double(Math.PI).tag(4, 2).string('Ünïcode ✓');
  w.message(5, m => m.packed(1, Array.from({ length: 300 }, (_, i) => i * 1000)));
  const r = new PbfReader(w.finish()), got = [];
  r.fields((f, t) => { if (f === 1) got.push(r.varint()); else if (f === 2) got.push(r.svarint()); else if (f === 3) got.push(r.double()); else if (f === 4) got.push(r.string()); else if (f === 5) got.push(r.sub(e => { let p; r.fields(() => { p = r.packed(); }, e); return p.length; })); });
  assert.deepEqual(got, [0, 1, 127, 128, 300, 2 ** 31, 2 ** 32 + 5, 2 ** 52 + 3, 0, -1, 1, -123456, 2 ** 40, -(2 ** 40), Math.PI, 'Ünïcode ✓', 300]);
});

test('vector tiles: what we write, the reference reader reads the same; polygons keep their holes; points and lines past the edges', () => {
  const layers = [
    { name: 'roads', extent: 8192, features: [{ id: 2 ** 52 - 1, type: LINE, properties: { k: 'primary', w: 7.5, ly: -1, br: 1, n: 'Main St' }, geometry: [[[0, 0], [100, 50], [8192, 9000]], [[5, 5], [6, 7]]] }] },
    { name: 'buildings', extent: 8192, features: [{ id: 7, type: POLYGON, properties: { h: 12.5, b: 'house' }, geometry: [[[[0, 0], [0, 100], [100, 100], [100, 0]], [[10, 10], [20, 10], [20, 20], [10, 20]]]] }] },
    { name: 'details', extent: 8192, features: [{ type: POINT, properties: { k: 'tree' }, geometry: [[-3, 9000]] }] },
  ];
  const bytes = encodeTile(layers), mine = decodeTile(bytes), vt = new VectorTile(new Pbf(bytes));
  assert.deepEqual(Object.keys(vt.layers).sort(), ['buildings', 'details', 'roads']);
  const road = vt.layers.roads.feature(0);
  assert.equal(road.id, 2 ** 52 - 1);
  assert.deepEqual({ ...road.properties }, { k: 'primary', w: 7.5, ly: -1, br: 1, n: 'Main St' });
  assert.deepEqual(road.loadGeometry().map(l => l.map(p => [p.x, p.y])), mine.roads.features[0].geometry);
  assert.equal(vt.layers.roads.extent, 8192);
  // the polygon: outer and hole, in MVT's winding (written whichever way round they came)
  const poly = mine.buildings.features[0].geometry;
  assert.equal(poly.length, 1); assert.equal(poly[0].length, 2);
  assert.equal(vt.layers.buildings.feature(0).loadGeometry().length, 2);
  assert.deepEqual(mine.details.features[0].geometry, [[-3, 9000]]);
});

test('PMTiles: tile ids as the reference library numbers them; a file of thousands of tiles (leaf directories) read back by ours and by it', async () => {
  for (const [z, x, y] of [[0, 0, 0], [1, 1, 0], [7, 33, 99], [14, 2620, 6333], [14, 16383, 16383], [20, 123456, 654321]]) {
    assert.equal(zxyToTileId(z, x, y), ref.zxyToTileId(z, x, y));
    assert.deepEqual(tileIdToZxy(zxyToTileId(z, x, y)), [z, x, y]);
  }
  const dir = [{ tileId: 5, runLength: 1, length: 10, offset: 0 }, { tileId: 6, runLength: 3, length: 20, offset: 10 }, { tileId: 100, runLength: 1, length: 5, offset: 0 }];
  assert.deepEqual(decodeDirectory(encodeDirectory(dir)), dir);
  // tiles with different contents (so nothing collapses into runs) and a run of identical ones
  const tiles = [];
  for (let x = 0; x < 160; x++) for (let y = 0; y < 160; y++) tiles.push({ z: 14, x: 2500 + x, y: 6300 + y, data: new TextEncoder().encode((x * 7 + y * 13) % 11 ? `tile ${x} ${y} ${Math.sin(x * y)}` : 'ocean') });
  const bytes = await writePmtiles({ tiles, metadata: { name: 'test' }, bounds: [-122.6, 37.6, -122.2, 37.9], center: [-122.4, 37.75, 14] });
  const pm = await openPmtiles(fileSource(bytes));
  assert.ok(pm.header.leafLength > 0, 'leaf directories');
  assert.equal(pm.header.addressedTiles, tiles.length);
  assert.ok(pm.header.tileContents < tiles.length, 'identical tiles stored once');
  for (const t of [tiles[0], tiles[1234], tiles[20000], tiles.at(-1)]) assert.equal(new TextDecoder().decode(await pm.tile(t.z, t.x, t.y)), new TextDecoder().decode(t.data));
  assert.equal(await pm.tile(14, 1, 1), null);
  assert.equal(await pm.tile(9, 1, 1), null);
  const other = new ref.PMTiles({ getKey: () => 'k', getBytes: async (o, l) => ({ data: bytes.buffer.slice(bytes.byteOffset + o, bytes.byteOffset + o + l) }) });
  assert.equal(new TextDecoder().decode(new Uint8Array((await other.getZxy(14, 2500 + 77, 6300 + 9)).data)), new TextDecoder().decode(tiles[77 * 160 + 9].data));
  assert.deepEqual(await other.getMetadata(), { name: 'test' });
});

test('tile maths: places round trip, a box\'s tiles, a tile\'s bounds', () => {
  const [x, y] = lonLatToTile(-122.3954, 37.7942, 14), [lon, lat] = tileToLonLat(x, y, 14);
  assert.ok(Math.abs(lon + 122.3954) < 1e-9 && Math.abs(lat - 37.7942) < 1e-9);
  assert.deepEqual([Math.floor(x), Math.floor(y)], [2621, 6331]);
  const b = tileBounds(14, 2621, 6331);
  assert.ok(b[0] <= -122.3954 && b[2] >= -122.3954 && b[1] <= 37.7942 && b[3] >= 37.7942);
  assert.equal(tilesInBbox(14, b).length, 1);
  assert.equal(tilesInBbox(12, [-122.52, 37.705, -122.355, 37.838]).length, 9);
});

test('OpenStreetMap tags → layers: roads with their lanes, width and layer; buildings with heights and colours; car parks, water, trees and lamps', () => {
  assert.deepEqual(classifyOsm({ highway: 'primary_link', lanes: '2', width: '7.5 m', bridge: 'yes', layer: '1', surface: 'asphalt', maxspeed: '30 mph', name: 'Ramp' }, 'line'),
    { layer: 'roads', props: { k: 'primary', s: 'link', w: 7.5, ln: 2, ow: undefined, br: 1, tn: undefined, cv: undefined, ly: 1, sf: 'asphalt', sp: 48, n: 'Ramp' } });
  assert.equal(classifyOsm({ highway: 'service', service: 'parking_aisle' }, 'line').props.s, 'parking_aisle');
  assert.equal(classifyOsm({ highway: 'motorway' }, 'line').props.ow, 1);
  assert.equal(classifyOsm({ highway: 'footway', footway: 'sidewalk' }, 'line').props.s, 'sidewalk');
  const b = classifyOsm({ building: 'apartments', 'building:levels': '5', 'roof:shape': 'gabled', 'building:colour': 'brown', 'roof:colour': '#a0522d' }, 'area');
  assert.equal(b.layer, 'buildings');
  assert.equal(b.props.fl, 5); assert.equal(b.props.rs, 'gabled'); assert.equal(b.props.fc, '#7a5638'); assert.equal(b.props.rc, '#a0522d'); assert.equal(b.props.b, 'apartments');
  assert.equal(classifyOsm({ building: 'yes', height: "40'" }, 'area').props.h, 12.2);
  assert.deepEqual(classifyOsm({ amenity: 'parking', parking: 'surface' }, 'area'), { layer: 'paved', props: { k: 'parking', pk: 'surface', sf: undefined } });
  assert.equal(classifyOsm({ amenity: 'parking', parking: 'multi-storey', building: 'parking' }, 'area').props.pk, 'multi-storey');
  assert.equal(classifyOsm({ amenity: 'fuel' }, 'area').props.k, 'fuel');
  assert.equal(classifyOsm({ natural: 'water', water: 'reservoir' }, 'area').props.k, 'reservoir');
  assert.equal(classifyOsm({ landuse: 'forest' }, 'area').props.k, 'forest');
  assert.equal(classifyOsm({ natural: 'tree' }, 'point').props.k, 'tree');
  assert.equal(classifyOsm({ highway: 'street_lamp' }, 'point').props.k, 'lamp');
  assert.equal(classifyOsm({ barrier: 'guard_rail' }, 'line').props.k, 'guard_rail');
  assert.equal(classifyOsm({ shop: 'bakery' }, 'point'), null);
  assert.equal(classifyOsm({ building: 'yes', location: 'underground' }, 'area'), null);
  assert.equal(metres('12 ft'), 12 * 0.3048);
  assert.equal(colour('#ABC'), '#aabbcc');
  assert.equal(idOf('w123'), idOf('w123'));
  assert.notEqual(idOf('w123'), idOf('w124'));
  assert.ok(idOf('7877a912-fb48-4329-baeb-e77d9ac9725d') < 2 ** 52);
});

test('Overture rows → layers: a road split where its bridge and level start and end, one way, width; buildings; base features by their OSM tags', () => {
  const coords = [[-122.40, 37.78], [-122.39, 37.78], [-122.38, 37.78]];
  const parts = segment({ id: 'seg', subtype: 'road', class: 'secondary', geometry: { type: 'LineString', coordinates: coords }, names: { primary: 'Bay St' },
    road_flags: [{ values: ['is_bridge'], between: [0.25, 0.75] }], level_rules: [{ value: 1, between: [0.25, 0.75] }], width_rules: [{ value: 12 }],
    access_restrictions: [{ access_type: 'denied', when: { heading: 'backward' } }], road_surface: [{ value: 'paved' }] });
  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map(p => p.props.br ?? 0), [0, 1, 0]);
  assert.deepEqual(parts.map(p => p.props.ly ?? 0), [0, 1, 0]);
  assert.ok(parts.every(p => p.props.ow === 1 && p.props.w === 12 && p.props.n === 'Bay St' && p.props.sf === 'paved'));
  // the pieces join end to start, and span the whole road
  assert.deepEqual(parts[0].geometry.coordinates[0], coords[0]);
  assert.deepEqual(parts[2].geometry.coordinates.at(-1), coords[2]);
  for (let i = 1; i < 3; i++) assert.deepEqual(parts[i].geometry.coordinates[0], parts[i - 1].geometry.coordinates.at(-1));
  assert.ok(Math.abs(parts[1].geometry.coordinates[0][0] - -122.39 - -0.005) < 1e-6);
  assert.equal(segment({ id: 'r', subtype: 'rail', class: 'standard_gauge', geometry: { type: 'LineString', coordinates: coords } })[0].layer, 'rail');
  assert.deepEqual(segment({ id: 'x', subtype: 'road', class: 'footway', road_flags: [{ values: ['is_indoor'] }], geometry: { type: 'LineString', coordinates: coords } }), []);
  const b = building({ id: 'b', class: 'office', height: 102.37, num_floors: 25, roof_shape: 'flat', facade_color: '#87A4B7', has_parts: true, geometry: { type: 'Polygon', coordinates: [[coords[0], coords[1], [-122.39, 37.79], coords[0]]] } });
  assert.deepEqual(b.props, { h: 102.4, mh: undefined, fl: 25, b: 'office', rs: 'flat', rh: undefined, rd: undefined, ro: undefined, fc: '#87a4b7', rc: undefined, fm: undefined, rm: undefined, pt: undefined, hp: 1, pk: undefined });
  assert.equal(building({ id: 'u', is_underground: true, geometry: {} }), null);
  const park = base('infrastructure', { id: 'p', source_tags: { amenity: 'parking', parking: 'surface' }, geometry: { type: 'Polygon', coordinates: [[coords[0], coords[1], [-122.39, 37.79], coords[0]]] } });
  assert.equal(park[0].layer, 'paved');
  assert.equal(base('water', { id: 'o', subtype: 'ocean', class: 'ocean', geometry: { type: 'Polygon', coordinates: [[coords[0], coords[1], [-122.39, 37.79], coords[0]]] } })[0].props.k, 'ocean');
  assert.equal(base('land_cover', { id: 'c', subtype: 'forest', geometry: { type: 'Polygon', coordinates: [[coords[0], coords[1], [-122.39, 37.79], coords[0]]] } })[0].layer, 'cover');
  assert.deepEqual(base('infrastructure', { id: 'g', level: -1, source_tags: { amenity: 'parking' }, geometry: { type: 'Polygon', coordinates: [[coords[0], coords[1], [-122.39, 37.79], coords[0]]] } }), []);
});

test('an OpenStreetMap extract: roads cut where they meet, an area, a lake with its island, a tree and a lamp; a shop left out', async () => {
  const f = await osmFeatures(path.join(root, 'tests/fixtures/world/tiny.osm.pbf'));
  const roads = f.filter(x => x.layer === 'roads');
  assert.equal(roads.length, 4, 'two roads, each cut at the junction');
  const main = roads.filter(r => r.props.n === 'Main St');
  assert.deepEqual(main[0].geometry.coordinates.at(-1), main[1].geometry.coordinates[0]);
  assert.equal(main[0].props.ln, 4);
  assert.equal(roads.find(r => r.props.k === 'residential').props.ow, 1);
  assert.equal(f.find(x => x.layer === 'paved').props.k, 'parking');
  const lake = f.find(x => x.layer === 'water');
  assert.equal(lake.props.k, 'lake');
  assert.equal(lake.geometry.coordinates.length, 2, 'outer ring and island');
  assert.deepEqual(f.filter(x => x.layer === 'details').map(x => x.props.k).sort(), ['fence', 'lamp', 'tree']);
});

// a little synthetic region: a road crossing a tile edge, a big park, a building on the edge
function syntheticRegion() {
  const [, , e] = tileBounds(14, 2621, 6331), lat = 37.7942;
  return [
    { layer: 'roads', id: 11, geometry: { type: 'LineString', coordinates: [[e - 0.004, lat], [e - 0.001, lat + 0.0003], [e + 0.002, lat + 0.0001], [e + 0.004, lat]] }, props: { k: 'primary', ln: 4 } },
    { layer: 'roads', id: 12, geometry: { type: 'LineString', coordinates: [[e - 0.001, lat + 0.0003], [e - 0.001, lat + 0.002]] }, props: { k: 'residential' } },
    { layer: 'landuse', id: 13, geometry: { type: 'Polygon', coordinates: [[[e - 0.003, lat - 0.002], [e + 0.003, lat - 0.002], [e + 0.003, lat - 0.004], [e - 0.003, lat - 0.004], [e - 0.003, lat - 0.002]]] }, props: { k: 'park' } },
    { layer: 'buildings', id: 14, geometry: { type: 'Polygon', coordinates: [[[e - 0.0001, lat - 0.001], [e + 0.0003, lat - 0.001], [e + 0.0003, lat - 0.0012], [e - 0.0001, lat - 0.0012], [e - 0.0001, lat - 0.001]]] }, props: { h: 20 } },
  ];
}

test('tiling: a road crossing a tile edge ends at the same point both sides; an area is cut into both tiles; a building stays whole in one', () => {
  const tiles = tileFeatures(syntheticRegion(), { zooms: [14] });
  const A = tiles.get('14/2621/6331'), B = tiles.get('14/2622/6331'), E = 8192;
  const a = A.layers.roads.find(f => f.id === 11).geometry[0], b = B.layers.roads.find(f => f.id === 11).geometry[0];
  assert.equal(a.at(-1)[0], E); assert.equal(b[0][0], 0);
  assert.equal(Math.round(a.at(-1)[1]), Math.round(b[0][1]), 'the same place along the edge');
  assert.ok(A.layers.landuse && B.layers.landuse);
  assert.equal([A, B].filter(t => t.layers.buildings?.some(f => f.id === 14)).length, 1);
  const bld = (A.layers.buildings ?? B.layers.buildings).find(f => f.id === 14).geometry[0][0];
  assert.ok(bld.some(p => p[0] > E) || bld.some(p => p[0] < 0), 'reaching past the edge, not cut');
  // through the encoder and back: still meeting
  const da = decodeTile(encodeTile([{ name: 'roads', extent: E, features: A.layers.roads }])), db = decodeTile(encodeTile([{ name: 'roads', extent: E, features: B.layers.roads }]));
  assert.deepEqual([da.roads.features[0].geometry[0].at(-1)[0] - E, da.roads.features[0].geometry[0].at(-1)[1]], db.roads.features[0].geometry[0][0]);
});

test('the collision\'s map from the tiles: roads joined back up across a tile edge, sharing node ids where they meet, with OSM-style tags', async () => {
  const tiles = tileFeatures(syntheticRegion(), { zooms: [14] });
  const bytes = await writePmtiles({ tiles: [...tiles.values()].map(t => ({ z: t.z, x: t.x, y: t.y, data: encodeTile(Object.entries(t.layers).map(([name, features]) => ({ name, extent: 8192, features }))) })), bounds: [-122.41, 37.78, -122.38, 37.80], center: [-122.395, 37.79, 14] });
  const map = createMapReader({ regions: [{ id: 't', bbox: [-122.41, 37.78, -122.38, 37.80], url: 'http://x/t.pmtiles' }], fetchFn: rangeFetch(bytes) });
  const d = await map.area(37.79, -122.40, 37.80, -122.385);
  const main = d.roads.find(r => r.tags.highway === 'primary'), side = d.roads.find(r => r.tags.highway === 'residential');
  assert.equal(d.roads.filter(r => r.tags.highway === 'primary').length, 1, 'one road, not two pieces');
  assert.ok(main.lon[0] < main.lon.at(-1) && main.lat.length >= 4);
  assert.equal(main.tags.lanes, '4');
  assert.ok(main.nodes.includes(side.nodes[0]), 'the side road starts on the main road: the same node');
  assert.equal(d.buildings.length, 1);
  assert.equal(d.covered, true);
  assert.deepEqual(tagsOf({ k: 'motorway', s: 'link', ow: 1, br: 1, ly: 2 }), { highway: 'motorway_link', oneway: 'yes', bridge: 'yes', layer: '2' });
});

test('San Francisco (the test region\'s map file): the roads round the start, and the collision built from them', async t => {
  const file = path.join(root, 'assets/world/sf.pmtiles');
  if (!fs.existsSync(file)) return t.skip('npm run world:build -- --region sf first');
  const bytes = new Uint8Array(fs.readFileSync(file)), pm = await openPmtiles(fileSource(bytes));
  assert.equal(pm.metadata.region, 'sf');
  assert.match(pm.metadata.attribution, /OpenStreetMap/);
  assert.match(pm.metadata.attribution, /Overture/);
  const regions = JSON.parse(fs.readFileSync(path.join(root, 'data/world/regions.json'), 'utf8')).regions;
  const map = createMapReader({ regions, baseUrl: 'http://localhost/', fetchFn: rangeFetch(bytes) });
  const { lat, lon } = regions.find(r => r.id === 'sf').spawn;
  const c = chunkAt(lat, lon), d = await map.area(c.lat0 - 0.003, c.lon0 - 0.004, c.lat1 + 0.003, c.lon1 + 0.004);
  assert.ok(d.roads.length > 200, `${d.roads.length} roads`);
  assert.ok(d.buildings.length > 300, `${d.buildings.length} buildings`);
  assert.ok(d.roads.some(r => /Embarcadero/.test(r.tags.name ?? '')), 'The Embarcadero');
  // flat terrain is enough to show the roads become a driving surface
  const r = buildChunk({ chunk: c, terrain: () => 5, roads: d.roads });
  assert.ok(r.stats.roads > 50 && r.meshes.roads.indices.length > 3000, JSON.stringify(r.stats));
});
