// A physics bot (Phase 7 Step 3; docs/CONTACT.md "Tests"): a headless player whose car is simulated for real
// (physics/sim.js, the game's own) on a generated track, driven by a script, with car-to-car contact exactly as the
// game does it (mp/contactClient.js: proxies, the capped push, reports, the agreed result blended in) and the run
// recorded for the verifier (mp/runRecord.js). It goes through the real protocol (mp/client.js) from the lobby to the
// results, like Step 2's bots (mp/bot.js), which only follow a speed plan.
//
//   const B = createPhysicsBot({ name, RAPIER, settings, spec, sockets, T (mp/verify.js trackFor), session (mp/client.js),
//     quests, cfg (data/multiplayer.json), damage (garage/carDamage.js CarDamage, or null), script, hz })
//     script(B, t) → the input this frame ({ steer, throttle, brake }) from the lights going out (t: s since GO); B.me,
//       B.others(), B.drive(lane, speed) (a lane-keeping helper along the course) help
//   B.done → { result, verdict, finished }    B.metrics (the worst vertical speed, spin, …; the contacts; damage)
//   B.stop()      B.handIn: whether it hands its run in at the finish (default true)

import { createSimulation } from '../physics/sim.js';
import { createContactClient } from './contactClient.js';
import { createRunRecorder } from './runRecord.js';
import { yawOf } from './contact.js';
import { createQuestSession } from '../quest/session.js';
import { buildResult } from '../quest/result.js';
import { createRecorder } from '../quest/recording.js';
import { raceQuest } from './quest.js';
import { nearestOnTrack } from '../track/scene.js';
import { project, at } from '../route/geometry.js';
import { packCrash } from '../garage/damageLog.js';

const quat = q => [q.x, q.y, q.z, q.w];

