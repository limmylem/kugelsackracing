// Lights: fog lights (round with chrome bezels, or rectangular yellow ones), underglow strips made to
// each car's underside (sills and bumpers, from its model), an LED light bar and a rally pod of round
// spot lamps. Lenses are light_aux: the game lights them, in the light's colour where the part has one
// (its cosmetic effect: fog, underglow).

import { annulus, bevelBox, box, cylinder, lathe, moved } from './lib/geometry.js';
import { PartModel } from './lib/part.js';
import { fitBuild } from './lib/fitcheck.js';

// ---------- fog lights: a pair, their middle at the socket ----------
// settings: { spacing (m between them), shape ('round' | 'rect'), size (diameter, or [w, h]), lens (colour) }
export function fogLights(id, s) {
  const m = new PartModel(id), half = s.spacing / 2;
  if (s.lens) m.material('light_aux', { colour: s.lens, emissive: s.lens });
  for (const x of [half, -half]) {
    if (s.shape === 'round') {
      const R = s.size / 2;
      m.add(moved(lathe([[0, -0.07], [R * 0.7, -0.07], [R, -0.03], [R, 0.0], [0, 0.0]], 16, 'z'), [x, R, 0]), 'black');
      m.add(annulus('z', R * 0.86, R * 1.06, -0.004, 0.012, 16, [x, R, 0]), 'chrome');
      m.add(cylinder('z', R * 0.86, 0.0, 0.008, 16, { at: [x, R, 0] }), 'light_aux');
    } else {
      const [w, h] = s.size;
      m.add(bevelBox([x - w / 2, 0, -0.06], [x + w / 2, h, 0.0], 0.008), 'black');
      m.add(bevelBox([x - w / 2 + 0.008, 0.008, -0.002], [x + w / 2 - 0.008, h - 0.008, 0.008], 0.003), 'light_aux');
    }
  }
  return m;
}

// ---------- underglow: strips along the sills and under the bumpers, from the car ----------
export async function underglow(id, car, s) {
  const m = new PartModel(id), at = car.socket('socket_underglow'), p = (x, y, z) => [x - at[0], y - at[1], z - at[2]];
  if (s.colour) m.material('light_aux', { colour: s.colour, emissive: s.colour });
  const y = car.sills.y - 0.014, x = car.collider.halfExtents[0] - 0.12;
  const fb = await car.stockTris('socket_bumper_front'), rb = await car.stockTris('socket_bumper_rear');
  const zf = (fb ? Math.max(...fb.flat().map(q => q[2])) : car.collider.halfExtents[2]) - 0.18, zr = (rb ? Math.min(...rb.flat().map(q => q[2])) : -car.collider.halfExtents[2]) + 0.18;
  const strip = (a, b) => { m.add(box(p(...a.map((v, k) => v - [0.014, 0, 0.014][k])), p(...b.map((v, k) => v + [0.014, 0.012, 0.014][k]))), 'black'); m.add(box(p(a[0] - 0.008, a[1] - 0.006, a[2] - 0.008), p(b[0] + 0.008, a[1] + 0.001, b[2] + 0.008)), 'light_aux'); };
  for (const sx of [1, -1]) strip([sx * x, y, car.rearAxle + car.wheelRadius + 0.12], [sx * x, y, car.frontAxle - car.wheelRadius - 0.12]);
  strip([-x * 0.8, y, zf], [x * 0.8, y, zf]);
  strip([-x * 0.8, y, zr], [x * 0.8, y, zr]);
  return m;
}

// ---------- a light bar: LEDs in a long housing, on brackets ----------
// settings: { width, height, depth, drop (m: the brackets down to the roof) }
export function lightBar(id, s) {
  const m = new PartModel(id), W = s.width, H = s.height, D = s.depth, drop = s.drop ?? 0.07;
  m.add(bevelBox([-W / 2, 0, -D / 2], [W / 2, H, D / 2], 0.012), 'black');
  m.add(bevelBox([-W / 2 + 0.02, 0.012, D / 2 - 0.004], [W / 2 - 0.02, H - 0.012, D / 2 + 0.006], 0.003), 'light_aux');
  // dividers between the LED cells
  const n = Math.round((W - 0.04) / 0.06);
  for (let i = 1; i < n; i++) { const x = -W / 2 + 0.02 + i * (W - 0.04) / n; m.add(box([x - 0.002, 0.012, D / 2 + 0.006], [x + 0.002, H - 0.012, D / 2 + 0.009]), 'dark'); }
  for (const sx of [1, -1]) {
    m.add(bevelBox([sx * (W / 2 - 0.05) - 0.012, -drop, -D / 2 + 0.01], [sx * (W / 2 - 0.05) + 0.012, 0.004, D / 2 - 0.01], 0.003), 'raw_metal');
    m.add(bevelBox([sx * (W / 2 - 0.05) - 0.04, -drop, -0.05], [sx * (W / 2 - 0.05) + 0.04, -drop + 0.008, 0.05], 0.003), 'black');
  }
  return m;
}

