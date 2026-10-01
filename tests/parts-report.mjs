// What every example part, tuning change and worn part does: the Step 6 tests on the stock car and on
// the stock car with each change, side by side, with the performance rating (npm run parts).
//
//   npm run parts                  every build below
//   npm run parts -- --only turbo  builds whose name has "turbo" in it
//   npm run parts -- --json out.json

import fs from 'node:fs';
import { harness } from './harness.mjs';

const args = process.argv.slice(2), opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const only = opt('--only'), jsonOut = opt('--json');

// Each build: a name, what it's for, and what to do to a stock garage
const BUILDS = [
  ['stock', 'the starter car as it leaves the factory', g => g],
  ['cold air intake', '+5% torque from 4000 rpm', g => g.install('cold_air_intake')],
  ['turbo kit + intercooler', 'about +60% torque from 3500 rpm', g => { g.install('front_mount_intercooler'); g.install('turbo_kit'); }],
  ['turbo + ECU boost 1.0 bar', 'the standalone ECU turning the boost up', g => { g.install('front_mount_intercooler'); g.install('turbo_kit'); g.install('ecu_standalone'); g.tune('ecu_standalone', 'boostTarget', 1.0); }],
  ['ECU rev limit 7400', 'revs 600 rpm higher before each shift', g => { g.install('ecu_standalone'); g.tune('ecu_standalone', 'revLimit', 7400); }],
  ['ECU rev limit 6200', 'shifts early', g => { g.install('ecu_standalone'); g.tune('ecu_standalone', 'revLimit', 6200); }],
  ['sport coilovers', 'stiffer, 2 cm lower, 8 kg lighter', g => g.install('sport_suspension')],
  ['coilovers −30 mm', 'lowered another 30 mm', g => { g.install('sport_suspension'); g.tune('sport_suspension', 'rideHeight', -30); }],
  ['coilovers 60 kN/m springs', 'stiffer springs', g => { g.install('sport_suspension'); g.tune('sport_suspension', 'springRate', 60000); }],
  ['coilovers soft damping', 'damping 2000 N·s/m', g => { g.install('sport_suspension'); g.tune('sport_suspension', 'damping', 2000); }],
  ['rear wing 8°', 'downforce at the rear, a little drag', g => g.install('basic_wing')],
  ['rear wing 16°', 'more of both', g => { g.install('basic_wing'); g.tune('basic_wing', 'angle', 16); }],
  ['carbon bonnet', '7 kg lighter at the front', g => g.install('bonnet_carbon')],
  ['chrome wheels', 'only the look changes', g => g.install('wheel_15_chrome')],
  ['wide bronze wheels', '0.8 kg heavier each', g => g.install('wheel_15_bronze_wide')],
  ['17" wheels + 205/45', 'a bigger wheel (308 mm): taller gearing, heavier', g => { g.install('wheel_17_alloy'); g.install('tyre_205_45r17'); }],
  ['205/50 R15 road tyres', 'wider, same rubber', g => g.install('tyre_205_50r15')],
  ['195/50 R15 sport tyres', 'grippier, a little smaller', g => g.install('tyre_195_50r15')],
  ['215/40 R15 semi-slicks', 'much grippier, 13 mm smaller wheel', g => g.install('tyre_215_40r15')],
  ['15 mm spacers', 'a 30 mm wider track', g => g.install('wheel_spacers_15')],
  ['sport LSD', 'preload 60 N·m, 45% lock', g => g.install('lsd_sport')],
  ['sport LSD 150 N·m, 80%', 'nearly locked', g => { g.install('lsd_sport'); g.tune('lsd_sport', 'preload', 150); g.tune('lsd_sport', 'lock', 80); }],
  ['close-ratio gears', 'shorter gearing all round', g => g.install('gearbox_close_ratio')],
  ['close-ratio, final 3.4', 'the same gears, taller final drive', g => { g.install('gearbox_close_ratio'); g.tune('gearbox_close_ratio', 'finalDrive', 3.4); }],
  ['no doors, bonnet or boot', '60 kg lighter, more drag', g => { g.remove('socket_door_left'); g.remove('socket_door_right'); g.remove('socket_bonnet'); g.remove('socket_boot'); }],
  ['worn tyres (30)', 'condition 30 of 100', g => g.setCondition('tyres', 30)],
  ['worn engine (40)', 'condition 40', g => g.setCondition('socket_engine', 40)],
  ['worn brakes (10)', 'condition 10: weaker pads, fade sooner', g => g.setCondition('socket_brakes', 10)],
  ['worn dampers (20)', 'suspension condition 20', g => g.setCondition('socket_suspension', 20)],
  ['everything worn (35)', 'every part in condition 35', g => { for (const s of Object.keys(g.build.sockets)) if (g.build.sockets[s]) g.state.parts[g.build.sockets[s]].condition = 35; }],
  ['track build', 'turbo, ECU 0.9 bar, coilovers −20, semi-slicks, wing, LSD, carbon bonnet', g => {
    g.install('front_mount_intercooler'); g.install('turbo_kit'); g.install('ecu_standalone'); g.tune('ecu_standalone', 'boostTarget', 0.9);
    g.install('sport_suspension'); g.tune('sport_suspension', 'rideHeight', -20); g.install('tyre_215_40r15'); g.install('basic_wing'); g.install('lsd_sport'); g.install('bonnet_carbon');
  }],
];

