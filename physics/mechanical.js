// Mechanical damage in the physics: what spec.damage (garage/stats.js, from each part's damage block:
// garage/mechanical.js) does to the car, and what changes as it drives. By the rules in
// spec.damage.rules (data/damage.json mechanical.effects).
//
// Each wheel (before(), every step, ahead of the suspension):
//   toe        it steers that much off (the car pulls); a damaged front also moves where the steering
//              settles hands-off (keyboard, pad): the steering wheel sits off-centre (centre)
//   camber     that tyre grips gripPerDeg less a degree (down to minGrip)
//   ride       it sits that much lower (a shorter spring at rest); damper: that share of its damping gone
//   bend       a bent rim: a wobble force with the wheel's turn, wobble N a mm at 100 km/h (by speed²)
//   pressure   a leaking tyre loses `leak` of its pressure a second: less grip (gripAtZero at the flat
//              point), a smaller radius (the sidewall sags dropShare at nothing, most of it near flat),
//              more rolling drag; below
//              flatBelow it's flat: on its rim, rimGrip, scraping
//   brake      that share of the corner's brake force gone
//   off        torn off: no wheel there — the corner drops onto the bare hub (hub.radius), which doesn't
//              roll: it slides along the road (hub.grip: steel on tarmac), dragging and scraping; its
//              drive shaft (if it's driven) turns free, so the diff sends the drive there
// The engine: its temperature — the heat of the fuel it burns (heatPerKw a kW it makes, idleHeat
// idling) against the radiator (cooling a °C over ambient, by the coolant left, the airflow and the
// thermostat). A leaking radiator loses coolant. At warn: a warning; at limp: limp mode (limpTorque of
// the torque, limpRpm rev limit) until it's down to recover; past cook it loses cookRate condition a
// second (physics/engineHealth.js), and can seize. Boost leak: that share of the turbo's boost gone.
// The clutch heats up slipping (heatCapacity J/°C, cooling a second); past wearFrom it wears, and a
// worn clutch holds capacityLoss × wear less. Gearbox: past failFrom a gear can fail to go in (up to
// failMax of the time; tried again after retry s), and it grinds from grindFrom. Diff: bias × damage of
// the torque to one side (an open diff feels it; a limited-slip one mostly locks it out), and a surge of
// ripple × damage once a turn (a chipped tooth: it judders under power).
//
// Tyre pressures, the coolant and the clutch's wear are live here, starting from the spec (as
// physics/engineHealth.js does with the engine's condition): changes() says what the game should
// write back; when the spec's own value changes (a repair, the write-back) the live one follows — up
// only for a repair. A wheel slammed hard (a kerb's edge at speed, a heavy landing: strike()) is an
// event for the game to damage that corner (garage/mechanical.js strikeMechanical).
//
// enabled: the game's damage setting (full damage: on; visual only or off: it drives as if new).
// events: { type: 'strike', wheel, kind: 'kerb' | 'landing', speed, strength } · { type: 'flat', wheel } · { type: 'overheat' | 'limp' |
// 'cooled' | 'cooking' } · { type: 'clutchHot' }

import { frictionTorque } from './engine.js';

