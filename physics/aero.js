// Aerodynamics. Every aero force is ½ × air density × coefficient × area × speed², using the car's
// velocity through the air (its velocity minus any wind), at the air density for its altitude:
//  - drag along the airflow, at the centre of mass;
//  - lift (+) or downforce (−) at a front and a rear point on the body (over each axle), so the
//    balance between the two ends changes the handling;
//  - installed parts (a spoiler now; splitters, diffusers, body kits later) each add their own lift
//    and drag coefficients at their socket (see parts.js).
// Sideways airflow (the car sliding) raises drag and spoils lift / downforce; another car's wake
// (slipstream, worked out by the simulation) cuts drag and a little downforce.
// All coefficients are against the car's frontal area.

import { add, dot, length, normalize, rotate, scale } from './math.js';
import { partAero } from './parts.js';

// International Standard Atmosphere (up to 11 km): air density (kg/m³) at an altitude (m above sea level)
export function airDensity(altitude) {
  const R = 287.05, g = 9.80665, lapse = 0.0065, T0 = 288.15, P0 = 101325;
  const h = Math.max(-500, Math.min(11000, altitude)), T = T0 - lapse * h;
  return P0 * (T / T0) ** (g / (R * lapse)) / (R * T);
}
export const SEA_LEVEL_DENSITY = airDensity(0);

export class Aero {
  constructor(spec, sockets) {
    this.spec = spec;
    this.sockets = sockets;
    this.parts = new Map();     // slot → { def, angle }
    this.telemetry = { frontLift: 0, rearLift: 0, partsLift: 0, drag: 0, balance: 0.5, density: SEA_LEVEL_DENSITY, altitude: 0, sideways: 0, slipstream: 0, arrows: [] };
  }

  // Active parts (a wing that sets its own angle: aero.active) move towards the angle for what the car's
  // doing — an air brake under hard braking at speed, steep in a bend (past turnG sideways) or slow,
  // flat for less drag on a straight at speed — at rate degrees a second. state: { speed (m/s),
  // latG (g sideways), brake (pedal 0–1) }
  activate(dt, { speed, latG, brake }) {
    for (const [, p] of this.parts) {
      const A = p.def.aero?.active;
      if (!A) continue;
      const target = brake > 0.5 && speed > 20 ? A.braking : latG > (A.turnG ?? 0.25) || speed < 20 ? A.corner : A.straight;
      const now = p.angle ?? A.corner, step = (A.rate ?? 40) * dt;
      p.angle = now + Math.max(-step, Math.min(step, target - now));
    }
  }

  // Forces for this step. car: { q (rotation), pos (body origin), com, velocity, up, fwd, left },
  // air: { altitude (m above sea level), wind (world m/s), slipstream: { drag, downforce, amount } }.
  // Returns [{ force, point }] (world frame) and updates this.telemetry.
  forces(car, air) {
    const A = this.spec.aero, density = airDensity(air.altitude);
    const v = add(car.velocity, scale(air.wind, -1)), speed = length(v);
    const T = this.telemetry;
    Object.assign(T, { density, altitude: air.altitude, slipstream: air.slipstream.amount, frontLift: 0, rearLift: 0, partsLift: 0, drag: 0, sideways: 0, arrows: [] });
    if (speed < 0.5) return [];
    const q = 0.5 * density * speed * speed * A.frontalArea;   // dynamic pressure × reference area
    // how sideways the air hits the body: sin² of the angle between the airflow and the heading
    const vf = dot(v, car.fwd), vs = dot(v, car.left), sideways = vs * vs / (vf * vf + vs * vs || 1);
    T.sideways = sideways;
    const out = [];

    // drag: body + parts, more when the air comes from the side, less in a slipstream
    let cd = A.dragCoefficient;
    for (const [, p] of this.parts) cd += partAero(p.def, p.angle, this.sockets).drag;
    cd *= (1 + (A.sideways.dragFactor - 1) * sideways) * (1 - air.slipstream.drag);
    const drag = scale(normalize(v), -q * cd);
    out.push({ force: drag, point: car.com, kind: 'drag' });
    T.drag = q * cd;

    // lift / downforce at points on the body (sideways air spoils it; dirty air takes some downforce)
    const liftScale = 1 - A.sideways.liftLoss * sideways;
    const vertical = (coefficient, localPoint, kind) => {
      let c = coefficient * liftScale;
      if (c < 0) c *= 1 - air.slipstream.downforce;
      const F = q * c, point = add(car.pos, rotate(car.q, localPoint));
      out.push({ force: scale(car.up, F), point, kind });
      return F;
    };
    T.frontLift = vertical(A.front.liftCoefficient, A.front.point, 'front');
    T.rearLift = vertical(A.rear.liftCoefficient, A.rear.point, 'rear');
    for (const [, p] of this.parts) {
      const pa = partAero(p.def, p.angle, this.sockets);
      const F = vertical(pa.lift, pa.point, 'part');
      T.partsLift += F;
      // a part's lift counts toward the end of the car it sits at
      if (pa.point[2] >= 0) T.frontLift += F; else T.rearLift += F;
    }
    // balance: the front's share of the aero load (of the downforce, or of the lift if the car makes
    // lift overall); mixed = one end lifts while the other is pressed down
    const total = T.frontLift + T.rearLift;
    T.balance = Math.abs(total) > 1 ? T.frontLift / total : 0.5;
    T.mixed = T.frontLift * T.rearLift < 0;
    T.arrows = out.map(o => ({ kind: o.kind, point: o.point, force: o.force }));
    return out;
  }
}
