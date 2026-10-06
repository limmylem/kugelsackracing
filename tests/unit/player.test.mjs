// Unit tests for the player service (garage/player): money, buying, selling, repairing, fitting parts on
// more than one car, setups, saving and loading (in memory: "closing the browser" is making a new
// service on the same storage), old saves, and saves with parts the game no longer has.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from '../harness.mjs';
import { LocalPlayerService, METHODS, PlayerService } from '../../garage/player/service.js';
import { MemoryStorage } from '../../garage/player/storage.js';
import { CURRENT_VERSION, MIGRATIONS, migrate } from '../../garage/player/migrations.js';
import { buildOf, clone, repairCost, setupChanges } from '../../garage/player/profile.js';
import { sellValue } from '../../garage/shop.js';

const H = await harness(), db = H.db;
let clock = 0;
const now = () => new Date(Date.UTC(2026, 0, 1) + (clock += 1000)).toISOString();
async function fresh(saved = null, extra = {}) {
  const storage = new MemoryStorage(saved), service = new LocalPlayerService({ db: extra.db ?? db, storage, now, ...extra });
  const r = await service.init();
  return { service, storage, profile: r.updatedState, notices: r.notices };
}
const reopen = async (storage, extra = {}) => { const service = new LocalPlayerService({ db: extra.db ?? db, storage, now, ...extra }); const r = await service.init(); return { service, profile: r.updatedState, notices: r.notices }; };
const car = p => p.currentCar;
const at = (p, socket, c = p.currentCar) => p.parts[buildOf(p, db, c)[socket]]?.partId ?? null;
const copyOf = (p, partId, where = 'free') => Object.values(p.parts).find(x => x.partId === partId && (where === 'free' ? !x.installedOn : x.installedOn));

