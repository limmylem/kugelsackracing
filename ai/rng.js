// Seeded randomness for races: every random thing an NPC does comes from the race's seed, so the same
// seed and the same inputs give the same race.
//
//   const r = rng(seed)  r() → [0, 1)   r.range(a, b)   r.pick(list)   r.weighted({ key: weight })   r.normal()
//   hashSeed(...parts) → a 32-bit seed from strings and numbers

export function hashSeed(...parts) {
  let h = 0x811c9dc5;
  for (const p of parts) { const s = String(p); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } h ^= 0xff; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export function rng(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.pick = list => list[Math.floor(next() * list.length)];
  next.weighted = w => { const e = Object.entries(w), total = e.reduce((s, [, x]) => s + x, 0); let r = next() * total; for (const [k, x] of e) { r -= x; if (r <= 0) return k; } return e.at(-1)[0]; };
  next.normal = () => { const u = Math.max(1e-9, next()), v = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  next.shuffle = list => { const out = list.slice(); for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; };
  return next;
}
