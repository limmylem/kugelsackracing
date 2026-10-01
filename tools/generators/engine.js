// Engine parts: turbos (small, medium, large, and the cars' own kits), superchargers (centrifugal and
// twin-screw), front-mount intercoolers, intakes (a cone filter, a cold air intake, a carbon airbox with
// velocity stacks) and radiators. Each from a settings object; origins where they attach:
//  - a turbo: its manifold flange (the engine is towards +x from the turbo socket, on the car's right)
//  - a supercharger: the middle of its base, on top of the engine (or its bracket, at the front)
//  - an intercooler / radiator: its middle, behind the front bumper (the pipes run back, −z)
//  - an intake: where it joins the engine

import { annulus, around, bevelBox, box, cylinder, lathe, moved, prism, rotated, roundedRect, tube } from './lib/geometry.js';
import { PartModel } from './lib/part.js';
import { ATTACH, firstFit, grid, surroundings } from './lib/fitcheck.js';

// ---------- turbos ----------
// settings: { size (the compressor's radius, m), hot ('grey' | 'dark': the cast turbine housing),
//   inlet: 'filter' | 'pipe', downpipe (m), manifold: 'flange' | 'cast' | 'equal' (equal-length tubes
//   from both banks of a flat engine), up (the outlet pipe's rise, m) }
export function turbo(id, s) {
  const m = new PartModel(id), R = s.size, Rt = R * 0.85, cx = -0.06 - R * 0.6, cy = 0.04 + R;      // (its axis runs along z)
  const at = (x, y, z) => [cx + x, cy + y, z];
  // the manifold flange at the origin, and the turbine's inlet from it
  m.add(bevelBox([-0.012, cy - 0.05, -0.06], [0.006, cy + 0.03, 0.0], 0.004), 'raw_metal');
  m.add(bevelBox([cx + Rt * 0.4, cy - 0.04, -0.075], [-0.01, cy + 0.025, -0.015], 0.008), s.hot ?? 'grey');
  // turbine housing (the hot side, behind) and its scroll; the centre section; the compressor (in front)
  m.add(moved(lathe([[0, -0.11], [Rt * 0.6, -0.11], [Rt, -0.085], [Rt, -0.04], [Rt * 0.55, -0.03], [0, -0.03]], 18, 'z'), [cx, cy, 0]), s.hot ?? 'grey');
  m.add(cylinder('z', 0.032, -0.035, 0.03, 10, { at: [cx, cy, 0] }), 'dark');
  m.add(moved(lathe([[0, 0.025], [R * 0.6, 0.025], [R, 0.04], [R, 0.085], [R * 0.62, 0.1], [0, 0.1]], 20, 'z'), [cx, cy, 0]), 'silver');
  m.add(around(moved(cylinder('z', 0.006, 0.084, 0.092, 6), [0, R * 0.8, 0]), 6, 'z').map(t => t.map(p => [p[0] + cx, p[1] + cy, p[2]])), 'raw_metal');
  // the compressor inlet: a cone filter or a pipe forward
  const inletZ = 0.1, inR = R * 0.55;
  m.add(moved(lathe([[0, inletZ - 0.005], [inR, inletZ - 0.005], [inR * 1.08, inletZ + 0.03], [0, inletZ + 0.03]], 14, 'z'), [cx, cy, 0]), 'raw_metal');
  if ((s.inlet ?? 'filter') === 'filter') {
    m.add(moved(lathe([[0, inletZ + 0.03], [inR * 1.15, inletZ + 0.03], [inR * 1.4, inletZ + 0.12], [0, inletZ + 0.12]], 14, 'z'), [cx, cy, 0]), s.filter ?? 'red');
    m.add(moved(cylinder('z', inR * 1.42, inletZ + 0.12, inletZ + 0.13, 14), [cx, cy, 0]), 'silver');
  } else m.add(tube([at(0, 0, inletZ + 0.02), at(0, 0, inletZ + 0.08), at(0.06, 0.05, inletZ + 0.13)], inR * 0.95, { sides: 10, bend: 0.05 }), 'silver');
  // the outlet: up off the top of the compressor, then forward (to the intercooler)
  const up = s.up ?? 0.12;
  m.add(tube([at(R * 0.7, R * 0.5, 0.06), at(R * 0.7, R + up * 0.6, 0.06), at(R * 0.7, R + up, 0.14)], 0.026, { sides: 8, bend: 0.05 }), 'raw_metal');
  // the downpipe: out of the turbine's back, down and back under the car
  const dp = s.downpipe ?? 0.22;
  m.add(tube([at(0, 0, -0.105), at(0, 0, -0.15), at(0, -dp * 0.6, -0.18), at(0, -dp, -0.2)], 0.032, { sides: 8, bend: 0.05 }), 'raw_metal');
  // the manifold: equal-length tubes from both banks (a flat engine's), or a cast log
  if (s.manifold === 'equal') {
    for (const [x0, z0] of [[0.14, 0.1], [0.14, -0.1], [0.3, 0.1], [0.3, -0.1]]) m.add(tube([[x0, -0.06, z0], [x0 * 0.6, -0.08, z0 * 0.6], [0.02, cy - 0.02, -0.04]], 0.019, { sides: 6, bend: 0.06 }), 'raw_metal');
  } else if (s.manifold === 'cast') m.add(bevelBox([0.004, cy - 0.07, -0.16], [0.06, cy + 0.01, 0.12], 0.012), 'grey');
  return m;
}

