// A car's model made from the starter coupe's (data/cars/starter_car/starter_car_v2.glb), reshaped to the car's
// design (data/cars/<id>/design.json; tools/content/placeholderCar.mjs says what's in one): every panel, the glass, the
// lights and the dashboard bent by the same smooth map, so they fit together exactly as they do on the coupe, with the
// wheel arches kept round round the car's own wheels. The map is piecewise straight in each direction:
//  - along the car (z): through the nose, the arches, the windscreen's foot and the tail low down, and through the
//    windscreen's foot, the roof's front and back and the rear window's foot (the deck's front) higher up, blended
//    between the two just above the doors' tops (so the cabin can sit anywhere over the wheelbase, the doors upright);
//    both are the same over the last few centimetres of the nose and the tail
//  - up (y): through the ground, the sills (clearance), the beltline and the roof, and near the wheels the axles and
//    the arches' tops too
//  - across (x): through the wheels' track and the body's width
// The wheels are the coupe's, made the car's size (rim and tyre); the seats, steering wheel and exhaust tip are the
// coupe's as they are, and the engine its size, under the sockets carSockets puts them at; each panel's socket goes as
// far across the reshaped panel as the coupe's is across its own (still at its middle, hinge or inner edge), and
// tools/placeholder-car.mjs writes those positions into car.json.
// The engine's room is cleared of what of the coupe's is round it. A roadster's roof comes off the body into its soft top (socket_roof); a car with no socket_boot keeps its boot lid
// in the body, or as its engine cover (a mid engine's).
//
//   const doc = await coupeCar(design)       (placeholderCar does: tools/placeholder-car.mjs, npm run content -- new-car)

import fs from 'node:fs';
import path from 'node:path';
import { Logger } from '@gltf-transform/core';
import { cloneDocument } from '@gltf-transform/functions';
import { modelIO } from './io.mjs';
import { ROOT } from './rules.mjs';
import { carSockets } from './placeholderCar.mjs';

const SOURCE = 'data/cars/starter_car/starter_car_v2.glb';
// the coupe's own measurements (from its model and car.json), the map's starting points
const C = {
  nose: 2.06, tail: -2.06, frontAxle: 1.2, rearAxle: -1.2, radius: 0.29, rim: 0.1905, tyreWidth: 0.18, track: 1.48, width: 1.7,
  clearance: 0.13, archTop: 0.65, cabinBack: -0.95, beltline: 0.85, height: 1.31, screenFoot: 0.69, roofFront: 0.05, roofRear: -0.86, deckFront: -1.39,
};
const ARCH = 1.3;                         // (an arch reaches this many wheel radii either side of its axle)
const BLEND = [0.841, 0.8445];        // (the coupe's heights the low map gives way to the high one over: just above the doors' tops and the beltline)

// parts that keep the coupe's shape, in their socket's frame
const RIGID = new Set(['seat_driver', 'seat_passenger', 'steering_wheel']);
// sockets that go where the map takes the coupe's (the rest where carSockets puts them, from the design)
const MAPPED = new Set(['socket_bumper_front', 'socket_bumper_rear', 'socket_bonnet', 'socket_boot', 'socket_spoiler', 'socket_door_left', 'socket_door_right', 'socket_fender_FL', 'socket_fender_FR',
  'socket_skirt_left', 'socket_skirt_right', 'socket_mirror_left', 'socket_mirror_right', 'socket_exhaust_tip']);
// light fittings (and the seats, the steering wheel and what goes round them) that go where the map takes the coupe's (car.json's) socket, so they fit the reshaped cabin and bay as they
// fit the coupe's: the heavy parts (engine, gearbox, axles, wheels) stay where the design has them, so each car's
// weight and balance — what it was tuned with — don't change, and so do what bolts to the engine
const FITTINGS = new Set(['socket_ecu', 'socket_exhaust', 'socket_shifter', 'socket_gauges', 'socket_window_tint', 'socket_fog_lights', 'socket_underglow', 'socket_aero_kit',
  'socket_seat_driver', 'socket_seat_passenger', 'socket_steering_wheel', 'socket_harness', 'socket_cage']);
