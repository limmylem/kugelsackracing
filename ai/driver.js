// An NPC driver, separate from its car: a function (vehicle, dt) → that car's input for the physics step
// — steering, throttle, brake, handbrake, through the same controls as the player's (device 'wheel'), the
// car's own gearbox and aids. Nothing else: no extra grip, power or forces; any car can be driven by the
// player or by this.
//
// Steering: pure pursuit on a point of the racing line (route/racingLine.js) ahead, further the faster it
// goes, damped against yaw (countersteer when the rear steps out), never more lock than the front tyres
// can use. Speed: the car's speed plan (its grip, braking and power, at the driver's margins), with
// smooth throttle and braking, the grip left over from cornering shared between them.
//
// The driver's skill (ai/skill.js) sets how closely it follows the line, how late it brakes, how near the
// grip it corners, how quickly it reacts, how much its pace varies, and how often it makes a mistake
// (running wide, braking late, a small lock-up, a rare spin) — all randomness from its own seeded rng.
// Around other cars (ctx.near: the race's cars nearby along the route, no raycasts): it follows without
// rear-ending, goes for a gap inside or outside when there's room (more often the more aggressive),
// defends with one move (never into a car alongside), and keeps its distance from a car alongside.
// Stuck or spun, it reverses out and straightens up; lost (far off the route, on its roof, stuck
// again and again) it asks the race for the route's reset (state.wantsReset).
//
//   const D = createAiDriver({ id, rl, line, loop, plan, caps, params, rng, frame, ctx, config })
//     rl: the racing line; line: the route's centreline (road widths); plan: m/s at each racing-line point
//     frame: { toWorld(x, z) → [x, z] } (the physics' frame to the route's); ctx: { started(), near(id) →
//     [{ id, du, dd, v }] (along / across the route from this car, + ahead / left), adjust(id) → { corner, braking } }
//   D(vehicle, dt) → input        D.state  { k, u, d, speed, target, mode, wantsReset, mistakes, … }
//   D.hit(strength)  a hit from another car (its mood)     D.retire()     D.placed(k)  after a reset
//   D.setPlan(plan)  a new plan (damage)

import { steerInput, pursue, frontDirection, useWheelAids } from '../physics/ai.js';
import { rotate } from '../physics/math.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const G = 9.81;

