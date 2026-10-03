// Map v3's bake (MAP_README.md): a region's map, offline, into static files any CDN can serve.
//
//   node map/bake/bake.ts --region sf                       the whole region
//   node map/bake/bake.ts --region sf --area 37.7942,-122.3954,2   a 2 km square round a place (a slice)
//   node map/bake/bake.ts --region sf --out <dir>            somewhere else (the determinism test)
//
// Steps: the OSM extract (Geofabrik, clipped by osmium; or rebuilt from Overture) → Planetiler's vector
// map (PMTiles) → the OSM data read → the elevation (GDAL: datum, blend, DSM correction) → the roads
// (graph, curves, profiles, joined surface) → the terrain shaped round them → buildings (OSM + Overture)
// → railings, trees, names → the tiles, the far layer, the road graph, the manifest.
// Output: assets/map/<region>/ { manifest.json, map.pmtiles, graph.json.gz, tiles/<i>_<j>.m3t, far/<a>_<b>.m3t }

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
import { buildRoads, DRIVABLE } from './roads.ts';
import { shapeTerrain, sampleGrid } from './terrain.ts';
import { mergeBuildings } from './buildingMerge.ts';
import { overtureRows } from './overture.ts';
import { barriers, trees, labels } from './details.ts';
import { tileBuilder } from './tiles.ts';

export const BAKE_VERSION = 1;
const args = process.argv.slice(2), opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

