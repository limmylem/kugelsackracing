// A garage building's solid parts (play/garageBuilding.js): the forecourt and both driveways are driven on — just
// above the road, leaning with it however steep — and the road beside it stays clear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

// (no page here: a canvas that draws nothing, for the signs)
const ctx = new Proxy({}, { get: (t, k) => k === 'measureText' ? () => ({ width: 10 }) : () => {}, set: () => true });
globalThis.document ??= { createElement: () => ({ getContext: () => ctx, width: 0, height: 0 }) };
const { createGarageBuilding, SIDE } = await import('../../play/garageBuilding.js');
await RAPIER.init();

for (const [heading, grade] of [[0, 0], [90, 0.2], [200, -0.08]]) {
  test(`a garage on a road heading ${heading}° at a ${grade * 100}% slope: its forecourt and driveways are solid, the road clear`, () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const sim = { addStatic(pose, descs) { const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...pose.position).setRotation(pose.rotation)); descs.forEach(d => world.createCollider(d, body)); return { body }; }, removeStatic() {} };
    const h = heading * Math.PI / 180, fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h), alt = 100;
    const roadY = (x, z) => alt + grade * (x * fx + z * fz);
    let ready = false;
    const stream = { world: new THREE.Group(), projection: { toXZ: () => [0, 0], toLatLon: (x, z) => [z, x] }, toSim: (x, z) => [x, z], readyAround: () => ready, groundBelow: (x, z) => roadY(x, z) };
    const G = createGarageBuilding({ THREE, RAPIER, sim, stream, item: { id: 'garage_test', location: { lat: 0, lon: 0, alt, heading } } });
    assert.equal(G.settle(), false, 'waits for the road\'s collision');
    ready = true;
    assert.equal(G.settle(), true);
    world.step();
    // (height over the road's plane at a place in the road's frame: x right, z back)
    const above = (lx, lz) => { const x = rx * lx - fx * lz, z = rz * lx - fz * lz, hit = world.castRay(new RAPIER.Ray({ x, y: alt + 30, z }, { x: 0, y: -1, z: 0 }), 100, true); return hit ? alt + 30 - hit.timeOfImpact - roadY(x, z) : null; };
    for (const [name, lx, lz] of [['the entry driveway', 5.5, 14], ['the exit driveway', 5.5, -14], ['the entry\'s mouth on the road', 4.1, 19.5], ['the exit\'s mouth on the road', 4.1, -19.5], ['the entry driveway\'s outer edge', 6, 18], ['the lane\'s back', SIDE, 7], ['the lane\'s front', SIDE, -7], ['under the canopy', SIDE, 0], ['the back of the forecourt', SIDE + 17, 14]]) {
      const y = above(lx, lz);
      assert.ok(y != null && Math.abs(y - 0.04) < 0.02, `${name}: ${y} m over the road`);
    }
    for (const lz of [-15, 0, 15]) assert.equal(above(0, lz), null, 'nothing over the road');
  });
}
