// The quest rules that are numbers, pure: medal thresholds, what a run earns (economy's reward × the share
// a medal or a finish earns, once per tier, then a small repeat), the player's level from xp, and who may
// enter (plain-English reasons, and which of the player's cars would do).
//
//   medalTargets(quest, course, config) → { kind: 'time' | 'score', gold, silver, bronze }
//   medalOf(targets, { time, score }) → 'gold' | 'silver' | 'bronze' | null
//   earnings({ quest, outcome, progress, economy, config, now }) → { money, xp, tiers, repeat, lines, farming }
//   levelOf(xp, config) → level      levelProgress(xp, config)      farmingFactor(recent, now, economy)
//   entryReasons({ quest, car, player, fee, config, economy }) → [reason]
//   carsThatQualify(quest, cars) → [car]

import { rewardsOf, TYPES } from '../content/quests.js';

export const TIERS = ['bronze', 'silver', 'gold'];
export const SCORE_TYPES = new Set(['drift']);
const ordinal = n => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10 < 4 ? n % 10 : 0]}`;
const money = (n, cur = '$') => `${cur}${Math.round(n).toLocaleString('en-GB')}`;

// Medals: times from the route's reference time (else its estimate) × the multipliers, × laps; scores
// from the quest's target × theirs. A quest's own medalTimes / medalScores win.
export function medalTargets(quest, course, config) {
  const P = quest.params ?? {}, M = config.medals;
  if (SCORE_TYPES.has(quest.type)) {
    if (P.medalScores?.gold) return { kind: 'score', ...P.medalScores };
    const target = P.scoreTarget ?? 1000;
    return { kind: 'score', gold: Math.round(target * M.score.gold), silver: Math.round(target * M.score.silver), bronze: Math.round(target * M.score.bronze) };
  }
  if (P.medalTimes?.gold) return { kind: 'time', ...P.medalTimes };
  // the AI reference times (the editor's AI test race), for this quest's class: gold the high-skill AI's
  // time, silver the medium's, bronze the low's
  const ai = course?.aiTimes?.[classKey(quest)];
  if (ai?.high && ai?.medium && ai?.low && quest.type !== 'time_trial') return { kind: 'time', gold: ai.high, silver: ai.medium, bronze: ai.low, from: 'ai' };
  const laps = course?.loop ? Math.max(1, P.laps ?? 1) : 1;
  const ref = (P.targetSeconds && quest.type === 'time_trial' ? P.targetSeconds : null) ?? course?.referenceTime ?? course?.stats?.estimatedTime ?? null;
  if (!ref) return { kind: 'time', gold: null, silver: null, bronze: null };
  const r1 = x => Math.round(x * 10) / 10;
  return { kind: 'time', gold: r1(ref * laps * M.time.gold), silver: r1(ref * laps * M.time.silver), bronze: r1(ref * laps * M.time.bronze) };
}
export function medalOf(T, { time = null, score = null }) {
  for (const tier of ['gold', 'silver', 'bronze']) {
    if (T[tier] == null) continue;
    if (T.kind === 'score' ? score != null && score >= T[tier] : time != null && time <= T[tier]) return tier;
  }
  return null;
}
// which AI reference times a quest uses: its classes (e.g. 'CD'), else 'open'
export const classKey = quest => quest.entry?.classes?.length ? quest.entry.classes.slice().sort().join('') : 'open';
export const tierRank = t => t ? TIERS.indexOf(t) + 1 : 0;
// a race's medal is its place (data/quests.json race.medalByPlace)
export function medalOfPlace(place, config) {
  const M = config.race?.medalByPlace ?? { gold: 1, silver: 2, bronze: 3 };
  return ['gold', 'silver', 'bronze'].find(t => M[t] === place) ?? null;
}

// The anti-farming cut: a quest finished more than freeRuns times in the last windowHours pays
// decay^(the runs past that) of what it would (at least floor). recent: ISO times of its finishes.
export function farmingFactor(recent = [], now, economy) {
  const F = economy?.quests?.farming;
  if (!F || !now) return 1;
  const t = Date.parse(now), within = recent.filter(x => t - Date.parse(x) < F.windowHours * 3600e3).length;
  const over = within + 1 - F.freeRuns;
  return over > 0 ? Math.max(F.floor, F.decay ** over) : 1;
}

// What a finished run earns. Money: each tier pays its share of the quest's reward the first time it's
// reached (reaching a higher tier pays the difference to the best already paid); finishing without a
// medal pays the finish share once; a run reaching nothing new pays the repeat share. xp: every finish
// earns the share for what it reached — in full the first time, then × xp.repeat. A race's place below
// the medals scales both. A delivery's money loses its damage penalty. Pink slips pay no money. Run again
// and again within the farming window, both are cut (farmingFactor).
export function earnings({ quest, outcome, progress = {}, economy, config, now = null }) {
  const R = config.rewards, X = R.xp ?? R, base = rewardsOf(quest, economy), lines = [];
  const paid = progress.paidShare ?? 0, finishPaid = !!progress.finishPaid;
  let share = 0, tiers = [], repeat = false;
  if (outcome.status !== 'finished') return { money: 0, xp: 0, tiers, repeat, lines, base, farming: 1 };
  const reach = outcome.medal ? R[outcome.medal] : 0;
  if (reach > paid) {
    share = reach - paid;
    tiers = TIERS.slice(0, tierRank(outcome.medal)).filter(t => R[t] > paid);
    lines.push({ what: `${outcome.medal[0].toUpperCase()}${outcome.medal.slice(1)} medal${paid ? ' (more than before)' : ''}`, share });
  } else if (!outcome.medal && !finishPaid && paid === 0) {
    share = R.finish;
    lines.push({ what: 'Finished', share });
  } else {
    share = R.repeat; repeat = true;
    lines.push({ what: 'Again', share });
  }
  // xp: what this run reached, in full the first time it's reached
  let xpShare = outcome.medal ? X[outcome.medal] : X.finish;
  if (repeat) xpShare *= X.repeat ?? 0.35;
  // (a race: below the medals, what the place pays)
  if (outcome.place != null && (repeat || !outcome.medal)) {
    const ps = config.race?.placeShare?.[outcome.place - 1] ?? 0.2;
    share *= ps; xpShare *= ps;
    lines.push({ what: `${ordinal(outcome.place)} place`, share });
  }
  const farming = farmingFactor(progress.recent ?? [], now, economy);
  if (farming < 1) lines.push({ what: `Run again soon (×${Math.round(farming * 100) / 100})`, share: share * farming });
  let m = quest.type === 'pink_slip' ? 0 : base.money * share * farming, xp = base.xp * xpShare * farming;
  if (quest.type === 'delivery' && outcome.cargoLost > 0) {
    const cut = Math.min(1, (quest.params?.damagePenalty ?? 0.5) * outcome.cargoLost);
    lines.push({ what: `Cargo damage (${Math.round(outcome.cargoLost * 100)}% lost)`, money: -Math.round(m * cut) });
    m *= 1 - cut;
  }
  const round = economy.quests?.roundTo ?? 1;
  return { money: Math.max(0, Math.round(m / round) * round), xp: Math.round(xp), tiers, repeat, share, lines, base, farming };
}

// A player's level from their xp (data/quests.json levels): reaching level L takes base × ((L − 1) +
// growth × (L − 1)(L − 2) / 2) xp in all
export const xpForLevel = (L, config) => { const V = config.levels ?? {}, b = V.base ?? V.xpPerLevel ?? 1000, g = V.base ? V.growth ?? 0 : 0, n = L - 1; return Math.round(b * (n + g * n * (n - 1) / 2)); };
export function levelOf(xp, config) {
  const max = config.levels?.max ?? 100;
  let L = 1;
  while (L < max && (xp ?? 0) >= xpForLevel(L + 1, config)) L++;
  return L;
}
// → { level, xp, from (this level's xp), to (the next's), share (0–1 of the way there) }
export function levelProgress(xp, config) {
  const level = levelOf(xp, config), from = xpForLevel(level, config), to = xpForLevel(level + 1, config);
  return { level, xp: xp ?? 0, from, to, share: to > from ? Math.min(1, ((xp ?? 0) - from) / (to - from)) : 1 };
}
const hp = kw => Math.round(kw * 1.341);

// Why a player can't enter, in plain words (none: they can). car: { name, className, kw, kg, drivable:
// { ok, reasons } }; player: { money, xp }
export function entryReasons({ quest, car, player, fee = null, config, economy = null }) {
  const out = [], E = quest.entry ?? {}, terms = economy ? rewardsOf(quest, economy) : null;
  fee ??= terms?.fee ?? 0;
  if (!car) { out.push({ code: 'car', text: 'You need a car.' }); return out; }
  // (a pink slip stakes the car: never the starter car)
  if (quest.type === 'pink_slip' && car.carId && car.carId === (economy?.startingCar ?? 'starter_car')) out.push({ code: 'stake', text: 'You can\'t race your starter car for pink slips: pick another car.' });
  // (and the stakes follow the tier: a car of at most its class)
  else if (quest.type === 'pink_slip' && terms?.stakeMaxClass && car.className) {
    const order = Object.keys(economy.quests.byClass);
    if (order.indexOf(car.className) > order.indexOf(terms.stakeMaxClass)) out.push({ code: 'stake', text: `A ${terms.tierName} pink slip stakes cars up to class ${terms.stakeMaxClass}: yours is class ${car.className}.` });
  }
  if (E.classes?.length && !E.classes.includes(car.className)) out.push({ code: 'class', text: `Needs a class ${E.classes.join(' or ')} car (yours is class ${car.className ?? '?'}).` });
  if (E.maxPowerKw && car.kw > E.maxPowerKw) out.push({ code: 'power', text: `Needs a car under ${hp(E.maxPowerKw)} hp (yours has ${hp(car.kw)} hp).` });
  if (E.minWeightKg && car.kg < E.minWeightKg) out.push({ code: 'weight', text: `Needs a car of at least ${E.minWeightKg} kg (yours is ${Math.round(car.kg)} kg).` });
  if (E.maxWeightKg && car.kg > E.maxWeightKg) out.push({ code: 'weight', text: `Needs a car of at most ${E.maxWeightKg} kg (yours is ${Math.round(car.kg)} kg).` });
  if (E.maxKwPerTonne && car.kw / (car.kg / 1000) > E.maxKwPerTonne) out.push({ code: 'ratio', text: `Needs at most ${hp(E.maxKwPerTonne)} hp per tonne (yours has ${hp(car.kw / (car.kg / 1000))}).` });
  if (car.drivable && !car.drivable.ok) out.push({ code: 'damage', text: `Car too damaged: repair first (${(car.drivable.reasons ?? []).slice(0, 2).join('; ') || 'it can\'t be driven'}).` });
  const level = levelOf(player?.xp, config);
  // (its tier opens at a level; the author can ask for more)
  const need = Math.max(E.minLevel ?? 1, terms?.unlockLevel ?? 1);
  if (player && need > 1 && level < need) out.push({ code: 'level', text: need > (E.minLevel ?? 1) ? `${terms.tierName} quests open at level ${need} (you're level ${level}).` : `Needs level ${need} (you're level ${level}).` });
  if (fee > 0 && player && !player.unlimited && player.money < fee) out.push({ code: 'money', text: `Entry fee ${money(fee, economy?.currency)}: you have ${money(player.money, economy?.currency)}.` });
  return out;
}
export const CAR_CODES = new Set(['class', 'power', 'weight', 'ratio', 'damage', 'stake']);
// the player's cars that would get in (the car rules only: damage counts, money and level don't)
export function carsThatQualify(quest, cars, config) {
  return cars.filter(car => !entryReasons({ quest, car, player: null, fee: 0, config }).some(r => CAR_CODES.has(r.code)));
}
export const typeLabel = t => TYPES[t]?.label ?? t;
