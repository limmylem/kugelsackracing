// Map v3's streamer (ported from v2's world/streamer.js): the baked map, streamed round the car (the game side of map/bake/bake.ts): which tiles are wanted
// (all within a radius, nearest first, and ahead of the car by how fast it's going), loading them in Web
// Workers (map/render/worker.ts: fetch or the IndexedDB cache, decode), adding what they look like
// (world/tileObjects.js) and their collision — the heightfield, the road, car park and tunnel-roof meshes,
// each building's convex pieces, every railing's chained boxes, the tree trunks: the same baked arrays —
// to the physics a few milliseconds' worth a frame, and dropping tiles left far behind.
//
// The physics runs near its origin (Phase 1 Step 7's floating origin): when the car is more than
// REBASE m out, the origin moves a whole number of tiles to the car's tile and the simulation is
// re-expressed there between two steps (physics/sim.js shiftOrigin); the drawn world moves with it.
//
//   const W = await createWorldStream({ manifestUrl, scene, sim, RAPIER })
//   each frame: W.update(carPosition (sim), velocity, dt) → { shifted: [tx, 0, tz] | null }
//   W.readyAround(x, z, r) (physics there?), W.surfaceAt(x, z), W.placeOnGround(x, z, yFrom), W.where(x, z)
//   W.status (for the overlay), W.toWorld / W.toSim
//
// Headless (the streaming tests, in Node): options { headless: true, manifest, loadTile(key, url) →
// Promise<the worker's message>, now() } — the same planning and physics, nothing drawn, no workers,
// the clock the test's.

import * as THREE from 'three';
import { materials, srgbVertexColours, tileObjects } from './objects.ts';
import { tileColliders } from './physics.ts';
import { transverseMercator } from '../format/projection.ts';

export const REBASE = 1536;
const DEFAULTS = { loadRadius: 1400, unloadRadius: 2100, physicsRadius: 750, physicsDrop: 1100, lookAhead: 4, maxLoads: 4, workers: 2, budgetMs: 4 };

