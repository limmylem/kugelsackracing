// The new player's first hours, end to end (Phase 4 Step 5): a fresh save, and San Francisco's quests made
// the way the editor makes them (templates on real roads near the start, published through the world
// content service; the easy ones rated Rookie, the hard one a tier up). The
// player finds a quest (the finder's "Recommended for you": the easy ones, not the locked one), races
// NPCs in the physics, crashes (a real crash into the test centre's wall, its damage saved as the game
// saves it), repairs, earns money, buys a part and fits it, levels up into the next tier of quests and
// completes a quest series (its bonus paid) — through the game's own quest controller, race and
// PlayerService throughout. Nothing may log an error or throw on the way, and the save reloads as it was.
//
//   npm run test:newplayer                (--content: only make and list the quests)

import { mapHarness } from './harness.ts';
import { runRace } from './raceHarness.ts';
import { createNetwork } from '../../route/network.js';
import { newRoute, saveCourse, viewCourse } from '../../route/model.js';
import { DEFAULT_OPTIONS } from '../../route/network.js';
import { rateQuest } from '../../content/rating.js';
import { distanceKm } from '../../content/geo.js';
import { newItem, rewardsOf } from '../../content/quests.js';
import { applyTemplate } from '../../content/templates.js';
import { contentChecker } from '../../content/schema.js';
import { makeRater } from '../../content/rating.js';
import { createLocalContentService } from '../../content/service.js';
import { MemoryContentStorage } from '../../content/storage.js';
import { recommend, filterQuests, defaultFilters } from '../../quest/finder.js';
import { entryReasons, levelOf } from '../../quest/rules.js';
import { LocalPlayerService } from '../../garage/player/service.js';
import { MemoryStorage } from '../../garage/player/storage.js';
import { MemoryRecordStore } from '../../quest/recordStore.js';
import { garageStateOf } from '../../garage/player/profile.js';
import { Garage } from '../../garage/data.js';
import { carWork } from '../../garage/repair.js';
import { crashOutcome } from '../../garage/carDamage.js';
import { createSimulation } from '../../physics/sim.js';
import { placeForCrash } from '../../physics/crashTest.js';
import { crashContext } from '../harness.mjs';
import fs from 'node:fs';

