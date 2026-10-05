// A player's profile — the save — and what's worked out from it. Pure data (no storage, no page), so
// the same code can run in the browser, in the tests and, later, on a server.
//
//   profile: { version, money, nextId, currentCar, created, saved, hints?: [hint ids seen], xp?, quests?,
//     questLog?, questPending? (garage/player/quests.js),
//     cars: { carInstanceId: { carInstanceId, carId, price, paint?, damage?: { condition, dents,
//       dentLog, broken }, activeSetup, setups: { setupId: { setupId, name, sockets: { socket:
//       partInstanceId | null }, partIds: { socket: partId } } } } },
//     parts: { instanceId: { instanceId, partId, condition, price, tuning?, paint?, dents?, dentLog?,
//       damage?, attach?: 'loose' | 'detached', installedOn: { car, socket } | null } } }
//
// Crash damage is kept per part copy (and the car's body shell): its condition, its mechanical damage
// block, whether it's hanging loose or torn off, and its dents as an impact list (dentLog: the base the
// older hits folded into, and the hits since — garage/damageLog.js); dents is what that folds to,
// worked out again whenever the log changes and never saved. Saved, the logs are packed (packProfile:
// 16 bytes a dent) and a save loaded folds them again exactly (unpackProfile, checkProfile).
//
// Where a part is, is its installedOn: a car's build is the parts installed on it. A setup is a saved
// build (socket → part copy; partIds keeps what each was, to name it if it's gone), and a car's
// activeSetup is the one its build last came from or was saved to.

import { Garage } from '../data.js';
import { fingerprint } from '../fingerprint.js';
import { takes, validateBuild } from '../validate.js';
import { prune } from '../mechanical.js';
import { dentsOf, packLog, unpackDents } from '../damageLog.js';
import { needsWork, partWork, shellWork, workCost } from '../repair.js';
import { checkQuests } from './quests.js';

export const PROFILE_VERSION = 4;
export const clone = x => JSON.parse(JSON.stringify(x));
export const newId = (profile, prefix) => `${prefix}_${String(profile.nextId++).padStart(6, '0')}`;

// ---------- money ----------
// Straight lines between [x, y] points
export function curve(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) if (x <= points[i][0]) { const [x0, y0] = points[i - 1], [x1, y1] = points[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0 || 1); }
  return points[points.length - 1][1];
}
// A new car's price: its class's (data/economy.json carPrices) × its priceFactor, to the nearest 100;
// a car with no class, its own price
export function carPrice(db, def) {
  if (!def) return 0;
  const base = def.class && db.economy?.carPrices?.[def.class];
  return base ? Math.round(base * (def.priceFactor ?? 1) / 100) * 100 : def.price ?? 0;
}
// A part's price: its definition's, or (if that's gone) what was paid for it
export const priceOf = (db, instance) => db.parts[instance.partId]?.price ?? instance.price ?? 0;
// What a copy sells for, and what it costs to put back to 100% (garage/repair.js: its condition and
// dents, its mechanical damage — bent, leaking, worn — and bolting it back on if it came loose or off)
export const sellPrice = (db, instance) => Math.round(priceOf(db, instance) * db.economy.sell.ratio * curve(db.economy.sell.conditionCurve, instance.condition));
export const repairCost = (db, instance, kind = 'full') => workCost(partWork(db, instance), kind);
// Whether a copy needs the workshop: worn, dented, mechanically damaged, loose or torn off
export const needsRepair = needsWork;
// The body shell's repair (a car's crash damage: its condition, dents and broken glass and lights)
export const shellRepairCost = (db, car, kind = 'full') => workCost(shellWork(db, car), kind);
// (a mechanical damage block as it should be: numbers, or corners of numbers; nothing that means "fine")
export function cleanDamage(block) {
  if (!block || typeof block !== 'object' || Array.isArray(block)) return {};
  const out = {};
  for (const [k, v] of Object.entries(block)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) { const inner = Object.fromEntries(Object.entries(v).filter(([, x]) => Number.isFinite(x)).map(([j, x]) => [j, Math.min(1e3, Math.max(-1e3, x))])); if (Object.keys(inner).length) out[k] = inner; }
    else if (Number.isFinite(v)) out[k] = Math.min(1e3, Math.max(-1e3, v));
  }
  return prune(out);
}
// (a dent list as it should be: numbers, at most `most` of them)
export const cleanDents = (list, most = 64) => Array.isArray(list) ? list.filter(x => [...(x?.p ?? []), ...(x?.d ?? []), x?.s].length === 7 && [...x.p, ...x.d, x.s].every(Number.isFinite)).slice(0, most).map(x => ({ p: x.p.slice(), d: x.d.slice(), s: x.s, ...(x.w > 0 && x.w < 1 && { w: x.w }) })) : [];
// A copy's (or the shell's) dents from its log: dentLog as it should be (its base and hits, numbers),
// and dents what it folds to; neither if there are none. rules: data/damage.json
export function setDents(target, log, rules) {
  const base = cleanDents(log?.base, 64), hits = cleanDents(log?.hits, 256);
  if (!base.length && !hits.length) { delete target.dentLog; delete target.dents; return target; }
  target.dentLog = { base, hits };
  const dents = rules ? dentsOf(target.dentLog, rules) : [...base, ...hits];
  if (dents.length) target.dents = dents; else delete target.dents;
  return target;
}

