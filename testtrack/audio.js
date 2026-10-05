// Car sounds for the test worlds (Web Audio). Browsers only allow sound after a key press, so the
// game creates this on the first one.
//
// Engine: the files and settings of the engine's sound config (spec.engine.sound, data/sounds/engines):
// loops at rpm points from idle to the redline, each on load and off load, crossfaded by the revs and
// the throttle and pitched only a little (testtrack/soundMix.js works out the mix); louder and brighter
// up high, deeper and smoother down low. Around it, quieter: the intake's air at high throttle, a clunk
// as each gear goes in, a soft cut each time the rev limiter cuts the fuel, and — when it happens — the
// bang of a blown engine and the clack of bent valves; a misfiring or valve-floating engine drops some
// firings. No exhaust pops or crackles. Swapping the engine (another sound config) loads its files.
//
// Turbo (only with one fitted: spec.turbo, from the turbo part): a whistle — a tone and some rushing
// air — whose pitch and level follow the spool, rising under throttle and fading off it; each turbo
// part has its own (its sound.whistle).
//
// Crashes (data/sounds/crash.json): a hit plays a tap, crunch or crash for what was hit (metal, concrete,
// another car), one of its takes at random, a little higher or lower each time and louder the harder it
// was; sliding along something plays a scrape loop that follows the scrape (physics/impacts.js); glass
// and lights break with their own sounds.
//
// Tyres: band-passed noise plus a faint wavering screech, louder the faster the tyres slide; on
// gravel a crunch of stones (random clicks through a band-pass) that speeds up with the car; on grass a
// soft swish; across a kerb a rumble at the rate its stripes go by (soundMix.js tyreMix).
//
// Mechanical damage (data/sounds/mechanical.json, physics/mechanical.js; made as it plays): a boost
// leak hisses more the more boost there is; a soft or flat tyre flaps once a turn (flat, its rim scrapes:
// the scrape loop); a damaged gearbox grinds taking a gear (grind()); a damaged diff whines, rising with
// speed; a holed or torn-off exhaust adds a louder, rattly layer of the engine's own sound.
//
// The cockpit (a cockpit or bonnet camera): with a convertible's roof down, the engine's louder and the
// wind roars (soundMix.js cabinMix); a closed car, a little wind at speed.

import { TurboSpool, cabinMix, curveAt, dropped, engineLevels, intakeMix, layerMix, loadOf, roughShare } from './soundMix.js';

// spec: the live car spec (its engine's sound config and turbo are followed as they change)
export function createAudio(spec) {
  const ctx = new AudioContext();
  const master = new GainNode(ctx, { gain: 1 });
  master.connect(ctx.destination);
  const engine = engineSound(ctx, master, spec), turbo = turboWhistle(ctx, master), crash = crashSounds(ctx, master), mech = mechanicalSounds(ctx, master, engine.tap), wind = windNoise(ctx, master);
  return {
    ctx, master, engine, turbo, crash, mech, wind, squeal: tyreSqueal(ctx, master), gravel: gravelCrunch(ctx, master), tyres: tyreSurfaces(ctx, master),
    // s: the vehicle's snapshot, each frame; extra: { exhaust (0..1: the exhaust loose or torn off),
    // inside (a cockpit or bonnet camera), steam (0..1: steam from the engine bay, effects/director.js) }
    update(s, dt, extra = {}) {
      const cabin = cabinMix(spec.roof, !!extra.inside, finite(s.speed, 0));
      engine.cabin.gain.setTargetAtTime(cabin.engine, ctx.currentTime, 0.15);
      wind.set(cabin.wind, finite(s.speed, 0));
      engine.update(s.engine, dt); turbo.update(s, dt, spec.turbo);
      // (the body along a wall, a part dragging on the road, a flat tyre's rim: the strongest)
      const scrapes = [s.scrape, s.partScrape, s.mechanical?.rimScrape].filter(Boolean);
      crash.scrape(scrapes.length ? scrapes.reduce((a, b) => b.amount > a.amount ? b : a) : null);
      crash.rattle(s.rattle ?? 0);
      mech.update(s, dt, spec, extra);
    },
    grind: strength => mech.grind(strength),
    bang: () => engine.play('bang'), clunk: () => engine.play('bent'),
    mute(on) { master.gain.setTargetAtTime(on ? 0 : 1, ctx.currentTime, 0.03); },
  };
}

