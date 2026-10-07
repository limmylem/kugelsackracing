// A bad network on demand (Phase 7 Step 1; docs/MULTIPLAYER.md "Debug tools"): latency, jitter and packet loss
// added to messages, on the client (its sends and what it receives) and on the server (per client). Used by the
// tests, the bots and the game's debug panel (?netsim=150,30,0.05).
//
// Two kinds of loss, because the transport decides what loss looks like:
//   'stream' (WebSockets, TCP — today): nothing is ever lost; a lost packet is sent again after a retransmission
//            timeout, and everything behind it waits (head-of-line blocking). Loss shows as delay spikes.
//   'datagram' (WebTransport datagrams — later): a lost car state is just gone; reliable messages still arrive
//            (resent), later.
//
//   const L = createLink({ latencyMs, jitterMs, loss, mode: 'stream' | 'datagram', rtoMs, seed })
//   L.send(deliver, payload, { reliable })   deliver(payload) after the network's delay (or never: a dropped datagram)
//   L.set({ latencyMs, … }) · L.stats { sent, delivered, lost, resent, maxDelayMs } · L.off (no delay at all) · L.close()

export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function createLink(opts = {}) {
  let o = { latencyMs: 0, jitterMs: 0, loss: 0, mode: 'stream', rtoMs: null, seed: 7, ...opts };
  // (a test can run it on its own clock: { now, schedule(fn, ms) → handle, cancel(handle) })
  const now = opts.now ?? (() => performance.now()), schedule = opts.schedule ?? ((f, ms) => setTimeout(f, ms)), cancel = opts.cancel ?? (h => clearTimeout(h));
  delete o.now; delete o.schedule; delete o.cancel;
  const rand = rng(o.seed), timers = new Set();
  const stats = { sent: 0, delivered: 0, lost: 0, resent: 0, maxDelayMs: 0 };
  let lastDue = 0, closed = false;
  // (jitter: a bell curve around the latency — two uniform draws — never below zero)
  const delayOf = () => Math.max(0, o.latencyMs + o.jitterMs * (rand() + rand() - 1) * 1.7);
  return {
    send(deliver, payload, { reliable = false } = {}) {
      if (closed) return;
      stats.sent++;
      const off = !o.latencyMs && !o.jitterMs && !o.loss;
      if (off) { stats.delivered++; deliver(payload); return; }
      let d = delayOf();
      if (o.loss && rand() < o.loss) {
        if (o.mode === 'datagram' && !reliable) { stats.lost++; return; }
        stats.resent++;
        d += o.rtoMs ?? Math.max(200, 2 * o.latencyMs + 4 * o.jitterMs);      // (TCP's retransmission timeout: at least 200 ms)
      }
      let due = now() + d;
      // a stream keeps its order: nothing overtakes what's ahead of it (a datagram may arrive out of order)
      if (o.mode === 'stream' || reliable) { due = Math.max(due, lastDue); lastDue = due; }
      stats.maxDelayMs = Math.max(stats.maxDelayMs, due - now());
      const h = schedule(() => { timers.delete(h); if (!closed) { stats.delivered++; deliver(payload); } }, Math.max(0, due - now()));
      timers.add(h);
    },
    set(next) { o = { ...o, ...next }; },
    get conditions() { return { ...o }; },
    get off() { return !o.latencyMs && !o.jitterMs && !o.loss; },
    stats,
    close() { closed = true; for (const h of timers) cancel(h); timers.clear(); },
  };
}

// '150,30,0.05' or '150,30,0.05,datagram' → conditions (or null)
export function parseConditions(text) {
  if (!text) return null;
  const [lat, jit, loss, mode] = String(text).split(',');
  const c = { latencyMs: Number(lat) || 0, jitterMs: Number(jit) || 0, loss: Math.min(0.9, Math.max(0, Number(loss) || 0)), mode: mode === 'datagram' ? 'datagram' : 'stream' };
  return c.latencyMs || c.jitterMs || c.loss ? c : null;
}
