// Low-poly shapes built in code, flat-shaded like the game's models, and a model made of them
// (a gltf-transform Document): for the sample models the pipeline is tested with and for the artwork
// behind the icons of parts that have no model. Colours come from a small palette texture on the
// car_atlas material (each shape's UVs sit on its colour), like the game's own models; "paint" and
// finish materials are plain.
//
//   const m = new ModelBuilder();
//   m.add(box([-0.6, 0, -0.1], [0.6, 0.05, 0.1]), { material: 'paint' });
//   m.add(lathe([[0.19, -0.07], [0.19, 0.07]], 24, 'x'), { colour: 'silver', node: 'rim' });
//   const doc = await m.document({ root: 'spoiler_ducktail' });

import { Document } from '@gltf-transform/core';
import sharp from 'sharp';

export const PALETTE = {
  rubber: '#141415', black: '#1f2226', dark: '#34393f', grey: '#6b7078', silver: '#b8bdc4', light: '#e3e6ea',
  red: '#c8202b', orange: '#e3701e', yellow: '#e8c21c', blue: '#2f6fd6', green: '#3dae6a', bronze: '#8a6a3e',
  copper: '#b0673a', gold: '#c9a33c', purple: '#6c4bb4', white: '#f4f5f6',
};
const NAMES = Object.keys(PALETTE), SIDE = 4;    // (a 4 × 4 texture)
const uvOf = colour => { const i = Math.max(0, NAMES.indexOf(colour)); return [((i % SIDE) + 0.5) / SIDE, (Math.floor(i / SIDE) + 0.5) / SIDE]; };

// ---------- shapes: lists of triangles [[a, b, c], …], each point [x, y, z] ----------

