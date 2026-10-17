// Map v4's junctions (the road surface model, map/model/): which nodes are junctions, how far each road is
// trimmed back from one, which junctions are close enough to share one patch (a cluster: the two carriageways
// of a divided road crossing another, a slip road's fork, a roundabout's entry), and each patch's outline.
//
//  · A node is a joint (two roads meeting end to end, nearly straight, nearly the same width — and every
//    tile-border node): one cross-section shared by both, its sides set across the bend, the widths tapered to
//    meet. Otherwise (three roads or more, a sharp turn, a big change of width) it's a junction. One road is an
//    end (a dead end's cap).
//  · Each road at a junction (an arm) is trimmed back to where its edges meet its neighbours' — the first
//    crossing of its edge facing the next arm round with that arm's facing edge — plus the corner's kerb
//    round (r / tan(θ/2), at most 2r), at least minTrim, at most maxTrim: very acute angles, T-junctions, Y-
//    junctions and 5-way junctions all come out of the same rule.
//  · Two junctions whose trims leave less than minRibbon of road between them (or closer than mergeDistance)
//    become one cluster with one patch; the roads between them are inside it.
//  · A cluster's patch is the union of its nodes' centres, the trimmed-off ends of its roads, the roads inside
//    it and each corner's curve (a quadratic from edge to edge round the crossing): one polygon, holes kept
//    (a median inside a big junction stays a median), each road's trimmed end exactly on its boundary (the
//    cross-section's points put into it), so the patch and the roads share their vertices.
//
//   const T = buildTopology(G, cfg)   → { clusters: [{ id, nodes, arms: [{ seg, atStart, trim }], internal, rings }], stats }
//   sets node.kind ('junction' | 'joint' | 'end'), node.cluster, seg.trim0 / trim1 (m; −capLength at a dead end),
//   seg.internal; and the normals at joints (geom.ts prepareNormals first)

import * as Clipper from 'clipper2-js';
import './clipperGuard.ts';   // (Clipper2-js's own bugs, worked round: map/model/clipperGuard.ts)
import earcut from 'earcut';
import libtess from 'libtess';
import type { MNode, Seg } from './graph.ts';
import { at, firstCrossing, polygonArea, prepareNormals, rowAt } from './geom.ts';

export let debugPieces: any[] | null = null;
export function collectPieces(on: boolean) { debugPieces = on ? [] : null; return () => debugPieces; }
export interface Arm { seg: Seg; atStart: boolean; node: number; angle: number; trim: number; required: number; L: number }
export interface Cluster { id: number; nodes: number[]; arms: Arm[]; internal: number[]; rings: number[][][][]; centre: number[]; tris?: number[][]; corners: any[] }

// an arm's own frame: s' m out from its node; side +1 its left looking outwards
export const armS = (a: { seg: Seg; atStart: boolean }, sp: number) => (a.atStart ? sp : a.seg.s[a.seg.s.length - 1] - sp);
export const armSide = (a: { atStart: boolean }, side: number) => (a.atStart ? side : -side);
export function armEdge(a: { seg: Seg; atStart: boolean }, sp: number, side: number, which: 'visual' | 'drivable' = 'visual') {
  const r = rowAt(a.seg, armS(a, sp)), ss = armSide(a, side), hw = which === 'visual' ? (ss > 0 ? r.hwL : r.hwR) : (ss > 0 ? r.dL : r.dR);
  return at(r, ss * hw);
}
// the arm's cross-section at s', from its left edge to its right (looking out): the 5 points the road's own row has
export function armRow(a: { seg: Seg; atStart: boolean }, sp: number) {
  const r = rowAt(a.seg, armS(a, sp)), pts = rowPoints(r);
  return a.atStart ? pts : pts.slice().reverse();
}
// a row's 5 points, the segment's left edge first: visual, drivable (the kerb's inner edge), crown, …
export function rowPoints(r: any) {
  const offs = [r.hwL, r.dL, 0, -r.dR, -r.hwR];
  return offs.map(o => at(r, o));
}