// (the pipework beside the coupe's engine, in its body: left out, so a bigger engine than the coupe's has room — x, y, z
// ranges, the coupe's)
const BAY_DETAIL = [[-0.37, -0.15], [0.14, 0.56], [0.84, 1.32]];
const BAY = new Set(['socket_radiator', 'socket_intercooler', 'socket_strut_brace']);   // (a front engine's bay only)
const WHEELS = new Set(['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR']);

// (a piecewise-straight map through points [from, to], carried on straight past the ends)
const piecewise = pts => v => {
  let i = 0;
  while (i < pts.length - 2 && v > pts[i + 1][0]) i++;
  const [a0, b0] = pts[i], [a1, b1] = pts[i + 1];
  return b0 + (v - a0) * (b1 - b0) / (a1 - a0);
};
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// The map from the coupe's body to the car's
export function bodyMap(D) {
  const L = D.length / 2, r = D.wheel.radius, a = ARCH * r, ca = ARCH * C.radius, fa = D.frontAxle, ra = D.rearAxle;
  const low = piecewise([[C.tail, -L], [C.rearAxle - ca, ra - a], [C.rearAxle + ca, ra + a], [C.screenFoot, D.bonnet.rear], [C.frontAxle - ca, fa - a], [C.frontAxle + ca, fa + a], [C.nose, L]]);
  // (the high map is the low one over the tail's and the nose's last few centimetres: the faces there stay upright)
  const tailEnd = C.tail + 0.12, noseEnd = C.nose - 0.15;
  const high = piecewise([[C.tail, -L], [tailEnd, Math.min(low(tailEnd), D.deck.front - 0.05)], [C.deckFront, D.deck.front], [C.roofRear, D.roof.rear], [C.roofFront, D.roof.front], [C.screenFoot, D.bonnet.rear], [C.frontAxle, fa], [noseEnd, Math.max(low(noseEnd), fa + 0.05)], [C.nose, L]]);
  const archTop = Math.min(r * C.archTop / C.radius, D.beltline - 0.05);
  // (the first 20 cm over the beltline — the dashboard, the gauges, the steering wheel's rim — kept their height: the
  // roof takes the difference)
  const dash = D.height - D.beltline > 0.3 ? [[C.beltline + 0.2, D.beltline + 0.2]] : [];
  const upArch = piecewise([[0, 0], [C.clearance, D.clearance], [C.radius, r], [C.archTop, archTop], [C.beltline, D.beltline], ...dash, [C.height, D.height]]);
  // (away from the wheels — the nose, the tail, the doors — the sides go evenly from the sills to the beltline: a low car
  // with big wheels keeps its lights and grille their height)
  const upEven = piecewise([[0, 0], [C.clearance, D.clearance], [C.radius, r], [C.beltline, D.beltline], ...dash, [C.height, D.height]]);

  const nearArch = z => 1 - smooth(ca, ca + 0.2, Math.min(Math.abs(z - C.frontAxle), Math.abs(z - C.rearAxle)));
  // (the wheel wells round the car's tyres as the coupe's are round its own: the tyre's inner and outer faces where the
  // coupe's are, the wells' inner walls as far inside them)
  const t = D.track / 2, w = D.wheel.width / 2, ct = C.track / 2, cw = C.tyreWidth / 2;
  const across = piecewise([[0, 0], [ct - cw - 0.06, t - w - 0.06], [ct - cw, t - w], [ct + cw, t + w], [C.width / 2, D.width / 2], [C.width / 2 + 1, D.width / 2 + 1]]);
  return ([x, y, z]) => {
    // (the cabin's inside — floor, dashboard, seats, steering wheel — all on the high map, with the windscreen and roof
    // it sits under: it keeps its shape, the doors theirs)
    const cabin = (1 - smooth(0.56, 0.64, Math.abs(x))) * smooth(C.cabinBack - 0.15, C.cabinBack, z) * (1 - smooth(C.screenFoot - 0.09, C.screenFoot, z));
    const s = Math.max(smooth(BLEND[0], BLEND[1], y), cabin);
    const a = nearArch(z) * (1 - cabin);
    return [Math.sign(x) * across(Math.abs(x)), upArch(y) * a + upEven(y) * (1 - a), low(z) * (1 - s) + high(z) * s];
  };
}

