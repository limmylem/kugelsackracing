// Binary messages for multiplayer (Phase 7 Step 1; docs/MULTIPLAYER.md): a car's state quantised to small whole
// numbers, sent with only the fields that changed; batches of them from the server; and a compact binary encoding of
// plain values for the rarer messages (events, the roster). No JSON on the wire. Shared by the game, the server and
// the bots; little-endian throughout.
//
// A car state, as the game gives it and gets it back (positions in the WORLD frame: the region's map frame, the same
// for every player whatever their floating origin — net/frame.js):
//   { tick, time, pos: [x, y, z] m, rot: [x, y, z, w], vel: [x, y, z] m/s, ang: [x, y, z] rad/s,
//     steer −1…1, throttle 0…1, brake 0…1, gear (−1 reverse, 0 neutral, 1…), rpm,
//     wheels: [{ omega rad/s, length m (suspension), slip 0…2.5, grounded }], flags (protocol.LIGHT bits) }
//   tick: the sender's physics step; time: the server's clock (ms since the room began) when it was sampled.
//
// Quantised (quantise / dequantise), what's compared and sent:
//   position 1 mm (int32: ±2,147 km), rotation "smallest three" 15 bits each (0.005°), velocity 1 cm/s (int16:
//   ±327 m/s), spin 1 mrad/s (±32 rad/s), steer 1/127, pedals 1/255, rpm 1, wheel spin 0.02 rad/s, suspension 2 mm,
//   slip 1/50. A full state is 63 bytes; a parked car's (nothing changed) 9.
//
//   encodeState(w, q, mask) / decodeState(r) → { q, mask }      (q: quantised; mask: which fields are in it)
//   maskFor(q, base, detail) → the fields that differ from `base` (all of them with no base)
//   mergeState(base, q, mask) → base with those fields from q
//   encodeSnapshot(serverTime, [{ id, q, mask }]) ↔ decodeSnapshot(bytes)
//   encodeValue(v) ↔ decodeValue(bytes)          (null, booleans, numbers, strings, bytes, arrays, plain objects)

import { F, ALL } from './protocol.js';

// ---------- bytes ----------
const te = new TextEncoder(), td = new TextDecoder();
export class Writer {
  constructor(size = 256) { this.buf = new Uint8Array(size); this.v = new DataView(this.buf.buffer); this.n = 0; }
  need(k) {
    if (this.n + k <= this.buf.length) return;
    const b = new Uint8Array(Math.max(this.buf.length * 2, this.n + k)); b.set(this.buf.subarray(0, this.n));
    this.buf = b; this.v = new DataView(b.buffer);
  }
  u8(x) { this.need(1); this.v.setUint8(this.n, x); this.n += 1; }
  i8(x) { this.need(1); this.v.setInt8(this.n, x); this.n += 1; }
  u16(x) { this.need(2); this.v.setUint16(this.n, x, true); this.n += 2; }
  i16(x) { this.need(2); this.v.setInt16(this.n, x, true); this.n += 2; }
  u32(x) { this.need(4); this.v.setUint32(this.n, x, true); this.n += 4; }
  i32(x) { this.need(4); this.v.setInt32(this.n, x, true); this.n += 4; }
  f64(x) { this.need(8); this.v.setFloat64(this.n, x, true); this.n += 8; }
  // an unsigned whole number in 1–5 bytes (7 bits each)
  varint(x) { do { let b = x & 127; x = Math.floor(x / 128); if (x) b |= 128; this.u8(b); } while (x); }
  bytes(b) { this.varint(b.length); this.need(b.length); this.buf.set(b, this.n); this.n += b.length; }
  str(s) { this.bytes(te.encode(s)); }
  done() { return this.buf.slice(0, this.n); }
}
export class Reader {
  constructor(bytes) { this.b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); this.v = new DataView(this.b.buffer, this.b.byteOffset, this.b.byteLength); this.n = 0; }
  check(k) { if (this.n + k > this.b.length) throw new RangeError('message too short'); }
  u8() { this.check(1); return this.v.getUint8(this.n++); }
  i8() { this.check(1); return this.v.getInt8(this.n++); }
  u16() { this.check(2); const x = this.v.getUint16(this.n, true); this.n += 2; return x; }
  i16() { this.check(2); const x = this.v.getInt16(this.n, true); this.n += 2; return x; }
  u32() { this.check(4); const x = this.v.getUint32(this.n, true); this.n += 4; return x; }
  i32() { this.check(4); const x = this.v.getInt32(this.n, true); this.n += 4; return x; }
  f64() { this.check(8); const x = this.v.getFloat64(this.n, true); this.n += 8; return x; }
  varint() { let x = 0, m = 1, b, k = 0; do { if (++k > 8) throw new RangeError('bad number'); b = this.u8(); x += (b & 127) * m; m *= 128; } while (b & 128); return x; }
  bytes() { const k = this.varint(); this.check(k); const out = this.b.slice(this.n, this.n + k); this.n += k; return out; }
  str() { return td.decode(this.bytes()); }
  get left() { return this.b.length - this.n; }
}

