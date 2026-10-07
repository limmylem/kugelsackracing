// A bot's car (Phase 7 Step 1; docs/MULTIPLAYER.md "Bots"): drives a route's line on its own, with no physics — a
// kinematic car that speeds up on the straights and slows for the corners (each corner's speed from its curvature
// and the grip), and gives everything a real car's state has: its pose and velocity, its spin, steering, pedals,
// gear and rpm, its wheels turning and its suspension moving, its brake lights. Headless bots fill a room for the
// tests and for trying multiplayer without other players.
//
//   const D = createRouteDriver(points, { closed, topSpeed, grip, accel, brake, offset, startAt })
//     points: [[x, y, z], …] (world frame) · offset: metres to the right of the line (bots side by side)
//   D.step(dt) → a state for codec.js (world frame)      D.distance · D.length · D.laps

const G = 9.81, WHEEL_R = 0.33, RATIOS = [3.6, 2.2, 1.55, 1.2, 0.95, 0.78], FINAL = 3.7, IDLE = 900, REDLINE = 7000;

export function createRouteDriver(points, { closed = true, topSpeed = 45, grip = 0.9, accel = 4.5, brake = 8, offset = 0, startAt = 0, wheelbase = 2.6 } = {}) {
  const P = points.map(p => [...p]), n = P.length;
  // distances along the line, and each point's tangent and curvature
  const cum = [0];
  for (let i = 1; i < n + (closed ? 1 : 0); i++) { const a = P[(i - 1) % n], b = P[i % n]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])); }
  const length = cum[cum.length - 1];
  const at = s => {
    s = closed ? ((s % length) + length) % length : Math.max(0, Math.min(length - 1e-6, s));
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const a = P[lo % n], b = P[(lo + 1) % n], u = (s - cum[lo]) / ((cum[lo + 1] - cum[lo]) || 1);
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  };
  const heading = s => { const a = at(s - 2), b = at(s + 2); return Math.atan2(b[0] - a[0], b[2] - a[2]); };
  const curvature = s => { let d = heading(s + 4) - heading(s - 4); d = Math.atan2(Math.sin(d), Math.cos(d)); return d / 8; };
  // the fastest it can take the line here: through the corner ahead, and what it can brake to in time
  const cornerSpeed = s => Math.min(topSpeed, Math.sqrt(grip * G / Math.max(1e-4, Math.abs(curvature(s)))));
  const safeSpeed = s => { let v = topSpeed; for (let d = 0; d <= 120; d += 8) v = Math.min(v, Math.sqrt(cornerSpeed(s + d) ** 2 + 2 * brake * d)); return v; };

  let s = startAt, v = 0, tick = 0, laps = 0, spin = 0, prevYaw = heading(startAt), bounce = 0;
  return {
    get distance() { return s; }, get length() { return length; }, get laps() { return laps; }, get speed() { return v; },
    step(dt) {
      tick++;
      const want = safeSpeed(s), braking = v > want + 0.5;
      const a = braking ? -brake : v < want ? accel * (1 - v / (topSpeed * 1.1)) : 0;
      v = Math.max(0, Math.min(topSpeed, v + a * dt));
      const before = s; s += v * dt;
      if (closed && Math.floor(s / length) > Math.floor(before / length)) laps++;
      const yaw = heading(s), k = curvature(s);
      let yawRate = (yaw - prevYaw); yawRate = Math.atan2(Math.sin(yawRate), Math.cos(yawRate)) / dt; prevYaw = yaw;
      // (offset to the right of the line: x right = (cos yaw, −sin yaw) for a heading measured from +z towards +x)
      const c = at(s), right = [-Math.cos(yaw), 0, Math.sin(yaw)];
      const pos = [c[0] + right[0] * offset, c[1] + 0.45, c[2] + right[2] * offset];
      const fwd = [Math.sin(yaw), 0, Math.cos(yaw)];
      const rot = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
      // the drivetrain: the highest gear that keeps the revs up, the rpm from the wheels
      const wheelRpm = v / WHEEL_R * 60 / (2 * Math.PI);
      let gear = 1; while (gear < RATIOS.length && wheelRpm * RATIOS[gear] * FINAL > 2600) gear++;
      const rpm = Math.max(IDLE, Math.min(REDLINE, wheelRpm * RATIOS[gear - 1] * FINAL));
      spin += v / WHEEL_R * dt; bounce += dt;
      const slip = Math.min(2.4, Math.abs(k) * v * v / (grip * G) * 0.6 + (braking ? 0.15 : 0));
      const wheels = ['FL', 'FR', 'RL', 'RR'].map((_, i) => ({ omega: v / WHEEL_R, length: 0.22 + 0.01 * Math.sin(bounce * 9 + i * 1.7) + (i < 2 ? 0.006 : -0.006) * (braking ? 1 : 0), slip, grounded: true }));
      return {
        tick, pos, rot, vel: [fwd[0] * v, 0, fwd[2] * v], ang: [0, yawRate, 0],
        steer: Math.max(-1, Math.min(1, Math.atan(wheelbase * k) / 0.6)), throttle: a > 0 ? Math.min(1, a / accel + 0.2) : 0, brake: braking ? Math.min(1, (v - want) / 4 + 0.4) : 0,
        gear, rpm, wheels, flags: braking ? 1 : 0,
      };
    },
  };
}

// A test loop: an oval-ish closed line round the origin (world frame), for when there's no route
export function testLoop({ radius = 120, stretch = 1.8, points = 160, centre = [0, 0, 0] } = {}) {
  return Array.from({ length: points }, (_, i) => { const a = i / points * Math.PI * 2; return [centre[0] + Math.sin(a) * radius * stretch, centre[1], centre[2] + Math.cos(a) * radius]; });
}