// ---------- the save as stored ----------
// The profile as it's written: each dent log packed (garage/damageLog.js), the dents it folds to left out
export function packProfile(profile) {
  const out = clone(profile), pack = x => { if (x?.dentLog) x.dentLog = packLog(x.dentLog); if (x) delete x.dents; };
  for (const p of Object.values(out.parts ?? {})) pack(p);
  for (const c of Object.values(out.cars ?? {})) pack(c.damage);
  return out;
}
// …and back: each packed log unpacked (checkProfile folds them into dents again). A log already
// unpacked, or a version 2 save's dents, are left for checkProfile and the migrations
export function unpackProfile(save) {
  const out = clone(save), unpack = x => { const L = x?.dentLog; if (L && !Array.isArray(L.base) && !Array.isArray(L.hits)) x.dentLog = { base: unpackDents(L.b), hits: unpackDents(L.h) }; };
  for (const p of Object.values(out.parts ?? {})) unpack(p);
  for (const c of Object.values(out.cars ?? {})) unpack(c.damage);
  return out;
}
// How many copies make one of a part (a part for a group of sockets — wheels, tyres — comes as a set)
export function setSize(db, part, carId = null) {
  const cars = carId ? [db.cars[carId]] : Object.values(db.cars);
  return Math.max(1, ...cars.map(c => c?.socketGroups?.[part.slot]?.length ?? 1));
}

// ---------- cars and parts ----------
// A car with its stock parts (new, fitted), and a first setup of them: returns its instance id
export function addCar(profile, db, carId, price = carPrice(db, db.cars[carId])) {
  const def = db.cars[carId], id = newId(profile, 'car'), sockets = {}, partIds = {};
  for (const s of def.sockets) {
    const stock = s.stock?.[0];
    if (!stock || !db.parts[stock]) { sockets[s.name] = null; continue; }
    const pid = newId(profile, 'part');
    profile.parts[pid] = { instanceId: pid, partId: stock, condition: 100, price: db.parts[stock].price, installedOn: { car: id, socket: s.name } };
    sockets[s.name] = pid; partIds[s.name] = stock;
  }
  const setupId = newId(profile, 'setup');
  profile.cars[id] = { carInstanceId: id, carId, price, activeSetup: setupId, setups: { [setupId]: { setupId, name: 'Stock', sockets, partIds } } };
  return id;
}
export function addPart(profile, db, partId, condition = 100) {
  const id = newId(profile, 'part');
  profile.parts[id] = { instanceId: id, partId, condition, price: db.parts[partId].price, installedOn: null };
  return id;
}

