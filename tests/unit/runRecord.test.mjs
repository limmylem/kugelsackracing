// A multiplayer run's record and its checks (Phase 7 Step 3; mp/runRecord.js, mp/verify.js; docs/CONTACT.md
// "Verification"): a run recorded on a generated track — its inputs, a contact's pushes, a reset — driven again
// exactly; and the same record edited every way a cheat might, each caught.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDetMath } from '../../physics/detmath.js';
installDetMath();
import { harness, load } from '../harness.mjs';
import { createSimulation } from '../../physics/sim.js';
import { createRunRecorder, quantizeInput, inputFrom } from '../../mp/runRecord.js';
import { trackFor, replayRun, compareTrails, checkContacts, checkTrail } from '../../mp/verify.js';

const CFG = load('data/multiplayer.json').contact;
const CODE = '0C318-A081G-A0X00-06000-0009E-4';

test('inputs are recorded as the car got them: 5 bytes, read back the same', () => {
  const inputs = [{ steer: -1, throttle: 1, brake: 0, device: 'wheel' }, { steer: 0.37, throttle: 0.2, brake: 0.9, handbrake: true, shift: 1, clutch: 0.5 }, {}];
  for (const i of inputs) {
    const q = quantizeInput(i), back = inputFrom(q);
    assert.deepEqual(quantizeInput(back), q, JSON.stringify(i));
    assert.ok(Math.abs(back.steer - (i.steer ?? 0)) <= 1 / 127 && Math.abs(back.throttle - (i.throttle ?? 0)) <= 1 / 255);
  }
});

test('a run with a contact and a reset, driven again: exactly where it said, every second; a hidden push is caught', async () => {
  const H = await harness(), T = trackFor(CODE, load('data/tracks.json'));
  const spec = H.garage(null, 'starter_car').stats().spec, sockets = H.socketsOf(spec);
  const sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets, track: T.track });
  const slot = T.course.grid.slots[0];
  sim.resetCar({ position: [slot.x, 0.6, slot.z], headingDeg: slot.heading });
  for (let i = 0; i < 60; i++) sim.step({ steer: 0, throttle: 0, brake: 0, handbrake: true });
  const R = createRunRecorder({ sim });
  const b = sim.vehicle.body, p = b.translation();
  R.start({ pose: { position: [p.x, p.y, p.z], headingDeg: slot.heading }, t0: 0 });
  let hidden = false;
  const stop = sim.beforeWorldStep(() => {
    const k = R.steps;
    // a hit from behind (the agreed one, say), spread over a few steps; later a push nobody recorded
    if (k >= 400 && k < 407) R.push([1200, 0], [b.translation().x, b.translation().z], { c: 'L', ep: 1, h: 1, o: 'other', at: k * 8, f: [b.translation().x - 4, b.translation().z, 0, 0, 0, 0] });
    if (hidden && k === 900) b.applyImpulse({ x: 0, y: 0, z: 1500 }, true);
  });
  for (let i = 0; i < 1200; i++) {
    if (i === 700) sim.resetCar({ position: [b.translation().x, b.translation().y + 0.3, b.translation().z], headingDeg: slot.heading });
    sim.step({ steer: Math.sin(i / 90) * 0.3, throttle: i < 1000 ? 0.7 : 0, brake: i >= 1000 ? 0.6 : 0, device: 'wheel' });
  }
  const run = R.stop();
  stop();
  assert.equal(run.steps, 1200);
  assert.ok(run.events.some(e => e.k === 'R') && run.events.filter(e => e.k === 'J').length === 7, 'the reset and the pushes are in the record');
  const again = replayRun({ RAPIER: H.RAPIER, settings: H.settings, spec, sockets, track: T.track, run });
  assert.deepEqual(compareTrails(run.trail, again.trail, 0.01), [], 'driven again, exactly where it said');
  assert.ok(Math.hypot(...again.final.map((v, i) => v - [b.translation().x, b.translation().y, b.translation().z][i])) < 1e-9, 'the same final position, bit for bit');
  // the same run without its pushes in the record: driven again, it doesn't arrive
  const without = { ...run, events: run.events.filter(e => e.k !== 'J') };
  assert.ok(compareTrails(run.trail, replayRun({ RAPIER: H.RAPIER, settings: H.settings, spec, sockets, track: T.track, run: without }).trail, 0.01).length > 0, 'pushes left out of the record: caught');
  sim.vehicle.world.free();

  // and its pushes against a race server's log: the agreed impulse 8400 N s from behind (7 × 1200); the other car there
  const at = s => [s * 8, b.translation().x, b.translation().z, 0, 0, 0];
  const srvOther = run.events.filter(e => e.k === 'J').map(e => [e.at, e.f[0], e.f[1], 0, 0, 0]);
  const log = { contacts: [{ cid: 'c1', t: 3200, eps: { me: 1 }, cars: { me: { impulse: [8400, 0], mass: spec.mass }, other: { impulse: [-8400, 0] } }, srv: { other: srvOther } }], rejected: [] };
  void at;
  assert.ok(checkContacts({ uid: 'me', run, log, cfg: CFG }).ok, 'the honest pushes add up');
  const fake = (name, edit) => { const x = JSON.parse(JSON.stringify(run)); edit(x); const v = checkContacts({ uid: 'me', run: x, log, cfg: CFG }); assert.ok(!v.ok, `${name}: ${v.problems[0] ?? 'passed'}`); };
  fake('a push nobody agreed', x => x.events.push({ s: 950, k: 'J', c: 'L', ep: 9, j: [2000, 0], p: [0, 0] }));
  fake('a bigger push', x => { for (const e of x.events) if (e.k === 'J') e.j = [e.j[0] * 1.5, e.j[1]]; });
  fake('against a car that wasn\'t there', x => { for (const e of x.events) if (e.k === 'J') e.f = [e.f[0] + 30, e.f[1], 0, 0, 0, 0]; });
  fake('a correction for a contact never agreed', x => x.events.push({ s: 960, k: 'J', c: 'F', cid: 'c99', j: [900, 0], p: [0, 0] }));
  // a refused contact: undone (the push and its reverse) passes; kept, it fails
  const refused = { contacts: [], rejected: [{ uid: 'me', ep: 1 }] };
  assert.ok(!checkContacts({ uid: 'me', run, log: refused, cfg: CFG }).ok, 'a refused contact kept');
  const undone = JSON.parse(JSON.stringify(run)); undone.events.push({ s: 450, k: 'J', c: 'F', cid: 'x1', j: [-8400, 0], p: [0, 0] });
  assert.ok(checkContacts({ uid: 'me', run: undone, log: refused, cfg: CFG }).ok, 'a refused contact undone');
  // where the server saw the car: the run's own trail passes; a run claiming to be elsewhere doesn't
  const serverTrail = run.trail.map(([s, x, , z]) => [s * 1000 / 120, x, z, 0, 0]);
  assert.deepEqual(checkTrail({ run, serverTrail, cfg: CFG }), []);
  assert.ok(checkTrail({ run, serverTrail: serverTrail.map(([t, x, z, vx, vz]) => [t, x + 9, z, vx, vz]), cfg: CFG }).length > 0);
});

