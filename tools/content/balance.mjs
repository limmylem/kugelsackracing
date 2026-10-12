// What every part does for a car and what it costs (npm run balance-report, and the balance tests):
// each part fitted to the car's stock build (with what it needs fitted first, the cheapest way), its
// stat changes, value for money (price per hp, per kg saved, per rating point), what it does to its
// slot's key stat against its tier's rules (data/content/tiers.json), and anything that looks wrong —
// to do, no price, no icon, a price or a gain outside its tier's band, or a dearer part in its slot
// that does less.

import { Garage } from '../../garage/data.js';
import { STAT_KEYS } from '../../garage/workshop.js';
import { perfKey } from '../../garage/families.js';

const stat = (s, key) => STAT_KEYS.find(k => k.key === key).of(s);
export { TIER_ORDER, KEY_STATS, forCar, ownPart, REFERENCE_CAR, fitWithNeeds, partGain } from '../../garage/balance.js';
import { KEY_STATS, forCar, ownPart, REFERENCE_CAR, fitWithNeeds, partGain } from '../../garage/balance.js';

// (the parts measured on a car: its own, and on the reference car every part that fits it)
const measuredOn = (db, carId, p) => forCar(db, carId, p) && (carId === REFERENCE_CAR ? !Object.keys(db.cars).some(c => c !== carId && ownPart(db, c, p)) || ownPart(db, carId, p) : ownPart(db, carId, p));

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
  // (a family's part in a dearer finish — chrome — costs more for its looks, not what it does: its price for what it
  // does is its price ÷ its finish's share; and two parts that perform the same, a finish apart, aren't compared)
  const forWhat = p => p.price / (p.generated?.priceFactor ?? 1), same = new Map(), keyOf = p => { if (!same.has(p.id)) same.set(p.id, perfKey(p)); return same.get(p.id); };
  // (a family's part in another finish: the same design — a carbon one a little lighter — not a rival)
  const designOf = p => { if (!p.generated?.family) return null; const { finish, ...rest } = p.generated.settings ?? {}; return `${p.generated.family}|${JSON.stringify(rest)}`; };
  const sameDesign = (a, b) => designOf(a) != null && designOf(a) === designOf(b);
  for (const [slot, list] of bySlot) {
    list.sort((a, b) => forWhat(a) - forWhat(b));
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j], ga = gains.get(a.id).gain, gb = gains.get(b.id).gain;
      if (forWhat(b) > forWhat(a) + 0.5 && gb <= ga + 0.001 && keyOf(a) !== keyOf(b) && !sameDesign(a, b)) out.push({ id: b.id, problem: `does no more for ${slot} (${pct(gb)}) than ${a.name} (${pct(ga)}), which costs less (${money(forWhat(a))} against ${money(forWhat(b))}${b.generated?.priceFactor > 1 ? ' before its finish' : ''})` });
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
