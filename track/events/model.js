// Track events (Phase 5 Step 3): quests run on a generated track instead of a route — a circuit race, a
// hot lap, a hillclimb or sprint, an endurance race (the framework), a drift. Each is a quest item (content
// kind 'quest') with a `track` in place of its route: { code, kind, name, hash, layout, gridSlots, km,
// corners, theme, check } — so the quest session, its timing, HUD, results, NPC racers, PlayerService and
// the economy run it as any quest. An official event is content (made in the editor, at a race venue);
// the day's, the week's and a quick race's are made here, the same for every player.
//
// Kinds of track: official (picked and named in the editor: its code never changes), daily and weekly
// (from the date, data/trackEvents.json daily / weekly: every player the same track), quick (a random
// track from a preset), shared (a code a friend gave).
//
//   trackName(seed, { theme, layout }) → a name for a generated track, the same for the same seed
//   dayKey(date) → '2026-10-05' (UTC)     weekKey(date) → '2026-W41' (ISO week, UTC)
//   dailyTrack(date, cfg, tracksCfg) / weeklyTrack(...) → { kind, key, seed, params, version, code, name, gen }
//   quickTrack(presetId, seed, tracksCfg) → the same shape        sharedTrack(code) → the same shape
//   trackInfo(gen | data) → { code, layout, km, corners, theme, gridSlots, version }
//   eventsFor(track, cfg, { location, venue }) → [quest items]   (track: what the functions above return)
//   newTrackEvent({ id, track, type, … }) → a quest item          eventId(kind, code, slot)
//   recordKey(code, version, carClass) → the records' key (best times per code, generator version, class)

import { generateTrack, LATEST } from '../generate.js';
import { normalise } from '../code.js';
import { fnv32, mix, rng } from '../det.js';
import { dressTrack } from '../dress.js';
import { qualityOf, layoutSignature, similarity } from '../quality.js';
import { TYPES, CONTENT_VERSION } from '../../content/quests.js';

// (names: track/names.js — the track's, by its theme; its notable corners')
export { trackName } from '../names.js';
import { trackName } from '../names.js';

