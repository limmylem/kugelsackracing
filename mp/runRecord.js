// A multiplayer run's record for the verifier (Phase 7 Step 3; docs/CONTACT.md "Verification"): everything that moved
// the player's car, step by step, so the run can be driven again exactly — on the server, headless, with the same
// physics (Phase 6 Step 3's determinism). Pure: no network, no drawing; the game and the bots alike.
//
//   const R = createRunRecorder({ sim, trailEvery, toWorld, clock })   toWorld([x, y, z]): the physics' frame to the
//                                       world's; clock(simTime) → the race's clock (ms) then
//   R.start({ pose: { position, headingDeg }, ...header })   the car is reset there exactly (sim.resetCar) — the replay
//                                       starts from the same state — and from then on (header.origin: where the
//                                       physics' frame's origin is in the world's, if they differ):
//     every step's input, quantized (5 bytes: steer, throttle, brake, clutch, flags) — what's recorded is what the car got
//     every push that isn't the solver's (car-to-car contact: R.push(j, point, ev) applies it AND records it)
//     every change to the car between steps (C events): its damage (the spec's), its driving aids, a part loosened, torn
//     off or put back, a reset — at the step they first count for
//     the car's position every trailEvery steps (the trail: the replay must arrive at each one)
//   R.stop() → { header, start, steps, inputs: base64, events, trail }
//   quantizeInput(input) → 5 bytes        inputFrom(bytes, i, { wheelRange }) → the input they mean

const f32 = Math.fround;
const DEVICES = ['keyboard', 'gamepad', 'wheel'];
export function quantizeInput(input) {
  const q = x => Math.max(0, Math.min(255, Math.round(x * 255)));
  const steer = Math.max(0, Math.min(254, Math.round((input?.steer ?? 0) * 127) + 127));
  const flags = (input?.handbrake ? 1 : 0) | (input?.shift === 1 ? 2 : 0) | (input?.shift === -1 ? 4 : 0) | ((Math.max(0, DEVICES.indexOf(input?.device ?? 'keyboard')) & 3) << 4);
  return [steer, q(input?.throttle ?? 0), q(input?.brake ?? 0), input?.clutch == null ? 255 : Math.min(254, q(input.clutch)), flags];
}
export function inputFrom(b, i = 0, { wheelRange = null } = {}) {
  const o = i * 5, flags = b[o + 4];
  const input = { steer: (b[o] - 127) / 127, throttle: b[o + 1] / 255, brake: b[o + 2] / 255, clutch: b[o + 3] === 255 ? null : b[o + 3] / 255, handbrake: !!(flags & 1), device: DEVICES[(flags >> 4) & 3] };
  if (flags & 2) input.shift = 1; else if (flags & 4) input.shift = -1;
  if (wheelRange != null) input.wheelRange = wheelRange;
  return input;
}
const clone = x => x == null ? null : JSON.parse(JSON.stringify(x));
export const toBase64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
export const fromBase64 = b64 => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };

