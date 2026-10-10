// A stand-in for Web Audio in Node (the sound's tests; Phase 8 Step 1): enough of an AudioContext and its nodes for
// audio/system.js, audio/car.js, audio/crash.js, audio/voices.js and audio/game.js to run — every node counted as it's
// made, connected, started, stopped and disconnected, and each worklet node's messages kept — so the tests can say
// that sounds stop and everything's let go when cars and worlds go. The sound files are the repository's WAVs (no
// Opus decoder here: the WAV is what a browser without Opus gets).
//
//   const F = installFakeAudio()   (globals: AudioContext, the nodes, OfflineAudioContext, fetch for the repo's files)
//   F.ctx (the context made, once made) · F.live() → { nodes, sources, worklets, edges } (made and not yet let go)
//   F.messages(name) → every message sent to that kind of worklet node · F.restore()

import fs from 'node:fs';
import path from 'node:path';
import { root } from './harness.mjs';
import { readWav } from '../tools/content/sound.mjs';

export function installFakeAudio() {
  const all = new Set(), msgs = [], saved = {};
  class Param {
    constructor(v = 0) { this.value = v; this.target = v; }
    setTargetAtTime(v) { this.value = v; this.target = v; return this; }
    setValueAtTime(v) { this.value = v; return this; }
    linearRampToValueAtTime(v) { this.value = v; return this; }
    exponentialRampToValueAtTime(v) { this.value = v; return this; }
    cancelScheduledValues() { return this; }
  }
  class Node {
    constructor(ctx, o = {}) {
      this.ctx = ctx; this.o = o; this.outs = new Set(); this.ins = 0; this.dead = false;
      for (const k of ['gain', 'frequency', 'Q', 'playbackRate', 'delayTime', 'positionX', 'positionY', 'positionZ', 'threshold', 'knee', 'ratio', 'attack', 'release', 'detune']) this[k] = new Param(o[k] ?? (k === 'gain' || k === 'playbackRate' ? 1 : 0));
      all.add(this);
    }
    connect(n) { this.outs.add(n); return n; }
    disconnect(n) { if (n) this.outs.delete(n); else this.outs.clear(); if (!n) this.dead = true; }
  }
  class Source extends Node {
    constructor(ctx, o = {}) { super(ctx, o); this.buffer = o.buffer ?? null; this.loop = !!o.loop; this.started = false; this.stopped = false; this.onended = null; }
    start() { this.started = true; if (!this.loop && !(this instanceof OscillatorNode)) queueMicrotask(() => this.end()); }
    stop() { if (this.stopped) return; this.stopped = true; queueMicrotask(() => this.end()); }
    end() { if (this.ended) return; this.ended = true; this.onended?.(); }
  }
  class OscillatorNode extends Source {}
  class AudioBufferSourceNode extends Source {}
  class AudioWorkletNode extends Node {
    constructor(ctx, name, o = {}) {
      super(ctx, o); this.name = name;
      const me = this;
      this.port = { onmessage: null, postMessage(m) { msgs.push({ name, m }); if (m.t === 'end') me.ended = true; if (m.t === 'meter') queueMicrotask(() => me.port.onmessage?.({ data: { t: 'meter', meter: [] } })); } };
    }
  }
  const buffer = (channels, length, sampleRate) => { const ch = Array.from({ length: channels }, () => new Float32Array(length)); return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: i => ch[i], copyToChannel: (d, i) => ch[i].set(d.subarray(0, length)) }; };
  const decode = async bytes => { const { samples, sr } = readWav(Buffer.from(bytes)); const b = buffer(1, samples.length, sr); b.getChannelData(0).set(Float32Array.from(samples)); return b; };
  class AudioContext {
    constructor() { this.currentTime = 0; this.sampleRate = 48000; this.state = 'running'; this.destination = new Node(this); this.audioWorklet = { addModule: async () => {} }; F.ctx = this; }
    createBuffer(c, n, sr) { return buffer(c, n, sr); }
    decodeAudioData(bytes) { return decode(bytes); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createGain() { return new GainNode(this); } createOscillator() { return new OscillatorNode(this); } createBiquadFilter() { return new BiquadFilterNode(this); } createBufferSource() { return new AudioBufferSourceNode(this); }
  }
  class OfflineAudioContext { decodeAudioData(bytes) { return decode(bytes); } }
  class GainNode extends Node {} class BiquadFilterNode extends Node {} class WaveShaperNode extends Node {} class PannerNode extends Node {}
  class ConvolverNode extends Node {} class DelayNode extends Node {} class DynamicsCompressorNode extends Node {} class AnalyserNode extends Node {}
  const classes = { AudioContext, OfflineAudioContext, GainNode, BiquadFilterNode, WaveShaperNode, PannerNode, ConvolverNode, DelayNode, DynamicsCompressorNode, AnalyserNode, OscillatorNode, AudioBufferSourceNode, AudioWorkletNode };
  for (const [k, v] of Object.entries(classes)) { saved[k] = globalThis[k]; globalThis[k] = v; }
  saved.fetch = globalThis.fetch;
  globalThis.fetch = async f => {
    const file = path.join(root, String(f).replace(/^\.?\//, '').split('?')[0]);
    if (!fs.existsSync(file)) return { ok: false, status: 404, json: async () => { throw new Error('404'); }, arrayBuffer: async () => new ArrayBuffer(0) };
    const buf = fs.readFileSync(file);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString('utf8')), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
  };
  const F = {
    ctx: null, classes,
    advance(dt) { if (F.ctx) F.ctx.currentTime += dt; },
    // what's made and not let go: nodes not disconnected, sources started and not stopped (looping or not ended),
    // worklet nodes not ended
    live() {
      let nodes = 0, sources = 0, worklets = 0;
      for (const n of all) {
        if (n === F.ctx?.destination) continue;
        if (n instanceof Source) { if (n.started && !n.ended) sources++; if (!n.dead && !n.ended) nodes++; continue; }
        if (n instanceof AudioWorkletNode) { if (!n.ended) worklets++; }
        if (!n.dead) nodes++;
      }
      return { nodes, sources, worklets };
    },
    get made() { return all.size; },
    messages: name => msgs.filter(x => !name || x.name === name).map(x => x.m),
    forget() { for (const n of [...all]) if (n.dead || n.ended) all.delete(n); msgs.length = 0; },
    restore() { for (const [k, v] of Object.entries(saved)) globalThis[k] = v; },
  };
  return F;
}
