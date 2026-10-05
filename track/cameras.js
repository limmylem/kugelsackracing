// TV cameras round a generated track (Phase 5 Step 4): where a broadcast would put them — on the outside of
// the corners (the cars coming at the lens, then across it), up on the grandstands, and beside the long
// straights — chosen from the track's code (track/det.js: the same cameras for everyone), and every part
// of the track covered by one. The race replay (race/raceReplay.js) cuts between them as the cars go round;
// a crash replay on a track films from the camera nearest the crash.
//
//   const C = tvCameras(data)     data: a built track's (track/build2.js) → [{ id, kind, name, x, y, z, i, from, to }]
//     (i: the track point it looks at; from–to: the stretch it covers, as track point indices — a circuit's may wrap)
//   cameraFor(C, data, i, prev)   the camera for a car at point i: prev while it still covers it, else the
//                                 one whose stretch it entered last (the next corner's camera as it comes)
//   nearestCamera(C, x, y, z)     the nearest camera to a spot (a crash), or null
//   zoom(distance)                a camera's field of view (degrees) to keep a car about the same size

import { rng, fnv32, mix } from './det.js';
import { heightAtOf } from './build.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function tvCameras(data, { spacing = 260 } = {}) {
  const Cx = data.centre.x, Cz = data.centre.z, Ch = data.centre.h, n = Cx.length, closed = !!data.closed;
  const ds = data.length / (closed ? n : n - 1), W = (data.width ?? 11) / 2, r = rng(mix(fnv32(String(data.code ?? 'track')), 0x7c0));
  const wrap = i => closed ? ((i % n) + n) % n : clamp(i, 0, n - 1);
  const D = data.dress ?? {}, runoff = side => i => (side > 0 ? D.runoff?.L?.[i] : D.runoff?.R?.[i]) ?? 8;
  // (the left of the track at i: its normal, x/z)
  const left = i => { const a = wrap(i - 1), b = wrap(i + 1), dx = Cx[b] - Cx[a], dz = Cz[b] - Cz[a], m = Math.hypot(dx, dz) || 1; return [-dz / m, dx / m]; };
  const at = (i, side, out, up) => { const [lx, lz] = left(i); return { x: Cx[i] + lx * side * out, z: Cz[i] + lz * side * out, y: Ch[i] + up }; };
  const cams = [];
  // (the ground: a camera stands above it where it is, and sees the road over it — raised until the land
  // between doesn't hide the point it looks at)
  const T = data.terrain, ground = T?.heights ? heightAtOf({ N: T.n, cell: T.size / T.n, half: T.size / 2, heights: T.heights }) : null;
  const clear = (p, i, up) => {
    if (!ground) return p;
    let y = Math.max(p.y, ground(p.x, p.z) + Math.min(up, 6));
    const tx = Cx[i], tz = Cz[i], ty = Ch[i] + 1;
    for (let lift = 0; lift < 30; lift += 2) {
      let blocked = false;
      for (let k = 1; k < 12 && !blocked; k++) { const f = k / 12, x = p.x + (tx - p.x) * f, z = p.z + (tz - p.z) * f; if (ground(x, z) > y + lift + (ty - y - lift) * f - 0.3) blocked = true; }
      if (!blocked) { y += lift; break; }
      if (lift === 28) y += lift;
    }
    return { ...p, y };
  };
  const add = (kind, name, i, side, out, up, from, to) => { const p = clear(at(wrap(i), side, out, up), wrap(i), up); cams.push({ id: cams.length, kind, name, ...p, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, z: Math.round(p.z * 10) / 10, i: wrap(i), from: wrap(from), to: wrap(to) }); };
  const m = metres => Math.round(metres / ds);
  // the corners: outside each, back from its run-off, a little up — covering its approach and its exit
  for (const c of D.corners ?? []) {
    const i = wrap(c.apex), side = -(c.side ?? 1), out = W + runoff(side)(i) + 6 + r.float() * 8;
    add('corner', `T${c.n}`, i, side, out, 4 + r.float() * 5, (c.from ?? c.apex) - m(130), (c.to ?? c.apex) + m(50));
  }
  // the grandstands: on top of each, looking along its stretch
  for (const g of (data.objects ?? []).filter(o => o.k === 'grandstand')) {
    const i = wrap(g.i), side = g.side ?? 1, out = Math.hypot(g.x - Cx[i], g.z - Cz[i]) || W + 20;
    add('grandstand', g.main ? 'main grandstand' : 'grandstand', i, side, out, (g.h ?? 10) + 2, i - m(150), i + m(120));
  }
  // what's left uncovered (the straights): a camera beside it every `spacing` metres or so, low and to one side
  const covered = new Uint8Array(n), mark = c => { for (let k = c.from, s = 0; s < n; s++, k = wrap(k + 1)) { covered[k] = 1; if (k === c.to) break; } };
  for (const c of cams) mark(c);
  for (let i = 0; i < n; i++) {
    if (covered[i]) continue;
    let j = i; while (j + 1 < n && !covered[j + 1]) j++;
    const len = (j - i + 1) * ds, parts = Math.max(1, Math.round(len / spacing));
    for (let k = 0; k < parts; k++) {
      const a = i + Math.floor((j - i + 1) * k / parts), b = i + Math.floor((j - i + 1) * (k + 1) / parts) - 1, mid = Math.round(a + (b - a) * (0.55 + r.float() * 0.2)), side = r.float() < 0.5 ? 1 : -1;
      add('straight', 'trackside', mid, side, W + runoff(side)(mid) + 8 + r.float() * 10, 3 + r.float() * 3, a, b);
      mark(cams.at(-1));
    }
    i = j;
  }
  return cams;
}

// how far into a camera's stretch point i is (or -1: not in it)
function into(c, i, n, closed) {
  if (!closed) return i >= c.from && i <= c.to ? i - c.from : -1;
  const len = ((c.to - c.from) % n + n) % n, d = ((i - c.from) % n + n) % n;
  return d <= len ? d : -1;
}
export function cameraFor(cams, data, i, prev = null) {
  const n = data.centre.x.length, closed = !!data.closed;
  if (prev && into(prev, i, n, closed) >= 0) {
    // (held while it covers the car — unless the car's already past it and another has it coming)
    const past = into(prev, i, n, closed) > into(prev, prev.i, n, closed) + 15;
    if (!past) return prev;
  }
  let best = null, bd = Infinity;
  for (const c of cams) { const d = into(c, i, n, closed); if (d >= 0 && d < bd && c !== prev) { bd = d; best = c; } }
  return best ?? prev ?? cams[0] ?? null;
}
export function nearestCamera(cams, x, y, z, most = 260) {
  let best = null, bd = most;
  for (const c of cams ?? []) { const d = Math.hypot(c.x - x, c.y - y, c.z - z); if (d < bd) { bd = d; best = c; } }
  return best;
}
// (about 16 m of the scene across the frame at the car, between a wide shot and a long lens)
export const zoom = distance => clamp(2 * Math.atan(8 / Math.max(1, distance)) * 180 / Math.PI, 7, 60);