export function createRunRecorder({ sim, trailEvery = 120, toWorld = null, clock = null }) {
  // (the trail, and each push's point beside its physics one, in the world's frame: what the race server sees — the
  // game's physics can run on a floating origin; the replay applies the physics' own)
  const world = (x, y, z) => { if (!toWorld) return [x, y, z]; const p = toWorld([x, y, z]); return [p[0], p[1], p[2]]; };
  const rec = { on: false, start: 0, inputs: [], events: [], trail: [], header: null };
  let lastDamage = null, lastAids = null, undo = [];
  const step = () => sim.stepCount - rec.start;
  const note = (k, x) => { if (rec.on) rec.events.push({ s: step(), k, ...x }); };

  // each step's input: quantized, and the car's changes since the last step noted first (they count from this step)
  function filter(input) {
    const v = sim.vehicle;
    if (v.spec.damage !== lastDamage) { lastDamage = v.spec.damage; note('D', { damage: clone(lastDamage) }); }
    const aids = JSON.stringify(v.aids ?? null);
    if (aids !== lastAids) { lastAids = aids; note('A', { aids: JSON.parse(aids) }); }
    const q = quantizeInput(input);
    if (rec.on) {
      rec.inputs.push(...q);
      // (each trail point stamped on the race's clock too: a game whose physics falls behind real time — a slow
      // computer — isn't where step × dt says)
      if ((rec.inputs.length / 5 - 1) % trailEvery === 0) { const p = v.body.translation(), [x, y, z] = world(p.x, p.y, p.z); rec.trail.push([step(), f32(x), f32(y), f32(z), ...(clock ? [Math.round(clock(sim.time))] : [])]); }
    }
    return inputFrom(q, 0, { wheelRange: input?.wheelRange ?? null });
  }
  // the parts and resets: whatever the game does to the car between steps, noted as it's done
  function wrap(obj, name, kind, args) {
    const orig = obj[name];
    obj[name] = function (...a) { note(kind, args(...a)); return orig.apply(this, a); };
    undo.push(() => { obj[name] = orig; });
  }

  return {
    start({ pose, ...header }) {
      // (exactly here, from rest: the verifier puts the car the same way)
      sim.resetCar(pose);
      Object.assign(rec, { on: true, start: sim.stepCount, inputs: [], events: [], trail: [], header: { ...header, pose, stepHz: Math.round(1 / sim.dt), damage: clone(sim.vehicle.spec.damage), aids: clone(sim.vehicle.aids) } });
      lastDamage = sim.vehicle.spec.damage; lastAids = JSON.stringify(sim.vehicle.aids ?? null);
      sim.setInputFilter(filter);
      const parts = sim.vehicle.parts;
      wrap(parts, 'loosen', 'P', (socket, def) => ({ op: 'loosen', socket, def: clone(def) }));
      wrap(parts, 'detach', 'P', (socket, def, time, key) => ({ op: 'detach', socket, def: clone(def), key }));
      wrap(parts, 'reattach', 'P', socket => ({ op: 'reattach', socket }));
      wrap(parts, 'clear', 'P', () => ({ op: 'clear' }));
      wrap(sim, 'resetCar', 'R', at => ({ at: clone(at) }));
    },
    // a push on the car (car-to-car contact): rounded to 32-bit floats, horizontal, at the centre of mass's height —
    // applied and noted exactly as the replay will apply it
    push(j, point, ev = {}) {
      const b = sim.vehicle.body, jx = f32(j[0]), jz = f32(j[1]), px = f32(point[0]), pz = f32(point[1]);
      if (!Number.isFinite(jx) || !Number.isFinite(jz) || !Number.isFinite(px) || !Number.isFinite(pz)) return null;
      b.applyImpulseAtPoint({ x: jx, y: 0, z: jz }, { x: px, y: b.worldCom().y, z: pz }, true);
      const [wx, , wz] = world(px, 0, pz);
      if (rec.on) rec.events.push({ s: sim.stepCount - rec.start, k: 'J', j: [jx, jz], p: [px, pz], ...(toWorld && (wx !== px || wz !== pz) && { w: [f32(wx), f32(wz)] }), ...ev });
      return [jx, jz];
    },
    stop() {
      for (const u of undo.splice(0)) u();
      sim.setInputFilter(null);
      const out = { header: rec.header, start: rec.start, steps: rec.inputs.length / 5, inputs: toBase64(Uint8Array.from(rec.inputs)), events: rec.events, trail: rec.trail };
      rec.on = false;
      return out;
    },
    // (a note in the record that isn't a change to the car: the contact client ties an episode to its agreed contact)
    mark(k, x) { note(k, x); },
    get on() { return rec.on; },
    get steps() { return rec.inputs.length / 5; },
    get events() { return rec.events; },
  };
}
