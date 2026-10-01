// Simple artwork for the icons of parts with no model (tyres, brakes, ECUs, turbos…): a small low-poly
// object for each slot, with one element in its tier's colour (stock grey, street green, sport blue,
// race red; a drift part orange), drawn by the icon renderer like any model.
//
//   const doc = await artworkFor(part, { finishes })      → a Document, or null (no artwork for its slot)

import { ModelBuilder, box, extrude, lathe, moved, rotated, scaled, sweep } from './shapes.mjs';

const TIER = { stock: 'grey', street: 'green', sport: 'blue', race: 'red' };
const ring = (r0, r1, w, axis = 'x', seg = 28) => lathe([[r0, -w / 2], [r1, -w / 2], [r1, w / 2], [r0, w / 2], [r0, -w / 2]], seg, axis);
const disc = (r, w, axis = 'x', seg = 28) => lathe([[0, -w / 2], [r, -w / 2], [r, w / 2], [0, w / 2]], seg, axis);
const helix = (r, h, turns, n = 64) => Array.from({ length: n + 1 }, (_, i) => { const a = i / n * turns * Math.PI * 2; return [r * Math.cos(a), -h / 2 + h * i / n, r * Math.sin(a)]; });
const cross = (s, t = 0.03) => [...rotated(box([-s, -t, -t], [s, t, t]), 'z', Math.PI / 4), ...rotated(box([-s, -t, -t], [s, t, t]), 'z', -Math.PI / 4)];

