// What every part does for a car and what it costs (npm run balance-report, and the balance tests):
// each part fitted to the car's stock build (with what it needs fitted first, the cheapest way), its
// stat changes, value for money (price per hp, per kg saved, per rating point), what it does to its
// slot's key stat against its tier's rules (data/content/tiers.json), and anything that looks wrong —
// to do, no price, no icon, a price or a gain outside its tier's band, or a dearer part in its slot
// that does less.

import { Garage } from '../../garage/data.js';
import { STAT_KEYS } from '../../garage/workshop.js';

const stat = (s, key) => STAT_KEYS.find(k => k.key === key).of(s);
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
  if (!c.tags) { const own = new Set(car.tags ?? []); c.tags = new Set([...own, ...Object.values(db.parts).filter(p => (p.fits ?? []).every(need => [].concat(need).some(t => own.has(t)))).flatMap(p => p.provides ?? [])]); }
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
// (the parts measured on a car: its own, and on the reference car every part that fits it)
const measuredOn = (db, carId, p) => forCar(db, carId, p) && (carId === REFERENCE_CAR ? !Object.keys(db.cars).some(c => c !== carId && ownPart(db, c, p)) || ownPart(db, carId, p) : ownPart(db, carId, p));

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
      const need = r.errors.find(e => (e.code === 'requires' || e.code === 'does_not_fit') && e.need);
      const fix = depth < 4 && need && cheapestFor(db, g, need, [partId, ...exclude, ...added]);
      if (!fix) return r.errors[0]?.message ?? 'can\'t go on';
      const err = fit(fix, depth + 1);
      if (err) return `${r.errors[0]?.message} (and ${db.parts[fix].name}, which would meet that, can't go on: ${err})`;
      added.push(fix);
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
// the cheapest part (for sale) that meets a requires / fits error: a slot, a part, or a tag
function cheapestFor(db, g, err, not) {
  const wants = [].concat(err.need);
  const meets = p => wants.some(w => w.startsWith('slot:') ? p.slot === w.slice(5) : w.startsWith('part:') ? p.id === w.slice(5) : p.provides?.includes(w));
  return Object.values(db.parts).filter(p => !not.includes(p.id) && !p.retired && !p.todo?.length && meets(p) && forCar(db, g.build.carId, p) && g.socketsFor(p.id).length).sort((a, b) => a.price - b.price)[0]?.id ?? null;
}

// A part's own difference to its slot's key stat(s) (the best of them, as a share of the value
// without it, better-ward): fitted with what it needs, against the car with just what it needs (or
// stock, if that isn't a car that can be driven) → { ok, gain, stat, gains, with, garage, error }
export function partGain(db, carId, part, tiers) {
  const rule = tiers.slots[part.slot], stats = rule?.stat ? [].concat(rule.stat) : [];
  const fitted = fitWithNeeds(db, carId, part.id);
  if (!fitted.ok) return { ok: false, error: fitted.error, with: fitted.with };
  let base = new Garage(db, null, carId);
  if (fitted.with.length) {
    const b = new Garage(db, null, carId);
    if (fitted.with.every(id => b.install(id, { auto: true }).ok) && b.stats().spec) base = b;
  }
  const s0 = base.stats(), s1 = fitted.garage.stats(), gains = {};
  // (a share of the value without it — or, from nothing (an open diff's lock), the amount itself)
  for (const k of stats) { const K = KEY_STATS[k], a = K.of(s0), b = K.of(s1); gains[k] = a == null || b == null ? null : a !== 0 ? (K.up ? b - a : a - b) / Math.abs(a) : K.up ? b : -b; }
  const best = stats.filter(k => gains[k] != null).sort((a, b) => gains[b] - gains[a])[0] ?? null;
  return { ok: true, gain: best ? gains[best] : null, stat: best, gains, with: fitted.with, garage: fitted.garage };
}

