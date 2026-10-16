// Map v5's road markings (Step 5; MAP_README.md, 'Markings'), on top of Map v4's lane lines, stop lines and zebras
// (map/model/surface.ts) and into the same mesh, the road's marks:
//
//  · turn arrows in each lane coming into a junction with traffic lights (OSM's traffic_signals within
//    furniture.signalReach of it, as map/model/furniture.ts finds them) of three streets or more (arms not of
//    minorArms' classes), arrowBack m before it, on approaches with
//    arrowMinLanes lanes or more coming in. Each lane's arrows are its turn:lanes where OSM has them; otherwise they
//    are estimated from the junction's arms (counted in stats.arrowsEstimated): the kerb lane turns towards the kerb
//    (and goes straight on as well if an arm is ahead), the innermost lane turns away from it (and straight on), and
//    the lanes between go straight on
//  · a bicycle lane where OSM tags one (cycleway, cycleway:left|right|both = lane): its line bikeLane m in from the
//    kerb, a bicycle painted in it every bikeSymbolEvery m, and green paint for greenAtEnds m where it meets a junction
//  · a bus lane where it's tagged (busway, busway:left|right = lane): the kerb lane, its line, painted in the style
//    pack's colour for paintAtEnds m at each end
//  (OSM's copy has no keep-clear areas or painted medians for this region, so neither is drawn)
//
// The lanes are the ones Map v4 draws lines between: lanes / 2 each way from the centre line on a two-way road, all
// of them across a one-way road, lane m wide (data/map/v4.json widths). The road model's side +1 (along its normal)
// is on the right of a segment's direction (map/model/geom.ts), and OSM's :left and :right are the way's own sides.
//
//   markingsV5({ model, points, tagsOf, surface, style, cfg, box }) → { mesh (map/model/surface.ts's Mesh), stats }

import earcut from 'earcut';
import { rowAt } from './geom.ts';

const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
// (shapes in a lane's own frame: f metres forward from the arrow's tip, r metres to the right of travel)
const SHAFT = (f0: number, f1: number, w = 0.15) => [[f0, -w], [f1, -w], [f1, w], [f0, w]];
const HEAD = (f: number, w = 0.45, l = 1.2) => [[f, -w], [f + l, 0], [f, w]];
// (a turn: the shaft bending off to one side, sd −1 left and 1 right, and a head pointing that way)
const BEND = (f: number, sd: number) => [[f - 0.15, -sd * 0.15], [f + 0.15, sd * 0.15], [f + 0.85, sd * 0.85], [f + 0.6, sd * 1.05]];
const SIDE_HEAD = (f: number, sd: number) => [[f + 0.35, sd * 1.35], [f + 1.15, sd * 0.55], [f + 1.25, sd * 1.65]];

