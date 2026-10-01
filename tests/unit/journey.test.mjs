// End-to-end tests of the parts system, through the player service as the game uses it:
//  - a new player's journey: a new profile buys a sport intake and sport tyres, fits them in the
//    garage, saves, the browser is closed and opened again, and the Step 6 tests on the car as saved
//    beat the stock car's;
//  - every part for sale: bought (with what it needs), fitted, drawn on the car, its stats changed as
//    its tier's rules say, taken off cleanly (back to the stock build), repaired and sold for the
//    right money;
//  - every combination of turbo, ECU, pistons, intercooler and clutch: the valid ones make power in
//    the right order, the invalid ones are refused, each with a reason in plain words.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { harness, root } from '../harness.mjs';
import { Garage } from '../../garage/data.js';
import { Workshop } from '../../garage/workshop.js';
import { LocalPlayerService } from '../../garage/player/service.js';
import { MemoryStorage } from '../../garage/player/storage.js';
import { buildOf, garageStateOf, repairCost, sellPrice } from '../../garage/player/profile.js';
import { ModelCache, createCarVisual, resolveLook } from '../../garage/visual.js';
import { glbJson } from '../../physics/sockets.js';
import { KEY_STATS, fitWithNeeds, forCar } from '../../tools/content/balance.mjs';
import { readJson } from '../../tools/content/rules.mjs';

const H = await harness(), db = H.db, tiers = readJson('data/content/tiers.json');
const forSale = Object.values(db.parts).filter(p => !p.retired && !p.todo?.length);
const carOf = profile => new Garage(db, garageStateOf(profile, db));
const newPlayer = async (money = 0, storage = new MemoryStorage()) => {
  const s = new LocalPlayerService({ db, storage });
  await s.init();
  if (money) await s.addMoney(money);
  return s;
};
const ok = (r, what) => { assert.ok(r.ok, `${what}: ${r.error ?? JSON.stringify(r.errors)}`); return r; };

test('a new player\'s journey: buy a sport intake and sport tyres, fit them, save, reopen — and the Step 6 tests beat stock', async () => {
  const storage = new MemoryStorage();
  let service = await newPlayer(0, storage);
  const car = service.profile.currentCar, start = service.profile.money;
  const intake = forSale.find(p => p.slot === 'intake' && p.tier === 'sport'), tyres = forSale.find(p => p.slot === 'tyres' && p.tier === 'sport' && !p.purpose);
  // the shop
  ok(await service.buyPart(intake.id), 'buy the intake');
  ok(await service.buyPart(tyres.id), 'buy the tyres');
  assert.equal(service.profile.money, start - intake.price - tyres.price * 4);
  // the garage
  const w = new Workshop({ db, service });
  for (const [socket, part] of [['socket_intake', intake], ['socket_tyre_FL', tyres]]) {
    const c = w.partsFor(socket).candidates.find(x => x.partId === part.id && x.owned);
    assert.ok(c, `${part.name} is offered for ${socket}`);
    ok(await w.install(socket, c), `fit ${part.name}`);
  }
  const fitted = buildOf(service.profile, db, car);
  assert.equal(service.profile.parts[fitted.socket_intake].partId, intake.id);
  assert.ok(['socket_tyre_FL', 'socket_tyre_FR', 'socket_tyre_RL', 'socket_tyre_RR'].every(s => service.profile.parts[fitted[s]].partId === tyres.id));
  // save; the browser closed and opened again
  ok(await service.save(), 'save');
  const saved = JSON.stringify(service.profile);
  service = await newPlayer(0, storage);
  assert.equal(JSON.stringify(service.profile), saved, 'everything as it was left');
  // the Step 6 tests: the car as saved against the stock car
  const ids = ['zeroTo100', 'braking', 'skidpad', 'lap'];
  const stock = H.run(new Garage(db, null).stats().spec, ids), mine = H.run(carOf(service.profile).stats().spec, ids);
  const v = (r, id) => r[id].value;
  assert.ok(v(mine, 'skidpad') > v(stock, 'skidpad'), `skidpad ${v(mine, 'skidpad')} g against ${v(stock, 'skidpad')}`);
  assert.ok(v(mine, 'lap') < v(stock, 'lap'), `lap ${v(mine, 'lap')} s against ${v(stock, 'lap')}`);
  assert.ok(v(mine, 'braking') < v(stock, 'braking'), `100–0 ${v(mine, 'braking')} m against ${v(stock, 'braking')}`);
  assert.ok(v(mine, 'zeroTo100') <= v(stock, 'zeroTo100') + 0.02, `0–100 ${v(mine, 'zeroTo100')} s against ${v(stock, 'zeroTo100')}`);
});

