// Generated tracks with the game's server (Phase 6 Step 1): the day's and the week's tracks, records,
// leaderboards and replays are the server's (server/src/routes/tracks.ts) — the same for every player.
// A page without a server keeps the old local ones (track/events/model.js, the profile's records).
//
//   const T = await trackServer()   → null without a server
//     T.today() → { daily, weekly } (the server's TrackOfDay: code, name, key, info, hash, events), until it changes
//     T.submit({ eventId, result, recording, replay }) → { accepted, problems, pb, record, board }
//       (a race replay given: kept first, and named with the run — a record's replay)
//     T.leaderboard(eventId) · T.records(code) · T.saveReplay({ eventId, code, title, recording })
//     T.replays() · T.replay(id) · T.deleteReplay(id)

import { account } from '../account/session.js';

let made = null;
export function trackServer() {
  return made ??= account().then(A => A?.server ? create(A) : null).catch(() => null);
}

function create(A) {
  const api = A.api;
  let today = null, todayUntil = 0;
  const T = {
    get online() { return A.online; },
    today() {
      if (!today || Date.now() >= todayUntil) {
        today = api.get('/tracks/today').then(t => { todayUntil = Math.min(Date.parse(t.daily.endsAt), Date.parse(t.weekly.endsAt)); return t; });
        today.catch(() => { today = null; });
      }
      return today;
    },
    async saveReplay({ eventId = null, code = null, title, recording }) {
      return api.post('/replays', { eventId, code, title: String(title).slice(0, 120), recording });
    },
    async submit({ eventId, result, recording = null, replay = null }) {
      let replayId = null;
      if (replay?.cars?.length) {
        try { replayId = (await T.saveReplay({ eventId, code: result.track?.code ?? null, title: replay.title ?? 'Race', recording: replay.recording ?? replay })).id; }
        catch (e) { console.warn(`The replay wasn't kept: ${e.message}`); }
      }
      return { ...(await api.post('/tracks/results', { eventId, result, recording, replayId })), replayId };
    },
    leaderboard: (eventId, limit = 10) => api.get(`/tracks/leaderboard?${new URLSearchParams({ eventId, limit: String(limit) })}`),
    records: code => api.get(`/tracks/records${code ? `?code=${encodeURIComponent(code)}` : ''}`).then(r => r.records),
    replays: () => api.get('/replays').then(r => r.replays),
    replay: id => api.get(`/replays/${encodeURIComponent(id)}`),
    deleteReplay: id => api.del(`/replays/${encodeURIComponent(id)}`),
  };
  return T;
}
