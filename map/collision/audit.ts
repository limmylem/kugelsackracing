// Map v4's rule: every collider has something drawn where it is, or is flagged as intentional in the data (a world
// edge wall, say). Checked for every tile at bake time (map/bake/bakeV4.ts fails if any breaks it), from the very
// colliders the game will make (map/render/physics.ts tileColliders, with a stand-in for Rapier):
//   terrain     the heightfield — the terrain meshes are cut from it (always drawn)
//   road        each collision triangle lies on the drawn road surface (the model's, this tile's or the next one's
//               across the border: the collision mesh reaches a little over it), within 2 cm in height, 3 cm in plan
//   paved/cover drawn as they are (car parks, tunnel roofs; Map v5's tunnel tubes, meshes.tunnel)
//   building    each convex piece's middle under a drawn roof (the tile's own roofs mesh: the footprint as drawn —
//               map v3's tiles move corners standing on a road's edge)
//   barrier     each box on a railing piece the tile draws (or flagged intentional: flags & 2)
//   tree        each trunk at a tree the tile draws
//
//   auditTile(tile, { cx, cz, surface, barriersCfg }) → [{ kind, at: [x, z], why }]

import { tileColliders } from '../render/physics.ts';

export const INTENTIONAL = 2;
const RING = Array.from({ length: 8 }, (_, a) => [Math.cos(a * Math.PI / 4) * 0.03, Math.sin(a * Math.PI / 4) * 0.03]);
// (Rapier's collider descriptions, as far as tileColliders uses them)
const desc = () => { const d: any = {}; d.setTranslation = () => d; d.setRotation = () => d; d.setFriction = () => d; d.setRestitution = () => d; return d; };
const FAKE = { TriMeshFlags: { FIX_INTERNAL_EDGES: 1 }, ColliderDesc: { heightfield: desc, trimesh: desc, convexHull: desc, cuboid: desc, cylinder: desc } };

