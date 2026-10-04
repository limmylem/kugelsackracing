// Checkpoint run: through every checkpoint in order before the clock runs out (the quest's time limit,
// and whatever the checkpoints add).
export default {
  id: 'checkpoint',
  init: S => ({ limit: S.quest.params?.timeLimitSeconds ?? null }),
  hud: S => ({ kind: 'clock', timeLeft: S.limit != null ? Math.max(0, S.limit + S.extension - S.clock) : null, passed: S.lap * S.required.length + S.next, of: S.required.length * S.laps }),
};
