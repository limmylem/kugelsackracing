// Camber kits: the wheels' static camber, set in the tuning tab — the grip it gives and costs (physics/camber.js), the
// spec and the rating it reaches through the stats calculator, and the wheels leaning as set (physics/sockets.js)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Garage, loadGarageData } from '../../garage/data.js';
import { camberGrip } from '../../physics/camber.js';
import { camberOf, wheelTransform } from '../../physics/sockets.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { db } = await loadGarageData(async rel => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')));

test('no static camber changes nothing, however the body rolls', () => {
  for (const roll of [-4, 0, 2.5, 6]) assert.deepEqual(camberGrip(0, roll), { lat: 1, long: 1 });
});

test('a little negative camber: more grip for the loaded outside tyre in a corner, less braking and accelerating; positive: less of both', () => {
  const outside = g => camberGrip(g, 3).lat;
  assert.ok(outside(-2) > 1.03, `−2°: ${outside(-2)}`);
  assert.ok(camberGrip(-2).long < 1 && camberGrip(-2).long > 0.9);
  assert.ok(outside(1) < 1 && camberGrip(1).long < 1);
  // (far too much: the inside tyres and the straights lose more than the outside tyre gains)
  assert.ok(camberGrip(-6, -3).lat < 0.9 && camberGrip(-6).lat < 1);
});

test('the race camber plates, fitted and tuned: the spec, the rating and the wheels follow', () => {
  const g = new Garage(db, null, 'starter_car'), stock = g.stats();
  assert.deepEqual(stock.spec.suspension.camber, { front: 0, rear: 0 }, 'none as it comes');
  assert.equal(g.install('camber_plates_race').ok, true);
  const fitted = g.stats();
  assert.deepEqual(fitted.spec.suspension.camber, { front: -2, rear: -1.5 }, 'its defaults');
  assert.ok(fitted.totals.rating.estimates.grip > stock.totals.rating.estimates.grip, 'more cornering grip');
  assert.ok(fitted.totals.rating.estimates.braking > stock.totals.rating.estimates.braking, 'a longer stop');
  assert.equal(g.tune('camber_plates_race', 'front', 1).ok, true);
  assert.equal(g.tune('camber_plates_race', 'rear', 1).ok, true);
  assert.ok(g.stats().totals.rating.estimates.grip < stock.totals.rating.estimates.grip, 'positive camber: less grip');
  // (out of range: clamped)
  g.tune('camber_plates_race', 'front', -20);
  assert.equal(g.stats().spec.suspension.camber.front, -6);
  assert.equal(camberOf(g.stats().spec, 'FL'), -6 * Math.PI / 180);
  assert.equal(camberOf(g.stats().spec, 'RR'), 1 * Math.PI / 180);
});

test('a wheel with negative camber leans its top in, on either side of the car', () => {
  // (rigs as modelRig makes them: in each wheel socket's own frame — the right-hand sockets turned 180° round y,
  // so the right wheel's outboard is its socket's +x too)
  const left = { socket: [0, 0, 0], axle: [1, 0, 0], up: [0, 1, 0], outboard: [1, 0, 0] };
  const right = { socket: [0, 0, 0], axle: [-1, 0, 0], up: [0, 1, 0], outboard: [1, 0, 0] };
  const topOf = (rig, camber) => {
    const [x, y, z, w] = wheelTransform(rig, [0, 0, 0, 1], 0, 0, 0, 0, camber).rotation;
    // (the wheel's up, (0, 1, 0), turned by the quaternion)
    return [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
  };
  for (const rig of [left, right]) {
    const top = topOf(rig, -3 * Math.PI / 180);
    assert.ok(top[0] < -0.04, `top in (towards −outboard): ${top}`);
    assert.ok(topOf(rig, 2 * Math.PI / 180)[0] > 0.03, 'positive: top out');
    assert.deepEqual(topOf(rig, 0), [0, 1, 0]);
  }
});
