// Everything between the throttle and the driven wheels: engine, clutch, gearbox, transfer case and
// differentials.
//
// control() runs once per physics step: it picks the gear (automatic or sequential), works the
// auto-clutch and decides which pedal drives (in reverse with the auto box, S drives and W brakes).
// solve() runs inside the wheel substeps: the engine and the driven wheels are stepped together
// implicitly in one small linear solve, with the clutch and each differential either locked (a
// constraint) or slipping (a friction torque at its capacity), so the stiff joins stay stable.
//
// Layout comes from the spec (drivetrain.layout):
//   RWD, FWD  one driven axle with its differential (spec.differential)
//   AWD       both axles, full time: a centre differential (spec.centreDifferential) shares the torque
//             front / rear (split: the front's share) — open, viscous (it resists the axles turning at
//             different speeds in proportion to the difference), lsd (up to preload + lock × the torque
//             through it) or locked; the front axle's own diff is spec.frontDifferential
//   4WD       part-time, with a transfer case (spec.transferCase): 2H drives the rear only (the front
//             wheels roll free), 4H locks front and rear together, 4L too through the low range
//             (lowRatio × every gear). Into or out of 4L only nearly stopped (below shiftBelow m/s).
// A differential marked lockable can be locked by the driver (setLock: front, rear, centre).
// Gears go through requestShift / selectGear, so an H-pattern (any gear, clutch required) can be added
// alongside. One driven axle is solved exactly as it always was; two have their own solve.
//
// Sign conventions: engine speed is always ≥ 0; a gear's ratio is negative in reverse, so the
// driven axle turns backwards while the engine turns forwards. Wheel speeds are + rolling forwards.
//
// Any downshift goes in (unless the rev protection aid is on): one at too high a speed has the clutch
// drag the engine past its redline — a jolt through the driven wheels, which can lock or slide them —
// and the engine's health (engineHealth.js) takes the damage. `events` collects what the game shows:
// { type: 'overRevShift' | 'shiftBlocked', gear, rpm } and the engine's own (float, bent, blown, incident);
// { type: 'transfer', mode } · { type: 'transferBlocked', mode, why } · { type: 'diffLock', axle, locked }.

import { engineTorque, frictionTorque, holdThrottle, idleThrottle, radToRpm, rpmToRad, throttleFor } from './engine.js';
import { EngineHealth } from './engineHealth.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Gaussian elimination with partial pivoting (the systems here are 3–5 unknowns)
function solveLinear(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    [b[i], b[p]] = [b[p], b[i]];
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x;
}

export const LAYOUTS = ['RWD', 'FWD', 'AWD', '4WD'];
export const TRANSFER_MODES = ['2H', '4H', '4L'];
const LOCKED_CENTRE = { type: 'locked', split: 0.5 };   // (a part-time 4WD's transfer case in 4H / 4L)
const DEFAULTS = { frontDifferential: { type: 'open', preload: 0, lock: 0 }, centreDifferential: { type: 'open', split: 0.5 }, transferCase: { lowRatio: 2.72, modes: ['2H', '4H', '4L'], mode: '2H', shiftBelow: 2 } };

export class Drivetrain {
  constructor(spec, wheels) {
    this.spec = spec;
    const layout = this.layout = spec.drivetrain.layout;
    if (!LAYOUTS.includes(layout)) throw new Error(`drive layout "${layout}": RWD, FWD, AWD or 4WD`);
    // (a layout switched without its parts — the tuning panel: plain open ones, said once)
    const missing = [...(layout === 'AWD' || layout === '4WD' ? ['frontDifferential'] : []), ...(layout === 'AWD' ? ['centreDifferential'] : layout === '4WD' ? ['transferCase'] : [])].filter(k => !spec[k]);
    if (missing.length) {
      console.warn(`${layout} needs ${missing.join(' and ')}: open ones for now`);
      for (const k of missing) spec[k] = JSON.parse(JSON.stringify(DEFAULTS[k]));
    }
    // each axle's wheels [left, right] (+x is left in the car frame)
    const axle = (name, names) => ({ name, wheels: names.map(n => wheels.find(w => w.name === n)).sort((a, b) => b.socket[0] - a.socket[0]) });
    this.wheels = wheels;
    this.front = axle('front', spec.wheels.front);
    this.rear = axle('rear', spec.wheels.rear);
    this.axles = { RWD: [this.rear], FWD: [this.front], AWD: [this.front, this.rear], '4WD': [this.front, this.rear] }[layout];
    this.locks = { front: false, rear: false, centre: false };      // (the driver's, on lockable diffs)
    this.transfer = layout === '4WD' ? (spec.transferCase.mode ?? '2H') : null;
    this.connect();
    this.mode = spec.gearbox.mode;              // 'auto' | 'sequential' (the game can switch it)
    this.events = [];
    this.health = new EngineHealth(spec, this.events);
    // mechanical damage (physics/mechanical.js sets it each step; null: none): { torque (share), revLimit,
    // boost (rpm → share of the torque a boost leak leaves), clutch (share of its capacity), diffBias,
    // diffRipple, gearbox (damage 0..1), gearRules, random }
    this.faults = null;
    this.reset();
  }

