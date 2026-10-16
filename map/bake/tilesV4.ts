// Map v4's tiles: Map v3's tile builder (map/bake/tiles.ts: the heightfield, terrain colours and surfaces, car parks,
// tunnel roofs, water, buildings, names, signs, the HUD's road list) with everything about roads replaced by the road
// surface model's:
//   meshes.roads          the model's surface cut exactly at the tile's border (map/bake/clip.ts): ribbons, junction
//                         patches, kerbs, skirts and decks; a triangle's surface (tarmac, kerb…) for the tyres
//   meshes.markings       the model's markings, cut the same way (and car parks' bay lines)
//   meshes.tunnel         Map v5's tunnel tubes (map/model/tunnels.ts): walls, ceilings and portals, drawn and solid
//   meshes.fields         Map v5's sports grounds' lines and courts, and pools (map/model/fields.ts): drawn only
//   meshes.roadCollision  the solid road surface over the tile and `apron` m past its border (the same triangles its
//                         neighbours draw there): one connected mesh for Rapier's internal-edge fix, no edge at the
//                         border for a wheel to catch on
//   lists.hulls           buildings' colliders, cut off any road (map/collision/buildings.ts)
//   lists.furniture, lists.wires   Map v5's street furniture and power lines (map/format/furniture.ts)
//   lists.rails, meshes.platforms   Map v5's railway track [ax, ay, az, bx, by, bz, gauge, flags] and platforms (solid)
//   lists.placeSigns      Map v5's suburbs' and parks' signs: [x, y, z, yaw, kind, name (the manifest's placeNames)]
//   lists.models          Map v5's hand-made landmarks (map/render/models.ts): [x, y, z, yaw, scale, file, box w, h, d]
//   lists.trees, lists.barrier_*  the model's (map/model/props.ts); lists.lamps (map/model/lamps.ts)
//   lists.roadEdges       the debug view's road model: [ax, ay, az, bx, by, bz, class, kind]
//   lists.roadBorder      the road's vertices on the tile's border: [x, y, z, matched] (the seam view)
//   grids.exclusion       the exclusion mask (1 m, bits: map/model/mask.ts) — baked, so it can be looked at
//   header.map 'v4', header.roadModel, header.roadClasses (Map v5: 'v5', and header.surfaceNames — the names of the
//                         surfaces meshes.roadCollision's and meshes.paved's triangles carry)
//
//   const T = tileBuilderV4({ ...v3 inputs, model, lamps, mask, surface, cfg (v4) }); T.tile(i, j); T.far(a, b)

import { tileBuilder } from './tiles.ts';
import { bucketTriangles, clipToBox } from './clip.ts';
import { trimHulls } from '../collision/buildings.ts';
import { LAMP_STRIDE } from '../model/lamps.ts';
import { FURNITURE_STRIDE } from '../format/furniture.ts';
import { welder, SURFACES } from '../model/surface.ts';

