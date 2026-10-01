// Money shifts and over-rev damage, from telemetry: any downshift goes in (rev protection, off by
// default, refuses the ones that would over-rev); one at too high a speed jolts the car (the clutch
// slips, the driven wheels slide) and damages the engine by how far past the redline it goes — valve
// float (a little wear), bent valves (a big drop, misfiring from then on), blown (it stops, the car
// coasts, condition 0) — with the limits in the engine part, so tougher internals take more; the
// damage goes to the player's engine and the garage repairs it.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from '../harness.mjs';
import { createSimulation } from '../../physics/sim.js';
import { roadLine } from '../../physics/track.js';
import { engineTorque } from '../../physics/engine.js';
import { LocalPlayerService } from '../../garage/player/service.js';
import { MemoryStorage } from '../../garage/player/storage.js';
import { Garage } from '../../garage/data.js';
import { garageStateOf, repairCost } from '../../garage/player/profile.js';

const H = await harness(), stock = H.garage().stats().spec;
const clone = x => JSON.parse(JSON.stringify(x));

// Rolling down the long straight at kmh in a gear, off the throttle, in the sequential box
function rolling(spec, kmh, gear, { revProtection = false } = {}) {
  const sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets: H.socketsOf(spec), track: H.track });
  const T = H.track.tests.straight, line = roadLine(H.track.roads[T.road]), s0 = line[Math.round(T.startAt / 2)];
  sim.resetCar({ position: [s0.x, 0, s0.z], headingDeg: Math.atan2(s0.tx, s0.tz) * 180 / Math.PI, speed: kmh / 3.6 });
  const d = sim.vehicle.drivetrain;
  Object.assign(d, { mode: 'sequential', gear, clutch: 1, clutchLocked: true });
  d.omega = d.lockedRpm(gear) * Math.PI / 30;
  sim.vehicle.aids.revProtection = revProtection;
  return sim;
}
// Down from `from` to `to` a gear at a time, off the throttle, and 4 s on: every step's telemetry and the events
function downshift(spec, kmh, from, to, opts) {
  const sim = rolling(spec, kmh, from, opts), v = sim.vehicle, d = v.drivetrain, rows = [];
  const input = { device: 'wheel', throttle: 0, brake: 0, steer: 0, handbrake: false };
  for (let i = 0; i < 12; i++) sim.step(input);
  let want = from;
  for (let i = 0; i < 4 / sim.dt; i++) {
    if (want > to && !d.shifting && d.engaging == null) { d.requestShift(-1); want--; }
    const before = v.forwardSpeed();
    sim.step(input);
    const slip = Math.min(...d.driven.map(w => w.omega * spec.wheels.radius / v.forwardSpeed() - 1));
    rows.push({ t: sim.time, gear: d.gear, rpm: d.rpm, clutch: d.clutch, locked: d.clutchLocked, decel: (before - v.forwardSpeed()) / sim.dt / 9.81, slip, kmh: v.forwardSpeed() * 3.6, ...d.health.snapshot() });
  }
  const events = d.events.splice(0), worst = events.find(e => e.type === 'incident')?.worst ?? (d.health.incident ? (d.health.incident.bent ? 'bent' : 'float') : null);
  return { sim, rows, events, worst, health: d.health, peak: Math.max(...rows.map(r => r.over)), last: rows.at(-1) };
}

test('any downshift goes in; rev protection (off by default) refuses one that would over-rev, and says so', () => {
  assert.equal(stock.assists.revProtection.enabled, false);
  const free = downshift(stock, 130, 3, 2);
  assert.equal(free.rows.at(-1).gear, 2);
  const shift = free.events.find(e => e.type === 'overRevShift');
  assert.ok(shift && shift.gear === 2 && shift.rpm > stock.engine.redlineRpm * 1.2, 'a warning, with where it put the engine');
  const safe = downshift(stock, 130, 3, 2, { revProtection: true });
  assert.equal(safe.rows.at(-1).gear, 3, 'refused');
  assert.ok(safe.events.some(e => e.type === 'shiftBlocked' && e.gear === 2));
  assert.equal(safe.health.condition, 100);
  // (one that doesn't over-rev goes in with it on)
  assert.equal(downshift(stock, 95, 4, 3, { revProtection: true }).rows.at(-1).gear, 3);
});

