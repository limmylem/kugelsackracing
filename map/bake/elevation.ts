// Map v3's elevation, made with GDAL: every source warped onto the region's height grid (map/format/
// grid.ts) in its transverse Mercator, with its heights converted to ONE vertical datum (EGM2008) on the
// way — PROJ's geoid grids (GEOID18 for USGS NAVD88, EGM2008 itself for Copernicus) — then
//   · Copernicus GLO-30, a surface model (it has buildings and tree tops in it): the cells under building
//     footprints and road corridors cut out and filled again from the ground round them
//     (gdal_fillnodata), so the roads and the ground under buildings are bare earth;
//   · the best source (a local LiDAR bare-earth DTM) blended into the next over a band at its edge
//     (gdal_proximity: distance inside its coverage), so there's no step where they meet.
// The result: one Float32 grid of heights (m above EGM2008), and which source each point came from.
//
//   const E = await bakeElevation({ region, grid, P, cacheDir, mask, log })
//   E.heights (W×H, row r = z0 + r·cell, north first), E.source (0 sea, 1 LiDAR, 2 Copernicus,
//   3 blend), E.sources ([{ name, kind, resolution, datum, conversion, shift, licence, attribution }])

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fromFile } from 'geotiff';
import { run } from './sources.ts';
import { type Grid, rasterExtent } from '../format/grid.ts';
import type { Projection } from '../format/projection.ts';

export const SOURCE = { sea: 0, lidar: 1, copernicus: 2, blend: 3 };
const NODATA = -9999;

function glo30Urls([w, s, e, n]: number[]) {
  const out = [];
  for (let la = Math.floor(s); la <= Math.floor(n); la++) for (let lo = Math.floor(w); lo <= Math.floor(e); lo++) {
    const name = `Copernicus_DSM_COG_10_${la < 0 ? 'S' : 'N'}${String(Math.abs(la)).padStart(2, '0')}_00_${lo < 0 ? 'W' : 'E'}${String(Math.abs(lo)).padStart(3, '0')}_00_DEM`;
    out.push(`https://copernicus-dem-30m.s3.amazonaws.com/${name}/${name}.tif`);
  }
  return out;
}
async function local(src: string, dir: string, log) {
  if (!/^https?:/.test(src)) return src;
  const file = path.join(dir, path.basename(new URL(src).pathname));
  if (fs.existsSync(file)) return file;
  log(`  downloading ${path.basename(file)}…`);
  const r = await fetch(src);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${src}: HTTP ${r.status}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file + '.part', new Uint8Array(await r.arrayBuffer()));
  fs.renameSync(file + '.part', file);
  return file;
}
async function readRaster(file: string) {
  const tiff = await fromFile(file), im = await tiff.getImage(), [data] = await im.readRasters() as any;
  return data;
}