// ---------- quantising ----------
const clampInt = (x, lo, hi) => Math.max(lo, Math.min(hi, Math.round(x)));
const I16 = x => clampInt(x, -32768, 32767), I8 = x => clampInt(x, -127, 127), U8 = x => clampInt(x, 0, 255), U16 = x => clampInt(x, 0, 65535), I32 = x => clampInt(x, -2147483648, 2147483647);
const S = Math.SQRT1_2, QB = 32767;          // the three smallest quaternion parts each lie in ±1/√2: 15 bits

// a unit quaternion [x, y, z, w] ↔ one whole number < 2^48: which part is largest (2 bits) and the other three
export function packQuat([x, y, z, w]) {
  const c = [x, y, z, w], a = c.map(Math.abs);
  let k = 0; for (let i = 1; i < 4; i++) if (a[i] > a[k]) k = i;
  const sign = c[k] < 0 ? -1 : 1, l = Math.hypot(x, y, z, w) || 1;
  let out = k;
  for (let i = 0; i < 4; i++) if (i !== k) out = out * 32768 + clampInt(((c[i] * sign / l) / S + 1) / 2 * QB, 0, QB);
  return out;
}
export function unpackQuat(n) {
  const p = [];
  for (let i = 0; i < 3; i++) { p.unshift((n % 32768) / QB * 2 * S - S); n = Math.floor(n / 32768); }
  const k = n, big = Math.sqrt(Math.max(0, 1 - p[0] * p[0] - p[1] * p[1] - p[2] * p[2])), out = [];
  for (let i = 0, j = 0; i < 4; i++) out.push(i === k ? big : p[j++]);
  return out;
}

// A state (floats) → its quantised form (whole numbers): what's compared, merged and sent
export function quantise(s) {
  return {
    tick: s.tick >>> 0, time: Math.max(0, Math.round(s.time)) >>> 0,
    pos: s.pos.map(x => I32(x * 1000)), rot: packQuat(s.rot), vel: s.vel.map(x => I16(x * 100)), ang: (s.ang ?? [0, 0, 0]).map(x => I16(x * 1000)),
    ctrl: [I8((s.steer ?? 0) * 127), U8((s.throttle ?? 0) * 255), U8((s.brake ?? 0) * 255), clampInt(s.gear ?? 0, -127, 127)],
    rpm: U16(s.rpm ?? 0),
    wheels: (s.wheels ?? []).slice(0, 8).map(w => [I16((w.omega ?? 0) * 50), U8((w.length ?? 0) * 500), (w.grounded ? 128 : 0) | clampInt((w.slip ?? 0) * 50, 0, 127)]),
    flags: (s.flags ?? 0) & 255,
  };
}
export function dequantise(q) {
  return {
    tick: q.tick, time: q.time,
    pos: q.pos.map(x => x / 1000), rot: unpackQuat(q.rot), vel: q.vel.map(x => x / 100), ang: q.ang.map(x => x / 1000),
    steer: q.ctrl[0] / 127, throttle: q.ctrl[1] / 255, brake: q.ctrl[2] / 255, gear: q.ctrl[3],
    rpm: q.rpm,
    wheels: q.wheels.map(([o, l, sl]) => ({ omega: o / 50, length: l / 500, slip: (sl & 127) / 50, grounded: !!(sl & 128) })),
    flags: q.flags,
  };
}

