// A part family's parts, priced (npm run content -- build; docs/CONTENT_PIPELINE.md): their stats come from the
// family's settings (garage/families.js), and here what each does on a car decides its tier, price and unlock level,
// by the economy rules (data/content/formulas.json economy, data/content/tiers.json):
//  - a measured kind (an exhaust, a turbo, a wing, a seat…): what it does to its slot's key stat on a car (the starter
//    car if it fits it, else the first car it fits), the gain — its tier the one whose part of the gain scale it's in
//    (the tiers' gain bands, split where they overlap); its price along the slot's own hand-made parts' prices for
//    what they do, kept within its tier's band; too little or too much for any tier: not made
//  - any other kind (wheels, gauges…): its tier from its settings (economy.tier or tierBy), its price within the
//    tier's band by its value (0..1)
// and in each case × its finish's price (within the band), and an unlock level from where it sits in its tier.
//
//   priceFamilyParts([{ part, ctx }], { db, formulas, tiers }) → { problems: Map(id → [problem]) }   (parts priced in place)

import { evaluate, said } from '../../garage/formulas.js';
import { expandFamily as expand, perfKey } from '../../garage/families.js';
import { REFERENCE_CAR, TIER_ORDER, forCar, partGain } from './balance.mjs';

export function expandFamily(def, { formulas, db }) {
  const carNames = Object.fromEntries(Object.values(db.cars).map(c => [c.id, c.name]));
  return expand(def, { formulas, carNames });
}

// A slot's tiers along its gain scale: [{ tier, lo, hi }] (bands split at the middle of where they overlap)
export function tierScale(rule) {
  const bands = TIER_ORDER.filter(t => rule?.gain?.[t]).map(t => ({ tier: t, band: rule.gain[t] }));
  return bands.map((b, i) => ({
    tier: b.tier,
    lo: i === 0 ? b.band[0] : (bands[i - 1].band[1] + b.band[0]) / 2,
    hi: i === bands.length - 1 ? b.band[1] : (b.band[1] + bands[i + 1].band[0]) / 2,
  }));
}
// (the price for a gain along the slot's own parts' prices for what they do: [[gain, price]] rising)
function alongCurve(points, g) {
  if (points.length < 2 || g < points[0][0] || g > points.at(-1)[0]) return null;
  for (let i = 1; i < points.length; i++) if (g <= points[i][0]) { const [g0, p0] = points[i - 1], [g1, p1] = points[i]; return g1 === g0 ? p1 : p0 + (p1 - p0) * (g - g0) / (g1 - g0); }
  return null;
}

