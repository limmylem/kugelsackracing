// The garage's sounds, made with WebAudio (no files): a whoosh as a part slides, a clunk as it seats, a ratchet undoing
// bolts, the lift's hydraulic hum — and on the dyno the car's real engine (Phase 8 Step 1: audio/car.js, the same
// sound as on the road, its parts and all), so you hear what a part does before and after fitting it. Through the
// game's sound system (audio/system.js): its menus-and-cues group, so the driving's sounds being off doesn't silence it.

import { audioSystem, startAudio } from '../audio/system.js';
import { createCarVoice } from '../audio/car.js';
import { TurboSpool, turboInput } from '../audio/mix.js';

export function createSounds() {
  let ctx = null, master = null, on = true, hum = null, engine = null;
  const audio = () => {
    const A = audioSystem();
    if (!A) { startAudio(); return null; }
    if (!ctx) { ctx = A.ctx; master = new GainNode(ctx, { gain: 0.5 }); master.connect(A.bus.ui); }
    if (ctx.state === 'suspended' && !A.muted) ctx.resume().catch(() => {});
    return ctx;
  };
  const noise = seconds => {
    const c = audio(), buf = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf; return src;
  };
  const env = (param, t, peak, attack, decay) => { param.setValueAtTime(0.0001, t); param.exponentialRampToValueAtTime(peak, t + attack); param.exponentialRampToValueAtTime(0.0001, t + attack + decay); };

  return {
    get enabled() { return on; },
    set enabled(v) { on = v; if (!v) { this.lift(false); this.dyno(null); } },
    // a part sliding (out: falling pitch; in: rising)
    whoosh(out = true, seconds = 0.3) {
      if (!on || !audio()) return;
      const t = ctx.currentTime, n = noise(seconds + 0.05), f = ctx.createBiquadFilter(), g = ctx.createGain();
      f.type = 'bandpass'; f.Q.value = 1.4;
      f.frequency.setValueAtTime(out ? 1800 : 500, t); f.frequency.exponentialRampToValueAtTime(out ? 450 : 1600, t + seconds);
      env(g.gain, t, 0.35, seconds * 0.35, seconds * 0.65);
      n.connect(f).connect(g).connect(master); n.start(t); n.stop(t + seconds + 0.05);
    },
    // a part seating: a low thump with a metallic tick
    clunk() {
      if (!on || !audio()) return;
      const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.18);
      env(g.gain, t, 0.7, 0.005, 0.2);
      o.connect(g).connect(master); o.start(t); o.stop(t + 0.25);
      const n = noise(0.06), f = ctx.createBiquadFilter(), g2 = ctx.createGain();
      f.type = 'highpass'; f.frequency.value = 2500; env(g2.gain, t, 0.25, 0.002, 0.05);
      n.connect(f).connect(g2).connect(master); n.start(t); n.stop(t + 0.06);
    },
    // an impact wrench undoing (or doing up) bolts
    ratchet(clicks = 6) {
      if (!on || !audio()) return;
      for (let i = 0; i < clicks; i++) {
        const t = ctx.currentTime + i * 0.028, n = noise(0.02), f = ctx.createBiquadFilter(), g = ctx.createGain();
        f.type = 'bandpass'; f.frequency.value = 3200 + (i % 2) * 400; f.Q.value = 3;
        env(g.gain, t, 0.3, 0.001, 0.018);
        n.connect(f).connect(g).connect(master); n.start(t); n.stop(t + 0.03);
      }
    },
    // the lift's hydraulic pump while it moves
    lift(running) {
      if (!running) { if (hum) { const h = hum; hum = null; h.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08); setTimeout(() => { h.o.stop(); h.o2.stop(); h.g.disconnect(); }, 400); } return; }
      if (!on || hum || !audio()) return;
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = 62; o2.type = 'square'; o2.frequency.value = 124.5;
      f.type = 'lowpass'; f.frequency.value = 380;
      g.gain.value = 0.0001; g.gain.setTargetAtTime(0.09, ctx.currentTime, 0.1);
      o.connect(f); o2.connect(f); f.connect(g).connect(master); o.start(); o2.start();
      hum = { o, o2, g };
    },
    // The car on the dyno: its own engine (sound: the run's — { engine, audio, turbo, gearbox }, a spec's), at rpm,
    // flat out; null: the throttle shut (crackles, the blow-off, back to idle), then quiet. Each run keeps its sound,
    // so a run before a part and one after can be heard again, one after the other (garage/garageUi.js).
    dyno(rpm, sound = null) {
      const A = audioSystem();
      if (rpm == null || !on) {
        if (engine) {
          const e = engine; engine = null;
          e.voice.update({ engine: { ...e.last, throttle: 0, pedal: 0, load: -0.9, rpm: e.spec.engine.idleRpm * 1.05, whistle: e.last?.whistle ? { ...e.last.whistle, gain: 0 } : null } }, 0);
          clearTimeout(e.timer);
          e.timer = setTimeout(() => { e.out.gain.setTargetAtTime(0, A.ctx.currentTime, 0.2); setTimeout(() => { e.voice.dispose(); e.out.disconnect(); }, 900); }, 1600);
        }
        return;
      }
      if (!audio() || !A) return;
      if (engine && sound && engine.spec !== sound) { const e = engine; engine = null; e.voice.dispose(); e.out.disconnect(); }
      if (!engine) {
        const spec = sound ?? null;
        if (!spec?.engine) return;
        const out = new GainNode(ctx, { gain: 1.4 }); out.connect(A.bus.ui);
        engine = { spec, out, voice: createCarVoice(A, { spec, role: 'player', out }), last: null, turbo: new TurboSpool() };
        engine.voice.setView({ ...A.cfg.views.chase, tyres: 0, road: 0, wind: 0 });
      }
      const E = engine.spec.engine, r = Math.min(E.redlineRpm, Math.max(E.idleRpm, rpm));
      const tu = turboInput(engine.turbo, engine.spec, 1 / 60, r, 1);
      engine.last = { rpm: r, throttle: 1, pedal: 1, load: 1, gear: 3, clutch: 1, shifting: false, fuelCut: rpm >= E.redlineRpm, misfire: 0, spool: tu.spool, whistle: tu.whistle };
      engine.voice.update({ engine: engine.last }, 1 / 60);
    },
    // (what the dyno's engine needs from a spec: kept with each run)
    soundOf: spec => spec ? { engine: spec.engine, audio: spec.audio, turbo: spec.turbo ?? null, gearbox: spec.gearbox ?? null } : null,
  };
}
