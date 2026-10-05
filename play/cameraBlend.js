// Smooth camera moves between a quest's views (Phase 4 Step 5 polish): free roam (the game's own chase
// camera) → the intro's fly-along → the race (the chase camera again, on the grid) → the results (a slow
// orbit round the car) → free roam. Each change of view glides from where the camera was to the new view
// over a moment, eased in and out, the new view still moving as it goes (so the car never jumps out
// from under the camera). Pure: poses in, a pose out — the game sets its camera from it.
//
//   const B = createCameraBlend(times)    times: { default, cut, [from>to]: seconds } (data/quests.json camera.transitions)
//     cut: metres — a new view further than this from the camera is cut to, not glided to (a restart from
//     the finish back to the start: no swoop across the map)
//   B.view(source, pose, dt) → pose        source: 'roam' | 'intro' | 'race' | 'results'; pose: { p: [x,y,z], look: [x,y,z], fov }
//   B.blending   B.source   B.reset()      orbitPose(car, t, cfg) → the results' view round the car

const clamp01 = x => Math.min(1, Math.max(0, x));
const smooth = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export const DEFAULT_TIMES = { cut: 400, default: 0.9, 'roam>intro': 1.1, 'intro>race': 1.2, 'race>results': 1.4, 'results>roam': 1, 'results>race': 0.8, 'roam>race': 0.6 };

export function createCameraBlend(times = DEFAULT_TIMES) {
  const T = { ...DEFAULT_TIMES, ...times };
  let source = null, from = null, last = null, t = 0, len = 0;
  return {
    get source() { return source; },
    get blending() { return from != null && t < len; },
    reset() { source = null; from = null; last = null; t = 0; len = 0; },
    view(next, pose, dt) {
      if (next !== source) {
        // (the first view: straight there; a change: glide from the camera as it was last drawn)
        if (source != null && last && Math.hypot(...pose.p.map((v, k) => v - last.p[k])) <= T.cut) { from = last; t = 0; len = T[`${source}>${next}`] ?? T.default; }
        else from = null;
        source = next;
      }
      let out = pose;
      if (from && len > 0) {
        t += dt;
        const k = smooth(clamp01(t / len));
        out = { p: lerp3(from.p, pose.p, k), look: lerp3(from.look, pose.look, k), fov: lerp(from.fov ?? pose.fov, pose.fov ?? from.fov, k) };
        if (k >= 1) from = null;
      }
      last = { p: [...out.p], look: [...out.look], fov: out.fov };
      return out;
    },
  };
}

// The results' camera: circling the car slowly, a little above it, looking at it
// car: { x, y, z, heading (degrees) }, t: seconds since the results began
export function orbitPose(car, t, { radius = 8.5, height = 2.6, speed = 0.18, start = 35, fov = 50 } = {}) {
  const a = (car.heading + start) * Math.PI / 180 + t * speed;
  return { p: [car.x + Math.sin(a) * radius, car.y + height, car.z + Math.cos(a) * radius], look: [car.x, car.y + 0.7, car.z], fov };
}
