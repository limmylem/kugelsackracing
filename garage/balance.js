// What a part does for a car, worked out the way the balance rules work it out (Phase 8 Step 3: shared by the content
// tools — tools/content/balance.mjs, the build and the checks — and the server's content manager, which checks an
// edit as it's made): whether a part is for a car at all, a car with a part fitted along with what it needs first (the
// cheapest way), and the part's own difference to its slot's key stat. No browser or Node APIs.
//
//   forCar(db, carId, part) → whether it's for that car     fitWithNeeds(db, carId, partId) → { garage, ok, error, with }
//   partGain(db, carId, part, tiers) → { ok, gain, stat, gains, with, garage, error }

import { Garage } from './data.js';
import { STAT_KEYS } from './workshop.js';
import { released } from './content.js';

export const TIER_ORDER = ['stock', 'street', 'sport', 'race'];
const brakeTorque = B => { const P = B.maxPressureBar * 1e5, t = e => 2 * e.padMu * P * e.pistonArea * e.discRadius; return 2 * (t(B.front) + t(B.rear)); };
// The key stats a slot is judged by (tiers.json stats): a build's value, and whether more is better
export const KEY_STATS = {
  power: { of: s => s.totals?.peakPower.hp, up: true, unit: 'hp' },
  grip: { of: s => s.totals?.rating?.estimates.grip, up: true, unit: 'g' },
  accel: { of: s => s.totals?.rating?.estimates.zeroTo100, up: false, unit: 's' },
  weight: { of: s => s.spec?.mass, up: false, unit: 'kg' },
  brakeTorque: { of: s => s.spec && brakeTorque(s.spec.brakes), up: true, unit: 'N·m' },
  clutchTorque: { of: s => s.spec?.clutch?.maxTorque, up: true, unit: 'N·m' },
  diffLock: { of: s => s.spec && ({ locked: 1, open: 0 }[s.spec.differential.type] ?? s.spec.differential.lock), up: true, unit: '' },
  springRate: { of: s => s.spec?.suspension?.stiffness, up: true, unit: 'N/m' },
  rating: { of: s => s.totals?.rating?.index, up: true, unit: '' },
};

// Whether a part is for this car at all: it has a socket (or socket group) for the part's slot, and it
// (or a part that could go on it) offers what the part fits (each of its fits: a tag, or alternatives). Parts for other kinds of car —
// an AWD's centre diff, an off-roader's lift kit, a convertible's roof — aren't measured on this one.
export function forCar(db, carId, part) {
  const car = db.cars[carId], c = cached(db, carId);
  if (!car.sockets.some(s => s.slot === part.slot) && !car.socketGroups?.[part.slot]) return false;
  // (tyres too big for its arches, even with the biggest lift kit it takes)
  if (part.tyreSize && car.wheels?.maxTyreRadius) {
    c.lift ??= Math.max(0, ...Object.values(db.parts).filter(p => p.slot === 'lift_kit' && forCar(db, carId, p)).map(p => (p.effects ?? []).find(e => e.target === 'wheels.lift')?.value ?? 0));
    const d = +(part.fits ?? []).flat().find(t => t.startsWith('rim:'))?.slice(4);
    if (d && d * 0.0127 + part.tyreSize.width * part.tyreSize.sidewall / 100000 > car.wheels.maxTyreRadius + LIFT_ROOM * c.lift + 1e-9) return false;
  }
  // (a part that clashes with the car as it comes: a turbo kit on an engine with its own turbo)
  if (!c.given) c.given = new Set([...(car.tags ?? []), ...car.sockets.flatMap(s => s.stock).flatMap(id => db.parts[id]?.provides ?? [])]);
  if ((part.conflicts ?? []).some(t => c.given.has(t))) return false;
  if (!part.fits?.length) return true;
  // (what could go on it offers its tags too — but not a part that can't go on this car at all: a crate engine
  // made for others, conflicts car:<id>; nor one players can't have yet, a draft: a part doesn't go on a car only
  // through something that isn't out — docs/CONTENT_PIPELINE.md)
  if (!c.tags) { const own = new Set(car.tags ?? []); c.tags = new Set([...own, ...Object.values(db.parts).filter(p => released(p) && !p.retired && (p.fits ?? []).every(need => [].concat(need).some(t => own.has(t))) && !(p.conflicts ?? []).some(t => own.has(t))).flatMap(p => p.provides ?? [])]); }
  return part.fits.every(need => [].concat(need).some(t => c.tags.has(t)));     // (each a tag, or alternatives)
}
// (per data set and car: what its parts offer, and so on — worked out once)
const CACHE = new WeakMap();
function cached(db, carId) {
  if (!CACHE.has(db)) CACHE.set(db, new Map());
  const m = CACHE.get(db);
  if (!m.has(carId)) m.set(carId, {});
  return m.get(carId);
}
// (how much of a lift kit's lift is room in the arches for a bigger tyre: garage/stats.js)
const LIFT_ROOM = 0.6;
// A car's own parts: made for it (fits car:<id>, or a tag only its own stock parts offer — its engine's
// family). Parts for every car are measured on the reference car (the starter car); a car's own parts
// on it.
export function ownPart(db, carId, part) {
  const fits = (part.fits ?? []).flat();
  if (fits.includes(`car:${carId}`)) return true;
  const c = cached(db, carId);
  if (!c.unique) {
    // (what only this car's own stock parts offer: its engine's family — not a rim size other wheels offer too)
    const stock = new Set(db.cars[carId].sockets.flatMap(s => s.stock));
    const elsewhere = new Set(Object.values(db.parts).filter(p => !stock.has(p.id)).flatMap(p => p.provides ?? []));
    c.unique = new Set([...stock].flatMap(id => db.parts[id]?.provides ?? []).filter(t => !elsewhere.has(t)));
  }
  // (a fits entry with alternatives: its own only if every one of them is)
  return (part.fits ?? []).some(need => [].concat(need).every(t => c.unique.has(t)));
}
export const REFERENCE_CAR = 'starter_car';

