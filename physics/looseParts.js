// Parts that come loose and off in a crash, as physics.
//
// LooseParts (one per car): a loose part is its own rigid body joined to the car — a hinge on its
// origin (a bonnet, a door: revolute, within its limits, with a little friction) or one mounting point
// (a bumper hanging off one end: a short rope, which can drag it but not wedge the car up on it) —
// so it swings, flaps and drags on the ground. The two
// don't collide with each other (the joint says so), a part body is never lighter than minMass (steady
// joints against a heavy car), and the air pushes on it as a flat plate at speed (a loose bonnet also
// lifts from its leading edge: `open`). Each step it works out how hard the part pulls on its fixings
// (what it takes to keep it moving with the car, and the air on it); past its attachStrength it tears:
// an event, for the game to tear it off. It also says how much the loose parts rattle, and how hard a
// dangling one scrapes the ground.
//
// DebrisPool (one per world): torn-off parts as free bodies (a box the size of the part), keeping the
// velocity and spin they had. For ignoreCarFor s they pass through cars (no jitter against the car they
// left); a change of speed past clatterFrom is a clatter (it hit the ground or something else). At most
// max pieces, the oldest first to go; pieces too far from the car or too old go too; settled ones sleep.
//
// Part shapes come from the game (garage/detach.js bodyDef): { mass, half, centre (box, part frame),
// origin (socket, car frame), type, axis, limits (rad), mount, open, pop, strength, plateNormal,
// plateArea }. The part frame lines up with the car frame at rest, its origin at the socket. A wheel
// torn off (garage/detach.js wheelDef): { shape: 'wheel', mass, radius, halfWidth, centre, origin (its
// centre), spin (rad/s about the axle) } — a cylinder that rolls away.

import { add, cross, dot, fromXYZ, rotate, scale, sub, toXYZ } from './math.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const conj = q => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
const quatMul = (a, b) => ({ w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z, x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x, z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w });
// collision groups (membership << 16 | filter): cars, and torn-off pieces that don't touch cars yet
export const CAR = 0x0002, DEBRIS = 0x0004;
export const CAR_GROUPS = (CAR << 16) | 0xffff;
const PIECE_NO_CARS = (DEBRIS << 16) | (0xffff & ~CAR), PIECE = (DEBRIS << 16) | 0xffff;
const AIR = 1.2;       // kg/m³ (near enough, for bits of car)

const pose = b => ({ position: fromXYZ(b.translation()), rotation: { ...b.rotation() } });
const pointVel = (b, p) => add(fromXYZ(b.linvel()), cross(fromXYZ(b.angvel()), sub(p, fromXYZ(b.worldCom()))));

// A part body: a box (a wheel: a cylinder across the car, def.shape 'wheel', its radius and halfWidth,
// rolling on), at a pose, moving
const ACROSS = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };     // (a cylinder's axis, y, turned to x)
function partBody(R, world, def, at, rules, groups) {
  const wheel = def.shape === 'wheel';
  const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(...at.position).setRotation(at.rotation)
    .setLinvel(...(at.linvel ?? [0, 0, 0])).setAngvel(toXYZ(at.angvel ?? [0, 0, 0])).setLinearDamping(rules.linearDamping).setAngularDamping(wheel ? 0.05 : rules.angularDamping).setCcdEnabled(true));
  const shape = wheel ? R.ColliderDesc.cylinder(def.halfWidth, def.radius).setRotation(ACROSS) : R.ColliderDesc.cuboid(...def.half.map(h => Math.max(0.01, h)));
  const collider = world.createCollider(shape.setTranslation(...def.centre)
    .setMass(Math.max(rules.minMass, def.mass)).setFriction(wheel ? 0.9 : 0.5).setRestitution(wheel ? 0.3 : 0.15).setCollisionGroups(groups), body);
  return { body, collider };
}

export class LooseParts {
  constructor(vehicle, RAPIER, pool, rules) {
    this.v = vehicle; this.R = RAPIER; this.pool = pool; this.rules = rules;
    this.parts = new Map();       // socket → { body, collider, joint, def, … }
    this.events = [];             // { type: 'tear', socket, load }
    this.rattle = 0;              // 0..1, how much the loose parts rattle and flap
    this.scrape = null;           // a dangling part on the ground: { amount, speed, material }
  }
  get world() { return this.v.world; }
  take() { return this.events.splice(0); }
  has(socket) { return this.parts.has(socket); }

