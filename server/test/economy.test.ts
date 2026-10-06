// The server-owned economy (Phase 6 Step 2): a new player's starting money in the ledger; the garage through
// the server (buy, fit, take off, sell); money that can only be spent once however many ask at once; a part
// in one place; tampered and made-up requests refused; the ledger always equal to the balances.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { testApp, Player, signUp } from './helpers.ts';

let T: Awaited<ReturnType<typeof testApp>>, ann: Player, ben: Player, admin: Player;
const act = (p: Player, action: string, args: object, o: object = {}) => p.post(`/api/v1/player/actions/${action}`, { args }, o);
const money = async (p: Player) => (await p.get('/api/v1/player')).body.profile.money as number;
const idOf = async (email: string) => ((await T.app.deps.db.execute(sql`select id from users where email = ${email}`)).rows[0] as any).id as string;
// (the database's own words, under the query's wrapper)
const dbRefuses = (q: Promise<unknown>, re: RegExp) => assert.rejects(q, (e: any) => re.test(`${e.message} ${e.cause?.message ?? ''}`));
const ledgerOk = async () => assert.deepEqual(await T.app.economy.ledgerCheck(), [], 'every balance equals its ledger');

before(async () => {
  T = await testApp('economy');
  [ann, ben, admin] = await Promise.all([
    signUp(T.app, T.outbox, { email: 'ann@example.com', name: 'Ann Apex', ip: '10.6.0.1' }),
    signUp(T.app, T.outbox, { email: 'ben@example.com', name: 'Ben Brake', ip: '10.6.0.2' }),
    signUp(T.app, T.outbox, { email: 'adm@example.com', name: 'The Admin', ip: '10.6.0.3' }),
  ]);
  await T.app.deps.db.execute(sql`update users set role = 'admin' where email = 'adm@example.com'`);
});
after(async () => { await T?.close(); });

test('a new player: the starting car and money, the money a ledger row', async () => {
  const r = await ann.get('/api/v1/player');
  assert.equal(r.status, 200, r.text);
  const p = r.body.profile;
  assert.equal(p.money, 6000);
  assert.equal(Object.keys(p.cars).length, 1);
  assert.ok(Object.values<any>(p.parts).some(x => x.installedOn), 'the stock parts fitted');
  const L = (await ann.get('/api/v1/player/ledger')).body.entries;
  assert.equal(L.length, 1); assert.equal(L[0].kind, 'start'); assert.equal(L[0].amount, 6000); assert.equal(L[0].balanceAfter, 6000);
  // (asking again makes nothing new)
  assert.equal((await ann.get('/api/v1/player/ledger')).body.entries.length, 1);
  assert.equal((await ann.get('/api/v1/player')).body.profile.money, 6000);
  await ledgerOk();
});

test('the garage through the server: buy, fit, take off, sell — the price the server\'s, every change in the ledger', async () => {
  const before = await money(ann);
  const b = await act(ann, 'buyPart', { partId: 'cold_air_intake' });
  assert.equal(b.status, 200, b.text);
  assert.equal(b.body.updatedState.money, before - 350);
  const id = b.body.instanceIds[0], car = b.body.updatedState.currentCar;
  const fit = await act(ann, 'installPart', { carInstanceId: car, instanceId: id });
  assert.equal(fit.status, 200, fit.text);
  assert.deepEqual(fit.body.updatedState.parts[id].installedOn?.car, car);
  const slot = (await T.app.deps.db.execute(sql`select socket from car_build_slots where part_instance_id = ${id}`)).rows;
  assert.equal(slot.length, 1, 'the build in its table');
  // (selling it while it's on: refused, in plain words)
  const onCar = await act(ann, 'sellPart', { instanceId: id });
  assert.equal(onCar.status, 409); assert.equal(onCar.body.error.code, 'REFUSED'); assert.match(onCar.body.error.message, /take it off before you sell it/);
  const off = await act(ann, 'removePart', { carInstanceId: car, which: fit.body.updatedState.parts[id].installedOn.socket });
  assert.equal(off.status, 200, off.text);
  const sold = await act(ann, 'sellPart', { instanceId: id });
  assert.equal(sold.status, 200, sold.text);
  assert.ok(sold.body.amount > 0 && sold.body.amount < 350);
  const L = (await ann.get('/api/v1/player/ledger')).body.entries;
  assert.deepEqual(L.slice(0, 2).map((e: any) => [e.kind, e.amount]), [['sale', sold.body.amount], ['purchase', -350]]);
  assert.match(L[1].reason, /Bought Cold Air Intake/i);
  const hist = (await T.app.deps.db.execute(sql`select event from item_history where instance_id = ${id} order by id`)).rows.map((r: any) => r.event);
  assert.ok(hist.length >= 4, hist.join(', '));
  await ledgerOk();
});

