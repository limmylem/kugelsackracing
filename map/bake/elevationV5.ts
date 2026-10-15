// Map v5's elevation (MAP_V5_DIAGNOSIS.md, "Terrain accuracy"): the region's best ground, every source warped onto the
// region's height grid by GDAL in its transverse Mercator and into one vertical datum (EGM2008; AHD by AUSGeoid2020,
// EGM96 by its own grid), then combined in TypeScript, best first:
//   1. local LiDAR (ELVIS's 1 m DEM tiles, when there are any in the source's folder): bare earth
//   2. Geoscience Australia's 5 m LiDAR DEM through AWS's terrain tiles — only where it's the 5 m data itself (the tiles
//      have coarser data upsampled into the hills: a block whose rows are straight between posts isn't) and not in the
//      blend band at its survey's edge (where it can be tens of metres low against both 30 m models)
//   3. Copernicus GLO-30, a surface model, its building footprints and road corridors cut out and refilled from round
//      them (as Map v3/v4), and its tree canopy capped by GA's vegetation-removed DEM-S (at most canopyCap m over it)
// A better source fades into the next over blendBand m inside its edge. Also kept: each point's LiDAR weight (1 on
// LiDAR, fading to 0), so the road model smooths a surface model and not bare earth (map/bake/bakeV4.ts roadDemAt).
//
//   const E = await bakeElevationV5({ region, grid, P, cacheDir, mask, cfg: v5.elevation, log })
//   E.heights, E.source (0 sea, 1 LiDAR, 2 Copernicus, 3 blend, 4 Copernicus capped by DEM-S), E.lidar (0–1),
//   E.sources ([{ name, kind, resolution, datum, conversion, licence, attribution }]), E.stats

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fromFile } from 'geotiff';
import { run } from './sources.ts';
import { type Grid, rasterExtent } from '../format/grid.ts';
import type { Projection } from '../format/projection.ts';

export const SOURCE5 = { sea: 0, lidar: 1, copernicus: 2, blend: 3, capped: 4 };
const NODATA = -9999;

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
async function readRaster(file: string): Promise<Float32Array> {
  const raw = `${file}.f32.bin`;
  if (fs.existsSync(raw) && fs.statSync(raw).mtimeMs >= fs.statSync(file).mtimeMs) { const b = fs.readFileSync(raw); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
  const t = await fromFile(file), im = await t.getImage(), [d] = await im.readRasters() as any;
  const a = Float32Array.from(d); fs.writeFileSync(raw, Buffer.from(a.buffer)); return a;
}
async function fetchTo(url: string, file: string) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return true;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 404 || r.status === 403) return false;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + '.part', new Uint8Array(await r.arrayBuffer())); fs.renameSync(file + '.part', file); return true;
    } catch (e) { if (i === 3) throw e; await new Promise(r => setTimeout(r, 1000 * 2 ** i)); }
  }
  return false;
}
const tileXY = (lat: number, lon: number, z: number) => { const n = 2 ** z; return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n)]; };

