// Crash damage, from telemetry: the car's collisions (physics/impacts.js) found with where, which way,
// how hard and into what — and normal driving (bumps, a jump, a lap) finding none; what each does to the
// car (garage/damage.js): a light tap a small dent, 60 km/h into a wall the front caved in, glass and
// lights broken, parts losing condition by their toughness, the engine and wheels hurt by hard hits;
// the damage saved on the player's car and taken away by repairs; full damage costing performance and
// visual only not; and many crashes staying cheap.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { harness, load, root } from '../harness.mjs';
import { createSimulation } from '../../physics/sim.js';
import { nodeBoxes } from '../../physics/sockets.js';
import { addDent, applyDamage, damageLayout, impactDamage } from '../../garage/damage.js';
import { LocalPlayerService } from '../../garage/player/service.js';
import { MemoryStorage } from '../../garage/player/storage.js';
import { Garage } from '../../garage/data.js';
import { garageStateOf, repairCost, shellRepairCost } from '../../garage/player/profile.js';

const H = await harness(), rules = H.db.damage, stock = H.garage().stats().spec, car = H.db.cars.starter_car;
const glb = (() => { const b = fs.readFileSync(path.join(root, car.model.file)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); })();
const boxes = nodeBoxes(glb, car.model, [...car.model.breakables.map(b => b.node), 'body_shell']);
const layoutOf = g => damageLayout({ car, build: g.build, db: g.view, boxes }, rules);
const idle = { device: 'wheel', throttle: 0, brake: 0, steer: 0, handbrake: false };

// The car put down going at kmh just short of the test centre's wall or barrier (head on) or alongside
// the guardrail; every impact and scrape over `seconds`
function crash(kmh, target = 'wall', { seconds = 1.5, steer = 0, throttle = 0, spec = stock } = {}) {
  const sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets: H.socketsOf(spec), track: H.track });
  const C = H.track.tests.crash, t = C[target], v = sim.vehicle, gap = Math.min(C.gap, Math.max(0.3, kmh / 3.6 * 0.2));
  sim.resetCar(target === 'guardrail' ? { position: [t.face[0] + 0.95, 0, t.face[1]], headingDeg: -t.angleDeg, speed: kmh / 3.6 } : { position: [t.face[0], 0, t.face[1] - gap - 2.06], headingDeg: 0, speed: kmh / 3.6 });
  const impacts = [], scrapes = [];
  for (let i = 0; i < seconds / sim.dt; i++) { sim.step({ ...idle, steer, throttle }); impacts.push(...v.sensor.take()); if (v.sensor.scrape) scrapes.push(v.sensor.scrape); }
  return { sim, impacts, scrapes };
}

test('impacts: where, which way, how fast and into what — a tap, a wall, a barrier', () => {
  const tap = crash(5).impacts, wall = crash(60).impacts, barrier = crash(60, 'barrier').impacts;
  assert.equal(tap.length, 1);
  assert.ok(tap[0].strength > 1.2 && tap[0].strength < 1.6, `a tap: ${tap[0].strength.toFixed(2)} m/s`);
  assert.equal(wall.length, 1, 'one impact, not one a step');
  const w = wall[0];
  assert.ok(Math.abs(w.closing - 60 / 3.6) < 0.6 && Math.abs(w.strength - w.closing) < 0.1, `${w.closing.toFixed(1)} m/s`);
  assert.ok(w.normal[2] > 0.98 && w.point[2] > 1.9, 'on the front, facing forward');
  assert.deepEqual([w.material, w.other, w.under], ['concrete', 'world', false]);
  assert.equal(barrier[0].material, 'metal');
  assert.ok(barrier[0].yRange[1] <= 0.81 && w.yRange[1] > 1.2, 'the barrier only reaches 0.8 m up; the wall the whole front');
});

test('sliding along the guardrail is a continuous scrape, not a string of impacts', () => {
  const { impacts, scrapes, sim } = crash(70, 'guardrail', { seconds: 3, steer: -0.06, throttle: 0.5 });
  assert.ok(scrapes.length * sim.dt > 2.5, `scraping ${(scrapes.length * sim.dt).toFixed(2)} s of 3`);
  assert.ok(scrapes.every(s => s.material === 'metal' && s.amount > 0 && s.amount <= 1));
  assert.ok(impacts.filter(i => i.strength > 3).length === 0, 'no big hits');
});

