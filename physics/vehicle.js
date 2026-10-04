// Raycast-suspension vehicle with a Pacejka tyre model and a full drivetrain (drivetrain.js), on a
// single Rapier rigid body. Rapier provides the body and collisions; suspension, wheel spin, tyre
// forces and the engine are ours. Every number comes from the car spec. No rendering here: the output
// is plain state for whoever draws it.
//
// Car frame: +x left, +y up, +z forward, origin on the ground under the middle of the car.

import { add, clamp, cross, dot, fromXYZ, length, normalize, quatFromAxisAngle, rotate, scale, sub, toXYZ } from './math.js';
import { Drivetrain } from './drivetrain.js';
import { Brakes } from './brakes.js';
import { Controls } from './controls.js';
import { Aero, SEA_LEVEL_DENSITY } from './aero.js';
import { breathing } from './engine.js';
import { CAR_GROUPS } from './looseParts.js';
import { Mechanical } from './mechanical.js';

// ray queries against the fixed world only (Rapier QueryFilterFlags EXCLUDE_KINEMATIC | EXCLUDE_DYNAMIC: no
// JS callback per collider)
export const FIXED_ONLY = 6;

const WHEELS = ['FL', 'FR', 'RL', 'RR'];
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Pacejka Magic Formula, per unit of load: D * sin(C * atan(B*x - E*(B*x - atan(B*x))))
export function magicFormula({ B, C, D, E }, x) {
  const bx = B * x;
  return D * Math.sin(C * Math.atan(bx - E * (bx - Math.atan(bx))));
}

// The car's principal moments of inertia and the frame they're about (Rapier's mass properties):
// from spec.inertiaTensor ([xx, yy, zz, xy, xz, yz] about the centre of mass, car frame: the parts
// system works it out from the chassis and every part), else a solid box the size of spec.inertiaBox
// with the car's mass (a Phase 1 spec)
const NO_TURN = { x: 0, y: 0, z: 0, w: 1 };
export function massFrame(spec) {
  if (!spec.inertiaTensor) {
    const [w, h, l] = spec.inertiaBox, m = spec.mass;
    return { principal: { x: m / 12 * (h * h + l * l), y: m / 12 * (w * w + l * l), z: m / 12 * (w * w + h * h) }, frame: NO_TURN };
  }
  const [xx, yy, zz, xy, xz, yz] = spec.inertiaTensor;
  if (xy === 0 && xz === 0 && yz === 0) return { principal: { x: xx, y: yy, z: zz }, frame: NO_TURN };
  // (not lined up with the car: its principal axes, by Jacobi rotations)
  const a = [[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]], v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    if (Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]) < 1e-12 * (Math.abs(a[0][0]) + Math.abs(a[1][1]) + Math.abs(a[2][2]))) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (a[p][q] === 0) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1)), c = 1 / Math.sqrt(t * t + 1), sn = t * c;
      for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - sn * akq; a[k][q] = sn * akp + c * akq; }
      for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - sn * aqk; a[q][k] = sn * apk + c * aqk; }
      for (let k = 0; k < 3; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - sn * vkq; v[k][q] = sn * vkp + c * vkq; }
    }
  }
  // (the principal axes as the columns of a rotation: right-handed)
  if (cross([v[0][0], v[1][0], v[2][0]], [v[0][1], v[1][1], v[2][1]]).reduce((s, x, k) => s + x * v[k][2], 0) < 0) for (let k = 0; k < 3; k++) v[k][2] = -v[k][2];
  const tr = v[0][0] + v[1][1] + v[2][2];
  let q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = { w: s / 4, x: (v[2][1] - v[1][2]) / s, y: (v[0][2] - v[2][0]) / s, z: (v[1][0] - v[0][1]) / s }; }
  else if (v[0][0] > v[1][1] && v[0][0] > v[2][2]) { const s = Math.sqrt(1 + v[0][0] - v[1][1] - v[2][2]) * 2; q = { w: (v[2][1] - v[1][2]) / s, x: s / 4, y: (v[0][1] + v[1][0]) / s, z: (v[0][2] + v[2][0]) / s }; }
  else if (v[1][1] > v[2][2]) { const s = Math.sqrt(1 + v[1][1] - v[0][0] - v[2][2]) * 2; q = { w: (v[0][2] - v[2][0]) / s, x: (v[0][1] + v[1][0]) / s, y: s / 4, z: (v[1][2] + v[2][1]) / s }; }
  else { const s = Math.sqrt(1 + v[2][2] - v[0][0] - v[1][1]) * 2; q = { w: (v[1][0] - v[0][1]) / s, x: (v[0][2] + v[2][0]) / s, y: (v[1][2] + v[2][1]) / s, z: s / 4 }; }
  return { principal: { x: a[0][0], y: a[1][1], z: a[2][2] }, frame: q };
}

// Slip where a Magic Formula curve peaks (found numerically, once per curve)
function peakSlip(p) {
  let best = 0, at = 0;
  for (let x = 0.001; x < 1.5; x += 0.001) { const f = magicFormula(p, x); if (f > best) { best = f; at = x; } }
  return at;
}

