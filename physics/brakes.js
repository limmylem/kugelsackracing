// Brakes: pedal → line pressure → each wheel's pressure (bias valve, ABS) → caliper clamp force →
// torque through the pads' friction (which fades when they're hot) at the disc's effective radius.
// Discs heat up with the work the brakes do and cool with airflow (more at speed) and time.
//
// ABS works per wheel like the real thing: when a wheel's slip passes the tyre's peak-grip slip it
// dumps pressure, holds while the wheel spins back up, then reapplies (more slowly) — so it pulses.
// Stability control asks for extra torque on single wheels; that goes through the same ABS. The
// ABS's rates are set for the car's own brakes (assists.abs.referenceTorque: the torque they make at
// full pedal); bigger brakes (or grippier pads) have them scaled down, so it modulates the same torque
// the same way instead of overshooting the tyre further on every pulse — and it lets through no more
// than that torque's share of the pressure (their gain is running cooler, so fading less).
// The handbrake is a separate, strong rear-only torque.

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const BAR = 1e5;

export class Brakes {
  // wheels: the vehicle's wheel objects (front flag, name); peakSlip: the tyre's peak-grip slip ratio
  constructor(spec, wheels, peakSlip) {
    this.spec = spec;
    this.peakSlip = peakSlip;
    this.state = wheels.map(w => ({ wheel: w, axle: w.front ? spec.brakes.front : spec.brakes.rear }));
    this.setBias(spec.brakes.bias);
    this.reset();
  }

  // The spec was edited: pick up the axles' numbers and redo the balance valve
  retune(peakSlip) {
    this.peakSlip = peakSlip;
    for (const s of this.state) s.axle = s.wheel.front ? this.spec.brakes.front : this.spec.brakes.rear;
    this.setBias(this.bias);
  }

  reset() {
    const ambient = this.spec.brakes.cooling.ambient;
    for (const s of this.state) Object.assign(s, { temp: ambient, pressure: 0, abs: 1, absMode: 'apply', absHold: 0, absActive: false, heat: 0, torque: 0 });
  }

  // Share of braking torque on the front axle (0..1). A balance valve trims one axle's pressure so the
  // front:rear torque split matches; the other axle keeps full pressure.
  setBias(bias) {
    const B = this.spec.brakes;
    this.bias = clamp(bias, 0.3, 0.9);
    this.scale = valveScale(B, this.bias);
    const full = fullTorques(B, this.bias), ref = this.spec.assists.abs.referenceTorque;
    this.absScale = { front: ref ? ref.front / full.front : 1, rear: ref ? ref.rear / full.rear : 1 };
  }

  // Pad friction at a disc temperature: drops toward fade.muAtFull between fade.startTemp and fullTemp
  padMu(axle, temp) {
    const F = this.spec.brakes.fade;
    return axle.padMu * (1 - (1 - F.muAtFull) * smoothstep(F.startTemp, F.fullTemp, temp));
  }

  // Torque a wheel's caliper gives at a pressure (Pa) and its current temperature
  torqueAt(s, pressure) {
    return 2 * this.padMu(s.axle, s.temp) * pressure * s.axle.pistonArea * s.axle.discRadius;
  }

  // Pressure the pedal asks for at a wheel (Pa, after the bias valve)
  requested(s, pedal) {
    return clamp(pedal, 0, 1) * this.spec.brakes.maxPressureBar * BAR * (s.wheel.front ? this.scale.front : this.scale.rear);
  }

  // One substep for one wheel: ABS decides how much of the requested pressure gets through.
  // slip: the wheel's slip ratio (negative when braking), speed: its rolling speed (m/s).
  // extraTorque: more torque asked for on this wheel (stability control). Returns the brake torque.
  substep(i, h, pedal, extraTorque, absOn, slip, speed) {
    const s = this.state[i], A = this.spec.assists.abs, k = this.absScale[s.wheel.front ? 'front' : 'rear'];   // (k: 1 with the car's own brakes)
    const pedalWant = this.requested(s, pedal), extra = extraTorque > 0 ? extraTorque / Math.max(1e-6, this.torqueAt(s, 1)) : 0;   // (torque → pressure)
    let pedalShare = 1, extraShare = 1;
    if (!absOn || pedalWant + extra <= 0 || Math.abs(speed) < A.minSpeed) {
      s.abs = 1; s.absMode = 'apply'; s.absActive = false;
    } else {
      const lock = -slip * Math.sign(speed), kp = this.peakSlip;   // how far the wheel is into locking
      if (s.absMode !== 'release' && lock > kp * A.releaseAt) s.absMode = 'release';
      if (s.absMode === 'release') {
        s.abs -= A.releaseRate * k * h;
        if (lock < kp * A.reapplyAt) { s.absMode = 'hold'; s.absHold = A.holdTime; }
      } else if (s.absMode === 'hold') {
        s.absHold -= h;
        if (s.absHold <= 0) s.absMode = 'apply';
      } else s.abs += A.applyRate * k * h;
      // (no more of the pedal's pressure than gives the car's own brakes' full torque: the tyres, not
      // the brakes, stop an ABS car, and more only overshoots them — bigger brakes and pads pay off
      // hot, where they fade less, and with the ABS off. The stability control's torque in full.)
      s.abs = clamp(s.abs, A.minPressure * k, k);
      s.absActive = s.abs < k * 0.999;
      pedalShare = s.abs; extraShare = s.abs / k;
    }
    s.pressure = pedalWant * pedalShare + extra * extraShare;
    return this.torqueAt(s, s.pressure);
  }

  // Once per step: the heat each brake made (torque × wheel speed, summed over the substeps by the
  // vehicle into s.heat, in J) warms its disc; airflow cools it, more the faster the car goes.
  cool(dt, speed) {
    const C = this.spec.brakes.cooling;
    for (const s of this.state) {
      const h = C.still + C.perSpeed * Math.abs(speed);            // W per K
      s.temp += (s.heat - h * (s.temp - C.ambient) * dt) / s.axle.heatCapacity;
      s.heat = 0;
    }
  }

  snapshot(i) {
    const s = this.state[i];
    return { pressureBar: s.pressure / BAR, temp: s.temp, absActive: s.absActive, torque: s.torque, fade: 1 - this.padMu(s.axle, s.temp) / s.axle.padMu };
  }
}

// The balance valve: the share of full pressure each axle gets for a front share of the torque
function valveScale(B, bias) {
  const full = axle => 2 * axle.padMu * B.maxPressureBar * BAR * axle.pistonArea * axle.discRadius;
  const tf = full(B.front), tr = full(B.rear);
  return { front: Math.min(1, bias / (1 - bias) * tr / tf), rear: Math.min(1, (1 - bias) / bias * tf / tr) };
}
// The torque one wheel's brake makes at full pedal (cold pads, after the balance valve): { front, rear }
export function fullTorques(B, bias = B.bias) {
  const v = valveScale(B, clamp(bias, 0.3, 0.9)), full = axle => 2 * axle.padMu * B.maxPressureBar * BAR * axle.pistonArea * axle.discRadius;
  return { front: full(B.front) * v.front, rear: full(B.rear) * v.rear };
}
