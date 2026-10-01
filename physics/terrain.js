// Rolling-hills terrain for test worlds, generated from a few settings in the world file, so the
// physics (a Rapier heightfield) and the renderer (a mesh) build exactly the same ground. Pure data,
// no rendering library.
//
// Heights are a sum of long plane waves, flattened smoothly around "flat" zones (start area, skidpad)
// and faded to zero at the edge. Grid layout matches Rapier's heightfield: rows run along z, columns
// along x, centred on the origin, stored column-major; each cell is split into two triangles along
// the diagonal from its (-x, +z) corner to its (+x, -z) corner.

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function makeTerrain(t) {
  const n = t.cells, size = t.size, cell = size / n, half = size / 2;
  const waves = t.waves.map(w => {
    const k = 2 * Math.PI / w.wavelength, d = w.dirDeg * Math.PI / 180;
    return { amp: w.amp, kx: k * Math.cos(d), kz: k * Math.sin(d), phase: w.phase };
  });
  const shape = (x, z) => {
    let h = 0;
    for (const w of waves) h += w.amp * Math.sin(x * w.kx + z * w.kz + w.phase);
    for (const f of t.flat || []) h *= smoothstep(f.inner, f.outer, Math.hypot(x - f.centre[0], z - f.centre[1]));
    return h * smoothstep(0, t.edgeFade, half - Math.max(Math.abs(x), Math.abs(z)));
  };
  const heights = new Float32Array((n + 1) * (n + 1));
  for (let col = 0; col <= n; col++)
    for (let row = 0; row <= n; row++) heights[row + col * (n + 1)] = shape(-half + col * cell, -half + row * cell);
  const at = (col, row) => heights[row + col * (n + 1)];

  // Height of the (triangulated) ground at any point — what the car's wheels actually touch
  function heightAt(x, z) {
    const gx = (x + half) / cell, gz = (z + half) / cell;
    if (gx < 0 || gz < 0 || gx > n || gz > n) return 0;
    const c = Math.min(n - 1, Math.floor(gx)), r = Math.min(n - 1, Math.floor(gz)), fx = gx - c, fz = gz - r;
    const h00 = at(c, r), h10 = at(c + 1, r), h01 = at(c, r + 1), h11 = at(c + 1, r + 1);
    return fx + fz <= 1
      ? h00 + (h10 - h00) * fx + (h01 - h00) * fz
      : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }
  return { n, size, cell, half, heights, heightAt, at };
}

// Build roads into the ground the way real roads are built into hills. Along each road: a height
// profile that follows the land but smoothed (carve.smoothing metres) and kept under carve.maxGrade,
// plus any crests / jumps the road asks for; the ground is made flat across the road (half its width
// + carve.flatMargin) and blends back into the natural slope over carve.shoulder metres, which gives
// cuttings through hills and embankments across dips.
//   roads: [{ road, line }] with line = roadCenterline(road, step) at `step` metres
//   road.jumps: [{ at (metres along), height, rise (m of run-up), fall (m of landing) }]
export function carveRoads(terrain, roads, carve, step) {
  const { n, cell, half, heights } = terrain;
  const nearest = new Float32Array(heights.length).fill(Infinity), target = new Float32Array(heights.length), inner = new Float32Array(heights.length);
  const profiles = [];
  for (const { road, line } of roads) {
    const m = line.length, closed = !!road.closed, wrap = i => closed ? (i % m + m) % m : Math.max(0, Math.min(m - 1, i));
    // natural height under the road, smoothed
    let h = line.map(p => terrain.heightAt(p.x, p.z));
    const win = Math.max(1, Math.round(carve.smoothing / step / 2));
    for (let pass = 0; pass < 2; pass++) {
      const src = h;
      h = src.map((_, i) => { let s = 0; for (let k = -win; k <= win; k++) s += src[wrap(i + k)]; return s / (2 * win + 1); });
    }
    // no steeper than the maximum grade, either way
    const dmax = carve.maxGrade * step;
    for (let pass = 0; pass < 50; pass++) {
      let changed = false;
      const limit = (i, j) => { const lo = h[j] - dmax, hi = h[j] + dmax; if (h[i] < lo) { h[i] = lo; changed = true; } else if (h[i] > hi) { h[i] = hi; changed = true; } };
      for (let i = 1; i < m + (closed ? 1 : 0); i++) limit(wrap(i), wrap(i - 1));
      for (let i = m - 2 + (closed ? 1 : 0); i >= 0; i--) limit(wrap(i), wrap(i + 1));
      if (!changed) break;
    }
    // crests and jumps: a quick run-up and a longer landing slope
    const total = m * step;
    for (const j of road.jumps || []) {
      for (let i = 0; i < m; i++) {
        let u = i * step - j.at;
        if (closed) u = ((u + total / 2) % total + total) % total - total / 2;
        if (u > -j.rise && u < 0) h[i] += j.height * Math.sin(Math.PI / 2 * (u + j.rise) / j.rise) ** 2;
        else if (u >= 0 && u < j.fall) h[i] += j.height * Math.cos(Math.PI / 2 * u / j.fall) ** 2;
      }
    }
    profiles.push(h);
    // stamp the road into the grid: each vertex takes the height of the nearest bit of road
    const flat = road.width / 2 + carve.flatMargin, reach = flat + carve.shoulder;
    for (let i = 0; i < (closed ? m : m - 1); i++) {
      const p = line[i], q = line[wrap(i + 1)], dx = q.x - p.x, dz = q.z - p.z, len2 = dx * dx + dz * dz || 1;
      const c0 = Math.max(0, Math.floor((Math.min(p.x, q.x) - reach + half) / cell)), c1 = Math.min(n, Math.ceil((Math.max(p.x, q.x) + reach + half) / cell));
      const r0 = Math.max(0, Math.floor((Math.min(p.z, q.z) - reach + half) / cell)), r1 = Math.min(n, Math.ceil((Math.max(p.z, q.z) + reach + half) / cell));
      for (let col = c0; col <= c1; col++) {
        for (let row = r0; row <= r1; row++) {
          const vx = -half + col * cell, vz = -half + row * cell;
          const t = Math.max(0, Math.min(1, ((vx - p.x) * dx + (vz - p.z) * dz) / len2));
          const d = Math.hypot(vx - (p.x + dx * t), vz - (p.z + dz * t)), k = row + col * (n + 1);
          if (d < nearest[k]) { nearest[k] = d; target[k] = h[i] + (h[wrap(i + 1)] - h[i]) * t; inner[k] = flat; }
        }
      }
    }
  }
  for (let k = 0; k < heights.length; k++) {
    if (nearest[k] === Infinity) continue;
    const reachK = inner[k] + carve.shoulder;
    heights[k] = target[k] + (heights[k] - target[k]) * smoothstep(inner[k], reachK, nearest[k]);
  }
  return profiles;
}
