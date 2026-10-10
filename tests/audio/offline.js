// The sound in a real browser (Phase 8 Step 1; docs/AUDIO.md), run by tools/audio-browser.mjs: the game's own audio
// system (audio/system.js — the worklet, the native nodes, the echoes, the compressor and the limiter) rendered in
// an OfflineAudioContext as fast as the browser can, so what it costs and what comes out can be measured.
//
//   race({ seconds, quality, n, echo, bangs })   an 8-car race with crashes through the whole graph (n cars; echo,
//                                bangs false: without the street's echo, the crashes) → { peak, ceiling, rms, renderMs,
//                                workMs (the render's time less the page's and the pauses'), share (of real time) }
//   opus(files)                  each file's Opus decoded here against its WAV: its length, how well they match, the
//                                lag between them (a sweep's grains must stay where they are), a loop's join
//   lod()                        a car's voice going full → simple → off → full while it plays → { x (its output),
//                                changes, gone (when it changed, when what had faded was let go: s) }
// window.__audioTest = { race, opus, lod, ready }

import { createAudioSystem } from '../../audio/system.js';
import { createCarVoice } from '../../audio/car.js';
import { createCrashSounds } from '../../audio/crash.js';
import { viewMix } from '../../audio/mix.js';
import { Garage, loadGarageData } from '../../garage/data.js';

const readJson = async f => (await fetch(f, { cache: 'no-cache' })).json();
const { db } = await loadGarageData(readJson);
const specOf = id => new Garage(db, null, id).stats().spec;
const CARS = ['starter_car', 'brute_500', 'kaze_gt', 'vortex_r', 'apex_v8', 'hana_roadster', 'strada_evo', 'ridgeback_4x4'];
const until = async (fn, ms = 20000) => { const t0 = performance.now(); while (!fn()) { if (performance.now() - t0 > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 20)); } };

async function race({ seconds = 8, quality = 'high', sr = 48000, n = 8, echo = true, bangs = true } = {}) {
  const ctx = new OfflineAudioContext(2, sr * seconds, sr);
  const A = await createAudioSystem({ context: ctx, quality });
  const specs = CARS.slice(0, n).map(specOf), full = quality === 'low' ? A.cfg.voices.lowFull : A.cfg.voices.full;
  const cars = specs.map((spec, i) => ({ spec, voice: createCarVoice(A, { spec, role: i ? 'other' : 'player', mode: quality === 'low' ? 'layers' : null }), at: i ? [(i % 2 ? -1 : 1) * (2 + i), 0, -(6 + i * 9)] : null }));
  const crash = createCrashSounds(A, { engineTap: cars[0].voice.tap });
  cars[0].voice.setView(viewMix(A.cfg, 'chase')); A.setView(viewMix(A.cfg, 'chase'));
  cars.forEach((c, i) => { if (i) c.voice.setLod(i <= full ? 'full' : 'simple'); });
  await until(() => cars.every(c => c.voice.sound?.cfg && c.voice.sound.modes.size) && crash.config);
  if (echo) A.setReverb({ street: 0.6, open: 0.4, width: 18 });
  const state = (c, t, i) => {
    const E = c.spec.engine, ph = t * 0.9 + i * 0.7, on = Math.sin(ph) > -0.3;
    return { engine: { rpm: E.idleRpm + (E.redlineRpm - E.idleRpm) * (0.55 + 0.4 * Math.sin(ph * 1.7)), throttle: on ? 1 : 0, pedal: on ? 1 : 0, load: on ? 0.9 : -0.8, gear: 3, shifting: (t + i * 0.37) % 3 < 0.1 },
      chassis: { speed: 35, scrub: 0.4, squeal: Math.max(0, Math.sin(ph * 2.3)) * 0.8, skid: 0.1, pitch: 0.5, wind: i ? 0 : 0.6 } };
  };
  const feed = t => cars.forEach((c, i) => c.voice.update(state(c, t, i), 0.25, c.at ? { at: c.at, rel: c.at, vel: [0, 0, 30], listenerVel: [0, 0, 30], occluded: i === 5 } : null));
  feed(0);
  // every quarter second: the cars' states; at times, crashes (several big ones at once — the same every 8 s)
  const crashes = [[2, 'crash', 'metal'], [2, 'crash', 'car'], [2.01, 'crash', 'concrete'], [2.3, 'crash', 'building'], [4, 'crash', 'tree'], [4, 'crash', 'car'], [4.01, 'crash', 'car'], [6, 'crash', 'tyres'], [6.5, 'crunch', 'car'], [6.5, 'crash', 'car']];
  // (the render waits while the page works out and sends each state — in a game that's the page's time, not the
  // audio thread's: left out, and so is what the pauses themselves cost, measured on their own)
  let pageMs = 0;
  for (let t = 0.25; t < seconds; t += 0.25) ctx.suspend(t).then(() => { const t1 = performance.now(); feed(t); for (const [at, cls, m] of bangs ? crashes : []) if (at >= t % 8 && at < t % 8 + 0.25) crash.impact(cls, m, 1); pageMs += performance.now() - t1; ctx.resume(); });
  const t0 = performance.now(), buf = await ctx.startRendering(), renderMs = performance.now() - t0;
  const pauseMs = await pauses(seconds, 0.25, sr);
  let peak = 0, s2 = 0;
  for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; s2 += d[i] * d[i]; } }
  const out = { peak, ceiling: 10 ** (A.cfg.master.limiter.ceiling / 20), rms: Math.sqrt(s2 / (buf.length * 2)), renderMs, pageMs, pauseMs, workMs: renderMs - pageMs - pauseMs, seconds, share: (renderMs - pageMs - pauseMs) / 1000 / seconds, budget: A.cfg.budget, worklet: A.worklet };
  for (const c of cars) c.voice.dispose();
  crash.dispose();
  return out;
}

