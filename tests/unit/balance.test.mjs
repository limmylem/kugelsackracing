// Balance tests for every car (data/content/tiers.json, data/content/balance.json, tools/content/
// balance.mjs): each car is its own class stock (car.json class); the most powerful valid build there is
// for it — found automatically, every part and every setting — is at most maxClassJump classes higher
// (the exempt cars aside: the supercar); parts in a tier are priced and perform by the tier's rules (a
// car's own parts on it, parts for every car on the starter car); in every slot a dearer part does more
// than a cheaper one; and the balance report flags nothing. Each car in its own worker thread.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { loadProject } from '../../tools/content/project.mjs';
import { readJson } from '../../tools/content/rules.mjs';

const { db } = await loadProject(), rules = readJson('data/content/balance.json'), order = db.classes.classes.map(c => c.class);
const run = carId => new Promise((resolve, reject) => {
  const w = new Worker(new URL('./balanceCar.mjs', import.meta.url), { workerData: { carId } });
  w.once('message', resolve); w.once('error', reject);
});
const results = Object.fromEntries(await Promise.all(Object.keys(db.cars).map(async id => [id, await run(id)])));

for (const [id, r] of Object.entries(results)) {
  const car = db.cars[id];
  test(`${car.name}: class ${car.class} stock; fully upgraded at most ${rules.maxClassJump} classes up${rules.exempt.includes(id) ? ' (exempt: it\'s at the top already)' : ''}`, () => {
    assert.equal(r.stock.class, car.class, `stock rating ${r.stock.index}`);
    assert.ok(r.max.drivable && r.max.valid, 'the most powerful build is a valid car that can be driven');
    assert.ok(r.max.parts.length >= 5, `a lot of it upgraded (${r.max.parts.join(', ')})`);
    if (!rules.exempt.includes(id)) assert.ok(order.indexOf(r.max.class) - order.indexOf(car.class) <= rules.maxClassJump, `fully upgraded: class ${r.max.class} (${r.max.index}) — ${r.max.parts.join(', ')}`);
    assert.deepEqual(r.classes, []);
  });
  test(`${car.name}: its parts follow their tier's rules, a dearer part in a slot does more, and the balance report flags nothing (but new parts still to be priced, which aren't for sale)`, (t) => {
    assert.deepEqual(r.tiers, []);
    assert.deepEqual(r.flags, []);
    if (r.unfinished.length) t.diagnostic(`still to be priced (not for sale): ${r.unfinished.join(', ')}`);
    assert.ok(r.rows >= 60, `${r.rows} parts for it`);
  });
}

test('every part has a tier, and the class rules are as the config says', () => {
  for (const p of Object.values(db.parts)) assert.ok(p.tier, `${p.id} has a tier`);
  assert.equal(rules.maxClassJump, 2);
  assert.deepEqual(rules.exempt, ['apex_v8']);
});
