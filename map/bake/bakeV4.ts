// Map v4's bake (MAP_README.md): Map v3's pipeline — the OSM extract (Geofabrik + osmium, or rebuilt from Overture),
// Planetiler's vector map, GDAL's elevation (datums, blends, the surface model corrected), Overture's buildings merged
// with OSM's — with the roads, the ground round them, collision, trees, railings, lamps and the navigation graph all
// made from one road surface model (map/model/). Output beside the region's v3 bake: assets/map/<region>/v4/
// { manifest.json, graph.json.gz, roadmodel.json.gz, tiles/, far/ } (the vector map is v3's: ../map.pmtiles).
//
//   node map/bake/bakeV4.ts --region adelaide                          the whole region
//   node map/bake/bakeV4.ts --region adelaide --area -34.9275,138.6,2  a 2 km square round a place (a slice)
//   node map/bake/bakeV4.ts --region adelaide --out <dir>              somewhere else (the determinism test)
//   … --block-tiles 3 --block-pad 400                                  other blocks than data/map/v4.json's (the same tiles)
// Faster than v3: tiles encoded and gzipped on every core but one (map/bake/encodePool.ts), gzip level 6, the vector
// map and the elevation reused when their inputs haven't changed, only the roads near a slice modelled.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { MeshoptEncoder } from 'meshoptimizer';
import { transverseMercator } from '../format/projection.ts';
import { gridFor } from '../format/grid.ts';
import { encodeTile, FORMAT_VERSION } from '../format/tileFormat.ts';
import { encodeGraph, GRAPH_VERSION } from '../format/graph.ts';
import { osmExtract, run } from './sources.ts';
import { readOsm } from './osmData.ts';
import { bakeElevation } from './elevation.ts';
import { bakeElevationV5 } from './elevationV5.ts';
import { mapConfig } from './config.ts';
import { DRIVABLE } from './roads.ts';
import { sampleGrid } from './terrain.ts';
import { terrainBaseV4, shapeRoadsV4 } from './terrainV4.ts';
import { tileBuilder } from './tiles.ts';
import { mergeBuildings } from './buildingMerge.ts';
import { overtureRows } from './overture.ts';
import { labels } from './details.ts';
import { tileBuilderV4 } from './tilesV4.ts';
import { encodePool } from './encodePool.ts';
import { buildRoadModel } from '../model/index.ts';
import { exclusionMask, surfaceIndex } from '../model/mask.ts';
import { treesV4, barriersV4 } from '../model/props.ts';
import { placeLamps, roadLit, LAMP_STRIDE } from '../model/lamps.ts';
import { checkSurface } from '../model/checks.ts';
import { auditTile } from '../collision/audit.ts';

export const BAKE_VERSION = 4;
const EMPTY = { positions: [], colours: [], indices: [], surfaces: [], segOf: [] }, NAMELESS = { name: null, rank: 0, width: 0, s: [0], xs: [], zs: [], h: [] };
const args = process.argv.slice(2), opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

