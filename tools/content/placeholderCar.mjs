// Placeholder cars: until a car's real model is made, a low-poly one in its proportions, built from its
// design (data/cars/<id>/design.json) — the body shell and cabin, glass and lights, a dashboard, every
// socket node the car uses, and its stock parts' meshes under their sockets (panels, wheels with their
// tyres, seats, steering wheel, engine, exhaust tip), laid out like a modelled car's source, so
// npm run import checks it and splits it into the body and the stock part models the same way.
//
//   const doc = await placeholderCar(design)          (tools/placeholder-car.mjs writes incoming/car_<id>.glb)
//   carSockets(design) → { name: { position, rotation? } }: where each socket goes (car.json matches)
//
// design (metres, car frame: +z forward, +x left, +y up, the ground at y = 0):
//   { id, style: coupe | roadster | suv | hatch | muscle | sedan | mid, length, width, height, clearance,
//     beltline, frontAxle, rearAxle, track, wheel: { radius, rimDiameter (inches), width },
//     bonnet: { rear (z: the windscreen's foot), front (y at the nose), back (y at the windscreen) },
//     roof: { front, rear (z), height }, deck: { front (z), height }, engine: { at, size },
//     paint (#rrggbb), convertible, engineCover (a mid engine's lid), frontDrive (its differential at the
//     front axle), extraSockets ({ name: position }: the car's own), sockets (the socket nodes to make:
//     car.json's; all of them if it's missing) }

import { Document } from '@gltf-transform/core';
import sharp from 'sharp';
import { PALETTE, box, lathe, extrude } from './shapes.mjs';

const NAMES = Object.keys(PALETTE), SIDE = 4;
const uvOf = colour => { const i = Math.max(0, NAMES.indexOf(colour)); return [((i % SIDE) + 0.5) / SIDE, (Math.floor(i / SIDE) + 0.5) / SIDE]; };
const sub = (a, b) => a.map((v, i) => v - b[i]), cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
const linear = hex => [...[1, 3, 5].map(i => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }), 1];
const round = v => +v.toFixed(3);
const HALF_TURN_Y = [0, 1, 0, 0];
const quatX = deg => { const a = deg * Math.PI / 360; return [Math.sin(a), 0, 0, Math.cos(a)]; };
// (a four-sided panel from its corners, both faces)
const quad = (a, b, c, d) => [[a, b, c], [a, c, d], [a, c, b], [a, d, c]];

