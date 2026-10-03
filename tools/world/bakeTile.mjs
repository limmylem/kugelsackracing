// One tile of the baked world (512 m square of the region's flat frame, world/projection.js): from the
// region's map features and its elevation to everything the game draws and collides with there —
// world/tileFormat.js's meshes, instance lists, grids and height grid.
//
//  1. The roads and the ground under them (realworld/surface.js, as the real world's collision has
//     always been built: each road's smoothed profile, bridges and tunnels, junctions, the ground
//     flattened under every road and sloping back to the natural ground beside it — cuttings and
//     embankments). The ground straight from the elevation data everywhere else.
//  2. Car parks, fuel stations, service areas and driveway areas: a flat plane fitted to the ground
//     there, the ground flattened to it, a surface and kerbs (open where a road meets it), bay lines.
//  3. Water: sea at sea level, lakes and ponds at their shore's level, the ground kept below them.
//  4. The terrain's colours by land use (rock, beach, under water) on its height grid: the game cuts the
//     meshes from the grid itself (world/terrainMesh.js: flat ground in few triangles, hills keeping
//     their shape, in several levels of detail).
//  5. Road markings, buildings, trees, railings and walls (mapped, and where the map usually lacks
//     them: along bridges, motorways, steep drops), street names and junction signs.
//  6. A grid of the surface underfoot every 2 m (tarmac, cobbles, gravel, grass, sand…): tyre grip.

import * as THREE from 'three';
import { buildChunk } from '../../realworld/surface.js';
import { tagsOf } from '../../realworld/mapTiles.js';
import { DRIVABLE } from '../../world/schema.js';
import { extrude, rgb } from './buildings.mjs';
import { clipRing } from './tiler.mjs';

const BAKE_VERSION = 2;
const mulberry = a => () => { a |= 0; a = a + 0x6d2b79f5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const ringArea = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a / 2; };
function inRing(x, z, r) { let inside = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > z) !== (r[j][1] > z) && x < (r[j][0] - r[i][0]) * (z - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside; return inside; }
const inPoly = (x, z, poly) => inRing(x, z, poly[0]) && !poly.slice(1).some(h => inRing(x, z, h));
function triangulate(rings) {
  const v = r => r.map(([x, z]) => new THREE.Vector2(x, z));
  try { return THREE.ShapeUtils.triangulateShape(v(rings[0]), rings.slice(1).map(v)); } catch { return []; }
}

// ---------- a 2 m raster over the tile (cell centres at −255, −253, … +255) ----------
export class Raster {
  constructor(n, cell, half) { this.n = n; this.cell = cell; this.half = half; this.data = new Uint8Array(n * n); }
  // fill the cells whose centres are inside the polygon (rings: [[x, z]…], tile-local)
  fill(poly, value, only = null) {
    const { n, cell, half } = this;
    let z0 = Infinity, z1 = -Infinity;
    for (const [, z] of poly[0]) { z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const r0 = Math.max(0, Math.floor((z0 + half) / cell)), r1 = Math.min(n - 1, Math.ceil((z1 + half) / cell));
    for (let r = r0; r <= r1; r++) {
      const z = -half + (r + 0.5) * cell, xs = [];
      for (const ring of poly) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, az] = ring[j], [bx, bz] = ring[i];
        if ((az > z) !== (bz > z)) xs.push(ax + (z - az) * (bx - ax) / (bz - az));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] + half) / cell - 0.5)), c1 = Math.min(n - 1, Math.floor((xs[k + 1] + half) / cell - 0.5));
        for (let c = c0; c <= c1; c++) if (!only || only(this.data[r * n + c])) this.data[r * n + c] = value;
      }
    }
  }
  at(x, z) { const { n, cell, half } = this, c = Math.max(0, Math.min(n - 1, Math.floor((x + half) / cell))), r = Math.max(0, Math.min(n - 1, Math.floor((z + half) / cell))); return this.data[r * n + c]; }
}

// ---------- mesh parts ----------
class Part {
  constructor(uv = false, surfaces = false) { this.positions = []; this.colours = []; this.uvs = uv ? [] : null; this.indices = []; this.surfaces = surfaces ? [] : null; }
  get empty() { return !this.indices.length; }
  vertex(x, y, z, c, u = 0, v = 0) { this.positions.push(x, y, z); this.colours.push(c[0], c[1], c[2], c[3] ?? 255); if (this.uvs) this.uvs.push(u, v); return this.positions.length / 3 - 1; }
  tri(a, b, c, s = 0) { this.indices.push(a, b, c); if (this.surfaces) this.surfaces.push(s); }
  // (a mostly flat quad always faces up; an upright one as given)
  quad(a, b, c, d, col, s = 0) {
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (ny < 0 && Math.abs(ny) > Math.hypot(nx, nz)) [b, d] = [d, b];
    const i = [a, b, c, d].map(p => this.vertex(p[0], p[1], p[2], col)); this.tri(i[0], i[1], i[2], s); this.tri(i[0], i[2], i[3], s);
  }
  add(other) { const base = this.positions.length / 3; this.positions.push(...other.positions); this.colours.push(...other.colours); if (this.uvs) this.uvs.push(...(other.uvs ?? new Array(other.positions.length / 3 * 2).fill(0))); for (const k of other.indices) this.indices.push(base + k); }
  // (identical vertices welded into one: quads share their corners)
  out() {
    const map = new Map(), pos = [], col = [], uv = this.uvs ? [] : null, remap = new Uint32Array(this.positions.length / 3);
    for (let v = 0; v < remap.length; v++) {
      const key = `${this.positions[v * 3].toFixed(3)},${this.positions[v * 3 + 1].toFixed(3)},${this.positions[v * 3 + 2].toFixed(3)},${this.colours[v * 4]},${this.colours[v * 4 + 1]},${this.colours[v * 4 + 2]}${uv ? `,${this.uvs[v * 2].toFixed(3)},${this.uvs[v * 2 + 1].toFixed(3)}` : ''}`;
      let k = map.get(key);
      if (k === undefined) { k = pos.length / 3; map.set(key, k); pos.push(this.positions[v * 3], this.positions[v * 3 + 1], this.positions[v * 3 + 2]); col.push(this.colours[v * 4], this.colours[v * 4 + 1], this.colours[v * 4 + 2], this.colours[v * 4 + 3]); if (uv) uv.push(this.uvs[v * 2], this.uvs[v * 2 + 1]); }
      remap[v] = k;
    }
    return { positions: Float32Array.from(pos), colours: Uint8Array.from(col), ...(uv && { uvs: Float32Array.from(uv) }), indices: Uint32Array.from(this.indices, v => remap[v]), ...(this.surfaces && { surfaces: Uint8Array.from(this.surfaces) }) };
  }
}

