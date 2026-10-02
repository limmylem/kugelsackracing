// The far world: the whole region at a glance, for the distance and the horizon — the terrain on a 16 m
// grid (cut adaptively, a couple of metres' error), coloured by land use, in 4 km chunks; its tall
// buildings as plain blocks; and its landmarks (the tallest towers, churches, stadiums…) in full, so you
// can steer by them from anywhere. The game loads it before anything else and draws it wherever the
// detailed tiles haven't come in (a mask of the tiles that have).
//
//   await bakeFar({ P, index, dem, cfg, region, bounds }) → [{ a, b, tile }]   (world/tileFormat.js tiles)

import { extrude, heightOf, rgb } from './buildings.mjs';
import { simplify } from './tiler.mjs';
import { Raster } from './bakeTile.mjs';

export const FAR = { chunk: 4096, cell: 16, error: 1.8, blockHeight: 24 };

class Part {
  constructor(uv = false) { this.positions = []; this.colours = []; this.uvs = uv ? [] : null; this.indices = []; }
  get empty() { return !this.indices.length; }
  vertex(x, y, z, c) { this.positions.push(x, y, z); this.colours.push(c[0], c[1], c[2], 255); if (this.uvs) this.uvs.push(0, 0); return this.positions.length / 3 - 1; }
  add(o, dx = 0, dz = 0) { const base = this.positions.length / 3; for (let k = 0; k < o.positions.length; k += 3) this.positions.push(o.positions[k] + dx, o.positions[k + 1], o.positions[k + 2] + dz); this.colours.push(...o.colours); if (this.uvs) this.uvs.push(...(o.uvs ?? new Array(o.positions.length / 3 * 2).fill(0))); for (const k of o.indices) this.indices.push(base + k); }
  out() { return { positions: Float32Array.from(this.positions), colours: Uint8Array.from(this.colours), ...(this.uvs && { uvs: Float32Array.from(this.uvs) }), indices: Uint32Array.from(this.indices) }; }
}
function inRing(x, z, r) { let inside = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > z) !== (r[j][1] > z) && x < (r[j][0] - r[i][0]) * (z - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside; return inside; }

