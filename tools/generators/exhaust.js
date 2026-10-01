// Exhaust tips: single, dual and quad round tips, an oval tip and a burnt titanium one — the end of the
// cat-back, out of the rear bumper. Each tip is a pipe with a rolled (or slash-cut) outlet and a dark
// inside; the origin is the front of the tips, where they meet the pipe, and they point back (−z).

import { annulus, cylinder, lathe, moved, scaled, tube } from './lib/geometry.js';
import { PartModel, suggestPrice } from './lib/part.js';

// settings: { tips: [[x, y], …] (each tip's centre), radius, length, shape ('round' | 'oval': squashed in y),
//   cut ('rolled' | 'slash' | 'straight'), material ('chrome' | 'titanium' | 'raw_metal'), joiner (a pipe
//   joining twin tips to one inlet), segments (round each tip) }
export function exhaustTip(id, s) {
  const m = new PartModel(id), R = s.radius, L = s.length ?? 0.18, mat = s.material ?? 'chrome', seg = s.segments ?? 16;
  const squash = s.shape === 'oval' ? [1.45, 0.7, 1] : [1, 1, 1];
  for (const [x, y] of s.tips) {
    // the tip's wall: a ring along z from the inlet (z = 0) back to its mouth, rolled over at the end
    const lip = s.cut === 'rolled' ? [[R * 0.88, -L], [R * 1.08, -L + 0.004], [R * 1.08, -L + 0.018]] : [[R * 0.88, -L], [R, -L]];
    const prof = [[R * 0.7, 0], [R * 0.82, 0], [R * 0.82, -0.04], [R, -0.06], ...lip.reverse().map(p => p), [R * 0.86, -L + 0.002], [R * 0.86, -0.06], [R * 0.7, -0.04], [R * 0.7, 0]];
    let wall = lathe(prof.map(([r, z]) => [r, z]), seg, 'z');
    if (s.cut === 'slash') wall = wall.map(t => t.map(([px, py, pz]) => [px, py, pz < -L * 0.6 ? pz + (py / R) * 0.035 : pz]));
    m.add(moved(scaled(wall, squash), [x, y, 0]), mat);
    // the dark inside, set back from the mouth
    m.add(moved(scaled(cylinder('z', R * 0.86, -L + 0.03, -L + 0.034, seg), squash), [x, y, 0]), 'black');
  }
  // the inlet pipe stub, and the joiner across twin tips
  const xs = s.tips.map(t => t[0]), cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  if (s.tips.length > 1) m.add(moved(scaled(annulus('z', 0, 1, -0.05, -0.02, 4), [Math.max(...xs) - Math.min(...xs) + R * 1.4, R * 1.4 * (s.shape === 'oval' ? 0.7 : 1), 1]), [cx, (Math.min(...s.tips.map(t => t[1])) + Math.max(...s.tips.map(t => t[1]))) / 2, 0]), 'raw_metal');
  m.add(cylinder('z', 0.028, 0, -0.03, 10, { at: [cx, s.tips[0][1], 0] }), 'raw_metal');
  return m;
}

const TIPS = [
  ['catback_street', null, 'single round tip', { tips: [[0, 0]], radius: 0.045, length: 0.18, cut: 'rolled', material: 'chrome' }],
  ['catback_sport', null, 'dual round tips', { tips: [[0.05, 0], [-0.05, 0]], radius: 0.04, length: 0.18, cut: 'rolled', material: 'raw_metal' }],
  ['catback_race', null, 'twin burnt titanium tips, slash cut', { tips: [[0.055, 0], [-0.055, 0]], radius: 0.045, length: 0.2, cut: 'slash', material: 'titanium' }],
  ['catback_quad', ['Cat-back exhaust, quad tips (sport)', 'sport'], 'quad round tips', { tips: [[0.05, 0.035], [-0.05, 0.035], [0.05, -0.035], [-0.05, -0.035]], radius: 0.03, length: 0.16, cut: 'straight', material: 'chrome', segments: 12 }],
  ['catback_oval', ['Cat-back exhaust, oval tip (street)', 'street'], 'single oval tip', { tips: [[0, 0]], radius: 0.05, length: 0.17, shape: 'oval', cut: 'rolled', material: 'chrome' }],
];

export async function parts({ project }) {
  // (a new tip starts as the cat-back of its tier: its sound and what it does, to balance)
  const like = tier => { const p = project.db.parts[`catback_${tier}`]; const { id, name, model, icon, bounds, massOffset, madeBy, _note, modelTodo, placeholder, byCar, todo, _todo, ...rest } = p; return rest; };
  return TIPS.map(([id, isNew, design, settings]) => ({
    id, type: 'exhaust', design, settings, build: () => exhaustTip(id, settings),
    defaults: isNew && { ...like(isNew[1]), name: isNew[0], tier: isNew[1], price: suggestPrice('exhaust', isNew[1]), todo: ['price', 'effects'], _note: `${isNew[0]}: ${design}, from tools/generators/exhaust.js. It starts with the ${isNew[1]} cat-back's sound and gains: balance them.` },
  }));
}