// ---------- a rally light pod: round spot lamps in a pod, strapped on ----------
// settings: { width, height, depth, lamps, lamp (diameter) }
export function rallyPod(id, s) {
  const m = new PartModel(id), W = s.width, H = s.height, D = s.depth, n = s.lamps, R = s.lamp / 2;
  m.add(bevelBox([-W / 2, 0, -D / 2], [W / 2, H, D * 0.2], 0.03), 'black');
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + W * (i + 0.5) / n;
    m.add(annulus('z', R * 0.84, R, D * 0.2 - 0.01, D / 2, 16, [x, H / 2, 0]), 'chrome');
    m.add(cylinder('z', R * 0.84, D * 0.2 - 0.01, D / 2 - 0.012, 16, { at: [x, H / 2, 0] }), 'light_aux');
    m.add(box([x - R * 0.84, H / 2 - 0.003, D / 2 - 0.012], [x + R * 0.84, H / 2 + 0.003, D / 2 - 0.006]), 'dark');      // (the lens's bar)
  }
  // the straps over the bonnet
  for (const sx of [1, -1]) m.add(box([sx * W * 0.3 - 0.02, -0.004, -D / 2 - 0.12], [sx * W * 0.3 + 0.02, 0.004, -D / 2 + 0.01]), 'black');
  return m;
}

// (how far a socket is above the roof under it: a ray straight down onto it)
const roofBelow = (car, name) => { const at = car.socket(name), top = at[1] + 1; return at[1] - (top - car.ray([at[0], top, at[2]], [0, -1, 0])); };

// (the front bumper's face in the fog light socket's frame: how far forward it is behind a point)
async function bumperFace(car) {
  const at = car.socket('socket_fog_lights'), tris = await car.obstacles(['socket_bumper_front']);
  return (x, y) => { const d = car.ray([x, y + at[1], at[2] + 3], [0, 0, -1], tris); return Number.isFinite(d) ? 3 - d : -Infinity; };
}
// (the lamps moved forward until their backs are just clear of the bumper's face: a grid over each lamp's
// outline, seen from the front, in front of it)
function onBumper(m, face) {
  const pts = m.tris().flat(), back = Math.min(...pts.map(p => p[2]));
  let front = -Infinity;
  for (const side of [1, -1]) {
    const q = pts.filter(p => p[0] * side > 0), lo = [0, 1].map(k => Math.min(...q.map(p => p[k]))), hi = [0, 1].map(k => Math.max(...q.map(p => p[k])));
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) front = Math.max(front, face(lo[0] + (hi[0] - lo[0]) * i / 4, lo[1] + (hi[1] - lo[1]) * j / 4));
  }
  return Number.isFinite(front) ? m.moved([0, 0, front + 0.004 - back]) : m;
}

const UNDERGLOW = { underglow_blue: '#2f8cff', underglow_green: '#3ddc84', underglow_purple: '#9b5cff', underglow_red: '#ff3b3b', underglow_white: '#f2f6ff' };

export async function parts({ carsFor, project }) {
  const { db, rules } = project;
  // (fog lights made to fit each car's bumper: on its face, higher or lower, closer together)
  const fog = (id, settings) => ({ id, type: 'fog_lights', settings, cars: carsFor(db.parts[id], db), baseCar: 'starter_car',
    build: async car => {
      const face = await bumperFace(car);
      return fitBuild({ db, rules, type: 'fog_lights', slot: 'fog_lights', axes: { dy: [0, 0.03, -0.03, 0.06, -0.06], k: [1, 0.9, 0.8, 0.7] }, weights: { k: 1.5 } },
        c => onBumper(fogLights(id, { ...settings, spacing: settings.spacing * c.k }).moved([0, c.dy, 0]), face))(car);
    } });
  const jobs = [
    { ...fog('fog_lights_round', { spacing: 1.1, shape: 'round', size: 0.1 }), design: 'round, chrome bezels' },
    { ...fog('fog_lights_yellow', { spacing: 1.1, shape: 'rect', size: [0.14, 0.07], lens: '#ffd24a' }), design: 'rectangular, yellow lenses' },
    // (its brackets down to the roof under it)
    { id: 'ridgeback_4x4_light_bar', type: 'light_bar', design: 'LED light bar', settings: { width: 1.2, height: 0.08, depth: 0.09 }, cars: ['ridgeback_4x4'], build: car => lightBar('ridgeback_4x4_light_bar', { width: 1.2, height: 0.08, depth: 0.09, drop: roofBelow(car, 'socket_light_bar') }) },
    { id: 'strada_evo_rally_lights', type: 'rally_lights', design: 'four-lamp pod', settings: { width: 1.1, height: 0.22, depth: 0.15, lamps: 4, lamp: 0.15 }, build: () => rallyPod('strada_evo_rally_lights', { width: 1.1, height: 0.22, depth: 0.15, lamps: 4, lamp: 0.15 }) },
  ];
  for (const [id, colour] of Object.entries(UNDERGLOW)) jobs.push({ id, type: 'underglow', design: 'LED strips, sills and bumpers', settings: { colour }, cars: carsFor(project.db.parts[id], project.db), baseCar: 'starter_car', build: car => underglow(id, car, { colour }) });
  return jobs;
}
