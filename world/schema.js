// What the world's map tiles hold: the layers the game builds the world from, and only the fields it
// needs (short names, to keep the tiles small). Both the map pipeline's sources — OpenStreetMap (its
// tags) and Overture Maps (its buildings; and its OpenStreetMap-derived roads, land use, water and
// details, which keep their OSM tags) — come through here, so a road or a car park means the same
// whatever it came from. Pure data: the pipeline writes tiles by it, the game's map worker reads them.
//
// Layers (z14 has everything; z12 and z10 a simpler world for the distance, see ZOOM_RULES):
//   roads     lines  k kind (motorway … residential, service, track, footway, cycleway, steps…),
//                    s sub-kind (link, driveway, parking_aisle, alley, sidewalk, crosswalk), w width (m,
//                    tagged), ln lanes, ow one way (1 along, −1 against), br bridge, tn tunnel, cv
//                    covered, ly layer, sf surface, sp speed limit (km/h), n name
//   rail      lines  k (rail, light_rail, tram, subway, narrow_gauge, monorail, funicular), br, tn, ly
//   buildings areas  h height, mh base height (m, above the ground), fl floors, b kind (house,
//                    apartments, office, retail, industrial, church, parking…), rs roof shape, rh roof
//                    height, rd roof direction (°), ro roof orientation, fc / rc facade / roof colour
//                    (#rrggbb), fm / rm facade / roof material, pt 1: a part of a building (its parts
//                    drawn instead of its outline), hp 1: an outline that has parts, pk parking (a
//                    multi-storey car park)
//   landuse   areas  k (grass, park, forest, farmland, residential, industrial, sand, rock, …)
//   cover     areas  k land cover from satellite imagery (forest, grass, shrub, crop, urban, barren,
//                    snow, wetland, moss, mangrove): what the ground's like where nothing's mapped
//   water     areas  k (ocean, bay, lake, pond, reservoir, basin, river, pool, …) and lines (river,
//                    stream, canal, ditch, drain) with w width
//   paved     areas  k parking (pk: surface, multi-storey, underground, rooftop, …), bay (a parking
//                    space), fuel, services, rest_area, plaza, driveway: flat ground to drive on or
//                    walk across
//   details   points tree, lamp, signals, crossing, stop, give_way, bollard, gate, hydrant
//             lines  tree_row, fence, wall, hedge, guard_rail, retaining_wall, jersey_barrier, kerb,
//                    city_wall (h height where tagged)
//   places    areas  k (locality: the town or city, borough, neighborhood, microhood, county…), n name
//
// Feature ids: a 52-bit hash of the source's id (OSM "w123", an Overture GERS id), the same every
// build, so a building can be pointed at (the manual override file, the world editor).

export const SCHEMA_VERSION = 1;
export const LAYERS = ['water', 'cover', 'landuse', 'paved', 'roads', 'rail', 'buildings', 'details', 'places'];

export const ROAD_KINDS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'track', 'busway', 'raceway', 'road', 'escape',
  'pedestrian', 'footway', 'path', 'cycleway', 'steps', 'bridleway']);
// roads a car drives on (the rest: paths)
export const DRIVABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'track', 'busway', 'raceway', 'road', 'escape']);
const RAIL_KINDS = new Set(['rail', 'light_rail', 'tram', 'subway', 'narrow_gauge', 'monorail', 'funicular']);
const SUBS = new Set(['link', 'driveway', 'parking_aisle', 'alley', 'sidewalk', 'crosswalk', 'drive-through', 'emergency_access']);

