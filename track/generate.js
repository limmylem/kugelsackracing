// Generated tracks (Phase 5): a track is its seed + its parameters + the generator's version, and the same
// three always make the same track. Every version stays here, so a track made with an old one (a code
// saved with a record, say) is made again exactly as it was; LATEST is what new tracks use. A version's
// generator never changes once released: a better one is a new version (track/gen/vN.js).
//
//   generateTrack({ code } | { seed, params, version }) → { ok, code, version, seed, params, track, attempts, hash, ms }
//   hashOf(track) → the track's fingerprint (8 hex characters: its centreline, heights and banking)
//   LATEST, VERSIONS

import * as v1 from './gen/v1.js';
import { normalise, encode, decode } from './code.js';
import { seedOf, fnv } from './det.js';

const GENERATORS = { 1: v1 };
export const VERSIONS = Object.keys(GENERATORS).map(Number);
export const LATEST = Math.max(...VERSIONS);

export function hashOf(t) {
  const v = [t.length, t.closed ? 1 : 0, t.n];
  for (let i = 0; i < t.n; i++) v.push(t.x[i], t.z[i], t.h[i], t.bank[i]);
  return fnv(v);
}

export function generateTrack(spec) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const { version, seed, params } = spec.code ? decode(spec.code) : { version: spec.version ?? LATEST, seed: seedOf(spec.seed), params: normalise(spec.params) };
  const G = GENERATORS[version];
  if (!G) throw new Error(`This track was made by generator version ${version}, which this game doesn't have (it has ${VERSIONS.join(', ')}).`);
  const code = encode({ version, seed, params });
  const out = G.generate({ seed, params: normalise(params) });
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return { ...out, code, version, seed, params: normalise(params), hash: out.ok ? hashOf(out.track) : null, ms };
}

export { normalise, encode, decode, seedOf };
