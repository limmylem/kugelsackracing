// Rims (wheels without their tyres: the game makes each tyre to fit its rim). One builder, rim(settings),
// for every design: the barrel and its flanges, a face of spokes (straight, paired, twisted, split,
// mesh, slotted or holed), its dish (how far the face sits in from the outer lip), a lip ring, the hub
// with its nuts and centre cap, and a beadlock ring with its bolts. The origin is the wheel's centre on
// the axle, the outer face towards +x (the left-hand wheel: the game turns the right-hand sockets round).
//
// The four from docs/models_todo.md (rim_multispoke, rim_rally, rim_beadlock, rim_deepdish: their
// sizes and finishes are variants of these) and a variety pack of 20 more designs, new parts with their
// price to do.

import { annulus, around, cylinder, lathe, loft, moved } from './lib/geometry.js';
import { PartModel, suggestPrice } from './lib/part.js';

const IN = 0.0254;

// settings: {
//   diameter, width (inches: the bead seat's diameter and the width between the flanges),
//   spokes (how many), spoke: 'straight' | 'paired' | 'twisted' | 'split' | 'mesh' | 'slot' | 'holes',
//   spokeWidth (m, at the hub), taper (the width at the rim, × spokeWidth), thickness (m, along the axle),
//   twist (radians across the spoke's length), concave (m: the hub stands this far out of the face's rim end),
//   dish (m: the face this far in from the outer flange), lip (m: a flat lip ring this wide round the outside of the face),
//   lipMaterial, cap: 'flat' | 'dome' | 'none', capMaterial, nuts (how many), beadlock (true: a bolted ring),
//   holes (for 'holes' / 'slot': how many), colour / metalness / roughness (the face's own look) }
export function rim(id, s) {
  const m = new PartModel(id), R = s.diameter * IN / 2, W = s.width * IN, seg = s.segments ?? 28;
  if (s.colour) m.material('rim_finish', { colour: s.colour, metalness: s.metalness ?? 0.75, roughness: s.roughness ?? 0.3 });
  const fl = 0.016, wall = 0.011, front = W / 2, back = -W / 2;
  // the barrel: flange, bead seat, the drop well, the other flange (a closed ring round x)
  const prof = [
    [R + fl, front + 0.009], [R + fl, front - 0.004], [R, front - 0.012], [R, front * 0.35], [R - 0.022, front * 0.15], [R - 0.022, back * 0.45],
    [R, back * 0.65], [R, back + 0.012], [R + fl, back + 0.004], [R + fl, back - 0.009], [R - wall, back - 0.009], [R - wall - 0.022, back * 0.45 + 0.004],
    [R - wall - 0.022, front * 0.15 - 0.004], [R - wall, front * 0.35], [R - wall, front + 0.009], [R + fl, front + 0.009],
  ];
  m.add(lathe(prof.map(([r, x]) => [r, x]), seg, 'x'), 'rim_finish');

  // the face: where it sits (in from the front by the dish), and how far it reaches out
  const lip = s.lip ?? 0, dish = s.dish ?? 0.012, t = s.thickness ?? 0.024, faceX = front - dish - t / 2;
  const rIn = 0.072, rOut = (lip ? R - lip : R - wall) + 0.004, concave = s.concave ?? 0.012;
  if (lip) {
    // a flat lip ring at the front, and the dish's wall from it back to the face
    m.add(annulus('x', R - lip, R + fl, front - 0.006, front + 0.009, seg), s.lipMaterial ?? 'rim_finish');
    m.add(annulus('x', R - lip - 0.008, R - lip + 0.002, faceX, front - 0.004, seg), 'rim_finish');
  }
  // a spoke from (angle a at the hub) to (angle b at the rim), width w0 → w1, through `steps` rings
  const spoke = (a, b, w0 = s.spokeWidth ?? 0.04, w1 = w0 * (s.taper ?? 0.7), r0 = rIn - 0.004, r1 = rOut, steps = 3, th = t) => {
    const rings = [];
    for (let i = 0; i <= steps; i++) {
      const f = i / steps, r = r0 + (r1 - r0) * f, ang = a + (b - a) * f, w = w0 + (w1 - w0) * f, x = faceX + concave * (1 - f) ** 1.5;
      const c = Math.cos(ang), sn = Math.sin(ang), rad = [0, c, sn], tan = [0, -sn, c];
      rings.push([[-th / 2, -w / 2], [th / 2, -w / 2], [th / 2, w / 2], [-th / 2, w / 2]].map(([dx, dw]) => [x + dx, rad[1] * r + tan[1] * dw, rad[2] * r + tan[2] * dw]));
    }
    return loft(rings);
  };
  const n = s.spokes ?? 5, step = Math.PI * 2 / n, tw = s.twist ?? 0;
  const face = [];
  switch (s.spoke ?? 'straight') {
    case 'straight': for (let i = 0; i < n; i++) face.push(...spoke(i * step, i * step + tw, undefined, undefined, undefined, undefined, tw ? 4 : 2)); break;
    case 'twisted': for (let i = 0; i < n; i++) face.push(...spoke(i * step, i * step + (tw || 0.45), undefined, undefined, undefined, undefined, 4)); break;
    case 'paired': {
      const gap = s.pairGap ?? 0.13;
      for (let i = 0; i < n / 2; i++) for (const d of [-gap / 2, gap / 2]) face.push(...spoke(i * step * 2 + d * 0.3, i * step * 2 + d, (s.spokeWidth ?? 0.022), (s.spokeWidth ?? 0.022) * 0.85));
      break;
    }
    case 'split': {
      // one arm from the hub, then two out to the rim
      const mid = rIn + (rOut - rIn) * (s.splitAt ?? 0.45), gap = s.splitGap ?? 0.16, w = s.spokeWidth ?? 0.04;
      for (let i = 0; i < n; i++) {
        const a = i * step;
        face.push(...spoke(a, a + tw * 0.4, w, w * 0.8, rIn - 0.004, mid + 0.01, 2));
        for (const d of [-gap, gap]) face.push(...spoke(a + tw * 0.4 + d * 0.15, a + tw + d, w * 0.5, w * 0.4, mid - 0.005, rOut, 2, t * 0.85));
      }
      break;
    }
    case 'mesh': {
      // crossing thin spokes: each pair leans either way, meeting the next pair's
      const lean = s.lean ?? step * 0.9, w = s.spokeWidth ?? 0.016;
      for (let i = 0; i < n; i++) for (const d of [-1, 1]) face.push(...spoke(i * step, i * step + d * lean, w, w * 0.9, rIn - 0.004, rOut, 3, t * 0.8));
      // and a ring where they cross
      face.push(...annulus('x', rIn + (rOut - rIn) * 0.48, rIn + (rOut - rIn) * 0.48 + 0.008, faceX - t * 0.35, faceX + t * 0.35, n * 2));
      break;
    }
    case 'slot': case 'holes': {
      // a solid face (a disc, slightly cone-shaped), with slots or round holes in it (dark, set in)
      face.push(...lathe([[rIn - 0.004, faceX + concave + t / 2], [rOut, faceX + t / 2], [rOut, faceX - t / 2], [rIn - 0.004, faceX + concave - t / 2], [rIn - 0.004, faceX + concave + t / 2]], Math.max(seg, (s.holes ?? n) * 2), 'x'));
      const k = s.holes ?? n, rr = rIn + (rOut - rIn) * 0.55, len = (rOut - rIn) * (s.spoke === 'slot' ? 0.62 : 0.3), wid = s.spoke === 'slot' ? (s.slotWidth ?? 0.032) : len;
      const hx = faceX + concave * 0.45 + t / 2 + 0.0015;
      for (let i = 0; i < k; i++) {
        const a = i * Math.PI * 2 / k + (s.phase ?? 0);
        const hole = s.spoke === 'slot'
          ? loft([[[-0.004, -wid / 2], [0.004, -wid / 2], [0.004, wid / 2], [-0.004, wid / 2]], [[-0.004, -wid / 2], [0.004, -wid / 2], [0.004, wid / 2], [-0.004, wid / 2]]].map((ring, j) => ring.map(([dx, dw]) => { const r = rr + (j ? len / 2 : -len / 2), ang = a + (j ? tw : 0); return [hx + dx, Math.cos(ang) * r - Math.sin(ang) * dw, Math.sin(ang) * r + Math.cos(ang) * dw]; })))
          : moved(cylinder('x', wid / 2, -0.004, 0.004, 10), [hx, Math.cos(a) * rr, Math.sin(a) * rr]);
        m.add(hole, 'black');
      }
      break;
    }
  }
  m.add(face, 'rim_finish');

  // the hub: a boss behind the spokes, the nuts and the centre cap
  const hubFront = faceX + concave + t / 2;
  m.add(lathe([[0, hubFront - 0.045], [rIn, hubFront - 0.045], [rIn, hubFront - 0.004], [rIn - 0.012, hubFront + 0.003], [0, hubFront + 0.003]], 16, 'x'), 'rim_finish');
  const nuts = s.nuts ?? 5;
  m.add(around(moved(cylinder('x', 0.0095, hubFront - 0.002, hubFront + 0.014, 6), [0, 0.05, 0]), nuts, 'x', Math.PI / nuts), 'raw_metal');
  if ((s.cap ?? 'flat') !== 'none') {
    const capR = s.capRadius ?? 0.032;
    m.add(s.cap === 'dome'
      ? lathe([[0, hubFront], [capR, hubFront], [capR * 0.92, hubFront + 0.012], [capR * 0.55, hubFront + 0.02], [0, hubFront + 0.022]], 12, 'x')
      : cylinder('x', capR, hubFront, hubFront + 0.012, 12), s.capMaterial ?? 'black');
  }
  // a beadlock: a ring bolted over the outer flange
  if (s.beadlock) {
    m.add(annulus('x', R - 0.03, R + fl + 0.004, front + 0.009, front + 0.021, seg), s.ringMaterial ?? 'rim_finish');
    const bolts = s.bolts ?? 24;
    m.add(around(moved(cylinder('x', 0.0055, front + 0.021, front + 0.029, 6), [0, R - 0.008, 0]), bolts, 'x'), 'raw_metal');
  }
  // a stepped lip (the deep dish look) or rivets round it
  if (s.rivets) m.add(around(moved(cylinder('x', 0.003, front + 0.008, front + 0.012, 4), [0, R + 0.004, 0]), s.rivets, 'x'), 'chrome');
  return m;
}

