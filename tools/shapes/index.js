// The shapes a part family's models are made from (npm run content -- build; data/content/formulas.json families:
// shape), built on the part generators (tools/generators): each takes the part's settings and stats (a family
// combination's formula context: diameter, construction.mass…, its stats) and the family's own design settings
// (data/families: shape, checked and with every default filled in: formulas.json families.<kind>.shapeSettings — a wheel's
// spoke style, a wing's uprights and profile, a kit piece from assets/kits/<kind>/), and — for a kind fitted to each car
// (fit) — the car and the fit search's candidate (taller uprights, a smaller turbo, moved…). Each kind's shape settings
// at their defaults make the model it made before they existed.
//
//   shapeFor(name) → (id, ctx, stats, design, car?, c?) → PartModel (or a promise of one)

import { rim } from '../generators/rims.js';
import { exhaustTip } from '../generators/exhaust.js';
import { aeroKit, ducktail, wing } from '../generators/aero.js';
import { core, intake, turbo } from '../generators/engine.js';
import { gaugePod, seat, steeringWheel } from '../generators/interior.js';
import { tube } from '../generators/lib/geometry.js';
import { kitPiece } from '../generators/lib/kit.js';

// (moved off its socket by a fit candidate: joined back to it by a pipe or duct)
const joined = (m, d, r, material) => { if (Math.hypot(...d) > 0.02) m.add(tube([[0, 0, 0], [d[0] * 0.5, d[1] * 0.1, d[2] * 0.5], d], r, { sides: 8, bend: 0.04 }), material); return m; };

// A part's design with its kit pieces loaded (before its shape is made: a fitted kind's shape is made many times, at
// once): each kit shape setting's piece — not 'none' — as a function the generator calls for its triangles, scaled for
// where it goes (tools/generators/lib/kit.js); 'none' left out
export async function withKits(kindName, kind, design) {
  const out = { ...design };
  for (const [k, S] of Object.entries(kind?.shapeSettings ?? {})) {
    if (!S?.kit) continue;
    if (out[k] && out[k] !== 'none') out[k] = await kitPiece(kindName, S.kit, out[k]); else delete out[k];
  }
  return out;
}
const plates = P => !P || P.none ? null : { up: P.up, down: P.down, ...(P.long != null && { long: P.long }), ...(P.sweep && { sweep: P.sweep }) };

const SHAPES = {
  wheel: (id, c, st, d) => rim(id, { spoke: 'straight', spokeWidth: 0.04, taper: 0.7, concave: 0.015, cap: 'flat', ...d, diameter: c.diameter, width: c.width, spokes: c.spokes }),
  exhaust: (id, c, st, d) => {
    const R = Math.min(0.05, c.diameter / 1000 / 2 * 1.1), gap = R + (d.gap ?? 0.006);
    const tips = c.tips === 'single' ? [[0, 0]] : c.tips === 'quad' ? [[gap, gap * 0.75], [-gap, gap * 0.75], [gap, -gap * 0.75], [-gap, -gap * 0.75]] : [[gap, 0], [-gap, 0]];
    return exhaustTip(id, { length: d.length ?? 0.18, cut: d.cut ?? 'rolled', ...(d.slash != null && { slash: d.slash }), ...(d.tipShape === 'oval' && { shape: 'oval' }), tips, radius: c.tips === 'quad' ? R * 0.8 : R, material: 'chrome', ...(d.tipPiece && { piece: d.tipPiece }) });
  },
  wing: (id, c, st, d, car, f = {}) => {
    if (c.style.id === 'ducktail') return ducktail(id, { span: c.span, chord: c.chord, height: c.riser + (f.dh ?? 0), material: 'carbon' }).moved([0, 0, f.dz ?? 0]);
    const wingSettings = {
      mounts: d.mounts ?? 'straight', plates: d.plates ? plates(d.plates) : { up: 0.05, down: 0.06 }, ...(d.profile && { thick: d.profile.thick, camber: d.profile.camber }), ...(d.gurney && { gurney: d.gurney }),
      span: c.span, chord: c.chord, height: c.riser + (f.dh ?? 0), mountX: c.span * 0.3, lift: f.lift, material: 'carbon', ...(c.elements > 1 && { second: { chord: c.chord * 0.38, gap: 0.015 } }), ...(d.platePiece && { platePiece: d.platePiece }),
    };
    return wing(id, wingSettings).moved([0, 0, f.dz ?? 0]);
  },
  intake: (id, c, st, d, car, f = {}) => {
    const s = { kind: c.style.id, pipe: c.diameter / 2000, filter: 'red', ...(c.style.id === 'cold_air' && { reach: 0.5 }), ...d };
    if (f.way) s.way = f.way;
    if (f.reach != null && s.kind === 'cold_air') s.reach = (s.reach ?? 0.55) * f.reach;
    if (f.reach != null && s.kind === 'cone') s.reach = f.reach;
    if (f.reach != null && s.kind === 'stacks') s.stackScale = (d.stackScale ?? 1) * f.reach;
    const dd = [f.dx ?? 0, f.dy ?? 0, f.dz ?? 0];
    return joined(intake(id, s).moved(dd), dd, 0.032, 'silver');
  },
  turbo: (id, c, st, d, car, f = {}) => {
    const s = { inlet: 'filter', manifold: 'cast', downpipe: 0.2, ...d, size: (0.06 + (c.size - 40) * 0.0017) * (f.k ?? 1) };
    if (f.up != null) s.up = f.up;
    const dd = [f.dx ?? 0, f.dy ?? 0, f.dz ?? 0];
    return joined(turbo(id, s).moved(dd), dd, 0.026, 'raw_metal');
  },
  intercooler: (id, c, st, d, car, f = {}) => core(id, { tanks: 'side', tank: 0.055, pipes: true, pipeMaterial: 'raw_metal', ...d, width: c.width * (f.kw ?? 1), height: c.height * (f.kh ?? 1), depth: c.thickness / 1000 }).moved([0, f.dy ?? 0, f.dz ?? 0]),
  seat: (id, c, st, d, car, f = {}) => { const { fabric, ...rest } = d; return seat(id, { height: 0.9, depth: 0.7, fabric: fabric?.colour ?? '#2d3138', bolster: c.style === 'fixed' ? 0.14 : 0.1, slots: true, ...rest, style: c.style, shell: 'carbon', width: c.width * (f.kw ?? 1), lean: f.lean, ...(f.kh && { height: (d.height ?? 0.9) * f.kh }) }).moved([0, 0, f.dz ?? 0]); },
  steering_wheel: (id, c, st, d, car, f = {}) => { const { rimThickness, marker, ...rest } = d; return steeringWheel(id, { grip: rimThickness ?? 0.017, spoke: 'drilled', quickRelease: true, marker: marker === 'none' ? null : marker ?? 'red', ...rest, diameter: c.diameter / 1000 * (f.k ?? 1), dish: c.dish / 1000, spokes: c.spokes, rimMaterial: c.grip.id === 'leather' ? 'black' : 'seat_fabric', spokeMaterial: 'carbon', boss: f.boss }); },
  gauges: (id, c, st, d, car, f = {}) => gaugePod(id, { ...d, gauges: c.count, size: c.size / 1000, layout: f.layout ?? c.layout }).moved([f.dx ?? 0, f.dy ?? 0, f.dz ?? 0]),
  body_kit: (id, c, st, d, car) => aeroKit(id, car, { ...d, protrude: 0.04 + c.depth, diffuser: c.diffuser, canards: c.canards }),
};
export const shapeFor = name => SHAPES[name] ?? null;
export const SHAPE_NAMES = Object.keys(SHAPES);
