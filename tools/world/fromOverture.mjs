// Overture Maps rows (tools/world/overture.mjs) → the world's features (world/schema.js): buildings and
// their parts; roads and railways (Overture's transportation theme: OpenStreetMap's ways, split where
// their properties change along them); land use, water, car parks and street details (Overture's base
// theme: OpenStreetMap features that keep their OSM tags, so they're read as OSM tags are); land cover.
//
//   features: { layer, id, geometry (GeoJSON, longitude / latitude), props }

import { DRIVABLE, buildingFromTags, classifyOsm, colour, idOf, surfaceOf } from '../../world/schema.js';

export const THEMES = {
  building: { theme: 'buildings', type: 'building', columns: ['id', 'subtype', 'class', 'height', 'min_height', 'num_floors', 'min_floor', 'roof_shape', 'roof_height', 'roof_direction', 'roof_orientation', 'roof_color', 'facade_color', 'facade_material', 'roof_material', 'has_parts', 'is_underground'] },
  building_part: { theme: 'buildings', type: 'building_part', columns: ['id', 'height', 'min_height', 'num_floors', 'min_floor', 'roof_shape', 'roof_height', 'roof_direction', 'roof_orientation', 'roof_color', 'facade_color', 'facade_material', 'roof_material', 'is_underground'] },
  segment: { theme: 'transportation', type: 'segment', columns: ['id', 'subtype', 'class', 'subclass', 'subclass_rules', 'names', 'road_surface', 'road_flags', 'rail_flags', 'width_rules', 'level_rules', 'speed_limits', 'access_restrictions'] },
  infrastructure: { theme: 'base', type: 'infrastructure', columns: ['id', 'subtype', 'class', 'source_tags', 'height', 'level'] },
  land_use: { theme: 'base', type: 'land_use', columns: ['id', 'subtype', 'class', 'source_tags', 'level'] },
  water: { theme: 'base', type: 'water', columns: ['id', 'subtype', 'class', 'source_tags', 'level', 'is_intermittent'] },
  land: { theme: 'base', type: 'land', columns: ['id', 'subtype', 'class', 'source_tags', 'level'] },
  land_cover: { theme: 'base', type: 'land_cover', columns: ['id', 'subtype'] },
  division: { theme: 'divisions', type: 'division_area', columns: ['id', 'subtype', 'class', 'names', 'is_land'] },
};
// the places a driver knows by name: the town or city, its districts and neighbourhoods
const PLACES = new Set(['county', 'localadmin', 'locality', 'borough', 'macrohood', 'neighborhood', 'microhood']);

const shapeOf = g => g.type === 'Point' || g.type === 'MultiPoint' ? 'point' : g.type === 'LineString' || g.type === 'MultiLineString' ? 'line' : 'area';
const r1 = v => v == null ? undefined : +(+v).toFixed(1);

// ---------- buildings ----------
const ROOFS = new Set(['flat', 'gabled', 'hipped', 'pyramidal', 'dome', 'onion', 'skillion', 'gambrel', 'mansard', 'round', 'saltbox', 'half-hipped', 'half_hipped']);
export function building(row, part = false) {
  if (row.is_underground) return null;
  const h = r1(row.height), floors = row.num_floors != null ? Number(row.num_floors) : undefined;
  let mh = r1(row.min_height);
  if (mh == null && row.min_floor != null && Number(row.min_floor) > 0) mh = r1(Number(row.min_floor) * 3);
  const props = {
    h, mh: mh || undefined, fl: floors, b: part ? undefined : row.class ?? row.subtype ?? undefined,
    rs: ROOFS.has(row.roof_shape) ? row.roof_shape.replace('half_hipped', 'half-hipped') : undefined, rh: r1(row.roof_height), rd: row.roof_direction != null ? Math.round(row.roof_direction) : undefined, ro: row.roof_orientation ?? undefined,
    fc: colour(row.facade_color), rc: colour(row.roof_color), fm: row.facade_material ?? undefined, rm: row.roof_material ?? undefined,
    pt: part ? 1 : undefined, hp: !part && row.has_parts ? 1 : undefined, pk: row.class === 'parking' ? 'multi-storey' : undefined,
  };
  return { layer: 'buildings', id: idOf(row.id), geometry: row.geometry, props };
}

