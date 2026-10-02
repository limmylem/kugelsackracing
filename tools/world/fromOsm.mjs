// An OpenStreetMap extract (.osm.pbf, tools/world/osmPbf.mjs) → the world's features (world/schema.js),
// classified by their tags as the Overture-derived ones are: roads (split where they meet other roads, so
// a junction is always the end of each road there), railways, land use, water, car parks, buildings,
// trees, street lamps, barriers… Closed ways that are areas become areas; multipolygon relations are
// put together from their member ways. The coastline isn't read (the sea comes from Overture's ocean).
//
//   await osmFeatures(file, { bbox, log }) → features { layer, id, geometry (GeoJSON), props }
//   osmToFeatures({ nodes, points, ways, relations }, { bbox }) (the same, from what readPbf gives)

import fs from 'node:fs';
import { readPbf } from './osmPbf.mjs';
import { classifyOsm, idOf } from '../../world/schema.js';

// keys that make a closed way an area (unless area=no); highways and barriers only with area=yes
const AREA_KEYS = ['building', 'building:part', 'landuse', 'leisure', 'natural', 'amenity', 'water', 'waterway', 'place', 'golf', 'area:highway', 'man_made'];
const LINE_ONLY = { natural: new Set(['tree_row', 'cliff', 'coastline', 'ridge', 'arete']), waterway: new Set(['river', 'stream', 'canal', 'ditch', 'drain', 'tidal_channel']) };
function isArea(w, tags) {
  if (w.refs.length < 4 || w.refs[0] !== w.refs.at(-1)) return false;
  if (tags.area === 'no') return false;
  if (tags.area === 'yes') return true;
  if (tags.highway || tags.barrier || tags.railway) return false;
  return AREA_KEYS.some(k => tags[k] && !LINE_ONLY[k]?.has(tags[k]));
}
const inBox = ([lon, lat], b) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];

// rings from member ways (joined end to end)
function joinRings(ways, nodes) {
  const lines = ways.map(w => w.refs.slice()).filter(r => r.length >= 2), rings = [];
  while (lines.length) {
    let ring = lines.shift();
    for (let grew = true; grew && ring[0] !== ring.at(-1);) {
      grew = false;
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (l[0] === ring.at(-1)) ring = ring.concat(l.slice(1));
        else if (l.at(-1) === ring.at(-1)) ring = ring.concat(l.slice(0, -1).reverse());
        else if (l.at(-1) === ring[0]) ring = l.concat(ring.slice(1));
        else if (l[0] === ring[0]) ring = l.slice().reverse().concat(ring.slice(1));
        else continue;
        lines.splice(i, 1); grew = true; break;
      }
    }
    if (ring.length >= 4 && ring[0] === ring.at(-1)) { const c = ring.map(id => nodes.get(id)); if (c.every(Boolean)) rings.push(c); }
  }
  return rings;
}
const ringArea = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a / 2; };
function pointInRing([x, y], r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside;
  return inside;
}

export function osmToFeatures({ nodes, points, ways, relations }, { bbox = null } = {}) {
  const out = [];
  // (how many roads use each node: a road is cut where another meets it)
  const uses = new Map();
  for (const w of ways.values()) if (w.tags.highway && !isArea(w, w.tags)) for (const r of new Set(w.refs)) uses.set(r, (uses.get(r) ?? 0) + 1);
  for (const w of ways.values()) {
    const tags = w.tags;
    if (!Object.keys(tags).length) continue;
    const coords = w.refs.map(id => nodes.get(id));
    if (coords.some(c => !c)) continue;
    if (bbox && !coords.some(c => inBox(c, bbox))) continue;
    if (isArea(w, tags)) {
      const f = classifyOsm(tags, 'area');
      if (f) out.push({ layer: f.layer, id: idOf(`w${w.id}`), geometry: { type: 'Polygon', coordinates: [coords] }, props: f.props });
      continue;
    }
    const f = classifyOsm(tags, 'line');
    if (!f) continue;
    if (f.layer !== 'roads') { out.push({ layer: f.layer, id: idOf(`w${w.id}`), geometry: { type: 'LineString', coordinates: coords }, props: f.props }); continue; }
    // roads: cut at every node another road shares
    let start = 0, n = 0;
    for (let i = 1; i < w.refs.length; i++) {
      if (i < w.refs.length - 1 && (uses.get(w.refs[i]) ?? 0) < 2) continue;
      out.push({ layer: 'roads', id: idOf(n ? `w${w.id}/${n}` : `w${w.id}`), geometry: { type: 'LineString', coordinates: coords.slice(start, i + 1) }, props: f.props });
      start = i; n++;
    }
  }
  for (const r of relations) {
    if (r.tags.type !== 'multipolygon' && r.tags.type !== 'building') continue;
    const f = classifyOsm(r.tags, 'area');
    if (!f) continue;
    const member = role => r.members.filter(m => m.type === 'w' && m.role === role && ways.has(m.ref)).map(m => ways.get(m.ref));
    const outers = joinRings([...member('outer'), ...member('')], nodes), inners = joinRings(member('inner'), nodes);
    if (!outers.length || (bbox && !outers.some(o => o.some(c => inBox(c, bbox))))) continue;
    const polys = outers.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a))).map(o => [o]);
    for (const h of inners) (polys.find(p => pointInRing(h[0], p[0])) ?? polys[0]).push(h);
    out.push({ layer: f.layer, id: idOf(`r${r.id}`), geometry: polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys }, props: f.props });
  }
  for (const p of points) {
    if (bbox && !inBox([p.lon, p.lat], bbox)) continue;
    const f = classifyOsm(p.tags, 'point');
    if (f) out.push({ layer: f.layer, id: idOf(`n${p.id}`), geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, props: f.props });
  }
  return out;
}

export async function osmFeatures(file, { bbox = null, log = null } = {}) {
  log?.(`  reading ${file}…`);
  const data = readPbf(new Uint8Array(fs.readFileSync(file)), {
    wantWay: t => Object.keys(t).length > 0,
    wantRelation: t => (t.type === 'multipolygon' || t.type === 'building') && Object.keys(t).length > 1,
    wantNode: t => !!classifyOsm(t, 'point'),
  });
  return osmToFeatures(data, { bbox });
}
