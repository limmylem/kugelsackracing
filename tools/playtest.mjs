// A playtest without a player: an upgrade journey (a plan of steps: buy, fit, tune, earn money…) played
// through the player service as the game would, with the playtest log (garage/playtest.js) recording
// each change — money spent, the performance rating and the Step 6 test results after it — printed as
// a table and written to reports/playtest.csv, to see how the journey feels.
//
//   npm run playtest                       the default journey (below): cheapest upgrades first
//   npm run playtest -- plan.json          a plan of your own: [{ "earn": 3000 }, { "buy": "cold_air_intake" },
//                                          { "fit": "cold_air_intake" }, { "tune": ["sport_suspension", "rideHeight", -20] }, …]
//   npm run playtest -- --no-tests         only the ratings (quicker)

import fs from 'node:fs';
import path from 'node:path';
import { harness } from '../tests/harness.mjs';
import { LocalPlayerService } from '../garage/player/service.js';
import { MemoryStorage } from '../garage/player/storage.js';
import { PlaytestLog, PLAYTEST_TESTS, toCsv } from '../garage/playtest.js';
import { ROOT } from './content/rules.mjs';

const args = process.argv.slice(2), planFile = args.find(a => a.endsWith('.json')), tests = !args.includes('--no-tests');
const H = await harness(), db = H.db;
// the default journey: winnings between races, spent on the upgrade that does most for the money
// (street first, then sport, then race), until everything's fitted
const DEFAULT = [
  { earn: 0, note: 'a new player: the starting money' },
  { buy: 'tyre_205_50r15' }, { fit: 'tyre_205_50r15' }, { buy: 'ecu_stage1' }, { fit: 'ecu_stage1' }, { buy: 'intake_filter_street' }, { fit: 'intake_filter_street' },
  { buy: 'weight_rear_seats' }, { fit: 'weight_rear_seats' }, { buy: 'pads_street' }, { fit: 'pads_street' }, { buy: 'springs_sport' }, { fit: 'springs_sport' },
  { earn: 4000 }, { buy: 'tyre_195_50r15' }, { fit: 'tyre_195_50r15' }, { buy: 'cold_air_intake' }, { fit: 'cold_air_intake' }, { buy: 'header_4into1' }, { fit: 'header_4into1' }, { sell: 'intake_filter_street' },
  { earn: 6000 }, { buy: 'front_mount_intercooler' }, { fit: 'front_mount_intercooler' }, { buy: 'turbo_kit' }, { fit: 'turbo_kit' },
  { earn: 6000 }, { buy: 'ecu_stage2' }, { fit: 'ecu_stage2' }, { buy: 'basic_wing' }, { fit: 'basic_wing' }, { buy: 'flywheel_light' }, { fit: 'flywheel_light' }, { buy: 'gearbox_close_ratio' }, { fit: 'gearbox_close_ratio' },
  { earn: 12000 }, { buy: 'pistons_forged' }, { fit: 'pistons_forged' }, { buy: 'clutch_sport' }, { fit: 'clutch_sport' }, { buy: 'turbo_medium' }, { fit: 'turbo_medium' }, { buy: 'tyre_215_40r15' }, { fit: 'tyre_215_40r15' },
  { earn: 12000 }, { buy: 'ecu_standalone' }, { fit: 'ecu_standalone' }, { buy: 'gearbox_seq6' }, { fit: 'gearbox_seq6' }, { buy: 'wing_gt' }, { fit: 'wing_gt' }, { tune: ['wing_gt', 'angle', 18] },
];
const plan = planFile ? JSON.parse(fs.readFileSync(planFile, 'utf8')) : DEFAULT;

const service = new LocalPlayerService({ db, storage: new MemoryStorage() });
await service.init();
const runTests = async spec => { const r = H.run(spec, PLAYTEST_TESTS); return Object.fromEntries(PLAYTEST_TESTS.map(id => [id, r[id].value == null ? null : +r[id].value.toFixed(id === 'skidpad' ? 3 : 2)])); };
const log = new PlaytestLog({ service, db, runTests: tests ? runTests : null });
log.start();
const car = () => service.profile.currentCar, copy = id => Object.values(service.profile.parts).filter(p => p.partId === id).sort((a, b) => !!a.installedOn - !!b.installedOn)[0];
for (const step of plan) {
  let r;
  if (step.earn != null) { if (step.earn) r = await service.addMoney(step.earn); else continue; }
  else if (step.buy) r = await service.buyPart(step.buy);
  else if (step.fit) r = copy(step.fit) ? await service.installPart(car(), copy(step.fit).instanceId) : { ok: false, error: `no ${step.fit} to fit` };
  else if (step.sell) r = copy(step.sell) ? await service.sellPart(copy(step.sell).instanceId) : { ok: false, error: `no ${step.sell} to sell` };
  else if (step.repair) r = await service.repairPart(copy(step.repair)?.instanceId);
  else if (step.tune) { const [id, setting, value] = step.tune; r = await service.setTuning(Object.values(service.profile.parts).find(p => p.partId === id && p.installedOn)?.instanceId, { [setting]: value }); }
  if (r && !r.ok) console.log(`  ✘ ${JSON.stringify(step)}: ${r.error}`);
}
await log.settled();
log.stop();

// the table
const pad = (v, n) => String(v ?? '—').padStart(n), E = log.entries;
console.log(`\n${'#'.padStart(3)}  ${'spent'.padStart(7)} ${'money'.padStart(7)}  ${'rating'.padEnd(7)} ${'hp'.padStart(5)} ${'kg'.padStart(6)}   ${'0–100'.padStart(6)} ${'100–0'.padStart(6)} ${'skid g'.padStart(7)} ${'lap'.padStart(7)}  what happened`);
for (const e of E) {
  const t = e.tests ?? {};
  console.log(`${pad(e.n, 3)}  ${pad(`$${e.spent}`, 7)} ${pad(`$${e.money}`, 7)}  ${(e.rating ? `${e.rating.class} ${e.rating.index}` : '—').padEnd(7)} ${pad(e.power, 5)} ${pad(e.mass, 6)}   ${pad(t.zeroTo100, 6)} ${pad(t.braking, 6)} ${pad(t.skidpad, 7)} ${pad(t.lap, 7)}  ${e.text}`);
}
const out = path.join(ROOT, 'reports/playtest.csv');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, toCsv(E));
const last = E.at(-1), first = E[0];
console.log(`\n${E.length} entries → reports/playtest.csv. From class ${first.rating.class} ${first.rating.index} to ${last.rating.class} ${last.rating.index} for $${last.spent.toLocaleString('en-GB')} spent${first.tests && last.tests ? `: 0–100 ${first.tests.zeroTo100} → ${last.tests.zeroTo100} s, lap ${first.tests.lap} → ${last.tests.lap} s` : ''}.`);
