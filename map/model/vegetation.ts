// Map v5's vegetation (Step 7; MAP_README.md, 'Vegetation'), over Map v4's trees (map/model/props.ts treesV4):
//
//  · each tree's kind (lists.trees' fifth number — map/render/objects.ts draws them): 0 broadleaf, 1 conifer, 2 a low
//    plant, 3 a eucalypt, 4 a palm; + TREE_ESTIMATED (8) when it's estimated, not mapped. A mapped tree's kind from its
//    tags (genus, species, taxon, leaf_type); an estimated one's from the style pack's mix for where it is (a park's,
//    a forest's, a street's, a garden's), seeded
//  · nothing estimated on open ground: pitches, stadiums, tracks, pools, playgrounds, a golf course's greens,
//    fairways, tees and bunkers (openAreas)
//  · street trees (estimated, where none are mapped near): along urban roads whose verge (the cross-section's —
//    map/model/crossSection.ts) is wide enough, every streetTreeSpacing m, in the verge's middle, clear of junctions,
//    driveways and crossings, and of the exclusion mask
//  · a garden tree or shrub behind a house (estimated, seeded by its id), in its own yard
//
//   openAreas(osm, cfg) → { has(x, z) }          kindOf(tags) · pickKind(mix, r)
//   streetTrees({ segs, style, cfg, ok, near, lowerAt, groundAt, inArea, clear? }) → [x, y, z, scale, kind …]
//   gardenTrees({ buildings, style, cfg, ok, near, groundAt, inArea, clear? }) → [x, y, z, scale, kind …]
//   (clear(x, y, z, scale, kind): its canopy clear of every road surface — else it's made smaller, fitScale, or left out)
//   canopyAt(kind, sc, d) · crownThrough(kind, sc, x, y, z, heightsAt) · fitScale(s, clear)

export const TREE_ESTIMATED = 8;
const KIND: Record<string, number> = { broadleaf: 0, jacaranda: 0, plane: 0, oak: 0, conifer: 1, pine: 1, shrub: 2, plant: 2, eucalypt: 3, gum: 3, palm: 4 };
const rng = (seed: number) => () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const inRing = (r: number[][], x: number, z: number) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > z) !== (r[j][1] > z) && x < (r[j][0] - r[i][0]) * (z - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; };

// a mapped tree's kind, from what OSM says it is
export function kindOf(tags: Record<string, string>) {
  const g = `${tags.genus ?? ''} ${tags.species ?? ''} ${tags.taxon ?? ''} ${tags['species:en'] ?? ''} ${tags['genus:en'] ?? ''}`.toLowerCase();
  if (/eucalypt|corymbia|angophora|\bgum\b/.test(g)) return KIND.eucalypt;
  if (/phoenix|washingtonia|palm|livistona|syagrus|archontophoenix|trachycarpus/.test(g)) return KIND.palm;
  if (tags.leaf_type === 'needleleaved' || /pinus|cupressus|araucaria|callitris|cedrus|conifer|pine|cypress/.test(g)) return KIND.conifer;
  return KIND.broadleaf;
}
// a tree's drawn canopy (as map/render/objects.ts draws it, in units of sc — its scale × 4): a broadleaf's, a eucalypt's,
// a palm's and a plant's an ellipsoid round cy, hy high either side and rx round (a eucalypt's is set 0.08 off its
// trunk: its radius taken that much wider); a conifer's a cone rx round at lo, up to top
const CANOPY: Record<number, { cy?: number; hy?: number; rx: number; lo?: number; top?: number }> = { [KIND.broadleaf]: { cy: 1.25, hy: 0.7, rx: 0.75 }, [KIND.conifer]: { rx: 0.55, lo: 0.35, top: 2.95 }, [KIND.shrub]: { cy: 0.58, hy: 0.4, rx: 0.6 }, [KIND.eucalypt]: { cy: 1.5, hy: 0.55, rx: 0.7 }, [KIND.palm]: { cy: 1.26, hy: 0.16, rx: 0.55 } };
// the heights over its foot the canopy fills d m from the trunk, [lo, hi], or null past its edge
export function canopyAt(kind: number, sc: number, d: number): [number, number] | null {
  const C = CANOPY[kind & 7] ?? CANOPY[KIND.broadleaf], R = C.rx * sc;
  if (d >= R) return null;
  if (C.top != null) return [C.lo! * sc, (C.lo! + (C.top - C.lo!) * (1 - d / R)) * sc];
  const f = Math.sqrt(1 - (d / R) ** 2);
  return [(C.cy! - C.hy! * f) * sc, (C.cy! + C.hy! * f) * sc];
}
// whether a road surface — a lane, a deck, a footpath up a bank beside it — goes through that canopy (within margin m of
// it): heightsAt(x, z) the surfaces' heights at a point, looked at under the trunk and on two rings round it (half and
// nine tenths of the way out)
export function crownThrough(kind: number, sc: number, x: number, y: number, z: number, heightsAt: (x: number, z: number) => number[], margin = 0) {
  const R = (CANOPY[kind & 7] ?? CANOPY[KIND.broadleaf]).rx * sc;
  for (const f of [0, 0.5, 0.9]) for (let a = 0; a < (f ? 8 : 1); a++) {
    const [lo, hi] = canopyAt(kind, sc, f * R)!, px = x + Math.cos(a * Math.PI / 4) * R * f, pz = z + Math.sin(a * Math.PI / 4) * R * f;
    for (const h of heightsAt(px, pz)) if (h - y > lo - margin && h - y < hi + margin) return true;
  }
  return false;
}
// the largest scale up to s (no less than minShrink of it) at which a tree's canopy is clear (clear(scale)), or 0
export function fitScale(s: number, clear: (s: number) => boolean, minShrink = 0.5) {
  for (let f = s; f >= s * minShrink - 1e-9; f *= 0.8) if (clear(f)) return f;
  return 0;
}