// A stock garage for the car with a part fitted (what it needs first, the cheapest way — a turbo's
// intercooler, a 17" tyre's 17" rims): { garage, ok, error, with: [ids] }
export function fitWithNeeds(db, carId, partId, { exclude = [], base = null } = {}) {
  const g = base ? new Garage(db, JSON.parse(JSON.stringify(base.state)), carId) : new Garage(db, null, carId), added = [];
  // (a part, and what it needs first — and what that needs: a stage 2 ECU needs a turbo, which needs an intercooler)
  const fit = (id, depth) => {
    for (let round = 0; round < 8; round++) {
      const r = g.install(id, { auto: true });
      if (r.ok) return null;
      // (tyres too big for the arches: the cheapest lift kit that makes room first)
      if (r.errors.some(e => e.code === 'stats' && /arches/.test(e.message))) {
        const kit = Object.values(db.parts).filter(p => p.slot === 'lift_kit' && !p.retired && !added.includes(p.id) && forCar(db, carId, p)).sort((a, b) => a.price - b.price)
          .find(p => { const t = new Garage(db, JSON.parse(JSON.stringify(g.state)), carId); return t.install(p.id, { auto: true }).ok && t.install(id, { auto: true }).ok; });
        if (kit) { g.install(kit.id, { auto: true }); added.push(kit.id); continue; }
      }
      // (what the part itself needs first: what it puts out of place — a stock airbox on a swapped engine — comes off
      // by itself once that's met)
      const needs = r.errors.filter(e => (e.code === 'requires' || e.code === 'does_not_fit') && e.need);
      const need = needs.find(e => e.part === id) ?? needs[0];
      // (the cheapest part that meets it, and if that can't go on — or the part still can't with it — the next
      // cheapest: a V6 crate engine for a supercharger where a V8 swap would rule the supercharger out)
      const options = depth < 4 && need ? optionsFor(db, g, need, [partId, ...exclude, ...added]).slice(0, 3) : [];
      if (!options.length) return r.errors[0]?.message ?? 'can\'t go on';
      let last = null;
      for (const fix of options) {
        const saved = JSON.stringify(g.state), n = added.length;
        const err = fit(fix, depth + 1);
        if (err) { last ??= `${r.errors[0]?.message} (and ${db.parts[fix].name}, which would meet that, can't go on: ${err})`; g.state = JSON.parse(saved); added.length = n; continue; }
        added.push(fix);
        const rest = fit(id, depth);
        if (!rest) return null;
        last ??= rest;
        g.state = JSON.parse(saved); added.length = n;
      }
      return last;
    }
    return 'too many requirements';
  };
  const error = fit(partId, 0);
  if (error) return { garage: g, ok: false, error, with: added, order: [...added, partId] };
  // (and what it leaves empty that the car can't do without: 17" rims take the 15" tyres off, so 17"
  // tyres go on after them — the cheapest that fits)
  const after = [];
  for (let round = 0; round < 4; round++) {
    const empty = g.validate().errors.find(e => e.code === 'required_empty');
    if (!empty) break;
    const slot = db.cars[carId].sockets.find(s => s.name === empty.socket)?.slot;
    const fix = Object.values(db.parts).filter(p => !p.retired && !p.todo?.length && ![partId, ...exclude, ...added, ...after].includes(p.id) && g.socketsFor(p.id).includes(empty.socket) && (p.slot === slot || db.cars[carId].socketGroups?.[p.slot]))
      .sort((a, b) => a.price - b.price).find(p => { const t = new Garage(db, JSON.parse(JSON.stringify(g.state)), carId); return t.install(p.id, { auto: true }).ok; });
    if (!fix) break;
    g.install(fix.id, { auto: true });
    after.push(fix.id);
  }
  return { garage: g, ok: true, with: [...added, ...after], order: [...added, partId, ...after] };
}
// the parts (for sale) that meet a requires / fits error, cheapest first: a slot, a part, or a tag
function optionsFor(db, g, err, not) {
  const wants = [].concat(err.need);
  const meets = p => wants.some(w => w.startsWith('slot:') ? p.slot === w.slice(5) : w.startsWith('part:') ? p.id === w.slice(5) : p.provides?.includes(w));
  return Object.values(db.parts).filter(p => !not.includes(p.id) && !p.retired && !p.todo?.length && meets(p) && forCar(db, g.build.carId, p) && g.socketsFor(p.id).length).sort((a, b) => released(b) - released(a) || a.price - b.price || (a.id < b.id ? -1 : 1)).map(p => p.id);   // (what players can have first)
}

