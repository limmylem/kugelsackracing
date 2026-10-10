// The sound's tests' helpers (Phase 8 Step 1; docs/AUDIO.md): the game's own signal processing (audio/dsp.js — what
// the AudioWorklet runs) rendered here in Node from the sound files (the WAVs: the same samples the Opus files are
// made from), for any car and parts (the garage's own stats: spec.audio), and what's measured of what comes out.
//
//   const S = await soundHarness()
//   S.spec(carId, parts) → the spec (garage/data.js, the parts installed)
//   S.engine(spec, { mode, mute, lite, seed }) → an EngineVoice configured for it (its sound in the bank)
//   S.render(voice, seconds, stateAt(t), { channels: [0, 1, 2] }) → Float32Array (the outputs summed)
//   S.stand-ins: tonalBank(cfg) — the same layers and sweep made of pure tones (clicks stand out against them)
//   rms, peak, spectrum, centroid, band, clicks(x, sr), cpu(fn)

import fs from 'node:fs';
import path from 'node:path';
import { harness, root } from './harness.mjs';
import { Bank, EngineVoice, ChassisVoice, Limiter, BLOCK } from '../audio/dsp.js';
import { engineVoiceConfig, loopEntry, sweepEntry } from '../audio/mix.js';
import { readWav } from '../tools/content/sound.mjs';

export const SR = 48000;
const json = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const wavData = f => { const r = readWav(fs.readFileSync(path.join(root, f))); return { data: Float32Array.from(r.samples), sr: r.sr }; };

export async function soundHarness() {
  const H = await harness(), bank = new Bank(), loaded = new Set();
  function load(path) {
    if (loaded.has(path)) return json(path);
    const cfg = json(path), sr = wavData(cfg.layers[0].on).sr;
    const entry = { sr, layers: cfg.layers.map(L => ({ rpm: L.rpm, on: loopEntry(wavData(L.on).data), off: loopEntry(wavData(L.off).data) })), shift: { data: wavData(cfg.shift.file).data } };
    if (cfg.granular) { const g = json(cfg.granular.grains); entry.sweep = { on: sweepEntry(wavData(cfg.granular.on).data, g.on, g.sr, sr), off: sweepEntry(wavData(cfg.granular.off).data, g.off, g.sr, sr) }; }
    bank.add(path, entry); loaded.add(path);
    return cfg;
  }
  return {
    H, bank, db: H.db,
    // a car's spec with parts fitted (and whatever they need first: a part another needs, found and fitted)
    spec(carId = 'starter_car', parts = []) {
      const g = H.garage(null, carId);
      const fit = (id, depth = 0) => {
        let r = g.install(id, { auto: true });
        for (let k = 0; !r.ok && depth < 3 && k < 4; k++) {
          const need = r.errors.find(e => e.code === 'requires')?.need;
          const gives = p => need.startsWith('slot:') ? p.slot === need.slice(5) : p.provides?.includes(need);
          const by = need && Object.values(H.db.parts).find(p => gives(p) && H.garage(JSON.parse(JSON.stringify(g.state)), carId).install(p.id, { auto: true }).ok);
          if (!by) break;
          fit(by.id, depth + 1);
          r = g.install(id, { auto: true });
        }
        if (!r.ok) throw new Error(`${id} on ${carId}: ${r.errors.map(e => e.message ?? e).join(' ')}`);
      };
      for (const id of parts) fit(id);
      return g.stats().spec;
    },
    engine(spec, o) {
      o ??= {};
      const cfg = load(spec.engine.sound), v = new EngineVoice(o.bank ?? bank, SR, o.seed ?? 7);
      v.configure(engineVoiceConfig(spec.engine.sound, cfg, spec, o));
      return v;
    },
    config: path => load(path),
  };
}

// Render a voice (an EngineVoice or ChassisVoice) for `seconds`, its state each block from stateAt(t) (null: as it
// was); events: [[t, name, x]]. → the outputs asked for, summed
export function render(voice, seconds, stateAt = null, { channels = [0, 1, 2], events = [] } = {}) {
  const n = BLOCK, blocks = Math.ceil(seconds * SR / n), out = new Float32Array(blocks * n), o = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const evs = [...events].sort((a, b) => a[0] - b[0]);
  for (let b = 0; b < blocks; b++) {
    const t = b * n / SR;
    while (evs.length && evs[0][0] <= t) { const [, e, x] = evs.shift(); voice.event(e, x); }
    if (stateAt) { const s = stateAt(t); if (s) voice.set(s); }
    voice.process(o, n);
    for (const c of channels) { const src = o[c]; for (let i = 0; i < n; i++) out[b * n + i] += src[i]; }
  }
  return out;
}