// What breaks the tier rules: a part with no tier, a price outside its tier's band for its slot, a
// gain to its slot's key stat outside the band — and in each slot, a dearer part that does no more
// than a cheaper one (nothing but a part's purpose excuses that). → [{ id, problem }]
export function tierProblems(db, tiers, carId = REFERENCE_CAR, gains = null) {
  const out = [], car = db.cars[carId], group = p => car.socketGroups?.[p.slot]?.length ?? 1;
  const live = Object.values(db.parts).filter(p => !p.retired && !p.todo?.length), mine = p => measuredOn(db, carId, p);
  gains ??= new Map(live.filter(mine).map(p => [p.id, partGain(db, carId, p, tiers)]));
  const money = n => `$${Math.round(n).toLocaleString('en-GB')}`, pct = x => `${(x * 100).toFixed(1)}%`;
  for (const p of live) {
    if (!p.tier) { out.push({ id: p.id, problem: 'has no tier' }); continue; }
    if (p.tier === 'stock') continue;
    const rule = tiers.slots[p.slot], band = tiers.tiers[p.tier].price;
    if (!rule) { out.push({ id: p.id, problem: `data/content/tiers.json has no rules for the ${p.slot} slot` }); continue; }
    const lo = band[0] * rule.street, hi = band[1] * rule.street;
    if (p.price < lo - 0.5 || p.price > hi + 0.5) out.push({ id: p.id, problem: `${money(p.price)}${group(p) > 1 ? ' each' : ''} is outside the ${p.tier} price band for ${p.slot} (${money(lo)}–${money(hi)})` });
    if (p.purpose || !rule.stat || !mine(p)) continue;              // (another car's part: priced by the rules, measured on its own car)
    const g = gains.get(p.id), range = rule.gain?.[p.tier];
    if (!range) { out.push({ id: p.id, problem: `no ${p.tier} gain band for ${p.slot} in data/content/tiers.json` }); continue; }
    if (!g?.ok) { out.push({ id: p.id, problem: `can't be fitted to measure it: ${g?.error}` }); continue; }
    if (g.gain == null || g.gain < range[0] - 1e-9 || g.gain > range[1] + 1e-9) out.push({ id: p.id, problem: `improves ${[].concat(rule.stat).join(' / ')} by ${g.gain == null ? 'nothing' : pct(g.gain)}: a ${p.tier} ${p.slot} part should give ${pct(range[0])}–${pct(range[1])}` });
  }
  // in each slot: the dearer part does more (a part with a purpose is left out: drift tyres, looks)
  // (tyres against tyres of their own rim size: a size up grips more whatever it costs)
  const bySlot = new Map(), sizeGroup = p => p.tyreSize ? `${p.slot} (${(p.fits ?? []).flat().find(t => t.startsWith('rim:'))?.slice(4)}")` : p.slot;
  for (const p of live) if (p.tier !== 'stock' && !p.purpose && mine(p) && tiers.slots[p.slot]?.stat && gains.get(p.id)?.gain != null) { const k = sizeGroup(p); if (!bySlot.has(k)) bySlot.set(k, []); bySlot.get(k).push(p); }
  for (const [slot, list] of bySlot) {
    list.sort((a, b) => a.price - b.price);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j], ga = gains.get(a.id).gain, gb = gains.get(b.id).gain;
      if (b.price > a.price && gb <= ga + 0.001) out.push({ id: b.id, problem: `does no more for ${slot} (${pct(gb)}) than ${a.name} (${pct(ga)}), which costs less (${money(a.price)} against ${money(b.price)})` });
    }
  }
  return out;
}

