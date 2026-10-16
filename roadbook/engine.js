// The ROADBOOK's rules (docs/ROADBOOK.md): a season's challenges and chapters, its places and Expeditions, worked out
// from what the game reports — the same code on the server (which decides: server/src/roadbook/service.ts) and in a
// game with no server (roadbook/local.js). Nothing here stores anything or pays anything: it says what changed and what
// is owed (awards), and whoever runs it records them, each once, by its key.
//
//   const P = newProgress(season)
//   const { awards, events } = applyEvent(bundle, season, P, { type: 'race_finished', data: { win: true, … } })
//   const { awards, events, metres, carMetres } = applyPing(bundle, season, P, history, ping, serverNow)
//
// An event: { type, data } — race_finished { questType, medal, place, win, mp }, part_installed { partId },
// car_purchased { carId, used }, car_sold { carId }, photo_saved {}, distance_driven { metres, carId },
// place_discovered { place, hidden }, expedition_stage { expedition, stage }, expedition_completed { expedition }.
// An award: { key (unique in the season), kind, points, tokens, reason, ref }.

import { createTrack, metresBetween, trackSamples, LIMITS } from './geo.js';
import { newExpedition, expeditionStep } from './expedition.js';

export const EVENTS = ['race_finished', 'part_installed', 'car_purchased', 'car_sold', 'photo_saved', 'distance_driven', 'place_discovered', 'expedition_stage', 'expedition_completed'];

export function newProgress(season) {
  return { season: season.id, points: 0, challenges: {}, milestones: {}, discovered: {}, expeditions: {}, track: createTrack(), awarded: {} };
}

// what an event must say for a goal: each key a value, or a list of values (any of them)
export function matches(where, data) {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    const x = data?.[k];
    if (Array.isArray(v) ? !v.includes(x) : x !== v) return false;
  }
  return true;
}

// how far a challenge has got: { have, need } (have ≤ need)
export function challengeProgress(ch, state) {
  const g = ch.goal, s = state ?? {};
  if (g.sum) return { have: Math.min(g.target, s.sum ?? 0), need: g.target };
  if (g.unique) return { have: Math.min(g.count, (s.seen ?? []).length), need: g.count };
  if (g.streak) return { have: Math.min(g.streak, Math.max(s.best ?? 0, s.streak ?? 0)), need: g.streak };
  return { have: Math.min(g.count ?? 1, s.n ?? 0), need: g.count ?? 1 };
}
const met = (ch, state) => { const p = challengeProgress(ch, state); return p.have >= p.need; };

export const chapterOpen = (season, P, chapterId) => { const c = season.chapters.find(x => x.id === chapterId); return !!c && P.points >= (c.unlockAt ?? 0); };
export const openChapters = (season, P) => season.chapters.filter(c => P.points >= (c.unlockAt ?? 0)).map(c => c.id);

// an award, once by its key: its points counted in the progress at once (the chapters it opens)
function award(P, out, a) {
  if (P.awarded[a.key]) return;
  P.awarded[a.key] = true;
  P.points += a.points ?? 0;
  out.push({ points: 0, tokens: 0, ...a });
}

// challenges done (in chapters now open) and chapters whose challenges are all done, until nothing more changes
export function settle(season, P) {
  const out = [];
  for (let again = true; again;) {
    again = false;
    for (const ch of season.challenges) {
      const s = P.challenges[ch.id] ??= {};
      if (s.done || !met(ch, s) || !chapterOpen(season, P, ch.chapter)) continue;
      s.done = true;
      award(P, out, { key: `ch:${ch.id}`, kind: 'challenge', points: ch.points ?? 0, tokens: ch.tokens ?? 0, reason: `Challenge: ${ch.name}`, ref: { challenge: ch.id, chapter: ch.chapter } });
      again = true;
    }
    for (const c of season.chapters) {
      const mine = season.challenges.filter(x => x.chapter === c.id);
      if (P.milestones[c.id] || !mine.length || !mine.every(x => P.challenges[x.id]?.done)) continue;
      P.milestones[c.id] = true;
      award(P, out, { key: `ms:${c.id}`, kind: 'milestone', points: 0, tokens: c.milestoneTokens ?? 0, reason: `Chapter finished: ${c.name}`, ref: { chapter: c.id } });
      again = true;
    }
  }
  return out;
}

// an event: every challenge listening to it moves on (all season, whether or not its chapter is open yet)
export function applyEvent(bundle, season, P, ev) {
  if (!EVENTS.includes(ev?.type)) return { awards: [], events: [] };
  const data = ev.data ?? {};
  for (const ch of season.challenges) {
    const g = ch.goal;
    if (g.event !== ev.type) continue;
    const s = P.challenges[ch.id] ??= {};
    if (s.done) continue;
    if (g.streak) {
      // (in a row: any event of this type that doesn't match starts it again — one that doesn't say, e.g. a time trial with
      // no one to beat (win: null), neither counts nor breaks it)
      if (Object.keys(g.where ?? {}).some(k => data[k] == null)) continue;
      if (matches(g.where, data)) { s.streak = (s.streak ?? 0) + 1; s.best = Math.max(s.best ?? 0, s.streak); } else s.streak = 0;
      continue;
    }
    if (!matches(g.where, data)) continue;
    if (g.sum) s.sum = (s.sum ?? 0) + Math.max(0, Number(data[g.sum]) || 0);
    else if (g.unique) { const v = data[g.unique]; if (v != null && !(s.seen ??= []).includes(v)) s.seen.push(v); }
    else s.n = (s.n ?? 0) + 1;
  }
  return { awards: settle(season, P), events: [] };
}

