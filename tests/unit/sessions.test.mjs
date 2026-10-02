// Driving sessions and what comes with them (physics/carCollisions.js, physics/race.js, physics/replay.js,
// garage/hints.js): a car-to-car hit is felt by the relative speed, the direction and the masses, and
// damages both cars; the collision modes — full, reduced (the public races' default) and off (ghosting:
// the cars pass through each other); what a test drive and a race allow; the crash replay's recording
// and its slow-motion playback; first-time hints, once.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crashContext, harness } from '../harness.mjs';
import { createSimulation } from '../../physics/sim.js';
import { CAR, carHitScale, collisionGroups, impactStrength, shares } from '../../physics/carCollisions.js';
import { MODES, createSession } from '../../physics/race.js';
import { ReplayPlayer, ReplayRecorder } from '../../physics/replay.js';
import { CarDamage } from '../../garage/carDamage.js';
import { Hints, crashEvents } from '../../garage/hints.js';

const H = await harness(), ctx = await crashContext(), db = H.db, car = db.cars.starter_car, boxes = ctx.boxesOf(car);
const IDLE = { device: 'wheel', throttle: 0, brake: 0, steer: 0, handbrake: false };

test('a hit\'s strength: into a wall, the closing speed; into a car as heavy, half; the lighter car feels more; a push that didn\'t stop it, less', () => {
  assert.equal(impactStrength({ closing: 20, impulse: 1e9, mass: 1200 }), 20);
  assert.equal(impactStrength({ closing: 20, impulse: 1e9, mass: 1200, otherMass: 1200 }), 10);
  const light = impactStrength({ closing: 20, impulse: 1e9, mass: 1000, otherMass: 2000 }), heavy = impactStrength({ closing: 20, impulse: 1e9, mass: 2000, otherMass: 1000 });
  assert.ok(Math.abs(light - 20 * 2 / 3) < 1e-9 && Math.abs(heavy - 20 / 3) < 1e-9);
  assert.deepEqual(shares(1000, 3000), { a: 0.75, b: 0.25 });
  // (a cone just moves out of the way: the push is what the car really felt)
  assert.equal(impactStrength({ closing: 20, impulse: 1200 * 2, mass: 1200 }), 2);
  assert.equal(impactStrength({ closing: -3, impulse: 100, mass: 1200 }), 0);
});

test('collision modes: full and reduced cars hit each other, ghosting doesn\'t; reduced takes a share of the damage from cars only', () => {
  assert.deepEqual(MODES, ['full', 'reduced', 'off']);
  for (const mode of ['full', 'reduced']) assert.ok(collisionGroups(mode) & CAR, mode);
  const ghost = collisionGroups('off');
  assert.equal(ghost >>> 16, CAR, 'still a car');
  assert.equal(ghost & CAR, 0, 'but touches no other car');
  const R = db.sessions.collisions, wall = { other: 'world' }, other = { other: 'car' };
  assert.equal(carHitScale(wall, 'reduced', R), 1);
  assert.equal(carHitScale(other, 'full', R), 1);
  assert.equal(carHitScale(other, 'reduced', R), R.reduced);
  assert.equal(carHitScale(other, 'off', R), 0);
  assert.ok(R.reduced > 0 && R.reduced < 1);
  assert.equal(R.public, 'reduced', 'public races: reduced by default');
});

// Two of the starter car meeting head on at closing kmh on the test centre's straight, in a collision
// mode: each car's hits (from the other car) and where each ended up
function headOn(mode, kmh = 60) {
  const g = H.garage(), spec = g.stats().spec, sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets: H.socketsOf(spec), track: H.track }), v = kmh / 3.6 / 2;
  sim.resetCar({ position: [-300, 0, -3000], headingDeg: 0, speed: v });
  sim.addCar({ position: [-300, 0, -3000 + 10], headingDeg: 180, speed: v }, () => IDLE);
  sim.setCollisions(mode);
  const A = sim.vehicle, B = sim.cars[0].vehicle, hits = [[], []];
  for (let i = 0; i < 2 / sim.dt; i++) { sim.step(IDLE); [A, B].forEach((x, k) => hits[k].push(...x.sensor.take().filter(h => h.other === 'car'))); }
  return { hits, z: [A.body.translation().z, B.body.translation().z], g };
}

