// Importing a model (npm run import): check it, fix what can be fixed, check it again, and if it passes
// put it in the game —
// Every model is finished on its way in (tools/content/finish.mjs: levels of detail, big textures compressed), and a
// part that comes off in a crash gets its collision hulls and its detach block (mounts from the model).
//
//  - a part (spoiler_ducktail.glb): its model in assets/parts/<category>/, an icon in
//    assets/icons/parts/, and a starting definition in data/parts/<category>/ (slot, bounds, model, an
//    estimated mass from its volume, the type's template — fits, aero… — and a price and stats marked
//    todo, so the shop lists it but doesn't sell it until they're filled in); an existing part's
//    model, icon and bounds are replaced and the rest of its file kept;
//  - a car (car_<id>.glb, its parts under their socket nodes): its source in data/cars/<id>/, a
//    car.json started from the starter car's (with its own copies of the stock body parts) if it has
//    none, then split into its body and stock part models (tools/split-car.mjs), and an icon.
// The original goes to incoming/imported/.
//  - a kit piece (kit_<kind>_<attach>_<name>.glb: a hand-made piece a family's model generator mixes in — a wing's
//    end plate, a wheel's centre…; data/content/model-rules.json kits): checked by its attach point's rules (no palette
//    texture: it's mixed into a model made in code), fixed, and put in assets/kits/<kind>/<attach>_<name>.glb — a choice
//    for that kind's kit shape setting from then on.
//
// For generated parts (npm run generate-parts), options also take: id (the part's id, whatever the file
// is called), byCar (a car id: this is that car's own version of the part's model, written to
// assets/parts/<category>/<id>/<car>.glb and listed in the part's byCar), defaults (fields a new part
// starts with: name, tier, fits…) and set (fields set on the part, new or not: madeBy…). A model for a
// part that was a placeholder takes its modelTodo and placeholder away.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkModel } from './check.mjs';
import { autoFix } from './fix.mjs';
import { renderIcon } from './icon.mjs';
import { inspect } from './inspect.mjs';
import { modelIO, readModel } from './io.mjs';
import { editJson, writeJson } from './json.mjs';
import { readJson, rel, typeFromName } from './rules.mjs';
import { finishModel, partDamage } from './finish.mjs';

const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const round = (v, d = 4) => +v.toFixed(d);
const clone = x => JSON.parse(JSON.stringify(x));

// file: a .glb; project: loadProject(root); options: { type, ask(file, types) → type | null, scale,
// placeOrigin, paint, materials, keepOriginal } → { ok, type, id, before, after, did, written, notes, message }
export async function importFile(file, project, options = {}) {
  const { root, rules } = project, base = path.basename(file, path.extname(file)).toLowerCase();
  const kit = kitFromName(base, rules);
  if (kit) return importKit(file, project, kit, options);
  let type = options.type ?? typeFromName(file, rules);
  if (!type && options.ask) type = await options.ask(file, [...Object.keys(rules.types), 'car']);
  if (!type) return { ok: false, type: null, message: `Can't tell what ${path.basename(file)} is: name it after its type (${Object.keys(rules.types).slice(0, 5).join('_…, ')}_…, e.g. spoiler_ducktail.glb, or car_<id>.glb), or run npm run import in a terminal to choose.` };
  if (type !== 'car' && !rules.types[type]) return { ok: false, type, message: `"${type}" isn't a part type (${Object.keys(rules.types).join(', ')}, car).` };

  let doc;
  try { doc = await readModel(file); }
  catch (err) { return { ok: false, type, message: `${path.basename(file)} can't be read (${err.message}): export it again as glTF Binary (.glb).` }; }
  const carId = type === 'car' ? base.replace(/^car_/, '') : null;
  const existingCar = carId ? project.db.cars[carId] ?? null : null;
  const ctx = { rules, type, db: project.db, knownSockets: project.knownSockets, templates: project.templates, car: existingCar ?? templateCar(options, project), newCar: type === 'car' && !existingCar, file: rel(file, root), estimateMass: true };
  const before = checkModel(inspect(doc), ctx);
  const did = await autoFix(doc, { rules, type, scale: options.scale, placeOrigin: options.placeOrigin, paint: options.paint, materials: options.materials, compress: type !== 'car' });
  const info = inspect(doc), after = checkModel(info, ctx);
  const out = { ok: false, type, before, after, did, written: [], notes: [] };
  if (after.verdict === 'fail') return { ...out, message: `${path.basename(file)} still has problems after fixing what could be fixed: it stays in ${rel(path.dirname(file), root)} until they're fixed (see above).` };

  // (a car's are finished as it's split into its body and parts: tools/split-car.mjs)
  if (type !== 'car') out.finished = await finishModel(doc, { rules });
  const io = await modelIO(), bytes = await io.writeBinary(doc);
  const result = type === 'car' ? await placeCar(carId, doc, bytes, project, out, options) : await placePart(options.id ?? base, type, doc, info, bytes, project, out, options);
  if (!result.ok) return result;
  // the original, out of the way
  if (!options.keepOriginal) {
    const done = path.join(path.dirname(file), 'imported', path.basename(file));
    fs.mkdirSync(path.dirname(done), { recursive: true });
    fs.renameSync(file, done);
    out.notes.push(`moved the original to ${rel(done, root)}`);
  }
  return result;
}