test('a money shift jolts the car: an engine-braking spike, the clutch slipping, the driven wheels sliding', () => {
  const normal = downshift(stock, 95, 4, 3), money = downshift(stock, 118, 3, 2);
  const jolt = r => Math.max(...r.rows.map(x => x.decel)), slide = r => Math.min(...r.rows.map(x => x.slip));
  assert.ok(jolt(normal) < 0.2, `a normal downshift: ${jolt(normal).toFixed(2)} g`);
  assert.ok(jolt(money) > 0.35 && jolt(money) > 3 * jolt(normal), `a money shift: ${jolt(money).toFixed(2)} g`);
  assert.ok(slide(normal) > -0.03 && slide(money) < -0.04, `driven wheels: ${slide(normal).toFixed(2)} → ${slide(money).toFixed(2)}`);
  assert.ok(money.rows.some(r => r.gear === 2 && r.clutch > 0.5 && !r.locked), 'the clutch slips as it drags the engine up');
});

test('by how far past the redline: valve float wears it a little, bent valves a lot (misfiring from then on), past 25% it blows', () => {
  const E = stock.engine, O = E.overRev;
  // ~9% over: valve float
  const float = downshift(stock, 118, 3, 2);
  assert.ok(float.peak > O.valveFloat && float.peak < O.bentValves, `${(float.peak * 100).toFixed(1)}% over`);
  assert.equal(float.worst, 'float');
  assert.ok(float.rows.some(r => r.floating), 'floating while it was there');
  assert.ok(float.health.condition < 100 && float.health.condition > 94, `condition ${float.health.condition.toFixed(1)}`);
  assert.equal(float.health.misfireShare, 0);
  // ~12% over: bent valves
  const bent = downshift(stock, 80, 2, 1);
  assert.ok(bent.peak > O.bentValves && bent.peak < O.blown, `${(bent.peak * 100).toFixed(1)}% over`);
  assert.equal(bent.worst, 'bent');
  const drop = bent.events.find(e => e.type === 'bent');
  assert.ok(drop && drop.condition <= 100 - O.bentLoss, `bent: condition ${drop?.condition.toFixed(1)}`);
  assert.ok(bent.health.misfireShare > 0 && bent.health.scale < 1, 'it misfires and makes less torque from then on');
  // past 25%: blown — a bang, it stops, the car coasts
  const blown = downshift(stock, 150, 3, 2);
  assert.equal(blown.worst, 'blown');
  assert.ok(blown.events.some(e => e.type === 'blown'));
  assert.equal(blown.health.condition, 0);
  assert.equal(blown.health.blown, true);
  const at = blown.rows.findIndex(r => r.blown), after = blown.rows.slice(at);
  assert.ok(after.find(r => r.t - blown.rows[at].t > 1).rpm < 1, 'the engine stops within a second');
  assert.ok(after.every(r => r.clutch === 0), 'nothing drives');
  const coast = after.filter(r => r.t - blown.rows[at].t > 1);
  assert.ok(coast.every(r => r.decel < 0.1) && blown.last.kmh > 120, `it coasts (${blown.last.kmh.toFixed(0)} km/h)`);
});

