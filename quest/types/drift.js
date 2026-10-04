// Drift: points for drifting (quest/drift.js, the rules in data/quests.json drift), medals for the score.
// The run ends at the finish line, or when the clock (the quest's time limit, if it has one) runs out —
// that's the end of the run, not a failure.
import { createDriftScorer } from '../drift.js';
import { medalOf } from '../rules.js';

export default {
  id: 'drift',
  init: S => ({ drift: createDriftScorer(S.config.drift), limit: S.quest.params?.timeLimitSeconds ?? null, score: 0 }),
  tick(S, I, emit) {
    if (S.t0 == null) return;
    for (const e of S.drift.tick({ dt: I.dt, fx: I.fx ?? 0, fz: I.fz ?? 1, vx: I.vx ?? 0, vz: I.vz ?? 0, impulse: I.impulse ?? 0 })) emit(e);
    S.score = S.drift.state.score;
  },
  timeUp(S, emit, end) { end('finished', { time: S.limit + S.extension, reason: 'time', text: 'Time\'s up' }); },
  finish(S) {
    S.drift.end();
    S.score = S.drift.state.score;
    const d = S.drift.state;
    return { drift: { drifts: d.drifts, best: d.best, lost: d.lost } };
  },
  hud(S) {
    const d = S.drift.state, total = S.drift.total, T = S.targets;
    const medal = medalOf(T, { score: total }), next = ['bronze', 'silver', 'gold'].find(t => T[t] != null && total < T[t]);
    return { kind: 'drift', score: d.score, pot: Math.round(d.pot), multiplier: d.multiplier, drifting: d.drifting, angle: Math.round(d.angle), medal, next: next ? { tier: next, score: T[next] } : null,
      timeLeft: S.limit != null ? Math.max(0, S.limit + S.extension - S.clock) : null };
  },
};