export function buildTopology(G: { nodes: MNode[]; segs: Seg[] }, cfg: any) {
  const J = cfg.junctions, W = cfg.widths, gcfg = cfg.graph;
  for (const g of G.segs) prepareNormals(g, 1.6, gcfg.normalSmooth ?? 0);
  const stats: any = { junctions: 0, joints: 0, ends: 0, clusters: 0, merged: 0, clamped: 0, extended: 0, unresolvedCorners: 0, unionFailures: 0, crossTrims: 0 };
  const armsAt = (k: number) => G.nodes[k].segs.flatMap(i => { const g = G.segs[i], out: { seg: Seg; atStart: boolean }[] = []; if (g.from === k) out.push({ seg: g, atStart: true }); if (g.to === k) out.push({ seg: g, atStart: false }); return out; });
  // (each arm's direction out of its node: towards its point min(4 m, half its length) out)
  const outDir = (a: { seg: Seg; atStart: boolean }) => { const L = a.seg.s[a.seg.s.length - 1], r0 = rowAt(a.seg, armS(a, 0)), r1 = rowAt(a.seg, armS(a, Math.min(4, L / 2))), dx = r1.x - r0.x, dz = r1.z - r0.z, l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
  const widthAt = (a: { seg: Seg; atStart: boolean }) => { const r = rowAt(a.seg, armS(a, 0)); return r.hwL + r.hwR; };

  // ---- 1. what each node is
  for (const [k, n] of G.nodes.entries()) {
    const arms = armsAt(k);
    n.arms = arms.length;
    // (a node no road uses any more — one of a road given twice, dropped: map/model/graph.ts — is nothing)
    if (arms.length === 0) { n.kind = 'end'; continue; }
    if (arms.length === 1) { n.kind = 'end'; stats.ends++; continue; }
    if (arms.length === 2 && arms[0].seg !== arms[1].seg) {
      const a = outDir(arms[0]), b = outDir(arms[1]), turn = 180 - Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]))) * 180 / Math.PI;
      if (n.border || (turn <= gcfg.jointMaxTurn && Math.abs(widthAt(arms[0]) - widthAt(arms[1])) <= gcfg.jointMaxWidthChange)) { n.kind = 'joint'; stats.joints++; continue; }
    }
    n.kind = 'junction'; stats.junctions++;
  }
  // ---- 2. joints: one cross-section, sideways across the bend, the widths meeting there
  for (const [k, n] of G.nodes.entries()) {
    if (n.kind !== 'joint') continue;
    const [A, B] = armsAt(k), a = outDir(A), b = outDir(B);
    // (the way through: in along A, out along B)
    let tx = b[0] - a[0], tz = b[1] - a[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const N = [-tz, tx];
    // each side's half width there: the average of the two roads' (their own left or right, as it lies through)
    const sides = [A, B].map(arm => {
      const g = arm.seg, e = arm.atStart ? 0 : g.xs.length - 1, dirSame = (arm.atStart ? 1 : -1) * (arm === B ? 1 : -1) > 0;
      // (this segment runs the way through if it leaves the node along B, or arrives along A)
      return { g, e, along: dirSame, L: [g.hwL[e], g.dL[e]], R: [g.hwR[e], g.dR[e]] };
    });
    const throughL = sides.map(s => (s.along ? s.L : s.R)), throughR = sides.map(s => (s.along ? s.R : s.L));
    const JL = [(throughL[0][0] + throughL[1][0]) / 2, (throughL[0][1] + throughL[1][1]) / 2], JR = [(throughR[0][0] + throughR[1][0]) / 2, (throughR[0][1] + throughR[1][1]) / 2];
    for (const s of sides) {
      const g = s.g, e = s.e, Lw = s.along ? JL : JR, Rw = s.along ? JR : JL;
      g.fixedNormal ??= []; g.fixedNormal[e] = true;
      // (Map v5, jointMitre: mitred like any bend, its edges the roads' own width from each — a joint on a tile's
      // border can turn a car park's right angle, and at 1 its inner corner was cut off)
      g.nx[e] = s.along ? N[0] : -N[0]; g.nz[e] = s.along ? N[1] : -N[1]; g.mitre[e] = gcfg.jointMitre ? Math.min(1.6, 1 / Math.max(1e-6, tx * b[0] + tz * b[1])) : 1;
      // (tapered: the change fades over taperLength m from the joint)
      const L = g.s[g.s.length - 1], fromEnd = (q: number) => (e === 0 ? g.s[q] : L - g.s[q]);
      const dl = [Lw[0] - g.hwL[e], Lw[1] - g.dL[e]], dr = [Rw[0] - g.hwR[e], Rw[1] - g.dR[e]];
      for (let q = 0; q < g.xs.length; q++) {
        const f = Math.max(0, 1 - fromEnd(q) / W.taperLength);
        if (f <= 0) continue;
        g.hwL[q] += dl[0] * f; g.dL[q] += dl[1] * f; g.hwR[q] += dr[0] * f; g.dR[q] += dr[1] * f;
      }
    }
  }
  // ---- 3. junction arms and their trims
  const arms = new Map<number, Arm[]>(), corners = new Map<number, any[]>();
  for (const [k, n] of G.nodes.entries()) {
    if (n.kind !== 'junction') continue;
    const list: Arm[] = armsAt(k).map(a => { const d = outDir(a); return { ...a, node: k, angle: Math.atan2(d[1], d[0]), trim: 0, required: J.minTrim, L: a.seg.s[a.seg.s.length - 1] }; }).sort((p, q) => p.angle - q.angle);
    const cs: any[] = [];
    for (let q = 0; q < list.length; q++) {
      const A = list[q], B = list[(q + 1) % list.length];
      if (A === B) continue;
      let theta = B.angle - A.angle; if (theta <= 0) theta += 2 * Math.PI;
      if (theta >= Math.PI - 0.03) { cs.push({ A, B, open: true, theta }); continue; }
      // (the edges, sampled out to as far as either may be trimmed)
      const reachA = Math.min(J.maxTrim, A.L), reachB = Math.min(J.maxTrim, B.L);
      const samples = (a: Arm, reach: number, side: number) => { const ss = a.seg.s, Lg = a.L, sp = a.atStart ? ss.filter(v => v > 0 && v < reach) : ss.map(v => Lg - v).filter(v => v > 0 && v < reach).reverse(); const list2 = [0, ...sp, reach]; return { s: list2, pts: list2.map(v => armEdge(a, v, side)) }; };
      const ea = samples(A, reachA, +1), eb = samples(B, reachB, -1), c = firstCrossing(ea.pts, eb.pts);
      if (!c) { stats.unresolvedCorners++; cs.push({ A, B, open: true, theta, unresolved: true }); A.required = Math.max(A.required, Math.min(reachA, J.maxTrim * 0.5)); B.required = Math.max(B.required, Math.min(reachB, J.maxTrim * 0.5)); continue; }
      const sA = ea.s[c.i] + (ea.s[c.i + 1] - ea.s[c.i]) * c.t, sB = eb.s[c.j] + (eb.s[c.j + 1] - eb.s[c.j]) * c.u;
      const tl = Math.min(2 * J.kerbRadius, J.kerbRadius / Math.tan(theta / 2));
      A.required = Math.max(A.required, sA + tl); B.required = Math.max(B.required, sB + tl);
      cs.push({ A, B, open: false, theta, C: [c.x, c.z], sA, sB, tl });
    }
    arms.set(k, list); corners.set(k, cs);
  }
  // ---- 4. clusters: junctions whose trims meet, or that are very close
  const parent = new Map<number, number>(), find = (x: number): number => { let r = x; while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!; return r; };
  const unite = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) { parent.set(Math.max(ra, rb), Math.min(ra, rb)); stats.merged++; } };
  const requiredAt = (g: Seg, k: number, atStart: boolean) => arms.get(k)?.find(a => a.seg === g && a.atStart === atStart)?.required ?? 0;
  // (merging and the cross trims, until neither changes anything: a cross trim can make two junctions meet)
  for (let round = 0; round < 4; round++) {
    const before = stats.merged;
    for (const g of G.segs) {
      const a = G.nodes[g.from], b = G.nodes[g.to], L = g.s[g.s.length - 1];
      if (a.kind !== 'junction' || b.kind !== 'junction') continue;
      if (g.from === g.to) continue;
      if (L < J.mergeDistance || requiredAt(g, g.from, true) + requiredAt(g, g.to, false) + J.minRibbon > L) unite(g.from, g.to);
    }
    // ---- 4b. in a cluster, roads leaving it from different nodes can still run into each other just outside it (a
    // carriageway and a road diverging from it at a shallow angle): each such pair trimmed past where their edges cross
    {
      const byRoot = new Map<number, Arm[]>();
      for (const [k, list] of arms) for (const A of list) { const other = A.atStart ? A.seg.to : A.seg.from; if (G.nodes[other].kind === 'junction' && find(other) === find(k)) continue; const r = find(k); (byRoot.get(r) ?? byRoot.set(r, []).get(r)!).push(A); }
      const edgeLine = (a: Arm, side: number) => { const reach = Math.min(J.maxTrim, a.L), ss = a.seg.s, Lg = a.L, sp = a.atStart ? ss.filter(v => v > 0 && v < reach) : ss.map(v => Lg - v).filter(v => v > 0 && v < reach).reverse(), list2 = [0, ...sp, reach]; return { s: list2, pts: list2.map(v => armEdge(a, v, side)) }; };
      for (const list of byRoot.values()) {
        if (list.length < 2) continue;
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
          const A = list[i], B = list[j];
          if (A.node === B.node) continue;
          let need: [number, number] | null = null;
          for (const sa of [1, -1]) for (const sb of [1, -1]) {
            const ea = edgeLine(A, sa), eb = edgeLine(B, sb), c = firstCrossing(ea.pts, eb.pts);
            if (!c) continue;
            const sA = ea.s[c.i] + (ea.s[c.i + 1] - ea.s[c.i]) * c.t, sB = eb.s[c.j] + (eb.s[c.j + 1] - eb.s[c.j]) * c.u;
            if (!need || sA + sB > need[0] + need[1]) need = [sA, sB];
          }
          if (!need) continue;
          A.required = Math.max(A.required, need[0] + J.kerbRadius * 0.5); B.required = Math.max(B.required, need[1] + J.kerbRadius * 0.5);
          stats.crossTrims = (stats.crossTrims ?? 0) + 1;
        }
      }
    }
    if (stats.merged === before) break;
  }
  // ---- 5. trims (a road between a junction and a joint or end: never past its other end)
  for (const g of G.segs) { g.trim0 = 0; g.trim1 = 0; g.internal = false; }
  // (dead ends taken into a patch: the patch runs capLength past them, as a dead end's own cap does)
  const absorbedEnds = new Set<number>();
  for (const [k, list] of [...arms]) for (const A0 of list) {
    let A = A0, node = k;
    for (let guard = 0; guard < 20; guard++) {
      const g = A.seg, other = A.atStart ? g.to : g.from, L = A.L;
      if (other === node || (G.nodes[other].kind === 'junction' && find(other) === find(node))) { g.internal = true; break; }
      const trim = Math.max(J.minTrim, A.required), otherTrim = G.nodes[other].kind === 'junction' ? requiredAt(g, other, !A.atStart) : 0, room = L - otherTrim - J.minRibbon;
      // (more than the road has, its other end a joint or a dead end: the road goes into the patch, and the trim
      // carries on along the next road through the joint)
      const next = G.nodes[other].kind === 'joint' ? G.nodes[other].segs.map(i => G.segs[i]).find(o => o !== g) : null;
      if (trim > room && (next || G.nodes[other].kind === 'end') && trim - L < J.maxTrim) {
        g.internal = true; stats.extended = (stats.extended ?? 0) + 1;
        G.nodes[other].kind = 'junction'; unite(other, node);
        if (!next) { arms.set(other, [{ seg: g, atStart: !A.atStart, node: other, angle: 0, trim: 0, required: 0, L }]); corners.set(other, []); absorbedEnds.add(other); break; }
        const B: Arm = { seg: next, atStart: next.from === other, node: other, angle: 0, trim: 0, required: Math.max(J.minTrim, trim - L), L: next.s[next.s.length - 1] };
        arms.set(other, [{ seg: g, atStart: !A.atStart, node: other, angle: 0, trim: 0, required: 0, L }, B]);
        corners.set(other, []);
        A = B; node = other; continue;
      }
      let t = trim;
      if (t > room) { stats.clamped++; t = Math.max(Math.min(J.minTrim, L * 0.3), room); }
      A.trim = t;
      if (A.atStart) g.trim0 = t; else g.trim1 = t;
      break;
    }
  }
  for (const [k, n] of G.nodes.entries()) if (n.kind === 'end') { for (const g of n.segs.map(i => G.segs[i])) { if (g.from === k) g.trim0 = -cfg.surface.capLength; if (g.to === k) g.trim1 = -cfg.surface.capLength; } }
  // ---- 6. each cluster's patch
  const members = new Map<number, number[]>();
  for (const k of arms.keys()) { const r = find(k); (members.get(r) ?? members.set(r, []).get(r)!).push(k); }
  const clusters: Cluster[] = [];
  for (const [root, nodesIn] of [...members].sort((p, q) => p[0] - q[0])) {
    const id = clusters.length, inSet = new Set(nodesIn);
    const external: Arm[] = [], internal = new Set<number>(), pieces: number[][][][] = [], cornerList: any[] = [];
    for (const k of nodesIn) {
      G.nodes[k].cluster = id;
      const list = arms.get(k)!;
      // the node's middle: its arms' edge starts, round it
      const cap: number[][] = [];
      for (const A of list) { cap.push(armEdge(A, 0, -1), armEdge(A, 0, +1)); }
      pieces.push([hull(cap)]);
      // (a dead end taken into the patch: capLength past its last node, back from the road's way into it)
      if (absorbedEnds.has(k) && list.length === 1) {
        const A = list[0], d = outDir(A), c = cfg.surface.capLength, l = armEdge(A, 0, -1), r = armEdge(A, 0, +1);
        pieces.push([hull([l, r, [r[0] - d[0] * c, r[1] - d[1] * c], [l[0] - d[0] * c, l[1] - d[1] * c]])]);
      }
      for (const A of list) {
        const other = A.atStart ? A.seg.to : A.seg.from;
        if (A.seg.internal || inSet.has(other)) { internal.add(A.seg.id); continue; }
        external.push(A);
        pieces.push([stub(A, 0, A.trim)]);
      }
      for (const c of corners.get(k)!) {
        if (c.open) continue;
        const f = fillet(c, J.cornerPoints);
        if (f) { pieces.push([f.ring]); cornerList.push({ node: k, C: c.C, curve: f.curve }); }
      }
    }
    for (const sid of internal) { const g = G.segs[sid]; pieces.push([stub({ seg: g, atStart: true }, 0, g.s[g.s.length - 1])]); }
    if (debugPieces) debugPieces.push({ nodes: nodesIn.map(k => [G.nodes[k].x, G.nodes[k].z]), pieces: pieces.map(p => p[0]) });
    let rings: number[][][][];
    try {
      rings = unionRings(pieces.map(p => p[0]).filter(r => r.length >= 3 && Math.abs(polygonArea(r)) > 1e-6), J.closeGap / 2);
      if (!rings.length) throw new Error('nothing left');
    } catch (e) {
      stats.unionFailures++;
      if (stats.unionFailures <= 3) console.warn(`    (junction patch at ${G.nodes[nodesIn[0]].x.toFixed(1)}, ${G.nodes[nodesIn[0]].z.toFixed(1)}: union failed — ${(e as Error).message}; its hull instead)`);
      rings = [[hull(pieces.flatMap(p => p[0]))]];
    }
    // (Map v5: no hairpins — an outline running out and back on itself, a sliver where two pieces' edges, sampled at
    // different points along a curved road, nearly meet: 2,600 of the CBD and Glenelg patches' 35,577 outline points, the
    // road's T-junction cracks where they were triangulated. Each point the outline turns back at by more than despike°,
    // or within despikeMerge m of the next, is taken out, again until there's none; a part left smaller than minPartArea
    // m², a sliver on its own, goes)
    if (J.despike) rings = rings.map(poly => poly.map(r => despike(r, Math.cos(J.despike * Math.PI / 180), J.despikeMerge))).filter(poly => poly[0].length >= 3 && Math.abs(polygonArea(poly[0])) >= J.minPartArea).map(poly => [poly[0], ...poly.slice(1).filter(h => h.length >= 3)]);
    // (holes too small or too thin to be a real island or median — slivers where pieces nearly meet — filled)
    rings = rings.map(poly => [poly[0], ...poly.slice(1).filter(h => { const a = Math.abs(polygonArea(h)); let per = 0; for (let q = 0; q < h.length; q++) { const b = h[(q + 1) % h.length]; per += Math.hypot(b[0] - h[q][0], b[1] - h[q][1]); } return a >= J.minHoleArea && a / Math.max(per, 1e-6) >= J.minHoleWidth / 2; })]);
    // every trimmed road's end row exactly on the outline: snapped to, and put into the edge it lies on
    const rows = external.map(A => armRow(A, A.trim)), must = rows.flat();
    rings = rings.map(poly => poly.map(r => insertPoints(r, must, J.snap)));
    // (Map v5: and nothing else of the outline on an end row between its points — a corner of another piece lying on
    // it, a T-junction crack where the road's own end row meets it)
    if (J.rowClean) rings = rings.map(poly => poly.map(r => cleanRows(r, rows, J.rowClean)));
    let cx = 0, cz = 0; for (const k of nodesIn) { cx += G.nodes[k].x; cz += G.nodes[k].z; }
    clusters.push({ id, nodes: nodesIn.slice().sort((p, q) => p - q), arms: external, internal: [...internal].sort((p, q) => p - q), rings, centre: [cx / nodesIn.length, cz / nodesIn.length], corners: cornerList });
    void root;
  }
  stats.clusters = clusters.length;
  return { clusters, stats };
}

