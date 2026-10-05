// Bulk validation (Phase 4 Step 5): every quest, route and series checked again — after a map rebake or a
// change to the game's rules — and everything that needs looking at listed, with the reasons in plain
// words. Pure: the editor's "Check everything" and tools/validate-content.mjs (on an export) run it.
//
//   validateAll(entries, { check, rate, networks }) → [{ id, kind, name, view, reasons: [{ level, text }] }]
//     entries: an export's entries ([{ draft, published, archived }]); check: content/schema.js's checker;
//     rate: content/rating.js makeRater(…); networks: { region: road network } (routes in other regions
//     can't be checked against their roads, and say so)

import { blocking, CONTENT_VERSION } from './quests.js';
import { reviewRoute, routeVersionOf } from '../route/model.js';
import { migrate } from './migrations.js';

const live = e => e.archived ? null : e.draft ?? e.published;

export function validateAll(entries, { check, rate = null, networks = {} } = {}) {
  // (the items as they are now, by id: what a quest's route and a series' quests are looked up in)
  const items = new Map(), out = [];
  for (const e of entries) { const it = live(e); if (it) items.set(it.id, { e, it: migrate(it).item ?? it }); }
  for (const { e, it } of items.values()) {
    const reasons = [], add = (level, text) => reasons.push({ level, text });
    if ((e.draft ?? e.published)?.version < CONTENT_VERSION) add('info', `Saved by an older version of the game (content version ${(e.draft ?? e.published).version}): it's brought up to date as it loads.`);
    const route = it.kind === 'quest' && it.route ? items.get(it.route)?.it ?? null : undefined;
    const errors = blocking(check(it, it.kind === 'quest' && it.route ? { route } : {}));
    if (errors.length) add('error', `${errors.length} problem${errors.length > 1 ? 's' : ''} stop${errors.length > 1 ? '' : 's'} it being published: ${errors[0].message}${errors.length > 1 ? ` (and ${errors.length - 1} more)` : ''}`);
    if (it.kind === 'route') {
      const N = networks[it.course?.region];
      if (!N) add('info', `Its region (${it.course?.region ?? 'none'}) isn't loaded here: its roads weren't checked.`);
      else {
        const r = reviewRoute(N, it.course);
        if (r?.review?.needed) add('error', `The roads under it changed when the map was baked again (${r.review.missing.length} gone, ${r.review.altered.length} altered): check its line and save it again.`);
      }
      for (const p of (it.course?.problems ?? []).filter(p => p.level === 'error')) add('error', `Its course: ${p.message}`);
    }
    if (it.kind === 'quest') {
      if (it.route && route === null) add('error', `Its route "${it.route}" is gone.`);
      if (route && rate) {
        const now = rate(it, { route }).rating, was = it.rating;
        if (!was && now) add('warning', `Not rated yet: it would be ${now.stars}★ (save it again to rate it).`);
        else if (was && now && (was.stars !== now.stars || Math.abs((was.km ?? 0) - now.km) > 0.05 || was.recommended !== now.recommended)) add('warning', `Its rating is out of date (${was.stars}★ ${was.km} km → ${now.stars}★ ${now.km} km): save it again — its reward follows.`);
        const pub = e.published?.rating?.routeVersion, v = route.course ? routeVersionOf(route.course) : null;
        if (e.published && pub && v && pub !== v) add('warning', 'Its route has changed since it was published: publish again (players\' best times on the old route are kept, marked as from an older version).');
      }
      if (e.published && e.draft && e.draft.updated !== e.published.updated) add('info', 'It has changes not yet published.');
    }
    if (it.kind === 'series') {
      for (const id of it.quests ?? []) {
        const q = items.get(id)?.it;
        if (!q) add('error', `Its quest "${id}" is gone.`);
        else if (!items.get(id).e.published && e.published) add('warning', `Its quest "${q.name}" isn't published: players can't finish the series.`);
      }
    }
    if (reasons.length) out.push({ id: it.id, kind: it.kind, name: it.name, view: e.published ? 'published' : 'draft', reasons });
  }
  const rank = r => r.reasons.some(x => x.level === 'error') ? 0 : r.reasons.some(x => x.level === 'warning') ? 1 : 2;
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
