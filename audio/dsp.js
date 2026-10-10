// The game's sounds made sample by sample (Phase 8 Step 1; docs/AUDIO.md): the code the AudioWorklet runs
// (audio/worklet.js registers it) and, the very same code, what the Node tests render — so what's tested is what
// plays. Nothing here allocates while it plays (no garbage for the audio thread to stop for).
//
//   Bank          the sample data every voice reads: one copy of each engine's loops and sweeps, however many cars
//                 use it (the worklet's scope is shared by all its processors)
//   EngineVoice   an engine — its loops crossfaded by the revs (layers) or its sweep cut into one-cycle grains
//                 (granular) — and round it the exhaust (tone, rasp, pops and crackles), the intake (induction roar,
//                 the turbo's whistle and blow-off, a supercharger's whine), the gearbox (straight-cut whine, the
//                 clunk of a gear), gear changes, the rev limiter, idle, misfires, starting and stalling.
//                 Three outputs: 0 exhaust, 1 intake (the engine bay), 2 gearbox.
//   ChassisVoice  the tyres (scrub as they near the limit, squeal past it, a skid sliding), the road under them
//                 (each surface its own), kerbs, bumps, the brakes and the handbrake, the wind.
//                 Three outputs: 0 tyres, 1 road, 2 wind.
//   Limiter       the master's last stage: a look-ahead peak limiter, so nothing ever goes past its ceiling.
//
// A voice takes its state as messages (set(state), each frame) and eases to it sample by sample (every level and
// pitch glides: nothing steps, so nothing clicks); with no message (a busy frame, the page stalled) it holds what
// it had, so the sound never stops or stutters with the game.

export const BLOCK = 128;
const TAU = Math.PI * 2;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// (the share of the way to a target one sample — or n — goes, for a time constant of tau seconds)
export const ease = (tau, sr, n = 1) => tau > 0 ? 1 - Math.exp(-n / (tau * sr)) : 1;

// Seeded random 0..1 (xorshift32): the same seed, the same sound
export function rng(seed = 1) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
// Which firings a misfiring engine drops: a fixed pattern (testtrack/soundMix.js dropped, the same)
export function dropped(n, share) {
  if (share <= 0) return false;
  let x = Math.imul(n ^ 0x51ed27f, 0x2c1b3c6d); x ^= x >>> 12; x = Math.imul(x, 0x297a2d39); x ^= x >>> 15;
  return (x >>> 0) / 4294967296 < share;
}

// A sine from a table (cheaper than Math.sin, sample by sample): phase in cycles
const SINE_N = 4096, SINE = new Float32Array(SINE_N + 1);
for (let i = 0; i <= SINE_N; i++) SINE[i] = Math.sin(TAU * i / SINE_N);
export function sin1(phase) { const p = (phase - Math.floor(phase)) * SINE_N, i = p | 0; return SINE[i] + (SINE[i + 1] - SINE[i]) * (p - i); }

// A state-variable filter (Simper's trapezoidal one: steady however fast its frequency moves). tick(x) → the low
// pass; .bp the band pass (unit gain at its centre), .hp the high pass.
export class Svf {
  constructor() { this.a1 = 0; this.a2 = 0; this.a3 = 0; this.k = 1; this.z1 = 0; this.z2 = 0; this.bp = 0; this.hp = 0; }
  set(f, q, sr) {
    const g = Math.tan(Math.PI * clamp(f, 10, sr * 0.45) / sr), k = 1 / q;
    this.k = k; this.a1 = 1 / (1 + g * (g + k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
  }
  tick(x) {
    const v3 = x - this.z2, v1 = this.a1 * this.z1 + this.a2 * v3, v2 = this.z2 + this.a2 * this.z1 + this.a3 * v3;
    this.z1 = 2 * v1 - this.z1; this.z2 = 2 * v2 - this.z2;
    this.bp = this.k * v1; this.hp = x - this.k * v1 - v2;
    return v2;
  }
  reset() { this.z1 = this.z2 = 0; }
}

// Read a sample between samples (4-point Hermite): d padded so i − 1 … i + 2 are there
function hermite(d, i, f) {
  const xm = d[i - 1], x0 = d[i], x1 = d[i + 1], x2 = d[i + 2];
  const c1 = 0.5 * (x1 - xm), c2 = xm - 2.5 * x0 + 2 * x1 - 0.5 * x2, c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1);
  return ((c3 * f + c2) * f + c1) * f + x0;
}
function readAt(d, at) {
  const i = Math.floor(at);
  if (i < 1 || i + 2 >= d.length) return 0;
  return hermite(d, i, at - i);
}

// ---------- the bank ----------
// An engine's entry (audio/system.js makes it from its sound config's files):
//   { sr, layers: [{ rpm, on: loop, off: loop }], sweep: { on: sweep, off: sweep } | null, shift: shot | null }
//   loop: { data (Float32Array), start, len }   the loop is data[start … start + len), with a few samples of what
//                                               comes before and after it on each side (so reading across the join
//                                               needs no wrapping); len may be fractional
//   sweep: { data, grains (Float32Array: start, len, rpm for each engine cycle, in samples) }
//   shot: { data }
export class Bank {
  constructor() { this.items = new Map(); }
  add(id, entry) { this.items.set(id, { ...(this.items.get(id) ?? {}), ...entry }); }
  get(id) { return this.items.get(id) ?? null; }
  free(id) { this.items.delete(id); }
  get size() { return this.items.size; }
  get bytes() {
    let n = 0;
    const add = x => { if (x?.data) n += x.data.byteLength; if (x?.grains) n += x.grains.byteLength; };
    for (const e of this.items.values()) { for (const L of e.layers ?? []) { add(L.on); add(L.off); } add(e.sweep?.on); add(e.sweep?.off); add(e.shift); }
    return n;
  }
}

// ---------- the engine ----------

const MAX_LAYERS = 16, MAX_POPS = 8;
// what a voice starts from, and what set(state) can say: rpm; throttle (what the engine gets, 0..1) and pedal (what
// the driver asks for); load (−1 full overrun … 0 … 1 full torque: the torque model's); gear (−1 reverse, 0
// neutral); shifting; clutch (0 out … 1 in); fuelCut (the limiter); misfire (share of firings dropped); spool (the
// turbo, 0..1) and whistle ({ hz, gain, noise, q }, or null); doppler (pitch ×); gain (×)
export const ENGINE_STATE = {
  rpm: 900, throttle: 0, pedal: 0, load: 0, gear: 1, shifting: false, clutch: 1, fuelCut: false, misfire: 0,
  spool: 0, whistle: null, doppler: 1, gain: 1,
};
// what each meter is (EngineVoice.meter: the RMS each put out over the last block)
export const ENGINE_METERS = ['base', 'exhaust', 'intake', 'gearbox', 'pops', 'turbo', 'blowoff', 'supercharger', 'starter'];

export class EngineVoice {
  constructor(bank, sr, seed = 1) {
    this.bank = bank; this.sr = sr; this.rnd = rng(seed);
    this.cfg = null; this.s = { ...ENGINE_STATE }; this.mute = null;
    this.rpm = 0; this.load = 0; this.throttle = 0; this.doppler = 1;
    this.mode = 'run'; this.modeT = 0; this.offBy = null; this.stopFrom = 0; this.lowFor = 0;
    // layers: each loop's playhead and its gains (on, off) at the end of the last block
    this.posOn = new Float64Array(MAX_LAYERS); this.posOff = new Float64Array(MAX_LAYERS);
    this.gOn = new Float32Array(MAX_LAYERS); this.gOff = new Float32Array(MAX_LAYERS);
    this.tOn = new Float32Array(MAX_LAYERS); this.tOff = new Float32Array(MAX_LAYERS);
    for (let i = 0; i < MAX_LAYERS; i++) { this.posOn[i] = this.rnd() * 1000; this.posOff[i] = this.rnd() * 1000; }
    // granular: on and off load, each its grain playing and the one before it fading out
    this.grain = [0, 1].map(() => ({ g: -1, pos: 0, start: 0, len: 1, rpm: 1, pg: -1, ppos: 0, pstart: 0, prpm: 1, fade: 0, fadeLen: 1 }));
    this.gw = new Float32Array(2);
    this.base = new Float32Array(BLOCK);
    // eased levels (each glides sample by sample to where the block's end wants it)
    this.level = 0; this.roar = 0; this.cut = 1; this.lim = 1; this.mis = 1; this.misLeft = 0; this.limPh = 0; this.limitUntil = -1;
    this.whGain = 0; this.whHz = 3000; this.whNoise = 0; this.scGain = 0; this.gbGain = 0;
    this.ex = new Svf(); this.rasp = new Svf(); this.ind = new Svf(); this.air = new Svf(); this.mech = new Svf();
    this.wh = new Svf(); this.bov = new Svf(); this.scn = new Svf(); this.st = new Svf();
    this.phase = 0; this.firing = 0;   // the crank, in firings
    this.wob = 0; this.wobV = 0; this.lopePh = 0;
    this.t = 0;                         // samples played
    this.liftAt = -1e9; this.pedalMax = 0; this.wasShifting = false; this.lastGear = 1; this.bovAt = -1e9;
    this.pops = Array.from({ length: MAX_POPS }, () => ({ left: 0, env: 0, mul: 0, amp: 0, th: 0, thEnv: 0, thMul: 0, thPh: 0, thHz: 0, svf: new Svf() }));
    this.popCount = 0; this.popsLive = 0;   // (pops so far: the tests count them; how many are sounding now)
    this.bovV = { left: 0, n: 0, len: 1, amp: 0, kind: 'valve', hz: 2000, flPh: 0 };
    this.shot = { data: null, pos: 0, gain: 0, rate: 1 };
    this.thump = { left: 0, env: 0, mul: 0, ph: 0, amp: 0, n: 0, lp: 0, lp2: 0 };
    this.whPh = 0; this.scPh = 0; this.gwPh = 0; this.gwPh2 = 0; this.stPh = 0; this.chPh = 0;
    this.meter = new Float32Array(ENGINE_METERS.length);
    this.acc = new Float64Array(ENGINE_METERS.length);
  }

