// Who races: a quest's NPC settings (quest.npc, else data/npc.json defaults) → the drivers (picked by id,
// or at random from the roster by the race's seed), each one's skill (its own, fitted into the quest's
// skill range, so the order between drivers stays), aggression (its own, or the quest's), and its car —
// its favourite model if the quest lets it in, else one that the quest does, built from the parts system
// towards the performance target (ai/npcCars.js). A pink slip's rival drives the car at stake.
//
//   npcSettings(quest, cfg) → { count, skill: [min, max], drivers, carClass, aggression, rubberBand }
//   setupNpcs({ db, quest, course, cfg, qcfg, seed, playerRating, picks, count }) → [{ profile, params, build, spec, slot }]

import { rng as makeRng, hashSeed } from '../ai/rng.js';
import { driverParams } from '../ai/skill.js';
import { carCaps } from '../route/racingLine.js';
import { buildNpcCar, eligibleModels, targetRating } from '../ai/npcCars.js';

export function npcSettings(quest, cfg) {
  const d = cfg.defaults, n = quest.npc ?? {};
  const count = Math.max(0, Math.min(cfg.race.maxNpcs, quest.type === 'pink_slip' ? 1 : n.count ?? (quest.type === 'sprint' ? 0 : 0)));
  return { count, skill: n.skill ?? d.skill, drivers: n.drivers ?? d.drivers, carClass: n.carClass ?? d.carClass, aggression: n.aggression ?? d.aggression, rubberBand: quest.type === 'pink_slip' ? false : n.rubberBand ?? d.rubberBand };
}

export function setupNpcs({ db, quest, course, cfg, qcfg, seed = 1, playerRating = null, picks = null, count = null }) {
  const N = npcSettings(quest, cfg), r = makeRng(hashSeed(seed, 'setup', quest.id ?? ''));
  const n = Math.min(cfg.race.maxNpcs, count ?? N.count, (course.grid.slots?.length ?? 8) - 1);
  if (n <= 0) return [];
  // the drivers
  let roster;
  if (picks?.length) roster = picks.map(p => ({ ...(cfg.drivers.find(d => d.id === (p.id ?? p)) ?? cfg.drivers[0]), ...(typeof p === 'object' ? p : {}) }));
  else if (Array.isArray(N.drivers) && N.drivers.length) roster = N.drivers.map(id => cfg.drivers.find(d => d.id === id)).filter(Boolean);
  else roster = r.shuffle(cfg.drivers);
  roster = roster.slice(0, n);
  while (roster.length < n) roster.push(cfg.drivers[roster.length % cfg.drivers.length]);
  // their cars: what the quest lets in, aimed at the target
  const classes = db.classes.classes ?? db.classes, target = targetRating({ quest, npcSettings: N, classes, playerRating, cfg });
  // (the models the quest lets in that can get near the target: none whose stock car is well past it)
  const allowed = eligibleModels(db, quest, qcfg), near = allowed.filter(id => stockRating(db, id) <= target + cfg.cars.tolerance * 2);
  let models = near.length ? near : allowed.slice().sort((a, b) => stockRating(db, a) - stockRating(db, b)).slice(0, 1);
  // (and that can get round the route's tightest bend without a three-point turn, when some can)
  const tight = tightestRadius(course), turns = models.filter(id => stockTurn(db, id) <= tight * 0.97);
  if (turns.length) models = turns;
  const [lo, hi] = N.skill;
  return roster.map((p, i) => {
    const skill = p.skillFixed ?? (picks?.[i]?.skill ?? lo + (hi - lo) * (p.skill ?? 0.5));
    const params = driverParams(p, cfg, { skill, aggression: N.aggression ?? undefined });
    let carId = quest.type === 'pink_slip' && quest.params?.opponentCar ? quest.params.opponentCar : p.car;
    if (!models.includes(carId) && quest.type !== 'pink_slip') carId = models.length ? models.slice().sort((a, b) => Math.abs(stockRating(db, a) - target) - Math.abs(stockRating(db, b) - target))[Math.floor(r() * Math.min(2, models.length))] : 'starter_car';
    const build = buildNpcCar(db, { carId, quest, target, seed: hashSeed(seed, p.id, i), cfg, qcfg });
    return { profile: { ...p, skill }, params, build, spec: build.stats.spec, slot: i + 1 };
  });
}
// the route's tightest bend on its racing line (m)
function tightestRadius(course) {
  let k = 0;
  for (const p of course.racing?.points ?? []) k = Math.max(k, Math.abs(p.k));
  return k > 0 ? 1 / k : Infinity;
}
const turning = new Map();
function stockTurn(db, id) {
  if (!turning.has(id)) turning.set(id, carCaps(buildNpcCar(db, { carId: id, quest: { entry: {} }, target: 0, cfg: { cars: { maxParts: 0, tolerance: 0 } }, qcfg: null }).stats).turnRadius ?? 0);
  return turning.get(id);
}
const ratings = new Map();
function stockRating(db, id) {
  if (!ratings.has(id)) ratings.set(id, buildNpcCar(db, { carId: id, quest: { entry: {} }, target: 0, cfg: { cars: { maxParts: 0, tolerance: 0 } }, qcfg: null }).rating);
  return ratings.get(id);
}
