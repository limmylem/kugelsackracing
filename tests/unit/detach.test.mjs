// Parts coming loose and off (garage/detach.js, physics/looseParts.js), from telemetry: a hard front hit
// leaves the bumper hanging and scraping and the bonnet loose, which flies up at speed; a side hit
// swings a door open; big hits rip off mirrors and the spoiler, which bounce down the road and settle;
// without the spoiler the car loses its downforce; loose parts at speed don't upset the car; debris is
// kept in check without slowing the physics; the session keeps the states and events, and puts every
// part back (damaged) on a reset or in the garage.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { harness, root } from '../harness.mjs';
import { createSimulation } from '../../physics/sim.js';
import { placeForCrash } from '../../physics/crashTest.js';
import { nodeBoxes } from '../../physics/sockets.js';
import { damageLayout, impactDamage } from '../../garage/damage.js';
import { attachAfterImpact, bodyDef } from '../../garage/detach.js';
import { Garage } from '../../garage/data.js';

const H = await harness(), rules = H.db.damage, car = H.db.cars.starter_car;
const glb = (() => { const b = fs.readFileSync(path.join(root, car.model.file)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); })();
const boxes = nodeBoxes(glb, car.model, [...car.model.breakables.map(b => b.node), 'body_shell']);
const input = (throttle = 0, steer = 0, brake = 0) => ({ device: 'wheel', throttle, brake, steer, handbrake: false });
const conj = q => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
const qmul = (a, b) => ({ w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z, x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x, z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w });

// The game's loop, without the drawing: the car's hits → damage → parts loose or off (the physics
// follows), and a part that pulls too hard tears off
function world(garage = H.garage(), { mode = 'full', track = H.track } = {}) {
  const spec = garage.stats().spec, sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets: H.socketsOf(spec), track }), v = sim.vehicle;
  const W = { sim, v, garage, states: {}, changes: [], results: [], pieces: new Map(), clatters: [] };
  const partAt = s => H.db.parts[garage.state.parts[garage.build.sockets[s]]?.partId];
  W.set = (socket, to) => {
    const def = bodyDef(partAt(socket), car.sockets.find(x => x.name === socket), H.db.parts, () => 0);
    if (to === 'loose') v.parts.loosen(socket, def);
    if (to === 'detached' && !W.pieces.has(socket)) W.pieces.set(socket, v.parts.detach(socket, def, sim.time, socket));
    W.states[socket] = { ...(W.states[socket] ?? { stress: 0 }), state: to };
  };
  W.step = (n, inp = input()) => {
    for (let i = 0; i < n; i++) {
      sim.step(inp);
      for (const impact of v.sensor.take()) {
        const torn = Object.fromEntries(Object.entries(W.states).filter(([, x]) => x.state === 'detached').map(([k]) => [k, 'detached']));
        const r = impactDamage(impact, damageLayout({ car, build: { ...garage.build, attach: torn }, db: garage.view, boxes }, rules), rules, { mode });
        const bySocket = Object.fromEntries(Object.keys(garage.build.sockets).filter(s => W.states[s]?.state !== 'detached').map(s => [s, partAt(s)]));
        const { states, changes } = attachAfterImpact(W.states, r.stress, bySocket, { mode });
        W.results.push(r);
        for (const c of changes) { W.changes.push(c); W.states[c.socket] = states[c.socket]; W.set(c.socket, c.to); }
      }
      for (const e of v.parts.take()) { W.changes.push({ socket: e.socket, to: 'detached', reason: 'pulled off' }); W.set(e.socket, 'detached'); }
      W.clatters.push(...sim.debris.take());
    }
    return W;
  };
  W.angle = socket => { const p = v.parts.parts.get(socket), r = qmul(conj(v.body.rotation()), p.body.rotation()), ax = p.def.axis; return 2 * Math.atan2(r.x * ax[0] + r.y * ax[1] + r.z * ax[2], r.w) * 180 / Math.PI; };
  W.stateOf = s => W.states[s]?.state ?? 'attached';
  return W;
}
// on the long straight, at kmh
function onStraight(W, kmh) {
  const T = H.track.tests.straight, x = -300, z = -3000;
  W.sim.resetCar({ position: [x, 0, z], headingDeg: 0, speed: kmh / 3.6 });
  return W;
}