  // cfg: the engine's sound config's mix (audio/system.js engineConfig) and the car's own sound (spec.audio):
  //   { sound (bank id), mode: 'layers' | 'granular', cylinders, idleRpm, redlineRpm, mix, intake, limiter, idle,
  //     pops, start, exhaust, induction, turbo, supercharger, gears, shiftGain, reverseWhine, startOff, mute, lite (another
//     car's: no intake roar, engine bay or gearbox whine — they're not heard from where you are) }
  configure(cfg) {
    const first = !this.cfg;
    this.cfg = cfg; this.mute = cfg.mute ?? null;
    if (first) { this.rpm = cfg.startOff ? 0 : cfg.idleRpm; this.mode = cfg.startOff ? 'off' : 'run'; this.offBy = cfg.startOff ? 'stop' : null; }
  }
  // (the first state before a sound's played: a running engine starts at its revs — another car's voice coming in
  // while it's going — not at idle revving up)
  set(s) { Object.assign(this.s, s); if (!this.t && this.cfg && this.mode === 'run' && +s.rpm > 0) this.rpm = +s.rpm; }
  // 'start' (the starter, then it catches), 'stop' (switched off: it runs down), 'shift' (a gear's clunk now)
  event(e) {
    if (!this.cfg) return;
    if (e === 'start' && this.mode !== 'run' && this.mode !== 'catch') { this.mode = 'crank'; this.modeT = 0; }
    else if (e === 'stop' && this.mode !== 'off') { this.mode = 'stop'; this.modeT = 0; this.stopFrom = Math.max(this.rpm, 1); this.offBy = 'stop'; }
    else if (e === 'shift') this.#clunk();
  }
  get running() { return this.mode === 'run' || this.mode === 'catch'; }
  on(k) { return !this.mute || this.mute[k] !== false; }

