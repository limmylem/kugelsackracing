// Free roam, the game's side of the zones (Phase 7 Step 4; docs/FREE_ROAM.md): the game and the bots alike. The world is
// cut into zones (mp/roam.js); this player is connected to the instance of its HOME zone and, near a border, to the
// neighbour's too (the same instance group where it can be). Each connection is Step 1's (net/client.js): its own clock
// sync, its car sent, the cars of that zone shown. Driving over a border changes nothing anyone sees: before the line the
// next zone is already joined (the car's been sent there and its cars received for overlapM), the home moves handoffM
// past the line, and the old zone is left once the car is well clear of it.
//
// The other cars are merged by player: a car seen through two zones is drawn from one of them (its "source"), kept as
// long as that zone still shows it; when it doesn't, the car is drawn from the other — blended from where it was drawn
// over a moment, so nothing jumps. Cars appearing from or leaving to a zone this player isn't in fade in and out.
//
//   const RC = createRoamClient({ transport, getTicket, hub, region, cfg, look, events, settings, page, netsim, serverNetsim, endpoint, now, drawOthers })
//     hub: the hub connection's session (mp/client.js: hubSend / on) — it says which instance of a zone to join
//   await RC.start(pos [x, y, z])        the home zone placed and joined
//   RC.update(dt, local)                 every frame: local() → this car's state (codec.js, world frame); joins and leaves zones
//   RC.sample(dt) → [{ id, uid, name, guest, status, look, events, pose, alpha, zone }]   every other car, once
//   RC.send(msg)  to the home zone's room ('mp')    RC.sendAll(msg)  to every zone joined    RC.sendTo(roomId, msg)
//   RC.sendEvent(ev) · RC.setLook(look, events) · RC.setSettings(s) · RC.setParty(id)
//   RC.pin(roomId) / RC.unpin(roomId)   a zone kept while a challenge in it lasts (wherever the car goes: done by itself on
//                                       'challenge-start' and 'challenge-results')
//   RC.on('mp' | 'status' | 'handoff' | 'zones' | 'roster' | 'event', fn) → off
//   RC.home · RC.zones · RC.group · RC.handoffs · RC.stats · RC.homeNet (the home connection: contact's clock) · RC.leave()

import { createNetClient } from '../net/client.js';
import { CODES } from '../net/protocol.js';
import { createZoneTracker, zoneOf } from './roam.js';
import { quat } from '../net/remote.js';

const smooth = u => u * u * (3 - 2 * u);
const FADE_MS = 500, STALE_MS = 350, FROZEN_MS = 600, MAX_BLEND_M = 3;
// how far apart a view's newest states came (ms): a far car is sent less often (Step 1's interest rings)
const spacing = buf => buf?.length >= 2 ? Math.max(0, buf[buf.length - 1].time - buf[buf.length - 2].time) : 0;
// a zone's connection lost (the server closed it, a join failed or never answered): joined again while the car's in that
// zone, after RETRY_MS, doubling each time to RETRY_MAX_MS — except for reasons that are final (a ban, another tab, an old game)
const RETRY_MS = 1000, RETRY_MAX_MS = 30000, JOIN_MS = 20000;
const FINAL = new Set([CODES.VERSION, CODES.BANNED, CODES.KICKED, CODES.ELSEWHERE, CODES.GUESTS]);

// how far ahead one zone's clock is of another's, from the same car's states in each (pairs: [[step, stamp]], oldest
// first): at a step inside both, the stamp in b minus the stamp in a (each interpolated between its neighbouring states)
export function clockOffset(a, b) {
  const at = (pairs, k) => { for (let i = 1; i < pairs.length; i++) { const [k0, t0] = pairs[i - 1], [k1, t1] = pairs[i]; if (k0 <= k && k <= k1 && k1 > k0) return t0 + (t1 - t0) * (k - k0) / (k1 - k0); } return null; };
  const lo = Math.max(a[0]?.[0] ?? Infinity, b[0]?.[0] ?? Infinity), hi = Math.min(a.at(-1)?.[0] ?? -Infinity, b.at(-1)?.[0] ?? -Infinity);
  if (!(hi >= lo)) return null;
  // (the newest step both have; a state's own step where one zone has it, so one side needs no interpolating)
  for (let i = b.length - 1; i >= 0; i--) { const [k, tb] = b[i]; if (k > hi || k < lo) continue; const ta = at(a, k); if (ta != null) return tb - ta; }
  return null;
}

