// Map v5's buildings (Step 3; MAP_README.md, 'Buildings'): what each one is, how it looks, what it says.
//
//  · its type — house, terrace, apartment, shop, office, tower, warehouse, industrial, school, church, petrol, mall,
//    hospital, station, garage, other — from its building tag (OSM's, else Overture's class), then the places inside it
//    (Overture's categories, OSM's amenity and shop), then (estimated) its land use, size and height
//  · its facade: one of FACADES (map/render/facades.ts draws them, an atlas), windows and doors by its floors
//  · its roof: from the data, else the region style pack's for its type (estimated); its colours from the data, else
//    the pack's palettes seeded by its id (estimated)
//  · its signs: a chain's outlet (map/model/brands.ts) gets its parody's colours and name; any other named business
//    in it its own name (cfg.buildings.signs off: none) — a band over the ground floor on the wall facing its street
//    (v5.front: that wall's ends and the building's middle, world x, z)
//  · a chain's site, by its parody's template: a pylon sign by the road, a petrol station's canopy over its forecourt
//    with pumps, a drive-thru's menu board by its lane, a supermarket's trolley bays — placed only where there's room
//    (off every lane and building), each marked estimated and counted
//
//   classifyBuildings({ buildings, places, osm, classAt, style, cfg }) → stats            (sets b.props.v5)
//   brandSites({ outlets, buildings, registry, model, surface, groundAt, style, cfg, box }) → { items, stats }

import { FURN, canopyFlags } from '../format/furniture.ts';
import { minRect } from '../bake/extrude.ts';

export const FACADES = ['house', 'terrace', 'apartment', 'shop', 'office', 'warehouse', 'school', 'church', 'petrol', 'mall', 'hospital', 'station', 'industrial', 'plain', 'tower', 'garage'] as const;
const F = (t: string) => Math.max(0, FACADES.indexOf(t as any));
const hashOf = (id: number) => { let h = (id % 2147483647) | 0; h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); return (h ^ (h >>> 15)) >>> 0; };
const KIND: Record<string, string> = {
  house: 'house', detached: 'house', semidetached_house: 'house', bungalow: 'house', cabin: 'house', farm: 'house', terrace: 'terrace',
  apartments: 'apartment', residential: 'apartment', dormitory: 'apartment', flats: 'apartment', hotel: 'apartment',
  retail: 'shop', kiosk: 'shop', supermarket: 'mall', commercial: 'office', office: 'office', public: 'office', civic: 'office', government: 'office',
  industrial: 'industrial', warehouse: 'warehouse', manufacture: 'industrial', factory: 'industrial', hangar: 'warehouse',
  school: 'school', kindergarten: 'school', university: 'school', college: 'school',
  church: 'church', cathedral: 'church', chapel: 'church', mosque: 'church', temple: 'church', synagogue: 'church', religious: 'church',
  hospital: 'hospital', train_station: 'station', transportation: 'station', garage: 'garage', garages: 'garage', shed: 'garage', service: 'garage',
};
// (a place's category → the building's type)
const PLACE: [RegExp, string][] = [
  [/gas_station|fuel/, 'petrol'], [/shopping_mall|shopping_center|department_store|supermarket|hypermarket/, 'mall'],
  [/hospital|medical_center/, 'hospital'], [/school|university|college|kindergarten|education/, 'school'],
  [/church|place_of_worship|mosque|temple|synagogue|cathedral/, 'church'], [/train_station|railway_station|bus_station|transit/, 'station'],
  [/restaurant|cafe|fast_food|bar|pub|bakery|store|shop|retail|boutique|salon|pharmacy|bank|food/, 'shop'], [/office|professional|financial|legal|real_estate|corporate/, 'office'],
];
// (the places that put their names up: shops, food, services, fuel, offices, hotels)
const SIGNED = /restaurant|cafe|fast_food|bar|pub|bakery|store|shop|retail|boutique|salon|pharmacy|bank|food|gas_station|fuel|supermarket|mall|office|hotel|clinic|dentist|gym/;
const ringArea = (r: number[][]) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return Math.abs(a / 2); };
const insideRing = (r: number[][], x: number, z: number) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > z) !== (r[j][1] > z) && x < (r[j][0] - r[i][0]) * (z - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; };