// The four from the prompts document (their sizes and finishes are variants: data/variants/rim_*.json)
const PROMPTS = {
  rim_multispoke: { design: 'multi-spoke', settings: { diameter: 17, width: 7.5, spokes: 10, spoke: 'paired', spokeWidth: 0.018, pairGap: 0.3, concave: 0.016, dish: 0.014, cap: 'flat', colour: '#c9ccd1' } },
  rim_rally: { design: 'rally gravel', settings: { diameter: 15, width: 7, spokes: 6, spoke: 'holes', holes: 6, phase: Math.PI / 6, concave: 0.008, dish: 0.01, thickness: 0.016, cap: 'flat', capMaterial: 'dark', nuts: 4, colour: '#f2f2f2', metalness: 0.1, roughness: 0.45 } },
  rim_beadlock: { design: 'off-road beadlock', settings: { diameter: 17, width: 8.5, spokes: 8, spoke: 'straight', spokeWidth: 0.034, taper: 0.9, thickness: 0.026, concave: 0.004, dish: 0.03, beadlock: true, bolts: 24, cap: 'flat', nuts: 6, colour: '#232528', metalness: 0.3, roughness: 0.5 } },
  rim_deepdish: { design: 'deep dish', settings: { diameter: 17, width: 9, spokes: 5, spoke: 'straight', spokeWidth: 0.046, taper: 0.75, concave: 0.004, dish: 0.08, lip: 0.08, lipMaterial: 'chrome', rivets: 30, cap: 'dome', capMaterial: 'chrome', colour: '#d8dbe0', metalness: 0.9, roughness: 0.18 } },
};

