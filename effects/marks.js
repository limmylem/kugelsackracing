// Marks left on the road (data/effects.json marks): skid marks and drips. Each is a flat quad on the
// ground with a colour, how strongly it's there at its two ends (a skid mark's piece fades in and out
// with the slide), when it was made and how long it takes to fade (the last third of that it fades out).
// A ring buffer: at most `limit` stay (the budget × the quality's marks); a new one past that replaces
// the oldest. The renderers draw them from these arrays and redraw only the slots that changed
// (takeChanges), working out the fading themselves from `time` and each one's birth (born) and fade.
//
// In the simulation's frame (y up); shift() moves them with a floating origin. No rendering here.

import { rotate } from '../physics/math.js';

export class MarkLayer {
  constructor(capacity) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 12);       // 4 corners
    this.colour = new Float32Array(capacity * 3);
    this.alpha = new Float32Array(capacity * 2);      // at its start edge (corners 0, 1) and its end (2, 3)
    this.born = new Float32Array(capacity).fill(-1e9);
    this.fade = new Float32Array(capacity).fill(1);
    this.round = new Uint8Array(capacity);            // drawn as a round drop (a drip), not a strip
    this.limit = capacity;
    this.next = 0;
    this.count = 0;                                   // slots in use (0 … count-1)
    this.time = 0;
    this.changed = new Set();
    this.version = 0;                                 // bumped when everything should be redrawn
  }
  // At most this many (the quality setting): fewer drops the oldest
  setLimit(n) {
    n = Math.max(1, Math.min(this.capacity, Math.round(n)));
    if (n === this.limit) return;
    if (n < this.limit) this.clear();
    this.limit = n;
  }
  clear() { this.alpha.fill(0); this.born.fill(-1e9); this.next = 0; this.count = 0; this.changed.clear(); this.version++; }

  // A mark: corners [[x, y, z] × 4] (around it in order), colour [r, g, b], alpha at its start and end, fade (s),
  // round: a drop (drawn as a disc inside its corners)
  add(corners, colour, a0, a1, fade, round = false) {
    const i = this.next;
    this.next = (this.next + 1) % this.limit;
    this.count = Math.min(this.limit, Math.max(this.count, i + 1));
    for (let c = 0; c < 4; c++) for (let k = 0; k < 3; k++) this.pos[i * 12 + c * 3 + k] = corners[c][k];
    this.colour.set(colour, i * 3);
    this.alpha[i * 2] = a0; this.alpha[i * 2 + 1] = a1;
    this.born[i] = this.time; this.fade[i] = fade; this.round[i] = round ? 1 : 0;
    this.changed.add(i);
    return i;
  }
  // How strongly mark i shows now (× its alpha): whole, then fading out over the last third of its fade
  strength(i, time = this.time) {
    const age = time - this.born[i], f = this.fade[i];
    if (age >= f) return 0;
    const t = Math.min(1, Math.max(0, (age - f * 2 / 3) / (f / 3)));
    return 1 - t * t * (3 - 2 * t);
  }
  get live() { let n = 0; for (let i = 0; i < this.count; i++) if (this.strength(i) > 0) n++; return n; }
  update(dt) { this.time += dt; }
  // the slots changed since the last call (a renderer redraws those)
  takeChanges() { const out = [...this.changed]; this.changed.clear(); return out; }

  shift(q, t) {
    for (let i = 0; i < this.count; i++) {
      for (let c = 0; c < 4; c++) {
        const j = i * 12 + c * 3, p = rotate(q, [this.pos[j], this.pos[j + 1], this.pos[j + 2]]);
        this.pos[j] = p[0] + t[0]; this.pos[j + 1] = p[1] + t[1]; this.pos[j + 2] = p[2] + t[2];
      }
    }
    this.version++;
  }
}