// ---------- a kit piece ----------

// kit_spoiler_endplate_fin → { kind: 'spoiler', attach: 'endplate', name: 'fin' } (the longest kind and attach point that
// fit, kinds and attach points having _ in them), or null
export function kitFromName(base, rules) {
  if (!base.startsWith('kit_')) return null;
  let best = null;
  for (const [kind, points] of Object.entries(rules.kits ?? {})) {
    if (kind.startsWith('_')) continue;
    for (const attach of Object.keys(points).filter(a => !a.startsWith('_'))) {
      const pre = `kit_${kind}_${attach}_`;
      if (base.startsWith(pre) && (!best || pre.length > best.pre.length)) best = { kind, attach, name: base.slice(pre.length), pre };
    }
  }
  return best && /^[a-z0-9_]+$/.test(best.name) ? { kind: best.kind, attach: best.attach, name: best.name } : null;
}
// A kit piece's rules as a part type's (what checkModel and autoFix take): { rules, type }
export function kitRules(rules, kind, attach) {
  const r = rules.kits?.[kind]?.[attach];
  if (!r) return null;
  const type = `kit:${kind}:${attach}`;
  return { type, rules: { ...rules, types: { ...rules.types, [type]: { ...r, label: `kit piece (${r.label.toLowerCase()})` } } } };
}
// (what a kit piece mustn't have, over a part's rules: the palette texture, any texture)
export function kitFindings(info) {
  const mats = new Set(info.primitives.map(p => p.material)), out = [];
  if (mats.has('car_atlas') || info.textures.length) out.push({ level: 'fail', check: 'kit', text: 'A kit piece is mixed into a model made in code, which has no palette texture: it can\'t use car_atlas or textures.', fix: 'Give its faces paint, a finish (carbon, chrome, raw_metal, matte_black…) or rim_finish instead.' });
  return out;
}
async function importKit(file, project, kit, options) {
  const { root } = project, K = kitRules(project.rules, kit.kind, kit.attach), rel0 = rel(file, root);
  let doc;
  try { doc = await readModel(file); }
  catch (err) { return { ok: false, type: K.type, message: `${path.basename(file)} can't be read (${err.message}): export it again as glTF Binary (.glb).` }; }
  const check = d => { const info = inspect(d), r = checkModel(info, { rules: K.rules, type: K.type, file: rel0 }), extra = kitFindings(info); r.findings.push(...extra); if (extra.length) r.verdict = 'fail'; return r; };
  const before = check(doc);
  const did = await autoFix(doc, { rules: K.rules, type: K.type, scale: options.scale, placeOrigin: options.placeOrigin, materials: options.materials, compress: true });
  const after = check(doc), out = { ok: false, type: K.type, before, after, did, written: [], notes: [] };
  if (after.verdict === 'fail') return { ...out, message: `${path.basename(file)} still has problems after fixing what could be fixed: it stays in ${rel(path.dirname(file), root)} until they're fixed (see above).` };
  const io = await modelIO(), dest = `assets/kits/${kit.kind}/${kit.attach}_${kit.name}.glb`;
  write(root, dest, await io.writeBinary(doc));
  out.written.push(dest);
  const F = readJson('data/content/formulas.json', root), key = Object.entries(F.families?.[kit.kind]?.shapeSettings ?? {}).find(([, S]) => S?.kit === kit.attach)?.[0];
  out.notes.push(`a kit piece: ${kit.kind} families can use it now${key ? ` (their shape setting ${key}: "${kit.name}")` : ''}; npm run content -- build makes it into the models of the families that do`);
  if (!options.keepOriginal) {
    const done = path.join(path.dirname(file), 'imported', path.basename(file));
    fs.mkdirSync(path.dirname(done), { recursive: true });
    fs.renameSync(file, done);
    out.notes.push(`moved the original to ${rel(done, root)}`);
  }
  return { ...out, ok: true, id: `${kit.kind}/${kit.attach}_${kit.name}` };
}