test('car to car: both cars are hit, as hard as each other (the same car), and both take damage; reduced takes less; ghosting passes through', () => {
  const full = headOn('full');
  assert.ok(full.hits[0].length && full.hits[1].length, 'both hit');
  const [a, b] = full.hits.map(h => Math.max(...h.map(x => x.strength)));
  assert.ok(Math.abs(a - b) < 0.25 * Math.max(a, b), `fair: ${a.toFixed(1)} and ${b.toFixed(1)} m/s`);
  assert.ok(a > 6 && a < 13, `each feels about half the 16.7 m/s they closed at: ${a.toFixed(1)}`);
  // the damage, by the session: a test drive takes all of it, a public race a share
  const damageIn = (kind, hits) => {
    const s = createSession(db.sessions, kind), cd = new CarDamage({ car, build: full.g.build, view: full.g.view, boxes, rules: db.damage });
    for (const h of hits) cd.hit(h, { scale: s.scale(h) });
    return 100 - (cd.damage.shell?.condition ?? 100) + Object.values(cd.damage.parts).reduce((t, p) => t + 100 - p.condition, 0);
  };
  const lost = full.hits.map(h => damageIn('test', h));
  assert.ok(lost[0] > 0 && lost[1] > 0, `both damaged: ${lost.map(x => x.toFixed(0)).join(', ')} % lost`);
  assert.ok(damageIn('race', full.hits[0]) < lost[0], 'reduced: less');
  // ghosting: through each other, nobody hit
  const off = headOn('off');
  assert.equal(off.hits[0].length + off.hits[1].length, 0);
  assert.ok(off.z[0] > -3000 + 10 && off.z[1] < -3000, 'each past where the other started');
});

test('sessions: a test drive allows everything and replays crashes; a race is reduced, keeps its damage on a reset, no free repairs, no replays', () => {
  const t = createSession(db.sessions, 'test'), r = createSession(db.sessions, 'race');
  assert.equal(t.collisions, 'full');
  assert.ok(t.replay && t.restore && t.tow && !t.race);
  assert.equal(t.reset, 'all');
  assert.ok(t.allows('restore').ok && t.allows('tow').ok);
  assert.equal(r.collisions, db.sessions.collisions.public);
  assert.ok(r.race && !r.replay && !r.restore && r.tow);
  assert.equal(r.reset, 'wheels');
  const no = r.allows('restore');
  assert.ok(!no.ok && /tow/i.test(no.why), no.why);
  assert.match(r.describe(), /Race · cars hit each other for 40% of the damage · back on the road: damage stays/);
  // the settings can change a session's collisions and replays
  const ghost = createSession(db.sessions, 'race', { collisions: 'off' });
  assert.equal(ghost.scale({ other: 'car', strength: 20 }), 0);
  assert.equal(ghost.scale({ other: 'world', strength: 20 }), 1);
  assert.throws(() => createSession(db.sessions, 'rally'), /no session "rally"/);
  assert.throws(() => createSession(db.sessions, 'test', { collisions: 'bumper cars' }), /no collision mode/);
});

// a car driving along +z at 20 m/s, at time t (and another beside it)
const snap = t => ({ position: [0, 0.5, 20 * t], rotation: { x: 0, y: 0, z: 0, w: 1 }, brakeLights: t > 2, steering: { wheelAngle: 0.1 },
  wheels: ['FL', 'FR', 'RL', 'RR'].map(name => ({ name, length: 0.3, steerAngle: 0, spin: t * 60, radius: 0.31, bend: 0, off: false })),
  others: [{ id: 3, position: [4, 0.5, 20 * t], rotation: { x: 0, y: 0, z: 0, w: 1 }, wheels: [] }], debris: t > 4 ? [{ id: 1, position: [1, 0.2, 80], rotation: { x: 0, y: 0, z: 0, w: 1 } }] : [] });

