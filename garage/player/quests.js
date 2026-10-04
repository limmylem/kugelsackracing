// The player's quests in the profile, pure (PlayerService makes these changes, a server can later): the
// entry fee taken when a quest starts (and given back if the game couldn't start it), a finished run
// checked (quest/validate.js) and paid (quest/rules.js earnings: each medal tier once, then a repeat), the
// progress kept per quest, xp, and a log of what was paid and what wasn't (invalid results pay nothing).
//
//   profile.xp                   all the xp earned
//   profile.quests[questId]      { attempts, finishes, dnfs, completed, medal, bestTime, bestScore, bestSplits,
//                                  bestLaps, paidShare, finishPaid, recording, lastPlayed }
//   profile.questPending         { attemptId, questId, fee, started, pinkSlip? } the run under way (its fee paid)
//   profile.questLog             [{ at, attemptId, questId, status, money, xp, medal, valid, problems? }] the last LOG_SIZE

import { earnings, medalOf, medalOfPlace, medalTargets, tierRank } from '../../quest/rules.js';
import { validateResult } from '../../quest/validate.js';

export const LOG_SIZE = 50;
export const progressOf = (profile, questId) => profile.quests?.[questId] ?? null;
const blank = () => ({ bestPlace: null, attempts: 0, finishes: 0, dnfs: 0, completed: false, medal: null, bestTime: null, bestScore: null, bestSplits: null, bestLaps: null, paidShare: 0, finishPaid: false, recording: null, lastPlayed: null });
const progress = (p, questId) => ((p.quests ??= {})[questId] ??= blank());
const log = (p, entry) => { (p.questLog ??= []).push(entry); if (p.questLog.length > LOG_SIZE) p.questLog.splice(0, p.questLog.length - LOG_SIZE); };

// The map's state for a quest: new, attempted, completed (and its medal)
export function questState(profile, questId) {
  const q = progressOf(profile, questId);
  if (!q || !q.attempts) return { state: 'new', medal: null };
  return { state: q.completed ? 'completed' : 'attempted', medal: q.medal };
}

export function startAttempt(p, { quest, fee, attemptId, now }) {
  const q = progress(p, quest.id);
  q.attempts++; q.lastPlayed = now;
  p.questPending = { attemptId, questId: quest.id, fee, started: now, ...(quest.type === 'pink_slip' ? { pinkSlip: true } : {}) };
}
// the game couldn't start it: the fee back, the attempt not counted
export function refundAttempt(p, attemptId) {
  const P = p.questPending;
  if (!P || P.attemptId !== attemptId) return { error: 'There\'s no quest starting to refund.' };
  p.money += P.fee;
  const q = progress(p, P.questId);
  q.attempts = Math.max(0, q.attempts - 1);
  delete p.questPending;
  return { refunded: P.fee };
}

// A run that didn't finish (quit, wrecked, out of time…): counted, nothing paid
export function failAttempt(p, { attemptId, questId, status, reason, now }) {
  if (p.questPending?.attemptId === attemptId) delete p.questPending;
  const q = progress(p, questId);
  q.dnfs++; q.lastPlayed = now;
  log(p, { at: now, attemptId, questId, status, reason: reason ?? null, money: 0, xp: 0, medal: null, valid: true });
}

