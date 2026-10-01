// The most powerful valid build of a car (for the balance tests and report): starting from stock, try
// every part for sale in every socket — fitting what it needs with it — and every adjustable setting at
// its ends and default, keep whatever raises the performance rating most, and repeat until nothing does.
// → { garage, rating, parts: [ids fitted that aren't stock], tuning: [{ part, setting, value }], steps }

import { Garage } from '../../garage/data.js';
import { fingerprint } from '../../garage/fingerprint.js';
import { fitWithNeeds, forCar } from './balance.mjs';

const ratingOf = g => g.stats().totals?.rating ?? null;
const clone = x => JSON.parse(JSON.stringify(x));

// (greedy from each of the `seeds` best first moves too — a different turbo and ECU to start from —
// keeping the best, so one early choice doesn't hide a better build)
export function maxBuild(db, carId = 'starter_car', { forSale = p => !p.retired && !p.todo?.length, rounds = 20, seeds = 3 } = {}) {
  const first = climb(db, carId, forSale, rounds, null, seeds);
  let top = first;
  for (const start of first.firstMoves) {
    const r = climb(db, carId, forSale, rounds, start, 0);
    if (r.rating.index > top.rating.index) top = r;
  }
  return top;
}

function climb(db, carId, forSale, rounds, start, keepFirst) {
  let best = start?.garage ?? new Garage(db, null, carId), bestRating = ratingOf(best).index;
  const steps = start ? [`${start.what} → ${start.rating}`] : [], firstMoves = [];
  // (every upgrade for sale that goes on this car: the stock parts are what it starts from — less the
  //  ones that can't make it faster: looks, safety gear)
  const candidates = Object.values(db.parts).filter(p => forSale(p) && p.tier !== 'stock' && !['looks', 'safety'].includes(p.purpose) && forCar(db, carId, p));
  for (let round = 0; round < rounds; round++) {
    let improved = null;
    const moves = [];
    // every part, with what it needs
    for (const part of candidates) {
      if (Object.values(best.build.sockets).some(id => id && best.state.parts[id]?.partId === part.id)) continue;
      const tried = fitWithNeeds(db, carId, part.id, { base: best });
      if (!tried.ok || !tried.garage.drivable().ok) continue;
      tuneBest(tried.garage, [part.id, ...tried.with]);          // (a part at its best settings: a boost turned up)
      const r = ratingOf(tried.garage), move = { garage: tried.garage, rating: r?.index ?? 0, what: `fit ${part.id}${tried.with.length ? ` (with ${tried.with.join(', ')})` : ''}` };
      if (keepFirst && round === 0) moves.push(move);
      if (r && r.index > (improved?.rating ?? bestRating)) improved = move;
    }
    if (keepFirst && round === 0) firstMoves.push(...moves.sort((a, b) => b.rating - a.rating).slice(1, keepFirst + 1));
    // every setting of every fitted part: its ends and its default
    for (const t of best.tunable()) {
      for (const value of [t.min, t.max, t.default]) {
        if (value === t.value) continue;
        const g = new Garage(db, clone(best.state), carId);
        setTuning(g, t, value);
        const r = ratingOf(g);
        if (r && r.index > (improved?.rating ?? bestRating)) improved = { garage: g, rating: r.index, what: `tune ${t.part} ${t.setting} ${value}` };
      }
    }
    if (!improved) break;
    best = improved.garage; bestRating = improved.rating;
    steps.push(`${improved.what} → ${improved.rating}`);
  }
  // the settings of these parts, each at whichever of its ends and default rates best (in turn, twice)
  function tuneBest(g, ids) {
    for (let pass = 0; pass < 2; pass++) for (const t of g.tunable().filter(x => ids.includes(x.part))) {
      let bestValue = t.value, bestIndex = ratingOf(g)?.index ?? 0;
      for (const v of [t.min, t.max, t.default]) { setTuning(g, t, v); const i = ratingOf(g)?.index ?? 0; if (i > bestIndex) { bestIndex = i; bestValue = v; } }
      setTuning(g, t, bestValue);
    }
  }
  const stock = new Set(db.cars[carId].sockets.flatMap(s => s.stock));
  const parts = [...new Set(Object.values(best.build.sockets).filter(Boolean).map(id => best.state.parts[id].partId))].filter(id => !stock.has(id));
  const tuning = best.tunable().filter(t => t.value !== t.default).map(t => ({ part: t.part, setting: t.setting, value: t.value }));
  return { garage: best, rating: ratingOf(best), parts, tuning, steps, firstMoves };
}

// (a setting straight onto the fitted copy: the rating is all the search needs, so no report)
function setTuning(g, t, value) {
  const inst = g.state.parts[g.build.sockets[t.socket]];
  inst.tuning = { ...inst.tuning, [t.setting]: value };
  g.build.fingerprint = fingerprint(g.build, g.state.parts);
}
