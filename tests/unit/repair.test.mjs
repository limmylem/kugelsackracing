// Repairs and the save after a crash (garage/repair.js, garage/player/service.js, garage/damageLog.js):
// every problem priced from the config, repairs cheaper than new parts; a quick repair is cheaper and
// leaves the car at about 80% with most dents out, a full one as new; a problem at a time, or all of it;
// a spare fitted instead (the damaged part to the inventory, as it is); a broke player always gets a free
// repair to a drivable car (and only then); a session's reset puts back on what its rules say; the
// damage survives closing and opening the game exactly — rebuilt from its impact list — and stays small
// enough to send; hints are seen once.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crashContext, harness } from '../harness.mjs';
import { createSimulation } from '../../physics/sim.js';
import { placeForCrash } from '../../physics/crashTest.js';
import { crashOutcome } from '../../garage/carDamage.js';
import { LocalPlayerService } from '../../garage/player/service.js';
import { MemoryStorage } from '../../garage/player/storage.js';
import { Garage } from '../../garage/data.js';
import { buildOf, garageStateOf, packProfile, repairCost } from '../../garage/player/profile.js';
import { carWork, drivability, ownedBySocket, partWork, workCost } from '../../garage/repair.js';
import { LOG, appendHits, dentsOf, packCrash, packDents, sizeOf, unpackCrash, unpackDents } from '../../garage/damageLog.js';
import { addDent } from '../../garage/damage.js';
import { ZONES, ZONE_VIEW, carProblems } from '../../garage/damageReport.js';

const H = await harness(), ctx = await crashContext(), db = H.db, rules = db.damage, E = db.economy, car = db.cars.starter_car, boxes = ctx.boxesOf(car);
const idle = { device: 'wheel', throttle: 0, brake: 0, steer: 0, handbrake: false };
let clock = 0;
const now = () => new Date(Date.UTC(2026, 0, 1) + (clock += 1000)).toISOString();
async function fresh(saved = null) {
  const storage = new MemoryStorage(saved), service = new LocalPlayerService({ db, storage, now });
  await service.init();
  return { service, storage, carId: service.profile.currentCar };
}
// A crash into the test centre's wall (kmh, direction as the crash test suite's), as the game reports it:
// each impact worked out on the car as it is (garage/carDamage.js) and sent to the save — conditions, the
// hits that dented each part, mechanical damage, parts loose or off
const impactsCache = new Map();
function impactsOf(kmh, side = 'front', angleDeg = 0) {
  const key = `${kmh}|${side}|${angleDeg}`;
  if (impactsCache.has(key)) return impactsCache.get(key);
  const spec = H.garage().stats().spec, sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets: H.socketsOf(spec), track: H.track }), out = [];
  placeForCrash(sim, kmh, 'wall', { side, angleDeg });
  for (let i = 0; i < 2.5 / sim.dt; i++) { sim.step(idle); out.push(...sim.vehicle.sensor.take()); }
  impactsCache.set(key, out);
  return out;
}
async function crash(service, carId, impacts) {
  for (const impact of impacts) {
    const p = service.profile, g = new Garage(db, { ...garageStateOf(p, db), current: carId }, p.cars[carId].carId), sockets = g.build.sockets;
    const attach = Object.fromEntries(Object.entries(sockets).filter(([, id]) => id && p.parts[id].attach).map(([s, id]) => [s, { state: p.parts[id].attach, stress: 0 }]));
    const out = crashOutcome({ car: g.car, build: g.build, view: g.view, boxes, rules, attach, mech: Object.fromEntries(Object.values(sockets).filter(Boolean).map(id => [id, p.parts[id].damage ?? {}])),
      damage: { shell: p.cars[carId].damage ?? null, parts: Object.fromEntries(Object.values(sockets).filter(Boolean).map(id => [id, { condition: p.parts[id].condition, dents: p.parts[id].dents ?? [] }])) } }, impact);
    const parts = {}, hitsOf = t => out.result.dents.filter(d => d.target === t).map(({ target: _, ...d }) => d);
    for (const id of out.touched) parts[id] = { condition: out.next.parts[id].condition, hits: hitsOf(Object.keys(sockets).find(k => sockets[k] === id)) };
    for (const [id, b] of Object.entries(out.mech.damage)) parts[id] = { ...(parts[id] ?? {}), damage: b };
    for (const c of out.changes) parts[sockets[c.socket]] = { ...(parts[sockets[c.socket]] ?? {}), attach: c.to };
    const r = await service.damageCar(carId, { parts, shell: { condition: out.next.shell.condition, hits: hitsOf('shell'), broken: out.next.shell.broken } });
    assert.ok(r.ok, r.error);
    // (what the game worked out and what the save folded come out the same)
    for (const id of out.touched) assert.deepEqual(service.profile.parts[id].dents ?? [], out.next.parts[id].dents);
  }
}
const on = (service, carId, socket) => service.profile.parts[buildOf(service.profile, db, carId)[socket]];