  // Loose: a body on a joint where the part is now (at rest on the car, the car's motion)
  loosen(socket, def) {
    if (this.parts.has(socket) || def.type === 'none') return false;
    const car = this.v.body, q = car.rotation(), at = add(fromXYZ(car.translation()), rotate(q, def.origin));
    const { body, collider } = partBody(this.R, this.world, def, { position: at, rotation: q, linvel: pointVel(car, at), angvel: fromXYZ(car.angvel()) }, this.rules, 0xffffffff);
    let joint;
    if (def.type === 'hinge') {
      joint = this.world.createImpulseJoint(this.R.JointData.revolute(toXYZ(def.origin), { x: 0, y: 0, z: 0 }, toXYZ(def.axis)), car, body, true);
      joint.setLimits(def.limits[0], def.limits[1]);
      joint.configureMotorVelocity(0, this.rules.hingeFriction);
      // (the latch lets go: it springs open toward its wider limit)
      if (def.pop) { const s = Math.abs(def.limits[0]) > Math.abs(def.limits[1]) ? -1 : 1; body.setAngvel(toXYZ(add(fromXYZ(car.angvel()), rotate(q, scale(def.axis, s * def.pop)))), true); }
    } else {
      // (a short rope, not a rigid ball joint: it drags the part along, but the ground under a part
      // wedged below the car can't hold the car up through it — that would brake the car hard)
      joint = this.world.createImpulseJoint(this.R.JointData.rope(0.04, toXYZ(add(def.origin, def.mount)), toXYZ(def.mount)), car, body, true);
    }
    joint.setContactsEnabled(false);
    this.parts.set(socket, { socket, body, collider, joint, def, lastRel: null, load: 0, strain: 0, torn: false, rattle: 0, aero: 0 });
    return true;
  }

