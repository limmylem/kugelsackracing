// Mechanical damage (garage/mechanical.js, physics/mechanical.js): hits reach the damage zones near
// them and bend, puncture and hole what's there by the rules in data/damage.json; the damage is kept on
// the part copies (a repair puts it right), goes into the physics through the stats calculator, and
// does what it should: a corner hit makes the car pull with the steering wheel off-centre, a holed
// radiator overheats the engine into limp mode, a puncture goes flat and flaps, a bent rim wobbles more
// with speed, a damaged gearbox grinds and misses gears, a hot clutch wears and slips, a huge hit tears
// a wheel off — and the car still limps round after most crashes. Kerbs and landings only count when
// they're really hard.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { harness, load, root } from '../harness.mjs';
import { createSimulation } from '../../physics/sim.js';
import { roadFollower } from '../../physics/ai.js';
import { roadLine } from '../../physics/track.js';
import { applyHits, damageReport, hasDamage, impactMechanical, mechanicalLayout, prune, setMechanical, strikeMechanical, zonesHit } from '../../garage/mechanical.js';
import { cleanDamage, needsRepair, repairCost } from '../../garage/player/profile.js';
import { fingerprint } from '../../garage/fingerprint.js';
import { LocalPlayerService } from '../../garage/player/service.js';
import { MemoryStorage } from '../../garage/player/storage.js';

const H = await harness(), car = H.db.cars.starter_car, M = H.db.damage.mechanical, E = M.effects;
const layoutOf = g => mechanicalLayout({ car, build: g.build, db: g.view });
const wheelAt = Object.fromEntries(['FL', 'FR', 'RL', 'RR'].map(k => [k, car.sockets.find(s => s.name === car.model.sockets[k]).position]));
// a garage with some damage set: [[kind, value, corner], …]
function damaged(list = [], g = H.garage()) {
  const L = layoutOf(g), state = {};
  for (const [kind, value, corner] of list) { const r = setMechanical(state, kind, value, corner, L); assert.ok(!r.error, r.error); Object.assign(state, r.damage); }
  for (const [id, b] of Object.entries(state)) g.state.parts[id].damage = b;
  return g;
}
const input = (throttle = 0, steer = 0, brake = 0, device = 'keyboard') => ({ device, throttle, brake, steer, handbrake: false });
function drive(spec, { track = H.track, at = [0, 0, -2500], kmh = 0 } = {}) {
  const sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets: H.socketsOf(spec), track });
  sim.resetCar({ position: at, headingDeg: 0, speed: kmh / 3.6 });
  return { sim, v: sim.vehicle, run(seconds, inp) { const out = []; for (let i = 0; i < seconds / sim.dt; i++) { sim.step(typeof inp === 'function' ? inp(sim.vehicle) : inp); out.push(...sim.vehicle.mechanical.take(), ...sim.vehicle.drivetrain.events.splice(0)); } return out; } };
}
const cruise = kmh => v => input(v.forwardSpeed() * 3.6 < kmh ? 0.6 : 0.05);
const heading = v => { const q = v.body.rotation(); return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x)) * 180 / Math.PI; };

// ---------- what a hit does (garage/mechanical.js) ----------

