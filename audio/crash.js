// Crashes and damage while driving (Phase 8 Step 1; docs/AUDIO.md; data/sounds/crash.json, data/sounds/mechanical.json):
//
//   impacts — a hit plays a tap, crunch or crash (garage/damage.js's class, by how hard) for what was hit: a car, a rail
//     (metal), concrete, a building, a tree, a tyre wall (physics/impacts.js material, or the collider's own sound), one
//     of its takes at random, a little higher or lower each time, louder the harder within its class; under a big one
//     a low body thump, the heavier the harder. Glass breaking, a light, a part tearing off and clattering down the road.
//   sliding along something: a scrape loop for metal or anything else, following the scrape; loose parts rattling; a
//     hanging panel (a bumper) flapping in the wind, faster the faster the car goes.
//   mechanical damage (made as it plays): a boost leak's hiss, steam from the engine bay, a soft or flat tyre flapping
//     once a turn, a damaged gearbox grinding a gear in, a damaged diff's whine, a holed exhaust's rattly blat (the
//     engine's own sound, clipped and rattled). Misfires are the engine's own (audio/dsp.js).
//
//   const C = createCrashSounds(A, { engineTap })   A: audio/system.js; engineTap: the player's exhaust (audio/car.js tap)
//   C.impact(cls, material, within, { gain, at }) · C.glass() · C.light() · C.tear() · C.clatter(strength) · C.grind(strength)
//   C.update(snapshot, dt, spec, { exhaust, steam, flap, speed })   the loops: scrape, rattle, flap and the mechanical ones
//   C.dispose()

import { curveAt } from '../testtrack/soundMix.js';

const finite = (x, or) => Number.isFinite(x) ? x : or;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
// A level that's only connected while it's heard: a loop or a tone gliding to nothing is let go of once it's there,
// so the chain behind it isn't worked out at all (a scrape, a hiss and a whine nobody hears cost nothing); connected
// again when it's wanted. to(v, tau) → whether it's heard
function gated(ctx, gain, dest) {
  let on = false, timer = null;
  return {
    to(v, tau) {
      gain.gain.setTargetAtTime(v, ctx.currentTime, tau);
      if (v > 1e-4) { if (timer) { clearTimeout(timer); timer = null; } if (!on) { gain.connect(dest); on = true; } }
      else if (on && !timer) { timer = setTimeout(() => { timer = null; gain.disconnect(); on = false; }, tau * 10 * 1000 + 50); timer.unref?.(); }
      return v > 1e-4;
    },
    stop() { if (timer) clearTimeout(timer); timer = null; },
  };
}

