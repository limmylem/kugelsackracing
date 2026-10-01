// Headless test suite: runs the automated tests (physics/testSuite.js) at the test centre with no
// rendering, prints each result next to its target range (tests/targets/<carId>.json) and exits with code 1
// if any result is out of range, so it can guard the physics whenever it changes.
//
//   npm test                                  every test, the starter car
//   npm test -- --only skidpad,lap            just some
//   npm test -- --car starter_car             a car by id, built from its stock parts (the default)
//   npm test -- --install cold_air_intake     fit a part first (repeat --install for more)
//   npm test -- --remove socket_bonnet        take a part off (a socket, group or part id; repeatable)
//   npm test -- --tune sport_suspension:rideHeight=-30   a fitted part's setting (repeatable)
//   npm test -- --condition tyres=40          a fitted part's condition, 0–100 (repeatable)
//   npm test -- --car data/presets/soft.json  a preset saved in the tuning panel (its car's targets)
//   npm test -- --json results.json           also write the results as JSON
//   npm test -- --telemetry out               also save each test's telemetry as CSV in out/
//   npm test -- --set tyre.lateral.D=0.92     try a change to the car without editing its file
//                                             (repeat --set for more; arrays by index: gearbox.ratios.4=0.84)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';
import { TESTS, createRun, evaluate } from '../physics/testSuite.js';
import { socketsFromGlb } from '../physics/sockets.js';
import { Telemetry } from '../physics/telemetry.js';
import { Garage, loadGarageData } from '../garage/data.js';
import { changes, changesText, totalsText } from '../garage/report.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const sets = args.flatMap((a, i) => a === '--set' ? [args[i + 1]] : []);
const load = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));

const all = name => args.flatMap((a, i) => a === name ? [args[i + 1]] : []);
const carArg = opt('--car') || 'starter_car', installs = all('--install'), removes = all('--remove'), tunes = all('--tune'), conditions = all('--condition');
const only = opt('--only')?.split(',').map(s => s.trim()).filter(Boolean);
const telemetryDir = opt('--telemetry'), jsonOut = opt('--json');
for (const id of only || []) if (!TESTS.some(t => t.id === id)) { console.error(`No test "${id}". Tests: ${TESTS.map(t => t.id).join(', ')}`); process.exit(2); }

await RAPIER.init();
const settings = load('physics/settings.json'), track = load('scenes/test_centre.json');
// the car: built from its parts (data/cars, data/parts), or a flat spec file (a tuning preset)
let spec, carName, carLabel;
if (carArg.endsWith('.json')) {
  spec = load(carArg);
  carName = spec._base ?? path.basename(carArg, '.json');
  carLabel = carArg;
} else {
  const { db, problems } = await loadGarageData(async rel => load(rel));
  if (problems.length) { console.error(`The car and part data has problems (npm run check):\n${problems.map(p => `  ${p.file} ${p.path}: ${p.message}`).join('\n')}`); process.exit(2); }
  if (!db.cars[carArg]) { console.error(`There's no car "${carArg}". Cars: ${Object.keys(db.cars).join(', ')}`); process.exit(2); }
  const garage = new Garage(db, null, carArg), stock = garage.stats();
  const steps = [
    ...installs.map(id => [`fit ${id}`, () => garage.install(id)]),
    ...removes.map(x => [`take off ${x}`, () => garage.remove(x)]),
    ...tunes.map(t => { const m = t.match(/^([^:]+):([^=]+)=(.+)$/); return [`tune ${t}`, () => m ? garage.tune(m[1], m[2], +m[3]) : { ok: false, errors: [{ message: 'use --tune part:setting=value' }] }]; }),
    ...conditions.map(c => { const m = c.match(/^([^=]+)=(.+)$/); return [`condition ${c}`, () => m ? garage.setCondition(m[1], +m[2]) : { ok: false, errors: [{ message: 'use --condition which=value' }] }]; }),
  ];
  for (const [what, act] of steps) {
    const r = act();
    if (!r.ok) { console.error(`Can't ${what}:\n${r.errors.map(e => '  ' + e.message).join('\n')}`); process.exit(2); }
    for (const w of r.warnings) console.log(`  note: ${w.message}`);
  }
  const built = garage.stats();
  const drivable = garage.drivable();
  if (!drivable.ok || !built.spec) { console.error(`The car can't be driven like this:\n${[...drivable.reasons, ...built.errors].map(r => '  ' + r).join('\n')}`); process.exit(2); }
  spec = built.spec;
  carName = carArg;
  carLabel = `built from parts${steps.length ? `: ${steps.map(s => s[0]).join(', ')}` : ''}`;
  if (steps.length) console.log(`\n${spec.name}, ${steps.map(s => s[0]).join(', ')}:\n${changesText(changes(stock, built).filter(c => !c.path.startsWith('centreOfMass') && !c.path.startsWith('inertiaTensor')), built)}\n  ${totalsText(built.totals)}`);
  const R = built.totals.rating;
  if (R) console.log(`  rating ${R.index} (class ${R.class}) · fingerprint ${garage.build.fingerprint}`);
}
for (const set of sets) {
  const [key, raw] = set.split('='), keys = key.split('.'), last = keys.pop();
  let o = spec;
  for (const k of keys) { o = o?.[k]; }
  if (o == null || !(last in o)) { console.error(`--set: the car has no ${key}`); process.exit(2); }
  const value = typeof o[last] === 'number' ? +raw : typeof o[last] === 'boolean' ? raw === 'true' : raw;
  if (typeof o[last] === 'number' && !Number.isFinite(value)) { console.error(`--set: ${key} needs a number, not "${raw}"`); process.exit(2); }
  o[last] = value;
}
// a preset saved from the tuning panel says which car it's a setup of (_base): that car's targets
const targetsFile = `tests/targets/${spec._base ?? carName}.json`, targets = fs.existsSync(path.join(root, targetsFile)) ? load(targetsFile) : {};
const glb = fs.readFileSync(path.join(root, spec.model.file));
const sockets = socketsFromGlb(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), spec.model);
const ctx = { RAPIER, settings, spec, sockets, track, pace: targets.pace };