test('zones: a hit reaches those near it, from the way they face; a harder one reaches further in', () => {
  const zones = car.damageZones, names = hits => hits.map(h => h.zone).sort();
  // a head-on hit on the bumper: the front; a hard one reaches the front wheels too (it crumples in)
  const front = { point: [0, 0.45, 1.95], normal: [0, 0, 1], strength: 12, extent: { min: [-0.85, 0.32, 1.95], max: [0.85, 1.3, 1.95] } };
  const mild = zonesHit(front, zones, M), at = (hits, z) => hits.find(h => h.zone === z)?.strength ?? 0;
  assert.equal(at(mild, 'front'), 12);
  assert.ok(at(mild, 'FL') < 12 * 0.2 && at(mild, 'FL') === at(mild, 'FR'), 'the wheels, behind the crumple zone, hardly');
  assert.ok(!mild.some(h => ['rear', 'left', 'right', 'RL', 'RR'].includes(h.zone)));
  const hard = zonesHit({ ...front, strength: 28, depth: 0.3 }, zones, M);
  assert.ok(at(hard, 'FL') > 28 * 0.4 && at(hard, 'FL') < 28, `a hard one crumples in to them: ${at(hard, 'FL')}`);
  // the same spot hit from the side isn't the radiator's business; the wheel there takes it all
  const side = zonesHit({ point: [0.85, 0.45, 1.2], normal: [1, 0, 0], strength: 10 }, zones, M);
  assert.deepEqual(names(side), ['FL', 'left']);
  assert.equal(side.find(h => h.zone === 'FL').strength, 10);
  // from underneath (a landing on the floor pan): only the wheels
  assert.ok(zonesHit({ point: [0.6, 0.32, 1.2], normal: [0, -1, 0], strength: 8, under: true }, zones, M).every(h => h.corner));
  assert.deepEqual(names(zonesHit({ point: [0, 0.6, -1.95], normal: [0, 0, -1], strength: 9 }, zones, M)), ['rear']);
});

test('a corner hit: toe the way the blow twists the wheel, camber, ride, damper, rim, tyre, brake line — tougher parts take less, a huge hit tears the wheel off', () => {
  const g = H.garage(), L = layoutOf(g), S = M.systems;
  // from the side, ahead of the front-left wheel's centre: it's turned to the right (toe −)
  const hit = s => impactMechanical({}, { point: [0.85, 0.4, 1.4], normal: [1, 0, 0], strength: s }, L, M, { wheelAt });
  const r = hit(14), sus = r.damage[L.carriers.suspension].FL, over = 14 - S.steering.from;
  assert.ok(Math.abs(sus.toe - -over * S.steering.toePerMs) < 1e-3, `${sus.toe}`);
  assert.ok(sus.camber > 0 && sus.ride > 0 && sus.damper > 0);
  assert.ok(r.damage[L.carriers.rim.FL].bend > 0 && r.damage[L.carriers.tyre.FL].leak > 0 && r.damage[L.carriers.brakeLine].FL.line > 0);
  assert.deepEqual(Object.keys(r.damage[L.carriers.suspension]), ['FL'], 'only the corner hit');
  assert.equal(r.wheelOff.length, 0);
  // behind the wheel's centre: turned the other way
  assert.ok(impactMechanical({}, { point: [0.85, 0.4, 1.0], normal: [1, 0, 0], strength: 14 }, L, M, { wheelAt }).damage[L.carriers.suspension].FL.toe > 0);
  // it adds up, to the most there is
  const twice = applyHits(r.damage, r.hits, L, M, { toe: { FL: -1 } }).damage[L.carriers.suspension].FL;
  assert.ok(twice.camber > sus.camber && twice.toe >= -S.steering.max);
  // a tougher tyre (the stock one: 1.5) loses less than a rim (1.3) would at the same toughness
  assert.ok(Math.abs(r.damage[L.carriers.tyre.FL].leak - (14 - S.tyre.from) * S.tyre.leakPerMs / L.toughness[L.carriers.tyre.FL]) < 1e-4);
  // a light tap — or a 30 km/h one: nothing
  assert.deepEqual(hit(2.5).damage, {});
  assert.deepEqual(hit(8.3).damage, {});
  // huge: torn off
  assert.deepEqual(hit(M.wheelOff.from + 1).wheelOff, ['FL']);
  // the front: the radiator leaks, the gearbox takes a hard one; no turbo, so no boost to leak
  const f = impactMechanical({}, { point: [0, 0.45, 1.95], normal: [0, 0, 1], strength: 20 }, L, M, { wheelAt });
  assert.ok(f.damage[L.carriers.radiator].leak > 0 && f.damage[L.carriers.gearbox].gears > 0);
  assert.equal(L.carriers.intake, undefined);
  // visual only and off: the mechanicals are left alone
  for (const mode of ['visual', 'off']) assert.deepEqual(impactMechanical({}, { point: [0.85, 0.4, 1.4], normal: [1, 0, 0], strength: 15 }, L, M, { mode, wheelAt }).damage, {});
});