// a petrol station's canopy, by its shape: a roof on posts of forecourt size (cfg.brandSites.canopyArea m²), near
// enough a rectangle, deep (canopyDepth m across at least) and not long and thin — a verandah runs shallow along a
// shopfront
function forecourtLike(b: any, T: any) {
  const r = b.rings[0], A = ringArea(r);
  if (A < T.canopyArea[0] || A > T.canopyArea[1]) return false;
  const rect = minRect(r);
  return !!rect && A / rect.area >= 0.7 && 2 * rect.half[1] >= T.canopyDepth && rect.half[0] <= 4 * rect.half[1];
}

export function classifyBuildings({ buildings, places, osm, classAt, style, cfg, roadAt = () => null }: { buildings: any[]; places: any[]; osm: any; classAt: (x: number, z: number) => string; style: any; cfg: any; roadAt?: (x: number, z: number) => { x: number; z: number; d: number } | null }) {
  const B = style.buildings, stats: Record<string, number> = { tagged: 0, byPlace: 0, estimated: 0, roofsEstimated: 0, coloursEstimated: 0, named: 0 };
  const types: Record<string, number> = {};
  // (the places by 50 m cell: Overture's and OSM's points with a category)
  const C = 50, grid = new Map<string, any[]>(), add = (p: any) => { const k = `${Math.floor(p.x / C)},${Math.floor(p.z / C)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(p); };
  for (const p of places) if (p.x != null) add({ x: p.x, z: p.z, cat: [p.basic_category, p.taxonomy?.primary].filter(Boolean).join(' '), name: p.names?.primary ?? null, conf: p.confidence ?? 0 });
  for (const p of osm.points) if (p.tags.amenity || p.tags.shop || p.tags.office) add({ x: p.x, z: p.z, cat: [p.tags.amenity, p.tags.shop && `shop ${p.tags.shop}`, p.tags.office && 'office'].filter(Boolean).join(' '), name: p.tags.name ?? null, conf: 1 });
  const K = cfg.buildings.canopy;
  for (const b of buildings) {
    const P = b.props, ring = b.rings[0], area = ringArea(ring);
    // (a roof on posts — building=roof, a carport: a verandah over the footpath, a petrol station's canopy — drawn as
    // one, its height the data's or the kind's, estimated: map/bake/extrude.ts)
    if (K.kinds.includes(String(P.b ?? '').toLowerCase())) {
      const kind = String(P.b).toLowerCase();
      P.v5 = { type: 'canopy', facade: F('plain'), estimatedType: false, canopy: { h: K.height[kind] ?? K.height.roof, thick: K.thickness, post: K.post, inset: K.inset, spacing: K.postSpacing, postColour: K.postColour }, estimatedHeight: !(P.h > 0), rc: P.rc ?? K.roofColour, fc: P.fc ?? K.fasciaColour, estimatedColour: !P.fc };
      stats.tagged++; types.canopy = (types.canopy ?? 0) + 1;
      continue;
    }
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, cx = 0, cz = 0;
    for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); cx += x; cz += z; }
    cx /= ring.length; cz /= ring.length;
    // the places inside it (or within inside m of its walls, for a footprint drawn a little short)
    const inside: any[] = [];
    for (let i = Math.floor((x0 - 5) / C); i <= Math.floor((x1 + 5) / C); i++) for (let j = Math.floor((z0 - 5) / C); j <= Math.floor((z1 + 5) / C); j++) for (const p of grid.get(`${i},${j}`) ?? []) if (insideRing(ring, p.x, p.z) && p.conf >= cfg.buildings.placeConfidence) inside.push(p);
    const h = P.h ?? (P.fl ? P.fl * 3 : null) ?? 0, lu = classAt(cx, cz);
    let type = KIND[String(P.b ?? '').toLowerCase()] ?? null, how = 'tag';
    if (type === 'office' && h > cfg.buildings.towerAbove) type = 'tower';
    if (!type || type === 'office' || type === 'apartment') {
      // (a place inside says more than a general tag)
      for (const [re, t] of PLACE) if (inside.some(p => re.test(p.cat))) { if (!type || t !== 'shop' || type !== 'apartment') { type = t === 'mall' && area < cfg.buildings.mallArea ? 'shop' : t; how = 'place'; } break; }
    }
    if (!type) {
      how = 'estimated';
      type = lu === 'industrial' ? (area > 800 ? 'warehouse' : 'industrial')
        : lu === 'commercial' ? (h > cfg.buildings.towerAbove ? 'tower' : h > 12 ? 'office' : 'shop')
        : lu === 'residential' ? (area < cfg.buildings.houseArea && (h || 0) < 9 ? 'house' : 'apartment')
        : h > cfg.buildings.towerAbove ? 'tower' : area > 3000 && h < 12 ? 'warehouse' : area < 40 ? 'garage' : area < cfg.buildings.houseArea ? 'house' : 'plain';
    }
    stats[how === 'tag' ? 'tagged' : how === 'place' ? 'byPlace' : 'estimated']++;
    types[type] = (types[type] ?? 0) + 1;
    const hsh = hashOf(b.id), group = ['house', 'terrace', 'garage'].includes(type) ? 'house' : ['shop', 'mall', 'petrol', 'station'].includes(type) ? 'shop' : ['warehouse', 'industrial'].includes(type) ? 'industrial' : 'office';
    // roof and colours where the data doesn't say: the pack's for the type, marked estimated
    const roofDefault = B.roofDefault?.[type] ?? (group === 'house' ? 'hipped' : 'flat');
    const v5: any = { type, facade: F(type), estimatedType: how === 'estimated', inside: inside.length };
    if (!P.rs) { v5.rs = roofDefault === 'gabled-low' ? 'gabled' : roofDefault; if (roofDefault === 'gabled-low') v5.rh = 1.2; v5.estimatedRoof = true; stats.roofsEstimated++; }
    if (!P.fc) { const pal = B.walls[group] ?? B.walls.house; v5.fc = pal[hsh % pal.length]; v5.estimatedColour = true; stats.coloursEstimated++; }
    if (!P.rc) { const pal = B.roofs[group === 'house' ? 'house' : group === 'industrial' ? 'industrial' : 'flat'] ?? B.roofs.house; v5.rc = pal[(hsh >>> 8) % pal.length]; }
    // (the businesses in it with names: a sign each, up to signsPer)
    const names = [...new Set(inside.filter(p => p.name && SIGNED.test(p.cat) && !/school|church|hospital|station/.test(p.cat)).map(p => p.name as string))];
    if (cfg.buildings.signs && names.length && ['shop', 'mall', 'petrol', 'office', 'tower', 'industrial', 'warehouse'].includes(type)) { v5.names = names.slice(0, cfg.buildings.signsPer); stats.named++; }
    const fk = frontOf(ring, cx, cz, roadAt, cfg.buildings.frontReach);
    if (fk !== null) { const a = ring[fk], c = ring[(fk + 1) % ring.length]; v5.front = [a[0], a[1], c[0], c[1], cx, cz]; }
    P.v5 = v5;
  }
  return { stats, types };
}

// its frontage: the outer edge facing its street most squarely (its length, and how straight its outward normal points
// to the nearest road there, within reach m), or null
function frontOf(ring: number[][], cx: number, cz: number, roadAt: (x: number, z: number) => { x: number; z: number; d: number } | null, reach: number) {
  let best = -1, score = 0;
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k], b = ring[(k + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 2) continue;
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    let nx = (b[1] - a[1]) / L, nz = -(b[0] - a[0]) / L;
    if ((mx - cx) * nx + (mz - cz) * nz < 0) { nx = -nx; nz = -nz; }
    const r = roadAt(mx, mz);
    if (!r || r.d > reach) continue;
    const dx = r.x - mx, dz = r.z - mz, dl = Math.hypot(dx, dz) || 1, facing = (dx * nx + dz * nz) / dl;
    if (facing < 0.5) continue;
    const sc = L * facing / (1 + r.d / 10);
    if (sc > score) { score = sc; best = k; }
  }
  return best >= 0 ? best : null;
}

// ---------- a chain's site ----------
// each outlet's building — the one it's in, else the nearest within buildingNear m — in its parody's colours, with its
// parody's name for a sign (the whole area's, once: before any tile is built). Sets outlet.building.
export function applyBrands({ outlets, buildings, registry: R, cfg }: { outlets: any[]; buildings: any[]; registry: any; cfg: any }) {
  const T = cfg.brandSites, C = 100, grid = new Map<string, any[]>();
  for (const b of buildings) { const r = b.rings[0]; let cx = 0, cz = 0; for (const p of r) { cx += p[0]; cz += p[1]; } b._c = [cx / r.length, cz / r.length]; const k = `${Math.floor(b._c[0] / C)},${Math.floor(b._c[1] / C)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(b); }
  let branded = 0;
  for (const o of outlets) {
    const near: any[] = [];
    for (let i = Math.floor(o.x / C) - 1; i <= Math.floor(o.x / C) + 1; i++) for (let j = Math.floor(o.z / C) - 1; j <= Math.floor(o.z / C) + 1; j++) near.push(...(grid.get(`${i},${j}`) ?? []));
    const brand = R.brands[o.brand];
    // (a petrol station's mapped canopy — a roof on posts within canopyNear m — is its forecourt's, in its colours)
    // (one standing apart, of forecourt size, beside a fuel chain is a petrol station's: fuel's sold there, whatever
    // the place's own category says)
    if (brand.category === 'fuel') {
      let cn: any = null, bestD = T.canopyNear;
      for (const b of near) if (b.props.v5?.type === 'canopy' && !b.props.v5.canopy.fuel) { const d = Math.hypot(b._c[0] - o.x, b._c[1] - o.z); if (d < bestD && forecourtLike(b, T)) { bestD = d; cn = b; } }
      if (cn && !o.fuel) { o.fuel = true; o.fuelBy = 'canopy'; }
      if (cn) { const c5 = cn.props.v5; c5.canopy.fuel = true; if (!(cn.props.h > 0)) c5.canopy.h = cfg.buildings.canopy.height.fuel; c5.fc = brand.parody.colours.primary; c5.brand = o.brand; c5.estimatedColour = true; o.canopy = cn; }
    }
    // (its shop: the building it's in, else the nearest — never a canopy)
    const shops = near.filter(b => b.props.v5?.type !== 'canopy');
    let bd = shops.find(b => insideRing(b.rings[0], o.x, o.z)) ?? null;
    if (!bd) { let bestD = T.buildingNear; for (const b of shops) { const d = Math.hypot(b._c[0] - o.x, b._c[1] - o.z); if (d < bestD) { bestD = d; bd = b; } } }
    if (!bd) continue;
    const v5 = bd.props.v5 ?? (bd.props.v5 = {});
    // (one chain a building: the most confident outlet keeps it)
    if (v5.brand != null && v5.brandConfidence >= o.confidence) continue;
    v5.brand = o.brand; v5.brandConfidence = o.confidence; v5.fc = brand.parody.colours.secondary; v5.band = brand.parody.colours.primary; v5.names = [brand.parody.name];
    if (brand.category === 'fuel' && o.fuel) { v5.type = 'petrol'; v5.facade = F('petrol'); }
    o.building = bd; branded++;
  }
  return { branded };
}

export function brandSites({ outlets, buildings, registry: R, model, surface, groundAt, cfg, box, parking = [] }: { outlets: any[]; buildings: any[]; registry: any; model: any; surface: any; groundAt: (x: number, z: number) => number; style: any; cfg: any; box: [number, number, number, number]; parking?: number[][][] }) {
  const T = cfg.brandSites, items: number[] = [], stats: Record<string, number> = { outlets: 0, branded: 0, pylons: 0, canopies: 0, canopiesMapped: 0, pumps: 0, menuBoards: 0, trolleyBays: 0, noRoom: 0, noBuilding: 0 };
  const inBox = (x: number, z: number) => x >= box[0] && x < box[2] && z >= box[1] && z < box[3];
  const clear = (x: number, z: number, r: number) => !surface.near(x, z, r) && !buildings.some(b => { const rg = b.rings[0]; return Math.abs(rg[0][0] - x) < 200 && Math.abs(rg[0][1] - z) < 200 && insideRing(rg, x, z); });
  const segs = model.segs.filter((g: any) => !g.internal);
  const nearestRoad = (x: number, z: number, r: number, service: boolean | null) => {
    let best: any = null;
    for (const g of segs) {
      if (service !== null && (g.cls === 'service') !== service) continue;
      if (Math.abs(g.xs[0] - x) > 400 && Math.abs(g.xs[g.xs.length - 1] - x) > 400) continue;
      for (let k = 0; k + 1 < g.xs.length; k++) {
        const ax = g.xs[k], az = g.zs[k], dx = g.xs[k + 1] - ax, dz = g.zs[k + 1] - az, l2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
        if (d < r && (!best || d < best.d)) { const l = Math.sqrt(l2); best = { g, d, px, pz, tx: dx / l, tz: dz / l, hw: Math.max(g.hwL[k], g.hwR[k]) }; }
      }
    }
    return best;
  };
  for (const o of outlets) {
    if (!inBox(o.x, o.z)) continue;
    stats.outlets++;
    const brand = R.brands[o.brand], cat = R.categories[brand.category];
    const bd = o.building ?? null;
    if (!bd) stats.noBuilding++;
    const road = nearestRoad(o.x, o.z, T.roadNear, false);
    // (a chain of the fuel category without fuel sold there — its shop alone — gets no pylon and no forecourt)
    const forecourt = brand.category !== 'fuel' || o.fuel;
    // a pylon sign by the road (its kerb side), facing along it both ways (a sign board each side)
    if (cat.pylon && road && forecourt) {
      const nx = -road.tz, nz = road.tx, side = (o.x - road.px) * nx + (o.z - road.pz) * nz > 0 ? 1 : -1;
      const x = road.px + nx * side * (road.hw + T.pylonOut), z = road.pz + nz * side * (road.hw + T.pylonOut);
      if (clear(x, z, 0.8)) { items.push(x, groundAt(x, z), z, Math.atan2(road.tx, road.tz), FURN.pylonSign, o.brand, T.pylonHeight, 1); stats.pylons++; } else stats.noRoom++;
    }
    // a petrol station's forecourt: its mapped canopy's pumps, in a row (two, under a deep one) along it
    if (cat.template === 'petrol' && o.fuel && o.canopy) {
      const rect = minRect(o.canopy.rings[0]);
      if (rect) {
        const { c: [rx, rz], u: [ux, uz], half: [L, W] } = rect, n = Math.max(1, Math.min(T.maxPumps, Math.floor(2 * L / T.pumpSpacing))), rows = W > 7 ? [-W / 2, W / 2] : [0];
        stats.canopiesMapped++;
        for (const t of rows) for (let q = 0; q < n; q++) {
          const sA = ((q + 0.5) / n * 2 - 1) * L, px = rx + ux * sA - uz * t, pz = rz + uz * sA + ux * t;
          if (surface.near(px, pz, 0.8) || buildings.some(b => b !== o.canopy && b.props.v5?.type !== 'canopy' && Math.abs(b.rings[0][0][0] - px) < 200 && Math.abs(b.rings[0][0][1] - pz) < 200 && insideRing(b.rings[0], px, pz))) continue;
          items.push(px, groundAt(px, pz), pz, Math.atan2(ux, uz), FURN.pump, o.brand, 0, 1); stats.pumps++;
        }
      }
    } else if (cat.template === 'petrol' && o.fuel && road) {
      // (none mapped: one placed — estimated — between the shop and the road, the biggest of canopySizes that fits at the
      // clear spot nearest the outlet among canopySearch's: back from the road's edge, and along it. Its roof is
      // overhead — over a forecourt's driveway is fine — but its posts and pumps stand clear of every lane and building,
      // and it's over no public road and no building)
      const nx = -road.tz, nz = road.tx, side = (o.x - road.px) * nx + (o.z - road.pz) * nz > 0 ? 1 : -1;
      const along = Math.atan2(road.tx, road.tz), [reach, step, alongN] = T.canopySearch;
      const onPublic = (x: number, z: number) => { const r = nearestRoad(x, z, 40, false); return !!r && r.d < r.hw + 0.5; };
      const inBuilding = (x: number, z: number) => buildings.some(b => Math.abs(b.rings[0][0][0] - x) < 200 && Math.abs(b.rings[0][0][1] - z) < 200 && insideRing(b.rings[0], x, z));
      let placed = false;
      for (const [cL, cW] of T.canopySizes as number[][]) {
        const d0 = road.hw + T.canopyOut + cW / 2, spots: number[][] = [];
        for (let back = 0; back <= reach + 1e-9; back += step) for (let k = -alongN; k <= alongN; k++) { const x = road.px + nx * side * (d0 + back) + road.tx * k * step, z = road.pz + nz * side * (d0 + back) + road.tz * k * step; spots.push([x, z, Math.hypot(x - o.x, z - o.z)]); }
        spots.sort((p, q) => p[2] - q[2]);
        const at = (x: number, z: number, a: number, b: number) => [x + road.tx * a * cL / 2 + nx * b * cW / 2, z + road.tz * a * cL / 2 + nz * b * cW / 2];
        const pumpsAt = (x: number, z: number) => { const out: number[][] = []; for (let q = 0; q < T.pumps; q++) { const t = ((q + 0.5) / T.pumps - 0.5) * 1.6; out.push(at(x, z, t, 0)); } return out; };
        const fits = ([x, z]: number[]) => [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]].every(([a, b]) => { const [px, pz] = at(x, z, a, b); return !onPublic(px, pz) && !inBuilding(px, pz); })
          && [[-0.7, -0.6], [0.7, -0.6], [-0.7, 0.6], [0.7, 0.6]].every(([a, b]) => { const [px, pz] = at(x, z, a, b); return clear(px, pz, 0.5); })
          && pumpsAt(x, z).filter(([px, pz]) => clear(px, pz, 0.6)).length >= Math.min(2, T.pumps);
        const spot = spots.find(fits);
        if (!spot) continue;
        const [x, z] = spot;
        items.push(x, groundAt(x, z), z, along, FURN.canopy, o.brand, T.canopyHeight, canopyFlags(true, cL, cW)); stats.canopies++;
        for (const [px, pz] of pumpsAt(x, z)) if (clear(px, pz, 0.6)) { items.push(px, groundAt(px, pz), pz, along, FURN.pump, o.brand, 0, 1); stats.pumps++; }
        placed = true;
        break;
      }
      if (!placed) stats.noRoom++;
    }
    // a drive-thru's menu board beside its lane (the service road nearest its building)
    if (cat.template === 'drive-thru' && bd) {
      const r = bd.rings[0]; let cx = 0, cz = 0; for (const p of r) { cx += p[0]; cz += p[1]; } cx /= r.length; cz /= r.length;
      const lane = nearestRoad(cx, cz, T.laneNear, true);
      if (lane) {
        const nx = -lane.tz, nz = lane.tx, side = (cx - lane.px) * nx + (cz - lane.pz) * nz > 0 ? 1 : -1;
        const x = lane.px + nx * side * (lane.hw + 0.9), z = lane.pz + nz * side * (lane.hw + 0.9);
        if (clear(x, z, 0.4)) { items.push(x, groundAt(x, z), z, Math.atan2(-nx * side, -nz * side), FURN.menuBoard, o.brand, 0, 1); stats.menuBoards++; } else stats.noRoom++;
      }
    }
    // a supermarket's trolley bays: in the car park nearest it (OSM's parking areas), either side of its middle
    if (cat.template === 'supermarket' && bd) {
      let best: number[][] | null = null, bestD = T.carParkNear;
      for (const r of parking) { let cx = 0, cz = 0; for (const p of r) { cx += p[0]; cz += p[1]; } cx /= r.length; cz /= r.length; const d = Math.hypot(cx - o.x, cz - o.z); if (d < bestD) { bestD = d; best = r; } }
      if (best) {
        let cx = 0, cz = 0; for (const p of best) { cx += p[0]; cz += p[1]; } cx /= best.length; cz /= best.length;
        for (const off of [-T.trolleyApart / 2, T.trolleyApart / 2]) { const x = cx + off, z = cz; if (insideRing(best, x, z) && clear(x, z, 1)) { items.push(x, groundAt(x, z), z, 0, FURN.trolleyBay, o.brand, 0, 1); stats.trolleyBays++; } }
      }
    }
  }
  return { items, stats };
}