test('driving isn\'t crashing: a lap, flat out, bumps and a jump give no impacts', () => {
  let seen = 0;
  H.run(stock, ['lap', 'topSpeed'], { onRun: r => { const next = r.next.bind(r); r.next = n => { const going = next(n); seen += r.sim?.vehicle.sensor.take().length ?? 0; return going; }; } });
  assert.equal(seen, 0, 'the Step 6 lap and top speed run');
  // the test track: six small bumps, a big one and a jump ramp at 60 km/h
  const track = load('scenes/test_track.json'), sim = createSimulation(H.RAPIER, { settings: H.settings, spec: stock, sockets: H.socketsOf(stock), track }), v = sim.vehicle;
  sim.resetCar({ position: [0, 0, 0], headingDeg: 0, speed: 60 / 3.6 });
  const got = [];
  let air = 0;
  for (let i = 0; i < 7 / sim.dt; i++) { sim.step({ ...idle, throttle: 0.5 }); got.push(...v.sensor.take()); if (v.wheels.every(w => !w.grounded)) air += sim.dt; }
  assert.ok(v.body.translation().z > 100 && air > 0.2, `over the bumps and off the jump (${air.toFixed(2)} s in the air)`);
  assert.deepEqual(got.map(e => `${e.strength.toFixed(1)} m/s ${e.under ? 'under' : ''}`), []);
});

test('a light tap: a small dent in the bumper, a small sound, no condition lost', () => {
  const g = H.garage(), [impact] = crash(5).impacts, r = impactDamage(impact, layoutOf(g), rules);
  assert.equal(r.class, 'tap');
  assert.equal(r.hit.target, 'socket_bumper_front');
  assert.ok(r.depth < 0.012 && r.radius < 0.15, `${(r.depth * 1000).toFixed(0)} mm deep, ${(r.radius * 100).toFixed(0)} cm across`);
  assert.deepEqual([...new Set(r.dents.map(d => d.target))].sort(), ['shell', 'socket_bumper_front']);
  assert.deepEqual(r.losses, []);
  assert.deepEqual(r.broken, []);
});

test('60 km/h into a wall: the front caved in — bumper, bonnet, wings, lights — the engine hurt a little', () => {
  const g = H.garage(), [impact] = crash(60).impacts, r = impactDamage(impact, layoutOf(g), rules);
  assert.equal(r.class, 'crash');
  assert.equal(r.hit.target, 'socket_bumper_front');
  assert.ok(r.depth > 0.2 && r.radius > 0.5, `${(r.depth * 100).toFixed(0)} cm deep`);
  for (const t of ['socket_bumper_front', 'socket_bonnet', 'socket_fender_FL', 'socket_fender_FR', 'shell']) assert.ok(r.dents.some(d => d.target === t), `${t} dented`);
  assert.ok(r.dents.filter(d => d.target === 'socket_bumper_front').length >= 3, 'dented all across');
  assert.deepEqual(r.broken.sort(), ['light_head_left', 'light_head_right']);
  const loss = t => r.losses.find(l => l.target === t)?.loss ?? 0;
  assert.ok(loss('socket_bumper_front') > 40, `bumper −${loss('socket_bumper_front')}`);
  assert.ok(loss('socket_bonnet') > 5 && loss('shell') > 5);
  assert.ok(loss('engine') > 3 && loss('engine') < 20, `the engine a little: −${loss('engine')}`);
  assert.equal(loss('socket_door_left'), 0, 'the doors are nowhere near');
  // (toughness: a tougher bumper takes less)
  const tough = { ...layoutOf(g) };
  tough.parts = tough.parts.map(p => p.target === 'socket_bumper_front' ? { ...p, toughness: p.toughness * 2 } : p);
  assert.ok(Math.abs(impactDamage(impact, tough, rules).losses.find(l => l.target === 'socket_bumper_front').loss * 2 - loss('socket_bumper_front')) < 0.05);
});