export function box(min, max) {
  const [x0, y0, z0] = min, [x1, y1, z1] = max, v = (x, y, z) => [x ? x1 : x0, y ? y1 : y0, z ? z1 : z0];
  const quad = (a, b, c, d) => [[a, b, c], [a, c, d]];
  return outward([
    ...quad(v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)), ...quad(v(0, 0, 1), v(0, 1, 1), v(0, 1, 0), v(0, 0, 0)),
    ...quad(v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)), ...quad(v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)),
    ...quad(v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)), ...quad(v(1, 0, 0), v(0, 0, 0), v(0, 1, 0), v(1, 1, 0)),
  ]);
}
// A profile turned round an axis: points [r, h] (r out from the axis, h along it) — a closed outline,
// or one that starts and ends on the axis (r = 0) for a solid. axis: 'x' | 'y' | 'z'
export function lathe(profile, segments = 24, axis = 'y', { from = 0, to = Math.PI * 2 } = {}) {
  const at = (r, h, a) => { const c = r * Math.cos(a), s = r * Math.sin(a); return axis === 'x' ? [h, s, c] : axis === 'y' ? [c, h, s] : [c, s, h]; };
  // (which side of the outline is outside: from which way round it goes)
  let area = 0;
  for (let i = 0; i < profile.length; i++) { const [r0, h0] = profile[i], [r1, h1] = profile[(i + 1) % profile.length]; area += r0 * h1 - r1 * h0; }
  const sgn = area >= 0 ? 1 : -1, out = [];
  for (let j = 0; j < profile.length - 1; j++) {
    const [r0, h0] = profile[j], [r1, h1] = profile[j + 1], n2 = [(h1 - h0) * sgn, -(r1 - r0) * sgn];
    for (let i = 0; i < segments; i++) {
      const a0 = from + (to - from) * i / segments, a1 = from + (to - from) * (i + 1) / segments, am = (a0 + a1) / 2;
      const want = add(scale(at(1, 0, am), n2[0]), scale(at(0, 1, 0), n2[1]));
      const A = at(r0, h0, a0), B = at(r0, h0, a1), C = at(r1, h1, a1), D = at(r1, h1, a0);
      if (r0 > 1e-9) out.push(facing([A, B, C], want));
      if (r1 > 1e-9) out.push(facing([A, C, D], want));
    }
  }
  return out;
}
// A polygon (points [u, v] in the plane across `axis`) pushed along it from a to b, capped
export function extrude(polygon, a, b, axis = 'x') {
  const at = (u, v, w) => axis === 'x' ? [w, u, v] : axis === 'y' ? [u, w, v] : [u, v, w];
  const out = [], n = polygon.length;
  for (let i = 0; i < n; i++) {
    const [u0, v0] = polygon[i], [u1, v1] = polygon[(i + 1) % n];
    out.push([at(u0, v0, a), at(u1, v1, a), at(u1, v1, b)], [at(u0, v0, a), at(u1, v1, b), at(u0, v0, b)]);
  }
  // (caps: a fan from the middle — the polygons here are convex, or star-shaped round their middle)
  const mid = polygon.reduce((m, p) => [m[0] + p[0] / n, m[1] + p[1] / n], [0, 0]);
  for (let i = 0; i < n; i++) {
    const p = polygon[i], q = polygon[(i + 1) % n];
    out.push([at(mid[0], mid[1], a), at(q[0], q[1], a), at(p[0], p[1], a)], [at(mid[0], mid[1], b), at(p[0], p[1], b), at(q[0], q[1], b)]);
  }
  return outward(out);
}
// A tube (`sides` round, radius r) along a path of points
export function sweep(path, r, sides = 6) {
  const out = [], rings = path.map((p, i) => {
    const q = path[Math.min(i + 1, path.length - 1)], o = path[Math.max(i - 1, 0)], t = norm(sub(q, o));
    const up = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], u = norm(cross(t, up)), v = cross(t, u);
    return Array.from({ length: sides }, (_, k) => { const a = k / sides * Math.PI * 2; return add(p, add(scale(u, r * Math.cos(a)), scale(v, r * Math.sin(a)))); });
  });
  for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < sides; k++) {
    const a = rings[i][k], b = rings[i][(k + 1) % sides], c = rings[i + 1][(k + 1) % sides], d = rings[i + 1][k], mid = scale(add(path[i], path[i + 1]), 0.5);
    for (const t of [[a, b, c], [a, c, d]]) out.push(facing(t, sub(scale(add(add(t[0], t[1]), t[2]), 1 / 3), mid)));
  }
  return out;
}
export const moved = (tris, [dx, dy, dz]) => tris.map(t => t.map(p => [p[0] + dx, p[1] + dy, p[2] + dz]));
export const scaled = (tris, [sx, sy, sz]) => tris.map(t => t.map(p => [p[0] * sx, p[1] * sy, p[2] * sz]));
export const rotated = (tris, axis, angle) => {
  const c = Math.cos(angle), s = Math.sin(angle);
  const r = axis === 'x' ? p => [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c] : axis === 'y' ? p => [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c] : p => [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
  return tris.map(t => t.map(r));
};

// (a triangle wound to face `want`)
const facing = ([a, b, c], want) => dot(cross(sub(b, a), sub(c, a)), want) < 0 ? [a, c, b] : [a, b, c];
// (a closed shape's triangles all facing out of it: flipped where they face its middle)
function outward(tris) {
  const n = tris.length * 3, mid = tris.flat().reduce((m, p) => add(m, scale(p, 1 / n)), [0, 0, 0]);
  return tris.map(([a, b, c]) => dot(cross(sub(b, a), sub(c, a)), sub(scale(add(add(a, b), c), 1 / 3), mid)) < 0 ? [a, c, b] : [a, b, c]);
}
const sub = (a, b) => a.map((v, i) => v - b[i]), add = (a, b) => a.map((v, i) => v + b[i]), scale = (a, k) => a.map(v => v * k);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => scale(a, 1 / (Math.hypot(...a) || 1));

// ---------- a model ----------

export class ModelBuilder {
  constructor() { this.groups = new Map(); this.pivots = {}; }
  // A node's origin somewhere other than the model's (what it turns about: a wing's element): its
  // triangles stay where they are, the node moves there
  pivot(node, at) { this.pivots[node] = at; return this; }
  // tris into a node (default: one node), in a material: 'car_atlas' (with a palette colour), 'paint'
  // or a finish name; extra: { flipNormals }
  add(tris, { node = 'model', material = 'car_atlas', colour = 'grey' } = {}) {
    const key = `${node}|${material}|${material === 'car_atlas' ? colour : ''}`;
    if (!this.groups.has(key)) this.groups.set(key, { node, material, colour, tris: [] });
    this.groups.get(key).tris.push(...tris);
    return this;
  }
  // → a Document: a root node (named root), a child node per `node`, a mesh per node with a
  // primitive per material; empty nodes: [{ name, position, rotation }] (sockets)
  async document({ root = 'model', paintColour = '#6d9a91', finishes = {}, empties = [], materials = {} } = {}) {
    const doc = new Document(), scene = doc.createScene('Scene'), top = doc.createNode(root);
    doc.createBuffer();
    scene.addChild(top);
    await this.addTo(doc, top, { paintColour, finishes, materials });
    for (const e of empties) { const n = doc.createNode(e.name).setTranslation(e.position ?? [0, 0, 0]); if (e.rotation) n.setRotation(e.rotation); top.addChild(n); }
    return doc;
  }
  // The shapes into an existing model (a stock part with something added), under a node of it; its
  // materials by name where it has them
  async addTo(doc, top, { paintColour = '#6d9a91', finishes = {}, materials = {} } = {}) {
    const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
    const mats = new Map(doc.getRoot().listMaterials().map(m => [m.getName(), m])), nodes = new Map();
    this.atlas = mats.get('car_atlas')?.getBaseColorTexture() ?? null;
    const own = !this.atlas;
    if (!own && [...this.groups.values()].some(g => g.material === 'car_atlas')) throw new Error('this model has its own car_atlas texture: give added shapes a finish material (matte_black, carbon…) instead');
    const material = name => {
      if (mats.has(name)) return mats.get(name);
      const m = doc.createMaterial(name);
      if (name === 'car_atlas') m.setBaseColorTexture(this.atlas ??= doc.createTexture('car_atlas').setMimeType('image/png')).setRoughnessFactor(0.7).setMetallicFactor(0);
      else if (name === 'paint') m.setBaseColorFactor(linear(paintColour)).setRoughnessFactor(0.4).setMetallicFactor(0.1);
      else if (materials[name]) { const M = materials[name]; m.setBaseColorFactor(linear(M.colour ?? '#888888')).setMetallicFactor(M.metalness ?? 0).setRoughnessFactor(M.roughness ?? 0.6); if (M.emissive) m.setEmissiveFactor(linear(M.emissive).slice(0, 3)); }
      else { const f = finishes[name] ?? {}; m.setBaseColorFactor(linear(f.colour ?? '#c0c4c9')).setMetallicFactor(f.metalness ?? 0.5).setRoughnessFactor(f.roughness ?? 0.4); }
      mats.set(name, m);
      return m;
    };
    for (const g of this.groups.values()) {
      const pv = this.pivots[g.node] ?? [0, 0, 0];
      if (!nodes.has(g.node)) { const n = doc.createNode(g.node).setMesh(doc.createMesh(g.node)); if (this.pivots[g.node]) n.setTranslation(pv); top.addChild(n); nodes.set(g.node, n); }
      const pos = [], nor = [], uv = [], [cu, cv] = uvOf(g.colour);
      for (const [a, b, c] of g.tris) {
        const n = norm(cross(sub(b, a), sub(c, a)));
        for (const p of [a, b, c]) { pos.push(p[0] - pv[0], p[1] - pv[1], p[2] - pv[2]); nor.push(...n); uv.push(cu, cv); }
      }
      const prim = doc.createPrimitive().setMaterial(material(g.material))
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
        .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buffer));
      if (g.material === 'car_atlas') prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buffer));
      nodes.get(g.node).getMesh().addPrimitive(prim);
    }
    if (this.atlas && (own || !this.atlas.getImage())) this.atlas.setImage(await paletteImage());
    return doc;
  }
}
const linear = hex => [...[1, 3, 5].map(i => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }), 1];
async function paletteImage() {
  const raw = Buffer.alloc(SIDE * SIDE * 4);
  NAMES.forEach((name, i) => { const h = PALETTE[name]; for (let k = 0; k < 3; k++) raw[i * 4 + k] = parseInt(h.slice(1 + 2 * k, 3 + 2 * k), 16); raw[i * 4 + 3] = 255; });
  return new Uint8Array(await sharp(raw, { raw: { width: SIDE, height: SIDE, channels: 4 } }).png().toBuffer());
}
