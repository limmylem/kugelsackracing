// Engine sounds, made offline (npm run sounds) from an engine's sound config (data/sounds/engines):
// its loops at each rpm point, on and off load, and its one-off sounds (the gear-change clunk, the
// rev-limiter cut, the intake's air, a blown engine's bang, bent valves' clack) — written as WAV files
// where the config says, so real recordings can take their place later with nothing else changing.
//
// A loop is the engine's firings (four-stroke: a firing every 720 / cylinders degrees of crank) as
// pressure pulses through the exhaust's resonances, with combustion noise on each firing and a little
// difference from cylinder to cylinder. Low in the revs it's deep and smooth (the low resonance
// strongest, the top rolled off); up high it's brighter and rougher (the upper resonances, more noise,
// driven into a soft clip). Off load (throttle shut) the pulses are weaker and muffled. Each loop is a
// whole number of engine cycles, filtered round in a circle, so it repeats without a seam. Pure JS: the
// same settings make the same files.

import fs from 'node:fs';
import path from 'node:path';

const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// Seeded random 0..1 (xorshift)
export function random(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// RBJ biquad coefficients: 'lowpass' | 'highpass' | 'bandpass' (0 dB peak)
export function biquad(type, f, q, sr) {
  const w = TAU * clamp(f, 5, sr * 0.45) / sr, cw = Math.cos(w), al = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (type === 'lowpass') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
  else if (type === 'highpass') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
  else { b0 = al; b1 = 0; b2 = -al; }
  const a0 = 1 + al;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: -2 * cw / a0, a2: (1 - al) / a0 };
}
// Filter a signal; loop: as a loop (twice round, keeping the second, so the end runs into the start)
export function filter(x, c, { loop = false } = {}) {
  const n = x.length, y = new Float64Array(n);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let pass = loop ? 0 : 1; pass < 2; pass++) for (let i = 0; i < n; i++) {
    const v = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    if (pass === 1) y[i] = v;
  }
  return y;
}
const rms = x => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
const peak = x => x.reduce((a, v) => Math.max(a, Math.abs(v)), 0);
// Scale to an RMS, never past a peak
function level(x, { rms: r = null, peak: p = 0.95 } = {}) {
  const k = Math.min(r ? r / (rms(x) || 1) : Infinity, p / (peak(x) || 1));
  return x.map(v => v * k);
}
const softClip = (x, drive) => drive <= 1.001 ? x : x.map(v => Math.tanh(v * drive) / Math.tanh(drive));

// ---------- the engine loops ----------

