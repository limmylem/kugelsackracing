// Body panels made from a car's own: the Kaze GT's cowl bonnet — its stock bonnet with a raised cowl over the engine bay,
// tall enough for the engines swapped into it (the Brute 500's V8, with a twin-screw blower on it, and the Strada Evo's
// turbo four): the stock panel's triangles under the cowl split three times (its outline and hinge kept exactly), raised
// smoothly — a cowl rising towards the front as the engines under it do (low by the windscreen's scuttle, full height
// from `full` on), its sides and back falling over `fall` m, its nose over `nose` m.

import { trianglesOf } from './lib/fitcheck.js';
import { PartModel } from './lib/part.js';

const smooth = t => { const x = Math.min(1, Math.max(0, t)); return x * x * x * (x * (x * 6 - 15) + 10); };
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
// (a triangle cut by the plane z = c into the pieces each side, fanned into triangles; one not crossing it as it is)
function cutAt(t, c) {
  const side = t.map(p => p[2] < c), n = side.filter(Boolean).length;
  if (n === 0 || n === 3) return [t];
  const at = (a, b) => { const k = (c - a[2]) / (b[2] - a[2]); return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, c]; };
  const back = [], front = [];
  for (let i = 0; i < 3; i++) {
    const a = t[i], b = t[(i + 1) % 3];
    (side[i] ? back : front).push(a);
    if (side[i] !== side[(i + 1) % 3]) { const x = at(a, b); back.push(x); front.push(x); }
  }
  const fan = poly => poly.slice(1, -1).map((p, i) => [poly[0], p, poly[i + 2]]);
  return [...fan(back), ...fan(front)];
}
// (one round of splitting, kept closed: every edge of a triangle that's wanted split at its middle — and so in the
// triangle on its other side too, whether that one's wanted or not: no edge left meeting a split one's middle (a hole
// to the mesh's checks). A triangle with three edges split makes four, two makes three, one makes two)
const keyOf = p => p.map(v => v.toFixed(6)).join(',');
const edgeKey = (a, b) => { const x = keyOf(a), y = keyOf(b); return x < y ? `${x}|${y}` : `${y}|${x}`; };
function splitWhere(tris, want, edgeWanted = () => true) {
  const marked = new Set();
  for (const t of tris) if (want(t)) for (let i = 0; i < 3; i++) if (edgeWanted(t[i], t[(i + 1) % 3])) marked.add(edgeKey(t[i], t[(i + 1) % 3]));
  return tris.flatMap(t => {
    const m = [0, 1, 2].map(i => marked.has(edgeKey(t[i], t[(i + 1) % 3])) ? mid(t[i], t[(i + 1) % 3]) : null), n = m.filter(Boolean).length;
    if (n === 0) return [t];
    const [a, b, c] = t, [ab, bc, ca] = m;
    if (n === 3) return [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]];
    // (rotated so the split edges come first: one — a b; two — a b and b c)
    const r = n === 1 ? (ab ? 0 : bc ? 1 : 2) : (!ca ? 0 : !ab ? 1 : 2), P = [0, 1, 2].map(i => t[(i + r) % 3]), M = [0, 1, 2].map(i => m[(i + r) % 3]);
    if (n === 1) return [[P[0], M[0], P[2]], [M[0], P[1], P[2]]];
    return [[P[0], M[0], P[2]], [M[0], P[1], M[1]], [M[0], M[1], P[2]]];
  });
}

// settings (the bonnet's own frame: x across, z forward from the hinge, its top surface at y = 0): { halfWidth, from, to
// (z: the cowl's top), full (z: full height from there on; rearShare of it at from), height, fall, nose, splits }
export async function cowlBonnet(id, stockModel, s) {
  // (split only where the cowl is: elsewhere the panel keeps the stock triangles — and meets the body as the stock one
  // does along its hinge. Nothing moves outside the cowl; the edges round it are split on both sides: no holes)
  const x0 = s.halfWidth + s.fall, z0 = s.from - s.fall, z1 = s.to + s.nose;
  const touches = t => !(t.every(p => p[0] <= -x0) || t.every(p => p[0] >= x0) || t.every(p => p[2] <= z0) || t.every(p => p[2] >= z1));
  // (first cut once along z = z0: the strip behind it — the hinge's, where the panel meets the scuttle — stays in a few
  // pieces, as the stock bonnet's does)
  let tris = (await trianglesOf(stockModel)).flatMap(t => cutAt(t, z0));
  // (an edge along the cowl's edge — where it doesn't rise at all — isn't split: the panel beside it keeps its triangles)
  const e = 1e-6, out = (a, b) => (a[2] <= z0 + e && b[2] <= z0 + e) || (a[2] >= z1 - e && b[2] >= z1 - e) || (a[0] <= -x0 + e && b[0] <= -x0 + e) || (a[0] >= x0 - e && b[0] >= x0 - e);
  for (let k = 0; k < s.splits; k++) tris = splitWhere(tris, touches, (a, b) => !out(a, b));
  const ramp = z => s.rearShare + (1 - s.rearShare) * Math.min(1, Math.max(0, (z - s.from) / (s.full - s.from)));
  const lift = (x, z) => s.height * ramp(z) * smooth((s.halfWidth + s.fall - Math.abs(x)) / s.fall) * smooth((z - (s.from - s.fall)) / s.fall) * smooth((s.to + s.nose - z) / s.nose);
  const raised = tris.map(t => t.map(([x, y, z]) => [x, y + lift(x, z), z]));
  return new PartModel(id).add(raised, 'paint', { mass: s.mass });
}

export const COWL = { halfWidth: 0.41, from: 0.25, to: 1.0, full: 0.75, rearShare: 0.4, height: 0.27, fall: 0.1, nose: 0.16, splits: 4, mass: 17 };

export async function parts({ project }) {
  const stock = project.db.parts.kaze_gt_bonnet.model;
  return [{ id: 'kaze_gt_bonnet_cowl', type: 'cowl_bonnet', fromStock: 'kaze_gt_bonnet', design: 'the stock bonnet with a raised cowl over the engine bay', settings: COWL, build: () => cowlBonnet('kaze_gt_bonnet_cowl', stock, COWL) }];
}