  #clunk() {
    const e = this.bank.get(this.cfg.sound);
    if (!e?.shift) return;
    const S = this.shot;
    S.data = e.shift.data; S.pos = 0; S.gain = this.cfg.shiftGain ?? 0.2; S.rate = (e.sr ?? this.sr) / this.sr;
  }
  #pop(amp, big) {
    let v = this.pops[0];
    for (const p of this.pops) { if (p.left <= 0) { v = p; break; } if (p.left < v.left) v = p; }
    if (v.left <= 0) this.popsLive++;
    const sr = this.sr, r = this.rnd, len = (big ? 0.012 : 0.004) + r() * (big ? 0.02 : 0.008);
    v.left = Math.round(sr * len * 6); v.env = 1; v.mul = Math.exp(-1 / (sr * len * 0.45));
    v.amp = amp; v.svf.reset(); v.svf.set(1100 + r() * (big ? 1400 : 2600), 1.3, sr);
    v.th = big ? 1 : 0.35 * r(); v.thEnv = 1; v.thMul = Math.exp(-1 / (sr * (big ? 0.03 : 0.012))); v.thPh = 0; v.thHz = 70 + r() * 90;
    this.popCount++;
  }
  #blowoff(strength) {
    const B = this.cfg.turbo?.blowoff; if (!B) return;
    const v = this.bovV;
    v.len = Math.round(this.sr * (B.seconds ?? 0.45)); v.left = v.len; v.n = 0; v.amp = (B.gain ?? 0.05) * strength; v.kind = B.kind ?? 'valve'; v.hz = B.hz ?? 2200; v.flPh = 0;
    this.bov.reset();
  }

  // outs: [exhaust, intake, gearbox] (Float32Array(n) each, overwritten)
  process(outs, n) {
    const o0 = outs[0], o1 = outs[1], o2 = outs[2];
    o0.fill(0); o1.fill(0); o2.fill(0);
    const c = this.cfg, e = c && this.bank.get(c.sound);
    if (!c || !e) { this.meter.fill(0); return; }
    if (this.base.length < n) this.base = new Float32Array(n);
    const sr = this.sr, s = this.s, M = c.mix, idle = c.idleRpm, red = c.redlineRpm, dt = n / sr, rnd = this.rnd;
    // ---- the state, eased to: the revs (and what starting, stopping or idling does to them), load, throttle ----
    const rpmTarget = Math.max(0, +s.rpm || 0);
    this.load += ((+s.load || 0) - this.load) * ease(0.04, sr, n);
    this.throttle += ((+s.throttle || 0) - this.throttle) * ease(0.025, sr, n);
    this.doppler += ((+s.doppler || 1) - this.doppler) * ease(0.05, sr, n);
    const pedal = +s.pedal || 0;
    this.#modes(rpmTarget, dt);
    const rpm0 = this.rpm;
    let rpm1 = this.#rpmNow(rpmTarget, dt);
    // (idle: a slow wobble in the revs; a cammy engine's lope)
    const idleW = 1 - smooth(idle * 1.08, idle * 1.5, rpm1);
    if (idleW > 0 && c.idle && this.mode === 'run') {
      this.wobV += ((rnd() - 0.5) * 2 - this.wobV) * ease(1 / (TAU * (c.idle.hz ?? 1.5)), sr, n);
      this.wob += (this.wobV - this.wob) * ease(0.25, sr, n);
      this.lopePh += dt * (c.idle.lopeHz ?? 0);
      rpm1 *= 1 + idleW * ((c.idle.wobble ?? 0.012) * this.wob * 3 + (c.idle.lope ?? 0) * sin1(this.lopePh));
    }
    this.rpm = rpm1;
    const loadNow = this.load, onLoad = smooth(M.load[0], M.load[1], loadNow);
    const r = clamp((rpm1 - idle) / (red - idle), 0, 1.3), rn = Math.min(1, r);
    const X = c.exhaust ?? {}, running = this.mode !== 'off' ? 1 : 0, crank = this.mode === 'crank';
    // ---- the engine's level and tone (louder and brighter with the revs and the load; fading out below idle) ----
    const lowFade = crank ? 0.55 : smooth(0.3 * idle, 0.7 * idle, rpm1);
    const levelB = M.level * (M.idleLevel + (1 - M.idleLevel) * r ** M.curve) * (M.offLoadLevel + (1 - M.offLoadLevel) * onLoad) * lowFade * (X.level ?? 1) * running * (+s.gain || 1);
    const toneHz = M.toneHz[0] * (M.toneHz[1] / M.toneHz[0]) ** rn * (0.75 + 0.25 * onLoad) * (X.tone ?? 1) * (0.55 + 0.45 * this.cut);
    this.ex.set(toneHz, 0.7, sr);
    const raspK = clamp((X.rasp ?? 0) * (0.4 + 0.6 * onLoad) * (0.3 + 0.7 * rn), 0, 1);
    this.rasp.set(2200, 0.9, sr);
    // ---- the base: the loops or the grains ----
    const base = this.base;
    base.fill(0, 0, n);
    if (running) {
      if (c.mode === 'granular' && e.sweep) this.#granular(e, base, n, rpm0, rpm1, onLoad);
      else if (e.layers) this.#layers(e, base, n, rpm0, rpm1, onLoad);
    }
    // ---- events: gear changes, the limiter, lifting off, the turbo letting go ----
    const shifting = !!s.shifting, gear = s.gear | 0;
    if (shifting && !this.wasShifting && gear >= this.lastGear && (c.gears?.cut || (X.pops ?? 0) > 0.45) && rpm1 > 0.5 * red && this.on('pops')) this.#pop(0.25 + 0.5 * (X.pops ?? 0), false);
    if (!shifting && this.wasShifting) this.#clunk();
    this.wasShifting = shifting; if (!shifting) this.lastGear = gear;
    if (s.fuelCut) this.limitUntil = this.t + sr * 0.12;
    const limiting = this.t < this.limitUntil && pedal > 0.4;
    this.pedalMax = Math.max(pedal, this.pedalMax * Math.exp(-dt / 0.25));
    if (this.pedalMax > 0.55 && pedal < 0.2) {
      if (this.t - this.liftAt > sr * 0.4) this.liftAt = this.t;
      if ((+s.spool || 0) > 0.35 && this.t - this.bovAt > sr * 0.8 && c.turbo?.blowoff) { this.bovAt = this.t; this.#blowoff(+s.spool); }
      this.pedalMax = 0;
    }
    // ---- what each glides to by the block's end ----
    const W = s.whistle, on = this.mute ? null : true;
    const whB = (W?.gain ?? 0) * running * (on || this.on('turbo') ? 1 : 0), whHzB = W?.hz || this.whHz;
    if (W) this.whNoise = W.noise ?? 0;
    const SC = c.supercharger, scB = SC && (on || this.on('supercharger')) ? (SC.gain ?? 0.05) * (SC.kind === 'centrifugal' ? rn ** 2 * (0.4 + 0.6 * this.throttle) : rn ** 1.3 * (0.35 + 0.65 * this.throttle)) * running : 0;
    const G = c.gears, engaged = gear !== 0 && !shifting && (s.clutch == null ? 1 : +s.clutch) > 0.5;
    const ratios = G?.ratios ?? null, ratio = gear > 0 && ratios ? ratios[Math.min(gear, ratios.length) - 1] : gear < 0 ? 3.2 : 1;
    // (lite: another car's — its intake, engine bay and gearbox aren't heard from where you are)
    const lite = !!c.lite;
    const gbB = lite ? 0 : (gear < 0 ? (c.reverseWhine ?? 0.04) : G ? (G.whine ?? 0) : 0) * (engaged ? 0.25 + 0.75 * Math.min(1, Math.abs(loadNow)) : 0.06) * running * (on || this.on('gearbox') ? 1 : 0);
    const roarB = !lite && (on || this.on('intake')) ? this.#roar(rn, c) * running : 0;
    const teeth = G?.teeth ?? 23, gwF = rpm1 / 60 * teeth * this.doppler / sr, gwF2 = gwF * 0.85 / Math.max(0.4, ratio);
    const I = c.intake, indHz = I ? I.hz[0] * (I.hz[1] / I.hz[0]) ** Math.min(1, rpm1 / red) : 800;
    this.ind.set(indHz, I?.q ?? 0.9, sr); this.air.set(indHz * 1.6, 0.8, sr); this.mech.set(2600, 0.7, sr);
    this.wh.set(Math.max(200, this.whHz) * 0.9 * this.doppler, W?.q ?? 10, sr);
    const scF = SC ? rpm1 / 60 * (SC.ratio ?? 2) * (SC.kind === 'centrifugal' ? 1 : (SC.lobes ?? 4)) * this.doppler / sr : 0;
    if (SC) this.scn.set(scF * sr * 2, 3, sr);
    const cutTarget = shifting ? 0.12 : 1, cutA = ease(0.003, sr), cutR = ease(0.02, sr), sm = ease(0.02, sr);
    const L = c.limiter ?? {}, limHz = L.hz ?? 14, limDepth = L.depth ?? 0.85;
    const firPerSample = rpm1 / 120 * (c.cylinders ?? 4) / sr, share = clamp(+s.misfire || 0, 0, 1);
    const P = X.pops ?? 0, popFrom = c.pops?.fromRpm ?? 0.45 * red, popGain = c.pops?.gain ?? 0.5;
    const sinceLift = (this.t - this.liftAt) / sr;
    const overrun = loadNow < -0.08 && rpm1 > popFrom && this.mode === 'run' ? P * (0.2 + 0.8 * Math.exp(-sinceLift / 1.2)) * smooth(popFrom, red, rpm1) : 0;
    const exOn = on || this.on('exhaust') ? 1 : 0, popsOn = on || this.on('pops') ? 1 : 0;
    const st = c.start ?? {}, crankLen = st.seconds ?? 0.9, crankF = (st.crankRpm ?? 220) / 120 * (c.cylinders ?? 4) / 2 / sr;
    if (crank) this.st.set(1200, 0.8, sr);
    const lvlA = this.level, roarA = this.roar, whA = this.whGain, whHzA = this.whHz;
    this.level = levelB; this.roar = roarB; this.whGain = whB; this.whHz = whHzA + (whHzB - whHzA) * ease(0.03, sr, n);
    // (nothing to hear — the engine off and its last sounds over: the block's silence, nothing worked out)
    if (!running && lvlA < 1e-7 && whA < 1e-6 && roarA < 1e-6 && this.scGain < 1e-6 && this.gbGain < 1e-6 && this.popsLive === 0 && this.bovV.left <= 0 && this.thump.left <= 0 && !this.shot.data) {
      this.t += n; this.modeT += dt; this.meter.fill(0); return;
    }
    const whHz1 = this.whHz, intake = roarA > 1e-6 || roarB > 1e-6, turboOn = on || this.on('turbo') ? 1 : 0;
    const ex = this.ex, rasp = this.rasp, ind = this.ind, air = this.air, mech = this.mech, whf = this.wh, scn = this.scn, pops = this.pops, B = this.bovV, T = this.thump, S = this.shot;
    // (what changes sample by sample, kept here and put back after)
    let cut = this.cut, lim = this.lim, mis = this.mis, misLeft = this.misLeft, limPh = this.limPh, phase = this.phase, firing = this.firing;
    let scGain = this.scGain, gbGain = this.gbGain, whPh = this.whPh, scPh = this.scPh, gwPh = this.gwPh, gwPh2 = this.gwPh2, chPh = this.chPh, stPh = this.stPh;
    let a0 = 0, a1 = 0, a2 = 0, a3 = 0, a4 = 0, a5 = 0, a6 = 0, a7 = 0, a8 = 0;
    const dK = 1 + 5 * raspK, raspOn = raspK > 0.002, mechOn = !lite && exOn && levelB > 1e-6;
    // ---- sample by sample ----
    for (let i = 0; i < n; i++) {
      const k = (i + 1) / n, lvl = lvlA + (levelB - lvlA) * k;
      // the gear change's cut, the limiter's bounce, a dropped firing
      cut += (cutTarget - cut) * (cutTarget < cut ? cutA : cutR);
      if (limiting) {
        limPh += limHz / sr;
        const q = 0.5 - 0.5 * Math.cos(TAU * limPh), sq = q < 1 / 3 ? 0 : q > 2 / 3 ? 1 : (q - 0.5) * 3 + 0.5;
        lim += (1 - limDepth * sq - lim) * 0.02;
        if (limPh >= 1) { limPh -= 1; if (P > 0.3 && popsOn && rnd() < 0.5 * P) this.#pop(0.2 + 0.4 * P, rnd() < 0.3); }
      } else if (lim < 1) lim += (1 - lim) * 0.003;
      phase += firPerSample;
      if (phase >= 1) {
        phase -= 1; firing++;
        if (share > 0 && dropped(firing, share)) { misLeft = Math.round(1 / Math.max(firPerSample, 1e-4)); if (popsOn && rnd() < 0.25) this.#pop(0.15 + 0.2 * share, false); }
        if (overrun > 0 && popsOn && rnd() < overrun * 0.22) { const big = rnd() < 0.15 * P; this.#pop((0.3 + 0.7 * rnd()) * popGain * Math.sqrt(P) * (big ? 2.2 : 1), big); }
      }
      if (misLeft > 0) { misLeft--; mis += (0.25 - mis) * 0.03; } else if (mis < 1) mis += (1 - mis) * 0.03;
      let b = base[i];
      // cranking: the engine turned by the starter, a chug each compression
      if (crank) { chPh += crankF; const ch = Math.max(0, sin1(chPh)); b *= 0.25 + 0.75 * ch * ch; }
      a0 += b * b;
      // the exhaust: its tone, its rasp, its level
      let x = ex.tick(b);
      if (raspOn) { const y = x * dK / (1 + Math.abs(x * dK)) * (1 + 0.6 * raspK); rasp.tick(y); x = x + (y - x) * raspK + rasp.bp * raspK * 0.9; }
      const env = lvl * cut * lim * mis;
      let eo = x * env * exOn;
      // pops and crackles
      let pop = 0;
      if (this.popsLive > 0) {
        for (let p = 0; p < MAX_POPS; p++) {
          const v = pops[p];
          if (v.left <= 0) continue;
          if (--v.left === 0) this.popsLive--;
          v.env *= v.mul; v.thEnv *= v.thMul; v.thPh += v.thHz / sr;
          v.svf.tick((rnd() * 2 - 1) * v.env);
          pop += v.amp * (v.svf.bp * 2.2 + v.th * v.thEnv * sin1(v.thPh));
        }
        eo += pop * popsOn;
      }
      // the intake: induction roar (the engine's sound through the intake's resonance) and the air's rush, pulsing
      // with the firings; the engine bay's mechanical clatter
      let inn = 0;
      if (intake) { const roar = roarA + (roarB - roarA) * k; ind.tick(b); air.tick(rnd() * 2 - 1); inn = (ind.bp * 1.6 + air.bp * 0.5 * (0.55 + 0.45 * sin1(phase))) * roar * cut * mis * exOn; }
      if (mechOn) { mech.tick(b); inn += mech.hp * 0.07 * env; }
      // the turbo: its whistle, and the blow-off valve (or a flutter) when the throttle shuts
      let tu = 0;
      const wg = whA + (whB - whA) * k;
      if (wg > 1e-6) {
        whPh += (whHzA + (whHz1 - whHzA) * k) * this.doppler / sr;
        const w = whPh - Math.floor(whPh), tri = w < 0.5 ? 4 * w - 1 : 3 - 4 * w;
        whf.tick(rnd() * 2 - 1);
        tu = wg * (sin1(whPh) + 0.15 * tri + whf.bp * this.whNoise * 1.6);
      }
      let bo = 0;
      if (B.left > 0) {
        const t = B.n / sr, att = Math.min(1, B.n / (sr * 0.004)), tail = Math.exp(-B.n / (B.len * 0.4));
        if (B.kind === 'flutter') { B.flPh += (22 - 12 * Math.min(1, B.n / B.len)) / sr; if ((B.n & 63) === 0) this.bov.set(B.hz * 0.45, 2.5, sr); this.bov.tick(rnd() * 2 - 1); const a = Math.max(0, sin1(B.flPh)); bo = this.bov.bp * a * a * a * 2.5; }
        else { if ((B.n & 31) === 0) this.bov.set(B.hz * (1.25 - 0.55 * Math.min(1, t / (B.len / sr))), 1.2, sr); this.bov.tick(rnd() * 2 - 1); bo = this.bov.bp * 1.8; }
        bo *= B.amp * att * tail * turboOn; B.left--; B.n++;
      }
      // a supercharger: its rotors' whine, with some grit round it
      let wh = 0;
      if (scB > 1e-6 || scGain > 1e-6) {
        scGain += (scB - scGain) * sm; scPh += scF;
        scn.tick(rnd() * 2 - 1);
        wh = scGain * (SC.kind === 'centrifugal' ? sin1(scPh) + 0.15 * sin1(scPh * 2) : sin1(scPh) + 0.5 * sin1(scPh * 2) + 0.3 * sin1(scPh * 3) + scn.bp * 0.5);
      }
      // the starter motor
      let sm2 = 0;
      if (crank) {
        const ct = this.modeT + i / sr;
        stPh += (150 + 50 * Math.min(1, ct / crankLen)) / sr;
        this.st.tick(rnd() * 2 - 1);
        const ramp = Math.min(1, ct / 0.03) * Math.min(1, (crankLen - ct) / 0.05 + 0.02);
        sm2 = (st.gain ?? 0.16) * ramp * (sin1(stPh) * 0.6 + sin1(stPh * 2) * 0.3 + sin1(stPh * 3) * 0.15 + this.st.bp * 0.4);
      }
      // the run-down's last shudder
      let sh = 0;
      if (T.left > 0) { T.left--; T.n++; T.env *= T.mul; T.ph += 36 / sr; T.lp += ((rnd() * 2 - 1) - T.lp) * 0.02; T.lp2 += (T.lp - T.lp2) * 0.02; sh = T.amp * T.env * Math.min(1, T.n / (sr * 0.004)) * (sin1(T.ph) + T.lp2 * 4); }
      inn += tu + bo + wh + sm2 + sh;
      o0[i] = eo + sh * 0.6; o1[i] = inn;
      // the gearbox: straight-cut gears whining (the constant mesh and the gear it's in), a gear's clunk
      let gb = 0;
      if (gbB > 1e-6 || gbGain > 1e-6) { gbGain += (gbB - gbGain) * sm; gwPh += gwF; gwPh2 += gwF2; gb = gbGain * (sin1(gwPh) * 0.6 + sin1(gwPh2) + 0.25 * sin1(gwPh2 * 2)); }
      if (S.data) { if (S.pos + 4 >= S.data.length) S.data = null; else { gb += S.gain * readAt(S.data, S.pos + 1); S.pos += S.rate; } }
      o2[i] = gb;
      a1 += eo * eo; a2 += inn * inn; a3 += gb * gb; a4 += pop * pop; a5 += tu * tu; a6 += bo * bo; a7 += wh * wh; a8 += sm2 * sm2;
    }
    this.cut = cut; this.lim = lim; this.mis = mis; this.misLeft = misLeft; this.limPh = limPh; this.phase = phase; this.firing = firing;
    this.scGain = scGain; this.gbGain = gbGain; this.whPh = whPh; this.scPh = scPh; this.gwPh = gwPh; this.gwPh2 = gwPh2; this.chPh = chPh; this.stPh = stPh;
    const acc = this.acc;
    acc[0] = a0; acc[1] = a1; acc[2] = a2; acc[3] = a3; acc[4] = a4; acc[5] = a5; acc[6] = a6; acc[7] = a7; acc[8] = a8;
    this.t += n; this.modeT += dt;
    for (let m = 0; m < acc.length; m++) this.meter[m] = Math.sqrt(acc[m] / n);
  }

  // the intake's roar at this throttle and these revs (the engine sound config's intake, × the parts' roar)
  #roar(rn, c) {
    const I = c.intake; if (!I) return 0;
    return I.gain * smooth(I.throttle[0], I.throttle[1], this.throttle) * (0.3 + 0.7 * rn) * (c.induction?.roar ?? 1);
  }

  // starting, running, stopping: which, and how long it's been
  #modes(rpmTarget, dt) {
    const c = this.cfg, idle = c.idleRpm;
    if (this.mode === 'run') {
      // (the physics' revs falling away below idle: a stall — a blown engine, or a car that's been stopped)
      this.lowFor = rpmTarget < 0.4 * idle ? this.lowFor + dt : 0;
      if (this.lowFor > 0.08) { this.mode = 'stop'; this.modeT = 0; this.stopFrom = Math.max(this.rpm, 1); this.offBy = 'stall'; this.lowFor = 0; }
    } else if (this.mode === 'crank' && this.modeT >= (c.start?.seconds ?? 0.9)) { this.mode = 'catch'; this.modeT = 0; }
    else if (this.mode === 'catch' && this.modeT >= 1.6) this.mode = 'run';
    else if (this.mode === 'off' && this.offBy === 'stall' && rpmTarget > 0.7 * idle) { this.mode = 'crank'; this.modeT = 0; }
  }
  #rpmNow(rpmTarget, dt) {
    const c = this.cfg, idle = c.idleRpm, sr = this.sr;
    if (this.mode === 'crank') return (c.start?.crankRpm ?? 220) * (0.92 + 0.08 * Math.sin(this.modeT * 9));
    if (this.mode === 'catch') { const t = this.modeT, flare = idle * ((c.start?.flare ?? 1.7) - 1) * (t < 0.12 ? t / 0.12 : Math.exp(-(t - 0.12) / 0.45)); return Math.max(rpmTarget, idle + flare); }
    if (this.mode === 'stop') {
      const own = this.stopFrom * Math.exp(-this.modeT / 0.28), rpm = this.offBy === 'stall' ? Math.min(own, Math.max(rpmTarget, own * 0.5)) : own;
      // (at the end a shudder)
      if (rpm < 0.22 * idle) { this.mode = 'off'; const T = this.thump; T.left = Math.round(sr * 0.9); T.env = 1; T.mul = Math.exp(-1 / (sr * 0.09)); T.amp = 0.35; T.ph = 0; T.n = 0; T.lp = 0; T.lp2 = 0; }
      return rpm;
    }
    if (this.mode === 'off') return 0;
    return this.rpm + (rpmTarget - this.rpm) * ease(0.012, sr, dt * sr);
  }

  // Layers: the two loops nearest the revs (log rpm), crossfaded with equal power over the middle `blend` of the gap;
  // on and off load the same way; each played at rpm ÷ its own rpm (within ±maxShift). Each loop's gain moves from
  // where it was at the last block's end to where it is now, sample by sample.
  #layers(e, out, n, rpmA, rpmB, onLoad) {
    const c = this.cfg, Ls = e.layers, N = Math.min(Ls.length, MAX_LAYERS), M = c.mix, blend = M.blend ?? 1;
    const tOn = this.tOn, tOff = this.tOff;
    tOn.fill(0); tOff.fill(0);
    const rpm = Math.max(rpmB, 1);
    if (rpm <= Ls[0].rpm) tOn[0] = 1;
    else if (rpm >= Ls[N - 1].rpm) tOn[N - 1] = 1;
    else {
      let i = 0;
      while (i < N - 2 && rpm >= Ls[i + 1].rpm) i++;
      const x = Math.log(rpm / Ls[i].rpm) / Math.log(Ls[i + 1].rpm / Ls[i].rpm), y = clamp((x - (1 - blend) / 2) / blend, 0, 1);
      tOn[i] = Math.cos(y * Math.PI / 2); tOn[i + 1] = Math.sin(y * Math.PI / 2);
    }
    const lOn = Math.sin(onLoad * Math.PI / 2), lOff = Math.cos(onLoad * Math.PI / 2);
    for (let i = 0; i < N; i++) { tOff[i] = tOn[i] * lOff; tOn[i] *= lOn; }
    const srcK = (e.sr ?? this.sr) / this.sr * this.doppler, m = M.maxShift;
    for (let i = 0; i < N; i++) {
      for (let side = 0; side < 2; side++) {
        const g0 = side ? this.gOff[i] : this.gOn[i], g1 = side ? tOff[i] : tOn[i];
        if (g0 < 1e-5 && g1 < 1e-5) continue;
        const loop = side ? Ls[i].off : Ls[i].on, d = loop.data, st = loop.start, len = loop.len;
        let pos = side ? this.posOff[i] : this.posOn[i];
        pos -= Math.floor(pos / len) * len;
        const rA = clamp(Math.max(rpmA, 1) / Ls[i].rpm, 1 - m, 1 + m) * srcK, rB = clamp(rpm / Ls[i].rpm, 1 - m, 1 + m) * srcK;
        for (let k = 0; k < n; k++) {
          const f = (k + 1) / n, at = st + pos, j = at | 0;
          out[k] += (g0 + (g1 - g0) * f) * hermite(d, j, at - j);
          pos += rA + (rB - rA) * f;
          if (pos >= len) pos -= len;
        }
        if (side) this.posOff[i] = pos; else this.posOn[i] = pos;
      }
    }
    this.gOn.set(tOn); this.gOff.set(tOff);
  }

  // Granular: the sweep (the engine run from idle to past the redline, every engine cycle marked) cut into one-cycle
  // grains; each cycle plays the grain recorded nearest these revs (one of the nearest few, so a steady engine
  // doesn't repeat itself), stretched to the cycle's length now, crossfaded over its first tenth with the last one
  // running on. On and off load are two such streams, mixed by the load with equal power.
  #granular(e, out, n, rpmA, rpmB, onLoad) {
    const sr = this.sr, srcK = (e.sr ?? sr) / sr, lOn = Math.sin(onLoad * Math.PI / 2), lOff = Math.cos(onLoad * Math.PI / 2);
    for (let side = 0; side < 2; side++) {
      const sw = side ? e.sweep.off : e.sweep.on, d = sw.data, G = sw.grains, NG = G.length / 3;
      const w0 = this.gw[side], w1 = side ? lOff : lOn, st = this.grain[side];
      this.gw[side] = w1;
      if (w0 < 1e-5 && w1 < 1e-5) { st.g = -1; continue; }
      for (let k = 0; k < n; k++) {
        const f = (k + 1) / n, rpm = Math.max(40, rpmA + (rpmB - rpmA) * f), g = w0 + (w1 - w0) * f;
        if (st.g < 0 || st.pos >= st.len) {
          // the next cycle: the grain nearest these revs, give or take one
          let lo = 0, hi = NG - 2;
          while (lo < hi) { const mid = (lo + hi) >> 1; if (G[mid * 3 + 2] < rpm) lo = mid + 1; else hi = mid; }
          let gi = clamp(lo + Math.round((this.rnd() - 0.5) * 2.2), 0, NG - 2);
          if (gi === st.g && NG > 3) gi = clamp(gi + (this.rnd() < 0.5 ? -1 : 1), 0, NG - 2);
          st.pg = st.g; st.pstart = st.start; st.ppos = st.pos; st.prpm = st.rpm;
          st.g = gi; st.start = G[gi * 3]; st.len = G[gi * 3 + 1]; st.rpm = G[gi * 3 + 2]; st.pos = 0;
          st.fadeLen = clamp(Math.round(0.12 * sr * 120 / rpm), 32, 1500); st.fade = st.pg >= 0 ? st.fadeLen : 0;
        }
        let v = readAt(d, st.start + st.pos);
        if (st.fade > 0) {
          const x = st.fade / st.fadeLen;
          v = v * (1 - x) + readAt(d, st.pstart + st.ppos) * x;
          st.ppos += srcK * rpm / st.prpm * this.doppler; st.fade--;
        }
        st.pos += srcK * rpm / st.rpm * this.doppler;
        out[k] += g * v;
      }
    }
  }
}

