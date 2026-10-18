// The boat kit (data/parts/boat, physics/boat.js): floats and an outboard fit every car and set its boat stats; in
// water, a car with floats settles at the surface, the outboard takes it up to about its top speed, the steering turns
// it (left is left); a car without floats doesn't float or sail; out of the water nothing changes.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from '../harness.mjs';
import { createSimulation } from '../../physics/sim.js';
import { waterForces } from '../../physics/boat.js';

const H = await harness();
const LEVEL = 2.5, idle = { device: 'wheel', throttle: 0, brake: 0, steer: 0, handbrake: false };

function kitted(parts = ['boat_floats', 'outboard_15'], carId = undefined) {
  const g = H.garage(null, carId);
  for (const id of parts) { const r = g.install(id); assert.ok(r.ok, `${id}: ${r.errors?.map(e => e.message).join(' ')}`); }
  return g.stats().spec;
}
function afloat(spec, seconds, input = idle) {
  const sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets: H.socketsOf(spec), track: H.track });
  sim.resetCar({ position: [0, LEVEL, 0], headingDeg: 0, speed: 0 });
  sim.vehicle.water = { level: LEVEL };
  for (let i = 0; i < seconds / sim.dt; i++) sim.step(input);
  return sim.vehicle;
}
const at = v => v.body.translation();

test('the boat parts fit every car and set its boat stats', () => {
  for (const carId of Object.keys(H.db.cars)) {
    const b = kitted(['boat_floats', 'outboard_60'], carId).boat;
    assert.ok(b.floats > 1 && b.thrust > 0 && b.topSpeed > 0, `${carId}: ${JSON.stringify(b)}`);
  }
  assert.deepEqual(H.garage().stats().spec.boat, { floats: 0, thrust: 0, topSpeed: 0 }, 'a stock car: none');
});

test('afloat: settles at the surface, the outboard pushes it along, steering turns it', () => {
  const spec = kitted();
  let v = afloat(spec, 6);
  const floor = at(v).y + spec.bodyCollider.centre[1] - spec.bodyCollider.halfExtents[1];
  assert.ok(floor < LEVEL && floor > LEVEL - 0.6, `its floor ${floor.toFixed(2)} m against the surface at ${LEVEL}`);
  assert.ok(Math.abs(v.forwardSpeed()) < 0.3, 'still, with no throttle');
  v = afloat(spec, 14, { ...idle, throttle: 1 });
  const top = spec.boat.topSpeed;
  assert.ok(v.forwardSpeed() > top * 0.6 && v.forwardSpeed() < top * 1.15, `${v.forwardSpeed().toFixed(1)} m/s against its ${top}`);
  assert.ok(v.inWater?.motor > 0.8, 'the motor running');
  // (left is +x, as on land)
  const turned = at(afloat(spec, 8, { ...idle, throttle: 1, steer: 1 })).x;
  assert.ok(turned > 2, `steering left turns it left (${turned.toFixed(1)} m across)`);
  // a bigger motor: faster
  assert.ok(afloat(kitted(['boat_floats', 'outboard_60']), 14, { ...idle, throttle: 1 }).forwardSpeed() > v.forwardSpeed() * 1.5);
});

test('no floats: it doesn\'t float or sail', () => {
  const spec = kitted(['outboard_60']);
  const v = afloat(spec, 6, { ...idle, throttle: 1 });
  assert.ok(at(v).y < LEVEL - 0.8, `sunk (${at(v).y.toFixed(2)})`);
  assert.equal(v.inWater?.motor ?? 0, 0, 'the motor never pushes a car that isn\'t afloat');
});

test('no water: nothing', () => {
  assert.deepEqual(waterForces({ level: null }).forces, []);
});
