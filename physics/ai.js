// AI drivers for other cars (rivals, slipstream tests, traffic later). A driver is a function
// (vehicle, dt) → that car's input for the step. They drive like a driver with a steering wheel
// (device 'wheel', straight through) with the car's own safety aids (ABS, traction and stability
// control) but none of the keyboard / gamepad steering assists.
//
// roadFollower races along a road. Before it sets off it plans a speed for every point of the road:
// what the tyres can hold round each bend on that surface (less going downhill, where some grip goes
// on holding the speed), crests (a hop, not a launch), sharp dips (so it doesn't bottom out), then the
// braking to get down to each of those in time. Driving, it steers by pure pursuit with yaw damping
// (countersteering as soon as the car turns faster than its line needs), never asks the front tyres
// for more than they can give, holds the planned speed, feeds the throttle and brakes in only as far
// as the grip left over from cornering allows, lines up straight for jumps and lands them gently, and
// puts itself back on the road if it ever gets stuck or turned round.

import { rotate } from './math.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const G = 9.81;

// No keyboard / gamepad assists (the drift assist would also let stability control allow big slides)
const useWheelAids = v => Object.assign(v.aids, { countersteer: false, steering: false, drift: false });

function steerInput(vehicle, road) {
  const St = vehicle.spec.steering, range = St.maxWheelRotation / 2 * Math.PI / 180;
  return clamp(road * St.ratio / range, -1, 1);
}

// Pure pursuit to a point (x, z): the arc from the car to it (curve, 1/m, + = left) and the road wheel
// angle that drives that arc
function pursue(vehicle, x, z) {
  const b = vehicle.body, p = b.translation(), q = b.rotation();
  const fw = rotate(q, [0, 0, 1]), lf = rotate(q, [1, 0, 0]);
  const dx = x - p.x, dz = z - p.z, lx = dx * lf[0] + dz * lf[2], lz = dx * fw[0] + dz * fw[2];
  const curve = 2 * lx / Math.max(1, lx * lx + lz * lz);
  return { curve, angle: Math.atan(vehicle.wheelbase * curve) };
}

// Direction the front axle is going, against where the car points (rad, + = left): front wheels set
// to this roll straight along (no slip angle)
function frontDirection(vehicle) {
  const b = vehicle.body, v = b.linvel(), w = b.angvel(), q = b.rotation(), fw = rotate(q, [0, 0, 1]), lf = rotate(q, [1, 0, 0]);
  const r = rotate(q, [0, 0, vehicle.wheelbase / 2]);
  const vx = v.x + w.y * r[2] - w.z * r[1], vz = v.z + w.x * r[1] - w.y * r[0];     // v + ω × r (horizontal)
  const vf = vx * fw[0] + vz * fw[2], vl = vx * lf[0] + vz * lf[2];
  return vf > 1 ? Math.atan2(vl, vf) : 0;
}

// Height of the fixed ground at (x, z), from a ray straight down (null if there's none)
function groundHeight(vehicle, x, z) {
  const R = vehicle.R, fixedOnly = c => { const p = c.parent(); return !p || p.isFixed(); };
  const hit = vehicle.world.castRay(new R.Ray({ x, y: 3000, z }, { x: 0, y: -1, z: 0 }), 6000, true, undefined, undefined, undefined, vehicle.body, fixedOnly);
  return hit ? 3000 - hit.timeOfImpact : null;
}

// The same road the other way round (points in reverse, tangents and bends flipped)
export function reverseLine(line) {
  return line.slice().reverse().map(p => ({ ...p, tx: -p.tx, tz: -p.tz, curvature: -p.curvature }));
}

