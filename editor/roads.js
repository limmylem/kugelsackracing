// The roads under a place, for the editor: snap a marker to the nearest road (and face it along the
// road), and say which road it's on and the nearest intersection. Two sources:
//   - a baked region's road graph (map/format/graph.ts: OSM's drivable ways, heights from the road's own
//     profile — the same road the game drives on), wherever a region covers;
//   - anywhere else on Earth, OpenFreeMap's map tiles (OpenStreetMap's roads, as the Phase 0 world reads
//     them), at zoom 14: names and directions, no heights (those come from the 3D view, or the terrain).
//
//   const roads = createRoadFinder({ regions: [{ manifestUrl }], tiles: { url, fetch } })
//   await roads.snap(lat, lon, { heading, reach }) → { lat, lon, alt, altFrom, heading, road } | null
//   await roads.describe(lat, lon) → road (its name, class, source, nearest intersection) | null

import { transverseMercator } from '../map/build/format/projection.js';
import { decodeTile } from '../world/mvt.js';
import { inBox } from '../content/geo.js';

const DRIVE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'track', 'raceway', 'busway']);
const GRID = 50;                   // m: the graph's lookup grid
const wrap = d => ((d % 360) + 360) % 360;
const turnBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

async function gunzipJson(res) {
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return JSON.parse(new TextDecoder().decode(bytes));        // (the server unzipped it already)
  if (typeof DecompressionStream !== 'undefined') return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  const zlib = await import('node:zlib');
  return JSON.parse(zlib.gunzipSync(bytes).toString());
}

// a baked region's graph, ready for lookups: a grid of its pieces, its junctions
async function loadRegion(manifestUrl, fetchFn) {
  const manifest = await (await fetchFn(manifestUrl)).json();
  const base = new URL('.', new URL(manifestUrl, globalThis.location?.href ?? 'file:///')).href;
  const P = transverseMercator(manifest.projection.lat0, manifest.projection.lon0);
  // (the region's box, [west, south, east, north] in the manifest, as [south, west, north, east])
  const bbox = manifest.bbox ? [manifest.bbox[1], manifest.bbox[0], manifest.bbox[3], manifest.bbox[2]] : null;
  let graph = null;
  const load = () => graph ??= (async () => {
    const G = await gunzipJson(await fetchFn(new URL(manifest.files.graph, base).href));
    const grid = new Map(), deg = new Map(), at = new Map();
    for (const seg of G.segs) {
      for (const n of [seg.from, seg.to]) { deg.set(n, (deg.get(n) ?? 0) + 1); (at.get(n) ?? at.set(n, []).get(n)).push(seg); }
      const P_ = seg.points;
      for (let k = 0; k + 5 < P_.length; k += 3) {
        const x0 = Math.min(P_[k], P_[k + 3]), x1 = Math.max(P_[k], P_[k + 3]), z0 = Math.min(P_[k + 1], P_[k + 4]), z1 = Math.max(P_[k + 1], P_[k + 4]);
        for (let i = Math.floor(x0 / GRID); i <= Math.floor(x1 / GRID); i++) for (let j = Math.floor(z0 / GRID); j <= Math.floor(z1 / GRID); j++) { const key = `${i},${j}`; (grid.get(key) ?? grid.set(key, []).get(key)).push([seg, k]); }
      }
    }
    // junctions (three or more roads) on a grid of their own
    const junctions = new Map();
    for (const [n, d] of deg) if (d >= 3) { const key = `${Math.floor(G.nodes.x[n] / 200)},${Math.floor(G.nodes.z[n] / 200)}`; (junctions.get(key) ?? junctions.set(key, []).get(key)).push(n); }
    return { G, grid, at, junctions };
  })();
  return { manifest, P, bbox, base, load, contains: (lat, lon) => (!bbox || inBox(bbox, lat, lon)) && covers(manifest, P, lat, lon) };
}
function covers(manifest, P, lat, lon) {
  const [x, z] = P.toXZ(lat, lon), g = manifest.grid, T = g?.tileSize ?? 512;
  if (!g) return false;
  const i = Math.floor(x / T), j = Math.floor(z / T);
  return (manifest.tiles ?? []).some(t => t.i === i && t.j === j);
}

