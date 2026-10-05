// A generated track made into a world (Phase 5 Step 1): its road, the ground round it, where its surfaces
// are, where the car starts, and its course in the Phase 4 route format — so checkpoints, the corridor,
// resets, timing, the racing line and NPC racers work on it as on a real-world route. Pure data (no
// rendering library): the same arrays become the drawn meshes and the physics' colliders
// (physics/track.js trackShapes), so what you see is what the car drives on.
//
//   buildTrack(gen, cfg) → world data (structured-cloneable: a worker makes it, IndexedDB keeps it)
//     gen: track/generate.js generateTrack's result; cfg: data/tracks.json
//     { code, hash, version, params, stats, attempts, closed, length, width, verge,
//       centre: { x, z, h, bank }, road: { positions, indices, colours, columns }, terrain: { n, size, heights },
//       paintLines, surfaces, spawn, course, start, finish, bounds, build }
//   trackProjection: the frame's projection (the route format keeps lat/lon: a generated track sits at 0°, 0°)
//   trackWorld(data) → the scene description the simulation and the renderer take (physics/track.js)
//
// The road: a cross-section every centreline point — the verge, the road's edge, its middle, the other
// edge, the other verge — the road surface tilted by its banking, the verges flat at the edge's height
// and reaching down onto the ground (room for kerbs and barriers in Step 2). The ground: a height grid
// round the track (track/../physics/terrain.js's layout), under the road and verges a little below them,
// beyond them meeting the road's edge and blending over cfg.build.blend m into land that follows the
// track's own heights (a cutting where the track is lower, an embankment where it's higher).

import { transverseMercator } from '../map/build/format/projection.js';
import { encodeLine, withS } from '../route/geometry.js';
import { placeGrid, gateAt, GRID } from '../route/grid.js';
import { autoCheckpoints, CHECKPOINTS } from '../route/checkpoints.js';
import { routeStats } from '../route/stats.js';
import { routeOptions } from '../route/build.js';
import { bakeRacing, GUIDES } from '../route/model.js';

export const BUILD_VERSION = 1;
export const trackProjection = transverseMercator(0, 0);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const r1 = x => Math.round(x * 10) / 10;

