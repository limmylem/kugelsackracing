// Repairs: what's wrong with a car, piece by piece, what putting each piece right costs, and what a
// repair does — by the rules in data/economy.json repair. Pure, like garage/damage.js: the player
// service (garage/player/service.js) makes the repairs, the damage report (garage/damageReport.js) and
// the garage screen show them, the crash test suite prices crashes, and a server can do the same sums.
//
// A part copy's damage comes in pieces ("work"), each repaired on its own or with the rest:
//   condition  its condition below 100 and its dents (a panel's crumpled metal, an engine's wear)
//   corner:FL… one corner of a part that carries a system per wheel (the suspension: steering geometry,
//              camber, ride, damper; the brakes: that corner's line)
//   rim, tyre, radiator, intake, gearbox, differential, clutch, exhaust  its mechanical damage
//   attach     hanging loose, or torn off (the part's still there: towed back with the car)
// and the body shell's: body (condition and dents) and each window or light broken (broken:<node>).
//
// Two kinds of repair:
//   full   back to 100%, every dent out, the mechanical damage gone: a part's price × perPoint for each
//          point put back (at least minimum), its mechanical systems' share of its price (repair.systems,
//          more the worse it is), a loose or torn-off part bolted back on (reattach); never more than
//          maxOfNew of what the part costs new
//   quick  cheaper (quick.share of the full price): condition up to quick.condition, the dents mostly
//          pushed out (each quick.dentScale as hard; those left shallower than quick.dentMin m gone), leaks
//          sealed and tyres pumped up, bends and wear quick.mechanicalKept of what they were
// Drivable (data/damage.json drivable): what a car needs to carry on racing — every wheel on, the engine
// running, no flat tyre, nothing leaking or bent past the limits. The safety net: a car that isn't, whose
// player can't afford the quick repairs that would make it so, gets a basic repair free (economy
// safetyNet): just what stops it, put just inside the limits.

import { addDent, curveAt } from './damage.js';
import { CORNERS, hasDamage, prune } from './mechanical.js';

const clone = x => JSON.parse(JSON.stringify(x));
const r4 = x => Math.round(x * 1e4) / 1e4 + 0;
// the system a part's damage block is (garage/mechanical.js CARRIER_SLOTS, the other way round: by the
// part's slot; an engine carries the radiator)
const SLOT_SYSTEM = { suspension: 'suspension', brakes: 'brakeLine', wheels: 'rim', wheel: 'rim', tyres: 'tyre', tyre: 'tyre', turbo: 'intake', supercharger: 'intake', gearbox: 'gearbox', differential: 'differential', differential_front: 'differential', centre_diff: 'differential', clutch: 'clutch', exhaust: 'exhaust' };
export const systemOf = part => !part ? null : part.engine ? 'radiator' : SLOT_SYSTEM[part.slot] ?? null;
export const priceOf = (db, instance) => db.parts[instance.partId]?.price ?? instance.price ?? 0;

// ---------- what's wrong ----------

// How bad a system's damage is, 0..1 (rules: data/damage.json mechanical)
export function severity(system, block, rules) {
  const S = rules.systems, b = block ?? {};
  switch (system) {
    case 'suspension': return Math.min(1, Math.max(Math.abs(b.toe ?? 0) / S.steering.max, (b.camber ?? 0) / S.suspension.maxCamber, (b.ride ?? 0) / S.suspension.maxRide, (b.damper ?? 0) / (1 - S.suspension.minDamper)));
    case 'brakeLine': return Math.min(1, (b.line ?? 0) / S.brakeLine.max);
    case 'rim': return Math.min(1, (b.bend ?? 0) / S.rim.max);
    case 'tyre': return Math.min(1, Math.max(1 - (b.pressure ?? 1), (b.leak ?? 0) / S.tyre.maxLeak * 4));
    case 'radiator': return Math.min(1, Math.max((b.leak ?? 0) / S.radiator.max, 1 - (b.coolant ?? 1)));
    case 'intake': return Math.min(1, (b.boost ?? 0) / S.intake.max);
    case 'clutch': return Math.min(1, b.wear ?? 0);
    case 'exhaust': return Math.min(1, b.holes ?? 0);
    default: return Math.min(1, b.gears ?? 0);
  }
}

