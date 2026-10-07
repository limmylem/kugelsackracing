// The server's clock, as a client knows it (Phase 7 Step 1; docs/MULTIPLAYER.md "Time"). Repeated ping exchanges:
// each gives the round trip and the offset between the clocks (the server's time plus half the trip, minus ours).
// Only the quickest trips count — a slow one was held up on one leg, which skews its offset — and of those the median
// is taken; the clock then slews towards it (no jumps once it's settled).
//
//   const C = createClock({ now })            now: this client's monotonic ms (performance.now)
//   C.sample(clientSent, serverMs, clientGot)   a pong
//   C.serverNow()                             the server's ms now (its own monotonic clock)
//   C.ready (4 pings in) · C.rtt · C.jitter (ms) · C.offset · C.samples

const WINDOW = 48, BEST = 1 / 4;

export function createClock({ now = () => performance.now() } = {}) {
  const samples = [];
  let offset = null, rtt = 0, jitter = 0, n = 0;
  const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
  return {
    sample(sent, serverMs, got) {
      const trip = got - sent;
      if (!(trip >= 0) || trip > 10000) return;
      samples.push({ trip, off: serverMs + trip / 2 - got });
      if (samples.length > WINDOW) samples.shift();
      n++;
      const byTrip = [...samples].sort((a, b) => a.trip - b.trip), best = byTrip.slice(0, Math.max(1, Math.ceil(byTrip.length * BEST)));
      const target = median(best.map(s => s.off));
      // (settling: straight there; afterwards a slew of at most 1 ms a ping, or a jump if it's far off — a new path)
      if (offset == null || n <= 4 || Math.abs(target - offset) > 50) offset = target;
      else offset += Math.max(-1, Math.min(1, target - offset));
      const trips = samples.map(s => s.trip);
      rtt = median(trips);
      jitter = median(trips.map(t => Math.abs(t - rtt)));
    },
    serverNow() { return now() + (offset ?? 0); },
    get ready() { return n >= 4; },
    get rtt() { return rtt; },
    get jitter() { return jitter; },
    get offset() { return offset; },
    get samples() { return n; },
    reset() { samples.length = 0; offset = null; n = 0; },
  };
}
