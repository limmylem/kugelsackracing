// Fixed-timestep simulation: a Rapier world with the track's colliders, loose props and our vehicle,
// advanced in fixed steps (settings.stepHz) no matter how fast the screen draws. Frame time goes
// into an accumulator; whole steps are taken out of it. The last two states are kept so a renderer
// can interpolate between them (alpha = how far we are into the next step).
//
// Nothing in a step depends on the frame rate: every step is the same dt, and the input can be given
// per step (a function of the step's moment within the frame), so the same inputs at the same moments
// give exactly the same drive at 30, 60 or 144 fps. step() takes a single step (tests, replays);
// onStep() listeners see every step (telemetry); perf keeps how long the physics takes.
//
// A world can also bring its collision in while running (addStatic / removeStatic: the real world
// streams roads, terrain and buildings round the car) and move the whole simulation to a new frame
// (shiftOrigin: the real world's floating origin), between steps, without the car noticing.
//
// No rendering and no browser APIs: RAPIER, the settings, car spec, sockets and track are all
// passed in, so this can run in the page, a Web Worker or on a server.

import { roadLine, roadSpawn, surfaceMap, trackProps, trackShapes } from './track.js';
import { LapTimer } from './lapTimer.js';
import { slipstream } from './slipstream.js';
import { Vehicle } from './vehicle.js';
import { ImpactSensor } from './impacts.js';
import { DebrisPool, LooseParts } from './looseParts.js';
import { RunTimer } from './runTimer.js';
import { add, fromXYZ, quatMultiply, rotate, toXYZ } from './math.js';
import { collisionGroups } from './carCollisions.js';

const now = () => performance.now();

