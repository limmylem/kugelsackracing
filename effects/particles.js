// Particles for the visual effects (data/effects.json): a fixed pool, nothing created while playing.
//
// Every particle lives in a set of typed arrays (struct of arrays) sized once for the budget; a free list
// hands out slots and takes them back, and `list` holds the live ones (the renderers draw those). Each
// belongs to an effect (sparks, tyreSmoke…) whose settings say how it moves and fades: gravity, drag
// toward the air's motion (so smoke drifts with the wind), buoyancy, and the ground — each particle
// keeps the height of the ground under where it was made (floor): falling bits bounce off it, smoke
// can't sink through it. Each effect has its own limit and the whole pool its budget (both × the
// quality setting); past the budget a new particle takes the place of one near the end of its life.
//
// The quality setting (low / medium / high) scales how many each effect makes, their size, how long they
// last, and how far from the viewer effects play (amount(): fewer further away, none past drawDistance).
// Everything is in the simulation's frame (y up); shift() moves it all with a floating origin.
//
// No rendering here (effects/threeRenderer.js, effects/cesiumRenderer.js draw it), so it runs in Node.

import { rotate } from '../physics/math.js';

export const STYLES = ['puff', 'spark', 'flame', 'shard', 'chip'];
const STYLE = Object.fromEntries(STYLES.map((s, i) => [s, i]));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// "#rrggbb" → [r, g, b] (0..1, as written: the renderers take care of colour spaces)
export function rgb(hex, out = [0, 0, 0]) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  out[0] = ((n >> 16) & 255) / 255; out[1] = ((n >> 8) & 255) / 255; out[2] = (n & 255) / 255;
  return out;
}

// The settings for a quality level, and every effect's numbers ready to use
export function resolveEffects(cfg, level = cfg.default) {
  const Q = cfg.quality[level] ?? cfg.quality[cfg.default];
  const effects = Object.entries(cfg.effects).map(([name, e], id) => ({
    ...e, name, id, styleId: STYLE[e.style] ?? 0, limitNow: Math.max(1, Math.round(e.limit * Q.count)),
  }));
  return { level: cfg.quality[level] ? level : cfg.default, Q, effects, byName: Object.fromEntries(effects.map(e => [e.name, e])) };
}

