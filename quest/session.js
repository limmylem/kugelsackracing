// One quest, start to finish, pure: every quest type runs through the same states and the type's own module
// (quest/types/) adds its rules on top. Nothing of the game in here: the game (play/questController.js)
// feeds it the car each physics tick and does what its events say (place the car, hold it, let it go,
// reset it); the tests feed it made-up cars.
//
//   ready → intro (a fly-along of the route, skippable) → countdown (the car on its grid slot, held; a
//   standing start: GO at an exact tick, a jump start costs time; a rolling start: let go at speed, the
//   clock starting at the line) → racing → finished | failed → results
//
//   const Q = createQuestSession({ quest, course (route/model.js viewCourse), config (data/quests.json),
//                                   car: { topSpeed }, startMode, best: { splits, laps, time, score } })
//   Q.begin({ intro })  Q.frame(realDt)  the intro's time (screen time: it's only the camera)  Q.skipIntro()
//   Q.tick({ t, dt, x, z, vx, vz, fx, fz, throttle, drivable, condition, impulse })   every physics tick
//   Q.noteReset(point)  after the car's been put back      Q.quit()  a DNF      Q.fail(reason, text)
//   Q.drain() → the events since      Q.hud() → what the HUD shows      Q.outcome  when it's over
//   externalGo (Phase 7 Step 2, a multiplayer race): the countdown doesn't set GO itself — Q.setGo(t) does (t on the
//   ticks' clock: when the race server's lights go out), and may move it as the clocks settle, until it's passed
//
// Times: a gate (a line across the road) is crossed between two ticks; where along that tick gives the
// time (quest/timing.js), so times don't depend on the frame rate.

import { crossTime } from './timing.js';
import { medalTargets, medalOf } from './rules.js';
import { createTracker } from '../route/tracker.js';
import { TYPE_MODULES } from './types/index.js';

export const STATES = ['ready', 'intro', 'countdown', 'racing', 'finished', 'failed', 'results'];
const NEAR = 40;   // (a gate counts when the car is this near it along the route: not another pass by it)

