// A car in water (the boat kit: data/parts/boat): what the water does to it, pure. Four points at the corners of the
// body's floor, each pushed up by how deep it's under the surface (all of it BOAT.draft m down) — floats (spec.boat.floats:
// how many times the car's weight they hold up, fully under) keep it up; without them, the car alone (BOAT.carFloat) sinks
// slowly. The water drags against it (hard sideways, less along it) and damps its rocking. An outboard
// (spec.boat.thrust, N; topSpeed m/s) pushes it along with the throttle — the brake backs it — from below the water at
// the stern, and steers it like a rudder (the steering, -1 to 1).
//
//   waterForces({ level, pos, q, lin, ang, com, mass, g, box: { centre, halfExtents }, boat, throttle, brake, steer })
//     → { forces: [{ force, point }], torque (its rocking damped, or null), depth (m the body's floor is under), afloat, motor (0-1: the outboard running) }
// level: the water's surface height (y, the physics' frame) under the car, or null: no water.

import { add, cross, dot, rotate, scale, sub } from './math.js';

export const BOAT = { draft: 0.45, carFloat: 0.35, drag: { along: 120, across: 900, up: 1500 }, rock: 2.2, propDepth: 0.25, rudder: 0.55, reverse: 0.4 };

export function waterForces({ level, pos, q, lin, ang, com, mass, g = 9.81, box, boat = {}, throttle = 0, brake = 0, steer = 0 }) {
  const out = { forces: [], torque: null, depth: 0, afloat: false, motor: 0 };
  if (level == null) return out;
  const [hx, hy, hz] = box.halfExtents, [cx, cy, cz] = box.centre;
  const floor = cy - hy, height = BOAT.draft;
  const corners = [[hx, floor, hz], [-hx, floor, hz], [hx, floor, -hz], [-hx, floor, -hz]];
  const lift = (boat.floats > 0 ? boat.floats : BOAT.carFloat) * mass * g / 4;
  const velAt = p => add(lin, cross(ang, sub(p, com)));
  let under = 0;
  for (const c of corners) {
    const p = add(pos, rotate(q, [c[0] + cx, c[1], c[2] + cz])), d = level - p[1];
    if (d <= 0) continue;
    under++;
    const share = Math.min(1, d / height);
    // (up by how deep; its up and down damped, so it settles rather than bounces)
    const v = velAt(p);
    out.forces.push({ force: [0, lift * share - v[1] * BOAT.drag.up * share * mass / 1000, 0], point: p });
  }
  const floorY = add(pos, rotate(q, [0, floor, cz]))[1];
  out.depth = Math.max(0, level - floorY);
  if (!under) return out;
  const wet = under / 4;
  // the water against it: along the car, across it (a keel of sorts), and its rocking damped
  const fwd = rotate(q, [0, 0, 1]), left = rotate(q, [1, 0, 0]);
  const vf = dot(lin, fwd), vl = dot(lin, left), k = mass / 1000 * wet;
  out.forces.push({ force: add(scale(fwd, -vf * Math.abs(vf) * BOAT.drag.along * k / 10 - vf * BOAT.drag.along * k / 4), scale(left, -vl * BOAT.drag.across * k)), point: com });
  out.torque = scale(ang, -BOAT.rock * mass * wet);
  out.afloat = boat.floats > 0 && out.depth > 0.05;
  // the outboard: from the stern, below the surface — only in the water, only on a car that floats
  if (boat.thrust > 0 && out.afloat) {
    const stern = add(pos, rotate(q, [0, floor, cz - hz])), sternUnder = level - stern[1] > -BOAT.propDepth;
    if (sternUnder) {
      const want = throttle > 0.02 ? throttle : brake > 0.02 ? -brake * BOAT.reverse : 0;
      const top = boat.topSpeed > 0 ? boat.topSpeed : 8, room = want >= 0 ? Math.max(0, 1 - vf / top) : Math.max(0, 1 + vf / (top * BOAT.reverse));
      const push = boat.thrust * want * room;
      // (the motor turned with the steering: some of its push sideways at the stern — the stern goes the other way)
      const side = -steer * BOAT.rudder * Math.max(Math.abs(push), boat.thrust * 0.15 * Math.min(1, Math.abs(vf) / 2));
      out.forces.push({ force: add(scale(fwd, push), scale(left, side)), point: stern });
      out.motor = Math.min(1, Math.abs(want) * 0.85 + 0.15);
    }
  }
  return out;
}