  reset() {
    this.health.reset();
    this.omega = this.health.blown ? 0 : rpmToRad(this.spec.engine.idleRpm);   // engine speed, rad/s
    this.crank = 0;               // how far the crank has turned (rad): which firing it's on
    this.gear = 1;                // -1 reverse, 0 neutral, 1.. forward
    this.pending = null;          // gear being shifted into
    this.shiftTimer = 0;
    this.sinceShift = 1;
    this.request = 0;             // queued sequential shifts (+ up, - down)
    this.clutch = 0;              // engagement 0 (open) .. 1 (closed)
    this.clutchLocked = false;
    this.launching = false;       // pulling away from a stop in 1st or reverse: the only time the auto-clutch slips on purpose
    this.engaging = null;         // seconds since a gear went in while moving, until the clutch has it (null: not engaging)
    this.clutchTorque = 0;        // torque through the clutch last substep (N·m, + = engine driving)
    this.diffLocked = false;
    this.diffTorque = 0;
    this.joints = { front: false, rear: false, centre: false };     // (two driven axles: each diff locked up now)
    this.jointTorque = { front: 0, rear: 0, centre: 0 };
    this.frontDrive = 0;          // torque going to the front wheels last substep (N·m): torque steer
    this.fuelCut = false;         // rev limiter
    this.driveThrottle = 0;       // throttle the vehicle asks for (after driver aids)
    this.throttle = 0;            // what the engine actually got (after idle / limiter / rev-matching)
    this.engineTorque = 0;
    this.revMatch = 0;
    this.missed = false;          // (a damaged gearbox missed this gear once: the next try goes in)
    this.breath = 1;              // how well the engine breathes at this altitude (set by the vehicle)
  }

  get rpm() { return radToRpm(this.omega); }
  get shifting() { return this.shiftTimer > 0; }
  get gears() { return this.spec.gearbox.ratios.length; }
  // (the low range: 4L)
  get range() { return this.transfer === '4L' ? this.spec.transferCase.lowRatio : 1; }
  ratio(g) {
    const GB = this.spec.gearbox;
    return (g > 0 ? GB.ratios[g - 1] * GB.finalDrive : g < 0 ? -GB.reverse * GB.finalDrive : 0) * this.range;
  }
  gearName(g = this.gear) { return g < 0 ? 'R' : g === 0 ? 'N' : String(g); }

  // The axles driven now (4WD in 2H: the rear), and each wheel's driven flag
  connect() {
    this.connected = this.transfer === '2H' ? [this.rear] : this.axles;
    this.driven = this.connected.flatMap(a => a.wheels);
    for (const w of this.wheels) w.driven = this.driven.includes(w);
  }
  // An axle's differential as it works now (lockable, and locked by the driver: locked)
  diffOf(axle) {
    const D = axle === this.front && this.axles.length > 1 ? this.spec.frontDifferential : this.spec.differential;
    return this.locks[axle.name] && D.lockable && D.type !== 'locked' ? { ...D, type: 'locked' } : D;
  }
  // What joins the axles (two driven): a part-time 4WD's transfer case locks them; AWD's centre diff
  centre() {
    if (this.layout === '4WD') return LOCKED_CENTRE;
    const C = this.spec.centreDifferential;
    return this.locks.centre && C.lockable && C.type !== 'locked' ? { ...C, type: 'locked' } : C;
  }
  // The gearbox's output speed over the driven wheels (the centre diff shares it: split to the front)
  axleOmega() {
    if (this.connected.length === 1) return (this.driven[0].omega + this.driven[1].omega) / 2;
    const s = this.centre().split ?? 0.5, [FL, FR, RL, RR] = this.driven;
    return s * (FL.omega + FR.omega) / 2 + (1 - s) * (RL.omega + RR.omega) / 2;
  }

