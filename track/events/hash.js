// A generated track's fingerprint for racing it together (Phase 5 Step 3, multiplayer prep): the hash of
// what was made — the centreline, the road's and kerbs' meshes, the barriers, the colliders, the course
// (its grid and checkpoints) and the dressing — so two players with the same hash drive the same thing.
// Before a race every player's hash is compared with the host's; one whose differs (another build, a
// floating-point difference on their machine) downloads the host's baked track instead of making it.
// A result carries the hash it was driven on: one whose hash isn't the event's pays nothing.
//
//   trackHash(data) → 'th1-xxxxxxxx'        (data: track/build.js buildTrack's world data)
//   packTrack(data) → a string (JSON, its typed arrays as base64)       unpackTrack(string) → data
//   syncPlan(host, players: [{ id, hash }]) → { same: [ids], download: [ids] }
//   joinRace({ hash, local, fetchBaked }) → { data, downloaded, ok, error }   one player's side of it

import { fnv } from '../det.js';

export const HASH_VERSION = 1;
const TYPED = { Float32Array, Float64Array, Int32Array, Uint32Array, Uint16Array, Uint8Array, Int16Array, Int8Array };

// the numbers that make the track, at cm (the centreline: mm — it's exact maths), hashed in parts (a
// mesh can be a few hundred thousand numbers: fnv takes them as they come)
function numbers(arr, q) { const out = new Array(arr.length); for (let i = 0; i < arr.length; i++) out[i] = Math.round(arr[i] * q) / 1000; return out; }
export function trackHash(data) {
  if (!data) return null;
  const parts = [
    `${data.code}|${data.version}|${data.build}|${data.hash}|${data.dressHash ?? ''}|${data.closed ? 1 : 0}|${Math.round(data.length)}`,
    fnv(numbers(data.centre.x, 1000)), fnv(numbers(data.centre.z, 1000)), fnv(numbers(data.centre.h, 1000)),
    fnv(numbers(data.road.positions, 100)), fnv(Array.from(data.road.indices.subarray ? data.road.indices.subarray(0, Math.min(data.road.indices.length, 60000)) : data.road.indices).map(x => x / 1000)),
    data.kerbs ? fnv(numbers(data.kerbs.positions, 100)) : '-',
    data.barriers ? fnv(data.barriers.runs.flatMap(r => numbers(r.pieces, 100))) : '-',
    data.colliders ? fnv(data.colliders.flatMap(c => [...(c.centre ?? []), ...(c.halfExtents ?? []), c.radius ?? 0, c.halfHeight ?? 0])) : '-',
    fnv([...(data.start?.slots ?? []).flatMap(s => [s.x, s.z, s.heading]), data.start?.s ?? 0, data.finish?.s ?? 0]),
    fnv(JSON.stringify((data.course?.checkpoints ?? []).map(c => [c.id, c.s, c.width]))),
  ];
  return `th${HASH_VERSION}-${fnv(parts.join(':'))}`;
}

// ---------- the baked track, sent to a player whose hash differs ----------
const b64 = typeof Buffer !== 'undefined'
  ? { to: u8 => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64'), from: s => new Uint8Array(Buffer.from(s, 'base64')) }
  : { to: u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }, from: s => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; } };
export function packTrack(data) {
  return JSON.stringify({ format: 'baked-track', v: 1, hash: trackHash(data), data }, (k, v) => {
    if (v && ArrayBuffer.isView(v) && !(v instanceof DataView)) return { __typed: v.constructor.name, b64: b64.to(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    return v;
  });
}
export function unpackTrack(text) {
  const o = JSON.parse(text, (k, v) => {
    if (v && typeof v === 'object' && v.__typed && TYPED[v.__typed]) { const u = b64.from(v.b64), T = TYPED[v.__typed]; return new T(u.buffer, u.byteOffset, u.byteLength / T.BYTES_PER_ELEMENT); }
    return v;
  });
  if (o?.format !== 'baked-track') throw new Error('That isn\'t a baked track.');
  const data = o.data, h = trackHash(data);
  if (h !== o.hash) throw new Error(`The baked track doesn't match its hash (${h}, it says ${o.hash}).`);
  return Object.assign(data, { baked: true });
}

// The host's hash against each player's: who has the same track, who must download it
export function syncPlan(host, players) {
  const same = [], download = [];
  for (const p of players) (p.hash === host ? same : download).push(p.id);
  return { same, download };
}
// One player joining a race on a track: made here (local()), compared with the race's hash, and on a
// mismatch the host's baked track downloaded (fetchBaked() → packTrack's string) and checked
export async function joinRace({ hash, local, fetchBaked }) {
  let data = null, mine = null;
  try { data = await local(); mine = trackHash(data); } catch { data = null; }
  if (mine === hash) return { ok: true, data, downloaded: false, hash: mine };
  try {
    const baked = unpackTrack(await fetchBaked());
    const got = trackHash(baked);
    if (got !== hash) return { ok: false, error: `The downloaded track's hash (${got}) isn't the race's (${hash}).`, data: null, downloaded: true };
    return { ok: true, data: baked, downloaded: true, hash: got, mine };
  } catch (e) { return { ok: false, error: `Couldn't download the track: ${e.message}`, data: null, downloaded: true }; }
}