export function markingsV5({ model, points, tagsOf, surface, style, cfg, box }: { model: any; points: any[]; tagsOf: (g: any) => Record<string, string> | undefined; surface: any; style: any; cfg: any; box: number[] }) {
  const M = cfg.markingsV5, S = style.markingColours ?? {}, W = cfg.widths;
  const out = { positions: [] as number[], colours: [] as number[], indices: [] as number[], surfaces: [] as number[], solid: [] as number[], level: [] as number[], seg: [] as number[] };
  const stats = { arrows: 0, arrowsTagged: 0, arrowsEstimated: 0, bikeLanes: 0, bikeSymbols: 0, busLanes: 0, offSurface: 0 };
  const white = hex(S.white ?? '#e8e8e2'), green = hex(S.bikeLane ?? '#3f8a4a'), busC = hex(S.busLane ?? '#a8473a'), left = style.drivingSide !== 'right', lift = cfg.surface.markingLift + M.lift;
  // (the area whose markings the block draws: its box and a margin, so a mark across its edge is whole in both blocks'
  // tiles — each tile keeps the part inside it)
  const reach = [box[0] - M.margin, box[1] - M.margin, box[2] + M.margin, box[3] + M.margin];
  const near = (x: number, z: number) => x >= reach[0] && x < reach[2] && z >= reach[1] && z < reach[3];
  // (the drawn road's height there: its surface nearest the road model's own height, none if it's not there)
  const yAt = (x: number, z: number, h: number) => { let best: number | null = null; for (const q of surface.heightsAt(x, z) as any[]) if (!q.part && Math.abs(q.y - h) < M.maxStep && (best === null || Math.abs(q.y - h) < Math.abs(best - h))) best = q.y; return best; };
  // a polygon in a lane's frame (origin x, z, travelling fx, fz) laid on the road: false where any corner is off it
  const poly = (pts: number[][], x: number, z: number, fx: number, fz: number, h: number, colour: number[], seg: number) => {
    const world = pts.map(([f, r]) => [x + fx * f - fz * r, z + fz * f + fx * r]);
    const ys = world.map(([wx, wz]) => yAt(wx, wz, h));
    if (ys.some(y => y === null)) { stats.offSurface++; return false; }
    const base = out.positions.length / 3, P = out.positions;
    world.forEach(([wx, wz], q) => { P.push(wx, ys[q]! + lift, wz); out.colours.push(colour[0], colour[1], colour[2], 255); });
    const tris = earcut(world.flat());
    for (let t = 0; t < tris.length; t += 3) {
      const a = base + tris[t], b = base + tris[t + 1], c = base + tris[t + 2];
      // (facing up, wound as map/model/surface.ts winds the road's; none with no area)
      const ny = (P[b * 3 + 2] - P[a * 3 + 2]) * (P[c * 3] - P[a * 3]) - (P[b * 3] - P[a * 3]) * (P[c * 3 + 2] - P[a * 3 + 2]);
      if (Math.abs(ny) < 1e-8) continue;
      out.indices.push(...(ny < 0 ? [a, c, b] : [a, b, c])); out.surfaces.push(0); out.solid.push(0); out.level.push(0); out.seg.push(seg);
    }
    return true;
  };
  // a point s m along g, off m along its normal (to the right of its direction), with the direction there and the
  // road model's height
  const at = (g: any, s: number, off: number) => {
    const r = rowAt(g, Math.max(0, Math.min(g.s[g.s.length - 1], s))), H = g.hd ?? g.h;
    let k = 0; while (k < g.s.length - 2 && g.s[k + 1] < r.s) k++;
    const f = (r.s - g.s[k]) / ((g.s[k + 1] - g.s[k]) || 1);
    return { x: r.x + r.nx * off * r.mitre, z: r.z + r.nz * off * r.mitre, fx: r.nz, fz: -r.nx, h: H ? H[k] + (H[k + 1] - H[k]) * f : 0, r };
  };
  const marked = (g: any) => !g.internal && !['service', 'track', 'path'].includes(g.cls) && g.surface !== 'gravel' && g.surface !== 'dirt';
  const laneW = (g: any) => (W.classes[g.link ? 'link' : g.cls]?.lane ?? W.laneWidth) * W.multiplier;

  // ---- turn arrows at the junctions with traffic lights
  const signalled = new Set<number>();
  for (const p of points) {
    if (p.tags.highway !== 'traffic_signals' || !near(p.x, p.z)) continue;
    let best = -1, bd = cfg.furniture.signalReach;
    for (const c of model.clusters) { const d = Math.hypot(c.centre[0] - p.x, c.centre[1] - p.z); if (d < bd) { bd = d; best = c.id; } }
    if (best >= 0) signalled.add(best);
  }
  for (const c of model.clusters) {
    // (a junction of roads: three arms or more that are streets — a pedestrian crossing's lights by a lane or a car
    // park's way in get none)
    if (!signalled.has(c.id) || c.arms.filter((A: any) => marked(A.seg) && !M.minorArms.includes(A.seg.cls)).length < 3) continue;
    // (each arm's way out of the junction)
    const outDir = c.arms.map((A: any) => { const g = A.seg, L = g.s[g.s.length - 1], a = at(g, A.atStart ? A.trim : L - A.trim, 0), b = at(g, A.atStart ? Math.min(L, A.trim + 10) : Math.max(0, L - A.trim - 10), 0), dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; });
    c.arms.forEach((A: any, ai: number) => {
      const g = A.seg, L = g.s[g.s.length - 1];
      if (!marked(g) || g.link || g.structure === 'tunnel') return;
      // (the traffic coming in along this arm: against the segment at its start, along it at its end)
      const dir = A.atStart ? -1 : 1;
      if (g.oneway && g.oneway !== dir) return;
      const lanes = Math.max(1, g.lanes ?? 1), nIn = g.oneway ? lanes : Math.floor(lanes / 2), lw = laneW(g);
      if (nIn < M.arrowMinLanes) return;
      const s = A.atStart ? A.trim + M.arrowBack : L - A.trim - M.arrowBack;
      if (s < M.arrowLength || s > L - M.arrowLength) return;
      // (where the other arms go, seen from this one's travel: the angle to each, + to the right — x east, z south)
      const inX = -outDir[ai][0], inZ = -outDir[ai][1];
      const turns = outDir.filter((_: any, q: number) => q !== ai).map((d: number[]) => Math.atan2(inX * d[1] - inZ * d[0], inX * d[0] + inZ * d[1]) * 180 / Math.PI);
      const ahead = turns.some((a: number) => Math.abs(a) < M.aheadWithin), toLeft = turns.some((a: number) => a <= -M.aheadWithin && a > -M.turnWithin), toRight = turns.some((a: number) => a >= M.aheadWithin && a < M.turnWithin);
      // (the kerb's side, along the normal: on the left of travel, or the right where traffic keeps right)
      const kerb = left ? -dir : dir, kerbTurn = left ? toLeft : toRight, farTurn = left ? toRight : toLeft, kerbWay = left ? 'left' : 'right', farWay = left ? 'right' : 'left';
      // (OSM's turn:lanes, its lanes left to right looking along the traffic: forward along the way, backward against it)
      const tag = g.oneway === -1 ? undefined : tagsOf(g)?.[g.oneway ? 'turn:lanes' : dir > 0 ? 'turn:lanes:forward' : 'turn:lanes:backward'];
      const tagged = tag?.split('|');
      const ok = !!tagged && tagged.length === nIn;
      for (let i = 0; i < nIn; i++) {
        // (lane i counted from the kerb: its middle's offset from the centre line)
        const fromCentre = g.oneway ? lanes * lw / 2 - (i + 0.5) * lw : (nIn - i - 0.5) * lw, p = at(g, s, kerb * fromCentre);
        if (!near(p.x, p.z) || fromCentre > (kerb > 0 ? p.r.dL : p.r.dR) - lw / 4) continue;
        const fx = p.fx * dir, fz = p.fz * dir;
        let ways: string[];
        if (ok) ways = tagged![left ? i : nIn - 1 - i].split(';').map(w => w.trim());
        else ways = i === 0 && kerbTurn ? (ahead ? [kerbWay, 'through'] : [kerbWay]) : i === nIn - 1 && farTurn ? (ahead ? [farWay, 'through'] : [farWay]) : ['through'];
        let drawn = false;
        for (const w of ways) {
          if (/(^|_)(left|right)$/.test(w) && !/merge/.test(w)) { const sd = /left$/.test(w) ? -1 : 1; drawn = (poly(SHAFT(-M.arrowLength, -2.2), p.x, p.z, fx, fz, p.h, white, g.id) && poly(BEND(-2.2, sd), p.x, p.z, fx, fz, p.h, white, g.id) && poly(SIDE_HEAD(-2.2, sd), p.x, p.z, fx, fz, p.h, white, g.id)) || drawn; }
          else if (w === 'through' || (!ok && w === '')) drawn = (poly(SHAFT(-M.arrowLength, -1.2), p.x, p.z, fx, fz, p.h, white, g.id) && poly(HEAD(-1.2), p.x, p.z, fx, fz, p.h, white, g.id)) || drawn;
        }
        if (drawn) { stats.arrows++; if (ok) stats.arrowsTagged++; else stats.arrowsEstimated++; }
      }
    });
  }

  // ---- bicycle and bus lanes, where they're tagged
  for (const g of model.segs) {
    if (!marked(g)) continue;
    const t = tagsOf(g); if (!t) continue;
    const L = g.s[g.s.length - 1], lane = (v?: string) => v === 'lane';
    if (L < 2 * M.laneEndSkip + M.step) continue;
    for (const osmSide of ['left', 'right']) {
      const cyc = lane(t[`cycleway:${osmSide}`]) || lane(t['cycleway:both']) || (lane(t.cycleway) && (!g.oneway || osmSide === (left ? 'left' : 'right')));
      const bus = lane(t[`busway:${osmSide}`]) || (lane(t.busway) && (!g.oneway || osmSide === (left ? 'left' : 'right')));
      if (!cyc && !bus) continue;
      // (the side along the normal, and the way its traffic goes: along the way on its left where traffic keeps left)
      const side = osmSide === 'right' ? 1 : -1, travel = g.oneway ? (g.oneway as number) : (side < 0) === left ? 1 : -1;
      const piece = (s0: number, s1: number, o0: number, o1: number, colour: number[]) => {
        const a = at(g, s0, side * o0), b = at(g, s1, side * o0), len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 0.05 || !near(a.x, a.z)) return false;
        const fx = (b.x - a.x) / len, fz = (b.z - a.z) / len, w0 = side * (o1 - o0);
        // (r to the right of (fx, fz), which runs along the segment)
        return poly([[0, 0], [len, 0], [len, w0], [0, w0]], a.x, a.z, fx, fz, (a.h + b.h) / 2, colour, g.id);
      };
      const ends = (s: number) => s < M.laneEndSkip + M.paintAtEnds || s > L - M.laneEndSkip - M.paintAtEnds;
      const dHalf = (s: number) => { const r = rowAt(g, s); return side > 0 ? r.dL : r.dR; };
      for (let s = M.laneEndSkip; s < L - M.laneEndSkip - 0.1; s += M.step) {
        const e = Math.min(s + M.step, L - M.laneEndSkip), d = dHalf(s);
        if (cyc) {
          piece(s, e, d - M.bikeLane - M.lineWidth / 2, d - M.bikeLane + M.lineWidth / 2, white);
          if (ends(s)) piece(s, e, d - M.bikeLane + M.lineWidth, d - 0.1, green);
        }
        if (bus) {
          const inner = d - (cyc ? M.bikeLane : 0) - M.busLane;
          piece(s, e, inner - M.busLineWidth / 2, inner + M.busLineWidth / 2, white);
          if (ends(s)) piece(s, e, inner + M.busLineWidth, d - (cyc ? M.bikeLane + M.lineWidth : 0.1), busC);
        }
      }
      if (bus) stats.busLanes++;
      if (cyc) {
        stats.bikeLanes++;
        // (a bicycle seen side on, laid in the lane facing the way it goes: two wheels, the frame, the seat and the bars)
        const wheel = (cf: number) => Array.from({ length: 12 }, (_, q) => { const a0 = q / 12 * 2 * Math.PI, a1 = (q + 1) / 12 * 2 * Math.PI, R = 0.34, r = 0.25; return [[cf + R * Math.cos(a0), R * Math.sin(a0)], [cf + R * Math.cos(a1), R * Math.sin(a1)], [cf + r * Math.cos(a1), r * Math.sin(a1)], [cf + r * Math.cos(a0), r * Math.sin(a0)]]; });
        const bar = (a: number[], b: number[], w = 0.045) => { const dx = b[0] - a[0], dr = b[1] - a[1], l = Math.hypot(dx, dr) || 1, nx = -dr / l * w, nr = dx / l * w; return [[a[0] - nx, a[1] - nr], [b[0] - nx, b[1] - nr], [b[0] + nx, b[1] + nr], [a[0] + nx, a[1] + nr]]; };
        const hub0 = [-0.6, 0], crank = [-0.05, 0], seat = [-0.2, -0.5], head = [0.42, -0.5], hub1 = [0.6, 0];
        const bike = [...wheel(-0.6), ...wheel(0.6), bar(hub0, crank), bar(crank, seat), bar(seat, head), bar(crank, head), bar(head, hub1), bar(hub0, seat), bar([-0.35, -0.55], [-0.05, -0.55], 0.06), bar([0.36, -0.66], [0.5, -0.5])];
        for (let s = M.laneEndSkip + M.bikeSymbolEvery / 2; s < L - M.laneEndSkip; s += M.bikeSymbolEvery) {
          const d = dHalf(s), a = at(g, s, side * (d - M.bikeLane / 2));
          if (!near(a.x, a.z)) continue;
          const fx = a.fx * travel, fz = a.fz * travel;
          if (bike.map(pg => poly(pg, a.x, a.z, fx, fz, a.h, white, g.id)).every(Boolean)) stats.bikeSymbols++;
        }
      }
    }
  }
  return { mesh: out, stats };
}
