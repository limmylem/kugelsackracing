// A car's sound (Phase 8 Step 1; docs/AUDIO.md): your car's, an NPC racer's or another player's — the same voices
// (audio/dsp.js EngineVoice and ChassisVoice, on the audio thread), fed each frame from the physics' snapshot (yours,
// an NPC's) or the network's state (another player's: its revs, throttle, gear and its wheels' slip).
//
//   yours (role 'player'): heard from the camera — outside mostly the exhaust and the engine, in the cockpit the
//     exhaust muffled, more intake, gearbox and the cabin's boom (audio/mix.js viewMix; the change glides) — into the
//     engine, tyres and environment groups
//   another car (role 'other'): positioned (panned, quieter with distance, the air muffling it far off), its pitch
//     moved by its speed and yours (Doppler), muffled behind buildings (occluded), into the others group; heard as
//     'full' (everything), 'simple' (one engine loop, pitched by its revs: cheap, for the far ones) or 'off' — which
//     one, audio/voices.js decides (the nearest few full)
//
//   const v = createCarVoice(A, { spec, role, seed, startOff })   spec: the car's (its engine's sound config, spec.audio)
//   v.update(input, dt, place)   input: { engine (EngineVoice state), chassis (ChassisVoice state) }; place (others):
//                                { at: [x, y, z] in the camera's frame, rel, vel, listenerVel (m, m/s), occluded }
//   v.setView(view) · v.setLod('full' | 'simple' | 'off') · v.event('start' | 'stop' | 'thump' | 'handbrake', x)
//   v.setSpec(spec) (another engine or parts: the sound follows) · v.setMode('layers' | 'granular') · v.mute(map)
//   v.meter() → Promise<{ engine, chassis }> · v.dispose()

import { engineVoiceConfig, doppler as dopplerOf, airHz } from './mix.js';

let seeds = 1;