// Races along a road's centre line (points with x, z, tx, tz, curvature, `step` metres apart).
// closed: a loop (else it stops at the end); speed: top speed it will do (m/s); grip: share of the
// tyres' grip it corners at; braking: share of their grip it brakes with (both a little less on loose
// surfaces like gravel and grass, which are less predictable).
export function roadFollower(line, step, { closed = true, speed = Infinity, grip = 0.95, braking = 0.8 } = {}) {
  const m = line.length, wrap = i => closed ? ((i % m) + m) % m : clamp(i, 0, m - 1);
  let idx = null, plan = null, heights = null, grips = null, jumps = null, cornerShare = null;
  let stuck = 0, backwards = 0, airborne = false, landed = 1, drift = 0;

  function makePlan(vehicle) {
    const T = vehicle.spec.tyre;
    heights = line.map(p => groundHeight(vehicle, p.x, p.z) ?? 0);
    grips = line.map(p => vehicle.surfaceAt?.(p.x, p.z)?.grip ?? 1);
    const loose = i => grips[i] < 0.9;
    cornerShare = grips.map((_, i) => loose(i) ? grip - 0.05 : grip);
    // how sharply the road bends at each point (averaged over a few metres, then the sharpest nearby,
    // so an S-bend's two halves don't cancel out)
    const avg = line.map((_, i) => { let s = 0; for (let k = -3; k <= 3; k++) s += line[wrap(i + k)].curvature; return Math.abs(s / 7); });
    const bend = i => Math.max(avg[wrap(i - 2)], avg[wrap(i - 1)], avg[i], avg[wrap(i + 1)], avg[wrap(i + 2)]);
    const kicker = new Array(m).fill(false);
    plan = line.map((p, i) => {
      // corner grip, less the braking it takes just to hold the speed going downhill
      const mu = cornerShare[i] * T.lateral.D * grips[i], down = Math.max(0, (heights[i] - heights[wrap(i + 1)]) / step);
      const lateral = Math.sqrt(Math.max(0.04 * mu * mu, mu * mu - down * down));
      let v = Math.min(speed, Math.sqrt(lateral * G / Math.max(bend(i), 1e-4)));
      // over a crest the road drops away: keep it to a hop (ground curving away at up to ~0.9 g), not
      // a launch it could land badly from; into a sharp dip, keep the squash to ~0.8 g on top of its
      // weight so it doesn't bottom out
      // (how sharply the ground curves over a couple of metres and over a few: the sharper of the two,
      // so a knife-edge crest isn't blurred away)
      const curving = n => (heights[wrap(i + n)] - 2 * heights[i] + heights[wrap(i - n)]) / (n * step) ** 2;
      const crest = Math.min(0, curving(1), curving(3)), dip = Math.max(0, curving(1), curving(3));
      if (crest < 0) v = Math.min(v, Math.sqrt(0.9 * G / -crest));
      if (dip > 0) v = Math.min(v, Math.sqrt(0.8 * G / dip));
      kicker[i] = crest < -0.012;                      // a jump it takes off from (not just a change of slope)
      return v;
    });
    // the run-up to a jump and the take-off: 1 on the ramp, fading in over the 16 m before it
    jumps = kicker.map((_, i) => { for (let k = -2; k <= 16; k++) if (kicker[wrap(i + k)]) return k <= 8 ? 1 : 1 - (k - 8) / 8; return 0; });
    if (!closed) plan[m - 1] = 0;
    // braking: from each point, slow enough to make the next one (uphill helps, downhill doesn't)
    for (let pass = 0; pass < (closed ? 2 : 1); pass++)
      for (let i = m - 2 + (closed ? 1 : 0); i >= 0; i--) {
        const j = wrap(i + 1), slope = (heights[j] - heights[i]) / step;
        const share = loose(i) || loose(j) ? braking - 0.05 : braking;
        const decel = Math.max(0.15 * G, share * T.longitudinal.D * Math.min(grips[i], grips[j]) * G + G * slope / Math.hypot(1, slope));
        plan[i] = Math.min(plan[i], Math.sqrt(plan[j] ** 2 + 2 * decel * step));
      }
  }

  const driver = (vehicle, dt = 1 / 120) => {
    if (!plan) { makePlan(vehicle); useWheelAids(vehicle); }
    const b = vehicle.body, p = b.translation(), v = b.linvel(), q = b.rotation(), T = vehicle.spec.tyre;
    const fw = rotate(q, [0, 0, 1]), lf = rotate(q, [1, 0, 0]);
    const s = v.x * fw[0] + v.z * fw[2], lat = v.x * lf[0] + v.z * lf[2];
    const d = i => (line[i].x - p.x) ** 2 + (line[i].z - p.z) ** 2;
    if (idx === null || d(idx) > 40 * 40) { idx = 0; for (let i = 1; i < m; i++) if (d(i) < d(idx)) idx = i; }
    for (let k = 0; k < 30 && d(wrap(idx + 1)) < d(idx) && (closed || idx < m - 1); k++) idx = wrap(idx + 1);
    const here = line[idx];

    // got stuck or turned round (a big spin, a crash): back on the road, facing along it
    stuck = Math.abs(s) < 1 && plan[wrap(idx + 5)] > 3 ? stuck + dt : 0;      // (not at the end of an open road)
    backwards = fw[0] * here.tx + fw[2] * here.tz < -0.3 ? backwards + dt : 0;
    if (stuck > 3 || backwards > 2) {
      const r = line[wrap(idx + 3)];
      vehicle.reset({ position: [r.x, heights[wrap(idx + 3)], r.z], headingDeg: Math.atan2(r.tx, r.tz) * 180 / Math.PI });
      stuck = backwards = 0;
      return { device: 'wheel', wheelRange: vehicle.spec.steering.maxWheelRotation, steer: 0, throttle: 0, brake: 0, handbrake: false };
    }

    // --- Steering: pure pursuit on a point further ahead the faster it goes (much further and more
    //     gently on the run-up to a jump: a correction on the ramp sets the body rocking and it takes
    //     off rolling), a little more into the bend for as long as it keeps drifting wide, and yaw
    //     damping: turning faster than the arc it wants (the rear stepping out), the wheels come back
    //     the other way (countersteer) ---
    const jumping = jumps[idx], off = Math.hypot(here.x - p.x, here.z - p.z);
    const look = clamp(5 + 0.3 * Math.abs(s), 6, 22) * (1 - jumping) + 35 * jumping + Math.max(0, off - 3);
    const target = line[wrap(idx + Math.round(look / step))], aim = pursue(vehicle, target.x, target.z);
    drift = clamp(drift + ((p.x - here.x) * here.tz - (p.z - here.z) * here.tx) * dt, -4, 4);   // (+ = left of the line)
    const damping = s > 3 ? -0.6 * vehicle.wheelbase * (vehicle.yawRate - s * aim.curve) / Math.max(s, 5) : 0;
    let road = (aim.angle - 0.015 * drift) * (1 - 0.4 * jumping) + damping;
    // no more lock than the front tyres can use: within their peak slip angle of where the front of
    // the car is going (more just scrubs, then snaps)
    const front = frontDirection(vehicle), reach = 1.2 * vehicle.peak.y;
    if (s > 5) road = clamp(road, front - reach, front + reach);

    // --- Speed: the plan half a second ahead (so braking starts on time), with the brakes pressed as
    //     hard as the slowing down needs (more going downhill) ---
    const ahead = wrap(idx + Math.round(Math.max(6, s * 0.5) / step)), want = plan[ahead];
    const slope = (heights[ahead] - heights[idx]) / Math.max(step, (ahead - idx + m) % m * step);
    const maxDecel = T.longitudinal.D * grips[idx] * G;
    let throttle = s < want - 2 ? 1 : clamp(0.35 + (want - s) * 0.4, 0, 1);
    let brake = s > want + 0.3 ? clamp((s - want) * 0.5 + Math.max(0, -slope) * G / maxDecel, 0, 1) : 0;
    if (brake > 0) throttle = 0;
    // throttle and brakes only as far as the grip left over from cornering allows (the bend's, or how
    // hard the car is actually turning if that's more), and less throttle once it's sliding
    const turning = Math.max(s * s * Math.abs(here.curvature), Math.abs(s * vehicle.yawRate));
    const cornerLoad = Math.min(1, turning / (cornerShare[idx] * T.lateral.D * grips[idx] * G));
    const leftOver = Math.max(0.2, Math.sqrt(1 - cornerLoad * cornerLoad));
    throttle = Math.min(throttle, leftOver);
    brake = Math.min(brake, Math.max(0.3, leftOver));           // (ABS keeps the wheels turning, but grip is shared)
    const slide = Math.abs(Math.atan2(lat, Math.abs(s) + 0.5));
    if (slide > 0.07) throttle *= clamp(1 - (slide - 0.07) / 0.15, 0.1, 1);

    // --- In the air: nearly off the throttle (so the rear wheels don't spin up), no brakes, wheels
    //     straight-ish; after landing, throttle and steering come back in over a moment as it settles ---
    const flying = vehicle.wheels.every(w => !w.grounded);
    if (flying) airborne = true;
    else if (airborne) { airborne = false; landed = 0; }
    landed = Math.min(1, landed + dt / 0.7);
    throttle = Math.min(throttle, flying ? 0.15 : 0.25 + 0.75 * landed);
    const steerShare = flying ? 0.3 : 0.6 + 0.4 * landed;
    return {
      device: 'wheel', wheelRange: vehicle.spec.steering.maxWheelRotation, handbrake: false,
      steer: steerInput(vehicle, road * steerShare), throttle, brake: flying ? 0 : brake,
    };
  };
  // where it's got to along the road (a point index)
  driver.progress = () => idx;
  return driver;
}

// Keeps to the straight line it started on, at up to `speed` m/s (Infinity: flat out)
export function straightLine({ speed = Infinity } = {}) {
  let origin = null, dir = null;
  return vehicle => {
    const b = vehicle.body, p = b.translation(), v = b.linvel(), fw = rotate(b.rotation(), [0, 0, 1]);
    if (!origin) { const l = Math.hypot(fw[0], fw[2]); origin = [p.x, p.z]; dir = [fw[0] / l, fw[2] / l]; useWheelAids(vehicle); }
    const along = (p.x - origin[0]) * dir[0] + (p.z - origin[1]) * dir[1] + 25, s = v.x * fw[0] + v.z * fw[2];
    return {
      device: 'wheel', wheelRange: vehicle.spec.steering.maxWheelRotation, handbrake: false,
      steer: steerInput(vehicle, pursue(vehicle, origin[0] + dir[0] * along, origin[1] + dir[1] * along).angle),
      throttle: clamp((speed - s) * 0.5, 0, 1), brake: clamp((s - speed - 2) * 0.3, 0, 1),
    };
  };
}