// The model
export async function coupeCar(D) {
  const io = await modelIO(), coupe = await io.read(path.join(ROOT, SOURCE));
  const doc = cloneDocument(coupe).setLogger(new Logger(Logger.Verbosity.WARN));
  const sockets = carSockets(D), use = D.sockets ? new Set(D.sockets) : null;
  const root = doc.getRoot(), scene = root.listScenes()[0], top = scene.listChildren()[0], named = n => root.listNodes().find(x => x.getName() === n);
  top.setName(D.id);
  const morph = bodyMap(D);
  // (where each node is on the coupe, before anything moves)
  const world = new Map(root.listNodes().map(n => [n, n.getWorldMatrix()]));

  // the sockets where the car's design has them (and only the ones it uses: a part mesh in one it doesn't use joins the body)
  const socketFrame = new Map(), mid = D.engine.at[2] < 0;
  const coupeAt = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/cars/starter_car/car.json'), 'utf8')).sockets.map(s => [s.name, s.position]));
  for (const [name, s] of Object.entries(sockets)) {
    if (use && !use.has(name)) continue;
    // (a panel's socket where the map takes the coupe's, so the panel hangs from it as the coupe's does)
    const from = name === 'socket_engine_cover' ? 'socket_boot' : name;
    if (MAPPED.has(from) && !D.extraSockets?.[name] && named(from)) s.position = mappedSocket(named(from), world, morph).map(v => +v.toFixed(3));
    // (a rally light pod sits on the reshaped bonnet's front, strapped over it)
    else if (name === 'socket_rally_lights' && named('socket_bonnet')) s.position = bonnetFront(named('socket_bonnet'), world, morph);
    // (a front lip hangs under the reshaped front bumper)
    else if (name === 'socket_front_lip' && named('socket_bumper_front')) s.position = [s.position[0], +morphedBounds(named('socket_bumper_front'), world, morph).min[1].toFixed(3), s.position[2]];
    else if ((FITTINGS.has(name) || (!mid && BAY.has(name))) && !D.extraSockets?.[name] && coupeAt[name]) s.position = morph(coupeAt[name]).map(v => +v.toFixed(3));
    let n = named(name);
    if (!n) top.addChild(n = doc.createNode(name));
    n.setTranslation(s.position).setRotation(s.rotation ?? [0, 0, 0, 1]);
    socketFrame.set(name, { p: s.position, q: s.rotation ?? [0, 0, 0, 1] });
  }
  const orphans = top.listChildren().filter(n => n.getName().startsWith('socket_') && !socketFrame.has(n.getName()));

  dropBayDetail(doc, named('body_shell'));
  // each mesh made the car's: the body's parts through the map, the rest as they are (in their socket's frame)
  const done = new Set(), body = named('body_shell');
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const name = node.getName(), parent = node.getParentNode(), socket = parent && parent !== top ? parent.getName() : null;
    let frame = socket && socketFrame.get(socket);
    // (a boot lid with no boot socket: the engine cover on a mid engine, else part of the body)
    if (name === 'panel_boot' && !frame) {
      if (socketFrame.has('socket_engine_cover')) { node.setName('panel_engine_cover'); named('socket_engine_cover').addChild(node); frame = socketFrame.get('socket_engine_cover'); }
      else { top.addChild(node); frame = null; }
    }
    if (done.has(mesh)) continue;
    done.add(mesh);
    const M = world.get(node);
    let f;
    if (WHEELS.has(name)) f = wheelMap(D);
    else if (RIGID.has(name)) f = v => v;
    // (the exhaust tip as it is, where the map takes the coupe's: its socket may be a little further in)
    else if (name === 'exhaust_tip') { const at = morph(apply(world.get(parent), [0, 0, 0])), d = at.map((x, i) => x - frame.p[i]); f = v => v.map((x, i) => x + d[i]); }
    else if (name === 'engine_block') { const [w, h, l] = D.engine.size; f = ([x, y, z]) => [x * w / 0.48, y * h / 0.48, z * l / 0.81]; }
    else f = v => toFrame(frame, morph(apply(M, v)));
    for (const prim of mesh.listPrimitives()) reshape(doc, prim, f);
    if (!WHEELS.has(name) && !RIGID.has(name) && name !== 'engine_block') node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  }
  clearWheels(doc, body, D);
  clearEngineRoom(doc, body, D, mid);
  for (const n of orphans) { for (const c of n.listChildren()) top.addChild(c); n.dispose(); }
  if (named('panel_boot') && named('panel_boot').getParentNode() === top) mergeInto(named('panel_boot'), body);

  // a roadster: the roof and the rear window come off the body into its soft top
  if (D.convertible) softTop(doc, D, body, named, socketFrame, morph);

  // the car's paint
  const paint = root.listMaterials().find(m => m.getName() === 'paint');
  if (paint && D.paint) paint.setBaseColorFactor(linear(D.paint));
  return doc;
}

