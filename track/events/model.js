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
import { fnv32, mix } from '../det.js';
import { TYPES, CONTENT_VERSION } from '../../content/quests.js';

// ---------- names ----------
const FIRST = {
  countryside: ['Ashby', 'Brookfield', 'Hollins', 'Marley', 'Thornbury', 'Wexcombe', 'Ferris', 'Linden', 'Oakmere', 'Halden'],
  forest: ['Pinewood', 'Black Fir', 'Elkhorn', 'Mossgrove', 'Ravenwood', 'Hemlock', 'Deepwold', 'Larchmont', 'Bracken', 'Owlsden'],
  desert: ['Red Mesa', 'Sandvale', 'Dry Creek', 'Sunreach', 'Cactus Flat', 'Copperstone', 'Dune Point', 'Saltpan', 'Mirage', 'Dustbowl'],
  coastal: ['Saltmarsh', 'Gull Point', 'Bayview', 'Cliffhaven', 'Seacombe', 'Driftwood', 'Port Avel', 'Harbourside', 'Tidewater', 'Shellbay'],
  mountain: ['Highcrest', 'Eagle Pass', 'Stoneridge', 'Frostpeak', 'Granite', 'Col du Roc', 'Snowline', 'Alpenhorn', 'Summit', 'Windgap'],
  street: ['Downtown', 'Harbour City', 'Old Town', 'Midtown', 'Riverside', 'Union Square', 'Canal Street', 'Arsenal', 'Market', 'Neon Quarter'],
};
const LOOP = ['Park', 'Ring', 'Circuit', 'Raceway', 'Motor Park', 'Speedway'], P2P = ['Hillclimb', 'Pass', 'Climb', 'Sprint', 'Road', 'Run'];
export function trackName(seed, { theme = 'countryside', layout = 'loop' } = {}) {
  const A = FIRST[theme] ?? FIRST.countryside, B = layout === 'p2p' ? P2P : theme === 'street' && layout === 'loop' ? ['Street Circuit', 'Grand Prix', 'Circuit', 'Street Race'] : LOOP;
  return `${A[mix(seed >>> 0, 0x4e41) % A.length]} ${B[mix(seed >>> 0, 0x4e42) % B.length]}`;
}

// ---------- the date's tracks ----------
const pad = n => String(n).padStart(2, '0');
export function dayKey(date) { const d = new Date(date); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
export function weekKey(date) {
  const d = new Date(date), t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), day = (new Date(t).getUTCDay() + 6) % 7;   // (Monday 0)
  const thursday = new Date(t - day * 864e5 + 3 * 864e5), y = thursday.getUTCFullYear(), first = Date.UTC(y, 0, 4), fday = (new Date(first).getUTCDay() + 6) % 7;
  const week = 1 + Math.round((thursday.getTime() - (first - fday * 864e5 + 3 * 864e5)) / (7 * 864e5));
  return `${y}-W${pad(week)}`;
}
// (the first seed from the key that makes a track: a generator can give up on one, rarely)
function fromKey(kind, key, C, tracksCfg) {
  const base = fnv32(`${C.salt}:${kind}:${key}`), P = tracksCfg.presets;
  const preset = P.find(p => p.id === C.presets[mix(base, 0x5e1) % C.presets.length]) ?? P[0];
  for (let k = 0; k < 12; k++) {
    const seed = k ? mix(base, 0x5e2 + k) : base;
    const params = normalise({ ...preset.params, dressing: mix(seed, 0x5e3) % 4 }, { version: C.version });
    const gen = generateTrack({ seed, params, version: C.version });
    if (gen.ok) return describe({ kind, key, seed, gen, preset: preset.id });
  }
  throw new Error(`No ${kind} track could be made for ${key}.`);
}
function describe({ kind, key = null, seed, gen, preset = null }) {
  const info = trackInfo(gen);
  return { kind, key, seed: gen.seed ?? seed, params: gen.params, version: gen.version, code: gen.code, preset, name: trackName(gen.seed ?? seed, { theme: info.theme, layout: info.layout }), info, gen };
}
export const dailyTrack = (date, cfg, tracksCfg) => fromKey('daily', dayKey(date), cfg.daily, tracksCfg);
export const weeklyTrack = (date, cfg, tracksCfg) => fromKey('weekly', weekKey(date), cfg.weekly, tracksCfg);
export function quickTrack(presetId, seed, tracksCfg) {
  const preset = tracksCfg.presets.find(p => p.id === presetId) ?? tracksCfg.presets[0];
  for (let k = 0; k < 12; k++) {
    const s = k ? mix(seed >>> 0, 0x9c1 + k) : seed >>> 0, gen = generateTrack({ seed: s, params: preset.params, version: LATEST });
    if (gen.ok) return describe({ kind: 'quick', seed: s, gen, preset: preset.id });
  }
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
  return list.map(e => newTrackEvent({
    id: eventId(track.kind, track.code, e.slot), track, type: e.type, name: (e.name ?? '{track}').replace('{track}', track.name), venue, location, now,
    params: { ...(e.laps != null && { laps: e.laps }), ...(e.mode && { mode: e.mode }), ...(e.start && { start: e.start }), ...(e.collisions && { collisions: e.collisions }), ...(e.stints != null && { stints: e.stints }) },
    npc: e.npc?.count ? { count: e.npc.count, skill: e.npc.skill ?? [0.4, 0.8], drivers: 'random' } : {},
  }));
}
