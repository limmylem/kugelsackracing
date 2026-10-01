// Small vector/quaternion helpers on plain arrays [x, y, z] / {x, y, z, w} — no rendering library,
// so the physics can run anywhere (page, Web Worker, server).

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = a => Math.hypot(a[0], a[1], a[2]);
export const normalize = a => { const l = length(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const fromXYZ = v => [v.x, v.y, v.z];
export const toXYZ = a => ({ x: a[0], y: a[1], z: a[2] });

// Rotate vector v by unit quaternion q ({x, y, z, w})
export function rotate(q, v) {
  const u = [q.x, q.y, q.z], s = q.w;
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, s)), cross(u, t));
}

export function quatFromAxisAngle(axis, angle) {
  const [x, y, z] = normalize(axis), h = angle / 2, s = Math.sin(h);
  return { x: x * s, y: y * s, z: z * s, w: Math.cos(h) };
}

export function quatMultiply(a, b) {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

// Euler angles in degrees, applied X then Y then Z (intrinsic), as a quaternion
export function quatFromEulerDeg([rx, ry, rz]) {
  const d = Math.PI / 180;
  return quatMultiply(quatMultiply(quatFromAxisAngle([1, 0, 0], rx * d), quatFromAxisAngle([0, 1, 0], ry * d)), quatFromAxisAngle([0, 0, 1], rz * d));
}
