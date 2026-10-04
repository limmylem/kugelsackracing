// World content's kinds and quest types: what each is, what a new one starts as, what it's worth (from
// the economy's rules, data/economy.json quests — a quest never stores money), and what it still needs,
// in plain words (the editor's properties panel shows them; errors stop publishing, warnings don't).
// Pure: the editor, the game, the tests and a server use it alike.
//
//   newItem(kind, { id, location, author, now, type }) → a draft item
//   rewardsOf(item, economy) → { money, xp, tier, … }        feeLimit(item, economy)
//   problems(item, { economy, classes, cars }) → [{ field, level: 'error' | 'warning', message }]
//   entryCheck(item, car: { className, kw, kg }, level) → [{ ok, text }]

export const CONTENT_VERSION = 2;

export const KINDS = {
  quest: { label: 'Quest start', icon: 'flag', colour: '#ffb02e' },
  poi: { label: 'Point of interest', icon: 'star', colour: '#4fc3f7' },
  spawn: { label: 'Spawn point', icon: 'car', colour: '#7ee08a' },
};

// Each quest type: its name, its own fields (params: their defaults, and how the editor shows them), and
// what it must have before it can be published
export const TYPES = {
  sprint: {
    label: 'Sprint', icon: 'flag', blurb: 'From the start to a finish line, first one there wins.',
    params: { finish: null },
    fields: [{ key: 'finish', label: 'Finish line', kind: 'place' }],
    check: p => p.finish ? [] : [err('params.finish', 'Sprint needs a finish line.')],
  },
  time_trial: {
    label: 'Time trial', icon: 'timer', blurb: 'Against the clock: beat the target time.',
    params: { finish: null, laps: 1, targetSeconds: null },
    fields: [{ key: 'finish', label: 'Finish line', kind: 'place' }, { key: 'laps', label: 'Laps', kind: 'int', min: 1, max: 50 }, { key: 'targetSeconds', label: 'Target time (s)', kind: 'number', min: 1 }],
    check: p => [
      ...(p.finish ? [] : [err('params.finish', 'Time trial needs a finish line (put it on the start for a lap).')]),
      ...(p.targetSeconds > 0 ? [] : [err('params.targetSeconds', 'Time trial needs a target time.')]),
      ...(Number.isInteger(p.laps) && p.laps >= 1 ? [] : [err('params.laps', 'Laps must be a whole number, at least 1.')]),
    ],
  },
  checkpoint: {
    label: 'Checkpoint run', icon: 'checkpoint', blurb: 'Through every checkpoint in order before time runs out.',
    params: { checkpoints: [], timeLimitSeconds: null },
    fields: [{ key: 'checkpoints', label: 'Checkpoints', kind: 'places' }, { key: 'timeLimitSeconds', label: 'Time limit (s)', kind: 'number', min: 1 }],
    check: p => [
      ...((p.checkpoints?.length ?? 0) >= 2 ? [] : [err('params.checkpoints', `Checkpoint run needs at least 2 checkpoints (it has ${p.checkpoints?.length ?? 0}).`)]),
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
    check: p => [
      ...(p.destination ? [] : [err('params.destination', 'Delivery needs a destination.')]),
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
      ...(p.finish ? [] : [err('params.finish', 'Pink slip needs a finish line.')]),
    ],
  },
};
export const TYPE_IDS = Object.keys(TYPES);
export const TIMES = ['any', 'dawn', 'day', 'dusk', 'night'], WEATHER = ['any', 'clear', 'cloudy', 'rain', 'fog'];

function err(field, message) { return { field, level: 'error', message }; }
function warn(field, message) { return { field, level: 'warning', message }; }
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));

