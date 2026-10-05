// The best lap's ghost (Phase 5 Step 3): out of a recorded run (quest/recording.js, the Phase 4 format),
// the stretch of its best lap made a recording of its own — its clock from the lap's start — and where the
// ghost car is at any moment of a lap (between two samples, eased). Pure.
//
//   lapGhost(recording, laps: [s], which = best) → a recording (kr-ghost-2) of that lap, meta.lap: { n, time }
//   ghostFrames(recording) → frames (decodeRecording)      ghostAt(frames, t) → { x, y, z, q, heading } | null

import { decodeRecording, createRecorder, migrateRecording } from '../../quest/recording.js';

export function lapGhost(recording, laps, which = null) {
  if (!recording || !laps?.length) return null;
  const rec = migrateRecording(recording), frames = decodeRecording(rec);
  const n = which ?? laps.indexOf(Math.min(...laps)), t0 = laps.slice(0, n).reduce((a, b) => a + b, 0), t1 = t0 + laps[n];
  const R = createRecorder({ hz: rec.hz });
  for (const f of frames) if (f.t >= t0 - 1e-9 && f.t <= t1 + 1e-9) R.sample(f.t - t0, f);
  if (!R.frames) return null;
  return R.finish({ ...rec.meta, lap: { n: n + 1, time: laps[n] } });
}

export const ghostFrames = recording => recording ? decodeRecording(recording) : [];

export function ghostAt(frames, t) {
  if (!frames?.length || t < 0) return null;
  const hz = frames.length > 1 ? 1 / (frames[1].t - frames[0].t) : 20, i = Math.floor(t * hz);
  if (i >= frames.length - 1) return null;
  const a = frames[i], b = frames[i + 1], f = Math.max(0, Math.min(1, (t - a.t) * hz)), mix = (u, v) => u + (v - u) * f;
  // (the rotation: the shorter way between the two)
  const dot = a.q[0] * b.q[0] + a.q[1] * b.q[1] + a.q[2] * b.q[2] + a.q[3] * b.q[3], s = dot < 0 ? -1 : 1;
  const q = [0, 1, 2, 3].map(k => mix(a.q[k], s * b.q[k])), m = Math.hypot(...q) || 1;
  const qq = q.map(v => v / m), fx = 2 * (qq[0] * qq[2] + qq[3] * qq[1]), fz = 1 - 2 * (qq[0] * qq[0] + qq[1] * qq[1]);
  return { x: mix(a.x, b.x), y: mix(a.y, b.y), z: mix(a.z, b.z), q: qq, heading: Math.atan2(fx, fz) * 180 / Math.PI };
}
