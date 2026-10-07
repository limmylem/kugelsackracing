// Another player's car, shown smoothly (Phase 7 Step 1; docs/MULTIPLAYER.md "Showing other cars"). Snapshot
// interpolation: its states are kept by the server time they were sampled at, and the car is shown a little in the
// past, between two of them. How far in the past adapts to the states' delay as measured: far enough back that
// nearly every state (95%) is in before it's needed — the buffer above the usual delay grows with the jitter, and
// with the stalls a lost packet causes on a WebSocket. It changes by a few percent of real time at most (the car
// plays a touch faster or slower, never skips). When states are late anyway, the car is predicted ahead from its last
// one (velocity, acceleration, spin) for up to half a second, then eases to a stop. When the real ones arrive, the car
// is steered from the path it was shown on to the real one (projective velocity blending): its position AND its
// speed change smoothly, over longer the bigger the difference. Nothing ever jumps, except on purpose (a reset).
//
//   const R = createRemote({ interp: NET.interp, sendHz })
//   R.push(state, arrivedAt)   a state (codec.dequantise; world frame) and the room time it arrived (ms)
//   R.sample(roomNow, dtSec) → { pos, rot, vel, ang, steer, throttle, brake, gear, rpm, wheels, flags,
//                                extrapolating, staleMs, correctionCm, bufferMs, delayMs }  (null before any state)
//   R.teleport()               the next state is a jump (a reset): shown at once, not blended
//   R.stats                    { lagP50, lagP95, bufferMs, delayMs, corrections, maxCorrectionCm, extrapolatedMs }

const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  len: a => Math.hypot(a[0], a[1], a[2]),
  lerp: (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u],
};
export const quat = {
  mul([ax, ay, az, aw], [bx, by, bz, bw]) { return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz]; },
  conj: ([x, y, z, w]) => [-x, -y, -z, w],
  norm(q) { const l = Math.hypot(...q) || 1; return q.map(x => x / l); },
  slerp(a, b, u) {
    let [bx, by, bz, bw] = b, d = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
    if (d < 0) { d = -d; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    if (d > 0.9995) return quat.norm([a[0] + (bx - a[0]) * u, a[1] + (by - a[1]) * u, a[2] + (bz - a[2]) * u, a[3] + (bw - a[3]) * u]);
    const th = Math.acos(d), s = Math.sin(th), k0 = Math.sin((1 - u) * th) / s, k1 = Math.sin(u * th) / s;
    return [a[0] * k0 + bx * k1, a[1] * k0 + by * k1, a[2] * k0 + bz * k1, a[3] * k0 + bw * k1];
  },
  // q turned by a world-frame spin w (rad/s) for dt seconds
  spin(q, w, dt) {
    const a = v3.len(w) * dt;
    if (a < 1e-9) return q;
    const s = Math.sin(a / 2) / (a / dt), r = [w[0] * s, w[1] * s, w[2] * s, Math.cos(a / 2)];
    return quat.norm(quat.mul(r, q));
  },
  angle(q) { return 2 * Math.acos(Math.min(1, Math.abs(q[3]))); },
};

const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
const LAGS = 150, KEEP_MS = 4000, TELEPORT_M = 20, A_MAX = 15, STOP_TAU = 0.5;
const smooth = u => u * u * (3 - 2 * u);
// a world-frame spin (rad/s) taking rotation a to b in dt seconds
quat.between = (a, b, dt) => {
  let d = quat.mul(b, quat.conj(a)); if (d[3] < 0) d = d.map(x => -x);
  const s = Math.hypot(d[0], d[1], d[2]); if (s < 1e-9 || dt <= 0) return [0, 0, 0];
  const ang = 2 * Math.atan2(s, d[3]) / dt; return [d[0] / s * ang, d[1] / s * ang, d[2] / s * ang];
};

