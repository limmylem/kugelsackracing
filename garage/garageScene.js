// The garage in 3D (three.js): a workshop with a two-post lift and the player's car on it, put together
// from its parts (garage/visual.js).
//  - the camera orbits and zooms (mouse, touch, gamepad) and glides to each focus area (VIEWS, placed
//    for the car: carViews); the lift raises the car for the wheels and underside; the engine's cover
//    (a front engine's bonnet, a mid or rear engine's lid: engineCoverOf), the driver's door and the
//    boot open on their hinges for the engine bay, interior and rear, and close again when the camera
//    leaves
//  - a part being looked at can be shown as a see-through ghost on its socket(s)
//  - fitting and taking off parts is animated: the old part slides out along its socket's pull
//    direction and off towards the inventory, the new one slides in and settles (with sounds)
//  - the car's crash damage: its dents, broken glass and lights, a part hanging loose where it would
//    settle and one torn off not there; a repair is animated — the dents ease back out, a loose part
//    swings back into place and a torn-off one slides back into its socket (animateRepair)

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createCarVisual, placeholderBox, placeholderWing, resolveLook, tyreKey, tyreModel } from './visual.js';
import { tyreFit } from './tyres.js';
import { partShape } from './partShape.js';
import { wheelTransform } from '../physics/sockets.js';

export const LIFT_HEIGHT = 1.35;
// Camera views, in the car frame (+z forward, +x left): what to look at, from which way (az: degrees
// round from the front towards the left side; el: up), how far; lift: raise the car; open: a panel
export const VIEWS = {
  overview: { target: [0, 0.5, 0.05], az: 38, el: 14, dist: 6.3 },
  engine_bay: { target: [0, 0.7, 1.2], az: 30, el: 40, dist: 3.5, open: 'bonnet' },
  front: { target: [0, 0.45, 1.7], az: 18, el: 9, dist: 4.1 },
  rear: { target: [0, 0.7, -1.6], az: 150, el: 20, dist: 4.1, open: 'boot' },
  roof: { target: [0, 1.1, -0.2], az: 120, el: 40, dist: 4.4 },
  wheel_FL: { target: [0.74, 0.29, 1.2], az: 64, el: 5, dist: 2.5, lift: true },
  wheel_FR: { target: [-0.74, 0.29, 1.2], az: -64, el: 5, dist: 2.5, lift: true },
  wheel_RL: { target: [0.74, 0.29, -1.2], az: 116, el: 5, dist: 2.5, lift: true },
  wheel_RR: { target: [-0.74, 0.29, -1.2], az: -116, el: 5, dist: 2.5, lift: true },
  side_left: { target: [0.8, 0.55, 0], az: 90, el: 9, dist: 5.6 },
  side_right: { target: [-0.8, 0.55, 0], az: -90, el: 9, dist: 5.6 },
  interior: { target: [0.3, 0.82, 0], az: 74, el: 20, dist: 2.8, open: 'door' },
  underbody: { target: [0, 0.2, 0.1], az: 34, el: -17, dist: 3.9, lift: true },
  systems: { target: [0, 0.55, 0.1], az: 24, el: 24, dist: 6.2 },
};
// Panels that open on hinges (their socket nodes swing about the first one's origin; the mirror goes
// with the door, the wing with the boot lid; the side window hides while the door's open) — the
// starter car's; carHinges works them out for any car
const HINGES = {
  bonnet: { nodes: ['socket_bonnet'], axis: [1, 0, 0], angle: -0.95 },
  boot: { nodes: ['socket_boot', 'socket_spoiler'], axis: [1, 0, 0], angle: 1.0 },
  door: { nodes: ['socket_door_left', 'socket_mirror_left'], axis: [0, 1, 0], angle: -1.1, hide: ['glass_side_left'] },
};
const OPENS = 0.97;          // rad: how far a panel opens (its own hinge limits permitting)