// ---------- the tyres, the road and the wind ----------

// the road's surfaces, in the order a state's `surf` weights come
export const SURFACES = ['tarmac', 'concrete', 'cobbles', 'gravel', 'dirt', 'grass', 'sand'];
// speed m/s; scrub, squeal, skid 0..1 and pitch 0..1 (the tyres: audio/mix.js tyreSound); surf: weights for each of
// SURFACES (0..1, by the wheels on it); kerb 0..1 and kerbHz (its stripes going by); wet 0..1; brake 0..1 (squeal);
// wind 0..1; doppler; gain
export const CHASSIS_STATE = { speed: 0, scrub: 0, squeal: 0, skid: 0, pitch: 0, surf: null, kerb: 0, kerbHz: 20, wet: 0, brake: 0, wind: 0, doppler: 1, gain: 1 };
export const CHASSIS_METERS = ['tyres', 'road', 'wind', 'squeal', 'surface', 'brakes'];
const CG = ['scrub', 'squeal', 'skid', 'road', 'wet', 'kerb', 'brake', 'wind'];

export class ChassisVoice {
  constructor(sr, seed = 2) {
    this.sr = sr; this.rnd = rng(seed); this.s = { ...CHASSIS_STATE }; this.mute = null; this.lite = false;
    this.surf = new Float32Array(SURFACES.length);
    this.gA = new Float32Array(CG.length); this.gB = new Float32Array(CG.length); this.want = new Float32Array(CG.length);   // each level: last block's end, this one's
    this.f = {};
    for (const k of ['sqA', 'sqB', 'sqT', 'skid', 'scrub', 'road', 'cob', 'grav', 'dirt', 'grass', 'sand', 'wet', 'kerb', 'wind', 'click']) this.f[k] = new Svf();
    this.p0 = 0; this.p1 = 0; this.p2 = 0; this.brown = 0;
    // (the noise's generators, xorshift in an int: seeded from the voice's own)
    this.rs = (this.rnd() * 4294967295) | 0 || 1; this.rt = (this.rnd() * 4294967295) | 0 || 7; this.rr = (this.rnd() * 4294967295) | 0 || 13;
    this.nW = new Float32Array(BLOCK); this.nP = new Float32Array(BLOCK); this.nB = new Float32Array(BLOCK);
    this.sqPh = 0; this.wobPh = 0; this.wobN = 0; this.rough = 0; this.kerbPh = 0; this.brPh = 0; this.brDrift = 0; this.cobPh = 0; this.cobA = 0;
    this.jointPh = 0; this.gust = 1; this.gustV = 1; this.crunch = 0;
    this.thumps = Array.from({ length: 4 }, () => ({ left: 0, env: 0, mul: 0, ph: 0, hz: 70, amp: 0 }));
    this.clicks = { left: 0, next: 0, n: 0 };
    this.meter = new Float32Array(CHASSIS_METERS.length); this.acc = new Float64Array(CHASSIS_METERS.length);
  }
  set(s) { Object.assign(this.s, s); if (s.surf) for (let i = 0; i < SURFACES.length; i++) this.surf[i] = s.surf[i] ?? 0; }
  // c.lite: another car's — heard from outside and further off: no scrub, one band of the squeal's noise, no wet
  // hiss, no brakes, no wind (its squeal, its skid and its rolling are what carry)
  configure(c) { this.mute = c?.mute ?? null; this.lite = !!c?.lite; }
  on(k) { return !this.mute || this.mute[k] !== false; }
  // 'thump' (a bump through the suspension: strength 0..1), 'handbrake' (its ratchet)
  event(e, strength = 1) {
    if (e === 'thump') {
      if (!this.on('road')) return;
      let v = this.thumps[0];
      for (const t of this.thumps) { if (t.left <= 0) { v = t; break; } if (t.env < v.env) v = t; }
      v.left = Math.round(this.sr * 0.25); v.env = 1; v.mul = Math.exp(-1 / (this.sr * 0.05)); v.ph = 0; v.hz = 55 + 30 * this.rnd(); v.amp = 0.5 * clamp(strength, 0, 1.5);
    } else if (e === 'handbrake') { this.clicks.left = 7; this.clicks.next = 0; this.clicks.n = 0; }
  }

