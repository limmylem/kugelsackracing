// The real world's collision round the car, the page's side of it: which chunks are needed (all
// within LOAD_RADIUS of the car), asking the worker (groundWorker.js) to build them, sampling the
// terrain it asks for (Cesium World Terrain, through the page), and handing what comes back to the
// physics car a piece at a time (a few milliseconds' worth a frame, so nothing stutters). Chunks the
// car has left far behind (KEEP_RADIUS) are dropped.
//
//   const ground = createGround({ physics, RAPIER, sampleTerrain: async points => Float32Array })
//   each frame: ground.update(latDeg, lonDeg); a new place: ground.reset()

import { blockPoints, chunksAround, latticeSampler } from './chunks.js';

export const LOAD_RADIUS = 1300, KEEP_RADIUS = 2600;
const MOVE_BEFORE_RECHECK = 60;      // m the car moves before the wanted chunks are worked out again
const BUDGET_MS = 3;                 // collision added per frame

// sampleTerrain(points: Float64Array [lat, lon, lat, lon, …] degrees) → Promise<Float32Array> heights
// above the ellipsoid (NaN where there's none)
export function createGround({ physics, RAPIER, sampleTerrain, onStatus = null }) {
  const worker = new Worker(new URL('./groundWorker.js', import.meta.url), { type: 'module' });
  const loaded = new Map();          // key → { stats, pieces left to add, added }
  const lattice = new Map();         // terrain blocks already sampled (key → Float32Array)
  let wanted = [], queue = [], last = null, worker_ = {}, sampling = Promise.resolve(), generation = 0;

  worker.onmessage = e => {
    const m = e.data;
    if (m.type === 'needBlocks') { const g = generation; sampling = sampling.then(() => g === generation && provide(m)).catch(err => console.warn('terrain for the collision', err)); }
    else if (m.type === 'built') received(m.chunk);
    else if (m.type === 'status') { worker_ = m; onStatus?.(api.status); }
  };
  worker.onerror = e => console.warn('ground worker', e.message ?? e);

  // terrain blocks the worker needs (sampled together, then kept)
  async function provide({ id, blocks }) {
    const todo = blocks.filter(([bj, bi]) => !lattice.has(`${bj}/${bi}`));
    if (todo.length) {
      const pts = new Float64Array(todo.length * blockPoints(0, 0).length);
      todo.forEach(([bj, bi], k) => pts.set(blockPoints(bj, bi), k * blockPoints(0, 0).length));
      const heights = await sampleTerrain(pts), per = heights.length / todo.length;
      todo.forEach(([bj, bi], k) => lattice.set(`${bj}/${bi}`, fillGaps(heights.slice(k * per, (k + 1) * per))));
      if (lattice.size > 600) for (const key of [...lattice.keys()].slice(0, lattice.size - 500)) lattice.delete(key);
    }
    worker.postMessage({ type: 'blocks', id, blocks: blocks.map(([bj, bi]) => [`${bj}/${bi}`, lattice.get(`${bj}/${bi}`)]) });
  }

  // a chunk built: its terrain first (so there's ground at once), then the road pieces, walls, roofs.
  // A newer build of one already here (its roads came, or its neighbours' did) goes in beside it, and
  // the old one only goes once the new one's all in
  function received(c) {
    if (!wanted.includes(c.key)) return;
    const old = loaded.get(c.key);
    if (old && (c.version <= old.version || (c.provisional && !old.provisional))) return;
    const pieces = [], hf = c.heightfield, id = `${c.key}@${c.version}`;
    pieces.push(RAPIER.ColliderDesc.heightfield(hf.n, hf.n, hf.heights, { x: hf.size, y: 1, z: hf.size }));
    for (const part of c.roads) pieces.push(Object.assign(RAPIER.ColliderDesc.trimesh(part.vertices, part.indices), { surfaces: part.surfaces }));
    for (const m of [c.walls, c.cover]) if (m.indices.length) pieces.push(RAPIER.ColliderDesc.trimesh(m.vertices, m.indices));
    queue = queue.filter(p => p.key !== c.key);
    const replaces = old ? [...(old.replaces ?? []), old.id] : [];
    loaded.set(c.key, { id, version: c.version, stats: c.stats, frame: c.frame, surfaces: c.surfaces, provisional: c.provisional, partial: c.partial, replaces, left: pieces.length, added: 0 });
    for (const desc of pieces) queue.push({ key: c.key, id, frame: c.frame, desc });
    onStatus?.(api.status);
  }
  const drop = entry => { physics.removeChunk(entry.id); for (const old of entry.replaces ?? []) physics.removeChunk(old); };

  const api = {
    // Where the car is (degrees): what's needed round it, and a few more pieces into the physics
    update(lat, lon) {
      const moved = !last || Math.hypot((lat - last[0]) * 111000, (lon - last[1]) * 111000 * Math.cos(lat * Math.PI / 180)) > MOVE_BEFORE_RECHECK;
      if (moved) {
        last = [lat, lon];
        const keys = chunksAround(lat, lon, LOAD_RADIUS).map(c => c.key), keep = new Set(chunksAround(lat, lon, KEEP_RADIUS).map(c => c.key));
        const dropped = [...loaded.keys()].filter(k => !keep.has(k));
        for (const k of dropped) { drop(loaded.get(k)); loaded.delete(k); }
        queue = queue.filter(p => loaded.has(p.key));
        if (dropped.length || keys.join() !== wanted.join()) {
          wanted = keys;
          worker.postMessage({ type: 'want', keys: keys.filter(k => !loaded.has(k)), dropped });
        }
      }
      const end = performance.now() + BUDGET_MS;
      while (queue.length && physics.frame && performance.now() < end) {       // (not before the car's been placed somewhere)
        const p = queue.shift(), entry = loaded.get(p.key);
        if (!entry || entry.id !== p.id) continue;
        physics.addChunk(p.id, p.frame, [p.desc]);
        entry.left--; entry.added++;
        if (!entry.left && entry.replaces.length) { for (const old of entry.replaces) physics.removeChunk(old); entry.replaces = []; }
      }
    },
    // A new place: everything goes
    reset() {
      generation++;
      for (const entry of loaded.values()) drop(entry);
      const dropped = [...loaded.keys()];
      loaded.clear(); queue = []; wanted = []; last = null;
      worker.postMessage({ type: 'want', keys: [], dropped });
      worker.postMessage({ type: 'forget' });
    },
    // Is the chunk here in the physics (its terrain at least)?
    readyAt: key => (loaded.get(key)?.added ?? 0) > 0,
    get status() {
      const pieces = queue.length;
      return { chunks: [...loaded.values()].filter(e => e.added).length, provisional: [...loaded.values()].filter(e => e.provisional).length, partial: [...loaded.values()].filter(e => e.partial).length, wanted: wanted.length, pieces, building: !!worker_.building, queue: worker_.queue ?? 0,
        fetching: worker_.fetching ?? 0, fetched: worker_.fetched ?? 0, cached: worker_.cached ?? 0, errors: worker_.errors ?? 0, lastError: worker_.lastError ?? null, retryIn: worker_.overpassWait ?? 0 };
    },
    get loaded() { return loaded; },
    // (debugging: the terrain height the collision was built from, where it's been sampled)
    terrainAt(lat, lon) { try { return latticeSampler(lattice)(lat, lon); } catch { return null; } },
  };
  return api;
}

// Heights with holes (a failed sample) filled from their neighbours in the block (or the block's mean)
function fillGaps(h) {
  const n = Math.round(Math.sqrt(h.length)), ok = [...h].filter(Number.isFinite), mean = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : 0;
  for (let i = 0; i < h.length; i++) {
    if (Number.isFinite(h[i])) continue;
    const r = Math.floor(i / n), c = i % n, near = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([y, x]) => y >= 0 && x >= 0 && y < n && x < n).map(([y, x]) => h[y * n + x]).filter(Number.isFinite);
    h[i] = near.length ? near.reduce((a, b) => a + b, 0) / near.length : mean;
  }
  return h;
}
