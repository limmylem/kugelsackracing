// The real world's map, read from the world's map tiles (a region's .pmtiles file, built offline by
// npm run world:build: docs/WORLD_DATA.md) — no map server at run time. What the collision needs for an
// area, in the shape surface.js takes (realworld/osm.js readOverpass's): the roads with their OSM-style
// tags and shared node ids where they meet, buildings and barriers. The drawing reads the same tiles,
// so what's drawn and what the car drives on come from the same data.
//
// Roads cut at tile edges are joined back up (the pipeline cuts them at exactly the same point on both
// sides), and a point's node id comes from its exact place in the tiles, so roads that meet share it.
//
//   const map = createMapReader({ regions })   regions: data/world/regions.json's list
//   await map.area(south, west, north, east) → { roads, buildings, barriers, covered (is it in a region) }

import { openPmtiles, httpSource } from '../world/pmtiles.js';
import { decodeTile } from '../world/mvt.js';
import { DETAIL_ZOOM, tileToLonLat, tilesInBbox } from '../world/tiles.js';
import { DRIVABLE } from '../world/schema.js';

const TILE_CACHE = 48;                 // decoded tiles kept

// A road's fields → the OSM tags surface.js reads (realworld/osm.js roadInfo)
export function tagsOf(p) {
  const t = { highway: p.s === 'link' && ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(p.k) ? `${p.k}_link` : p.k === 'road' ? 'road' : p.k };
  if (p.ln) t.lanes = String(p.ln);
  if (p.w) t.width = String(p.w);
  if (p.ow) t.oneway = p.ow === -1 ? '-1' : 'yes';
  else if (p.k === 'motorway' || p.s === 'link') t.oneway = 'no';
  if (p.br) t.bridge = 'yes';
  if (p.tn) t.tunnel = 'yes';
  if (p.cv && !p.tn) t.covered = 'yes';
  if (p.ly) t.layer = String(p.ly);
  if (p.sf) t.surface = p.sf;
  if (p.n) t.name = p.n;
  if (['driveway', 'parking_aisle', 'alley'].includes(p.s)) t.service = p.s;
  return t;
}

export function createMapReader({ regions = [], baseUrl = '', fetchFn = fetch } = {}) {
  const files = new Map(), tiles = new Map(), nodeIds = new Map();
  const open = region => {
    if (!files.has(region.id)) files.set(region.id, openPmtiles(httpSource(new URL(region.url, baseUrl || globalThis.location?.href).href, { fetchFn })).catch(e => { files.delete(region.id); throw e; }));
    return files.get(region.id);
  };
  const regionOf = (lat, lon) => regions.find(r => lon >= r.bbox[0] && lon <= r.bbox[2] && lat >= r.bbox[1] && lat <= r.bbox[3]) ?? null;
  async function tile(region, x, y) {
    const key = `${region.id}/${x}/${y}`;
    if (!tiles.has(key)) {
      tiles.set(key, (async () => { const pm = await open(region), b = await pm.tile(DETAIL_ZOOM, x, y); return b ? decodeTile(b) : {}; })());
      tiles.get(key).catch(() => tiles.delete(key));
      if (tiles.size > TILE_CACHE) tiles.delete(tiles.keys().next().value);
    }
    return tiles.get(key);
  }
  // a point's node id: the same for the same exact place (world tile units at zoom 14)
  const nodeOf = (wx, wy) => { const k = `${wx},${wy}`; let id = nodeIds.get(k); if (id === undefined) { id = nodeIds.size + 1; nodeIds.set(k, id); } return id; };

  return {
    regionOf,
    async area(south, west, north, east) {
      const box = [west, south, east, north], hit = regions.filter(r => r.bbox[0] <= east && r.bbox[2] >= west && r.bbox[1] <= north && r.bbox[3] >= south);
      const pieces = new Map(), buildings = [], barriers = [];
      for (const region of hit) for (const [x, y] of tilesInBbox(DETAIL_ZOOM, box)) {
        const T = await tile(region, x, y);
        const E = T.roads?.extent ?? T.buildings?.extent ?? 8192, toLonLat = (u, v) => tileToLonLat(x + u / E, y + v / E, DETAIL_ZOOM);
        for (const f of T.roads?.features ?? []) {
          if (!DRIVABLE.has(f.properties.k)) continue;
          for (const line of f.geometry) {
            const pts = line.map(([u, v]) => ({ w: [x * E + u, y * E + v], ll: toLonLat(u, v) }));
            (pieces.get(f.id) ?? pieces.set(f.id, []).get(f.id)).push({ pts, props: f.properties });
          }
        }
        for (const f of T.buildings?.features ?? []) {
          if (f.properties.pt) continue;
          buildings.push({ id: f.id, rings: f.geometry.flatMap(p => p).map(r => { const out = new Float64Array(r.length * 2 + 2); [...r, r[0]].forEach(([u, v], i) => { const [lon, lat] = toLonLat(u, v); out[2 * i] = lat; out[2 * i + 1] = lon; }); return out; }), tags: { building: f.properties.b ?? 'yes', ...(f.properties.h && { height: String(f.properties.h) }) } });
        }
        for (const f of T.details?.features ?? []) {
          if (f.type !== 2 || !['wall', 'fence', 'guard_rail', 'retaining_wall', 'jersey_barrier', 'city_wall'].includes(f.properties.k)) continue;
          for (const line of f.geometry) { const ll = line.map(([u, v]) => toLonLat(u, v)); barriers.push({ id: f.id, lat: Float64Array.from(ll, p => p[1]), lon: Float64Array.from(ll, p => p[0]), tags: { barrier: f.properties.k } }); }
        }
      }
      // roads: the pieces of each joined end to start (cut at tile edges)
      const roads = [];
      const key = p => `${p.w[0]},${p.w[1]}`;
      for (const [id, list] of pieces) {
        const left = list.slice(), chains = [];
        while (left.length) {
          let c = left.shift().pts.slice(), props = list[0].props;
          for (let grew = true; grew;) {
            grew = false;
            for (let i = 0; i < left.length; i++) {
              const p = left[i].pts;
              if (key(p[0]) === key(c.at(-1))) { c = c.concat(p.slice(1)); left.splice(i, 1); grew = true; break; }
              if (key(p.at(-1)) === key(c[0])) { c = p.concat(c.slice(1)); left.splice(i, 1); grew = true; break; }
            }
          }
          chains.push({ c, props });
        }
        chains.forEach(({ c, props }, n) => roads.push({
          id: chains.length > 1 ? `${id}/${n}` : id, nodes: c.map(p => nodeOf(...p.w)),
          lat: Float64Array.from(c, p => p.ll[1]), lon: Float64Array.from(c, p => p.ll[0]), tags: tagsOf(props),
        }));
      }
      return { roads, buildings, barriers, covered: hit.length > 0 };
    },
  };
}
