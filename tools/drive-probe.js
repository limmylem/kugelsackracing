// Development aid for the real world (index.html): drive the physics car from the browser console
// without waiting for the screen, and measure how it went. The page's own render loop is paused while
// it drives (the physics steps at 60 Hz, in real time, so the map and the collision stream in as they
// would), and resumed after.
//
//   const probe = await import('/tools/drive-probe.js')
//   await probe.placeAt(40.7545, -73.9657, 29)                     // put the car on a road, heading 29°
//   const run = await probe.drive({ seconds: 30, route })          // full throttle (route: [[lat, lon], …] to steer along)
//   probe.summary(run)                                             // top speed, wheels off the ground, kicks, holds

import { chunkAt } from '../realworld/chunks.js';

const g = () => window.game, DEG = 180 / Math.PI;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let busy = false;

// The car at a place (degrees), heading a compass bearing (degrees), set down on the collision there
// (from above: on the top surface, so on a bridge rather than under it when `onTop`)
export async function placeAt(lat, lon, bearing, { name = 'probe', onTop = false } = {}) {
  const G = g();
  G.goTo(lat, lon, name);                                  // (clears the old place; its own placing waits for the screen)
  await sleep(50);
  Object.assign(G.car, { lat: lat / DEG, lon: lon / DEG });
  const t0 = performance.now(), here = chunkAt(lat, lon).key;
  while (performance.now() - t0 < 120000 && !G.ground.loaded.has(here)) { G.ground.update(lat, lon); await sleep(100); }
  const chunk = G.ground.loaded.get(here);
  if (!chunk) throw new Error('the collision here never came');
  G.physics.place(lat / DEG, lon / DEG, chunk.frame.height + (onTop ? 40 : 0), bearing / DEG);
  let now = performance.now();
  for (let i = 0; i < 900 && (G.physics.holding || G.ground.status.pieces); i++) { G.ground.update(lat, lon); now += 1000 / 60; G.physics.update(now, 1 / 60, true); await sleep(15); }
  return { holding: G.physics.holding, provisional: chunk.provisional, ground: G.ground.status, ms: Math.round(performance.now() - t0) };
}

// Steering along a route: the heading error (degrees, + means turn right) to a point a little way
// along the route ahead of the car, and how far the car is off it (m)
export function steerFor(route, lat, lon, bearing, speed) {
  const m = 111320, mx = m * Math.cos(lat / DEG), P = route.map(([a, b]) => [(b - lon) * mx, (a - lat) * m]);
  let best = null;
  for (let i = 1; i < P.length; i++) {
    const [ax, ay] = P[i - 1], [bx, by] = P[i], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)), d = Math.hypot(ax + dx * t, ay + dy * t);
    if (!best || d < best.d) best = { i, t, d };
  }
  let ahead = Math.max(12, speed * 0.9), i = best.i, x = P[i - 1][0] + (P[i][0] - P[i - 1][0]) * best.t, y = P[i - 1][1] + (P[i][1] - P[i - 1][1]) * best.t;
  while (i < P.length && ahead > 0) {
    const seg = Math.hypot(P[i][0] - x, P[i][1] - y);
    if (seg >= ahead) { x += (P[i][0] - x) * ahead / seg; y += (P[i][1] - y) * ahead / seg; ahead = 0; } else { ahead -= seg; x = P[i][0]; y = P[i][1]; i++; }
  }
  let err = Math.atan2(x, y) * DEG - bearing;
  while (err > 180) err -= 360; while (err < -180) err += 360;
  return { err, off: best.d, end: i >= P.length };
}

