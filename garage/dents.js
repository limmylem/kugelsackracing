// Dents in a car's meshes (three.js). The game's models are low-poly, so a mesh is first made finer
// (tessellate: every edge longer than maxEdge split at its middle, longest first, in every triangle
// that has it, so neighbouring faces stay joined), once per model and shared; a car's mesh gets its own
// copy of that the first time it's dented (makeDentable), and a repair puts the shared model back
// (clearDents). A dent pushes the vertices near its point in along its direction, deepest at the point,
// fading smoothly to nothing at its radius; however many dents, no vertex moves more than maxDepth.
// The normals are worked out again so the light shows the dent (faces that were flat and sharp-edged
// stay so where they aren't dented).
//
// Dents are given in the mesh's own space: { p: Vector3, d: Vector3 (unit), depth, radius }. The same
// list always gives the same shape: adding a dent to a list adds to what's there, a different list is
// worked out again from the undented copy. Only the vertices near a dent are looked at (the copy's
// vertices sorted along x: a dent visits those within its radius of it there).
//
// Cost: denting is the one heavy thing a crash does to the drawing. A DentBudget spreads it over frames
// — setDamage hands it the meshes to dent (the newest list for each wins) and flush() each frame dents as
// many as fit in its milliseconds (always at least one), so a big crash, or ten cars crashing at once,
// never stalls a frame for long. A repair blends between two lists (blendDents: the dents easing out).

import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const MAX_EDGE = 0.07;
// (a vertex's components, the same for plain, interleaved and quantised attributes: as numbers, scaled back)
const GET = ['getX', 'getY', 'getZ', 'getW'].map(n => function (i) { return this[n](i); });
const finer = new WeakMap();          // a model's geometry → its tessellated copy (shared by every car)

