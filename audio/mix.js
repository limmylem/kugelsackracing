// The game's sound worked out from the game's state (Phase 8 Step 1; docs/AUDIO.md): pure, so the Node tests check
// it; audio/car.js and audio/game.js send what it says to the voices (audio/dsp.js). data/audio.json is its tuning.
//
//   engineVoiceConfig(id, soundConfig, spec, o)   an engine's voice: its sound config (data/sounds/engines) and the
//                                                 car's own sound (spec.audio, garage/carSound.js)
//   engineInput(engineSnap, spec.engine, o)       the physics' engine → the voice's state (load from the torque model)
//   remoteEngineInput(pose, idleRpm)              another player's car (only its revs, throttle and gear are sent)
//   turboInput(spool, spec, dt, rpm, throttle)    the turbo's spool and whistle
//   tyreSound(wheels, speed, surfaces, cfg)       scrub, squeal, skid: how near and past the grip limit the tyres are
//   surfaceMix(wheels, surfaces, cfg, speed)      what the road sounds like under the wheels
//   Bumps, BrakeSqueal                            thumps through the suspension; brakes squealing as the car stops
//   viewMix(cfg, view, roofOpen)                  what each camera hears
//   doppler(rel, vSrc, vLis, cfg), airHz(d, cfg), audibleM(cfg)
//   rankVoices(cars, cfg, was, now, quality)      which other cars get a full voice, a simple one, or none
//   surroundings(probe, cfg)                      a tunnel, under a bridge, a street of buildings, open country
//   loopEntry(data, pad), sweepEntry(data, grains, sr)    sample data as the bank keeps it (audio/dsp.js Bank)

import { curveTorque, frictionTorque } from '../physics/engine.js';
import { TurboSpool } from '../testtrack/soundMix.js';
import { emptySound } from '../garage/carSound.js';
import { SURFACES } from './dsp.js';

export { TurboSpool };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const finite = (x, or) => Number.isFinite(x) ? x : or;
const share = (a, b) => 1 - (1 - clamp(a ?? 0, 0, 1)) * (1 - clamp(b ?? 0, 0, 1));

// ---------- the engine ----------

// An engine's voice config (audio/dsp.js EngineVoice.configure). id: its sound config's path (the bank's key); sc:
// the config; spec: the car's (its engine, gearbox, turbo, and spec.audio). o: { mode ('layers' | 'granular'; the
// config's own by default), startOff (the engine off until 'start'), mute ({ exhaust: false, … }: the test page), lite
// (another car's voice: audio/dsp.js) }
export function engineVoiceConfig(id, sc, spec, o = {}) {
  const E = spec.engine, A = spec.audio ?? emptySound(), X = sc.exhaust ?? {}, L = sc.limiter ?? {};
  const mode = o.mode ?? (sc.granular ? sc.mode ?? 'granular' : 'layers');
  return {
    sound: id, mode: mode === 'granular' && !sc.granular ? 'layers' : mode,
    cylinders: sc.cylinders, idleRpm: E.idleRpm, redlineRpm: E.redlineRpm, mix: sc.mix,
    intake: sc.intake ? { gain: sc.intake.gain, hz: sc.intake.hz.map(h => h * (A.intake?.tone ?? 1)), q: sc.intake.q, throttle: sc.intake.throttle } : null,
    limiter: A.limiter ?? { hz: L.hz ?? 14, depth: L.depth ?? 0.85 },
    idle: { wobble: sc.idle?.wobble ?? 0.012, hz: sc.idle?.hz ?? 1.5, lope: A.idle?.lope ?? sc.idle?.lope ?? 0, lopeHz: A.idle?.lopeHz ?? sc.idle?.lopeHz ?? 0 },
    pops: { fromRpm: (sc.pops?.from ?? 0.45) * E.redlineRpm, gain: sc.pops?.gain ?? 0.5 },
    start: { crankRpm: sc.start?.crankRpm ?? 220, seconds: sc.start?.seconds ?? 0.9, flare: sc.start?.flare ?? 1.7, gain: sc.start?.gain ?? 0.16 },
    exhaust: { level: A.exhaust?.level ?? 1, tone: A.exhaust?.tone ?? 1, rasp: share(X.rasp, A.exhaust?.rasp), pops: share(X.pops, A.exhaust?.pops) },
    induction: { roar: A.intake?.roar ?? 1, tone: A.intake?.tone ?? 1 },
    turbo: spec.turbo ? { blowoff: A.blowoff ?? null } : null,
    supercharger: A.supercharger ?? null,
    gears: spec.gearbox ? { whine: A.gears?.whine ?? 0, teeth: A.gears?.teeth ?? 23, cut: !!A.gears?.cut, ratios: spec.gearbox.ratios } : null,
    shiftGain: sc.shift?.gain ?? 0.2, reverseWhine: 0.035,
    startOff: !!o.startOff, mute: o.mute ?? null, lite: !!o.lite,
  };
}

