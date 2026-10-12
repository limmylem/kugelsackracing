// A new car from its body type's template (npm run content -- new-car <id> --type <type>; docs/CONTENT_PIPELINE.md):
//  - with --model file.glb (exported from Blender with the add-on: tools/blender/): that model, checked by the import
//    (its scale and which way it faces, its sockets, its triangle budget…) and split into its body and stock parts
//  - without: a placeholder model in the type's proportions (data/content/templates/<type>.json design), to drive
//    straight away until the real one is made
// Either way its car.json starts from the template's donor car (its physics, sockets and stock parts, its own copies
// of the parts made for the donor alone), with the type's shared standards — so every part made to them fits it —
// its class from how it rates stock, and status draft: the content manager publishes it.
//
//   newCar(id, { type, name, model }) → { ok, message, notes }

import fs from 'node:fs';
import path from 'node:path';
import { importFile } from './importer.mjs';
import { inspect } from './inspect.mjs';
import { modelIO, readModel } from './io.mjs';
import { editJson, writeJson } from './json.mjs';
import { placeholderCar } from './placeholderCar.mjs';
import { loadProject } from './project.mjs';
import { ROOT, readJson } from './rules.mjs';
import { Garage } from '../../garage/data.js';

export const TYPES = () => fs.readdirSync(path.join(ROOT, 'data/content/templates')).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')).sort();
const PAINTS = ['#c93a2b', '#2a4fa6', '#e8c21c', '#2f7fc1', '#6b7a4a', '#d35400', '#b01818', '#1f8a70', '#7a3db8', '#dfe3e8'];

export async function newCar(id, { type, name = null, model = null, root = ROOT } = {}) {
  const notes = [], types = TYPES();
  if (!id || !/^[a-z][a-z0-9_]{2,30}$/.test(id)) return { ok: false, message: `A car's id is 3 to 31 lower-case letters, digits and _, starting with a letter (like "comet_gt"): "${id ?? ''}" isn't one.` };
  if (fs.existsSync(path.join(root, `data/cars/${id}`))) return { ok: false, message: `There's already a car "${id}" (data/cars/${id}): pick another id, or import its new model with npm run import -- incoming/car_${id}.glb.` };
  if (!types.includes(type)) return { ok: false, message: `--type is one of ${types.join(', ')}${type ? ` ("${type}" isn't)` : ''}.` };
  const T = readJson(`data/content/templates/${type}.json`, root);
  const project = await loadProject(root);
  if (!project.db.cars[T.donor]) return { ok: false, message: `The ${type} template's donor car "${T.donor}" isn't a car.` };
  const incoming = path.join(root, `incoming/car_${id}.glb`);
  fs.mkdirSync(path.dirname(incoming), { recursive: true });
  if (model) {
    if (!fs.existsSync(model)) return { ok: false, message: `There's no file ${model}.` };
    fs.copyFileSync(model, incoming);
    // (its proportions against the type's usual ones)
    const info = inspect(await readModel(incoming)), size = info.bounds?.size;
    if (size) for (const [k, i] of [['width', 0], ['height', 1], ['length', 2]]) { const [lo, hi] = T.sizes[k]; if (size[i] < lo || size[i] > hi) notes.push(`note: it's ${size[i].toFixed(2)} m ${k === 'length' ? 'long' : k === 'width' ? 'wide' : 'tall'}; a ${T.label.toLowerCase()} is usually ${lo}–${hi} m (it can be — check it's in metres)`); }
  } else {
    // a placeholder in the type's proportions, with every socket the donor's car.json has
    const donor = project.db.cars[T.donor], paint = PAINTS[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PAINTS.length];
    const design = { _note: `${name ?? id}'s placeholder model (npm run content -- new-car, from data/content/templates/${type}.json): its proportions and socket nodes. Replace it with the real model (npm run content -- new-car is done: npm run import -- incoming/car_${id}.glb) when it's made.`, paint, ...T.design, sockets: donor.sockets.map(s => s.node ?? s.name) };
    writeJson(path.join(root, `data/cars/${id}/design.json`), design);
    const io = await modelIO();
    fs.writeFileSync(incoming, await io.writeBinary(await placeholderCar({ id, ...design })));
    notes.push(`a placeholder model in a ${T.label.toLowerCase()}'s proportions: data/cars/${id}/design.json`);
  }
  const r = await importFile(incoming, project, { type: 'car', donor: T.donor, standards: T.standards, name, status: 'draft', madeBy: `npm run content -- new-car (${type})` });
  for (const f of [...(r.after?.findings ?? [])].filter(f => f.level !== 'pass')) notes.push(`${f.level === 'fail' ? 'problem' : 'note'}: ${f.text}${f.fix ? ` ${f.fix}` : ''}`);
  if (!r.ok) {
    if (!model) fs.rmSync(path.join(root, `data/cars/${id}`), { recursive: true, force: true });
    return { ok: false, message: r.message, notes };
  }
  notes.push(...r.notes);
  // its class: how it rates as it comes (data/classes.json)
  const after = await loadProject(root), stats = new Garage(after.db, null, id).stats(), rating = stats.totals?.rating;
  if (!stats.spec || !rating) return { ok: false, message: `${id} was made, but it can't be driven as it is: ${new Garage(after.db, null, id).drivable().reasons.join('; ')}`, notes };
  editJson(path.join(root, `data/cars/${id}/car.json`), c => { c.class = rating.class; });
  notes.push(`stock it rates ${rating.index}: class ${rating.class}; ${Math.round(stats.totals.peakPower.hp)} hp, ${Math.round(stats.spec.mass)} kg`);
  return { ok: true, message: `${name ?? id} is a new ${T.label.toLowerCase()} (data/cars/${id}/car.json), a draft: drive it in the test track (http://localhost:7690/?car=${id}), fill in its to-dos, then publish it in the content manager.`, notes };
}
