// World content saved by an older version, brought up to this one (content/quests.js CONTENT_VERSION),
// one version at a time. Every import and every load goes through migrate(): what can't be read says why.
//
// Version 1 (the first draft of the format): a flat place (lat, lon, alt, heading), a "title", the quest
// type as "questType", and its reward as money ("reward": a number, set by hand). Version 2 keeps the
// place in "location", calls it "name", and names one of the economy's reward tiers instead of money, so
// rewards follow the economy's rules (data/economy.json quests). Version 3 adds routes (kind 'route', with
// their course) and laps on more quest types; a version 2 item is a version 3 one as it is.

import { CONTENT_VERSION, TYPES, newItem } from './quests.js';

// v1's money → the nearest of v2's tiers, by the economy's rules at the time (base 800: easy 480,
// standard 800, hard 1280, extreme 2000)
const TIER_BY_MONEY = [[480, 'easy'], [800, 'standard'], [1280, 'hard'], [2000, 'extreme']];
const nearestTier = m => TIER_BY_MONEY.reduce((a, b) => Math.abs(b[0] - m) < Math.abs(a[0] - m) ? b : a)[1];

const STEPS = {
  1: v1 => {
    const kind = v1.kind ?? (v1.questType ? 'quest' : 'poi');
    const type = TYPES[v1.questType] ? v1.questType : 'sprint';
    const base = newItem(kind, { id: v1.id, location: { lat: v1.lat, lon: v1.lon, alt: v1.alt ?? 0, heading: ((v1.heading ?? 0) % 360 + 360) % 360 }, author: v1.author ?? 'unknown', now: v1.created ?? v1.updated ?? new Date(0).toISOString(), type });
    const out = { ...base, name: v1.title ?? base.name, description: v1.description ?? '', status: v1.status ?? 'draft', updated: v1.updated ?? base.updated, publishedAt: v1.publishedAt ?? null };
    if (kind === 'quest') {
      out.fee = v1.fee ?? 0;
      out.rewards = { tier: nearestTier(v1.reward ?? 800) };
      if (v1.requirements?.class) out.entry = { ...out.entry, classes: [].concat(v1.requirements.class) };
      if (v1.finish) out.params = { ...out.params, finish: { lat: v1.finish.lat, lon: v1.finish.lon, alt: v1.finish.alt ?? 0, heading: 0 } };
    }
    return { ...out, version: 2 };
  },
  2: v2 => ({ ...v2, version: 3 }),
};

// → { item, from, notes } or { error }
export function migrate(item) {
  if (!item || typeof item !== 'object') return { error: 'not an item' };
  const from = item.version ?? 1;
  if (!Number.isInteger(from) || from < 1) return { error: `version "${item.version}" isn't one this game knows` };
  if (from > CONTENT_VERSION) return { error: `made by a newer version of the game (content version ${from}; this one reads up to ${CONTENT_VERSION})` };
  let x = item;
  try { for (let v = from; v < CONTENT_VERSION; v++) x = STEPS[v](x); }
  catch (e) { return { error: `couldn't bring it up from version ${from}: ${e.message}` }; }
  return { item: x, from, migrated: from !== CONTENT_VERSION };
}
