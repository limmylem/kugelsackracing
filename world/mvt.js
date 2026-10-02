// Mapbox Vector Tiles (version 2), written and read: the world's map tiles are these (world/pmtiles.js
// keeps them in one file). A tile has named layers; a layer has features, each with an id, its
// properties and its geometry in tile coordinates (0 … extent across the tile; a feature may reach past
// the edges). Any extent may be used: the world's detailed tiles use 8192 (a quarter of a metre a unit
// at zoom 14) so roads meet exactly and don't zig-zag.
//
//   encodeTile([{ name, extent, features: [{ id?, type: 1 | 2 | 3, geometry, properties }] }]) → bytes
//     geometry: point: [[x, y], …]; line: [[[x, y], …], …] (parts); polygon: [[ring, ring, …], …]
//     (polygons: each with its outer ring first, then its holes; rings needn't repeat their first point)
//   decodeTile(bytes) → { layerName: { extent, features: [{ id, type, properties, geometry }] } }
//     (the same shapes; a polygon's rings are sorted into polygons by their winding)

import { PbfReader, PbfWriter, BYTES } from './pbf.js';

export const POINT = 1, LINE = 2, POLYGON = 3;
const MOVE = 1, LINE_TO = 2, CLOSE = 7, cmd = (id, n) => (id & 7) | (n << 3);
const zig = v => (v << 1) ^ (v >> 31);

// signed area (×2) of a ring in tile coordinates (y down): > 0 is an outer ring, as MVT has them
export const ringArea = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a; };

function geometryCommands(type, geometry) {
  const out = [];
  let px = 0, py = 0;
  const put = (x, y) => { x = Math.round(x); y = Math.round(y); out.push(zig(x - px), zig(y - py)); px = x; py = y; };
  if (type === POINT) {
    out.push(cmd(MOVE, geometry.length));
    for (const [x, y] of geometry) put(x, y);
  } else if (type === LINE) {
    for (const part of geometry) {
      const pts = dedupe(part);
      if (pts.length < 2) continue;
      out.push(cmd(MOVE, 1)); put(...pts[0]);
      out.push(cmd(LINE_TO, pts.length - 1)); for (let i = 1; i < pts.length; i++) put(...pts[i]);
    }
  } else {
    for (const poly of geometry) poly.forEach((ring, k) => {
      let pts = dedupe(ring);
      if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts = pts.slice(0, -1);
      if (pts.length < 3) return;
      // outer rings positive, holes negative (y down)
      if ((ringArea(pts) > 0) !== (k === 0)) pts = pts.slice().reverse();
      out.push(cmd(MOVE, 1)); put(...pts[0]);
      out.push(cmd(LINE_TO, pts.length - 1)); for (let i = 1; i < pts.length; i++) put(...pts[i]);
      out.push(cmd(CLOSE, 1));
    });
  }
  return out;
}
// (points rounded to whole units, without repeats)
function dedupe(pts) {
  const out = [];
  for (const p of pts) { const q = [Math.round(p[0]), Math.round(p[1])], l = out.at(-1); if (!l || l[0] !== q[0] || l[1] !== q[1]) out.push(q); }
  return out;
}