export function tileBuilderV4(D: any) {
  const empty = { positions: [], colours: [], indices: [], surfaces: [], segOf: [] };
  const V3 = tileBuilder({ ...D, mesh: empty, marks: empty });
  const T = D.grid.tileSize, cfg = D.v4, M = D.model.surface.mesh, K = D.model.surface.marks, apron = cfg.collision.apron;
  const vis = bucketTriangles(M, T, 0), col = bucketTriangles(M, T, apron, t => !!M.solid[t]), mk = bucketTriangles(K, T, 0);
  // (Map v5's tunnel tubes: map/model/tunnels.ts — drawn and solid, cut at the tile's border like the road)
  const TU = D.tunnel, tu = TU?.indices.length ? bucketTriangles(TU, T, 0) : null;
  // (and its sports grounds' lines and courts, its pools: map/model/fields.ts — drawn only)
  const FD = D.fields, fd = FD?.indices.length ? bucketTriangles(FD, T, 0) : null;
  const tileOf = (x: number, z: number) => `${Math.floor(x / T)}_${Math.floor(z / T)}`;
  const edgesBy = new Map<string, number[]>(), E = D.model.surface.edges;
  for (let k = 0; k < E.length; k += 8) { const key = tileOf((E[k] + E[k + 3]) / 2, (E[k + 2] + E[k + 5]) / 2); (edgesBy.get(key) ?? edgesBy.set(key, []).get(key)!).push(k); }
  // (Map v5's street furniture and power lines: each piece in the tile its foot is in, a wire in its middle's)
  const furnBy = new Map<string, number[]>(), Fu = D.furniture?.items ?? [], wiresBy = new Map<string, number[]>(), Wi = D.furniture?.wires ?? [];
  for (let k = 0; k < Fu.length; k += FURNITURE_STRIDE) { const key = tileOf(Fu[k], Fu[k + 2]); (furnBy.get(key) ?? furnBy.set(key, []).get(key)!).push(k); }
  for (let k = 0; k < Wi.length; k += 6) { const key = tileOf((Wi[k] + Wi[k + 3]) / 2, (Wi[k + 2] + Wi[k + 5]) / 2); (wiresBy.get(key) ?? wiresBy.set(key, []).get(key)!).push(k); }
  // (Map v5's railway track, each piece in the tile its middle's in, and its platforms, cut at the border)
  const railBy = new Map<string, number[]>(), RP = D.rails ?? [];
  for (let k = 0; k < RP.length; k += 8) { const key = tileOf((RP[k] + RP[k + 3]) / 2, (RP[k + 2] + RP[k + 5]) / 2); (railBy.get(key) ?? railBy.set(key, []).get(key)!).push(k); }
  const PF = D.platforms, pf = PF?.indices.length ? bucketTriangles(PF, T, 0) : null;
  // (Map v5's place signs: each in the tile its foot's in — map/model/placeSigns.ts)
  const placeBy = new Map<string, number[]>(), PS = D.placeSigns ?? [];
  for (let k = 0; k < PS.length; k += 6) { const key = tileOf(PS[k], PS[k + 2]); (placeBy.get(key) ?? placeBy.set(key, []).get(key)!).push(k); }
  // (Map v5's hand-made landmarks: each in the tile its anchor's in — map/render/models.ts's lists.models)
  const modelsBy = new Map<string, any[]>();
  (D.models ?? []).forEach((m: any, q: number) => { const key = tileOf(m.x, m.z); (modelsBy.get(key) ?? modelsBy.set(key, []).get(key)!).push({ ...m, q }); });
  const lampsBy = new Map<string, number[]>(), Lp = D.lamps;
  for (let k = 0; k < Lp.length; k += LAMP_STRIDE) { const key = tileOf(Lp[k], Lp[k + 2]); (lampsBy.get(key) ?? lampsBy.set(key, []).get(key)!).push(k); }
  const stats = { hullsTrimmed: 0, hullsDropped: 0, pavedDropped: 0, ms: { v3: 0, roads: 0, collision: 0, hulls: 0, lists: 0 } as Record<string, number> };
  let lap = performance.now();
  const time = (k: string) => { const now = performance.now(); stats.ms[k] += now - lap; lap = now; };
  const arr = (m: any, withSurf: boolean, withColour = true) => ({ positions: Float32Array.from(m.positions), colours: withColour ? Uint8Array.from(m.colours) : null, uvs: null, indices: Uint32Array.from(m.indices), surfaces: withSurf ? Uint8Array.from(m.surfaces) : null });

  function tile(i: number, j: number) {
    lap = performance.now();
    const t: any = V3.tile(i, j);
    time('v3');
    const key = `${i}_${j}`, cx = (i + 0.5) * T, cz = (j + 0.5) * T, box: [number, number, number, number] = [i * T, j * T, (i + 1) * T, (j + 1) * T];
    const roads = clipToBox(M, vis.get(key) ?? [], box, { cx, cz });
    if (roads.indices.length) t.meshes.roads = arr(roads, true); else delete t.meshes.roads;
    const marks = clipToBox(K, mk.get(key) ?? [], box, { cx, cz });
    // (car parks' bay lines, from Map v3's builder, with them)
    const bays = t.meshes.markings;
    if (bays) { const base = marks.positions.length / 3; marks.positions.push(...bays.positions); marks.colours.push(...bays.colours); for (const q of bays.indices) marks.indices.push(base + q); }
    if (marks.indices.length) t.meshes.markings = arr(marks, false); else delete t.meshes.markings;
    if (tu) { const m = clipToBox(TU, tu.get(key) ?? [], box, { cx, cz }); if (m.indices.length) t.meshes.tunnel = arr(m, false); }
    if (fd) { const m = clipToBox(FD, fd.get(key) ?? [], box, { cx, cz }); if (m.indices.length) t.meshes.fields = arr(m, false); }
    time('roads');
    const coll = clipToBox(M, col.get(key) ?? [], [box[0] - apron, box[1] - apron, box[2] + apron, box[3] + apron], { cx, cz });
    // (welded by position alone, whatever their colours: one connected surface)
    // (Map v5: each triangle's surface kept — the tyres take the road's own, never the ground's raster under it)
    if (coll.indices.length) t.meshes.roadCollision = weld(coll, D.map === 'v5', cfg.collision.minWidth ?? 0.002);
    time('collision');
    // car parks off the road: Map v3's are its grid's cells, which can reach over a road's edge at the car park's own
    // height (drawn and solid: a lip in the lane) — any triangle with a corner or its middle on the road surface goes
    if (t.meshes.paved) { const r = offRoad(t.meshes.paved, cx, cz, D.surface); t.meshes.paved = r.mesh; stats.pavedDropped += r.dropped; if (!r.mesh) delete t.meshes.paved; }
    // building colliders off the road
    if (t.lists.hulls?.data.length) { const r = trimHulls(t.lists.hulls.data, cx, cz, D.surface, cfg); t.lists.hulls = { stride: 1, quantum: 0.02, data: Float32Array.from(r.hulls) }; stats.hullsTrimmed += r.trimmed; stats.hullsDropped += r.dropped; }
    time('hulls');
    // lamps, the road model's edges, the border's vertices, the exclusion mask
    t.lists.lamps = { stride: LAMP_STRIDE, data: Float32Array.from((lampsBy.get(key) ?? []).flatMap(k => [Lp[k] - cx, Lp[k + 1], Lp[k + 2] - cz, ...Array.from(Lp.slice(k + 3, k + LAMP_STRIDE))])) };
    if (D.furniture) {
      t.lists.furniture = { stride: FURNITURE_STRIDE, data: Float32Array.from((furnBy.get(key) ?? []).flatMap(k => [Fu[k] - cx, Fu[k + 1], Fu[k + 2] - cz, ...Array.from(Fu.slice(k + 3, k + FURNITURE_STRIDE))])) };
      t.lists.wires = { stride: 6, data: Float32Array.from((wiresBy.get(key) ?? []).flatMap(k => [Wi[k] - cx, Wi[k + 1], Wi[k + 2] - cz, Wi[k + 3] - cx, Wi[k + 4], Wi[k + 5] - cz])) };
    }
    if (railBy.has(key)) t.lists.rails = { stride: 8, data: Float32Array.from(railBy.get(key)!.flatMap(k => [RP[k] - cx, RP[k + 1], RP[k + 2] - cz, RP[k + 3] - cx, RP[k + 4], RP[k + 5] - cz, RP[k + 6], RP[k + 7]])) };
    if (pf) { const m = clipToBox(PF, pf.get(key) ?? [], box, { cx, cz }); if (m.indices.length) t.meshes.platforms = arr(m, false); }
    if (placeBy.has(key)) t.lists.placeSigns = { stride: 6, data: Float32Array.from(placeBy.get(key)!.flatMap(k => [PS[k] - cx, PS[k + 1], PS[k + 2] - cz, PS[k + 3], PS[k + 4], PS[k + 5]])) };
    if (modelsBy.has(key)) t.lists.models = { stride: 9, data: Float32Array.from(modelsBy.get(key)!.flatMap((m: any) => [m.x - cx, m.y, m.z - cz, m.yaw, m.scale, m.q, ...(m.box ?? [0, 0, 0])])) };
    t.lists.roadEdges = { stride: 8, quantum: 0.05, data: Float32Array.from((edgesBy.get(key) ?? []).flatMap(k => [E[k] - cx, E[k + 1], E[k + 2] - cz, E[k + 3] - cx, E[k + 4], E[k + 5] - cz, E[k + 6], E[k + 7]])) };
    const border: number[] = [];
    if (t.meshes.roads) { const P = t.meshes.roads.positions, half = T / 2; for (let v = 0; v < P.length; v += 3) if (Math.abs(Math.abs(P[v]) - half) < 1e-6 || Math.abs(Math.abs(P[v + 2]) - half) < 1e-6) border.push(P[v], P[v + 1], P[v + 2], 1); }
    t.lists.roadBorder = { stride: 4, data: Float32Array.from(border) };
    const X = D.mask.tile(i, j);
    t.grids.exclusion = { n: X.n, cell: X.cell, names: ['road', 'buffer', 'deck', 'rail', 'side'], data: X.data.slice() };
    Object.assign(t.header, { map: D.map ?? 'v4', roadModel: D.model.version, roadClasses: D.model.surface.classes }, D.map === 'v5' ? { surfaceNames: SURFACES } : {});
    t.header.terrain = { ...t.header.terrain, roadDrop: cfg.terrain.lodRoadDrop };
    time('lists');
    return t;
  }
  return { tile, far: V3.far, FAR: V3.FAR, stats };
}

