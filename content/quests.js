// World content's kinds and quest types: what each is, what a new one starts as, what it's worth (from
// the economy's rules, data/economy.json quests — a quest never stores money), and what it still needs,
// in plain words (the editor's properties panel shows them; errors stop publishing, warnings don't).
// Pure: the editor, the game, the tests and a server use it alike.
//
//   newItem(kind, { id, location, author, now, type }) → a draft item
//   rewardsOf(item, economy) → { money, xp, fee, tier, … }        feeOf(item, economy)   tierOf(item, economy)
//   problems(item, { economy, classes, cars }) → [{ field, level: 'error' | 'warning', message }]
//   entryCheck(item, car: { className, kw, kg }, level) → [{ ok, text }]
//
// A route (kind 'route', Phase 4 Step 2) is content too: the line a quest is driven along, its grid and
// checkpoints (its `course`: route/model.js). A quest names its route by id; one route can serve several
// quests. problems(quest, { route }) checks the two fit (a loop for laps, a point-to-point for a delivery).

import { newRoute } from '../route/model.js';

export const CONTENT_VERSION = 4;

export const KINDS = {
  quest: { label: 'Quest start', icon: 'flag', colour: '#ffb02e' },
  poi: { label: 'Point of interest', icon: 'star', colour: '#4fc3f7' },
  spawn: { label: 'Spawn point', icon: 'car', colour: '#7ee08a' },
  route: { label: 'Route', icon: 'route', colour: '#e05cff' },
  series: { label: 'Quest series', icon: 'series', colour: '#ffd166' },
};
// the kinds players see as markers (a route is seen through its quests)
export const MARKER_KINDS = ['quest', 'poi', 'spawn'];

// Each quest type: its name, its own fields (params: their defaults, and how the editor shows them), and
// what it must have before it can be published
export const TYPES = {
  sprint: {
    label: 'Sprint', icon: 'flag', blurb: 'From the start to a finish line, first one there wins.',
    params: { finish: null, laps: 1 },
    fields: [{ key: 'finish', label: 'Finish line (no route)', kind: 'place' }, { key: 'laps', label: 'Laps (a loop route)', kind: 'int', min: 1, max: 50 }],
    check: (p, ctx) => [
      ...(p.finish || ctx.route ? [] : [err('params.finish', 'Sprint needs a route (or a finish line).')]),
      ...laps(p),
    ],
  },
  time_trial: {
    label: 'Time trial', icon: 'timer', blurb: 'Against the clock: beat the target time.',
    params: { finish: null, laps: 1, targetSeconds: null },
    fields: [{ key: 'finish', label: 'Finish line (no route)', kind: 'place' }, { key: 'laps', label: 'Laps (a loop route)', kind: 'int', min: 1, max: 50 }, { key: 'targetSeconds', label: 'Target time (s)', kind: 'number', min: 1 }],
    check: (p, ctx) => [
      ...(p.finish || ctx.route ? [] : [err('params.finish', 'Time trial needs a route (or a finish line: put it on the start for a lap).')]),
      ...(p.targetSeconds > 0 ? [] : [err('params.targetSeconds', 'Time trial needs a target time.')]),
      ...laps(p),
    ],
  },
  checkpoint: {
    label: 'Checkpoint run', icon: 'checkpoint', blurb: 'Through every checkpoint in order before time runs out.',
    params: { checkpoints: [], timeLimitSeconds: null, laps: 1 },
    fields: [{ key: 'checkpoints', label: 'Checkpoints (no route)', kind: 'places' }, { key: 'timeLimitSeconds', label: 'Time limit (s)', kind: 'number', min: 1 }, { key: 'laps', label: 'Laps (a loop route)', kind: 'int', min: 1, max: 50 }],
    check: (p, ctx) => [
      ...(ctx.route ? (ctx.route.unknown || (ctx.route.course?.checkpoints?.length ?? 0) >= 2 ? [] : [err('route', `Checkpoint run needs a route with at least 2 checkpoints (it has ${ctx.route.course?.checkpoints?.length ?? 0}).`)])
        : (p.checkpoints?.length ?? 0) >= 2 ? [] : [err('params.checkpoints', `Checkpoint run needs at least 2 checkpoints (it has ${p.checkpoints?.length ?? 0}).`)]),
      ...laps(p),
      ...(p.timeLimitSeconds > 0 ? [] : [err('params.timeLimitSeconds', 'Checkpoint run needs a time limit.')]),
    ],
  },
  drift: {
    label: 'Drift', icon: 'drift', blurb: 'Score drift points: reach the target.',
    params: { scoreTarget: null, timeLimitSeconds: null },
    fields: [{ key: 'scoreTarget', label: 'Score target', kind: 'int', min: 1 }, { key: 'timeLimitSeconds', label: 'Time limit (s, optional)', kind: 'number', min: 1 }],
    check: p => p.scoreTarget > 0 ? [] : [err('params.scoreTarget', 'Drift needs a score target.')],
  },
  delivery: {
    label: 'Delivery', icon: 'box', blurb: 'Carry the cargo to its destination: damage costs you.',
    params: { cargo: { name: '', massKg: 50, fragile: false }, destination: null, damagePenalty: 0.5, timeLimitSeconds: null },
    fields: [{ key: 'cargo.name', label: 'Cargo', kind: 'text' }, { key: 'cargo.massKg', label: 'Cargo mass (kg)', kind: 'number', min: 0 }, { key: 'cargo.fragile', label: 'Fragile', kind: 'bool' },
      { key: 'destination', label: 'Destination', kind: 'place' }, { key: 'damagePenalty', label: 'Reward lost at full damage (0–1)', kind: 'number', min: 0, max: 1 }, { key: 'timeLimitSeconds', label: 'Time limit (s, optional)', kind: 'number', min: 1 }],
    check: (p, ctx) => [
      ...(p.destination || ctx.route ? [] : [err('params.destination', 'Delivery needs a route (or a destination).')]),
      ...(p.cargo?.name?.trim() ? [] : [err('params.cargo.name', 'Delivery needs cargo: say what\'s carried.')]),
      ...(p.damagePenalty >= 0 && p.damagePenalty <= 1 ? [] : [err('params.damagePenalty', 'The damage penalty is a share of the reward, from 0 to 1.')]),
    ],
  },
  pink_slip: {
    label: 'Pink slip', icon: 'keys', blurb: 'Race for keeps: the winner takes the loser\'s car.',
    params: { opponentCar: null, finish: null },
    fields: [{ key: 'opponentCar', label: 'Rival\'s car', kind: 'car' }, { key: 'finish', label: 'Finish line', kind: 'place' }],
    check: (p, ctx) => [
      ...(p.opponentCar ? (ctx.cars && !ctx.cars[p.opponentCar] ? [err('params.opponentCar', `There's no car "${p.opponentCar}".`)] : []) : [err('params.opponentCar', 'Pink slip needs the rival\'s car.')]),
      ...(p.finish || ctx.route ? [] : [err('params.finish', 'Pink slip needs a route (or a finish line).')]),
    ],
  },
};
export const TYPE_IDS = Object.keys(TYPES);
export const TIMES = ['any', 'dawn', 'day', 'dusk', 'night'], WEATHER = ['any', 'clear', 'cloudy', 'rain', 'fog'];

