// Features (longitude / latitude, world/schema.js layers) → vector tiles for each zoom of the world's
// pyramid (world/tiles.js), by ZOOM_RULES: lines and areas cut exactly at the tile edges — a road
// crossing an edge ends at the same point in both tiles, so the game joins it back up seamlessly; a
// building goes whole into the tile its middle is in (it may reach past the edge: drawn and collided
// whole, never cut in two); points into the tile they're in. Simplified for the distance, and areas
// too small to see there left out.
//
//   tileFeatures(features, { zooms, bbox }) → Map('z/x/y' → { z, x, y, layers: { name: [feature] } })
//   (features as world/mvt.js encodeTile takes them: tile units, properties)

import { lonLatToTile, metresPerUnit, tileToLonLat } from '../../world/tiles.js';
import { LAYERS, ZOOM_RULES } from '../../world/schema.js';
import { POINT, LINE, POLYGON } from '../../world/mvt.js';

// ---------- geometry helpers (world units: tile x/y × extent) ----------
function simplify(pts, tol) {
  if (pts.length <= 2 || tol <= 0) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]], t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1, far = 0;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px, ey = ay + t * dy - py, d = ex * ex + ey * ey;
      if (d > far) { far = d; best = i; }
    }
    if (far > t2) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// a polyline cut to a box: the parts inside (Liang–Barsky, each segment)
function clipLine(pts, [x0, y0, x1, y1]) {
  const parts = [];
  let cur = null;
  for (let i = 1; i < pts.length; i++) {
    let [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dy = by - ay;
    let ok = true;
    for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
      if (p === 0) { if (q < 0) { ok = false; break; } continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; }
      else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
    }
    if (!ok) { cur = null; continue; }
    const a = t0 > 0 ? [ax + dx * t0, ay + dy * t0] : [ax, ay], b = t1 < 1 ? [ax + dx * t1, ay + dy * t1] : [bx, by];
    // (snap the cut exactly onto the edge: both tiles get the same point)
    for (const p of [a, b]) { for (const e of [x0, x1]) if (Math.abs(p[0] - e) < 1e-7) p[0] = e; for (const e of [y0, y1]) if (Math.abs(p[1] - e) < 1e-7) p[1] = e; }
    if (!cur || t0 > 0) { cur = [a]; parts.push(cur); }
    cur.push(b);
    if (t1 < 1) cur = null;
  }
  return parts.filter(p => p.length >= 2);
}
// a ring cut to a box (Sutherland–Hodgman)
function clipRing(ring, [x0, y0, x1, y1]) {
  let out = ring;
  for (const [inside, cross] of [
    [p => p[0] >= x0, (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])]],
    [p => p[0] <= x1, (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0])]],
    [p => p[1] >= y0, (a, b) => [a[0] + (b[0] - a[0]) * (y0 - a[1]) / (b[1] - a[1]), y0]],
    [p => p[1] <= y1, (a, b) => [a[0] + (b[0] - a[0]) * (y1 - a[1]) / (b[1] - a[1]), y1]],
  ]) {
    if (!out.length) break;
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[(i + inp.length - 1) % inp.length], b = inp[i], ia = inside(a), ib = inside(b);
      if (ib) { if (!ia) out.push(cross(a, b)); out.push(b); } else if (ia) out.push(cross(a, b));
    }
  }
  return out.length >= 3 ? out : null;
}
const area = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a / 2; };
const bboxOf = rings => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const r of rings) for (const [x, y] of r) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } return [x0, y0, x1, y1]; };

// GeoJSON geometry → { type, parts }: points [[x, y]], lines [[pts]], polygons [[rings]] (world units)
function project(g, z, E) {
  const P = ([lon, lat]) => { const [x, y] = lonLatToTile(lon, lat, z); return [x * E, y * E]; };
  switch (g.type) {
    case 'Point': return { type: POINT, parts: [P(g.coordinates)] };
    case 'MultiPoint': return { type: POINT, parts: g.coordinates.map(P) };
    case 'LineString': return { type: LINE, parts: [g.coordinates.map(P)] };
    case 'MultiLineString': return { type: LINE, parts: g.coordinates.map(l => l.map(P)) };
    case 'Polygon': return { type: POLYGON, parts: [g.coordinates.map(r => r.map(P))] };
    case 'MultiPolygon': return { type: POLYGON, parts: g.coordinates.map(p => p.map(r => r.map(P))) };
    default: return null;
  }
}

