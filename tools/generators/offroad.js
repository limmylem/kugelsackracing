// Off-road parts for the Ridgeback 4x4, each made to fit it from its model: a steel bull bar following
// the front bumper, a winch in it, a snorkel up the right windscreen pillar to roof height, a roof rack
// on the roof, skid plates under the engine and drivetrain, rock sliders along the sills, and 2" and 4"
// lift kits (coil springs on spacers, longer shocks) at each corner. Every one in its socket's frame.

import { bar, bevelBox, box, cylinder, moved, prism, torus, tube } from './lib/geometry.js';
import { PartModel } from './lib/part.js';

const inSocket = (car, name) => { const at = car.socket(name); return (x, y, z) => [x - at[0], y - at[1], z - at[2]]; };

// The bull bar: a 60 mm tube frame round the front, a centre hoop over the winch, light tabs
export async function bullBar(id, car, s) {
  const m = new PartModel(id), p = inSocket(car, 'socket_bull_bar'), r = s.tube ?? 0.03, B = await car.bumperOutline();
  const bump = (await car.stockTris('socket_bumper_front')).flat(), top = Math.max(...bump.map(q => q[1])), low = B.low;
  const zAt = x => B.outline.reduce((b, q) => Math.abs(q[0] - x) < Math.abs(b[0] - x) ? q : b)[1] + s.ahead;
  const half = B.halfWidth - 0.03, T = (pts, rr = r) => m.add(tube(pts.map(q => p(...q)), rr, { sides: 8, bend: 0.09 }), s.material ?? 'black');
  const yLo = low + 0.08, yMid = top + 0.04, yTop = top + s.rise;
  // the lower bar across, the main bar round the front, and the hoop in the middle
  T([[half, yLo, zAt(half) - 0.03], [half * 0.5, yLo, zAt(half * 0.5)], [-half * 0.5, yLo, zAt(-half * 0.5)], [-half, yLo, zAt(-half) - 0.03]]);
  T([[half, yLo, zAt(half) - 0.03], [half, yMid, zAt(half) - 0.03], [half * 0.4, yMid, zAt(half * 0.4) + 0.01], [-half * 0.4, yMid, zAt(-half * 0.4) + 0.01], [-half, yMid, zAt(-half) - 0.03], [-half, yLo, zAt(-half) - 0.03]]);
  T([[half * 0.38, yLo, zAt(0) + 0.02], [half * 0.38, yTop - 0.05, zAt(0) + 0.02], [half * 0.25, yTop, zAt(0) + 0.02], [-half * 0.25, yTop, zAt(0) + 0.02], [-half * 0.38, yTop - 0.05, zAt(0) + 0.02], [-half * 0.38, yLo, zAt(0) + 0.02]]);
 // the plate under the winch (in front of the bumper), and brackets back to the chassis under the bumper
  const face = zAt(0) - s.ahead;
  m.add(bevelBox(p(-half * 0.36, yLo - 0.01, face + 0.006), p(half * 0.36, yLo + 0.012, zAt(0) + 0.02), 0.004), 'dark');
  for (const sx of [1, -1]) m.add(bevelBox(p(sx * half * 0.6 - 0.04, low - 0.07, face - 0.25), p(sx * half * 0.6 + 0.04, low - 0.006, zAt(sx * half * 0.6) - 0.02), 0.006), 'dark');
  for (const sx of [1, -1]) m.add(bevelBox(p(sx * half * 0.6 - 0.03, low - 0.07, zAt(sx * half * 0.6) - 0.05), p(sx * half * 0.6 + 0.03, yLo, zAt(sx * half * 0.6) - 0.01), 0.004), 'dark');
  // light tabs on top of the hoop
  for (const sx of [1, -1]) m.add(bevelBox(p(sx * half * 0.3 - 0.025, yTop + r - 0.004, zAt(0) - 0.01), p(sx * half * 0.3 + 0.025, yTop + r + 0.04, zAt(0) + 0.05), 0.004), 'dark');
  return m;
}

