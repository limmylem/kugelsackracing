// Map v5's front fences (Step 3; MAP_README.md, 'Buildings'), estimated: OSM maps few of a suburb's front fences, and
// a street of houses with none reads as open lawn. Each house (building types houseTypes) set back at least
// minSetback m from its street gets one on its property line — the back of the street's footpath and verge
// (map/model/crossSection.ts's plan for that side), back m further — across its frontage (margin m past its walls
// each way), with a gate opposite its middle and a driveway's gap at one end: the end a garage or carport of its own
// is at, else the end with more room to the next building. A mapped driveway crossing the line leaves a gap too. The
// fence's kind by the house (a hash of its id) from the style pack's frontFences.mix: a low wall, a fence, a hedge or
// none. Every piece stands clear of every road surface, footpath included, and every building; the block keeps the
// pieces whose middle is in it (as map/model/props.ts's railings).
//
//   frontFences({ buildings, segs, style, cfg, surface, inBuilding, groundAt, inArea })
//     → { barriers: { [type]: [x0, y0, z0, x1, y1, z1, h, flags (1 estimated)] }, stats }

import { rowAt } from './geom.ts';
import { ESTIMATED } from './props.ts';

const hash = (n: number) => { let h = n | 0; h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export function frontFences({ buildings, segs, style, cfg, surface, inBuilding, groundAt, inArea }: { buildings: any[]; segs: any[]; style: any; cfg: any; surface: any; inBuilding: (x: number, z: number) => boolean; groundAt: (x: number, z: number) => number; inArea: (x: number, z: number) => boolean }) {
  const C = cfg.frontFences, S = style.frontFences, X = style.crossSection, kerbW = X.kerbBevel + X.kerbTop;
  const out: Record<string, number[]> = {}, stats = { houses: 0, fenced: 0, pieces: 0, metres: 0, noRoom: 0, noStreet: 0, unfenced: 0, blocked: 0, driveways: 0 };
  // (the streets' centre-line pieces by cell, and the mapped driveways')
  const G = 32, streets = new Map<string, [any, number][]>(), drives: number[][] = [];
  for (const g of segs) {
    if (g.internal || g.structure !== 'ground') continue;
    if ((g as any).driveway) { for (let k = 0; k + 1 < g.xs.length; k++) drives.push([g.xs[k], g.zs[k], g.xs[k + 1], g.zs[k + 1]]); continue; }
    if (!C.roadClasses.includes(g.cls) || g.link) continue;
    for (let k = 0; k + 1 < g.xs.length; k++) { const key = `${Math.floor((g.xs[k] + g.xs[k + 1]) / 2 / G)},${Math.floor((g.zs[k] + g.zs[k + 1]) / 2 / G)}`; (streets.get(key) ?? streets.set(key, []).get(key)!).push([g, k]); }
  }
  const nearestStreet = (x: number, z: number) => {
    let best: { g: any; s: number; d: number; side: number } | null = null;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const [g, k] of streets.get(`${Math.floor(x / G) + a},${Math.floor(z / G) + b}`) ?? []) {
      const ax = g.xs[k], az = g.zs[k], dx = g.xs[k + 1] - ax, dz = g.zs[k + 1] - az, l2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(x - ax - dx * t, z - az - dz * t);
      // (side +1 along the model's normal, (−dz, dx): map/model/geom.ts)
      if (d < C.frontMax && (!best || d < best.d)) best = { g, s: g.s[k] + (g.s[k + 1] - g.s[k]) * t, d, side: (x - ax) * -dz + (z - az) * dx >= 0 ? 1 : -1 };
    }
    return best;
  };
  // (buildings by cell: the next building along, and a garage or carport of a house's own)
  const B = new Map<string, any[]>(), cOf = (b: any) => { if (b._c) return b._c; const r = b.rings[0]; let x = 0, z = 0; for (const p of r) { x += p[0]; z += p[1]; } return (b._c = [x / r.length, z / r.length]); };
  for (const b of buildings) { const c = cOf(b), key = `${Math.floor(c[0] / G)},${Math.floor(c[1] / G)}`; (B.get(key) ?? B.set(key, []).get(key)!).push(b); }
  const around = (x: number, z: number) => { const l: any[] = []; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const q of B.get(`${Math.floor(x / G) + a},${Math.floor(z / G) + b}`) ?? []) l.push(q); return l; };
  // (a point clear for a fence: no road surface — footpath or verge either — within clear m, no building)
  const clear = (x: number, z: number) => !surface.near(x, z, C.clear) && !(surface.heightsAt(x, z) as any[]).length && !inBuilding(x, z);
  const crossesDrive = (x0: number, z0: number, x1: number, z1: number) => drives.some(([ax, az, bx, bz]) => { const d1 = (bx - ax) * (z0 - az) - (bz - az) * (x0 - ax), d2 = (bx - ax) * (z1 - az) - (bz - az) * (x1 - ax), d3 = (x1 - x0) * (az - z0) - (z1 - z0) * (ax - x0), d4 = (x1 - x0) * (bz - z0) - (z1 - z0) * (bx - x0); return d1 * d2 < 0 && d3 * d4 < 0; });
  const mixTotal = S.mix.reduce((a: number, m: any) => a + m.w, 0);
  for (const b of buildings) {
    const type = b.props?.v5?.type;
    if (!C.houseTypes.includes(type)) continue;
    stats.houses++;
    const c = cOf(b), st = nearestStreet(c[0], c[1]);
    if (!st) { stats.noStreet++; continue; }
    const g = st.g, r0 = rowAt(g, st.s), tx = r0.nz, tz = -r0.nx, nx = r0.nx * st.side, nz = r0.nz * st.side;
    // (its walls along the street and out from it, from the street's centre line there)
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity;
    for (const p of b.rings[0]) { const dx = p[0] - r0.x, dz = p[1] - r0.z, u = dx * tx + dz * tz, v = dx * nx + dz * nz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); }
    const xs = g.xsec?.[st.side > 0 ? 'L' : 'R'], hw = st.side > 0 ? r0.hwL : r0.hwR;
    const line = hw + (xs && (xs.verge || xs.footpath) ? (xs.kerb ? kerbW : 0) + xs.verge + xs.footpath : S.reserve) + C.back;
    if (v0 - line < C.minSetback) { stats.noRoom++; continue; }
    // (the kind: the house's own, from the mix)
    let pick = hash(b.id * 7919 + 13) * mixTotal, kind: any = S.mix[S.mix.length - 1];
    for (const m of S.mix) { if (pick < m.w) { kind = m; break; } pick -= m.w; }
    if (!kind.type) { stats.unfenced++; continue; }
    // (the gate opposite its middle; the driveway's gap at the end its garage is at, else the roomier end)
    const lo = u0 - C.margin, hi = u1 + C.margin, gate = (u0 + u1) / 2;
    let driveAt = 0;
    {
      const own = around(c[0], c[1]).filter(q => q !== b && ['garage', 'canopy'].includes(q.props?.v5?.type) && Math.hypot(cOf(q)[0] - c[0], cOf(q)[1] - c[1]) < C.garageNear);
      if (own.length) { const q = cOf(own[0]); driveAt = (q[0] - r0.x) * tx + (q[1] - r0.z) * tz < gate ? -1 : 1; }
      else {
        const room = (u: number, dir: number) => { const x = r0.x + tx * (u + dir * 3) + nx * (line + 2), z = r0.z + tz * (u + dir * 3) + nz * (line + 2); let m = C.garageNear; for (const q of around(x, z)) if (q !== b) { const p = cOf(q), along = ((p[0] - r0.x) * tx + (p[1] - r0.z) * tz - u) * dir; if (along > 0) m = Math.min(m, along); } return m; };
        driveAt = room(lo, -1) > room(hi, 1) ? -1 : 1;
      }
    }
    const gaps: [number, number][] = [[gate - C.gate / 2, gate + C.gate / 2], driveAt < 0 ? [lo - 1, lo + C.driveway] : [hi - C.driveway, hi + 1]];
    // (along the street's own curve: the line's points at s along it)
    const pt = (u: number) => { const r = rowAt(g, st.s + u), off = st.side * line; return [r.x + r.nx * off * r.mitre, r.z + r.nz * off * r.mitre]; };
    let placed = false;
    for (let u = lo; u < hi - 0.05; ) {
      const inGap = gaps.find(([a, e]) => u >= a && u < e);
      if (inGap) { u = inGap[1]; continue; }
      const next = Math.min(hi, u + C.piece, ...gaps.map(([a]) => a).filter(a => a > u));
      const [x0, z0] = pt(u), [x1, z1] = pt(next), mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      u = next;
      if (!inArea(mx, mz)) continue;
      if (!clear(x0, z0) || !clear(x1, z1) || !clear(mx, mz)) { stats.blocked++; continue; }
      if (crossesDrive(x0, z0, x1, z1)) { stats.driveways++; continue; }
      (out[kind.type] ??= []).push(x0, groundAt(x0, z0), z0, x1, groundAt(x1, z1), z1, kind.h, ESTIMATED);
      stats.pieces++; stats.metres += Math.hypot(x1 - x0, z1 - z0); placed = true;
    }
    if (placed) stats.fenced++;
  }
  stats.metres = Math.round(stats.metres);
  return { barriers: out, stats };
}
