// What the player's profile keeps of generated tracks (Phase 5 Step 3), pure (PlayerService makes these
// changes, garage/player/quests.js finishAttempt calls them):
//
//   profile.trackRecords[code|vN|class]  { code, version, carClass, bestTime, bestLap, bestScore, bestSplits,
//                                          bestLaps, recording, eventId, at, runs } — best times per track code,
//                                          generator version and car class (a ghost of the best on request)
//   profile.trackBoards[eventId]          [result] the local leaderboard of an official, daily or weekly event:
//                                          its best runs (the Phase 4 result format, quest/result.js), best first
//   profile.trackFarm[code]               [ISO times] finishes on the track (every event on it), for the
//                                          anti-farming cut per track code (data/economy.json trackEvents.farming)
//   profile.trackQuick                    [{ at, money, xp }] what quick races (and shared codes) paid in the last
//                                          hour: their hourly cap (trackEvents.hourlyCap)
//   profile.trackRecent                   [{ code, kind, name, at, eventId }] tracks played, newest first
//   profile.trackFavs                     [{ code, kind, name, at }] the player's favourite tracks
//
//   trackFarming(p, quest, economy, now) → the economy to pay by (its farming per code) and the recent finishes
//   capQuick(p, quest, pay, economy, now) → pay with the cap applied (and noted)
//   noteTrackRun(p, { quest, result, rank, recordingId, now, cfg }) → { record: { pb, was, key }, board: { place } }
//   noteRecent(p, track, now, cfg)   setFavourite(p, track, on, cfg)   recordOf(p, key)   boardOf(p, eventId)
//   checkTrackProfile(p)  (loading a save: these as they should be)

import { rewardsOf } from '../../content/quests.js';
import { recordKey } from './model.js';
import { decode } from '../code.js';

const BOARD_KINDS = ['official', 'daily', 'weekly'];
const r3 = x => x == null ? null : Math.round(x * 1000) / 1000;

export const recordOf = (p, key) => p.trackRecords?.[key] ?? null;
export const boardOf = (p, eventId) => p.trackBoards?.[eventId] ?? [];

// The anti-farming cut for a track event: by its track's code (every event there counts), its own rules
export function trackFarming(p, quest, economy) {
  const F = economy.trackEvents?.farming;
  const recent = p.trackFarm?.[quest.track.code] ?? [];
  return { economy: F ? { ...economy, quests: { ...economy.quests, farming: F } } : economy, recent };
}

// A quick race's (or a shared code's) pay: in any hour, at most goldRuns × the event's full reward
export function capQuick(p, quest, pay, economy, now) {
  const C = economy.trackEvents?.hourlyCap;
  if (!C || !C.kinds?.includes(quest.track.kind)) return pay;
  const t = Date.parse(now), within = (p.trackQuick ?? []).filter(x => t - Date.parse(x.at) < 3600e3);
  const full = rewardsOf(quest, economy), capM = C.goldRuns * full.money, capX = C.goldRuns * full.xp;
  const paidM = within.reduce((a, x) => a + x.money, 0), paidX = within.reduce((a, x) => a + x.xp, 0);
  const money = Math.max(0, Math.min(pay.money, capM - paidM)), xp = Math.max(0, Math.min(pay.xp, capX - paidX));
  p.trackQuick = [...within, { at: now, money, xp }].slice(-60);
  if (money >= pay.money && xp >= pay.xp) return pay;
  return { ...pay, money, xp, capped: true, lines: [...(pay.lines ?? []), { what: 'Quick race pay for this hour reached', money: money - pay.money }] };
}

// A finished, valid run on a generated track: its finish counted for farming, the track's record for the
// car's class, the event's leaderboard
export function noteTrackRun(p, { quest, result, rank, recordingId = null, now, cfg = null }) {
  const T = quest.track, code = T.code;
  (p.trackFarm ??= {})[code] = [...(p.trackFarm[code] ?? []), now].slice(-10);
  // (the farming log: only the tracks played in the last day or so kept)
  const day = Date.parse(now) - 26 * 3600e3;
  for (const [c, list] of Object.entries(p.trackFarm)) { const keep = list.filter(x => Date.parse(x) > day); if (keep.length) p.trackFarm[c] = keep; else delete p.trackFarm[c]; }
  // the record: per code, generator version and class
  const version = T.version ?? (() => { try { return decode(code).version; } catch { return null; } })(), cls = result.car?.className ?? 'open', key = recordKey(code, version, cls);
  const R = (p.trackRecords ??= {})[key] ??= { code, version, carClass: cls, bestTime: null, bestLap: null, bestScore: null, bestSplits: null, bestLaps: null, recording: null, eventId: null, at: null, runs: 0 };
  R.runs++;
  const lap = result.laps?.length ? Math.min(...result.laps) : null;
  if (lap != null && (R.bestLap == null || lap < R.bestLap)) R.bestLap = r3(lap);
  const scored = result.score != null && quest.type === 'drift';
  const was = { time: R.bestTime, lap: R.bestLap, score: R.bestScore };
  const pb = scored ? (R.bestScore == null || result.score > R.bestScore) : rank != null && (R.bestTime == null || rank < R.bestTime);
  if (pb) {
    if (scored) R.bestScore = result.score; else R.bestTime = r3(rank);
    R.bestSplits = (result.checkpoints ?? []).map(c => c.time); R.bestLaps = (result.laps ?? []).slice();
    R.eventId = quest.id; R.at = now;
    if (recordingId) R.recording = recordingId;
  }
  // the leaderboard (official, daily, weekly): the best runs, best first
  let place = null;
  if (BOARD_KINDS.includes(T.kind ?? 'official')) {
    const N = cfg?.library?.board ?? 10, entry = { ...result, rank: r3(rank), damage: { taken: result.damage?.taken ?? 0, events: [] } };
    const list = [...((p.trackBoards ??= {})[quest.id] ?? []), entry];
    list.sort((a, b) => scored ? (b.score ?? 0) - (a.score ?? 0) : (a.rank ?? Infinity) - (b.rank ?? Infinity));
    p.trackBoards[quest.id] = list.slice(0, N);
    const k = p.trackBoards[quest.id].indexOf(entry);
    place = k >= 0 ? k + 1 : null;
  }
  return { record: { key, pb, was, record: { ...R } }, board: { place } };
}