test('a hard front hit: the bumper comes loose and hangs, dragging and scraping; the bonnet comes loose', () => {
  const W = world();
  placeForCrash(W.sim, 60, 'wall');
  W.step(180);
  assert.equal(W.stateOf('socket_bumper_front'), 'loose');
  assert.equal(W.stateOf('socket_bonnet'), 'loose');
  assert.equal(W.stateOf('socket_door_left'), 'attached');
  assert.equal(W.v.parts.parts.get('socket_bumper_front').def.type, 'hanging');
  // driving on like that: the bumper hangs off one end, its other end scraping along the road
  const D = onStraight(world(), 20);
  D.set('socket_bumper_front', 'loose');
  let scraping = 0, low = Infinity;
  for (let i = 0; i < 4 * 120; i++) { D.step(1, input(0.4)); if (D.v.parts.scrape) scraping++; const b = D.v.parts.parts.get('socket_bumper_front').body.translation(); low = Math.min(low, b.y - D.v.body.translation().y); }
  assert.ok(scraping > 0.8 * 4 * 120, `scraping ${(scraping / 120).toFixed(1)} s of 4`);
  assert.ok(low < 0.3, 'drooping (it sits at 0.32 m on the car)');
});

test('a loose bonnet stays down slowly, and flies up against the windscreen at speed — and blocks the view', () => {
  const W = onStraight(world(), 30);
  W.set('socket_bonnet', 'loose');
  W.step(240, input(0.1));
  assert.ok(Math.abs(W.angle('socket_bonnet')) < 10, `at ${(W.v.forwardSpeed() * 3.6).toFixed(0)} km/h: ${W.angle('socket_bonnet').toFixed(0)}°`);
  let up = null;
  for (let i = 0; i < 12 * 120 && up == null; i++) { W.step(1, input(1)); if (Math.abs(W.angle('socket_bonnet')) > 90) up = W.v.forwardSpeed() * 3.6; }
  assert.ok(up != null && up > 40 && up < 80, `flew up at ${up?.toFixed(0)} km/h`);
  assert.ok(Math.abs(W.angle('socket_bonnet')) <= 110.5, 'no further than the windscreen');
});

test('a side hit swings a door open (as the car pulls away from the wall)', () => {
  const W = world();
  placeForCrash(W.sim, 40, 'wall', { side: 'side' });
  W.step(120);
  assert.equal(W.stateOf('socket_door_left'), 'loose');
  // (pressed against the wall it can't open; driving off, turning away, it swings out)
  Object.assign(W.v.drivetrain, { mode: 'auto' }); W.v.drivetrain.selectGear(1);
  let widest = 0;
  for (let i = 0; i < 3 * 120; i++) { W.step(1, input(0.6, -0.5)); widest = Math.max(widest, Math.abs(W.angle('socket_door_left'))); }
  assert.ok(widest > 20, `swung ${widest.toFixed(0)}° open`);
  assert.ok(widest <= 70.5, 'within its hinge');
});

test('big hits rip off mirrors and the spoiler; torn off at speed, a part bounces down the road and settles', () => {
  const side = world();
  placeForCrash(side.sim, 40, 'wall', { side: 'side' });
  side.step(120);
  assert.equal(side.stateOf('socket_mirror_left'), 'detached', 'the mirror, side-on into the wall');
  const g = H.garage();
  assert.ok(g.install('basic_wing').ok);
  const back = world(g);
  placeForCrash(back.sim, 60, 'wall', { side: 'rear' });
  back.step(120);
  assert.equal(back.stateOf('socket_spoiler'), 'detached', 'the wing, reversing into the wall');
  // a mirror clipped off at 90 km/h: it keeps going, bouncing, and comes to rest asleep
  const W = onStraight(world(), 90);
  W.step(30, input(0.3));
  W.set('socket_mirror_right', 'detached');
  const id = W.pieces.get('socket_mirror_right'), start = W.sim.debris.snapshot().find(p => p.id === id).position;
  W.step(12 * 120, input(0, 0, 1));
  const end = W.sim.debris.snapshot().find(p => p.id === id);
  assert.ok(end, 'still there');
  assert.ok(end.position[2] - start[2] > 5, `went ${(end.position[2] - start[2]).toFixed(0)} m down the road`);
  assert.ok(W.clatters.filter(c => c.id === id).length >= 2, `${W.clatters.filter(c => c.id === id).length} bounces`);
  assert.ok(end.sleeping, 'settled: asleep');
});

