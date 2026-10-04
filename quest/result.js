// What a finished (or failed) quest run hands on, and what a server will one day check: the quest and its
// version, the route's version, the car as it was set up, the start, the checkpoint times, the laps, the
// total, the penalties, the score, the damage taken, and where the recording is kept.
//
//   buildResult({ quest, course, outcome, car, recordingId, attemptId, now }) → result
//   questVersionOf(quest) → its version (it changes whenever the quest is edited)

export const RESULT_FORMAT = 1;

export const questVersionOf = quest => quest.updated ?? quest.publishedAt ?? String(quest.version ?? 0);

export function buildResult({ quest, course, outcome, car = {}, recordingId = null, attemptId = null, now = new Date().toISOString() }) {
  const r3 = x => x == null ? null : Math.round(x * 1000) / 1000;
  return {
    format: RESULT_FORMAT, attemptId, at: now,
    questId: quest.id, questVersion: questVersionOf(quest), type: quest.type,
    routeId: quest.route ?? null, routeVersion: course?.version ?? null,
    status: outcome.status, reason: outcome.reason ?? null,
    car: { carId: car.carId ?? null, instanceId: car.instanceId ?? null, fingerprint: car.fingerprint ?? null, className: car.className ?? null, kw: car.kw ?? null, kg: car.kg ?? null, topSpeed: car.topSpeed ?? null },
    start: { mode: outcome.startMode, jump: !!outcome.jump },
    checkpoints: (outcome.splits ?? []).map(s => ({ id: s.id, lap: s.lap, time: r3(s.time) })),
    laps: (outcome.laps ?? []).map(r3),
    rawTime: r3(outcome.rawTime), time: r3(outcome.time), penalties: (outcome.penalties ?? []).map(p => ({ what: p.what, seconds: p.seconds })),
    score: outcome.score ?? null, medal: outcome.medal ?? null,
    damage: { taken: Math.round((outcome.damage?.taken ?? 0) * 100) / 100, events: outcome.damage?.events ?? [] },
    ...(outcome.cargo != null ? { cargo: outcome.cargo, cargoLost: outcome.cargoLost } : {}),
    resets: outcome.resets ?? 0,
    // (a race: the place, and everyone's times — a server can check the place against them)
    ...(outcome.place != null ? { place: outcome.place, field: (outcome.field ?? []).map(f => ({ id: f.id, name: f.name, player: !!f.player, status: f.status, time: f.time != null ? r3(f.time) : null, estimated: !!f.estimated })) } : {}),
    recording: recordingId,
  };
}
