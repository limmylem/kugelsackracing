// Voice chat's server side (docs/FREE_ROAM.md "Voice chat"; owner-approved 2026-10-13): the voices themselves go through
// Cloudflare Realtime's SFU — each player's game sends its microphone there once and pulls the voices it may hear — and
// this is everything else: the SFU's key (never the game's), who hears whom (mp/voice.js, worked out here and every pull
// checked against it), and the SFU's calls made for the game.
//
// Each player in voice chat has an entry in presence (VOICE_KEY: one hash, every process — a handoff to another zone, or
// another process, keeps it): their SFU session and track, and — refreshed by their home zone every voice.everySec —
// where they are, their party and settings, whether their microphone's on. Every voice.everySec each home zone sends its
// players their voices: { t: 'voice', mode, peers: [{ uid, name, d, party }] }. Their game pulls what's new and closes
// what's gone, one change at a time (the SFU's calls on one session must not overlap):
//
//   voice-hello                        → voice-hello { voice: whether this server has voice chat (for this player) }
//   voice-join { req, sdp, mid }       → voice-joined { req, sdp (the SFU's answer) } — a session, and the game's track in it
//   voice-pull { req, uids }           → voice-pulled { req, sdp (an offer) | null, tracks: [{ uid, mid } | { uid, error }] }
//   voice-answer { req, sdp }          → voice-ok { req }        (the game's answer to the SFU's offer)
//   voice-drop { req, mids, sdp }      → voice-dropped { req, sdp (the SFU's answer) }   (tracks closed: the game's offer)
//   voice-mic { on }                   (whether anyone should pull this player's track — nothing is sent otherwise)
//   voice-leave
//   (a refusal) voice-error { req, why }
//
// Not set up (no CF_REALTIME_APP_ID and CF_REALTIME_APP_TOKEN): the hello says voice: false, and the game says so.

import { matchMaker } from '@colyseus/core';
import crypto from 'node:crypto';
import { voicesFor, hears } from '../../../mp/voice.js';
import { ROAM } from './mpData.ts';

export const VOICE_KEY = 'rt:voice';

