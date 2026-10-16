// Map v5's railways (Step 5; MAP_README.md, 'Railways'): what OSM maps as railway=rail, light_rail, tram and
// narrow_gauge (not in tunnels), drawn —
//
//  · the track: two rails `gauge` apart (the line's tag, else the style pack's: Adelaide's broad gauge, its trams'
//    standard) on sleepers on a ballast bed, on the ground; where a road's surface is under it (a tram line in the
//    street, a level crossing) flush in the road, rails only; on a bridge, on a deck (drawn: nothing floats), its
//    height eased between the bridge's ends
//  · level crossings: where a line crosses a road at grade (OSM's copy here has none of its level_crossing points:
//    found from the geometry, so estimated), a boom gate either side on the road's verge, facing its traffic
//  · platforms: railway=platform areas (a concrete slab platformHeight m up, solid) and lines (a slab
//    platformWidth m wide along it)
//  · overhead wiring where the line's electrified (electrified=contact_line, or the style pack's tramsElectrified for
//    trams off the road): masts every mastSpacing m beside it, the contact wire between them (estimated)
//
//   railways({ lines, areas, groundAt, surface, segs, style, cfg, box }) →
//     { pieces: [ax, ay, az, bx, by, bz, gauge, flags …] (flags: 1 in a road, 2 on a bridge),
//       platforms: { positions, colours, indices }, items (furniture rows), wires, stats }

import earcut from 'earcut';
import { FURN } from '../format/furniture.ts';

