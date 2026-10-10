// The game's sound system (Phase 8 Step 1; docs/AUDIO.md): one AudioContext for everything the game plays — the
// driving, the garage, the quests' cues — through a mixer of groups, each with its volume in the settings:
//
//   engine · tyres (and the road) · impacts · environment (wind, ambience) · others (other cars) · ui · music
//        │ (the environment and other cars through `outside`: the cabin's muffling, in-car)
//        ├─► reverb sends (engine, tyres, impacts, others) ─► tunnel / street echoes, a slap between walls ─┐
//        ▼                                                                                                   ▼
//   pre ──► compressor (holds loud moments together) ──► limiter (look-ahead: never past its ceiling) ──► master ──► out
//
// What's generated or processed sample by sample (engines, tyres and road, the limiter) runs in an AudioWorklet
// (audio/worklet.js, audio/dsp.js): on the audio thread, so it never stutters when the game is busy. Sound files are
// fetched and decoded in the background (decodeAudioData runs off the main thread) only for the cars and parts in
// use, as Opus where the browser decodes it (assets/sounds/manifest.json; tools/content/opus.mjs), else as WAV; each
// is counted by who's using it and let go when nobody is.
//
// Browsers only allow sound after the player has pressed a key or clicked: the system starts on the first one
// (startAudio, from any key or click on the page) and every user waits for it (whenAudio).
//
//   whenAudio(fn)              fn(A) once the system's up (now, if it is)
//   audioSystem()              the system, or null before the first key or click
//   A.ctx · A.bus[group] · A.cfg (data/audio.json) · A.worklet (whether the worklet's there) · A.quality
//   A.setVolumes({ master, engine, … 0..1 }) · A.setQuality('high' | 'low') · A.mute(on) (everything) · A.silence(groups, on)
//   (some: the driving's, while it's not on screen) · A.setView(viewMix) ·
//   A.setReverb({ tunnel, under, street, open, width })
//   await A.engine(path, { mode }) → the engine's sound (refcounted: A.release(sound)) · await A.buffer(file) (refcounted:
//   A.unbuffer(file)) · A.node(name, options) → an AudioWorkletNode of ours (counted until A.drop(node))
//   A.stats() → { cpu: { audio, main, budget }, voices, nodes, buffers, bankMB, limiter } · A.time(fn) (main-thread
//   time spent on sound, measured)

import { loopEntry, sweepEntry } from './mix.js';
import { assetUrl } from '../site/urls.js';

export const GROUPS = ['engine', 'tyres', 'impacts', 'environment', 'others', 'ui', 'music'];
const db = x => 10 ** (x / 20), hidden = () => !!globalThis.document?.hidden;
let system = null, starting = null;
const waiting = [];

export const audioSystem = () => system;
export function whenAudio(fn) { if (system) fn(system); else waiting.push(fn); }

// Start the system (once), from a key press or click; options: { volumes, quality, muted }
export function startAudio(options = {}) {
  if (system) { if (system.ctx.state === 'suspended' && !system.muted && !hidden()) system.ctx.resume().catch(() => {}); return Promise.resolve(system); }
  return starting ??= createAudioSystem(options).then(A => { system = A; for (const fn of waiting.splice(0)) { try { fn(A); } catch (e) { console.error(e); } } return A; }, e => { console.warn(`The game's sound couldn't start: ${e?.message ?? e}`); starting = null; return null; });
}
// (the settings the system starts with: the game says them before the first key, audio/system.js remembers)
let pending = {};
export function audioSettings(o) { pending = { ...pending, ...o }; if (system) { if (o.volumes) system.setVolumes(o.volumes); if (o.quality) system.setQuality(o.quality); } }
if (globalThis.addEventListener && globalThis.document) {
  const go = () => startAudio(pending);
  for (const ev of ['pointerdown', 'keydown', 'touchend']) addEventListener(ev, go, { capture: true, passive: true });
}