// the union of rings (Clipper2, on a millimetre grid: robust), as polygons — [outer, ...holes] each
export const unionStats = { skipped: 0 };
const areaOf = (P: any) => { let a = 0; for (const q of P) a += Clipper.Clipper.area(q); return a; };
// (paths with area — over 0.01 m² either way: outers and real holes — kept; slivers of nothing dropped)
const solidPaths = (P: any) => { const o = new Clipper.Paths64(); for (const q of P) if (Math.abs(Clipper.Clipper.area(q)) > 1e4) o.push(q); return o; };
const copyPaths = (P: any) => { const o = new Clipper.Paths64(); for (const q of P) { const c = new Clipper.Path64(); for (const pt of q) c.push(new Clipper.Point64(pt.x, pt.y)); o.push(c); } return o; };
export function unionRings(pieces: number[][][], close = 0) {
  const S = 1000;
  // (one piece at a time into the union: clipper2-js's union of many overlapping paths at once can lose area — 271 m²
  // of a 355 m² junction, measured — where two at a time is right. Each piece cleaned on its own first: one crossing
  // itself — a bow-tie — becomes its simple parts, all wound the same way)
  let out = new Clipper.Paths64();
  for (const ring0 of pieces) {
    const ring = polygonArea(ring0) < 0 ? ring0.slice().reverse() : ring0, p = new Clipper.Path64(), one = new Clipper.Paths64();
    for (const [x, z] of ring) p.push(new Clipper.Point64(Math.round(x * S), Math.round(z * S)));
    one.push(p);
    const clean = solidPaths(Clipper.Clipper.Union(one, undefined, Clipper.FillRule.NonZero));
    for (const q of clean) if (Clipper.Clipper.area(q) < 0) q.reverse();
    if (!out.length) { out = clean; continue; }
    // (a union never shrinks: if clipper2-js's does — it can, given the paths of no area a union leaves behind, which
    // are dropped after every step — the other way round, then the piece's parts one at a time, each kept only if it
    // grows the union; a part it can't add is left out and counted)
    const before = areaOf(out), grew = (P: any) => areaOf(P) >= before - 1e4;
    let next = solidPaths(Clipper.Clipper.Union(copyPaths(out), copyPaths(clean), Clipper.FillRule.NonZero));
    if (!grew(next)) next = solidPaths(Clipper.Clipper.Union(copyPaths(clean), copyPaths(out), Clipper.FillRule.NonZero));
    if (!grew(next)) {
      next = out;
      for (const q of clean) { const one2 = new Clipper.Paths64(); one2.push(q); const was = areaOf(next), tryIt = solidPaths(Clipper.Clipper.Union(copyPaths(next), copyPaths(one2), Clipper.FillRule.NonZero)); if (areaOf(tryIt) >= was - 1e4) next = tryIt; else unionStats.skipped++; }
    }
    out = next;
  }
  // (closed: grown and shrunk again by `close` m — cracks and slivers narrower than twice that filled, everything
  // else as it was: mitred corners come back exactly)
  if (close > 0) {
    // (the closing, round-joined; only what it adds that's big enough to be a crack is kept — the rest of the outline,
    // the trimmed roads' ends with it, stays exactly as the union had it)
    const closed = Clipper.Clipper.InflatePaths(Clipper.Clipper.InflatePaths(out, close * S, Clipper.JoinType.Square, Clipper.EndType.Polygon), -close * S, Clipper.JoinType.Square, Clipper.EndType.Polygon);
    const fill = Clipper.Clipper.Difference(closed, out, Clipper.FillRule.NonZero).filter(p => Math.abs(Clipper.Clipper.area(p)) > 0.25 * S * S);
    if (fill.length) { const both = new Clipper.Paths64(); for (const p of out) both.push(p); for (const p of fill) both.push(p); out = Clipper.Clipper.Union(both, undefined, Clipper.FillRule.NonZero); }
  }
  const rings = out.map(path => { const r: number[][] = []; for (const q of path) { const pt = [q.x / S, q.y / S], last = r[r.length - 1]; if (!last || last[0] !== pt[0] || last[1] !== pt[1]) r.push(pt); } if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop(); return r; }).filter(r => r.length >= 3);
  // (outers wind as the pieces did — positive here — holes the other way; each hole into the smallest outer round it)
  const outers = rings.filter(r => polygonArea(r) > 0).map(r => ({ r, a: polygonArea(r), holes: [] as number[][][] }));
  for (const h of rings.filter(r => polygonArea(r) <= 0)) {
    const host = outers.filter(o => inRing(h[0][0], h[0][1], o.r) || inRing((h[0][0] + h[1][0]) / 2, (h[0][1] + h[1][1]) / 2, o.r)).sort((a, b) => a.a - b.a)[0];
    host?.holes.push(h);
  }
  return outers.map(o => [o.r, ...o.holes]);
}
const inRing = (x: number, z: number, r: number[][]) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > z) !== (r[j][1] > z) && x < (r[j][0] - r[i][0]) * (z - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; };