// A part's own difference to its slot's key stat(s) (the best of them, as a share of the value
// without it, better-ward): fitted with what it needs, against the car with just what it needs (or
// stock, if that isn't a car that can be driven) → { ok, gain, stat, gains, with, garage, error }
export function partGain(db, carId, part, tiers) {
  const rule = tiers.slots[part.slot], stats = rule?.stat ? [].concat(rule.stat) : [];
  const fitted = fitWithNeeds(db, carId, part.id);
  if (!fitted.ok) return { ok: false, error: fitted.error, with: fitted.with };
  let base = new Garage(db, null, carId);
  if (part.tyreSize) base = roadTyres(db, carId) ?? base;
  else if (fitted.with.length) {
    const b = new Garage(db, null, carId);
    if (fitted.with.every(id => b.install(id, { auto: true }).ok) && b.stats().spec) base = b;
  }
  const s0 = base.stats(), s1 = fitted.garage.stats(), gains = {};
  // (a share of the value without it — or, from nothing (an open diff's lock), the amount itself)
  for (const k of stats) { const K = KEY_STATS[k], a = K.of(s0), b = K.of(s1); gains[k] = a == null || b == null ? null : a !== 0 ? (K.up ? b - a : a - b) / Math.abs(a) : K.up ? b : -b; }
  const best = stats.filter(k => gains[k] != null).sort((a, b) => gains[b] - gains[a])[0] ?? null;
  return { ok: true, gain: best ? gains[best] : null, stat: best, gains, with: fitted.with, garage: fitted.garage };
}

// (a tyre is measured against the car on its own size of tyre in the reference car's compound — an ordinary road tyre —
// so a car whose stock tyres are already sporty doesn't make every tyre look worse: the car as it is, its tyres made
// road ones; null if it has none to change)
function roadTyres(db, carId) {
  const car = db.cars[carId], refTyre = db.parts[db.cars[REFERENCE_CAR]?.sockets.find(s => s.slot === 'tyre')?.stock?.[0]], ref = refTyre?.tyreSize?.compound;
  if (!refTyre?.tyre || !ref) return null;
  const stock = [...new Set(car.sockets.filter(s => s.slot === 'tyre').map(s => s.stock?.[0]).filter(Boolean))].map(id => db.parts[id]).filter(p => p?.tyreSize && p.tyreSize.compound !== ref);
  if (!stock.length) return null;
  // (its size, the reference tyre's rubber: its grip curves)
  const copies = Object.fromEntries(stock.map(p => [`${p.id}__${ref}`, { ...p, id: `${p.id}__${ref}`, tyreSize: { ...p.tyreSize, compound: ref }, tyre: refTyre.tyre }]));
  const db2 = { ...db, parts: { ...db.parts, ...copies } }, g = new Garage(db2, null, carId);
  for (const id of Object.keys(copies)) if (!g.install(id, { auto: true }).ok) return null;
  return g.stats().spec ? g : null;
}

// Class rules (data/content/balance.json): a car is its own class stock, and its most powerful build at most
// maxClassJump classes higher — except the cars in exempt. → [problem in words]   (stock, max: ratings)
export function classProblems(db, carId, rules, { stock, max }) {
  const car = db.cars[carId], order = db.classes.classes.map(c => c.class), out = [];
  if (car.class && stock.class !== car.class) out.push(`stock it rates ${stock.index}, class ${stock.class} — it should be class ${car.class}`);
  if (!(rules.exempt ?? []).includes(carId)) {
    const jump = order.indexOf(max.class) - order.indexOf(car.class ?? stock.class);
    if (jump > rules.maxClassJump) out.push(`fully upgraded it's class ${max.class} (${max.index}): ${jump} classes up, at most ${rules.maxClassJump}`);
  }
  return out;
}
