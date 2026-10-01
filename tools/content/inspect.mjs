// What's in a model (a gltf-transform Document), in the numbers the checks, the importer and the icon
// renderer work from: its triangles (in the scene's frame, each with its material), its bounds and
// volume (and whether it's closed, so the volume means something), its materials and textures, its
// socket nodes (where they are and which way they face), and what a game model mustn't have.

const TRIANGLES = 4;
const TEXTURE_GETTERS = ['getBaseColorTexture', 'getEmissiveTexture', 'getNormalTexture', 'getMetallicRoughnessTexture', 'getOcclusionTexture'];

const apply = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
const dirOf = (m, k) => { const v = [m[4 * k], m[4 * k + 1], m[4 * k + 2]], l = Math.hypot(...v) || 1; return v.map(x => x / l); };

export function inspect(doc) {
  const root = doc.getRoot(), scene = root.getDefaultScene() ?? root.listScenes()[0] ?? null;
  const info = {
    scenes: root.listScenes().length, cameras: root.listCameras().length, animations: root.listAnimations().length, skins: root.listSkins().length, lights: 0,
    extensions: root.listExtensionsUsed().map(e => e.extensionName),
    materials: root.listMaterials().map(m => ({ name: m.getName(), textured: TEXTURE_GETTERS.some(g => m[g]?.()), colour: m.getBaseColorFactor(), metalness: m.getMetallicFactor(), roughness: m.getRoughnessFactor() })),
    textures: root.listTextures().map(t => ({ name: t.getName() || t.getURI() || '(unnamed)', mime: t.getMimeType(), size: t.getSize(), bytes: t.getImage()?.byteLength ?? 0 })),
    primitives: [], triangles: [], sockets: [], nodes: [], emptyNodes: [],
    bounds: null, volume: 0, centroid: [0, 0, 0], closed: false, otherModes: 0,
  };
  if (!scene) return finish(info);
  const walk = node => {
    const m = node.getWorldMatrix(), name = node.getName();
    info.nodes.push(name);
    if (node.getExtension('KHR_lights_punctual')) info.lights++;
    if (/socket/i.test(name)) info.sockets.push({ name, position: apply(m, [0, 0, 0]), axes: [0, 1, 2].map(k => dirOf(m, k)), node });
    const mesh = node.getMesh();
    if (!mesh && !node.listChildren().length && !node.getCamera()) info.emptyNodes.push(name);
    for (const prim of mesh?.listPrimitives() ?? []) {
      const mat = prim.getMaterial(), matName = mat?.getName() ?? '(no material)', P = prim.getAttribute('POSITION');
      const entry = { mesh: mesh.getName() || name, node: name, material: matName, textured: !!mat && TEXTURE_GETTERS.some(g => mat[g]?.()), normals: !!prim.getAttribute('NORMAL'), uvs: !!prim.getAttribute('TEXCOORD_0'), triangles: 0 };
      info.primitives.push(entry);
      if (prim.getMode() !== TRIANGLES || !P) { info.otherModes++; continue; }
      const I = prim.getIndices(), n = I ? I.getCount() : P.getCount(), UV = prim.getAttribute('TEXCOORD_0'), el = [], uv = [];
      for (let t = 0; t + 2 < n; t += 3) {
        const idx = [0, 1, 2].map(k => I ? I.getScalar(t + k) : t + k);
        info.triangles.push({ p: idx.map(i => apply(m, P.getElement(i, el))), uv: UV ? idx.map(i => UV.getElement(i, uv).slice(0, 2)) : null, material: matName, mat, prim });
        entry.triangles++;
      }
    }
    for (const c of node.listChildren()) walk(c);
  };
  for (const n of scene.listChildren()) walk(n);
  return finish(info);
}

function finish(info) {
  const T = info.triangles;
  if (T.length) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    let vol = 0; const c = [0, 0, 0];
    for (const { p: [a, b, d] } of T) {
      for (const v of [a, b, d]) for (let k = 0; k < 3; k++) { if (v[k] < min[k]) min[k] = v[k]; if (v[k] > max[k]) max[k] = v[k]; }
      // (signed volume of the tetrahedron from the origin: summed over a closed surface, its volume)
      const v6 = a[0] * (b[1] * d[2] - b[2] * d[1]) - a[1] * (b[0] * d[2] - b[2] * d[0]) + a[2] * (b[0] * d[1] - b[1] * d[0]);
      vol += v6 / 6;
      for (let k = 0; k < 3; k++) c[k] += v6 / 6 * (a[k] + b[k] + d[k]) / 4;
    }
    info.bounds = { min, max, size: max.map((v, k) => v - min[k]), centre: max.map((v, k) => (v + min[k]) / 2) };
    info.volume = Math.abs(vol);
    info.centroid = Math.abs(vol) > 1e-9 ? c.map(x => x / vol) : info.bounds.centre;
    // closed: (nearly) every edge is shared by two triangles, matching vertices by position
    const key = v => v.map(x => Math.round(x * 1e4)).join(','), edges = new Map();
    for (const { p } of T) for (let k = 0; k < 3; k++) {
      const a = key(p[k]), b = key(p[(k + 1) % 3]);
      if (a === b) continue;
      const e = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
    const shared = [...edges.values()].filter(n => n % 2 === 0).length;
    info.closed = edges.size > 0 && shared / edges.size > 0.95;
  }
  info.triangleCount = T.length;
  return info;
}

// A size in words: 1.42 × 0.18 × 0.36 m
export const sizeText = s => `${s.map(v => fmtM(v)).join(' × ')} m`;
export const fmtM = v => Math.abs(v) >= 10 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3).replace(/0$/, '');
