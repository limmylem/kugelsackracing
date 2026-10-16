// A police siren (docs/PURSUIT.md), made in Web Audio — no recording: a wail (a tone sweeping up and down) or a yelp
// (the same, faster), through a band-pass so it sounds like a horn, heard through the other cars' bus (audio/system.js
// A.bus.others) like any other car's sound: louder as it comes closer (audio/mix.js distanceGain), muffled by the air
// far off (airHz), panned (panOf) and pitched by its motion and yours (doppler — higher coming at you, lower going).
//
//   const S = createSiren(A, { tone: 'wail' | 'yelp', seed })
//   S.update(dt, { rel (source − listener, m), at (in the camera's frame), vel (m/s), listenerVel, on, boost })   S.dispose()

import { doppler, distanceGain, airHz, panOf } from './mix.js';

const TONES = { wail: { lo: 640, hi: 1380, period: 3.6 }, yelp: { lo: 700, hi: 1500, period: 0.32 } };

export function createSiren(A, { tone = 'wail', seed = 0 } = {}) {
  const ctx = A.ctx, cfg = A.cfg, T = TONES[tone] ?? TONES.wail;
  const osc = new OscillatorNode(ctx, { type: 'sawtooth', frequency: T.lo });
  const osc2 = new OscillatorNode(ctx, { type: 'square', frequency: T.lo * 1.005 });
  const mix2 = new GainNode(ctx, { gain: 0.35 });
  const horn = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1100, Q: 0.9 });
  const air = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 18000 });
  const gain = new GainNode(ctx, { gain: 0 });
  const pan = new StereoPannerNode(ctx, { pan: 0 });
  osc.connect(horn); osc2.connect(mix2).connect(horn);
  horn.connect(air).connect(gain).connect(pan).connect(A.bus.others ?? A.bus.master ?? ctx.destination);
  osc.start(); osc2.start();
  let phase = (seed * 0.37) % 1, alive = true;
  return {
    update(dt, { rel, at, vel, listenerVel, on = true, boost = 1 }) {
      if (!alive) return;
      const now = ctx.currentTime, d = Math.hypot(rel[0], rel[1], rel[2]);
      phase = (phase + dt / T.period) % 1;
      // (the sweep: up, then down — a smooth wail; a yelp the same, quick)
      const sweep = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2), f = (T.lo + (T.hi - T.lo) * sweep) * doppler(rel, vel, listenerVel, cfg.doppler);
      osc.frequency.setTargetAtTime(f, now, 0.02); osc2.frequency.setTargetAtTime(f * 1.005, now, 0.02);
      air.frequency.setTargetAtTime(airHz(d, cfg.distance), now, 0.05);
      gain.gain.setTargetAtTime(on ? 0.22 * boost * distanceGain(d, cfg.distance) : 0, now, 0.08);
      pan.pan.setTargetAtTime(panOf(at ?? rel), now, 0.05);
    },
    dispose() {
      if (!alive) return;
      alive = false;
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      setTimeout(() => { try { osc.stop(); osc2.stop(); } catch { /* stopped */ } for (const n of [osc, osc2, mix2, horn, air, gain, pan]) n.disconnect(); }, 300);
    },
  };
}
