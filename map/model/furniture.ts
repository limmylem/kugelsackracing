// Map v5's street furniture (Step 5, and Step 1g's signs; MAP_README.md, 'Street furniture'): only where the map has it,
// placed by the road model so nothing stands in a lane — each piece at the kerb on the side traffic keeps to (the
// region style pack's drivingSide), facing the traffic it's for, clearance m out from the drawn road's edge.
//   traffic lights   at every approach of a junction OSM marks with traffic signals, a stop line's length (stopBack m)
//                    back from the junction, facing the approach; a phase group by the approach's direction (the
//                    game cycles the groups: data/map/v5.json furniture.cycle); mid-block signals both ways
//   stop, give way   OSM's stop and give_way points, at the kerb of the road they're on, facing the junction's approach
//   roundabouts      a give way and roundabout sign at each entry of a roundabout (its island found by its shape)
//   one way          ONE WAY where a one-way street leaves a junction, NO ENTRY where it comes into one
//   speed signs      where a road's maxspeed changes, speedIn m into the new limit, each way
//   street names     at a junction's corner between its two most important named roads — on the footpath or verge,
//                    never the road (Map v4 stood 46% of them in it) — the blades along their streets
//   bus stops        OSM's, at the kerb on their side, a shelter behind where OSM has one (shelter=yes, or a shelter
//                    mapped within shelterNear m)
//   power poles      OSM's poles and towers where they are (nudged off a road), the lines between them as wires
//   benches, bins, post boxes, hydrants, bollards   where OSM has them, off the road
//
//   const F = placeFurniture({ model, osm, surface, groundAt, style, cfg, box }) → { items (map/format/furniture.ts rows,
//   world frame), wires, signs ([x, y, z, angle, name, name] — map/bake/details.ts's sign rows), names, stats }

import type { OsmData } from '../bake/osmData.ts';
import { rowAt } from './geom.ts';
import { FURN, FURNITURE_STRIDE } from '../format/furniture.ts';

