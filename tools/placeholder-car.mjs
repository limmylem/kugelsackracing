// Makes a car's model in code from its design (data/cars/<id>/design.json) — its smooth body, glasshouse, details and
// stock parts (tools/content/carBody.mjs; --blocky: the old low-poly placeholder, tools/content/placeholderCar.mjs) —
// and puts it in incoming/car_<id>.glb, for npm run import to check and split into the body and its stock parts'
// models, as it would a modelled car. docs/models_todo.md lists what's still to make.
//
//   node tools/placeholder-car.mjs kaze_gt [hana_roadster …]      (--import: import them straight away)

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { modelIO } from './content/io.mjs';
import { placeholderCar } from './content/placeholderCar.mjs';
import { carBodyModel } from './content/carBody.mjs';
import { ROOT } from './content/rules.mjs';

const args = process.argv.slice(2), ids = args.filter(a => !a.startsWith('--'));
if (!ids.length) { console.error('usage: node tools/placeholder-car.mjs <carId> … [--import]'); process.exit(2); }
const io = await modelIO();
for (const id of ids) {
  const design = JSON.parse(fs.readFileSync(path.join(ROOT, `data/cars/${id}/design.json`), 'utf8'));
  // (keepSockets: the car's sockets exactly where its car.json has them — a car whose physics was tuned on its own model)
  const car = design.keepSockets ? JSON.parse(fs.readFileSync(path.join(ROOT, `data/cars/${id}/car.json`), 'utf8')) : null;
  const at = car && Object.fromEntries(car.sockets.filter(s => !s.node).map(s => [s.name, { position: s.position, ...(s.rotation && { rotation: s.rotation }) }]));
  const doc = await (args.includes('--blocky') ? placeholderCar : carBodyModel)({ id, ...design, ...(at && { socketsAt: at, sockets: Object.keys(at) }) }), file = path.join(ROOT, `incoming/car_${id}.glb`);
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