// A finished run: checked, then paid what it earns. Returns { valid, problems, money, xp, medal, pb, lines, tiers, repeat }
export function finishAttempt(p, { result, quest, course, config, economy, now, recordingId = null }) {
  const pending = p.questPending;
  const problems = [];
  if (!pending || pending.attemptId !== result.attemptId || pending.questId !== quest.id) problems.push('No quest was started for this result (or it was already handed in).');
  problems.push(...validateResult(result, { quest, course, config }).problems);
  if (pending?.attemptId === result.attemptId) delete p.questPending;
  const q = progress(p, quest.id);
  q.lastPlayed = now;
  if (problems.length) {
    log(p, { at: now, attemptId: result.attemptId ?? null, questId: quest.id, status: 'invalid', money: 0, xp: 0, medal: null, valid: false, problems });
    return { valid: false, problems, money: 0, xp: 0, medal: null, pb: false, lines: [] };
  }
  // the medal worked out again here from the result's numbers (not the game's say-so)
  // (a race: the place is the medal)
  const medal = result.place != null ? medalOfPlace(result.place, config) : medalOf(medalTargets(quest, course, config), { time: result.time, score: result.score });
  const outcome = { status: 'finished', medal, cargoLost: result.cargoLost ?? 0, place: result.place ?? null };
  const pay = earnings({ quest, outcome, progress: { paidShare: q.paidShare, finishPaid: q.finishPaid }, economy, config });
  p.money += pay.money;
  p.xp = (p.xp ?? 0) + pay.xp;
  q.finishes++; q.completed = true;
  if (!pay.repeat) { if (medal && config.rewards[medal] > q.paidShare) q.paidShare = config.rewards[medal]; else if (!medal) q.finishPaid = true; }
  if (tierRank(medal) > tierRank(q.medal)) q.medal = medal;
  // a personal best: the time (or the score), its splits and laps, its recording
  const scored = result.score != null && quest.type === 'drift';
  const pb = scored ? (q.bestScore == null || result.score > q.bestScore) : (q.bestTime == null || result.time < q.bestTime);
  const was = { time: q.bestTime, score: q.bestScore };
  if (pb) {
    if (scored) q.bestScore = result.score; else q.bestTime = result.time;
    q.bestSplits = result.checkpoints.map(c => c.time);
    q.bestLaps = result.laps.slice();
    if (recordingId) q.recording = recordingId;
  }
  if (result.time != null && scored && (q.bestTime == null || result.time < q.bestTime)) q.bestTime = result.time;
  log(p, { at: now, attemptId: result.attemptId, questId: quest.id, status: 'finished', time: result.time, score: result.score, ...(result.place != null ? { place: result.place } : {}), money: pay.money, xp: pay.xp, medal, valid: true });
  if (result.place != null && (q.bestPlace == null || result.place < q.bestPlace)) q.bestPlace = result.place;
  return { valid: true, problems: [], money: pay.money, xp: pay.xp, medal, pb, was, lines: pay.lines, tiers: pay.tiers, repeat: pay.repeat };
}

// Loading a save: the quest records as they should be
export function checkQuests(profile) {
  const num = v => Number.isFinite(v) ? v : null;
  if (profile.xp !== undefined) profile.xp = Number.isFinite(profile.xp) && profile.xp > 0 ? Math.floor(profile.xp) : 0;
  if (profile.quests !== undefined) {
    const out = {};
    for (const [id, q] of Object.entries(profile.quests ?? {})) {
      if (!q || typeof q !== 'object' || !/^[A-Za-z0-9_-]+$/.test(id)) continue;
      const b = blank();
      out[id] = {
        ...b, attempts: Math.max(0, num(q.attempts) ?? 0) | 0, finishes: Math.max(0, num(q.finishes) ?? 0) | 0, dnfs: Math.max(0, num(q.dnfs) ?? 0) | 0,
        bestPlace: Number.isInteger(q.bestPlace) && q.bestPlace > 0 ? q.bestPlace : null, completed: !!q.completed, medal: ['bronze', 'silver', 'gold'].includes(q.medal) ? q.medal : null,
        bestTime: num(q.bestTime), bestScore: num(q.bestScore), bestSplits: Array.isArray(q.bestSplits) ? q.bestSplits.filter(Number.isFinite) : null, bestLaps: Array.isArray(q.bestLaps) ? q.bestLaps.filter(Number.isFinite) : null,
        paidShare: Math.max(0, Math.min(1, num(q.paidShare) ?? 0)), finishPaid: !!q.finishPaid, recording: typeof q.recording === 'string' ? q.recording : null, lastPlayed: typeof q.lastPlayed === 'string' ? q.lastPlayed : null,
      };
    }
    profile.quests = out;
    if (!Object.keys(out).length) delete profile.quests;
  }
  if (profile.questLog !== undefined) { profile.questLog = Array.isArray(profile.questLog) ? profile.questLog.filter(e => e && typeof e === 'object').slice(-LOG_SIZE) : []; if (!profile.questLog.length) delete profile.questLog; }
  // (a run under way when the game closed: its fee is spent, as a quit's would be)
  if (profile.questPending && (typeof profile.questPending !== 'object' || typeof profile.questPending.attemptId !== 'string')) delete profile.questPending;
  return profile;
}
