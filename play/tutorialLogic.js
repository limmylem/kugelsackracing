// The driving tutorial's steps, as rules (Phase 8 Step 4; docs/ONBOARDING.md) — what each one asks, how the game knows
// it's done from the car as it drives, and what the driving says about which assists suit the player. Kept apart from
// its card on the screen (play/onboarding.js) so it's tested with made-up drives (tests/unit/onboarding.test.mjs).
//
//   const T = createTutorial({ aids })        // aids: the settings' driver aids now
//   T.update({ dt, kmh, throttle, brake, steer, yawRate (rad/s), gripUsed (0..1+, the most of the four),
//              wheelspin (bool), lockup (bool), spin (bool: the car rotating out of control), offRoad (bool) })
//     → { step, index, of, done, advice? }   (step: its id — its words are tutorial.<id>.title / .text in locales)
//   T.skip() — straight to the end · T.advice() — the assists to suggest, with why

export const STEPS = [
  // throttle: get going, smoothly, up to town speed
  { id: 'throttle', done: (s, m) => m.maxKmh >= 40 },
  // braking: from speed to a stop, braking firmly (and seeing ABS keep the steering)
  { id: 'braking', done: (s, m) => m.stoppedFrom >= 35 },
  // cornering: slow before the turn, then turn — two turns of 60° or more at a decent speed without sliding
  { id: 'cornering', done: (s, m) => m.cleanTurns >= 2 },
  // the racing line: wide on the way in, the inside at the apex, wide on the way out — one turn taken quickly and
  // cleanly (the line's what makes the speed possible)
  { id: 'line', done: (s, m) => m.fastTurns >= 1 },
  // the tyres and the sound: push until the tyres squeal (the grip nearly used), then ease off — that's the limit
  { id: 'tyres', done: (s, m) => m.atLimit >= 1.0 },
  // the assists: what this drive says, and where to change them
  { id: 'assists', done: (s, m) => m.adviceSeen },
];

export function createTutorial({ aids = {} } = {}) {
  let i = 0, ended = false;
  const m = { maxKmh: 0, stoppedFrom: 0, brakingFrom: 0, cleanTurns: 0, fastTurns: 0, atLimit: 0, adviceSeen: false,
    turn: null, time: 0, wheelspin: 0, lockup: 0, spins: 0, offRoad: 0, slides: 0 };
  const T = {
    get index() { return i; },
    get step() { return STEPS[i]?.id ?? null; },
    get done() { return ended; },
    update(s) {
      if (ended) return state();
      const dt = s.dt ?? 0.016;
      m.time += dt;
      m.maxKmh = Math.max(m.maxKmh, s.kmh);
      // braking from speed to a stop
      if (s.brake > 0.4 && s.kmh > 5) m.brakingFrom = Math.max(m.brakingFrom, s.kmh);
      if (s.kmh < 2 && m.brakingFrom) { m.stoppedFrom = Math.max(m.stoppedFrom, m.brakingFrom); m.brakingFrom = 0; }
      if (s.brake < 0.1 && s.kmh > 10) m.brakingFrom = 0;
      // turns: the heading swept while turning, at speed, and whether it slid
      const turning = Math.abs(s.yawRate ?? 0) > 0.12 && s.kmh > 15;
      if (turning) { m.turn ??= { swept: 0, slid: false, minKmh: s.kmh, maxGrip: 0 }; m.turn.swept += Math.abs(s.yawRate) * dt; m.turn.slid ||= !!(s.spin || (s.gripUsed ?? 0) > 1.05); m.turn.minKmh = Math.min(m.turn.minKmh, s.kmh); m.turn.maxGrip = Math.max(m.turn.maxGrip, s.gripUsed ?? 0); }
      else if (m.turn) {
        if (m.turn.swept > 1.05 && !m.turn.slid) { m.cleanTurns++; if (m.turn.minKmh > 35 && m.turn.maxGrip > 0.6) m.fastTurns++; }
        if (m.turn.slid) m.slides++;
        m.turn = null;
      }
      // the limit: time with the grip nearly all used, not sliding past it
      if ((s.gripUsed ?? 0) > 0.85 && (s.gripUsed ?? 0) <= 1.1 && s.kmh > 20) m.atLimit += dt;
      // what the drive says about the assists
      if (s.wheelspin) m.wheelspin += dt;
      if (s.lockup) m.lockup += dt;
      if (s.spin && !m.spinning) m.spins++;
      m.spinning = !!s.spin;
      if (s.offRoad) m.offRoad += dt;
      if (STEPS[i].id === 'assists') m.adviceSeen = m.adviceSeen || (s.ack === true);
      while (i < STEPS.length && STEPS[i].done(s, m)) i++;
      if (i >= STEPS.length) ended = true;
      return state();
    },
    skip() { ended = true; i = STEPS.length; return state(); },
    // the assists this drive suggests: turned on where they'd have helped, offered off where they never acted
    advice() {
      const out = [], share = x => x / Math.max(10, m.time);     // (a share of the driving; the tutorial's is short)
      if (share(m.wheelspin) > 0.08 && !aids.tc) out.push({ aid: 'tc', on: true, why: 'wheelspin' });
      if (share(m.lockup) > 0.05 && !aids.abs) out.push({ aid: 'abs', on: true, why: 'lockup' });
      if (m.spins >= 2 && !aids.esc) out.push({ aid: 'esc', on: true, why: 'spins' });
      if (m.slides >= 3 && !aids.countersteer) out.push({ aid: 'countersteer', on: true, why: 'slides' });
      if (!out.length && m.spins === 0 && m.slides === 0 && share(m.wheelspin) < 0.01 && share(m.lockup) < 0.01) {
        for (const a of ['steering', 'countersteer', 'tc']) if (aids[a]) { out.push({ aid: a, on: false, why: 'clean' }); break; }
      }
      return out;
    },
    metrics: m,
  };
  const state = () => ({ step: T.step, index: i, of: STEPS.length, done: ended, ...(T.step === 'assists' || ended ? { advice: T.advice() } : {}) });
  return T;
}