// Where a panel's socket goes: as far across the reshaped panel, along each axis, as the coupe's is across the coupe's panel
// (so it's still at the panel's middle, or its hinge, or its inner edge, as the model rules want); a socket with no
// panel where the map takes it
function mappedSocket(socket, world, morph) {
  const at = apply(world.get(socket), [0, 0, 0]);
  if (!socket.listChildren().some(c => c.getMesh())) return morph(at);
  const was = morphedBounds(socket, world, v => v), now = morphedBounds(socket, world, morph), m = morph(at);
  return [0, 1, 2].map(k => was.max[k] - was.min[k] < 1e-3 ? m[k] : now.min[k] + (at[k] - was.min[k]) / (was.max[k] - was.min[k]) * (now.max[k] - now.min[k]));
}
// (the middle of the reshaped bonnet's top, 10 cm back from its front edge)
function bonnetFront(socket, world, morph) {
  const mesh = socket.listChildren().find(c => c.getMesh()), M = world.get(mesh), pts = [];
  for (const prim of mesh.getMesh().listPrimitives()) { const P = prim.getAttribute('POSITION').getArray(); for (let i = 0; i < P.length; i += 3) pts.push(morph(apply(M, [P[i], P[i + 1], P[i + 2]]))); }
  const front = Math.max(...pts.map(q => q[2])), y = Math.max(...pts.filter(q => q[2] > front - 0.2 && Math.abs(q[0]) < 0.3).map(q => q[1]));
  return [0, +(y + 0.02).toFixed(3), +(front - 0.1).toFixed(3)];
}
// (the bounds of the panel under a socket, in the car's frame, through f)
function morphedBounds(socket, world, f) {
  const mesh = socket.listChildren().find(c => c.getMesh()), M = world.get(mesh), min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const prim of mesh.getMesh().listPrimitives()) {
    const P = prim.getAttribute('POSITION').getArray();
    for (let i = 0; i < P.length; i += 3) { const w = f(apply(M, [P[i], P[i + 1], P[i + 2]])); for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], w[k]); max[k] = Math.max(max[k], w[k]); } }
  }
  return { min, max };
}

// The coupe's wheel at the car's size: the rim to its diameter, the tyre from the rim to the car's radius, its width
function wheelMap(D) {
  const rim = D.wheel.rimDiameter * 0.0254 / 2, r = D.wheel.radius, wide = D.wheel.width / C.tyreWidth;
  return ([x, y, z]) => {
    const p = Math.hypot(y, z);
    if (p < 1e-9) return [x * wide, y, z];
    const q = p <= C.rim + 1e-4 ? p * rim / C.rim : rim + (p - C.rim) * (r - rim) / (C.radius - C.rim);
    return [x * wide, y * q / p, z * q / p];
  };
}

