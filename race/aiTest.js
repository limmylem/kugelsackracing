// The editor's AI test race (and the tests'): the quest's rivals race its route on their own, in the
// physics on the route's own world, at normal speed (to watch) or as fast as it'll go; then a solo lap
// at each skill level (data/npc.json skill.levels) for the AI reference times (route course.aiTimes, by
// car class: the medal targets use them). Where AIs crash, leave the route or get stuck is noted; a spot
// where it happens more than once (or anyone gets stuck) is a problem spot, marked on the route.
//
//   const T = createAiTest({ makeSim, socketsOf, course, quest, db, cfg, qcfg, sessionRules, seed, playerRating })
//     makeSim(spec) → Promise<{ sim, frame, free() }> a physics world with the route's ground in it
//   await T.start()   T.step(seconds) (real time × speed; 'fast': as much as fits in budgetMs)   T.done
//   T.cars() → [{ id, name, x, z, colour, status, place }]   T.report() → { standings, spots, aiTimes, carClass, laps }

import { createRace } from './race.js';
import { setupNpcs } from './setup.js';
import { createQuestSession } from '../quest/session.js';
import { createAiDriver } from '../ai/driver.js';
import { driverParams } from '../ai/skill.js';
import { rng, hashSeed } from '../ai/rng.js';
import { carCaps, speedPlan } from '../route/racingLine.js';
import { fittedRacing } from './fit.js';
import { classKey } from '../quest/rules.js';
import { groundHeight } from '../physics/ai.js';