test('kerbs and landings strike a corner; debug settings; what\'s kept is only what isn\'t fine', () => {
  const g = H.garage(), L = layoutOf(g);
  const k = strikeMechanical({}, 'RR', 12, L, M);
  assert.ok(k.damage[L.carriers.suspension].RR.camber > 0 && k.damage[L.carriers.rim.RR].bend > 0);
  assert.equal(k.damage[L.carriers.suspension].RR.toe, undefined, 'no steering at the back');
  assert.deepEqual(strikeMechanical({}, 'RR', 12, L, M, { mode: 'visual' }).damage, {});
  const s = setMechanical({}, 'toe', 2, 'FL', L);
  assert.deepEqual(s.damage, { [L.carriers.suspension]: { FL: { toe: 2 } } });
  assert.deepEqual(setMechanical(s.damage, 'toe', null, 'FL', L).damage, { [L.carriers.suspension]: {} });
  assert.match(setMechanical({}, 'boost', 0.3, null, L).error, /No turbo/);
  assert.match(setMechanical({}, 'toe', 1, null, L).error, /corner/);
  assert.deepEqual(prune({ pressure: 1, coolant: 1, leak: 0, FL: { toe: 0 }, bend: 2 }), { bend: 2 });
  assert.ok(hasDamage({ pressure: 0.5 }) && !hasDamage({ pressure: 1, FL: {} }));
  assert.deepEqual(cleanDamage({ FL: { toe: 2, x: 'no' }, bend: Infinity, leak: 0.01, pressure: 1 }), { FL: { toe: 2 }, leak: 0.01 });
});

// ---------- the save and the stats ----------

test('the stats: the parts\' damage becomes spec.damage for the physics (none: as new); a torn-off wheel keeps the spec whole', () => {
  const fresh = H.garage().stats();
  assert.deepEqual(fresh.errors, []);
  assert.deepEqual(fresh.spec.damage.wheels.FL, { toe: 0, camber: 0, ride: 0, damper: 0, bend: 0, pressure: 1, leak: 0, brake: 0, off: false });
  const g = damaged([['toe', 1.5, 'FR'], ['bend', 3, 'RL'], ['puncture', 0.01, 'RR'], ['radiator', 0.02], ['gearbox', 0.6], ['clutch', 0.3], ['brakeLine', 0.4, 'FL']]), s = g.stats();
  const D = s.spec.damage;
  assert.equal(D.wheels.FR.toe, 1.5); assert.equal(D.wheels.RL.bend, 3); assert.equal(D.wheels.RR.leak, 0.01); assert.equal(D.wheels.FL.brake, 0.4);
  assert.equal(D.radiatorLeak, 0.02); assert.equal(D.gearbox, 0.6); assert.equal(D.clutch, 0.3);
  assert.deepEqual(D.rules, E);
  assert.equal(s.breakdown['damage.wheels.FR.toe'][0].source.id, 'stock_suspension');
  assert.equal(s.breakdown['damage.radiatorLeak'][0].source.id, 'stock_engine_rs17');
  // the rest of the car is as it was, and the fingerprint says it's different
  assert.equal(s.spec.mass, fresh.spec.mass);
  assert.notEqual(fingerprint(g.build, g.state.parts), H.garage().build.fingerprint);
  assert.equal(fingerprint(H.garage().build, H.garage().state.parts), H.garage().build.fingerprint, 'no damage: the same fingerprint as ever');
  // a wheel torn off: its rim, tyre (and spacer) aren't on the car, but the others still roll on their size
  const t = H.garage(), torn = t.stats({ ...t.build, attach: { socket_wheel_FR: 'detached' } });
  assert.deepEqual(torn.errors, []);
  assert.equal(torn.spec.damage.wheels.FR.off, true);
  assert.equal(torn.spec.wheels.radius, fresh.spec.wheels.radius);
  const lost = ['socket_wheel_FR', 'socket_tyre_FR'].reduce((a, sk) => a + H.db.parts[t.state.parts[t.build.sockets[sk]].partId].mass, 0);
  assert.ok(Math.abs(torn.spec.mass - (fresh.spec.mass - lost)) < 1e-6);
});

