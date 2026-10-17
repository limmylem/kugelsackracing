// Repair tokens (garage/repairTokens.js, garage/player/service.js): a new player has some; one repairs everything on
// a car in full, free; while there are few, one comes back every so often; wins and levels earn more, never past the
// most; none left, repairs are paid with money as before; a save can't hold more than the most.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from '../harness.mjs';
import { LocalPlayerService } from '../../garage/player/service.js';
import { MemoryStorage } from '../../garage/player/storage.js';
import { checkProfile } from '../../garage/player/profile.js';
import { earnTokens, settleTokens, spendToken, tokensNow } from '../../garage/repairTokens.js';

const H = await harness(), db = H.db, C = db.economy.repairTokens, HOUR = 3600e3;
const T0 = Date.UTC(2026, 0, 1, 9);
const at = h => new Date(T0 + h * HOUR).toISOString();

test('the config: some to start with, a refill below the most, wins and levels earn more', () => {
  assert.ok(C.enabled && C.start > 0 && C.max >= C.start && C.refill.upTo <= C.max && C.refill.everyHours > 0 && C.earn.win > 0 && C.earn.levelUp > 0);
});

test('tokens: start, spend, refill while there are few, earn up to the most', () => {
  const p = {};
  assert.deepEqual(tokensNow(p, C, at(0)), { enabled: true, count: C.start, max: C.max, nextAt: null });
  // spent down to none: the clock starts when the count goes under upTo
  for (let i = C.start; i > 0; i--) assert.equal(spendToken(p, C, at(0)).count, i - 1);
  const out = spendToken(p, C, at(0));
  assert.match(out.error, /out of repair tokens/);
  assert.equal(out.nextAt, at(C.refill.everyHours));
  assert.equal(tokensNow(p, C, at(C.refill.everyHours - 0.01)).count, 0);
  assert.equal(tokensNow(p, C, at(C.refill.everyHours)).count, 1);
  // a long time away: only up to upTo
  assert.equal(tokensNow(p, C, at(1000)).count, C.refill.upTo);
  assert.equal(tokensNow(p, C, at(1000)).nextAt, null);
  settleTokens(p, C, at(1000));
  // a win and a level: more, past upTo, up to max
  assert.equal(earnTokens(p, C, { wins: 1, levels: 1 }, at(1000)), C.earn.win + C.earn.levelUp);
  assert.equal(p.repairTokens.count, C.refill.upTo + C.earn.win + C.earn.levelUp);
  earnTokens(p, C, { levels: 50 }, at(1000));
  assert.equal(p.repairTokens.count, C.max);
  assert.equal(earnTokens(p, C, { levels: 1 }, at(1000)), 0, 'never past the most');
});

test('tokens: wins earn only so many a day', () => {
  const p = { repairTokens: { count: 0, at: at(0) } };
  let got = 0;
  for (let i = 0; i < 20; i++) got += earnTokens(p, C, { wins: 1 }, at(0.1));
  assert.equal(got, C.earn.winsPerDay * C.earn.win);
  assert.equal(earnTokens(p, C, { wins: 1 }, at(24)), C.earn.win, 'a new day');
});

test('a save\'s tokens as they should be', () => {
  const p = checkProfile({ money: 0, cars: {}, parts: {}, repairTokens: { count: 999.5, at: 'soon' } }, db).profile;
  assert.equal(p.repairTokens.count, C.max);
  assert.ok(Number.isFinite(Date.parse(p.repairTokens.at)));
  assert.equal(checkProfile({ money: 0, cars: {}, parts: {}, repairTokens: 'lots' }, db).profile.repairTokens, undefined);
});

test('the service: a token repairs everything in full, free; none left, money as before', async () => {
  let clock = T0;
  const now = () => new Date(clock += 1000).toISOString();
  const service = new LocalPlayerService({ db, storage: new MemoryStorage(null), now });
  await service.init();
  const carId = service.profile.currentCar, parts = () => Object.values(service.profile.parts).filter(x => x.installedOn?.car === carId);
  const wreck = async () => { const r = await service.setCondition(parts().map(x => x.instanceId), 20); assert.ok(r.ok, r.error); };
  await wreck();
  await service.addMoney(-service.profile.money);
  // broke, and the repair costs money: the token does it anyway
  assert.equal((await service.repairCar(carId, { kind: 'full' })).ok, false);
  const r = await service.repairCar(carId, { kind: 'quick', items: [{ target: parts()[0].instanceId }], useToken: true });
  assert.ok(r.ok, r.error);
  assert.ok(r.token && r.cost === 0 && r.worth > 0 && r.tokensLeft === C.start - 1, JSON.stringify(r));
  assert.ok(parts().every(x => x.condition === 100), 'every part, in full (a token is never a quick or partial repair)');
  assert.equal(service.profile.money, 0);
  assert.equal(service.repairTokens().count, C.start - 1);
  // nothing to repair: no token spent
  assert.match((await service.repairCar(carId, { useToken: true })).error, /perfect/);
  assert.equal(service.repairTokens().count, C.start - 1);
  // out of them
  for (let i = C.start - 1; i > 0; i--) { await wreck(); assert.ok((await service.repairCar(carId, { useToken: true })).ok); }
  await wreck();
  const none = await service.repairCar(carId, { useToken: true });
  assert.match(none.error, /out of repair tokens/);
  await service.addMoney(1e6);
  assert.ok((await service.repairCar(carId, { kind: 'full' })).ok, 'paid with money');
  // and one comes back
  clock += C.refill.everyHours * HOUR;
  assert.equal(service.repairTokens().count, 1);
});
