// A track's code (Phase 5): its generator version, every parameter and its seed, packed into 16 bytes and
// written in Crockford's base 32 — 26 characters in groups of five, e.g. "1C8M4-…". The parameters are
// stored in full (not a preset's name), so a code makes the same track for ever, whatever the presets
// become. normalise() rounds parameters to exactly what a code can hold: the generator only ever sees
// those, so a track made from the page's form and one made from its code are the same track.
//
// Version 2 (Phase 5 Step 2, dressed tracks) adds, in bits version 1 left unused: the theme (3 bits:
// THEMES' index — the list only ever grows at its end), a pit lane, sausage kerbs at chicanes, and the
// dressing variant (6 bits: 0–63 — "redress" picks another; the layout stays). A version-1 code has those
// bits clear and its parameters don't have them: it decodes, and makes its track, exactly as before.
// Version 3 (Phase 5 Step 4) uses the bridges bit (a crossover allowed, on a circuit) and the width byte's
// spare bit (set: no signature features).
//
//   normalise(params, { version }) → params (clamped, rounded)       encode({ version, seed, params }) → code
//   decode(code) → { version, seed, params } | throws (plain words)    themeOf(seed, theme) → a theme id
//   THEMES

import { mix } from './det.js';

const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TYPES = ['circuit', 'p2p'], STYLES = ['flowing', 'technical', 'fast', 'mixed'];
// (never reordered: a code holds the index)
export const THEMES = ['countryside', 'forest', 'desert', 'coastal', 'mountain', 'street'];
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const num = (v, d) => Number.isFinite(+v) ? +v : d;

// the theme a track gets: the one asked for, or (auto, or none) one chosen by its seed
export function themeOf(seed, theme) {
  if (THEMES.includes(theme)) return theme;
  return THEMES[mix(seed >>> 0, 0x7e3e) % THEMES.length];
}

export function normalise(p = {}, { version = null } = {}) {
  const type = TYPES.includes(p.type) ? p.type : 'circuit', style = STYLES.includes(p.style) ? p.style : 'mixed';
  let [l0, l1] = Array.isArray(p.lengthKm) ? p.lengthKm : [2, 4];
  l0 = clamp(Math.round(num(l0, 2) * 10), 5, 250); l1 = clamp(Math.round(num(l1, 4) * 10), 5, 250);
  if (l1 < l0 + 2) l1 = Math.min(250, l0 + 2), l0 = Math.min(l0, l1 - 2);
  let [c0, c1] = Array.isArray(p.corners) ? p.corners : [8, 12];
  c0 = clamp(Math.round(num(c0, 8)), 3, 40); c1 = clamp(Math.round(num(c1, 12)), c0, 40);
  const out = {
    type, style, lengthKm: [l0 / 10, l1 / 10], corners: [c0, c1],
    width: clamp(Math.round(num(p.width, 12) * 2), 12, 40) / 2,
    elevation: clamp(Math.round(num(p.elevation, 20)), 0, 250),
    climb: type === 'p2p' ? clamp(Math.round(num(p.climb, 0)), -1000, 1000) : 0,
    banking: clamp(Math.round(num(p.banking, 0)), 0, 15),
    crests: !!p.crests, bridges: false,
  };
  if (version === 1) return out;
  // (version 2's dressing: auto picks the theme from the seed when the code is made)
  out.theme = THEMES.includes(p.theme) ? p.theme : 'auto';
  out.pitLane = type === 'circuit' && !!p.pitLane;
  out.sausages = !!p.sausages;
  out.dressing = clamp(Math.round(num(p.dressing, 0)), 0, 63);
  if (version === 2) return out;
  // (version 3: a crossover allowed — a circuit's figure of eight, on a bridge — and signature features)
  out.bridges = type === 'circuit' && !!p.bridges;
  out.signatures = p.signatures !== false;
  return out;
}

const check = b => { let c = 0x5a; for (const x of b) c = (Math.imul(c ^ x, 167) + 13) & 255; return c; };

export function encode({ version, seed, params }) {
  const p = normalise(params, { version }), climb = (p.climb + 32768) & 0xffff;
  const b = [version & 255, TYPES.indexOf(p.type) | STYLES.indexOf(p.style) << 1 | (p.crests ? 8 : 0) | (p.bridges ? 16 : 0),
    Math.round(p.lengthKm[0] * 10), Math.round(p.lengthKm[1] * 10), p.corners[0], p.corners[1], Math.round(p.width * 2), p.elevation, climb >> 8, climb & 255, p.banking,
    (seed >>> 24) & 255, (seed >>> 16) & 255, (seed >>> 8) & 255, seed & 255];
  if (version >= 2) {
    const th = THEMES.indexOf(themeOf(seed, p.theme)), d = p.dressing;
    b[1] |= th << 5;
    b[10] |= (p.pitLane ? 16 : 0) | (p.sausages ? 32 : 0) | (d & 3) << 6;
    b[4] |= ((d >> 2) & 3) << 6; b[5] |= ((d >> 4) & 3) << 6;
  }
  if (version >= 3 && !p.signatures) b[6] |= 128;     // (signatures off: the width's spare bit)
  b.push(check(b));
  // 128 bits → 26 characters (5 bits each; the last has 3)
  let out = '', acc = 0, bits = 0;
  for (const x of b) { acc = (acc << 8) | x; bits += 8; while (bits >= 5) { out += A[(acc >> (bits - 5)) & 31]; bits -= 5; } acc &= (1 << bits) - 1; }
  if (bits) out += A[(acc << (5 - bits)) & 31];
  return out.match(/.{1,5}/g).join('-');
}

export function decode(code) {
  const s = String(code ?? '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 26 || [...s].some(c => !A.includes(c))) throw new Error('That isn\'t a track code (26 letters and numbers, in groups of five).');
  const b = [];
  let acc = 0, bits = 0;
  for (const c of s) { acc = (acc << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { b.push((acc >> (bits - 8)) & 255); bits -= 8; acc &= (1 << bits) - 1; } }
  if (b.length !== 16 || check(b.slice(0, 15)) !== b[15]) throw new Error('That track code has a typo in it (its check doesn\'t match).');
  const version = b[0], climb = ((b[8] << 8) | b[9]) - 32768, seed = ((b[11] << 24) | (b[12] << 16) | (b[13] << 8) | b[14]) >>> 0;
  const raw = { type: TYPES[b[1] & 1], style: STYLES[(b[1] >> 1) & 3], crests: !!(b[1] & 8), bridges: !!(b[1] & 16), lengthKm: [b[2] / 10, b[3] / 10], corners: [b[4] & 63, b[5] & 63], width: (b[6] & 127) / 2, elevation: b[7], climb, banking: b[10] & 15 };
  if (version >= 2) Object.assign(raw, { theme: THEMES[(b[1] >> 5) & 7] ?? THEMES[0], pitLane: !!(b[10] & 16), sausages: !!(b[10] & 32), dressing: (b[10] >> 6) | ((b[4] >> 6) << 2) | ((b[5] >> 6) << 4) });
  if (version >= 3) raw.signatures = !(b[6] & 128);
  return { version, seed, params: normalise(raw, { version }) };
}
