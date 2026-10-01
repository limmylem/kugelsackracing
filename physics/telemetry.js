// Telemetry: records the car on every physics step into fixed-size buffers (a ring: the oldest samples
// are overwritten once it's full), for the in-game graphs and for export to CSV / JSON so runs can be
// compared or analysed elsewhere. Attach it to a simulation (sim.onStep) or call record() yourself.
// No browser APIs: the headless test runner uses it to save each test's telemetry.

import { dot, fromXYZ, rotate } from './math.js';

const DEG = 180 / Math.PI, G = 9.81;
export const WHEELS = ['FL', 'FR', 'RL', 'RR'];

// Channels for the whole car: get(vehicle, acc) where acc = measured acceleration in the car frame
export const CAR_CHANNELS = [
  { id: 'speed', name: 'Speed', unit: 'km/h', get: v => v.forwardSpeed() * 3.6 },
  { id: 'rpm', name: 'Engine', unit: 'rpm', get: v => v.drivetrain.rpm },
  { id: 'gear', name: 'Gear', unit: '', get: v => v.drivetrain.shifting ? v.drivetrain.pending : v.drivetrain.gear },
  { id: 'throttle', name: 'Throttle', unit: '%', get: v => v.throttle * 100 },
  { id: 'brake', name: 'Brake', unit: '%', get: v => v.brake * 100 },
  { id: 'steer', name: 'Steering wheel', unit: '°', get: v => v.steer * v.spec.steering.ratio * DEG },
  { id: 'latG', name: 'Lateral', unit: 'g', get: (v, a) => a.lat / G },
  { id: 'longG', name: 'Longitudinal', unit: 'g', get: (v, a) => a.long / G },
  { id: 'yawRate', name: 'Yaw rate', unit: '°/s', get: v => v.yawRate * DEG },
  { id: 'slide', name: 'Body slip', unit: '°', get: (v, a) => a.slip * DEG },
  { id: 'roll', name: 'Body roll (+ leaning right)', unit: '°', get: (v, a) => a.roll * DEG },
  { id: 'pitch', name: 'Pitch (+ nose down)', unit: '°', get: (v, a) => a.pitch * DEG },
  { id: 'engineThrottle', name: 'Engine throttle (after aids)', unit: '%', get: v => v.drivetrain.throttle * 100 },
  { id: 'clutch', name: 'Clutch', unit: '%', get: v => v.drivetrain.clutch * 100 },
  { id: 'aids', name: 'Aids working (ABS 1, TC 2, ESC 4)', unit: '', get: v => (v.absActive ? 1 : 0) + (v.tcActive ? 2 : 0) + (v.escActive ? 4 : 0) },
];
// Channels for each wheel (id is suffixed with the wheel: load_FL, …)
export const WHEEL_CHANNELS = [
  { id: 'load', name: 'Load', unit: 'N', get: w => w.load },
  { id: 'slipRatio', name: 'Slip ratio', unit: '', get: w => w.slipRatio },
  { id: 'slipAngle', name: 'Slip angle', unit: '°', get: w => w.slipAngle * DEG },
  { id: 'gripUsed', name: 'Grip used', unit: '%', get: w => w.gripUsed * 100 },
  { id: 'susp', name: 'Suspension compression', unit: 'mm', get: w => w.compression * 1000 },
];

export class Telemetry {
  // seconds: how much is kept (at stepHz samples a second)
  constructor({ seconds = 600, stepHz = 120 } = {}) {
    this.stepHz = stepHz;
    this.capacity = Math.round(seconds * stepHz);
    this.channels = [{ id: 't', name: 'Time', unit: 's' }, ...CAR_CHANNELS];
    for (const c of WHEEL_CHANNELS) for (const w of WHEELS) this.channels.push({ ...c, id: `${c.id}_${w}`, base: c.id, wheel: w, name: `${c.name} ${w}` });
    this.data = Object.fromEntries(this.channels.map(c => [c.id, new Float32Array(this.capacity)]));
    this.label = '';
    this.clear();
  }

  clear() {
    this.head = 0;           // where the next sample goes
    this.count = 0;
    this.t0 = null;
    this.lastVel = null;
  }

  get seconds() { return this.count / this.stepHz; }

  // Record every step of a simulation's player car; returns a function that stops recording
  attach(sim) {
    this.clear();
    return sim.onStep(s => this.record(s.vehicle, s.time, s.dt));
  }

  record(v, time, dt) {
    if (this.t0 === null) this.t0 = time - dt;
    const b = v.body, q = b.rotation(), vel = fromXYZ(b.linvel());
    const fwd = rotate(q, [0, 0, 1]), left = rotate(q, [1, 0, 0]);
    // measured acceleration (from the velocity change over the step), in the car's frame
    const d = this.lastVel ? vel.map((x, i) => (x - this.lastVel[i]) / dt) : [0, 0, 0];
    this.lastVel = vel;
    const vf = dot(vel, fwd), vl = dot(vel, left);
    const acc = { long: dot(d, fwd), lat: dot(d, left), slip: Math.hypot(vf, vl) > 1 ? Math.atan2(vl, Math.abs(vf)) : 0, roll: Math.asin(Math.max(-1, Math.min(1, left[1]))), pitch: Math.asin(Math.max(-1, Math.min(1, -fwd[1]))) };
    const i = this.head, D = this.data;
    D.t[i] = time - this.t0;
    for (const c of CAR_CHANNELS) D[c.id][i] = c.get(v, acc);
    for (const w of v.wheels) for (const c of WHEEL_CHANNELS) D[`${c.id}_${w.name}`][i] = c.get(w);
    this.head = (i + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
  }

  // Sample k (0 = oldest kept) of a channel
  value(id, k) { return this.data[id][(this.head - this.count + k + this.capacity) % this.capacity]; }
  latest(id) { return this.count ? this.value(id, this.count - 1) : 0; }

  // A channel's samples, oldest first (a copy)
  series(id) {
    const out = new Float32Array(this.count);
    for (let k = 0; k < this.count; k++) out[k] = this.value(id, k);
    return out;
  }

  toCSV() {
    const cols = this.channels, head = cols.map(c => c.unit ? `${c.id} (${c.unit})` : c.id).join(',');
    const rows = [head];
    for (let k = 0; k < this.count; k++) rows.push(cols.map(c => +this.value(c.id, k).toFixed(c.id === 't' ? 4 : 3)).join(','));
    return rows.join('\n') + '\n';
  }

  toJSON() {
    return {
      label: this.label, stepHz: this.stepHz, samples: this.count,
      channels: this.channels.map(({ id, name, unit }) => ({ id, name, unit })),
      data: Object.fromEntries(this.channels.map(c => [c.id, Array.from(this.series(c.id), x => +x.toFixed(c.id === 't' ? 4 : 3))])),
    };
  }
}
