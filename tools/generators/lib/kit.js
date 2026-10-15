// Kit pieces (docs/MODELLING_GUIDE.md "Kit pieces"; data/content/model-rules.json kits): small hand-made models — a wing's
// end plate, a wheel's centre, an exhaust tip, a vent on a bumper's corner — that the generators mix into what they
// make in code, where a shape is better modelled than made procedurally. Each is assets/kits/<kind>/<attach>_<name>.glb
// (npm run import of kit_<kind>_<attach>_<name>.glb puts it there, checked), modelled at its attach point's reference
// size with its origin where the attach point's rule says; the generator scales it to where it goes.
//
//   listKits(root) → { kind: { attach: [name] } }
//   kitPiece(kind, attach, name) → (…sizes) → [[triangles, material]]   (the triangles in the piece's own frame, scaled)

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJson } from '../../content/rules.mjs';
import { readModel } from '../../content/io.mjs';

export const KIT_DIR = 'assets/kits';
export function listKits(root = ROOT) {
  const out = {}, dir = path.join(root, KIT_DIR);
  if (!fs.existsSync(dir)) return out;
  const rules = readJson('data/content/model-rules.json', root).kits ?? {};
  for (const kind of fs.readdirSync(dir).filter(k => !k.startsWith('.') && fs.statSync(path.join(dir, k)).isDirectory()).sort()) {
    for (const f of fs.readdirSync(path.join(dir, kind)).filter(f => f.endsWith('.glb')).sort()) {
      const base = f.replace(/\.glb$/, ''), attach = Object.keys(rules[kind] ?? {}).filter(a => !a.startsWith('_')).sort((a, b) => b.length - a.length).find(a => base.startsWith(`${a}_`));
      if (!attach) continue;
      ((out[kind] ??= {})[attach] ??= []).push(base.slice(attach.length + 1));
    }
  }
  return out;
}

// (a model's triangles by material, in the model's frame: every node's transform applied)
export async function trianglesByMaterial(file) {
  const doc = await readModel(file), groups = new Map();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const M = node.getWorldMatrix(), at = (a, i) => { const x = a[i], y = a[i + 1], z = a[i + 2]; return [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]]; };
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')?.getArray(), idx = prim.getIndices()?.getArray(), mat = prim.getMaterial()?.getName() ?? 'raw_metal';
      if (!pos) continue;
      const n = idx ? idx.length : pos.length / 3, tris = groups.get(mat) ?? [];
      for (let i = 0; i + 2 < n; i += 3) { const [a, b, c] = [0, 1, 2].map(k => idx ? idx[i + k] : i + k); tris.push([at(pos, a * 3), at(pos, b * 3), at(pos, c * 3)]); }
      groups.set(mat, tris);
    }
  }
  return [...groups.entries()].map(([material, tris]) => [tris, material]);
}

const loaded = new Map();
export async function kitPiece(kind, attach, name, root = ROOT) {
  const file = path.join(root, KIT_DIR, kind, `${attach}_${name}.glb`);
  if (!fs.existsSync(file)) throw new Error(`there's no kit piece ${KIT_DIR}/${kind}/${attach}_${name}.glb (npm run import of kit_${kind}_${attach}_${name}.glb puts one there)`);
  const rule = readJson('data/content/model-rules.json', root).kits?.[kind]?.[attach];
  if (!rule) throw new Error(`model-rules.json kits has no attach point "${attach}" for ${kind}`);
  if (!loaded.has(file)) loaded.set(file, await trianglesByMaterial(file));
  const groups = loaded.get(file), ref = rule.reference ?? {};
  // (scaled for where it goes: by the sizes the generator passes, against the attach point's reference sizes)
  return (...sizes) => {
    const k = scaleFor(rule, ref, sizes);
    return groups.map(([tris, mat]) => [tris.map(t => t.map(p => [p[0] * k[0], p[1] * k[1], p[2] * k[2]])), mat]);
  };
}
// (each axis's scale: rule.scale names, for x, y and z, which of the sizes passed — in order, rule.sizes — it follows)
function scaleFor(rule, ref, sizes) {
  const named = Object.fromEntries((rule.sizes ?? []).map((n, i) => [n, sizes[i]]));
  return ['x', 'y', 'z'].map(ax => { const by = rule.scale?.[ax]; return by && named[by] != null && ref[by] ? named[by] / ref[by] : 1; });
}
