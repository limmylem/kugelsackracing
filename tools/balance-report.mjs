// The balance report: every part on every car (or --car id) — price, mass, what it does to the stats,
// value for money — as a spreadsheet per car (reports/balance-<car>.csv), with outliers and unfinished
// parts flagged here and in the file's flags column; and each car's class, stock and fully upgraded,
// against the class rules (data/content/balance.json: its own class stock, at most maxClassJump
// classes higher fully upgraded). See tools/content/balance.mjs.
//
//   npm run balance-report  [-- --car starter_car] [--out reports]
//   exits with code 1 if anything is flagged (--no-fail: 0 anyway)

import path from 'node:path';
import fs from 'node:fs';
import { balanceRows, toCsv } from './content/balance.mjs';
import { maxBuild } from './content/maxbuild.mjs';
import { readJson } from './content/rules.mjs';
import { loadProject } from './content/project.mjs';
import { ROOT, rel } from './content/rules.mjs';
import { classProblems } from './content/classes.mjs';

const args = process.argv.slice(2), opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const only = opt('--car'), outDir = path.resolve(opt('--out') ?? path.join(ROOT, 'reports'));
const { db } = await loadProject();
if (only && !db.cars[only]) { console.error(`No car "${only}".`); process.exit(2); }
const tiers = readJson('data/content/tiers.json'), rules = readJson('data/content/balance.json');
let flaggedAll = 0;
fs.mkdirSync(outDir, { recursive: true });
for (const carId of only ? [only] : Object.keys(db.cars)) {
  const { stock, rows } = balanceRows(db, carId, tiers), max = maxBuild(db, carId), out = path.join(outDir, `balance-${carId}.csv`);
  fs.writeFileSync(out, toCsv(rows));
  const r = stock.totals.rating, m = max.garage.stats(), car = db.cars[carId];
  console.log(`\n${car.name}${car.class ? ` (class ${car.class})` : ''}, stock: class ${r.class} ${r.index} · ${Math.round(stock.totals.peakPower.hp)} hp · ${Math.round(stock.spec.mass)} kg`);
  console.log(`fully upgraded: class ${max.rating.class} ${max.rating.index} · ${Math.round(m.totals.peakPower.hp)} hp · ${Math.round(m.spec.mass)} kg · 0–100 ${m.totals.rating.estimates.zeroTo100.toFixed(1)} s · ${m.totals.rating.estimates.grip.toFixed(2)} g (${max.parts.length} parts${max.tuning.length ? `; ${max.tuning.map(t => `${t.part} ${t.setting} ${t.value}`).join(', ')}` : ''})`);
  console.log(`${rows.length} parts → ${rel(out)}`);
  const flagged = rows.filter(x => x.flags.length), classes = classProblems(db, carId, rules, { stock: r, max: max.rating });
  for (const x of flagged) console.log(`  ${x.id.padEnd(30)} ${x.flags.join(' · ')}`);
  for (const c of classes) console.log(`  class: ${c}`);
  flaggedAll += flagged.length + classes.length;
}
console.log(flaggedAll ? `\n${flaggedAll} problem${flaggedAll > 1 ? 's' : ''} flagged.` : '\nNothing flagged: no outliers, nothing to do, every car in its class.');
process.exit(flaggedAll && !args.includes('--no-fail') ? 1 : 0);
