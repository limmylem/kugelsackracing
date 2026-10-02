// Dents in a car's meshes (three.js). The game's models are low-poly, so a mesh is first made finer
// (tessellate: every edge longer than maxEdge split at its middle, longest first, in every triangle
// that has it, so neighbouring faces stay joined), once per model and shared; a car's mesh gets its own
// copy of that the first time it's dented (makeDentable), and a repair puts the shared model back
// (clearDents). A dent pushes the vertices near its point in along its direction, deepest at the point,
// fading smoothly to nothing at its radius; however many dents, no vertex moves more than maxDepth.
// The normals round a dent are worked out again so the light shows it (everywhere else the model's own
// stay: faces that were flat and sharp-edged stay so).
//
// Dents are given in the mesh's own space: { p: Vector3, d: Vector3 (unit), depth, radius }. The same
// list always gives the same shape: adding a dent to a list adds to what's there, a different list is
// worked out again from the undented copy. Only the vertices near a dent are looked at (the copy's
// vertices sorted along x: a dent visits those within its radius of it there), and only they and the
// normals round them are written: a dent's cost is its size, not the mesh's.
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
  if (!f) { finer.set(geometry, f = tessellate(geometry)); f.userData.finerOf = f; prepare(f); }
  return f;
}

// This car's own copy of the mesh's geometry, ready to dent (once). Its undented positions are the
// shared finer copy's (never changed); raw: each vertex's push, before the most it may move; moved: the
// vertices pushed (flag: 1 each)
export function makeDentable(mesh) {
  const u = mesh.userData;
  if (u.dent) return u.dent;
  const shared = mesh.geometry, f = finerOf(shared), S = prepare(f), own = f.clone(), n = S.count;
  mesh.geometry = own;
  u.dent = { shared, own, finer: f, base: f.attributes.position.array, raw: new Float32Array(n * 3), flag: new Uint8Array(n), moved: [], keys: [], maxDepth: null, S, order: S.order, xs: S.xs };
  return u.dent;
}
// (what denting any copy of a finer mesh needs, worked out once and shared by every car on the model:
// its vertices sorted along x — a dent looks only at those near it — and each vertex's triangles, so new
// normals are worked out only round what a dent moved; mark/stamp: a scratch list of vertices seen)
const prepared = new WeakMap();
export function prepare(f) {
  let S = prepared.get(f);
  if (S) return S;
  if (!f.attributes.normal) f.computeVertexNormals();
  const a = f.attributes.position.array, n = a.length / 3, idx = f.index.array;
  const order = Uint32Array.from({ length: n }, (_, i) => i).sort((i, j) => a[i * 3] - a[j * 3]);
  const start = new Uint32Array(n + 1), tris = new Uint32Array(idx.length);
  for (let k = 0; k < idx.length; k++) start[idx[k] + 1]++;
  for (let v = 0; v < n; v++) start[v + 1] += start[v];
  const fill = start.slice(0, n);
  for (let k = 0; k < idx.length; k++) tris[fill[idx[k]]++] = (k / 3) | 0;
  S = { count: n, order, xs: Float32Array.from(order, i => a[i * 3]), start, tris, mark: new Uint32Array(n), stamp: 0 };
  prepared.set(f, S);
  return S;
}
const lowerBound = (xs, x) => { let lo = 0, hi = xs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] < x) lo = m + 1; else hi = m; } return lo; };
// Every vertex's push from a list of dents, added into raw (the copy's base positions B); each vertex it
// reaches put on `into` once (stamp: this round's mark)
function pushIn(D, dents, raw, into = [], stamp = ++D.S.stamp) {
  const B = D.base, { order, xs, mark } = D.S;
  for (const { p, d, depth, radius } of dents) {
    const r2 = radius * radius, to = xs.length;
    for (let k = lowerBound(xs, p.x - radius); k < to && xs[k] <= p.x + radius; k++) {
      const v = order[k], i = v * 3, dx = B[i] - p.x, dy = B[i + 1] - p.y, dz = B[i + 2] - p.z, q = dx * dx + dy * dy + dz * dz;
      if (q >= r2) continue;
      const f = (1 - q / r2) ** 2 * depth;
      raw[i] += d.x * f; raw[i + 1] += d.y * f; raw[i + 2] += d.z * f;
      if (mark[v] !== stamp) { mark[v] = stamp; into.push(v); }
    }
  }
  return into;
}
// The normals round some vertices: of every vertex on a triangle with one of them, worked out from its
// triangles (area-weighted, as three.js's computeVertexNormals) where any of those is dented, the
// model's own where none is
function normalsNear(D, verts) {
  const { start, tris, mark } = D.S, stamp = ++D.S.stamp, idx = D.finer.index.array, flag = D.flag, around = [];
  const P = D.own.attributes.position.array, N = D.own.attributes.normal.array, N0 = D.finer.attributes.normal.array;
  for (const v of verts) for (let k = start[v]; k < start[v + 1]; k++) {
    const t = tris[k] * 3;
    for (let j = 0; j < 3; j++) { const w = idx[t + j]; if (mark[w] !== stamp) { mark[w] = stamp; around.push(w); } }
  }
  for (const w of around) {
    let x = 0, y = 0, z = 0, dented = false;
    for (let k = start[w]; k < start[w + 1]; k++) {
      const t = tris[k] * 3, A = idx[t], Bv = idx[t + 1], C = idx[t + 2];
      dented ||= !!(flag[A] | flag[Bv] | flag[C]);
      const a = A * 3, b = Bv * 3, c = C * 3;
      const cx = P[c] - P[b], cy = P[c + 1] - P[b + 1], cz = P[c + 2] - P[b + 2], ax = P[a] - P[b], ay = P[a + 1] - P[b + 1], az = P[a + 2] - P[b + 2];
      x += cy * az - cz * ay; y += cz * ax - cx * az; z += cx * ay - cy * ax;
    }
    const i = w * 3;
    if (!dented) { N[i] = N0[i]; N[i + 1] = N0[i + 1]; N[i + 2] = N0[i + 2]; continue; }
    const l = Math.hypot(x, y, z) || 1;
    N[i] = x / l; N[i + 1] = y / l; N[i + 2] = z / l;
  }
  D.own.attributes.normal.needsUpdate = true;
  return around.length;
}
// (the copy's bounds: the model's, grown by the most a dent can move a vertex — set once, not per dent)
function bounds(D, maxDepth) {
  if (D.boundsFor === maxDepth) return;
  D.boundsFor = maxDepth;
  if (!D.finer.boundingBox) D.finer.computeBoundingBox();
  if (!D.finer.boundingSphere) D.finer.computeBoundingSphere();
  D.own.boundingBox = D.finer.boundingBox.clone().expandByScalar(maxDepth);
  D.own.boundingSphere = D.finer.boundingSphere.clone();
  D.own.boundingSphere.radius += maxDepth;
}
// (no vertex more than maxDepth from where it was: those in verts)
function clampPush(raw, maxDepth, verts) {
  for (const v of verts) {
    const i = v * 3, l = Math.hypot(raw[i], raw[i + 1], raw[i + 2]);
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
// own units). Returns how many vertices moved. Only what changes is worked out: dents added to the list
// last time push just the vertices near them; a different list takes back the old pushes first (only
// the vertices those moved). The positions, then the normals round them, are written where they moved.
export function setDents(mesh, dents, maxDepth) {
  if (!dents.length) { clearDents(mesh); return 0; }
  const D = makeDentable(mesh), keys = dents.map(keyOf), raw = D.raw, flag = D.flag, stamp = ++D.S.stamp;
  const same = D.maxDepth === maxDepth && D.keys.length <= keys.length && D.keys.every((k, i) => k === keys[i]);
  let touched = [];
  if (!same) {
    // (the old pushes taken back: those vertices are worked out again)
    for (const v of D.moved) { raw[v * 3] = raw[v * 3 + 1] = raw[v * 3 + 2] = 0; flag[v] = 0; D.S.mark[v] = stamp; touched.push(v); }
    D.moved = [];
  }
  touched = pushIn(D, same ? dents.slice(D.keys.length) : dents, raw, touched, stamp);
  D.keys = keys; D.maxDepth = maxDepth;
  // (never more than maxDepth from where it was)
  const B = D.base, pos = D.own.attributes.position, a = pos.array;
  for (const v of touched) {
    const i = v * 3;
    let x = raw[i], y = raw[i + 1], z = raw[i + 2];
    const l = Math.hypot(x, y, z);
    if (l > maxDepth) { const k = maxDepth / l; x *= k; y *= k; z *= k; }
    a[i] = B[i] + x; a[i + 1] = B[i + 1] + y; a[i + 2] = B[i + 2] + z;
    if (l > 0 && !flag[v]) { flag[v] = 1; D.moved.push(v); }
  }
  pos.needsUpdate = true;
  normalsNear(D, touched);
  bounds(D, maxDepth);
  let moved = 0;
  for (const v of D.moved) if (Math.hypot(raw[v * 3], raw[v * 3 + 1], raw[v * 3 + 2]) > 1e-7) moved++;
  return moved;
}

// A mesh between two dent lists (its own space, as setDents): a repair easing the dents out. Returns
// { set(t) (0: from, 1: to), done() (the mesh as `to` has it) }, or null if neither has any. Only the
// vertices either list moves (and what the mesh had) are worked on
export function blendDents(mesh, from, to, maxDepth) {
  if (!from.length && !to.length) return null;
  const D = makeDentable(mesh), n = D.base.length, stamp = ++D.S.stamp, a = new Float32Array(n), b = new Float32Array(n);
  const verts = [];
  for (const v of D.moved) { D.S.mark[v] = stamp; verts.push(v); }
  pushIn(D, from, a, verts, stamp); pushIn(D, to, b, verts, stamp);
  clampPush(a, maxDepth, verts); clampPush(b, maxDepth, verts);
  // (every vertex here counts as moved: the next setDents takes them all back and works them out afresh)
  for (const v of verts) if (!D.flag[v]) { D.flag[v] = 1; D.moved.push(v); }
  D.keys = ['(blending)'];
  const pos = D.own.attributes.position, arr = pos.array, B = D.base;
  bounds(D, maxDepth);
  return {
    set(t) {
      for (const v of verts) for (let i = v * 3; i < v * 3 + 3; i++) arr[i] = B[i] + a[i] + (b[i] - a[i]) * t;
      pos.needsUpdate = true;
      normalsNear(D, verts);
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