export function buildTrack(gen, cfg, { progress = () => {} } = {}) {
  const T = gen.track, B = cfg.build, n = T.n, closed = T.closed, W = T.width / 2, V = B.verge;
  // ---------- the centreline's frame: along, left, the banking's tilt ----------
  const tx = new Float64Array(n), tz = new Float64Array(n), tanB = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = closed ? (i - 1 + n) % n : Math.max(0, i - 1), b = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    const dx = T.x[b] - T.x[a], dz = T.z[b] - T.z[a], m = Math.hypot(dx, dz) || 1;
    tx[i] = dx / m; tz[i] = dz / m; tanB[i] = Math.tan(T.bank[i] * Math.PI / 180);
  }
  // the road's surface at u m left of the centreline (u clamped to the road: the verges are flat)
  const surface = (i, u) => T.h[i] + clamp(u, -W, W) * tanB[i];

  // ---------- the ground ----------
  progress('ground', 0);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, hsum = 0;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, T.x[i]); x1 = Math.max(x1, T.x[i]); z0 = Math.min(z0, T.z[i]); z1 = Math.max(z1, T.z[i]); hsum += T.h[i]; }
  const span = Math.max(x1 - x0, z1 - z0) + 2 * B.margin + 2 * Math.max(Math.abs(x1 + x0), Math.abs(z1 + z0)) / 2;
  const cellWanted = Math.max(B.cell, span / B.maxCells), N = Math.ceil(span / cellWanted), size = N * cellWanted, cell = cellWanted, half = size / 2;
  const G = (N + 1) * (N + 1), heights = new Float32Array(G), meanH = hsum / n;
  // the land: the track's own heights, weighted by nearness (a gentle landscape that follows it)
  const wsum = new Float32Array(G), hw = new Float32Array(G), reachLand = 320, step = Math.max(1, Math.round(8 / T.step));
  const idx = (c, r) => r + c * (N + 1);
  for (let i = 0; i < n; i += step) {
    const c0 = Math.max(0, Math.floor((T.x[i] - reachLand + half) / cell)), c1 = Math.min(N, Math.ceil((T.x[i] + reachLand + half) / cell));
    const q0 = Math.max(0, Math.floor((T.z[i] - reachLand + half) / cell)), q1 = Math.min(N, Math.ceil((T.z[i] + reachLand + half) / cell));
    for (let c = c0; c <= c1; c++) { const vx = -half + c * cell - T.x[i]; for (let r = q0; r <= q1; r++) { const vz = -half + r * cell - T.z[i], d2 = vx * vx + vz * vz; if (d2 > reachLand * reachLand) continue; const w = 1 / (d2 + 900); wsum[idx(c, r)] += w; hw[idx(c, r)] += w * T.h[i]; } }
  }
  const w0 = 1 / (reachLand * reachLand) * 4;
  for (let k = 0; k < G; k++) heights[k] = (hw[k] + w0 * meanH) / (wsum[k] + w0);
  progress('ground', 0.4);
  // near the track: the nearest centreline point to each grid point
  const reach = W + V + B.blend + 40, nearest = new Float32Array(G).fill(Infinity), near = new Int32Array(G).fill(-1);
  for (let i = 0; i < n; i++) {
    const c0 = Math.max(0, Math.floor((T.x[i] - reach + half) / cell)), c1 = Math.min(N, Math.ceil((T.x[i] + reach + half) / cell));
    const q0 = Math.max(0, Math.floor((T.z[i] - reach + half) / cell)), q1 = Math.min(N, Math.ceil((T.z[i] + reach + half) / cell));
    for (let c = c0; c <= c1; c++) { const vx = -half + c * cell - T.x[i]; for (let r = q0; r <= q1; r++) { const vz = -half + r * cell - T.z[i], d = Math.hypot(vx, vz), k = idx(c, r); if (d < nearest[k]) { nearest[k] = d; near[k] = i; } } }
  }
  for (let c = 0; c <= N; c++) for (let r = 0; r <= N; r++) {
    const k = idx(c, r), i = near[k];
    if (i < 0) continue;
    const vx = -half + c * cell - T.x[i], vz = -half + r * cell - T.z[i];
    const u = vx * tz[i] - vz * tx[i], along = vx * tx[i] + vz * tz[i], d = Math.hypot(Math.abs(u), (!closed && (i === 0 || i === n - 1)) ? Math.abs(along) : 0);
    const edge = surface(i, u);
    if (d <= W + V + 0.5) { heights[k] = edge - 0.35; continue; }                  // (under the road and its verges)
    const land = heights[k], blend = B.blend + Math.min(60, Math.abs(land - edge) * 1.5);
    heights[k] = edge - 0.05 + (land - (edge - 0.05)) * smoothstep(W + V, W + V + blend, d);
  }
  const terrainAt = (x, z) => {
    const gx = (x + half) / cell, gz = (z + half) / cell;
    if (gx < 0 || gz < 0 || gx > N || gz > N) return meanH;
    const c = Math.min(N - 1, Math.floor(gx)), r = Math.min(N - 1, Math.floor(gz)), fx = gx - c, fz = gz - r;
    const h00 = heights[idx(c, r)], h10 = heights[idx(c + 1, r)], h01 = heights[idx(c, r + 1)], h11 = heights[idx(c + 1, r + 1)];
    return fx + fz <= 1 ? h00 + (h10 - h00) * fx + (h01 - h00) * fz : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  };
  progress('road', 0.6);

  // ---------- the road: five columns a cross-section ----------
  // (left verge's outer edge on the ground, the left edge, the middle, the right edge, the right verge)
  const cols = [W + V, W, 0, -W, -(W + V)], C = cols.length, rows = closed ? n + 1 : n;
  const positions = new Float32Array(rows * C * 3), colours = new Uint8Array(rows * C * 3);
  const ROAD = [64, 66, 70], VERGE = [92, 98, 84];
  for (let j = 0; j < rows; j++) {
    const i = j % n, lx = tz[i], lz = -tx[i];
    for (let c = 0; c < C; c++) {
      const u = cols[c], x = T.x[i] + lx * u, z = T.z[i] + lz * u;
      // (the verges flat at the edge's height, their outer side down on the ground — never above the edge)
      const y = Math.abs(u) <= W ? surface(i, u) : Math.min(surface(i, u), terrainAt(x, z) + 0.02);
      positions.set([x, y, z], (j * C + c) * 3);
      colours.set(Math.abs(u) <= W ? ROAD : VERGE, (j * C + c) * 3);
    }
  }
  const indices = new Uint32Array((rows - 1) * (C - 1) * 6);
  let q = 0;
  for (let j = 0; j + 1 < rows; j++) for (let c = 0; c + 1 < C; c++) {
    const a = j * C + c, b = a + 1, d = a + C, e = d + 1;
    // (wound so the faces look up: three.js's front side, and the collider's)
    indices.set([a, d, b, b, d, e], q); q += 6;
  }
  fixWinding(positions, indices);

  // ---------- surfaces: the verges, then the road over them ----------
  const pts = [];
  for (let i = 0; i < n; i++) pts.push(r1(T.x[i]), r1(T.z[i]));
  const paintLines = [{ surface: 'verge', half: W + V, points: pts }, { surface: 'tarmac', half: W + 0.3, points: pts }];
  progress('course', 0.75);

  // ---------- the course (Phase 4's route format) ----------
  const P = trackProjection;
  const line = withS(Array.from({ length: rows }, (_, j) => { const i = j % n; return { x: T.x[i], z: T.z[i], h: T.h[i], w: T.width }; }));
  const startS = closed ? clamp(T.start.straight * 0.45, 60, 220) : null;
  const grid = placeGrid(line, { count: GRID.count, loop: closed, startS });
  const checkpoints = autoCheckpoints(line, { loop: closed, startS: grid.startS, finishS: grid.finishS });
  const stats = routeStats(line, { loop: closed });
  const course = {
    kind: closed ? 'loop' : 'p2p', region: 'track', generated: { code: gen.code, version: gen.version, hash: gen.hash },
    waypoints: [], options: routeOptions(), grid: { count: GRID.count, adjust: {}, startS, at: r1(grid.startS), finish: r1(grid.finishS) },
    checkpointMode: 'auto', spacing: CHECKPOINTS.spacing,
    checkpoints: checkpoints.map(cp => { const g = gateAt(line, cp.s, { loop: closed }), [lat, lon] = P.toLatLon(g.x, g.z); return { id: cp.id, s: r1(cp.s), lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, width: null, required: cp.required !== false, timeExtension: 0, auto: true }; }),
    guides: { ...GUIDES }, roads: 'closed', corridor: { margin: Math.round(V + 6) },
    path: encodeLine(line.map(p => { const [lat, lon] = P.toLatLon(p.x, p.z); return { lat, lon, h: p.h, w: p.w }; })),
    length: Math.round(line.at(-1).s), stats, referenceTime: null, roadData: null, review: null,
  };
  progress('racing line', 0.85);
  course.racing = bakeRacing(course, P);
  const slot = grid.slots[0];
  progress('done', 1);
  return {
    build: BUILD_VERSION, code: gen.code, hash: gen.hash, version: gen.version, params: gen.params, stats: gen.track.stats, attempts: gen.attempts, ms: gen.ms,
    closed, length: T.length, width: T.width, verge: V,
    centre: { x: Float32Array.from(T.x), z: Float32Array.from(T.z), h: Float32Array.from(T.h), bank: Float32Array.from(T.bank) },
    road: { positions, indices, colours, columns: C },
    terrain: { n: N, size, heights },
    paintLines, surfaces: cfg.surfaces,
    spawn: { position: [slot.x, surface(nearestIndex(T, slot.x, slot.z), 0) + 0.6, slot.z], headingDeg: slot.heading },
    start: { s: grid.startS, slots: grid.slots.map(s => ({ x: s.x, z: s.z, h: s.h, heading: s.heading })) }, finish: { s: grid.finishS },
    bounds: [x0, z0, x1, z1], course,
  };
}

// every triangle facing up (+y): flipped where the cross product says otherwise
function fixWinding(P, I) {
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vz = P[c + 2] - P[a + 2];
    // (y of u × v: uz·vx − ux·vz)
    if (uz * vx - ux * vz < 0) { const k = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = k; }
  }
}
function nearestIndex(T, x, z) { let best = 0, bd = Infinity; for (let i = 0; i < T.n; i++) { const d = (T.x[i] - x) ** 2 + (T.z[i] - z) ** 2; if (d < bd) { bd = d; best = i; } } return best; }

// the scene description the simulation and the renderer take (physics/track.js: trackShapes, surfaceMap)
export function trackWorld(data) {
  return {
    name: `Track ${data.code}`, generated: data, surfaces: data.surfaces, offRoad: 'grass', paintLines: data.paintLines,
    spawn: data.spawn, roads: [], props: [],
  };
}
