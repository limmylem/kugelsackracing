// The interior: bucket and fixed-back seats, steering wheels (size, spokes, dish, a quick-release hub),
// gauge pods, a race harness, a short shifter, and roll cages and hoops made to fit each car's cabin —
// its floor, roof, windscreen pillars and door openings, measured from the car's model.
//
// Origins: a seat at the middle of its base on the floor (facing +z, its back towards −z); a steering
// wheel at the end of the column (the wheel towards the driver, −z, the column's axis z); a gauge pod
// where it sits; a harness at the middle of the seat back; a shifter at its base; a cage at the car's
// socket_cage.

import { annulus, bar, bevelBox, box, cylinder, lathe, loft, moved, prism, rotated, roundedRect, torus, tube } from './lib/geometry.js';
import { PartModel, suggestPrice } from './lib/part.js';
import { fitBuild, surroundings } from './lib/fitcheck.js';

// ---------- seats ----------
// settings: { width, height, depth, style: 'bucket' (a padded back that reclines) | 'fixed' (a one-piece
//   shell), shell ('carbon' | 'black'), fabric (colour), wings (head wings), slots (harness slots),
//   bolster (m: how far the sides stand up) }
export function seat(id, s) {
  const m = new PartModel(id), W = s.width, H = s.height, D = s.depth, b = s.bolster ?? 0.09, lean = s.lean ?? 0.18;
  if (s.fabric) m.material('seat_fabric', { colour: s.fabric });
  const shell = s.shell ?? 'black', back = -D * 0.62, front = D * 0.33, cushY = 0.17;
  // the rails and the frame under it
  for (const x of [-W * 0.32, W * 0.32]) m.add(bevelBox([x - 0.018, 0, back + 0.05], [x + 0.018, 0.035, front - 0.02], 0.004), 'raw_metal');
  m.add(bevelBox([-W * 0.38, 0.035, back + 0.1], [W * 0.38, 0.07, front - 0.06], 0.006), 'dark');
  // the seat base: cushion and its side bolsters
  m.add(bevelBox([-W * 0.36, 0.07, back + 0.08], [W * 0.36, cushY, front], 0.02), 'seat_fabric');
  for (const sx of [-1, 1]) m.add(prism([[0.07, front], [0.07, back + 0.08], [cushY + b, back + 0.1], [cushY + b * 0.6, front - 0.06]], sx > 0 ? W * 0.32 : -W / 2, sx > 0 ? W / 2 : -W * 0.32, 'x'), s.style === 'fixed' ? shell : 'seat_fabric');
  // the back: a slab leaning back from the cushion, its bolsters, and (fixed) the shell round it
  const top = H, tz = back - lean * (top - cushY) / 0.8;
  const slab = (x0, x1, f0, f1, z0) => prism([[cushY, z0], [cushY, z0 - 0.09], [top, tz - 0.09], [top, tz]], x0, x1, 'x');
  m.add(slab(-W * 0.32, W * 0.32, 0, 0, back + 0.02), 'seat_fabric');
  for (const sx of [-1, 1]) m.add(prism([[cushY, back + 0.08], [cushY, back - 0.06], [top * 0.82, tz * 0.82 + back * 0.18 - 0.06], [top * 0.82, tz * 0.82 + back * 0.18 + 0.06]], sx > 0 ? W * 0.3 : -W / 2, sx > 0 ? W / 2 : -W * 0.3, 'x'), s.style === 'fixed' ? shell : 'seat_fabric');
  if (s.style === 'fixed') {
    // the shell behind the back, and head wings
    m.add(slab(-W / 2 + 0.01, W / 2 - 0.01, 0, 0, back - 0.07).map(t => t.map(([x, y, z]) => [x, y, z - 0.035])), shell);
    if (s.wings) for (const sx of [-1, 1]) m.add(prism([[top * 0.78, tz * 0.8 + back * 0.2 + 0.08], [top * 0.78, tz * 0.8 + back * 0.2 - 0.08], [top - 0.01, tz - 0.05], [top - 0.01, tz + 0.1]], sx > 0 ? W * 0.3 : -W / 2 + 0.02, sx > 0 ? W / 2 - 0.02 : -W * 0.3, 'x'), shell);
  } else {
    // a headrest above the back, and the recline knob
    m.add(bevelBox([-W * 0.2, top - 0.02, tz - 0.08], [W * 0.2, top + 0.13, tz + 0.01], 0.02).map(t => t.map(([x, y, z]) => [x, y, z - lean * 0.1])), 'seat_fabric');
    m.add(cylinder('x', 0.03, W / 2, W / 2 + 0.02, 8, { at: [0, cushY + 0.02, back] }), 'black');
  }
  // harness slots: dark slits near the top of the back
  if (s.slots) for (const x of [-0.08, 0.08]) m.add(box([x - 0.03, top * 0.78, back - lean * (top * 0.78 - cushY) / 0.8 + 0.002], [x + 0.03, top * 0.78 + 0.018, back - lean * (top * 0.78 - cushY) / 0.8 + 0.012]), 'black');
  return m;
}

