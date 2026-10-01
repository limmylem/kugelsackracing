// Checks a build and says, in plain words, what's wrong (errors: the car can't be built like this)
// and what's worth knowing (warnings):
//  - each part in a socket of its own slot type, or of the socket group its slot names (wheels: every
//    wheel socket)
//  - fits: every tag a part lists must be offered by the car, the socket, or another fitted part (a
//    list inside fits means any one of those)
//  - requires: "slot:x" needs something fitted in an x socket; any other entry is a tag that has to be
//    offered by the car or a fitted part (a list inside requires means any one of those)
//  - conflicts: "slot:x" (anything in an x socket), "part:id", or a tag offered by the car / a part
//  - required sockets filled (the car can't drive without them)
//  - what the stats calculator can't build (tyres that don't match, a modifier aimed at nothing)
// and, for changing one socket (checkInstall / checkRemove), the order rules: every socket in that
// socket's blockedBy has to be empty first, and nothing still fitted may depend on what comes off.
//
// Each problem: { code, socket?, part?, message }.

import { computeStats, fittedParts } from './stats.js';

const label = (f) => `${f.part.name} (${f.socket.name})`;

// Whether a part goes in a socket: the socket's slot type, or a group of sockets (car.socketGroups) it's in
export const takes = (car, socket, part) => part.slot === socket.slot || !!car.socketGroups?.[part.slot]?.includes(socket.name);
// (in words: "is a turbo part" / "goes on the wheels (4 sockets)")
const whatItIs = (car, part) => car.socketGroups?.[part.slot] ? `goes on the ${part.slot.replace(/_/g, ' ')} (${car.socketGroups[part.slot].length} sockets)` : `is ${a(part.slot)} part`;
const wrongSlot = (car, socket, part) => ({ code: 'wrong_slot', socket: socket.name, part: part.id, message: `${part.name} ${whatItIs(car, part)}: it doesn't go in ${socket.name}, which takes ${a(socket.slot)}.` });
// a socket of a slot type or group
const inSlot = (car, socket, slot) => socket.slot === slot || !!car.socketGroups?.[slot]?.includes(socket.name);