export function createSimulation(RAPIER, { settings, spec, sockets, track }) {
  const world = new RAPIER.World({ x: settings.gravity[0], y: settings.gravity[1], z: settings.gravity[2] });
  // (Rapier's world.step ends by sweeping every body and collider for ones made inside the engine — only
  // soft bodies do, and there are none: bodies and colliders made and removed through the API are mapped
  // there. On a big world, tens of thousands of colliders, the sweep was most of a step's cost.)
  if (typeof world.mapNewSoftBodies === 'function') world.mapNewSoftBodies = () => {};
  const dt = 1 / settings.stepHz;
  world.timestep = dt;

  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  for (const s of trackShapes(track)) {
    let desc;
    if (s.kind === 'box') desc = RAPIER.ColliderDesc.cuboid(...s.halfExtents);
    else if (s.kind === 'capsule') desc = RAPIER.ColliderDesc.capsule(s.halfHeight, s.radius);
    else if (s.kind === 'heightfield') {
      const t = s.terrain;
      world.createCollider(RAPIER.ColliderDesc.heightfield(t.n, t.n, t.heights, { x: t.size, y: 1, z: t.size }), ground).userData = { material: 'ground' };
      continue;
    } else if (s.kind === 'trimesh') {
      // (a generated track's road and kerbs: drawn from the same arrays. Their triangles' edges smoothed
      // over: a car's floor scraping the road at speed slides, rather than catching on the edge between two
      // triangles)
      world.createCollider(RAPIER.ColliderDesc.trimesh(s.positions, s.indices, RAPIER.TriMeshFlags?.FIX_INTERNAL_EDGES), ground).userData = { material: s.material ?? 'ground' };
      continue;
    } else throw new Error(`unknown shape ${s.kind}`);
    if (s.friction != null) desc.setFriction(s.friction);
    if (s.restitution != null) desc.setRestitution(s.restitution);
    const c = world.createCollider(desc.setTranslation(...s.centre).setRotation(s.rotation), ground);
    c.userData = { material: s.material ?? (s.tree ? 'wood' : s.ground ? 'ground' : 'concrete') };     // (what a crash into it sounds like)
  }

  // Loose props (cones): light dynamic bodies the car can knock over
  const propDefs = trackProps(track);
  const props = propDefs.map(p => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...p.position));
    world.createCollider(RAPIER.ColliderDesc.cone(p.halfHeight, p.radius).setMass(p.mass).setFriction(p.friction), body);
    return body;
  });
  const propState = () => props.map(b => { const t = b.translation(), q = b.rotation(); return { position: [t.x, t.y, t.z], rotation: { x: q.x, y: q.y, z: q.z, w: q.w } }; });

  const spawn = roadSpawn(track) || track.spawn;
  const surfaces = surfaceMap(track)?.at ?? null;       // tyre grip by surface (none: dry tarmac everywhere)
  let altitudeOffset = 0;                                // a test offset on top of the world's own altitude
  // (torn-off parts lying about, every car's; physics/looseParts.js)
  const debrisRules = settings.debris ?? { max: 30, maxDistance: 200, maxAge: 60, ignoreCarFor: 0.5, minMass: 3, linearDamping: 0.05, angularDamping: 0.6, hingeFriction: 0.4, plate: 1.1, clatterFrom: 1.2, clatterEvery: 0.08 };
  const debris = new DebrisPool(RAPIER, world, debrisRules);
  // (cars hitting cars: physics/carCollisions.js — 'off' is ghosting, every car passing through the others)
  let collisions = 'full';
  // (a generated track: every car with continuous collision detection — its barriers never passed through)
  const setupCar = v => { if (track.generated) v.body.enableCcd(true); v.sensor = new ImpactSensor(v, settings.impacts); v.parts = new LooseParts(v, RAPIER, debris, debrisRules); v.surfaceAt = surfaces; v.altitudeBase = (track.altitude ?? 0) + altitudeOffset; if (track.wind) v.worldWind = [...track.wind]; v.wind = v.worldWind ?? v.wind; v.collider.setCollisionGroups(collisionGroups(collisions)); return v; };
  let vehicle = setupCar(new Vehicle(RAPIER, world, spec, sockets, spawn));
  vehicle.id = 0;                                        // (yours: 0; others' are their ids)
  // Other cars (AI test cars now; traffic / multiplayer later): { id, vehicle, driver(vehicle, dt) → input }
  const cars = [];
  let nextCarId = 1;
  const timer = new RunTimer();
  // Lap / stage timer on the first closed road with a start line
  const lapRoad = (track.roads || []).find(r => r.closed && r.startLine);
  const lapLine = lapRoad && roadLine(lapRoad);
  const lapTimer = lapRoad && new LapTimer(lapLine, 2, lapLine.reduce((best, p, i) => Math.hypot(p.x - lapRoad.startLine[0], p.z - lapRoad.startLine[1]) < Math.hypot(lapLine[best].x - lapRoad.startLine[0], lapLine[best].z - lapRoad.startLine[1]) ? i : best, 0));
  const snapshot = () => ({ ...vehicle.snapshot(), props: propState(), timer: timer.snapshot(), lap: lapTimer?.snapshot() ?? null, others: cars.map(c => ({ id: c.id, ...c.vehicle.snapshot() })), debris: debris.count ? debris.snapshot() : [] });
  // Every car's slipstream from every other car's wake
  const wakes = () => {
    const all = [vehicle, ...cars.map(c => c.vehicle)], states = all.map(v => { const p = v.body.translation(), l = v.body.linvel(); return { pos: [p.x, p.y, p.z], vel: [l.x, l.y, l.z] }; });
    all.forEach((v, i) => { v.slipstream = slipstream(states[i], states.filter((_, j) => j !== i), v.spec.aero.slipstream); });
  };
  world.step(); // lets ray casts see the colliders straight away
  let accumulator = 0, previous = snapshot(), current = previous, steps = 0;
  const listeners = new Set();

  // Physics cost, smoothed (ms): a whole step, our car, the other cars, Rapier's own step; `peak` is
  // the slowest recent step. budget (settings.budget) is what the physics may use per drawn frame.
  const perf = { stepMs: 0, vehicleMs: 0, carsMs: 0, worldMs: 0, peakMs: 0, cars: 1, perCarMs: 0, budget: settings.budget ?? null };
  const ema = (a, x) => a + (x - a) * 0.02;

  // One fixed step with this input
  function step(input) {
    const t0 = now();
    if (cars.length) wakes();
    vehicle.step(dt, input);
    const t1 = now();
    // (a car off the physics — an NPC far away, run along its racing line instead: race/race.js — skips it)
    for (const c of cars) if (!c.offPhysics) c.vehicle.step(dt, c.driver(c.vehicle, dt));
    const t2 = now();
    vehicle.sensor.before(); vehicle.parts.before();
    for (const c of cars) if (!c.offPhysics) { c.vehicle.sensor.before(); c.vehicle.parts.before(); }
    world.step();
    const t = (steps + 1) * dt;
    vehicle.sensor.after(dt, t); vehicle.parts.after(dt);
    for (const c of cars) if (!c.offPhysics) { c.vehicle.sensor.after(dt, t); c.vehicle.parts.after(dt); }
    if (debris.count) debris.after(dt, t, fromXYZ(vehicle.body.translation()));
    const t3 = now();
    timer.update(dt, vehicle.forwardSpeed(), vehicle.brake);
    if (lapTimer) { const p = vehicle.body.translation(); lapTimer.update(dt, p.x, p.z); }
    steps++;
    for (const fn of listeners) fn(api, steps);
    perf.stepMs = ema(perf.stepMs, t3 - t0);
    perf.vehicleMs = ema(perf.vehicleMs, t1 - t0);
    perf.carsMs = ema(perf.carsMs, t2 - t1);
    perf.worldMs = ema(perf.worldMs, t3 - t2);
    perf.peakMs = Math.max(perf.peakMs * 0.995, t3 - t0);
    perf.cars = 1 + cars.length;
    perf.perCarMs = (perf.vehicleMs + perf.carsMs) / perf.cars;
  }

  const api = {
    dt,
    get vehicle() { return vehicle; },
    debris,
    timer,
    lapTimer,
    cars,
    track,
    perf,
    get time() { return steps * dt; },
    get stepCount() { return steps; },
    snapshot,
    step,
    // fn(sim, stepNumber) after every step; returns a function that stops it
    onStep(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // Add a car driven by `driver` at spawn ({ position, headingDeg, speed? }); returns its id. Another
    // model: its own spec and sockets (an NPC's car, built from its parts)
    addCar(at, driver, carSpec = spec, carSockets = sockets) {
      const v = setupCar(new Vehicle(RAPIER, world, carSpec, carSockets, at));
      const c = { id: nextCarId++, vehicle: v, driver };
      v.id = c.id;
      cars.push(c);
      current = snapshot();
      return c.id;
    },
    removeCar(id) {
      const i = cars.findIndex(c => c.id === id);
      if (i < 0) return;
      cars[i].vehicle.parts.clear();
      world.removeRigidBody(cars[i].vehicle.body);
      cars.splice(i, 1);
      if (!cars.length) vehicle.slipstream = { drag: 0, downforce: 0, amount: 0 };
      previous = current = snapshot();
    },
    // Another car in place of the player's (a different model: its sockets, its collider), where the old
    // one was (at: { position, headingDeg, speed? }; none: the same place and heading, stopped). The
    // spec object may be the same one, refilled with the new car's values.
    replaceCar(carSpec, carSockets, at = null) {
      const p = vehicle.body.translation(), q = vehicle.body.rotation();
      const pose = at ?? { position: [p.x, p.y, p.z], headingDeg: Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x)) * 180 / Math.PI };
      vehicle.parts.clear();
      world.removeRigidBody(vehicle.body);
      sockets = carSockets;                    // (cars added after this: the new model's too)
      vehicle = setupCar(new Vehicle(RAPIER, world, carSpec, carSockets, spawn));
      vehicle.id = 0;
      api.resetCar(pose);
      previous = current = snapshot();
      return vehicle;
    },
    // Test altitude on top of the world's own (m); every car breathes and gets aero for it
    setAltitudeOffset(m) {
      altitudeOffset = m;
      for (const v of [vehicle, ...cars.map(c => c.vehicle)]) v.altitudeBase = (track.altitude ?? 0) + m;
    },
    // The car spec was edited (tuning): every car on it works out its derived numbers again
    retune() { for (const v of [vehicle, ...cars.map(c => c.vehicle)]) v.retune(); },
    // Whether cars hit each other: 'full' and 'reduced' (the damage is the game's business), or 'off'
    // (ghosting: they pass through each other — every car, and every car added after)
    get collisions() { return collisions; },
    setCollisions(mode) { collisions = mode; for (const v of [vehicle, ...cars.map(c => c.vehicle)]) v.collider.setCollisionGroups(collisionGroups(mode)); },
    propDefs,
    // Advance by real elapsed time. Returns the two states to blend and the blend factor.
    // input: an input object for every step this frame, or a function (start, end) → input for each
    // step, where start / end are the step's moment in seconds relative to now (≤ 0), so input that
    // changed between two frames can reach the step it happened in.
    advance(frameSeconds, input) {
      accumulator += frameSeconds;
      let left = accumulator, n = 0;
      while (left >= dt && n < settings.maxStepsPerFrame) { left -= dt; n++; }
      for (let i = 0; i < n; i++) {
        const end = -(left + (n - 1 - i) * dt);
        if (i === n - 1) previous = n > 1 ? snapshot() : current;
        step(typeof input === 'function' ? input(end - dt, end) : input);
      }
      if (n) current = snapshot();
      accumulator = n === settings.maxStepsPerFrame ? Math.min(left, dt) : left; // too far behind: drop the backlog
      return { previous, current, alpha: accumulator / dt, stepsThisFrame: n, totalSteps: steps };
    },
    // Put just the car somewhere else (e.g. back on the road): { position, headingDeg }
    resetCar(at) {
      vehicle.reset(at);
      accumulator = 0;
      previous = current = snapshot();
    },
    reset() {
      vehicle.reset(spawn);
      props.forEach((b, i) => {
        b.setTranslation({ x: propDefs[i].position[0], y: propDefs[i].position[1], z: propDefs[i].position[2] }, true);
        b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        b.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      });
      accumulator = 0;
      previous = current = snapshot();
    },
    // Where each loose prop is now
    propPositions() { return props.map(b => { const t = b.translation(); return [t.x, t.y, t.z]; }); },

    // Fixed collision added while running: a body at pose ({ position, rotation }) with these
    // collider descriptions (each may carry userData, e.g. a surface). Returns a handle for removeStatic.
    addStatic(pose, descs) {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...pose.position).setRotation(pose.rotation ?? { x: 0, y: 0, z: 0, w: 1 }));
      const colliders = descs.map(d => { const c = world.createCollider(d.desc ?? d, body); if (d.userData) c.userData = d.userData; return c; });
      return { body, colliders };
    },
    // more colliders on a static body already there (collision that arrives a piece at a time)
    addToStatic(handle, descs) {
      for (const d of descs) { const c = world.createCollider(d.desc ?? d, handle.body); if (d.userData) c.userData = d.userData; handle.colliders.push(c); }
    },
    removeStatic(handle) { if (handle?.body && world.getRigidBody(handle.body.handle)) world.removeRigidBody(handle.body); },
    moveStatic(handle, pose) {
      handle.body.setTranslation(toXYZ(pose.position), false);
      if (pose.rotation) handle.body.setRotation(pose.rotation, false);
    },

    // Floating origin: re-express the whole simulation in a new frame, where old coordinates p become
    // rotate(q, p) + t. Every body moves (fixed ones too), velocities and spins turn with it, and so do
    // the states kept for drawing, so nothing jumps and the car carries on exactly as it was going.
    shiftOrigin(q, t) {
      const move = p => add(rotate(q, p), t);
      world.forEachRigidBody(b => {
        b.setTranslation(toXYZ(move(fromXYZ(b.translation()))), false);
        b.setRotation(quatMultiply(q, b.rotation()), false);
        if (b.isDynamic()) {
          b.setLinvel(toXYZ(rotate(q, fromXYZ(b.linvel()))), false);
          b.setAngvel(toXYZ(rotate(q, fromXYZ(b.angvel()))), false);
        }
      });
      for (const v of [vehicle, ...cars.map(c => c.vehicle)]) {
        v.wind = rotate(q, v.wind);
        if (v.worldWind) v.worldWind = rotate(q, v.worldWind);
      }
      previous = shiftSnapshot(previous, q, move);
      current = shiftSnapshot(current, q, move);
    },
  };
  return api;
}