// ---------- steering wheels ----------
// settings: { diameter (m), grip (rim radius, m), spokes: 3 | 4, spoke ('flat' | 'slotted' | 'drilled'), dish
//   (m: the rim towards the driver from the hub), flatBottom (true: a D shape), quickRelease (true: a boss
//   and a collar), boss (m: a longer boss, the wheel nearer the driver), rimMaterial ('seat_fabric' suede |
//   'black' leather), marker (a top-centre stripe colour) }
export function steeringWheel(id, s) {
  const m = new PartModel(id), R = s.diameter / 2, g = s.grip ?? 0.016, dish = s.dish ?? 0.02, qr = s.quickRelease;
  if (s.rimColour) m.material('seat_fabric', { colour: s.rimColour });
  const hubZ = (qr ? -0.05 : -0.02) - (s.boss ?? 0), rimZ = hubZ - dish, seg = 24;
  // the boss (and quick-release collar) on the column
  m.add(cylinder('z', 0.028, 0, hubZ + 0.004, 10), 'black');
  if (qr) { m.add(cylinder('z', 0.036, -0.02, -0.034, 12), 'raw_metal'); m.add(annulus('z', 0.036, 0.042, -0.024, -0.03, 12), s.collar ?? 'red'); }
  m.add(cylinder('z', 0.045, hubZ + 0.004, hubZ - 0.012, 12), 'black');
  // the rim: round, or with its bottom flattened (a D)
  const path = Array.from({ length: seg }, (_, i) => { const a = i / seg * Math.PI * 2; let y = Math.sin(a) * R; if (s.flatBottom) y = Math.max(y, -R * 0.82); return [Math.cos(a) * R, y, rimZ]; });
  m.add(tube(path, g, { sides: 6, closed: true }), s.rimMaterial ?? 'seat_fabric');
  if (s.marker) m.add(rotated(moved(box([-0.008, R - g - 0.002, rimZ - g - 0.002], [0.008, R + g + 0.002, rimZ + g + 0.002]), [0, 0, 0]), 'z', 0), s.marker);
  // the spokes, from the hub out to the rim (and back to it, if the rim is dished)
  const angles = s.spokes === 4 ? [Math.PI * 0.15, Math.PI * 0.85, Math.PI * 1.3, Math.PI * 1.7] : [0, Math.PI, Math.PI * 1.5];
  for (const a of angles) {
    const c = Math.cos(a), sn = Math.sin(a), r0 = 0.04, r1 = (s.flatBottom && sn < -0.5 ? R * 0.82 / Math.abs(sn) : R) - g * 0.6, w0 = 0.045, w1 = 0.03;
    const ring = (r, w, z) => [[-w / 2, -0.003], [w / 2, -0.003], [w / 2, 0.003], [-w / 2, 0.003]].map(([u, v]) => [c * r - sn * u, sn * r + c * u, z + v]);
    m.add(loft([ring(r0, w0, hubZ - 0.006), ring(r1 * 0.55, (w0 + w1) / 2, hubZ - 0.006 - dish * 0.5), ring(r1, w1, rimZ)]), s.spokeMaterial ?? 'raw_metal');
    if (s.spoke === 'slotted' || s.spoke === 'drilled') for (const f of [0.4, 0.62]) {
      const r = r0 + (r1 - r0) * f, z = hubZ - 0.006 - dish * f - 0.0045;
      m.add(s.spoke === 'slotted' ? box([c * r - 0.012, sn * r - 0.012, z - 0.0015], [c * r + 0.012, sn * r + 0.012, z]).map(t => t) : moved(cylinder('z', 0.007, -0.0015, 0.0005, 6), [c * r, sn * r, z]), 'black');
    }
  }
  // the horn button
  m.add(cylinder('z', 0.032, hubZ - 0.012, hubZ - 0.02, 12), s.horn ?? 'black');
  return m;
}