export async function bakeElevation({ region, grid, P, cacheDir, mask = null as string | null, log }: { region: any; grid: Grid; P: Projection; cacheDir: string; mask?: string | null; log: (s: string) => void }) {
  const dir = path.join(cacheDir, 'dem'), demDir = path.join(cacheDir, '..', 'dem');
  fs.mkdirSync(dir, { recursive: true });
  const projData = [path.resolve(cacheDir, '..', 'proj'), '/usr/share/proj', process.env.PROJ_DATA].filter(Boolean).join(':');
  const env = { PROJ_DATA: projData, PROJ_NETWORK: 'OFF', GDAL_NUM_THREADS: 'ALL_CPUS' };
  // (GDAL's Python tools run with the Python its bindings were installed for: GDAL_PYTHON, or the system's)
  const py = process.env.GDAL_PYTHON ?? gdalPython();
  const gdal = (cmd: string, args: string[]) => cmd.endsWith('.py') ? run(py, [whichPy(cmd), ...args], { log, env, quiet: true }) : run(cmd, args, { log, env, quiet: true });
  const { te, ts } = rasterExtent(grid), target = `${P.proj4} +geoidgrids=us_nga_egm08_25.tif`;
  const key = `${te.join('_')}`;
  const out = path.join(dir, `dem-${hash(key + JSON.stringify(region.dem) + (mask ? fs.statSync(mask).size : ''))}`);
  const described = [];
  const files: Record<string, string> = {};
  for (const [k, S] of region.dem.sources.entries()) {
    const urls: string[] = S.glo30 ? glo30Urls(region.bbox) : S.files;
    const paths = (await Promise.all(urls.map(u => local(u, demDir, log)))).filter(Boolean) as string[];
    if (!paths.length) continue;
    const vrt = path.join(dir, `src${k}.vrt`), warped = path.join(dir, `src${k}-${hash(key)}.tif`);
    if (!fs.existsSync(warped)) {
      gdal('gdalbuildvrt', ['-q', '-overwrite', vrt, ...paths]);
      // (bare-earth LiDAR averaged down to the grid; the 30 m model interpolated up to it)
      gdal('gdalwarp', ['-q', '-overwrite', '-s_srs', S.crs, '-t_srs', target, '-te', ...te.map(String), '-ts', ...ts.map(String), '-r', S.resolution < grid.cell ? 'average' : 'bilinear', '-ot', 'Float32', '-dstnodata', String(NODATA), '-co', 'COMPRESS=DEFLATE', '-co', 'TILED=YES', vrt, warped + '.part.tif']);
      fs.renameSync(warped + '.part.tif', warped);
    }
    files[S.glo30 ? 'cop' : 'lidar'] = warped;
    described.push({ name: S.name, kind: S.kind, resolution: S.resolution, datum: S.datum, licence: S.licence, attribution: S.attribution });
  }
  // the vertical datum shifts, measured at the region's middle (logged and kept in the manifest)
  for (const d of described) {
    const S = region.dem.sources.find(s => s.name === d.name);
    const geo = S.crs.split('+')[0], src = S.crs.includes('+') ? S.crs : `${S.crs}+3855`;
    const geoOf = { 'EPSG:26910': 'EPSG:6318', 'EPSG:4326': 'EPSG:4326' }[geo] ?? 'EPSG:4326';
    const vert = src.split('+')[1];
    const line = `${P.lat0} ${P.lon0} 0\n`;
    const r = (() => { try { return require_cs2cs(`${geoOf}+${vert}`, 'EPSG:4326+3855', line, env); } catch { return null; } })();
    d.shift = r ?? 0;
    d.conversion = vert === '3855' ? 'EGM2008 already (no shift)' : `EPSG:${vert} → EGM2008 (EPSG:3855) via PROJ: ${vert === '5703' ? 'GEOID18 (us_noaa_g2018u0.tif) + EGM2008 (us_nga_egm08_25.tif)' : 'geoid grids'}`;
    log(`  ${d.name}: ${d.conversion}; ${d.shift >= 0 ? '+' : ''}${d.shift.toFixed(3)} m at the region's middle`);
  }
  if (!fs.existsSync(out + '.tif')) {
    const calc = (expr: string, inputs: Record<string, string>, file: string, type = 'Float32', nodata = NODATA) => gdal('gdal_calc.py', ['--quiet', '--overwrite', '--hideNoData', ...Object.entries(inputs).flatMap(([k, f]) => [`-${k}`, f]), `--outfile=${file}`, `--calc=${expr}`, `--type=${type}`, `--NoDataValue=${nodata}`, '--co=COMPRESS=DEFLATE', '--co=TILED=YES']);
    // Copernicus: the sea is 0; under buildings and roads, filled again from round them (a surface
    // model there is roofs and tree tops)
    const tag = hash(key), cop = path.join(dir, `cop-fixed-${tag}.tif`);
    if (files.cop) {
      if (mask) {
        const m = path.join(dir, `mask-${tag}.tif`);
        gdal('gdal_rasterize', ['-q', '-burn', '1', '-init', '0', '-te', ...te.map(String), '-ts', ...ts.map(String), '-ot', 'Byte', '-a_srs', P.proj4, mask, m]);
        calc(`where(B>0,${NODATA},where(A<=${NODATA + 1},0,A))`, { A: files.cop, B: m }, cop);
        gdal('gdal_fillnodata.py', ['-q', '-md', '60', '-si', '1', cop, cop + '.f.tif']);
        fs.renameSync(cop + '.f.tif', cop);
      } else calc(`where(A<=${NODATA + 1},0,A)`, { A: files.cop }, cop);
    }
    if (files.lidar) {
      // how far inside its coverage each point is (the blend's weight), then the blend
      const valid = path.join(dir, `lidar-valid-${tag}.tif`), dist = path.join(dir, `lidar-dist-${tag}.tif`), band = region.dem.blendBand;
      if (fs.existsSync(dist)) fs.rmSync(dist);
      calc(`A>${NODATA + 1}`, { A: files.lidar }, valid, 'Byte', 255);
      // (the edge is where the LiDAR meets Copernicus over land; at the shore there's nothing to blend into)
      const edge = path.join(dir, `lidar-edge-${tag}.tif`);
      if (files.cop) calc('(A==0)*(B!=0)', { A: valid, B: cop }, edge, 'Byte', 255); else calc('A*0', { A: valid }, edge, 'Byte', 255);
      gdal('gdal_proximity.py', ['-q', edge, dist, '-values', '1', '-distunits', 'GEO', '-maxdist', String(band), '-nodata', String(band), '-ot', 'Float32']);
      const w = `minimum(C/${band},1)*(B==1)`;
      if (files.cop) {
        calc(`where(B==1,${w}*A+(1-${w})*D,D)`, { A: files.lidar, B: valid, C: dist, D: cop }, out + '.tif');
        calc(`where(B==1,where(C>=${band},1,3),where(D!=0,2,0))`, { B: valid, C: dist, D: cop }, out + '-src.tif', 'Byte', 255);
      } else {
        calc(`where(B==1,A,0)`, { A: files.lidar, B: valid }, out + '.tif');
        calc(`where(B==1,1,0)`, { B: valid }, out + '-src.tif', 'Byte', 255);
      }
    } else {
      fs.copyFileSync(cop, out + '.tif');
      calc('where(A!=0,2,0)', { A: cop }, out + '-src.tif', 'Byte', 255);
    }
  }
  const heights = Float32Array.from(await readRaster(out + '.tif')), source = Uint8Array.from(await readRaster(out + '-src.tif'));
  for (let k = 0; k < heights.length; k++) if (!(heights[k] > -500)) heights[k] = 0;
  return { heights, source, sources: described, file: out + '.tif', sourceFile: out + '-src.tif' };
}

