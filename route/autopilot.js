// A simple driver for a route, pure: steers for a point ahead on the centreline (pure pursuit) and keeps to
// a speed the corners ahead allow (route/stats.js speedProfile, with some in hand). Used by the tests to
// drive real routes in the physics, and could drive a rival later.
//
//   const A = createAutopilot(line, { loop, car, margin, maxRoad, wheelbase })
//   A.drive({ x, z, fx, fz, speed, dt }) → { throttle, brake, steer, reverse }   (fx, fz: the car's forward, unit; steer + left)

import { at, project } from './geometry.js';
import { speedProfile, corners, STARTER_CAR } from './stats.js';

// where across the road to be: on a corner tighter than the car can turn on the centreline, wide on the
// way in, to the inside at the apex, wide on the way out (+ left of the centreline)
function racingOffsets(line, loop, tight = 8) {
  const n = line.length, o = new Float64Array(n), step = line.length > 1 ? line[1].s - line[0].s : 4;
  for (const c of corners(line, loop)) {
    if (c.radius >= tight) continue;
    const inside = c.way === 'left' ? 1 : -1, apex = c.s;
    for (let k = 0; k < n; k++) {
      const s = line[k].s, room = Math.max(0, line[k].w / 2 - 2);
      let f = 0;
      if (s >= c.from - 25 && s < c.from) f = -(s - (c.from - 25)) / 25;                 // easing out wide
      else if (s >= c.from && s <= apex) f = -1 + 1.6 * (s - c.from) / Math.max(step, apex - c.from);   // across to the apex
      else if (s > apex && s <= c.to) f = 0.6 - 1.6 * (s - apex) / Math.max(step, c.to - apex);         // and back out
      else if (s > c.to && s <= c.to + 20) f = -(1 - (s - c.to) / 20);
      if (f) o[k] = inside * room * Math.max(-1, Math.min(1, f));
    }
  }
  return o;
}

export function createAutopilot(line, { loop = false, car = STARTER_CAR, margin = 0.75, maxRoad = 0.6, wheelbase = 2.6, offset = 0 } = {}) {
  const v = speedProfile(line, { ...car, grip: car.grip * margin, brake: car.brake * margin }, loop);
  // (a standing start counts for nothing here: the car is wherever it is)
  // (and steady down a steep hill, and over a sharp crest or dip: a car goes light there)
  const grade = k => { const a = line[Math.max(0, k - 3)], b = line[Math.min(line.length - 1, k + 3)]; return (b.h - a.h) / Math.max(1, b.s - a.s); };
  const vmax = Array.from(v, (x, k) => {
    const g = grade(k), bend = Math.abs(grade(Math.min(line.length - 1, k + 3)) - grade(Math.max(0, k - 3)));
    const hill = Math.max(0.45, Math.min(1, 1 - Math.max(0, -g - 0.08) * 2.5 - bend * 2));
    return Math.min(car.vmax, (k === 0 && !loop ? Infinity : x) * hill);
  });
  if (!loop) vmax[0] = vmax[1] ?? car.vmax;
  const lane = racingOffsets(line, loop);
  let k = 0, stuckFor = 0, backing = 0, lastS = null, since = 0;
  return {
    s: 0,
    // dt: for getting unstuck — against a wall at a standstill a while, back off (steering the other way)
    drive({ x, z, fx, fz, speed, dt = 0 }) {
      // (where it is: near where it was; on a loop, either side of the join; lost, anywhere)
      const n = line.length;
      let p = project(line, x, z, { from: k - 40, to: k + 40 });
      if (loop && (k < 40 || k > n - 41)) { const q = k < 40 ? project(line, x, z, { from: n - 41 }) : project(line, x, z, { to: 40 }); if (q && (!p || q.dist < p.dist)) p = q; }
      if (!p || p.dist > 20) { const g = project(line, x, z); if (g && (!p || g.dist < p.dist)) p = g; }
      k = p.k; this.s = p.s;
      const look = 5 + 0.45 * Math.abs(speed), t = at(line, p.s + look, loop);
      // (the target to one side: where the line through the corner is, and the lane if asked)
      const side = offset + lane[t.k] + (lane[Math.min(line.length - 1, t.k + 1)] - lane[t.k]) * Math.max(0, Math.min(1, (t.s - line[t.k].s) / ((line[Math.min(line.length - 1, t.k + 1)].s - line[t.k].s) || 1)));
      const tx = t.x + t.dz * side, tz = t.z - t.dx * side;
      const dx = tx - x, dz = tz - z, lx = dx * fz - dz * fx, lz = dx * fx + dz * fz;  // left = forward turned a quarter left (z south)
      const alpha = Math.atan2(lx, lz), Ld = Math.hypot(dx, dz) || 1;
      const delta = Math.atan(2 * wheelbase * Math.sin(alpha) / Ld);
      const steer = Math.max(-1, Math.min(1, delta / maxRoad));
      // the speed for here and what's coming within braking distance
      const step = line.length > 1 ? line[1].s - line[0].s : 4, ahead = Math.ceil((speed * speed / (2 * car.brake * margin) + 10) / step);
      let target = Infinity;
      for (let j = 0; j <= ahead; j++) { const i = loop ? (k + j) % n : Math.min(n - 1, k + j); target = Math.min(target, vmax[i]); }
      const err = target - speed;
      // (the automatic box: held on the brake at a stop it goes into reverse, and the brake then drives)
      if (backing > 0) { backing -= dt; return { throttle: 0, brake: 1, steer: -steer, reverse: true, target }; }
      // (stuck: hardly any way made along the route for a few seconds while it should be going)
      if (lastS === null) lastS = p.s;
      since += dt;
      if (since >= 3) { stuckFor = Math.abs(p.s - lastS) < 2 && target > 3 ? stuckFor + since : 0; lastS = p.s; since = 0; }
      if (stuckFor >= 3) { stuckFor = 0; backing = 2; }
      // (easy on the throttle with the wheel hard over: full power on full lock just pushes the car wide)
      const ease = Math.abs(steer) > 0.8 ? 0.6 : 1;
      return { throttle: err > 0 ? Math.min(ease, err * 0.4 + 0.2) : 0, brake: err < -1 ? Math.min(1, -err * 0.25) : 0, steer, target };
    },
  };
}