// The pieces of a part copy's damage, each with what it costs: [{ scope, system?, corner?, severity,
// quick, full }] (costs before the part's cap: partWork applies it)
function rawWork(db, instance) {
  const R = db.economy.repair, part = db.parts[instance.partId], price = priceOf(db, instance), M = db.damage?.mechanical;
  const out = [], c = instance.condition ?? 100;
  if (c < 100 || instance.dents?.length) out.push({ scope: 'condition', severity: (100 - c) / 100, full: c < 100 ? Math.max(R.minimum, price * R.perPoint * (100 - c)) : R.minimum });
  const block = prune(instance.damage ?? {});
  if (M && Object.keys(block).length) {
    const system = systemOf(part), share = s => R.systems?.[s] ?? R.mechanical ?? 0, k = R.severity ?? 0.5;
    const cost = (s, sev, n = 1) => Math.max(R.minimum, price * share(s) / n * (k + (1 - k) * sev));
    const corners = CORNERS.filter(x => block[x]);
    for (const corner of corners) { const sev = severity(system, block[corner], M); out.push({ scope: `corner:${corner}`, system, corner, severity: sev, full: cost(system, sev, 4) }); }
    const rest = Object.fromEntries(Object.entries(block).filter(([key]) => !CORNERS.includes(key)));
    if (Object.keys(rest).length && system) { const sev = severity(system, rest, M); out.push({ scope: system, system, severity: sev, full: cost(system, sev) }); }
  }
  if (instance.attach && instance.attach !== 'attached') out.push({ scope: 'attach', state: instance.attach, severity: instance.attach === 'detached' ? 1 : 0.5, full: Math.max(R.minimum, price * (R.reattach ?? 0)), quickSame: true });
  return out;
}
// A copy's damage, priced: [{ scope, …, quick, full }] — the full prices together never more than
// maxOfNew of a new one (each scaled down alike); quick: quick.share of full (bolting a part back on
// costs the same either way). Rounded to whole money
export function partWork(db, instance) {
  const R = db.economy.repair, list = rawWork(db, instance), total = list.reduce((a, w) => a + w.full, 0), cap = priceOf(db, instance) * (R.maxOfNew ?? Infinity);
  const k = total > cap && cap > 0 ? cap / total : 1;
  return list.map(w => { const full = Math.round(w.full * k), { quickSame, ...rest } = w; return { ...rest, full, quick: quickSame ? full : Math.round(full * (R.quick?.share ?? 1)) }; });
}
// The body shell's damage (a car's damage block), priced: body (condition, dents), each broken window or light
export function shellWork(db, car) {
  const d = car?.damage, R = db.economy.repair, out = [];
  if (!d) return out;
  const c = d.condition ?? 100, price = db.cars[car.carId]?.shell?.price ?? 0;
  if (c < 100 || d.dents?.length) { const full = Math.round(c < 100 ? Math.max(R.minimum, price * R.perPoint * (100 - c)) : R.minimum); out.push({ scope: 'body', severity: (100 - c) / 100, full, quick: Math.round(full * (R.quick?.share ?? 1)) }); }
  for (const node of d.broken ?? []) out.push({ scope: `broken:${node}`, node, severity: 1, full: R.breakable ?? 0, quick: R.breakable ?? 0 });
  return out;
}
// What a set of pieces costs: kind 'quick' | 'full'; scopes: which (none: all)
export const workCost = (work, kind = 'full', scopes = null) => work.filter(w => !scopes || scopes.includes(w.scope)).reduce((a, w) => a + w[kind], 0);

// ---------- what a repair does ----------