test('every problem priced from the config: a repair is cheaper than the part new, a quick one cheaper than a full one', async () => {
  const { service, carId } = await fresh();
  await crash(service, carId, impactsOf(100));
  const w = carWork(db, service.profile, carId);
  assert.ok(w.parts.length >= 5 && w.shell.length >= 1, `${w.parts.length} parts and the body to fix`);
  for (const p of w.parts) {
    const x = service.profile.parts[p.instanceId], price = db.parts[x.partId].price;
    assert.ok(workCost(p.work, 'full') <= Math.round(price * E.repair.maxOfNew) + p.work.length, `${x.partId}: ${workCost(p.work, 'full')} to fix, ${price} new`);
    for (const piece of p.work) assert.ok(piece.quick <= piece.full && piece.full >= (piece.scope === 'attach' ? E.repair.minimum : 1));
    assert.equal(repairCost(db, x), workCost(p.work, 'full'));
  }
  assert.ok(w.quick < w.full * 0.7, `quick ${w.quick}, full ${w.full}`);
  // the pieces: a corner of the suspension, the radiator on the engine, the bumper torn off, a light broken
  const scopes = w.parts.flatMap(p => p.work.map(x => `${db.parts[p.partId].slot}:${x.scope}`));
  for (const s of ['bumper_front:attach', 'bumper_front:condition', 'suspension:corner:FL', 'engine:radiator']) assert.ok(scopes.includes(s), `${s} in ${scopes.join(', ')}`);
  assert.ok(w.shell.some(x => x.scope.startsWith('broken:light_head')));
  // (a part's repairs never cost more than maxOfNew of a new one, however bad)
  const wreck = { instanceId: 'x', partId: 'stock_suspension', condition: 0, damage: { FL: { toe: 4, camber: 5 }, FR: { toe: -4, camber: 5 }, RL: { camber: 5 }, RR: { camber: 5 } } };
  assert.ok(workCost(partWork(db, wreck)) <= db.parts.stock_suspension.price * E.repair.maxOfNew + 4);
});

test('the damage report explains every problem in plain words — what it does, where it is (the camera\'s view of it), how bad, what fixing it costs', async () => {
  const { service, carId } = await fresh();
  await crash(service, carId, impactsOf(100, 'front', 30));
  await service.givePart('stock_bumper_front', 1);
  const r = carProblems(db, service.profile, carId), ids = r.problems.map(p => p.id), w = carWork(db, service.profile, carId);
  assert.ok(r.problems.length >= 10, `${r.problems.length} problems`);
  assert.equal(new Set(ids).size, ids.length);
  const RANK = { minor: 1, major: 2, critical: 3 };
  for (const p of r.problems) {
    assert.ok(p.title && p.effect && !/undefined|NaN|null/.test(p.title + p.effect), `${p.title}: ${p.effect}`);
    assert.ok(ZONES.includes(p.zone) && p.view === ZONE_VIEW[p.zone], `${p.title} at ${p.zone}`);
    assert.ok(RANK[p.severity] && p.quick <= p.full && p.full > 0, p.title);
    assert.ok(RANK[r.zones[p.zone]] >= RANK[p.severity], 'a zone shows its worst');
  }
  for (let i = 1; i < r.problems.length; i++) assert.ok(RANK[r.problems[i - 1].severity] >= RANK[r.problems[i].severity], 'the worst first');
  const say = re => r.problems.find(p => re.test(`${p.title}: ${p.effect}`));
  assert.ok(say(/^Front-right steering bent: the car pulls (left|right)/), 'steering');
  assert.ok(say(/^Radiator leaking: the engine will overheat/), 'radiator');
  assert.ok(say(/^Front bumper torn off/), 'bumper');
  assert.ok(say(/(Bonnet|wing) (loose|hanging loose)/), 'something hanging');
  assert.ok(say(/headlight smashed: no light there at night/i), 'a light');
  assert.ok(say(/^Front-right tyre punctured/), 'a tyre');
  // the bumper's spare in the inventory is offered; the total is what repairing all of it costs
  assert.ok(r.problems.filter(p => p.socket === 'socket_bumper_front').some(p => p.spares.length === 1));
  assert.equal(r.quick, w.quick);
  assert.equal(r.full, w.full);
  // fixed: nothing left
  await service.addMoney(20000);
  assert.ok((await service.repairCar(carId, { kind: 'full' })).ok);
  const after = carProblems(db, service.profile, carId);
  assert.equal(after.problems.length, 0);
  assert.ok(after.drivable.ok);
});