// A finer copy of a geometry: indexed, no edge longer than maxEdge (attributes interpolated at the
// new vertices), only the vertices its triangles use
export function tessellate(source, maxEdge = MAX_EDGE) {
  let g = source.index ? source : mergeVertices(source.clone(), 1e-6);
  const names = Object.keys(g.attributes);
  const attrs = names.map(n => ({ name: n, size: g.attributes[n].itemSize, src: g.attributes[n], data: [] }));
  const index = g.index ? Array.from(g.index.array) : Array.from({ length: g.attributes.position.count }, (_, i) => i);
  // (only the vertices the triangles use, in a compact list)
  const remap = new Map(), take = i => {
    let j = remap.get(i);
    if (j === undefined) { j = remap.size; remap.set(i, j); for (const a of attrs) for (let k = 0; k < a.size; k++) a.data.push(GET[k].call(a.src, i)); }
    return j;
  };
  const tris = [];
  for (let t = 0; t < index.length; t += 3) tris.push([take(index[t]), take(index[t + 1]), take(index[t + 2])]);
  const P = attrs.find(a => a.name === 'position').data;
  // edges by where their ends are (split vertices at a sharp edge are one edge)
  const keyOfPos = new Map(), posId = [];
  const idOf = i => { const k = `${Math.round(P[i * 3] * 1e5)},${Math.round(P[i * 3 + 1] * 1e5)},${Math.round(P[i * 3 + 2] * 1e5)}`; let id = keyOfPos.get(k); if (id === undefined) keyOfPos.set(k, id = keyOfPos.size); return id; };
  for (let i = 0; i < remap.size; i++) posId.push(idOf(i));
  const edgeKey = (a, b) => { const x = posId[a], y = posId[b]; return x < y ? x * 2097152 + y : y * 2097152 + x; };
  const len = (a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
  const edges = new Map();          // edge key → set of triangle ids
  const heap = [];                  // [length, key, a, b], longest first
  const push = (l, key, a, b) => { heap.push([l, key, a, b]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] >= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] > heap[m][0]) m = l; if (r < heap.length && heap[r][0] > heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const link = (t, a, b) => {
    const k = edgeKey(a, b);
    let set = edges.get(k);
    if (!set) { edges.set(k, set = new Set()); const l = len(a, b); if (l > maxEdge) push(l, k, a, b); }
    set.add(t);
  };
  const unlink = (t, a, b) => edges.get(edgeKey(a, b))?.delete(t);
  tris.forEach((t, i) => { link(i, t[0], t[1]); link(i, t[1], t[2]); link(i, t[2], t[0]); });
  const mids = new Map();           // a vertex pair → the vertex made halfway
  const midOf = (a, b) => {
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    let m = mids.get(k);
    if (m === undefined) {
      m = P.length / 3;
      for (const at of attrs) for (let c = 0; c < at.size; c++) at.data.push((at.data[a * at.size + c] + at.data[b * at.size + c]) / 2);
      posId.push(idOf(m));
      mids.set(k, m);
    }
    return m;
  };
  let guard = 0;
  while (heap.length && guard++ < 2e6) {
    const [, key] = pop(), set = edges.get(key);
    if (!set?.size) continue;
    for (const t of [...set]) {
      const tri = tris[t];
      // this triangle's corners at the edge's ends (in its own winding), and the third
      let i = 0;
      while (i < 3 && edgeKey(tri[i], tri[(i + 1) % 3]) !== key) i++;
      if (i === 3) continue;
      const a = tri[i], b = tri[(i + 1) % 3], c = tri[(i + 2) % 3], m = midOf(a, b);
      unlink(t, a, b); unlink(t, b, c); unlink(t, c, a);
      tris[t] = [a, m, c];
      const u = tris.push([m, b, c]) - 1;
      link(t, a, m); link(t, m, c); link(t, c, a);
      link(u, m, b); link(u, b, c); link(u, c, m);
    }
    edges.delete(key);
  }
  const out = new THREE.BufferGeometry(), n = P.length / 3;
  for (const a of attrs) out.setAttribute(a.name, new THREE.BufferAttribute(new Float32Array(a.data), a.size));
  const idx = tris.flat();
  out.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  if (source.groups?.length === 1) out.addGroup(0, idx.length, source.groups[0].materialIndex);
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}

// The shared finer copy of a model's geometry
export function finerOf(geometry) {
  let f = finer.get(geometry);
  if (!f) { finer.set(geometry, f = tessellate(geometry)); f.userData.finerOf = f; }
  return f;
}

// This car's own copy of the mesh's geometry, ready to dent (once)
export function makeDentable(mesh) {
  const u = mesh.userData;
  if (u.dent) return u.dent;
  const shared = mesh.geometry, own = finerOf(shared).clone();
  mesh.geometry = own;
  u.dent = { shared, own, base: Float32Array.from(own.attributes.position.array), raw: new Float32Array(own.attributes.position.array.length), keys: [], ...sortedX(own) };
  return u.dent;
}
// (the vertices sorted along x, shared by every car on the model: a dent looks only at those near it)
const byX = new WeakMap();
function sortedX(g) {
  const key = g.userData?.finerOf ?? g;
  let s = byX.get(key);
  if (!s) {
    const a = g.attributes.position.array, n = a.length / 3, order = Uint32Array.from({ length: n }, (_, i) => i).sort((i, j) => a[i * 3] - a[j * 3]);
    s = { order, xs: Float32Array.from(order, i => a[i * 3]) };
    byX.set(key, s);
  }
  return s;
}
const lowerBound = (xs, x) => { let lo = 0, hi = xs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] < x) lo = m + 1; else hi = m; } return lo; };
// Every vertex's push from a list of dents, added into raw (the copy's base positions B)
function pushIn(D, dents, raw) {
  const B = D.base, { order, xs } = D;
  for (const { p, d, depth, radius } of dents) {
    const r2 = radius * radius, to = xs.length;
    for (let k = lowerBound(xs, p.x - radius); k < to && xs[k] <= p.x + radius; k++) {
      const i = order[k] * 3, dx = B[i] - p.x, dy = B[i + 1] - p.y, dz = B[i + 2] - p.z, q = dx * dx + dy * dy + dz * dz;
      if (q >= r2) continue;
      const f = (1 - q / r2) ** 2 * depth;
      raw[i] += d.x * f; raw[i + 1] += d.y * f; raw[i + 2] += d.z * f;
    }
  }
}
// (no vertex more than maxDepth from where it was)
function clampPush(raw, maxDepth) {
  for (let i = 0; i < raw.length; i += 3) {
    const l = Math.hypot(raw[i], raw[i + 1], raw[i + 2]);
    if (l > maxDepth) { const k = maxDepth / l; raw[i] *= k; raw[i + 1] *= k; raw[i + 2] *= k; }
  }
  return raw;
}

