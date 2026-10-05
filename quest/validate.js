// Is a result one the game believes, pure (so a server can run the same checks later): the right quest
// and version, the route as it is now, every required checkpoint in order on every lap, times that only
// go up, and nothing faster than the route allows — each stretch at least its length at the car's top
// speed (with a little in hand: data/quests.json validation). An invalid result pays nothing.
//
//   validateResult(result, { quest, course, config }) → { ok, problems: [text] }

import { questVersionOf } from './result.js';

export function validateResult(result, { quest, course, config }) {
  const problems = [], V = config.validation ?? {}, bad = t => problems.push(t);
  if (!result || typeof result !== 'object') return { ok: false, problems: ['No result.'] };
  if (result.questId !== quest.id) bad(`The result is for another quest (${result.questId}).`);
  if (result.questVersion !== questVersionOf(quest)) bad('The quest has changed since the run started.');
  if (!course || result.routeVersion !== course.version) bad(`The route has changed since the run started (version ${result.routeVersion}, now ${course?.version}).`);
  if (result.status !== 'finished') bad(`The run didn't finish (${result.status}).`);
  // a generated track: the one the event is on, as made — the same code, the same hash (a player whose
  // track was made differently drives something else: track/events/hash.js)
  if (quest.track) {
    if (result.track?.code !== quest.track.code) bad(`The result is for another track (${result.track?.code ?? 'none'}).`);
    else if (!result.track?.hash || (quest.track.hash && result.track.hash !== quest.track.hash) || (course?.trackHash && result.track.hash !== course.trackHash)) bad(`The track driven isn't the event's: its hash (${result.track?.hash ?? 'none'}) isn't ${quest.track.hash ?? course?.trackHash} — a mismatched track pays nothing.`);
  }
  if (problems.length) return { ok: false, problems };

  const loop = course.loop, L = course.length, startS = course.grid.startS;
  const lapLength = loop ? L : course.grid.finishS - startS;
  const laps = loop ? Math.max(1, quest.params?.laps ?? 1) : 1;
  const rel = s => loop ? (((s - startS) % L) + L) % L : s - startS;
  const required = course.gates.filter(g => g.required).map(g => ({ id: g.id, r: rel(g.s) })).sort((a, b) => a.r - b.r);
  // every required checkpoint, in order, lap after lap
  const want = [];
  for (let lap = 1; lap <= laps; lap++) for (const g of required) want.push({ id: g.id, lap, u: (lap - 1) * lapLength + g.r });
  const got = result.checkpoints ?? [];
  // (a drift whose clock ran out ends where the car was: the checkpoints up to there, in order)
  const partial = result.type === 'drift' && result.reason === 'time';
  if (partial ? got.length > want.length : got.length !== want.length) bad(`${got.length} checkpoint times for ${want.length} checkpoints.`);
  else for (let i = 0; i < got.length; i++) if (got[i].id !== want[i].id || got[i].lap !== want[i].lap) { bad(`Checkpoint ${i + 1} out of order (${got[i].id}, lap ${got[i].lap}).`); break; }
  if (partial ? (result.laps ?? []).length > laps : (result.laps ?? []).length !== laps) bad(`${(result.laps ?? []).length} laps for ${laps}.`);
  const total = result.rawTime;
  if (!(total > 0) || !Number.isFinite(total)) bad('No time.');
  if (problems.length) return { ok: false, problems };
  const times = got.map(c => c.time);
  for (let i = 0; i < times.length; i++) if (!(times[i] > (i ? times[i - 1] : 0)) || times[i] > total) { bad(`Checkpoint ${i + 1}'s time (${times[i]}) is out of order.`); break; }
  const lapSum = result.laps.reduce((a, b) => a + b, 0);
  if (partial ? lapSum > total + 0.01 : Math.abs(lapSum - total) > 0.01) bad(`The laps (${lapSum.toFixed(3)} s) don't add up to the time (${total.toFixed(3)} s).`);
  if (result.time != null && Math.abs(result.time - total - (result.penalties ?? []).reduce((a, p) => a + p.seconds, 0)) > 0.002) bad('The penalties don\'t add up.');

  // nothing faster than the car could go: each stretch (start → checkpoint → … → finish) at top speed
  const top = Math.max(result.car?.topSpeed ?? 0, (V.minTopSpeedKmh ?? 120) / 3.6) * (V.topSpeedSlack ?? 1.15);
  // (a rolling start crosses the line already going: from the line; a standing one starts behind it)
  const marks = [{ u: 0, t: 0 }, ...got.map((w, i) => ({ u: want[i].u, t: times[i] })), ...(partial ? [] : [{ u: laps * lapLength, t: total }])];
  for (let i = 1; i < marks.length; i++) {
    const d = marks[i].u - marks[i - 1].u, dt = marks[i].t - marks[i - 1].t, least = d / top;
    if (dt < least - 1e-6) { bad(`Impossible time: ${Math.round(d)} m in ${dt.toFixed(2)} s (at least ${least.toFixed(2)} s at ${Math.round(top * 3.6)} km/h).`); break; }
  }
  // a score no drift could make: the most points a second there are, all the time
  if (result.score != null) {
    const D = config.drift, most = D ? D.pointsPerSecond * 4 * D.comboMax * total : Infinity;
    if (!(result.score >= 0) || result.score > most) bad(`Impossible score: ${result.score}.`);
  }
  // a race: the place is what the times say (everyone who finished faster, ahead; then the player)
  if (result.place != null) {
    const ahead = (result.field ?? []).filter(f => !f.player && f.status === 'finished' && f.time != null && f.time < result.time).length;
    if (result.place !== ahead + 1) bad(`The place (${result.place}) isn't what the times say (${ahead + 1}).`);
  }
  if (result.cargoLost != null && !(result.cargoLost >= 0 && result.cargoLost <= 1)) bad('Impossible cargo condition.');
  return { ok: problems.length === 0, problems };
}