export async function bake({ regionId, area = null as string | null, out = null as string | null, log = (s: string) => console.log(s) }) {
  const t0 = performance.now(), lap = (s: string) => log(`${s} (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
  const region = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/map/regions', `${regionId}.json`), 'utf8'));
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/map/bake.json'), 'utf8'));
  const [w, s, e, n] = region.bbox, P = transverseMercator(+((s + n) / 2).toFixed(6), +((w + e) / 2).toFixed(6));
  const cacheDir = path.join(ROOT, '.cache/map', region.id), outDir = out ?? path.join(ROOT, 'assets/map', region.id);
  fs.mkdirSync(cacheDir, { recursive: true }); fs.mkdirSync(path.join(outDir, 'tiles'), { recursive: true }); fs.mkdirSync(path.join(outDir, 'far'), { recursive: true });
  // the grid: the region, or a square round a place
  const corners = [[s, w], [s, e], [n, w], [n, e]].map(([la, lo]) => P.toXZ(la, lo));
  let bounds: [number, number, number, number] = [Math.min(...corners.map(c => c[0])), Math.min(...corners.map(c => c[1])), Math.max(...corners.map(c => c[0])), Math.max(...corners.map(c => c[1]))];
  if (area) { const [la, lo, km] = area.split(',').map(Number), [x, z] = P.toXZ(la, lo), r = km * 500; bounds = [x - r, z - r, x + r - 1e-6, z + r - 1e-6]; }
  const grid = gridFor(bounds, region.tileSize, region.cell);
  log(`Map v3: ${region.name}, ${(grid.i1 - grid.i0 + 1) * (grid.j1 - grid.j0 + 1)} tiles of ${grid.tileSize} m, heights every ${grid.cell} m (${grid.W} × ${grid.H})`);

  // 1. OpenStreetMap, and the vector map
  const osmSrc = await osmExtract(region, { cacheDir, log });
  lap(`  OSM: ${osmSrc.source} (${osmSrc.url})`);
  const pmtiles = path.join(outDir, 'map.pmtiles');
  if (!fs.existsSync(pmtiles) || fs.statSync(pmtiles).mtimeMs < fs.statSync(osmSrc.file).mtimeMs || process.env.MAP_PLANETILER === 'force') {
    run('java', ['-Xmx4g', '-jar', await planetilerJar(log), 'generate-custom', `--schema=${path.join(ROOT, 'map/bake/planetiler.yml')}`, `--osm_path=${osmSrc.file}`, `--output=${pmtiles}`, `--tmpdir=${path.join(cacheDir, 'planetiler')}`, '--force', '--minzoom=8', '--maxzoom=14'], { log, quiet: true });
  }
  lap(`  vector map: ${path.relative(ROOT, pmtiles)} (${(fs.statSync(pmtiles).size / 1e6).toFixed(1)} MB, Planetiler)`);
  const osm = readOsm(osmSrc.file, P);
  lap(`  OSM read: ${osm.roads.length} roads, ${osm.areas.length} areas, ${osm.lines.length} lines, ${osm.points.length} points`);

  // 2. elevation (Copernicus corrected under buildings and road corridors: the mask)
  const mask = path.join(cacheDir, `dsm-mask-${grid.i0}_${grid.j0}_${grid.i1}_${grid.j1}.geojson`);
  if (!fs.existsSync(mask)) {
    const [bx0, bz0, bx1, bz1] = [grid.x0 - 50, grid.z0 - 50, grid.x0 + (grid.W - 1) * grid.cell + 50, grid.z0 + (grid.H - 1) * grid.cell + 50];
    const inB = (p) => p.x >= bx0 && p.x <= bx1 && p.z >= bz0 && p.z <= bz1, feats: any[] = [];
    for (const a of osm.areas) if (a.tags.building && a.parts[0][0].some(inB)) for (const part of a.parts) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: part.map(r => r.map(p => [+p.x.toFixed(2), +(-p.z).toFixed(2)])) } });
    for (const r of osm.roads) if (DRIVABLE.has(r.tags.highway) && r.nodes.some(inB)) for (let q = 0; q + 1 < r.nodes.length; q++) {
      const a = r.nodes[q], b = r.nodes[q + 1], l = Math.hypot(b.x - a.x, b.z - a.z) || 1, hw = 6, nx = -(b.z - a.z) / l * hw, nz = (b.x - a.x) / l * hw;
      feats.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[a.x + nx, -(a.z + nz)], [b.x + nx, -(b.z + nz)], [b.x - nx, -(b.z - nz)], [a.x - nx, -(a.z - nz)], [a.x + nx, -(a.z + nz)]].map(p => p.map(v => +v.toFixed(2)))] } });
    }
    fs.writeFileSync(mask, JSON.stringify({ type: 'FeatureCollection', features: feats }));
  }
  const E = await bakeElevation({ region, grid, P, cacheDir, mask, log });
  const demAt = (x: number, z: number) => sampleGrid(grid, E.heights, x, z);
  lap(`  elevation: ${E.sources.map(d => `${d.name} (${d.resolution} m; ${d.conversion})`).join(' + ')}`);

  // 3. roads, then the terrain round them
  const R = buildRoads(osm.roads, demAt, cfg.roads);
  lap(`  roads: ${R.nodes.length} nodes, ${R.segs.length} segments, ${R.junctions.length} junctions, ${(R.mesh.indices.length / 3 / 1e6).toFixed(2)} M triangles`);
  const Tn = shapeTerrain({ grid, dem: E.heights, osm, nodes: R.nodes, segs: R.segs, junctions: R.junctions, cfg: cfg.terrain });
  lap(`  terrain shaped: ${Tn.water.length} water areas, ${Tn.parking.length} car parks`);

  // 4. buildings, railings, trees, names
  const ov = await overtureRows({ release: region.overture.release, theme: 'buildings', type: 'building', bbox: (() => { const a = P.toLatLon(grid.x0, grid.z0 + (grid.H - 1) * grid.cell), b = P.toLatLon(grid.x0 + (grid.W - 1) * grid.cell, grid.z0); return [a[1], a[0], b[1], b[0]]; })(), columns: ['id', 'class', 'subtype', 'height', 'min_height', 'num_floors', 'roof_shape', 'roof_height', 'roof_color', 'facade_color', 'is_underground', 'sources'], cacheDir: path.join(ROOT, '.cache/map') });
  const buildings = mergeBuildings(osm, ov, P, cfg.buildings).filter(b => { const p = b.rings[0][0]; return p[0] >= grid.x0 - 100 && p[0] <= grid.x0 + grid.W * grid.cell + 100 && p[1] >= grid.z0 - 100 && p[1] <= grid.z0 + grid.H * grid.cell + 100; });
  const hs: Record<string, number> = {}; for (const b of buildings) hs[b.hs] = (hs[b.hs] ?? 0) + 1;
  lap(`  buildings: ${buildings.length} (${buildings.filter(b => b.source === 'osm').length} OSM footprints, ${buildings.filter(b => b.source === 'overture').length} Overture-only); heights from ${Object.entries(hs).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const bar = barriers({ osm, nodes: R.nodes, segs: R.segs, grid, heights: Tn.heights, dem: E.heights, cfg });
  const tr = trees({ osm, grid, heights: Tn.heights, classes: Tn.classes, hardRoad: Tn.roadSurface, cfg });
  const lb = labels({ nodes: R.nodes, segs: R.segs, cfg });
  const bays = osm.areas.filter(a => a.tags.amenity === 'parking_space').map(a => a.parts[0][0]);
  lap(`  railings: ${Object.entries(bar).map(([k, v]) => `${k} ${v.length / 8}`).join(', ')}; trees ${tr.length / 5}; labels ${lb.labels.length / 6}, signs ${lb.signs.length / 6}`);

  // 5. the tiles, the far layer, the graph
  await MeshoptEncoder.ready;
  const TB = tileBuilder({ region, grid, cfg, heights: Tn.heights, classes: Tn.classes, classNames: Tn.classNames, roadSurface: Tn.roadSurface, surfaceNames: Tn.surfaceNames, cover: Tn.cover, demSource: E.source, demSources: E.sources, water: Tn.water, parking: Tn.parking, parkingCell: Tn.parkingCell, mesh: R.mesh, marks: R.marks, segs: R.segs, buildings, barriers: bar, trees: tr, labels: lb, bays });
  const tiles: any[] = [], output = crypto.createHash('sha256');
  for (let j = grid.j0; j <= grid.j1; j++) for (let i = grid.i0; i <= grid.i1; i++) {
    const t = TB.tile(i, j), bytes = zlib.gzipSync(encodeTile(t, MeshoptEncoder), { level: 9 });
    fs.writeFileSync(path.join(outDir, 'tiles', `${i}_${j}.m3t`), bytes);
    output.update(`${i}_${j}`).update(bytes);
    tiles.push({ i, j, bytes: bytes.length, dem: t.header.dem.name, resolution: t.header.dem.resolution, landmarks: t.header.landmarks.length });
  }
  lap(`  tiles: ${tiles.length}, ${(tiles.reduce((a, t) => a + t.bytes, 0) / 1e6).toFixed(1)} MB`);
  const farChunks: any[] = [], FA = TB.FAR;
  for (let b = Math.floor(grid.z0 / FA); b <= Math.floor((grid.z0 + (grid.H - 1) * grid.cell) / FA); b++) for (let a = Math.floor(grid.x0 / FA); a <= Math.floor((grid.x0 + (grid.W - 1) * grid.cell) / FA); a++) {
    const t = TB.far(a, b), bytes = zlib.gzipSync(encodeTile(t, MeshoptEncoder), { level: 9 });
    fs.writeFileSync(path.join(outDir, 'far', `${a}_${b}.m3t`), bytes);
    output.update(`far_${a}_${b}`).update(bytes);
    farChunks.push({ a, b, bytes: bytes.length, landmarks: t.header.landmarks.length });
  }
  const graph = encodeGraph(region.id, R.nodes, R.segs);
  fs.writeFileSync(path.join(outDir, 'graph.json.gz'), zlib.gzipSync(JSON.stringify(graph), { level: 9 }));
  lap(`  far layer: ${farChunks.length} chunks; road graph: ${graph.segs.length} segments`);

  // 6. the manifest
  const spots = (region.spots ?? []).map(sp => {
    if (sp.auto === 'roundabout') {
      const r = osm.roads.find(w => w.tags.junction === 'roundabout' && DRIVABLE.has(w.tags.highway));
      if (r) { const c = r.nodes[0]; return { ...sp, name: r.tags.name ? `Roundabout, ${r.tags.name}` : 'Roundabout', lat: c.lat, lon: c.lon }; }
      // (no junction tag — Overture's copy of OSM doesn't carry it): the roundest short one-way loop
      const f = roundaboutByShape(R.segs);
      if (!f) return null;
      const [lat, lon] = P.toLatLon(f.x, f.z);
      return { ...sp, name: f.name ? `Roundabout, ${f.name}` : 'Roundabout', lat, lon, bearing: f.bearing, estimated: true };
    }
    return sp;
  }).filter(Boolean).map(sp => ({ ...sp, xz: P.toXZ(sp.lat, sp.lon).map(v => +v.toFixed(1)) })).filter(sp => sp.xz[0] >= grid.x0 && sp.xz[0] <= grid.x0 + (grid.W - 1) * grid.cell && sp.xz[1] >= grid.z0 && sp.xz[1] <= grid.z0 + (grid.H - 1) * grid.cell);
  const places = osm.points.filter(p => ['city', 'town', 'borough', 'suburb', 'neighbourhood', 'quarter', 'village'].includes(p.tags.place) && p.tags.name).map(p => ({ name: p.tags.name, kind: p.tags.place, xz: [Math.round(p.x), Math.round(p.z)] }));
  const cities = osm.areas.filter(a => a.tags.boundary === 'administrative' && ['6', '8'].includes(a.tags.admin_level) && a.tags.name).map(a => ({ name: a.tags.name, level: +a.tags.admin_level, rings: a.parts.map(p => p[0].filter((_, k, arr) => k % Math.max(1, Math.floor(arr.length / 120)) === 0).map(q => [Math.round(q.x), Math.round(q.z)])) }));
  const [sx, sz] = P.toXZ(region.spawn.lat, region.spawn.lon);
  // (and what came out: the browsers' tile caches are kept under this, so a bake that changes any tile —
  // new code, same inputs — replaces their copies)
  const inputs = `${BAKE_VERSION}/${FORMAT_VERSION}/${cfg.version}/${osmSrc.source}:${osmSrc.date}/${region.overture.release}`;
  const manifest = {
    _note: 'Map v3 (MAP_README.md): what this baked region holds. Tiles: tiles/<i>_<j>.m3t (map/format/tileFormat.ts, gzipped), tile (i, j) covering x ∈ [i·tileSize, (i+1)·tileSize), z (south) likewise, in the projection below.',
    map: 'v3', region: region.id, name: region.name, version: `${inputs}#${output.digest("hex").slice(0, 12)}`, format: FORMAT_VERSION, graphVersion: GRAPH_VERSION, baked: new Date().toISOString().slice(0, 10),
    projection: { type: 'transverse-mercator', lat0: P.lat0, lon0: P.lon0, ellipsoid: 'WGS84', proj4: P.proj4, axes: 'x east, z south, y up (metres)' },
    grid: { tileSize: grid.tileSize, cell: grid.cell, i0: grid.i0, j0: grid.j0, i1: grid.i1, j1: grid.j1 }, bbox: region.bbox,
    spawn: { ...region.spawn, xz: [+sx.toFixed(1), +sz.toFixed(1)] },
    sources: {
      osm: { source: osmSrc.source, url: osmSrc.url, date: osmSrc.date, note: osmSrc.source === 'overture' ? 'OpenStreetMap data as published by Overture Maps (its transportation and base themes keep OSM geometry and tags); a Geofabrik extract replaces it when reachable' : 'Geofabrik extract, clipped with osmium' },
      overture: { release: region.overture.release, used: 'building heights, floors, roof shapes and colours; buildings OSM lacks' },
      elevation: E.sources, verticalDatum: 'EGM2008 (EPSG:3855)', blendBand: region.dem.blendBand,
      tools: { planetiler: '0.8.4', gdal: run('gdalinfo', ['--version'], { quiet: true }).trim(), osmium: run('osmium', ['--version'], { quiet: true }).split('\n')[0] },
    },
    attribution: [
      { name: 'OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright', licence: 'ODbL 1.0' },
      { name: 'Overture Maps Foundation', url: 'https://overturemaps.org', licence: 'ODbL 1.0 (OSM-derived themes), CDLA Permissive 2.0 (buildings)' },
      ...E.sources.map(d => ({ name: d.name, url: null, licence: d.licence, text: d.attribution })),
    ],
    surfaces: Object.fromEntries(Object.entries(cfg.surfaces).filter(([k]) => !k.startsWith('_'))),
    barriers: cfg.barriers,
    files: { graph: 'graph.json.gz', map: 'map.pmtiles' },
    far: { size: FA, chunks: farChunks },
    spots, places, cities,
    stats: { buildings: buildings.length, buildingHeights: hs, roads: R.segs.length, junctions: R.junctions.length },
    tiles,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  lap(`Wrote ${path.relative(ROOT, outDir)}/manifest.json`);
  return manifest;
}

async function planetilerJar(log) {
  const jar = path.join(ROOT, '.cache/map/tools/planetiler.jar');
  if (fs.existsSync(jar)) return jar;
  log('  downloading Planetiler 0.8.4…');
  const r = await fetch('https://github.com/onthegomap/planetiler/releases/download/v0.8.4/planetiler.jar');
  if (!r.ok) throw new Error(`Planetiler download: HTTP ${r.status} (download it by hand into .cache/map/tools/planetiler.jar)`);
  fs.mkdirSync(path.dirname(jar), { recursive: true });
  fs.writeFileSync(jar, new Uint8Array(await r.arrayBuffer()));
  return jar;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('map/bake/bake.ts')) {
  bake({ regionId: opt('--region') ?? 'sf', area: opt('--area'), out: opt('--out') }).catch(e => { console.error(e); process.exit(1); });
}

// a roundabout found by its shape: a loop of one-way roads 40–250 m round, at most 6 segments, nearly a
// circle (4πA/P² ≥ 0.75). The roundest wins (then the lowest segment id): the same answer every bake.
function roundaboutByShape(segs: any[]) {
  const out = new Map<number, { seg: any; fwd: boolean; to: number }[]>();
  for (const sg of segs) {
    if (!sg.oneway || sg.structure !== 'ground') continue;
    const fwd = sg.oneway > 0, from = fwd ? sg.from : sg.to, to = fwd ? sg.to : sg.from;
    (out.get(from) ?? out.set(from, []).get(from)!).push({ seg: sg, fwd, to });
  }
  const len = (sg: any) => sg.s[sg.s.length - 1];
  let best: any = null;
  for (const [start, edges] of [...out].sort((p, q) => p[0] - q[0])) for (const e0 of edges) {
    const walk = (node: number, path: any[], L: number) => {
      if (L > 250 || path.length > 6) return;
      if (node === start && path.length) {
        if (L < 40) return;
        const pts: number[][] = [];
        for (const e of path) { const n = e.seg.xs.length; for (let k = 0; k < n - 1; k++) { const q = e.fwd ? k : n - 1 - k; pts.push([e.seg.xs[q], e.seg.zs[q]]); } }
        let A = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) A += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
        const Q = 4 * Math.PI * Math.abs(A / 2) / (L * L), id = Math.min(...path.map(e => e.seg.id));
        if (Q >= 0.75 && (!best || Q > best.Q + 1e-9 || (Math.abs(Q - best.Q) <= 1e-9 && id < best.id))) {
          const b1 = pts[1] ?? pts[0];
          best = { Q, id, x: pts[0][0], z: pts[0][1], bearing: Math.round((Math.atan2(b1[0] - pts[0][0], -(b1[1] - pts[0][1])) * 180 / Math.PI + 360) % 360), name: path.map(e => e.seg.name).find(Boolean) ?? null };
        }
        return;
      }
      for (const e of out.get(node) ?? []) if (!path.includes(e)) walk(e.to, [...path, e], L + len(e.seg));
    };
    walk(e0.to, [e0], len(e0.seg));
  }
  return best;
}