export function createRoamClient({ transport, getTicket, hub, region, cfg, look = null, events = [], settings = {}, page = null, party = null, netsim = null, serverNetsim = null, endpoint = null, now = () => performance.now(), tileSize = 512, log = () => {}, blendMs = 350, drawOthers = true }) {
  const Z = createZoneTracker(cfg, { tileSize });
  const conns = new Map();            // zone key → { zone, net, roomId, joining, group, home, offs }
  const listeners = new Map();
  const emit = (k, v) => { for (const f of listeners.get(k) ?? []) { try { f(v); } catch (e) { console.warn(e); } } };
  const myPage = page ?? `p${Math.random().toString(36).slice(2, 12)}`;
  const pinned = new Set();
  const ids = new Map();              // uid → a stable id for the game's drawing
  const drawn = new Map();            // uid → { src (zone), pose, blend, seenAt, fade }
  const clocks = new Map();           // 'uid|zone' → { tick, time, msPerTick }: a zone's clock against that car's physics steps
  const retry = new Map();            // zone key → { at, n }: when to try joining it again (a lost connection, a failed join)
  let switches = 0, reappeared = 0, lostCount = 0;
  let group = null, mine = null, myLook = look, myEvents = events, mySettings = { ...settings }, myParty = party, handoffs = 0, started = false, closed = false, req = 0;

  // which instance of a zone to join: the hub decides (party, friends, players near, ping — mp/roam.js placeInstance)
  const place = (zone, pos) => new Promise(res => {
    const id = ++req;
    const h = hub?.();
    if (!h) return res({ group: group ?? 'g1', why: 'no hub' });
    const timer = setTimeout(() => { off(); res({ group: group ?? 'g1', why: 'no answer' }); }, 4000);
    const off = h.on('roam-place', m => { if (m.req !== id) return; clearTimeout(timer); off(); res(m); });
    h.hubSend({ t: 'roam-place', req: id, region, zone, pos: pos ? [pos[0], pos[2]] : null, group });
  });

  async function join(zone, { home = false, handoff = false } = {}) {
    if (conns.has(zone) || closed) return conns.get(zone);
    const c = { zone, net: null, joining: true, home, group: null, offs: [], since: now() };
    conns.set(zone, c);
    try {
      const p = await place(zone, mine?.pos ?? null);
      c.group = p.group;
      if (home || !group) group = p.group;
      const N = createNetClient({ transport, endpoint, getTicket, world: `roam:${region}`, look: myLook, events: myEvents, netsim, serverNetsim, roomName: 'roam', drawOthers,
        join: { how: 'joinOrCreate', options: { region, zone, group: p.group, page: myPage, settings: mySettings, party: myParty, home: Z.home === zone, handoff, extra: Z.home !== zone, rejoin: retry.has(zone) } } });
      // (a join that never answers is given up, and tried again later)
      const connecting = N.connect();
      const answered = await Promise.race([connecting.then(() => true), new Promise(r => setTimeout(() => r(false), JOIN_MS))]);
      if (!answered) { connecting.then(() => N.leave(), () => {}); throw Object.assign(new Error('The zone server didn\'t answer.'), { code: 0 }); }
      if (closed || conns.get(zone) !== c) { void N.leave(); return null; }
      c.net = N; c.joining = false; c.roomId = N.conn?.roomId ?? null;
      retry.delete(zone);
      c.offs.push(N.on('status', s => {
        emit('status', { zone, ...s });
        // (closed by the server for good — not a ban, another tab or an old game: let go, to be joined again)
        if (s.status === 'offline' && conns.get(zone) === c && !FINAL.has(s.code)) lost(zone, c, s.message);
      }));
      c.offs.push(N.on('roster', r => emit('roster', { zone, ...r })));
      c.offs.push(N.on('event', e => { const pl = N.players.get(e.from); emit('event', { zone, uid: pl?.uid ?? null, ...e }); }));
      c.offs.push(N.conn.onJson(m => {
        if (m?.t === 'hello') c.group = m.group;
        // (a challenge lives in the zone it started in: that zone is kept, wherever the car goes, until it's over)
        if (m?.t === 'challenge-start') api.pin(c.roomId);
        if (m?.t === 'challenge-results') api.unpin(c.roomId);
        emit('mp', { ...m, zone, roomId: c.roomId });
      }));
      log('roam join', { zone, group: c.group, home: Z.home === zone });
      emit('zones', api.zones);
      return c;
    } catch (e) {
      if (conns.get(zone) === c) { conns.delete(zone); if (!FINAL.has(e?.code)) later(zone); }
      emit('status', { zone, status: 'offline', message: e?.message ?? String(e), code: e?.code ?? 0 });
      throw e;
    }
  }
  const later = zone => { const n = (retry.get(zone)?.n ?? 0) + 1; retry.set(zone, { at: now() + Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** (n - 1)), n }); };
  function lost(zone, c, why) {
    conns.delete(zone);
    for (const f of c.offs) f();
    try { void Promise.resolve(c.net?.leave()).catch(() => {}); } catch { /* already closed */ }
    if (c.roomId) pinned.delete(c.roomId);
    later(zone);
    lostCount++;
    log('roam lost', { zone, why });
    emit('zones', api.zones);
  }
  function drop(zone) {
    const c = conns.get(zone);
    if (!c || [...pinned].some(r => r === c.roomId)) return;
    conns.delete(zone);
    for (const f of c.offs) f();
    void Promise.resolve(c.net?.leave()).catch(() => {});
    log('roam leave', { zone });
    emit('zones', api.zones);
  }
  const homeConn = () => conns.get(Z.home) ?? null;

  const api = {
    get home() { return Z.home; }, get group() { return group; }, get zones() { return [...conns.keys()]; }, get handoffs() { return handoffs; },
    get homeNet() { return homeConn()?.net ?? null; }, get page() { return myPage; },
    connOf(zone) { return conns.get(zone) ?? null; },
    on(k, fn) { if (!listeners.has(k)) listeners.set(k, new Set()); listeners.get(k).add(fn); return () => listeners.get(k)?.delete(fn); },

    async start(pos) {
      mine = { pos };
      const u = Z.update(pos[0], pos[2]);
      started = true;
      await join(u.home, { home: true });
      for (const z of u.zones) if (z !== u.home) void join(z).catch(() => {});
      return api;
    },
    // every frame: this car to every zone joined; the zones it should be in now
    update(dt, local) {
      let s = null;
      const get = () => { if (s === null) { s = local?.() ?? false; if (s) mine = s; } return s || null; };
      for (const c of conns.values()) c.net?.update(dt, get);
      get();
      if (!started || !mine?.pos) return;
      const u = Z.update(mine.pos[0], mine.pos[2]);
      for (const z of u.add) void join(z).catch(() => {});
      // (a zone it should be in but isn't — its connection lost, or its join failed: tried again, less often each time)
      for (const z of u.zones) if (!conns.has(z) && retry.has(z) && now() >= retry.get(z).at) void join(z).catch(() => {});
      for (const z of retry.keys()) if (!u.zones.includes(z)) retry.delete(z);
      if (u.handoff) {
        handoffs++;
        // (the new home: told it's home now — where this player is saved, what their friends see; the old one isn't)
        const was = conns.get(u.handoff.from), next = conns.get(u.handoff.to);
        if (next?.net) next.net.conn?.sendJson({ t: 'home', home: true }); else void join(u.handoff.to, { home: true, handoff: true }).catch(() => {});
        was?.net?.conn?.sendJson({ t: 'home', home: false });
        if (next?.group) group = next.group;
        emit('handoff', { ...u.handoff, group });
      }
      for (const z of u.drop) drop(z);
    },
    // every other car once: from the zone it was being drawn from while that still shows it, else another — lined up in
    // time with the one it was drawn from (the same physics step, whatever each zone's clock says), then blended
    sample(dt) {
      const t = now(), out = [], seen = new Set();
      const byUid = new Map();
      for (const c of conns.values()) {
        if (!c.net) continue;
        for (const o of c.net.sample(dt)) {
          if (!o.uid) continue;
          let l = byUid.get(o.uid);
          if (!l) byUid.set(o.uid, l = []);
          const pl = c.net.players.get(o.id), rem = pl?.remote;
          l.push({ zone: c.zone, o, rem });
          // (each zone's clock against the car's own physics steps: its newest state, and how long a step is)
          // (its recent states' steps and stamps: kept a moment after the zone forgets the car, to line up a switch with)
          const b = rem?.buf;
          if (b?.length >= 2) { const k = `${o.uid}|${c.zone}`, was = clocks.get(k); if (!was || t - was.at > 50) clocks.set(k, { pairs: b.slice(-60).map(x => [x.tick, x.time]), at: t }); }
        }
      }
      for (const [uid, list] of byUid) {
        let d = drawn.get(uid);
        const withPose = list.filter(x => x.o.pose);
        // (the zone it's drawn from is kept while its view is fresh; one whose view has gone stale — no new state for a
        // moment, the car predicted on — gives way to a zone with a fresh one)
        // (allowing for how far apart its states come: a far car is sent a few times a second, and is predicted between them)
        const fresh = x => !x.o.pose.extrapolating || (x.o.pose.staleMs ?? 0) < STALE_MS + spacing(x.rem?.buf);
        const cur = d && withPose.find(x => x.zone === d.src);
        const better = cur && !fresh(cur) ? withPose.find(x => x !== cur && fresh(x)) : null;
        const pick = better ?? cur ?? withPose.find(x => x.zone === Z.home && fresh(x)) ?? withPose.find(fresh) ?? withPose[0] ?? list[0];
        if (!ids.has(uid)) ids.set(uid, ids.size + 1);
        let o = pick.o;
        if (!d) { d = { src: pick.zone, pose: null, blend: null, fadeIn: o.pose ? t : null, born: t }; drawn.set(uid, d); }
        // (a car out of view a while, back through another zone: it just appears there, fading in)
        if (pick.zone !== d.src && (!d.pose || t - (d.drawnAt ?? -Infinity) > 150)) { d.src = pick.zone; d.blend = null; d.pose = null; d.fadeIn = o.pose ? t : null; }
        if (pick.zone !== d.src) {
          // (the view it was drawn from had frozen: the car was drawn wrong already — it's put right at once, flagged so)
          // the source changed: the new zone's showing of the car carried on from the moment the old one showed — the
          // old zone's time of that moment, in the new zone's clock, through the car's physics steps
          const A = clocks.get(`${uid}|${d.src}`), B = clocks.get(`${uid}|${pick.zone}`);
          const frozen = d.pose.extrapolating && (d.pose.staleMs ?? 0) > FROZEN_MS + (A ? spacing(A.pairs.map(([, time]) => ({ time }))) : 0);
          // (the two zones' clocks against each other: a physics step both have states round, its stamp in each — only from a
          // fresh record of the old zone's, and to a moment the new zone has states round)
          const offset = A && B && t - A.at < 300 ? clockOffset(A.pairs, B.pairs) : null, target = offset != null && d.pose?.shownAt != null ? d.pose.shownAt + offset : null;
          const alignable = target != null && target >= B.pairs[0][1] && target <= B.pairs[B.pairs.length - 1][1] + 300;
          if (!frozen && alignable && pick.rem) {
            // (lined up with the moment last drawn, then on by this frame's time like any other frame)
            pick.rem.align(target, d.pose);
            const c = conns.get(pick.zone);
            const again = c?.net?.players.get(o.id)?.remote.sample(c.net.roomNow(), dt);
            if (again) o = { ...o, pose: again };
          }
          const gap = o.pose && d.pose ? Math.hypot(o.pose.pos[0] - d.pose.pos[0] - d.pose.vel[0] * dt, o.pose.pos[2] - d.pose.pos[2] - d.pose.vel[2] * dt) : 0;
          // (frozen, or the two can't be lined up and are far apart: the car was being drawn wrong — put right at once, flagged)
          if (frozen || (!alignable && gap > MAX_BLEND_M)) { reappeared++; log('roam reappeared', { uid, from: d.src, to: pick.zone, frozen, staleMs: Math.round(d.pose.staleMs ?? 0), gapM: +gap.toFixed(2), pos: d.pose.pos.map(Math.round) }); d.blend = null; if (o.pose) o = { ...o, pose: { ...o.pose, teleported: true } }; }
          else if (o.pose && d.pose) {
            // (what's left between the two drawings — where the old one would be this frame, and the new one — eased away)
            const f = d.pose, was = [f.pos[0] + f.vel[0] * dt, f.pos[1] + f.vel[1] * dt, f.pos[2] + f.vel[2] * dt];
            const off = [was[0] - o.pose.pos[0], was[1] - o.pose.pos[1], was[2] - o.pose.pos[2]];
            // (over longer the bigger it is: a few centimetres in blendMs; a metre — a switch that couldn't be lined up — in
            // about half a second a metre, so it never moves more than a few centimetres a frame)
            // (and its motion: the old drawing's velocity handed over to the new one's over Tv, not in a frame — the two views'
            // speeds differ a little, and more if the old one was being predicted; a change in one frame is a kink the eye catches)
            const dv = [f.vel[0] - o.pose.vel[0], f.vel[1] - o.pose.vel[1], f.vel[2] - o.pose.vel[2]];
            const Tv = Math.min(0.5, Math.max(0.15, 0.04 * Math.hypot(...dv)));
            d.blend = { at: t, off, T: Math.max(blendMs, 500 * Math.hypot(...off)), dv, Tv, qoff: quat.mul(quat.spin(f.rot, f.ang ?? [0, 0, 0], dt), quat.conj(o.pose.rot)) };
          }
          d.src = pick.zone; switches++;
        }
        let pose = o.pose;
        if (pose && d.blend) {
          const b = d.blend, el = (t - b.at) / 1000, u = Math.min(1, el * 1000 / (b.T ?? blendMs)), e = Math.min(el, b.Tv ?? 0);
          if (u >= 1 && e >= (b.Tv ?? 0)) d.blend = null;
          else {
            // (the offset at the switch — a centimetre or two once lined up in time — fading to nothing; and the difference in
            // speed carried on at first, then gone: h(e) = e·(1 − e/Tv)², its rate 1 at the switch and 0 by Tv)
            const w = 1 - smooth(u), h = b.dv ? e * (1 - e / b.Tv) ** 2 : 0, dv = b.dv ?? [0, 0, 0];
            const pos = [0, 1, 2].map(k => pose.pos[k] + b.off[k] * w + dv[k] * h);
            // (its motion as drawn — the view's own, plus the offset easing away — as the view itself reports it)
            const vel = d.pose && dt > 1e-4 ? [(pos[0] - d.pose.pos[0]) / dt, (pos[1] - d.pose.pos[1]) / dt, (pos[2] - d.pose.pos[2]) / dt] : pose.vel;
            pose = { ...pose, pos, vel, rot: quat.mul(quat.slerp([0, 0, 0, 1], b.qoff, w), pose.rot), blending: true };
          }
        }
        if (pose && d.fadeIn == null) d.fadeIn = t;
        if (pose) { d.pose = pose; d.drawnAt = t; }
        seen.add(uid);
        d.fadeOut = null;
        // (a car appearing — over the edge of the zones this player is in, or joining — fades in)
        const alpha = pose ? Math.min(1, (t - (d.fadeIn ?? t)) / FADE_MS) : 0;
        out.push({ ...o, id: ids.get(uid), netId: o.id, zone: pick.zone, pose, alpha });
      }
      // a car no zone shows any more: faded out where it was last drawn, then forgotten
      for (const [uid, d] of drawn) {
        if (seen.has(uid)) continue;
        d.fadeOut ??= t;
        const a = 1 - (t - d.fadeOut) / FADE_MS;
        if (a <= 0 || !d.pose) { drawn.delete(uid); continue; }
        const el = Math.min(0.5, (t - d.fadeOut) / 1000), f = d.pose;
        out.push({ id: ids.get(uid), uid, name: null, status: 'gone', look: null, events: [], pose: { ...f, pos: [f.pos[0] + f.vel[0] * el, f.pos[1], f.pos[2] + f.vel[2] * el] }, alpha: a, leaving: true });
      }
      return out;
    },
    send(m) { homeConn()?.net?.conn?.sendJson(m); },
    sendAll(m) { for (const c of conns.values()) c.net?.conn?.sendJson(m); },
    sendTo(roomId, m) { for (const c of conns.values()) if (c.roomId === roomId) c.net?.conn?.sendJson(m); },
    sendEvent(ev) { if (ev.kind === 'damage' || ev.kind === 'parts') myEvents = [...myEvents, ev].slice(-64); if (ev.kind === 'repair') myEvents = []; for (const c of conns.values()) c.net?.sendEvent(ev); },
    setLook(l, ev = myEvents) { myLook = l; myEvents = ev ?? []; for (const c of conns.values()) c.net?.setLook(l, myEvents); },
    setSettings(s) { mySettings = { ...mySettings, ...s }; api.sendAll({ t: 'settings', settings: mySettings }); },
    setParty(id) { myParty = id ?? null; api.sendAll({ t: 'party', id: myParty }); },
    get settings() { return mySettings; },
    pin(roomId) { if (roomId) pinned.add(roomId); }, unpin(roomId) { pinned.delete(roomId); if (mine?.pos) { const u = Z.update(mine.pos[0], mine.pos[2]); for (const c of [...conns.values()]) if (!u.zones.includes(c.zone) && c.zone !== Z.home) drop(c.zone); } },
    // the player this car is, in any zone (for contact, the overlay)
    player(uid) { for (const c of conns.values()) for (const p of c.net?.players.values() ?? []) if (p.uid === uid) return { zone: c.zone, net: c.net, id: p.id, player: p }; return null; },
    get stats() {
      const per = [...conns.values()].map(c => ({ zone: c.zone, group: c.group, home: c.zone === Z.home, status: c.net?.status ?? 'joining', ...(c.net ? { ping: c.net.stats.ping, upKBs: c.net.stats.upKBs, downKBs: c.net.stats.downKBs, players: c.net.players.size } : {}) }));
      return { zones: per, handoffs, switches, reappeared, lost: lostCount, upKBs: per.reduce((a, x) => a + (x.upKBs ?? 0), 0), downKBs: per.reduce((a, x) => a + (x.downKBs ?? 0), 0), ping: per.find(x => x.home)?.ping ?? null };
    },
    zoneAt(pos) { return zoneOf(pos[0], pos[2], Z.size).key; },
    async leave() { closed = true; const all = [...conns.values()]; conns.clear(); for (const c of all) { for (const f of c.offs) f(); } await Promise.all(all.map(c => Promise.race([Promise.resolve(c.net?.leave()).catch(() => {}), new Promise(r => setTimeout(r, 2000))]))); },
  };
  return api;
}
