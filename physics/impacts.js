// Crashes: what the car's body hits. After every physics step, the car's collider's contacts (Rapier's
// contact manifolds) say where it's touching something, which way, and how hard the solver pushed.
// An impact is a new contact (or, while one lasts, a sudden hard push) closing faster than minSpeed:
//   { time, point, normal, yRange, closing, strength, impulse, material, other, under }
// point: where it hit (car frame, impulse-weighted over the contact points; yRange: how high they
// reached, which says what's low or tall enough to be hit; extent: the box round them, how wide: a
// wall touches the whole front, a pole one spot); normal: out of the car toward what it hit
// (car frame); closing: how fast the car was going into it along the normal before the step (m/s);
// strength: that, less for something light (a cone moves out of the way: the push it took says so);
// material: what it hit ('concrete', 'metal', 'wood', 'ground' from the world's colliders, 'car',
// 'plastic' for a loose prop); other: 'world' | 'car' | 'prop'; under: it's under the car (the floor
// pan: only a hard landing counts). Sliding along something, pressed on, is a scrape: the strongest
// this step is `scrape` ({ amount 0..1, speed, force, material }, or null).
//
// The tyres are rays, not colliders, so driving never touches anything here; the body touching the
// road (a jump, a crest) is filtered by groundMinSpeed. Nothing here changes the physics.

import { add, cross, dot, fromXYZ, rotate, scale, sub } from './math.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const conj = q => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
export const materialOf = c => c.userData?.material ?? (c.userData?.vehicle ? 'car' : c.parent()?.isDynamic() ? 'plastic' : 'concrete');

export class ImpactSensor {
  // rules: settings.impacts
  constructor(vehicle, rules) {
    this.v = vehicle;
    this.rules = rules;
    this.events = [];
    this.pairs = new Map();       // other collider's handle → the contact as it goes
    this.scrape = null;
    this.pre = null;
  }
  reset() { this.pairs.clear(); this.scrape = null; this.events.length = 0; this.pre = null; }
  // The impacts since the last call
  take() { return this.events.splice(0); }

  // Before the world steps: how the car was moving (a contact's closing speed is from before the
  // solver stops it)
  before() {
    const b = this.v.body;
    this.pre = { lin: fromXYZ(b.linvel()), ang: fromXYZ(b.angvel()), com: fromXYZ(b.worldCom()) };
  }

