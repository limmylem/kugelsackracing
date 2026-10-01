// The Phase 5 cars end to end, through the player service as the game uses it:
//  - every car: bought from the dealership at its class's price (with its stock parts, and a setup),
//    upgraded (a part for every car and one of its own, with what they need), driven, crashed into
//    the test centre's wall (dents, lost condition, bent and leaking mechanicals, all saved) and
//    repaired (back to 100%, for what the rules say);
//  - the engine swap: the Brute 500's V8 in the Kaze GT — refused without the kit, the kit refused
//    without an uprated clutch, gearbox and radiator; with them, the V8's torque, weight and sound;
//  - the Ridgeback 4x4 climbs the 30° dirt slope in 4L that stops it in 2H;
//  - the Strada Evo is the fastest car there is on the gravel rally stage.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { harness, root } from '../harness.mjs';
import { createSimulation } from '../../physics/sim.js';
import { placeForCrash } from '../../physics/crashTest.js';
import { nodeBoxes } from '../../physics/sockets.js';
import { roadFollower } from '../../physics/ai.js';
import { roadLine } from '../../physics/track.js';
import { Garage } from '../../garage/data.js';
import { LocalPlayerService } from '../../garage/player/service.js';
import { MemoryStorage } from '../../garage/player/storage.js';
import { buildOf, carPrice, garageStateOf, repairCost, shellRepairCost } from '../../garage/player/profile.js';
import { damageLayout, impactDamage, applyDamage } from '../../garage/damage.js';
import { impactMechanical, mechanicalLayout } from '../../garage/mechanical.js';
import { dealerList } from '../../garage/dealer.js';
import { fitWithNeeds, ownPart } from '../../tools/content/balance.mjs';

