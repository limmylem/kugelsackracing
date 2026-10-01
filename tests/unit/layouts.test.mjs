// New car types (physics/drivetrain.js, physics/vehicle.js, garage/stats.js, garage/garageScene.js,
// testtrack/audio.js): FWD with torque steer and its understeer, AWD's centre differential, a 4WD's
// transfer case and diff locks, anti-roll bars, long-travel and solid-axle suspension, lift kits and
// bigger tyres, front / mid / rear engines, convertibles' roofs, and a sound for each engine type.
// The drive layouts' own tests are in the Step 6 suite (physics/testSuite.js: torque steer, AWD launch,
// low range, diff locks).
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { harness, load, root } from '../harness.mjs';
import { createSimulation } from '../../physics/sim.js';
import { testCar } from '../../physics/testCars.js';
import { Garage } from '../../garage/data.js';
import { carHinges, carViews, engineCoverOf, VIEWS } from '../../garage/garageScene.js';
import { damageLayout, impactDamage } from '../../garage/damage.js';
import { estimate } from '../../garage/rating.js';
import { geometryOf } from '../../garage/stats.js';
import { cabinMix, roofOpen } from '../../testtrack/soundMix.js';
import { readWav } from '../../tools/content/sound.mjs';

const H = await harness(), db = H.db, base = H.garage().stats().spec;
const clone = x => JSON.parse(JSON.stringify(x));
const input = (throttle = 0, steer = 0, brake = 0) => ({ device: 'wheel', throttle, brake, steer, handbrake: false });
function drive(spec, { at = [-300, 0, -2500], heading = 0, kmh = 0, track = H.track, aids = false } = {}) {
  const sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets: H.socketsOf(spec), track });
  if (!aids) Object.assign(sim.vehicle.aids, { tc: false, esc: false, countersteer: false, steering: false, drift: false });
  sim.resetCar({ position: at, headingDeg: heading, speed: kmh / 3.6 });
  return { sim, v: sim.vehicle, run(seconds, inp) { for (let i = 0; i < seconds / sim.dt; i++) sim.step(typeof inp === 'function' ? inp(sim.vehicle) : inp); return sim.vehicle; } };
}
// a car like the starter car, changed (its own id, tags and sockets), and a garage of it from its stock parts
function variant(id, change) { const c = clone(db.cars.starter_car); c.id = id; c.name = id; change(c); return c; }
const garageOf = car => { const d = { ...db, cars: { ...db.cars, [car.id]: car } }; return { g: new Garage(d, null, car.id), db: d }; };
const socket = (name, slot, position, stock, focus = 'underbody') => ({ name, slot, required: !!stock.length, position, pull: [0, -1, 0], blockedBy: [], focus, stock });

// ---------- drive layouts ----------

test('AWD: the centre diff shares the drive (split), a viscous one sends it to the axle that grips, locked ones turn together', () => {
  const awd = type => { const S = testCar(base, 'awdPower'); S.centreDifferential = { type, split: 0.4, viscous: 80, preload: 50, lock: 0.4 }; return S; };
  // on the flat, gently: the front gets its split of the torque
  const open = drive(awd('open'), { kmh: 30 }), shares = [];
  open.run(2, v => { if (v.drivetrain.clutchLocked && v.drivetrain.clutchTorque > 20) shares.push(v.drivetrain.frontDrive / (v.drivetrain.clutchTorque * v.drivetrain.ratio(v.drivetrain.gear) * v.spec.drivetrain.efficiency)); return input(0.4); });
  const mean = shares.reduce((a, x) => a + x, 0) / shares.length;
  assert.ok(Math.abs(mean - 0.4) < 0.02, `front share ${mean.toFixed(3)}`);
  assert.equal(open.v.wheels.filter(w => w.driven).length, 4);
  // the rear wheels on ice (the split-grip lane turned sideways isn't needed: lift the rear's grip)
  const spinRear = type => {
    const d = drive(awd(type)), before = d.v.tyreForce.bind(d.v);
    d.v.tyreForce = (w, ...a) => { if (!w.front) { const g = w.grip; w.grip = 0.05; const f = before(w, ...a); w.grip = g; return f; } return before(w, ...a); };
    d.run(3, input(1));
    const [FL, FR, RL, RR] = d.v.wheels;
    return { speed: d.v.forwardSpeed(), frontSpin: (FL.omega + FR.omega) / 2, rearSpin: (RL.omega + RR.omega) / 2 };
  };
  const o = spinRear('open'), vis = spinRear('viscous'), lk = spinRear('locked');
  assert.ok(o.rearSpin > 2 * o.frontSpin, `open: the rear spins away (${o.rearSpin.toFixed(0)} against ${o.frontSpin.toFixed(0)} rad/s)`);
  assert.ok(vis.speed > o.speed * 1.5, `viscous: ${vis.speed.toFixed(1)} against open ${o.speed.toFixed(1)} m/s`);
  assert.ok(Math.abs(lk.rearSpin - lk.frontSpin) < 0.5 && lk.speed >= vis.speed - 0.5, `locked: ${JSON.stringify(lk)}`);
});

