// The region's OpenStreetMap data, read from its clipped extract (map/bake/sources.ts) into what the bake
// works with: every point keeps its original lat/lon and OSM node id, next to its projected x, z (the
// region's transverse Mercator). Multipolygons are assembled into rings (member ways joined end to end).
//
//   const D = readOsm(file, P)
//   D.roads: [{ id, tags, nodes: [{ id, lat, lon, x, z }] }]   highway=* lines (drivable and paths)
//   D.areas: [{ id, tags, rings: [[{ lat, lon, x, z }]] (outer first, then holes; several outers allowed via parts) }]
//   D.lines: [{ id, tags, nodes }]   barriers, tree rows, waterways, railways
//   D.points: [{ id, tags, lat, lon, x, z }]   trees, places, signals…

import fs from 'node:fs';
import { readPbf } from './osmPbf.ts';
import type { Projection } from '../format/projection.ts';

export interface Pt { id: number; lat: number; lon: number; x: number; z: number }
export interface Way { id: number; tags: Record<string, string>; nodes: Pt[] }
export interface Area { id: number; tags: Record<string, string>; parts: Pt[][][] }   // parts → rings (outer, holes…)
export interface OsmData { roads: Way[]; areas: Area[]; lines: Way[]; points: (Pt & { tags: Record<string, string> })[] }

const AREA_KEYS = ['building', 'building:part', 'landuse', 'natural', 'leisure', 'amenity', 'water', 'waterway', 'place', 'boundary', 'parking', 'man_made', 'aeroway', 'area:highway'];
const LINE_KEYS = ['barrier', 'railway', 'waterway', 'natural'];
const isArea = (t: Record<string, string>, closed: boolean) => closed && (t.area === 'yes' || AREA_KEYS.some(k => t[k] && !(k === 'natural' && ['tree_row', 'cliff', 'coastline'].includes(t[k])) && !(k === 'waterway' && !['riverbank', 'dock', 'boatyard'].includes(t[k])) && !(k === 'barrier')));

export function readOsm(file: string, P: Projection): OsmData {
  const { nodes, points, ways, relations } = (readPbf as any)(new Uint8Array(fs.readFileSync(file)), {
    wantWay: t => !!(t.highway || t.barrier || t.railway || t.waterway || AREA_KEYS.some(k => t[k]) || t.natural || t.area),
    wantRelation: t => t.type === 'multipolygon' || t.type === 'boundary',
    wantNode: t => !!(t.natural === 'tree' || t.place || t.highway || t.barrier || t.amenity),
  });
  const pt = (id: number): Pt | null => { const c = nodes.get(id); if (!c) return null; const [x, z] = P.toXZ(c[1], c[0]); return { id, lat: c[1], lon: c[0], x, z }; };
  const out: OsmData = { roads: [], areas: [], lines: [], points: [] };
  const inRelation = new Set<number>();
  for (const r of relations) for (const m of r.members) if (m.type === 'w') inRelation.add(m.ref);
  // (deterministic: everything in id order)
  for (const w of [...ways.values()].sort((a, b) => a.id - b.id)) {
    const ns = w.refs.map(pt).filter(Boolean) as Pt[];
    if (ns.length < 2) continue;
    const t = w.tags, closed = w.refs.length > 3 && w.refs[0] === w.refs[w.refs.length - 1];
    if (t.highway && !isArea({ ...t, highway: undefined } as any, closed && (t.area === 'yes' || t.highway === 'pedestrian' && closed && t.area === 'yes'))) { out.roads.push({ id: w.id, tags: t, nodes: ns }); continue; }
    if (isArea(t, closed)) { out.areas.push({ id: w.id, tags: t, parts: [[ns]] }); continue; }
    if (LINE_KEYS.some(k => t[k]) && !inRelation.has(w.id)) out.lines.push({ id: w.id, tags: t, nodes: ns });
  }
  // multipolygons: outer rings joined from their ways, each with the holes inside it
  for (const r of [...relations].sort((a, b) => a.id - b.id)) {
    if (r.tags.type !== 'multipolygon') continue;
    const rings = (role: string) => joinRings(r.members.filter(m => m.type === 'w' && (m.role || 'outer') === role).map(m => ways.get(m.ref)?.refs).filter(Boolean)).map(rr => rr.map(pt).filter(Boolean) as Pt[]).filter(rr => rr.length >= 4);
    const outers = rings('outer'), inners = rings('inner');
    if (!outers.length) continue;
    const parts = outers.map(o => [o, ...inners.filter(h => inside(h[0], o))]);
    // (a relation's tags, or its single outer way's, old style)
    const tags = Object.keys(r.tags).length > 1 ? r.tags : ways.get(r.members.find(m => m.role === 'outer')?.ref)?.tags ?? r.tags;
    out.areas.push({ id: 1e12 + r.id, tags, parts });
  }
  for (const p of points.sort((a, b) => a.id - b.id)) { const [x, z] = P.toXZ(p.lat, p.lon); out.points.push({ id: p.id, lat: p.lat, lon: p.lon, x, z, tags: p.tags }); }
  return out;
}

// member ways (node id lists) joined end to end into closed rings
function joinRings(list: number[][]): number[][] {
  const left = list.map(l => l.slice()), rings: number[][] = [];
  while (left.length) {
    let ring = left.shift()!;
    for (let grew = true; grew && ring[0] !== ring[ring.length - 1];) {
      grew = false;
      for (let k = 0; k < left.length; k++) {
        const w = left[k], a = ring[ring.length - 1];
        if (w[0] === a) ring = ring.concat(w.slice(1));
        else if (w[w.length - 1] === a) ring = ring.concat(w.slice(0, -1).reverse());
        else continue;
        left.splice(k, 1); grew = true; break;
      }
    }
    if (ring[0] === ring[ring.length - 1]) rings.push(ring);
  }
  return rings;
}
export function inside(p: { x: number; z: number }, ring: { x: number; z: number }[]) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if ((ring[i].z > p.z) !== (ring[j].z > p.z) && p.x < (ring[j].x - ring[i].x) * (p.z - ring[i].z) / (ring[j].z - ring[i].z) + ring[i].x) c = !c;
  return c;
}