const finite = (x, or) => Number.isFinite(x) ? x : or;

function engineSound(ctx, out, spec) {
  // layers → rough (dropped firings) → tone (low-pass) → level → out; the intake and one-offs straight out
  const rough = new GainNode(ctx, { gain: 1 }), tone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 2000, Q: 0.5 }), level = new GainNode(ctx, { gain: 0 }), cabin = new GainNode(ctx, { gain: 1 });
  rough.connect(tone).connect(level).connect(cabin).connect(out);
  let path = null, sound = null, loading = null, phase = 0, firing = 0, lastCut = -1, wasCut = false, wasShifting = false;

  // load a sound config and every file it names; the old engine's nodes stop once the new one's ready
  async function load(p) {
    const cfg = await (await fetch(p, { cache: 'no-cache' })).json();
    const decode = async f => ctx.decodeAudioData(await (await fetch(f)).arrayBuffer());
    const files = [...new Set([...cfg.layers.flatMap(L => [L.on, L.off]), cfg.intake.file, cfg.shift.file, cfg.limiter.file, cfg.damage.bang, cfg.damage.bent])];
    const buffers = new Map(await Promise.all(files.map(async f => [f, await decode(f)])));
    const loop = (file, to) => { const src = new AudioBufferSourceNode(ctx, { buffer: buffers.get(file), loop: true }), gain = new GainNode(ctx, { gain: 0 }); src.connect(gain).connect(to); src.start(0, Math.random() * buffers.get(file).duration); return { src, gain }; };
    const layers = cfg.layers.map(L => ({ on: loop(L.on, rough), off: loop(L.off, rough) }));
    const band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: cfg.intake.hz[0], Q: cfg.intake.q }), intakeGain = new GainNode(ctx, { gain: 0 });
    band.connect(intakeGain).connect(out);
    const intake = loop(cfg.intake.file, band);
    intake.gain.gain.value = 1;
    return { cfg, buffers, layers, intake: { band, gain: intakeGain, src: intake.src } };
  }
  function stop(s) { for (const L of s.layers) for (const x of [L.on, L.off]) x.src.stop(); s.intake.src.stop(); }
  const one = (file, gain) => { const src = new AudioBufferSourceNode(ctx, { buffer: sound.buffers.get(file) }), g = new GainNode(ctx, { gain }); src.connect(g).connect(out); src.start(); };

  return {
    tap: level,                     // (the engine's sound, for a holed exhaust to rattle)
    cabin,                          // (how loud it is where you're listening: the cockpit, roof up or down)
    get config() { return sound?.cfg ?? null; },
    // a one-off: 'bang' (blown), 'bent' (bent valves), 'shift', 'limiter'
    play(what) {
      if (!sound) return;
      const c = sound.cfg;
      if (what === 'bang') one(c.damage.bang, c.damage.bangGain);
      else if (what === 'bent') one(c.damage.bent, c.damage.bentGain);
      else if (what === 'shift') one(c.shift.file, c.shift.gain);
      else if (what === 'limiter') one(c.limiter.file, c.limiter.gain);
    },
    // e: the drivetrain's snapshot ({ rpm, throttle, fuelCut, shifting, health })
    update(e, dt) {
      const want = spec.engine.sound ?? null;
      if (want !== path && !loading) {
        path = want;
        if (!want) { if (sound) stop(sound); sound = null; }
        else loading = load(want).then(s => { if (sound) stop(sound); sound = s; }, err => console.warn(`The engine sound ${want} didn't load: ${err.message ?? err}`)).finally(() => { loading = null; });
      }
      if (!sound) return;
      // (anything not a number — e.g. a half-loaded page — is treated as idling, never passed to Web Audio)
      const t = ctx.currentTime, E = spec.engine, cfg = sound.cfg;
      const rpm = Math.max(0, finite(e.rpm, E.idleRpm)), throttle = finite(e.throttle, 0), onLoad = loadOf(cfg, throttle, e.fuelCut);
      // the loops, their rates and levels
      layerMix(cfg, Math.max(rpm, 1), onLoad).forEach((m, i) => {
        const L = sound.layers[i], fast = e.fuelCut ? 0.004 : 0.03;
        L.on.gain.gain.setTargetAtTime(m.on, t, fast); L.off.gain.gain.setTargetAtTime(m.off, t, 0.03);
        L.on.src.playbackRate.setTargetAtTime(m.rate, t, 0.015); L.off.src.playbackRate.setTargetAtTime(m.rate, t, 0.015);
      });
      // (an exhaust or intake changes it a little: spec.soundMod)
      const lv = engineLevels(cfg, E, rpm, onLoad), mod = spec.soundMod ?? {};
      level.gain.setTargetAtTime(lv.level * finite(mod.level, 1), t, 0.03);
      tone.frequency.setTargetAtTime(lv.tone * finite(mod.tone, 1), t, 0.05);
      const im = intakeMix(cfg, E, rpm, e.fuelCut ? 0 : throttle);
      sound.intake.gain.gain.setTargetAtTime(im.gain * finite(mod.intake, 1), t, 0.06);
      sound.intake.band.frequency.setTargetAtTime(im.hz, t, 0.06);
      // the rev limiter cutting in; a gear going in
      if (e.fuelCut && !wasCut && t - lastCut > cfg.limiter.every) { this.play('limiter'); lastCut = t; }
      if (wasShifting && !e.shifting) this.play('shift');
      wasCut = !!e.fuelCut; wasShifting = !!e.shifting;
      // dropped firings (misfire, valve float): each firing this frame, on the fixed pattern, dips the level
      const share = roughShare(cfg, e.health), perSec = rpm / 60 * cfg.cylinders / 2;
      phase += perSec * dt;
      for (; firing < Math.floor(phase); firing++) {
        if (!dropped(firing, share)) continue;
        const at = t + (firing - (phase - perSec * dt)) / perSec, len = 1 / perSec;
        rough.gain.setValueAtTime(0.25, Math.max(t, at));
        rough.gain.setValueAtTime(1, Math.max(t, at) + len);
      }
    },
  };
}

