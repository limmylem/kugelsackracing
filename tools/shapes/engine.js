// A crate engine's model from its settings (garage/engines.js; npm run content -- build): an original, generic
// engine — oil pan, block, heads and cam covers for its layout (inline, V, flat or rotary), the intake plenum and
// throttle body, the exhaust manifolds, the pulleys and belt at the front, and a turbo for a turbo engine. Sized to
// the engine's own size (length along the crank, width, height). The origin is the middle of its base (the engine
// mounts); the crank runs along z (a longitudinal mount) or x (transverse), the front of the engine forwards (+z)
// or to the car's right (−x).
//
//   engineModel(id, { layout, cylinders, size: [L, W, H], aspiration, mount, colour }) → PartModel

import { bevelBox, box, cylinder, moved, rotated, tube } from '../generators/lib/geometry.js';
import { PartModel } from '../generators/lib/part.js';

// (built with the crank along z, then turned for a transverse engine)
export function engineModel(id, s) {
  const m = new PartModel(id), [L, W, H] = s.size, cover = s.colour ?? 'red', n = s.cylinders;
  const parts = [];
  const add = (tris, mat) => parts.push([tris, mat]);
  const zf = L / 2, zb = -L / 2;
  // the oil pan and the block (narrower at the bottom)
  const panH = H * 0.16, blockTop = H * (s.layout === 'flat' ? 0.62 : s.layout === 'rotary' ? 0.7 : 0.52);
  const blockW = s.layout === 'v' ? W * 0.5 : s.layout === 'flat' ? W * 0.42 : s.layout === 'rotary' ? W * 0.7 : W * 0.46;
  add(bevelBox([-blockW * 0.42, 0, zb + L * 0.1], [blockW * 0.42, panH, zf - L * 0.12], 0.01), 'dark');
  add(bevelBox([-blockW / 2, panH, zb + L * 0.04], [blockW / 2, blockTop, zf - L * 0.08], 0.012), 'grey');
  // heads and cam covers, by layout
  const cylL = (L * 0.84) / Math.max(1, s.layout === 'v' || s.layout === 'flat' ? n / 2 : n);
  if (s.layout === 'inline') {
    add(bevelBox([-W * 0.22, blockTop, zb + L * 0.06], [W * 0.22, blockTop + H * 0.14, zf - L * 0.1], 0.01), 'grey');
    add(bevelBox([-W * 0.2, blockTop + H * 0.14, zb + L * 0.08], [W * 0.2, H * 0.86, zf - L * 0.12], 0.025), cover);
    for (let i = 0; i < n; i++) add(cylinder('y', 0.012, H * 0.86, H * 0.89, 6, { at: [0, 0, zb + L * 0.12 + cylL * (i + 0.5)] }), 'black');   // (coil packs)
  } else if (s.layout === 'v') {
    for (const side of [-1, 1]) {
      const head = bevelBox([-W * 0.13, 0, zb + L * 0.06], [W * 0.13, H * 0.2, zf - L * 0.1], 0.012);
      const coverTris = bevelBox([-W * 0.12, H * 0.2, zb + L * 0.08], [W * 0.12, H * 0.3, zf - L * 0.12], 0.02);
      const place = t => moved(rotated(t, 'z', side * -0.62), [side * W * 0.24, blockTop - H * 0.08, 0]);
      add(place(head), 'grey');
      add(place(coverTris), cover);
    }
    // the valley's intake: a plenum with runners down to each bank
    add(bevelBox([-W * 0.14, H * 0.62, zb + L * 0.12], [W * 0.14, H * 0.84, zf - L * 0.16], 0.03), 'silver');
  } else if (s.layout === 'flat') {
    for (const side of [-1, 1]) {
      add(bevelBox([side > 0 ? blockW / 2 : -W * 0.4, panH + H * 0.08, zb + L * 0.06], [side > 0 ? W * 0.4 : -blockW / 2, blockTop - H * 0.04, zf - L * 0.1], 0.012), 'grey');
      add(bevelBox([side > 0 ? W * 0.4 : -W / 2, panH + H * 0.1, zb + L * 0.08], [side > 0 ? W / 2 : -W * 0.4, blockTop - H * 0.06, zf - L * 0.12], 0.02), cover);
    }
    add(bevelBox([-blockW * 0.4, blockTop, zb + L * 0.14], [blockW * 0.4, H * 0.94, zf - L * 0.2], 0.03), 'silver');    // (the intake on top)
  } else {
    // a rotary: the rotor housings stacked along the shaft, the intake manifold over them
    for (let i = 0; i < n; i++) add(moved(cylinder('z', Math.min(W, H) * 0.34, -cylL * 0.42, cylL * 0.42, 14), [0, H * 0.45, zb + L * 0.12 + cylL * (i + 0.5)]), cover);
    add(bevelBox([-W * 0.3, H * 0.72, zb + L * 0.1], [W * 0.15, H * 0.92, zf - L * 0.15], 0.03), 'silver');
  }
  // the throttle body at the front of the intake (the plenum's own, for an inline: along its side)
  if (s.layout === 'inline') {
    add(bevelBox([W * 0.22, H * 0.46, zb + L * 0.1], [W * 0.38, H * 0.7, zf - L * 0.14], 0.02), 'silver');
    add(cylinder('z', 0.04, zf - L * 0.14, zf - L * 0.02, 12, { at: [W * 0.3, H * 0.58, 0] }), 'raw_metal');
  } else add(cylinder('z', 0.045, zf - L * 0.16, zf - L * 0.02, 12, { at: [0, H * (s.layout === 'v' ? 0.73 : 0.84), 0] }), 'raw_metal');
  // exhaust manifolds: a pipe from each cylinder (each bank's outside), into a collector at the back
  const sides = s.layout === 'inline' ? [-1] : s.layout === 'rotary' ? [-1] : [-1, 1];
  for (const side of sides) {
    const per = s.layout === 'inline' || s.layout === 'rotary' ? n : n / 2;
    const xOut = side * W * (s.layout === 'flat' ? 0.3 : 0.48), y = s.layout === 'flat' ? panH : H * 0.5;
    const collector = [side * W * 0.42, y - H * 0.25, zb + L * 0.02];
    for (let i = 0; i < per; i++) {
      const z = zb + L * 0.12 + cylL * (i + 0.5);
      add(tube([[side * W * (s.layout === 'flat' ? 0.3 : 0.32), y, z], [xOut, y - H * 0.06, z], collector], 0.018, { sides: 6, bend: 0.03 }), 'raw_metal');
    }
  }
  // the front: crank pulley, alternator, water pump pulleys and the belt round them
  const front = zf - L * 0.07;
  add(cylinder('z', H * 0.11, front, front + 0.04, 14, { at: [0, H * 0.22, 0] }), 'black');
  add(cylinder('z', H * 0.06, front, front + 0.035, 12, { at: [0, H * 0.48, 0] }), 'black');
  add(cylinder('z', H * 0.07, front - 0.02, front + 0.03, 12, { at: [W * 0.24, H * 0.4, 0] }), 'silver');
  add(bevelBox([W * 0.18, H * 0.3, front - 0.12], [W * 0.31, H * 0.5, front - 0.02], 0.015), 'silver');       // (the alternator)
  add(tube([[0, H * 0.11, front + 0.02], [W * 0.3, H * 0.36, front + 0.02], [0, H * 0.55, front + 0.02], [0, H * 0.11, front + 0.02]], 0.008, { sides: 4 }), 'rubber');
  // a turbo engine's turbo on its manifold's collector
  if (s.aspiration === 'turbo') {
    const c = [-W * 0.44, H * 0.4, zb + L * 0.22];
    add(moved(cylinder('z', 0.07, -0.05, 0.05, 14), c), 'grey');
    add(moved(cylinder('z', 0.065, 0.05, 0.12, 14), c), 'silver');
    add(tube([[c[0], c[1] + 0.07, c[2] + 0.08], [c[0] * 0.6, H * 0.9, c[2] + 0.1], [0, H * 0.9, zf - L * 0.2]], 0.028, { sides: 8, bend: 0.05 }), 'raw_metal');
  }
  if (s.aspiration === 'supercharged') {
    add(bevelBox([-W * 0.16, H * 0.86, zb + L * 0.2], [W * 0.16, H, zf - L * 0.15], 0.03), 'silver');
    add(cylinder('z', 0.05, zf - L * 0.15, zf - L * 0.05, 12, { at: [0, H * 0.93, 0] }), 'black');
  }
  // (a transverse engine: turned so its front faces the car's right, −x)
  const turn = s.mount === 'trans' ? t => rotated(t, 'y', -Math.PI / 2) : t => t;
  for (const [tris, mat] of parts) m.add(turn(tris), mat);
  return m;
}