// ---------- values ----------
// a length in metres ("7", "7.5 m", "23'", "12 ft")
export function metres(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase().replace(',', '.');
  const ft = s.match(/^([\d.]+)\s*(?:'|ft|feet)(?:\s*([\d.]+)\s*(?:"|in))?$/);
  if (ft) return +ft[1] * 0.3048 + (+ft[2] || 0) * 0.0254;
  const m = s.match(/^([\d.]+)\s*(m|metres|meters)?$/);
  return m ? +m[1] : null;
}
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const round = (v, d = 1) => v == null ? undefined : +v.toFixed(d);
// a speed in km/h ("50", "30 mph")
function kmh(v) {
  if (!v) return null;
  const m = String(v).match(/^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh)?/i);
  return m ? Math.round(+m[1] * (/mph/i.test(m[2] ?? '') ? 1.609 : 1)) : null;
}
// a colour → "#rrggbb" (OSM's names and hex), or undefined
const NAMED = { white: '#f2f2f0', black: '#2b2b2b', grey: '#8e8e8e', gray: '#8e8e8e', silver: '#c0c0c0', red: '#a8413a', maroon: '#6b2b26', brown: '#7a5638', beige: '#d8c8a4', cream: '#efe4c4', yellow: '#e2c25a',
  orange: '#d8873e', tan: '#c8a77a', pink: '#e2a9a6', green: '#5f8a55', darkgreen: '#3a5a37', blue: '#4f74a8', lightblue: '#9fc3de', darkblue: '#2d4468', purple: '#7a5a8e', gold: '#c9a54b', sandstone: '#cdb48a',
  lightgrey: '#c4c4c2', lightgray: '#c4c4c2', darkgrey: '#555555', darkgray: '#555555', ivory: '#f1ead2', terracotta: '#b5603e', ochre: '#c79235' };
export function colour(v) {
  if (!v) return undefined;
  const s = String(v).trim().toLowerCase().replace(/[\s_-]/g, '');
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return NAMED[s];
}
const SURFACES = { asphalt: 'asphalt', paved: 'paved', concrete: 'concrete', 'concrete:plates': 'concrete', 'concrete:lanes': 'concrete', paving_stones: 'paving_stones', sett: 'sett', cobblestone: 'cobblestone',
  unhewn_cobblestone: 'cobblestone', bricks: 'paving_stones', brick: 'paving_stones', metal: 'metal', wood: 'wood', gravel: 'gravel', fine_gravel: 'gravel', pebblestone: 'gravel', compacted: 'compacted',
  unpaved: 'unpaved', dirt: 'dirt', earth: 'dirt', ground: 'dirt', mud: 'dirt', grass: 'grass', grass_paver: 'grass', sand: 'sand', rock: 'gravel', artificial_turf: 'grass', tartan: 'asphalt', rubber: 'asphalt' };
export const surfaceOf = v => v ? SURFACES[String(v).toLowerCase()] : undefined;

// A 52-bit id from a source's id (FNV-1a, 64 bits, the top 52 kept): the same every build
export function idOf(s) {
  let h1 = 0x811c9dc5, h2 = 0xcbf29ce4;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c * 31 + i), 0x01000193) >>> 0;
  }
  return (h2 & 0xfffff) * 2 ** 32 + h1;
}

// ---------- OpenStreetMap tags → layers ----------
const LANDUSE = {
  landuse: { grass: 'grass', recreation_ground: 'grass', village_green: 'grass', meadow: 'meadow', forest: 'forest', farmland: 'farmland', farmyard: 'farmyard', orchard: 'orchard', vineyard: 'vineyard',
    allotments: 'allotments', residential: 'residential', commercial: 'commercial', retail: 'retail', industrial: 'industrial', construction: 'construction', brownfield: 'brownfield', greenfield: 'grass',
    cemetery: 'cemetery', military: 'military', railway: 'railway', quarry: 'quarry', landfill: 'brownfield', plant_nursery: 'farmland', greenhouse_horticulture: 'farmland', religious: 'residential',
    education: 'education', institutional: 'commercial', flowerbed: 'garden', basin: null, reservoir: null },
  leisure: { park: 'park', garden: 'garden', pitch: 'pitch', playground: 'playground', golf_course: 'golf', sports_centre: 'sports', stadium: 'sports', track: 'sports', dog_park: 'park', nature_reserve: null,
    common: 'grass', recreation_ground: 'grass' },
  natural: { wood: 'forest', scrub: 'scrub', heath: 'heath', grassland: 'meadow', fell: 'meadow', sand: 'sand', beach: 'beach', dune: 'sand', bare_rock: 'rock', rock: 'rock', scree: 'scree', shingle: 'scree',
    glacier: 'glacier', wetland: 'wetland', mud: 'wetland', cliff: null },
  amenity: { school: 'education', university: 'education', college: 'education', kindergarten: 'education', hospital: 'hospital', grave_yard: 'cemetery' },
  golf: { fairway: 'golf', green: 'golf', tee: 'golf', bunker: 'sand', rough: 'grass' },
};
const WATER_AREA = { lake: 'lake', pond: 'pond', reservoir: 'reservoir', basin: 'basin', river: 'river', canal: 'canal', stream: 'river', oxbow: 'lake', lagoon: 'lake', fishpond: 'pond', wastewater: 'basin',
  reflecting_pool: 'pool', lock: 'canal', moat: 'pond', harbour: 'bay', bay: 'bay', sea: 'sea', ocean: 'ocean' };
const WATERWAYS = { river: 'river', stream: 'stream', canal: 'canal', ditch: 'ditch', drain: 'drain', tidal_channel: 'stream' };
const BARRIER_LINES = new Set(['fence', 'wall', 'hedge', 'guard_rail', 'retaining_wall', 'jersey_barrier', 'kerb', 'city_wall', 'handrail']);
const PARKING_TYPES = { surface: 'surface', 'multi-storey': 'multi-storey', multistorey: 'multi-storey', underground: 'underground', rooftop: 'rooftop', street_side: 'street_side', lane: 'lane', carports: 'surface', garage_boxes: 'surface', sheds: 'surface' };