// The drivetrain's gear name → a number (−1 reverse, 0 neutral)
export const gearNumber = g => g === 'R' ? -1 : g === 'N' || g == null ? 0 : finite(+g, 0);

// The physics' engine (physics/drivetrain.js snapshot) → the voice's state. load: the torque the engine makes as a share
// of all it could at these revs (full throttle's curve), or below nothing its engine braking as a share of all of it
// (−1: shut, on the overrun). pedal: what the driver asks for (the input; the engine's throttle has the idle
// control, traction control and the limiter in it). rough: how far valve float drops firings (the sound config's).
export function engineInput(e, E, { pedal = null, rough = 0.35 } = {}) {
  const rpm = Math.max(0, finite(e?.rpm, E.idleRpm)), T = finite(e?.torque, 0);
  const load = T >= 0 ? T / Math.max(1, curveTorque(E, rpm)) : T / Math.max(1, frictionTorque(E, rpm));
  return {
    rpm, throttle: clamp(finite(e?.throttle, 0), 0, 1), pedal: clamp(finite(pedal ?? e?.throttle, 0), 0, 1), load: clamp(load, -1, 1),
    gear: gearNumber(e?.gear), shifting: !!e?.shifting, clutch: clamp(finite(e?.clutch, 1), 0, 1), fuelCut: !!e?.fuelCut,
    misfire: Math.max(e?.health?.misfire ?? 0, e?.health?.floating ? rough : 0),
  };
}
// Another player's car: only its revs, throttle and gear come over the network — on the throttle it's on load, off it
// above idle it's on the overrun
export function remoteEngineInput(p, idleRpm = 900) {
  const rpm = Math.max(0, finite(p?.rpm, idleRpm)), thr = clamp(finite(p?.throttle, 0), 0, 1);
  return { rpm, throttle: thr, pedal: thr, load: thr > 0.06 ? 0.25 + 0.75 * thr : rpm > idleRpm * 1.25 ? -0.7 : 0, gear: finite(p?.gear, 1), shifting: false, clutch: 1, fuelCut: false, misfire: 0 };
}
// The turbo's spool and whistle this frame (spool: a TurboSpool, kept per car): the boost curve fitted (spec.turbo)
// and the whistle that goes with it (spec.audio.whistle: the turbo part's, else the engine's own)
export function turboInput(spool, spec, dt, rpm, throttle) {
  const whistle = spec.audio?.whistle ?? spec.turbo?.sound?.whistle ?? null;
  if (!spec.turbo || !whistle) return { spool: 0, whistle: null };
  const w = spool.update(dt, { boost: spec.turbo.boost, sound: { whistle } }, rpm, throttle);
  return { spool: w.spool, whistle: { hz: w.hz, gain: w.gain, noise: w.noise, q: w.q } };
}

// ---------- the tyres and the road ----------

// The tyres (combined slip: the tyre model's, 1 at the peak of its curve — the grip limit): nothing well inside it; a
// scrub that grows as it nears the limit; past it a squeal, louder and higher the further past and the faster it
// slides; far past (locked, spinning, sideways) a skid. Only on a hard surface; each wheel by the weight on it.
// wheels: the snapshot's ({ grounded, combinedSlip, slipSpeed, load, surface }) or a remote car's ({ grounded, slip });
// surfaces: the world's surface table (name → { sound }); cfg: data/audio.json tyres.
export function tyreSound(wheels, speed, surfaces, cfg) {
  let scrub = 0, squeal = 0, skid = 0, fastest = 0;
  const v = Math.abs(finite(speed, 0));
  for (const w of wheels ?? []) {
    if (!w?.grounded) continue;
    const S = surfaces?.[w.surface], hard = !S || !S.sound || S.sound === 'tarmac';
    if (!hard) continue;
    const s = finite(w.combinedSlip ?? w.slip, 0), slide = finite(w.slipSpeed, v * Math.max(0, s - 0.8) * 0.3);
    const weight = w.load == null ? 1 : Math.min(1, finite(w.load, 0) / cfg.loadFull), moving = smooth(cfg.slipFrom[0], cfg.slipFrom[1], Math.max(slide, v * 0.2));
    scrub = Math.max(scrub, smooth(cfg.scrub[0], cfg.scrub[1], s) * (1 - 0.6 * smooth(1, 1.4, s)) * weight * smooth(2, 10, v));
    squeal = Math.max(squeal, smooth(cfg.squeal[0], cfg.squeal[1], s) * weight * moving);
    skid = Math.max(skid, smooth(cfg.skid[0], cfg.skid[1], s) * weight * smooth(3, 10, slide));
    fastest = Math.max(fastest, slide);
  }
  return { scrub, squeal, skid, pitch: Math.min(1, fastest / 15) };
}

