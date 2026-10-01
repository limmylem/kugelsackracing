// Unit tests for the playtest log (garage/playtest.js): each change the player service makes, in
// words, with the money spent, the rating and the Step 6 results (run once per build), kept in the
// store it's given and ready as a spreadsheet.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from '../harness.mjs';
import { LocalPlayerService } from '../../garage/player/service.js';
import { MemoryStorage } from '../../garage/player/storage.js';
import { PlaytestLog, toCsv } from '../../garage/playtest.js';

const H = await harness(), db = H.db;
const memoryStore = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('the playtest log: every change in words, money spent, the rating, and the Step 6 results once per build', async () => {
  const service = new LocalPlayerService({ db, storage: new MemoryStorage() });
  await service.init();
  const runs = [], store = memoryStore();
  const log = new PlaytestLog({ service, db, store, runTests: async spec => { runs.push(spec.mass); return { zeroTo100: 9, braking: 40, skidpad: 0.84, lap: 77 }; } });
  log.start();
  const car = service.profile.currentCar, copy = id => Object.values(service.profile.parts).find(p => p.partId === id);
  await service.buyPart('tyre_205_50r15');
  await service.installPart(car, copy('tyre_205_50r15').instanceId);
  await service.buyPart('ecu_stage1');
  await service.installPart(car, copy('ecu_stage1').instanceId);
  await service.sellPart(copy('stock_ecu').instanceId);
  await service.addMoney(1000);
  await log.settled();
  const texts = log.entries.map(e => e.text);
  assert.deepEqual(texts, [
    'Playtest started',
    'bought 4 × 205/50 R15 street tyre',
    'fitted 4 × 205/50 R15 street tyre; took off 4 × 180/55 R15 road tyre (stock)',
    'bought Stage 1 ECU map',
    'fitted Stage 1 ECU map; took off Engine control unit (stock)',
    'sold Engine control unit (stock) for $108',
    'earned $1,000',
  ]);
  const last = log.entries.at(-1);
  assert.equal(last.spent, 85 * 4 + 450);
  assert.equal(last.earned, 108 + 1000);
  assert.equal(last.money, 6000 - 340 - 450 + 108 + 1000);
  assert.ok(log.entries[2].rating.index > log.entries[1].rating.index, 'the street tyres raise the rating');
  assert.deepEqual(last.upgrades, ['ecu_stage1', 'tyre_205_50r15']);
  assert.equal(runs.length, 3, 'the tests run once per build (stock, tyres, tyres and ECU)');
  assert.ok(log.entries.every(e => e.tests?.lap === 77));
  // kept in the store, as a spreadsheet too
  assert.equal(JSON.parse(store.getItem('driveWorld.playtest.log')).length, 7);
  const csv = log.csv().trim().split('\n');
  assert.equal(csv.length, 8);
  assert.match(csv[0], /^n,at,text,money,spent/);
  // stopped: nothing more is logged
  log.stop();
  await service.addMoney(5);
  assert.equal(log.entries.length, 7);
  assert.equal(toCsv([]).trim().split('\n').length, 1);
});