export async function createAudioSystem({ volumes = pending.volumes ?? {}, quality = pending.quality ?? 'high', muted = false, context = null } = {}) {
  const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!context && !AC) throw new Error('no Web Audio in this browser');
  const ctx = context ?? new AC({ latencyHint: 'interactive' });
  const cfg = await (await fetch('data/audio.json', { cache: 'no-cache' })).json();
  // ---- the worklet ----
  let worklet = false;
  try { await ctx.audioWorklet.addModule(new URL('./worklet.js', import.meta.url)); worklet = true; }
  catch (e) { console.warn(`The audio worklet didn't load (${e?.message ?? e}): engines and tyres stay simple`); }
  // ---- the master: compressor → limiter → master ----
  const C = cfg.master.compressor, Lm = cfg.master.limiter;
  const pre = new GainNode(ctx, { gain: 1 }), master = new GainNode(ctx, { gain: 0 });
  const comp = new DynamicsCompressorNode(ctx, { threshold: C.threshold, knee: C.knee, ratio: C.ratio, attack: C.attack, release: C.release });
  let limiter;
  if (worklet) limiter = new AudioWorkletNode(ctx, 'kr-limiter', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', processorOptions: { ceiling: db(Lm.ceiling), lookahead: Lm.lookaheadMs / 1000, release: Lm.releaseMs / 1000 } });
  else limiter = new DynamicsCompressorNode(ctx, { threshold: Lm.ceiling - 2, knee: 0, ratio: 20, attack: 0.001, release: Lm.releaseMs / 1000 });
  pre.connect(comp).connect(limiter).connect(master).connect(ctx.destination);
  // ---- the groups; the outside world's muffling; the echoes ----
  const bus = {}, outside = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000, Q: 0.6 });
  outside.connect(pre);
  for (const g of GROUPS) { bus[g] = new GainNode(ctx, { gain: 0 }); bus[g].connect(g === 'environment' || g === 'others' ? outside : pre); }
  const verb = reverbOf(ctx, cfg, pre), sends = {};
  for (const g of ['engine', 'tyres', 'impacts', 'others']) { sends[g] = new GainNode(ctx, { gain: g === 'others' ? 0.9 : g === 'impacts' ? 1 : 0.7 }); bus[g].connect(sends[g]).connect(verb.input); }
  // ---- state ----
  const vol = { master: 1, ...Object.fromEntries(GROUPS.map(g => [g, 1])) };
  const nodes = new Set(), buffers = new Map(), engines = new Map(), silenced = new Set();
  let manifest = null, opusOk = null, decoder = null, mainMs = 0, frames = 0, last = { cpuMs: 0, audioMs: 1, voices: 0, bankBytes: 0, bankItems: 0, peakIn: 0, peakOut: 0, minGain: 1 };
  if (worklet) limiter.port.onmessage = ({ data }) => { if (data.t === 'stats') last = data; };
  const t = () => ctx.currentTime;

  // which files the browser gets: the Opus where it can decode it (tried on the first; a refusal falls back to WAV)
  const canOpus = () => { try { const a = globalThis.document.createElement('audio'); return !!a.canPlayType?.('audio/ogg; codecs="opus"'); } catch { return false; } };
  async function decode(file) {
    manifest ??= fetch(assetUrl('assets/sounds/manifest.json'), { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(m => m?.files ?? {}).catch(() => ({}));
    const m = (await manifest)[file];
    if (opusOk === null) opusOk = canOpus();
    const useOpus = opusOk && m?.opus;
    const res = await fetch(assetUrl(useOpus ? m.opus : file));
    if (!res.ok) throw new Error(`${useOpus ? m.opus : file}: ${res.status}`);
    const bytes = await res.arrayBuffer();
    // (decoded at 32 kHz where the browser can — the files' own rate: less memory than the device's 48 kHz)
    decoder ??= (() => { try { return new OfflineAudioContext(1, 1, 32000); } catch { return ctx; } })();
    let ab;
    try { ab = await decoder.decodeAudioData(bytes); }
    catch (e) { if (useOpus) { opusOk = false; return decode(file); } throw e; }
    const data = ab.getChannelData(0), sr = ab.sampleRate;
    return { data, sr, buffer: ab, pad: useOpus && m.pad ? Math.round(m.pad * sr) : 0, len: useOpus && m.pad ? m.seconds * sr : data.length };
  }

  const A = {
    ctx, cfg, bus, master, pre, outside, verb, worklet, quality, muted,
    get nodes() { return nodes.size; },
    setVolumes(v = {}) {
      Object.assign(vol, Object.fromEntries(Object.entries(v).filter(([, x]) => Number.isFinite(x))));
      for (const g of GROUPS) bus[g].gain.setTargetAtTime((cfg.groups[g] ?? 1) * Math.max(0, Math.min(1.5, vol[g])) * (silenced.has(g) ? 0 : 1), t(), 0.05);
      master.gain.setTargetAtTime(this.muted ? 0 : Math.max(0, Math.min(1, vol.master)), t(), 0.05);
    },
    // some groups quiet for a while (the driving's while the garage or the editor is open): the rest play on
    silence(groups, on) { for (const g of groups) on ? silenced.add(g) : silenced.delete(g); this.setVolumes(); },
    get volumes() { return { ...vol }; },
    setQuality(q) { this.quality = q === 'low' ? 'low' : 'high'; verb.enable(this.quality !== 'low' || !!cfg.lowQuality.reverb); },
    mute(on) { this.muted = !!on; master.gain.setTargetAtTime(on ? 0 : Math.max(0, Math.min(1, vol.master)), t(), 0.03); if (!on && ctx.state === 'suspended' && !hidden()) ctx.resume().catch(() => {}); },
    // what the camera hears of the outside world (audio/mix.js viewMix: outside Hz)
    setView(view) { outside.frequency.setTargetAtTime(Math.min(20000, view.outside ?? 20000), t(), 0.25); },
    setReverb(s) { verb.set(s, cfg, t()); },
    // one of our worklet's nodes (counted until dropped)
    node(name, options) { const n = new AudioWorkletNode(ctx, name, options); nodes.add(n); return n; },
    drop(n) { if (!n) return; try { n.port.postMessage({ t: 'end' }); } catch { /* gone */ } try { n.disconnect(); } catch { /* gone */ } nodes.delete(n); },
    // a sound file, decoded (refcounted)
    async buffer(file) {
      let b = buffers.get(file);
      if (!b) { b = { n: 0, p: decode(file) }; buffers.set(file, b); b.p.catch(() => buffers.delete(file)); }
      b.n++;
      return (await b.p).buffer;
    },
    unbuffer(file) { const b = buffers.get(file); if (b && --b.n <= 0) buffers.delete(file); },
    // an engine's sound (its config, its loops or sweep in the worklet's bank, one loop for a far car's simple voice):
    // loaded once for every car using it, let go (and out of the bank) when the last one is
    async engine(path, { mode = null } = {}) {
      let e = engines.get(path);
      if (!e) {
        e = { n: 0, id: path, cfg: null, modes: new Set(), loading: new Map(), simple: null };
        engines.set(path, e);
        e.cfgP = fetch(path, { cache: 'no-cache' }).then(r => r.json());
      }
      e.n++;
      try {
        e.cfg = await e.cfgP;
        const want = !worklet ? 'none' : (mode ?? e.cfg.mode ?? 'layers') === 'granular' && e.cfg.granular && (this.quality !== 'low' || cfg.lowQuality.granular) ? 'granular' : 'layers';
        if (want !== 'none' && !e.modes.has(want)) {
          if (!e.loading.has(want)) e.loading.set(want, loadEngine(e, want).then(() => e.modes.add(want)));
          await e.loading.get(want);
        }
        if (!e.simple) e.simple = await loadSimple(e);
        e.mode = want;
        return e;
      } catch (err) { console.warn(`The engine sound ${path} didn't load: ${err?.message ?? err}`); return e; }
    },
    release(e) {
      if (!e || !engines.has(e.id) || --e.n > 0) return;
      engines.delete(e.id);
      if (worklet) limiter.port.postMessage({ t: 'free', id: e.id });
    },
    get loaded() { return { engines: [...engines.keys()], buffers: [...buffers.keys()] }; },
    // main-thread time spent on sound (each frame's update)
    time(fn) { const t0 = performance.now(); try { return fn(); } finally { mainMs += performance.now() - t0; } },
    frame() { frames++; },
    stats() {
      const out = { cpu: { audio: last.cpuMs / Math.max(1, last.audioMs), main: frames ? mainMs / frames : 0, budget: cfg.budget }, voices: last.voices, nodes: nodes.size, buffers: buffers.size, engines: engines.size, bankMB: last.bankBytes / 1048576, bankItems: last.bankItems, limiter: { peakIn: last.peakIn, peakOut: last.peakOut, reductionDb: 20 * Math.log10(Math.max(1e-4, last.minGain)) }, state: ctx.state, worklet, quality: this.quality };
      mainMs = 0; frames = 0;
      return out;
    },
    async close() { for (const n of [...nodes]) this.drop(n); try { await ctx.close(); } catch { /* gone */ } if (system === A) { system = null; starting = null; } },
  };
  async function loadEngine(e, mode) {
    const c = e.cfg;
    if (mode === 'granular') {
      const [on, off, grains] = await Promise.all([decode(c.granular.on), decode(c.granular.off), fetch(assetUrl(c.granular.grains)).then(r => r.json())]);
      const shift = c.shift ? await decode(c.shift.file) : null;
      limiter.port.postMessage({ t: 'bank', id: e.id, entry: { sr: on.sr, sweep: { on: sweepEntry(on.data, grains.on, grains.sr, on.sr), off: sweepEntry(off.data, grains.off, grains.sr, off.sr) }, ...(shift && { shift: { data: shift.data } }) } });
    } else {
      const layers = await Promise.all(c.layers.map(async L => { const [on, off] = await Promise.all([decode(L.on), decode(L.off)]); return { rpm: L.rpm, on: loopOf(on), off: loopOf(off), sr: on.sr }; }));
      const shift = c.shift ? await decode(c.shift.file) : null;
      limiter.port.postMessage({ t: 'bank', id: e.id, entry: { sr: layers[0].sr, layers: layers.map(({ rpm, on, off }) => ({ rpm, on, off })), ...(shift && { shift: { data: shift.data } }) } });
    }
  }
  const loopOf = d => d.pad ? loopEntry({ data: d.data, pad: d.pad, len: d.len }) : loopEntry(d.data);
  // (a far car's voice: one on-load loop from the middle of the revs, played faster or slower)
  async function loadSimple(e) {
    const L = e.cfg.layers[Math.floor(e.cfg.layers.length / 2)], d = await decode(L.on);
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(d.len)), d.sr);
    buf.copyToChannel(d.data.subarray(d.pad, d.pad + Math.floor(d.len)), 0);
    return { buffer: buf, rpm: L.rpm };
  }
  A.setVolumes(volumes);
  A.setQuality(quality);
  A.mute(muted);
  // (a hidden tab: nothing to hear — and nothing to drive the sounds — until it's back)
  if (!context) globalThis.document?.addEventListener('visibilitychange', () => { if (hidden()) ctx.suspend().catch(() => {}); else if (!A.muted) ctx.resume().catch(() => {}); });
  if (!context && ctx.state === 'suspended' && !hidden()) await ctx.resume().catch(() => {});
  return A;
}

