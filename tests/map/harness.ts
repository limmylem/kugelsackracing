// Map v3 in Node, for its tests: a region's manifest, tiles and road graph read from assets/map/<region>/,
// decoded as the game decodes them (map/format/tileFormat.ts, terrain meshes cut as the worker cuts them),
// their colliders made as the game makes them (map/render/physics.ts), and simulations with the car on
// them, origin at a tile corner (as the game's floating origin keeps it).
//
//   const M = await mapHarness('sf', dir?)
//   M.tile(i, j), M.cached(i, j), M.graph(), M.P (projection), M.T
//   const S = await M.simAround(x, z, { radius })  → { sim, origin, toSim, loaded, ground(x, z, fromY, onlyGround) }

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MeshoptDecoder } from 'meshoptimizer';
import { harness, root } from '../harness.mjs';
import { decodeTile } from '../../map/format/tileFormat.ts';
import { terrainMeshes } from '../../map/format/terrainMesh.ts';
import { transverseMercator } from '../../map/format/projection.ts';
import { tileColliders } from '../../map/render/physics.ts';
import { createSimulation } from '../../physics/sim.js';

export async function mapHarness(region = 'sf', dir = path.join(root, 'assets/map', region)) {
  const H: any = await harness();
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')), T = manifest.grid.tileSize;
  const P = transverseMercator(manifest.projection.lat0, manifest.projection.lon0);
  const have = new Set(manifest.tiles.map(t => `${t.i}_${t.j}`)), cache = new Map(), done = new Map();
  const tile = async (i: number, j: number) => {
    const key = `${i}_${j}`;
    if (!have.has(key)) return null;
    if (!cache.has(key)) cache.set(key, decodeTile(new Uint8Array(fs.readFileSync(path.join(dir, 'tiles', `${key}.m3t`))), MeshoptDecoder).then(d => { Object.assign(d.meshes, terrainMeshes(d)); done.set(key, d); return d; }));
    return cache.get(key);
  };
  const cached = (i: number, j: number) => done.get(`${i}_${j}`) ?? null;
  let G = null;
  const graph = () => (G ??= JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, manifest.files.graph))).toString()));
  const ground = c => c.userData?.material === 'ground';

  async function simAround(x: number, z: number, { radius = 600, spec = H.garage().stats().spec } = {}) {
    const origin = [Math.floor(x / T) * T, Math.floor(z / T) * T];
    const track = { surfaces: manifest.surfaces, offRoad: 'grass', spawn: { position: [x - origin[0], 600, z - origin[1]], headingDeg: 0 }, roads: [] };
    const sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets: H.socketsOf(spec), track });
    sim.vehicle.body.enableCcd(true);
    const surfaces = Object.entries<any>(manifest.surfaces).map(([name, s]) => ({ name, ...s }));
    // tyre grip from the tiles' surface grids, as the game's streamer gives it
    sim.vehicle.surfaceAt = (sx: number, sz: number) => {
      const wx = sx + origin[0], wz = sz + origin[1], d = cached(Math.floor(wx / T), Math.floor(wz / T)), Gs = d?.grids.surface;
      if (!Gs) return surfaces[0];
      const c = Math.min(Gs.n - 1, Math.max(0, Math.floor((wx - Math.floor(wx / T) * T) / Gs.cell))), r = Math.min(Gs.n - 1, Math.max(0, Math.floor((wz - Math.floor(wz / T) * T) / Gs.cell)));
      return surfaces.find(s => s.name === Gs.names[Gs.data[r * Gs.n + c]]) ?? surfaces[0];
    };
    const loaded = new Map();
    const reach = Math.ceil(radius / T), [ci, cj] = [Math.floor(x / T), Math.floor(z / T)];
    for (let j = cj - reach; j <= cj + reach; j++) for (let i = ci - reach; i <= ci + reach; i++) {
      const d = await tile(i, j);
      if (!d) continue;
      loaded.set(`${i}_${j}`, sim.addStatic({ position: [(i + 0.5) * T - origin[0], 0, (j + 0.5) * T - origin[1]] }, tileColliders(d, H.RAPIER, manifest.barriers).pieces));
    }
    sim.step({ device: 'wheel', throttle: 0, brake: 0, steer: 0, handbrake: false });
    const toSim = (wx: number, wz: number) => [wx - origin[0], wz - origin[1]];
    return {
      sim, origin, toSim, loaded,
      // the first solid surface below a place (world frame), from fromY; only the ground's colliders if asked
      ground(wx: number, wz: number, fromY = 900, onlyGround = false, reachDown = 2000) {
        const [sx, sz] = toSim(wx, wz), R = H.RAPIER;
        const hit = sim.vehicle.world.castRay(new R.Ray({ x: sx, y: fromY, z: sz }, { x: 0, y: -1, z: 0 }), reachDown, true, undefined, undefined, undefined, sim.vehicle.body, onlyGround ? ground : undefined);
        return hit ? fromY - hit.timeOfImpact : null;
      },
    };
  }
  return { H, manifest, P, T, tile, cached, graph, simAround, root, dir };
}
