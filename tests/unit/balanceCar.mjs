// One car's balance, for tests/unit/balance.test.mjs (run in a worker thread: the most powerful build
// takes a while): its class stock and fully upgraded, the tier rules on its parts, the report's flags.
import { parentPort, workerData } from 'node:worker_threads';
import { Garage } from '../../garage/data.js';
import { released } from '../../garage/content.js';
import { balanceRows, tierProblems } from '../../tools/content/balance.mjs';
import { maxBuild } from '../../tools/content/maxbuild.mjs';
import { classProblems } from '../../tools/content/classes.mjs';
import { loadProject } from '../../tools/content/project.mjs';
import { readJson } from '../../tools/content/rules.mjs';

export async function carBalance(carId) {
  const { db } = await loadProject(), tiers = readJson('data/content/tiers.json'), rules = readJson('data/content/balance.json');
  // (the class limits for what players can have: published parts — a draft that would break them is held back by the
  // content checks, npm run content -- check, until it doesn't)
  const stock = new Garage(db, null, carId).stats().totals.rating, max = maxBuild(db, carId, { forSale: p => !p.retired && !p.todo?.length && released(p) });
  const { rows } = balanceRows(db, carId, tiers);
  // (a new part still to be priced — marked todo, so the shop doesn't sell it yet — flagged for nothing else)
  const unfinished = r => db.parts[r.id]?.todo?.length && r.flags.every(f => f.startsWith('to do:'));
  return {
    carId, stock: { class: stock.class, index: stock.index }, max: { class: max.rating.class, index: max.rating.index, parts: max.parts, drivable: max.garage.drivable().ok, valid: max.garage.validate().ok },
    classes: classProblems(db, carId, rules, { stock, max: max.rating }),
    tiers: tierProblems(db, tiers, carId).map(p => `${p.id}: ${p.problem}`),
    flags: rows.filter(r => r.flags.length && !unfinished(r)).map(r => `${r.id}: ${r.flags.join('; ')}`), unfinished: rows.filter(unfinished).map(r => r.id), rows: rows.length,
  };
}
if (parentPort && workerData?.carId) parentPort.postMessage(await carBalance(workerData.carId));