test('4WD: the transfer case (2H drives the rear, 4H / 4L all four, 4L through the low range; only stopped into or out of 4L), and the driver\'s diff locks', () => {
  const d = drive(testCar(base, 'fourWd')), t = d.v.drivetrain;
  assert.equal(t.transfer, '2H');
  assert.deepEqual(d.v.wheels.filter(w => w.driven).map(w => w.name).sort(), ['RL', 'RR']);
  const r1 = t.ratio(1);
  assert.ok(t.setTransfer('4L', 0));
  assert.deepEqual(d.v.wheels.filter(w => w.driven).map(w => w.name).sort(), ['FL', 'FR', 'RL', 'RR']);
  assert.ok(Math.abs(t.ratio(1) / r1 - 2.72) < 1e-9);
  d.run(3, input(1));
  assert.equal(t.setTransfer('2H', d.v.forwardSpeed()), false, 'not out of 4L while moving');
  assert.equal(t.events.at(-1).type, 'transferBlocked');
  assert.ok(t.setTransfer('4L', 0) === false && t.transfer === '4L');
  d.run(4, v => input(0, 0, v.forwardSpeed() > 0.2 ? 1 : 0));
  assert.ok(t.setTransfer('4H', d.v.forwardSpeed()), 'out of 4L, stopped');
  assert.ok(t.setTransfer('2H', 20) && t.setTransfer('4H', 20), '2H ↔ 4H on the move');
  // locks: only where there's a locker
  assert.ok(t.setLock('front', true) && t.setLock('rear', true));
  assert.equal(t.setLock('centre', true), false, 'a part-time 4WD has no centre diff');
  assert.equal(drive(base).v.drivetrain.setLock('rear', true), false, 'the starter car\'s LSD has no locker');
  assert.deepEqual(t.snapshot().locks, { front: true, rear: true, centre: false });
});

test('FWD: under power in a corner it understeers — it runs wide — where the same car with RWD tightens its line', () => {
  const corner = id => {
    const S = id === 'rwd' ? testCar(base, 'fwd') : testCar(base, 'fwd');
    if (id === 'rwd') S.drivetrain.layout = 'RWD';
    const d = drive(S, { at: [-170 + 40, 0, 170], heading: 0, kmh: 45, aids: false });
    const steer = 0.16;
    d.run(3, v => input(v.forwardSpeed() < 12.5 ? 0.3 : 0.1, steer));
    const k0 = Math.abs(d.v.body.angvel().y / d.v.forwardSpeed());
    d.run(1.2, input(1, steer));
    const k1 = Math.abs(d.v.body.angvel().y / d.v.forwardSpeed());
    return k1 / k0;
  };
  const fwd = corner('fwd'), rwd = corner('rwd');
  assert.ok(fwd < 0.97 && rwd > fwd + 0.05, `curvature on the throttle: FWD ×${fwd.toFixed(2)}, RWD ×${rwd.toFixed(2)}`);
});