console.log(`\n${spec.name} (${carLabel}${sets.length ? ', with ' + sets.join(', ') : ''}) at the ${track.name.toLowerCase()}${Object.keys(targets).length ? '' : ` — no targets for this car (${targetsFile})`}\n`);
const results = [];
const started = performance.now();
for (const test of TESTS.filter(t => !only || only.includes(t.id))) {
  const t0 = performance.now(), run = createRun(ctx, test.id);
  let telemetry = null, detach = null, sim = null;
  if (telemetryDir) telemetry = new Telemetry({ seconds: 300, stepHz: settings.stepHz });
  const tty = process.stdout.isTTY;
  if (tty) process.stdout.write(`  ${test.name}…`);
  while (!run.done) {
    if (telemetry && run.sim !== sim) { detach?.(); sim = run.sim; if (sim) detach = telemetry.attach(sim); }
    run.next(telemetry ? 1 : 5000);
  }
  detach?.();
  const r = run.result, row = evaluate([r], targets)[0];
  results.push(r);
  if (telemetry) {
    fs.mkdirSync(telemetryDir, { recursive: true });
    telemetry.label = `${spec.name}: ${test.name}`;
    fs.writeFileSync(path.join(telemetryDir, `${test.id}.csv`), telemetry.toCSV());
  }
  process.stdout.write(`${tty ? '\r\x1b[K' : ''}${line(row)}  (${((performance.now() - t0) / 1000).toFixed(1)} s)\n`);
}

const rows = evaluate(results, targets), failed = rows.filter(r => !r.pass);
console.log(`\n${rows.length - failed.length} of ${rows.length} passed in ${((performance.now() - started) / 1000).toFixed(1)} s${failed.length ? ` — out of range: ${failed.map(r => r.name).join(', ')}` : ''}\n`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ car: carArg, installs, removes, tunes, conditions, when: new Date().toISOString(), results: rows }, null, 2));
process.exit(failed.length ? 1 : 0);

function line(r) {
  const test = TESTS.find(t => t.id === r.id);
  const value = test.check && r.unit === '' ? (r.pass ? 'yes' : 'NO') : r.value == null ? '—' : `${r.value.toFixed(r.digits)} ${r.unit}`;
  const t = r.target, range = !t ? '' : test.check && r.unit === '' ? '' : t.min != null && t.max != null ? `${t.min}–${t.max}` : t.max != null ? `≤ ${t.max}` : `≥ ${t.min}`;
  return `${r.pass ? '  ok  ' : ' FAIL '} ${r.name.padEnd(26)} ${value.padStart(12)}  ${range.padEnd(10)} ${r.detail || ''}`;
}