// blocks: { tiles, pad } in place of data/map/v4.json's bake.blockTiles / blockPad — the same tiles whatever they are
// (tests/map/map.test.ts --map v4 checks that)
// (map: 'v5' bakes Map v5 — map/bake/bakeV5.ts — on the same pipeline: data/map/v5.json over v4.json, Map v5's elevation
// and everything Map v5 adds, into assets/map/<region>/v5/)
export async function bakeV4({ regionId, area = null as string | null, out = null as string | null, blocks: blockOpt = null as null | { tiles?: number; pad?: number }, map = 'v4' as 'v4' | 'v5', log = (s: string) => console.log(s) }) {
  const t0 = performance.now();
  let peak = 0;
  const lap = (s: string) => { const rss = process.memoryUsage().rss / 1e9; peak = Math.max(peak, rss); log(`${s} (${((performance.now() - t0) / 1000).toFixed(0)} s, ${rss.toFixed(1)} GB)`); };
  const region = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/map/regions', `${regionId}.json`), 'utf8'));
  const v3cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/map/bake.json'), 'utf8')), cfg = mapConfig(map), v5 = map === 'v5';
  const [w, s, e, n] = region.bbox, P = transverseMercator(+((s + n) / 2).toFixed(6), +((w + e) / 2).toFixed(6));
  const cacheDir = path.join(ROOT, '.cache/map', region.id), v3dir = path.join(ROOT, 'assets/map', region.id), outDir = out ?? path.join(v3dir, map);
  fs.mkdirSync(cacheDir, { recursive: true });
  for (const d of ['tiles', 'far']) { fs.rmSync(path.join(outDir, d), { recursive: true, force: true }); fs.mkdirSync(path.join(outDir, d), { recursive: true }); }
  const corners = [[s, w], [s, e], [n, w], [n, e]].map(([la, lo]) => P.toXZ(la, lo));
  let bounds: [number, number, number, number] = [Math.min(...corners.map(c => c[0])), Math.min(...corners.map(c => c[1])), Math.max(...corners.map(c => c[0])), Math.max(...corners.map(c => c[1]))];
  if (area) { const [la, lo, km] = area.split(',').map(Number), [x, z] = P.toXZ(la, lo), r = km * 500; bounds = [x - r, z - r, x + r - 1e-6, z + r - 1e-6]; }
  const grid = gridFor(bounds, region.tileSize, region.cell), T = grid.tileSize;
  const gx1 = grid.x0 + (grid.W - 1) * grid.cell, gz1 = grid.z0 + (grid.H - 1) * grid.cell;
  const inArea = (x: number, z: number) => x >= grid.x0 && x <= gx1 && z >= grid.z0 && z <= gz1;
  log(`Map ${map}: ${region.name}, ${(grid.i1 - grid.i0 + 1) * (grid.j1 - grid.j0 + 1)} tiles of ${T} m, heights every ${grid.cell} m (${grid.W} × ${grid.H}); roads: ${cfg.model}`);

  // 1. OpenStreetMap, and the vector map (v3's, when it's there and newer than the extract)
  const osmSrc = await osmExtract(region, { cacheDir, log });
  lap(`  OSM: ${osmSrc.source} (${osmSrc.url})`);
  let pmtiles = path.join(v3dir, 'map.pmtiles');
  if (!fs.existsSync(pmtiles) || fs.statSync(pmtiles).mtimeMs < fs.statSync(osmSrc.file).mtimeMs) {
    pmtiles = path.join(outDir, 'map.pmtiles');
    run('java', ['-Xmx4g', '-jar', path.join(ROOT, '.cache/map/tools/planetiler.jar'), 'generate-custom', `--schema=${path.join(ROOT, 'map/bake/planetiler.yml')}`, `--osm_path=${osmSrc.file}`, `--output=${pmtiles}`, `--tmpdir=${path.join(cacheDir, 'planetiler')}`, '--force', '--minzoom=8', '--maxzoom=14'], { log, quiet: true });
  }
  const pmtilesRel = path.relative(outDir, pmtiles).split(path.sep).join('/');
  const osm = readOsm(osmSrc.file, P);
  lap(`  OSM read: ${osm.roads.length} roads, ${osm.areas.length} areas, ${osm.lines.length} lines, ${osm.points.length} points; vector map ${pmtilesRel}`);

  // 2. elevation (Copernicus corrected under buildings and road corridors), as v3
  const mask = path.join(cacheDir, `dsm-mask-${grid.i0}_${grid.j0}_${grid.i1}_${grid.j1}.geojson`);
  if (!fs.existsSync(mask)) {
    const [bx0, bz0, bx1, bz1] = [grid.x0 - 50, grid.z0 - 50, gx1 + 50, gz1 + 50];
    const inB = (p: any) => p.x >= bx0 && p.x <= bx1 && p.z >= bz0 && p.z <= bz1, feats: any[] = [];
    for (const a of osm.areas) if (a.tags.building && a.parts[0][0].some(inB)) for (const part of a.parts) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: part.map(r => r.map(p => [+p.x.toFixed(2), +(-p.z).toFixed(2)])) } });
    for (const r of osm.roads) if (DRIVABLE.has(r.tags.highway) && r.nodes.some(inB)) for (let q = 0; q + 1 < r.nodes.length; q++) {
      const a = r.nodes[q], b = r.nodes[q + 1], l = Math.hypot(b.x - a.x, b.z - a.z) || 1, hw = 6, nx = -(b.z - a.z) / l * hw, nz = (b.x - a.x) / l * hw;
      feats.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[a.x + nx, -(a.z + nz)], [b.x + nx, -(b.z + nz)], [b.x - nx, -(b.z - nz)], [a.x - nx, -(a.z - nz)], [a.x + nx, -(a.z + nz)]].map(p => p.map(v => +v.toFixed(2)))] } });
    }
    fs.writeFileSync(mask, JSON.stringify({ type: 'FeatureCollection', features: feats }));
  }
  const E: any = v5 && region.demV5 ? await bakeElevationV5({ region, grid, P, cacheDir, mask, cfg: cfg.elevation, log }) : await bakeElevation({ region, grid, P, cacheDir, mask, log });
  const demAt = (x: number, z: number) => sampleGrid(grid, E.heights, x, z);
  // (the road model's ground: the elevation blurred over demBlur m — a 30 m source's resampling and what's left of the
  // buildings a surface model sees are no road's hills)
  // (and opened first — the least within demOpen m, then the most of that: what's left of buildings and trees, bumps
  // narrower than that, gone; slopes and hills kept)
  let demSmooth: Float32Array | null = blurGrid(openGrid(E.heights, grid.W, grid.H, Math.max(1, Math.round(cfg.heights.demOpen / grid.cell))), grid.W, grid.H, Math.max(1, Math.round(cfg.heights.demBlur / grid.cell)));
  // (Map v5: on bare-earth LiDAR the road's ground is the DEM itself — smoothed along the road only, by the road model;
  // the surface model's opening and 2D blur fade in only as the LiDAR's weight fades out)
  if (v5 && cfg.heights.lidarAlongRoad && E.lidar) for (let k = 0; k < demSmooth.length; k++) { const l = E.lidar[k] / 255; if (l > 0) demSmooth[k] = l * E.heights[k] + (1 - l) * demSmooth[k]; }
  const roadDemAt = (x: number, z: number) => sampleGrid(grid, demSmooth!, x, z);
  lap(`  elevation: ${E.sources.map((d: any) => `${d.name} (${d.resolution} m; ${d.conversion})`).join(' + ')}${E.stats ? `; LiDAR ${(E.stats.lidarShare * 100).toFixed(1)}% of the grid (${E.stats.rejected} cells of the 5 m tiles rejected), Copernicus capped by DEM-S at ${(E.stats.cappedShare * 100).toFixed(1)}%` : ''}`);

  // 3. the road model for the whole area — graph, widths, junctions, heights — (the roads reaching into it, and a
  // little beyond: junctions at its edge whole); its surface is built a block at a time, below
  const pad = 600, near = (p: any) => p.x >= grid.x0 - pad && p.x <= gx1 + pad && p.z >= grid.z0 - pad && p.z <= gz1 + pad;
  const model: any = buildRoadModel({ roads: osm.roads.filter(r => r.nodes.some(near)), points: osm.points.filter(near), lines: v5 ? osm.lines.filter(l => l.tags.railway && l.nodes.some(near)) : [], demAt: roadDemAt, cfg, v3roads: v3cfg.roads, tileSize: T, P, style: region.markings ?? 'AU', log, withSurface: false });
  for (const g of model.segs) g.width = g.visual;
  demSmooth = null;
  lap(`  road model ${model.version}: ${model.segs.length} segments, ${model.clusters.length} junction patches`);

  // 4. what doesn't need the roads: the ground (land use, water, car parks — the roads are shaped in below, block by
  // block), the buildings (Overture's merged with OSM's)
  const Tn = terrainBaseV4({ grid, dem: E.heights, osm, v3cfg });
  const groundAt = (x: number, z: number) => sampleGrid(grid, Tn.heights, x, z);
  const cellAt = (x: number, z: number) => { const c = Math.round((x - grid.x0) / grid.cell), r = Math.round((z - grid.z0) / grid.cell); return c >= 0 && r >= 0 && c < grid.W && r < grid.H ? r * grid.W + c : -1; };
  const ov = await overtureRows({ release: region.overture.release, theme: 'buildings', type: 'building', bbox: (() => { const a = P.toLatLon(grid.x0, gz1), b = P.toLatLon(gx1, grid.z0); return [a[1], a[0], b[1], b[0]]; })(), columns: ['id', 'class', 'subtype', 'height', 'min_height', 'num_floors', 'roof_shape', 'roof_height', 'roof_color', 'facade_color', 'is_underground', 'sources'], cacheDir: path.join(ROOT, '.cache/map') });
  const buildings = mergeBuildings(osm, ov, P, v3cfg.buildings).filter(b => { const p = b.rings[0][0]; return p[0] >= grid.x0 - 100 && p[0] <= gx1 + 100 && p[1] >= grid.z0 - 100 && p[1] <= gz1 + 100; });
  const hs: Record<string, number> = {}; for (const b of buildings) hs[b.hs] = (hs[b.hs] ?? 0) + 1;
  const bays = osm.areas.filter(a => a.tags.amenity === 'parking_space').map(a => a.parts[0][0]);
  lap(`  ground (before the roads): ${Tn.water.length} water areas, ${Tn.parking.length} car parks; buildings ${buildings.length}`);

  // 5. block by block (blockTiles tiles square, and the roads within blockPad m of it): the road surface, the ground
  // shaped under it, the exclusion mask, trees, railings, lamps, names; the block's tiles, each audited (no collider
  // without something drawn) and encoded on the other cores. Every piece of the surface is the same whichever block
  // builds it (the heights and the junctions are the whole area's), so the blocks meet exactly.
  await MeshoptEncoder.ready;
  const pool = await encodePool({ workers: cfg.bake.workers, gzipLevel: cfg.bake.gzipLevel });
  const tiles: any[] = [], shas = new Map<string, string>(), problems: any[] = [], jobs: Promise<void>[] = [];
  const BT = blockOpt?.tiles ?? cfg.bake.blockTiles, BP = blockOpt?.pad ?? cfg.bake.blockPad;
  const bbox = (xs: number[], zs: number[], r: number) => [Math.min(...xs) - r, Math.min(...zs) - r, Math.max(...xs) + r, Math.max(...zs) + r];
  const segBox = model.segs.map((g: any) => bbox(g.xs, g.zs, Math.max(...g.hwL, ...g.hwR) + 2));
  const clusterBox = model.clusters.map((c: any) => { const pts = c.rings.flat(2); return pts.length ? bbox(pts.map((p: number[]) => p[0]), pts.map((p: number[]) => p[1]), 1) : [Infinity, Infinity, -Infinity, -Infinity]; });
  const meets = (b: number[], q: number[]) => b[0] <= q[2] && b[2] >= q[0] && b[1] <= q[3] && b[3] >= q[1];
  const chk = { cracks: 0, overlaps: 0, sampled: 0, folds: 0, triangles: 0 }, st = { trees: 0, treesOff: 0, railMapped: 0, railDropped: 0, railEstimated: 0, lampMapped: 0, lampDropped: 0, lampEstimated: 0, lampTunnel: 0, lamps: 0 };
  // (what's underfoot at a point — the land use — and which roads the lamps' rule lights: every road's, once)
  const classAt = (x: number, z: number) => { const k = cellAt(x, z); return k < 0 ? 'default' : Tn.classNames[Tn.classes[k]]; };
  const litBySeg = new Map<number, boolean>(model.segs.filter((g: any) => !g.internal).map((g: any) => [g.id, roadLit(g, cfg, classAt)]));
  const railStats: any = {}, lampStats: any = {}, hullStats = { trimmed: 0, dropped: 0, paved: 0 }, ms: Record<string, number> = {};
  // (each block's phases, timed: the bake's log)
  const bms: Record<string, number> = {}, timed = <R>(k: string, f: () => R): R => { const a = performance.now(), r = f(); bms[k] = (bms[k] ?? 0) + performance.now() - a; return r; };
  let blocks = 0;
  for (let bj = grid.j0; bj <= grid.j1; bj += BT) for (let bi = grid.i0; bi <= grid.i1; bi += BT) {
    const ti1 = Math.min(grid.i1, bi + BT - 1), tj1 = Math.min(grid.j1, bj + BT - 1);
    const box: [number, number, number, number] = [bi * T, bj * T, (ti1 + 1) * T, (tj1 + 1) * T];
    const inBlock = (x: number, z: number) => x >= box[0] && x < box[2] && z >= box[1] && z < box[3] && inArea(x, z);
    // (the block's buildings: those whose middle is in it, as the tiles take them)
    const bB = buildings.filter(b => { const r = b.rings[0]; let x = 0, z = 0; for (const p of r) { x += p[0]; z += p[1]; } x /= r.length; z /= r.length; return x >= box[0] && x < box[2] && z >= box[1] && z < box[3]; });
    // (how far its buildings stand out past it: the ground is shaped, and kept, that far out — their walls stand on it —
    // and the roads and junctions built are those within blockPad of the block, or within the shaping's reach of that
    // share: every road the shaping sees, and the roads round a long building's far corners)
    const rr = cfg.terrain.margin + cfg.terrain.maxBlend + 2;
    let over = 0;
    for (const b of bB) for (const p of b.rings[0]) over = Math.max(over, box[0] - p[0], p[0] - box[2], box[1] - p[1], p[1] - box[3]);
    const share = Math.max(40, Math.ceil(over) + 2), pad = Math.max(BP, share + rr), reach = [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad];
    const segIds = new Set<number>(model.segs.filter((g: any, k: number) => meets(segBox[k], reach)).map((g: any) => g.id));
    const clusterIds = new Set<number>(model.clusters.filter((c: any, k: number) => meets(clusterBox[k], reach)).map((c: any) => c.id));
    const S = timed('surface', () => model.surfaceFor({ segs: segIds, clusters: clusterIds }));
    const mB = { ...model, segs: model.segs.filter((g: any) => segIds.has(g.id)), clusters: model.clusters.filter((c: any) => clusterIds.has(c.id)), surface: S };
    const c = timed('check', () => checkSurface(S.mesh, { segs: mB.segs, sampleEvery: 3, region: [box[0], box[1], box[2] - 1e-6, box[3] - 1e-6] }));
    chk.cracks += c.crackCount; chk.overlaps += c.overlapCount; chk.sampled += c.sampled; chk.folds += c.folds.length; chk.triangles += c.triangles;
    timed('terrain', () => shapeRoadsV4(Tn, { grid, dem: E.heights, mesh: S.mesh, model: mB, cfg, box: [box[0], box[1], Math.min(box[2], gx1), Math.min(box[3], gz1)], share }));
    const surface = timed('index', () => surfaceIndex(mB)), X = timed('mask', () => exclusionMask(mB, osm, [box[0], box[1], box[2] - 1e-6, box[3] - 1e-6], cfg, T));
    const tr = timed('trees', () => treesV4({ osm, groundAt, onPaved: (x, z) => { const k = cellAt(x, z); return k < 0 || !!Tn.road[k] || !!Tn.parkingCell[k]; }, mask: X, cfg, v3cfg, inArea: inBlock, box }));
    const br = timed('railings', () => barriersV4({ osm, model: mB, groundAt, demAt, surface, cfg, v3cfg, inArea: inBlock, box }));
    const lp = timed('lamps', () => placeLamps({ model: mB, osm, cfg, surface, mask: X, groundAt, classAt, box }));
    // (the block's own lamps: the roads reaching in from round it place some outside it)
    const lamps: number[] = []; for (let k = 0; k < lp.lamps.length; k += LAMP_STRIDE) if (inBlock(lp.lamps[k], lp.lamps[k + 2])) for (let q = 0; q < LAMP_STRIDE; q++) lamps.push(lp.lamps[k + q]);
    // (names on the block's roads, at the drawn road's height; the rest of the area's roads left nameless)
    const lb = timed('labels', () => labels({ nodes: model.nodes as any, segs: model.segs.map((g: any) => (segIds.has(g.id) ? Object.assign(Object.create(g), { h: g.hd ?? g.h }) : NAMELESS)) as any, cfg: v3cfg }));
    st.trees += tr.stats.placed; st.treesOff += tr.stats.rejected; st.lamps += lamps.length / LAMP_STRIDE;
    for (const [k, v] of Object.entries<number>(br.stats)) railStats[k] = (railStats[k] ?? 0) + v;
    for (const [k, v] of Object.entries<number>(lp.stats)) lampStats[k] = (lampStats[k] ?? 0) + v;
    const TB = tileBuilderV4({ map, region, grid, cfg: v3cfg, v4: cfg, heights: Tn.heights, classes: Tn.classes, classNames: Tn.classNames, roadSurface: Tn.roadSurface, surfaceNames: Tn.surfaceNames, cover: Tn.cover, demSource: E.source, demSources: E.sources, water: Tn.water, parking: Tn.parking, parkingCell: Tn.parkingCell, segs: mB.segs, buildings: bB, barriers: br.barriers, trees: tr.trees, labels: lb, bays, model: mB, lamps, mask: X, surface });
    for (let j = bj; j <= tj1; j++) for (let i = bi; i <= ti1; i++) {
      const t = TB.tile(i, j), cx = (i + 0.5) * T, cz = (j + 0.5) * T, a0 = performance.now();
      for (const p of auditTile(t, { cx, cz, surface, barriersCfg: v3cfg.barriers })) if (problems.length < 200) problems.push({ tile: `${i}_${j}`, ...p });
      TB.stats.ms.audit = (TB.stats.ms.audit ?? 0) + performance.now() - a0;
      const entry = { i, j, bytes: 0, dem: t.header.dem.name, resolution: t.header.dem.resolution, landmarks: t.header.landmarks.length, lamps: (t.lists.lamps?.data.length ?? 0) / LAMP_STRIDE };
      tiles.push(entry);
      jobs.push(pool.write(t, path.join(outDir, 'tiles', `${i}_${j}.m3t`)).then(r => { entry.bytes = r.bytes; shas.set(`${i}_${j}`, r.sha); }));
    }
    hullStats.trimmed += TB.stats.hullsTrimmed; hullStats.dropped += TB.stats.hullsDropped; hullStats.paved += TB.stats.pavedDropped;
    for (const [k, v] of Object.entries<number>(TB.stats.ms)) ms[k] = (ms[k] ?? 0) + v;
    const w0 = performance.now();
    await Promise.all(jobs); jobs.length = 0;
    bms.encodeWait = (bms.encodeWait ?? 0) + performance.now() - w0;
    blocks++;
    lap(`    block ${blocks} (tiles ${bi}…${ti1}, ${bj}…${tj1}): ${S.mesh.indices.length / 3 | 0} road triangles, ${(ti1 - bi + 1) * (tj1 - bj + 1)} tiles`);
  }
  if (problems.length) throw new Error(`colliders with nothing drawn there (${problems.length}): ${JSON.stringify(problems.slice(0, 8))}`);
  tiles.sort((p, q) => p.j - q.j || p.i - q.i);
  lap(`  road surface: ${(chk.triangles / 1e6).toFixed(2)}M triangles in ${blocks} blocks; check: ${chk.cracks} cracks, ${chk.overlaps} overlaps (of ${chk.sampled} sampled), ${chk.folds} folded edges; blocks: ${Object.entries(bms).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)} s`).join(', ')}`);
  lap(`  terrain shaped: ${Tn.shaped} grid points under or beside roads; trees ${st.trees} (${st.treesOff} kept off roads, decks and railways); railings ${railStats.mapped} mapped (${railStats.mappedDropped} over a road dropped), ${railStats.estimated} estimated; lamps ${st.lamps} (${lampStats.mapped} mapped, ${lampStats.mappedDropped} on a road dropped, ${lampStats.estimated + lampStats.junction + lampStats.crossing} estimated)`);
  lap(`  tiles: ${tiles.length}, ${(tiles.reduce((a, t) => a + t.bytes, 0) / 1e6).toFixed(1)} MB on ${pool.workers} workers; every collider has something drawn (audited); building colliders cut off a road ${hullStats.trimmed}, dropped ${hullStats.dropped}; car park triangles off the road ${hullStats.paved}; main thread: ${Object.entries(ms).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)} s`).join(', ')}`);
  // the far layer: the whole area's ground and landmarks, once every block's shaped
  const FB = tileBuilder({ region, grid, cfg: v3cfg, heights: Tn.heights, classes: Tn.classes, classNames: Tn.classNames, roadSurface: Tn.roadSurface, surfaceNames: Tn.surfaceNames, cover: Tn.cover, demSource: E.source, demSources: E.sources, water: Tn.water, parking: Tn.parking, parkingCell: Tn.parkingCell, mesh: EMPTY, marks: EMPTY, segs: [], buildings, barriers: {}, trees: [], labels: { labels: [], signs: [], names: [] }, bays: [] } as any);
  const farChunks: any[] = [], FA = FB.FAR;
  for (let b = Math.floor(grid.z0 / FA); b <= Math.floor(gz1 / FA); b++) for (let a = Math.floor(grid.x0 / FA); a <= Math.floor(gx1 / FA); a++) {
    const t = FB.far(a, b), entry = { a, b, bytes: 0, landmarks: t.header.landmarks.length };
    farChunks.push(entry);
    jobs.push(pool.write(t, path.join(outDir, 'far', `${a}_${b}.m3t`)).then(r => { entry.bytes = r.bytes; shas.set(`far_${a}_${b}`, r.sha); }));
  }
  await Promise.all(jobs);
  await pool.close();
  // the navigation graph and the road surface model, from the model
  // (heights: the drawn road's, down its middle)
  const graph = encodeGraph(region.id, model.nodes, model.segs.map((g: any) => ({ ...g, h: g.hd ?? g.h, lanes: g.lanes })));
  fs.writeFileSync(path.join(outDir, 'graph.json.gz'), zlib.gzipSync(JSON.stringify(graph), { level: 9 }));
  const roadModel = roadModelFile(model, region.id, litBySeg);
  fs.writeFileSync(path.join(outDir, 'roadmodel.json.gz'), zlib.gzipSync(JSON.stringify(roadModel), { level: 9 }));
  lap(`  far layer: ${farChunks.length} chunks; road graph: ${graph.segs.length} segments; road model file: ${roadModel.segs.length} roads, ${roadModel.junctions.length} junctions`);

  // 6. the manifest (the version: the inputs and a hash of every file written, in a fixed order)
  const output = crypto.createHash('sha256');
  for (const k of [...shas.keys()].sort()) output.update(k).update(shas.get(k)!);
  const spots = (region.spots ?? []).map((sp: any) => {
    if (sp.auto === 'roundabout') { const f = roundaboutByShape(model.segs); if (!f) return null; const [lat, lon] = P.toLatLon(f.x, f.z); return { ...sp, name: f.name ? `Roundabout, ${f.name}` : 'Roundabout', lat, lon, bearing: f.bearing, estimated: true }; }
    return sp;
  }).filter(Boolean).map((sp: any) => ({ ...sp, xz: P.toXZ(sp.lat, sp.lon).map(v => +v.toFixed(1)) })).filter((sp: any) => inArea(sp.xz[0], sp.xz[1]));
  // (Map v5: Step 0's teleport spots too — ten well-known places and each known Map v4 bug's spot: data/map/v5/spots.json)
  if (v5) { const f = path.join(ROOT, 'data/map/v5/spots.json'); if (fs.existsSync(f)) for (const sp of JSON.parse(fs.readFileSync(f, 'utf8')).spots) { const st = sp.street ?? sp, xz = P.toXZ(st.lat, st.lon); if (inArea(xz[0], xz[1]) && !spots.some((o: any) => o.id === sp.id)) spots.push({ id: sp.id, name: sp.name.replace(/^[^:]*: /, ''), kind: sp.bug ? `bug ${sp.bug}` : sp.name.split(':')[0].toLowerCase(), lat: st.lat, lon: st.lon, bearing: st.bearing ?? 0, xz: xz.map(v => +v.toFixed(1)) }); } }
  // (and a quick-travel spot at every known bad spot in the area: MAP_README.md, "Bad spots")
  const bad = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/map/known-bad-spots.json'), 'utf8')).spots ?? []; } catch { return []; } })();
  bad.filter((b: any) => b.region === region.id).forEach((b: any, k: number) => { const xz = P.toXZ(b.lat, b.lon); if (inArea(xz[0], xz[1])) spots.push({ id: `bad${k + 1}`, name: `Bad spot ${k + 1}: ${b.road ?? b.note?.slice(0, 40) ?? ''}`, kind: 'known bad spot', lat: b.lat, lon: b.lon, bearing: b.bearing ?? 0, xz: xz.map(v => +v.toFixed(1)), badSpot: true }); });
  const places = osm.points.filter(p => ['city', 'town', 'borough', 'suburb', 'neighbourhood', 'quarter', 'village'].includes(p.tags.place) && p.tags.name).map(p => ({ name: p.tags.name, kind: p.tags.place, xz: [Math.round(p.x), Math.round(p.z)] }));
  const cities = osm.areas.filter(a => a.tags.boundary === 'administrative' && ['6', '8'].includes(a.tags.admin_level) && a.tags.name).map(a => ({ name: a.tags.name, level: +a.tags.admin_level, rings: a.parts.map(p => p[0].filter((_, k, arr) => k % Math.max(1, Math.floor(arr.length / 120)) === 0).map(q => [Math.round(q.x), Math.round(q.z)])) }));
  const [sx, sz] = P.toXZ(region.spawn.lat, region.spawn.lon);
  const inputs = `${BAKE_VERSION}/${FORMAT_VERSION}/${v3cfg.version}/${cfg.version}/${osmSrc.source}:${osmSrc.date}/${region.overture.release}`;
  const manifest = {
    _note: (v5 ? 'Map v5' : 'Map v4') + ' (MAP_README.md): what this baked region holds. Tiles: tiles/<i>_<j>.m3t (map/format/tileFormat.ts, gzipped; header.map "v4"), tile (i, j) covering x ∈ [i·tileSize, (i+1)·tileSize), z (south) likewise, in the projection below. Everything about roads comes from the road surface model (roadmodel.json.gz).',
    map, region: region.id, name: region.name, version: `${inputs}#${output.digest('hex').slice(0, 12)}`, format: FORMAT_VERSION, graphVersion: GRAPH_VERSION, baked: new Date().toISOString().slice(0, 10),
    roadModel: { version: model.version, file: 'roadmodel.json.gz', stats: { segments: model.segs.length, junctionPatches: model.clusters.length, triangles: chk.triangles, blocks, check: { cracks: chk.cracks, overlaps: chk.overlaps, sampled: chk.sampled, folds: chk.folds } } },
    projection: { type: 'transverse-mercator', lat0: P.lat0, lon0: P.lon0, ellipsoid: 'WGS84', proj4: P.proj4, axes: 'x east, z south, y up (metres)' },
    grid: { tileSize: T, cell: grid.cell, i0: grid.i0, j0: grid.j0, i1: grid.i1, j1: grid.j1 }, bbox: region.bbox,
    spawn: { ...region.spawn, xz: [+sx.toFixed(1), +sz.toFixed(1)] },
    sources: {
      osm: { source: osmSrc.source, url: osmSrc.url, date: osmSrc.date, note: osmSrc.source === 'overture' ? 'OpenStreetMap data as published by Overture Maps (its transportation and base themes keep OSM geometry and tags); a Geofabrik extract replaces it when reachable' : 'Geofabrik extract, clipped with osmium' },
      overture: { release: region.overture.release, used: 'building heights, floors, roof shapes and colours; buildings OSM lacks' },
      elevation: E.sources, ...(E.stats && { elevationStats: E.stats }), verticalDatum: 'EGM2008 (EPSG:3855)', blendBand: v5 ? cfg.elevation.blendBand : region.dem.blendBand,
      tools: { planetiler: '0.8.4', gdal: run('gdalinfo', ['--version'], { quiet: true }).trim(), osmium: run('osmium', ['--version'], { quiet: true }).split('\n')[0] },
    },
    attribution: [
      { name: 'OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright', licence: 'ODbL 1.0' },
      { name: 'Overture Maps Foundation', url: 'https://overturemaps.org', licence: 'ODbL 1.0 (OSM-derived themes), CDLA Permissive 2.0 (buildings)' },
      ...E.sources.map((d: any) => ({ name: d.name, url: null, licence: d.licence, text: d.attribution })),
    ],
    surfaces: Object.fromEntries(Object.entries(v3cfg.surfaces).filter(([k]) => !k.startsWith('_'))),
    barriers: v3cfg.barriers, lamps: cfg.lamps,
    files: { graph: 'graph.json.gz', map: pmtilesRel, roadModel: 'roadmodel.json.gz' },
    far: { size: FA, chunks: farChunks },
    spots, places, cities,
    stats: { buildings: buildings.length, buildingHeights: hs, roads: model.segs.length, junctions: model.clusters.length, trees: st.trees, lamps: st.lamps, lampStats, railings: railStats, peakMemoryGB: +peak.toFixed(1), bakeSeconds: Math.round((performance.now() - t0) / 1000) },
    tiles,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  lap(`Wrote ${path.relative(ROOT, outDir)}/manifest.json`);
  return manifest;
}

