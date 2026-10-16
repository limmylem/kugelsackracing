// An Expedition's stages (docs/ROADBOOK.md), one point driven at a time: where the player is against the stage
// they're on. The state is plain data, kept between sessions (a stage today, the next tomorrow):
//   { stage: index, stageStartedAt: ms, collected: [item ids], run: { startedAt, next } | null, done, doneAt, times: { stageId: ms } }
//
//   expeditionStep(exp, state, { lat, lon, at }) → { state, completed: [{ stage, timeMs? }], notices: [{ kind, text }] }
//
// Stage types: reach and clue (within the location's radius), collect (every item, any order), checkpoints (a timed run:
// it starts at the first checkpoint, each next one in order, the last within timeLimitSec — late, and it starts again).
// (The points come only from the server's believed track: roadbook/geo.js.)

import { metresBetween } from './geo.js';

export function newExpedition(exp, now) {
  return { stage: 0, stageStartedAt: now, collected: [], run: null, done: false, doneAt: null, times: {} };
}

// the current stage, and where to go next (for the game's marker, the journal and the debug teleport): its target
// points — a clue's only once revealed (the game asks with the player's distance)
export function currentStage(exp, state) { return state?.done ? null : exp.stages[state?.stage ?? 0] ?? null; }
export function stageTargets(stage, state) {
  if (!stage) return [];
  if (stage.type === 'collect') return stage.items.filter(i => !(state?.collected ?? []).includes(i.id)).map(i => ({ id: i.id, name: i.name, lat: i.lat, lon: i.lon, radius: stage.radius ?? 25 }));
  if (stage.type === 'checkpoints') { const k = state?.run?.next ?? 0; const c = stage.checkpoints[k]; return c ? [{ id: `cp${k}`, name: k === 0 ? 'Start' : k === stage.checkpoints.length - 1 ? 'Finish' : `Checkpoint ${k}`, lat: c.lat, lon: c.lon, radius: stage.radius ?? 30 }] : []; }
  return [{ id: stage.id, name: stage.name, lat: stage.location.lat, lon: stage.location.lon, radius: stage.location.radius ?? 50 }];
}

export function expeditionStep(exp, state0, pt) {
  const state = JSON.parse(JSON.stringify(state0)), completed = [], notices = [];
  const stage = currentStage(exp, state);
  if (!stage) return { state, completed, notices };
  const within = (p, r) => metresBetween(pt, p) <= r;
  const advance = (timeMs = null) => {
    completed.push({ stage: stage.id, ...(timeMs != null ? { timeMs } : {}) });
    if (timeMs != null) state.times[stage.id] = timeMs;
    state.stage++;
    state.stageStartedAt = pt.at;
    state.collected = [];
    state.run = null;
    if (state.stage >= exp.stages.length) { state.done = true; state.doneAt = pt.at; }
  };
  if (stage.type === 'reach' || stage.type === 'clue') {
    if (within(stage.location, stage.location.radius ?? 50)) advance();
  } else if (stage.type === 'collect') {
    for (const it of stage.items) if (!state.collected.includes(it.id) && within(it, stage.radius ?? 25)) { state.collected.push(it.id); notices.push({ kind: 'collected', text: `${it.name}: picked up (${state.collected.length} of ${stage.items.length}).` }); }
    if (state.collected.length >= stage.items.length) advance();
  } else if (stage.type === 'checkpoints') {
    const cps = stage.checkpoints, r = stage.radius ?? 30, limit = stage.timeLimitSec * 1000;
    // (out of time: it starts again — from the start line, which may be where you are)
    if (state.run && pt.at - state.run.startedAt > limit) { state.run = null; notices.push({ kind: 'failed', text: `${stage.name}: out of time. Back to the start to try again.` }); }
    if (!state.run) {
      if (within(cps[0], r)) { state.run = { startedAt: pt.at, next: 1 }; notices.push({ kind: 'started', text: `${stage.name}: go! ${Math.round(stage.timeLimitSec)} seconds.` }); }
    } else if (within(cps[state.run.next], r)) {
      state.run.next++;
      if (state.run.next >= cps.length) advance(pt.at - state.run.startedAt);
      else notices.push({ kind: 'checkpoint', text: `Checkpoint ${state.run.next - 1} of ${cps.length - 2}.` });
    }
  }
  return { state, completed, notices };
}
