// Pulling away while already rolling too slowly for 1st to carry the engine, on every car: coasted down to
// 11 km/h with nothing pressed, then flat out, the car gets going at once — the clutch slips to pull away,
// the engine nowhere near its limiter, and has the gear within a second. (The auto-clutch slipped only
// below 4 × the stop speed, 7 km/h; above that, and under the speed where 1st turns the engine at idle +
// engageAbove — 13 km/h on the Apex V8 — it stayed open, the engine on its limiter until the car had
// rolled down to a crawl.)
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from '../harness.mjs';
import { createSimulation } from '../../physics/sim.js';
import { roadLine } from '../../physics/track.js';

const H = await harness();

function rollingFloor(carId) {
  const spec = H.garage(null, carId).stats().spec;
  const sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets: H.socketsOf(spec), track: H.track }), v = sim.vehicle, d = v.drivetrain;
  const T = H.track.tests.straight, line = roadLine(H.track.roads[T.road]), s0 = line[Math.round(T.startAt / 2)];
  sim.resetCar({ position: [s0.x, 0, s0.z], headingDeg: Math.atan2(s0.tx, s0.tz) * 180 / Math.PI, speed: 0 });
  const pedals = throttle => ({ device: 'keyboard', throttle, brake: 0, steer: 0, handbrake: false, clutch: null }), kmh = () => v.forwardSpeed() * 3.6;
  for (let i = 0; i < 0.8 / sim.dt; i++) sim.step(pedals(0));
  while (kmh() < 25 && sim.time < 20) sim.step(pedals(1));
  while (kmh() > 11 && sim.time < 60) sim.step(pedals(0));
  const from = kmh(), t0 = sim.time;
  let most = 0, lockedAt = null;
  while (sim.time - t0 < 1.5) {
    sim.step(pedals(1));
    most = Math.max(most, d.rpm);
    if (lockedAt == null && d.clutchLocked && d.gear >= 1) lockedAt = sim.time - t0;
  }
  return { spec, from, to: kmh(), most, lockedAt };
}

for (const carId of Object.keys(H.db.cars)) {
  test(`${carId}: flat out from rolling at 11 km/h, it pulls away at once, off the limiter`, () => {
    const r = rollingFloor(carId), E = r.spec.engine;
    assert.ok(r.most < E.redlineRpm * 0.85, `the engine reached ${r.most.toFixed(0)} rpm (redline ${E.redlineRpm})`);
    assert.ok(r.lockedAt != null && r.lockedAt < 1, `the clutch had the gear ${r.lockedAt == null ? 'never' : `after ${r.lockedAt.toFixed(2)} s`}`);
    assert.ok(r.to > r.from + 8, `from ${r.from.toFixed(1)} km/h it got to ${r.to.toFixed(1)} km/h in 1.5 s`);
  });
}
