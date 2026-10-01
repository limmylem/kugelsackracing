// Automated tests: a robot driver takes the car through standard runs at the test centre
// (scenes/test_centre.json, whose `tests` section says where each one is), each in a fresh simulation:
//
//  0–100 km/h, quarter mile — standing start, full throttle, automatic gearbox, aids on
//  100–0 km/h              — full braking from just over 100 km/h; metres from 100 to stopped
//  skidpad                 — steady circle: speed creeps up while the car holds the line, backs off
//                            when it runs wide; lateral g held at the limit (plus the understeer
//                            gradient and which end lets go first)
//  slalom                  — 8 cones 18 m apart at steady speeds, faster each time; time from the
//                            first to the last cone on the fastest run that hits no cone
//  top speed               — flat out down the 8 km straight until it stops gaining
//  circuit lap             — one flying lap of the test circuit at speeds planned from the corners
//                            and the car's tyre grip
//
// the drive layouts, on test cars made from the car (physics/testCars.js), aids off so the drivetrain
// shows through:
//
//  torque steer   a front-driver launched with the steering wheel held straight: it pulls, and less with
//                 a limited-slip front diff than an open one
//  AWD launch     the same strong engine through two wheels and through four: AWD spins its tyres less
//  low range      a 4WD at the foot of a 30° dirt slope: in 2H it can't get up, in 4L it climbs
//  diff locks     a 4WD in 4H with ice under its left wheels: open diffs let those spin, locked ones pull
//
// and two checks on the simulation itself:
//
//  framerate    — the same timed key presses driven at 30, 60 and 144 fps (and at jittery frame
//                 times) must give bit-for-bit the same car after 12 s
//  physicsCost  — milliseconds of physics per car per step, against the budget in settings.json
//
// The robot drives with device 'wheel' (straight through, no keyboard smoothing or steering assists);
// the driver aids (ABS, TC, ESC) are the car's defaults. Each test is a generator that yields after
// every physics step, so the game can show a test running (run.sim is the simulation being driven)
// and the headless runner (tests/run.mjs) can run them flat out. No browser APIs here.

import { createSimulation } from './sim.js';
import { roadLine } from './track.js';
import { straightLine } from './ai.js';
import { InputTimeline } from './inputTimeline.js';
import { rotate } from './math.js';
import { testCar } from './testCars.js';
import { engineTorque } from './engine.js';

const KMH = 1 / 3.6, G = 9.81, DEG = 180 / Math.PI;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export const TESTS = [
  { id: 'zeroTo100', name: '0–100 km/h', unit: 's', digits: 2, about: 'standing start, full throttle' },
  { id: 'quarterMile', name: 'Quarter mile', unit: 's', digits: 2, about: 'standing start, 402 m' },
  { id: 'braking', name: '100–0 km/h', unit: 'm', digits: 1, about: 'full braking, ABS on' },
  { id: 'skidpad', name: 'Skidpad', unit: 'g', digits: 3, about: 'steady lateral g, 40 m circle' },
  { id: 'slalom', name: 'Slalom', unit: 's', digits: 2, about: '8 cones 18 m apart, fastest clean run' },
  { id: 'topSpeed', name: 'Top speed', unit: 'km/h', digits: 1, about: 'flat out on the 8 km straight' },
  { id: 'lap', name: 'Circuit lap', unit: 's', digits: 2, about: 'one flying lap, 1.8 km' },
  { id: 'torqueSteer', name: 'FWD torque steer', unit: '°', digits: 1, check: true, about: 'full throttle, wheel straight: open front diff against LSD (a FWD car: itself; others: FWD test cars)' },
  { id: 'awdLaunch', name: 'AWD launch', unit: '%', digits: 0, check: true, about: 'the same engine, RWD against AWD: wheelspin over 3 s (an AWD / 4WD car: itself, 2H against 4H; others: test cars)' },
  { id: 'lowRange', name: '4L hill climb', unit: 'm', digits: 1, check: true, about: 'up a 30° dirt slope: 2H against 4L (a 4WD: itself; others: a 4WD test car)' },
  { id: 'diffLocks', name: 'Diff locks on split grip', unit: 'm', digits: 1, check: true, about: '4WD in 4H, ice under the left wheels: open against locked (the lockers it has), 6 s' },
  { id: 'framerate', name: 'Same at 30 / 60 / 144 fps', unit: '', check: true, about: 'same timed inputs → identical car' },
  { id: 'physicsCost', name: 'Physics cost per car', unit: 'ms/step', digits: 3, check: true, about: '10 cars at once' },
];

// ctx: { RAPIER, settings, spec, sockets, track (the test centre) }
export function createRun(ctx, id) {
  const test = TESTS.find(t => t.id === id);
  if (!test) throw new Error(`no test "${id}"`);
  const run = { id, test, sim: null, done: false, result: null, status: '', progress: 0, steps: 0 };
  const gen = GENERATORS[id](ctx, run);
  // Take up to `steps` physics steps; true while the test is still going
  run.next = (steps = 1) => {
    for (let i = 0; i < steps && !run.done; i++) {
      const r = gen.next();
      run.steps++;
      if (r.done) { run.done = true; run.progress = 1; run.result = { id, ...r.value }; }
    }
    return !run.done;
  };
  return run;
}