// ---------- a part ----------

async function placePart(base, type, doc, info, bytes, project, out, options = {}) {
  const { root, rules, db } = project, t = rules.types[type];
  const id = base.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  const existing = db.parts[id], category = existing?.category ?? t.category;
  const model = options.byCar ? `assets/parts/${category}/${id}/${options.byCar}.glb` : `assets/parts/${category}/${id}.glb`, icon = `assets/icons/parts/${id}.png`;
  const defFile = existing ? `data/parts/${partFile(root, id)}` : `data/parts/${t.category}/${id}.json`;
  if (existing && existing.slot !== t.slot) return { ...out, message: `There's already a part "${id}" in another slot (${existing.slot}): rename the file.` };
  if (options.byCar && !existing) return { ...out, message: `${id} isn't a part yet: import its own model before a car's version of it.` };
  write(root, model, bytes); out.written.push(model);
  const bounds = { min: info.bounds.min.map(v => round(v)), max: info.bounds.max.map(v => round(v)) };
  const damage = await partDamage(info, type, rules, existing?.detach ?? options.defaults?.detach ?? null);
  if (options.byCar) {
    editJson(path.join(root, defFile), p => { p.byCar = { ...p.byCar, [options.byCar]: { model, bounds, ...(damage.collision ? { collision: damage.collision } : {}) } }; });
    out.written.push(defFile);
    out.notes.push(`${id}: its ${options.byCar} version`);
    return { ...out, ok: true, id, part: readJson(defFile, root) };
  }
  write(root, icon, await renderIcon(doc, { rules, type })); out.written.push(icon);
  if (existing) {
    editJson(path.join(root, defFile), p => { p.model = model; p.icon = icon; p.bounds = bounds; if (damage.collision) p.collision = damage.collision; if (damage.detach && !p.detach) p.detach = damage.detach; delete p.modelTodo; delete p.placeholder; Object.assign(p, options.set ?? {}); });
    out.written.push(defFile);
    out.notes.push(`${id} was already a part: its model, icon and bounds are replaced; the rest of ${defFile} is as it was`);
    return { ...out, ok: true, id, part: readJson(defFile, root) };
  }
  const tpl = clone(t.template ?? {}), todo = options.defaults?.todo ?? tpl.todo ?? ['price'];
  const mass = options.defaults?.mass != null ? { value: options.defaults.mass, how: options.defaults._massHow ?? 'set by its maker' } : estimateMass(info, t);
  delete tpl.todo;
  const def = {
    id, name: nameFor(id, type, rules), category: t.category, slot: t.slot, kind: 'component',
    price: 0, mass: mass.value, model, icon,
    fits: tpl.fits ?? [], requires: [], conflicts: [], provides: [],
    bounds, massOffset: info.centroid.map(v => round(v, 3)),
  };
  delete tpl.fits;
  if (type === 'rim') {
    const diameter = Math.round(info.bounds.size[1] / 0.0254 - 0.4), width = Math.round(info.bounds.size[0] / 0.0254 * 2) / 2;
    tpl.rim = { diameter, width, offset: 35 };
    def.provides = [`rim:${diameter}`];
  }
  if (tpl.aero) tpl.aero.point = [0, round(info.bounds.max[1] * 0.75, 3), round(info.centroid[2], 3)];
  const { _massHow, todo: _t, ...defaults } = options.defaults ?? {};
  if (damage.detach) tpl.detach = damage.detach;
  if (damage.collision) tpl.collision = damage.collision;
  Object.assign(def, tpl, defaults, options.set ?? {}, {
    todo,
    _todo: `Made by ${options.madeBy ?? 'npm run import'} on ${new Date().toISOString().slice(0, 10)}. To do: ${todo.map(x => TODO_WORDS[x] ?? x).join('; ')}. Check the mass too (${mass.value} kg ${mass.how}). Then delete "todo" and the shop sells it.`,
  });
  writeJson(path.join(root, defFile), def); out.written.push(defFile);
  addToIndex(root, 'data/parts/index.json', 'parts', `${t.category}/${id}.json`);
  out.notes.push(`new part ${id}: ${def.name}, ${def.mass} kg (${mass.how}); to do: ${todo.join(', ')}`);
  return { ...out, ok: true, id, part: def };
}
const TODO_WORDS = { price: 'the price (data/content/tiers.json has the rules for each tier)', aero: 'the aero numbers (liftCoefficient, dragCoefficient)', rim: 'the rim size and offset (measured from the model: check them)', fits: 'which cars it fits', effects: 'what it does (effects)', engine: 'the engine block' };

