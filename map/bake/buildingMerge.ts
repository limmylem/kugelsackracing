// Map v3's buildings: OpenStreetMap's footprints, merged with Overture Maps' buildings — where both have a
// building, OSM's footprint wins and Overture fills in what OSM doesn't say (height, floors, roof shape,
// colours); where only Overture has one (its machine-learnt footprints), Overture's is used. Then each
// one's height, from the best thing known, and which that was:
//   tag (OSM height) → overture (Overture's height) → floors (floors × a storey) → nearby (the median
//   of the known heights round it) → default (by kind, else by footprint size)
// — 'nearby' and 'default' marked estimated.
//
//   const B = mergeBuildings(osm, overtureRows, P, cfg) → [{ id, source, rings (x, z), props, hs, estimated }]

import type { OsmData } from './osmData.ts';
import type { Projection } from '../format/projection.ts';
import { inside } from './osmData.ts';
import { heightOf } from './extrude.ts';

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined; };
const metres = (v?: string) => { if (!v) return undefined; const s = String(v).trim().toLowerCase(); const ft = s.match(/^([\d.]+)\s*(?:'|ft)/); return ft ? +ft[1] * 0.3048 : num(s); };
const colour = (v?: string) => (v && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined);

export interface Building { id: number; source: 'osm' | 'overture'; dataset: string; rings: number[][][]; props: any; hs: string; estimated: boolean; part: boolean }

export function mergeBuildings(osm: OsmData, overture: any[], P: Projection, cfg) {
  const out: Building[] = [];
  // OSM's: outlines and parts (an outline with parts is drawn as its parts)
  const osmB = osm.areas.filter(a => a.tags.building || a.tags['building:part']);
  const grid = new Map<string, number[]>(), CELL = 100, key = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  osmB.forEach((a, k) => { for (const ring of a.parts.map(p => p[0])) { let xa = Infinity, xb = -Infinity, za = Infinity, zb = -Infinity; for (const p of ring) { xa = Math.min(xa, p.x); xb = Math.max(xb, p.x); za = Math.min(za, p.z); zb = Math.max(zb, p.z); } for (let x = Math.floor(xa / CELL); x <= Math.floor(xb / CELL); x++) for (let z = Math.floor(za / CELL); z <= Math.floor(zb / CELL); z++) { const kk = `${x},${z}`; (grid.get(kk) ?? grid.set(kk, []).get(kk)!).push(k); } } });
  const containing = (x: number, z: number, parts: boolean | null = null) => (grid.get(key(x, z)) ?? []).find(k => (parts === null || !!osmB[k].tags['building:part'] === parts) && osmB[k].parts.some(p => inside({ x, z }, p[0]) && !p.slice(1).some(h => inside({ x, z }, h))));
  const extra = new Map<number, any>();          // OSM building index → what Overture adds
  const centroid = (ring: { x: number; z: number }[]) => { let x = 0, z = 0; for (const p of ring) { x += p.x; z += p.z; } return { x: x / ring.length, z: z / ring.length }; };
  // which outlines have parts
  const hasParts = new Set<number>();
  osmB.forEach(a => { if (a.tags['building:part']) { const c = centroid(a.parts[0][0]), k = containing(c.x, c.z, false); if (k !== undefined) hasParts.add(k); } });
  for (const r of overture) {
    if (r.is_underground || !r.geometry) continue;
    const polys = r.geometry.type === 'Polygon' ? [r.geometry.coordinates] : r.geometry.type === 'MultiPolygon' ? r.geometry.coordinates : [];
    if (!polys.length) continue;
    const rings = polys.map(p => p.map(ring => ring.map(([lon, lat]) => { const [x, z] = P.toXZ(lat, lon); return { x, z }; })));
    const c = centroid(rings[0][0]), k = containing(c.x, c.z);
    const attrs = { h: r.height ?? undefined, mh: r.min_height ?? undefined, fl: r.num_floors ?? undefined, rs: r.roof_shape ?? undefined, rh: r.roof_height ?? undefined, fc: colour(r.facade_color), rc: colour(r.roof_color), b: r.class ?? undefined };
    if (k !== undefined) { const e = extra.get(k) ?? {}; for (const [kk, v] of Object.entries(attrs)) if (v !== undefined && e[kk] === undefined) e[kk] = v; extra.set(k, e); continue; }
    // (only Overture has it: its footprint, unless it's one Overture took from OSM — those are in OSM's)
    if ((r.sources ?? []).some(s => s.dataset === 'OpenStreetMap')) continue;
    for (const p of rings) out.push({ id: hashId(r.id), source: 'overture', dataset: r.sources?.[0]?.dataset ?? 'Overture', rings: p.map(ring => ring.map(q => [q.x, q.z])), props: attrs, hs: '', estimated: false, part: false });
  }
  osmB.forEach((a, k) => {
    if (hasParts.has(k)) return;
    const t = a.tags, e = extra.get(k) ?? {};
    const props = {
      h: metres(t.height) ?? (t['building:levels'] === undefined ? e.h : undefined), mh: metres(t.min_height) ?? (num(t['building:min_level']) !== undefined ? num(t['building:min_level'])! * 3 : e.mh),
      fl: num(t['building:levels']) ?? e.fl, rs: t['roof:shape'] ?? e.rs, rh: metres(t['roof:height']) ?? e.rh, ro: t['roof:orientation'],
      fc: colour(t['building:colour']) ?? e.fc, rc: colour(t['roof:colour']) ?? e.rc, b: t.building && t.building !== 'yes' ? t.building : e.b ?? t.building, name: t.name,
      _tagH: metres(t.height) !== undefined, _ovH: metres(t.height) === undefined && e.h !== undefined,
    };
    for (const p of a.parts) out.push({ id: a.id, source: 'osm', dataset: 'OpenStreetMap', rings: p.map(ring => ring.map(q => [q.x, q.z])), props, hs: '', estimated: false, part: !!t['building:part'] });
  });
  // heights
  const area = (r: number[][]) => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return Math.abs(s / 2); };
  const known: { x: number; z: number; h: number }[] = [];
  for (const b of out) {
    const p = b.props;
    if (p._hs) { b.hs = p._hs; continue; }      // (a multipolygon's parts share their props)
    if (p.h > 0) b.hs = b.source === 'osm' && p._tagH ? 'tag' : 'overture';
    else if (p.fl > 0) { p.h = p.fl * cfg.storey + (p.rs && p.rs !== 'flat' ? 1.5 : 0); b.hs = 'floors'; }
    if (b.hs) p._hs = b.hs;
    if (p.h > 0) { const c = b.rings[0].reduce((s, q) => [s[0] + q[0] / b.rings[0].length, s[1] + q[1] / b.rings[0].length], [0, 0]); known.push({ x: c[0], z: c[1], h: p.h }); }
  }
  const NB = new Map<string, number[]>(), NC = cfg.nearby.radius;
  known.forEach((q, k) => { const kk = `${Math.floor(q.x / NC)},${Math.floor(q.z / NC)}`; (NB.get(kk) ?? NB.set(kk, []).get(kk)!).push(k); });
  for (const b of out) {
    const p = b.props;
    if (p.h > 0) { b.hs ||= p._hs; b.estimated ||= !!p._est; continue; }
    const c = b.rings[0].reduce((s, q) => [s[0] + q[0] / b.rings[0].length, s[1] + q[1] / b.rings[0].length], [0, 0]), near: number[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const k of NB.get(`${Math.floor(c[0] / NC) + dx},${Math.floor(c[1] / NC) + dz}`) ?? []) if (Math.hypot(known[k].x - c[0], known[k].z - c[1]) <= NC) near.push(known[k].h);
    if (near.length >= cfg.nearby.min && !(p.b && cfg.defaultHeight[p.b] != null && ['garage', 'garages', 'shed', 'roof', 'carport'].includes(p.b))) { near.sort((a, q) => a - q); p.h = near[near.length >> 1]; b.hs = 'nearby'; }
    else { p.h = heightOf({ ...p, h: 0, fl: 0 }, area(b.rings[0]), cfg); b.hs = 'default'; }
    b.estimated = true; p._hs = b.hs; p._est = true;
  }
  return out.sort((a, b) => a.id - b.id);
}
function hashId(s: string) { let h1 = 0x811c9dc5, h2 = 0x01000193; for (let i = 0; i < s.length; i++) { h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619); h2 = Math.imul(h2 + s.charCodeAt(i), 2246822519); } return 2e12 + ((h1 >>> 0) % 1e6) * 1e6 + ((h2 >>> 0) % 1e6); }