// One loop at an rpm: on load or off. S: the config's synth settings; c: where the rpm is from idle (0)
// to the redline (1), which sets the character
export function engineLoop(S, { rpm, onLoad, cylinders, c, seed }) {
  const sr = S.sampleRate, rnd = random(seed), cycle = 120 / rpm;                       // (s: two revolutions)
  const cycles = Math.max(3, Math.round(S.length / cycle)), n = Math.round(cycles * cycle * sr);
  const firings = cycles * cylinders, spacing = n / firings, load = onLoad ? 1 : S.offLoad.pulse;
  const pulse = new Float64Array(n), noise = new Float64Array(n);
  const spread = S.cylinders, jitter = S.jitter * (1 - 0.5 * (1 - c));                 // (smoother low down)
  // (an uneven engine: the gaps between its firings through a cycle — a boxer's unequal headers, a
  // cross-plane V8's banks — as shares; none: evenly spaced)
  const gaps = S.firing, offset = gaps ? gaps.reduce((a, g, i) => { a.push(a[i] + g * cylinders / gaps.reduce((x, y) => x + y, 0)); return a; }, [0]) : null;
  for (let k = 0; k < firings; k++) {
    const at = (offset ? (Math.floor(k / cylinders) * cylinders + offset[k % cylinders]) * spacing : k * spacing) + (rnd() - 0.5) * jitter * spacing;
    const cyl = spread[k % spread.length], burble = onLoad ? 1 : 1 + (rnd() - 0.5) * S.offLoad.burble;
    const a = load * burble * (1 + (cyl - 1) * (0.6 + 0.4 * c)) * (1 + (rnd() - 0.5) * 0.08);
    // the pressure pulse: a quick rise and a decay (shorter at high revs), and the combustion noise
    const decay = S.pulseDecay * sr * (1 - 0.45 * c), rise = S.pulseRise * sr;
    const nDecay = S.noiseDecay * sr, nAmt = a * (onLoad ? S.noise[0] + (S.noise[1] - S.noise[0]) * c : S.offLoad.noise);
    for (let i = 0; i < decay * 6; i++) {
      const j = Math.floor(at + i) % n, env = (1 - Math.exp(-i / rise)) * Math.exp(-i / decay);
      pulse[(j + n) % n] += a * env;
      if (i < nDecay * 6) noise[(j + n) % n] += nAmt * (rnd() * 2 - 1) * Math.exp(-i / nDecay);
    }
  }
  // the exhaust's resonances, weighted by where in the revs and the load
  let out = new Float64Array(n);
  const drive = pulse.map((v, i) => v + noise[i]);
  for (const R of S.resonances) {
    const f = R.hz[0] + (R.hz[1] - R.hz[0]) * c, g = onLoad ? R.gain[0] + (R.gain[1] - R.gain[0]) * c : R.offLoad;
    if (g <= 0) continue;
    const y = filter(drive, biquad('bandpass', f, R.q, sr), { loop: true });
    for (let i = 0; i < n; i++) out[i] += g * y[i];
  }
  // (a little of the raw pulse, for body)
  for (let i = 0; i < n; i++) out[i] += S.direct * pulse[i];
  out = filter(out, biquad('highpass', S.highpass, 0.7, sr), { loop: true });
  out = level(out, { rms: 0.25, peak: 10 });
  out = softClip(out, 1 + (onLoad ? S.clip[0] + (S.clip[1] - S.clip[0]) * c : S.offLoad.clip));
  const tone = onLoad ? S.tone[0] * (S.tone[1] / S.tone[0]) ** c : S.offLoad.tone[0] * (S.offLoad.tone[1] / S.offLoad.tone[0]) ** c;
  out = filter(filter(out, biquad('lowpass', tone, 0.7, sr), { loop: true }), biquad('lowpass', tone * 1.4, 0.6, sr), { loop: true });
  return level(out, { rms: S.rms, peak: 0.95 });
}

// ---------- the one-off sounds ----------

const buffer = (sr, seconds) => new Float64Array(Math.round(sr * seconds));
const partials = (x, sr, list, at, decay, amp) => { for (const hz of list) for (let i = Math.round(at * sr); i < x.length; i++) { const t = i / sr - at; x[i] += amp * Math.sin(TAU * hz * t) * Math.exp(-t / decay); } };
const sweep = (x, sr, from, to, fall, decay, amp, at = 0) => { let ph = 0; for (let i = Math.round(at * sr); i < x.length; i++) { const t = i / sr - at, f = to + (from - to) * Math.exp(-t / fall); ph += TAU * f / sr; x[i] += amp * Math.sin(ph) * Math.exp(-t / decay) * Math.min(1, t * sr / 20); } };
const burst = (x, sr, rnd, decay, amp, at = 0) => { const y = new Float64Array(x.length); for (let i = Math.round(at * sr); i < x.length; i++) { const t = i / sr - at; y[i] = amp * (rnd() * 2 - 1) * Math.exp(-t / decay) * Math.min(1, t * sr / 40); } return y; };