test('a new player: the starting car with its stock parts fitted, the starting money, one setup', async () => {
  const { profile } = await fresh();
  assert.equal(profile.money, db.economy.startingMoney);
  const c = profile.cars[car(profile)];
  assert.equal(c.carId, db.economy.startingCar);
  assert.equal(at(profile, 'socket_engine'), 'stock_engine_rs17');
  assert.ok(Object.values(profile.parts).every(p => p.installedOn && p.condition === 100));
  assert.equal(Object.keys(c.setups).length, 1);
  assert.deepEqual(setupChanges(profile, db, car(profile)), []);
  assert.ok(Object.keys(METHODS).every(m => typeof LocalPlayerService.prototype[m] === 'function'));
  await assert.rejects(new PlayerService().buyPart('turbo_kit'), /can't buyPart/);
});

test('buying: money comes off, a new copy at 100% in the inventory; not without enough money; retired parts aren\'t sold', async () => {
  const { service } = await fresh();
  let r = await service.buyPart('cold_air_intake');
  assert.ok(r.ok, r.error);
  assert.equal(r.updatedState.money, db.economy.startingMoney - db.parts.cold_air_intake.price);
  assert.equal(copyOf(r.updatedState, 'cold_air_intake').condition, 100);
  // a set of four for wheels and tyres
  r = await service.buyPart('tyre_205_50r15');
  assert.equal(r.instanceIds.length, 4);
  assert.equal(r.cost, 4 * db.parts.tyre_205_50r15.price);
  // not enough money: nothing changes
  const before = r.updatedState;
  r = await service.buyPart('gearbox_close_ratio', { quantity: 5 });
  assert.equal(r.ok, false);
  assert.match(r.error, /Not enough money/);
  assert.deepEqual(r.updatedState, before);
  // retired
  const retiredDb = { ...db, parts: { ...db.parts, turbo_kit: { ...db.parts.turbo_kit, retired: true } } };
  const f = await fresh(null, { db: retiredDb });
  r = await f.service.buyPart('turbo_kit');
  assert.equal(r.ok, false);
  assert.match(r.error, /isn't sold any more/);
  // ...but one already owned still goes on
  await f.service.givePart('turbo_kit'); await f.service.givePart('front_mount_intercooler');
  const p = (await f.service.getProfile()).updatedState;
  assert.ok((await f.service.installPart(car(p), copyOf(p, 'front_mount_intercooler').instanceId)).ok);
  r = await f.service.installPart(car(p), copyOf(p, 'turbo_kit').instanceId);
  assert.ok(r.ok, r.error);
});

test('fitting: a part on one car can\'t go on another; wheels and tyres need a whole set', async () => {
  const { service } = await fresh();
  await service.addMoney(20000);
  let r = await service.buyCar('starter_car');
  assert.ok(r.ok, r.error);
  const second = r.carInstanceId, first = r.updatedState.currentCar;
  r = await service.buyPart('cold_air_intake');
  const intake = r.instanceIds[0];
  r = await service.installPart(first, intake);
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.ops.map(o => `${o.op} ${o.socket}`), ['remove socket_bonnet', 'remove socket_intake', 'install socket_intake', 'install socket_bonnet']);
  assert.equal(at(r.updatedState, 'socket_intake', first), 'cold_air_intake');
  r = await service.installPart(second, intake);
  assert.equal(r.ok, false);
  assert.match(r.error, /on your Starter coupe 1: take it off there first/);
  // the stock airbox it replaced is in the inventory now
  assert.ok(copyOf(r.updatedState, 'stock_airbox'));
  // tyres: only a whole set of four
  r = await service.givePart('tyre_195_50r15', 2);
  r = await service.installPart(first, r.instanceIds[0]);
  assert.equal(r.ok, false);
  assert.match(r.error, /goes on all 4 at once and you have 2/);
  await service.givePart('tyre_195_50r15', 2);
  const p = (await service.getProfile()).updatedState;
  r = await service.installPart(first, copyOf(p, 'tyre_195_50r15').instanceId);
  assert.ok(r.ok, r.error);
  assert.equal(Object.keys(r.updatedState.parts).length, Object.keys(p.parts).length, 'no copies appear out of nowhere');
  assert.equal(Object.values(r.updatedState.parts).filter(x => x.partId === 'stock_tyre_180_55r15' && !x.installedOn).length, 4);
});

test('buy and install: all or nothing', async () => {
  const { service } = await fresh();
  let r = await service.buyAndInstall(car((await service.getProfile()).updatedState), 'turbo_kit');
  assert.equal(r.ok, false, 'the turbo needs an intercooler');
  assert.equal(r.updatedState.money, db.economy.startingMoney, 'so nothing was bought');
  const c = car(r.updatedState);
  r = await service.buyAndInstall(c, 'front_mount_intercooler');
  assert.ok(r.ok, r.error);
  r = await service.buyAndInstall(c, 'turbo_kit');
  assert.ok(r.ok, r.error);
  assert.equal(r.updatedState.money, db.economy.startingMoney - 600 - 2400);
  assert.equal(at(r.updatedState, 'socket_turbo'), 'turbo_kit');
});

test('selling and repairing: an installed part can\'t be sold; prices from the config', async () => {
  const { service, profile } = await fresh();
  const engine = buildOf(profile, db, car(profile)).socket_engine;
  let r = await service.sellPart(engine);
  assert.equal(r.ok, false);
  assert.match(r.error, /take it off before you sell it/);
  r = await service.buyPart('cold_air_intake');
  const intake = r.instanceIds[0];
  await service.setCondition(intake, 55);
  const worn = (await service.getProfile()).updatedState.parts[intake];
  const E = db.economy;
  // (what it's worth × the ratio, less a share of what putting it right would cost)
  assert.equal(sellValue(db, worn), Math.round(350 * E.sell.ratio - E.sell.repairShare * repairCost(db, worn)));
  assert.equal(repairCost(db, worn), Math.round(Math.max(E.repair.minimum, 350 * E.repair.perPoint * 45)));
  const money = (await service.getProfile()).updatedState.money;
  r = await service.repairPart(intake);
  assert.ok(r.ok, r.error);
  assert.equal(r.updatedState.money, money - repairCost(db, worn));
  assert.equal(r.updatedState.parts[intake].condition, 100);
  r = await service.repairPart(intake);
  assert.equal(r.ok, false, 'nothing to repair');
  r = await service.sellPart(intake);
  assert.ok(r.ok);
  assert.equal(r.amount, Math.round(350 * E.sell.ratio));
  assert.equal(r.updatedState.parts[intake], undefined);
  // repair all: everything on the car at once
  const p = r.updatedState, fitted = Object.values(p.parts).filter(x => x.installedOn).map(x => x.instanceId).slice(0, 5);
  await service.setCondition(fitted, 30);
  r = await service.repairParts(fitted);
  assert.ok(r.ok, r.error);
  assert.equal(r.repaired, 5);
});

test('setups: saving, renaming, switching moves the parts; what\'s gone or on another car is listed', async () => {
  const { service, profile } = await fresh();
  const c = car(profile);
  await service.addMoney(20000);
  const stockSetup = profile.cars[c].activeSetup;
  await service.buyAndInstall(c, 'cold_air_intake');
  let r = await service.buyAndInstall(c, 'sport_suspension');
  assert.equal(setupChanges(r.updatedState, db, c).length, 2, 'the build has moved on from the stock setup');
  r = await service.saveSetup(c, { name: 'Street' });
  assert.ok(r.ok, r.error);
  const street = r.setupId;
  assert.equal((await service.saveSetup(c, { name: 'street' })).ok, false, 'names are unique');
  assert.ok((await service.renameSetup(c, street, 'Street 1')).ok);
  // back to stock: the upgrades go to the inventory, the stock parts come back
  r = await service.switchSetup(c, stockSetup);
  assert.ok(r.ok, r.error);
  assert.equal(at(r.updatedState, 'socket_intake'), 'stock_airbox');
  assert.equal(at(r.updatedState, 'socket_suspension'), 'stock_suspension');
  assert.ok(copyOf(r.updatedState, 'cold_air_intake') && copyOf(r.updatedState, 'sport_suspension'));
  assert.equal(r.updatedState.cars[c].activeSetup, stockSetup);
  // and back again
  r = await service.switchSetup(c, street);
  assert.equal(at(r.updatedState, 'socket_intake'), 'cold_air_intake');
  assert.equal(at(r.updatedState, 'socket_suspension'), 'sport_suspension');
  // the intake sold (after switching back to stock), the suspension on another car: listed, and
  // switching anyway leaves those sockets stock
  await service.switchSetup(c, stockSetup);
  let p = (await service.getProfile()).updatedState;
  await service.sellPart(copyOf(p, 'cold_air_intake').instanceId);
  const other = (await service.buyCar('starter_car')).carInstanceId;
  p = (await service.getProfile()).updatedState;
  assert.ok((await service.installPart(other, copyOf(p, 'sport_suspension').instanceId)).ok);
  r = await service.switchSetup(c, street);
  assert.equal(r.ok, false);
  assert.deepEqual(r.conflicts.map(x => [x.socket, x.partId, x.reason]).sort(), [['socket_intake', 'cold_air_intake', 'gone'], ['socket_suspension', 'sport_suspension', 'elsewhere']]);
  r = await service.switchSetup(c, street, { force: true });
  assert.ok(r.ok, r.error);
  assert.equal(at(r.updatedState, 'socket_intake'), 'stock_airbox');
  assert.equal(at(r.updatedState, 'socket_suspension'), 'stock_suspension');
  assert.equal(at(r.updatedState, 'socket_suspension', other), 'sport_suspension', 'the other car kept its part');
  assert.ok((await service.deleteSetup(c, street)).ok);
});

test('saving: close the browser and open it again, and everything is as it was', async () => {
  const { service, storage } = await fresh();
  const c = (await service.getProfile()).updatedState.currentCar;
  await service.addMoney(10000);
  await service.buyAndInstall(c, 'cold_air_intake');
  await service.buyPart('turbo_kit');
  await service.setPaint(c, { colour: '#C8202B', finish: 'metallic' });
  await service.buyAndInstall(c, 'sport_suspension');
  let p = (await service.getProfile()).updatedState;
  await service.setTuning(buildOf(p, db, c).socket_suspension, { rideHeight: -20 });
  await service.saveSetup(c, { name: 'Low' });
  const last = (await service.save()).updatedState;
  const writes = storage.saves, again = await reopen(storage);
  assert.deepEqual(again.profile, last, 'exactly as it was, to the time it was saved');
  assert.deepEqual(again.notices, []);
  assert.equal(storage.saves, writes, 'opening it doesn\'t write it again');
  // and a save file, out and back in
  const out = await service.exportSave();
  const other = await fresh();
  const r = await other.service.importSave(out.json);
  assert.ok(r.ok, r.error);
  assert.deepEqual({ ...r.updatedState, saved: null }, { ...last, saved: null });
  assert.equal((await other.service.importSave('not json')).ok, false);
  assert.equal((await other.service.importSave({ hello: 1 })).ok, false);
});

test('an old save (version 1, before the shop) loads; migrations run one step at a time', async () => {
  // the garage as Phase 2 Steps 1–5 kept it in the browser: builds of socket → part, no money
  const v1 = H.garage().state;
  const g = H.garage(v1); g.install(g.acquire('cold_air_intake').instanceId);
  const old = clone(g.state);
  const { profile, notices } = await fresh(old);
  assert.equal(profile.version, CURRENT_VERSION);
  assert.equal(profile.money, db.economy.startingMoney);
  assert.equal(at(profile, 'socket_intake'), 'cold_air_intake');
  assert.ok(copyOf(profile, 'stock_airbox'), 'the part it replaced is in the inventory');
  assert.equal(Object.values(profile.cars[profile.currentCar].setups)[0].sockets.socket_intake, buildOf(profile, db, profile.currentCar).socket_intake);
  assert.deepEqual(notices, []);
  // a pretend next version (money becomes pennies... in a field called "cash"): a version 1 save goes
  // through every step in order
  const next = CURRENT_VERSION + 1, later = { ...MIGRATIONS, [CURRENT_VERSION]: save => ({ ...save, cash: save.money * 100 }) };
  const m = migrate(old, { migrations: later, current: next, context: { db } });
  assert.deepEqual(m.steps, Array.from({ length: next - 1 }, (_, i) => `${i + 1} → ${i + 2}`));
  assert.equal(m.save.version, next);
  assert.equal(m.save.cash, db.economy.startingMoney * 100);
  assert.throws(() => migrate({ ...old, version: 9 }), /newer version/);
});

test('loading a save with a part or car the game no longer has: removed, refunded, and a notice', async () => {
  const { service, storage } = await fresh();
  await service.buyPart('turbo_kit');
  const c = (await service.getProfile()).updatedState.currentCar;
  await service.addMoney(20000);
  await service.buyAndInstall(c, 'cold_air_intake');
  await service.buyCar('starter_car');
  const saved = await storage.load();
  // this version of the game has no turbo kit, no cold air intake and no second car model
  const turbo = Object.values(saved.parts).find(p => p.partId === 'turbo_kit');
  const intake = Object.values(saved.parts).find(p => p.partId === 'cold_air_intake');
  turbo.partId = 'turbo_kit_mk1'; intake.partId = 'cold_air_intake_old';
  const second = Object.values(saved.cars).find(x => x.carInstanceId !== saved.currentCar);
  second.carId = 'old_coupe';
  const again = await reopen(new MemoryStorage(saved));
  assert.equal(again.profile.money, saved.money + 2400 + 350 + 12000);
  assert.equal(Object.values(again.profile.parts).some(p => p.partId.endsWith('_mk1') || p.partId.endsWith('_old')), false);
  assert.equal(again.profile.cars[second.carInstanceId], undefined);
  assert.equal(again.notices.length, 3, again.notices.join('\n'));
  assert.match(again.notices.join('\n'), /refunded/);
  // the intake's socket is empty now (in the garage that's fine), and the second car's parts are in
  // the inventory
  assert.equal(at(again.profile, 'socket_intake'), null);
  assert.ok(Object.values(again.profile.parts).every(p => !p.installedOn || again.profile.cars[p.installedOn.car]));
});

test('undo: a whole build back as it was, if its parts are still the player\'s', async () => {
  const { service, profile } = await fresh();
  const c = car(profile), before = buildOf(profile, db, c);
  let r = await service.buyAndInstall(c, 'cold_air_intake');
  r = await service.setBuild(c, { sockets: before });
  assert.ok(r.ok, r.error);
  assert.equal(at(r.updatedState, 'socket_intake'), 'stock_airbox');
  // the airbox sold: that build can't come back
  const airbox = before.socket_intake;
  await service.buyAndInstall(c, 'cold_air_intake');
  await service.sellPart(airbox);
  r = await service.setBuild(c, { sockets: before });
  assert.equal(r.ok, false);
  assert.match(r.error, /isn't yours any more/);
});

test('unlimited money (development): everything free while it\'s on, money untouched; back to normal after', async () => {
  const { service } = await reopen(new MemoryStorage());
  await service.addMoney(-service.profile.money + 100);        // ($100 left)
  const money = service.profile.money, pricey = Object.values(db.parts).filter(p => !p.retired && !p.todo?.length).sort((a, b) => b.price - a.price)[0];
  assert.equal((await service.buyPart(pricey.id)).ok, false);
  await service.setUnlimitedMoney(true);
  const r = await service.buyPart(pricey.id);
  assert.ok(r.ok, r.error);
  const car2 = await service.buyCar('starter_car');
  assert.ok(car2.ok, car2.error);
  const worn = Object.values(service.profile.parts)[0].instanceId;
  await service.setCondition([worn], 10);
  assert.ok((await service.repairPart(worn)).ok);
  assert.equal(service.profile.money, money, 'nothing taken');
  await service.setUnlimitedMoney(false);
  assert.equal((await service.buyPart(pricey.id)).ok, false);
});
