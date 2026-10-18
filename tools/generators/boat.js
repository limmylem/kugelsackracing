// The boat kit (physics/boat.js): floats along each car's sills — two long inflatable tubes, rounded at both ends, on
// brackets up to the body, made to each car's length and width — and outboard motors clamped to the back, the same
// on every car (a cowl, a leg down to a propeller below the bumper). A novelty: the car floats, and the motor pushes it.

import { bar, box, cylinder, lathe, moved } from './lib/geometry.js';
import { PartModel } from './lib/part.js';

// ---------- floats: a tube under each sill ----------
// settings: { r (the tube's radius), colour }
export function floats(id, car, s) {
  const m = new PartModel(id), at = car.socket('socket_boat_floats');
  // (outside the wheels and the sills, its top at the sills' height; as long as the wheelbase and a bit)
  const side = Math.max(car.sills.x, Math.abs(car.wheels.FL[0]) + 0.17), x = side + s.r + 0.03, y = car.sills.y - at[1] - s.r * 0.15;
  const half = (car.frontAxle - car.rearAxle) / 2 + car.wheelRadius * 0.6, zc = (car.frontAxle + car.rearAxle) / 2 - at[2];
  // (a tube along z: a lathe round its own axis, its ends rounded)
  const prof = [[0, -half - s.r]], n = 6;
  for (let i = 1; i <= n; i++) { const a = (i / n) * Math.PI / 2; prof.push([Math.sin(a) * s.r, -half - s.r + (1 - Math.cos(a)) * s.r]); }
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; prof.push([Math.cos(a) * s.r, half + Math.sin(a) * s.r]); }
  prof.push([0, half + s.r]);
  for (const sx of [1, -1]) {
    m.add(moved(lathe(prof, 14, 'z'), [sx * x, y, zc]), s.colour);
    // (stripes round it, and arms in to the sill between the wheels)
    for (const z of [-half * 0.6, 0, half * 0.6]) m.add(cylinder('z', s.r * 1.02, z + zc - 0.03, z + zc + 0.03, 14, { at: [sx * x, y, 0] }), 'white');
    for (const z of [-0.35, 0.35]) { const xa = sx * (car.sills.x - 0.01), xb = sx * (x - s.r * 0.7); m.add(box([Math.min(xa, xb), y - 0.025, z + zc - 0.035], [Math.max(xa, xb), y + 0.025, z + zc + 0.035]), 'dark'); }
  }
  return m;
}

// ---------- an outboard motor: a cowl on a clamp at the bumper, its leg down to the propeller ----------
// settings: { size (the cowl's height), colour } — its socket on each car is just behind the rear bumper
export function outboard(id, s) {
  const m = new PartModel(id), h = s.size, w = h * 0.55, d = h * 0.8;
  // (the clamp on the bumper, the cowl behind it, the leg down, the gearcase and the propeller below)
  m.add(box([-0.06, -0.05, -0.08], [0.06, 0.12, 0]), 'dark');
  m.add(moved(lathe([[0, 0], [w * 0.5, 0.02], [w * 0.55, h * 0.5], [w * 0.4, h * 0.95], [0, h]], 12, 'y'), [0, 0.1, -d * 0.45]), s.colour);
  m.add(box([-w * 0.3, 0.1 + h * 0.35, -d * 0.45 - w * 0.62], [w * 0.3, 0.1 + h * 0.62, -d * 0.45 - w * 0.5]), 'white');
  m.add(box([-0.04, -h * 0.9, -d * 0.45 - 0.05], [0.04, 0.12, -d * 0.45 + 0.05]), 'grey');
  m.add(cylinder('z', 0.06, -d * 0.45 - 0.16, -d * 0.45 + 0.05, 10, { at: [0, -h * 0.9, 0] }), 'grey');
  m.add(box([-0.01, -h * 0.9 - 0.14, -d * 0.45 - 0.05], [0.01, -h * 0.9, -d * 0.45 + 0.08]), 'grey');
  // (the propeller: three blades round its hub behind the gearcase)
  for (let k = 0; k < 3; k++) {
    const a = k * 2 * Math.PI / 3, r = h * 0.28, z = -d * 0.45 - 0.2, y = -h * 0.9;
    m.add(bar([[0, y, z], [Math.cos(a) * r, y + Math.sin(a) * r, z]], 0.07, 0.014), 'silver');
  }
  m.add(cylinder('z', 0.035, -d * 0.45 - 0.24, -d * 0.45 - 0.16, 10, { at: [0, -h * 0.9, 0] }), 'silver');
  return m;
}
const FLOATS = { boat_floats: { r: 0.2, colour: 'orange', design: 'orange inflatable tubes' }, boat_floats_grey: { r: 0.24, colour: 'grey', design: 'grey heavy-duty tubes' } };
const MOTORS = { outboard_15: { size: 0.44, colour: 'white', design: 'small white outboard' }, outboard_60: { size: 0.56, colour: 'dark', design: 'big black outboard' } };

export async function parts({ carsFor, project }) {
  const jobs = [];
  for (const [id, s] of Object.entries(FLOATS)) jobs.push({ id, type: 'boat_floats', design: s.design, settings: { r: s.r, colour: s.colour }, cars: project.db.parts[id] ? carsFor(project.db.parts[id], project.db) : Object.keys(project.db.cars), baseCar: 'starter_car', build: car => floats(id, car, s) });
  for (const [id, s] of Object.entries(MOTORS)) jobs.push({ id, type: 'outboard', design: s.design, settings: { size: s.size, colour: s.colour }, build: () => outboard(id, s) });
  return jobs;
}