// The air through the intake: a loop of soft pink-ish noise (the game band-passes it by the revs)
export function intakeLoop(sr, seed, seconds = 2) {
  const rnd = random(seed), x = buffer(sr, seconds);
  for (let i = 0; i < x.length; i++) x[i] = rnd() * 2 - 1;
  let y = filter(x, biquad('lowpass', 2400, 0.5, sr), { loop: true });
  y = filter(y, biquad('highpass', 120, 0.7, sr), { loop: true });
  return level(y, { rms: 0.22 });
}
// A gear going in: a low thud and a small click of metal
export function clunk(sr, seed) {
  const rnd = random(seed), x = buffer(sr, 0.24);
  sweep(x, sr, 130, 62, 0.03, 0.035, 1);
  partials(x, sr, [1180, 2470, 3930], 0.004, 0.011, 0.18);
  const n = filter(burst(x, sr, rnd, 0.005, 0.35), biquad('lowpass', 1800, 0.7, sr));
  return level(x.map((v, i) => v + n[i]), { peak: 0.8 });
}
// The rev limiter cutting the fuel: a soft, low dropout
export function limiterCut(sr, seed) {
  const rnd = random(seed), x = buffer(sr, 0.09);
  sweep(x, sr, 170, 120, 0.02, 0.022, 0.8);
  const n = filter(burst(x, sr, rnd, 0.014, 0.6), biquad('lowpass', 320, 0.7, sr));
  return level(x.map((v, i) => v + n[i]), { peak: 0.6 });
}
// A blown engine: a boom, the blast, metal ringing and rattling
export function bang(sr, seed) {
  const rnd = random(seed), x = buffer(sr, 1.6);
  sweep(x, sr, 70, 30, 0.12, 0.28, 1);
  let blast = burst(x, sr, rnd, 0.11, 1.2);
  blast = filter(filter(blast, biquad('lowpass', 2600, 0.6, sr)), biquad('lowpass', 3400, 0.6, sr));
  partials(x, sr, [410, 870, 1330, 2210, 3170], 0.012, 0.3, 0.07);
  const rattle = filter(burst(x, sr, rnd, 0.45, 0.25, 0.05), biquad('bandpass', 850, 1.2, sr));
  return level(softClip(x.map((v, i) => v + blast[i] + rattle[i]), 1.8), { peak: 0.95 });
}
// Bent valves: two hard metal knocks
export function clack(sr, seed) {
  const rnd = random(seed), x = buffer(sr, 0.36);
  for (const at of [0, 0.085]) { partials(x, sr, [1830, 2690, 4120, 5570], at, 0.022, 0.25); sweep(x, sr, 190, 140, 0.02, 0.03, 0.6, at); }
  const n = filter(burst(x, sr, rnd, 0.01, 0.3), biquad('bandpass', 2600, 1, sr));
  return level(x.map((v, i) => v + n[i]), { peak: 0.8 });
}

// ---------- files ----------

// 16-bit mono WAV
export function wav(samples, sr) {
  const n = samples.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(clamp(samples[i], -1, 1) * 32767), 44 + i * 2);
  return b;
}
// A WAV file's samples (-1..1) and rate
export function readWav(buf) {
  let at = 12, sr = 0, data = null;
  while (at < buf.length) {
    const id = buf.toString('ascii', at, at + 4), size = buf.readUInt32LE(at + 4);
    if (id === 'fmt ') sr = buf.readUInt32LE(at + 12);
    if (id === 'data') data = buf.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size & 1);
  }
  const x = new Float64Array(data.length / 2);
  for (let i = 0; i < x.length; i++) x[i] = data.readInt16LE(i * 2) / 32767;
  return { sr, samples: x };
}

// Every file an engine's sound config names, made from its synth settings: [{ file, samples }]
export function engineSounds(cfg, { redlineRpm, idleRpm }) {
  const S = cfg.synth, sr = S.sampleRate, out = [], lo = Math.log(idleRpm), hi = Math.log(redlineRpm);
  cfg.layers.forEach((L, i) => {
    const c = clamp((Math.log(L.rpm) - lo) / (hi - lo), 0, 1);
    for (const onLoad of [true, false]) out.push({ file: onLoad ? L.on : L.off, samples: engineLoop(S, { rpm: L.rpm, onLoad, cylinders: cfg.cylinders, c, seed: S.seed * 1000 + i * 2 + (onLoad ? 0 : 1) }) });
  });
  out.push({ file: cfg.intake.file, samples: intakeLoop(sr, S.seed + 1) });
  out.push({ file: cfg.shift.file, samples: clunk(sr, S.seed + 2) });
  out.push({ file: cfg.limiter.file, samples: limiterCut(sr, S.seed + 3) });
  out.push({ file: cfg.damage.bang, samples: bang(sr, S.seed + 4) });
  out.push({ file: cfg.damage.bent, samples: clack(sr, S.seed + 5) });
  return out.map(f => ({ ...f, sr }));
}

