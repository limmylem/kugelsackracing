// The models still to make (npm run models-todo): every car and part whose definition says its model is
// to do (modelTodo — drawn as a placeholder until then), grouped by car (a part that fits only one car:
// that car's; the rest: every car's), with what it is, its size (its placeholder's bounds) and where it
// goes (its slot, and the socket on each car it fits, in the car's frame) — written to
// docs/models_todo.md, a list to model from (Claude Design, or by hand; then npm run import).
//
//   npm run models-todo            (--check: exit 1 if the file isn't up to date)

import fs from 'node:fs';
import path from 'node:path';
import { loadProject } from './content/project.mjs';
import { ROOT } from './content/rules.mjs';
import { forCar, ownPart } from './content/balance.mjs';

const { db } = await loadProject(), out = path.join(ROOT, 'docs/models_todo.md');
const cm = v => Math.round(v * 100);
// (its placeholder box's size — or a wing's: its span, its height with the uprights, its chord)
const size = p => p.bounds ? `${cm(p.bounds.max[0] - p.bounds.min[0])} × ${cm(p.bounds.max[1] - p.bounds.min[1])} × ${cm(p.bounds.max[2] - p.bounds.min[2])} cm (w × h × l)`
  : p.placeholder?.width ? `${cm(p.placeholder.width)} cm span × ${cm(p.placeholder.height + (p.placeholder.thickness ?? 0.03))} cm tall × ${cm(p.placeholder.chord)} cm chord` : 'no size yet';
const fmt = p => `[${p.map(v => +v.toFixed(2)).join(', ')}]`;
const todoParts = Object.values(db.parts).filter(p => p.modelTodo && !p.retired && !p.variantOf);
const cars = Object.values(db.cars);
// (whose part it is: the one car it's made for, or none — every car's)
const ownerOf = p => cars.find(c => ownPart(db, c.id, p) && !cars.some(o => o.id !== c.id && ownPart(db, o.id, p)))?.id ?? null;
const socketsOn = (car, p) => car.sockets.filter(s => s.slot === p.slot || car.socketGroups?.[p.slot]?.includes(s.name));

const lines = [
  '# Models to make',
  '',
  `Made by \`npm run models-todo\` from the car and part data (each one's \`modelTodo\`): ${cars.filter(c => c.modelTodo).length} cars and ${todoParts.length} parts are drawn as placeholders until their model is made. Sizes are the placeholder boxes' (the part's bounds, in its socket's frame: +z forward, +x left, +y up). Positions are in the car's frame, metres, the ground at y = 0. A part's model has its origin at its socket. Make one, then \`npm run import -- incoming/<type>_<name>.glb\` (a car: \`incoming/car_<id>.glb\`, its parts under their socket nodes).`,
  '',
  'Variants (sizes and finishes of a rim, a tyre in more sizes) use their base part\'s model: only the base is listed.',
  '',
];
const partLine = (p, car) => {
  const on = car ? socketsOn(car, p) : [];
  const where = car ? (on.length ? on.map(s => `\`${s.name}\` at ${fmt(s.position)}`).join(', ') : `slot \`${p.slot}\``) : `slot \`${p.slot}\``;
  return `- **${p.name}** (\`${p.id}\`) — ${p.modelTodo}\n  - size: ${size(p)} · mass ${p.mass} kg · goes on ${where}`;
};
for (const car of cars) {
  const mine = todoParts.filter(p => ownerOf(p) === car.id);
  if (!car.modelTodo && !mine.length) continue;
  const bc = car.dimensions.bodyCollider;
  lines.push(`## ${car.name} (\`${car.id}\`)`, '');
  if (car.modelTodo) {
    const d = car.design ?? JSON.parse(fs.existsSync(path.join(ROOT, `data/cars/${car.id}/design.json`)) ? fs.readFileSync(path.join(ROOT, `data/cars/${car.id}/design.json`), 'utf8') : 'null');
    lines.push(`**The car** — ${car.modelTodo}`, '');
    if (d) lines.push(`- body: ${d.length} × ${d.width} × ${d.height} m (l × w × h), ${d.clearance} m ground clearance; axles at z = ${d.frontAxle} and ${d.rearAxle}, track ${d.track} m; wheels ${d.wheel.rimDiameter}" rims, ${Math.round(d.wheel.radius * 2000)} mm across the tyre`);
    lines.push(`- collider: centre ${fmt(bc.centre)}, half extents ${fmt(bc.halfExtents)}`, `- sockets (nodes the model needs, with each stock part's mesh under its socket): ${[...new Set(car.sockets.map(s => s.node ?? s.name))].map(n => `\`${n}\``).join(', ')}`, `- materials: \`car_atlas\` (the palette texture), \`paint\`, \`glass\`, \`light_head\`, \`light_tail\`; nodes \`body_shell\`, \`glass_*\`, \`light_*\`, \`dashboard\``, '');
  }
  if (mine.length) lines.push(`**Its own parts**`, '', ...mine.sort((a, b) => a.slot.localeCompare(b.slot) || a.price - b.price).map(p => partLine(p, car)), '');
}
const every = todoParts.filter(p => !ownerOf(p));
if (every.length) {
  lines.push('## Parts for every car', '', 'Each goes on every car it fits (its socket there is listed per car in the car\'s data); one model for all of them, at the size below.', '');
  const bySlot = new Map();
  for (const p of every) { if (!bySlot.has(p.slot)) bySlot.set(p.slot, []); bySlot.get(p.slot).push(p); }
  for (const [slot, list] of [...bySlot].sort()) {
    const fits = cars.filter(c => list.some(p => forCar(db, c.id, p))).map(c => c.name);
    lines.push(`### ${slot.replace(/_/g, ' ')}`, '', `fits: ${fits.join(', ') || '—'}`, '', ...list.sort((a, b) => a.price - b.price).map(p => partLine(p, null)), '');
  }
}
const text = lines.join('\n').replace(/\n{3,}/g, '\n\n');
if (process.argv.includes('--check')) {
  const same = fs.existsSync(out) && fs.readFileSync(out, 'utf8') === text;
  console.log(same ? 'docs/models_todo.md is up to date' : 'docs/models_todo.md is out of date: npm run models-todo');
  process.exit(same ? 0 : 1);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, text);
console.log(`docs/models_todo.md: ${cars.filter(c => c.modelTodo).length} cars, ${todoParts.length} parts to model`);