const EPS = 0.001;                  // (a gain within a tenth of a per cent of another's: the same, as the balance rules count it)
export function priceFamilyParts(items, { db, formulas: F, tiers }) {
  const problems = new Map(), say = (id, p) => { if (!problems.has(id)) problems.set(id, []); problems.get(id).push(p); };
  // (the new parts in the game's data, to measure them on a car)
  const all = { ...db, parts: { ...db.parts } };
  for (const { part } of items) all.parts[part.id] = { ...part, price: part.price || 1 };
  const measured = new Map(), curves = new Map(), money = n => `$${Math.round(n).toLocaleString('en-GB')}`, rows = [];
  // first what each does, and the tier that puts it in
  for (const { part, ctx } of items) {
    const kind = F.families[part.generated.kind], rule = tiers.slots[part.slot], finish = F.finishes[part.generated.settings.finish];
    if (!rule?.street) { say(part.id, `${part.id}: data/content/tiers.json has no price for the ${part.slot} slot`); continue; }
    const row = { part, ctx, kind, rule, finish, gain: null, on: null };
    if (kind.economy === 'measured') {
      const scale = tierScale(rule);
      if (!scale.length) { say(part.id, `${part.id}: data/content/tiers.json has no gain bands for the ${part.slot} slot to measure it by`); continue; }
      // (measured once for every part that performs the same: a finish apart)
      const key = perfKey(part);
      if (!measured.has(key)) {
        const cars = [REFERENCE_CAR, ...Object.keys(db.cars).filter(c => c !== REFERENCE_CAR).sort()];
        const car = cars.find(c => forCar(all, c, all.parts[part.id]));
        measured.set(key, car ? { car, ...partGain(all, car, all.parts[part.id], tiers) } : { car: null });
      }
      const m = measured.get(key);
      if (!m.car) { say(part.id, `${part.name}: it doesn't go on any car (it needs ${part.fits.flat().join(', ') || 'nothing'}, and no car offers that)`); continue; }
      if (!m.ok) { say(part.id, `${part.name}: it can't be fitted to the ${db.cars[m.car].name} to measure it: ${m.error}`); continue; }
      row.gain = m.gain ?? 0; row.on = m.car;
      const stat = [].concat(rule.stat).join(' / ');
      if (row.gain < scale[0].lo) { say(part.id, `${part.name} improves ${stat} by ${said(row.gain, '%')} on the ${db.cars[row.on].name}: too little for any tier (a ${scale[0].tier} ${part.slot} part gives at least ${said(scale[0].lo, '%')})`); continue; }
      if (row.gain > scale.at(-1).hi) { say(part.id, `${part.name} improves ${stat} by ${said(row.gain, '%')} on the ${db.cars[row.on].name}: too much for any tier (a ${scale.at(-1).tier} ${part.slot} part gives at most ${said(scale.at(-1).hi, '%')})`); continue; }
      const sc = scale.find(x => row.gain <= x.hi + 1e-9);
      row.tier = sc.tier; row.t = Math.min(1, Math.max(0, (row.gain - sc.lo) / (sc.hi - sc.lo || 1)));
    } else {
      const E = kind.economy ?? {};
      try {
        if (E.tier) row.tier = String(E.tier).split('.').reduce((o, k) => o?.[k], ctx);
        else if (E.tierBy) { const v = ctx[E.tierBy.by] ?? part.generated.stats[E.tierBy.by]; row.tier = E.tierBy.steps.find(([, upTo]) => v < upTo)?.[0]; }
        row.t = E.value ? Math.min(1, Math.max(0, evaluate(E.value, { ...ctx, ...part.generated.stats }))) : 0.5;
      } catch (err) { say(part.id, `${part.id}: its kind's economy rule doesn't work: ${err.message}`); continue; }
      if (!tiers.tiers[row.tier]?.price) { say(part.id, `${part.id}: its tier "${row.tier}" isn't one with prices (street, sport, race)`); continue; }
      const band = tiers.tiers[row.tier].price.map(k => k * row.rule.street);
      row.base = band[0] + (band[1] - band[0]) * row.t;
    }
    rows.push(row);
  }
  // then each measured part's price for what it does: along the slot's own parts' prices (on the car it was
  // measured on), never dearer than a part that does as much, never cheaper than one that does less — the hand-made
  // parts', and those of the family priced before it, least gain first — in a tier whose bands hold its price and gain
  const groups = new Map();
  for (const r of rows.filter(r => r.gain != null)) { const k = `${r.on}|${r.part.slot}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  for (const [ck, list] of groups) {
    const [on, slot] = ck.split('|');
    if (!curves.has(ck)) {
      // (the hand-made parts in this slot measured on the same car, cheapest first, each at least the one before)
      const own = Object.values(db.parts).filter(p => p.slot === slot && !p.generated && !p.retired && !p.todo?.length && p.tier && p.tier !== 'stock' && !p.purpose && forCar(db, on, p));
      const pts = own.map(p => { const g = partGain(db, on, p, tiers); return g.ok && g.gain != null ? [g.gain, p.price, p.name] : null; }).filter(Boolean).sort((a, b) => a[0] - b[0]);
      curves.set(ck, pts);
    }
    const handMade = curves.get(ck), rising = [];
    { let top = 0; for (const [g, p] of handMade) rising.push([g, top = Math.max(top, p)]); }
    const pts = handMade.map(x => [...x]), byPerf = new Map();
    for (const r of list.sort((a, b) => a.gain - b.gain)) {
      const pk = perfKey(r.part);
      if (byPerf.has(pk)) { Object.assign(r, byPerf.get(pk)); continue; }
      const below = pts.filter(([g]) => g <= r.gain + EPS), above = pts.filter(([g]) => g >= r.gain - EPS);
      const lo = Math.max(0, ...below.map(x => x[1])), hi = Math.min(Infinity, ...above.map(x => x[1]));
      if (lo > hi + 0.5) { say(r.part.id, `${r.part.name} does about as much as ${below.find(x => x[1] === lo)[2]} (${money(lo)}) and ${above.find(x => x[1] === hi)[2]} (${money(hi)}), which aren't priced in order: it can't be priced between them`); r.failed = true; continue; }
      const scaleBand = tiers.tiers[r.tier].price.map(k => k * r.rule.street);
      let base = alongCurve(rising, r.gain) ?? scaleBand[0] + (scaleBand[1] - scaleBand[0]) * r.t;
      base = Math.min(hi, Math.max(lo, base));
      // (its tier: the one its gain puts it in if that tier's price band holds the price, else one whose bands hold both;
      // first, one whose band holds its price for what it does — a street band's top would make it too cheap for that)
      const fits = t => { const g = r.rule.gain?.[t], b = tiers.tiers[t]?.price?.map(k => k * r.rule.street); return g && b && r.gain >= g[0] - 1e-9 && r.gain <= g[1] + 1e-9 && Math.max(lo, b[0]) <= Math.min(hi, b[1]) + 0.5; };
      const holds = t => { const b = tiers.tiers[t].price.map(k => k * r.rule.street); return base >= b[0] - 0.5 && base <= b[1] + 0.5; };
      const tier = [r.tier, ...TIER_ORDER].find(t => fits(t) && holds(t)) ?? (fits(r.tier) ? r.tier : TIER_ORDER.find(fits));
      if (!tier) { say(r.part.id, `${r.part.name}: for what it does (${said(r.gain, '%')}) it has to cost ${money(lo)}${hi < Infinity ? `–${money(hi)}` : ' or more'} next to the slot's other parts, which no tier's price band for ${slot} allows`); r.failed = true; continue; }
      const band = tiers.tiers[tier].price.map(k => k * r.rule.street), lo2 = Math.max(lo, band[0]), hi2 = Math.min(hi, band[1]);
      base = Math.min(hi2, Math.max(lo2, base));
      const rounded = Math.round(base / 10) * 10;
      base = rounded >= lo2 - 0.5 && rounded <= hi2 + 0.5 ? rounded : base;
      if (tier !== r.tier) { const g = r.rule.gain[tier]; r.t = Math.min(1, Math.max(0, (r.gain - g[0]) / (g[1] - g[0] || 1))); }
      Object.assign(r, { tier, base });
      byPerf.set(pk, { tier, base, t: r.t });
      pts.push([r.gain, base, r.part.name]);
      pts.sort((a, b) => a[0] - b[0]);
    }
  }
  // its finish's price on top (within the tier's band), and its unlock level
  for (const r of rows) {
    if (r.failed) continue;
    const { part, rule, finish, tier, base, gain, on } = r, band = tiers.tiers[tier].price.map(k => k * rule.street);
    const price = Math.round(Math.min(band[1], Math.max(band[0], base * (finish.price ?? 1))) / 10) * 10;
    const U = F.economy.unlock[tier], level = U ? Math.round(U[0] + (U[1] - U[0]) * r.t) : 1;
    part.tier = tier;
    part.price = price;
    if (level > 1) part.unlock = { level }; else delete part.unlock;
    part.generated.gain = gain == null ? null : +gain.toFixed(4);
    if (on) part.generated.measuredOn = on;
    part.generated.priceFactor = +(price / base).toFixed(4);
    part._generated = `${part._generated} ${gain == null ? `${tier}: priced by its settings` : `On the ${db.cars[on].name} it improves ${[].concat(rule.stat).join(' / ')} by ${said(gain, '%')}: ${tier}`}, ${money(price)}${level > 1 ? `, unlocked at level ${level}` : ''}.`;
  }
  return { problems };
}
