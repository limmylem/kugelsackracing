// A player's connection to multiplayer (Phase 7 Step 1; docs/MULTIPLAYER.md). Used by the game, the bots and the
// tests alike. It joins the room with a ticket from the API, keeps the server's clock (clock.js), sends this
// player's car (paced to NET.sendHz, only what changed, a full state every NET.keyframeSec), and keeps every other
// player's car (remote.js) for the game to draw.
//
//   const N = createNetClient({ transport, endpoint, getTicket, world, look, netsim, serverNetsim, settings, roomName, join })
//     join (Phase 7 Step 2): { how: 'joinOrCreate' | 'create' | 'joinById' | 'reservation', roomId, reservation, options }
//     — a race room: by its id, a seat the matchmaker reserved, or a new lobby; N.conn.sendJson / onJson its messages
//     transport: transport.js · getTicket() → { ticket, url } (POST /api/v1/rt/ticket) · netsim: conditions
//     (net/netsim.js) on this side · serverNetsim: '150,30,0.05' for the server's side (development/tests)
//   await N.connect()            rejects with { code, message } (protocol.CODES / MESSAGES) when refused
//   N.update(dtSec, local)       every frame: local() → this car's state (codec.js, world frame; `ageMs`: how old
//                                the physics state is) or null when not driving
//   N.sample(dtSec) → [{ id, uid, npc, name, guest, status, look, events, pose }]   every frame: the other cars as shown now
//                                (uid: the player's account — a race room's lobby lists them by it; npc: a car the server drives)
//   N.sendEvent({ kind, ... })   something that must arrive (damage, a reset, a part off, lights)
//   N.setLook(look, events)      this car's look (and its damage so far): everyone else's game draws it
//   N.on('status' | 'roster' | 'event' | 'notice', fn)
//   N.status: 'idle' | 'connecting' | 'online' | 'reconnecting' | 'offline'    N.message (why offline)
//   N.stats: ping, jitter, loss, upKBs, downKBs, … (the network overlay)   N.roomNow()   N.leave()
//   N.stampAt() → the clock this car's states are stamped with (a steady one, steered towards the server's)
//   N.setNear(id, n, maxMs)  N.present(id, maxMs) → Phase 7 Step 3: a car near this one drawn nearer the present, and
//                                where it is now (its newest state predicted forward): car-to-car contact's proxies

import { NET } from './settings.js';
import { PROTOCOL, C2S, S2C, ALL, CODES, messageFor } from './protocol.js';
import { quantise, dequantise, maskFor, mergeState, encodeStateMessage, decodeSnapshot, encodeValue, decodeValue, encodePing, decodePong } from './codec.js';
import { createClock } from './clock.js';
import { createRemote } from './remote.js';
import { createLink } from './netsim.js';
import { withNetsim } from './transport.js';