// The road under the wheels: each audio surface's share (audio/dsp.js SURFACES), a kerb's rumble (its share, and the
// rate its stripes pass: about a metre apart) — by the world's surface names (cfg.byName) or their sound (cfg.bySound)
export function surfaceKind(name, surfaces, cfg) {
  return cfg.byName[name] ?? cfg.bySound[surfaces?.[name]?.sound] ?? 'tarmac';
}
export function surfaceMix(wheels, surfaces, cfg, speed, out = new Float32Array(SURFACES.length)) {
  out.fill(0);
  let n = 0, kerb = 0;
  for (const w of wheels ?? []) {
    if (!w?.grounded) continue;
    n++;
    const k = SURFACES.indexOf(surfaceKind(w.surface, surfaces, cfg));
    out[k < 0 ? 0 : k] += 1;
    const S = surfaces?.[w.surface];
    if (S?.rumble || w.surface === 'kerb' || w.surface === 'sausage') kerb = Math.max(kerb, Math.min(1, (S?.rumble ?? 1) * smooth(2, 20, Math.abs(speed))));
  }
  if (n) for (let i = 0; i < out.length; i++) out[i] /= n;
  return { surf: out, kerb, kerbHz: Math.min(60, Math.abs(finite(speed, 0)) / 1.0) };
}

// Thumps through the suspension: a wheel's compression speed past the first of cfg.compressionSpeed (m/s; full at
// the second) — at most one a wheel every cfg.gap s. update(wheels, dt) → the strongest this frame (0..1) or 0
export class Bumps {
  constructor(cfg) { this.cfg = cfg; this.since = []; }
  update(wheels, dt) {
    const [lo, hi] = this.cfg.compressionSpeed;
    let out = 0;
    (wheels ?? []).forEach((w, i) => {
      this.since[i] = (this.since[i] ?? 9) + dt;
      const v = finite(w.compressionSpeed, 0);
      if (!w.grounded || v < lo || this.since[i] < this.cfg.gap) return;
      this.since[i] = 0;
      out = Math.max(out, Math.min(1.5, (v - lo) / (hi - lo)));
    });
    return out;
  }
}
// Brakes squealing as the car comes to a stop: light pressure below cfg.speed m/s, on cfg.share of stops (which ones:
// a fixed pattern, so a race sounds the same each replay); update(speed, brake 0..1, dt) → 0..1
export class BrakeSqueal {
  constructor(cfg, seed = 1) { this.cfg = cfg; this.stop = seed; this.on = false; this.moving = false; this.level = 0; }
  update(speed, brake, dt) {
    const v = Math.abs(finite(speed, 0)), C = this.cfg;
    if (v > C.speed * 2 && !this.moving) { this.moving = true; this.stop++; let x = Math.imul(this.stop, 0x9e3779b1); x ^= x >>> 15; this.on = ((x >>> 0) / 4294967296) < C.share; }
    if (v < 0.2) this.moving = false;
    const want = this.on && v > 0.25 && v < C.speed && brake >= C.pressure[0] && brake <= C.pressure[1] ? smooth(0, 1.5, v) : 0;
    this.level += (want - this.level) * Math.min(1, dt / 0.08);
    return this.level;
  }
}

// ---------- where you're listening from ----------

// What a camera hears (data/audio.json views): the roof down (or none) opens the cockpit's
export function viewMix(cfg, view, roofOpen = false) {
  const inside = view === 'cockpit' || view === 'bonnet';
  return { ...(inside && roofOpen ? cfg.views.roofOpen : cfg.views[view] ?? cfg.views.chase), inside };
}

// A sound's pitch from its motion and the listener's: rel = source − listener (m), velocities m/s; the source
// moving away (or the listener) lowers it — (c + listener's speed toward) ÷ (c + source's speed away)
export function doppler(rel, vSrc, vLis, cfg) {
  const d = Math.hypot(rel[0], rel[1], rel[2]);
  if (!(d > 0.5)) return 1;
  const u = [rel[0] / d, rel[1] / d, rel[2] / d], dot = v => v ? v[0] * u[0] + v[1] * u[1] + v[2] * u[2] : 0;
  const f = (cfg.c + dot(vLis)) / Math.max(1, cfg.c + dot(vSrc));
  return clamp(finite(f, 1), 1 - cfg.max, 1 + cfg.max);
}
// the air muffling a far sound: the low-pass at d m
export const airHz = (d, cfg) => clamp(cfg.air.hz * 0.5 ** (Math.max(0, d - cfg.refM) / cfg.air.halfM), 600, 20000);

