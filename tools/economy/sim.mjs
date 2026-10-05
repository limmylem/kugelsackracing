// The economy simulation (Phase 4 Step 5): a bot player over hours of play, on the game's own rules —
// the quests' rewards, fees, tiers and anti-farming (content/quests.js, quest/rules.js), levels, series
// bonuses, real part and car prices and the garage's real ratings (garage/), and crash repairs from the
// crash test suite's real bills. What it doesn't model is the driving: a run's outcome comes from the
// bot's skill and its car against the quest (data/economy.json simulation.performance).
//
//   makePool(economy, config, seed) → { quests: [quest items, rated], series: [series items] }
//   simulate({ db, config, pool, crashTable, skill, hours, seed }) → { events, samples, totals, ... }
//     crashTable: { carId: { kmh: full repair } } (crashCostTable: the crash suite, per car)

import { Garage } from '../../garage/data.js';
import { carPrice, setSize } from '../../garage/player/profile.js';
import { rewardsOf, tierOf } from '../../content/quests.js';
import { earnings, levelOf, farmingFactor } from '../../quest/rules.js';
import { seriesBonus } from '../../garage/player/quests.js';
import { rng as makeRng, hashSeed } from '../../ai/rng.js';

const CLASS_ORDER = ['D', 'C', 'B', 'A', 'S', 'X'];

// The quests a bot can find: stars by weight, km by stars, class rules, types and rivals by weight, the
// rating each would have (difficulty's recommended car by stars, inside the class)
export function makePool(economy, config, seed = 7) {
  const S = economy.simulation.pool, r = makeRng(hashSeed(seed, 'pool')), quests = [];
  const weighted = obj => { const keys = Object.keys(obj); let x = r() * keys.reduce((a, k) => a + obj[k], 0); for (const k of keys) { x -= obj[k]; if (x <= 0) return k; } return keys.at(-1); };
  const rec = config.difficulty.recommended.byStars;
  for (let i = 0; i < S.quests; i++) {
    const stars = 1 + +weighted(Object.fromEntries(S.stars.map((w, k) => [k, w])));
    const [k0, k1] = S.kmByStars[stars - 1], km = Math.round((k0 + (k1 - k0) * r()) * 10) / 10;
    const cls = weighted(S.classes), type = weighted(S.types);
    const raced = type === 'sprint' && r() < S.rivals.share;
    const npc = raced ? { count: Math.round(S.rivals.count[0] + (S.rivals.count[1] - S.rivals.count[0]) * r()), skill: S.rivals.skill[Math.min(2, Math.floor((stars - 1) / 2))] } : {};
    const id = `quest_sim${String(i).padStart(5, '0')}`;
    quests.push({ id, kind: 'quest', type, name: `${type} ${stars}★ ${km} km ${cls}`, entry: { classes: cls === 'open' ? [] : [cls], minLevel: 1 }, npc, params: { laps: 1 },
      rating: { stars, km, recommended: rec[stars - 1] + (cls === 'open' ? 0 : 60 * CLASS_ORDER.indexOf(cls)) } });
  }
  // series: groups of quests of the same tier
  const series = [], byTier = {};
  for (const q of quests) (byTier[tierOf(q, economy).tier] ??= []).push(q);
  for (let k = 0, t = 1; k < S.series; k++, t = t % 5 + 1) {
    const list = byTier[t] ?? byTier[1];
    const pick = r.shuffle(list).slice(0, S.seriesOf);
    if (pick.length === S.seriesOf) series.push({ id: `series_sim${String(k).padStart(4, '0')}`, kind: 'series', name: `Series ${k + 1} (tier ${t})`, quests: pick.map(q => q.id) });
  }
  return { quests, series };
}

// A crash's full repair for a car: the crash suite's for it stock, dearer for its upgrades in step with
// what's fitted (a crash damages some of the car's parts: simulation.crashes.upgradeShare of their value,
// against the car's own)
const crashCost = (table, car, kmh, share) => Math.round((table[car.carId]?.[kmh] ?? table.starter_car?.[kmh] ?? 500) * (1 + share * car.partsValue / Math.max(1, car.value)));

