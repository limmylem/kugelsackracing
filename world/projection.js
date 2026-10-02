// A region's flat local frame: metres from its origin, x east, y up, z south (as physics/geo.js and the
// test worlds have it). The map's longitude and latitude go onto it by a mercator projection on the
// WGS84 ellipsoid, scaled to be exactly true at the origin: conformal (a square building stays square,
// a right-angle junction stays right-angled), within a few parts in ten thousand of true scale across
// a city, and with no earth curvature to deal with. The baker puts everything on it (map, elevation,
// buildings); the game drives on it; the map view goes back from it to longitude and latitude.
//
//   const P = projection(lat0, lon0)
//   P.toXZ(lat, lon) → [x, z];  P.toLatLon(x, z) → [lat, lon];  P.scaleAt(lat) (true m per frame m)

const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F), E = Math.sqrt(E2), RAD = Math.PI / 180;
const psi = phi => { const s = Math.sin(phi); return Math.atanh(s) - E * Math.atanh(E * s); };

export function projection(lat0, lon0) {
  const phi0 = lat0 * RAD, k0 = Math.cos(phi0) / Math.sqrt(1 - E2 * Math.sin(phi0) ** 2), R = A * k0, psi0 = psi(phi0);
  return {
    lat0, lon0,
    toXZ(lat, lon) { return [R * (lon - lon0) * RAD, -R * (psi(lat * RAD) - psi0)]; },
    toLatLon(x, z) {
      const p = psi0 - z / R;
      // (the latitude whose isometric latitude is p: a few rounds of Newton's method)
      let phi = 2 * Math.atan(Math.exp(p)) - Math.PI / 2;
      for (let i = 0; i < 6; i++) { const s = Math.sin(phi), f = psi(phi) - p, d = (1 - E2) / ((1 - E2 * s * s) * Math.cos(phi)); phi -= f / d; }
      return [phi / RAD, lon0 + x / R / RAD];
    },
    // true ground metres per frame metre at a latitude (1 at the origin)
    scaleAt(lat) { const phi = lat * RAD; return Math.cos(phi) / Math.sqrt(1 - E2 * Math.sin(phi) ** 2) / k0; },
  };
}
