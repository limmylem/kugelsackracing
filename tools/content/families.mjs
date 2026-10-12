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

export function priceFamilyParts(items, { db, formulas: F, tiers }) {
  const problems = new Map(), say = (id, p) => { if (!problems.has(id)) problems.set(id, []); problems.get(id).push(p); };
  // (the new parts in the game's data, to measure them on a car)
  const all = { ...db, parts: { ...db.parts } };
  for (const { part } of items) all.parts[part.id] = { ...part, price: part.price || 1 };
  const measured = new Map(), curves = new Map(), money = n => `$${Math.round(n).toLocaleString('en-GB')}`;
  for (const { part, ctx } of items) {
    const kind = F.families[part.generated.kind], rule = tiers.slots[part.slot], finish = F.finishes[part.generated.settings.finish];
    if (!rule?.street) { say(part.id, `${part.id}: data/content/tiers.json has no price for the ${part.slot} slot`); continue; }
    let tier, t, gain = null, on = null;
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
      gain = m.gain ?? 0; on = m.car;
      const stat = [].concat(rule.stat).join(' / ');
      if (gain < scale[0].lo) { say(part.id, `${part.name} improves ${stat} by ${said(gain, '%')} on the ${db.cars[on].name}: too little for any tier (a ${scale[0].tier} ${part.slot} part gives at least ${said(scale[0].lo, '%')})`); continue; }
      if (gain > scale.at(-1).hi) { say(part.id, `${part.name} improves ${stat} by ${said(gain, '%')} on the ${db.cars[on].name}: too much for any tier (a ${scale.at(-1).tier} ${part.slot} part gives at most ${said(scale.at(-1).hi, '%')})`); continue; }
      const s = scale.find(x => gain <= x.hi + 1e-9);
      tier = s.tier; t = Math.min(1, Math.max(0, (gain - s.lo) / (s.hi - s.lo || 1)));
    } else {
      const E = kind.economy ?? {};
      try {
        if (E.tier) tier = String(E.tier).split('.').reduce((o, k) => o?.[k], ctx);
        else if (E.tierBy) { const v = ctx[E.tierBy.by] ?? part.generated.stats[E.tierBy.by]; tier = E.tierBy.steps.find(([, upTo]) => v < upTo)?.[0]; }
        t = E.value ? Math.min(1, Math.max(0, evaluate(E.value, { ...ctx, ...part.generated.stats }))) : 0.5;
      } catch (err) { say(part.id, `${part.id}: its kind's economy rule doesn't work: ${err.message}`); continue; }
      if (!tiers.tiers[tier]?.price) { say(part.id, `${part.id}: its tier "${tier}" isn't one with prices (street, sport, race)`); continue; }
    }
    // the price: along the slot's own parts' prices for what they do (a measured kind), else within the tier's band
    const band = tiers.tiers[tier].price.map(k => k * rule.street);
    let base = band[0] + (band[1] - band[0]) * t;
    if (gain != null) {
      const ck = `${on}|${part.slot}`;
      if (!curves.has(ck)) {
        // (the hand-made parts in this slot measured on the same car, cheapest first, each at least the one before)
        const own = Object.values(db.parts).filter(p => p.slot === part.slot && !p.generated && !p.retired && !p.todo?.length && p.tier && p.tier !== 'stock' && !p.purpose && forCar(db, on, p));
        const pts = own.map(p => { const g = partGain(db, on, p, tiers); return g.ok && g.gain != null ? [g.gain, p.price] : null; }).filter(Boolean).sort((a, b) => a[0] - b[0]);
        let top = 0;
        curves.set(ck, pts.map(([g, p]) => [g, top = Math.max(top, p)]));
      }
      base = alongCurve(curves.get(ck), gain) ?? base;
    }
    const clampBand = p => Math.min(band[1], Math.max(band[0], p));
    base = clampBand(base);
    const price = Math.round(clampBand(base * (finish.price ?? 1)) / 10) * 10;
    const U = F.economy.unlock[tier], level = U ? Math.round(U[0] + (U[1] - U[0]) * t) : 1;
    part.tier = tier;
    part.price = price;
    if (level > 1) part.unlock = { level }; else delete part.unlock;
    part.generated.gain = gain == null ? null : +gain.toFixed(4);
    if (on) part.generated.measuredOn = on;
    part.generated.priceFactor = +(price / Math.round(base / 10) / 10).toFixed(3);
    part._generated = `${part._generated} ${gain == null ? `${tier}: priced by its settings` : `On the ${db.cars[on].name} it improves ${[].concat(rule.stat).join(' / ')} by ${said(gain, '%')}: ${tier}`}, ${money(price)}${level > 1 ? `, unlocked at level ${level}` : ''}.`;
  }
  return { problems };
}
