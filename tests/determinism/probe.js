// The determinism probe (Phase 6 Step 3): a recorded run replayed from its inputs alone, and its state hashed
// bit for bit. The same module runs in Node (the server) and in each browser, so the hashes can be compared.
// Pure: Rapier, the settings, the car's spec and sockets are passed in; no browser APIs.
//
//   const T = trackFor(code, cfg)                    a generated track from its code (track/build.js)
//   const r = replay({ RAPIER, settings, spec, sockets, T, inputs, npcs })
//     inputs: Uint8Array, 3 bytes a physics step (steer 0–254 → −1…1, throttle 0–255, brake 0–255)
//     npcs: [{ inputs }] other cars on the grid, each replaying its own recorded inputs
//     → { hash, seconds: [hash after each simulated second], steps, final: { position, speed } }
//
//   encodeInputs / decodeInputs: the recorded inputs, quantized (what's applied is what's recorded)

import { generateTrack } from '../../track/generate.js';
import { buildTrack, trackWorld, trackProjection } from '../../track/build.js';
import { nearestOnTrack } from '../../track/scene.js';
import { viewCourse } from '../../route/model.js';
import { createSimulation } from '../../physics/sim.js';
import { sin as detSin, cos as detCos } from '../../track/det.js';

// (the experiment: the platform's sine and cosine replaced by the deterministic ones while a run's world is
// built and driven)
// mode 'sincos': track/det.js's; 'all': every function the simulation uses, from a library (lib)
export function patchMath(mode, lib = null) { if (mode === 'sincos') { Math.sin = detSin; Math.cos = detCos; } if (mode === 'all') Object.assign(Math, lib); }

export function trackFor(code, cfg) {
  const gen = generateTrack({ code });
  if (!gen.ok) throw new Error(gen.error);
  const data = buildTrack(gen, cfg);
  return { data, track: trackWorld(data), course: viewCourse(data.course, trackProjection) };
}

export const inputAt = (inputs, i) => ({ steer: (inputs[i * 3] - 127) / 127, throttle: inputs[i * 3 + 1] / 255, brake: inputs[i * 3 + 2] / 255, handbrake: false, device: 'wheel' });
export const quantize = ({ steer, throttle, brake }) => [Math.max(0, Math.min(254, Math.round(steer * 127) + 127)), Math.max(0, Math.min(255, Math.round(throttle * 255))), Math.max(0, Math.min(255, Math.round(brake * 255)))];

// FNV-1a over the exact bits of numbers
const F = new Float64Array(1), B = new Uint8Array(F.buffer);
function mixNumbers(h, nums) {
  for (const x of nums) { F[0] = x; for (let k = 0; k < 8; k++) { h ^= B[k]; h = Math.imul(h, 16777619) >>> 0; } }
  return h;
}
const bodyNumbers = v => { const b = v.body, p = b.translation(), q = b.rotation(), l = b.linvel(), a = b.angvel(); return [p.x, p.y, p.z, q.x, q.y, q.z, q.w, l.x, l.y, l.z, a.x, a.y, a.z, ...v.wheels.map(w => w.omega ?? 0)]; };
export const hex = h => h.toString(16).padStart(8, '0');

export function replay({ RAPIER, settings, spec, sockets, T, inputs, npcs = [] }) {
  const sim = createSimulation(RAPIER, { settings, spec, sockets, track: T.track });
  const slots = T.course.grid.slots, put = (slot) => ({ position: [slot.x, nearestOnTrack(T.data, slot.x, slot.z).h + 0.6, slot.z], headingDeg: slot.heading });
  sim.resetCar(put(slots[0]));
  const others = npcs.map((n, k) => { let i = 0; return sim.addCar(put(slots[(k + 1) % slots.length]), () => inputAt(n.inputs, Math.min(i++, n.inputs.length / 3 - 1))); });
  const steps = inputs.length / 3, per = settings.stepHz, seconds = [];
  let h = 2166136261;
  for (let i = 0; i < steps; i++) {
    sim.step(inputAt(inputs, i));
    if ((i + 1) % per === 0 || i === steps - 1) {
      h = mixNumbers(h, bodyNumbers(sim.vehicle));
      for (const c of sim.cars) h = mixNumbers(h, bodyNumbers(c.vehicle));
      seconds.push(hex(h));
    }
  }
  const s = sim.vehicle.snapshot();
  const out = { hash: hex(h), seconds, steps, final: { position: s.position, speed: s.speed }, others: others.length };
  sim.vehicle.world.free();
  return out;
}

// the inputs as text (base64) for a fixture
export const encodeInputs = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
export const decodeInputs = b64 => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
