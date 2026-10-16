// Map v5's tunnels (Step 1e; MAP_README.md, 'Tunnels'): a tube where a tunnel road runs under thick ground — more than
// terrain.tunnelCover m of the natural ground over its centreline, where the height grid is cut under the road and the
// hill kept as the tunnel's roof (map/bake/terrainV4.ts) — built from the road surface itself:
//
//  · walls up from the road's outer edges (the tunnel road's edges no other road triangle shares), `height` m, a dark
//    band `band` m high at their foot
//  · a ceiling over the road, `height` m above it, following its grade and crossfall
//  · a portal where the tube meets the open road (an edge it shares with a road triangle out of the tube): a concrete
//    headwall from the ceiling up to `above` m over the hillside there, and wings `wing` m out either side
//
// All of it one mesh (meshes.tunnel: drawn, and solid all round — map/render/physics.ts), the road inside the
// model's own (its real grade: map/model/heights.ts), its lights the lamps' (map/model/lamps.ts, on the walls), the
// ground over it untouched (the tiles' `cover`). The style pack says how it looks (style.tunnel).
//
//   buildTunnels({ mesh (the road surface: map/model/surface.ts), segs, demAt, cfg, style }) →
//     { mesh: { positions, colours, indices, surfaces, solid, level, seg }, stats: { tubes, wallM, portals }, tube }
//   (tube: which of the road's triangles are in a tube — tubeTriangles — for the terrain's trench)

import { SURFACES } from './surface.ts';

const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// the tube's triangles (1 each, else 0): along each tunnel segment, the stretches where the natural ground over its
// centreline is more than `cover` m (sampled every 2 m; stretches and gaps shorter than minRun m dropped), and a
// triangle of it in the tube if every corner's place along it is in one — so a portal runs straight across the road,
// and the terrain's trench (map/bake/terrainV4.ts, given these) is under exactly the tube
export function tubeTriangles({ mesh: M, segs, demAt, cover, minRun = 20 }: { mesh: any; segs: any[]; demAt: (x: number, z: number) => number; cover: number; minRun?: number }) {
  const P = M.positions, I = M.indices, part = M.part as number[] | undefined, tube = new Uint8Array(I.length / 3);
  const runs = new Map<number, number[][]>(), byId = new Map<number, any>();
  for (const g of segs) {
    if (g.structure !== 'tunnel' || g.internal || !g.h) continue;
    byId.set(g.id, g);
    const L = g.s[g.s.length - 1], step = 2, inside: boolean[] = [];
    let k = 0;
    for (let q = 0; q <= L + 1e-9; q += step) {
      while (k < g.s.length - 2 && g.s[k + 1] < q) k++;
      const f = g.s[k + 1] > g.s[k] ? (q - g.s[k]) / (g.s[k + 1] - g.s[k]) : 0, x = g.xs[k] + (g.xs[k + 1] - g.xs[k]) * f, z = g.zs[k] + (g.zs[k + 1] - g.zs[k]) * f, h = g.h[k] + (g.h[k + 1] - g.h[k]) * f;
      inside.push(demAt(x, z) - h > cover);
    }
    // (short gaps filled, then short stretches dropped)
    const fix = (v: boolean) => { for (let a = 0; a < inside.length;) { let b = a; while (b < inside.length && inside[b] === inside[a]) b++; if (inside[a] === v && a > 0 && b < inside.length && (b - a) * step < minRun) for (let q = a; q < b; q++) inside[q] = !v; a = b; } };
    fix(false); fix(true);
    const out: number[][] = [];
    for (let a = 0; a < inside.length;) { let b = a; while (b < inside.length && inside[b] === inside[a]) b++; if (inside[a] && (b - a) * step >= minRun) out.push([a * step, Math.min(L, (b - 1) * step)]); a = b; }
    if (out.length) runs.set(g.id, out);
  }
  if (!runs.size) return { tube, any: false };
  // (a corner's place along its segment: the nearest point of the centreline)
  const along = (g: any, x: number, z: number) => { let best = Infinity, at = 0; for (let k = 0; k + 1 < g.xs.length; k++) { const dx = g.xs[k + 1] - g.xs[k], dz = g.zs[k + 1] - g.zs[k], l2 = dx * dx + dz * dz || 1e-12, f = Math.max(0, Math.min(1, ((x - g.xs[k]) * dx + (z - g.zs[k]) * dz) / l2)), d = Math.hypot(x - g.xs[k] - dx * f, z - g.zs[k] - dz * f); if (d < best) { best = d; at = g.s[k] + (g.s[k + 1] - g.s[k]) * f; } } return at; };
  let any = false;
  for (let t = 0; t < I.length / 3; t++) {
    if (!M.solid[t] || (part && part[t]) || M.level[t] !== 2) continue;
    const g = byId.get(M.seg[t]), R = g && runs.get(g.id);
    if (!R) continue;
    const st = [0, 1, 2].map(e => along(g, P[I[t * 3 + e] * 3], P[I[t * 3 + e] * 3 + 2]));
    if (R.some(([a, b]) => st.every(q => q >= a - 0.5 && q <= b + 0.5))) { tube[t] = 1; any = true; }
  }
  return { tube, any };
}