// A dent list after a quick repair: each dent quick.dentScale as hard (so as deep and wide as that is),
// the ones that come out shallower than quick.dentMin (m: its depth, × its share of it) gone. db: the
// economy (repair.quick) and the damage rules (how deep a dent of a strength is)
export function quickDents(dents, db) {
  const Q = db.economy.repair.quick ?? {}, depth = db.damage.dent.depth, out = [];
  for (const d of dents ?? []) { const s = +(d.s * (Q.dentScale ?? 0)).toFixed(3); if (curveAt(depth, s) * (d.w ?? 1) >= (Q.dentMin ?? Infinity)) out.push({ ...d, s }); }
  return out;
}
// A mechanical block (part of one) after a quick repair: leaks sealed, tyres pumped up, coolant topped
// up; bends and wear `kept` of what they were (kept 0: as new)
function mendBlock(block, kept) {
  const out = {};
  for (const [k, v] of Object.entries(block ?? {})) {
    if (v && typeof v === 'object') { out[k] = mendBlock(v, kept); continue; }
    if (k === 'leak' || k === 'pressure' || k === 'coolant') continue;
    const x = r4(v * kept);
    if (Math.abs(x) >= 1e-3) out[k] = x;
  }
  return prune(out);
}
// A part copy's fields after repairing some of it: { condition, dents, damage, attach } (only those that
// change; scope 'all' or one of partWork's; kind 'quick' | 'full'; dentLog: the copy's base and hits
// start again from its dents)
export function repairPart(db, instance, { scope = 'all', kind = 'full' } = {}) {
  const R = db.economy.repair, Q = R.quick ?? {}, all = scope === 'all', out = {}, quick = kind === 'quick';
  if (all || scope === 'condition') {
    out.condition = quick ? Math.max(instance.condition ?? 100, Q.condition ?? 100) : 100;
    out.dents = quick ? quickDents(instance.dents, db) : [];
  }
  const block = clone(instance.damage ?? {});
  let mended = null;
  if (all) mended = quick ? mendBlock(block, Q.mechanicalKept ?? 0) : {};
  else if (scope.startsWith('corner:')) { const k = scope.slice(7); mended = { ...block }; if (quick) mended[k] = mendBlock(block[k], Q.mechanicalKept ?? 0); else delete mended[k]; mended = prune(mended); }
  else if (scope !== 'condition' && scope !== 'attach') { const corners = Object.fromEntries(Object.entries(block).filter(([k]) => CORNERS.includes(k))); mended = prune({ ...corners, ...(quick ? mendBlock(Object.fromEntries(Object.entries(block).filter(([k]) => !CORNERS.includes(k))), Q.mechanicalKept ?? 0) : {}) }); }
  if (mended) out.damage = mended;
  if (all || scope === 'attach') out.attach = null;
  return out;
}
// The body shell's damage after repairing some of it (scope 'all', 'body' or 'broken:<node>'): the new
// damage block, or null (as new)
export function repairShell(db, damage, { scope = 'all', kind = 'full' } = {}) {
  if (!damage) return null;
  const R = db.economy.repair, Q = R.quick ?? {}, d = clone(damage), quick = kind === 'quick';
  if (scope === 'all' || scope === 'body') { d.condition = quick ? Math.max(d.condition ?? 100, Q.condition ?? 100) : 100; d.dents = quick ? quickDents(d.dents, db) : []; }
  if (scope === 'all') d.broken = [];
  else if (scope.startsWith('broken:')) d.broken = (d.broken ?? []).filter(n => n !== scope.slice(7));
  return (d.condition ?? 100) >= 100 && !d.dents?.length && !d.broken?.length ? null : d;
}

// ---------- drivable ----------