const same = (a, b) => a.length === b.length && a.every((x, i) => Array.isArray(x) ? same(x, b[i]) : x === b[i]);
// The fields of q that differ from base (all of them, with no base). detail: whether wheels and engine may go in
// this one (they ride every NET.detailEvery-th state)
export function maskFor(q, base, detail = true) {
  if (!base) return ALL;
  let m = 0;
  if (!same(q.pos, base.pos)) m |= F.POS;
  if (q.rot !== base.rot) m |= F.ROT;
  if (!same(q.vel, base.vel)) m |= F.VEL;
  if (!same(q.ang, base.ang)) m |= F.ANG;
  if (!same(q.ctrl, base.ctrl)) m |= F.CTRL;
  if (detail && q.rpm !== base.rpm) m |= F.ENGINE;
  if (detail && !same(q.wheels, base.wheels)) m |= F.WHEELS;
  if (q.flags !== base.flags) m |= F.FLAGS;
  return m;
}
// base with the fields in mask taken from q (a new object; base untouched)
export function mergeState(base, q, mask) {
  const b = base ?? q;
  return {
    tick: q.tick, time: q.time,
    pos: mask & F.POS ? q.pos : b.pos, rot: mask & F.ROT ? q.rot : b.rot, vel: mask & F.VEL ? q.vel : b.vel, ang: mask & F.ANG ? q.ang : b.ang,
    ctrl: mask & F.CTRL ? q.ctrl : b.ctrl, rpm: mask & F.ENGINE ? q.rpm : b.rpm, wheels: mask & F.WHEELS ? q.wheels : b.wheels, flags: mask & F.FLAGS ? q.flags : b.flags,
  };
}

// ---------- a state on the wire ----------
export function encodeState(w, q, mask) {
  w.u32(q.tick); w.u32(q.time); w.u8(mask);
  if (mask & F.POS) for (const x of q.pos) w.i32(x);
  if (mask & F.ROT) { w.u16(Math.floor(q.rot / 4294967296)); w.u32(q.rot % 4294967296); }
  if (mask & F.VEL) for (const x of q.vel) w.i16(x);
  if (mask & F.ANG) for (const x of q.ang) w.i16(x);
  if (mask & F.CTRL) { w.i8(q.ctrl[0]); w.u8(q.ctrl[1]); w.u8(q.ctrl[2]); w.i8(q.ctrl[3]); }
  if (mask & F.ENGINE) w.u16(q.rpm);
  if (mask & F.WHEELS) { w.u8(q.wheels.length); for (const [o, l, s] of q.wheels) { w.i16(o); w.u8(l); w.u8(s); } }
  if (mask & F.FLAGS) w.u8(q.flags);
}
// (fields not in the mask come back as zeros: merge onto the last full state before using them)
export function decodeState(r) {
  const tick = r.u32(), time = r.u32(), mask = r.u8();
  const q = { tick, time, pos: [0, 0, 0], rot: packQuat([0, 0, 0, 1]), vel: [0, 0, 0], ang: [0, 0, 0], ctrl: [0, 0, 0, 0], rpm: 0, wheels: [], flags: 0 };
  if (mask & F.POS) q.pos = [r.i32(), r.i32(), r.i32()];
  if (mask & F.ROT) { const hi = r.u16(), lo = r.u32(); q.rot = hi * 4294967296 + lo; if (Math.floor(q.rot / 2 ** 45) > 3) throw new RangeError('bad rotation'); }
  if (mask & F.VEL) q.vel = [r.i16(), r.i16(), r.i16()];
  if (mask & F.ANG) q.ang = [r.i16(), r.i16(), r.i16()];
  if (mask & F.CTRL) q.ctrl = [r.i8(), r.u8(), r.u8(), r.i8()];
  if (mask & F.ENGINE) q.rpm = r.u16();
  if (mask & F.WHEELS) { const n = r.u8(); if (n > 8) throw new RangeError('too many wheels'); for (let i = 0; i < n; i++) q.wheels.push([r.i16(), r.u8(), r.u8()]); }
  if (mask & F.FLAGS) q.flags = r.u8();
  return { q, mask };
}
export function encodeStateMessage(q, mask) { const w = new Writer(80); encodeState(w, q, mask); return w.done(); }
export function decodeStateMessage(bytes) { const r = new Reader(bytes), out = decodeState(r); if (r.left) throw new RangeError('extra bytes'); return out; }