test('the crash replay: the last seconds of every car kept (no more), a window round the crash, played slowly from a low angle, skippable', () => {
  const R = db.sessions.replay, rec = new ReplayRecorder({ record: R.record, rate: R.rate });
  for (let i = 0; i <= 10 * 120; i++) rec.record(i / 120, snap(i / 120));
  assert.ok(Math.abs(rec.frames.length - R.record * R.rate) <= 2, `${rec.frames.length} frames`);
  assert.ok(rec.frames[0].t >= 10 - R.record - 1e-9 && rec.frames.at(-1).t === 10);
  assert.deepEqual(rec.frames.at(-1).cars.map(c => c.id), [0, 3]);
  assert.equal(rec.frames.at(-1).debris.length, 1);
  assert.ok(rec.bytes < 2e6, `${rec.bytes} bytes`);
  // a crash at 7 s: from 2.2 s before to 1.5 s after
  const w = rec.window(7, R.before, R.after);
  assert.ok(w[0].t >= 7 - R.before - 1e-9 && w.at(-1).t <= 7 + R.after + 1e-9 && w.length > 90);
  // played at 0.3 × real time: (2.2 + 1.5) / 0.3 ≈ 12 s of frames at 60 a second
  const P = new ReplayPlayer(w, { speed: R.speed, at: 7, focus: [0, 0.5, 140] });
  let n = 0, out, crashedAt = null;
  do {
    out = P.step(1 / 60); n++;
    assert.ok(out.alpha >= 0 && out.alpha <= 1 && out.b.t >= out.a.t);
    if (crashedAt == null && P.afterCrash) crashedAt = out.t;
    const cam = P.camera(), d = Math.hypot(cam.position[0], cam.position[2] - 140);
    assert.ok(d > 5 && d < 8 && cam.position[1] > 0.5 && cam.position[1] < 3, 'low, a few metres off');
  } while (!out.done && n < 2000);
  assert.ok(Math.abs(n / 60 - (w.at(-1).t - w[0].t) / R.speed) < 0.1, `${(n / 60).toFixed(2)} s`);
  assert.ok(Math.abs(crashedAt - 7) < 0.02);
  // skipped: over at once
  const S = new ReplayPlayer(w, { speed: R.speed, at: 7 });
  S.step(1 / 60);
  S.skip();
  assert.ok(S.done && S.step(1 / 60).done);
  // (the simulation starting again starts the recording again)
  rec.record(0.5, snap(0.5));
  assert.equal(rec.frames.length, 1);
});

test('first-time hints: each shown once, where it belongs, and kept as seen; what a crash did, as hint events', () => {
  const ids = db.hints.hints.map(h => h.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const h of db.hints.hints) assert.ok(['drive', 'garage'].includes(h.where) && h.title && h.text, h.id);
  const seen = [], marked = [];
  const hints = new Hints(db.hints, { seen: () => seen, mark: id => { marked.push(id); seen.push(id); } });
  assert.equal(hints.note('damage', 'garage'), null, 'not a garage hint');
  assert.equal(hints.note('damage', 'drive').id, 'firstDamage');
  assert.equal(hints.note('damage', 'drive'), null, 'once');
  assert.deepEqual(marked, ['firstDamage']);
  assert.ok(!hints.left.some(h => h.id === 'firstDamage'));
  // (another visit, the same save: still seen)
  assert.equal(new Hints(db.hints, { seen: () => seen }).note('damage', 'drive'), null);
  assert.deepEqual(crashEvents({ dents: [{}], losses: [], broken: [] }), ['damage']);
  assert.deepEqual(crashEvents({ dents: [{}], mechanical: { damage: { x: { toe: 1 } } }, attach: [{ socket: 'socket_bonnet', to: 'loose' }] }), ['damage', 'mechanical', 'loose']);
  assert.deepEqual(crashEvents({ dents: [{}] }, 'off'), []);
});