// Every vertex through f, its normal turned with it (by the inverse transpose of f's slope there), into new accessors
function reshape(doc, prim, f) {
  const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), P = pos.getArray(), N = nor?.getArray();
  const outP = new Float32Array(P.length), outN = N ? new Float32Array(N.length) : null, h = 1e-3;
  for (let i = 0; i < P.length; i += 3) {
    const v = [P[i], P[i + 1], P[i + 2]], o = f(v);
    outP.set(o, i);
    if (!N) continue;
    const J = [0, 1, 2].map(k => { const a = [...v], b = [...v]; a[k] += h; b[k] -= h; const fa = f(a), fb = f(b); return fa.map((x, j) => (x - fb[j]) / (2 * h)); });   // (columns)
    const m = turnNormal(J, [N[i], N[i + 1], N[i + 2]]), l = Math.hypot(...m) || 1;
    outN.set(m.map(x => x / l), i);
  }
  const buffer = doc.getRoot().listBuffers()[0];
  prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(outP).setBuffer(buffer));
  if (N) prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(outN).setBuffer(buffer));
}
// (J's columns a, b, c are f's derivatives along x, y, z; J⁻ᵀ is (b × c | c × a | a × b) / det J, and the length doesn't matter)
function turnNormal([a, b, c], n) {
  const x = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], cols = [x(b, c), x(c, a), x(a, b)];
  return [0, 1, 2].map(j => cols[0][j] * n[0] + cols[1][j] * n[1] + cols[2][j] * n[2]);
}

// The body without the pipework beside the coupe's engine (every triangle wholly inside BAY_DETAIL)
function dropBayDetail(doc, body) {
  const buffer = doc.getRoot().listBuffers()[0], inBox = (P, i) => BAY_DETAIL.every(([lo, hi], k) => P[3 * i + k] >= lo && P[3 * i + k] <= hi);
  for (const prim of body.getMesh().listPrimitives()) {
    const P = prim.getAttribute('POSITION').getArray(), tris = triangles(prim), keep = tris.filter(t => !t.every(i => inBox(P, i)));
    if (keep.length < tris.length) prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(keep.flat())).setBuffer(buffer));
  }
}

// The reshaped wells' linings that cut across the car's wheels or the springs inboard of them (the middle of the
// triangle within 1.15 wheel radii of an axle, from 20 cm inboard of the tyre to its outer face)
function clearWheels(doc, body, D) {
  const buffer = doc.getRoot().listBuffers()[0], t = D.track / 2, w = D.wheel.width / 2, r = D.wheel.radius;
  const inWheel = ([x, y, z]) => Math.abs(x) > t - w - 0.2 && Math.abs(x) < t + w && Math.min(Math.hypot(y - r, z - D.frontAxle), Math.hypot(y - r, z - D.rearAxle)) < r * 1.15;
  for (const prim of body.getMesh().listPrimitives()) {
    const P = prim.getAttribute('POSITION').getArray(), tris = triangles(prim), keep = tris.filter(t => !inWheel([0, 1, 2].map(k => t.reduce((a, i) => a + P[3 * i + k], 0) / 3)));
    if (keep.length < tris.length) prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(keep.flat())).setBuffer(buffer));
  }
}

// The engine's room: what of the coupe's body is round the car's engine — its bay's rails and pipework, or behind a
// mid engine's seats the coupe's rear seats and boot floor — left out (every triangle of the body whose middle is
// within 15 cm of the engine — 20 across, 35 behind a mid one — above its base and under the bonnet or the deck),
// so the car's engine, and a bigger one swapped in, has room
function clearEngineRoom(doc, body, D, mid) {
  const [w, h, l] = D.engine.size, E = D.engine.at, buffer = doc.getRoot().listBuffers()[0], top = mid ? D.deck.height : D.bonnet.back;
  const room = [[-w / 2 - (mid ? 0.2 : 0.15), w / 2 + (mid ? 0.2 : 0.15)], [E[1] - h / 2 + 0.03, top - 0.06], [E[2] - l / 2 - (mid ? 0.35 : 0.15), E[2] + l / 2 + (mid ? 0.1 : 0.15)]];
  for (const prim of body.getMesh().listPrimitives()) {
    const P = prim.getAttribute('POSITION').getArray(), tris = triangles(prim);
    const keep = tris.filter(t => !room.every(([lo, hi], k) => { const c = t.reduce((a, i) => a + P[3 * i + k], 0) / 3; return c >= lo && c <= hi; }));
    if (keep.length < tris.length) prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(keep.flat())).setBuffer(buffer));
  }
}