export function createRemote({ interp, sendHz = 30 } = {}) {
  const I = interp, interval = 1000 / sendHz;
  const buf = [];                       // states, oldest first, by time
  const lags = [];
  let delay = null, target = I.startBufferMs, lastT = null, jump = false, rate = 1, teleported = false;
  let shown = null;                     // what was drawn last frame: { pos, rot, vel, ang } (vel/ang: as drawn)
  let blend = null;                     // a correction under way: from the path shown { t0, T, p0, v0, q0, w0 } to the real one
  const stats = { lagP50: 0, lagP95: 0, bufferMs: I.startBufferMs, delayMs: 0, corrections: 0, maxCorrectionCm: 0, extrapolatedMs: 0, states: 0 };

  // the car's state at room time t from the states alone (no blending)
  function raw(t) {
    const n = buf.length;
    if (!n) return null;
    if (t <= buf[0].time) return { ...buf[0], extrapolating: false, staleMs: 0 };
    let i = n - 1;
    if (t < buf[i].time) {
      while (i > 0 && buf[i - 1].time > t) i--;
      const a = buf[i - 1], b = buf[i], span = (b.time - a.time) / 1000, u = span > 0 ? (t - a.time) / (b.time - a.time) : 1;
      // position: a Hermite curve through both, with their velocities as its tangents (smooth, follows the
      // car's real path through corners, unlike a straight line between points)
      const u2 = u * u, u3 = u2 * u, h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
      // (the tangents no longer than the positions bear out: a sender whose game can't keep up — its physics running
      // slower than real time — sends speeds its positions don't match, and full tangents would overshoot and wobble)
      const chord = v3.len(v3.sub(b.pos, a.pos)), lim = (v) => { const l = v3.len(v) * span; return l > 1e-6 ? Math.min(1, 1.25 * chord / l) : 1; };
      const ta = span * lim(a.vel), tb = span * lim(b.vel);
      const pos = [0, 1, 2].map(k => h00 * a.pos[k] + h10 * ta * a.vel[k] + h01 * b.pos[k] + h11 * tb * b.vel[k]);
      const near = u < 0.5 ? a : b, L = (x, y) => x + (y - x) * u;
      return {
        pos, rot: quat.slerp(a.rot, b.rot, u), vel: v3.lerp(a.vel, b.vel, u), ang: v3.lerp(a.ang, b.ang, u),
        steer: L(a.steer, b.steer), throttle: L(a.throttle, b.throttle), brake: L(a.brake, b.brake), gear: near.gear, rpm: L(a.rpm, b.rpm),
        wheels: b.wheels.map((w, k) => { const x = a.wheels[k] ?? w; return { omega: L(x.omega, w.omega), length: L(x.length, w.length), slip: L(x.slip, w.slip), grounded: (u < 0.5 ? x : w).grounded }; }),
        flags: near.flags, extrapolating: false, staleMs: 0, seg: [a.time, b.time],
      };
    }
    // past the newest: predicted ahead from it, for a while; then easing to a stop
    let s = buf[n - 1];
    const prev = buf[n - 2];
    // (its speed as its positions show it, if that's well below what it says: a sender whose game can't keep up
    // reports its physics' speed, but covers less ground a real second — predicting at the reported speed would
    // overshoot, then pull back)
    if (prev && s.time > prev.time) {
      const seen = v3.len(v3.sub(s.pos, prev.pos)) / ((s.time - prev.time) / 1000), said = v3.len(s.vel);
      if (said > 1 && seen < 0.7 * said) { const k = Math.max(0.1, seen / said); s = { ...s, vel: v3.scale(s.vel, k), ang: v3.scale(s.ang, k) }; }
    }
    const ahead = (t - s.time) / 1000, cap = I.maxExtrapolateMs / 1000, d = Math.min(ahead, cap);
    let acc = [0, 0, 0];
    if (prev && s.time > prev.time) { acc = v3.scale(v3.sub(s.vel, prev.vel), 1000 / (s.time - prev.time)); const l = v3.len(acc); if (l > A_MAX) acc = v3.scale(acc, A_MAX / l); }
    // (the acceleration fades over the prediction: a car braking into a corner doesn't reverse)
    const fade = Math.max(0, 1 - d / (2 * cap));
    let pos = v3.add(s.pos, v3.add(v3.scale(s.vel, d), v3.scale(acc, 0.5 * d * d * fade)));
    let vel = v3.add(s.vel, v3.scale(acc, d * fade));
    let rot = quat.spin(s.rot, s.ang, d), ang = s.ang;
    if (ahead > cap) {
      const e = ahead - cap, k = STOP_TAU * (1 - Math.exp(-e / STOP_TAU)), f = Math.exp(-e / STOP_TAU);
      pos = v3.add(pos, v3.scale(vel, k)); rot = quat.spin(rot, ang, k);
      vel = v3.scale(vel, f); ang = v3.scale(ang, f);
    }
    return { ...s, pos, rot, vel, ang, extrapolating: true, staleMs: ahead * 1000 };
  }

  return {
    push(state, arrivedAt) {
      if (buf.some(s => s.time === state.time)) return;
      if (buf.length && state.time < buf[0].time) return;               // (too late to be any use)
      const lag = arrivedAt - state.time;
      lags.push(lag); if (lags.length > LAGS) lags.shift();
      const sorted = [...lags].sort((a, b) => a - b), p50 = pct(sorted, 0.5), p95 = pct(sorted, 0.95);
      stats.lagP50 = p50; stats.lagP95 = p95;
      // far enough back that 95% of states are in before they're needed (and the next one too)
      target = Math.max(p50 + I.minBufferMs, Math.min(p50 + I.maxBufferMs, p95 + interval / 2));
      stats.bufferMs = target - p50;
      if (delay == null) { delay = Math.max(target, lag + I.startBufferMs); target = delay; }
      const before = lastT != null && !jump ? raw(lastT) : null;
      let k = buf.length;
      while (k > 0 && buf[k - 1].time > state.time) k--;
      buf.splice(k, 0, state);
      while (buf.length > 2 && buf[buf.length - 1].time - buf[1].time > KEEP_MS && (lastT == null || buf[1].time < lastT)) buf.shift();
      stats.states++;
      if (jump) { jump = false; blend = null; shown = null; lastT = null; teleported = true; return; }
      // the real path moved under what was shown (a late state replaced a prediction): steer across to it from where
      // the car is shown, over longer the bigger the difference
      if (before && shown) {
        const after = raw(lastT), d = v3.len(v3.sub(before.pos, after.pos)), turn = quat.angle(quat.mul(before.rot, quat.conj(after.rot)));
        if (d > TELEPORT_M) { blend = null; }
        else if (d > 5e-4 || turn > 5e-4) {
          const dv = v3.len(v3.sub(shown.vel, after.vel));
          const T = Math.min(1500, Math.max(I.blendMs, 300 * Math.sqrt(d) + 15 * dv, 2000 * turn));
          blend = { t0: lastT, T, p0: shown.pos, v0: shown.vel, q0: shown.rot, w0: shown.ang };
          stats.corrections++;
        }
      }
    },
    sample(roomNow, dt) {
      // (shown once there are two states to move between: a car appears, rather than sitting on its first state and
      // then setting off with a step)
      if (buf.length < 2) return null;
      // The shown time: it follows (room time − the delay wanted) through its RATE — how fast it runs against real time,
      // 90–110%, changed by at most 0.3 a second (half a percent a frame at 60 fps; as fast in real time on a machine
      // drawing a few frames a second, which would otherwise take many seconds to catch up) — so a new delay, the clock's estimate settling just after
      // joining, or a slewed correction are all taken up smoothly; the car never speeds up or slows down visibly. A long
      // gap (the tab was in the background) resets it.
      const want = roomNow - target;
      let t;
      if (lastT == null || Math.abs(want - (lastT + dt * 1000)) > 2000) { t = want; rate = 1; }
      else {
        const err = want - (lastT + dt * 1000 * rate);
        const wantRate = 1 + Math.max(-0.1, Math.min(0.1, err / 500));
        const step = Math.min(0.1, 0.3 * dt);
        rate += Math.max(-step, Math.min(step, wantRate - rate));
        t = lastT + dt * 1000 * rate;
      }
      delay = roomNow - t;
      const r = raw(t);
      let pos = r.pos, rot = r.rot, corr = 0;
      if (blend) {
        const u = (t - blend.t0) / blend.T;
        if (u >= 1) blend = null;
        else {
          const e = (t - blend.t0) / 1000, w = smooth(Math.max(0, u));
          const oldP = v3.add(blend.p0, v3.scale(blend.v0, e)), oldQ = quat.spin(blend.q0, blend.w0, e);
          pos = v3.lerp(oldP, r.pos, w); rot = quat.slerp(oldQ, r.rot, w);
          corr = v3.len(v3.sub(pos, r.pos)) * 100;
        }
      }
      // (the car's motion as drawn: what the next correction starts from, and what the eye follows)
      const fdt = lastT != null ? (t - lastT) / 1000 : 0;
      const vel = shown && fdt > 1e-4 ? v3.scale(v3.sub(pos, shown.pos), 1 / fdt) : r.vel;
      const ang = shown && fdt > 1e-4 ? quat.between(shown.rot, rot, fdt) : r.ang;
      shown = { pos, rot, vel, ang };
      lastT = t;
      stats.maxCorrectionCm = Math.max(stats.maxCorrectionCm, corr); stats.lastCorrectionCm = corr;
      if (r.extrapolating) stats.extrapolatedMs += dt * 1000;
      stats.delayMs = delay;
      const tp = teleported; teleported = false;
      return { ...r, pos, rot, vel, ang, correctionCm: corr, bufferMs: stats.bufferMs, delayMs: delay, shownAt: t, teleported: tp };
    },
    teleport() { jump = true; },
    get newest() { return buf[buf.length - 1] ?? null; },
    get stats() { return stats; },
    get buf() { return buf; },
  };
}
