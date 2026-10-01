// Slipstream: a car in another car's wake drives into slower, stirred-up air — less drag (the tow)
// and a little less downforce (dirty air). The wake trails behind each car along its direction of
// travel and widens with distance; the effect is full up to `peak` metres behind and fades out by
// `reach`, and falls away toward the wake's edges. Works for any cars (player, AI, multiplayer).
//
// cars: [{ pos: [x, y, z], vel: [x, y, z] }], S: the follower's aero.slipstream settings.
// Returns { amount (0..1), drag (share of drag removed), downforce (share of downforce removed) }.

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function slipstream(follower, others, S) {
  let amount = 0;
  const fv = Math.hypot(follower.vel[0], follower.vel[2]);
  if (fv < S.minSpeed) return { amount: 0, drag: 0, downforce: 0 };
  for (const lead of others) {
    const lv = Math.hypot(lead.vel[0], lead.vel[2]);
    if (lv < S.minSpeed) continue;
    const dx = lead.vel[0] / lv, dz = lead.vel[2] / lv;                   // the leader's direction of travel
    if ((follower.vel[0] * dx + follower.vel[2] * dz) / fv < 0.8) continue; // not going the same way
    const rx = follower.pos[0] - lead.pos[0], rz = follower.pos[2] - lead.pos[2];
    const behind = -(rx * dx + rz * dz);                                    // metres behind the leader
    if (behind < S.minGap || behind > S.reach) continue;
    const lateral = Math.hypot(rx + dx * behind, rz + dz * behind);         // off the wake's centre line
    const width = S.width + S.spread * behind;
    const inWake = 1 - smoothstep(0.5 * width, width, lateral);
    const near = 1 - smoothstep(S.peak, S.reach, behind);
    amount = Math.max(amount, inWake * near);
  }
  return { amount, drag: S.maxDragCut * amount, downforce: S.maxDownforceLoss * amount };
}