export function createAiDriver({ id, rl, line, loop, plan, caps, params: K, rng, frame = { toWorld: (x, z) => [x, z] }, ctx = {}, config }) {
  const P = rl.points, n = P.length, step = n > 1 ? rl.length / (n - (loop ? 0 : 1)) : 4;
  const M = config.mistakes, R = config.recovery;
  const wrap = i => loop ? ((i % n) + n) % n : clamp(i, 0, n - 1);
  const S = {
    k: 0, u: 0, d: 0, off: 0, speed: 0, target: 0, mode: 'grid', wantsReset: false, mistakes: [], mistakeNow: null,
    tactic: null, tacticUntil: 0, defendCooldown: 0, overtakeTimer: 0, mood: null, moodUntil: 0, t: 0,
    stuck: 0, tries: 0, reverseFor: 0, upside: 0, lap: 0, pace: 1, noise: 0, noiseV: 0, throttle: 0, brake: 0, lastU: 0, incidents: [],
  };
  let ready = false;
  // walls the map doesn't know about (a mapped width is an estimate): three short rays ahead now and
  // then — left, ahead, right — and a push away from whichever side has something solid close
  const W = { push: 0, every: 6, n: 0 };
  function feelWalls(vehicle, speed, aimX, aimZ) {
    if (++W.n % W.every) return;
    const R = vehicle.R, world = vehicle.world, b = vehicle.body, q = b.rotation(), p = b.translation();
    const up = rotate(q, [0, 1, 0]), fw = rotate(q, [0, 0, 1]), lf = rotate(q, [1, 0, 0]);
    const o = { x: p.x + up[0] * 0.5 + fw[0] * 2, y: p.y + up[1] * 0.5 + fw[1] * 2, z: p.z + up[2] * 0.5 + fw[2] * 2 };
    const len = clamp(6 + Math.max(0, speed) * 0.7, 7, 24);
    const feel = side => {
      const a = side * 0.28, dx = fw[0] * Math.cos(a) + lf[0] * Math.sin(a), dy = fw[1] * Math.cos(a) + lf[1] * Math.sin(a), dz = fw[2] * Math.cos(a) + lf[2] * Math.sin(a);
      const hit = world.castRayAndGetNormal(new R.Ray(o, { x: dx, y: dy, z: dz }), len, true, 6, undefined, undefined, b);
      // (the road itself, rising ahead, isn't a wall)
      return hit && Math.abs(hit.normal.y) < 0.6 ? hit.timeOfImpact : Infinity;
    };
    const L = feel(1), C = feel(0), Rr = feel(-1);
    S.rays = [L, C, Rr];
    const near = d => d < Infinity ? 1 - d / len : 0;
    // (+ left: away from the right when it's closer there)
    const want = clamp((near(Rr) - near(L)) * 2.5 + (C < len && Math.abs(near(Rr) - near(L)) < 0.05 ? Math.sign(S.dRl || 1) * near(C) * 1.5 : 0), -2.5, 2.5);
    W.push += (want - W.push) * 0.5;
  }
  const lapPace = () => 1 + (rng.normal() * K.consistency);
  S.pace = lapPace();

  function locate(x, z) {
    const near = (from, to) => {
      let best = null;
      for (let j = from; j <= to; j++) {
        const i = wrap(j), a = P[i], b = P[wrap(i + 1)];
        if (!loop && i >= n - 1) break;
        const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1e-9, t = clamp(((x - a.x) * dx + (z - a.z) * dz) / L2, 0, 1);
        const qx = a.x + dx * t, qz = a.z + dz * t, dist = Math.hypot(x - qx, z - qz);
        if (!best || dist < best.dist) best = { i, t, dist, dx, dz, qx, qz };
      }
      return best;
    };
    let b = near(S.k - 8, S.k + 30);
    if (!b || b.dist > 30) { const g = near(0, n - 1); if (g && (!b || g.dist < b.dist)) b = g; }
    const L = Math.hypot(b.dx, b.dz) || 1;
    S.k = b.i;
    S.u = P[b.i].s + (wrap(b.i + 1) === b.i ? 0 : Math.hypot(b.qx - P[b.i].x, b.qz - P[b.i].z));
    // (across: left of the racing line, then from the centreline)
    S.dRl = (x - b.qx) * (b.dz / L) - (z - b.qz) * (b.dx / L);
    S.d = P[b.i].d + S.dRl;
    S.dist = b.dist;
  }

  // a mistake starts (rng), and how it plays out
  function maybeMistake(dt, braking, cornering) {
    if (!S.mistakeNow && rng() < K.mistakeRate / 60 * dt) {
      const kind = rng.weighted(Object.fromEntries(Object.entries(M).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, v.weight])));
      S.mistakeNow = { kind, pending: true, left: 0, at: S.t, k: S.k };
    }
    const m = S.mistakeNow;
    if (!m) return;
    if (m.pending) {
      // (each waits for its moment: a corner, a braking zone, a corner exit)
      const due = m.kind === 'runWide' ? cornering : m.kind === 'lateBrake' || m.kind === 'lockUp' ? braking : m.kind === 'spin' ? cornering && !braking : true;
      if (!due) { if (S.t - m.at > 30) S.mistakeNow = null; return; }
      m.pending = false;
      m.left = m.kind === 'lateBrake' ? 3 : M[m.kind].seconds ?? 1;
      m.metres = m.kind === 'lateBrake' ? rng.range(...M.lateBrake.metres) : 0;
      S.mistakes.push({ kind: m.kind, t: Math.round(S.t * 10) / 10, u: Math.round(S.u) });
    }
    m.left -= dt;
    if (m.left <= 0) S.mistakeNow = null;
  }

  // where across the road it wants to be (relative to the racing line), from what's around it
  function tactics(dt, speed, ahead) {
    const near = ctx.near?.(id) ?? [];
    // (across, from the racing line here: its own place, and the road's edges either way)
    const here = P[S.k], fit = x => clamp(x, -here.right, here.left);
    let want = S.noise, cap = Infinity, trafficNeed = 0;
    const myD = S.dRl ?? 0;
    // the car ahead in my lane, and anyone alongside
    let front = null, alongside = null, behind = null;
    for (const o of near) {
      const lane = Math.abs(o.dd) < 2.3;
      if (o.du > 0 && o.du < 60 && lane && (!front || o.du < front.du)) front = o;
      if (Math.abs(o.du) < 5.5 && Math.abs(o.dd) < 3.2) alongside = o;
      if (o.du < 0 && o.du > -25 && (!behind || o.du > behind.du)) behind = o;
    }
    S.overtakeTimer += dt;
    // a pass: on now, until clear ahead (or given up)
    if (S.tactic?.kind === 'pass') {
      const other = near.find(o => o.id === S.tactic.on);
      if (!other || other.du < -7 || S.t > S.tacticUntil) S.tactic = null;
      // (alongside it, a car's width and a bit to the side it chose: from the centreline, then from the line)
      else want = fit(myD + other.dd + S.tactic.side * 2.9);
    }
    if (S.tactic?.kind === 'defend' && (S.t > S.tacticUntil || !behind)) S.tactic = null;
    if (S.tactic?.kind === 'defend') want = fit(S.tactic.to);
    // following, always (passing too: a car still in its lane ahead): not into the back of it — and
    // braking for it as for a bend, the slowing it takes to be at its speed before the gap's gone (bumper
    // to bumper: about 5 m between the cars' middles)
    if (front) {
      const desired = 5 + K.followGap * Math.max(speed, 5) * (S.mood === 'angry' ? 0.7 : 1), closing = speed - front.v;
      if (front.du < desired + Math.max(0, closing) * 1.2) cap = Math.min(cap, front.v + (front.du - desired) * 0.6);
      if (closing > 0) trafficNeed = (speed * speed - front.v * front.v) / (2 * Math.max(0.5, front.du - 6));
    }
    if (!S.tactic && front) {
      const desired = 5 + K.followGap * Math.max(speed, 5), closing = speed - front.v;
      // going for a gap: inside of the next bend if there's room, else whichever side has more — at once
      // past a car that's stopped or crawling (stuck, crashed), however unaggressive
      const blocked = front.v < 2.5 && front.du < 25;
      if (front.du < desired + 15 && closing > -1 && (S.overtakeTimer > K.overtakeEvery || (blocked && S.overtakeTimer > 1)) && S.t > 3) {
        S.overtakeTimer = 0;
        if (blocked || rng() < 0.35 + 0.6 * K.aggression) {
          const bend = Math.sign(P[wrap(S.k + Math.round(40 / step))].k || 1);
          const theirD = myD + front.dd;
          const sides = [bend, -bend].filter(sd => fit(theirD + sd * 2.9) === theirD + sd * 2.9);
          if (sides.length) { S.tactic = { kind: 'pass', on: front.id, side: sides[0] }; S.tacticUntil = S.t + 8; }
        }
      }
    }
    // defending: one move to the inside of the next bend, never with a car alongside
    if (!S.tactic && behind && !alongside && behind.v > speed - 1 && S.defendCooldown <= 0) {
      S.defendCooldown = 10;
      if (rng() < K.defendChance) {
        const bend = Math.sign(P[wrap(S.k + Math.round(50 / step))].k || 1);
        S.tactic = { kind: 'defend', to: bend * Math.min(bend > 0 ? here.left : here.right, 2) };
        S.tacticUntil = S.t + 5;
      }
    }
    S.defendCooldown -= dt;
    // a car alongside: room for it (never steer into it); where the road ahead hasn't room for two, the
    // one that isn't ahead tucks in behind
    if (alongside) {
      const gap = Math.abs(alongside.dd), side = alongside.dd > 0 ? -1 : 1;
      if (gap < 2.6) want += side * (2.6 - gap);
      if (S.tactic?.kind === 'defend') S.tactic = null;
      const ahead = P[wrap(S.k + Math.round(30 / step))], twoWide = Math.min(here.left + here.right, ahead.left + ahead.right) + 3.6 > 5.2;
      if (!twoWide && alongside.du > -1.5) { cap = Math.min(cap, Math.max(0, alongside.v - 2)); if (S.tactic?.kind === 'pass') S.tactic = null; }
    }
    // waiting in traffic isn't being stuck (no backing into the car behind): a car close ahead, slow
    S.queued = !!(front && front.du < 12 && front.v < 3);
    return { want, cap, need: trafficNeed };
  }

  const driver = (vehicle, dt = 1 / 120) => {
    S.t += dt;
    if (!ready) { useWheelAids(vehicle); vehicle.drivetrain.mode = 'auto'; ready = true; }
    const b = vehicle.body, p = b.translation(), q = b.rotation(), v = b.linvel();
    const fw = rotate(q, [0, 0, 1]), up = rotate(q, [0, 1, 0]), [x, z] = frame.toWorld(p.x, p.z);
    const fm = Math.hypot(fw[0], fw[2]) || 1, fx = fw[0] / fm, fz = fw[2] / fm;
    const speed = v.x * fx + v.z * fz;
    S.speed = speed;
    locate(x, z);
    const here = P[S.k], wr = vehicle.spec.steering.maxWheelRotation;
    // (waiting: on the handbrake — held on the brake at a stop, the automatic box would go into reverse)
    const idle = { device: 'wheel', wheelRange: wr, steer: 0, throttle: 0, brake: Math.abs(speed) > 1 ? 1 : 0, handbrake: Math.abs(speed) <= 1 };
    if (S.mode === 'retired') return idle;
    if (!ctx.started?.()) { S.mode = 'grid'; return idle; }
    if (S.mode === 'grid') S.mode = 'race';

    // laps: a new pace each lap (consistency)
    if (loop && S.u < S.lastU - rl.length / 2) { S.lap++; S.pace = lapPace(); }
    S.lastU = S.u;

    // --- recovery: on its roof, lost, stuck, turned round ---
    S.upside = up[1] < 0.3 ? S.upside + dt : 0;
    const tx = (P[wrap(S.k + 1)].x - here.x), tz = (P[wrap(S.k + 1)].z - here.z), tl = Math.hypot(tx, tz) || 1;
    const facing = (fx * tx + fz * tz) / tl;
    if (S.upside > 1.5 || S.dist > R.farFromRoute) { S.wantsReset = true; return idle; }
    if (S.mode === 'reverse') {
      S.reverseFor -= dt;
      if (S.reverseFor <= 0) S.mode = 'race';
      // (backing out: the wheels the other way to the way it wants to point; the automatic box goes
      // into reverse held on the brake at a standstill, and the brake then drives it back)
      // (a three-point turn: backing up with the wheels the other way to the way it has to turn swings
      // the nose round towards it)
      return { device: 'wheel', wheelRange: wr, steer: -S.turnWay, throttle: 0, brake: 0.8, handbrake: false };
    }
    const planned = plan[wrap(S.k + 3)];
    S.stuck = speed < 1 && planned > 3 && !S.queued ? S.stuck + dt : S.queued ? S.stuck : 0;
    if (facing < -0.2 && Math.abs(speed) < 6) S.stuck += dt;           // (spun round: straighten up)
    if (S.stuck > R.stuckSeconds) {
      S.stuck = 0; S.tries++; S.stuckAt = S.u;
      if (S.tries > R.tries) { S.wantsReset = true; return idle; }
      S.mode = 'reverse'; S.reverseFor = R.reverseSeconds;
      // (which way it has to turn: towards a point of the line a little ahead; turned right round, the
      // way back to facing along the road)
      { const ahead = P[wrap(S.k + Math.round(8 / step))], [ox, oz] = frame.toWorld(0, 0), aim = pursue(vehicle, ahead.x - ox, ahead.z - oz); S.turnWay = Math.sign(aim.curve || 1); }
      S.incidents.push({ kind: 'stuck', t: Math.round(S.t * 10) / 10, u: Math.round(S.u), x: Math.round(x), z: Math.round(z) });
      return idle;
    }
    // (a fresh start at recovering once it's got going again: 30 m on from where it last got stuck)
    if (S.tries && S.u - (S.stuckAt ?? 0) > 30) S.tries = 0;

    // --- where across the road: the line's own wander (accuracy), tactics around other cars ---
    S.noiseV = clamp(S.noiseV + rng.normal() * 0.6 * dt - S.noise * 0.15 * dt, -0.6, 0.6);
    // (less of it where there's less room: a narrow street, a road narrowing ahead)
    const roomHere = Math.min(here.left + here.right, P[wrap(S.k + 8)].left + P[wrap(S.k + 8)].right), wander = K.lineAccuracy * clamp(roomHere / 3, 0.15, 1);
    S.noise = clamp(S.noise + S.noiseV * dt * wander, -wander, wander);
    const T = tactics(dt, speed);
    feelWalls(vehicle, speed);
    W.push *= Math.exp(-dt / 1.2);
    const wantD = clamp(T.want, -here.right, here.left) + W.push;
    // (no lurching across the road: at most 1.8 m/s sideways, slower on the reaction time)
    S.off += clamp(wantD - S.off, -2.5 * dt, 2.5 * dt);
    S.wall = W.push;

    // --- steering: pure pursuit, further ahead the faster ---
    // (short at walking pace: pure pursuit cuts inside a tight bend by about look² ÷ 8 × its radius)
    const look = clamp(3.5 + 0.38 * Math.abs(speed), 4, 32);
    // (by distance along the line, not points: round a hairpin's inside the points bunch up)
    let ti = S.k;
    for (let j = 1, ds = 0; j < n; j++) { const i = wrap(S.k + j), d = Math.hypot(P[i].x - P[wrap(i - 1)].x, P[i].z - P[wrap(i - 1)].z); ds += d; ti = i; if (ds >= look || (!loop && i >= n - 1)) break; }
    const tp = P[ti], tn = P[wrap(ti + 1)];
    const nl = Math.hypot(tn.x - tp.x, tn.z - tp.z) || 1, nx = (tn.z - tp.z) / nl, nz = -(tn.x - tp.x) / nl;
    const [wx, wz] = [tp.x + nx * S.off, tp.z + nz * S.off];
    // (pursue works in the physics' frame: the target there)
    const [ox, oz] = frame.toWorld(0, 0), aim = pursue(vehicle, wx - ox, wz - oz);
    const damping = speed > 3 ? -0.6 * vehicle.wheelbase * (vehicle.yawRate - speed * aim.curve) / Math.max(speed, 5) : 0;
    let road = aim.angle + damping;
    const front = frontDirection(vehicle), reach = 1.2 * vehicle.peak.y;
    if (speed > 5) road = clamp(road, front - reach, front + reach);

    // --- speed: the plan (the driver's margins), a mistake, rubber-banding, traffic ---
    const adj = ctx.adjust?.(id) ?? { corner: 0, braking: 0 };
    // (the slowest it has to be anywhere within its braking distance, braked for from where it is: the
    // plan's own braking zones, and a margin for its reaction; braking late: as if that much further back)
    const m = S.mistakeNow && !S.mistakeNow.pending ? S.mistakeNow : null;
    const late = m?.kind === 'lateBrake' ? m.metres : 0, decel = caps.brake * K.brakingPoint * 0.85;
    const lag = Math.max(0, speed) * K.reactionTime * 0.5;
    const window = (Math.max(0, speed) ** 2 / (2 * decel) + lag + 8) / step;
    let target = Infinity, need = 0;
    for (let j = 0, ds = 0; j <= window && (loop || S.k + j < n); j++) {
      const i = wrap(S.k + j);
      if (j) ds += Math.max(0, P[i].s - P[wrap(i - 1)].s) || step;
      // (braking late: the braking point that much later, fading out to nothing at the bend itself — and
      // less into a slow bend; it arrives too fast, it doesn't fly off)
      const lateHere = late * Math.min(1, ds / (2 * late || 1)) * Math.min(1, (plan[i] / 20) ** 2);
      const room = Math.max(0, ds - lag + lateHere);
      target = Math.min(target, Math.sqrt(plan[i] ** 2 + 2 * decel * room));
      // (the slowing down it needs to make that point: the brake pedal's feed-forward)
      if (speed > plan[i]) need = Math.max(need, (speed * speed - plan[i] ** 2) / (2 * Math.max(1, room)));
    }
    const cornering = Math.abs(here.k) > 1 / 120, braking = target < speed - 1;
    target *= S.pace * Math.sqrt(1 + adj.corner) * (S.mood === 'rattled' ? 0.97 : 1);
    if (m?.kind === 'runWide' && cornering) target *= Math.sqrt(1 + M.runWide.extraGrip);
    target = Math.min(target, T.cap);
    S.target = target;
    maybeMistake(dt, braking, cornering);

    const err = target - speed;
    let throttle = err > -0.3 ? clamp(0.25 + err * 0.32, 0, 1) : 0;
    need = Math.max(need, T.need ?? 0);
    let brake = err < -0.8 || need > 0.25 * caps.brake ? clamp(need / caps.brake + Math.max(0, -err) * 0.2 * (1 + adj.braking * 4), 0, 1) : 0;
    if (brake > 0) throttle = 0;
    // the grip left over from cornering, shared out (and less throttle once it slides)
    const turning = Math.max(speed * speed * Math.abs(here.k), Math.abs(speed * vehicle.yawRate));
    const load = Math.min(1, turning / (caps.grip * G));
    const left = Math.max(0.2, Math.sqrt(1 - load * load));
    throttle = Math.min(throttle, left);
    brake = Math.min(brake, Math.max(0.3, left));
    const lat = v.x * rotate(q, [1, 0, 0])[0] + v.z * rotate(q, [1, 0, 0])[2], slide = Math.abs(Math.atan2(lat, Math.abs(speed) + 0.5));
    if (slide > 0.07 && speed > 5) throttle *= clamp(1 - (slide - 0.07) / 0.15, 0.1, 1);
    // mistakes the controls make: a lock-up (ABS off for a moment, the brake stamped), a spin (TC off, too
    // much throttle out of a bend)
    const A0 = S.aids ??= { abs: vehicle.aids.abs, tc: vehicle.aids.tc, esc: vehicle.aids.esc };
    Object.assign(vehicle.aids, A0);
    if (m?.kind === 'lockUp' && brake > 0.2) { vehicle.aids.abs = false; brake = 1; }
    // (throttle commitment: a less skilled driver doesn't use all of it once it's on the move — pulling
    // away and up a hill, everyone uses it all)
    throttle = Math.min(throttle, 1 - (1 - (K.throttle ?? 1)) * clamp((speed - 8) / 10, 0, 1));
    // (wheelspin at a standstill — a steep hill start: feathered, as a driver would)
    if (Math.abs(speed) < 2 && throttle > 0.3) {
      let spin = 0;
      for (const w of vehicle.wheels) spin = Math.max(spin, w.slipRatio ?? 0);
      if (spin > 0.4) throttle *= clamp(1 - (spin - 0.4) * 0.8, 0.45, 1);
    }
    if (m?.kind === 'spin' && cornering) { vehicle.aids.tc = false; vehicle.aids.esc = false; throttle = 1; }
    // smooth hands and feet (faster the better it reacts)
    const rate = dt / Math.max(0.05, K.reactionTime * 0.35);
    S.throttle += clamp(throttle - S.throttle, -rate * 2, rate * 2);
    S.brake += clamp(brake - S.brake, -rate * 3, rate * 3);
    if (S.brake > 0.05) S.throttle = Math.min(S.throttle, 0.05);
    return { device: 'wheel', wheelRange: wr, steer: steerInput(vehicle, road), throttle: clamp(S.throttle, 0, 1), brake: clamp(S.brake, 0, 1), handbrake: false };
  };

  driver.state = S;
  driver.id = id;
  driver.params = K;
  driver.setPlan = p => { plan = p; };
  driver.retire = () => { S.mode = 'retired'; };
  // put back on the route (the race's reset): where it is now on the line, a fresh start at recovering
  driver.placed = k => { S.k = k; S.wantsReset = false; S.tries = 0; S.stuck = 0; S.mode = 'race'; S.off = 0; S.tactic = null; };
  // a hit from another car: its mood for a while
  driver.hit = strength => {
    if (strength < 2 || K.onHit === 'calm') return;
    S.mood = K.onHit; S.moodUntil = S.t + config.personality.onHitSeconds;
    if (K.onHit === 'angry') S.overtakeTimer = K.overtakeEvery;
  };
  driver.tick = dt => { if (S.mood && S.t > S.moodUntil) S.mood = null; };
  return driver;
}