// a grid opened: its least within r cells (a square), then the most of that within r — bumps narrower than 2r + 1 cells
// cut off, everything else as it was
function openGrid(a: Float32Array, W: number, H: number, r: number) {
  const pass = (src: Float32Array, fn: (x: number, y: number) => number) => {
    const t = new Float32Array(src.length), o = new Float32Array(src.length);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { let v = src[j * W + i]; for (let k = Math.max(0, i - r); k <= Math.min(W - 1, i + r); k++) v = fn(v, src[j * W + k]); t[j * W + i] = v; }
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { let v = t[j * W + i]; for (let k = Math.max(0, j - r); k <= Math.min(H - 1, j + r); k++) v = fn(v, t[k * W + i]); o[j * W + i] = v; }
    return o;
  };
  return pass(pass(a, Math.min), Math.max);
}

// a grid blurred: three passes of a box r cells either way, along rows then columns (near enough a Gaussian of r cells)
function blurGrid(a: Float32Array, W: number, H: number, r: number) {
  let src = Float32Array.from(a), dst = new Float32Array(a.length);
  const pass = (n: number, m: number, at: (i: number, j: number) => number) => {
    for (let j = 0; j < m; j++) {
      let sum = 0; const w = 2 * r + 1;
      for (let i = -r; i <= r; i++) sum += src[at(Math.max(0, Math.min(n - 1, i)), j)];
      for (let i = 0; i < n; i++) { dst[at(i, j)] = sum / w; sum += src[at(Math.min(n - 1, i + r + 1), j)] - src[at(Math.max(0, i - r), j)]; }
    }
    [src, dst] = [dst, src];
  };
  for (let k = 0; k < 3; k++) { pass(W, H, (i, j) => j * W + i); pass(H, W, (i, j) => i * W + j); }
  return src;
}

