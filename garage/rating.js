// Performance rating: a number from 100 to 999 and a class (data/classes.json), from quick estimates of
// what the Step 6 tests measure, worked out from the physics spec in a few milliseconds (no physics
// engine), so it can be redone whenever the build changes:
//  - acceleration: 0–100 km/h, a one-dimensional run through the gears: the engine's torque curve
//    through the gearing, as much as the driven tyres can put down (their grip on the load they carry,
//    with weight shifting back as the car accelerates), less drag and rolling resistance, with the
//    engine and wheels to spin up and a pause at each shift
//  - top speed: as the totals estimate it (the fastest speed some gear still pulls)
//  - cornering grip: the tyres' sideways grip, plus the downforce at 120 km/h, less a share for the
//    weight moving onto the outside tyres (more for a higher centre of mass on a narrower track), and
//    less again for underdamped suspension (worn dampers: the body bounces the tyres off their best)
//  - braking: 100–0 km/h, the tyres' grip or the brakes' torque, whichever gives out first, longer for
//    brakes that fade early (worn: they won't last a lap of hard stops)
// Each estimate scores 0–1 between its worst and best (classes.ranges), the scores are weighted
// (classes.weights) and the sum maps onto 100–999.

import { engineTorque } from '../physics/engine.js';
import { angleScale } from '../physics/parts.js';
import { SEA_LEVEL_DENSITY } from '../physics/aero.js';

const G = 9.81, rpm = w => w * 30 / Math.PI;

export function performance(spec, geometry, config, topSpeed) {
  const e = estimate(spec, geometry, topSpeed);
  const r = config.ranges, w = config.weights;
  const score = (x, { worst, best }) => Math.min(1, Math.max(0, (x - worst) / (best - worst)));
  const scores = { acceleration: score(e.zeroTo100, r.acceleration), topSpeed: score(e.topSpeed, r.topSpeed), grip: score(e.grip, r.grip), braking: score(e.braking, r.braking) };
  const total = Object.entries(scores).reduce((a, [k, s]) => a + s * w[k], 0) / Object.values(w).reduce((a, b) => a + b, 0);
  const index = Math.round(100 + 899 * total);
  const cls = config.classes.filter(c => index >= c.from).pop()?.class ?? config.classes[0].class;
  return { index, class: cls, estimates: e, scores };
}

// The estimates themselves: { zeroTo100 (s), topSpeed (km/h), grip (g), braking (m) }. geometry:
// { wheelbase, track, frontAxle (z of the front axle), comHeight (the centre of mass above the ground) }
export function estimate(spec, geometry, topSpeed) {
  const m = spec.mass, W = spec.wheels, r = W.radius, A = spec.aero, T = spec.tyre;
  const drag = (v, extra = 0) => 0.5 * SEA_LEVEL_DENSITY * (A.dragCoefficient + extra) * A.frontalArea * v * v;
  let partDrag = 0, partDown = 0;
  for (const a of spec.aeroParts || []) { const k = angleScale(a.part.aero, a.angle); partDrag += a.part.aero.dragCoefficient * k; partDown += -a.part.aero.liftCoefficient * k; }
  const lift = -(A.front.liftCoefficient + A.rear.liftCoefficient) + partDown;         // downforce coefficient (+ down)
  // the weight on each axle, from where the centre of mass is between them
  const geo = geometry, frontShare = (spec.centreOfMass[2] - (geo.frontAxle - geo.wheelbase)) / geo.wheelbase, rearShare = 1 - frontShare;

  // --- acceleration: 0–100 km/h ---
  // (the driven wheels: the rear, the front, or all four — a part-time 4WD launches in the mode it starts in)
  const GB = spec.gearbox, E = spec.engine, eff = spec.drivetrain.efficiency, layout = spec.drivetrain.layout;
  const driven = layout === 'FWD' ? 'front' : layout === 'AWD' || (layout === '4WD' && spec.transferCase?.mode && spec.transferCase.mode !== '2H') ? 'all' : 'rear';
  const muX = T.longitudinal.D, rolling = T.rollingResistance * m * G;
  const wheelInertia = 4 * W.inertia, engineInertia = E.inertia;
  let v = 0.5, t = 0, gear = 1;
  const dt = 0.01, shift = GB.shiftTime ?? 0.2, upAt = Math.min(E.redlineRpm, GB.auto?.upFull ?? E.redlineRpm) - 100;
  while (v < 100 / 3.6 && t < 60) {
    const total = GB.ratios[gear - 1] * GB.finalDrive;
    let rev = rpm(v / r * total);
    if (rev > upAt && gear < GB.ratios.length) { gear++; t += shift; continue; }
    rev = Math.max(rev, 3000);                              // (launch: the clutch slips the engine up to its torque)
    const drive = engineTorque(E, rev, 1) * total * eff / r;
    const a0 = drive / m;
    // the driven axle's load, with weight shifting back as it accelerates
    const transfer = m * a0 * geo.comHeight / geo.wheelbase;
    const load = driven === 'all' ? m * G : driven === 'rear' ? rearShare * m * G + transfer : frontShare * m * G - transfer;
    const traction = muX * 0.95 * Math.max(0, load);
    const force = Math.min(drive, traction) - drag(v, partDrag) - rolling;
    const massEff = m + (wheelInertia + engineInertia * total * total) / (r * r);
    v += force / massEff * dt; t += dt;
  }
  const zeroTo100 = t;

  // --- cornering: the tyres' sideways grip, the downforce at 120 km/h, the weight going to the outside ---
  const vc = 120 / 3.6, down = 0.5 * SEA_LEVEL_DENSITY * lift * A.frontalArea * vc * vc;
  const transferLoss = 0.03 * (geo.comHeight / 0.45) * (1.48 / geo.track);
  const S = spec.suspension, corner = m / 4, zeta = S.damping / (2 * Math.sqrt(S.stiffness * corner));
  const bounce = 0.12 * Math.max(0, (0.45 - zeta) / 0.45);
  // (anti-roll bars: less body roll, less of the tyres' camber lost to it — a little more grip)
  const bars = (S.antiRoll?.front ?? 0) + (S.antiRoll?.rear ?? 0), roll = bars ? 1 + 0.03 * bars / (bars + 2 * S.stiffness) : 1;
  const grip = T.lateral.D * (1 + down / (m * G)) * (1 - transferLoss) * (1 - bounce) * roll;

  // --- braking: 100–0 km/h, tyres or brakes, whichever gives out first ---
  const B = spec.brakes, P = B.maxPressureBar * 1e5;
  const torque = end => 2 * end.padMu * P * end.pistonArea * end.discRadius;
  const brakeForce = 2 * (torque(B.front) + torque(B.rear)) / r;
  const decel = Math.min(muX * 0.92 * G, brakeForce / m);
  const fade = 1 + 0.4 * Math.max(0, (250 - B.fade.startTemp) / 250);
  const vb = 100 / 3.6, braking = vb * vb / (2 * decel) * fade;

  return { zeroTo100, topSpeed: topSpeed ?? null, grip, braking };
}