test('double spend: 50 purchases at once with money for one — exactly one goes through', async () => {
  const uid = await idOf('ben@example.com');
  await ben.get('/api/v1/player');
  // (an admin leaves them exactly enough for one)
  const now = await money(ben);
  const r = await admin.post(`/api/v1/admin/players/${uid}/money`, { amount: 780 - now, reason: 'Test: exactly one sport exhaust' });
  assert.equal(r.status, 200, r.text);
  assert.equal(await money(ben), 780);
  const all = await Promise.all(Array.from({ length: 50 }, () => act(ben, 'buyPart', { partId: 'catback_sport' })));
  const ok = all.filter(x => x.status === 200), no = all.filter(x => x.status !== 200);
  assert.equal(ok.length, 1, all.map(x => x.status).join(','));
  for (const x of no) { assert.equal(x.status, 409); assert.match(x.body.error.message, /Not enough money/); }
  assert.equal(await money(ben), 0);
  const parts = Object.values<any>((await ben.get('/api/v1/player')).body.profile.parts).filter(p => p.partId === 'catback_sport');
  assert.equal(parts.length, 1);
  await ledgerOk();
});

test('a part in one place: fitted to two cars at once, or sold ten times at once — once', async () => {
  const uid = await idOf('ann@example.com');
  await admin.post(`/api/v1/admin/players/${uid}/money`, { amount: 30000, reason: 'Test: a second car' });
  const car2 = (await act(ann, 'buyCar', { carId: 'kaze_gt' })).body.carInstanceId;
  assert.ok(car2);
  const p = (await ann.get('/api/v1/player')).body.profile, car1 = p.currentCar;
  const part = (await act(ann, 'buyPart', { partId: 'intake_filter_street' })).body.instanceIds[0];
  const [a, b] = await Promise.all([act(ann, 'installPart', { carInstanceId: car1, instanceId: part }), act(ann, 'installPart', { carInstanceId: car2, instanceId: part })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], `${a.text} ${b.text}`);
  const where = (await T.app.deps.db.execute(sql`select car_instance_id from car_build_slots where user_id = ${uid} and part_instance_id = ${part}`)).rows;
  assert.equal(where.length, 1);
  // (the database too: a second place for it is refused outright)
  await assert.rejects(T.app.deps.db.execute(sql`insert into car_build_slots (user_id, car_instance_id, socket, part_instance_id) values (${uid}, ${(where[0] as any).car_instance_id === car1 ? car2 : car1}, 'intake', ${part})`));
  // ten sales of one spare at once
  const spare = (await act(ann, 'buyPart', { partId: 'intake_filter_street' })).body.instanceIds[0], m0 = await money(ann);
  const sales = await Promise.all(Array.from({ length: 10 }, () => act(ann, 'sellPart', { instanceId: spare })));
  assert.equal(sales.filter(x => x.status === 200).length, 1);
  assert.equal(await money(ann), m0 + sales.find(x => x.status === 200)!.body.amount);
  await ledgerOk();
});