const COLUMNS = [['zeroTo100', '0–100', 's', 2, -1], ['quarterMile', '¼ mile', 's', 2, -1], ['braking', '100–0', 'm', 1, -1], ['skidpad', 'skidpad', 'g', 3, 1], ['slalom', 'slalom', 's', 2, -1], ['topSpeed', 'top', 'km/h', 1, 1], ['lap', 'lap', 's', 2, -1]];
const H = await harness();
const rows = [];
let stock = null;
for (const [name, about, make] of BUILDS) {
  if (only && name !== 'stock' && !name.includes(only)) continue;
  const g = H.garage();
  const r = make(g);
  const stats = g.stats();
  if (!stats.spec) { rows.push({ name, about, error: stats.errors.join('; ') }); continue; }
  const t0 = performance.now(), results = H.run(stats.spec, COLUMNS.map(c => c[0]));
  const row = { name, about, fingerprint: g.build.fingerprint, mass: stats.spec.mass, rating: stats.totals.rating, values: Object.fromEntries(COLUMNS.map(([id]) => [id, results[id].value])), ok: Object.fromEntries(COLUMNS.map(([id]) => [id, results[id].ok !== false])), seconds: (performance.now() - t0) / 1000 };
  rows.push(row);
  if (name === 'stock') stock = row;
  process.stdout.write(`\r\x1b[K${rows.length}/${BUILDS.length} ${name}`);
}
process.stdout.write('\r\x1b[K');

// the table: each value, and how much better (+) or worse (−) than stock
const cell = (row, [id, , , digits, better]) => {
  const v = row.values[id];
  if (v == null) return '—'.padStart(15);
  if (row === stock || !stock) return v.toFixed(digits).padStart(15);
  const d = v - stock.values[id], mark = Math.abs(d) < 0.5 * 10 ** -digits ? ' ' : (d * better > 0 ? '+' : '−');
  return `${v.toFixed(digits)} ${mark}${Math.abs(d).toFixed(digits)}`.padStart(15);
};
console.log(`\n${'build'.padEnd(26)} ${'rating'.padEnd(9)} ${'kg'.padStart(6)} ${COLUMNS.map(c => `${c[1]} (${c[2]})`.padStart(15)).join('')}`);
for (const row of rows) {
  if (row.error) { console.log(`${row.name.padEnd(26)} can't be built: ${row.error}`); continue; }
  const rating = row.rating ? `${row.rating.index} ${row.rating.class}` : '';
  console.log(`${row.name.padEnd(26)} ${rating.padEnd(9)} ${String(row.mass).padStart(6)} ${COLUMNS.map(c => cell(row, c)).join('')}`);
}
console.log(`\n(+ better than stock, − worse; the rating is 100–999 from quick estimates, data/classes.json)`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ when: new Date().toISOString(), columns: COLUMNS.map(c => c[0]), rows }, null, 2));