const CORNERS = ['FL', 'FR', 'RL', 'RR'];
const DEG = Math.PI / 180, ATM = 1.01325;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function curveAt(c, x) {
  if (x <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) if (x <= c[i][0]) { const [x0, y0] = c[i - 1], [x1, y1] = c[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  return c[c.length - 1][1];
}
// (a small fixed random sequence: the same drive misses the same shifts)
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

export class Mechanical {
  constructor(vehicle) {
    this.v = vehicle;
    this.events = [];
    this.enabled = true;
    this.built = null;             // the spec's values last synced (pressures, coolant, clutch wear)
    this.live = null;
    this.random = rng(0x5eed);     // (which shifts a damaged gearbox misses: the same drive, the same misses)
    this.reset();
  }
  get spec() { return this.v.spec; }
  // the damage the car drives with (none: as new)
  get D() { return this.enabled ? this.spec.damage ?? null : null; }
  take() { return this.events.splice(0); }
  #emit(e) { this.events.push(e); if (this.events.length > 64) this.events.splice(0, this.events.length - 64); }

  // The car put back (reset): damage stays as it is, and so does the heat in the engine and clutch
  // (putting it back on the road doesn't cool it: cool() does, for a car as new)
  reset() {
    if (this.temp == null) this.cool();
    this.cooldown = Object.fromEntries(CORNERS.map(k => [k, 0]));
    this.flat ??= Object.fromEntries(CORNERS.map(k => [k, false]));      // (a flat tyre stays flat: said once)
    this.centre = 0;
    this.vibration = 0;
    this.flap = null;
    this.rimScrape = null;
    this.sync();
  }
  // The engine at its working temperature, the clutch cold, no warnings (a new drive, a car restored)
  cool() {
    const R = this.spec.damage?.rules;
    this.temp = R?.cooling?.thermostat ?? 90;
    this.clutchTemp = R?.cooling?.ambient ?? 25;
    this.limp = false; this.warn = false; this.cooking = false; this.clutchHot = false;
  }

  // From the spec: at the start, and when the garage changes a value the physics runs live
  sync() {
    const D = this.spec.damage;
    if (!D) { this.built = this.live = null; return; }
    const now = { pressure: Object.fromEntries(CORNERS.map(k => [k, D.wheels[k].pressure])), coolant: D.coolant, clutch: D.clutch };
    const was = this.built;
    this.built = now;
    if (!was || !this.live) { this.live = JSON.parse(JSON.stringify(now)); return; }
    // (repaired: as the garage has it; written back: the worse of the two)
    for (const k of CORNERS) this.live.pressure[k] = now.pressure[k] > was.pressure[k] ? now.pressure[k] : Math.min(this.live.pressure[k], now.pressure[k]);
    this.live.coolant = now.coolant > was.coolant ? now.coolant : Math.min(this.live.coolant, now.coolant);
    this.live.clutch = now.clutch < was.clutch ? now.clutch : Math.max(this.live.clutch, now.clutch);
  }
  #stale() {
    const D = this.spec.damage, b = this.built;
    if (!D !== !b) return true;
    if (!D) return false;
    return D.coolant !== b.coolant || D.clutch !== b.clutch || CORNERS.some(k => D.wheels[k].pressure !== b.pressure[k]);
  }

  // What's changed while driving, for the game to write back: { pressure: { FL: … }, coolant, clutch }
  // (only those more than a little off what the spec has; none: nothing to write)
  changes(min = 0.01) {
    if (!this.live || !this.built) return null;
    const out = {}, L = this.live, B = this.built;
    for (const k of CORNERS) if (Math.abs(L.pressure[k] - B.pressure[k]) >= min || (L.pressure[k] !== B.pressure[k] && L.pressure[k] <= 0)) (out.pressure ??= {})[k] = +L.pressure[k].toFixed(4);
    if (Math.abs(L.coolant - B.coolant) >= min || (L.coolant !== B.coolant && L.coolant <= 0)) out.coolant = +L.coolant.toFixed(4);
    if (Math.abs(L.clutch - B.clutch) >= min / 2) out.clutch = +L.clutch.toFixed(4);
    return Object.keys(out).length ? out : null;
  }

  // Once per step, before the suspension: each wheel's damaged values, and the drivetrain's faults
  before(dt, speed) {
    if (this.#stale()) this.sync();
    const S = this.spec.suspension, W = this.spec.wheels, D = this.D, v = this.v;
    let centre = 0, fronts = 0, vibration = 0;
    for (const w of v.wheels) {
      if (!D) { w.toe = 0; w.rest = S.restLength; w.dampK = 1; w.gripK = 1; w.radius = W.radius; w.brakeK = 1; w.rollExtra = 0; w.off = false; w.bend = 0; w.flat = false; w.pressure = 1; continue; }
      const d = D.wheels[w.name], R = D.rules, T = R.tyre, p = this.live.pressure[w.name];
      w.off = !!d.off;
      w.toe = d.toe * DEG;
      w.rest = S.restLength - d.ride;
      w.dampK = 1 - d.damper;
      w.brakeK = 1 - d.brake;
      w.bend = d.bend;
      w.pressure = p;
      w.flat = p <= T.flatBelow;
      if (w.off) {                       // (the bare hub, on its strut: low, slippery, dragging)
        Object.assign(w, { radius: R.hub.radius, gripK: R.hub.grip, rollExtra: 0, flat: true, pressure: 0, bend: 0 });
        continue;
      }
      const sidewall = Math.max(0, W.radius - (W.rimRadius ?? W.radius)), camber = Math.max(R.camber.minGrip, 1 - R.camber.gripPerDeg * Math.abs(d.camber));
      w.radius = W.radius - sidewall * T.dropShare * (1 - p) ** 3;          // (it only really sags near flat)
      w.gripK = camber * (w.flat ? T.rimGrip : p >= 1 ? 1 : T.gripAtZero + (1 - T.gripAtZero) * Math.sqrt((p - T.flatBelow) / (1 - T.flatBelow)));
      w.rollExtra = T.flatRolling * (1 - p) ** 2;
      if (w.front && !w.off) { centre += d.toe * DEG; fronts++; }
      vibration = Math.max(vibration, d.bend * (speed / 27.78) ** 2 / 8);
    }
    // (a damaged diff judders under power)
    if (D?.differential) vibration = Math.max(vibration, D.differential * D.rules.differential.ripple * 3 * v.throttle * Math.min(1, Math.abs(speed) / 5));
    // (hands off, the steering settles where the damaged front wheels' pull balances: part-way to straight)
    this.centre = D && fronts ? -centre / fronts * (D.rules.toe?.centreShare ?? 0) : 0;
    this.vibration = clamp(vibration, 0, 1);
    this.#faults(D);
  }

  // What the drivetrain does differently (physics/drivetrain.js reads dtr.faults)
  #faults(D) {
    const dtr = this.v.drivetrain;
    if (!D) { dtr.faults = null; return; }
    const R = D.rules, C = R.cooling, turbo = this.spec.turbo, leak = turbo?.boost && D.boost > 0 ? D.boost : 0;
    dtr.faults = {
      torque: this.limp ? C.limpTorque : 1,
      revLimit: this.limp ? C.limpRpm : null,
      // (a boost leak: the turbo's share of the torque, less that share of its boost)
      boost: leak ? rpm => { const b = (turbo.efficiency ?? 1) * curveAt(turbo.boost, rpm) / ATM; return (1 + b * (1 - leak)) / (1 + b); } : null,
      clutch: 1 - R.clutch.capacityLoss * this.live.clutch,
      diffBias: R.differential.bias * D.differential,
      diffRipple: R.differential.ripple * D.differential,
      gearbox: D.gearbox,
      gearRules: R.gearbox,
      random: this.random,
    };
  }

  // A wheel meeting the ground this step (the vehicle's suspension loop): landing (m/s it came down
  // at, from the air), or rise (m the ground came up under it since the last step, rolling at speed m/s)
  // and pitch (rad: how steeply the ground rises ahead of it there, from its normal). What it takes:
  //  - a slope (a ramp, a crest, the side of a round bump): the jolt of the ground's angle changing,
  //    speed × sin(the change) — never more than a solid wheel meeting a step that high would get;
  //  - a step the ground's angle doesn't explain (a kerb's square edge): a solid wheel of its radius
  //    climbing it at that speed, speed × sin of the angle it meets it at.
  // Past kerb.speed that's a strike (so is a landing past landing.speed), as hard as the excess × scale:
  // an event, for the game to damage that corner
  strike(w, { landing = null, rise = 0, speed = 0, pitch = 0 }, dt) {
    const R = this.D?.rules, was = w.pitch ?? 0;
    w.pitch = landing != null ? 0 : pitch;
    this.cooldown[w.name] = Math.max(0, this.cooldown[w.name] - dt);
    if (!R?.kerb || this.cooldown[w.name] > 0) return;
    let up = 0, kind = null, strength = 0;
    if (landing != null) { up = landing; if (landing > R.landing.speed) { strength = (landing - R.landing.speed) * R.landing.scale; kind = 'landing'; } }
    else if (rise > R.kerb.minStep) {
      const v = Math.abs(speed), ds = v * dt, solid = h => { const c = clamp((w.radius - h) / w.radius, 0, 1); return v * Math.sqrt(1 - c * c); };
      const slope = ds * Math.tan(clamp(Math.max(pitch, was, 0), 0, 1.4));
      up = slope >= rise * 0.7 ? Math.min(v * Math.sin(Math.max(0, pitch - was)), solid(rise)) : solid(rise - ds * Math.tan(clamp(was, 0, 1.4)));
      if (up > R.kerb.speed) { strength = (up - R.kerb.speed) * R.kerb.scale; kind = 'kerb'; }
    }
    this.lastUp = Math.max(this.lastUp ?? 0, up);
    if (!kind) return;
    this.cooldown[w.name] = 0.3;
    this.#emit({ type: 'strike', wheel: w.name, kind, speed: +up.toFixed(3), strength: +strength.toFixed(3) });
  }

  // A bent rim's wobble: a force at the wheel going round with it (m/s: the car's speed)
  wobble(w, speed, push, up, side) {
    if (!w.bend || w.off || !w.grounded) return;
    const A = this.D.rules.rim.wobble * w.bend * (speed / 27.78) ** 2, a = w.spin;
    push([up[0] * A * Math.sin(a) + side[0] * A * 0.5 * Math.cos(a), up[1] * A * Math.sin(a) + side[1] * A * 0.5 * Math.cos(a), up[2] * A * Math.sin(a) + side[2] * A * 0.5 * Math.cos(a)], w.origin);
  }

  // Once per step, after the tyres: the engine's heat, the clutch's, leaks, what the driver hears
  after(dt, speed) {
    const D = this.D, v = this.v, dtr = v.drivetrain, E = this.spec.engine;
    const R = D?.rules ?? this.spec.damage?.rules;
    if (!R) return;
    // tyres going down; flat ones on their rims
    let flap = null, scrape = null;
    for (const w of v.wheels) {
      if (!D) continue;
      // (a wheel torn off: its hub grinding along the road)
      if (w.off) { if (w.grounded && Math.abs(speed) > 0.5 && (!scrape || Math.abs(speed) > scrape.speed)) scrape = { wheel: w.name, amount: clamp(Math.abs(speed) / 10, 0.3, 1), speed: Math.abs(speed), material: 'metal', hub: true }; continue; }
      const leak = D.wheels[w.name].leak, L = this.live;
      if (leak > 0 && L.pressure[w.name] > 0) L.pressure[w.name] = Math.max(0, L.pressure[w.name] - leak * dt);
      const flat = L.pressure[w.name] <= R.tyre.flatBelow;
      if (flat && !this.flat[w.name]) this.#emit({ type: 'flat', wheel: w.name });
      this.flat[w.name] = flat;
      // (a soft tyre flaps, once a turn; a flat one scrapes on its rim)
      const soft = 1 - L.pressure[w.name], turn = Math.abs(w.omega) / (2 * Math.PI);
      if (soft > 0.25 && w.grounded && turn > 0.3 && (!flap || soft > flap.amount)) flap = { wheel: w.name, amount: soft, rate: turn };
      if (flat && w.grounded && Math.abs(speed) > 1 && (!scrape || Math.abs(speed) > scrape.speed)) scrape = { wheel: w.name, amount: clamp(Math.abs(speed) / 15, 0.15, 1), speed: Math.abs(speed), material: 'metal' };
    }
    this.flap = flap;
    this.rimScrape = scrape;

    // the engine's temperature
    const C = R.cooling, running = !dtr.health.blown && dtr.omega > 1;
    const kw = running ? Math.max(0, dtr.engineTorque + frictionTorque(E, dtr.rpm)) * dtr.omega / 1000 : 0;
    const heat = running ? C.idleHeat + C.heatPerKw * kw : 0;
    if (D && D.radiatorLeak > 0 && this.live.coolant > 0) this.live.coolant = Math.max(0, this.live.coolant - D.radiatorLeak * dt);
    const coolant = D ? this.live.coolant : 1;
    const radiator = C.dryShare + (1 - C.dryShare) * smoothstep(C.lowCoolant, C.fullCoolant, coolant);
    const air = C.airflowBase + (1 - C.airflowBase) * Math.min(1, Math.abs(speed) / C.airflowSpeed);
    const open = 0.08 + 0.92 * smoothstep(C.thermostat - 6, C.thermostat + 4, this.temp);
    this.temp += (heat - C.cooling * (this.spec.cooling?.capacity ?? 1) * (this.temp - C.ambient) * radiator * air * open) * dt;
    if (!D) { this.limp = this.warn = this.cooking = false; }
    else {
      const warn = this.temp >= C.warn || (this.warn && this.temp >= C.warn - 2);
      if (warn && !this.warn) this.#emit({ type: 'overheat', temp: this.temp });
      this.warn = warn;
      if (!this.limp && this.temp >= C.limp) { this.limp = true; this.#emit({ type: 'limp', temp: this.temp }); }
      else if (this.limp && this.temp < C.recover) { this.limp = false; this.#emit({ type: 'cooled', temp: this.temp }); }
      const cooking = running && (this.temp >= C.cook || (this.cooking && this.temp >= C.cook - 2));
      if (cooking && !this.cooking) this.#emit({ type: 'cooking', temp: this.temp });
      this.cooking = cooking;
      dtr.health.overheat(cooking ? C.cookRate * (1 + (this.temp - C.cook) / 10) * dt : 0, dt);
    }

    // the clutch: the heat of slipping
    const K = R.clutch, slip = dtr.gear !== 0 && !dtr.shifting && dtr.clutch > 0 && !dtr.clutchLocked ? Math.abs(dtr.rpm - dtr.lockedRpm()) * Math.PI / 30 : 0;
    this.clutchTemp += (Math.abs(dtr.clutchTorque) * slip / K.heatCapacity - K.cooling * (this.clutchTemp - C.ambient)) * dt;
    if (D && this.clutchTemp > K.wearFrom) this.live.clutch = Math.min(1, this.live.clutch + K.wearRate * (this.clutchTemp - K.wearFrom) * dt);
    const hot = this.clutchTemp > K.wearFrom || (this.clutchHot && this.clutchTemp > K.wearFrom - 15);
    if (D && hot && !this.clutchHot) this.#emit({ type: 'clutchHot', temp: this.clutchTemp });
    this.clutchHot = hot;
  }

  snapshot() {
    const D = this.D, L = this.live;
    return {
      enabled: this.enabled, temp: this.temp, coolant: D ? L.coolant : 1, warn: this.warn, limp: this.limp, cooking: this.cooking,
      clutchTemp: this.clutchTemp, clutchWear: D ? L.clutch : 0, boost: D?.boost ?? 0, gearbox: D?.gearbox ?? 0, differential: D?.differential ?? 0,
      exhaust: D?.exhaust ?? 0, radiatorLeak: D?.radiatorLeak ?? 0, vibration: this.vibration, centre: this.centre, flap: this.flap, rimScrape: this.rimScrape,
      wheels: Object.fromEntries(this.v.wheels.map(w => [w.name, { pressure: w.pressure ?? 1, flat: !!w.flat, off: !!w.off, bend: w.bend ?? 0, toe: D?.wheels[w.name].toe ?? 0, leak: D?.wheels[w.name].leak ?? 0 }])),
    };
  }
}