// ---------- gauge pods ----------
// settings: { gauges (how many), size (a gauge's diameter, m), layout: 'pillar' (stacked up an A-pillar) | 'dash' (side by side) }
export function gaugePod(id, s) {
  const m = new PartModel(id), n = s.gauges, D = s.size ?? 0.052, gap = D + 0.012, r = D / 2;
  const at = i => s.layout === 'dash' ? [(i - (n - 1) / 2) * gap, r + 0.012, 0] : [0, r + 0.012 + i * gap, 0];
  // the pod: a moulded body round the gauges, facing the driver (−z)
  const span = (n - 1) * gap + D + 0.024;
  if (s.layout === 'dash') m.add(bevelBox([-span / 2, 0, -0.005], [span / 2, D + 0.024, 0.07], 0.012), 'black');
  else m.add(bevelBox([-r - 0.012, 0, -0.005], [r + 0.012, span, 0.07], 0.012), 'black');
  for (let i = 0; i < n; i++) {
    const p = at(i);
    m.add(cylinder('z', r + 0.004, -0.02, -0.004, 14, { at: p }), 'chrome');
    m.add(cylinder('z', r, -0.021, -0.016, 14, { at: p }), i % 2 ? 'white' : 'dark');
    m.add(box([p[0] - 0.0015, p[1], -0.0225], [p[0] + 0.0015, p[1] + r * 0.75, -0.0205]).map(t => t.map(q => rotAbout(q, p, 0.6 - i * 0.5))), 'orange');
  }
  return m;
}
const rotAbout = (q, c, a) => { const x = q[0] - c[0], y = q[1] - c[1]; return [c[0] + x * Math.cos(a) - y * Math.sin(a), c[1] + x * Math.sin(a) + y * Math.cos(a), q[2]]; };

// ---------- the harness ----------
// Straps laid over a bucket seat (its shape: seat(), settings the seats share), from the middle of the seat
// back (its socket: 0.45 m up and 0.2 m back from the seat's): the shoulder straps out of the harness slots
// and down the front of the back, the lap belts and the crotch strap over the cushion to the buckle
export function harness(id, s) {
  const m = new PartModel(id), w = 0.048, t = 0.004, c = s.colour ?? 'red', S = s.seat, off = (s.socket ?? [0, 0.45, -0.2]).map((v, k) => k === 2 ? v - (s.shift ?? 0) : v);
  const back = -S.depth * 0.62, cushY = 0.17, top = S.height, lean = S.lean ?? 0.18, gap = 0.008;
  const face = y => back + 0.02 - lean * (y - cushY) / 0.8 + gap + t;          // (the front of the back, at height y)
  const at = (x, y, z) => [x - off[0], y - off[1], z - off[2]];
  const strap = pts => m.add(bar(pts.map(p => at(...p)), w, t, { bend: 0.03 }), c);
  const buckle = [0, cushY + 0.09, back + 0.26];
  for (const sx of [-1, 1]) {
    // (through the seat's harness slots, then down the front of the back)
    const x = sx * 0.08, slot = top * 0.78 + 0.01;
    strap([[x, slot, face(slot)], [x, cushY + 0.35, face(cushY + 0.35)], [sx * 0.03, buckle[1] + 0.03, buckle[2] - 0.02]]);
    strap([[sx * 0.13, cushY + gap + 0.02, back + 0.12], [sx * 0.07, cushY + gap + 0.04, back + 0.2], [sx * 0.02, buckle[1], buckle[2]]]);
  }
  strap([[0, cushY + gap + 0.005, S.depth * 0.33 - 0.05], [0, cushY + gap + 0.03, back + 0.4], [0, buckle[1] - 0.01, buckle[2] + 0.02]]);
  m.add(moved(cylinder('z', 0.035, -0.008, 0.012, 12), at(...buckle)), 'silver');
  for (const sx of [-1, 1]) m.add(bevelBox(at(sx * 0.075 - 0.028, cushY + 0.4, face(cushY + 0.4) + 0.004), at(sx * 0.075 + 0.028, cushY + 0.43, face(cushY + 0.4) + 0.012), 0.002), 'silver');
  return m;
}

