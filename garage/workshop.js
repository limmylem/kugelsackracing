// The garage's logic (no DOM, no three.js), for the car the player has in the garage: what's in each
// socket, what fits there (the player's spare parts, and the shop's), previews of a change (worked out
// on a copy), stat comparisons with what goes into each stat, dyno runs, undo / redo, setups, and the
// money side: buying, selling and repairing. Every change is a request to the player service
// (garage/player/service.js), which checks it, makes it and saves it; this keeps the service's latest
// profile and tells the screen when it changes.
//
//   const w = new Workshop({ db, service })
//   w.partsFor('socket_turbo') · w.preview('socket_turbo', candidate) · await w.install(…) · await w.undo()

import { Garage } from './data.js';
import { takes } from './validate.js';
import { dyno } from '../physics/engine.js';
import { angleScale } from '../physics/parts.js';
import { buildOf, carName, carPrice, garageStateOf, inInventory, needsRepair, repairCost, sellPrice, setSize, setupChanges, shellRepairCost } from './player/profile.js';

const clone = x => JSON.parse(JSON.stringify(x));
const HP_PER = 1 / 7120.9;       // hp = N·m × rpm / 7120.9

// Focus areas: the rail's entries, each the sockets whose focus is one of these
export const AREAS = [
  { id: 'engine_bay', label: 'Engine bay', icon: 'car_repair', focus: ['engine_bay'] },
  { id: 'front', label: 'Front', icon: 'keyboard_double_arrow_left', focus: ['front'] },
  { id: 'rear', label: 'Rear', icon: 'keyboard_double_arrow_right', focus: ['rear', 'roof'] },
  { id: 'wheels', label: 'Wheels', icon: 'tire_repair', focus: ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'] },
  { id: 'sides', label: 'Sides', icon: 'door_front', focus: ['side_left', 'side_right'] },
  { id: 'interior', label: 'Interior', icon: 'airline_seat_recline_normal', focus: ['interior'] },
  { id: 'underside', label: 'Underside', icon: 'vertical_align_bottom', focus: ['underbody'] },
];
export const areaOf = focus => AREAS.find(a => a.focus.includes(focus))?.id ?? 'front';

// Parts with no model of their own, managed from the Systems list instead of on the car
export const SYSTEMS = [
  { name: 'Engine & induction', icon: 'settings', slots: ['intake', 'turbo', 'intercooler', 'header', 'pistons'] },
  { name: 'Drivetrain', icon: 'settings_input_component', slots: ['gearbox', 'clutch', 'flywheel', 'differential', 'differential_front', 'centre_diff', 'transfer_case'] },
  { name: 'Brakes & chassis', icon: 'do_not_disturb_on', slots: ['brakes', 'brake_pads', 'suspension', 'anti_roll_bar_front', 'anti_roll_bar_rear', 'lift_kit', 'spacer'] },
  { name: 'Electronics', icon: 'memory', slots: ['ecu'] },
  { name: 'Weight', icon: 'fitness_center', slots: ['weight_rear_seats', 'weight_sound_deadening'] },
];
const SYSTEM_SLOTS = new Set(SYSTEMS.flatMap(g => g.slots));

// An icon for a part or slot (Material Symbols)
const ICONS = { engine: 'settings', intake: 'air', turbo: 'mode_fan', intercooler: 'ac_unit', exhaust: 'mist', ecu: 'memory', gearbox: 'settings_input_component', clutch: 'motion_blur',
  differential: 'join', suspension: 'height', brakes: 'do_not_disturb_on', wheel: 'tire_repair', wheels: 'tire_repair', tyre: 'trip_origin', tyres: 'trip_origin', spacer: 'width',
  bonnet: 'directions_car', boot: 'directions_car', bumper_front: 'directions_car', bumper_rear: 'directions_car', door_left: 'door_front', door_right: 'door_front',
  fender_left: 'directions_car', fender_right: 'directions_car', skirt_left: 'horizontal_rule', skirt_right: 'horizontal_rule', mirror_left: 'flip', mirror_right: 'flip',
  seat: 'airline_seat_recline_normal', steering_wheel: 'trip_origin', spoiler: 'flight', brake_pads: 'layers', flywheel: 'radio_button_checked', header: 'call_split',
  pistons: 'unfold_more', weight_rear_seats: 'event_seat', weight_sound_deadening: 'volume_off',
  anti_roll_bar_front: 'linear_scale', anti_roll_bar_rear: 'linear_scale', differential_front: 'join', centre_diff: 'join_inner', transfer_case: 'swap_vert', lift_kit: 'vertical_align_top', roof: 'roofing', engine_cover: 'directions_car' };
export const iconFor = slot => ICONS[slot] ?? 'build';
export const conditionClass = c => c >= 70 ? 'good' : c >= 40 ? 'warn' : 'bad';
export const conditionWord = (c, part) => c >= 100 ? 'New' : c >= 70 ? 'Good' : c >= 40 ? 'Worn' : c > 0 ? 'Damaged' : part?.engine ? 'Blown' : 'Broken';

// How a socket is called on screen
export function socketLabel(def) {
  const corner = { FL: 'front left', FR: 'front right', RL: 'rear left', RR: 'rear right' };
  const m = def.name.match(/^socket_(\w+?)_(FL|FR|RL|RR)$/);
  if (m) return `${cap(m[1].replace(/_/g, ' '))}, ${corner[m[2]]}`;
  const side = def.name.match(/^socket_(\w+?)_(left|right)$/);
  if (side) return `${cap(side[1].replace(/_/g, ' '))}, ${side[2]}`;
  const special = { socket_seat_driver: "Driver's seat", socket_seat_passenger: 'Passenger seat', socket_bumper_front: 'Front bumper', socket_bumper_rear: 'Rear bumper', socket_ecu: 'ECU', socket_steering_wheel: 'Steering wheel', socket_spoiler: 'Rear wing', socket_brake_pads: 'Brake pads', socket_header: 'Exhaust header', socket_weight_rear_seats: 'Rear seats', socket_weight_sound_deadening: 'Sound deadening',
    socket_arb_front: 'Front anti-roll bar', socket_arb_rear: 'Rear anti-roll bar', socket_diff_front: 'Front differential', socket_centre_diff: 'Centre differential', socket_transfer_case: 'Transfer case', socket_lift_kit: 'Lift kit', socket_engine_cover: 'Engine cover' };
  return special[def.name] ?? cap(def.name.replace(/^socket_/, '').replace(/_/g, ' '));
}
const cap = s => s[0].toUpperCase() + s.slice(1);

export class Workshop {
  // db: the garage data (loadGarageData); service: the player service; mode: 'quick' (parts in the way
  // come off and go back on by themselves) or 'mechanic' (take them off in order)
  constructor({ db, service, mode = 'quick' }) {
    this.db = db; this.service = service; this.mode = mode;
    this.profile = service.profile;
    this.listeners = new Set();
    this.history = []; this.future = [];
    this.runs = [];
    this.statsCache = new Map();
    this.pendingTuning = null;          // a slider being dragged: { instanceId, settings } shown, not yet asked for
    this.unlisten = service.on(({ profile }) => { this.profile = profile; this.#view = null; this.#emit({ kind: 'profile' }); });
  }
  dispose() { this.unlisten?.(); }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  #emit(what) { for (const fn of this.listeners) fn(what); }

  // ---- what there is ----
  #view = null;
  get carInstanceId() { return this.profile.currentCar; }
  // the garage code's state for the profile (with a slider's setting as it's being dragged)
  get state() {
    if (!this.#view) this.#view = garageStateOf(this.profile, this.db);
    if (!this.pendingTuning) return this.#view;
    const s = clone(this.#view), p = s.parts[this.pendingTuning.instanceId];
    if (p) p.tuning = { ...p.tuning, ...this.pendingTuning.settings };
    return s;
  }
  get garage() { return new Garage(this.db, this.state, this.carDef.id); }
  get carDef() { return this.db.cars[this.profile.cars[this.carInstanceId].carId]; }
  get car() { return this.carDef; }
  get build() { return this.state.cars[this.carInstanceId].build; }
  get view() { return this.garage.view; }
  get paint() { return this.state.cars[this.carInstanceId].paint ?? this.carDef.paint ?? null; }
  get money() { return this.service.unlimited ? Infinity : this.profile.money; }
  get unlimitedMoney() { return !!this.service.unlimited; }
  get currency() { return this.db.economy.currency; }
  price(n) { return `${this.currency}${Math.round(n).toLocaleString('en-GB')}`; }
  get name() { return carName(this.profile, this.db, this.carInstanceId); }
  stats(state = this.state) {
    const build = state.cars[state.current ?? this.carInstanceId]?.build ?? state.cars[this.carInstanceId].build;
    const key = state === this.#view ? `${this.carInstanceId}|${build.fingerprint}` : null;
    if (key && this.statsCache.has(key)) return this.statsCache.get(key);
    const g = new Garage(this.db, { ...state, current: this.carInstanceId }, this.carDef.id), stats = g.stats();
    if (key) { if (this.statsCache.size > 100) this.statsCache.clear(); this.statsCache.set(key, stats); }
    return stats;
  }
  get drivable() { return this.garage.drivable(); }

  // Every socket with what's in it: { name, def, label, instance, part, condition, empty, required, area, system }
  sockets() {
    const state = this.state, build = this.build;
    return this.carDef.sockets.map(def => {
      const id = build.sockets[def.name], instance = id ? state.parts[id] : null, part = instance ? this.db.parts[instance.partId] : null;
      return { name: def.name, def, label: socketLabel(def), instance, part, condition: instance?.condition ?? null, empty: !part, required: def.required, area: areaOf(def.focus), system: SYSTEM_SLOTS.has(def.slot) };
    });
  }
  // The player's parts not on any car: [{ instance, part }] (the profile's copies)
  inventory() { return inInventory(this.profile).filter(p => this.db.parts[p.partId]).map(instance => ({ instance, part: this.db.parts[instance.partId] })); }
  // Every copy the player has, with where it is: [{ instance, part, car (name) | null, socket | null, mine (on this car) }]
  allParts() {
    return Object.values(this.profile.parts).filter(p => this.db.parts[p.partId]).map(instance => ({
      instance, part: this.db.parts[instance.partId], car: instance.installedOn ? carName(this.profile, this.db, instance.installedOn.car) : null,
      socket: instance.installedOn?.socket ?? null, mine: instance.installedOn?.car === this.carInstanceId,
      sell: sellPrice(this.db, instance), repair: repairCost(this.db, instance),
    }));
  }
  // The shop: every part still sold, with its price, how many come together, whether it goes on this
  // car and how many the player has
  catalogue() {
    const owned = new Map();
    for (const p of Object.values(this.profile.parts)) owned.set(p.partId, (owned.get(p.partId) ?? 0) + 1);
    return Object.values(this.db.parts).filter(p => !p.retired).map(part => {
      const n = setSize(this.db, part, this.carDef.id);
      return { part, set: n, price: part.price * n, fits: this.fitsCar(part), owned: owned.get(part.id) ?? 0 };
    });
  }
  // The socket to open for a part on this car: an empty one that takes it, else the first (null: none)
  socketFor(partId) {
    const part = this.db.parts[partId], group = part && this.carDef.socketGroups?.[part.slot];
    if (!part) return null;
    const list = this.carDef.sockets.filter(s => takes(this.carDef, s, part) && (!group || group.includes(s.name)));
    return (list.find(s => !this.build.sockets[s.name]) ?? list[0])?.name ?? null;
  }
  // Whether a part goes on this car as it's built (a socket for it, and it fits what's there: a 17"
  // tyre doesn't go on 15" rims) — whatever else it needs fitting first
  fitsCar(part) {
    const key = `${this.carInstanceId}|${this.build.fingerprint}`;
    if (this.fitCache?.key !== key) this.fitCache = { key, map: new Map() };
    if (!this.fitCache.map.has(part.id)) {
      const socket = this.socketFor(part.id);
      this.fitCache.map.set(part.id, !!socket && !this.#try(socket, { instanceId: null, partId: part.id }, 'quick').errors.some(e => e.code === 'does_not_fit' && e.part === part.id));
    }
    return this.fitCache.map.get(part.id);
  }
  sellPrice(instance) { return sellPrice(this.db, instance); }
  repairCost(instance) { return repairCost(this.db, instance); }
  #isGroup(part) { return !!this.carDef.socketGroups?.[part.slot]; }
  #sameGroup(a, b) { return Object.values(this.carDef.socketGroups || {}).some(g => g.includes(a) && g.includes(b)); }

  // A copy of the car's garage to try things on (the real one doesn't change): with a new copy of
  // a part the player doesn't have yet (from the shop), set up as if bought
  #scratch(extraPartIds = []) {
    const state = clone(this.state), ids = [];
    for (const partId of extraPartIds) { const id = `try_${state.nextId++}`; state.parts[id] = { instanceId: id, partId, condition: 100 }; ids.push(id); }
    return { garage: new Garage(this.db, { ...state, current: this.carInstanceId }, this.carDef.id), ids };
  }
  #try(socketName, candidate, mode = this.mode) {
    const part = this.db.parts[candidate.partId], n = this.#isGroup(part) ? this.carDef.socketGroups[part.slot].length : 1;
    const { garage, ids } = this.#scratch(candidate.instanceId ? (this.#isGroup(part) ? Array(Math.max(0, n - this.#spare(part.id))).fill(part.id) : []) : Array(n).fill(part.id));
    const result = garage.install(candidate.instanceId ?? ids[0], { socket: this.#isGroup(part) ? undefined : socketName, auto: mode === 'quick' });
    return { ok: result.ok, errors: result.errors, result, garage };
  }
  #spare(partId) { return inInventory(this.profile).filter(p => p.partId === partId).length; }

  // What can go in a socket: the player's spare copies that fit (the best of each part), and the
  // shop's parts that fit — hidden if they're for another slot or don't fit (their fits tags); shown
  // locked (with the reason) if they need something that isn't fitted or clash with something that is.
  // Each with what it would do: [{ key, instanceId (a spare copy) | null (from the shop), partId,
  // count, part, condition, owned, price, set, locked, blockers, gain, ratingChange }]
  partsFor(socketName) {
    const key = `${socketName}|${this.mode}|${this.build.fingerprint}|${this.profile.saved}|${this.profile.money}|${this.service.unlimited}`;
    if (this.partsCache?.key === key) return this.partsCache.value;
    const def = this.carDef.sockets.find(s => s.name === socketName), here = this.sockets().find(s => s.name === socketName);
    const before = this.stats(), spares = new Map(), candidates = [];
    for (const { instance, part } of this.inventory()) {
      if (!takes(this.carDef, def, part)) continue;
      const list = spares.get(part.id) ?? [];
      list.push(instance); spares.set(part.id, list);
    }
    const consider = (part, instance, count) => {
      const group = this.#isGroup(part), n = group ? this.carDef.socketGroups[part.slot].length : 1;
      const owned = !!instance && (!group || count >= n), cand = { instanceId: owned ? instance.instanceId : null, partId: part.id };
      const trial = this.#try(socketName, cand, 'quick');
      if (trial.errors.some(e => e.code === 'does_not_fit' && e.part === part.id)) return;
      const soon = !owned && part.todo?.length;
      const locked = soon ? { kind: 'todo', text: 'Not in the shop yet: its price and stats are still to do' } : trial.ok ? null : reason(trial.errors), after = trial.ok ? trial.garage.stats() : null;
      candidates.push({ key: owned ? instance.instanceId : `shop:${part.id}`, instanceId: cand.instanceId, partId: part.id, count: owned ? count : 0, part, condition: owned ? instance.condition ?? 100 : 100, owned,
        set: n, price: part.price * n, affordable: owned || this.money >= part.price * n,
        locked, blockers: trial.ok ? trial.result.ops.filter(o => o.op === 'remove' && o.socket !== socketName && !this.#sameGroup(o.socket, socketName)).map(o => o.socket) : [],
        gain: after ? gains(before, after) : [], ratingChange: after?.totals?.rating && before.totals?.rating ? after.totals.rating.index - before.totals.rating.index : 0 });
    };
    for (const [partId, list] of spares) { list.sort((a, b) => b.condition - a.condition); consider(this.db.parts[partId], list[0], list.length); }
    // (the shop's: parts the player has no spare of — or not enough for a set)
    for (const part of Object.values(this.db.parts)) {
      if (part.retired || !takes(this.carDef, def, part) || (spares.get(part.id)?.length ?? 0) >= setSize(this.db, part, this.carDef.id)) continue;
      if (here.part?.id === part.id) continue;
      consider(part, null, 0);
    }
    const value = { socket: here, candidates };
    this.partsCache = { key, value };
    return value;
  }

  // What fitting a candidate would do (worked out on a copy): { ok, errors, reason, before, after, rows, warnings, ops }
  preview(socketName, candidate) {
    const t = this.#try(socketName, candidate), before = this.stats();
    if (!t.ok) return { ok: false, errors: t.errors, reason: reason(t.errors), before, after: null, rows: [] };
    const after = t.garage.stats();
    return { ok: true, errors: [], before, after, rows: compareStats(before, after, this.db, this.state, t.garage.state), warnings: t.result.warnings, ops: t.result.ops };
  }
  // The same for taking a part off
  previewRemove(socketName) {
    const { garage: g } = this.#scratch(), result = g.remove(socketName, { auto: this.mode === 'quick' }), before = this.stats();
    if (!result.ok) return { ok: false, errors: result.errors, reason: reason(result.errors), before, after: null, rows: [] };
    const after = g.stats();
    return { ok: true, before, after, rows: after.spec ? compareStats(before, after, this.db, this.state, g.state) : [], warnings: result.warnings, ops: result.ops };
  }

  // ---- changing the car (each can be undone, while its parts are still the player's) ----
  // how the car is now, to come back to
  #snapshot() {
    const sockets = buildOf(this.profile, this.db, this.carInstanceId), tuning = {}, partPaint = {};
    for (const id of Object.values(sockets)) if (id) { tuning[id] = clone(this.profile.parts[id].tuning ?? null); partPaint[id] = clone(this.profile.parts[id].paint ?? null); }
    const car = this.profile.cars[this.carInstanceId];
    return { car: this.carInstanceId, sockets, tuning, partPaint, paint: clone(car.paint ?? null), activeSetup: car.activeSetup ?? null };
  }
  async #change(label, kind, ask, { merge = null } = {}) {
    const snapshot = this.#snapshot(), r = await ask();
    if (!r.ok) { this.#emit({ kind: 'failed', label, result: r }); return r; }
    const last = this.history[this.history.length - 1];
    if (!(merge && last?.merge === merge)) this.history.push({ label, kind, snapshot, merge });
    if (this.history.length > 60) this.history.shift();
    this.future = [];
    this.#emit({ kind, label, result: r });
    return r;
  }
  // parts: a candidate from partsFor (a spare copy, or the shop's — bought and fitted in one go)
  install(socketName, candidate) {
    const part = this.db.parts[candidate.partId], socket = this.#isGroup(part) ? undefined : socketName, auto = this.mode === 'quick';
    return this.#change(`${part.name} fitted`, 'parts', () => candidate.instanceId
      ? this.service.installPart(this.carInstanceId, candidate.instanceId, { socket, auto })
      : this.service.buyAndInstall(this.carInstanceId, part.id, { socket, auto }));
  }
  remove(socketName) {
    const here = this.sockets().find(s => s.name === socketName);
    return this.#change(`${here?.part?.name ?? socketName} taken off`, 'parts', () => this.service.removePart(this.carInstanceId, socketName, { auto: this.mode === 'quick' }));
  }
  // tuning: while a slider's dragged it's shown straight away; the setting is asked for when it's let go
  tune(socketName, setting, value, { drag = false } = {}) {
    const id = this.build.sockets[socketName];
    if (!id) return Promise.resolve({ ok: false, error: 'Nothing fitted there.' });
    if (drag) { this.pendingTuning = { instanceId: id, settings: { ...(this.pendingTuning?.instanceId === id ? this.pendingTuning.settings : {}), [setting]: value } }; this.#emit({ kind: 'tuning', live: true }); return Promise.resolve({ ok: true }); }
    this.pendingTuning = null;
    const t = this.garage.tunable().find(x => x.socket === socketName && x.setting === setting);
    return this.#change(`${t?.label ?? setting} ${value}${t?.unit ? ' ' + t.unit : ''}`, 'tuning', () => this.service.setTuning(id, { [setting]: value }));
  }
  async endDrag() {
    const pending = this.pendingTuning;
    if (!pending) return;
    const socket = Object.entries(this.build.sockets).find(([, id]) => id === pending.instanceId)?.[0];
    this.pendingTuning = null;
    await this.#change('tuning', 'tuning', () => this.service.setTuning(pending.instanceId, pending.settings));
  }
  // every setting back to its default (one socket's, or all)
  resetTuning(socketName) {
    const rows = this.garage.tunable().filter(t => !socketName || t.socket === socketName), bySocket = new Map();
    for (const t of rows) { const id = this.build.sockets[t.socket]; bySocket.set(id, { ...(bySocket.get(id) ?? {}), [t.setting]: null }); }
    return this.#change('tuning back to defaults', 'tuning', async () => { let r = { ok: true }; for (const [id, settings] of bySocket) { r = await this.service.setTuning(id, settings); if (!r.ok) break; } return r; });
  }
  setPaint(paint) { return this.#change(`paint ${paint.colour} ${paint.finish}`, 'paint', () => this.service.setPaint(this.carInstanceId, paint)); }
  // a fitted part's own finish / colour (which: a socket or socket group; look null: follows the car)
  paintPart(which, look) {
    const ids = this.garage.fittedIn(which).map(f => f.instance.instanceId);
    return this.#change(`${which} ${look?.finish ?? 'paint'}`, 'paint', () => this.service.setPartFinish(ids, look));
  }

  get canUndo() { return this.history.length > 0; }
  get canRedo() { return this.future.length > 0; }
  async #restore(from, to) {
    const h = from.pop();
    if (!h) return null;
    const now = this.#snapshot(), r = await this.service.setBuild(h.snapshot.car, h.snapshot);
    if (!r.ok) { this.#emit({ kind: 'failed', label: h.label, result: r }); return r; }
    to.push({ label: h.label, kind: h.kind, snapshot: now });
    this.#emit({ kind: h.kind, label: h.label, restored: true });
    return r;
  }
  undo() { return this.#restore(this.history, this.future); }
  redo() { return this.#restore(this.future, this.history); }

  // ---- setups ----
  get setups() { const car = this.profile.cars[this.carInstanceId]; return Object.values(car.setups).map(s => ({ ...s, active: s.setupId === car.activeSetup })); }
  get activeSetup() { const car = this.profile.cars[this.carInstanceId]; return car.setups[car.activeSetup] ?? null; }
  // How the build differs from its setup: [{ icon, text }]
  changes() {
    const list = setupChanges(this.profile, this.db, this.carInstanceId);
    if (!list) return [];
    const done = new Set(), out = [];
    for (const c of list) {
      if (done.has(c.socket)) continue;
      const group = Object.values(this.carDef.socketGroups || {}).find(g => g.includes(c.socket)) ?? [c.socket];
      const same = list.filter(x => group.includes(x.socket) && x.from === c.from && x.to === c.to);
      same.forEach(x => done.add(x.socket));
      const def = this.carDef.sockets.find(s => s.name === c.socket), n = same.length > 1 ? `${same.length} × ` : '', name = id => this.db.parts[id]?.name ?? id;
      out.push({ icon: iconFor(def.slot), text: c.to ? `${n}${name(c.to)}${c.from ? ` (setup: ${name(c.from)})` : ' (setup: empty)'}` : `${n}${name(c.from)} taken off` });
    }
    return out;
  }
  get modified() { return this.changes().length > 0; }
  saveSetup(name) {
    const active = this.activeSetup;
    return this.service.saveSetup(this.carInstanceId, active && name === undefined ? { setupId: active.setupId } : { name: name ?? 'My setup' });
  }
  saveSetupAs(name) { return this.service.saveSetup(this.carInstanceId, { name }); }
  renameSetup(setupId, name) { return this.service.renameSetup(this.carInstanceId, setupId, name); }
  deleteSetup(setupId) { return this.service.deleteSetup(this.carInstanceId, setupId); }
  async switchSetup(setupId, { force = false } = {}) {
    const r = await this.#change('setup switched', 'parts', () => this.service.switchSetup(this.carInstanceId, setupId, { force }));
    return r;
  }

  // ---- money ----
  buy(partId) { return this.service.buyPart(partId); }
  sell(instanceId) { return this.service.sellPart(instanceId); }
  repair(instanceId) { return this.service.repairPart(instanceId); }
  // everything on this car that isn't at 100%: its cost, and repairing it
  repairParts(instanceIds) { return this.service.repairParts(instanceIds); }
  // (a copy that needs a repair: worn, or dented)
  needsRepair(instanceId) { return needsRepair(this.profile.parts[instanceId]); }
  // This car's crash damage, for the drawing: { shell, parts: { socket: dents } }
  get damage() {
    const parts = {};
    for (const [socket, id] of Object.entries(this.build.sockets)) if (id && this.profile.parts[id]?.dents?.length) parts[socket] = this.profile.parts[id].dents;
    return { shell: this.profile.cars[this.carInstanceId]?.damage ?? null, parts };
  }
  // The body shell (the car without its parts): its crash damage and what repairing it costs
  get body() { const car = this.profile.cars[this.carInstanceId], d = car?.damage; return { condition: d?.condition ?? 100, dents: d?.dents?.length ?? 0, broken: d?.broken ?? [], cost: shellRepairCost(this.db, car) }; }
  repairBody() { return this.service.repairBody(this.carInstanceId); }
  #worn() { return this.sockets().filter(s => s.instance && this.needsRepair(s.instance.instanceId)).map(s => s.instance.instanceId); }
  get repairAllCost() { return this.#worn().reduce((a, id) => a + repairCost(this.db, this.profile.parts[id]), 0) + this.body.cost; }
  // every part on the car and its body (two changes: the parts, then the body)
  async repairAll() {
    const ids = this.#worn(), body = this.body.cost;
    let cost = 0, repaired = 0;
    if (ids.length) { const r = await this.service.repairParts(ids); if (!r.ok) return r; cost += r.cost; repaired += r.repaired; }
    if (body) { const r = await this.service.repairBody(this.carInstanceId); if (!r.ok) return { ...r, cost, repaired }; cost += r.cost; repaired++; }
    return { ok: true, error: null, cost, repaired };
  }

  // ---- cars ----
  cars() {
    return Object.values(this.profile.cars).map(c => {
      const g = new Garage(this.db, { ...this.#view ?? garageStateOf(this.profile, this.db), current: c.carInstanceId }, c.carId), stats = g.stats();
      return { carInstanceId: c.carInstanceId, name: carName(this.profile, this.db, c.carInstanceId), def: this.db.cars[c.carId], setup: c.setups[c.activeSetup]?.name ?? null, current: c.carInstanceId === this.carInstanceId, rating: stats.totals?.rating ?? null };
    });
  }
  dealer() { return Object.values(this.db.cars).map(def => { const price = carPrice(this.db, def); return { def, price, affordable: this.money >= price }; }); }
  async selectCar(carInstanceId) {
    const r = await this.service.selectCar(carInstanceId);
    if (r.ok) { this.history = []; this.future = []; this.runs = []; }
    return r;
  }
  buyCar(carId) { return this.service.buyCar(carId); }

  // ---- the save ----
  saveNow() { return this.service.save(); }
  exportSave() { return this.service.exportSave(); }
  // (a different profile: nothing to undo into)
  async importSave(json) {
    const r = await this.service.importSave(json);
    if (r.ok) { this.history = []; this.future = []; this.runs = []; }
    return r;
  }

  // ---- tuning ----
  tunable() { return this.garage.tunable(); }
  // tunable parts the player has spare (their settings would appear once fitted)
  tunableInInventory() {
    const fitted = new Set(this.tunable().map(t => t.part));
    return [...new Map(this.inventory().filter(({ part }) => part.tuning && !fitted.has(part.id)).map(x => [x.part.id, x.part])).values()];
  }

  // ---- dyno ----
  // A run on the chassis dyno (at the wheels: the engine's curve × the drivetrain's efficiency):
  // { id, name, note, points: [{ rpm, nm, hp }], peakPower, peakTorque }
  dynoRun(note) {
    const s = this.stats();
    if (!s.spec) return null;
    const eff = s.spec.drivetrain.efficiency;
    const points = dyno(s.spec.engine, 50).map(p => ({ rpm: p.rpm, nm: p.torque * eff, hp: p.hp * eff }));
    const peakPower = points.reduce((a, p) => p.hp > a.hp ? p : a), peakTorque = points.reduce((a, p) => p.nm > a.nm ? p : a);
    const run = { id: this.runs.length + 1, name: `Run ${this.runs.length + 1}`, note: note ?? (this.runs.length ? this.#sinceLastRun() : 'As it came in'), points, peakPower, peakTorque, redline: s.spec.engine.redlineRpm, fingerprint: this.build.fingerprint, build: this.#snapshot() };
    this.runs.unshift(run);
    return run;
  }
  // what changed since the run before
  #sinceLastRun() {
    const was = this.runs[0].build.sockets, now = buildOf(this.profile, this.db, this.carInstanceId), out = [];
    for (const [socket, id] of Object.entries(now)) {
      const a = was[socket] ? this.profile.parts[was[socket]]?.partId : null, b = id ? this.profile.parts[id].partId : null;
      if (a !== b) out.push(b ? `${this.db.parts[b].name} fitted` : `${this.db.parts[a]?.name ?? 'a part'} taken off`);
    }
    const tuned = Object.entries(this.runs[0].build.tuning).some(([id, t]) => JSON.stringify(t) !== JSON.stringify(this.profile.parts[id]?.tuning ?? null));
    if (tuned) out.push('tuning changed');
    const uniq = [...new Set(out)];
    return !uniq.length ? 'The same build' : uniq.length === 1 ? uniq[0] : `${uniq[0]} +${uniq.length - 1} more`;
  }
}

// ---------- comparing two stats ----------

// Short reason a part can't go on: from the validator's errors
function reason(errors) {
  const e = errors.find(x => x.code === 'requires') ?? errors.find(x => x.code === 'conflicts') ?? errors[0];
  if (!e) return null;
  const req = e.message.match(/needs (.+) fitted too/), clash = e.message.match(/can't be fitted with (.+?) \(/);
  if (req) return { kind: 'requires', text: `Requires: ${req[1].replace(/^an? /, '').replace(/^"(.+)"$/, '$1')}` };
  if (clash) return { kind: 'conflicts', text: `Conflicts with: ${clash[1]}` };
  if (e.code === 'blocked') return { kind: 'blocked', text: e.message };
  return { kind: 'other', text: e.message };
}

// The stats a player cares about, from the stats calculator's totals: value, unit, which way is better
export const STAT_KEYS = [
  { key: 'power', label: 'Power', unit: 'hp', dec: 0, up: true, of: s => s.totals?.peakPower.hp },
  { key: 'torque', label: 'Torque', unit: 'Nm', dec: 0, up: true, of: s => s.totals?.peakTorque.nm },
  { key: 'weight', label: 'Weight', unit: 'kg', dec: 0, up: false, of: s => s.spec?.mass },
  { key: 'grip', label: 'Grip', unit: 'g', dec: 2, up: true, of: s => s.totals?.rating?.estimates.grip },
  { key: 'braking', label: 'Braking', unit: 'm', dec: 1, up: false, of: s => s.totals?.rating?.estimates.braking },
  { key: 'top', label: 'Top speed', unit: 'km/h', dec: 0, up: true, of: s => s.totals?.topSpeed.kmh },
  { key: 'accel', label: '0–100', unit: 's', dec: 1, up: false, of: s => s.totals?.rating?.estimates.zeroTo100 },
  { key: 'rating', label: 'Performance rating', unit: '', dec: 0, up: true, of: s => s.totals?.rating?.index },
];

// The main things a part changes, in a few words ("+62 hp", "−7 kg")
function gains(before, after) {
  const out = [];
  for (const k of STAT_KEYS) {
    if (k.key === 'rating') continue;
    const a = k.of(before), b = k.of(after);
    if (a == null || b == null) continue;
    const d = b - a, shown = +d.toFixed(k.dec);
    if (!shown) continue;
    out.push({ key: k.key, text: `${shown > 0 ? '+' : '−'}${Math.abs(shown).toFixed(k.dec)} ${k.unit}`.trim(), better: k.up ? d > 0 : d < 0, weight: Math.abs(d / a) });
  }
  return out.sort((x, y) => y.weight - x.weight).slice(0, 2);
}

// Current vs new for each stat, with what contributes to it: [{ key, label, unit, dec, up, cur, next,
// delta, better, breakdown: [{ name, sub, value (text), amount (for the bar), effect: 'base' | 'better' | 'worse' | 'none' }], note }]
export function compareStats(before, after, db, stateBefore, stateAfter) {
  return STAT_KEYS.map(k => {
    const cur = k.of(before), next = k.of(after), delta = cur != null && next != null ? next - cur : null;
    const rounded = delta == null ? 0 : +delta.toFixed(k.dec);
    return { ...k, cur, next, delta, better: rounded === 0 ? null : k.up ? delta > 0 : delta < 0, breakdown: breakdownOf(k.key, before, after, db, stateBefore, stateAfter) };
  });
}

// What makes up a stat on the new build (and what changed it from the current one)
function breakdownOf(key, before, after, db, stateBefore, stateAfter) {
  const S = after.spec;
  if (!S) return [];
  const rows = [], row = (name, sub, amount, up) => rows.push({ name, sub, amount, effect: up === null ? 'base' : amount === 0 ? 'none' : (up ? amount > 0 : amount < 0) ? 'better' : 'worse' });
  const partChanges = () => {
    const out = [], a = stateBefore.cars[stateBefore.current].build.sockets, b = stateAfter.cars[stateAfter.current].build.sockets;
    for (const s of Object.keys(b)) {
      const pa = a[s] ? db.parts[stateBefore.parts[a[s]]?.partId] : null, pb = b[s] ? db.parts[stateAfter.parts[b[s]]?.partId] : null;
      if (pa?.id !== pb?.id) out.push({ socket: s, from: pa, to: pb });
    }
    return out;
  };
  if (key === 'power' || key === 'torque') {
    // the torque curve at its peak: the engine, then every part and condition that changed it
    const rpm = key === 'power' ? after.totals.peakPower.rpm : after.totals.peakTorque.rpm, curve = S.engine.torqueCurve;
    let i = 0; for (let j = 1; j < curve.length; j++) if (Math.abs(curve[j][0] - rpm) < Math.abs(curve[i][0] - rpm)) i = j;
    const at = curve[i][0], conv = key === 'power' ? v => v * at * HP_PER : v => v;
    for (const st of after.breakdown[`engine.torqueCurve.${i}.1`] ?? []) {
      if (st.step === 'component') row(st.source.name, `at ${at} rpm`, conv(st.to), null);
      else row(st.source.name, st.step === 'condition' ? st.note : st.note ?? (st.step === 'boost' ? 'boost' : st.step === 'multiply' ? `×${(st.to / st.from).toFixed(3)}` : st.step), conv(st.to - st.from), true);
    }
  } else if (key === 'weight') {
    row('Car as it is', '', before.spec?.mass ?? 0, null);
    for (const c of partChanges()) {
      const m = (c.to?.mass ?? 0) - (c.from?.mass ?? 0);
      if (m) row(c.to ? c.to.name : `without ${c.from.name}`, c.from && c.to ? `in place of ${c.from.name}` : c.to ? 'fitted' : 'taken off', m, false);
    }
  } else if (key === 'grip') {
    for (const st of after.breakdown['tyre.lateral.D'] ?? []) {
      if (st.step === 'component') row(st.source.name, 'the tyres\' grip', st.to, null);
      else row(st.source.name, st.note ?? st.step, st.to - st.from, true);
    }
    const E = after.totals.rating.estimates, down = E.grip - S.tyre.lateral.D;
    row('Downforce and weight transfer', 'at 120 km/h, the body rolling', down, true);
  } else {
    // everything else comes from the car as a whole: how its main numbers changed
    const f = s => {
      if (!s.spec) return null;
      let cd = s.spec.aero.dragCoefficient, down = -(s.spec.aero.front.liftCoefficient + s.spec.aero.rear.liftCoefficient);
      for (const a of s.spec.aeroParts || []) { const k = angleScale(a.part.aero, a.angle); cd += a.part.aero.dragCoefficient * k; down += -a.part.aero.liftCoefficient * k; }
      return { power: s.totals.peakPower.hp, mass: s.spec.mass, grip: s.totals.rating.estimates.grip, cd, down, gear: s.spec.gearbox.finalDrive * s.spec.gearbox.ratios[0] / s.spec.wheels.radius, fade: s.spec.brakes.fade.startTemp, radius: s.spec.wheels.radius * 1000 };
    };
    const A = f(before), B = f(after);
    const factors = {
      top: [['Power', 'peak', 'power', 'hp', 0, true], ['Drag', 'drag coefficient', 'cd', '', 3, false], ['Wheel size', 'radius', 'radius', 'mm', 0, true]],
      accel: [['Power', 'peak', 'power', 'hp', 0, true], ['Weight', '', 'mass', 'kg', 0, false], ['Grip', 'the tyres', 'grip', 'g', 2, true], ['Gearing', '1st gear, at the wheels', 'gear', '', 1, true]],
      braking: [['Grip', 'the tyres', 'grip', 'g', 2, true], ['Weight', '', 'mass', 'kg', 0, false], ['Brake fade', 'starts at', 'fade', '°C', 0, true], ['Downforce', 'lift coefficient', 'down', '', 3, true]],
      rating: [['Power', 'peak', 'power', 'hp', 0, true], ['Weight', '', 'mass', 'kg', 0, false], ['Grip', 'the tyres', 'grip', 'g', 2, true], ['Drag', 'drag coefficient', 'cd', '', 3, false]],
    }[key];
    for (const [name, sub, k, unit, dec, up] of factors) {
      if (!A || !B) continue;
      const d = +(B[k] - A[k]).toFixed(dec + 1);
      row(name, `${sub ? sub + ': ' : ''}${A[k].toFixed(dec)} → ${B[k].toFixed(dec)}${unit ? ' ' + unit : ''}`, d, up);
    }
  }
  return rows;
}