function nearestOnGraph(R, x, z, reach) {
  let best = null;
  const r = Math.ceil(reach / GRID);
  for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (const [seg, k] of R.grid.get(`${Math.floor(x / GRID) + a},${Math.floor(z / GRID) + b}`) ?? []) {
    const P_ = seg.points, ax = P_[k], az = P_[k + 1], dx = P_[k + 3] - ax, dz = P_[k + 4] - az, L2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)), px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
    if (d <= reach && (!best || d < best.d)) best = { d, seg, k, t, x: px, z: pz, h: P_[k + 2] + (P_[k + 5] - P_[k + 2]) * t, dir: [dx, dz] };
  }
  return best;
}
function junctionNear(R, seg, x, z) {
  let best = null;
  for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (const n of R.junctions.get(`${Math.floor(x / 200) + a},${Math.floor(z / 200) + b}`) ?? []) {
    const d = Math.hypot(R.G.nodes.x[n] - x, R.G.nodes.z[n] - z);
    if (d > 400 || (best && d >= best.d)) continue;
    const names = [...new Set(R.at.get(n).map(s => s.name).filter(nm => nm && nm !== seg.name))];
    best = { d, n, names };
  }
  if (!best) return null;
  const others = best.names.length ? best.names.join(' & ') : 'an unnamed road';
  return { name: seg.name ? `${seg.name} & ${others}` : others, distanceM: Math.round(best.d) };
}

