// The auto-fixer: what can be put right in a model without asking — what a game model mustn't have
// (cameras, lights, animations, skins, extra scenes), missing normals (flat, like the rest of the game),
// unused data (but never an empty node: sockets are empty nodes — prune keepLeaves), duplicate meshes,
// materials and textures, textures over the size limit — and the geometry compressed (meshopt, which
// the game's loader decodes). On request: a scale (a model made in centimetres: 0.01), the origin put
// where its type's rules say (--place-origin), and painted surfaces split into a "paint" material by
// matching the texture's colours to a paint colour (--paint #rrggbb).
//
//   const did = await autoFix(doc, { rules, type, scale, placeOrigin, paint: { colour, tolerance }, materials: { 'Material.001': 'paint' }, compress })
//   → ['removed 1 camera', …]

import { clearNodeTransform, dedup, meshopt, normals, prune, textureCompress, unweld } from '@gltf-transform/functions';
import sharp from 'sharp';
import { MeshoptEncoder } from './io.mjs';
import { inspect } from './inspect.mjs';

export async function autoFix(doc, { rules, type, scale = null, placeOrigin = false, paint = null, materials = {}, compress = true } = {}) {
  const root = doc.getRoot(), did = [];
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const isPart = type && type !== 'car';

  // what a game model mustn't have
  const counts = { cameras: 0, lights: 0, animations: 0, skins: 0, scenes: 0 };
  for (const node of root.listNodes()) {
    const had = node.getCamera() || node.getExtension('KHR_lights_punctual');
    if (node.getCamera()) { node.setCamera(null); }
    if (node.getExtension('KHR_lights_punctual')) { node.setExtension('KHR_lights_punctual', null); counts.lights++; }
    if (node.getSkin()) node.setSkin(null);
    // (the node a camera or light hung on, left empty: not a socket, so it goes)
    if (had && !node.getMesh() && !node.listChildren().length && !/^socket_/.test(node.getName())) node.dispose();
  }
  for (const c of root.listCameras()) { c.dispose(); counts.cameras++; }
  for (const a of root.listAnimations()) { a.dispose(); counts.animations++; }
  for (const s of root.listSkins()) { s.dispose(); counts.skins++; }
  root.listExtensionsUsed().find(e => e.extensionName === 'KHR_lights_punctual')?.dispose();
  for (const s of root.listScenes()) if (s !== scene) { s.dispose(); counts.scenes++; }
  if (scene) root.setDefaultScene(scene);
  const removed = Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${n} ${n === 1 ? k.replace(/s$/, '') : k}`);
  if (removed.length) did.push(`removed ${removed.join(', ')}`);
  for (const [from, to] of Object.entries(materials)) {
    const m = root.listMaterials().find(x => x.getName() === from);
    if (m) { m.setName(to); did.push(`renamed material "${from}" to "${to}"`); }
  }

  // a scale, and the origin where it belongs (parts: baked into the mesh)
  if (scene && scale && scale !== 1) {
    for (const n of scene.listChildren()) { n.setTranslation(n.getTranslation().map(v => v * scale)); n.setScale(n.getScale().map(v => v * scale)); }
    if (isPart) for (const n of scene.listChildren()) clearNodeTransform(n);
    did.push(`scaled by ${scale}`);
  }
  if (scene && isPart && placeOrigin) {
    const info = inspect(doc), t = rules.types[type], move = [0, 0, 0];
    if (info.bounds) {
      ['x', 'y', 'z'].forEach((ax, k) => {
        const rule = t.origin[ax] ?? 'within', lo = info.bounds.min[k], hi = info.bounds.max[k];
        move[k] = rule === 'centre' ? -(lo + hi) / 2 : rule === 'min' ? -lo : rule === 'max' ? -hi : rule === 'within' ? (lo > 0 ? -lo : hi < 0 ? -hi : 0) : 0;
      });
      if (move.some(v => Math.abs(v) > 1e-6)) {
        for (const n of scene.listChildren()) { const p = n.getTranslation(); n.setTranslation([p[0] + move[0], p[1] + move[1], p[2] + move[2]]); clearNodeTransform(n); }
        did.push(`moved the origin to ${t.attach} (the model moved ${move.map(v => +v.toFixed(3)).join(', ')} m)`);
      }
    }
  }

  // painted surfaces out of the texture, into the paint material
  if (paint?.colour) {
    const n = await splitPaint(doc, paint.colour, paint.tolerance ?? 40);
    if (n) did.push(`put ${n} triangle${n === 1 ? '' : 's'} textured like ${paint.colour} in the "paint" material`);
  }

  // normals where they're missing (flat: every face its own)
  const missing = root.listMeshes().flatMap(m => m.listPrimitives()).filter(p => !p.getAttribute('NORMAL')).length;
  if (missing) { await doc.transform(unweld(), normals({ overwrite: false })); did.push(`added normals to ${missing} mesh part${missing === 1 ? '' : 's'}`); }

  // unused and duplicate data (never an empty node: sockets are empty nodes)
  const before = stats(root);
  await doc.transform(prune({ keepLeaves: true, keepSolidTextures: true }), dedup({ keepUniqueNames: true }));
  const after = stats(root), gone = Object.entries(before).filter(([k, v]) => v > after[k]).map(([k, v]) => `${v - after[k]} ${k}`);
  if (gone.length) did.push(`removed unused or duplicate ${gone.join(', ')}`);

  // textures over the limit, shrunk
  const max = rules.textureMaxSize, big = root.listTextures().filter(t => t.getSize() && Math.max(...t.getSize()) > max);
  if (big.length) {
    const names = new Map(big.map((t, i) => [t, t.getName()]));
    big.forEach((t, i) => t.setName(`__shrink_${i}`));
    const was = big.map(t => t.getSize().join('×'));
    await doc.transform(textureCompress({ encoder: sharp, resize: [max, max], pattern: /^__shrink_/ }));
    for (const [t, name] of names) t.setName(name);
    did.push(`shrank ${big.map((t, i) => `${t.getName() || 'a texture'} ${was[i]} → ${t.getSize().join('×')}`).join(', ')}`);
  }

  // the geometry compressed
  if (compress && root.listAccessors().length && !root.listExtensionsUsed().some(e => e.extensionName === 'EXT_meshopt_compression')) {
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    did.push('compressed the geometry (meshopt)');
  }
  return did;
}

const stats = root => ({ meshes: root.listMeshes().length, materials: root.listMaterials().length, textures: root.listTextures().length, nodes: root.listNodes().length, accessors: root.listAccessors().length });

// Triangles whose texture colour (at their middle) is within `tolerance` of the paint colour go in a
// "paint" material (made if there isn't one). Returns how many moved.
async function splitPaint(doc, hex, tolerance) {
  const root = doc.getRoot(), target = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  let paint = root.listMaterials().find(m => m.getName() === 'paint'), moved = 0;
  const images = new Map();
  const pixels = async tex => {
    if (!images.has(tex)) images.set(tex, await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
    return images.get(tex);
  };
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
    const mat = prim.getMaterial(), tex = mat?.getBaseColorTexture(), UV = prim.getAttribute('TEXCOORD_0'), P = prim.getAttribute('POSITION');
    if (!mat || mat.getName() === 'paint' || !tex || !UV) continue;
    const { data, info } = await pixels(tex), factor = mat.getBaseColorFactor();
    const I = prim.getIndices(), n = I ? I.getCount() : P.getCount(), idx = i => I ? I.getScalar(i) : i;
    const keep = [], painted = [], uv = [];
    for (let t = 0; t + 2 < n; t += 3) {
      let u = 0, v = 0;
      for (let k = 0; k < 3; k++) { UV.getElement(idx(t + k), uv); u += uv[0] / 3; v += uv[1] / 3; }
      const x = Math.min(info.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * info.width))), y = Math.min(info.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * info.height)));
      const o = (y * info.width + x) * info.channels, c = [0, 1, 2].map(k => data[o + k] * linearToSrgb(factor[k]));
      (Math.hypot(c[0] - target[0], c[1] - target[1], c[2] - target[2]) <= tolerance ? painted : keep).push(idx(t), idx(t + 1), idx(t + 2));
    }
    if (!painted.length) continue;
    paint ??= doc.createMaterial('paint').setBaseColorFactor([...target.map(v => srgbToLinear(v / 255)), 1]).setMetallicFactor(0.1).setRoughnessFactor(0.4);
    moved += painted.length / 3;
    const indexOf = list => doc.createAccessor().setType('SCALAR').setArray(P.getCount() < 65535 ? new Uint16Array(list) : new Uint32Array(list)).setBuffer(P.getBuffer());
    if (!keep.length) { prim.setMaterial(paint); continue; }
    const other = prim.clone().setIndices(indexOf(painted)).setMaterial(paint);
    prim.setIndices(indexOf(keep));
    mesh.addPrimitive(other);
  }
  return moved;
}
const srgbToLinear = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const linearToSrgb = c => c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
