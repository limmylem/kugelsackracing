// Aero: wings (span, chord, uprights — swan neck, straight, struts, a roof edge — end plates, a gurney
// flap), the ducktail, front lips and splitters made to follow the bottom of a car's front bumper
// (read from its model), canards on the bumper's corners, mud flaps behind each wheel, and the Apex's
// carbon aero kit. A wing's element is its own node (wing_element), turning about its middle: the game
// tips it to the wing's angle setting.

import { bar, bevelBox, box, cylinder, moved, prism, rotated, roundedRect, tube } from './lib/geometry.js';
import { aerofoil } from './lib/geometry.js';
import { PartModel } from './lib/part.js';
import { fitBuild } from './lib/fitcheck.js';

// ---------- wings ----------
// settings: { span, chord, height (the element's underside above the feet), thick (of the chord),
//   mounts: 'swan' | 'straight' | 'struts' | 'roof' | 'pedestal', mountX (± m), plates: { up, down, long } | null,
//   gurney (m), material ('carbon' | 'paint' | 'black'), second (a second, smaller element above: { chord, gap }),
//   lift (m: its feet's soles above the socket) }
export function wing(id, s) {
  const m = new PartModel(id), S = s.span, C = s.chord, H = s.height, mat = s.material ?? 'carbon', lift = s.lift ?? 0.004;
  const thick = (s.thick ?? 0.12) * C, pivot = [0, H + thick / 2, 0];
  const el = { node: 'wing_element', pivot };
  // the element: an aerofoil across the span, its chord centred on the socket
  m.add(prism(aerofoil(C, s.thick ?? 0.12, { lead: C / 2, y0: H + thick * 0.55, camber: 0.05 }), -S / 2, S / 2, 'x'), mat, el);
  if (s.second) m.add(prism(aerofoil(s.second.chord, 0.1, { lead: -C / 2 + s.second.chord * 0.75, y0: H + thick + s.second.gap, camber: 0.06 }), -S / 2 + 0.01, S / 2 - 0.01, 'x'), mat, el);
  if (s.gurney) m.add(box([-S / 2 + 0.005, H + thick * 0.6, -C / 2 - 0.004], [S / 2 - 0.005, H + thick * 0.6 + s.gurney, -C / 2 + 0.006]), 'black', el);
  // end plates, turning with it
  if (s.plates) {
    const P = s.plates, top = H + thick + P.up, bottom = H - P.down, L = P.long ?? C * 1.3;
    const outline = roundedRect(top - bottom, L, Math.min(0.03, (top - bottom) / 3), 1, [(top + bottom) / 2, -C * 0.05]);
    for (const x of [S / 2, -S / 2 - 0.008]) m.add(prism(outline, x, x + 0.008, 'x'), mat, el);
  }
  // the mounts
  const X = s.mountX ?? S * 0.3, mt = s.mounts ?? 'straight';
  for (const x of [X, -X]) {
    if (mt === 'swan') {
      // up behind the element and over, holding it from above
      m.add(bar([[x, lift, -C * 0.55], [x, H + thick + 0.07, -C * 0.55], [x, H + thick + 0.07, C * 0.05], [x, H + thick * 0.7, C * 0.05]], 0.016, 0.04, { bend: 0.05, up: [1, 0, 0] }), 'black');
      m.add(bevelBox([x - 0.035, lift - 0.004, -C * 0.55 - 0.05], [x + 0.035, lift + 0.008, -C * 0.55 + 0.05], 0.003), 'black');
    } else if (mt === 'straight' || mt === 'pedestal') {
      const w = mt === 'pedestal' ? 0.05 : 0.016, len = mt === 'pedestal' ? C * 0.7 : C * 0.45;
      m.add(prism([[lift, len / 2], [lift, -len / 2], [H + thick * 0.4, -len * 0.3], [H + thick * 0.4, len * 0.3]], x - w / 2, x + w / 2, 'x'), mt === 'pedestal' ? mat : 'black');
      m.add(bevelBox([x - 0.035, lift - 0.004, -len / 2 - 0.02], [x + 0.035, lift + 0.008, len / 2 + 0.02], 0.003), 'black');
    } else if (mt === 'struts') {
      // hydraulic struts: a thick lower barrel, a chrome rod up to the element
      m.add(cylinder('y', 0.022, lift, H * 0.55, 10, { at: [x, 0, -0.02] }), 'black');
      m.add(cylinder('y', 0.012, H * 0.5, H + thick * 0.3, 8, { at: [x, 0, -0.02] }), 'chrome');
      m.add(bevelBox([x - 0.04, lift - 0.004, -0.07], [x + 0.04, lift + 0.01, 0.03], 0.003), 'black');
    }
  }
  if (mt === 'roof') {
    // off a roof edge: a mounting strip at the front, the element running back from it
    m.add(bevelBox([-S / 2 + 0.02, lift - 0.004, C / 2 - 0.03], [S / 2 - 0.02, H + thick * 0.5, C / 2 + 0.02], 0.006), mat);
  }
  return m;
}