export function encodeTile(layers) {
  const w = new PbfWriter(4096);
  for (const L of layers) {
    if (!L.features.length) continue;
    const keys = [], keyIndex = new Map(), values = [], valueIndex = new Map(), feats = [];
    for (const f of L.features) {
      const geom = geometryCommands(f.type, f.geometry);
      if (!geom.length) continue;
      const tags = [];
      for (const [k, v] of Object.entries(f.properties ?? {})) {
        if (v === undefined || v === null || v === '' || (typeof v === 'number' && !Number.isFinite(v))) continue;
        if (!keyIndex.has(k)) { keyIndex.set(k, keys.length); keys.push(k); }
        const vk = `${typeof v}:${v}`;
        if (!valueIndex.has(vk)) { valueIndex.set(vk, values.length); values.push(v); }
        tags.push(keyIndex.get(k), valueIndex.get(vk));
      }
      feats.push({ id: f.id, type: f.type, tags, geom });
    }
    if (!feats.length) continue;
    w.message(3, l => {
      l.tag(15, 0).varint(2);
      l.tag(1, BYTES).string(L.name);
      for (const f of feats) l.message(2, m => {
        if (f.id != null) m.tag(1, 0).varint(f.id);
        m.packed(2, f.tags);
        m.tag(3, 0).varint(f.type);
        m.packed(4, f.geom);
      });
      for (const k of keys) l.tag(3, BYTES).string(k);
      for (const v of values) l.message(4, m => {
        if (typeof v === 'string') m.tag(1, BYTES).string(v);
        else if (typeof v === 'boolean') m.tag(7, 0).varint(v ? 1 : 0);
        else if (Number.isInteger(v) && v >= 0) m.tag(5, 0).varint(v);
        else if (Number.isInteger(v)) m.tag(6, 0).svarint(v);
        else m.tag(3, 1).double(v);
      });
      l.tag(5, 0).varint(L.extent ?? 4096);
    });
  }
  return w.finish();
}

function readValue(r, end) {
  let v = null;
  r.fields((f, t) => {
    if (f === 1) v = r.string(); else if (f === 2) v = r.float(); else if (f === 3) v = r.double();
    else if (f === 4) v = r.varint(); else if (f === 5) v = r.varint(); else if (f === 6) v = r.svarint(); else if (f === 7) v = !!r.varint(); else r.skip(t);
  }, end);
  return v;
}

function decodeGeometry(type, cmds) {
  const rings = [];
  let x = 0, y = 0, i = 0, cur = null;
  while (i < cmds.length) {
    const c = cmds[i++], id = c & 7, n = c >> 3;
    if (id === MOVE || id === LINE_TO) {
      for (let k = 0; k < n; k++) {
        const dx = cmds[i++], dy = cmds[i++];
        x += (dx >>> 1) ^ -(dx & 1); y += (dy >>> 1) ^ -(dy & 1);
        if (id === MOVE && type !== POINT) { cur = []; rings.push(cur); }
        if (type === POINT) rings.push([x, y]); else cur.push([x, y]);
      }
    } else if (id === CLOSE) { /* (the ring closes on its first point) */ }
  }
  if (type !== POLYGON) return rings;
  // rings into polygons: a positive ring starts one, negative ones are its holes
  const polys = [];
  for (const r of rings) {
    const a = ringArea(r);
    if (a === 0) continue;
    if (a > 0 || !polys.length) polys.push([r]); else polys.at(-1).push(r);
  }
  return polys;
}

export function decodeTile(bytes) {
  const r = new PbfReader(bytes), out = {};
  r.fields((field, type) => {
    if (field !== 3) return r.skip(type);
    r.sub(end => {
      const L = { name: '', extent: 4096, keys: [], values: [], raw: [] };
      r.fields((f, t) => {
        if (f === 1) L.name = r.string();
        else if (f === 5) L.extent = r.varint();
        else if (f === 3) L.keys.push(r.string());
        else if (f === 4) L.values.push(r.sub(e => readValue(r, e)));
        else if (f === 2) L.raw.push(r.sub(e => { const F = { id: null, type: 0, tags: [], geom: [] }; r.fields((g, tt) => { if (g === 1) F.id = r.varint(); else if (g === 2) F.tags = r.packed(); else if (g === 3) F.type = r.varint(); else if (g === 4) F.geom = r.packed(); else r.skip(tt); }, e); return F; }));
        else r.skip(t);
      }, end);
      out[L.name] = {
        extent: L.extent,
        features: L.raw.map(F => {
          const properties = {};
          for (let k = 0; k < F.tags.length; k += 2) properties[L.keys[F.tags[k]]] = L.values[F.tags[k + 1]];
          return { id: F.id, type: F.type, properties, geometry: decodeGeometry(F.type, F.geom) };
        }),
      };
    });
  });
  return out;
}