test('what\'s hit is what sticks out toward it: a side swipe gets the mirror or door, a reverse into the wall the back', () => {
  const g = H.garage(), L = layoutOf(g);
  const side = impactDamage({ point: [0.85, 0.9, 0.6], normal: [1, 0, 0], yRange: [0.32, 1.3], extent: { min: [0.85, 0.32, 0.4], max: [0.85, 1.3, 0.8] }, strength: 6, material: 'metal', other: 'world' }, L, rules);
  assert.equal(side.hit.target, 'socket_mirror_left');
  const low = impactDamage({ point: [0.85, 0.5, 0.6], normal: [1, 0, 0], yRange: [0.32, 0.75], extent: { min: [0.85, 0.32, 0.4], max: [0.85, 0.75, 0.8] }, strength: 6, material: 'metal', other: 'world' }, L, rules);
  assert.equal(low.hit.target, 'socket_door_left', 'a barrier too low for the mirror');
  const back = impactDamage({ point: [0, 0.8, -2], normal: [0, 0, -1], yRange: [0.32, 1.3], strength: 8, material: 'concrete', other: 'world' }, L, rules);
  assert.equal(back.hit.target, 'socket_bumper_rear');
  assert.ok(back.dents.every(d => d.d[2] > 0.99), 'pushed forward');
  const wheel = impactDamage({ point: [0.85, 0.3, 1.2], normal: [1, 0, 0], yRange: [0.32, 0.4], strength: 9, material: 'concrete', other: 'world' }, L, rules);
  assert.ok(wheel.losses.some(l => l.target === 'socket_wheel_FL') && wheel.losses.some(l => l.target === 'socket_tyre_FL'), 'a kerb-high hit at the wheel: rim and tyre');
});

test('the damage setting: visual only dents without costing condition; off does nothing', () => {
  const g = H.garage(), [impact] = crash(60).impacts, L = layoutOf(g);
  const full = impactDamage(impact, L, rules), visual = impactDamage(impact, L, rules, { mode: 'visual' }), off = impactDamage(impact, L, rules, { mode: 'off' });
  assert.deepEqual(visual.dents, full.dents);
  assert.deepEqual(visual.broken, full.broken);
  assert.deepEqual(visual.losses, []);
  assert.deepEqual([off.dents, off.losses, off.broken], [[], [], []]);
  assert.equal(off.class, 'crash', '(still a crash, for its sound)');
});

test('dent lists stay short: a hit near an old dent deepens it, and there\'s a most', () => {
  let list = [];
  const d = (x, s) => ({ p: [x, 0, 0], d: [0, 0, -1], s });
  list = addDent(list, d(0, 4), rules);
  list = addDent(list, d(0.02, 4), rules);
  assert.equal(list.length, 1);
  assert.ok(Math.abs(list[0].s - 4 * Math.SQRT2) < 0.01, 'two taps in one place: deeper');
  for (let i = 0; i < 100; i++) list = addDent(list, d(i * 0.5, 3), rules);
  assert.equal(list.length, rules.dent.maxPerPart);
});

