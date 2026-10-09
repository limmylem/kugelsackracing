// Multiplayer in the game (Phase 7 Step 1; docs/MULTIPLAYER.md): your car to the other players, theirs in your world.
//
// Your car is simulated here, as always (no input delay); its state goes to the real-time server every frame it's
// due (net/client.js paces it), in the shared world frame, stamped with the moment its physics state is for. A crash
// (its dents, glass, parts — garage/damageLog.js packCrash, the Phase 4 compact form), a reset and a part coming off
// go as events that always arrive. Everyone else's car is drawn where net/remote.js says it was a moment ago: its
// own model, parts and paint; its wheels turning at their speed, steering and riding the suspension; its brake,
// reverse and head lights; its engine at its revs and its tyres squealing at their slip (positioned, quieter with
// distance); its dents from its crashes, and its parts hanging or gone. Kinematic: other cars don't push yours yet
// (collisions between players: Step 3).
//
// The game provides the drawing (an adapter: testtrack/test-scene.js):
//   { toWorld([x,y,z]), toSim([x,y,z]), makeCar(look) → handle, dropCar(handle), drawCar(handle, pose, wheels),
//     shown(handle) → whether it's in the scene being drawn and visible, setDamage(handle, view),
//     setPart(handle, socket, state), listener(posSim) → [x, y, z] in the camera's frame,
//     audio() → the game's audio or null, carSound(audio, engine) (testtrack/audio.js remoteCarSound),
//     screen(posSim) → { x, y } on screen or null, place(posWorld, headingDeg) (your car moved there), rules }
//
//   const M = await joinMultiplayer({ account, world, look, adapter, player, netsim, serverNetsim, debug })
//   M.frame(dt, local)          every frame: local() → your car's state (codec.js) or null
//   M.crash(outcome, build) · M.part(socket, state) · M.reset() · M.repair() · M.setLook(look)
//   M.status · M.message · M.overlay.toggle() · M.leave()
//   M.others() → [{ id, netId, name, distM, drawn, why, onScreen, ageMs }]    each other player as this window sees it
//   (Phase 7 Step 2) a race's room: joinMultiplayer({ net, … }) draws the cars of a connection already made (the race's:
//   mp/client.js) — leave() then lets it be; label(o) → the text over each car (null: its name); spread: false (a race
//   puts every car on its own grid slot: none is moved aside); M.car(id) → { pose, handle } (the spectator's camera)
//   M.toNearest() → your car beside the nearest other player (the development key F9), or why not
//   (Phase 7 Step 4, free roam) lod(o, distM) → 'full' | 'simple' | 'marker' (simple: no sound; marker: not drawn — the maps
//   show it); nameOpacity(o, distM) → 0..1 (0: no name); a car's o.alpha fades it in and out (adapter.setOpacity(handle, a))
//
// Two windows of one browser share its sign-in, and an account joining twice replaces itself: in development each
// window can be a guest of its own instead (?mp&player=A, ?mp&player=B: POST /rt/ticket { player }).
// A window in the background (minimised, another tab, covered) stops drawing frames; a timer in a worker keeps its
// connection alive and tells the others its car is paused, so it isn't dropped as gone.
// Players arrive where the world puts every new car; a car joining on top of another is moved beside it.

import { NET } from '../net/settings.js';
import { createNetClient } from '../net/client.js';
import { createColyseusTransport } from '../net/transport.js';
import { parseConditions } from '../net/netsim.js';
import { LIGHT } from '../net/protocol.js';
import { createNetOverlay } from '../net/overlay.js';
import { packCrash, packDents, unpackDents, dentsOf } from '../garage/damageLog.js';

// Online (Phase 7 Step 5: the site's build says multiplayer: true) it's on without asking — auto: for a signed-in
// player; ?mp (or ?mp=<room name>) turns it on anywhere, ?mp=0 off; ?netsim=150,30,0.05[,datagram] and ?servernetsim=…
// add a bad network on this side and on the server's; ?netdebug shows the overlay from the start; ?player=A
// (development) plays this window as a guest of its own
export function multiplayerOptions(loc = globalThis.location, site = globalThis.KR_SITE) {
  const q = new URLSearchParams(loc?.search ?? ''), mp = q.get('mp');
  if (mp === '0' || (mp == null && site?.multiplayer !== true)) return null;
  const player = /^[A-Za-z0-9_-]{1,16}$/.test(q.get('player') ?? '') ? q.get('player') : null;
  return { room: mp || null, auto: mp == null, player, netsim: parseConditions(q.get('netsim')), serverNetsim: q.get('servernetsim') || null, debug: q.has('netdebug') };
}

