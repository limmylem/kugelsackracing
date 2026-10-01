// The physics car (Steps 1–6: Rapier, the tyre model, drivetrain, brakes, aids, aero) in the real
// world. The simulation runs in a local frame round the player (physics/geo.js: x east, y up, z south,
// gravity −y) whose origin follows the car: once the car is REBASE_DISTANCE from it, the origin moves
// to the car and the whole simulation is re-expressed in the new frame between two steps, so positions
// stay small and precise however far you drive, without the car noticing.
//
// The page (index.html, Cesium) draws the car from pose(): an earth-fixed (ECEF) matrix for the model,
// the wheels' spin / steer / suspension, and where it is (latitude, longitude, height, bearing).
//
// Driving surface: the real world's collision, brought in a chunk at a time as the car drives
// (addChunk / removeChunk: realworld/ground.js builds them from the map and the terrain), all raised or
// lowered together by setGroundOffset to line up with what's drawn. Until there's ground under the car
// (just placed, or still loading) it holds the car where it is (a kinematic body: pinned in place, the
// world still stepping so new ground shows up) rather than let it fall.

import RAPIER from '@dimforge/rapier3d-compat';
import { createSimulation } from '../physics/sim.js';
import { modelRig, nodeBoxes, nodesWithMaterial, socketsFromGlb } from '../physics/sockets.js';
import { LocalFrame, bearingOf, directionOf } from '../physics/geo.js';
import { add, rotate, toXYZ } from '../physics/math.js';
import { InputManager } from '../testtrack/input.js';
import { loadSettings, saveSettings } from '../testtrack/settings.js';
import { garageSession } from '../garage/session.js';
import { causeOf } from '../testtrack/engineNews.js';

export const REBASE_DISTANCE = 2000;   // m from the origin before it moves to the car
const LAND_SEARCH = 60;                // m above / below the car to look for ground to stand on