export function tileFeatures(features, { zooms = [10, 12, 14], bbox = null } = {}) {
  const tiles = new Map();
  const put = (z, x, y, layer, f) => {
    const key = `${z}/${x}/${y}`;
    let t = tiles.get(key);
    if (!t) tiles.set(key, t = { z, x, y, layers: {} });
    (t.layers[layer] ??= []).push(f);
  };
  for (const z of zooms) {
    const R = ZOOM_RULES[z], E = R.extent, n = 2 ** z;
    // (the region's tiles only: features reaching past it are cut there)
    let range = null;
    if (bbox) { const [ax, ay] = lonLatToTile(bbox[0], bbox[3], z), [bx, by] = lonLatToTile(bbox[2], bbox[1], z); range = [Math.floor(ax), Math.floor(ay), Math.floor(bx - 1e-9), Math.floor(by - 1e-9)]; }
    for (const f of features) {
      if (R[f.layer] && !R[f.layer](f.props)) continue;
      const g = project(f.geometry, z, E);
      if (!g) continue;
      const props = R.keep?.[f.layer] ? Object.fromEntries(R.keep[f.layer].filter(k => f.props[k] !== undefined).map(k => [k, f.props[k]])) : f.props;
      const lat = f.geometry.type === 'Point' ? f.geometry.coordinates[1] : null;
      if (g.type === POINT) {
        for (const p of g.parts) {
          const tx = Math.floor(p[0] / E), ty = Math.floor(p[1] / E);
          if (range && (tx < range[0] || ty < range[1] || tx > range[2] || ty > range[3])) continue;
          put(z, tx, ty, f.layer, { id: f.id, type: POINT, properties: props, geometry: [[p[0] - tx * E, p[1] - ty * E]] });
        }
        continue;
      }
      if (g.type === POLYGON) {
        const polys = g.parts.map(rings => rings.map(r => simplify(r, R.simplify))).filter(p => p[0].length >= 3);
        if (!polys.length) continue;
        // (too small to see at this zoom)
        const midLat = tileToLonLat(0, bboxOf(polys.map(p => p[0]))[1] / E, z)[1] ?? lat ?? 0, m = metresPerUnit(z, E, midLat);
        const areaM = polys.reduce((a, p) => a + Math.abs(area(p[0])) - p.slice(1).reduce((b, r) => b + Math.abs(area(r)), 0), 0) * m * m;
        if (areaM < (R.minArea?.[f.layer] ?? 0)) continue;
        if (f.layer === 'buildings') {
          // whole, into the tile its middle's in
          const [x0, y0, x1, y1] = bboxOf(polys.map(p => p[0])), tx = Math.floor((x0 + x1) / 2 / E), ty = Math.floor((y0 + y1) / 2 / E);
          if (range && (tx < range[0] || ty < range[1] || tx > range[2] || ty > range[3])) continue;
          put(z, tx, ty, f.layer, { id: f.id, type: POLYGON, properties: props, geometry: polys.map(p => p.map(r => r.map(([x, y]) => [x - tx * E, y - ty * E]))) });
          continue;
        }
        const [bx0, by0, bx1, by1] = bboxOf(polys.map(p => p[0]));
        for (let ty = Math.max(0, Math.floor(by0 / E)); ty <= Math.min(n - 1, Math.floor(by1 / E)); ty++) for (let tx = Math.max(0, Math.floor(bx0 / E)); tx <= Math.min(n - 1, Math.floor(bx1 / E)); tx++) {
          if (range && (tx < range[0] || ty < range[1] || tx > range[2] || ty > range[3])) continue;
          const box = [tx * E, ty * E, (tx + 1) * E, (ty + 1) * E], out = [];
          for (const p of polys) {
            const outer = clipRing(p[0], box);
            if (!outer || Math.abs(area(outer)) < 0.5) continue;
            out.push([outer, ...p.slice(1).map(r => clipRing(r, box)).filter(r => r && Math.abs(area(r)) >= 0.5)].map(r => r.map(([x, y]) => [x - box[0], y - box[1]])));
          }
          if (out.length) put(z, tx, ty, f.layer, { id: f.id, type: POLYGON, properties: props, geometry: out });
        }
        continue;
      }
      // lines
      const lines = g.parts.map(l => simplify(l, R.simplify)).filter(l => l.length >= 2);
      if (!lines.length) continue;
      const [bx0, by0, bx1, by1] = bboxOf(lines);
      for (let ty = Math.max(0, Math.floor(by0 / E)); ty <= Math.min(n - 1, Math.floor(by1 / E)); ty++) for (let tx = Math.max(0, Math.floor(bx0 / E)); tx <= Math.min(n - 1, Math.floor(bx1 / E)); tx++) {
        if (range && (tx < range[0] || ty < range[1] || tx > range[2] || ty > range[3])) continue;
        const box = [tx * E, ty * E, (tx + 1) * E, (ty + 1) * E], out = [];
        for (const l of lines) for (const part of clipLine(l, box)) out.push(part.map(([x, y]) => [x - box[0], y - box[1]]));
        if (out.length) put(z, tx, ty, f.layer, { id: f.id, type: LINE, properties: props, geometry: out });
      }
    }
  }
  // layers in drawing order
  for (const t of tiles.values()) t.layers = Object.fromEntries(LAYERS.filter(l => t.layers[l]).map(l => [l, t.layers[l]]));
  return tiles;
}
export { clipLine, clipRing, simplify };
