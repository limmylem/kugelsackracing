// Hillclimb / sprint (Phase 5 Step 3): a generated point-to-point track from the start to the top, solo
// against the clock (the AI reference times' medals) or against the field (the place is the medal).
import { nextMedal } from './sprint.js';

export default {
  id: 'hillclimb',
  hud: S => ({ kind: 'target', next: nextMedal(S) }),
};
