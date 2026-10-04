// NPC cars, from the parts system (garage/data.js): a model the quest lets in, then upgraded part by part
// (the parts that fit it, a few tried at a time, the one that brings it nearest the target kept) towards a
// performance target — the rating the quest's class allows × data/npc.json cars.target, or the player's
// car's own rating when the quest is open to any car — never past the quest's limits (class, power,
// weight, power to weight). So an NPC's car is a real build: its grip, power and weight are its parts'.
//
//   targetRating({ quest, npcSettings, classes, playerRating, cfg }) → the rating to aim for
//   buildNpcCar(db, { carId, quest, target, seed, cfg, qcfg }) → { carId, garage, stats, rating, className, kw, kg, parts: [partId] }
//   eligibleModels(db, quest, config) → [carId] the models the quest lets in (stock)

import { Garage } from '../garage/data.js';
import { entryReasons, CAR_CODES } from '../quest/rules.js';
import { rng as makeRng, hashSeed } from './rng.js';

const summary = stats => ({ className: stats.totals.rating.class, kw: stats.totals.peakPower.kw, kg: stats.totals.mass, rating: stats.totals.rating.index });
const fitsQuest = (quest, stats, qcfg) => !entryReasons({ quest, car: summary(stats), player: null, fee: 0, config: qcfg }).some(r => CAR_CODES.has(r.code));

export function eligibleModels(db, quest, qcfg) {
  return Object.keys(db.cars).filter(id => !db.cars[id].hidden && fitsQuest(quest, new Garage(db, null, id).stats(), qcfg));
}

// the rating to aim for: as fast as the quest's (or the NPC settings') class allows, a little under; an
// open quest: the player's own car's
export function targetRating({ quest, npcSettings = {}, classes, playerRating = null, cfg }) {
  const order = classes.map(c => c.class), cls = npcSettings.carClass ?? (quest.entry?.classes?.length ? quest.entry.classes.slice().sort((a, b) => order.indexOf(b) - order.indexOf(a))[0] : null);
  if (!cls) return playerRating ?? 400;
  const i = order.indexOf(cls), from = classes[i]?.from ?? 100, to = classes[i + 1]?.from ?? from + 150;
  return from + (to - 1 - from) * cfg.cars.target;
}

const memo = new Map();
export function buildNpcCar(db, { carId, quest, target, seed = 1, cfg, qcfg }) {
  // (its own randomness from the seed: the same car for the same race, whether or not it's remembered)
  const key = JSON.stringify([carId, quest.entry ?? null, Math.round(target), seed]), rng = makeRng(hashSeed(seed, carId));
  if (memo.has(key)) return clone(memo.get(key), db);
  const g = new Garage(db, null, carId);
  let stats = g.stats(), best = Math.abs(stats.totals.rating.index - target);
  const fitted = [];
  const car = db.cars[carId], slots = new Set(car.sockets.map(s => s.slot));
  const candidates = Object.values(db.parts).filter(p => slots.has(p.slot) && !p.retired && !p.todo?.length);
  for (let round = 0; round < cfg.cars.maxParts && stats.totals.rating.index < target - cfg.cars.tolerance; round++) {
    let pick = null;
    for (const part of rng.shuffle(candidates).slice(0, 18)) {
      const saved = JSON.stringify(g.state);
      const r = g.install(part.id);
      if (r.ok) {
        const st = g.stats(), gap = Math.abs(st.totals.rating.index - target);
        if (st.totals.rating.index <= target + cfg.cars.tolerance && gap < best && fitsQuest(quest, st, qcfg) && g.drivable().ok) { best = gap; pick = part.id; }
      }
      g.state = JSON.parse(saved);
    }
    if (!pick) break;
    g.install(pick);
    fitted.push(pick);
    stats = g.stats();
  }
  const out = { carId, state: JSON.parse(JSON.stringify(g.state)), parts: fitted };
  memo.set(key, out);
  if (memo.size > 64) memo.delete(memo.keys().next().value);
  return clone(out, db);
}
function clone(o, db) {
  const garage = new Garage(db, JSON.parse(JSON.stringify(o.state)), o.carId), stats = garage.stats();
  return { carId: o.carId, garage, stats, parts: o.parts.slice(), rating: stats.totals.rating.index, className: stats.totals.rating.class, kw: stats.totals.peakPower.kw, kg: stats.totals.mass };
}
