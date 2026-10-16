// A baked tile's collision, from its decoded arrays (world/tileFormat.js) — the same ones it's drawn
// from: the heightfield; the road, car park and tunnel-roof meshes as triangle meshes; each building's
// convex pieces, foot to eaves; every railing and wall as chained boxes (world/barriers.js: thick,
// taller than drawn, overlapping at the joints); tree trunks as cylinders. Ground first (what the car
// needs before anything else). Pure apart from Rapier: the game (world/streamer.js) and the tests use it.
//
// Each piece says what it is (userData.kind: terrain, road, building, barrier, tree, other) and carries its
// shape (piece.shape) for the debug views' collider wireframes (map/render/debug.ts) and the bake's check that
// every collider has something drawn there (map/collision/audit.ts). Map v4 tiles (header.map === 'v4') bring
// their own road collision mesh (meshes.roadCollision: the drawn road plus a strip of its neighbours' past the
// tile's edge — no seam a wheel can catch on) with Rapier's internal-edge fix, and tree trunks only for the
// trees drawn (the graphics settings' scenery thins them: treeShare).
//
//   tileColliders(tile, RAPIER, barriersCfg, { treeShare }) → { pieces: [{ desc, userData, shape }], ground }

import { barrierBoxes } from '../format/barriers.ts';

export function tileColliders(d: any, RAPIER: any, B: any, { treeShare = 1 } = {}) {
  const out: any[] = [], v4 = d.header?.map === 'v4' || d.header?.map === 'v5';
  const flags = v4 && RAPIER.TriMeshFlags ? RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES : undefined;
  const trimesh = (m: any) => (flags !== undefined ? RAPIER.ColliderDesc.trimesh(m.positions, m.indices, flags) : RAPIER.ColliderDesc.trimesh(m.positions, m.indices));
  if (d.heightfield) out.push({ desc: RAPIER.ColliderDesc.heightfield(d.heightfield.n, d.heightfield.n, d.heightfield.heights, { x: d.heightfield.size, y: 1, z: d.heightfield.size }), userData: { material: 'ground', kind: 'terrain' }, shape: { type: 'heightfield', hf: d.heightfield } });
  const groundMeshes = v4 ? ['roadCollision', 'paved', 'paths', 'cover'] : ['roads', 'paved', 'paths', 'cover'];
  // (Map v5: a road or car park collider knows each triangle's surface — userData.surfaces { names, data } — for the
  // tyres: what the wheel's ray hit is what it's on, never the ground's raster under it)
  const names = d.header?.surfaceNames;
  for (const name of groundMeshes) { const m = d.meshes[name]; if (m) out.push({ desc: trimesh(m), userData: { material: 'ground', kind: name === 'cover' ? 'terrain' : 'road', mesh: name, ...(names && m.surfaces && name !== 'cover' && { surfaces: { names, data: m.surfaces, positions: m.positions, indices: m.indices } }) }, shape: { type: 'trimesh', positions: m.positions, indices: m.indices } }); }
  const ground = out.length;
  // buildings: each convex piece, foot to eaves
  const H = d.lists.hulls?.data;
  if (H) for (let k = 0; k < H.length;) {
    const n = H[k], y0 = H[k + 1], y1 = H[k + 2], pts = new Float32Array(n * 6);
    for (let q = 0; q < n; q++) { const x = H[k + 3 + q * 2], z = H[k + 4 + q * 2]; pts.set([x, y0, z, x, y1, z], q * 6); }
    k += 3 + n * 2;
    const desc = RAPIER.ColliderDesc.convexHull(pts);
    if (desc) out.push({ desc, userData: { material: 'concrete', sound: 'building', kind: 'building' }, shape: { type: 'prism', points: pts } });
  }
  // (Map v5: a railway platform — solid)
  if (d.meshes.platforms) out.push({ desc: trimesh(d.meshes.platforms), userData: { material: 'concrete', sound: 'building', kind: 'platform', mesh: 'platforms' }, shape: { type: 'trimesh', positions: d.meshes.platforms.positions, indices: d.meshes.platforms.indices } });
  // (Map v5: a tunnel's tube — walls, ceiling, portals — solid all round)
  if (d.meshes.tunnel) out.push({ desc: trimesh(d.meshes.tunnel), userData: { material: 'concrete', sound: 'building', kind: 'tunnel', mesh: 'tunnel' }, shape: { type: 'trimesh', positions: d.meshes.tunnel.positions, indices: d.meshes.tunnel.indices } });
  // (Map v5: a hand-made landmark with a box — lists.models — solid as that box round its anchor)
  const Md = d.lists.models?.data;
  if (Md) for (let k = 0; k < Md.length; k += 9) { const w = Md[k + 6], h = Md[k + 7], dd = Md[k + 8]; if (!(w > 0 && h > 0 && dd > 0)) continue; const yaw = Md[k + 3], s = Md[k + 4], rot = { x: 0, y: Math.sin(-yaw / 2), z: 0, w: Math.cos(-yaw / 2) }, centre: [number, number, number] = [Md[k], Md[k + 1] + h * s / 2, Md[k + 2]]; out.push({ desc: RAPIER.ColliderDesc.cuboid(w * s / 2, h * s / 2, dd * s / 2).setTranslation(...centre).setRotation(rot), userData: { material: 'concrete', sound: 'building', kind: 'model' }, shape: { type: 'box', halfExtents: [w * s / 2, h * s / 2, dd * s / 2], centre, rotation: rot } }); }
  // railings and walls (and v4's intentional ones: flagged in the data, drawn or not)
  for (const [name, L] of Object.entries<any>(d.lists)) {
    if (!name.startsWith('barrier_')) continue;
    for (const b of barrierBoxes(name.slice(8), L.data, B, L.stride)) out.push({ desc: RAPIER.ColliderDesc.cuboid(...b.halfExtents).setTranslation(...b.centre).setRotation(b.rotation).setFriction(B.friction).setRestitution(B.restitution), userData: { material: b.material, kind: 'barrier' }, shape: { type: 'box', halfExtents: b.halfExtents, centre: b.centre, rotation: b.rotation } });
  }
  // tree trunks (v4: only the trees drawn — the first treeShare of them, in the order the drawing thins them)
  const Tr = d.lists.trees?.data;
  if (Tr) {
    const list = v4 ? drawnTrees(Tr, treeShare) : Array.from({ length: Tr.length / 5 }, (_, q) => q).filter(q => ((Tr[q * 5 + 4] | 0) & 7) !== 2);
    for (const q of list) {
      const k = q * 5, h = Tr[k + 3] * 4 * 0.6, r = v4 ? 0.2 : 0.25;
      out.push({ desc: RAPIER.ColliderDesc.cylinder(h / 2 + 0.5, r).setTranslation(Tr[k], Tr[k + 1] + h / 2 - 0.5, Tr[k + 2]), userData: { material: 'wood', sound: 'tree', kind: 'tree' }, shape: { type: 'cylinder', half: h / 2 + 0.5, radius: r, centre: [Tr[k], Tr[k + 1] + h / 2 - 0.5, Tr[k + 2]] } });
    }
  }
  return { pieces: out, ground };
}