// ---------- superchargers ----------
// centrifugal: a snail-shell compressor on a bracket, belt-driven from the front, its pipe over the
// engine to the intake. settings: { size (its radius), polish ('chrome' | 'silver'), pipe (m, how far over),
//   route ('over' the engine | 'front': across in front of it), inlet ('back' | 'side') }
export function centrifugal(id, s) {
  const m = new PartModel(id), R = s.size, cy = R + 0.03;
  m.add(bevelBox([-R * 0.9, 0, -0.07], [R * 0.9, 0.03, 0.05], 0.008), 'dark');                         // the bracket
  m.add(bevelBox([-0.025, 0.02, -0.05], [0.025, cy, 0.0], 0.006), 'dark');
  m.add(moved(lathe([[0, -0.07], [R * 0.7, -0.07], [R, -0.05], [R, 0.01], [R * 0.6, 0.03], [0, 0.03]], 22, 'z'), [0, cy, 0]), s.polish ?? 'chrome');
  // its volute, curling round to the outlet
  m.add(tube([[R * 0.95, cy - R * 0.3, -0.02], [R * 1.05, cy + R * 0.4, -0.02], [R * 0.6, cy + R * 1.05, -0.02], [-R * 0.1, cy + R * 1.15, -0.02]], 0.03, { sides: 8, bend: 0.06 }), s.polish ?? 'chrome');
  // the pulley and belt in front, the inlet behind
  m.add(cylinder('z', 0.045, 0.03, 0.06, 14, { at: [0, cy, 0] }), 'black');
  m.add(annulus('z', 0.045, 0.05, 0.035, 0.055, 14, [0, cy, 0]), 'rubber');
  if ((s.inlet ?? 'back') === 'back') {
    m.add(moved(lathe([[0, -0.07], [0.055, -0.07], [0.065, -0.13], [0, -0.13]], 12, 'z'), [0, cy, 0]), s.polish ?? 'chrome');
    m.add(moved(lathe([[0, -0.13], [0.07, -0.13], [0.09, -0.24], [0, -0.24]], 12, 'z'), [0, cy, 0]), s.filter ?? 'blue');
  } else {
    // (its inlet turned to the side: a short elbow and the filter beside it — more compact)
    m.add(tube([[0, cy, -0.06], [0, cy, -0.1], [-0.08, cy, -0.1]], 0.05, { sides: 10, bend: 0.04 }), s.polish ?? 'chrome');
    m.add(moved(lathe([[0, 0], [0.07, 0], [0.085, 0.1], [0, 0.1]], 12, 'x').map(t => t.map(p => [-p[0], p[1], p[2]])).map(([a, b, c]) => [a, c, b]), [-0.08, cy, -0.1]), s.filter ?? 'blue');
  }
  // the pipe from the outlet to the intake side (+x): over the engine, or across in front of it (a low bay)
  const over = s.pipe ?? 0.3;
  if ((s.route ?? 'over') === 'over') m.add(tube([[-R * 0.1, cy + R * 1.15, -0.02], [-R * 0.3, cy + R * 1.3, 0.02], [-R * 0.3 + over * 0.3, cy + R * 1.35, 0.04], [over, cy + R * 0.9, 0.04]], 0.03, { sides: 8, bend: 0.07 }), 'raw_metal');
  else m.add(tube([[-R * 0.1, cy + R * 1.15, -0.02], [-R * 0.1, cy + R * 1.15, 0.08], [over, cy + R * 1.0, 0.08], [over, cy + R * 0.6, 0.02]], 0.03, { sides: 8, bend: 0.06 }), 'raw_metal');
  return m;
}
// twin-screw: a long ribbed case on top of the engine, its rotors' snout and pulley at the front, a
// throttle body. settings: { width, length, height, ribs, throttle (radius), colour ('silver' | 'black') }
export function twinScrew(id, s) {
  const m = new PartModel(id), W = s.width, L = s.length, H = s.height, c = s.colour ?? 'silver';
  m.add(bevelBox([-W / 2, 0, -L / 2], [W / 2, 0.035, L / 2], 0.01), 'dark');                           // the manifold under it
  m.add(prism(roundedRect(W * 0.86, H - 0.035, 0.05, 2, [0, (H - 0.035) / 2 + 0.035]), -L / 2 + 0.03, L / 2 - 0.06, 'z'), c);
  for (let i = 0; i < (s.ribs ?? 6); i++) {
    const x = -W * 0.36 + i * W * 0.72 / ((s.ribs ?? 6) - 1);
    m.add(bevelBox([x - 0.007, H - 0.01, -L / 2 + 0.06], [x + 0.007, H + 0.012, L / 2 - 0.1], 0.003), c);
  }
  // the snout and its pulley, at the front
  m.add(cylinder('z', 0.06, L / 2 - 0.07, L / 2 + 0.01, 12, { at: [0, H * 0.62, 0] }), c);
  m.add(cylinder('z', 0.075, L / 2 + 0.01, L / 2 + 0.045, 16, { at: [0, H * 0.62, 0] }), 'black');
  m.add(annulus('z', 0.075, 0.081, L / 2 + 0.015, L / 2 + 0.04, 16, [0, H * 0.62, 0]), 'rubber');
  // the throttle body (forward, up top: into the bonnet scoop on a muscle car)
  const T = s.throttle ?? 0.05;
  m.add(cylinder('z', T, L / 2 - 0.12, L / 2 - 0.04, 12, { at: [0, H + T * 0.6, 0] }), 'raw_metal');
  m.add(bevelBox([-T * 1.1, H - 0.01, L / 2 - 0.16], [T * 1.1, H + T * 0.6, L / 2 - 0.1], 0.01), c);
  m.add(annulus('z', T * 0.75, T, L / 2 - 0.045, L / 2 - 0.035, 12, [0, H + T * 0.6, 0]), 'black');
  return m;
}