const H = await harness(), db = H.db;
const ok = (r, what) => { assert.ok(r.ok, `${what}: ${r.error ?? JSON.stringify(r.errors)}`); return r; };
const newPlayer = async (money) => { const s = new LocalPlayerService({ db, storage: new MemoryStorage() }); await s.init(); await s.addMoney(money); return s; };
const garageOf = (service, carInstanceId) => new Garage(db, { ...garageStateOf(service.profile, db), current: carInstanceId });
const input = (throttle = 0, steer = 0, brake = 0) => ({ device: 'wheel', throttle, brake, steer, handbrake: false });
const glbOf = spec => { const b = fs.readFileSync(path.join(root, spec.model.file)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
// a part (and what it needs first), bought and fitted in the order they go on
async function fit(service, carInstanceId, carId, partId) {
  const needs = fitWithNeeds(db, carId, partId);
  assert.ok(needs.ok, `${partId} goes on the ${db.cars[carId].name}: ${needs.error}`);
  for (const id of needs.order) {
    const b = ok(await service.buyPart(id), `buy ${id}`);
    ok(await service.installPart(carInstanceId, b.instanceIds[0], { auto: true }), `fit ${id}`);
  }
  return needs.order;
}
// each car's own part to try: one that makes it faster where there is one
const OWN = { starter_car: 'bonnet_carbon', kaze_gt: 'kaze_gt_turbo_kit', hana_roadster: 'hana_roadster_turbo_kit', ridgeback_4x4: 'ridgeback_4x4_skid_plates', vortex_r: 'vortex_r_lsd_front', brute_500: 'brute_500_supercharger', strada_evo: 'strada_evo_rear_wing', apex_v8: 'apex_v8_active_wing' };

test('the dealership: every car by type, at its class\'s price (economy carPrices × its priceFactor)', () => {
  const list = dealerList(db, 30000), all = list.flatMap(g => g.cars);
  assert.equal(all.length, Object.keys(db.cars).length);
  for (const c of all) {
    assert.equal(c.price, Math.round(db.economy.carPrices[c.class] * (c.def.priceFactor ?? 1) / 100) * 100, c.id);
    assert.equal(c.affordable, c.price <= 30000, c.id);
    assert.ok(c.hp > 0 && c.kg > 0 && c.zeroTo100 > 0 && c.top > 0, c.id);
  }
  assert.deepEqual(list.find(g => g.type === 'Off-roader').cars.map(c => c.id), ['ridgeback_4x4']);
  assert.equal(carPrice(db, db.cars.starter_car), 12000, 'the starter car costs what it always did');
});

for (const carId of Object.keys(db.cars)) {
  const def = db.cars[carId];
  test(`${def.name}: bought, upgraded, driven, crashed and repaired`, async () => {
    const service = await newPlayer(1e6), money0 = service.profile.money;
    // bought: at its class's price, every factory part on it, a "Stock" setup
    const bought = ok(await service.buyCar(carId), 'buy the car'), id = bought.carInstanceId;
    assert.equal(service.profile.money, money0 - carPrice(db, def));
    ok(await service.selectCar(id), 'drive it');
    const stock = garageOf(service, id).stats();
    assert.deepEqual(stock.errors, []);
    assert.equal(stock.totals.rating.class, def.class, 'its own class');
    // upgraded: big brakes (for every car), and its own part
    const own = OWN[carId];
    assert.ok(carId === 'starter_car' || ownPart(db, carId, db.parts[own]), `${own} is the ${def.name}'s own`);
    await fit(service, id, carId, 'brakes_sport');
    await fit(service, id, carId, own);
    const g = garageOf(service, id), up = g.stats();
    assert.deepEqual(up.errors, []);
    assert.ok(g.drivable().ok, 'still a car that can be driven');
    assert.ok(Object.values(buildOf(service.profile, db, id)).some(x => x && service.profile.parts[x].partId === own), `${own} is on it`);
    assert.ok(up.totals.rating.index >= stock.totals.rating.index - 2, `rating ${stock.totals.rating.index} → ${up.totals.rating.index}`);
    // driven: away from a standstill and up the straight
    const spec = up.spec, sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets: H.socketsOf(spec), track: H.track });
    sim.resetCar({ position: [-300, 0, -2500], headingDeg: 0 });
    for (let i = 0; i < 6 / sim.dt; i++) sim.step(input(1));
    assert.ok(sim.vehicle.forwardSpeed() * 3.6 > 50, `${(sim.vehicle.forwardSpeed() * 3.6).toFixed(0)} km/h after 6 s`);
    // crashed: into the wall at 50 km/h; what it did is worked out and saved to the car
    placeForCrash(sim, 50, 'wall');
    const impacts = [];
    for (let i = 0; i < 2 / sim.dt; i++) { sim.step(input()); impacts.push(...sim.vehicle.sensor.take()); }
    assert.ok(impacts.length, 'it hit the wall');
    const boxes = nodeBoxes(glbOf(spec), spec.model, [...(def.model.breakables ?? []).map(b => b.node), 'body_shell']);
    for (const impact of impacts) {
      const p = service.profile, build = buildOf(p, db, id), car = p.cars[id], view = { parts: db.parts, owned: p.parts };
      const layout = damageLayout({ car: def, build: { sockets: build }, db: view, boxes }, db.damage), result = impactDamage(impact, layout, db.damage);
      const state = { shell: car.damage ?? null, parts: Object.fromEntries(Object.values(build).filter(Boolean).map(x => [x, { condition: p.parts[x].condition, dents: p.parts[x].dents ?? [] }])) };
      const next = applyDamage(state, result, db.damage, build), parts = Object.fromEntries(Object.entries(next.parts).filter(([x, v]) => v.condition < p.parts[x].condition || v.dents?.length));
      const mech = impactMechanical(Object.fromEntries(Object.values(build).filter(Boolean).map(x => [x, p.parts[x].damage ?? {}])), { ...impact, depth: result.depth }, mechanicalLayout({ car: def, build: { sockets: build }, db: view }), db.damage.mechanical);
      for (const [x, block] of Object.entries(mech.damage)) parts[x] = { ...(parts[x] ?? {}), damage: block };
      ok(await service.damageCar(id, { parts, shell: next.shell }), 'save the damage');
    }
    const hurt = Object.values(service.profile.parts).filter(x => x.installedOn?.car === id && (x.condition < 100 || x.dents?.length || x.damage));
    assert.ok(hurt.length || service.profile.cars[id].damage, 'the crash did damage');
    // repaired: every part and the body back to new, for what the rules say
    const cost = hurt.reduce((a, x) => a + repairCost(db, x), 0) + shellRepairCost(db, service.profile.cars[id]), before = service.profile.money;
    if (hurt.length) ok(await service.repairParts(hurt.map(x => x.instanceId)), 'repair the parts');
    if (service.profile.cars[id].damage) ok(await service.repairBody(id), 'repair the body');
    assert.equal(service.profile.money, before - cost, `the repairs cost ${cost}`);
    assert.ok(Object.values(service.profile.parts).filter(x => x.installedOn?.car === id).every(x => x.condition === 100 && !x.dents && !x.damage));
    assert.equal(service.profile.cars[id].damage, undefined);
  });
}