test('tampered requests: a price, someone else\'s part, a part that doesn\'t fit, negative amounts, made-up ids, the development commands, a replay', async () => {
  const p = (await ann.get('/api/v1/player')).body.profile, m0 = p.money, car = p.currentCar;
  // (a price, money, a stat: not something a request can say)
  for (const args of [{ partId: 'cold_air_intake', price: 1 }, { partId: 'cold_air_intake', cost: 0 }, { partId: 'cold_air_intake', quantity: -3 }, { partId: 'cold_air_intake', quantity: 1.5 }, { partId: '../../etc/passwd' }]) {
    const r = await act(ann, 'buyPart', args);
    assert.equal(r.status, 400, `${JSON.stringify(args)}: ${r.text}`);
  }
  // made up: a part that isn't, a car that isn't
  assert.equal((await act(ann, 'buyPart', { partId: 'golden_engine' })).status, 409);
  assert.equal((await act(ann, 'buyCar', { carId: 'free_ferrari' })).status, 409);
  assert.equal((await act(ann, 'sellPart', { instanceId: 'part_999999' })).status, 409);
  // someone else's things
  const benPart = Object.values<any>((await ben.get('/api/v1/player')).body.profile.parts)[0];
  const steal = await act(ann, 'sellPart', { instanceId: benPart.instanceId });
  assert.equal(steal.status, 409); assert.match(steal.body.error.message, /isn't yours|no part/i);
  const fitTheirs = await act(ann, 'installPart', { carInstanceId: car, instanceId: benPart.instanceId });
  assert.equal(fitTheirs.status, 409);
  // a part that doesn't fit this car
  const tyre = (await act(ann, 'buyPart', { partId: 'apex_v8_tyre', quantity: 1 })).body.instanceIds[0];
  const bad = await act(ann, 'installPart', { carInstanceId: car, instanceId: tyre });
  assert.equal(bad.status, 409, bad.text);
  // the development commands and save imports: not actions at all
  for (const a of ['addMoney', 'givePart', 'giveAllParts', 'setUnlimitedMoney', 'importSave', 'resetProfile', 'restoreCar', 'setCondition', 'setAttach', 'addXp']) {
    const r = await act(ann, a, { amount: 1e9 });
    assert.equal(r.status, 400, `${a}: ${r.status}`);
  }
  // a replay: the same Idempotency-Key — the answer again, charged once
  const key = crypto.randomUUID(), m1 = await money(ann);
  const once = await act(ann, 'buyPart', { partId: 'intake_filter_street' }, { key });
  const again = await act(ann, 'buyPart', { partId: 'intake_filter_street' }, { key });
  assert.equal(again.headers['idempotent-replayed'], 'true'); assert.deepEqual(again.body.instanceIds, once.body.instanceIds);
  assert.equal(await money(ann), m1 - 130);
  assert.ok(m0 > 0);
  await ledgerOk();
});

test('the ledger can\'t be edited, and the balance only moves through it; no balance below zero', async () => {
  const uid = await idOf('ann@example.com'), db = T.app.deps.db;
  await dbRefuses(db.execute(sql`update ledger set amount = 1000000 where user_id = ${uid}`), /never changed/);
  await dbRefuses(db.execute(sql`delete from ledger where user_id = ${uid}`), /never changed/);
  await dbRefuses(db.execute(sql`update player_economy set balance = 999999 where user_id = ${uid}`), /only changes through the ledger/);
  const bal = Number(((await db.execute(sql`select balance from player_economy where user_id = ${uid}`)).rows[0] as any).balance);
  await dbRefuses(db.execute(sql`insert into ledger (user_id, amount, balance_after, kind, reason) values (${uid}, ${-bal - 1}, -1, 'test', 'below zero')`), /check constraint|never_negative/);
  await dbRefuses(db.execute(sql`insert into ledger (user_id, amount, balance_after, kind, reason) values (${uid}, 5, ${bal + 6}, 'test', 'not following on')`), /doesn't follow on/);
  await ledgerOk();
});