// a kind from a mix ({ name: share }), by a number in [0, 1)
export function pickKind(mix: Record<string, number>, r: number) {
  const list = Object.entries(mix), total = list.reduce((a, [, v]) => a + v, 0) || 1;
  let acc = 0;
  for (const [name, v] of list) { acc += v / total; if (r < acc) return KIND[name] ?? 0; }
  return KIND[list[list.length - 1]?.[0]] ?? 0;
}

// the open ground no estimated tree stands on, by 64 m cells
export function openAreas(osm: any, cfg: any) {
  const V = cfg.vegetation, C = 64, grid = new Map<string, number[][][]>();
  const open = (t: Record<string, string>) => V.openLeisure.includes(t.leisure) || V.openGolf.includes(t.golf) || V.openLanduse.includes(t.landuse) || V.openAmenity.includes(t.amenity);
  for (const a of osm.areas) {
    if (!open(a.tags)) continue;
    for (const part of a.parts) {
      const r = part[0].map((p: any) => [p.x, p.z]);
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) for (let j = Math.floor(z0 / C); j <= Math.floor(z1 / C); j++) { const k = `${i},${j}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(r); }
    }
  }
  return { has: (x: number, z: number) => (grid.get(`${Math.floor(x / C)},${Math.floor(z / C)}`) ?? []).some(r => inRing(r, x, z)) };
}

// street trees: in the middle of each road side's verge, wide enough, every spacing m (seeded by the road's id, a
// little jitter), not within the junctions' reach of its ends, nor near a lowered kerb (a driveway, a crossing)
type Clear = ((x: number, y: number, z: number, s: number, kind: number) => boolean) | null;
export function streetTrees({ segs, style, cfg, ok, near, lowerAt, groundAt, inArea, clear = null }: { segs: any[]; style: any; cfg: any; ok: (x: number, z: number, s: number) => boolean; near: (x: number, z: number, r: number) => boolean; lowerAt: number[][]; groundAt: (x: number, z: number) => number; inArea: (x: number, z: number) => boolean; clear?: Clear }) {
  const V = style.vegetation, Vc = cfg.vegetation, out: number[] = [], stats = { placed: 0, skipped: 0 };
  const LG = 8, lg = new Map<string, number[][]>();
  for (const p of lowerAt) { const k = `${Math.floor(p[0] / LG)},${Math.floor(p[1] / LG)}`; (lg.get(k) ?? lg.set(k, []).get(k)!).push(p); }
  const lowered = (x: number, z: number) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const p of lg.get(`${Math.floor(x / LG) + a},${Math.floor(z / LG) + b}`) ?? []) if (Math.hypot(p[0] - x, p[1] - z) < Vc.clearOfLowered) return true; return false; };
  for (const g of segs) {
    if (g.internal || !g.xsec || Vc.noStreetTrees.includes(g.cls)) continue;
    const L = g.s[g.s.length - 1], R = rng(g.id * 7 + 3);
    for (const sd of [1, -1]) {
      const side = g.xsec[sd > 0 ? 'L' : 'R'];
      if (!side || !side.kerb || side.verge < V.streetTreeVerge) continue;
      const s0 = Math.max(0, g.trim0 ?? 0) + Vc.clearOfJunction, s1 = L - Math.max(0, g.trim1 ?? 0) - Vc.clearOfJunction;
      for (let s = s0 + R() * V.streetTreeSpacing; s <= s1; s += V.streetTreeSpacing * (0.85 + R() * 0.3)) {
        let k = 0; while (k < g.s.length - 2 && g.s[k + 1] < s) k++;
        const f = g.s[k + 1] > g.s[k] ? (s - g.s[k]) / (g.s[k + 1] - g.s[k]) : 0, x0 = g.xs[k] + (g.xs[k + 1] - g.xs[k]) * f, z0 = g.zs[k] + (g.zs[k + 1] - g.zs[k]) * f;
        const tx = g.xs[k + 1] - g.xs[k], tz = g.zs[k + 1] - g.zs[k], tl = Math.hypot(tx, tz) || 1, nx = -tz / tl, nz = tx / tl;
        const hw = (sd > 0 ? g.hwL?.[k] : g.hwR?.[k]) ?? g.visual / 2, d = hw + style.crossSection.kerbBevel + style.crossSection.kerbTop + side.verge / 2;
        const x = x0 + nx * sd * d, z = z0 + nz * sd * d, sc = 0.7 + R() * 0.35, kind = pickKind(V.streetMix ?? V.mix, R());
        if (!inArea(x, z) || lowered(x, z) || near(x, z, Vc.mappedNear) || !ok(x, z, sc)) { stats.skipped++; continue; }
        const y = groundAt(x, z), fit = clear ? fitScale(sc, q => clear(x, y, z, q, kind)) : sc;
        if (!fit) { stats.skipped++; continue; }
        out.push(x, y, z, fit, kind | TREE_ESTIMATED); stats.placed++;
      }
    }
  }
  return { trees: out, stats };
}

// a garden's tree or shrub: behind each house (away from the wall facing its street — props.v5.front), in its yard,
// at the style pack's chance, seeded by its id
export function gardenTrees({ buildings, style, cfg, ok, near, groundAt, inArea, clear = null }: { buildings: any[]; style: any; cfg: any; ok: (x: number, z: number, s: number) => boolean; near: (x: number, z: number, r: number) => boolean; groundAt: (x: number, z: number) => number; inArea: (x: number, z: number) => boolean; clear?: Clear }) {
  const V = style.vegetation, out: number[] = [], stats = { placed: 0, skipped: 0 };
  for (const b of buildings) {
    const v5 = b.props?.v5;
    if (!v5 || v5.type !== 'house' || !v5.front) continue;
    const R = rng(b.id * 13 + 5);
    if (R() > V.gardenChance) continue;
    const [ax, az, bx, bz, cx, cz] = v5.front, mx = (ax + bx) / 2, mz = (az + bz) / 2, dl = Math.hypot(cx - mx, cz - mz) || 1;
    // (from the front wall's middle through the house's, and on past its back by gardenBack m)
    const back = dl + V.gardenBack * (0.8 + R() * 0.5), x = mx + (cx - mx) / dl * back * 2, z = mz + (cz - mz) / dl * back * 2, sc = 0.55 + R() * 0.35, kind = pickKind(V.gardenMix ?? V.mix, R());
    if (!inArea(x, z) || near(x, z, 3) || !ok(x, z, sc)) { stats.skipped++; continue; }
    const y = groundAt(x, z), f = clear ? fitScale(sc, q => clear(x, y, z, q, kind)) : sc;
    if (!f) { stats.skipped++; continue; }
    out.push(x, y, z, f, kind | TREE_ESTIMATED); stats.placed++;
  }
  return { trees: out, stats };
}