// ---------- other cars' voices ----------

// Which other cars are heard how: the nearest cfg.full a full voice, the next cfg.simple within simpleM a simple one,
// the rest none. A car keeps what it had until the change has been wanted for `hold` s (no flapping between two
// cars at the same distance). cars: [{ id, d (m) }]; was: Map id → { voice, want, since } (kept between calls,
// updated); now: s. → Map id → 'full' | 'simple' | 'off'
export function rankVoices(cars, cfg, was, now, quality = 'high') {
  const full = quality === 'low' ? cfg.lowFull : cfg.full, sorted = [...cars].filter(c => Number.isFinite(c.d)).sort((a, b) => a.d - b.d);
  const want = new Map();
  sorted.forEach((c, i) => want.set(c.id, i < full ? 'full' : i < full + cfg.simple && c.d <= cfg.simpleM ? 'simple' : 'off'));
  const out = new Map();
  for (const c of cars) {
    const w = want.get(c.id) ?? 'off', s = was.get(c.id) ?? { voice: w === 'full' && was.size ? 'simple' : w, want: w, since: now };
    if (w !== s.want) { s.want = w; s.since = now; }
    if (s.voice !== s.want && (now - s.since >= cfg.hold || s.voice === 'off')) s.voice = s.want;
    was.set(c.id, s); out.set(c.id, s.voice);
  }
  // (no more full voices than allowed, however the holding went: the farthest drop to simple)
  const fulls = [...out].filter(([, v]) => v === 'full').map(([id]) => ({ id, d: cars.find(c => c.id === id).d })).sort((a, b) => a.d - b.d);
  for (const f of fulls.slice(full)) { out.set(f.id, 'simple'); was.get(f.id).voice = 'simple'; }
  for (const id of [...was.keys()]) if (!cars.some(c => c.id === id)) was.delete(id);
  return out;
}

// ---------- surroundings: the echo ----------

// What's round the listener, from rays cast from it (audio/environment.js probe): up (m to a roof, or null), sides
// ([m, …] round it level, null for nothing within reach), what they hit ({ building, tree, ground, other }: how many
// rays). → { tunnel, under, street, open (0..1, summing to 1), width (m between the walls), area: { city, forest } }
export function surroundings(p, cfg) {
  const R = cfg.reverb.probe, sides = p.sides ?? [], hit = sides.filter(d => d != null && d < R.side);
  const roof = p.up != null && p.up < 18 ? 1 - smooth(8, 18, p.up) : 0;
  // walls: both sides close (opposite rays), and how much of the ring is closed
  const n = sides.length, pairs = [];
  for (let i = 0; i < n / 2; i++) { const a = sides[i], b = sides[i + n / 2]; if (a != null && b != null) pairs.push(a + b); }
  const width = pairs.length ? Math.min(...pairs) : null, closed = n ? hit.length / n : 0;
  const walled = width != null ? 1 - smooth(14, 45, width) : 0;
  const tunnel = roof * smooth(0.25, 0.6, closed) * (0.4 + 0.6 * walled);
  const under = roof * (1 - tunnel);
  const street = (1 - roof) * walled * smooth(0.2, 0.5, closed);
  const open = Math.max(0, 1 - tunnel - under - street);
  const H = p.hits ?? {}, total = Math.max(1, n);
  return { tunnel, under, street, open, width, area: { city: Math.min(1, (H.building ?? 0) / total * 2.2), forest: Math.min(1, (H.tree ?? 0) / total * 3) } };
}

// ---------- the bank's sample data ----------

// A loop as the bank keeps it (audio/dsp.js): the samples with `pad` of what comes before and after it each side.
// data: the loop alone (it repeats); or, already padded (an Opus file, made with its pad), { data, pad, len }
export function loopEntry(data, pad = 8) {
  if (data.data) return { data: data.data, start: data.pad, len: data.len };
  const o = new Float32Array(data.length + 2 * pad);
  for (let i = 0; i < pad; i++) { o[i] = data[(data.length - pad + i) % data.length]; o[pad + data.length + i] = data[i % data.length]; }
  o.set(data, pad);
  return { data: o, start: pad, len: data.length };
}
// A sweep and its grains ([[start, len, rpm]] at rate `from`), at the rate the data's at (`sr`)
export function sweepEntry(data, grains, from, sr) {
  const k = sr / from, g = new Float32Array(grains.length * 3);
  grains.forEach(([s, l, r], i) => { g[i * 3] = Math.max(1, s * k); g[i * 3 + 1] = l * k; g[i * 3 + 2] = r; });
  return { data, grains: g };
}