export function buildTunnels({ mesh: M, segs, demAt, cfg, style }: { mesh: any; segs: any[]; demAt: (x: number, z: number) => number; cfg: any; style: any }) {
  const P = M.positions, I = M.indices, S = style.tunnel, cover = cfg.terrain.tunnelCover;
  const out = { positions: [] as number[], colours: [] as number[], indices: [] as number[], surfaces: [] as number[], solid: [] as number[], level: [] as number[], seg: [] as number[] };
  const stats = { tubes: 0, wallM: 0, portals: 0 };
  const part = M.part as number[] | undefined;
  const roadTri = (t: number) => M.solid[t] && !(part && part[t]);
  // (the tube's triangles: tubeTriangles')
  const { tube, any } = tubeTriangles({ mesh: M, segs, demAt, cover, minRun: S.minRun ?? 20 });
  if (!any) return { mesh: out, stats, tube };
  // (edges by their ends' positions, to the millimetre: how many road triangles share each, how many of the tube's)
  const key = (v: number) => `${Math.round(P[v * 3] * 1000)},${Math.round(P[v * 3 + 1] * 1000)},${Math.round(P[v * 3 + 2] * 1000)}`;
  const ek = (a: number, b: number) => { const p = key(a), q = key(b); return p < q ? `${p}|${q}` : `${q}|${p}`; };
  const all = new Map<string, number>(), mine = new Map<string, number>();
  for (let t = 0; t < I.length / 3; t++) {
    if (!roadTri(t)) continue;
    for (let e = 0; e < 3; e++) { const k = ek(I[t * 3 + e], I[t * 3 + (e + 1) % 3]); all.set(k, (all.get(k) ?? 0) + 1); if (tube[t]) mine.set(k, (mine.get(k) ?? 0) + 1); }
  }
  const H = S.height, cWall = hex(S.colours.wall), cBand = hex(S.colours.band), cCeil = hex(S.colours.ceiling), cPortal = hex(S.colours.portal);
  const surf = SURFACES.indexOf('concrete');
  const vtx = (x: number, y: number, z: number, c: number[]) => { out.positions.push(x, y, z); out.colours.push(c[0], c[1], c[2], 255); return out.positions.length / 3 - 1; };
  const tri = (a: number, b: number, c: number, seg: number) => { out.indices.push(a, b, c); out.surfaces.push(surf); out.solid.push(1); out.level.push(2); out.seg.push(seg); };
  // a quad a-b-c-d (anticlockwise seen from the side it faces)
  const quad = (p: number[][], c: number[], seg: number) => { const ids = p.map(q => vtx(q[0], q[1], q[2], c)); tri(ids[0], ids[1], ids[2], seg); tri(ids[0], ids[2], ids[3], seg); };
  const tubeSegs = new Set<number>(), portalEnds: { x: number; y: number; z: number; ox: number; oz: number; nx: number; nz: number; seg: number }[] = [];
  for (let t = 0; t < I.length / 3; t++) {
    if (!tube[t]) continue;
    const seg = M.seg[t];
    tubeSegs.add(seg);
    const v = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]];
    // the ceiling: the road's triangle raised, facing down
    const up = v.map(q => vtx(P[q * 3], P[q * 3 + 1] + H, P[q * 3 + 2], cCeil));
    // (the road's triangles face up — anticlockwise seen from above — so reversed, they face down)
    tri(up[0], up[2], up[1], seg);
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3], c = v[(e + 2) % 3], k = ek(a, b);
      if (mine.get(k) !== 1) continue;
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2], L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-4) continue;
      // (which way is in: towards the triangle's third corner)
      let nx = -(bz - az) / L, nz = (bx - ax) / L;
      if ((P[c * 3] - ax) * nx + (P[c * 3 + 2] - az) * nz < 0) { nx = -nx; nz = -nz; }
      // (a quad facing in: seen from inside, a→b runs one way or the other — wound to face the third corner)
      const face = (p0: number[], p1: number[], y0a: number, y0b: number, y1a: number, y1b: number, col: number[], inward: boolean) => {
        const q = [[p0[0], y0a, p0[1]], [p1[0], y0b, p1[1]], [p1[0], y1b, p1[1]], [p0[0], y1a, p0[1]]];
        // (q as it stands faces (−ez, 0, ex): kept if that's the way wanted — in, (nx, nz), or out — else turned round)
        const ex = p1[0] - p0[0], ez = p1[1] - p0[1], facesIn = ex * nz - ez * nx > 0;
        quad(facesIn === inward ? q : [q[1], q[0], q[3], q[2]], col, seg);
      };
      if (all.get(k) === 1) {
        // a wall: the band, then the wall to the ceiling
        face([ax, az], [bx, bz], ay - 0.3, by - 0.3, ay + S.band, by + S.band, cBand, true);
        face([ax, az], [bx, bz], ay + S.band, by + S.band, ay + H, by + H, cWall, true);
        stats.wallM += L;
      } else {
        // a portal: the headwall over the opening, from the ceiling up to over the hillside, facing out (and in, for
        // the space over the ceiling: never seen, but solid both ways)
        const ga = Math.max(ay + H, demAt(ax, az)) + S.above, gb = Math.max(by + H, demAt(bx, bz)) + S.above;
        face([ax, az], [bx, bz], ay + H, by + H, ga, gb, cPortal, false);
        face([ax, az], [bx, bz], ay + H, by + H, ga, gb, cPortal, true);
        for (const [x, y, z, ox, oz] of [[ax, ay, az, ax - bx, az - bz], [bx, by, bz, bx - ax, bz - az]]) portalEnds.push({ x, y, z, ox, oz, nx: -nx, nz: -nz, seg });
        stats.portals++;
      }
    }
  }
  // the wings: at a portal's ends (a portal edge's corner on a wall), outwards along it, from under the road to over
  // the hillside
  const wallAt = new Set<string>();
  for (let t = 0; t < I.length / 3; t++) if (tube[t]) for (let e = 0; e < 3; e++) { const a = I[t * 3 + e], b = I[t * 3 + (e + 1) % 3], k = ek(a, b); if (mine.get(k) === 1 && all.get(k) === 1) { wallAt.add(key(a)); wallAt.add(key(b)); } }
  const kAt = (x: number, y: number, z: number) => `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
  for (const p of portalEnds) {
    if (!wallAt.has(kAt(p.x, p.y, p.z))) continue;
    const l = Math.hypot(p.ox, p.oz) || 1, ux = p.ox / l, uz = p.oz / l, fx = p.x + ux * S.wing, fz = p.z + uz * S.wing;
    const top0 = Math.max(p.y + H, demAt(p.x, p.z)) + S.above, top1 = Math.max(p.y + 1, demAt(fx, fz) + S.above * 0.5);
    // (both faces: out of the hill, and back into the cutting's side)
    const q = [[p.x, p.y - 0.5, p.z], [fx, p.y - 0.5, fz], [fx, top1, fz], [p.x, top0, p.z]];
    quad(q, cPortal, p.seg);
    quad([q[1], q[0], q[3], q[2]], cPortal, p.seg);
  }
  stats.tubes = tubeSegs.size;
  return { mesh: out, stats, tube };
}