// development or tests (not online): the extra keys and hints
export const devMode = (site = globalThis.KR_SITE) => !site?.env || site.env === 'development' || site.env === 'test';
// how far apart two cars must be not to count as one on top of the other (m), and where a car is put beside another
const ON_TOP_M = 2.5, BESIDE_M = 3.5;

// where the real-time server is: the site's setting (rt: wss://rt.<domain> online), else this computer's (npm run rt)
export function rtEndpoint(site = globalThis.KR_SITE ?? {}, ticketUrl = null, loc = globalThis.location) {
  const u = site.rt || ticketUrl || `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.hostname}:2567`;
  return u.replace(/^ws(s?):/, 'http$1:').replace(/\/$/, '');
}

// The look another player's game draws your car with (and its damage so far: the dents packed, as the save keeps them)
export function lookOf({ carId, paint, parts, engine, damage, name }) {
  const packed = damage ? { shell: packDents(damage.shell?.dents ?? []), broken: damage.shell?.broken ?? [], parts: Object.fromEntries(Object.entries(damage.parts ?? {}).map(([k, d]) => [k, packDents(d)]).filter(([, t]) => t)) } : null;
  return { carId, paint: paint ?? null, parts: parts ?? {}, sound: engine ? { file: engine.sound ?? null, idle: engine.idleRpm ?? 900, redline: engine.redlineRpm ?? 6800 } : null, damage: packed, name: name ?? null };
}

// A car's damage to draw: its look's (when it joined) with every crash since folded on, the same way on every machine
export function damageView(look, events, rules) {
  const base = look?.damage ?? {}, shell = unpackDents(base.shell), parts = Object.fromEntries(Object.entries(base.parts ?? {}).map(([k, t]) => [k, unpackDents(t)]));
  const broken = new Set(base.broken ?? []);
  const hits = { shell: [], parts: {} };
  for (const e of events ?? []) {
    if (e.kind !== 'damage' || !e.crash) continue;
    for (const [k, t] of Object.entries(e.crash.hits ?? {})) { const list = unpackDents(t); if (k === 'shell') hits.shell.push(...list); else (hits.parts[k] ??= []).push(...list); }
    for (const b of e.crash.broken ?? []) broken.add(b);
  }
  const fold = (before, more) => more.length ? dentsOf({ base: before, hits: more }, rules) : before;
  const out = { shell: { dents: fold(shell, hits.shell), broken: [...broken] }, parts: { ...parts } };
  for (const [k, more] of Object.entries(hits.parts)) out.parts[k] = fold(parts[k] ?? [], more);
  return out;
}

// a connection of its own (free roam: this world's room), with a ticket from the API for each join
async function connectNet({ account, world, look, player, netsim, serverNetsim, settings }) {
  const Colyseus = await import('../net/vendor/colyseus.js');
  const N = createNetClient({ transport: createColyseusTransport(Colyseus), world, look, netsim, serverNetsim, settings, getTicket: ticketGetter(account, player) });
  await N.connect();
  return N;
}
// a fresh join ticket from the API each time (they're used once); development: ?player=A's
export function ticketGetter(account, player = null) {
  return async () => {
    const t = await account.api.post('/rt/ticket', player ? { player } : {});
    return { ticket: t.ticket, url: rtEndpoint(globalThis.KR_SITE, t.url) };
  };
}