// the trees drawn at a scenery share (map/render/objects.ts): each kind in its shuffled order (the same every
// time), the first round(n · share) of each
// (kinds: 0 broadleaf, 1 conifer, 2 a low garden plant, 3 a eucalypt, 4 a palm — Map v5's)
export const TREE_KINDS = 5;
export function treeKinds(Tr: ArrayLike<number>) {
  const kinds: number[][] = Array.from({ length: TREE_KINDS }, () => []);
  // (+ 8: estimated — map/model/vegetation.ts TREE_ESTIMATED — drawn the same)
  for (let k = 0; k < Tr.length; k += 5) kinds[Math.min(TREE_KINDS - 1, Math.max(0, (Tr[k + 4] | 0) & 7))].push(k);
  kinds.forEach((list, kind) => { for (let a = list.length - 1, r = list.length * 7919 + kind; a > 0; a--) { r = (r * 16807) % 2147483647; const b = r % (a + 1); [list[a], list[b]] = [list[b], list[a]]; } });
  return kinds;
}
// (a garden's low plants — kind 2 — are drawn but have no trunk to hit: intentionally no collider)
export function drawnTrees(Tr: ArrayLike<number>, share = 1) {
  const f = Math.min(1, Math.max(0, share));
  return treeKinds(Tr).flatMap((list, kind) => (kind === 2 ? [] : list.slice(0, Math.max(0, Math.round(list.length * f))).map(k => k / 5)));
}