export async function createPhysicsCar() {
  const getJson = async url => (await fetch(url, { cache: 'no-cache' })).json();
  // the car, built from its parts by the garage (the same live spec the test worlds drive)
  const [settings, session] = await Promise.all([getJson('physics/settings.json'), garageSession()]);
  const spec = session.spec;
  // the car's model: where its sockets are, and for the page how to turn its wheels and steering wheel,
  // and its glass (again for another car: the garage's, or a test drive)
  const modelOf = async () => {
    const glb = await (await fetch(spec.model.file)).arrayBuffer();
    return { glb, sockets: socketsFromGlb(glb, spec.model), model: { file: spec.model.file, forwardAxis: spec.model.forwardAxis, rig: modelRig(glb, spec.model), glass: nodesWithMaterial(glb, n => /glass/i.test(n)) },
      damageBoxes: nodeBoxes(glb, spec.model, [...(session.garage.car.model.breakables ?? []).map(b => b.node), 'body_shell']) };
  };
  let carId = session.garage.car.id, { sockets, model, damageBoxes } = await modelOf();
  await RAPIER.init();
  // no fixed ground of its own: the world brings its surface in as it streams
  const sim = createSimulation(RAPIER, { settings, spec, sockets, track: { spawn: { position: [0, 0, 0], headingDeg: 0 } } });
  let v = sim.vehicle;
  const prefs = loadSettings(spec), input = new InputManager(prefs);
  // a car missing a part it can't drive without (or with a blown engine) doesn't drive; and in normal
  // play the garage only changes it while it's stopped (garage.debugMode(true): while driving too)
  const drivable = () => { const d = session.drivable; v.immobilized = d.ok ? null : d.reasons; };
  // another car (picked in the garage, or a test drive): the new one where the old one stood
  const carListeners = new Set();
  const switchCar = async () => {
    const id = session.garage.car.id;
    if (id === carId) return;
    carId = id;
    ({ sockets, model, damageBoxes } = await modelOf());
    v = sim.replaceCar(spec, sockets);
    v.altitudeBase = frame?.height ?? v.altitudeBase;
    drivable();
    for (const fn of carListeners) fn();
  };
  session.onChange(() => { if (session.garage.car.id !== carId) { switchCar(); return; } sim.retune(); drivable(); });   // parts fitted or taken off, tuning, condition (window.garage)
  session.onLook(drivable); drivable();
  session.addChangeGate(() => !window.testTrackActive && Math.abs(v.forwardSpeed()) > 0.5 ? 'Stop the car first: parts, tuning and condition only change in the garage (standing still). garage.debugMode(true) lets them change while driving.' : null);
  const fixedOnly = c => { const p = c.parent(); return !p || p.isFixed(); };

  let frame = null, rebases = 0, holding = true, heldAt = null, lastGround = null, liftCheck = false;
  // (whatever else is in the local frame — the effects — moves with it: fn(rotation, translation))
  const shiftListeners = new Set();
  const shifted = (q, t) => { for (const fn of shiftListeners) fn(q, t); };
  // what the engine went through (an over-rev: bent valves, blown), for the page to show; the damage
  // is written to the player's engine as each over-rev ends
  const news = [];
  // crashes: each hit into the damage (the player's damage setting), for the page to show; dents follow
  // through the session's onLook
  const crashes = () => {
    for (const impact of v.sensor.take()) {
      // (nothing comes loose or off here yet: the real world draws the car as one model)
      const before = new Set(session.damage.shell?.broken ?? []);
      const { result, saved } = session.crash(impact, { mode: prefs.damage ?? 'full', boxes: damageBoxes, detach: false });
      news.push({ type: 'crash', result, impact, before });         // (the impact and what was broken before: for the effects)
      saved.then(r => { if (r && !r.ok) console.warn(`The crash damage wasn't saved: ${r.error}`); });
    }
  };
  // mechanical damage (garage/mechanical.js, physics/mechanical.js): a kerb strike or heavy landing
  // damages its corner (no wheel comes off here: the car's drawn as one model), and what changes while
  // driving (tyre pressures, coolant, clutch wear) is written back every few seconds
  let sinceSave = 0;
  const warn = what => r => { if (r && r.ok === false) console.warn(`The ${what} wasn't saved: ${r.error ?? r.errors?.join(' ')}`); };
  const engineNews = seconds => {
    const mode = prefs.damage ?? 'full';
    crashes();
    for (const e of v.drivetrain.events.splice(0)) {
      if (e.type === 'grind') continue;
      news.push(e);
      if (e.type === 'incident') session.wearEngine(e.condition, causeOf(e)).then(warn('engine damage'));
      if (e.type === 'overRevShift') session.mechanical.gearboxWear(e.over * session.db.damage.mechanical.effects.gearbox.overRevShift, { mode }).then(warn('gearbox damage'));
    }
    for (const e of v.mechanical.take()) {
      if (e.type === 'strike') session.mechanical.strike(e.wheel, e.strength, { mode, kind: e.kind, tearOff: false }).saved.then(warn(`${e.kind} damage`));
      else news.push(e);
    }
    if ((sinceSave += seconds) >= session.db.damage.mechanical.saveEvery) {
      sinceSave = 0;
      const live = v.mechanical.changes();
      if (live) session.mechanical.writeBack(live).then(warn('mechanical damage'));
    }
    if (news.length > 16) news.splice(0, news.length - 16);
  };
  const idle = { device: 'wheel', throttle: 0, brake: 0, steer: 0, handbrake: false };
  let ground = null;              // { handle, frame } a single height grid (a flat stand-in, where there's nothing else)
  const chunks = new Map();       // key → { frame, handle }: the real world's collision, chunk by chunk
  let groundOffset = 0;           // m: all of it raised (or lowered) by this

  // First fixed surface straight below a point of the local frame (height, or null)
  function surfaceBelow(x, z, fromY, reach) {
    const hit = sim.vehicle.world.castRay(new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }), reach, true, undefined, undefined, undefined, v.body, fixedOnly);
    return hit ? fromY - hit.timeOfImpact : null;
  }

  // Re-centre the frame on the car (the floating origin)
  function rebase() {
    const p = v.body.translation(), g = frame.localToGeodetic([p.x, p.y, p.z]);
    const next = new LocalFrame(g.lat, g.lon, g.height), T = frame.transformTo(next);
    sim.shiftOrigin(T.rotation, T.translation);
    shifted(T.rotation, T.translation);
    if (heldAt) heldAt = add(rotate(T.rotation, heldAt), T.translation);
    if (lastGround) lastGround = add(rotate(T.rotation, lastGround), T.translation);
    frame = next;
    v.altitudeBase = next.height;
    rebases++;
  }

  // Pose of a piece of ground (in its own tangent frame) in the current frame
  const groundPose = f => { const T = f.transformTo(frame); return { position: add(T.translation, rotate(T.rotation, [0, groundOffset, 0])), rotation: T.rotation }; };

  // Hold the car at a spot (pinned: a kinematic body) until there's a surface under it
  function hold(at) {
    holding = true;
    heldAt = at;
    v.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    v.body.setTranslation(toXYZ(at), true);
    v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  // ...and set it down on one as soon as there is (true if it did): the first surface under a spot
  // just above where it was put (so in a tunnel it's the tunnel's road, not the hill over it), else
  // anything from high up
  function tryToLand() {
    const [x, y, z] = heldAt;
    const top = surfaceBelow(x, z, y + 3, 3 + LAND_SEARCH) ?? surfaceBelow(x, z, y + LAND_SEARCH, 2 * LAND_SEARCH);
    if (top === null) return false;
    v.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    v.body.setTranslation({ x, y: top + spec.spawnHeight, z }, true);
    v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    holding = false;
    return true;
  }

  const api = {
    sim, spec, input, prefs, RAPIER,
    get model() { return model; },
    get carId() { return carId; },
    // fn() once another car's in place (the page draws the new one)
    onCar(fn) { carListeners.add(fn); return () => carListeners.delete(fn); },
    get frame() { return frame; },
    // fn(rotation, translation) whenever the local frame moves (the floating origin, a new place)
    onShift(fn) { shiftListeners.add(fn); return () => shiftListeners.delete(fn); },
    // where the body's glass and lights are (crash damage, the effects' glass)
    get damageBoxes() { return damageBoxes; },
    get session() { return session; },
    rebaseDistance: REBASE_DISTANCE,        // (adjustable, for testing)
    get rebases() { return rebases; },
    get holding() { return holding; },
    // the engine's news since the last call (drivetrain events, and { type: 'restored' })
    takeNews() { return news.splice(0); },

    // Put the car at a place (radians, metres above the ellipsoid), standing, facing a compass
    // bearing (radians). The frame is centred there; the car waits for ground under it.
    place(lat, lon, height, bearing) {
      const next = new LocalFrame(lat, lon, height);
      if (frame) { const T = frame.transformTo(next); sim.shiftOrigin(T.rotation, T.translation); shifted(T.rotation, T.translation); }
      frame = next;
      v.altitudeBase = height;
      const d = directionOf(bearing);
      sim.resetCar({ position: [0, 0, 0], headingDeg: Math.atan2(d[0], d[2]) * 180 / Math.PI });
      lastGround = null;
      hold([0, 0, 0]);
    },

    // A single height grid to drive on, in its own tangent frame (a stand-in where there's no map):
    // grid: { lat, lon, height (its frame's origin, radians / m), n (cells a side), size (m), heights
    // (Float32Array, (n+1)², column-major: columns along east, rows along south, heights above that
    // frame's tangent plane) }
    setGround(grid) {
      const g = { frame: new LocalFrame(grid.lat, grid.lon, grid.height) };
      const desc = RAPIER.ColliderDesc.heightfield(grid.n, grid.n, grid.heights, { x: grid.size, y: 1, z: grid.size });
      g.handle = sim.addStatic(groundPose(g.frame), [desc]);
      if (ground) sim.removeStatic(ground.handle);
      ground = g;
      liftCheck = true;     // (after the next step, when rays can see it)
    },
    clearGround() { if (ground) sim.removeStatic(ground.handle); ground = null; },

    // A chunk of the real world's collision (realworld/ground.js): its frame { lat, lon, height }
    // (degrees, m) and collider descriptions, which can arrive over several calls (so no one frame
    // has to take them all in)
    addChunk(key, where, descs) {
      let c = chunks.get(key);
      if (!c) {
        const f = new LocalFrame(where.lat * Math.PI / 180, where.lon * Math.PI / 180, where.height);
        chunks.set(key, c = { frame: f, handle: sim.addStatic(groundPose(f), descs) });
      } else sim.addToStatic(c.handle, descs);
      liftCheck = true;
    },
    removeChunk(key) { const c = chunks.get(key); if (c) { sim.removeStatic(c.handle); chunks.delete(key); } },
    clearChunks() { for (const key of [...chunks.keys()]) api.removeChunk(key); },
    hasChunk: key => chunks.has(key),
    get chunkCount() { return chunks.size; },
    // Raise / lower all the ground (m) without rebuilding it
    setGroundOffset(offset) {
      if (offset === groundOffset) return;
      groundOffset = offset;
      if (ground) sim.moveStatic(ground.handle, groundPose(ground.frame));
      for (const c of chunks.values()) sim.moveStatic(c.handle, groundPose(c.frame));
    },
    get groundOffset() { return groundOffset; },

    // One drawn frame: player settings onto the car, the floating origin, then the physics steps
    // (each with the input from its own moment). now: the frame's time (ms), seconds: since the last.
    update(now, seconds, active) {
      if (!frame) return null;
      input.enabled = active;
      const inp = input.poll(), P = prefs;
      for (const act of inp.pressed) {
        if (act === 'gearbox') v.drivetrain.mode = v.drivetrain.mode === 'auto' ? 'sequential' : 'auto';
        if (act === 'aids') { const on = !Object.entries(P.aids).some(([k, x]) => k !== 'tcStrength' && k !== 'revProtection' && x); for (const k of ['abs', 'tc', 'esc', 'countersteer', 'steering', 'drift']) P.aids[k] = on; saveSettings(P); }
        // development: every part back to 100% (a blown engine runs again)
        if (act === 'restore') session.restoreCar().then(r => { if (r.ok) { v.drivetrain.health.sync(); v.mechanical.cool(); news.push({ type: 'restored' }); } });
      }
      Object.assign(v.aids, P.aids);
      v.mechanical.enabled = (P.damage ?? 'full') === 'full';      // (visual only, off: it drives as new)
      if (v.brakes.bias !== P.brakeBias) v.brakes.setBias(P.brakeBias);
      v.handbrakeClutch = P.handbrakeClutch;

      const p = v.body.translation();
      if (!holding && Math.hypot(p.x, p.z) > api.rebaseDistance) rebase();
      // fell through the world (no surface under it any more): hold it where it last had ground
      if (!holding && lastGround && p.y < lastGround[1] - 25) hold(lastGround);
      if (holding) {
        const view = sim.advance(seconds, idle);          // (the world keeps stepping: new ground shows up)
        tryToLand();
        return api.pose(view);
      }
      const view = sim.advance(active ? seconds : 0, active ? (a, b) => input.stepInput(inp, now + a * 1000, now + b * 1000) : { ...idle, device: inp.device });
      engineNews(active ? seconds : 0);
      const w = v.wheels.find(x => x.grounded);
      if (w) lastGround = [p.x, w.contact[1], p.z];
      // new ground came in just above the car (it had run off the edge of what there was): lift it
      // back on (only from just above it: in a tunnel the hill over it isn't the ground)
      if (liftCheck && view.stepsThisFrame) {
        liftCheck = false;
        const q = v.body.translation(), top = surfaceBelow(q.x, q.z, q.y + 1.5, 1.8);
        if (top !== null && top > q.y - 0.2) v.body.setTranslation({ x: q.x, y: top + spec.spawnHeight, z: q.z }, true);
      }
      return api.pose(view);
    },

    // Where to draw the car, between the last two physics states
    pose(view) {
      const { previous: a, current: b, alpha = 1 } = view;
      const mix = (x, y) => x + (y - x) * alpha;
      const pos = a.position.map((x, i) => mix(x, b.position[i]));
      const qa = a.rotation, qb = b.rotation, sign = qa.x * qb.x + qa.y * qb.y + qa.z * qb.z + qa.w * qb.w < 0 ? -1 : 1;
      let q = { x: mix(qa.x, qb.x * sign), y: mix(qa.y, qb.y * sign), z: mix(qa.z, qb.z * sign), w: mix(qa.w, qb.w * sign) };
      const ql = Math.hypot(q.x, q.y, q.z, q.w); q = { x: q.x / ql, y: q.y / ql, z: q.z / ql, w: q.w / ql };
      const fwd = rotate(q, [0, 0, 1]), left = rotate(q, [1, 0, 0]), up = rotate(q, [0, 1, 0]);
      // model matrix in ECEF (column-major, as Cesium's Matrix4.fromArray takes it): the model's
      // axes are +X forward, +Y left, +Z up
      const F = frame.vectorFromLocal(fwd), L = frame.vectorFromLocal(left), U = frame.vectorFromLocal(up), O = frame.fromLocal(pos);
      const matrix = [...F, 0, ...L, 0, ...U, 0, ...O, 1];
      const geo = frame.localToGeodetic(pos);
      return {
        matrix, lat: geo.lat, lon: geo.lon, height: geo.height,
        bearing: bearingOf(fwd), pitch: Math.asin(Math.max(-1, Math.min(1, fwd[1]))), roll: Math.asin(Math.max(-1, Math.min(1, left[1]))),
        speed: b.speed, snapshot: b,
        // (drop: the wheel centre's height above its socket, as modelRig takes it)
        wheels: b.wheels.map((wb, i) => ({ name: wb.name, front: wb.front, spin: mix(a.wheels[i].spin, wb.spin), steer: mix(a.wheels[i].steerAngle, wb.steerAngle), length: mix(a.wheels[i].length, wb.length),
          drop: (spec.wheels.mountHeight?.[spec.wheels.front.includes(wb.name) ? 'front' : 'rear'] ?? 0) - mix(a.wheels[i].length, wb.length), offset: spec.wheels.offsets?.[wb.name] ?? 0 })),
        speedometer: b.speedometer,
        steeringWheel: mix(a.steering.wheelAngle, b.steering.wheelAngle),
        holding,
        steps: view.stepsThisFrame ?? 0,
      };
    },
  };
  return api;
}
