// When the region's OpenStreetMap extract can't be downloaded (Geofabrik unreachable), its OSM data
// rebuilt from Overture Maps — which is OpenStreetMap for everything but buildings: Overture's
// transportation segments are OSM ways split at junctions, with OSM's own coordinates (to the 1e-7°
// OSM stores) and the OSM way each piece came from; its base theme (land use, water, barriers, land)
// carries every original OSM tag. Written as an ordinary .osm file, so the rest of the pipeline
// (osmium, Planetiler, the bake) can't tell it from a Geofabrik extract — apart from the
// `source:map=overture` tag on everything, and `osm:way` (the original way id) where Overture keeps it.
//
// Topology: segments that meet share a connector, so they share an exact end coordinate: one node.
// Buildings: only those Overture took from OSM; the rest (machine-learnt footprints) go to the merge
// step with the Overture heights (map/bake/buildings.ts), as with a real extract.
//
//   await overtureToOsm({ region, cacheDir, log }) → path of the .osm file

import fs from 'node:fs';
import path from 'node:path';
import { overtureRows } from './overture.ts';

type Tags = Record<string, string | number | undefined | null>;

const CLASS: Record<string, string> = {
  motorway: 'motorway', trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary', residential: 'residential', living_street: 'living_street',
  unclassified: 'unclassified', service: 'service', pedestrian: 'pedestrian', footway: 'footway', steps: 'steps', path: 'path', track: 'track', cycleway: 'cycleway',
  bridleway: 'bridleway', unknown: 'road',
};
const LINKABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
const SERVICE: Record<string, string> = { parking_aisle: 'parking_aisle', driveway: 'driveway', alley: 'alley', 'drive-through': 'drive-through', emergency_access: 'emergency_access' };
const RAIL: Record<string, string> = { standard_gauge: 'rail', narrow_gauge: 'narrow_gauge', light_rail: 'light_rail', tram: 'tram', subway: 'subway', monorail: 'monorail', funicular: 'funicular', unknown: 'rail' };
const VEHICLES = ['vehicle', 'motor_vehicle', 'car'];

const covers = (r, f) => !r.between || (f >= r.between[0] && f <= r.between[1]);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// fractions along a line (by length in the plane of lon·cos(lat), lat — near enough for cutting)
function measure(c: number[][]) {
  const k = Math.cos(c[0][1] * Math.PI / 180), at = [0];
  for (let i = 1; i < c.length; i++) at.push(at[i - 1] + Math.hypot((c[i][0] - c[i - 1][0]) * k, c[i][1] - c[i - 1][1]));
  const L = at[at.length - 1] || 1;
  return at.map(a => a / L);
}
// the part of a line between two fractions: its own points, plus a point on the line at each cut
function piece(c: number[][], at: number[], f0: number, f1: number) {
  const pt = (f: number) => { let i = 1; while (i < at.length - 1 && at[i] < f) i++; const t = (f - at[i - 1]) / ((at[i] - at[i - 1]) || 1); return [+(c[i - 1][0] + (c[i][0] - c[i - 1][0]) * t).toFixed(7), +(c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t).toFixed(7)]; };
  const out = [f0 <= 0 ? c[0] : pt(f0)];
  for (let i = 1; i < c.length - 1; i++) if (at[i] > f0 + 1e-12 && at[i] < f1 - 1e-12) out.push(c[i]);
  out.push(f1 >= 1 ? c[c.length - 1] : pt(f1));
  return out;
}
const osmWay = (sources, f: number) => { const s = (sources ?? []).find(s => s.dataset === 'OpenStreetMap' && covers(s, f)); const m = s?.record_id?.match(/^w(\d+)/); return m ? m[1] : undefined; };