const DRAW = {
  tyres: (m, c, p) => {
    const w = (p.tyreSize?.width ?? 185) / 1000, side = w * (p.tyreSize?.sidewall ?? 55) / 100, r = 0.19;
    m.add(lathe([[r, -w * 0.45], [r + side * 0.6, -w / 2], [r + side, -w * 0.42], [r + side, w * 0.42], [r + side * 0.6, w / 2], [r, w * 0.45], [r, -w * 0.45]], 36, 'x'), { colour: 'rubber' });
    m.add(ring(r + side * 0.35, r + side * 0.55, w + 0.004, 'x', 36), { colour: c });
    m.add(disc(r, w * 0.7, 'x', 24), { colour: 'grey' });
  },
  brakes: (m, c) => {
    m.add(ring(0.05, 0.14, 0.024), { colour: 'silver' });
    m.add(disc(0.055, 0.05), { colour: 'dark' });
    m.add(box([-0.035, 0.08, -0.05], [0.035, 0.16, 0.05]), { colour: c });
  },
  brake_pads: (m, c) => {
    for (const x of [-0.035, 0.035]) {
      m.add(box([x - 0.008, -0.04, -0.07], [x + 0.008, 0.04, 0.07]), { colour: c });
      m.add(box([x - (x > 0 ? 0.03 : -0.008), -0.034, -0.062], [x + (x > 0 ? -0.008 : 0.03), 0.034, 0.062]), { colour: 'dark' });
    }
  },
  suspension: (m, c, p) => {
    m.add(sweep(helix(0.055, 0.26, 5.5), 0.009, 6), { colour: c });
    if (p.tuning) { m.add(disc(0.03, 0.3, 'y'), { colour: 'silver' }); m.add(disc(0.068, 0.02, 'y').map(t => t.map(q => [q[0], q[1] - 0.11, q[2]])), { colour: 'dark' }); }
    m.add(disc(0.07, 0.015, 'y').map(t => t.map(q => [q[0], q[1] + 0.14, q[2]])), { colour: 'dark' });
  },
  differential: (m, c) => {
    m.add(lathe([[0, -0.09], [0.08, -0.08], [0.11, -0.03], [0.11, 0.03], [0.08, 0.08], [0, 0.09]], 24, 'z'), { colour: 'grey' });
    m.add(disc(0.075, 0.02, 'z').map(t => t.map(q => [q[0], q[1], q[2] + 0.09])), { colour: c });
    m.add(disc(0.025, 0.36, 'x'), { colour: 'dark' });
  },
  gearbox: (m, c, p) => {
    m.add(lathe([[0, 0.14], [0.12, 0.14], [0.08, 0], [0.06, -0.18], [0, -0.18]], 20, 'z'), { colour: 'grey' });
    m.add(box([-0.015, 0.05, -0.08], [0.015, 0.2, -0.05]), { colour: 'dark' });
    m.add(box([-0.03, 0.18, -0.09], [0.03, 0.23, -0.04]), { colour: c });
    if (p.gearbox?.ratios?.length > 5) m.add(box([-0.05, 0.06, -0.02], [0.05, 0.11, 0.08]), { colour: c });
  },
  clutch: (m, c) => {
    m.add(ring(0.05, 0.12, 0.012, 'z'), { colour: c });
    m.add(ring(0.03, 0.1, 0.03, 'z').map(t => t.map(q => [q[0], q[1], q[2] - 0.025])), { colour: 'silver' });
    m.add(disc(0.03, 0.05, 'z'), { colour: 'dark' });
  },
  flywheel: (m, c) => {
    m.add(disc(0.13, 0.025, 'z', 36), { colour: 'silver' });
    for (let i = 0; i < 24; i++) m.add(rotated(box([-0.006, 0.128, -0.012], [0.006, 0.142, 0.012]), 'z', i * Math.PI / 12), { colour: 'silver' });
    m.add(disc(0.045, 0.035, 'z'), { colour: c });
  },
  header: (m, c) => {
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * 0.06;
      m.add(sweep([[x, 0.14, 0], [x, 0.08, 0.02], [x * 0.6, 0, 0.06], [x * 0.2, -0.08, 0.1], [0, -0.12, 0.12]], 0.018, 8), { colour: 'silver' });
    }
    m.add(moved(lathe([[0.03, -0.05], [0.045, -0.05], [0.045, 0.05], [0.03, 0.05], [0.03, -0.05]], 16, 'y'), [0, -0.15, 0.12]), { colour: c });
    m.add(box([-0.13, 0.13, -0.02], [0.13, 0.16, 0.02]), { colour: 'dark' });
  },
  ecu: (m, c) => {
    m.add(box([-0.12, -0.02, -0.08], [0.12, 0.02, 0.08]), { colour: 'dark' });
    m.add(box([-0.1, 0.02, -0.06], [0.04, 0.024, 0.06]), { colour: c });
    for (let i = 0; i < 6; i++) m.add(box([0.07, -0.01, -0.06 + i * 0.022], [0.14, 0.01, -0.05 + i * 0.022]), { colour: 'silver' });
  },
  pistons: (m, c) => {
    m.add(disc(0.045, 0.06, 'y').map(t => t.map(q => [q[0], q[1] + 0.06, q[2]])), { colour: 'silver' });
    for (const y of [0.075, 0.062]) m.add(ring(0.045, 0.047, 0.005, 'y').map(t => t.map(q => [q[0], q[1] + y, q[2]])), { colour: c });
    m.add(box([-0.012, -0.1, -0.008], [0.012, 0.04, 0.008]), { colour: 'grey' });
    m.add(disc(0.03, 0.02, 'z').map(t => t.map(q => [q[0], q[1] - 0.1, q[2]])), { colour: 'grey' });
  },
  intercooler: (m, c) => {
    m.add(box([-0.2, -0.08, -0.025], [0.2, 0.08, 0.025]), { colour: 'silver' });
    for (let i = 0; i < 9; i++) m.add(box([-0.195, -0.075 + i * 0.018, 0.024], [0.195, -0.07 + i * 0.018, 0.028]), { colour: 'grey' });
    for (const x of [-1, 1]) m.add(box([x * 0.2 - 0.03, -0.09, -0.03], [x * 0.2 + 0.03, 0.09, 0.03]), { colour: c });
  },
  turbo: (m, c, p) => {
    const k = p.id.includes('medium') ? 1.2 : 1;
    m.add(scaled(lathe([[0.02, -0.04], [0.09, -0.03], [0.1, 0], [0.09, 0.03], [0.02, 0.04], [0.02, -0.04]], 24, 'z'), [k, k, k]), { colour: c });
    m.add(scaled(moved(disc(0.04, 0.08, 'z'), [0, 0, 0.07]), [k, k, k]), { colour: 'silver' });
    m.add(scaled(moved(lathe([[0.02, -0.035], [0.08, -0.025], [0.08, 0.025], [0.02, 0.035], [0.02, -0.035]], 20, 'z'), [0, 0, -0.08]), [k, k, k]), { colour: 'dark' });
  },
  intake: (m, c, p) => {
    if (p.provides?.includes('intake:filter') || /airbox/.test(p.id)) { m.add(box([-0.12, -0.02, -0.08], [0.12, 0.02, 0.08]), { colour: c }); for (let i = 0; i < 8; i++) m.add(box([-0.11 + i * 0.03, 0.02, -0.07], [-0.1 + i * 0.03, 0.03, 0.07]), { colour: 'grey' }); return; }
    m.add(lathe([[0, -0.1], [0.07, -0.1], [0.05, 0.04], [0.04, 0.05], [0, 0.05]], 20, 'z'), { colour: c });
    m.add(sweep([[0, 0, 0.05], [0, 0, 0.12], [0.04, 0.02, 0.18], [0.1, 0.03, 0.2]], 0.032, 10), { colour: 'silver' });
  },
  spacers: (m, c) => { m.add(ring(0.03, 0.075, 0.015), { colour: c }); for (let i = 0; i < 4; i++) m.add(rotated(box([-0.012, 0.045, -0.006], [0.012, 0.058, 0.006]), 'x', i * Math.PI / 2), { colour: 'silver' }); },
  weight_rear_seats: (m, c) => {
    m.add(box([-0.25, 0, -0.05], [0.25, 0.08, 0.3]), { colour: 'grey' });
    m.add(box([-0.25, 0.08, -0.05], [0.25, 0.45, 0.02]), { colour: 'grey' });
    m.add(moved(cross(0.22), [0, 0.2, 0.34]), { colour: 'red' });
  },
  weight_sound_deadening: (m, c) => {
    for (let i = 0; i < 3; i++) m.add(box([-0.2 + i * 0.02, i * 0.03, -0.15 + i * 0.02], [0.2 + i * 0.02, i * 0.03 + 0.02, 0.15 + i * 0.02]), { colour: i === 2 ? 'grey' : 'dark' });
    m.add(moved(rotated(cross(0.2), 'x', -Math.PI / 2), [0.02, 0.12, 0.02]), { colour: 'red' });
  },
};
DRAW.spoiler = (m, c, p) => {
  const P = p.placeholder ?? { width: 1.3, chord: 0.28, height: 0.22 };
  m.add(box([-P.width / 2, P.height, -P.chord / 2], [P.width / 2, P.height + 0.03, P.chord / 2]), { colour: 'black' });
  for (const side of [-1, 1]) {
    m.add(box([side * P.width * 0.3 - 0.015, 0, -0.045], [side * P.width * 0.3 + 0.015, P.height, 0.005]), { colour: c });
    m.add(box([side * P.width / 2 - 0.008, P.height - 0.06, -P.chord * 0.62], [side * P.width / 2 + 0.008, P.height + 0.1, P.chord * 0.62]), { colour: 'black' });
  }
};
DRAW.brake = DRAW.brakes;
// (for new kinds of car: front and centre diffs, a transfer case, anti-roll bars, a lift kit, a roof)
DRAW.differential_front = DRAW.differential;
// (an engine with no model: a block and its cylinders, inline, flat or in a V; turbo engines a snail)
DRAW.engine = (m, c, p) => {
  const n = p.engine?.cylinders ?? 4, flat = /flat/.test(p.id), vee = n >= 6 || /_v\d/.test(p.id), per = vee ? n / 2 : n, len = 0.09 * per + 0.06;
  m.add(box([-0.14, 0, -len / 2], [0.14, 0.2, len / 2]), { colour: 'grey' });
  for (let i = 0; i < per; i++) {
    const z = -len / 2 + 0.06 + i * 0.09;
    if (flat) for (const side of [-1, 1]) m.add(rotated(disc(0.035, 0.12, 'x'), 'y', 0).map(t => t.map(q => [q[0] + side * 0.2, q[1] + 0.1, q[2] + z])), { colour: c });
    else if (vee) for (const side of [-1, 1]) m.add(rotated(disc(0.035, 0.14, 'y'), 'z', side * 0.6).map(t => t.map(q => [q[0] + side * 0.1, q[1] + 0.26, q[2] + z])), { colour: c });
    else m.add(disc(0.035, 0.14, 'y').map(t => t.map(q => [q[0], q[1] + 0.27, q[2] + z])), { colour: c });
  }
  if (p.engine?.turbo) m.add(lathe([[0, -0.04], [0.07, -0.04], [0.07, 0.04], [0, 0.04]], 20, 'x').map(t => t.map(q => [q[0] + 0.2, q[1] + 0.12, q[2] + len / 2 - 0.04])), { colour: 'silver' });
};
DRAW.centre_diff = (m, c) => {
  m.add(lathe([[0, -0.12], [0.07, -0.11], [0.1, -0.04], [0.1, 0.04], [0.07, 0.11], [0, 0.12]], 24, 'z'), { colour: 'grey' });
  for (const z of [-0.2, 0.2]) m.add(disc(0.025, 0.16, 'z').map(t => t.map(q => [q[0], q[1], q[2] + z])), { colour: 'dark' });
  m.add(ring(0.1, 0.112, 0.06, 'z'), { colour: c });
};
DRAW.transfer_case = (m, c) => {
  m.add(box([-0.09, -0.16, -0.12], [0.09, 0.16, 0.12]), { colour: 'grey' });
  for (const y of [-0.1, 0.1]) m.add(disc(0.03, 0.12, 'z').map(t => t.map(q => [q[0], q[1] + y, q[2] + (y > 0 ? 0.16 : -0.16)])), { colour: 'dark' });
  m.add(box([-0.012, 0.16, -0.02], [0.012, 0.3, 0.02]), { colour: 'dark' });
  m.add(box([-0.03, 0.29, -0.03], [0.03, 0.34, 0.03]), { colour: c });
};
DRAW.anti_roll_bar_front = (m, c) => {
  m.add(sweep([[-0.3, 0.1, 0.12], [-0.3, 0, 0], [0.3, 0, 0], [0.3, 0.1, 0.12]], 0.014, 8), { colour: c });
  for (const x of [-0.17, 0.17]) m.add(box([x - 0.025, -0.03, -0.025], [x + 0.025, 0.03, 0.025]), { colour: 'dark' });
};
DRAW.anti_roll_bar_rear = DRAW.anti_roll_bar_front;
DRAW.lift_kit = (m, c) => {
  m.add(sweep(helix(0.06, 0.3, 6), 0.01, 6), { colour: c });
  m.add(disc(0.08, 0.04, 'y').map(t => t.map(q => [q[0], q[1] - 0.19, q[2]])), { colour: 'dark' });
  m.add(disc(0.08, 0.04, 'y').map(t => t.map(q => [q[0], q[1] + 0.19, q[2]])), { colour: 'dark' });
};
DRAW.roof = (m, c, p) => {
  const hard = p.roof?.kind === 'hard';
  m.add(box([-0.36, 0, -0.42], [0.36, 0.05, 0.45]), { colour: hard ? c : 'black' });
  m.add(box([-0.34, 0.05, -0.3], [0.34, 0.2, 0.28]), { colour: hard ? c : 'black' });
  if (!hard) for (const z of [-0.15, 0.1]) m.add(box([-0.36, 0.19, z - 0.01], [0.36, 0.22, z + 0.01]), { colour: c });
};

