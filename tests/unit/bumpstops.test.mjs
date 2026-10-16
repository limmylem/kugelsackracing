// The bump stops (physics/vehicle.js BUMP_STOP): past a spring's travel the strut pushes back harder and harder instead of
// letting the body down onto the road. A car dropped onto the test centre's straight at speed, as off a crest: from a
// metre, no car's floor touches the road (before the stops, the Apex V8's did from half a metre, every car's from a
// metre and a half), the stops taking what the springs can't; a car driving on a flat road never reaches them.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { harness, root } from '../harness.mjs';
import { createSimulation } from '../../physics/sim.js';
import { socketsFromGlb } from '../../physics/sockets.js';

const H = await harness();
const input = { device: 'wheel', throttle: 0.3, brake: 0, steer: 0, handbrake: false };
function drop(carId, metres) {
  const spec = H.garage(null, carId).stats().spec, b = fs.readFileSync(path.join(root, spec.model.file));
  const sockets = socketsFromGlb(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), spec.model);
  const sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets, track: H.track }), v = sim.vehicle;
  sim.resetCar({ position: [-300, 0, 3000], headingDeg: 180, speed: 25 });
  let flatOver = 0;
  for (let i = 0; i < 120; i++) { sim.step(input); for (const w of v.wheels) flatOver = Math.max(flatOver, w.over ?? 0); }
  const t = v.body.translation();
  v.body.setTranslation({ x: t.x, y: t.y + metres, z: t.z }, true);
  let over = 0, touched = 0;
  for (let i = 0; i < 240; i++) {
    sim.step(input);
    for (const w of v.wheels) over = Math.max(over, w.over ?? 0);
    let c = false;
    v.world.contactPairsWith(v.collider, o => { if (o.parent()?.isFixed?.()) c = true; });
    if (c) touched++;
  }
  return { flatOver, over, touched };
}

for (const carId of ['starter_car', 'kaze_gt', 'apex_v8']) {
  test(`bump stops: the ${carId} dropped a metre lands on its stops, not its floor`, () => {
    const r = drop(carId, 1);
    assert.equal(r.flatOver, 0, 'driving on the flat never reaches the stops');
    assert.ok(r.over > 0.01, `the springs ran out of travel (${(r.over * 1000).toFixed(0)} mm past it): the stops took it`);
    assert.ok(r.over < 0.12, `the stops held it within ${(r.over * 1000).toFixed(0)} mm`);
    assert.equal(r.touched, 0, 'the body never touched the road');
  });
}