  process(outs, n) {
    const o0 = outs[0], o1 = outs[1], o2 = outs[2];
    const sr = this.sr, s = this.s, rnd = this.rnd, v = Math.abs(+s.speed || 0), dop = +s.doppler || 1, gain = +s.gain || 1;
    const a = ease(0.04, sr, n), A = this.gA, B = this.gB, S = this.surf, F = this.f;
    // ---- each level's target for the block's end ----
    A.set(B);
    const ty = this.on('tyres') ? 1 : 0, ro = this.on('road') ? 1 : 0, T = this.want, full = this.lite ? 0 : 1;
    T[0] = (+s.scrub || 0) * 0.09 * ty * full; T[1] = (+s.squeal || 0) * 0.32 * ty; T[2] = (+s.skid || 0) * 0.22 * ty;
    T[3] = Math.min((v / 30) ** 1.3 * 0.11, 0.22) * ro; T[4] = (+s.wet || 0) * Math.min(1, v / 25) ** 1.5 * 0.12 * ro * full;
    T[5] = (+s.kerb || 0) * 0.24 * ro; T[6] = (+s.brake || 0) * 0.05 * (this.on('brakes') ? 1 : 0) * full; T[7] = (+s.wind || 0) * 0.3 * (this.on('wind') ? 1 : 0) * full;
    for (let k = 0; k < CG.length; k++) B[k] = A[k] + (T[k] - A[k]) * a;
    const pitch = clamp(+s.pitch || 0, 0, 1), sqHz = (650 + pitch * 450) * dop;
    if (B[1] > 1e-6 || A[1] > 1e-6) { F.sqA.set(sqHz, 9, sr); F.sqB.set(sqHz * 1.9, 7, sr); F.sqT.set(sqHz * 1.6, 4, sr); }
    F.skid.set(900 * dop, 0.8, sr); F.scrub.set((320 + v * 4) * dop, 1.2, sr);
    const tar = S[0] + S[1], cob = S[2], grav = S[3], dirt = S[4], grass = S[5], sand = S[6];
    F.road.set((160 + v * 14) * (1 + 0.4 * (S[1] / Math.max(tar, 1e-3))) * dop, 0.6, sr);
    F.cob.set(420, 0.7, sr); F.grav.set(1500, 1.1, sr); F.dirt.set(300, 0.6, sr); F.grass.set(700, 0.5, sr); F.sand.set(1600, 0.7, sr);
    F.wet.set(3600, 0.6, sr); F.kerb.set(240, 1.2, sr); F.wind.set((350 + Math.min(1400, v * 22)) * dop, 0.5, sr); F.click.set(3500, 2, sr);
    this.gustV += ((0.7 + 0.3 * rnd()) - this.gustV) * ease(0.6, sr, n);
    const gust0 = this.gust; this.gust += (this.gustV - this.gust) * ease(0.3, sr, n);
    const kerbF = Math.max(6, +s.kerbHz || 20) / sr, cobRate = v / 0.18 / sr, jointRate = S[1] > 0.05 ? v / 4.5 / sr : 0;
    const crunchRate = (grav + dirt * 0.4) * (v * 5 + 30 * (+s.skid || 0)) / sr, roadOn = this.on('road') ? 1 : 0;
    // (nothing to hear — standing still, nothing ringing: the block's silence, nothing worked out)
    let quiet = !(crunchRate > 0 && v > 0.3) && this.clicks.left <= 0 && this.clicks.n <= 0;
    for (let k = 0; quiet && k < CG.length; k++) if (A[k] > 1e-6 || B[k] > 1e-6) quiet = false;
    for (let t = 0; quiet && t < 4; t++) if (this.thumps[t].left > 0) quiet = false;
    if (quiet) { o0.fill(0, 0, n); o1.fill(0, 0, n); o2.fill(0, 0, n); this.meter.fill(0); return; }
    // (each part its own pass over the block, the noise first: small loops the JIT works out whole, with the state
    // in locals — one big loop calling out sample by sample cost several times as much)
    if (this.nW.length < n) { this.nW = new Float32Array(n); this.nP = new Float32Array(n); this.nB = new Float32Array(n); }
    this.#noise(n);
    const acc = this.acc;
    acc.fill(0);
    this.#tyres(o0, n, A, B, sqHz, full);
    this.#road(o1, n, A, B, v, tar, cob, dirt, grass, sand, grav, kerbF, cobRate, jointRate, crunchRate, roadOn);
    this.#wind(o2, n, A, B, gust0);
    if (gain !== 1) for (let i = 0; i < n; i++) { o0[i] *= gain; o1[i] *= gain; o2[i] *= gain; }
    let a0 = 0, a1 = 0, a2 = 0;
    for (let i = 0; i < n; i++) { a0 += o0[i] * o0[i]; a1 += o1[i] * o1[i]; a2 += o2[i] * o2[i]; }
    acc[0] = a0; acc[1] = a1; acc[2] = a2;
    for (let m = 0; m < acc.length; m++) this.meter[m] = Math.sqrt(acc[m] / n);
  }