// A new player: the starting car with its stock parts, and the starting money
export function newProfile(db, now = new Date().toISOString()) {
  const E = db.economy, profile = { version: PROFILE_VERSION, money: E.startingMoney, nextId: 1, currentCar: null, created: now, cars: {}, parts: {} };
  profile.currentCar = addCar(profile, db, E.startingCar);
  return profile;
}

// A car's build as it is: socket → part copy (from where each part is)
export function buildOf(profile, db, carInstanceId) {
  const car = profile.cars[carInstanceId], def = db.cars[car.carId], sockets = Object.fromEntries(def.sockets.map(s => [s.name, null]));
  for (const p of Object.values(profile.parts)) if (p.installedOn?.car === carInstanceId && p.installedOn.socket in sockets) sockets[p.installedOn.socket] = p.instanceId;
  return sockets;
}
// Copies not on any car
export const inInventory = profile => Object.values(profile.parts).filter(p => !p.installedOn);
export const carName = (profile, db, carInstanceId) => {
  const car = profile.cars[carInstanceId], def = db.cars[car?.carId], same = Object.values(profile.cars).filter(c => c.carId === car?.carId);
  return !def ? carInstanceId : same.length > 1 ? `${def.name} ${same.indexOf(car) + 1}` : def.name;
};

// ---------- the garage code's view ----------
// The profile as garage/data.js's state (builds of socket → part, owned parts): what the stats,
// validation and the Garage's own rules for fitting parts work on
export function garageStateOf(profile, db) {
  const parts = {}, cars = {};
  for (const p of Object.values(profile.parts)) {
    parts[p.instanceId] = { instanceId: p.instanceId, partId: p.partId, condition: p.condition, ...(p.tuning ? { tuning: clone(p.tuning) } : {}), ...(p.paint ? { paint: clone(p.paint) } : {}), ...(p.damage ? { damage: clone(p.damage) } : {}), ...(p.attach ? { attach: p.attach } : {}) };
  }
  for (const c of Object.values(profile.cars)) {
    if (!db.cars[c.carId]) continue;
    const build = { carId: c.carId, carInstanceId: c.carInstanceId, sockets: buildOf(profile, db, c.carInstanceId) };
    // (parts hanging loose or torn off: what the stats calculator leaves off or adds drag for)
    const attach = Object.fromEntries(Object.entries(build.sockets).filter(([, id]) => id && parts[id].attach).map(([s, id]) => [s, parts[id].attach]));
    if (Object.keys(attach).length) build.attach = attach;
    build.fingerprint = fingerprint(build, parts);
    cars[c.carInstanceId] = { carInstanceId: c.carInstanceId, carId: c.carId, build, ...(c.paint ? { paint: clone(c.paint) } : {}) };
  }
  return { version: 1, nextId: profile.nextId, parts, cars, current: profile.currentCar };
}
// A Garage on the profile, working on one of its cars
export function garageFor(profile, db, carInstanceId = profile.currentCar) {
  const state = garageStateOf(profile, db);
  state.current = carInstanceId;
  return new Garage(db, state, profile.cars[carInstanceId].carId);
}
// What a Garage changed on a car (its build, and its parts' tuning, paint and condition, its paint) back
// into the profile. Copies the Garage made that the profile doesn't have are refused (returned)
export function applyGarage(profile, garage, carInstanceId) {
  const state = garage.state, invented = Object.keys(state.parts).filter(id => !profile.parts[id]);
  if (invented.length) return invented;
  for (const [id, sp] of Object.entries(state.parts)) {
    const p = profile.parts[id];
    p.condition = sp.condition;
    if (sp.tuning && Object.keys(sp.tuning).length) p.tuning = clone(sp.tuning); else delete p.tuning;
    if (sp.paint) p.paint = clone(sp.paint); else delete p.paint;
  }
  for (const p of Object.values(profile.parts)) if (p.installedOn?.car === carInstanceId) p.installedOn = null;
  for (const [socket, id] of Object.entries(state.cars[carInstanceId].build.sockets)) if (id) profile.parts[id].installedOn = { car: carInstanceId, socket };
  const car = profile.cars[carInstanceId], paint = state.cars[carInstanceId].paint;
  if (paint) car.paint = clone(paint); else delete car.paint;
  profile.nextId = Math.max(profile.nextId, state.nextId);
  return [];
}