function err(field, message) { return { field, level: 'error', message }; }
function laps(p) { return p.laps === undefined || (Number.isInteger(p.laps) && p.laps >= 1) ? [] : [err('params.laps', 'Laps must be a whole number, at least 1.')]; }
// what each type of quest needs of its route: a point-to-point one (a delivery goes somewhere), or either
export const ROUTE_KINDS = { sprint: ['p2p', 'loop'], time_trial: ['p2p', 'loop'], checkpoint: ['p2p', 'loop'], drift: ['p2p', 'loop'], delivery: ['p2p'], pink_slip: ['p2p', 'loop'] };
function warn(field, message) { return { field, level: 'warning', message }; }
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));

export function newItem(kind, { id, location, author = 'editor', now = new Date().toISOString(), type = 'sprint', name, region = null, routeKind = 'p2p' } = {}) {
  if (!KINDS[kind]) throw new Error(`no kind of content "${kind}"`);
  const item = {
    id, version: CONTENT_VERSION, kind, name: name ?? (kind === 'quest' ? `New ${TYPES[type].label.toLowerCase()}` : `New ${KINDS[kind].label.toLowerCase()}`),
    description: '', icon: kind === 'quest' ? TYPES[type].icon : KINDS[kind].icon,
    location: { lat: location.lat, lon: location.lon, alt: location.alt ?? 0, heading: location.heading ?? 0, ...(location.altFrom ? { altFrom: location.altFrom } : {}) },
    road: null, status: 'draft', author, created: now, updated: now, publishedAt: null,
  };
  if (kind === 'quest') Object.assign(item, {
    type, route: null, entry: { classes: [], maxPowerKw: null, minWeightKg: null, maxWeightKg: null, maxKwPerTonne: null, minLevel: 1 },
    rating: null, npc: {}, conditions: { timeOfDay: 'any', weather: 'any' }, enabled: true, params: clone(TYPES[type].params),
  });
  if (kind === 'route') item.course = newRoute(region, routeKind);
  if (kind === 'series') item.quests = [];
  return item;
}

