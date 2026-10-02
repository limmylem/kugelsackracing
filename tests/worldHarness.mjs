// The baked world in Node, for its tests (tests/world.mjs): a region's manifest and tiles read from
// assets/world/<region>/, decoded as the game decodes them (world/tileFormat.js), their colliders made as
// the game makes them (world/tilePhysics.js), and a simulation (physics/sim.js) with the car on them —
// in the physics' frame with its origin at a tile corner, as the game's floating origin keeps it.
//
//   const W = await worldHarness('sf')
//   W.tile(i, j) → decoded tile (cached); W.tileAt(x, z) (world frame)
//   const S = await W.simAround(x, z, { radius })   a simulation with the tiles round a place
//   S.sim, S.origin, S.toSim(x, z), S.ground(x, z) (the first solid surface below, world frame)
//   S.place(x, z, headingDeg, speed) puts the car there on the ground

import fs from 'node:fs';
import path from 'node:path';
import { MeshoptDecoder } from 'meshoptimizer';
import { harness, root } from './harness.mjs';
import { decodeTile } from '../world/tileFormat.js';
import { terrainMeshes } from '../world/terrainMesh.js';
import { tileColliders } from '../world/tilePhysics.js';
import { projection } from '../world/projection.js';
import { createSimulation } from '../physics/sim.js';

export async function worldHarness(region = 'sf') {
  const H = await harness(), dir = path.join(root, 'assets/world', region);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')), T = manifest.tileSize, P = projection(...manifest.origin);
  const have = new Set(manifest.tiles.map(t => `${t.i}_${t.j}`)), cache = new Map();
  const tile = async (i, j) => {
    const key = `${i}_${j}`;
    if (!have.has(key)) return null;
    // (with its terrain meshes, cut as the game's tile worker cuts them)
    if (!cache.has(key)) cache.set(key, decodeTile(new Uint8Array(fs.readFileSync(path.join(dir, 'tiles', `${key}.dwt`))), MeshoptDecoder).then(d => (Object.assign(d.meshes, terrainMeshes(d)), d)));
    return cache.get(key);
  };
  const tileKeyAt = (x, z) => [Math.floor(x / T), Math.floor(z / T)];

  async function simAround(x, z, { radius = 600, spec = H.garage().stats().spec } = {}) {
    const origin = [Math.floor(x / T) * T, Math.floor(z / T) * T];
    const track = { surfaces: manifest.surfaces, offRoad: 'grass', spawn: { position: [x - origin[0], 600, z - origin[1]], headingDeg: 0 }, roads: [] };
    const sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets: H.socketsOf(spec), track });
    sim.vehicle.body.enableCcd(true);
    const loaded = new Map();
    const load = async (i, j) => {
      const key = `${i}_${j}`;
      if (loaded.has(key)) return;
      const d = await tile(i, j);
      if (!d) return;
      const { pieces } = tileColliders(d, H.RAPIER, manifest.barriers);
      loaded.set(key, sim.addStatic({ position: [(i + 0.5) * T - origin[0], 0, (j + 0.5) * T - origin[1]] }, pieces));
    };
    const reach = Math.ceil(radius / T);
    const [ci, cj] = tileKeyAt(x, z);
    for (let j = cj - reach; j <= cj + reach; j++) for (let i = ci - reach; i <= ci + reach; i++) await load(i, j);
    sim.step({ device: 'wheel', throttle: 0, brake: 0, steer: 0, handbrake: false });   // (the colliders into the queries)
    const toSim = (wx, wz) => [wx - origin[0], wz - origin[1]];
    const S = {
      sim, origin, toSim, loaded, load,
      // the first solid surface below a place (world frame), from high up; ignoring the car
      ground(wx, wz, fromY = 900) {
        const [sx, sz] = toSim(wx, wz), R = H.RAPIER;
        const hit = sim.vehicle.world.castRay(new R.Ray({ x: sx, y: fromY, z: sz }, { x: 0, y: -1, z: 0 }), 2000, true, undefined, undefined, undefined, sim.vehicle.body);
        return hit ? fromY - hit.timeOfImpact : null;
      },
      place(wx, wz, headingDeg = 0, speed = 0) {
        const y = S.ground(wx, wz);
        const [sx, sz] = toSim(wx, wz);
        sim.resetCar({ position: [sx, (y ?? 0) + (sim.vehicle.spec.spawnHeight ?? 0.6), sz], headingDeg, speed });
        return y;
      },
    };
    return S;
  }
  return { H, manifest, P, T, tile, tileKeyAt, simAround, root, dir };
}
