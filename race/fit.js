// The racing line fitted to the world that's loaded (route/racingLine.js fitRacingLine): the baked line
// keeps to the mapped width, but kerbs, walls and banks inside it are only known once the world's
// colliders are there. Measured with rays against the fixed bodies only (never a car), once per
// course and world.
//
//   fittedRacing(course, sim, frame) → the course's racing line, fitted (course.racing if it can't be)

import { fitRacingLine } from '../route/racingLine.js';

const cache = new WeakMap();
export function fittedRacing(course, sim, frame) {
  const v = sim?.vehicle;
  if (!v?.world || !course?.line?.length) return course.racing;
  let byWorld = cache.get(course);
  if (!byWorld) cache.set(course, byWorld = new WeakMap());
  if (byWorld.has(v.world)) return byWorld.get(v.world);
  const R = v.R, world = v.world;
  const probe = {
    ground(x, z, h) {
      // (from 25 m above the route's height; a generated track with a crossover: just above its road —
      // under the bridge it's the road below that counts)
      const [sx, sz] = frame.toSim(x, z), top = h + (frame.probeAbove ?? 25);
      const hit = world.castRay(new R.Ray({ x: sx, y: top, z: sz }, { x: 0, y: -1, z: 0 }), 60, true, 6);
      return hit ? top - hit.timeOfImpact : null;
    },
    cast(x, y, z, dx, dz, len) {
      const [sx, sz] = frame.toSim(x, z);
      const hit = world.castRayAndGetNormal(new R.Ray({ x: sx, y, z: sz }, { x: dx, y: 0, z: dz }), len, true, 6);
      // (the road's camber isn't a wall — under 10°: anything steeper than 25°, a kerb, a bank, a ledge, an
      // underside, is)
      return hit && hit.normal.y < 0.9 ? hit.timeOfImpact : null;
    },
  };
  let rl;
  try { rl = fitRacingLine(course.line, { loop: course.loop, margin: course.racing?.margin ?? 1.1 }, probe); }
  catch { rl = course.racing; }
  byWorld.set(v.world, rl);
  return rl;
}