export async function joinMultiplayer({ account, world, look, adapter: A, player = null, netsim = null, serverNetsim = null, debug = false, settings = NET, net = null, label = null, spread = true, lod = null, nameOpacity = null }) {
  const ownNet = !net;
  const N = net ?? await connectNet({ account, world, look, player, netsim, serverNetsim, settings });
  const cars = new Map();          // id → { handle, loading, lookKey, spin: [], sound, label, damageKey, parts }
  let mine = null, landedAt = null; // your car's last state (world frame), as sent; when it was first in the world
  let cleared = false;             // (joined on top of another car: moved beside it, once)
  const overlay = createNetOverlay(N, { shown: debug, self: player ? `Player ${player}` : account?.me?.name ?? null, others: () => api.others(), footer: devMode() ? 'F8 this overlay · F9 your car beside the nearest player' : 'F8 this overlay' });
  let overlayAt = 0, lastFrame = null;
  const labels = document.createElement('div');
  labels.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:55';
  document.body.appendChild(labels);
  // (disconnected: says so until it's back, not for a moment — and why)
  const banner = document.createElement('div');
  banner.id = 'krMpBanner';
  banner.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:90;max-width:min(560px,92vw);font:600 13px/1.4 Barlow,system-ui,sans-serif;color:#fff;background:rgba(150,40,30,.92);border-radius:10px;padding:8px 14px;text-align:center;pointer-events:none';
  banner.hidden = true;
  document.body.appendChild(banner);
  const showBanner = () => {
    const st = N.status;
    if (st === 'offline' && N.message) {
      const two = /another tab or device/.test(N.message) && devMode() ? ' Two windows on one computer share a sign-in: open them as ?mp&player=A and ?mp&player=B.' : '';
      banner.textContent = `Multiplayer: ${N.message}${two}`; banner.hidden = false;
    } else if (st === 'reconnecting') { banner.textContent = 'Multiplayer: the connection dropped. Reconnecting…'; banner.hidden = false; }
    else banner.hidden = true;
  };
  const offs = [N.on('status', showBanner)];
  // (the page closed, reloaded or left: gone for the others now, not "reconnecting…" for the next 20 s)
  const bye = () => { if (ownNet) void N.leave(); };
  addEventListener('pagehide', bye);

  // a window in the background draws no frames: a worker's timer (not slowed down like the page's) keeps the
  // connection alive, your car still for the others, marked paused
  let beat = null;
  try {
    const src = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 250)'], { type: 'text/javascript' }));
    beat = new Worker(src);
    URL.revokeObjectURL(src);
    let lastBeat = performance.now();
    beat.onmessage = () => {
      const t = performance.now(), dt = (t - lastBeat) / 1000;
      lastBeat = t;
      if (lastFrame != null && t - lastFrame < 1000) return;         // (frames are being drawn, if slowly: they do it)
      // (hidden — minimised, another tab, covered: your car paused for the others; visible but not drawing — a slow
      // machine, a debugger — only kept connected)
      const hidden = globalThis.document?.visibilityState === 'hidden';
      N.update(dt, hidden ? () => mine && { ...mine, vel: [0, 0, 0], ang: [0, 0, 0], throttle: 0, wheels: mine.wheels.map(w => ({ ...w, omega: 0, slip: 0 })), flags: mine.flags | LIGHT.AWAY, ageMs: 0 } : null);
    };
  } catch { beat = null; }

  const drop = id => {
    const c = cars.get(id);
    if (!c) return;
    c.dropped = true;
    if (c.handle) A.dropCar(c.handle);
    c.sound?.dispose(); c.label?.remove();
    cars.delete(id);
  };
  offs.push(N.on('roster', r => { if (r.leave) drop(r.leave.id); }));
  offs.push(N.on('event', e => {
    const c = cars.get(e.from);
    if (!c?.handle) return;
    if (e.kind === 'parts') A.setPart(c.handle, e.socket, e.to);
    if (e.kind === 'repair') { c.damageKey = null; for (const s of c.partsOff ?? []) A.setPart(c.handle, s, 'attached'); c.partsOff = new Set(); }
    if (e.kind === 'parts') (c.partsOff ??= new Set()).add(e.socket);
  }));

  const api = {
    net: N, overlay,
    get status() { return N.status; },
    get message() { return N.message; },
    frame(gameDt, local) {
      // (real time since the last frame: the game caps its own step on a slow frame, but the others' cars are shown on
      // the server's clock, which doesn't wait)
      const nowMs = performance.now(), dt = lastFrame == null ? gameDt : Math.min(5, (nowMs - lastFrame) / 1000);
      lastFrame = nowMs;
      N.update(dt, () => { const s = local(); if (s) { mine = s; landedAt ??= nowMs; } return s; });
      const seen = new Set();
      for (const o of N.sample(dt)) {
        seen.add(o.id);
        let c = cars.get(o.id);
        const lookKey = JSON.stringify([o.look?.carId, o.look?.paint, o.look?.parts]);
        if (!c || c.lookKey !== lookKey) {
          if (c) drop(o.id);
          c = { lookKey, spin: [], loading: true };
          cars.set(o.id, c);
          const mine = c;
          Promise.resolve(A.makeCar(o.look ?? {})).then(h => {
            if (mine.dropped) { A.dropCar(h); return; }
            mine.handle = h; mine.loading = false;
            // (parts already off it when it was first seen)
            for (const e of o.events ?? []) if (e.kind === 'parts') { A.setPart(h, e.socket, e.to); (mine.partsOff ??= new Set()).add(e.socket); }
          }, err => console.warn(`Another player's car didn't load: ${err.message ?? err}`));
          c.label = document.createElement('div');
          c.label.style.cssText = 'position:absolute;transform:translate(-50%,-100%);font:600 12px/1.2 Barlow,system-ui,sans-serif;color:#fff;background:rgba(10,14,20,.6);padding:2px 7px;border-radius:9px;white-space:nowrap';
          labels.appendChild(c.label);
        }
        const p = o.pose;
        c.name = o.name; c.pose = p; c.status = o.status;
        if (!c.handle || !p) { if (c.handle) A.drawCar(c.handle, null); if (c.label) c.label.hidden = true; continue; }
        // (free roam: how much of it to draw, by how far away it is; fading in and out at the edge of what's seen)
        const distM = mine ? Math.hypot(p.pos[0] - mine.pos[0], p.pos[2] - mine.pos[2]) : 0, detail = lod?.(o, distM) ?? 'full';
        if (detail === 'marker') { A.drawCar(c.handle, null); c.label.hidden = true; if (c.sound) { c.sound.dispose(); c.sound = null; } continue; }
        if (detail !== 'full' && c.sound) { c.sound.dispose(); c.sound = null; }
        const alpha = o.alpha ?? 1;
        if (A.setOpacity && Math.abs((c.alpha ?? 1) - alpha) > 0.02) { c.alpha = alpha; A.setOpacity(c.handle, alpha); }
        // (its sound: once the game's audio has started — browsers only allow sound after a key press)
        if (!c.sound && detail === 'full') { const s = o.look?.sound, au = A.audio(); if (au && s?.file) c.sound = A.carSound(au, { sound: s.file, idleRpm: s.idle, redlineRpm: s.redline }); }
        // its wheels: turned by their own speed (the angle isn't sent: only how fast), riding their suspension
        const wheels = (p.wheels ?? []).map((w, i) => { c.spin[i] = ((c.spin[i] ?? 0) + w.omega * dt) % (Math.PI * 2); return { ...w, spin: c.spin[i] }; });
        const simPos = A.toSim(p.pos);
        A.drawCar(c.handle, { ...p, pos: simPos }, wheels);
        // (the tests: what was drawn, frame by frame — globalThis.__krMpTrace = {} turns it on)
        const tr = globalThis.__krMpTrace;
        if (tr) { const list = tr[o.id] ??= []; list.push({ at: performance.now(), dt, pos: p.pos, vel: p.vel, rot: p.rot, ang: p.ang, shownAt: p.shownAt, flags: p.flags, rpm: p.rpm, spin: wheels[0]?.spin ?? null, extrapolating: p.extrapolating, correctionCm: p.correctionCm, teleported: p.teleported, sound: !!c.sound, dents: c.dentCount ?? 0 }); if (list.length > 6000) list.splice(0, 1000); }
        // its damage (rebuilt only when something new came in)
        const dk = `${o.events?.length ?? 0}|${o.look?.damage ? 1 : 0}`;
        if (dk !== c.damageKey) { c.damageKey = dk; const v = damageView(o.look, o.events, A.rules); c.dentCount = v.shell.dents.length + Object.values(v.parts).reduce((a, x) => a + x.length, 0); A.setDamage(c.handle, v); }
        // its sound, where it is
        if (c.sound) { const slip = Math.max(0, ...wheels.filter(w => w.grounded).map(w => w.slip)); c.sound.update({ rpm: p.rpm, throttle: p.throttle, slip, speed: Math.hypot(...p.vel) }, A.listener(simPos), dt); }
        // its name over it (and "reconnecting…" while its player is away)
        const at = A.screen([simPos[0], simPos[1] + 1.7, simPos[2]]);
        c.onScreen = !!A.screen(simPos);
        const named = nameOpacity ? nameOpacity(o, distM) * alpha : 1;
        c.label.hidden = !at || named <= 0.02;
        const paused = o.status === 'away' ? ' · reconnecting…' : p.flags & LIGHT.AWAY ? ' · paused (window in the background)' : '';
        if (at && named > 0.02) { c.label.style.left = `${at.x}px`; c.label.style.top = `${at.y}px`; c.label.textContent = `${label?.(o) ?? o.name ?? 'Player'}${paused}`; c.label.style.opacity = String((paused ? 0.6 : 1) * named); }
      }
      for (const id of [...cars.keys()]) if (!seen.has(id)) drop(id);
      // (joined on top of someone — every new car arrives at the same place: the later one moves beside them)
      if (spread && !cleared && landedAt != null) {
        if (nowMs - landedAt > 20000) cleared = true;
        else if (api.others().some(x => x.distM != null && x.distM < ON_TOP_M && x.netId != null && x.netId < N.id)) { cleared = true; api.toNearest(); }
      }
      overlayAt -= dt;
      if (overlayAt <= 0) { overlayAt = 0.25; overlay.update(); }
    },
    // your car's crash: its outcome (garage/session.js crash) packed for the others (the Phase 4 compact form)
    crash(result, build) {
      const crash = packCrash({ result, changes: result.attach ?? [], mech: result.mechanical ?? { damage: {} } }, build);
      if (Object.keys(crash.hits).length || crash.broken?.length) N.sendEvent({ kind: 'damage', crash });
    },
    part(socket, to) { N.sendEvent({ kind: 'parts', socket, to }); },
    // each other player as this window sees it: how far, whether its car is drawn (and if not, why), on screen, and
    // how long since its last state arrived
    others() {
      const out = [];
      // (N.players never holds this player; free roam's are keyed by ids of their own: netId is the room's — play/roam.js)
      for (const pl of N.players.values()) {
        const c = cars.get(pl.id), p = c?.pose, ageMs = Number.isFinite(pl.lastStateAt) ? performance.now() - pl.lastStateAt : null;
        const distM = p && mine ? Math.hypot(p.pos[0] - mine.pos[0], p.pos[2] - mine.pos[2]) : null;
        const shown = !!(c?.handle && p && A.shown?.(c.handle));
        const why = shown ? (c.onScreen ? '' : 'off screen') : pl.status === 'away' ? 'reconnecting' : !pl.base ? 'no state yet' : ageMs > 3000 ? 'no update for 3 s (out of range?)' : !c ? 'not seen yet' : c.loading ? 'loading its model' : 'not in the scene';
        out.push({ id: pl.id, netId: pl.netId !== undefined ? pl.netId : pl.id, name: pl.name ?? `#${pl.id}`, distM, drawn: shown, onScreen: !!c?.onScreen, why, ageMs, paused: !!(p && p.flags & LIGHT.AWAY), status: pl.status });
      }
      return out.sort((a, b) => (a.distM ?? 1e9) - (b.distM ?? 1e9));
    },
    // your car beside the nearest other player's (development: F9), facing the way it faces
    toNearest() {
      const o = api.others().find(x => x.distM != null), c = o && cars.get(o.id), p = c?.pose;
      if (!p) return 'Nobody to go to yet (no other car has sent where it is).';
      const q = p.rot, fx = 2 * (q[0] * q[2] + q[3] * q[1]), fz = 1 - 2 * (q[0] * q[0] + q[1] * q[1]), n = Math.hypot(fx, fz) || 1;
      const at = [p.pos[0] - fz / n * BESIDE_M, p.pos[1], p.pos[2] + fx / n * BESIDE_M];
      A.place(at, Math.atan2(fx, fz) * 180 / Math.PI);
      return `Beside ${o.name}`;
    },
    reset() { N.sendEvent({ kind: 'reset' }); },
    repair() { N.sendEvent({ kind: 'repair' }); },
    setLook(l) { N.setLook(l, []); },
    // (a car as drawn now: the spectator's camera follows it)
    car(id) { const c = cars.get(id); return c ? { pose: c.pose ?? null, handle: c.handle ?? null, name: c.name } : null; },
    leave() { removeEventListener('pagehide', bye); for (const id of [...cars.keys()]) drop(id); labels.remove(); banner.remove(); beat?.terminate(); overlay.dispose(); offs.forEach(f => f()); return ownNet ? Promise.race([Promise.resolve(N.leave()).catch(() => {}), new Promise(r => setTimeout(r, 2000))]) : Promise.resolve(); },   // (a room already gone never answers a leave)
  };
  return api;
}

