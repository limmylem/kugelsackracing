// Places on the Earth for world content: distances, bearings, and geohash cells — the grid the content is
// kept in, so only what's near the camera or the player is loaded. Pure: the page, the tests and (the same
// cells) a server all use it.
//
//   encode(lat, lon, precision) → 'gh5…'     decode(hash) → { lat, lon, box: [s, w, n, e] }
//   cellsAround(lat, lon, km, precision) → every cell a circle touches
//   cellsInBox([s, w, n, e], precision)    distanceKm(a, b)    bearingDeg(a, b)
//   tileBox(z, x, y) → [s, w, n, e] (a web map tile)

export const CELL_PRECISION = 5;          // the content's cells: ≈ 4.9 km × 4.9 km at the equator (narrower in longitude further north)
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz', DECODE = Object.fromEntries([...BASE32].map((c, i) => [c, i]));
const R = 6371.0088, RAD = Math.PI / 180;

export function encode(lat, lon, precision = CELL_PRECISION) {
  let s = -90, n = 90, w = -180, e = 180, bit = 0, ch = 0, even = true, out = '';
  while (out.length < precision) {
    if (even) { const m = (w + e) / 2; if (lon >= m) { ch = ch * 2 + 1; w = m; } else { ch *= 2; e = m; } }
    else { const m = (s + n) / 2; if (lat >= m) { ch = ch * 2 + 1; s = m; } else { ch *= 2; n = m; } }
    even = !even;
    if (++bit === 5) { out += BASE32[ch]; bit = 0; ch = 0; }
  }
  return out;
}

export function decode(hash) {
  let s = -90, n = 90, w = -180, e = 180, even = true;
  for (const c of hash) {
    const v = DECODE[c];
    if (v === undefined) throw new Error(`not a geohash: ${hash}`);
    for (let b = 4; b >= 0; b--) {
      const on = (v >> b) & 1;
      if (even) { const m = (w + e) / 2; if (on) w = m; else e = m; } else { const m = (s + n) / 2; if (on) s = m; else n = m; }
      even = !even;
    }
  }
  return { lat: (s + n) / 2, lon: (w + e) / 2, box: [s, w, n, e] };
}

export const isCell = h => typeof h === 'string' && /^[0-9bcdefghjkmnpqrstuvwxyz]{1,12}$/.test(h);

// the size of a cell of a precision, in degrees (latitude, longitude)
export function cellSize(precision) {
  const bits = precision * 5, lonBits = Math.ceil(bits / 2), latBits = Math.floor(bits / 2);
  return [180 / 2 ** latBits, 360 / 2 ** lonBits];
}

// every cell of a precision a lat/lon box touches ([south, west, north, east]; a box over the
// antimeridian has west > east)
export function cellsInBox([s, w, n, e], precision = CELL_PRECISION, limit = 100000) {
  if (w > e) { const a = cellsInBox([s, w, n, 180], precision, limit), b = a && cellsInBox([s, -180, n, e], precision, limit - a.length); return a && b ? [...a, ...b] : null; }
  const [dLat, dLon] = cellSize(precision), out = [];
  s = Math.max(-90, s); n = Math.min(90, n);
  const lat0 = Math.floor((s + 90) / dLat), lat1 = Math.floor(Math.min(n + 90, 180 - 1e-9) / dLat);
  const lon0 = Math.floor((w + 180) / dLon), lon1 = Math.floor(Math.min(e + 180, 360 - 1e-9) / dLon);
  if ((lat1 - lat0 + 1) * (lon1 - lon0 + 1) > limit) return null;          // (too many: the caller scans instead)
  for (let i = lat0; i <= lat1; i++) for (let j = lon0; j <= lon1; j++) out.push(encode(-90 + (i + 0.5) * dLat, -180 + (j + 0.5) * dLon, precision));
  return out;
}

// the lat/lon box round a circle (km), over the antimeridian if it must, the poles if it reaches them
export function boxAround(lat, lon, km) {
  const dLat = km / R / RAD, s = lat - dLat, n = lat + dLat;
  if (s <= -90 || n >= 90) return [Math.max(-90, s), -180, Math.min(90, n), 180];
  const dLon = Math.min(180, dLat / Math.max(1e-6, Math.cos(Math.min(89.999, Math.abs(lat) + dLat) * RAD)));
  if (dLon >= 180) return [s, -180, n, 180];
  let w = lon - dLon, e = lon + dLon;
  if (w < -180) w += 360;
  if (e > 180) e -= 360;
  return [s, w, n, e];
}

export const cellsAround = (lat, lon, km, precision = CELL_PRECISION, limit) => cellsInBox(boxAround(lat, lon, km), precision, limit);

export function distanceKm(a, b) {
  const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// the initial bearing from a to b (degrees clockwise from north)
export function bearingDeg(a, b) {
  const p1 = a.lat * RAD, p2 = b.lat * RAD, dl = (b.lon - a.lon) * RAD;
  const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / RAD) % 360 + 360) % 360;
}

// a point km away on a bearing
export function offset(a, km, bearing) {
  const d = km / R, t = bearing * RAD, p1 = a.lat * RAD, l1 = a.lon * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / RAD, lon: ((l2 / RAD + 540) % 360) - 180 };
}

// a web map tile's box (z/x/y, the usual XYZ scheme)
export function tileBox(z, x, y) {
  const n = 2 ** z, lon = v => v / n * 360 - 180, lat = v => Math.atan(Math.sinh(Math.PI * (1 - 2 * v / n))) / RAD;
  return [lat(y + 1), lon(x), lat(y), lon(x + 1)];
}

export const inBox = ([s, w, n, e], lat, lon) => lat >= s && lat <= n && (w <= e ? lon >= w && lon <= e : lon >= w || lon <= e);

// "37.7749, -122.4194" / "37.7749 -122.4194" / "37°46'29.6"N 122°25'09.8"W" → { lat, lon } or null
export function parseLatLon(text) {
  const t = String(text).trim();
  const dms = [...t.matchAll(/(-?\d+(?:\.\d+)?)\s*°\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*["″]\s*)?([NSEW])?/gi)];
  if (dms.length === 2) {
    const v = dms.map(m => { let d = Math.abs(+m[1]) + (+m[2] || 0) / 60 + (+m[3] || 0) / 3600; if (+m[1] < 0 || /[SW]/i.test(m[4] ?? '')) d = -d; return { d, h: (m[4] ?? '').toUpperCase() }; });
    const [a, b] = v[0].h === 'E' || v[0].h === 'W' ? [v[1], v[0]] : v;
    return valid(a.d, b.d);
  }
  const m = t.match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
  return m ? valid(+m[1], +m[2]) : null;
}
const valid = (lat, lon) => Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