// a mesh (tile-local) less its triangles on the road surface (any layer within 1 m of its height): { mesh | null, dropped }
function offRoad(m: any, cx: number, cz: number, surface: any) {
  const P = m.positions, I = m.indices, keep: number[] = [];
  let dropped = 0;
  for (let t = 0; t < I.length; t += 3) {
    const v = [I[t], I[t + 1], I[t + 2]], pts = [...v.map(q => [P[q * 3], P[q * 3 + 1], P[q * 3 + 2]]), [0, 1, 2].map(k => (P[v[0] * 3 + k] + P[v[1] * 3 + k] + P[v[2] * 3 + k]) / 3)];
    if (pts.some(p => surface.heightsAt(p[0] + cx, p[2] + cz).some((h: any) => Math.abs(h.y - p[1]) < 1))) { dropped++; continue; }
    keep.push(t);
  }
  if (!dropped) return { mesh: m, dropped };
  if (!keep.length) return { mesh: null, dropped };
  const indices = new Uint32Array(keep.length * 3), surfaces = m.surfaces ? new Uint8Array(keep.length) : null;
  keep.forEach((t, k) => { indices[k * 3] = I[t]; indices[k * 3 + 1] = I[t + 1]; indices[k * 3 + 2] = I[t + 2]; if (surfaces) surfaces[k] = m.surfaces[t / 3]; });
  return { mesh: { ...m, indices, surfaces }, dropped };
}

