// Drawing cars from their parts (three.js): each car is its body model with every fitted part's model
// on its socket, tyres made to fit the rims they're on, the car's paint and the parts' finishes.
//
//  - ModelCache: every model file is loaded once (meshopt-compressed or not), however many cars use it; each car gets a clone
//    that shares its geometry, materials and textures (the same image in several files is one
//    texture). Counted: a model no car uses any more is disposed.
//  - createCarVisual({ car, finishes, models, paint }) → a CarVisual (group: the car, in the car frame).
//    applyBuild(visual, build, view) compares what's on each socket with the build and changes only
//    what's different; a part being swapped stays in view until the new one has loaded. A part whose
//    model won't load is drawn as a box from its bounds (and says so in the console); a part with no
//    model but bounds (or placeholder sizes) is drawn as a placeholder; one with neither shows nothing
//    (an ECU), like an empty socket (take the bonnet off: there's the engine).
//  - Where a part goes: its socket's node in the body (or the socket's `node`: a tyre on its wheel);
//    a socket the model doesn't have gets a node at its car.json position. Wheels hang from a pivot
//    under each wheel socket (wheelPivotName: wheel_FL…), which the game turns as the wheel spins,
//    steers and rides the suspension (physics/sockets.js modelRig), taking the rim and tyre with it.
//  - A part's look: its definition's look (a finish from data/finishes.json, a colour, a scale; a
//    variant — variantOf — takes its base part's model, bounds and look first), then its owner's own
//    colour / finish. Any material named as the car's paint (model.paintMaterial), on the body or any
//    part, is the car's paint: one material per car (setPaint), unless the part has its own finish or
//    colour. The brake lights and glass are per car too (they change from car to car).
//  - hides: sockets (whatever's in them) or model nodes hidden while a part is fitted.
//  - showSockets(): every socket as a small labelled axis gizmo.
//  - Crash damage (setDamage): the dents on each part and on the body shell (garage/damage.js keeps
//    them; garage/dents.js pushes the vertices in, on this car's own copy of the meshes), and the glass
//    and lights broken (cracked). showCondition() colours every part by its condition (a debug view).
//  - Parts shaken loose or torn off (loosenPart, detachPart, reattachPart): a loose part hangs off the
//    car where the physics has it (setPartPose); a torn-off one is taken off the car to lie in the world
//    (the game places it: pieceMatrix), dents and all, until it's put back. Both show both sides. A
//    wheel torn off (detachWheel, reattachWheel) takes its whole pivot: rim, tyre and spacer.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { carFrameToModel, wheelPivotName } from '../physics/sockets.js';
import { tyreFit } from './tyres.js';
import { clearDents, finerOf, setDents } from './dents.js';
import { dentSize } from './damage.js';
import { KEEPS_LOOK, partShape } from './partShape.js';

const TEXTURE_SLOTS = ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'bumpMap'];
const PHYSICAL = ['clearcoat', 'iridescence', 'sheen'];
const PER_CAR = /tail|brake|glass/i;          // body materials each car needs its own copy of
let environment = null;                        // reflections for reflective finishes (setEnvironment)

// The environment map reflective finishes (chrome, metallic paint) reflect. Set it before making cars.
export function setEnvironment(texture) { environment = texture; }

// An outdoor environment map: sky above, a bright horizon, the ground below (what a car outside
// reflects), for setEnvironment
export function skyEnvironment(renderer, { sky = '#8fbbe6', horizon = '#eef3f7', ground = '#55595d' } = {}) {
  const geo = new THREE.SphereGeometry(10, 48, 24), colours = [], pos = geo.getAttribute('position'), c = new THREE.Color();
  const [S, H, G] = [sky, horizon, ground].map(x => new THREE.Color(x));
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 10;
    if (y >= 0) c.copy(H).lerp(S, Math.pow(y, 0.6)); else c.copy(H).lerp(G, Math.min(1, -y * 6));
    colours.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const pmrem = new THREE.PMREMGenerator(renderer), texture = pmrem.fromScene(scene, 0).texture;
  pmrem.dispose(); geo.dispose();
  return texture;
}

// ---------- models, loaded once ----------

export class ModelCache {
  // load(url) → Promise<{ scene, parser }> (a GLTFLoader, unless a test gives its own)
  constructor({ load } = {}) {
    // (models from npm run import are meshopt-compressed: EXT_meshopt_compression)
    this.load = load ?? (url => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url));
    this.entries = new Map();     // key → { refs, promise, template }
    this.textures = new Map();    // image key → { texture, refs }
    this.loads = new Map();       // key → times it was loaded (the debug console's "loaded once" check)
  }

  // A clone of a model (a file, or with make: a model made here, e.g. a tyre) that shares its geometry,
  // materials and textures. Counted until release(key).
  async acquire(key, make) {
    let e = this.entries.get(key);
    if (!e) {
      e = { refs: 0, template: null };
      this.loads.set(key, (this.loads.get(key) ?? 0) + 1);
      e.promise = (make ? Promise.resolve().then(make) : this.#loadFile(key)).then(t => (e.template = t));
      this.entries.set(key, e);
    }
    e.refs++;
    let template;
    try { template = await e.promise; } catch (err) { this.release(key); throw err; }
    return template.clone(true);
  }

  release(key) {
    const e = this.entries.get(key);
    if (!e || --e.refs > 0) return;
    this.entries.delete(key);
    e.promise.then(t => this.#dispose(t), () => {});
  }

  // What's loaded: [{ model, cars using it (clones), times loaded }]
  stats() {
    return [...new Set([...this.entries.keys(), ...this.loads.keys()])].map(key => ({ model: key, inUse: this.entries.get(key)?.refs ?? 0, loaded: this.loads.get(key) ?? 0 }));
  }

  async #loadFile(url) {
    const gltf = await this.load(url);
    const scene = gltf.scene;
    if (gltf.parser) await this.#shareTextures(scene, gltf.parser, url);
    return scene;
  }

  // The same image (by content, or by file for an external one) is one texture, whichever file it's in
  async #shareTextures(scene, parser, url) {
    const keys = new Set(), json = parser.json;
    const keyOf = async texture => {
      const ref = parser.associations.get(texture), def = ref?.textures !== undefined ? json.textures[ref.textures] : null, image = def && json.images?.[def.source];
      if (!image) return null;
      const how = `${JSON.stringify(json.samplers?.[def.sampler] ?? {})}|${texture.colorSpace}|${texture.flipY}|${texture.channel}`;
      if (image.uri && !image.uri.startsWith('data:')) return `file:${new URL(image.uri, new URL(url, globalThis.location?.href ?? 'file:///')).href}|${how}`;
      const bytes = image.bufferView !== undefined ? new Uint8Array(await parser.getDependency('bufferView', image.bufferView)) : new TextEncoder().encode(image.uri);
      return `image:${bytes.length}:${hash(bytes)}|${how}`;
    };
    const materials = new Set();
    scene.traverse(o => { if (o.isMesh) for (const m of [o.material].flat()) materials.add(m); });
    for (const m of materials) for (const slot of TEXTURE_SLOTS) {
      const t = m[slot];
      if (!t) continue;
      const key = await keyOf(t);
      if (!key) continue;
      let shared = this.textures.get(key);
      if (!shared) this.textures.set(key, shared = { texture: t, refs: 0 });
      if (!keys.has(key)) { keys.add(key); shared.refs++; }
      if (shared.texture !== t) { m[slot] = shared.texture; t.dispose(); }
    }
    scene.userData.textureKeys = [...keys];
  }

  #dispose(template) {
    const materials = new Set();
    template.traverse(o => { if (o.isMesh) { o.geometry.dispose(); for (const m of [o.material].flat()) materials.add(m); } });
    const keyed = new Set((template.userData.textureKeys ?? []).map(k => this.textures.get(k)?.texture));
    for (const m of materials) { for (const slot of TEXTURE_SLOTS) if (m[slot] && !keyed.has(m[slot])) m[slot].dispose(); m.dispose(); }
    for (const key of template.userData.textureKeys ?? []) {
      const t = this.textures.get(key);
      if (t && --t.refs <= 0) { t.texture.dispose(); this.textures.delete(key); }
    }
  }
}

