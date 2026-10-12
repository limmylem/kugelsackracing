// The checks the live server runs on a part as it's edited in the content manager (Phase 8 Step 3; docs/CONTENT_PIPELINE.md),
// there and then: its allowed ranges and price band (garage/content.js editProblems — before this), what it does
// against its tier (measured as the balance rules measure it: garage/balance.js), and the class limits — on every car
// it fits, that car's most powerful build as the content checks last found it (data/content/checks.json classes) with
// this part in it, still within the car's class limit. What an edit can't change — its models, so its fit and budget —
// keeps the content checks' results; the drive, the crash and the sound were run by those checks with its stats at
// the ends of their allowed ranges (the 'ranges' check), so any edit within them is covered.
//
//   liveChecks(db, part, { tiers, balance, classes }) → { ok, problems: [plain words], gain, cars: { carId: { ok, class, index } } }
//
// No browser or Node APIs.

import { Garage } from './data.js';
import { classProblems, fitWithNeeds, forCar, partGain, REFERENCE_CAR } from './balance.js';
import { fingerprint } from './fingerprint.js';

export function liveChecks(db, part, { tiers, balance, classes = {} }) {
  const problems = [], out = { ok: true, problems, gain: null, cars: {} };
  const rule = tiers.slots?.[part.slot];
  // its price and what it does, against its tier
  if (part.tier && part.tier !== 'stock' && rule) {
    const band = tiers.tiers[part.tier]?.price;
    if (band && rule.street && (part.price < band[0] * rule.street - 0.5 || part.price > band[1] * rule.street + 0.5)) problems.push(`$${part.price.toLocaleString('en-GB')} is outside the ${part.tier} price band for ${part.slot}`);
    const range = rule.gain?.[part.tier];
    if (rule.stat && !part.purpose && range) {
      const carId = part.generated?.measuredOn ?? (forCar(db, REFERENCE_CAR, part) ? REFERENCE_CAR : Object.keys(db.cars).sort().find(c => forCar(db, c, part)));
      const g = carId ? partGain(db, carId, part, tiers) : null;
      if (g?.ok) {
        out.gain = g.gain;
        if (g.gain == null || g.gain < range[0] - 1e-9 || g.gain > range[1] + 1e-9) problems.push(`it improves ${[].concat(rule.stat).join(' / ')} by ${g.gain == null ? 'nothing' : `${(g.gain * 100).toFixed(1)}%`} on the ${db.cars[carId].name}: a ${part.tier} ${part.slot} part gives ${(range[0] * 100).toFixed(1)}–${(range[1] * 100).toFixed(1)}%`);
      } else if (g) problems.push(`it can't be fitted to the ${db.cars[carId].name} to measure it: ${g.error}`);
    }
  }
  // the class limits: each car's most powerful build, with it
  for (const carId of Object.keys(db.cars).filter(c => forCar(db, c, part))) {
    const c = classes[carId];
    if (!c?.max?.parts) continue;
    let g = new Garage(db, null, carId);
    for (const id of c.max.parts) { if (id === part.id || !db.parts[id]) continue; const r = fitWithNeeds(db, carId, id, { base: g }); if (r.ok) g = r.garage; }
    for (const t of c.max.tuning ?? []) {
      const socket = Object.entries(g.build.sockets).find(([, iid]) => iid && g.state.parts[iid]?.partId === t.part)?.[0];
      if (socket) { const inst = g.state.parts[g.build.sockets[socket]]; inst.tuning = { ...inst.tuning, [t.setting]: t.value }; }
    }
    g.build.fingerprint = fingerprint(g.build, g.state.parts);
    const r = fitWithNeeds(db, carId, part.id, { base: g });
    if (!r.ok) continue;                            // (it doesn't go in that build: its own checks cover it)
    // (its best setting, as the search would: each adjustable one at its ends and default)
    const best = r.garage, rate = () => best.stats().totals?.rating;
    for (const t of best.tunable().filter(x => x.part === part.id)) {
      let keep = t.value, top = rate()?.index ?? 0;
      for (const v of [t.min, t.max, t.default]) { const inst = best.state.parts[best.build.sockets[t.socket]]; inst.tuning = { ...inst.tuning, [t.setting]: v }; const i = rate()?.index ?? 0; if (i > top) { top = i; keep = v; } }
      const inst = best.state.parts[best.build.sockets[t.socket]]; inst.tuning = { ...inst.tuning, [t.setting]: keep };
    }
    const rating = rate(), stock = new Garage(db, null, carId).stats().totals.rating;
    if (!rating) continue;
    const p = classProblems(db, carId, balance, { stock, max: rating }).filter(x => !x.startsWith('stock'));
    out.cars[carId] = { ok: !p.length, class: rating.class, index: rating.index };
    for (const x of p) problems.push(`on the ${db.cars[carId].name}, the most powerful build with it: ${x}`);
  }
  out.ok = !problems.length;
  return out;
}
