// The real world's collision comes in chunks about a kilometre square, on a fixed grid of latitude and
// longitude (the same chunks wherever the player starts, so they can be cached), and every chunk takes
// its terrain heights from the same fixed lattice of points, so neighbouring chunks agree exactly where
// they meet. Pure data: the page, the Web Worker that builds chunks and the tests all use it.
//
//   chunk rows are CHUNK_UNITS lattice steps tall (≈ 1 km); each row's chunks are about as wide as they
//   are tall there (rowSpan), so a chunk is (j, i): row j from the equator, column i from Greenwich

export const UNIT = 1e-4;            // degrees: the terrain lattice's step, in latitude and in longitude
export const CHUNK_UNITS = 90;       // a chunk's height in lattice steps (≈ 1 km)
export const BLOCK = 64;             // terrain lattice points are sampled in blocks of BLOCK × BLOCK
export const CELL = 2.5;             // m: the collision terrain's grid
export const OVERLAP = 4;            // m: how far each chunk's terrain reaches into its neighbours
export const OSM_MARGIN = 300;       // m round a chunk to fetch map data for (roads out here shape it)
export const WORK_MARGIN = 350;      // m round a chunk to work out road heights over

const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F), RAD = Math.PI / 180;
// metres per degree of latitude / longitude at a latitude (degrees), on the WGS84 ellipsoid
export const mPerDegLat = lat => { const s = Math.sin(lat * RAD); return RAD * A * (1 - E2) / (1 - E2 * s * s) ** 1.5; };
export const mPerDegLon = lat => { const s = Math.sin(lat * RAD); return RAD * A * Math.cos(lat * RAD) / Math.sqrt(1 - E2 * s * s); };

// longitude span of the chunks in row j, in lattice steps
export const rowSpan = j => Math.max(CHUNK_UNITS, Math.round(CHUNK_UNITS / Math.cos((j + 0.5) * CHUNK_UNITS * UNIT * RAD)));

export function chunk(j, i) {
  const span = rowSpan(j), lat0 = j * CHUNK_UNITS * UNIT, lat1 = (j + 1) * CHUNK_UNITS * UNIT, lon0 = i * span * UNIT, lon1 = (i + 1) * span * UNIT;
  return { key: `${j}/${i}`, j, i, lat0, lat1, lon0, lon1, latC: (lat0 + lat1) / 2, lonC: (lon0 + lon1) / 2 };
}
// The chunk a point (degrees) is in
export function chunkAt(lat, lon) {
  const j = Math.floor(lat / (CHUNK_UNITS * UNIT) + 1e-12);
  return chunk(j, Math.floor(lon / (rowSpan(j) * UNIT) + 1e-12));
}
// Every chunk within `radius` metres of a point, nearest first: [{ ...chunk, distance }]
export function chunksAround(lat, lon, radius) {
  const mLat = mPerDegLat(lat), mLon = Math.max(1, mPerDegLon(lat)), dLat = radius / mLat, dLon = radius / mLon, out = [];
  const j0 = Math.floor((lat - dLat) / (CHUNK_UNITS * UNIT)), j1 = Math.floor((lat + dLat) / (CHUNK_UNITS * UNIT));
  for (let j = j0; j <= j1; j++) {
    const span = rowSpan(j) * UNIT;
    for (let i = Math.floor((lon - dLon) / span); i <= Math.floor((lon + dLon) / span); i++) {
      const c = chunk(j, i);
      // distance from the point to the chunk's rectangle
      const dn = Math.max(c.lat0 - lat, 0, lat - c.lat1) * mLat, de = Math.max(c.lon0 - lon, 0, lon - c.lon1) * mLon;
      const distance = Math.hypot(dn, de);
      if (distance <= radius) out.push({ ...c, distance });
    }
  }
  return out.sort((a, b) => a.distance - b.distance);
}

// The chunk's size in metres (east–west at its middle, north–south)
export const chunkSize = c => ({ width: (c.lon1 - c.lon0) * mPerDegLon(c.latC), height: (c.lat1 - c.lat0) * mPerDegLat(c.latC) });

// Lattice blocks (by [bj, bi]) covering a box of degrees, with `pad` extra lattice points round it
export function blocksFor(lat0, lon0, lat1, lon1, pad = 2) {
  const out = [];
  for (let bj = Math.floor((Math.floor(lat0 / UNIT) - pad) / BLOCK); bj <= Math.floor((Math.ceil(lat1 / UNIT) + pad) / BLOCK); bj++)
    for (let bi = Math.floor((Math.floor(lon0 / UNIT) - pad) / BLOCK); bi <= Math.floor((Math.ceil(lon1 / UNIT) + pad) / BLOCK); bi++) out.push([bj, bi]);
  return out;
}
// A block's points in order (row by row, south to north; west to east along each): [lat, lon] degrees
export function blockPoints(bj, bi) {
  const pts = new Float64Array(BLOCK * BLOCK * 2);
  for (let r = 0, k = 0; r < BLOCK; r++) for (let c = 0; c < BLOCK; c++, k += 2) { pts[k] = (bj * BLOCK + r) * UNIT; pts[k + 1] = (bi * BLOCK + c) * UNIT; }
  return pts;
}

// Terrain heights from lattice blocks (Map `${bj}/${bi}` → Float32Array, as blockPoints orders them):
// a smooth surface through them (Catmull–Rom, bicubic). Heights in metres above the ellipsoid.
// (The blocks are copied into one grid first, so each height is a plain array lookup.)
export function latticeSampler(blocks) {
  let bj0 = Infinity, bi0 = Infinity, bj1 = -Infinity, bi1 = -Infinity;
  for (const k of blocks.keys()) { const [bj, bi] = k.split('/').map(Number); bj0 = Math.min(bj0, bj); bj1 = Math.max(bj1, bj); bi0 = Math.min(bi0, bi); bi1 = Math.max(bi1, bi); }
  const ny = (bj1 - bj0 + 1) * BLOCK, nx = (bi1 - bi0 + 1) * BLOCK, iy0 = bj0 * BLOCK, ix0 = bi0 * BLOCK;
  const grid = new Float32Array(ny * nx).fill(NaN);
  for (const [k, b] of blocks) {
    const [bj, bi] = k.split('/').map(Number), oy = (bj - bj0) * BLOCK, ox = (bi - bi0) * BLOCK;
    for (let r = 0; r < BLOCK; r++) grid.set(b.subarray(r * BLOCK, (r + 1) * BLOCK), (oy + r) * nx + ox);
  }
  const at = (iy, ix) => {
    const y = iy - iy0, x = ix - ix0, v = y >= 0 && x >= 0 && y < ny && x < nx ? grid[y * nx + x] : NaN;
    if (Number.isNaN(v)) throw new Error(`terrain lattice point ${iy}, ${ix} missing`);
    return v;
  };
  const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  return (lat, lon) => {
    const fy = lat / UNIT, fx = lon / UNIT, iy = Math.floor(fy), ix = Math.floor(fx), ty = fy - iy, tx = fx - ix;
    const row = dy => cr(at(iy + dy, ix - 1), at(iy + dy, ix), at(iy + dy, ix + 1), at(iy + dy, ix + 2), tx);
    return cr(row(-1), row(0), row(1), row(2), ty);
  };
}
