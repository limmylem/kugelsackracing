// Generated tracks in Node (Phase 5 Step 3's tests): a track made and built, its course, a physics world
// on it (the cars put down on its road), its AI reference times, and an event raced on it through the
// game's own quest controller and PlayerService (tests/map/raceHarness.ts runRace) — as the game runs it.
//
//   const T = makeTrack(spec, cfg)  → { gen, data, track, course }
//   const S = trackSimOf(H, T, spec)  → { sim, origin, toSim, ground, free }   (runRace's S)
//   const R = await trackReference(H, T, carClass, { cache })  → reference.js's result
//   const out = await raceEvent(H, T, quest, { npcs, seed, playerSkill, player })  → runRace's out
//   const A = await aiRace(H, T, { cars, laps, seed })  → the AI racers on their own (race/aiTest.js): { report, closeness }

import fs from 'node:fs';
import { generateTrack } from '../track/generate.js';
import { buildTrack, trackWorld, trackProjection } from '../track/build.js';
import { nearestOnTrack } from '../track/scene.js';
import { viewCourse } from '../route/model.js';
import { createSimulation } from '../physics/sim.js';
import { referenceTimes, withAiTimes } from '../track/events/reference.js';
import { trackHash } from '../track/events/hash.js';
import { runRace, qcfg, ncfg, sessionRules } from './map/raceHarness.ts';
import { createAiTest } from '../race/aiTest.js';
import { aiCloseness } from '../track/quality.js';

export const tracksCfg = JSON.parse(fs.readFileSync(new URL('../data/tracks.json', import.meta.url), 'utf8'));
export const eventsCfg = JSON.parse(fs.readFileSync(new URL('../data/trackEvents.json', import.meta.url), 'utf8'));

export function makeTrack(spec: any, cfg = tracksCfg) {
  const gen = generateTrack(spec);
  if (!gen.ok) throw new Error(gen.error);
  const data: any = buildTrack(gen, cfg), course: any = viewCourse(data.course, trackProjection);
  course.trackHash = trackHash(data);
  return { gen, data, track: trackWorld(data), course };
}
// a physics world on the track (the car put down on the road, not at height 0)
export function simOn(H: any, T: any, spec: any) {
  const sim = createSimulation(H.RAPIER, { settings: H.settings, spec, sockets: H.socketsOf(spec), track: T.track });
  sim.vehicle.body.enableCcd(true);
  const reset = sim.resetCar.bind(sim);
  sim.resetCar = (pose: any) => { const [x, y, z] = pose.position; reset({ ...pose, position: [x, nearestOnTrack(T.data, x, z, y || null).h + 0.6, z] }); };
  return sim;
}
export function trackSimOf(H: any, T: any, spec: any) {
  const sim = simOn(H, T, spec);
  return { sim, origin: [0, 0], toSim: (x: number, z: number) => [x, z], probeAbove: T.data.crossing ? 4 : null, ground: (x: number, z: number, hint: number | null = null) => nearestOnTrack(T.data, x, z, hint != null ? hint - 30 : null).h, free() { sim.vehicle.world.free(); } };
}
const makeSimOn = (H: any, T: any) => async (spec: any) => { const sim = simOn(H, T, spec); return { sim, frame: { toWorld: (x: number, z: number) => [x, z], toSim: (x: number, z: number) => [x, z], probeAbove: T.data.crossing ? 4 : null }, free: () => sim.vehicle.world.free() }; };
// the AI reference times, the solo laps in a world of their own
export async function trackReference(H: any, T: any, carClass = 'open', { cache = null as any } = {}) {
  const makeSim = makeSimOn(H, T);
  const R = await referenceTimes({ data: T.data, course: T.course, carClass, makeSim, socketsOf: H.socketsOf, db: H.db, npcCfg: ncfg, qcfg, sessionRules, cache, cfg: eventsCfg, budgetMs: 1e9 });
  withAiTimes(T.course, carClass, R);
  return R;
}
// one event raced: the player's car by a bot, NPCs as the event says (or none)
export async function raceEvent(H: any, T: any, quest: any, { npcs = null as any, seed = 1, playerSkill = 0.7, player = null as any, limit = null as any } = {}) {
  const xs = T.course.line.map((p: any) => p.x), zs = T.course.line.map((p: any) => p.z);
  const R = { region: 'track', M: { H }, course: T.course, stored: T.data.course, laps: quest.params?.laps ?? 1, around: { cx: 0, cz: 0, radius: Math.max(...xs.map(Math.abs), ...zs.map(Math.abs)) } };
  const S = trackSimOf(H, T, H.garage(null, 'starter_car').stats().spec);
  const laps = T.course.loop ? Math.max(1, quest.params?.laps ?? 1) : 1;
  const out: any = await runRace(R, { npcs: npcs ?? quest.npc?.count ?? 0, seed, playerSkill, S, quest, player, limit: limit ?? Math.max(300, (T.data.course.stats.estimatedTime ?? 100) * laps * 3), collisions: quest.params?.collisions ?? 'full' });
  S.free();
  return out;
}
// The AI racers on their own (the editor's AI test race, race/aiTest.js — its race only, not its reference
// laps): how close their race was (track/quality.js aiCloseness: finishers bunched, places changing)
export async function aiRace(H: any, T: any, { cars = tracksCfg.quality.ai.cars, laps = tracksCfg.quality.ai.laps, seed = 4242, skill = tracksCfg.quality.ai.skill as number[] } = {}) {
  const type = T.course.loop ? 'circuit_race' : 'hillclimb', quest: any = { id: 'trk_ai_race', type, params: T.course.loop ? { laps } : {}, npc: { count: cars, skill, drivers: 'random' }, carClass: null };
  const test = createAiTest({ makeSim: makeSimOn(H, T), socketsOf: H.socketsOf, course: T.course, quest, db: H.db, cfg: ncfg, qcfg, sessionRules, seed, count: cars });
  await test.start();
  while (test.phase === 'race') await test.step(1 / 60, { fast: true, budgetMs: 1e9 });
  const report = test.report();
  test.dispose();
  const results = report.standings.map((r: any) => ({ status: r.status, time: r.time ?? null }));
  return { report, results, closeness: aiCloseness(results, { raceTime: report.raceTime, overtakes: report.overtakes, cars }, tracksCfg) };
}