// A boot lid that stays on the body: its primitives join body_shell's mesh
function mergeInto(node, body) {
  const bm = body.getMesh();
  for (const p of node.getMesh().listPrimitives()) bm.addPrimitive(p);
  node.dispose();
}

// The roof: the body's triangles above the beltline behind the windscreen's top, and the rear window, as the soft
// top (in matte black) under socket_roof
function softTop(doc, D, body, named, socketFrame, morph) {
  const frame = socketFrame.get('socket_roof'), node = doc.createNode('soft_top'), mesh = doc.createMesh('soft_top');
  const fabric = doc.createMaterial('matte_black').setBaseColorFactor([0.03, 0.03, 0.035, 1]).setRoughnessFactor(0.9).setMetallicFactor(0);
  const buffer = doc.getRoot().listBuffers()[0], roofFront = D.roof.front, cut = D.beltline + 0.04;
  for (const prim of body.getMesh().listPrimitives()) {
    const tris = triangles(prim), P = prim.getAttribute('POSITION').getArray(), keep = [], off = [];
    for (const t of tris) {
      const ys = t.map(i => P[3 * i + 1]), z = t.reduce((a, i) => a + P[3 * i + 2], 0) / 3;
      (Math.min(...ys) > cut && z < roofFront ? off : keep).push(t);
    }
    if (!off.length) continue;
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(keep.flat())).setBuffer(buffer));
    mesh.addPrimitive(copy(doc, prim, off, fabric, frame.p));
  }
  const rear = named('glass_rear');
  if (rear) { for (const p of rear.getMesh().listPrimitives()) mesh.addPrimitive(copy(doc, p, triangles(p), fabric, frame.p)); rear.dispose(); }
  node.setMesh(mesh);
  named('socket_roof').addChild(node);
}
const triangles = prim => {
  const idx = prim.getIndices()?.getArray(), n = idx ? idx.length : prim.getAttribute('POSITION').getCount(), out = [];
  for (let i = 0; i < n; i += 3) out.push(idx ? [idx[i], idx[i + 1], idx[i + 2]] : [i, i + 1, i + 2]);
  return out;
};
// (some triangles of a primitive as one of their own, moved by -at)
function copy(doc, prim, tris, material, at) {
  const buffer = doc.getRoot().listBuffers()[0], P = prim.getAttribute('POSITION').getArray(), N = prim.getAttribute('NORMAL')?.getArray();
  const pos = new Float32Array(tris.length * 9), nor = new Float32Array(tris.length * 9);
  tris.flat().forEach((i, k) => { for (let j = 0; j < 3; j++) { pos[3 * k + j] = P[3 * i + j] - at[j]; nor[3 * k + j] = N ? N[3 * i + j] : 0; } });
  const p = doc.createPrimitive().setMaterial(material).setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer));
  if (N) p.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nor).setBuffer(buffer));
  return p;
}

// (a point through a column-major 4×4 matrix; into a socket's frame: less its position, turned back by its rotation)
const apply = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
function toFrame(frame, v) {
  if (!frame) return v;
  const d = v.map((x, i) => x - frame.p[i]), [qx, qy, qz, qw] = frame.q;
  return rotate([-qx, -qy, -qz, qw], d);
}
function rotate([qx, qy, qz, qw], [x, y, z]) {
  const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
}
const linear = hex => [...[1, 3, 5].map(i => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }), 1];