// ---------- the server's batches: the nearby cars' states ----------
// [server ms u32][count u8] then for each car [id u16][state]
export function encodeSnapshot(serverTime, cars) {
  const w = new Writer(16 + cars.length * 66);
  w.u32(Math.max(0, Math.round(serverTime)) >>> 0); w.u8(cars.length);
  for (const c of cars) { w.u16(c.id); encodeState(w, c.q, c.mask); }
  return w.done();
}
export function decodeSnapshot(bytes) {
  const r = new Reader(bytes), time = r.u32(), n = r.u8(), cars = [];
  for (let i = 0; i < n; i++) { const id = r.u16(); cars.push({ id, ...decodeState(r) }); }
  return { time, cars };
}

// ---------- pings ----------
export const encodePing = (seq, clientMs) => { const w = new Writer(10); w.u16(seq & 65535); w.f64(clientMs); return w.done(); };
export const decodePing = b => { const r = new Reader(b); return { seq: r.u16(), clientMs: r.f64() }; };
export const encodePong = (seq, clientMs, serverMs) => { const w = new Writer(18); w.u16(seq & 65535); w.f64(clientMs); w.f64(serverMs); return w.done(); };
export const decodePong = b => { const r = new Reader(b); return { seq: r.u16(), clientMs: r.f64(), serverMs: r.f64() }; };

// ---------- plain values (events, the roster, notices) ----------
// a tag byte, then: 0 null · 1 false · 2 true · 3 whole ≥ 0 (varint) · 4 whole < 0 (varint of −x) · 5 float64 ·
// 6 string · 7 bytes · 8 array · 9 object (count, then key, value …)
const MAX_DEPTH = 16;
function putValue(w, v, depth) {
  if (depth > MAX_DEPTH) throw new RangeError('too deep');
  if (v == null) w.u8(0);
  else if (v === false) w.u8(1);
  else if (v === true) w.u8(2);
  else if (typeof v === 'number') {
    if (Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER) { w.u8(v >= 0 ? 3 : 4); w.varint(Math.abs(v)); }
    else { w.u8(5); w.f64(v); }
  } else if (typeof v === 'string') { w.u8(6); w.str(v); }
  else if (v instanceof Uint8Array) { w.u8(7); w.bytes(v); }
  else if (Array.isArray(v)) { w.u8(8); w.varint(v.length); for (const x of v) putValue(w, x, depth + 1); }
  else if (typeof v === 'object') { const e = Object.entries(v).filter(([, x]) => x !== undefined); w.u8(9); w.varint(e.length); for (const [k, x] of e) { w.str(k); putValue(w, x, depth + 1); } }
  else throw new TypeError(`can't send a ${typeof v}`);
}
function getValue(r, depth) {
  if (depth > MAX_DEPTH) throw new RangeError('too deep');
  const t = r.u8();
  switch (t) {
    case 0: return null;
    case 1: return false;
    case 2: return true;
    case 3: return r.varint();
    case 4: return -r.varint();
    case 5: return r.f64();
    case 6: return r.str();
    case 7: return r.bytes();
    case 8: { const n = r.varint(); if (n > r.left) throw new RangeError('bad array'); const a = []; for (let i = 0; i < n; i++) a.push(getValue(r, depth + 1)); return a; }
    case 9: { const n = r.varint(); if (n > r.left) throw new RangeError('bad object'); const o = {}; for (let i = 0; i < n; i++) { const k = r.str(); if (k === '__proto__') throw new RangeError('bad key'); o[k] = getValue(r, depth + 1); } return o; }
    default: throw new RangeError(`unknown tag ${t}`);
  }
}
export function encodeValue(v) { const w = new Writer(64); putValue(w, v, 0); return w.done(); }
export function decodeValue(bytes) { const r = new Reader(bytes), v = getValue(r, 0); if (r.left) throw new RangeError('extra bytes'); return v; }