test('without its spoiler the car loses the downforce (and the weight)', () => {
  const g = H.garage();
  assert.ok(g.install('basic_wing').ok);
  const on = g.stats().spec, off = g.stats({ ...g.build, attach: { socket_spoiler: 'detached' } }).spec;
  assert.equal(on.aeroParts.length, 1);
  assert.equal(off.aeroParts.length, 0);
  assert.equal(on.mass - off.mass, H.db.parts.basic_wing.mass);
  // at 150 km/h, the physics' rear downforce with and without it
  const rear = spec => { const sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets: H.socketsOf(spec), track: H.track }); sim.resetCar({ position: [-300, 0, -3000], headingDeg: 0, speed: 150 / 3.6 }); for (let i = 0; i < 60; i++) sim.step(input(0.5)); const t = sim.vehicle.aero.telemetry; return t.rearLift + t.partsLift; };
  assert.ok(rear(off) > rear(on) + 100, `rear lift ${rear(on).toFixed(0)} N with it, ${rear(off).toFixed(0)} N without`);
  // loose parts: the car doesn't carry their weight; they drag
  const loose = g.stats({ ...g.build, attach: { socket_bonnet: 'loose' } }).spec;
  assert.equal(on.mass - loose.mass, H.db.parts.stock_bonnet.mass);
  assert.ok(loose.aero.dragCoefficient > on.aero.dragCoefficient + 0.1);
});

test('loose parts at 190 km/h: the joints hold and the car keeps going straight at speed', () => {
  const W = onStraight(world(), 190);
  for (const s of ['socket_bumper_front', 'socket_bumper_rear', 'socket_skirt_left', 'socket_fender_FL', 'socket_door_left', 'socket_boot', 'socket_exhaust']) W.set(s, 'loose');
  W.step(6 * 120, input(1));
  const p = W.v.body.translation(), q = W.v.body.rotation(), heading = Math.abs(2 * Math.atan2(q.y, q.w)) * 180 / Math.PI;
  assert.ok(W.v.forwardSpeed() * 3.6 > 160, `${(W.v.forwardSpeed() * 3.6).toFixed(0)} km/h after 6 s`);
  assert.ok(heading < 8, `still pointing down the road (${heading.toFixed(1)}° off: a pull, not a spin)`);
  for (const q of W.v.parts.parts.values()) { const t = q.body.translation(); assert.ok(Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z) < 3, `${q.socket} still with the car`); }
});

test('debris: at most 30 pieces, the oldest go first; far or old ones go; settled ones sleep; the physics stays cheap', () => {
  const W = onStraight(world(), 0), D = H.settings.debris, sockets = car.sockets.filter(s => H.db.parts[W.garage.state.parts[W.garage.build.sockets[s.name]]?.partId]?.detach).map(s => s.name);
  W.step(60, input(0, 0, 1));
  const base = [];
  for (let i = 0; i < 120; i++) { const t0 = performance.now(); W.step(1, input(0, 0, 1)); base.push(performance.now() - t0); }
  const ids = [];
  for (let k = 0; k < 40; k++) { const s = sockets[k % sockets.length], def = bodyDef(H.db.parts[W.garage.state.parts[W.garage.build.sockets[s]].partId], car.sockets.find(x => x.name === s), H.db.parts); ids.push(W.v.parts.detach(s, def, W.sim.time, `${s}#${k}`)); }
  assert.equal(W.sim.debris.count, D.max);
  const kept = new Set(W.sim.debris.snapshot().map(p => p.id));
  assert.ok(ids.slice(-D.max).every(id => kept.has(id)) && !ids.slice(0, 10).some(id => kept.has(id)), 'the newest kept');
  const cost = [];
  W.step(5 * 120, input(0, 0, 1));
  for (let i = 0; i < 240; i++) { const t0 = performance.now(); W.step(1, input(0, 0, 1)); cost.push(performance.now() - t0); }
  const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
  assert.ok(W.sim.debris.snapshot().filter(p => p.sleeping).length >= D.max * 0.6, 'most asleep once settled');
  assert.ok(med(cost) < med(base) + 0.15, `a step ${med(base).toFixed(3)} ms → ${med(cost).toFixed(3)} ms with ${D.max} pieces`);
  // far away: gone (the car driven off 200 m); old: gone
  W.v.body.setTranslation({ x: -300, y: 0.5, z: -3000 + D.maxDistance + 20 }, true);
  W.step(2);
  assert.equal(W.sim.debris.count, 0);
  const old = world();
  old.set('socket_mirror_left', 'detached');
  old.step(Math.ceil((D.maxAge + 1) * 120));
  assert.equal(old.sim.debris.count, 0);
});