export class ParticleSystem {
  constructor(cfg, level = cfg.default, { random = Math.random } = {}) {
    this.cfg = cfg;
    this.random = random;
    this.capacity = cfg.budget.particles;            // (the arrays: the most any quality uses)
    const n = this.capacity;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n); this.life = new Float32Array(n);
    this.size0 = new Float32Array(n); this.size = new Float32Array(n);
    this.col0 = new Float32Array(n * 3); this.col1 = new Float32Array(n * 3); this.colour = new Float32Array(n * 3);
    this.alpha0 = new Float32Array(n); this.alpha = new Float32Array(n);
    this.floor = new Float32Array(n); this.seed = new Float32Array(n);
    this.style = new Uint8Array(n); this.effect = new Uint8Array(n);
    this.list = new Uint32Array(n);                  // the live particles: list[0 … count-1]
    this.at = new Int32Array(n).fill(-1);            // a particle's place in list
    this.free = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.free[i] = n - 1 - i;
    this.freeCount = n;
    this.count = 0;
    this.viewer = null;
    this.cursor = 0;
    this.stats = { emitted: 0, stolen: 0, refused: 0, updateMs: 0 };
    this.setQuality(level);
  }

  setQuality(level) {
    const r = resolveEffects(this.cfg, level);
    Object.assign(this, { level: r.level, Q: r.Q, effects: r.effects, byName: r.byName });
    this.budget = Math.max(1, Math.min(this.capacity, Math.round(this.cfg.budget.particles * this.Q.budget)));
    this.counts = new Int32Array(this.effects.length);
    for (let k = 0; k < this.count; k++) this.counts[this.effect[this.list[k]]]++;
    while (this.count > this.budget) this.#kill(this.list[this.count - 1]);
  }

  // Where the camera is (for amount(): fewer effects far away)
  setViewer(p) { this.viewer = p ? [p[0], p[1], p[2]] : null; }
  // How much of an effect plays at p: 1 near the viewer, less to 0 at the draw distance (× the quality's count)
  detail(p) {
    if (!this.viewer || !p) return 1;
    const d = Math.hypot(p[0] - this.viewer[0], p[1] - this.viewer[1], p[2] - this.viewer[2]), Q = this.Q;
    return d <= Q.fullDetail ? 1 : d >= Q.drawDistance ? 0 : 1 - (d - Q.fullDetail) / (Q.drawDistance - Q.fullDetail);
  }
  // n particles wanted at p: how many to make (the quality and the distance; a fraction left over
  // rounds up at random, so a trickle of less than one a frame still comes out right on average)
  amount(n, p) {
    const x = n * this.Q.count * this.detail(p), whole = Math.floor(x);
    return whole + (this.random() < x - whole ? 1 : 0);
  }

  // A particle of an effect: { position, velocity, colour [r, g, b], colourEnd, alpha (× the effect's),
  // size (× the effect's), life (× the effect's), floor (the ground's height there) }. Returns its slot,
  // or -1 if its effect is at its limit
  emit(name, o) {
    const e = this.byName[name];
    if (!e) throw new Error(`no effect "${name}" (data/effects.json)`);
    if (this.counts[e.id] >= e.limitNow) { this.stats.refused++; return -1; }
    let i;
    if (this.count >= this.budget || !this.freeCount) { i = this.#victim(); this.#kill(i); this.stats.stolen++; }
    i = this.free[--this.freeCount];
    this.at[i] = this.count; this.list[this.count++] = i;
    this.counts[e.id]++;
    const R = this.random, Q = this.Q, p = o.position, v = o.velocity ?? [0, 0, 0], c = o.colour ?? [1, 1, 1], c1 = o.colourEnd ?? c;
    this.pos[i * 3] = p[0]; this.pos[i * 3 + 1] = p[1]; this.pos[i * 3 + 2] = p[2];
    this.vel[i * 3] = v[0]; this.vel[i * 3 + 1] = v[1]; this.vel[i * 3 + 2] = v[2];
    for (let k = 0; k < 3; k++) { this.col0[i * 3 + k] = c[k]; this.col1[i * 3 + k] = c1[k]; this.colour[i * 3 + k] = c[k]; }
    this.age[i] = 0;
    this.life[i] = (e.life[0] + R() * e.life[1]) * (o.life ?? 1) * Q.life;
    this.size0[i] = this.size[i] = (e.size[0] + R() * e.size[1]) * (o.size ?? 1) * Q.size;
    this.alpha0[i] = e.alpha * (o.alpha ?? 1); this.alpha[i] = e.styleId === STYLE.puff ? 0 : this.alpha0[i];
    this.floor[i] = o.floor ?? -1e9;
    this.seed[i] = R();
    this.style[i] = e.styleId; this.effect[i] = e.id;
    this.stats.emitted++;
    return i;
  }

  // (a particle to make room: of the next few, the one furthest through its life)
  #victim() {
    let best = this.list[this.cursor % this.count], worst = -1;
    for (let k = 0; k < 8; k++) {
      const i = this.list[(this.cursor + k) % this.count], t = this.age[i] / this.life[i];
      if (t > worst) { worst = t; best = i; }
    }
    this.cursor = (this.cursor + 8) % Math.max(1, this.count);
    return best;
  }
  #kill(i) {
    const k = this.at[i];
    if (k < 0) return;
    const last = this.list[--this.count];
    this.list[k] = last; this.at[last] = k;
    this.at[i] = -1;
    this.free[this.freeCount++] = i;
    this.counts[this.effect[i]]--;
  }
  clear() { while (this.count) this.#kill(this.list[this.count - 1]); }

  // Move everything on by dt: wind is the air's motion ([x, y, z] m/s)
  update(dt, wind = null) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const P = this.pos, V = this.vel, E = this.effects, wx = wind?.[0] ?? 0, wy = wind?.[1] ?? 0, wz = wind?.[2] ?? 0, g = 9.81 * dt;
    for (let k = this.count - 1; k >= 0; k--) {
      const i = this.list[k], e = E[this.effect[i]];
      const age = this.age[i] += dt, life = this.life[i];
      if (age >= life) { this.#kill(i); continue; }
      const j = i * 3, f = 1 - Math.exp(-e.drag * dt);
      // (drag pulls it toward the air's motion: the wind)
      V[j] += (wx - V[j]) * f; V[j + 1] += (wy - V[j + 1]) * f; V[j + 2] += (wz - V[j + 2]) * f;
      V[j + 1] += e.buoyancy * dt - e.gravity * g;
      P[j] += V[j] * dt; P[j + 1] += V[j + 1] * dt; P[j + 2] += V[j + 2] * dt;
      const fl = this.floor[i];
      if (P[j + 1] < fl) {
        P[j + 1] = fl;
        if (V[j + 1] < 0) {
          if (e.bounce > 0 && V[j + 1] < -0.4) { V[j + 1] *= -e.bounce; V[j] *= 0.6; V[j + 2] *= 0.6; }
          else { V[j + 1] = 0; const s = e.gravity > 0 ? Math.exp(-6 * dt) : 1; V[j] *= s; V[j + 2] *= s; }     // (lying on the ground)
        }
      }
      const x = age / life, st = this.style[i];
      this.size[i] = this.size0[i] * (1 + e.growth * x);
      const a0 = this.alpha0[i];
      this.alpha[i] = st === 0 ? a0 * (1 - x) ** 1.5 * Math.min(1, age * 8)       // puff: in fast, out slowly
        : st === 1 ? a0 * (1 - x) ** 0.7                                       // spark
        : st === 2 ? a0 * (1 - x) * Math.min(1, age * 20)                       // flame
        : a0 * clamp((1 - x) / 0.3, 0, 1);                                      // shard, chip: whole, then gone
      for (let c = 0; c < 3; c++) this.colour[j + c] = this.col0[j + c] + (this.col1[j + c] - this.col0[j + c]) * x;
    }
    if (t0) this.stats.updateMs += ((performance.now() - t0) - this.stats.updateMs) * 0.1;
  }

  // A floating origin: everything re-expressed where p becomes rotate(q, p) + t
  shift(q, t) {
    const rot = (x, y, z) => rotate(q, [x, y, z]);
    for (let k = 0; k < this.count; k++) {
      const i = this.list[k], j = i * 3, p = rot(this.pos[j], this.pos[j + 1], this.pos[j + 2]), v = rot(this.vel[j], this.vel[j + 1], this.vel[j + 2]);
      const fl = rot(this.pos[j], this.floor[i], this.pos[j + 2]);
      this.pos[j] = p[0] + t[0]; this.pos[j + 1] = p[1] + t[1]; this.pos[j + 2] = p[2] + t[2];
      this.vel[j] = v[0]; this.vel[j + 1] = v[1]; this.vel[j + 2] = v[2];
      this.floor[i] = this.floor[i] < -1e8 ? this.floor[i] : fl[1] + t[1];
    }
    if (this.viewer) { const v = rot(...this.viewer); this.viewer = [v[0] + t[0], v[1] + t[1], v[2] + t[2]]; }
  }

  // How many are alive, of each effect
  byEffect() { return Object.fromEntries(this.effects.map(e => [e.name, this.counts[e.id]])); }
}
