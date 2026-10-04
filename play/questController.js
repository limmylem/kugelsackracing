// A quest played in a world: the QuestSession (quest/session.js) driven by the physics, the fee and the
// reward through PlayerService, the best run recorded. Nothing of the page or the renderer in here — the
// game hands it adapters for its car, so the same controller runs in the browser and in the Node tests
// (tests/map/quests.test.ts drives every quest type with it on real roads).
//
//   const C = createQuestController({ quest, course (viewCourse), config, player (PlayerService), car,
//                                     adapters, best, startMode, onEvent, onEnd })
//     car: { instanceId, carId, className, kw, kg, topSpeed, fingerprint }
//     adapters: {
//       onStep(fn(t, dt)) → detach    every physics tick, after it (t: the simulation's time)
//       place({ x, z, h, heading }, { speed })   the car there, facing along (a rolling start: moving)
//       hold() / release({ speed })   the car held still until GO, then let go (rolling: at speed)
//       resetTo(point)                back on the route (the tracker's reset point), the damage kept
//       carState() → { x, y, z, q, vx, vy, vz, fx, fz, throttle, drivable, condition, impulse }
//       ready() → whether the car's on the ground and may be timed (not being put down by the streamer)
//     }
//   await C.start({ restart, intro })  → { ok, error, reasons }   (the fee: taken here, refunded if it fails)
//   C.frame(realDt)  (the intro's clock)   C.skipIntro()   C.introCamera() → { x, y, z, lookX, lookY, lookZ }
//   await C.quit()   a DNF        await C.restart()   quit + start again (a fee again unless config says free)
//   C.session  C.state  C.results  (once it's over: { outcome, result, pay, pb })   C.dispose()

import { createQuestSession } from '../quest/session.js';
import { createRecorder } from '../quest/recording.js';
import { buildResult } from '../quest/result.js';
import { at } from '../route/geometry.js';
import { headingOf } from '../route/grid.js';

export function createQuestController({ quest, course, config, player, car = {}, adapters: A, best = null, startMode = null, onEvent = () => {}, onEnd = () => {} }) {
  let Q = null, rec = null, detach = null, attemptId = null, placed = false, ending = null, results = null, disposed = false;

  function handle(e) {
    if (e.type === 'place') {
      const slot = e.slot;
      if (e.rolling) {
        // (behind the start line by the rolling distance, along the route)
        const s0 = course.grid.startS - e.rollingDistance, L = course.length, p = at(course.line, course.loop ? ((s0 % L) + L) % L : Math.max(0, s0), course.loop);
        A.place({ x: p.x, z: p.z, h: p.h, heading: headingOf(p.dx, p.dz) }, { speed: 0 });
      } else A.place({ x: slot.x, z: slot.z, h: slot.h, heading: slot.heading }, { speed: 0 });
      A.hold();
      placed = true;
    } else if (e.type === 'go') A.release({ speed: e.rolling ? e.speed : 0 });
    else if (e.type === 'reset') { A.resetTo(e.point); Q.noteReset(e.point); }
    else if (e.type === 'clock') rec = createRecorder({ hz: config.recording?.hz ?? 20 });
    onEvent(e);
    if (e.type === 'finish' || e.type === 'fail') ending ??= finishUp(e.outcome);
  }
  function drainAll() { for (const e of Q.drain()) handle(e); }

  function tick(t, dt) {
    if (!Q || disposed) return;
    const st = Q.state.state;
    if (st !== 'countdown' && st !== 'racing') return;
    if (!placed || !A.ready()) return;
    const c = A.carState();
    Q.tick({ t, dt, ...c });
    if (Q.state.t0 != null && Q.state.state === 'racing') {
      rec ??= createRecorder({ hz: config.recording?.hz ?? 20 });
      rec.sample(t - Q.state.t0, c);
    }
    drainAll();
  }

  async function finishUp(outcome) {
    detach?.(); detach = null;
    const recording = outcome.status === 'finished' && rec ? rec.finish() : null;
    let pay = null, result = null;
    if (outcome.status === 'finished') {
      result = buildResult({ quest, course, outcome, car, attemptId });
      pay = await player.finishQuest(result, { quest, course, recording });
    } else {
      pay = await player.failQuest(attemptId, { questId: quest.id, status: outcome.status, reason: outcome.reason });
    }
    results = { outcome, result, pay, pb: !!pay?.pb, recording };
    onEnd(results);
    return results;
  }

  const api = {
    get session() { return Q; },
    get state() { return Q?.state.state ?? 'ready'; },
    get results() { return results; },
    get attemptId() { return attemptId; },
    get ending() { return ending; },
    async start({ restart = false, intro = true } = {}) {
      results = null; ending = null; placed = false; rec = null;
      const st = await player.startQuest(quest, { carInstanceId: car.instanceId, car, restart });
      if (!st.ok) return { ok: false, error: st.error, reasons: st.reasons ?? [] };
      attemptId = st.attemptId;
      try {
        Q = createQuestSession({ quest, course, config, car, startMode, best });
        detach?.();
        detach = A.onStep(tick);
        Q.begin({ intro });
        drainAll();
      } catch (err) {
        // the game couldn't start it: the fee back
        detach?.(); detach = null; Q = null;
        await player.refundQuest(attemptId);
        return { ok: false, error: `Couldn't start the quest: ${err.message}`, refunded: st.fee };
      }
      return { ok: true, fee: st.fee, attemptId };
    },
    frame(realDt) { if (Q?.state.state === 'intro') { Q.frame(realDt); drainAll(); } },
    skipIntro() { if (Q) { Q.skipIntro(); drainAll(); } },
    // the intro's camera: flying along the route, above and behind, a little ahead looked at
    introCamera() {
      if (!Q || Q.state.state !== 'intro') return null;
      const I = config.intro, f = Math.min(1, Q.state.introT / Q.state.introLength), L = course.length;
      const s = course.loop ? (course.grid.startS + f * L) % L : course.grid.startS + f * (course.grid.finishS - course.grid.startS);
      const p = at(course.line, Math.max(0, s), course.loop), ahead = at(course.line, Math.min(L, s + I.behind), course.loop);
      return { x: p.x - p.dx * I.behind, y: p.h + I.height, z: p.z - p.dz * I.behind, lookX: ahead.x, lookY: ahead.h, lookZ: ahead.z, f };
    },
    async quit() {
      if (!Q) return null;
      if (Q.state.state === 'intro' || Q.state.state === 'countdown' || Q.state.state === 'racing' || Q.state.state === 'ready') { Q.quit(); drainAll(); }
      return ending;
    },
    async restart(opts = {}) {
      await api.quit();
      return api.start({ ...opts, restart: true });
    },
    showResults() { Q?.showResults(); },
    dispose() { disposed = true; detach?.(); detach = null; Q = null; rec = null; },
  };
  return api;
}
