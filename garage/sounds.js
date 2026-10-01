// The garage's sounds, made with WebAudio (no files): a whoosh as a part slides, a clunk as it seats,
// a ratchet undoing bolts, the lift's hydraulic hum, and the engine on the dyno.

export function createSounds() {
  let ctx = null, master = null, on = true, hum = null, engine = null;
  const audio = () => {
    if (!ctx) {
      const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
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
      if (!running) { if (hum) { const h = hum; hum = null; h.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08); setTimeout(() => { h.o.stop(); h.o2.stop(); }, 400); } return; }
      if (!on || hum || !audio()) return;
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = 62; o2.type = 'square'; o2.frequency.value = 124.5;
      f.type = 'lowpass'; f.frequency.value = 380;
      g.gain.value = 0.0001; g.gain.setTargetAtTime(0.09, ctx.currentTime, 0.1);
      o.connect(f); o2.connect(f); f.connect(g).connect(master); o.start(); o2.start();
      hum = { o, o2, g };
    },
    // the engine on the dyno: rpm, or null to stop
    dyno(rpm) {
      if (rpm == null || !on) { if (engine) { const e = engine; engine = null; e.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.15); setTimeout(() => { e.o.stop(); e.o2.stop(); }, 700); } return; }
      if (!audio()) return;
      if (!engine) {
        const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
        o.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.Q.value = 2;
        g.gain.value = 0.0001; g.gain.setTargetAtTime(0.12, ctx.currentTime, 0.1);
        o.connect(f); o2.connect(f); f.connect(g).connect(master); o.start(); o2.start();
        engine = { o, o2, g, f };
      }
      const hz = rpm / 60 * 2;                    // a four-cylinder fires twice a turn
      engine.o.frequency.setTargetAtTime(hz, ctx.currentTime, 0.03);
      engine.o2.frequency.setTargetAtTime(hz * 0.5, ctx.currentTime, 0.03);
      engine.f.frequency.setTargetAtTime(400 + rpm * 0.35, ctx.currentTime, 0.05);
    },
  };
}