// Where every socket goes, from the design (the same numbers go into car.json)
export function carSockets(D) {
  const W = D.width, L = D.length, half = W / 2, s = W / 1.74, fa = D.frontAxle, ra = D.rearAxle, r = D.wheel.radius, t = D.track / 2;
  const seatZ = D.seatZ ?? (D.roof.front + D.roof.rear) / 2 - 0.15, seatY = D.floor ?? D.clearance + 0.1;
  const E = D.engine.at, mid = E[2] < 0, belt = D.beltline;
  const out = {
    socket_wheel_FL: [t, r, fa], socket_wheel_FR: [-t, r, fa], socket_wheel_RL: [t, r, ra], socket_wheel_RR: [-t, r, ra],
    socket_bonnet: [0, D.bonnet.back, D.bonnet.rear],
    socket_boot: [0, D.deck.height, D.deck.front],
    socket_bumper_front: [0, D.clearance + 0.14, L / 2 - 0.05], socket_bumper_rear: [0, D.clearance + 0.14, -L / 2 + 0.05],
    socket_spoiler: [0, D.deck.height, -L / 2 + 0.12],
    // (doors hang from their front edge, halfway up; wings bolt on at their inner top edge)
    socket_door_left: [half - 0.01, (D.clearance + 0.12 + belt) / 2, D.doorFront ?? D.bonnet.rear - 0.05], socket_door_right: [-half + 0.01, (D.clearance + 0.12 + belt) / 2, D.doorFront ?? D.bonnet.rear - 0.05],
    socket_fender_FL: [half - 0.1, belt, fa + 0.1], socket_fender_FR: [-half + 0.1, belt, fa + 0.1],
    socket_skirt_left: [half - 0.03, D.clearance + 0.06, (fa + ra) / 2], socket_skirt_right: [-half + 0.03, D.clearance + 0.06, (fa + ra) / 2],
    socket_mirror_left: [half - 0.06, belt + 0.1, D.bonnet.rear - 0.12], socket_mirror_right: [-half + 0.06, belt + 0.1, D.bonnet.rear - 0.12],
    socket_seat_driver: [0.38 * s, seatY, seatZ], socket_seat_passenger: [-0.38 * s, seatY, seatZ],
    socket_steering_wheel: [0.38 * s, belt + 0.06, seatZ + 0.55],
    socket_engine: [E[0], E[1] - D.engine.size[1] / 2, E[2]], socket_pistons: [E[0], E[1] + 0.15, E[2]],        // (the engine sits on its mounts: its origin at the middle of its base)
    socket_intake: [E[0] + 0.24 * s, E[1] + 0.26, E[2]], socket_turbo: [E[0] - 0.26 * s, E[1] + 0.2, E[2]],
    socket_header: [E[0] + 0.2 * s, E[1] + 0.05, E[2] - (mid ? -0.1 : 0.05)],
    socket_intercooler: mid ? [0, D.clearance + 0.25, ra - 0.45] : [0, D.clearance + 0.25, L / 2 - 0.25],
    socket_exhaust_tip: [-0.45 * s, D.clearance + 0.05, -L / 2 + 0.05], socket_exhaust: [0.15 * s, D.clearance + 0.05, mid ? ra + 0.3 : (fa + ra) / 2 - 0.3],
    socket_ecu: [0.3 * s, belt - 0.1, D.bonnet.rear - 0.06],
    socket_gearbox: mid ? [0, E[1] + 0.05, E[2] - 0.55] : [0, D.clearance + 0.2, E[2] - 0.8], socket_clutch: mid ? [0, E[1] + 0.1, E[2] - 0.35] : [0, D.clearance + 0.25, E[2] - 0.6],
    socket_flywheel: mid ? [0, E[1] + 0.1, E[2] - 0.28] : [0, D.clearance + 0.25, E[2] - 0.53],
    socket_differential: [0, r, D.frontDrive ? fa - 0.05 : ra], socket_diff_front: [0, r, fa - 0.05], socket_centre_diff: [0, D.clearance + 0.15, (fa + ra) / 2 + 0.3], socket_transfer_case: [0, D.clearance + 0.2, (fa + ra) / 2 + 0.2],
    socket_suspension: [0, r + 0.1, (fa + ra) / 2], socket_arb_front: [0, D.clearance + 0.05, fa], socket_arb_rear: [0, D.clearance + 0.05, ra],
    socket_brakes: [0, r, (fa + ra) / 2], socket_brake_pads: [0, r, (fa + ra) / 2],
    socket_weight_rear_seats: [0, seatY + 0.05, seatZ - 0.55], socket_weight_sound_deadening: [0, seatY + 0.1, seatZ + 0.05],
    socket_roof: [0, D.roof.height, (D.roof.front + D.roof.rear) / 2],
    socket_engine_cover: [0, D.deck.height, D.engineCover ?? D.roof.rear - 0.1],
    socket_radiator: mid ? [0, D.clearance + 0.3, L / 2 - 0.35] : [0, D.clearance + 0.35, L / 2 - 0.3],
    socket_cage: [0, seatY + 0.5, seatZ - 0.1], socket_harness: [0.38 * s, seatY + 0.45, seatZ - 0.2], socket_gauges: [0.38 * s, belt + 0.12, seatZ + 0.75], socket_shifter: [0, seatY + 0.3, seatZ + 0.35],
    socket_strut_brace: [0, belt - 0.02, mid ? ra : fa], socket_window_tint: [0, D.roof.height - 0.25, (D.roof.front + D.roof.rear) / 2], socket_tyre_smoke: [0, 0.05, ra],
    socket_underglow: [0, D.clearance, (fa + ra) / 2], socket_fog_lights: [0, D.clearance + 0.12, L / 2 - 0.03],
    socket_engine_swap: [E[0], E[1] - 0.12, E[2]], socket_supercharger: [E[0], E[1] + D.engine.size[1] / 2 + 0.12, E[2] + (mid ? -0.1 : 0.1)],
    ...D.extraSockets,
  };
  const rot = { socket_wheel_FR: HALF_TURN_Y, socket_wheel_RR: HALF_TURN_Y, socket_steering_wheel: quatX(D.columnDeg ?? 30) };
  return Object.fromEntries(Object.entries(out).map(([k, p]) => [k, { position: p.map(round), ...(rot[k] && { rotation: rot[k] }) }]));
}