// One row per part: its numbers on the car, and flags
export function balanceRows(db, carId = 'starter_car', tiers = null) {
  const stock = new Garage(db, null, carId).stats(), rows = [];
  const car = db.cars[carId], stockIds = new Set(car.sockets.flatMap(s => s.stock));
  for (const part of Object.values(db.parts).sort((a, b) => a.category.localeCompare(b.category) || a.slot.localeCompare(b.slot) || a.price - b.price)) {
    if (!forCar(db, carId, part)) continue;              // (for another kind of car)
    const row = { id: part.id, name: part.name, category: part.category, slot: part.slot, tier: part.tier ?? '', purpose: part.purpose ?? '', price: part.price, mass: part.mass, retired: !!part.retired, todo: (part.todo ?? []).join(' '), stock: stockIds.has(part.id), icon: !!part.icon, flags: [] };
    const fitted = stockIds.has(part.id) ? { garage: new Garage(db, null, carId), ok: true, with: [] } : fitWithNeeds(db, carId, part.id);
    row.fits = fitted.ok; row.needs = fitted.with.join(' ');
    if (!fitted.ok) row.flags.push(`doesn't go on the ${car.name}: ${fitted.error}`);
    else {
      const s = fitted.garage.stats();
      for (const k of ['power', 'torque', 'weight', 'grip', 'braking', 'top', 'accel', 'rating']) {
        const a = stat(stock, k), b = stat(s, k);
        row[k] = a != null && b != null ? +(b - a).toFixed(k === 'grip' ? 3 : 2) : null;
      }
      row.class = s.totals?.rating?.class ?? '';
      const cost = part.price * (car.socketGroups?.[part.slot]?.length ?? 1) + fitted.with.reduce((t, id) => t + db.parts[id].price * (car.socketGroups?.[db.parts[id].slot]?.length ?? 1), 0);
      row.cost = cost;
      row.perHp = row.power > 0.5 ? Math.round(cost / row.power) : null;
      row.perKgSaved = row.weight < -0.2 ? Math.round(cost / -row.weight) : null;
      row.perRating = row.rating > 0.5 ? Math.round(cost / row.rating) : null;
    }
    if (row.todo) row.flags.push(`to do: ${row.todo}`);
    if (!row.retired && !row.stock && !part.price && !row.todo) row.flags.push('no price');
    if (!row.icon) row.flags.push('no icon');
    if (part.mass === 0 && part.model) row.flags.push('mass 0');
    rows.push(row);
  }
  // outliers: against the tier rules (price band, gain band, dearer parts doing more)
  if (tiers) {
    const live = Object.values(db.parts).filter(p => !p.retired && !p.todo?.length && measuredOn(db, carId, p)), gains = new Map(live.map(p => [p.id, partGain(db, carId, p, tiers)]));
    for (const r of rows) { const g = gains.get(r.id); if (g?.ok) { r.keyStat = g.stat ?? ''; r.gain = g.gain == null ? null : +(g.gain * 100).toFixed(2); } }
    for (const { id, problem } of tierProblems(db, tiers, carId, gains)) rows.find(r => r.id === id)?.flags.push(`outlier: ${problem}`);
  }
  // an upgrade that makes the car worse overall and does nothing for its slot either (other than
  // what other parts need — an intercooler for a turbo — and parts with a purpose: drift tyres)
  const needed = new Set(Object.values(db.parts).flatMap(p => [...(p.requires ?? []).flat(), ...(p.fits ?? []).flat()]));
  for (const r of rows) {
    const p = db.parts[r.id];
    if (!r.stock && !r.retired && !p.purpose && measuredOn(db, carId, p) && r.fits && r.rating < -0.5 && !(r.gain > 0) && !needed.has(`slot:${p.slot}`) && !(p.provides ?? []).some(t => needed.has(t))) r.flags.push('makes the car slower');
  }
  return { stock, rows };
}
export const COLUMNS = ['id', 'name', 'category', 'slot', 'tier', 'purpose', 'price', 'cost', 'mass', 'keyStat', 'gain', 'power', 'torque', 'weight', 'grip', 'braking', 'top', 'accel', 'rating', 'class', 'perHp', 'perKgSaved', 'perRating', 'needs', 'stock', 'retired', 'todo', 'flags'];
export function toCsv(rows) {
  const cell = v => { const s = Array.isArray(v) ? v.join('; ') : v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [COLUMNS.join(','), ...rows.map(r => COLUMNS.map(c => cell(r[c])).join(','))].join('\n') + '\n';
}
