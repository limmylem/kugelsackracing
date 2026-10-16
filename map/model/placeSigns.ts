// Map v5's place signs (Step 6; MAP_README.md, 'Landmarks'): where a main road crosses into a suburb, its name on
// a sign on the driving side, facing the traffic coming in (Overture's localities' boundaries; one a suburb a road
// within dedupe m); a named park's sign at its edge nearest a road (the park OSM maps, its name from a place of
// Overture's inside it). Each stands clear of every lane (map/model/mask.ts surface.near) and building.
//
//   placeSigns({ localities, parks, places, segs, style, cfg, surface, groundAt, inBuilding, box, names })
//     → { signs: [x, y, z, yaw, kind (0 suburb, 1 park), name index (into names, shared by every block) …], stats }

const inRing = (r: number[][], x: number, z: number) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > z) !== (r[j][1] > z) && x < (r[j][0] - r[i][0]) * (z - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; };

export const PLACE_SIGN = { suburb: 0, park: 1 } as const;

export function placeSigns({ localities, parks, places, segs, style, cfg, surface, groundAt, inBuilding, box, names }: { localities: { name: string; rings: number[][][] }[]; parks: any[]; places: any[]; segs: any[]; style: any; cfg: any; surface: any; groundAt: (x: number, z: number) => number; inBuilding: (x: number, z: number) => boolean; box: number[]; names: string[] }) {
  const C = cfg.placeSigns, out: number[] = [], stats = { suburbs: 0, parks: 0, noRoom: 0 };
  const nameIdx = (n: string) => { let k = names.indexOf(n); if (k < 0) { k = names.length; names.push(n); } return k; };
  const inBox = (x: number, z: number) => x >= box[0] && x < box[2] && z >= box[1] && z < box[3];
  const left = style.drivingSide !== 'right';
  // (out from a road's edge until clear of every lane and building: the first of a few offsets)
  const place = (x0: number, z0: number, nx: number, nz: number, hw: number) => { for (const d of C.offsets) { const x = x0 + nx * (hw + d), z = z0 + nz * (hw + d); if (!surface.near(x, z, C.clearance) && !inBuilding(x, z)) return [x, z]; } return null; };
  // ---- suburbs: each locality containing a point, by a coarse grid of their rings
  const G = 200, grid = new Map<string, number[]>();
  localities.forEach((L, q) => { for (const r of L.rings) { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } for (let i = Math.floor(x0 / G); i <= Math.floor(x1 / G); i++) for (let j = Math.floor(z0 / G); j <= Math.floor(z1 / G); j++) { const k = `${i},${j}`; const l = grid.get(k) ?? grid.set(k, []).get(k)!; if (!l.includes(q)) l.push(q); } } });
  // (the smallest that holds it: a suburb inside a bigger area — a city's, a metropolitan one — is where it is; one
  // bigger than maxArea km² is no suburb)
  const areaOf = localities.map(L => L.rings.reduce((a, r) => { let s2 = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s2 += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a + Math.abs(s2 / 2); }, 0));
  const suburbAt = (x: number, z: number) => { let best = -1; for (const q of grid.get(`${Math.floor(x / G)},${Math.floor(z / G)}`) ?? []) if (areaOf[q] <= C.maxArea * 1e6 && (best < 0 || areaOf[q] < areaOf[best]) && localities[q].rings.some(r => inRing(r, x, z))) best = q; return best; };
  const done: { q: number; x: number; z: number }[] = [];
  // (a sign entering suburb `into`, s m along g, going dir (1 forward, −1 back): on the driving side of the way it's
  // going, facing the traffic coming in)
  const signAt = (g: any, s: number, dir: number, into: number) => {
    const L = g.s[g.s.length - 1]; s = Math.max(0, Math.min(L, s));
    let k = 0; while (k < g.s.length - 2 && g.s[k + 1] < s) k++;
    const f = g.s[k + 1] > g.s[k] ? (s - g.s[k]) / (g.s[k + 1] - g.s[k]) : 0, x0 = g.xs[k] + (g.xs[k + 1] - g.xs[k]) * f, z0 = g.zs[k] + (g.zs[k + 1] - g.zs[k]) * f;
    const tx = g.xs[k + 1] - g.xs[k], tz = g.zs[k + 1] - g.zs[k], tl = Math.hypot(tx, tz) || 1, fx = tx / tl * dir, fz = tz / tl * dir, sx = left ? fz : -fz, sz = left ? -fx : fx;
    if (!inBox(x0, z0) || done.some(d => d.q === into && Math.hypot(d.x - x0, d.z - z0) < C.dedupe)) return;
    const hw = (left === (dir > 0) ? g.hwL?.[k] : g.hwR?.[k]) ?? g.visual / 2, at = place(x0, z0, sx, sz, hw);
    if (!at) { stats.noRoom++; return; }
    out.push(at[0], groundAt(at[0], at[1]), at[1], Math.atan2(-fx, -fz), PLACE_SIGN.suburb, nameIdx(localities[into].name));
    done.push({ q: into, x: x0, z: z0 }); stats.suburbs++;
  };
  const main = segs.filter(g => !g.internal && C.roadClasses.includes(g.cls) && g.structure === 'ground');
  const ends = new Map<any, { a: number; b: number }>();
  for (const g of main) {
    const L = g.s[g.s.length - 1], e = Math.min(C.past, L / 3), at = (q: number) => { let k = 0; while (k < g.s.length - 2 && g.s[k + 1] < q) k++; const f = g.s[k + 1] > g.s[k] ? (q - g.s[k]) / (g.s[k + 1] - g.s[k]) : 0; return suburbAt(g.xs[k] + (g.xs[k + 1] - g.xs[k]) * f, g.zs[k] + (g.zs[k + 1] - g.zs[k]) * f); };
    const a = at(e), b = at(L - e);
    ends.set(g, { a, b });
    // (into another suburb along the road itself)
    if (a >= 0 && b >= 0 && a !== b) {
      let lo = e, hi = L - e; for (let n = 0; n < 12; n++) { const m = (lo + hi) / 2; if (at(m) === a) lo = m; else hi = m; }
      signAt(g, hi + C.past, 1, b);
      if (!g.oneway) signAt(g, lo - C.past, -1, a);
    }
  }
  // (into another at a junction on the boundary: the same road on, from one suburb into the next)
  const byFrom = new Map<number, any[]>(); for (const g of main) (byFrom.get(g.from) ?? byFrom.set(g.from, []).get(g.from)!).push(g);
  for (const A of main) for (const B of byFrom.get(A.to) ?? []) {
    if (B === A || B.name !== A.name) continue;
    const ea = ends.get(A)!, eb = ends.get(B)!;
    if (ea.b < 0 || eb.a < 0 || ea.b === eb.a) continue;
    signAt(B, C.past, 1, eb.a);
    if (!A.oneway) signAt(A, A.s[A.s.length - 1] - C.past, -1, ea.b);
  }
  // ---- parks: a named place inside, the sign at the park's edge nearest a road
  const roadPts: number[][] = [];
  for (const g of segs) if (!g.internal && g.structure === 'ground' && !['service', 'track', 'path'].includes(g.cls)) for (let k = 0; k < g.xs.length; k++) roadPts.push([g.xs[k], g.zs[k], g.hwL?.[k] ?? 4]);
  const RG = 64, rgrid = new Map<string, number[][]>(); for (const p of roadPts) { const k = `${Math.floor(p[0] / RG)},${Math.floor(p[1] / RG)}`; (rgrid.get(k) ?? rgrid.set(k, []).get(k)!).push(p); }
  const nearestRoad = (x: number, z: number) => { let best: number[] | null = null, bd = C.parkRoadNear; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const p of rgrid.get(`${Math.floor(x / RG) + a},${Math.floor(z / RG) + b}`) ?? []) { const d = Math.hypot(p[0] - x, p[1] - z); if (d < bd) { bd = d; best = p; } } return best; };
  const parksDone: { name: string; x: number; z: number }[] = [];
  for (const park of parks) {
    const ring = park.parts[0][0].map((p: any) => [p.x, p.z]);
    const named = places.find(p => p.x != null && p.names?.primary && (p.confidence ?? 0) >= C.parkConfidence && C.parkCategories.some((c: string) => [p.basic_category, p.taxonomy?.primary].includes(c)) && inRing(ring, p.x, p.z));
    if (!named) continue;
    // (one sign a park's name: the same name again within dedupe m — a park mapped in parts — is the same park)
    if (parksDone.some(d => d.name === named.names.primary && Math.hypot(d.x - named.x, d.z - named.z) < C.dedupe)) continue;
    parksDone.push({ name: named.names.primary, x: named.x, z: named.z });
    // (the ring's point nearest a road, a little inside the park)
    let best: any = null;
    for (let k = 0; k < ring.length; k += Math.max(1, Math.floor(ring.length / 60))) { const r = nearestRoad(ring[k][0], ring[k][1]); if (r) { const d = Math.hypot(r[0] - ring[k][0], r[1] - ring[k][1]); if (!best || d < best.d) best = { d, p: ring[k], r }; } }
    if (!best || !inBox(best.p[0], best.p[1])) continue;
    const dx = best.p[0] - best.r[0], dz = best.p[1] - best.r[1], dl = Math.hypot(dx, dz) || 1, x = best.p[0] + dx / dl * C.parkIn, z = best.p[1] + dz / dl * C.parkIn;
    if (surface.near(x, z, C.clearance) || inBuilding(x, z)) { stats.noRoom++; continue; }
    out.push(x, groundAt(x, z), z, Math.atan2(-dx / dl, -dz / dl), PLACE_SIGN.park, nameIdx(named.names.primary)); stats.parks++;
  }
  return { signs: out, stats };
}
