// Gear changes on the stock car, from telemetry: after every upshift (full and part throttle, every
// gear) the clutch has the new gear within 0.3 s of it going in, the engine's then at exactly the new
// gear's speed and rises with road speed from there — no slipping clutch holding the revs up (the old
// "CVT" feel). The auto-clutch only slips on purpose pulling away.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from '../harness.mjs';
import { createSimulation } from '../../physics/sim.js';
import { roadLine } from '../../physics/track.js';

const H = await harness(), stock = H.garage().stats().spec;

// Down the test centre's long straight, throttle held; `each(sim, drivetrain)` may act every step.
// Every step's drivetrain state.
function drive(spec, throttle, seconds, each) {
  const sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets: H.socketsOf(spec), track: H.track });
  const T = H.track.tests.straight, line = roadLine(H.track.roads[T.road]), s0 = line[Math.round(T.startAt / 2)];
  sim.resetCar({ position: [s0.x, 0, s0.z], headingDeg: Math.atan2(s0.tx, s0.tz) * 180 / Math.PI, speed: 0 });
  const idle = { device: 'wheel', throttle: 0, brake: 0, steer: 0, handbrake: false }, rows = [];
  for (let i = 0; i < 0.8 / sim.dt; i++) sim.step(idle);
  for (let i = 0; i < seconds / sim.dt; i++) {
    sim.step({ ...idle, throttle });
    const d = sim.vehicle.drivetrain;
    each?.(sim, d);
    // (ground: the rpm the car's speed over the ground gives in this gear, wheelspin or not)
    const ground = d.gear ? Math.abs(sim.vehicle.forwardSpeed() / spec.wheels.radius * d.ratio(d.gear)) * 30 / Math.PI : 0;
    rows.push({ t: sim.time, gear: d.gear, shifting: d.shifting, engaging: d.engaging != null, launching: d.launching, rpm: d.rpm, locked: d.gear ? d.lockedRpm() : 0, ground, clutchLocked: d.clutchLocked, kmh: sim.vehicle.forwardSpeed() * 3.6 });
  }
  return rows;
}

// Each upshift: when the gear went in, how long until the engine matched it (clutch locked, rpm = the
// gear's), the rpm then and half a second on, and whether in that half second the engine ever turned
// other than with the wheels (slips) or with the road speed (off: more than 3% from it)
function upshifts(rows) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (!(rows[i - 1].shifting && !rows[i].shifting)) continue;
    const from = rows.slice(0, i).reverse().find(r => !r.shifting)?.gear ?? 1, to = rows[i].gear;
    if (to <= from) continue;
    const j = rows.findIndex((r, k) => k >= i && r.clutchLocked && Math.abs(r.rpm - r.locked) < 30);
    const after = j < 0 ? [] : rows.slice(j).filter(r => r.t - rows[j].t <= 0.5 && !r.shifting);
    out.push({ to, at: rows[i].t, matched: j < 0 ? Infinity : rows[j].t - rows[i].t, rpm: rows[j]?.rpm, later: after.at(-1)?.rpm,
      // (from then on the engine turns exactly with the wheels)
      slips: after.filter(r => !r.clutchLocked || Math.abs(r.rpm - r.locked) > 30).length, off: after.filter(r => Math.abs(r.rpm / r.ground - 1) > 0.03).length });
  }
  return out;
}

test('full throttle: every upshift is matched within 0.3 s and the revs then rise with road speed, in every gear', () => {
  // the automatic takes it to 4th (top speed's in 4th); 5th by hand at 165 km/h
  const rows = drive(stock, 1, 45, (sim, d) => { if (d.gear === 4 && !d.shifting && sim.vehicle.forwardSpeed() * 3.6 > 165 && d.mode === 'auto') { d.mode = 'sequential'; d.requestShift(1); } });
  const ups = upshifts(rows);
  assert.deepEqual(ups.map(u => u.to), [2, 3, 4, 5]);
  for (const u of ups) {
    assert.ok(u.matched <= 0.3, `into ${u.to}: the engine took ${u.matched.toFixed(2)} s to match the new gear`);
    assert.equal(u.slips, 0, `into ${u.to}: the clutch slipped after it had the gear`);
    if (u.to < 5) assert.ok(u.later > u.rpm + 50, `into ${u.to}: the revs rise with road speed (${u.rpm.toFixed(0)} → ${u.later.toFixed(0)})`);
    else assert.ok(u.later >= u.rpm - 5, `into 5th: the revs follow road speed (${u.rpm.toFixed(0)} → ${u.later.toFixed(0)})`);
  }
  // the whole change — clutch out, gear, clutch in — about a third of a second at most
  const shiftTime = stock.gearbox.shiftTime;
  for (const u of ups) assert.ok(shiftTime + u.matched <= 0.4, `into ${u.to}: ${(shiftTime + u.matched).toFixed(2)} s`);
});

test('part throttle, shifting early (where the old auto-clutch slipped longest): the same, through all five gears', () => {
  // sequential, up a gear each time the revs reach shiftAt
  for (const [throttle, shiftAt] of [[0.5, 3000], [0.7, 4000], [0.85, 5000]]) {
    const rows = drive(stock, throttle, 60, (sim, d) => { d.mode = 'sequential'; if (!d.shifting && d.engaging == null && d.gear < 5 && d.rpm > shiftAt && d.clutchLocked) d.requestShift(1); });
    const ups = upshifts(rows), at = `throttle ${throttle}, shifting at ${shiftAt} rpm`;
    assert.deepEqual(ups.map(u => u.to), [2, 3, 4, 5], at);
    for (const u of ups) {
      assert.ok(u.matched <= 0.3, `${at}, into ${u.to}: ${u.matched.toFixed(2)} s to match`);
      assert.equal(u.slips, 0, `${at}, into ${u.to}: the clutch slipped after it had the gear`);
      assert.equal(u.off, 0, `${at}, into ${u.to}: the revs strayed from the road speed`);
      if (u.to < 5) assert.ok(u.later > u.rpm, `${at}, into ${u.to}: the revs rise with road speed (${u.rpm.toFixed(0)} → ${u.later.toFixed(0)})`);
    }
  }
});

test('the auto-clutch only slips on purpose pulling away in 1st: never once a gear is in and taken up', () => {
  const rows = drive(stock, 1, 25), first = rows.findIndex(r => r.clutchLocked);
  assert.ok(first > 0 && rows[first].gear === 1 && rows[first].kmh < 40, `locked in 1st at ${rows[first]?.kmh.toFixed(1)} km/h`);
  const slipping = rows.slice(first).filter(r => !r.shifting && !r.engaging && !r.clutchLocked);
  assert.deepEqual(slipping.map(r => `${r.t.toFixed(2)} s in ${r.gear}`), []);
  assert.ok(rows.slice(first + 1).every(r => !r.launching), "(no longer launching)");
  // and the clutch holds the stock engine with room to spare
  assert.ok(stock.clutch.maxTorque >= 1.4 * H.garage().stats().totals.peakTorque.nm, `${stock.clutch.maxTorque} N·m clutch`);
});