// ---------- nothing may go wrong quietly ----------
const errors: string[] = [];
const consoleError = console.error;
console.error = (...a: any[]) => { errors.push(a.map(String).join(' ')); consoleError(...a); };
process.on('unhandledRejection', (e: any) => errors.push(`unhandled: ${e?.message ?? e}`));
let failed = 0;
const report = (pass: boolean, name: string, detail = '') => { if (!pass) failed++; console.log(`${pass ? '  ok  ' : ' FAIL '} ${name.padEnd(52)} ${detail}`); };
const json = (p: string) => JSON.parse(fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'));
const config = json('data/quests.json'), economy = json('data/economy.json'), classes = json('data/classes.json').classes;
const cars = Object.fromEntries(json('data/cars/index.json').cars.map((f: string) => { const c = json(`data/cars/${f}`); return [c.id ?? f.split('/')[0], { name: c.name, class: c.class ?? null }]; }));
const money = (n: number) => `$${Math.round(n).toLocaleString('en-GB')}`;
const step = (s: string) => console.log(`\n${s}`);

// ---------- the world: San Francisco, its quests made as the editor makes them ----------
const region = 'sf', M = await mapHarness(region), { H, manifest, P } = M, db = H.db;
const N = createNetwork(M.graph(), { P, region, version: manifest.version, bbox: manifest.bbox });
const check = contentChecker(json('data/schemas/content-item.schema.json'), { economy, classes, cars }), rate = makeRater({ config, classes });
let clock = Date.UTC(2026, 9, 5, 9);
const now = () => new Date(clock += 60000).toISOString();
const C = createLocalContentService({ storage: new MemoryContentStorage(), check, rate, author: 'tester', now, autosaveMs: null });
const templates = json('data/content/quest-templates.json').templates, T = (id: string) => templates.find((t: any) => t.id === id);

// candidate routes near the start (downtown, the waterfront): drives between junctions 1.4–2.4 km apart, as an
// author would draw them; each quest takes the first whose rating puts it in the tier wanted
const HOME = { lat: 37.7936, lon: -122.3955 }, candidates: any[] = [];
// (spots in the baked world where the AI driver — the NPCs' and this test's — stops dead every time, as the
// editor's AI test race would show an author: docs/KNOWN_ISSUES.md. A route through one isn't made)
const STUCK = [{ lat: 37.78034, lon: -122.39894, what: '4th Street' }, { lat: 37.78376, lon: -122.39447, what: '2nd Street' }, { lat: 37.79257, lon: -122.40761, what: 'Stockton Tunnel' }];
const clear = (course: any) => { const line = viewCourse(course, P)?.line ?? []; return !line.some((q: any) => { const [lat, lon] = P.toLatLon(q.x, q.z); return STUCK.some(k => distanceKm(k, { lat, lon }) < 0.05); }); };
{
  let seed = 17; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const main = N.mainPart(DEFAULT_OPTIONS), nodes: number[] = [];
  const ll = (k: number) => { const [lat, lon] = P.toLatLon(N.nodes.x[k], N.nodes.z[k]); return { lat, lon }; };
  for (let k = 0; k < N.nodes.x.length; k++) if (main[k] && distanceKm(HOME, ll(k)) < 2.5) nodes.push(k);
  for (let t = 0; candidates.length < 90 && t < 1500; t++) {
    const a = ll(nodes[Math.floor(rnd() * nodes.length)]), b = ll(nodes[Math.floor(rnd() * nodes.length)]), km = distanceKm(a, b);
    if (km < 1.4 || km > 2.4) continue;
    const saved = saveCourse(N, { ...newRoute(region, 'p2p'), waypoints: [a, b] });
    if (saved.course.stats && !saved.course.problems.some((q: any) => q.level === 'error') && saved.course.length < 3600 && (saved.course.checkpoints?.length ?? 0) >= 2 && clear(saved.course)) candidates.push({ waypoints: [a, b], course: saved.course });
  }
}
function pick(template: string, tier: (t: number) => boolean) {
  for (const [k, c] of candidates.entries()) {
    const q: any = applyTemplate(newItem('quest', { id: 'quest_pick0001', location: HOME }), T(template), {}); q.route = 'r';
    q.rating = rateQuest(q, { course: c.course }, { config, classes });
    if (tier(rewardsOf(q, economy).tier)) { candidates.splice(k, 1); return c.waypoints; }
  }
  throw new Error(`no route near the start makes a ${template} of the tier wanted`);
}
// a route (from waypoints on the roads) and a quest on it from a template, both published
async function makeQuest(name: string, waypoints: any[], template: string) {
  const saved = saveCourse(N, { ...newRoute(region, 'p2p'), waypoints });
  const { author: _a, id: _i, ...route } = newItem('route', { location: { ...waypoints[0], alt: 0, heading: 0 }, region });
  route.name = `${name} route`; route.course = saved.course; if (saved.location) route.location = saved.location;
  const r = await C.create(route);
  if (!r.ok) throw new Error(`route ${name}: ${r.error}`);
  const { author: _b, id: _j, ...q0 } = newItem('quest', { location: r.item.location });
  const q = { ...applyTemplate(q0, T(template), { road: name }), route: r.item.id, name };
  const rq = await C.create(q);
  if (!rq.ok) throw new Error(`quest ${name}: ${rq.error}`);
  const pub = await C.publish(rq.item.id);
  if (!pub.ok) throw new Error(`publish ${name}: ${pub.error} ${JSON.stringify(pub.problems ?? [])}`);
  return { quest: pub.item, route: (await C.get(r.item.id, { view: 'published' })).item, stored: saved.course };
}
step('San Francisco\'s quests, made with the editor\'s templates on real roads');
console.log(`  ${candidates.length} candidate routes near the start`);
const rookie = (t: number) => t === 1;
// fifteen Rookie quests round the start (the first three: the series) — about what the balance simulation
// assumes a new player can find (data/economy.json simulation.pool): Club tier takes ~15 first-time golds
const easy = [
  await makeQuest('Embarcadero dash', pick('city_sprint', rookie), 'city_sprint'),
  await makeQuest('Downtown time trial', pick('solo_time_trial', rookie), 'solo_time_trial'),
  await makeQuest('Waterfront checkpoints', pick('checkpoint_run', rookie), 'checkpoint_run'),
];
const more = [];
for (const [k, t] of ['city_sprint', 'solo_time_trial', 'checkpoint_run', 'city_sprint', 'solo_time_trial', 'checkpoint_run', 'city_sprint', 'solo_time_trial', 'checkpoint_run', 'city_sprint', 'solo_time_trial', 'city_sprint'].entries()) more.push(await makeQuest(`Rookie run ${k + 1}`, pick(t, rookie), t));
// the hard one: five quick rivals, a tier up
const hard = await makeQuest('Nob Hill showdown', pick('mountain_sprint_hard', t => t === 2), 'mountain_sprint_hard');
// the series: the three easy ones
const { author: _s, id: _sid, ...s0 } = newItem('series', { location: easy[0].quest.location });
const sr = await C.create({ ...s0, name: 'Downtown rookie series', quests: easy.map(e => e.quest.id) });
const series = sr.ok ? (await C.publish(sr.item.id)).item : null;
for (const e of [...easy, ...more, hard]) { const r = rewardsOf(e.quest, economy); console.log(`  ${e.quest.name.padEnd(34)} ${e.quest.type.padEnd(11)} ${(e.stored.length / 1000).toFixed(2)} km (steepest ${e.stored.stats.maxGrade}%), ${r.stars}★ ${r.tierName} (level ${r.unlockLevel}), up to ${money(r.money)} · ${r.xp} xp, entry ${money(r.fee)}, ${e.quest.npc?.count ?? 0} rivals`); }
if (process.argv.includes('--content')) process.exit(0);          // (just the quests made: a quick look)
report(!!series, 'the series published', series ? `${series.name}: ${series.quests.length} quests` : sr.error);
report(rewardsOf(hard.quest, economy).unlockLevel > 1 && [...easy, ...more].every(e => rewardsOf(e.quest, economy).unlockLevel === 1), 'the easy quests are Rookie tier, the hard one isn\'t', `hard: ${rewardsOf(hard.quest, economy).tierName}`);

// ---------- a new player ----------
step('A new player');
const saveStore = new MemoryStorage();
const player = new LocalPlayerService({ db, storage: saveStore, quests: { config, recordings: new MemoryRecordStore() }, now });
await player.init();
const p = () => player.profile, carId = () => p().currentCar;
report(p().money === economy.startingMoney && levelOf(p().xp ?? 0, config) === 1 && Object.keys(p().cars).length === 1, 'starts fresh: starting money, level 1, the starter car',
  `${money(p().money)}, level ${levelOf(p().xp ?? 0, config)}, ${Object.values(p().cars).map((c: any) => c.carId).join(', ')}`);
const carSummary = () => { const g = new Garage(db, garageStateOf(p(), db), p().cars[carId()].carId), t = g.stats().totals; return { className: t.rating?.class ?? null, rating: t.rating?.index ?? null, kw: t.peakPower?.kw ?? 0, kg: t.mass, drivable: { ok: true } }; };
const start = easy[0].quest.location;

// ---------- finding a quest ----------
step('Finding a quest');
const published = async () => (await C.query({ ...start, km: 10, view: 'published', offered: true, kinds: ['quest'], limit: 100 })).items.map((x: any) => x.item);
let ctx: any = { profile: p(), car: carSummary(), economy, config, at: start };
const rec = recommend(await published(), ctx);
const rookieIds = new Set([...easy, ...more].map(e => e.quest.id));
report(rec.length === Math.min(config.finding.recommended.count, rookieIds.size) && rec.every((r: any) => rookieIds.has(r.item.id)), '"Recommended for you": Rookie quests, not the locked one', rec.map((r: any) => `${r.item.name} (${r.why.join(', ')})`).join('; '));
const locked = entryReasons({ quest: hard.quest, car: ctx.car, player: { money: p().money, xp: p().xp ?? 0 }, config, economy });
report(locked.some((r: any) => r.code === 'level'), 'the hard quest is locked for now, and says why', locked.map((r: any) => r.text).join(' '));
report(filterQuests(await published(), { ...defaultFilters(), type: 'sprint', status: 'new' }, ctx).some((x: any) => x.item.id === easy[0].quest.id), 'the filters find the sprint');

// ---------- a quest: driven in the physics (a race against NPCs, or alone) ----------
const seriesOf = async (quest: any) => series && series.quests.includes(quest.id) ? [{ item: series, quests: await Promise.all(series.quests.map(async (id: string) => (await C.get(id, { view: 'published' })).item)) }] : [];
async function play(e: any, { skill = 0.9, seed = 1 } = {}) {
  const course: any = viewCourse(e.route.course, P), xs = course.line.map((q: any) => q.x), zs = course.line.map((q: any) => q.z);
  const R = { region, M, course, stored: e.route.course, laps: 1, around: { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cz: (Math.min(...zs) + Math.max(...zs)) / 2, radius: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2 + 300 } };
  const before = { money: p().money, xp: p().xp ?? 0 };
  const out: any = await runRace(R, { npcs: e.quest.npc?.count ?? 0, seed, quest: e.quest, player, garageState: garageStateOf(p(), db), playerSkill: skill, series: seriesOf, limit: 600, playerCar: p().cars[carId()].carId });
  const res = out.res, pay = res?.pay ?? {};
  console.log(`  ${e.quest.name}: ${res?.outcome.status}${res?.outcome.status !== 'finished' ? ` (${res?.outcome.reason ?? ''}: ${res?.outcome.text ?? ''}; ${out.botResets} resets at ${out.resetsAt.slice(0, 6).map((r: any) => `${r.s} m`).join(', ')}, t ${out.t.toFixed(0)} s)` : ''}${res?.outcome.place ? `, ${res.outcome.place}${['th', 'st', 'nd', 'rd'][res.outcome.place] ?? 'th'} of ${out.standings.length}` : ''}${res?.outcome.time != null ? ` in ${res.outcome.time.toFixed(2)} s` : ''}${res?.outcome.medal ? `, ${res.outcome.medal}` : ''} · paid ${money(pay.money ?? 0)}, ${pay.xp ?? 0} xp${pay.series?.length ? ` · series bonus ${pay.series.map((b: any) => `${money(b.money)} + ${b.xp} xp`).join(', ')}` : ''}${pay.levelUp ? ` · level ${pay.levelUp}!` : ''}`);
  // (stuck somewhere: where, on the map and on which road)
  if (out.resetsAt.length) { const at = (await import('../../route/geometry.js')).at, q = at(course.line, out.resetsAt[0].s, false), [lat, lon] = P.toLatLon(q.x, q.z), near = N.nearest(q.x, q.z, DEFAULT_OPTIONS, 30);
    console.log(`    stuck at ${out.resetsAt[0].s} m: ${lat.toFixed(5)}, ${lon.toFixed(5)} on ${near?.seg?.name ?? 'a road'} (${near?.seg?.class ?? ''}, ${near?.seg?.structure ?? ''}), grade there ${(() => { const a2 = at(course.line, Math.max(0, out.resetsAt[0].s - 15), false), b2 = at(course.line, out.resetsAt[0].s + 15, false); return ((b2.h - a2.h) / 30 * 100).toFixed(0); })()}%`); }
  return { out, res, pay, gained: { money: p().money - before.money, xp: (p().xp ?? 0) - before.xp } };
}
// (--only "<name>,<name>": play just those, then stop — looking into one route)
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
if (only) { for (const e of [...easy, ...more, hard].filter(e => only.includes(e.quest.name))) await play(e, { skill: 0.95, seed: 3 }); process.exit(0); }
step('Racing NPCs');
const race1 = await play(easy[0], { skill: 0.95, seed: 3 });
report(race1.res?.outcome.status === 'finished' && race1.pay.valid && race1.gained.money > 0 && race1.out.standings.length === 1 + (easy[0].quest.npc?.count ?? 0), 'raced the rivals: finished, the result valid, paid',
  `place ${race1.res?.outcome.place}, ${race1.out.standings.map((s: any) => `${s.place}. ${s.player ? 'you' : s.name}`).join(' ')}; +${money(race1.gained.money)}, +${race1.gained.xp} xp`);

// ---------- a crash and its repair ----------
step('A crash, then the garage');
const ctxCrash = await crashContext(), boxes = ctxCrash.boxesOf(db.cars[p().cars[carId()].carId]);
{
  // into the test centre's wall at 70 km/h, the car as it is now; every impact saved as the game saves it
  const spec = new Garage(db, garageStateOf(p(), db), p().cars[carId()].carId).stats().spec;
  const sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets: H.socketsOf(spec), track: H.track }), impacts: any[] = [];
  placeForCrash(sim, 70, 'wall', { side: 'front', angleDeg: 15 });
  for (let i = 0; i < 2.5 / sim.dt; i++) { sim.step({ device: 'wheel', throttle: 0, brake: 0, steer: 0, handbrake: false }); impacts.push(...sim.vehicle.sensor.take()); }
  for (const impact of impacts) {
    const id = carId(), pr = p(), g = new Garage(db, { ...garageStateOf(pr, db), current: id }, pr.cars[id].carId), sockets = g.build.sockets;
    const attach = Object.fromEntries(Object.entries(sockets).filter(([, x]: any) => x && pr.parts[x].attach).map(([s, x]: any) => [s, { state: pr.parts[x].attach, stress: 0 }]));
    const o = crashOutcome({ car: g.car, build: g.build, view: g.view, boxes, rules: db.damage, attach, mech: Object.fromEntries(Object.values(sockets).filter(Boolean).map((x: any) => [x, pr.parts[x].damage ?? {}])),
      damage: { shell: pr.cars[id].damage ?? null, parts: Object.fromEntries(Object.values(sockets).filter(Boolean).map((x: any) => [x, { condition: pr.parts[x].condition, dents: pr.parts[x].dents ?? [] }])) } }, impact);
    const parts: any = {}, hitsOf = (t: string) => o.result.dents.filter((d: any) => d.target === t).map(({ target: _, ...d }: any) => d);
    for (const x of o.touched) parts[x] = { condition: o.next.parts[x].condition, hits: hitsOf(Object.keys(sockets).find(k => sockets[k] === x)!) };
    for (const [x, b] of Object.entries(o.mech.damage)) parts[x] = { ...(parts[x] ?? {}), damage: b };
    for (const c of o.changes) parts[sockets[c.socket]] = { ...(parts[sockets[c.socket]] ?? {}), attach: c.to };
    const r = await player.damageCar(id, { parts, shell: { condition: o.next.shell.condition, hits: hitsOf('shell'), broken: o.next.shell.broken } }, { cause: 'crash into a wall' });
    if (!r.ok) throw new Error(r.error);
  }
  const work = carWork(db, p(), carId()), typical = rewardsOf(easy[0].quest, economy).money;
  report(work.full > 0 && work.parts.length > 0, 'the crash damaged the car (saved as the game saves it)', `${impacts.length} impacts · body ${Math.round(p().cars[carId()].damage?.condition ?? 100)}%, ${work.parts.length} parts to fix · repair ${money(work.full)} full, ${money(work.quick)} quick`);
  const before = p().money, r = await player.repairCar(carId(), { kind: 'full' });
  const after = carWork(db, p(), carId());
  report(r.ok && after.full === 0 && before - p().money === work.full, 'repaired in full at the garage', `${money(before - p().money)} paid, ${money(p().money)} left`);
  report(work.full <= typical, 'the repair costs no more than a typical race pays', `${money(work.full)} against ${money(typical)} (the rookie race's reward)`);
}

