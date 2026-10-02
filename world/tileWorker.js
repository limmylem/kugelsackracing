// The baked world's tile loader (a module Web Worker, run by world/streamer.js): fetches a tile, keeps it
// in IndexedDB under its bake's version (a new bake replaces old copies; a revisited area loads with no
// download at all), decodes it (world/tileFormat.js, meshoptimizer's decoder), cuts the terrain's
// meshes from its height grid (world/terrainMesh.js) and works out their smooth normals, then hands
// the arrays back without copying them. Everything but making the three.js objects stays off the
// page's thread.
//
// Page → worker: { type: 'load', key, url, version }, { type: 'forget' } (empties the cache)
// Worker → page: { type: 'tile', key, tile, bytes, cached, ms } | { type: 'error', key, error }

import { MeshoptDecoder } from './vendor/meshopt_decoder.module.js';
import { decodeTile } from './tileFormat.js';
import { terrainMeshes } from './terrainMesh.js';

const DB = 'drive-world-tiles', STORE = 'tiles';
let db = null;
const openDb = () => db ??= new Promise(resolve => {
  try {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
  } catch { resolve(null); }
});
const tx = async (mode, fn) => { const d = await openDb(); if (!d) return null; return new Promise(resolve => { try { const t = d.transaction(STORE, mode), req = fn(t.objectStore(STORE)); t.oncomplete = () => resolve(req?.result ?? null); t.onerror = () => resolve(null); } catch { resolve(null); } }); };
const cacheGet = url => tx('readonly', s => s.get(url));
const cachePut = (url, value) => tx('readwrite', s => s.put(value, url));

// smooth normals for a mesh (indexed), as three.js's computeVertexNormals
function vertexNormals(P, I) {
  const N = new Float32Array(P.length);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ex = P[b] - P[a], ey = P[b + 1] - P[a + 1], ez = P[b + 2] - P[a + 2], fx = P[c] - P[a], fy = P[c + 1] - P[a + 1], fz = P[c + 2] - P[a + 2];
    const nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
    for (const v of [a, b, c]) { N[v] += nx; N[v + 1] += ny; N[v + 2] += nz; }
  }
  for (let v = 0; v < N.length; v += 3) { const l = Math.hypot(N[v], N[v + 1], N[v + 2]) || 1; N[v] /= l; N[v + 1] /= l; N[v + 2] /= l; }
  return N;
}

self.onmessage = async e => {
  const m = e.data;
  if (m.type === 'forget') { await tx('readwrite', s => s.clear()); return; }
  if (m.type !== 'load') return;
  const t0 = performance.now();
  try {
    let bytes = null, cached = false;
    const hit = await cacheGet(m.url);
    if (hit && hit.version === m.version) { bytes = hit.bytes; cached = true; }
    else {
      const r = await fetch(m.url, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`${m.url}: HTTP ${r.status}`);
      bytes = new Uint8Array(await r.arrayBuffer());
      cachePut(m.url, { version: m.version, bytes });
    }
    const tile = await decodeTile(bytes, MeshoptDecoder), transfer = [];
    // the terrain's meshes, cut from its height grid (a far chunk's one level as its 'terrain')
    const ground = terrainMeshes(tile);
    if (tile.header.far) { if (ground.terrain0) tile.meshes.terrain = ground.terrain0; } else Object.assign(tile.meshes, ground);
    for (const [name, mesh] of Object.entries(tile.meshes)) {
      if (name.startsWith('terrain') || name === 'cover' || name === 'water') mesh.normals = vertexNormals(mesh.positions, mesh.indices);
      for (const a of [mesh.positions, mesh.colours, mesh.uvs, mesh.indices, mesh.surfaces, mesh.normals]) if (a) transfer.push(a.buffer);
    }
    for (const L of Object.values(tile.lists)) transfer.push(L.data.buffer);
    for (const G of Object.values(tile.grids)) transfer.push(G.data.buffer);
    if (tile.heightfield) transfer.push(tile.heightfield.heights.buffer);
    self.postMessage({ type: 'tile', key: m.key, tile, bytes: bytes.length, cached, ms: performance.now() - t0 }, [...new Set(transfer)]);
  } catch (err) {
    self.postMessage({ type: 'error', key: m.key, error: String(err.message ?? err) });
  }
};
