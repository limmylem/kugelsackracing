// Races in Node (Phase 4 Step 4's tests): a region's real route, its baked world's colliders in the
// physics, the player's car driven by a bot through the game's own quest controller and PlayerService,
// and NPCs (race/race.js) — as the game runs it, without the page.
//
//   const R = await regionRoute(region)  → { M, course, stored, around }
//   const out = await runRace(R, { npcs, seed, collisions, rubberBand, playerSkill, fps, limit, onStep })
//     npcs: [{ driver id, skill }] or a count; → { standings, results, player, events, ms, steps, incidents, … }

import fs from 'node:fs';
import { mapHarness } from './harness.ts';
import { createNetwork } from '../../route/network.js';
import { newRoute, saveCourse, viewCourse } from '../../route/model.js';
import { REAL_ROUTES } from './realRoutes.ts';
import { createQuestController } from '../../play/questController.js';
import { LocalPlayerService } from '../../garage/player/service.js';
import { MemoryStorage } from '../../garage/player/storage.js';
import { MemoryRecordStore } from '../../quest/recordStore.js';
import { createRace } from '../../race/race.js';
import { fittedRacing } from '../../race/fit.js';
import { setupNpcs } from '../../race/setup.js';
import { createAiDriver } from '../../ai/driver.js';
import { driverParams } from '../../ai/skill.js';
import { rng, hashSeed } from '../../ai/rng.js';
import { carCaps, speedPlan } from '../../route/racingLine.js';

export const qcfg = JSON.parse(fs.readFileSync(new URL('../../data/quests.json', import.meta.url), 'utf8'));
export const ncfg = JSON.parse(fs.readFileSync(new URL('../../data/npc.json', import.meta.url), 'utf8'));
export const sessionRules = JSON.parse(fs.readFileSync(new URL('../../data/sessions.json', import.meta.url), 'utf8'));

const regions = new Map();
export async function regionRoute(region: string) {
  if (regions.has(region)) return regions.get(region);
  const R = REAL_ROUTES[region], M = await mapHarness(region);
  const N = createNetwork(M.graph(), { P: M.P, region, version: M.manifest.version });
  const { course: stored } = saveCourse(N, { ...newRoute(region, R.kind), waypoints: R.waypoints.map(([lat, lon]) => ({ lat, lon })) });
  const course: any = viewCourse(stored, M.P);
  const xs = course.line.map(p => p.x), zs = course.line.map(p => p.z);
  const around = { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cz: (Math.min(...zs) + Math.max(...zs)) / 2, radius: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2 + 300 };
  const out = { region, M, course, stored, around, laps: R.laps ?? 1 };
  regions.set(region, out);
  return out;
}

// A route through a region's densest tile (its biggest baked tile: the most buildings, roads and props),
// corner to corner through its middle and a little beyond — the 8-car race's worst case for the frame budget
export async function densestTileRoute(region: string) {
  const key = `${region}:densest`;
  if (regions.has(key)) return regions.get(key);
  const M = await mapHarness(region), T = M.manifest.grid.tileSize, dir = new URL(`../../assets/map/${region}/tiles/`, import.meta.url);
  const tile = fs.readdirSync(dir).filter(f => f.endsWith('.m3t')).map(f => ({ f, size: fs.statSync(new URL(f, dir)).size })).sort((a, b) => b.size - a.size)[0];
  const [i, j] = tile.f.replace('.m3t', '').split('_').map(Number);
  const ll = (fx: number, fz: number) => { const [lat, lon] = M.P.toLatLon((i + fx) * T, (j + fz) * T); return { lat, lon }; };
  const N = createNetwork(M.graph(), { P: M.P, region, version: M.manifest.version, bbox: M.manifest.bbox });
  const { course: stored } = saveCourse(N, { ...newRoute(region, 'p2p'), waypoints: [ll(-0.25, -0.25), ll(0.5, 0.5), ll(1.25, 1.25)] });
  const course: any = viewCourse(stored, M.P);
  const xs = course.line.map(p => p.x), zs = course.line.map(p => p.z);
  const around = { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cz: (Math.min(...zs) + Math.max(...zs)) / 2, radius: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2 + 300 };
  const out = { region, M, course, stored, around, laps: 1, tile: { i, j, bytes: tile.size } };
  regions.set(key, out);
  return out;
}

// the quest controller's adapters for the Node physics (tests/map/quests.test.ts's)
export function nodeAdapters(S: any, sim: any) {
  let held = false, throttle = 0;
  const v = () => sim.vehicle;
  const place = (pt: any, speed = 0) => { const [sx, sz] = S.toSim(pt.x, pt.z), y = S.ground(pt.x, pt.z, pt.h + 30, false, 200) ?? pt.h; sim.resetCar({ position: [sx, y + 0.3, sz], headingDeg: pt.heading, speed }); };
  const holdStep = sim.onStep(() => { if (!held) return; const b = v().body; b.setLinvel({ x: 0, y: Math.min(0, b.linvel().y), z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true); });
  return {
    setThrottle(t: number) { throttle = t; },
    onStep: (fn: any) => sim.onStep((s: any) => fn(s.time, s.dt)),
    place: (pt: any) => place(pt), hold() { held = true; }, release() { held = false; }, resetTo: (pt: any) => place(pt), ready: () => true,
    carState() {
      const b = v().body, p = b.translation(), q = b.rotation(), l = b.linvel();
      const fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y), m = Math.hypot(fx, fz) || 1;
      return { x: p.x + S.origin[0], y: p.y, z: p.z + S.origin[1], q: [q.x, q.y, q.z, q.w], vx: l.x, vy: l.y, vz: l.z, fx: fx / m, fz: fz / m, throttle, drivable: true, condition: 100, impulse: 0 };
    },
    free() { holdStep(); },
  };
}