// a mesh's vertices merged by position (1 cm), colours dropped: the collision surface
function weld(m: { positions: number[]; indices: number[]; surfaces?: number[] }, withSurfaces = false, minWidth = 0.002) {
  const ids = welder(), P: number[] = [], I: number[] = [], map: number[] = [];
  for (let v = 0; v < m.positions.length / 3; v++) {
    const id = ids(Math.round(m.positions[v * 3] * 100), Math.round(m.positions[v * 3 + 1] * 100), Math.round(m.positions[v * 3 + 2] * 100));
    if (id === P.length / 3) P.push(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]);
    map.push(id);
  }
  // (only the ground you drive on: no triangle a few millimetres thin in plan (minWidth m: collision.minWidth) — the drawn mesh's stitches, which close its
  // T-junctions and mean nothing to a collider, some of them the length of a big junction — and none steeper than
  // about 72°, which on a road surface could only be a sliver standing on its edge: a wall in a lane)
  const keep = (a: number, b: number, c: number) => {
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, n = Math.hypot(nx, ny, nz);
    if (n < 1e-9 || Math.abs(ny) / n < 0.3) return false;
    const longest = Math.max(Math.hypot(ux, uz), Math.hypot(vx, vz), Math.hypot(vx - ux, vz - uz));
    return Math.abs(ny) / longest > minWidth;
  };
  const S: number[] = [];
  for (let t = 0; t < m.indices.length; t += 3) { const a = map[m.indices[t]], b = map[m.indices[t + 1]], c = map[m.indices[t + 2]]; if (a !== b && b !== c && a !== c && keep(a, b, c)) { I.push(a, b, c); S.push(m.surfaces?.[t / 3] ?? 0); } }
  // (only the vertices its triangles use)
  const used = new Int32Array(P.length / 3).fill(-1), P2: number[] = [];
  for (let q = 0; q < I.length; q++) { const v = I[q]; if (used[v] < 0) { used[v] = P2.length / 3; P2.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); } I[q] = used[v]; }
  return { positions: Float32Array.from(P2), colours: null, uvs: null, indices: Uint32Array.from(I), surfaces: withSurfaces ? Uint8Array.from(S) : null };
}
