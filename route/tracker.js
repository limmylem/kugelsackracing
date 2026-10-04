// Following a car round a route, pure (no game in here: it's fed the car's place and velocity each frame):
// how far along it is, the checkpoints passed in order (a later one before the next is "missed"), laps, the
// finish, the corridor (the road's width and a margin: out of it a while → "Return to route", longer → reset
// to the last checkpoint or reset point passed) and going the wrong way.
//
//   const T = createTracker({ line, loop, startS, finishS, checkpoints, laps, corridor, resetSpacing })
//   T.begin(x, z)  where the car is (its grid slot)      T.start()  the clock runs (the lights go green)
//   T.update(dt, { x, z, vx, vz }) → events [{ type: 'start' | 'checkpoint' | 'missed' | 'lap' | 'finish' |
//        'leave' | 'return' | 'reset' | 'wrongway' | 'rightway', … }]
//   T.state  { time, lap, laps, next, total, finished, s, d, progress, offRoute, offFor, wrongWay, splits, bonus }
//   T.resetPoint() → { x, z, h, heading, s, u }   T.resetTo(point)  after the car's been put there

import { at, project } from './geometry.js';
import { headingOf } from './grid.js';

export const CORRIDOR = { margin: 8, warnAfter: 1, resetAfter: 5, wrongAfter: 1.5, wrongSpeed: 4, resetSpacing: 250, jump: 40 };

