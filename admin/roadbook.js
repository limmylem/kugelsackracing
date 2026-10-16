// The admin page's ROADBOOK tab (server/src/routes/roadbook.ts; the rules: roadbook/engine.js):
//   - the season's clock: testing, live or ended, its dates and days left, players, tokens earned and spent, items sold;
//     started or ended from here (with why)
//   - its settings in plain forms — the season, chapters, challenges, Expeditions, the shop, places — over a working
//     copy of the whole bundle ({ current, seasons: { id: { season, shop, expeditions } }, places }); a raw JSON view
//     for anything else; a new season; which season is current. Checked here with the game's own rules as you go
//     (bundleProblems) and by the server; saved as a new version with why (basedOn: the version it started from)
//   - every version: who, why, when; viewed (read-only) or rolled back to
//   - Season Tokens given to (or taken from) a player
// Everything typed is shown as text. The pure parts (no page) are exported for tests.

import { EVENTS, bundleProblems } from '../roadbook/engine.js';

// ---------- the pure parts ----------
export const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const DAY = 86_400_000;

// (an id from a name: "The Midnight Run" → "the_midnight_run")
export function slug(text, max = 40) {
  return String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, max).replace(/_+$/, '');
}
export function uniqueId(base, taken) {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
}
// (a season's short prefix for its challenges and shop items: after_hours → ah)
export function prefixOf(seasonId) {
  const parts = String(seasonId ?? '').split('_').filter(Boolean);
  return parts.length > 1 ? parts.map(w => w[0]).join('') : String(seasonId ?? '').slice(0, 2) || 's';
}
// (a place's prefix from the others in its region: adelaide → adl)
export function regionPrefix(places, region) {
  const counts = {};
  for (const p of places ?? []) if (p.region === region && /^[a-z0-9]+_/.test(p.id ?? '')) { const k = p.id.split('_')[0]; counts[k] = (counts[k] ?? 0) + 1; }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? (slug(region).slice(0, 3) || 'place');
}

// a value typed in a box: true, false, null and numbers as such; the rest as text
export function parseValue(text) {
  const s = String(text ?? '').trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (/^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(s)) return Number(s);
  return s;
}
// values with commas: a list (any of them)
export function parseValues(text) {
  const parts = String(text ?? '').split(',').map(x => x.trim()).filter(x => x !== '');
  return parts.length > 1 ? parts.map(parseValue) : parseValue(parts[0] ?? '');
}
const valueText = v => Array.isArray(v) ? v.map(x => String(x)).join(', ') : String(v);

// a challenge's "where" (what the event must say) ⇄ rows of { key, value }
export const whereToRows = where => Object.entries(where ?? {}).map(([key, v]) => ({ key, value: valueText(v) }));
export function whereFromRows(rows) {
  const out = {};
  for (const r of rows ?? []) {
    const k = String(r.key ?? '').trim();
    if (!k || String(r.value ?? '').trim() === '') continue;
    out[k] = parseValues(r.value);
  }
  return Object.keys(out).length ? out : undefined;
}

// what the game reports (roadbook/engine.js EVENTS), in plain words, and what each says
export const EVENT_INFO = {
  race_finished: { label: 'A race or quest finished', fields: ['questType', 'medal', 'place', 'win', 'mp'], hint: 'questType (the kind of quest, e.g. time_trial, checkpoint, hot_lap, hillclimb; multiplayer for online races), medal (gold, silver, bronze), place (1 is first), win (true or false), mp (true: an online race)' },
  part_installed: { label: 'A part fitted to a car', fields: ['partId'], hint: 'partId (the part\'s id)' },
  car_purchased: { label: 'A car bought', fields: ['carId', 'used'], hint: 'carId (the car\'s id), used (true: from the used lot)' },
  car_sold: { label: 'A car sold', fields: ['carId'], hint: 'carId (the car\'s id)' },
  photo_saved: { label: 'A photo saved to the profile', fields: [], hint: '' },
  distance_driven: { label: 'Distance driven', fields: ['metres', 'carId'], hint: 'metres (how far: add it up with "A number adds up to a target"), carId' },
  place_discovered: { label: 'A place discovered', fields: ['place', 'hidden', 'firstEver'], hint: 'place (the place\'s id), hidden (true: a hidden place), firstEver (true: never found before, in any season)' },
  expedition_stage: { label: 'An Expedition stage done', fields: ['expedition', 'stage'], hint: 'expedition (its id), stage (the stage\'s id)' },
  expedition_completed: { label: 'An Expedition finished', fields: ['expedition'], hint: 'expedition (its id)' },
};
export const GOAL_KINDS = { count: 'It happens a number of times', sum: 'A number adds up to a target', unique: 'A number of different ones', streak: 'A number in a row' };
export const goalKind = g => g && 'sum' in g ? 'sum' : g && 'unique' in g ? 'unique' : g && 'streak' in g ? 'streak' : 'count';
// a goal switched to another kind: the other kinds' fields gone, this one's filled in
export function setGoalKind(goal, kind) {
  const keep = { count: ['count'], sum: ['sum', 'target'], unique: ['unique', 'count'], streak: ['streak'] }[kind] ?? ['count'];
  const was = { ...goal }, fields = EVENT_INFO[goal.event]?.fields ?? [];
  for (const k of ['count', 'sum', 'target', 'unique', 'streak']) if (!keep.includes(k)) delete goal[k];
  if (kind === 'count') goal.count ??= 1;
  if (kind === 'sum') { goal.sum ??= fields.includes('metres') ? 'metres' : fields[0] ?? ''; goal.target ??= goal.sum === 'metres' ? 10000 : 10; }
  if (kind === 'unique') { goal.unique ??= ['place', 'carId', 'partId', 'expedition', 'stage'].find(f => fields.includes(f)) ?? fields[0] ?? ''; goal.count ??= 3; }
  if (kind === 'streak') goal.streak ??= was.count > 1 ? was.count : 3;
  return goal;
}

// a shop item's grants ⇄ rows of { key, value: "a, b" }
export const GRANT_KINDS = { finishes: 'Finishes (paint, part or rim)', photoFilters: 'Photo filters', badges: 'Badges' };
export const grantsToRows = grants => Object.entries(grants ?? {}).map(([key, v]) => ({ key, value: (Array.isArray(v) ? v : [v]).join(', ') }));
export function grantsFromRows(rows) {
  const out = {};
  for (const r of rows ?? []) {
    const k = String(r.key ?? '').trim(), list = String(r.value ?? '').split(',').map(x => x.trim()).filter(Boolean);
    if (!k || !list.length) continue;
    const have = out[k] ??= [];
    for (const x of list) if (!have.includes(x)) have.push(x);
  }
  return out;
}