export function writeSounds(root, list) {
  for (const f of list) {
    const file = path.join(root, f.file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, wav(f.samples, f.sr));
  }
}

// ---------- crash sounds (data/sounds/crash.json) ----------

// (pieces: a short burst of band-passed noise; tinkles of glass; a sheet of metal crumpling)
function crumple(x, sr, rnd, at, amp, spread = 0.12) {
  const n = 2 + Math.floor(rnd() * 4);
  for (let k = 0; k < n; k++) {
    const t0 = at + rnd() * spread, hz = 700 + rnd() * 1800, len = 0.015 + rnd() * 0.03;
    const b = burst(x, sr, rnd, len * 0.35, amp * (0.5 + rnd() * 0.5), t0), y = filter(b, biquad('bandpass', hz, 1.4, sr));
    for (let i = 0; i < x.length; i++) x[i] += y[i];
  }
}
function tinkles(x, sr, rnd, at, count, spread, amp, [lo, hi] = [2500, 7000]) {
  for (let k = 0; k < count; k++) {
    const t0 = at + spread * rnd() ** 1.7, hz = lo + rnd() * (hi - lo), decay = 0.015 + rnd() * 0.045, a = amp * (0.3 + rnd() * 0.7);
    for (let i = Math.round(t0 * sr); i < Math.min(x.length, Math.round((t0 + decay * 6) * sr)); i++) { const t = i / sr - t0; x[i] += a * Math.sin(TAU * hz * t) * Math.exp(-t / decay); }
  }
}
function debris(x, sr, rnd, at, count, spread, amp, hz = 2400) {
  const y = new Float64Array(x.length);
  for (let k = 0; k < count; k++) { const t0 = at + spread * rnd() ** 1.5, len = Math.round((0.002 + rnd() * 0.005) * sr), a = amp * (0.3 + rnd() * 0.7); for (let i = 0; i < len; i++) { const j = Math.round(t0 * sr) + i; if (j < y.length) y[j] += a * (rnd() * 2 - 1) * Math.exp(-i / (len * 0.3)); } }
  const z = filter(y, biquad('bandpass', hz, 1, sr));
  for (let i = 0; i < x.length; i++) x[i] += z[i];
}
const vary = (rnd, v, k = 0.06) => v * (1 + (rnd() * 2 - 1) * k);