// tracks played, newest first; favourites
export function noteRecent(p, track, now, cfg = null) {
  const N = cfg?.library?.recent ?? 12;
  p.trackRecent = [{ code: track.code, kind: track.kind ?? 'official', name: track.name ?? null, at: now, ...(track.eventId ? { eventId: track.eventId } : {}) }, ...(p.trackRecent ?? []).filter(x => x.code !== track.code)].slice(0, N);
}
export function setFavourite(p, track, on, now, cfg = null) {
  const list = (p.trackFavs ?? []).filter(x => x.code !== track.code);
  if (on) list.unshift({ code: track.code, kind: track.kind ?? 'official', name: track.name ?? null, at: now });
  if (on && list.length > (cfg?.library?.favourites ?? 50)) return { error: `You can keep ${cfg?.library?.favourites ?? 50} favourites: remove one first.` };
  p.trackFavs = list;
  if (!list.length) delete p.trackFavs;
  return { favourite: on };
}

// Loading a save: the track records as they should be
const CODE = /^[0-9A-Z]{5}(-[0-9A-Z]{1,5}){5}$/;
export function checkTrackProfile(p) {
  const num = v => Number.isFinite(v) ? v : null, iso = x => typeof x === 'string' && Number.isFinite(Date.parse(x));
  if (p.trackRecords !== undefined) {
    const out = {};
    for (const [k, r] of Object.entries(p.trackRecords ?? {})) {
      if (!r || typeof r !== 'object' || !CODE.test(r.code ?? '')) continue;
      out[k] = { code: r.code, version: num(r.version), carClass: typeof r.carClass === 'string' ? r.carClass : 'open', bestTime: num(r.bestTime), bestLap: num(r.bestLap), bestScore: num(r.bestScore),
        bestSplits: Array.isArray(r.bestSplits) ? r.bestSplits.filter(Number.isFinite) : null, bestLaps: Array.isArray(r.bestLaps) ? r.bestLaps.filter(Number.isFinite) : null,
        recording: typeof r.recording === 'string' ? r.recording : null, eventId: typeof r.eventId === 'string' ? r.eventId : null, at: iso(r.at) ? r.at : null, runs: Math.max(0, num(r.runs) ?? 0) | 0 };
    }
    p.trackRecords = out; if (!Object.keys(out).length) delete p.trackRecords;
  }
  if (p.trackBoards !== undefined) {
    const out = {};
    for (const [k, list] of Object.entries(p.trackBoards ?? {})) if (Array.isArray(list)) { const l = list.filter(e => e && typeof e === 'object' && e.questId === k).slice(0, 25); if (l.length) out[k] = l; }
    p.trackBoards = out; if (!Object.keys(out).length) delete p.trackBoards;
  }
  if (p.trackFarm !== undefined) {
    const out = {};
    for (const [c, l] of Object.entries(p.trackFarm ?? {})) if (CODE.test(c) && Array.isArray(l)) { const k = l.filter(iso).slice(-10); if (k.length) out[c] = k; }
    p.trackFarm = out; if (!Object.keys(out).length) delete p.trackFarm;
  }
  if (p.trackQuick !== undefined) { p.trackQuick = Array.isArray(p.trackQuick) ? p.trackQuick.filter(x => x && iso(x.at) && Number.isFinite(x.money) && Number.isFinite(x.xp)).slice(-60) : []; if (!p.trackQuick.length) delete p.trackQuick; }
  for (const f of ['trackRecent', 'trackFavs']) if (p[f] !== undefined) { p[f] = Array.isArray(p[f]) ? p[f].filter(x => x && CODE.test(x.code ?? '')).map(x => ({ code: x.code, kind: typeof x.kind === 'string' ? x.kind : 'shared', name: typeof x.name === 'string' ? x.name : null, at: iso(x.at) ? x.at : null, ...(typeof x.eventId === 'string' ? { eventId: x.eventId } : {}) })).slice(0, 60) : []; if (!p[f].length) delete p[f]; }
  return p;
}
