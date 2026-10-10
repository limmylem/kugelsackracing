// The AudioWorklet's processors (Phase 8 Step 1; docs/AUDIO.md): audio/dsp.js's voices on the audio thread, which
// keeps playing whatever the page is doing (a long frame, a tile loading, garbage collected) — the page only sends
// them their state now and then. Loaded once by audio/system.js (ctx.audioWorklet.addModule).
//
//   'kr-engine'    an EngineVoice: 0 inputs, 3 outputs (exhaust, intake, gearbox), mono each
//   'kr-chassis'   a ChassisVoice: 0 inputs, 3 outputs (tyres, road, wind)
//   'kr-car'       another car's: its EngineVoice and ChassisVoice in one node, mixed to 1 output (processorOptions.mix:
//                  the levels of exhaust, intake, gearbox, tyres, road) — heard from outside, so no more is needed
//   'kr-limiter'   the master's Limiter (stereo in, stereo out); also the bank's door: sample data comes in through
//                  its port, and every quarter second it says how the audio thread is doing
//
// Messages to a voice: { t: 's', s } its state · { t: 'cfg', cfg } · { t: 'ev', e, x } an event · { t: 'meter' } (it
// answers { t: 'meter', … }) · { t: 'end' } (it stops and lets go); to a 'kr-car', to: 'c' sends one to its chassis. To the limiter: { t: 'bank', id, entry } ·
// { t: 'free', id } · { t: 'set', ceiling, release }; from it: { t: 'stats', cpuMs, audioMs, voices, bankBytes,
// bankItems, peakIn, peakOut, minGain }.

import { Bank, EngineVoice, ChassisVoice, Limiter } from './dsp.js';

const bank = new Bank();
// (the audio thread's work: every processor adds the time it took; a clock to the millisecond is good enough over
// many blocks — the chance a tick falls inside a block is its share of a millisecond)
const work = { ms: 0, voices: 0 };
const clock = typeof globalThis.performance?.now === 'function' ? () => globalThis.performance.now() : () => Date.now();
let seed = 1;

class VoiceProcessor extends AudioWorkletProcessor {
  constructor(voice) {
    super();
    this.v = voice; this.alive = true; this.outs = [null, null, null];
    work.voices++;
    this.port.onmessage = ({ data: m }) => {
      if (m.t === 's') this.v.set(m.s);
      else if (m.t === 'cfg') this.v.configure(m.cfg);
      else if (m.t === 'ev') this.v.event(m.e, m.x);
      else if (m.t === 'meter') this.port.postMessage(this.meter());
      else if (m.t === 'end') this.alive = false;
    };
  }
  meter() { return { t: 'meter', meter: Array.from(this.v.meter) }; }
  process(inputs, outputs) {
    if (!this.alive) { if (this.v) { work.voices--; this.v = null; } return false; }
    const t0 = clock(), o = this.outs;
    for (let i = 0; i < 3; i++) o[i] = outputs[i]?.[0] ?? null;
    if (o[0] && o[1] && o[2]) this.v.process(o, o[0].length);
    work.ms += clock() - t0;
    return true;
  }
}

class EngineProcessor extends VoiceProcessor {
  constructor(o) { super(new EngineVoice(bank, sampleRate, o?.processorOptions?.seed ?? seed++)); }
  meter() { const v = this.v; return { t: 'meter', meter: Array.from(v.meter), mode: v.mode, rpm: v.rpm, pops: v.popCount, cut: v.cut, lim: v.lim }; }
}
class ChassisProcessor extends VoiceProcessor {
  constructor(o) { super(new ChassisVoice(sampleRate, o?.processorOptions?.seed ?? seed++)); }
}

class LimiterProcessor extends AudioWorkletProcessor {
  constructor(o) {
    super();
    const p = o?.processorOptions ?? {};
    this.lim = new Limiter(sampleRate, { ceiling: p.ceiling ?? 0.89, lookahead: p.lookahead ?? 0.003, release: p.release ?? 0.08 });
    this.audioMs = 0; this.reportEvery = Math.round(sampleRate * 0.25); this.since = 0; this.alive = true;
    this.port.onmessage = ({ data: m }) => {
      if (m.t === 'bank') bank.add(m.id, m.entry);
      else if (m.t === 'free') bank.free(m.id);
      else if (m.t === 'set') this.lim.set(m);
      else if (m.t === 'end') this.alive = false;
    };
  }
  process(inputs, outputs) {
    if (!this.alive) return false;
    const t0 = clock(), inp = inputs[0], out = outputs[0], n = out[0].length;
    this.lim.process([inp?.[0], inp?.[1]], [out[0], out[1]], n);
    work.ms += clock() - t0;
    this.audioMs += n / sampleRate * 1000; this.since += n;
    if (this.since >= this.reportEvery) {
      this.since = 0;
      const peaks = this.lim.take();
      this.port.postMessage({ t: 'stats', cpuMs: work.ms, audioMs: this.audioMs, voices: work.voices, bankBytes: bank.bytes, bankItems: bank.size, ...peaks });
      work.ms = 0; this.audioMs = 0;
    }
    return true;
  }
}

class CarProcessor extends AudioWorkletProcessor {
  constructor(o) {
    super();
    const p = o?.processorOptions ?? {}, s = p.seed ?? seed++;
    this.e = new EngineVoice(bank, sampleRate, s); this.c = new ChassisVoice(sampleRate, s + 7919);
    this.mix = Float32Array.from(p.mix ?? [1, 0.55, 0.2, 1, 0.75]);
    this.scratch(128);
    this.alive = true;
    work.voices++;
    this.port.onmessage = ({ data: m }) => {
      if (!this.e) return;
      const v = m.to === 'c' ? this.c : this.e;
      if (m.t === 's') v.set(m.s);
      else if (m.t === 'cfg') v.configure(m.cfg);
      else if (m.t === 'ev') (m.e === 'thump' || m.e === 'handbrake' ? this.c : this.e).event(m.e, m.x);
      else if (m.t === 'meter') this.port.postMessage({ t: 'meter', meter: Array.from(this.e.meter), chassis: Array.from(this.c.meter), mode: this.e.mode, rpm: this.e.rpm, pops: this.e.popCount, cut: this.e.cut, lim: this.e.lim });
      else if (m.t === 'end') this.alive = false;
    };
  }
  scratch(n) { this.b = Array.from({ length: 6 }, () => new Float32Array(n)); this.eo = this.b.slice(0, 3); this.co = this.b.slice(3); }
  process(inputs, outputs) {
    if (!this.alive) { if (this.e) { work.voices--; this.e = this.c = null; } return false; }
    const out = outputs[0]?.[0];
    if (!out) return true;
    const t0 = clock(), n = out.length;
    if (this.b[0].length < n) this.scratch(n);
    this.e.process(this.eo, n); this.c.process(this.co, n);
    const [x0, x1, x2, x3, x4] = this.b, M = this.mix, a = M[0], b = M[1], c = M[2], d = M[3], e = M[4];
    for (let i = 0; i < n; i++) out[i] = a * x0[i] + b * x1[i] + c * x2[i] + d * x3[i] + e * x4[i];
    work.ms += clock() - t0;
    return true;
  }
}

registerProcessor('kr-engine', EngineProcessor);
registerProcessor('kr-car', CarProcessor);
registerProcessor('kr-chassis', ChassisProcessor);
registerProcessor('kr-limiter', LimiterProcessor);