// A quest switched to another type: its own fields become the new type's (what they share is kept)
export function withType(item, type) {
  const params = clone(TYPES[type].params);
  for (const k of Object.keys(params)) if (item.params?.[k] !== undefined) params[k] = clone(item.params[k]);
  return { ...item, type, icon: TYPES[type].icon, params };
}

// The lowest class a quest lets in (any car: the lowest class there is): the rewards follow the weakest
// car that may enter, so an open quest isn't worth farming with a fast car
function rewardClass(item, economy) {
  const order = Object.keys(economy.quests.byClass);
  const allowed = (item.entry?.classes ?? []).filter(c => order.includes(c));
  return allowed.length ? allowed.sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] : order[0];
}
// the highest class a quest lets in (any: the highest there is): a pink slip's stakes
function topClass(item, economy) {
  const order = Object.keys(economy.quests.byClass), allowed = (item.entry?.classes ?? []).filter(c => order.includes(c));
  return allowed.length ? allowed.sort((a, b) => order.indexOf(b) - order.indexOf(a))[0] : null;
}

// A quest's tier (1–5, data/economy.json quests.tiers): from its stars and the lowest class it lets in
export function tierOf(item, economy) {
  const Q = economy.quests, stars = item.rating?.stars ?? Q.defaults?.stars ?? 2, ct = Q.tierOfClass?.[rewardClass(item, economy)] ?? 1;
  const n = Math.max(1, Math.min(Q.tiers.length, Math.floor((stars + ct) / 2)));
  return Q.tiers.find(t => t.tier === n) ?? Q.tiers[0];
}

// What a quest is worth, from the economy's rules and its rating (stars, km): never stored with it.
// → { money (a gold run's, the fee back included), xp, fee, core, tier, tierName, unlockLevel, stars, km,
//     rewardClass, car (a pink slip's prize), stakeMaxClass }
export function rewardsOf(item, economy) {
  const Q = economy?.quests;
  if (!Q || item.kind !== 'quest') return { money: 0, xp: 0, fee: 0, tier: null };
  const R = item.rating ?? {}, stars = Math.max(1, Math.min(5, R.stars ?? Q.defaults?.stars ?? 2)), km = Math.min(Q.maxKm ?? Infinity, R.km ?? Q.defaults?.km ?? 3);
  const cls = rewardClass(item, economy), round = Q.roundTo ?? 1, T = tierOf(item, economy);
  const rivals = item.type === 'pink_slip' ? 1 : Math.max(0, item.npc?.count ?? 0), sk = item.npc?.skill ?? [0.4, 0.8];
  const crowd = 1 + rivals * (Q.npc?.perRival ?? 0) * ((Q.npc?.skillFloor ?? 0.5) + (sk[0] + sk[1]) / 2);
  const s = Q.byStars[stars - 1] ?? 1, type = Q.byType[item.type] ?? 1;
  const core = (Q.base.money + Q.perKm.money * km) * s * type * (Q.byClass[cls] ?? 1) * crowd;
  const fee = item.type === 'pink_slip' ? 0 : Math.round(core * (T.feeShare ?? 0) / round) * round;
  const money = item.type === 'pink_slip' ? 0 : Math.round((core + fee * (Q.fee?.back ?? 1)) / round) * round;
  const xp = Math.round((Q.base.xp + Q.perKm.xp * km) * s * crowd);
  return { money, xp, fee, core: Math.round(core), tier: T.tier, tierName: T.name, unlockLevel: T.level, stars, km, rewardClass: cls, stakeMaxClass: T.stakeMaxClass ?? null, rated: !!item.rating,
    car: item.type === 'pink_slip' ? item.params?.opponentCar ?? null : null };
}
// a quest's entry fee (its tier's share of its reward)
export const feeOf = (item, economy) => rewardsOf(item, economy).fee ?? 0;


const money = (n, economy) => `${economy?.currency ?? '$'}${Math.round(n).toLocaleString('en-GB')}`;
const validPlace = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

