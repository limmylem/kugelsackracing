// @ts-nocheck — ported as it was (tested in v2); its classes add fields dynamically
// (Map v3: ported from tools/world/osmPbf.mjs.)
// OpenStreetMap extracts (.osm.pbf, as Geofabrik, BBBike or osmium make them) read in Node, no native
// code: nodes (dense or not), ways and relations with their tags. Two passes over the file — the ways
// and relations first (what's wanted, and which nodes they need), then just those nodes' places — so a
// city's extract fits in memory.
//
//   readPbf(bytes, { wantWay(tags), wantRelation(tags), wantNode(tags) })
//     → { nodes: Map(id → [lon, lat]), points: [{ id, lon, lat, tags }], ways: Map(id → { id, refs, tags }),
//         relations: [{ id, tags, members: [{ type: 'n' | 'w' | 'r', ref, role }] }] }

import zlib from 'node:zlib';
import { PbfReader } from './pbfReader.ts';

// every blob of a given type, decompressed
function* blobs(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  while (p + 4 <= bytes.length) {
    const hlen = view.getInt32(p, false); p += 4;
    let type = '', size = 0;
    new PbfReader(bytes.subarray(p, p + hlen)).fields((f, t, r) => { if (f === 1) type = r.string(); else if (f === 3) size = r.varint(); else r.skip(t); });
    p += hlen;
    const blob = bytes.subarray(p, p + size); p += size;
    let data = null;
    new PbfReader(blob).fields((f, t, r) => {
      if (f === 1) data = r.bytes();
      else if (f === 3) data = zlib.inflateSync(r.bytes());
      else if (f === 7) { if (!zlib.zstdDecompressSync) throw new Error('this Node can\'t read zstd-compressed .osm.pbf: use Node 22.15 or newer'); data = zlib.zstdDecompressSync(r.bytes()); }
      else if (f === 4 || f === 6) throw new Error('lzma / lz4 .osm.pbf blobs aren\'t read: recompress with osmium cat');
      else r.skip(t);
    });
    yield { type, data };
  }
}

// One PrimitiveBlock: its strings, coordinate scale and groups, read lazily by the callbacks
function block(data, on) {
  const r = new PbfReader(data), strings = [];
  let gran = 100, latOff = 0, lonOff = 0;
  const groups = [];
  r.fields((f, t) => {
    if (f === 1) r.sub(end => r.fields((g, tt) => { if (g === 1) strings.push(new TextDecoder().decode(r.bytes())); else r.skip(tt); }, end));
    else if (f === 2) groups.push(r.bytes());
    else if (f === 17) gran = r.varint();
    else if (f === 19) latOff = r.varint();
    else if (f === 20) lonOff = r.varint();
    else r.skip(t);
  });
  const coord = (off, v) => (off + gran * v) * 1e-9;
  const tagsOf = (keys, vals) => { const o = {}; for (let i = 0; i < keys.length; i++) o[strings[keys[i]]] = strings[vals[i]]; return o; };
  for (const g of groups) {
    const gr = new PbfReader(g);
    gr.fields((f, t) => {
      if (f === 2 && on.dense) gr.sub(end => {
        let ids = [], lats = [], lons = [], kv = [];
        gr.fields((k, tt) => { if (k === 1) ids = gr.packed(true); else if (k === 8) lats = gr.packed(true); else if (k === 9) lons = gr.packed(true); else if (k === 10) kv = gr.packed(); else gr.skip(tt); }, end);
        let id = 0, lat = 0, lon = 0, j = 0;
        for (let i = 0; i < ids.length; i++) {
          id += ids[i]; lat += lats[i]; lon += lons[i];
          let tags = null;
          if (kv.length) { while (kv[j] !== 0 && j < kv.length) { (tags ??= {})[strings[kv[j]]] = strings[kv[j + 1]]; j += 2; } j++; }
          on.dense(id, coord(lonOff, lon), coord(latOff, lat), tags);
        }
      });
      else if (f === 1 && on.dense) gr.sub(end => {
        let id = 0, keys = [], vals = [], lat = 0, lon = 0;
        gr.fields((k, tt) => { if (k === 1) id = gr.svarint(); else if (k === 2) keys = gr.packed(); else if (k === 3) vals = gr.packed(); else if (k === 8) lat = gr.svarint(); else if (k === 9) lon = gr.svarint(); else gr.skip(tt); }, end);
        on.dense(id, coord(lonOff, lon), coord(latOff, lat), keys.length ? tagsOf(keys, vals) : null);
      });
      else if (f === 3 && on.way) gr.sub(end => {
        let id = 0, keys = [], vals = [], refs = [];
        gr.fields((k, tt) => { if (k === 1) id = gr.varint(); else if (k === 2) keys = gr.packed(); else if (k === 3) vals = gr.packed(); else if (k === 8) refs = gr.packed(true); else gr.skip(tt); }, end);
        for (let i = 1; i < refs.length; i++) refs[i] += refs[i - 1];
        on.way(id, refs, tagsOf(keys, vals));
      });
      else if (f === 4 && on.relation) gr.sub(end => {
        let id = 0, keys = [], vals = [], roles = [], mem = [], types = [];
        gr.fields((k, tt) => { if (k === 1) id = gr.varint(); else if (k === 2) keys = gr.packed(); else if (k === 3) vals = gr.packed(); else if (k === 8) roles = gr.packed(); else if (k === 9) mem = gr.packed(true); else if (k === 10) types = gr.packed(); else gr.skip(tt); }, end);
        let ref = 0;
        on.relation(id, tagsOf(keys, vals), mem.map((m, i) => { ref += m; return { type: 'nwr'[types[i]], ref, role: strings[roles[i]] }; }));
      });
      else gr.skip(t);
    });
  }
}

export function readPbf(bytes, { wantWay = () => true, wantRelation = () => true, wantNode = () => false } = {}) {
  const ways = new Map(), relations = [], need = new Set(), points = [], nodes = new Map();
  const data = [...blobs(bytes)].filter(b => b.type === 'OSMData').map(b => b.data);
  // 1: relations, then the ways they and we want
  const relWays = new Set();
  for (const d of data) block(d, { relation(id, tags, members) { if (wantRelation(tags)) { relations.push({ id, tags, members }); for (const m of members) if (m.type === 'w') relWays.add(m.ref); } } });
  for (const d of data) block(d, { way(id, refs, tags) { if (wantWay(tags) || relWays.has(id)) { ways.set(id, { id, refs, tags }); for (const r of refs) need.add(r); } } });
  // 2: the nodes those need, and the points wanted for themselves
  for (const d of data) block(d, { dense(id, lon, lat, tags) {
    if (need.has(id)) nodes.set(id, [lon, lat]);
    if (tags && wantNode(tags)) points.push({ id, lon, lat, tags });
  } });
  return { nodes, points, ways, relations };
}
