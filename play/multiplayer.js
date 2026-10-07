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
//     setDamage(handle, view), setPart(handle, socket, state), listener(posSim) → [x, y, z] in the camera's frame,
//     audio() → the game's audio or null, carSound(audio, engine) (testtrack/audio.js remoteCarSound),
//     screen(posSim) → { x, y } on screen or null, rules (data/damage.json) }
//
//   const M = await joinMultiplayer({ account, world, look, adapter, netsim, serverNetsim, debug })
//   M.frame(dt, local)          every frame: local() → your car's state (codec.js) or null
//   M.crash(outcome, build) · M.part(socket, state) · M.reset() · M.repair() · M.setLook(look)
//   M.status · M.message · M.overlay.toggle() · M.leave()

import { NET } from '../net/settings.js';
import { createNetClient } from '../net/client.js';
import { createColyseusTransport } from '../net/transport.js';
import { parseConditions } from '../net/netsim.js';
import { LIGHT } from '../net/protocol.js';
import { createNetOverlay } from '../net/overlay.js';
import { packCrash, packDents, unpackDents, dentsOf } from '../garage/damageLog.js';

// ?mp (or ?mp=<room name>) turns it on; ?netsim=150,30,0.05[,datagram] and ?servernetsim=… add a bad network on
// this side and on the server's; ?netdebug shows the overlay from the start
export function multiplayerOptions(loc = globalThis.location) {
  const q = new URLSearchParams(loc?.search ?? '');
  if (!q.has('mp')) return null;
  return { room: q.get('mp') || null, netsim: parseConditions(q.get('netsim')), serverNetsim: q.get('servernetsim') || null, debug: q.has('netdebug') };
}

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

export async function joinMultiplayer({ account, world, look, adapter: A, netsim = null, serverNetsim = null, debug = false, settings = NET }) {
  const Colyseus = await import('../net/vendor/colyseus.js');
  let endpoint = null;
  const N = createNetClient({
    transport: createColyseusTransport(Colyseus), world, look, netsim, serverNetsim, settings,
    getTicket: async () => {
      const t = await account.api.post('/rt/ticket', {});
      endpoint = rtEndpoint(globalThis.KR_SITE, t.url);
      return { ticket: t.ticket, url: endpoint };
    },
  });
  await N.connect();
  const cars = new Map();          // id → { handle, loading, lookKey, spin: [], sound, label, damageKey, parts }
  const overlay = createNetOverlay(N, { shown: debug });
  let overlayAt = 0;
  const labels = document.createElement('div');
  labels.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:55';
  document.body.appendChild(labels);

  const drop = id => {
    const c = cars.get(id);
    if (!c) return;
    c.dropped = true;
    if (c.handle) A.dropCar(c.handle);
    c.sound?.dispose(); c.label?.remove();
    cars.delete(id);
  };
  N.on('roster', r => { if (r.leave) drop(r.leave.id); });
  N.on('event', e => {
    const c = cars.get(e.from);
    if (!c?.handle) return;
    if (e.kind === 'parts') A.setPart(c.handle, e.socket, e.to);
    if (e.kind === 'repair') { c.damageKey = null; for (const s of c.partsOff ?? []) A.setPart(c.handle, s, 'attached'); c.partsOff = new Set(); }
    if (e.kind === 'parts') (c.partsOff ??= new Set()).add(e.socket);
  });

  const api = {
    net: N, overlay,
    get status() { return N.status; },
    get message() { return N.message; },
    frame(dt, local) {
      N.update(dt, local);
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
            const s = o.look?.sound, au = A.audio();
            if (au && s?.file) mine.sound = A.carSound(au, { sound: s.file, idleRpm: s.idle, redlineRpm: s.redline });
          }, err => console.warn(`Another player's car didn't load: ${err.message ?? err}`));
          c.label = document.createElement('div');
          c.label.style.cssText = 'position:absolute;transform:translate(-50%,-100%);font:600 12px/1.2 Barlow,system-ui,sans-serif;color:#fff;background:rgba(10,14,20,.6);padding:2px 7px;border-radius:9px;white-space:nowrap';
          labels.appendChild(c.label);
        }
        const p = o.pose;
        if (!c.handle || !p) { if (c.handle) A.drawCar(c.handle, null); if (c.label) c.label.hidden = true; continue; }
        // its wheels: turned by their own speed (the angle isn't sent: only how fast), riding their suspension
        const wheels = (p.wheels ?? []).map((w, i) => { c.spin[i] = ((c.spin[i] ?? 0) + w.omega * dt) % (Math.PI * 2); return { ...w, spin: c.spin[i] }; });
        const simPos = A.toSim(p.pos);
        A.drawCar(c.handle, { ...p, pos: simPos }, wheels);
        // its damage (rebuilt only when something new came in)
        const dk = `${o.events?.length ?? 0}|${o.look?.damage ? 1 : 0}`;
        if (dk !== c.damageKey) { c.damageKey = dk; A.setDamage(c.handle, damageView(o.look, o.events, A.rules)); }
        // its sound, where it is
        if (c.sound) { const slip = Math.max(0, ...wheels.filter(w => w.grounded).map(w => w.slip)); c.sound.update({ rpm: p.rpm, throttle: p.throttle, slip, speed: Math.hypot(...p.vel) }, A.listener(simPos), dt); }
        // its name over it (and "reconnecting…" while its player is away)
        const at = A.screen([simPos[0], simPos[1] + 1.7, simPos[2]]);
        c.label.hidden = !at;
        if (at) { c.label.style.left = `${at.x}px`; c.label.style.top = `${at.y}px`; c.label.textContent = `${o.name ?? 'Player'}${o.status === 'away' ? ' · reconnecting…' : ''}`; c.label.style.opacity = o.status === 'away' ? '0.6' : '1'; }
      }
      for (const id of [...cars.keys()]) if (!seen.has(id)) drop(id);
      overlayAt -= dt;
      if (overlayAt <= 0) { overlayAt = 0.25; overlay.update(); }
    },
    // your car's crash: its outcome (garage/session.js crash) packed for the others (the Phase 4 compact form)
    crash(result, build) {
      const crash = packCrash({ result, changes: result.attach ?? [], mech: result.mechanical ?? { damage: {} } }, build);
      if (Object.keys(crash.hits).length || crash.broken?.length) N.sendEvent({ kind: 'damage', crash });
    },
    part(socket, to) { N.sendEvent({ kind: 'parts', socket, to }); },
    reset() { N.sendEvent({ kind: 'reset' }); },
    repair() { N.sendEvent({ kind: 'repair' }); },
    setLook(l) { N.setLook(l, []); },
    leave() { for (const id of [...cars.keys()]) drop(id); labels.remove(); overlay.dispose(); return N.leave(); },
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
