// Unit tests for the parts reaching the physics (Phase 2 Step 4): the stock car exactly as before,
// and what parts, tuning and condition do, measured with the Step 6 tests themselves.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, load } from '../harness.mjs';
import { createSimulation } from '../../physics/sim.js';
import { rotate } from '../../physics/math.js';

const H = await harness();
const fresh = () => H.garage();
const specOf = g => { const s = g.stats(); assert.deepEqual(s.errors, []); return s.spec; };

test('the stock car gives exactly its Step 6 results from before (every test, full precision)', () => {
  const base = load('tests/fixtures/step6_stock_results.json').results;
  const now = H.run(specOf(fresh()), base.map(r => r.id));
  for (const b of base) {
    assert.equal(now[b.id].value, b.value, `${b.id}: ${now[b.id].value} (was ${b.value})`);
    assert.equal(now[b.id].detail, b.detail, b.id);
  }
});

test('taking the seats out (behind the centre of mass) moves it forward and lightens the car', () => {
  // (this coupe's seats are its rearmost: at z −0.22, behind the centre of mass at z 0.05)
  const g = fresh(), before = specOf(g);
  assert.ok(g.remove('socket_seat_passenger').ok && g.remove('socket_seat_driver').ok);
  const after = g.stats().spec;                   // (worked out for the garage, though it can't be driven now)
  assert.ok(after.centreOfMass[2] > before.centreOfMass[2] + 0.005, `z ${before.centreOfMass[2]} → ${after.centreOfMass[2]}`);
  assert.equal(after.mass, before.mass - 28);
  assert.ok(after.inertiaTensor[1] < before.inertiaTensor[1], 'less yaw inertia');
  assert.equal(g.drivable().ok, false);
  assert.match(g.drivable().reasons.join(' '), /socket_seat_driver/);
});

test('bigger rims raise the top speed and slow the acceleration', () => {
  const stock = H.run(specOf(fresh()), ['topSpeed', 'zeroTo100']);
  const g = fresh();
  assert.ok(g.install('wheel_17_alloy').ok && g.install('tyre_205_45r17').ok);
  const spec = specOf(g);
  assert.equal(spec.wheels.radius, 0.308);                                // 215.9 + 92.25 → 308 mm
  assert.ok(spec.wheels.inertia > 1.2, `wheel inertia ${spec.wheels.inertia}`);
  const big = H.run(spec, ['topSpeed', 'zeroTo100']);
  assert.ok(big.topSpeed.value > stock.topSpeed.value + 0.5, `top speed ${big.topSpeed.value} vs ${stock.topSpeed.value}`);
  assert.ok(big.zeroTo100.value > stock.zeroTo100.value + 0.1, `0–100 ${big.zeroTo100.value} vs ${stock.zeroTo100.value}`);
});

test('wider tyres (the same rubber) grip more on the skidpad; worn ones less', () => {
  const stock = H.run(specOf(fresh()), ['skidpad']).skidpad.value;
  const wide = fresh();
  assert.ok(wide.install('tyre_205_50r15').ok);
  const w = specOf(wide);
  assert.ok(Math.abs(w.tyre.lateral.D / specOf(fresh()).tyre.lateral.D - Math.pow(205 / 180, 0.3)) < 1e-12);
  assert.ok(H.run(w, ['skidpad']).skidpad.value > stock + 0.01);
  const worn = fresh();
  assert.ok(worn.setCondition('tyres', 30).ok);
  assert.ok(H.run(specOf(worn), ['skidpad']).skidpad.value < stock - 0.05);
});

test('lowering the ride height lowers the centre of mass (worked out, and settled in the physics)', () => {
  const g = fresh();
  assert.ok(g.install('sport_suspension').ok);
  const high = g.stats(), highSettled = settledComHeight(high.spec);
  assert.ok(g.tune('sport_suspension', 'rideHeight', -30).ok);
  const low = g.stats(), lowSettled = settledComHeight(low.spec);
  assert.ok(Math.abs(high.totals.centreOfMassHeight - low.totals.centreOfMassHeight - 0.03) < 0.005, `${high.totals.centreOfMassHeight} → ${low.totals.centreOfMassHeight}`);
  assert.ok(highSettled - lowSettled > 0.025, `settled ${highSettled} → ${lowSettled}`);
  assert.ok(Math.abs(lowSettled - low.totals.centreOfMassHeight) < 0.01, `worked out ${low.totals.centreOfMassHeight}, settled ${lowSettled}`);
});

