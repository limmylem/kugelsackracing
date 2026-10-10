// A car's sound (Phase 8 Step 1; docs/AUDIO.md): your car's, an NPC racer's or another player's — the same voices
// (audio/dsp.js EngineVoice and ChassisVoice, on the audio thread), fed each frame from the physics' snapshot (yours,
// an NPC's) or the network's state (another player's: its revs, throttle, gear and its wheels' slip).
//
//   yours (role 'player'): heard from the camera — outside mostly the exhaust and the engine, in the cockpit the
//     exhaust muffled, more intake, gearbox and the cabin's boom (audio/mix.js viewMix; the change glides) — into the
//     engine, tyres and environment groups
//   another car (role 'other'): heard from outside (its engine and tyres in one worklet node, 'kr-car', mixed down),
//     positioned (panned, quieter with distance, the air muffling it far off), its pitch moved by its speed and yours
//     (Doppler), muffled behind buildings (occluded), into the others group; heard as 'full' (everything), 'simple'
//     (one engine loop, pitched by its revs: cheap, for the far ones) or 'off' — which one, audio/voices.js decides
//     (the nearest few full)
//
//   const v = createCarVoice(A, { spec, role, seed, startOff })   spec: the car's (its engine's sound config, spec.audio)
//   v.update(input, dt, place)   input: { engine (EngineVoice state), chassis (ChassisVoice state) }; place (others):
//                                { at: [x, y, z] in the camera's frame, rel, vel, listenerVel (m, m/s), occluded }
//   v.setView(view) (yours) · v.setLod('full' | 'simple' | 'off') · v.event('start' | 'stop' | 'thump' | 'handbrake', x)
//   v.setSpec(spec) (another engine or parts: the sound follows) · v.setMode('layers' | 'granular') · v.mute(map)
//   v.meter() → Promise<{ engine, chassis }> · v.dispose()

import { engineVoiceConfig, doppler as dopplerOf, airHz, distanceGain, panOf } from './mix.js';

let seeds = 1;