// ---------- intercoolers and radiators ----------
// A finned core with its tanks: settings { width, height, depth, fins ('tube' | 'bar': bar and plate),
//   tanks ('side' | 'top'), tankMaterial, pipes (true: out of the tanks and back), fan (a shroud and fan
//   behind it), oilCooler (a small core in front, low down) }
export function core(id, s) {
  const m = new PartModel(id), W = s.width, H = s.height, D = s.depth, T = s.tank ?? 0.05;
  const side = (s.tanks ?? 'side') === 'side', coreW = side ? W - 2 * T : W, coreH = side ? H : H - 2 * T;
  m.add(box([-coreW / 2, -coreH / 2, -D / 2], [coreW / 2, coreH / 2, D / 2]), s.coreMaterial ?? 'silver');
  // the fins, seen from the front: rows of dark slots (and columns, bar and plate)
  const rows = s.rows ?? Math.round(coreH / 0.022), fz = D / 2;
  for (let i = 0; i < rows; i++) { const y = -coreH / 2 + (i + 0.5) * coreH / rows; m.add(box([-coreW / 2 + 0.008, y - 0.0035, fz - 0.002], [coreW / 2 - 0.008, y + 0.0035, fz + 0.0012]), 'dark'); }
  if (s.fins === 'bar') { const cols = Math.round(coreW / 0.09); for (let i = 1; i < cols; i++) { const x = -coreW / 2 + i * coreW / cols; m.add(box([x - 0.004, -coreH / 2, fz - 0.001], [x + 0.004, coreH / 2, fz + 0.0025]), 'silver'); } }
  // the tanks
  const tm = s.tankMaterial ?? 'raw_metal';
  if (side) for (const sx of [-1, 1]) m.add(bevelBox(sx > 0 ? [coreW / 2, -H / 2, -D / 2 - 0.004] : [-W / 2, -H / 2, -D / 2 - 0.004], sx > 0 ? [W / 2, H / 2, D / 2 + 0.004] : [-coreW / 2, H / 2, D / 2 + 0.004], 0.012), tm);
  else for (const sy of [-1, 1]) m.add(bevelBox(sy > 0 ? [-W / 2, coreH / 2, -D / 2 - 0.004] : [-W / 2, -H / 2, -D / 2 - 0.004], sy > 0 ? [W / 2, H / 2, D / 2 + 0.004] : [W / 2, -coreH / 2, D / 2 + 0.004], 0.012), tm);
  // the pipes: out of each tank and back towards the engine
  if (s.pipes) for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - T / 2), y = sx * H * 0.18;
    m.add(tube([[x, y, -D / 2], [x, y, -D / 2 - 0.08], [x - sx * 0.04, y + 0.03, -D / 2 - 0.15]], s.pipeR ?? 0.028, { sides: 8, bend: 0.05 }), s.pipeMaterial ?? 'raw_metal');
  }
  if (s.fan) {
    // the shroud behind, and the fan in it
    m.add(bevelBox([-coreW / 2 + 0.01, -coreH / 2 + 0.01, -D / 2 - 0.04], [coreW / 2 - 0.01, coreH / 2 - 0.01, -D / 2], 0.01), 'black');
    for (const fx of s.fan === 2 ? [-coreW / 4, coreW / 4] : [0]) {
      m.add(cylinder('z', Math.min(coreW / (s.fan === 2 ? 4.4 : 2.4), coreH / 2.3), -D / 2 - 0.07, -D / 2 - 0.04, 16, { at: [fx, 0, 0] }), 'dark');
      m.add(cylinder('z', 0.04, -D / 2 - 0.1, -D / 2 - 0.07, 10, { at: [fx, 0, 0] }), 'black');
    }
  }
  if (s.oilCooler) {
    m.add(box([-W * 0.3, -H / 2 - 0.12, D / 2 + 0.01], [W * 0.3, -H / 2 - 0.02, D / 2 + 0.04]), 'silver');
    for (let i = 0; i < 4; i++) { const y = -H / 2 - 0.11 + i * 0.025 + 0.01; m.add(box([-W * 0.29, y - 0.004, D / 2 + 0.038], [W * 0.29, y + 0.004, D / 2 + 0.042]), 'dark'); }
    for (const sx of [-1, 1]) m.add(tube([[sx * W * 0.3, -H / 2 - 0.07, D / 2 + 0.025], [sx * (W * 0.3 + 0.04), -H / 2 - 0.07, D / 2 + 0.025], [sx * (W * 0.3 + 0.04), -H / 2 - 0.07, -D / 2 - 0.06]], 0.009, { sides: 6, bend: 0.03 }), 'black');
  }
  return m;
}