export function createCrashSounds(A, { engineTap = null, crashPath = 'data/sounds/crash.json', mechPath = 'data/sounds/mechanical.json' } = {}) {
  const { ctx } = A, out = A.bus.impacts, t = () => ctx.currentTime;
  let cfg = null, mech = null, alive = true, lastClatter = 0;
  const buffers = new Map(), loops = {}, held = [];
  // (the files, decoded once and kept while these sounds are)
  const ready = (async () => {
    const c = await (await fetch(crashPath, { cache: 'no-cache' })).json();
    const files = [...new Set([...Object.values(c.impacts).flatMap(x => Object.values(x).flat()), ...Object.values(c.scrape.files), ...c.glass.files, ...c.light.files, ...(c.tear?.files ?? []), ...Object.values(c.clatter?.files ?? {}).flat(), ...(c.rattle ? [c.rattle.file] : []), ...(c.flap ? [c.flap.file] : [])])];
    await Promise.all(files.map(async f => { held.push(f); buffers.set(f, await A.buffer(f)); }));
    if (!alive) return;
    const loop = (f, to = out) => { const src = new AudioBufferSourceNode(ctx, { buffer: buffers.get(f), loop: true }), gain = new GainNode(ctx, { gain: 0 }); src.connect(gain); src.start(0, Math.random() * buffers.get(f).duration); return { src, gain, level: gated(ctx, gain, to) }; };
    for (const [family, f] of Object.entries(c.scrape.files)) loops[family] = loop(f);
    if (c.rattle) loops.rattle = loop(c.rattle.file);
    if (c.flap) loops.flap = loop(c.flap.file);
    cfg = c;
  })().catch(err => console.warn(`The crash sounds didn't load: ${err.message ?? err}`));
  const mechReady = fetch(mechPath, { cache: 'no-cache' }).then(r => r.json()).then(c => { if (alive) { mech = mechanical(A, c, engineTap); } }).catch(err => console.warn(`The mechanical damage sounds didn't load: ${err.message ?? err}`));
  const pick = list => list[Math.floor(Math.random() * list.length)];
  const play = (file, gain, rate = 1, to = out) => {
    const src = new AudioBufferSourceNode(ctx, { buffer: buffers.get(file), playbackRate: rate }), g = new GainNode(ctx, { gain });
    src.connect(g).connect(to); src.start();
    src.onended = () => { src.disconnect(); g.disconnect(); };
    return src;
  };
  const vary = () => 1 + (Math.random() * 2 - 1) * cfg.pitch;
  // a big crash's body: a low thump, the harder the heavier (made as it plays)
  function heavy(k, to) {
    const H = cfg.heavy; if (!H || k <= 0) return;
    const o = new OscillatorNode(ctx, { type: 'sine', frequency: H.hz * 1.6 }), g = new GainNode(ctx, { gain: 0 }), at = t();
    o.frequency.setValueAtTime(H.hz * 1.6, at); o.frequency.exponentialRampToValueAtTime(H.hz * 0.7, at + 0.35);
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(H.gain * k, at + 0.008); g.gain.setTargetAtTime(0, at + 0.03, 0.12);
    o.connect(g).connect(to); o.start(at); o.stop(at + 0.9);
    o.onended = () => { o.disconnect(); g.disconnect(); };
  }

  return {
    ready, get config() { return cfg; },
    // a hit: cls 'tap' | 'crunch' | 'crash'; material: what was hit (crash.json materials); within 0..1 (how hard within
    // its class); o.gain (×: another car's hit far off), o.to (a node: positioned)
    impact(cls, material, within = 0.5, o = {}) {
      if (!cfg) return null;
      const family = cfg.impacts[cfg.materials[material]] ? cfg.materials[material] : cfg.impacts[material] ? material : Object.keys(cfg.impacts)[0], [lo, hi] = cfg.gain[cls] ?? cfg.gain.tap;
      const k = clamp(finite(within, 0.5), 0, 1), g = (o.gain ?? 1), to = o.to ?? out;
      if (cls === 'crash') heavy((0.4 + 0.6 * k) * g, to);
      const src = play(pick(cfg.impacts[family][cls]), (lo + (hi - lo) * k) * (0.9 + Math.random() * 0.2) * g, vary(), to);
      src.family = family;
      return src;
    },
    glass() { return cfg ? play(pick(cfg.glass.files), cfg.glass.gain, vary()) : null; },
    light() { return cfg ? play(pick(cfg.light.files), cfg.light.gain, vary()) : null; },
    tear() { return cfg?.tear ? play(pick(cfg.tear.files), cfg.tear.gain, vary()) : null; },
    // a torn-off part hitting the road (strength: its change of speed, m/s), not too many at once
    clatter(strength) {
      if (!cfg?.clatter || t() - lastClatter < 0.03) return null;
      lastClatter = t();
      const C = cfg.clatter, isHeavy = strength >= C.heavyFrom, k = Math.min(1, strength / (C.heavyFrom * 2));
      return play(pick(C.files[isHeavy ? 'heavy' : 'light']), C.gain[0] + (C.gain[1] - C.gain[0]) * k, vary());
    },
    grind(strength = 1) { return mech?.grind(strength) ?? null; },
    // each frame: s the snapshot; extra { exhaust (0..1 loose / off), steam (0..1), flap (loose hanging parts), speed }
    update(s, dt, spec, extra = {}) {
      if (cfg) {
        // sliding along something: the strongest of the body along a wall, a part dragging, a flat tyre's rim
        const scrapes = [s.scrape, s.partScrape, s.mechanical?.rimScrape].filter(Boolean), sc = scrapes.length ? scrapes.reduce((a, b) => b.amount > a.amount ? b : a) : null;
        const family = sc && (cfg.materials[sc.material] === 'concrete' || cfg.materials[sc.material] === 'building' ? 'concrete' : 'metal');
        for (const f of Object.keys(cfg.scrape.files)) {
          const L = loops[f], on = f === family ? clamp(finite(sc.amount, 0), 0, 1) : 0;
          if (L.level.to(on * cfg.scrape.gain, on ? 0.03 : 0.08)) L.src.playbackRate.setTargetAtTime(0.8 + 0.4 * Math.min(1, finite(sc.speed, 0) / 25), t(), 0.05);
        }
        if (loops.rattle) loops.rattle.level.to(clamp(finite(s.rattle, 0), 0, 1) * cfg.rattle.gain, 0.05);
        // a hanging panel in the wind: slaps a metre × the speed (the loop is one slap in 0.25 s)
        if (loops.flap) {
          const v = Math.abs(finite(extra.speed ?? s.speed, 0)), F = cfg.flap, on = (extra.flap ?? 0) > 0 ? clamp((v - (F.fromSpeed ?? 6)) / 18, 0, 1) * Math.min(1, extra.flap) : 0;
          if (loops.flap.level.to(on * F.gain, 0.1)) loops.flap.src.playbackRate.setTargetAtTime(clamp(v * F.perMetre * 0.25, 0.5, 6), t(), 0.1);
        }
      }
      mech?.update(s, dt, spec, extra);
    },
    dispose() {
      alive = false;
      for (const L of Object.values(loops)) { L.level.stop(); try { L.src.stop(); } catch { /* stopped */ } L.src.disconnect(); L.gain.disconnect(); }
      mech?.dispose();
      for (const f of held) A.unbuffer(f);
      buffers.clear();
    },
    get loops() { return loops; },
    get mech() { return mech; },
    mechReady,
  };
}