export async function playerService(H: any) {
  const p = new LocalPlayerService({ db: H.db, storage: new MemoryStorage(), quests: { config: qcfg, recordings: new MemoryRecordStore(), npc: ncfg } });
  await p.init();
  await p.addMoney(1e6);
  return p;
}

// One race: the player's car (the starter car) driven by a bot driver of playerSkill, NPCs from data/npc.json
export async function runRace(R: any, { npcs = 7 as number | any[], seed = 1, collisions = 'full', rubberBand = false, playerSkill = 0.6, fps = 0, limit = 900, quest: q = null, keepSim = false, onStep = null as any, playerCar = 'starter_car', S: given = null as any, player: givenPlayer = null as any, garageState = null as any, series = null as any } = {}) {
  const { M, course } = R, H = M.H;
  const quest: any = q ?? { id: `q_race_${R.region}`, kind: 'quest', type: 'sprint', version: 3, updated: '2026-01-01T00:00:00Z', route: 'r', fee: 0, rewards: { tier: 'standard' }, entry: { classes: [], minLevel: 1 }, params: { laps: R.laps }, npc: { count: typeof npcs === 'number' ? npcs : npcs.length, skill: [0.3, 0.95], drivers: 'random', rubberBand } };
  // (the player's own car as it's built, when given: its parts in the physics)
  const pStats = H.garage(garageState, playerCar).stats();
  const S = given ?? await M.simAround(R.around.cx, R.around.cz, { radius: R.around.radius, spec: pStats.spec });
  const sim = S.sim, frame = { toWorld: (x: number, z: number) => [x + S.origin[0], z + S.origin[1]], toSim: (x: number, z: number) => [x - S.origin[0], z - S.origin[1]], probeAbove: S.probeAbove ?? null };
  const player = givenPlayer ?? await playerService(H);
  const A = nodeAdapters(S, sim);
  let race: any = null;
  const C = createQuestController({ quest, course, config: qcfg, player, car: { instanceId: player.profile.currentCar, carId: playerCar, topSpeed: 60 }, adapters: A, race: () => race, series });
  const st = await C.start({ intro: false });
  if (!st.ok) throw new Error(st.error);
  // the NPCs: drivers, cars from the parts system, on the grid behind the player
  const setup = setupNpcs({ db: H.db, quest, course, cfg: ncfg, qcfg, seed, playerRating: pStats.totals.rating.index, picks: Array.isArray(npcs) ? npcs : null, count: typeof npcs === 'number' ? npcs : npcs.length });
  for (const n of setup) n.sockets = H.socketsOf(n.spec);
  race = createRace({ sim, frame, course, quest, qcfg, cfg: ncfg, db: H.db, sessionRules, playerSession: C.session, npcs: setup, seed, collisions, rubberBand });
  // the player's bot
  const K = driverParams({ skill: playerSkill }, ncfg), caps = carCaps(pStats);
  const RL = fittedRacing(course, sim, frame), plan = speedPlan(RL, caps, { loop: course.loop, corner: K.cornerMargin, braking: K.brakingPoint });
  const bot = createAiDriver({ id: 0, rl: RL, line: course.line, loop: course.loop, plan, caps, params: K, rng: rng(hashSeed(seed, 'player')), frame, config: ncfg,
    ctx: { started: () => C.state === 'racing', near: () => race.near(0), adjust: () => ({ corner: 0, braking: 0 }) } });
  const input = () => { const i = bot(sim.vehicle, sim.dt); A.setThrottle(C.state === 'racing' ? i.throttle : 0); return C.state === 'racing' ? i : { device: 'wheel', throttle: 0, brake: 1, steer: 0, handbrake: false }; };
  const events: any[] = [];
  let t = 0, steps = 0, ms = 0, worstFrame = 0, botResets = 0;
  const resetsAt: any[] = [];
  const frameDt = fps ? 1 / fps : sim.dt;
  for (; t < limit && !C.ending; t += frameDt) {
    const t0 = performance.now();
    if (fps) sim.advance(frameDt, input); else sim.step(input());
    const dtm = performance.now() - t0;
    ms += dtm; worstFrame = Math.max(worstFrame, dtm); steps++;
    for (const e of race.drain()) events.push({ ...e, t: race.time });
    // (the bot's own recovery: the route's reset, as the player's R)
    if (bot.state.wantsReset && C.state === 'racing') { const Q = C.session, pt = Q.tracker.resetPoint(); resetsAt.push({ t: Math.round(t), s: Math.round(Q.tracker.state.s ?? 0), why: bot.state.why ?? null }); A.resetTo(pt); Q.noteReset(pt); bot.placed(0); botResets++; }
    onStep?.({ sim, race, C, t });
  }
  const res = C.ending ? await C.ending : null;
  race.finishUp();
  const standings = race.results();
  const out = { standings, res, events, ms, steps, worstFrame, botResets, resetsAt, race, C, S, sim, player, setup, t };
  if (!keepSim) { race.dispose(); A.free(); C.dispose(); if (!given) S.free(); }
  return out;
}
