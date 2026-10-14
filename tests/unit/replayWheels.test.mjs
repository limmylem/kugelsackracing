// A replay's wheels (race/replayWheels.js): turning by the distance rolled, the fronts steering by the yaw rate — from
// the recorded body alone.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReplayWheels } from '../../race/replayWheels.js';

const yawQ = a => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });

test('replay wheels: rolling straight turns them by the distance, without steering', () => {
  const W = createReplayWheels({ radius: 0.3 });
  let r;
  for (let k = 0; k <= 20; k++) r = W.at(1, { position: [0, 0, k * 0.5], rotation: yawQ(0) }, k * 0.05);   // 10 m at 10 m/s
  assert.ok(Math.abs(r.spin - 10 / 0.3) < 1e-6, String(r.spin)); assert.equal(r.steer, 0);
  // backwards: the other way
  r = W.at(1, { position: [0, 0, 9.5], rotation: yawQ(0) }, 1.05);
  assert.ok(r.spin < 10 / 0.3);
});

test('replay wheels: a left-hand circle steers left, by its radius (a bicycle model); a skip starts afresh', () => {
  const W = createReplayWheels({ radius: 0.3, wheelbase: 2.6 }), R = 40, v = 15;
  let r;
  for (let k = 0; k <= 60; k++) {
    const t = k * 0.05, a = v * t / R;                    // (yaw a: heading +x of +z is left)
    r = W.at(2, { position: [R - R * Math.cos(a), 0, R * Math.sin(a)], rotation: yawQ(a) }, t);
  }
  assert.ok(r.steer > 0 && Math.abs(r.steer - Math.atan(2.6 / R)) < 0.01, `${r.steer} against ${Math.atan(2.6 / R)}`);
  r = W.at(2, { position: [500, 0, 500], rotation: yawQ(1) }, 40);
  assert.equal(r.steer, 0, 'skipped on: straight again');
});