export function createPhysicsBot({ name = 'bot', RAPIER, settings, spec, sockets, T, session: S, quests, cfg, damage = null, script, hz = 60, handIn = true, car = { carId: 'starter_car', topSpeed: 62 }, behave = {} }) {
  const sim = createSimulation(RAPIER, { settings, spec, sockets, track: T.track });
  const recorder = createRunRecorder({ sim });
  const box = spec.bodyCollider, mass = spec.mass, course = T.course;
  const log = [], say = x => log.push(`${Date.now()} ${name}: ${x}`);
  const metrics = { maxVy: 0, maxYawRate: 0, maxRoll: 0, maxLift: 0, lifts: [], contacts: [], agreed: [], rejected: [], effects: [], ghosts: [], impacts: [], ramming: [], penalties: [] };
  let liftBase = null;
  let C = null, offset = null, timer = null, lastWall = null, released = false, Q = null, rec = null, quest = null, handed = false, tick = 0, goT = null;
  let finish, done = new Promise(r => { finish = r; });
  const me = () => S.lobby?.players.find(p => p.uid === S.myUid);
  const others = () => {
    const out = new Map(), net = S.race?.net;
    if (!net) return out;
    for (const p of S.lobby?.players ?? []) {
      if (p.uid === S.myUid || p.npc || p.role !== 'racer') continue;
      const np = [...net.players.values()].find(x => x.uid === p.uid);
      if (np) out.set(p.uid, { id: np.id, box: p.car?.box ?? box, mass: p.car?.mass ?? mass, name: p.name });
    }
    return out;
  };

  S.on('load', m => {
    stop(); released = false; handed = false; Q = null; goT = null;
    quest = raceQuest({ raceId: m.raceId, venue: m.venue.venue, laps: m.laps, loop: course.loop, trackHash: m.venue.trackHash ?? null });
    S.send({ t: 'loaded', hash: behave.hash ?? m.venue.trackHash ?? null });
    say(`loaded ${m.venue?.name}`);
  });
  S.on('phase', m => {
    if (m.phase === 'countdown' && !timer) toGrid();
    if (m.phase === 'results') { if (!handed) finish({ result: null, verdict: null, finished: false }); }
  });
  for (const k of ['contact', 'contact-rejected', 'ghosts']) S.on(k, m => {
    C?.message(m);
    if (k === 'contact') metrics.agreed.push(m);
    if (k === 'contact-rejected') metrics.rejected.push(m);
    if (k === 'ghosts') metrics.ghosts.push({ t: Date.now(), list: m.list });
  });
  S.on('ramming', m => { metrics.ramming.push(m); });
  S.on('event', m => { if (m.e?.type === 'penalty' && m.e.pid === S.myUid) metrics.penalties.push(m.e); });
  S.on('verdict', m => finish({ result: lastResult, verdict: m.verdict, finished: true }));
  let lastResult = null;

  function toGrid() {
    const p = me();
    if (!p || p.role !== 'racer' || p.slot == null) { say('not racing'); return; }
    const slot = course.grid.slots[p.slot], h = nearestOnTrack(T.data, slot.x, slot.z).h;
    sim.resetCar({ position: [slot.x, h + (spec.spawnHeight ?? 0.6), slot.z], headingDeg: slot.heading });
    const net = S.race.net;
    offset = net.stampAt() / 1000 - sim.time;
    C = createContactClient({ sim, net, send: x => S.send(x), cfg: cfg.contact, myUid: S.myUid, mine: () => ({ box, mass }), others, roomAt: simT => (simT + offset) * 1000,
      mode: () => S.lobby?.settings?.collisions ?? 'ghost', recorder,
      onImpact: (impact, { scale, result }) => {
        metrics.impacts.push({ t: Date.now(), strength: impact.strength, scale });
        if (!damage) return;
        const out = damage.hit(impact, { scale });
        const crash = packCrash(out, damage.build);
        if (Object.keys(crash.hits ?? {}).length || crash.broken?.length) net.sendEvent({ kind: 'damage', crash });
      },
      onEffect: e => metrics.effects.push({ t: Date.now(), ...e }) });
    Q = createQuestSession({ quest, course, config: quests, car, startMode: 'standing', externalGo: true, slot: p.slot });
    Q.begin({ intro: false });
    rec = createRecorder({ hz: quests.recording?.hz ?? 20 });
    say(`on slot ${p.slot}`);
    lastWall = performance.now();
    timer = setInterval(frame, 1000 / hz);
  }

  // a lane along the course, at a speed: the steering (towards a point ahead, so far off the centreline) and the pedals
  function drive(lane = 0, speed = 20, { look = 10 } = {}) {
    const b = sim.vehicle.body, p = b.translation(), l = b.linvel(), yaw = yawOf(b.rotation());
    const pr = project(course.line, p.x, p.z), s = pr.s + look + Math.hypot(l.x, l.z) * 0.4, a = at(course.line, s, course.loop);
    const tx = a.x + a.dz * lane, tz = a.z - a.dx * lane;                       // (+lane: to the left, as project's d)
    const want = Math.atan2(tx - p.x, tz - p.z);
    let err = want - yaw; while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
    const v = l.x * Math.sin(yaw) + l.z * Math.cos(yaw), dv = speed - v;
    return { steer: Math.max(-1, Math.min(1, err * 2.2)), throttle: dv > 0 ? Math.min(1, dv * 0.35) : 0, brake: dv < -1 ? Math.min(1, -dv * 0.25) : 0, device: 'wheel' };
  }
  const state = () => {
    const b = sim.vehicle.body, p = b.translation(), l = b.linvel(), yaw = yawOf(b.rotation()), pr = project(course.line, p.x, p.z);
    return { pos: [p.x, p.y, p.z], vel: [l.x, l.y, l.z], yaw, speed: Math.hypot(l.x, l.z), s: pr?.s ?? 0, d: pr?.d ?? 0 };
  };

  function frame() {
    const net = S.race?.net;
    if (!net || !C) return;
    const wall = performance.now(), dt = Math.min(0.1, Math.max(1e-3, (wall - lastWall) / 1000));
    lastWall = wall;
    const goAt = S.goAt, t = (sim.time + offset) * 1000;
    if (goAt != null) Q?.setGo(goAt / 1000);
    // the lights out: the car reset exactly where it is (the replay starts the same way), its run recorded from here
    if (!released && goAt != null && t >= goAt) {
      released = true; goT = goAt;
      const b = sim.vehicle.body, p = b.translation();
      recorder.start({ pose: { position: [p.x, p.y, p.z], headingDeg: yawOf(b.rotation()) * 180 / Math.PI }, t0: t, carId: car.carId });
      say('go');
    }
    const since = goT != null ? (t - goT) / 1000 : null;
    const input = !released ? { steer: 0, throttle: 0, brake: 1, device: 'wheel' } : (script?.(api, since) ?? drive(0, 20));
    sim.advance(dt, input);
    C.frame(dt);
    // (the worst of it: lifted, spun, rolled — no car may be launched by contact)
    const b = sim.vehicle.body, l = b.linvel(), a = b.angvel(), up = b.rotation();
    metrics.maxVy = Math.max(metrics.maxVy, Math.abs(l.y));
    metrics.maxYawRate = Math.max(metrics.maxYawRate, Math.abs(a.y));
    metrics.maxRoll = Math.max(metrics.maxRoll, Math.acos(Math.min(1, 1 - 2 * (up.x * up.x + up.z * up.z))));
    // (how high above the road: a car launched leaves it — measured from its height once settled after the start)
    if (released) {
      const p = b.translation(), h = nearestOnTrack(T.data, p.x, p.z, p.y).h, lift = p.y - h;
      if (since != null && since > 0.8) { liftBase ??= lift; metrics.maxLift = Math.max(metrics.maxLift, lift - liftBase); metrics.lifts.push([t, lift - liftBase, Math.abs(a.y)]); if (metrics.lifts.length > 4000) metrics.lifts.shift(); }
    }
    const snap = sim.snapshot();
    net.update(dt, () => ({ tick: ++tick, pos: snap.position, rot: [snap.rotation.x, snap.rotation.y, snap.rotation.z, snap.rotation.w], vel: snap.velocity, ang: [a.x, a.y, a.z],
      steer: Math.max(-1, Math.min(1, snap.steer ?? 0)), throttle: snap.throttle ?? 0, brake: snap.brake ?? 0, gear: 1, rpm: snap.engine?.rpm ?? 0,
      wheels: (snap.wheels ?? []).map(w => ({ omega: w.omega ?? 0, length: w.length ?? 0, slip: w.combinedSlip ?? 0, grounded: !!w.grounded })), flags: 0, ageMs: 0 }));
    net.sample(dt);
    // the run, timed by the game's own QuestSession on the race's clock
    if (Q && (Q.state.state === 'countdown' || Q.state.state === 'racing')) {
      const yaw = yawOf(b.rotation()), p = b.translation();
      Q.tick({ t: t / 1000, dt, x: p.x, z: p.z, vx: l.x, vz: l.z, fx: Math.sin(yaw), fz: Math.cos(yaw), throttle: input.throttle ?? 0, drivable: true, condition: 1 });
      if (goT != null && t >= goT) rec.sample((t - goT) / 1000, { x: p.x, y: p.y, z: p.z, q: quat(b.rotation()), vx: l.x, vy: l.y, vz: l.z });
    }
    Q?.drain();
    if (handIn && !handed && Q && (Q.state.state === 'finished' || Q.state.state === 'results') && Q.outcome) {
      handed = true;
      let result = buildResult({ quest, course, outcome: Q.outcome, car });
      let record = recorder.stop();
      record = behave.tamper ? behave.tamper(record) : record;
      lastResult = result;
      say(`finished: ${result.rawTime} s`);
      S.sendRun(result, rec.finish({ questId: quest.id }), record);
    }
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  const api = {
    name, sim, log, metrics, drive, others, state, recorder,
    get me() { return state(); },
    get contact() { return C; },
    get done() { return done; },
    get released() { return released; },
    // (the last run's record, for a test to tamper with or inspect)
    takeRecord() { return recorder.on ? recorder.stop() : null; },
    stop() { stop(); C?.dispose(); },
    dispose() { stop(); C?.dispose(); try { sim.vehicle.world.free(); } catch { /* gone */ } },
  };
  return api;
}
