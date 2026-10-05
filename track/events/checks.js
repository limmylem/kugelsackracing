// Can a track event be published (Phase 5 Step 3)? Its track measured again (track/validate.js: the
// layout's rules; track/validateDress.js: nothing on the road or run-off, no gaps in the barriers) and the
// editor's AI test race (race/aiTest.js on the track: the rivals' race, then a solo lap at each skill) — the
// AI must finish, and where AIs crash, leave the track or get stuck is a problem corner, flagged. What it
// finds is kept with the event (item.track.check); content/quests.js trackLinkProblems won't publish an
// event without it, or with a failing track, or one the AI couldn't finish.
//
//   trackChecks(gen, cfg) → { trackOk, problems }
//   aiChecks(report, { course }) → { aiFinished, finishers, field, spots: [{ u, x, z, corner, message }], aiTimes }
//   eventCheck({ gen, data, report, course, cfg, now }) → item.track.check

import { checkTrack } from '../validate.js';
import { checkDressing } from '../validateDress.js';
import { dressTrack } from '../dress.js';
import { barrierRuns } from '../build2.js';
import { LIMITS as L1 } from '../gen/v1.js';
import { LIMITS as L2 } from '../gen/v2.js';
import { LIMITS as L3 } from '../gen/v3.js';
import { trackHash } from './hash.js';

const LIMITS = { 1: L1, 2: L2, 3: L3 };

export function trackChecks(gen, cfg) {
  if (!gen?.ok) return { trackOk: false, problems: [gen?.error ?? 'The track couldn\'t be made.'] };
  const problems = checkTrack(gen.track, gen.params, LIMITS[gen.version] ?? L2).map(p => `layout: ${p}`);
  if (gen.version >= 2) {
    const plan = dressTrack(gen, cfg), { runs } = barrierRuns(plan, gen.track, cfg);
    problems.push(...checkDressing(gen.track, plan, { runs }).map(p => `dressing: ${p}`));
  }
  return { trackOk: problems.length === 0, problems };
}

// (which corner a spot is at: the dressing's corners, by where along the track their apex is)
function cornerAt(data, u) {
  const C = data?.dress?.corners, n = data?.centre?.x?.length;
  if (!C?.length || !n) return null;
  const step = data.length / n;
  let best = null, bd = Infinity;
  C.forEach((c, k) => { const d = Math.abs(((c.apex % n) + n) % n * step - u); if (d < bd) { bd = d; best = k + 1; } });
  return bd < 150 ? best : null;
}
export function aiChecks(report, { data = null } = {}) {
  const field = report.standings ?? [], finishers = field.filter(f => f.status === 'finished').length;
  const levels = Object.keys(report.aiTimes ?? {});
  const solo = levels.length >= 3;
  const raced = field.length ? finishers >= Math.ceil(field.length / 2) : true;
  const spots = (report.spots ?? []).map(s => { const corner = cornerAt(data, s.u ?? 0); return { u: s.u, x: s.x, z: s.z, corner, kinds: s.kinds, message: `${corner ? `Turn ${corner}` : `${Math.round(s.u ?? 0)} m in`}: ${s.message}` }; });
  return { aiFinished: solo && raced, finishers, field: field.length, spots, aiTimes: report.aiTimes ?? {} };
}
export function eventCheck({ gen, data, report, cfg, now = new Date().toISOString() }) {
  const T = trackChecks(gen, cfg), A = report ? aiChecks(report, { data }) : { aiFinished: null, spots: [] };
  return { trackOk: T.trackOk, problems: T.problems.slice(0, 8), aiFinished: A.aiFinished, finishers: A.finishers ?? null, field: A.field ?? null, spots: A.spots.slice(0, 20), aiTimes: A.aiTimes ?? null, hash: data ? trackHash(data) : null, at: now };
}