// the height a point at 0 m in one vertical datum has in another (cs2cs, lat lon order)
function require_cs2cs(from: string, to: string, line: string, env) {
  const r = spawnSync('cs2cs', ['-f', '%.4f', '--only-best', from, to], { input: line, encoding: 'utf8', env: { ...process.env, ...env } });
  const v = parseFloat(r.stdout.trim().split(/\s+/)[2]);
  if (!Number.isFinite(v)) throw new Error(r.stderr);
  return v;
}
// the Python GDAL's bindings were built for (Debian / Ubuntu: osgeo/_gdal.cpython-3XX…)
function gdalPython() {
  for (const dir of ['/usr/lib/python3/dist-packages/osgeo', '/usr/local/lib/python3/dist-packages/osgeo']) {
    const so = fs.existsSync(dir) ? fs.readdirSync(dir).find(f => /^_gdal\.cpython-3\d+/.test(f)) : null;
    const v = so?.match(/cpython-3(\d+)/)?.[1];
    if (v && fs.existsSync(`/usr/bin/python3.${v}`)) return `/usr/bin/python3.${v}`;
  }
  return 'python3';
}
function whichPy(cmd: string) { for (const d of (process.env.PATH ?? '').split(':')) { const f = path.join(d, cmd); if (fs.existsSync(f)) return f; } return cmd; }
function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
