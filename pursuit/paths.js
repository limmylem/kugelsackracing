// The roads for a pursuit (docs/PURSUIT.md), pure, on the road network (route/network.js): the way a police unit
// drives to a place (any road, either way down a one-way street — it's the police), and places along the road from a
// car — ahead of it (a roadblock at the next junction, a spike strip) or behind it (where a new unit comes from).
//
//   const R = createPursuitRoads(N)
//   R.pathTo(from, to) → a line ([{ x, z, h, w, s }], 4 m apart) from near `from` to near `to` by road, or null
//   R.along({ x, z, fx, fz }, metres, { junction }) → { x, z, h, dx, dz, w, junction } metres along the road the car's on
//     (fx, fz: the way it's going; negative metres: behind), keeping as straight on as it can at each junction;
//     junction: stop at the first junction past that far (a roadblock's place)
//   R.onRoad(x, z) → the nearest road point { x, z, h, dx, dz } (a car put back on the road)

import { piecePoints, routeOptions } from '../route/build.js';
import { resample, smooth } from '../route/geometry.js';

export function createPursuitRoads(N, { maxPathM = 2500 } = {}) {
  const o = routeOptions({ reverseOneway: false, unpaved: true, motorways: true, tunnels: true });
  // (from: the car — its x, z, and the way it's facing, fx, fz: the road it's on and going along that way is preferred to
  // a nearer one it would have to turn round on: a hairpin to start with holds it to a crawl)
  const pathTo = (from, to) => {
    if (Math.hypot(to.x - from.x, to.z - from.z) > maxPathM) return null;
    const b = N.nearest(to.x, to.z, o, 250);
    if (!b) return null;
    const starts = N.candidates(from.x, from.z, o, 60, 4);
    if (!starts.length) { const a = N.nearest(from.x, from.z, o, 150); if (a) starts.push(a); }
    let best = null;
    for (const a of starts) {
      const r = N.path({ seg: a.seg, s: a.s }, { seg: b.seg, s: b.s }, o);
      if (r.error || !r.pieces?.length) continue;
      // (which way it sets off along its first road, against the way the car faces)
      const p0 = r.pieces[0], q = N.pointOn(p0.seg, p0.s0), way = p0.s1 >= p0.s0 ? 1 : -1;
      const back = from.fx != null && (q.dx * way * from.fx + q.dz * way * from.fz) < -0.3;
      const cost = r.length + a.d * 3 + (back ? 120 : 0);
      if (!best || cost < best.cost) best = { a, r, cost };
    }
    if (!best) return null;
    const { a, r } = best;
    const pts = [{ x: from.x, z: from.z, h: a.h, w: a.seg.width ?? 7 }];
    for (const p of r.pieces) pts.push(...piecePoints(N, p));
    // (the goal itself, if it's off the road: a search point, a car on a car park)
    if (Math.hypot(to.x - b.x, to.z - b.z) > 3) pts.push({ x: to.x, z: to.z, h: b.h, w: 6 });
    const line = smooth(resample(pts), 1);
    return line.length >= 2 ? line : null;
  };
  // metres along the road from a car, the way it's going (or behind it), straight on where it can
  const along = (car, metres, { junction = false } = {}) => {
    const c = N.nearest(car.x, car.z, o, 120);
    if (!c) return null;
    const back = metres < 0;
    let left = Math.abs(metres), sg = c.seg, s = c.s;
    // which way along this road is the car going
    const here = N.pointOn(sg, s);
    let fwd = here.dx * car.fx + here.dz * car.fz >= 0;
    if (back) fwd = !fwd;
    for (let hops = 0; hops < 60; hops++) {
      const room = fwd ? sg.length - s : s;
      if (room >= left && !junction) {
        const p = N.pointOn(sg, fwd ? s + left : s - left);
        return { x: p.x, z: p.z, h: p.h, dx: fwd ? p.dx : -p.dx, dz: fwd ? p.dz : -p.dz, w: sg.width ?? 7, junction: false };
      }
      left -= room;
      const node = fwd ? sg.to : sg.from, end = N.pointOn(sg, fwd ? sg.length : 0), dx = fwd ? end.dx : -end.dx, dz = fwd ? end.dz : -end.dz;
      // (a roadblock: at the first real junction once it's far enough — three roads or more)
      if (junction && N.degree[node] >= 3 && left <= 0) return { x: end.x, z: end.z, h: end.h, dx, dz, w: sg.width ?? 7, junction: true };
      // the next road: the straightest on (not back the way it came)
      let best = null, bestDot = -2;
      for (const e of N.adj[node]) {
        if (e.sg === sg || !N.usable(e.sg, o)) continue;
        const p = N.pointOn(e.sg, e.forward ? 0 : e.sg.length), ex = e.forward ? p.dx : -p.dx, ez = e.forward ? p.dz : -p.dz, dot = ex * dx + ez * dz;
        if (dot > bestDot) { bestDot = dot; best = e; }
      }
      if (!best) return { x: end.x, z: end.z, h: end.h, dx, dz, w: sg.width ?? 7, junction: false, deadEnd: true };
      // (a junction met before it's far enough, but it's wanted: the next one past)
      sg = best.sg; fwd = best.forward; s = fwd ? 0 : sg.length;
      if (junction && left < 0) left = 0;
    }
    return null;
  };
  const onRoad = (x, z) => { const c = N.nearest(x, z, o, 200); if (!c) return null; const p = N.pointOn(c.seg, c.s); return { x: c.x, z: c.z, h: c.h, dx: p.dx, dz: p.dz }; };
  return { pathTo, along, onRoad, options: o };
}
