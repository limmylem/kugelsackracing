// A race against NPCs (Phase 4 Step 4), on top of the player's QuestSession (quest/session.js). Each NPC
// is a car in the same physics (physics/sim.js addCar, its own model and build from the parts system),
// driven by its own AI driver (ai/driver.js) and timed by its own QuestSession — the same gates,
// checkpoints, laps and sub-tick timing as the player's. No page, no renderer: the game and the headless
// tests run it the same way.
//
// Every physics tick (sim.onStep, after the player's quest controller):
//   - the NPCs' sessions are ticked (their countdown is the player's: GO at the same tick);
//   - the positions: from progress along the route (laps and distance), the finished by time, DNFs last;
//     gaps to the car ahead and behind (from when each passed where the other is now);
//   - what each driver knows of the others: the cars near it along the route (no raycasts);
//   - damage: each NPC's hits worked out by the player's rules (garage/carDamage.js, the session's
//     collision mode), its physics told (garage stats → its spec), slower when badly damaged, retired
//     (DNF) when undrivable;
//   - resets: an NPC lost or out of the corridor is put back on the route at its last reset point
//     (faded out and in by the game), never into another car;
//   - rubber-banding (if on): small changes to the NPCs' cornering margin and braking, by their gap to
//     the player, capped — never their car or the physics;
//   - level of detail: an NPC far from the player and out of view leaves the physics and runs along its
//     racing line on its speed plan; it comes back, at the same place and speed, before it can be seen.
//
//   const R = createRace({ sim, frame, course, quest, qcfg, cfg, playerSession, npcs, seed, collisions,
//                          rubberBand, isVisible, playerName })
//     npcs: [{ profile, params, spec, sockets, build (ai/npcCars.js), slot }]
//   R.standings() → [{ id, name, place, status, u, lap, time, gap, gapAhead, gapBehind, player, car, bestLap }]
//   R.playerPlace()   R.drain() → events (npc-reset, npc-retired, npc-finish, lod, impact)   R.results()
//   R.finishUp()  (the player's done: the NPCs still racing get their times worked out)   R.dispose()

import { createQuestSession } from '../quest/session.js';
import { createAiDriver } from '../ai/driver.js';
import { rng as makeRng, hashSeed } from '../ai/rng.js';
import { speedPlan, carCaps, lapTime } from '../route/racingLine.js';
import { groundHeight } from '../physics/ai.js';
import { fittedRacing } from './fit.js';
import { CarDamage } from '../garage/carDamage.js';
import { drivability } from '../garage/repair.js';
import { createSession } from '../physics/race.js';
import { headingOf } from '../route/grid.js';

const BIN = 10;
// a spec refilled in place, as the game's own car's is (garage/session.js assignDeep)
function assignDeep(target, source) {
  for (const k of Object.keys(target)) if (!(k in source)) delete target[k];
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) assignDeep(target[k], v);
    else target[k] = Array.isArray(v) ? JSON.parse(JSON.stringify(v)) : v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
  }
  return target;
}          // (m: how often each car's passing time is noted, for the gaps)

