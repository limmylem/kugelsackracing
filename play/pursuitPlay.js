// A police pursuit in the world (docs/PURSUIT.md): the police cars — real cars in the same physics as yours
// (physics/sim.js addCar, built from the parts system, their own crash damage: garage/carDamage.js, as NPC racers' are)
// — driven by pursuit/police.js on what the director (pursuit/director.js) decides each physics tick; who can see whom
// (a ray against the ground and the buildings, from eye height); new units on a road behind you, out of sight;
// roadblocks at a junction ahead; spike strips (a tyre over one is punctured: physics/mechanical.js); the light bars,
// the sirens (audio/siren.js: Doppler, louder as they close in); and the debug overlay (F4, or ?pursuitDebug): every
// unit's state and why, the heat, the sight lines, the paths, the search area and the cooldown. The session
// (quest/types/pursuit.js) is handed the director's status every tick (Q.state.pursuitNow).
//
//   const P = createPursuit({ THREE, RAPIER, w: { sim, scene }, frame: { toWorld, toSim }, cfg (data/pursuit.json), quest,
//                             course, network, session: () => Q, db, game, audio: () => A })
//     game: { buildPolice({ rating, seed }) → Promise<{ build, spec, sockets, boxes, rig }>, showPolice(carId, n) → Promise<vis>,
//             setDamage(carId, view3d), impact(carId, impact, result), ready() → bool, health() → { drivable, condition },
//             rating (the player's car's) }
//   P.event(e)   the session's events (place: the first unit behind you; go: everyone away)
//   P.frame(dt, { listener })   lights, sirens, the debug overlay    P.status   P.mapView() → { units, search }
//   P.resetPoint() → a road point by the car (R)   P.drain() → events for the HUD   P.dispose()

import { createDirector } from '../pursuit/director.js';
import { createPoliceDriver, policeCaps } from '../pursuit/police.js';
import { createPursuitRoads } from '../pursuit/paths.js';
import { at as lineAt } from '../route/geometry.js';
import { headingOf } from '../route/grid.js';
import { carCaps } from '../route/racingLine.js';
import { CarDamage } from '../garage/carDamage.js';
import { drivability } from '../garage/repair.js';
import { assignDeep } from '../race/race.js';
import { useWheelAids, groundHeight } from '../physics/ai.js';
import { rotate } from '../physics/math.js';
import { createSiren } from '../audio/siren.js';

const MODE_COLOUR = { patrol: '#9aa4b2', alerted: '#ffbd4a', pursue: '#ff5a5f', intercept: '#e05cff', ram: '#ff2d2d', pit: '#ff8c2d', box: '#ffd24a', block: '#4fc3f7', search: '#7ee08a', out: '#555', leave: '#888' };

