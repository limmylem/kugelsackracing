// The crash test suite (garage/crashSuite.js) from the command line: every crash in its targets
// (tests/targets/crash.json), headless, each outcome next to what it should be, what fixing each costs
// against the race rewards, and exit code 1 if any is off target — so the damage balance is guarded
// whenever the rules or the physics change (CI runs it).
//
//   npm run crash-test                    every crash
//   npm run crash-test -- --only wall-60  the crashes whose id starts so (repeat for more)
//   npm run crash-test -- --json out.json also write the outcomes as JSON
//   npm run crash-test -- --verbose       every outcome in full

import fs from 'node:fs';
import { harness, crashContext } from './harness.mjs';
import { crashEconomy, crashRuns, evaluateCrashes, runCrash } from '../garage/crashSuite.js';

const args = process.argv.slice(2), opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const only = args.flatMap((a, i) => a === '--only' ? [args[i + 1]] : []), verbose = args.includes('--verbose');
const H = await harness(), ctx = await crashContext(), T = ctx.targets;
const runs = crashRuns(T).filter(r => !only.length || only.some(o => r.id.startsWith(o)));
console.log(`\nThe crash test suite: ${runs.length} crashes, ${H.db.cars[T.car].name}\n`);
const t0 = performance.now(), results = [];
for (const run of runs) {
  const r = runCrash(ctx, run, T);
  results.push(r);
  if (verbose) console.log(`  ${run.id}: ${JSON.stringify(r.cars)}`);
}
const rows = evaluateCrashes(results, T), failed = rows.filter(r => !r.pass);
const money = n => `${H.db.economy.currency}${Math.round(n).toLocaleString('en-GB')}`;
for (const row of rows) {
  const o = row.cars?.[0], b = row.cars?.[1];
  const show = x => x ? `${x.strength.toFixed(1).padStart(5)} m/s · ${x.mechanical.padEnd(5)} · ${x.drivable ? 'drivable  ' : 'race over '} · ${(x.loose.length || x.detached.length) ? `${[...x.loose.map(s => `${s.replace('socket_', '')} loose`), ...x.detached.map(s => `${s.replace('socket_', '')} off`)].join(', ')} · ` : ''}fix ${money(x.repair.quick)} / ${money(x.repair.full)}` : '';
  console.log(`${row.pass ? '  ok  ' : ' FAIL '} ${row.name.padEnd(48)} ${o ? show(o) : row.share != null ? `${Math.round(row.share * 100)}% drivable` : ''}${b ? `\n${''.padEnd(56)}other car: ${show(b)}` : ''}`);
  for (const p of row.problems) console.log(`         ✘ ${p}`);
}
console.log(`\nWhat a crash costs to fix (quick / full), against a win's ${money(H.db.economy.raceRewards?.win ?? 0)}:`);
for (const e of crashEconomy(results, H.db)) console.log(`  ${(e.kind === 'wall' ? 'into the wall' : 'into a car').padEnd(14)} ${String(e.kmh).padStart(3)} km/h  ${money(e.quick).padStart(7)} / ${money(e.full).padStart(7)}  ${e.ofWin != null ? `${Math.round(e.ofWin * 100)}% of a win` : ''} · ${Math.round(e.drivable * 100)}% still drivable`);
console.log(`\n${rows.length - failed.length} of ${rows.length} on target in ${((performance.now() - t0) / 1000).toFixed(1)} s${failed.length ? ` — off target: ${failed.map(r => r.id).join(', ')}` : ''}\n`);
if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify({ when: new Date().toISOString(), rows, economy: crashEconomy(results, H.db) }, null, 2));
process.exit(failed.length ? 1 : 0);