test('the save: damage per part copy, only ever what\'s sent; a repair puts it right (and costs more); the report', async () => {
  const svc = new LocalPlayerService({ db: H.db, storage: new MemoryStorage(), now: () => '2026-09-29T00:00:00.000Z' });
  await svc.init();
  const p = svc.profile, carId = p.currentCar, tyre = Object.values(p.parts).find(x => x.installedOn?.socket === 'socket_tyre_RR').instanceId;
  const before = repairCost(H.db, p.parts[tyre]);
  let r = await svc.damageCar(carId, { parts: { [tyre]: { damage: { pressure: 0.4, leak: 0.01, junk: 'x' } } } });
  assert.ok(r.ok, r.error);
  assert.deepEqual(svc.profile.parts[tyre].damage, { pressure: 0.4, leak: 0.01 });
  assert.ok(needsRepair(svc.profile.parts[tyre]) && repairCost(H.db, svc.profile.parts[tyre]) > before);
  r = await svc.repairPart(tyre);
  assert.ok(r.ok, r.error);
  assert.equal(svc.profile.parts[tyre].damage, undefined);
  assert.ok(!needsRepair(svc.profile.parts[tyre]));
  // the report: every system, in words, with how bad
  const g = damaged([['pressure', 0.05, 'FL'], ['toe', 1, 'FR'], ['radiator', 0.01]]), rows = damageReport(g.stats().spec.damage);
  assert.equal(rows.find(x => x.corner === 'FL' && x.system === 'tyre').state, 'FLAT');
  assert.equal(rows.find(x => x.corner === 'FR' && x.system === 'steering').level, 'worn');
  assert.match(rows.find(x => x.system === 'cooling').state, /leaking/);
  assert.equal(rows.filter(x => x.level === 'ok').length, rows.length - 3);
});

// ---------- what it does to the car (physics/mechanical.js) ----------

test('as new, the damage module changes nothing: the same steps whether it runs or not', () => {
  const spec = H.garage().stats().spec, a = drive(spec, { kmh: 60 }), b = drive(spec, { kmh: 60 });
  b.v.mechanical.enabled = false;
  a.run(4, v => input(1, 0.3)); b.run(4, v => input(1, 0.3));
  assert.deepEqual(a.v.body.translation(), b.v.body.translation());
  assert.deepEqual(a.v.body.linvel(), b.v.body.linvel());
});

test('bent toe: the car pulls, and hands off the steering wheel sits off-centre; visual only drives as new', () => {
  const run = (spec, enabled = true) => { const d = drive(spec, { kmh: 80 }); d.v.mechanical.enabled = enabled; d.run(6, cruise(80)); return { yaw: heading(d.v), x: d.v.body.translation().x, wheel: d.v.snapshot().steering.wheelAngle * 180 / Math.PI }; };
  const ok = run(H.garage().stats().spec), bent = run(damaged([['toe', 1.5, 'FR']]).stats().spec), off = run(damaged([['toe', 1.5, 'FR']]).stats().spec, false);
  assert.ok(Math.abs(ok.yaw) < 0.05 && Math.abs(ok.wheel) < 0.01, JSON.stringify(ok));
  assert.ok(bent.yaw > 2 && bent.x > 1, `pulls left: ${JSON.stringify(bent)}`);
  assert.ok(bent.wheel < -4, `the steering wheel: ${bent.wheel.toFixed(1)}°`);
  assert.deepEqual(off, ok);
});

