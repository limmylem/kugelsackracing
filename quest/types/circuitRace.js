// Circuit race (Phase 5 Step 3): laps of a generated circuit against the field (race/race.js), from a
// standing or a rolling start. With rivals the place is the medal (data/quests.json race.medalByPlace);
// alone it's against the clock, the medals from the AI reference times (track/events/reference.js).
import { nextMedal } from './sprint.js';

export default {
  id: 'circuit_race',
  hud: S => ({ kind: 'target', next: nextMedal(S), lap: Math.min(S.laps, S.lap + 1), laps: S.laps }),
};
