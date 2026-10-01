// What the effects need to know about a car (effects/director.js setCar), from the garage: what it's made
// of where it's touching something (its parts' contactMaterial: metal sparks, plastic doesn't), the
// colour of the part hit (debris: chips of its paint, or its finish's colour), where its engine bay is
// (steam, smoke, a blown engine's flame), when it runs hot (its cooling rules) and its tyre smoke colour.
// Pure (no rendering), so both worlds and the tests use it.

import { damageLayout } from '../garage/damage.js';

const METAL_CATEGORIES = new Set(['wheels', 'exhaust', 'engine', 'brakes', 'suspension', 'drivetrain', 'turbo', 'intercooler', 'intake']);
// what a part's outside is made of: its own tag, or (parts that don't say) by what kind of part it is
export function contactMaterialOf(part) {
  if (!part) return 'metal';
  if (part.contactMaterial) return part.contactMaterial;
  if (part.category === 'tyres') return 'rubber';
  return METAL_CATEGORIES.has(part.category) ? 'metal' : 'plastic';
}

const DARK = { rubber: '#1b1b1c', fabric: '#202124', carbon: '#1c1e21' };
const inside = (p, b, m) => [0, 1, 2].every(k => p[k] >= b.min[k] - m && p[k] <= b.max[k] + m);
const volume = b => [0, 1, 2].reduce((a, k) => a * Math.max(1e-3, b.max[k] - b.min[k]), 1);

// session: garage/session.js (its car, build, data and paint); boxes: the body model's node boxes
// (physics/sockets.js nodeBoxes: body_shell, glass, lights); paint: another paint (an AI car's)
export function carEffectsInfo(session, boxes = {}, { paint = null } = {}) {
  const garage = session.garage, car = garage.car, db = session.db, view = garage.view;
  const layout = damageLayout({ car, build: garage.build, db: view, boxes }, db.damage);
  const partIn = socket => { const id = socket && garage.build.sockets?.[socket]; return id ? db.parts[view.owned[id]?.partId] ?? null : null; };
  const partAt = p => {
    let best = null;
    for (const x of layout.parts) if (inside(p, x.box, 0.06) && (!best || volume(x.box) < volume(best.box))) best = x;
    return best?.part ?? null;
  };
  const paintColour = paint?.colour ?? session.paint?.colour ?? '#8c9092';
  const colourOf = part => {
    if (!part) return paintColour;                                   // (the body shell: painted)
    const m = contactMaterialOf(part), finish = part.look?.finish && db.finishes[part.look.finish];
    if (finish && !finish.paint && finish.colour) return finish.colour;
    if (!db.damage.exterior.includes(part.category)) return m === 'metal' ? '#9a9da0' : '#1c1d20';     // (an exhaust: bare metal)
    return DARK[m] ?? paintColour;
  };
  const engine = car.sockets.find(s => s.name === 'socket_engine'), enginePart = partIn('socket_engine');
  const top = enginePart?.bounds?.max?.[1] ?? 0.5;
  return {
    anchors: { engine: engine ? [engine.position[0], engine.position[1] + top + 0.05, engine.position[2]] : null },
    smoke: session.spec.cosmetic?.smoke || null,
    cooling: session.spec.damage?.rules?.cooling ?? null,
    // what it's made of at a point (car frame) or in a socket
    materialAt: (point, socket) => contactMaterialOf(socket && socket !== 'shell' ? partIn(socket) : point ? partAt(point) : null),
    colourAt: (point, socket) => colourOf(socket && socket !== 'shell' ? partIn(socket) : point ? partAt(point) : null),
    // a part torn off (its socket; a wheel's: the tyre rolling)
    pieceMaterial: socket => Object.values(car.model.sockets ?? {}).includes(socket) ? 'rubber' : contactMaterialOf(partIn(socket)),
  };
}
