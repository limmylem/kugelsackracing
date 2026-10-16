// The Kaze GT's engine swaps need its cowl bonnet (the V8, with or without a blower on it, and the turbo four go
// through the stock one): bought with a swap, the shop fits it too; and a save from before, a swap under the stock
// bonnet, gets the cowl fitted free when it's checked (garage/player/profile.js checkProfile) — the swap and its
// engine stay, the stock bonnet goes to the inventory.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from '../harness.mjs';
import { LocalPlayerService } from '../../garage/player/service.js';
import { MemoryStorage } from '../../garage/player/storage.js';
import { checkProfile, garageStateOf } from '../../garage/player/profile.js';
import { Garage } from '../../garage/data.js';
import { fitWithNeeds } from '../../tools/content/balance.mjs';

const H = await harness(), db = H.db;

test('the Kaze GT\'s V8 swap: the cowl bonnet comes with it; a save from before gets one free', async () => {
  const needs = fitWithNeeds(db, 'kaze_gt', 'brute_500_engine');
  assert.ok(needs.ok, needs.error);
  assert.ok(needs.order.includes('kaze_gt_bonnet_cowl'), `the shop fits the cowl with the swap: ${needs.order.join(', ')}`);
  // a player's Kaze GT with the swap
  const s = new LocalPlayerService({ db, storage: new MemoryStorage() });
  await s.init(); await s.addXp(1e7); await s.addMoney(1e7);
  const b = await s.buyCar('kaze_gt'); assert.ok(b.ok, b.error);
  const car = b.carInstanceId;
  for (const id of needs.order) { const r = await s.buyPart(id); assert.ok(r.ok, `${id}: ${r.error}`); const f = await s.installPart(car, r.instanceIds[0], { auto: true }); assert.ok(f.ok, `${id}: ${f.error}`); }
  const on = p => Object.values(p.parts).find(x => x.installedOn?.car === car && db.parts[x.partId]?.slot === 'bonnet')?.partId;
  assert.equal(on(s.profile), 'kaze_gt_bonnet_cowl');
  // as a save from before the cowl: the stock bonnet on, no cowl
  const old = structuredClone(s.profile);
  const cowl = Object.values(old.parts).find(x => x.partId === 'kaze_gt_bonnet_cowl'), stock = Object.values(old.parts).find(x => x.partId === 'kaze_gt_bonnet');
  stock.installedOn = { ...cowl.installedOn }; delete old.parts[cowl.instanceId];
  const r = checkProfile(old, db);
  assert.equal(on(r.profile), 'kaze_gt_bonnet_cowl', r.notices.join(' | '));
  assert.ok(Object.values(r.profile.parts).some(x => x.partId === 'kaze_gt_bonnet' && !x.installedOn), 'the stock bonnet in the inventory');
  assert.ok(r.notices.some(n => /Cowl bonnet \(Kaze GT\).*free/.test(n)), r.notices.join(' | '));
  const g = new Garage(db, { ...garageStateOf(r.profile, db), current: car });
  assert.equal(db.parts[r.profile.parts[g.build.sockets.socket_engine]?.partId]?.id, 'brute_500_engine', 'the V8 stays');
  assert.ok(g.drivable().ok, g.drivable().reasons.join('; '));
  assert.equal(r.refunded, 0);
});