// ---------- earning: the rest of the series ----------
step('Earning money: the rest of the series');
const solo = [await play(easy[1], { skill: 0.9, seed: 5 }), await play(easy[2], { skill: 0.9, seed: 7 })];
report(solo.every(x => x.res?.outcome.status === 'finished' && x.pay.valid && x.gained.money > 0), 'the time trial and the checkpoint run: finished and paid', solo.map(x => `+${money(x.gained.money)}`).join(', '));
const bonus = [race1, ...solo].flatMap(x => x.pay.series ?? []);
report(bonus.length === 1 && !!p().series?.[series?.id], 'the series complete: its bonus paid once', bonus.map((b: any) => `${b.name}: +${money(b.money)}, +${b.xp} xp`).join(''));

// ---------- a part: bought and fitted ----------
step('A part: bought and fitted');
{
  const g = new Garage(db, garageStateOf(p(), db), p().cars[carId()].carId), kw0 = g.stats().totals.peakPower.kw;
  // the cheapest part for sale that adds power and fits this car
  const fits = Object.values(db.parts).filter((x: any) => !x.retired && !x.todo?.length && x.tier !== 'stock' && !/stock/i.test(x.name) && x.price > 0 && x.price <= p().money && ['intake', 'exhaust'].includes(x.slot))
    .sort((a: any, b: any) => a.price - b.price);
  let fitted: any = null;
  for (const part of fits as any[]) {
    const r = await player.buyAndInstall(carId(), part.id, { auto: true });
    if (!r.ok) continue;
    const kw1 = new Garage(db, garageStateOf(p(), db), p().cars[carId()].carId).stats().totals.peakPower.kw;
    fitted = { part, kw1 }; break;
  }
  report(!!fitted && fitted.kw1 > kw0, 'bought a part, fitted it: the car makes more power', fitted ? `${fitted.part.name} (${money(fitted.part.price)}): ${kw0.toFixed(0)} → ${fitted.kw1.toFixed(0)} kW · ${money(p().money)} left` : `none of ${fits.length} fitted`);
}