// "lat, lon" as pasted from a map: "-34.92857, 138.60074", "34.9285° S, 138.6007° E", 34°55'42.9"S 138°36'02.7"E, or a
// Google Maps link (…/@-34.92,138.60,15z or ?q=-34.92,138.60) → { lat, lon }, or null
export function parseLatLon(text) {
  let s = String(text ?? '').trim().replace(/[\u2212\u2013]/g, '-');
  if (!s) return null;
  const ok = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat: +lat.toFixed(6), lon: +lon.toFixed(6) } : null;
  const link = s.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/) ?? s.match(/[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i);
  if (link) return ok(+link[1], +link[2]);
  s = s.replace(/^[([]\s*|\s*[)\]]$/g, '');
  const dec = s.match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*(?:[,;/]\s*|\s+)(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (dec) {
    let lat = +dec[1], lon = +dec[3];
    if (dec[2] && /s/i.test(dec[2])) lat = -Math.abs(lat);
    if (dec[4] && /w/i.test(dec[4])) lon = -Math.abs(lon);
    return ok(lat, lon);
  }
  const dms = [...s.matchAll(/(\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*['′’]\s*)?(?:(\d+(?:\.\d+)?)\s*(?:["″”]|'')\s*)?([NSEW])/gi)];
  if (dms.length === 2) {
    const v = m => (+m[1] + (+m[2] || 0) / 60 + (+m[3] || 0) / 3600) * (/[SW]/i.test(m[4]) ? -1 : 1);
    const ns = m => /[NS]/i.test(m[4]);
    if (ns(dms[0]) === ns(dms[1])) return null;
    return ns(dms[0]) ? ok(v(dms[0]), v(dms[1])) : ok(v(dms[1]), v(dms[0]));
  }
  return null;
}
// (a number typed in a box; what isn't one is kept as typed, so the checks point at it)
export const numOrText = v => { const s = String(v ?? '').trim().replace(/^[\u2212\u2013]/, '-'); const n = Number(s); return s !== '' && Number.isFinite(n) ? n : s; };

// an Expedition stage's kinds and the fields each has
// a time of day for an Expedition (or a stage): the hour, half-hourly; null for the player's own
export const TIME_CHOICES = Array.from({ length: 48 }, (_, k) => k / 2);
export function hourText(h) {
  if (!Number.isFinite(h)) return '';
  const hh = Math.floor(h) % 24, mm = Math.round((h % 1) * 60);
  const clock = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  return h === 0 || h === 24 ? `${clock} (midnight)` : h === 12 ? `${clock} (noon)` : h < 6 || h >= 20 ? `${clock} (night)` : h < 8 ? `${clock} (dawn)` : h >= 18 ? `${clock} (dusk)` : clock;
}
export const STAGE_TYPES = { reach: 'Drive to a place (its marker shown)', clue: 'Find a place from a clue (no marker until close)', collect: 'Pick things up (in any order)', checkpoints: 'A timed run through checkpoints' };
export const STAGE_FIELDS = { reach: ['location'], clue: ['clue', 'hint', 'hintAfterMin', 'revealWithin', 'location'], collect: ['radius', 'items'], checkpoints: ['radius', 'timeLimitSec', 'checkpoints'] };
const STAGE_DEFAULTS = { location: () => ({ radius: 50 }), clue: () => '', hint: () => '', hintAfterMin: () => 10, revealWithin: () => 150, items: () => [], checkpoints: () => [], timeLimitSec: () => 300, radius: type => type === 'collect' ? 25 : 30 };
// a stage switched to another kind: what the old kind had and the new one doesn't put aside (in stash: switching back
// brings it back), the new kind's fields filled in
export function setStageType(stage, type, stash = {}) {
  const now = STAGE_FIELDS[type];
  if (!now) return stage;
  for (const k of STAGE_FIELDS[stage.type] ?? []) if (!now.includes(k) && k in stage) { stash[k] = stage[k]; delete stage[k]; }
  stage.type = type;
  for (const k of now) if (!(k in stage)) stage[k] = k in stash ? stash[k] : STAGE_DEFAULTS[k](type);
  return stage;
}

// a new season: the least that passes the checks (one chapter at 0 points; no challenges, Expeditions or shop items yet)
export const SEASON_ID = /^[a-z][a-z0-9_]{1,39}$/;
export function newSeason(id, name) {
  return {
    season: { id, name, tagline: '', colour: '#36b3f5', start: 'beta_open', lengthDays: 56, warningDays: 7, conversion: { cashPerToken: 2 },
      chapters: [{ id: 'chapter_one', name: 'Chapter one', blurb: '', unlockAt: 0, milestoneTokens: 100 }], challenges: [], discoveries: { hiddenTokens: 100 }, expeditions: [] },
    shop: { season: id, items: [] },
    expeditions: {},
  };
}
// (added to the bundle; a sentence when it can't be)
export function addSeason(all, id, name) {
  id = String(id ?? '').trim(); name = String(name ?? '').trim();
  if (!SEASON_ID.test(id)) return 'A season\'s id is 2 to 40 small letters, digits or _, starting with a letter (e.g. neon_summer).';
  if (all.seasons?.[id]) return `There's a season "${id}" already.`;
  if (!name) return 'Give the season a name.';
  (all.seasons ??= {})[id] = newSeason(id, name);
  return null;
}
export const EXPEDITION_ID = /^[a-z][a-z0-9_]{1,59}$/;
export function newExpedition(id, name, seasonId, region = '') {
  return { id, season: seasonId, name, region, blurb: '', party: { min: 1, max: 1 },
    stages: [{ id: 'start', type: 'reach', name: 'The start', text: '', location: { radius: 50 }, points: 50, tokens: 100 }] };
}
// (added to the season's bundle and its list — players can start it; its first stage still needs a place)
export function addExpedition(all, seasonId, id, name, region = '') {
  const e = all.seasons?.[seasonId];
  id = String(id ?? '').trim(); name = String(name ?? '').trim();
  if (!e?.season) return 'There\'s no such season.';
  if (!EXPEDITION_ID.test(id)) return 'An Expedition\'s id is small letters, digits or _, starting with a letter (e.g. harbour_lights).';
  if (e.expeditions?.[id]) return `There's an Expedition "${id}" already.`;
  if (!name) return 'Give the Expedition a name.';
  (e.expeditions ??= {})[id] = newExpedition(id, name, seasonId, String(region ?? '').trim());
  const list = e.season.expeditions ??= [];
  if (!list.includes(id)) list.push(id);
  return null;
}

// every point a season has to earn (its challenges and its Expeditions' stages): the chapters open on these
export function seasonPoints(all, sid) {
  const s = all?.seasons?.[sid], S = s?.season ?? {};
  return (S.challenges ?? []).reduce((a, c) => a + (Number(c.points) || 0), 0)
    + (S.expeditions ?? []).reduce((a, x) => a + (s.expeditions?.[x]?.stages ?? []).reduce((b, st) => b + (Number(st.points) || 0), 0), 0);
}

// The bundle as it goes to the server: empty conditions and empty grant lists left out
export function cleanBundle(all) {
  const out = clone(all);
  for (const s of Object.values(out?.seasons ?? {})) {
    for (const ch of s?.season?.challenges ?? []) if (isObj(ch.goal?.where) && !Object.keys(ch.goal.where).length) delete ch.goal.where;
    for (const it of s?.shop?.items ?? []) if (isObj(it.grants)) for (const [k, v] of Object.entries(it.grants)) if (Array.isArray(v) && !v.length) delete it.grants[k];
  }
  return out;
}

// What looks wrong that the server's checks (bundleProblems) let through: plain sentences, worth a look before saving
export function extraProblems(all) {
  const out = [], coord = (v, max) => typeof v === 'number' && Math.abs(v) <= max, at = p => coord(p?.lat, 90) && coord(p?.lon, 180);
  const blank = v => !String(v ?? '').trim();
  for (const p of all?.places ?? []) {
    if (blank(p.name)) out.push(`Place ${p.id}: it needs a name.`);
    if (!at(p)) out.push(`Place ${p.name || p.id}: its latitude and longitude must be numbers.`);
    if (p.radius != null && !(p.radius > 0)) out.push(`Place ${p.name || p.id}: its radius is more than 0 metres.`);
  }
  for (const [sid, s] of Object.entries(all?.seasons ?? {})) {
    const S = s?.season ?? {}, nm = S.name || sid;
    if (blank(S.name)) out.push(`Season ${sid}: it needs a name.`);
    for (const c of S.chapters ?? []) if (blank(c.name)) out.push(`${nm}: the chapter ${c.id} needs a name.`);
    for (const ch of S.challenges ?? []) {
      const g = ch.goal ?? {}, label = `${nm}, ${ch.name || ch.id}`;
      if (blank(ch.name)) out.push(`${nm}: the challenge ${ch.id} needs a name.`);
      if ('sum' in g && blank(g.sum)) out.push(`${label}: say which number to add up.`);
      if ('unique' in g && blank(g.unique)) out.push(`${label}: say what has to be different.`);
      if ('streak' in g && !(Number.isInteger(g.streak) && g.streak > 0)) out.push(`${label}: how many in a row is a whole number above 0.`);
      if ('count' in g && !(Number.isInteger(g.count) && g.count > 0)) out.push(`${label}: how many is a whole number above 0.`);
    }
    for (const [xid, x] of Object.entries(s?.expeditions ?? {})) {
      const xn = x?.name || xid;
      for (const st of x?.stages ?? []) {
        const sn = `${xn}, ${st.name || st.id}`;
        if (blank(st.name)) out.push(`${xn}: the stage ${st.id} needs a name.`);
        const pts = st.type === 'collect' ? st.items : st.type === 'checkpoints' ? st.checkpoints : [st.location];
        if ((pts ?? []).some(p => !at(p))) out.push(`${sn}: every latitude and longitude must be a number.`);
        if (st.type === 'collect') { const ids = new Set(); for (const it of st.items ?? []) { if (!it.id || ids.has(it.id)) out.push(`${sn}: each thing to pick up needs an id of its own.`); ids.add(it.id); } }
        if (st.type === 'checkpoints' && (st.checkpoints ?? []).length < 2) out.push(`${sn}: a checkpoint run needs at least a start and a finish.`);
        if (st.type === 'clue' && blank(st.clue)) out.push(`${sn}: it needs its clue.`);
      }
    }
    for (const it of s?.shop?.items ?? []) {
      if (blank(it.name)) out.push(`${nm} shop: the item ${it.id} needs a name.`);
      if (!Object.values(it.grants ?? {}).some(v => v?.length)) out.push(`${nm} shop, ${it.name || it.id}: owning it unlocks nothing.`);
    }
  }
  return out;
}

// (the checks on anything, even a broken raw JSON: never throws)
export function checkBundle(all) {
  let problems, warnings;
  try { problems = bundleProblems(all); } catch (e) { problems = [`The settings can't be checked as they are (${e.message}): fix them in Raw JSON.`]; }
  try { warnings = extraProblems(all); } catch { warnings = []; }
  return { problems, warnings };
}

// What changed between two bundles: [{ path: [...], kind: 'changed' | 'added' | 'removed' | 'moved', from, to }]. Lists
// of things with ids are matched by id (so a new one in the middle is one change, not many).
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keyed = arr => arr.length > 0 && arr.every(x => isObj(x) && typeof x.id === 'string' && x.id) && new Set(arr.map(x => x.id)).size === arr.length;
export function diffPaths(a, b, path = []) {
  if (same(a, b)) return [];
  if (Array.isArray(a) && Array.isArray(b)) {
    if ((keyed(a) || !a.length) && (keyed(b) || !b.length)) {
      const out = [], A = new Map(a.map(x => [x.id, x])), B = new Map(b.map(x => [x.id, x]));
      for (const [id, x] of A) if (!B.has(id)) out.push({ path: [...path, id], kind: 'removed', from: x });
      for (const [id, x] of B) if (!A.has(id)) out.push({ path: [...path, id], kind: 'added', to: x });
      for (const [id, x] of B) if (A.has(id)) out.push(...diffPaths(A.get(id), x, [...path, id]));
      if (a.map(x => x.id).filter(id => B.has(id)).join('\n') !== b.map(x => x.id).filter(id => A.has(id)).join('\n')) out.push({ path, kind: 'moved' });
      return out;
    }
    if ([...a, ...b].some(x => x && typeof x === 'object')) {
      const out = [];
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const p = [...path, `#${i + 1}`];
        if (i >= a.length) out.push({ path: p, kind: 'added', to: b[i] });
        else if (i >= b.length) out.push({ path: p, kind: 'removed', from: a[i] });
        else out.push(...diffPaths(a[i], b[i], p));
      }
      return out;
    }
    return [{ path, kind: 'changed', from: a, to: b }];
  }
  if (isObj(a) && isObj(b)) {
    const out = [];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[k] === undefined && b[k] === undefined) continue;
      if (a[k] === undefined) out.push({ path: [...path, k], kind: 'added', to: b[k] });
      else if (b[k] === undefined) out.push({ path: [...path, k], kind: 'removed', from: a[k] });
      else out.push(...diffPaths(a[k], b[k], [...path, k]));
    }
    return out;
  }
  return [{ path, kind: 'changed', from: a, to: b }];
}
export function pathText(path) {
  const p = [...path];
  if (p[0] === 'seasons' && p.length > 1) { p.shift(); if (p[1] === 'season') p.splice(1, 1); }
  return p.length ? p.join(' › ') : '(everything)';
}
const short = v => { if (v === undefined) return '—'; const s = typeof v === 'string' ? `"${v}"` : JSON.stringify(v); return s.length > 90 ? `${s.slice(0, 87)}…` : s; };
const named = v => isObj(v) ? (v.name || v.id ? ` (${v.name || v.id})` : '') : Array.isArray(v) ? '' : ` (${short(v)})`;
export function describeChange(d) {
  const p = pathText(d.path);
  if (d.kind === 'added') return `${p}: added${named(d.to)}`;
  if (d.kind === 'removed') return `${p}: removed${named(d.from)}`;
  if (d.kind === 'moved') return `${p}: in a new order`;
  return `${p}: ${short(d.from)} → ${short(d.to)}`;
}
export const daysLeft = (endsAt, now = Date.now()) => Math.max(0, Math.ceil((Date.parse(endsAt) - now) / DAY));
// (datetime-local boxes are in the admin's own time; the bundle keeps UTC)
const toLocal = iso => { const d = new Date(iso ?? ''); return Number.isNaN(d.getTime()) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); };
const fromLocal = v => { const d = new Date(v); return v && !Number.isNaN(d.getTime()) ? d.toISOString() : ''; };


// ---------- the tab ----------
export function createRoadbookTools({ api, h, say, when, errText, main }) {
  const P = '/admin/roadbook';
  const NOTE = 'font-size:13px;text-transform:none;letter-spacing:0;font-weight:400;margin-top:4px';
  const TICK = 'display:flex;flex-direction:row;align-items:center;gap:10px;text-transform:none;letter-spacing:0;font-size:15px;font-weight:400;padding:6px 0';
  const MONO = 'font-family:var(--f-mono);font-size:13px';
  const SMALL = 'flex:0 0 150px;min-width:120px';
  const PAGES = [['season', 'Season'], ['chapters', 'Chapters'], ['challenges', 'Challenges'], ['expeditions', 'Expeditions'], ['shop', 'Shop'], ['places', 'Places'], ['raw', 'Raw JSON']];
  const STYLES = { racing: 'Racing', building: 'Building', exploring: 'Exploring' };

  // the tab's state: the latest from the server (status, versions, the live version), the version the working copy
  // started from (base), the working copy itself, and what's being edited
  const S = { status: null, versions: [], live: null, base: null, work: null, sid: null, view: 'season', exp: null, raw: null, rawDirty: false, serverProblems: null, showChanges: false, justAdded: null, placeFilter: '' };
  const auto = new WeakSet();   // (new things whose id follows their name, until the id's typed in)
  const ui = new WeakMap();     // (each challenge's condition rows and goal kind, each item's grant rows, each stage's put-aside fields)
  const uiOf = (o, make) => { let u = ui.get(o); if (!u) ui.set(o, u = make()); return u; };
  let E = null, seq = 0, refreshTimer = null;
  const changes = () => S.work && S.base ? diffPaths(S.base.data, S.work) : [];
  const unsaved = () => !!S.work && (S.rawDirty || changes().length > 0);
  globalThis.addEventListener?.('beforeunload', e => { if (unsaved()) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- small pieces ----------
  const badge = (text, kind = '', style = null) => h('span', { class: `badge ${kind}`, style }, text);
  const spacer = () => h('span', { style: 'flex:1' });
  const mini = (text, onclick, title, cls = 'ghost') => h('button', { type: 'button', class: `btn ${cls}`, style: 'height:32px;padding:0 10px;font-size:13px !important', title, 'aria-label': title, onclick }, text);
  const field = (label, input, note = '', style = null) => h('label', { style }, label, input, note ? h('div', { class: 'muted', style: NOTE }, note) : '');
  const note = (text, good = false) => say(E.note, text, good);
  const changed = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 200); };
  const ask = text => { const v = prompt(`${text}\n\nWhy? (required: it goes in the log)`); return v && v.trim().length >= 3 ? v.trim() : null; };
  const select = (options, value, onchange) => h('select', { onchange: e => onchange(e.target.value) },
    ...Object.entries(options).map(([v, t]) => h('option', { value: v, selected: v === value }, t)),
    value != null && !(value in options) ? h('option', { value, selected: true }, `(unknown: ${value})`) : null);
  // a time of day bound to o[k]: the hour, or left out (the label for that: the player's own, or the Expedition's)
  const timeSelect = (o, k, noneLabel) => h('select', { onchange: e => { const v = e.target.value; if (v === '') delete o[k]; else o[k] = Number(v); changed(); } },
    h('option', { value: '', selected: !Number.isFinite(o[k]) }, noneLabel),
    ...[...TIME_CHOICES, ...(Number.isFinite(o[k]) && !TIME_CHOICES.includes(o[k]) ? [o[k]] : [])].map(v => h('option', { value: String(v), selected: o[k] === v }, hourText(v))));
  // boxes bound to o[k]: text; a longer text; a number (blank leaves it out, or null where it has to be there); a tick
  const text = (o, k, attrs = {}) => h('input', { value: o[k] ?? '', ...attrs, oninput: e => { o[k] = e.target.value; changed(); } });
  const area = (o, k, rows = 2, attrs = {}) => h('textarea', { rows, style: 'width:100%;font:inherit;resize:vertical', ...attrs, oninput: e => { o[k] = e.target.value; changed(); } }, o[k] ?? '');
  const num = (o, k, attrs = {}, blank = 'delete') => h('input', { type: 'number', value: o[k] ?? '', ...attrs, oninput: e => {
    const v = e.target.value.trim();
    if (v === '') { if (blank === 'null') o[k] = null; else delete o[k]; } else o[k] = Number(v);
    changed();
  } });
  const tick = (o, k, label) => h('label', { style: TICK }, h('input', { type: 'checkbox', checked: !!o[k], style: 'width:auto', onchange: e => { if (e.target.checked) o[k] = true; else delete o[k]; changed(); } }), label);
  // an id: made from the name while it's new (until typed in); checked when changed (taken(): the ids in use besides this one)
  function idInput(o, taken, onRename = null) {
    return h('input', { value: o.id ?? '', maxlength: 60, style: MONO, title: 'Players\' progress is kept by this id: change it only before the season starts.',
      oninput: () => auto.delete(o),
      onchange: e => {
        const v = slug(e.target.value, 60), was = o.id;
        if (!v) { e.target.value = was ?? ''; return note('An id needs at least one letter or digit.'); }
        if (v !== was && taken().has(v)) { e.target.value = was ?? ''; return note(`The id "${v}" is used already: pick another.`); }
        o.id = v; e.target.value = v;
        if (v !== was) { onRename?.(was, v); changed(); }
      } });
  }
  function nameInput(o, idEl, makeId, { onRename = null, onName = null, max = 80 } = {}) {
    return h('input', { value: o.name ?? '', maxlength: max, 'data-new': S.justAdded === o ? '' : null, oninput: e => {
      o.name = e.target.value;
      if (auto.has(o) && e.target.value.trim()) { const was = o.id, id = makeId(e.target.value); if (id !== was) { o.id = id; idEl.value = id; onRename?.(was, id); } }
      onName?.(e.target.value);
      changed();
    } });
  }
  function focusNew() {
    const el = E?.body.querySelector('[data-new]');
    if (el) { el.removeAttribute('data-new'); el.focus(); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    S.justAdded = null;
  }
  // ↑ ↓ ✕ for a thing in a list
  const moveTools = (list, i, redraw, { what = 'this', ask: confirmIt = true, before = null, after = null } = {}) => [
    mini('↑', () => { if (i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; changed(); redraw(); } }, 'Move up'),
    mini('↓', () => { if (i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; changed(); redraw(); } }, 'Move down'),
    mini('✕', () => {
      if (before ? !before() : confirmIt && !confirm(`Remove ${what}?`)) return;
      list.splice(i, 1); after?.(); changed(); redraw();
    }, `Remove ${what}`, 'danger'),
  ];
  // where something is: latitude and longitude boxes (pasting "lat, lon" — e.g. from Google Maps — into either fills
  // both) and a link to see it on a map
  function coordInputs(o) {
    const lat = h('input', { inputmode: 'decimal', value: o.lat ?? '', placeholder: 'e.g. -34.9214', title: 'Paste "latitude, longitude" (e.g. from Google Maps) to fill both', style: 'min-width:100px;width:100%' });
    const lon = h('input', { inputmode: 'decimal', value: o.lon ?? '', placeholder: 'e.g. 138.6007', style: 'min-width:100px;width:100%' });
    const link = h('a', { target: '_blank', rel: 'noopener noreferrer', style: 'white-space:nowrap' }, 'See it on a map');
    const show = () => {
      const okLat = typeof o.lat === 'number' && Math.abs(o.lat) <= 90, okLon = typeof o.lon === 'number' && Math.abs(o.lon) <= 180;
      lat.style.borderColor = okLat ? '' : 'var(--c-bad)'; lon.style.borderColor = okLon ? '' : 'var(--c-bad)';
      link.hidden = !(okLat && okLon);
      if (okLat && okLon) link.href = `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lon}`;
    };
    const pair = p => { o.lat = p.lat; o.lon = p.lon; lat.value = String(p.lat); lon.value = String(p.lon); show(); changed(); };
    for (const [el, k] of [[lat, 'lat'], [lon, 'lon']]) {
      el.addEventListener('paste', e => { const p = parseLatLon(e.clipboardData?.getData('text')); if (p) { e.preventDefault(); pair(p); } });
      el.addEventListener('input', e => {
        // (pasted or dropped in: split now; typed: when the box is left)
        if (e.inputType && e.inputType !== 'insertText' && e.inputType.startsWith('insert')) { const p = parseLatLon(el.value); if (p) return pair(p); }
        const v = el.value.trim();
        if (v === '') delete o[k]; else o[k] = numOrText(v);
        show(); changed();
      });
      el.addEventListener('change', () => { const p = parseLatLon(el.value); if (p) pair(p); });
    }
    show();
    return { lat, lon, link };
  }
  function spotRow(loc, radiusDefault) {
    const c = coordInputs(loc);
    return h('div', { class: 'row' }, field('Latitude', c.lat), field('Longitude', c.lon),
      field('Radius (metres)', num(loc, 'radius', { min: 1, step: 5, placeholder: String(radiusDefault) }), 'How close counts as there', SMALL), c.link);
  }

  // ---------- the tab ----------
  async function showRoadbook() {
    const box = main();
    box.className = 'narrow';
    box.style.gridTemplateColumns = 'minmax(320px, 1200px)';
    if (!document.querySelector('link[data-rb-icons]')) document.head.append(h('link', { rel: 'stylesheet', 'data-rb-icons': '', href: 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,300..500,0..1,0&display=block' }));
    E = { msg: h('div'), clock: h('div', {}, h('p', { class: 'muted' }, 'Loading…')), seasons: h('div'), pages: h('div', { class: 'row' }), note: h('div'), problems: h('div', { class: 'list' }),
      body: h('div', { class: 'list', style: 'gap:12px' }), versions: h('div'), verMsg: h('div'), view: h('div'), tokens: h('div'),
      count: h('b', { style: 'font-size:14px' }), changes: h('div'), moved: h('div'), saveMsg: h('div'),
      reason: h('input', { placeholder: 'Why this change (required: it goes in the history)', maxlength: 500, style: 'flex:1;min-width:240px' }) };
    E.toggle = h('button', { class: 'btn ghost', onclick: () => { S.showChanges = !S.showChanges; drawSave(); } }, 'Show what changed');
    E.undo = h('button', { class: 'btn ghost', onclick: undoAll }, 'Undo my changes');
    E.saveBtn = h('button', { class: 'btn primary', onclick: save }, 'Save as a new version');
    E.save = h('div', { style: 'position:sticky;bottom:0;z-index:2;background:var(--c-panel);border-top:1px solid var(--c-line);margin:0 calc(-1 * var(--s-5)) calc(-1 * var(--s-5));padding:var(--s-3) var(--s-5);display:flex;flex-direction:column;gap:8px;border-radius:0 0 var(--r-panel) var(--r-panel);box-shadow:0 -8px 16px rgba(0,0,0,.35)' },
      E.moved, E.changes, h('div', { class: 'row', style: 'align-items:center' }, E.count, E.toggle, E.undo, E.reason, E.saveBtn), E.saveMsg);
    box.replaceChildren(
      h('section', {}, h('h2', {}, 'ROADBOOK'),
        h('p', { class: 'muted' }, 'The seasonal pass: chapters that open with points, challenges, Expeditions (drives to real places), Season Tokens and the season\'s shop. This is the season players are on now.'),
        E.msg, E.clock),
      h('section', {}, h('h2', {}, 'Settings'),
        h('p', { class: 'muted' }, 'Change anything below, then save it at the bottom: it becomes a new version, live for every player at once, with who and why. Nothing changes for players until you save. The checks run as you go; any version can be rolled back to.'),
        E.seasons, E.pages, E.note, E.problems, E.body, E.save),
      h('section', {}, h('h2', {}, 'Versions'), h('p', { class: 'muted' }, 'The last 30, newest first. Rolling back makes a new version with an older one\'s settings; players\' progress and tokens stay as they are.'), E.verMsg, E.versions, E.view),
      h('section', {}, h('h2', {}, 'Give or take Season Tokens'), E.tokens));
    drawTokens();
    await load({ returning: true });
  }

  async function load({ fresh = false, returning = false } = {}) {
    let r;
    try { r = await api.get(P); }
    catch (e) { E.clock.replaceChildren(h('div', { class: 'msg bad' }, errText(e))); return false; }
    const keep = !fresh && unsaved();
    S.status = r.status; S.versions = r.versions ?? []; S.live = { version: r.version, data: r.data };
    if (!keep) { S.base = S.live; S.work = clone(r.data); S.raw = null; S.rawDirty = false; S.serverProblems = null; }
    drawClock(); drawVersions(); drawEditor();
    if (keep && returning) note('Your changes from before (not saved yet) are still here.', true);
    return true;
  }

  // ---------- the season's clock ----------
  function drawClock() {
    const st = S.status ?? {}, entry = S.live.data?.seasons?.[st.current], season = entry?.season ?? {};
    const name = season.name ?? st.current ?? '—', rate = season.conversion?.cashPerToken ?? 0, len = season.lengthDays ?? 0;
    const starts = st.start === 'beta_open' ? 'when sign-ups open to everyone (the Launch tab)' : st.start ? `on ${when(st.start)}` : 'when you start it here';
    const statusBadge = { testing: badge('testing', '', 'background:var(--c-warn-tint);color:var(--c-warn)'), live: badge('live', 'editor'), ended: badge('ended') }[st.status] ?? badge('not set up');
    const about = {
      testing: `Only admins and editors see it, to test it. It starts ${starts}, or when you start it here. What anyone did in it while testing is cleared when it starts.`,
      live: `Everyone plays it. When it ends, every player's leftover Season Tokens become cash at $${rate} a token.`,
      ended: 'It\'s over: nothing more is earned in it and its shop is closed; leftover tokens were turned into cash. For another season, add one under Settings, make it the current one and save.',
    }[st.status] ?? 'The current season isn\'t in the settings.';
    const items = Object.entries(st.items ?? {}), itemName = id => entry?.shop?.items?.find(x => x.id === id)?.name ?? id;
    const sold = items.reduce((a, [, n]) => a + n, 0);
    const why = h('input', { placeholder: 'Required: it goes in the log', maxlength: 500 });
    const run = (what, text) => async () => {
      if (why.value.trim().length < 3) { why.focus(); return say(E.msg, 'Say why first (a few words): it goes in the log.'); }
      if (!confirm(text)) return;
      try {
        const r = await api.post(`${P}/season/${what}`, { reason: why.value.trim() });
        if (r?.ok === false) return say(E.msg, r.error ?? 'Nothing happened.');
        await load();
        say(E.msg, what === 'start' ? `${name} has started: it ends on ${when(r.endsAt)}.` : `${name} has ended. ${r.converted ?? 0} player${r.converted === 1 ? '\'s' : 's\''} leftover tokens were turned into cash.`, true);
      } catch (e) { say(E.msg, errText(e)); }
    };
    const endsAbout = new Date(Date.now() + len * DAY).toISOString();
    E.clock.replaceChildren(...[
      h('dl', {},
        h('dt', {}, 'Season'), h('dd', {}, `${name} (${st.current ?? '—'})`),
        h('dt', {}, 'Status'), h('dd', {}, statusBadge),
        h('dt', {}, st.status === 'testing' ? 'Starts' : 'Started'), h('dd', {}, st.status === 'testing' ? starts : when(st.startedAt)),
        h('dt', {}, st.status === 'ended' ? 'Ended' : 'Ends'), h('dd', {}, st.status === 'testing' ? `${len} days after it starts` : when(st.status === 'ended' ? st.endedAt ?? st.endsAt : st.endsAt)),
        h('dt', {}, 'Days left'), h('dd', {}, st.status === 'live' && st.endsAt ? `${daysLeft(st.endsAt)} (players are told it's ending in its last ${season.warningDays ?? 7} days)` : st.status === 'testing' ? `all ${len} (it hasn't started)` : 'none'),
        h('dt', {}, 'Players'), h('dd', {}, `${st.players ?? 0} with progress in it`),
        h('dt', {}, 'Points earned'), h('dd', {}, `${(st.points ?? 0).toLocaleString('en-GB')} (all players together)`),
        h('dt', {}, 'Season Tokens'), h('dd', {}, `${(st.tokens?.earned ?? 0).toLocaleString('en-GB')} earned · ${(st.tokens?.spent ?? 0).toLocaleString('en-GB')} spent in the shop`),
        h('dt', {}, 'Items sold'), h('dd', {}, items.length ? `${sold}: ${items.map(([id, n]) => `${itemName(id)} × ${n}`).join(' · ')}` : 'none yet')),
      h('p', { class: 'muted', style: 'margin:0' }, about),
      st.status === 'testing' ? h('div', { class: 'actions' }, h('div', { class: 'action' }, h('label', {}, 'Why you\'re starting it', why),
        h('button', { class: 'btn primary', onclick: run('start', `Start ${name} now?\n\n• Every player sees it from now, for ${len} days (until about ${when(endsAbout)}).\n• What admins and editors did in it while testing is cleared: they start again with everyone.`) }, 'Start the season now'))) : null,
      st.status === 'live' ? h('div', { class: 'actions' }, h('div', { class: 'action' }, h('label', {}, 'Why you\'re ending it', why),
        h('button', { class: 'btn danger', onclick: run('end', `End ${name} now? This can't be undone.\n\n• Every player's leftover Season Tokens become cash at $${rate} a token (100 tokens → $${(100 * rate).toLocaleString('en-GB')}).\n• Its shop closes and nothing more is earned in it.\n• What players bought stays theirs.`) }, 'End the season now'))) : null].filter(Boolean));
  }

  // ---------- the settings: which season, which page ----------
  function drawEditor() {
    if (!S.work?.seasons?.[S.sid]) S.sid = S.work?.seasons?.[S.work?.current] ? S.work.current : Object.keys(S.work?.seasons ?? {})[0] ?? null;
    drawSeasons();
    E.pages.replaceChildren(...PAGES.map(([k, t]) => h('button', { class: `btn ${S.view === k ? 'primary' : 'ghost'}`, onclick: () => go(k) }, t)));
    drawBody();
    refresh();
  }
  function go(k) {
    if (S.view === 'raw' && !applyRaw()) return;
    S.view = k; say(E.note, '');
    drawEditor();
  }
  function drawSeasons() {
    const ids = Object.keys(S.work?.seasons ?? {}), nm = id => `${S.work.seasons[id]?.season?.name || id} (${id})`;
    const editSel = h('select', { onchange: e => { S.sid = e.target.value; S.exp = null; drawEditor(); } }, ...ids.map(id => h('option', { value: id, selected: id === S.sid }, nm(id))));
    const curSel = h('select', { onchange: e => {
      const v = e.target.value;
      if (!applyRaw()) { e.target.value = S.work.current; return; }
      if (!confirm(`Make ${nm(v)} the current season?\n\nWhen you save, every player's ROADBOOK switches to it, and the season on now stops showing (its leftover tokens still become cash when its time runs out — or end it first, at the top). Until ${S.work.seasons[v]?.season?.name || v} starts (its start date, sign-ups opening to everyone, or "Start the season now") only admins and editors see it.`)) { e.target.value = S.work.current; return; }
      S.work.current = v; changed();
    } }, ...ids.map(id => h('option', { value: id, selected: id === S.work.current }, nm(id))), !ids.includes(S.work?.current) ? h('option', { value: S.work?.current ?? '', selected: true }, `(missing: ${S.work?.current})`) : null);
    const nid = h('input', { placeholder: 'e.g. neon_summer', maxlength: 40, style: MONO, oninput: () => { nid.dataset.typed = '1'; } });
    const nname = h('input', { placeholder: 'e.g. Neon Summer', maxlength: 60, oninput: () => { if (!nid.dataset.typed) nid.value = slug(nname.value); } });
    const add = () => {
      if (!applyRaw()) return;
      const id = nid.value.trim(), err = addSeason(S.work, id, nname.value);
      if (err) return note(err);
      S.sid = id; S.view = 'season'; changed(); drawEditor();
      note(`${nname.value.trim()} is added to your changes. Fill it in, then save; it isn't the current season until you pick it as that.`, true);
    };
    E.seasons.replaceChildren(h('div', { class: 'row' },
      field('Season to edit', editSel), field('Current season (the one players play)', curSel, 'Changing it switches every player\'s season when you save.'),
      h('details', { style: 'flex:1 1 100%' }, h('summary', { style: 'cursor:pointer;color:var(--c-accent)' }, 'Add a new season'),
        h('div', { class: 'row' }, field('Name', nname), field('Id', nid, 'Small letters, digits and _; fixed once made'),
          h('button', { class: 'btn secondary', onclick: add }, 'Add it')),
        h('p', { class: 'muted' }, 'It starts with one chapter (open from 0 points), no challenges, no Expeditions and an empty shop.'))));
  }
  function drawBody() {
    const entry = S.sid ? S.work.seasons?.[S.sid] : null;
    let kids;
    try {
      if (S.view === 'raw') kids = rawPage();
      else if (S.view === 'places') kids = placesPage();
      else if (!entry) kids = [h('p', { class: 'muted' }, 'There\'s no season yet: add one above.')];
      else if (!isObj(entry.season)) kids = [h('div', { class: 'msg bad' }, `The season "${S.sid}" has no settings: fix it in Raw JSON.`)];
      else kids = { season: seasonPage, chapters: chaptersPage, challenges: challengesPage, expeditions: expeditionsPage, shop: shopPage }[S.view](entry, S.sid);
    } catch (e) {
      console.error(e);
      kids = [h('div', { class: 'msg bad' }, `This page can't show these settings (${e.message}): fix them in Raw JSON.`)];
    }
    E.body.replaceChildren(...[kids].flat(Infinity).filter(x => x != null && x !== false && x !== ''));
    focusNew();
  }

  // ---------- the season ----------
  function seasonPage(entry, sid) {
    const s = entry.season;
    const date = h('input', { type: 'datetime-local', value: s.start && s.start !== 'beta_open' ? toLocal(s.start) : '', disabled: s.start === 'beta_open', oninput: e => { s.start = fromLocal(e.target.value); changed(); } });
    const startSel = h('select', { onchange: e => {
      if (e.target.value === 'beta_open') { s.start = 'beta_open'; date.disabled = true; } else { date.disabled = false; s.start = fromLocal(date.value); date.focus(); }
      changed();
    } }, h('option', { value: 'beta_open', selected: s.start === 'beta_open' }, 'When sign-ups open to everyone (the Launch tab)'), h('option', { value: 'date', selected: s.start !== 'beta_open' }, 'On a date and time'));
    const hex = h('span', { style: MONO }, s.colour ?? '');
    const colour = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(s.colour ?? '') ? s.colour : '#36b3f5', style: 'height:42px;width:72px;padding:4px', oninput: e => { s.colour = e.target.value; hex.textContent = s.colour; changed(); } });
    const rate = h('input', { type: 'number', min: 0, step: 0.5, value: s.conversion?.cashPerToken ?? '', oninput: e => { const v = e.target.value.trim(); s.conversion ??= {}; if (v === '') delete s.conversion.cashPerToken; else s.conversion.cashPerToken = Number(v); changed(); } });
    const hidden = h('input', { type: 'number', min: 0, step: 10, value: s.discoveries?.hiddenTokens ?? '', oninput: e => { const v = e.target.value.trim(); s.discoveries ??= {}; if (v === '') delete s.discoveries.hiddenTokens; else s.discoveries.hiddenTokens = Number(v); changed(); } });
    const isCurrent = S.work.current === sid;
    return [
      h('p', { class: 'muted' }, `${isCurrent ? 'This is the current season (the one players play).' : 'This isn\'t the current season: players don\'t see it.'} It has ${seasonPoints(S.work, sid).toLocaleString('en-GB')} points to earn (its challenges and Expedition stages).`),
      h('div', { class: 'row' }, field('Name', text(s, 'name', { maxlength: 60 })), field('Id', h('input', { value: sid, readonly: true, style: MONO }), 'Fixed (players\' progress is kept by it)', SMALL)),
      field('Tagline (under the name)', text(s, 'tagline', { maxlength: 120 })),
      h('div', { class: 'row', style: 'align-items:center' }, field('Colour', colour, '', 'flex:0 0 auto'), hex),
      h('div', { class: 'row' }, field('Starts', startSel), field('Date and time (your time)', date, s.start && s.start !== 'beta_open' ? `Saved as ${s.start} (UTC)` : '')),
      h('p', { class: 'muted' }, 'Before it starts, only admins and editors see it, to test it; "Start the season now" at the top starts it whenever you like. A date works only if nobody has opened the season before that date (its clock is set the first time anyone looks), so to be sure, use "Start the season now" on the day.'),
      h('div', { class: 'row' },
        field('Lasts (days)', num(s, 'lengthDays', { min: 1, step: 1 }), '', SMALL),
        field('Warning before the end (days)', num(s, 'warningDays', { min: 0, step: 1 }), 'Players are told it\'s ending', SMALL),
        field('Cash for each leftover token ($)', rate, 'Paid when the season ends', SMALL),
        field('Tokens for a hidden place', hidden, 'Once a season, for each hidden place found', SMALL)),
    ];
  }

  // ---------- chapters ----------
  function chaptersPage(entry, sid) {
    const s = entry.season, list = s.chapters ?? (s.chapters = []), total = seasonPoints(S.work, sid);
    const cards = list.map((c, i) => {
      const n = (s.challenges ?? []).filter(x => x.chapter === c.id).length;
      const taken = () => new Set(list.filter(x => x !== c).map(x => x.id));
      const rename = (was, now) => { for (const ch of s.challenges ?? []) if (ch.chapter === was) ch.chapter = now; };
      const idEl = idInput(c, taken, rename), title = h('b', {}, `${i + 1}. ${c.name || 'A new chapter'}`);
      return h('div', { class: 'action' },
        h('div', { class: 'row', style: 'align-items:center' }, title, h('span', { class: 'muted' }, `${n} challenge${n === 1 ? '' : 's'}`),
          (c.unlockAt ?? 0) > total ? badge('opens at more points than the season has', 'banned') : null, spacer(),
          ...moveTools(list, i, drawBody, { what: `the chapter "${c.name || c.id}"`, before: () => confirm(n ? `Remove the chapter "${c.name || c.id}" and its ${n} challenge${n === 1 ? '' : 's'}?` : `Remove the chapter "${c.name || c.id}"?`), after: () => { if (n) s.challenges = s.challenges.filter(x => x.chapter !== c.id); } })),
        h('div', { class: 'row' },
          field('Name', nameInput(c, idEl, nm => uniqueId(slug(nm) || 'chapter', taken()), { onRename: rename, onName: t => { title.textContent = `${i + 1}. ${t || 'A new chapter'}`; } })),
          field('Id', idEl, '', SMALL),
          field('Opens at (points)', num(c, 'unlockAt', { min: 0, step: 10 }), '', SMALL),
          field('Tokens when it\'s all done', num(c, 'milestoneTokens', { min: 0, step: 10 }), 'Paid once, for all its challenges', SMALL)),
        field('About it (shown to players)', area(c, 'blurb', 2)));
    });
    const add = () => {
      const c = { id: uniqueId('new_chapter', new Set(list.map(x => x.id))), name: '', blurb: '', unlockAt: Math.max(0, ...list.map(x => Number(x.unlockAt) || 0)) + 100, milestoneTokens: 100 };
      auto.add(c); list.push(c); S.justAdded = c; changed(); drawBody();
    };
    return [
      h('p', { class: 'muted' }, `Chapters open as a player's season points reach "Opens at" (points come from challenges and Expedition stages and are never spent; one chapter has to open at 0). This season has ${total.toLocaleString('en-GB')} points in all. Players' progress is kept by the ids: change one only before the season starts.`),
      ...cards,
      h('div', {}, h('button', { class: 'btn secondary', onclick: add }, '+ Add a chapter')),
    ];
  }

  // ---------- challenges ----------
  function challengesPage(entry, sid) {
    const s = entry.season, list = s.challenges ?? (s.challenges = []), chapters = s.chapters ?? [];
    const allIds = (o = null) => new Set(Object.values(S.work.seasons ?? {}).flatMap(e => (e?.season?.challenges ?? []).filter(x => x !== o).map(x => x.id)));
    const add = c => {
      const ch = { id: uniqueId(`${prefixOf(sid)}_new_challenge`, allIds()), chapter: c.id, style: 'racing', name: '', description: '', goal: { event: 'race_finished', count: 1 }, points: 50, tokens: 25 };
      auto.add(ch);
      const last = list.findLastIndex(x => x.chapter === c.id);
      list.splice(last < 0 ? list.length : last + 1, 0, ch);
      S.justAdded = ch; changed(); drawBody();
    };
    const orphans = list.filter(x => !chapters.some(c => c.id === x.chapter));
    return [
      h('p', { class: 'muted' }, 'Each challenge listens for one thing the game reports ("Counts when") and is done when that\'s happened enough ("Done when"). Challenges count all season, even in a chapter that\'s still closed: they complete when it opens. Challenge ids are different in every season; players\' progress is kept by them.'),
      ...chapters.map(c => [
        h('h3', {}, `${c.name || c.id} · opens at ${c.unlockAt ?? 0} points`),
        ...list.filter(x => x.chapter === c.id).map(ch => challengeCard(s, sid, ch, allIds)),
        h('div', {}, h('button', { class: 'btn secondary', onclick: () => add(c) }, `+ Add a challenge to ${c.name || c.id}`)),
      ]),
      orphans.length ? [h('h3', {}, 'In no chapter (pick one for each)'), ...orphans.map(ch => challengeCard(s, sid, ch, allIds))] : null,
      chapters.length ? null : h('p', { class: 'muted' }, 'Add a chapter first (the Chapters page).'),
    ];
  }
  function challengeCard(s, sid, ch, allIds) {
    const card = h('div', { class: 'action' });
    const draw = () => {
      const g = isObj(ch.goal) ? ch.goal : (ch.goal = { event: 'race_finished', count: 1 });
      const u = uiOf(ch, () => ({ kind: goalKind(g), rows: whereToRows(g.where) }));
      const info = EVENT_INFO[g.event] ?? { fields: [], hint: '' }, dl = `rb-fields-${++seq}`;
      const idEl = idInput(ch, () => allIds(ch)), title = h('b', {}, ch.name || 'A new challenge');
      const chapters = s.chapters ?? [];
      const chapterSel = h('select', { onchange: e => { ch.chapter = e.target.value; changed(); drawBody(); } },
        ...chapters.map(c => h('option', { value: c.id, selected: c.id === ch.chapter }, c.name || c.id)),
        !chapters.some(c => c.id === ch.chapter) ? h('option', { value: ch.chapter ?? '', selected: true }, `(missing: ${ch.chapter ?? 'none'})`) : null);
      const eventSel = h('select', { onchange: e => { g.event = e.target.value; changed(); draw(); } },
        ...EVENTS.map(ev => h('option', { value: ev, selected: ev === g.event }, EVENT_INFO[ev]?.label ?? ev)),
        !EVENTS.includes(g.event) ? h('option', { value: g.event ?? '', selected: true }, `(unknown: ${g.event})`) : null);
      const kindSel = select(GOAL_KINDS, u.kind, v => { setGoalKind(g, v); u.kind = v; changed(); draw(); });
      const what = (k, attrs) => text(g, k, { list: dl, maxlength: 40, style: MONO, ...attrs });
      const kindInputs = {
        count: [field('How many times', num(g, 'count', { min: 1, step: 1, placeholder: '1' }), '', SMALL)],
        sum: [field('The number to add up', what('sum', { placeholder: 'e.g. metres' }), 'Something the event says', SMALL), field('Target', num(g, 'target', { min: 1, step: 1 }, 'null'), g.sum === 'metres' ? 'In metres: 1 km is 1000' : '', SMALL)],
        unique: [field('Different', what('unique', { placeholder: 'e.g. place' }), 'Something the event says', SMALL), field('How many', num(g, 'count', { min: 1, step: 1 }, 'null'), '', SMALL)],
        streak: [field('How many in a row', num(g, 'streak', { min: 1, step: 1 }, 'null'), 'One that doesn\'t match starts it again', SMALL)],
      }[u.kind];
      card.replaceChildren(
        h('div', { class: 'row', style: 'align-items:center' }, title, h('span', { class: 'muted' }, STYLES[ch.style] ?? ch.style ?? ''), spacer(),
          mini('✕', () => { if (!confirm(`Remove the challenge "${ch.name || ch.id}"?`)) return; s.challenges.splice(s.challenges.indexOf(ch), 1); changed(); drawBody(); }, 'Remove this challenge', 'danger')),
        h('div', { class: 'row' },
          field('Name', nameInput(ch, idEl, nm => uniqueId(`${prefixOf(sid)}_${slug(nm) || 'challenge'}`, allIds(ch)), { onName: t => { title.textContent = t || 'A new challenge'; } })),
          field('Id', idEl, '', SMALL), field('Chapter', chapterSel, '', SMALL), field('Style', select(STYLES, ch.style, v => { ch.style = v; changed(); }), '', SMALL)),
        field('What to do (shown to players)', text(ch, 'description', { maxlength: 200 })),
        h('div', { class: 'row' }, field('Counts when', eventSel), field('Done when', kindSel), ...kindInputs),
        whereEditor(u, g, info, dl),
        h('datalist', { id: dl }, ...info.fields.map(f => h('option', { value: f }))),
        h('div', { class: 'row' }, field('Points', num(ch, 'points', { min: 0, step: 10 }), 'Towards opening chapters', SMALL), field('Season Tokens', num(ch, 'tokens', { min: 0, step: 5 }), '', SMALL)));
    };
    draw();
    return card;
  }
  // (what the event must say: rows of "what = value"; values with commas are a list — any of them)
  function whereEditor(u, g, info, dl) {
    const box = h('div', { class: 'list' });
    const apply = () => { const w = whereFromRows(u.rows); if (w) g.where = w; else delete g.where; changed(); };
    const draw = () => box.replaceChildren(
      h('div', { class: 'muted' }, 'Only when the event says (none: every one counts). Several values with commas: any of them. true, false and numbers are read as such.', info.hint ? ` This event says: ${info.hint}.` : ''),
      ...u.rows.map((r, i) => h('div', { class: 'row', style: 'align-items:center' },
        h('input', { value: r.key, list: dl, maxlength: 40, placeholder: 'e.g. win', 'aria-label': 'What the event says', style: `flex:0 0 180px;${MONO}`, oninput: e => { r.key = e.target.value; apply(); } }),
        h('span', {}, '='),
        h('input', { value: r.value, maxlength: 300, placeholder: 'e.g. true — or gold, silver', 'aria-label': 'Its value', style: 'flex:1;min-width:160px', oninput: e => { r.value = e.target.value; apply(); } }),
        mini('✕', () => { u.rows.splice(i, 1); apply(); draw(); }, 'Remove this condition', 'danger'))),
      h('div', {}, mini('+ Only when…', () => { u.rows.push({ key: '', value: '' }); draw(); }, 'Add a condition', 'secondary')));
    draw();
    return box;
  }

  // ---------- Expeditions ----------
  function expeditionsPage(entry, sid) {
    const s = entry.season, xs = isObj(entry.expeditions) ? entry.expeditions : (entry.expeditions = {});
    const ids = [...new Set([...(s.expeditions ?? []), ...Object.keys(xs)])];
    if (!S.exp || !ids.includes(S.exp)) S.exp = ids[0] ?? null;
    const regions = `rb-regions-${++seq}`;
    const nname = h('input', { placeholder: 'e.g. Harbour Lights', maxlength: 80, oninput: () => { if (!nid.dataset.typed) nid.value = slug(nname.value); } });
    const nid = h('input', { placeholder: 'e.g. harbour_lights', maxlength: 60, style: MONO, oninput: () => { nid.dataset.typed = '1'; } });
    const nregion = h('input', { list: regions, maxlength: 40, placeholder: 'e.g. adelaide', value: xs[S.exp]?.region ?? '' });
    const add = () => {
      const id = nid.value.trim(), err = addExpedition(S.work, sid, id, nname.value, nregion.value);
      if (err) return note(err);
      S.exp = id; changed(); drawBody();
      note(`${nname.value.trim()} is added (and on in this season). Its first stage needs a place: fill it in below.`, true);
    };
    const x = S.exp ? xs[S.exp] : null;
    return [
      h('p', { class: 'muted' }, 'Drives to real places, stage by stage, in order. Each stage pays its points and tokens once. For a place\'s latitude and longitude: in Google Maps, right-click the spot and click the numbers at the top to copy them, then paste them into the Latitude box (it fills both).'),
      h('datalist', { id: regions }, ...[...new Set((S.work.places ?? []).map(p => p.region).filter(Boolean))].map(r => h('option', { value: r }))),
      h('div', { class: 'row', style: 'align-items:center' }, ...ids.map(id => h('button', { class: `btn ${id === S.exp ? 'primary' : 'ghost'}`, onclick: () => { S.exp = id; drawBody(); } }, xs[id]?.name || `${id} (missing!)`)),
        ids.length ? null : h('span', { class: 'muted' }, 'No Expeditions in this season yet.')),
      h('details', {}, h('summary', { style: 'cursor:pointer;color:var(--c-accent)' }, '+ Add an Expedition'),
        h('div', { class: 'row' }, field('Name', nname), field('Id', nid, 'Fixed once made', SMALL), field('Region', nregion, '', SMALL), h('button', { class: 'btn secondary', onclick: add }, 'Add it'))),
      x ? expeditionForm(entry, x, regions)
        : S.exp ? h('div', { class: 'msg bad' }, `The season lists the Expedition "${S.exp}", but it isn't there. `, h('button', { class: 'btn secondary', onclick: () => { s.expeditions = (s.expeditions ?? []).filter(y => y !== S.exp); S.exp = null; changed(); drawBody(); } }, 'Take it off the list')) : null,
    ];
  }
  function expeditionForm(entry, x, regions) {
    const s = entry.season, list = Array.isArray(x.stages) ? x.stages : (x.stages = []);
    const on = (s.expeditions ?? []).includes(x.id);
    const stagesBox = h('div', { class: 'list', style: 'gap:10px' }), totals = h('h3', {});
    const drawStages = () => {
      totals.textContent = `Stages, in order · ${list.reduce((a, st) => a + (Number(st.points) || 0), 0)} points and ${list.reduce((a, st) => a + (Number(st.tokens) || 0), 0)} tokens in all`;
      stagesBox.replaceChildren(...list.map((st, i) => stageCard(x, st, i, drawStages)),
        h('div', {}, h('button', { class: 'btn secondary', onclick: () => {
          const st = { id: uniqueId('new_stage', new Set(list.map(y => y.id))), type: 'reach', name: '', text: '', location: { radius: 50 }, points: 50, tokens: 100 };
          auto.add(st); list.push(st); S.justAdded = st; changed(); drawStages(); focusNew();
        } }, '+ Add a stage')));
    };
    drawStages();
    return h('div', { class: 'list', style: 'gap:10px' },
      h('div', { class: 'row', style: 'align-items:center' },
        h('label', { style: TICK }, h('input', { type: 'checkbox', checked: on, style: 'width:auto', onchange: e => {
          const l = Array.isArray(s.expeditions) ? s.expeditions : (s.expeditions = []), k = l.indexOf(x.id);
          if (e.target.checked && k < 0) l.push(x.id);
          if (!e.target.checked && k >= 0) l.splice(k, 1);
          changed();
        } }), 'On in this season (players can start it)'),
        spacer(),
        h('button', { class: 'btn danger', onclick: () => {
          if (!confirm(`Remove the Expedition "${x.name || x.id}" from this season?`)) return;
          delete entry.expeditions[x.id]; s.expeditions = (s.expeditions ?? []).filter(y => y !== x.id); S.exp = null; changed(); drawBody();
        } }, 'Remove this Expedition')),
      h('div', { class: 'row' }, field('Name', text(x, 'name', { maxlength: 80 })), field('Id', h('input', { value: x.id ?? '', readonly: true, style: MONO }), 'Fixed once made', SMALL), field('Region', text(x, 'region', { list: regions, maxlength: 40 }), '', SMALL)),
      field('The story (shown before it starts)', area(x, 'blurb', 3)),
      field('Time of day while players are on it', timeSelect(x, 'timeOfDay', 'The player\'s own time'), 'Their world is set to this from the moment they start it until it\'s done (not during races). A stage can have a time of its own below.'),
      totals, stagesBox);
  }
  function stageCard(x, st, i, redrawList) {
    const list = x.stages, card = h('div', { class: 'action' });
    const draw = () => {
      const taken = () => new Set(list.filter(y => y !== st).map(y => y.id));
      const idEl = idInput(st, taken), title = h('b', {}, `${i + 1}. ${st.name || 'A new stage'}`);
      const typeSel = select(STAGE_TYPES, st.type, v => { setStageType(st, v, uiOf(st, () => ({ stash: {} })).stash); changed(); draw(); });
      card.replaceChildren(
        h('div', { class: 'row', style: 'align-items:center' }, title, tick(st, 'finale', 'The finale (the last stage)'), spacer(), ...moveTools(list, i, redrawList, { what: `the stage "${st.name || st.id}"` })),
        h('div', { class: 'row' },
          field('Name', nameInput(st, idEl, nm => uniqueId(slug(nm) || 'stage', taken()), { onName: t => { title.textContent = `${i + 1}. ${t || 'A new stage'}`; } })),
          field('Id', idEl, '', SMALL), field('Kind', typeSel)),
        field('What the player is told', area(st, 'text', 2)),
        ...stageFields(st),
        field('Time of day for this stage', timeSelect(st, 'timeOfDay', 'The Expedition\'s time'), 'Leave it as the Expedition\'s, or give this stage its own (dawn for the finale, say)'),
        h('div', { class: 'row' }, field('Points', num(st, 'points', { min: 0, step: 10 }), '', SMALL), field('Season Tokens', num(st, 'tokens', { min: 0, step: 10 }), '', SMALL)));
    };
    draw();
    return card;
  }
  function stageFields(st) {
    const loc = () => isObj(st.location) ? st.location : (st.location = { radius: 50 });
    if (st.type === 'reach') return [h('div', { class: 'muted' }, 'Where to drive to (its marker shows there):'), spotRow(loc(), 50)];
    if (st.type === 'clue') return [
      field('The clue', area(st, 'clue', 2)), field('A hint (shown later)', area(st, 'hint', 2)),
      h('div', { class: 'row' }, field('Hint after (minutes)', num(st, 'hintAfterMin', { min: 0, step: 1 }), '', SMALL), field('Marker shows within (metres)', num(st, 'revealWithin', { min: 0, step: 10 }), 'No marker until this close', SMALL)),
      h('div', { class: 'muted' }, 'The place the clue leads to:'), spotRow(loc(), 50)];
    if (st.type === 'collect') {
      const items = Array.isArray(st.items) ? st.items : (st.items = []), box = h('div', { class: 'list' });
      const drawItems = () => {
        box.replaceChildren(...items.map((it, k) => {
          const taken = () => new Set(items.filter(y => y !== it).map(y => y.id)), idEl = idInput(it, taken), c = coordInputs(it);
          return h('div', { class: 'row' },
            field(`Thing ${k + 1}`, nameInput(it, idEl, nm => uniqueId(slug(nm) || 'item', taken()))), field('Id', idEl, '', SMALL),
            field('Latitude', c.lat, '', SMALL), field('Longitude', c.lon, '', SMALL), c.link,
            mini('✕', () => { items.splice(k, 1); changed(); drawItems(); }, 'Remove it', 'danger'));
        }), h('div', {}, mini('+ Something to pick up', () => {
          const it = { id: uniqueId('item', new Set(items.map(y => y.id))), name: '' };
          auto.add(it); items.push(it); S.justAdded = it; changed(); drawItems(); focusNew();
        }, 'Add something to pick up', 'secondary')));
      };
      drawItems();
      return [h('div', { class: 'row' }, field('Pick-up radius (metres)', num(st, 'radius', { min: 1, step: 5, placeholder: '25' }), 'How close counts as picking it up', SMALL)), h('div', { class: 'muted' }, 'What to pick up (in any order):'), box];
    }
    if (st.type === 'checkpoints') {
      const cps = Array.isArray(st.checkpoints) ? st.checkpoints : (st.checkpoints = []), box = h('div', { class: 'list' });
      const drawCps = () => box.replaceChildren(...cps.map((c, k) => {
        const ci = coordInputs(c);
        return h('div', { class: 'row', style: 'align-items:center' }, h('b', { style: 'flex:0 0 110px' }, k === 0 ? 'Start' : k === cps.length - 1 ? 'Finish' : `Checkpoint ${k}`),
          h('span', { style: 'flex:1 1 120px' }, ci.lat), h('span', { style: 'flex:1 1 120px' }, ci.lon), ci.link, ...moveTools(cps, k, drawCps, { what: 'this checkpoint', ask: false }));
      }), h('div', {}, mini('+ A checkpoint', () => { cps.push({}); changed(); drawCps(); }, 'Add a checkpoint', 'secondary')));
      drawCps();
      return [h('div', { class: 'row' }, field('Checkpoint radius (metres)', num(st, 'radius', { min: 1, step: 5, placeholder: '30' }), '', SMALL), field('Time limit (seconds)', num(st, 'timeLimitSec', { min: 1, step: 5 }), 'Start to finish; late, and it starts again', SMALL)),
        h('div', { class: 'muted' }, 'In order: the first is the start, the last the finish (latitude, longitude).'), box];
    }
    return [h('div', { class: 'msg bad' }, `There's no stage kind "${st.type}": pick one above.`)];
  }

  // ---------- the shop ----------
  function shopPage(entry, sid) {
    const shop = isObj(entry.shop) ? entry.shop : (entry.shop = { season: sid, items: [] }), list = Array.isArray(shop.items) ? shop.items : (shop.items = []);
    const allIds = (o = null) => new Set(Object.values(S.work.seasons ?? {}).flatMap(e => (e?.shop?.items ?? []).filter(x => x !== o).map(x => x.id)));
    const add = () => {
      const it = { id: uniqueId(`${prefixOf(sid)}_new_item`, allIds()), name: '', description: '', price: 100, icon: 'redeem', grants: {} };
      auto.add(it); list.push(it); S.justAdded = it; changed(); drawBody();
    };
    return [
      h('p', { class: 'muted' }, 'Bought with Season Tokens, each once, and kept for good (in every later season too). Looks only: nothing here changes how a car drives. Item ids are different in every season; what players own is kept by them.'),
      ...list.map((it, i) => shopCard(list, it, i, allIds)),
      h('div', {}, h('button', { class: 'btn secondary', onclick: add }, '+ Add an item')),
    ];
  }
  function shopCard(list, it, i, allIds) {
    const u = uiOf(it, () => ({ rows: grantsToRows(it.grants) }));
    const idEl = idInput(it, () => allIds(it)), title = h('b', {}, it.name || 'A new item');
    const preview = h('span', { class: 'icon', style: 'font-size:28px;width:32px;color:var(--c-accent)', 'aria-hidden': 'true' }, it.icon ?? '');
    const icon = h('input', { value: it.icon ?? '', maxlength: 60, placeholder: 'e.g. format_paint', style: MONO, oninput: e => { it.icon = e.target.value.trim(); preview.textContent = it.icon; changed(); } });
    const grants = h('div', { class: 'list' });
    const apply = () => { it.grants = grantsFromRows(u.rows); changed(); };
    const drawGrants = () => grants.replaceChildren(
      ...u.rows.map((r, k) => h('div', { class: 'row', style: 'align-items:center' },
        select(GRANT_KINDS, r.key, v => { r.key = v; apply(); }),
        h('input', { value: r.value, maxlength: 500, style: `flex:1;min-width:200px;${MONO}`, placeholder: 'ids, with commas: e.g. midnight_metallic, violet_chrome', 'aria-label': 'Which', oninput: e => { r.value = e.target.value; apply(); } }),
        mini('✕', () => { u.rows.splice(k, 1); apply(); drawGrants(); }, 'Remove this', 'danger'))),
      h('div', {}, mini('+ Something it unlocks', () => { u.rows.push({ key: 'finishes', value: '' }); drawGrants(); }, 'Add something it unlocks', 'secondary')));
    drawGrants();
    return h('div', { class: 'action' },
      h('div', { class: 'row', style: 'align-items:center' }, preview, title, spacer(), ...moveTools(list, i, drawBody, { what: `the item "${it.name || it.id}"` })),
      h('div', { class: 'row' },
        field('Name', nameInput(it, idEl, nm => uniqueId(`${prefixOf(S.sid)}_${slug(nm) || 'item'}`, allIds(it)), { onName: t => { title.textContent = t || 'A new item'; } })),
        field('Id', idEl, '', SMALL),
        field('Price (Season Tokens)', num(it, 'price', { min: 1, step: 10 }), 'A whole number', SMALL),
        field('Icon', icon, h('a', { href: 'https://fonts.google.com/icons', target: '_blank', rel: 'noopener noreferrer' }, 'Find icons (Material Symbols)'), SMALL)),
      field('About it (shown in the shop)', area(it, 'description', 2)),
      h('div', { class: 'muted' }, 'What owning it unlocks — finishes: paint, part or rim finishes only owners can use (data/finishes.json); photo filters: photo mode\'s; badges: shown on the profile card.'),
      grants);
  }

  // ---------- places ----------
  function placesPage() {
    const list = Array.isArray(S.work.places) ? S.work.places : (S.work.places = []);
    const reward = S.work.seasons?.[S.sid]?.season?.discoveries?.hiddenTokens ?? 0, regions = `rb-regions-${++seq}`;
    const tbody = h('tbody');
    const filter = h('input', { type: 'search', placeholder: 'A name, id or region', value: S.placeFilter, oninput: e => { S.placeFilter = e.target.value; applyFilter(); } });
    const applyFilter = () => { const q = S.placeFilter.trim().toLowerCase(); for (const tr of tbody.children) tr.hidden = !!q && !tr.dataset.text.includes(q); };
    tbody.replaceChildren(...list.map(p => {
      const taken = () => new Set(list.filter(x => x !== p).map(x => x.id)), idEl = idInput(p, taken), c = coordInputs(p);
      idEl.style.width = '100%';
      return h('tr', { 'data-text': `${p.name ?? ''} ${p.id ?? ''} ${p.region ?? ''}`.toLowerCase() },
        h('td', {}, nameInput(p, idEl, nm => uniqueId(`${regionPrefix(list, p.region)}_${slug(nm) || 'place'}`, taken()))),
        h('td', {}, idEl),
        h('td', {}, text(p, 'region', { list: regions, maxlength: 40, style: 'width:110px' })),
        h('td', {}, c.lat), h('td', {}, c.lon),
        h('td', {}, num(p, 'radius', { min: 1, step: 5, placeholder: '60', style: 'width:80px' })),
        h('td', {}, h('input', { type: 'checkbox', checked: !!p.hidden, style: 'width:auto', 'aria-label': 'Hidden', onchange: e => { if (e.target.checked) p.hidden = true; else delete p.hidden; changed(); } })),
        h('td', { style: 'white-space:nowrap' }, c.link, ' ', mini('✕', () => { if (!confirm(`Remove the place "${p.name || p.id}"?`)) return; list.splice(list.indexOf(p), 1); changed(); drawBody(); }, 'Remove this place', 'danger')));
    }));
    applyFilter();
    const add = () => {
      const region = list.at(-1)?.region ?? '';
      const p = { id: uniqueId(`${regionPrefix(list, region)}_new_place`, new Set(list.map(x => x.id))), name: '', region, radius: 60 };
      auto.add(p); list.push(p); S.justAdded = p; S.placeFilter = ''; changed(); drawBody();
    };
    return [
      h('p', { class: 'muted' }, `Places players discover by driving to them, each found once, for good. They're shared by every season. Hidden places aren't on the map until found${reward ? `, and pay ${reward} tokens in this season` : ''}. Paste "latitude, longitude" into a Latitude box to fill both.`),
      h('datalist', { id: regions }, ...[...new Set(list.map(p => p.region).filter(Boolean))].map(r => h('option', { value: r }))),
      h('div', { class: 'row' }, field('Show only', filter), h('button', { class: 'btn secondary', onclick: add }, '+ Add a place')),
      h('div', { style: 'overflow-x:auto' }, h('table', {}, h('thead', {}, h('tr', {}, ...['Name', 'Id', 'Region', 'Latitude', 'Longitude', 'Radius (m)', 'Hidden', ''].map(t => h('th', {}, t)))), tbody)),
    ];
  }

  // ---------- raw JSON ----------
  function rawPage() {
    const ta = h('textarea', { rows: 32, spellcheck: false, style: 'width:100%;font:12px var(--f-mono)', oninput: e => { S.raw = e.target.value; S.rawDirty = true; changed(); } });
    ta.value = S.rawDirty && S.raw != null ? S.raw : JSON.stringify(S.work, null, 2);
    return [
      h('p', { class: 'muted' }, 'Everything the forms edit, as the server keeps it: every season (its settings, shop and Expeditions) and the places. For anything the forms don\'t cover. What you change here is read when you save or open another page.'),
      ta,
      h('div', { class: 'row' }, h('button', { class: 'btn secondary', onclick: () => { if (applyRaw()) { note('Read: the forms show it now.', true); drawEditor(); } } }, 'Use this in the forms'),
        h('button', { class: 'btn ghost', onclick: () => { S.raw = null; S.rawDirty = false; drawEditor(); } }, 'Put it back as the forms have it')),
    ];
  }
  // (the raw JSON read into the working copy; false when it isn't valid)
  function applyRaw() {
    if (!S.rawDirty) return true;
    let v;
    try { v = JSON.parse(S.raw ?? ''); } catch (e) { note(`The raw JSON isn't valid: ${e.message}`); return false; }
    if (!isObj(v) || !isObj(v.seasons)) { note('The raw JSON needs "current", "seasons" and "places".'); return false; }
    S.work = v; S.raw = null; S.rawDirty = false;
    return true;
  }

  // ---------- checks, changes, saving ----------
  function refresh() { if (E && S.work) { drawProblems(); drawSave(); } }
  function drawProblems() {
    let data = S.work, rawBad = false;
    if (S.rawDirty) { try { data = JSON.parse(S.raw ?? ''); } catch { rawBad = true; } }
    const { problems: probs, warnings: warns } = rawBad ? { problems: ['The raw JSON isn\'t valid JSON.'], warnings: [] } : checkBundle(data);
    const ul = list => h('ul', { style: 'margin:6px 0 0;padding-left:20px' }, ...list.map(p => h('li', {}, p)));
    const sp = S.serverProblems;
    E.problems.replaceChildren(
      sp ? h('div', { class: 'msg bad' }, h('b', {}, 'The server didn\'t take it (your last try to save): '), sp.message, sp.details?.length ? ul(sp.details.map(d => d.path ? `${d.path}: ${d.message}` : d.message)) : '') : '',
      probs.length ? h('div', { class: 'msg bad' }, h('b', {}, `To fix before it can be saved (${probs.length}):`), ul(probs)) : '',
      warns.length ? h('div', { class: 'msg', style: 'background:var(--c-warn-tint);color:var(--c-warn)' }, h('b', {}, `Worth a look (${warns.length}):`), ul(warns)) : '');
  }
  function drawSave() {
    const list = S.rawDirty ? null : changes(), n = list?.length ?? 0;
    E.count.textContent = S.rawDirty ? 'The raw JSON is changed: it\'s read when you save' : n ? `${n} change${n === 1 ? '' : 's'} not saved yet` : 'Nothing changed yet';
    E.count.style.color = n || S.rawDirty ? 'var(--c-warn)' : 'var(--c-text-3)';
    E.saveBtn.disabled = !n && !S.rawDirty;
    E.toggle.hidden = !n; E.undo.hidden = !n && !S.rawDirty;
    E.toggle.textContent = S.showChanges ? 'Hide what changed' : 'Show what changed';
    E.changes.replaceChildren(S.showChanges && n ? h('div', { class: 'action', style: 'max-height:35vh;overflow:auto' },
      h('ul', { style: `margin:0;padding-left:20px;${MONO}` }, ...list.slice(0, 300).map(d => h('li', { style: d.path[0] === 'current' ? 'color:var(--c-warn)' : null }, describeChange(d)))),
      list.length > 300 ? h('div', { class: 'muted' }, `…and ${list.length - 300} more`) : '') : '');
    E.moved.replaceChildren(S.base && S.live && S.base.version !== S.live.version && unsaved()
      ? h('div', { class: 'msg bad' }, `Version ${S.live.version} went live after you started (yours is based on version ${S.base.version}): saving yours would be refused. Look at theirs first.`,
        h('div', { class: 'row', style: 'margin-top:8px' }, reloadButton(), copyButton())) : '');
  }
  const reloadButton = () => h('button', { class: 'btn secondary', onclick: async () => {
    if (!confirm('Load the version that\'s live now? Your changes here are dropped (copy them first if you want them).')) return;
    await load({ fresh: true }); say(E.saveMsg, 'The live version is loaded.', true);
  } }, 'Load the live version');
  const copyButton = () => h('button', { class: 'btn ghost', onclick: async e => {
    const json = S.rawDirty && S.raw != null ? S.raw : JSON.stringify(S.work, null, 2);
    try { await navigator.clipboard.writeText(json); e.target.textContent = 'Copied'; }
    catch { E.saveMsg.replaceChildren(h('textarea', { rows: 10, readonly: true, style: 'width:100%;font:12px var(--f-mono)' }, json)); }
  } }, 'Copy my changes (as JSON)');
  function undoAll() {
    if (!confirm('Drop all your changes here and go back to the live version?')) return;
    S.base = S.live; S.work = clone(S.live.data); S.raw = null; S.rawDirty = false; S.serverProblems = null; S.showChanges = false;
    say(E.saveMsg, ''); note('Back to the live version.', true);
    drawEditor();
  }
  async function save() {
    if (!applyRaw()) return say(E.saveMsg, 'The raw JSON isn\'t valid: fix it first.');
    const data = cleanBundle(S.work), list = diffPaths(S.base.data, data);
    if (!list.length) { drawSave(); return say(E.saveMsg, 'Nothing has changed.'); }
    const { problems: probs, warnings: warns } = checkBundle(data);
    if (probs.length) { drawProblems(); E.problems.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return say(E.saveMsg, `Fix the ${probs.length} thing${probs.length === 1 ? '' : 's'} listed above the form first: the server won't take it as it is.`); }
    const why = E.reason.value.trim();
    if (why.length < 3) { E.reason.focus(); return say(E.saveMsg, 'Say why first (a few words): it goes in the history.'); }
    const switching = data.current !== S.base.data.current;
    let text = `Save these ${list.length} change${list.length === 1 ? '' : 's'} as a new version? They're live for every player at once.`;
    if (switching) text += `\n\nThe current season changes from ${S.base.data.current} to ${data.current}: every player's ROADBOOK switches to it.`;
    if (warns.length) text += `\n\n${warns.length} thing${warns.length === 1 ? '' : 's'} look${warns.length === 1 ? 's' : ''} wrong (listed above the form, in yellow). Save anyway?`;
    if (!confirm(text)) return;
    E.saveBtn.disabled = true;
    try {
      const r = await api.post(`${P}/config`, { data, reason: why, basedOn: S.base.version });
      S.serverProblems = null; E.reason.value = ''; S.showChanges = false;
      await load({ fresh: true });
      say(E.saveMsg, `Saved as version ${r.version}: live now.`, true);
    } catch (e) {
      E.saveBtn.disabled = false;
      if (e.status === 409 || e.code === 'CONFLICT') {
        E.saveMsg.replaceChildren(h('div', { class: 'msg bad' }, `Someone else changed the ROADBOOK while you were editing: ${e.message}`, h('div', { class: 'row', style: 'margin-top:8px' }, reloadButton(), copyButton())));
        return load();   // (the newer version and its history shown; your changes kept until you load it)
      }
      if (e.code === 'VALIDATION' || e.status === 400) {
        S.serverProblems = { message: e.message, details: Array.isArray(e.details) ? e.details : [] };
        drawProblems(); E.problems.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return say(E.saveMsg, 'The server found problems: they\'re listed above the form.');
      }
      say(E.saveMsg, errText(e));
    }
  }

  // ---------- versions ----------
  function drawVersions() {
    const vs = S.versions ?? [];
    E.versions.replaceChildren(vs.length ? h('table', {},
      h('thead', {}, h('tr', {}, ...['Version', 'When', 'Who', 'Why', ''].map(t => h('th', {}, t)))),
      h('tbody', {}, ...vs.map(v => h('tr', {},
        h('td', {}, String(v.version), v.active ? h('b', { style: 'color:var(--c-good)' }, ' live') : '', v.basedOn ? h('div', { class: 'muted' }, `from ${v.basedOn}`) : ''),
        h('td', { class: 'when' }, when(v.createdAt)), h('td', {}, v.actor ?? v.actorId ?? 'the game\'s files'), h('td', {}, v.reason ?? ''),
        h('td', { style: 'white-space:nowrap' }, h('button', { class: 'btn ghost', onclick: () => viewVersion(v.version) }, 'View'),
          v.active ? '' : h('button', { class: 'btn ghost', onclick: () => rollback(v) }, 'Roll back to this')))))) : h('p', { class: 'muted' }, 'No versions yet.'));
  }
  async function viewVersion(version) {
    E.view.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
    let r;
    try { r = await api.get(`${P}/versions/${version}`); } catch (e) { return E.view.replaceChildren(h('div', { class: 'msg bad' }, errText(e))); }
    const d = diffPaths(r.data, S.live.data);
    E.view.replaceChildren(h('div', { class: 'action' },
      h('div', { class: 'row', style: 'align-items:center' }, h('b', {}, `Version ${r.version}`), h('span', { class: 'muted' }, `${when(r.createdAt)} · ${r.reason ?? ''}`), spacer(), h('button', { class: 'btn ghost', onclick: () => E.view.replaceChildren() }, 'Close')),
      r.version === S.live.version ? h('p', { class: 'muted' }, 'This is the live version.')
        : h('details', {}, h('summary', { style: 'cursor:pointer' }, d.length ? `How the live version (${S.live.version}) is different from it: ${d.length} change${d.length === 1 ? '' : 's'}` : `The live version (${S.live.version}) is the same as it.`),
          h('ul', { style: `margin:6px 0 0;padding-left:20px;${MONO}` }, ...d.slice(0, 300).map(x => h('li', {}, describeChange(x))))),
      h('textarea', { rows: 24, readonly: true, spellcheck: false, style: 'width:100%;font:12px var(--f-mono)' }, JSON.stringify(r.data, null, 2))));
    E.view.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  async function rollback(v) {
    if (unsaved() && !confirm('You have changes here that aren\'t saved: rolling back drops them. Go on?')) return;
    const why = ask(`Roll back to version ${v.version} (${v.reason ?? ''})?\n\nEvery season, chapter, challenge, Expedition, shop item and place goes back to how it was then, as a new version, live at once. Players' progress and tokens stay as they are.`);
    if (!why) return;
    try {
      const r = await api.post(`${P}/rollback`, { version: v.version, reason: why });
      await load({ fresh: true });
      say(E.verMsg, `Back to version ${v.version}'s settings (saved as version ${r.version}): live now.`, true);
    } catch (e) {
      E.verMsg.replaceChildren(h('div', { class: 'msg bad' }, errText(e), Array.isArray(e.details) && e.details.length > 1 ? h('ul', { style: 'margin:6px 0 0;padding-left:20px' }, ...e.details.map(d => h('li', {}, d.message))) : ''));
    }
  }

  // ---------- Season Tokens for a player ----------
  function drawTokens() {
    const msg = h('div'), found = h('div', { class: 'list' });
    let pickedName = null;
    const find = h('input', { type: 'search', placeholder: 'Name, email or id', maxlength: 100 });
    const id = h('input', { placeholder: 'Their id', maxlength: 80, style: MONO, oninput: () => { pickedName = null; } });
    const amount = h('input', { type: 'number', step: 1, placeholder: 'e.g. 100, or -100 to take' });
    const why = h('input', { placeholder: 'Why (required: it goes in the log)', maxlength: 500 });
    const search = async () => {
      const q = find.value.trim();
      if (!q) return;
      try {
        const r = await api.get(`/admin/players?q=${encodeURIComponent(q)}&limit=8`);
        found.replaceChildren(...(r.players.length ? r.players.map(p => h('button', { class: 'player', onclick: () => { id.value = p.id; pickedName = p.displayName; found.replaceChildren(h('div', { class: 'muted' }, `Picked ${p.displayName}.`)); } },
          h('span', { class: 'name' }, p.displayName), h('span', { class: 'mail' }, p.isGuest ? 'guest' : p.email ?? ''))) : [h('p', { class: 'muted' }, 'Nobody matches that.')]));
      } catch (e) { say(msg, errText(e)); }
    };
    find.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
    const go = async () => {
      const pid = id.value.trim(), n = Number(amount.value), r = why.value.trim();
      if (!pid) return say(msg, 'Which player? Find them, or paste their id.');
      if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 100000) return say(msg, 'The amount is a whole number, not 0, up to 100,000 (a minus takes tokens away).');
      if (r.length < 3) return say(msg, 'Say why first (a few words): it goes in the log.');
      if (!confirm(`${n > 0 ? 'Give' : 'Take'} ${Math.abs(n).toLocaleString('en-GB')} Season Tokens ${n > 0 ? 'to' : 'from'} ${pickedName ?? pid}?`)) return;
      try {
        const res = await api.post(`/admin/players/${encodeURIComponent(pid)}/tokens`, { amount: n, reason: r });
        say(msg, res.done === false ? `That was done already: they have ${res.tokens} Season Tokens.` : `Done: they have ${res.tokens} Season Tokens now.`, true);
        amount.value = ''; why.value = '';
      } catch (e) { say(msg, errText(e)); }
    };
    E.tokens.replaceChildren(
      h('p', { class: 'muted' }, 'In the current season. It goes in their token history and the admins\' log with your reason.'),
      h('div', { class: 'row' }, field('Find a player', find), h('button', { class: 'btn secondary', onclick: search }, 'Find')), found,
      h('div', { class: 'row' }, field('Player id', id), field('Season Tokens', amount, 'A minus takes them away', SMALL), field('Why', why), h('button', { class: 'btn primary', onclick: go }, 'Give or take')),
      msg);
  }

  return { showRoadbook };
}