// The model
export async function placeholderCar(D) {
  const S = carSockets(D), m = new Mesher();
  const L = D.length, W = D.width, half = W / 2 - 0.02, c = D.clearance, belt = D.beltline, fa = D.frontAxle, ra = D.rearAxle, r = D.wheel.radius;
  const front = L / 2, rear = -L / 2, R = D.roof, B = D.bonnet, K = D.deck, P = n => S[n].position;
  // (a front door, no longer than 1.2 m: the body behind it to the rear arches)
  const doorFront = P('socket_door_left')[2], doorBack = D.doorBack ?? Math.max(R.rear - 0.05, doorFront - 1.2);
  // --- the body shell: floor, sills, the sides behind the doors, the scuttle, the rear panel, and the cabin
  m.add('body_shell', 'paint', box([-half + 0.05, c, ra + r + 0.1], [half - 0.05, c + 0.06, fa - r - 0.1]));                       // floor
  m.add('body_shell', 'paint', box([-half, c + 0.02, doorBack], [half, belt, ra + r + 0.05]));                                      // behind the doors (to the rear arches)
  m.add('body_shell', 'paint', box([-half, c + r * 0.9, ra - r - 0.05], [half, belt - 0.02, K.front + 0.02]));                      // rear quarters over the rear wheels
  m.add('body_shell', 'paint', box([-half + 0.02, c + 0.05, rear + 0.18], [half - 0.02, K.height - 0.02, ra - r - 0.05]));         // tail
  m.add('body_shell', 'paint', box([-half + 0.1, belt - 0.12, B.rear - 0.05], [half - 0.1, B.back - 0.01, B.rear + 0.08]));         // scuttle
  m.add('body_shell', 'paint', box([-half + 0.12, c + 0.1, fa + r + 0.05], [half - 0.12, B.front - 0.06, front - 0.22]));            // nose
  if (!D.convertible) m.add('body_shell', 'paint', box([-half + 0.08, R.height - 0.04, R.front + 0.1], [half - 0.08, R.height, R.rear - 0.05]));   // roof
  // pillars: A (windscreen sides), C (behind the side windows)
  for (const x of [1, -1]) {
    const xo = x * (half - 0.06), xi = x * (half - 0.12);
    m.add('body_shell', 'paint', quad([xo, belt, B.rear], [xo, R.height, R.front + 0.1], [xi, R.height, R.front + 0.1], [xi, belt, B.rear]));
    if (!D.convertible) m.add('body_shell', 'paint', quad([xo, belt, R.rear - 0.25], [xo, R.height, R.rear - 0.05], [xi, R.height, R.rear - 0.05], [xi, belt, R.rear - 0.25]));
  }
  m.add('body_shell', 'dark', box([-half + 0.1, c + 0.06, doorBack + 0.05], [half - 0.1, c + 0.3, B.rear - 0.1]));                    // interior tub
  // --- glass and lights (breakables)
  m.add('glass_windscreen', 'glass', quad([-half + 0.1, belt + 0.02, B.rear + 0.02], [half - 0.1, belt + 0.02, B.rear + 0.02], [half - 0.12, R.height - 0.03, R.front + 0.12], [-half + 0.12, R.height - 0.03, R.front + 0.12]));
  if (!D.convertible) m.add('glass_rear', 'glass', quad([-half + 0.12, R.height - 0.03, R.rear - 0.06], [half - 0.12, R.height - 0.03, R.rear - 0.06], [half - 0.1, belt + 0.02, R.rear - 0.35 - (D.fastback ?? 0)], [-half + 0.1, belt + 0.02, R.rear - 0.35 - (D.fastback ?? 0)]));
  for (const [x, n] of [[1, 'left'], [-1, 'right']]) {
    const xs = x * (half - 0.03);
    m.add(`glass_side_${n}`, 'glass', quad([xs, belt + 0.02, doorFront - 0.05], [xs, belt + 0.02, doorBack], [xs, (D.convertible ? belt + 0.3 : R.height - 0.05), doorBack + 0.1], [xs, (D.convertible ? belt + 0.3 : R.height - 0.05), R.front + 0.2]));
    m.add(`light_head_${n}`, 'light_head', box([x * (half - 0.32) - 0.12, c + 0.28, front - 0.12], [x * (half - 0.32) + 0.12, c + 0.36, front - 0.04]));
    m.add(`light_tail_${n}`, 'light_tail', box([x * (half - 0.24) - 0.14, K.height - 0.18, rear + 0.02], [x * (half - 0.24) + 0.14, K.height - 0.08, rear + 0.1]));
  }
  m.add('dashboard', 'dark', box([-half + 0.12, belt - 0.2, B.rear - 0.35], [half - 0.12, belt + 0.02, B.rear - 0.05]));
  // --- the stock parts, under their sockets (each mesh in its socket's frame)
  const under = (socket, name, material, tris) => m.add(name, material, tris.map(t => t.map(p => sub(p, P(socket)))), socket);
  under('socket_bonnet', 'panel_bonnet', 'paint', extrude([[B.back, B.rear], [B.back - 0.03, B.rear], [B.front - 0.03, front - 0.2], [B.front, front - 0.2]], -half + 0.14, half - 0.14, 'x'));
  under('socket_bumper_front', 'panel_bumper_front', 'paint', box([-half + 0.02, c + 0.04, front - 0.24], [half - 0.02, c + 0.3, front]));
  under('socket_bumper_rear', 'panel_bumper_rear', 'paint', box([-half + 0.02, c + 0.04, rear], [half - 0.02, c + 0.3, rear + 0.2]));
  const bootTo = rear + 0.18, bootLid = K.front > bootTo + 0.1;
  if (bootLid) under('socket_boot', 'panel_boot', 'paint', box([-half + 0.1, K.height - 0.04, bootTo], [half - 0.1, K.height, K.front]));
  if (D.engineCover != null) under('socket_engine_cover', 'panel_engine_cover', 'paint', box([-half + 0.14, K.height - 0.04, K.front + 0.05], [half - 0.14, K.height, D.engineCover]));
  for (const [x, n, fender] of [[1, 'left', 'FL'], [-1, 'right', 'FR']]) {
    const xs = x * half;
    under(`socket_door_${n}`, `panel_door_${n}`, 'paint', box([xs - x * 0.06, c + 0.12, doorBack + 0.02], [xs, belt, doorFront]).map(t => t));
    // (the front wing: behind the wheel, over its arch, and ahead of it to the bumper)
    under(`socket_fender_${fender}`, `panel_fender_${fender}`, 'paint', [
      ...box([xs - x * 0.1, c + 0.12, fa - r - 0.12], [xs, belt, fa - r - 0.02]),
      ...box([xs - x * 0.1, r * 1.35, fa - r - 0.02], [xs, belt, fa + r + 0.02]),
      ...box([xs - x * 0.1, c + 0.12, fa + r + 0.02], [xs, belt, front - 0.24]),
    ].map(t => t.map(p => [Math.min(Math.max(p[0], -half), half), p[1], p[2]])));
    under(`socket_skirt_${n}`, `panel_skirt_${n}`, 'dark', box([xs - x * 0.05, c, fa - r - 0.08], [xs + x * 0.01, c + 0.12, ra + r + 0.08]));
    under(`socket_mirror_${n}`, `mirror_${n}`, 'paint', box([xs - x * 0.02, belt + 0.04, B.rear - 0.18], [xs + x * 0.14, belt + 0.14, B.rear - 0.08]));
  }
  // wheels: the rim (silver) and the tyre round it (rubber: the split cuts it off by its colour)
  const Wd = D.wheel.width, rim = D.wheel.rimDiameter * 0.0254 / 2;
  const wheelTris = [
    ...lathe([[0, -Wd * 0.35], [rim * 0.3, -Wd * 0.38], [rim, -Wd * 0.42], [rim, Wd * 0.42], [rim * 0.95, Wd * 0.3], [0, Wd * 0.25]], 24, 'x').map(t => ({ t, colour: 'silver' })),
    ...lathe([[rim, -Wd / 2], [r, -Wd / 2 + 0.02], [r, Wd / 2 - 0.02], [rim, Wd / 2], [rim, -Wd / 2]], 24, 'x').map(t => ({ t, colour: 'rubber' })),
  ];
  for (const k of ['FL', 'FR', 'RL', 'RR']) m.addColoured(`wheel_${k}`, wheelTris, `socket_wheel_${k}`);
  // seats, the steering wheel, the engine, the exhaust tip
  for (const [socket, name] of [['socket_seat_driver', 'seat_driver'], ['socket_seat_passenger', 'seat_passenger']]) {
    m.add(name, 'dark', [...box([-0.24, 0, -0.25], [0.24, 0.1, 0.28]), ...box([-0.24, 0.1, -0.3], [0.24, 0.62, -0.18])], socket);
  }
  m.add('steering_wheel', 'black', lathe([[0.17, -0.015], [0.19, -0.015], [0.19, 0.015], [0.17, 0.015], [0.17, -0.015]], 20, 'z'), 'socket_steering_wheel');
  const [ew, eh, el] = D.engine.size;
  m.add('engine_block', 'grey', [...box([-ew / 2, 0, -el / 2], [ew / 2, eh, el / 2]), ...box([-ew / 2 + 0.05, eh, -el / 2 + 0.05], [ew / 2 - 0.05, eh + 0.06, el / 2 - 0.05])], 'socket_engine');
  m.add('exhaust_tip', 'silver', lathe([[0.035, 0], [0.045, 0], [0.045, 0.1], [0.035, 0.1], [0.035, 0]], 12, 'z').map(t => t.map(p => [p[0], p[1], p[2] - 0.1])), 'socket_exhaust_tip');
  if (D.convertible) m.add('soft_top', 'black', [...box([-half + 0.1, R.height - 0.05, R.front + 0.1], [half - 0.1, R.height, R.rear - 0.1]), ...quadBox(half, belt, R)].map(t => t.map(p => sub(p, P('socket_roof')))), 'socket_roof');
  return m.document(D, S);
}
// (a soft top's rear: a sloping panel from the roof down behind the seats)
const quadBox = (half, belt, R) => [...quad([-half + 0.1, R.height, R.rear - 0.1], [half - 0.1, R.height, R.rear - 0.1], [half - 0.1, belt + 0.02, R.rear - 0.45], [-half + 0.1, belt + 0.02, R.rear - 0.45])];