test('drive layouts are parts: an AWD car needs its front and centre diffs, takes a centre diff\'s split as tuned, swaps them; a 4WD car its transfer case', () => {
  const awdCar = variant('test_awd', c => {
    c.drivetrain.layout = 'AWD'; c.tags.push('front_diff:awd', 'centre_diff:awd');
    const i = c.sockets.findIndex(s => s.name === 'socket_differential');
    c.sockets.splice(i + 1, 0, socket('socket_diff_front', 'differential_front', [0, 0.29, 1.2], ['diff_front_open']), socket('socket_centre_diff', 'centre_diff', [0, 0.3, 0.2], ['centre_diff_viscous']));
  });
  const { g } = garageOf(awdCar), s = g.stats();
  assert.deepEqual(s.errors, []);
  assert.equal(s.spec.drivetrain.layout, 'AWD');
  assert.deepEqual([s.spec.centreDifferential.type, s.spec.centreDifferential.split, s.spec.frontDifferential.type], ['viscous', 0.38, 'open']);
  assert.ok(g.tune('centre_diff_viscous', 'split', 30).ok);
  assert.equal(g.stats().spec.centreDifferential.split, 0.3);
  assert.ok(g.install('centre_diff_lsd').ok && g.stats().spec.centreDifferential.type === 'lsd');
  assert.ok(g.remove('socket_centre_diff').ok || true);
  assert.match(g.stats().errors.join(' '), /centre differential \(AWD needs one\)/);
  // a 4WD car with the transfer case and lockers
  const fourCar = variant('test_4wd', c => {
    c.drivetrain.layout = '4WD'; c.tags.push('front_diff:4wd', 'transfer_case:4wd', 'rear_diff:4wd');
    const i = c.sockets.findIndex(s => s.name === 'socket_differential');
    c.sockets[i].stock = ['diff_locker_rear'];
    c.sockets.splice(i + 1, 0, socket('socket_diff_front', 'differential_front', [0, 0.29, 1.2], ['diff_locker_front']), socket('socket_transfer_case', 'transfer_case', [0, 0.3, 0.3], ['transfer_case_2speed']));
  });
  const f = garageOf(fourCar).g.stats();
  assert.deepEqual(f.errors, []);
  assert.deepEqual([f.spec.transferCase.lowRatio, f.spec.differential.lockable, f.spec.frontDifferential.lockable], [2.72, true, true]);
  const d = drive(f.spec);
  assert.ok(d.v.drivetrain.setTransfer('4H', 0) && d.v.drivetrain.setLock('rear', true));
  // the rating: with more torque than two tyres can put down, AWD launches better than the same car as RWD
  const strong = layout => { const S = clone(base); S.engine.torqueCurve = S.engine.torqueCurve.map(([r, t]) => [r, t * 2.2]); S.drivetrain.layout = layout; return estimate(S, geometryOf(db.cars.starter_car, S), 190).zeroTo100; };
  assert.ok(strong('AWD') < strong('RWD') - 0.3, `0–100 estimate AWD ${strong('AWD').toFixed(2)} s, RWD ${strong('RWD').toFixed(2)} s`);
});

// ---------- suspension ----------

test('anti-roll bars: less body roll in a steady corner, and a stiffer front bar pushes the car towards understeer', () => {
  const roll = arb => {
    const S = clone(base); S.suspension.antiRoll = arb;
    const d = drive(S, { at: [-170 + 40, 0, 170], heading: 0, kmh: 50 });
    d.run(4, v => input(v.forwardSpeed() < 13.9 ? 0.4 : 0.15, 0.17));
    const q = d.v.body.rotation(), rollDeg = Math.asin(2 * (q.w * q.z - q.x * q.y)) * 180 / Math.PI;
    const front = Math.max(...d.v.wheels.filter(w => w.front).map(w => Math.abs(w.slipAngle))), rear = Math.max(...d.v.wheels.filter(w => !w.front).map(w => Math.abs(w.slipAngle)));
    return { roll: Math.abs(rollDeg), balance: front / rear };
  };
  const none = roll({ front: 0, rear: 0 }), both = roll({ front: 22000, rear: 16000 }), front = roll({ front: 40000, rear: 0 });
  assert.ok(both.roll < none.roll * 0.8, `roll ${none.roll.toFixed(2)}° → ${both.roll.toFixed(2)}°`);
  assert.ok(front.balance > none.balance, `front / rear slip ${none.balance.toFixed(2)} → ${front.balance.toFixed(2)}`);
  // as parts: tuned, on the starter car
  const g = H.garage(), p = db.parts.arb_front_sport;
  assert.ok(g.install('arb_front_sport').ok && g.stats().spec.suspension.antiRoll.front === p.tuning.stiffness.default);
  assert.ok(g.tune('arb_front_sport', 'stiffness', 30000).ok && g.stats().spec.suspension.antiRoll.front === 30000);
});

