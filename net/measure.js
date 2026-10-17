// Measuring how smooth another car looks (Phase 7 Step 1; the tests and the network overlay). Per drawn frame:
//   - a SNAP is a jump the eye sees: the car shown somewhere other than where its own motion (last frame's position,
//     velocity and acceleration, over the time the frame showed) would put it, by more than NET.interp.snapCm or a
//     tenth of the frame's travel, whichever is more — or turned by more than 1.5° beyond its own spin. (Its own
//     motion: the shown time runs 90–110% of real time while the buffer settles — a car played a touch faster, not a
//     jump — and a correction eases it onto its path with an acceleration of its own, which a long frame — a busy
//     machine drawing 20–40 a second — stretches into centimetres without anything jumping);
//     A frame longer than LONG_FRAME_S (below 20 fps: the drawing machine itself stalled, and the eye sees that hitch
//     whatever the cars do) isn't judged — counted as longFrames instead;
//   - the ERROR is how far the shown car is from where it really was at the moment shown (its true path, from the
//     sender's side), which the interpolation keeps small and the prediction keeps bounded.
//
//   const M = createSmoothness({ snapCm })
//   M.frame(pose, dt, truthAt?)   pose: remote.sample's (pos, rot, vel, ang); truthAt(roomTime) → [x, y, z] or null
//   M.result() → { frames, snaps, longFrames, worstJumpCm, worstTurnDeg, errorP50Cm, errorP95Cm, errorMaxCm, extrapolatedShare, correctionMaxCm }

import { quat } from './remote.js';

const LONG_FRAME_S = 0.05;

export function createSmoothness({ snapCm = 10 } = {}) {
  let prev = null, longFrames = 0, frames = 0, snaps = 0, worstJump = 0, worstTurn = 0, extrap = 0, corrMax = 0, clock = 0;
  // (the frames drawn just before, newest last, { pos, t } with t the time each showed: where the car's own motion would
  // put it next is the curve through the last three — exact for a car speeding up, slowing or turning steadily, however
  // uneven the frames. Started afresh after anything that breaks the chain: no pose, a teleport, a long frame, a snap)
  let chain = [];
  const notes = [];                 // (the first few snaps: what was going on — for working out why)
  const errors = [];
  return {
    frame(pose, dt, truth = null) {
      if (!pose) { prev = null; chain = []; return; }
      frames++; clock += dt;
      if (pose.extrapolating) extrap++;
      corrMax = Math.max(corrMax, pose.correctionCm ?? 0);
      // (the time the frame showed: the pose's shown time, as the car's drawn velocity is; real time without one)
      const t = Number.isFinite(pose.shownAt) ? pose.shownAt / 1000 : clock;
      const [c2, c1] = chain.length >= 3 ? chain.slice(-3, -1) : [null, null], c0 = chain[chain.length - 1];
      if (prev && dt > LONG_FRAME_S) { longFrames++; chain = []; }
      else if (prev && !pose.teleported && c0 && t > c0.t) {         // (a reset is a jump on purpose)
        const st = t - c0.t;
        // its velocity as it left the last frame, and its acceleration: from the last three frames when there are
        // (each step's velocity is its middle's), else as the pose says
        let vAt = prev.vel, acc = [0, 0, 0];
        if (c1 && c2 && c0.t > c1.t && c1.t > c2.t) {
          const h1 = c0.t - c1.t, h0 = c1.t - c2.t;
          const va = [0, 1, 2].map(k => (c0.pos[k] - c1.pos[k]) / h1), vb = [0, 1, 2].map(k => (c1.pos[k] - c2.pos[k]) / h0);
          acc = [0, 1, 2].map(k => (va[k] - vb[k]) / ((h0 + h1) / 2));
          vAt = [0, 1, 2].map(k => va[k] + acc[k] * h1 / 2);
        }
        const exp = [0, 1, 2].map(k => c0.pos[k] + vAt[k] * st + 0.5 * acc[k] * st * st);
        const jump = Math.hypot(...[0, 1, 2].map(k => pose.pos[k] - exp[k])) * 100;
        const travel = Math.hypot(...vAt) * st * 100;
        const turnExp = quat.spin(prev.rot, prev.ang, st), turn = quat.angle(quat.mul(pose.rot, quat.conj(turnExp))) * 180 / Math.PI;
        worstJump = Math.max(worstJump, jump); worstTurn = Math.max(worstTurn, turn);
        if (jump > Math.max(snapCm, 0.1 * travel) || turn > 1.5) { snaps++; chain = []; if (notes.length < 8) notes.push({ frame: frames, jumpCm: +jump.toFixed(1), travelCm: +travel.toFixed(1), turnDeg: +turn.toFixed(2), dtMs: +(dt * 1000).toFixed(1), shownMs: +(st * 1000).toFixed(1), accMs2: +Math.hypot(...acc).toFixed(1), extrapolating: !!pose.extrapolating, correctionCm: +(pose.correctionCm ?? 0).toFixed(1), shownAt: pose.shownAt, prevShownAt: prev.shownAt, seg: pose.seg, prevSeg: prev.seg }); }
      }
      else if (pose.teleported) chain = [];
      chain.push({ pos: pose.pos, t }); if (chain.length > 3) chain.shift();
      if (truth) { const tr = truth(pose.shownAt); if (tr) { errors.push(Math.hypot(tr[0] - pose.pos[0], tr[1] - pose.pos[1], tr[2] - pose.pos[2]) * 100); if (snaps && notes.length && notes[notes.length - 1].frame === frames) notes[notes.length - 1].offTrueCm = +errors[errors.length - 1].toFixed(1); } }
      prev = pose;
    },
    result() {
      const e = [...errors].sort((a, b) => a - b), q = x => e.length ? e[Math.min(e.length - 1, Math.floor(e.length * x))] : 0;
      return { frames, snaps, longFrames, worstJumpCm: +worstJump.toFixed(1), worstTurnDeg: +worstTurn.toFixed(2), errorP50Cm: +q(0.5).toFixed(1), errorP95Cm: +q(0.95).toFixed(1), errorMaxCm: +(e[e.length - 1] ?? 0).toFixed(1), extrapolatedShare: frames ? +(extrap / frames).toFixed(3) : 0, correctionMaxCm: +corrMax.toFixed(1), notes };
    },
  };
}