// A ducktail: a lip across the boot lid's back edge, flicked up. settings: { span, chord, height, material }
export function ducktail(id, s) {
  const m = new PartModel(id), S = s.span, C = s.chord, H = s.height, lift = 0.004;
  const profile = [[lift, C / 2], [lift, -C / 2 + 0.01], [H, -C / 2], [H - 0.012, -C / 2 + 0.03], [lift + 0.012, C / 2]];
  // (its ends swept in a little, following the boot)
  const body = prism(profile, -S / 2, S / 2, 'x').map(t => t.map(([x, y, z]) => [x, y, z + (Math.abs(x) > S / 2 - 0.01 ? 0.01 : 0)]));
  m.add(body, s.material ?? 'paint', { node: 'wing_element', pivot: [0, lift, C / 2] });
  return m;
}

// ---------- from the car: lips, splitters, canards, mud flaps ----------

// A lip or splitter under the front bumper, following its bottom outline. settings: { protrude (m, out
// in front of the bumper), under (m, back under it), thick, drop (m: the front edge turned down), fences
// (end plates at its tips), struts (to the bumper), material }
export async function frontLip(id, car, s, socketName = 'socket_front_lip') {
  const m = new PartModel(id), B = await car.bumperOutline(), at = car.socket(socketName);
  if (!B) throw new Error(`${car.id}: no stock front bumper model to follow`);
  const top = B.low - at[1], half = B.halfWidth, t = s.thick ?? 0.018, P = s.protrude ?? 0.04, U = s.under ?? 0.12;
  // the outline in the socket's frame, its tips swept back (round the bumper's corners)
  const pts = B.outline.map(([x, z]) => { const f = Math.max(0, (Math.abs(x) / half - 0.75) / 0.25); return [x - at[0], z - at[2] - P * f * f * 1.4]; });
  const front = pts.map(([x, z]) => [x, z + P]), back = pts.map(([x, z]) => [x, z - U]).reverse();
  m.add(prism([...front, ...back].map(([x, z]) => [x, z]), top - t, top, 'y'), s.material ?? 'carbon');
  // the front edge turned down
  if (s.drop) m.add(prism([...front, ...front.map(([x, z]) => [x, z - 0.02]).reverse()], top - t - s.drop, top - t + 0.002, 'y'), s.material ?? 'carbon');
  if (s.fences) for (const k of [0, front.length - 1]) {
    const [x, z] = front[k], sx = Math.sign(x);
    m.add(bevelBox([x - sx * 0.01 - 0.003, top - t - 0.04, z - U * 0.9], [x - sx * 0.01 + 0.003, top - 0.005, z - 0.01], 0.002), s.material ?? 'carbon');
  }
  if (s.struts) for (const x of [-half * 0.55, half * 0.55]) {
    const z = pts.reduce((b, p) => Math.abs(p[0] - x) < Math.abs(b[0] - x) ? p : b)[1];
    m.add(bevelBox([x - 0.006, top - 0.03, z - U * 0.7], [x + 0.006, top - 0.002, z - U * 0.2], 0.002), 'black');      // (just under the bumper)
  }
  return m;
}

// Canards: pairs of dive planes on the front bumper's corners. settings: { pairs, length, width, rake (deg), heights: [car y…] }
export async function canards(id, car, s) {
  const m = new PartModel(id), B = await car.bumperOutline(), at = car.socket('socket_canards');
  const half = B.halfWidth, zEnd = B.outline[0][1];
  for (const sx of [1, -1]) s.heights.forEach((y, i) => {
    const L = s.length * (1 - i * 0.15), W = s.width * (1 - i * 0.15);
    // a flat plane, swept back, its outer edge raked down at the front
    const plane = prism([[0, 0], [W, -L * 0.25], [W * 0.85, -L], [0, -L * 0.9]], 0, 0.006, 'y');
    const raked = rotated(plane, 'z', -sx * 0).map(t => t.map(([x, yy, z]) => [x, yy + (s.rake ?? 12) * Math.PI / 180 * (z + L), z]));
    const placed = raked.map(t => t.map(([x, yy, z]) => [sx * (half + 0.003 + x) - at[0], y + yy - at[1], zEnd - 0.04 + z + L * 0.2 - at[2]]));
    m.add(sx > 0 ? placed : placed.map(([a, b, c]) => [a, c, b]), 'carbon');
  });
  return m;
}