// (o.out: where your car's sound goes instead of the engine, tyres and environment groups — the garage's dyno, into its own)
export function createCarVoice(A, { spec, role = 'player', seed = seeds++, startOff = false, mode = null, out = null } = {}) {
  const { ctx, cfg } = A, player = role === 'player', t = () => ctx.currentTime;
  // ---- the graph: yours — the voices' outputs, each with its level, into the groups; another car's — one chain ----
  const fade = new GainNode(ctx, { gain: 0 });             // (full ↔ simple ↔ off, crossfaded)
  const hz = {};
  let lv = null, muffle = null, boom = null, tap = null, pan = null, dist = null, air = null, simpleOut = null;
  if (player) {
    const g = name => new GainNode(ctx, { gain: name === 'tyres' || name === 'road' || name === 'wind' ? 1 : 0 });
    lv = { exhaust: g('exhaust'), intake: g('intake'), gearbox: g('gearbox'), tyres: g('tyres'), road: g('road'), wind: g('wind') };
    muffle = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000, Q: 0.5 });          // (the exhaust heard in the cabin)
    boom = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 110, Q: 0.9, gain: 0 });      // (the cabin's boom)
    tap = new GainNode(ctx, { gain: 1 });              // (the engine's exhaust as it comes out: a holed exhaust's rattle, audio/crash.js)
    lv.exhaust.connect(muffle).connect(boom); lv.intake.connect(boom); lv.gearbox.connect(boom);
    boom.connect(fade).connect(out ?? A.bus.engine);
    const ty = new GainNode(ctx, { gain: 1 }); lv.tyres.connect(ty); lv.road.connect(ty); ty.connect(out ?? A.bus.tyres);
    lv.wind.connect(out ?? A.bus.environment);
    lv.ty = ty;
  } else {
    // (another car: its engine and tyres in one worklet node, mixed as you'd hear your own car from behind it (no wind:
    // that's yours) — muffled by the air and by buildings (one low-pass: the lower of the two), quieter with distance
    // (and behind buildings) and panned, into the others group. Positioned by hand — a gain and a stereo pan, gliding —
    // not by a PannerNode: one moving every frame costs as much as the car's whole engine)
    air = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 18000, Q: 0.5 });
    dist = new GainNode(ctx, { gain: 0 });
    pan = new StereoPannerNode(ctx, { pan: 0 });
    fade.connect(air).connect(dist).connect(pan).connect(A.bus.others);
    simpleOut = new GainNode(ctx, { gain: 0 }); simpleOut.connect(air);
  }
  // ---- the voices ----
  let engine = null, chassis = null, one = null, sound = null, path = null, loading = null, lod = 'off', simple = null, alive = true;
  let viewNow = null, muteMap = null, modeNow = mode, specNow = spec, doppler = 1, tidyAt = Infinity;
  const toEngine = m => (one ?? engine)?.port.postMessage(m);
  const toChassis = m => one ? one.port.postMessage({ ...m, to: 'c' }) : chassis?.port.postMessage(m);
  const ensureNodes = () => {
    if (!A.worklet || engine || one) return;
    if (player) {
      engine = A.node('kr-engine', { numberOfInputs: 0, numberOfOutputs: 3, outputChannelCount: [1, 1, 1], processorOptions: { seed } });
      chassis = A.node('kr-chassis', { numberOfInputs: 0, numberOfOutputs: 3, outputChannelCount: [1, 1, 1], processorOptions: { seed: seed + 7919 } });
      engine.connect(lv.exhaust, 0); engine.connect(lv.intake, 1); engine.connect(lv.gearbox, 2); engine.connect(tap, 0);
      chassis.connect(lv.tyres, 0); chassis.connect(lv.road, 1); chassis.connect(lv.wind, 2);
    } else {
      const V = cfg.views.chase;
      one = A.node('kr-car', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { seed, mix: ['exhaust', 'intake', 'gearbox', 'tyres', 'road'].map(k => 0.8 * (V[k] ?? 1)) } });
      one.connect(fade);
    }
    configure();
  };
  const dropNodes = () => { A.drop(engine); A.drop(chassis); A.drop(one); engine = chassis = one = null; };
  // (once a change of voice has faded — to e⁻⁹ — what isn't heard any more goes: no work for a car that isn't heard.
  // Timed by the sound's own clock, checked as the voice is updated each frame)
  const tidy = () => { if (t() < tidyAt) return; tidyAt = Infinity; if (lod !== 'full') dropNodes(); if (lod !== 'simple') stopSimple(); };
  function configure() {
    if (!(engine || one) || !sound?.cfg) return;
    const m = modeNow ?? (sound.modes.has('granular') ? 'granular' : 'layers');
    toEngine({ t: 'cfg', cfg: engineVoiceConfig(sound.id, sound.cfg, specNow, { mode: sound.modes.has(m) ? m : 'layers', startOff, mute: muteMap, lite: !player }) });
    toChassis({ t: 'cfg', cfg: { mute: muteMap, lite: !player } });
  }
  // the engine's sound: its config's (another engine: the new one's, then the old let go)
  function follow() {
    const want = specNow.engine?.sound ?? null;
    if (want === path || loading) return;
    path = want;
    if (!want) return;
    loading = A.engine(want, { mode: modeNow }).then(s => {
      loading = null;
      if (!alive || path !== want) { A.release(s); return; }
      const old = sound; sound = s;
      if (old) A.release(old);
      configure();
      if (simple) startSimple();
    });
  }
  // a far car's cheap voice: one loop, pitched by the revs
  function startSimple() {
    stopSimple();
    if (!sound?.simple || player) return;
    const src = new AudioBufferSourceNode(ctx, { buffer: sound.simple.buffer, loop: true }), lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 2500, Q: 0.5 });
    src.connect(lp).connect(simpleOut); src.start(0, Math.random() * sound.simple.buffer.duration);
    simple = { src, lp }; delete hz.simple;
  }
  function stopSimple() { if (!simple) return; try { simple.src.stop(); } catch { /* stopped */ } simple.src.disconnect(); simple.lp.disconnect(); simple = null; }

  const api = {
    tap,
    get lod() { return lod; },
    get sound() { return sound; },
    get nodes() { return { engine: engine ?? one, chassis: chassis ?? one }; },
    setLod(x) {
      if (!alive) return;
      if (x === lod) { tidy(); return; }
      lod = x;
      const T = cfg.voices.fade / 3;
      if (x === 'full') { ensureNodes(); fade.gain.setTargetAtTime(1, t(), T); simpleOut?.gain.setTargetAtTime(0, t(), T); }
      else { fade.gain.setTargetAtTime(0, t(), T); }
      if (x === 'simple') { if (!simple) startSimple(); simpleOut?.gain.setTargetAtTime(0.35, t(), T); }
      else simpleOut?.gain.setTargetAtTime(0, t(), T);
      tidyAt = t() + T * 9;
    },
    setView(view) {
      if (!player) return;
      viewNow = view;
      const T = 0.25;
      for (const k of ['exhaust', 'intake', 'gearbox']) lv[k].gain.setTargetAtTime(view[k] ?? 1, t(), T);
      lv.tyres.gain.setTargetAtTime(view.tyres ?? 1, t(), T); lv.road.gain.setTargetAtTime(view.road ?? 1, t(), T); lv.wind.gain.setTargetAtTime(view.wind ?? 1, t(), T);
      muffle.frequency.setTargetAtTime(Math.min(20000, view.muffle ?? 20000), t(), T);
      boom.gain.setTargetAtTime(view.boom ?? 0, t(), T);
    },
    setSpec(s) { specNow = s; follow(); configure(); },
    setMode(m) { modeNow = m; if (sound && !sound.modes.has(m)) { const s = sound; A.engine(s.id, { mode: m }).then(x => { A.release(x); configure(); }); } else configure(); },
    mute(map) { muteMap = map; configure(); },
    event(e, x) {
      if (e === 'thump' || e === 'handbrake') toChassis({ t: 'ev', e, x });
      else toEngine({ t: 'ev', e, x });
    },
    update(input, dt, place = null) {
      if (!alive) return;
      tidy();
      follow();
      if (!player && place) {
        const at = place.at, ok = at && at.every(Number.isFinite), d = ok ? Math.hypot(at[0], at[1], at[2]) : 1e4;
        if (ok) pan.pan.setTargetAtTime(panOf(at), t(), 0.03);
        dist.gain.setTargetAtTime(distanceGain(d, cfg.distance) * (place.occluded ? cfg.occlusion.gain : 1), t(), 0.05);
        moveHz(air.frequency, Math.min(airHz(d, cfg.distance), place.occluded ? cfg.occlusion.hz : 20000), t(), hz, 'air');
        doppler = place.rel ? dopplerOf(place.rel, place.vel, place.listenerVel, cfg.doppler) : 1;
      }
      if (lod === 'simple' && simple && sound?.simple) {
        const e = input.engine ?? {}, rate = Math.max(0.25, Math.min(3, (e.rpm ?? 900) / sound.simple.rpm)) * doppler;
        simple.src.playbackRate.setTargetAtTime(rate, t(), 0.05);
        moveHz(simple.lp.frequency, 1200 + 2500 * Math.min(1, e.throttle ?? 0), t(), hz, 'simple');
      }
      if (lod !== 'full' || !(engine || one)) return;
      if (input.engine) toEngine({ t: 's', s: doppler === 1 ? input.engine : { ...input.engine, doppler } });
      if (input.chassis) toChassis({ t: 's', s: doppler === 1 ? input.chassis : { ...input.chassis, doppler } });
    },
    meter() {
      if (one) return new Promise(res => {
        one.port.onmessage = ({ data }) => { if (data.t === 'meter') res({ engine: data, chassis: { t: 'meter', meter: data.chassis } }); };
        one.port.postMessage({ t: 'meter' });
        setTimeout(() => res(null), 500);
      });
      if (!engine) return Promise.resolve(null);
      return new Promise(res => {
        let e = null, c = null;
        const done = () => { if (e && c) res({ engine: e, chassis: c }); };
        engine.port.onmessage = ({ data }) => { if (data.t === 'meter') { e = data; done(); } };
        chassis.port.onmessage = ({ data }) => { if (data.t === 'meter') { c = data; done(); } };
        engine.port.postMessage({ t: 'meter' }); chassis.port.postMessage({ t: 'meter' });
        setTimeout(() => res(null), 500);
      });
    },
    dispose() {
      if (!alive) return;
      alive = false;
      dropNodes(); stopSimple();
      for (const n of [...Object.values(lv ?? {}), muffle, boom, fade, tap, air, dist, pan, simpleOut].filter(Boolean)) { try { n.disconnect(); } catch { /* gone */ } }
      if (sound) A.release(sound);
      sound = null;
    },
  };
  if (player) { api.setLod('full'); fade.gain.cancelScheduledValues(0); fade.gain.value = 1; }
  follow();
  if (viewNow === null && player) api.setView(cfg.views.chase);
  return api;
}

// A filter's frequency moved only when it's changed by more than 3%, in a short ramp that ends: a filter whose
// frequency is always gliding works out its coefficients every sample, one that's still once a block.
function moveHz(param, to, at, memo, key) {
  if (memo[key] && Math.abs(Math.log(to / memo[key])) < 0.03) return;
  memo[key] = to;
  param.cancelScheduledValues(at); param.setValueAtTime(param.value, at); param.linearRampToValueAtTime(to, at + 0.12);
}