// ---------- the date's tracks ----------
const pad = n => String(n).padStart(2, '0');
export function dayKey(date) { const d = new Date(date); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
export function weekKey(date) {
  const d = new Date(date), t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), day = (new Date(t).getUTCDay() + 6) % 7;   // (Monday 0)
  const thursday = new Date(t - day * 864e5 + 3 * 864e5), y = thursday.getUTCFullYear(), first = Date.UTC(y, 0, 4), fday = (new Date(first).getUTCDay() + 6) % 7;
  const week = 1 + Math.round((thursday.getTime() - (first - fday * 864e5 + 3 * 864e5)) / (7 * 864e5));
  return `${y}-W${pad(week)}`;
}
// The rules for a date's track (data/trackEvents.json daily / weekly `rules`, by the date they start from:
// a rule never changes the tracks of the days before it): the generator version, and whether its tracks
// must reach the quality score (track/quality.js gate ≥ data/tracks.json quality.min) and differ from the
// recent days' (layoutSignature similarity under `similar`)
function rulesFor(C, key) {
  const day = key.includes('W') ? weekStart(key) : key;
  const list = (C.rules ?? [{ from: '0000', version: C.version, quality: false }]).filter(x => x.from <= day);
  return list.at(-1) ?? { version: C.version, quality: false };
}
function weekStart(key) {
  const [y, w] = key.split('-W').map(Number), jan4 = Date.UTC(y, 0, 4), d = (new Date(jan4).getUTCDay() + 6) % 7;
  return dayKey(jan4 - d * 864e5 + (w - 1) * 7 * 864e5);
}
// a candidate made and scored (the gate: the deterministic parts — the same everywhere)
function scored(gen, tracksCfg) {
  const plan = dressTrack(gen, tracksCfg);
  return qualityOf(gen, plan, tracksCfg);
}
const memo = new Map();
// The track for a key: the first seed derived from it that makes a track — and, by the rules, reaches the
// quality gate and isn't too like the last few days' (their first good seeds: no chain back for ever)
function fromKey(kind, key, C, tracksCfg, { similar = true } = {}) {
  const id = `${kind}:${key}:${similar}`;
  if (memo.has(id)) return memo.get(id);
  const R = rulesFor(C, key), base = fnv32(`${C.salt}:${kind}:${key}`), P = tracksCfg.presets, min = tracksCfg.quality?.min?.[kind] ?? 0;
  const preset = P.find(p => p.id === C.presets[mix(base, 0x5e1) % C.presets.length]) ?? P[0];
  const recent = R.quality && similar && R.similar ? previousKeys(kind, key, R.similar.recent).map(k => { try { return layoutSignature(fromKey(kind, k, C, tracksCfg, { similar: false }).gen); } catch { return null; } }).filter(Boolean) : [];
  const skipped = [];
  for (let k = 0; k < (R.quality ? 40 : 12); k++) {
    const seed = k ? mix(base, 0x5e2 + k) : base;
    const params = normalise({ ...preset.params, dressing: mix(seed, 0x5e3) % 4 }, { version: R.version });
    const gen = generateTrack({ seed, params, version: R.version });
    if (!gen.ok) { skipped.push({ seed, why: 'no track' }); continue; }
    let quality = null;
    if (R.quality) {
      quality = scored(gen, tracksCfg);
      if (quality.gate < min) { skipped.push({ seed, why: `score ${quality.gate} (under ${min})` }); continue; }
      const like = recent.map(r => similarity(layoutSignature(gen), r)).reduce((a, b) => Math.max(a, b), 0);
      if (like > R.similar.max) { skipped.push({ seed, why: `too like a recent track (${like})` }); continue; }
    }
    const out = { ...describe({ kind, key, seed, gen, preset: preset.id }), quality, skipped };
    memo.set(id, out);
    if (memo.size > 64) memo.delete(memo.keys().next().value);
    return out;
  }
  throw new Error(`No ${kind} track could be made for ${key}.`);
}
// the keys before this one (days, or ISO weeks)
function previousKeys(kind, key, count) {
  const out = [];
  if (kind === 'daily') { const t = Date.parse(`${key}T00:00:00Z`); for (let k = 1; k <= count; k++) out.push(dayKey(t - k * 864e5)); }
  else { const t = Date.parse(`${weekStart(key)}T00:00:00Z`); for (let k = 1; k <= count; k++) out.push(weekKey(t - k * 7 * 864e5)); }
  return out;
}
function describe({ kind, key = null, seed, gen, preset = null }) {
  const info = trackInfo(gen);
  return { kind, key, seed: gen.seed ?? seed, params: gen.params, version: gen.version, code: gen.code, preset, name: trackName(gen.seed ?? seed, { theme: info.theme, layout: info.layout }), info, gen };
}
export const dailyTrack = (date, cfg, tracksCfg) => fromKey('daily', dayKey(date), cfg.daily, tracksCfg);
export const weeklyTrack = (date, cfg, tracksCfg) => fromKey('weekly', weekKey(date), cfg.weekly, tracksCfg);
// A quick race's track: a random seed's, from a preset — the first derived seed that reaches the quick
// races' quality gate (the same seed always gives the same track)
export function quickTrack(presetId, seed, tracksCfg) {
  const preset = tracksCfg.presets.find(p => p.id === presetId) ?? tracksCfg.presets[0], min = tracksCfg.quality?.min?.quick ?? 0;
  let fallback = null;
  for (let k = 0; k < 24; k++) {
    const s = k ? mix(seed >>> 0, 0x9c1 + k) : seed >>> 0, gen = generateTrack({ seed: s, params: preset.params, version: LATEST });
    if (!gen.ok) continue;
    const quality = scored(gen, tracksCfg);
    if (quality.gate >= min) return { ...describe({ kind: 'quick', seed: s, gen, preset: preset.id }), quality };
    if (!fallback || quality.gate > fallback.quality.gate) fallback = { ...describe({ kind: 'quick', seed: s, gen, preset: preset.id }), quality };
  }
  if (fallback) return fallback;
  throw new Error('No track could be made from that preset.');
}
export function sharedTrack(code) {
  const gen = generateTrack({ code: String(code).trim().toUpperCase() });
  if (!gen.ok) throw new Error(gen.error ?? 'That code doesn\'t make a track.');
  return describe({ kind: 'shared', seed: gen.seed, gen });
}

