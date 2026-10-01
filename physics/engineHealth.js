// The engine's health while it runs.
//
// Over-revving: the wheels driving the engine past its redline (a downshift at too high a speed: the
// rev limiter can't stop that) does damage by how far past and for how long, in the bands of the
// engine's overRev block (fractions over redlineRpm):
//   valve float  (valveFloat .. bentValves): the valves can't close in time; the engine stutters and
//                drags while it's there, and wears a little (floatWear condition points a second at the
//                top of the band)
//   bent valves  (bentValves .. blown), bendTime s there: the valves hit the pistons; the condition drops
//                by bentLoss (up to 1.6× that at the top of the band), then bentWear a second while it
//                stays there; from then on it misfires
//   blown        (blown and past), blowTime s there: condition 0, the engine stops and won't run again
//                until it's repaired
// A worn engine (condition under misfireBelow) misfires: some of its firings lost (up to `misfire` of
// them at condition 0), picked by a fixed pattern so the same drive does the same thing; it runs rough
// and down on power.
//
// It starts from the engine part's condition (spec.engine.condition, from the garage: the torque curve
// already allows for it). Wear from here scales the torque by the same condition curve (spec.engine.wear),
// so the engine drives the same before and after the garage writes the new condition back. What happens
// goes into `events` for the game to show and to write back to the part:
//   { type: 'float', over } an over-rev started · { type: 'bent', over, condition } · { type: 'blown', over }
//   { type: 'incident', from, condition, peak, seconds, worst: 'float' | 'bent' | 'blown' | 'cooked' } it's over
// Overheating (overheat(), from physics/mechanical.js) costs condition too, and can seize it: the same
// events, with cause: 'overheat'.

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
function curveAt(curve, x) {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) if (x <= curve[i][0]) { const [x0, y0] = curve[i - 1], [x1, y1] = curve[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  return curve[curve.length - 1][1];
}
// (a firing's place in the fixed misfire pattern, 0..1)
function pattern(n) {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export class EngineHealth {
  constructor(spec, events) {
    this.spec = spec;
    this.events = events;
    this.sync();
  }

  // From the spec: at the start, and whenever the garage changes the engine's condition (a repair, or
  // the damage written back)
  sync() {
    const E = this.spec.engine, was = this.built;
    this.built = E.condition ?? 100;
    if (was == null || this.built > was) {        // (new, or repaired: as the garage has it)
      this.condition = this.built;
      this.cook = null;
      this.blown = !!E.blown || this.built <= 0;
      this.incident = null;
      this.over = 0;
      this.floating = false;
    } else {                                      // (damage written back, maybe mid-over-rev: keep the worst)
      this.condition = Math.min(this.condition, this.built);
      this.blown ||= !!E.blown || this.built <= 0;
    }
    this.#rescale();
  }
  // The car put back (reset): an over-rev (or overheating) under way ends there
  reset() { if (this.incident) this.#end(); this.#endCook(); this.floating = false; this.over = 0; }

  // Overheating (physics/mechanical.js): points of condition lost this step (0: it's not cooking). While
  // it lasts it's an incident like an over-rev (written back every 5 s of it, and when it's over); at
  // nothing left the engine seizes: blown
  overheat(points, dt) {
    if (this.blown || points <= 0) { this.#endCook(); return; }
    const c = this.cook ??= { from: this.condition, seconds: 0 };
    c.seconds += dt;
    this.condition = Math.max(0, this.condition - points);
    this.#rescale();
    if (this.condition <= 0) { this.blown = true; this.#rescale(); this.#emit({ type: 'blown', over: 0, cause: 'overheat' }); }
    if (this.blown || c.seconds >= 5) this.#endCook();
  }
  #endCook() {
    const c = this.cook;
    if (!c) return;
    this.cook = null;
    this.#emit({ type: 'incident', from: c.from, condition: this.condition, peak: 0, seconds: c.seconds, worst: this.blown ? 'blown' : 'cooked', cause: 'overheat' });
  }

  // Once per physics step, with the engine speed
  update(dt, rpm) {
    const E = this.spec.engine, O = E.overRev;
    if ((E.condition ?? 100) !== this.built) this.sync();
    this.over = rpm / E.redlineRpm - 1;
    if (!O || this.blown) { this.floating = false; return; }
    const over = this.over;
    if (over <= O.valveFloat) {
      this.floating = false;
      if (this.incident && over <= 0) this.#end();
      return;
    }
    let inc = this.incident;
    if (!inc) { inc = this.incident = { from: this.condition, seconds: 0, peak: 0, bendTimer: 0, blowTimer: 0, bent: false }; this.#emit({ type: 'float', over }); }
    this.floating = true;
    inc.seconds += dt;
    inc.peak = Math.max(inc.peak, over);
    if (over >= O.blown && (inc.blowTimer += dt) >= O.blowTime) { this.#blow(over); return; }
    if (over >= O.bentValves) {
      inc.bendTimer += dt;
      if (!inc.bent && inc.bendTimer >= O.bendTime) {
        inc.bent = true;
        this.#lose(O.bentLoss * (1 + 0.6 * clamp((over - O.bentValves) / (O.blown - O.bentValves), 0, 1)));
        this.#emit({ type: 'bent', over, condition: this.condition });
      } else if (inc.bent) this.#lose(O.bentWear * dt);
    } else this.#lose(O.floatWear * over / O.bentValves * dt);
  }

  // Whether firing n (counted from the start of the drive) misfires
  misfires(n) { return this.misfireShare > 0 && pattern(n) < this.misfireShare; }

  #lose(points) { this.condition = Math.max(1, this.condition - points); this.#rescale(); }
  #blow(over) {
    this.blown = true;
    this.condition = 0;
    this.#rescale();
    this.#emit({ type: 'blown', over });
    this.#end();
  }
  #end() {
    const inc = this.incident;
    this.incident = null;
    this.#emit({ type: 'incident', from: inc.from, condition: this.condition, peak: inc.peak, seconds: inc.seconds, worst: this.blown ? 'blown' : inc.bent ? 'bent' : 'float' });
  }
  // the torque against what the spec was built for, and the share of firings lost, at this condition
  #rescale() {
    const E = this.spec.engine, W = E.wear, O = E.overRev;
    this.scale = W && this.condition !== this.built ? curveAt(W.curve, W.average + (this.condition - this.built) * W.share) / curveAt(W.curve, W.average) : 1;
    this.misfireShare = O?.misfireBelow && this.condition < O.misfireBelow ? O.misfire * (O.misfireBelow - this.condition) / O.misfireBelow : 0;
  }
  #emit(e) { this.events.push(e); if (this.events.length > 64) this.events.splice(0, this.events.length - 64); }

  snapshot() { return { condition: this.condition, blown: this.blown, over: this.over, floating: this.floating, misfire: this.misfireShare }; }
}
