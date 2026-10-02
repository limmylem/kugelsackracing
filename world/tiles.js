// Web-mercator map tiles (the usual z/x/y: x east from 180° W, y south from the top) and the world's
// tile pyramid: detailed tiles at zoom 14 (about 1.9 km across at San Francisco's latitude, 2.4 km at the
// equator), simpler ones at 12 and the barest at 10 for the horizon. Coordinates in a tile run 0 …
// extent across it (x east, y south), as in world/mvt.js. Pure maths: the map pipeline, the game's map
// worker and the tests all use it.

export const DETAIL_ZOOM = 14, MID_ZOOM = 12, FAR_ZOOM = 10;
export const ZOOMS = [FAR_ZOOM, MID_ZOOM, DETAIL_ZOOM];
const RAD = Math.PI / 180, MAX_LAT = 85.0511287798;

// longitude, latitude (degrees) → fractional tile x, y at zoom z
export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z, s = Math.sin(Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * RAD);
  return [(lon + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
}
// fractional tile x, y at zoom z → [lon, lat]
export function tileToLonLat(x, y, z) {
  const n = 2 ** z;
  return [x / n * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) / RAD];
}
// a tile's box: [west, south, east, north]
export function tileBounds(z, x, y) {
  const [w, n] = tileToLonLat(x, y, z), [e, s] = tileToLonLat(x + 1, y + 1, z);
  return [w, s, e, n];
}
// every tile at zoom z meeting a box [w, s, e, n]: [[x, y], …]
export function tilesInBbox(z, [w, s, e, n]) {
  const [x0, y0] = lonLatToTile(w, n, z), [x1, y1] = lonLatToTile(e, s, z), out = [];
  for (let y = Math.floor(y0); y <= Math.floor(y1 - 1e-9); y++) for (let x = Math.floor(x0); x <= Math.floor(x1 - 1e-9); x++) out.push([x, y]);
  return out;
}
// metres per tile-coordinate unit at a latitude (the tile's scale: mercator stretches away from the
// equator, so it's ground metres, cos(latitude) of the projected ones)
export const metresPerUnit = (z, extent, lat) => 40075016.686 * Math.cos(lat * RAD) / (2 ** z * extent);
// A tile feature's points (tile units) → [lon, lat]
export function unitsToLonLat(z, x, y, extent) {
  return ([u, v]) => tileToLonLat(x + u / extent, y + v / extent, z);
}
