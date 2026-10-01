// Earth geometry for the real world, no rendering library (so the physics, a Web Worker and the
// headless tests can all use it):
//  - WGS84 geodetic (latitude, longitude in radians, height in metres above the ellipsoid) ↔ ECEF
//    (earth-centred, earth-fixed metres), in double precision;
//  - LocalFrame: a flat tangent frame at an origin on the earth, the frame the physics runs in:
//    x east, y up, z south (right-handed with y up, like the test worlds; gravity is −y). It's exact
//    everywhere (points far from the origin just sit lower, following the earth's curve), and precise
//    near the origin, which is why the origin follows the car (a floating origin: see transformTo).

const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F), B = A * (1 - F), EP2 = E2 / (1 - E2);

export function geodeticToEcef(lat, lon, h = 0) {
  const s = Math.sin(lat), c = Math.cos(lat), N = A / Math.sqrt(1 - E2 * s * s);
  return [(N + h) * c * Math.cos(lon), (N + h) * c * Math.sin(lon), (N * (1 - E2) + h) * s];
}

// (Bowring's method, refined twice: well under a millimetre anywhere near the surface)
export function ecefToGeodetic([x, y, z]) {
  const lon = Math.atan2(y, x), p = Math.hypot(x, y);
  let lat = Math.atan2(z * A, p * B);
  lat = Math.atan2(z + EP2 * B * Math.sin(lat) ** 3, p - E2 * A * Math.cos(lat) ** 3);
  for (let i = 0; i < 2; i++) {
    const s = Math.sin(lat), N = A / Math.sqrt(1 - E2 * s * s);
    const h = p / Math.cos(lat) - N;
    lat = Math.atan2(z, p * (1 - E2 * N / (N + h)));
  }
  const s = Math.sin(lat), N = A / Math.sqrt(1 - E2 * s * s);
  const height = Math.abs(lat) < 1.4 ? p / Math.cos(lat) - N : z / s - N * (1 - E2);
  return { lat, lon, height };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Unit quaternion {x, y, z, w} from a rotation matrix given as rows
function quatFromRows(m) {
  const [[m00, m01, m02], [m10, m11, m12], [m20, m21, m22]] = m, tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = s / 4; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / s; x = s / 4; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / s; x = (m01 + m10) / s; y = s / 4; z = (m12 + m21) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = s / 4; }
  const l = Math.hypot(x, y, z, w);
  return { x: x / l, y: y / l, z: z / l, w: w / l };
}

export class LocalFrame {
  // origin: latitude, longitude (radians), height above the ellipsoid (m)
  constructor(lat, lon, height = 0) {
    this.lat = lat; this.lon = lon; this.height = height;
    this.origin = geodeticToEcef(lat, lon, height);
    const sl = Math.sin(lat), cl = Math.cos(lat), so = Math.sin(lon), co = Math.cos(lon);
    // the frame's axes in ECEF
    this.east = [-so, co, 0];
    this.up = [cl * co, cl * so, sl];
    this.south = [sl * co, sl * so, -cl];          // −north
    this.axes = [this.east, this.up, this.south];
  }

  // ECEF point / vector → this frame
  toLocal(p) { const d = [p[0] - this.origin[0], p[1] - this.origin[1], p[2] - this.origin[2]]; return this.axes.map(a => dot(a, d)); }
  vectorToLocal(v) { return this.axes.map(a => dot(a, v)); }
  // this frame → ECEF
  fromLocal([x, y, z]) { const o = this.origin, [e, u, s] = this.axes; return [0, 1, 2].map(i => o[i] + x * e[i] + y * u[i] + z * s[i]); }
  vectorFromLocal([x, y, z]) { const [e, u, s] = this.axes; return [0, 1, 2].map(i => x * e[i] + y * u[i] + z * s[i]); }

  geodeticToLocal(lat, lon, h) { return this.toLocal(geodeticToEcef(lat, lon, h)); }
  localToGeodetic(p) { return ecefToGeodetic(this.fromLocal(p)); }

  // The rigid transform taking coordinates in this frame to coordinates in `other`:
  // p_other = rotate(rotation, p_this) + translation. (Two frames a few km apart differ by a
  // rotation of a few hundredths of a degree: the earth's curve.)
  transformTo(other) {
    const rows = other.axes.map(a => this.axes.map(b => dot(a, b)));
    return { rotation: quatFromRows(rows), translation: other.toLocal(this.origin), rows };
  }
}

// Compass bearing (radians clockwise from north) of a horizontal direction in a local frame, and back
export const bearingOf = ([x, , z]) => Math.atan2(x, -z);
export const directionOf = bearing => [Math.sin(bearing), 0, -Math.cos(bearing)];
