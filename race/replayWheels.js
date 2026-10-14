// A replayed car's wheels (Phase 5's recording keeps the body only: position, rotation, velocity at 20 Hz): turning by
// the distance the car rolled along its own forward since the last frame, the fronts steering by its yaw rate (a
// bicycle model, eased, at most maxSteer) — a skip back or on (a jump in time or place) starts them afresh. Pure.
//
//   const W = createReplayWheels({ radius, wheelbase })
//   W.at(id, pose, t) → { spin (rad, about the axle), steer (rad, + left) }   pose: { position, rotation: { x, y, z, w } }

export function createReplayWheels({ radius = 0.3, wheelbase = 2.6, maxSteer = 0.55, ease = 8 } = {}) {
  const cars = new Map();
  return {
    at(id, p, t) {
      const r = p.rotation, was = cars.get(id);
      // (the car's forward, +z turned by its rotation; its yaw about the world's up)
      const fx = 2 * (r.x * r.z + r.w * r.y), fy = 2 * (r.y * r.z - r.w * r.x), fz = 1 - 2 * (r.x * r.x + r.y * r.y), yaw = Math.atan2(fx, fz);
      let spin = was?.spin ?? 0, steer = was?.steer ?? 0;
      if (was && t !== was.t) {
        const dt = t - was.t, d = (p.position[0] - was.pos[0]) * fx + (p.position[1] - was.pos[1]) * fy + (p.position[2] - was.pos[2]) * fz;
        if (Math.abs(dt) < 0.5 && Math.abs(d) < 100 * Math.abs(dt) + 1) {
          spin += d / radius;
          const v = d / dt, dyaw = Math.atan2(Math.sin(yaw - was.yaw), Math.cos(yaw - was.yaw));
          const want = Math.abs(v) > 2 ? Math.max(-maxSteer, Math.min(maxSteer, Math.atan(wheelbase * (dyaw / dt) / v))) : steer;
          steer += (want - steer) * Math.min(1, Math.abs(dt) * ease);
        } else steer = 0;
      }
      cars.set(id, { t, pos: [...p.position], yaw, spin, steer });
      return { spin, steer };
    },
  };
}
