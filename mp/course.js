// A course from a bare line (Phase 7 Step 2), pure: what route/model.js viewCourse makes from a stored route, made
// straight from points — for the tests' made-up circuits and the bots' lines. The race server uses viewCourse on
// the real thing (a published route, a track built from its code).
//
//   courseFromLine(points [{ x, z, h?, w? }], { loop, gridCount, spacing }) → { line, loop, length, grid, checkpoints, gates, start, finish, corridor }
//   circuit({ radius, straight, width }) → a stadium-shaped loop's points (two straights, two half circles)

import { resample } from '../route/geometry.js';
import { placeGrid, gateAt } from '../route/grid.js';
import { autoCheckpoints } from '../route/checkpoints.js';

export function courseFromLine(points, { loop = false, gridCount = 8, spacing = 300 } = {}) {
  const pts = points.map(p => ({ x: p.x, z: p.z, h: p.h ?? 0, w: p.w ?? 12 }));
  if (loop) pts.push({ ...pts[0] });
  const line = resample(pts, 4), L = line.at(-1).s;
  const grid = placeGrid(line, { count: gridCount, loop });
  const checkpoints = autoCheckpoints(line, { loop, startS: grid.startS, finishS: grid.finishS, spacing }).map((c, i) => ({ id: c.id ?? `cp${i + 1}`, s: c.s, required: true }));
  const gates = checkpoints.map(c => ({ ...gateAt(line, c.s, { loop }), id: c.id, required: true, timeExtension: 0 }));
  const start = gateAt(line, grid.startS, { loop }), finish = loop ? start : gateAt(line, grid.finishS, { loop });
  return { line, loop, length: L, grid, checkpoints, gates, start, finish, corridor: { margin: 8 } };
}

export function circuit({ radius = 80, straight = 300, width = 14, step = 4 } = {}) {
  const pts = [];
  // (anticlockwise seen from above with x east, z south: down the first straight, round, back up the other)
  for (let x = 0; x < straight; x += step) pts.push({ x, z: 0, w: width });
  for (let a = 0; a < Math.PI; a += step / radius) pts.push({ x: straight + Math.sin(a) * radius, z: radius - Math.cos(a) * radius, w: width });
  for (let x = straight; x > 0; x -= step) pts.push({ x, z: 2 * radius, w: width });
  for (let a = 0; a < Math.PI; a += step / radius) pts.push({ x: -Math.sin(a) * radius, z: radius + Math.cos(a) * radius, w: width });
  return pts;
}