// what pausing a render every `every` s costs by itself (the same render with and without the pauses)
async function pauses(seconds, every, sr) {
  const time = async pause => {
    const ctx = new OfflineAudioContext(2, sr * seconds, sr), o = new OscillatorNode(ctx);
    o.connect(ctx.destination); o.start();
    if (pause) for (let t = every; t < seconds; t += every) ctx.suspend(t).then(() => ctx.resume());
    const t0 = performance.now(); await ctx.startRendering(); return performance.now() - t0;
  };
  const a = Math.min(await time(true), await time(true)), b = Math.min(await time(false), await time(false));
  return Math.max(0, a - b);
}

// each Opus file against its WAV, decoded here (at the files' own rate)
async function opus(limit = Infinity) {
  const man = (await readJson('assets/sounds/manifest.json')).files, dec = new OfflineAudioContext(1, 1, 32000), out = [];
  const decode = async f => (await dec.decodeAudioData(await (await fetch(f)).arrayBuffer())).getChannelData(0);
  for (const [wav, m] of Object.entries(man).slice(0, limit)) {
    const [w, o] = await Promise.all([decode(wav), decode(m.opus)]), pad = Math.round((m.pad ?? 0) * 32000);
    // the lag that matches them best (the Opus's own pad left out), and how well: the correlation there
    let best = -2, lag = 0;
    const n = Math.min(w.length, 16000), from = Math.min(2000, Math.floor(w.length / 4));
    for (let L = -40; L <= 40; L++) { let xy = 0, xx = 0, yy = 0; for (let i = from; i < n; i++) { const a = w[i], b = o[i + pad + L] ?? 0; xy += a * b; xx += a * a; yy += b * b; } const r = xy / Math.sqrt(xx * yy || 1); if (r > best) { best = r; lag = L; } }
    // a loop: does its end run into its start (in the Opus, across the pad)?
    let join = null;
    if (m.pad) { let step = 0, typical = 0; const s = pad, e = pad + Math.round(m.seconds * 32000); step = Math.abs(o[s] - o[e - 1]); for (let i = s + 1; i < e; i++) typical = Math.max(typical, Math.abs(o[i] - o[i - 1])); join = step / (typical || 1); }
    out.push({ wav, length: o.length - 2 * pad, want: w.length, lag, corr: best, join });
  }
  return out;
}

// a voice crossfading full ↔ simple ↔ off as it plays (another car coming and going), told its level and state ten
// times a second as the game does (and so letting go of what's faded on time): its output, for clicks. The car's
// 140 m off, rolling silently: the air takes all of it above about 10 kHz, so anything up near 20 kHz is a click
async function lod({ sr = 48000, seconds = 4.5 } = {}) {
  const ctx = new OfflineAudioContext(2, Math.round(sr * seconds), sr), A = await createAudioSystem({ context: ctx });
  const spec = specOf('brute_500'), v = createCarVoice(A, { spec, role: 'other' });
  v.setLod('full');
  await until(() => v.sound?.modes.size);
  const st = { engine: { rpm: 3000, throttle: 0.5, pedal: 0.5, load: 0.5, gear: 3 }, chassis: { speed: 0 } }, place = { at: [30, 0, -137], rel: [30, 0, -137], vel: [0, 0, 0], listenerVel: [0, 0, 0] };
  const want = t => t < 1 ? 'full' : t < 2 ? 'simple' : t < 3 ? 'off' : 'full';
  v.update(st, 0.1, place);
  for (let k = 1; k < seconds * 10; k++) { const t = k / 10; ctx.suspend(t).then(() => { v.setLod(want(t)); v.update(st, 0.1, place); ctx.resume(); }); }
  const buf = await ctx.startRendering();
  v.dispose();
  return { x: Array.from(buf.getChannelData(0)), changes: [1, 2, 3], gone: [1.9, 2.9] };
}

window.__audioTest = { race, opus, lod, ready: true };