// (o.out: where your car's sound goes instead of the engine, tyres and environment groups — the garage's dyno, into its own)
export function createCarVoice(A, { spec, role = 'player', seed = seeds++, startOff = false, mode = null, out = null } = {}) {
  const { ctx, cfg } = A, player = role === 'player', t = () => ctx.currentTime;
  // ---- the graph: the voices' outputs, each with its level, into the groups (yours) or one positioned chain ----
  const g = name => new GainNode(ctx, { gain: name === 'tyres' || name === 'road' || name === 'wind' ? 1 : 0 });
  const lv = { exhaust: g('exhaust'), intake: g('intake'), gearbox: g('gearbox'), tyres: g('tyres'), road: g('road'), wind: g('wind') };
  const muffle = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000, Q: 0.5 });          // (the exhaust heard in the cabin)
  const boom = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 110, Q: 0.9, gain: 0 });      // (the cabin's boom)
  const fade = new GainNode(ctx, { gain: 0 });             // (full ↔ simple ↔ off, crossfaded)
  const tap = new GainNode(ctx, { gain: 1 });              // (the engine's exhaust as it comes out: a holed exhaust's rattle, audio/crash.js)
  let panner = null, air = null, occl = null, simpleOut = null;
  lv.exhaust.connect(muffle);
  if (player) {
    muffle.connect(boom); lv.intake.connect(boom); lv.gearbox.connect(boom);
    boom.connect(fade).connect(out ?? A.bus.engine);
    const ty = new GainNode(ctx, { gain: 1 }); lv.tyres.connect(ty); lv.road.connect(ty); ty.connect(out ?? A.bus.tyres);
    lv.wind.connect(out ?? A.bus.environment);
    lv.ty = ty;
  } else {
    // (another car: one chain — its sounds summed, muffled by the air and by buildings, positioned, into the others group)
    const sum = new GainNode(ctx, { gain: 0.8 });
    muffle.connect(sum); lv.intake.connect(sum); lv.gearbox.connect(sum); lv.tyres.connect(sum); lv.road.connect(sum);
    air = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 18000, Q: 0.5 });
    occl = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000, Q: 0.5 });
    const occlGain = new GainNode(ctx, { gain: 1 });
    panner = new PannerNode(ctx, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: cfg.distance.refM, maxDistance: cfg.distance.maxM, rolloffFactor: cfg.distance.rolloff });
    sum.connect(fade).connect(air).connect(occl).connect(occlGain).connect(panner).connect(A.bus.others);
    simpleOut = new GainNode(ctx, { gain: 0 }); simpleOut.connect(air);
    occl.gainNode = occlGain;
    lv.wind.gain.value = 0;
  }
  // ---- the voices ----
  let engine = null, chassis = null, sound = null, path = null, loading = null, lod = 'off', simple = null, alive = true;
  let viewNow = null, muteMap = null, modeNow = mode, specNow = spec, doppler = 1;
  const ensureNodes = () => {
    if (!A.worklet || engine) return;
    engine = A.node('kr-engine', { numberOfInputs: 0, numberOfOutputs: 3, outputChannelCount: [1, 1, 1], processorOptions: { seed } });
    chassis = A.node('kr-chassis', { numberOfInputs: 0, numberOfOutputs: 3, outputChannelCount: [1, 1, 1], processorOptions: { seed: seed + 7919 } });
    engine.connect(lv.exhaust, 0); engine.connect(lv.intake, 1); engine.connect(lv.gearbox, 2); engine.connect(tap, 0);
    chassis.connect(lv.tyres, 0); chassis.connect(lv.road, 1); chassis.connect(lv.wind, 2);
    configure();
  };
  const dropNodes = () => { A.drop(engine); A.drop(chassis); engine = chassis = null; };
  function configure() {
    if (!engine || !sound?.cfg) return;
    const m = modeNow ?? (sound.modes.has('granular') ? 'granular' : 'layers');
    engine.port.postMessage({ t: 'cfg', cfg: engineVoiceConfig(sound.id, sound.cfg, specNow, { mode: sound.modes.has(m) ? m : 'layers', startOff, mute: muteMap, lite: !player }) });
    chassis.port.postMessage({ t: 'cfg', cfg: { mute: muteMap } });
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
    simple = { src, lp };
  }
  function stopSimple() { if (!simple) return; try { simple.src.stop(); } catch { /* stopped */ } simple.src.disconnect(); simple.lp.disconnect(); simple = null; }

  const api = {
    tap,
    get lod() { return lod; },
    get sound() { return sound; },
    get nodes() { return { engine, chassis }; },
    setLod(x) {
      if (x === lod || !alive) return;
      lod = x;
      const T = cfg.voices.fade / 3;
      if (x === 'full') { ensureNodes(); fade.gain.setTargetAtTime(1, t(), T); simpleOut?.gain.setTargetAtTime(0, t(), T); }
      else { fade.gain.setTargetAtTime(0, t(), T); }
      if (x === 'simple') { if (!simple) startSimple(); simpleOut?.gain.setTargetAtTime(0.35, t(), T); }
      else simpleOut?.gain.setTargetAtTime(0, t(), T);
      // (the full voice's nodes go once it's faded: no work for a car that isn't heard)
      const now = lod;
      setTimeout(() => { if (!alive || lod !== now) return; if (now !== 'full') dropNodes(); if (now !== 'simple') stopSimple(); }, cfg.voices.fade * 1000 + 50);
    },
    setView(view) {
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
      if (!engine) return;
      if (e === 'thump' || e === 'handbrake') chassis.port.postMessage({ t: 'ev', e, x });
      else engine.port.postMessage({ t: 'ev', e, x });
    },
    update(input, dt, place = null) {
      if (!alive) return;
      follow();
      if (!player && place) {
        const at = place.at, ok = at && at.every(Number.isFinite);
        if (ok) { panner.positionX.setTargetAtTime(at[0], t(), 0.03); panner.positionY.setTargetAtTime(at[1], t(), 0.03); panner.positionZ.setTargetAtTime(at[2], t(), 0.03); }
        const d = ok ? Math.hypot(at[0], at[1], at[2]) : 1e4;
        air.frequency.setTargetAtTime(airHz(d, cfg.distance), t(), 0.1);
        occl.frequency.setTargetAtTime(place.occluded ? cfg.occlusion.hz : 20000, t(), 0.15);
        occl.gainNode.gain.setTargetAtTime(place.occluded ? cfg.occlusion.gain : 1, t(), 0.15);
        doppler = place.rel ? dopplerOf(place.rel, place.vel, place.listenerVel, cfg.doppler) : 1;
      }
      if (lod === 'simple' && simple && sound?.simple) {
        const e = input.engine ?? {}, rate = Math.max(0.25, Math.min(3, (e.rpm ?? 900) / sound.simple.rpm)) * doppler;
        simple.src.playbackRate.setTargetAtTime(rate, t(), 0.05);
        simple.lp.frequency.setTargetAtTime(1200 + 2500 * Math.min(1, e.throttle ?? 0), t(), 0.1);
      }
      if (lod !== 'full' || !engine) return;
      if (input.engine) engine.port.postMessage({ t: 's', s: doppler === 1 ? input.engine : { ...input.engine, doppler } });
      if (input.chassis) chassis.port.postMessage({ t: 's', s: doppler === 1 ? input.chassis : { ...input.chassis, doppler } });
    },
    meter() {
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
      for (const n of [...Object.values(lv), muffle, boom, fade, tap, panner, air, occl, occl?.gainNode, simpleOut].filter(Boolean)) { try { n.disconnect(); } catch { /* gone */ } }
      if (sound) A.release(sound);
      sound = null;
    },
  };
  if (player) { api.setLod('full'); fade.gain.cancelScheduledValues(0); fade.gain.value = 1; }
  follow();
  if (viewNow === null && player) api.setView(cfg.views.chase);
  return api;
}
