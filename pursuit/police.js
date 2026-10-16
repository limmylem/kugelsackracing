// A police unit's driver (docs/PURSUIT.md): what the director (pursuit/director.js) wants of it — its mode, its target,
// its goal — turned into the car's input each physics tick, through the same physics as any car (physics/sim.js addCar;
// the same damage, the same grip). On the roads it follows a path on the road network (pathTo: the game's, from
// route/network.js; replanned now and then) with route/autopilot.js; close to its target with a clear line it leaves
// the road and goes straight for it, cutting corners — pursuing, ramming, lining up a PIT on a rear corner and turning
// in, or holding a slot of a box-in. Stuck against something, it backs off and tries again. Its only "rubber band" is a
// small change to the speed it aims for (data/pursuit.json driving.rubberBand), never its car.
//
//   const U = createPoliceDriver({ cfg (data/pursuit.json), frame: { toWorld }, car: autopilot caps { vmax, grip, brake },
//                                  pathTo(from, to) → line | null, clear(from, to) → bool (no building or hill between) })
//   U.order = { mode, target, goal, slot }   U.target = { x, z, vx, vz, speed, heading }   (the game sets both each tick)
//   U.drive(vehicle, dt) → the car's input (the sim's driver)      U.state → what it's doing (the debug overlay)

import { createAutopilot } from '../route/autopilot.js';
import { steerInput } from '../physics/ai.js';
import { rotate } from '../physics/math.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const G = 9.81;
const TARGETED = new Set(['pursue', 'ram', 'pit', 'box']);

// the car's caps for the autopilot from its build (route/racingLine.js carCaps: grip in g or m/s²)
export function policeCaps(caps) {
  const grip = caps.grip < 4 ? caps.grip * G : caps.grip;
  // (accel: no limit — the plan's only the corners and the braking for them; a path is replanned from where the car is,
  // already moving, so a standing start's at every path's beginning would hold it to a crawl. The physics decides how
  // fast it really gets going)
  return { vmax: caps.topSpeed ?? 50, grip, accel: 50, brake: caps.brake ?? 8 };
}

// where to aim and how fast, for the target-based modes (pure: the tests check it)
//   me, tg: { x, z, vx, vz, speed }; → { x, z, speed (m/s wanted) }
export function aimFor(mode, me, tg, slot, D) {
  const sp = tg.speed ?? Math.hypot(tg.vx, tg.vz), fx = sp > 1 ? tg.vx / sp : Math.sin(tg.heading ?? 0), fz = sp > 1 ? tg.vz / sp : Math.cos(tg.heading ?? 0);
  const lx = fz, lz = -fx;               // (the target's left, x east / z south)
  const d = Math.hypot(tg.x - me.x, tg.z - me.z);
  if (mode === 'box') {
    const off = slot === 'ahead' ? { a: D.box.ahead, s: 0 } : { a: 0.5, s: slot === 'left' ? D.box.side : -D.box.side };
    const x = tg.x + fx * off.a + lx * off.s, z = tg.z + fz * off.a + lz * off.s, gap = Math.hypot(x - me.x, z - me.z);
    // (in its slot: a little slower than the target — the box closes; on its way: catching up)
    return { x: x + fx * 4, z: z + fz * 4, speed: gap < 3 ? Math.max(0, sp - 2.5) : sp + clamp(gap * 0.6, 2, 12) };
  }
  if (mode === 'pit') {
    const side = slot === 'left' ? 1 : -1;
    const lineUp = { x: tg.x - fx * D.pit.behind + lx * side * D.pit.side, z: tg.z - fz * D.pit.behind + lz * side * D.pit.side };
    const gap = Math.hypot(lineUp.x - me.x, lineUp.z - me.z);
    // lined up on the rear corner: turn in across it (the target's back end pushed sideways); not yet: get there
    if (gap < 2.5) return { x: tg.x + fx * 2 - lx * side * D.pit.turnIn * 3, z: tg.z + fz * 2 - lz * side * D.pit.turnIn * 3, speed: sp + 2 };
    return { x: lineUp.x + fx * 6, z: lineUp.z + fz * 6, speed: sp + clamp(gap * 0.5, 1.5, 10) };
  }
  const lead = mode === 'ram' ? D.lead * 0.5 : D.lead;
  const x = tg.x + tg.vx * lead * clamp(d / 30, 0, 1.5), z = tg.z + tg.vz * lead * clamp(d / 30, 0, 1.5);
  if (mode === 'ram') return { x, z, speed: sp + D.ramClosingKmh / 3.6 };
  // pursue: close in, then sit on its bumper
  return { x, z, speed: d > 30 ? sp + clamp((d - 30) * 0.25, 4, 20) : sp + clamp((d - 7) * 0.45, -3, 8) };
}

