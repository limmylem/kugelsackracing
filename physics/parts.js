// Parts: JSON definitions (parts/<kind>/<id>.json) installed into slots on a car.
//
//   { id, name, slot, socket, mesh (a model file, or null for a placeholder), placeholder: {…},
//     aero: { liftCoefficient (− = downforce), dragCoefficient (added to the car's),
//             point (where the force acts, relative to the socket, car frame, m),
//             angle: { min, max, default, scaleAtMin, scaleAtMax } } }
//
// Aero coefficients are against the car's frontal area, like the body's own. A part with an angle
// range (a wing) scales both its lift and drag with the angle: × scaleAtMin at the minimum, × 1 at
// the default, × scaleAtMax at the maximum. Spoilers are the first; splitters, diffusers and body
// kits use the same format (slot + socket + aero block), just different numbers and sockets.

import { add } from './math.js';

// How much a part's aero is scaled at an angle (degrees)
export function angleScale(aero, angle) {
  const a = aero.angle;
  if (!a) return 1;
  const x = Math.min(a.max, Math.max(a.min, angle ?? a.default));
  return x <= a.default
    ? a.scaleAtMin + (1 - a.scaleAtMin) * (x - a.min) / Math.max(1e-6, a.default - a.min)
    : 1 + (a.scaleAtMax - 1) * (x - a.default) / Math.max(1e-6, a.max - a.default);
}

// A part's aero terms at an angle: { lift, drag, point (car frame) }
export function partAero(def, angle, sockets) {
  const a = def.aero;
  if (!a) return { lift: 0, drag: 0, point: [0, 0, 0] };
  const k = angleScale(a, angle), socket = sockets[def.socket];
  if (!socket) throw new Error(`part ${def.id} needs socket "${def.socket}", which this car hasn't got`);
  return { lift: a.liftCoefficient * k, drag: a.dragCoefficient * k, point: add(socket, a.point) };
}