// Tags on offer to a part in a socket: the car's, the socket's, and everything the other fitted parts provide
function tagsFor(fitted, car, except) {
  const tags = new Set([...(car.tags || []), ...(except?.socket.tags || [])]);
  for (const f of fitted) if (f.part && f !== except) for (const t of f.part.provides || []) tags.add(t);
  return tags;
}
// what a need is, in words: a slot ("an intercooler"), a part (its name), or a tag — by the parts that
// provide it ("Forged pistons and rods", "Sport clutch or Race clutch (twin-plate)")
const describe = (t, db) => t.startsWith('slot:') ? a(t.slice(5)) : t.startsWith('part:') ? (db?.parts[t.slice(5)]?.name ?? `the part "${t.slice(5)}"`) : TAG_WORDS[t] ?? providers(t, db) ?? `"${t}"`;
// (needs better said in words than by the parts that meet them)
const TAG_WORDS = {
  'induction:turbo': 'a turbocharged engine', 'rim_width:wide': 'wider wheels (deep-dish rims or spacers)', 'seat:bucket': 'a bucket seat',
  'cooling:uprated': 'an uprated radiator', 'gearbox:uprated': 'an uprated gearbox', 'clutch:uprated': 'an uprated clutch', 'bonnet:scoop': 'a scoop bonnet',
};
function providers(tag, db) {
  const names = Object.values(db?.parts ?? {}).filter(p => !p.retired && p.provides?.includes(tag)).sort((x, y) => x.price - y.price).map(p => p.name);
  return !names.length ? null : names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} or ${names[1]}` : `a part like ${names[0]}`;
}

export function validateBuild(build, db) {
  const errors = [], warnings = [];
  const car = db.cars[build.carId];
  if (!car) return { ok: false, errors: [{ code: 'unknown_car', message: `There's no car "${build.carId}".` }], warnings };
  const known = new Set(car.sockets.map(s => s.name));
  for (const name of Object.keys(build.sockets || {})) if (!known.has(name)) errors.push({ code: 'unknown_socket', socket: name, message: `${car.name} has no socket "${name}".` });
  const used = new Map();
  for (const [name, id] of Object.entries(build.sockets || {})) {
    if (!id) continue;
    if (!db.owned[id]) { errors.push({ code: 'unknown_instance', socket: name, message: `${name} holds a part instance "${id}" that isn't owned.` }); continue; }
    if (!db.parts[db.owned[id].partId]) errors.push({ code: 'unknown_part', socket: name, message: `${name} holds "${db.owned[id].partId}", which isn't a known part.` });
    if (used.has(id)) errors.push({ code: 'instance_twice', socket: name, message: `The same ${db.parts[db.owned[id].partId]?.name ?? 'part'} is in both ${used.get(id)} and ${name}.` });
    used.set(id, name);
  }
  const fitted = fittedParts(build, db), filled = fitted.filter(f => f.part);
  const allTags = tagsFor(filled, car, null);
  const slotFilled = slot => filled.some(f => inSlot(car, f.socket, slot));

  for (const f of fitted) {
    if (!f.part) {
      if (f.socket.required) errors.push({ code: 'required_empty', socket: f.socket.name, message: `Nothing in ${f.socket.name}: the car can't drive without ${a(f.socket.slot)}.` });
      continue;
    }
    const p = f.part;
    if (!takes(car, f.socket, p)) { errors.push(wrongSlot(car, f.socket, p)); continue; }
    const offered = tagsFor(filled, car, f);
    for (const need of p.fits || []) {
      const any = [].concat(need);
      if (!any.some(t => offered.has(t))) {
        const from = any.map(t => providers(t, db)).filter(Boolean);
        errors.push({ code: 'does_not_fit', socket: f.socket.name, part: p.id, need: any, message: `${label(f)} doesn't fit: it needs ${any.map(t => `"${t}"`).join(' or ')}${from.length ? ` (${from.join('; or ')} ${from.length > 1 || / or /.test(from[0]) ? 'offer' : 'offers'} it)` : ''}, and nothing on the car offers ${any.length > 1 ? 'any of those' : 'it'}.` });
      }
    }
    for (const need of p.requires || []) {
      // (a list: any one of them)
      const any = [].concat(need), met = t => t.startsWith('slot:') ? slotFilled(t.slice(5)) : allTags.has(t) && !(p.provides || []).includes(t);
      if (!any.some(met)) errors.push({ code: 'requires', socket: f.socket.name, part: p.id, need, message: `${label(f)} needs ${any.map(t => describe(t, db)).join(' or ')} fitted too.` });
    }
    for (const bad of p.conflicts || []) {
      const clash = bad.startsWith('slot:') ? filled.find(g => g !== f && inSlot(car, g.socket, bad.slice(5)))
        : bad.startsWith('part:') ? filled.find(g => g !== f && g.part.id === bad.slice(5))
          : filled.find(g => g !== f && (g.part.provides || []).includes(bad)) || ((car.tags || []).includes(bad) ? { part: { name: car.name }, socket: { name: 'the car' } } : null);
      if (clash) errors.push({ code: 'conflicts', socket: f.socket.name, part: p.id, message: `${label(f)} can't be fitted with ${clash.part.name} (${clash.socket.name}): they conflict (${bad}).` });
    }
    if (f.instance && f.instance.condition < 25) warnings.push({ code: 'worn', socket: f.socket.name, part: p.id, message: `${label(f)} is worn out (condition ${f.instance.condition}).` });
  }
  if (errors.length) return { ok: false, errors, warnings };

  // what the numbers say
  const stats = computeStats(build, db);
  for (const e of stats.errors) errors.push({ code: 'stats', message: e[0].toUpperCase() + e.slice(1) + '.' });
  if (stats.spec) {
    const peak = stats.totals.peakTorque.nm, clutch = stats.spec.clutch.maxTorque;
    if (peak > clutch) warnings.push({ code: 'clutch_slips', socket: 'socket_clutch', message: `The engine now makes ${peak.toFixed(0)} N·m but the clutch holds ${Math.round(clutch)}: it will slip under full throttle.` });
    // tuning outside a setting's range (it's clamped), and settings a part hasn't got
    for (const t of stats.totals.tuning) if (t.clamped) warnings.push({ code: 'clamped', socket: t.socket, part: t.part, message: `${db.parts[t.part].name}: ${t.label} ${t.asked}${t.unit ? ' ' + t.unit : ''} is outside ${t.min}–${t.max}, so it's ${t.value}${t.unit ? ' ' + t.unit : ''}.` });
  }
  for (const f of filled) for (const k of Object.keys(f.instance?.tuning || {})) if (!f.part.tuning?.[k]) warnings.push({ code: 'no_setting', socket: f.socket.name, part: f.part.id, message: `${label(f)} has no setting "${k}" (ignored).` });
  return { ok: !errors.length, errors, warnings, stats };
}
const a = slot => `${/^[aeiou]/.test(slot) ? 'an' : 'a'} ${slot.replace(/_/g, ' ')}`;

