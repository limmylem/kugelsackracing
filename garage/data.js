// Loading the car and part definitions (data/cars, data/parts, checked against data/schemas), and
// the player's garage: owned part instances, owned cars and their builds.
//
//  - owned part instance: { instanceId, partId, condition (0–100), paint?: { colour, finish },
//    tuning?: { setting: value } }
//  - build: { carId, carInstanceId, sockets: { socketName: instanceId | null }, fingerprint }
//  - garage state: { version, nextId, parts: { instanceId: instance }, cars: { carInstanceId: { carInstanceId,
//    carId, build, paint?: { colour, finish } } }, current: carInstanceId }
//
// No browser or Node APIs: loadGarageData takes a readJson(path) → Promise<object>.

import { createValidator } from './jsonSchema.js';
import { computeStats } from './stats.js';
import { checkInstall, checkRemove, validateBuild } from './validate.js';
import { fingerprint } from './fingerprint.js';

export const SCHEMAS = ['car.schema.json', 'part.schema.json', 'blocks.schema.json', 'owned-part.schema.json', 'build.schema.json', 'garage.schema.json', 'finishes.schema.json', 'condition.schema.json', 'classes.schema.json', 'economy.schema.json', 'profile.schema.json', 'engine-sound.schema.json', 'damage.schema.json', 'crash-sound.schema.json', 'mechanical-sound.schema.json', 'effects.schema.json'];

// Every car and part, and the finishes, checked against the schemas. Returns { db: { cars, parts,
// finishes }, problems: [{ file, path, message }] } (problems: files that don't match their schema, ids
// that don't match their file, duplicate ids, references to parts, sockets or finishes that aren't there)
export async function loadGarageData(readJson) {
  const schemas = Object.fromEntries(await Promise.all(SCHEMAS.map(async f => [f, await readJson(`data/schemas/${f}`)])));
  const validator = createValidator(schemas), problems = [], cars = {}, parts = {};
  const check = (file, schema, data) => { for (const e of validator.validate(schema, data)) problems.push({ file, path: e.path, message: e.message }); };
  const [carIndex, partIndex, finishFile, condition, classes, economy, damage] = await Promise.all(['data/cars/index.json', 'data/parts/index.json', 'data/finishes.json', 'data/condition.json', 'data/classes.json', 'data/economy.json', 'data/damage.json'].map(f => readJson(f)));
  check('data/finishes.json', 'finishes.schema.json', finishFile);
  check('data/economy.json', 'economy.schema.json', economy);
  check('data/condition.json', 'condition.schema.json', condition);
  check('data/classes.json', 'classes.schema.json', classes);
  check('data/damage.json', 'damage.schema.json', damage);
  const finishes = finishFile.finishes || {};
  await Promise.all([
    ...carIndex.cars.map(async rel => {
      const file = `data/cars/${rel}`, car = await readJson(file);
      check(file, 'car.schema.json', car);
      if (rel.split('/')[0] !== car.id) problems.push({ file, path: 'id', message: `should be "${rel.split('/')[0]}" (its folder)` });
      if (cars[car.id]) problems.push({ file, path: 'id', message: `"${car.id}" is used twice` });
      cars[car.id] = car;
    }),
    ...partIndex.parts.map(async rel => {
      const file = `data/parts/${rel}`, part = await readJson(file);
      check(file, 'part.schema.json', part);
      const [folder, name] = rel.split('/');
      if (name !== `${part.id}.json`) problems.push({ file, path: 'id', message: `should be "${name.replace(/\.json$/, '')}" (its file name)` });
      if (folder !== part.category) problems.push({ file, path: 'category', message: `should be "${folder}" (its folder)` });
      if (parts[part.id]) problems.push({ file, path: 'id', message: `"${part.id}" is used twice` });
      parts[part.id] = part;
    }),
  ]);
  // what the files point at has to be there: stock parts, grouped sockets, finishes, variants' base parts
  for (const car of Object.values(cars)) {
    const file = `data/cars/${car.id}/car.json`, names = new Set(car.sockets.map(s => s.name));
    for (const s of car.sockets) for (const id of s.stock || []) if (!parts[id]) problems.push({ file, path: `sockets.${s.name}.stock`, message: `there's no part "${id}"` });
    for (const [g, list] of Object.entries(car.socketGroups || {})) {
      for (const n of list) if (!names.has(n)) problems.push({ file, path: `socketGroups.${g}`, message: `names ${n}, which isn't a socket` });
      if (names.has(g) || car.sockets.some(s => s.slot === g)) problems.push({ file, path: `socketGroups.${g}`, message: 'is also a socket or slot name' });
    }
    if (car.paint && !finishes[car.paint.finish]?.paint) problems.push({ file, path: 'paint.finish', message: `"${car.paint.finish}" isn't a paint finish in data/finishes.json` });
  }
  for (const p of Object.values(parts)) {
    const file = `data/parts/${p.category}/${p.id}.json`;
    if (p.variantOf && !parts[p.variantOf]) problems.push({ file, path: 'variantOf', message: `there's no part "${p.variantOf}"` });
    for (const [path, f] of [['look.finish', p.look?.finish], ...Object.entries(p.look?.materials || {}).map(([m, o]) => [`look.materials.${m}.finish`, o.finish])])
      if (f && !finishes[f]) problems.push({ file, path, message: `there's no finish "${f}" in data/finishes.json` });
    for (const [name, t] of Object.entries(p.tuning || {}))
      if (!(t.min <= t.default && t.default <= t.max)) problems.push({ file, path: `tuning.${name}`, message: `its default ${t.default} isn't within ${t.min}–${t.max}` });
  }
  if (!cars[economy.startingCar]) problems.push({ file: 'data/economy.json', path: 'startingCar', message: `there's no car "${economy.startingCar}"` });
  return { db: { cars, parts, finishes, condition, classes, economy, damage }, problems, validator };
}

