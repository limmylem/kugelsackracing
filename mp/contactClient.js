// Car-to-car contact as the player's game does it (Phase 7 Step 3; docs/CONTACT.md). The game and the bots alike: the
// player's own car is simulated here (physics/sim.js), every other car in the race is a PROXY in this world — where
// it's predicted to be now (net/remote.js present) — and the contact between them is mp/contact.js's: a capped push
// on this car only, reported to the race server; the agreed result comes back, and the difference between it and what
// was pushed is blended in. Ghosting (the server's say, and a fade back only when clear), the effects, the damage
// (this car's, from the agreed impact) too; every push recorded with the run (mp/runRecord.js) for the verifier.
//
//   const C = createContactClient({ sim, net, send, cfg, mine, others, roomAt, mode, myUid, onImpact, onEffect })
//     sim: physics/sim.js · net: the race's net/client.js · send(msg): to the race room (mp/client.js S.send)
//     cfg: data/multiplayer.json contact · mine() → { box, mass } (this car's body box and mass)
//     others() → Map uid → { id (the net player's id), box, mass, name }   roomAt(simT) → room ms at that physics time
//     mode() → 'full' | 'reduced' | 'ghost'   onImpact(impact, { scale, result }) → this car's damage (Phase 3)
//     onEffect({ point, strength, kind, local, uid, other }) → sparks and sounds (once each contact, on every client)
//   C.frame(dt)        every frame: each car's nearness (drawn nearer the present when close), proxies made and removed
//   C.message(m)       the race room's 'contact' / 'contact-rejected' / 'ghosts' messages
//   recorder: mp/runRecord.js (the run's record for the verifier): every push goes through it, and is recorded
//   C.opacity(uid)     how solid a car is drawn (a ghost see-through; fading back once clear) — this car's: myUid
//   C.debug            what the contact overlay shows      C.dispose()

import { footprintOf, overlap, createContactTracker, toCarFrame } from './contact.js';

const f32 = Math.fround;
const quatArr = q => [q.x, q.y, q.z, q.w];
const near01 = (gap, N) => gap <= N.nearGapM ? 1 : gap >= N.farGapM ? 0 : 1 - (gap - N.nearGapM) / (N.farGapM - N.nearGapM);