// The building fields from OSM tags (building, building:part)
export function buildingFromTags(t, part = false) {
  const levels = num(t['building:levels']), minLevel = num(t['building:min_level']);
  const p = {
    h: round(metres(t.height)), mh: round(metres(t.min_height)) || undefined, fl: levels ?? undefined,
    b: t.building && t.building !== 'yes' ? t.building : (t['building:part'] && t['building:part'] !== 'yes' ? t['building:part'] : undefined),
    rs: t['roof:shape'] ?? undefined, rh: round(metres(t['roof:height'])), rd: num(t['roof:direction']) ?? undefined, ro: t['roof:orientation'] ?? undefined,
    fc: colour(t['building:colour'] ?? t.colour), rc: colour(t['roof:colour']), fm: t['building:material'] ?? undefined, rm: t['roof:material'] ?? undefined,
    pt: part ? 1 : undefined, pk: t.amenity === 'parking' || t.building === 'parking' ? PARKING_TYPES[t.parking] ?? 'multi-storey' : undefined,
  };
  if (p.mh == null && minLevel != null) p.mh = round(minLevel * 3);
  return p;
}

// A road's fields from OSM tags
export function roadFromTags(t) {
  const k = t.highway, link = /_link$/.test(k);
  const kind = link ? k.replace(/_link$/, '') : k;
  if (!ROAD_KINDS.has(kind) || t.area === 'yes') return null;
  const s = link ? 'link' : t.service && SUBS.has(t.service) ? t.service : t.footway && SUBS.has(t.footway) ? t.footway : undefined;
  const ow = t.oneway === '-1' ? -1 : ['yes', '1', 'true'].includes(t.oneway) || ((kind === 'motorway' || t.junction === 'roundabout') && t.oneway !== 'no') ? 1 : undefined;
  const lanes = parseInt(t.lanes, 10), width = metres(t.width ?? t['width:carriageway']);
  const layer = parseInt(t.layer, 10);
  return {
    k: kind, s, w: width && width >= 1 && width <= 60 ? round(width) : undefined, ln: lanes > 0 && lanes < 16 ? lanes : undefined, ow,
    br: t.bridge && t.bridge !== 'no' ? 1 : undefined, tn: t.tunnel && !['no', 'building_passage'].includes(t.tunnel) ? 1 : undefined, cv: t.covered === 'yes' || t.tunnel === 'building_passage' ? 1 : undefined,
    ly: Number.isFinite(layer) && layer ? layer : undefined, sf: surfaceOf(t.surface), sp: kmh(t.maxspeed) ?? undefined, n: DRIVABLE.has(kind) ? t.name ?? t.ref ?? undefined : undefined,
  };
}

