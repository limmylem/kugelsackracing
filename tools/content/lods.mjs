// Levels of detail for a model (Phase 8 Step 3; docs/CONTENT_PIPELINE.md): each mesh made again with fewer triangles
// (meshoptimizer's simplifier) for when it's drawn far away. They go in a second scene named "lods" — one node per
// mesh and level, named <mesh's node>__lod<level>, its extras saying which node it stands for (lodOf) — so everything
// that reads the model's own scene sees it as it was; the game (garage/visual.js) draws a far car in one piece from
// them. A model that brings its own (Blender objects named <name>__lod1…) keeps those: they're moved to the lods scene
// and checked against their budget like made ones.
//
//   const r = await makeLods(doc, rules.lods)   → { levels: [{ level, ratio, triangles, budget, own }], base }

import { MeshoptSimplifier } from 'meshoptimizer';

export const LOD_SCENE = 'lods';
export const LOD_NAME = /^(.*)__lod(\d+)$/;
const TRIANGLES = 4;

// rules: { levels: [{ ratio, error }] } (model-rules.json lods)
export async function makeLods(doc, rules) {
  await MeshoptSimplifier.ready;
  const root = doc.getRoot(), scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) return { levels: [], base: 0 };
  // (made again: an old lods scene goes)
  for (const s of root.listScenes()) if (s.getName() === LOD_SCENE) { for (const n of s.listChildren()) n.dispose(); s.dispose(); }
  const lodScene = doc.createScene(LOD_SCENE);
  const nodes = [];
  scene.traverse(n => nodes.push(n));
  // (the model's own LODs, out of its scene)
  const own = nodes.filter(n => LOD_NAME.test(n.getName()) && n.getMesh());
  // (every mesh's node named, and named once: the game finds a node's LODs by its name)
  const used = new Map();
  for (const n of nodes) {
    if (!n.getMesh() || own.includes(n)) continue;
    let name = n.getName() || n.getMesh().getName() || 'mesh';
    if (used.has(name)) { let k = used.get(name) + 1; while (used.has(`${name}_${k}`)) k++; used.set(name, k); name = `${name}_${k}`; }
    used.set(name, used.get(name) ?? 1);
    n.setName(name);
  }
  const baseNodes = nodes.filter(n => n.getMesh() && !own.includes(n));
  const base = baseNodes.reduce((a, n) => a + triangles(n.getMesh()), 0);
  const levels = rules.levels.map((L, i) => ({ level: i + 1, ratio: L.ratio, triangles: 0, budget: null, own: false }));
  for (const n of own) {
    const [, of, lv] = n.getName().match(LOD_NAME), L = levels[+lv - 1];
    if (!L) continue;
    const m = n.getWorldMatrix(), copy = doc.createNode(n.getName()).setMesh(n.getMesh()).setMatrix(m).setExtras({ lodOf: of, lod: +lv });
    lodScene.addChild(copy);
    L.triangles += triangles(n.getMesh()); L.own = true;
    n.setMesh(null); n.dispose();
  }
  for (const L of levels) {
    if (L.own) continue;
    const spec = rules.levels[L.level - 1];
    for (const n of baseNodes) {
      const mesh = doc.createMesh(`${n.getMesh().getName() || n.getName()}__lod${L.level}`);
      for (const prim of n.getMesh().listPrimitives()) {
        const p = simplified(doc, prim, spec);
        if (p) mesh.addPrimitive(p);
      }
      if (!mesh.listPrimitives().length) { mesh.dispose(); continue; }
      L.triangles += triangles(mesh);
      lodScene.addChild(doc.createNode(`${n.getName()}__lod${L.level}`).setMesh(mesh).setMatrix(n.getWorldMatrix()).setExtras({ lodOf: n.getName(), lod: L.level }));
    }
  }
  if (!lodScene.listChildren().length) lodScene.dispose();
  return { levels, base };
}

// A primitive with fewer triangles: its positions joined where they meet (a flat-shaded model's corners are split per
// face, and a simplifier can't take apart what isn't joined), simplified to ratio of its triangles (or as near as the
// error allows: a fraction of the mesh's size), with smooth normals. Only what a far car needs: no texture coordinates
// (a far car is drawn in its materials' colours). null: nothing left to draw
function simplified(doc, prim, { ratio, error = 0.02 }) {
  if (prim.getMode() !== TRIANGLES) return null;
  const P = prim.getAttribute('POSITION'), I = prim.getIndices();
  if (!P) return null;
  const n = I ? I.getCount() : P.getCount(), el = [];
  // (positions joined: by where they are, to a tenth of a millimetre — in the mesh's own units)
  let size = 0;
  for (let i = 0; i < P.getCount(); i++) { P.getElement(i, el); for (const v of el) size = Math.max(size, Math.abs(v)); }
  const q = (size || 1) * 1e-5, keys = new Map(), pos = [], idx = new Uint32Array(n);
  for (let t = 0; t < n; t++) {
    const i = I ? I.getScalar(t) : t;
    P.getElement(i, el);
    const k = `${Math.round(el[0] / q)},${Math.round(el[1] / q)},${Math.round(el[2] / q)}`;
    let j = keys.get(k);
    if (j === undefined) { keys.set(k, j = pos.length / 3); pos.push(el[0], el[1], el[2]); }
    idx[t] = j;
  }
  const positions = new Float32Array(pos), target = Math.max(3, Math.floor(ratio * n / 3) * 3);
  // (if it can't get near within the error, a looser one: up to 5× — a far car is small on the screen)
  let tris = MeshoptSimplifier.simplify(idx, positions, 3, target, error, [])[0];
  for (let e = error * 2; tris.length > target * 1.5 && e <= error * 5; e *= 2) tris = MeshoptSimplifier.simplify(idx, positions, 3, target, e, [])[0];
  if (tris.length < 3) return null;
  // (only the vertices the triangles use)
  const remap = new Int32Array(positions.length / 3).fill(-1), P2 = [], I2 = new Uint32Array(tris.length);
  for (let t = 0; t < tris.length; t++) {
    const i = tris[t];
    if (remap[i] < 0) { remap[i] = P2.length / 3; P2.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]); }
    I2[t] = remap[i];
  }
  const N = smoothNormals(P2, I2), count = P2.length / 3;
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  return doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', new Float32Array(P2)))
    .setAttribute('NORMAL', acc('VEC3', N))
    .setIndices(acc('SCALAR', count <= 65534 ? new Uint16Array(I2) : I2))
    .setMaterial(prim.getMaterial());
}

function smoothNormals(P, I) {
  const N = new Float32Array(P.length);
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;     // (area-weighted)
    for (const v of [a, b, c]) { N[v * 3] += nx; N[v * 3 + 1] += ny; N[v * 3 + 2] += nz; }
  }
  for (let v = 0; v < N.length; v += 3) {
    const l = Math.hypot(N[v], N[v + 1], N[v + 2]) || 1;
    N[v] /= l; N[v + 1] /= l; N[v + 2] /= l;
    if (!N[v] && !N[v + 1] && !N[v + 2]) N[v + 1] = 1;
  }
  return N;
}

export function triangles(mesh) {
  let n = 0;
  for (const p of mesh.listPrimitives()) if (p.getMode() === TRIANGLES) n += Math.floor((p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0) / 3);
  return n;
}
