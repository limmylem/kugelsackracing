// Reads a car .glb's socket nodes: where they are in the car frame (+x left, +y up, +z forward) for
// the physics, and how the model's wheels and steering wheel have to turn for the renderers
// (modelRig). Plain parsing, no rendering library, so the same numbers can be produced in the page, a
// Web Worker or on a server.

import { add, dot, normalize, rotate, scale, sub } from './math.js';

export function glbJson(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a .glb file');
  const len = dv.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, 20, len)));
}

// Every node's transform to the scene root, following translation/rotation/scale (or matrix) down the
// tree: point(p) takes a point in the node's own space to the root, dir(v) a direction; parent is
// the parent node's index (-1 at the root)
function nodeTransforms(gltf) {
  const out = new Map();
  const visit = (i, parent, parentIndex) => {
    const n = gltf.nodes[i];
    let cols, t;
    if (n.matrix) {
      const m = n.matrix;
      cols = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]];
      t = [m[12], m[13], m[14]];
    } else {
      const r = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1], q = { x: r[0], y: r[1], z: r[2], w: r[3] };
      cols = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((e, k) => scale(rotate(q, e), s[k]));
      t = n.translation || [0, 0, 0];
    }
    const linear = v => add(add(scale(cols[0], v[0]), scale(cols[1], v[1])), scale(cols[2], v[2]));
    const me = { parent: parentIndex, point: p => parent.point(add(linear(p), t)), dir: v => parent.dir(linear(v)) };
    out.set(i, me);
    for (const c of n.children || []) visit(c, me, i);
  };
  const root = { point: p => p, dir: v => v };
  for (const r of (gltf.scenes?.[gltf.scene || 0]?.nodes) || []) visit(r, root, -1);
  return out;
}

// A point or direction at the scene root, in a node's own axes (rotation and uniform scale)
function intoNode(tf, v, isPoint) {
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(e => tf.dir(e));
  const d = isPoint ? sub(v, tf.point([0, 0, 0])) : v;
  return axes.map(a => dot(a, d) / (dot(a, a) || 1));
}

// Model axes → car frame. Models can face +x or +z; the car frame faces +z with +x to the left.
export function modelToCarFrame(p, forwardAxis) {
  if (forwardAxis === '+x') return [-p[2], p[1], p[0]];
  if (forwardAxis === '+z') return [p[0], p[1], p[2]];
  throw new Error(`unsupported model forward axis ${forwardAxis}`);
}
export function carFrameToModel(p, forwardAxis) {
  if (forwardAxis === '+x') return [p[2], p[1], -p[0]];
  if (forwardAxis === '+z') return [p[0], p[1], p[2]];
  throw new Error(`unsupported model forward axis ${forwardAxis}`);
}

const nodeIndex = (gltf, name, file) => {
  const i = gltf.nodes.findIndex(n => n.name === name);
  if (i < 0) throw new Error(`${file} has no node called ${name}`);
  return i;
};

// Where the model's sockets are (model.sockets: FL/FR/RL/RR wheel sockets, spoiler …), car frame
export function socketsFromGlb(arrayBuffer, modelSpec) {
  const gltf = glbJson(arrayBuffer), tf = nodeTransforms(gltf), out = {};
  for (const [key, nodeName] of Object.entries(modelSpec.sockets)) out[key] = modelToCarFrame(tf.get(nodeIndex(gltf, nodeName, modelSpec.file)).point([0, 0, 0]), modelSpec.forwardAxis);
  return out;
}