export function createTracker({ line, loop = false, startS = 0, finishS = null, checkpoints = [], laps = 1, corridor = {}, resetSpacing = CORRIDOR.resetSpacing }) {
  const C = { ...CORRIDOR, ...corridor }, L = line.at(-1).s, end = finishS ?? L;
  laps = loop ? Math.max(1, laps | 0) : 1;
  const rel = s => loop ? (((s - startS) % L) + L) % L : s - startS;
  const cps = checkpoints.filter(c => (loop || (c.s > startS && c.s < end))).map(c => ({ ...c, r: rel(c.s) })).sort((a, b) => a.r - b.r);
  const required = cps.filter(c => c.required !== false);
  // (everything along the race as distances from the start line, lap after lap: u)
  const lapLength = loop ? L : end - startS;
  const resets = [];
  for (let r = resetSpacing; r < lapLength - 20; r += resetSpacing) resets.push(r);
  for (const c of cps) resets.push(c.r);
  resets.sort((a, b) => a - b);
  const S = { time: 0, running: false, lap: 0, laps, next: 0, total: required.length, finished: false, s: 0, d: 0, u: 0, k: 0, progress: 0, offRoute: false, offFor: 0, wrongWay: false, wrongFor: 0, splits: [], lapTimes: [], bonus: [], extension: 0, lastReset: null, missed: null, started: false };
  const reach = k => line[Math.max(0, Math.min(line.length - 1, k))];

  // the nearest point of the line near index k — where the route runs along the same road twice (out and
  // back), the pass the car's going the way of, and the one nearest where it was
  function nearHere(x, z, vx, vz, from, to) {
    let best = null;
    const speed = Math.hypot(vx, vz);
    for (let k = Math.max(0, from); k < Math.min(line.length - 1, to); k++) {
      const a = line[k], b = line[k + 1], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2)), px = a.x + dx * t, pz = a.z + dz * t, dist = Math.hypot(x - px, z - pz);
      const against = speed > 1 && (vx * dx + vz * dz) < 0 ? 6 : 0, score = dist + against + Math.abs(k - S.k) * 0.02;
      if (!best || score < best.score) best = { score, dist, k, t, s: a.s + (b.s - a.s) * t, x: px, z: pz, dx, dz };
    }
    if (!best) return null;
    const m = Math.hypot(best.dx, best.dz) || 1;
    best.d = (x - best.x) * best.dz / m - (z - best.z) * best.dx / m;
    best.w = line[best.k].w;
    return best;
  }
  function locate(x, z, vx = 0, vz = 0) {
    // near where it was, then (if it's not there) anywhere
    let p = nearHere(x, z, vx, vz, S.k - 60, S.k + 60);
    let jumped = false;
    if (!p || p.dist > reach(p.k).w / 2 + C.margin) {
      const g = project(line, x, z);
      if (g && (!p || g.dist < p.dist - 5)) { jumped = !p || Math.abs(g.s - p.s) > C.jump; p = g; }
    }
    if (loop && p && (p.k < 60 || p.k > line.length - 60)) {
      // (round the end of a loop: either side of the join)
      const q = p.k < 60 ? project(line, x, z, { from: line.length - 60 }) : project(line, x, z, { to: 60 });
      if (q && q.dist < p.dist) p = q;
    }
    return { p, jumped };
  }
  function moveTo(x, z, vx, vz) {
    const { p, jumped } = locate(x, z, vx, vz);
    const prevS = S.s;
    S.k = p.k; S.s = p.s; S.d = p.d;
    let delta = p.s - prevS;
    if (loop) { if (delta > L / 2) delta -= L; if (delta < -L / 2) delta += L; }
    return { p, delta, jumped: jumped || Math.abs(delta) > C.jump };
  }

  const api = {
    state: S, checkpoints: cps, required,
    begin(x, z) {
      const g = project(line, x, z);
      S.k = g.k; S.s = g.s; S.d = g.d;
      // (behind the start line: a little below zero)
      S.u = loop ? (rel(g.s) > L / 2 ? rel(g.s) - L : rel(g.s)) : g.s - startS;
      S.lastReset = { u: Math.min(0, S.u) };
      return api;
    },
    start() { S.running = true; return api; },
    update(dt, car) {
      const ev = [];
      if (S.finished) return ev;
      if (S.running) S.time += dt;
      const { p, delta, jumped } = moveTo(car.x, car.z, car.vx ?? 0, car.vz ?? 0);
      const u0 = S.u, u1 = S.u + delta;
      S.u = u1;
      const crossed = (target, inGate = true) => !jumped && u0 < target && u1 >= target && inGate;
      const base = S.lap * lapLength;
      if (!S.started && crossed(0)) { S.started = true; ev.push({ type: 'start', time: S.time }); }
      // checkpoints: the next required one, in order; a later one first means the next was missed
      for (let i = 0; i < cps.length; i++) {
        const c = cps[i], target = base + c.r, half = (c.width ?? reach(p.k).w + 4) / 2;
        if (!crossed(target)) continue;
        if (Math.abs(S.d) > half + 1) { ev.push({ type: 'outside', checkpoint: c.id }); continue; }
        S.lastReset = { u: target };
        if (c.required === false) { if (!S.bonus.includes(`${S.lap}:${c.id}`)) { S.bonus.push(`${S.lap}:${c.id}`); S.extension += c.timeExtension ?? 0; ev.push({ type: 'checkpoint', bonus: true, id: c.id, time: S.time, extension: c.timeExtension ?? 0 }); } continue; }
        const n = required.indexOf(c);
        if (n === S.next) { S.next++; S.splits.push(S.time); S.extension += c.timeExtension ?? 0; S.missed = null; ev.push({ type: 'checkpoint', id: c.id, number: n + 1, of: required.length, time: S.time, extension: c.timeExtension ?? 0 }); }
        else if (n > S.next && S.missed !== S.next) { S.missed = S.next; ev.push({ type: 'missed', number: S.next + 1, message: `Missed checkpoint ${S.next + 1}: go back through it.` }); }
      }
      // reset points passed (only driven past, not jumped to)
      for (const r of resets) if (crossed(base + r)) S.lastReset = { u: base + r };
      // the line: a lap, or the finish
      if (crossed(base + lapLength)) {
        if (S.next < required.length) { if (S.missed !== S.next) { S.missed = S.next; ev.push({ type: 'missed', number: S.next + 1, message: `Missed checkpoint ${S.next + 1}: go back through it.` }); } }
        else {
          S.lapTimes.push(S.time - (S.lapTimes.reduce((a, b) => a + b, 0)));
          S.lap++; S.next = 0; S.missed = null;
          if (S.lap >= laps) { S.finished = true; S.running = false; ev.push({ type: 'finish', time: S.time, laps: S.lap, lapTimes: S.lapTimes.slice() }); }
          else ev.push({ type: 'lap', lap: S.lap, of: laps, time: S.time, lapTime: S.lapTimes.at(-1) });
        }
      }
      S.progress = Math.max(0, Math.min(1, (S.u) / (lapLength * laps)));
      // the corridor
      const out = p.dist > p.w / 2 + C.margin;
      if (out) {
        S.offFor += dt;
        if (!S.offRoute && S.offFor >= C.warnAfter) { S.offRoute = true; ev.push({ type: 'leave', message: 'Return to route' }); }
        if (S.offFor >= C.resetAfter) { S.offFor = 0; S.offRoute = false; ev.push({ type: 'reset', reason: 'off route', point: api.resetPoint() }); }
      } else {
        if (S.offRoute) ev.push({ type: 'return' });
        S.offFor = 0; S.offRoute = false;
      }
      // the wrong way
      const dir = at(line, S.s, loop), speed = Math.hypot(car.vx ?? 0, car.vz ?? 0), along = ((car.vx ?? 0) * dir.dx + (car.vz ?? 0) * dir.dz);
      if (speed > C.wrongSpeed && along < -0.5 * speed) {
        S.wrongFor += dt;
        if (!S.wrongWay && S.wrongFor >= C.wrongAfter) { S.wrongWay = true; ev.push({ type: 'wrongway', message: 'Wrong way' }); }
      } else if (along > 0 || speed < 1) {
        if (S.wrongWay) ev.push({ type: 'rightway' });
        S.wrongWay = false; S.wrongFor = 0;
      }
      return ev;
    },
    // where a reset puts the car: the last checkpoint or reset point it drove past, on the road, facing along
    resetPoint() {
      const u = S.lastReset?.u ?? 0, s = loop ? (((startS + u) % L) + L) % L : Math.max(0, startS + u);
      const p = at(line, s, loop);
      return { x: p.x, z: p.z, h: p.h, heading: headingOf(p.dx, p.dz), s, u };
    },
    resetTo(point) {
      const g = project(line, point.x, point.z);
      S.k = g.k; S.s = g.s; S.d = g.d; S.u = point.u ?? S.u;
      S.offFor = 0; S.offRoute = false; S.wrongWay = false; S.wrongFor = 0;
    },
  };
  return api;
}
