// The game's music (Phase 8 Step 4; docs/AUDIO.md "Music"): composed by the game itself, live, in the audio engine —
// so it's the project's own work, cleared for any use, streams and videos included (streamer-safe by nature). Three
// pieces, each a loop of chords with its own instruments, all through the music bus (its volume slider and the off
// switches in Settings → Sound):
//   menu     calm: a soft pad and a slow arpeggio (88 bpm)
//   garage   relaxed: electric-piano chords, a round bass, brushed drums (84 bpm)
//   race     driving: kick, snare, hats, bass, a pad, an arpeggio and a lead that come in as the intensity rises (128 bpm)
// The race piece builds: setIntensity(0..1) — the race's last lap and a close race push it up (play/: raceIntensity()),
// layers enter and the filter opens over a few seconds, never cutting off mid-bar. Notes are scheduled a little ahead
// on the audio clock (never late, whatever the frame rate) and each piece is the same every time (seeded).
//
//   const M = createMusic(A, { settings })      // A: audio/system.js
//   M.play('menu' | 'garage' | 'race' | null)   // fades between pieces (null: silence)
//   M.setIntensity(x) · M.apply(settings) · M.stop()

export const PIECES = {
  menu: { bpm: 88, key: 57, scale: 'minor', chords: [[0, 3, 7, 10], [-4, 0, 3, 7], [-7, -3, 0, 3], [-2, 2, 5, 9]], layers: ['pad', 'arp'], arp: [0, 2, 1, 3], swing: 0 },
  garage: { bpm: 84, key: 53, scale: 'major', chords: [[0, 4, 7, 11], [-3, 0, 4, 9], [2, 5, 9, 12], [-5, -1, 2, 5]], layers: ['keys', 'bass', 'brush'], swing: 0.12 },
  race: { bpm: 128, key: 52, scale: 'minor', chords: [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -2, 2]], layers: ['kick', 'bass', 'pad', 'hats', 'snare', 'arp', 'lead'], arp: [0, 1, 2, 1, 0, 2, 1, 2], swing: 0 },
};
// the intensity each race layer comes in at
export const RACE_LAYERS = { kick: 0, bass: 0, pad: 0, hats: 0.3, snare: 0.45, arp: 0.6, lead: 0.85 };
const midi = n => 440 * 2 ** ((n - 69) / 12);
// (the same notes every time: a small seeded random)
const seeded = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

