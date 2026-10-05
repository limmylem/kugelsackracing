// Endurance (Phase 5 Step 3, the framework): a long race on a generated circuit, split into stints
// (params.stints: equal shares of the laps). What it has now: the laps, the stint each lap is in, each
// stint's time and best lap — in the HUD and the result. What comes later: driver changes, fuel and tyres,
// and the pit stop each stint ends with (the track's pit lane, track/dress.js).
export const stintOf = (lap, laps, stints) => Math.min(stints, Math.floor(lap / Math.max(1, laps / stints)) + 1);

export default {
  id: 'endurance',
  init: S => ({ stints: Math.max(1, Math.min(S.laps, S.quest.params?.stints ?? 1)) }),
  finish(S) {
    const out = [];
    S.lapTimes.forEach((t, i) => { const k = stintOf(i, S.laps, S.stints) - 1; const o = out[k] ??= { stint: k + 1, laps: 0, time: 0, best: Infinity }; o.laps++; o.time += t; o.best = Math.min(o.best, t); });
    return { stints: out.filter(Boolean).map(o => ({ ...o, time: Math.round(o.time * 1000) / 1000, best: Math.round(o.best * 1000) / 1000 })) };
  },
  hud: S => ({ kind: 'endurance', lap: Math.min(S.laps, S.lap + 1), laps: S.laps, stint: stintOf(S.lap, S.laps, S.stints), stints: S.stints }),
};