// Order rules for changing one socket: the sockets in its blockedBy have to be empty first
function blockers(build, db, socketName) {
  const car = db.cars[build.carId], socket = car.sockets.find(s => s.name === socketName);
  return (socket?.blockedBy || []).filter(s => build.sockets?.[s]);
}

// Fit (or swap in) a part instance at a socket. The result says what's wrong with doing it now: other
// sockets to empty first (needEmpty), and what the build would be like afterwards.
export function checkInstall(build, socketName, instanceId, db) {
  const car = db.cars[build.carId], socket = car?.sockets.find(s => s.name === socketName);
  if (!socket) return { ok: false, errors: [{ code: 'unknown_socket', socket: socketName, message: `${car?.name ?? build.carId} has no socket "${socketName}".` }], warnings: [], needEmpty: [] };
  // the wrong kind of part for the socket: that's all there is to say
  const part = db.parts[db.owned[instanceId]?.partId];
  if (part && !takes(car, socket, part)) return { ok: false, errors: [wrongSlot(car, socket, part)], warnings: [], needEmpty: [] };
  const needEmpty = blockers(build, db, socketName), errors = [];
  for (const s of needEmpty) errors.push({ code: 'blocked', socket: socketName, message: `Take ${nameAt(build, db, s)} out of ${s} first: it's in the way of ${socketName}.` });
  const after = { ...build, sockets: { ...build.sockets, [socketName]: instanceId } };
  // the same instance can't stay where it was as well
  for (const [s, id] of Object.entries(after.sockets)) if (s !== socketName && id === instanceId) after.sockets[s] = null;
  const result = validateBuild(after, db);
  return { ok: !errors.length && result.ok, errors: [...errors, ...result.errors], warnings: result.warnings, needEmpty, after, stats: result.stats };
}

// Take the part out of a socket. Removing something a fitted part depends on is an error (take that off
// first); leaving a required socket empty is allowed in the garage, but the car won't drive: a warning.
export function checkRemove(build, socketName, db) {
  const car = db.cars[build.carId];
  if (!car?.sockets.some(s => s.name === socketName)) return { ok: false, errors: [{ code: 'unknown_socket', socket: socketName, message: `${car?.name ?? build.carId} has no socket "${socketName}".` }], warnings: [], needEmpty: [] };
  const needEmpty = blockers(build, db, socketName), errors = [], warnings = [];
  for (const s of needEmpty) errors.push({ code: 'blocked', socket: socketName, message: `Take ${nameAt(build, db, s)} out of ${s} first: it's in the way of ${socketName}.` });
  const after = { ...build, sockets: { ...build.sockets, [socketName]: null } };
  const result = validateBuild(after, db), before = validateBuild(build, db);
  const wasFine = new Set(before.errors.map(e => e.message));
  for (const e of result.errors) {
    if (wasFine.has(e.message)) continue;
    if (e.code === 'required_empty') warnings.push({ ...e, message: `${e.message} (fine while it's in the garage)` });
    else errors.push({ ...e, message: `${e.message} Take that off first.` });
  }
  return { ok: !errors.length, errors, warnings: [...warnings, ...result.warnings], needEmpty, after, stats: result.stats };
}
const nameAt = (build, db, s) => db.parts[db.owned[build.sockets[s]]?.partId]?.name ?? 'the part';