test('saved on the player\'s car: dents and condition until repaired; full damage costs performance, visual only doesn\'t', async () => {
  const run = async mode => {
    const service = new LocalPlayerService({ db: H.db, storage: new MemoryStorage() });
    await service.init();
    const garage = () => new Garage(H.db, garageStateOf(service.profile, H.db)), g = garage(), before = g.stats().spec;
    const [impact] = crash(60).impacts, r = impactDamage(impact, layoutOf(g), rules, { mode });
    const p = service.profile, carId = p.currentCar, sockets = g.build.sockets;
    const state = { shell: p.cars[carId].damage ?? null, parts: Object.fromEntries(Object.values(sockets).filter(Boolean).map(id => [id, { condition: p.parts[id].condition, dents: p.parts[id].dents ?? [] }])) };
    const next = applyDamage(state, r, rules, sockets), touched = [...new Set([...r.dents.map(d => sockets[d.target]), ...r.losses.map(l => l.instanceId)].filter(Boolean))];
    const res = await service.damageCar(carId, { parts: Object.fromEntries(touched.map(id => [id, next.parts[id]])), shell: next.shell });
    assert.ok(res.ok, res.error);
    return { service, before, after: garage().stats().spec, garage, carId, sockets };
  };
  const full = await run('full'), visual = await run('visual');
  // full: the engine's weaker, the car draggier and lifts more at the front
  assert.ok(full.after.aero.dragCoefficient > full.before.aero.dragCoefficient + 0.01, `drag ${full.before.aero.dragCoefficient.toFixed(3)} → ${full.after.aero.dragCoefficient.toFixed(3)}`);
  assert.ok(full.after.aero.front.liftCoefficient > full.before.aero.front.liftCoefficient + 0.01);
  assert.ok(full.after.engine.condition < 100 && full.after.engine.torqueCurve[7][1] < full.before.engine.torqueCurve[7][1]);
  const top = spec => H.run(spec, ['topSpeed']).topSpeed.value;
  assert.ok(top(full.after) < top(full.before) - 1, 'slower flat out');
  // visual only: the dents and broken lights are there, the car's exactly as fast
  assert.deepEqual(visual.after, visual.before);
  const vp = visual.service.profile, bumper = vp.parts[visual.sockets.socket_bumper_front];
  assert.ok(bumper.dents.length >= 3 && bumper.condition === 100);
  assert.deepEqual(vp.cars[visual.carId].damage.broken.sort(), ['light_head_left', 'light_head_right']);
  // repairs: a dented part at 100% still costs the minimum; the bodywork its own; then all gone
  await visual.service.addMoney(50000);
  assert.equal(repairCost(H.db, bumper), H.db.economy.repair.minimum);
  const shellCost = shellRepairCost(H.db, vp.cars[visual.carId]);
  assert.ok(shellCost >= H.db.economy.repair.minimum + 2 * H.db.economy.repair.breakable);
  assert.ok((await visual.service.repairPart(bumper.instanceId)).ok);
  assert.equal(visual.service.profile.parts[bumper.instanceId].dents, undefined);
  const money = visual.service.profile.money, rb = await visual.service.repairBody(visual.carId);
  assert.ok(rb.ok && money - visual.service.profile.money === shellCost);
  assert.equal(visual.service.profile.cars[visual.carId].damage, undefined);
  // the development reset: everything as new, free
  const fm = full.service.profile.money;
  assert.ok((await full.service.restoreCar(full.carId)).ok);
  assert.equal(full.service.profile.money, fm);
  assert.deepEqual(full.garage().stats().spec, full.before);
  assert.ok(Object.values(full.service.profile.parts).every(x => !x.dents && x.condition === 100));
  // (driving can't mend: a damage report never raises a condition)
  const id = full.sockets.socket_bumper_front;
  await full.service.damageCar(full.carId, { parts: { [id]: { condition: 40 } } });
  await full.service.damageCar(full.carId, { parts: { [id]: { condition: 90 } } });
  assert.equal(full.service.profile.parts[id].condition, 40);
});

test('a crash jolts the camera, harder for a harder hit, and it dies away within a second', async () => {
  const THREE = await import('three'), { createCameraRig } = await import('../../testtrack/camera.js');
  const snap = { velocity: [0, 0, 5], yawRate: 0, wheels: ['FL', 'FR', 'RL', 'RR'].map(() => ({ compressionSpeed: 0, grounded: true, surface: 'tarmac' })) };
  const car = new THREE.Object3D(), C = stock.camera;
  const run = (amount, seconds) => {
    const rig = createCameraRig(), cam = new THREE.PerspectiveCamera(), calm = new THREE.PerspectiveCamera(), still = createCameraRig();
    for (let i = 0; i < 60; i++) { rig.update(cam, car, snap, 1 / 60, 'chase', C); still.update(calm, car, snap, 1 / 60, 'chase', C); }
    rig.shake(amount);
    let most = 0;
    for (let i = 0; i < seconds * 60; i++) { rig.update(cam, car, snap, 1 / 60, 'chase', C); still.update(calm, car, snap, 1 / 60, 'chase', C); most = Math.max(most, cam.position.distanceTo(calm.position)); }
    return { most, end: cam.position.distanceTo(calm.position) };
  };
  const hard = run(1, 0.3), light = run(0.1, 0.3), later = run(1, 1.2);
  assert.ok(hard.most > 0.03, `a hard hit: ${(hard.most * 100).toFixed(1)} cm`);
  assert.ok(light.most < hard.most / 5, 'a tap: hardly');
  assert.ok(later.end < 0.002, 'gone within a second');
});