// the road surface model as its own file, for the tests, the navigation and anything else that wants roads: every road
// (its centre line, heights, widths each side, trims, class, structure…) and every junction patch (its outline and plane)
function roadModelFile(model: any, region: string, litBySeg: Map<number, boolean>) {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    version: model.version, region,
    segs: model.segs.map((g: any) => ({ id: g.id, from: g.from, to: g.to, way: g.osmWay, name: g.name, class: g.cls, link: g.link, rank: g.rank, oneway: g.oneway, lanes: g.lanes, lanesEstimated: g.lanesEstimated, drivable: r2(g.drivable), visual: r2(g.visual), widthEstimated: g.widthEstimated, adjusted: g.adjusted, structure: g.structure, layer: g.layer, surface: g.surface, lit: g.lit, lamps: litBySeg.get(g.id) ? 1 : 0, internal: g.internal, trim: [r2(g.trim0), r2(g.trim1)],
      points: g.xs.flatMap((x: number, k: number) => [r2(x), r2(g.zs[k]), r2((g.hd ?? g.h)[k])]), half: g.hwL.flatMap((v: number, k: number) => [r2(v), r2(g.hwR[k])]), osm: g.orig.map((o: boolean, k: number) => (o ? [k, g.osmNodes[k], g.lat[k], g.lon[k]] : null)).filter(Boolean) })),
    nodes: model.nodes.map((n: any) => [r2(n.x), r2(n.z), r2(n.h ?? 0), n.kind === 'junction' ? 2 : n.kind === 'joint' ? 1 : 0, n.cluster ?? -1]),
    junctions: model.clusters.map((c: any) => ({ id: c.id, nodes: c.nodes, plane: c.plane && { cx: r2(c.plane.cx), cz: r2(c.plane.cz), a: +c.plane.a.toFixed(5), b: +c.plane.b.toFixed(5), c: r2(c.plane.c), ...(c.plane.qa && { qa: +c.plane.qa.toExponential(4), qb: +c.plane.qb.toExponential(4), qc: +c.plane.qc.toExponential(4) }) }, arms: c.arms.map((A: any) => [A.seg.id, A.atStart ? 1 : 0, r2(A.trim)]), rings: c.rings.map((poly: number[][][]) => poly.map(r => r.flatMap(p => [r2(p[0]), r2(p[1])]))) })),
  };
}