// ---------- The garage ----------

export class Garage {
  // db: { cars, parts } (loadGarageData); state: a saved garage state (or none: a fresh garage with one stock car)
  constructor(db, state, carId = 'starter_car') {
    this.db = db;
    this.state = state ?? Garage.freshState(db, carId);
  }

  static freshState(db, carId) {
    const state = { version: 1, nextId: 1, parts: {}, cars: {}, current: null };
    const car = db.cars[carId];
    if (!car) throw new Error(`there's no car "${carId}"`);
    const carInstanceId = `car_${String(state.nextId++).padStart(4, '0')}`;
    const build = { carId, carInstanceId, sockets: {} };
    for (const s of car.sockets) build.sockets[s.name] = s.stock?.[0] ? Garage.newInstance(state, s.stock[0]).instanceId : null;
    build.fingerprint = fingerprint(build, state.parts);
    state.cars[carInstanceId] = { carInstanceId, carId, build };
    state.current = carInstanceId;
    return state;
  }
  static newInstance(state, partId, condition = 100) {
    const inst = { instanceId: `part_${String(state.nextId++).padStart(6, '0')}`, partId, condition };
    state.parts[inst.instanceId] = inst;
    return inst;
  }

  get build() { return this.state.cars[this.state.current].build; }
  get car() { return this.db.cars[this.build.carId]; }
  // everything the stats calculator, validator and drawing need
  get view() { return { cars: this.db.cars, parts: this.db.parts, finishes: this.db.finishes, condition: this.db.condition, classes: this.db.classes, damage: this.db.damage, owned: this.state.parts }; }
  // whether the car can be driven: { ok, reasons: [plain words, for the game to show] }
  drivable(build = this.build) {
    const r = validateBuild(build, this.view), reasons = r.errors.map(e => e.message);
    // (a blown engine: the build's fine, but it won't run until it's repaired)
    for (const id of Object.values(build.sockets ?? {})) {
      const inst = id && this.state.parts[id], part = inst && this.db.parts[inst.partId];
      if (part?.engine && (inst.condition ?? 100) <= 0) reasons.push(`The ${part.name} is blown: repair it in the garage.`);
    }
    return { ok: !reasons.length, reasons };
  }
  // this car's paint: its own, else the car's factory paint
  get paint() { return this.state.cars[this.state.current].paint ?? this.car.paint ?? null; }
  stats(build = this.build) { return computeStats(build, this.view); }
  validate(build = this.build) { return validateBuild(build, this.view); }

  // An owned instance of a part that isn't fitted anywhere (a new one if there's none)
  acquire(partId) {
    if (!this.db.parts[partId]) throw new Error(`there's no part "${partId}"`);
    const fitted = new Set(Object.values(this.state.cars).flatMap(c => Object.values(c.build.sockets)));
    return Object.values(this.state.parts).find(p => p.partId === partId && !fitted.has(p.instanceId)) ?? Garage.newInstance(this.state, partId);
  }

