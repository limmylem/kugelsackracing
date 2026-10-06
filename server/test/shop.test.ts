// The shop, the dealership and selling through the server (Phase 6 Step 4): every kind of purchase and sale with
// its ledger row; what a tampered request can't do (a price, a locked item, someone else's or a racing car's things,
// a sale that's over, a limited item gone); the used lot the same for everyone on a day and new the next; a refund
// once, only for something unused, only in its window; the garage's space; the admin's catalogue changes (logged,
// reversible). The server's clock is the test's (a sale ending, the refund window closing, tomorrow).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { testApp, Player, signUp } from './helpers.ts';
import { carSellValue, sellValue } from '../../garage/shop.js';

let T: Awaited<ReturnType<typeof testApp>>, ann: Player, ben: Player, cat: Player, admin: Player;
let now = Date.UTC(2026, 9, 6, 12);
const HOUR = 3_600_000, DAY = 24 * HOUR;
const act = (p: Player, action: string, args: object, o: object = {}) => p.post(`/api/v1/player/actions/${action}`, { args }, o);
const profile = async (p: Player) => (await p.get('/api/v1/player')).body.profile;
const idOf = async (email: string) => ((await T.app.deps.db.execute(sql`select id from users where email = ${email}`)).rows[0] as any).id as string;
const lastLedger = async (p: Player, n = 1) => (await p.get(`/api/v1/player/ledger?limit=${n}`)).body.entries;
const ledgerOk = async () => assert.deepEqual(await T.app.economy.ledgerCheck(), [], 'every balance equals its ledger');
const grant = async (email: string, amount: number) => { const r = await admin.post(`/api/v1/admin/players/${await idOf(email)}/money`, { amount, reason: 'Test: money to shop with' }); assert.equal(r.status, 200, r.text); };
const xp = async (email: string, n: number) => { await T.app.deps.db.execute(sql`update player_economy set xp = ${n}, rev = rev + 1 where user_id = ${await idOf(email)}`); };
const shopChange = async (change: object, reason = 'Test: a shop change') => {
  const basedOn = (await admin.get('/api/v1/admin/shop/catalogue')).body.version;
  return admin.post('/api/v1/admin/shop/catalogue', { change, reason, basedOn });
};
const gameDb = async () => (await T.app.economyConfig.gameDb()).db;

before(async () => {
  T = await testApp('shop', { clock: () => now });
  [ann, ben, cat, admin] = await Promise.all([
    signUp(T.app, T.outbox, { email: 'ann@example.com', name: 'Ann Apex', ip: '10.8.0.1' }),
    signUp(T.app, T.outbox, { email: 'ben@example.com', name: 'Ben Brake', ip: '10.8.0.2' }),
    signUp(T.app, T.outbox, { email: 'cat@example.com', name: 'Cat Camber', ip: '10.8.0.3' }),
    signUp(T.app, T.outbox, { email: 'adm@example.com', name: 'The Admin', ip: '10.8.0.4' }),
  ]);
  await T.app.deps.db.execute(sql`update users set role = 'admin' where email = 'adm@example.com'`);
  for (const p of [ann, ben, cat]) await p.get('/api/v1/player');
  await grant('ann@example.com', 400_000); await grant('ben@example.com', 400_000); await grant('cat@example.com', 400_000);
});
after(async () => { await T?.close(); });

