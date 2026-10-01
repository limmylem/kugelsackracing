// Engine model, shared by the physics, the dyno and tests. Pure functions of the car spec's `engine`
// section; the engine's state (speed, fuel cut) lives in the drivetrain.
//
// The torque curve is full-throttle torque at the flywheel against rpm: what a dyno measures.
// Internal friction rises with rpm and is what's left with the throttle shut (engine braking), so a
// throttle opening t gives t × (curve + friction) − friction: full throttle = the curve, shut = −friction.

export const rpmToRad = rpm => rpm * Math.PI / 30;
export const radToRpm = w => w * 30 / Math.PI;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// Full-throttle torque (N·m) at an rpm, straight lines between the spec's points
export function curveTorque(E, rpm) {
  const c = E.torqueCurve;
  if (rpm <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (rpm <= c[i][0]) {
      const [r0, t0] = c[i - 1], [r1, t1] = c[i];
      return t0 + (t1 - t0) * (rpm - r0) / (r1 - r0);
    }
  }
  return c[c.length - 1][1];
}

// Internal friction (N·m), rising with rpm
export function frictionTorque(E, rpm) {
  const k = Math.max(0, rpm) / 1000, f = E.friction;
  return f.base + f.perKrpm * k + f.perKrpm2 * k * k;
}

// How well the engine breathes at an air density ratio (air density ÷ sea level): a naturally
// aspirated engine (induction 'natural') makes torque in proportion to the air it draws in, so it
// loses power up a mountain. Forced induction ('turbo' / 'supercharged') is left at full torque for
// now: boost control making up for thin air (up to a limit) can be added here later.
export function breathing(E, densityRatio) {
  return E.induction === 'natural' ? densityRatio : 1;
}

// Net torque at the flywheel for a throttle opening 0..1 (breath: from breathing(), 1 at sea level)
export function engineTorque(E, rpm, throttle, breath = 1) {
  const f = frictionTorque(E, rpm);
  return throttle * (curveTorque(E, rpm) * breath + f) - f;
}

// Throttle that holds a given rpm with nothing connected (just overcoming friction)
export function holdThrottle(E, rpm) {
  const f = frictionTorque(E, rpm);
  return f / (curveTorque(E, rpm) + f);
}

// Throttle for a net torque at an rpm (the inverse of engineTorque; may be outside 0..1)
export function throttleFor(E, rpm, torque, breath = 1) {
  const f = frictionTorque(E, rpm);
  return (torque + f) / (curveTorque(E, rpm) * breath + f);
}

// Throttle the idle controller opens to keep the engine at idle: enough to beat friction at idle,
// plus more the further it sags below
export function idleThrottle(E, rpm) {
  return clamp(holdThrottle(E, E.idleRpm) + E.idle.gain * (E.idleRpm - rpm), 0, E.idle.maxThrottle);
}

// Dyno sweep: full-throttle torque and power, and closed-throttle (engine braking) torque, across the revs
export function dyno(E, stepRpm = 50, breath = 1) {
  const out = [];
  for (let rpm = E.idleRpm; rpm <= E.redlineRpm + 1e-6; rpm += stepRpm) {
    const torque = engineTorque(E, rpm, 1, breath), w = rpmToRad(rpm);
    out.push({ rpm, torque, kw: torque * w / 1000, hp: torque * w / 745.7, braking: engineTorque(E, rpm, 0) });
  }
  return out;
}