// its volume × its type's density (a mesh with holes: its box, a third full), within the type's range
export function estimateMass(info, t) {
  const [lo, hi] = t.massRange, box = info.bounds.size.reduce((a, v) => a * v, 1);
  const vol = info.closed ? info.volume : box * 0.33, raw = vol * t.density, value = round(Math.min(hi, Math.max(lo, raw)), 1);
  return { value, how: `estimated from ${info.closed ? 'its volume' : 'its size (the mesh has holes)'}${raw < lo || raw > hi ? `, kept within ${lo}–${hi} kg` : ''}` };
}
// spoiler_ducktail → "Ducktail spoiler"; door_left_vented → "Vented left door"; car_roadster → "Roadster"
export function nameFor(id, type, rules) {
  const words = id.split('_'), names = type === 'car' ? ['car'] : [type, ...(rules.types[type].names ?? [])];
  const prefix = names.map(n => n.split('_')).filter(n => n.every((w, i) => words[i] === w)).sort((a, b) => b.length - a.length)[0] ?? [];
  const parts = type.split('_'), side = /^(left|right|front|rear)$/.test(parts.at(-1));
  const noun = type === 'car' ? '' : type === 'rim' ? 'wheel' : (side ? [parts.at(-1), ...parts.slice(0, -1)] : parts).join(' ');
  const s = [words.slice(prefix.length).join(' '), noun].filter(Boolean).join(' ');
  return s ? s[0].toUpperCase() + s.slice(1) : id;
}

// ---------- a car ----------

// (a new car's import, checked as the car it starts from: its sockets — a socket the donor has no use for, like a boot
// on a pickup, isn't missing — and its body type's sizes: options.standards, from data/content/templates)
function templateCar(options, project) {
  const donor = project.db.cars[options.donor ?? 'starter_car'];
  return donor ? { standards: options.standards ?? donor.standards, sockets: donor.sockets } : null;
}

async function placeCar(id, doc, bytes, project, out, options = {}) {
  const { root, db, rules } = project;
  let def = db.cars[id];
  const source = def?.model?.source ?? `data/cars/${id}/${id}.glb`;
  write(root, source, bytes); out.written.push(source);
  if (!def) {
    def = newCar(id, doc, project, out, options);
    out.notes.push(`new car ${id}: data/cars/${id}/car.json started from the ${project.db.cars[options.donor ?? 'starter_car']?.name ?? 'starter car'}'s; to do: ${def.todo.join(', ')}`);
  }
  // its body and stock part models
  const r = spawnSync(process.execPath, [path.join(TOOLS, 'split-car.mjs'), id, '--root', root], { encoding: 'utf8' });
  if (r.status !== 0) return { ...out, message: `Splitting the car failed: ${(r.stderr || r.stdout).trim()}` };
  out.notes.push(...r.stdout.trim().split('\n').map(l => `split: ${l.trim()}`));
  const icon = `assets/icons/cars/${id}.png`;
  write(root, icon, await renderIcon(doc, { rules, type: 'car' })); out.written.push(icon);
  editJson(path.join(root, `data/cars/${id}/car.json`), c => { c.icon = icon; });
  return { ...out, ok: true, id };
}

