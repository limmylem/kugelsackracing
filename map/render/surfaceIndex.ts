// Which triangle of a mesh is under a point: the tyres' surface on a road, footpath, kerb or car park collider (Map
// v5, Step 1f). Rapier's ray hit names the collider but not the triangle in it (its featureId is the triangle's own
// face, 0 or 1), so each such collider's triangles are bucketed in plan, once, the first time a wheel lands on it.
//
//   const ix = surfaceIndex(positions, indices, surfaces)   // tile-local positions, a surface index per triangle
//   ix.at(x, y, z)  → that surface index (the triangle over or under (x, z) nearest y), or -1

export function surfaceIndex(P: ArrayLike<number>, I: ArrayLike<number>, S: ArrayLike<number>, cell = 4) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let v = 0; v < P.length; v += 3) { x0 = Math.min(x0, P[v]); x1 = Math.max(x1, P[v]); z0 = Math.min(z0, P[v + 2]); z1 = Math.max(z1, P[v + 2]); }
  const W = Math.max(1, Math.ceil((x1 - x0) / cell) + 1), H = Math.max(1, Math.ceil((z1 - z0) / cell) + 1);
  const start = new Int32Array(W * H + 1), n = I.length / 3;
  const range = (t: number) => {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    return [Math.floor((Math.min(P[a], P[b], P[c]) - x0) / cell), Math.floor((Math.max(P[a], P[b], P[c]) - x0) / cell), Math.floor((Math.min(P[a + 2], P[b + 2], P[c + 2]) - z0) / cell), Math.floor((Math.max(P[a + 2], P[b + 2], P[c + 2]) - z0) / cell)];
  };
  for (let t = 0; t < n; t++) { const [c0, c1, r0, r1] = range(t); for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) start[r * W + c + 1]++; }
  for (let k = 0; k < W * H; k++) start[k + 1] += start[k];
  const fill = start.slice(0, W * H), list = new Int32Array(start[W * H]);
  for (let t = 0; t < n; t++) { const [c0, c1, r0, r1] = range(t); for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) list[fill[r * W + c]++] = t; }
  return {
    at(x: number, y: number, z: number) {
      const c = Math.floor((x - x0) / cell), r = Math.floor((z - z0) / cell);
      if (c < 0 || r < 0 || c >= W || r >= H) return -1;
      let best = -1, bestD = Infinity;
      for (let q = start[r * W + c]; q < start[r * W + c + 1]; q++) {
        const t = list[q], a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, d = I[t * 3 + 2] * 3;
        const ax = P[a], az = P[a + 2], bx = P[b] - ax, bz = P[b + 2] - az, cx = P[d] - ax, cz = P[d + 2] - az, px = x - ax, pz = z - az;
        const den = bx * cz - bz * cx;
        if (Math.abs(den) < 1e-12) continue;
        const u = (px * cz - pz * cx) / den, v = (bx * pz - bz * px) / den, e = 1e-4;
        if (u < -e || v < -e || u + v > 1 + e) continue;
        const h = P[a + 1] + (P[b + 1] - P[a + 1]) * u + (P[d + 1] - P[a + 1]) * v, dy = Math.abs(h - y);
        if (dy < bestD) { bestD = dy; best = t; }
      }
      return best < 0 ? -1 : S[best];
    },
  };
}

// the surface's name under a wheel's contact (x, y, z: the simulation's frame) on the collider its ray hit, if that
// collider's triangles carry surfaces (map/render/physics.ts: userData.surfaces { names, data, positions, indices },
// tile-local; indexed the first time); else null
export function surfaceOfHit(collider: any, x: number, y: number, z: number): string | null {
  const u = collider?.userData?.surfaces;
  if (!u) return null;
  u.index ??= surfaceIndex(u.positions, u.indices, u.data);
  const o = collider.translation(), k = u.index.at(x - o.x, y - o.y, z - o.z);
  return k < 0 ? null : u.names[k] ?? null;
}
