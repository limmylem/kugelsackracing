// The whole path of a car's state, simulated on a virtual clock (Phase 7 Step 1; the smoothness tests and tuning):
// a car driving a line at 120 physics steps a second → sent like the game sends it (quantised, only what changed,
// paced) → a bad uplink → the server's tick (merging, then each recipient's change-only copy) → a bad downlink →
// another player's game, drawing at 60 fps through remote.js. The same code as the live path (codec, netsim,
// remote, measure), minus the sockets, so an hour of driving takes a second to check.
//
//   simulateRemote({ seconds, up, down, route, fps, settings }) → measure.js's result plus { delayMs, bufferMs, kbs }
//     up / down: net/netsim.js conditions (each player's own link to the server)

import { NET } from './settings.js';
import { ALL } from './protocol.js';
import { quantise, dequantise, maskFor, mergeState, encodeStateMessage, decodeStateMessage, encodeSnapshot, decodeSnapshot } from './codec.js';
import { createLink } from './netsim.js';
import { createRemote } from './remote.js';
import { createRouteDriver, testLoop } from './bot.js';
import { createSmoothness } from './measure.js';

export function simulateRemote({ seconds = 60, up = null, down = null, route = testLoop(), fps = 60, settings = NET, seed = 1, driver = {} } = {}) {
  // a virtual clock and its timers
  let now = 0;
  const queue = [];
  const schedule = (f, ms) => { const h = { at: now + ms, f, seq: queue.length + Math.random() }; queue.push(h); return h; };
  const cancel = h => { const i = queue.indexOf(h); if (i >= 0) queue.splice(i, 1); };
  const runUntil = t => { for (;;) { let k = -1; for (let i = 0; i < queue.length; i++) if (queue[i].at <= t && (k < 0 || queue[i].at < queue[k].at)) k = i; if (k < 0) break; const h = queue.splice(k, 1)[0]; now = h.at; h.f(); } now = t; };
  const link = (c, s) => createLink({ ...(c ?? {}), seed: s, now: () => now, schedule, cancel });
  const L = { up: link(up, seed * 3 + 1), down: link(down, seed * 3 + 2) };

  // (change-only states need every message to arrive: on a lossy link, complete states every time — docs/MULTIPLAYER.md)
  const full = up?.mode === 'datagram' || down?.mode === 'datagram';
  const D = createRouteDriver(route, driver), truth = [];
  const remote = createRemote({ interp: settings.interp, sendHz: settings.sendHz });
  const M = createSmoothness({ snapCm: settings.interp.snapCm });
  let serverLatest = null, sentBase = null, clientBase = null, recvBase = null, bytes = 0, lastSend = -1e9, lastKey = -1e9, n = 0, physT = 0, tick = 0;

  const STEP = 1000 / 120, FRAME = 1000 / fps, TICK = 1000 / settings.tickHz;
  let nextStep = 0, nextFrame = 0, nextTick = 0, state = null;
  while (now < seconds * 1000) {
    const t = Math.min(nextStep, nextFrame, nextTick);
    runUntil(t);
    if (t === nextStep) {
      state = D.step(STEP / 1000); physT = t;
      truth.push([t, state.pos]);
      nextStep += STEP;
    }
    if (t === nextFrame) {
      // the sender, once a frame (like the game): paced to sendHz, the state stamped with its moment
      if (state && t - lastSend >= 1000 / settings.sendHz - 2) {
        const q = quantise({ ...state, time: physT }), key = full || !clientBase || t - lastKey >= settings.keyframeSec * 1000;
        const mask = key ? ALL : maskFor(q, clientBase, n % settings.detailEvery === 0);
        if (mask || t - lastSend >= 200) {
          const b = encodeStateMessage(q, mask);
          bytes += b.length + 8;
          L.up.send(x => { const m = decodeStateMessage(x); serverLatest = mergeState(serverLatest, m.q, m.mask); }, b, { reliable: false });
          clientBase = mergeState(clientBase, q, mask); lastSend = t; n++;
          if (key) lastKey = t;
        }
      }
      // the receiver draws a frame
      const pose = remote.sample(t, FRAME / 1000);
      M.frame(pose, FRAME / 1000, at => truthAt(truth, at));
      nextFrame += FRAME;
    }
    if (t === nextTick) {
      // the server's tick: what's new, as only what changed for this recipient
      tick++;
      if (serverLatest && (!sentBase || sentBase.time !== serverLatest.time)) {
        const mask = full ? ALL : maskFor(serverLatest, sentBase, true), snap = encodeSnapshot(t, [{ id: 1, q: serverLatest, mask }]);
        sentBase = serverLatest;
        L.down.send(x => { const s = decodeSnapshot(x); for (const c of s.cars) { if (!recvBase && c.mask !== ALL) continue; recvBase = mergeState(recvBase, c.q, c.mask); remote.push(dequantise(recvBase), now); } }, snap, { reliable: false });
      }
      nextTick += TICK;
    }
  }
  return { ...M.result(), delayMs: Math.round(remote.stats.delayMs), bufferMs: Math.round(remote.stats.bufferMs), lagP95: Math.round(remote.stats.lagP95), upKBs: +(bytes / 1024 / seconds).toFixed(2), corrections: remote.stats.corrections };
}

// where the car really was at time t (between two physics steps)
function truthAt(truth, t) {
  let lo = 0, hi = truth.length - 1;
  if (hi < 1 || t < truth[0][0] || t > truth[hi][0]) return null;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (truth[m][0] <= t) lo = m; else hi = m; }
  const [ta, a] = truth[lo], [tb, b] = truth[hi], u = (t - ta) / ((tb - ta) || 1);
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}