  // The sockets a part goes in on the current car: the one asked for; else, for a part whose slot is
  // a socket group (wheels), every socket in the group; else the first empty socket of its slot (the
  // first one if they're all full: its part is swapped)
  socketsFor(partId, socket) {
    const part = this.db.parts[partId], car = this.car;
    if (socket) return [socket];
    if (car.socketGroups?.[part.slot]) return [...car.socketGroups[part.slot]];
    const all = car.sockets.filter(s => s.slot === part.slot).map(s => s.name);
    return all.length ? [all.find(s => !this.build.sockets[s]) ?? all[0]] : [];
  }

  // Fit a part (by part id or owned instance id). A part for a socket group (wheels, tyres) goes on all
  // of its sockets unless a socket is given. auto: take off whatever's in the way first (blockedBy)
  // and put it back after, as a mechanic would. Nothing changes unless it all works.
  // Returns { ok, errors, warnings, steps: [what was done], ops: [{ op: 'remove' | 'install', socket,
  // instanceId }] in the order they happened (for animating), before, after (stats) }.
  install(id, { socket, auto = true } = {}) {
    const inst = this.state.parts[id] ?? null, partId = inst ? inst.partId : id;
    if (!this.db.parts[partId]) return { ok: false, errors: [{ code: 'unknown_part', message: `There's no part "${id}".` }], warnings: [], steps: [] };
    const targets = this.socketsFor(partId, socket);
    if (!targets.length) return { ok: false, errors: [{ code: 'no_socket', message: `${this.car.name} has no ${this.db.parts[partId].slot.replace(/_/g, ' ')} socket for ${this.db.parts[partId].name}.` }], warnings: [], steps: [] };
    return this.#change(targets.map((s, i) => ({ socket: s, instance: i === 0 && inst ? inst.instanceId : null, partId })), auto);
  }

  // Take the part out of a socket, out of every socket of a group (wheels), or out of every socket
  // holding a part id. auto: as for install.
  remove(socketOrPartId, { auto = true } = {}) {
    const build = this.build, group = this.car.socketGroups?.[socketOrPartId];
    const targets = socketOrPartId in build.sockets ? [socketOrPartId]
      : group ? group.filter(s => build.sockets[s])
        : Object.entries(build.sockets).filter(([, id]) => id && this.state.parts[id]?.partId === socketOrPartId).map(([s]) => s);
    if (!targets.length) return { ok: false, errors: [{ code: 'not_fitted', message: `Nothing called "${socketOrPartId}" is fitted to ${this.car.name}.` }], warnings: [], steps: [] };
    return this.#change(targets.map(s => ({ socket: s, remove: true })), auto);
  }

  // Back to how it left the factory (the parts taken off stay owned)
  reset() {
    const build = this.build;
    for (const s of Object.keys(build.sockets)) build.sockets[s] = null;
    for (const s of this.car.sockets) build.sockets[s.name] = s.stock?.[0] ? this.acquire(s.stock[0]).instanceId : null;
    build.fingerprint = fingerprint(build, this.state.parts);
    return { ok: true, errors: [], warnings: [], steps: ['back to the stock parts'] };
  }

  // The fitted parts in a socket, a socket group (tyres) or with a part id (every one fitted)
  fittedIn(which) {
    const b = this.build.sockets, group = this.car.socketGroups?.[which];
    const sockets = which in b ? [which] : group ? group : Object.keys(b).filter(s => b[s] && this.state.parts[b[s]]?.partId === which);
    return sockets.filter(s => b[s]).map(s => ({ socket: s, instance: this.state.parts[b[s]], part: this.db.parts[this.state.parts[b[s]].partId] }));
  }

  // A fitted part's condition (0–100; which: as fittedIn)
  setCondition(which, condition) {
    const list = this.fittedIn(which);
    if (!list.length) return { ok: false, errors: [{ code: 'not_fitted', message: `Nothing called "${which}" is fitted to ${this.car.name}.` }], warnings: [] };
    if (!(condition >= 0 && condition <= 100)) return { ok: false, errors: [{ code: 'condition', message: `Condition goes from 0 to 100, not ${condition}.` }], warnings: [] };
    const before = this.stats();
    for (const f of list) f.instance.condition = condition;
    return this.#changed(before, list.map(f => `${f.part.name} (${f.socket}) now in condition ${condition}`));
  }