// one segment → [{ coords, tags }]
function segmentWays(row): { coords: number[][]; tags: Tags }[] {
  const g = row.geometry;
  if (!g || g.type !== 'LineString' || g.coordinates.length < 2) return [];
  if (row.subtype !== 'road' && row.subtype !== 'rail') return [];
  const rules = [row.road_flags, row.rail_flags, row.width_rules, row.level_rules, row.road_surface, row.speed_limits, row.access_restrictions, row.subclass_rules, row.sources].flatMap(r => r ?? []);
  const cuts = [...new Set([0, 1, ...rules.flatMap(r => r.between ?? []).filter(f => f > 0 && f < 1)])].sort((a, b) => a - b);
  const at = measure(g.coordinates), out = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const f0 = cuts[i], f1 = cuts[i + 1], f = (f0 + f1) / 2;
    if (f1 - f0 < 1e-9) continue;
    const flags = new Set([...(row.road_flags ?? []), ...(row.rail_flags ?? [])].filter(r => covers(r, f)).flatMap(r => r.values ?? []));
    if (flags.has('is_indoor')) continue;
    const coords = cuts.length > 2 ? piece(g.coordinates, at, f0, f1) : g.coordinates;
    const level = row.level_rules?.find(r => covers(r, f))?.value;
    const common: Tags = { 'source:map': 'overture', 'overture:id': row.id, 'osm:way': osmWay(row.sources, f), bridge: flags.has('is_bridge') ? 'yes' : undefined, tunnel: flags.has('is_tunnel') ? 'yes' : undefined, covered: flags.has('is_covered') ? 'yes' : undefined, layer: level ? String(level) : undefined };
    if (row.subtype === 'rail') {
      const k = RAIL[row.class];
      if (k) out.push({ coords, tags: { ...common, railway: k, name: row.names?.primary } });
      continue;
    }
    const cls = CLASS[row.class ?? 'unknown'] ?? 'road', sub = row.subclass_rules?.find(r => covers(r, f))?.value ?? row.subclass;
    const link = (sub === 'link' || flags.has('is_link')) && LINKABLE.has(cls);
    const deny = (row.access_restrictions ?? []).filter(r => covers(r, f) && r.access_type === 'denied' && r.when?.heading && !r.when.during && (!r.when.mode || r.when.mode.some(m => VEHICLES.includes(m))) && !r.when.using && !r.when.recognized);
    const oneway = deny.some(r => r.when.heading === 'backward') ? 'yes' : deny.some(r => r.when.heading === 'forward') ? '-1' : undefined;
    const speed = row.speed_limits?.find(r => covers(r, f) && !r.when && r.max_speed)?.max_speed;
    const width = row.width_rules?.find(r => covers(r, f))?.value;
    out.push({ coords, tags: {
      ...common, highway: link ? `${cls}_link` : cls,
      service: cls === 'service' ? SERVICE[sub] : undefined,
      footway: cls === 'footway' && sub === 'sidewalk' ? 'sidewalk' : cls === 'footway' && sub === 'crosswalk' ? 'crossing' : undefined,
      name: row.names?.primary, oneway, maxspeed: speed ? (speed.unit === 'mph' ? `${speed.value} mph` : String(speed.value)) : undefined,
      width: width ? String(width) : undefined, surface: row.road_surface?.find(r => covers(r, f))?.value,
    } });
  }
  return out;
}

// Overture building → OSM tags
function buildingTags(row, part: boolean): Tags {
  return {
    'source:map': 'overture', 'overture:id': row.id, building: part ? undefined : (row.class ?? row.subtype ?? 'yes'), 'building:part': part ? 'yes' : undefined,
    height: row.height ?? undefined, min_height: row.min_height ?? undefined, 'building:levels': row.num_floors ?? undefined, 'building:min_level': row.min_floor ?? undefined,
    'roof:shape': row.roof_shape ?? undefined, 'roof:height': row.roof_height ?? undefined, 'roof:direction': row.roof_direction ?? undefined, 'roof:orientation': row.roof_orientation ?? undefined,
    'building:colour': row.facade_color ?? undefined, 'roof:colour': row.roof_color ?? undefined, 'building:material': row.facade_material ?? undefined, 'roof:material': row.roof_material ?? undefined,
    name: row.names?.primary, 'osm:way': osmWay(row.sources, 0.5),
  };
}
const fromOsm = row => (row.sources ?? []).some(s => s.dataset === 'OpenStreetMap');

