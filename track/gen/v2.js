// Track generator, version 2 (Phase 5 Step 2: dressed tracks). FROZEN once released, like version 1.
//
// The layout is version 1's, from the same seed (track/gen/v1.js, itself frozen): a version-2 track and a
// version-1 track with the same seed and parameters have the same road. What version 2 adds is the
// dressing (track/dress.js: kerbs, run-off, barriers, the start and pit area, signs, scenery — chosen by
// the seed and the theme, part of the track's identity too), and one rule for the layout: a circuit
// asked to have a pit lane needs room for one beside its main straight (the pit wall, the lane, the
// garages behind it). Where the first layout hasn't the room, the next of a few seeds derived from this
// one is tried — still deterministic — and why each was passed over is logged with the attempts.
//
//   generate({ seed, params }) → { ok, track, attempts } (as version 1's; track.pit = { side } with a pit lane)
//   PIT: the pit complex's measures (m beyond the road's edge)

import * as v1 from './v1.js';
import { mix } from '../det.js';
import { frameOf, freeSpace } from './space.js';

export const VERSION = 2;
export const STYLES = v1.STYLES, LIMITS = v1.LIMITS;
// beyond the road's edge on the pit side: the pit wall's middle, the lane's far side (the garages' fronts),
// the garages' backs; along the main straight: where the entry lane leaves the track, how long it takes
// to reach the lane (the same for the exit, at the other end), and the longest it is (entry to exit: on a
// long straight it ends well before the straight does)
export const PIT = { wall: 2.5, wallThickness: 0.6, front: 14, back: 30, room: 32, from: 15, ramp: 45, length: 420, layouts: 12 };
// the pit lane's ends along the main straight (m): where the entry leaves the track, where the exit rejoins it
export const pitSpan = T => [PIT.from, Math.min(T.start.straight - PIT.from, PIT.from + PIT.length)];

// which side of the main straight has room for the pit complex: +1 left, −1 right, 0 neither
export function pitSide(T) {
  const F = frameOf(T), free = freeSpace(T, F, { reach: 120 }), W = T.width / 2, need = W + PIT.room;
  const [s0, s1] = pitSpan(T), a = Math.ceil(s0 / F.ds), b = Math.floor(s1 / F.ds);
  const ok = A => { for (let i = a; i <= b; i++) if (A[i] < need) return false; return true; };
  // (left first if both: the same every time)
  if (!T.closed || b - a <= (2 * PIT.ramp + 24) / F.ds) return 0;
  return ok(free.L) ? 1 : ok(free.R) ? -1 : 0;
}

export function generate({ seed, params }) {
  if (!(params.pitLane && params.type === 'circuit')) return v1.generate({ seed, params });
  const attempts = [];
  let last = null;
  for (let k = 0; k < PIT.layouts; k++) {
    const g = v1.generate({ seed: k ? mix(seed, 0x9175 + k) : seed, params });
    for (const a of g.attempts) attempts.push({ attempt: attempts.length, reason: a.reason });
    if (!g.ok) { last = g; continue; }
    const side = pitSide(g.track);
    if (side) { g.track.pit = { side }; g.track.stats.attempts = attempts.length; return { ok: true, track: g.track, attempts }; }
    attempts.at(-1).reason = 'no room for a pit lane beside its main straight';
  }
  return { ok: false, error: `No layout with room for a pit lane in ${PIT.layouts} layouts${last ? ` (last: ${last.error})` : ''}`, attempts };
}