  // white noise (xorshift, in a local), a pink-ish and a brown from it
  #noise(n) {
    const W = this.nW, P = this.nP, Br = this.nB;
    let r = this.rs, p0 = this.p0, p1 = this.p1, p2 = this.p2, brown = this.brown;
    for (let i = 0; i < n; i++) {
      r ^= r << 13; r ^= r >>> 17; r ^= r << 5;
      const w = r * 4.656612873077393e-10;
      p0 = 0.99765 * p0 + w * 0.099; p1 = 0.963 * p1 + w * 0.2965; p2 = 0.57 * p2 + w * 1.0527;
      brown = brown * 0.985 + w * 0.06;
      W[i] = w; P[i] = (p0 + p1 + p2 + w * 0.1848) * 0.2; Br[i] = brown;
    }
    this.rs = r; this.p0 = p0; this.p1 = p1; this.p2 = p2; this.brown = brown;
  }

  // the tyres: scrub (working hard, near the limit), squeal (past it), a skid (sliding)
  #tyres(out, n, A, B, sqHz, full) {
    const gs0 = A[0], gs1 = B[0], gq0 = A[1], gq1 = B[1], gk0 = A[2], gk1 = B[2];
    const scrub = gs0 > 1e-6 || gs1 > 1e-6, squeal = gq0 > 1e-6 || gq1 > 1e-6, skid = gk0 > 1e-6 || gk1 > 1e-6;
    const sr = this.sr, W = this.nW, P = this.nP, F = this.f;
    this.wobPh += 9 * n / sr;
    if (!scrub && !squeal && !skid) { out.fill(0, 0, n); return; }
    const fs = F.scrub, fk = F.skid, fA = F.sqA, fB = F.sqB, fT = F.sqT;
    // (the band-passes written out — Svf.tick in locals)
    let s1 = fs.z1, s2 = fs.z2, k1 = fk.z1, k2 = fk.z2, qA1 = fA.z1, qA2 = fA.z2, qB1 = fB.z1, qB2 = fB.z2, qT1 = fT.z1, qT2 = fT.z2;
    let r = this.rt, wobPh = this.wobPh - 9 * n / sr, wobN = this.wobN, sqPh = this.sqPh, rough = this.rough, a3 = 0;
    const wob = 9 / sr, sqK = sqHz / sr, kA = fA.k * (full ? 1.6 : 2), kB = fB.k * 0.7, kT = fT.k * 0.5, ks = fs.k * 2, kk = fk.k;
    for (let i = 0; i < n; i++) {
      const f = (i + 1) / n, w = W[i];
      let ty = 0, v3, v1, v2;
      if (scrub) {
        const x = P[i]; v3 = x - s2; v1 = fs.a1 * s1 + fs.a2 * v3; v2 = s2 + fs.a2 * s1 + fs.a3 * v3; s1 = 2 * v1 - s1; s2 = 2 * v2 - s2;
        ty += v1 * ks * (gs0 + (gs1 - gs0) * f);
      }
      wobPh += wob;
      if (squeal) {
        r ^= r << 13; r ^= r >>> 17; r ^= r << 5;
        wobN += (r * 2.3283064365386963e-10 - wobN) * 0.002;
        sqPh += sqK * (0.94 + 0.04 * sin1(wobPh) + 0.25 * wobN);
        if (sqPh >= 1) sqPh -= Math.floor(sqPh);
        v3 = w - qA2; v1 = fA.a1 * qA1 + fA.a2 * v3; v2 = qA2 + fA.a2 * qA1 + fA.a3 * v3; qA1 = 2 * v1 - qA1; qA2 = 2 * v2 - qA2;
        let sq = v1 * kA;
        if (full) { v3 = w - qB2; v1 = fB.a1 * qB1 + fB.a2 * v3; v2 = qB2 + fB.a2 * qB1 + fB.a3 * v3; qB1 = 2 * v1 - qB1; qB2 = 2 * v2 - qB2; sq += v1 * kB; }
        v3 = 2 * sqPh - 1 - qT2; v1 = fT.a1 * qT1 + fT.a2 * v3; v2 = qT2 + fT.a2 * qT1 + fT.a3 * v3; qT1 = 2 * v1 - qT1; qT2 = 2 * v2 - qT2;
        sq = (sq + v1 * kT) * (gq0 + (gq1 - gq0) * f);
        ty += sq; a3 += sq * sq;
      }
      if (skid) {
        r ^= r << 13; r ^= r >>> 17; r ^= r << 5;
        const u = (r >>> 0) * 2.3283064365386963e-10;
        rough += ((u < 0.02 ? u * 50 : rough * 0.999) - rough) * 0.05;
        v3 = w - k2; v1 = fk.a1 * k1 + fk.a2 * v3; v2 = k2 + fk.a2 * k1 + fk.a3 * v3; k1 = 2 * v1 - k1; k2 = 2 * v2 - k2;
        ty += v1 * kk * (gk0 + (gk1 - gk0) * f) * (0.5 + rough);
      }
      out[i] = ty;
    }
    fs.z1 = s1; fs.z2 = s2; fk.z1 = k1; fk.z2 = k2; fA.z1 = qA1; fA.z2 = qA2; fB.z1 = qB1; fB.z2 = qB2; fT.z1 = qT1; fT.z2 = qT2;
    this.rt = r; this.wobN = wobN; this.sqPh = sqPh; this.rough = rough;
    this.acc[3] = a3;
  }

  // the road: rolling on each surface, gravel's crunch, the wet, a kerb's stripes, bumps; the brakes squealing at low
  // speed and the handbrake's ratchet
  #road(out, n, A, B, v, tar, cob, dirt, grass, sand, grav, kerbF, cobRate, jointRate, crunchRate, roadOn) {
    const sr = this.sr, W = this.nW, P = this.nP, Br = this.nB, F = this.f, rnd = this.rnd, S = this.surf, thumps = this.thumps, C = this.clicks;
    const gr0 = A[3], gr1 = B[3], gw0 = A[4], gw1 = B[4], gb0 = A[5], gb1 = B[5], gB0 = A[6], gB1 = B[6];
    const rolling = gr0 > 1e-6 || gr1 > 1e-6, wet = gw0 > 1e-6 || gw1 > 1e-6, kerb = gb0 > 1e-6 || gb1 > 1e-6, brakes = gB0 > 1e-6 || gB1 > 1e-6, crunching = crunchRate > 0 && v > 0.3;
    const fR = F.road, fCob = F.cob, fDirt = F.dirt, fGrass = F.grass, fSand = F.sand, fGrav = F.grav, fWet = F.wet, fKerb = F.kerb, fClick = F.click;
    let rd1 = fR.z1, rd2 = fR.z2, cobPh = this.cobPh, cobA = this.cobA, jointPh = this.jointPh, crunch = this.crunch, kerbPh = this.kerbPh, brPh = this.brPh, brDrift = this.brDrift;
    let r = this.rr, a4 = 0, a5 = 0;
    const wob0 = this.wobPh - 9 * n / sr, wob = 9 / sr, tarK = tar * 2.2;
    for (let i = 0; i < n; i++) {
      const f = (i + 1) / n, w = W[i];
      let rd = 0;
      if (rolling) {
        const gr = gr0 + (gr1 - gr0) * f, x = P[i];
        const v3 = x - rd2, v1 = fR.a1 * rd1 + fR.a2 * v3, v2 = rd2 + fR.a2 * rd1 + fR.a3 * v3; rd1 = 2 * v1 - rd1; rd2 = 2 * v2 - rd2;
        rd += v2 * gr * tarK;
        if (cob > 0.01) { cobPh += cobRate; if (cobPh >= 1) { cobPh -= 1; cobA = 0.4 + 0.6 * rnd(); } cobA *= 0.995; rd += fCob.tick(w * cobA) * gr * cob * 3; }
        if (dirt > 0.01) rd += fDirt.tick(Br[i] * 2) * gr * dirt * 3;
        if (grass > 0.01) rd += fGrass.tick(x) * gr * grass * (0.8 + 0.2 * sin1((wob0 + wob * (i + 1)) * 0.3)) * 1.6;
        if (sand > 0.01) { fSand.tick(w); rd += fSand.bp * gr * sand * 1.2; }
        if (jointRate > 0) { jointPh += jointRate; if (jointPh >= 1) { jointPh -= 1; this.event('thump', 0.25 * S[1]); } }
      }
      if (crunching) {
        crunch *= 0.993;
        r ^= r << 13; r ^= r >>> 17; r ^= r << 5;
        if ((r >>> 0) * 2.3283064365386963e-10 < crunchRate) crunch = 0.4 + 0.6 * rnd();
        fGrav.tick(w * crunch); rd += fGrav.bp * (grav + dirt * 0.5) * 0.35 * roadOn;
      }
      if (wet) { fWet.tick(w); rd += fWet.hp * (gw0 + (gw1 - gw0) * f); }
      if (kerb) { kerbPh += kerbF; rd += fKerb.tick(kerbPh - Math.floor(kerbPh) < 0.5 ? 1 : -1) * (gb0 + (gb1 - gb0) * f); }
      for (let t = 0; t < 4; t++) { const T = thumps[t]; if (T.left <= 0) continue; T.left--; T.env *= T.mul; T.ph += T.hz / sr; rd += T.amp * T.env * (sin1(T.ph) + 0.2 * w * T.env); }
      a4 += rd * rd;
      let br = 0;
      if (brakes) {
        r ^= r << 13; r ^= r >>> 17; r ^= r << 5;
        brDrift += (r * 2.3283064365386963e-10 - brDrift) * 0.0005; brPh += (3400 + 600 * brDrift) / sr;
        br = (gB0 + (gB1 - gB0) * f) * sin1(brPh) * (0.7 + 0.3 * sin1((wob0 + wob * (i + 1)) * 0.7));
      }
      if (C.left > 0 || C.n > 0) { if (C.left > 0 && --C.next <= 0) { C.left--; C.next = Math.round(sr * 0.028); C.n = Math.round(sr * 0.0015); } if (C.n > 0) { C.n--; fClick.tick(w); br += fClick.bp * 0.5; } }
      a5 += br * br;
      out[i] = rd + br;
    }
    fR.z1 = rd1; fR.z2 = rd2;
    this.cobPh = cobPh; this.cobA = cobA; this.jointPh = jointPh; this.crunch = crunch; this.kerbPh = kerbPh - Math.floor(kerbPh); this.brPh = brPh - Math.floor(brPh); this.brDrift = brDrift; this.rr = r;
    this.acc[4] = a4; this.acc[5] = a5;
  }

  // the wind, gusting
  #wind(out, n, A, B, gust0) {
    const g0 = A[7], g1 = B[7];
    if (g0 <= 1e-6 && g1 <= 1e-6) { out.fill(0, 0, n); return; }
    const fw = this.f.wind, Br = this.nB, P = this.nP, gust1 = this.gust, a1 = fw.a1, a2 = fw.a2, a3 = fw.a3, k = fw.k * 2;
    let z1 = fw.z1, z2 = fw.z2;
    for (let i = 0; i < n; i++) {
      const f = (i + 1) / n, x = Br[i] * 2 + P[i] * 0.5;
      const v3 = x - z2, v1 = a1 * z1 + a2 * v3, v2 = z2 + a2 * z1 + a3 * v3; z1 = 2 * v1 - z1; z2 = 2 * v2 - z2;
      out[i] = v1 * k * (g0 + (g1 - g0) * f) * (gust0 + (gust1 - gust0) * f);
    }
    fw.z1 = z1; fw.z2 = z2;
  }
}

