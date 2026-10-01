// The fit check, without a browser: a part fitted to a car through the garage (as the shop fits it,
// with what it needs), then every model of the build placed where the game draws it (the body, each
// part on its socket — a car's own version where it has one — and a brake kit at every wheel, inside its
// rim), and the part's triangles tested against everything else's: an edge of one passing through a
// face of the other is a clash. The same test as the part preview page's (dev/parts.js).
//
//   const r = await fitCheck(db, 'kaze_gt', 'roll_cage_welded') → { ok, error, clashes: { owner: triangles } }

import path from 'node:path';
import { Garage } from '../../../garage/data.js';
import { resolveLook } from '../../../garage/visual.js';
import { partShape } from '../../../garage/partShape.js';
import { fitWithNeeds } from '../../content/balance.mjs';
import { readModel } from '../../content/io.mjs';
import { ROOT } from '../../content/rules.mjs';

const TOL = 0.003;
// the parts that bolt onto the engine, and how far round their socket meeting it is how they're fitted
export const ENGINE_MOUNTED = new Set(['turbo', 'supercharger', 'intake', 'header']), ATTACH = 0.07;
// what a part goes through by design: an exhaust's tips out of the rear bumper's cut-out
export const THROUGH = { exhaust: ['bumper_rear'] };
const models = new Map(), bodies = new Map();

// A model's triangles in its own frame (cached)
async function trianglesOf(file) {
  if (models.has(file)) return models.get(file);
  const doc = await readModel(path.join(ROOT, file)), out = [];
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const walk = n => {
    const m = n.getWorldMatrix();
    for (const prim of n.getMesh()?.listPrimitives() ?? []) {
      const P = prim.getAttribute('POSITION'), I = prim.getIndices(), count = I ? I.getCount() : P.getCount(), el = [];
      for (let t = 0; t + 2 < count; t += 3) out.push([0, 1, 2].map(k => apply(m, P.getElement(I ? I.getScalar(t + k) : t + k, el))));
    }
    n.listChildren().forEach(walk);
  };
  scene.listChildren().forEach(walk);
  models.set(file, out);
  return out;
}
// The car's body: its triangles, and where each of its socket nodes is (a matrix)
async function bodyOf(car) {
  if (bodies.has(car.id)) return bodies.get(car.id);
  const doc = await readModel(path.join(ROOT, car.model.file)), nodes = new Map();
  for (const n of doc.getRoot().listNodes()) nodes.set(n.getName(), n.getWorldMatrix());
  const b = { tris: await trianglesOf(car.model.file), nodes };
  bodies.set(car.id, b);
  return b;
}
const apply = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
const translate = p => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p[0], p[1], p[2], 1];
// (column-major 4×4 product a·b)
const mul4 = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const scaleBy = (m, s) => { const o = m.slice(); for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) o[c * 4 + r] *= s[c]; return o; };