// The winch: its drum and motor across the car, the fairlead in front, the cable and hook
export function winch(id, s) {
  const m = new PartModel(id), W = s.width ?? 0.5, R = s.drum ?? 0.06, y = R + 0.035;
  m.done = () => m.moved([0, 0, s.ahead ?? 0]);
  m.add(bevelBox([-W * 0.42, 0, -0.08], [W * 0.42, 0.03, 0.08], 0.006), 'dark');                             // the mount
  m.add(cylinder('x', R, -W * 0.22, W * 0.12, 14, { at: [0, y, -0.01] }), 'black');                           // the drum (wound with cable)
  for (let i = 0; i < 4; i++) m.add(torus('x', R, 0.008, 14, 4, [-W * 0.18 + i * 0.08, y, -0.01]), 'grey');
  m.add(cylinder('x', R * 1.15, W * 0.12, W / 2, 14, { at: [0, y, -0.01] }), 'grey');                         // the motor
  m.add(bevelBox([-W / 2, 0.02, -0.07], [-W * 0.22, y + R * 1.1, 0.06], 0.012), 'black');                     // the gearbox
  m.add(bevelBox([-0.12, 0.025, 0.07], [0.12, y + 0.04, 0.09], 0.006), 'raw_metal');                          // the fairlead
  m.add(cylinder('y', 0.012, y - 0.03, y + 0.03, 6, { at: [-0.045, 0, 0.085] }), 'silver');
  m.add(cylinder('y', 0.012, y - 0.03, y + 0.03, 6, { at: [0.045, 0, 0.085] }), 'silver');
  m.add(tube([[0, y - R * 0.5, -0.01], [0, y, 0.09], [0, y - 0.02, 0.12]], 0.006, { sides: 4 }), 'dark');
  m.add(torus('x', 0.022, 0.007, 10, 4, [0, y - 0.04, 0.13]), s.hook ?? 'red');
  return m.done();
}

// The snorkel: from the right front wing up the windscreen pillar to a ram head at roof height
export async function snorkel(id, car, s) {
  const m = new PartModel(id), p = inSocket(car, 'socket_snorkel'), C = car.cabin, r = s.radius ?? 0.045;
  const wing = (await car.stockTris('socket_fender_FR')).flat(), x = Math.min(...wing.map(q => q[0])) - r - 0.015;
  const wingTop = Math.max(...wing.map(q => q[1])), headY = car.roof.y + 0.08;
  // up the pillar: from the wing (just ahead of the screen's foot), along the pillar's slope to the roof
  const foot = [x, wingTop - 0.18, C.screenFoot + 0.25], kink = [x, C.belt + 0.02, C.screenFoot + 0.06], up = [x, headY - 0.04, C.screenTop + 0.04];
  m.add(tube([foot, [x, wingTop - 0.02, C.screenFoot + 0.22], kink, up].map(q => p(...q)), r, { sides: 10, bend: 0.12 }), s.material ?? 'black');
  // where it goes into the wing (a flange), and the ram head facing forward
  m.add(bevelBox(p(x - r, foot[1] - 0.04, foot[2] - 0.08), p(x + r + 0.012, foot[1] + 0.06, foot[2] + 0.08), 0.008), s.material ?? 'black');
  m.add(bevelBox(p(x - r * 1.2, headY - 0.08, up[2] - 0.05), p(x + r * 1.2, headY + 0.07, up[2] + 0.16), 0.03), s.material ?? 'black');
  m.add(box(p(x - r, headY - 0.05, up[2] + 0.16), p(x + r, headY + 0.04, up[2] + 0.165)), 'dark');
  // brackets to the pillar
  for (const f of [0.35, 0.75]) { const q = foot.map((v, k) => kink[k] + (up[k] - kink[k]) * f); m.add(bevelBox(p(x + r * 0.6, q[1] - 0.015, q[2] - 0.02), p(x + r + 0.012, q[1] + 0.015, q[2] + 0.02), 0.004), 'raw_metal'); }
  return m;
}

