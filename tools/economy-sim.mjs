// The economy simulation (Phase 4 Step 5): a bot at each skill level (data/economy.json simulation.skills)
// plays for hours from a fresh start — quests, crashes and repairs, upgrades and cars — on the game's own
// rules, and the targets (simulation.targets) are checked: the balance report as text here and in
// reports/economy.txt, and as a page with charts in reports/economy.html. docs/PROGRESSION.md says how to read
// it and what to tune.
//
//   npm run economy-sim [-- --hours 8] [--seed 7] [--out reports] [--no-fail]
//   exits with code 1 if a target isn't met (--no-fail: 0 anyway)

import fs from 'node:fs';
import path from 'node:path';
import { harness } from '../tests/harness.mjs';
import { makePool, simulate, crashCostTable } from './economy/sim.mjs';
import { evaluate, textReport, htmlReport } from './economy/report.mjs';

const args = process.argv.slice(2), opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const ROOT = new URL('..', import.meta.url).pathname;
const H = await harness(), db = H.db, config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/quests.json'), 'utf8'));
const S = db.economy.simulation, hours = +(opt('--hours') ?? S.hours), seed = +(opt('--seed') ?? S.seed), outDir = path.resolve(opt('--out') ?? path.join(ROOT, 'reports'));
console.log('Measuring crash repairs (the crash test suite, every car)…');
const crashTable = await crashCostTable();
const pool = makePool(db.economy, config, seed);
const runs = {};
for (const [name, skill] of Object.entries(S.skills)) {
  const t0 = performance.now();
  runs[name] = simulate({ db, config, pool, crashTable, skill, hours, seed });
  console.log(`  ${name} (skill ${skill}): ${runs[name].runs} quests in ${hours} h simulated (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
}
const checks = evaluate(runs, db.economy), text = textReport(runs, checks, db.economy);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'economy.txt'), text + '\n');
fs.writeFileSync(path.join(outDir, 'economy.html'), htmlReport(runs, checks, db.economy));
console.log(`\n${text}\n\nReport: ${path.relative(ROOT, path.join(outDir, 'economy.txt'))}, ${path.relative(ROOT, path.join(outDir, 'economy.html'))}`);
process.exit(checks.every(c => c.pass) || args.includes('--no-fail') ? 0 : 1);