export function simulate({ db, config, pool, crashTable, skill = 0.55, hours = 8, seed = 7, now0 = Date.UTC(2026, 9, 1) }) {
  const E = db.economy, SIM = E.simulation, T = SIM.timing, C = SIM.crashes, PF = SIM.performance, SH = SIM.shopping;
  const r = makeRng(hashSeed(seed, 'bot', skill));
  const normal = () => { let u = 0; for (let i = 0; i < 6; i++) u += r(); return (u - 3) / Math.sqrt(0.5); };
  const byId = Object.fromEntries(pool.quests.map(q => [q.id, q]));
  const newCar = carId => { const g = new Garage(db, null, carId), st = g.stats(); return { carId, garage: g, value: carPrice(db, db.cars[carId]), partsValue: 0, rating: st.totals.rating.index, cls: st.totals.rating.class }; };
  const st = { money: E.startingMoney, xp: 0, cars: [newCar(E.startingCar)], progress: {}, series: {}, t: 0 };
  const car = () => st.cars[st.cars.length - 1];
  const events = [], samples = [], spend = { repairs: 0, parts: 0, cars: 0, fees: 0 }, income = {}, crashes = [];
  let firstUpgrade = null, secondCar = null, stuck = 0, runs = 0, safetyNet = 0;
  const recentGold = [];                  // (the gold rewards of its last runs: a typical race reward for it now)
  const typical = () => { const a = recentGold.slice().sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };
  const iso = () => new Date(now0 + st.t * 1000).toISOString();
  const sample = () => samples.push({ t: st.t, money: st.money, level: levelOf(st.xp, config), rating: car().rating, carId: car().carId });
  sample();

  // what a run would earn the bot (its expected medal, no noise)
  const scoreOf = q => skill * PF.skill + PF.car * (car().rating - q.rating.recommended) / q.rating.recommended;
  const medalFor = (q, score) => { const up = PF.perStar * (q.rating.stars - 1); return score >= PF.gold + up ? 'gold' : score >= PF.silver + up ? 'silver' : score >= PF.bronze + up ? 'bronze' : null; };
  const placeFor = (q, score) => {
    if (!q.npc?.count) return null;
    let ahead = 0;
    for (let i = 0; i < q.npc.count; i++) { const sk = q.npc.skill[0] + (q.npc.skill[1] - q.npc.skill[0]) * r(); if (sk + PF.noise * normal() > score) ahead++; }
    return ahead + 1;
  };
  const duration = q => T.travelSeconds + T.overheadSeconds + q.rating.km * 1000 / T.speedByStars[q.rating.stars - 1];
  const allowed = q => { const cls = q.entry.classes; return !cls.length || cls.includes(car().cls); };
  function expected(q) {
    // (a race: the place it expects — each rival ahead as likely as their skill range is above its score,
    // or the place it had last time there)
    const score = scoreOf(q), seen = st.progress[q.id]?.lastPlace;
    const place = q.npc?.count ? (seen ?? 1 + Math.round(q.npc.count * Math.max(0, Math.min(1, (q.npc.skill[1] - score) / Math.max(0.05, q.npc.skill[1] - q.npc.skill[0]))))) : null;
    const medal = place != null ? (place <= 3 ? ['gold', 'silver', 'bronze'][place - 1] : null) : medalFor(q, score);
    const pay = earnings({ quest: q, outcome: { status: 'finished', medal, place: place != null && place > 3 ? place : null }, progress: { ...(st.progress[q.id] ?? {}), recent: st.progress[q.id]?.recent ?? [] }, economy: E, config, now: iso() });
    const fee = rewardsOf(q, E).fee;
    // (xp is worth something too: a level opens better quests; and a series nearly done, its bonus)
    let bonus = 0;
    for (const S of pool.series) if (!st.series[S.id] && S.quests.includes(q.id) && !st.progress[q.id]?.completed) {
      const left = S.quests.filter(id => !st.progress[id]?.completed).length;
      bonus += seriesBonus({ item: S, quests: S.quests.map(id => byId[id]) }, E).money / left;
    }
    return (pay.money - fee + pay.xp * 2 + bonus) / duration(q);
  }

  // ---------- shopping (between quests) ----------
  // what each part adds to a car stock (worked out once per model): the order the bot looks at them in
  const stockGains = new Map();
  function gainsOf(carId) {
    if (stockGains.has(carId)) return stockGains.get(carId);
    const g = new Garage(db, null, carId), base = g.stats().totals.rating.index, saved = JSON.stringify(g.state), slots = new Set(db.cars[carId].sockets.map(s => s.slot)), out = [];
    for (const part of Object.values(db.parts)) {
      if (!slots.has(part.slot) || part.retired || part.todo?.length) continue;
      const cost = part.price * setSize(db, part, carId);
      if (cost <= 0) continue;
      if (g.install(part.id)?.ok !== false) { const gain = g.stats().totals.rating.index - base; if (gain > 0) out.push({ id: part.id, cost, est: gain }); }
      g.state = JSON.parse(saved);
    }
    out.sort((a, b) => b.est / b.cost - a.est / a.cost);
    stockGains.set(carId, out);
    return out;
  }
  // the best affordable upgrade now: the ten likeliest (by what they add stock) tried on the car as it is
  function bestUpgrade(c, budget) {
    const saved = JSON.stringify(c.garage.state), owned = new Set(c.bought ?? []);
    let pick = null, tried = 0;
    for (const o of gainsOf(c.carId)) {
      if (o.cost > budget || owned.has(o.id)) continue;
      if (++tried > 10) break;
      if (c.garage.install(o.id)?.ok !== false) {
        const gain = c.garage.stats().totals.rating.index - c.rating;
        if (gain >= SH.minGain && c.garage.drivable().ok && (!pick || gain / o.cost > pick.gain / pick.cost)) pick = { id: o.id, cost: o.cost, gain };
      }
      c.garage.state = JSON.parse(saved);
    }
    return pick;
  }
  function shop() {
    const c = car();
    // a better car: rated well above this one, affordable with the reserve left over
    const cars = Object.keys(db.cars).filter(id => !db.cars[id].retired && !st.cars.some(x => x.carId === id));
    let best = null;
    for (const id of cars) {
      const price = carPrice(db, db.cars[id]);
      if (price > st.money - SH.reserve) continue;
      const g = new Garage(db, null, id), rating = g.stats().totals.rating.index;
      if (rating < c.rating + SH.carMargin) continue;
      if (!best || rating / price > best.rating / best.price) best = { id, price, rating };
    }
    if (best) {
      st.money -= best.price; spend.cars += best.price;
      st.cars.push(newCar(best.id));
      events.push({ t: st.t, what: 'car', carId: best.id, price: best.price });
      if (st.cars.length === 2 && secondCar == null) secondCar = st.t;
      return true;
    }
    // an upgrade: the most rating per dollar (what each part would add, worked out again only when the
    // car's build changes)
    const budget = st.money - SH.reserve;
    if (budget <= 0) return false;
    const pick = bestUpgrade(c, budget);
    if (!pick) return false;
    c.garage.install(pick.id);
    const s2 = c.garage.stats();
    c.rating = s2.totals.rating.index; c.cls = s2.totals.rating.class; c.partsValue += pick.cost; (c.bought ??= []).push(pick.id);
    st.money -= pick.cost; spend.parts += pick.cost;
    events.push({ t: st.t, what: 'part', partId: pick.id, price: pick.cost, gain: pick.gain });
    if (firstUpgrade == null && pick.gain >= SIM.targets.meaningfulGain) firstUpgrade = st.t;
    return true;
  }

  // ---------- quests ----------
  while (st.t < hours * 3600) {
    while (shop()) { /* (as much as it can) */ }
    const level = levelOf(st.xp, config);
    const open = pool.quests.filter(q => allowed(q) && rewardsOf(q, E).unlockLevel <= level && rewardsOf(q, E).fee <= st.money);
    if (!open.length) { stuck++; st.t += 300; events.push({ t: st.t, what: 'stuck', money: st.money }); continue; }
    // the best value a minute, now and then something else (a player doesn't always know)
    const ranked = open.map(q => ({ q, v: expected(q) })).sort((a, b) => b.v - a.v);
    const q = (r() < 0.15 ? ranked[Math.floor(r() * Math.min(8, ranked.length))] : ranked[0]).q;
    const terms = rewardsOf(q, E);
    recentGold.push(terms.money); if (recentGold.length > 10) recentGold.shift();
    st.money -= terms.fee; spend.fees += terms.fee; runs++;
    st.t += duration(q);
    // crashes along the way: what each costs to fix (the full repair), against what the quest pays
    const lambda = C.perKm * q.rating.km * C.byStars[q.rating.stars - 1] * (1 - skill * C.skillCut);
    let n = 0; { let p = Math.exp(-lambda), s = p; const u = r(); while (u > s && n < 6) { n++; p *= lambda / n; s += p; } }
    let dnf = false;
    for (let i = 0; i < n; i++) {
      let x = r() * Object.values(C.speeds).reduce((a, b) => a + b, 0), kmh = 30;
      for (const [k, w] of Object.entries(C.speeds)) { x -= w; if (x <= 0) { kmh = +k; break; } }
      const cost = crashCost(crashTable, car(), kmh, C.upgradeShare ?? 0.3), share = cost / Math.max(1, typical());
      crashes.push({ t: st.t, kmh, cost, share, quest: q.id, tier: terms.tier });
      if (kmh >= C.dnfAt) dnf = true;
      // (the repair: in full if it can, else what it can, else the free basic repair)
      const paid = Math.min(cost, Math.max(0, st.money));
      if (paid < cost) safetyNet++;
      st.money -= paid; spend.repairs += paid;
    }
    if (dnf) { events.push({ t: st.t, what: 'dnf', quest: q.id }); continue; }
    const score = scoreOf(q) + PF.noise * normal();
    const place = placeFor(q, score), medal = place != null ? (place <= 3 ? ['gold', 'silver', 'bronze'][place - 1] : null) : medalFor(q, score);
    const pr = st.progress[q.id] ??= { paidShare: 0, finishPaid: false, recent: [], completed: false };
    const pay = earnings({ quest: q, outcome: { status: 'finished', medal, place }, progress: pr, economy: E, config, now: iso() });
    const levelWas = levelOf(st.xp, config);
    st.money += pay.money; st.xp += pay.xp;
    if (!pay.repeat) { if (medal && config.rewards[medal] > pr.paidShare) pr.paidShare = config.rewards[medal]; else if (!medal) pr.finishPaid = true; }
    pr.recent = [...pr.recent, iso()].slice(-10); pr.completed = true;
    if (place != null) pr.lastPlace = place;
    (st.runLog ??= []).push({ q: q.id, type: q.type, tier: terms.tier, medal, place, pay: pay.money, fee: terms.fee, repeat: pay.repeat, farming: pay.farming });
    const key = `${q.type}·${terms.tier}`;
    const inc = income[key] ??= { type: q.type, tier: terms.tier, money: 0, seconds: 0, runs: 0 };
    inc.money += pay.money - terms.fee; inc.seconds += duration(q); inc.runs++;
    // a series finished
    for (const S of pool.series) {
      if (st.series[S.id] || !S.quests.includes(q.id) || !S.quests.every(id => st.progress[id]?.completed)) continue;
      const b = seriesBonus({ item: S, quests: S.quests.map(id => byId[id]) }, E);
      st.money += b.money; st.xp += b.xp; st.series[S.id] = st.t;
      events.push({ t: st.t, what: 'series', id: S.id, money: b.money });
    }
    if (levelOf(st.xp, config) > levelWas) events.push({ t: st.t, what: 'level', level: levelOf(st.xp, config) });
    sample();
  }
  sample();
  const earned = Object.values(income).reduce((a, x) => a + x.money, 0) + events.filter(e => e.what === 'series').reduce((a, e) => a + e.money, 0);
  return { skill, hours, runs, stuck, safetyNet, firstUpgrade, secondCar, samples, events, spend, income, crashes, earned, level: levelOf(st.xp, config), xp: st.xp, money: st.money, cars: st.cars.map(c => ({ carId: c.carId, rating: c.rating, cls: c.cls })), runLog: st.runLog ?? [], series: Object.keys(st.series).length };
}

// The crash suite's full repair for each car at each speed (the average of every crash there)
export async function crashCostTable() {
  const { crashContext } = await import('../../tests/harness.mjs'), { crashRuns, runCrash } = await import('../../garage/crashSuite.js');
  const ctx = await crashContext(), T = ctx.targets, out = {};
  for (const carId of Object.keys(ctx.db.cars)) {
    const by = {};
    for (const run of crashRuns(T).filter(x => !x.mass)) { const res = runCrash(ctx, { ...run, carId, otherId: carId }, T); (by[run.kmh] ??= []).push(res.cars[0].repair.full); }
    out[carId] = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, Math.round(v.reduce((a, b) => a + b, 0) / v.length)]));
  }
  return out;
}
