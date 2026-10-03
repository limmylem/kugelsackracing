// @ts-nocheck — ported as it was (tested in v2); its classes add fields dynamically
// (Map v3: ported from world/pbf.js.)
// Protocol buffers, just what vector tiles need (world/mvt.js): varints (to 2^53), zigzag, fixed 32/64
// bit floats, strings and bytes, packed lists. Pure, no dependencies: the map pipeline (Node), the
// game's map worker and the tests all use it.

const utf8 = new TextEncoder(), fromUtf8 = new TextDecoder();
export const VARINT = 0, FIXED64 = 1, BYTES = 2, FIXED32 = 5;

export class PbfWriter {
  constructor(size = 1024) { this.buf = new Uint8Array(size); this.pos = 0; this.view = new DataView(this.buf.buffer); }
  #room(n) {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const b = new Uint8Array(size);
    b.set(this.buf.subarray(0, this.pos));
    this.buf = b; this.view = new DataView(b.buffer);
  }
  varint(v) {
    this.#room(10);
    if (v < 0) throw new Error(`varint ${v} < 0`);
    if (v <= 0x7fffffff) { do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; this.buf[this.pos++] = b; } while (v); return this; }
    let lo = v % 0x100000000, hi = Math.floor(v / 0x100000000);
    for (let i = 0; i < 4; i++) { this.buf[this.pos++] = (lo & 0x7f) | 0x80; lo >>>= 7; }
    let b = lo | ((hi & 0x7) << 4); hi >>>= 3;
    this.buf[this.pos++] = hi ? b | 0x80 : b;
    while (hi) { b = hi & 0x7f; hi >>>= 7; this.buf[this.pos++] = hi ? b | 0x80 : b; }
    return this;
  }
  svarint(v) { return this.varint(v < 0 ? -v * 2 - 1 : v * 2); }
  tag(field, type) { return this.varint((field << 3) | type); }
  double(v) { this.#room(8); this.view.setFloat64(this.pos, v, true); this.pos += 8; return this; }
  float(v) { this.#room(4); this.view.setFloat32(this.pos, v, true); this.pos += 4; return this; }
  bytes(b) { this.varint(b.length); this.#room(b.length); this.buf.set(b, this.pos); this.pos += b.length; return this; }
  string(s) { return this.bytes(utf8.encode(s)); }
  // a length-delimited field written by fn(this)
  message(field, fn) {
    this.tag(field, BYTES);
    const start = this.pos;
    this.#room(4); this.pos += 4;                     // (room for the length: moved if it needs more)
    fn(this);
    const len = this.pos - start - 4, n = len < 0x80 ? 1 : len < 0x4000 ? 2 : len < 0x200000 ? 3 : len < 0x10000000 ? 4 : 5;
    if (n !== 4) { this.#room(n - 4); this.buf.copyWithin(start + n, start + 4, this.pos); this.pos += n - 4; }
    const end = this.pos;
    this.pos = start; this.varint(len); this.pos = end;
    return this;
  }
  packed(field, list, signed = false) {
    if (!list.length) return this;
    return this.message(field, w => { for (const v of list) signed ? w.svarint(v) : w.varint(v); });
  }
  finish() { return this.buf.slice(0, this.pos); }
}

export class PbfReader {
  constructor(buf) { this.buf = buf instanceof Uint8Array ? buf : new Uint8Array(buf); this.pos = 0; this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength); }
  get done() { return this.pos >= this.buf.length; }
  varint() {
    const b = this.buf;
    let v = 0, shift = 0, x;
    do {
      x = b[this.pos++];
      if (x === undefined) throw new Error('pbf: truncated');
      v += shift < 28 ? (x & 0x7f) << shift : (x & 0x7f) * 2 ** shift;
      shift += 7;
    } while (x & 0x80);
    return v >>> 0 === v || v > 0x7fffffff ? v : v >>> 0;
  }
  svarint() { const v = this.varint(); return v % 2 === 1 ? -(v + 1) / 2 : v / 2; }
  double() { const v = this.view.getFloat64(this.pos, true); this.pos += 8; return v; }
  float() { const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
  bytes() { const n = this.varint(), b = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return b; }
  string() { return fromUtf8.decode(this.bytes()); }
  // fn(field, type, reader) for each field until end (default: the rest of the buffer)
  fields(fn, end = this.buf.length) {
    while (this.pos < end) {
      const key = this.varint(), field = key >>> 3, type = key & 7, at = this.pos;
      fn(field, type, this);
      if (this.pos === at) this.skip(type);
    }
  }
  skip(type) {
    if (type === VARINT) this.varint();
    else if (type === FIXED64) this.pos += 8;
    else if (type === BYTES) { const n = this.varint(); this.pos += n; }
    else if (type === FIXED32) this.pos += 4;
    else throw new Error(`pbf: wire type ${type}`);
  }
  packed(signed = false) { const end = this.varint() + this.pos, out = []; while (this.pos < end) out.push(signed ? this.svarint() : this.varint()); return out; }
  sub(fn) { const end = this.varint() + this.pos; const r = fn(end); this.pos = end; return r; }
}