// Whether a car can carry on racing as it is (data/damage.json drivable), and what stops it:
// { ok, reasons: [plain words], blocking: [{ target: instanceId | 'shell', scope, why }] }
// owned: the copies on it by socket ({ socket: copy } — each with condition, damage, attach); car: its
// definition; rules: data/damage.json
export function drivability(car, owned, rules) {
  const D = rules.drivable ?? {}, M = rules.mechanical, reasons = [], blocking = [];
  const block = (copy, why, scope, text) => { blocking.push({ target: copy.instanceId, scope, why }); reasons.push(text); };
  const at = slot => Object.entries(owned).find(([s, x]) => x && car.sockets.find(d => d.name === s)?.slot === slot)?.[1];
  for (const k of CORNERS) {
    const socket = car.model.sockets[k], wheel = owned[socket];
    if (wheel?.attach === 'detached') block(wheel, 'wheel off', 'attach', `The ${cornerWord(k)} wheel is off.`);
  }
  const engine = Object.values(owned).find(x => x?.engine);
  if (engine && (engine.condition ?? 100) < (D.engineCondition ?? 0)) block(engine, 'engine', 'condition', (engine.condition ?? 100) <= 0 ? 'The engine is blown.' : `The engine is too badly damaged (${Math.round(engine.condition)}%).`);
  if (engine?.damage && M) {
    const e = engine.damage;
    if ((e.leak ?? 0) > (D.radiatorLeak ?? Infinity)) block(engine, 'radiator', 'radiator', 'The radiator is leaking too fast: the engine would overheat.');
    else if ((e.coolant ?? 1) < (D.coolant ?? 0)) block(engine, 'coolant', 'radiator', 'The coolant has run too low.');
  }
  const sus = at('suspension'), brakes = at('brakes');
  for (const k of CORNERS) {
    const s = sus?.damage?.[k];
    if (s && (Math.abs(s.toe ?? 0) > (D.toe ?? Infinity) || (s.camber ?? 0) > (D.camber ?? Infinity))) block(sus, `${k} geometry`, `corner:${k}`, `The ${cornerWord(k)} ${Math.abs(s.toe ?? 0) > (D.toe ?? Infinity) ? 'steering' : 'suspension'} is bent too far.`);
    const b = brakes?.damage?.[k];
    if (b && (b.line ?? 0) > (D.brakeLine ?? Infinity)) block(brakes, `${k} brake`, `corner:${k}`, `The ${cornerWord(k)} brake line has lost too much.`);
    const wheel = owned[car.model.sockets[k]];
    if (wheel?.attach !== 'detached') {
      if ((wheel?.damage?.bend ?? 0) > (D.bend ?? Infinity)) block(wheel, `${k} rim`, 'rim', `The ${cornerWord(k)} wheel is bent too badly.`);
      const tyre = Object.entries(owned).find(([s, x]) => x && car.sockets.find(d => d.name === s)?.slot === 'tyre' && car.sockets.find(d => d.name === s)?.node === car.model.sockets[k])?.[1];
      const t = tyre?.damage;
      if (t && ((t.pressure ?? 1) <= (M?.effects.tyre.flatBelow ?? 0) || (t.leak ?? 0) > (D.tyreLeak ?? Infinity))) block(tyre, `${k} tyre`, 'tyre', (t.pressure ?? 1) <= (M?.effects.tyre.flatBelow ?? 0) ? `The ${cornerWord(k)} tyre is flat.` : `The ${cornerWord(k)} tyre is losing air too fast.`);
    }
  }
  for (const [slot, key, limit, text] of [['gearbox', 'gears', D.gearbox, 'The gearbox is too badly damaged: gears miss.'], ['differential', 'gears', D.differential, 'The differential is too badly damaged.']]) {
    const x = at(slot);
    if ((x?.damage?.[key] ?? 0) > (limit ?? Infinity)) block(x, slot, slot, text);
  }
  return { ok: !blocking.length, reasons, blocking };
}
export const cornerWord = k => ({ FL: 'front-left', FR: 'front-right', RL: 'rear-left', RR: 'rear-right' })[k] ?? k;

