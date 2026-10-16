// Unit tests for the garage's logic (garage/workshop.js) on top of the player service: what fits a
// socket (the player's spare parts and the shop's), previews that don't touch the car, fitting (quick
// and mechanic mode; buying and fitting in one go), undo / redo, a slider drag as one change, setups,
// repairs, the comparison and dyno runs.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from '../harness.mjs';
import { Workshop, compareStats, byPerformance } from '../../garage/workshop.js';
import { LocalPlayerService } from '../../garage/player/service.js';
import { MemoryStorage } from '../../garage/player/storage.js';
import { Garage } from '../../garage/data.js';

const H = await harness();
async function fresh({ money = 0, mode = 'quick' } = {}) {
  const service = new LocalPlayerService({ db: H.db, storage: new MemoryStorage() });
  await service.init();
  if (money) await service.addMoney(money);
  return new Workshop({ db: H.db, service, mode });
}
const at = (w, socket) => w.sockets().find(s => s.name === socket).part?.id ?? null;
const cand = (w, socket, partId) => w.partsFor(socket).candidates.find(c => c.partId === partId);

test('what fits a socket: the shop\'s parts and the player\'s spares; wrong slot and fits hidden; unmet requires locked with the reason', async () => {
  const w = await fresh();
  let { candidates } = w.partsFor('socket_turbo');
  assert.deepEqual(candidates.map(c => c.partId).sort(), ['turbo_kit', 'turbo_large', 'turbo_medium']);
  candidates = candidates.filter(c => c.partId === 'turbo_kit');
  assert.equal(candidates[0].owned, false);
  assert.equal(candidates[0].price, 2400);
  assert.equal(candidates[0].locked.text, 'Requires: intercooler');
  const tyres = w.partsFor('socket_tyre_FL').candidates;
  assert.ok(tyres.some(c => c.partId === 'tyre_215_40r15' && c.set === 4 && c.price === 1040) && !tyres.some(c => c.partId === 'tyre_205_45r17'), 'a 17" tyre doesn\'t fit the 15" rims: hidden');
  const intake = cand(w, 'socket_intake', 'cold_air_intake');
  assert.equal(intake.locked, null);
  assert.deepEqual(intake.blockers, ['socket_bonnet']);
  assert.ok(intake.gain.some(g => g.key === 'power' && g.better));
  // once bought, it's the player's spare copy instead
  await w.buy('cold_air_intake');
  const owned = cand(w, 'socket_intake', 'cold_air_intake');
  assert.ok(owned.owned && owned.instanceId && owned.count === 1);
});

test('the parts list by performance: the rating change before rounding, so parts that round to the same number still rank by what they do; small grip changes in three decimals', async () => {
  const w = await fresh();
  for (const slot of ['seat', 'spoiler', 'exhaust', 'tyres']) {
    const socket = w.sockets().find(s => s.def.slot === slot)?.name;
    if (!socket) continue;
    const list = w.partsFor(socket).candidates.filter(c => !c.locked).sort(byPerformance);
    for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].ratingExact >= list[i].ratingExact - 1e-6, `${slot}: ${list[i - 1].part.name} (${list[i - 1].ratingExact}) before ${list[i].part.name} (${list[i].ratingExact})`);
  }
  // (the bug, 2026-10-16: seats that all round to +0 were in alphabetical order, the one you have first — a 5 kg bucket
  // above a lighter seat — and of two the same before rounding, the heavier could come first)
  const row = (name, ratingChange, ratingExact, massChange, owned = false) => ({ part: { name }, ratingChange, ratingExact, massChange, owned });
  const order = list => [...list].sort(byPerformance).map(c => c.part.name);
  assert.deepEqual(order([row('Carbon race bucket', 0, 0.365, -10), row('Shellback fixed seat', 0, 0.371, -10.1), row('Seat (stock)', 0, 0, 0, true)]), ['Shellback fixed seat', 'Carbon race bucket', 'Seat (stock)']);
  assert.deepEqual(order([row('A heavy one', 1, 0.8, 2), row('Z light one', 1, 0.8, 1), row('Owned', 1, 0.8, 2, true)]), ['Z light one', 'Owned', 'A heavy one']);
  // grip: a change under 0.1 g in three decimals
  const wings = w.partsFor(w.sockets().find(s => s.def.slot === 'spoiler').name).candidates;
  const grip = wings.flatMap(c => c.gain).filter(g => g.key === 'grip');
  assert.ok(grip.length && grip.every(g => /\d\.\d{3} g$/.test(g.text) || /\d\.\d{2} g$/.test(g.text) && Math.abs(parseFloat(g.text.replace('−', '-'))) >= 0.1), grip.map(g => g.text).join(', '));
});

