// A part's collision shape (Phase 8 Step 3; docs/CONTENT_PIPELINE.md): a few convex hulls that together wrap the
// model, for the physics when the part comes off in a crash and lies in the road (physics/looseParts.js: a box
// before). With CoACD installed (pip install coacd; COACD_PYTHON names the Python to run it with, else python3)
// it's CoACD's approximate convex decomposition; without, the built-in one: the model's surface sampled into a grid
// of cells (inside filled, for a closed mesh), then split in two along whichever plane wastes the least empty space
// in the hulls, the worst piece first, until every hull is snug or there are maxHulls. Each hull is kept to
// maxPoints corners (the farthest apart), rounded to the millimetre, with a little thickness given to a flat one (a
// physics hull can't be flat).
//
//   const c = await collisionHulls(info.triangles, rules.collision)   → { method, hulls: [[x, y, z, …]], volumes, note }

import { spawnSync } from 'node:child_process';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { Vector3 } from 'three';

const MIN_THICK = 0.006;          // m: a flat hull is made this thick

// triangles: [{ p: [[x,y,z]×3] }] in the part's frame; rules: { maxHulls, maxPoints, concavity, cells, coacd }
export async function collisionHulls(triangles, rules) {
  if (!triangles.length) return null;
  if (rules.coacd !== false) {
    const c = coacd(triangles, rules);
    if (c) return finish(c, 'coacd', rules);
  }
  return finish(builtIn(triangles, rules), 'built-in', rules);
}

// ---------- CoACD (if it's there) ----------

const PY = `
import sys, json
import numpy as np
import coacd
coacd.set_log_level("error")
d = json.load(sys.stdin)
m = coacd.Mesh(np.array(d["v"], dtype=float), np.array(d["f"], dtype=int))
parts = coacd.run_coacd(m, threshold=d["threshold"], max_convex_hull=d["max"], preprocess_resolution=30, resolution=1000, mcts_iterations=60, seed=1)
print("HULLS " + json.dumps([[list(map(float, v)) for v in p[0]] for p in parts]))
`;
let coacdPython;
export function coacdAvailable() {
  if (coacdPython !== undefined) return coacdPython;
  for (const py of [process.env.COACD_PYTHON, 'python3'].filter(Boolean)) {
    const r = spawnSync(py, ['-c', 'import coacd, numpy'], { encoding: 'utf8', timeout: 20000 });
    if (r.status === 0) return (coacdPython = py);
  }
  return (coacdPython = null);
}
function coacd(triangles, rules) {
  const py = coacdAvailable();
  if (!py) return null;
  const keys = new Map(), v = [], f = [];
  const id = p => { const k = p.map(x => Math.round(x * 1e5)).join(','); let i = keys.get(k); if (i === undefined) { keys.set(k, i = v.length); v.push(p); } return i; };
  for (const t of triangles) { const tri = t.p.map(id); if (new Set(tri).size === 3) f.push(tri); }
  const r = spawnSync(py, ['-c', PY], { input: JSON.stringify({ v, f, threshold: rules.concavity ?? 0.08, max: rules.maxHulls }), encoding: 'utf8', timeout: 180000, maxBuffer: 64 << 20 });
  const line = r.stdout?.split('\n').find(l => l.startsWith('HULLS '));
  if (r.status !== 0 || !line) return null;
  return JSON.parse(line.slice(6)).filter(h => h.length >= 4);
}

// ---------- built in ----------

function builtIn(triangles, { maxHulls = 6, concavity = 0.3, cells = 24 }) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const t of triangles) for (const p of t.p) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
  const size = max.map((v, k) => v - min[k]), big = Math.max(...size, 1e-3), h = big / cells;
  const dims = size.map(s => Math.max(1, Math.ceil(s / h))), [nx, ny, nz] = dims;
  const cellOf = p => p.map((v, k) => Math.min(dims[k] - 1, Math.max(0, Math.floor((v - min[k]) / h))));
  const at = (i, j, k) => (k * ny + j) * nx + i;
  // (the surface sampled: points on every triangle, no farther apart than half a cell, and each cell they're in)
  const filled = new Uint8Array(nx * ny * nz), byCell = new Map(), samples = [];
  const addPoint = p => {
    const c = cellOf(p), id = at(...c);
    filled[id] = 1;
    let list = byCell.get(id);
    if (!list) byCell.set(id, list = []);
    list.push(samples.length);
    samples.push(p);
  };
  for (const { p: [a, b, c] } of triangles) {
    const n = Math.min(40, Math.ceil(Math.max(dist(a, b), dist(b, c), dist(c, a)) / (h / 2)));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
      const u = i / n, w = j / n, s = 1 - u - w;
      addPoint([0, 1, 2].map(k => a[k] * s + b[k] * u + c[k] * w));
    }
  }
  // (inside: the cells the outside can't reach, for a closed mesh — a flat panel has none)
  const outside = new Uint8Array(nx * ny * nz), stack = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++)
    if ((i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) && !filled[at(i, j, k)]) { outside[at(i, j, k)] = 1; stack.push([i, j, k]); }
  while (stack.length) {
    const [i, j, k] = stack.pop();
    for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const x = i + di, y = j + dj, z = k + dk;
      if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
      const id = at(x, y, z);
      if (outside[id] || filled[id]) continue;
      outside[id] = 1; stack.push([x, y, z]);
    }
  }
  const all = [];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (!outside[at(i, j, k)]) all.push([i, j, k]);
  const cellVol = h ** 3;
  // a piece: its cells; its points (the surface samples in them, or a cell's corners for an inside one, so the hull
  // takes in the solid); its hull's volume and how much of it is empty
  const piece = cellList => {
    const pts = [];
    for (const [i, j, k] of cellList) {
      const list = byCell.get(at(i, j, k));
      if (list) for (const s of list) pts.push(samples[s]);
      else pts.push([min[0] + (i + 0.5) * h, min[1] + (j + 0.5) * h, min[2] + (k + 0.5) * h]);
    }
    const hull = hullOf(thin(pts, 1500)), occupied = cellList.length * cellVol;
    return { cells: cellList, points: pts, hull, waste: Math.max(0, hull.volume - occupied), concavity: hull.volume > 0 ? Math.max(0, 1 - occupied / hull.volume) : 0 };
  };
  const pieces = [piece(all)];
  while (pieces.length < maxHulls) {
    const worst = pieces.reduce((a, p) => p.waste > a.waste ? p : a);
    if (worst.concavity < concavity || worst.cells.length < 8) break;
    let best = null;
    for (let ax = 0; ax < 3; ax++) {
      const lo = Math.min(...worst.cells.map(c => c[ax])), hi = Math.max(...worst.cells.map(c => c[ax]));
      if (hi - lo < 2) continue;
      for (const f of [0.25, 0.5, 0.75]) {
        const cut = Math.round(lo + (hi - lo) * f) + 0.5, A = worst.cells.filter(c => c[ax] < cut), B = worst.cells.filter(c => c[ax] >= cut);
        if (!A.length || !B.length) continue;
        const a = piece(A), b = piece(B), waste = a.waste + b.waste;
        if (!best || waste < best.waste) best = { a, b, waste };
      }
    }
    if (!best || best.waste > worst.waste * 0.8) { worst.concavity = 0; continue; }      // (no cut helps: leave it)
    pieces.splice(pieces.indexOf(worst), 1, best.a, best.b);
  }
  return pieces.map(p => p.hull.vertices);
}