export function createPursuit({ THREE, RAPIER, w, frame, cfg, quest, course, network, session, db, game, audio = () => null, rng = Math.random, debug = false }) {
  const sim = w.sim, P = quest.params ?? {}, roads = createPursuitRoads(network);
  const D = createDirector({ cfg, rng, mission: { startHeat: P.startHeat, maxHeat: P.maxHeat, maxUnits: P.maxUnits, totalUnits: P.totalUnits, objective: P.objective, timerEnds: P.timerEnds || null, roadblocks: P.roadblocks !== false, spikes: P.spikes !== false } });
  const units = new Map();          // carId → { id, car, driver, damage, build, spec, kind, condition, drivable, dirty, vis, bar, siren }
  const strips = [], events = [];
  let started = false, over = false, disposed = false, seedN = 0, startSpot = null, startSpeed = 0, flash = 0, lastHits = [];
  // (a cinematic intro, play/cinematic.js: the police parked by the road, pulling out, keeping their gap — cineT its clock)
  let cine = null, cineT = null;
  const emit = e => events.push(e);

  // ---------- where things are ----------
  const simPos = b => b.translation();
  const worldOf = b => { const p = b.translation(); const [x, z] = frame.toWorld(p.x, p.z); return { x, z, y: p.y }; };
  function carState(v) {
    const b = v.body, p = b.translation(), l = b.linvel(), q = b.rotation(), fw = rotate(q, [0, 0, 1]), m = Math.hypot(fw[0], fw[2]) || 1;
    const [x, z] = frame.toWorld(p.x, p.z);
    return { x, z, y: p.y, vx: l.x, vz: l.z, speed: Math.hypot(l.x, l.z), heading: Math.atan2(fw[0] / m, fw[2] / m), fx: fw[0] / m, fz: fw[2] / m };
  }
  const world = () => sim.vehicle.world;
  // what blocks the police's view: the ground (the terrain, a road on a bridge) and buildings — not cars, not a fence, a
  // barrier or a tree (seen past or over); a generated track's walls and ground
  const blocksSight = c => {
    const b = c.parent?.();
    if (b && !(b.isFixed ? b.isFixed() : !b.isDynamic?.())) return false;
    const u = c.userData ?? {};
    return u.kind ? u.kind === 'building' || u.kind === 'terrain' : u.material === 'ground' || u.material === 'concrete';
  };
  // can a unit see the player: a ray from its eye to the player's, against those
  function clearBetween(a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz);
    if (!(L > 3)) return true;
    try { return !world().castRay(new RAPIER.Ray({ x: a[0], y: a[1], z: a[2] }, { x: dx / L, y: dy / L, z: dz / L }), L - 2, true, undefined, undefined, undefined, undefined, blocksSight); } catch { return true; }
  }
  // can a unit drive straight at the player (off the road, cutting a corner): nothing solid at bumper height on the way —
  // a barrier, a tree, a wall, a building — on either side of the car
  const solid = c => { const b = c.parent?.(); if (b && !(b.isFixed ? b.isFixed() : !b.isDynamic?.())) return false; const u = c.userData ?? {}; return u.kind ? u.kind !== 'terrain' : u.material !== 'ground'; };
  function driveClear(u) {
    const a = simPos(u.car.vehicle.body), b = simPos(sim.vehicle.body), dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
    if (L < 6) return true;
    const sx = -dz / L * 0.9, sz = dx / L * 0.9;
    for (const k of [-1, 1]) {
      const from = { x: a.x + sx * k, y: a.y + 0.55, z: a.z + sz * k }, to = { x: b.x + sx * k, y: b.y + 0.55, z: b.z + sz * k }, ex = to.x - from.x, ey = to.y - from.y, ez = to.z - from.z, M = Math.hypot(ex, ey, ez);
      try { if (world().castRay(new RAPIER.Ray(from, { x: ex / M, y: ey / M, z: ez / M }), M - 3, true, undefined, undefined, undefined, undefined, solid)) return false; } catch { return true; }
    }
    return true;
  }
  // a car's feelers: how far it is to something solid ahead of it, straight on and 25° either side (bumper height, 14 m)
  const FEEL = 14, SIDE = 25 * Math.PI / 180;
  function feel(v) {
    const b = v.body, p = b.translation(), f = rotate(b.rotation(), [0, 0, 1]), m = Math.hypot(f[0], f[2]) || 1, fx = f[0] / m, fz = f[2] / m;
    const ray = a => { const c = Math.cos(a), s2 = Math.sin(a), dx = fx * c + fz * s2, dz = -fx * s2 + fz * c; try { const h = world().castRay(new RAPIER.Ray({ x: p.x + fx * 2.2, y: p.y + 0.55, z: p.z + fz * 2.2 }, { x: dx, y: 0, z: dz }), FEEL, true, undefined, undefined, undefined, undefined, solid); return h ? h.timeOfImpact : FEEL; } catch { return FEEL; } };
    // (left: turning the forward a quarter left is +x for +z — physics/ai.js; + angle here turns it that way)
    return { centre: ray(0), left: ray(SIDE), right: ray(-SIDE) };
  }
  function sees(u) {
    const a = simPos(u.car.vehicle.body), b = simPos(sim.vehicle.body), e = cfg.police.eyeHeight;
    return clearBetween([a.x, a.y + e, a.z], [b.x, b.y + e, b.z]);
  }
  // a place on the ground (sim y), for putting things down
  const groundAt = (x, z) => { const [sx, sz] = frame.toSim(x, z); return groundHeight(sim.vehicle, sx, sz) ?? simPos(sim.vehicle.body).y - 0.5; };
  const clearOfCars = (x, z, r = 9) => { const [sx, sz] = frame.toSim(x, z); return [sim.vehicle, ...sim.cars.map(c => c.vehicle)].every(v => { const p = v.body.translation(); return Math.hypot(p.x - sx, p.z - sz) > r; }); };

  // ---------- the units ----------
  async function addUnit({ x, z, heading, speed = 0, rating, kind = 'chase', target = 0, joinAt = null }) {
    let n;
    try { n = await game.buildPolice({ rating: (game.rating ?? 400) * (rating ?? 1), seed: ++seedN }); } catch (e) { console.warn(`No police car: ${e.message}`); D.spawnFailed(); return null; }
    if (disposed || over) { D.spawnFailed(); return null; }
    const u = { kind, build: n.build, spec: n.spec, condition: 100, drivable: true, dirty: false, damagedAt: -1 };
    u.driver = createPoliceDriver({ cfg, frame, car: policeCaps(carCaps(n.build.stats)), pathTo: roads.pathTo, clear: () => u.car ? sees(u) && driveClear(u) : true, feel });
    if (kind === 'block') u.driver.order = { mode: 'block' };
    const [sx, sz] = frame.toSim(x, z);
    const id = sim.addCar({ position: [sx, 0, sz], headingDeg: heading, speed }, (v, dt) => u.driver.drive(v, dt), n.spec, n.sockets);
    u.id = id; u.car = sim.cars.find(c => c.id === id);
    useWheelAids(u.car.vehicle);
    u.car.vehicle.mechanical.enabled = true;
    const y = groundHeight(u.car.vehicle, sx, sz) ?? groundAt(x, z);
    u.car.vehicle.reset({ position: [sx, y + (speed > 1 ? 0.05 : 0.35), sz], headingDeg: heading, speed });
    u.damage = new CarDamage({ car: n.build.garage.car, build: n.build.garage.build, view: n.build.garage.view, boxes: n.boxes ?? {}, rules: db.damage, mode: 'full' });
    units.set(id, u);
    D.addUnit(id, { kind, target, joinAt });
    // its looks: the parts' car in the livery, a light bar on the roof
    game.showPolice(id, n).then(vis => { if (!vis || !units.has(id)) return; u.vis = vis; u.bar = lightBar(vis); }).catch(e => console.warn(`Police car look: ${e.message}`));
    return u;
  }
  function removeUnit(id) {
    const u = units.get(id);
    if (!u) return;
    units.delete(id); D.removeUnit(id);
    u.siren?.dispose();
    if (sim.cars.some(c => c.id === id)) sim.removeCar(id);
  }
  // its hits: its damage (the same rules as yours — a disabled unit is out), the player's hits on it (the heat)
  function takeHits(u, me, hits) {
    for (const impact of u.car.vehicle.sensor.take()) {
      const out = u.damage.hit(impact, { scale: 1 });
      game.impact?.(u.id, impact, out?.result ?? null);
      u.dirty = true;
      if (impact.other === 'car' && !over) {
        const p = carState(u.car.vehicle);
        if (Math.hypot(p.x - me.x, p.z - me.z) < 7 && impact.strength > 1) hits.push({ unit: u.id, player: 0, strength: impact.strength });
      }
    }
  }
  function applyDamage(u) {
    u.dirty = false;
    const owned = u.damage.owned, G = u.build.garage;
    for (const [pid, o] of Object.entries(owned)) Object.assign(G.state.parts[pid], { condition: o.condition, ...(o.damage ? { damage: o.damage } : {}), ...(o.attach ? { attach: o.attach } : {}) });
    const stats = G.stats();
    assignDeep(u.spec, stats.spec);
    u.car.vehicle.retune();
    const conds = [u.damage.damage.shell?.condition ?? 100, ...Object.values(owned).map(o => o.condition ?? 100)];
    u.condition = conds.reduce((a, b) => a + b, 0) / conds.length;
    const bySocket = Object.fromEntries(Object.values(owned).map(o => [o.installedOn.socket, { ...o, engine: !!db.parts[o.partId]?.engine }]));
    u.drivable = drivability(G.car, bySocket, db.damage).ok && u.condition > 20;
    game.setDamage?.(u.id, u.damage.view3d);
  }

  // where a new unit comes from: a road behind the target, out of its sight if it can be; ahead if there's no road behind
  function spawnSpot(me) {
    const C = cfg.police, tries = [];
    for (let k = 0; k < 5; k++) tries.push(-(C.spawnMin + (C.spawnMax - C.spawnMin) * k / 4));
    for (let k = 0; k < 3; k++) tries.push(C.spawnMin + (C.spawnMax - C.spawnMin) * k / 2);
    let fallback = null;
    for (const m of tries) {
      const p = roads.along(me, m);
      if (!p || p.deadEnd || !clearOfCars(p.x, p.z)) continue;
      const d = Math.hypot(p.x - me.x, p.z - me.z);
      if (d < C.spawnMin * 0.6) continue;
      // (facing the player: along(…) gives the way on from the player, behind it as ahead)
      const spot = { x: p.x, z: p.z, heading: headingOf(-p.dx, -p.dz) };
      const [sx, sz] = frame.toSim(p.x, p.z), b = simPos(sim.vehicle.body), y = groundAt(p.x, p.z);
      const hidden = !clearBetween([b.x, b.y + cfg.police.eyeHeight, b.z], [sx, y + cfg.police.eyeHeight, sz]);
      if (hidden) return spot;
      fallback ??= spot;
    }
    return fallback;
  }
  async function request(r, me) {
    if (r.kind === 'remove') { removeUnit(r.id); return; }
    if (r.kind === 'unit') {
      const spot = spawnSpot(me);
      if (!spot) { D.spawnFailed(); return; }
      await addUnit({ ...spot, speed: Math.min(me.speed * 0.8, 25), rating: r.rating, target: r.target });
      return;
    }
    if (r.kind === 'roadblock') {
      const R = cfg.roadblock, p = roads.along(me, R.aheadMin, { junction: true }), d = p ? Math.hypot(p.x - me.x, p.z - me.z) : Infinity;
      if (!p || d > R.aheadMax * 1.3 || !clearOfCars(p.x, p.z, 12)) { for (let i = 0; i < r.units; i++) D.spawnFailed(); return; }
      // (across the road, a little before the junction, nose to tail)
      const sx = p.dz, sz = -p.dx, h = headingOf(sx, sz), t = D.state.t;
      emit({ type: 'roadblock', x: p.x, z: p.z });
      for (let i = 0; i < r.units; i++) {
        const o = (i - (r.units - 1) / 2) * R.gap;
        addUnit({ x: p.x - p.dx * 6 + sx * o, z: p.z - p.dz * 6 + sz * o, heading: h, speed: 0, rating: r.rating, kind: 'block', target: r.target, joinAt: t + R.joinAfter });
      }
      return;
    }
    if (r.kind === 'spikes') {
      const S = cfg.spikes, p = roads.along(me, S.aheadMin + (S.aheadMax - S.aheadMin) * rng());
      if (!p) return;
      strips.push(stripAt(p));
      emit({ type: 'spikes', x: p.x, z: p.z });
    }
  }
  // a spike strip across the road: drawn, and checked against your wheels each tick
  function stripAt(p) {
    const S = cfg.spikes, y = groundAt(p.x, p.z), [sx, sz] = frame.toSim(p.x, p.z);
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(S.width, 0.05, 0.45), new THREE.MeshStandardMaterial({ color: '#2b2d31', metalness: 0.6, roughness: 0.5 }));
    const teeth = new THREE.Mesh(new THREE.BoxGeometry(S.width, 0.08, 0.12), new THREE.MeshStandardMaterial({ color: '#d8dde3', metalness: 0.9, roughness: 0.3 }));
    teeth.position.y = 0.05; g.add(base, teeth);
    g.position.set(sx, y + 0.03, sz); g.rotation.y = Math.atan2(p.dx, p.dz);
    w.scene.add(g);
    return { x: p.x, z: p.z, dx: p.dx, dz: p.dz, width: S.width, mesh: g, at: D.state.t, hit: new Set() };
  }
  function spikesTick(me) {
    const S = cfg.spikes, v = sim.vehicle, b = v.body, q = b.rotation(), p = b.translation();
    for (let i = strips.length - 1; i >= 0; i--) {
      const s = strips[i];
      if (D.state.t - s.at > S.lifetime) { w.scene.remove(s.mesh); disposeMesh(s.mesh); strips.splice(i, 1); continue; }
      if (Math.hypot(me.x - s.x, me.z - s.z) > 20) continue;
      for (const wh of v.wheels) {
        if (s.hit.has(wh.name) || !wh.socket) continue;
        const o = rotate(q, wh.socket), [wx, wz] = frame.toWorld(p.x + o[0], p.z + o[2]);
        const along = (wx - s.x) * s.dx + (wz - s.z) * s.dz, across = (wx - s.x) * s.dz - (wz - s.z) * s.dx;
        if (Math.abs(along) < 0.45 && Math.abs(across) < s.width / 2) {
          s.hit.add(wh.name);
          const live = v.mechanical?.live;
          if (live?.pressure && v.mechanical.enabled) live.pressure[wh.name] = Math.min(live.pressure[wh.name], S.pressure);
          emit({ type: 'spiked', wheel: wh.name });
        }
      }
    }
  }

  // ---------- each physics tick ----------
  const detach = sim.onStep(s => tick(s.dt));
  function tick(dt) {
    if (disposed) return;
    const Q = session(), st = Q?.state.state;
    if (!started) {
      // the cinematic: parked until they pull out, then after you, the gap closing to the handover's
      if (cine && cineT != null) {
        cineT += dt;
        const me = { id: 0, ...carState(sim.vehicle) }, C = cine.police, k = Math.min(1, cineT / cine.seconds), gap = C.gapAtStart + (C.gapAtHandover - C.gapAtStart) * k;
        for (const u of units.values()) { u.driver.target = me; u.driver.order = cineT < C.pullOutAt ? { mode: 'block' } : { mode: 'follow', target: 0, slot: gap, line: course.line }; }
      }
      return;
    }
    if (st !== 'racing') {
      // (it's over — finished, busted, out of time: the police stop where they are)
      if (!over) { over = true; for (const u of units.values()) { u.driver.order = { mode: 'block' }; u.siren?.dispose(); u.siren = null; } }
      return;
    }
    const me = { id: 0, ...carState(sim.vehicle), ...game.health() };
    const hits = [];
    const list = [];
    for (const u of units.values()) {
      takeHits(u, me, hits);
      if (u.dirty && D.state.t - u.damagedAt > 0.5) { u.damagedAt = D.state.t; applyDamage(u); }
      list.push({ id: u.id, ...carState(u.car.vehicle), drivable: u.drivable });
    }
    lastHits = hits;
    const out = D.tick({ dt, players: [me], units: list, los: id => { const u = units.get(id); return u ? sees(u) : false; }, hits });
    for (const o of out.orders) { const u = units.get(o.id); if (u) { u.driver.order = o; u.driver.target = me; } }
    for (const r of out.requests) request(r, me);
    // (a unit hopelessly stuck — against a wall it can't back away from — taken away while you can't see it: another comes)
    for (const u of units.values()) if ((u.driver.state.stuckFor ?? 0) > cfg.police.stuckRemove && (!sees(u) || Math.hypot(carState(u.car.vehicle).x - me.x, carState(u.car.vehicle).z - me.z) > 80)) removeUnit(u.id);
    for (const e of D.drain()) emit(e);
    if (strips.length) spikesTick(me);
    if (Q) Q.state.pursuitNow = D.status;
  }

  // ---------- the look and sound ----------
  function lightBar(vis) {
    const box = new THREE.Box3().setFromObject(vis.group), top = box.max.y - vis.group.position.y;
    const g = new THREE.Group();
    const mk = c => new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.11, 0.2), new THREE.MeshBasicMaterial({ color: c }));
    const red = mk('#ff2030'), blue = mk('#2050ff'), mid = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.18), new THREE.MeshStandardMaterial({ color: '#1a1c20' }));
    red.position.x = 0.32; blue.position.x = -0.32; g.add(red, blue, mid);
    g.position.set(0, Math.max(1.1, top) + 0.04, -0.15);
    vis.group.add(g);
    return { g, red, blue };
  }
  function disposeMesh(o) { o.traverse(x => { x.geometry?.dispose(); x.material?.dispose?.(); }); }

  // ---------- the debug overlay ----------
  let dbg = debug, dbgEl = null, dbgLines = null, ring = null;
  const DBG_MAX = 4096;
  function onKey(e) {
    if (e.code !== cfg.debug.key || disposed) return;
    e.preventDefault(); e.stopImmediatePropagation();
    dbg = !dbg;
    if (!dbg) hideDebug();
  }
  addEventListener('keydown', onKey, true);
  function hideDebug() { dbgEl?.remove(); dbgEl = null; if (dbgLines) { w.scene.remove(dbgLines); dbgLines.geometry.dispose(); dbgLines.material.dispose(); dbgLines = null; } if (ring) { w.scene.remove(ring); ring.geometry.dispose(); ring.material.dispose(); ring = null; } }
  function drawDebug() {
    if (!dbgEl) {
      dbgEl = document.createElement('div');
      dbgEl.id = 'pursuitDebug';
      dbgEl.style.cssText = 'position:fixed;right:12px;top:120px;z-index:60;background:rgba(10,12,18,.82);color:#e8edf3;font:12px/1.45 "JetBrains Mono",monospace;padding:10px 12px;border-radius:8px;max-width:460px;pointer-events:none;white-space:pre';
      document.body.appendChild(dbgEl);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DBG_MAX * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(DBG_MAX * 3), 3));
      dbgLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
      dbgLines.frustumCulled = false; dbgLines.renderOrder = 999;
      w.scene.add(dbgLines);
    }
    const S = D.status, me = sim.vehicle.body.translation(), pos = dbgLines.geometry.attributes.position, col = dbgLines.geometry.attributes.color;
    let n = 0;
    const seg = (a, b, c) => { if (n + 2 > DBG_MAX) return; const C = new THREE.Color(c); for (const p of [a, b]) { pos.setXYZ(n, p[0], p[1], p[2]); col.setXYZ(n, C.r, C.g, C.b); n++; } };
    const rows = [];
    for (const u of units.values()) {
      const p = u.car.vehicle.body.translation(), s = S.units.find(x => x.id === u.id), ds = u.driver.state, eye = cfg.police.eyeHeight;
      // the sight line: green it sees you, red it's blocked (grey: too far to look)
      const d = Math.hypot(p.x - me.x, p.z - me.z);
      seg([p.x, p.y + eye, p.z], [me.x, me.y + eye, me.z], d > cfg.police.sight ? '#555b66' : s?.seeing ? '#38e07b' : '#ff3b3b');
      // where it's aiming, and its path on the roads
      if (ds.aim) { const [ax, az] = frame.toSim(ds.aim.x, ds.aim.z); seg([p.x, p.y + 2, p.z], [ax, p.y + 2, az], '#ffd24a'); }
      if (ds.line && ds.how === 'road') for (let k = 0; k + 1 < ds.line.length && n < DBG_MAX - 2; k += 2) { const a = ds.line[k], b = ds.line[Math.min(ds.line.length - 1, k + 2)]; const [ax, az] = frame.toSim(a.x, a.z), [bx, bz] = frame.toSim(b.x, b.z); seg([ax, p.y + 0.6, az], [bx, p.y + 0.6, bz], MODE_COLOUR[s?.mode] ?? '#4fc3f7'); }
      const sp = Math.hypot(u.car.vehicle.body.linvel().x, u.car.vehicle.body.linvel().z) * 3.6;
      rows.push(`#${u.id} ${(s?.mode ?? '?').padEnd(9)} ${String(ds.how).padEnd(11)} ${s?.seeing ? 'SEES' : '----'} ${String(Math.round(d)).padStart(4)}m ${String(Math.round(sp)).padStart(3)}/${String(Math.round((ds.speedWanted ?? 0) * 3.6)).padStart(3)}km/h ${Math.round(u.condition)}%${u.kind === 'block' ? ' block' : ''}${s?.slot ? ` ${s.slot}` : ''}`);
    }
    // the search area: a ring on the ground
    if (S.cooldown) {
      const [cx, cz] = frame.toSim(S.cooldown.x, S.cooldown.z), N = 64;
      for (let k = 0; k < N; k++) { const a0 = k / N * Math.PI * 2, a1 = (k + 1) / N * Math.PI * 2, r = S.cooldown.radius; seg([cx + Math.cos(a0) * r, me.y + 1, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, me.y + 1, cz + Math.sin(a1) * r], '#ff9f1a'); }
    }
    for (const s of strips) { const [sx, sz] = frame.toSim(s.x, s.z); seg([sx, me.y, sz], [sx, me.y + 6, sz], '#ffffff'); }
    for (let k = n; k < Math.min(DBG_MAX, n + 64); k++) pos.setXYZ(k, 0, -1e4, 0);
    pos.needsUpdate = true; col.needsUpdate = true;
    dbgLines.geometry.setDrawRange(0, n);
    const me0 = S.players[0];
    dbgEl.textContent = [
      `PURSUIT DEBUG (${cfg.debug.key})   t ${S.t.toFixed(1)}s`,
      `heat ${S.heat.toFixed(2)}  level ${S.level}/${S.maxHeat}  phase ${S.phase.toUpperCase()}`,
      S.cooldown ? `cooldown ${S.cooldown.left.toFixed(1)} / ${S.cooldown.total}s  search r ${S.cooldown.radius}m  you ${Math.round(Math.hypot(carState(sim.vehicle).x - S.cooldown.x, carState(sim.vehicle).z - S.cooldown.z))}m from its centre` : `cooldown —  (starts ${cfg.police.lostGrace}s after no unit sees you)`,
      `bust ${Math.round((me0?.bust ?? 0) * 100)}%  seen ${me0?.seen ? 'yes' : 'no'}   units ${units.size} (out ${S.disabled}, sent ${S.spawned})  hits ${lastHits.length}`,
      `spikes ${strips.length}`,
      '',
      'unit mode      driving     LOS   dist  speed/wanted  cond',
      ...rows,
    ].join('\n');
  }

  // ---------- the API ----------
  return {
    director: D,
    get units() { return units; },
    get status() { return D.status; },
    get spikeStrips() { return strips.length; },
    get debug() { return dbg; },
    set debug(on) { dbg = !!on; if (!dbg) hideDebug(); },
    event(e) {
      if (disposed) return;
      if (e.type === 'place') {
        // the first unit: startGap behind you on the route, waiting with you for GO (a cinematic's: parked by the road)
        const C = e.cinematic && cine ? cine.police : null, sAt = e.at ?? course.grid.startS, L = course.length, s0 = Math.max(0, sAt - (C?.gapAtStart ?? cfg.police.startGap)), p = lineAt(course.line, course.loop ? ((s0 % L) + L) % L : s0, course.loop);
        const side = C?.side ?? 0;
        startSpot = { x: p.x - p.dz * side, z: p.z + p.dx * side, heading: headingOf(p.dx, p.dz) }; startSpeed = e.rollingSpeed ?? 0;
        D.expect(cfg.police.expectStart ?? 1);
      } else if (e.type === 'go') {
        started = true; cineT = null;
        // (rolling: the police rolling too — after a cinematic they're already going)
        for (const u of units.values()) {
          const b = u.car.vehicle.body, q = b.rotation(), f = rotate(q, [0, 0, 1]), m = Math.hypot(f[0], f[2]) || 1;
          if (e.speed > 0) b.setLinvel({ x: f[0] / m * e.speed, y: 0, z: f[2] / m * e.speed }, true);
          u.driver.order = { mode: 'pursue', target: 0 };
        }
      }
    },
    frame(dt, { listener } = {}) {
      if (disposed) return;
      // (the first unit, once the ground's in where it goes)
      if (startSpot && game.ready()) { const s = startSpot; startSpot = null; addUnit({ ...s, speed: 0, rating: cfg.levels[D.state.level - 1].rating, target: 0 }).then(u => { if (u && started) { const b = u.car.vehicle.body, q = b.rotation(), f = rotate(q, [0, 0, 1]), m = Math.hypot(f[0], f[2]) || 1; b.setLinvel({ x: f[0] / m * startSpeed, y: 0, z: f[2] / m * startSpeed }, true); } }); }
      flash += dt;
      const S = D.status, chasing = !over && S.phase !== 'escaped';
      // the light bars: red and blue in turn (off once it's over or they've given up)
      for (const u of units.values()) {
        if (!u.bar) continue;
        const ph = (flash * 3 + u.id * 0.37) % 1, on = (chasing || u.kind === 'block') && u.drivable;
        u.bar.red.material.color.set(on && ph < 0.5 ? '#ff2030' : '#3a0a0e');
        u.bar.blue.material.color.set(on && ph >= 0.5 ? '#2a5cff' : '#0a1236');
      }
      // the sirens: the nearest two that are chasing
      const A = audio();
      if (A && listener) {
        const L = listener.pos, near = [...units.values()].filter(u => u.drivable && u.driver.order.mode !== 'block').map(u => ({ u, d: (() => { const p = u.car.vehicle.body.translation(); return Math.hypot(p.x - L[0], p.y - L[1], p.z - L[2]); })() })).sort((a, b) => a.d - b.d);
        const loud = new Set(chasing ? near.filter(x => x.d < 500 && x.u.drivable).slice(0, 2).map(x => x.u) : []);
        for (const u of units.values()) {
          if (!loud.has(u)) { if (u.siren) { u.siren.dispose(); u.siren = null; } continue; }
          u.siren ??= createSiren(A, { tone: u.id % 2 ? 'wail' : 'yelp', seed: u.id });
          const p = u.car.vehicle.body.translation(), v = u.car.vehicle.body.linvel(), rel = [p.x - L[0], p.y - L[1], p.z - L[2]];
          u.siren.update(dt, { rel, at: listener.toCamera ? listener.toCamera([p.x, p.y, p.z]) : rel, vel: [v.x, v.y, v.z], listenerVel: listener.vel, on: true, boost: 0.8 + 0.1 * S.level });
        }
      }
      if (dbg) drawDebug();
    },
    // for the maps: the units (world x, z) and the search area
    mapView() {
      const S = D.status;
      return { units: [...units.values()].filter(u => u.drivable).map(u => { const p = worldOf(u.car.vehicle.body); return { x: p.x, z: p.z, mode: S.units.find(x => x.id === u.id)?.mode }; }), search: S.cooldown && S.phase === 'cooldown' ? { x: S.cooldown.x, z: S.cooldown.z, radius: S.cooldown.radius } : null };
    },
    // R: back on the nearest road (the police are told where you are)
    resetPoint() {
      const me = carState(sim.vehicle), p = roads.onRoad(me.x, me.z);
      if (!p) return null;
      const same = p.dx * me.fx + p.dz * me.fz >= 0;
      return { x: p.x, z: p.z, h: p.h, heading: same ? headingOf(p.dx, p.dz) : headingOf(-p.dx, -p.dz) };
    },
    drain() { return events.splice(0); },
    // ---------- a cinematic intro (play/questUi.js runs it: data/cinematics.json) ----------
    setCinematic(def) { cine = def; },
    // (ready to roll: the first unit's in, on the ground, and drawn)
    get cinematicReady() { return !startSpot && units.size > 0 && game.ready() && [...units.values()].every(u => u.vis); },
    cinematicBegin() { cineT = 0; },
    // the first police car's pose, for the shots (sim frame: p, forward, left)
    poseOf(which = 'police') { const u = [...units.values()][0]; if (!u) return null; const b = u.car.vehicle.body, p = b.translation(), q = b.rotation(); return { p: [p.x, p.y, p.z], f: rotate(q, [0, 0, 1]), l: rotate(q, [1, 0, 0]) }; },
    // skipped: the police put gap m behind you along the route (s: yours), at speed (m/s), as if it had played out
    placeBehind(sPlayer, gap, speed) {
      const L = course.length;
      [...units.values()].forEach((u, i) => {
        const s0 = Math.max(0, sPlayer - gap - i * 10), p = lineAt(course.line, course.loop ? ((s0 % L) + L) % L : s0, course.loop), [sx, sz] = frame.toSim(p.x, p.z);
        const y = groundHeight(u.car.vehicle, sx, sz) ?? groundAt(p.x, p.z);
        u.car.vehicle.reset({ position: [sx, y + 0.05, sz], headingDeg: headingOf(p.dx, p.dz), speed });
      });
      cineT = cine?.seconds ?? cineT;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      detach();
      removeEventListener('keydown', onKey, true);
      hideDebug();
      for (const id of [...units.keys()]) removeUnit(id);
      for (const s of strips) { w.scene.remove(s.mesh); disposeMesh(s.mesh); }
      strips.length = 0;
    },
  };
}