test('a preview is worked out on a copy: nothing changes, nothing is bought', async () => {
  const w = await fresh({ money: 5000 });
  const before = JSON.stringify(w.profile), p = w.preview('socket_intake', cand(w, 'socket_intake', 'cold_air_intake'));
  assert.ok(p.ok);
  assert.ok(p.after.totals.peakPower.hp > p.before.totals.peakPower.hp);
  assert.equal(JSON.stringify(w.profile), before);
  assert.equal(w.preview('socket_turbo', cand(w, 'socket_turbo', 'turbo_kit')).ok, false);
});

test('fitting: quick mode takes off what\'s in the way and puts it back; mechanic mode says what to take off first; the shop\'s parts are bought as they go on', async () => {
  const w = await fresh({ money: 5000 });
  const money = w.money;
  let r = await w.install('socket_intake', cand(w, 'socket_intake', 'cold_air_intake'));
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.ops.map(o => `${o.op} ${o.socket}`), ['remove socket_bonnet', 'remove socket_intake', 'install socket_intake', 'install socket_bonnet']);
  assert.equal(w.money, money - 350);
  assert.equal(at(w, 'socket_intake'), 'cold_air_intake');
  assert.ok(w.inventory().some(x => x.part.id === 'stock_airbox'), 'the airbox went to the inventory');
  const m = await fresh({ money: 5000, mode: 'mechanic' });
  r = await m.install('socket_intake', cand(m, 'socket_intake', 'cold_air_intake'));
  assert.equal(r.ok, false);
  assert.match(r.error, /Take Bonnet \(stock\) out of socket_bonnet first/);
  assert.equal(m.money, 5000 + 6000, 'nothing bought');
});

test('undo and redo every change, through the service', async () => {
  const w = await fresh({ money: 5000 });
  await w.install('socket_intake', cand(w, 'socket_intake', 'cold_air_intake'));
  await w.setPaint({ colour: '#c8202b', finish: 'metallic' });
  assert.equal(w.paint.colour, '#c8202b');
  let r = await w.undo();
  assert.ok(r.ok, r.error);
  assert.notEqual(w.paint.colour, '#c8202b');
  r = await w.undo();
  assert.equal(at(w, 'socket_intake'), 'stock_airbox');
  assert.equal(w.canUndo, false);
  await w.redo(); await w.redo();
  assert.equal(at(w, 'socket_intake'), 'cold_air_intake');
  assert.equal(w.paint.colour, '#c8202b');
  assert.equal(w.canRedo, false);
});

test('a slider drag shows straight away and is one change (one undo) when it\'s let go', async () => {
  const w = await fresh({ money: 5000 });
  await w.install('socket_suspension', cand(w, 'socket_suspension', 'sport_suspension'));
  const steps = w.history.length, height = () => w.tunable().find(t => t.setting === 'rideHeight').value;
  for (const v of [-5, -10, -15, -20]) await w.tune('socket_suspension', 'rideHeight', v, { drag: true });
  assert.equal(height(), -20, 'shown while dragging');
  assert.equal(w.profile.parts[w.build.sockets.socket_suspension].tuning, undefined, 'not asked for yet');
  await w.endDrag();
  assert.equal(w.history.length, steps + 1);
  assert.equal(w.profile.parts[w.build.sockets.socket_suspension].tuning.rideHeight, -20);
  await w.undo();
  assert.equal(height(), 0);
});