// the files of a source, local or fetched into demDir (and for the terrain tiles, which of their pixels are the source's
// own data: a byte mask beside each, 1 where a block of `block` px has native detail)
async function sourceFiles(S: any, bbox: number[], demDir: string, cfg: any, log: (s: string) => void) {
  const [w, s, e, n] = bbox, m = 0.01;
  if (S.kind === 'lidar-local') {
    const dir = path.join(demDir, S.dir);
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.(tif|tiff|asc|flt)$/i.test(f)).sort().map(f => path.join(dir, f)) : [];
  }
  if (S.kind === 'terrain-tiles') {
    const [x0, y0] = tileXY(n + m, w - m, S.zoom), [x1, y1] = tileXY(s - m, e + m, S.zoom), dir = path.join(demDir, `tilezen${S.zoom}`), out: string[] = [];
    const want: [number, number][] = []; for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) want.push([x, y]);
    let got = 0;
    for (let k = 0; k < want.length; k += 8) await Promise.all(want.slice(k, k + 8).map(async ([x, y]) => { const f = path.join(dir, `${x}_${y}.tif`); if (await fetchTo(`${S.url}/${S.zoom}/${x}/${y}.tif`, f)) { out.push(f); got++; } }));
    log(`  ${S.name}: ${got} tiles (z${S.zoom})`);
    return out.sort();
  }
  if (S.kind === 'cog-window') {
    const f = path.join(demDir, S.dir, `${S.file.replace(/\.tif$/, '')}_${hash(bbox.join(','))}.tif`);
    if (!fs.existsSync(f)) {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      log(`  ${S.name}: reading a window of ${S.url}…`);
      run('gdal_translate', ['-q', '-projwin', String(w - 0.02), String(n + 0.02), String(e + 0.02), String(s - 0.02), '-co', 'COMPRESS=DEFLATE', '-co', 'TILED=YES', `/vsicurl/${S.url}`, f + '.part.tif'], { env: { GDAL_DISABLE_READDIR_ON_OPEN: 'EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS: '.tif', CURL_CA_BUNDLE: process.env.CURL_CA_BUNDLE ?? process.env.SSL_CERT_FILE ?? '' } });
      fs.renameSync(f + '.part.tif', f);
    }
    return [f];
  }
  if (S.kind === 'glo30') {
    const out: string[] = [];
    for (let la = Math.floor(s); la <= Math.floor(n); la++) for (let lo = Math.floor(w); lo <= Math.floor(e); lo++) {
      const name = `Copernicus_DSM_COG_10_${la < 0 ? 'S' : 'N'}${String(Math.abs(la)).padStart(2, '0')}_00_${lo < 0 ? 'W' : 'E'}${String(Math.abs(lo)).padStart(3, '0')}_00_DEM`, f = path.join(demDir, `${name}.tif`);
      if (await fetchTo(`https://copernicus-dem-30m.s3.amazonaws.com/${name}/${name}.tif`, f)) out.push(f);
    }
    return out;
  }
  throw new Error(`unknown elevation source kind ${S.kind}`);
}

// the terrain tiles' native-detail mask, per tile: 1 where a block's rows bend at most of its pixels (bilinear-upsampled
// coarse data is straight between its posts, so its second difference along a row is ~0), written as a raw byte raster
// with a VRT beside it carrying the tile's geotransform — so GDAL warps it onto the grid like the heights
async function nativeMask(files: string[], cfg: any, dir: string) {
  const vrts: string[] = [];
  for (const f of files) {
    const out = path.join(dir, path.basename(f).replace(/\.tif$/, '.native.vrt'));
    vrts.push(out);
    if (fs.existsSync(out)) continue;
    const t = await fromFile(f), im = await t.getImage(), W = im.getWidth(), H = im.getHeight(), [a] = await im.readRasters() as any, [ox, , , oy] = [im.getOrigin()[0], 0, 0, im.getOrigin()[1]], [rx, ry] = im.getResolution();
    const B = cfg.nativeBlock, mask = new Uint8Array(W * H);
    for (let by = 0; by < H; by += B) for (let bx = 0; bx < W; bx += B) {
      let bent = 0, tot = 0;
      for (let y = by; y < Math.min(H, by + B); y += 2) for (let x = bx + 1; x < Math.min(W - 1, bx + B); x++) { const k = y * W + x; if (a[k] <= cfg.seaLevel) continue; tot++; if (Math.abs(a[k + 1] - 2 * a[k] + a[k - 1]) > 1e-3) bent++; }
      const ok = tot > B && bent / tot >= cfg.nativeShare ? 1 : 0;
      if (ok) for (let y = by; y < Math.min(H, by + B); y++) mask.fill(1, y * W + bx, y * W + Math.min(W, bx + B));
    }
    const raw = out.replace(/\.vrt$/, '.u8');
    fs.writeFileSync(raw, mask);
    fs.writeFileSync(out, `<VRTDataset rasterXSize="${W}" rasterYSize="${H}"><SRS>EPSG:3857</SRS><GeoTransform>${ox}, ${rx}, 0, ${oy}, 0, ${ry}</GeoTransform><VRTRasterBand dataType="Byte" band="1" subClass="VRTRawRasterBand"><SourceFilename relativeToVRT="1">${path.basename(raw)}</SourceFilename><ImageOffset>0</ImageOffset><PixelOffset>1</PixelOffset><LineOffset>${W}</LineOffset></VRTRasterBand></VRTDataset>\n`);
  }
  return vrts;
}

// box means of a grid over k × k cells, on the coarse grid (⌈W/k⌉ × ⌈H/k⌉), NaN where under half is valid
function blockMeans(a: Float32Array, W: number, H: number, k: number, valid: (v: number) => boolean) {
  const cw = Math.ceil(W / k), ch = Math.ceil(H / k), sum = new Float64Array(cw * ch), cnt = new Uint32Array(cw * ch);
  for (let r = 0; r < H; r++) { const rb = (r / k | 0) * cw; for (let c = 0; c < W; c++) { const v = a[r * W + c]; if (valid(v)) { sum[rb + (c / k | 0)] += v; cnt[rb + (c / k | 0)]++; } } }
  const out = new Float32Array(cw * ch); for (let q = 0; q < out.length; q++) out[q] = cnt[q] >= k * k / 2 ? sum[q] / cnt[q] : NaN;
  return { m: out, cw, ch };
}
// distance (in cells) from each cell to the nearest cell outside `inside` — two-pass chamfer, capped
function insideDistance(inside: Uint8Array, W: number, H: number, cap: number) {
  const d = new Float32Array(W * H), D1 = 1, D2 = Math.SQRT2;
  for (let k = 0; k < d.length; k++) d[k] = inside[k] ? cap : 0;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) { const k = r * W + c; if (!d[k]) continue; let v = d[k]; if (c > 0) v = Math.min(v, d[k - 1] + D1); if (r > 0) { v = Math.min(v, d[k - W] + D1); if (c > 0) v = Math.min(v, d[k - W - 1] + D2); if (c + 1 < W) v = Math.min(v, d[k - W + 1] + D2); } d[k] = v; }
  for (let r = H - 1; r >= 0; r--) for (let c = W - 1; c >= 0; c--) { const k = r * W + c; if (!d[k]) continue; let v = d[k]; if (c + 1 < W) v = Math.min(v, d[k + 1] + D1); if (r + 1 < H) { v = Math.min(v, d[k + W] + D1); if (c + 1 < W) v = Math.min(v, d[k + W + 1] + D2); if (c > 0) v = Math.min(v, d[k + W - 1] + D2); } d[k] = v; }
  return d;
}

export async function bakeElevationV5({ region, grid, P, cacheDir, mask = null as string | null, cfg, log }: { region: any; grid: Grid; P: Projection; cacheDir: string; mask?: string | null; cfg: any; log: (s: string) => void }) {
  const dir = path.join(cacheDir, 'dem5'), demDir = path.join(cacheDir, '..', 'dem');
  fs.mkdirSync(dir, { recursive: true });
  const projData = [path.resolve(cacheDir, '..', 'proj'), '/usr/share/proj', process.env.PROJ_DATA].filter(Boolean).join(':');
  const env = { PROJ_DATA: projData, PROJ_NETWORK: 'OFF', GDAL_NUM_THREADS: 'ALL_CPUS' };
  const { te, ts } = rasterExtent(grid), target = `${P.proj4} +geoidgrids=us_nga_egm08_25.tif`, key = te.join('_');
  const sources = region.demV5.sources, W = grid.W, H = grid.H, N = W * H;
  const tag = hash(key + JSON.stringify(region.demV5) + JSON.stringify(cfg) + (mask ? fs.statSync(mask).size : ''));
  const outH = path.join(dir, `heights-${tag}.f32`), outS = path.join(dir, `source-${tag}.u8`), outL = path.join(dir, `lidar-${tag}.u8`), outM = path.join(dir, `meta-${tag}.json`);
  // (the sources used, as Map v3's tile builder names them: kind lidar-dtm, dsm — each tile's label takes its name)
  const kindOf = (S: any) => (S.role === 'lidar' ? 'lidar-dtm' : S.role === 'copernicus' ? 'dsm' : 'dtm');
  const described: any[] = [];
  if (fs.existsSync(outH) && fs.existsSync(outS) && fs.existsSync(outL) && fs.existsSync(outM)) {
    const rd = (f: string) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
    const meta = JSON.parse(fs.readFileSync(outM, 'utf8'));
    return { heights: new Float32Array(rd(outH)), source: new Uint8Array(rd(outS)), lidar: new Uint8Array(rd(outL)), sources: meta.sources, stats: meta.stats };
  }
  // ---- every source on the grid (nodata where it has nothing)
  const warp = (inputs: string[], crs: string, name: string, resample: string, type = 'Float32') => {
    const vrt = path.join(dir, `${name}.vrt`), out = path.join(dir, `${name}-${hash(key + inputs.join(','))}.tif`);
    if (!fs.existsSync(out)) {
      run('gdalbuildvrt', ['-q', '-overwrite', vrt, ...inputs], { env, quiet: true });
      run('gdalwarp', ['-q', '-overwrite', '-s_srs', crs, '-t_srs', type === 'Byte' ? P.proj4 : target, '-te', ...te.map(String), '-ts', ...ts.map(String), '-r', resample, '-ot', type, '-dstnodata', type === 'Byte' ? '0' : String(NODATA), '-co', 'COMPRESS=DEFLATE', '-co', 'TILED=YES', vrt, out + '.part.tif'], { env, quiet: true });
      fs.renameSync(out + '.part.tif', out);
    }
    return out;
  };
  const layers: { S: any; h: Float32Array; ok: Uint8Array }[] = [];
  let cop: Float32Array | null = null, dems: Float32Array | null = null, copFile = '';
  for (const S of sources) {
    const files = await sourceFiles(S, region.bbox, demDir, cfg, log);
    if (!files.length) { log(`  ${S.name}: none here`); continue; }
    described.push({ name: S.name, kind: kindOf(S), role: S.role, resolution: S.resolution, datum: S.datum, licence: S.licence, attribution: S.attribution, conversion: S.conversion });
    const res = S.resolution < grid.cell ? 'average' : 'bilinear';
    const file = warp(files, S.crs, `src-${hash(S.name)}`, res), h = await readRaster(file);
    const ok = new Uint8Array(N); for (let k = 0; k < N; k++) ok[k] = h[k] > NODATA + 1 ? 1 : 0;
    if (S.native) {
      // (the terrain tiles: only their native-detail pixels)
      const nat = await readRaster(warp(await nativeMask(files, cfg, path.dirname(files[0])), 'EPSG:3857', `native-${hash(S.name)}`, 'near', 'Byte'));
      for (let k = 0; k < N; k++) if (!(nat[k] > 0.5)) ok[k] = 0;
    }
    if (S.role === 'copernicus') { cop = h; copFile = file; } else if (S.role === 'dems') dems = h; else layers.push({ S, h, ok });
  }
  if (!cop) throw new Error('no Copernicus GLO-30 for the region (MAP_README.md, "Baking a region")');
  // ---- Copernicus fixed as Map v3 / v4 fixed it: under buildings and road corridors cut out and filled again
  let copFixed = cop;
  if (mask) {
    const copTif = path.join(dir, `cop-src-${tag}.tif`), m = path.join(dir, `mask-${tag}.tif`), fixed = path.join(dir, `cop-fixed-${tag}.tif`);
    if (!fs.existsSync(fixed)) {
      run('gdal_rasterize', ['-q', '-burn', '1', '-init', '0', '-te', ...te.map(String), '-ts', ...ts.map(String), '-ot', 'Byte', '-a_srs', P.proj4, mask, m], { env, quiet: true });
      const py = gdalPy();
      run(py, [whichPy('gdal_calc.py'), '--quiet', '--overwrite', '-A', copFile, '-B', m, `--outfile=${copTif}`, `--calc=where(B>0,${NODATA},where(A<=${NODATA + 1},0,A))`, `--NoDataValue=${NODATA}`, '--co=COMPRESS=DEFLATE', '--co=TILED=YES'], { env, quiet: true });
      run(py, [whichPy('gdal_fillnodata.py'), '-q', '-md', '60', '-si', '1', copTif, fixed + '.part.tif'], { env, quiet: true });
      fs.renameSync(fixed + '.part.tif', fixed);
    }
    copFixed = await readRaster(fixed);
  }
  // ---- the fallback: Copernicus, its canopy capped by DEM-S (at most canopyCap m over it), the sea at 0
  const base = new Float32Array(N), src = new Uint8Array(N);
  let capped = 0;
  for (let k = 0; k < N; k++) {
    let v = copFixed[k] > NODATA + 1 ? copFixed[k] : 0;
    if (cop[k] <= NODATA + 1 || cop[k] === 0) { base[k] = 0; src[k] = SOURCE5.sea; continue; }
    src[k] = SOURCE5.copernicus;
    // (capped: still Copernicus to the tiles — SOURCE5.capped is only counted)
    if (dems && dems[k] > NODATA + 1 && v > dems[k] + cfg.canopyCap) { v = dems[k] + cfg.canopyCap; capped++; }
    base[k] = v;
  }
  // ---- the LiDAR layers, best last onto the base, each blended over blendBand inside its edge; the terrain tiles
  // checked first at 30 m against both 30 m models near their own edge (the survey's blend band)
  const heights = base, lidar = new Uint8Array(N), cell = grid.cell, band = cfg.blendBand / cell;
  const stats: any = { cells: N, capped, lidar: 0, rejected: 0 };
  for (const L of [...layers].reverse()) {
    const ok = L.ok;
    if (L.S.native) {
      // (against Copernicus with its buildings taken out — the city's towers aren't ground — and DEM-S, at 30 m)
      const k30 = Math.max(1, Math.round(cfg.agreeScale / cell)), A = blockMeans(L.h, W, H, k30, v => v > NODATA + 1), C = blockMeans(copFixed, W, H, k30, v => v > NODATA + 1), Dm = dems ? blockMeans(dems, W, H, k30, v => v > NODATA + 1) : null;
      // (its coverage, block by block — a block at the grid's edge, part outside it, counts as covered — and the large
      // stretches of land it doesn't cover: connected, at least minUncovered blocks; small holes aren't a survey's edge)
      const cw = A.cw, chh = A.ch, okB = blockMeans(Float32Array.from(ok, v => v), W, H, k30, () => true), landB = blockMeans(copFixed, W, H, k30, v => v > NODATA + 1);
      const unc = new Uint8Array(cw * chh);
      for (let q = 0; q < unc.length; q++) unc[q] = Number.isFinite(okB.m[q]) && okB.m[q] <= 0.5 && landB.m[q] > cfg.seaLevel ? 1 : 0;
      const big = new Uint8Array(unc.length), seen = new Uint8Array(unc.length);
      for (let q0 = 0; q0 < unc.length; q0++) {
        if (!unc[q0] || seen[q0]) continue;
        const comp = [q0]; seen[q0] = 1;
        for (let h = 0; h < comp.length; h++) { const q = comp[h], x = q % cw, y = (q / cw) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy, n2 = Y * cw + X; if (X >= 0 && Y >= 0 && X < cw && Y < chh && unc[n2] && !seen[n2]) { seen[n2] = 1; comp.push(n2); } } }
        if (comp.length >= cfg.minUncovered) for (const q of comp) big[q] = 1;
      }
      const nearEdge = insideDistance(Uint8Array.from(big, v => 1 - v), cw, chh, 1e9), reach = cfg.edgeReach / cfg.agreeScale;
      const bad = new Uint8Array(cw * chh);
      for (let q = 0; q < bad.length; q++) {
        if (big[q] || !(nearEdge[q] <= reach) || !Number.isFinite(A.m[q])) continue;
        const lo = Math.min(C.m[q], Dm ? Dm.m[q] : C.m[q]), hi = Math.max(C.m[q], Dm ? Dm.m[q] : C.m[q]);
        if (A.m[q] < lo - cfg.agreeWithin || A.m[q] > hi + cfg.agreeWithin) bad[q] = 1;
      }
      // (and the blocks round a bad one: erodeBlocks)
      const grow = cfg.erodeBlocks, badG = new Uint8Array(bad.length);
      for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) if (bad[y * cw + x]) for (let dy = -grow; dy <= grow; dy++) for (let dx = -grow; dx <= grow; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < cw && Y < chh) badG[Y * cw + X] = 1; }
      for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) { const k = r * W + c; if (ok[k] && badG[(r / k30 | 0) * cw + (c / k30 | 0)]) { ok[k] = 0; stats.rejected++; } }
      stats.uncoveredBlocks = big.reduce((n, v) => n + v, 0); stats.badBlocks = bad.reduce((n, v) => n + v, 0);
    }
    const d = insideDistance(ok, W, H, band + 1);
    for (let k = 0; k < N; k++) {
      if (!ok[k] || src[k] === SOURCE5.sea && L.h[k] <= cfg.seaLevel) continue;
      const wgt = Math.min(1, d[k] / band);
      heights[k] = wgt * L.h[k] + (1 - wgt) * heights[k];
      lidar[k] = Math.max(lidar[k], Math.round(wgt * 255));
      src[k] = wgt >= 1 ? SOURCE5.lidar : SOURCE5.blend;
      stats.lidar++;
    }
  }
  for (let k = 0; k < N; k++) if (!(heights[k] > -500)) heights[k] = 0;
  // the vertical datum shift each source had, at the region's middle (for the log and the manifest)
  for (const d of described) { const S = sources.find((s: any) => s.name === d.name); d.shift = datumShift(S.crs, P, env); }
  stats.lidarShare = +(stats.lidar / N).toFixed(4); stats.cappedShare = +(capped / N).toFixed(4);
  fs.writeFileSync(outH, Buffer.from(heights.buffer)); fs.writeFileSync(outS, src); fs.writeFileSync(outL, lidar);
  fs.writeFileSync(outM, JSON.stringify({ sources: described, stats }));
  return { heights, source: src, lidar, sources: described, stats };
}

