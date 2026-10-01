// A car as the generators see it: its data (car.json), where each socket is, and measurements read
// from its model (assets/cars/<id>/body.glb) and its stock parts' models, so parts that must fit a car
// (a roll cage, a strut brace, a front lip, a bull bar…) are made to its size. Everything in the car
// frame: metres, +x left, +y up, +z forward, the ground at y = 0.
//
//   const car = await loadCar('kaze_gt');
//   car.socket('socket_cage')  car.cabin  car.towers  car.bumperOutline()  car.roof  car.sills

import path from 'node:path';
import { readModel } from '../../content/io.mjs';
import { ROOT, readJson } from '../../content/rules.mjs';
import { forCar } from '../../content/balance.mjs';

const cache = new Map();

// Every node's triangles, in the model's frame ({ name: [[a, b, c], …] })
async function nodeTriangles(file) {
  const doc = await readModel(path.join(ROOT, file)), out = {};
  const apply = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const walk = node => {
    const mesh = node.getMesh(), m = node.getWorldMatrix(), list = (out[node.getName()] ??= []);
    for (const prim of mesh?.listPrimitives() ?? []) {
      const P = prim.getAttribute('POSITION'), I = prim.getIndices(), n = I ? I.getCount() : P.getCount(), el = [];
      for (let t = 0; t + 2 < n; t += 3) list.push([0, 1, 2].map(k => apply(m, P.getElement(I ? I.getScalar(t + k) : t + k, el))));
    }
    for (const c of node.listChildren()) walk(c);
  };
  for (const n of scene.listChildren()) walk(n);
  return out;
}
const boundsOf = tris => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const p of t) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
  return { min, max };
};