export function auditTile(tile: any, { cx, cz, surface, barriersCfg }: { cx: number; cz: number; surface: any; barriersCfg: any }) {
  const bad: { kind: string; at: number[]; why: string }[] = [];
  const { pieces } = tileColliders(tile, FAKE, barriersCfg, { treeShare: 1 });
  const W = (x: number, z: number) => [+(x + cx).toFixed(2), +(z + cz).toFixed(2)];
  const trees = tile.lists.trees?.data ?? [];
  const treeAt = new Set<string>(); for (let k = 0; k < trees.length; k += 5) treeAt.add(`${Math.round(trees[k] * 10)},${Math.round(trees[k + 2] * 10)}`);
  const roofAt = underRoof(tile.meshes.roofs);
  const rails: number[][] = [];
  for (const [name, L] of Object.entries<any>(tile.lists)) if (name.startsWith('barrier_')) for (let k = 0; k < L.data.length; k += L.stride) rails.push([L.data[k], L.data[k + 2], L.data[k + 3], L.data[k + 5], L.data[k + 7]]);
  for (const p of pieces) {
    const s = p.shape, kind = p.userData.kind;
    if (kind === 'terrain' && s.type === 'heightfield') { if (!tile.heightfield) bad.push({ kind, at: [cx, cz], why: 'heightfield without terrain' }); continue; }
    if (kind === 'model') { const [x, , z] = s.centre, M = tile.lists.models?.data ?? []; let ok = false; for (let k = 0; k < M.length; k += 9) if (Math.hypot(M[k] - x, M[k + 2] - z) < 0.5) ok = true; if (!ok) bad.push({ kind, at: W(x, z), why: 'landmark collider with no model drawn there' }); continue; }
    if (kind === 'tunnel') { if (!tile.meshes.tunnel) bad.push({ kind, at: [cx, cz], why: 'tunnel collider without its mesh' }); continue; }
    if (kind === 'terrain' || p.userData.mesh === 'paved') { if (!tile.meshes[p.userData.mesh ?? 'cover']) bad.push({ kind, at: [cx, cz], why: `${p.userData.mesh} collider without its mesh` }); continue; }
    if (kind === 'road') {
      if (p.userData.mesh !== 'roadCollision') { if (!tile.meshes[p.userData.mesh]) bad.push({ kind, at: [cx, cz], why: 'road collider without a mesh' }); continue; }
      const P = s.positions, I = s.indices;
      for (let t = 0; t < I.length; t += 3) {
        const x = (P[I[t] * 3] + P[I[t + 1] * 3] + P[I[t + 2] * 3]) / 3, y = (P[I[t] * 3 + 1] + P[I[t + 1] * 3 + 1] + P[I[t + 2] * 3 + 1]) / 3, z = (P[I[t] * 3 + 2] + P[I[t + 1] * 3 + 2] + P[I[t + 2] * 3 + 2]) / 3;
        const area = Math.abs((P[I[t + 1] * 3] - P[I[t] * 3]) * (P[I[t + 2] * 3 + 2] - P[I[t] * 3 + 2]) - (P[I[t + 2] * 3] - P[I[t] * 3]) * (P[I[t + 1] * 3 + 2] - P[I[t] * 3 + 2]));
        if (area < 1e-4) continue;
        // (within 3 cm in plan: a sliver along the road's outer edge, its corners on the tiles' 1 cm grid, can sit just
        // outside the model's own edge)
        // (heightsAt null: somewhere it can't say — past the baked area's edge — not judged)
        const on = (dx: number, dz: number) => { const hs = surface.heightsAt(x + cx + dx, z + cz + dz); return hs === null || hs.some((h: any) => Math.abs(h.y - y) < 0.02); };
        if (!on(0, 0) && !RING.some(([dx, dz]) => on(dx, dz))) { bad.push({ kind, at: W(x, z), why: 'road collision triangle with no drawn road there' }); if (bad.length > 50) return bad; }
      }
      continue;
    }
    if (kind === 'building') {
      const pts = s.points, n = pts.length / 6;
      let x = 0, z = 0; for (let q = 0; q < n; q++) { x += pts[q * 6]; z += pts[q * 6 + 2]; }
      x /= n; z /= n;
      // (within 5 cm: the hull's corners are stored to 2 cm, the roof's to 1)
      if (!roofAt(x, z) && !RING.some(([dx, dz]) => roofAt(x + dx * 5 / 3, z + dz * 5 / 3))) bad.push({ kind, at: W(x, z), why: 'building collider under no drawn roof' });
      continue;
    }
    if (kind === 'barrier') {
      const [x, , z] = s.centre;
      const on = rails.some(([ax, az, bx, bz, flags]) => { if (flags & INTENTIONAL) return true; const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); return Math.hypot(x - ax - dx * t, z - az - dz * t) < 0.6; });
      if (!on) bad.push({ kind, at: W(x, z), why: 'railing collider with no railing drawn' });
      continue;
    }
    if (kind === 'tree') {
      const [x, , z] = s.centre;
      if (!treeAt.has(`${Math.round(x * 10)},${Math.round(z * 10)}`)) bad.push({ kind, at: W(x, z), why: 'trunk collider with no tree drawn' });
      continue;
    }
    bad.push({ kind: kind ?? 'other', at: [cx, cz], why: 'a collider of no known kind' });
  }
  return bad;
}

// is a point (tile-local) under any of a mesh's triangles, in plan? (a 4 m grid of them)
function underRoof(m: any) {
  const grid = new Map<string, number[]>(), C = 4;
  if (!m) return () => false;
  const P = m.positions, I = m.indices;
  for (let t = 0; t < I.length; t += 3) {
    const xs = [P[I[t] * 3], P[I[t + 1] * 3], P[I[t + 2] * 3]], zs = [P[I[t] * 3 + 2], P[I[t + 1] * 3 + 2], P[I[t + 2] * 3 + 2]];
    for (let a = Math.floor(Math.min(...xs) / C); a <= Math.floor(Math.max(...xs) / C); a++) for (let b = Math.floor(Math.min(...zs) / C); b <= Math.floor(Math.max(...zs) / C); b++) { const k = `${a},${b}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(t); }
  }
  return (x: number, z: number) => (grid.get(`${Math.floor(x / C)},${Math.floor(z / C)}`) ?? []).some(t => {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, d = (P[b + 2] - P[c + 2]) * (P[a] - P[c]) + (P[c] - P[b]) * (P[a + 2] - P[c + 2]);
    if (Math.abs(d) < 1e-12) return false;
    const l1 = ((P[b + 2] - P[c + 2]) * (x - P[c]) + (P[c] - P[b]) * (z - P[c + 2])) / d, l2 = ((P[c + 2] - P[a + 2]) * (x - P[c]) + (P[a] - P[c]) * (z - P[c + 2])) / d;
    return l1 >= -1e-6 && l2 >= -1e-6 && l1 + l2 <= 1 + 1e-6;
  });
}