// Every model in the build, placed: [{ socket, part, tris }]
async function placed(db, car, garage) {
  const body = await bodyOf(car), owned = garage.state.parts, out = [];
  const wheels = Object.entries(car.model.sockets).filter(([k]) => /^(FL|FR|RL|RR)$/.test(k));
  // (a wheel sits out from its socket by its rim's offset and spacers, as the game draws it: along the socket's +x, outwards)
  const offsets = garage.stats().spec?.wheels?.offsets ?? {}, corner = Object.fromEntries(wheels.map(([k, n]) => [n, k]));
  const nodeMatrix = (name, s) => { const m = body.nodes.get(name) ?? translate(s.position), off = offsets[corner[name]]; return off ? mul4(m, translate([off, 0, 0])) : m; };
  for (const s of car.sockets) {
    const inst = garage.build.sockets?.[s.name], part = inst && db.parts[owned[inst]?.partId];
    if (!part || part.tyreSize) continue;
    const { model, look } = resolveLook(part, db.parts, null, car.id);
    if (!model) continue;
    const tris = await trianglesOf(model), k = look?.scale ?? 1, sc = typeof k === 'number' ? [k, k, k] : k;
    const place = m => tris.map(t => t.map(p => apply(m, p)));
    if (look?.drawAt === 'wheels') {
      const b = partShape(part, db.parts, car.id).bounds, reach = Math.max(...[1, 2].flatMap(i => [Math.abs(b.min[i]), Math.abs(b.max[i])]));
      for (const [corner, name] of wheels) {
        const rimId = garage.build.sockets[name], d = rimId && db.parts[owned[rimId]?.partId]?.rim?.diameter, f = d ? Math.min(1, (d * 0.0254 / 2 - 0.034) / reach) : 1;
        out.push({ socket: `${s.name}@${corner}`, home: name, part, tris: place(scaleBy(nodeMatrix(name, car.sockets.find(x => x.name === name)), [1, f, corner.endsWith('R') ? -f : f])) });
      }
      continue;
    }
    out.push({ socket: s.name, home: s.node ?? s.name, part, tris: place(scaleBy(nodeMatrix(s.node ?? s.name, s), sc)) });
  }
  return { body, parts: out };
}

// ---------- for the generators: fitting a part into a car as they make it ----------

