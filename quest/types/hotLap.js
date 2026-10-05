// Hot lap (Phase 5 Step 3): a time trial on a generated circuit — laps against the clock, the medals for
// the best lap (mode 'best_lap', the default: each lap a fresh go, the targets one lap's) or for the total
// (mode 'total'). A rolling start by default: the first lap is a flying one.
import { medalOf } from '../rules.js';

export const lapMode = quest => (quest.params?.mode ?? 'best_lap') === 'total' ? 'total' : 'best_lap';

export default {
  id: 'hot_lap',
  // (the medal: the best lap's, not the total's)
  finish(S, status) {
    if (status !== 'finished' || lapMode(S.quest) !== 'best_lap' || !S.lapTimes.length) return {};
    const best = Math.min(...S.lapTimes);
    return { medal: medalOf(S.targets, { time: best }), rankTime: best };
  },
  hud(S) {
    const T = S.targets, best = S.lapTimes.length ? Math.min(...S.lapTimes) : null, inLap = S.clock - S.lapTimes.reduce((a, b) => a + b, 0);
    const mode = lapMode(S.quest), now = mode === 'best_lap' ? inLap : S.clock;
    const next = T.kind === 'time' ? ['gold', 'silver', 'bronze'].find(t => T[t] != null && now <= T[t]) : null;
    return { kind: 'hotLap', mode, lap: Math.min(S.laps, S.lap + 1), laps: S.laps, lapTime: inLap, best, medal: best != null && mode === 'best_lap' ? medalOf(T, { time: best }) : null, next: next ? { tier: next, time: T[next] } : null, targets: T };
  },
};