// ---------- what's measured ----------
export const rms = (x, a = 0, b = x.length) => { a = Math.max(0, a); b = Math.min(b, x.length); let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
export const peak = (x, a = 0, b = x.length) => { b = Math.min(b, x.length); let p = 0; for (let i = Math.max(0, a); i < b; i++) p = Math.max(p, Math.abs(x[i])); return p; };
export function spectrum(x, a = 0, len = 8192) {
  let n = 1; while (n < len) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < Math.min(len, x.length - a); i++) re[i] = x[a + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (len - 1)));
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; } }
  for (let size = 2; size <= n; size <<= 1) for (let i = 0; i < n; i += size) for (let k = 0; k < size / 2; k++) {
    const ang = -2 * Math.PI * k / size, wr = Math.cos(ang), wi = Math.sin(ang), p = i + k, q = p + size / 2;
    const vr = re[q] * wr - im[q] * wi, vi = re[q] * wi + im[q] * wr;
    re[q] = re[p] - vr; im[q] = im[p] - vi; re[p] += vr; im[p] += vi;
  }
  const P = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) P[k] = re[k] * re[k] + im[k] * im[k];
  return { P, df: SR / n };
}
// the spectrum's centre (Hz) and the share of its power between lo and hi Hz
export function centroid({ P, df }) { let s = 0, c = 0; for (let k = 1; k < P.length; k++) { s += P[k]; c += P[k] * k * df; } return c / (s || 1); }
export function band({ P, df }, lo, hi) { let s = 0, b = 0; for (let k = 1; k < P.length; k++) { s += P[k]; if (k * df >= lo && k * df < hi) b += P[k]; } return b / (s || 1); }
// how much of it is near f (±width Hz) against the spectrum round it (the band f ± 4 width): a tone stands out
export function toneAt({ P, df }, f, width = 25) { let near = 0, round = 0; for (let k = 1; k < P.length; k++) { const d = Math.abs(k * df - f); if (d < width) near += P[k]; else if (d < width * 4) round += P[k]; } return near / ((round / 3) || 1e-12); }

// Clicks: a discontinuity is broadband, so with a signal made only of tones well below `above` Hz, anything left after a
// steep high-pass is a click. → the largest high-passed sample against the signal's RMS, and where it is
export function clicks(x, above = 6000, skip = SR * 0.05) {
  // (a 4th-order high-pass: two biquads)
  const hp = (inp, f) => { const w = 2 * Math.PI * f / SR, c = Math.cos(w), al = Math.sin(w) / (2 * 0.7071), a0 = 1 + al, b0 = (1 + c) / 2 / a0, b1 = -(1 + c) / a0, b2 = b0, a1 = -2 * c / a0, a2 = (1 - al) / a0; const y = new Float32Array(inp.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < inp.length; i++) { const v = b0 * inp[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = inp[i]; y2 = y1; y1 = v; y[i] = v; } return y; };
  const y = hp(hp(x, above), above), r = rms(x) || 1e-9;
  let worst = 0, at = 0;
  for (let i = Math.round(skip); i < y.length; i++) if (Math.abs(y[i]) > worst) { worst = Math.abs(y[i]); at = i; }
  return { ratio: worst / r, at: at / SR };
}

// The time a function takes, after warming it up, best of `runs`
export function cpu(fn, { warm = 1, runs = 3 } = {}) {
  for (let i = 0; i < warm; i++) fn();
  let best = Infinity;
  for (let i = 0; i < runs; i++) { const t0 = performance.now(); fn(); best = Math.min(best, performance.now() - t0); }
  return best;
}

// ---------- stand-ins made of tones ----------
// The engine's layers and sweep, each made of a few harmonics of its engine cycle's frequency at its rpm (all under
// 3 kHz), exactly whole cycles in each loop and each grain starting at a cycle's start: what the voice does with
// them — crossfading, pitching, cutting grains — is all there is to hear, so a click is a click.
export function tonalBank(cfg, sr = 32000) {
  const amp = [0.3, 0.2, 0.12, 0.08, 0.05, 0.03], half = cfg.cylinders / 2;
  // (the firing frequency's harmonics, as many as stay under 1.5 kHz past the redline: well clear of the click test's
  // 6 kHz, so what's left there is a click and not the tone)
  const top = Math.max(...JSON.parse(fs.readFileSync(path.join(root, cfg.granular.grains), 'utf8')).on.map(g => g[2])), H = Math.max(2, Math.min(amp.length, Math.floor(1500 / (top / 120 * cfg.cylinders))));
  const wave = ph => { let v = 0; for (let h = 0; h < H; h++) v += amp[h] * Math.sin(2 * Math.PI * (h + 1) * half * ph); return v; };
  const loop = rpm => { const cycles = Math.max(3, Math.round(0.9 / (120 / rpm))), len = Math.round(sr * 120 / rpm * cycles), d = new Float32Array(len); for (let i = 0; i < len; i++) d[i] = wave(i / len * cycles); return loopEntry(d); };
  const layers = cfg.layers.map(L => ({ rpm: L.rpm, on: loop(L.rpm), off: loop(L.rpm) }));
  // the sweep: one continuous wave, its phase run up through the grains' cycles (each grain a cycle at its rpm), and
  // where each cycle starts (to the fraction of a sample)
  const g = JSON.parse(fs.readFileSync(path.join(root, cfg.granular.grains), 'utf8')), sweep = side => {
    const G = g[side], starts = [1];
    for (const [, , rpm] of G) starts.push(starts.at(-1) + sr * 120 / rpm);
    const end = Math.ceil(starts.at(-1)) + 4, d = new Float32Array(end);
    let c = 0;
    for (let j = 1; j < end; j++) { while (c < G.length - 1 && j >= starts[c + 1]) c++; d[j] = wave(c + (j - starts[c]) / (starts[c + 1] - starts[c])); }
    return sweepEntry(d, G.map(([, , rpm], i) => [starts[i], starts[i + 1] - starts[i], rpm]), sr, sr);
  };
  return { sr, layers, sweep: { on: sweep('on'), off: sweep('off') } };
}

export { Bank, EngineVoice, ChassisVoice, Limiter, BLOCK };