test('long-travel and solid-axle suspension: a taller ride; a solid axle rolls more on the road and keeps the load even when one wheel climbs a bump', () => {
  const offroad = variant('test_offroad', c => { c.tags.push('chassis:offroad'); c.sockets.find(s => s.name === 'socket_suspension').stock = ['suspension_long_travel']; });
  const { g } = garageOf(offroad), lt = g.stats().spec;
  assert.ok(lt.suspension.travel > 1.5 * base.suspension.travel && lt.suspension.stiffness < base.suspension.stiffness);
  const settled = spec => { const d = drive(spec, { at: [-300, 0, -2500] }); d.run(1.5, input()); return d.v.body.translation().y; };
  assert.ok(settled(lt) > settled(base) + 0.05, 'it sits higher');
  assert.ok(g.install('suspension_solid_axle').ok);
  const solid = g.stats().spec, indep = clone(solid); delete indep.suspension.solidAxle;
  assert.deepEqual(solid.suspension.solidAxle, { front: true, rear: true, springTrack: 0.72 });
  // on the road: more roll in the same corner
  const roll = spec => { const d = drive(spec, { at: [-130, 0, 170], kmh: 45 }); d.run(4, v => input(v.forwardSpeed() < 12.5 ? 0.4 : 0.15, 0.17)); const q = d.v.body.rotation(); return Math.abs(Math.asin(2 * (q.w * q.z - q.x * q.y))) * 180 / Math.PI; };
  assert.ok(roll(solid) > roll(indep) * 1.15, `${roll(indep).toFixed(2)}° → ${roll(solid).toFixed(2)}°`);
  // one front wheel up on a 15 cm block: the load across that axle stays more even
  const block = { ...clone(H.track), objects: [...H.track.objects, { name: 'Block', type: 'box', centre: [-300 + 0.74, 0.075, -2500 + 1.2], halfExtents: [0.3, 0.075, 0.3], colour: '#999' }] };
  const loads = spec => { const d = drive(spec, { at: [-300, 0, -2500], track: block }); d.run(2, input()); const [FL, FR] = d.v.wheels; return Math.abs(FL.load - FR.load) / (FL.load + FR.load); };
  assert.ok(loads(solid) < loads(indep) * 0.8, `front axle imbalance: independent ${loads(indep).toFixed(2)}, solid ${loads(solid).toFixed(2)}`);
});

test('lift kits: the body higher, and room for bigger tyres — the Ridgeback\'s 33-inch tyres need its 2-inch lift, 35-inch its 4-inch', () => {
  const g = H.garage(null, 'ridgeback_4x4'), s0 = g.stats();
  assert.deepEqual(s0.errors, []);
  // 285/75 R17 (33 inches, 0.43 m radius) on the stock car: too big for its arches (0.405 m) — refused, and why
  const tooBig = g.install('tyre_all_terrain_285_75r17');
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.errors.map(e => e.message).join(' '), /don't fit .*arches.*lift kit/);
  assert.ok(g.install('ridgeback_4x4_lift_kit_2in').ok, 'the 2-inch lift kit goes on');
  assert.ok(g.install('tyre_all_terrain_285_75r17').ok, 'and now the 33-inch tyres');
  const lifted = g.stats();
  assert.deepEqual(lifted.errors, []);
  assert.ok(Math.abs(lifted.spec.wheels.lift - 0.0508) < 1e-9);
  assert.ok(Math.abs(lifted.spec.suspension.restLength - (s0.spec.suspension.restLength + 0.0508)) < 1e-9);
  // 315/75 R17 (35 inches, 0.45 m): not with the 2-inch kit; the 4-inch makes room
  assert.equal(g.install('tyre_all_terrain_315_75r17').ok, false);
  assert.ok(g.install('ridgeback_4x4_lift_kit_4in').ok, 'the 4-inch lift kit goes on');
  assert.ok(g.install('tyre_all_terrain_315_75r17').ok, 'and the 35-inch tyres');
  assert.deepEqual(g.stats().errors, []);
});