// The roof rack: a tube basket on four feet on the roof
export function roofRack(id, car, s) {
  const m = new PartModel(id), p = inSocket(car, 'socket_roof_rack'), at = car.socket('socket_roof_rack'), R = car.roof;
  const W = Math.min(s.width / 2, R.halfWidth - 0.08), L = s.length / 2, y0 = R.y, yf = y0 + 0.05, yr = yf + 0.07, r = 0.013;
  const z0 = at[2], loop = (y, w, l) => [[w, y, z0 + l], [-w, y, z0 + l], [-w, y, z0 - l], [w, y, z0 - l]];
  // the floor frame, the raised side rails, cross bars, and posts between
  m.add(tube(loop(yf, W, L).map(q => p(...q)), r, { sides: 6, closed: false, bend: 0.08 }).concat(tube([loop(yf, W, L)[3], loop(yf, W, L)[0]].map(q => p(...q)), r, { sides: 6 })), s.material ?? 'black');
  m.add(tube(loop(yr, W, L).map(q => p(...q)), r, { sides: 6, bend: 0.08 }).concat(tube([loop(yr, W, L)[3], loop(yr, W, L)[0]].map(q => p(...q)), r, { sides: 6 })), s.material ?? 'black');
  for (let i = 1; i < 6; i++) { const z = z0 - L + i * 2 * L / 6; m.add(tube([[W, yf, z], [-W, yf, z]].map(q => p(...q)), r * 0.8, { sides: 6 }), s.material ?? 'black'); }
  for (const sx of [1, -1]) for (const z of [z0 + L - 0.02, z0, z0 - L + 0.02]) m.add(cylinder('y', r * 0.8, yf - at[1], yr - at[1], 6, { at: p(sx * W, 0, z).map((v, k) => k === 1 ? 0 : v) }), s.material ?? 'black');
  // the feet on the roof, and a wind deflector at the front
  for (const sx of [1, -1]) for (const z of [z0 + L * 0.7, z0 - L * 0.7]) m.add(bevelBox(p(sx * W - 0.03, y0, z - 0.05), p(sx * W + 0.03, yf, z + 0.05), 0.006), 'dark');
  m.add(prism([[yf, z0 + L + 0.01], [yf, z0 + L - 0.05], [yr + 0.03, z0 + L - 0.02], [yr + 0.03, z0 + L + 0.0]].map(([y, z]) => [y - at[1], z - at[2]]), -W, W, 'x'), 'black');
  return m;
}

// The skid plates: 5 mm steel under the engine (turned up at the front), the gearbox and the transfer case
export async function skidPlates(id, car, s) {
  const m = new PartModel(id), p = inSocket(car, 'socket_skid_plates'), at = car.socket('socket_skid_plates'), t = 0.006, W = s.width / 2;
  const B = await car.bumperOutline(), front = B.outline.reduce((a, q) => Math.min(a, q[1]), Infinity) - 0.12, y = car.sills.y - t - 0.004;     // (under the floor)
  const plates = [[front - 0.75, front], [front - 1.55, front - 0.8], [front - 2.4, front - 1.6]];
  plates.forEach(([z0, z1], i) => {
    const w = W * (i === 2 ? 0.7 : 1);
    m.add(box(p(-w, y, z0), p(w, y + t, z1)), s.material ?? 'raw_metal');
    // ribs pressed into it, and its bolts
    for (const sx of [-0.5, 0, 0.5]) m.add(box(p(sx * w - 0.01, y - 0.008, z0 + 0.05), p(sx * w + 0.01, y, z1 - 0.05)), s.material ?? 'raw_metal');
    for (const sx of [1, -1]) for (const z of [z0 + 0.04, z1 - 0.04]) m.add(cylinder('y', 0.009, y - 0.003 - at[1], y - at[1], 6, { at: p(sx * (w - 0.04), 0, z).map((v, k) => k === 1 ? 0 : v) }), 'black');
  });
  // the front lip, turned up behind the bumper
  const rise = Math.max(0.02, B.low - 0.006 - y);
  m.add(prism([[y, front], [y + t, front], [y + rise, front + 0.12], [y + rise - t, front + 0.125]].map(([yy, z]) => [yy - at[1], z - at[2]]), -W, W, 'x'), s.material ?? 'raw_metal');
  return m;
}

// Rock sliders: a tube along each sill with a kicker out at the front, on brackets to the frame
export function rockSliders(id, car, s) {
  const m = new PartModel(id), p = inSocket(car, 'socket_rock_sliders'), S = car.sills, r = s.tube ?? 0.025;
  // (under the sill, along its outer edge; brackets up to the floor; a kicker tube out to the side)
  const y = S.y - r - 0.012, x = S.x - 0.05, zf = S.front, zr = S.rear;
  for (const sx of [1, -1]) {
    m.add(tube([[sx * x, y, zr], [sx * x, y, zf]].map(q => p(...q)), r, { sides: 8 }), s.material ?? 'black');
    m.add(tube([[sx * x, y, zf - 0.02], [sx * (x + 0.1), y, zf - 0.22], [sx * (x + 0.1), y, zr + 0.22], [sx * x, y, zr + 0.02]].map(q => p(...q)), r * 0.85, { sides: 8, bend: 0.08 }), s.material ?? 'black');
    for (const z of [zf - 0.25, (zf + zr) / 2, zr + 0.25]) m.add(bevelBox(p(sx > 0 ? x - 0.16 : -x, y, z - 0.04), p(sx > 0 ? x : -x + 0.16, S.y - 0.002, z + 0.04), 0.004), 'dark');
  }
  return m;
}

