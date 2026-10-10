// Other cars' sounds (Phase 8 Step 1; docs/AUDIO.md): NPC racers (their physics snapshots) and other players (the
// network's states) through the same voices as yours (audio/car.js), the nearest few heard in full — engine, tyres,
// the lot — the next ones further off with a cheap one (one engine loop, pitched by its revs), the rest not at all
// (data/audio.json voices; audio/mix.js rankVoices). Each frame each car says where it is and what it's doing; the
// manager decides who's heard how, checks now and then whether a building's between you and it (occluded: muffled),
// and sends each voice its state.
//
//   const V = createVoices(A, { occluded(fromSim, toSim) → bool })
//   const h = V.add(id, spec)        spec: the car's (its engine's sound config, spec.audio) — another player's from its look
//   h.update(input, { pos, vel })    input: { engine, chassis } (audio/mix.js engineInput / remoteEngineInput …); pos, vel:
//                                    sim frame, m and m/s
//   h.dispose()                      (or V.remove(id))
//   V.frame(dt, { listener: { pos, vel, toCamera(pos) → [x, y, z] in the camera's frame } }) · V.counts · V.dispose()

import { rankVoices } from './mix.js';
import { createCarVoice } from './car.js';

export function createVoices(A, { occluded = null } = {}) {
  const cfg = A.cfg, cars = new Map(), was = new Map();
  let clock = 0, alive = true, seed = 1000;
  function remove(id) { const c = cars.get(id); if (!c) return; c.voice.dispose(); cars.delete(id); }
  const V = {
    add(id, spec) {
      remove(id);
      const c = { id, voice: createCarVoice(A, { spec, role: 'other', seed: seed += 13 }), input: null, pos: null, vel: null, occ: false, occAt: -1e9, d: Infinity };
      cars.set(id, c);
      return {
        voice: c.voice,
        update(input, place) { c.input = input; c.pos = place?.pos ?? c.pos; c.vel = place?.vel ?? c.vel; },
        setSpec(s) { c.voice.setSpec(s); },
        dispose() { if (cars.get(id) === c) remove(id); },
      };
    },
    remove,
    frame(dt, { listener }) {
      if (!alive) return;
      clock += dt;
      const L = listener;
      for (const c of cars.values()) c.d = c.pos && L?.pos ? Math.hypot(c.pos[0] - L.pos[0], c.pos[1] - L.pos[1], c.pos[2] - L.pos[2]) : Infinity;
      const lods = rankVoices([...cars.values()].map(c => ({ id: c.id, d: c.d })), cfg.voices, was, clock, A.quality);
      const every = cfg.occlusion.every, occOn = !!occluded && (A.quality !== 'low' || cfg.lowQuality.occlusion);
      for (const c of cars.values()) {
        const lod = c.pos ? lods.get(c.id) ?? 'off' : 'off';
        c.voice.setLod(lod);
        if (lod === 'off' || !c.input) continue;
        if (occOn && clock - c.occAt >= every) { c.occAt = clock + Math.random() * every * 0.5; try { c.occ = occluded(L.pos, c.pos); } catch { c.occ = false; } }
        const rel = [c.pos[0] - L.pos[0], c.pos[1] - L.pos[1], c.pos[2] - L.pos[2]];
        c.voice.update(c.input, dt, { at: L.toCamera ? L.toCamera(c.pos) : rel, rel, vel: c.vel, listenerVel: L.vel, occluded: occOn && c.occ });
      }
    },
    get counts() { const n = { full: 0, simple: 0, off: 0 }; for (const c of cars.values()) n[c.voice.lod]++; return n; },
    get size() { return cars.size; },
    dispose() { alive = false; for (const id of [...cars.keys()]) remove(id); was.clear(); },
  };
  return V;
}
