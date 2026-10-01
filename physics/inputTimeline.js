// Timestamped driver input, so every physics step gets the input as it was at its own moment instead
// of whatever it was when the frame was drawn. A key pressed between two frames reaches the physics
// step it was pressed in, so the same presses at the same moments give exactly the same drive at 30,
// 60 or 144 fps (and a replay of the recorded moments gives the same drive again).
//
// Held input (pedals, steering keys) is a list of states, each from the moment it changed; one-shot
// actions (gear shifts) are events at a moment. Times are in ms on any one clock (in the browser,
// event.timeStamp and requestAnimationFrame's time share performance.now()'s clock).
// No browser APIs: the headless determinism test uses it too.

export class InputTimeline {
  constructor(keepMs = 2000) {
    this.keep = keepMs;
    this.states = [];      // [{ time, state }], in time order
    this.events = [];      // [{ time, action }], in time order
  }

  // The held input became `state` at `time`
  set(time, state) {
    const S = this.states;
    while (S.length && S[S.length - 1].time > time) S.pop();   // (a clock can't go backwards; guards bad stamps)
    S.push({ time, state });
  }

  // A one-shot action at `time`
  event(time, action) { this.events.push({ time, action }); }

  // The held input at `time` (the latest one set at or before it; null before the first)
  at(time) {
    const S = this.states;
    let lo = 0, hi = S.length - 1, found = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (S[mid].time <= time) { found = S[mid].state; lo = mid + 1; } else hi = mid - 1;
    }
    return found;
  }

  // Actions with start < time ≤ end
  eventsIn(start, end) {
    return this.events.filter(e => e.time > start && e.time <= end).map(e => e.action);
  }

  // Forget what's older than keepMs before `time`, keeping the state that still holds then
  prune(time) {
    const cut = time - this.keep, S = this.states;
    let i = 0;
    while (i + 1 < S.length && S[i + 1].time <= cut) i++;
    if (i) S.splice(0, i);
    this.events = this.events.filter(e => e.time > cut);
  }
}