// ---------- the short shifter ----------
export function shifter(id, s) {
  const m = new PartModel(id), H = s.height ?? 0.2;
  m.add(bevelBox([-0.06, 0, -0.07], [0.06, 0.012, 0.07], 0.004), 'raw_metal');                        // the plate
  m.add(lathe([[0, 0.012], [0.05, 0.012], [0.032, 0.05], [0.014, 0.075], [0, 0.075]], 10, 'y'), 'black');      // the gaiter
  m.add(cylinder('y', 0.007, 0.07, H, 8), 'chrome');
  m.add(lathe([[0, H - 0.012], [0.016, H - 0.008], [0.024, H + 0.012], [0.02, H + 0.032], [0, H + 0.04]], 12, 'y'), s.knob ?? 'black');
  return m;
}

// ---------- roll cages, from the car's cabin ----------
// settings: { tube (radius, m), style: 'bolt_in' (main hoop, A-pillar bars, a diagonal, rear stays) |
//   'welded' (… and door bars, a roof X, a harness bar) | 'hoop' (a hoop behind the seats and two braces
//   back: an open car), material }
// around: the car's surroundings at its cage socket (lib/fitcheck.js surroundings: the body and the stock
// parts). Every tube is laid by rays into the cabin: the hoop where there's a clear plane behind the
// seats, its legs on the floor the rays find, its top just under the roof; the A-pillar bars short of the
// dash and the windscreen; the rear stays down onto whatever's behind (the floor, a parcel shelf, an
// engine cover); a bar that would cut into anything is left out.
export function rollCage(id, car, s, around) {
  const m = new PartModel(id), C = car.cabin, at = car.socket('socket_cage'), r = s.tube ?? 0.02, mat = s.material ?? 'raw_metal', obs = around.tris;
  const p = (x, y, z) => [x - at[0], y - at[1], z - at[2]];
  const hit = (o, d) => car.ray(o, d, obs);
  const len3 = v => Math.hypot(...v), unit3 = v => v.map(x => x / (len3(v) || 1));
  // (a tube's line is clear: down its middle and along four lines round it, a little wider than the tube)
  const clear = (a, b, rr = r) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = len3(d), u = unit3(d);
    const e1 = unit3(Math.abs(u[1]) < 0.9 ? [u[2], 0, -u[0]] : [0, -u[2], u[1]]), e2 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
    return [[0, 0, 0], ...[e1, e2].flatMap(e => [e.map(v => v * (rr + 0.008)), e.map(v => -v * (rr + 0.008))])].every(o => hit(a.map((v, k) => v + o[k]), u) >= L - 1e-3);
  };
  const path = (pts, rr = r, force = false) => {
    const ok = pts.every((q, i) => i === 0 || clear(pts[i - 1], q, rr));
    if (ok || force) m.add(tube(pts.map(q => p(...q)), rr, { sides: 8, bend: 0.1, bendSteps: 3 }), mat);
    return ok;
  };
  // (a foot plate on the surface a tube ends on: y is 4 mm above it)
  const plate = (x, y, z) => m.add(bevelBox(p(x - 0.035, y - 0.003, z - 0.05), p(x + 0.035, y + 0.007, z + 0.05), 0.003), 'black');
  const beltY = C.belt - 0.06;
  // what's round a point in the cabin: the floor under it, the roof (or the screen's top, an open car) over it, the side wall
  const floorAt = (x, z) => beltY - hit([x, beltY, z], [0, -1, 0]);
  const roofAt = (x, z) => { const d = hit([x, beltY, z], [0, 1, 0]); return Number.isFinite(d) && !C.convertible ? beltY + d : C.screenTopY + 0.02; };
  // (the walls: the body and the doors — not the seats in between)
  const wallAt = z => Math.min(car.ray([0, beltY - 0.06, z], [1, 0, 0], around.walls ?? obs), car.ray([0, beltY - 0.06, z], [-1, 0, 0], around.walls ?? obs));
  // --- the main hoop: the first plane behind the seats it fits in
  let hoop = null;
  const rearLimit = car.rearAxle + car.wheelRadius + 0.12;        // (ahead of the rear wheels)
  for (let dz = 0; dz <= 0.6 && !hoop; dz += 0.04) {
    const hz = (s.style === 'hoop' ? at[2] : C.seatZ - 0.36) - dz, wall = wallAt(hz);
    if (hz < rearLimit) break;
    if (!Number.isFinite(wall)) continue;
    const w = (wall - r - 0.025) * (s.style === 'hoop' ? 0.85 : 1), top = Math.min(roofAt(w - 0.12, hz), roofAt(-w + 0.12, hz)) - r - 0.015;
    const fl = Math.max(floorAt(w, hz), floorAt(-w, hz)) + 0.004;
    if (!Number.isFinite(fl) || top - fl < 0.5) continue;
    const pts = [[w, fl, hz], [w, top - 0.12, hz], [w - 0.12, top, hz], [-w + 0.12, top, hz], [-w, top - 0.12, hz], [-w, fl, hz]];
    if (pts.every((q, i) => i === 0 || clear(pts[i - 1], q))) hoop = { hz, w, top, fl, pts };
  }
  if (!hoop) {      // (nowhere clear: the measured cabin's numbers, as best it can)
    const hz = C.seatZ - 0.42, w = C.halfWidth - r - 0.02, top = C.roof - r - 0.01;
    hoop = { hz, w, top, fl: C.floor + 0.004, pts: [[w, C.floor, hz], [w, top - 0.12, hz], [w - 0.12, top, hz], [-w + 0.12, top, hz], [-w, top - 0.12, hz], [-w, C.floor, hz]] };
  }
  const { hz, w, top, fl } = hoop;
  path(hoop.pts, r, true);
  plate(w, fl, hz); plate(-w, fl, hz);
  // --- braces / stays back from the hoop's top, down onto whatever's behind it
  // (from the hoop's top — or lower down its leg, to pass under a sloping rear window — back and down onto
  // what's there, short of the rear wheels)
  const stays = (rr, reach) => {
    for (const sx of [1, -1]) {
      let done = false;
      for (const from of [0.02, 0.12, 0.22, 0.32]) for (const back of reach) {
        if (done) break;
        const x = sx * (w - 0.06), z = hz - back, start = [sx * (from > 0.1 ? w : w - 0.1), top - from, hz - 0.02];
        if (z < rearLimit + 0.05) continue;
        const d = hit([x, start[1], z], [0, -1, 0]);
        if (!Number.isFinite(d)) continue;
        const end = [x, start[1] - d + rr + 0.004, z];
        if (end[1] > start[1] - 0.12) continue;
        if (path([start, end], rr)) { plate(x, end[1] - rr, z); done = true; }
      }
    }
  };
  if (s.style === 'hoop') { stays(r * 0.8, [0.45, 0.38, 0.3, 0.22, 0.15]); return m; }
  path([[w - 0.02, top - 0.1, hz], [-w + 0.04, fl + 0.08, hz]], r * 0.9);
  stays(r * 0.9, [0.62, 0.52, 0.42, 0.32, 0.24, 0.16]);
  // --- the A-pillar bars: up from the floor short of the dash and footwell, along the screen's pillar, back under the roof
  // (how far forward a tube along z at x, y can go: the nearest hit across its width)
  const fwd = (x, y) => Math.min(...[[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => hit([x + a * (r + 0.008), y + b * (r + 0.008), hz + 0.05], [0, 0, 1]))) + hz + 0.05;
  for (const sx of [1, -1]) {
    // (no further forward than the door opening's front: the A-pillar's foot)
    const x = sx * w, az = Math.min(C.doorFront - r - 0.02, ...[fl + 0.1, fl + 0.3, beltY - 0.1, beltY].map(y => fwd(x, y) - r - 0.03));
    const xt = sx * (w - 0.1), aTop = Math.min(fwd(xt, top - 0.02) - r - 0.04, C.screenTop + 0.02);
    const pts = [[x, fl, az], [x, beltY, az - 0.02], [xt, top, Math.min(aTop, az - 0.05)], [sx * (w - 0.14), top, hz + 0.03]];
    if (path(pts, r)) plate(x, fl, az);
    else path(pts.slice(1), r, true);
    hoop[sx > 0 ? 'left' : 'right'] = { az, aTop: Math.min(aTop, az - 0.05) };
  }
  if (s.style === 'welded') {
    // door bars (a cross on each side), a cross under the roof, and a harness bar across the hoop
    for (const sx of [1, -1]) {
      const A = hoop[sx > 0 ? 'left' : 'right'], zf = A.az - 0.04, zb = hz + 0.04, lo = fl + 0.14, hi = beltY - 0.04;
      path([[sx * w, lo, zf], [sx * w, hi, zb]], r * 0.9);
      path([[sx * w, hi, zf], [sx * w, lo, zb]], r * 0.9);
    }
    const aT = Math.max(hoop.left.aTop, hoop.right.aTop) - 0.02;
    path([[w - 0.14, top, hz + 0.05], [-w + 0.14, top, aT]], r * 0.85);
    path([[-w + 0.14, top, hz + 0.05], [w - 0.14, top, aT]], r * 0.85);
    path([[w, fl + 0.55, hz], [-w, fl + 0.55, hz]], r * 0.85);
  }
  return m;
}