// What an item still needs, in plain words: errors stop it being published, warnings don't
export function problems(item, { economy = null, classes = null, cars = null, route = undefined } = {}) {
  const out = [];
  if (!item.name?.trim()) out.push(err('name', `Give the ${KINDS[item.kind]?.label.toLowerCase() ?? 'item'} a name.`));
  if (!validPlace(item.location)) out.push(err('location', 'It needs a place on the map.'));
  if (!(item.location?.heading >= 0 && item.location?.heading < 360)) out.push(err('location.heading', 'The facing must be from 0° to 359°.'));
  if (item.location?.altFrom === 'estimate') out.push(warn('location.alt', 'Its height is a guess (no ground there): place it in the 3D view to set it from the road.'));
  if (item.kind === 'route') return [...out, ...routeProblems(item)];
  if (item.kind === 'series') return [...out, ...seriesProblems(item)];
  if (item.kind !== 'quest') return out;
  const T = TYPES[item.type];
  if (!T) { out.push(err('type', `There's no quest type "${item.type}".`)); return out; }
  // (its route: given — the item, or null when there's none by that id — or not looked up: undefined)
  const R = item.route && route ? route : null;
  out.push(...T.check(item.params ?? {}, { cars, route: R ?? (item.route && route === undefined ? { unknown: true } : null) }));
  out.push(...rivalProblems(item));
  for (const f of T.fields) if (f.kind === 'place' && item.params?.[f.key] && !validPlace(item.params[f.key])) out.push(err(`params.${f.key}`, `The ${f.label.toLowerCase().replace(/ \(.*\)/, '')} isn't a place on the map.`));
  if (!item.route) out.push(warn('route', 'No route yet: draw one with the route tool (4) and pick it here.'));
  else if (route === null) out.push(err('route', `Its route "${item.route}" doesn't exist (any more).`));
  else if (R) out.push(...linkProblems(item, R));
  // entry requirements
  const E = item.entry ?? {}, known = classes ? classes.map(c => c.class) : null;
  for (const c of E.classes ?? []) if (known && !known.includes(c)) out.push(err('entry.classes', `There's no car class "${c}" (${known.join(', ')}).`));
  if (E.minWeightKg && E.maxWeightKg && E.minWeightKg > E.maxWeightKg) out.push(err('entry.minWeightKg', `The minimum weight (${E.minWeightKg} kg) is more than the maximum (${E.maxWeightKg} kg).`));
  if (E.maxPowerKw != null && E.maxPowerKw < 30) out.push(warn('entry.maxPowerKw', `A ${E.maxPowerKw} kW power limit lets almost no car in.`));
  if (!(Number.isInteger(E.minLevel) && E.minLevel >= 1 && E.minLevel <= 100)) out.push(err('entry.minLevel', 'The minimum level is a whole number from 1 to 100.'));
  // money: the rewards and the fee are the economy's, from the quest's rating and tier (nothing to set)
  if (economy) {
    const r = rewardsOf(item, economy), order = Object.keys(economy.quests.byClass);
    if (!item.rating) out.push(warn('rating', 'Not rated yet: pick its route and save, and its difficulty and reward are worked out.'));
    // (a pink slip's stakes: both cars at most the tier's class)
    const rival = item.type === 'pink_slip' ? cars?.[item.params?.opponentCar] : null;
    if (rival?.class && r.stakeMaxClass && order.indexOf(rival.class) > order.indexOf(r.stakeMaxClass)) out.push(err('params.opponentCar', `A ${r.tierName} pink slip stakes cars up to class ${r.stakeMaxClass}: the rival's car is class ${rival.class}.`));
  }
  if (!item.enabled) out.push(warn('enabled', 'It\'s switched off: once published it won\'t be offered to players.'));
  return out;
}

// a series: 3 to 6 quests, none twice (that they exist and are published: the editor checks, it can look)
export const SERIES_SIZE = [3, 6];
export function seriesProblems(item) {
  const q = item.quests ?? [], out = [];
  if (q.length < SERIES_SIZE[0]) out.push(err('quests', `A series needs at least ${SERIES_SIZE[0]} quests (it has ${q.length}).`));
  if (q.length > SERIES_SIZE[1]) out.push(err('quests', `A series has at most ${SERIES_SIZE[1]} quests (it has ${q.length}).`));
  if (new Set(q).size !== q.length) out.push(err('quests', 'A quest is in the series twice.'));
  return out;
}

// rivals on a quest type that has none (they race in sprints and pink slips)
export function rivalProblems(item) {
  const n = item.npc?.count ?? 0, out = [];
  if (n > 0 && !['sprint', 'pink_slip'].includes(item.type)) out.push(warn('npc.count', `A ${TYPES[item.type]?.label.toLowerCase() ?? item.type} has no rivals: the ${n} set are ignored (they race in sprints and pink slips).`));
  const sk = item.npc?.skill;
  if (sk && !(sk[0] >= 0 && sk[1] <= 1 && sk[0] <= sk[1])) out.push(err('npc.skill', 'Rivals\' skill goes from 0 to 1, the first no more than the second.'));
  return out;
}
export const blocking = list => list.filter(p => p.level === 'error');