// Back to the model's own geometry (a repair)
export function clearDents(mesh) {
  const D = mesh.userData.dent;
  if (!D) return;
  mesh.geometry = D.shared;
  D.own.dispose();
  delete mesh.userData.dent;
}

const keyOf = x => `${x.p.x.toFixed(4)},${x.p.y.toFixed(4)},${x.p.z.toFixed(4)},${x.d.x.toFixed(3)},${x.d.y.toFixed(3)},${x.d.z.toFixed(3)},${x.depth.toFixed(4)},${x.radius.toFixed(4)}`;

// Dent a mesh: dents (its own space) as they should be now; maxDepth: the most any vertex moves (its
// own units). Returns how many vertices moved.
export function setDents(mesh, dents, maxDepth) {
  if (!dents.length) { clearDents(mesh); return 0; }
  const D = makeDentable(mesh), keys = dents.map(keyOf);
  const same = D.keys.length <= keys.length && D.keys.every((k, i) => k === keys[i]);
  if (!same) { D.raw.fill(0); D.keys = []; }
  const B = D.base, raw = D.raw;
  pushIn(D, dents.slice(D.keys.length), raw);
  D.keys = keys;
  // (never more than maxDepth from where it was)
  const pos = D.own.attributes.position, a = pos.array;
  let moved = 0;
  for (let i = 0; i < B.length; i += 3) {
    let x = raw[i], y = raw[i + 1], z = raw[i + 2];
    const l = Math.hypot(x, y, z);
    if (l > 1e-7) { moved++; if (l > maxDepth) { const k = maxDepth / l; x *= k; y *= k; z *= k; } }
    a[i] = B[i] + x; a[i + 1] = B[i + 1] + y; a[i + 2] = B[i + 2] + z;
  }
  pos.needsUpdate = true;
  D.own.computeVertexNormals();
  D.own.computeBoundingSphere(); D.own.computeBoundingBox();
  return moved;
}

// A mesh between two dent lists (its own space, as setDents): a repair easing the dents out. Returns
// { set(t) (0: from, 1: to), done() (the mesh as `to` has it) }, or null if neither has any
export function blendDents(mesh, from, to, maxDepth) {
  if (!from.length && !to.length) return null;
  const D = makeDentable(mesh), n = D.base.length, push = list => { const r = new Float32Array(n); pushIn(D, list, r); return clampPush(r, maxDepth); };
  const a = push(from), b = push(to);
  const pos = D.own.attributes.position, arr = pos.array, B = D.base;
  D.keys = [];                 // (the next setDents works it out afresh)
  return {
    set(t) {
      for (let i = 0; i < n; i++) arr[i] = B[i] + a[i] + (b[i] - a[i]) * t;
      pos.needsUpdate = true;
      D.own.computeVertexNormals();
    },
    done() { setDents(mesh, to, maxDepth); },
  };
}

// Denting spread over frames: queue(mesh, dents, maxDepth) (the newest list for a mesh wins), and
// flush() each frame dents queued meshes until ms milliseconds have gone (at least one a frame).
// stats: { frames, meshes, worstMs, lastMs, waiting }
export class DentBudget {
  constructor(ms = 2) { this.ms = ms; this.jobs = new Map(); this.stats = { frames: 0, meshes: 0, worstMs: 0, lastMs: 0, waiting: 0 }; }
  queue(mesh, dents, maxDepth) { this.jobs.delete(mesh); this.jobs.set(mesh, { dents, maxDepth }); }
  drop(mesh) { this.jobs.delete(mesh); }
  get pending() { return this.jobs.size; }
  flush(ms = this.ms) {
    const t0 = performance.now();
    let n = 0;
    for (const [mesh, job] of this.jobs) {
      if (n && performance.now() - t0 >= ms) break;
      this.jobs.delete(mesh);
      if (mesh.userData.disposed) continue;
      setDents(mesh, job.dents, job.maxDepth);
      n++;
    }
    const took = performance.now() - t0, S = this.stats;
    S.frames++; S.meshes += n; S.lastMs = took; S.worstMs = Math.max(S.worstMs, took); S.waiting = this.jobs.size;
    return n;
  }
}