// The things around a socket on the stock car: the body and every stock part but the one in this socket
// (and those in `without`: what the part replaces too), placed — triangles in the car frame; solids:
// boxes nothing may be inside (the engine block)
export async function surroundings(db, carId, socketName, { without = [] } = {}) {
  const car = db.cars[carId], g = new Garage(db, null, carId);
  for (const s of [socketName, ...without]) if (g.build.sockets?.[s]) g.remove(s, { auto: false });
  const { body, parts } = await placed(db, car, g);
  // (the engine block counts for less than anything that shows: inside the bay, not through the bonnet)
  const tris = [...body.tris, ...parts.flatMap(p => p.tris)], weights = [...body.tris.map(() => 10), ...parts.flatMap(p => p.tris.map(() => p.socket === 'socket_engine' ? 1 : 10))];
  const engine = parts.find(p => p.socket === 'socket_engine'), solids = [];
  if (engine) { const b = boxOfPoints(engine.tris.flat()); solids.push({ min: b.min.map(v => v + 0.01), max: b.max.map(v => v - 0.01) }); }
  return { tris, weights, solids, matrix: (await bodyOf(car)).nodes.get(socketName) ?? translate(car.sockets.find(s => s.name === socketName).position) };
}
// How badly a part (its triangles, its own frame) clashes with the surroundings, placed at the socket: each
// clashing triangle counts its obstacle's weight (the engine block 1, anything that shows 10); counting stops
// past `enough`
// (attach: m round the socket where a part meeting what it bolts to — a manifold on the engine — isn't a clash)
export function clashCount(partTris, around, enough = Infinity, attach = 0) {
  const { solids, matrix } = around, near = around.boxed ??= around.tris.map((t, i) => ({ t, b: boxOf3(t), w: around.weights?.[i] ?? 1 }));
  const at = apply(matrix, [0, 0, 0]), away = t => !attach || t.some(p => Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]) > attach);
  const own = partTris.map(t => t.map(p => apply(matrix, p))).filter(away).map(t => ({ t, b: boxOf3(t) }));
  if (!own.length) return 0;
  const all = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const { b } of own) for (let k = 0; k < 3; k++) { all.min[k] = Math.min(all.min[k], b.min[k] - 0.01); all.max[k] = Math.max(all.max[k], b.max[k] + 0.01); }
  const close = near.filter(x => overlap3(x.b, all));
  let n = 0;
  for (const a of own) {
    let w = 0;
    if (a.t.some(p => (!attach || Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]) > attach) && solids.some(s => p.every((v, k) => v > s.min[k] && v < s.max[k])))) w = 1;
    for (const b of close) if (b.w > w && overlap3(a.b, b.b) && (crosses(a.t, b.t) || crosses(b.t, a.t))) { w = b.w; if (w >= 10) break; }
    if ((n += w) > enough) return n;
  }
  return n;
}
// Whether a model keeps to its type's rules (size, origin): what the model checks would fail it for
export function keepsRules(tris, t, tol = 0.03) {
  const b = boxOfPoints(tris.flat());
  return ['x', 'y', 'z'].every((ax, k) => {
    const size = b.max[k] - b.min[k], r = t.size[ax];
    if (r && (size < r[0] || size > r[1])) return false;
    // (a little inside the checker's tolerance: the import compresses the model, which can move it a fraction of a mm)
    const rule = t.origin[ax] ?? 'within', lo = b.min[k], hi = b.max[k], tl = (t.originTolerance ?? tol) - 0.002;
    return rule === 'centre' ? Math.abs((lo + hi) / 2) <= tl : rule === 'min' ? Math.abs(lo) <= tl : rule === 'max' ? Math.abs(hi) <= tl : rule === 'within' ? lo - tl <= 0 && hi + tl >= 0 : true;
  });
}
// The first of the candidates (settings, in order of preference) whose model fits: { model, settings, clashes }
// — or the one with the fewest clashes; type: its rules (a candidate that breaks them isn't one)
export function firstFit(candidates, make, around, type = null, attach = 0) {
  let best = null;
  for (const c of candidates) {
    const model = make(c), tris = model.tris();
    if (type && !keepsRules(tris, type)) continue;
    const n = clashCount(tris, around, best ? best.clashes - 1 : Infinity, attach);
    if (!n) return { model, settings: c, clashes: 0 };
    if (!best || n < best.clashes) best = { model, settings: c, clashes: n };
  }
  return best ?? { model: make(candidates[0]), settings: candidates[0], clashes: -1 };
}
// Candidate settings for firstFit: every combination of the values given for each key ({ dx: [0, -0.04, …],
// k: [1, 0.9, …] }: the first value of each is the design's), the nearest to the design first (cost: how far
// down each key's list, weighted)
export function grid(axes, weights = {}) {
  const keys = Object.keys(axes);
  let out = [{ s: {}, cost: 0 }];
  for (const k of keys) out = out.flatMap(o => axes[k].map((v, i) => ({ s: { ...o.s, [k]: v }, cost: o.cost + i * (weights[k] ?? 1) })));
  return out.sort((a, b) => a.cost - b.cost).map(o => o.s);
}
const boxOf3 = t => ({ min: [0, 1, 2].map(k => Math.min(t[0][k], t[1][k], t[2][k])), max: [0, 1, 2].map(k => Math.max(t[0][k], t[1][k], t[2][k])) });
const boxOfPoints = ps => ({ min: [0, 1, 2].map(k => Math.min(...ps.map(p => p[k]))), max: [0, 1, 2].map(k => Math.max(...ps.map(p => p[k]))) });
const overlap3 = (a, b) => [0, 1, 2].every(k => a.min[k] <= b.max[k] && b.min[k] <= a.max[k]);