  // Torn off: a piece of debris where it is (its loose body, or its place on the car), as it's moving
  detach(socket, def, time, key = socket) {
    const car = this.v.body, loose = this.parts.get(socket);
    let at;
    if (loose) { const p = pose(loose.body); at = { ...p, linvel: fromXYZ(loose.body.linvel()), angvel: fromXYZ(loose.body.angvel()) }; this.#drop(socket); }
    else { const q = car.rotation(), p = add(fromXYZ(car.translation()), rotate(q, def.origin)); at = { position: p, rotation: { ...q }, linvel: pointVel(car, p), angvel: add(fromXYZ(car.angvel()), rotate(q, [def.spin ?? 0, 0, 0])) }; }   // (a wheel keeps spinning)
    return this.pool.add({ def, at, key, owner: this.v }, time);
  }

  // Back on the car (a reset): no body, no joint
  reattach(socket) { this.#drop(socket); this.pool.removeOwned(this.v, socket); }
  clear() { for (const s of [...this.parts.keys()]) this.#drop(s); this.pool.removeOwned(this.v); this.rattle = 0; this.scrape = null; }
  #drop(socket) {
    const p = this.parts.get(socket);
    if (!p) return;
    if (this.world.getImpulseJoint(p.joint.handle)) this.world.removeImpulseJoint(p.joint, true);
    if (this.world.getRigidBody(p.body.handle)) this.world.removeRigidBody(p.body);
    this.parts.delete(socket);
  }

  // Before the world steps: the air on each loose part (a flat plate; a bonnet's leading edge lifts)
  before() {
    if (!this.parts.size) return;
    const car = this.v.body, qc = car.rotation(), up = rotate(qc, [0, 1, 0]);
    for (const p of this.parts.values()) {
      const b = p.body, d = p.def, q = b.rotation(), centre = add(fromXYZ(b.translation()), rotate(q, d.centre)), v = pointVel(b, centre), speed = Math.hypot(...v);
      b.resetForces(true); b.resetTorques(true);          // (Rapier keeps both until told)
      p.aero = 0;
      if (speed < 1) continue;
      const qd = 0.5 * AIR * speed * speed, n = rotate(q, d.plateNormal), along = dot(n, v) / speed;
      const F = scale(n, -qd * this.rules.plate * d.plateArea * along * Math.abs(along));
      b.addForceAtPoint(toXYZ(F), toXYZ(centre), true);
      p.aero = Math.hypot(...F);
      if (d.open) {
        // (air under the leading edge while it's nearly shut, pushing it open)
        const rel = quatMul(conj(qc), q), angle = 2 * Math.atan2(dot([rel.x, rel.y, rel.z], d.axis), rel.w), shut = Math.abs(angle) < 1.2 ? Math.cos(angle) : 0;
        const forward = Math.max(0, dot(v, rotate(qc, [0, 0, 1]))), lift = 0.5 * AIR * forward * forward * d.open * d.plateArea * shut;
        if (lift > 0) { b.addForceAtPoint(toXYZ(scale(up, lift)), toXYZ(add(fromXYZ(b.translation()), rotate(q, d.edge))), true); p.aero += lift; }
      }
    }
  }

  // After the world steps: how hard each pulls on its fixings (tears), how much they rattle, and a
  // dangling one scraping the ground
  after(dt) {
    this.rattle *= Math.exp(-dt / 0.25);
    this.scrape = null;
    if (!this.parts.size) return;
    const car = this.v.body, R = this.rules;
    for (const p of this.parts.values()) {
      const b = p.body, centre = add(fromXYZ(b.translation()), rotate(b.rotation(), p.def.centre));
      const rel = sub(pointVel(b, centre), pointVel(car, centre)), m = Math.max(R.minMass, p.def.mass);
      const acc = p.lastRel ? Math.hypot(...sub(rel, p.lastRel)) / dt : 0;
      p.lastRel = rel;
      const load = m * acc + p.aero;
      p.load += (load - p.load) * (1 - Math.exp(-dt / 0.02));
      if (!p.torn && p.load > p.def.strength) {
        p.strain += (p.load / p.def.strength - 1) * dt * 12;
        if (p.strain >= 1) { p.torn = true; this.events.push({ type: 'tear', socket: p.socket, load: p.load }); }
      }
      const spin = Math.hypot(...sub(fromXYZ(b.angvel()), fromXYZ(car.angvel())));
      p.rattle = clamp(spin / 6, 0, 1) * 0.6 + clamp(acc / 80, 0, 1) * 0.5 + clamp(Math.hypot(...pointVel(car, centre)) / 40, 0, 1) * 0.2;
      this.rattle = Math.max(this.rattle, clamp(p.rattle, 0, 1));
      // on the ground: a scrape as it drags
      this.world.contactPairsWith(p.collider, other => {
        if (other.parent() && !other.parent().isFixed()) return;
        let touching = false;
        this.world.contactPair(p.collider, other, m2 => { for (let i = 0; i < m2.numContacts(); i++) if (m2.contactDist(i) < 0.02) touching = true; });
        if (!touching) return;
        const speed = Math.hypot(...pointVel(b, centre)), amount = clamp(speed / 20, 0, 1) * 0.8;
        if (speed > 1 && (!this.scrape || amount > this.scrape.amount)) this.scrape = { amount, speed, material: other.userData?.material ?? 'concrete' };
      });
    }
  }

  // The loose parts where they are (world): [{ socket, position, rotation, rattle }]
  snapshot() { return [...this.parts.values()].map(p => ({ socket: p.socket, ...pose(p.body), rattle: p.rattle })); }
}

export class DebrisPool {
  constructor(RAPIER, world, rules) {
    this.R = RAPIER; this.world = world; this.rules = rules;
    this.pieces = [];             // { id, key, owner, body, collider, born, lastVel, lastClatter, carsFrom }
    this.events = [];             // { type: 'clatter', id, key, strength, position }
    this.nextId = 1;
  }
  take() { return this.events.splice(0); }
  get count() { return this.pieces.length; }

  add({ def, at, key, owner }, time) {
    const { body, collider } = partBody(this.R, this.world, def, at, this.rules, PIECE_NO_CARS);
    const piece = { id: this.nextId++, key, owner, body, collider, born: time, lastVel: at.linvel ?? [0, 0, 0], lastClatter: time, carsFrom: time + this.rules.ignoreCarFor };
    this.pieces.push(piece);
    while (this.pieces.length > this.rules.max) this.#remove(this.pieces[0]);
    return piece.id;
  }
  remove(id) { const p = this.pieces.find(x => x.id === id); if (p) this.#remove(p); }
  // a car's pieces (all of them, or one part's): back on the car
  removeOwned(owner, key) { for (const p of this.pieces.filter(x => x.owner === owner && (key === undefined || x.key === key))) this.#remove(p); }
  #remove(p) {
    if (this.world.getRigidBody(p.body.handle)) this.world.removeRigidBody(p.body);
    this.pieces = this.pieces.filter(x => x !== p);
  }

  // After the world steps: bounces, cars solid again, the limits (near: where the player's car is)
  after(dt, time, near) {
    const R = this.rules;
    for (const p of [...this.pieces]) {
      const b = p.body;
      if (time - p.born > R.maxAge || (near && Math.hypot(...sub(fromXYZ(b.translation()), near)) > R.maxDistance)) { this.#remove(p); continue; }
      if (p.carsFrom != null && time >= p.carsFrom) { p.collider.setCollisionGroups(PIECE); p.carsFrom = null; }
      if (b.isSleeping()) { p.lastVel = [0, 0, 0]; continue; }
      const v = fromXYZ(b.linvel()), dv = Math.hypot(...sub(v, p.lastVel)) - 9.81 * dt;
      p.lastVel = v;
      if (dv > R.clatterFrom && time - p.lastClatter > R.clatterEvery && time - p.born > dt * 1.5) {
        p.lastClatter = time;
        this.events.push({ type: 'clatter', id: p.id, key: p.key, strength: dv, position: fromXYZ(b.translation()) });
      }
    }
    if (this.events.length > 64) this.events.splice(0, this.events.length - 64);
  }

  // The pieces where they are: [{ id, key, position, rotation, sleeping }]
  snapshot() { return this.pieces.map(p => ({ id: p.id, key: p.key, ...pose(p.body), sleeping: p.body.isSleeping() })); }
}
