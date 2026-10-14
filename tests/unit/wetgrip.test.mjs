// A wet road (data/tracks.json conditions: rain's grip, applyGrip): physics/sim.js setGrip takes every car's grip on
// every surface down — the player's and the NPCs', added before or after — and the NPCs plan their speeds on it
// (route/racingLine.js wetCaps). On the skidpad's road a car turning hard slides wide on a wet road where it holds the
// line on a dry one.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from '../harness.mjs';
import { createSimulation } from '../../physics/sim.js';
import { carCaps, wetCaps } from '../../route/racingLine.js';

const H = await harness();
const TRACKS = (await import('../../data/tracks.json', { with: { type: 'json' } })).default;

test('wet grip: setGrip reaches every car in the sim, and the tyres', () => {
  const spec = H.garage(null, 'starter_car').stats().spec, sockets = H.socketsOf(spec);
  const sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets, track: H.track });
  sim.addCar({ position: [-300, 0, 2980], headingDeg: 180 }, () => ({ device: 'wheel', throttle: 0, brake: 0, steer: 0 }));
  const k = TRACKS.conditions.weather.rain.grip;
  assert.ok(TRACKS.conditions.applyGrip && k < 1, 'rain takes grip away');
  sim.setGrip(k);
  sim.addCar({ position: [-300, 0, 2960], headingDeg: 180 }, () => ({ device: 'wheel', throttle: 0, brake: 0, steer: 0 }));
  sim.resetCar({ position: [-300, 0, 3000], headingDeg: 180 });
  for (let i = 0; i < 60; i++) sim.step({ device: 'wheel', throttle: 0, brake: 0, steer: 0 });
  assert.equal(sim.gripScale, k);
  for (const w of sim.vehicle.wheels) assert.ok(Math.abs(w.grip - k) < 1e-9, `${w.name}: ${w.grip}`);
  sim.setGrip(1);
  sim.step({ device: 'wheel', throttle: 0, brake: 0, steer: 0 });
  for (const w of sim.vehicle.wheels) assert.equal(w.grip, 1);
  sim.vehicle.world.free();
});

test('wet grip: a car cornering hard holds less on a wet road; the AI plans for it', () => {
  const spec = H.garage(null, 'starter_car').stats().spec, sockets = H.socketsOf(spec);
  // (steady speed, a fixed steering angle: how far the car turns in 4 s)
  const yawAfter = k => {
    const sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets, track: H.track });
    sim.setGrip(k);
    sim.resetCar({ position: [-300, 0, 3500], headingDeg: 180, speed: 22 });
    Object.assign(sim.vehicle.aids, { esc: false, tc: false });
    let yaw = 0;
    for (let i = 0; i < 480; i++) { sim.step({ device: 'wheel', throttle: 0.35, brake: 0, steer: 0.18 }); yaw += Math.abs(sim.vehicle.yawRate ?? 0) * sim.dt; }
    sim.vehicle.world.free();
    return yaw;
  };
  const dry = yawAfter(1), wet = yawAfter(TRACKS.conditions.weather.rain.grip);
  assert.ok(wet < dry * 0.97, `turned ${(dry * 57.3).toFixed(0)}° dry, ${(wet * 57.3).toFixed(0)}° wet`);
  const caps = carCaps(H.garage(null, 'starter_car').stats()), w = wetCaps(caps, 0.8);
  assert.equal(wetCaps(caps, 1), caps);
  assert.ok(Math.abs(w.grip - caps.grip * 0.8) < 1e-9 && Math.abs(w.brake - caps.brake * 0.8) < 1e-9 && w.power === caps.power);
});