test('a quick repair: cheaper, about 80%, most dents out, leaks sealed; a full repair: as new, every dent out', async () => {
  const a = await fresh(), b = await fresh();
  for (const x of [a, b]) { await crash(x.service, x.carId, impactsOf(60)); await x.service.addMoney(20000); }
  const bumper = on(a.service, a.carId, 'socket_bumper_front'), dents = bumper.dents.length, deepest = Math.max(...bumper.dents.map(d => d.s));
  const engine = on(a.service, a.carId, 'socket_engine');
  assert.ok(bumper.condition < 60 && engine.damage?.leak > 0, 'crumpled, the radiator leaking');
  const quickCost = carWork(db, a.service.profile, a.carId).quick, fullCost = carWork(db, b.service.profile, b.carId).full, money = a.service.profile.money;
  let r = await a.service.repairCar(a.carId, { kind: 'quick' });
  assert.ok(r.ok, r.error);
  assert.equal(money - a.service.profile.money, quickCost);
  assert.ok(quickCost < fullCost);
  const q = on(a.service, a.carId, 'socket_bumper_front');
  assert.equal(q.condition, E.repair.quick.condition);
  assert.ok((q.dents?.length ?? 0) < dents && Math.max(0, ...(q.dents ?? []).map(d => d.s)) <= deepest * E.repair.quick.dentScale + 1e-9, `${dents} dents → ${q.dents?.length ?? 0}, shallower`);
  assert.equal(q.attach, undefined, 'bolted back on');
  assert.equal(on(a.service, a.carId, 'socket_engine').damage?.leak, undefined, 'the radiator sealed');
  assert.ok(carWork(db, a.service.profile, a.carId).full > 0, 'still short of new: a full repair would do more');
  assert.ok(drivability(car, ownedBySocket(db, a.service.profile, a.carId), rules).ok);
  // full: as new
  r = await b.service.repairCar(b.carId, { kind: 'full' });
  assert.ok(r.ok, r.error);
  const all = Object.values(b.service.profile.parts).filter(x => x.installedOn?.car === b.carId);
  assert.ok(all.every(x => x.condition === 100 && !x.dents && !x.dentLog && !x.damage && !x.attach));
  assert.equal(b.service.profile.cars[b.carId].damage, undefined);
  assert.equal((await b.service.repairCar(b.carId)).ok, false, 'nothing left to repair');
});

test('a problem at a time: one corner of the suspension, one broken light — the rest stays; not without the money', async () => {
  const { service, carId } = await fresh();
  await crash(service, carId, impactsOf(100));
  const sus = on(service, carId, 'socket_suspension');
  assert.ok(sus.damage.FL && sus.damage.FR, 'both front corners bent');
  const piece = partWork(db, sus).find(x => x.scope === 'corner:FL');
  // too little money: nothing changes
  await service.addMoney(-service.profile.money);
  let r = await service.repairCar(carId, { items: [{ target: sus.instanceId, scope: 'corner:FL' }] });
  assert.equal(r.ok, false);
  assert.match(r.error, /Not enough money/);
  assert.ok(on(service, carId, 'socket_suspension').damage.FL, 'still bent');
  await service.addMoney(5000);
  r = await service.repairCar(carId, { items: [{ target: sus.instanceId, scope: 'corner:FL' }] });
  assert.ok(r.ok, r.error);
  assert.equal(r.cost, piece.full);
  assert.equal(on(service, carId, 'socket_suspension').damage.FL, undefined);
  assert.ok(on(service, carId, 'socket_suspension').damage.FR, 'the other corner as it was');
  const light = service.profile.cars[carId].damage.broken[0];
  r = await service.repairCar(carId, { items: [{ target: 'shell', scope: `broken:${light}` }] });
  assert.ok(r.ok && r.cost === E.repair.breakable);
  assert.ok(!(service.profile.cars[carId].damage.broken ?? []).includes(light) && service.profile.cars[carId].damage.dents.length, 'one light new; the dents stay');
});