test('a holed radiator: pushed hard the engine overheats — a warning, then limp mode (less power, a low rev limit) — and cools out of it; kept hot it loses condition', () => {
  const spec = damaged([['coolant', 0]]).stats().spec, d = drive(spec), C = E.cooling;
  // flat out down the straight, dry
  const hot = d.run(40, v => input(1));
  assert.ok(hot.some(e => e.type === 'overheat'), 'a warning');
  assert.ok(hot.some(e => e.type === 'limp'), `limp mode (${d.v.mechanical.temp.toFixed(0)}°C)`);
  const f = d.v.drivetrain.faults;
  assert.equal(f.torque, C.limpTorque); assert.equal(f.revLimit, C.limpRpm);
  const rpm = []; d.run(3, v => { rpm.push(v.drivetrain.rpm); return input(1); });
  assert.ok(Math.max(...rpm) < C.limpRpm + 150, `rev limit: ${Math.max(...rpm).toFixed(0)}`);
  // kept at it: it cooks, losing condition (written back as it goes, like an over-rev)
  const was = d.v.drivetrain.health.condition, cooked = d.run(6, v => { v.mechanical.temp = Math.max(v.mechanical.temp, C.cook + 5); return input(1); });
  assert.ok([...hot, ...cooked].some(e => e.type === 'cooking'));
  const lost = was - d.v.drivetrain.health.condition;
  assert.ok(lost > 6 * C.cookRate && lost < 6 * C.cookRate * 2, `lost ${lost.toFixed(1)}`);
  assert.ok(cooked.some(e => e.type === 'incident' && e.cause === 'overheat' && e.worst === 'cooked'));
  // eased off, it cools out of limp mode
  const cool = d.run(90, v => input(v.forwardSpeed() > 12 ? 0 : 0.15));
  assert.ok(cool.some(e => e.type === 'cooled') && !d.v.mechanical.limp, `${d.v.mechanical.temp.toFixed(0)}°C`);
  // with its coolant it never overheats, flat out
  const ok = drive(H.garage().stats().spec), all = ok.run(40, input(1));
  assert.ok(!all.some(e => e.type === 'overheat') && ok.v.mechanical.temp < C.warn, `${ok.v.mechanical.temp}`);
});

test('a puncture: the pressure goes down, the tyre sags and flaps, then it\'s flat on its rim — little grip, scraping', () => {
  const d = drive(damaged([['puncture', 0.05, 'RR']]).stats().spec, { kmh: 50 });
  const ev = d.run(10, cruise(50)), mid = d.v.snapshot();
  const w = mid.wheels.find(x => x.name === 'RR');
  assert.ok(w.pressure < 0.55 && w.pressure > 0.4, `${w.pressure}`);
  assert.equal(mid.mechanical.flap?.wheel, 'RR');
  assert.ok(Math.abs(mid.mechanical.flap.rate - Math.abs(mid.wheels[3].omega) / (2 * Math.PI)) < 0.5, 'once a turn');
  assert.ok(!ev.some(e => e.type === 'flat'));
  const ev2 = d.run(10, cruise(50)), s = d.v.snapshot(), rr = s.wheels.find(x => x.name === 'RR');
  assert.ok(ev2.some(e => e.type === 'flat' && e.wheel === 'RR'));
  assert.ok(rr.flat && rr.radius < H.garage().stats().spec.wheels.radius - 0.05, `${rr.radius}`);
  assert.equal(s.mechanical.rimScrape?.wheel, 'RR');
  assert.ok(d.v.wheels[3].gripK <= E.tyre.rimGrip);
  // the live pressure is what the game writes back
  assert.ok(d.v.mechanical.changes().pressure.RR <= E.tyre.flatBelow);
});

