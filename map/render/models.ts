// Map v5's hand-made landmarks in a tile (lists.models: [x, y, z, yaw, scale, file (the manifest's models[]), box
// width, height, depth (0: drawn only)] — map/model/landmarks.ts): each glTF loaded once (cached by its address),
// a copy placed for each, added to the tile's group when it's in.
//
//   const M = modelObjects(tile, { list: manifest.models, base })   (M.group; M.dispose())

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const MODEL_STRIDE = 9;
const cache = new Map<string, Promise<THREE.Object3D | null>>();
let loader: GLTFLoader | null = null;
const load = (url: string) => {
  if (!cache.has(url)) cache.set(url, (loader ??= new GLTFLoader()).loadAsync(url).then(g => g.scene).catch(e => { console.warn(`Landmark model ${url}: ${e?.message ?? e}`); return null; }));
  return cache.get(url)!;
};

export function modelObjects(tile: any, cfg: { list: any[]; base: string } | null) {
  const group = new THREE.Group(), L = tile.lists.models?.data as Float32Array | undefined;
  group.name = 'models';
  let gone = false;
  if (L && cfg?.list?.length) for (let k = 0; k < L.length; k += MODEL_STRIDE) {
    const m = cfg.list[L[k + 5] | 0];
    if (!m) continue;
    const x = L[k], y = L[k + 1], z = L[k + 2], yaw = L[k + 3], s = L[k + 4];
    load(cfg.base + m.file).then(scene => {
      if (!scene || gone) return;
      const o = scene.clone(true);
      o.position.set(x, y, z); o.rotation.y = -yaw; o.scale.setScalar(s);
      o.traverse((c: any) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
      o.updateMatrixWorld(true);
      group.add(o);
    });
  }
  // (the models' geometry is shared by every copy: kept, the copies dropped)
  return { group, dispose() { gone = true; group.clear(); } };
}