// ---------- the limiter ----------

// A look-ahead peak limiter (stereo): the signal is delayed L samples (`lookahead` s); the gain each sample needs to
// keep its peak under the ceiling is known that far ahead, so the gain eases down over the look-ahead (the
// box-averaged minimum of what the window of samples round it needs: never more than any of them allows) and back
// up over `release` s. Nothing past the ceiling comes out. take(): the input's peak, the output's and the least
// gain since the last take.
export class Limiter {
  constructor(sr, { ceiling = 0.89, lookahead = 0.003, release = 0.08 } = {}) {
    this.sr = sr; this.ceiling = ceiling;
    const L = this.L = Math.max(1, Math.round(sr * lookahead));
    this.dl = [new Float32Array(L), new Float32Array(L)]; this.w = 0;
    this.Q = L + 2; this.dqv = new Float32Array(this.Q); this.dqi = new Float64Array(this.Q); this.dh = 0; this.dt = 0;   // a sliding-window minimum
    this.box = new Float32Array(L).fill(1); this.boxSum = L; this.boxAt = 0;
    this.g = 1; this.rel = ease(release, sr); this.n = 0;
    this.peakIn = 0; this.peakOut = 0; this.minGain = 1;
  }
  set({ ceiling, release } = {}) { if (ceiling) this.ceiling = ceiling; if (release) this.rel = ease(release, this.sr); }
  // ins, outs: [left, right] (a missing right: mono)
  process(ins, outs, n) {
    const L = this.L, Q = this.Q, c = this.ceiling, l = ins[0], r = ins[1] ?? ins[0], ol = outs[0], or = outs[1];
    const dl = this.dl[0], dr = this.dl[1];
    for (let i = 0; i < n; i++) {
      const xl = l ? l[i] : 0, xr = r ? r[i] : 0, p = Math.max(Math.abs(xl), Math.abs(xr));
      if (p > this.peakIn) this.peakIn = p;
      const need = p > c ? c / p : 1, k = this.n++;
      // the minimum need over the last L + 1 samples (a monotonic queue)
      while (this.dt > this.dh && this.dqv[(this.dt - 1) % Q] >= need) this.dt--;
      this.dqv[this.dt % Q] = need; this.dqi[this.dt % Q] = k; this.dt++;
      while (this.dqi[this.dh % Q] < k - L) this.dh++;
      const winMin = this.dqv[this.dh % Q];
      // averaged over L: a smooth slope down that reaches what the peak needs as it comes out of the delay
      this.boxSum += winMin - this.box[this.boxAt]; this.box[this.boxAt] = winMin; this.boxAt = this.boxAt + 1 === L ? 0 : this.boxAt + 1;
      const target = Math.min(1, this.boxSum / L);
      this.g = target < this.g ? target : this.g + (target - this.g) * this.rel;
      // the sample from L ago, at that gain
      const w = this.w, yl = dl[w] * this.g, yr = dr[w] * this.g;
      dl[w] = xl; dr[w] = xr; this.w = w + 1 === L ? 0 : w + 1;
      const ql = yl > c ? c : yl < -c ? -c : yl, qr = yr > c ? c : yr < -c ? -c : yr;   // (rounding's last hair)
      ol[i] = ql; if (or) or[i] = qr;
      const po = Math.max(Math.abs(ql), Math.abs(qr));
      if (po > this.peakOut) this.peakOut = po;
      if (this.g < this.minGain) this.minGain = this.g;
    }
    // (the box sum, kept from drifting with rounding)
    if ((this.n & 0xffff) < n) { let sum = 0; for (let j = 0; j < L; j++) sum += this.box[j]; this.boxSum = sum; }
  }
  take() { const r = { peakIn: this.peakIn, peakOut: this.peakOut, minGain: this.minGain }; this.peakIn = 0; this.peakOut = 0; this.minGain = 1; return r; }
}
