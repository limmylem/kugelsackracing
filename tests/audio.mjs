// The sound under load (Phase 8 Step 1; docs/AUDIO.md) — npm run test:audio (node --expose-gc):
//
//   CPU     an 8-car race: your car in full, six others in full (the nearest six: the rest simple, which is a native
//           loop) and the master's limiter, all on the very code the AudioWorklet runs — its share of the time it
//           plays against data/audio.json budget.audioShare; and on the low setting (layers, the nearest three full)
//           times budget.lowEndFactor (a phone about that much slower) against budget.lowEndShare
//   clips   the same race with crashes — big ones, several at once, into walls and cars — mixed as the game mixes it
//           (the groups' levels, each camera's, other cars by distance) through the limiter: nothing past its
//           ceiling, and the limiter was needed (the mix did go past it)
//   memory  100 races in a row through the whole system (audio/system.js on a stand-in for Web Audio: tests/fakeAudio.mjs)
//           — your car, seven NPCs, crashes, the echo, then all gone: every sound stopped, every node let go, every
//           engine's samples out of the worklet's bank, and the heap no bigger at the 100th than at the 10th
//
// Prints what it measured; exits 1 if anything's over.

import fs from 'node:fs';
import path from 'node:path';
import { soundHarness, render, rms, peak, cpu, Bank, EngineVoice, ChassisVoice, Limiter, SR, BLOCK } from './audioHarness.mjs';
import { root } from './harness.mjs';
import { engineVoiceConfig, viewMix } from '../audio/mix.js';
import { SURFACES } from '../audio/dsp.js';
import { readWav } from '../tools/content/sound.mjs';