export function newItem(kind, { id, location, author = 'editor', now = new Date().toISOString(), type = 'sprint', name } = {}) {
  if (!KINDS[kind]) throw new Error(`no kind of content "${kind}"`);
  const item = {
    id, version: CONTENT_VERSION, kind, name: name ?? (kind === 'quest' ? `New ${TYPES[type].label.toLowerCase()}` : `New ${KINDS[kind].label.toLowerCase()}`),
    description: '', icon: kind === 'quest' ? TYPES[type].icon : KINDS[kind].icon,
    location: { lat: location.lat, lon: location.lon, alt: location.alt ?? 0, heading: location.heading ?? 0, ...(location.altFrom ? { altFrom: location.altFrom } : {}) },
    road: null, status: 'draft', author, created: now, updated: now, publishedAt: null,
  };
  if (kind === 'quest') Object.assign(item, {
    type, route: null, entry: { classes: [], maxPowerKw: null, minWeightKg: null, maxWeightKg: null, maxKwPerTonne: null, minLevel: 1 },
    fee: 0, rewards: { tier: 'standard' }, npc: {}, conditions: { timeOfDay: 'any', weather: 'any' }, enabled: true, params: clone(TYPES[type].params),
  });
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

export function rewardsOf(item, economy) {
  const Q = economy?.quests;
  if (!Q || item.kind !== 'quest') return { money: 0, xp: 0, tier: null };
  const tier = item.rewards?.tier, t = Q.tiers[tier];
  if (t === undefined) return { money: 0, xp: 0, tier, unknownTier: true };
  const cls = rewardClass(item, economy), round = Q.roundTo ?? 1;
  const money = Math.round(Q.base.money * t * (Q.byType[item.type] ?? 1) * (Q.byClass[cls] ?? 1) / round) * round;
  return { money, xp: Math.round(Q.base.xp * t), tier, rewardClass: cls, car: item.type === 'pink_slip' ? item.params?.opponentCar ?? null : null };
}

export const feeLimit = (item, economy) => Math.floor(rewardsOf(item, economy).money * (economy?.quests?.fee.maxShareOfReward ?? 1));

const money = (n, economy) => `${economy?.currency ?? '$'}${Math.round(n).toLocaleString('en-GB')}`;
const validPlace = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

// What an item still needs, in plain words: errors stop it being published, warnings don't
export function problems(item, { economy = null, classes = null, cars = null } = {}) {
  const out = [];
  if (!item.name?.trim()) out.push(err('name', `Give the ${KINDS[item.kind]?.label.toLowerCase() ?? 'item'} a name.`));
  if (!validPlace(item.location)) out.push(err('location', 'It needs a place on the map.'));
  if (!(item.location?.heading >= 0 && item.location?.heading < 360)) out.push(err('location.heading', 'The facing must be from 0° to 359°.'));
  if (item.location?.altFrom === 'estimate') out.push(warn('location.alt', 'Its height is a guess (no ground there): place it in the 3D view to set it from the road.'));
  if (item.kind !== 'quest') return out;
  const T = TYPES[item.type];
  if (!T) { out.push(err('type', `There's no quest type "${item.type}".`)); return out; }
  out.push(...T.check(item.params ?? {}, { cars }));
  for (const f of T.fields) if (f.kind === 'place' && item.params?.[f.key] && !validPlace(item.params[f.key])) out.push(err(`params.${f.key}`, `The ${f.label.toLowerCase()} isn't a place on the map.`));
  if (!item.route) out.push(warn('route', 'No route yet: routes are drawn in Phase 4 Step 2.'));
  // entry requirements
  const E = item.entry ?? {}, known = classes ? classes.map(c => c.class) : null;
  for (const c of E.classes ?? []) if (known && !known.includes(c)) out.push(err('entry.classes', `There's no car class "${c}" (${known.join(', ')}).`));
  if (E.minWeightKg && E.maxWeightKg && E.minWeightKg > E.maxWeightKg) out.push(err('entry.minWeightKg', `The minimum weight (${E.minWeightKg} kg) is more than the maximum (${E.maxWeightKg} kg).`));
  if (E.maxPowerKw != null && E.maxPowerKw < 30) out.push(warn('entry.maxPowerKw', `A ${E.maxPowerKw} kW power limit lets almost no car in.`));
  if (!(Number.isInteger(E.minLevel) && E.minLevel >= 1 && E.minLevel <= 100)) out.push(err('entry.minLevel', 'The minimum level is a whole number from 1 to 100.'));
  // money: the rewards are the economy's; the fee the author's, within reason
  if (economy) {
    const r = rewardsOf(item, economy);
    if (r.unknownTier) out.push(err('rewards.tier', `There's no reward tier "${item.rewards?.tier}" (${Object.keys(economy.quests.tiers).join(', ')}).`));
    else if (item.type === 'pink_slip') { if (item.fee > 0) out.push(err('fee', 'A pink slip has no entry fee: the cars are the stakes.')); }
    else if (item.fee > r.money) out.push(err('fee', `Entry fee (${money(item.fee, economy)}) is higher than the reward (${money(r.money, economy)}).`));
    else if (item.fee > feeLimit(item, economy)) out.push(err('fee', `Entry fee (${money(item.fee, economy)}) is more than ${Math.round(economy.quests.fee.maxShareOfReward * 100)}% of the reward (${money(r.money, economy)}): at most ${money(feeLimit(item, economy), economy)}.`));
  }
  if (!(item.fee >= 0)) out.push(err('fee', 'The entry fee can\'t be negative.'));
  if (!item.enabled) out.push(warn('enabled', 'It\'s switched off: once published it won\'t be offered to players.'));
  return out;
}

export const blocking = list => list.filter(p => p.level === 'error');

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
