// A generated part's model: shapes added in named materials (or palette colours on car_atlas), its
// triangle count against its type's budget, its mass from each shape's volume × its material's
// density, and the glTF document the import pipeline takes.
//
//   const m = new PartModel('rim_mesh');
//   m.add(cylinder('x', 0.2, -0.05, 0.05, 24), 'rim_finish');       // a material (data/content/model-rules.json)
//   m.add(box(…), 'black');                                          // a palette colour (car_atlas)
//   const doc = await m.document();   m.mass()   m.triangles

import { ModelBuilder, PALETTE } from '../../content/shapes.mjs';
import { readJson } from '../../content/rules.mjs';

// The generators' own materials: plain surfaces in their own colour (the game keeps them whatever the
// part's finish, except rim_finish, which is the face a rim's finish goes on)
export const MATERIALS = {
  rim_finish: { colour: '#c4c8ce', metalness: 0.75, roughness: 0.3 },
  caliper: { colour: '#c8202b', metalness: 0.25, roughness: 0.4 },
  seat_fabric: { colour: '#2c2f34', metalness: 0, roughness: 0.95 },
  light_aux: { colour: '#f3f1e8', emissive: '#fff5d6', metalness: 0, roughness: 0.15 },
  glass: { colour: '#9fb4c0', metalness: 0.2, roughness: 0.08 },
};
// Densities (kg/m³) for the mass from the volume: the shapes are solid, so these are for what they
// stand for (a hollow tube, a cast face, a foam seat) rather than the raw material
const DENSITY = {
  rim_finish: 1900, caliper: 2600, seat_fabric: 110, light_aux: 700, glass: 1500, paint: 600,
  carbon: 450, chrome: 2200, raw_metal: 2200, titanium: 1500, gloss_black: 1200, matte_black: 1200, rubber: 900,
  // palette colours (car_atlas): plastics and painted metal
  black: 900, dark: 1300, grey: 2000, silver: 2000, light: 700, white: 700,
  red: 800, orange: 800, yellow: 800, blue: 800, green: 800, bronze: 2000, copper: 2500, gold: 2000, purple: 800,
};
const finishes = () => (FIN ??= readJson('data/finishes.json').finishes);
let FIN = null;

export class PartModel {
  constructor(name) { this.name = name; this.mb = new ModelBuilder(); this.pieces = []; this.triangles = 0; this.own = {}; }
  // A material in this model's own colour (a white rally rim's face): { colour, metalness, roughness }
  material(name, look) { this.own[name] = { ...MATERIALS[name], ...look }; return this; }
  // tris in a material (a model-rules material name or a finish) or a palette colour; options:
  // { node, density (kg/m³, instead of the material's), mass (kg, instead of from the volume), pivot (where
  // the node turns about: a wing's element, wing_element, turns to the wing's angle in the game) }
  add(tris, material = 'raw_metal', { node = 'model', density, mass, pivot } = {}) {
    if (!tris.length) return this;
    if (pivot) this.mb.pivot(node, pivot);
    // (a material if it's one — rubber is a finish too — else a palette colour)
    const named = material === 'paint' || material in MATERIALS || !!finishes()[material];
    if (!named && !(material in PALETTE)) throw new Error(`${this.name}: "${material}" is neither a material nor a palette colour`);
    if (named) this.mb.add(tris, { node, material });
    else this.mb.add(tris, { node, material: 'car_atlas', colour: material });
    this.pieces.push({ material, volume: volumeOf(tris), density: density ?? DENSITY[material] ?? 1000, mass });
    this.triangles += tris.length;
    return this;
  }
  // Every triangle in it (its own frame: the socket's)
  tris() { return [...this.mb.groups.values()].flatMap(g => g.tris); }
  // Everything moved by [dx, dy, dz] (pivots too)
  moved([dx, dy, dz]) {
    for (const g of this.mb.groups.values()) g.tris = g.tris.map(t => t.map(p => [p[0] + dx, p[1] + dy, p[2] + dz]));
    for (const k of Object.keys(this.mb.pivots)) this.mb.pivots[k] = this.mb.pivots[k].map((v, i) => v + [dx, dy, dz][i]);
    return this;
  }
  // Its mass (kg): each piece's volume × density (or its own mass)
  mass() { return this.pieces.reduce((s, p) => s + (p.mass ?? p.volume * p.density), 0); }
  materials() { return [...new Set(this.pieces.map(p => p.material))]; }
  async document() {
    return this.mb.document({ root: this.name, finishes: finishes(), materials: { ...MATERIALS, ...this.own } });
  }
}
// (a closed shape's volume: the signed tetrahedra from the origin, summed)
function volumeOf(tris) {
  let v = 0;
  for (const [a, b, c] of tris) v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  return Math.abs(v);
}

// A starting price for a new part: the middle of its tier's band for its slot (data/content/tiers.json),
// to the nearest 10 — left marked to do, for balancing
export function suggestPrice(slot, tier) {
  const t = readJson('data/content/tiers.json'), street = t.slots[slot]?.street, band = t.tiers[tier]?.price;
  return street && band ? Math.round(street * (band[0] + band[1]) / 2 / 10) * 10 : 0;
}