const A = JSON.parse(fs.readFileSync(path.join(root, 'data/audio.json'), 'utf8')), B = A.budget;
const S = await soundHarness();
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${what}`); if (!ok) failed++; };
const CARS = ['starter_car', 'brute_500', 'kaze_gt', 'vortex_r', 'apex_v8', 'hana_roadster', 'strada_evo', 'ridgeback_4x4'];
const specs = CARS.map(c => S.spec(c));

// ---------- an 8-car race, on the audio thread's code ----------
// each car's revs, throttle and slip moving as in a race (out of step with each other), crashes at times
function race({ quality = 'high', seconds = 10, crashes = [] } = {}) {
  const full = quality === 'low' ? A.voices.lowFull : A.voices.full, mode = quality === 'low' ? 'layers' : 'granular';
  const cars = specs.map((spec, i) => {
    const player = i === 0, heard = player || i <= full, e = heard ? S.engine(spec, { mode, lite: !player, seed: 11 + i }) : null;
    const c = heard ? new ChassisVoice(SR, 31 + i) : null;
    const d = player ? 0 : 6 + i * 9;           // (m: the others round you, nearest first)
    return { spec, e, c, player, gain: player ? 1 : A.distance.refM / (A.distance.refM + A.distance.rolloff * Math.max(0, d - A.distance.refM)), pan: player ? 0 : (i % 2 ? -0.6 : 0.6) };
  });
  const surf = new Float32Array(SURFACES.length); surf[0] = 1;
  const view = viewMix(A, 'chase'), G = A.groups;
  const n = BLOCK, blocks = Math.ceil(seconds * SR / n), o = [new Float32Array(n), new Float32Array(n), new Float32Array(n)], L = new Float32Array(n), R = new Float32Array(n);
  const lim = new Limiter(SR, { ceiling: 10 ** (A.master.limiter.ceiling / 20), lookahead: A.master.limiter.lookaheadMs / 1000, release: A.master.limiter.releaseMs / 1000 }), oL = new Float32Array(n), oR = new Float32Array(n);
  const hits = crashes.map(x => ({ ...x, at: Math.round(x.t * SR), data: Float32Array.from(readWav(fs.readFileSync(path.join(root, x.file))).samples), sr: 32000 }));
  let peakIn = 0, peakOut = 0, sumOut = 0;
  const work = () => {
    for (let b = 0; b < blocks; b++) {
      const t = b * n / SR;
      L.fill(0); R.fill(0);
      cars.forEach((car, i) => {
        if (!car.e) return;
        const E = car.spec.engine, ph = t * 0.9 + i * 0.7, on = Math.sin(ph) > -0.3;
        car.e.set({ rpm: E.idleRpm + (E.redlineRpm - E.idleRpm) * (0.55 + 0.4 * Math.sin(ph * 1.7)), throttle: on ? 1 : 0, pedal: on ? 1 : 0, load: on ? 0.9 : -0.8, gear: 3 + (Math.floor(t / 3 + i) % 3), shifting: (t + i * 0.37) % 3 < 0.1 });
        car.c.set({ speed: 35, scrub: 0.4, squeal: Math.max(0, Math.sin(ph * 2.3)) * 0.8, skid: 0.1, pitch: 0.5, surf, wind: car.player ? 0.6 : 0, kerb: (t + i) % 5 < 0.5 ? 1 : 0, kerbHz: 30 });
        car.e.process(o, n);
        const ge = car.player ? G.engine : G.others, gt = car.player ? G.tyres : G.others;
        const lv = car.player ? [view.exhaust, view.intake, view.gearbox] : [0.8, 0.8, 0.8];
        for (let k = 0; k < n; k++) { const v = (o[0][k] * lv[0] + o[1][k] * lv[1] + o[2][k] * lv[2]) * ge * car.gain; L[k] += v * (1 - car.pan) * 0.9; R[k] += v * (1 + car.pan) * 0.9; }
        car.c.process(o, n);
        for (let k = 0; k < n; k++) { const v = (o[0][k] * (car.player ? view.tyres : 0.8) + o[1][k] * (car.player ? view.road : 0.8)) * gt * car.gain + (car.player ? o[2][k] * view.wind * G.environment : 0); L[k] += v; R[k] += v; }
      });
      // the crashes: their takes at their gains, from when they happen
      for (const h of hits) { const i0 = h.at - b * n; for (let k = 0; k < n; k++) { const j = Math.floor((k - i0) * h.sr / SR); if (j >= 0 && j < h.data.length) { const v = h.data[j] * h.gain * G.impacts; L[k] += v; R[k] += v; } } }
      for (let k = 0; k < n; k++) { const p = Math.max(Math.abs(L[k]), Math.abs(R[k])); if (p > peakIn) peakIn = p; }
      lim.process([L, R], [oL, oR], n);
      for (let k = 0; k < n; k++) { const p = Math.max(Math.abs(oL[k]), Math.abs(oR[k])); if (p > peakOut) peakOut = p; sumOut += oL[k] * oL[k]; }
    }
  };
  return { work, result: () => ({ peakIn, peakOut, rmsOut: Math.sqrt(sumOut / (blocks * n)), minGain: lim.take().minGain, ceiling: lim.ceiling }) };
}

console.log('CPU: an 8-car race (your car and six others in full, the limiter; the audio thread\'s code)');
{
  const secs = 6, ms = cpu(() => race({ seconds: secs }).work(), { warm: 1, runs: 3 }), share = ms / (secs * 1000);
  check(share <= B.audioShare, `desktop, high: ${(share * 100).toFixed(1)}% of real time (budget ${(B.audioShare * 100).toFixed(0)}%)`);
  const lowMs = cpu(() => race({ seconds: secs, quality: 'low' }).work(), { warm: 1, runs: 3 }), low = lowMs / (secs * 1000) * B.lowEndFactor;
  check(low <= B.lowEndShare, `a low-end device (${B.lowEndFactor}× slower), low: ${(low * 100).toFixed(1)}% of real time (budget ${(B.lowEndShare * 100).toFixed(0)}%)`);
  // and each voice on its own, for the record
  const one = (label, fn) => console.log(`       ${label}: ${(cpu(fn) / 4000 * 100).toFixed(2)}%`);
  const spec = specs[1], surf = new Float32Array(SURFACES.length); surf[0] = 1;
  one('an engine, full (granular)', () => render(S.engine(spec), 4, () => ({ rpm: 4000, throttle: 1, pedal: 1, load: 1, gear: 3 })));
  one('an engine, another car\'s (lite)', () => render(S.engine(spec, { lite: true }), 4, () => ({ rpm: 4000, throttle: 1, pedal: 1, load: 1, gear: 3 })));
  one('tyres and road, everything on', () => render(new ChassisVoice(SR, 1), 4, () => ({ speed: 30, scrub: 0.4, squeal: 0.6, skid: 0.4, surf, kerb: 1, wet: 1, brake: 0.5, wind: 0.6 })));
}

console.log('Clipping: the race with crashes, mixed as the game mixes it, through the limiter');
{
  const C = JSON.parse(fs.readFileSync(path.join(root, 'data/sounds/crash.json'), 'utf8'));
  const big = (t, family, gain = C.gain.crash[1]) => ({ t, file: C.impacts[family].crash[Math.floor(t * 10) % 3], gain });
  // (a pile-up: several big crashes at once, then more as cars run into it)
  const crashes = [big(2, 'metal'), big(2.01, 'car'), big(2.02, 'concrete'), big(2.3, 'car'), big(2.35, 'building'), big(4, 'tree'), big(4, 'car'), big(4.01, 'car'), big(4.02, 'metal'), big(6, 'tyrewall'), big(7.5, 'car'), big(7.5, 'car'), big(7.5, 'car')];
  const r = race({ seconds: 9, crashes });
  r.work();
  const x = r.result();
  check(x.peakOut <= x.ceiling + 1e-6, `the loudest out ${(20 * Math.log10(x.peakOut)).toFixed(2)} dBFS, its ceiling ${(20 * Math.log10(x.ceiling)).toFixed(2)} dBFS: never past it`);
  check(x.peakIn > x.ceiling, `the mix itself reached ${(20 * Math.log10(x.peakIn)).toFixed(1)} dBFS (so the limiter had work: it turned down by up to ${(-20 * Math.log10(x.minGain)).toFixed(1)} dB)`);
  check(x.rmsOut > 0.02, `and the race is loud enough to hear: ${(20 * Math.log10(x.rmsOut)).toFixed(1)} dBFS RMS`);
}

console.log('Memory: 100 races in a row through the whole system, everything let go after each');
{
  const { installFakeAudio } = await import('./fakeAudio.mjs');
  const F = installFakeAudio();
  const { createAudioSystem } = await import('../audio/system.js');
  const { createGameAudio } = await import('../audio/game.js');
  const Asys = await createAudioSystem({ context: new F.classes.AudioContext() });
  const base = F.live(), heap = [], banks = new Set();
  let frees = 0;
  const settle = () => new Promise(r => setTimeout(r, 0));
  for (let k = 1; k <= 100; k++) {
    const G = createGameAudio(Asys, { spec: specs[k % specs.length] });
    const npcs = specs.slice(1).map((spec, i) => G.voices.add(`npc:${i}`, spec));
    for (let f = 0; f < 40; f++) {
      F.advance(1 / 60);
      const snap = { speed: 20, throttle: 0.7, brake: 0, velocity: [0, 0, 20], engine: { rpm: 3000 + f * 20, throttle: 0.7, torque: 120, gear: '3', clutch: 1 }, wheels: [0, 1, 2, 3].map(() => ({ grounded: true, combinedSlip: 0.5, slipSpeed: 0.3, load: 3000, surface: 'tarmac', compressionSpeed: f === 20 ? 2 : 0 })), mechanical: {} };
      npcs.forEach((h, i) => h.update({ engine: { rpm: 4000, throttle: 1, pedal: 1, load: 0.9, gear: 3 }, chassis: { speed: 30 } }, { pos: [i * 12, 0, -20 - i * 15], vel: [0, 0, 30] }));
      G.update(snap, 1 / 60, { view: f < 20 ? 'chase' : 'cockpit', surfaces: { tarmac: { sound: 'tarmac' } }, listener: { pos: [0, 1, 0], vel: [0, 0, 20] } });
      if (f === 10) { G.crash.impact('crash', 'car', 1); G.crash.impact('tap', 'metal', 0.3); G.crash.glass(); G.crash.tear(); G.crash.clatter(6); }
      if (f % 4 === 0) await new Promise(r => setTimeout(r, 2));
    }
    await G.crash.ready; await G.crash.mechReady;
    G.dispose();
    await settle(); await settle();
    // (the stand-in keeps what it's sent — the samples too — until told to forget: the heap's measured just after)
    if (k % 25 === 0) { for (const m of F.messages('kr-limiter')) { if (m.t === 'bank') banks.add(m.id); if (m.t === 'free') frees++; } F.forget(); }
    if (k === 25 || k === 100) { globalThis.gc?.(); globalThis.gc?.(); heap.push(process.memoryUsage().heapUsed); }
  }
  await settle();
  await new Promise(r => setTimeout(r, 200));
  for (const m of F.messages('kr-limiter')) { if (m.t === 'bank') banks.add(m.id); if (m.t === 'free') frees++; }
  const live = F.live();
  check(live.sources === base.sources && live.worklets === base.worklets && live.nodes === base.nodes, `after 100 races: ${live.sources - base.sources} sounds still playing, ${live.worklets - base.worklets} worklet voices, ${live.nodes - base.nodes} nodes not let go`);
  check(Asys.loaded.engines.length === 0 && Asys.loaded.buffers.length === 0, `nothing loaded is kept: ${Asys.loaded.engines.length} engines, ${Asys.loaded.buffers.length} files`);
  check(banks.size > 0, `the engines' samples went to the worklet's bank (${banks.size} engines) and out of it again (${frees} times)`);
  const grow = (heap[1] - heap[0]) / 1048576;
  check(!globalThis.gc || grow < 2, globalThis.gc ? `the heap: ${(heap[0] / 1048576).toFixed(1)} MB after 25 races, ${(heap[1] / 1048576).toFixed(1)} MB after 100 (${grow >= 0 ? '+' : ''}${grow.toFixed(1)} MB)` : 'the heap: run with --expose-gc to measure');
  // the worklet's own bank: added and freed the same way, empty after
  const bank = new Bank();
  for (let k = 0; k < 100; k++) { for (const s of specs) bank.add(s.engine.sound, { sr: 32000, layers: [] }); for (const s of specs) bank.free(s.engine.sound); }
  check(bank.size === 0 && bank.bytes === 0, 'the worklet\'s bank empty after 100 races\' engines in and out');
  F.restore();
}

console.log(failed ? `\n${failed} over` : '\nAll within their limits');
process.exitCode = failed ? 1 : 0;