export async function bakeFar({ P, index, dem, cfg, region, bounds }) {
  const { chunk: S, cell } = FAR, n = S / cell, N1 = n + 1, pal = Object.fromEntries(Object.entries(cfg.colours).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, rgb(v)]));
  const [x0, z0, x1, z1] = bounds, out = [];
  for (let b = Math.floor(z0 / S); b < Math.ceil(z1 / S); b++) for (let a = Math.floor(x0 / S); a < Math.ceil(x1 / S); a++) {
    const cx = (a + 0.5) * S, cz = (b + 0.5) * S, half = S / 2;
    const [la0, lo0] = P.toLatLon(cx - half - 40, cz + half + 40), [la1, lo1] = P.toLatLon(cx + half + 40, cz - half - 40);
    const ground = await dem.sampler([la0, lo0, la1, lo1], { resolution: 8 });
    // land use, coarsely: the class of each grid point (smallest area wins)
    const near = index.query(cx - half, cz - half, cx + half, cz + half);
    const areas = near.filter(f => f.type === 'area' && ['landuse', 'cover', 'water'].includes(f.layer) && (pal[f.props.k] || f.layer === 'water'))
      .map(f => ({ f, polys: f.geometry.type === 'Polygon' ? [f.xy] : f.xy, size: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]) })).sort((p, q) => q.size - p.size);
    const heights = new Float32Array(N1 * N1), cls = new Array(N1 * N1).fill('default');
    for (let r = 0; r <= n; r++) for (let c = 0; c <= n; c++) {
      const x = cx - half + c * cell, z = cz - half + r * cell, [lat, lon] = P.toLatLon(x, z);
      let h = ground.height(lat, lon);
      if (!Number.isFinite(h)) h = 0;
      heights[r * N1 + c] = h;
    }
    // (scanline fills, one cell per grid point: big polygons — the ocean — cost a row each, not a point each)
    const classes = ['default'], R = new Raster(N1, cell, half + cell / 2);
    for (const { f, polys } of areas) {
      const name = f.layer === 'water' ? 'water' : f.props.k;
      let k = classes.indexOf(name); if (k < 0) k = classes.push(name) - 1;
      for (const p of polys) R.fill(p.map(r => r.map(([x, z]) => [x - cx, z - cz])), k);
    }
    for (let q = 0; q < cls.length; q++) cls[q] = classes[R.data[q]];
    // the sea and lakes kept below their water (the water is drawn flat at its level)
    for (let k = 0; k < heights.length; k++) if (cls[k] === 'water' || heights[k] < 0.4) heights[k] = Math.min(heights[k], -1.5);
    // (the terrain's mesh is cut where the chunk is read, world/terrainMesh.js, from its heights — column by
    // column, to the decimetre — and each point's colour)
    const hf = new Float32Array(N1 * N1), grid = new Uint8Array(N1 * N1), palette = [], paletteIndex = new Map();
    for (let r = 0; r <= n; r++) for (let c = 0; c <= n; c++) {
      const k = r * N1 + c, name = cls[k], col = name === 'water' ? pal.underwater : pal[name] ?? pal.default, ck = col.join(',');
      if (!paletteIndex.has(ck)) { paletteIndex.set(ck, palette.length); palette.push(col.slice(0, 3)); }
      grid[k] = paletteIndex.get(ck);
      hf[r + c * N1] = Math.round(heights[k] * 10) / 10;
    }
    // buildings: tall ones as blocks, landmarks whole (each in the chunk its middle is in)
    const blocks = new Part(), landmarkWalls = new Part(true), landmarkRoofs = new Part(), landmarks = [];
    const groundAt = (x, z) => { const [lat, lon] = P.toLatLon(x + cx, z + cz), h = ground.height(lat, lon); return Number.isFinite(h) ? h : 0; };
    for (const f of near) {
      if (f.layer !== 'buildings' || f.type !== 'area' || f.props.hp) continue;
      for (const polyW of f.geometry.type === 'Polygon' ? [f.xy] : f.xy) {
        const outer = polyW[0];
        let mx = 0, mz = 0; for (const [x, z] of outer) { mx += x; mz += z; } mx /= outer.length; mz /= outer.length;
        if (mx < cx - half || mx >= cx + half || mz < cz - half || mz >= cz + half) continue;
        // (only the tall and the landmarks: a cheap look at its height first)
        let ar = 0; for (let q = 0, p = outer.length - 1; q < outer.length; p = q++) ar += (outer[p][0] - outer[q][0]) * (outer[p][1] + outer[q][1]);
        const C = cfg.buildings, guess = heightOf(f.props, Math.abs(ar) / 2, C);
        if (guess < Math.min(FAR.blockHeight, C.landmark.height) && !(C.landmark.kinds.includes(f.props.b) && Math.abs(ar) / 2 >= C.landmark.minArea)) continue;
        const rings = polyW.map(r => r.map(([x, z]) => [x - cx, z - cz]));
        const b = extrude({ id: f.id, rings, props: f.props }, groundAt, cfg.buildings);
        if (!b) continue;
        if (b.landmark) { landmarkWalls.add(b.walls); landmarkRoofs.add(b.roof); landmarks.push({ id: f.id, centre: [b.centre[0] + cx, b.centre[1] + cz], top: b.top, height: b.height }); continue; }
        if (b.height < FAR.blockHeight) continue;
        // a block: the outline simplified, walls and a flat top in its colours
        let ring = simplify(rings[0], 1.5);
        const col = b.walls.colours.slice(0, 3), roofCol = b.roof.colours.slice(0, 3);
        // (anticlockwise seen from above: walls facing out, the top up)
        { let a2 = 0; for (let q = 0, p = ring.length - 1; q < ring.length; p = q++) a2 += (ring[p][0] - ring[q][0]) * (ring[p][1] + ring[q][1]); if (a2 > 0) ring = ring.slice().reverse(); }
        if (ring.length < 3) continue;
        const top = b.top, foot = b.foot, base = blocks.positions.length / 3;
        for (const [x, z] of ring) { blocks.vertex(x, foot, z, col); blocks.vertex(x, top, z, col); }
        for (let q = 0; q < ring.length; q++) { const p0 = base + q * 2, p1 = base + ((q + 1) % ring.length) * 2; blocks.indices.push(p0, p1, p1 + 1, p0, p1 + 1, p0 + 1); }
        const tb = blocks.positions.length / 3;
        for (const [x, z] of ring) blocks.vertex(x, top, z, roofCol);
        for (let q = 1; q + 1 < ring.length; q++) blocks.indices.push(tb, tb + q, tb + q + 1);
      }
    }
    const meshes = { ...(!blocks.empty && { blocks: blocks.out() }), ...(!landmarkWalls.empty && { landmark_walls: landmarkWalls.out() }), ...(!landmarkRoofs.empty && { landmark_roofs: landmarkRoofs.out() }) };
    out.push({ a, b, tile: { header: { region: region.id, key: `far_${a}_${b}`, a, b, size: S, centre: [cx, cz], far: true, landmarks, terrain: { palette, lodErrors: [FAR.error] } }, meshes, lists: {}, grids: { terrain: { n: N1, cell, data: grid } }, heightfield: { n, size: S, heights: hf, quantum: 0.1 } } });
  }
  return out;
}
