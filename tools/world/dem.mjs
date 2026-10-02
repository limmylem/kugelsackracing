// Elevation for the baker: the ground's height above sea level anywhere in a region, from the best data
// that covers each place. A region can drop in its own high-resolution LiDAR elevation models (GeoTIFF
// DEMs: USGS 3DEP 1 m in the US, the Environment Agency's 1 m in England, LINZ 1 m in New Zealand, ELVIS
// 1 m / 5 m in Australia…, in their own UTM or geographic coordinates); everywhere else, and wherever
// those have holes, Copernicus GLO-30 (30 m, worldwide, on AWS). Files are downloaded once into
// .cache/world/dem/ (or read where they are, for local paths).
//
//   const dem = await openDem(region.dem, { cacheDir, log })
//   const s = await dem.sampler([south, west, north, east])   (reads what covers the box)
//   s.height(lat, lon) → metres (NaN: nothing), s.sourceAt(lat, lon) → the source's name
//   dem.describe() → [{ name, resolution (m), attribution }]

import fs from 'node:fs';
import path from 'node:path';
import { fromFile } from 'geotiff';

const RAD = Math.PI / 180;
export const GLO30 = { name: 'Copernicus GLO-30', resolution: 30, attribution: 'Copernicus DEM © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA' };

// ---------- coordinates: geographic, or UTM (WGS84 326zz / 327zz, NAD83 269zz, ETRS89 258zz) ----------
const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F), EP2 = E2 / (1 - E2), K0 = 0.9996;
function utmForward(lat, lon, zone, south) {
  const phi = lat * RAD, lam0 = ((zone - 1) * 6 - 180 + 3) * RAD, s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
  const N = A / Math.sqrt(1 - E2 * s * s), T = t * t, C = EP2 * c * c, Aa = (lon * RAD - lam0) * c;
  const e4 = E2 * E2, e6 = e4 * E2;
  const M = A * ((1 - E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi - (3 * E2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi) + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi) - (35 * e6 / 3072) * Math.sin(6 * phi));
  const x = K0 * N * (Aa + (1 - T + C) * Aa ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * Aa ** 5 / 120) + 500000;
  const y = K0 * (M + N * t * (Aa * Aa / 2 + (5 - T + 9 * C + 4 * C * C) * Aa ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * Aa ** 6 / 720));
  return [x, south ? y + 10000000 : y];
}
// the GeoTIFF's coordinates: (lat, lon) → [X, Y] in them
function crsOf(keys) {
  const p = keys.ProjectedCSTypeGeoKey, g = keys.GeographicTypeGeoKey;
  if (p) {
    for (const [base, south] of [[32600, false], [32700, true], [26900, false], [25800, false]]) if (p > base && p <= base + 60) { const zone = p - base; return { name: `UTM ${zone}${south ? 'S' : 'N'}`, to: (lat, lon) => utmForward(lat, lon, zone, south) }; }
    throw new Error(`elevation file in EPSG:${p}: only UTM and geographic coordinates are read (reproject it with gdalwarp -t_srs EPSG:4326)`);
  }
  if (!g || [4326, 4269, 4258, 4283, 4167, 4617].includes(g)) return { name: 'geographic', to: (lat, lon) => [lon, lat] };
  throw new Error(`elevation file in EPSG:${g}: not read`);
}

async function localFile(src, cacheDir, log) {
  if (!/^https?:/.test(src)) return src;
  const file = path.join(cacheDir, 'dem', path.basename(new URL(src).pathname));
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    log?.(`  downloading ${path.basename(file)}…`);
    const r = await fetch(src);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`${src}: HTTP ${r.status}`);
    fs.writeFileSync(file + '.part', new Uint8Array(await r.arrayBuffer()));
    fs.renameSync(file + '.part', file);
  }
  return file;
}
// The GLO-30 tiles a box needs (1° each, named by their south-west corner)
function glo30Urls([s, w, n, e]) {
  const out = [];
  for (let la = Math.floor(s); la <= Math.floor(n); la++) for (let lo = Math.floor(w); lo <= Math.floor(e); lo++) {
    const name = `Copernicus_DSM_COG_10_${la < 0 ? 'S' : 'N'}${String(Math.abs(la)).padStart(2, '0')}_00_${lo < 0 ? 'W' : 'E'}${String(Math.abs(lo)).padStart(3, '0')}_00_DEM`;
    out.push(`https://copernicus-dem-30m.s3.amazonaws.com/${name}/${name}.tif`);
  }
  return out;
}