// Triangles gathered by node and material (each with its palette colour), then made into a model
class Mesher {
  constructor() { this.nodes = new Map(); }
  add(node, material, tris, parent = null) { return this.addColoured(node, tris.map(t => ({ t, colour: ['paint', 'glass', 'light_head', 'light_tail'].includes(material) ? 'grey' : material })), parent, ['paint', 'glass', 'light_head', 'light_tail'].includes(material) ? material : 'car_atlas'); }
  addColoured(node, list, parent = null, material = 'car_atlas') {
    if (!this.nodes.has(node)) this.nodes.set(node, { parent, groups: new Map() });
    const g = this.nodes.get(node).groups;
    if (!g.has(material)) g.set(material, []);
    g.get(material).push(...list);
    return this;
  }
  async document(D, sockets) {
    const doc = new Document(), scene = doc.createScene('Scene'), top = doc.createNode(D.id), buffer = doc.createBuffer();
    scene.addChild(top);
    const mats = new Map();
    const atlas = doc.createTexture('car_atlas').setMimeType('image/png').setImage(await palette());
    const material = name => {
      if (mats.has(name)) return mats.get(name);
      const m = doc.createMaterial(name);
      if (name === 'car_atlas') m.setBaseColorTexture(atlas).setRoughnessFactor(0.62).setMetallicFactor(0.1);
      else if (name === 'paint') m.setBaseColorFactor(linear(D.paint)).setRoughnessFactor(0.4).setMetallicFactor(0.1);
      else if (name === 'glass') m.setBaseColorFactor([0.016, 0.032, 0.042, 0.5]).setAlphaMode('BLEND').setRoughnessFactor(0.08).setMetallicFactor(0.2);
      else if (name === 'light_head') m.setBaseColorFactor([0.9, 0.88, 0.75, 1]).setEmissiveFactor([1, 0.9, 0.58]).setRoughnessFactor(0.2).setMetallicFactor(0);
      else if (name === 'light_tail') m.setBaseColorFactor([0.37, 0.017, 0.011, 1]).setEmissiveFactor([0.2, 0.005, 0.003]).setRoughnessFactor(0.3).setMetallicFactor(0);
      mats.set(name, m);
      return m;
    };
    // every socket node the car uses (design.sockets: car.json's; else all of them), in car.json's order
    const socketNodes = new Map(), use = D.sockets ? new Set(D.sockets) : null;
    for (const [name, s] of Object.entries(sockets)) {
      if (use && !use.has(name)) continue;
      const n = doc.createNode(name).setTranslation(s.position);
      if (s.rotation) n.setRotation(s.rotation);
      top.addChild(n);
      socketNodes.set(name, n);
    }
    for (const [name, { parent, groups }] of this.nodes) {
      const node = doc.createNode(name), mesh = doc.createMesh(name);
      for (const [mat, list] of groups) {
        const pos = [], nor = [], uv = [];
        for (const { t: [a, b, c], colour } of list) {
          const n = norm(cross(sub(b, a), sub(c, a))), [u, v] = uvOf(colour);
          for (const p of [a, b, c]) { pos.push(...p); nor.push(...n); uv.push(u, v); }
        }
        const prim = doc.createPrimitive().setMaterial(material(mat))
          .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
          .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buffer));
        if (mat === 'car_atlas') prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buffer));
        mesh.addPrimitive(prim);
      }
      node.setMesh(mesh);
      // (right-hand wheels hang from a socket turned round y: the same wheel mesh, facing out)
      (parent ? socketNodes.get(parent) : top).addChild(node);
    }
    return doc;
  }
}
async function palette() {
  const raw = Buffer.alloc(SIDE * SIDE * 4);
  NAMES.forEach((name, i) => { const h = PALETTE[name]; for (let k = 0; k < 3; k++) raw[i * 4 + k] = parseInt(h.slice(1 + 2 * k, 3 + 2 * k), 16); raw[i * 4 + 3] = 255; });
  return new Uint8Array(await sharp(raw, { raw: { width: SIDE, height: SIDE, channels: 4 } }).png().toBuffer());
}
