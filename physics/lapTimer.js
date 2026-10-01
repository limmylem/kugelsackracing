// Stage / lap timer for a closed road. It follows the car along the road's centre line and times each
// lap from the start line, counting it only if the car went (nearly) all the way round in order, so
// big shortcuts don't count; being put back on the road nearby (a short hop) doesn't spoil a lap.

const TELEPORT = 40;   // m: a jump along the road bigger than this (e.g. a reset far away) spoils the lap

export class LapTimer {
  // line: road centre line (closed), step: metres between its points, startIndex: the start line's point
  constructor(line, step, startIndex) {
    this.line = line;
    this.step = step;
    this.start = startIndex;
    this.idx = null;
    this.running = false;
    this.t = 0;
    this.covered = 0;
    this.last = null;
    this.best = null;
    this.laps = 0;
  }
  nearest(x, z, around) {
    const L = this.line, m = L.length;
    let best = Infinity, at = 0;
    const check = i => { const d = (L[i].x - x) ** 2 + (L[i].z - z) ** 2; if (d < best) { best = d; at = i; } };
    if (around != null) for (let k = -60; k <= 60; k++) check(((around + k) % m + m) % m);
    if (around == null || best > 30 * 30) for (let i = 0; i < m; i++) check(i);
    return at;
  }
  update(dt, x, z) {
    const m = this.line.length, i = this.nearest(x, z, this.idx);
    if (this.idx === null) { this.idx = i; return; }
    let d = i - this.idx;
    if (d > m / 2) d -= m;
    if (d < -m / 2) d += m;
    const rel = k => ((k - this.start) % m + m) % m;
    if (Math.abs(d) * this.step > TELEPORT) { this.covered = -Infinity; this.idx = i; return; }
    this.covered += d * this.step;
    if (this.running) this.t += dt;
    if (d > 0 && rel(i) < rel(this.idx)) {          // crossed the start line going forwards
      if (this.running && this.covered >= 0.9 * m * this.step) {
        this.last = this.t;
        this.best = this.best === null ? this.t : Math.min(this.best, this.t);
        this.laps++;
      }
      this.running = true;
      this.t = 0;
      this.covered = 0;
    }
    this.idx = i;
  }
  snapshot() {
    return { running: this.running, t: this.t, last: this.last, best: this.best, laps: this.laps, progress: this.running ? Math.max(0, this.covered) / (this.line.length * this.step) : 0 };
  }
}