test('on a floating origin (a real-world route): the trail and the pushes\' points are kept in the world\'s frame', async () => {
  const H = await harness(), T = trackFor(CODE, load('data/tracks.json'));
  const spec = H.garage(null, 'starter_car').stats().spec, sockets = H.socketsOf(spec);
  const sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets, track: T.track });
  const slot = T.course.grid.slots[0], O = [5000, 0, -3000], toWorld = p => [p[0] + O[0], p[1] + O[1], p[2] + O[2]];
  sim.resetCar({ position: [slot.x, 0.6, slot.z], headingDeg: slot.heading });
  for (let i = 0; i < 60; i++) sim.step({ handbrake: true });
  const R = createRunRecorder({ sim, toWorld }), b = sim.vehicle.body, p = b.translation();
  R.start({ pose: { position: [p.x, p.y, p.z], headingDeg: slot.heading }, t0: 0, origin: toWorld([0, 0, 0]) });
  // (a light rubbing push away from a car alongside on the left: its proxy's pose in the world's frame)
  const stop = sim.beforeWorldStep(() => { if (R.steps === 200) { const q = b.translation(); R.push([0, -40], [q.x, q.z], { c: 'L', ep: 1, o: 'other', at: 1667, f: [q.x + O[0], q.z + 2 + O[2], 0, 0, 0, 0] }); } });
  for (let i = 0; i < 480; i++) sim.step({ throttle: 0.6, device: 'wheel' });
  const run = R.stop(); stop();
  const atWorld = run.trail.map(([s, x, , z]) => [s * 1000 / 120, x, z, 0, 0]);
  assert.ok(Math.abs(run.trail[0][1] - (p.x + O[0])) < 0.01, 'the trail in the world\'s frame');
  assert.deepEqual(checkTrail({ run, serverTrail: atWorld, cfg: CFG }), []);
  const J = run.events.find(e => e.k === 'J');
  assert.ok(J.w && Math.abs(J.w[0] - (J.p[0] + O[0])) < 0.01, 'the push\'s point in both frames');
  const log = { contacts: [{ cid: 'c1', t: 1667, eps: { me: 1 }, cars: { me: { impulse: [0, 0], mass: spec.mass }, other: { impulse: [0, 0] } }, srv: { other: [[1600, J.f[0], J.f[1], 0, 0, 0], [1700, J.f[0], J.f[1], 0, 0, 0]] } }], rejected: [] };
  assert.ok(checkContacts({ uid: 'me', run, log, cfg: CFG }).ok, 'a rubbing push away from the other car, in the world\'s frame');
  sim.vehicle.world.free();
});