test('every purchase and sale through the server, each with its ledger row', async () => {
  let p = await profile(ann), m = p.money;
  const step = async (action: string, args: object, kind: string, amount: (r: any) => number, reason: RegExp) => {
    const r = await act(ann, action, args);
    assert.equal(r.status, 200, `${action}: ${r.text}`);
    const [L] = await lastLedger(ann);
    assert.equal(L.kind, kind, action); assert.equal(L.amount, amount(r.body), action); assert.match(L.reason, reason, action);
    assert.equal(r.body.updatedState.money, m + L.amount, action); assert.equal(L.balanceAfter, r.body.updatedState.money, action);
    m = r.body.updatedState.money;
    return r.body;
  };
  const part = await step('buyPart', { partId: 'cold_air_intake' }, 'purchase', () => -350, /Bought Cold air intake/i);
  const fitted = await step('buyAndInstall', { carInstanceId: p.currentCar, partId: 'catback_street' }, 'purchase', () => -380, /Bought and fitted/);
  assert.ok(Object.values<any>(fitted.updatedState.parts).some(x => x.partId === 'catback_street' && x.installedOn), 'bought and fitted in one go');
  const kit = await step('buyBundle', { bundleId: 'kit_street_brakes' }, 'purchase', r => -r.cost, /Bought a kit: Street brake kit/);
  assert.equal(kit.cost, Math.round(600 * 0.92));
  const car = await step('buyCar', { carId: 'kaze_gt' }, 'purchase', () => -24000, /Bought a Kaze GT/);
  const slot = await step('buyGarageSlot', {}, 'purchase', r => -r.cost, /garage space/);
  assert.equal(slot.capacity, 4);
  const lot = (await ann.get('/api/v1/player/used-lot')).body, cheap = [...lot.listings].filter((l: any) => !['S', 'X', 'A'].includes(l.class)).sort((a: any, b: any) => a.price - b.price)[0];
  const used = await step('buyUsedCar', { listingId: cheap.id }, 'purchase', () => -cheap.price, /Bought a used car/);
  // (as it was on the lot: its parts at their conditions)
  const usedParts = Object.values<any>(used.updatedState.parts).filter(x => x.installedOn?.car === used.carInstanceId);
  assert.equal(usedParts.length, Object.keys(cheap.parts).length);
  for (const x of usedParts) assert.equal(x.condition, cheap.parts[x.installedOn.socket].condition);
  const db = await gameDb(), intake = part.updatedState.parts[part.instanceIds[0]];
  // (the refund window: an hour on, a sale instead)
  now += HOUR;
  await step('sellPart', { instanceId: part.instanceIds[0] }, 'sale', () => sellValue(db, intake, now), /Sold Cold air intake/i);
  const kitIds: string[] = kit.instanceIds;
  await step('sellParts', { instanceIds: kitIds }, 'sale', r => r.amount, /Sold 2 parts/);
  const keep = Object.values<any>(car.updatedState.parts).filter(x => x.installedOn?.car === car.carInstanceId && x.partId === 'kaze_gt_engine').map(x => x.instanceId);
  const value = carSellValue(db, (await profile(ann)), car.carInstanceId, { keep }, now).total;
  const sold = await step('sellCar', { carInstanceId: car.carInstanceId, opts: { keep } }, 'sale', () => value, /Sold the Kaze GT/);
  assert.ok(sold.amount < 24000 * 0.6 + 1, 'below what it cost');
  assert.equal(sold.updatedState.parts[keep[0]].installedOn, null, 'the kept engine in the inventory');
  const r = await act(ann, 'buyPart', { partId: 'strut_brace' });
  m = r.body.updatedState.money;
  await step('refundPart', { instanceId: r.body.instanceIds[0] }, 'refund', () => 180, /Refunded Front strut brace/i);
  // every change in each item's history, with its ledger row
  const hist = (await T.app.deps.db.execute(sql`select count(*)::int as n from item_history where user_id = ${await idOf('ann@example.com')} and ledger_id is not null`)).rows[0] as any;
  assert.ok(hist.n > 40, `${hist.n} history rows`);
  await ledgerOk();
});