export async function overtureToOsm({ region, cacheDir, log = (s: string) => console.log(s) }) {
  const [w, s, e, n] = region.bbox, pad = 0.004, bbox = [w - pad, s - pad, e + pad, n + pad], release = region.overture.release;
  const file = path.join(cacheDir, `overture-${release}.osm`);
  if (fs.existsSync(file)) { log(`  OSM rebuilt from Overture: ${file} (cached)`); return file; }
  const rows = async (theme: string, type: string, columns: string[]) => {
    const r = await overtureRows({ release, theme, type, bbox, columns, cacheDir: path.join(cacheDir, '..'), log: (m, live) => { if (!live) log(m); } });
    log(`  overture ${theme}/${type}: ${r.length.toLocaleString('en-GB')}`);
    return r;
  };
  const nodeIds = new Map<string, number>(), nodes: string[] = [], nodeTags = new Map<number, Tags>(), ways: string[] = [], relations: string[] = [];
  let nextWay = 1, nextRel = 1;
  const node = (c: number[]) => { const key = `${(+c[0]).toFixed(7)},${(+c[1]).toFixed(7)}`; let id = nodeIds.get(key); if (id === undefined) { id = nodeIds.size + 1; nodeIds.set(key, id); nodes.push(`<node id="${id}" version="1" lat="${(+c[1]).toFixed(7)}" lon="${(+c[0]).toFixed(7)}"`); } return id; };
  const tagXml = (t: Tags) => Object.entries(t).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `<tag k="${esc(k)}" v="${esc(String(v))}"/>`).join('');
  const way = (coords: number[][], tags: Tags | null) => {
    const refs = []; for (const c of coords) { const id = node(c); if (refs[refs.length - 1] !== id) refs.push(id); }
    if (refs.length < 2) return 0;
    const id = nextWay++; ways.push(`<way id="${id}" version="1">${refs.map(r => `<nd ref="${r}"/>`).join('')}${tags ? tagXml(tags) : ''}</way>`); return id;
  };
  // an area: a closed way, or a multipolygon relation (holes, several parts)
  const area = (g, tags: Tags) => {
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    if (!polys.length) return;
    if (polys.length === 1 && polys[0].length === 1) { way(polys[0][0], tags); return; }
    const members = [];
    for (const p of polys) p.forEach((ring, k) => { const id = way(ring, null); if (id) members.push(`<member type="way" ref="${id}" role="${k ? 'inner' : 'outer'}"/>`); });
    relations.push(`<relation id="${nextRel++}" version="1">${members.join('')}${tagXml({ ...tags, type: 'multipolygon' })}</relation>`);
  };

  // roads and railways
  for (const r of await rows('transportation', 'segment', ['id', 'subtype', 'class', 'subclass', 'subclass_rules', 'names', 'road_flags', 'rail_flags', 'level_rules', 'speed_limits', 'access_restrictions', 'width_rules', 'road_surface', 'sources']))
    for (const p of segmentWays(r)) way(p.coords, p.tags);
  // land use, water, barriers and the like: their OSM tags as they are
  for (const type of ['land_use', 'water', 'infrastructure', 'land']) {
    for (const r of await rows('base', type, ['id', 'subtype', 'class', 'source_tags', 'level', 'sources'])) {
      if (!r.geometry) continue;
      let tags: Tags = r.source_tags && Object.keys(r.source_tags).length ? { ...r.source_tags } : {};
      // (the sea and the bay come from OSM's coastline, without tags of their own)
      if (!Object.keys(tags).length && type === 'water' && ['ocean', 'sea', 'bay', 'strait'].includes(r.class ?? r.subtype)) tags = { natural: 'water', water: r.class === 'bay' ? 'bay' : 'sea' };
      if (!Object.keys(tags).length) continue;
      Object.assign(tags, { 'source:map': 'overture', 'overture:id': r.id, 'osm:way': osmWay(r.sources, 0.5) });
      const t = r.geometry.type;
      if (t === 'Point') { const id = node(r.geometry.coordinates); nodeTags.set(id, { ...nodeTags.get(id), ...tags }); }
      else if (t === 'LineString') way(r.geometry.coordinates, tags);
      else if (t === 'MultiLineString') for (const l of r.geometry.coordinates) way(l, tags);
      else area(r.geometry, tags);
    }
  }
  // buildings (those Overture has from OSM)
  const bcols = ['id', 'subtype', 'class', 'names', 'height', 'min_height', 'num_floors', 'min_floor', 'roof_shape', 'roof_height', 'roof_direction', 'roof_orientation', 'roof_color', 'facade_color', 'facade_material', 'roof_material', 'is_underground', 'sources'];
  for (const [type, part] of [['building', false], ['building_part', true]] as const)
    for (const r of await rows('buildings', type, bcols)) if (fromOsm(r) && !r.is_underground && r.geometry) area(r.geometry, buildingTags(r, part));
  // places: neighbourhoods and towns (points), and the city's area
  for (const r of await rows('divisions', 'division', ['id', 'subtype', 'class', 'names'])) {
    const kind = { neighborhood: 'neighbourhood', macrohood: 'suburb', microhood: 'quarter', locality: 'city', borough: 'borough' }[r.subtype];
    if (kind && r.names?.primary && r.geometry?.type === 'Point') { const id = node(r.geometry.coordinates); nodeTags.set(id, { ...nodeTags.get(id), place: kind, name: r.names.primary, 'source:map': 'overture' }); }
  }
  for (const r of await rows('divisions', 'division_area', ['id', 'subtype', 'class', 'names', 'is_land'])) {
    if (!['locality', 'county'].includes(r.subtype) || !r.names?.primary || r.is_land === false) continue;
    area(r.geometry, { boundary: 'administrative', admin_level: r.subtype === 'county' ? '6' : '8', name: r.names.primary, 'source:map': 'overture' });
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  const out = fs.openSync(file + '.part', 'w');
  fs.writeSync(out, '<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="kugelsack map v3 (from Overture Maps)">\n');
  const closed = nodes.map((x, k) => { const t = nodeTags.get(k + 1); return t ? `${x}>${tagXml(t)}</node>` : `${x}/>`; });
  for (const list of [closed, ways, relations]) for (let k = 0; k < list.length; k += 5000) fs.writeSync(out, list.slice(k, k + 5000).join('\n') + '\n');
  fs.writeSync(out, '</osm>\n');
  fs.closeSync(out);
  fs.renameSync(file + '.part', file);
  log(`  OSM rebuilt from Overture: ${nodes.length.toLocaleString('en-GB')} nodes, ${ways.length.toLocaleString('en-GB')} ways, ${relations.length.toLocaleString('en-GB')} relations`);
  return file;
}