  // One of a fitted part's settings (its tuning). Outside its range it's clamped (the stats calculator
  // does that, and it's a warning here); value null: back to its default
  tune(which, setting, value) {
    const list = this.fittedIn(which).filter(f => f.part.tuning);
    if (!list.length) return { ok: false, errors: [{ code: 'not_tunable', message: `Nothing tunable called "${which}" is fitted to ${this.car.name} (${this.tunable().map(t => t.socket).filter((s, i, a) => a.indexOf(s) === i).join(', ') || 'no tunable parts fitted'}).` }], warnings: [] };
    const def = list[0].part.tuning[setting];
    if (!def) return { ok: false, errors: [{ code: 'no_setting', message: `${list[0].part.name} has no setting "${setting}": ${Object.keys(list[0].part.tuning).join(', ')}.` }], warnings: [] };
    if (value != null && !Number.isFinite(value)) return { ok: false, errors: [{ code: 'setting', message: `${def.label} needs a number, not "${value}".` }], warnings: [] };
    const before = this.stats(), warnings = [];
    for (const f of list) {
      if (value == null) { delete f.instance.tuning?.[setting]; if (f.instance.tuning && !Object.keys(f.instance.tuning).length) delete f.instance.tuning; }
      else f.instance.tuning = { ...f.instance.tuning, [setting]: value };
    }
    const shown = value == null ? def.default : Math.min(def.max, Math.max(def.min, value));
    if (value != null && shown !== value) warnings.push({ code: 'clamped', message: `${list[0].part.name}: ${def.label} ${value}${def.unit ? ' ' + def.unit : ''} is outside ${def.min}–${def.max}: it's ${shown}${def.unit ? ' ' + def.unit : ''}.` });
    const r = this.#changed(before, [`${list[0].part.name}: ${def.label} ${shown}${def.unit ? ' ' + def.unit : ''}`]);
    r.warnings.unshift(...warnings);
    return r;
  }

  // Every setting of the fitted tunable parts: [{ socket, part, setting, label, unit, value, min, max, step, default }]
  // (a part on a group of sockets: its first socket's settings, which the stats calculator uses)
  tunable() {
    const out = [], groups = Object.values(this.car.socketGroups || {});
    for (const [socket, id] of Object.entries(this.build.sockets)) {
      const inst = id && this.state.parts[id], part = inst && this.db.parts[inst.partId];
      if (!part?.tuning) continue;
      const group = groups.find(g => g.includes(socket));
      if (group && group.find(s => this.build.sockets[s]) !== socket) continue;
      for (const [name, t] of Object.entries(part.tuning)) out.push({ socket, part: part.id, setting: name, label: t.label, unit: t.unit ?? '', value: Math.min(t.max, Math.max(t.min, inst.tuning?.[name] ?? t.default)), min: t.min, max: t.max, step: t.step, default: t.default });
    }
    return out;
  }