export function placeFurniture({ model, osm, surface, groundAt, style, cfg, box = null, roundabouts = [] }: { model: any; osm: OsmData; surface: any; groundAt: (x: number, z: number) => number; style: any; cfg: any; box?: [number, number, number, number] | null; roundabouts?: { x: number; z: number; r: number; ring: number[] }[] }) {
  const F = cfg.furniture, X = style.crossSection, left = (style.drivingSide ?? 'left') === 'left';
  const kerbW = X.kerbBevel + X.kerbTop;
  const items: number[] = [], wires: number[] = [], signs: number[] = [], names: string[] = [];
  const nameOf = (s: string) => { let k = names.indexOf(s); if (k < 0) { k = names.length; names.push(s); } return k; };
  const stats: Record<string, number> = { trafficLights: 0, stop: 0, giveWay: 0, speed: 0, roundabout: 0, oneWay: 0, noEntry: 0, nameSigns: 0, busStops: 0, shelters: 0, powerPoles: 0, wires: 0, small: 0, droppedInLane: 0 };
  const inBox = (x: number, z: number) => !box || (x >= box[0] && x < box[2] && z >= box[1] && z < box[3]);
  // (the block's segments — a share of the region's: nodes name theirs by id)
  const segs: any[] = model.segs, nodes: any[] = model.nodes, segById = new Map<number, any>(segs.map(g => [g.id, g]));
  // (the height to stand on: the highest surface there within a metre of the ground — a footpath, a verge, a kerb — or
  // the ground)
  const footAt = (x: number, z: number) => { const g = groundAt(x, z); let best: number | null = null; for (const h of surface.heightsAt(x, z)) if (Math.abs(h.y - g) < 1.2 && (best === null || h.y > best)) best = h.y; return best ?? g; };
  const inLane = (x: number, z: number, r = F.clearance) => surface.near(x, z, r);
  // a piece: off any lane (pushed out along `out` up to pushMax m, else dropped), in the box
  const put = (x: number, z: number, yaw: number, kind: number, a = 0, b = 0, flags = 0, out: [number, number] | null = null) => {
    let px = x, pz = z;
    if (inLane(px, pz)) {
      let ok = false;
      if (out) for (let d = 0.25; d <= F.pushMax; d += 0.25) { const qx = x + out[0] * d, qz = z + out[1] * d; if (!inLane(qx, qz)) { px = qx; pz = qz; ok = true; break; } }
      if (!ok) { stats.droppedInLane++; return false; }
    }
    if (!inBox(px, pz)) return false;
    items.push(px, footAt(px, pz), pz, yaw, kind, a, b, flags);
    return true;
  };
  // (a road side's kerb point s m along: the side traffic keeps to, for traffic going `dir` (+1 along the segment, −1
  // against), and the way it faces — towards that traffic. The model's side +1, along its normal, is to the right of
  // the segment's direction: map/model/geom.ts)
  const kerbPoint = (g: any, s: number, dir: number, extra = 0) => {
    const r = rowAt(g, s), travelRight = dir > 0 ? 1 : -1, side = left ? -travelRight : travelRight;
    const hw = side > 0 ? r.hwL : r.hwR, d = hw + kerbW + F.clearance + extra;
    const x = r.x + r.nx * side * d, z = r.z + r.nz * side * d;
    // (facing the traffic: against its way, the segment's direction there being (nz, −nx))
    const tx = r.nz * dir, tz = -r.nx * dir;
    return { x, z, yaw: Math.atan2(-tx, -tz), out: [r.nx * side, r.nz * side] as [number, number], tx, tz };
  };
  const L = (g: any) => g.s[g.s.length - 1];
  // (approaching a junction at the segment's start: going against it, the stop line trim + stopBack in; at its end:
  // along it — and only if traffic arrives that way)
  const approach = (g: any, atStart: boolean, back: number) => {
    const dir = atStart ? -1 : 1, arrives = !g.oneway || g.oneway === dir;
    const s = atStart ? Math.max(0, g.trim0) + back : L(g) - Math.max(0, g.trim1) - back;
    return { dir, arrives, s: Math.min(L(g), Math.max(0, s)) };
  };
  const grid = new Map<string, number[]>(), C = 30;
  segs.forEach((g, i) => { if (g.internal) return; for (let k = 0; k < g.xs.length; k++) { const key = `${Math.floor(g.xs[k] / C)},${Math.floor(g.zs[k] / C)}`; const l = grid.get(key) ?? grid.set(key, []).get(key)!; if (l[l.length - 1] !== i) l.push(i); } });
  const nearestSeg = (x: number, z: number, r: number) => {
    let best: { g: any; s: number; d: number; off: number } | null = null;
    for (let a = Math.floor((x - r) / C); a <= Math.floor((x + r) / C); a++) for (let b = Math.floor((z - r) / C); b <= Math.floor((z + r) / C); b++) for (const i of grid.get(`${a},${b}`) ?? []) {
      const g = segs[i];
      for (let k = 0; k + 1 < g.xs.length; k++) {
        const ax = g.xs[k], az = g.zs[k], dx = g.xs[k + 1] - ax, dz = g.zs[k + 1] - az, l2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
        if (d < r && (!best || d < best.d)) best = { g, s: g.s[k] + (g.s[k + 1] - g.s[k]) * t, d, off: ((x - ax) * -dz + (z - az) * dx) / Math.sqrt(l2) };
      }
    }
    return best;
  };
  const drivable = (g: any) => !g.internal && g.cls !== 'track' && !g.driveway && g.structure !== 'tunnel';

  // ---- traffic lights
  const signalled = new Set<number>();
  for (const p of osm.points) {
    if (p.tags.highway !== 'traffic_signals' || (box && !(p.x >= box[0] - 60 && p.x < box[2] + 60 && p.z >= box[1] - 60 && p.z < box[3] + 60))) continue;
    let best = -1, bd = F.signalReach;
    for (const c of model.clusters) { const d = Math.hypot(c.centre[0] - p.x, c.centre[1] - p.z); if (d < bd) { bd = d; best = c.id; } }
    if (best >= 0) { signalled.add(best); continue; }
    // (mid-block: a pedestrian crossing's lights, both ways)
    const h = nearestSeg(p.x, p.z, 12);
    if (!h || !drivable(h.g)) continue;
    for (const dir of [1, -1]) { if (h.g.oneway && h.g.oneway !== dir) continue; const k = kerbPoint(h.g, Math.max(0, Math.min(L(h.g), h.s - dir * F.stopBack)), dir); if (put(k.x, k.z, k.yaw, FURN.trafficLight, 0, F.trafficLightHeight, 0, k.out)) stats.trafficLights++; }
  }
  for (const cid of signalled) {
    const c = model.clusters.find((q: any) => q.id === cid);
    for (const A of c.arms) {
      const g = A.seg;
      if (!drivable(g)) continue;
      const ap = approach(g, A.atStart, F.stopBack);
      if (!ap.arrives) continue;
      const k = kerbPoint(g, ap.s, ap.dir);
      // (two phase groups: approaches within 45° of each other's line run together)
      const ang = Math.atan2(k.tz, k.tx), phase = Math.round(((ang % Math.PI) + Math.PI) % Math.PI / (Math.PI / 2)) % 2;
      if (put(k.x, k.z, k.yaw, FURN.trafficLight, phase, F.trafficLightHeight, 0, k.out)) stats.trafficLights++;
    }
  }
  // ---- roundabouts (found by their islands — map/model/crossSection.ts): a give way sign over a roundabout sign at
  // every entry, a stop line's length back, facing the traffic coming in (estimated: the map has no signs). OSM's own
  // give way points at an entry are then that sign
  const entrySigns: number[][] = [], ringSegs = new Set<number>(roundabouts.flatMap(R => R.ring));
  for (const R of roundabouts) {
    for (const c of model.clusters) {
      if (Math.hypot(c.centre[0] - R.x, c.centre[1] - R.z) > R.r + F.roundaboutReach) continue;
      for (const A of c.arms) {
        const g = A.seg;
        if (ringSegs.has(g.id) || !drivable(g)) continue;
        const ap = approach(g, A.atStart, F.stopBack);
        if (!ap.arrives) continue;
        const k = kerbPoint(g, ap.s, ap.dir);
        if (entrySigns.some(e => Math.hypot(e[0] - k.x, e[1] - k.z) < 4)) continue;
        if (put(k.x, k.z, k.yaw, FURN.roundabout, 0, 0, 1, k.out)) { stats.roundabout++; entrySigns.push([k.x, k.z]); }
      }
    }
  }
  // ---- one-way streets, at each junction (not a roundabout's ring): a ONE WAY sign where it leaves the junction,
  // along the street (its arrow the street's way, read from the cross street), and NO ENTRY where it comes in,
  // facing the traffic that would turn into it (estimated)
  // (a divided road's carriageways are one-way too, and get neither: a one-way road with a twin — the same name,
  // one-way the other way, within carriagewayAngle° of opposite and carriagewayGap m of it — or an arm beside it in
  // the junction, the same name or none, taking traffic the other way)
  const outOf = (A: any) => { const g = A.seg, r = rowAt(g, A.atStart ? Math.max(0, g.trim0) : L(g) - Math.max(0, g.trim1)), d = A.atStart ? 1 : -1; return [r.nz * d, -r.nx * d]; };
  const leavesBy = (A: any) => (A.atStart ? 1 : -1) === A.seg.oneway;
  const twinned = new Set<number>();
  {
    const CG = F.carriagewayGap, pieces = new Map<string, { g: any; x: number; z: number; dx: number; dz: number }[]>(), cosA = Math.cos(F.carriagewayAngle * Math.PI / 180);
    const piece = (g: any, k: number) => { const dx = (g.xs[k + 1] - g.xs[k]) * g.oneway, dz = (g.zs[k + 1] - g.zs[k]) * g.oneway, l = Math.hypot(dx, dz) || 1; return { g, x: (g.xs[k] + g.xs[k + 1]) / 2, z: (g.zs[k] + g.zs[k + 1]) / 2, dx: dx / l, dz: dz / l }; };
    for (const g of segs) if (g.oneway && g.name && !g.internal) for (let k = 0; k + 1 < g.xs.length; k++) { const p = piece(g, k), key = `${Math.floor(p.x / CG)},${Math.floor(p.z / CG)}`; (pieces.get(key) ?? pieces.set(key, []).get(key)!).push(p); }
    for (const g of segs) {
      if (!g.oneway || !g.name || g.internal) continue;
      const p = piece(g, Math.floor((g.xs.length - 1) / 2));
      search: for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const q of pieces.get(`${Math.floor(p.x / CG) + a},${Math.floor(p.z / CG) + b}`) ?? []) if (q.g !== g && q.g.name === g.name && p.dx * q.dx + p.dz * q.dz < -cosA && Math.hypot(q.x - p.x, q.z - p.z) < CG) { twinned.add(g.id); twinned.add(q.g.id); break search; }
    }
  }
  for (const c of model.clusters) {
    if (!inBox(c.centre[0], c.centre[1]) || c.arms.filter((A: any) => drivable(A.seg)).length < 3) continue;
    for (const A of c.arms) {
      const g = A.seg;
      if (!g.oneway || ringSegs.has(g.id) || twinned.has(g.id) || !drivable(g) || g.link || g.cls === 'service' || L(g) < 2 * F.oneWayIn + 4) continue;
      const o = outOf(A);
      if (c.arms.some((B: any) => B !== A && B.seg.oneway && leavesBy(B) !== leavesBy(A) && (!A.seg.name || !B.seg.name || A.seg.name === B.seg.name) && (() => { const q = outOf(B); return o[0] * q[0] + o[1] * q[1] > Math.cos(F.carriagewayAngle * Math.PI / 180); })())) continue;
      const leaves = leavesBy(A), s = A.atStart ? Math.max(0, g.trim0) + F.oneWayIn : L(g) - Math.max(0, g.trim1) - F.oneWayIn;
      if (leaves) {
        const k = kerbPoint(g, s, g.oneway);
        // (its face across the street, the arrow — the face's right — along it: map/render/furniture.ts)
        if (put(k.x, k.z, Math.atan2(-k.tz, k.tx), FURN.oneWay, 0, 0, 1, k.out)) stats.oneWay++;
      } else {
        const k = kerbPoint(g, s, -g.oneway);
        if (put(k.x, k.z, k.yaw, FURN.noEntry, 0, 0, 1, k.out)) stats.noEntry++;
      }
    }
  }
  // ---- stop and give way signs: at their point on the road, for the traffic heading to the nearer end
  for (const p of osm.points) {
    const t = p.tags.highway;
    if ((t !== 'stop' && t !== 'give_way') || !inBox(p.x, p.z)) continue;
    const h = nearestSeg(p.x, p.z, 12);
    if (!h || !drivable(h.g)) continue;
    const toEnd = L(h.g) - h.s < h.s, dir = toEnd ? 1 : -1;
    if (h.g.oneway && h.g.oneway !== dir) continue;
    const k = kerbPoint(h.g, h.s, dir);
    if (t === 'give_way' && entrySigns.some(e => Math.hypot(e[0] - k.x, e[1] - k.z) < F.entrySignNear)) continue;
    if (put(k.x, k.z, k.yaw, t === 'stop' ? FURN.stop : FURN.giveWay, 0, 0, 0, k.out)) stats[t === 'stop' ? 'stop' : 'giveWay']++;
  }
  // ---- speed signs: where the limit changes from one road to the next through a node, speedIn m into the new one
  for (const n of nodes) {
    const here = n.segs.map((i: number) => segById.get(i)).filter((g: any) => g && drivable(g) && g.maxspeed);
    if (here.length < 2 || !inBox(n.x, n.z)) continue;
    for (const g of here) {
      const atStart = nodes[g.from] === n, others = here.filter((o: any) => o !== g && o.name === g.name);
      if (!others.length || others.every((o: any) => o.maxspeed === g.maxspeed)) continue;
      const dir = atStart ? 1 : -1;
      if (g.oneway && g.oneway !== dir) continue;
      const s = atStart ? Math.min(L(g), Math.max(0, g.trim0) + F.speedIn) : Math.max(0, L(g) - Math.max(0, g.trim1) - F.speedIn);
      const k = kerbPoint(g, s, dir);
      if (put(k.x, k.z, k.yaw, FURN.speed, Math.round(g.maxspeed), 0, 0, k.out)) stats.speed++;
    }
  }
  // ---- street name signs at a junction's corner
  for (const c of model.clusters) {
    if (!inBox(c.centre[0], c.centre[1])) continue;
    const arms = c.arms.filter((A: any) => A.seg.name && drivable(A.seg));
    const byName = new Map<string, any>(); for (const A of arms.sort((p: any, q: any) => q.seg.rank - p.seg.rank)) if (!byName.has(A.seg.name)) byName.set(A.seg.name, A);
    if (byName.size < 2) continue;
    const [A, B] = [...byName.values()];
    const out = (Q: any) => { const s = Q.atStart ? Math.max(0, Q.seg.trim0) : L(Q.seg) - Math.max(0, Q.seg.trim1), r = rowAt(Q.seg, s), d = Q.atStart ? 1 : -1; return { x: r.x, z: r.z, ux: r.nz * d, uz: -r.nx * d, hw: Math.max(r.hwL, r.hwR) }; };
    const a = out(A), b = out(B), cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
    let placed = false;
    for (const [sa, sb] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      let bx = a.ux * sa + b.ux * sb, bz = a.uz * sa + b.uz * sb; const bl = Math.hypot(bx, bz);
      if (bl < 0.2) continue;
      bx /= bl; bz /= bl;
      const half = Math.acos(Math.max(-1, Math.min(1, a.ux * sa * bx + a.uz * sa * bz))), clear = Math.max(a.hw, b.hw) + kerbW + F.clearance + 0.6;
      const d = Math.min(F.signReach, clear / Math.max(0.2, Math.sin(half)));
      const x = cx + bx * d, z = cz + bz * d;
      if (inLane(x, z, F.clearance + 0.2) || !inBox(x, z)) continue;
      signs.push(x, footAt(x, z), z, -Math.atan2(a.uz, a.ux), nameOf(A.seg.name), nameOf(B.seg.name));
      stats.nameSigns++; placed = true; break;
    }
    if (!placed) stats.droppedInLane++;
  }
  // ---- bus stops (and shelters), at the kerb on their side
  const shelters = osm.points.filter(p => p.tags.amenity === 'shelter' || p.tags.shelter_type === 'public_transport');
  for (const p of osm.points) {
    if (p.tags.highway !== 'bus_stop' || !inBox(p.x, p.z)) continue;
    const h = nearestSeg(p.x, p.z, 25);
    if (!h || !drivable(h.g)) continue;
    // (the stop's side: the one it's mapped on; its traffic: the one keeping to that side)
    const side = h.off >= 0 ? 1 : -1, dir = (left ? -side : side) > 0 ? 1 : -1;
    const k = kerbPoint(h.g, h.s, dir);
    const shelter = p.tags.shelter === 'yes' || shelters.some(q => Math.hypot(q.x - p.x, q.z - p.z) < F.shelterNear);
    if (put(k.x, k.z, k.yaw, FURN.busStop, shelter ? 1 : 0, 0, 0, k.out)) {
      stats.busStops++;
      if (shelter) { const sx = k.x + k.out[0] * F.shelterBack, sz = k.z + k.out[1] * F.shelterBack, yaw = Math.atan2(-k.out[0], -k.out[1]); if (put(sx, sz, yaw, FURN.shelter, 0, 0, 0, k.out)) stats.shelters++; }
    }
  }
  // ---- power poles and their wires
  const poleAt = new Map<number, number[]>();
  for (const p of osm.points) {
    if (p.tags.power !== 'pole' && p.tags.power !== 'tower') continue;
    if (box && !(p.x >= box[0] - 80 && p.x < box[2] + 80 && p.z >= box[1] - 80 && p.z < box[3] + 80)) continue;
    const h = p.tags.power === 'tower' ? F.towerHeight : style.furniture?.powerPole?.height ?? F.poleHeight;
    const near = nearestSeg(p.x, p.z, 20), out: [number, number] | null = near ? [near.off >= 0 ? near.g.nx?.[0] ?? 0 : -(near.g.nx?.[0] ?? 0), near.off >= 0 ? near.g.nz?.[0] ?? 0 : -(near.g.nz?.[0] ?? 0)] : null;
    let x = p.x, z = p.z;
    if (inLane(x, z) && out) for (let d = 0.25; d <= F.pushMax; d += 0.25) if (!inLane(p.x + out[0] * d, p.z + out[1] * d)) { x = p.x + out[0] * d; z = p.z + out[1] * d; break; }
    if (inLane(x, z)) { stats.droppedInLane++; continue; }
    const y = footAt(x, z);
    poleAt.set(p.id, [x, y + h, z]);
    if (inBox(x, z)) { items.push(x, y, z, near ? Math.atan2(near.g.nz?.[0] ?? 0, near.g.nx?.[0] ?? 1) : 0, p.tags.power === 'tower' ? FURN.pylon : FURN.powerPole, h, 0, 0); stats.powerPoles++; }
  }
  for (const w of osm.lines) {
    if (w.tags.power !== 'line' && w.tags.power !== 'minor_line') continue;
    for (let q = 0; q + 1 < w.nodes.length; q++) {
      const a = poleAt.get(w.nodes[q].id), b = poleAt.get(w.nodes[q + 1].id);
      if (!a || !b || !inBox((a[0] + b[0]) / 2, (a[2] + b[2]) / 2) || Math.hypot(a[0] - b[0], a[2] - b[2]) > F.maxSpan) continue;
      wires.push(...a, ...b); stats.wires++;
    }
  }
  // ---- small things where they're mapped
  const SMALL: Record<string, number> = { bench: FURN.bench, waste_basket: FURN.bin, post_box: FURN.postBox };
  for (const p of osm.points) {
    const kind = SMALL[p.tags.amenity] ?? (p.tags.emergency === 'fire_hydrant' ? FURN.hydrant : p.tags.barrier === 'bollard' ? FURN.bollard : 0);
    if (!kind || !inBox(p.x, p.z)) continue;
    const h = nearestSeg(p.x, p.z, 25), yaw = h ? Math.atan2(-(p.x - (h.g.xs[0])), -(p.z - h.g.zs[0])) : 0;
    const out: [number, number] | null = h ? (() => { const r = rowAt(h.g, h.s), sd = h.off >= 0 ? 1 : -1; return [r.nx * sd, r.nz * sd] as [number, number]; })() : null;
    // (a bench faces the road: towards the nearest point of it)
    const r = h ? rowAt(h.g, h.s) : null, face = r ? Math.atan2(r.x - p.x, r.z - p.z) : yaw;
    if (put(p.x, p.z, face, kind, 0, 0, 0, out)) stats.small++;
  }
  return { items, wires, signs, names, stats, stride: FURNITURE_STRIDE };
}
