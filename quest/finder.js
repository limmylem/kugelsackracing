// Finding quests, pure (the map's filters, the free-roam notice, "Recommended for you", where fast travel
// goes): data/quests.json finding. The game hands in the quests (published items), the player's profile,
// their car ({ className, rating, kw, kg }) and where they are; nothing here touches the page.
//
//   FILTERS: the filter fields and their choices      defaultFilters()
//   filterQuests(quests, filters, ctx) → [{ item, km, terms, state }]  (nearest first)
//   suitsCar(item, car, ctx) → bool
//   recommend(quests, ctx) → [{ item, km, score, why }]     (best first, at most finding.recommended.count)
//   createNotifier(ctx) → { check(quests, pos, now, busy) → item | null, seen: Set }
//   regionOf(location, regions) → region | null      (data/map/baked.json regions)
//     ctx: { profile, car, economy, config, at: { lat, lon } }

import { rewardsOf } from '../content/quests.js';
import { levelOf, entryReasons, CAR_CODES } from './rules.js';
import { distanceKm } from '../content/geo.js';

export const FILTERS = {
  type: ['any', 'sprint', 'time_trial', 'checkpoint', 'drift', 'delivery', 'pink_slip'],
  stars: ['any', '1', '2', '3', '4', '5'],
  distance: ['any', '1', '5', '25'],
  status: ['any', 'new', 'not completed', 'completed'],
  medal: ['any', 'none', 'bronze', 'silver', 'gold', 'not gold'],
  car: ['any', 'suits my car'],
};
export const defaultFilters = () => Object.fromEntries(Object.keys(FILTERS).map(k => [k, 'any']));

const progressOf = (profile, id) => profile?.quests?.[id] ?? null;
// a quest's terms (content/quests.js rewardsOf), worked out once for each item as loaded: the finder runs over
// every quest in every region (tens of thousands) each time a filter changes
const termsMemo = new WeakMap();
export function termsOf(item, economy) {
  let m = termsMemo.get(item);
  if (!m || m.economy !== economy) termsMemo.set(item, m = { economy, terms: rewardsOf(item, economy) });
  return m.terms;
}
export function stateOf(profile, id) {
  const q = progressOf(profile, id);
  return !q?.attempts ? 'new' : q.completed ? 'completed' : 'attempted';
}

// a car suits a quest: the quest lets it in, and it's not far below what the quest asks for
export function suitsCar(item, car, { config, economy }) {
  if (!car) return false;
  if (entryReasons({ quest: item, car, player: null, fee: 0, config, economy }).some(r => CAR_CODES.has(r.code))) return false;
  const rec = item.rating?.recommended;
  return rec == null || car.rating == null || car.rating >= rec * (config.difficulty?.recommended?.warnBelow ?? 0.85);
}

export function filterQuests(quests, filters, ctx) {
  const F = { ...defaultFilters(), ...filters }, out = [];
  for (const item of quests) {
    if (item.kind !== 'quest') continue;
    const terms = termsOf(item, ctx.economy), km = ctx.at ? distanceKm(ctx.at, item.location) : null, state = stateOf(ctx.profile, item.id), medal = progressOf(ctx.profile, item.id)?.medal ?? null;
    if (F.type !== 'any' && item.type !== F.type) continue;
    if (F.stars !== 'any' && terms.stars !== +F.stars) continue;
    if (F.distance !== 'any' && km != null && km > +F.distance) continue;
    if (F.status === 'new' && state !== 'new') continue;
    if (F.status === 'not completed' && state === 'completed') continue;
    if (F.status === 'completed' && state !== 'completed') continue;
    if (F.medal === 'none' && medal) continue;
    if (['bronze', 'silver', 'gold'].includes(F.medal) && medal !== F.medal) continue;
    if (F.medal === 'not gold' && medal === 'gold') continue;
    if (F.car === 'suits my car' && !suitsCar(item, ctx.car, ctx)) continue;
    out.push({ item, km, terms, state, medal });
  }
  // (nearest first: sorted by a typed array of the distances — tens of thousands of quests, every filter change)
  const d = Float64Array.from(out, x => x.km ?? 0), idx = Uint32Array.from(out, (_, k) => k).sort((a, b) => d[a] - d[b]);
  return Array.from(idx, k => out[k]);
}

// "Recommended for you": quests the player can enter now (tier open, a car of theirs that suits it),
// their stars about what their level suits, not yet done, near
export function recommend(quests, ctx) {
  const R = ctx.config.finding?.recommended ?? { count: 8, km: 25, levelForStars: [1, 3, 6, 10, 15] };
  const level = levelOf(ctx.profile?.xp ?? 0, ctx.config), money = ctx.profile?.money ?? 0;
  // (the stars that suit this level: the highest whose level it's reached)
  const suits = Math.max(1, R.levelForStars.filter(l => level >= l).length);
  const out = [];
  for (const item of quests) {
    if (item.kind !== 'quest' || item.enabled === false || progressOf(ctx.profile, item.id)?.medal === 'gold') continue;
    const terms = termsOf(item, ctx.economy);
    if ((terms.unlockLevel ?? 1) > level || (item.entry?.minLevel ?? 1) > level || terms.fee > money) continue;
    if (!suitsCar(item, ctx.car, ctx)) continue;
    const km = ctx.at ? distanceKm(ctx.at, item.location) : 0, state = stateOf(ctx.profile, item.id), medal = progressOf(ctx.profile, item.id)?.medal;
    if (medal === 'gold') continue;
    const why = [];
    let score = 10 - 2 * Math.abs((terms.stars ?? 2) - suits);
    if (state === 'new') { score += 3; why.push('new'); } else if (state === 'attempted') { score += 2; why.push('not finished yet'); } else why.push(`a better medal than ${medal ?? 'none'}`);
    if (Math.abs((terms.stars ?? 2) - suits) === 0) why.push('right for your level');
    score -= Math.min(5, km / Math.max(1, R.km) * 5);
    out.push({ item, km, score: Math.round(score * 100) / 100, why, terms });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, R.count);
}

// The free-roam notice: a quest not yet played, close by, now and then (never twice for one quest in a
// session, at most one every everySeconds, never during a quest)
export function createNotifier(ctx) {
  const N = ctx.config.finding?.notice ?? { radiusM: 250, everySeconds: 45 }, seen = new Set();
  let last = -Infinity;
  return {
    seen,
    check(quests, at, now, busy = false) {
      if (busy || now - last < N.everySeconds) return null;
      let best = null, bd = Infinity;
      // (a quick look first: anything further north, south, east or west than the radius isn't near)
      const dLat = N.radiusM / 111000, dLon = dLat / Math.max(0.01, Math.cos(at.lat * Math.PI / 180));
      for (const item of quests) {
        const L = item.location;
        if (Math.abs(L.lat - at.lat) > dLat || Math.abs(L.lon - at.lon) > dLon) continue;
        if (item.kind !== 'quest' || seen.has(item.id) || stateOf(ctx.profile, item.id) !== 'new') continue;
        const d = distanceKm(at, item.location) * 1000;
        if (d < N.radiusM && d < bd) { bd = d; best = item; }
      }
      if (!best) return null;
      seen.add(best.id); last = now;
      return { item: best, metres: Math.round(bd) };
    },
  };
}

// which baked region a place is in (data/map/baked.json)
export function regionOf(loc, regions) {
  return regions.find(r => loc.lon >= r.bbox[0] && loc.lon <= r.bbox[2] && loc.lat >= r.bbox[1] && loc.lat <= r.bbox[3]) ?? null;
}