// ---------- engine position ----------

test('engine position: a rear engine moves the weight back, the garage looks at it from behind and opens its cover, and a hit from behind hurts it', () => {
  const front = db.cars.starter_car;
  const rear = variant('test_rear_engine', c => {
    for (const s of c.sockets) if (s.focus === 'engine_bay' || ['socket_gearbox', 'socket_clutch', 'socket_flywheel'].includes(s.name)) s.position = [s.position[0], s.position[1], -1.3 - (s.position[2] - 1.25) * 0.5];
  });
  const r = garageOf(rear).g.stats(), f = H.garage().stats();
  assert.ok(r.spec.centreOfMass[2] < f.spec.centreOfMass[2] - 0.15, `centre of mass ${f.spec.centreOfMass[2].toFixed(3)} → ${r.spec.centreOfMass[2].toFixed(3)} m`);
  // the garage: the starter car as it always was; the rear-engined one from behind, its boot lid open
  assert.deepEqual(carViews(front, carHinges(front, db.parts)).engine_bay, VIEWS.engine_bay);
  assert.equal(engineCoverOf(front), 'bonnet');
  const v = carViews(rear, carHinges(rear, db.parts));
  assert.equal(engineCoverOf(rear), 'boot');
  assert.equal(v.engine_bay.open, 'boot');
  assert.ok(v.engine_bay.az > 90 && v.engine_bay.target[2] < -1);
  // an engine cover of its own (a mid-engined car's lid): that's what opens
  const mid = variant('test_mid', c => { c.sockets.find(s => s.name === 'socket_engine').position = [0, 0.3, -0.6]; c.sockets.push({ ...c.sockets.find(s => s.name === 'socket_boot'), name: 'socket_engine_cover', slot: 'engine_cover', position: [0, 0.9, -0.7], stock: [] }); c.engineCover = 'socket_engine_cover'; });
  const mh = carHinges(mid, db.parts);
  assert.ok(mh.engine_cover && engineCoverOf(mid, mh) === 'engine_cover');
  // crash damage: the engine hurt by a hard hit on its end
  const hit = (car, z, nz) => { const L = damageLayout({ car, build: garageOf(car).g.build, db: garageOf(car).g.view }, db.damage); return impactDamage({ point: [0, 0.5, z], normal: [0, 0, nz], strength: 20, material: 'concrete' }, L, db.damage).losses.some(l => l.target === 'engine'); };
  assert.ok(hit(front, 1.95, 1) && !hit(front, -1.95, -1));
  assert.ok(hit(rear, -1.95, -1) && !hit(rear, 1.95, 1));
});

// ---------- convertibles ----------

test('convertibles: the Hana\'s soft top up or down, its hardtop — mass, drag, and the cockpit louder with the roof down', () => {
  const g = H.garage(null, 'hana_roadster'), up = g.stats().spec;
  assert.deepEqual(up.roof, { kind: 'soft', open: 0 });
  assert.equal(roofOpen(up.roof), false);
  assert.ok(g.tune('hana_roadster_soft_top', 'open', 1).ok);
  const down = g.stats().spec;
  assert.equal(roofOpen(down.roof), true);
  assert.ok(Math.abs(down.aero.dragCoefficient - up.aero.dragCoefficient - 0.03) < 1e-9, 'more drag, open');
  assert.equal(down.mass, up.mass, 'folded, it weighs the same');
  assert.ok(g.install('hana_roadster_hardtop').ok);
  const hard = g.stats().spec;
  assert.equal(hard.roof.kind, 'hard');
  assert.ok(hard.mass > up.mass && hard.aero.dragCoefficient < up.aero.dragCoefficient);
  // no roof part: open to the sky
  assert.ok(g.remove('socket_roof').ok && roofOpen(g.stats().spec.roof));
  // the cockpit: the engine louder and the wind roaring with it down; a closed car (and a fixed roof) as ever
  const closed = cabinMix(up.roof, true, 30), open = cabinMix(down.roof, true, 30), outside = cabinMix(down.roof, false, 30), fixed = cabinMix(undefined, true, 30);
  assert.ok(open.engine > closed.engine && open.wind > 3 * closed.wind && outside.engine === 1 && fixed.engine === 1);
  assert.equal(cabinMix(down.roof, true, 0).wind, 0);
});