test('a spare from the inventory in place of a damaged part: free, the damaged one to the inventory as it is', async () => {
  const { service, carId } = await fresh();
  await crash(service, carId, impactsOf(100));
  const old = on(service, carId, 'socket_bumper_front'), money = service.profile.money;
  assert.equal(old.attach, 'detached');
  await service.givePart('stock_bumper_front', 1);
  const spare = Object.values(service.profile.parts).find(x => x.partId === 'stock_bumper_front' && !x.installedOn);
  const r = await service.replaceWithSpare(carId, 'socket_bumper_front', spare.instanceId);
  assert.ok(r.ok, r.error);
  assert.equal(service.profile.money, money);
  assert.equal(r.replaced, old.instanceId);
  const now = on(service, carId, 'socket_bumper_front'), was = service.profile.parts[old.instanceId];
  assert.equal(now.instanceId, spare.instanceId);
  assert.ok(now.condition === 100 && !now.attach && !now.dents);
  assert.ok(was.installedOn === null && was.condition < 50 && was.dents.length && was.attach === undefined, 'in the inventory, damaged, not hanging off anything');
  assert.ok((await service.replaceWithSpare(carId, 'socket_bumper_front', was.instanceId)).ok, 'and back again');
  assert.equal((await service.replaceWithSpare(carId, 'socket_bumper_front', on(service, carId, 'socket_engine').instanceId)).ok, false, 'not a part on the car');
});

test('the safety net: a broke player with a car that can\'t carry on gets a free basic repair to a drivable state — and only then', async () => {
  const { service, carId } = await fresh();
  await crash(service, carId, impactsOf(150));
  const owned = () => ownedBySocket(db, service.profile, carId), d = drivability(car, owned(), rules);
  assert.equal(d.ok, false);
  assert.ok(d.reasons.some(r => /wheel is off/.test(r)), d.reasons.join(' '));
  // money enough to fix it: no free repair
  await service.addMoney(50000);
  let r = await service.basicRepair(carId);
  assert.equal(r.ok, false);
  assert.match(r.error, /afford/);
  await service.addMoney(-service.profile.money);
  assert.ok(service.quickFixCost(service.profile, carId) > 0);
  r = await service.basicRepair(carId);
  assert.ok(r.ok, r.error);
  assert.equal(service.profile.money, 0, 'free');
  assert.ok(drivability(car, owned(), rules).ok, drivability(car, owned(), rules).reasons.join(' '));
  assert.ok(carWork(db, service.profile, carId).full > 0, 'only just: still damaged');
  assert.ok(new Garage(db, { ...garageStateOf(service.profile, db), current: carId }).drivable().ok);
  // a drivable car: no free repair
  assert.match((await service.basicRepair(carId)).error, /can be driven already/);
  // a blown engine, and broke: running again
  await service.setCondition([on(service, carId, 'socket_engine').instanceId], 0);
  r = await service.basicRepair(carId);
  assert.ok(r.ok, r.error);
  assert.equal(on(service, carId, 'socket_engine').condition, E.safetyNet.engineCondition);
});

test('back on the road: a race puts only a wheel torn off back on, a test drive everything; a repair is what bolts the rest on', async () => {
  const a = await fresh(), b = await fresh();
  for (const x of [a, b]) await crash(x.service, x.carId, impactsOf(150));
  const offs = x => Object.values(x.service.profile.parts).filter(p => p.attach).map(p => `${p.installedOn.socket}:${p.attach}`).sort();
  assert.ok(offs(a).includes('socket_wheel_FL:detached') && offs(a).includes('socket_bumper_front:detached'), offs(a).join(' '));
  let r = await a.service.sessionReset(a.carId, { kind: 'race' });
  assert.ok(r.ok && r.reattached.every(s => /wheel/.test(s)));
  assert.ok(offs(a).every(s => !/wheel/.test(s)) && offs(a).includes('socket_bumper_front:detached'), 'the wheels back on, the bumper still off');
  assert.equal(on(a.service, a.carId, 'socket_tyre_FL').damage.pressure, 0, 'flat, as it came off');
  r = await b.service.sessionReset(b.carId, { kind: 'test' });
  assert.deepEqual(offs(b), []);
  assert.ok(on(b.service, b.carId, 'socket_bumper_front').condition < 50, 'back on, still damaged');
});

