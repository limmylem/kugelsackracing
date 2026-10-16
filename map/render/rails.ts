// Map v5's railway track in a tile (lists.rails: [ax, ay, az, bx, by, bz, gauge, flags] — map/model/railways.ts):
// the ballast bed (one mesh), the rails and the sleepers (instanced boxes), a deck under a bridge's; in a road (flags
// & 1) the rails only, flush. The style pack's colours (manifest.furniture.style.railways).
//
//   const R = railObjects(tile, style)   (R.group, R.setDetail(d), R.dispose())

import * as THREE from 'three';

const IN_ROAD = 1, BRIDGE = 2;
let mats: Record<string, THREE.Material> | null = null;
const box = (w: number, h: number, d: number) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0); return g; };

export function railObjects(tile: any, style: any) {
  const L = tile.lists.rails?.data as Float32Array | undefined, group = new THREE.Group(), owned: any[] = [];
  group.name = 'rails';
  if (!L?.length) return { group, setDetail() {}, dispose() {} };
  const S = style ?? {};
  mats ??= { ballast: new THREE.MeshLambertMaterial({ color: S.ballast ?? '#8b8379' }), sleeper: new THREE.MeshLambertMaterial({ color: S.sleeper ?? '#5d5248' }), rail: new THREE.MeshLambertMaterial({ color: S.rail ?? '#7e8286' }), deck: new THREE.MeshLambertMaterial({ color: S.deck ?? '#a7a39b' }) };
  const n = L.length / 8, bed: number[] = [], bedIdx: number[] = [];
  let sleepers = 0, decks = 0;
  for (let k = 0; k < L.length; k += 8) { const len = Math.hypot(L[k + 3] - L[k], L[k + 5] - L[k + 2]); if (!(L[k + 7] & IN_ROAD)) sleepers += Math.max(1, Math.round(len / 0.9)); if (L[k + 7] & BRIDGE) decks++; }
  const railG = box(0.07, 0.15, 1), sleeperG = box(2.5, 0.16, 0.24), deckG = box(1, 0.9, 1);
  owned.push(railG, sleeperG, deckG);
  const rails = new THREE.InstancedMesh(railG, mats.rail, n * 2), sl = new THREE.InstancedMesh(sleeperG, mats.sleeper, Math.max(1, sleepers)), dk = new THREE.InstancedMesh(deckG, mats.deck, Math.max(1, decks));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), p = new THREE.Vector3(), s = new THREE.Vector3();
  let ri = 0, si = 0, di = 0;
  for (let k = 0; k < L.length; k += 8) {
    const ax = L[k], ay = L[k + 1], az = L[k + 2], bx = L[k + 3], by = L[k + 4], bz = L[k + 5], g = L[k + 6], f = L[k + 7], dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1e-3;
    const yaw = Math.atan2(dx, dz), pitch = -Math.atan2(by - ay, len), ux = dz / len, uz = -dx / len;
    e.set(pitch, yaw, 0); q.setFromEuler(e);
    // the rails: either side of the middle, half the gauge out
    for (const sd of [-1, 1]) { m4.compose(p.set((ax + bx) / 2 + ux * sd * g / 2, (ay + by) / 2 + (f & IN_ROAD ? -0.13 : 0.16), (az + bz) / 2 + uz * sd * g / 2), q, s.set(1, 1, len + 0.02)); rails.setMatrixAt(ri++, m4); }
    if (f & IN_ROAD) continue;
    // the sleepers, every 0.9 m; the ballast bed under them (a strip a little wider than the sleepers)
    const ns = Math.max(1, Math.round(len / 0.9));
    for (let t = 0; t < ns; t++) { const fr = (t + 0.5) / ns; m4.compose(p.set(ax + dx * fr, ay + (by - ay) * fr, az + dz * fr), q, s.set(g / 1.6, 1, 1)); sl.setMatrixAt(si++, m4); }
    const w = g / 2 + 1.1, base = bed.length / 3, drop = f & BRIDGE ? 0.05 : 0.32;
    bed.push(ax + ux * w, ay - drop, az + uz * w, bx + ux * w, by - drop, bz + uz * w, bx - ux * w, by - drop, bz - uz * w, ax - ux * w, ay - drop, az - uz * w, ax + ux * (w - 0.4), ay + 0.02, az + uz * (w - 0.4), bx + ux * (w - 0.4), by + 0.02, bz + uz * (w - 0.4), bx - ux * (w - 0.4), by + 0.02, bz - uz * (w - 0.4), ax - ux * (w - 0.4), ay + 0.02, az - uz * (w - 0.4));
    // (the bed's top, and its shoulders sloping down either side)
    bedIdx.push(base + 4, base + 5, base + 6, base + 4, base + 6, base + 7, base, base + 1, base + 5, base, base + 5, base + 4, base + 3, base + 7, base + 6, base + 3, base + 6, base + 2);
    // a bridge's deck under it
    if (f & BRIDGE) { m4.compose(p.set((ax + bx) / 2, (ay + by) / 2 - 1.0, (az + bz) / 2), q, s.set(g + 2.6, 1, len + 0.05)); dk.setMatrixAt(di++, m4); }
  }
  rails.count = ri; sl.count = si; dk.count = di;
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(bed, 3)); bg.setIndex(bedIdx); bg.computeVertexNormals(); bg.computeBoundingSphere(); owned.push(bg);
  const bedM = new THREE.Mesh(bg, mats.ballast);
  bedM.material.side = THREE.DoubleSide;
  for (const o of [bedM, rails, sl, dk]) { o.matrixAutoUpdate = false; (o as any).receiveShadow = true; group.add(o); }
  rails.castShadow = sl.castShadow = dk.castShadow = true;
  return {
    group,
    // (sleepers only near: far off, the bed and the rails are enough)
    setDetail(d: number) { sl.visible = d < 350; group.visible = d < 2500; },
    dispose() { for (const g of owned) g.dispose(); rails.dispose(); sl.dispose(); dk.dispose(); group.removeFromParent(); },
  };
}