// ---------- roads and railways ----------
// a line's length (m, near enough) and where along it (0 … 1) each point is
function measure(coords) {
  const out = [0];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const [a, b] = [coords[i - 1], coords[i]], k = Math.cos((a[1] + b[1]) / 2 * Math.PI / 180);
    total += Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * 111320;
    out.push(total);
  }
  return out.map(d => total ? d / total : 0);
}
// the piece of a line between two fractions of its length
function piece(coords, at, f0, f1) {
  const point = f => {
    let i = 1;
    while (i < at.length - 1 && at[i] < f) i++;
    const t = at[i] > at[i - 1] ? (f - at[i - 1]) / (at[i] - at[i - 1]) : 0, a = coords[i - 1], b = coords[i];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const out = [point(f0)];
  for (let i = 0; i < coords.length; i++) if (at[i] > f0 + 1e-9 && at[i] < f1 - 1e-9) out.push(coords[i]);
  out.push(point(f1));
  return out;
}
const covers = (rule, f) => !rule.between || (f >= rule.between[0] && f <= rule.between[1]);
const VEHICLES = ['motor_vehicle', 'car', 'vehicle', 'motorcar'];
const RAIL = { standard_gauge: 'rail', light_rail: 'light_rail', tram: 'tram', subway: 'subway', narrow_gauge: 'narrow_gauge', monorail: 'monorail', funicular: 'funicular' };

export function segment(row) {
  const g = row.geometry;
  if (!g || g.type !== 'LineString' || g.coordinates.length < 2) return [];
  const rules = [row.road_flags, row.rail_flags, row.width_rules, row.level_rules, row.road_surface, row.speed_limits, row.access_restrictions, row.subclass_rules].flatMap(r => r ?? []);
  const cuts = [...new Set([0, 1, ...rules.flatMap(r => r.between ?? []).filter(f => f > 0 && f < 1)])].sort((a, b) => a - b);
  const at = measure(g.coordinates), out = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const f0 = cuts[i], f1 = cuts[i + 1], f = (f0 + f1) / 2;
    if (f1 - f0 < 1e-6) continue;
    const flags = new Set([...(row.road_flags ?? []), ...(row.rail_flags ?? [])].filter(r => covers(r, f)).flatMap(r => r.values ?? []));
    if (flags.has('is_indoor')) continue;
    const level = row.level_rules?.find(r => covers(r, f))?.value, geometry = { type: 'LineString', coordinates: cuts.length > 2 ? piece(g.coordinates, at, f0, f1) : g.coordinates };
    const id = idOf(cuts.length > 2 ? `${row.id}@${i}` : row.id);
    if (row.subtype === 'rail') {
      const k = RAIL[row.class];
      if (k) out.push({ layer: 'rail', id, geometry, props: { k, br: flags.has('is_bridge') ? 1 : undefined, tn: flags.has('is_tunnel') ? 1 : undefined, ly: level || undefined } });
      continue;
    }
    if (row.subtype !== 'road') continue;
    const k = row.class === 'unknown' || !row.class ? 'road' : row.class, sub = row.subclass_rules?.find(r => covers(r, f))?.value ?? row.subclass;
    const deny = (row.access_restrictions ?? []).filter(r => covers(r, f) && r.access_type === 'denied' && r.when?.heading && !r.when.during && (!r.when.mode || r.when.mode.some(m => VEHICLES.includes(m))) && !r.when.using && !r.when.recognized);
    const ow = deny.some(r => r.when.heading === 'backward') ? 1 : deny.some(r => r.when.heading === 'forward') ? -1 : undefined;
    const speed = row.speed_limits?.find(r => covers(r, f) && !r.when && r.max_speed)?.max_speed;
    const width = row.width_rules?.find(r => covers(r, f))?.value;
    out.push({ layer: 'roads', id, geometry, props: {
      k, s: sub === 'link' || flags.has('is_link') ? 'link' : sub ?? undefined, w: width && width >= 1 && width <= 60 ? r1(width) : undefined, ow,
      br: flags.has('is_bridge') ? 1 : undefined, tn: flags.has('is_tunnel') ? 1 : undefined, cv: flags.has('is_covered') ? 1 : undefined, ly: level || undefined,
      sf: surfaceOf(row.road_surface?.find(r => covers(r, f))?.value), sp: speed ? Math.round(speed.value * (speed.unit === 'mph' ? 1.609 : 1)) : undefined,
      n: DRIVABLE.has(k) ? row.names?.primary ?? undefined : undefined,
    } });
  }
  return out;
}

// ---------- the base theme: OpenStreetMap features with their tags ----------
const COVER = { forest: 'forest', grass: 'grass', shrub: 'shrub', crop: 'crop', urban: 'urban', barren: 'barren', snow: 'snow', wetland: 'wetland', moss: 'moss', mangrove: 'mangrove' };
const WATER = { ocean: 'ocean', sea: 'sea', lake: 'lake', pond: 'pond', reservoir: 'reservoir', river: 'river', stream: 'stream', canal: 'canal', ditch: 'ditch', drain: 'drain', basin: 'basin', bay: 'bay', strait: 'sea', lagoon: 'lake', swimming_pool: 'pool', fountain: 'pool' };
export function base(type, row) {
  const g = row.geometry;
  if (!g) return [];
  if (type === 'land_cover') return COVER[row.subtype] && shapeOf(g) === 'area' ? [{ layer: 'cover', id: idOf(row.id), geometry: g, props: { k: COVER[row.subtype] } }] : [];
  if (row.level != null && row.level < 0) return [];
  const shape = shapeOf(g), tags = row.source_tags && Object.keys(row.source_tags).length ? row.source_tags : null;
  let f = tags ? classifyOsm(tags, shape) : null;
  if (!f && type === 'water') {
    const k = WATER[row.class] ?? WATER[row.subtype];
    if (k && (shape === 'area' || ['river', 'stream', 'canal', 'ditch', 'drain'].includes(k))) f = { layer: 'water', props: { k } };
  }
  if (!f || f.layer === 'buildings') return [];         // (buildings come from the buildings theme)
  if (f.layer === 'details' && f.props.h == null && row.height) f.props.h = r1(row.height);
  return [{ layer: f.layer, id: idOf(row.id), geometry: g, props: f.props }];
}

// Every row of a theme → features
export function featuresFrom(type, rows) {
  const out = [];
  for (const row of rows) {
    if (type === 'building') { const b = building(row); if (b) out.push(b); }
    else if (type === 'building_part') { const b = building(row, true); if (b) out.push(b); }
    else if (type === 'segment') out.push(...segment(row));
    else if (type === 'division') { if (PLACES.has(row.subtype) && row.names?.primary && row.geometry && row.is_land !== false) out.push({ layer: 'places', id: idOf(row.id), geometry: row.geometry, props: { k: row.subtype, n: row.names.primary } }); }
    else out.push(...base(type, row));
  }
  return out;
}
export { buildingFromTags };