export function createRoadFinder({ regions = [], tiles = null, fetch: fetchFn = (...a) => fetch(...a) } = {}) {
  const loaded = Promise.all(regions.map(r => loadRegion(r.manifestUrl, fetchFn).catch(e => { console.warn(`No road graph from ${r.manifestUrl}: ${e.message}`); return null; }))).then(l => l.filter(Boolean));
  // OpenFreeMap's tiles (z14), kept a while
  const tileCache = new Map();
  let tileUrl = tiles?.url ?? null;
  async function vectorTile(x, y) {
    const key = `${x}/${y}`;
    if (tileCache.has(key)) return tileCache.get(key);
    const p = (async () => {
      tileUrl ??= (await (await fetchFn(tiles?.tilejson ?? 'https://tiles.openfreemap.org/planet')).json()).tiles[0];
      const r = await fetchFn(tileUrl.replace('{z}', '14').replace('{x}', x).replace('{y}', y));
      if (!r.ok) throw new Error(`map tile 14/${x}/${y}: HTTP ${r.status}`);
      return decodeTile(new Uint8Array(await r.arrayBuffer()));
    })();
    tileCache.set(key, p);
    if (tileCache.size > 64) tileCache.delete(tileCache.keys().next().value);
    p.catch(() => tileCache.delete(key));
    return p;
  }
  const regionAt = async (lat, lon) => (await loaded).find(R => R.contains(lat, lon)) ?? null;

  async function onGraph(R, lat, lon, reach) {
    const D = await R.load(), [x, z] = R.P.toXZ(lat, lon), hit = nearestOnGraph(D, x, z, reach);
    if (!hit) return null;
    const [la, lo] = R.P.toLatLon(hit.x, hit.z), ahead = wrap(Math.atan2(hit.dir[0], -hit.dir[1]) * 180 / Math.PI);
    return { lat: la, lon: lo, alt: Math.round(hit.h * 100) / 100, altFrom: 'road', ahead, oneway: hit.seg.oneway, distanceM: hit.d,
      road: { name: hit.seg.name ?? null, class: hit.seg.class ?? null, source: 'graph', segment: hit.seg.id, intersection: junctionNear(D, hit.seg, hit.x, hit.z) } };
  }
  async function onTiles(lat, lon, reach) {
    const n = 2 ** 14, fx = (lon + 180) / 360 * n, fy = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n;
    const vt = await vectorTile(Math.floor(fx), Math.floor(fy));
    const T = vt.transportation, names = vt.transportation_name;
    if (!T) return null;
    const ext = T.extent, mPer = 40075016.7 * Math.cos(lat * Math.PI / 180) / n / ext;        // m a tile unit
    const px = (fx - Math.floor(fx)) * ext, py = (fy - Math.floor(fy)) * ext;
    let best = null;
    for (const f of T.features) {
      if (f.type !== 2 || !DRIVE.has(f.properties.class) || f.properties.brunnel === 'tunnel') continue;
      for (const line of f.geometry) for (let k = 0; k + 1 < line.length; k++) {
        const [ax, ay] = line[k], dx = line[k + 1][0] - ax, dy = line[k + 1][1] - ay, L2 = dx * dx + dy * dy || 1e-9;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)), qx = ax + dx * t, qy = ay + dy * t, d = Math.hypot(px - qx, py - qy) * mPer;
        if (d <= reach && (!best || d < best.d)) best = { d, f, qx, qy, dir: [dx, dy] };
      }
    }
    if (!best) return null;
    const lonOf = qx => (Math.floor(fx) + qx / ext) / n * 360 - 180, latOf = qy => Math.atan(Math.sinh(Math.PI * (1 - 2 * (Math.floor(fy) + qy / ext) / n))) * 180 / Math.PI;
    // the road's name: transportation_name's nearest line (OpenMapTiles keeps names in their own layer)
    let name = best.f.properties.name ?? null, nearest = Infinity;
    if (!name && names) for (const f of names.features) for (const line of f.geometry ?? []) for (const [x, y] of line) { const d = Math.hypot(x - best.qx, y - best.qy); if (d < nearest && d * mPer < 30) { nearest = d; name = f.properties.name ?? f.properties['name:latin'] ?? null; } }
    // the nearest intersection: a point two named lines share
    const shared = new Map();
    if (names) for (const f of names.features) for (const line of f.geometry ?? []) for (const [x, y] of line) { const key = `${x},${y}`, nm = f.properties.name; if (!nm) continue; (shared.get(key) ?? shared.set(key, new Set()).get(key)).add(nm); }
    let inter = null;
    for (const [key, set] of shared) { if (set.size < 2) continue; const [x, y] = key.split(',').map(Number), d = Math.hypot(x - best.qx, y - best.qy) * mPer; if (d < 400 && (!inter || d < inter.d)) inter = { d, set }; }
    return { lat: latOf(best.qy), lon: lonOf(best.qx), alt: null, altFrom: null, ahead: wrap(Math.atan2(best.dir[0], -best.dir[1]) * 180 / Math.PI), oneway: best.f.properties.oneway ? 1 : 0, distanceM: best.d,
      road: { name, class: best.f.properties.class ?? null, source: 'tiles', segment: null, intersection: inter ? { name: [...inter.set].join(' & '), distanceM: Math.round(inter.d) } : null } };
  }

  async function find(lat, lon, reach) {
    const R = await regionAt(lat, lon);
    if (R) return onGraph(R, lat, lon, reach);
    if (tiles === false) return null;
    try { return await onTiles(lat, lon, reach); } catch (e) { return { error: `The map's roads aren't reachable here (${e.message}).` }; }
  }

  return {
    // the nearest road within reach m: the place on it, facing along it (the way nearest the heading
    // given; a one-way street: its way)
    async snap(lat, lon, { heading = 0, reach = 60 } = {}) {
      const r = await find(lat, lon, reach);
      if (!r || r.error) return r;
      const back = wrap(r.ahead + 180), facing = r.oneway === 1 ? r.ahead : r.oneway === -1 ? back : (turnBetween(heading, r.ahead) <= 90 ? r.ahead : back);
      return { lat: r.lat, lon: r.lon, alt: r.alt, altFrom: r.altFrom, heading: Math.round(facing * 10) / 10 % 360, road: r.road, distanceM: r.distanceM };
    },
    async describe(lat, lon) { const r = await find(lat, lon, 40); return r?.error ? null : r?.road ?? null; },
    async regionAt(lat, lon) { return (await regionAt(lat, lon))?.manifest ?? null; },
    async heightAt(lat, lon) { const R = await regionAt(lat, lon); if (!R) return null; const r = await onGraph(R, lat, lon, 25); return r ? { alt: r.alt, altFrom: 'road' } : null; },
  };
}