export function createQuestSession({ quest, course, config, car = {}, startMode = null, best = null, laps = null, slot = 0, externalGo = false }) {
  const type = TYPE_MODULES[quest.type];
  if (!type) throw new Error(`no quest type "${quest.type}"`);
  const P = quest.params ?? {}, loop = course.loop;
  laps = loop ? Math.max(1, laps ?? P.laps ?? 1) : 1;
  startMode = startMode ?? P.start ?? 'standing';
  const L = course.length, startS = course.grid.startS, lapLength = loop ? L : course.grid.finishS - startS;
  const rel = s => loop ? (((s - startS) % L) + L) % L : s - startS;
  const gates = course.gates.map(g => ({ ...g, r: rel(g.s) })).sort((a, b) => a.r - b.r);
  const required = gates.filter(g => g.required);
  const tracker = createTracker({ line: course.line, loop, startS, finishS: course.grid.finishS, checkpoints: course.checkpoints, laps, corridor: course.corridor });
  const targets = medalTargets(quest, course, config);
  const events = [];

  // everything the type modules and the HUD read
  const S = {
    quest, course, config, laps, startMode, targets, best, car, tracker, required, gates, lapLength,
    state: 'ready', introT: 0, introLength: config.intro?.seconds ?? 0,
    tCount: null, tGo: null, t0: null, t: 0, clock: 0, count: null,
    prev: null, lap: 0, next: 0, missed: null, splits: [], lapTimes: [], bonus: new Set(),
    extension: 0, limit: null, penalties: [], jump: false,
    cond0: null, condition: 100, damage: 0, damageEvents: [], wreckFor: 0, resets: 0,
    score: null, message: null, outcome: null, slot,
  };
  const emit = e => { events.push(e); return e; };
  const T = (type.init?.(S) ?? {});
  Object.assign(S, T);

  const clockAt = t => t - S.t0;
  const penalty = () => S.penalties.reduce((a, p) => a + p.seconds, 0);
  const splitIndex = n => S.lap * required.length + n;

  function end(status, { time = null, reason = null, text = null } = {}) {
    if (S.state !== 'racing' && S.state !== 'countdown' && S.state !== 'intro' && S.state !== 'ready') return;
    const raw = time ?? (S.t0 != null ? S.clock : null);
    const extra = type.finish?.(S, status) ?? {};
    const total = status === 'finished' && raw != null ? raw + penalty() : null;
    const score = S.score;
    const lapTimes = S.lapTimes.slice();
    S.outcome = {
      status, reason, text, questId: quest.id, type: quest.type, startMode, jump: S.jump,
      rawTime: raw, time: total, penalties: S.penalties.slice(), score,
      medal: status === 'finished' ? medalOf(targets, { time: total, score }) : null, targets,
      laps: lapTimes, bestLap: lapTimes.length ? Math.min(...lapTimes) : null,
      splits: S.splits.map(s => ({ ...s })),
      damage: { taken: S.damage, events: S.damageEvents.slice() }, resets: S.resets,
      ...extra,
    };
    S.state = status === 'finished' ? 'finished' : 'failed';
    emit({ type: status === 'finished' ? 'finish' : 'fail', outcome: S.outcome });
  }

  function gateCrossed(g, target, cur) {
    if (!S.prev || Math.abs(tracker.state.u - target) > NEAR) return null;
    return crossTime(g, S.prev, cur);
  }

  function racingTick(I) {
    const cur = { x: I.x, z: I.z, t: I.t };
    if (S.t0 != null) S.clock = clockAt(I.t);
    for (const e of tracker.update(I.dt, { x: I.x, z: I.z, vx: I.vx ?? 0, vz: I.vz ?? 0 })) {
      if (e.type === 'leave' || e.type === 'wrongway') { S.message = e.message; emit(e); }
      else if (e.type === 'return' || e.type === 'rightway') { S.message = null; emit(e); }
      else if (e.type === 'reset') { emit(e); }
    }
    // a rolling start: the clock starts as the car crosses the start line
    if (S.t0 == null) {
      const tc = gateCrossed(course.start, 0, cur);
      if (tc != null) { S.t0 = tc; S.clock = clockAt(I.t); emit({ type: 'clock', t: tc }); }
      S.prev = cur;
      if (S.t0 == null) return;
    }
    const base = S.lap * lapLength;
    // the checkpoints, in order
    for (const g of gates) {
      const target = base + g.r, tc = gateCrossed(g, target, cur);
      if (tc == null) continue;
      if (!g.required) {
        const key = `${S.lap}:${g.id}`;
        if (!S.bonus.has(key)) { S.bonus.add(key); S.extension += g.timeExtension; emit({ type: 'bonus', id: g.id, extension: g.timeExtension, time: clockAt(tc) }); }
        continue;
      }
      const n = required.indexOf(g);
      if (n === S.next) {
        const time = clockAt(tc), i = splitIndex(n), was = best?.splits?.[i];
        const split = { id: g.id, number: n + 1, of: required.length, lap: S.lap + 1, time, delta: was != null ? time - was : null };
        S.splits.push(split); S.next++; S.missed = null; S.extension += g.timeExtension;
        if (S.message?.startsWith('Missed')) S.message = null;
        emit({ type: 'checkpoint', ...split, extension: g.timeExtension });
        type.checkpoint?.(S, split, emit);
      } else if (n > S.next) missed();
    }
    // driven past the next one without going through it
    if (S.next < required.length && tracker.state.u > base + required[S.next].r + 25) missed();
    // the line: a lap or the finish
    const lineTarget = (S.lap + 1) * lapLength, tc = gateCrossed(course.finish, lineTarget, cur);
    if (tc != null) {
      if (S.next < required.length) missed();
      else {
        const time = clockAt(tc), lapTime = time - S.lapTimes.reduce((a, b) => a + b, 0);
        S.lapTimes.push(lapTime); S.lap++; S.next = 0; S.missed = null;
        const bestLap = Math.min(...S.lapTimes, ...(best?.laps ?? []));
        if (S.lap >= laps) { S.clock = time; S.prev = cur; if (type.finishLine?.(S, emit) !== false) end('finished', { time }); return; }
        emit({ type: 'lap', lap: S.lap, of: laps, lapTime, best: lapTime <= bestLap, time });
      }
    }
    S.prev = cur;
  }
  function missed() {
    if (S.missed === S.next) return;
    S.missed = S.next;
    const g = required[S.next];
    S.message = `Missed checkpoint ${S.next + 1}: go back through it.`;
    emit({ type: 'missed', number: S.next + 1, id: g.id, x: g.x, z: g.z, message: S.message });
  }

  const api = {
    state: S, type, tracker,
    get outcome() { return S.outcome; },
    begin({ intro = true } = {}) {
      if (type.enabled === false) throw new Error(type.disabledReason ?? `${quest.type} quests can't be played yet`);
      if (intro && S.introLength > 0) { S.state = 'intro'; emit({ type: 'intro', seconds: S.introLength }); }
      else api.toGrid();
      return api;
    },
    frame(realDt) {
      if (S.state !== 'intro') return;
      S.introT += realDt;
      if (S.introT >= S.introLength) api.toGrid();
    },
    skipIntro() { if (S.state === 'intro') api.toGrid(); },
    // (a multiplayer race: GO when the race server says — on the ticks' clock)
    setGo(t) { if (externalGo && (S.state === 'countdown' || S.state === 'ready' || S.state === 'intro')) S.goAt = t; },
    toGrid() {
      S.state = 'countdown';
      const rolling = startMode === 'rolling', R = config.start;
      emit({ type: 'place', slot: course.grid.slots[slot] ?? course.grid.slots[0], rolling, rollingDistance: R.rollingDistance, rollingSpeed: R.rollingKmh / 3.6 });
    },
    tick(I) {
      S.t = I.t;
      if (S.state === 'countdown') {
        const R = config.start;
        if (S.tCount == null) { S.tCount = I.t; S.tGo = externalGo ? (S.goAt ?? Infinity) : I.t + R.countdown; tracker.begin(I.x, I.z).start(); }
        if (externalGo && S.goAt != null) S.tGo = S.goAt;
        const left = S.tGo - I.t;
        const n = Math.ceil(left - 1e-9);
        if (n > 0 && n <= R.countdown && n !== S.count) { S.count = n; emit({ type: 'count', n }); }
        if (startMode !== 'rolling' && !S.jump && (I.throttle ?? 0) > R.jumpThrottle && left <= R.jumpWindow + 1e-9) {
          S.jump = true; S.penalties.push({ what: 'Jump start', seconds: R.jumpPenalty });
          emit({ type: 'jump', penalty: R.jumpPenalty });
        }
        if (left <= 1e-9) {
          S.state = 'racing'; S.count = 0;
          if (startMode !== 'rolling') { S.t0 = S.tGo; S.clock = clockAt(I.t); }
          S.prev = { x: I.x, z: I.z, t: I.t };
          emit({ type: 'go', rolling: startMode === 'rolling', speed: config.start.rollingKmh / 3.6 });
        }
        return;
      }
      if (S.state !== 'racing') return;
      racingTick(I);
      if (S.state !== 'racing') return;
      // damage (Phase 3's: the car's overall condition, as the game works it out)
      if (I.condition != null) {
        S.cond0 ??= I.condition;
        const drop = Math.max(0, S.cond0 - I.condition);
        if (drop > S.damage + 1e-6 || (I.impulse ?? 0) > 0) {
          if (drop > S.damage + 1e-6) S.damageEvents.push({ t: Math.round(S.clock * 1000) / 1000, drop: Math.round((drop - S.damage) * 100) / 100, impulse: Math.round(I.impulse ?? 0) });
          S.damage = drop;
        }
        S.condition = I.condition;
      }
      type.tick?.(S, I, emit, end);
      if (S.state !== 'racing') return;
      // the clock: a type with a limit (and the extensions earned)
      if (S.limit != null && S.t0 != null && S.clock >= S.limit + S.extension) {
        if (type.timeUp) type.timeUp(S, emit, end); else end('failed', { reason: 'time', text: 'Out of time' });
        if (S.state !== 'racing') return;
      }
      // wrecked: undrivable for a while
      if (I.drivable === false) {
        S.wreckFor += I.dt;
        if (S.wreckFor >= (config.wreck?.seconds ?? 1.5)) end('failed', { reason: 'wrecked', text: 'Wrecked' });
      } else S.wreckFor = 0;
    },
    noteReset(point) { tracker.resetTo(point); S.prev = null; S.resets++; S.message = null; },
    quit() { end('dnf', { reason: 'quit', text: 'Did not finish' }); },
    fail(reason, text) { end('failed', { reason, text }); },
    finish(time) { end('finished', { time }); },
    showResults() { if (S.state === 'finished' || S.state === 'failed') S.state = 'results'; },
    drain() { return events.splice(0); },
    // what the HUD shows
    hud() {
      const nextGate = S.next < required.length ? required[S.next] : course.finish;
      const last = S.splits.at(-1) ?? null;
      return {
        state: S.state, count: S.count, clock: S.t0 != null ? S.clock : 0, running: S.t0 != null && S.state === 'racing', penalty: penalty(),
        lap: Math.min(laps, S.lap + 1), laps, checkpoint: S.next, checkpoints: required.length,
        split: last, bestLap: S.lapTimes.length ? Math.min(...S.lapTimes) : null, lapTimes: S.lapTimes,
        timeLeft: S.limit != null ? Math.max(0, S.limit + S.extension - (S.t0 != null ? S.clock : 0)) : null,
        next: { x: nextGate.x, z: nextGate.z, h: nextGate.h, id: nextGate.id ?? 'finish' }, message: S.message,
        progress: tracker.state.progress, position: { place: 1, of: 1, live: false },
        panel: type.hud?.(S) ?? null,
      };
    },
  };
  return api;
}