// The mechanical damage sounds (data/sounds/mechanical.json): hiss, steam, flap, grind, whine, the holed exhaust
function mechanical(A, c, engineTap) {
  const { ctx } = A, out = A.bus.engine, sr = ctx.sampleRate, t = () => ctx.currentTime, all = [];
  const keep = n => { all.push(n); return n; };
  const noiseBuf = ctx.createBuffer(1, sr * 2, sr), nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const srcs = [];
  const noise = () => { const s = keep(new AudioBufferSourceNode(ctx, { buffer: noiseBuf, loop: true })); s.start(0, Math.random() * 2); srcs.push(s); return s; };
  // hiss (a boost leak): noise → band-pass → level
  const hissBand = keep(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: c.hiss.hz[0], Q: c.hiss.q })), hiss = keep(new GainNode(ctx, { gain: 0 }));
  noise().connect(hissBand).connect(hiss);
  // steam (a leaking radiator, a hot engine): a softer, lower hiss from the engine bay
  const steamBand = keep(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: c.steam.hz, Q: c.steam.q })), steam = keep(new GainNode(ctx, { gain: 0 }));
  noise().connect(steamBand).connect(steam);
  // whine (a damaged diff): a tone and its octave
  const whineOsc = keep(new OscillatorNode(ctx, { type: 'triangle', frequency: 400 })), whineOct = keep(new OscillatorNode(ctx, { type: 'sine', frequency: 800 })), octGain = keep(new GainNode(ctx, { gain: 0.3 })), whine = keep(new GainNode(ctx, { gain: 0 }));
  whineOsc.connect(whine); whineOct.connect(octGain).connect(whine);
  whineOsc.start(); whineOct.start(); srcs.push(whineOsc, whineOct);
  // flap (a soft tyre): one thump a turn
  const flapBuf = ctx.createBuffer(1, sr, sr), f = flapBuf.getChannelData(0);
  for (let i = 0, n = Math.round(sr * c.flap.seconds); i < n; i++) { const tt = i / sr; f[i] = (Math.sin(2 * Math.PI * c.flap.hz * tt) * 0.7 + (Math.random() * 2 - 1) * 0.3) * Math.exp(-5 * tt / c.flap.seconds); }
  const flapSrc = keep(new AudioBufferSourceNode(ctx, { buffer: flapBuf, loop: true })), flap = keep(new GainNode(ctx, { gain: 0 }));
  flapSrc.connect(flap); flapSrc.start(); srcs.push(flapSrc);
  // a holed exhaust: the engine clipped, band-passed and rattled
  const shaper = keep(new WaveShaperNode(ctx, { oversample: '2x' })), exBand = keep(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: c.exhaust.hz, Q: c.exhaust.q })), rattle = keep(new GainNode(ctx, { gain: 1 })), exhaust = keep(new GainNode(ctx, { gain: 0 }));
  const k = c.exhaust.drive, curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) { const x = i / (curve.length - 1) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
  shaper.curve = curve;
  if (engineTap) engineTap.connect(shaper);
  shaper.connect(exBand).connect(rattle).connect(exhaust);
  // (each only connected while it's heard: audio/crash.js gated)
  const lv = { hiss: gated(ctx, hiss, out), steam: gated(ctx, steam, out), whine: gated(ctx, whine, out), flap: gated(ctx, flap, A.bus.tyres), exhaust: gated(ctx, exhaust, out) };
  const steps = ctx.createBuffer(1, sr, sr), sd = steps.getChannelData(0), per = Math.max(1, Math.round(sr / c.exhaust.rattleHz));
  for (let i = 0; i < sd.length; i += per) { const v = (Math.random() * 2 - 1) * 0.7; for (let j = i; j < Math.min(sd.length, i + per); j++) sd[j] = v; }
  const mod = keep(new AudioBufferSourceNode(ctx, { buffer: steps, loop: true })); mod.connect(rattle.gain); mod.start(); srcs.push(mod);
  // grind (a damaged gearbox): noise buzzed by gear teeth, dying away
  const grindBuf = ctx.createBuffer(1, Math.round(sr * c.grind.seconds), sr), gd = grindBuf.getChannelData(0);
  for (let i = 0; i < gd.length; i++) { const tt = i / sr, teeth = 0.5 + 0.5 * Math.sign(Math.sin(2 * Math.PI * c.grind.hz * tt * (1 + 0.15 * Math.sin(2 * Math.PI * 7 * tt)))); gd[i] = (Math.random() * 2 - 1) * teeth * Math.exp(-3.5 * tt / c.grind.seconds) * Math.min(1, tt * 200); }
  return {
    config: c,
    grind(strength = 1) {
      const src = new AudioBufferSourceNode(ctx, { buffer: grindBuf, playbackRate: 0.9 + Math.random() * 0.2 }), band = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: c.grind.hz * 2.2, Q: 1.2 }), g = new GainNode(ctx, { gain: c.grind.gain * (0.4 + 0.6 * Math.min(1, finite(strength, 1))) });
      src.connect(band).connect(g).connect(out); src.start();
      src.onended = () => { src.disconnect(); band.disconnect(); g.disconnect(); };
      return src;
    },
    update(s, dt, spec, extra = {}) {
      const m = s.mechanical ?? {}, e = s.engine ?? {}, now = t();
      const turbo = spec.turbo, peak = turbo?.boost ? Math.max(...turbo.boost.map(p => p[1])) : 0;
      const boostNow = peak > 0 ? curveAt(turbo.boost, finite(e.rpm, 0)) / peak * finite(e.throttle, 0) : 0, h = finite(m.boost, 0) * boostNow;
      if (lv.hiss.to(Math.min(1, h * 2) * c.hiss.gain, 0.06)) hissBand.frequency.setTargetAtTime(c.hiss.hz[0] + (c.hiss.hz[1] - c.hiss.hz[0]) * boostNow, now, 0.08);
      const driven = (s.wheels ?? []).filter(w => w.driven), axle = Math.abs(driven.reduce((a, w) => a + finite(w.omega, 0), 0) / (driven.length || 1)) / (2 * Math.PI);
      const shaft = axle * (spec.gearbox?.finalDrive ?? 4), hz = Math.max(40, shaft * c.whine.hzPerRev), d = finite(m.differential, 0);
      if (lv.whine.to(d * c.whine.gain * clamp((Math.abs(finite(s.speed, 0)) - c.whine.fromSpeed) / 10, 0, 1) * (0.6 + 0.4 * finite(e.throttle, 0)), 0.08)) { whineOsc.frequency.setTargetAtTime(hz, now, 0.03); whineOct.frequency.setTargetAtTime(hz * 2, now, 0.03); }
      const fl = m.flap;
      if (lv.flap.to(fl ? Math.min(1, fl.amount * 1.3) * c.flap.gain : 0, 0.05) && fl) flapSrc.playbackRate.setTargetAtTime(clamp(fl.rate, 0.3, 40), now, 0.03);
      lv.steam.to(Math.min(1, finite(extra.steam, 0)) * c.steam.gain * (0.85 + 0.15 * Math.random()), 0.12);
      lv.exhaust.to(Math.min(1, Math.max(finite(m.exhaust, 0), finite(extra.exhaust, 0))) * c.exhaust.gain, 0.08);
    },
    levels: { hiss, steam, whine, flap, exhaust },
    dispose() {
      for (const g of Object.values(lv)) g.stop();
      for (const s of srcs) { try { s.stop(); } catch { /* stopped */ } }
      if (engineTap) { try { engineTap.disconnect(shaper); } catch { /* gone */ } }
      for (const n of all) { try { n.disconnect(); } catch { /* gone */ } }
    },
  };
}