// ---------- the echoes ----------
// Two convolution reverbs made here (decaying noise, no recordings): a tunnel's long, dense one and a street's shorter
// one with early reflections — and a slap (a short delay fed back) between close walls. set(surroundings) moves their
// levels: in a tunnel the tunnel's; under a bridge a little of the tunnel's and the slap; between buildings the
// street's and the slap (its delay from how far apart the walls are); in the open almost nothing.
function impulse(ctx, seconds, { early = [], hz = 5000, seed = 1 } = {}) {
  const sr = ctx.sampleRate, n = Math.max(1, Math.round(sr * seconds)), b = ctx.createBuffer(2, n, sr);
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 * 2 - 1; };
  const k = Math.exp(-2 * Math.PI * hz / sr);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) { const tt = i / sr, env = Math.exp(-6.9 * tt / seconds) * Math.min(1, tt / 0.004); lp = lp * k + rnd() * (1 - k); d[i] = lp * env * 3; }
    for (const [at, g] of early) { const i = Math.round(sr * at * (1 + 0.04 * c)); if (i < n) d[i] += g * (c ? -1 : 1); }
  }
  return b;
}
function reverbOf(ctx, cfg, out) {
  const R = cfg.reverb, input = new GainNode(ctx, { gain: 1 });
  const tunnel = new ConvolverNode(ctx, { buffer: impulse(ctx, R.tunnel.seconds, { hz: R.tunnel.hz, seed: 7 }) });
  const street = new ConvolverNode(ctx, { buffer: impulse(ctx, R.street.seconds, { hz: R.street.hz, seed: 11, early: [[0.018, 0.5], [0.031, 0.35], [0.047, 0.3], [0.066, 0.2]] }) });
  const tunnelG = new GainNode(ctx, { gain: 0 }), streetG = new GainNode(ctx, { gain: 0 });
  const slapIn = new GainNode(ctx, { gain: 0 }), slap = new DelayNode(ctx, { maxDelayTime: 0.5, delayTime: 0.06 }), fb = new GainNode(ctx, { gain: R.slap.feedback }), slapLp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 3500 });
  input.connect(tunnel).connect(tunnelG).connect(out);
  input.connect(street).connect(streetG).connect(out);
  input.connect(slapIn).connect(slap).connect(slapLp).connect(out);
  slapLp.connect(fb).connect(slap);
  let on = true;
  return {
    input,
    enable(x) { on = x; if (!x) for (const g of [tunnelG, streetG, slapIn]) g.gain.setTargetAtTime(0, ctx.currentTime, 0.1); },
    set(s, C, t) {
      const R2 = C.reverb, tau = 0.3;
      if (!on) { slapIn.gain.setTargetAtTime(0, t, tau); return; }
      tunnelG.gain.setTargetAtTime(R2.tunnel.send * (s.tunnel ?? 0) + R2.under.send * 0.5 * (s.under ?? 0), t, tau);
      streetG.gain.setTargetAtTime(R2.street.send * (s.street ?? 0) + R2.open.send * (s.open ?? 0) + R2.under.send * 0.4 * (s.under ?? 0), t, tau);
      slapIn.gain.setTargetAtTime(R2.slap.send * Math.max(s.street ?? 0, (s.under ?? 0) * 0.8, (s.tunnel ?? 0) * 0.5), t, tau);
      if (s.width) slap.delayTime.setTargetAtTime(Math.min(0.45, Math.max(0.02, s.width / 343)), t, 0.5);
    },
    nodes: { tunnel, street, tunnelG, streetG, slap, slapIn },
  };
}