// What the library and the cards show of a track (from the generator's result, or the built world data)
export function trackInfo(g) {
  const T = g.track ?? null, stats = T?.stats ?? g.stats ?? {}, closed = T ? T.closed : g.closed;
  return { code: g.code, version: g.version, layout: closed ? 'loop' : 'p2p', km: Math.round((T?.length ?? g.length ?? stats.length) / 10) / 100, corners: stats.corners ?? null,
    theme: g.params?.theme ?? g.theme ?? null, gridSlots: 8, hairpins: stats.hairpins ?? 0, elevation: stats.elevationRange ?? null, pitLane: !!g.params?.pitLane };
}

// ---------- events ----------
export const eventId = (kind, code, slot) => `trk_${kind}_${String(code).replace(/[^0-9A-Z]/gi, '')}_${slot}`;
export const recordKey = (code, version, carClass) => `${code}|v${version}|${carClass ?? 'open'}`;

export function newTrackEvent({ id, track, type = 'circuit_race', name = null, venue = null, location = { lat: 0, lon: 0 }, author = 'game', now = '2026-01-01T00:00:00.000Z', params = {}, npc = {}, entry = {}, status = 'published' }) {
  const T = TYPES[type];
  if (!T) throw new Error(`no quest type "${type}"`);
  return {
    id, version: CONTENT_VERSION, kind: 'quest', type, name: name ?? `${track.name ?? 'Track'} ${T.label.toLowerCase()}`, description: '', icon: T.icon,
    location: { lat: location.lat, lon: location.lon, alt: location.alt ?? 0, heading: location.heading ?? 0 },
    road: null, status, author, created: now, updated: now, publishedAt: status === 'published' ? now : null,
    route: null, venue,
    track: { code: track.code, kind: track.kind ?? 'official', name: track.name ?? null, hash: track.hash ?? null, layout: track.info?.layout ?? track.layout ?? null, gridSlots: track.info?.gridSlots ?? 8, km: track.info?.km ?? null, corners: track.info?.corners ?? null, theme: track.info?.theme ?? null, version: track.version ?? track.info?.version ?? null, key: track.key ?? null, check: track.check ?? null },
    entry: { classes: [], maxPowerKw: null, minWeightKg: null, maxWeightKg: null, maxKwPerTonne: null, minLevel: 1, ...entry },
    rating: null, npc: { ...npc }, conditions: { timeOfDay: 'any', weather: 'any' }, enabled: true,
    params: { ...JSON.parse(JSON.stringify(T.params)), ...params },
  };
}

// The events a track gets (not an official one: those are made in the editor): data/trackEvents.json's
// for its kind and layout
export function eventsFor(track, cfg, { location = { lat: 0, lon: 0 }, venue = null, now = undefined } = {}) {
  let E = cfg[track.kind]?.events;
  if (typeof E === 'string') E = cfg[E]?.events;
  const list = E?.[track.info?.layout ?? 'loop'] ?? [];
  // (their time of day and weather, by the config's weights, from the code and the event: the same for
  // everyone; any — the theme's own — most often)
  const W = cfg[track.kind]?.conditions, conditionsOf = slot => { if (!W) return null; const r = rng(fnv32(`${track.code}:${slot}:conditions`)); return { timeOfDay: r.weighted(W.timeOfDay ?? { any: 1 }), weather: r.weighted(W.weather ?? { any: 1 }) }; };
  return list.map(e => withConditions(conditionsOf(e.slot), newTrackEvent({
    id: eventId(track.kind, track.code, e.slot), track, type: e.type, name: (e.name ?? '{track}').replace('{track}', track.name), venue, location, now,
    params: { ...(e.laps != null && { laps: e.laps }), ...(e.mode && { mode: e.mode }), ...(e.start && { start: e.start }), ...(e.collisions && { collisions: e.collisions }), ...(e.stints != null && { stints: e.stints }) },
    npc: e.npc?.count ? { count: e.npc.count, skill: e.npc.skill ?? [0.4, 0.8], drivers: 'random' } : {},
  })));
}
const withConditions = (c, ev) => c ? { ...ev, conditions: c } : ev;