  // The transfer case (4WD): 2H ↔ 4H any time, into or out of 4L only nearly stopped. true if it went
  setTransfer(mode, speed = 0) {
    const T = this.spec.transferCase;
    if (!T || !TRANSFER_MODES.includes(mode) || mode === this.transfer) return false;
    if (T.modes && !T.modes.includes(mode)) { this.#event({ type: 'transferBlocked', mode, why: `this transfer case has no ${mode}` }); return false; }
    if ((mode === '4L' || this.transfer === '4L') && Math.abs(speed) > (T.shiftBelow ?? 2)) { this.#event({ type: 'transferBlocked', mode, why: 'stop to shift the low range' }); return false; }
    this.transfer = mode;
    this.connect();
    this.clutchLocked = false;            // (the gearing changed under it: it takes it up again)
    this.#event({ type: 'transfer', mode });
    return true;
  }
  nextTransfer(speed) { const modes = this.spec.transferCase?.modes ?? TRANSFER_MODES, i = modes.indexOf(this.transfer); return this.setTransfer(modes[(i + 1) % modes.length], speed); }
  // The driver's diff locks: which 'front' | 'rear' | 'centre', on or off; true if it changed
  lockable(which) {
    const D = which === 'centre' ? (this.layout === 'AWD' ? this.spec.centreDifferential : null) : which === 'front' ? (this.axles.length > 1 ? this.spec.frontDifferential : this.layout === 'FWD' ? this.spec.differential : null) : (this.layout !== 'FWD' ? this.spec.differential : null);
    return !!D?.lockable;
  }
  setLock(which, on) {
    if (!this.lockable(which) || this.locks[which] === !!on) return false;
    this.locks[which] = !!on;
    this.#event({ type: 'diffLock', axle: which, locked: !!on });
    return true;
  }
  // Engine rpm if the clutch were closed in a gear
  lockedRpm(g = this.gear) { return radToRpm(Math.abs(this.axleOmega() * this.ratio(g))); }

  // Already rolling at `speed` (m/s): the gear the automatic would be in, clutch closed, engine matched
  matchSpeed(speed) {
    const GB = this.spec.gearbox, radius = this.spec.wheels.radius;
    let g = 1;
    while (g < this.gears && radToRpm(speed / radius * this.ratio(g)) > GB.auto.upFull - 800) g++;
    this.gear = g;
    this.clutch = 1;
    this.clutchLocked = true;
    this.omega = speed / radius * this.ratio(g);
  }

  #event(e) { this.events.push(e); if (this.events.length > 64) this.events.splice(0, this.events.length - 64); }

  // Sequential: +1 up, -1 down (queued, handled next step). Pressing either leaves automatic.
  requestShift(dir) { this.request += Math.sign(dir); }
  // Direct gear choice (for an H-pattern later): starts a shift into gear g
  selectGear(g) { if (!this.shifting && g !== this.gear) { this.pending = g; this.shiftTimer = this.spec.gearbox.shiftTime; this.sinceShift = 0; } }

  // Once per physics step. pedals: { accel, brake (0..1, the W and S keys), clutch (null = auto,
  // else 0..1 pedal), handbrake, sliding (the rear is sliding: the automatic holds its gear) },
  // speed: the car's forward speed over the ground (m/s).
  // revProtection: the driver aid that refuses a downshift that would over-rev the engine.
  // Returns the pedals as the car should use them: { accel (engine), brake (brakes) }.
  control(dt, pedals, speed) {
    const { engine: E, clutch: C, gearbox: GB } = this.spec, A = GB.auto, radius = this.spec.wheels.radius;
    // (a worn clutch; limp mode's rev limit: the automatic's whole shift map scaled down to it)
    const maxTorque = C.maxTorque * (this.faults?.clutch ?? 1), k = Math.min(1, (this.faults?.revLimit ?? Infinity) / E.redlineRpm);
    this.health.update(dt, this.rpm);
    this.sinceShift += dt;
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      if (this.shiftTimer <= 0) {
        // a damaged gearbox: the gear can fail to go in at the first try (tried again after a moment),
        // and it grinds going in
        const F = this.faults, G = F?.gearRules, g = this.pending, bad = F && g !== 0 ? F.gearbox : 0;
        if (bad >= (G?.failFrom ?? Infinity) && !this.missed && F.random() < G.failMax * (bad - G.failFrom) / (1 - G.failFrom)) {
          this.missed = true;
          this.shiftTimer = G.retry;
          this.#event({ type: 'missedGear', gear: g });
          this.#event({ type: 'grind', gear: g, strength: 1 });
        } else {
          if (bad >= (G?.grindFrom ?? Infinity)) this.#event({ type: 'grind', gear: g, strength: bad });
          this.missed = false;
          // (taken up at once only when the gearbox turns fast enough to carry the engine: at a stop
          // the launch takes it up, not a clutch closed on a standing car)
          this.gear = this.pending; this.pending = null; this.clutchLocked = false; this.engaging = this.gear !== 0 && this.lockedRpm() >= E.idleRpm ? 0 : null;
        }
      }
    }
    // Engine rpm the car's speed over the ground would give in a gear: wheelspin doesn't count, so
    // the automatic doesn't upshift mid-burnout or mid-drift
    const groundRpm = g => radToRpm(Math.abs(speed) / radius * Math.abs(this.ratio(g)));
    const stopped = Math.abs(speed) < A.stopSpeed;
    let accel = pedals.accel, brake = pedals.brake;

    if (this.mode === 'auto') {
      if (!this.shifting) {
        if (this.gear >= 0 && stopped && brake > 0 && !accel) this.selectGear(-1);      // hold S at a stop: reverse
        else if (this.gear <= 0 && stopped && accel > 0 && !brake) this.selectGear(1);   // W at a stop: first
        else if (this.gear >= 1 && this.sinceShift > A.minInterval) {
          // (never later than just under the engine's own redline: another engine swapped in may rev less than the gearbox's map)
          const up = Math.min(lerp(A.upLight, A.upFull, accel), E.redlineRpm - 100) * k;
          // (holds the gear mid-slide, and while braking, so it's in the right gear for the way out).
          // The road speed has to say so too, or wheelspin would shift it up mid-burnout; the tyres
          // always slip a little when pulling hard, though (up a hill that can hold the road speed
          // just under the shift point with the engine on the limiter), so a few % short will do
          // once the engine itself is there
          const shiftSpeed = groundRpm(this.gear) > up || (this.rpm > up && groundRpm(this.gear) > up * 0.94);
          if (this.gear < this.gears && shiftSpeed && !pedals.sliding && brake < 0.05) this.selectGear(this.gear + 1);
          else if (this.gear > 1 && groundRpm(this.gear) < lerp(A.downLight, A.downFull, accel) * k) {
            // kick down straight to the lowest gear that keeps the engine comfortably under the upshift point
            let g = 1;
            while (g < this.gear - 1 && groundRpm(g) > Math.min(up, E.redlineRpm * k) - A.downMargin * k) g++;
            if (groundRpm(g) < (E.redlineRpm - A.downMargin) * k) this.selectGear(g);
          }
        }
      }
      if ((this.shifting ? this.pending : this.gear) < 0 && !this.shifting) [accel, brake] = [brake, accel]; // in reverse S drives, W brakes
    } else if (this.request && !this.shifting) {
      const g = clamp(this.gear + Math.sign(this.request), -1, this.gears);
      const intoReverse = g < 0 && speed > A.stopSpeed * 3;
      // a downshift: where it puts the engine (a money shift, past the redline, unless rev protection's on)
      const lands = g >= 1 && g < this.gear ? groundRpm(g) : 0;
      if (intoReverse) { /* not while rolling forwards */ }
      else if (pedals.revProtection && lands > Math.min(GB.maxDownshiftRpm ?? Infinity, E.redlineRpm)) this.#event({ type: 'shiftBlocked', gear: g, rpm: lands });
      else {
        this.selectGear(g);
        if (lands > E.redlineRpm) this.#event({ type: 'overRevShift', gear: g, rpm: lands, over: lands / E.redlineRpm - 1 });
      }
    }
    this.request = 0;

    // Rev-matching while the gear changes, and while the clutch takes up the new gear: blip or drop
    // the engine toward the new gear's speed (the throttle is the driver's again once it's locked)
    if (this.shifting || this.engaging != null) {
      const g = this.shifting ? this.pending : this.gear;
      const target = g === 0 ? E.idleRpm : Math.max(E.idleRpm, this.lockedRpm(g));
      this.revMatch = clamp(holdThrottle(E, target) + GB.revMatchGain * (target - this.rpm), 0, 1);
    }

    // Clutch
    if (this.health.blown) { this.clutch = 0; this.engaging = null; this.launching = false; }           // blown: nothing drives, the car coasts
    else if (pedals.clutch != null) { this.clutch = 1 - clamp(pedals.clutch, 0, 1); this.engaging = null; this.launching = false; }   // manual pedal
    else if (this.shifting || this.gear === 0) this.clutch = 0;                        // no drive during a shift
    else if (pedals.handbrake) this.clutch = Math.max(0, this.clutch - dt / C.releaseTime);
    else if (stopped && brake > 0.05) this.clutch = Math.max(0, this.clutch - dt / C.releaseTime);   // (braked at a stop it waits open, not slipping against the brakes)
    else {
      // Auto-clutch. Pulling away from a stop in 1st or reverse (and only then), it slips, carrying the
      // engine's own torque plus a bit more or less to steer the engine toward a launch rpm that rises
      // with the throttle, and closes once the car's rolling fast enough. A gear going in while moving
      // is taken up at once: closed within engageTime, the throttle rev-matching until the engine
      // turns with the gear, then the driver's again as far as the closing clutch can carry it (so it
      // never slips once it has the gear). Slowing to a stop it opens. The launch rpm is held only at
      // first: the engine comes down to meet the gearbox as the car gets going, and they meet half way
      // (no lower than idle + engageAbove), so the clutch slips for a moment, not all the way up to it.
      if (this.clutchLocked) this.launching = false;
      else if (Math.abs(this.gear) === 1 && Math.abs(speed) < A.stopSpeed * 4 && this.engaging == null) this.launching = true;
      const top = E.idleRpm + accel * (C.auto.launchRpm - E.idleRpm), locked = this.lockedRpm();
      const meet = Math.max(E.idleRpm + C.auto.engageAbove, (top + E.idleRpm) / 2), launchRpm = top - (top - meet) * Math.min(1, locked / meet);
      if (this.engaging != null) {
        this.clutch = Math.min(1, this.clutch + dt / C.engageTime);
        this.engaging += dt;
        const holds = this.clutch >= 1 || this.clutch * maxTorque >= engineTorque(E, this.rpm, accel, this.breath);
        if ((this.clutchLocked && holds) || this.engaging > 0.35) this.engaging = null;
      } else if (this.launching && accel > 0.02 && locked < launchRpm) {
        const want = (this.engineTorque + E.inertia * C.auto.holdRate * (this.omega - rpmToRad(launchRpm))) / maxTorque;
        this.clutch = clamp(want, 0, Math.min(1, this.clutch + dt / C.engageTime));
      }
      else if (locked >= E.idleRpm + C.auto.engageAbove) this.clutch = Math.min(1, this.clutch + dt / C.engageTime);
      else this.clutch = Math.max(0, this.clutch - dt / C.releaseTime);
    }
    return { accel, brake };
  }

  // One implicit substep of the engine and the driven wheels. tyres: [left, right], each
  // { F: tyre force along the wheel (N), slope: dF/dω, brake: torque against the spin (N·m, signed) }
  // tyres: one per driven wheel (this.driven's order: front left, right, then rear), each
  // { F: tyre force along the wheel (N), slope: dF/dω, radius, brake: torque against the spin (N·m, signed) }
  solve(h, tyres) {
    const { engine: E, clutch: C, drivetrain: DT, wheels: W } = this.spec;
    const [L, Rt] = this.connected.at(-1).wheels, rpm = this.rpm, F = this.faults;

    // Engine torque at this throttle (idle control underneath, rev limiter on top — limp mode's lower),
    // and how it changes with engine speed, for the implicit step
    const limiter = F?.revLimit ? Math.min(E.redlineRpm, F.revLimit) : E.redlineRpm;
    if (rpm >= limiter) this.fuelCut = true;
    else if (rpm <= limiter - E.limiter.hysteresis) this.fuelCut = false;
    // (wear since the garage: less torque; limp mode, a boost leak: less still)
    const H = this.health, O = E.overRev, breath = this.breath * H.scale * (F ? F.torque * (F.boost ? F.boost(rpm) : 1) : 1);
    let t = this.shifting ? this.revMatch : this.driveThrottle;
    if (!this.shifting && this.engaging != null) {
      // taking up a new gear: rev-matching until the engine turns with it, then the driver's throttle
      // within what the clutch can carry so far
      const cap = 0.9 * this.clutch * C.maxTorque * (F?.clutch ?? 1);
      t = this.clutchLocked ? clamp(t, throttleFor(E, rpm, -cap, breath), throttleFor(E, rpm, cap, breath)) : this.revMatch;
    }
    t = this.fuelCut || H.blown ? 0 : Math.max(t, idleThrottle(E, rpm));
    // a misfire: this firing makes nothing (a worn or damaged engine, on the fixed pattern)
    if (t > 0 && H.misfireShare > 0 && H.misfires(Math.floor(this.crank / (4 * Math.PI / (E.cylinders ?? 4))))) t = 0;
    let Te = engineTorque(E, rpm, t, breath), dTe = (engineTorque(E, rpm + 20, t, breath) - Te) / rpmToRad(20);
    // past the redline far enough to float the valves: it drags harder (the engine-braking spike)
    if (O && H.over > O.valveFloat) Te -= frictionTorque(E, rpm) * O.drag * H.over / O.bentValves;
    // (a damaged diff: a surge once a turn of the axle, a chipped tooth)
    if (F?.diffRipple && Te > 0) Te *= 1 + F.diffRipple * Math.sin((L.spin + Rt.spin) / 2);
    // blown: no fuel, no idle, and what's left of it seizes as it stops
    if (H.blown) { Te = this.omega > 0 ? -(3 * frictionTorque(E, rpm) + 40) : 0; dTe = 0; }
    this.throttle = t;
    this.engineTorque = Te;

    // Gearbox: the axle turns at engine speed / ratio when the clutch is closed. Losses: the wheels
    // get `efficiency` of the engine's torque when it drives, and must supply extra when it brakes.
    const G = this.shifting ? 0 : this.ratio(this.gear), gbOmega = G * this.axleOmega();
    const Ge = G * (this.clutchTorque * this.omega >= 0 ? DT.efficiency : 1 / DT.efficiency);
    // Clutch capacity; eased off as the engine is dragged below idle, so it doesn't stall
    let cap = G ? this.clutch * C.maxTorque * (F?.clutch ?? 1) : 0;
    if (cap > 0 && rpm < E.idleRpm && gbOmega < this.omega) cap *= smoothstep(C.antiStallRpm, E.idleRpm, rpm);
    if (this.connected.length > 1) return this.#solveAxles(h, tyres, { Te, dTe, G, gbOmega, Ge, cap });
    const D = this.diffOf(this.connected[0]);

    let clutch = cap > 0 ? (this.clutchLocked ? 'lock' : 'slip') : 'open';
    let slipDir = Math.sign(this.omega - gbOmega) || 1;
    let diff = D.type === 'open' ? 'open' : D.type === 'locked' ? 'lock' : (this.diffLocked ? 'lock' : 'slip');
    let diffDir = Math.sign(L.omega - Rt.omega) || 1;
    const diffCap = Tin => D.type === 'lsd' ? D.preload + D.lock * Math.abs(Tin) : Infinity;
    let x, Tcl = 0, Tb = 0, triedClutch = false, triedDiff = false;
    // (a damaged diff sends a little more to one side; each wheel's own radius — a soft tyre)
    const bias = F?.diffBias ?? 0, sL = 0.5 + bias, sR = 0.5 - bias, rL = tyres[0].radius ?? W.radius, rR = tyres[1].radius ?? W.radius;

    for (let iter = 0; iter < 6; iter++) {
      // Unknowns: engine and wheel speed changes, then the torque through each locked join
      const ci = clutch === 'lock' ? 3 : -1, di = diff === 'lock' ? (ci >= 0 ? 4 : 3) : -1;
      const n = 3 + (ci >= 0) + (di >= 0);
      const A = Array.from({ length: n }, () => new Array(n).fill(0)), b = new Array(n).fill(0);
      const TslipC = clutch === 'slip' ? cap * slipDir : 0;
      const TslipD = diff === 'slip' ? diffCap(Ge * (clutch === 'lock' ? this.clutchTorque : TslipC)) * diffDir : 0;
      // engine: I dω/h = Te + dTe·dω − T_clutch
      A[0][0] = E.inertia / h - dTe; b[0] = Te - TslipC;
      // each wheel: I dω/h = ½·G·T_clutch ∓ T_diff − R(F + slope·dω) − brake
      A[1][1] = W.inertia / h + rL * tyres[0].slope; b[1] = -rL * tyres[0].F - tyres[0].brake + Ge * sL * TslipC - TslipD;
      A[2][2] = W.inertia / h + rR * tyres[1].slope; b[2] = -rR * tyres[1].F - tyres[1].brake + Ge * sR * TslipC + TslipD;
      if (ci >= 0) {  // clutch closed: engine turns at gearbox speed
        A[0][ci] = 1; A[1][ci] = -Ge * sL; A[2][ci] = -Ge * sR;
        A[ci][0] = 1; A[ci][1] = -G / 2; A[ci][2] = -G / 2; b[ci] = -(this.omega - gbOmega);
      }
      if (di >= 0) {  // diff locked: both wheels at the same speed
        A[1][di] = 1; A[2][di] = -1;
        A[di][1] = 1; A[di][2] = -1; b[di] = -(L.omega - Rt.omega);
      }
      x = solveLinear(A, b);
      Tcl = ci >= 0 ? x[ci] : TslipC;
      Tb = di >= 0 ? x[di] : TslipD;
      // A locked join that would need more torque than it can hold slips; a slipping one whose
      // speeds cross over grabs
      if (clutch === 'lock' && Math.abs(Tcl) > cap) { clutch = 'slip'; slipDir = Math.sign(Tcl); continue; }
      if (clutch === 'slip' && !triedClutch) {
        const u = this.omega + x[0] - G * (L.omega + x[1] + Rt.omega + x[2]) / 2;
        if (Math.sign(u) !== slipDir) { clutch = 'lock'; triedClutch = true; continue; }
      }
      if (diff === 'lock' && Math.abs(Tb) > diffCap(Ge * Tcl)) { diff = 'slip'; diffDir = Math.sign(Tb); continue; }
      if (diff === 'slip' && !triedDiff) {
        const du = L.omega + x[1] - (Rt.omega + x[2]);
        if (Math.sign(du) !== diffDir) { diff = 'lock'; triedDiff = true; continue; }
      }
      break;
    }
    this.omega = Math.max(0, this.omega + x[0]);
    this.crank += this.omega * h;
    L.omega += x[1];
    Rt.omega += x[2];
    this.clutchTorque = Tcl;
    this.clutchLocked = clutch === 'lock';
    this.diffLocked = diff === 'lock';
    this.diffTorque = Tb;
    this.frontDrive = this.connected[0] === this.front ? Ge * Tcl : 0;
  }

  // Both axles driven (AWD, 4WD in 4H / 4L): the engine and four wheels, with the clutch, each axle's
  // diff and the centre (a lock, a limited slip, a viscous coupling or open) as joins. Unknowns: the
  // engine's and each wheel's change of speed, then the torque through each locked join.
  #solveAxles(h, tyres, { Te, dTe, G, gbOmega, Ge, cap }) {
    const { engine: E, wheels: W } = this.spec, F = this.faults, w = this.driven, Cn = this.centre();
    const s = Cn.split ?? 0.5, bias = F?.diffBias ?? 0;          // (a damaged diff: the rear's)
    // each wheel's share of the gearbox's torque, and of its speed (planetary centre: split to the front)
    const share = [s * 0.5, s * 0.5, (1 - s) * (0.5 + bias), (1 - s) * (0.5 - bias)], k = [s / 2, s / 2, (1 - s) / 2, (1 - s) / 2];
    const axleShare = { front: s, rear: 1 - s }, g = [0.5, 0.5, -0.5, -0.5];
    const r = tyres.map(t => t.radius ?? W.radius), omega = w.map(x => x.omega);
    // the joins: each axle's diff and the centre — 'open' (nothing), 'lock' (a constraint), 'slip' (its
    // capacity, the way it's slipping), 'viscous' (a coupling by the speed difference)
    const cap0 = D => D.type === 'lsd' ? Tin => D.preload + D.lock * Math.abs(Tin) : () => Infinity;
    const joints = [
      { key: 'front', D: this.diffOf(this.front), rows: [0, 1], col: [1, -1, 0, 0] },
      { key: 'rear', D: this.diffOf(this.rear), rows: [2, 3], col: [0, 0, 1, -1] },
      { key: 'centre', D: Cn, col: [0.5, 0.5, -0.5, -0.5] },
    ].map(j => ({ ...j, cap: cap0(j.D), state: j.D.type === 'open' ? 'open' : j.D.type === 'viscous' ? 'viscous' : j.D.type === 'locked' ? 'lock' : (this.joints[j.key] ? 'lock' : 'slip'), tried: false }));
    const speedDiff = (j, dx) => j.col.reduce((a, c, i) => a + c * (omega[i] + (dx ? dx[i + 1] : 0)), 0);
    for (const j of joints) j.dir = Math.sign(speedDiff(j)) || 1;
    // (what goes through a join: its axle's share of the gearbox's torque; the centre, all of it)
    const through = (j, Tc) => Ge * Tc * (j.key === 'centre' ? 1 : axleShare[j.key]);
    let clutch = cap > 0 ? (this.clutchLocked ? 'lock' : 'slip') : 'open', slipDir = Math.sign(this.omega - gbOmega) || 1, triedClutch = false;
    let x, Tcl = 0;
    for (let iter = 0; iter < 12; iter++) {
      let n = 5;
      const ci = clutch === 'lock' ? n++ : -1;
      for (const j of joints) j.i = j.state === 'lock' ? n++ : -1;
      const A = Array.from({ length: n }, () => new Array(n).fill(0)), b = new Array(n).fill(0);
      const TslipC = clutch === 'slip' ? cap * slipDir : 0, Tin = clutch === 'lock' ? this.clutchTorque : TslipC;
      A[0][0] = E.inertia / h - dTe; b[0] = Te - TslipC;
      for (let i = 0; i < 4; i++) { A[i + 1][i + 1] = W.inertia / h + r[i] * tyres[i].slope; b[i + 1] = -r[i] * tyres[i].F - tyres[i].brake + Ge * share[i] * TslipC; }
      if (ci >= 0) {
        A[0][ci] = 1; A[ci][0] = 1; b[ci] = -(this.omega - gbOmega);
        for (let i = 0; i < 4; i++) { A[i + 1][ci] = -Ge * share[i]; A[ci][i + 1] = -G * k[i]; }
      }
      for (const j of joints) {
        if (j.state === 'lock') { for (let i = 0; i < 4; i++) { A[i + 1][j.i] = j.col[i]; A[j.i][i + 1] = j.col[i]; } b[j.i] = -speedDiff(j); }
        else if (j.state === 'slip') { j.T = j.cap(through(j, Tin)) * j.dir; for (let i = 0; i < 4; i++) b[i + 1] -= j.col[i] * j.T; }
        else if (j.state === 'viscous') {           // T = c × (the speed difference after the step): implicit
          const c = j.D.viscous ?? 0, now = speedDiff(j);
          for (let i = 0; i < 4; i++) { b[i + 1] -= j.col[i] * c * now; for (let m = 0; m < 4; m++) A[i + 1][m + 1] += j.col[i] * c * j.col[m]; }
        }
      }
      x = solveLinear(A, b);
      Tcl = ci >= 0 ? x[ci] : TslipC;
      for (const j of joints) j.T = j.state === 'lock' ? x[j.i] : j.state === 'slip' ? j.T : j.state === 'viscous' ? (j.D.viscous ?? 0) * speedDiff(j, x) : 0;
      if (clutch === 'lock' && Math.abs(Tcl) > cap) { clutch = 'slip'; slipDir = Math.sign(Tcl); continue; }
      if (clutch === 'slip' && !triedClutch) {
        const u = this.omega + x[0] - G * k.reduce((a, kk, i) => a + kk * (omega[i] + x[i + 1]), 0);
        if (Math.sign(u) !== slipDir) { clutch = 'lock'; triedClutch = true; continue; }
      }
      const slipping = joints.find(j => j.state === 'lock' && j.D.type === 'lsd' && Math.abs(j.T) > j.cap(through(j, Tcl)));
      if (slipping) { slipping.state = 'slip'; slipping.dir = Math.sign(slipping.T) || 1; continue; }
      const grabbing = joints.find(j => j.state === 'slip' && !j.tried && Math.sign(speedDiff(j, x)) !== j.dir);
      if (grabbing) { grabbing.state = 'lock'; grabbing.tried = true; continue; }
      break;
    }
    this.omega = Math.max(0, this.omega + x[0]);
    this.crank += this.omega * h;
    w.forEach((wh, i) => { wh.omega += x[i + 1]; });
    this.clutchTorque = Tcl;
    this.clutchLocked = clutch === 'lock';
    for (const j of joints) { this.joints[j.key] = j.state === 'lock'; this.jointTorque[j.key] = j.T ?? 0; }
    this.diffLocked = this.joints.rear;
    this.diffTorque = this.jointTorque.rear;
    // (to the front wheels: their share, less what the centre moved to the back)
    this.frontDrive = Ge * s * Tcl - (this.jointTorque.centre ?? 0);
  }

  snapshot() {
    return {
      rpm: this.rpm, throttle: this.throttle, torque: this.engineTorque, powerKw: this.engineTorque * this.omega / 1000,
      fuelCut: this.fuelCut, gear: this.gearName(this.shifting ? this.pending : this.gear), shifting: this.shifting,
      mode: this.mode, clutch: this.clutch, clutchLocked: this.clutchLocked, clutchTorque: this.clutchTorque,
      clutchSlipRpm: this.gear !== 0 && !this.shifting ? this.rpm - this.lockedRpm() : 0,
      diffType: this.spec.differential.type, diffLocked: this.diffLocked, diffTorque: this.diffTorque,
      layout: this.layout, transfer: this.transfer, locks: { ...this.locks }, frontDrive: this.frontDrive,
      ...(this.axles.length > 1 && { centre: { type: this.centre().type, split: this.centre().split ?? 0.5, locked: this.joints.centre, torque: this.jointTorque.centre }, frontDiff: { type: this.diffOf(this.front).type, locked: this.joints.front, torque: this.jointTorque.front } }),
      health: this.health.snapshot(),
    };
  }
}