test('tampered requests: a price, a locked item, someone else\'s or a racing car\'s things, a sale over, a limited item gone', async () => {
  const p = await profile(ben);
  // a price, a quantity of money, an extra field: refused before anything runs
  for (const [action, args] of [['buyPart', { partId: 'cold_air_intake', price: 1 }], ['buyCar', { carId: 'kaze_gt', cost: 0 }], ['buyBundle', { bundleId: 'kit_handling', discount: 0.9 }], ['buyUsedCar', { listingId: 'used_20261006_01', price: 1 }], ['sellCar', { carInstanceId: p.currentCar, amount: 1e6 }], ['refundPart', { instanceId: 'x', amount: 5 }], ['buyGarageSlot', { price: 1 }]] as const) {
    const r = await act(ben, action, args);
    assert.equal(r.status, 400, `${action}: ${r.text}`); assert.equal(r.body.error.code, 'VALIDATION');
  }
  // locked: a race part and an S-class car at level 1
  let r = await act(ben, 'buyPart', { partId: 'intake_race' });
  assert.equal(r.status, 409); assert.match(r.body.error.message, /locked.*level 5/);
  r = await act(ben, 'buyCar', { carId: 'apex_v8' });
  assert.equal(r.status, 409); assert.match(r.body.error.message, /locked.*level 6/);
  // someone else's part, an invented one, a car that isn't theirs
  const anns = Object.keys((await profile(ann)).parts)[0];
  for (const [action, args] of [['sellPart', { instanceId: anns }], ['sellParts', { instanceIds: [anns] }], ['refundPart', { instanceId: anns }], ['sellCar', { carInstanceId: (await profile(ann)).currentCar }], ['sellPart', { instanceId: 'part_made_up_000001' }]] as const) {
    r = await act(ben, action, args);
    assert.equal(r.status, 409, `${action}: ${r.text}`);
  }
  // the only car: never sold; a part on a car: never sold
  r = await act(ben, 'sellCar', { carInstanceId: p.currentCar });
  assert.equal(r.status, 409); assert.match(r.body.error.message, /only car/);
  r = await act(ben, 'sellPart', { instanceId: Object.values<any>(p.parts).find(x => x.installedOn).instanceId });
  assert.equal(r.status, 409); assert.match(r.body.error.message, /take it off/);
  // a car in a race: not sold, nor its parts
  const second = (await act(ben, 'buyCar', { carId: 'vortex_r' })).body.carInstanceId;
  await T.app.deps.db.execute(sql`insert into economy_sessions (id, user_id, kind, quest_id, attempt_id, car_instance_id, fee, state, quest) values (${'ses_00000000-0000-4000-8000-000000000001'}, ${await idOf('ben@example.com')}, 'quest', 'quest_x', 'att_x', ${second}, 0, 'active', '{}'::jsonb)`);
  r = await act(ben, 'sellCar', { carInstanceId: second });
  assert.equal(r.status, 409); assert.match(r.body.error.message, /in a race/);
  await T.app.deps.db.execute(sql`update economy_sessions set state = 'finished' where id = 'ses_00000000-0000-4000-8000-000000000001'`);
  // a sale: its price while it's on; the list price the moment it's over (the request can't say otherwise)
  const s = await shopChange({ op: 'sale', sale: { id: 'test_brakes', name: 'Brake hour', starts: new Date(now - 1000).toISOString(), ends: new Date(now + HOUR).toISOString(), discount: 0.25, categories: ['brakes'] } });
  assert.equal(s.status, 200, s.text);
  r = await act(ben, 'buyPart', { partId: 'brakes_sport' });
  assert.equal(r.body.cost, Math.round(1100 * 0.75));
  now += HOUR + 1000;
  r = await act(ben, 'buyPart', { partId: 'brakes_sport' });
  assert.equal(r.status, 200); assert.equal(r.body.cost, 1100, 'the sale is over');
  // a limited-time item: gone after its date
  assert.equal((await shopChange({ op: 'item', kind: 'part', id: 'strut_brace_carbon', set: { until: new Date(now + 1000).toISOString() } })).status, 200);
  assert.equal((await act(ben, 'buyPart', { partId: 'strut_brace_carbon' })).status, 200);
  now += 2000;
  r = await act(ben, 'buyPart', { partId: 'strut_brace_carbon' });
  assert.equal(r.status, 409); assert.match(r.body.error.message, /only on sale until/);
  // hidden from the catalogue: not for sale
  assert.equal((await shopChange({ op: 'item', kind: 'part', id: 'pads_sport', set: { hidden: true } })).status, 200);
  r = await act(ben, 'buyPart', { partId: 'pads_sport' });
  assert.equal(r.status, 409); assert.match(r.body.error.message, /isn't for sale/);
  await ledgerOk();
});

test('the used lot: the same for everyone today, a new one tomorrow; each listing once a player', async () => {
  const a = (await ann.get('/api/v1/player/used-lot')).body, b = (await ben.get('/api/v1/player/used-lot')).body;
  assert.ok(a.listings.length >= 6);
  assert.deepEqual(a.listings, b.listings, 'the same for everyone');
  const first = a.listings.find((l: any) => !['S', 'X', 'A'].includes(l.class));
  assert.equal((await act(cat, 'buyUsedCar', { listingId: first.id })).status, 200);
  const again = await act(cat, 'buyUsedCar', { listingId: first.id });
  assert.equal(again.status, 409); assert.match(again.body.error.message, /bought that one already/);
  now += DAY;
  const t = (await ann.get('/api/v1/player/used-lot')).body;
  assert.notEqual(t.day, a.day);
  assert.notDeepEqual(t.listings.map((l: any) => l.id), a.listings.map((l: any) => l.id), 'a new lot the next day');
  // yesterday's listing: gone
  const old = await act(ben, 'buyUsedCar', { listingId: a.listings.at(-1).id });
  assert.equal(old.status, 409); assert.match(old.body.error.message, /isn't on the lot today/);
});

test('a refund: once, only unused and as it came, only within its window', async () => {
  const p = await profile(cat), m0 = p.money;
  let r = await act(cat, 'buyPart', { partId: 'arb_front_street' });
  const id = r.body.instanceIds[0];
  assert.equal((await act(cat, 'refundPart', { instanceId: id })).status, 200);
  r = await act(cat, 'refundPart', { instanceId: id });
  assert.equal(r.status, 409, 'not twice');
  assert.equal((await profile(cat)).money, m0);
  // fitted, then taken off: used — sold, not refunded
  r = await act(cat, 'buyAndInstall', { carInstanceId: p.currentCar, partId: 'arb_rear_street' });
  const fitted = Object.values<any>(r.body.updatedState.parts).find(x => x.partId === 'arb_rear_street');
  await act(cat, 'removePart', { carInstanceId: p.currentCar, which: fitted.installedOn.socket });
  r = await act(cat, 'refundPart', { instanceId: fitted.instanceId });
  assert.equal(r.status, 409); assert.match(r.body.error.message, /fitted/);
  // past the window
  r = await act(cat, 'buyPart', { partId: 'strut_brace' });
  now += 31 * 60_000;
  r = await act(cat, 'refundPart', { instanceId: r.body.instanceIds[0] });
  assert.equal(r.status, 409); assert.match(r.body.error.message, /window/);
  await ledgerOk();
});

test('the garage\'s space can\'t be exceeded — not even with purchases at once', async () => {
  const dan = await signUp(T.app, T.outbox, { email: 'dan@example.com', name: 'Dan Diff', ip: '10.8.0.9' });
  await dan.get('/api/v1/player');
  await grant('dan@example.com', 500_000);
  assert.equal((await act(dan, 'buyCar', { carId: 'kaze_gt' })).status, 200);
  // two cars, room for three: five at once, one goes through
  const all = await Promise.all(['vortex_r', 'hana_roadster', 'brute_500', 'strada_evo', 'ridgeback_4x4'].map(id => act(dan, 'buyCar', { carId: id })));
  assert.equal(all.filter(r => r.status === 200).length, 1, all.map(r => r.status).join(','));
  for (const r of all.filter(r => r.status !== 200)) assert.match(r.body.error.message, /garage is full/);
  assert.equal(Object.keys((await profile(dan)).cars).length, 3);
  const lot = (await dan.get('/api/v1/player/used-lot')).body.listings.find((l: any) => !['S', 'X', 'A'].includes(l.class));
  assert.match((await act(dan, 'buyUsedCar', { listingId: lot.id })).body.error.message, /garage is full/);
  // more space: then it fits
  assert.equal((await act(dan, 'buyGarageSlot', {})).status, 200);
  assert.equal((await act(dan, 'buyUsedCar', { listingId: lot.id })).status, 200);
  await ledgerOk();
});

test('admin: the catalogue — changes are new versions, logged, reversible; players can\'t; tomorrow\'s lot previewed', async () => {
  // a player can't
  assert.equal((await ann.get('/api/v1/admin/shop/catalogue')).status, 403);
  assert.equal((await ann.post('/api/v1/admin/shop/catalogue', { change: { op: 'item', kind: 'part', id: 'cold_air_intake', set: { price: 1 } }, reason: 'cheap', basedOn: 1 })).status, 403);
  const c = (await admin.get('/api/v1/admin/shop/catalogue')).body;
  assert.ok(c.parts.length > 400 && c.cars.length === 8 && c.bundles.length >= 5);
  const v0 = c.version;
  const r = await shopChange({ op: 'item', kind: 'part', id: 'cold_air_intake', set: { price: 400 } }, 'Test: dearer intakes');
  assert.equal(r.status, 200, r.text);
  assert.equal((await act(ann, 'buyPart', { partId: 'cold_air_intake' })).body.cost, 400, 'the new price, at once');
  const log = (await T.app.deps.db.execute(sql`select action, reason from audit_log where action = 'shop-change' order by id desc limit 1`)).rows[0] as any;
  assert.equal(log.reason, 'Test: dearer intakes');
  // (a stale edit: refused)
  assert.equal((await admin.post('/api/v1/admin/shop/catalogue', { change: { op: 'bundle-remove', id: 'kit_handling' }, reason: 'Test: stale', basedOn: v0 })).status, 409);
  // rolled back: the old price again
  assert.equal((await admin.post(`/api/v1/admin/economy/config/${r.body.version - 1}/rollback`, { reason: 'Test: undo the price' })).status, 200);
  assert.equal((await act(ann, 'buyPart', { partId: 'cold_air_intake' })).body.cost, 350);
  // a kit added and removed
  assert.equal((await shopChange({ op: 'bundle', bundle: { id: 'kit_test', name: 'Test kit', parts: ['pads_street', 'brakes_street'], discount: 0.1 } })).status, 200);
  assert.ok((await admin.get('/api/v1/admin/shop/catalogue')).body.bundles.some((b: any) => b.id === 'kit_test'));
  assert.equal((await shopChange({ op: 'bundle', bundle: { id: 'kit_bad', name: 'Bad kit', parts: ['no_such_part', 'brakes_street'], discount: 0.1 } })).status, 400);
  // the lot: tomorrow's preview is tomorrow's lot
  const pv = (await admin.post('/api/v1/admin/shop/used-lot/preview', {})).body;
  now += DAY;
  assert.deepEqual((await ann.get('/api/v1/player/used-lot')).body.listings, pv.listings, 'tomorrow\'s preview is the lot tomorrow');
  // the dashboard
  const d = (await admin.get('/api/v1/admin/shop/dashboard?days=30')).body;
  assert.ok(d.top.length > 3 && d.byCategory.length > 2 && d.neverBought.count > 0, JSON.stringify(d).slice(0, 300));
});
