// OpenStreetMap roads for the real world's collision: what each road is like (how wide, ground level /
// bridge / tunnel, which layer), from its tags. Pure data. The game reads its map from the world's map
// tiles (realworld/mapTiles.js, which gives roads in this shape: full geometry, node ids shared where
// roads meet, tags); nothing asks a map server at run time any more. readOverpass still reads an
// Overpass API answer saved to a file (the tests' fixtures).

// What a car drives on, and how wide each kind is by default: lanes (both ways together), metres a
// lane, extra width (shoulders, kerbside), how important it is (rank: which road wins at a junction)
export const HIGHWAYS = {
  motorway:       { lanes: 2, lane: 3.6, extra: 3.0, rank: 9 },
  trunk:          { lanes: 2, lane: 3.5, extra: 2.0, rank: 8 },
  primary:        { lanes: 2, lane: 3.4, extra: 1.2, rank: 7 },
  secondary:      { lanes: 2, lane: 3.3, extra: 1.0, rank: 6 },
  tertiary:       { lanes: 2, lane: 3.1, extra: 0.8, rank: 5 },
  motorway_link:  { lanes: 1, lane: 3.8, extra: 2.4, rank: 8 },
  trunk_link:     { lanes: 1, lane: 3.7, extra: 2.0, rank: 7 },
  primary_link:   { lanes: 1, lane: 3.6, extra: 1.2, rank: 6 },
  secondary_link: { lanes: 1, lane: 3.5, extra: 1.0, rank: 5 },
  tertiary_link:  { lanes: 1, lane: 3.4, extra: 0.8, rank: 4 },
  unclassified:   { lanes: 2, lane: 2.9, extra: 0.6, rank: 4 },
  residential:    { lanes: 2, lane: 3.0, extra: 0.6, rank: 3 },
  road:           { lanes: 2, lane: 3.0, extra: 0.6, rank: 3 },
  busway:         { lanes: 2, lane: 3.3, extra: 0.6, rank: 3 },
  raceway:        { lanes: 2, lane: 5.0, extra: 1.0, rank: 5 },
  living_street:  { lanes: 2, lane: 2.7, extra: 0.4, rank: 2 },
  service:        { lanes: 1, lane: 3.6, extra: 0.4, rank: 1 },
  escape:         { lanes: 1, lane: 4.0, extra: 0.5, rank: 1 },
  track:          { lanes: 1, lane: 3.0, extra: 0.3, rank: 0 },
};
const ONEWAY_BY_DEFAULT = new Set(['motorway', 'motorway_link', 'trunk_link']);

// The answer, sorted into roads, buildings and barriers. Roads: { id, nodes (OSM node ids), lat, lon
// (Float64Array, degrees), tags }; buildings: { id, rings: [[lat, lon, lat, lon, …]], tags };
// barriers: { id, lat, lon, tags }
export function readOverpass(json) {
  const roads = [], buildings = [], barriers = [];
  for (const el of json.elements || []) {
    const t = el.tags || {};
    if (el.type === 'way' && el.geometry?.length >= 2) {
      const lat = Float64Array.from(el.geometry, g => g.lat), lon = Float64Array.from(el.geometry, g => g.lon);
      if (t.highway && HIGHWAYS[t.highway] && t.area !== 'yes') roads.push({ id: el.id, nodes: el.nodes, lat, lon, tags: t });
      else if (t.building) buildings.push({ id: el.id, rings: [interleave(lat, lon)], tags: t });
      else if (t.barrier) barriers.push({ id: el.id, lat, lon, tags: t });
    } else if (el.type === 'relation' && t.building) {
      const rings = (el.members || []).filter(m => m.type === 'way' && m.geometry?.length >= 3)
        .sort((a, b) => (a.role === 'outer' ? 0 : 1) - (b.role === 'outer' ? 0 : 1))
        .map(m => interleave(Float64Array.from(m.geometry, g => g.lat), Float64Array.from(m.geometry, g => g.lon)));
      if (rings.length) buildings.push({ id: el.id, rings, tags: t });
    }
  }
  return { roads, buildings, barriers };
}
const interleave = (lat, lon) => { const out = new Float64Array(lat.length * 2); for (let i = 0; i < lat.length; i++) { out[2 * i] = lat[i]; out[2 * i + 1] = lon[i]; } return out; };

// A length tag in metres ("7", "7.5 m", "23'", "12 ft")
export function metres(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase().replace(',', '.');
  const ft = s.match(/^([\d.]+)\s*(?:'|ft|feet)(?:\s*([\d.]+)\s*(?:"|in))?$/);
  if (ft) return +ft[1] * 0.3048 + (+ft[2] || 0) * 0.0254;
  const m = s.match(/^([\d.]+)\s*(m|metres|meters)?$/);
  return m ? +m[1] : null;
}

// What a road is like: { kind: 'ground' | 'bridge' | 'tunnel', layer, width (m), halfWidth, rank,
// oneway, surface (the OSM surface tag, or a default for its kind) }
export function roadInfo(tags) {
  const h = HIGHWAYS[tags.highway] ?? HIGHWAYS.road;
  const bridge = tags.bridge && tags.bridge !== 'no', tunnel = tags.tunnel && !['no', 'building_passage'].includes(tags.tunnel);
  const kind = bridge ? 'bridge' : tunnel ? 'tunnel' : 'ground';
  let layer = parseInt(tags.layer, 10);
  if (!Number.isFinite(layer)) layer = bridge ? 1 : tunnel ? -1 : 0;
  const oneway = tags.oneway ? ['yes', '1', 'true', '-1'].includes(tags.oneway) : ONEWAY_BY_DEFAULT.has(tags.highway) || tags.junction === 'roundabout';
  const tagged = metres(tags.width) ?? metres(tags['width:carriageway']);
  const lanes = parseInt(tags.lanes, 10);
  let width = tagged && tagged >= 2 && tagged <= 40 ? tagged : Number.isFinite(lanes) && lanes > 0 && lanes < 12 ? lanes * h.lane + h.extra : h.lanes * h.lane + h.extra;
  if (!tagged && !Number.isFinite(lanes) && oneway && h.lanes === 2 && !ONEWAY_BY_DEFAULT.has(tags.highway)) width = h.lane * 1.4 + h.extra; // a one-way street is narrower
  width = Math.max(2.5, width);
  const surface = tags.surface ?? (tags.highway === 'track' ? (tags.tracktype === 'grade1' ? 'asphalt' : tags.tracktype === 'grade2' ? 'gravel' : 'dirt') : 'asphalt');
  return { kind, layer, width, halfWidth: width / 2, rank: h.rank, oneway, surface, highway: tags.highway, name: tags.name ?? tags.ref ?? null };
}
