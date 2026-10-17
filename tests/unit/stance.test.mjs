// How a parked car stands as drawn (garage/stats.js restingStance — the garage's floor): every stock car as its model
// draws it; a lower ride height, bigger tyres and a lift kit move the body, the tyres stay on the floor (a drop: how far a
// wheel sits up its arch from where the model draws it)
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from '../harness.mjs';
import { restingStance } from '../../garage/stats.js';

const H = await harness();
const stanceOf = g => { const s = g.stats(); assert.deepEqual(s.errors, []); return restingStance(g.car, s.spec); };

for (const id of Object.keys(H.db.cars)) {
  test(`${id}: stock, it stands as its model draws it`, () => {
    const st = stanceOf(H.garage(null, id));
    assert.ok(Math.abs(st.y) < 0.006 && Math.abs(st.pitch) < 0.005, `y ${st.y.toFixed(4)} m, pitch ${st.pitch.toFixed(4)}`);
    for (const [k, d] of Object.entries(st.drop)) assert.ok(Math.abs(d) < 0.006, `${k} drops ${d.toFixed(4)} m`);
  });
}

test('coilovers on their lowest setting: the body comes down, the wheels up into the arches', () => {
  const g = H.garage(), before = stanceOf(g);
  assert.ok(g.install('sport_suspension').ok);
  const sock = g.tunable().find(t => t.setting === 'rideHeight').socket;
  assert.ok(g.tune(sock, 'rideHeight', -40).ok);
  const after = stanceOf(g);
  assert.ok(after.y < before.y - 0.04, `the body ${(1000 * (after.y - before.y)).toFixed(0)} mm`);
  for (const k of ['FL', 'RR']) assert.ok(after.drop[k] > before.drop[k] + 0.04, `${k}: ${(1000 * (after.drop[k] - before.drop[k])).toFixed(0)} mm`);
  // (each tyre on the floor: the body's lift is the wheels' rise, the other way)
  assert.ok(Math.abs((after.y - before.y) + (after.drop.FL - before.drop.FL)) < 0.01);
});

test('bigger wheels and tyres: the car stands higher on them', () => {
  const g = H.garage(), before = stanceOf(g);
  assert.ok(g.install('wheel_17_alloy').ok && g.install('tyre_205_45r17').ok);
  const after = stanceOf(g), dr = g.stats().spec.wheels.radius - 0.29;
  assert.ok(dr > 0.01 && Math.abs(after.y - before.y - dr) < 0.003, `radius +${(1000 * dr).toFixed(0)} mm, body +${(1000 * (after.y - before.y)).toFixed(0)} mm`);
});

test('a lift kit on the Ridgeback: the body goes up', () => {
  const g = H.garage(null, 'ridgeback_4x4'), before = stanceOf(g);
  assert.ok(g.install('ridgeback_4x4_lift_kit_2in').ok);
  const after = stanceOf(g);
  assert.ok(after.y > before.y + 0.03, `the body +${(1000 * (after.y - before.y)).toFixed(0)} mm`);
});
