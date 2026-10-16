// A police pursuit (docs/PURSUIT.md): get away from the police — or get to the drop with them after you. Driven
// anywhere (a free type: no checkpoints, no corridor); the police are the game's (play/pursuitPlay.js: the director,
// pursuit/director.js, run each physics tick) and what they've decided is handed to the session each tick as
// S.pursuitNow (the director's status). This says when it's over and what the run scored:
//   busted (slowed to a stop with a unit on you, or the car disabled) → failed, and the server takes the bust fine
//   (data/quests.json pursuit.fine); escaped → finished (an escape mission); at the drop (the route's finish) →
//   finished (a destination mission; params.escapeFirst: only once they've lost you); out of time → failed.
// The score: every second they're after you × the heat level, an escape × the level, the drop, each police car put out
// of action (data/quests.json pursuit) — its medals are the mission's scoreTarget's (quest/rules.js SCORE_TYPES).
//
// params: objective 'escape' | 'destination', startHeat, maxHeat (1–5), maxUnits (at once), totalUnits (ever),
//         timeLimitSeconds, bustPenalty (money), escapeFirst, scoreTarget, timerEnds, roadblocks, spikes

export const PURSUIT_TYPES = new Set(['pursuit', 'pursuit_coop']);

export function pursuitRules(config) { return config.pursuit ?? { perSecond: 10, escapeBonus: 400, destinationBonus: 600, perDisabled: 250, maxDisabled: 24, destinationM: 18, startM: 70, startKmh: 70, minSeconds: 8 }; }

// the most a run's score can be (the server's check, quest/validate.js): every second at the highest heat reached,
// an escape and the drop at that heat, every police car it could have put out of action
export function maxPursuitScore(config, { seconds, heat, disabled }) {
  const R = pursuitRules(config), h = Math.max(1, Math.min(5, Math.floor(heat)));
  return R.perSecond * h * seconds + R.escapeBonus * h + R.destinationBonus + R.perDisabled * Math.min(disabled, R.maxDisabled);
}

const near = (a, b, r) => Math.hypot(a.x - b.x, a.z - b.z) <= r;

export default {
  id: 'pursuit',
  intro: false,
  start: 'rolling',
  init(S) {
    const P = S.quest.params ?? {};
    return { free: true, limit: P.timeLimitSeconds ?? null, objective: P.objective ?? 'escape', pursuitNow: null,
      chase: { escaped: false, reached: false, heatMax: Math.max(1, P.startHeat ?? 1), disabled: 0, seconds: 0, points: 0, phase: 'pursuit' }, score: 0 };
  },
  // (rolling, a way along the route: room behind for the police)
  startAt(S) {
    const R = pursuitRules(S.config), L = S.course.loop ? S.course.length : S.course.grid.finishS - S.course.grid.startS;
    return { s: S.course.grid.startS + Math.max(0, Math.min(R.startM, L * 0.3)), kmh: R.startKmh };
  },
  next: S => S.objective === 'destination' ? S.course.finish : null,
  tick(S, I, emit, end) {
    const R = pursuitRules(S.config), C = S.chase, D = S.pursuitNow, P = S.quest.params ?? {};
    if (!D) return;
    const me = D.players?.[0];
    // the score: the chase (while they're after you — in sight or searching), the heat reached, the cars put out
    if (D.phase === 'pursuit' || D.phase === 'cooldown') { C.seconds += I.dt; C.points += R.perSecond * D.level * I.dt; }
    C.heatMax = Math.max(C.heatMax, D.level);
    if (D.disabled > C.disabled) { C.points += R.perDisabled * (D.disabled - C.disabled); C.disabled = D.disabled; emit({ type: 'pursuit-disabled', total: C.disabled }); }
    if (D.phase !== C.phase) {
      if (D.phase === 'cooldown') { S.message = null; emit({ type: 'pursuit-lost', cooldown: D.cooldown }); }
      if (D.phase === 'pursuit' && C.phase === 'cooldown') emit({ type: 'pursuit-spotted' });
      if (D.phase === 'escaped' && !C.escaped) {
        C.escaped = true; C.points += R.escapeBonus * D.level;
        emit({ type: 'pursuit-escaped', level: D.level });
        if (S.objective === 'destination') S.message = null;
      }
      C.phase = D.phase;
    }
    S.score = Math.round(C.points);
    if (me?.busted) { end('failed', { reason: 'busted', text: me.why === 'disabled' ? 'Busted: your car\'s out of action' : 'Busted' }); return; }
    if (S.objective === 'escape' && C.escaped) { end('finished'); return; }
    if (S.objective === 'destination' && near(I, S.course.finish, R.destinationM)) {
      if (P.escapeFirst && !C.escaped) { if (S.message !== 'Lose them first!') { S.message = 'Lose them first!'; emit({ type: 'pursuit-not-yet' }); } return; }
      C.reached = true; C.points += R.destinationBonus; S.score = Math.round(C.points);
      end('finished');
    }
  },
  finish: (S, status) => ({ pursuit: { objective: S.objective, escaped: S.chase.escaped, reached: S.chase.reached, heatMax: S.chase.heatMax, disabled: S.chase.disabled, seconds: Math.round(S.chase.seconds * 100) / 100, busted: status !== 'finished' && S.pursuitNow?.players?.[0]?.busted ? S.pursuitNow.players[0].why : null } }),
  hud(S) {
    const D = S.pursuitNow;
    return { kind: 'pursuit', objective: S.objective, heat: D?.heat ?? 1, level: D?.level ?? 1, maxHeat: D?.maxHeat ?? 5, phase: D?.phase ?? 'pursuit', cooldown: D?.cooldown ?? null,
      bust: D?.players?.[0]?.bust ?? 0, seen: !!D?.players?.[0]?.seen, units: D?.units?.filter(u => u.mode !== 'out').length ?? 0, score: S.score ?? 0,
      timeLeft: S.limit != null ? Math.max(0, S.limit + S.extension - S.clock) : null };
  },
};