  // (after condition or tuning changed: the build's new fingerprint, and what it did)
  #changed(before, steps) {
    this.build.fingerprint = fingerprint(this.build, this.state.parts);
    const r = validateBuild(this.build, this.view);
    return { ok: true, errors: [], warnings: r.warnings, steps, before, after: this.stats() };
  }

  #change(changes, auto) {
    const saved = JSON.stringify(this.state), before = this.stats();
    const build = this.build, steps = [], errors = [], warnings = [], ops = [];
    // (required sockets already empty — the tyres, after the wheels came off — don't stop other changes)
    const wasEmpty = new Set(validateBuild(build, this.view).errors.filter(e => e.code === 'required_empty').map(e => e.socket));
    const partName = sock => this.db.parts[this.state.parts[build.sockets[sock]]?.partId]?.name;
    // take off (recursively) whatever blocks a socket, remembering it to put back
    const putBack = [];
    const clear = (sock, depth = 0) => {
      const s = this.car.sockets.find(x => x.name === sock);
      for (const b of s?.blockedBy || []) {
        if (!build.sockets[b] || depth > 8) continue;
        clear(b, depth + 1);
        // (only what's in its way stops it coming off for now: whatever needs it — the clutch on the
        // gearbox's spline, when the gearbox comes off to change the clutch — is checked once
        // everything's back, at the end)
        const r = checkRemove(build, b, this.view), stop = r.errors.filter(e => e.code === 'blocked' || e.code === 'unknown_socket');
        if (stop.length) { errors.push(...stop); return; }
        putBack.push({ socket: b, instance: build.sockets[b] });
        steps.push(`took ${partName(b)} out of ${b}`);
        ops.push({ op: 'remove', socket: b, instanceId: build.sockets[b] });
        build.sockets[b] = null;
      }
    };
    for (const c of changes) {
      if (auto) clear(c.socket);
      if (errors.length) break;
      if (c.remove) {
        const r = checkRemove(build, c.socket, this.view);
        warnings.push(...r.warnings);
        if (!r.ok) { errors.push(...r.errors); break; }
        steps.push(`took ${partName(c.socket)} out of ${c.socket}`);
        ops.push({ op: 'remove', socket: c.socket, instanceId: build.sockets[c.socket] });
        build.sockets[c.socket] = null;
      } else {
        const instance = c.instance ?? this.acquire(c.partId).instanceId;
        const r = checkInstall(build, c.socket, instance, this.view);
        // (other parts' requirements may only be met once all the changes are in: check the order rules
        // now and the whole build at the end)
        const wrong = r.errors.find(e => e.code === 'wrong_slot');
        if (wrong) { errors.push(wrong); break; }
        if (r.needEmpty.length) { errors.push(...r.errors.filter(e => e.code === 'blocked')); break; }
        const old = partName(c.socket);
        if (build.sockets[c.socket]) ops.push({ op: 'remove', socket: c.socket, instanceId: build.sockets[c.socket] });
        build.sockets[c.socket] = instance;
        ops.push({ op: 'install', socket: c.socket, instanceId: instance });
        for (const [s, id] of Object.entries(build.sockets)) if (s !== c.socket && id === instance) build.sockets[s] = null;
        steps.push(`fitted ${this.db.parts[c.partId].name} in ${c.socket}${old ? ` (in place of ${old})` : ''}`);
      }
    }
    // put back what came off, last off first on — unless it can't go back (it hung on what was taken
    // out: an intake for another engine, tyres with no rims), in which case it stays off, in the parts
    // store. (Everything goes back first and what doesn't fit the car as it's now comes off again: a
    // clutch goes back before the gearbox, but fits only once the gearbox is there.)
    const leftOff = new Map(), whyOff = [];
    if (!errors.length) {
      const back = putBack.reverse();
      for (const p of back) build.sockets[p.socket] = p.instance;
      for (let round = 0; round < 12; round++) {
        const bad = validateBuild(build, this.view).errors.filter(e => e.code !== 'required_empty' && back.some(p => p.socket === e.socket) && !leftOff.has(e.socket));
        if (!bad.length) break;
        for (const e of bad) { leftOff.set(e.socket, `left ${this.db.parts[this.state.parts[build.sockets[e.socket]].partId].name} off: ${e.message}`); whyOff.push(e); build.sockets[e.socket] = null; }
      }
      for (const p of back) {
        if (leftOff.has(p.socket)) { steps.push(leftOff.get(p.socket)); continue; }
        steps.push(`put ${partName(p.socket)} back in ${p.socket}`);
        ops.push({ op: 'install', socket: p.socket, instanceId: p.instance });
      }
    }
    if (!errors.length) {
      const result = validateBuild(build, this.view);
      warnings.push(...result.warnings);
      // a removal may leave a required socket empty (fine in the garage), so may a part it left off, or
      // one that was empty already; anything else is an error
      const removed = new Set([...changes.filter(c => c.remove).map(c => c.socket), ...leftOff.keys(), ...wasEmpty]);
      for (const e of result.errors) {
        if (e.code === 'required_empty' && removed.has(e.socket)) warnings.push({ ...e, message: `${e.message} (fine while it's in the garage)` });
        else errors.push(e);
      }
      // (a part left off that others needed: why it couldn't go back is the reason, so it comes first —
      // the pistons can't come out because the turbo needs them, not because the ECU needs the turbo)
      if (errors.length && whyOff.length) errors.unshift(...whyOff);
    }
    if (errors.length) { this.state = JSON.parse(saved); return { ok: false, errors: dedupe(errors), warnings: dedupe(warnings), steps: [] }; }
    build.fingerprint = fingerprint(build, this.state.parts);
    return { ok: true, errors, warnings: dedupe(warnings), steps, ops, before, after: this.stats() };
  }
}
const dedupe = list => list.filter((w, i) => list.findIndex(x => x.message === w.message) === i);