// A ping: the positions driven since the last one (roadbook/geo.js). What it finds: metres driven (each challenge
// counting distance, the history), places reached (each discovered once for good — history.places — and once in the
// season), the Expedition stages it completes. history: { places: { id: firstAt } } (read; what's new is in events).
// ping: { samples: [[lat, lon, clientMs], …], carId }. Expeditions in progress: P.expeditions[id] (started by
// startExpedition).
export function applyPing(bundle, season, P, history, ping, serverNow, limits = LIMITS) {
  const { track, points, metres } = trackSamples(P.track ?? createTrack(), ping?.samples, serverNow, limits);
  P.track = track;
  const awards = [], events = [];
  const take = r => { awards.push(...r.awards); events.push(...r.events); };
  if (metres > 0) take(applyEvent(bundle, season, P, { type: 'distance_driven', data: { metres, carId: ping?.carId ?? null } }));
  const known = history?.places ?? {};
  for (const pt of points) {
    if (!pt.trusted) continue;
    // places: within a place's radius
    for (const pl of bundle.places ?? []) {
      if (metresBetween(pt, pl) > (pl.radius ?? 60)) continue;
      if (!P.discovered[pl.id]) {
        P.discovered[pl.id] = pt.at;
        const ev = { type: 'place_discovered', data: { place: pl.id, hidden: !!pl.hidden, firstEver: !known[pl.id] } };
        events.push(ev);
        take(applyEvent(bundle, season, P, ev));
        // (a hidden place: a rare find, its tokens once a season)
        if (pl.hidden && season.discoveries?.hiddenTokens) award(P, awards, { key: `pl:${pl.id}`, kind: 'discovery', points: 0, tokens: season.discoveries.hiddenTokens, reason: `Found a hidden place: ${pl.name}`, ref: { place: pl.id } });
      }
    }
    // the Expeditions under way: this point against the stage each is on
    for (const [id, st] of Object.entries(P.expeditions)) {
      const exp = bundle.expeditions?.[id];
      if (!exp || st.done) continue;
      const r = expeditionStep(exp, st, pt);
      P.expeditions[id] = r.state;
      for (const s of r.completed) {
        const stage = exp.stages.find(x => x.id === s.stage);
        award(P, awards, { key: `xs:${id}:${s.stage}`, kind: 'expedition', points: stage?.points ?? 0, tokens: stage?.tokens ?? 0, reason: `${exp.name}: ${stage?.name ?? s.stage}`, ref: { expedition: id, stage: s.stage, timeMs: s.timeMs ?? null } });
        const ev = { type: 'expedition_stage', data: { expedition: id, stage: s.stage } };
        events.push(ev);
        take(applyEvent(bundle, season, P, ev));
      }
      if (r.state.done && !st.done) {
        const ev = { type: 'expedition_completed', data: { expedition: id } };
        events.push(ev);
        take(applyEvent(bundle, season, P, ev));
      }
      events.push(...r.notices.map(n => ({ type: 'notice', data: { expedition: id, ...n } })));
    }
  }
  awards.push(...settle(season, P));
  return { awards, events, metres, points };
}

export function startExpedition(bundle, season, P, id, serverNow) {
  const exp = bundle.expeditions?.[id];
  if (!exp || !(season.expeditions ?? []).includes(id)) return { ok: false, error: 'There\'s no such Expedition this season.' };
  if (P.expeditions[id]) return { ok: true, state: P.expeditions[id], already: true };
  P.expeditions[id] = newExpedition(exp, serverNow);
  return { ok: true, state: P.expeditions[id] };
}

// A season's bundle: { current, seasons: { id: { season, shop, expeditions: { id: exp } } }, places } as the files (or
// the admin page's version) have it. What the rules use for one season: its season, shop, its Expeditions and the places.
export function seasonView(all, id = all.current) {
  const s = all.seasons?.[id];
  if (!s) return null;
  return { season: s.season, shop: s.shop, bundle: { places: all.places ?? [], expeditions: s.expeditions ?? {} } };
}