export function createContactClient({ sim, net, send, cfg, mine, others, roomAt, mode = () => 'reduced', myUid, recorder = null, onImpact = () => {}, onEffect = () => {} }) {
  const N = cfg.near, tracker = createContactTracker(cfg);
  const near = new Map();          // uid → nearness (0..1)
  const ghosts = new Map();        // uid → { ghost, reasons } (the server's)
  const solid = new Map();         // uid → whether it touches (the ghost lifted and nothing overlapping it)
  const fade = new Map();          // uid → drawn opacity
  const applied = new Map();       // episode id → { j: [x, z], other, reported, cid }
  const fixes = [];                // corrections being blended in: { cid, perStep: [x, z], point, left }
  const played = new Set();        // episodes whose effect played here already
  const debug = { proxies: new Map(), contacts: [], agreed: [] };
  let reportTimes = [];

  const myCar = () => sim.vehicle;
  const myFootprint = () => {
    const b = myCar().body, p = b.translation(), q = b.rotation(), l = b.linvel(), a = b.angvel(), m = mine();
    return footprintOf({ pos: [p.x, p.y, p.z], rot: quatArr(q), vel: [l.x, l.y, l.z], ang: [a.x, a.y, a.z] }, m.box, { mass: m.mass });
  };
  // A push on this car: rounded to 32-bit floats first (the verifier applies exactly these), horizontal, at the centre
  // of mass's height (no roll, no pitch) — recorded with the run (mp/runRecord.js) when there's a recorder
  function push(j, point, ev) {
    if (recorder) return recorder.push(j, point, ev);
    const b = myCar().body, jx = f32(j[0]), jz = f32(j[1]), px = f32(point[0]), pz = f32(point[1]);
    if (!Number.isFinite(jx) || !Number.isFinite(jz)) return null;
    b.applyImpulseAtPoint({ x: jx, y: 0, z: jz }, { x: px, y: b.worldCom().y, z: pz }, true);
    return [jx, jz];
  }
  const ghostOf = uid => !!ghosts.get(uid)?.ghost;
  const touchable = uid => mode() !== 'ghost' && !ghostOf(uid) && !ghostOf(myUid) && solid.get(uid) !== false && solid.get(myUid) !== false;

  // ---------- every physics step: each proxy where its car is now, the contact, the corrections ----------
  const stop = sim.beforeWorldStep((s, step, dt) => {
    const t = roomAt(s.time) / 1000, me = myFootprint(), O = others();
    for (const [uid, o] of O) {
      if (!(near.get(uid) > 0) && !tracker.episodes.has(uid)) continue;
      const pr = net.present(o.id, N.maxPredictMs, t * 1000);
      if (!pr) continue;
      s.moveProxy(uid, { position: pr.pos, rotation: { x: pr.rot[0], y: pr.rot[1], z: pr.rot[2], w: pr.rot[3] } });
      const other = footprintOf(pr, o.box, { mass: o.mass });
      debug.proxies.set(uid, { x: other.x, z: other.z, yaw: other.yaw, hl: other.hl, hw: other.hw, aheadMs: pr.aheadMs, solid: touchable(uid) });
      const r = tracker.step(me, other, { dt, t, otherId: uid, ghost: !touchable(uid), stampT: pr.stampT / 1000 });
      if (!r) continue;
      const a = applied.get(r.episode) ?? { j: [0, 0], other: uid, reported: false, cid: null, at: t };
      const got = push(r.impulse, r.point, { c: 'L', ep: r.episode, o: uid, at: Math.round(t * 1000), f: [r.used.x, r.used.z, r.used.yaw, r.used.vx, r.used.vz, r.used.w].map(f32) });
      if (got) a.j = [a.j[0] + got[0], a.j[1] + got[1]];
      applied.set(r.episode, a);
      if (r.start) {
        debug.contacts.push({ t, point: r.point, kind: r.kind, uid, ep: r.episode, predictMs: pr.aheadMs }); if (debug.contacts.length > 40) debug.contacts.shift();
        // (this player's own sparks and sound at once: the agreed copy of it is skipped)
        played.add(r.episode);
        const ep = tracker.episodes.get(uid);
        onEffect({ point: r.point, strength: ep ? Math.min(ep.closing, mine().mass ? ep.J / mine().mass : 0) : 0, kind: r.kind, local: true, uid: myUid, other: uid });
      }
    }
    // the agreed results being blended in
    for (let i = fixes.length - 1; i >= 0; i--) {
      const x = fixes[i];
      push(x.perStep, [me.x, me.z], { c: 'F', cid: x.cid });
      if (--x.left <= 0) fixes.splice(i, 1);
    }
    // the reports due (each contact's, once, a moment after it began)
    for (const ep of tracker.reports(t)) report(ep, t);
  });

  function report(ep, t) {
    reportTimes = reportTimes.filter(x => t - x < 1); if (reportTimes.length >= cfg.agree.maxReportsPerSec) return;
    reportTimes.push(t);
    debug.reports = (debug.reports ?? 0) + 1;
    const a = applied.get(ep.id) ?? { j: [0, 0] };
    a.reported = true;
    const r3 = x => Math.round(x * 1000) / 1000;
    send({ t: 'contact-report', other: ep.other, ep: ep.id, at: Math.round(ep.start * 1000), kind: ep.kind, closing: r3(ep.closing), n: ep.n.map(r3), point: ep.point.map(r3),
      me: Object.fromEntries(Object.entries(ep.me).map(([k, v]) => [k, r3(v)])), them: Object.fromEntries(Object.entries(ep.them).map(([k, v]) => [k, r3(v)])),
      J: a.j.map(r3), predictMs: Math.round(debug.proxies.get(ep.other)?.aheadMs ?? 0), track: trackOf(ep.other, t) });
  }

  // ---------- the perspective, for the contact replay: this car and the other's proxy, 20 a second, the last 1.5 s ----------
  const tracks = new Map();
  function noteTrack(uid, t, me, other) {
    const l = tracks.get(uid) ?? []; if (l.length && t - l.at(-1).t < 0.05) return;
    l.push({ t: Math.round(t * 1000), me: [me.x, me.z, me.yaw].map(x => Math.round(x * 100) / 100), them: [other.x, other.z, other.yaw].map(x => Math.round(x * 100) / 100) });
    while (l.length && t - l[0].t / 1000 > 1.5) l.shift();
    tracks.set(uid, l);
  }
  const trackOf = (uid, t) => (tracks.get(uid) ?? []).filter(x => t - x.t / 1000 <= 1.5);

  // ---------- every frame: nearness, proxies, the fade ----------
  function frame(dt) {
    const me = myFootprint(), O = others(), room = net.roomNow();
    const fps = new Map();
    for (const [uid, o] of O) {
      const pr = net.present(o.id, N.maxPredictMs, room);
      if (!pr) { if (near.has(uid)) { near.delete(uid); sim.removeProxy(uid); net.setNear(o.id, 0); } continue; }
      const f = footprintOf(pr, o.box, { mass: o.mass }), gap = Math.max(0, overlap(me, f).gap);
      fps.set(uid, f);
      const want = near01(gap, N), was = near.get(uid) ?? 0, n = was + Math.max(-N.rampPerSec * dt, Math.min(N.rampPerSec * dt, want - was));
      near.set(uid, n);
      net.setNear(o.id, n, N.maxPredictMs);
      if (gap < N.farGapM) { if (!sim.proxies.has(uid)) sim.addProxy(uid, o.box); noteTrack(uid, room / 1000, me, f); }
      else if (sim.proxies.has(uid)) sim.removeProxy(uid);
    }
    // solid again only when the server has lifted the ghost and nothing overlaps it (here: as this game sees the cars)
    const all = [[myUid, me], ...fps];
    for (const [uid, f] of all) {
      const ghost = mode() === 'ghost' || ghostOf(uid);
      const clear = all.every(([u, g]) => u === uid || !(overlap(f, g).depth > 0));
      if (ghost) solid.set(uid, false); else if (clear) solid.set(uid, true);
      const target = solid.get(uid) === false ? cfg.ghost.opacity : 1, cur = fade.get(uid) ?? target, rate = (1 - cfg.ghost.opacity) / Math.max(0.01, cfg.ghost.fadeSec);
      fade.set(uid, cur + Math.max(-rate * dt, Math.min(rate * dt, target - cur)));
    }
  }

  // ---------- the race room's messages ----------
  function message(m) {
    if (m.t === 'ghosts') { for (const [uid, g] of Object.entries(m.list ?? {})) ghosts.set(uid, g); return; }
    if (m.t === 'contact-rejected' && m.ep != null) {
      // (this game's report of a contact the server didn't agree: its push undone, blended)
      const a = applied.get(m.ep); if (a && !a.cid) { a.cid = `x${m.ep}`; correct(a.cid, [-a.j[0], -a.j[1]]); }
      debug.agreed.push({ t: Date.now(), ep: m.ep, rejected: true, why: m.why }); if (debug.agreed.length > 20) debug.agreed.shift();
      return;
    }
    if (m.t !== 'contact' || !m.result) return;
    const res = m.result, mineRes = res.cars?.[myUid];
    debug.agreed.push({ t: Date.now(), cid: m.cid, kind: res.kind, closing: res.closing, J: res.J, gentler: res.gentler, blame: m.blame ?? null, mine: mineRes ? { agreed: mineRes.impulse, applied: applied.get(m.eps?.[myUid])?.j ?? null } : null });
    if (debug.agreed.length > 20) debug.agreed.shift();
    if (!mineRes) {
      // someone else's contact: its sparks and sounds here too
      onEffect({ point: res.cars[Object.keys(res.cars)[0]].point, strength: res.closing / 2, kind: res.kind, local: false, uid: Object.keys(res.cars)[0], other: Object.keys(res.cars)[1] });
      return;
    }
    // this car's: what was pushed for it (its episode, if this game saw it), the rest blended in
    let epId = m.eps?.[myUid] ?? null;
    if (epId == null) for (const [id, a] of applied) if (!a.cid && a.other === m.other?.[myUid] && Math.abs(a.at * 1000 - res.t) < cfg.agree.pairWindowMs) epId = id;
    const a = epId != null ? applied.get(epId) : null;
    if (a) { a.cid = m.cid; recorder?.mark('M', { ep: epId, cid: m.cid }); }
    const got = a?.j ?? [0, 0];
    correct(m.cid, [mineRes.impulse[0] - got[0], mineRes.impulse[1] - got[1]]);
    if (epId == null || !played.has(epId)) onEffect({ point: mineRes.point, strength: mineRes.strength, kind: res.kind, local: false, uid: myUid, other: m.other?.[myUid] });
    // the damage: this car's, from the agreed impact (scaled by the mode), the same for everyone (Step 1 sends it on)
    if (res.kind === 'hit' && mineRes.strength > 0 && mineRes.scale > 0) onImpact(impactOf(mineRes, res), { scale: mineRes.scale, result: res });
  }
  function correct(cid, j) {
    const steps = Math.max(1, Math.round(cfg.agree.blendSec / sim.dt));
    if (Math.hypot(j[0], j[1]) < 1e-3) return;
    fixes.push({ cid, perStep: [j[0] / steps, j[1] / steps], left: steps });
  }
  // the agreed hit as Phase 3's damage wants it: in this car's frame (x left, z forward), the normal towards the other car
  function impactOf(r, res) {
    const me = myFootprint(), b = mine().box, [px, pz] = toCarFrame(me, r.point), n = r.n;
    const nx = n[0] * Math.cos(me.yaw) - n[1] * Math.sin(me.yaw), nz = n[0] * Math.sin(me.yaw) + n[1] * Math.cos(me.yaw);
    const cy = b.centre[1], hy = b.halfExtents[1];
    const clampX = x => Math.max(-b.halfExtents[0], Math.min(b.halfExtents[0], x)), clampZ = z => Math.max(b.centre[2] - b.halfExtents[2], Math.min(b.centre[2] + b.halfExtents[2], z));
    const point = [clampX(px), cy - hy * 0.3, clampZ(pz)];
    return { time: res.t / 1000, point, normal: [nx, 0, nz], yRange: [cy - hy * 0.8, cy + hy * 0.2], extent: { min: [point[0] - 0.25, cy - hy * 0.8, point[2] - 0.25], max: [point[0] + 0.25, cy + hy * 0.2, point[2] + 0.25] },
      closing: r.closing, impulse: Math.hypot(...r.impulse), strength: r.strength, material: 'car', other: 'car', otherMass: res.otherMass ?? mine().mass };
  }

  return {
    frame, message, debug, tracker,
    opacity: uid => fade.get(uid) ?? 1,
    nearness: uid => near.get(uid) ?? 0,
    solid: uid => solid.get(uid) !== false,
    dispose() { stop(); for (const uid of [...sim.proxies.keys()]) sim.removeProxy(uid); for (const [, o] of others()) net.setNear(o.id, 0); },
  };
}