// Your car's state as multiplayer sends it, from the physics' snapshot (the state at the last physics step; age: how
// far the drawn frame is past it, ms)
export function localState({ snapshot: b, angvel, tick, toWorld, headlights = false, ageMs = 0 }) {
  const gear = b.engine?.gear === 'R' ? -1 : b.engine?.gear === 'N' ? 0 : Number(b.engine?.gear) || 0;
  return {
    tick, pos: toWorld(b.position), rot: [b.rotation.x, b.rotation.y, b.rotation.z, b.rotation.w], vel: b.velocity, ang: angvel,
    steer: Math.max(-1, Math.min(1, b.steer ?? 0)), throttle: b.throttle ?? 0, brake: b.brake ?? 0, gear, rpm: b.engine?.rpm ?? 0,
    wheels: (b.wheels ?? []).map(w => ({ omega: w.off ? 0 : w.omega ?? 0, length: w.length ?? 0, slip: w.combinedSlip ?? 0, grounded: !!w.grounded })),
    flags: (b.brakeLights ? LIGHT.BRAKE : 0) | (headlights ? LIGHT.HEAD : 0) | (gear < 0 ? LIGHT.REVERSE : 0) | (b.held ? LIGHT.HANDBRAKE : 0),
    ageMs,
  };
}
