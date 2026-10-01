// Big brake kits: a disc (plain, drilled or slotted, its hat in the middle) and a caliper over the
// top of it, behind the axle, as big as its pistons need. One model is drawn at every wheel (look.drawAt:
// "wheels"): on each wheel's hub, steering with it but not turning, made to fit inside the rim that's
// on it. The origin is the hub's centre on the axle; the disc sits behind the wheel's face (−x).

import { around, cylinder, lathe, loft, moved } from './lib/geometry.js';
import { PartModel } from './lib/part.js';

// settings: { disc (radius, m), thickness (m), face: 'plain' | 'drilled' | 'slotted', pistons (per caliper),
//   caliperColour, hatColour }
export function brakeKit(id, s) {
  const m = new PartModel(id), R = s.disc, T = s.thickness ?? 0.028, xd = -0.045, seg = 30;
  if (s.caliperColour) m.material('caliper', { colour: s.caliperColour });
  // the disc (a ring), and its hat (the bell it bolts to the hub with)
  m.add(lathe([[R * 0.55, xd - T / 2], [R, xd - T / 2], [R, xd + T / 2], [R * 0.55, xd + T / 2], [R * 0.55, xd - T / 2]], seg, 'x'), 'raw_metal');
  m.add(lathe([[0.03, xd - T / 2 + 0.004], [R * 0.56, xd - T / 2 + 0.004], [R * 0.56, xd + T / 2 + 0.006], [0.085, xd + T / 2 + 0.03], [0.03, xd + T / 2 + 0.03], [0.03, xd - T / 2 + 0.004]], 16, 'x'), s.hatColour ?? 'dark');
  m.add(around(moved(cylinder('x', 0.006, xd + T / 2, xd + T / 2 + 0.01, 6), [0, R * 0.6, 0]), 10, 'x'), 'silver');
  // its face: drilled holes or slots (dark, just proud of the face)
  const fx = xd + T / 2;
  if (s.face === 'drilled') {
    for (const [k, f, ph] of [[12, 0.72, 0], [12, 0.84, Math.PI / 12], [12, 0.95, 0]]) m.add(around(moved(cylinder('x', 0.0045, fx - 0.001, fx + 0.0012, 5), [0, R * f, 0]), k, 'x', ph), 'black');
  } else if (s.face === 'slotted') {
    const k = 8, slot = (a) => loft([0, 1, 2].map(j => {
      const r = R * (0.62 + 0.13 * j), ang = a + 0.16 * j;
      return [[-0.001, -0.003], [0.0012, -0.003], [0.0012, 0.003], [-0.001, 0.003]].map(([dx, dw]) => [fx + dx, Math.cos(ang) * r - Math.sin(ang) * dw, Math.sin(ang) * r + Math.cos(ang) * dw]);
    }));
    for (let i = 0; i < k; i++) m.add(slot(i * Math.PI * 2 / k), 'black');
  }
  // the caliper: an arc over the top of the disc, behind the axle (−z), straddling it; longer for more pistons
  const pist = s.pistons ?? 4, span = 0.36 + 0.07 * pist, mid = Math.PI / 2 + 0.55, w = T / 2 + 0.024 + 0.002 * pist;
  const rIn = R - 0.05 - 0.002 * pist, rOut = R + 0.014, steps = 5;
  const rings = Array.from({ length: steps + 1 }, (_, i) => {
    const a = mid - span / 2 + span * i / steps, end = i === 0 || i === steps ? 0.006 : 0;
    return [[-w + end, rIn + end], [w - end, rIn + end], [w - end, rOut - end], [-w + end, rOut - end]].map(([dx, r]) => [xd + dx, Math.sin(a) * r, Math.cos(a) * r]);
  });
  m.add(loft(rings), 'caliper');
  // its bridge bolts and a cap per pair of pistons on the outside
  for (let i = 0; i < pist / 2; i++) {
    const a = mid - span / 2 + span * (i + 0.5) / (pist / 2), r = (rIn + rOut) / 2;
    m.add(moved(cylinder('x', 0.011 + 0.001 * pist, xd + w, xd + w + 0.005, 8), [0, Math.sin(a) * r, Math.cos(a) * r]), 'silver');
  }
  return m;
}

const KITS = {
  brakes_street: { design: 'slotted, 4-piston', settings: { disc: 0.152, thickness: 0.026, face: 'slotted', pistons: 4, caliperColour: '#d1232b' } },
  brakes_sport: { design: 'drilled, 4-piston', settings: { disc: 0.165, thickness: 0.028, face: 'drilled', pistons: 4, caliperColour: '#e8b71c' } },
  brakes_race: { design: 'vented, 6-piston', settings: { disc: 0.178, thickness: 0.032, face: 'slotted', pistons: 6, caliperColour: '#e04a1c', hatColour: 'black' } },
};

export async function parts() {
  return Object.entries(KITS).map(([id, { design, settings }]) => ({ id, type: 'brakes', design, settings, set: { look: { drawAt: 'wheels' } }, build: () => brakeKit(id, settings) }));
}
