// The crash test (the test worlds' tool, and the tests): where to put the car so it hits the test
// centre's wall, barrier or guardrail (scenes/test_centre.json tests.crash) at a chosen speed —
// front first, reversing into it (rear), or sliding in side-on (side: its left side), angleDeg off
// square — its nearest point a short run-up short of it, already going at that speed toward it.
//
// placeForCrash(sim, kmh, target, { side, angleDeg }) puts the car there (the gearbox in neutral for a
// reverse or side-on hit, so the engine isn't dragged backwards or sideways).

const DEG = Math.PI / 180;

export function crashPlacement(track, spec, kmh, target = 'wall', { side = 'front', angleDeg = 0 } = {}) {
  const C = track.tests.crash, t = C[target], v = kmh / 3.6;
  if (!t) throw new Error(`no crash test target "${target}": wall, barrier or guardrail`);
  if (target === 'guardrail') {
    const h = (-(t.angleDeg ?? 4) + angleDeg) * DEG;
    return { position: [t.face[0] + 0.95, 0, t.face[1]], headingDeg: h / DEG, velocity: [Math.sin(h) * v, 0, Math.cos(h) * v], neutral: false };
  }
  // (the face runs along x at z = face[1]; the car comes from the south, going +z)
  const h = ({ front: 0, rear: 180, side: -90 }[side] ?? 0) * DEG + angleDeg * DEG;
  const bc = spec.bodyCollider, [hx, , hz] = bc.halfExtents, cz = bc.centre[2];
  const fwd = [Math.sin(h), Math.cos(h)], left = [Math.cos(h), -Math.sin(h)];
  // how far the car reaches toward +z from its origin (the box's corners, turned)
  const reach = Math.max(...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => left[1] * a * hx + fwd[1] * (cz + b * hz)));
  const gap = Math.min(C.gap, Math.max(0.3, v * (side === 'side' ? 0.1 : 0.2)));
  const dir = side === 'front' ? fwd : side === 'rear' ? [-fwd[0], -fwd[1]] : [0, 1];
  return { position: [t.face[0], 0, t.face[1] - gap - reach], headingDeg: h / DEG, velocity: [dir[0] * v, 0, dir[1] * v], neutral: side !== 'front' };
}

export function placeForCrash(sim, kmh, target, opts = {}) {
  const at = crashPlacement(sim.track, sim.vehicle.spec, kmh, target, opts), v = sim.vehicle;
  sim.resetCar({ position: at.position, headingDeg: at.headingDeg, speed: at.neutral ? 0 : kmh / 3.6 });
  if (at.neutral) {
    const b = v.body, h = at.headingDeg * DEG, forward = at.velocity[0] * Math.sin(h) + at.velocity[2] * Math.cos(h);
    b.setLinvel({ x: at.velocity[0], y: 0, z: at.velocity[2] }, true);
    for (const w of v.wheels) w.omega = forward / v.spec.wheels.radius;
    Object.assign(v.drivetrain, { gear: 0, clutch: 0, clutchLocked: false });
    v.held = false;
  }
  return at;
}