// The turbo's whistle: a tone at the spool's pitch and a little rushing air round it
function turboWhistle(ctx, out) {
  const spool = new TurboSpool(), level = new GainNode(ctx, { gain: 0 });
  const toneOsc = new OscillatorNode(ctx, { type: 'sine', frequency: 3000 }), overtone = new OscillatorNode(ctx, { type: 'triangle', frequency: 6000 }), overGain = new GainNode(ctx, { gain: 0.15 });
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const air = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true }), band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 3000, Q: 8 }), airGain = new GainNode(ctx, { gain: 0 });
  toneOsc.connect(level); overtone.connect(overGain).connect(level); air.connect(band).connect(airGain).connect(level);
  level.connect(out);
  toneOsc.start(); overtone.start(); air.start();
  return {
    spool,
    // s: the vehicle's snapshot; turbo: the spec's (none: silent)
    update(s, dt, turbo) {
      const e = s.engine, t = ctx.currentTime;
      // (on the rev limiter the driver's still on the throttle: the turbo stays spooled)
      const throttle = finite(e.fuelCut ? s.throttle : e.throttle, 0), w = spool.update(dt, turbo, finite(e.rpm, 0), throttle);
      level.gain.setTargetAtTime(w.gain, t, 0.05);
      if (!w.gain) return;
      toneOsc.frequency.setTargetAtTime(w.hz, t, 0.03);
      overtone.frequency.setTargetAtTime(w.hz * 2, t, 0.03);
      band.frequency.setTargetAtTime(w.hz * 0.9, t, 0.03);
      band.Q.setTargetAtTime(w.q, t, 0.1);
      airGain.gain.setTargetAtTime(w.noise * 3, t, 0.05);
    },
  };
}

