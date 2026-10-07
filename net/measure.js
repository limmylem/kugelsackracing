// Measuring how smooth another car looks (Phase 7 Step 1; the tests and the network overlay). Per drawn frame:
//   - a SNAP is a jump the eye sees: the car shown somewhere other than where its own motion (last frame's position
//     and velocity) would put it, by more than NET.interp.snapCm or a tenth of the frame's travel, whichever is more —
//     or turned by more than 1.5° beyond its own spin;
//   - the ERROR is how far the shown car is from where it really was at the moment shown (its true path, from the
//     sender's side), which the interpolation keeps small and the prediction keeps bounded.
//
//   const M = createSmoothness({ snapCm })
//   M.frame(pose, dt, truthAt?)   pose: remote.sample's (pos, rot, vel, ang); truthAt(roomTime) → [x, y, z] or null
//   M.result() → { frames, snaps, worstJumpCm, worstTurnDeg, errorP50Cm, errorP95Cm, errorMaxCm, extrapolatedShare, correctionMaxCm }

import { quat } from './remote.js';

export function createSmoothness({ snapCm = 10 } = {}) {
  let prev = null, frames = 0, snaps = 0, worstJump = 0, worstTurn = 0, extrap = 0, corrMax = 0;
  const notes = [];                 // (the first few snaps: what was going on — for working out why)
  const errors = [];
  return {
    frame(pose, dt, truth = null) {
      if (!pose) { prev = null; return; }
      frames++;
      if (pose.extrapolating) extrap++;
      corrMax = Math.max(corrMax, pose.correctionCm ?? 0);
      if (prev && !pose.teleported) {         // (a reset is a jump on purpose)
        const exp = [0, 1, 2].map(k => prev.pos[k] + prev.vel[k] * dt);
        const jump = Math.hypot(...[0, 1, 2].map(k => pose.pos[k] - exp[k])) * 100;
        const travel = Math.hypot(...prev.vel) * dt * 100;
        const turnExp = quat.spin(prev.rot, prev.ang, dt), turn = quat.angle(quat.mul(pose.rot, quat.conj(turnExp))) * 180 / Math.PI;
        worstJump = Math.max(worstJump, jump); worstTurn = Math.max(worstTurn, turn);
        if (jump > Math.max(snapCm, 0.1 * travel) || turn > 1.5) { snaps++; if (notes.length < 8) notes.push({ frame: frames, jumpCm: +jump.toFixed(1), travelCm: +travel.toFixed(1), turnDeg: +turn.toFixed(2), dtMs: +(dt * 1000).toFixed(1), extrapolating: !!pose.extrapolating, correctionCm: +(pose.correctionCm ?? 0).toFixed(1), shownAt: pose.shownAt, prevShownAt: prev.shownAt, seg: pose.seg, prevSeg: prev.seg }); }
      }
      if (truth) { const t = truth(pose.shownAt); if (t) errors.push(Math.hypot(t[0] - pose.pos[0], t[1] - pose.pos[1], t[2] - pose.pos[2]) * 100); }
      prev = pose;
    },
    result() {
      const e = [...errors].sort((a, b) => a - b), q = x => e.length ? e[Math.min(e.length - 1, Math.floor(e.length * x))] : 0;
      return { frames, snaps, worstJumpCm: +worstJump.toFixed(1), worstTurnDeg: +worstTurn.toFixed(2), errorP50Cm: +q(0.5).toFixed(1), errorP95Cm: +q(0.95).toFixed(1), errorMaxCm: +(e[e.length - 1] ?? 0).toFixed(1), extrapolatedShare: frames ? +(extrap / frames).toFixed(3) : 0, correctionMaxCm: +corrMax.toFixed(1), notes };
    },
  };
}