// FNV-1a over bytes (a texture's identity)
function hash(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

// ---------- finishes ----------

// A copy of a model's material in a finish (data/finishes.json) and / or colour (env: what reflective
// finishes reflect, if not the one set with setEnvironment)
export function finishMaterial(src, finish, colour, env = environment) {
  const physical = !!finish && PHYSICAL.some(k => finish[k]);
  const m = physical ? new THREE.MeshPhysicalMaterial() : new THREE.MeshStandardMaterial();
  if (src?.isMeshStandardMaterial) {
    THREE.MeshStandardMaterial.prototype.copy.call(m, src);
    m.defines = physical ? { STANDARD: '', PHYSICAL: '' } : { STANDARD: '' };
  } else if (src) { m.name = src.name; if (src.color) m.color.copy(src.color); if (src.map) m.map = src.map; }
  if (finish) {
    for (const k of ['roughness', 'metalness']) if (finish[k] !== undefined) m[k] = finish[k];
    if (physical) {
      for (const k of ['clearcoat', 'clearcoatRoughness', 'iridescence', 'iridescenceIOR', 'sheen', 'sheenRoughness']) if (finish[k] !== undefined) m[k] = finish[k];
      if (finish.sheenColour) m.sheenColor.set(finish.sheenColour);
    }
    if (finish.reflective && env) { m.envMap = env; m.envMapIntensity = finish.envIntensity ?? 1; }
  }
  const c = colour ?? finish?.colour;
  if (c) { m.color.set(c); if (!finish?.keepTexture) m.map = null; }
  m.needsUpdate = true;
  return m;
}

// A part's look, all things considered: its model, bounds and placeholder (from the first of it and the
// parts it's a variant of that has one), its look over theirs, and its owner's colour / finish over that
export function resolveLook(part, parts, instance, carId = null) {
  const chain = [];
  for (let p = part; p && !chain.includes(p) && chain.length < 8; p = p.variantOf ? parts[p.variantOf] : null) chain.push(p);
  const first = key => chain.find(p => p[key] && (typeof p[key] !== 'string' || p[key].length))?.[key], shape = partShape(part, parts, carId);
  const look = {};
  for (const p of chain.slice().reverse()) {
    const { materials, ...rest } = p.look ?? {};
    Object.assign(look, rest);
    if (materials) look.materials = { ...look.materials, ...materials };
  }
  if (instance?.paint?.colour) look.colour = instance.paint.colour;
  if (instance?.paint?.finish) look.finish = instance.paint.finish;
  return { model: shape.model, bounds: shape.bounds ?? null, placeholder: first('placeholder') ?? null, look: Object.keys(look).length ? look : null };
}

// ---------- tyres ----------

// The stock tyre's cross-section, from the bead to the edge of the tread: [share of the half width,
// share of the sidewall height] (measured from the modelled starter car's tyre)
const TYRE_PROFILE = [[0.8889, 0], [1, 0.6], [0.9444, 0.85], [0.6667, 1]];
export const tyreKey = (fit, segments = 18) => `tyre:${+fit.rimRadius.toFixed(5)}:${+fit.width.toFixed(5)}:${+fit.sidewall.toFixed(5)}:${segments}`;

// A low-poly tyre round the x axis (the axle), flat-shaded, `segments` faces round: fit from tyreFit
export function tyreGeometry(fit, segments = 18) {
  const { rimRadius, width, sidewall } = fit, half = width / 2, rMid = rimRadius + sidewall / 2;
  const section = [...TYRE_PROFILE.map(([u, v]) => [-u * half, rimRadius + v * sidewall]), ...TYRE_PROFILE.slice().reverse().map(([u, v]) => [u * half, rimRadius + v * sidewall])];
  const at = ([x, r], a) => new THREE.Vector3(x, r * Math.sin(a), r * Math.cos(a));
  const pos = [], ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Vector3();
  const tri = (A, B, C) => {
    // facing out of the tyre (away from the middle of its section)
    n.crossVectors(ab.subVectors(B, A), ac.subVectors(C, A));
    c.copy(A).add(B).add(C).divideScalar(3);
    const a = Math.atan2(c.y, c.z), mid = new THREE.Vector3(0, rMid * Math.sin(a), rMid * Math.cos(a));
    if (n.dot(c.sub(mid)) < 0) [B, C] = [C, B];
    pos.push(A.x, A.y, A.z, B.x, B.y, B.z, C.x, C.y, C.z);
  };
  for (let i = 0; i < segments; i++) {
    const a0 = i / segments * Math.PI * 2, a1 = (i + 1) / segments * Math.PI * 2;
    for (let j = 0; j < section.length - 1; j++) {
      const A = at(section[j], a0), B = at(section[j], a1), C = at(section[j + 1], a0), D = at(section[j + 1], a1);
      tri(A, C, B); tri(B, C, D);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();          // (not indexed: every face its own normal, like the model's)
  return g;
}
export function tyreModel(fit) {
  const mesh = new THREE.Mesh(tyreGeometry(fit), new THREE.MeshStandardMaterial({ name: 'tyre', color: '#1b1b1c', roughness: 0.62, metalness: 0.1 }));
  mesh.name = `tyre ${fit.label}`;
  return mesh;
}

// The cosmetics a build's parts set (window tint, underglow, fog lights, tyre smoke): { tint, underglow,
// fog, smoke } — what the stats calculator's spec.cosmetic says, from the build alone
export function cosmeticOf(build, view) {
  const out = {};
  for (const id of Object.values(build.sockets ?? {})) {
    const part = id && view.parts[view.owned[id]?.partId];
    for (const e of part?.effects ?? []) if (e.op === 'set' && e.target.startsWith('cosmetic.')) out[e.target.slice(9)] = e.value;
  }
  return out;
}

// ---------- placeholders ----------

// A box the size of a part's bounds (socket frame): grey for a part with no model yet, pink for one
// whose model didn't load
export function placeholderBox(bounds, failed) {
  const min = new THREE.Vector3(...(bounds?.min ?? [-0.15, -0.15, -0.15])), max = new THREE.Vector3(...(bounds?.max ?? [0.15, 0.15, 0.15]));
  const size = max.clone().sub(min), g = new THREE.BoxGeometry(Math.max(size.x, 0.01), Math.max(size.y, 0.01), Math.max(size.z, 0.01));
  g.translate(...min.clone().add(max).multiplyScalar(0.5).toArray());
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: failed ? '#ff3d8b' : '#8d969f', roughness: 0.8, transparent: true, opacity: failed ? 0.7 : 0.85 }));
  mesh.name = failed ? 'placeholder (model failed to load)' : 'placeholder';
  mesh.castShadow = true;
  const g2 = new THREE.Group();
  g2.add(mesh, new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: failed ? '#9b0f45' : '#3b4148' })));
  g2.userData.owned = true;
  return g2;
}
// A wing on two uprights, from a part's placeholder sizes (in the car frame: +z forward, +x left)
export function placeholderWing(P) {
  const mat = new THREE.MeshLambertMaterial({ color: P.colour ?? '#222' }), g = new THREE.Group();
  const wing = new THREE.Mesh(new THREE.BoxGeometry(P.width, P.thickness ?? 0.03, P.chord), mat);
  wing.position.y = P.height;
  g.add(wing);
  for (const side of [-1, 1]) {
    const upright = new THREE.Mesh(new THREE.BoxGeometry(0.03, P.height, 0.05), mat);
    upright.position.set(side * P.width * 0.3, P.height / 2, -0.02);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.16, P.chord * 1.25), mat);
    plate.position.set(side * P.width / 2, P.height + 0.02, 0);
    g.add(upright, plate);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.name = 'placeholder wing';
  g.userData.wing = wing;         // (the game turns it to the wing's angle)
  g.userData.owned = true;
  g.userData.carFrame = true;
  return g;
}
function disposeOwned(o) {
  if (!o?.userData.owned) return;
  o.traverse(x => { x.geometry?.dispose(); for (const m of [x.material].flat()) m?.dispose(); });
}