// a stand-in for GLTFLoader (Node has no textures): each model's nodes, a small box per mesh
function standIn(url) {
  const b = fs.readFileSync(path.join(root, url)), json = glbJson(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const materials = (json.materials || []).map(m => new THREE.MeshStandardMaterial({ name: m.name }));
  const make = i => {
    const n = json.nodes[i], o = n.mesh !== undefined ? new THREE.Group() : new THREE.Object3D();
    o.name = n.name;
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.mesh !== undefined) for (const p of json.meshes[n.mesh].primitives) o.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), materials[p.material]));
    for (const c of n.children || []) o.add(make(c));
    return o;
  };
  const scene = new THREE.Group();
  for (const i of json.scenes[json.scene ?? 0].nodes) scene.add(make(i));
  return { scene };
}

test('every part for sale: bought, fitted, drawn, changes its stats as its tier says, comes off cleanly, repaired and sold for the right money', async () => {
  const models = new ModelCache({ load: async url => standIn(url) }), stockFingerprint = new Garage(db, null).build.fingerprint;
  const car = db.cars.starter_car, problems = [];
  for (const part of forSale.filter(p => forCar(db, 'starter_car', p))) {            // (other kinds of car's parts: their own cars)
    const what = `${part.id}`;
    try {
      const service = await newPlayer(200000), carId = service.profile.currentCar, stockSetup = service.profile.cars[carId].activeSetup;
      const needs = fitWithNeeds(db, 'starter_car', part.id);
      assert.ok(needs.ok, `${what} goes on the starter car: ${needs.error}`);
      // bought, with what it needs, and fitted in the order they go on
      const copyOf = {};
      for (const id of needs.order) { const b = ok(await service.buyPart(id), `buy ${id}`); copyOf[id] = b.instanceIds[0]; }
      for (const id of needs.order) ok(await service.installPart(carId, copyOf[id]), `fit ${id}`);
      const build = buildOf(service.profile, db, carId), sockets = Object.keys(build).filter(s => build[s] && service.profile.parts[build[s]].partId === part.id);
      assert.ok(sockets.length, `${what} is on the car`);
      const garage = carOf(service.profile), stats = garage.stats();
      assert.ok(stats.spec, `${what}: the car can be worked out (${stats.errors.join('; ')})`);
      assert.ok(garage.drivable().ok, `${what}: the car can still be driven`);
      // drawn: its model (a brake kit's at every wheel), its tyre made to fit, its placeholder — or nothing, for a part with no model
      const vis = await createCarVisual({ car, finishes: db.finishes, models });
      await vis.applyBuild(garage.build, garage.view);
      const { model, bounds, placeholder } = resolveLook(part, db.parts), status = vis.attached.get(sockets[0])?.status ?? 'empty';
      const expected = part.tyreSize ? /^made to fit/ : model && part.look?.drawAt === 'wheels' ? /^at [1-9]\d* wheels$/ : model ? /^loaded$/ : placeholder || bounds ? /^placeholder \(no model yet\)$/ : /^no model$/;
      assert.match(status, expected, `${what} is drawn`);
      vis.dispose();
      // its stats: its slot's key stat better than the car with just what it needs (a part with a
      // purpose, or a slot with no key stat, just has to leave a car that works)
      const rule = tiers.slots[part.slot];
      if (rule?.stat && !part.purpose && part.tier !== 'stock') {
        const base = new Garage(db, null);
        for (const id of needs.order.filter(id => id !== part.id)) base.install(id);
        const s0 = base.stats().spec ? base.stats() : new Garage(db, null).stats();
        const better = [].concat(rule.stat).some(k => { const K = KEY_STATS[k], a = K.of(s0), b = K.of(stats); return K.up ? b > a : b < a; });
        assert.ok(better, `${what} improves ${[].concat(rule.stat).join(' / ')}`);
      }
      // taken off cleanly: back to the stock setup, the stock build exactly, the part in the inventory
      ok(await service.switchSetup(carId, stockSetup, { force: true }), `${what}: back to stock`);
      assert.equal(carOf(service.profile).build.fingerprint, stockFingerprint, `${what}: the stock build again`);
      const copy = service.profile.parts[copyOf[part.id]];
      assert.equal(copy.installedOn, null, `${what} is back in the inventory`);
      // repaired, then sold, for what the rules say
      ok(await service.setCondition([copy.instanceId], 50), 'wear it');
      const cost = repairCost(db, service.profile.parts[copy.instanceId]), before = service.profile.money;
      ok(await service.repairPart(copy.instanceId), `repair ${what}`);
      assert.equal(service.profile.money, before - cost, `${what}: the repair costs ${cost}`);
      assert.equal(service.profile.parts[copy.instanceId].condition, 100);
      const price = sellPrice(db, service.profile.parts[copy.instanceId]), had = service.profile.money;
      ok(await service.sellPart(copy.instanceId), `sell ${what}`);
      assert.equal(service.profile.money, had + price, `${what} sells for ${price}`);
      assert.equal(service.profile.parts[copy.instanceId], undefined);
    } catch (err) { problems.push(err.message); }
  }
  assert.deepEqual(problems, [], `${problems.length} of ${forSale.length} parts`);
});