// One impact: cls 'tap' | 'crunch' | 'crash' into material 'metal' | 'concrete' | 'car'
export function impactSound(sr, seed, cls, material) {
  const rnd = random(seed), big = cls === 'crash', mid = cls === 'crunch', V = v => vary(rnd, v, 0.18), D = v => vary(rnd, v, 0.35), A = v => v * (0.55 + rnd() * 0.6);
  const x = buffer(sr, big ? 1.4 : mid ? 0.6 : 0.22), late = rnd() * 0.012;
  if (material === 'metal') {
    sweep(x, sr, V(big ? 90 : 130), V(big ? 45 : 80), D(0.04), D(big ? 0.22 : 0.05), A(big ? 1 : 0.6));
    partials(x, sr, [620, 1310, 2150, 3380].map(h => vary(rnd, h, 0.12)), 0.002 + late, D(big ? 0.6 : mid ? 0.3 : 0.1), A(big ? 0.14 : mid ? 0.12 : 0.1));
  } else if (material === 'concrete') {
    sweep(x, sr, V(big ? 75 : 150), V(big ? 38 : 85), D(0.03), D(big ? 0.2 : 0.04), A(1));
    const grit = filter(burst(x, sr, rnd, D(big ? 0.12 : mid ? 0.06 : 0.012), A(big ? 0.9 : 0.55), late), biquad('bandpass', V(1300), 0.6 + rnd() * 0.6, sr));
    for (let i = 0; i < x.length; i++) x[i] += grit[i] * (0.6 + 0.4 * rnd());
  } else {
    sweep(x, sr, V(big ? 110 : 190), V(big ? 60 : 120), D(0.03), D(big ? 0.14 : 0.06), A(0.9));
    partials(x, sr, [420, 870].map(h => vary(rnd, h, 0.15)), 0.002 + late, D(big ? 0.15 : 0.08), A(0.12));
    const click = filter(burst(x, sr, rnd, D(0.006), A(0.4), late * 0.5), biquad('bandpass', V(3800), 1.5, sr));
    for (let i = 0; i < x.length; i++) x[i] += click[i];
  }
  if (mid || big) crumple(x, sr, rnd, 0.005, big ? 0.9 : 0.6, big ? 0.35 : 0.12);
  if (big) {
    const blast = filter(filter(burst(x, sr, rnd, 0.18, 0.9), biquad('lowpass', 3200, 0.6, sr)), biquad('lowpass', 4000, 0.6, sr));
    for (let i = 0; i < x.length; i++) x[i] += blast[i];
    debris(x, sr, rnd, 0.08, 70, 0.9, 0.5, material === 'concrete' ? 2200 : 3200);
    if (material !== 'concrete') tinkles(x, sr, rnd, 0.15, 14, 0.8, 0.08, [1800, 5000]);
  }
  return level(softClip(x, big ? 1.8 : 1.2), { peak: big ? 0.95 : mid ? 0.8 : 0.6 });
}
// Sliding along it, a loop: metal screeches and grinds, concrete grinds
export function scrapeLoop(sr, seed, material, seconds = 2) {
  const rnd = random(seed), n = Math.round(sr * seconds), white = new Float64Array(n);
  for (let i = 0; i < n; i++) white[i] = rnd() * 2 - 1;
  const slow = filter(filter(white.map(() => rnd() * 2 - 1), biquad('lowpass', 18, 0.7, sr), { loop: true }), biquad('lowpass', 18, 0.7, sr), { loop: true });
  const flutter = level(slow, { rms: 0.35, peak: 0.9 });
  const grind = filter(white, biquad('bandpass', material === 'metal' ? 950 : 650, 0.8, sr), { loop: true });
  const high = filter(white, biquad('bandpass', material === 'metal' ? 2900 : 1800, material === 'metal' ? 7 : 1.2, sr), { loop: true });
  const x = grind.map((g, i) => (g + high[i] * (material === 'metal' ? 1.6 : 0.6)) * (0.7 + flutter[i]));
  return level(x, { rms: 0.2 });
}
// A window breaking: the crack, then glass tinkling down
export function glassBreak(sr, seed) {
  const rnd = random(seed), x = buffer(sr, 1.1);
  const crack = filter(burst(x, sr, rnd, 0.004, 1), biquad('highpass', 1500, 0.7, sr));
  const shatter = filter(burst(x, sr, rnd, 0.09, 0.5, 0.004), biquad('highpass', 3000, 0.7, sr));
  for (let i = 0; i < x.length; i++) x[i] += crack[i] + shatter[i];
  tinkles(x, sr, rnd, 0.01, 70, 0.9, 0.35);
  return level(x, { peak: 0.85 });
}
// A light breaking: a plastic crack and a few bits
export function lightBreak(sr, seed) {
  const rnd = random(seed), x = buffer(sr, 0.5);
  const crack = filter(burst(x, sr, rnd, 0.008, 1), biquad('bandpass', 3000, 1.2, sr));
  for (let i = 0; i < x.length; i++) x[i] += crack[i];
  tinkles(x, sr, rnd, 0.01, 18, 0.3, 0.25, [2000, 5500]);
  return level(x, { peak: 0.7 });
}