// How far a car's build is from its active setup: [{ socket, from (partId | null), to (partId | null) }]
export function setupChanges(profile, db, carInstanceId) {
  const car = profile.cars[carInstanceId], setup = car.setups[car.activeSetup], now = buildOf(profile, db, carInstanceId), out = [];
  if (!setup) return null;
  for (const [socket, id] of Object.entries(now)) {
    const want = setup.sockets[socket] ?? null;
    if (want !== id) out.push({ socket, from: setup.partIds?.[socket] ?? (want ? profile.parts[want]?.partId ?? null : null), to: id ? profile.parts[id].partId : null });
  }
  return out;
}

// ---------- checking a save ----------
// Everything in a profile against the current car and part definitions, put right where it can be:
// a car or part whose definition has gone is removed and what it cost refunded; parts somewhere they
// can't be go back to the inventory. Returns { profile, notices: [plain words], refunded }
export function checkProfile(input, db) {
  const profile = clone(input), notices = [];
  let refunded = 0;
  const money = v => `${db.economy.currency}${Math.round(v).toLocaleString('en-GB')}`;
  if (!(Number.isFinite(profile.money) && profile.money >= 0)) profile.money = 0;
  profile.cars ??= {}; profile.parts ??= {};
  // cars whose definition is gone
  for (const [id, car] of Object.entries(profile.cars)) {
    if (db.cars[car.carId]) continue;
    const price = car.price ?? 0;
    refunded += price; profile.money += price;
    notices.push(`A car you had ("${car.carId}") isn't in the game any more: it's gone${price ? `, and its ${money(price)} refunded` : ''}. Its parts are in your inventory.`);
    delete profile.cars[id];
  }
  // the body shells' crash damage, as it should be (its dents folded from its log again)
  for (const car of Object.values(profile.cars)) {
    const d = car.damage;
    if (!d) continue;
    const condition = Math.min(100, Math.max(0, Number.isFinite(d.condition) ? d.condition : 100)), names = new Set((db.cars[car.carId].model.breakables ?? []).map(b => b.node));
    const dents = setDents({}, d.dentLog ?? { base: d.dents }, db.damage);
    const broken = [...new Set(Array.isArray(d.broken) ? d.broken.filter(n => names.has(n)) : [])];
    if (condition >= 100 && !dents.dentLog && !broken.length) delete car.damage;
    else car.damage = { condition, ...dents, ...(broken.length && { broken }) };
  }
  // the hints the player has seen (garage/hints.js)
  if (profile.hints !== undefined) { profile.hints = Array.isArray(profile.hints) ? [...new Set(profile.hints.filter(h => typeof h === 'string' && /^[a-zA-Z0-9_]+$/.test(h)))] : []; if (!profile.hints.length) delete profile.hints; }
  // the quests played (garage/player/quests.js)
  checkQuests(profile);
  // parts whose definition is gone
  const gone = new Map();
  for (const [id, p] of Object.entries(profile.parts)) {
    if (db.parts[p.partId]) continue;
    const price = p.price ?? 0;
    refunded += price; profile.money += price;
    gone.set(p.partId, (gone.get(p.partId) ?? { n: 0, price: 0 })); gone.get(p.partId).n++; gone.get(p.partId).price += price;
    delete profile.parts[id];
  }
  for (const [partId, g] of gone) notices.push(`${g.n > 1 ? `${g.n} × ` : ''}"${partId}" isn't in the game any more: ${g.n > 1 ? 'they\'ve' : 'it\'s'} gone${g.price ? `, and ${money(g.price)} refunded` : ''}.`);
  // each part's values, and where it is
  const taken = new Set();
  for (const p of Object.values(profile.parts)) {
    const def = db.parts[p.partId];
    p.condition = Math.min(100, Math.max(0, Number.isFinite(p.condition) ? p.condition : 100));
    if (p.dentLog !== undefined || p.dents !== undefined) setDents(p, p.dentLog ?? { base: p.dents }, db.damage);
    if (p.damage !== undefined) { p.damage = cleanDamage(p.damage); if (!Object.keys(p.damage).length) delete p.damage; }
    // (hanging loose or torn off: only a part on a car, and only one that can come off — or a wheel)
    if (p.attach !== undefined && !(['loose', 'detached'].includes(p.attach) && p.installedOn && (def.detach?.detachable || ['wheels', 'wheel'].includes(def.slot)))) delete p.attach;
    if (!Number.isFinite(p.price)) p.price = def.price;
    if (p.tuning) {
      for (const [k, v] of Object.entries(p.tuning)) { const t = def.tuning?.[k]; if (!t || !Number.isFinite(v)) delete p.tuning[k]; else p.tuning[k] = Math.min(t.max, Math.max(t.min, v)); }
      if (!Object.keys(p.tuning).length) delete p.tuning;
    }
    if (p.paint?.finish && !db.finishes[p.paint.finish]) delete p.paint;
    if (!p.installedOn) { p.installedOn = null; delete p.attach; continue; }
    const car = profile.cars[p.installedOn.car], cdef = car && db.cars[car.carId], socket = cdef?.sockets.find(s => s.name === p.installedOn.socket);
    const where = `${p.installedOn.car}/${p.installedOn.socket}`;
    if (!socket || taken.has(where) || !takes(cdef, socket, def)) {
      if (car) notices.push(`${def.name} can't go where it was on your ${cdef?.name ?? 'car'} any more: it's in your inventory.`);
      p.installedOn = null;
      delete p.attach;
    } else taken.add(where);
  }
  // each car's build must hold together (bar empty sockets, fine in the garage): what makes it not,
  // comes off
  for (const car of Object.values(profile.cars)) {
    for (let round = 0; round < 12; round++) {
      const g = garageFor(profile, db, car.carInstanceId), r = validateBuild(g.build, g.view);
      const bad = r.errors.filter(e => e.code !== 'required_empty' && e.socket && g.build.sockets[e.socket]);
      if (!bad.length) break;
      const sock = bad[0].socket, p = profile.parts[g.build.sockets[sock]];
      notices.push(`${db.parts[p.partId].name} came off your ${db.cars[car.carId].name}: ${bad[0].message}`);
      p.installedOn = null;
    }
    if (car.paint && !db.finishes[car.paint.finish]?.paint) delete car.paint;
    car.setups ??= {};
    for (const s of Object.values(car.setups)) {
      const names = new Set(db.cars[car.carId].sockets.map(x => x.name));
      for (const k of Object.keys(s.sockets)) if (!names.has(k)) delete s.sockets[k];
      s.partIds ??= {};
      for (const [k, id] of Object.entries(s.sockets)) if (id && profile.parts[id] && !s.partIds[k]) s.partIds[k] = profile.parts[id].partId;
    }
    if (car.activeSetup && !car.setups[car.activeSetup]) car.activeSetup = null;
  }
  // a car to drive
  if (!Object.keys(profile.cars).length) {
    profile.currentCar = addCar(profile, db, db.economy.startingCar, 0);
    notices.push(`You had no car you can drive, so you've been given a ${db.cars[db.economy.startingCar].name}.`);
  }
  if (!profile.cars[profile.currentCar]) profile.currentCar = Object.keys(profile.cars)[0];
  // ids stay unique
  const used = [...Object.keys(profile.parts), ...Object.keys(profile.cars), ...Object.values(profile.cars).flatMap(c => Object.keys(c.setups))].map(id => +String(id).split('_').pop()).filter(Number.isFinite);
  profile.nextId = Math.max(Number.isInteger(profile.nextId) ? profile.nextId : 1, 1 + Math.max(0, ...used));
  return { profile, notices, refunded };
}