// Mud flaps: one behind each wheel. settings: { width, height, bottom (car y), material, stripe (colour) }
export function mudFlaps(id, car, s) {
  const m = new PartModel(id), at = car.socket('socket_mud_flaps'), W = s.width, r = car.wheelRadius, T = 0.008;
  // (in the gap just behind each tyre, its outer edge inboard of the body's skin there: the wing's lining in
  // front, the rear quarter's at the back)
  const outer = { F: car.collider.halfExtents[0] - 0.1, R: car.collider.halfExtents[0] - 0.07 };
  for (const k of ['FL', 'FR', 'RL', 'RR']) {
    const w = car.wheels[k], sx = Math.sign(w[0]), xo = sx * Math.min(Math.abs(w[0]) + W / 2, outer[k[0]] - 0.005), xi = xo - sx * W, z = w[2] - r - (k[0] === 'R' ? 0.025 : 0.045), y0 = s.bottom, y1 = s.bottom + s.height;
    const p = (xx, yy, zz) => [xx - at[0], yy - at[1], zz - at[2]], lo = Math.min(xo, xi), hi = Math.max(xo, xi);
    m.add(box(p(lo, y0, z - T), p(hi, y1, z)), s.material ?? 'red');
    m.add(box(p(lo + 0.03, y0 + s.height * 0.25, z - T - 0.0015), p(hi - 0.03, y0 + s.height * 0.35, z - T)), s.stripe ?? 'white');
    m.add(box(p(lo, y1 - 0.025, z), p(hi, y1, z + 0.015)), 'black');
  }
  return m;
}

// The Apex's carbon aero kit: a splitter under the front bumper, dive planes, side blades along the
// sills, and a diffuser with strakes under the back
export async function aeroKit(id, car, s) {
  const m = new PartModel(id), at = car.socket('socket_aero_kit'), B = await car.bumperOutline();
  const p = (x, y, z) => [x - at[0], y - at[1], z - at[2]];
  // the splitter
  const half = B.halfWidth, low = B.low, t = 0.014;
  const pts = B.outline.map(([x, z]) => { const f = Math.max(0, (Math.abs(x) / half - 0.75) / 0.25); return [x, z - 0.1 * f * f]; });
  const outline = [...pts.map(([x, z]) => [x, z + 0.09]), ...pts.map(([x, z]) => [x, z - 0.22]).reverse()].map(([x, z]) => [x - at[0], z - at[2]]);
  m.add(prism(outline, low - t - at[1], low - at[1], 'y'), 'carbon');
  // dive planes, two a side
  // (dive planes on the bumper's corners, ahead of the front wings)
  const wingFront = Math.max(...((await car.stockTris('socket_fender_FL')) ?? [[[0, 0, -9]]]).flat().map(q => q[2])) + 0.008;
  for (const sx of [1, -1]) for (const [y, L0] of [[low + 0.12, 0.2], [low + 0.2, 0.16]]) {
    const z = pts[0][1] - 0.05, L = Math.min(L0, z - wingFront);
    m.add(box(p(sx > 0 ? half + 0.003 : -half - 0.07, y, z - L), p(sx > 0 ? half + 0.07 : -half - 0.003, y + 0.006, z)), 'carbon');
  }
  // side blades along the sills
  // (under the skirts, sticking out past them)
  const sy = car.sills.y - 0.008, front = car.frontAxle - car.wheelRadius - 0.08, rear = car.rearAxle + car.wheelRadius + 0.08;
  for (const sx of [1, -1]) {
    const x = sx * (car.collider.halfExtents[0] - 0.06);
    m.add(box(p(Math.min(x, x + sx * 0.14), sy - 0.006, rear), p(Math.max(x, x + sx * 0.14), sy, front)), 'carbon');
    m.add(box(p(x + sx * 0.135 - 0.003, sy - 0.04, rear + 0.05), p(x + sx * 0.135 + 0.003, sy - 0.006, front - 0.05)), 'carbon');
  }
  // the diffuser: a ramp under the back, and its strakes
  // (under the rear bumper: its floor and strakes below it)
  const rb = (await car.stockTris('socket_bumper_rear'))?.flat(), rz = rb ? Math.min(...rb.map(q => q[2])) : -car.collider.halfExtents[2], rLow = rb ? Math.min(...rb.map(q => q[1])) : car.sills.y;
  const dl = 0.45, dw = half * 0.8, y0 = Math.min(car.sills.y, rLow) - 0.012;
  m.add(prism([[y0 - 0.008, rz + dl], [y0 - 0.008, rz + 0.02], [y0, rz + 0.02], [y0, rz + dl]].map(([y, z]) => [y - at[1], z - at[2]]), -dw, dw, 'x').map(t => t.map(([x, y, z]) => [x - at[0], y, z])), 'carbon');
  for (let i = 0; i < 5; i++) {
    const x = -dw * 0.8 + i * dw * 0.4;
    m.add(prism([[y0 - 0.07, rz + dl * 0.7], [y0 - 0.07, rz + 0.04], [y0 - 0.008, rz + 0.04], [y0 - 0.008, rz + dl * 0.7]].map(([y, z]) => [y - at[1], z - at[2]]), x - 0.004 - at[0], x + 0.004 - at[0], 'x'), 'carbon');
  }
  return m;
}