export async function loadCar(id) {
  if (cache.has(id)) return cache.get(id);
  const def = readJson(`data/cars/${id}/car.json`), parts = partIndex();
  if (def.model.forwardAxis && def.model.forwardAxis !== '+z') throw new Error(`${id}: the generators expect the car's model to face +z`);
  const sockets = new Map(def.sockets.map(s => [s.name, s]));
  const socket = name => { const s = sockets.get(name); if (!s) throw new Error(`${id} has no ${name}`); return s.position; };
  const has = name => sockets.has(name);
  const nodes = await nodeTriangles(def.model.file);
  const body = Object.entries(nodes).filter(([n]) => !/^socket_/.test(n)).flatMap(([, t]) => t);
  const shell = nodes.body_shell?.length ? nodes.body_shell : body;
  const W = { FL: socket('socket_wheel_FL'), FR: socket('socket_wheel_FR'), RL: socket('socket_wheel_RL'), RR: socket('socket_wheel_RR') };
  const wheelRadius = W.FL[1], frontAxle = W.FL[2], rearAxle = W.RL[2], track = W.FL[0] - W.FR[0];
  const bodyBox = boundsOf(body), col = def.dimensions.bodyCollider;

  // the stock part in a socket: its model's triangles, in the car frame
  const stockTris = async socketName => {
    const s = sockets.get(socketName), pid = s?.stock?.[0], p = pid && parts(pid);
    if (!p?.model) return null;
    const t = await nodeTriangles(p.model), at = s.position;
    return Object.values(t).flat().map(tri => tri.map(q => [q[0] + at[0], q[1] + at[1], q[2] + at[2]]));
  };

  // --- the cabin: floor, roof (inside), windscreen foot and top, the door opening, the inside width ---
  const seat = socket('socket_seat_driver'), floor = seat[1];
  const glassW = nodes.glass_windscreen?.length ? boundsOf(nodes.glass_windscreen) : null;
  const sideG = nodes.glass_side_left?.length ? boundsOf(nodes.glass_side_left) : null;
  // the roof over the seats: down from above the car onto it, and up from the belt line to its inside
  const top = bodyBox.max[1] + 1, beltY = sideG?.min[1] ?? door0(sockets)?.position[1] + 0.3;
  const down = ray([0, top, seat[2]], [0, -1, 0], shell), up = ray([0, beltY + 0.05, seat[2]], [0, 1, 0], shell);
  const convertible = def.tags?.includes('roof:convertible') || !Number.isFinite(up);
  const roofTop = convertible ? (glassW?.max[1] ?? beltY + 0.3) : top - down;
  const roofInside = convertible ? (glassW?.max[1] ?? roofTop) - 0.05 : beltY + 0.05 + up - 0.01;
  const door = sockets.get('socket_door_left'), doorPart = door && parts(door.stock?.[0]);
  const doorFront = door?.position[2] ?? frontAxle - 0.9, doorLen = doorPart?.bounds ? doorPart.bounds.max[2] - doorPart.bounds.min[2] : 1.1;
  const belt = sideG?.min[1] ?? door?.position[1] + 0.3;
  const halfIn = Math.min((door?.position[0] ?? col.halfExtents[0]) - 0.07, col.halfExtents[0] - 0.08);
  const cabin = {
    floor, seatZ: seat[2], seatX: seat[0], roof: roofInside, roofTop, convertible, belt,
    screenFoot: glassW ? glassW.max[2] : doorFront, screenTop: glassW ? glassW.min[2] : doorFront - 0.5,
    screenTopY: glassW ? glassW.max[1] : roofInside,
    doorFront, doorBack: doorFront - doorLen, halfWidth: halfIn,
    rearZ: sideG ? sideG.min[2] - 0.05 : seat[2] - 0.8,
  };

  // --- the strut towers: either side of the engine bay over the front (or a mid engine's rear) wheels ---
  const brace = sockets.get('socket_strut_brace')?.position;
  const towers = brace ? { y: brace[1], z: brace[2], x: Math.min(track / 2 - 0.2, col.halfExtents[0] - 0.22) } : null;

  // --- the roof's top surface (where a ray straight down lands on it, not much lower than over the seats) and the sills ---
  const onRoof = (x, z) => { const d = ray([x, top, z], [0, -1, 0], shell); return Number.isFinite(d) && top - d > roofTop - 0.06; };
  const walk = (step, from, along) => { let at = from; while (along(at + step)) at += step; return at; };
  const roof = convertible ? null : { y: roofTop, front: walk(0.02, seat[2], z => onRoof(0, z)), rear: walk(-0.02, seat[2], z => onRoof(0, z)), halfWidth: walk(0.02, 0, x => onRoof(x, seat[2])) };
  const sillZ = [frontAxle - wheelRadius - 0.08, rearAxle + wheelRadius + 0.08];
  const sills = { y: def.design?.clearance ?? bodyBox.min[1], x: bodyBox.max[0], front: sillZ[0], rear: sillZ[1] };

  const car = {
    // the distance along a ray (unit dir) to the first face it meets: of the body, or of the given triangles
    ray: (o, d, tris = body) => ray(o, d, tris),
    // the body and the stock parts in these sockets (the things in the way), in the car frame
    async obstacles(socketNames = []) { const out = [...body]; for (const n of socketNames) out.push(...(await stockTris(n) ?? [])); return out; },
    id, def, name: def.name, socket, has, sockets, nodes, body, bodyBox, collider: col,
    wheels: W, wheelRadius, frontAxle, rearAxle, track, cabin, towers, roof, sills, stockTris,
    // The front bumper's bottom outline: [[x, z], …] from left to right (its front edge, seen from
    // below), and how low it goes — from the stock bumper's model
    async bumperOutline({ band = 0.05, step = 0.05 } = {}) {
      const tris = await stockTris('socket_bumper_front');
      if (!tris) return null;
      const pts = tris.flat(), low = Math.min(...pts.map(p => p[1])), near = pts.filter(p => p[1] < low + band);
      const half = Math.max(...near.map(p => Math.abs(p[0]))), out = [];
      for (let x = half; x >= -half - 1e-9; x -= step) {
        // (the front-most point of the bumper's lower edge at this x, from the triangles' edges)
        let zMax = -Infinity;
        for (const t of tris) for (let k = 0; k < 3; k++) {
          const a = t[k], b = t[(k + 1) % 3];
          if (Math.min(a[1], b[1]) > low + band) continue;
          if ((a[0] - x) * (b[0] - x) > 0 && Math.abs(a[0] - x) > 1e-6 && Math.abs(b[0] - x) > 1e-6) continue;
          const z = Math.abs(b[0] - a[0]) < 1e-9 ? Math.max(a[2], b[2]) : a[2] + (b[2] - a[2]) * (x - a[0]) / (b[0] - a[0]);
          zMax = Math.max(zMax, z);
        }
        if (Number.isFinite(zMax)) out.push([x, zMax]);
      }
      return { outline: out, low, halfWidth: half };
    },
  };
  cache.set(id, car);
  return car;
}

// (the nearest face along a ray: Möller–Trumbore against each triangle; Infinity if none)
export function ray(o, d, tris) {
  let best = Infinity;
  for (const [a, b, c] of tris) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]], det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det, t0 = [o[0] - a[0], o[1] - a[1], o[2] - a[2]], u = (t0[0] * p[0] + t0[1] * p[1] + t0[2] * p[2]) * inv;
    if (u < 0 || u > 1) continue;
    const q = [t0[1] * e1[2] - t0[2] * e1[1], t0[2] * e1[0] - t0[0] * e1[2], t0[0] * e1[1] - t0[1] * e1[0]], v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
    if (t > 1e-6 && t < best) best = t;
  }
  return best;
}
const door0 = sockets => sockets.get('socket_door_left');

// Part definitions by id (data/parts)
let PARTS = null;
function partIndex() {
  if (!PARTS) { PARTS = new Map(); for (const f of readJson('data/parts/index.json').parts) { const p = readJson(`data/parts/${f}`); PARTS.set(p.id, p); } }
  return id => PARTS.get(id) ?? null;
}
// Every car's id (data/cars/index.json)
export const carIds = () => readJson('data/cars/index.json').cars.map(f => f.split('/')[0]);
// The cars a part goes on, as the garage decides (tools/content/balance.mjs forCar: a socket for its slot,
// and what it fits): a car's own part on its car, a turbo kit on every engine without a turbo
export function carsFor(part, db) {
  if (!db) throw new Error('carsFor(part, db)');
  return Object.keys(db.cars).filter(id => forCar(db, id, part));
}