test('bent valves last: the engine misfires (rough, on a fixed pattern) and pulls less hard', () => {
  const pull = spec => {
    const sim = rolling(spec, 40, 2), v = sim.vehicle, d = v.drivetrain, rpms = [];
    for (let i = 0; i < 2 / sim.dt; i++) { sim.step({ device: 'wheel', throttle: 1, brake: 0, steer: 0, handbrake: false }); rpms.push(d.rpm); }
    // (rough: the engine speed's step-to-step jitter around its trend)
    const rough = rpms.slice(2).reduce((a, r, i) => a + Math.abs(r - 2 * rpms[i + 1] + rpms[i]), 0) / (rpms.length - 2);
    return { kmh: v.forwardSpeed() * 3.6, rough };
  };
  const g = H.garage();
  g.state.parts[g.build.sockets.socket_engine].condition = 45;
  const healthy = pull(stock), damaged = pull(g.stats().spec), again = pull(g.stats().spec);
  assert.ok(damaged.kmh < healthy.kmh - 2, `${healthy.kmh.toFixed(1)} → ${damaged.kmh.toFixed(1)} km/h after 2 s flat out in 2nd`);
  assert.ok(damaged.rough > 2 * healthy.rough, `rough: ${healthy.rough.toFixed(2)} → ${damaged.rough.toFixed(2)}`);
  assert.deepEqual(again, damaged, 'the same drive, the same misfires');
});

test('the limits are the engine part\'s: forged internals survive what blows the stock engine, a tougher engine what bends its valves', () => {
  const g = H.garage();
  assert.ok(g.install('pistons_forged').ok);
  const forged = g.stats().spec;
  assert.ok(Math.abs(forged.engine.overRev.blown - 0.32) < 1e-9);
  const r = downshift(forged, 150, 3, 2);
  assert.notEqual(r.worst, 'blown');
  assert.equal(r.health.blown, false);
  const tough = clone(stock);
  Object.assign(tough.engine.overRev, { bentValves: 0.2, blown: 0.4 });
  assert.equal(downshift(tough, 80, 2, 1).worst, 'float');
});

test('damage while driving and after the garage writes it back drive the same', () => {
  const bent = downshift(stock, 80, 2, 1), c = bent.health.condition;
  const g = H.garage(), id = g.build.sockets.socket_engine;
  g.state.parts[id].condition = c;
  const rebuilt = g.stats().spec.engine;
  assert.equal(rebuilt.condition, c);
  for (const rpm of [2000, 4500, 6500]) {
    const live = engineTorque(stock.engine, rpm, 1, bent.health.scale), after = engineTorque(rebuilt, rpm, 1, 1);
    assert.ok(Math.abs(live - after) < 1e-9, `${rpm} rpm: ${live} vs ${after}`);
  }
  // (and a fresh drive on the rebuilt spec picks up where it left off: the same misfiring)
  const again = rolling(g.stats().spec, 60, 2).vehicle.drivetrain.health;
  assert.equal(again.condition, c);
  assert.equal(again.misfireShare, bent.health.misfireShare);
  assert.equal(again.scale, 1);
});

test('the damage goes to the player\'s engine; a blown one can\'t be driven until it\'s repaired, at the usual repair cost', async () => {
  const service = new LocalPlayerService({ db: H.db, storage: new MemoryStorage() });
  await service.init();
  const p = () => service.profile, garage = () => new Garage(H.db, garageStateOf(p(), H.db)), engineId = () => garage().build.sockets.socket_engine;
  let r = await service.wearPart(engineId(), 57.3, { cause: 'bent valves' });
  assert.ok(r.ok, r.error);
  assert.equal(garage().stats().spec.engine.condition, 57.3);
  assert.ok(garage().drivable().ok);
  r = await service.wearPart(engineId(), 80);
  assert.equal(r.ok, false, 'driving doesn\'t mend it');
  r = await service.wearPart(engineId(), 0, { cause: 'blown' });
  assert.ok(r.ok && r.blown);
  const spec = garage().stats().spec;
  assert.equal(spec.engine.blown, true);
  const d = garage().drivable();
  assert.equal(d.ok, false);
  assert.match(d.reasons.join(' '), /blown: repair it in the garage/);
  // the repair: the usual cost for a part at condition 0
  await service.addMoney(100000);
  const cost = repairCost(H.db, p().parts[engineId()]), before = p().money;
  r = await service.repairPart(engineId());
  assert.ok(r.ok, r.error);
  assert.equal(before - p().money, cost);
  assert.equal(p().parts[engineId()].condition, 100);
  assert.equal(garage().stats().spec.engine.blown, false);
  assert.ok(garage().drivable().ok);
});