// A car.json from another car's (options.donor: the starter car's, unless a body template names another — data/content/
// templates): this model's socket positions, its own copies of the parts that only fit the donor (its body panels,
// whose models the split makes; its engine, gearbox…), its shared standards (options.standards), marked todo and,
// with a status (options.status), a draft until the content manager publishes it
function newCar(id, doc, project, out, options = {}) {
  const { root } = project, donor = options.donor ?? 'starter_car', tpl = readJson(`data/cars/${donor}/car.json`, root), car = clone(tpl);
  const sockets = new Map(inspect(doc).sockets.map(s => [s.name, s]));
  Object.assign(car, { id, name: options.name ?? nameFor(`car_${id}`, 'car'), price: 0 });
  car.tags = car.tags.map(t => t === `car:${donor}` ? `car:${id}` : t === `chassis:${donor}` ? `chassis:${id}` : t);
  if (options.standards) car.standards = clone(options.standards);
  if (options.status) car.status = options.status;
  car.model = { ...car.model, source: `data/cars/${id}/${id}.glb`, file: `assets/cars/${id}/body.glb` };
  delete car._tuning;
  delete car.icon;
  const mine = f => f === `car:${donor}` ? `car:${id}` : f === `chassis:${donor}` ? `chassis:${id}` : f;
  for (const s of car.sockets) {
    const node = sockets.get(s.name);
    if (node) s.position = node.position.map(v => round(v));
    s.stock = s.stock.map(pid => {
      const part = readPart(root, pid);
      // (a part made for the donor alone: its fits name the donor, or a list of alternatives in its fits does)
      if (!(part?.fits ?? []).flat().some(f => f === `car:${donor}` || f === `chassis:${donor}`)) return pid;
      const copyId = `${pid.replace(new RegExp(`^${donor}_|_${donor}$`), '')}_${id}`.replace(/^_+/, ''), file = `data/parts/${part.category}/${copyId}.json`;
      if (!fs.existsSync(path.join(root, file))) {
        writeJson(path.join(root, file), { ...part, id: copyId, name: part.name.replace(/\(([^)]*)stock\)/, `(${car.name}, stock)`), model: '', icon: `assets/icons/parts/${copyId}.png`, fits: part.fits.map(f => Array.isArray(f) ? f.map(mine) : mine(f)) });
        addToIndex(root, 'data/parts/index.json', 'parts', `${part.category}/${copyId}.json`);
        out.written.push(file);
      }
      return copyId;
    });
  }
  car.todo = ['price', 'chassis (mass, centre of mass, inertia)', 'dimensions and aero', 'engine and drivetrain (its stock parts)', 'socket positions the model has no node for'];
  car._todo = `Made by ${options.madeBy ?? 'npm run import'} from the ${tpl.name}'s car.json on ${new Date().toISOString().slice(0, 10)}: everything but the model's socket positions${options.standards ? ' and its standards' : ''} is the ${tpl.name}'s. Fill in the to-dos, then delete "todo".`;
  writeJson(path.join(root, `data/cars/${id}/car.json`), car);
  addToIndex(root, 'data/cars/index.json', 'cars', `${id}/car.json`);
  out.written.push(`data/cars/${id}/car.json`);
  return car;
}
// (a part's file, from the index: data/parts/<its file>)
function partFile(root, id) { return readJson('data/parts/index.json', root).parts.find(x => path.basename(x, '.json') === id); }
function readPart(root, id) {
  const f = readJson('data/parts/index.json', root).parts.find(x => path.basename(x, '.json') === id);
  return f ? readJson(`data/parts/${f}`, root) : null;
}

// ---------- files ----------

function write(root, file, bytes) {
  const full = path.join(root, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, bytes);
}
export function addToIndex(root, indexFile, key, entry) {
  editJson(path.join(root, indexFile), idx => { if (!idx[key].includes(entry)) idx[key] = [...idx[key], entry].sort(); });
}