// ---------- the parts ----------
const SEATS = {
  bucket_seat_street: { design: 'sport bucket', settings: { width: 0.52, height: 0.9, depth: 0.7, style: 'bucket', fabric: '#2d3138', bolster: 0.1, slots: true } },
  bucket_seat_race: { design: 'carbon fixed-back race bucket', settings: { width: 0.5, height: 0.94, depth: 0.7, style: 'fixed', shell: 'carbon', fabric: '#202226', bolster: 0.14, wings: true, slots: true } },
};
const WHEELS = [
  ['quick_release_wheel', null, { diameter: 0.35, grip: 0.016, spokes: 3, spoke: 'flat', dish: 0.02, quickRelease: true, rimMaterial: 'seat_fabric', rimColour: '#2b2d31', marker: 'red' }],
  ['steering_wheel_rally_dish', ['Deep-dish rally steering wheel', 'sport'], { diameter: 0.35, grip: 0.017, spokes: 3, spoke: 'slotted', dish: 0.075, quickRelease: true, rimMaterial: 'seat_fabric', rimColour: '#1f2124', marker: 'yellow', spokeMaterial: 'black', collar: 'blue' }],
  ['steering_wheel_flat_race', ['Flat-bottomed race steering wheel', 'race'], { diameter: 0.32, grip: 0.017, spokes: 4, spoke: 'drilled', dish: 0.03, flatBottom: true, quickRelease: true, rimMaterial: 'seat_fabric', rimColour: '#26282c', marker: 'orange', spokeMaterial: 'carbon', horn: 'red' }],
];
const GAUGES = [
  ['gauge_pod', null, { gauges: 3, size: 0.052, layout: 'pillar' }],
  ['gauge_pod_dash_twin', ['Twin dash gauge pod (boost, oil pressure)', 'street'], { gauges: 2, size: 0.052, layout: 'dash' }],
];
const CAGES = {
  roll_cage_bolt_in: { design: 'bolt-in cage', settings: { tube: 0.02, style: 'bolt_in', material: 'raw_metal' } },
  roll_cage_welded: { design: 'welded multi-point cage', settings: { tube: 0.0225, style: 'welded', material: 'raw_metal' } },
  hana_roadster_roll_hoop: { design: 'roll hoop with braces', settings: { tube: 0.0225, style: 'hoop', material: 'raw_metal' } },
};