export async function createWorldStream({ manifestUrl, scene, sim, RAPIER, options = {} }: { manifestUrl: string | null; scene: any; sim: any; RAPIER: any; options?: any }) {
  const O: any = { ...DEFAULTS, ...options }, clock = O.now ?? (() => performance.now());
  const manifest = O.manifest ?? await (await fetch(manifestUrl, { cache: 'no-cache' })).json();
  const failedAt = new Map();      // key → when its last load failed (tried again after a pause)
  // (relative to the page's base, as fetch resolves it: dev pages set <base href="../">)
  const base = O.manifest ? '' : new URL('.', new URL(manifestUrl, globalThis.document?.baseURI ?? location.href)).href, T = manifest.grid.tileSize, half = T / 2;
  const P = transverseMercator(manifest.projection.lat0, manifest.projection.lon0);
  const byKey = new Map(manifest.tiles.map(t => [`${t.i}_${t.j}`, t]));
  // the physics' origin, in the world's frame: tile-aligned, at the spawn's tile to begin with
  const [sx, sz] = manifest.spawn.xz;
  let origin = [Math.floor(sx / T) * T, Math.floor(sz / T) * T];
  const world = new THREE.Group();
  world.name = 'baked world';
  world.position.set(-origin[0], 0, -origin[1]);
  scene.add(world);
  const surfaces = Object.entries<any>(manifest.surfaces).map(([name, s]) => ({ name, ...s }));

  // ---------- workers ----------
  const workers = O.loadTile ? [] : Array.from({ length: O.workers }, () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }));
  const waiting = new Map();
  let nextWorker = 0;
  for (const w of workers) w.onmessage = e => { const m = e.data, r = waiting.get(m.key); waiting.delete(m.key); r?.(m); };
  const fetchTile = t => { const key = `${t.i}_${t.j}`, url = `${base}tiles/${key}.m3t`; return O.loadTile ? O.loadTile(key, url) : new Promise(resolve => { waiting.set(key, resolve); workers[nextWorker++ % workers.length].postMessage({ type: 'load', key, url, version: manifest.version }); }); };

  // ---------- the far world: the whole region, drawn wherever detailed tiles haven't come in ----------
  // (a mask of the detailed tiles in, one texel a tile, read by the far meshes' shader to leave a hole
  // for each)
  const tx = manifest.tiles.map(t => t.i), tz = manifest.tiles.map(t => t.j);
  const mi0 = Math.min(...tx) - 1, mj0 = Math.min(...tz) - 1, mw = Math.max(...tx) - mi0 + 2, mh = Math.max(...tz) - mj0 + 2;
  const maskData = new Uint8Array(mw * mh), mask = new THREE.DataTexture(maskData, mw, mh, THREE.RedFormat, THREE.UnsignedByteType);
  mask.magFilter = mask.minFilter = THREE.NearestFilter; mask.needsUpdate = true;
  const maskUniforms = { uMask: { value: mask }, uMaskInfo: { value: new THREE.Vector4(mi0, mj0, mw, mh) }, uTile: { value: T }, uOrigin: { value: new THREE.Vector2(...origin) } };
  const setMask = (e, on) => { const c = e.i - mi0, r = e.j - mj0; if (c >= 0 && r >= 0 && c < mw && r < mh) { maskData[r * mw + c] = on ? 255 : 0; mask.needsUpdate = true; } };
  const masked = m => {
    const out = m.clone();
    const inner = m.onBeforeCompile;
    out.onBeforeCompile = (sh, r) => {
      inner?.(sh, r);
      Object.assign(sh.uniforms, maskUniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFarPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvFarPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFarPos; uniform sampler2D uMask; uniform vec4 uMaskInfo; uniform float uTile; uniform vec2 uOrigin;')
        .replace('void main() {', 'void main() {\n  vec2 g = floor((vFarPos.xz + uOrigin) / uTile) - uMaskInfo.xy;\n  if (g.x >= 0.0 && g.y >= 0.0 && g.x < uMaskInfo.z && g.y < uMaskInfo.w && texture2D(uMask, (g + 0.5) / uMaskInfo.zw).r > 0.5) discard;');
    };
    out.customProgramCacheKey = () => `far-${m.type}`;
    return out;
  };
  let waitingFar = 0;
  const far = new THREE.Group();
  far.name = 'far world';
  world.add(far);
  if (!O.headless) {
    const M = materials(), mats = { terrain: masked(M.terrain), blocks: masked(srgbVertexColours(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }))), landmark_walls: masked(M.walls.block), landmark_roofs: masked(M.roofs) };
    // the sea, out to the horizon (under everything: the land and the tiles' own water sit on it)
    const [bx, bz] = [(Math.min(...tx) + Math.max(...tx) + 1) * T / 2, (Math.min(...tz) + Math.max(...tz) + 1) * T / 2];
    const sea = new THREE.Mesh(new THREE.CircleGeometry(60000, 48).rotateX(-Math.PI / 2), M.water.clone());
    sea.material.opacity = 1; sea.material.transparent = false; sea.material.depthWrite = true;
    sea.position.set(bx, -0.06, bz); sea.renderOrder = -1;
    far.add(sea);
    for (const c of manifest.far?.chunks ?? []) {
      const key = `far_${c.a}_${c.b}`;
      waitingFar++;
      new Promise(resolve => { waiting.set(key, resolve); workers[nextWorker++ % workers.length].postMessage({ type: 'load', key, url: `${base}far/${c.a}_${c.b}.m3t`, version: manifest.version }); }).then((m: any) => {
        waitingFar--;
        if (m.type !== 'tile') return;
        const g = new THREE.Group();
        g.position.set((c.a + 0.5) * manifest.far.size, 0, (c.b + 0.5) * manifest.far.size);
        for (const [name, mesh] of Object.entries<any>(m.tile.meshes)) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
          geo.setAttribute('color', new THREE.BufferAttribute(mesh.colours, 4, true));
          if (mesh.uvs) geo.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2));
          if (mesh.normals) geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3)); else if (name === 'terrain') geo.computeVertexNormals();
          geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
          geo.computeBoundingSphere();
          const obj = new THREE.Mesh(geo, mats[name] ?? mats.blocks);
          obj.name = `far ${name}`; obj.matrixAutoUpdate = false; obj.position.set(0, 0, 0);
          g.add(obj);
        }
        far.add(g);
      });
    }
  }
  // ---------- tiles ----------
  const tiles = new Map();          // key → { i, j, state, obj, data, physics, queue, added, ... }
  const stats = { loaded: 0, fetched: 0, cached: 0, bytes: 0, loadMs: [], errors: 0, lastError: null, colliders: 0, firstDrivable: null, started: clock() };
  const centreOf = t => [(t.i + 0.5) * T, (t.j + 0.5) * T];
  const distTo = (t, x, z) => { const [cx, cz] = centreOf(t); return Math.hypot(Math.max(0, Math.abs(x - cx) - half), Math.max(0, Math.abs(z - cz) - half)); };
  let physicsQueue = [];

  function load(t) {
    const key = `${t.i}_${t.j}`, entry = { ...t, key, state: 'loading', obj: null, data: null, physics: null, colliders: 0 };
    tiles.set(key, entry);
    const t0 = clock();
    fetchTile(t).then(m => {
      if (tiles.get(key) !== entry) return;
      if (m.type === 'error') { stats.errors++; stats.lastError = m.error; tiles.delete(key); failedAt.set(key, clock()); return; }
      entry.data = m.tile; entry.state = 'ready';
      if (!O.headless) {
        entry.obj = tileObjects(m.tile, { barriers: manifest.barriers });
        const [cx, cz] = centreOf(t);
        entry.obj.group.position.set(cx, 0, cz);
        entry.obj.group.updateMatrixWorld(true);
        for (const c of entry.obj.group.children) c.updateMatrix?.();
        world.add(entry.obj.group);
      }
      setMask(entry, true);
      stats.loaded++; stats.bytes += m.bytes; m.cached ? stats.cached++ : stats.fetched++;
      stats.loadMs.push(clock() - t0); if (stats.loadMs.length > 50) stats.loadMs.shift();
    });
  }
  function unload(entry) {
    setMask(entry, false);
    dropPhysics(entry);
    entry.obj?.dispose();
    tiles.delete(entry.key);
  }

  // ---------- physics: built a piece at a time ----------
  // the tile's colliders (world/tilePhysics.js), ground and roads first
  function physicsPieces(entry) {
    const { pieces, ground } = tileColliders(entry.data, RAPIER, manifest.barriers);
    entry.groundPieces = ground;
    return pieces;
  }
  function wantPhysics(entry) {
    if (entry.physics || entry.state !== 'ready') return;
    const [cx, cz] = centreOf(entry);
    entry.physics = sim.addStatic({ position: [cx - origin[0], 0, cz - origin[1]] }, []);
    entry.pieces = physicsPieces(entry); entry.added = 0;
    physicsQueue.push(entry);
  }
  function dropPhysics(entry) {
    if (!entry.physics) return;
    sim.removeStatic(entry.physics);
    stats.colliders -= entry.added ?? 0;
    entry.physics = null; entry.pieces = null; entry.added = 0;
    physicsQueue = physicsQueue.filter(e => e !== entry);
  }
  const groundReady = entry => !!entry?.physics && entry.added >= entry.groundPieces;
  const entryAt = (wx, wz) => tiles.get(`${Math.floor(wx / T)}_${Math.floor(wz / T)}`);

  // ---------- each frame ----------
  let lastPlan = -Infinity;
  function update(pos, vel, dt = 1 / 60) {
    const wx = pos[0] + origin[0], wz = pos[2] + origin[1], speed = Math.hypot(vel[0], vel[2]);
    const ax = wx + vel[0] * O.lookAhead, az = wz + vel[2] * O.lookAhead;   // (where the car will be soon)
    const now = clock();
    if (now - lastPlan > 200) {
      lastPlan = now;
      // what's wanted, nearest (to now, or to soon) first
      const want = manifest.tiles.map(t => ({ t, d: Math.min(distTo(t, wx, wz), distTo(t, ax, az) * 0.8) })).filter(x => x.d < O.loadRadius).sort((a, b) => a.d - b.d);
      const loading = [...tiles.values()].filter(e => e.state === 'loading').length;
      let room = O.maxLoads - loading;
      for (const { t } of want) { if (room <= 0) break; const k = `${t.i}_${t.j}`; if (!tiles.has(k) && !(now - (failedAt.get(k) ?? -1e9) < 3000)) { load(t); room--; } }
      for (const e of [...tiles.values()]) if (e.state === 'ready' && Math.min(distTo(e, wx, wz), distTo(e, ax, az)) > O.unloadRadius) unload(e);
    }
    // physics: near now and near soon (further ahead the faster it goes), dropped once well behind
    const reach = O.physicsRadius + speed * 2;
    for (const e of tiles.values()) {
      if (e.state !== 'ready') continue;
      const d = Math.min(distTo(e, wx, wz), distTo(e, ax, az));
      if (d < reach) wantPhysics(e); else if (d > O.physicsDrop + speed * 2) dropPhysics(e);
      e.obj?.setDetail(distTo(e, wx, wz));
    }
    // a few milliseconds of colliders, the car's own tile and those ahead first
    physicsQueue.sort((a, b) => Math.min(distTo(a, wx, wz), distTo(a, ax, az)) - Math.min(distTo(b, wx, wz), distTo(b, ax, az)));
    const end = performance.now() + O.budgetMs;
    while (physicsQueue.length && performance.now() < end) {
      // (every waiting tile's ground and roads before anyone's buildings and railings)
      const e = physicsQueue.find(q => q.physics && q.added < q.groundPieces) ?? physicsQueue[0];
      if (!e.physics) { physicsQueue.shift(); continue; }
      const piece = e.pieces[e.added];
      if (piece) { sim.addToStatic(e.physics, [piece]); e.added++; stats.colliders++; }
      if (e.added >= e.pieces.length) physicsQueue.splice(physicsQueue.indexOf(e), 1);
    }
    // the floating origin: a whole number of tiles, to the car's
    let shifted = null;
    if (Math.hypot(pos[0], pos[2]) > REBASE) {
      const next = [Math.floor(wx / T) * T, Math.floor(wz / T) * T], t = [origin[0] - next[0], 0, origin[1] - next[1]];
      sim.shiftOrigin({ x: 0, y: 0, z: 0, w: 1 }, t);
      origin = next;
      world.position.set(-origin[0], 0, -origin[1]);
      maskUniforms.uOrigin.value.set(origin[0], origin[1]);
      shifted = t;
    }
    return { shifted };
  }

  return {
    manifest, projection: P, world, stats, update,
    get origin() { return origin; },
    toWorld: (x, z) => [x + origin[0], z + origin[1]],
    toSim: (x, z) => [x - origin[0], z - origin[1]],
    // is there solid ground (terrain, roads) everywhere within r m of a place (sim frame)?
    readyAround(x, z, r = 0) {
      const wx = x + origin[0], wz = z + origin[1];
      for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) { const e = entryAt(wx + dx, wz + dz); if (!e) { if (!byKey.has(`${Math.floor((wx + dx) / T)}_${Math.floor((wz + dz) / T)}`)) continue; return false; } if (!groundReady(e)) return false; }
      return true;
    },
    // tyre grip there: { name, grip, rollingResistance, … }
    surfaceAt(x, z) {
      const wx = x + origin[0], wz = z + origin[1], e = entryAt(wx, wz), G = e?.data?.grids.surface;
      if (!G) return surfaces[0];
      const lx = wx - (e.i * T), lz = wz - (e.j * T), c = Math.min(G.n - 1, Math.max(0, Math.floor(lx / G.cell))), r = Math.min(G.n - 1, Math.max(0, Math.floor(lz / G.cell)));
      const name = G.names[G.data[r * G.n + c]];
      return surfaces.find(s => s.name === name) ?? surfaces[0];
    },
    // where a place is, for the HUD: its tile, the elevation data there, the nearest named road
    where(x, z) {
      const wx = x + origin[0], wz = z + origin[1], e = entryAt(wx, wz), out: any = { tile: [Math.floor(wx / T), Math.floor(wz / T)], dem: e?.data?.header.dem ?? null, road: null, segment: null, latLon: P.toLatLon(wx, wz) };
      // (the nearest road piece within 25 m: the tile's road list, [ax, az, bx, bz, name, rank, segment])
      const S = e?.data?.lists.roads?.data, names = e?.data?.header.names;
      if (S) {
        let best = 25;
        const lx = wx - (e.i + 0.5) * T, lz = wz - (e.j + 0.5) * T;
        for (let k = 0; k < S.length; k += 7) {
          if (S[k + 4] < 0) continue;
          const ax = S[k], az = S[k + 1], dx = S[k + 2] - ax, dz = S[k + 3] - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((lx - ax) * dx + (lz - az) * dz) / l2)), d = Math.hypot(lx - ax - dx * t, lz - az - dz * t);
          if (d < best) { best = d; out.road = names[S[k + 4]]; out.segment = Math.round(S[k + 6]); }
        }
      }
      return out;
    },
    // the first solid surface below a point (sim frame), or null
    groundBelow(x, z, fromY, reach = 600) {
      const hit = sim.vehicle.world.castRay(new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }), reach, true, undefined, undefined, undefined, sim.vehicle.body);
      return hit ? fromY - hit.timeOfImpact : null;
    },
    get status() {
      const list = [...tiles.values()], ms = stats.loadMs.slice().sort((a, b) => a - b);
      return { tiles: list.filter(e => e.state === 'ready').length, loading: list.filter(e => e.state === 'loading').length, physics: list.filter(e => e.physics).length, building: physicsQueue.length,
        colliders: stats.colliders, bytes: stats.bytes, fetched: stats.fetched, cached: stats.cached, tileMs: ms.length ? ms[ms.length >> 1] : null, errors: stats.errors, lastError: stats.lastError };
    },
    // the tiles in the physics (the tests)
    get tiles() { return tiles; },
    dispose() { for (const e of [...tiles.values()]) unload(e); for (const w of workers) w.terminate(); world.removeFromParent(); },
  };
}