// A lift kit: at each corner a taller coil spring on a spacer, round a longer shock
export function liftKit(id, car, s) {
  const m = new PartModel(id), p = inSocket(car, 'socket_lift_kit'), lift = s.inches * 0.0254, rc = 0.065, wire = 0.009;
  for (const k of ['FL', 'FR', 'RL', 'RR']) {
    const w = car.wheels[k], x = w[0] - Math.sign(w[0]) * 0.22, z = w[2], y0 = w[1] + 0.06, y1 = y0 + 0.3 + lift;
    // the coil: a helix up from the lower seat
    const turns = 4.5, n = 30, coil = Array.from({ length: n + 1 }, (_, i) => { const a = i / n * turns * Math.PI * 2; return [x + rc * Math.cos(a), y0 + 0.02 + (y1 - y0 - 0.04) * i / n, z + rc * Math.sin(a)]; });
    m.add(tube(coil.map(q => p(...q)), wire, { sides: 4 }), s.colour ?? 'red');
    // the seats, the spacer on top, the shock through the middle
    m.add(cylinder('y', rc + 0.02, y0, y0 + 0.012, 10, { at: p(x, 0, z).map((v, i) => i === 1 ? -car.socket('socket_lift_kit')[1] : v) }), 'dark');
    m.add(cylinder('y', rc + 0.015, y1 - at0(car)[1], y1 + lift + 0.015 - at0(car)[1], 10, { at: [x - at0(car)[0], 0, z - at0(car)[2]] }), s.spacer ?? 'raw_metal');
    m.add(cylinder('y', 0.024, y0 - 0.05 - at0(car)[1], y1 - 0.08 - at0(car)[1], 8, { at: [x - at0(car)[0], 0, z - at0(car)[2]] }), s.shock ?? 'yellow');
    m.add(cylinder('y', 0.009, y1 - 0.09 - at0(car)[1], y1 + lift + 0.01 - at0(car)[1], 6, { at: [x - at0(car)[0], 0, z - at0(car)[2]] }), 'chrome');
  }
  return m;
}
const at0 = car => car.socket('socket_lift_kit');

export async function parts() {
  const R = 'ridgeback_4x4', job = (id, type, design, settings, make) => ({ id, type, design, settings, cars: [R], build: car => make(id, car, settings) });
  return [
    job(`${R}_bull_bar`, 'bull_bar', 'steel tube bull bar following the bumper', { tube: 0.03, ahead: 0.07, rise: 0.36, material: 'black' }, bullBar),
    { id: `${R}_winch`, type: 'winch', design: 'drum winch, fairlead and hook', settings: { width: 0.5, drum: 0.06, ahead: 0.095 }, cars: [R], build: () => winch(`${R}_winch`, { width: 0.5, drum: 0.06, ahead: 0.095 }) },
    job(`${R}_snorkel`, 'snorkel', 'up the right windscreen pillar', { radius: 0.045, material: 'black' }, snorkel),
    job(`${R}_roof_rack`, 'roof_rack', 'tube basket on four feet', { width: 1.3, length: 1.8, material: 'black' }, roofRack),
    job(`${R}_skid_plates`, 'skid_plates', 'engine, gearbox and transfer case plates', { width: 1.1, material: 'raw_metal' }, skidPlates),
    job(`${R}_rock_sliders`, 'rock_sliders', 'sill tubes with kickers', { tube: 0.025, material: 'black' }, rockSliders),
    job(`${R}_lift_kit_2in`, 'lift_kit', '2" coils and spacers', { inches: 2, colour: 'red', shock: 'yellow' }, liftKit),
    job(`${R}_lift_kit_4in`, 'lift_kit', '4" coils and spacers', { inches: 4, colour: 'yellow', shock: 'blue' }, liftKit),
  ];
}
