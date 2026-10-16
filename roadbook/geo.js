// The ROADBOOK's positions (docs/ROADBOOK.md): metres between two lat/lon points, and the trail of positions the game
// sends (a ping) checked for being driven — not a jump (a teleport, fast travel or a made-up position).
//
//   const t = createTrack()        trackSamples(t, samples, serverNow, limits) → { points: [{ lat, lon, at, trusted }], metres }
//
// A ping is the positions since the last one, twice a second: [[lat, lon, clientMs], …]. Each step must be possible at
// limits.maxSpeed (m/s); one that isn't is a jump: the track starts again from there, that step counts for nothing and
// nothing is believed until limits.settleM metres have been driven since (arriving somewhere straight after a jump isn't
// arriving). The client's clock only spaces the samples out: their times are put on the server's clock, the last one at
// serverNow, and the whole ping can't cover more time than has passed since the one before (plus limits.slackMs).

export const LIMITS = { maxSpeed: 110, settleM: 200, slackMs: 2500, staleMs: 5 * 60_000, maxSamples: 40 };

const R = 6371008.8, RAD = Math.PI / 180;
export function metresBetween(a, b) {
  const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// where the track is: the last believed position (lat, lon, at: server ms, clientT: the client's ms for it) and how far
// it's been driven since it last started again
export const createTrack = () => ({ lat: null, lon: null, at: 0, clientT: 0, driven: 0 });

export function trackSamples(track, samples, serverNow, limits = LIMITS) {
  const L = { ...LIMITS, ...limits };
  const t = { ...track }, points = [];
  let metres = 0;
  const list = (Array.isArray(samples) ? samples : []).slice(-L.maxSamples)
    .filter(s => Array.isArray(s) && Number.isFinite(s[0]) && Number.isFinite(s[1]) && Number.isFinite(s[2]) && Math.abs(s[0]) <= 90 && Math.abs(s[1]) <= 180);
  if (!list.length) return { track: t, points, metres };
  // (only samples after the last one taken: a ping sent twice counts once)
  const fresh = t.at ? list.filter(s => s[2] > t.clientT) : list;
  if (!fresh.length) return { track: t, points, metres };
  for (let i = 1; i < fresh.length; i++) if (fresh[i][2] <= fresh[i - 1][2]) return { track: t, points, metres };      // (out of order: not believed)
  const lastT = fresh[fresh.length - 1][2];
  // (the server's clock: the last sample now; the span no longer than the time since the last ping)
  const span = lastT - fresh[0][2], since = t.at ? serverNow - t.at : Infinity;
  if (span > since + L.slackMs) return { track: { ...createTrack(), ...at(fresh[fresh.length - 1], serverNow, lastT) }, points, metres };
  const stale = !t.at || serverNow - t.at > L.staleMs || t.lat === null;
  let prev = stale ? null : { lat: t.lat, lon: t.lon, at: t.at, clientT: t.clientT };
  if (stale) t.driven = 0;
  for (const s of fresh) {
    const p = { lat: s[0], lon: s[1], at: serverNow - (lastT - s[2]), clientT: s[2] };
    if (prev) {
      const d = metresBetween(prev, p), dt = Math.max(1, p.clientT - prev.clientT) / 1000;
      if (d / dt > L.maxSpeed) t.driven = 0;                 // a jump: start again from here
      else { t.driven += d; metres += d; }
    }
    points.push({ lat: p.lat, lon: p.lon, at: p.at, trusted: t.driven >= L.settleM });
    prev = p;
  }
  Object.assign(t, { lat: prev.lat, lon: prev.lon, at: serverNow, clientT: lastT });
  return { track: t, points, metres };
}
const at = (s, serverNow, clientT) => ({ lat: s[0], lon: s[1], at: serverNow, clientT });