// Each made to fit each car (tools/generators/lib/fitcheck.js fitBuild): the design first, then leaning less,
// lower, moved a little… until it clears the body and the stock parts round it
const SEARCH = {
  seat: [{ lean: [0.18, 0.12, 0.07, 0.03], kh: [1, 0.94, 0.88, 0.82], kw: [1, 0.94, 0.88], dz: [0, 0.03, 0.06, -0.03, 0.09, 0.12] }, { lean: 1, kh: 1.5, kw: 1.5, dz: 1 }],
  steering_wheel: [{ boss: [0, 0.02, 0.04, 0.06, 0.08], k: [1, 0.94, 0.88] }, { boss: 1, k: 1.5 }],
  gauges: [{ layout: [null, 'dash'], dz: [0, -0.04, -0.08, 0.04], dy: [0, -0.03, -0.06, -0.09, -0.12], dx: [0, -0.05, 0.05, -0.1, 0.1] }, { layout: 2 }],
};

export async function parts({ carsFor, project }) {
  const { db, rules } = project, jobs = [];
  const fitted = (type, slot, make) => fitBuild({ db, rules, type, slot, axes: SEARCH[type][0], weights: SEARCH[type][1] }, make);
  const forCars = (id, type, slot, make) => ({ cars: carsFor(db.parts[id], db), baseCar: 'starter_car', build: fitted(type, slot, make) });
  for (const [id, { design, settings }] of Object.entries(SEATS)) jobs.push({ id, type: 'seat', design, settings, ...forCars(id, 'seat', 'seat', c => seat(id, { ...settings, lean: c.lean, height: settings.height * c.kh, width: settings.width * c.kw }).moved([0, 0, c.dz])) });
  const fresh = (slot, [name, tier], extra = {}) => ({ name, tier, price: suggestPrice(slot, tier), todo: ['price'], ...extra });
  for (const [id, isNew, settings] of WHEELS) jobs.push({ id, type: 'steering_wheel', design: isNew?.[0] ?? 'quick-release wheel', settings, defaults: isNew && fresh('steering_wheel', isNew, { purpose: 'looks', fits: ['steering_column:std'], _note: `${isNew[0]}: from tools/generators/interior.js.` }),
    ...(isNew ? { cars: Object.keys(db.cars), baseCar: 'starter_car', build: fitted('steering_wheel', 'steering_wheel', c => steeringWheel(id, { ...settings, boss: c.boss, diameter: settings.diameter * c.k })) } : forCars(id, 'steering_wheel', 'steering_wheel', c => steeringWheel(id, { ...settings, boss: c.boss, diameter: settings.diameter * c.k }))) });
  for (const [id, isNew, settings] of GAUGES) jobs.push({ id, type: 'gauges', design: isNew?.[0] ?? 'A-pillar pod', settings, defaults: isNew && fresh('gauges', isNew, { purpose: 'looks', _note: `${isNew[0]}: from tools/generators/interior.js.` }),
    ...(isNew ? { cars: Object.keys(db.cars), baseCar: 'starter_car', build: fitted('gauges', 'gauges', c => gaugePod(id, { ...settings, layout: c.layout ?? settings.layout }).moved([c.dx, c.dy, c.dz])) } : forCars(id, 'gauges', 'gauges', c => gaugePod(id, { ...settings, layout: c.layout ?? settings.layout }).moved([c.dx, c.dy, c.dz]))) });
  // (the harness laid over the bucket seat it needs — as that seat is made to fit each car)
  const H = { colour: 'red', seat: SEATS.bucket_seat_street.settings };
  const seatOn = fitted('seat', 'seat', c => seat('bucket_seat_street', { ...SEATS.bucket_seat_street.settings, lean: c.lean, height: SEATS.bucket_seat_street.settings.height * c.kh, width: SEATS.bucket_seat_street.settings.width * c.kw }).moved([0, 0, c.dz]));
  jobs.push({ id: 'race_harness', type: 'harness', design: 'six-point, over the bucket seat', settings: H, cars: carsFor(db.parts.race_harness, db), baseCar: 'starter_car',
    build: async car => { const f = (await seatOn(car)).fit?.settings ?? { lean: 0.18, kh: 1, kw: 1, dz: 0 }; return harness('race_harness', { ...H, seat: { ...H.seat, lean: f.lean, height: H.seat.height * f.kh, width: H.seat.width * f.kw }, shift: f.dz }); } });
  jobs.push({ id: 'short_shifter', type: 'shifter', design: 'short shifter', settings: { height: 0.2 }, build: () => shifter('short_shifter', { height: 0.2 }) });
  for (const [id, { design, settings }] of Object.entries(CAGES)) {
    jobs.push({ id, type: 'roll_cage', design, settings, cars: carsFor(db.parts[id], db), baseCar: 'starter_car', build: async car => rollCage(id, car, settings, { ...(await surroundings(db, car.id, 'socket_cage')), walls: [...car.body, ...(await car.stockTris('socket_door_left') ?? []), ...(await car.stockTris('socket_door_right') ?? [])] }) });
  }
  return jobs;
}
