// A bot racer (Phase 7 Step 2; docs/MULTIPLAYER.md "Bots"): a headless player that goes from the lobby to the results
// through the real protocol, as the game does — it loads the course (and says so, with its track's hash), waits on its
// grid slot, drives off when the lights go out (on the server's clock), sends its car ~30 times a second, and times
// its own run with the game's QuestSession (the same gates, laps, sub-tick timing and result as a person's), handing
// it in at the end to be checked. The tests and the load test fill races with them.
//
//   const B = createRaceBot({ session (mp/client.js), courseFor(venue) → course, skill, car, behave })
//     behave: { jumpStart: true (creeps off its slot before the lights), cutCheckpoint: n (hands in a run without
//       its nth checkpoint: it won't pass the check), fakeTime: s (hands in a run s faster than it drove), hash: '…'
//       (says it built another track), drop: { atSec } (its connection drops), leaveAtSec (it quits) }
//   B.done → a promise: { result, verdict, finished }      B.log   B.stop()

import { createQuestSession } from '../quest/session.js';
import { buildResult } from '../quest/result.js';
import { createRecorder } from '../quest/recording.js';
import { raceQuest } from './quest.js';
import { speedPlan, createNpcDriver } from './npc.js';

export function createRaceBot({ session: S, courseFor, quests, cfg, skill = 0.9, car = { carId: 'starter_car', topSpeed: 62 }, behave = {}, hz = 60 }) {
  const log = [], say = x => log.push(`${Date.now()} ${x}`);
  let course = null, Q = null, driver = null, timer = null, lastT = null, rec = null, quest = null, handed = false, tick = 0;
  let finish, done = new Promise(r => { finish = r; });
  const me = () => S.lobby?.players.find(p => p.uid === S.myUid);
  S.on('load', async m => {
    try {
      course = await courseFor(m.venue);
      quest = raceQuest({ raceId: m.raceId, venue: m.venue.venue, laps: m.laps, loop: course.loop, trackHash: course.trackHash ?? null });
      S.send({ t: 'loaded', hash: behave.hash ?? course.trackHash ?? null });
      say(`loaded ${m.venue?.name}`);
    } catch (e) { say(`couldn't load: ${e.message}`); }
  });
  S.on('phase', m => {
    if (m.phase === 'countdown' && course && !timer) start();
    if (m.phase === 'results') stop();
  });
  S.on('event', m => {
    const e = m.e;
    if (e.type === 'grid' && e.late && course && !timer && e.order?.some(o => o.pid === S.myUid)) start();
  });
  S.on('verdict', m => { finish({ result: lastResult, verdict: m.verdict, finished: true }); });
  S.on('results', () => { if (!handed) finish({ result: null, verdict: null, finished: false }); });
  let lastResult = null;

  function start() {
    const p = me();
    if (!p || p.role !== 'racer' || p.slot == null) { say('not racing'); return; }
    const slot = course.grid.slots[p.slot];
    driver = createNpcDriver({ line: course.line, loop: course.loop, plan: speedPlan(course.line, { loop: course.loop, cfg }), slot, skill });
    Q = createQuestSession({ quest, course, config: quests, car, startMode: 'standing', externalGo: true, slot: p.slot });
    Q.begin({ intro: false });
    rec = createRecorder({ hz: quests.recording?.hz ?? 20 });
    say(`on slot ${p.slot}`);
    timer = setInterval(frame, 1000 / hz);
  }
  function frame() {
    const net = S.race?.net;
    if (!net || !Q) return;
    const t = net.roomNow(), goAt = S.goAt;
    if (goAt != null) { Q.setGo(goAt / 1000); if (t >= goAt && !driver.started) { driver.started = true; driver.go(goAt); } }
    const dt = lastT == null ? 1 / hz : Math.max(1e-3, (t - lastT) / 1000);
    lastT = t;
    // (misbehaving, for the tests)
    if (behave.leaveAtSec != null && goAt != null && t > goAt + behave.leaveAtSec * 1000) { say('leaving'); stop(); void S.leaveRace(); finish({ result: null, verdict: null, finished: false, left: true }); return; }
    if (behave.drop && goAt != null && !behave.dropped && t > goAt + behave.drop.atSec * 1000) { behave.dropped = true; say('dropping'); net.conn?.breakConnection?.(); }
    let s = driver.state(t);
    if (behave.jumpStart && goAt != null && t < goAt && t > goAt - 2000) s = { ...s, pos: [s.pos[0] + 3, s.pos[1], s.pos[2]] };
    const fwd = Math.hypot(s.vel[0], s.vel[2]) > 0.1 ? [s.vel[0] / Math.hypot(s.vel[0], s.vel[2]), s.vel[2] / Math.hypot(s.vel[0], s.vel[2])] : [0, 1];
    net.update(dt, () => ({ ...s, tick: ++tick, ageMs: 0 }));
    net.sample(dt);
    if (Q.state.state === 'countdown' || Q.state.state === 'racing') {
      Q.tick({ t: t / 1000, dt, x: s.pos[0], z: s.pos[2], vx: s.vel[0], vz: s.vel[2], fx: fwd[0], fz: fwd[1], throttle: s.throttle, drivable: true, condition: 1 });
      rec.sample(t / 1000, { x: s.pos[0], y: s.pos[1], z: s.pos[2], q: s.rot, vx: s.vel[0], vy: s.vel[1], vz: s.vel[2] });
    }
    Q.drain();
    if (!handed && (Q.state.state === 'finished' || Q.state.state === 'results') && Q.outcome) {
      handed = true;
      driver.finish();
      let result = buildResult({ quest, course, outcome: Q.outcome, car });
      if (behave.fakeTime) result = { ...result, rawTime: Math.round((result.rawTime - behave.fakeTime) * 1000) / 1000, time: Math.round((result.time - behave.fakeTime) * 1000) / 1000, laps: result.laps.map((l, i) => i ? l : Math.round((l - behave.fakeTime) * 1000) / 1000), checkpoints: result.checkpoints.map(c => ({ ...c, time: Math.round((c.time - behave.fakeTime) * 1000) / 1000 })) };
      if (behave.cutCheckpoint != null) result = { ...result, checkpoints: result.checkpoints.filter((_, i) => i !== behave.cutCheckpoint) };
      lastResult = result;
      say(`finished: ${result.rawTime} s`);
      S.send({ t: 'run', result, recording: rec.finish({ questId: quest.id }) });
    }
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  return { log, get done() { return done; }, get course() { return course; }, get session() { return Q; }, stop };
}
