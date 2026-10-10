// A generated track's ambience (Phase 5 Step 4; Web Audio, made as it plays — no sound files): the theme's
// own sounds (data/sounds/ambient.json: birds chirping now and then, wind gusting, the sea's waves on a
// slow swell, a city's traffic and a horn far off), and a crowd that murmurs louder the nearer you are to a
// grandstand and cheers when someone's overtaken or crashes. The mix: testtrack/soundMix.js ambienceMix.
//
//   const A = createTrackAmbience(ctx, out, { cfg, theme, grandstands: [{ x, y, z }] })
//   A.update({ listener: [x, y, z], speed, inside }, dt)   A.cheer(kind ('overtake' | 'crash'), strength)   A.dispose()
//   A.setTheme(theme)   (a name, or the layers themselves: the real world's, as its area changes — audio/environment.js)

import { ambienceMix } from './soundMix.js';

const noiseBuffer = (ctx, seconds, colour) => {
  const sr = ctx.sampleRate, b = ctx.createBuffer(1, Math.round(sr * seconds), sr), d = b.getChannelData(0);
  let y = 0;
  for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; y = colour === 'brown' ? y * 0.98 + w * 0.02 : colour === 'pink' ? y * 0.9 + w * 0.1 : w; d[i] = colour === 'white' ? w : y * (colour === 'brown' ? 6 : 3); }
  return b;
};
const loop = (ctx, buf, filter, out) => { const s = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true }), g = new GainNode(ctx, { gain: 0 }); s.connect(filter).connect(g).connect(out); s.start(); return { src: s, filter, gain: g }; };

export function createTrackAmbience(ctx, out, { cfg, theme = 'countryside', grandstands = [] }) {
  const bus = new GainNode(ctx, { gain: 1 }); bus.connect(out);
  const pink = noiseBuffer(ctx, 3, 'pink'), brown = noiseBuffer(ctx, 3, 'brown'), white = noiseBuffer(ctx, 2, 'white');
  const wind = loop(ctx, pink, new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 500, Q: 0.7 }), bus);
  const sea = loop(ctx, brown, new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 900, Q: 0.4 }), bus);
  const city = loop(ctx, brown, new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 220, Q: 0.6 }), bus);
  const crowd = loop(ctx, white, new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 900, Q: 0.5 }), bus);
  const cheerNode = loop(ctx, white, new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1400, Q: 0.7 }), bus);
  const birdsGain = new GainNode(ctx, { gain: 0 }); birdsGain.connect(bus);
  let t = 0, cheer = 0, nextBird = 0.5, nextHorn = 8, mix = null, alive = true;
  // a chirp: a few quick falling-and-rising whistles
  const chirp = () => {
    const at = ctx.currentTime, base = 2600 + Math.random() * 2200, n = 2 + Math.floor(Math.random() * 4);
    for (let k = 0; k < n; k++) {
      const o = new OscillatorNode(ctx, { type: 'sine', frequency: base }), g = new GainNode(ctx, { gain: 0 }), s = at + k * (0.09 + Math.random() * 0.05);
      o.frequency.setValueAtTime(base * 1.25, s); o.frequency.exponentialRampToValueAtTime(base * 0.8, s + 0.07);
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.06, s + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, s + 0.08);
      o.connect(g).connect(birdsGain); o.start(s); o.stop(s + 0.1);
    }
  };
  // a horn far off: two notes, quietly
  const horn = level => {
    const at = ctx.currentTime, g = new GainNode(ctx, { gain: 0 }), f = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 1200 });
    g.connect(f).connect(bus);
    for (const hz of [392, 494]) { const o = new OscillatorNode(ctx, { type: 'sawtooth', frequency: hz }); o.connect(g); o.start(at); o.stop(at + 0.5); }
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.03 * level, at + 0.03); g.gain.setValueAtTime(0.03 * level, at + 0.4); g.gain.linearRampToValueAtTime(0, at + 0.5);
  };
  return {
    update({ listener, speed = 0, inside = false }, dt) {
      if (!alive) return;
      t += dt;
      const stand = grandstands.length ? Math.min(...grandstands.map(g => Math.hypot(g.x - listener[0], g.y - listener[1], g.z - listener[2]))) : null;
      cheer = Math.max(0, cheer - dt / (cfg.crowd?.cheerFade ?? 2.2));
      mix = ambienceMix(cfg, theme, { stand, speed, inside, cheer });
      const L = mix.layers, now = ctx.currentTime;
      // (the wind gusts, the sea swells: slow waves on their levels)
      wind.gain.gain.setTargetAtTime(L.wind * 0.12 * (0.6 + 0.4 * Math.sin(t * 0.37) * Math.sin(t * 0.11 + 1)), now, 0.3);
      wind.filter.frequency.setTargetAtTime(380 + 260 * (0.5 + 0.5 * Math.sin(t * 0.23)), now, 0.4);
      sea.gain.gain.setTargetAtTime(L.sea * 0.2 * (0.35 + 0.65 * Math.max(0, Math.sin(t * 2 * Math.PI / 7)) ** 2), now, 0.25);
      city.gain.gain.setTargetAtTime(L.city * 0.25, now, 0.5);
      birdsGain.gain.setTargetAtTime(L.birds, now, 0.5);
      crowd.gain.gain.setTargetAtTime(mix.crowd * 0.1 * (0.85 + 0.15 * Math.sin(t * 1.7)), now, 0.3);
      cheerNode.gain.gain.setTargetAtTime(mix.cheer * 0.22, now, 0.15);
      if (L.birds > 0.02 && t >= nextBird) { chirp(); nextBird = t + 0.6 + Math.random() * 3.5 / L.birds; }
      if (L.city > 0.02 && t >= nextHorn) { horn(L.city); nextHorn = t + 6 + Math.random() * 18; }
    },
    // something for the crowd to cheer (its kind's size, data/sounds/ambient.json crowd)
    cheer(kind = 'overtake', strength = 1) { cheer = Math.min(1, Math.max(cheer, (cfg.crowd?.[kind] ?? 0.6) * strength)); },
    get mix() { return mix; },
    setTheme(t) { theme = t; },
    dispose() {
      alive = false;
      for (const l of [wind, sea, city, crowd, cheerNode]) { try { l.src.stop(); } catch { /* stopped */ } l.gain.disconnect(); }
      birdsGain.disconnect(); bus.disconnect();
    },
  };
}
