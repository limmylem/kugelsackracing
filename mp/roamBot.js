// A headless free-roam player (Phase 7 Step 4; docs/FREE_ROAM.md): the game's own client code — the hub (mp/client.js),
// the zones and handoffs (mp/roamClient.js), Step 1's connections — with a scripted car instead of physics (net/bot.js's
// route driver, or a script). The tests and the bot swarm drive these; nothing here is test-only logic.
//
//   const B = createRoamBot({ transport, getTicket, region, cfg, points, drive, look, endpoint, netsim, serverNetsim, now, settings, log, drawOthers })
//     drawOthers: false — a load-test bot: the other cars' states received (and counted) but not read (net/client.js)
//     points: [[x, y, z]] a line to drive (world frame) · drive: net/bot.js createRouteDriver options
//   await B.start()          the hub joined (free roam), the home zone placed and joined
//   B.step(dt, frameAt)      the car moved and sent (its position for frameAt); returns its state      B.override(fn | null): fn(state, dt) → state (scripts)
//   B.sample(dt) → the other cars as this player would draw them (mp/roamClient.js)
//   B.messages               every 'mp' message from the zones (and the hub's free-roam ones), newest last
//   B.wait(pred, ms) → the first message matching pred (already in, or to come), or null
//   B.send(msg) · B.reply(message, msg) (to the zone a message came from) · B.hubSend(msg) · B.RC (the roam client) · B.S (the hub session) · B.state · B.leave()

import { createMpSession } from './client.js';
import { createRoamClient } from './roamClient.js';
import { createRouteDriver } from '../net/bot.js';

export function createRoamBot({ transport, getTicket, region, cfg, points, drive = {}, look = null, endpoint = null, netsim = null, serverNetsim = null, now = () => performance.now(), settings = {}, tileSize = 512, keep = 400, log = () => {}, drawOthers = true }) {
  const S = createMpSession({ transport, endpoint, getTicket, netsim, serverNetsim });
  const D = createRouteDriver(points, { closed: true, topSpeed: 30, ...drive });
  let RC = null, state = null, tick = 0, script = null;
  const messages = [], waiters = new Set();
  const push = m => {
    messages.push(m); if (messages.length > keep) messages.splice(0, messages.length - keep);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.delete(w); w.res(m); }
  };
  const B = {
    S, D, messages,
    get RC() { return RC; }, get state() { return state; },
    // (the hub alone first — to join a party before being placed, as the menu does)
    hub() { return S.hub('free roam'); },
    async start() {
      await S.hub('free roam');
      for (const t of ['roam-goto', 'chat']) S.on(t, m => push({ ...m, t: m.t ?? t, via: 'hub' }));
      S.on('notice', text => push({ t: 'notice', text, via: 'hub' }));
      state = { ...D.step(1 / 60), tick: ++tick };
      if (script) state = script(state, 0) ?? state;
      RC = createRoamClient({ transport, getTicket, hub: () => S, region, cfg, look, settings, netsim, serverNetsim, endpoint, now, tileSize, log, drawOthers });
      RC.on('mp', push);
      await RC.start(state.pos);
      return B;
    },
    override(fn) { script = fn; },
    // frameAt: when this frame began — the moment the car's position is for (sent later in the frame, by however long the
    // bots before it took, it's stamped that much earlier: as the game does, and Step 1's bots)
    step(dt, frameAt = now()) {
      let s = null;
      // (two physics steps a frame at 60 fps: 120 Hz, as the game's)
      const steps = Math.max(1, Math.round(dt * 120));
      for (let k = 0; k < steps; k++) s = D.step(dt / steps);
      s = { ...s, tick: ++tick };
      if (script) s = script(s, dt) ?? s;
      state = s;
      RC?.update(dt, () => ({ ...state, ageMs: now() - frameAt }));
      return state;
    },
    sample(dt) { return RC ? RC.sample(dt) : []; },
    send(m) { RC?.send(m); },
    // (an answer to a zone's message goes back to that zone: an invite comes from the challenger's home zone)
    reply(to, m) { if (to?.roomId) RC?.sendTo(to.roomId, m); else RC?.send(m); },
    hubSend(m) { S.hubSend(m); },
    wait(pred, ms = 5000, { fresh = false } = {}) {
      if (!fresh) { const got = [...messages].reverse().find(pred); if (got) return Promise.resolve(got); }
      return new Promise(res => { const w = { pred, res }; waiters.add(w); setTimeout(() => { if (waiters.delete(w)) res(null); }, ms); });
    },
    async leave() { await RC?.leave(); S.close?.(); },
  };
  return B;
}