// One elevation file: what it covers, and a window of it read for a box
async function openRaster(file, info) {
  const tiff = await fromFile(file), im = await tiff.getImage(), crs = crsOf(im.getGeoKeys());
  const [ox, oy] = im.getOrigin(), [rx, ry] = im.getResolution(), W = im.getWidth(), H = im.getHeight();
  const isPoint = im.getGeoKeys().GTRasterTypeGeoKey === 2, nodata = im.getGDALNoData();
  const shift = isPoint ? 0 : 0.5;          // (pixel centres)
  const pix = (lat, lon) => { const [X, Y] = crs.to(lat, lon); return [(X - ox) / rx - shift, (Y - oy) / ry - shift]; };
  return {
    ...info, crs: crs.name, resolution: info.resolution ?? Math.abs(rx) * (crs.name === 'geographic' ? 111320 * 0.8 : 1),
    // the pixels covering a box [s, w, n, e] (with a pixel's margin), or null if it misses the file
    async window([s, w, n, e]) {
      const corners = [[s, w], [s, e], [n, w], [n, e]].map(([a, b]) => pix(a, b));
      const c0 = Math.max(0, Math.floor(Math.min(...corners.map(p => p[0]))) - 2), c1 = Math.min(W, Math.ceil(Math.max(...corners.map(p => p[0]))) + 3);
      const r0 = Math.max(0, Math.floor(Math.min(...corners.map(p => p[1]))) - 2), r1 = Math.min(H, Math.ceil(Math.max(...corners.map(p => p[1]))) + 3);
      if (c1 <= c0 || r1 <= r0) return null;
      const [data] = await im.readRasters({ window: [c0, r0, c1, r1], samples: [0] });
      const w_ = c1 - c0, h_ = r1 - r0, bad = v => v === nodata || v < -500 || v > 9000 || Number.isNaN(v);
      return {
        name: info.name,
        // bilinear, NaN where any of the four is missing
        height(lat, lon) {
          const [fx, fy] = pix(lat, lon), x = fx - c0, y = fy - r0, i = Math.floor(x), j = Math.floor(y);
          if (i < 0 || j < 0 || i + 1 >= w_ || j + 1 >= h_) return NaN;
          const tx = x - i, ty = y - j, k = j * w_ + i, a = data[k], b = data[k + 1], c = data[k + w_], d = data[k + w_ + 1];
          if (bad(a) || bad(b) || bad(c) || bad(d)) return NaN;
          return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
        },
      };
    },
  };
}

// config: the region's "dem": { local: [{ name, files: [url | path], resolution, attribution }], base: 'glo30' }
export async function openDem(config = {}, { cacheDir = '.cache/world', bbox = null, log = null } = {}) {
  const rasters = [];
  for (const L of config.local ?? []) for (const f of L.files) { const file = await localFile(f, cacheDir, log); if (file) rasters.push(await openRaster(file, L)); }
  if (config.base !== 'none') for (const u of glo30Urls(bbox ?? [-90, -180, 90, 180])) { const file = await localFile(u, cacheDir, log); if (file) rasters.push(await openRaster(file, GLO30)); }
  return {
    describe: () => [...new Map(rasters.map(r => [r.name, { name: r.name, resolution: r.resolution, attribution: r.attribution }])).values()],
    async sampler(box) {
      const wins = (await Promise.all(rasters.map(r => r.window(box)))).filter(Boolean);
      return {
        // the first source (best first) with a height there; the sea where there's none (GLO-30 has no
        // tiles over open sea)
        height(lat, lon) { for (const w of wins) { const h = w.height(lat, lon); if (!Number.isNaN(h)) return h; } return 0; },
        sourceAt(lat, lon) { for (const w of wins) if (!Number.isNaN(w.height(lat, lon))) return w.name; return 'sea'; },
      };
    },
  };
}