// Every file the crash sound config names, made from its synth settings
export function crashSounds(cfg) {
  const S = cfg.synth, sr = S.sampleRate, out = [];
  let k = 0;
  for (const [material, classes] of Object.entries(cfg.impacts)) for (const [cls, files] of Object.entries(classes)) files.forEach(f => out.push({ file: f, samples: impactSound(sr, S.seed * 1000 + k++, cls, material) }));
  for (const [material, f] of Object.entries(cfg.scrape.files)) out.push({ file: f, samples: scrapeLoop(sr, S.seed * 1000 + k++, material) });
  cfg.glass.files.forEach(f => out.push({ file: f, samples: glassBreak(sr, S.seed * 1000 + k++) }));
  cfg.light.files.forEach(f => out.push({ file: f, samples: lightBreak(sr, S.seed * 1000 + k++) }));
  if (cfg.tear) cfg.tear.files.forEach(f => out.push({ file: f, samples: tearSound(sr, S.seed * 1000 + k++) }));
  if (cfg.clatter) for (const [weight, files] of Object.entries(cfg.clatter.files)) files.forEach(f => out.push({ file: f, samples: clatterSound(sr, S.seed * 1000 + k++, weight === 'heavy') }));
  if (cfg.rattle) out.push({ file: cfg.rattle.file, samples: rattleLoop(sr, S.seed * 1000 + k++) });
  return out.map(f => ({ ...f, sr }));
}

// ---------- loose and torn-off parts ----------

// Metal tearing and a snap as a part comes off
export function tearSound(sr, seed) {
  const rnd = random(seed), x = buffer(sr, 0.7), n = x.length;
  // a rip: noise through a band-pass that sweeps down, in rough bursts
  let f = 3200 + rnd() * 800;
  const rip = new Float64Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr; rip[i] = (rnd() * 2 - 1) * Math.exp(-t / 0.18) * (0.5 + 0.5 * (Math.sin(TAU * (28 + rnd() * 4) * t) > 0 ? 1 : 0.3)); }
  for (let k = 0; k < 4; k++) { const seg = rip.slice(Math.floor(k * n / 4), Math.floor((k + 1) * n / 4)); const y = filter(seg, biquad('bandpass', f, 2.5, sr)); x.set(y, Math.floor(k * n / 4)); f *= 0.72; }
  const snap = filter(burst(x, sr, rnd, 0.006, 1.2, 0.02 + rnd() * 0.05), biquad('highpass', 900, 0.7, sr));
  for (let i = 0; i < n; i++) x[i] += snap[i];
  partials(x, sr, [520, 1170, 1890].map(h => vary(rnd, h, 0.1)), 0.03, 0.12, 0.1);
  return level(x, { peak: 0.85 });
}
// A part bouncing on the road: a knock of plastic or metal, lighter or heavier
export function clatterSound(sr, seed, heavy) {
  const rnd = random(seed), x = buffer(sr, heavy ? 0.4 : 0.2);
  sweep(x, sr, vary(rnd, heavy ? 150 : 320, 0.2), vary(rnd, heavy ? 90 : 220, 0.2), 0.02, heavy ? 0.05 : 0.025, 0.8);
  partials(x, sr, [880, 1650, 2700].map(h => vary(rnd, h, 0.2)), 0.001, heavy ? 0.06 : 0.03, 0.18);
  const click = filter(burst(x, sr, rnd, 0.003, 0.7), biquad('bandpass', vary(rnd, 2600, 0.3), 1.2, sr));
  for (let i = 0; i < x.length; i++) x[i] += click[i];
  if (heavy) debris(x, sr, rnd, 0.03, 8, 0.25, 0.3, 2200);
  return level(x, { peak: heavy ? 0.8 : 0.6 });
}
// A loose panel rattling: knocks at a wandering rate, a tinny ring (a loop)
export function rattleLoop(sr, seed, seconds = 2) {
  const rnd = random(seed), x = buffer(sr, seconds), n = x.length;
  let t = 0;
  while (t < seconds) {
    const at = Math.floor(t * sr), len = Math.floor(0.012 * sr), a = 0.4 + rnd() * 0.6, hz = 700 + rnd() * 1600;
    for (let i = 0; i < len * 4; i++) { const j = (at + i) % n, e = Math.exp(-i / len); x[j] += a * e * (0.6 * Math.sin(TAU * hz * i / sr) + 0.4 * (rnd() * 2 - 1)); }
    t += 0.025 + rnd() * 0.06;
  }
  return level(filter(x, biquad('highpass', 250, 0.7, sr), { loop: true }), { rms: 0.18 });
}
