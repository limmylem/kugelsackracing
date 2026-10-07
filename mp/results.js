// A multiplayer race's results, after the race (Phase 7 Step 2; docs/MULTIPLAYER.md "Results"), pure: the API runs
// it, and the tests.
//
// Straight after the race the standings are provisional (the race server's own: mp/race.js results()). Each player's
// game then hands in its run (quest/result.js, with its recording); the API checks it (quest/validate.js, the Phase 6
// Step 3 rules against the course the server raced) and against what the race server saw (its time, within
// toleranceMs; nothing flagged by the live checks). Once every player's is in, or the wait is over, the results are
// confirmed: a finisher whose run fails the check — or who never handed one in — is disqualified (DSQ), below the
// DNFs, and everyone behind them moves up. NPCs' results are the server's own.
//
//   confirmResults(provisional, verdicts, { toleranceMs }) → [{ …, place, provisionalPlace, status: finished | dnf | dsq, verified, problems }]
//     verdicts: { [uid]: { ok, problems, timeMs } }    (a human finisher missing from it: not handed in)
//   ratingOrder(confirmed) → [{ uid, rank }]   the humans in the order the rating update uses (ties share a rank; leavers
//                                              and the disqualified last)
//   payFor(confirmed, rules, { ranked, humans, npcs, km, todayRaces }) → { [uid]: { money, xp, why } }   (rules: economy
//                                              config multiplayer; each finisher's car class from its result's car.cls)

export function confirmResults(provisional, verdicts, { toleranceMs = 300 } = {}) {
  const out = provisional.map(r => {
    if (r.npc) return { ...r, provisionalPlace: r.place, verified: null, problems: [] };
    const v = verdicts?.[r.uid];
    const problems = [];
    if (r.status === 'finished') {
      if (!v) problems.push('No run handed in for this race.');
      else {
        if (!v.ok) problems.push(...(v.problems?.length ? v.problems : ['The run didn\'t pass the check.']));
        if (v.timeMs != null && r.timeMs != null && Math.abs(v.timeMs - r.timeMs) > toleranceMs) problems.push(`The run's time (${(v.timeMs / 1000).toFixed(3)} s) isn't what the race server saw (${(r.timeMs / 1000).toFixed(3)} s).`);
      }
      for (const f of r.flags ?? []) if (f.kind === 'progress') { problems.push('Moved further along the route than the car could have.'); break; }
    }
    const dsq = r.status === 'finished' && problems.length > 0;
    return { ...r, provisionalPlace: r.place, status: dsq ? 'dsq' : r.status, verified: r.status === 'finished' ? !dsq : null, problems };
  });
  const rank = r => r.status === 'finished' ? 0 : r.status === 'dnf' ? 1 : 2;
  out.sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? a.timeMs - b.timeMs : a.provisionalPlace - b.provisionalPlace));
  out.forEach((r, i) => { r.place = i + 1; });
  return out;
}

export function ratingOrder(confirmed) {
  const humans = confirmed.filter(r => !r.npc);
  const key = r => r.leftEarly || r.status === 'dsq' ? 'last' : r.status === 'finished' ? `f${r.place}` : `d${r.place}`;
  let rank = 0, prev = null;
  // (finishers by place; then the out by place; leavers and the disqualified share last)
  const sorted = [...humans].sort((a, b) => (a.leftEarly || a.status === 'dsq' ? 1 : 0) - (b.leftEarly || b.status === 'dsq' ? 1 : 0) || a.place - b.place);
  return sorted.map(r => { const k = key(r); if (k !== prev) { rank++; prev = k; } return { uid: r.uid, rank }; });
}

export function payFor(confirmed, rules, { ranked = false, humans = 1, npcs = 0, km = 3, todayRaces = {} } = {}) {
  const out = {}, field = humans + npcs * rules.npcShare, distance = rules.base + rules.perKm * Math.min(rules.maxKm, Math.max(0, km));
  const fieldFactor = 1 + rules.perOpponent * Math.max(0, field - 1);
  const modeFactor = ranked ? rules.ranked : rules.unranked;
  for (const r of confirmed) {
    if (r.npc || r.guest && rules.guests === false) continue;
    if (r.status !== 'finished') { out[r.uid] = { money: 0, xp: r.leftEarly ? 0 : rules.xp.dnf, why: r.status === 'dsq' ? 'Disqualified: no pay.' : r.leftEarly ? 'Left the race.' : 'Didn\'t finish.' }; continue; }
    const share = rules.places[Math.min(rules.places.length - 1, r.place - 1)];
    const n = todayRaces[r.uid] ?? 0, daily = n < rules.dailyFull ? 1 : rules.afterDaily;
    const cls = rules.byClass[r.car?.cls] ?? 1;
    const money = Math.round(distance * cls * share * fieldFactor * modeFactor * daily / 10) * 10;
    const xp = Math.round((rules.xp.base + rules.xp.perPlaceAbove * Math.max(0, confirmed.filter(x => x.status === 'finished').length - r.place)) * daily);
    out[r.uid] = { money, xp, why: `P${r.place} of ${confirmed.length}${daily < 1 ? ` (after ${rules.dailyFull} races today: ${Math.round(rules.afterDaily * 100)}%)` : ''}` };
  }
  return out;
}