test('tuning outside a setting\'s range is clamped (with a warning); stock parts aren\'t tunable', () => {
  const g = fresh();
  assert.equal(g.tune('socket_suspension', 'rideHeight', -10).ok, false);    // the stock suspension has no settings
  assert.ok(g.install('sport_suspension').ok);
  const r = g.tune('sport_suspension', 'rideHeight', -200);
  assert.ok(r.ok);
  assert.match(r.warnings[0].message, /ride height -200 mm is outside -40–15: it's -40 mm/);
  // (coilovers are an upgrade of the car's own suspension: about 15% shorter, then the setting)
  assert.ok(Math.abs(specOf(g).suspension.restLength - (0.3 * 0.843 - 0.04)) < 1e-9);
  assert.ok(g.validate().warnings.some(w => w.code === 'clamped'));
  assert.ok(g.tune('sport_suspension', 'springs', 1e6).ok);
  assert.ok(Math.abs(specOf(g).suspension.stiffness - 30000 * 1.4 * 1.6) < 1e-6, 'the most the spring rate setting allows: 160% of the coilovers\' own');
  assert.equal(g.stats().totals.tuning.find(t => t.setting === 'springs').clamped, true);
});

test('an empty engine socket stops the car being driven, with the reason', () => {
  const g = fresh();
  g.remove('socket_bonnet');
  const r = g.remove('socket_engine');
  assert.ok(r.ok);                                                           // (fine in the garage)
  const d = g.drivable();
  assert.equal(d.ok, false);
  assert.ok(d.reasons.some(x => /socket_engine: the car can't drive without an engine/.test(x)), d.reasons.join(' | '));
  assert.equal(g.stats().spec, null);
});

test('the same build always gives the same fingerprint and the same spec; any change, a new one', () => {
  const a = fresh(), b = fresh();
  assert.equal(a.build.fingerprint, b.build.fingerprint);
  assert.deepEqual(specOf(a), specOf(b));
  for (const g of [a, b]) { g.install('sport_suspension'); g.tune('sport_suspension', 'rideHeight', -12); g.setCondition('tyres', 70); }
  assert.equal(a.build.fingerprint, b.build.fingerprint);
  assert.deepEqual(specOf(a), specOf(b));
  const seen = new Set([fresh().build.fingerprint, a.build.fingerprint]);
  b.tune('sport_suspension', 'rideHeight', -13); seen.add(b.build.fingerprint);
  b.setCondition('socket_engine', 99); seen.add(b.build.fingerprint);
  b.install('wheel_15_chrome'); seen.add(b.build.fingerprint);
  assert.equal(seen.size, 5);
  // (paint isn't physics: the fingerprint stays)
  const f = b.build.fingerprint;
  b.state.parts[b.build.sockets.socket_bonnet].paint = { colour: '#000000' };
  assert.equal(b.fittedIn('socket_bonnet').length, 1);
  assert.equal(b.stats().fingerprint, f);
});

test('the performance rating: up with upgrades, down with worn parts', () => {
  const rating = g => g.stats().totals.rating.index, stock = rating(fresh());
  const up = fresh(); up.install('front_mount_intercooler'); up.install('turbo_kit');
  const tyres = fresh(); tyres.install('tyre_215_40r15');
  const worn = fresh(); worn.setCondition('tyres', 30);
  const brakes = fresh(); brakes.setCondition('socket_brakes', 10);
  assert.ok(rating(up) > stock + 50 && rating(tyres) > stock + 20, `${rating(up)} ${rating(tyres)} vs ${stock}`);
  assert.ok(rating(worn) < stock - 30 && rating(brakes) < stock - 20, `${rating(worn)} ${rating(brakes)} vs ${stock}`);
  assert.ok(stock >= 100 && stock <= 999);
  assert.equal(fresh().stats().totals.rating.class, 'D');
});

// The centre of mass's height above the ground once the car has settled on flat ground (m)
function settledComHeight(spec) {
  const sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets: H.socketsOf(spec), track: H.track });
  for (let i = 0; i < 120 * 5; i++) sim.step({ throttle: 0, brake: 0, steer: 0 });
  const v = sim.vehicle, p = v.body.translation(), q = v.body.rotation();
  const com = rotate(q, spec.centreOfMass).map((x, k) => x + [p.x, p.y, p.z][k]);
  const ground = v.wheels.reduce((a, w) => a + w.contact[1], 0) / 4;
  return com[1] - ground;
}
