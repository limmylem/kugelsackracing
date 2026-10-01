// Test timer: 0–100 km/h, quarter mile (time and speed) and top speed. It arms while the car is
// stopped, starts the moment it moves off and keeps the last run's results until the next start.
// Also 100–0 km/h braking distance: measured from the moment the car drops through 100 km/h with the
// brake pressed until it stops (letting off the brake on the way spoils it).
// Plain state, updated once per physics step, so the HUD and headless tests read the same numbers.

const QUARTER_MILE = 402.336;   // m
const START = 0.3;              // m/s: counts as moving

export class RunTimer {
  constructor() {
    this.armed = false;
    this.running = false;
    this.lastSpeed = 0;
    this.stopping = null;       // metres so far in a 100–0 stop
    this.stopDistance = null;   // last complete one
    this.clear();
  }
  clear() {
    this.t = 0;
    this.distance = 0;
    this.t100 = null;
    this.quarter = null;
    this.quarterSpeed = null;
    this.top = 0;
  }
  update(dt, speed, brake = 0) {
    const V100 = 100 / 3.6;
    if (this.stopping === null && this.lastSpeed >= V100 && speed < V100 && brake > 0.5) this.stopping = 0;
    if (this.stopping !== null) {
      this.stopping += Math.max(0, speed) * dt;
      if (brake < 0.3) this.stopping = null;
      else if (speed < START) { this.stopDistance = this.stopping; this.stopping = null; }
    }
    this.lastSpeed = speed;
    if (!this.running) {
      if (Math.abs(speed) < START) this.armed = true;
      else if (this.armed && speed >= START) { this.clear(); this.running = true; this.armed = false; }
    }
    if (!this.running) return;
    this.t += dt;
    this.distance += Math.max(0, speed) * dt;
    this.top = Math.max(this.top, speed);
    if (this.t100 === null && speed >= 100 / 3.6) this.t100 = this.t;
    if (this.quarter === null && this.distance >= QUARTER_MILE) { this.quarter = this.t; this.quarterSpeed = speed; }
    if (speed < START) { this.running = false; this.armed = true; }
  }
  snapshot() {
    return { running: this.running, t: this.t, distance: this.distance, t100: this.t100, quarter: this.quarter, quarterSpeed: this.quarterSpeed, top: this.top, stopping: this.stopping, stopDistance: this.stopDistance };
  }
}
