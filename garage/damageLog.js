// Crash damage as it's saved and sent over the network: compact, and rebuilt exactly.
//
// A part copy's dents (and the body shell's) are kept as an impact list: its base — the dents its older
// hits have folded into (garage/damage.js addDent) — and the hits since, in the order they came. Folding
// the hits onto the base gives its dents, the same every time, on any machine: a save loaded, or a crash
// another player's car had (its event), rebuilds the dents as they were. A long list folds its oldest
// hits into the base (LOG.max, keeping LOG.keep), so it never grows past a few dozen entries.
//
// Every number in a dent is on the game's own grid (garage/damage.js rounds it so): its point and way
// in to 0.0001 m, its strength and share to 0.001 — so each packs into eight 16-bit numbers (16 bytes)
// and comes back exactly as it was. Packed: base64.
//   packDents(list) ↔ unpackDents(text)
//   appendHits(log, hits, rules) → the log with the hits added (and folded down if it's long)
//   dentsOf(log, rules) → its dents
//   packLog(log) ↔ unpackLog(packed): { base, hits } ↔ { b, h } (texts; empty: left out)
// A crash, for another player's game (multiplayer: garage/carDamage.js crashOutcome's):
//   packCrash(outcome, build) ↔ unpackCrash(packed): { hits: { socket | 'shell': text }, losses,
//   broken, attach, mech }

import { MAX_STRENGTH, addDent } from './damage.js';

export const LOG = { max: 24, keep: 12 };
export { MAX_STRENGTH };                       // (a dent's strength packs in 16 bits: garage/damage.js keeps it under this)
const P = 1e4, S = 1e3, I16 = x => Math.max(-32768, Math.min(32767, Math.round(x))), U16 = x => Math.max(0, Math.min(65535, Math.round(x)));

// (base64 of bytes, and back: btoa and atob are in browsers and Node alike)
const toBase64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const fromBase64 = text => { const s = atob(text), out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };

// A dent list → text (16 bytes a dent)
export function packDents(list) {
  if (!list?.length) return '';
  const buf = new ArrayBuffer(list.length * 16), v = new DataView(buf);
  list.forEach((x, i) => {
    const o = i * 16;
    for (let k = 0; k < 3; k++) { v.setInt16(o + k * 2, I16(x.p[k] * P), true); v.setInt16(o + 6 + k * 2, I16(x.d[k] * P), true); }
    v.setUint16(o + 12, U16(x.s * S), true);
    v.setUint16(o + 14, x.w != null && x.w < 1 ? U16(x.w * S) : 1000, true);
  });
  return toBase64(new Uint8Array(buf));
}
export function unpackDents(text) {
  if (!text) return [];
  const bytes = fromBase64(text), v = new DataView(bytes.buffer), out = [];
  for (let o = 0; o + 16 <= bytes.length; o += 16) {
    const p = [0, 1, 2].map(k => v.getInt16(o + k * 2, true) / P + 0), d = [0, 1, 2].map(k => v.getInt16(o + 6 + k * 2, true) / P + 0);
    const s = v.getUint16(o + 12, true) / S, w = v.getUint16(o + 14, true);
    out.push({ p, d, s, ...(w < 1000 && w > 0 && { w: w / S }) });
  }
  return out;
}

// The dents a log folds to
export const dentsOf = (log, rules) => (log?.hits ?? []).reduce((list, d) => addDent(list, d, rules), (log?.base ?? []).map(x => ({ ...x })));
// A log with these hits added, in order; past LOG.max hits the oldest fold into the base (the dents
// come out the same either way)
export function appendHits(log, hits, rules, { max = LOG.max, keep = LOG.keep } = {}) {
  let base = log?.base ?? [], all = [...(log?.hits ?? []), ...hits.map(h => ({ p: h.p, d: h.d, s: h.s, ...(h.w != null && h.w < 1 && { w: h.w }) }))];
  if (all.length > max) { const n = all.length - keep; base = dentsOf({ base, hits: all.slice(0, n) }, rules); all = all.slice(n); }
  return { base, hits: all };
}
// { base, hits } ↔ { b, h }
export function packLog(log) {
  const out = {}, b = packDents(log?.base), h = packDents(log?.hits);
  if (b) out.b = b;
  if (h) out.h = h;
  return out;
}
export const unpackLog = packed => ({ base: unpackDents(packed?.b), hits: unpackDents(packed?.h) });

// A crash as one compact event for another player's game: what it dented (by socket: the receiving game
// knows which part is where), the condition lost, glass and lights broken, parts loose or off, the
// mechanical damage blocks after (by socket). build: the car's (socket → copy)
export function packCrash(outcome, build) {
  const { result, changes = [], mech = { damage: {} } } = outcome, bySocket = {}, socketOf = Object.fromEntries(Object.entries(build.sockets).filter(([, id]) => id).map(([s, id]) => [id, s]));
  for (const d of result.dents) (bySocket[d.target] ??= []).push(d);
  return {
    s: +result.strength.toFixed(2),
    hits: Object.fromEntries(Object.entries(bySocket).map(([k, list]) => [k, packDents(list)])),
    ...(result.losses.length && { loss: result.losses.map(l => [l.target === 'engine' ? socketOf[l.instanceId] ?? 'engine' : l.target, Math.round(l.loss * 100)]) }),
    ...(result.broken.length && { broken: result.broken }),
    ...(changes.length && { attach: changes.map(c => [c.socket, c.to === 'loose' ? 'l' : c.to === 'detached' ? 'd' : 'a']) }),
    ...(Object.keys(mech.damage).length && { mech: Object.fromEntries(Object.entries(mech.damage).map(([id, b]) => [socketOf[id] ?? id, b])) }),
  };
}
export function unpackCrash(c) {
  return {
    strength: c.s,
    hits: Object.fromEntries(Object.entries(c.hits ?? {}).map(([k, t]) => [k, unpackDents(t)])),
    losses: (c.loss ?? []).map(([target, n]) => ({ target, loss: n / 100 })),
    broken: c.broken ?? [],
    attach: (c.attach ?? []).map(([socket, x]) => ({ socket, to: x === 'l' ? 'loose' : x === 'd' ? 'detached' : 'attached' })),
    mech: c.mech ?? {},
  };
}
// How big something is as JSON (bytes): what saving or sending it costs
export const sizeOf = x => new TextEncoder().encode(JSON.stringify(x)).length;