// Any OSM feature's layer and fields: { layer, props } or null (nothing the game draws). shape: 'point'
// | 'line' | 'area' (a closed way that's an area, or a multipolygon)
export function classifyOsm(t, shape) {
  if (!t) return null;
  if (shape === 'area') {
    if (t.building && t.building !== 'no' && t.location !== 'underground' && t.building !== 'roof' || t['building:part'] && t['building:part'] !== 'no') return t['building:part'] && !t.building ? { layer: 'buildings', props: buildingFromTags(t, true) } : { layer: 'buildings', props: buildingFromTags(t, false) };
    if (t.building === 'roof') return { layer: 'buildings', props: { ...buildingFromTags(t), b: 'roof', mh: round(metres(t.min_height)) ?? 3 } };
    if (t.amenity === 'parking') return { layer: 'paved', props: { k: 'parking', pk: PARKING_TYPES[t.parking] ?? 'surface', sf: surfaceOf(t.surface) } };
    if (t.amenity === 'parking_space') return { layer: 'paved', props: { k: 'bay', sf: surfaceOf(t.surface) } };
    if (t.amenity === 'fuel') return { layer: 'paved', props: { k: 'fuel' } };
    if (t.highway === 'services' || t.highway === 'rest_area') return { layer: 'paved', props: { k: t.highway } };
    if (t.highway === 'pedestrian' || t.place === 'square' || t.area === 'yes' && t.highway === 'footway') return { layer: 'paved', props: { k: 'plaza', sf: surfaceOf(t.surface) } };
    if (t.area === 'yes' && t.highway === 'service' || t['area:highway'] === 'service') return { layer: 'paved', props: { k: 'driveway', sf: surfaceOf(t.surface) } };
    if (t.leisure === 'swimming_pool') return t.location === 'roof' || t.indoor === 'yes' ? null : { layer: 'water', props: { k: 'pool' } };
    if (t.amenity === 'fountain') return { layer: 'water', props: { k: 'pool' } };
    if (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir' || t.landuse === 'basin' || t.natural === 'bay' || t.water) {
      const k = WATER_AREA[t.water] ?? (t.waterway === 'riverbank' ? 'river' : t.landuse === 'reservoir' ? 'reservoir' : t.landuse === 'basin' ? 'basin' : t.natural === 'bay' ? 'bay' : 'lake');
      return { layer: 'water', props: { k } };
    }
    for (const key of ['landuse', 'leisure', 'natural', 'amenity', 'golf']) {
      const k = LANDUSE[key][t[key]];
      if (k) return { layer: 'landuse', props: { k } };
    }
    return null;
  }
  if (shape === 'line') {
    if (t.highway) { const r = roadFromTags(t); return r ? { layer: 'roads', props: r } : null; }
    if (RAIL_KINDS.has(t.railway)) { const layer = parseInt(t.layer, 10); return { layer: 'rail', props: { k: t.railway, br: t.bridge && t.bridge !== 'no' ? 1 : undefined, tn: t.tunnel && t.tunnel !== 'no' ? 1 : undefined, ly: Number.isFinite(layer) && layer ? layer : undefined } }; }
    if (WATERWAYS[t.waterway] && t.tunnel !== 'culvert' && t.layer !== '-1') return { layer: 'water', props: { k: WATERWAYS[t.waterway], w: round(metres(t.width)) } };
    if (t.natural === 'tree_row') return { layer: 'details', props: { k: 'tree_row' } };
    if (BARRIER_LINES.has(t.barrier)) return { layer: 'details', props: { k: t.barrier === 'handrail' ? 'fence' : t.barrier, h: round(metres(t.height)) } };
    if (t.natural === 'cliff') return null;
    return null;
  }
  // points
  if (t.natural === 'tree') return { layer: 'details', props: { k: 'tree', h: round(metres(t.height)) } };
  if (t.highway === 'street_lamp') return { layer: 'details', props: { k: 'lamp' } };
  if (t.highway === 'traffic_signals') return { layer: 'details', props: { k: 'signals' } };
  if (t.highway === 'crossing' || t.crossing) return t.crossing === 'unmarked' || t.crossing === 'no' ? null : { layer: 'details', props: { k: 'crossing' } };
  if (t.highway === 'stop') return { layer: 'details', props: { k: 'stop' } };
  if (t.highway === 'give_way') return { layer: 'details', props: { k: 'give_way' } };
  if (t.barrier === 'bollard') return { layer: 'details', props: { k: 'bollard' } };
  if (t.barrier === 'gate' || t.barrier === 'lift_gate' || t.barrier === 'swing_gate') return { layer: 'details', props: { k: 'gate' } };
  if (t.emergency === 'fire_hydrant') return { layer: 'details', props: { k: 'hydrant' } };
  return null;
}

// ---------- what each zoom keeps ----------
// z14: everything. z12 and z10: the distance — fewer, simpler features (areas smaller than minArea m²
// left out, lines simplified to `simplify` tile units, buildings shorter than minHeight left out at 10)
export const ZOOM_RULES = {
  14: { extent: 8192, simplify: 0.5 },
  12: { extent: 4096, simplify: 1, roads: p => DRIVABLE.has(p.k) && !['parking_aisle', 'driveway', 'alley', 'drive-through', 'emergency_access'].includes(p.s) && p.k !== 'track', rail: p => p.k !== 'tram',
    minArea: { buildings: 200, landuse: 2000, cover: 20000, water: 500, paved: 1500 }, details: () => false, places: p => p.k !== 'microhood', keep: { roads: ['k', 's', 'br', 'tn', 'ly', 'w', 'ln', 'ow'], buildings: ['h', 'mh', 'fl', 'b', 'rs', 'fc', 'rc', 'pt', 'hp'] } },
  10: { extent: 4096, simplify: 1.5, roads: p => ['motorway', 'trunk', 'primary', 'secondary'].includes(p.k), rail: p => p.k === 'rail', minArea: { buildings: 400, landuse: 40000, cover: 200000, water: 20000, paved: 20000 },
    details: () => false, buildings: p => (p.h ?? (p.fl ?? 0) * 3) >= 25, places: p => ['county', 'locality', 'localadmin', 'borough'].includes(p.k), keep: { roads: ['k', 'br', 'tn', 'ly'], buildings: ['h', 'mh', 'fl', 'b', 'fc', 'rc', 'pt', 'hp'] } },
};
