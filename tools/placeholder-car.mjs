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
  syncSockets(id, doc);
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

// car.json's socket positions where the model has them (the data checks want them the same), its layout kept
function syncSockets(id, doc) {
  const file = path.join(ROOT, `data/cars/${id}/car.json`);
  if (!fs.existsSync(file)) return;
  let text = fs.readFileSync(file, 'utf8'), moved = 0;
  const seatWas = JSON.parse(text).sockets.find(s => s.name === 'socket_seat_driver')?.position;
  for (const n of doc.getRoot().listNodes()) {
    if (!n.getName().startsWith('socket_')) continue;
    const at = n.getTranslation().map(v => +v.toFixed(4)), re = new RegExp(`("name": "${n.getName()}",[^{}]*?"position": )\\[[^\\]]*\\]`);
    text = text.replace(re, (all, head) => { const was = JSON.parse(all.slice(head.length)); if (was.some((v, k) => Math.abs(v - at[k]) > 1e-4)) moved++; return `${head}${JSON.stringify(at).replace(/,/g, ', ')}`; });
  }
  // (the cockpit camera — the driver's eyes — goes with the driver's seat)
  const seat = doc.getRoot().listNodes().find(n => n.getName() === 'socket_seat_driver')?.getTranslation(), eye = JSON.parse(text).camera?.cockpit?.position;
  if (seatWas && seat && eye) text = text.replace(/("cockpit": \{\s*"position": )\[[^\]]*\]/, (all, head) => `${head}${JSON.stringify(eye.map((v, k) => +(v + seat[k] - seatWas[k]).toFixed(3))).replace(/,/g, ', ')}`);
  fs.writeFileSync(file, text);
  if (moved) console.log(`${id}: ${moved} socket positions in data/cars/${id}/car.json moved to the model's`);
}