// A car's hinged panels, from its sockets: the bonnet, the boot lid (and a spoiler on it), an engine
// cover (a mid or rear engine's lid), the driver's door (its mirror, and its window hiding); each opens
// the way its stock part's hinge does (detach.hinge.limits: the side it swings to). parts: definitions
export function carHinges(car, parts = {}) {
  const bySlot = slot => car.sockets.find(s => s.slot === slot), out = {};
  const hinge = (key, s, extra = [], hide = []) => {
    if (!s) return;
    const H = parts[s.stock?.[0]]?.detach?.hinge, lim = H?.limits ?? HINGES[key]?.limits, def = HINGES[key];
    const swing = lim ? Math.sign(Math.abs(lim[0]) > Math.abs(lim[1]) ? lim[0] : lim[1]) * Math.min(OPENS, Math.max(Math.abs(lim[0]), Math.abs(lim[1])) * Math.PI / 180) : def?.angle ?? OPENS;
    out[key] = { nodes: [s.name, ...extra.filter(Boolean)], axis: H?.axis ?? def?.axis ?? [1, 0, 0], angle: def && !H ? def.angle : swing, hide };
  };
  hinge('bonnet', bySlot('bonnet'));
  hinge('boot', bySlot('boot'), [bySlot('spoiler')?.name]);
  hinge('engine_cover', bySlot('engine_cover'));
  hinge('door', bySlot('door_left'), [bySlot('mirror_left')?.name], (car.model.breakables ?? []).filter(b => /side_left/.test(b.node)).map(b => b.node));
  // (the starter car's, as they always were)
  for (const k of Object.keys(out)) if (HINGES[k] && out[k].nodes.every((n, i) => n === HINGES[k].nodes[i])) out[k] = { ...HINGES[k], hide: HINGES[k].hide ?? [] };
  return out;
}
// Which panel shows the engine: car.engineCover (a socket), else the bonnet, boot lid or engine cover
// nearest the engine along the car — a front engine's bonnet, a mid or rear engine's lid
export function engineCoverOf(car, hinges = carHinges(car)) {
  const engine = car.sockets.find(s => s.slot === 'engine')?.position ?? [0, 0.3, 1.2];
  const key = { bonnet: 'bonnet', boot: 'boot', engine_cover: 'engine_cover' };
  if (car.engineCover) { const s = car.sockets.find(x => x.name === car.engineCover); return Object.keys(hinges).find(k => hinges[k].nodes[0] === s?.name) ?? null; }
  let best = null, d = Infinity;
  for (const k of Object.keys(key)) { const s = car.sockets.find(x => x.name === hinges[k]?.nodes[0]); if (s && Math.abs(s.position[2] - engine[2]) < d) { d = Math.abs(s.position[2] - engine[2]); best = k; } }
  return best;
}
// A car's camera views: the engine bay where its engine is (a mid or rear engine seen from behind, its
// cover opening), each wheel where it is; the rest as VIEWS
export function carViews(car, hinges = carHinges(car)) {
  const out = { ...VIEWS }, engine = car.sockets.find(s => s.slot === 'engine')?.position, cover = engineCoverOf(car, hinges);
  if (engine) out.engine_bay = engine[2] >= 0.5 && Math.abs(engine[2] - 1.2) < 0.2 ? { ...VIEWS.engine_bay, open: cover ?? VIEWS.engine_bay.open } : { target: [0, engine[1] + 0.4, engine[2]], az: engine[2] >= 0 ? 30 : 150, el: 40, dist: 3.5, open: cover };
  for (const k of ['FL', 'FR', 'RL', 'RR']) {
    const s = car.sockets.find(x => x.name === car.model.sockets[k]);
    if (s) out[`wheel_${k}`] = { ...VIEWS[`wheel_${k}`], target: [...s.position] };
  }
  return out;
}
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const easeOutBack = t => { const c = 1.4; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const deg = d => d * Math.PI / 180;

export class GarageScene {
  constructor({ renderer, models, sounds }) {
    this.renderer = renderer; this.models = models; this.sounds = sounds;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 80);
    this.env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture;
    this.scene.environment = this.env;
    this.scene.background = new THREE.Color('#0d1013');
    this.#room();
    this.#lift();
    this.carGroup = new THREE.Group();
    this.scene.add(this.carGroup);
    this.lift = { y: 0, target: 0 };
    this.hingeDefs = HINGES;
    this.views = VIEWS;
    this.hinges = Object.fromEntries(Object.keys(HINGES).map(k => [k, { open: 0, target: 0 }]));
    this.orbit = { target: new THREE.Vector3(...VIEWS.overview.target), az: VIEWS.overview.az, el: VIEWS.overview.el, dist: VIEWS.overview.dist };
    this.view = 'overview';
    this.tween = null;
    this.ghosts = [];
    this.busy = 0;
  }

  // ---------- the workshop ----------
  #room() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight('#dfe7ef', '#1b1e21', 0.7));
    const key = new THREE.DirectionalLight('#ffffff', 1.6);
    key.position.set(4, 9, 5); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
    Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 25 });
    s.add(key);
    const fill = new THREE.DirectionalLight('#cfe0ff', 0.5); fill.position.set(-6, 5, -4); s.add(fill);
    const rim = new THREE.DirectionalLight('#ffffff', 0.35); rim.position.set(0, 4, -8); s.add(rim);
    // floor: polished concrete with a painted bay round the lift
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshStandardMaterial({ color: '#34393f', roughness: 0.5, metalness: 0.05 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);
    const line = new THREE.MeshBasicMaterial({ color: '#b8932a' });
    for (const [w, d, x, z] of [[4.6, 0.06, 0, 3.4], [4.6, 0.06, 0, -3.4], [0.06, 6.86, 2.3, 0], [0.06, 6.86, -2.3, 0]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), line); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.003, z); s.add(m);
    }
    // walls and ceiling (seen from inside), with light strips overhead and a darker dado
    const walls = new THREE.Mesh(new THREE.BoxGeometry(24, 7, 24), new THREE.MeshStandardMaterial({ color: '#1c2126', roughness: 0.92, side: THREE.BackSide }));
    walls.position.y = 3.49; s.add(walls);   // (its floor just under the floor, not fighting it)
    const dado = new THREE.Mesh(new THREE.BoxGeometry(23.8, 1.2, 23.8), new THREE.MeshStandardMaterial({ color: '#15191d', roughness: 0.95, side: THREE.BackSide }));
    dado.position.y = 0.59; s.add(dado);
    const strip = new THREE.MeshBasicMaterial({ color: '#e9eef2' });
    for (const x of [-2.2, 0, 2.2]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 7), strip); m.rotation.x = Math.PI / 2; m.position.set(x, 6.98, 0); s.add(m); }
    // tool cabinets along the back wall
    const cab = new THREE.MeshStandardMaterial({ color: '#2a3138', roughness: 0.6, metalness: 0.3 });
    for (let i = 0; i < 5; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.0, 0.55), cab); m.position.set(-4.4 + i * 1.15, 0.5, -8.6); m.castShadow = true; m.receiveShadow = true; s.add(m); }
    // a soft shadow under the car (the lift fades it)
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), grad = g.createRadialGradient(64, 64, 8, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.62)'); grad.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    this.contact = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4.9), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    this.contact.rotation.x = -Math.PI / 2; this.contact.position.y = 0.006; s.add(this.contact);
  }

  // ---------- the two-post lift ----------
  // (each side's post, base and carriage have their own materials: a post between the camera and the
  // car fades out so it doesn't hide it)
  #lift() {
    const pad = new THREE.MeshStandardMaterial({ color: '#b8932a', roughness: 0.7 });
    const box = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true; return b; };
    const fixed = new THREE.Group();
    this.liftMoving = new THREE.Group();
    this.posts = [];
    for (const side of [-1, 1]) {
      const metal = new THREE.MeshStandardMaterial({ color: '#343c44', roughness: 0.45, metalness: 0.55, transparent: true });
      const dark = new THREE.MeshStandardMaterial({ color: '#1d2227', roughness: 0.6, metalness: 0.3, transparent: true });
      fixed.add(box(0.32, 3.3, 0.36, metal, side * 1.68, 1.65, 0.15));
      fixed.add(box(0.62, 0.04, 0.7, dark, side * 1.68, 0.02, 0.15));
      // what goes up and down: a carriage on the post with two swing arms reaching under the sills
      this.liftMoving.add(box(0.3, 0.5, 0.42, dark, side * 1.46, 0.3, 0.15));
      for (const z of [0.85, -0.7]) {
        const from = new THREE.Vector3(side * 1.36, 0.1, 0.15), to = new THREE.Vector3(side * 0.62, 0.1, z), len = from.distanceTo(to);
        const arm = box(len, 0.07, 0.12, metal, (from.x + to.x) / 2, 0.1, (from.z + to.z) / 2);
        arm.rotation.y = -Math.atan2(to.z - from.z, to.x - from.x);
        this.liftMoving.add(arm);
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 20), pad); p.position.set(to.x, 0.155, to.z); p.castShadow = true;
        this.liftMoving.add(p);
      }
      this.posts.push({ x: side * 1.68, z: 0.15, materials: [metal, dark], fade: 1 });
    }
    const top = new THREE.MeshStandardMaterial({ color: '#343c44', roughness: 0.45, metalness: 0.55 });
    fixed.add(box(3.68, 0.2, 0.24, top, 0, 3.35, 0.15));
    this.scene.add(fixed, this.liftMoving);
  }
  // (a post fades while it stands between the camera and what it's looking at)
  #fadePosts(dt) {
    const c = this.camera.position, t = this.orbit.target;
    for (const p of this.posts) {
      const dx = t.x - c.x, dz = t.z - c.z, len2 = dx * dx + dz * dz;
      const k = len2 ? ((p.x - c.x) * dx + (p.z - c.z) * dz) / len2 : -1;
      const off = Math.hypot(c.x + dx * k - p.x, c.z + dz * k - p.z);
      const want = k > 0 && k < 1.15 && off < 0.9 ? 0.1 : 1;
      p.fade += (want - p.fade) * Math.min(1, dt * 8);
      for (const m of p.materials) { m.opacity = p.fade; m.depthWrite = p.fade > 0.5; }   // (transparent all along: switching it recompiles)
    }
  }

  // ---------- the car ----------
  // Build (or rebuild) the car: car definition, the build, the garage's view of the parts, its paint
  async setCar({ car, finishes, build, view, paint, rig, spec, damage, rules }) {
    if (!this.vis || this.vis.car !== car) {
      this.vis?.dispose();
      this.vis = await createCarVisual({ car, finishes, models: this.models, paint, environment: this.env });
      this.carGroup.add(this.vis.group);
      this.hingeRest = null;
      // (its own panels and views: where its engine and wheels are)
      this.hingeDefs = carHinges(car, view?.parts);
      this.views = carViews(car, this.hingeDefs);
      this.hinges = Object.fromEntries(Object.keys(this.hingeDefs).map(k => [k, { open: 0, target: 0 }]));
    }
    this.rig = this.rigFor ? await this.rigFor(car) : rig; this.spec = spec;
    await this.vis.applyBuild(build, view);
    if (paint && (this.vis.paint.colour !== paint.colour || this.vis.paint.finish !== paint.finish)) this.vis.setPaint(paint);
    if (damage && rules) this.vis.setDamage(damage, rules);        // (its dents and broken glass, until they're repaired)
    this.#restHinges();
    this.vis.showAttach(damage?.attach ?? {}, view?.parts ?? {});   // (loose parts hanging, torn-off ones gone)
  }
  setSpec(spec) { if (spec) this.spec = spec; }
  previewPaint(paint) { if (this.vis && paint) this.vis.setPaint(paint); }

  // (the hinged nodes' closed positions, taken once the car's built)
  #restHinges() {
    if (this.hingeRest) return;
    this.hingeRest = {};
    for (const [k, h] of Object.entries(this.hingeDefs)) {
      const nodes = h.nodes.map(n => this.vis.nodes.get(n)).filter(Boolean);
      if (!nodes.length) continue;
      this.hingeRest[k] = { pivot: nodes[0].position.clone(), nodes: nodes.map(n => ({ n, p: n.position.clone(), q: n.quaternion.clone() })), hide: (h.hide || []).map(n => this.vis.nodes.get(n)).filter(Boolean) };
    }
  }

  // ---------- focus ----------
  // Glide to a view (a key of VIEWS: a focus area or a wheel); opens and closes panels, raises the lift
  focus(name) {
    const v = this.views[name] ?? this.views.overview;
    this.view = name;
    const from = { target: this.orbit.target.clone(), az: this.orbit.az, el: this.orbit.el, dist: this.orbit.dist };
    let az = v.az; while (az - from.az > 180) az -= 360; while (az - from.az < -180) az += 360;
    this.tween = { t: 0, seconds: 1.0, from, to: { target: new THREE.Vector3(...v.target), az, el: v.el, dist: v.dist }, followsLift: !!v.lift };
    this.lift.target = v.lift ? LIFT_HEIGHT : 0;
    for (const k of Object.keys(this.hinges)) this.hinges[k].target = v.open === k ? 1 : 0;
  }
  // (camera input: drag to orbit, scroll / pinch to zoom; any of it stops a glide)
  orbitBy(dAz, dEl) { this.tween = null; this.orbit.az += dAz; this.orbit.el = Math.max(-28, Math.min(80, this.orbit.el + dEl)); }
  zoomBy(factor) { this.tween = null; this.orbit.dist = Math.max(1.6, Math.min(12, this.orbit.dist * factor)); }
  // zoomed out: the overview, or further out than the view the camera went to
  get zoomedOut() { return this.view === 'overview' || this.view === 'systems' || this.orbit.dist > (this.views[this.view]?.dist ?? 5) + 0.8; }
  // Screen space the UI covers (CSS px: left, right, top, bottom): the car centres in what's left
  setInsets(insets) { this.insets = insets; }

  attachInput(el) {
    const pointers = new Map();
    this.pointers = pointers;
    let pinch = null;
    el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pointers.size === 2) pinch = this.#pinchDist(pointers); });
    el.addEventListener('pointermove', e => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      if (pointers.size === 1) this.orbitBy(-(e.clientX - p.x) * 0.3, (e.clientY - p.y) * 0.25);
      p.x = e.clientX; p.y = e.clientY;
      if (pointers.size === 2) { const d = this.#pinchDist(pointers); if (pinch) this.zoomBy(pinch / d); pinch = d; }
    });
    const up = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', e => { e.preventDefault(); this.zoomBy(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
  }
  #pinchDist(pointers) { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); }

  // ---------- each frame ----------
  update(dt) {
    // the lift (and its hum)
    const L = this.lift, dir = Math.sign(L.target - L.y);
    if (dir) { L.y += dir * Math.min(Math.abs(L.target - L.y), dt * 0.75); this.sounds?.lift(true); } else this.sounds?.lift(false);
    const lk = L.y / LIFT_HEIGHT, liftEase = ease(Math.min(1, Math.max(0, lk)));
    this.carGroup.position.y = L.y;
    this.liftMoving.position.y = L.y;
    this.contact.material.opacity = 1 - 0.85 * liftEase;
    // the wheels hang on their springs once off the ground
    if (this.vis && this.rig && this.spec) {
      const W = this.spec.wheels, S = this.spec.suspension;
      for (const [k, pivot] of Object.entries(this.vis.wheels)) {
        const mount = W.mountHeight?.[W.front.includes(k) ? 'front' : 'rear'] ?? 0;
        const t = wheelTransform(this.rig.wheels[k], [0, 0, 0, 1], 0, 0, (mount - S.restLength) * Math.min(1, lk * 4), W.offsets?.[k] ?? 0);
        pivot.quaternion.fromArray(t.rotation); pivot.position.fromArray(t.position);
      }
    }
    // hinged panels
    for (const [k, h] of Object.entries(this.hinges)) {
      const d = Math.sign(h.target - h.open);
      if (d) h.open += d * Math.min(Math.abs(h.target - h.open), dt / 0.7);
      this.#applyHinge(k, ease(h.open));
    }
    // (the dealership's turntable: the camera slowly round the car)
    if (this.turntable && !this.tween && !this.pointers?.size) this.orbit.az += dt * 14;
    // the camera: a glide to a view, or where the player left it
    if (this.tween) {
      const T = this.tween;
      T.t = Math.min(1, T.t + dt / T.seconds);
      const e = ease(T.t), o = this.orbit;
      o.target.lerpVectors(T.from.target, T.to.target, e);
      o.az = T.from.az + (T.to.az - T.from.az) * e; o.el = T.from.el + (T.to.el - T.from.el) * e; o.dist = T.from.dist + (T.to.dist - T.from.dist) * e;
      if (T.t >= 1) this.tween = null;
    }
    const o = this.orbit, target = o.target.clone().add(new THREE.Vector3(0, L.y, 0));
    // (a tall, narrow screen — or a narrow space beside a wide panel — sees less across: step back so
    // the car still fits)
    const I = this.insets ?? { left: 0, right: 0, top: 0, bottom: 0 }, W = innerWidth, H = innerHeight;
    const across = Math.min(this.camera.aspect, (W - I.left - I.right) / Math.max(1, H - I.top - I.bottom));
    const back = Math.max(1, (1.25 / Math.max(0.2, across)) ** 0.75);
    this.stepBack = this.stepBack == null ? back : this.stepBack + (back - this.stepBack) * Math.min(1, dt * 6);
    const a = deg(o.az), el = deg(o.el), dist = o.dist * this.stepBack;
    this.camera.position.set(target.x + dist * Math.sin(a) * Math.cos(el), target.y + dist * Math.sin(el), target.z + dist * Math.cos(a) * Math.cos(el));
    this.camera.position.y = Math.max(0.15, this.camera.position.y);
    this.camera.lookAt(target);
    // (shift the picture to the middle of the space the panels leave, gliding when they open and close)
    const want = { x: (I.right - I.left) / 2, y: (I.bottom - I.top) / 2 };
    this.shift ??= { ...want };
    this.shift.x += (want.x - this.shift.x) * Math.min(1, dt * 6); this.shift.y += (want.y - this.shift.y) * Math.min(1, dt * 6);
    this.camera.setViewOffset(W, H, this.shift.x, this.shift.y, W, H);
    this.#fadePosts(dt);
    for (const g of this.ghosts) g.pulse = (g.pulse ?? 0) + dt;
    if (this.ghostMaterial) { const k = Math.sin(performance.now() / 260); this.ghostMaterial.opacity = 0.32 + 0.1 * k; this.xrayMaterial.opacity = 0.2 + 0.06 * k; }
  }

  #applyHinge(k, open) {
    const rest = this.hingeRest?.[k], h = this.hingeDefs[k];
    if (!rest) return;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...h.axis), h.angle * open);
    for (const { n, p, q: q0 } of rest.nodes) {
      n.position.copy(p).sub(rest.pivot).applyQuaternion(q).add(rest.pivot);
      n.quaternion.copy(q).multiply(q0);
    }
    for (const n of rest.hide) n.visible = open < 0.05;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  // ---------- markers ----------
  // Where a socket is on screen (CSS px): { x, y, visible, depth, facing } — tyres are marked on their
  // tread and spacers on the hub, not on top of the wheel's marker; facing: on the camera's side of
  // the car (not seen through it)
  socketOnScreen(socket, w, h) {
    const node = this.vis?.attachPoint(socket.name);
    if (!node) return null;
    const p = new THREE.Vector3();
    node.getWorldPosition(p);
    if (socket.def.slot === 'tyre') p.y += 0.24;
    if (socket.def.slot === 'spacer') p.y -= 0.12;
    const v = p.clone().project(this.camera);
    const centre = this.carGroup.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.55, 0));
    const out = p.clone().sub(centre), toCam = this.camera.position.clone().sub(centre).normalize();
    return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h, visible: v.z < 1 && v.z > -1, depth: this.camera.position.distanceTo(p), facing: out.dot(toCam) > -0.3 };
  }

  // ---------- ghosts ----------
  // Show parts as see-through ghosts where they'd go (entries: [{ socket, part, rim }] — rim: the rim
  // a tyre would go on), hiding what's there now; clearGhost() puts it all back
  async ghost(entries, parts) {
    const token = (this.ghostToken = (this.ghostToken ?? 0) + 1);
    this.clearGhost(false);
    this.ghostMaterial ??= new THREE.MeshBasicMaterial({ color: '#1f8fd6', transparent: true, opacity: 0.38, depthWrite: false, toneMapped: false });
    this.edgeMaterial ??= new THREE.LineBasicMaterial({ color: '#5cc3f8', transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });
    this.xrayMaterial ??= new THREE.MeshBasicMaterial({ color: '#36B3F5', transparent: true, opacity: 0.2, depthWrite: false, depthFunc: THREE.GreaterDepth, toneMapped: false });
    for (const e of entries) {
      const at = this.vis.attachPoint(e.socket);
      if (!at) continue;
      const look = resolveLook(e.part, parts, null, this.vis.car.id), current = this.vis.partObject(e.socket);
      let obj = null, key = null;
      try {
        if (e.part.tyreSize && e.rim?.rim) { const fit = tyreFit(e.rim.rim, e.part.tyreSize); key = tyreKey(fit); obj = await this.models.acquire(key, () => tyreModel(fit)); }
        else if (look.model) { key = look.model; obj = await this.models.acquire(key); }
        else if (look.placeholder?.width) obj = placeholderWing(look.placeholder);
        else if (look.bounds) obj = placeholderBox(look.bounds, false);
      } catch { obj = look.bounds ? placeholderBox(look.bounds, false) : null; key = null; }
      if (token !== this.ghostToken) { if (key) this.models.release(key); return; }
      if (!obj) continue;
      // (and a fainter copy seen through whatever's in front of it: parts inside the engine bay)
      obj.traverse(o => { if (o.isMesh || o.isLineSegments) { o.material = this.ghostMaterial; o.castShadow = false; o.renderOrder = 5; } });
      // (its outline, crisp over the see-through fill)
      const edges = [];
      obj.traverse(o => { if (o.isMesh) edges.push(o); });
      const made = edges.map(m => { const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25), this.edgeMaterial); e.renderOrder = 6; m.add(e); return e; });
      const xray = obj.clone();
      xray.traverse(o => { if (o.isMesh || o.isLineSegments) { o.material = this.xrayMaterial; o.renderOrder = 4; } });
      const wrap = new THREE.Group();
      wrap.add(xray, obj);
      if (look.look?.scale) { const s = look.look.scale; typeof s === 'number' ? wrap.scale.setScalar(s) : wrap.scale.set(...s); }
      at.add(wrap);
      if (obj.userData.carFrame) { this.vis.group.updateMatrixWorld(true); wrap.quaternion.copy(this.vis.group.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(at.getWorldQuaternion(new THREE.Quaternion())).invert()); }
      if (current) current.visible = false;
      this.ghosts.push({ obj: wrap, key, current, made });
    }
  }
  clearGhost(bump = true) {
    if (bump) this.ghostToken = (this.ghostToken ?? 0) + 1;
    for (const g of this.ghosts) {
      g.obj.removeFromParent();
      for (const e of g.made ?? []) { e.removeFromParent(); e.geometry.dispose(); }
      if (g.key) this.models.release(g.key);
      if (g.current) g.current.visible = true;
    }
    this.ghosts = [];
  }

  // ---------- the whole car see-through (the Systems list: parts with no model) ----------
  setSeeThrough(on) {
    if (!this.vis) return;
    this.seeThroughMat ??= new THREE.MeshStandardMaterial({ color: '#8a96a3', transparent: true, opacity: 0.16, depthWrite: false, roughness: 0.6 });
    this.seeThrough ??= new WeakMap();
    this.vis.group.traverse(o => {
      if (!o.isMesh) return;
      if (on && !this.seeThrough.has(o)) { this.seeThrough.set(o, o.material); o.material = this.seeThroughMat; o.castShadow = false; }
      else if (!on && this.seeThrough.has(o)) { o.material = this.seeThrough.get(o); this.seeThrough.delete(o); o.castShadow = true; }
    });
    this.seeThroughOn = on;
  }

  // ---------- fitting and taking off, animated ----------
  // ops: what the garage did, in order ({ op: 'remove' | 'install', socket, instanceId }); apply(): put
  // the new build on the car; partOf(instanceId): the part. Parts come off one socket (or group) at a
  // time, then the new build goes on and the new parts (and whatever was taken off to reach them)
  // slide in. A part with no model of its own (inside the engine, say) slides as a box its size.
  async animateChange(ops, apply, carSockets, groups, partOf = () => null) {
    this.busy++;
    try {
      this.clearGhost();
      const phases = [];
      for (const o of ops) {
        const g = Object.values(groups || {}).find(x => x.includes(o.socket)), key = `${o.op}:${g ? g.join() : o.socket}`;
        const last = phases[phases.length - 1], item = { socket: o.socket, part: partOf(o.instanceId) };
        if (last && last.key === key) last.items.push(item); else phases.push({ key, op: o.op, items: [item] });
      }
      const firstIn = phases.findIndex(p => p.op === 'install');
      const outPhases = firstIn < 0 ? phases : phases.slice(0, firstIn), inPhases = firstIn < 0 ? [] : phases.slice(firstIn);
      for (const p of outPhases) await this.#slideOut(p.items, carSockets);
      await apply();
      if (this.seeThroughOn) this.setSeeThrough(true);
      // (what's still to slide in stays out of sight until its turn)
      for (const p of inPhases) if (p.op === 'install') for (const it of p.items) { const o = this.vis.partObject(it.socket); if (o) o.visible = false; }
      for (const p of inPhases) if (p.op === 'install') await this.#slideIn(p.items, carSockets); else await this.#slideOut(p.items, carSockets);
    } finally { this.busy--; }
  }
  // the socket's pull direction (car frame) in the part's parent's axes
  #pullIn(obj, def) {
    const pull = new THREE.Vector3(...(def?.pull ?? [0, 1, 0])).normalize();
    const car = this.vis.group.getWorldQuaternion(new THREE.Quaternion()), parent = obj.parent.getWorldQuaternion(new THREE.Quaternion());
    return pull.applyQuaternion(car).applyQuaternion(parent.invert());
  }
  // a stand-in for a part with no model: a box its size, seen through whatever's in front of it
  #standIn(socket, part) {
    const at = this.vis.attachPoint(socket);
    const shape = part ? partShape(part, {}, this.vis.car.id) : null;
    if (!at || !shape?.bounds || shape.model) return null;
    this.standInMaterial ??= new THREE.MeshBasicMaterial({ color: '#a9b6c2', transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, toneMapped: false });
    const obj = placeholderBox(shape.bounds, false);
    obj.traverse(o => { if (o.isMesh || o.isLineSegments) { o.material = this.standInMaterial; o.castShadow = false; o.renderOrder = 7; } });
    at.add(obj);
    return obj;
  }
  #items(list, carSockets, visibleOnly) {
    return list.map(({ socket, part }) => {
      const def = carSockets.find(x => x.name === socket);
      let obj = this.vis.partObject(socket), temp = false;
      if (!obj || (visibleOnly && !obj.visible) || !obj.parent || !hasMesh(obj)) { obj = this.#standIn(socket, part); temp = !!obj; }
      return obj && { obj, def, temp };
    }).filter(Boolean);
  }
  #slideOut(list, carSockets) {
    const items = this.#items(list, carSockets, true);
    this.sounds?.ratchet(); this.sounds?.whoosh(true, 0.32);
    if (!items.length) return wait(160);
    for (const it of items) {
      it.rest = (!it.temp && this.vis.restOf(it.obj)) || { position: it.obj.position.clone(), scale: it.obj.scale.clone(), quaternion: it.obj.quaternion.clone() };
      it.dir = this.#pullIn(it.obj, it.def);
      // (towards the inventory: down and away to the lower left of the screen)
      const away = new THREE.Vector3(-1, -0.8, 0).applyQuaternion(this.camera.quaternion);
      it.away = away.applyQuaternion(it.obj.parent.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
    }
    return animate(0.34, t => {
      for (const it of items) {
        const e = t * t, off = it.dir.clone().multiplyScalar(0.75 * e).add(it.away.clone().multiplyScalar(2.4 * Math.max(0, (t - 0.45) / 0.55) ** 2));
        it.obj.position.copy(it.rest.position).add(off);
        it.obj.scale.copy(it.rest.scale).multiplyScalar(1 - 0.85 * Math.max(0, (t - 0.55) / 0.45));
      }
    }).then(() => { for (const it of items) { if (it.temp) disposeStandIn(it.obj); else it.obj.visible = false; } });
  }
  #slideIn(list, carSockets) {
    const items = this.#items(list, carSockets, false);
    if (!items.length) { this.sounds?.clunk(); return wait(140); }
    this.sounds?.whoosh(false, 0.3);
    for (const it of items) {
      it.rest = (!it.temp && this.vis.restOf(it.obj)) || { position: it.obj.position.clone(), scale: it.obj.scale.clone(), quaternion: it.obj.quaternion.clone() };
      it.dir = this.#pullIn(it.obj, it.def);
      it.obj.visible = true;
    }
    return animate(0.36, t => {
      const e = easeOutBack(t);
      for (const it of items) {
        it.obj.position.copy(it.rest.position).addScaledVector(it.dir, 0.8 * (1 - e));
        it.obj.scale.copy(it.rest.scale).multiplyScalar(0.6 + 0.4 * Math.min(1, t * 2.5));
      }
    }).then(() => {
      for (const it of items) { if (it.temp) disposeStandIn(it.obj); else { it.obj.position.copy(it.rest.position); it.obj.scale.copy(it.rest.scale); } }
      this.sounds?.clunk();
    });
  }

  // A repair, shown: from the damage before (as setCar takes it: { shell, parts, attach }) to after — the
  // dents easing out, loose parts swinging back into place, torn-off ones sliding back into their sockets.
  // parts: the part definitions; sockets: the car's
  async animateRepair(before, after, { rules, parts = {}, sockets = [], seconds = 0.9 } = {}) {
    if (!this.vis) return;
    this.busy++;
    try {
      this.clearGhost();
      const vis = this.vis, blend = vis.blendDamage(before, after, rules), was = before?.attach ?? {}, now = after?.attach ?? {};
      const back = Object.keys(was).filter(s => (now[s] ?? 'attached') === 'attached');
      const swing = back.filter(s => was[s] === 'loose' && vis.partState(s) === 'loose'), slide = back.filter(s => was[s] === 'detached');
      if (blend.meshes || swing.length) {
        this.sounds?.whoosh(false, 0.25);
        await animate(seconds, t => {
          const e = ease(t);
          blend.set(e);
          for (const s of swing) vis.setPartPose(s, vis.restingPose(s, parts, 1 - e));
        });
      }
      blend.done();
      for (const s of swing) vis.reattachPart(s);
      if (slide.length) {
        vis.showAttach(Object.fromEntries(Object.entries(now).filter(([s]) => !slide.includes(s))), parts);
        for (const s of slide) { const o = vis.partObject(s); if (o) o.visible = false; }
        await this.#slideIn(slide.map(socket => ({ socket, part: vis.attached.get(socket)?.part ?? null })), sockets);
      }
      vis.showAttach(now, parts);
    } finally { this.busy--; }
  }

  dispose() { this.clearGhost(); this.vis?.dispose(); this.env.dispose(); }
}

const wait = ms => new Promise(r => setTimeout(r, ms));
const hasMesh = obj => { let found = false; obj.traverse(o => { if (o.isMesh) found = true; }); return found; };
const disposeStandIn = obj => { obj.removeFromParent(); obj.traverse(o => o.geometry?.dispose()); };
// run fn(t) for t 0 → 1 over `seconds`, one step a frame
function animate(seconds, fn) {
  return new Promise(resolve => {
    const start = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / 1000 / seconds);
      fn(t);
      if (t < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
}