const WS_UP = 8, WS_DOWN = 4;
// two poses blended (u: 0 the first, 1 the second): position and velocity straight, rotation by slerp
const lerp3 = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
function slerp(a, b, u) {
  let [bx, by, bz, bw] = b, d = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (d < 0) { d = -d; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  if (d > 0.9995) { const q = [a[0] + (bx - a[0]) * u, a[1] + (by - a[1]) * u, a[2] + (bz - a[2]) * u, a[3] + (bw - a[3]) * u], l = Math.hypot(...q) || 1; return q.map(x => x / l); }
  const th = Math.acos(d), s = Math.sin(th), k0 = Math.sin((1 - u) * th) / s, k1 = Math.sin(u * th) / s;
  return [a[0] * k0 + bx * k1, a[1] * k0 + by * k1, a[2] * k0 + bz * k1, a[3] * k0 + bw * k1];
}
const blendPose = (a, b, u) => ({ ...a, pos: lerp3(a.pos, b.pos, u), rot: slerp(a.rot, b.rot, u), vel: lerp3(a.vel, b.vel, u), ang: lerp3(a.ang, b.ang, u) });                     // (a WebSocket frame's header (masked from the client) + the type)

export function createNetClient({ transport, endpoint = null, getTicket, world = 'test', look = null, events = [], netsim = null, serverNetsim = null, settings = NET, now = () => performance.now(), roomName = 'test', join = null }) {
  const S = settings, clock = createClock({ now });
  const listeners = { status: new Set(), roster: new Set(), event: new Set(), notice: new Set() };
  const emit = (k, v) => { for (const f of listeners[k]) { try { f(v); } catch (e) { console.error(e); } } };
  const players = new Map();        // id → { id, name, guest, status, look, events, remote, base, lastState }
  let conn = null, me = null, status = 'idle', message = '', net = { sendHz: S.sendHz, detailEvery: S.detailEvery, keyframeSec: S.keyframeSec, pingSec: S.pingSec };
  let myLook = look, myEvents = events;
  // sending
  let base = null, lastSend = -Infinity, lastKey = -Infinity, sendCount = 0, forceKey = false;
  // the stamps on this car's states: their own steady clock, steered towards the server's (as the clock's estimate
  // settles it can step by tens of ms; a state stamped with a step doesn't match its position, and every other player
  // would see the car lurch). It runs 90–110% of real time, changing its rate by at most half a percent a state.
  const stamp = { local: null, room: 0, rate: 1 };
  const stampNow = () => {
    const t = now(), want = roomNow();
    if (stamp.local == null || Math.abs(want - (stamp.room + (t - stamp.local))) > 2000) { stamp.local = t; stamp.room = want; stamp.rate = 1; return want; }
    const est = stamp.room + (t - stamp.local) * stamp.rate, err = want - est;
    // (steered by the time gone by, not per state: a game drawing a frame a second sends one a second, and would take
    // minutes to catch up otherwise — half a percent each 33 ms)
    const most = 0.005 * Math.min(20, Math.max(1, (t - stamp.local) / 33));
    stamp.rate += Math.max(-most, Math.min(most, 1 + Math.max(-0.1, Math.min(0.1, err / 500)) - stamp.rate));
    stamp.room = est; stamp.local = t;
    return est;
  };
  // pings
  let seq = 0, nextPing = 0, burst = 0;
  const pending = new Map(), pingLog = [];
  // bandwidth (bytes this second, and the last few seconds' rates)
  const bw = { up: 0, down: 0, at: now(), upKBs: 0, downKBs: 0, upTotal: 0, downTotal: 0 };
  const links = netsim ? { up: createLink({ ...netsim, seed: 11 }), down: createLink({ ...netsim, seed: 12 }) } : null;
  // (sending only what changed needs every message to arrive: over a lossy link — WebTransport datagrams later, or the
  // simulator's datagram mode — complete states every time, both ways)
  let fullStates = netsim?.mode === 'datagram';

  const setStatus = (s, m = '') => { if (status === s && message === m) return; status = s; message = m; emit('status', { status, message }); };
  const roomNow = () => clock.serverNow();
  const player = (e) => {
    let p = players.get(e.id);
    if (!p) players.set(e.id, p = { id: e.id, remote: createRemote({ interp: S.interp, sendHz: net.sendHz }), base: null, lastStateAt: -Infinity });
    Object.assign(p, { uid: e.uid ?? p.uid ?? null, npc: e.npc ?? p.npc ?? false, name: e.name ?? p.name, guest: e.guest ?? p.guest, status: e.status ?? p.status ?? 'here', look: e.look !== undefined ? e.look : p.look, events: e.events ?? p.events ?? [] });
    return p;
  };
  const send = (type, bytes, reliable) => { if (!conn) return; bw.up += bytes.length + WS_UP; bw.upTotal += bytes.length + WS_UP; conn.send(type, bytes, { reliable }); };

  function onMessage(type, bytes) {
    bw.down += bytes.length + WS_DOWN; bw.downTotal += bytes.length + WS_DOWN;
    switch (type) {
      case S2C.WELCOME: {
        const w = decodeValue(bytes);
        me = w.id; net = { ...net, ...w.net };
        // (a first guess at the server's clock, until the pings have measured it)
        if (!clock.ready) clock.guess(w.serverTime);
        burst = 8; nextPing = now();
        base = null; forceKey = true;
        break;
      }
      case S2C.PONG: {
        const p = decodePong(bytes), sent = pending.get(p.seq);
        if (sent == null) break;
        pending.delete(p.seq);
        clock.sample(p.clientMs, p.serverMs, now());
        pingLog.push(true); if (pingLog.length > 30) pingLog.shift();
        break;
      }
      case S2C.SNAPSHOT: {
        const snap = decodeSnapshot(bytes), t = roomNow();
        for (const c of snap.cars) {
          // (players come from the roster, which arrives in order; a state for one it hasn't announced yet — it can
          // overtake on a lossy link — waits: the car appears a moment later rather than being made twice)
          const p = players.get(c.id);
          if (!p) continue;
          if (!p.base && c.mask !== ALL) continue;        // (wait for a complete one)
          p.base = mergeState(p.base, c.q, c.mask);
          p.remote.push(dequantise(p.base), t);
          p.lastStateAt = now();
        }
        break;
      }
      case S2C.ROSTER: {
        const r = decodeValue(bytes);
        if (r.full) {
          const ids = new Set(r.full.map(e => e.id));
          for (const id of players.keys()) if (!ids.has(id)) players.delete(id);
          for (const e of r.full) if (e.id !== me) player(e);
        }
        if (r.join && r.join.id !== me) player(r.join);
        if (r.leave) players.delete(r.leave.id);
        if (r.status && players.has(r.status.id)) players.get(r.status.id).status = r.status.status;
        if (r.look && players.has(r.look.id)) Object.assign(players.get(r.look.id), { look: r.look.look, events: r.look.events ?? [] });
        emit('roster', r);
        break;
      }
      case S2C.EVENT: {
        const ev = decodeValue(bytes), p = players.get(ev.from);
        if (p && ev.kind === 'reset') p.remote.teleport();
        if (p && (ev.kind === 'damage' || ev.kind === 'parts')) p.events = [...(p.events ?? []), ev].slice(-64);
        if (p && ev.kind === 'repair') p.events = [];
        emit('event', ev);
        break;
      }
      case S2C.NOTICE: {
        const n = decodeValue(bytes);
        emit('notice', n);
        if (n.code) setStatus('offline', n.message ?? messageFor(n.code));
        break;
      }
    }
  }

  const api = {
    async connect() {
      setStatus('connecting');
      let t;
      // (a reserved seat needs no ticket: the reservation is the player's)
      if (join?.how === 'reservation') t = { ticket: null, url: endpoint };
      else {
        try { t = await getTicket(); }
        catch (e) { const code = e?.code === 'BANNED' ? CODES.BANNED : CODES.TICKET; setStatus('offline', messageFor(code)); throw { code, message: messageFor(code) }; }
      }
      try {
        fullStates ||= !!transport.unreliable;
        const c = await transport.join(endpoint ?? t.url, roomName, { ticket: t.ticket, protocol: PROTOCOL, world, ...(join?.options ?? {}), how: join?.how, roomId: join?.roomId, reservation: join?.reservation, ...(fullStates ? { fullStates: true } : {}), ...(serverNetsim ? { netsim: serverNetsim } : {}) });
        conn = links ? withNetsim(c, { ...links, unreliable: { up: [C2S.STATE], down: [S2C.SNAPSHOT] } }) : c;
      } catch (e) {
        const code = e?.code ?? 0, m = messageFor(code, e?.message ?? 'Couldn\'t reach the game server.');
        setStatus('offline', m);
        throw { code, message: m };
      }
      for (const type of Object.values(S2C)) conn.on(type, b => onMessage(type, b));
      conn.onStatus((s, info) => {
        if (s === 'dropped') setStatus('reconnecting', 'Connection lost: reconnecting…');
        else if (s === 'back') { forceKey = true; setStatus('online'); }
        else if (s === 'left' && status !== 'offline') setStatus('offline', info.code === 4000 || info.code === 1000 ? '' : messageFor(info.code, info.reason || 'Disconnected from the game server.'));
      });
      // (connected: wait for the welcome, then say this car's look)
      const t0 = now();
      while (me == null) { if (now() - t0 > 10000) throw { code: 0, message: 'The game server didn\'t answer.' }; await new Promise(r => setTimeout(r, 10)); }
      api.setLook(myLook, myEvents);
      setStatus('online');
      return api;
    },
    update(dt, local) {
      if (!conn || status === 'offline') return;
      const t = now();
      // pings: a burst on joining, then one a second; unanswered after 3 s counts as lost
      if (t >= nextPing) {
        seq = (seq + 1) & 65535; pending.set(seq, t);
        send(C2S.PING, encodePing(seq, t), true);
        nextPing = t + (burst > 0 ? (burst--, 100) : net.pingSec * 1000);
      }
      for (const [k, at] of pending) if (t - at > 3000) { pending.delete(k); pingLog.push(false); if (pingLog.length > 30) pingLog.shift(); }
      // this car's state, paced
      if (status === 'online' && local && t - lastSend >= 1000 / net.sendHz - 2) {
        const s = local();
        if (s) {
          const q = quantise({ ...s, time: stampNow() - (s.ageMs ?? 0) });
          const key = fullStates || forceKey || !base || t - lastKey >= net.keyframeSec * 1000;
          const mask = key ? ALL : maskFor(q, base, sendCount % net.detailEvery === 0);
          // (parked, nothing changed: a short "still here" a few times a second, not 30)
          if (mask || t - lastSend >= 200) {
            send(C2S.STATE, encodeStateMessage(q, mask), false);
            base = mergeState(base, q, mask); lastSend = t; sendCount++;
            if (key) { lastKey = t; forceKey = false; }
          }
        }
      }
      // bandwidth, a second at a time
      if (t - bw.at >= 1000) {
        const k = (t - bw.at) / 1000;
        bw.upKBs = bw.up / 1024 / k; bw.downKBs = bw.down / 1024 / k; bw.up = 0; bw.down = 0; bw.at = t;
      }
    },
    sample(dt) {
      const t = roomNow(), out = [];
      for (const p of players.values()) {
        if (p.id === me) continue;
        let pose = p.remote.sample(t, dt);
        // (Phase 7 Step 3: a car close to this one is drawn nearer the present — towards where it really is, where it can
        // be hit — by its nearness, eased; setNear)
        // (drawnAt: the moment the drawn pose stands for — between the shown time and the present, by the same blend)
        if (pose && p.near > 0) { const pr = p.remote.present(t, p.nearMaxMs ?? 250); if (pr) { const u = p.near * p.near * (3 - 2 * p.near); pose = { ...blendPose(pose, pr, u), near: p.near, aheadMs: pr.aheadMs, drawnAt: pose.shownAt + (pr.stampT + pr.aheadMs - pose.shownAt) * u }; } }
        // (no state for a while and not away: out of range — not drawn)
        const gone = p.status !== 'away' && now() - p.lastStateAt > 3000;
        out.push({ id: p.id, uid: p.uid, npc: p.npc, name: p.name, guest: p.guest, status: p.status, look: p.look, events: p.events, pose: gone ? null : pose });
      }
      return out;
    },
    // (Phase 7 Step 3) a car's nearness (0..1: how close to this one; mp/contactClient.js sets it) and the most it's
    // predicted ahead; present(id, maxMs) → its newest state predicted to now (net/remote.js present)
    setNear(id, n, maxMs = 250) { const p = players.get(id); if (p) { p.near = Math.max(0, Math.min(1, n)); p.nearMaxMs = maxMs; } },
    present(id, maxMs = 250, t = roomNow()) { return players.get(id)?.remote.present(t, maxMs) ?? null; },
    sendEvent(ev) { send(C2S.EVENT, encodeValue(ev), true); if (ev.kind === 'damage' || ev.kind === 'parts') myEvents = [...myEvents, ev].slice(-64); if (ev.kind === 'repair') myEvents = []; },
    setLook(look, events = myEvents) { myLook = look; myEvents = events ?? []; if (conn) send(C2S.HELLO, encodeValue({ look: myLook, events: myEvents }), true); },
    on(k, fn) { listeners[k].add(fn); return () => listeners[k].delete(fn); },
    leave() { setStatus('offline', ''); links?.up.close(); links?.down.close(); const c = conn; conn = null; return c?.leave(); },
    roomNow,
    // (the clock this car's states are stamped with, now — without steering it: a race times its run on it, so the run
    // and the server's view of the same car agree)
    stampAt() { return stamp.local == null ? roomNow() : stamp.room + (now() - stamp.local) * stamp.rate; },
    get id() { return me; },
    get status() { return status; },
    get message() { return message; },
    get conn() { return conn; },
    get clock() { return clock; },
    get players() { return players; },
    get stats() {
      const rem = [...players.values()].filter(p => p.base).map(p => ({ id: p.id, name: p.name, ...p.remote.stats }));
      const lost = pingLog.filter(x => !x).length;
      return {
        status, ping: clock.rtt, jitter: clock.jitter, loss: pingLog.length ? lost / pingLog.length : 0,
        upKBs: bw.upKBs, downKBs: bw.downKBs, upTotal: bw.upTotal, downTotal: bw.downTotal,
        bufferMs: rem.length ? rem.reduce((a, r) => a + r.bufferMs, 0) / rem.length : 0, remotes: rem,
        netsim: links ? { ...links.up.conditions, upStats: links.up.stats, downStats: links.down.stats } : null,
      };
    },
  };
  return api;
}
