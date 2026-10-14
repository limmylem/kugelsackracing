// Playing quests in the game (play/questUi.js): the HUD's arrow to the next checkpoint turns the way the driver has
// to (arrowAngle), and a quest is played where it is — Start opens only at its start (distanceToStart, START_M).
// The car's frame: forward +z, its right side −x (its FR wheel sits at −x: data/cars/*/car.json); heading as
// game.carNow() gives it, atan2 of the forward vector's x and z. On screen: degrees clockwise from straight up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

globalThis.document ??= { createElement: () => ({ style: {}, classList: { toggle() {} }, appendChild() {} }), head: { appendChild() {} }, body: { appendChild() {} }, getElementById: () => null };
const { arrowAngle } = await import('../../play/questUi.js');

test('the arrow points the way to turn: ahead up, the driver\'s right clockwise, left anticlockwise, behind down — at any heading', () => {
  // (the frame as the cars have it: the front-right wheel's box at −x, in front at +z)
  const car = JSON.parse(fs.readFileSync(new URL('../../data/cars/apex_v8/car.json', import.meta.url), 'utf8')), fr = JSON.stringify(car).match(/"FR":\{"box":\{"min":\[([-\d.]+),[-\d.]+,([-\d.]+)\]/);
  assert.ok(fr && +fr[1] < 0 && +fr[2] > 0, `the front-right wheel at −x, +z: ${fr?.slice(1)}`);
  for (const heading of [0, 37, 90, -120, 180]) {
    const h = heading * Math.PI / 180, f = [Math.sin(h), Math.cos(h)], right = [-f[1], f[0]];    // (right: −x when facing +z)
    const at = ([x, z]) => arrowAngle({ x: 5, z: -3, heading }, { x: 5 + x * 100, z: -3 + z * 100 });
    assert.ok(Math.abs(at(f)) < 1e-9, `ahead at heading ${heading}: ${at(f)}`);
    assert.ok(Math.abs(at(right) - 90) < 1e-9, `to the right at heading ${heading}: ${at(right)}`);
    assert.ok(Math.abs(at([-right[0], -right[1]]) + 90) < 1e-9, `to the left at heading ${heading}: ${at([-right[0], -right[1]])}`);
    assert.ok(Math.abs(Math.abs(at([-f[0], -f[1]])) - 180) < 1e-9, `behind at heading ${heading}`);
  }
});

test('a quest is played where it is: Start opens only within START_M of its start (a track event anywhere)', async () => {
  const { distanceToStart, START_M } = await import('../../play/questUi.js');
  const toXZ = (lat, lon) => [lon * 1000, -lat * 1000];       // (a stand-in projection: 1 m a milli-degree)
  const quest = { kind: 'quest', location: { lat: 0.1, lon: 0.2 } }, at = toXZ(0.1, 0.2);
  assert.ok(START_M >= 30 && START_M <= 100, `${START_M} m: on its marker, not a street away`);
  assert.ok(distanceToStart(quest, { x: at[0] + 10, z: at[1] }, toXZ) <= START_M, 'beside its marker: it can start');
  assert.ok(distanceToStart(quest, { x: at[0] + 2500, z: at[1] }, toXZ) > START_M, '2.5 km away: drive there first');
  assert.equal(distanceToStart({ ...quest, track: { layout: 'loop' } }, { x: 9e6, z: 9e6 }, toXZ), null, 'a track event: its venue\'s card starts it');
  assert.equal(distanceToStart({ kind: 'poi', location: quest.location }, { x: 0, z: 0 }, toXZ), null);
});