// The basic repair that makes a car drivable (the safety net): for each piece that stops it, its
// fields put just inside the limits (safetyNet.margin of each), a wheel back on, a blown engine running
// again (safetyNet.engineCondition) — and again for what that shows up (a wheel back on, bent and flat)
// — [{ target, scope, fields }]
export function basicRepair(db, car, owned, rules) {
  const out = [], now = clone(owned);
  for (let round = 0; round < 4; round++) {
    const steps = basicSteps(db, car, now, rules);
    if (!steps.length) break;
    for (const step of steps) {
      const x = Object.values(now).find(y => y?.instanceId === step.target);
      for (const [k, v] of Object.entries(step.fields)) if (v === null) delete x[k]; else x[k] = v;
      const had = out.find(o => o.target === step.target);
      if (had) Object.assign(had.fields, step.fields); else out.push({ ...step, fields: { ...step.fields } });
    }
  }
  return out;
}
function basicSteps(db, car, owned, rules) {
  const D = rules.drivable ?? {}, N = db.economy.safetyNet ?? {}, m = N.margin ?? 0.75, out = [], { blocking } = drivability(car, owned, rules);
  const copy = id => Object.values(owned).find(x => x?.instanceId === id);
  const lim = (v, max) => Math.sign(v) * Math.min(Math.abs(v), max * m);
  for (const b of blocking) {
    const x = copy(b.target), dmg = clone(x.damage ?? {});
    if (b.scope === 'attach') { out.push({ target: b.target, scope: 'attach', fields: { attach: null } }); continue; }
    if (b.scope === 'condition') { out.push({ target: b.target, scope: 'condition', fields: { condition: Math.max(x.condition ?? 0, N.engineCondition ?? D.engineCondition ?? 0) } }); continue; }
    if (b.scope.startsWith('corner:')) {
      const k = b.scope.slice(7), c = dmg[k] ?? {};
      if (c.toe != null) c.toe = r4(lim(c.toe, D.toe ?? Infinity));
      if (c.camber != null) c.camber = r4(lim(c.camber, D.camber ?? Infinity));
      if (c.line != null) c.line = r4(lim(c.line, D.brakeLine ?? Infinity));
      dmg[k] = c;
    } else if (b.scope === 'radiator') { dmg.leak = r4(Math.min(dmg.leak ?? 0, (D.radiatorLeak ?? 0) * m)); dmg.coolant = Math.max(dmg.coolant ?? 1, 1); }
    else if (b.scope === 'tyre') { delete dmg.pressure; dmg.leak = r4(Math.min(dmg.leak ?? 0, (D.tyreLeak ?? 0) * m)); if (!dmg.leak) delete dmg.leak; }
    else if (b.scope === 'rim') dmg.bend = r4(lim(dmg.bend ?? 0, D.bend ?? Infinity));
    else if (b.scope === 'gearbox' || b.scope === 'differential') dmg.gears = r4(lim(dmg.gears ?? 0, D[b.scope] ?? Infinity));
    out.push({ target: b.target, scope: b.scope, fields: { damage: prune(dmg) } });
  }
  return out;
}

// ---------- a whole car ----------

// Everything on a car that needs repairing, priced: { parts: [{ socket, instanceId, partId, work }],
// shell: work, quick, full } — profile: the player's (or anything shaped like it)
export function carWork(db, profile, carInstanceId) {
  const car = profile.cars[carInstanceId], parts = [];
  for (const x of Object.values(profile.parts)) {
    if (x.installedOn?.car !== carInstanceId) continue;
    const work = partWork(db, x);
    if (work.length) parts.push({ socket: x.installedOn.socket, instanceId: x.instanceId, partId: x.partId, work });
  }
  const shell = shellWork(db, car);
  const sum = kind => parts.reduce((a, p) => a + workCost(p.work, kind), 0) + workCost(shell, kind);
  return { parts, shell, quick: sum('quick'), full: sum('full') };
}
// The copies on a car by socket, as drivability wants them (each with its part's engine flag)
export function ownedBySocket(db, profile, carInstanceId) {
  const out = {};
  for (const x of Object.values(profile.parts)) if (x.installedOn?.car === carInstanceId) out[x.installedOn.socket] = { ...x, engine: !!db.parts[x.partId]?.engine };
  return out;
}
// Whether a part copy needs any repair at all (worn, dented, damaged, loose or off)
export const needsWork = instance => !!instance && ((instance.condition ?? 100) < 100 || !!instance.dents?.length || hasDamage(instance.damage) || (!!instance.attach && instance.attach !== 'attached'));
// (dents folded in order: the same list every time — garage/damage.js addDent)
export const foldDents = (base, hits, rules) => (hits ?? []).reduce((list, d) => addDent(list, d, rules), (base ?? []).map(x => ({ ...x })));
export { curveAt };