export function createMusic(A, { settings = null, lookahead = 0.25 } = {}) {
  const ctx = A.ctx, out = ctx.createGain();
  out.gain.value = 0;
  out.connect(A.bus.music);
  // (a gentle filter on everything: the race opens it as it builds)
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass'; tone.frequency.value = 6000; tone.Q.value = 0.4;
  tone.connect(out);
  let piece = null, name = null, nextBeat = 0, beat = 0, timer = null, intensity = 0, target = 0, rnd = seeded(7);
  let noise = null;
  const noiseBuffer = () => {
    if (noise) return noise;
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0), r = seeded(3);
    for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
    return noise;
  };
  const env = (g, at, a, peak, d, sustain = 0) => { g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(peak, at + a); g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain || 0.0001), at + a + d); };
  function voice(type, freq, at, dur, peak, { detune = 0, filter = null, release = 0.2 } = {}) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    let node = o;
    if (filter) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; o.connect(f); node = f; }
    node.connect(g); g.connect(tone);
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(peak, at + Math.min(0.08, dur / 4)); g.gain.setValueAtTime(peak, at + dur); g.gain.exponentialRampToValueAtTime(0.0001, at + dur + release);
    o.start(at); o.stop(at + dur + release + 0.05);
  }
  function drum(kind, at, level) {
    if (kind === 'kick') {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(150, at); o.frequency.exponentialRampToValueAtTime(45, at + 0.12);
      env(g, at, 0.003, 0.9 * level, 0.3); o.connect(g); g.connect(tone); o.start(at); o.stop(at + 0.4);
      return;
    }
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuffer();
    f.type = kind === 'hat' ? 'highpass' : 'bandpass'; f.frequency.value = kind === 'hat' ? 7000 : kind === 'brush' ? 3000 : 1800;
    env(g, at, 0.002, (kind === 'hat' ? 0.18 : kind === 'brush' ? 0.12 : 0.45) * level, kind === 'hat' ? 0.05 : kind === 'brush' ? 0.18 : 0.16);
    s.connect(f); f.connect(g); g.connect(tone); s.start(at, rnd() * 0.5); s.stop(at + 0.3);
  }
  const has = l => name !== 'race' || intensity >= RACE_LAYERS[l] - 1e-6;
  // one beat (a quarter note) of the piece, from `at` on the audio clock
  function playBeat(at) {
    const P = piece, spb = 60 / P.bpm, bar = Math.floor(beat / 4), b = beat % 4, chord = P.chords[bar % P.chords.length].map(n => P.key + n), L = new Set(P.layers);
    const swing = i => (i % 2 ? P.swing * spb / 2 : 0);
    if (L.has('pad') && has('pad') && b === 0) for (const n of chord) for (const d of [-7, 7]) voice('sawtooth', midi(n), at, spb * 4 - 0.05, 0.022, { detune: d, filter: 900 + 2400 * intensity, release: 0.6 });
    if (L.has('keys') && (b === 0 || b === 2)) for (const n of chord) voice('triangle', midi(n + 12), at + swing(b), spb * 1.6, 0.04, { filter: 2200, release: 0.4 });
    if (L.has('bass') && has('bass')) { const n = chord[0] - 12 - (b === 3 && name === 'garage' ? -7 : 0); if (name === 'race' || b % 2 === 0) voice(name === 'race' ? 'sawtooth' : 'sine', midi(n), at, spb * (name === 'race' ? 0.45 : 0.9), name === 'race' ? 0.09 : 0.14, { filter: name === 'race' ? 500 + 900 * intensity : 0 || null }); if (name === 'race') voice('sawtooth', midi(n), at + spb / 2, spb * 0.4, 0.07, { filter: 500 + 900 * intensity }); }
    if (L.has('arp') && has('arp') && P.arp) for (let i = 0; i < 2; i++) { const step = (beat * 2 + i) % P.arp.length, n = chord[P.arp[step] % chord.length] + 24; voice('square', midi(n), at + i * spb / 2 + swing(i), spb * 0.35, name === 'menu' ? 0.018 : 0.022, { filter: 2500 + 3000 * intensity, release: 0.15 }); }
    if (L.has('kick') && has('kick')) { drum('kick', at, 1); if (intensity > 0.7 && b === 3) drum('kick', at + spb / 2, 0.7); }
    if (L.has('snare') && has('snare') && (b === 1 || b === 3)) drum('snare', at, 0.9);
    if (L.has('hats') && has('hats')) for (let i = 0; i < 2; i++) drum('hat', at + i * spb / 2, i ? 0.6 : 1);
    if (L.has('brush') && (b === 1 || b === 3)) drum('brush', at + swing(1), 0.8);
    if (L.has('lead') && has('lead') && b % 2 === 0) { const n = chord[(bar + b) % chord.length] + 24 + (rnd() < 0.3 ? 2 : 0); voice('sawtooth', midi(n), at, spb * 1.5, 0.03, { detune: 5, filter: 3500, release: 0.3 }); }
  }
  function tick() {
    if (!piece) return;
    // (the intensity eases toward its target: a bar or two to build, longer to calm)
    intensity += (target - intensity) * (target > intensity ? 0.08 : 0.03);
    if (Math.abs(target - intensity) < 0.01) intensity = target;
    tone.frequency.setTargetAtTime(name === 'race' ? 1800 + 9000 * intensity : 5000, ctx.currentTime, 0.5);
    const spb = 60 / piece.bpm;
    while (nextBeat < ctx.currentTime + lookahead) { playBeat(nextBeat); nextBeat += spb; beat++; }
  }
  const level = () => {
    const M = settings?.music ?? {};
    if (!name) return 0;
    if ((name === 'menu' && M.menu === false) || (name === 'garage' && M.garage === false) || (name === 'race' && M.race === false)) return 0;
    return name === 'race' ? 0.55 : 0.7;
  };
  const M = {
    get playing() { return name; },
    get intensity() { return intensity; },
    play(which) {
      if (which === name) return;
      const at = ctx.currentTime;
      out.gain.cancelScheduledValues(at); out.gain.setValueAtTime(out.gain.value, at); out.gain.linearRampToValueAtTime(0, at + 0.8);
      clearInterval(timer); timer = null;
      const start = () => {
        name = which; piece = PIECES[which] ?? null; beat = 0; rnd = seeded(which === 'race' ? 11 : which === 'garage' ? 5 : 7);
        intensity = target = which === 'race' ? intensity : 0;
        if (!piece) return;
        nextBeat = ctx.currentTime + 0.1;
        out.gain.cancelScheduledValues(ctx.currentTime); out.gain.setValueAtTime(0, ctx.currentTime); out.gain.linearRampToValueAtTime(level(), ctx.currentTime + 1.5);
        timer = setInterval(tick, 60);
        tick();
      };
      if (name) setTimeout(start, 850); else start();
      if (!which) name = null;
    },
    setIntensity(x) { target = Math.max(0, Math.min(1, x)); if (settings?.music?.build === false) target = Math.min(target, 0.3); },
    apply(s) { settings = s; out.gain.setTargetAtTime(level(), ctx.currentTime, 0.3); },
    stop() { M.play(null); clearInterval(timer); timer = null; },
    // (tests) the beats to come, without sound
    _beat: () => beat, _layersAt: x => Object.entries(RACE_LAYERS).filter(([, v]) => x >= v).map(([k]) => k),
  };
  return M;
}

// How intense a race feels now (0..1): the last lap, and a rival close (within a couple of seconds) — the race music
// builds with it. lap/laps: the player's; gapAhead/gapBehind: seconds to the cars either side (null: none)
export function raceIntensity({ lap = 1, laps = 1, gapAhead = null, gapBehind = null, progress = null } = {}) {
  const share = progress ?? (laps > 0 ? (lap - 1) / laps : 0);
  let x = 0.25 + 0.35 * Math.min(1, share);
  if (lap >= laps && laps > 0) x += 0.3;                         // the final lap
  const close = Math.min(gapAhead ?? 99, gapBehind ?? 99);
  if (close < 2) x += 0.35 * (1 - close / 2);                     // a close race
  return Math.max(0, Math.min(1, x));
}
