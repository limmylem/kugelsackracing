// What the multiplayer rooms share (Phase 7 Step 2; docs/MULTIPLAYER.md): the API's internal calls (the race server has
// no database: friends, venues and results are the API's), a race's course in the frame it's raced in, and presence —
// each player's status for their friends, messages to a player wherever they're connected, invite codes, parties.
// Presence is Colyseus's: Redis when there is one (several processes), memory in one process without.
//
//   createRtApi({ url, secret }) → { relations(uid), venue(v), recordRace(rec), submitRun(id, uid, run), race(id), queueStats(s), act, saveEvidence(e),
//     roamSave(rows), roamSettings(uid, s), roamIncident(i), roamChallenge(rec), roamStats(s) }
//   courseOf(resolved) → route/model.js viewCourse in the race's frame (a region's map frame, or a generated track's), with its trackHash
//   setStatus(uid, status) · statuses(uids) → { uid: status }    status: { state: 'menu' | 'queue' | 'lobby' | 'racing' | 'spectating' | 'free roam', roomId?, kind?, name? }
//   toUser(uid, msg) · onUser(uid, fn) → off      codes: claimCode(roomId) → code, roomOfCode(code)
//   party: getParty(id), putParty(party), dropParty(id)

import { matchMaker } from '@colyseus/core';
import { viewCourse } from '../../../route/model.js';
import { transverseMercator } from '../../../map/build/format/projection.js';
import { trackProjection } from '../../../track/build.js';
import { inviteCode, normaliseCode } from '../../../mp/lobby.js';

export function createRtApi({ url, secret, timeoutMs = 20000 }: { url: string; secret: string; timeoutMs?: number }) {
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${url.replace(/\/$/, '')}/api/v1/internal/mp${path}`, {
      method, headers: { 'content-type': 'application/json', 'x-kr-internal': secret }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await r.text();
    let j: any = null; try { j = text ? JSON.parse(text) : null; } catch { /* not json */ }
    if (!r.ok) throw Object.assign(new Error(j?.error?.message ?? j?.message ?? `The API said ${r.status}`), { status: r.status });
    return j;
  };
  return {
    relations: (uid: string) => call('GET', `/relations/${encodeURIComponent(uid)}`),
    venue: (venue: unknown) => call('POST', '/venue', { venue }),
    recordRace: (rec: unknown) => call('POST', '/races', rec),
    submitRun: (id: string, uid: string, run: { result: unknown; recording?: unknown; contact?: string | null }) => call('POST', `/races/${encodeURIComponent(id)}/runs`, { uid, ...run }),
    race: (id: string) => call('GET', `/races/${encodeURIComponent(id)}`),
    queueStats: (s: unknown) => call('POST', '/queue-stats', s),
    act: (uid: string, a: Record<string, unknown>) => call('POST', '/act', { ...a, uid }),
    saveEvidence: (e: unknown) => call('POST', '/evidence', e),
    // (Phase 7 Step 4, free roam: docs/FREE_ROAM.md) where players are (saved as they drive and when they leave), a
    // player's settings, an auto-ghost's safety drop, a challenge's record (checked and paid), the zones' numbers
    roamSave: (rows: unknown[]) => call('POST', '/roam/save', { rows }),
    roamSettings: (uid: string, settings: unknown) => call('POST', '/roam/settings', { uid, settings }),
    roamIncident: (i: unknown) => call('POST', '/roam/incident', i),
    roamChallenge: (rec: unknown) => call('POST', '/roam/challenges', rec),
    roamStats: (s: unknown) => call('POST', '/roam/stats', s),
  };
}
export type RtApi = ReturnType<typeof createRtApi>;

// a venue as the API resolved it → the course the race server follows, in the frame the players' cars are in
export function courseOf(v: any) {
  const P = v.frame?.kind === 'region' ? transverseMercator(v.frame.lat0, v.frame.lon0) : trackProjection;
  const c: any = viewCourse(v.course, P);
  if (c && v.trackHash) c.trackHash = v.trackHash;
  return c;
}

// ---------- presence ----------
const STATUS = 'rt:status', STALE_MS = 90000;
const P = () => matchMaker.presence;
export async function setStatus(uid: string, status: any) { await P().hset(STATUS, uid, JSON.stringify({ ...status, at: Date.now() })); }
export async function clearStatus(uid: string) { await P().hdel(STATUS, uid); }
export async function statuses(uids: string[]) {
  const out: Record<string, any> = {};
  for (const uid of uids) {
    const v = await P().hget(STATUS, uid);
    if (!v) continue;
    try { const s = JSON.parse(String(v)); if (Date.now() - s.at < STALE_MS) out[uid] = s; } catch { /* bad */ }
  }
  return out;
}
const userChannel = (uid: string) => `rt:user:${uid}`;
export const toUser = (uid: string, msg: object) => P().publish(userChannel(uid), msg);
export function onUser(uid: string, fn: (msg: any) => void) { void P().subscribe(userChannel(uid), fn); return () => { void P().unsubscribe(userChannel(uid), fn); }; }

// invite codes: a private lobby's code → its room (for as long as the room lives: renewed by it)
export async function claimCode(roomId: string, length = 6) {
  for (let i = 0; i < 20; i++) {
    const code = inviteCode(Math.random, length);
    if (!(await P().get(`rt:code:${code}`))) { await P().setex(`rt:code:${code}`, roomId, 3600); return code; }
  }
  throw new Error('No free invite code');
}
export const renewCode = (code: string, roomId: string) => P().setex(`rt:code:${code}`, roomId, 3600);
export const dropCode = (code: string) => P().del(`rt:code:${code}`);
export async function roomOfCode(code: string) { const c = normaliseCode(code); return c ? (await P().get(`rt:code:${c}`)) as string | null : null; }

// parties: friends queuing together (the leader, the members, each one's name)
export async function getParty(id: string) { const v = await P().get(`rt:party:${id}`); try { return v ? JSON.parse(String(v)) : null; } catch { return null; } }
export const putParty = (party: any) => P().setex(`rt:party:${party.id}`, JSON.stringify(party), 3600);
export const dropParty = (id: string) => P().del(`rt:party:${id}`);
