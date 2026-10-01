// The engine bay: strut braces made to each car's suspension towers — a bar from one strut top to the
// other, with a mounting plate on each tower, measured from the car (its strut brace socket, between the
// front wheels; a mid-engined car's, between the rear ones). The origin is the bar's middle.

import { bevelBox, cylinder, lathe, moved, prism, tube } from './lib/geometry.js';
import { PartModel } from './lib/part.js';
import { fitBuild } from './lib/fitcheck.js';

// settings: { bar ('round' | 'flat'), radius (m), material ('chrome' | 'carbon' | 'raw_metal'), plates (material),
//   rise (m: the bar arched up in the middle, clear of the engine), drop (m: all of it lower, under a low
//   bonnet), kx (the towers' spread, × the measured) }
export function strutBrace(id, car, s) {
  const m = new PartModel(id), T = car.towers, at = car.socket('socket_strut_brace'), r = s.radius ?? 0.016;
  if (!T) throw new Error(`${car.id} has no strut brace socket`);
  const x = T.x * (s.kx ?? 1), y = T.y - at[1] - (s.drop ?? 0), z = T.z - at[2], rise = s.rise ?? 0.03;
  // the mounting plates: a three-bolt triangle on each tower top
  for (const sx of [1, -1]) {
    const cx = sx * x;
    m.add(prism([[cx - 0.05, z - 0.045], [cx + 0.05, z - 0.045], [cx + sx * 0.0 + 0.0, z + 0.06]], y - 0.004, y + 0.006, 'y'), s.plates ?? 'raw_metal');
    for (const [dx, dz] of [[-0.03, -0.025], [0.03, -0.025], [0, 0.035]]) m.add(cylinder('y', 0.008, y + 0.006, y + 0.016, 6, { at: [cx + dx, 0, z + dz] }), 'black');
    // the bracket up to the bar
    m.add(bevelBox([cx - 0.02, y + 0.006, z - 0.02], [cx + 0.02, y + 0.045, z + 0.02], 0.004), s.plates ?? 'raw_metal');
  }
  // the bar, across (arched a little in the middle)
  const yb = y + 0.04, ends = [[x - 0.01, yb, z], [x * 0.55, yb + rise, z], [-x * 0.55, yb + rise, z], [-x + 0.01, yb, z]];
  if ((s.bar ?? 'round') === 'round') m.add(tube(ends, r, { sides: 10, bend: 0.12 }), s.material ?? 'chrome');
  else m.add(tube(ends, r, { sides: 4, bend: 0.12 }), s.material ?? 'carbon');
  // a centre badge plate
  m.add(bevelBox([-0.04, yb + rise + r - 0.002, z - 0.012], [0.04, yb + rise + r + 0.004, z + 0.012], 0.002), s.badge ?? 'red');
  return m;
}

const BRACES = {
  strut_brace: { design: 'polished alloy bar', settings: { bar: 'round', radius: 0.016, material: 'chrome', plates: 'raw_metal', rise: 0.035, badge: 'red' } },
  strut_brace_carbon: { design: 'carbon bar, alloy plates', settings: { bar: 'flat', radius: 0.02, material: 'carbon', plates: 'raw_metal', rise: 0.03, badge: 'blue' } },
};

// (made to fit under each car's bonnet: the bar arched less, lower on its brackets)
export async function parts({ carsFor, project }) {
  const { db, rules } = project;
  return Object.entries(BRACES).map(([id, { design, settings }]) => ({ id, type: 'strut_brace', design, settings, cars: carsFor(db.parts[id], db), baseCar: 'starter_car',
    build: fitBuild({ db, rules, type: 'strut_brace', slot: 'strut_brace', axes: { rise: [settings.rise, 0.015, 0], drop: [0, 0.01, 0.02, 0.03, 0.045, 0.06, 0.08], kx: [1, 0.92, 0.85, 0.78] } }, (c, car) => strutBrace(id, car, { ...settings, rise: c.rise, drop: c.drop, kx: c.kx })) }));
}