// ---------- intakes ----------
// settings: { kind: 'cone' | 'cold_air' | 'stacks', reach (m: how far the pipe runs), filter (colour),
//   way ('z' forward | 'x' to the side | '-z' back | 'y' up: which way the pipe leaves the engine),
//   stackScale (the velocity stacks' and airbox's height, × the design's) }
export function intake(id, s) {
  const m = new PartModel(id), r = s.pipe ?? 0.035, pieces = [], add = (t, mat) => pieces.push([t, mat]);
  // (a cone filter at the end of a pipe, pointing forward: the whole intake is turned `way` afterwards)
  const coneAt = p => {
    const L = s.coneLength ?? 0.16;
    add(moved(lathe([[0, 0], [r * 1.25, 0], [r * 2, L], [0, L]], 14, 'z'), p), s.filter ?? 'red');
    add(moved(cylinder('z', r * 2.05, L, L + 0.012, 14), p), 'silver');
    add(moved(annulus('z', r, r * 1.3, -0.02, 0.005, 14), p), 'silver');
  };
  if (s.kind === 'stacks') {
    // an open carbon airbox with chrome velocity stacks in it
    const n = s.stacks ?? 4, W = 0.11 * n + 0.04, h = s.stackScale ?? 1;
    m.add(bevelBox([-0.06, 0.0, -W / 2], [0.12, 0.03, W / 2], 0.01), 'carbon');
    for (const sx of [-1, 1]) m.add(bevelBox([-0.06, 0.03, sx > 0 ? W / 2 - 0.012 : -W / 2], [0.12, 0.03 + 0.14 * h, sx > 0 ? W / 2 : -W / 2 + 0.012], 0.004), 'carbon');
    m.add(bevelBox([0.108, 0.03, -W / 2], [0.12, 0.03 + 0.14 * h, W / 2], 0.004), 'carbon');
    for (let i = 0; i < n; i++) {
      const z = -W / 2 + 0.07 + i * 0.11;
      m.add(moved(lathe([[0.024, 0.03], [0.03, 0.03], [0.03, 0.03 + 0.06 * h], [0.042, 0.03 + 0.095 * h], [0.05, 0.03 + 0.105 * h], [0.036, 0.03 + 0.105 * h], [0.026, 0.03 + 0.07 * h], [0.024, 0.03]], 12, 'y'), [0.03, 0, z]), 'chrome');
    }
    return m;
  }
  // where it joins the engine: a flange at the origin
  add(annulus('z', r * 0.6, r * 1.35, -0.012, 0.0, 14), 'raw_metal');
  if (s.kind === 'cone') {
    const k = s.reach ?? 1;
    add(tube([[0, 0, 0], [0, 0, 0.06 * k], [0.04, 0.03, 0.11 * k]], r, { sides: 10, bend: 0.04 }), 'silver');
    coneAt([0.05, 0.035, 0.11 * k + 0.01]);
  } else {
    // a long pipe out and down to a filter in cooler air, a heat shield round it
    const R = s.reach ?? 0.55, end = [0.12, -0.18, R];
    add(tube([[0, 0, 0], [0, 0, 0.08], [0.08, -0.04, R * 0.45], [end[0], end[1], R - 0.04]], r, { sides: 10, bend: 0.08 }), s.pipeMaterial ?? 'silver');
    coneAt([end[0], end[1], R - 0.045]);
    add(bevelBox([end[0] - 0.12, end[1] - 0.1, R - 0.08], [end[0] - 0.105, end[1] + 0.1, R + 0.16], 0.004), 'dark');
    add(bevelBox([end[0] - 0.12, end[1] + 0.1, R - 0.08], [end[0] + 0.1, end[1] + 0.115, R + 0.16], 0.004), 'dark');
  }
  const way = s.way ?? 'z', turn = t => way === 'x' ? rotated(t, 'y', Math.PI / 2) : way === '-z' ? rotated(t, 'y', Math.PI) : way === 'y' ? rotated(t, 'x', -Math.PI / 2) : t;
  for (const [t, mat] of pieces) m.add(turn(t), mat);
  return m;
}