test('turbo, ECU, pistons, intercooler and clutch: every combination — the valid ones in order of power, the invalid ones refused with a reason in plain words', () => {
  const TURBOS = [null, 'turbo_kit', 'turbo_medium'], ECUS = ['stock_ecu', 'ecu_stage1', 'ecu_stage2', 'ecu_standalone'];
  const PISTONS = [null, 'pistons_forged'], COOLERS = [null, 'front_mount_intercooler'], CLUTCHES = ['stock_clutch', 'clutch_sport'];
  const power = new Map();
  let valid = 0, invalid = 0;
  for (const turbo of TURBOS) for (const ecu of ECUS) for (const pistons of PISTONS) for (const cooler of COOLERS) for (const clutch of CLUTCHES) {
    const g = new Garage(db, null), put = (socket, id) => { g.build.sockets[socket] = id ? Garage.newInstance(g.state, id).instanceId : null; };
    put('socket_turbo', turbo); put('socket_ecu', ecu); put('socket_pistons', pistons); put('socket_intercooler', cooler); put('socket_clutch', clutch);
    const key = [turbo, ecu, pistons, cooler, clutch].join('|'), v = g.validate();
    // what the rules say it needs (worked out here, not by the validator)
    const missing = [];
    if (turbo && !cooler) missing.push(/needs an intercooler fitted too/);
    if (turbo === 'turbo_medium' && !pistons) missing.push(/needs Forged pistons and rods fitted too/);
    if (turbo === 'turbo_medium' && clutch === 'stock_clutch') missing.push(/needs Sport clutch or Race clutch \(twin-plate\) fitted too/);
    if ((ecu === 'ecu_stage2' || ecu === 'ecu_standalone') && !turbo) missing.push(/needs a turbo or a supercharger or a turbocharged engine fitted too/);
    assert.equal(v.ok, !missing.length, `${key}: ${v.errors.map(e => e.message).join('; ')}`);
    for (const m of missing) assert.ok(v.errors.some(e => m.test(e.message)), `${key}: says ${m}: ${v.errors.map(e => e.message).join('; ')}`);
    for (const e of v.errors) assert.doesNotMatch(e.message, /"[a-z_]+:[a-z0-9_]+"/, `${key}: no bare tags in "${e.message}"`);
    if (v.ok) { valid++; power.set(key, g.stats().totals.peakPower.hp); } else invalid++;
  }
  assert.ok(valid >= 20 && invalid >= 20, `${valid} valid, ${invalid} invalid`);
  // more turbo, more power; with a turbo, each ECU more than the one before
  const hp = (turbo, ecu, pistons = 'pistons_forged', cooler = 'front_mount_intercooler', clutch = 'clutch_sport') => power.get([turbo, ecu, pistons, cooler, clutch].join('|'));
  for (const ecu of ['stock_ecu', 'ecu_stage1']) assert.ok(hp(null, ecu) < hp('turbo_kit', ecu) && hp('turbo_kit', ecu) < hp('turbo_medium', ecu), ecu);
  for (const turbo of ['turbo_kit', 'turbo_medium']) assert.ok(hp(turbo, 'stock_ecu') < hp(turbo, 'ecu_stage1') && hp(turbo, 'ecu_stage1') < hp(turbo, 'ecu_stage2') && hp(turbo, 'ecu_stage2') < hp(turbo, 'ecu_standalone'), turbo);
  assert.ok(hp(null, 'stock_ecu') < hp(null, 'ecu_stage1'));
  // and in the garage: fitted in the wrong order it's refused, with what's missing
  const g = new Garage(db, null), r = g.install('turbo_medium');
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map(e => e.message).sort(), [
    'Medium turbo kit (socket_turbo) needs Forged pistons and rods fitted too.',
    'Medium turbo kit (socket_turbo) needs Sport clutch or Race clutch (twin-plate) fitted too.',
    'Medium turbo kit (socket_turbo) needs an intercooler fitted too.',
  ]);
  for (const id of ['front_mount_intercooler', 'pistons_forged', 'clutch_sport', 'turbo_medium', 'ecu_stage2']) ok(g.install(id), `fit ${id}`);
  // what the turbo needs can't come off while it's there
  const off = g.remove('pistons_forged');
  assert.equal(off.ok, false);
  assert.match(off.errors[0].message, /needs Forged pistons and rods/);
});

test('brake upgrades never lengthen an ABS stop (the tyres set it) and run cooler; better tyres stop shorter', () => {
  const stop = ids => { const g = new Garage(db, null); for (const id of ids) ok(g.install(id), `fit ${id}`); return H.run(g.stats().spec, ['braking']).braking; };
  const temp = r => +r.detail.match(/([\d.]+) °C/)[1];
  const stock = stop([]), pads = stop(['pads_race']), discs = stop(['brakes_race']), tyres = stop(['tyre_215_40r15']);
  for (const [name, r] of [['race pads', pads], ['race discs', discs]]) assert.ok(r.value <= stock.value + 0.1, `${name}: ${r.value} m against ${stock.value}`);
  assert.ok(temp(discs) < temp(stock) - 50, `race discs run cooler: ${discs.detail}`);
  assert.ok(tyres.value < stock.value - 2, `semi-slicks stop shorter: ${tyres.value} m against ${stock.value}`);
});
