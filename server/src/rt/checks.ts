// The live checks on what a client says its car is doing (Phase 7 Step 1; docs/MULTIPLAYER.md "What the server
// checks"). Each player simulates their own car, so the server can't recompute it; it checks the states are possible
// as they come in, and drops the ones that aren't (nobody else sees them). Each dropped state is a strike; too many
// in a short while and the player is removed. A race's RESULT is checked properly afterwards, by replaying the run
// (Phase 6 Step 3, tracks/verify): a modified client can't win by sending impossible states, because the replay
// decides.
//
//   const C = createChecks(NET.checks)
//   C.state(prev, next, now, { resetOk }) → null (fine) or a reason       (prev/next: dequantised, world frame)
//   C.rate(now) → whether one more message fits the rate limit
//   C.strike(reason, now) → whether the player has now had too many

type Limits = { maxSpeed: number; slackM: number; maxRatePerSec: number; futureMs: number; pastMs: number; strikes: number; strikeWindowSec: number; resetEverySec: number; worldLimitM: number };
type S = { tick: number; time: number; pos: number[]; vel: number[] };

export function createChecks(L: Limits) {
  let tokens = L.maxRatePerSec, refilled = 0;
  const strikes: number[] = [];
  const reasons = new Map<string, number>();
  return {
    rate(now: number) {
      if (!refilled) refilled = now;
      tokens = Math.min(L.maxRatePerSec, tokens + (now - refilled) / 1000 * L.maxRatePerSec);
      refilled = now;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
    state(prev: S | null, s: S, now: number, { resetOk = false } = {}): string | null {
      if (![...s.pos, ...s.vel].every(Number.isFinite)) return 'not a number';
      if (Math.abs(s.pos[0]) > L.worldLimitM || Math.abs(s.pos[2]) > L.worldLimitM || Math.abs(s.pos[1]) > 20000) return 'outside the world';
      if (s.time > now + L.futureMs) return 'from the future';
      if (s.time < now - L.pastMs) return 'too old';
      const speed = Math.hypot(s.vel[0], s.vel[1], s.vel[2]);
      if (speed > L.maxSpeed) return 'too fast';
      if (!prev) return null;
      if (s.tick <= prev.tick && !resetOk) return 'out of order';
      if (s.time < prev.time) return 'went back in time';
      // how far it could have gone since the last state: at the faster of its two speeds, plus some slack (a crash
      // can fling a car; the clocks wobble)
      const dt = Math.max(0, s.time - prev.time) / 1000, moved = Math.hypot(s.pos[0] - prev.pos[0], s.pos[1] - prev.pos[1], s.pos[2] - prev.pos[2]);
      const could = Math.max(speed, Math.hypot(prev.vel[0], prev.vel[1], prev.vel[2])) * dt * 1.25 + L.slackM;
      if (moved > could && !resetOk) return 'moved too far';
      return null;
    },
    strike(reason: string, now: number) {
      strikes.push(now);
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      while (strikes.length && strikes[0] < now - L.strikeWindowSec * 1000) strikes.shift();
      return strikes.length >= L.strikes;
    },
    get reasons() { return Object.fromEntries(reasons); },
  };
}