test('a bent rim wobbles and shakes more the faster it goes; a damaged diff judders under power', () => {
  const spec = damaged([['bend', 6, 'FL']]).stats().spec, shake = kmh => {
    const d = drive(spec, { kmh }); d.run(2, cruise(kmh));
    let lo = Infinity, hi = -Infinity;
    d.run(1, v => { const a = v.body.angvel().z; lo = Math.min(lo, a); hi = Math.max(hi, a); return cruise(kmh)(v); });
    return { shake: hi - lo, vibration: d.v.mechanical.vibration, bend: d.v.snapshot().wheels[0].bend };
  };
  const slow = shake(40), fast = shake(120);
  assert.ok(fast.shake > 2 * slow.shake && fast.vibration > 3 * slow.vibration, `${JSON.stringify(slow)} ${JSON.stringify(fast)}`);
  assert.equal(fast.bend, 6, 'the drawing wobbles the wheel by it');
  const diff = drive(damaged([['differential', 1]]).stats().spec, { kmh: 40 }), torque = [];
  diff.run(2, v => { torque.push(v.drivetrain.engineTorque); return input(1); });
  const ok = drive(H.garage().stats().spec, { kmh: 40 }), okTorque = [];
  ok.run(2, v => { okTorque.push(v.drivetrain.engineTorque); return input(1); });
  assert.ok(Math.max(...torque) > Math.max(...okTorque) * 1.08 && diff.v.mechanical.vibration > 0.2);
});

test('a damaged gearbox grinds going into gear and sometimes misses one; a worn clutch slips under full power; a damaged brake line brakes its corner less', () => {
  const d = drive(damaged([['gearbox', 0.9]]).stats().spec), ev = [];
  for (let i = 0; i < 4; i++) { d.sim.resetCar({ position: [0, 0, -2500], headingDeg: 0 }); ev.push(...d.run(14, input(1))); }
  const grinds = ev.filter(e => e.type === 'grind'), missed = ev.filter(e => e.type === 'missedGear');
  assert.ok(grinds.length >= 8 && missed.length >= 1 && missed.length < grinds.length, `${grinds.length} grinds, ${missed.length} missed`);
  const ok = drive(H.garage().stats().spec), okEv = ok.run(14, input(1));
  assert.ok(!okEv.some(e => e.type === 'grind' || e.type === 'missedGear'));
  // the clutch: worn right out, it can't hold the engine's torque at full throttle
  const worn = drive(damaged([['clutch', 1]]).stats().spec, { kmh: 60 });
  let slip = 0;
  worn.run(3, v => { const e = v.drivetrain.snapshot(); if (v.drivetrain.clutch >= 1) slip = Math.max(slip, Math.abs(e.clutchSlipRpm)); return input(1); });
  assert.ok(slip > 200, `slipping ${slip.toFixed(0)} rpm`);
  // the brake line
  const bl = drive(damaged([['brakeLine', 0.5, 'FL']]).stats().spec, { kmh: 80 });
  bl.v.aids.abs = false;
  let fl = 0, fr = 0;
  bl.run(0.5, v => { fl = Math.max(fl, v.wheels[0].brakeT ?? 0); fr = Math.max(fr, v.wheels[1].brakeT ?? 0); return input(0, 0, 0.5); });
  assert.ok(Math.abs(fl / fr - 0.5) < 0.02, `${fl.toFixed(0)} vs ${fr.toFixed(0)} N·m`);
});

test('clutch heat: hard launches one after another heat it past wearing, and it wears; one launch doesn\'t', () => {
  const d = drive(H.garage().stats().spec), K = E.clutch;
  let hot = 0;
  for (let i = 0; i < 6; i++) { d.sim.resetCar({ position: [0, 0, -2500], headingDeg: 0 }); d.run(4, input(1)); hot = Math.max(hot, d.v.mechanical.clutchTemp); d.run(4, v => input(0, 0, v.forwardSpeed() > 0.3 ? 1 : 0)); if (i === 0) assert.ok(d.v.mechanical.clutchTemp < K.wearFrom); }
  assert.ok(hot > K.wearFrom && d.v.mechanical.live.clutch > 0.01, `${hot.toFixed(0)}°C, wear ${d.v.mechanical.live.clutch}`);
  assert.ok(d.v.mechanical.changes().clutch > 0);
});

