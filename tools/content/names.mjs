// Names for what the content builder makes (docs/CONTENT_PIPELINE.md "A family from the admin page"): everything in the
// game is made up, so a family's, an engine's or a car's name is checked against real makes, models and part brands
// (data/content/real-names.json) and refused when it's too close to one — fuzzily: lower case, only letters and digits,
// and digits read as the letters they look like (Br3mbo is Brembo), then how many letters would have to change
// (data/content/builder.json names.similarity). Makes and brands are refused inside a name too ("Bremboline"); models
// and real names that are ordinary words only as the whole name or one of its words. Every suggested name passes the
// same check.
//
//   nameProblem(name, rules) → null | the reason, in words
//   idFromName(name) → 'mesh10'
//   suggestNames(kind, rules, { taken, seed, count }) → ['Hushline', 'Tone-8', …]
//   loadNameRules(root) → rules (builder.json names + real-names.json)

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './rules.mjs';

export function loadNameRules(root = ROOT) {
  const read = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
  const B = read('data/content/builder.json'), real = read('data/content/real-names.json');
  return { ...B.names, ids: B.ids, real };
}

const plain = s => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
const LOOKS = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g' };
const looks = s => s.replace(/[0-9]/g, d => LOOKS[d] ?? d);
// (how it sounds, roughly: Rekaro is Recaro, Akrapovik Akrapovic)
const sound = s => s.replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/q/g, 'k').replace(/x/g, 'ks').replace(/z/g, 's').replace(/y/g, 'i').replace(/(.)\1+/g, '$1');
const words = s => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9&]+/).map(plain).filter(Boolean);
// (0 nothing alike … 1 the same: one minus the letters to change over the longer's length)
function similarity(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

// The real name a name is too close to, and how: null if none
export function realMatch(name, rules) {
  const R = rules.real, limit = rules.similarity, short = rules.shortWholeWord ?? 3;
  // (the game's own made-up names that happen to be near a real one — real-names.json ours — taken out first: the rest
  // of the name is still checked)
  const ours = new Set((R.ours ?? []).flatMap(words));
  const ws = words(name).filter(w => !ours.has(w));
  if (!ws.length) return null;
  const rest = ws.join(''), whole = [rest, looks(rest)], parts = ws.flatMap(w => [w, looks(w)]);
  // (also the words run together two at a time: "Brem Bo")
  const pairs = ws.slice(1).map((w, i) => ws[i] + w);
  // (a short real name only as itself, how it's written or how it sounds; a longer one fuzzily too)
  const fuzzy = rules.fuzzyFrom ?? 6;
  const close = (a, b) => b.length <= short ? a === b : b.length < fuzzy ? a === b || sound(a) === sound(b) : similarity(a, b) >= limit || similarity(sound(a), sound(b)) >= limit;
  for (const [list, inside] of [[R.makes, true], [R.brands, true], [R.models, false], [R.words, false]]) {
    for (const real of list ?? []) {
      const r = plain(real);
      if (!r) continue;
      if (whole.some(w => close(w, r))) return { real, how: 'like' };
      if ([...parts, ...pairs].some(w => close(w, r))) return { real, how: 'word' };
      // (inside it: makes and brands longer than a short word)
      if (inside && r.length > short && whole.some(w => w.includes(r))) return { real, how: 'inside' };
    }
  }
  return null;
}

export function nameProblem(name, rules) {
  const n = String(name ?? '').trim();
  if (n.length < rules.minLength || n.length > rules.maxLength) return `A name is ${rules.minLength} to ${rules.maxLength} characters ("${n}" is ${n.length}).`;
  if (!new RegExp(rules.pattern).test(n)) return `"${n}" isn't a name the builder takes: it starts with a capital letter, then letters and digits, a hyphen between them (Mesh-10) and at most one space (Tone Bar).`;
  const m = realMatch(n, rules);
  if (m) return m.how === 'inside'
    ? `"${n}" has "${m.real}" in it, a real make or brand: everything in the game is made up (docs/CONTENT_PIPELINE.md). Pick another name.`
    : `"${n}" is too close to "${m.real}", a real ${(rules.real.models ?? []).includes(m.real) ? 'car' : (rules.real.brands ?? []).includes(m.real) ? 'part brand' : (rules.real.makes ?? []).includes(m.real) ? 'make' : 'make or model'}: everything in the game is made up (docs/CONTENT_PIPELINE.md). Pick another name.`;
  return null;
}

// "Mesh-10" → mesh10, "Tone Bar" → tone_bar
export const idFromName = name => String(name ?? '').trim().toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[-'’]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// (a small seeded random: the same seed, the same names)
function rng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
export function suggestNames(kind, rules, { taken = [], seed = 1, count = rules.suggestions ?? 6 } = {}) {
  const P = rules.parts ?? {}, stems = P[kind] ?? Object.entries(P).filter(([k, v]) => !k.startsWith('_') && Array.isArray(v) && typeof v[0] === 'string' && k !== 'endings').flatMap(([, v]) => v);
  const endings = P.endings ?? ['line'], numbers = P.numbers ?? [10];
  const used = new Set(taken.map(t => idFromName(t))), out = [], r = rng(seed);
  for (let tries = 0; out.length < count && tries < count * 60; tries++) {
    const stem = stems[Math.floor(r() * stems.length)], way = r();
    const name = way < 0.62 ? stem + endings[Math.floor(r() * endings.length)] : way < 0.85 ? `${stem}-${numbers[Math.floor(r() * numbers.length)]}` : `${stem} ${stems[Math.floor(r() * stems.length)]}`;
    const id = idFromName(name);
    if (used.has(id) || !new RegExp(rules.ids.pattern).test(id) || nameProblem(name, rules)) continue;
    used.add(id);
    out.push(name);
  }
  return out;
}