// a route's own problems, from what's stored with it (the editor works them out with the road map and
// keeps them in course.problems when it saves; a server can check them with route/model.js the same way)
export function routeProblems(item) {
  const c = item.course, out = [];
  if (!c) return [err('course', 'The route has no course: draw it in the editor.')];
  if ((c.waypoints?.length ?? 0) < 2 || !c.path) out.push(err('course.waypoints', 'Draw the route: click the map to add at least two waypoints.'));
  for (const p of c.problems ?? []) out.push({ field: `course.${p.field ?? ''}`.replace(/\.$/, ''), level: p.level, message: p.message });
  if (c.review?.needed) {
    const names = list => [...new Set(list.map(m => m.name ?? 'an unnamed road'))].slice(0, 3).join(', ');
    if (c.review.missing?.length) out.push(err('course.roadData', `Route uses a road that no longer exists in OSM data (${names(c.review.missing)}): redraw that part in the editor.`));
    else out.push(err('course.roadData', `The roads under this route changed in the OSM data (${names(c.review.altered ?? [])}): check it in the editor and save it again.`));
  }
  return out;
}

// a quest and its route: they fit (laps need a loop; a delivery goes somewhere), the route is fit to drive,
// and the quest starts where the route does
export function linkProblems(quest, route) {
  const out = [], c = route.course ?? {}, laps = quest.params?.laps ?? 1, kinds = ROUTE_KINDS[quest.type] ?? ['p2p', 'loop'];
  if (route.kind !== 'route') return [err('route', `"${route.name}" isn't a route.`)];
  if (route.status === 'archived') out.push(err('route', `Its route "${route.name}" is archived: restore it or pick another.`));
  if (!kinds.includes(c.kind)) out.push(err('route', `A ${TYPES[quest.type].label.toLowerCase()} needs a point-to-point route: "${route.name}" is a loop.`));
  if (laps > 1 && c.kind !== 'loop') out.push(err('params.laps', `${laps} laps need a loop route: "${route.name}" is point to point.`));
  if (blocking(routeProblems(route)).length) out.push(err('route', `Its route "${route.name}" has problems to fix first: ${blocking(routeProblems(route))[0].message}`));
  // rivals: one car to each grid slot, the player's first
  const rivals = quest.type === 'pink_slip' ? 1 : quest.npc?.count ?? 0, slots = c.grid?.count ?? 8;
  if (rivals > slots - 1) out.push(err('npc.count', `${rivals} rivals need a grid of ${rivals + 1} slots: "${route.name}" has ${slots}. Fewer rivals, or more grid slots on the route.`));
  if (validPlace(quest.location) && validPlace(route.location)) {
    const R = 6371000, toRad = Math.PI / 180, dLat = (route.location.lat - quest.location.lat) * toRad, dLon = (route.location.lon - quest.location.lon) * toRad;
    const m = 2 * R * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(quest.location.lat * toRad) * Math.cos(route.location.lat * toRad) * Math.sin(dLon / 2) ** 2));
    if (m > 300) out.push(warn('route', `The quest starts ${m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`} from its route's start: move one to the other.`));
  }
  return out;
}

// Can this car (and player) enter? Each requirement, met or not — for the info card
export function entryCheck(item, car = null, level = null) {
  const E = item.entry ?? {}, out = [];
  if (E.classes?.length) out.push({ text: `Class ${E.classes.join(' / ')}`, ok: car ? E.classes.includes(car.className) : null });
  if (E.maxPowerKw) out.push({ text: `Up to ${E.maxPowerKw} kW (${Math.round(E.maxPowerKw * 1.341)} hp)`, ok: car ? car.kw <= E.maxPowerKw : null });
  if (E.minWeightKg) out.push({ text: `At least ${E.minWeightKg} kg`, ok: car ? car.kg >= E.minWeightKg : null });
  if (E.maxWeightKg) out.push({ text: `At most ${E.maxWeightKg} kg`, ok: car ? car.kg <= E.maxWeightKg : null });
  if (E.maxKwPerTonne) out.push({ text: `Up to ${E.maxKwPerTonne} kW per tonne`, ok: car ? car.kw / (car.kg / 1000) <= E.maxKwPerTonne : null });
  if (E.minLevel > 1) out.push({ text: `Level ${E.minLevel}+`, ok: level == null ? null : level >= E.minLevel });
  return out;
}