test('a wheel torn off: that corner drops onto its hub and scrapes along the road', () => {
  const t = H.garage(), spec = t.stats({ ...t.build, attach: { socket_wheel_FR: 'detached' } }).spec, d = drive(spec, { kmh: 40 });
  d.run(3, cruise(40));
  const s = d.v.snapshot(), fr = s.wheels.find(w => w.name === 'FR'), fl = s.wheels.find(w => w.name === 'FL');
  assert.ok(fr.off && fr.radius === E.hub.radius);
  // (the body leans onto that corner)
  const q = s.rotation, roll = Math.asin(2 * (q.w * q.z - q.x * q.y)) * 180 / Math.PI;
  assert.ok(roll > 1.5, `leans right ${roll.toFixed(1)}°`);
  assert.equal(s.mechanical.rimScrape?.wheel, 'FR');
  assert.ok(Math.abs(fl.fx) >= 0 && d.v.wheels[1].gripK === E.hub.grip);
});

test('kerbs and jumps: a big bump at speed or a heavy landing strikes the wheels; smooth driving never does', () => {
  const track = load('scenes/test_track.json'), spec = H.garage().stats().spec;
  const over = (z0, kmh, s) => { const d = drive(spec, { track, at: [0, 0, z0], kmh }); return d.run(s, cruise(kmh)).filter(e => e.type === 'strike'); };
  assert.equal(over(5, 30, 3).length, 0, 'speed bumps at 30 km/h');
  assert.equal(over(38, 30, 2.5).length, 0, 'the big bump at 30 km/h');
  const hard = over(38, 90, 2.5);
  assert.ok(hard.some(e => e.kind === 'kerb' && e.strength > 5), JSON.stringify(hard));
  const jump = over(55, 80, 5);
  assert.ok(jump.some(e => e.kind === 'landing'), JSON.stringify(jump));
  // a lap of the circuit: nothing
  const line = roadLine(H.track.roads.find(r => r.closed)), ai = roadFollower(line, 2, { closed: true }), d = drive(spec, { at: [line[0].x, 0, line[0].z] });
  d.sim.resetCar({ position: [line[0].x, 0, line[0].z], headingDeg: Math.atan2(line[0].tx, line[0].tz) * 180 / Math.PI });
  assert.equal(d.run(40, v => ai(v, d.sim.dt)).filter(e => e.type === 'strike').length, 0);
});

// ---------- the game's session (garage/session.js) ----------