export function createAiTest({ makeSim, socketsOf, course, quest, db, cfg, qcfg, sessionRules, seed = 1, playerRating = null, count = null, limit = null }) {
  let world = null, race = null, phase = 'idle', solo = null, levels = Object.entries(cfg.skill.levels), lvl = 0, elapsed = 0;
  const incidents = [], aiTimes = {}, field = [];
  const est = course.stats?.estimatedTime ?? 120, laps = course.loop ? Math.max(1, quest.params?.laps ?? 1) : 1;
  const maxTime = limit ?? Math.max(120, est * laps * 3);
  let carClass = null, refBuild = null;

  async function start() {
    const setup = setupNpcs({ db, quest: { ...quest, npc: { ...(quest.npc ?? {}), count: count ?? Math.max(1, quest.npc?.count ?? cfg.defaults.count) } }, course, cfg, qcfg, seed, playerRating });
    for (const n of setup) n.sockets = await socketsOf(n.spec);
    refBuild = setup[0]?.build ?? null; carClass = classKey(quest);
    world = await makeSim(setup[0].spec);
    race = createRace({ sim: world.sim, frame: world.frame, course, quest, qcfg, cfg, db, sessionRules, playerSession: null, npcs: setup, seed, collisions: 'full' });
    phase = 'race'; elapsed = 0;
  }

  // one solo lap at a skill level: the reference car (the first rival's build), on its own
  async function startSolo() {
    if (lvl >= levels.length) { phase = 'done'; return; }
    const [name, skill] = levels[lvl];
    world?.free(); world = await makeSim(refBuild.stats.spec);
    const { sim, frame } = world, caps = carCaps(refBuild.stats), K = driverParams({ skill, mistakeRate: 0 }, cfg);
    const RL = fittedRacing(course, sim, frame), plan = speedPlan(RL, caps, { loop: course.loop, corner: K.cornerMargin, braking: K.brakingPoint });
    const Q = createQuestSession({ quest: { ...quest, type: 'sprint' }, course, config: qcfg, car: { topSpeed: caps.topSpeed } });
    const D = createAiDriver({ id: 0, rl: RL, line: course.line, loop: course.loop, plan, caps, params: K, rng: rng(hashSeed(seed, name)), frame, config: cfg, ctx: { started: () => Q.state.state === 'racing' } });
    const slot = course.grid.slots[0], [sx, sz] = frame.toSim(slot.x, slot.z);
    sim.vehicle.reset({ position: [sx, (groundHeight(sim.vehicle, sx, sz) ?? slot.h) + 0.35, sz], headingDeg: slot.heading });
    Q.begin({ intro: false }); Q.drain();
    const detach = sim.onStep(s => {
      const b = sim.vehicle.body, p = b.translation(), l = b.linvel(), [x, z] = frame.toWorld(p.x, p.z);
      Q.tick({ t: s.time, dt: s.dt, x, z, vx: l.x, vz: l.z, throttle: 0, drivable: true, condition: 100 });
      for (const e of Q.drain()) if (e.type === 'reset') { const pt = e.point, [rx, rz] = frame.toSim(pt.x, pt.z); sim.vehicle.reset({ position: [rx, (groundHeight(sim.vehicle, rx, rz) ?? pt.h) + 0.35, rz], headingDeg: pt.heading }); Q.noteReset(pt); }
    });
    solo = { name, Q, D, detach, t: 0 };
    phase = 'solo';
  }

  function note(e) {
    if (!['npc-off', 'npc-stuck', 'npc-leave', 'npc-retired'].includes(e.type) || e.x == null) return;
    incidents.push({ kind: { 'npc-off': 'off route', 'npc-stuck': 'stuck', 'npc-leave': 'left the route', 'npc-retired': 'crashed out' }[e.type], x: e.x, z: e.z, u: e.u, id: e.id });
  }

  return {
    start,
    get phase() { return phase; },
    get done() { return phase === 'done'; },
    // real seconds × speed (the race), or as much as budgetMs allows (fast)
    async step(seconds, { fast = false, budgetMs = 30 } = {}) {
      if (phase === 'race') {
        const sim = world.sim, t0 = performance.now();
        if (fast) { while (performance.now() - t0 < budgetMs && !race.done && elapsed < maxTime) { sim.step(idle); elapsed += sim.dt; } }
        else { sim.advance(seconds, idle); elapsed += seconds; }
        for (const e of race.drain()) note(e);
        if (race.done || elapsed >= maxTime) {
          race.finishUp();
          field.push(...race.results());
          race.dispose(); lvl = 0;
          await startSolo();
        }
      } else if (phase === 'solo') {
        const sim = world.sim, t0 = performance.now();
        while (performance.now() - t0 < (fast ? budgetMs : budgetMs / 2) && !solo.Q.outcome && solo.t < maxTime) { sim.step(solo.D(sim.vehicle, sim.dt)); solo.t += sim.dt; }
        if (solo.Q.outcome || solo.t >= maxTime) {
          solo.detach();
          if (solo.Q.outcome?.status === 'finished') aiTimes[solo.name] = Math.round(solo.Q.outcome.time * 10) / 10;
          lvl++;
          await startSolo();
          if (phase === 'done') { world.free(); world = null; }
        }
      }
    },
    cars() {
      if (phase !== 'race') return [];
      return race.standings().map(s => { const r = race.racers.find(x => x.id === s.id), p = r.car.vehicle.body.translation(), [x, z] = world.frame.toWorld(p.x, p.z); return { id: s.id, name: s.name, x, z, colour: s.colour, status: s.status, place: s.place }; });
    },
    // problem spots: incidents within 40 m of each other, grouped; flagged when more than one, or a car got stuck
    report() {
      const spots = [];
      for (const inc of incidents) {
        let spot = spots.find(s => Math.hypot(s.x - inc.x, s.z - inc.z) < 40);
        if (!spot) spots.push(spot = { x: inc.x, z: inc.z, u: inc.u, kinds: {}, count: 0, cars: new Set() });
        spot.count++; spot.kinds[inc.kind] = (spot.kinds[inc.kind] ?? 0) + 1; spot.cars.add(inc.id);
      }
      const flagged = spots.filter(s => s.count > 1 || s.kinds.stuck || s.kinds['crashed out']).map(s => ({ x: Math.round(s.x), z: Math.round(s.z), u: Math.round(s.u ?? 0), count: s.count, cars: s.cars.size, kinds: s.kinds,
        message: `AIs ${Object.entries(s.kinds).map(([k, n]) => `${k}${n > 1 ? ` ×${n}` : ''}`).join(', ')} ${Math.round((s.u ?? 0))} m along the route.` }));
      return { standings: field, spots: flagged, incidents: incidents.slice(), aiTimes: { ...aiTimes }, carClass, laps };
    },
    dispose() { solo?.detach?.(); race?.dispose?.(); world?.free?.(); world = null; },
  };
}
const idle = { device: 'wheel', throttle: 0, brake: 0, steer: 0, handbrake: false };