// ---------- the SFU (Cloudflare Realtime's HTTPS API, or the tests' stand-in for it: server/tools/fake-sfu.ts) ----------
export type Sfu = ReturnType<typeof createSfu>;
export function createSfu({ url = 'https://rtc.live.cloudflare.com/v1', appId, token, fetch: f = fetch, timeoutMs = 10000 }: { url?: string; appId: string; token: string; fetch?: typeof fetch; timeoutMs?: number }) {
  const base = `${url.replace(/\/$/, '')}/apps/${encodeURIComponent(appId)}`;
  async function call(method: string, path: string, body?: any) {
    const res = await f(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let json: any = null; try { json = text ? JSON.parse(text) : {}; } catch { /* not JSON */ }
    if (!res.ok || json?.errorCode) throw new Error(`voice: the SFU said ${res.status} ${json?.errorCode ?? ''} ${json?.errorDescription ?? text.slice(0, 120)}`.trim());
    return json;
  }
  return {
    async newSession(): Promise<string> { const r = await call('POST', '/sessions/new'); if (!r?.sessionId) throw new Error('voice: no session'); return r.sessionId; },
    // the game's own track, from its offer → the SFU's answer
    push: (session: string, sdp: string, mid: string, trackName: string) =>
      call('POST', `/sessions/${session}/tracks/new`, { sessionDescription: { type: 'offer', sdp }, tracks: [{ location: 'local', mid, trackName }] }),
    // others' tracks into this session → an offer for the game to answer (requiresImmediateRenegotiation)
    pull: (session: string, tracks: { sessionId: string; trackName: string }[]) =>
      call('POST', `/sessions/${session}/tracks/new`, { tracks: tracks.map(t => ({ location: 'remote', sessionId: t.sessionId, trackName: t.trackName })) }),
    renegotiate: (session: string, sdp: string) => call('PUT', `/sessions/${session}/renegotiate`, { sessionDescription: { type: 'answer', sdp } }),
    close: (session: string, mids: string[], sdp: string) => call('PUT', `/sessions/${session}/tracks/close`, { tracks: mids.map(mid => ({ mid })), sessionDescription: { type: 'offer', sdp }, force: false }),
  };
}

// ---------- the entries (presence) ----------
export type VoiceEntry = { uid: string; name: string; region: string; pos: [number, number] | null; party: string | null; room?: string | null; voiceRoom?: boolean; voiceParty: boolean; voiceNearby: boolean; mic: boolean; session: string; track: string; at: number;
  privacy?: { location: string; appearOffline: boolean } };
let cache: { at: number; list: VoiceEntry[]; pending?: Promise<VoiceEntry[]> } = { at: 0, list: [] };
// every entry still fresh (one read a process, shared by its rooms, at most every ~0.9 s)
export async function voiceEntries(fresh = false): Promise<VoiceEntry[]> {
  const now = Date.now();
  if (!fresh && now - cache.at < ROAM.voice.everySec * 900) return cache.list;
  if (!fresh && cache.pending) return cache.pending;
  const pending = (async () => {
    const all = (await matchMaker.presence.hgetall(VOICE_KEY)) ?? {}, list: VoiceEntry[] = [];
    for (const v of Object.values(all)) { try { const e = JSON.parse(String(v)); if (Date.now() - e.at < ROAM.voice.staleSec * 1000) list.push(e); } catch { /* bad */ } }
    cache = { at: Date.now(), list };
    return list;
  })();
  cache.pending = pending;
  try { return await pending; } finally { if (cache.pending === pending) cache.pending = undefined; }
}
export async function voiceEntry(uid: string): Promise<VoiceEntry | null> {
  try { const v = await matchMaker.presence.hget(VOICE_KEY, uid); const e = v ? JSON.parse(String(v)) : null; return e && Date.now() - e.at < ROAM.voice.staleSec * 1000 ? e : null; } catch { return null; }
}
export async function putVoice(e: VoiceEntry) {
  await matchMaker.presence.hset(VOICE_KEY, e.uid, JSON.stringify(e));
  const i = cache.list.findIndex(x => x.uid === e.uid);
  if (i >= 0) cache.list[i] = e; else cache.list.push(e);
}
export async function dropVoice(uid: string) {
  await matchMaker.presence.hdel(VOICE_KEY, uid);
  cache.list = cache.list.filter(x => x.uid !== uid);
}
// (a track's name in the SFU: not the account's id)
export const trackNameOf = (uid: string) => `v${crypto.createHash('sha256').update(`voice:${uid}`).digest('hex').slice(0, 20)}`;

// ---------- what a zone needs to know about a player ----------
export type VoiceWho = { uid: string; name: string; guest: boolean; region: string; pos: number[] | null; party: string | null; settings: any; blocked: Set<string>; room?: string | null };
const flat = (pos: number[] | null): [number, number] | null => pos ? [Math.round(pos[0]), Math.round(pos[pos.length - 1])] : null;
// this player's entry as their home zone sees them now (null: not in voice chat)
export function refreshed(e: VoiceEntry, w: VoiceWho): VoiceEntry {
  return { ...e, name: w.name, region: w.region, pos: flat(w.pos) ?? e.pos, party: w.party, room: w.room ?? null, voiceRoom: w.settings?.voiceRoom !== false, voiceParty: w.settings?.voiceParty !== false, voiceNearby: w.settings?.voiceNearby !== false,
    privacy: { location: w.settings?.location ?? 'friends', appearOffline: !!w.settings?.appearOffline }, at: Date.now() };
}
// the voices this player hears now
export async function voicesOf(me: VoiceEntry, blocked: Set<string>) {
  return voicesFor(me, await voiceEntries(), { blocked, cfg: ROAM });
}

// ---------- the game's messages (from any zone the player's in: the entry's in presence) ----------
// (each player's calls one after another: the SFU's calls on one session must not overlap)
const queues = new Map<string, Promise<any>>();
function serial<T>(uid: string, f: () => Promise<T>): Promise<T> {
  const run = (queues.get(uid) ?? Promise.resolve()).catch(() => {}).then(f);
  queues.set(uid, run);
  void run.finally(() => { if (queues.get(uid) === run) queues.delete(uid); }).catch(() => {});
  return run;
}

export async function onVoice(sfu: Sfu | null, w: VoiceWho, m: any, reply: (msg: any) => void, log: (msg: string, extra?: object) => void) {
  const req = typeof m.req === 'number' || typeof m.req === 'string' ? m.req : null;
  const no = (why: string) => reply({ t: 'voice-error', req, why });
  if (m.t === 'voice-leave') return serial(w.uid, () => dropVoice(w.uid));
  if (!sfu) return no('Voice chat isn\'t set up on this server yet.');
  if (w.guest) return no('Make an account to use voice chat.');
  const sdp = typeof m.sdp === 'string' && m.sdp.length < 60000 ? m.sdp : null;
  return serial(w.uid, async () => {
    try {
      switch (m.t) {
        case 'voice-join': {
          const mid = String(m.mid ?? '').slice(0, 8);
          if (!sdp || !mid) return no('That didn\'t work.');
          const session = await sfu.newSession(), track = trackNameOf(w.uid);
          const r = await sfu.push(session, sdp, mid, track);
          if (r?.tracks?.[0]?.errorCode) throw new Error(`voice: ${r.tracks[0].errorCode} ${r.tracks[0].errorDescription ?? ''}`);
          await putVoice(refreshed({ uid: w.uid, name: w.name, region: w.region, pos: null, party: null, voiceParty: true, voiceNearby: true, mic: !!m.mic, session, track, at: Date.now() }, w));
          return reply({ t: 'voice-joined', req, sdp: r.sessionDescription?.sdp ?? null });
        }
        case 'voice-mic': {
          const e = await voiceEntry(w.uid);
          if (e) await putVoice(refreshed({ ...e, mic: !!m.on }, w));
          return;
        }
        case 'voice-pull': {
          const me = await voiceEntry(w.uid);
          if (!me) return no('You aren\'t in voice chat.');
          const mine = refreshed(me, w), want = (Array.isArray(m.uids) ? m.uids : []).map(String).slice(0, ROAM.voice.maxPeers);
          // (each one checked: only the voices this player may hear now)
          const all = await voiceEntries(true), ok: VoiceEntry[] = [], tracks: any[] = [];
          for (const uid of want) { const o = all.find(e => e.uid === uid); if (o && hears(mine, o, { blocked: w.blocked, cfg: ROAM })) ok.push(o); else tracks.push({ uid, error: 'not heard' }); }
          if (!ok.length) return reply({ t: 'voice-pulled', req, sdp: null, tracks });
          const r = await sfu.pull(me.session, ok.map(o => ({ sessionId: o.session, trackName: o.track })));
          for (const t of r?.tracks ?? []) {
            const o = ok.find(e => e.track === t.trackName && (!t.sessionId || e.session === t.sessionId));
            if (o) tracks.push(t.errorCode ? { uid: o.uid, error: t.errorCode } : { uid: o.uid, mid: t.mid });
          }
          return reply({ t: 'voice-pulled', req, sdp: r?.requiresImmediateRenegotiation ? r.sessionDescription?.sdp ?? null : null, tracks });
        }
        case 'voice-answer': {
          const me = await voiceEntry(w.uid);
          if (!me || !sdp) return no('You aren\'t in voice chat.');
          await sfu.renegotiate(me.session, sdp);
          return reply({ t: 'voice-ok', req });
        }
        case 'voice-drop': {
          const me = await voiceEntry(w.uid), mids = (Array.isArray(m.mids) ? m.mids : []).map(String).slice(0, 64);
          if (!me || !sdp || !mids.length) return no('You aren\'t in voice chat.');
          const r = await sfu.close(me.session, mids, sdp);
          return reply({ t: 'voice-dropped', req, sdp: r?.sessionDescription?.sdp ?? null });
        }
      }
    } catch (e: any) {
      log('rt voice failed', { t: m.t, err: e?.message });
      return no('Voice chat didn\'t connect: trying again.');
    }
  });
}