export class Vehicle {
  // sockets: { FL: [x, y, z], ... } the model's wheel sockets in the car frame; the suspension top
  // mounts are spec.wheels.mountHeight above them (see mountOf)
  constructor(RAPIER, world, spec, sockets, spawn) {
    this.R = RAPIER;
    this.world = world;
    this.spec = spec;
    this.sockets = sockets;

    // Mass, centre of mass and inertia all come from the spec (massFrame); the collider itself has no
    // density so it doesn't add mass. Gravity is applied by step() along with every other force, so the
    // body's velocity is exactly what the tyres see (Rapier's own gravity lands partway through its
    // step and leaves a small bias in the velocity)
    const m = spec.mass, mf = massFrame(spec);
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setAdditionalMassProperties(m, toXYZ(spec.centreOfMass), mf.principal, mf.frame)
      .setCanSleep(false).setGravityScale(0);
    this.body = world.createRigidBody(desc);
    const bc = spec.bodyCollider;
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(...bc.halfExtents).setTranslation(...bc.centre).setDensity(0)
        .setFriction(bc.friction).setRestitution(bc.restitution),
      this.body);
    this.collider.userData = { vehicle: this };      // (what another car's crash sensor sees it as)
    this.collider.setCollisionGroups(CAR_GROUPS);     // (a torn-off part passes through cars for a moment)