// the height a point at 0 m in a source's vertical datum has in EGM2008, at the region's middle
function datumShift(crs: string, P: Projection, env: Record<string, string>) {
  const vert = crs.split('+')[1];
  if (!vert || vert === '3855') return 0;
  const out = spawnSync('cs2cs', ['-f', '%.4f', '--only-best', `EPSG:4326+${vert}`, 'EPSG:4326+3855'], { input: `${P.lat0} ${P.lon0} 0\n`, encoding: 'utf8', env: { ...process.env, ...env } });
  const v = parseFloat(out.stdout.trim().split(/\s+/)[2]);
  return Number.isFinite(v) ? +v.toFixed(3) : null;
}
function gdalPy() {
  for (const d of ['/usr/lib/python3/dist-packages/osgeo', '/usr/local/lib/python3/dist-packages/osgeo']) {
    const so = fs.existsSync(d) ? fs.readdirSync(d).find(f => /^_gdal\.cpython-3\d+/.test(f)) : null, v = so?.match(/cpython-3(\d+)/)?.[1];
    if (v && fs.existsSync(`/usr/bin/python3.${v}`)) return `/usr/bin/python3.${v}`;
  }
  return process.env.GDAL_PYTHON ?? 'python3';
}
function whichPy(cmd: string) { for (const d of (process.env.PATH ?? '').split(':')) { const f = path.join(d, cmd); if (fs.existsSync(f)) return f; } return cmd; }
