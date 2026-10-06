// The shop's rules (garage/shop.js, Phase 6 Step 4): prices, sales and locks, kits, what things sell for, the
// used lot (the same on a day, new the next), refunds — the rules the server charges by.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from '../harness.mjs';
import { offer, lockOf, sellValue, usedLot, usedShares, bundles, makerOf, refundable, bodyList, slotPrice, capacity } from '../../garage/shop.js';
import { repairCost } from '../../garage/player/profile.js';

const H = await harness(), db = H.db, t = Date.UTC(2026, 9, 6, 12);
const withShop = shop => ({ ...db, economy: { ...db.economy, shop: { ...db.economy.shop, ...shop } } });

test('prices: the part\'s own unless the catalogue says; the best sale while it\'s on; hidden and limited items not sold', () => {
  assert.equal(offer(db, 'part', 'cold_air_intake', t).price, 350);
  const d = withShop({ catalogue: { parts: { cold_air_intake: { price: 300 }, pads_sport: { hidden: true }, strut_brace: { until: new Date(t + 1000).toISOString() } }, cars: {} },
    sales: [{ id: 'a', name: 'A', starts: new Date(t - 1).toISOString(), ends: new Date(t + 1000).toISOString(), discount: 0.1, all: true }, { id: 'b', name: 'B', starts: new Date(t - 1).toISOString(), ends: new Date(t + 1000).toISOString(), discount: 0.3, categories: ['intake'] }] });
  const o = offer(d, 'part', 'cold_air_intake', t);
  assert.equal(o.list, 300); assert.equal(o.price, 210); assert.equal(o.sale.id, 'b', 'the best sale, not both');
  assert.equal(offer(d, 'part', 'cold_air_intake', t + 2000).price, 300, 'after the sale');
  assert.equal(offer(d, 'part', 'pads_sport', t).forSale, false);
  assert.equal(offer(d, 'part', 'strut_brace', t).forSale, true);
  assert.equal(offer(d, 'part', 'strut_brace', t + 2000).forSale, false);
});

test('locks: a race part needs level 5, an S-class car level 6; a series; what unlocks it in words', () => {
  const rule = offer(db, 'part', 'intake_race', t).unlock;
  assert.deepEqual(rule, { level: 5 });
  assert.match(lockOf(db, { xp: 0 }, rule).text, /reach level 5 \(you're level 1\)/);
  assert.equal(lockOf(db, { xp: 1e7 }, rule), null);
  assert.deepEqual(offer(db, 'car', 'apex_v8', t).unlock, { level: 6 });
  const s = lockOf(db, { xp: 1e7 }, { series: 'series_abcd', seriesName: 'Docks' });
  assert.match(s.text, /finish the "Docks" series/);
  assert.equal(lockOf(db, { xp: 0, series: { series_abcd: { completed: '2026-10-01' } } }, { series: 'series_abcd' }), null);
});

test('selling: below what was paid and below the price now; less a share of the repairs, never below the floor', () => {
  const x = { partId: 'cold_air_intake', condition: 100, price: 350 };
  assert.equal(sellValue(db, x, t), 210);
  assert.ok(sellValue(db, { ...x, price: 175 }, t) < 175, 'bought in a sale: worth what was paid');
  for (const c of [0, 20, 40, 60, 80, 99]) {
    const worn = { ...x, condition: c }, v = sellValue(db, worn, t);
    assert.ok(v < 350 && v >= Math.round(350 * 0.6 * 0.1), `${c}%: ${v}`);
    // (repairing it only to sell it never pays)
    assert.ok(210 - repairCost(db, worn) <= v, `${c}%: repaired ${210 - repairCost(db, worn)} vs ${v}`);
  }
  for (const id of Object.keys(db.cars)) assert.ok(bodyList(db, id) >= 0);
});

test('the used lot: the same for the same day, a new one the next; each car\'s price shared out as what was paid', () => {
  const a = usedLot(db, '2026-10-06'), b = usedLot(db, '2026-10-06'), c = usedLot(db, '2026-10-07');
  assert.equal(a.length, db.economy.shop.usedLot.count);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.notEqual(JSON.stringify(a.map(l => l.carId + l.mileage)), JSON.stringify(c.map(l => l.carId + l.mileage)));
  for (const l of a) {
    const s = usedShares(db, l);
    assert.equal(Object.values(s).reduce((x, y) => x + y, 0), l.price);
    assert.ok(l.price < l.newPrice, `${l.id}: cheaper than new`);
    assert.ok(l.history[0].text === 'First registered' && l.mileage > 0);
  }
});

test('kits, makers, refunds, garage space', () => {
  const k = bundles(db, 'starter_car', t).find(x => x.id === 'kit_street_brakes');
  assert.equal(k.sum, 600); assert.equal(k.price, 552);
  assert.equal(k.copies.reduce((a, c) => a + c.paid, 0), 552, 'the parts\' shares add up to the price');
  assert.equal(makerOf(db, db.parts.stock_airbox), 'Factory');
  assert.equal(makerOf(db, db.parts.intake_race), 'Sackworks Racing');
  assert.equal(makerOf(db, db.parts.cold_air_intake), 'Airwerk');
  const fresh = { partId: 'x', condition: 100, price: 10, boughtAt: new Date(t).toISOString(), installedOn: null };
  assert.equal(refundable(db, fresh, t + 60_000), null);
  assert.match(refundable(db, { ...fresh, used: true }, t), /fitted/);
  assert.match(refundable(db, fresh, t + 31 * 60_000), /window/);
  assert.match(refundable(db, { ...fresh, boughtAt: undefined }, t), /bought new/);
  assert.equal(capacity(db, {}), 3); assert.equal(capacity(db, { garageSlots: 2 }), 5);
  assert.equal(slotPrice(db, {}), 10000); assert.equal(slotPrice(db, { garageSlots: 1 }), 15000); assert.equal(slotPrice(db, { garageSlots: 5 }), null);
});