// ---------- the next tier ----------
step('Up a level: the next tier of quests');
{
  // (the other Rookie quests round about, then repeats, until the hard one's tier is open: repeats pay less)
  const need = rewardsOf(hard.quest, economy).unlockLevel, order = [...more, ...easy];
  let runs = 0;
  while (levelOf(p().xp ?? 0, config) < need && runs < 24) { await play(order[runs % order.length], { skill: 0.92, seed: 20 + runs }); runs++; }
  const level = levelOf(p().xp ?? 0, config);
  ctx = { profile: p(), car: carSummary(), economy, config, at: start };
  const reasons = entryReasons({ quest: hard.quest, car: ctx.car, player: { money: p().money, xp: p().xp ?? 0 }, config, economy });
  report(level >= need && !reasons.some((r: any) => r.code === 'level'), `level ${need}: the ${rewardsOf(hard.quest, economy).tierName} tier is open`, `level ${level} (${p().xp} xp) after ${runs} more runs · ${reasons.length ? `still: ${reasons.map((r: any) => r.text).join(' ')}` : 'nothing stops it'}`);
  const tried = reasons.length ? null : await play(hard, { skill: 0.95, seed: 9 });
  if (tried) report(tried.res?.outcome.status === 'finished' && tried.pay.valid, 'the higher-tier quest entered and raced', `${tried.res.outcome.place ? `place ${tried.res.outcome.place}` : ''} · +${money(tried.gained.money)}, +${tried.gained.xp} xp`);
}

// ---------- the save ----------
step('The save, closed and opened again');
{
  const again = new LocalPlayerService({ db, storage: saveStore, quests: { config, recordings: new MemoryRecordStore() }, now });
  await again.init();
  const a = p(), b = again.profile;
  report(b.money === a.money && b.xp === a.xp && JSON.stringify(b.quests) === JSON.stringify(a.quests) && JSON.stringify(b.series) === JSON.stringify(a.series), 'reloads exactly: money, xp, quests and the series', `${money(b.money)}, ${b.xp} xp, ${Object.keys(b.quests ?? {}).length} quests played`);
}

report(errors.length === 0, 'no errors logged or thrown on the way', errors.slice(0, 3).join(' | '));
console.log(`\n${failed ? `${failed} FAILED` : 'all passed'}`);
process.exit(failed ? 1 : 0);