test('the damage setting: visual only still shakes parts loose and off; off never does', () => {
  const visual = world(H.garage(), { mode: 'visual' });
  placeForCrash(visual.sim, 60, 'wall');
  visual.step(120);
  assert.equal(visual.stateOf('socket_bumper_front'), 'loose');
  const off = world(H.garage(), { mode: 'off' });
  placeForCrash(off.sim, 60, 'wall');
  off.step(120);
  assert.deepEqual(off.states, {});
});

test('the session: states and events; full damage costs performance, visual only doesn\'t; everything back on, damaged, on a reset or in the garage', async () => {
  // (the page's session in Node: the data read from disk, the save in memory)
  globalThis.window ??= globalThis;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async f => ({ ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')) });
  try {
    const { garageSession } = await import('../../garage/session.js'), sn = await garageSession();
    const before = JSON.parse(JSON.stringify(sn.spec));
    assert.ok(sn.attach.set('socket_bonnet', 'loose', { mode: 'full', reason: 'test' }));
    assert.equal(sn.attach.stateOf('socket_bonnet'), 'loose');
    assert.ok(sn.spec.aero.dragCoefficient > before.aero.dragCoefficient + 0.1 && sn.spec.mass < before.mass, 'full: the live spec follows');
    assert.ok(sn.attach.set('socket_mirror_left', 'detached', { mode: 'visual' }));
    assert.equal(sn.spec.mass, before.mass - H.db.parts.stock_bonnet.mass, 'visual only: the mirror\'s weight still counted');
    assert.equal(sn.attach.set('socket_mirror_left', 'loose', { mode: 'off' }), false, 'off: nothing');
    assert.equal(sn.attach.set('socket_seat_driver', 'detached'), false, 'not detachable');
    const ev = sn.attach.events;
    assert.deepEqual(ev.map(e => [e.socket, e.from, e.state]), [['socket_bonnet', 'attached', 'loose'], ['socket_mirror_left', 'attached', 'detached']]);
    assert.ok(ev.every(e => e.partId && e.instanceId && e.time && e.car));
    // a crash through the session: the damage saved, a part torn off, still the player's
    const impact = { point: [0.85, 0.9, 0.6], normal: [1, 0, 0], yRange: [0.32, 1.3], strength: 11, closing: 11, material: 'concrete', other: 'world' };
    const { result, saved } = sn.crash(impact, { mode: 'full', boxes });
    await saved;
    assert.ok(result.attach.some(c => c.socket === 'socket_door_left' && c.to === 'loose'));
    const door = sn.player.profile.parts[sn.garage.build.sockets.socket_door_left];
    assert.ok(door.condition < 100 && door.dents?.length && door.installedOn?.socket === 'socket_door_left', 'damaged, dented, still on the car in the save');
    // back on (a reset, the garage): no states, the spec as it was but for the damage, events recorded
    assert.equal(sn.attach.reattachAll('garage'), 3);
    assert.deepEqual(sn.attach.states, {});
    assert.equal(sn.spec.mass, before.mass);
    assert.ok(sn.attach.events.slice(-3).every(e => e.state === 'attached' && e.reason === 'garage'));
    assert.ok(new Garage(H.db, sn.garage.state).validate().ok);
    await sn.restoreCar();
  } finally { globalThis.fetch = realFetch; }
});