// ---------- the parts ----------
const PARTS = [
  // turbos
  ['turbo_kit', 'turbo', 'small turbo', () => turbo, { size: 0.07, inlet: 'filter', manifold: 'cast', downpipe: 0.2 }],
  ['turbo_medium', 'turbo', 'medium turbo', () => turbo, { size: 0.09, inlet: 'filter', manifold: 'cast', downpipe: 0.22, filter: 'blue' }],
  ['turbo_large', 'turbo', 'large turbo', () => turbo, { size: 0.12, hot: 'dark', inlet: 'pipe', manifold: 'flange', downpipe: 0.18, up: 0.08 }],
  ['kaze_gt_turbo_kit', 'turbo', 'twin-scroll, equal-length manifold', () => turbo, { size: 0.1, inlet: 'pipe', manifold: 'equal', downpipe: 0.18, up: 0.1 }],
  ['hana_roadster_turbo_kit', 'turbo', 'small turbo on a cast manifold', () => turbo, { size: 0.08, inlet: 'filter', manifold: 'cast', downpipe: 0.22, filter: 'black' }],
  ['vortex_r_big_turbo', 'turbo', 'big turbo, big compressor inlet', () => turbo, { size: 0.105, hot: 'dark', inlet: 'pipe', manifold: 'cast', downpipe: 0.2, up: 0.1 }],
  // superchargers
  ['supercharger_centrifugal', 'supercharger', 'centrifugal', () => centrifugal, { size: 0.115, polish: 'chrome', pipe: 0.28 }],
  ['kaze_gt_supercharger', 'supercharger', 'centrifugal, at the front of the flat-four', () => centrifugal, { size: 0.1, polish: 'silver', pipe: 0.32, filter: 'red' }],
  ['supercharger_twin_screw', 'supercharger', 'twin-screw', () => twinScrew, { width: 0.38, length: 0.5, height: 0.17, ribs: 6, throttle: 0.045, colour: 'silver' }],
  ['brute_500_supercharger', 'supercharger', 'twin-screw blower with a forward throttle body', () => twinScrew, { width: 0.44, length: 0.55, height: 0.19, ribs: 8, throttle: 0.058, colour: 'black' }],
  // intercoolers and radiators
  ['front_mount_intercooler', 'intercooler', 'tube and fin', () => core, { width: 0.6, height: 0.24, depth: 0.06, tanks: 'side', tank: 0.055, pipes: true, pipeMaterial: 'raw_metal' }],
  ['intercooler_race', 'intercooler', 'bar and plate', () => core, { width: 0.68, height: 0.28, depth: 0.08, tanks: 'side', tank: 0.06, fins: 'bar', pipes: true, pipeR: 0.032, pipeMaterial: 'blue' }],
  ['radiator_aluminium', 'radiator', 'aluminium, one fan', () => core, { width: 0.64, height: 0.4, depth: 0.06, tanks: 'top', tank: 0.045, tankMaterial: 'silver', fan: 1 }],
  ['radiator_race', 'radiator', 'race, two fans and an oil cooler', () => core, { width: 0.64, height: 0.4, depth: 0.06, tanks: 'side', tank: 0.045, tankMaterial: 'silver', fins: 'bar', fan: 2, oilCooler: true }],
  // intakes
  ['intake_filter_street', 'intake', 'cone filter', () => intake, { kind: 'cone', filter: 'red' }],
  ['cold_air_intake', 'intake', 'cold air intake', () => intake, { kind: 'cold_air', reach: 0.5, filter: 'blue' }],
  ['intake_race', 'intake', 'carbon airbox, velocity stacks', () => intake, { kind: 'stacks', stacks: 4 }],
];
// (fixing up what a part's file says it is, now it has a model)
const NOTES = {
  intake_filter_street: { name: 'Cone air filter', _note: 'A cone filter on a short pipe in place of the stock airbox: a little more at high revs.' },
};