  // After the world steps: read the contacts. time: the simulation's time (s)
  after(dt, time) {
    const v = this.v, R = this.rules, world = v.world, b = v.body, pre = this.pre;
    if (!R || !pre) return;
    const q = b.rotation(), pos = fromXYZ(b.translation()), toWorld = p => add(pos, rotate(q, p));
    const lin = fromXYZ(b.linvel()), ang = fromXYZ(b.angvel()), com = fromXYZ(b.worldCom()), bc = v.spec.bodyCollider.centre;
    const mass = b.mass();
    this.scrape = null;
    world.contactPairsWith(v.collider, other => {
      let J = 0, w = 0, c = [0, 0, 0], n = [0, 0, 0], yMin = Infinity, yMax = -Infinity;
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      world.contactPair(v.collider, other, (m, flipped) => {
        const nl = fromXYZ(flipped ? m.localNormal2() : m.localNormal1());
        for (let i = 0; i < m.numContacts(); i++) {
          if (m.contactDist(i) > 0.02) continue;
          const p = add(fromXYZ(flipped ? m.localContactPoint2(i) : m.localContactPoint1(i)), bc), j = m.contactImpulse(i), k = j + 1e-6;
          J += j; w += k; c = add(c, scale(p, k)); n = add(n, scale(nl, k));
          yMin = Math.min(yMin, p[1]); yMax = Math.max(yMax, p[1]);
          for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
        }
      });
      if (!w) return;
      const point = scale(c, 1 / w), nLen = Math.hypot(...n) || 1, normal = scale(n, 1 / nLen), nWorld = rotate(q, normal), at = toWorld(point);
      // the other body's motion (another car: as it was before the step, from its own sensor)
      const ob = other.parent(), dyn = !!ob?.isDynamic(), otherCar = other.userData?.vehicle;
      const oPre = otherCar?.sensor?.pre;
      const velOf = (l, a, cm) => add(l, cross(a, sub(at, cm)));
      const vOtherPre = !dyn ? [0, 0, 0] : oPre ? velOf(oPre.lin, oPre.ang, oPre.com) : velOf(fromXYZ(ob.linvel()), fromXYZ(ob.angvel()), fromXYZ(ob.worldCom()));
      const vOther = !dyn ? [0, 0, 0] : velOf(fromXYZ(ob.linvel()), fromXYZ(ob.angvel()), fromXYZ(ob.worldCom()));
      const closing = dot(sub(velOf(pre.lin, pre.ang, pre.com), vOtherPre), nWorld);
      const mRed = dyn ? mass * ob.mass() / (mass + ob.mass()) : mass;
      const under = nWorld[1] < -R.groundUp, material = materialOf(other), kind = otherCar ? 'car' : dyn ? 'prop' : 'world';
      let s = this.pairs.get(other.handle);
      const shape = { point, normal, yRange: [yMin, yMax], extent: { min: lo, max: hi }, material, other: kind, under, mRed };
      const impact = (cl, imp) => impactOf(time, shape, cl, imp);
      if (!s || time - s.lastSeen > 0.1) {
        s = { start: time, closing, J: 0, emitted: false, lastEvent: s?.lastEvent ?? -Infinity, lastSeen: time };
        this.pairs.set(other.handle, s);
      }
      s.lastSeen = time;
      if (!s.emitted && J >= s.peak?.J) s.peak = { J, shape };
      s.peak ??= { J, shape };
      const min = under ? R.groundMinSpeed : R.minSpeed;
      if (!s.emitted) {
        s.J += J;
        s.closing = Math.max(s.closing, closing);
        if (time - s.start >= R.window - 1e-9) {
          s.emitted = true;
          const e = impact(s.closing, s.J);
          if (e.closing >= min && e.strength >= min * 0.5 && time - s.lastEvent >= R.cooldown) { this.events.push(e); s.lastEvent = time; }
        }
      } else if (J / mRed > R.spike && closing >= min && time - s.lastEvent >= R.cooldown) {
        // (still touching, and hit harder: into the wall again, another car shunting it)
        const e = impact(closing, J);
        if (e.strength >= min) { this.events.push(e); s.lastEvent = time; }
      }
      // sliding along it, pressed on
      const rel = sub(velOf(lin, ang, com), vOther), slide = sub(rel, scale(nWorld, dot(rel, nWorld))), speed = Math.hypot(...slide), force = J / dt;
      if (speed > R.scrapeSpeed && force > R.scrapeForce) {
        const amount = clamp(speed / 20, 0, 1) * Math.sqrt(clamp(force / 8000, 0, 1));
        if (!this.scrape || amount > this.scrape.amount) this.scrape = { amount, speed, force, material, under, point };
      }
    });
    // (a hit so hard the car bounced straight off, before the window was up: what it built up, now)
    for (const s of this.pairs.values()) {
      if (s.emitted || s.lastSeen >= time) continue;
      s.emitted = true;
      const e = impactOf(time, s.peak.shape, s.closing, s.J), min = e.under ? R.groundMinSpeed : R.minSpeed;
      if (e.closing >= min && e.strength >= min * 0.5 && time - s.lastEvent >= R.cooldown) { this.events.push(e); s.lastEvent = time; }
    }
    for (const [h, s] of this.pairs) if (time - s.lastSeen > 0.5) this.pairs.delete(h);
    if (this.events.length > 32) this.events.splice(0, this.events.length - 32);
  }
}

// An impact from a contact's shape (where, which way, how wide, what: its hardest step) and how fast it
// closed and the push it took
function impactOf(time, sh, closing, impulse) {
  return {
    time, point: sh.point, normal: sh.normal, yRange: sh.yRange, extent: sh.extent, closing, impulse,
    strength: closing * clamp(impulse / (sh.mRed * Math.max(closing, 1e-3)), 0, 1), material: sh.material, other: sh.other, under: sh.under,
  };
}

// A car-frame direction or point in the world (for drawing)
export const carToWorld = (body, p) => add(fromXYZ(body.translation()), rotate(body.rotation(), p));
export const worldToCar = (body, p) => rotate(conj(body.rotation()), sub(p, fromXYZ(body.translation())));