    const W = spec.wheels;
    this.wheels = WHEELS.map(name => ({ name, front: W.front.includes(name) }));
    for (const w of this.wheels) w.socket = this.mountOf(w);
    this.drivetrain = new Drivetrain(spec, this.wheels);   // also marks which wheels are driven
    this.layoutWheels();
    this.peak = { x: peakSlip(spec.tyre.longitudinal), y: peakSlip(spec.tyre.lateral) };
    // Driver aids, each switchable by the game (defaults from the spec)
    const A = spec.assists;
    this.aids = { abs: A.abs.enabled, tc: A.tractionControl.enabled, tcStrength: A.tractionControl.strength, esc: A.stability.enabled, countersteer: A.countersteer.enabled, steering: A.steering.enabled, drift: A.drift.enabled, revProtection: A.revProtection?.enabled ?? false };
    this.handbrakeClutch = spec.brakes.handbrake.disengageClutch;   // clutch in while the handbrake's held
    this.controls = new Controls(spec, this.peak.y);
    // Aerodynamics and the air: parts add aero at their sockets; the world sets the altitude of its
    // ground level and any wind; the simulation sets the slipstream from other cars
    this.aero = new Aero(spec, sockets);
    this.altitudeBase = 0;
    this.wind = spec.aero.wind ? [...spec.aero.wind] : [0, 0, 0];
    this.slipstream = { drag: 0, downforce: 0, amount: 0 };
    this.brakes = new Brakes(spec, this.wheels, this.peak.x);
    // mechanical damage (spec.damage): each wheel's toe, grip, radius…, the engine's heat, the clutch's
    this.mechanical = new Mechanical(this);
    this.surfaceAt = null;                 // (x, z) → { name, grip, rollingResistance } from the world, if it has surfaces
    this.syncAeroParts();
    this.reset(spawn);
  }

  // The spec was edited (live tuning): work out again everything that was worked out from it once
  // (mass and inertia, body collider, tyre peaks, steering lock, brake balance, drive layout). Values
  // the step reads directly (springs, tyre curves, engine, aids…) apply on the next step anyway.
  // A wheel's suspension top mount (car frame): a model's wheel socket is the wheel's centre at the
  // car's ride height, and the mount sits wheels.mountHeight (front / rear, m) above it (none given:
  // the socket is the mount, as in the first model), and wheels.offsets[wheel] m further out (a rim
  // with less offset, spacers: a wider track)
  mountOf(w) {
    const W = this.spec.wheels, h = W.mountHeight?.[w.front ? 'front' : 'rear'] ?? 0, s = this.sockets[w.name];
    const out = W.offsets?.[w.name] ?? 0;
    return add(s, [out ? Math.sign(s[0]) * out : 0, h, 0]);
  }
  // Where the wheels are: their mounts, the wheelbase and track (the Ackermann geometry comes from
  // them), and each wheel's unsprung mass beyond what the suspension was set up with (kg: it rests on
  // its tyre, not on the spring; wheels.unsprung − wheels.unsprungBaseline, none in a Phase 1 spec)
  layoutWheels() {
    const W = this.spec.wheels;
    for (const w of this.wheels) { w.socket = this.mountOf(w); w.extraUnsprung = W.unsprung?.[w.name] != null ? W.unsprung[w.name] - (W.unsprungBaseline ?? 0) : 0; }
    const at = n => this.wheels.find(w => w.name === n).socket;
    this.wheelbase = Math.abs(at('FL')[2] - at('RL')[2]);
    this.track = Math.abs(at('FL')[0] - at('FR')[0]);
  }

  retune() {
    const spec = this.spec, bc = spec.bodyCollider, mf = massFrame(spec);
    this.layoutWheels();
    this.body.setAdditionalMassProperties(spec.mass, toXYZ(spec.centreOfMass), mf.principal, mf.frame, true);
    this.collider.setHalfExtents(toXYZ(bc.halfExtents));
    this.collider.setTranslationWrtParent(toXYZ(bc.centre));
    this.collider.setFriction(bc.friction);
    this.collider.setRestitution(bc.restitution);
    this.peak = { x: peakSlip(spec.tyre.longitudinal), y: peakSlip(spec.tyre.lateral) };
    this.controls.retune(this.peak.y);
    this.brakes.retune(this.peak.x);
    if (this.drivetrain.layout !== spec.drivetrain.layout) {
      const mode = this.drivetrain.mode, speed = this.forwardSpeed();
      this.drivetrain = new Drivetrain(spec, this.wheels);
      this.drivetrain.mode = mode;
      if (speed > 1) this.drivetrain.matchSpeed(speed);
    }
    this.wind = this.worldWind ?? (spec.aero.wind ? [...spec.aero.wind] : [0, 0, 0]);
    this.syncAeroParts();
  }

  // Aero parts the spec comes with (spec.aeroParts, from the parts system: a wing fitted in the
  // garage): fitted from the start, and kept in step when the spec changes (a part still fitted takes
  // its tuned angle)
  syncAeroParts() {
    if (!this.spec.aeroParts) return;
    const wanted = new Map(this.spec.aeroParts.map(a => [a.part.slot, a]));
    for (const [slot, p] of [...this.aero.parts]) if (wanted.get(slot)?.part.id !== p.def.id) this.removePart(slot);
    for (const [slot, a] of wanted) {
      if (!this.aero.parts.has(slot)) this.installPart(a.part, a.angle);
      else if (a.angle != null && this.aero.parts.get(slot).angle !== a.angle) this.setPartAngle(slot, a.angle);   // (its angle tuned)
    }
  }

  reset(spawn) {
    const b = this.body;
    b.setTranslation(toXYZ(add(spawn.position, [0, this.spec.spawnHeight, 0])), true);
    b.setRotation(quatFromAxisAngle([0, 1, 0], (spawn.headingDeg || 0) * Math.PI / 180), true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.held = !spawn.speed;             // (the parking hold: not for a car put down already moving)
    this.tcActive = false;
    this.absActive = false;
    this.lastRearAngle = 0;
    this.driftMemory = 0;
    this.torqueSteer = 0;
    this.drivetrain?.reset();
    this.sensor?.reset();
    this.parts?.clear();                    // (loose and torn-off parts back on: the game puts them back)
    this.controls?.reset();
    this.brakes?.reset();
    this.escActive = false;
    this.yawRate = 0;
    this.yawExpected = 0;
    this.sat = 0;
    for (const w of this.wheels) Object.assign(w, {
      length: this.spec.suspension.restLength, compression: 0, grounded: false, load: 0,
      omega: 0, spin: 0, deflection: [0, 0], steerAngle: 0,
      slipRatio: 0, slipAngle: 0, combinedSlip: 0, gripUsed: 0, slipSpeed: 0, fx: 0, fy: 0, force: [0, 0, 0],
    });
    this.mechanical?.reset();
    this.mechanical?.before(0, 0);              // (each wheel's damaged values, before the first step)
    // spawning already moving (e.g. an AI car placed in traffic): roll the wheels and pick a gear
    if (spawn.speed) {
      const f = rotate(b.rotation(), [0, 0, 1]);
      b.setLinvel(toXYZ(scale(f, spawn.speed)), true);
      for (const w of this.wheels) w.omega = spawn.speed / this.spec.wheels.radius;
      this.drivetrain?.matchSpeed(spawn.speed);
    }
  }

  // Road-wheel angle of a wheel: front wheels follow the steering, the inside one a little more
  // (Ackermann), so both roll round the same turning centre
  wheelSteer(w) {
    if (!w.front) return 0;
    const d = Math.abs(this.steer);
    if (d < 1e-5) return this.steer;
    const L = this.wheelbase, inside = w.socket[0] * this.steer > 0; // +x is left: left wheel is inside a left turn
    const ideal = Math.atan(L / (L / Math.tan(d) + (inside ? -this.track / 2 : this.track / 2)));
    return Math.sign(this.steer) * (d + this.spec.steering.ackermann * (ideal - d));
  }

  // Tyre force (N, in the wheel's frame: fx forward, fy left) at wheel speed `omega`. Pacejka above
  // walking pace, blended into a spring-damper stiction model below it so a stopped car neither creeps
  // nor jitters. `commit` advances the stiction model's deflection (probing calls don't).
  tyreForce(w, omega, vLong, vLat, h, commit) {
    // N: load × the surface's grip (the tyre curves are for dry tarmac)
    // (damage: its own radius — a soft or flat tyre — and grip: camber, pressure; physics/mechanical.js)
    const T = this.spec.tyre, R = w.radius ?? this.spec.wheels.radius, N = w.load * (w.grip ?? 1) * (w.gripK ?? 1), X = T.longitudinal, Y = T.lateral;
    if (N <= 0) return { fx: 0, fy: 0 };
    // Both slips are measured against the rolling speed, floored at minSlipSpeed so they stay sane
    // (not 0/0) when crawling or parked
    const kappa = (omega * R - vLong) / Math.max(Math.abs(vLong), T.minSlipSpeed);
    const alpha = Math.atan2(vLat, Math.max(Math.abs(vLong), T.minSlipSpeed));
    // Combined slip (friction ellipse): each slip is measured against where its curve peaks, the
    // tyre's grip follows the total, and it's shared out in the direction of the slip. So braking or
    // wheelspin eats into cornering grip, and a locked or spinning wheel has almost none left.
    const sx = kappa / this.peak.x, sy = alpha / this.peak.y, s = Math.hypot(sx, sy);
    let fx = 0, fy = 0;
    if (s > 1e-9) {
      fx = N * magicFormula(X, s * this.peak.x) * sx / s;
      fy = -N * magicFormula(Y, s * this.peak.y) * sy / s * (w.lateralGrip ?? 1);
    }

    const slide = vLong - omega * R;                       // how fast the contact patch slides along
    const b = smoothstep(T.lowSpeed.blendStart, T.lowSpeed.blendEnd, Math.max(Math.abs(vLong), Math.abs(vLat), Math.abs(omega * R)));
    let dx = 0, dy = 0;
    if (b < 1) {
      const L = T.lowSpeed;
      dx = w.deflection[0] + slide * h;
      dy = w.deflection[1] + vLat * h;
      let sx = -(L.stiffness * dx + L.damping * slide), sy = -(L.stiffness * dy + L.damping * vLat);
      const over = Math.hypot(sx / X.D, sy / Y.D) / N;       // stiction can't beat friction either
      if (over > 1) {
        sx /= over; sy /= over;
        dx = -(sx + L.damping * slide) / L.stiffness;
        dy = -(sy + L.damping * vLat) / L.stiffness;
      }
      fx = b * fx + (1 - b) * sx;
      fy = b * fy + (1 - b) * sy;
    }
    if (commit) Object.assign(w, { deflection: [dx, dy], slipRatio: kappa, slipAngle: alpha, combinedSlip: s });
    return { fx, fy };
  }

  // One fixed physics step. input: { throttle 0..1 (W), brake 0..1 (S), steer -1..1 (+ = left),
  // handbrake bool, clutch: null for the auto-clutch or a 0..1 pedal, shift: +1 / -1 to change gear
  // this step }. The gearbox mode is this.drivetrain.mode.
  step(dt, input) {
    const { suspension: S, wheels: W, steering: St, brakes: Br, tyre: Ty } = this.spec;
    const b = this.body, R = this.R;
    const pos = fromXYZ(b.translation()), q = b.rotation();
    const up = rotate(q, [0, 1, 0]), fwd = rotate(q, [0, 0, 1]), down = scale(up, -1);
    const lin = fromXYZ(b.linvel()), ang = fromXYZ(b.angvel()), com = fromXYZ(b.worldCom());
    const velAt = p => add(lin, cross(ang, sub(p, com)));
    const push = (force, point) => b.applyImpulseAtPoint(toXYZ(scale(force, dt)), toXYZ(point), true);
    // Wheels only stand on fixed ground (FIXED_ONLY): loose props (cones) are rolled over / knocked by the
    // body, not stood on — otherwise a wheel pins a fallen cone to the ground and it jams under the car
    const speed = dot(lin, fwd);
    const g = fromXYZ(this.world.gravity);
    // mechanical damage: each wheel's toe, ride height, damping, grip, radius, brake force (none: as new)
    const M = this.mechanical;
    M.before(dt, speed);
    push(scale(g, this.spec.mass), com);
    // a gear change pressed during this step (sequential: pressing either leaves the automatic)
    if (input.shift) { this.drivetrain.mode = 'sequential'; this.drivetrain.requestShift(input.shift); }

    // --- How the car is moving, for the steering aids: `align` is where the front wheels would point
    //     to roll the way the front of the car is going (zero front slip angle); rearDir is the rear
    //     axle's direction of travel against the heading (its slide) ---
    const CS = St.counterSteer;
    const axleZ = n => (this.sockets[n + 'L'][2] + this.sockets[n + 'R'][2]) / 2;
    const left = rotate(q, [1, 0, 0]), dirAt = z => { const vp = velAt(add(pos, rotate(q, [0, 0, z]))); return Math.atan2(dot(vp, left), Math.abs(dot(vp, fwd))); };
    const moving = speed > CS.minSpeed;
    const align = moving ? dirAt(axleZ('F')) : 0, rearDir = moving ? dirAt(axleZ('R')) : 0, rearAngle = Math.abs(rearDir);
    const angleRate = (rearAngle - this.lastRearAngle) / dt;   // how fast the slide is growing (+) or shrinking (-)
    this.lastRearAngle = rearAngle;
    const sliding = smoothstep(CS.slideFrom, CS.slideTo, rearAngle);

    // --- Aerodynamics: drag, lift / downforce front and rear, installed parts, sideways air and
    //     slipstream, at the air density for the car's altitude (which the engine breathes too) ---
    this.aero.activate(dt, { speed: Math.abs(dot(lin, fwd)), latG: Math.abs(this.yawRate * speed) / 9.81, brake: this.brake });
    for (const f of this.aero.forces({ q, pos, com, velocity: lin, up, fwd, left }, { altitude: this.altitudeBase + pos[1], wind: this.wind, slipstream: this.slipstream })) push(f.force, f.point);
    this.drivetrain.breath = breathing(this.spec.engine, this.aero.telemetry.density / SEA_LEVEL_DENSITY);

    // --- Driver controls: pedal positions and the steering (filtered and assisted for keyboard /
    //     gamepad, straight through for a wheel) ---
    // (a car missing a part it can't drive without, the garage says why: no throttle)
    if (this.immobilized) input = { ...input, throttle: 0 };
    const ctl = this.controls.update(dt, input, { speed, align, rearDir, angleRate, centre: M.centre }, this.aids);
    const throttle = ctl.throttle, brake = ctl.brake, drifting = ctl.drifting, Ad = this.spec.assists.drift;
    this.throttle = throttle;
    this.brake = brake;
    this.steer = ctl.road;                                     // front wheel angle (rad)

    // --- Suspension: one ray per wheel, straight down (car's down) from the socket. Each wheel's rest
    //     length, radius, damping and grip are its own (damage: physics/mechanical.js — a wheel torn
    //     off is its bare hub, low and dragging) ---
    // (anti-roll bars and solid axles join each axle's two sides: their loads are worked out together,
    // after every wheel's spring)
    const linked = this.#linked();
    let extraOnTyres = 0;
    for (const w of this.wheels) {
      const origin = add(pos, rotate(q, w.socket));
      const hit = this.world.castRayAndGetNormal(new R.Ray(toXYZ(origin), toXYZ(down)), w.rest + w.radius, true, FIXED_ONLY, undefined, undefined, b);
      w.origin = origin;
      w.steerAngle = this.wheelSteer(w) + w.toe + (w.front ? this.torqueSteer : 0);
      if (!hit) {
        Object.assign(w, { grounded: false, length: w.rest, compression: 0, compressionSpeed: 0, load: 0, contact: null, normal: null, surface: null, grip: 1 });
        continue;
      }
      // Wheel centre sits one radius above the hit; the spring can't compress past its travel
      const len = clamp(hit.timeOfImpact - w.radius, w.rest - S.travel, w.rest);
      const compression = w.rest - len;
      // How fast the spring is actually being squashed (from its length last step). Not the body's
      // velocity along its own up axis: when the car is tilted relative to the ground, part of its
      // forward speed would count as the strut extending and cancel the spring.
      const compressionSpeed = (compression - (w.grounded ? w.compression : 0)) / dt;
      // (a kerb's edge hit hard, a heavy landing: physics/mechanical.js)
      const hn = fromXYZ(hit.normal), vo = velAt(origin);
      // (the ground's own rise: what the spring took up, less the car coming down onto it)
      M.strike(w, w.grounded ? { rise: compression - w.compression + dot(vo, up) * dt, speed, pitch: Math.atan2(-dot(hn, fwd), dot(hn, up)) * (speed < 0 ? -1 : 1) } : { landing: Math.min(dot(vo, down), -dot(vo, hn)) }, dt);
      const load = Math.max(0, S.stiffness * compression + S.damping * w.dampK * compressionSpeed); // springs only push
      // The ground holds the wheel up along its normal, at the contact patch: the suspension links take
      // the rest, so a body leaning in a corner (or pitching under braking) gets no sideways (or fore-
      // aft) push from its own springs
      const contact = add(origin, scale(down, hit.timeOfImpact)), normal = fromXYZ(hit.normal);
      if (!linked) push(scale(normal, load), contact);
      const surface = this.surfaceAt ? this.surfaceAt(contact[0], contact[2]) : null;
      // (the surface's grip, times how this tyre takes to it: a gravel tyre bites on gravel, a slick doesn't)
      const onIt = surface && Ty.surfaceGrip?.[surface.name];
      Object.assign(w, {
        grounded: true, length: len, compression, compressionSpeed, load, spring: load,
        contact, normal, surface, grip: onIt ? (surface.grip ?? 1) * onIt : surface?.grip ?? 1,
      });
      // a wheel heavier (or lighter) than the suspension was set up with: that much of the car's weight
      // goes straight onto its tyre instead of through the body
      if (w.extraUnsprung) { const u = w.extraUnsprung * length(g); w.load = Math.max(0, load + u); extraOnTyres += u; }
    }
    if (linked) this.#linkAxles(linked, push, up);
    if (extraOnTyres) push(scale(normalize(g), -extraOnTyres), com);

    // --- The drivetrain picks the gear, works the clutch and says which pedal drives (in reverse
    //     with the automatic, S drives and W brakes) ---
    const dtr = this.drivetrain;
    const { accel, brake: brakeCmd } = dtr.control(dt, { accel: throttle, brake, clutch: input.clutch ?? null, handbrake: !!input.handbrake && this.handbrakeClutch, sliding: sliding > 0, revProtection: !!this.aids.revProtection }, speed);
    // Auto-hold: once stopped with no pedals pressed, the brakes stay on until a pedal is pressed,
    // so a parked car doesn't roll away on a hill
    this.held = !throttle && !brake && (this.held || Math.abs(speed) < Br.autoHold.belowSpeed);
    const A = this.spec.assists, aids = this.aids, tc = aids.tc && A.tractionControl;
    // Slide limiter (part of traction control): the drive fades once the rear is sliding past a set
    // angle (looking a moment ahead at how fast the slide is growing), so a snap can't be powered
    // round into a spin
    const growing = Math.max(0, angleRate);
    let slideCut = tc ? clamp(1 - (rearAngle + A.slideLimit.lookAhead * growing - A.slideLimit.angle) / A.slideLimit.window, 0, 1) : 1;
    // Drift assist: while drifting, the throttle is shared out to hold the slide near a set angle
    // (more as it straightens, less as it grows), so holding the throttle holds the drift
    if (drifting > 0) {
      const holdAngle = clamp(0.5 + Ad.powerGain * (Ad.angle - rearAngle - Ad.powerDamping * angleRate), 0, 1);
      slideCut = Math.min(slideCut, 1 + (holdAngle - 1) * drifting);
    }
    let tcCut = slideCut < 1 && accel > 0;

    // --- Stability control: compares the yaw rate with what the speed and steering ask for (a
    //     bicycle model with a little understeer, capped by grip) and brakes single wheels to correct
    //     it: the outside front calms oversteer, the inside rear tightens understeer; it eases the
    //     throttle while it works. Slides up to an allowance are left alone (a bigger one with the
    //     drift assist on) ---
    const E = A.stability, yaw = dot(ang, up);
    const frontGrip = this.wheels.filter(w => w.front && w.grounded).reduce((a, w, _, arr) => a + w.grip / arr.length, 0) || 1;
    const cap = frontGrip * Math.abs(g[1]) / Math.max(Math.abs(speed), 1);
    this.yawRate = yaw;
    this.yawExpected = clamp(speed * Math.tan(this.steer) / (this.wheelbase * (1 + (speed / E.characteristicSpeed) ** 2)), -cap, cap);
    for (const w of this.wheels) w.escT = 0;
    this.escActive = false;
    this.escMode = null;
    this.handbrakeTimer = input.handbrake ? E.handbrakeHold : Math.max(0, (this.handbrakeTimer || 0) - dt);
    if (aids.esc && speed > E.minSpeed) {
      const err = yaw - this.yawExpected, allowance = aids.drift ? E.driftSlipAllowance : E.slipAllowance;
      const brakeWheel = (name, T) => { this.wheels.find(w => w.name === name).escT = T; };
      let T = 0;
      if (Math.sign(err) === Math.sign(yaw) && Math.abs(err) > E.yawThreshold && (rearAngle > allowance || Math.abs(err) > E.strongYawError) && this.handbrakeTimer <= 0) {
        T = Math.min(E.maxTorque, E.oversteerGain * (Math.abs(err) - E.yawThreshold));
        brakeWheel(yaw > 0 ? 'FR' : 'FL', T);                   // outside front
        this.escMode = 'oversteer';
      } else if (Math.abs(this.yawExpected) > Math.abs(yaw) + E.yawThreshold && Math.sign(this.yawExpected) === Math.sign(yaw || this.yawExpected)) {
        T = Math.min(E.maxTorque, E.understeerGain * (Math.abs(this.yawExpected) - Math.abs(yaw) - E.yawThreshold));
        brakeWheel(this.yawExpected > 0 ? 'RL' : 'RR', T);       // inside rear
        brakeWheel(this.yawExpected > 0 ? 'FL' : 'FR', T * E.understeerFrontShare);
        this.escMode = 'understeer';
      }
      if (T > 0) {
        // with the drift assist on it doesn't ease the throttle for understeer: that's how you
        // power the car into a drift
        if (!(aids.drift && this.escMode === 'understeer')) slideCut *= 1 - E.throttleCut * T / E.maxTorque;
        this.escActive = true;
      }
    }

    // --- Wheels: per step, each wheel's frame on the ground and its brake / rolling torques ---
    const n = Ty.wheelSubsteps, h = dt / n;
    // Drift assist: while already drifting on the throttle, the rear tyres give up a little sideways
    // grip so the drift holds; off the throttle it comes straight back and the car straightens
    const rearGrip = 1 - Ad.rearGripLoss * drifting * accel;
    for (const w of this.wheels) {
      w.lateralGrip = w.front ? 1 : rearGrip;
      w.holdT = Math.max(input.handbrake && !w.front ? Br.handbrake.torque : 0, this.held ? Br.autoHold.torque : 0);
      w.dragT = ((w.surface?.rollingResistance ?? Ty.rollingResistance) + w.rollExtra) * w.load * w.radius; // rolling resistance, in proportion to load (more on a soft tyre)
      w.fxSum = 0;
      w.fySum = 0;
      if (!w.grounded) continue;
      // The wheel's own frame on the ground: along its (steered) heading, and to its left
      const nrm = w.normal, heading = rotate(q, [Math.sin(w.steerAngle), 0, Math.cos(w.steerAngle)]);
      w.along = normalize(sub(heading, scale(nrm, dot(heading, nrm))));
      w.side = normalize(cross(nrm, w.along));
      const vc = velAt(w.contact);
      w.vLong = dot(vc, w.along);
      w.vLat = dot(vc, w.side);
    }
    const slipOf = (w, om) => (om * w.radius - w.vLong) / Math.max(Math.abs(w.vLong), Ty.minSlipSpeed);
    // Brakes (and rolling resistance) slow a wheel down but never spin it the other way
    const applyBrake = (w, T) => {
      const d = T * h / W.inertia;
      w.omega = Math.abs(w.omega) <= d ? 0 : w.omega - Math.sign(w.omega) * d;
    };
    const driveSign = Math.sign(dtr.ratio(dtr.gear)) || 1;

    // --- Substeps: spin every wheel (the driven ones together with the engine), implicitly, then
    //     work out the tyre forces at the new spin ---
    for (let k = 0; k < n; k++) {
      this.wheels.forEach((w, i) => {
        // tyre force at the current spin and how steeply it rises with spin (for the implicit step)
        w.f0 = 0;
        w.slope = 0;
        if (w.grounded && !w.off) {            // (a wheel torn off: its shaft turns free, the hub just slides)
          w.f0 = this.tyreForce(w, w.omega, w.vLong, w.vLat, h, false).fx;
          const eps = 1e-3 * (1 + Math.abs(w.omega));
          w.slope = Math.max(0, (this.tyreForce(w, w.omega + eps, w.vLong, w.vLat, h, false).fx - w.f0) / eps);
        }
        // brake torque: pedal (through the bias valve and ABS) plus any stability-control braking;
        // the handbrake / auto-hold on top (ABS doesn't touch those)
        // (in the air ABS judges the wheel against the car's speed, like real wheel-speed sensors, so
        // the wheels don't lock mid-jump and land skidding)
        const refSpeed = w.grounded ? w.vLong : speed, slip = (w.omega * w.radius - refSpeed) / Math.max(Math.abs(refSpeed), Ty.minSlipSpeed);
        const service = this.brakes.substep(i, h, brakeCmd, w.escT, aids.abs, slip, refSpeed);
        w.brakeT = Math.max(service * w.brakeK, w.holdT);        // (a damaged brake line: less of it)
        // the heat it makes goes into the disc
        this.brakes.state[i].heat += w.brakeT * Math.abs(w.omega) * h;
        this.brakes.state[i].torque = w.brakeT;
      });
      // Free-rolling wheels on their own
      for (const w of this.wheels) {
        if (w.driven) continue;
        w.omega += h * (-w.radius * w.f0) / (W.inertia + h * w.radius * w.slope);
        applyBrake(w, w.brakeT + w.dragT);
      }
      // Driven wheels with the engine. Traction control closes the throttle as they spin past their
      // slip target; the slide limiter / drift assist trim it in slides.
      let tcf = 1;
      if (tc) {
        // it lets the wheels spin more while you're steering or drifting (to hold a slide) than
        // when you're pointing straight (for traction); strength 0..1 scales how tight it is
        const loose = Math.max(Math.abs(input.steer || 0), drifting), k = 2 ** (1 - 2 * aids.tcStrength);
        const target = k * (tc.straightSlipTarget + (tc.slipTarget - tc.straightSlipTarget) * loose);
        const window = k * (tc.straightSlipWindow + (tc.slipWindow - tc.straightSlipWindow) * loose);
        for (const w of dtr.driven) if (w.grounded) tcf = Math.min(tcf, clamp(1 - (slipOf(w, w.omega) * driveSign - target) / window, 0, 1));
      }
      if (tcf < 1 && accel > 0) tcCut = true;
      dtr.driveThrottle = accel * tcf * (dtr.gear > 0 ? slideCut : 1);
      const before = dtr.driven.map(w => w.omega), spinning = before.map(o => Math.abs(o) > 1);
      dtr.solve(h, dtr.driven.map((w, i) => ({ F: w.f0, slope: w.slope, radius: w.radius, brake: spinning[i] ? (w.brakeT + w.dragT) * Math.sign(before[i]) : 0 })));
      dtr.driven.forEach((w, i) => {
        if (!spinning[i]) applyBrake(w, w.brakeT + w.dragT);                                // nearly still: brakes hold it
        else if (w.brakeT > 0 && Math.sign(w.omega) !== Math.sign(before[i])) w.omega = 0;  // brakes stop it, never reverse it
      });
      // Tyre forces at the new spin (this also moves the low-speed stiction model on)
      for (const w of this.wheels) {
        if (!w.grounded) continue;
        const f = this.tyreForce(w, w.off ? 0 : w.omega, w.vLong, w.vLat, h, true);
        w.fxSum += f.fx;
        w.fySum += f.fy;
      }
    }

    // --- Push the body with each tyre's force (averaged over the substeps) at its contact patch ---
    const X = Ty.longitudinal, Y = Ty.lateral;
    for (const w of this.wheels) {
      w.spin += w.omega * dt;
      if (!w.grounded) {
        Object.assign(w, { fx: 0, fy: 0, force: [0, 0, 0], gripUsed: 0, combinedSlip: 0, slipSpeed: 0, deflection: [0, 0] });
        continue;
      }
      const fx = w.fxSum / n, fy = w.fySum / n, force = add(scale(w.along, fx), scale(w.side, fy));
      push(force, w.contact);
      M.wobble(w, speed, push, w.normal, w.side);                  // (a bent rim)
      Object.assign(w, {
        fx, fy, force,
        // share of the tyre's grip in use; past the peak of the curve (sliding) it's all of it
        gripUsed: w.combinedSlip >= 1 ? 1 : w.load > 0 ? Math.min(1, Math.hypot(fx / X.D, fy / Y.D) / (w.load * w.grip * w.gripK)) : 0,
        slipSpeed: Math.hypot(w.vLong - w.omega * w.radius, w.vLat),
      });
    }
    this.tcActive = tcCut;
    this.absActive = this.brakes.state.some(s => s.absActive);
    this.brakes.cool(dt, speed);
    M.after(dt, speed);                     // (the engine's and clutch's heat, leaks)

    // --- Self-aligning torque at the front wheels: each tyre's side force times its trail, the
    //     pneumatic part of which shrinks to nothing as the tyre reaches and passes peak grip (so the
    //     steering goes light as the front washes out), plus a little mechanical trail (caster) ---
    // --- Torque steer (a driven front axle): the drive through the front wheels pulls the steering,
    //     spec.drivetrain.torqueSteer rad a kN·m at the wheels, less through a limited-slip or locked
    //     front diff (its torqueSteer share: open 1, lsd 0.35, locked 0.2 unless it says) — next step ---
    const TS = this.spec.drivetrain.torqueSteer;
    if (TS) { const D = dtr.diffOf(dtr.front), share = D.torqueSteer ?? { open: 1, lsd: 0.35, locked: 0.2 }[D.type] ?? 1; this.torqueSteer = clamp(TS * dtr.frontDrive / 1000 * share, -0.06, 0.06); }
    else this.torqueSteer = 0;

    const SA = St.selfAligning;
    this.sat = 0;
    for (const w of this.wheels) {
      if (!w.front || !w.grounded) continue;
      const trail = SA.pneumaticTrail * Math.max(0, 1 - Math.abs(w.slipAngle) / (SA.trailZeroAtPeak * this.peak.y)) + SA.mechanicalTrail;
      this.sat -= trail * w.fy;               // + pulls the steering left
    }
  }

  // Each axle's link between its sides: an anti-roll bar (suspension.antiRoll.front / rear, N a metre of
  // difference in compression) and a solid axle (suspension.solidAxle.front / rear: the two wheels on
  // one beam, sprung at springTrack of the track, so the body's roll is resisted springTrack² as hard
  // as by independent springs — and a wheel pushed up into a bump doesn't unload the other as much).
  // null: none (each wheel on its own spring).
  // The solid axle is an approximation: the wheels here are rays, each finding the ground on its own, so
  // what's linked is the load (how the two springs share the body's weight and roll), not the geometry.
  // Not modelled: the beam's own mass and roll inertia, the wheels' track and camber following the beam
  // (a bump on one side tilting the other wheel), axle steer and axle wrap. What it gives is what matters
  // most off road and on it: the body rolls more on the road, and over rough ground the axle articulates
  // with the load kept on both wheels.
  #linked() {
    const S = this.spec.suspension, A = S.antiRoll, B = S.solidAxle;
    if (!(A?.front || A?.rear || B?.front || B?.rear)) return null;
    const axle = end => { const ws = this.wheels.filter(w => w.front === (end === 'front')).sort((a, b) => b.socket[0] - a.socket[0]); return { wheels: ws, bar: A?.[end] ?? 0, solid: B?.[end] ? (B.springTrack ?? 0.7) ** 2 : null }; };
    return [axle('front'), axle('rear')];
  }
  // The linked axles' loads, then every wheel's push on the body (in the same order as unlinked)
  #linkAxles(axles, push, up) {
    for (const { wheels: [L, R], bar, solid } of axles) {
      const f = { [L.name]: 0, [R.name]: 0 };
      if (solid != null && L.grounded && R.grounded) { const avg = (L.spring + R.spring) / 2, half = (L.spring - R.spring) / 2 * solid; f[L.name] += avg + half - L.spring; f[R.name] += avg - half - R.spring; }
      if (bar) { const d = bar * ((L.grounded ? L.compression : 0) - (R.grounded ? R.compression : 0)); f[L.name] += d; f[R.name] -= d; }
      for (const w of [L, R]) w.linkForce = f[w.name];
    }
    for (const w of this.wheels) {
      const extra = w.linkForce ?? 0;
      if (w.grounded) {
        const spring = Math.max(0, w.spring + extra);
        w.load += spring - w.spring;
        push(scale(w.normal, spring), w.contact);
        if (w.spring + extra < 0) push(scale(up, w.spring + extra), w.origin);        // (the bar pulling that side down)
      } else if (extra) push(scale(up, extra), w.origin);                               // (in the air: the bar pulls the body)
      w.linkForce = 0;
    }
  }

  // Parts: install a part definition (see parts.js) into its slot, at an angle for adjustable ones;
  // removing it takes its forces away from the next step on
  installPart(def, angle) { this.aero.parts.set(def.slot, { def, angle: angle ?? def.aero?.angle?.default }); }
  removePart(slot) { this.aero.parts.delete(slot); }
  setPartAngle(slot, angle) { const p = this.aero.parts.get(slot); if (p) p.angle = angle; }
  partIn(slot) { return this.aero.parts.get(slot) ?? null; }

  // All driver aids at once (true / false); true if any is on
  get assists() { const a = this.aids; return a.abs || a.tc || a.esc || a.countersteer || a.steering || a.drift; }
  set assists(on) { for (const k of ['abs', 'tc', 'esc', 'countersteer', 'steering', 'drift']) this.aids[k] = !!on; }

  forwardSpeed() {
    const b = this.body;
    return dot(fromXYZ(b.linvel()), rotate(b.rotation(), [0, 0, 1]));
  }

  // Plain snapshot of everything a renderer / HUD / network needs
  snapshot() {
    const b = this.body, q = b.rotation(), lin = fromXYZ(b.linvel());
    const fwd = rotate(q, [0, 0, 1]), up = rotate(q, [0, 1, 0]);
    return {
      position: fromXYZ(b.translation()),
      rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
      speed: dot(lin, fwd),
      // what the speedometer reads: the wheels that aren't driven, at their actual radius
      // (every wheel driven: all of them)
      speedometer: (() => { const undriven = this.wheels.filter(w => !this.drivetrain.driven.includes(w)), free = undriven.length ? undriven : this.wheels, n = free.length || 1; return free.reduce((a, w) => a + (w.omega ?? 0), 0) / n * (free.reduce((a, w) => a + (w.radius ?? this.spec.wheels.radius), 0) / n); })(),
      immobilized: this.immobilized ?? null,
      scrape: this.sensor?.scrape ?? null,
      looseParts: this.parts?.parts.size ? this.parts.snapshot() : [],
      rattle: this.parts?.rattle ?? 0,
      partScrape: this.parts?.scrape ?? null,
      velocity: lin,
      steer: this.steer,
      throttle: this.throttle,
      brake: this.brake,
      brakeLights: this.brake > 0.05,
      held: this.held,
      assists: this.assists,
      aids: { ...this.aids },
      tcActive: this.tcActive,
      absActive: this.absActive,
      escActive: this.escActive,
      escMode: this.escMode,
      steering: {
        wheelAngle: this.steer * this.spec.steering.ratio, roadAngle: this.steer, sat: this.sat, torqueSteer: this.torqueSteer,
        ffb: clamp(this.sat / this.spec.steering.selfAligning.ffbFullScale, -1, 1),
      },
      aero: { ...this.aero.telemetry, parts: [...this.aero.parts].map(([slot, p]) => ({ slot, id: p.def.id, angle: p.angle })) },
      yawRate: this.yawRate,
      yawExpected: this.yawExpected,
      brakeBias: this.brakes.bias,
      engine: this.drivetrain.snapshot(),
      mechanical: this.mechanical.snapshot(),
      up,
      wheels: this.wheels.map(w => ({
        name: w.name, front: w.front, driven: w.driven, grounded: w.grounded, length: w.length, compression: w.compression, compressionSpeed: w.compressionSpeed ?? 0,
        load: w.load, spin: w.spin, omega: w.omega, steerAngle: w.steerAngle,
        slipRatio: w.slipRatio, slipAngle: w.slipAngle, combinedSlip: w.combinedSlip, gripUsed: w.gripUsed, slipSpeed: w.slipSpeed,
        fx: w.fx, fy: w.fy, force: w.force, origin: w.origin, contact: w.contact, surface: w.surface?.name ?? null,
        brake: this.brakes.snapshot(this.wheels.indexOf(w)),
        radius: w.radius, pressure: w.pressure ?? 1, flat: !!w.flat, off: !!w.off, bend: w.bend ?? 0,
      })),
    };
  }
}