// The variety pack: 20 more designs, new parts (price to do). [id, name, tier, settings]
const PACK = [
  ['rim_crossmesh_15', '15" cross-mesh wheel, silver', 'street', { diameter: 15, width: 7, spokes: 10, spoke: 'mesh', lean: 0.45, dish: 0.02, lip: 0.025, lipMaterial: 'chrome', cap: 'dome', nuts: 4, colour: '#cfd2d6' }],
  ['rim_steelie_15', '15" steel wheel, black', 'street', { diameter: 15, width: 6.5, spokes: 8, spoke: 'holes', holes: 8, concave: 0.006, dish: 0.03, thickness: 0.012, cap: 'dome', capMaterial: 'chrome', nuts: 4, colour: '#1e2023', metalness: 0.2, roughness: 0.55 }],
  ['rim_slotdish_15', '15" slotted dish wheel, gold', 'street', { diameter: 15, width: 7.5, spokes: 8, spoke: 'slot', holes: 8, slotWidth: 0.026, dish: 0.035, lip: 0.035, lipMaterial: 'chrome', concave: 0.004, nuts: 4, colour: '#c9a13b', metalness: 0.85, roughness: 0.3 }],
  ['rim_6spoke_16', '16" six-spoke wheel, silver', 'street', { diameter: 16, width: 7, spokes: 6, spoke: 'straight', spokeWidth: 0.04, taper: 0.8, concave: 0.014, cap: 'flat', colour: '#c4c8ce' }],
  ['rim_turbofan_16', '16" turbofan wheel, white', 'sport', { diameter: 16, width: 7, spokes: 14, spoke: 'slot', holes: 14, slotWidth: 0.02, twist: 0.35, concave: 0.01, dish: 0.012, cap: 'flat', capMaterial: 'dark', colour: '#eef0f2', metalness: 0.1, roughness: 0.4 }],
  ['rim_aerodisc_16', '16" aero disc wheel, grey', 'sport', { diameter: 16, width: 7, spokes: 5, spoke: 'slot', holes: 5, slotWidth: 0.018, concave: 0.002, dish: 0.006, cap: 'none', nuts: 5, colour: '#8d9299', metalness: 0.5, roughness: 0.35 }],
  ['rim_3spoke_17', '17" three-spoke wheel, black', 'sport', { diameter: 17, width: 8, spokes: 3, spoke: 'straight', spokeWidth: 0.07, taper: 0.55, concave: 0.02, cap: 'dome', colour: '#222428', metalness: 0.4, roughness: 0.35 }],
  ['rim_split5_17', '17" split five-spoke wheel, gunmetal', 'street', { diameter: 17, width: 8, spokes: 5, spoke: 'split', spokeWidth: 0.044, splitGap: 0.18, concave: 0.016, cap: 'flat', colour: '#4a4f55' }],
  ['rim_offroad8_17', '17" off-road eight-spoke wheel, bronze', 'street', { diameter: 17, width: 8.5, spokes: 8, spoke: 'straight', spokeWidth: 0.03, taper: 1, thickness: 0.028, dish: 0.035, concave: 0.003, rivets: 24, nuts: 6, cap: 'flat', colour: '#a57c45', metalness: 0.6, roughness: 0.4 }],
  ['rim_meshdish_17', '17" mesh dish wheel, silver and gold', 'race', { diameter: 17, width: 9, spokes: 12, spoke: 'mesh', lean: 0.3, dish: 0.05, lip: 0.05, lipMaterial: 'chrome', rivets: 24, cap: 'flat', capMaterial: 'chrome', colour: '#c9a13b', metalness: 0.85, roughness: 0.3 }],
  ['rim_twist5_18', '18" twisted five-spoke wheel, silver', 'sport', { diameter: 18, width: 8.5, spokes: 5, spoke: 'twisted', twist: 0.55, spokeWidth: 0.042, concave: 0.02, cap: 'dome', colour: '#c4c8ce' }],
  ['rim_yspoke_18', '18" Y-spoke wheel, black', 'sport', { diameter: 18, width: 8.5, spokes: 5, spoke: 'split', spokeWidth: 0.05, splitAt: 0.55, splitGap: 0.22, concave: 0.022, cap: 'flat', colour: '#1f2124', metalness: 0.4, roughness: 0.3 }],
  ['rim_offroad6_18', '18" off-road six-spoke wheel, matte black', 'sport', { diameter: 18, width: 9, spokes: 6, spoke: 'straight', spokeWidth: 0.05, taper: 0.95, thickness: 0.03, dish: 0.04, concave: 0.002, nuts: 6, cap: 'flat', capMaterial: 'raw_metal', colour: '#1b1c1e', metalness: 0.05, roughness: 0.8 }],
  ['rim_driftdish_18', '18" drift dish wheel, bronze', 'sport', { diameter: 18, width: 9.5, spokes: 6, spoke: 'twisted', twist: 0.3, spokeWidth: 0.036, dish: 0.06, lip: 0.06, lipMaterial: 'chrome', concave: 0.004, cap: 'flat', colour: '#8a6a3e', metalness: 0.8, roughness: 0.32 }],
  ['rim_10spoke_19', '19" ten-spoke wheel, silver', 'sport', { diameter: 19, width: 8.5, spokes: 10, spoke: 'straight', spokeWidth: 0.024, taper: 0.8, concave: 0.025, cap: 'flat', colour: '#d0d3d8' }],
  ['rim_star7_19', '19" seven-star wheel, gunmetal', 'race', { diameter: 19, width: 9, spokes: 7, spoke: 'twisted', twist: -0.4, spokeWidth: 0.034, taper: 0.6, concave: 0.03, cap: 'dome', capMaterial: 'chrome', colour: '#3e4349', metalness: 0.8, roughness: 0.28 }],
  ['rim_slot10_19', '19" ten-slot wheel, gunmetal', 'street', { diameter: 19, width: 8.5, spokes: 10, spoke: 'slot', holes: 10, slotWidth: 0.026, concave: 0.012, cap: 'flat', colour: '#5d636b', metalness: 0.6, roughness: 0.35 }],
  ['rim_monoblock_20', '20" monoblock five-spoke wheel, silver', 'race', { diameter: 20, width: 9.5, spokes: 5, spoke: 'straight', spokeWidth: 0.06, taper: 0.5, thickness: 0.03, concave: 0.035, cap: 'flat', capMaterial: 'chrome', colour: '#d6d9de', metalness: 0.85, roughness: 0.22 }],
  ['rim_split6_20', '20" split six-spoke wheel, black and chrome', 'race', { diameter: 20, width: 10, spokes: 6, spoke: 'split', spokeWidth: 0.05, splitGap: 0.2, dish: 0.03, lip: 0.03, lipMaterial: 'chrome', concave: 0.028, cap: 'dome', capMaterial: 'chrome', colour: '#17181a', metalness: 0.5, roughness: 0.25 }],
  ['rim_mesh20_20', '20" fine-mesh wheel, silver', 'race', { diameter: 20, width: 9.5, spokes: 16, spoke: 'mesh', lean: 0.24, spokeWidth: 0.013, concave: 0.02, cap: 'flat', capMaterial: 'chrome', colour: '#c8ccd2' }],
];

export async function parts() {
  const jobs = [];
  for (const [id, { design, settings }] of Object.entries(PROMPTS)) jobs.push({ id, type: 'rim', design, settings, build: () => rim(id, settings) });
  for (const [id, name, tier, settings] of PACK) {
    const d = settings.diameter;
    jobs.push({
      id, type: 'rim', design: name.replace(/^\d+" /, ''), settings, build: () => rim(id, settings),
      defaults: {
        name, tier, purpose: 'looks', price: suggestPrice('wheels', tier), toughness: settings.spoke === 'mesh' ? 0.9 : 1,
        fits: ['wheel_hub:std', `rim_fits:${d}`], provides: [`rim:${d}`], rim: { diameter: d, width: settings.width, offset: 35 }, todo: ['price'],
        _note: `A ${name.replace(/^\d+" /, '').replace(/ wheel.*/, '')} rim from the generator's variety pack (tools/generators/rims.js): ${settings.spokes} ${settings.spoke} spokes.`,
      },
    });
  }
  return jobs;
}
