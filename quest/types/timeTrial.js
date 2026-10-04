// Time trial: against the clock, for the medal times (the route's reference time × the multipliers in
// data/quests.json, or the quest's target). With checkpoint time extensions (or the quest's own time
// limit) it's a countdown: the clock starts at the bronze time less the extensions there are to earn, each
// checkpoint adds its own, and at zero it's over.
import { nextMedal } from './sprint.js';

export default {
  id: 'time_trial',
  init(S) {
    const P = S.quest.params ?? {}, ext = S.gates.reduce((a, g) => a + (g.timeExtension ?? 0), 0) * S.laps;
    if (P.timeLimitSeconds > 0) return { limit: P.timeLimitSeconds };
    if (ext > 0 && S.targets.bronze) return { limit: Math.max(10, S.targets.bronze - ext) };
    return { limit: null };
  },
  hud: S => ({ kind: 'timeTrial', countdown: S.limit != null, timeLeft: S.limit != null ? Math.max(0, S.limit + S.extension - S.clock) : null, next: nextMedal(S), targets: S.targets }),
};