// Each one made to fit each car's engine bay: the design first, then smaller and moved a little (and a
// turbo's outlet turned lower, an intake's filter another way…) until it clears the body, the bonnet,
// the engine block and the other stock parts — the first that fits
const SEARCH = {
  turbo: { k: [1, 0.85, 0.7], up: [null, 0.04], dx: [0, -0.06, -0.12, -0.18, -0.24], dy: [0, -0.06, -0.12, -0.18, -0.24, 0.06], dz: [0, 0.08, -0.08, 0.16, -0.16] },
  supercharger: { route: ['over', 'front'], inlet: ['back', 'side'], k: [1, 0.85, 0.7], dz: [0, 0.08, 0.16, 0.24, 0.3, 0.36, -0.08], dy: [0, -0.06, -0.12, -0.18, -0.24, -0.3, -0.36], dx: [0, -0.1, 0.1, -0.2, 0.2, -0.3, 0.3] },
  intercooler: { kw: [1, 0.9, 0.8, 0.7, 0.6], kh: [1, 0.85, 0.7, 0.55, 0.45], dz: [0, 0.03, -0.03, 0.06, -0.06, 0.1, -0.1], dy: [0, -0.04, 0.04, -0.08, 0.08] },
  radiator: { kw: [1, 0.9, 0.8, 0.7, 0.6], kh: [1, 0.85, 0.7, 0.55, 0.45, 0.36], dz: [0, -0.03, 0.03, -0.06, 0.06, -0.1], dy: [0, -0.04, 0.04, -0.08, 0.08, -0.12] },
  intake: { duct: ['level', 'down'], way: ['z', 'x', '-z'], reach: [1, 0.7, 0.45], dx: [0, 0.08, 0.16, 0.24, 0.3, -0.08], dy: [0, -0.06, -0.12, -0.18, -0.24, -0.3, 0.04], dz: [0, 0.08, -0.08, 0.16] },
};
const WEIGHTS = { k: 2, kw: 1.5, kh: 1.5, up: 1, reach: 1, way: 1.5, inlet: 1, route: 1 };
// a design with the search's settings: scaled (k: the whole thing; kw / kh: a core's width and height), moved
function variant(make, id, s, type, c) {
  const t = { ...s };
  if (c.k != null && t.size) t.size *= c.k;
  if (c.k != null && t.width && type === 'supercharger') { t.width *= c.k; t.length *= c.k; t.height *= c.k; }
  if (c.up != null) t.up = c.up;
  if (c.kw != null) t.width *= c.kw;
  if (c.kh != null) t.height *= c.kh;
  if (c.way) t.way = c.way;
  if (c.inlet && type === 'supercharger' && !t.length) t.inlet = c.inlet;
  if (c.route && type === 'supercharger' && !t.length) t.route = c.route;
  if (c.reach != null && t.kind === 'cold_air') t.reach = (t.reach ?? 0.55) * c.reach;
  if (c.reach != null && t.kind === 'cone') t.reach = c.reach;
  if (c.reach != null && t.kind === 'stacks') t.stackScale = c.reach;
  const d = [c.dx ?? 0, c.dy ?? 0, c.dz ?? 0], m = make(id, t).moved(d);
  // moved away from its socket: joined back to it — a manifold pipe (a turbo), a duct (an intake), a bracket (a supercharger)
  if (Math.hypot(...d) > 0.02) {
    if (type === 'supercharger') {
      // (a strap along the engine's top from under the socket, then down to where it's moved: kept under the socket, clear of the bonnet)
      m.add(bevelBox([Math.min(0, d[0]) - 0.03, -0.07, Math.min(0, d[2]) - 0.03], [Math.max(0, d[0]) + 0.03, -0.025, Math.max(0, d[2]) + 0.03], 0.006), 'dark');
      if (d[1] < -0.07) m.add(bevelBox([d[0] - 0.03, d[1], d[2] - 0.03], [d[0] + 0.03, -0.07, d[2] + 0.03], 0.006), 'dark');
    }
    else if (type === 'turbo') m.add(tube([[0, 0, 0], [d[0] * 0.5, d[1] * 0.1, d[2] * 0.5], d], 0.026, { sides: 8, bend: 0.04 }), 'raw_metal');
    // (an intake's duct: level, or turned down first where it's moved lower — its socket can be just under the bonnet)
    else if (type === 'intake') m.add(tube([[0, 0, 0], c.duct === 'down' ? [d[0] * 0.3, d[1] * 0.7, d[2] * 0.3] : [d[0] * 0.5, d[1] * 0.1, d[2] * 0.5], d], 0.032, { sides: 8, bend: 0.04 }), 'silver');
  }
  return m;
}

export async function parts({ project, carsFor }) {
  const { db, rules } = project;
  return PARTS.map(([id, type, design, make, settings]) => {
    const part = db.parts[id], cars = carsFor(part, db), socket = car => car.def.sockets.find(x => x.slot === part.slot).name;
    return {
      id, type, design, settings, set: NOTES[id], cars, baseCar: 'starter_car',
      build: async car => {
        const around = await surroundings(db, car.id, socket(car));
        const r = firstFit(grid(SEARCH[type], WEIGHTS), c => variant(make(), id, settings, type, c), around, rules.types[type], ['turbo', 'supercharger', 'intake'].includes(type) ? ATTACH : 0);
        r.model.fit = { clashes: r.clashes, settings: r.settings };
        return r.model;
      },
    };
  });
}
