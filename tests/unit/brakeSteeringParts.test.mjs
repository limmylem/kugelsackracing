// The brake and steering upgrades: braided lines (more bite), racing fluid (later fade), cooling ducts (cooler discs), a
// quick rack and a steering angle kit (more lock: a tighter turning circle) — each does what it says in the physics,
// and a car without them drives as before

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from '../harness.mjs';
import { createSimulation } from '../../physics/sim.js';
import { Brakes } from '../../physics/brakes.js';

const H = await harness();
const specWith = (...ids) => { const g = H.garage(); for (const id of ids) assert.equal(g.install(id).ok, true, id); return g.stats().spec; };
const stock = specWith();

// The diameter of the circle the car drives at walking pace on full lock (a steering wheel turned all the way), m
function turningCircle(spec) {
  const sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets: H.socketsOf(spec), track: H.track });
  sim.resetCar({ position: [0, 0, -2500], headingDeg: 0, speed: 0 });
  const v = sim.vehicle, inp = () => ({ device: 'wheel', wheelRange: spec.steering.maxWheelRotation, steer: 1, throttle: v.forwardSpeed() < 2.5 ? 0.5 : 0.1, brake: 0, handbrake: false });
  for (let i = 0; i < 3 / sim.dt; i++) sim.step(inp());
  const pts = [];
  for (let i = 0; i < 25 / sim.dt; i++) { sim.step(inp()); if (i % 10 === 0) { const p = v.body.translation(); pts.push([p.x, p.z]); } }
  let d = 0;
  for (const a of pts) for (const b of pts) d = Math.max(d, Math.hypot(a[0] - b[0], a[1] - b[1]));
  return d;
}

test('a quick rack and a steering angle kit: more lock, a tighter turning circle — the kit tighter still', () => {
  const lock = s => s.steering.maxWheelRotation / 2 / s.steering.ratio;
  const rack = specWith('steering_rack_quick'), kit = specWith('steering_angle_kit');
  assert.ok(lock(rack) > lock(stock) * 1.15 && lock(kit) > lock(stock) * 1.35, `${lock(stock).toFixed(1)}° → ${lock(rack).toFixed(1)}°, ${lock(kit).toFixed(1)}°`);
  const [c0, c1, c2] = [stock, rack, kit].map(turningCircle);
  assert.ok(c1 < c0 * 0.92, `quick rack: ${c0.toFixed(1)} m → ${c1.toFixed(1)} m`);
  assert.ok(c2 < c1 * 0.92, `angle kit: ${c2.toFixed(1)} m`);
  // (at speed the keys and pad reach about as far as before: falloffSpeed shrinks a little faster than the ratio)
  const reach = (s, v) => lock(s) / (1 + v / s.steering.falloffSpeed);
  assert.ok(Math.abs(reach(kit, 40) - reach(stock, 40)) / reach(stock, 40) < 0.08, `at 40 m/s: ${reach(stock, 40).toFixed(2)}° and ${reach(kit, 40).toFixed(2)}°`);
});

test('braided lines: more brake torque for the same pedal', () => {
  const wheels = [{ front: true }, { front: true }, { front: false }, { front: false }];
  const torque = spec => { const b = new Brakes(spec, wheels, 0.1); return b.torqueAt(b.state[0], b.requested(b.state[0], 0.5)); };
  assert.ok(torque(specWith('brake_lines_braided')) > torque(stock) * 1.07);
});

test('racing fluid fades later; cooling ducts cool the discs faster', () => {
  const wheels = [{ front: true }, { front: false }];
  const fadeAt = (spec, temp) => { const b = new Brakes(spec, wheels, 0.1); return b.padMu(b.state[0].axle, temp) / b.state[0].axle.padMu; };
  assert.ok(fadeAt(specWith('brake_fluid_race'), 320) > fadeAt(stock, 320) + 0.05, `at 320 °C: ${fadeAt(stock, 320).toFixed(2)} → ${fadeAt(specWith('brake_fluid_race'), 320).toFixed(2)} of their grip`);
  const after = spec => { const b = new Brakes(spec, wheels, 0.1); b.state[0].temp = 450; for (let i = 0; i < 300; i++) b.cool(0.1, 30); return b.state[0].temp; };
  assert.ok(after(specWith('brake_cooling_ducts')) < after(stock) - 20, `30 s at 108 km/h from 450 °C: ${after(stock).toFixed(0)} → ${after(specWith('brake_cooling_ducts')).toFixed(0)} °C`);
});

test('none of them changes a car they aren\'t fitted to, and they fit every car', () => {
  assert.equal(stock.steering.ratio, H.db.cars.starter_car.steering.ratio);
  for (const carId of Object.keys(H.db.cars)) for (const id of ['brake_lines_braided', 'brake_fluid_race', 'brake_cooling_ducts', 'steering_rack_quick', 'steering_angle_kit']) {
    const g = H.garage(null, carId); assert.equal(g.install(id).ok, true, `${id} on the ${carId}`);
  }
});