export async function fitCheck(db, carId, partId, { detail = false } = {}) {
  const car = db.cars[carId], fit = fitWithNeeds(db, carId, partId);
  if (!fit.ok) return { ok: false, error: fit.error, clashes: {} };
  const { body, parts } = await placed(db, car, fit.garage), mine = parts.filter(p => p.part.id === partId);
  // (what bolts to the engine meets it where it bolts on: its socket and the few cm round it)
  const attach = ENGINE_MOUNTED.has(db.parts[partId].slot) ? ATTACH : 0, sock = car.sockets.find(s => s.slot === db.parts[partId].slot)?.position;
  const near = t => attach && sock && t.every(p => Math.hypot(p[0] - sock[0], p[1] - sock[1], p[2] - sock[2]) <= attach);
  const homes = new Set(mine.map(p => p.home));
  const through = THROUGH[db.parts[partId].slot] ?? [];
  const others = [{ owner: 'the body', tris: body.tris }, ...parts.filter(p => p.part.id !== partId && !(homes.has(p.home) && !p.socket.includes('@')) && !through.includes(p.part.slot)).map(p => ({ owner: p.part.name, tris: p.tris }))];
  const boxOf = t => ({ min: [0, 1, 2].map(k => Math.min(t[0][k], t[1][k], t[2][k])), max: [0, 1, 2].map(k => Math.max(t[0][k], t[1][k], t[2][k])) });
  const overlap = (a, b) => [0, 1, 2].every(k => a.min[k] <= b.max[k] && b.min[k] <= a.max[k]);
  const own = mine.flatMap(p => p.tris).filter(t => !near(t)).map(t => ({ t, b: boxOf(t) }));
  const all = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const { b } of own) for (let k = 0; k < 3; k++) { all.min[k] = Math.min(all.min[k], b.min[k] - 0.01); all.max[k] = Math.max(all.max[k], b.max[k] + 0.01); }
  const clashes = {}, pairs = [];
  for (const o of others) {
    const near = o.tris.map(t => ({ t, b: boxOf(t) })).filter(x => overlap(x.b, all));
    for (const a of own) for (const b of near) if (overlap(a.b, b.b) && (crosses(a.t, b.t) || crosses(b.t, a.t))) { clashes[o.owner] = (clashes[o.owner] ?? 0) + 1; if (detail) pairs.push({ owner: o.owner, part: a.t, other: b.t }); break; }
  }
  return { ok: !Object.keys(clashes).length, clashes, with: fit.with, ...(detail && { pairs }) };
}

// (an edge of triangle a passing through triangle b, not just touching it)
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function crosses(a, b) {
  let n = cross(sub(b[1], b[0]), sub(b[2], b[0]));
  const l = Math.hypot(...n);
  if (l < 1e-7) return false;
  n = n.map(v => v / l);
  const d = dot(n, b[0]);
  for (let k = 0; k < 3; k++) {
    const p = a[k], q = a[(k + 1) % 3], dp = dot(n, p) - d, dq = dot(n, q) - d;
    if (dp * dq >= 0 || Math.min(Math.abs(dp), Math.abs(dq)) < TOL) continue;
    const t = dp / (dp - dq), x = [0, 1, 2].map(i => p[i] + (q[i] - p[i]) * t);
    if (inside(x, b)) return true;
  }
  return false;
}
function inside(x, [a, b, c]) {
  const v0 = sub(c, a), v1 = sub(b, a), v2 = sub(x, a), d00 = dot(v0, v0), d01 = dot(v0, v1), d02 = dot(v0, v2), d11 = dot(v1, v1), d12 = dot(v1, v2), inv = 1 / (d00 * d11 - d01 * d01);
  const u = (d11 * d02 - d01 * d12) * inv, v = (d00 * d12 - d01 * d02) * inv;
  // (strictly inside: a point on an edge is two faces touching, not one going through the other)
  return u > 0.01 && v > 0.01 && u + v < 0.99;          // (as the part preview page does: dev/parts.js)
}

// A generator's build made to fit each car: its candidates (grid of settings, nearest the design first)
// tried in the car's surroundings at the part's socket, the first that keeps to the rules and clashes with
// nothing (or the least) kept; its model says how it fitted (model.fit)
export function fitBuild({ db, rules, type, slot, axes, weights = {}, attach = 0, without = [] }, make) {
  return async car => {
    const socket = car.def.sockets.find(s => s.slot === slot)?.name;
    if (!socket) return make(grid(axes, weights)[0], car);
    const around = await surroundings(db, car.id, socket, { without });
    const r = firstFit(grid(axes, weights), c => make(c, car), around, rules.types[type], attach);
    r.model.fit = { clashes: r.clashes, settings: r.settings };
    return r.model;
  };
}