// What's wrong with a bundle (the admin page checks every change with this before it goes live): plain sentences
export function bundleProblems(all) {
  const out = [], ids = new Set();
  if (!all || typeof all !== 'object') return ['It isn\'t an object.'];
  if (!all.seasons?.[all.current]) out.push(`The current season "${all.current}" isn't in the seasons.`);
  const places = new Set();
  for (const p of all.places ?? []) {
    if (!p.id || places.has(p.id)) out.push(`A place needs an id of its own (${p.id ?? 'none'}).`);
    places.add(p.id);
    if (!(Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180)) out.push(`Place ${p.id}: its latitude and longitude aren't right.`);
  }
  for (const [sid, s] of Object.entries(all.seasons ?? {})) {
    const S = s.season;
    if (!S || S.id !== sid) { out.push(`Season ${sid}: its season.json needs id "${sid}".`); continue; }
    if (!(S.lengthDays > 0)) out.push(`${S.name}: lengthDays must be more than 0.`);
    if (!(S.conversion?.cashPerToken >= 0)) out.push(`${S.name}: the conversion (cashPerToken) must be 0 or more.`);
    if (!(S.start === 'beta_open' || !Number.isNaN(Date.parse(S.start)))) out.push(`${S.name}: start is "beta_open" or a date.`);
    const chapters = new Set();
    for (const c of S.chapters ?? []) {
      if (!c.id || chapters.has(c.id)) out.push(`${S.name}: a chapter needs an id of its own (${c.id ?? 'none'}).`);
      chapters.add(c.id);
      if (!(c.unlockAt >= 0)) out.push(`${S.name}, ${c.name}: unlockAt must be 0 or more.`);
    }
    if (!(S.chapters ?? []).some(c => (c.unlockAt ?? 0) === 0)) out.push(`${S.name}: one chapter must open at 0 points.`);
    for (const ch of S.challenges ?? []) {
      if (!ch.id || ids.has(ch.id)) out.push(`${S.name}: challenge ids must be different (${ch.id ?? 'none'}).`);
      ids.add(ch.id);
      if (!chapters.has(ch.chapter)) out.push(`${S.name}, ${ch.name}: its chapter "${ch.chapter}" isn't there.`);
      const g = ch.goal ?? {};
      if (!EVENTS.includes(g.event)) out.push(`${S.name}, ${ch.name}: there's no event "${g.event}" (${EVENTS.join(', ')}).`);
      if (g.sum && !(g.target > 0)) out.push(`${S.name}, ${ch.name}: a sum needs a target above 0.`);
      if (!g.sum && !g.streak && !((g.count ?? 1) > 0)) out.push(`${S.name}, ${ch.name}: count must be above 0.`);
      if (!(ch.points >= 0 && ch.tokens >= 0)) out.push(`${S.name}, ${ch.name}: points and tokens are 0 or more.`);
    }
    // (enough points to open every chapter)
    const total = (S.challenges ?? []).reduce((a, c) => a + (c.points ?? 0), 0) + (S.expeditions ?? []).reduce((a, x) => a + (s.expeditions?.[x]?.stages ?? []).reduce((b, st) => b + (st.points ?? 0), 0), 0);
    for (const c of S.chapters ?? []) if (c.unlockAt > total) out.push(`${S.name}, ${c.name}: it opens at ${c.unlockAt} points, but the season only has ${total}.`);
    for (const x of S.expeditions ?? []) if (!s.expeditions?.[x]) out.push(`${S.name}: the Expedition "${x}" isn't there.`);
    for (const [xid, x] of Object.entries(s.expeditions ?? {})) {
      if (x.id !== xid) out.push(`Expedition ${xid}: its id must be "${xid}".`);
      if (!(x.stages?.length)) out.push(`${x.name ?? xid}: it needs stages.`);
      const sids = new Set();
      for (const st of x.stages ?? []) {
        if (!st.id || sids.has(st.id)) out.push(`${x.name}: stage ids must be different (${st.id ?? 'none'}).`);
        sids.add(st.id);
        const pts = st.type === 'collect' ? st.items : st.type === 'checkpoints' ? st.checkpoints : [st.location];
        if (!['reach', 'clue', 'collect', 'checkpoints'].includes(st.type)) out.push(`${x.name}, ${st.name}: there's no stage type "${st.type}".`);
        else if (!pts?.length || pts.some(p => !(Math.abs(p?.lat) <= 90 && Math.abs(p?.lon) <= 180))) out.push(`${x.name}, ${st.name}: its places need a latitude and longitude.`);
        if (st.type === 'checkpoints' && !(st.timeLimitSec > 0)) out.push(`${x.name}, ${st.name}: a checkpoint run needs timeLimitSec.`);
      }
    }
    const items = new Set();
    for (const it of s.shop?.items ?? []) {
      if (!it.id || items.has(it.id)) out.push(`${S.name} shop: item ids must be different (${it.id ?? 'none'}).`);
      items.add(it.id);
      if (!(Number.isInteger(it.price) && it.price > 0)) out.push(`${S.name} shop, ${it.name}: its price is a whole number above 0.`);
    }
  }
  return out;
}

// What a player owns unlocks (each item's grants, all of them together): { finishes: Set, photoFilters: Set, badges: Set }
export function unlocksOf(all, itemIds) {
  const out = { finishes: new Set(), photoFilters: new Set(), badges: new Set() };
  const byId = new Map();
  for (const s of Object.values(all.seasons ?? {})) for (const it of s.shop?.items ?? []) byId.set(it.id, it);
  for (const id of itemIds ?? []) for (const [k, v] of Object.entries(byId.get(id)?.grants ?? {})) for (const x of v ?? []) (out[k] ??= new Set()).add(x);
  return out;
}