// a roundabout found by its shape (as v3): a loop of one-way roads 40–250 m round, at most 6 segments, nearly a circle
function roundaboutByShape(segs: any[]) {
  const outs = new Map<number, { seg: any; fwd: boolean; to: number }[]>();
  for (const sg of segs) { if (!sg.oneway || sg.structure !== 'ground') continue; const fwd = sg.oneway > 0, from = fwd ? sg.from : sg.to, to = fwd ? sg.to : sg.from; (outs.get(from) ?? outs.set(from, []).get(from)!).push({ seg: sg, fwd, to }); }
  const len = (sg: any) => sg.s[sg.s.length - 1];
  let best: any = null;
  for (const [start, edges] of [...outs].sort((p, q) => p[0] - q[0])) for (const e0 of edges) {
    const walk = (node: number, path0: any[], L: number) => {
      if (L > 250 || path0.length > 6) return;
      if (node === start && path0.length) {
        if (L < 40) return;
        const pts: number[][] = [];
        for (const e of path0) { const n = e.seg.xs.length; for (let k = 0; k < n - 1; k++) { const q = e.fwd ? k : n - 1 - k; pts.push([e.seg.xs[q], e.seg.zs[q]]); } }
        let A = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) A += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
        const Q = 4 * Math.PI * Math.abs(A / 2) / (L * L), id = Math.min(...path0.map(e => e.seg.id));
        if (Q >= 0.75 && (!best || Q > best.Q + 1e-9 || (Math.abs(Q - best.Q) <= 1e-9 && id < best.id))) { const b1 = pts[1] ?? pts[0]; best = { Q, id, x: pts[0][0], z: pts[0][1], bearing: Math.round((Math.atan2(b1[0] - pts[0][0], -(b1[1] - pts[0][1])) * 180 / Math.PI + 360) % 360), name: path0.map(e => e.seg.name).find(Boolean) ?? null }; }
        return;
      }
      for (const e of outs.get(node) ?? []) if (!path0.includes(e)) walk(e.to, [...path0, e], L + len(e.seg));
    };
    walk(e0.to, [e0], len(e0.seg));
  }
  return best;
}

if (process.argv[1]?.endsWith('map/bake/bakeV4.ts')) {
  const bt = opt('--block-tiles'), bp = opt('--block-pad');
  bakeV4({ regionId: opt('--region') ?? 'adelaide', area: opt('--area'), out: opt('--out'), blocks: bt || bp ? { tiles: bt ? +bt : undefined, pad: bp ? +bp : undefined } : null }).catch(e => { console.error(e); process.exit(1); });
}
void encodeTile;