export async function bakeTile({ i, j, P, index, dem, cfg, regionId }) {
  const T = cfg.tileSize, half = T / 2, cell = cfg.cell, n = T / cell, N1 = n + 1, cx = (i + 0.5) * T, cz = (j + 0.5) * T, t0 = performance.now();
  const C = cfg.colours, pal = Object.fromEntries(Object.entries(C).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, rgb(v)]));
  const local = ([x, z]) => [x - cx, z - cz];
  const reach = 420;
  // ---- the map round the tile ----
  const near = index.query(cx - half - reach, cz - half - reach, cx + half + reach, cz + half + reach);
  const inTile = (x, z) => x >= -half && x < half && z >= -half && z < half;
  const meets = f => f.bbox[2] >= cx - half - 2 && f.bbox[0] <= cx + half + 2 && f.bbox[3] >= cz - half - 2 && f.bbox[1] <= cz + half + 2;
  // ---- the elevation round it ----
  const [lat0, lon0] = P.toLatLon(cx - half - reach - 60, cz + half + reach + 60), [lat1, lon1] = P.toLatLon(cx + half + reach + 60, cz - half - reach - 60);
  const ground = await dem.sampler([lat0, lon0, lat1, lon1]);
  const terrain = (lat, lon) => ground.height(lat, lon);

  // ---------- 1. roads, and the ground shaped round them ----------
  const coordKey = ([lon, lat]) => `${lon.toFixed(7)},${lat.toFixed(7)}`;
  const roads = [];
  for (const f of near) {
    if (f.layer !== 'roads' || !DRIVABLE.has(f.props.k) || f.geometry.type !== 'LineString') continue;
    const c = f.geometry.coordinates;
    roads.push({ id: f.id, nodes: c.map(coordKey), lat: Float64Array.from(c, p => p[1]), lon: Float64Array.from(c, p => p[0]), tags: tagsOf(f.props), props: f.props });
  }
  const projection = { size: T, toXZ: (lat, lon) => local(P.toXZ(lat, lon)), toLatLon: (x, z) => P.toLatLon(x + cx, z + cz) };
  const built = buildChunk({ chunk: { key: `${i}_${j}`, latC: P.toLatLon(cx, cz)[0], lonC: P.toLatLon(cx, cz)[1] }, terrain, roads, options: { projection, cell, overlap: 0, keepWays: true, parapet: 0, sink: cfg.terrain.underRoad, skirtDrop: cfg.terrain.skirtDrop } });
  const heights = built.heightfield.heights, idx = (c, r) => r + c * N1;
  const natural = (x, z) => built.groundAt(x, z);
  // (the ground as baked so far, between grid points)
  const groundAt = (x, z) => {
    const fc = Math.max(0, Math.min(n - 1e-6, (x + half) / cell)), fr = Math.max(0, Math.min(n - 1e-6, (z + half) / cell)), c = Math.floor(fc), r = Math.floor(fr), tx = fc - c, tz = fr - r;
    return (heights[idx(c, r)] * (1 - tx) + heights[idx(c + 1, r)] * tx) * (1 - tz) + (heights[idx(c, r + 1)] * (1 - tx) + heights[idx(c + 1, r + 1)] * tx) * tz;
  };
  // which grid points the roads changed (the rest is the natural ground)
  const shaped = new Uint8Array(N1 * N1);
  for (let c = 0; c <= n; c++) for (let r = 0; r <= n; r++) if (Math.abs(heights[idx(c, r)] - natural(-half + c * cell, -half + r * cell)) > 0.02) shaped[idx(c, r)] = 1;

  // ---------- classes of ground (2 m), for colours, surfaces, trees ----------
  const classes = ['default'], classOf = name => { let k = classes.indexOf(name); if (k < 0) { k = classes.length; classes.push(name); } return k; };
  const ground_ = new Raster(n, cell, half);
  const polysOf = f => f.geometry.type === 'Polygon' ? [f.xy] : f.geometry.type === 'MultiPolygon' ? f.xy : [];
  const clipped = f => polysOf(f).map(poly => poly.map(r => clipRing(r.map(local), [-half - 4, -half - 4, half + 4, half + 4])).filter(Boolean)).filter(p => p.length && p[0]);
  const areaOf = f => polysOf(f).reduce((a, p) => a + Math.abs(ringArea(p[0])), 0);
  for (const layer of ['cover', 'landuse']) {
    for (const f of near.filter(f => f.layer === layer && meets(f) && pal[f.props.k]).sort((a, b) => areaOf(b) - areaOf(a)))
      for (const poly of clipped(f)) ground_.fill(poly, classOf(f.props.k));
  }
  // ---------- 3. water ----------
  const water = new Part(), waterPolys = [];
  for (const f of near.filter(f => f.layer === 'water' && meets(f) && f.type === 'area')) {
    const k = f.props.k, sea = ['ocean', 'sea', 'bay'].includes(k);
    // (lakes at their shore: the lowest tenth of the ground round the edge)
    let level = 0;
    if (!sea) { const hs = polysOf(f)[0][0].filter((_, q, a) => q % Math.max(1, Math.floor(a.length / 60)) === 0).map(p => natural(...local(p))).filter(Number.isFinite).sort((a, b) => a - b); level = hs.length ? hs[Math.floor(hs.length * 0.1)] : 0; }
    if (k === 'pool') level = groundAt(...local(polysOf(f)[0][0][0])) + 0.05;
    for (const poly of clipped(f)) {
      ground_.fill(poly, classOf('water'));
      waterPolys.push({ poly, level });
      const tris = triangulate(poly), pts = poly.flat(), base = water.positions.length / 3;
      for (const [x, z] of pts) water.vertex(x, level, z, pal.water);
      for (const [a, b, c] of tris) water.tri(base + a, base + c, base + b);
    }
  }
  // the ground kept under the water (where no road shaped it)
  for (const { poly, level } of waterPolys) for (let c = 0; c <= n; c++) for (let r = 0; r <= n; r++) {
    const k = idx(c, r);
    if (!shaped[k] && heights[k] > level - cfg.terrain.waterDepth && inPoly(-half + c * cell, -half + r * cell, poly)) heights[k] = level - cfg.terrain.waterDepth;
  }

  // ---------- 2. car parks and other paved areas ----------
  const paved = new Part(false, true), markings = new Part(), surfaceNames = ['tarmac', 'kerb', 'concrete', 'cobbles', 'gravel', 'dirt', 'grass', 'sand'], sCode = s => Math.max(0, surfaceNames.indexOf(s));
  const roadEdges = [];          // segments of road edge (for kerbs left open where a road meets a car park)
  for (const w of built.ways) for (let q = 0; q + 1 < w.points.length; q++) roadEdges.push([w.points[q][0], w.points[q][2], w.points[q + 1][0], w.points[q + 1][2], w.info.halfWidth]);
  const nearRoad = (x, z, extra) => roadEdges.some(([ax, az, bx, bz, hw]) => { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)); return Math.hypot(x - ax - dx * t, z - az - dz * t) < hw + extra; });
  const asphalt = rgb(cfg.roads.asphalt), kerbC = [190, 188, 182], lineC = rgb(cfg.roads.lineColour);
  const pavedKinds = new Set(['parking', 'fuel', 'services', 'rest_area', 'driveway']);
  const bays = near.filter(f => f.layer === 'paved' && f.props.k === 'bay' && f.type === 'area');
  for (const f of near.filter(f => f.layer === 'paved' && pavedKinds.has(f.props.k) && f.type === 'area' && meets(f))) {
    if (f.props.pk && !['surface', 'rooftop', 'lane', 'street_side'].includes(f.props.pk) && f.props.k === 'parking') continue;
    for (const polyW of polysOf(f)) {
      const poly = polyW.map(r => r.map(local));
      // the plane: fitted to the natural ground over the whole area (the same in every tile it's in)
      let sx = 0, sz = 0, sy = 0, sxx = 0, szz = 0, sxz = 0, sxy = 0, szy = 0, m = 0;
      const [bx0, bz0, bx1, bz1] = [Math.min(...poly[0].map(p => p[0])), Math.min(...poly[0].map(p => p[1])), Math.max(...poly[0].map(p => p[0])), Math.max(...poly[0].map(p => p[1]))];
      const step = Math.max(3, Math.sqrt((bx1 - bx0) * (bz1 - bz0) / 400));
      for (let x = bx0 + step / 2; x < bx1; x += step) for (let z = bz0 + step / 2; z < bz1; z += step) {
        if (!inPoly(x, z, poly)) continue;
        const y = natural(x, z); if (!Number.isFinite(y)) continue;
        sx += x; sz += z; sy += y; sxx += x * x; szz += z * z; sxz += x * z; sxy += x * y; szy += z * y; m++;
      }
      if (m < 3) continue;
      const mx = sx / m, mz = sz / m, my = sy / m, cxx = sxx / m - mx * mx, czz = szz / m - mz * mz, cxz = sxz / m - mx * mz, cxy = sxy / m - mx * my, czy = szy / m - mz * my, det = cxx * czz - cxz * cxz;
      let gx = Math.abs(det) > 1e-6 ? (cxy * czz - czy * cxz) / det : 0, gz = Math.abs(det) > 1e-6 ? (czy * cxx - cxy * cxz) / det : 0;
      const g = Math.hypot(gx, gz); if (g > 0.08) { gx *= 0.08 / g; gz *= 0.08 / g; }
      const plane = (x, z) => my + gx * (x - mx) + gz * (z - mz), lift = 0.02;
      // the ground flattened to it, easing back over 4 m
      for (let c = 0; c <= n; c++) for (let r = 0; r <= n; r++) {
        const x = -half + c * cell, z = -half + r * cell, k = idx(c, r);
        if (x < bx0 - 6 || x > bx1 + 6 || z < bz0 - 6 || z > bz1 + 6) continue;
        if (inPoly(x, z, poly)) { if (!shaped[k] || heights[k] > plane(x, z) - 0.03) heights[k] = plane(x, z) - 0.03; shaped[k] = 1; continue; }
        if (shaped[k]) continue;
        let d = Infinity;
        for (const ring of poly) for (let q = 0, p = ring.length - 1; q < ring.length; p = q++) { const [ax, az] = ring[p], [ex, ez] = ring[q], dx = ex - ax, dz = ez - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)); d = Math.min(d, Math.hypot(x - ax - dx * t, z - az - dz * t)); }
        if (d < 4) { const w = 1 - d / 4; heights[k] += (plane(x, z) - 0.03 - heights[k]) * w * w * (3 - 2 * w); }
      }
      // the surface (the triangles whose middle is in this tile) and its kerbs (not where a road meets it)
      const tris = triangulate(poly), pts = poly.flat(), base = paved.positions.length / 3, surf = sCode(cfg.roadSurfaces[f.props.sf] ?? 'tarmac');
      for (const [x, z] of pts) paved.vertex(x, plane(x, z) + lift, z, asphalt);
      for (const [a, b, c] of tris) { const mxx = (pts[a][0] + pts[b][0] + pts[c][0]) / 3, mzz = (pts[a][1] + pts[b][1] + pts[c][1]) / 3; if (inTile(mxx, mzz)) paved.tri(base + a, base + c, base + b, surf); }
      for (const ring of poly) for (let q = 0, p = ring.length - 1; q < ring.length; p = q++) {
        const [ax, az] = ring[p], [ex, ez] = ring[q], l = Math.hypot(ex - ax, ez - az);
        if (l < 0.3 || !inTile((ax + ex) / 2, (az + ez) / 2)) continue;
        for (let s = 0; s < l; s += 3) {
          const s1 = Math.min(l, s + 3), x0 = ax + (ex - ax) * s / l, z0 = az + (ez - az) * s / l, x1 = ax + (ex - ax) * s1 / l, z1 = az + (ez - az) * s1 / l;
          if (nearRoad((x0 + x1) / 2, (z0 + z1) / 2, 1.5)) continue;
          // a kerb: a low step along the edge, its face outwards
          const ox = (z1 - z0) / (s1 - s || 1) * 0.15, oz = -(x1 - x0) / (s1 - s || 1) * 0.15, y0 = plane(x0, z0) + lift, y1 = plane(x1, z1) + lift, H = cfg.roads.kerbHeight;
          const kerb = [[x0, y0, z0], [x1, y1, z1], [x1, y1 + H, z1], [x0, y0 + H, z0]];
          paved.quad(kerb[0], kerb[1], kerb[2], kerb[3], kerbC, sCode('kerb'));
          paved.quad(kerb[3], kerb[2], [x1 + ox, y1 + H, z1 + oz], [x0 + ox, y0 + H, z0 + oz], kerbC, sCode('kerb'));
        }
      }
      // bay lines: each parking space's outline, painted
      for (const b of bays) {
        const ring = b.xy[0]?.map(local);
        if (!ring || !inTile(ring[0][0], ring[0][1]) || !inPoly(ring[0][0], ring[0][1], poly)) continue;
        for (let q = 0, p = ring.length - 1; q < ring.length; p = q++) {
          const [ax, az] = ring[p], [ex, ez] = ring[q], l = Math.hypot(ex - ax, ez - az);
          if (l < 0.5) continue;
          const nx = -(ez - az) / l * 0.06, nz = (ex - ax) / l * 0.06, ya = plane(ax, az) + lift + 0.012, ye = plane(ex, ez) + lift + 0.012;
          markings.quad([ax - nx, ya, az - nz], [ex - nx, ye, ez - nz], [ex + nx, ye, ez + nz], [ax + nx, ya, az + nz], lineC);
        }
      }
      ground_.fill(poly, classOf('parking'));
    }
  }
  for (const f of near.filter(f => f.layer === 'paved' && f.props.k === 'plaza' && f.type === 'area' && meets(f))) for (const poly of clipped(f)) ground_.fill(poly, classOf('plaza'));

  // ---------- road surfaces, markings ----------
  const roadPart = new Part(false, true), RM = built.meshes.roads, surfColour = s => rgb(cfg.roads[cfg.roadSurfaces[s] === 'tarmac' ? 'asphalt' : cfg.roadSurfaces[s]] ?? cfg.roads.asphalt);
  for (let t = 0; t < RM.indices.length / 3; t++) {
    const name = built.surfaces[RM.surfaces[t]] ?? 'asphalt', col = surfColour(name), ids = [];
    for (let q = 0; q < 3; q++) { const v = RM.indices[t * 3 + q]; ids.push(roadPart.vertex(RM.vertices[v * 3], RM.vertices[v * 3 + 1], RM.vertices[v * 3 + 2], col)); }
    roadPart.tri(ids[0], ids[2], ids[1], sCode(cfg.roadSurfaces[name] ?? 'tarmac'));
  }
  const centreC = rgb(cfg.roads.centreColour), R = cfg.roads;
  for (const w of built.ways) {
    const info = w.info, P_ = w.sections, m = w.points.length, kind = info.highway?.replace(/_link$/, '');
    if (info.kind === 'tunnel' && w.tunnel?.some(Boolean)) continue;
    const at = (q, k) => [P_[q * 15 + k * 3], P_[q * 15 + k * 3 + 1] + 0.015, P_[q * 15 + k * 3 + 2]];
    // a point across the road at q: t 0 at one edge, ½ on the crown, 1 at the other (the camber's two planes)
    const across = (q, t) => { const [a, b, u] = t < 0.5 ? [at(q, 1), at(q, 2), t * 2] : [at(q, 2), at(q, 3), t * 2 - 1]; return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]; };
    // (no markings across junctions)
    const s = [0]; for (let q = 1; q < m; q++) s.push(s[q - 1] + Math.hypot(w.points[q][0] - w.points[q - 1][0], w.points[q][2] - w.points[q - 1][2]));
    const junctionS = s.filter((_, q) => w.junctions[q]);
    const clear = sv => !junctionS.some(js => Math.abs(js - sv) < 9);
    const stripe = (t, col, dashed) => {
      for (let q = 0; q + 1 < m; q++) {
        const a = across(q, t), b = across(q + 1, t), mid = (s[q] + s[q + 1]) / 2;
        if (!inTile((a[0] + b[0]) / 2, (a[2] + b[2]) / 2) || !clear(mid)) continue;
        if (dashed && (mid % (R.dash + R.gap)) > R.dash) continue;
        const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1, nx = -dz / l * R.line / 2, nz = dx / l * R.line / 2;
        markings.quad([a[0] - nx, a[1], a[2] - nz], [b[0] - nx, b[1], b[2] - nz], [b[0] + nx, b[1], b[2] + nz], [a[0] + nx, a[1], a[2] + nz], col);
      }
    };
    const W = info.width;
    if (R.centreLines.includes(kind) && !info.oneway && W >= 5.5) stripe(0.5, centreC, kind === 'residential' || kind === 'unclassified');
    if (R.edgeLines.includes(kind)) { const inset = Math.min(0.35 / W, 0.1); stripe(inset, lineC, false); stripe(1 - inset, lineC, false); }
    // lanes: a one-way road wide enough for more than one, or a two-way one with more than one each way
    if (!['residential', 'service', 'unclassified', 'track', 'living_street'].includes(kind)) {
      if (info.oneway && W >= 6.4) { const n = Math.max(2, Math.round(W / 3.5)); for (let k = 1; k < n; k++) stripe(k / n, lineC, true); }
      else if (!info.oneway && W >= 12) { const n = Math.round(W / 2 / 3.5); for (let k = 1; k < 2 * n; k++) if (k !== n) stripe(k / (2 * n), lineC, true); }
    }
  }
  // roads' cells: their surface (ribbons rasterised at their edges)
  const roadCells = new Raster(n, cell, half), roadSurf = new Raster(n, cell, half);
  for (const w of built.ways) {
    const P_ = w.sections, m = w.points.length, code = sCode(cfg.roadSurfaces[w.info.surface] ?? 'tarmac') + 1;
    if (w.info.kind === 'bridge' || (w.info.kind === 'tunnel')) continue;
    for (let q = 0; q + 1 < m; q++) {
      const quad = [[P_[q * 15 + 3], P_[q * 15 + 5]], [P_[(q + 1) * 15 + 3], P_[(q + 1) * 15 + 5]], [P_[(q + 1) * 15 + 9], P_[(q + 1) * 15 + 11]], [P_[q * 15 + 9], P_[q * 15 + 11]]];
      roadCells.fill([quad], 1); roadSurf.fill([quad], code);
    }
  }

  // ---------- footpaths: mapped pavements and paths, raised a kerb's height where they're pavements ----------
  const paths = new Part(false, true), pathC = [186, 183, 175], trackC = [176, 160, 128], PATHS = new Set(['footway', 'path', 'pedestrian', 'cycleway', 'bridleway']);
  for (const f of near) {
    if (f.layer !== 'roads' || !PATHS.has(f.props.k) || f.type !== 'line' || f.props.tn || f.props.br || !meets(f)) continue;
    const pave = f.props.s === 'sidewalk', width = f.props.w ?? (pave ? R.footpath : f.props.k === 'cycleway' ? 2 : 1.8), raise = pave ? R.kerbHeight : 0.05, hw = width / 2;
    const soft = ['dirt', 'gravel', 'grass', 'sand', 'unpaved', 'compacted'].includes(f.props.sf), col = soft ? trackC : pathC, surf = sCode(soft ? 'gravel' : 'concrete');
    for (const line of f.xy) for (let q = 0; q + 1 < line.length; q++) {
      const [ax, az] = local(line[q]), [bx, bz] = local(line[q + 1]), l = Math.hypot(bx - ax, bz - az), parts = Math.max(1, Math.ceil(l / 6));
      if (l < 0.2) continue;
      const nx = -(bz - az) / l * hw, nz = (bx - ax) / l * hw;
      for (let p = 0; p < parts; p++) {
        const x0 = ax + (bx - ax) * p / parts, z0 = az + (bz - az) * p / parts, x1 = ax + (bx - ax) * (p + 1) / parts, z1 = az + (bz - az) * (p + 1) / parts;
        if (!inTile((x0 + x1) / 2, (z0 + z1) / 2)) continue;
        // (not where it crosses or runs onto a road: the road's surface is the crossing)
        if ([[x0, z0], [x1, z1], [(x0 + x1) / 2, (z0 + z1) / 2]].some(([x, z]) => roadCells.at(x, z) || roadCells.at(x + nx, z + nz) || roadCells.at(x - nx, z - nz))) continue;
        const y0 = groundAt(x0, z0), y1 = groundAt(x1, z1), A = [x0 - nx, y0 + raise, z0 - nz], B = [x1 - nx, y1 + raise, z1 - nz], Cc = [x1 + nx, y1 + raise, z1 + nz], D = [x0 + nx, y0 + raise, z0 + nz];
        paths.quad(A, B, Cc, D, col, surf);
        if (pave) { paths.quad([A[0], y0 - 0.05, A[2]], [B[0], y1 - 0.05, B[2]], B, A, kerbC, sCode('kerb')); paths.quad(D, Cc, [Cc[0], y1 - 0.05, Cc[2]], [D[0], y0 - 0.05, D[2]], kerbC, sCode('kerb')); }
      }
    }
  }

  // ---------- 4. terrain ----------
  // (the heights to the centimetre, as the file keeps them: the game cuts its meshes from exactly the
  // grid the physics gets)
  for (let k = 0; k < heights.length; k++) heights[k] = Math.round(heights[k] * 100) / 100;
  const waterClass = classes.indexOf('water'), nearWater = (x, z) => waterClass > 0 && [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4], [6, 6], [-6, -6], [6, -6], [-6, 6]].some(([dx, dz]) => ground_.at(x + dx, z + dz) === waterClass);
  const terrainColour = (x, z, c, r) => {
    const k = ground_.at(x, z), name = classes[k];
    let col = pal[name] ?? pal.default;
    // steep natural ground: rock
    if (!shaped[idx(c, r)] && name !== 'water') {
      const c0 = Math.max(0, c - 1), c1 = Math.min(n, c + 1), r0 = Math.max(0, r - 1), r1 = Math.min(n, r + 1);
      const slope = Math.hypot((heights[idx(c1, r)] - heights[idx(c0, r)]) / ((c1 - c0) * cell), (heights[idx(c, r1)] - heights[idx(c, r0)]) / ((r1 - r0) * cell));
      if (slope > cfg.terrain.rockSlope) col = pal.rock;
    }
    if (name === 'water') col = pal.underwater;
    else if (!shaped[idx(c, r)] && heights[idx(c, r)] < 2 && nearWater(x, z)) col = pal.beach;
    return col;
  };
  // (the meshes themselves are cut where the tile is read — world/terrainMesh.js — from the heights and
  // this grid of each point's colour, an index into the tile's terrain palette)
  const terrainPalette = [], paletteIndex = new Map(), terrainGrid = new Uint8Array(N1 * N1);
  for (let r = 0; r <= n; r++) for (let c = 0; c <= n; c++) {
    const x = -half + c * cell, z = -half + r * cell, col = terrainColour(x, z, c, r), key = col.slice(0, 3).join(',');
    if (!paletteIndex.has(key)) { paletteIndex.set(key, terrainPalette.length); terrainPalette.push(col.slice(0, 3)); }
    terrainGrid[r * N1 + c] = paletteIndex.get(key);
  }
  // tunnel roofs (the ground over a tunnel): drawn as ground, and solid
  const cover = new Part(false, true);
  { const CM = built.meshes.cover; for (let t = 0; t < CM.indices.length / 3; t++) { const ids = []; for (let q = 0; q < 3; q++) { const v = CM.indices[t * 3 + q]; ids.push(cover.vertex(CM.vertices[v * 3], CM.vertices[v * 3 + 1], CM.vertices[v * 3 + 2], pal.default)); } cover.tri(ids[0], ids[2], ids[1], sCode('grass')); } }

  // ---------- 5. buildings ----------
  const wallsBy = {}, roofs = new Part(), hulls = [], landmarks = [], buildingMask = new Raster(n, cell, half);
  let buildingCount = 0;
  const bCfg = { ...cfg.buildings };
  const blds = near.filter(f => f.layer === 'buildings' && f.type === 'area' && !f.props.hp);
  for (const f of blds) {
    for (const polyW of polysOf(f)) {
      const poly = polyW.map(r => r.map(local));
      let mx = 0, mz = 0; for (const [x, z] of poly[0]) { mx += x; mz += z; } mx /= poly[0].length; mz /= poly[0].length;
      if (!inTile(mx, mz)) continue;
      const b = extrude({ id: f.id, rings: poly, props: f.props }, groundAt, bCfg);
      if (!b) continue;
      buildingCount++;
      (wallsBy[b.windows] ??= new Part(true)).add(b.walls);
      roofs.add(b.roof);
      for (const h of b.hulls) hulls.push(h);
      buildingMask.fill(poly, 1);
      if (b.landmark) landmarks.push({ id: f.id, centre: b.centre, top: b.top, height: b.height });
    }
  }

  // ---------- trees ----------
  const rand = mulberry(i * 73856093 ^ j * 19349663), trees = [];
  const treeAt = (x, z, kind, s) => { if (!inTile(x, z) || roadCells.at(x, z) || buildingMask.at(x, z) || classes[ground_.at(x, z)] === 'water' || classes[ground_.at(x, z)] === 'parking') return; trees.push(x, groundAt(x, z), z, s, kind); };
  for (const f of near) {
    if (f.layer !== 'details') continue;
    if (f.props.k === 'tree' && f.type === 'point') { const [x, z] = local(f.xy); treeAt(x, z, rand() < 0.2 ? 1 : 0, (f.props.h ?? 8) / 8 * (0.85 + rand() * 0.3)); }
    if (f.props.k === 'tree_row' && f.type === 'line') for (const line of f.xy) for (let q = 0; q + 1 < line.length; q++) {
      const [ax, az] = local(line[q]), [bx, bz] = local(line[q + 1]), l = Math.hypot(bx - ax, bz - az);
      for (let s = 0; s < l; s += cfg.trees.spacing) treeAt(ax + (bx - ax) * s / l, az + (bz - az) * s / l, 0, 0.8 + rand() * 0.4);
    }
  }
  // woods and parks filled
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const name = classes[ground_.data[r * n + c]], d = cfg.trees.density[name];
    if (!d || trees.length / 5 >= cfg.trees.maxPerTile) continue;
    if (rand() < d * cell * cell / 10000) treeAt(-half + (c + rand()) * cell, -half + (r + rand()) * cell, name === 'forest' || name === 'wood' ? (rand() < 0.6 ? 1 : 0) : 0, 0.8 + rand() * 0.5);
  }

  // ---------- railings and walls ----------
  const B = cfg.barriers, barriers = {};
  // each piece: [x0, y0, z0, x1, y1, z1, h] — its foot at both ends and how tall it stands there
  const addPiece = (type, a, b, h = B.types[type].height) => { if (!inTile((a[0] + b[0]) / 2, (a[2] + b[2]) / 2)) return; (barriers[type] ??= []).push(a[0], a[1], a[2], b[0], b[1], b[2], h); };
  // a mapped one on uneven ground: as tall as it is above the higher side (where a car would come off
  // the top), walls also reaching down to the lower side (no gap under them)
  const WALLS = new Set(['wall', 'retaining_wall', 'city_wall', 'parapet', 'jersey_barrier']);
  const onGround = (type, x0, z0, x1, z1) => {
    const l = Math.hypot(x1 - x0, z1 - z0) || 1, nx = -(z1 - z0) / l, nz = (x1 - x0) / l, d = Math.max(1.2, B.types[type].thickness / 2 + 0.8);
    // (a wall holds the ground back: its high side is looked for further out, where the mapped line and
    // the step in the elevation data don't quite agree)
    const reach = WALLS.has(type) ? [d, 2.5, 4] : [d];
    const end = (x, z) => { const line = groundAt(x, z), sides = reach.flatMap(r => [groundAt(x + nx * r, z + nz * r), groundAt(x - nx * r, z - nz * r)]); return { foot: WALLS.has(type) ? Math.min(line, ...sides.slice(0, 2)) : line, top: Math.max(line, ...sides) }; };
    const A = end(x0, z0), Bb = end(x1, z1), H = B.types[type].height, h = Math.min(H + 4, Math.max(A.top - A.foot, Bb.top - Bb.foot) + H);
    addPiece(type, [x0, A.foot, z0], [x1, Bb.foot, z1], h);
  };
  // mapped ones, on the ground, in pieces of at most 4 m (following its rises and dips)
  for (const f of near) {
    if (f.layer !== 'details' || f.type !== 'line' || !B.types[f.props.k] || !meets(f)) continue;
    for (const line of f.xy) for (let q = 0; q + 1 < line.length; q++) {
      const [ax, az] = local(line[q]), [bx, bz] = local(line[q + 1]), l = Math.hypot(bx - ax, bz - az), parts = Math.max(1, Math.ceil(l / 4));
      for (let p = 0; p < parts; p++) {
        const x0 = ax + (bx - ax) * p / parts, z0 = az + (bz - az) * p / parts, x1 = ax + (bx - ax) * (p + 1) / parts, z1 = az + (bz - az) * (p + 1) / parts;
        onGround(f.props.k, x0, z0, x1, z1);
      }
    }
  }
  // the ones the map usually lacks: bridge sides, motorway edges, beside drops
  for (const w of built.ways) {
    const info = w.info, P_ = w.sections, m = w.points.length;
    if (m < 2) continue;
    const s = [0]; for (let q = 1; q < m; q++) s.push(s[q - 1] + Math.hypot(w.points[q][0] - w.points[q - 1][0], w.points[q][2] - w.points[q - 1][2]));
    const junctionS = s.filter((_, q) => w.junctions[q]), awayFromJunctions = sv => !junctionS.some(js => Math.abs(js - sv) < B.auto.skipNearJunction);
    const edge = (q, side) => { const e = side ? 3 : 1, o = side ? 4 : 0, x = P_[q * 15 + e * 3], y = P_[q * 15 + e * 3 + 1], z = P_[q * 15 + e * 3 + 2], dx = P_[q * 15 + o * 3] - x, dz = P_[q * 15 + o * 3 + 2] - z, l = Math.hypot(dx, dz) || 1; return [x + dx / l * B.auto.offset, y, z + dz / l * B.auto.offset]; };
    for (const side of [0, 1]) {
      let run = [];
      const flush = type => { if (run.length >= 2 && (type !== 'guard_rail' || s[run.at(-1)] - s[run[0]] >= B.auto.minRun)) for (let q = 0; q + 1 < run.length; q++) addPiece(type, edge(run[q], side), edge(run[q + 1], side)); run = []; };
      let type = null;
      for (let q = 0; q < m; q++) {
        let want = null;
        if (info.kind === 'bridge' && B.auto.bridges) want = 'parapet';
        else if (info.kind === 'ground') {
          const motorway = B.auto.motorways.includes(info.highway) && awayFromJunctions(s[q]);
          const [ex, ey, ez] = edge(q, side), [x0, , z0] = [w.points[q][0], 0, w.points[q][2]], dx = ex - x0, dz = ez - z0, l = Math.hypot(dx, dz) || 1;
          const below = natural(ex + dx / l * B.auto.reach, ez + dz / l * B.auto.reach);
          const drop = Number.isFinite(below) && ey - below > B.auto.drop && awayFromJunctions(s[q]);
          if (motorway || drop) want = 'guard_rail';
        }
        if (want !== type) { if (type) { if (want) run.push(q); flush(type); } type = want; }
        if (type) run.push(q);
      }
      if (type) flush(type);
    }
  }

  // ---------- labels: street names along the roads, signs at junctions ----------
  const names = [], nameOf = s => { let k = names.indexOf(s); if (k < 0) { k = names.length; names.push(s); } return k; };
  const labels = [], streets = [], signs = [];
  for (const w of built.ways) {
    const name = w.info.name, m = w.points.length;
    if (!name || w.info.kind === 'tunnel') continue;
    const k = nameOf(name), s = [0];
    for (let q = 1; q < m; q++) s.push(s[q - 1] + Math.hypot(w.points[q][0] - w.points[q - 1][0], w.points[q][2] - w.points[q - 1][2]));
    for (let q = 0; q + 1 < m; q++) { const [ax, , az] = w.points[q], [bx, , bz] = w.points[q + 1]; if (inTile((ax + bx) / 2, (az + bz) / 2)) streets.push(ax, az, bx, bz, k, w.info.rank); }
    if (s.at(-1) < cfg.labels.minLength) continue;
    for (let at = cfg.labels.every / 2; at < s.at(-1); at += cfg.labels.every) {
      const q = s.findIndex(v => v >= at), a = w.points[Math.max(0, q - 1)], b = w.points[q];
      if (!b || !inTile(b[0], b[2])) continue;
      labels.push(b[0], b[1] + 0.05, b[2], Math.atan2(-(b[2] - a[2]), b[0] - a[0]), k, w.info.halfWidth);
    }
  }
  // junctions of two named roads: a sign on the corner
  const seenJ = new Set();
  for (const w of built.ways) {
    if (!w.info.name || w.info.kind !== 'ground') continue;
    w.points.forEach((p, q) => {
      if (!w.junctions[q] || !inTile(p[0], p[2])) return;
      const key = `${p[0].toFixed(1)},${p[2].toFixed(1)}`;
      if (seenJ.has(key)) return;
      const others = built.ways.filter(o => o !== w && o.info.name && o.info.name !== w.info.name && o.points.some(op => Math.hypot(op[0] - p[0], op[2] - p[2]) < 0.5));
      if (!others.length) return;
      seenJ.add(key);
      const a = w.points[Math.max(0, q - 1)], b = w.points[Math.min(w.points.length - 1, q + 1)], ang = Math.atan2(-(b[2] - a[2]), b[0] - a[0]), off = w.info.halfWidth + others[0].info.halfWidth * 0 + 2.2;
      const sx = p[0] + Math.cos(ang + Math.PI / 4) * off, sz = p[2] - Math.sin(ang + Math.PI / 4) * off;
      signs.push(sx, groundAt(sx, sz), sz, ang, nameOf(w.info.name), nameOf(others[0].info.name));
    });
  }

  // ---------- 6. the surface underfoot (2 m) ----------
  const surface = new Uint8Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const k = r * n + c, rs = roadSurf.data[k];
    if (rs) { surface[k] = rs - 1; continue; }
    const name = classes[ground_.data[k]];
    surface[k] = name === 'parking' || name === 'plaza' ? sCode('tarmac') : sCode(cfg.groundSurfaces[name] ?? 'grass');
  }

  // ---------- the tile ----------
  const meshes = {
    ...(!roadPart.empty && { roads: roadPart.out() }), ...(!paved.empty && { paved: paved.out() }), ...(!paths.empty && { paths: paths.out() }), ...(!cover.empty && { cover: cover.out() }),
    ...(!markings.empty && { markings: markings.out() }), ...(!water.empty && { water: water.out() }), ...(!roofs.empty && { roofs: roofs.out() }),
    ...Object.fromEntries(Object.entries(wallsBy).map(([k, p]) => [`walls_${k}`, p.out()])),
  };
  // building colliders: [pointCount, y0, y1, x, z, x, z, …] one after another
  const hullData = [];
  for (const h of hulls) hullData.push(h.points.length / 2, h.y0, h.y1, ...h.points);
  // (coordinates to 2 cm — counts and name indices are whole numbers, unharmed; labels and signs carry
  // angles, kept as floats)
  const Q = 0.02;
  const lists = {
    trees: { stride: 5, quantum: Q, data: Float32Array.from(trees) },
    hulls: { stride: 1, quantum: Q, data: Float32Array.from(hullData) },
    labels: { stride: 6, data: Float32Array.from(labels) },
    signs: { stride: 6, data: Float32Array.from(signs) },
    streets: { stride: 6, quantum: Q, data: Float32Array.from(streets) },
    ...Object.fromEntries(Object.entries(barriers).map(([k, v]) => [`barrier_${k}`, { stride: 7, quantum: 0.01, data: Float32Array.from(v) }])),
  };
  // (the elevation's own resolution at the tile's middle)
  const [latC, lonC] = P.toLatLon(cx, cz);
  const header = {
    region: regionId, key: `${i}_${j}`, i, j, size: T, centre: [cx, cz], bake: BAKE_VERSION, dem: ground.sourceAt(latC, lonC), names, landmarks,
    terrain: { palette: terrainPalette, lodErrors: cfg.terrain.lodErrors },
    stats: { roads: built.stats.roads, buildings: buildingCount, trees: trees.length / 5, barriers: Object.fromEntries(Object.entries(barriers).map(([k, v]) => [k, v.length / 7])), ms: Math.round(performance.now() - t0) },
  };
  return { header, meshes, lists, grids: { surface: { n, cell, names: surfaceNames, data: surface }, terrain: { n: N1, cell, data: terrainGrid } }, heightfield: { n, size: T, heights, quantum: 0.01 } };
}
export { BAKE_VERSION };