// A snapshot re-expressed in a new frame (positions moved, directions turned)
function shiftSnapshot(s, q, move) {
  if (!s) return s;
  const turn = v => v && rotate(q, v);
  const out = { ...s, position: move(s.position), rotation: quatMultiply(q, s.rotation), velocity: turn(s.velocity), up: turn(s.up) };
  if (s.wheels) out.wheels = s.wheels.map(w => ({ ...w, origin: w.origin && move(w.origin), contact: w.contact && move(w.contact), force: turn(w.force) }));
  if (s.props) out.props = s.props.map(p => ({ position: move(p.position), rotation: quatMultiply(q, p.rotation) }));
  if (s.others) out.others = s.others.map(o => shiftSnapshot(o, q, move));
  if (s.debris) out.debris = s.debris.map(p => ({ ...p, position: move(p.position), rotation: quatMultiply(q, p.rotation), contact: p.contact && move(p.contact) }));
  if (s.partScrape?.position) out.partScrape = { ...s.partScrape, position: move(s.partScrape.position) };
  if (s.looseParts) out.looseParts = s.looseParts.map(p => ({ ...p, position: move(p.position), rotation: quatMultiply(q, p.rotation) }));
  if (s.aero?.arrows) out.aero = { ...s.aero, arrows: s.aero.arrows.map(a => ({ ...a, point: move(a.point), force: turn(a.force) })) };
  return out;
}