// the share the speed it aims for is changed by, from how far behind it is (far: up to +max; on top of the target: −max)
export function rubberBand(R, d) {
  if (!R || !R.max) return 0;
  if (d >= R.far) return R.max;
  if (d <= R.near) return -R.max;
  return -R.max + 2 * R.max * (d - R.near) / (R.far - R.near);
}

export function createPoliceDriver({ cfg, frame, car, pathTo, clear = () => true }) {
  const D = cfg.driving;
  let line = null, pilot = null, planned = -Infinity, plannedFor = null, clock = 0, slowFor = 0, backing = 0, clearAt = -1, clearNow = false;
  const U = {
    order: { mode: 'patrol', target: null, goal: null, slot: null }, target: null,
    state: { mode: 'patrol', how: 'idle', aim: null, speedWanted: 0, line: null },
    drive(vehicle, dt) {
      clock += dt;
      const b = vehicle.body, p = b.translation(), q = b.rotation(), v = b.linvel(), fw = rotate(q, [0, 0, 1]);
      const fm = Math.hypot(fw[0], fw[2]) || 1, fx = fw[0] / fm, fz = fw[2] / fm;
      const [x, z] = frame.toWorld(p.x, p.z), speed = v.x * fx + v.z * fz, me = { x, z };
      const wr = vehicle.spec.steering.maxWheelRotation, O = U.order, mode = O.mode, S = U.state;
      S.mode = mode;
      const stop = (hand = false) => ({ device: 'wheel', wheelRange: wr, steer: 0, throttle: 0, brake: Math.abs(speed) > 0.5 ? 1 : 0, handbrake: hand || Math.abs(speed) <= 0.5 });
      if (mode === 'block' || mode === 'out' || (mode === 'patrol' && !O.goal)) { S.how = 'parked'; return stop(true); }
      // (backing off: reverse — the automatic box goes into it held on the brake at a stop — steering the other way)
      if (backing > 0) { backing -= dt; S.how = 'backing off'; return { device: 'wheel', wheelRange: wr, steer: -(S.lastSteer ?? 0), throttle: 0, brake: 1, handbrake: false }; }
      const tg = U.target;
      let goal = O.goal, aim = null;
      const targeted = TARGETED.has(mode) && tg;
      if (targeted) { aim = aimFor(mode, me, tg, O.slot, D); goal = { x: tg.x, z: tg.z }; }
      else if (mode === 'leave' && !goal && line) goal = line.at(-1);
      const dGoal = goal ? Math.hypot(goal.x - x, goal.z - z) : 0;
      const rb = tg ? rubberBand(D.rubberBand, Math.hypot(tg.x - x, tg.z - z)) : 0;
      // straight for it (off the road if need be) when it's close and nothing's in the way
      if (targeted && dGoal < D.directRange) {
        if (clock - clearAt > 0.3) { clearAt = clock; clearNow = dGoal < 7 || clear(me, goal); }
      } else clearNow = false;
      let steer, want;
      if (targeted && clearNow) {
        S.how = 'direct';
        const dx = aim.x - x, dz = aim.z - z, lx = dx * fz - dz * fx, lz = dx * fx + dz * fz;
        const alpha = Math.atan2(lx, lz), Ld = Math.max(4, Math.hypot(dx, dz));
        const delta = Math.atan(2 * (vehicle.wheelbase ?? 2.6) * Math.sin(alpha) / Ld);
        steer = steerInput(vehicle, delta);
        // (no faster round the arc to the aim point than the grip holds)
        const R = Math.abs(Ld / (2 * Math.sin(alpha) || 1e-6)), corner = Math.sqrt(car.grip * D.corneringMargin * Math.max(5, R));
        want = Math.min(aim.speed * (1 + rb), corner, car.vmax);
        // (facing away: turn round first, slowly)
        if (Math.abs(alpha) > 1.9) want = Math.min(want, 8);
        S.aim = { x: aim.x, z: aim.z };
      } else if (goal) {
        // on the roads: a path to the goal, replanned now and then (or when the goal's moved on)
        const moved = plannedFor ? Math.hypot(goal.x - plannedFor.x, goal.z - plannedFor.z) : Infinity;
        if (pilot ? (clock - planned > D.replanEvery && moved > 4) || moved > D.replanMoveM : clock - planned > 0.5) {
          planned = clock; plannedFor = { ...goal };
          const l = pathTo(me, goal);
          if (l && l.length >= 2) { line = l; pilot = createAutopilot(line, { car: { ...car, vmax: car.vmax * (1 + rb) }, margin: D.corneringMargin }); S.line = line; }
        }
        if (!pilot) { S.how = 'no way'; return stop(); }
        S.how = 'road';
        const cmd = pilot.drive({ x, z, fx, fz, speed, dt });
        steer = steerInput(vehicle, cmd.steer * 0.6);
        // (at the end of the path — the goal reached: there, slowly; searching, at a search's pace)
        const left = line.at(-1).s - pilot.s;
        want = Math.min(cmd.target ?? car.vmax, left < 30 && !targeted ? Math.max(4, left * 0.4) : Infinity, mode === 'search' ? 18 : mode === 'leave' ? 14 : Infinity);
        // (after a car: no slower than it wants to close on it — the path's end is the car, not a place to stop at)
        if (targeted && aim) want = left < 40 ? Math.min(aim.speed, cmd.target > 2 ? Infinity : aim.speed) : Math.max(Math.min(want, aim.speed * 1.4 + 6), 0);
        S.aim = at(line, pilot.s + 10); S.left = left; S.pathTarget = cmd.target;
      } else { S.how = 'idle'; return stop(); }
      S.speedWanted = want; S.lastSteer = steer;
      const err = want - speed;
      // (stuck: hardly moving while it wants to go — against a wall, a building, another car)
      if (want > 3 && Math.abs(speed) < 1) slowFor += dt; else slowFor = 0;
      // (and how long it's been getting nowhere, backing off and all: the game takes away one that's hopelessly stuck)
      S.stuckFor = want > 3 && Math.abs(speed) < 1.5 ? (S.stuckFor ?? 0) + dt : Math.abs(speed) > 3 ? 0 : S.stuckFor ?? 0;
      if (slowFor > D.stuckSeconds) { slowFor = 0; backing = D.backOff; }
      const ease = Math.abs(steer) > 0.8 ? 0.65 : 1;
      return { device: 'wheel', wheelRange: wr, steer: clamp(steer, -1, 1), throttle: err > 0 ? Math.min(ease, err * 0.35 + 0.25) : 0, brake: err < -1.5 ? Math.min(1, -err * 0.2) : 0, handbrake: false };
    },
  };
  return U;
}
// (a point on a line, for the debug overlay: where it's heading)
function at(line, s) {
  let k = 0;
  while (k < line.length - 1 && line[k + 1].s < s) k++;
  return { x: line[k].x, z: line[k].z };
}