test('setups: the build against its setup; save, switch back, undo the switch', async () => {
  const w = await fresh({ money: 5000 });
  assert.equal(w.activeSetup.name, 'Stock');
  assert.equal(w.modified, false);
  await w.install('socket_intake', cand(w, 'socket_intake', 'cold_air_intake'));
  assert.deepEqual(w.changes().map(c => c.text), ['Cold air intake (setup: Airbox and filter (stock))']);
  let r = await w.saveSetupAs('Street');
  assert.ok(r.ok, r.error);
  assert.equal(w.activeSetup.name, 'Street');
  assert.equal(w.modified, false);
  r = await w.switchSetup(w.setups.find(s => s.name === 'Stock').setupId);
  assert.ok(r.ok, r.error);
  assert.equal(at(w, 'socket_intake'), 'stock_airbox');
  // undoing the switch puts back the parts and the setup they were in
  await w.undo();
  assert.equal(at(w, 'socket_intake'), 'cold_air_intake');
  assert.equal(w.activeSetup.name, 'Street');
  assert.equal(w.modified, false);
});

test('repairs: one part, or everything on the car', async () => {
  const w = await fresh({ money: 5000 });
  const ids = w.sockets().filter(s => s.instance).slice(0, 3).map(s => s.instance.instanceId);
  await w.service.setCondition(ids, 50);
  const cost = w.repairAllCost;
  assert.ok(cost > 0);
  const money = w.money, r = await w.repairAll();
  assert.ok(r.ok, r.error);
  assert.equal(w.money, money - cost);
  assert.ok(w.sockets().every(s => !s.instance || s.condition === 100));
});

test('the comparison says which way is better for each stat', async () => {
  const w = await fresh();
  const before = w.stats(), g = new Garage(H.db, JSON.parse(JSON.stringify(w.state)), w.carDef.id);
  g.install('tyre_215_40r15');
  const rows = compareStats(before, g.stats(), H.db, w.state, g.state);
  const by = k => rows.find(r => r.key === k);
  assert.equal(by('grip').better, true);
  assert.equal(by('braking').better, true);
  assert.equal(by('weight').better, false);            // 0.5 kg heavier a tyre
  assert.equal(by('rating').better, true);
  assert.equal(by('turning'), undefined, 'no turning-circle row: tyres don\'t change it');
});

test('the steering and brake parts show what they change: the turning circle, the pedal\'s pressure, the fade, the cooling', async () => {
  const w = await fresh(), before = w.stats();
  const rowsWith = id => { const g = new Garage(H.db, JSON.parse(JSON.stringify(w.state)), w.carDef.id); assert.equal(g.install(id).ok, true); return compareStats(before, g.stats(), H.db, w.state, g.state); };
  const row = (id, key) => rowsWith(id).find(r => r.key === key);
  for (const [id, key] of [['steering_angle_kit', 'turning'], ['brake_lines_braided', 'bite'], ['brake_fluid_race', 'fade'], ['brake_cooling_ducts', 'cooling']]) {
    const r = row(id, key);
    assert.equal(r?.better, true, `${id}: its ${key} row, better`);
    assert.ok(r.breakdown.length, `${id}: what changed it`);
  }
  assert.ok(row('steering_angle_kit', 'turning').next < row('steering_rack_quick', 'turning').next, 'the kit turns tighter than the rack');
});

test('a dyno run: the wheels\' torque and power, and what changed since the last run', async () => {
  const w = await fresh({ money: 5000 });
  const a = w.dynoRun();
  await w.install('socket_intake', cand(w, 'socket_intake', 'cold_air_intake'));
  const b = w.dynoRun();
  assert.equal(a.note, 'As it came in');
  assert.equal(b.note, 'Cold air intake fitted');
  assert.ok(b.peakPower.hp > a.peakPower.hp);
  assert.ok(Math.abs(a.peakTorque.nm - 158 * 0.9) < 0.5, `${a.peakTorque.nm}`);
  assert.equal(w.dynoRun().note, 'The same build');
});