test('engine swap: the Brute 500\'s V8 in the Kaze GT — the kit and its needs first, then its torque, weight and sound', async () => {
  const service = await newPlayer(1e6), id = ok(await service.buyCar('kaze_gt'), 'buy a Kaze GT').carInstanceId;
  ok(await service.selectCar(id), 'drive it');
  const stock = garageOf(service, id).stats();
  const buy = async p => ok(await service.buyPart(p), `buy ${p}`).instanceIds[0];
  // the V8 doesn't go in without the kit; the kit doesn't go on without an uprated clutch, gearbox and radiator
  const v8 = await buy('brute_500_engine'), kit = await buy('kaze_gt_swap_brute_v8');
  ok(await service.removePart(id, 'socket_engine', { auto: true }), 'take the flat-four out');
  const noKit = await service.installPart(id, v8, { socket: 'socket_engine' });
  assert.equal(noKit.ok, false);
  assert.match(noKit.error, /engine_swap:brute_v8|swap kit/i);
  const noNeeds = await service.installPart(id, kit);
  assert.equal(noNeeds.ok, false);
  assert.match(noNeeds.error, /race clutch|uprated gearbox|uprated radiator/i);
  for (const p of ['clutch_race', 'gearbox_uprated', 'radiator_aluminium']) ok(await service.installPart(id, await buy(p), { auto: true }), `fit ${p}`);
  ok(await service.installPart(id, kit), 'fit the swap kit');
  ok(await service.installPart(id, v8, { socket: 'socket_engine' }), 'fit the V8');
  const g = garageOf(service, id), s = g.stats();
  assert.deepEqual(s.errors, []);
  assert.ok(g.drivable().ok);
  assert.equal(Math.max(...s.spec.engine.torqueCurve.map(p => p[1])), 540, 'the V8\'s torque');
  assert.equal(s.spec.engine.sound, 'data/sounds/engines/v8.json', 'and its sound');
  assert.ok(s.spec.mass > stock.spec.mass + 60, `${stock.spec.mass} → ${s.spec.mass} kg`);
  assert.ok(s.spec.clutch.maxTorque >= 540, 'a clutch that holds it');
  assert.ok(!g.validate().warnings.some(w => w.code === 'clutch_slips'));
  assert.ok(s.spec.centreOfMass[2] > stock.spec.centreOfMass[2], 'more weight over the front wheels');
  // and it's quicker
  const t = spec => H.run(spec, ['zeroTo100']).zeroTo100.value;
  const before = t(stock.spec), after = t(s.spec);
  assert.ok(after < before - 0.5, `0–100 km/h ${before.toFixed(2)} s → ${after.toFixed(2)} s`);
});

test('the Ridgeback 4x4 climbs the 30° dirt slope in 4L that stops it in 2H', () => {
  const r = H.run(H.garage(null, 'ridgeback_4x4').stats().spec, ['lowRange']).lowRange;
  assert.ok(r.ok, r.detail);
  assert.match(r.detail, /4L climbs to the top/);
});

test('the Strada Evo is the fastest car there is on the gravel rally stage', () => {
  const track = JSON.parse(fs.readFileSync(path.join(root, 'scenes/rally.json'), 'utf8')), line = roadLine(track.roads[0]), length = line.length * 2;
  const stage = carId => {
    const spec = H.garage(null, carId).stats().spec, sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets: H.socketsOf(spec), track }), ai = roadFollower(line, 2, { closed: true });
    sim.resetCar({ position: [line[0].x, 0, line[0].z], headingDeg: Math.atan2(line[0].tx, line[0].tz) * 180 / Math.PI });
    let dist = 0;
    while (dist < length && sim.time < 400) { sim.step(ai(sim.vehicle, sim.dt)); dist += Math.abs(sim.vehicle.forwardSpeed()) * sim.dt; }
    return sim.time;
  };
  const strada = stage('strada_evo');
  for (const rival of ['vortex_r', 'apex_v8', 'kaze_gt', 'brute_500']) {
    const t = stage(rival);
    assert.ok(strada < t * 0.98, `Strada Evo ${strada.toFixed(1)} s against the ${db.cars[rival].name}'s ${t.toFixed(1)} s`);
  }
});