test('the damage survives closing and opening the game: rebuilt exactly from its impact list', async () => {
  const { service, storage, carId } = await fresh();
  for (const [kmh, side, angle] of [[60, 'front', 0], [30, 'side', 0], [100, 'rear', 0], [60, 'front', 30], [30, 'front', 0]]) await crash(service, carId, impactsOf(kmh, side, angle));
  const before = service.profile, saved = JSON.parse(storage.json);
  // stored: packed logs, no dents
  for (const x of Object.values(saved.parts)) { assert.equal(x.dents, undefined); if (x.dentLog) assert.ok(typeof (x.dentLog.b ?? x.dentLog.h) === 'string'); }
  const again = new LocalPlayerService({ db, storage, now });
  const r = await again.init();
  assert.deepEqual(r.notices, []);
  assert.deepEqual(again.profile, before, 'every dent, condition, mechanical block and loose part as it was');
  // a long run of hits folds its oldest into the base: the same dents either way
  let log = { base: [], hits: [] }, list = [];
  for (let i = 0; i < 200; i++) { const h = { p: [+(Math.sin(i) * 0.8).toFixed(4), 0.5, 1.9], d: [0, 0, -1], s: +(2 + (i % 13)).toFixed(3) }; log = appendHits(log, [h], rules); list = addDent(list, h, rules); }
  assert.ok(log.hits.length <= LOG.max && log.base.length <= rules.dent.maxPerPart);
  assert.deepEqual(dentsOf(log, rules), list);
  assert.deepEqual(unpackDents(packDents(list)), list, '16 bytes a dent, exactly');
});

test('a heavily damaged car\'s damage is small enough to send; one crash is a small event that rebuilds the same dents elsewhere', async () => {
  const { service, carId } = await fresh();
  for (let i = 0; i < 6; i++) for (const [kmh, side, angle] of [[100, 'front', 0], [100, 'rear', 0], [100, 'side', 0], [60, 'front', 30]]) await crash(service, carId, impactsOf(kmh, side, angle));
  const p = packProfile(service.profile), damage = { shell: p.cars[carId].damage, parts: Object.values(p.parts).filter(x => x.installedOn?.car === carId && (x.dentLog || x.damage || x.attach || x.condition < 100)).map(x => ({ id: x.instanceId, c: x.condition, l: x.dentLog, m: x.damage, a: x.attach })) };
  const bytes = sizeOf(damage);
  assert.ok(bytes < 8000, `the whole car's damage: ${bytes} bytes`);
  // one crash as an event: what another player's game needs to dent its copy of this car the same
  const g = new Garage(db, null, 'starter_car'), [impact] = impactsOf(100);
  const out = crashOutcome({ car, build: g.build, view: g.view, boxes, rules, attach: {}, mech: {}, damage: { shell: null, parts: {} } }, impact);
  const event = packCrash(out, g.build), back = unpackCrash(JSON.parse(JSON.stringify(event)));
  assert.ok(sizeOf(event) < 2000, `one crash: ${sizeOf(event)} bytes`);
  for (const [socket, list] of Object.entries(back.hits)) {
    const theirs = list.reduce((l, d) => addDent(l, d, rules), []), mine = socket === 'shell' ? out.next.shell.dents : out.next.parts[g.build.sockets[socket]].dents;
    assert.deepEqual(theirs, mine, socket);
  }
  assert.deepEqual(back.broken, out.result.broken);
});

test('an old save (version 2: dents as lists) loads with its dents as they were; hints are seen once', async () => {
  const { service, carId } = await fresh();
  await crash(service, carId, impactsOf(60));
  const v2 = JSON.parse(JSON.stringify(service.profile));
  v2.version = 2;
  for (const x of [...Object.values(v2.parts), v2.cars[carId].damage]) if (x) { delete x.dentLog; delete x.attach; }
  const old = await fresh(v2);
  for (const [id, x] of Object.entries(service.profile.parts)) assert.deepEqual(old.service.profile.parts[id].dents, x.dents, id);
  assert.deepEqual(old.service.profile.cars[carId].damage.dents, service.profile.cars[carId].damage.dents);
  // hints
  assert.ok((await service.markHint('firstDamage')).ok);
  await service.markHint('firstDamage');
  assert.deepEqual(service.profile.hints, ['firstDamage']);
  assert.equal((await service.markHint('no spaces please')).ok, false);
});
