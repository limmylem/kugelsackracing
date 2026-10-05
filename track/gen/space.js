// The room beside a generated track (Phase 5 Step 2; part of generator version 2: FROZEN like it). For
// each centreline point and each side, how far out (from the centreline) its run-off and barrier may go
// before they'd meet another part of the track: never past the line halfway to it (less `gap`, so two
// barriers back to back stand apart), and on the inside of a bend never past its centre (the same rule:
// the halfway line between two points of one circle runs through its centre). Exact arithmetic only
// (+ − × ÷ and square roots: track/det.js), so it's the same on every machine.
//
//   frameOf(track) → { n, closed, ds, s, tx, tz, lx, lz }   (unit tangent; left normal = (tz, −tx))
//   freeSpace(track, F, { reach, gap }) → { L: Float64Array, R: Float64Array } (m from the centreline)
//   pointGrid(track, cell) → { near(x, z, r, fn(j)) }      (every centreline point within r of a place)

import { sqrt } from '../det.js';

export function frameOf(T) {
  const n = T.n, closed = T.closed, ds = T.length / (closed ? n : n - 1);
  const s = new Float64Array(n), tx = new Float64Array(n), tz = new Float64Array(n), lx = new Float64Array(n), lz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    s[i] = i * ds;
    const a = closed ? (i - 1 + n) % n : Math.max(0, i - 1), b = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    const dx = T.x[b] - T.x[a], dz = T.z[b] - T.z[a], m = sqrt(dx * dx + dz * dz) || 1;
    tx[i] = dx / m; tz[i] = dz / m; lx[i] = tz[i]; lz[i] = -tx[i];
  }
  return { n, closed, ds, s, tx, tz, lx, lz };
}

export function pointGrid(T, cell = 40) {
  const map = new Map(), key = (a, b) => a * 100003 + b;
  for (let i = 0; i < T.n; i++) { const k = key(Math.floor(T.x[i] / cell), Math.floor(T.z[i] / cell)); let l = map.get(k); if (!l) map.set(k, l = []); l.push(i); }
  return {
    near(x, z, r, fn) {
      const c0 = Math.floor((x - r) / cell), c1 = Math.floor((x + r) / cell), r0 = Math.floor((z - r) / cell), r1 = Math.floor((z + r) / cell);
      for (let a = c0; a <= c1; a++) for (let b = r0; b <= r1; b++) { const l = map.get(key(a, b)); if (l) for (const j of l) fn(j); }
    },
  };
}

export function freeSpace(T, F, { reach = 160, gap = 1 } = {}) {
  const n = T.n, G = pointGrid(T, 40), L = new Float64Array(n).fill(reach), R = new Float64Array(n).fill(reach);
  for (let i = 0; i < n; i++) {
    const xi = T.x[i], zi = T.z[i];
    for (const side of [1, -1]) {
      const nx = side * F.lx[i], nz = side * F.lz[i];
      let bound = reach;
      G.near(xi, zi, reach, j => {
        if (j === i) return;
        const ex = T.x[j] - xi, ez = T.z[j] - zi, e2 = ex * ex + ez * ez;
        if (e2 > reach * reach || e2 < 1e-9) return;
        const en = ex * nx + ez * nz;
        // (only points out on this side, within 60° of straight out: a point just along the road isn't
        // "beside" it)
        if (en <= 0.5 * sqrt(e2)) return;
        const b = (e2 - gap * gap) / (2 * (en + gap));
        if (b < bound) bound = b;
      });
      (side > 0 ? L : R)[i] = bound;
    }
  }
  return { L, R };
}