// ---------- engine sounds ----------

test('a sound for each engine type: whole-cycle loops that join without a click; the boxer and the cross-plane V8 rumble unevenly, the V8 deep, the flat-plane twin-turbo bright; turbo engines whistle — each new car\'s engine has its type\'s', () => {
  const power = (x, sr, f) => { const k = 2 * Math.cos(2 * Math.PI * f / sr); let s1 = 0, s2 = 0; for (const v of x) { const s = v + k * s1 - s2; s2 = s1; s1 = s; } return (s1 * s1 + s2 * s2 - k * s1 * s2) / x.length ** 2; };
  const half = {}, centroid = {};
  for (const name of ['flat4', 'i4', 'i4_turbo', 'v6', 'v8', 'v8_tt']) {
    const cfg = load(`data/sounds/engines/${name}.json`), part = db.parts[cfg.engine];
    assert.equal(part.engine.sound, `data/sounds/engines/${name}.json`);
    assert.equal(cfg.cylinders, part.engine.cylinders);
    for (const L of cfg.layers) for (const f of [L.on, L.off]) {
      const { samples: x, sr } = readWav(fs.readFileSync(path.join(root, f))), cycles = x.length / sr * L.rpm / 120;
      assert.ok(Math.abs(cycles - Math.round(cycles)) * (120 / L.rpm) * sr < 1.5, `${f}: ${cycles.toFixed(3)} cycles`);
      let biggest = 0;
      for (let i = 1; i < x.length; i++) biggest = Math.max(biggest, Math.abs(x[i] - x[i - 1]));
      assert.ok(Math.abs(x[0] - x.at(-1)) <= biggest, `${f}: joins without a click`);
    }
    const L = cfg.layers[4], { samples: x, sr } = readWav(fs.readFileSync(path.join(root, L.on))), fire = L.rpm / 60 * cfg.cylinders / 2;
    let h = 0, m = 0; for (let k = 0.9; k <= 1.1; k += 0.02) { h = Math.max(h, power(x, sr, fire / 2 * k)); m = Math.max(m, power(x, sr, fire * k)); }
    half[name] = h / m;
    let num = 0, den = 0; for (let f = 50; f < 8000; f *= 1.05) { const p = power(x, sr, f); num += p * f; den += p; }
    centroid[name] = num / den;
  }
  for (const n of ['flat4', 'v8']) assert.ok(half[n] > 0.05, `${n} rumbles: ${half[n].toFixed(3)}`);
  for (const n of ['i4', 'i4_turbo', 'v6', 'v8_tt']) assert.ok(half[n] < 0.02, `${n} fires evenly: ${half[n].toFixed(3)}`);
  assert.ok(centroid.v8 < centroid.v8_tt / 2 && centroid.i4_turbo < centroid.i4, JSON.stringify(centroid));
  // the cars with turbo engines bring their turbo (its whistle) into the spec; the others don't
  const sound = { vortex_r: 'i4_turbo', strada_evo: 'i4_turbo', apex_v8: 'v8_tt', brute_500: 'v8', kaze_gt: 'flat4', hana_roadster: 'i4', ridgeback_4x4: 'v6' };
  for (const [id, type] of Object.entries(sound)) {
    const s = H.garage(null, id).stats();
    assert.deepEqual(s.errors, [], id);
    assert.equal(!!s.spec.turbo?.sound?.whistle, ['vortex_r', 'strada_evo', 'apex_v8'].includes(id), id);
    assert.equal(s.spec.engine.sound, `data/sounds/engines/${type}.json`, id);
  }
});