// ---------- hulls ----------

function hullOf(points) {
  if (points.length < 4) return { vertices: points, volume: 0 };
  try {
    const H = new ConvexHull().setFromPoints(points.map(p => new Vector3(...p)));
    const verts = H.vertices.map(v => [v.point.x, v.point.y, v.point.z]);
    const c = verts.reduce((a, v) => a.map((x, k) => x + v[k] / verts.length), [0, 0, 0]);
    let vol = 0;
    for (const f of H.faces) {
      const e0 = f.edge, pts = [e0.head().point, e0.next.head().point, e0.next.next.head().point];
      const [a, b, d] = pts.map(p => [p.x - c[0], p.y - c[1], p.z - c[2]]);
      vol += Math.abs(a[0] * (b[1] * d[2] - b[2] * d[1]) - a[1] * (b[0] * d[2] - b[2] * d[0]) + a[2] * (b[0] * d[1] - b[1] * d[0])) / 6;
    }
    return { vertices: verts, volume: vol };
  } catch { return { vertices: points, volume: 0 }; }
}

// The hulls as the game keeps them: each its corners (at most maxPoints, the farthest apart), given thickness if
// it's flat, rounded to the millimetre; with each one's volume (the part's mass is shared out by them)
function finish(hulls, method, { maxPoints = 24 }) {
  const out = [], volumes = [];
  for (let pts of hulls) {
    pts = hullOf(pts).vertices;
    if (pts.length > maxPoints) pts = farthest(pts, maxPoints);
    pts = thicken(pts);
    const H = hullOf(pts);
    if (H.volume <= 0) continue;
    out.push(pts.flatMap(p => p.map(v => Math.round(v * 1000) / 1000 + 0)));
    volumes.push(+H.volume.toFixed(6));
  }
  return out.length ? { method, hulls: out, volumes } : null;
}
// (a flat hull — a panel with no curve — pushed apart along its thinnest direction)
function thicken(pts) {
  const c = pts.reduce((a, v) => a.map((x, k) => x + v[k] / pts.length), [0, 0, 0]);
  // (its thinnest direction, near enough: across the plane of three far-apart corners — or, if they're in a line, the
  // box's thinnest side)
  const span = [0, 1, 2].map(k => Math.max(...pts.map(p => p[k])) - Math.min(...pts.map(p => p[k])));
  const a = pts.reduce((m, p) => dist(p, c) > dist(m, c) ? p : m, pts[0]), b = pts.reduce((m, p) => dist(p, a) > dist(m, a) ? p : m, pts[0]);
  const ab = sub(b, a), far = pts.reduce((m, p) => len(cross(ab, sub(p, a))) > len(cross(ab, sub(m, a))) ? p : m, pts[0]);
  let n = cross(ab, sub(far, a));
  if (len(n) < 1e-9) { n = [0, 0, 0]; n[span.indexOf(Math.min(...span))] = 1; }
  n = n.map(x => x / len(n));
  const ds = pts.map(p => dot(sub(p, c), n)), thick = Math.max(...ds) - Math.min(...ds);
  if (thick >= MIN_THICK) return pts;
  const push = (MIN_THICK - thick) / 2;
  return pts.flatMap(p => [p.map((v, k) => v + n[k] * push), p.map((v, k) => v - n[k] * push)]);
}
function farthest(pts, n) {
  const out = [pts[0]], d = pts.map(p => dist(p, pts[0]));
  while (out.length < n) {
    let i = 0;
    for (let j = 1; j < pts.length; j++) if (d[j] > d[i]) i = j;
    out.push(pts[i]);
    for (let j = 0; j < pts.length; j++) d[j] = Math.min(d[j], dist(pts[j], pts[i]));
  }
  return out;
}
function thin(pts, n) { if (pts.length <= n) return pts; const step = pts.length / n, out = []; for (let i = 0; i < pts.length; i += step) out.push(pts[Math.floor(i)]); return out; }
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
