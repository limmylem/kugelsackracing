// The driving's sound (Phase 8 Step 1; docs/AUDIO.md): your car (audio/car.js), the crashes and damage
// (audio/crash.js), where you are (audio/environment.js) and every other car (audio/voices.js), fed each frame from
// the physics' snapshot. testtrack/test-scene.js makes one when the game's sound starts (audio/system.js).
//
//   const G = createGameAudio(A, { spec })
//   G.update(snapshot, dt, { view, roofOpen, surfaces, wet, steam, exhaust, flap, handbrake, pedal, world, RAPIER,
//            listener: { pos, vel, toCamera }, stream, theme, stands })
//   G.crash.impact(cls, material, within) · G.crash.glass() · …   G.grind(strength) · G.bang() · G.clunk()
//   G.start() · G.stop() (the engine) · G.setSpec(spec) (another car or engine) · G.voices (other cars) · G.env
//   G.mute(on) · G.dispose()

import { createCarVoice } from './car.js';
import { createCrashSounds } from './crash.js';
import { createEnvironment } from './environment.js';
import { createVoices } from './voices.js';
import { engineInput, turboInput, tyreSound, surfaceMix, viewMix, Bumps, BrakeSqueal, TurboSpool } from './mix.js';
import { SURFACES } from './dsp.js';

export const DRIVING = ['engine', 'tyres', 'impacts', 'environment', 'others'];

export function createGameAudio(A, { spec, occluded = null, startOff = false } = {}) {
  const cfg = A.cfg;
  let specNow = spec, viewKey = null, alive = true, oneShots = null;
  const car = createCarVoice(A, { spec, role: 'player', startOff });
  const crash = createCrashSounds(A, { engineTap: car.tap });
  const env = createEnvironment(A);
  const voices = createVoices(A, { occluded });
  const turbo = new TurboSpool(), bumps = new Bumps(cfg.bumps), brakes = new BrakeSqueal(cfg.brakes);
  const surf = new Float32Array(SURFACES.length);
  let handbrake = false, last = null;
  // (an engine's one-off sounds: a blown engine's bang, bent valves' clack — its sound config's files)
  async function loadOneShots() {
    const path = specNow.engine?.sound;
    if (!path) return null;
    const c = await (await fetch(path, { cache: 'no-cache' })).json();
    const [bang, bent] = await Promise.all([A.buffer(c.damage.bang), A.buffer(c.damage.bent)]);
    return { path, c, bang, bent };
  }
  const one = (buf, gain) => { if (!buf) return; const s = new AudioBufferSourceNode(A.ctx, { buffer: buf }), g = new GainNode(A.ctx, { gain }); s.connect(g).connect(A.bus.engine); s.start(); s.onended = () => { s.disconnect(); g.disconnect(); }; };
  const shots = () => { if (!oneShots || oneShots.path !== specNow.engine?.sound) { const old = oneShots; oneShots = { path: specNow.engine?.sound, p: loadOneShots().then(x => { if (oneShots?.path === x?.path) Object.assign(oneShots, x); }) }; if (old?.c) { A.unbuffer(old.c.damage.bang); A.unbuffer(old.c.damage.bent); } } return oneShots; };
  shots();

  return {
    car, crash, env, voices, cfg,
    get spec() { return specNow; },
    get last() { return last; },
    setSpec(s) { specNow = s; car.setSpec(s); shots(); },
    start() { car.event('start'); },
    stop() { car.event('stop'); },
    grind: x => crash.grind(x),
    bang() { const o = shots(); one(o.bang, o.c?.damage.bangGain ?? 1); },
    clunk() { const o = shots(); one(o.bent, o.c?.damage.bentGain ?? 0.55); },
    // (the driving's sounds off — the M key, the editor, the garage open — the garage's and the quests' play on)
    mute(on) { A.silence(DRIVING, on); },
    // b: the vehicle's snapshot; x: what else the frame knows (see above)
    update(b, dt, x = {}) {
      if (!alive || !b) return;
      A.time(() => {
        const E = specNow.engine, speed = Math.abs(b.speed ?? 0), view = x.view ?? 'chase';
        // the camera: what it hears (a change glides)
        const key = `${view}|${!!x.roofOpen}`;
        if (key !== viewKey) { viewKey = key; const v = viewMix(cfg, view, !!x.roofOpen); car.setView(v); A.setView(v); }
        // the engine: the physics' revs, throttle, load (its torque), gear, clutch, limiter, misfires; the turbo
        const e = engineInput(b.engine, E, { pedal: x.pedal ?? b.throttle });
        const tu = turboInput(turbo, specNow, dt, e.rpm, b.engine?.fuelCut ? (x.pedal ?? b.throttle ?? 0) : e.throttle);
        // the tyres, the road, the brakes, the wind
        const ty = tyreSound(b.wheels, speed, x.surfaces, cfg.tyres), sm = surfaceMix(b.wheels, x.surfaces, cfg.surfaces, speed, surf);
        // (the wind rising with the square of the speed; how much of it each camera hears, the view's wind)
        const brake = brakes.update(speed, b.brake ?? 0, dt);
        const chassis = { speed, ...ty, surf: sm.surf, kerb: sm.kerb, kerbHz: sm.kerbHz, wet: x.wet ?? 0, brake, wind: Math.min(1, (speed / 45) ** 2) };
        car.update({ engine: { ...e, spool: tu.spool, whistle: tu.whistle }, chassis }, dt);
        const bump = bumps.update(b.wheels, dt);
        if (bump > 0) car.event('thump', bump);
        if (!!x.handbrake !== handbrake) { handbrake = !!x.handbrake; if (handbrake) car.event('handbrake'); }
        last = { engine: e, spool: tu.spool, tyres: ty, surface: sm, brake, bump };
        crash.update(b, dt, specNow, { exhaust: x.exhaust ?? 0, steam: x.steam ?? 0, flap: x.flap ?? 0, speed });
        env.update({ world: x.world, RAPIER: x.RAPIER, pos: x.listener?.pos, stream: x.stream, theme: x.theme, stands: x.stands ?? [], speed, inside: view === 'cockpit' || view === 'bonnet' }, dt);
        if (x.listener) voices.frame(dt, { listener: x.listener });
        A.frame();
      });
    },
    dispose() {
      if (!alive) return;
      alive = false;
      voices.dispose(); env.dispose(); crash.dispose(); car.dispose();
      if (oneShots?.c) { A.unbuffer(oneShots.c.damage.bang); A.unbuffer(oneShots.c.damage.bent); }
    },
  };
}