// Crash sounds: impact(cls, material, within 0..1: how hard within its class), scrape(snapshot.scrape),
// glass(), light(); a part tearing off (tear()), bouncing (clatter(strength m/s)), rattling (rattle(0..1))
function crashSounds(ctx, out, path = 'data/sounds/crash.json') {
  let cfg = null, buffers = null, rattleLoop = null, lastClatter = 0;
  const loops = {};
  (async () => {
    const c = await (await fetch(path, { cache: 'no-cache' })).json();
    const files = [...new Set([...Object.values(c.impacts).flatMap(x => Object.values(x).flat()), ...Object.values(c.scrape.files), ...c.glass.files, ...c.light.files, ...(c.tear?.files ?? []), ...Object.values(c.clatter?.files ?? {}).flat(), ...(c.rattle ? [c.rattle.file] : [])])];
    buffers = new Map(await Promise.all(files.map(async f => [f, await ctx.decodeAudioData(await (await fetch(f)).arrayBuffer())])));
    for (const [family, f] of Object.entries(c.scrape.files)) {
      const src = new AudioBufferSourceNode(ctx, { buffer: buffers.get(f), loop: true }), gain = new GainNode(ctx, { gain: 0 });
      src.connect(gain).connect(out); src.start(0, Math.random() * buffers.get(f).duration);
      loops[family] = { src, gain };
    }
    if (c.rattle) { const src = new AudioBufferSourceNode(ctx, { buffer: buffers.get(c.rattle.file), loop: true }), gain = new GainNode(ctx, { gain: 0 }); src.connect(gain).connect(out); src.start(); rattleLoop = { src, gain }; }
    cfg = c;
  })().catch(err => console.warn(`The crash sounds didn't load: ${err.message ?? err}`));
  const pick = list => list[Math.floor(Math.random() * list.length)];
  const play = (file, gain, rate = 1) => {
    const src = new AudioBufferSourceNode(ctx, { buffer: buffers.get(file), playbackRate: rate }), g = new GainNode(ctx, { gain });
    src.connect(g).connect(out); src.start();
    return src;
  };
  const vary = () => 1 + (Math.random() * 2 - 1) * cfg.pitch;
  return {
    get config() { return cfg; },
    impact(cls, material, within = 0.5) {
      if (!cfg) return null;
      const family = cfg.impacts[cfg.materials[material]] ? cfg.materials[material] : Object.keys(cfg.impacts)[0], [lo, hi] = cfg.gain[cls];
      return play(pick(cfg.impacts[family][cls]), (lo + (hi - lo) * Math.min(1, Math.max(0, within))) * (0.9 + Math.random() * 0.2), vary());
    },
    glass() { return cfg ? play(pick(cfg.glass.files), cfg.glass.gain, vary()) : null; },
    tear() { return cfg?.tear ? play(pick(cfg.tear.files), cfg.tear.gain, vary()) : null; },
    // a torn-off part hitting the road (strength: its change of speed, m/s), not too many at once
    clatter(strength) {
      if (!cfg?.clatter || ctx.currentTime - lastClatter < 0.03) return null;
      lastClatter = ctx.currentTime;
      const C = cfg.clatter, heavy = strength >= C.heavyFrom, k = Math.min(1, strength / (C.heavyFrom * 2));
      return play(pick(C.files[heavy ? 'heavy' : 'light']), C.gain[0] + (C.gain[1] - C.gain[0]) * k, vary());
    },
    rattle(amount) { if (rattleLoop) rattleLoop.gain.gain.setTargetAtTime(Math.min(1, Math.max(0, finite(amount, 0))) * cfg.rattle.gain, ctx.currentTime, 0.05); },
    light() { return cfg ? play(pick(cfg.light.files), cfg.light.gain, vary()) : null; },
    // sc: { amount, speed, material } or null (not sliding along anything)
    scrape(sc) {
      if (!cfg) return;
      const t = ctx.currentTime, family = sc && (cfg.materials[sc.material] === 'concrete' ? 'concrete' : 'metal');
      for (const [f, L] of Object.entries(loops)) {
        const on = f === family ? Math.min(1, Math.max(0, finite(sc.amount, 0))) : 0;
        L.gain.gain.setTargetAtTime(on * cfg.scrape.gain, t, on ? 0.03 : 0.08);
        if (on) L.src.playbackRate.setTargetAtTime(0.8 + 0.4 * Math.min(1, finite(sc.speed, 0) / 25), t, 0.05);
      }
    },
  };
}