// How to turn the car's moving parts, for any renderer. A wheel is drawn on a pivot the renderer adds
// under its wheel socket (named wheels[k].node, e.g. wheel_FL: the rim and tyre hang from it); the
// directions are in the socket's own axes, which is what the pivot's local transform is set in:
//  wheels[FL…]: axle (the car's left), up (the car's up) and outboard (away from the car's middle),
//    socket [0, 0, 0] (the pivot's rest position). A wheel's local transform is then
//      rotation = turn(up, steer angle) · turn(axle, spin angle)
//      position = socket + up × (spec.wheels.mountHeight − suspension length) + outboard × offset
//    (offset: spec.wheels.offsets[wheel], a rim with less offset or spacers)
//    so it spins forwards and steers the right way whichever way its socket faces (a model can mirror
//    the right-hand sockets by turning them 180° round y) — all angles as the physics gives them;
//  steeringWheel: the node turns about its own z axis (the steering column) by sign × the physics'
//    steering wheel angle (sign makes a left turn anticlockwise to the driver, whichever way the
//    column axis points).
export const wheelPivotName = k => `wheel_${k}`;
export function modelRig(arrayBuffer, modelSpec) {
  const gltf = glbJson(arrayBuffer), tf = nodeTransforms(gltf), axis = modelSpec.forwardAxis;
  const wheels = {};
  for (const k of ['FL', 'FR', 'RL', 'RR']) {
    const s = tf.get(nodeIndex(gltf, modelSpec.sockets[k], modelSpec.file)), side = Math.sign(modelToCarFrame(s.point([0, 0, 0]), axis)[0]) || 1;
    wheels[k] = {
      node: wheelPivotName(k), socketNode: modelSpec.sockets[k],
      axle: normalize(intoNode(s, carFrameToModel([1, 0, 0], axis), false)),
      up: normalize(intoNode(s, carFrameToModel([0, 1, 0], axis), false)),
      outboard: normalize(intoNode(s, carFrameToModel([side, 0, 0], axis), false)),
      socket: [0, 0, 0],
    };
  }
  let steeringWheel = null;
  if (modelSpec.steeringWheel) {
    const i = nodeIndex(gltf, modelSpec.steeringWheel, modelSpec.file);
    const column = modelToCarFrame(tf.get(i).dir([0, 0, 1]), axis);
    // anticlockwise seen from the seat (looking forwards) is a positive turn about the backwards axis
    steeringWheel = { node: modelSpec.steeringWheel, sign: column[2] > 0 ? -1 : 1 };
  }
  return { wheels, steeringWheel };
}

// Names of the nodes drawn with a material whose name passes test (e.g. every piece of glass)
export function nodesWithMaterial(arrayBuffer, test) {
  const gltf = glbJson(arrayBuffer);
  return gltf.nodes.filter(n => n.mesh !== undefined && gltf.meshes[n.mesh].primitives.some(p => test(gltf.materials?.[p.material]?.name || ''))).map(n => n.name);
}

// A quaternion [x, y, z, w] turning `angle` about unit `axis`, and the product a·b (b applied first)
export const axisAngle = (axis, angle) => { const s = Math.sin(angle / 2); return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)]; };
export const quatMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

// One wheel pivot's local transform (see modelRig); base: a rotation to start from [x, y, z, w]
export function wheelTransform(rig, base, steer, spin, drop, offset = 0) {
  const position = add(rig.socket, scale(rig.up, drop));
  return {
    rotation: quatMul(quatMul(axisAngle(rig.up, steer), axisAngle(rig.axle, spin)), base),
    position: offset && rig.outboard ? add(position, scale(rig.outboard, offset)) : position,
  };
}

// Boxes round named nodes' meshes (car frame: { name: { min, max } }), from the positions' min / max
// in the file: where the glass and lights are (car.model.breakables), for crash damage
export function nodeBoxes(arrayBuffer, modelSpec, names) {
  const gltf = glbJson(arrayBuffer), tf = nodeTransforms(gltf), out = {};
  for (const name of names) {
    const i = gltf.nodes.findIndex(n => n.name === name), n = gltf.nodes[i];
    if (i < 0 || n.mesh === undefined) continue;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const p of gltf.meshes[n.mesh].primitives) {
      const a = gltf.accessors[p.attributes.POSITION];
      if (!a?.min || !a?.max) continue;
      for (let c = 0; c < 8; c++) {
        const corner = [c & 1 ? a.max[0] : a.min[0], c & 2 ? a.max[1] : a.min[1], c & 4 ? a.max[2] : a.min[2]];
        const q = modelToCarFrame(tf.get(i).point(corner), modelSpec.forwardAxis);
        for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], q[k]); max[k] = Math.max(max[k], q[k]); }
      }
    }
    if (min[0] <= max[0]) out[name] = { min, max };
  }
  return out;
}