// the outline of an arm's road from s0 to s1 out (its left edge out, its right edge back)
export function stub(A: { seg: Seg; atStart: boolean }, s0: number, s1: number) {
  const g = A.seg, L = g.s[g.s.length - 1], inner = (A.atStart ? g.s : g.s.map(v => L - v)).filter(v => v > s0 + 1e-6 && v < s1 - 1e-6).sort((p, q) => p - q);
  const ss = [s0, ...inner, s1];
  return [...ss.map(v => armEdge(A, v, +1)), ...ss.slice().reverse().map(v => armEdge(A, v, -1))];
}
// a corner's curve: from A's facing edge (tl past the crossing) round to B's, a quadratic about the crossing;
// with the edges back to the crossing it's the piece of road the corner adds
function fillet(c: any, n: number) {
  const { A, B, C, sA, sB, tl } = c;
  const pa = armEdge(A, sA + tl, +1), pb = armEdge(B, sB + tl, -1);
  const curve: number[][] = [];
  for (let q = 0; q <= n; q++) { const t = q / n, u = 1 - t; curve.push([u * u * pa[0] + 2 * u * t * C[0] + t * t * pb[0], u * u * pa[1] + 2 * u * t * C[1] + t * t * pb[1]]); }
  // (A's edge from the crossing out to the curve's start, the curve, B's edge back to the crossing)
  const ea: number[][] = [], eb: number[][] = [];
  for (let q = 1; q <= 4; q++) ea.push(armEdge(A, sA + tl * q / 4, +1));
  for (let q = 3; q >= 0; q--) eb.push(armEdge(B, sB + tl * q / 4, -1));
  const ring = [C, ...ea.slice(0, -1), ...curve, ...eb.slice(1)];
  return Math.abs(polygonArea(ring)) > 1e-4 ? { ring, curve } : null;
}
// a ring without its hairpins: each point where it turns back (the turn's cosine under cosMax) or that lies within merge m
// of the next taken out, round and round until none is left (Map v5)
export function despike(ring: number[][], cosMax: number, merge: number) {
  const out = ring.slice();
  for (let changed = true; changed && out.length > 3; ) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const n = out.length, a = out[(i + n - 1) % n], b = out[i], c = out[(i + 1) % n];
      const ux = b[0] - a[0], uz = b[1] - a[1], vx = c[0] - b[0], vz = c[1] - b[1], lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz);
      if (lv <= merge || lu <= 1e-9 || (ux * vx + uz * vz) / (lu * lv) < cosMax) { out.splice(i, 1); i--; changed = true; }
    }
  }
  return out;
}
// a ring without the points (other than the rows' own) lying within tol of a row between two of its points (Map v5)
function cleanRows(ring: number[][], rows: number[][][], tol: number) {
  const own = new Set(rows.flat()), pieces = rows.flatMap(row => row.slice(0, -1).map((p, i) => [p, row[i + 1]]));
  const onRow = (p: number[]) => pieces.some(([a, b]) => { const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz; if (L2 < 1e-12) return false; const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2; return t > 0 && t < 1 && Math.abs((p[0] - a[0]) * dz - (p[1] - a[1]) * dx) / Math.sqrt(L2) <= tol; });
  const out = ring.filter(p => own.has(p) || !onRow(p));
  return out.length >= 3 ? out : ring;
}
// a ring with the given points on it: a vertex within `snap` of one becomes it exactly; one lying on an edge splits it
function insertPoints(ring: number[][], pts: number[][], snap: number) {
  let out = ring.map(p => { for (const q of pts) if (Math.abs(p[0] - q[0]) <= snap && Math.abs(p[1] - q[1]) <= snap) return q; return p; });
  const res: number[][] = [];
  for (let i = 0; i < out.length; i++) {
    const a = out[i], b = out[(i + 1) % out.length];
    res.push(a);
    const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
    if (L2 < 1e-12) continue;
    const on = pts.filter(q => q !== a && q !== b && !(q[0] === a[0] && q[1] === a[1]) && !(q[0] === b[0] && q[1] === b[1])).map(q => { const t = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / L2, d = Math.abs((q[0] - a[0]) * dz - (q[1] - a[1]) * dx) / Math.sqrt(L2); return { q, t, d }; }).filter(o => o.t > 1e-9 && o.t < 1 - 1e-9 && o.d <= snap).sort((p, q) => p.t - q.t);
    for (const o of on) if (!res.some(r => r[0] === o.q[0] && r[1] === o.q[1])) res.push(o.q);
  }
  out = res.filter((p, i) => { const q = res[(i + 1) % res.length]; return !(p[0] === q[0] && p[1] === q[1]); });
  return out;
}
// the convex hull of points (monotone chain), anticlockwise
export function hull(points: number[][]) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: number[][] = [], upper: number[][] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.slice().reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
// a patch's triangles: the GLU tessellator (libtess) over its rings, odd winding — holes, rings touching themselves
// or each other, and every outline point kept (a road's end row has five lying straight between its corners).
// [[ax, az], [bx, bz], [cx, cz]]…
let tess: any = null;
export function triangulatePatch(rings: number[][][][]) {
  if (!tess) {
    tess = new libtess.GluTesselator();
    tess.gluTessCallback(libtess.gluEnum.GLU_TESS_VERTEX_DATA, (d: number[], out: number[][]) => out.push(d));
    tess.gluTessCallback(libtess.gluEnum.GLU_TESS_BEGIN, () => {});
    tess.gluTessCallback(libtess.gluEnum.GLU_TESS_EDGE_FLAG, () => {});          // (triangles only)
    tess.gluTessCallback(libtess.gluEnum.GLU_TESS_COMBINE, (c: number[]) => [c[0], c[1]]);
    tess.gluTessCallback(libtess.gluEnum.GLU_TESS_ERROR, (e: number) => { throw new Error(`libtess ${e}`); });
    tess.gluTessProperty(libtess.gluEnum.GLU_TESS_WINDING_RULE, libtess.windingRule.GLU_TESS_WINDING_ODD);
    tess.gluTessNormal(0, 0, 1);
  }
  const out: number[][] = [];
  try {
    tess.gluTessBeginPolygon(out);
    for (const poly of rings) for (const r of poly) {
      if (r.length < 3) continue;
      tess.gluTessBeginContour();
      for (const p of r) tess.gluTessVertex([p[0], p[1], 0], p);
      tess.gluTessEndContour();
    }
    tess.gluTessEndPolygon();
  } catch { triangulatePatch.fallbacks++; tess = null; return earcutPatch(rings); }
  const tris: number[][][] = [];
  for (let t = 0; t + 2 < out.length; t += 3) tris.push([out[t], out[t + 1], out[t + 2]]);
  return tris;
}
triangulatePatch.fallbacks = 0 as number;
function earcutPatch(rings: number[][][][]) {
  const tris: number[][][] = [];
  for (const poly0 of rings) {
    if (!poly0.length || poly0[0].length < 3) continue;
    const poly = [poly0[0], ...poly0.slice(1).filter(r => r.length >= 3)], flat: number[] = [], holes: number[] = [], pts: number[][] = [];
    poly.forEach((r, k) => { if (k) holes.push(pts.length); for (const p of r) { flat.push(p[0], p[1]); pts.push(p); } });
    const idx = Array.from(earcut(flat, holes, 2)), used = new Set(idx);
    for (let v = 0; v < pts.length; v++) {
      if (used.has(v)) continue;
      const p = pts[v];
      outer: for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
        const a = idx[t + e], b = idx[t + (e + 1) % 3], c = idx[t + (e + 2) % 3], A = pts[a], B = pts[b], dx = B[0] - A[0], dz = B[1] - A[1], L2 = dx * dx + dz * dz;
        if (L2 < 1e-12) continue;
        const u = ((p[0] - A[0]) * dx + (p[1] - A[1]) * dz) / L2, d = Math.abs((p[0] - A[0]) * dz - (p[1] - A[1]) * dx) / Math.sqrt(L2);
        if (u <= 1e-9 || u >= 1 - 1e-9 || d > 1e-6) continue;
        idx.splice(t, 3, a, v, c, v, b, c); used.add(v); break outer;
      }
    }
    for (let t = 0; t < idx.length; t += 3) tris.push([pts[idx[t]], pts[idx[t + 1]], pts[idx[t + 2]]]);
  }
  return tris;
}
