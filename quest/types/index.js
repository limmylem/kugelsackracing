// The quest types, each its own module on top of quest/session.js. A type can have:
//   init(S) → fields for the session's state (S.limit: a clock that runs out)
//   tick(S, input, emit, end)  every physics tick while racing (end(status, { reason, text }) ends it)
//   checkpoint(S, split, emit) a checkpoint passed
//   finishLine(S, emit)        the finish line crossed (false: the run isn't over)
//   timeUp(S, emit, end)       the clock ran out (default: failed, "Out of time")
//   finish(S, status) → what the type adds to the outcome
//   hud(S) → its HUD panel: { kind, … }
//   enabled: false, disabledReason   a type that can't be played yet
// A new type: a module here, its entry in content/quests.js TYPES (its fields and checks), and this list.

import sprint from './sprint.js';
import time_trial from './timeTrial.js';
import checkpoint from './checkpoint.js';
import drift from './drift.js';
import delivery from './delivery.js';
import pink_slip from './pinkSlip.js';
// (track events, Phase 5 Step 3: on generated tracks)
import circuit_race from './circuitRace.js';
import hot_lap from './hotLap.js';
import hillclimb from './hillclimb.js';
import endurance from './endurance.js';

export const TYPE_MODULES = { sprint, time_trial, checkpoint, drift, delivery, pink_slip, circuit_race, hot_lap, hillclimb, endurance };
