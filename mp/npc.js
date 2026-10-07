// NPCs in a multiplayer race (Phase 7 Step 2; docs/MULTIPLAYER.md "NPC fill"), pure: driven by the server, not in
// anyone's physics. Collisions between cars are off in this step (ghosts), so an NPC needs no physics: it drives
// along the route at a speed plan worked out from its corners — as fast as its cornering grip allows in each, braking
// before and accelerating after within its limits (data/multiplayer.json npc) — scaled by its skill, in a lane of its
// own (its grid slot's, eased onto the road's middle), and the room sends it to everyone like any other car.
//
//   const plan = speedPlan(line, { loop, cfg })          once per race (the same plan for every NPC)
//   const D = createNpcDriver({ line, loop, plan, slot, skill, laps, startS, finishS })
//   D.state(t) → the car's state at room time t (ms): { pos, rot, vel, ang, steer, throttle, brake, gear, rpm, wheels, flags }
//   D.go(t)    the lights went out at t: it sets off       D.finish()  it's finished (the race's tracker says): it slows
//   D.s        how far along the line it is (m)

import { at, radiusAt } from '../route/geometry.js';

const G = 9.81, WHEEL_R = 0.33;

export function speedPlan(line, { loop = false, cfg }) {
  const L = line.at(-1).s, step = 5, n = Math.max(2, Math.ceil(L / step) + 1), v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = Math.min(cfg.topSpeed, Math.sqrt(cfg.corneringG * G * Math.max(5, radiusAt(line, Math.min(L, i * step), 12, loop))));
  // (braking before each corner, then accelerating out of it: twice round a loop so the join is right)
  for (let pass = 0; pass < (loop ? 2 : 1); pass++) {
    for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[(i + 1) % n] ** 2 + 2 * cfg.brakeG * G * step));
    if (loop) v[n - 1] = Math.min(v[n - 1], v[0]);
    for (let i = 1; i < n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * cfg.accelG * G * step));
    if (loop) v[0] = Math.min(v[0], v[n - 1]);
  }
  return { step, v, length: L, at: s => { const x = (loop ? ((s % L) + L) % L : Math.max(0, Math.min(L, s))) / step, i = Math.floor(x), f = x - i; return v[Math.min(n - 1, i)] * (1 - f) + v[Math.min(n - 1, i + 1)] * f; } };
}

const yawQuat = yaw => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];

export function createNpcDriver({ line, loop = false, plan, slot, skill = 0.9, accelG = 0.45 }) {
  const L = line.at(-1).s;
  let s = slot.s, d = slot.d ?? 0, v = 0, goAt = null, lastT = null, finished = false;
  const api = {
    get s() { return s; }, get finished() { return finished; }, get speed() { return v; },
    go(t) { goAt = t; lastT = t; },
    finish() { finished = true; },
    state(t) {
      if (goAt != null && t > lastT) {
        const dt = Math.min(0.5, (t - lastT) / 1000);
        lastT = t;
        const want = finished ? 0 : plan.at(s) * skill;
        v = v < want ? Math.min(want, v + accelG * G * dt) : Math.max(want, v - 9 * dt);
        s += v * dt;
        if (loop) s = ((s % L) + L) % L; else s = Math.min(L, s);
        d *= Math.exp(-dt / 6);                      // (into the middle of its side of the road, slowly)
      }
      const p = at(line, s, loop), m = Math.hypot(p.dx, p.dz) || 1, dx = p.dx / m, dz = p.dz / m;
      const lane = Math.max(-(p.w / 2 - 1.2), Math.min(p.w / 2 - 1.2, d));
      const x = p.x + dz * lane, z = p.z - dx * lane, yaw = Math.atan2(dx, dz);
      const omega = v / WHEEL_R, gear = v < 0.5 ? 1 : Math.min(6, 1 + Math.floor(v / 11));
      const want = plan.at(s) * skill, braking = goAt != null && v > want + 0.5;
      return {
        pos: [x, (p.h ?? 0) + 0.5, z], rot: yawQuat(yaw), vel: [dx * v, 0, dz * v], ang: [0, 0, 0],
        steer: 0, throttle: goAt != null && !braking && !finished ? 0.7 : 0, brake: braking ? 0.6 : 0, gear,
        rpm: 1500 + Math.min(5500, (v % 11) / 11 * 5000 + (gear > 1 ? 1500 : 0)),
        wheels: [0, 1, 2, 3].map(() => ({ omega, length: 0.2, slip: 0, grounded: true })),
        flags: braking ? 1 : 0,
      };
    },
  };
  return api;
}