test('the session: a crash damages the mechanicals (full damage only); a huge one tears a wheel off; what changes while driving is written back; a repair clears it', async () => {
  const realFetch = globalThis.fetch;
  globalThis.window ??= globalThis;
  globalThis.fetch = async f => ({ ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')) });
  try {
    const { garageSession } = await import('../../garage/session.js'), sn = await garageSession();
    const partOn = socket => sn.player.profile.parts[sn.garage.build.sockets[socket]];
    const side = { time: 1, point: [0.85, 0.45, 1.35], normal: [1, 0, 0], yRange: [0.35, 0.6], extent: { min: [0.85, 0.35, 1.1], max: [0.85, 0.6, 1.6] }, closing: 12, impulse: 9000, strength: 12, material: 'concrete', other: 'world', under: false };
    // visual only: dents, but the mechanicals are left alone
    let r = sn.crash(side, { mode: 'visual' });
    await r.saved;
    assert.deepEqual(r.result.mechanical.damage, {});
    assert.equal(partOn('socket_suspension').damage, undefined);
    r = sn.crash(side, { mode: 'full' });
    await r.saved;
    assert.ok(partOn('socket_suspension').damage.FL.camber > 0 && partOn('socket_wheel_FL').damage.bend > 0);
    assert.ok(sn.spec.damage.wheels.FL.camber > 0, 'into the physics');
    // a kerb strike, and the physics' live values written back
    await sn.mechanical.strike('RR', 12, { kind: 'kerb' }).saved;
    assert.ok(partOn('socket_suspension').damage.RR.camber > 0);
    await sn.mechanical.writeBack({ pressure: { RL: 0.62 }, coolant: 0.8, clutch: 0.05 });
    assert.equal(partOn('socket_tyre_RL').damage.pressure, 0.62);
    assert.equal(partOn('socket_engine').damage.coolant, 0.8);
    assert.equal(partOn('socket_clutch').damage.wear, 0.05);
    assert.equal(sn.spec.damage.coolant, 0.8);
    // a money shift: the gearbox
    await sn.mechanical.gearboxWear(0.1);
    assert.equal(partOn('socket_gearbox').damage.gears, 0.1);
    // huge: the wheel off, for this drive — and it comes back bent and flat
    r = sn.crash({ ...side, strength: 30, closing: 30 }, { mode: 'full' });
    await r.saved;
    assert.equal(sn.attach.stateOf('socket_wheel_FL'), 'detached');
    assert.equal(sn.spec.damage.wheels.FL.off, true);
    sn.attach.reattachAll('reset');
    assert.equal(sn.spec.damage.wheels.FL.off, false);
    assert.equal(partOn('socket_tyre_FL').damage.pressure, 0);
    assert.equal(partOn('socket_wheel_FL').damage.bend, M.systems.rim.max);
    // the workshop: repaired, all of it
    const ids = Object.values(sn.garage.build.sockets).filter(Boolean);
    await sn.player.repairParts(ids.filter(id => needsRepair(sn.player.profile.parts[id])));
    assert.ok(ids.every(id => !sn.player.profile.parts[id].damage));
    assert.deepEqual(sn.spec.damage.wheels.FL, { toe: 0, camber: 0, ride: 0, damper: 0, bend: 0, pressure: 1, leak: 0, brake: 0, off: false });
  } finally { globalThis.fetch = realFetch; }
});

test('the car limps round after a bad crash, and a lost wheel ends it', () => {
  const line = roadLine(H.track.roads.find(r => r.closed)), start = { position: [line[0].x, 0, line[0].z], headingDeg: Math.atan2(line[0].tx, line[0].tz) * 180 / Math.PI };
  const lap = spec => { const ai = roadFollower(line, 2, { closed: true }), d = drive(spec); d.sim.resetCar(start); let dist = 0; for (let t = 0; t < 200 && dist < 1800; t += d.sim.dt) { d.sim.step(ai(d.v, d.sim.dt)); dist += Math.abs(d.v.forwardSpeed()) * d.sim.dt; } return { dist, time: d.sim.time }; };
  const ok = lap(H.garage().stats().spec);
  // a 100 km/h head-on's worth: both front corners bent, the radiator holed, the gearbox grinding
  const bad = lap(damaged([['toe', 4, 'FR'], ['toe', -2.4, 'FL'], ['camber', 2.9, 'FR'], ['camber', 1.1, 'FL'], ['bend', 3, 'FR'], ['puncture', 0.008, 'FR'], ['radiator', 0.027], ['gearbox', 0.39], ['brakeLine', 0.4, 'FR']]).stats().spec);
  assert.ok(bad.dist >= 1800 && bad.time < ok.time * 1.3, `${ok.time.toFixed(0)} s → ${bad.time.toFixed(0)} s`);
  // a driven wheel gone: the drive goes to its free shaft, the car's stuck; a front one: it crawls round, dragging
  const t = H.garage(), noRear = lap(t.stats({ ...t.build, attach: { socket_wheel_RL: 'detached' } }).spec);
  assert.ok(noRear.dist < 100, `${noRear.dist.toFixed(0)} m`);
  const noFront = lap(t.stats({ ...t.build, attach: { socket_wheel_FR: 'detached' } }).spec);
  assert.ok(noFront.time > ok.time * 1.15, `${ok.time.toFixed(0)} s → ${noFront.time.toFixed(0)} s`);
});
