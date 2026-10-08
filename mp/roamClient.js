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
//   const RC = createRoamClient({ transport, getTicket, hub, region, cfg, look, events, settings, page, netsim, serverNetsim, endpoint, now })
//     hub: the hub connection's session (mp/client.js: hubSend / on) — it says which instance of a zone to join
//   await RC.start(pos [x, y, z])        the home zone placed and joined
//   RC.update(dt, local)                 every frame: local() → this car's state (codec.js, world frame); joins and leaves zones
//   RC.sample(dt) → [{ id, uid, name, guest, status, look, events, pose, alpha, zone }]   every other car, once
//   RC.send(msg)  to the home zone's room ('mp')    RC.sendAll(msg)  to every zone joined    RC.sendTo(roomId, msg)
//   RC.sendEvent(ev) · RC.setLook(look, events) · RC.setSettings(s) · RC.setParty(id)
//   RC.pin(roomId) / RC.unpin(roomId)   a zone kept while a challenge in it lasts (wherever the car goes)
//   RC.on('mp' | 'status' | 'handoff' | 'zones' | 'roster' | 'event', fn) → off
//   RC.home · RC.zones · RC.group · RC.handoffs · RC.stats · RC.homeNet (the home connection: contact's clock) · RC.leave()

import { createNetClient } from '../net/client.js';
import { createZoneTracker, zoneOf } from './roam.js';
import { quat } from '../net/remote.js';

const smooth = u => u * u * (3 - 2 * u);
const FADE_MS = 500;

export function createRoamClient({ transport, getTicket, hub, region, cfg, look = null, events = [], settings = {}, page = null, party = null, netsim = null, serverNetsim = null, endpoint = null, now = () => performance.now(), tileSize = 512, log = () => {}, blendMs = 350 }) {
  const Z = createZoneTracker(cfg, { tileSize });
  const conns = new Map();            // zone key → { zone, net, roomId, joining, group, home, offs }
  const listeners = new Map();
  const emit = (k, v) => { for (const f of listeners.get(k) ?? []) { try { f(v); } catch (e) { console.warn(e); } } };
  const myPage = page ?? `p${Math.random().toString(36).slice(2, 12)}`;
  const pinned = new Set();
  const ids = new Map();              // uid → a stable id for the game's drawing
  const drawn = new Map();            // uid → { src (zone), pose, blend, seenAt, fade }
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
      const N = createNetClient({ transport, endpoint, getTicket, world: `roam:${region}`, look: myLook, events: myEvents, netsim, serverNetsim, roomName: 'roam',
        join: { how: 'joinOrCreate', options: { region, zone, group: p.group, page: myPage, settings: mySettings, party: myParty, home: Z.home === zone, handoff, extra: Z.home !== zone } } });
      await N.connect();
      if (closed || !conns.has(zone)) { void N.leave(); return null; }
      c.net = N; c.joining = false; c.roomId = N.conn?.roomId ?? null;
      c.offs.push(N.on('status', s => emit('status', { zone, ...s })));
      c.offs.push(N.on('roster', r => emit('roster', { zone, ...r })));
      c.offs.push(N.on('event', e => { const pl = N.players.get(e.from); emit('event', { zone, uid: pl?.uid ?? null, ...e }); }));
      c.offs.push(N.conn.onJson(m => { if (m?.t === 'hello') c.group = m.group; emit('mp', { ...m, zone, roomId: c.roomId }); }));
      log('roam join', { zone, group: c.group, home: Z.home === zone });
      emit('zones', api.zones);
      return c;
    } catch (e) {
      conns.delete(zone);
      emit('status', { zone, status: 'offline', message: e?.message ?? String(e) });
      throw e;
    }
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
    // every other car once: from the zone it was being drawn from while that still shows it, else another (blended)
    sample(dt) {
      const t = now(), out = [], seen = new Set();
      const byUid = new Map();
      for (const c of conns.values()) {
        if (!c.net) continue;
        for (const o of c.net.sample(dt)) {
          if (!o.uid) continue;
          let l = byUid.get(o.uid);
          if (!l) byUid.set(o.uid, l = []);
          l.push({ zone: c.zone, o });
        }
      }
      for (const [uid, list] of byUid) {
        let d = drawn.get(uid);
        const withPose = list.filter(x => x.o.pose);
        const cur = d && withPose.find(x => x.zone === d.src);
        let pick = cur ?? withPose.find(x => x.zone === Z.home) ?? withPose[0] ?? list[0];
        if (!ids.has(uid)) ids.set(uid, ids.size + 1);
        const o = pick.o;
        if (!d) { d = { src: pick.zone, pose: null, blend: null, fadeIn: o.pose ? t : null, born: t }; drawn.set(uid, d); }
        // the source changed (the zone it was drawn from doesn't show it now): blend from where it was drawn
        if (pick.zone !== d.src && o.pose && d.pose) { d.blend = { at: t, from: d.pose }; d.src = pick.zone; }
        else if (pick.zone !== d.src) d.src = pick.zone;
        let pose = o.pose;
        if (pose && d.blend) {
          const u = Math.min(1, (t - d.blend.at) / blendMs);
          if (u >= 1) d.blend = null;
          else {
            // (where the old drawing would be now, moving on at its own speed, eased into the new one)
            const el = (t - d.blend.at) / 1000, f = d.blend.from, k = smooth(u);
            const was = [f.pos[0] + f.vel[0] * el, f.pos[1] + f.vel[1] * el, f.pos[2] + f.vel[2] * el];
            pose = { ...pose, pos: [was[0] + (pose.pos[0] - was[0]) * k, was[1] + (pose.pos[1] - was[1]) * k, was[2] + (pose.pos[2] - was[2]) * k], rot: quat.slerp(quat.spin(f.rot, f.ang ?? [0, 0, 0], el), pose.rot, k), blending: true };
          }
        }
        if (pose && d.fadeIn == null) d.fadeIn = t;
        if (pose) d.pose = pose;
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
      return { zones: per, handoffs, upKBs: per.reduce((a, x) => a + (x.upKBs ?? 0), 0), downKBs: per.reduce((a, x) => a + (x.downKBs ?? 0), 0), ping: per.find(x => x.home)?.ping ?? null };
    },
    zoneAt(pos) { return zoneOf(pos[0], pos[2], Z.size).key; },
    async leave() { closed = true; const all = [...conns.values()]; conns.clear(); for (const c of all) { for (const f of c.offs) f(); } await Promise.all(all.map(c => Promise.race([Promise.resolve(c.net?.leave()).catch(() => {}), new Promise(r => setTimeout(r, 2000))]))); },
  };
  return api;
}