// ---------- socket gizmos ----------

function socketGizmo(name, virtual) {
  const g = new THREE.Group();
  g.name = `gizmo ${name}`;
  const axes = new THREE.AxesHelper(0.12);
  axes.material.depthTest = false; axes.renderOrder = 998;
  g.add(axes);
  if (globalThis.document) {
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
    canvas.width = 512; canvas.height = 64;
    ctx.font = '600 30px system-ui, sans-serif';
    const text = name.replace(/^socket_/, '') + (virtual ? ' (no node)' : ''), w = Math.min(512, ctx.measureText(text).width + 20);
    ctx.fillStyle = 'rgba(12,16,22,0.78)'; ctx.fillRect(0, 10, w, 44);
    ctx.fillStyle = virtual ? '#ffd27a' : '#ffffff'; ctx.fillText(text, 10, 43);
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    label.center.set(0, 0.5); label.scale.set(0.4, 0.05, 1); label.position.set(0.03, 0.06, 0); label.renderOrder = 999;
    g.add(label);
  }
  return g;
}

// ---------- crash damage looks ----------

// green (100) → yellow (70) → orange (40) → red (0)
export function conditionColour(c) {
  const stops = [[0, '#d7263d'], [40, '#f28c28'], [70, '#f2d024'], [100, '#3ec46d']];
  let i = 1;
  while (i < stops.length - 1 && c > stops[i][0]) i++;
  const [c0, a] = stops[i - 1], [c1, b] = stops[i];
  return new THREE.Color(a).lerp(new THREE.Color(b), Math.min(1, Math.max(0, (c - c0) / (c1 - c0))));
}
// A broken window or light: its material, cracked — a web of cracks drawn on it (a shader on the mesh's
// own coordinates, its two widest sides: the model has no texture coordinates), the glass crazed white,
// a light dark and dead
export function crackedMaterial(src, kind, geometry) {
  const m = src.clone();
  if (kind === 'glass') { m.color = new THREE.Color('#9fb0bb'); m.opacity = Math.max(m.opacity ?? 1, 0.72); m.transparent = true; m.roughness = 0.85; m.metalness = 0; }
  else { m.color = new THREE.Color('#2b2a28'); m.emissive = new THREE.Color(0); m.emissiveIntensity = 0; m.roughness = 0.9; }
  geometry.computeBoundingBox?.();
  const bb = geometry.boundingBox, size = bb ? bb.getSize(new THREE.Vector3()) : new THREE.Vector3(1, 1, 1), axes = [0, 1, 2].sort((a, b) => size.getComponent(b) - size.getComponent(a));
  const centre = bb ? bb.getCenter(new THREE.Vector3()) : new THREE.Vector3();
  centre.setComponent(axes[0], centre.getComponent(axes[0]) + size.getComponent(axes[0]) * 0.18);   // (off-centre, where it was hit)
  const U = new THREE.Vector3().setComponent(axes[0], 1), V = new THREE.Vector3().setComponent(axes[1], 1);
  const crack = new THREE.Color(kind === 'glass' ? '#f2f6f8' : '#8d8a85'), scale = Math.max(size.getComponent(axes[0]), 0.05);
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { uCentre: { value: centre }, uU: { value: U }, uV: { value: V }, uCrack: { value: crack }, uScale: { value: scale } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vObj; uniform vec3 uCentre, uU, uV, uCrack; uniform float uScale;
float h1(float n) { return fract(sin(n * 91.345) * 47453.5453); }
float cracks(vec2 q) {
  float r = length(q) + 1e-4, a = atan(q.y, q.x), k = 0.0;
  float spokes = 11.0, s = a / 6.2831853 * spokes, i = floor(s), f = fract(s) - 0.5 + (h1(i) - 0.5) * 0.5;
  k = max(k, 1.0 - smoothstep(0.0, 0.012 / r + 0.01, abs(f) * r * 6.2831853 / spokes));
  float ring = log(r * 18.0) / log(1.7), j = floor(ring), g = abs(fract(ring) - 0.5 + (h1(j * 7.0 + i) - 0.5) * 0.3);
  k = max(k, (1.0 - smoothstep(0.0, 0.05, g)) * step(0.35, h1(j * 13.0 + i)));
  return k * smoothstep(1.2, 0.2, r);
}`).replace('#include <color_fragment>', `#include <color_fragment>
vec3 dq = vObj - uCentre; float kc = cracks(vec2(dot(dq, uU), dot(dq, uV)) / uScale);
diffuseColor.rgb = mix(diffuseColor.rgb, uCrack, kc); diffuseColor.a = mix(diffuseColor.a, 0.95, kc);`);
  };
  m.customProgramCacheKey = () => `cracked-${kind}`;
  m.userData = { ...m.userData, cracked: true };
  m.name = `${src.name} (broken)`;
  return m;
}

// ---------- a car ----------

// environment: what this car's reflective finishes reflect (the garage's workshop), if not the game's
export async function createCarVisual({ car, finishes, models, paint, environment: env }) {
  const body = await models.acquire(car.model.file);
  return new CarVisual({ car, finishes, models, body, paint: paint ?? car.paint, environment: env });
}
export const applyBuild = (visual, build, view) => visual.applyBuild(build, view);

export class CarVisual {
  constructor({ car, finishes, models, body, paint, environment: env }) {
    this.car = car; this.finishes = finishes ?? {}; this.models = models; this.environment = env ?? null;
    this.group = new THREE.Group();
    this.group.name = car.id;
    const holder = new THREE.Group();
    holder.rotation.y = car.model.forwardAxis === '+x' ? -Math.PI / 2 : 0;     // the model, turned to face +z
    this.root = body;
    holder.add(body);
    this.group.add(holder);
    this.sources = new WeakMap();     // mesh → the model's own material (what its finish is made from)
    this.rests = new WeakMap();       // attached part → its place on the socket (for animating it out and back)
    this.own = new Map();             // this car's own materials: key → material
    this.attached = new Map();        // socket → { key, kind, part, look, object, url, status, … }
    this.pending = new Map();         // socket → the key being loaded for it
    this.tokens = new Map();          // socket → the latest change asked for (older loads are dropped)
    this.hiddenNodes = new Set();
    this.damage = null;               // { shell: { dents, broken }, parts: { socket: dents } } (setDamage)
    this.offCar = new Map();          // socket → a loose or torn-off part: { object, state, restCar, origin }
    this.overlay = null;              // the condition colours showing (showCondition)
    this.gizmos = null;
    // the body's nodes, sockets it doesn't have (at their car.json position), and a pivot per wheel
    this.nodes = new Map();
    body.traverse(o => { if (o.name && !this.nodes.has(o.name)) this.nodes.set(o.name, o); if (o.isMesh) o.castShadow = true; });
    for (const s of car.sockets) {
      const name = s.node ?? s.name;
      if (this.nodes.has(name)) continue;
      const n = new THREE.Object3D();
      n.name = name; n.userData.virtual = true;
      n.position.fromArray(carFrameToModel(s.position, car.model.forwardAxis));
      body.add(n);
      this.nodes.set(name, n);
    }
    this.wheels = {};
    this.hubs = {};                   // FL… → a group under the wheel's pivot that doesn't spin (setWheelSpin)
    this.pivots = new Map();          // wheel socket node name → its pivot
    for (const k of ['FL', 'FR', 'RL', 'RR']) {
      const socket = this.nodes.get(car.model.sockets[k]);
      if (!socket) continue;
      const pivot = new THREE.Group();
      pivot.name = wheelPivotName(k);
      socket.add(pivot);
      this.wheels[k] = pivot;
      this.pivots.set(socket.name, pivot);
      // (a hub on it that steers and rides with the wheel but doesn't turn: brake discs and calipers;
      // on the right it's mirrored front to back, so a caliper behind the axle stays behind it)
      const hub = new THREE.Group();
      hub.name = `hub_${k}`;
      if (k.endsWith('R')) hub.scale.z = -1;
      pivot.add(hub);
      this.hubs[k] = hub;
    }
    // (every body node where the model puts it: dents go by these, not by a door the garage has swung open)
    this.nodeRest = new Map();
    body.traverse(o => { o.updateMatrix(); this.nodeRest.set(o, o.matrix.clone()); });
    this.paintSource = null;
    body.traverse(o => { if (o.isMesh && o.material?.name === car.model.paintMaterial) this.paintSource ??= o.material; });
    this.setPaint(paint ?? { colour: '#' + (this.paintSource?.color.getHexString() ?? 'aaaaaa'), finish: 'gloss' });
  }

  // ---- the build ----

  // Make the car look like `build` (view: { parts, owned }, the garage's view): only the sockets whose
  // part (or its look) changed are touched. Resolves once every new part is on.
  async applyBuild(build, view) {
    const jobs = [];
    for (const s of this.car.sockets) {
      const want = this.#wanted(s, build, view), key = want?.key ?? null, have = this.attached.get(s.name);
      if (key === (have?.key ?? null)) {
        // (already like this: drop any load still coming for something else)
        if (this.pending.has(s.name)) { this.pending.delete(s.name); this.tokens.set(s.name, (this.tokens.get(s.name) ?? 0) + 1); }
        continue;
      }
      if (this.pending.get(s.name) === key) continue;       // on its way
      jobs.push(this.#swap(s, want));
    }
    this.#cosmetics(cosmeticOf(build, view));
    await Promise.all(jobs);
  }

  // ---- cosmetics: window tint on the glass, underglow and fog lights (lights of their colour) ----
  #cosmetics(c) {
    if (JSON.stringify(c) === JSON.stringify(this.cosmetic ?? {})) return;
    this.cosmetic = c;
    // the glass: darker and more opaque the heavier the tint
    const T = { light: [0.55, 0.72], dark: [0.3, 0.86], limo: [0.1, 0.95] }[c.tint];
    this.root.traverse(o => {
      if (!o.isMesh || !/glass/i.test(o.name) || o.userData.broken) return;
      const m = o.material;
      if (!m || Array.isArray(m)) return;
      m.userData.base ??= { color: m.color.clone(), opacity: m.opacity };
      const B = m.userData.base;
      m.color.copy(B.color).multiplyScalar(T ? T[0] : 1);
      m.opacity = T ? Math.max(B.opacity, T[1]) : B.opacity;
      m.userData.opacity = m.opacity;              // (what it is from outside: the cockpit view clears it)
    });
    // lights: under the car, and at the front
    if (this.cosmeticLights) { this.cosmeticLights.removeFromParent(); this.cosmeticLights = null; }
    if (!c.underglow && !c.fog) return;
    const g = new THREE.Group(), at = name => this.car.sockets.find(s => s.name === name)?.position, half = this.car.dimensions.bodyCollider.halfExtents[2];
    const light = (colour, pos, intensity, distance) => { const l = new THREE.PointLight(colour, intensity, distance, 2); l.position.fromArray(carFrameToModel(pos, this.car.model.forwardAxis)); g.add(l); };
    if (c.underglow) for (const z of [-half * 0.55, half * 0.55]) light(c.underglow, [0, 0.06, z], 6, 3.5);
    const f = at('socket_fog_lights');
    if (c.fog && f) for (const x of [-0.55, 0.55]) light(c.fog, [x, f[1], f[2] + 0.3], 2.5, 9);
    g.name = 'cosmetic lights';
    this.root.add(g);
    this.cosmeticLights = g;
  }

  // What a socket should show: { key (same key: nothing to change), kind: model | tyre | placeholder | none, … }
  #wanted(s, build, view) {
    const id = build.sockets?.[s.name], instance = id ? view.owned[id] : null, part = instance ? view.parts[instance.partId] : null;
    if (!part) return null;
    const { model, bounds, placeholder, look } = resolveLook(part, view.parts, instance, this.car.id), lookKey = JSON.stringify(look);
    if (part.tyreSize) {
      // a tyre is made to fit the rim on its wheel
      const rimId = s.node && build.sockets?.[s.node], rim = rimId ? view.parts[view.owned[rimId]?.partId] : null;
      if (!rim?.rim) return { key: `none:${part.id}:no rim`, kind: 'none', part, why: 'no rim to go on' };
      const fit = tyreFit(rim.rim, part.tyreSize);
      return { key: `${tyreKey(fit)}|${lookKey}`, kind: 'tyre', fit, look, part, bounds };
    }
    if (model && look?.drawAt === 'wheels') {
      // at every wheel's hub, as big as fits inside the rim on it (a big brake kit behind a 15" wheel)
      const rims = Object.fromEntries(Object.entries(this.hubs).map(([k]) => {
        const rimId = build.sockets?.[this.car.model.sockets[k]], rim = rimId ? view.parts[view.owned[rimId]?.partId] : null;
        return [k, rim?.rim?.diameter ?? null];
      }));
      return { key: `${model}|${lookKey}|${JSON.stringify(rims)}`, kind: 'wheels', url: model, bounds, look, part, rims };
    }
    if (model) return { key: `${model}|${lookKey}`, kind: 'model', url: model, bounds, look, part };
    if (placeholder || bounds) return { key: `placeholder:${part.id}|${lookKey}`, kind: 'placeholder', bounds, placeholder, look, part };
    return { key: `none:${part.id}`, kind: 'none', part };
  }

  async #swap(s, want) {
    const token = (this.tokens.get(s.name) ?? 0) + 1;
    this.tokens.set(s.name, token);
    if (!want || want.kind === 'none') {
      this.pending.delete(s.name);
      this.#detach(s.name);
      if (want) this.attached.set(s.name, { ...want, object: null, status: want.why ? `not drawn: ${want.why}` : 'no model' });
      this.#applyHides();
      return;
    }
    this.pending.set(s.name, want.key);
    let object, url = null, status;
    try {
      if (want.kind === 'model') { url = want.url; object = await this.models.acquire(url); status = 'loaded'; }
      else if (want.kind === 'wheels') { object = await this.#atWheels(want); url = null; status = `at ${object.userData.atWheels.length} wheels`; }
      else if (want.kind === 'tyre') { url = tyreKey(want.fit); object = await this.models.acquire(url, () => tyreModel(want.fit)); status = `made to fit (${want.fit.label})`; }
      else {
        object = want.placeholder?.width ? placeholderWing(want.placeholder) : placeholderBox(want.bounds, false); status = 'placeholder (no model yet)';
        // (a light's placeholder glows its colour: underglow, fog lights)
        const glow = (want.part.effects ?? []).find(e => e.op === 'set' && /^cosmetic\.(underglow|fog)$/.test(e.target))?.value;
        if (glow) object.traverse(o => { if (o.isMesh) { o.material.color.set(glow); o.material.emissive = new THREE.Color(glow); o.material.emissiveIntensity = 1.5; } });
      }
    } catch (err) {
      console.error(`${this.car.name}: couldn't load the model of ${want.part.name} for ${s.name} (${want.url}): ${err?.message ?? err}. Drawing a placeholder box instead.`);
      object = placeholderBox(want.bounds, true); url = null; status = 'placeholder (model failed to load)';
    }
    if (this.tokens.get(s.name) !== token || this.disposed) { if (url) this.models.release(url); disposeOwned(object); return; }   // (a newer change won)
    this.pending.delete(s.name);
    // (a light's lenses glow its colour: underglow, fog lights)
    object.userData.glow = (want.part.effects ?? []).find(e => e.op === 'set' && /^cosmetic\.(underglow|fog)$/.test(e.target))?.value ?? null;
    if (want.kind === 'model') object.userData.wing ??= object.getObjectByName('wing_element') ?? undefined;     // (a wing's element: turned to its angle)
    if (!object.userData.owned) this.#style(object, want.look);
    for (const w of object.userData.atWheels ?? []) this.#style(w.object, want.look);
    this.#detach(s.name);                      // the old part goes only now the new one is here
    const at = this.#nodeFor(s);
    object.userData.partRoot = s.name;
    at.add(object);
    if (object.userData.carFrame) this.#alignToCar(object, at);
    this.rests.set(object, { position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone() });
    this.attached.set(s.name, { ...want, object, url, status });
    this.#applyHides();
    this.#sweep();
    if (this.damage) this.#dentPart(s.name);
    if (this.overlay) this.showCondition(this.overlay);
  }

  // A part drawn at every wheel's hub (look.drawAt: wheels): a copy in each hub, scaled down to fit
  // inside the rim there; the object returned (for the socket) is an empty group that keeps track of them
  async #atWheels(want) {
    const group = new THREE.Group(), b = want.bounds, reach = b ? Math.max(...[1, 2].flatMap(k => [Math.abs(b.min[k]), Math.abs(b.max[k])])) : 0;
    group.userData.atWheels = [];
    for (const [k, hub] of Object.entries(this.hubs)) {
      const object = await this.models.acquire(want.url), d = want.rims[k];
      // (inside the rim's drop well: its bead seat's radius less the barrel)
      const room = d ? d * 0.0254 / 2 - 0.034 : reach, s = reach ? Math.min(1, room / reach) : 1;
      object.scale.set(1, s, s);
      hub.add(object);
      group.userData.atWheels.push({ k, object, url: want.url });
    }
    return group;
  }
  // The wheels' spin, so the hubs on them don't turn (the game calls this with each wheel's pivot pose):
  // axle in the wheel socket's axes (modelRig), spin in radians
  setWheelSpin(k, axle, spin) {
    const hub = this.hubs[k];
    if (hub) hub.quaternion.setFromAxisAngle(new THREE.Vector3(axle[0], axle[1], axle[2]), -spin);
  }
  // A part's own lamps (light_… materials other than the car's head and tail lights) glowing: in its
  // light's colour (glow: underglow, fog lights) or their own
  #glowing(m, glow) {
    if (!/^light_/.test(m.name) || /^light_(head|tail)/.test(m.name)) return m;
    return this.#ownMaterial(`glow|${m.uuid}|${glow ?? ''}`, () => { const c = m.clone(); if (glow) c.color.set(glow); c.emissive = new THREE.Color(glow ?? '#fff6d8'); c.emissiveIntensity = glow ? 1.6 : 1.1; return c; });
  }

  #nodeFor(s) {
    const name = s.node ?? s.name;
    return this.pivots.get(name) ?? this.nodes.get(name);
  }
  // Where a socket's part hangs (its node, or a wheel's pivot), and the part there now
  attachPoint(socketName) { const s = this.car.sockets.find(x => x.name === socketName); return s ? this.#nodeFor(s) : null; }
  partObject(socketName) { return this.attached.get(socketName)?.object ?? null; }
  restOf(object) { return this.rests.get(object) ?? null; }
  // (something built in the car frame, under a node that may be turned)
  #alignToCar(object, node) {
    this.group.updateMatrixWorld(true);
    const inCar = this.group.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(node.getWorldQuaternion(new THREE.Quaternion()));
    object.quaternion.copy(inCar.invert());
  }
  #detach(socket) {
    const e = this.attached.get(socket);
    if (!e) return;
    this.attached.delete(socket);
    this.offCar.delete(socket);
    if (!e.object) return;
    for (const w of e.object.userData.atWheels ?? []) { w.object.removeFromParent(); this.models.release(w.url); disposeOwned(w.object); }
    e.object.traverse(o => { if (o.isMesh) clearDents(o); });
    e.object.removeFromParent();
    if (e.url) this.models.release(e.url);
    disposeOwned(e.object);
  }

  // ---- materials ----

  #style(object, look) {
    const glow = object.userData.glow;
    object.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true;
      if (!this.sources.has(o)) this.sources.set(o, o.material);
      o.material = this.#materialFor(this.sources.get(o), look);
      if (glow !== undefined) o.material = Array.isArray(o.material) ? o.material.map(m => this.#glowing(m, glow)) : this.#glowing(o.material, glow);
    });
    if (look?.scale) {
      const k = look.scale, s = typeof k === 'number' ? [k, k, k] : k;
      object.scale.set(s[0], s[1], s[2]);
    }
  }

  #materialFor(src, look) {
    if (Array.isArray(src)) return src.map(m => this.#materialFor(m, look));
    const per = look?.materials?.[src.name] ?? {}, keeps = KEEPS_LOOK.test(src.name) && !look?.materials?.[src.name];
    const finish = keeps ? null : per.finish ?? look?.finish, colour = keeps ? null : per.colour ?? look?.colour;
    const isPaint = src.name === this.car.model.paintMaterial;
    if (isPaint && !finish && !colour) return this.paintMaterial;
    if (isPaint) {
      // its own paint: its finish and / or colour (a finish with a colour of its own, matte black,
      // brings it), the car's for whichever it doesn't have
      const f = finish ?? this.paint.finish, c = colour ?? (finish && this.finishes[finish]?.colour) ?? this.paint.colour;
      return this.#ownMaterial(`paint|${f}|${c}`, () => finishMaterial(src, this.finishes[f], c, this.environment ?? environment));
    }
    if (finish || colour) return this.#ownMaterial(`${src.uuid}|${finish ?? ''}|${colour ?? ''}`, () => finishMaterial(src, this.finishes[finish], colour, this.environment ?? environment));
    if (PER_CAR.test(src.name)) return this.#ownMaterial(`own|${src.uuid}`, () => src.clone());
    return src;
  }
  #ownMaterial(key, make) {
    let m = this.own.get(key);
    if (!m) this.own.set(key, m = make());
    return m;
  }
  // (this car's own materials nothing uses any more)
  #sweep() {
    const used = new Set(), note = o => { if (o.isMesh) for (const m of [o.material].flat()) used.add(m); };
    this.root.traverse(note);
    for (const x of this.offCar.values()) x.object.traverse(note);
    for (const [key, m] of this.own) if (!used.has(m)) { m.dispose(); this.own.delete(key); }
  }

  // The car's paint: a colour and a paint finish (data/finishes.json). Everything painted follows it.
  setPaint({ colour, finish }) {
    const overlay = this.overlay;
    if (overlay) this.showCondition(null);
    const f = this.finishes[finish] ?? this.finishes.gloss;
    const old = this.paintMaterial;
    this.paint = { colour, finish: this.finishes[finish] ? finish : 'gloss' };
    this.paintMaterial = finishMaterial(this.paintSource ?? new THREE.MeshStandardMaterial({ name: this.car.model.paintMaterial }), f, colour, this.environment ?? environment);
    this.paintMaterial.name = this.car.model.paintMaterial ?? 'paint';
    // restyle the body and every part (parts with their own paint follow the car's colour or finish)
    this.#style(this.root, null);
    for (const e of this.attached.values()) if (e.object && !e.object.userData.owned) this.#style(e.object, e.look);
    old?.dispose();
    this.#applyBroken();
    for (const x of this.offCar.values()) { x.object.traverse(o => { delete o.userData.oneSided; }); this.#bothSides(x.object, true); }
    this.#sweep();
    if (overlay) this.showCondition(overlay);
  }

  // ---- crash damage ----

  // The damage to show: { shell: { dents, broken } | null, parts: { socket: dents } } (session.damage),
  // rules: data/damage.json (how deep and wide a dent of a strength is)
  setDamage(damage, rules) {
    this.damage = damage ?? { shell: null, parts: {} };
    this.damageRules = rules ?? this.damageRules;
    this.#dentBody();
    for (const socket of this.attached.keys()) this.#dentPart(socket);
    this.#applyBroken();
  }
  // Work out the finer meshes now (once per model), a mesh at a time between frames, so the first dent
  // costs nothing: the game calls this once the car's drawn
  warmDents() {
    const meshes = [];
    this.root.traverse(o => { if (o.isMesh && !o.userData.dent) meshes.push(o.geometry); });
    const next = () => { const g = meshes.shift(); if (!g || this.disposed) return; finerOf(g); setTimeout(next, 30); };
    setTimeout(next, 200);
  }
  // (the body's own meshes: not a part's, a wheel's or a gizmo)
  #bodyMeshes() {
    const out = [];
    const walk = o => { if (o.userData.partRoot || o.name?.startsWith('gizmo ')) return; if (o.isMesh) out.push(o); for (const c of o.children) walk(c); };
    walk(this.root);
    return out;
  }
  #dentBody() { this.#dentMeshes(this.#bodyMeshes(), this.damage?.shell?.dents ?? [], [0, 0, 0]); }
  #dentPart(socket) {
    const e = this.attached.get(socket), s = this.car.sockets.find(x => x.name === socket);
    if (!e?.object || !s || e.kind === 'tyre' || this.pivots.has(s.node ?? s.name)) return;
    const meshes = [];
    e.object.traverse(o => { if (o.isMesh) meshes.push(o); });
    this.#dentMeshes(meshes, this.damage?.parts?.[socket] ?? [], s.position);
  }
  // dents (car frame, from origin) into each mesh's own space; a mesh no dent reaches keeps (or goes
  // back to) the shared model
  #dentMeshes(meshes, dents, origin) {
    const R = this.damageRules;
    if (!R) return;
    for (const mesh of meshes) {
      const rel = this.#restToCar(mesh), inv = rel.clone().invert(), k = 1 / (rel.getMaxScaleOnAxis() || 1);
      const g = mesh.userData.dent?.shared ?? mesh.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const box = g.boundingBox;
      const local = [];
      for (const x of dents) {
        // (car frame, as the rest matrices are)
        const { depth, radius } = dentSize(R, x.s), p = new THREE.Vector3(origin[0] + x.p[0], origin[1] + x.p[1], origin[2] + x.p[2]).applyMatrix4(inv);
        if (box.distanceToPoint(p) > radius * k) continue;
        local.push({ p, d: new THREE.Vector3(...x.d).transformDirection(inv), depth: depth * (x.w ?? 1) * k, radius: radius * k });
      }
      if (local.length) setDents(mesh, local, R.dent.maxDepth * k); else clearDents(mesh);
    }
  }
  // a mesh's place in the car at rest: the model's own node positions, each part on its socket as fitted
  #restToCar(mesh) {
    const m = new THREE.Matrix4(), trs = new THREE.Matrix4();
    for (let o = mesh; o && o !== this.group; o = o.parent) {
      const rest = this.rests.get(o), node = this.nodeRest.get(o), off = o.userData.restCar;
      if (off) { m.premultiply(off); break; }        // (loose or torn off: where it sat on the car)
      if (node) m.premultiply(node);
      else if (rest) m.premultiply(trs.compose(rest.position, rest.quaternion, rest.scale));
      else { o.updateMatrix(); m.premultiply(o.matrix); }
    }
    return m;
  }
  // ---- loose and torn-off parts ----

  // A part comes loose: it leaves its socket's node and hangs in the car frame, where setPartPose puts it
  loosenPart(socket) {
    const e = this.attached.get(socket), s = this.car.sockets.find(x => x.name === socket);
    if (!e?.object || !s) return false;
    let x = this.offCar.get(socket);
    if (!x) {
      const restCar = this.#restToCar(e.object);
      x = { object: e.object, restCar, origin: new THREE.Matrix4().makeTranslation(...s.position).invert(), state: 'loose' };
      this.offCar.set(socket, x);
      e.object.userData.restCar = restCar;
      e.object.matrixAutoUpdate = false;
      this.#bothSides(e.object, true);
    }
    x.state = 'loose';
    this.group.add(e.object);
    e.object.matrix.copy(x.restCar);
    e.object.matrixWorldNeedsUpdate = true;
    return true;
  }
  // where a loose part is: its origin's place in the car frame (a Matrix4) as the physics has it
  setPartPose(socket, originInCar) {
    const x = this.offCar.get(socket);
    if (!x || x.state !== 'loose') return;
    x.object.matrix.multiplyMatrices(originInCar, x.origin).multiply(x.restCar);
    x.object.matrixWorldNeedsUpdate = true;
  }
  // A part torn off: taken off the car for the game to put in the world (returns its object; place it
  // with pieceMatrix)
  detachPart(socket) {
    if (!this.offCar.has(socket) && !this.loosenPart(socket)) return null;
    const x = this.offCar.get(socket);
    x.state = 'detached';
    x.object.removeFromParent();
    return x.object;
  }
  // (a torn-off part's matrix in the world, from where the physics has its origin: a Matrix4)
  pieceMatrix(socket, originInWorld, out = new THREE.Matrix4()) {
    const x = this.offCar.get(socket);
    return x ? out.multiplyMatrices(originInWorld, x.origin).multiply(x.restCar) : null;
  }
  // Back on its socket, as it was (its dents too)
  reattachPart(socket) {
    const x = this.offCar.get(socket), e = this.attached.get(socket), s = this.car.sockets.find(y => y.name === socket);
    if (!x) return false;
    this.offCar.delete(socket);
    const o = x.object;
    delete o.userData.restCar;
    o.matrixAutoUpdate = true;
    this.#bothSides(o, false);
    if (e?.object === o && s) {
      const rest = this.rests.get(o);
      this.#nodeFor(s).add(o);
      if (rest) { o.position.copy(rest.position); o.quaternion.copy(rest.quaternion); o.scale.copy(rest.scale); }
    } else o.removeFromParent();
    this.#sweep();
    return true;
  }
  partState(socket) { return this.offCar.get(socket)?.state ?? 'attached'; }
  // A wheel torn off (FL…): its pivot (rim, tyre, spacer) off the car, for the game to put in the world:
  // returns it with where it sat in the car frame (a Matrix4; place it with its matrix), or null
  detachWheel(k) {
    const p = this.wheels[k];
    if (!p || p.userData.offCar) return null;
    this.group.updateMatrixWorld(true);
    const inCar = this.group.matrixWorld.clone().invert().multiply(p.matrixWorld);
    p.userData.offCar = { parent: p.parent };
    p.removeFromParent();
    p.matrixAutoUpdate = false;
    p.matrix.copy(inCar);
    return { object: p, inCar };
  }
  reattachWheel(k) {
    const p = this.wheels[k], o = p?.userData.offCar;
    if (!o) return false;
    p.removeFromParent();
    o.parent.add(p);
    p.matrixAutoUpdate = true;
    delete p.userData.offCar;
    return true;
  }
  wheelOff(k) { return !!this.wheels[k]?.userData.offCar; }
  // (a panel off the car shows both sides: the inside of a raised bonnet)
  #bothSides(object, on) {
    object.traverse(o => {
      if (!o.isMesh) return;
      if (on && !o.userData.oneSided) { o.userData.oneSided = o.material; o.material = [o.material].flat().map(m => this.#ownMaterial(`both|${m.uuid}`, () => { const c = m.clone(); c.side = THREE.DoubleSide; return c; })); if (o.material.length === 1) o.material = o.material[0]; }
      else if (!on && o.userData.oneSided) { o.material = o.userData.oneSided; delete o.userData.oneSided; }
    });
  }

  // glass cracked, lights smashed: this car's own materials for those meshes
  #applyBroken() {
    const broken = new Set(this.damage?.shell?.broken ?? []);
    for (const b of this.car.model.breakables ?? []) {
      const node = this.nodes.get(b.node);
      if (!node) continue;
      node.traverse(o => {
        if (!o.isMesh) return;
        if (!broken.has(b.node)) { if (o.material.userData?.cracked && o.userData.whole) o.material = o.userData.whole; delete o.userData.whole; return; }
        if (o.material.userData?.cracked) return;
        o.userData.whole = o.material;
        o.material = this.#ownMaterial(`broken|${b.kind}|${o.material.uuid}`, () => crackedMaterial(o.material, b.kind, o.geometry));
      });
    }
  }

  // Every part coloured by its condition (green new … red wrecked), or its own look again (null):
  // { shell: condition, sockets: { socket: condition } }
  showCondition(conditions) {
    const restore = o => { if (o.userData.look) { o.material = o.userData.look; delete o.userData.look; } };
    const paint = (o, c) => { if (!o.isMesh) return; o.userData.look ??= o.material; o.material = this.#ownMaterial(`condition|${Math.round(c / 5) * 5}`, () => new THREE.MeshStandardMaterial({ color: conditionColour(c), roughness: 0.7 })); };
    this.overlay = conditions ?? null;
    for (const m of this.#bodyMeshes()) conditions ? paint(m, conditions.shell ?? 100) : restore(m);
    for (const [socket, e] of this.attached) e.object?.traverse(o => { if (!o.isMesh) return; conditions ? paint(o, conditions.sockets?.[socket] ?? 100) : restore(o); });
    if (!conditions) this.#sweep();
  }

  // ---- hiding ----

  #applyHides() {
    const sockets = new Set(), nodes = new Set();
    for (const e of this.attached.values()) for (const h of e.part?.hides ?? []) (this.car.sockets.some(s => s.name === h) ? sockets : nodes).add(h);
    for (const [name, e] of this.attached) if (e.object) e.object.visible = !sockets.has(name);
    const node = n => this.nodes.get(n) ?? this.root.getObjectByName(n);
    for (const n of this.hiddenNodes) if (!nodes.has(n) && node(n)) node(n).visible = true;
    for (const n of nodes) if (node(n)) node(n).visible = false;
    this.hiddenNodes = nodes;
  }

  // ---- looking at it ----

  // Every socket as a small labelled axis gizmo (on: true / false; nothing: toggle). Returns whether they show.
  showSockets(on = !this.gizmos) {
    for (const g of this.gizmos ?? []) { g.removeFromParent(); g.traverse(x => { x.geometry?.dispose(); x.material?.map?.dispose(); x.material?.dispose(); }); }
    this.gizmos = null;
    if (!on) return false;
    this.gizmos = [];
    for (const [name, node] of this.nodes) if (name.startsWith('socket_')) { const g = socketGizmo(name, node.userData.virtual); node.add(g); this.gizmos.push(g); }
    return true;
  }

  // What's on every socket: [{ socket, part, drawn, model, look }]
  list() {
    return this.car.sockets.map(s => {
      const e = this.attached.get(s.name), pending = this.pending.get(s.name);
      return {
        socket: s.name, part: e?.part.id ?? '—', drawn: e ? (e.object && !e.object.visible ? 'hidden by a part' : e.status) : 'empty',
        model: e?.kind === 'tyre' ? tyreKey(e.fit) : e?.url ?? '', look: e?.look ? JSON.stringify(e.look) : '', ...(pending ? { loading: pending } : {}),
      };
    });
  }

  // The drawn tyre's radius on a wheel (FL…), m: what the physics will roll on from Step 4
  wheelRadius(k = 'FL') {
    const socket = this.car.model.sockets[k];
    for (const s of this.car.sockets) if (s.node === socket && this.attached.get(s.name)?.kind === 'tyre') return this.attached.get(s.name).fit.radius;
    return null;
  }

  // The car as one .glb (for the Cesium page, which can't hang parts on nodes)
  async exportGlb() {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const gizmos = !!this.gizmos;
    if (gizmos) this.showSockets(false);
    try { return await new GLTFExporter().parseAsync(this.root, { binary: true, onlyVisible: true }); }
    finally { if (gizmos) this.showSockets(true); }
  }

  dispose() {
    this.disposed = true;
    for (const s of [...this.attached.keys()]) this.#detach(s);
    this.showSockets(false);
    this.models.release(this.car.model.file);
    for (const m of this.own.values()) m.dispose();
    this.own.clear();
    this.paintMaterial?.dispose();
    this.group.removeFromParent();
  }
}