function tyreSqueal(ctx, out) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const noise = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true });
  const band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1100, Q: 9 });
  const tone = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 700 });
  const toneBand = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1500, Q: 4 });
  const toneGain = new GainNode(ctx, { gain: 0.1 });
  const wobble = new OscillatorNode(ctx, { frequency: 9 }), wobbleDepth = new GainNode(ctx, { gain: 30 });
  const level = new GainNode(ctx, { gain: 0 });
  wobble.connect(wobbleDepth).connect(tone.frequency);
  noise.connect(band).connect(level);
  tone.connect(toneBand).connect(toneGain).connect(level);
  level.connect(out);
  noise.start(); tone.start(); wobble.start();
  return {
    // level 0..1, pitch 0..1
    set(amount, pitch) {
      const t = ctx.currentTime;
      amount = Number.isFinite(amount) ? amount : 0; pitch = Number.isFinite(pitch) ? pitch : 0;
      level.gain.setTargetAtTime(amount * 0.3, t, 0.04);
      band.frequency.setTargetAtTime(900 + pitch * 700, t, 0.1);
      tone.frequency.setTargetAtTime(620 + pitch * 380, t, 0.1);
    },
  };
}

function gravelCrunch(ctx, out) {
  const sr = ctx.sampleRate, buf = ctx.createBuffer(1, sr * 2, sr), d = buf.getChannelData(0);
  let brown = 0;
  for (let i = 0; i < d.length; i++) { brown = brown * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = brown * 3; }
  for (let n = 0; n < 1400; n++) {                     // stones: short random clicks
    const at = Math.floor(Math.random() * d.length), amp = (Math.random() * 2 - 1) * (0.2 + Math.random() * 0.8), len = 40 + Math.random() * 160;
    for (let i = 0; i < len; i++) d[(at + i) % d.length] += amp * Math.exp(-i / (len * 0.25)) * (Math.random() * 2 - 1);
  }
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < d.length; i++) d[i] /= peak;
  const src = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true });
  const band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 900, Q: 0.6 });
  const level = new GainNode(ctx, { gain: 0 });
  src.connect(band).connect(level).connect(out);
  src.start();
  return {
    // amount 0..1, speed m/s
    set(amount, speed) {
      const t = ctx.currentTime;
      amount = Number.isFinite(amount) ? amount : 0; speed = Number.isFinite(speed) ? speed : 0;
      level.gain.setTargetAtTime(amount * 0.35, t, 0.05);
      src.playbackRate.setTargetAtTime(0.7 + Math.min(1.2, speed / 25), t, 0.1);
      band.frequency.setTargetAtTime(600 + Math.min(900, speed * 25), t, 0.1);
    },
  };
}

// Grass and kerbs (Phase 5 Step 4): a soft swish of low noise on grass; a kerb's rumble, a square wave at
// the rate its stripes pass, low-passed to a buzz you feel more than hear
function tyreSurfaces(ctx, out) {
  const sr = ctx.sampleRate, buf = ctx.createBuffer(1, sr * 2, sr), d = buf.getChannelData(0);
  let pink = 0;
  for (let i = 0; i < d.length; i++) { pink = pink * 0.9 + (Math.random() * 2 - 1) * 0.1; d[i] = pink * 4; }
  const swish = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true }), swishBand = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 700, Q: 0.5 }), swishLevel = new GainNode(ctx, { gain: 0 });
  swish.connect(swishBand).connect(swishLevel).connect(out);
  const buzz = new OscillatorNode(ctx, { type: 'square', frequency: 20 }), buzzLow = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 240, Q: 1.2 }), buzzLevel = new GainNode(ctx, { gain: 0 });
  buzz.connect(buzzLow).connect(buzzLevel).connect(out);
  swish.start(); buzz.start();
  return {
    set(m) {
      const t = ctx.currentTime;
      swishLevel.gain.setTargetAtTime(finite(m.grass, 0) * 0.28, t, 0.06);
      buzzLevel.gain.setTargetAtTime(finite(m.rumble, 0) * 0.22, t, 0.03);
      buzz.frequency.setTargetAtTime(Math.max(6, finite(m.rumbleRate, 20)), t, 0.05);
    },
  };
}