export function createRace({ sim, frame, course, quest, qcfg, cfg, db, sessionRules, playerSession, npcs, seed = 1, collisions = 'full', rubberBand = false, isVisible = null, playerName = 'You' }) {
  const L = course.length, loop = course.loop;
  // (a finished NPC's cool-down lap: its speeds at 60%)
  const COOL_DOWN = { corner: -0.64, braking: 0 };
  // (the racing line fitted to the world's kerbs and walls, now they're loaded)
  const RL = fittedRacing(course, sim, frame);
  const laps = loop ? Math.max(1, quest.params?.laps ?? 1) : 1;
  const play = sessionRules ? createSession(sessionRules, 'race', { collisions }) : { scale: () => 1, collisions };
  if (sim.collisions !== collisions) sim.setCollisions(collisions);
  const events = [];
  const emit = e => events.push(e);
  const racers = [];
  const byId = id => racers.find(r => r.id === id);
  // the player: its session's tracker is its progress (none: an AI test race, NPCs only)
  const player = playerSession ? { id: 0, player: true, name: playerName, session: playerSession, passes: [], status: 'racing', finishTime: null } : null;
  if (player) racers.push(player);

  // NPCs: on their grid slots, each a car in the physics with its driver and session
  const npcQuest = { ...quest, type: 'sprint', params: { ...(quest.params ?? {}), laps, start: 'standing' } };
  for (const [i, n] of npcs.entries()) {
    const id = i + 1, slot = course.grid.slots[n.slot ?? i + 1] ?? course.grid.slots.at(-1);
    const caps = carCaps(n.build.stats);
    const r = makeRng(hashSeed(seed, n.profile.id, i));
    const plan = speedPlan(RL, caps, { loop, corner: n.params.cornerMargin, braking: n.params.brakingPoint, start: 0 });
    const racer = { id, player: false, name: n.profile.name, profile: n.profile, params: n.params, build: n.build, spec: n.spec, caps, plan, basePlan: plan, slot, passes: [], status: 'grid', finishTime: null, adjust: { corner: 0, braking: 0 }, lod: 'full', lodSince: 0, damage: null, condition: 100, retired: false, resets: 0, cheap: null };
    racer.driver = createAiDriver({ id, rl: RL, line: course.line, loop, plan, caps, params: n.params, rng: r, frame, config: cfg,
      // (on a circuit, a finished NPC drives on — a cool-down lap, slower — rather than stopping on the line
      // in the way of everyone still racing)
      ctx: { started: () => racer.session?.state.state === 'racing' || (loop && racer.status === 'finished'), near: me => near(me), adjust: me => byId(me)?.adjust } });
    const [sx, sz] = frame.toSim(slot.x, slot.z);
    const carId = sim.addCar({ position: [sx, 0, sz], headingDeg: slot.heading, speed: 0 }, racer.driver, n.spec, n.sockets);
    racer.carId = carId;
    racer.car = sim.cars.find(c => c.id === carId);
    placeOnGround(racer, slot.x, slot.z, slot.heading, 0);
    racer.car.vehicle.mechanical.enabled = true;
    racer.damage = new CarDamage({ car: n.build.garage.car, build: n.build.garage.build, view: n.build.garage.view, boxes: n.boxes ?? {}, rules: db.damage, mode: 'full' });
    racer.session = createQuestSession({ quest: npcQuest, course, config: qcfg, car: { topSpeed: caps.topSpeed } });
    racer.session.begin({ intro: false });
    racer.session.drain();
    racers.push(racer);
  }
  const npcList = racers.filter(r => !r.player);

  function placeOnGround(r, x, z, heading, speed) {
    const v = r.car.vehicle, [sx, sz] = frame.toSim(x, z);
    const y = groundHeight(v, sx, sz) ?? 0;
    // (put down moving — back from the cheap run — at its ride height, not dropped: a drop at speed
    // bottoms the suspension and the floor catches the road, spinning it)
    v.reset({ position: [sx, y + (speed > 1 ? 0.05 : 0.35), sz], headingDeg: heading, speed });
  }
  const posOf = r => {
    if (r.player) { const b = sim.vehicle.body, p = b.translation(), l = b.linvel(); const [x, z] = frame.toWorld(p.x, p.z); return { x, z, vx: l.x, vz: l.z }; }
    if (r.cheap) return { x: r.cheap.x, z: r.cheap.z, vx: r.cheap.vx, vz: r.cheap.vz };
    const b = r.car.vehicle.body, p = b.translation(), l = b.linvel(), [x, z] = frame.toWorld(p.x, p.z);
    return { x, z, vx: l.x, vz: l.z };
  };
  const uOf = r => r.session?.tracker.state.u ?? 0;
  const dOf = r => r.session?.tracker.state.d ?? 0;

  // the cars near a driver along the route (+ du: ahead; + dd: to its left)
  function near(me) {
    const self = byId(me), u0 = uOf(self), d0 = dOf(self), out = [];
    for (const o of racers) {
      if (o === self || o.status === 'retired' || o.cheap) continue;
      let du = uOf(o) - u0;
      if (loop) { const lapLen = L; du = ((du % lapLen) + lapLen * 1.5) % lapLen - lapLen / 2; }
      if (du < -60 || du > 90) continue;
      const p = posOf(o);
      out.push({ id: o.id, du, dd: dOf(o) - d0, v: Math.hypot(p.vx, p.vz) });
    }
    return out;
  }

  // ---------- each tick ----------
  let t = 0, started = false;
  const detach = sim.onStep(s => tick(s.time, s.dt));
  function tick(time, dt) {
    t = time;
    const P = playerSession?.state ?? {};
    // the NPCs' countdown is the player's: they start counting the tick it does, and go on the same tick
    if (!started && (!playerSession || P.tCount != null)) started = true;
    for (const r of npcList) {
      if (!started || r.status === 'finished' || r.status === 'retired') continue;
      const p = posOf(r), b = r.car.vehicle.body, q = b.rotation();
      const fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y), m = Math.hypot(fx, fz) || 1;
      r.session.tick({ t: time, dt, x: p.x, z: p.z, vx: p.vx, vz: p.vz, fx: fx / m, fz: fz / m, throttle: 0, drivable: true, condition: r.condition });
      if (r.session.state.tGo !== P.tGo && P.tGo != null && r.session.state.state === 'countdown') r.session.state.tGo = P.tGo;
      if (r.status === 'grid' && r.session.state.state === 'racing') r.status = 'racing';
      for (const e of r.session.drain()) {
        if (e.type === 'reset') { emit({ type: 'npc-off', id: r.id, x: p.x, z: p.z, u: uOf(r) }); resetNpc(r, e.point, 'off route'); }
        else if (e.type === 'leave') emit({ type: 'npc-leave', id: r.id, x: p.x, z: p.z, u: uOf(r) });
        else if (e.type === 'finish') { r.status = 'finished'; r.finishTime = e.outcome.time; r.outcome = e.outcome; if (loop) r.adjust = COOL_DOWN; emit({ type: 'npc-finish', id: r.id, time: r.finishTime }); }
        else if (e.type === 'fail') retire(r, e.outcome.text ?? 'failed');
      }
      r.driver.tick(dt);
      if (r.driver.state.wantsReset && r.status === 'racing') { emit({ type: 'npc-stuck', id: r.id, x: p.x, z: p.z, u: uOf(r) }); resetNpc(r, r.session.tracker.resetPoint(), 'stuck'); }
    }
    // the player's progress and status
    if (player && P.state === 'racing') player.status = 'racing';
    if (player && playerSession.outcome && player.status === 'racing') { player.status = playerSession.outcome.status === 'finished' ? 'finished' : 'dnf'; player.finishTime = playerSession.outcome.time; }
    for (const r of racers) note(r);
    // damage (every tick: the hits), its effects a few times a second
    for (const r of npcList) takeHits(r);
    // (one car's at most a tick — the garage's stats take a few ms — and none more often than twice a second)
    { const r = npcList.find(x => x.dirty && time - (x.damagedAt ?? -1) > 0.5); if (r) { r.damagedAt = time; applyDamage(r); } }
    if (rubberBand) band();
    lod(dt);
  }

  // each car's passing time every BIN metres (the gaps)
  function note(r) {
    const u = uOf(r), bin = Math.floor(u / BIN);
    if (bin >= 0 && r.passes[bin] === undefined && (r.status === 'racing' || r.status === 'finished')) r.passes[bin] = t;
  }
  const timeAt = (r, u) => { const bin = Math.floor(u / BIN); return r.passes[bin] ?? null; };

  function takeHits(r) {
    if (r.cheap) return;
    const v = r.car.vehicle;
    for (const impact of v.sensor.take()) {
      const scale = play.scale(impact);
      const out = scale > 0 && !r.retired ? r.damage.hit(impact, { scale }) : null;
      // (for the game: the sparks and sounds, and the dents to draw)
      emit({ type: 'impact', id: r.id, carId: r.carId, impact, scale, result: out?.result ?? null });
      if (!out) continue;
      if (impact.other === 'car') r.driver.hit(impact.strength * scale);
      r.dirty = true;
    }
  }
  // what the hits did: its physics (the garage's stats for the damaged build), how fast it can go, whether it carries on
  function applyDamage(r) {
    r.dirty = false;
    const owned = r.damage.owned, G = r.build.garage;
    for (const [id, o] of Object.entries(owned)) Object.assign(G.state.parts[id], { condition: o.condition, ...(o.damage ? { damage: o.damage } : {}), ...(o.attach ? { attach: o.attach } : {}) });
    const stats = G.stats();
    assignDeep(r.spec, stats.spec);          // (in place: the car's parts hold on to it)
    r.car.vehicle.retune();
    const conds = [r.damage.damage.shell?.condition ?? 100, ...Object.values(owned).map(o => o.condition ?? 100)];
    r.condition = conds.reduce((a, b) => a + b, 0) / conds.length;
    const bySocket = Object.fromEntries(Object.values(owned).map(o => [o.installedOn.socket, { ...o, engine: !!db.parts[o.partId]?.engine }]));
    const D = cfg.damage, ok = drivability(G.car, bySocket, db.damage).ok;
    if (!ok || r.condition < D.retireBelow) { retire(r, ok ? 'too badly damaged' : 'undrivable'); return; }
    // slower in step with the damage
    const f = r.condition >= D.slowFrom ? 1 : 0.65 + 0.35 * (r.condition - D.retireBelow) / (D.slowFrom - D.retireBelow);
    r.caps = carCaps(stats);
    r.plan = speedPlan(RL, { ...r.caps, grip: r.caps.grip * (0.85 + 0.15 * f), power: r.caps.power * f }, { loop, corner: r.params.cornerMargin, braking: r.params.brakingPoint, start: 0 });
    r.driver.setPlan(r.plan);
  }
  function retire(r, why) {
    if (r.retired) return;
    r.retired = true; r.status = 'retired'; r.why = why;
    r.driver.retire();
    if (r.session.state.state === 'racing' || r.session.state.state === 'countdown') r.session.fail('retired', `Retired (${why})`);
    r.session.drain();
    emit({ type: 'npc-retired', id: r.id, why });
  }

  // back on the route at its reset point (or further back), never into another car
  function resetNpc(r, point, why) {
    if (r.retired) return;
    const C = cfg.recovery;
    // (put back at the same place again and again: it can't get past there — it retires, as a driver
    // would, rather than going round in circles)
    const here = point.u ?? point.s ?? 0;
    r.resetSpots = (r.resetSpots ?? []).filter(u => Math.abs(u - here) < 40);
    r.resetSpots.push(here);
    if (r.resetSpots.length > (C.sameSpotResets ?? 3)) { retire(r, 'stuck'); return; }
    let pt = point;
    for (let tries = 0; tries < 6; tries++) {
      const clear = racers.every(o => o === r || o.status === 'retired' || (() => { const p = posOf(o); return Math.hypot(p.x - pt.x, p.z - pt.z) > C.clearance; })());
      if (clear) break;
      const s = loop ? (((pt.s - 10) % L) + L) % L : Math.max(0, pt.s - 10), g = course.line, k = Math.max(0, Math.min(g.length - 1, Math.round(s / (L / (g.length - 1)))));
      pt = { ...pt, x: g[k].x, z: g[k].z, h: g[k].h, s, u: (pt.u ?? 0) - 10, heading: headingOf(g[Math.min(g.length - 1, k + 1)].x - g[k].x, g[Math.min(g.length - 1, k + 1)].z - g[k].z) };
    }
    if (r.cheap) leaveCheap(r);
    r.car.vehicle.parts.clear();
    placeOnGround(r, pt.x, pt.z, pt.heading, 0);
    r.session.noteReset(pt);
    r.driver.placed(nearestK(pt.x, pt.z));
    r.resets++;
    emit({ type: 'npc-reset', id: r.id, why, fade: C.fadeSeconds });
  }
  function nearestK(x, z) {
    const P = RL.points;
    let best = 0, bd = Infinity;
    for (let i = 0; i < P.length; i++) { const d = (P[i].x - x) ** 2 + (P[i].z - z) ** 2; if (d < bd) { bd = d; best = i; } }
    return best;
  }

  // rubber-banding: by each NPC's gap to the player (s, + ahead), a little more careful ahead, bolder behind
  function band() {
    if (!player) return;
    const B = cfg.rubberBand, pu = uOf(player);
    for (const r of npcList) {
      if (r.status !== 'racing') { r.adjust = r.status === 'finished' && loop ? COOL_DOWN : { corner: 0, braking: 0 }; continue; }
      // (how far ahead in time, + ahead: ahead, how long ago it was where the player is now; behind, how
      // long ago the player was where it is now)
      const u = uOf(r), ta = u >= pu ? timeAt(r, pu) : timeAt(player, u);
      const gap = ta == null ? (u - pu) / Math.max(5, posSpeed(player)) : (u >= pu ? 1 : -1) * (t - ta);
      const g = Math.abs(gap) < B.deadZone ? 0 : gap - Math.sign(gap) * B.deadZone;
      let a = Math.max(-B.cap, Math.min(B.cap, -B.strength * g / B.range));
      // (never bolder than the most skilled driver would be)
      a = Math.min(a, cfg.skill.cornerMargin[1] - r.params.cornerMargin);
      r.adjust = { corner: a, braking: a };
    }
  }
  const posSpeed = r => { const p = posOf(r); return Math.hypot(p.vx, p.vz); };

  // ---------- level of detail ----------
  function lod(dt) {
    if (!player) return;          // (an AI test race: every car in the physics)
    const LD = cfg.lod, pp = posOf(player);
    for (const r of npcList) {
      if (r.status !== 'racing') { if (r.cheap) leaveCheap(r); continue; }
      const p = posOf(r), dist = Math.hypot(p.x - pp.x, p.z - pp.z);
      const seen = isVisible ? isVisible(p.x, p.z) : false;
      const wantFull = dist < LD.fullWithin || (seen && dist < LD.visibleWithin);
      if (r.cheap) {
        stepCheap(r, dt);
        if (wantFull) leaveCheap(r, dist);
      } else {
        r.lodSince = !wantFull && dist > LD.cheapBeyond && !seen ? r.lodSince + dt : 0;
        if (r.lodSince > LD.coolDown) enterCheap(r, dist);
      }
    }
  }
  function enterCheap(r, dist = null) {
    const v = r.car.vehicle, b = v.body, l = b.linvel(), k = r.driver.state.k, was = posOf(r);
    r.cheap = { k, s: RL.points[k].s, v: Math.max(0, r.driver.state.speed), x: 0, z: 0, vx: l.x, vz: l.z, lap: 0 };
    placeCheap(r);
    r.car.offPhysics = true;
    b.setEnabled(false);
    r.lod = 'cheap';
    emit({ type: 'lod', id: r.id, to: 'cheap', dist, jump: Math.hypot(r.cheap.x - was.x, r.cheap.z - was.z) });
  }
  // along the racing line on its speed plan, at its own pace (no physics)
  function stepCheap(r, dt) {
    const C = r.cheap, P = RL.points, n = P.length, len = RL.length;
    const want = r.plan[C.k] * r.driver.state.pace * Math.sqrt(1 + r.adjust.corner);
    C.v += Math.max(-r.caps.brake * 0.8 * dt, Math.min(2.5 * dt, want - C.v));
    C.s += C.v * dt;
    if (loop && C.s >= len) C.s -= len;
    while (C.k < n - 1 && P[C.k + 1].s <= C.s) C.k++;
    if (loop && C.k === n - 1 && C.s < P[n - 1].s) C.k = 0;
    if (!loop && C.k >= n - 1) C.s = P[n - 1].s;
    placeCheap(r);
  }
  function placeCheap(r) {
    const C = r.cheap, P = RL.points, n = P.length, a = P[C.k], b = P[Math.min(n - 1, C.k + 1)] ?? a;
    const f = b.s > a.s ? Math.max(0, Math.min(1, (C.s - a.s) / (b.s - a.s))) : 0;
    C.x = a.x + (b.x - a.x) * f; C.z = a.z + (b.z - a.z) * f;
    const dx = b.x - a.x, dz = b.z - a.z, m = Math.hypot(dx, dz) || 1;
    C.vx = dx / m * C.v; C.vz = dz / m * C.v; C.heading = headingOf(dx, dz); C.h = a.h + (b.h - a.h) * f;
    // (its body follows, roughly: the minimap and the standings, and where it comes back)
    const [sx, sz] = frame.toSim(C.x, C.z);
    r.car.vehicle.body.setTranslation({ x: sx, y: C.h + 0.4, z: sz }, false);
  }
  function leaveCheap(r, dist = null) {
    const C = r.cheap;
    r.cheap = null;
    r.car.offPhysics = false;
    r.car.vehicle.body.setEnabled(true);
    placeOnGround(r, C.x, C.z, C.heading, C.v);
    r.driver.placed(C.k);
    r.lod = 'full'; r.lodSince = 0;
    // (where it is now and how fast, against the cheap run's: the same, or the switch would show)
    const now = posOf(r);
    emit({ type: 'lod', id: r.id, to: 'full', speed: C.v, dist, jump: Math.hypot(now.x - C.x, now.z - C.z), speedJump: Math.abs(Math.hypot(now.vx, now.vz) - C.v) });
  }

  // ---------- standings ----------
  function standings() {
    const list = racers.map(r => ({ r, u: uOf(r) }));
    const rank = x => x.r.status === 'finished' ? [0, x.r.finishTime] : x.r.status === 'retired' || x.r.status === 'dnf' ? [2, -x.u] : [1, -x.u];
    list.sort((a, b) => { const A = rank(a), B = rank(b); return A[0] - B[0] || A[1] - B[1]; });
    return list.map((x, i) => {
      const r = x.r, ahead = list[i - 1]?.r, behind = list[i + 1]?.r;
      const gapTo = o => {
        if (!o) return null;
        if (r.status === 'finished' && o.status === 'finished') return Math.abs(r.finishTime - o.finishTime);
        const [lead, follow] = uOf(o) > uOf(r) ? [o, r] : [r, o], tl = timeAt(lead, uOf(follow));
        return tl == null ? null : t - tl;
      };
      const S = r.session?.state;
      return { id: r.id, name: r.name, place: i + 1, status: r.status, player: !!r.player, u: x.u, lap: Math.min(laps, Math.floor(x.u / (loop ? L : course.grid.finishS - course.grid.startS)) + 1),
        time: r.finishTime, gapAhead: gapTo(ahead), gapBehind: gapTo(behind), car: r.player ? null : db.cars[r.build.carId]?.name ?? r.build.carId, carId: r.player ? null : r.build.carId,
        bestLap: S?.lapTimes?.length ? Math.min(...S.lapTimes) : null, colour: r.profile?.colour ?? null, why: r.why ?? null, lod: r.lod ?? 'full', estimated: !!r.estimated };
    });
  }

  return {
    racers, npcs: npcList, laps,
    standings,
    playerPlace: () => standings().find(x => x.player)?.place ?? 1,
    get done() { return npcList.every(r => r.status === 'finished' || r.status === 'retired'); },
    drain: () => events.splice(0),
    near,
    get time() { return t; },
    // the player's done: the NPCs still going get the time they'd have finished in (their speed plan from
    // where they are, at their pace), marked as estimated
    finishUp() {
      // (the player's finish, if the race hasn't seen it yet: it's handed in the tick it happens)
      if (player && playerSession.outcome && player.status === 'racing') { player.status = playerSession.outcome.status === 'finished' ? 'finished' : 'dnf'; player.finishTime = playerSession.outcome.time; }
      for (const r of npcList) {
        if (r.status !== 'racing' && r.status !== 'grid') continue;
        const P = RL.points, k = r.cheap?.k ?? r.driver.state.k, n = P.length;
        const lapLen = loop ? L : course.grid.finishS - course.grid.startS, left = Math.max(0, lapLen * laps - uOf(r));
        // (the plan's time from here to the end of the line, and whole laps after it)
        const rest = lapTime(RL, r.plan, { from: k, to: n - 1 }), full = lapTime(RL, r.plan);
        const lapsLeft = Math.max(0, Math.ceil(left / lapLen) - 1);
        const t0 = r.session.state.t0 ?? 0;
        r.finishTime = (t - t0) + (rest + lapsLeft * full) / Math.max(0.8, r.driver.state.pace);
        r.status = 'finished'; r.estimated = true;
      }
    },
    results() {
      return standings().map(s => ({ ...s, time: s.time != null ? Math.round(s.time * 1000) / 1000 : null }));
    },
    dispose() {
      detach();
      for (const r of npcList) { r.car.vehicle.parts.clear(); sim.removeCar(r.carId); }
      events.length = 0;
    },
  };
}