// ---------- the parts ----------
const WINGS = {
  basic_wing: { design: 'wing on straight uprights', settings: { span: 1.3, chord: 0.26, height: 0.2, mounts: 'straight', mountX: 0.42, plates: { up: 0.05, down: 0.06 }, material: 'black' } },
  kaze_gt_gt_wing: { design: 'GT wing on swan necks', settings: { span: 1.5, chord: 0.3, height: 0.26, mounts: 'swan', mountX: 0.4, plates: { up: 0.06, down: 0.1, long: 0.4 }, gurney: 0.012, material: 'carbon' } },
  hana_roadster_wing: { design: 'small wing on short uprights', settings: { span: 1.2, chord: 0.2, height: 0.11, mounts: 'pedestal', mountX: 0.36, plates: { up: 0.03, down: 0.04 }, material: 'paint' } },
  strada_evo_rear_wing: { design: 'rally wing, big end plates, two elements', settings: { span: 1.4, chord: 0.24, height: 0.18, mounts: 'pedestal', mountX: 0.44, plates: { up: 0.08, down: 0.1, long: 0.36 }, second: { chord: 0.09, gap: 0.015 }, material: 'paint' } },
  vortex_r_roof_wing: { design: 'roof-edge spoiler with side plates', settings: { span: 1.15, chord: 0.22, height: 0.02, thick: 0.1, mounts: 'roof', plates: { up: 0.03, down: 0.0, long: 0.24 }, material: 'paint' } },
  apex_v8_active_wing: { design: 'active wing on hydraulic struts', settings: { span: 1.5, chord: 0.3, height: 0.18, mounts: 'struts', mountX: 0.32, plates: { up: 0.05, down: 0.06 }, gurney: 0.01, material: 'carbon' } },
};

// A wing made to fit each car it goes on: taller uprights (clear of a hatch's glass or an SUV's tailgate),
// its feet a little higher, moved a little — the first that clears the body
const WING_SEARCH = [{ dh: [0, 0.04, 0.08, 0.12, 0.16, 0.2, 0.25], lift: [0.004, 0.012, 0.024, 0.03], dz: [0, -0.04, 0.04, -0.08] }, { dh: 1, lift: 1, dz: 1.5 }];

export async function parts({ project, carsFor }) {
  const { db, rules } = project;
  const jobs = Object.entries(WINGS).map(([id, { design, settings }]) => ({ id, type: 'spoiler', design, settings, cars: carsFor(db.parts[id], db), baseCar: 'starter_car',
    build: fitBuild({ db, rules, type: 'spoiler', slot: 'spoiler', axes: WING_SEARCH[0], weights: WING_SEARCH[1] }, c => wing(id, { ...settings, height: settings.height + c.dh, lift: c.lift }).moved([0, 0, c.dz])) }));
  jobs.push({ id: 'kaze_gt_ducktail', type: 'spoiler', design: 'ducktail', settings: { span: 1.3, chord: 0.15, height: 0.08 }, build: () => ducktail('kaze_gt_ducktail', { span: 1.3, chord: 0.15, height: 0.08 }) });
  const fromCar = (id, type, design, settings, make) => ({ id, type, design, settings, cars: [id.split('_').slice(0, 2).join('_')], build: car => make(id, car, settings) });
  jobs.push(
    fromCar('kaze_gt_front_lip', 'front_lip', 'lip following the bumper', { protrude: 0.04, under: 0.13, thick: 0.016, drop: 0.012 }, frontLip),
    fromCar('hana_roadster_front_lip', 'front_lip', 'lip following the bumper', { protrude: 0.03, under: 0.12, thick: 0.016, material: 'black' }, frontLip),
    fromCar('vortex_r_front_splitter', 'front_lip', 'splitter with struts and fences', { protrude: 0.12, under: 0.12, thick: 0.012, fences: true, struts: true }, frontLip),
    fromCar('kaze_gt_canards', 'canards', 'two pairs of dive planes', { length: 0.25, width: 0.08, rake: 14, heights: [0.33, 0.43] }, canards),
    fromCar('strada_evo_mud_flaps', 'mud_flaps', 'rally flaps behind every wheel', { width: 0.26, height: 0.33, bottom: 0.05, material: 'red', stripe: 'white' }, mudFlaps),
    fromCar('apex_v8_aero_kit', 'aero_kit', 'splitter, dive planes, side blades, diffuser', {}, aeroKit),
  );
  return jobs;
}