// Run one test to the end; returns its result
export function runTest(ctx, id) {
  const run = createRun(ctx, id);
  while (run.next(10000));
  return run.result;
}

// Results against target ranges ({ id: { min, max } }): rows for a results screen / the runner
export function evaluate(results, targets = {}) {
  return results.map(r => {
    const test = TESTS.find(t => t.id === r.id), t = targets[r.id];
    let pass = r.ok !== false;
    if (pass && t && r.value != null) pass = (t.min == null || r.value >= t.min) && (t.max == null || r.value <= t.max);
    if (r.value == null && !test.check) pass = false;
    return { ...r, name: test.name, unit: test.unit, digits: test.digits ?? 2, target: t ?? null, pass };
  });
}

// ---------- The robot driver ----------

// A path: points { x, z, tx, tz (unit tangent), k (curvature, + = turning left) } `step` m apart
function makePath(points, closed, step) {
  const n = points.length, P = points.map(([x, z]) => ({ x, z }));
  P.forEach((p, i) => {
    const a = P[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = P[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    p.tx = (b.x - a.x) / l; p.tz = (b.z - a.z) / l;
  });
  P.forEach((p, i) => {
    const b = P[closed ? (i + 1) % n : Math.min(n - 1, i + 1)], a = P[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const turn = Math.atan2(a.tz * b.tx - a.tx * b.tz, a.tx * b.tx + a.tz * b.tz);   // + = heading swings toward +x (left)
    p.k = turn / (2 * step);
  });
  return { points: P, closed, step, length: n * step };
}
const pathFromLine = (line, closed, step) => makePath(line.map(p => [p.x, p.z]), closed, step);
// Straight from (x, z) heading h (radians, 0 = +z; +x is left of +z)
const straightPath = ([x, z], h, length, step = 2) => makePath(Array.from({ length: Math.ceil(length / step) + 1 }, (_, i) => [x + Math.sin(h) * i * step, z + Math.cos(h) * i * step]), false, step);
// Circle turning left; start at angle θ0 (the heading there)
function circlePath([cx, cz], R, step = 1) {
  const n = Math.round(2 * Math.PI * R / step);
  return makePath(Array.from({ length: n }, (_, i) => { const t = i / n * 2 * Math.PI; return [cx - R * Math.cos(t), cz + R * Math.sin(t)]; }), true, 2 * Math.PI * R / n);
}

function carState(v) {
  const b = v.body, p = b.translation(), q = b.rotation(), l = b.linvel();
  const fwd = rotate(q, [0, 0, 1]), left = rotate(q, [1, 0, 0]);
  return { x: p.x, z: p.z, fwd, left, heading: Math.atan2(fwd[0], fwd[2]), speed: l.x * fwd[0] + l.z * fwd[2], lat: l.x * left[0] + l.z * left[2] };
}

// Follows a path: pure pursuit (aim at a point a speed-dependent distance ahead, steer the arc that
// reaches it) plus a little integral of the sideways error for steady corners; returns the road
// wheel angle. Keeps track of where along the path the car is.
function follower(path, { lookBase = 4, lookTime = 0.35, lookMax = 25, integral = 0.02 } = {}) {
  const P = path.points, m = P.length;
  let idx = null, errInt = 0;
  const f = (v, dt) => {
    const c = carState(v);
    const d = i => (P[i].x - c.x) ** 2 + (P[i].z - c.z) ** 2;
    const wrap = i => path.closed ? (i + m) % m : clamp(i, 0, m - 1);
    if (idx === null) { idx = 0; for (let i = 1; i < m; i++) if (d(i) < d(idx)) idx = i; }
    for (let k = 0; k < 40 && d(wrap(idx + 1)) < d(idx) && (path.closed || idx < m - 1); k++) idx = wrap(idx + 1);
    for (let k = 0; k < 40 && d(wrap(idx - 1)) < d(idx) && (path.closed || idx > 0); k++) idx = wrap(idx - 1);
    const p = P[idx];
    f.error = (c.x - p.x) * p.tz - (c.z - p.z) * p.tx;         // sideways error: + = car to the left of the path
    f.index = idx;
    f.along = idx * path.step;
    f.curvature = p.k;
    const look = clamp(lookBase + lookTime * Math.abs(c.speed), lookBase, lookMax);
    const t = P[wrap(idx + Math.round(look / path.step))];
    const dx = t.x - c.x, dz = t.z - c.z, lx = dx * c.left[0] + dz * c.left[2], lz = dx * c.fwd[0] + dz * c.fwd[2];
    const L = v.wheelbase, ld = Math.hypot(lx, lz) || 1;
    errInt = clamp(errInt + f.error * dt, -20, 20);
    return Math.atan(2 * L * lx / (ld * ld)) - integral * errInt;
  };
  f.reset = () => { idx = null; errInt = 0; };
  return f;
}

// Input for a road wheel angle and pedals, through a steering wheel with the car's own lock
function wheelInput(v, road, throttle, brake) {
  const St = v.spec.steering, range = St.maxWheelRotation / 2 * Math.PI / 180;
  return { device: 'wheel', wheelRange: St.maxWheelRotation, handbrake: false, steer: clamp(road * St.ratio / range, -1, 1), throttle: clamp(throttle, 0, 1), brake: clamp(brake, 0, 1) };
}

// Throttle / brake to hold a speed (m/s): proportional, with a little integral so it holds steadily
function speedHolder({ gain = 0.35, integral = 0.12, brakeGain = 0.25, brakeMargin = 1 } = {}) {
  let i = 0;
  return (speed, target, dt) => {
    const e = target - speed;
    i = clamp(i + e * integral * dt, 0, 0.8);
    return { throttle: clamp(e * gain + i, 0, 1), brake: e < -brakeMargin ? clamp(-(e + brakeMargin) * brakeGain, 0, 1) : 0 };
  };
}

// ---------- Where things are at the test centre ----------

function place(ctx) {
  const T = ctx.track.tests, roads = ctx.track.roads;
  const straight = roadLine(roads[T.straight.road]), s0 = straight[Math.round(T.straight.startAt / 2)];
  const strip = { x: s0.x, z: s0.z, h: Math.atan2(s0.tx, s0.tz) };
  strip.remaining = (straight.length - Math.round(T.straight.startAt / 2)) * 2;
  return { strip, T };
}
const spawnAt = (x, z, h, speed = 0) => ({ position: [x, 0, z], headingDeg: h * DEG, speed });
// A fresh simulation for a run. The robot drives like a driver with a steering wheel: the car's own
// aids (ABS, traction and stability control) as the spec has them, none of the keyboard / gamepad
// steering assists (the drift assist would also let stability control allow bigger slides)
const newSim = (ctx, run) => {
  run.sim = createSimulation(ctx.RAPIER, { settings: ctx.settings, spec: ctx.spec, sockets: ctx.sockets, track: ctx.track });
  Object.assign(run.sim.vehicle.aids, { countersteer: false, steering: false, drift: false });
  return run.sim;
};

// Lets the car settle on its springs, stopped
function* settle(sim, seconds = 0.8) {
  for (let i = 0; i < seconds / sim.dt; i++) { sim.step({ device: 'wheel', throttle: 0, brake: 0, steer: 0, handbrake: false }); yield; }
}

// ---------- The tests ----------

// Standing start down the straight, flat out, until `done(timer)`
function* launch(ctx, run, done, what) {
  const { strip } = place(ctx), sim = newSim(ctx, run), v = sim.vehicle;
  sim.resetCar(spawnAt(strip.x, strip.z, strip.h));
  yield* settle(sim);
  const follow = follower(straightPath([strip.x, strip.z], strip.h, strip.remaining), { integral: 0 });
  run.status = 'full throttle';
  while (!done(sim.timer) && sim.time < 70) {
    sim.step(wheelInput(v, follow(v, sim.dt), 1, 0));
    run.progress = Math.min(0.99, sim.timer.t / 20);
    yield;
  }
  const T = sim.timer;
  return what(T);
}

function* zeroTo100(ctx, run) {
  return yield* launch(ctx, run, T => T.t100 != null, T => ({ value: T.t100, detail: `timed from the car moving off` }));
}

function* quarterMile(ctx, run) {
  return yield* launch(ctx, run, T => T.quarter != null, T => ({ value: T.quarter, detail: T.quarterSpeed ? `crossing at ${(T.quarterSpeed * 3.6).toFixed(0)} km/h` : '' }));
}

function* braking(ctx, run) {
  const { strip } = place(ctx), sim = newSim(ctx, run), v = sim.vehicle;
  sim.resetCar(spawnAt(strip.x, strip.z, strip.h));
  yield* settle(sim);
  const follow = follower(straightPath([strip.x, strip.z], strip.h, strip.remaining), { integral: 0 }), hold = speedHolder();
  const entry = 108 * KMH;
  run.status = 'up to speed';
  let steady = 0;
  while (steady < 1.5 && sim.time < 60) {                  // reach and hold just over 100
    const s = v.forwardSpeed(), p = s < entry - 3 ? { throttle: 1, brake: 0 } : hold(s, entry, sim.dt);
    sim.step(wheelInput(v, follow(v, sim.dt), p.throttle, p.brake));
    if (Math.abs(s - entry) < 0.5) steady += sim.dt;
    run.progress = 0.6 * s / entry;
    yield;
  }
  run.status = 'braking';
  const discs = () => v.brakes.state.map(s => s.temp);
  const before = discs();
  while (v.forwardSpeed() > 0.3 && sim.time < 90) {
    sim.step(wheelInput(v, follow(v, sim.dt), 0, 1));
    run.progress = 0.6 + 0.4 * (1 - v.forwardSpeed() / entry);
    yield;
  }
  const hot = Math.max(...discs().map((t, i) => t - before[i]));
  return { value: sim.timer.stopDistance, detail: `discs warmed up to ${hot.toFixed(0)} °C` };
}

function* skidpad(ctx, run) {
  const { T } = place(ctx), R = T.skidpad.radius, [cx, cz] = T.skidpad.centre, sim = newSim(ctx, run), v = sim.vehicle;
  // start on the circle heading along it (turning left), already rolling
  sim.resetCar(spawnAt(cx - R, cz, 0, 40 * KMH));
  const follow = follower(circlePath([cx, cz], R), { lookBase: 6, lookTime: 0.25, integral: 0.03 }), hold = speedHolder();
  const L = v.wheelbase, win = Math.round(3 / sim.dt);
  // speed creeps up (0.5 km/h a second, near enough steady) while the car holds the circle; the
  // run ends once it can't (running wide or spinning)
  let target = 40 * KMH, lost = 0;
  const samples = [];
  while (sim.time < 120 && lost < 1) {
    const road = follow(v, sim.dt), wide = -follow.error;          // + = outside the circle
    target += 0.5 * KMH * sim.dt;
    const p = hold(v.forwardSpeed(), target, sim.dt);
    sim.step(wheelInput(v, road, p.throttle, p.brake));
    const pos = v.body.translation(), r = Math.hypot(pos.x - cx, pos.z - cz), vel = v.body.linvel(), sp = Math.hypot(vel.x, vel.z);
    const W = v.wheels, slip = front => Math.abs(W.filter(w => front === w.front).reduce((a, w) => a + w.slipAngle, 0) / 2) / v.peak.y;
    const roll = Math.asin(clamp(rotate(v.body.rotation(), [1, 0, 0])[1], -1, 1)) * DEG;     // leaning out of the (left) turn
    samples.push({ t: sim.time, g: sp * sp / r / G, r, wide, steer: v.steer, front: slip(true), rear: slip(false), roll });
    if (Math.abs(wide) > 1.5 || Math.abs(v.yawRate) > 2 * sp / R) lost += sim.dt;
    run.status = `${(sp * 3.6).toFixed(1)} km/h · ${(sp * sp / r / G).toFixed(2)} g`;
    run.progress = Math.min(0.99, (sp * 3.6 - 40) / 35);
    yield;
  }
  // the best lateral g held for 3 s with the car within 0.5 m of the circle all along
  let best = null, at = 0;
  for (let i = win, sum = samples.slice(0, win).reduce((a, x) => a + x.g, 0); i <= samples.length; i++) {
    const w = samples.slice(i - win, i);
    if (w.every(x => Math.abs(x.wide) < 0.5) && (best === null || sum / win > best)) { best = sum / win; at = i; }
    if (i < samples.length) sum += samples[i].g - samples[i - win].g;
  }
  const held = samples.slice(at - win, at);
  // understeer gradient: steering beyond the geometric angle (L / R) per g, below 0.6 g
  const early = samples.filter(x => x.g < 0.6 && x.g > 0.3 && Math.abs(x.wide) < 0.5);
  let grad = null;
  if (early.length > 50) {
    const xs = early.map(x => x.g), ys = early.map(x => (x.steer - Math.atan(L / x.r)) * DEG);
    const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
    grad = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  }
  const mean = k => held.reduce((a, x) => a + x[k], 0) / (held.length || 1);
  const front = mean('front'), rear = mean('rear'), roll = mean('roll'), balance = front > rear ? 'understeer' : 'oversteer';
  return {
    value: best, ok: best != null,
    detail: best == null ? 'could not hold the circle' : `${balance} at the limit (front / rear slip ${Math.round(front * 100)}% / ${Math.round(rear * 100)}% of peak) · understeer gradient ${grad != null ? grad.toFixed(1) : '–'}°/g · body roll ${roll.toFixed(1)}°`,
    extra: { understeerGradient: grad, frontSlipOfPeak: front, rearSlipOfPeak: rear, balance, roll },
  };
}

function* slalom(ctx, run) {
  const { T } = place(ctx), S = T.slalom, cones = ctx.track.props.find(p => p.name === S.cones);
  const h = (cones.headingDeg || 0) * Math.PI / 180, dir = [Math.sin(h), Math.cos(h)], left = [Math.cos(h), -Math.sin(h)];
  const n = cones.count, sp = cones.spacing, A = S.offset, end = (n - 1) * sp;
  const lateral = u => u < 0 ? A : u > end ? A * Math.cos(Math.PI * (n - 1)) : A * Math.cos(Math.PI * u / sp);
  const at = (u, y) => [cones.start[0] + dir[0] * u + left[0] * y, cones.start[1] + dir[1] * u + left[1] * y];
  const pts = [];
  for (let u = -S.runUp; u <= end + 80; u += 0.5) pts.push(at(u, lateral(u)));
  const path = makePath(pts, false, 0.5);
  const along = pos => (pos.x - cones.start[0]) * dir[0] + (pos.z - cones.start[1]) * dir[1];

  // one run at a steady speed (km/h): its time, or null if a cone was hit / the car lost it
  function* attempt(kmh) {
    const sim = newSim(ctx, run), v = sim.vehicle, start = at(-60, A);
    sim.resetCar(spawnAt(start[0], start[1], h, kmh * KMH));
    const follow = follower(path, { lookBase: 3, lookTime: 0.28, lookMax: 12, integral: 0 }), hold = speedHolder({ brakeMargin: 3 });
    const home = sim.propPositions();
    let t0 = null, t1 = null, worst = 0;
    while (t1 === null && sim.time < 20) {
      const road = follow(v, sim.dt), p = hold(v.forwardSpeed(), kmh * KMH, sim.dt);
      sim.step(wheelInput(v, road, p.throttle, p.brake));
      const u = along(v.body.translation());
      if (t0 === null && u >= 0) t0 = sim.time;
      if (t0 !== null && u >= end) t1 = sim.time;
      if (u > -10 && u < end + 5) worst = Math.max(worst, Math.abs(follow.error));
      yield;
    }
    const hit = sim.propPositions().some((p, i) => Math.hypot(p[0] - home[i][0], p[2] - home[i][2]) > 0.05);
    return { time: t0 !== null && t1 !== null && !hit ? t1 - t0 : null, hit, worst };
  }

  let best = null, bestSpeed = null, speed = 40, stepSize = 5, lastFail = null, tries = 0;
  // faster by 5 km/h until a run fails, then halve the step between the last clean and the failed speed
  while (tries < 16) {
    tries++;
    run.status = `run ${tries} at ${speed.toFixed(1)} km/h${best ? ` · best ${best.toFixed(2)} s` : ''}`;
    const r = yield* attempt(speed);
    if (r.time != null) { if (best === null || r.time < best) { best = r.time; bestSpeed = speed; } }
    else lastFail = speed;
    if (lastFail === null) speed += stepSize;
    else {
      if (stepSize <= 1.25 || bestSpeed === null) break;
      stepSize /= 2;
      speed = bestSpeed + stepSize;
    }
    run.progress = Math.min(0.99, tries / 9);
  }
  return { value: best, ok: best != null, detail: best != null ? `clean at ${bestSpeed.toFixed(1)} km/h, cones at ±${A} m` : 'no clean run' };
}

function* topSpeed(ctx, run) {
  const { strip } = place(ctx), sim = newSim(ctx, run), v = sim.vehicle;
  sim.resetCar(spawnAt(strip.x, strip.z, strip.h));
  yield* settle(sim);
  const follow = follower(straightPath([strip.x, strip.z], strip.h, strip.remaining), { integral: 0 });
  const history = [], back = Math.round(15 / sim.dt);
  let top = 0, distance = 0, reason = 'end of the straight', lastShift = 0;
  while (distance < strip.remaining - 250) {
    sim.step(wheelInput(v, follow(v, sim.dt), 1, 0));
    const s = v.forwardSpeed();
    distance += s * sim.dt;
    top = Math.max(top, s);
    history.push(s);
    if (v.drivetrain.shifting) lastShift = sim.time;
    // stopped gaining: less than 0.2 km/h more over the last 15 s, with no gear change in them
    if (history.length > back && sim.time - lastShift > 15 && (s - history[history.length - 1 - back]) * 3.6 < 0.2) { reason = 'no longer gaining'; break; }
    run.status = `${(s * 3.6).toFixed(1)} km/h · ${(distance / 1000).toFixed(2)} km`;
    run.progress = Math.min(0.99, distance / strip.remaining);
    yield;
  }
  return { value: top * 3.6, detail: `${reason} after ${(distance / 1000).toFixed(1)} km, in gear ${v.drivetrain.gearName()} at ${v.drivetrain.rpm.toFixed(0)} rpm` };
}

function* lap(ctx, run) {
  const { T } = place(ctx), road = ctx.track.roads[T.circuit.road], line = roadLine(road), step = 2, m = line.length;
  const path = pathFromLine(line, true, step), sim = newSim(ctx, run), v = sim.vehicle;
  // Planned speeds: what the tyres allow round each bend (a share of their grip), then braked down
  // into each bend from the one after it
  // (how hard the robot drives it: 0.84 of the tyres' grip, or less for a demanding car — its targets
  // file's lap.pace; tests/targets/ — on the road's own surface: gravel grips less, and more for a
  // gravel tyre)
  const Ty = ctx.spec.tyre, pace = ctx.pace?.lap ?? 1, S = ctx.track.surfaces?.[road.surface], on = S ? (S.grip ?? 1) * (Ty.surfaceGrip?.[road.surface] ?? 1) : 1;
  const lat = 0.84 * pace * Ty.lateral.D * G * on, decel = 0.8 * pace * Ty.longitudinal.D * G * on;
  const smooth = i => { let s = 0; for (let k = -4; k <= 4; k++) s += path.points[(i + k + m) % m].k; return Math.abs(s / 9); };
  const plan = path.points.map((_, i) => Math.min(80, Math.sqrt(lat / Math.max(smooth(i), 1e-4))));
  for (let pass = 0; pass < 2; pass++) for (let i = m - 1; i >= 0; i--) plan[i] = Math.min(plan[i], Math.sqrt(plan[(i + 1) % m] ** 2 + 2 * decel * step));
  // start from rest a little before the line
  const startIdx = sim.lapTimer.start, s0 = path.points[(startIdx - Math.round(T.circuit.startBefore / step) + m) % m];
  sim.resetCar(spawnAt(s0.x, s0.z, Math.atan2(s0.tx, s0.tz)));
  yield* settle(sim);
  const follow = follower(path, { lookBase: 5, lookTime: 0.3, lookMax: 20, integral: 0.01 }), hold = speedHolder({ gain: 0.6, brakeGain: 0.3, brakeMargin: 0.5 });
  let off = 0, worst = 0, spun = false;
  while (sim.lapTimer.laps < 1 && sim.time < 240 && !spun) {
    const steer = follow(v, sim.dt), s = v.forwardSpeed();
    // look a little ahead for the planned speed, so braking starts on time
    const want = plan[(follow.index + Math.round(Math.max(4, s * 0.3) / step)) % m];
    const p = s < want - 2 ? { throttle: 1, brake: 0 } : hold(s, want, sim.dt);
    // only as much throttle as the grip left over from cornering allows (friction circle) — and in a
    // bend, for a car whose engine flat out in this gear pushes well past what its driven tyres can
    // take (a 600 hp car; the starter car never gets past 1.1×), that much less again
    const cornering = Math.min(1, s * s * Math.abs(follow.curvature) / lat);
    const D = v.drivetrain, drive = engineTorque(ctx.spec.engine, D.rpm, 1) * Math.abs(D.ratio(D.gear)) * ctx.spec.drivetrain.efficiency / ctx.spec.wheels.radius;
    const bite = 1.15 * v.wheels.filter(w => w.driven).reduce((a, w) => a + w.load * (w.grip ?? 1), 0) * Ty.longitudinal.D;
    p.throttle = Math.min(p.throttle, Math.max(0.2, Math.sqrt(1 - cornering * cornering)));
    // (how hard the car is turning now, not just the road: through an S-bend it's still turning hard
    // where the road straightens between the bends)
    const turning = Math.min(1, Math.max(cornering, Math.abs(v.yawRate * s) / lat));
    if (turning > 0.2 && drive > bite) p.throttle = Math.min(p.throttle, Math.max(0.2, Math.sqrt(1 - turning * turning) * bite / drive));
    // and off the throttle as the rear steps out, as a driver would (a powerful car — a turbo coming
    // on boost mid-corner — would otherwise spin itself round under full throttle)
    const rear = v.wheels.filter(w => !w.front), rearSlide = Math.max(...rear.map(w => Math.abs(w.slipAngle ?? 0))), spin = Math.max(...v.wheels.filter(w => w.driven).map(w => w.slipRatio ?? 0));
    if (rearSlide > 0.1) p.throttle *= Math.max(0, 1 - (rearSlide - 0.1) / 0.1);
    if (spin > 0.12 && s > 8) p.throttle *= Math.max(0.1, 1 - (spin - 0.12) / 0.15);
    sim.step(wheelInput(v, steer, p.throttle, p.brake));
    const c = carState(v), pt = path.points[follow.index];
    if (c.fwd[0] * pt.tx + c.fwd[2] * pt.tz < 0) spun = true;       // facing backwards
    worst = Math.max(worst, Math.abs(follow.error));
    if (Math.abs(follow.error) > road.width / 2 + 1) off += sim.dt;
    const L = sim.lapTimer;
    run.status = L.running ? `lap ${L.t.toFixed(1)} s · ${Math.round(Math.max(0, L.covered) / (m * step) * 100)}%` : 'out lap';
    run.progress = L.running ? Math.min(0.99, 0.1 + 0.9 * Math.max(0, L.covered) / (m * step)) : 0.05;
    yield;
  }
  const value = sim.lapTimer.last;
  return { value: spun ? null : value, ok: value != null && off === 0 && !spun, detail: spun ? `spun ${Math.round(Math.max(0, sim.lapTimer.covered) / (m * step) * 100)}% round` : value == null ? 'did not finish the lap' : off > 0 ? `off the track for ${off.toFixed(1)} s` : `stayed on the road (at most ${worst.toFixed(1)} m off the centre line)` };
}

// Same key presses (as a keyboard driver would make them, at moments that don't line up with frames
// or steps) driven through sim.advance at different frame rates: the car must end up identical.
function* framerate(ctx, run) {
  const { strip } = place(ctx);
  const K = (t, state) => ({ t, state: { device: 'keyboard', throttle: 0, brake: 0, steer: 0, handbrake: false, clutch: null, ...state } });
  const script = [
    K(0.2371, { throttle: 1 }), K(3.1173, { throttle: 1, steer: 1 }), K(4.0527, { throttle: 1 }),
    K(5.3309, { throttle: 0.5, steer: -1 }), K(6.0101, { throttle: 1 }), K(8.4043, { brake: 1 }),
    K(9.9517, { steer: 1, handbrake: true }), K(10.6089, { throttle: 1 }), K(11.2633, { throttle: 1, steer: -1 }),
  ];
  const shifts = [{ t: 7.7719, action: 1 }, { t: 7.9931, action: 1 }, { t: 10.1403, action: -1 }];
  const seconds = 12, N = Math.round(seconds * ctx.settings.stepHz);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const frameSets = [
    ['30 fps', () => 1000 / 30], ['60 fps', () => 1000 / 60], ['144 fps', () => 1000 / 144], ['jittery 4–40 ms', () => 4 + rnd() * 36],
  ];
  const results = [];
  for (const [name, frameMs] of frameSets) {
    run.status = name;
    const sim = newSim(ctx, run), v = sim.vehicle;
    sim.resetCar(spawnAt(strip.x, strip.z, strip.h));
    const timeline = new InputTimeline(1e9);
    timeline.set(-1, K(0, {}).state);
    for (const k of script) timeline.set(k.t * 1000, k.state);
    for (const s of shifts) timeline.event(s.t * 1000, s.action);
    let print = null;
    sim.onStep((s, n) => { if (n === N) print = fingerprint(v); });
    let now = 0;
    while (sim.stepCount < N) {
      const ms = frameMs();
      now += ms;
      // each step gets the keys as they were at the end of its own moment, and any shift in it
      sim.advance(ms / 1000, (a, b) => {
        const st = { ...timeline.at(now + b * 1000) }, sh = timeline.eventsIn(now + a * 1000, now + b * 1000);
        if (sh.length) st.shift = sh.reduce((x, y) => x + y, 0);
        return st;
      });
      yield;
    }
    results.push({ name, print });
    run.progress = results.length / frameSets.length;
  }
  const same = results.every(r => r.print === results[0].print);
  const pos = JSON.parse(results[0].print).p;
  return {
    value: same ? 1 : 0, ok: same,
    detail: same ? `identical after ${seconds} s (${N} steps, car ${Math.hypot(pos[0] - strip.x, pos[2] - strip.z).toFixed(1)} m from the start) at ${results.map(r => r.name).join(', ')}`
      : `differs: ${results.filter(r => r.print !== results[0].print).map(r => r.name).join(', ')} vs ${results[0].name}`,
  };
}

// Everything that could differ between two runs, to full precision
function fingerprint(v) {
  const b = v.body, t = b.translation(), q = b.rotation(), l = b.linvel(), a = b.angvel();
  return JSON.stringify({
    p: [t.x, t.y, t.z], q: [q.x, q.y, q.z, q.w], l: [l.x, l.y, l.z], a: [a.x, a.y, a.z],
    w: v.wheels.map(w => [w.omega, w.spin, w.compression]), e: [v.drivetrain.omega, v.drivetrain.gear, v.drivetrain.clutch], d: v.brakes.state.map(s => s.temp), s: v.steer,
  });
}

// Physics time per car per step with ten cars driving at once, against the budget
function* physicsCost(ctx, run) {
  const { strip } = place(ctx), sim = newSim(ctx, run), v = sim.vehicle;
  sim.resetCar(spawnAt(strip.x, strip.z, strip.h));
  for (let i = 0; i < 9; i++) {
    const side = (i % 3 - 1) * 4.5, ahead = 12 + Math.floor(i / 3) * 12;
    sim.addCar(spawnAt(strip.x + Math.cos(strip.h) * side + Math.sin(strip.h) * ahead, strip.z - Math.sin(strip.h) * side + Math.cos(strip.h) * ahead, strip.h), straightLine());
  }
  const follow = follower(straightPath([strip.x, strip.z], strip.h, strip.remaining), { integral: 0 });
  let total = 0, count = 0, worst = 0;
  const cars = 1 + sim.cars.length;
  for (let i = 0; i < 900; i++) {
    const t0 = performance.now();
    sim.step(wheelInput(v, follow(v, sim.dt), 1, 0));
    const ms = performance.now() - t0;
    if (i >= 150) { total += ms; count++; worst = Math.max(worst, ms); }   // after warming up
    run.progress = i / 900;
    yield;
  }
  const perCar = total / count / cars, B = ctx.settings.budget;
  const fit = B ? Math.floor(B.frameMs / (ctx.settings.stepHz / 60) / perCar) : null;
  return { value: perCar, ok: !B || perCar <= B.carStepMs, detail: `${cars} cars: ${(total / count).toFixed(2)} ms a step (slowest ${worst.toFixed(2)})${fit ? ` · about ${fit} cars fit the ${B.frameMs} ms per frame budget at 60 fps` : ''}` };
}

// ---------- Drive layouts (the car itself if it has the layout, else test cars: physics/testCars.js) ----------

// A fresh simulation of a test car, the driver aids off (so the drivetrain shows through)
function testSim(ctx, run, id) {
  run.sim = createSimulation(ctx.RAPIER, { settings: ctx.settings, spec: testCar(ctx.spec, id), sockets: ctx.sockets, track: ctx.track });
  Object.assign(run.sim.vehicle.aids, { abs: true, tc: false, esc: false, countersteer: false, steering: false, drift: false });
  return run.sim;
}
const headingDeg = v => carState(v).heading * DEG;

// FWD, full throttle from a standstill for 3 s with the steering wheel held straight: how far the car
// has turned (torque steer), open front diff against limited slip
function* torqueSteer(ctx, run) {
  const { strip } = place(ctx), out = {};
  for (const id of ['fwd', 'fwdLsd']) {
    const sim = testSim(ctx, run, id), v = sim.vehicle;
    sim.resetCar(spawnAt(strip.x, strip.z, strip.h));
    yield* settle(sim);
    const h0 = headingDeg(v);
    let most = 0;
    run.status = id === 'fwd' ? 'open diff' : 'limited-slip diff';
    for (let i = 0; i < 3 / sim.dt; i++) { sim.step(wheelInput(v, 0, 1, 0)); most = Math.max(most, Math.abs(v.torqueSteer)); yield; }
    out[id] = { turn: Math.abs(headingDeg(v) - h0), most: most * DEG, kmh: v.forwardSpeed() / KMH };
  }
  const a = out.fwd, b = out.fwdLsd;
  return { value: a.turn, ok: a.turn > 1.5 && a.turn > 2 * b.turn, detail: `wheel held straight, 3 s flat out: open diff turns it ${a.turn.toFixed(1)}° (the wheels pulled up to ${a.most.toFixed(2)}°), limited-slip ${b.turn.toFixed(1)}° (${b.most.toFixed(2)}°)` };
}

// A strong engine through the rear wheels and through all four, flat out for 3 s: mean wheelspin
function* awdLaunch(ctx, run) {
  const { strip } = place(ctx), out = {};
  for (const id of ['rwdPower', 'awdPower']) {
    const sim = testSim(ctx, run, id), v = sim.vehicle, follow = follower(straightPath([strip.x, strip.z], strip.h, strip.remaining), { integral: 0 });
    sim.resetCar(spawnAt(strip.x, strip.z, strip.h));
    yield* settle(sim);
    let spin = 0, n = 0;
    run.status = id === 'awdPower' ? 'AWD' : 'RWD';
    for (let i = 0; i < 3 / sim.dt; i++) {
      sim.step(wheelInput(v, follow(v, sim.dt), 1, 0));
      spin += Math.max(0, ...v.wheels.filter(w => w.driven && w.grounded).map(w => w.slipRatio ?? 0)); n++;
      yield;
    }
    out[id] = { spin: spin / n * 100, kmh: v.forwardSpeed() / KMH };
  }
  const r = out.rwdPower, a = out.awdPower;
  return { value: a.spin, ok: a.spin < 0.5 * r.spin && a.kmh > r.kmh, detail: `mean wheelspin over 3 s: RWD ${r.spin.toFixed(0)}%, AWD ${a.spin.toFixed(0)}% · ${r.kmh.toFixed(0)} against ${a.kmh.toFixed(0)} km/h after 3 s` };
}

// 4WD at the foot of the 30° dirt slope, flat out: how high it gets in 2H, and in 4L
function* lowRange(ctx, run) {
  const H = ctx.track.tests.hillClimb, out = {};
  for (const mode of ['2H', '4L']) {
    const sim = testSim(ctx, run, 'fourWd'), v = sim.vehicle;
    sim.resetCar(spawnAt(H.start[0], H.start[1], 0));
    v.drivetrain.setTransfer(mode, 0);
    yield* settle(sim);
    const follow = follower(straightPath(H.start, 0, 120), { integral: 0 });
    let top = 0;
    run.status = mode;
    for (let i = 0; i < 25 / sim.dt && top < H.top + 0.5; i++) { sim.step(wheelInput(v, follow(v, sim.dt), 1, 0)); top = Math.max(top, v.body.translation().y); yield; }
    out[mode] = Math.min(top, H.top);
  }
  return { value: out['4L'], ok: out['4L'] >= H.top - 0.5 && out['2H'] < H.top - 3, detail: `a 30° dirt slope, ${H.top} m high: 2H gets ${out['2H'].toFixed(1)} m up and stops, 4L climbs ${out['4L'] >= H.top - 0.5 ? 'to the top' : `${out['4L'].toFixed(1)} m`}` };
}

// 4WD in 4H on the split-grip lane (ice under the left wheels), flat out for 6 s: how far with the
// axle diffs open, and locked
function* diffLocks(ctx, run) {
  const S = ctx.track.tests.splitGrip, out = {};
  for (const lock of [false, true]) {
    const sim = testSim(ctx, run, 'fourWd'), v = sim.vehicle;
    sim.resetCar(spawnAt(S.start[0], S.start[1], 0));
    v.drivetrain.setTransfer('4H', 0);
    v.drivetrain.setLock('front', lock); v.drivetrain.setLock('rear', lock);
    yield* settle(sim);
    const follow = follower(straightPath(S.start, 0, 200), { integral: 0 });
    run.status = lock ? 'locked' : 'open';
    for (let i = 0; i < 6 / sim.dt; i++) { sim.step(wheelInput(v, follow(v, sim.dt), 1, 0)); yield; }
    out[lock] = { d: v.body.translation().z - S.start[1], ice: v.wheels.filter(w => w.surface?.name === 'ice').map(w => w.name).join(' '), locked: ['front', 'rear'].filter(a => v.drivetrain.locks[a]) };
  }
  const o = out[false], l = out[true];
  return { value: l.d, ok: l.d > 2 * o.d && l.d > 10, detail: `ice under ${o.ice || 'no wheel'}: open diffs ${o.d.toFixed(1)} m in 6 s (the icy wheels spin), ${l.locked.join(' and ') || 'nothing'} locked ${l.d.toFixed(1)} m` };
}

const GENERATORS = { zeroTo100, quarterMile, braking, skidpad, slalom, topSpeed, lap, torqueSteer, awdLaunch, lowRange, diffLocks, framerate, physicsCost };