export const RAIL_IN_ROAD = 1, RAIL_BRIDGE = 2;
const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export function railways({ lines, areas, groundAt, surface, segs, style, cfg, box }: { lines: any[]; areas: any[]; groundAt: (x: number, z: number) => number; surface: any; segs: any[]; style: any; cfg: any; box: number[] }) {
  const R = cfg.railways, S = style.railways, pieces: number[] = [], items: number[] = [], wires: number[] = [], stats = { km: 0, inRoad: 0, bridges: 0, crossings: 0, platforms: 0, masts: 0 };
  const plat = { positions: [] as number[], colours: [] as number[], indices: [] as number[] }, cPlat = hex(S.platform), cEdge = hex(S.platformEdge);
  const inBox = (x: number, z: number) => x >= box[0] && x < box[2] && z >= box[1] && z < box[3];
  // (the road surface right there, if it's about the ground's height: a tram line in the street, a level crossing)
  const roadY = (x: number, z: number) => { const g = groundAt(x, z), hs = (surface.heightsAt(x, z) as any[]).filter(h => !h.part && Math.abs(h.y - g) < R.roadNear); return hs.length ? Math.max(...hs.map(h => h.y)) : null; };
  for (const l of lines) {
    const t = l.tags;
    if (!R.kinds.includes(t.railway) || (t.tunnel && t.tunnel !== 'no')) continue;
    const pts = l.nodes.map((p: any) => [p.x, p.z]);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    if (x1 < box[0] - 50 || x0 > box[2] + 50 || z1 < box[1] - 50 || z0 > box[3] + 50) continue;
    const gauge = (Number(String(t.gauge ?? '').split(';')[0]) || (t.railway === 'tram' || t.railway === 'light_rail' ? S.tramGauge : t.railway === 'narrow_gauge' ? S.narrowGauge : S.gauge)) / 1000;
    const bridge = !!t.bridge && t.bridge !== 'no';
    // (on a bridge: its height eased from end to end, the ends on the ground)
    let L = 0; const sAt: number[] = [0]; for (let k = 1; k < pts.length; k++) { L += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); sAt.push(L); }
    const yA = groundAt(pts[0][0], pts[0][1]), yB = groundAt(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    const yOn = (x: number, z: number, s: number) => { if (bridge) return { y: yA + (yB - yA) * (L > 0 ? s / L : 0), flags: RAIL_BRIDGE }; const r = roadY(x, z); return r !== null ? { y: r + 0.01, flags: RAIL_IN_ROAD } : { y: groundAt(x, z) + R.ballast, flags: 0 }; };
    const electrified = t.electrified === 'contact_line' || (S.tramsElectrified && (t.railway === 'tram' || t.railway === 'light_rail'));
    let sinceMast = R.mastSpacing / 2, lastMast: number[] | null = null;
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1], segL = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(segL / R.piece));
      for (let q = 0; q < n; q++) {
        const f0 = q / n, f1 = (q + 1) / n, px = ax + (bx - ax) * f0, pz = az + (bz - az) * f0, qx = ax + (bx - ax) * f1, qz = az + (bz - az) * f1, mx = (px + qx) / 2, mz = (pz + qz) / 2;
        if (!inBox(mx, mz)) { sinceMast += segL / n; continue; }
        const a = yOn(px, pz, sAt[k] + segL * f0), b = yOn(qx, qz, sAt[k] + segL * f1), flags = a.flags & b.flags || (a.flags | b.flags) & RAIL_BRIDGE;
        pieces.push(px, a.y, pz, qx, b.y, qz, gauge, flags);
        stats.km += segL / n / 1000; if (flags & RAIL_IN_ROAD) stats.inRoad++;
        // (overhead wiring: masts beside a line off the road, the wire between them)
        sinceMast += segL / n;
        if (electrified && !(flags & RAIL_IN_ROAD) && sinceMast >= R.mastSpacing) {
          const ux = (qx - px) / (segL / n || 1), uz = (qz - pz) / (segL / n || 1), mx2 = qx - uz * R.mastOffset, mz2 = qz + ux * R.mastOffset, y = b.y - (flags & RAIL_BRIDGE ? 0 : R.ballast);
          if (!surface.near(mx2, mz2, 0.5)) {
            items.push(mx2, y, mz2, Math.atan2(uz, -ux), FURN.catenaryMast, 0, R.wireHeight, 1);
            const wx = qx, wz = qz, wy = b.y + R.wireHeight;
            if (lastMast) wires.push(lastMast[0], lastMast[1], lastMast[2], wx, wy, wz);
            lastMast = [wx, wy, wz]; sinceMast = 0; stats.masts++;
          }
        } else if (flags & RAIL_IN_ROAD) lastMast = null;
      }
    }
    if (bridge) stats.bridges++;
  }
  // ---- level crossings: a line at grade over a road — booms either side on the road's verge, facing its traffic
  const rails = lines.filter(l => R.kinds.includes(l.tags.railway) && !(l.tags.bridge && l.tags.bridge !== 'no') && !(l.tags.tunnel && l.tags.tunnel !== 'no') && l.tags.railway !== 'tram');
  const cross = (a: number[], b: number[], c: number[], d: number[]) => { const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0]; if (Math.abs(den) < 1e-9) return null; const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den; return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null; };
  const done: number[][] = [];
  // (the rails' pieces by 64 m cells, those near the box only)
  const RC = 64, rgrid = new Map<string, number[][]>();
  for (const l of rails) for (let q = 0; q + 1 < l.nodes.length; q++) {
    const a = l.nodes[q], b = l.nodes[q + 1];
    if (Math.max(a.x, b.x) < box[0] - 20 || Math.min(a.x, b.x) > box[2] + 20 || Math.max(a.z, b.z) < box[1] - 20 || Math.min(a.z, b.z) > box[3] + 20) continue;
    for (let i = Math.floor(Math.min(a.x, b.x) / RC); i <= Math.floor(Math.max(a.x, b.x) / RC); i++) for (let j = Math.floor(Math.min(a.z, b.z) / RC); j <= Math.floor(Math.max(a.z, b.z) / RC); j++) { const k = `${i},${j}`; (rgrid.get(k) ?? rgrid.set(k, []).get(k)!).push([a.x, a.z, b.x, b.z]); }
  }
  for (const g of segs) {
    if (g.internal || g.structure !== 'ground' || R.noCrossing.includes(g.cls)) continue;
    for (let k = 0; k + 1 < g.xs.length; k++) {
      const near = new Set<number[]>();
      for (let i = Math.floor(Math.min(g.xs[k], g.xs[k + 1]) / RC); i <= Math.floor(Math.max(g.xs[k], g.xs[k + 1]) / RC); i++) for (let j = Math.floor(Math.min(g.zs[k], g.zs[k + 1]) / RC); j <= Math.floor(Math.max(g.zs[k], g.zs[k + 1]) / RC); j++) for (const r of rgrid.get(`${i},${j}`) ?? []) near.add(r);
      for (const r of near) {
        const hit = cross([g.xs[k], g.zs[k]], [g.xs[k + 1], g.zs[k + 1]], [r[0], r[1]], [r[2], r[3]]);
        if (!hit) continue;
        const cx = g.xs[k] + (g.xs[k + 1] - g.xs[k]) * hit.t, cz = g.zs[k] + (g.zs[k + 1] - g.zs[k]) * hit.t;
        if (!inBox(cx, cz) || done.some(d => Math.hypot(d[0] - cx, d[1] - cz) < 15)) continue;
        done.push([cx, cz]); stats.crossings++;
        const tx = g.xs[k + 1] - g.xs[k], tz = g.zs[k + 1] - g.zs[k], tl = Math.hypot(tx, tz) || 1, ux = tx / tl, uz = tz / tl, left = style.drivingSide !== 'right';
        // (each way along the road: the boom before the line, on the driving side, facing the traffic coming)
        for (const dir of g.oneway ? [1] : [1, -1]) {
          const fx = ux * dir, fz = uz * dir, sx = left ? fz : -fz, sz = left ? -fx : fx, hw = (left === (dir > 0) ? g.hwL?.[k] : g.hwR?.[k]) ?? g.visual / 2;
          const bx = cx - fx * R.boomBack + sx * (hw + R.boomOut), bz = cz - fz * R.boomBack + sz * (hw + R.boomOut);
          if (surface.near(bx, bz, 0.4)) continue;
          items.push(bx, groundAt(bx, bz), bz, Math.atan2(-fx, -fz), FURN.boomGate, 0, hw * 2, 1);
        }
      }
    }
  }
  // ---- platforms: a slab, solid — its top, its sides; OSM's areas, and its lines (a slab along them)
  const slab = (ring: number[][]) => {
    let x = 0, z = 0; for (const p of ring) { x += p[0]; z += p[1]; } x /= ring.length; z /= ring.length;
    if (!inBox(x, z)) return;
    const top = groundAt(x, z) + R.platformHeight, base = plat.positions.length / 3;
    for (const [px, pz] of ring) { plat.positions.push(px, top, pz); plat.colours.push(cPlat[0], cPlat[1], cPlat[2], 255); }
    const tris = earcut(ring.flat());
    for (let t = 0; t < tris.length; t += 3) { const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]], A = ring[a], B = ring[b], C = ring[c], ny = (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]); plat.indices.push(...(ny < 0 ? [base + a, base + c, base + b] : [base + a, base + b, base + c])); }
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length], ga = groundAt(ax, az) - 0.2, gb = groundAt(bx, bz) - 0.2, v = plat.positions.length / 3;
      plat.positions.push(ax, ga, az, bx, gb, bz, bx, top, bz, ax, top, az); for (let q = 0; q < 4; q++) plat.colours.push(cEdge[0], cEdge[1], cEdge[2], 255);
      plat.indices.push(v, v + 1, v + 2, v, v + 2, v + 3, v, v + 2, v + 1, v, v + 3, v + 2);
    }
    stats.platforms++;
  };
  for (const a of areas) if (a.tags.railway === 'platform' || a.tags.public_transport === 'platform') { const r = a.parts[0][0].map((p: any) => [p.x, p.z]); if (r.length >= 3) slab(r.slice(0, r.length - (Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) < 0.01 ? 1 : 0))); }
  for (const l of lines) if (l.tags.railway === 'platform' || l.tags.public_transport === 'platform') {
    const P = l.nodes.map((p: any) => [p.x, p.z]), w = R.platformWidth / 2;
    // (a closed way: the platform's outline — a slab of that shape)
    if (P.length >= 4 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 0.01) { slab(P.slice(0, -1)); continue; }
    for (let k = 0; k + 1 < P.length; k++) { const [ax, az] = P[k], [bx, bz] = P[k + 1], L = Math.hypot(bx - ax, bz - az); if (L < 0.5) continue; const nx = -(bz - az) / L * w, nz = (bx - ax) / L * w; slab([[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]]); }
  }
  return { pieces, platforms: plat, items, wires, stats };
}
