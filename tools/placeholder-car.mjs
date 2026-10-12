// Makes a car's placeholder model (tools/content/placeholderCar.mjs) from its design
// (data/cars/<id>/design.json) and puts it in incoming/car_<id>.glb, for npm run import to check and
// split into the body and its stock parts' models — as it would a modelled car. Until the real model
// is made; docs/models_todo.md lists what to make.
//
//   node tools/placeholder-car.mjs kaze_gt [hana_roadster …]      (--import: import them straight away)

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { modelIO } from './content/io.mjs';
import { placeholderCar } from './content/placeholderCar.mjs';
import { ROOT } from './content/rules.mjs';

const args = process.argv.slice(2), ids = args.filter(a => !a.startsWith('--'));
if (!ids.length) { console.error('usage: node tools/placeholder-car.mjs <carId> … [--import]'); process.exit(2); }
const io = await modelIO();
for (const id of ids) {
  const design = JSON.parse(fs.readFileSync(path.join(ROOT, `data/cars/${id}/design.json`), 'utf8'));
  const doc = await placeholderCar({ id, ...design }), file = path.join(ROOT, `incoming/car_${id}.glb`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = await io.writeBinary(doc);
  fs.writeFileSync(file, bytes);
  console.log(`${id}: incoming/car_${id}.glb (${(bytes.byteLength / 1024).toFixed(0)} KB)`);
  if (args.includes('--import')) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/import.mjs'), file, '--type', 'car'], { encoding: 'utf8', cwd: ROOT });
    process.stdout.write(r.stdout); process.stderr.write(r.stderr);
    if (r.status) process.exitCode = r.status;
  }
}