// Mechanical damage sounds (data/sounds/mechanical.json): hiss, steam, flap, grind, whine, and the holed
// exhaust (engineTap: the engine's sound, clipped, band-passed and rattled, mixed back in)
function mechanicalSounds(ctx, out, engineTap, path = 'data/sounds/mechanical.json') {
  let cfg = null, grindBuf = null, flapBuf = null;
  const sr = ctx.sampleRate, noiseBuf = ctx.createBuffer(1, sr * 2, sr), nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const noise = () => { const src = new AudioBufferSourceNode(ctx, { buffer: noiseBuf, loop: true }); src.start(0, Math.random() * 2); return src; };
  // hiss: noise → band-pass → level
  const hissBand = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 3000, Q: 1.4 }), hiss = new GainNode(ctx, { gain: 0 });
  noise().connect(hissBand).connect(hiss).connect(out);
  // steam: a softer, lower hiss from the engine bay (the effects' steam: a leaking radiator, a hot engine)
  const steamBand = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1800, Q: 0.8 }), steam = new GainNode(ctx, { gain: 0 });
  noise().connect(steamBand).connect(steam).connect(out);
  // whine: a tone and its octave
  const whineOsc = new OscillatorNode(ctx, { type: 'triangle', frequency: 400 }), whineOct = new OscillatorNode(ctx, { type: 'sine', frequency: 800 }), octGain = new GainNode(ctx, { gain: 0.3 }), whine = new GainNode(ctx, { gain: 0 });
  whineOsc.connect(whine); whineOct.connect(octGain).connect(whine); whine.connect(out);
  whineOsc.start(); whineOct.start();
  // flap: one thump a second, looped at the tyre's turns a second
  let flapSrc = null;
  const flap = new GainNode(ctx, { gain: 0 });
  flap.connect(out);
  // exhaust: the engine clipped, band-passed and rattled (its level jumping about at rattleHz)
  const shaper = new WaveShaperNode(ctx, { oversample: '2x' }), exBand = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 380, Q: 0.8 }), rattle = new GainNode(ctx, { gain: 1 }), exhaust = new GainNode(ctx, { gain: 0 });
  engineTap.connect(shaper).connect(exBand).connect(rattle).connect(exhaust).connect(out);
  (async () => {
    const c = await (await fetch(path, { cache: 'no-cache' })).json();
    // (the clipping curve; the rattle: random steps, rattleHz of them a second)
    const k = c.exhaust.drive, curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) { const x = i / (curve.length - 1) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
    shaper.curve = curve;
    exBand.frequency.value = c.exhaust.hz; exBand.Q.value = c.exhaust.q;
    const steps = ctx.createBuffer(1, sr, sr), sd = steps.getChannelData(0), per = Math.max(1, Math.round(sr / c.exhaust.rattleHz));
    for (let i = 0; i < sd.length; i += per) { const v = (Math.random() * 2 - 1) * 0.7; for (let j = i; j < Math.min(sd.length, i + per); j++) sd[j] = v; }
    const mod = new AudioBufferSourceNode(ctx, { buffer: steps, loop: true });
    mod.connect(rattle.gain); mod.start();
    hissBand.Q.value = c.hiss.q;
    steamBand.frequency.value = c.steam.hz; steamBand.Q.value = c.steam.q;
    // grind: noise buzzed by gear teeth, dying away; flap: a low thump at the start of a second
    grindBuf = ctx.createBuffer(1, Math.round(sr * c.grind.seconds), sr);
    const g = grindBuf.getChannelData(0);
    for (let i = 0; i < g.length; i++) { const t = i / sr, teeth = 0.5 + 0.5 * Math.sign(Math.sin(2 * Math.PI * c.grind.hz * t * (1 + 0.15 * Math.sin(2 * Math.PI * 7 * t)))); g[i] = (Math.random() * 2 - 1) * teeth * Math.exp(-3.5 * t / c.grind.seconds) * Math.min(1, t * 200); }
    flapBuf = ctx.createBuffer(1, sr, sr);
    const f = flapBuf.getChannelData(0);
    for (let i = 0, n = Math.round(sr * c.flap.seconds); i < n; i++) { const t = i / sr; f[i] = (Math.sin(2 * Math.PI * c.flap.hz * t) * 0.7 + (Math.random() * 2 - 1) * 0.3) * Math.exp(-5 * t / c.flap.seconds); }
    flapSrc = new AudioBufferSourceNode(ctx, { buffer: flapBuf, loop: true });
    flapSrc.connect(flap); flapSrc.start();
    cfg = c;
  })().catch(err => console.warn(`The mechanical damage sounds didn't load: ${err.message ?? err}`));
  return {
    get config() { return cfg; },
    // a gear grinding in (strength 0..1: the gearbox's damage; a missed gear, 1)
    grind(strength = 1) {
      if (!cfg || !grindBuf) return null;
      const src = new AudioBufferSourceNode(ctx, { buffer: grindBuf, playbackRate: 0.9 + Math.random() * 0.2 }), band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: cfg.grind.hz * 2.2, Q: 1.2 }), g = new GainNode(ctx, { gain: cfg.grind.gain * (0.4 + 0.6 * Math.min(1, finite(strength, 1))) });
      src.connect(band).connect(g).connect(out); src.start();
      return src;
    },
    // s: the vehicle's snapshot (its mechanical block); spec: the live spec (the turbo's boost)
    update(s, dt, spec, extra = {}) {
      if (!cfg) return;
      const t = ctx.currentTime, m = s.mechanical ?? {}, e = s.engine;
      // hiss: the share leaking × how much boost there is now
      const turbo = spec.turbo, peak = turbo?.boost ? Math.max(...turbo.boost.map(p => p[1])) : 0;
      const boostNow = peak > 0 ? curveAt(turbo.boost, finite(e.rpm, 0)) / peak * finite(e.throttle, 0) : 0, h = finite(m.boost, 0) * boostNow;
      hiss.gain.setTargetAtTime(Math.min(1, h * 2) * cfg.hiss.gain, t, 0.06);
      hissBand.frequency.setTargetAtTime(cfg.hiss.hz[0] + (cfg.hiss.hz[1] - cfg.hiss.hz[0]) * boostNow, t, 0.08);
      // whine: the drive shaft's turns a second (the driven wheels × the final drive)
      const driven = (s.wheels ?? []).filter(w => w.driven), axle = Math.abs(driven.reduce((a, w) => a + finite(w.omega, 0), 0) / (driven.length || 1)) / (2 * Math.PI);
      const shaft = axle * (spec.gearbox?.finalDrive ?? 4), hz = Math.max(40, shaft * cfg.whine.hzPerRev), d = finite(m.differential, 0);
      whine.gain.setTargetAtTime(d * cfg.whine.gain * Math.min(1, Math.max(0, (Math.abs(finite(s.speed, 0)) - cfg.whine.fromSpeed) / 10)) * (0.6 + 0.4 * finite(e.throttle, 0)), t, 0.08);
      whineOsc.frequency.setTargetAtTime(hz, t, 0.03); whineOct.frequency.setTargetAtTime(hz * 2, t, 0.03);
      // flap: a soft tyre, once a turn
      if (flapSrc) {
        const fl = m.flap;
        flap.gain.setTargetAtTime(fl ? Math.min(1, fl.amount * 1.3) * cfg.flap.gain : 0, t, 0.05);
        if (fl) flapSrc.playbackRate.setTargetAtTime(Math.min(40, Math.max(0.3, fl.rate)), t, 0.03);
      }
      // steam: as much as the effects make (extra.steam 0..1), wavering a little
      steam.gain.setTargetAtTime(Math.min(1, finite(extra.steam, 0)) * cfg.steam.gain * (0.85 + 0.15 * Math.random()), t, 0.12);
      // exhaust: holed, or loose / torn off (extra.exhaust)
      exhaust.gain.setTargetAtTime(Math.min(1, Math.max(finite(m.exhaust, 0), finite(extra.exhaust, 0))) * cfg.exhaust.gain, t, 0.08);
    },
  };
}

// Wind: noise through a band-pass that rises with the speed; set(amount 0..1, speed m/s)
function windNoise(ctx, out) {
  const sr = ctx.sampleRate, buf = ctx.createBuffer(1, sr * 2, sr), d = buf.getChannelData(0);
  let brown = 0;
  for (let i = 0; i < d.length; i++) { brown = brown * 0.985 + (Math.random() * 2 - 1) * 0.06; d[i] = brown * 2 + (Math.random() * 2 - 1) * 0.15; }
  const src = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true }), band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 500, Q: 0.5 }), level = new GainNode(ctx, { gain: 0 });
  src.connect(band).connect(level).connect(out);
  src.start();
  return {
    set(amount, speed) {
      const t = ctx.currentTime;
      level.gain.setTargetAtTime(Math.min(1, Math.max(0, finite(amount, 0))) * 0.28, t, 0.2);
      band.frequency.setTargetAtTime(350 + Math.min(1400, Math.abs(finite(speed, 0)) * 22), t, 0.2);
    },
  };
}