// Full throttle (and optional braking from `brakeAt` seconds) for `seconds`, steering along `route` if
// given (as a steering wheel would: pure pursuit, straight into the car's controls). Returns a log every
// 0.1 s: speed, wheels on the ground, height, the biggest vertical kick (m/s², from one physics frame to
// the next), whether it's being held, how far off the route, the chunk it's on
export async function drive({ seconds = 30, route = null, brakeAt = null, throttle = 1, maxKmh = Infinity } = {}) {
  if (busy) throw new Error('already driving');
  busy = true;
  const G = g(), v = G.physics.sim.vehicle, input = G.physics.input, spec = G.physics.spec, log = [];
  const lock = (spec.steering.maxWheelRotation / 2) / spec.steering.ratio / DEG;       // front wheels' full lock (rad)
  const ctl = { device: 'wheel', steer: 0, throttle, brake: 0, clutch: 0, handbrake: false, wheelRange: spec.steering.maxWheelRotation, pressed: [], padName: 'probe' };
  const { poll, stepInput } = input;
  input.poll = () => ({ ...ctl, pressed: [] });
  input.stepInput = frame => ({ ...frame });
  G.viewer.useDefaultRenderLoop = false;
  let lastVy = null;
  const start = performance.now();
  let now = start;
  try {
    for (let t = 0; t < seconds; t += 0.1) {
      if (brakeAt !== null && t >= brakeAt) { ctl.throttle = 0; ctl.brake = 1; }
      let kick = 0, off = null;
      for (let s = 0; s < 6; s++) {
        const speed = Math.abs(v.forwardSpeed());
        if (brakeAt === null) ctl.throttle = speed * 3.6 > maxKmh ? 0 : throttle;
        if (route) {
          const st = steerFor(route, G.car.lat * DEG, G.car.lon * DEG, G.car.bearing * DEG, speed), ahead = Math.max(12, speed * 0.9);
          off = st.off;
          ctl.steer = -Math.max(-1, Math.min(1, Math.atan(2 * 2.5 * Math.sin(st.err / DEG) / ahead) / lock));   // (a wheel turned right reads negative)
        }
        now += 1000 / 60;
        const pose = G.physics.update(now, 1 / 60, true);
        if (pose) Object.assign(G.car, { lat: pose.lat, lon: pose.lon, height: pose.height, bearing: pose.bearing, v: pose.speed });
        const vy = v.body.linvel().y;
        if (lastVy !== null) kick = Math.max(kick, Math.abs(vy - lastVy) * 60);
        lastVy = vy;
      }
      const lat = G.car.lat * DEG, lon = G.car.lon * DEG;
      G.ground.update(lat, lon);
      const chunk = G.ground.loaded.get(chunkAt(lat, lon).key);
      log.push({ t: +t.toFixed(1), kmh: Math.round(v.forwardSpeed() * 3.6), grounded: v.wheels.filter(w => w.grounded).length, y: +v.body.translation().y.toFixed(2),
        kick: +kick.toFixed(1), held: G.physics.holding, lat: +lat.toFixed(6), lon: +lon.toFixed(6), off: off === null ? null : +off.toFixed(1), chunk: chunk ? (chunk.provisional ? 'terrain only' : 'full') : 'none' });
      await sleep(Math.max(0, start + (t + 0.1) * 1000 - performance.now()));
    }
  } finally {
    input.poll = poll; input.stepInput = stepInput;
    G.viewer.useDefaultRenderLoop = true;
    busy = false;
  }
  return log;
}

export const summary = L => ({
  seconds: L.length / 10, topKmh: Math.max(...L.map(r => r.kmh)), endKmh: L.at(-1).kmh,
  notAllWheels: L.filter(r => r.grounded < 4).length / 10, noWheels: L.filter(r => r.grounded === 0).length / 10, held: L.filter(r => r.held).length / 10,
  worstKick: Math.max(...L.map(r => r.kick)), maxOff: Math.max(0, ...L.map(r => r.off ?? 0)),
  kicks: L.filter(r => r.kick > 15).map(r => ({ t: r.t, kmh: r.kmh, kick: r.kick, wheels: r.grounded, at: [r.lat, r.lon], chunk: r.chunk })),
  end: L.at(-1),
});