// (Phase 5: the new slots — rims by style, superchargers, radiators, cages, cosmetics, off-road and aero kit)
const nearest = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); let best = 'grey', d0 = Infinity; for (const [n, h] of Object.entries({ white: '#f4f5f6', red: '#c8202b', orange: '#e3701e', yellow: '#e8c21c', blue: '#2f6fd6', green: '#3dae6a', purple: '#6c4bb4', black: '#1f2226' })) { const [R, G, B] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2; if (d < d0) { d0 = d; best = n; } } return best; };
const setColour = p => (p.effects ?? []).find(e => e.op === 'set' && typeof e.value === 'string' && e.value.startsWith('#'))?.value;
DRAW.wheels = (m, c, p) => {
  const style = /deepdish/.test(p.id) ? 'dish' : /rally/.test(p.id) ? 'rally' : /beadlock/.test(p.id) ? 'bead' : 'multi', finish = p.look?.finish === 'gloss_black' ? 'black' : p.look?.finish === 'chrome' ? 'light' : /gold|bronze/.test(p.id) ? 'gold' : /white/.test(p.id) ? 'white' : /gunmetal/.test(p.id) ? 'dark' : 'silver';
  const R = 0.2, lip = style === 'dish' ? 0.05 : 0.02;
  m.add(ring(R - lip, R, 0.1), { colour: style === 'dish' ? 'light' : finish });
  m.add(ring(R + 0.002, R + 0.06, 0.12), { colour: 'rubber' });
  m.add(disc(0.045, 0.06), { colour: 'dark' });
  const n = style === 'multi' ? 10 : style === 'rally' ? 6 : style === 'bead' ? 8 : 5, w = style === 'multi' ? 0.012 : 0.022;
  for (let i = 0; i < n; i++) m.add(rotated(box([style === 'dish' ? 0.03 : -0.01, 0.04, -w], [style === 'dish' ? 0.04 : 0.01, R - lip, w]), 'x', i * Math.PI * 2 / n + (style === 'multi' && i % 2 ? 0.12 : 0)), { colour: finish });
  if (style === 'bead') for (let i = 0; i < 24; i++) m.add(rotated(box([0.05, R - 0.03, -0.006], [0.062, R - 0.018, 0.006]), 'x', i * Math.PI / 12), { colour: 'silver' });
  m.add(moved(ring(0.05, 0.065, 0.02), [0.06, 0, 0]), { colour: c });
};
DRAW.supercharger = (m, c, p) => {
  if (/twin_screw|brute/.test(p.id)) { m.add(box([-0.12, 0, -0.25], [0.12, 0.16, 0.25]), { colour: 'silver' }); for (let i = 0; i < 8; i++) m.add(box([-0.13, 0.02 + i * 0.018, -0.24], [0.13, 0.028 + i * 0.018, 0.24]), { colour: 'grey' }); m.add(moved(disc(0.07, 0.03, 'z'), [0, 0.08, 0.27]), { colour: c }); return; }
  m.add(lathe([[0.02, -0.04], [0.09, -0.03], [0.1, 0], [0.09, 0.03], [0.02, 0.04], [0.02, -0.04]], 24, 'z'), { colour: 'silver' });
  m.add(moved(disc(0.05, 0.03, 'z'), [0, 0, -0.07]), { colour: c });
  m.add(sweep([[0, 0.09, 0], [0, 0.18, 0.05], [0.1, 0.2, 0.1]], 0.03, 10), { colour: 'silver' });
};
DRAW.radiator = (m, c) => { m.add(box([-0.3, -0.18, -0.02], [0.3, 0.18, 0.02]), { colour: 'silver' }); for (let i = 0; i < 12; i++) m.add(box([-0.28 + i * 0.05, -0.17, 0.02], [-0.27 + i * 0.05, 0.17, 0.03]), { colour: 'grey' }); for (const x of [-0.32, 0.32]) m.add(box([x - 0.02, -0.19, -0.03], [x + 0.02, 0.19, 0.03]), { colour: c }); };
DRAW.engine_swap = (m, c) => { m.add(box([-0.3, 0, -0.04], [0.3, 0.05, 0.04]), { colour: 'dark' }); for (const x of [-0.22, 0.22]) { m.add(box([x - 0.05, 0.05, -0.05], [x + 0.05, 0.12, 0.05]), { colour: 'black' }); m.add(box([x - 0.035, 0.12, -0.035], [x + 0.035, 0.2, 0.035]), { colour: c }); } };
DRAW.shifter = (m, c) => { m.add(box([-0.06, 0, -0.06], [0.06, 0.02, 0.06]), { colour: 'dark' }); m.add(box([-0.008, 0.02, -0.008], [0.008, 0.2, 0.008]), { colour: 'silver' }); m.add(moved(lathe([[0, -0.03], [0.03, -0.02], [0.03, 0.02], [0, 0.03]], 16, 'y'), [0, 0.22, 0]), { colour: c }); };
DRAW.roll_cage = (m, c, p) => {
  const w = 0.3, h = 0.35, l = /hoop/.test(p.id) ? 0 : 0.4;
  m.add(sweep([[-w, 0, 0], [-w, h, 0], [w, h, 0], [w, 0, 0]], 0.02, 8), { colour: c });
  if (l) { for (const x of [-w, w]) m.add(sweep([[x, h, 0], [x * 0.9, h * 0.8, l], [x, 0, l * 1.3]], 0.018, 8), { colour: c }); m.add(sweep([[-w, 0, 0], [w, h, 0]], 0.016, 8), { colour: c }); }
  else for (const x of [-w, w]) m.add(sweep([[x, h, 0], [x, 0.05, -0.25]], 0.016, 8), { colour: c });
};
DRAW.harness = (m, c) => { for (const x of [-0.08, 0.08]) m.add(box([x - 0.025, 0, -0.005], [x + 0.025, 0.5, 0.005]), { colour: c }); m.add(box([-0.2, 0.05, -0.006], [0.2, 0.1, 0.006]), { colour: c }); m.add(box([-0.04, 0.08, -0.012], [0.04, 0.14, 0.012]), { colour: 'silver' }); };
DRAW.gauges = (m, c) => { m.add(box([-0.05, -0.02, -0.03], [0.05, 0.3, 0.03]), { colour: 'black' }); for (const y of [0.03, 0.13, 0.23]) { m.add(moved(disc(0.035, 0.02, 'z'), [0, y, 0.035]), { colour: 'light' }); m.add(moved(box([-0.002, 0, 0], [0.002, 0.03, 0.005]), [0, y, 0.046]), { colour: c }); } };
DRAW.strut_brace = (m, c, p) => { m.add(box([-0.45, -0.015, -0.02], [0.45, 0.015, 0.02]), { colour: /carbon/.test(p.id) ? 'black' : 'silver' }); for (const x of [-0.48, 0.48]) m.add(moved(disc(0.06, 0.02, 'y'), [x, -0.01, 0]), { colour: c }); };
DRAW.window_tint = (m, c, p) => { const shade = /limo/.test(p.id) ? 'black' : /dark/.test(p.id) ? 'dark' : 'grey'; m.add(box([-0.3, 0, -0.01], [0.3, 0.25, 0.01]), { colour: shade }); m.add(box([-0.32, -0.02, -0.015], [0.32, 0, 0.015]), { colour: c }); };
DRAW.tyre_smoke = (m, c, p) => { const col = nearest(setColour(p) ?? '#f4f5f6'); m.add(ring(0.12, 0.2, 0.12), { colour: 'rubber' }); for (const [x, y, z, r] of [[0, 0.25, -0.1, 0.1], [0, 0.32, -0.22, 0.13], [0, 0.22, -0.3, 0.09]]) m.add(moved(lathe([[0, -r], [r * 0.8, -r * 0.6], [r, 0], [r * 0.8, r * 0.6], [0, r]], 12, 'y'), [x, y, z]), { colour: col }); };
DRAW.underglow = (m, c, p) => { const col = nearest(setColour(p) ?? '#2f8cff'); m.add(box([-0.25, 0.04, -0.45], [0.25, 0.12, 0.45]), { colour: 'dark' }); for (const x of [-0.25, 0.25]) m.add(box([x - 0.012, 0.02, -0.45], [x + 0.012, 0.04, 0.45]), { colour: col }); m.add(box([-0.35, -0.005, -0.55], [0.35, 0.005, 0.55]), { colour: col }); };
DRAW.fog_lights = (m, c, p) => { const col = /yellow/.test(p.id) ? 'yellow' : 'light'; for (const x of [-0.18, 0.18]) { if (/yellow/.test(p.id)) m.add(box([x - 0.08, -0.04, -0.03], [x + 0.08, 0.04, 0.03]), { colour: col }); else m.add(moved(disc(0.06, 0.05, 'z'), [x, 0, 0]), { colour: col }); m.add(moved(ring(0.06, 0.07, 0.05, 'z'), [x, 0, 0]), { colour: 'silver' }); } };
DRAW.seat = (m, c) => { m.add(box([-0.22, 0, -0.25], [0.22, 0.1, 0.25]), { colour: 'black' }); m.add(box([-0.22, 0.1, -0.3], [0.22, 0.65, -0.2]), { colour: 'black' }); for (const x of [-0.24, 0.2]) m.add(box([x, 0.08, -0.3], [x + 0.04, 0.55, 0.15]), { colour: c }); };
DRAW.steering_wheel = (m, c) => { m.add(ring(0.15, 0.175, 0.03, 'z', 32), { colour: 'black' }); for (const a of [0, 2.1, 4.2]) m.add(rotated(box([-0.012, 0.03, -0.01], [0.012, 0.155, 0.01]), 'z', a), { colour: 'dark' }); m.add(disc(0.04, 0.05, 'z'), { colour: c }); m.add(moved(box([-0.01, 0.15, -0.012], [0.01, 0.178, 0.012]), [0, 0, 0.005]), { colour: c }); };
const panel = (m, c, w, h, l, extra) => { m.add(box([-w / 2, 0, -l / 2], [w / 2, h, l / 2]), { colour: c }); extra?.(); };
DRAW.front_lip = (m, c) => { m.add(extrude([[0, 0], [0.04, 0], [0.18, -0.02], [0.18, -0.03], [0, -0.02]], -0.6, 0.6, 'x'), { colour: 'black' }); m.add(box([-0.6, 0.0, -0.01], [0.6, 0.02, 0.01]), { colour: c }); };
DRAW.canards = (m, c) => { for (const x of [-0.4, 0.4]) for (const y of [0, 0.08]) m.add(moved(rotated(box([-0.08, -0.004, -0.06], [0.08, 0.004, 0.06]), 'z', x > 0 ? 0.2 : -0.2), [x, y, 0]), { colour: y ? c : 'black' }); };
DRAW.widebody = (m, c) => { for (const x of [-0.45, 0.45]) { m.add(moved(lathe([[0.22, -0.06], [0.26, -0.04], [0.26, 0.04], [0.22, 0.06]], 20, 'x', { from: 0, to: Math.PI }), [x, 0, 0]), { colour: c }); m.add(moved(ring(0.12, 0.2, 0.1), [x * 0.9, 0, 0]), { colour: 'rubber' }); } };
DRAW.aero_kit = (m, c) => { m.add(box([-0.5, 0, 0.3], [0.5, 0.015, 0.45]), { colour: 'black' }); m.add(box([-0.45, 0, -0.45], [0.45, 0.1, -0.3]), { colour: 'black' }); for (let i = 0; i < 5; i++) m.add(box([-0.36 + i * 0.18, 0, -0.45], [-0.35 + i * 0.18, 0.12, -0.3]), { colour: c }); };
DRAW.bull_bar = (m, c) => { m.add(sweep([[-0.4, 0, 0], [-0.4, 0.35, 0], [-0.2, 0.45, 0], [0.2, 0.45, 0], [0.4, 0.35, 0], [0.4, 0, 0]], 0.025, 8), { colour: 'black' }); m.add(sweep([[-0.4, 0.2, 0], [0.4, 0.2, 0]], 0.02, 8), { colour: c }); };
DRAW.snorkel = (m, c) => { m.add(sweep([[0, 0, 0], [0, 0.5, 0], [0.02, 0.6, 0.05]], 0.03, 10), { colour: 'black' }); m.add(moved(box([-0.05, -0.03, -0.02], [0.05, 0.05, 0.1]), [0.02, 0.62, 0.05]), { colour: c }); };
DRAW.winch = (m, c) => { m.add(disc(0.07, 0.3), { colour: 'dark' }); m.add(ring(0.07, 0.075, 0.26), { colour: c }); for (const x of [-0.17, 0.17]) m.add(moved(box([-0.02, -0.09, -0.08], [0.02, 0.09, 0.08]), [x, 0, 0]), { colour: 'black' }); };
DRAW.roof_rack = (m, c) => { m.add(sweep([[-0.35, 0, -0.5], [0.35, 0, -0.5], [0.35, 0, 0.5], [-0.35, 0, 0.5], [-0.35, 0, -0.5]], 0.015, 6), { colour: 'black' }); for (let i = 0; i < 5; i++) m.add(box([-0.35, -0.01, -0.4 + i * 0.2], [0.35, 0.01, -0.39 + i * 0.2]), { colour: c }); };
DRAW.light_bar = (m, c) => { m.add(box([-0.5, 0, -0.03], [0.5, 0.07, 0.03]), { colour: 'black' }); for (let i = 0; i < 10; i++) m.add(box([-0.47 + i * 0.095, 0.01, 0.03], [-0.4 + i * 0.095, 0.06, 0.035]), { colour: 'light' }); m.add(box([-0.5, -0.02, -0.03], [0.5, 0, 0.03]), { colour: c }); };
DRAW.skid_plates = (m, c) => { m.add(box([-0.35, 0, -0.5], [0.35, 0.02, 0.5]), { colour: 'grey' }); for (let i = 0; i < 6; i++) m.add(moved(disc(0.02, 0.01, 'y'), [i % 2 ? 0.3 : -0.3, 0.025, -0.45 + Math.floor(i / 2) * 0.45]), { colour: c }); };
DRAW.rock_sliders = (m, c) => { for (const x of [-0.3, 0.3]) { m.add(sweep([[x, 0, -0.6], [x, 0, 0.6]], 0.025, 8), { colour: 'black' }); for (const z of [-0.4, 0, 0.4]) m.add(sweep([[x, 0, z], [x * 0.7, 0.08, z]], 0.018, 6), { colour: c }); } };
DRAW.rally_lights = (m, c) => { m.add(box([-0.4, 0, -0.05], [0.4, 0.14, 0.05]), { colour: 'black' }); for (let i = 0; i < 4; i++) m.add(moved(disc(0.06, 0.04, 'z'), [-0.3 + i * 0.2, 0.07, 0.06]), { colour: 'light' }); m.add(box([-0.4, -0.02, -0.05], [0.4, 0, 0.05]), { colour: c }); };
DRAW.mud_flaps = (m, c) => { for (const x of [-0.3, 0.3]) { m.add(box([x - 0.14, 0, -0.005], [x + 0.14, 0.32, 0.005]), { colour: 'red' }); m.add(box([x - 0.12, 0.2, 0.005], [x + 0.12, 0.26, 0.008]), { colour: 'white' }); } m.add(box([-0.46, 0.32, -0.01], [0.46, 0.34, 0.01]), { colour: c }); };
DRAW.engine_cover = (m, c) => { m.add(box([-0.35, 0, -0.3], [0.35, 0.03, 0.3]), { colour: 'black' }); for (let i = 0; i < 6; i++) m.add(box([-0.25, 0.03, -0.25 + i * 0.1], [0.25, 0.045, -0.22 + i * 0.1]), { colour: 'dark' }); m.add(box([-0.36, -0.01, 0.28], [0.36, 0.03, 0.31]), { colour: c }); };
DRAW.bonnet = (m, c) => { m.add(extrude([[0, 0], [0.5, -0.06], [0.5, -0.04], [0, 0.02]], -0.4, 0.4, 'x'), { colour: 'grey' }); m.add(box([-0.15, 0.02, 0.05], [0.15, 0.1, 0.3]), { colour: c }); m.add(box([-0.12, 0.04, 0.3], [0.12, 0.09, 0.31]), { colour: 'black' }); };
DRAW.skirt_left = (m, c) => { m.add(box([-0.03, 0, -0.6], [0.03, 0.1, 0.6]), { colour: 'black' }); m.add(box([0.03, 0, -0.6], [0.06, 0.02, 0.6]), { colour: c }); };
DRAW.skirt_right = DRAW.skirt_left;
DRAW.exhaust = (m, c, p) => { const twin = p.tier === 'race'; m.add(sweep([[0, 0, 0.35], [0, 0, 0.1], [0, 0, -0.1]], 0.035, 12), { colour: 'grey' }); m.add(moved(box([-0.08, -0.06, -0.12], [0.08, 0.06, 0.08]), [0, 0, 0.12]), { colour: 'silver' }); for (const x of twin ? [-0.05, 0.05] : [0]) m.add(moved(ring(0.035, 0.045, 0.1, 'z'), [x, 0, -0.15]), { colour: c }); };
DRAW.engine_swap = DRAW.engine_swap;

export const hasArtwork = part => !!DRAW[part.slot];

export async function artworkFor(part, { finishes } = {}) {
  const draw = DRAW[part.slot];
  if (!draw) return null;
  const m = new ModelBuilder(), colour = part.purpose === 'drift' ? 'orange' : TIER[part.tier] ?? 'grey';
  draw(m, colour, part);
  return m.document({ root: part.id, finishes });
}
