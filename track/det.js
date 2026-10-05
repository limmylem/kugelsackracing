// Deterministic numbers for the track generator (Phase 5): the same results, bit for bit, on any machine
// and in any browser. JavaScript's + − × ÷, Math.sqrt, Math.round, Math.floor and the integer operations
// are exact by the standard (IEEE 754 doubles, correctly rounded); Math.sin, Math.cos, Math.atan2,
// Math.pow, Math.exp and Math.hypot are not (each engine has its own). So the generator uses only the
// first kind, and its own sine and cosine below, made from them.
//
//   rng(seed) → { next() (uint32), float() [0, 1), range(a, b), int(a, b) (inclusive), pick(list), weighted({ k: w }) }
//   seedOf(text | number) → uint32      mix(a, b) → uint32 (a seed derived from two)
//   sin(x), cos(x), sqrt(x), hypot(x, y)  fnv(string | numbers) → hash (8 hex characters)

// ---------- seeds ----------
export function fnv32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
// a seed from what the player typed: a whole number as it is (0 … 4294967295), anything else hashed
export function seedOf(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v >>> 0;
  const s = String(v ?? '').trim();
  if (/^\d{1,10}$/.test(s) && +s <= 0xffffffff) return +s >>> 0;
  return fnv32(s);
}
function splitmix32(a) {
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let z = a;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}
export const mix = (a, b) => { const s = splitmix32((a ^ Math.imul(b + 1, 0x9e3779b9)) >>> 0); s(); return s(); };

// ---------- xoshiro128** ----------
export function rng(seed) {
  const sm = splitmix32(seed >>> 0), s = new Uint32Array([sm(), sm(), sm(), sm()]);
  if (!(s[0] | s[1] | s[2] | s[3])) s[0] = 1;
  const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;
  const next = () => {
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0, t = (s[1] << 9) >>> 0;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3]; s[2] ^= t; s[3] = rotl(s[3], 11);
    return result;
  };
  const float = () => next() / 4294967296;
  return {
    next, float,
    range: (a, b) => a + (b - a) * float(),
    int: (a, b) => a + Math.floor(float() * (b - a + 1)),
    pick: list => list[Math.floor(float() * list.length)],
    // a key of { key: weight } (in the object's own order: the same every time)
    weighted(w) {
      const keys = Object.keys(w).filter(k => w[k] > 0), total = keys.reduce((a, k) => a + w[k], 0);
      let r = float() * total;
      for (const k of keys) { r -= w[k]; if (r < 0) return k; }
      return keys.at(-1);
    },
  };
}

// ---------- sine and cosine (fdlibm's kernels, Cody–Waite reduction) ----------
const PIO2_HI = 1.57079632673412561417e+00, PIO2_LO = 6.07710050650619224932e-11, INV_PIO2 = 6.36619772367581382433e-01;
const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04, S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05, C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
const ksin = x => { const z = x * x, v = z * x; return x + v * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6))))); };
const kcos = x => { const z = x * x; return 1 - 0.5 * z + z * z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6))))); };
function reduce(x) { const k = Math.round(x * INV_PIO2); return [(x - k * PIO2_HI) - k * PIO2_LO, ((k % 4) + 4) % 4]; }
export function sin(x) { const [r, q] = reduce(x); return q === 0 ? ksin(r) : q === 1 ? kcos(r) : q === 2 ? -ksin(r) : -kcos(r); }
export function cos(x) { const [r, q] = reduce(x); return q === 0 ? kcos(r) : q === 1 ? -ksin(r) : q === 2 ? -kcos(r) : ksin(r); }
export const sqrt = Math.sqrt;                     // (correctly rounded by the standard)
export const hypot = (x, y) => Math.sqrt(x * x + y * y);
export const PI = 3.141592653589793;
// fixed precision: values rounded to 1 / q (1000: millimetres)
export const fix = (v, q = 1000) => Math.round(v * q) / q;

// a hash of numbers (rounded to fixed precision first) or a string: 8 hex characters
export function fnv(x) {
  if (typeof x === 'string') return fnv32(x).toString(16).padStart(8, '0');
  let h = 0x811c9dc5;
  for (const v of x) { let n = Math.round(v * 1000) | 0; for (let b = 0; b < 4; b++) { h ^= n & 255; h = Math.imul(h, 0x01000193) >>> 0; n >>= 8; } }
  return (h >>> 0).toString(16).padStart(8, '0');
}
