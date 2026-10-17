// Map v4's road heights, solved on the graph (the road surface model, map/model/):
//  1. each segment's elevation profile: the elevation sampled at its points, spikes out (a running median), then
//     smoothed (a Gaussian along the road) — still following the real hills
//  2. heights for nodes on bridges and in tunnels (no ground there): from the ground nodes the structure is
//     anchored to, by distance along it
//  3. each junction cluster's plane: a least-squares plane through where its roads reach it (their smoothed
//     heights at their trims) and its nodes, no steeper than junctionMaxSlope — one surface, no steps or bumps
//  4. each chain of roads between junctions or ends (through joints and tile-border nodes): its smoothed profile
//     bent to meet the planes (or ends) at its two ends; bridges and tunnels eased straight between the ground at
//     their ends, a bridge lifted to clear a road it crosses; then held to maxGrade and maxGradeChange by
//     relaxation, the ends fixed
//  5. what's drawn: each chain's heights (straight between its points, which can be 12 m apart) averaged over
//     drawnSmooth m either side — every change of grade a curve 2 × drawnSmooth m long (a vertical curve, as roads are
//     built), so no point is a kink a car feels at speed — sampled every drawnStep m along each segment
// Sets seg.h (per point), seg.vs / seg.vh (the drawn profile: s, height), cluster.plane { cx, cz, a, b, c }
// (h = a·(x − cx) + b·(z − cz) + c), node.h.
//
//   solveHeights(G, T, demAt, cfg) → { chains, stats }
//   planeAt(cluster, x, z)

import type { MNode, Seg } from './graph.ts';
import type { Cluster } from './topology.ts';
import { at, rowAt } from './geom.ts';
import { planesOf, surfaceHeight } from './surface.ts';

// (Map v5: a big cluster's surface is a gently curved quadratic — qa·dx² + qb·dx·dz + qc·dz² on top of the plane)
export const planeAt = (c: Cluster | any, x: number, z: number) => { const p = c.plane, dx = x - p.cx, dz = z - p.cz; return p.a * dx + p.b * dz + p.c + (p.qa ? p.qa * dx * dx + p.qb * dx * dz + p.qc * dz * dz : 0); };
// its slope there: [∂h/∂x, ∂h/∂z]
export const planeGrad = (p: any, x: number, z: number) => { const dx = x - p.cx, dz = z - p.cz; return p.qa ? [p.a + 2 * p.qa * dx + p.qb * dz, p.b + p.qb * dx + 2 * p.qc * dz] : [p.a, p.b]; };

function smoothProfile(S: number[], raw: number[], median: number, sigma: number) {
  const med = raw.map((_, k) => { const w = raw.slice(Math.max(0, k - median), k + median + 1).sort((a, b) => a - b); return w[w.length >> 1]; });
  // (a Gaussian along the way: a moving window, both sides of each point within 3σ)
  const out = new Array(S.length);
  let lo = 0, hi = 0;
  for (let k = 0; k < S.length; k++) {
    while (S[lo] < S[k] - 3 * sigma) lo++;
    while (hi + 1 < S.length && S[hi + 1] <= S[k] + 3 * sigma) hi++;
    let a = 0, w = 0;
    for (let q = lo; q <= hi; q++) { const d = S[q] - S[k], wt = Math.exp(-d * d / (2 * sigma * sigma)); a += wt * med[q]; w += wt; }
    out[k] = a / w;
  }
  return out;
}
const lerpAt = (S: number[], H: number[], s: number) => {
  if (s <= S[0]) return H[0];
  const n = S.length; if (s >= S[n - 1]) return H[n - 1];
  let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
  const t = (s - S[lo]) / ((S[hi] - S[lo]) || 1); return H[lo] + (H[hi] - H[lo]) * t;
};

// a junction's main carriageway: two of its arms of one road (the same name and class, not a ramp), both with a corridor
// profile — where they leave it (their trims) and their heights there, the second's distance from the first — or null
// (none, or a second main road through it too)
function corridorPair(c: any): [{ x: number; z: number; h: number }, { x: number; z: number; h: number; d: number }] | null {
  const arms = c.arms.filter((A: any) => A.seg.corr && !A.seg.link && A.seg.structure === 'ground').map((A: any) => {
    const g = A.seg, s = A.atStart ? A.trim : g.s[g.s.length - 1] - A.trim, r = rowAt(g, s);
    return { g, x: r.x, z: r.z, h: lerpAt(g.s, g.corr, s) };
  });
  let best: any = null;
  for (let i = 0; i < arms.length; i++) for (let j = i + 1; j < arms.length; j++) {
    const a = arms[i], b = arms[j];
    if (a.g.name !== b.g.name || a.g.cls !== b.g.cls || a.g === b.g) continue;
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    if (d > 1 && (!best || d > best.d || (d === best.d && a.g.id + b.g.id < best.k))) best = { a, b, d, k: a.g.id + b.g.id };
  }
  // (one main road only: where two cross, each needs its own grade — both fitted, as before)
  if (!best || arms.some((q: any) => q.g.name !== best.a.g.name || q.g.cls !== best.a.g.cls)) return null;
  // (in a fixed order: the lower segment id first)
  const [A, B] = best.a.g.id < best.b.g.id ? [best.a, best.b] : [best.b, best.a];
  return [{ x: A.x, z: A.z, h: A.h }, { x: B.x, z: B.z, h: B.h, d: best.d }];
}

export function solveHeights(G: { nodes: MNode[]; segs: Seg[] }, T: { clusters: Cluster[] }, demAt: (x: number, z: number) => number, cfg: any, extra: { rails?: { xs: number[]; zs: number[] }[] } = {}) {
  const Hc = cfg.heights, stats: any = { chains: 0, lifted: 0, gradeLimited: 0, cycles: 0, planesMoved: 0, quadratic: 0, crossings: 0, raisedJunctions: 0, shortOfClearance: 0, underpasses: 0, underpassDeepest: 0, underpassShort: 0, raiseCapped: 0 };
  // ---- 1. each segment's own smoothed profile
  for (const g of G.segs) { g.raw = g.xs.map((x: number, k: number) => demAt(x, g.zs[k])); g.smooth = smoothProfile(g.s, g.raw, Hc.median, Hc.smooth); }
  // (Map v5: main roads' profiles along whole carriageways, through their junctions — the junctions follow them)
  if (Hc.corridor) stats.corridors = corridorProfiles(G, demAt, Hc);
  // ---- 2. node heights: from the ground roads there; on structures, from the ground they're anchored to
  for (const n of G.nodes) {
    const ground = n.segs.map(i => G.segs[i]).filter(g => g.structure === 'ground'), corr = n.segs.map(i => G.segs[i]).filter(g => g.corr);
    n.ground = ground.length > 0 || corr.length > 0;
    const hs = corr.length ? corr.map(g => (G.nodes[g.from] === n ? g.corr[0] : g.corr[g.corr.length - 1])) : ground.map(g => (G.nodes[g.from] === n ? g.smooth[0] : g.smooth[g.smooth.length - 1]));
    n.h = hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : NaN;
  }
  const seen = new Set<number>();
  for (const g0 of G.segs) {
    if (g0.structure === 'ground' || seen.has(g0.id)) continue;
    const comp: Seg[] = [], stack = [g0]; seen.add(g0.id);
    while (stack.length) { const g = stack.pop()!; comp.push(g); for (const nk of [g.from, g.to]) if (!G.nodes[nk].ground) for (const si of G.nodes[nk].segs) { const o = G.segs[si]; if (o.structure !== 'ground' && !seen.has(o.id)) { seen.add(o.id); stack.push(o); } } }
    const compNodes = [...new Set(comp.flatMap(g => [g.from, g.to]))], anchors = compNodes.filter(k => G.nodes[k].ground);
    const dist = anchors.map(a => { const d = new Map([[a, 0]]), q = [a]; while (q.length) { q.sort((x, y) => d.get(x)! - d.get(y)!); const u = q.shift()!; for (const g of comp) { const v = g.from === u ? g.to : g.to === u ? g.from : -1; if (v < 0) continue; const nd = d.get(u)! + g.s[g.s.length - 1]; if (nd < (d.get(v) ?? Infinity)) { d.set(v, nd); q.push(v); } } } return d; });
    for (const k of compNodes) {
      if (G.nodes[k].ground) continue;
      let a = 0, w = 0;
      anchors.forEach((an, q) => { const d = dist[q].get(k); if (d === undefined) return; const wt = 1 / Math.max(d, 1) ** 2; a += wt * G.nodes[an].h; w += wt; });
      G.nodes[k].h = w ? a / w : demAt(G.nodes[k].x, G.nodes[k].z);
    }
  }
  for (const n of G.nodes) if (!Number.isFinite(n.h)) n.h = demAt(n.x, n.z);
  // ---- 3. each cluster's plane
  for (const c of T.clusters) {
    const pts: number[][] = [];
    const W0 = Hc.corridor?.weight ?? 1, onCorr = (k: number) => G.nodes[k].segs.some(i => G.segs[i].corr);
    for (const k of c.nodes) { const n = G.nodes[k]; pts.push([n.x, n.z, n.h, onCorr(k) ? 2 * W0 : 2]); }
    for (const A of c.arms) {
      const g = A.seg, s = A.atStart ? A.trim : g.s[g.s.length - 1] - A.trim, r = rowAt(g, s);
      const h = g.corr ? lerpAt(g.s, g.corr, s) : g.structure === 'ground' ? lerpAt(g.s, g.smooth, s) : G.nodes[A.node].h;
      pts.push([r.x, r.z, h, g.corr ? W0 : 1]);
    }
    let W = 0, mx = 0, mz = 0, mh = 0;
    for (const p of pts) { W += p[3]; mx += p[0] * p[3]; mz += p[1] * p[3]; mh += p[2] * p[3]; }
    mx /= W; mz /= W; mh /= W;
    let sxx = 0, sxz = 0, szz = 0, sxh = 0, szh = 0;
    for (const p of pts) { const x = p[0] - mx, z = p[1] - mz, h = p[2] - mh; sxx += p[3] * x * x; sxz += p[3] * x * z; szz += p[3] * z * z; sxh += p[3] * x * h; szh += p[3] * z * h; }
    // (Map v5: level in any direction its points don't spread along — as if each also lay planeRidge m off the middle
    // every way, at the middle's height. Points nearly on a line — a turning loop under Hart Street's bridge — left the
    // slope across the line to their noise: 13.6%, the patch 0.6 m over the ground at its side, under the deck)
    if (Hc.planeRidge) { sxx += W * Hc.planeRidge ** 2; szz += W * Hc.planeRidge ** 2; }
    const det = sxx * szz - sxz * sxz;
    let a = Math.abs(det) > 1e-6 ? (sxh * szz - szh * sxz) / det : 0, b = Math.abs(det) > 1e-6 ? (szh * sxx - sxh * sxz) / det : 0;
    // (one point's worth of roads — two nodes on a line — gives no cross slope: the line's own)
    if (Math.abs(det) <= 1e-6 && sxx + szz > 1e-6) { const k = (sxh + szh) / (sxx + szz); a = k * (sxx > szz ? 1 : 0); b = k * (sxx > szz ? 0 : 1); }
    const slope = Math.hypot(a, b);
    if (slope > Hc.junctionMaxSlope) { a *= Hc.junctionMaxSlope / slope; b *= Hc.junctionMaxSlope / slope; }
    (c as any).plane = { cx: mx, cz: mz, a, b, c: mh };
    // (Map v5: a junction on a main road's carriageway — the same road in and out of it, both on its corridor profile —
    // takes the carriageway's own grade along it, through both its arms' heights exactly, and only a cross slope from the
    // side roads, no more than corridor.crossSlope; it's pinned: nothing later moves it up or down. Fitted with the side
    // roads, a service road off the South Eastern Freeway tipped its junction 13.7% across it, and capped, 3% along it
    // where the freeway falls 7%: 1.7 m under it at one end, 1.4 m over at the other, a step in the freeway)
    const main = Hc.corridor?.crossSlope != null ? corridorPair(c) : null;
    if (main) {
      const [A, B] = main, ux = (B.x - A.x) / B.d, uz = (B.z - A.z) / B.d, nx = -uz, nz = ux, gu = (B.h - A.h) / B.d, ox = (A.x + B.x) / 2, oz = (A.z + B.z) / 2, oh = (A.h + B.h) / 2;
      let sw = 0, sv = 0;
      for (const p of pts) { const v = (p[0] - ox) * nx + (p[1] - oz) * nz, r = p[2] - (oh + gu * ((p[0] - ox) * ux + (p[1] - oz) * uz)); sw += p[3] * v * v; sv += p[3] * v * r; }
      const gc = Math.max(-Hc.corridor.crossSlope, Math.min(Hc.corridor.crossSlope, sw > 1e-6 ? sv / sw : 0));
      (c as any).plane = { cx: ox, cz: oz, a: gu * ux + gc * nx, b: gu * uz + gc * nz, c: oh };
      (c as any).pinned = true;
    }
    // (Map v5: a cluster wider than quadraticAbove m on one plane folds against roads steeper than its average — the
    // windy route's 176 m junction at Springbank Road. Its surface gets the quadratic terms that fit what's left, no
    // more curved than maxCurvature — still one smooth surface, every arm met where it reaches it)
    if (Hc.quadraticAbove && !(c as any).pinned) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
      if (Math.max(x1 - x0, z1 - z0) > Hc.quadraticAbove && pts.length >= 8) {
        // (kept only if no steeper anywhere on the junction than its plane may be)
        const q = fitQuadratic(pts, mx, mz, (c as any).plane, Hc.maxCurvature);
        if (q && pts.every(p => Math.hypot(...planeGrad({ ...q, cx: mx, cz: mz }, p[0], p[1])) <= Hc.junctionMaxSlope * 1.05)) { Object.assign((c as any).plane, q); stats.quadratic++; }
      }
    }
    for (const k of c.nodes) G.nodes[k].h = planeAt(c, G.nodes[k].x, G.nodes[k].z);
  }
  // ---- 4. chains of roads between junctions and ends (through joints)
  const visited = new Set<number>(), chains: { parts: { seg: Seg; fwd: boolean }[]; start: number; end: number; cycle: boolean }[] = [];
  const terminal = (k: number) => G.nodes[k].kind !== 'joint';
  const walk = (k0: number, g0: Seg, fwd0: boolean, cycle = false) => {
    const parts: { seg: Seg; fwd: boolean }[] = [];
    let k = k0, g = g0, fwd = fwd0;
    for (let guard = 0; guard < 100000; guard++) {
      parts.push({ seg: g, fwd }); visited.add(g.id);
      k = fwd ? g.to : g.from;
      if (terminal(k) || (cycle && k === k0)) break;
      const next = G.nodes[k].segs.map(i => G.segs[i]).find(o => o !== g && !visited.has(o.id));
      if (!next) break;
      g = next; fwd = next.from === k;
    }
    chains.push({ parts, start: k0, end: k, cycle });
  };
  for (const g of G.segs) {
    if (visited.has(g.id) || g.internal) continue;
    for (const [k, fwd] of [[g.from, true], [g.to, false]] as [number, boolean][]) if (!visited.has(g.id) && terminal(k)) walk(k, g, fwd);
  }
  for (const g of G.segs) if (!visited.has(g.id) && !g.internal) { stats.cycles++; walk(g.from, g, true, true); }
  stats.chains = chains.length;
  const clusterOf = (k: number) => (G.nodes[k].kind === 'junction' ? T.clusters[G.nodes[k].cluster] : null);
  relaxPlanes(chains, clusterOf, G, Hc, stats, demAt);
  for (const ch of chains) solveChain(ch, G, clusterOf, demAt, Hc, stats);
  // ---- 5. bridges over roads: lifted to clear them (eased within the bridge), and the grades held again
  const cleared = Hc.approachGrade ? clearancePass(G, T, chains, clusterOf, demAt, Hc, stats, extra.rails ?? []) : (liftBridges(G, chains, Hc, stats), null);
  // ---- 6. the drawn profile: vertical curves
  drawnProfiles(chains, Hc);
  // ---- 7. (Map v5) where a deck as drawn still falls short over a road, that road lowered under it
  if (Hc.underpass && cleared) drawnProfiles(underpasses(G, T, chains, cleared, Hc, stats), Hc);
  // (internal roads of a cluster: on its plane)
  for (const g of G.segs) if (g.internal) { const c = clusterOf(g.from) ?? clusterOf(g.to); g.h = g.xs.map((x: number, k: number) => (c ? planeAt(c, x, g.zs[k]) : g.smooth[k])); }
  return { chains, stats };
}

// neighbouring junctions' planes held to the roads between them: where the road from one plane to the next (trim to
// trim) would rise or fall more than the ground does there, give or take planeGrade, both planes are moved towards
// each other (their heights, not their tilt) — planePasses rounds over every such road. A plane fitted to a noisy
// patch of ground can't leave a cliff, or a dip, for its road; a real hill stays.
function relaxPlanes(chains: any[], clusterOf: (k: number) => any, G: { nodes: MNode[]; segs: Seg[] }, Hc: any, stats: any, demAt: (x: number, z: number) => number) {
  const links: { cA: any; cB: any; pA: number[]; pB: number[]; span: number; rise: number; mA: number; mB: number }[] = [];
  for (const ch of chains) {
    if (ch.cycle) continue;
    const cA = clusterOf(ch.start), cB = clusterOf(ch.end);
    if (!cA || !cB || cA === cB) continue;
    const P = chainPoints(ch), n = P.length, S = P.map(p => p.S), first = ch.parts[0], last = ch.parts[ch.parts.length - 1];
    const S0 = Math.max(0, first.fwd ? first.seg.trim0 : first.seg.trim1), S1 = Math.min(S[n - 1], S[n - 1] - Math.max(0, last.fwd ? last.seg.trim1 : last.seg.trim0));
    const posAt = (sc: number) => { let i = 0; while (i + 2 < n && S[i + 1] < sc) i++; const t = Math.max(0, Math.min(1, (sc - S[i]) / ((S[i + 1] - S[i]) || 1))); return [P[i].x + (P[i + 1].x - P[i].x) * t, P[i].z + (P[i + 1].z - P[i].z) * t]; };
    // (structures aside — a bridge's or tunnel's ends are held by their own rules — unless the road between the two is
    // short: a little bridge over a creek between two junctions is drawn from one plane to the other like any short road)
    if (ch.parts.some((p: any) => p.seg.structure !== 'ground') && S1 - S0 >= 2 * Hc.armEase) continue;
    const pA = posAt(S0), pB = posAt(S1), d = Math.hypot(pB[0] - pA[0], pB[1] - pA[1]) || 1, ux = (pB[0] - pA[0]) / d, uz = (pB[1] - pA[1]) / d;
    // (each plane's slope along the road between them)
    const gA = planeGrad(cA.plane, pA[0], pA[1]), gB = planeGrad(cB.plane, pB[0], pB[1]);
    const corr = P.every(p => p.seg.corr), cAt = (sc: number) => lerpAt(S, P.map(p => p.seg.corr[p.k]), sc);
    links.push({ cA, cB, pA, pB, span: Math.max(0.5, S1 - S0), rise: corr ? cAt(S1) - cAt(S0) : demAt(pB[0], pB[1]) - demAt(pA[0], pA[1]), mA: gA[0] * ux + gA[1] * uz, mB: gB[0] * ux + gB[1] * uz });
  }
  let moved = 0;
  for (let pass = 0; pass < Hc.planePasses; pass++) {
    let worst = 0;
    for (const L of links) {
      // (the road between them may rise as the ground does, give or take planeGrade — never more than maxGrade)
      const hA = planeAt(L.cA, L.pA[0], L.pA[1]), hB = planeAt(L.cB, L.pB[0], L.pB[1]);
      // (a short road between them — its two eases meet — joins the planes in one curve: it should rise as their own
      // slopes along it do, give or take what a curve bending no faster than maxGradeChange makes up over the span; a
      // longer one follows the ground between its eases)
      const short = L.span < 2 * Hc.armEase;
      const want = short ? (L.mA + L.mB) / 2 * L.span : Hc.planeFollowsGround ? Math.max(-Hc.maxGrade * L.span, Math.min(Hc.maxGrade * L.span, L.rise)) : 0;
      const tol = short ? Math.min(Hc.planeGrade * L.span, Math.max(0.05, Hc.maxGradeChange * L.span * L.span / 6)) : Hc.planeGrade * L.span;
      const off = (hB - hA) - want, ex = Math.abs(off) - tol;
      if (ex <= 1e-3) continue;
      worst = Math.max(worst, ex);
      // (half the excess each round, shared between the two: where two roads between the same junctions ask for
      // different things, the planes settle between them rather than satisfying whichever came last)
      // (a pinned junction — on a main road's carriageway — stays: the other takes the whole move)
      const m = Math.sign(off) * ex / 4, pA = !!L.cA.pinned, pB = !!L.cB.pinned;
      if (pA && pB) continue;
      if (pA) L.cB.plane.c -= 2 * m; else if (pB) L.cA.plane.c += 2 * m; else { L.cA.plane.c += m; L.cB.plane.c -= m; }
      moved++;
    }
    if (worst <= 1e-3) break;
  }
  // (the nodes on their planes again)
  for (const k of G.nodes.keys()) { const c = clusterOf(k); if (c) G.nodes[k].h = planeAt(c, G.nodes[k].x, G.nodes[k].z); }
  stats.planesMoved = moved;
}

function chainPoints(ch: { parts: { seg: Seg; fwd: boolean }[] }) {
  const P: { x: number; z: number; S: number; seg: Seg; k: number; structure: string }[] = [];
  let base = 0;
  for (const { seg: g, fwd } of ch.parts) {
    const n = g.xs.length, L = g.s[n - 1];
    for (let q = 0; q < n; q++) {
      const k = fwd ? q : n - 1 - q, S = base + (fwd ? g.s[k] : L - g.s[k]);
      if (q === 0 && P.length) { (P[P.length - 1] as any).also = { seg: g, k }; continue; }
      P.push({ x: g.xs[k], z: g.zs[k], S, seg: g, k, structure: g.structure });
    }
    base += L;
  }
  return P;
}

function solveChain(ch: any, G: { nodes: MNode[]; segs: Seg[] }, clusterOf: (k: number) => any, demAt: (x: number, z: number) => number, Hc: any, stats: any) {
  const P = chainPoints(ch), n = P.length, S = P.map(p => p.S), Ltot = S[n - 1];
  const raw = P.map(p => demAt(p.x, p.z)), smooth = P.every(p => p.seg.corr) ? P.map(p => p.seg.corr[p.k]) : smoothProfile(S, raw, Hc.median, Hc.smooth);
  // the ends: a junction's plane where the road's trimmed (its row's middle), else the smoothed ground (or the
  // node's height, on a structure)
  const first = ch.parts[0], last = ch.parts[ch.parts.length - 1];
  const trimA = first.fwd ? first.seg.trim0 : first.seg.trim1, trimB = last.fwd ? last.seg.trim1 : last.seg.trim0;
  const S0 = Math.max(0, trimA), S1 = Math.min(Ltot, Ltot - Math.max(0, trimB));
  const posAt = (sc: number) => { let i = 0; while (i + 2 < n && S[i + 1] < sc) i++; const t = Math.max(0, Math.min(1, (sc - S[i]) / ((S[i + 1] - S[i]) || 1))); return [P[i].x + (P[i + 1].x - P[i].x) * t, P[i].z + (P[i + 1].z - P[i].z) * t]; };
  const endH = (k: number, sc: number) => { const c = clusterOf(k); if (c) { const [x, z] = posAt(sc); return planeAt(c, x, z); } return G.nodes[k].ground ? lerpAt(S, smooth, sc) : G.nodes[k].h; };
  const hA = ch.cycle ? lerpAt(S, smooth, 0) : endH(ch.start, S0), hB = ch.cycle ? hA : endH(ch.end, S1);
  const sm0 = lerpAt(S, smooth, S0), sm1 = lerpAt(S, smooth, S1), span = Math.max(1e-6, S1 - S0);
  const h = S.map((s, i) => { const t = Math.max(0, Math.min(1, (s - S0) / span)); return smooth[i] + (hA - sm0) + ((hB - sm1) - (hA - sm0)) * t; });
  // structures: eased straight between the heights where they leave the ground (or the chain's ends)
  const isStruct = P.map(p => p.structure !== 'ground'), corr = P.every(p => p.seg.corr);
  for (let i = 0; i < n; i++) {
    if (!isStruct[i] || corr) continue;
    let j = i; while (j + 1 < n && isStruct[j + 1]) j++;
    const a = Math.max(0, i - 1), b = Math.min(n - 1, j + 1), ha = h[a], hb = h[b], Sa = S[a], Sb = S[b];
    for (let q = i; q <= j; q++) { const t = (S[q] - Sa) / ((Sb - Sa) || 1), e = t * t * (3 - 2 * t) * 0.5 + t * 0.5; h[q] = ha + (hb - ha) * e; }
    i = j;
  }
  const fixed = S.map(s => s <= S0 + 1e-6 || s >= S1 - 1e-6);
  const lim = Hc.maxGradeByClass ? P.map(p => Hc.maxGradeByClass[p.seg.link ? 'link' : p.seg.cls] ?? Hc.maxGrade) : undefined;
  relax(S, h, fixed, isStruct, Hc, stats, lim);
  // (inside the junction, between the node and the trim: on the plane)
  const cA = clusterOf(ch.start), cB = clusterOf(ch.end);
  for (let i = 0; i < n; i++) { if (S[i] < S0 && cA) h[i] = planeAt(cA, P[i].x, P[i].z); if (S[i] > S1 && cB) h[i] = planeAt(cB, P[i].x, P[i].z); }
  // back onto the segments (a joint's point to both)
  for (const g of ch.parts.map((p: any) => p.seg)) g.h ??= new Array(g.xs.length).fill(0);
  P.forEach((p: any, i) => { p.seg.h[p.k] = h[i]; if (p.also) p.also.seg.h[p.also.k] = h[i]; });
  ch.P = P; ch.S = S; ch.S0 = S0; ch.S1 = S1; ch.h = h; ch.isStruct = isStruct; ch.fixed = fixed; ch.lim = lim;
}

// the grade and its change held to their limits, a few dozen passes, the fixed points never moving
function relax(S: number[], h: number[], fixed: boolean[], isStruct: boolean[], Hc: any, stats: any, lim?: number[]) {
  const n = S.length;
  let touched = false;
  // (the grade allowed from point i to i + 1: the road's class's (Map v5), else Map v4's one maxGrade)
  const lim0 = (i: number) => lim?.[i] ?? Hc.maxGrade;
  for (let pass = 0; pass < Hc.relaxPasses; pass++) {
    let worst = 0;
    for (let i = 0; i + 1 < n; i++) {
      const ds = S[i + 1] - S[i];
      if (ds < 1e-6) continue;
      const lim = (isStruct[i] || isStruct[i + 1] ? Hc.bridgeMaxGrade : lim0(i)) * ds, d = h[i + 1] - h[i], ex = Math.abs(d) - lim;
      if (ex <= 1e-4) continue;
      worst = Math.max(worst, ex / ds);
      const m = Math.sign(d) * ex;
      if (fixed[i] && fixed[i + 1]) continue;
      if (fixed[i]) h[i + 1] -= m; else if (fixed[i + 1]) h[i] += m; else { h[i] += m / 2; h[i + 1] -= m / 2; }
    }
    for (let i = 1; i + 1 < n; i++) {
      if (fixed[i]) continue;
      const d1 = S[i] - S[i - 1], d2 = S[i + 1] - S[i];
      if (d1 < 1e-6 || d2 < 1e-6) continue;
      const g1 = (h[i] - h[i - 1]) / d1, g2 = (h[i + 1] - h[i]) / d2, lim = Hc.maxGradeChange * (d1 + d2) / 2, dg = g2 - g1;
      if (Math.abs(dg) <= lim) continue;
      worst = Math.max(worst, Math.abs(dg) - lim);
      // (towards the straight line between its neighbours, by as much as the excess)
      const line = h[i - 1] + (h[i + 1] - h[i - 1]) * d1 / (d1 + d2), f = Math.min(1, (Math.abs(dg) - lim) / Math.abs(dg));
      h[i] += (line - h[i]) * f;
    }
    if (worst > 1e-4) touched = true; else break;
  }
  if (touched) stats.gradeLimited++;
}

// a bridge over a road: lifted to clear it (a smooth hump within the bridge, its ends where they meet the ground
// unchanged), then the chain's grades held again
function liftBridges(G: { nodes: MNode[]; segs: Seg[] }, chains: any[], Hc: any, stats: any) {
  const C = 40, grid = new Map<string, [Seg, number][]>();
  for (const g of G.segs) if (g.structure !== 'bridge' && !g.internal) for (let k = 0; k + 1 < g.xs.length; k++) {
    for (let i = Math.floor(Math.min(g.xs[k], g.xs[k + 1]) / C); i <= Math.floor(Math.max(g.xs[k], g.xs[k + 1]) / C); i++) for (let j = Math.floor(Math.min(g.zs[k], g.zs[k + 1]) / C); j <= Math.floor(Math.max(g.zs[k], g.zs[k + 1]) / C); j++) { const key = `${i},${j}`; (grid.get(key) ?? grid.set(key, []).get(key)!).push([g, k]); }
  }
  for (const ch of chains) {
    if (!ch.isStruct?.some((v: boolean, i: number) => v && ch.P[i].structure === 'bridge')) continue;
    const P = ch.P, h = ch.h, n = P.length, need = new Array(n).fill(0);
    let any = false;
    const own = new Set(ch.parts.map((p: any) => p.seg.id));
    for (let i = 0; i < n; i++) {
      if (P[i].structure !== 'bridge') continue;
      const x = P[i].x, z = P[i].z, hw = Math.max(P[i].seg.hwL[P[i].k], P[i].seg.hwR[P[i].k]);
      for (const [g, k] of grid.get(`${Math.floor(x / C)},${Math.floor(z / C)}`) ?? []) {
        if (own.has(g.id) || !g.h) continue;
        const ax = g.xs[k], az = g.zs[k], dx = g.xs[k + 1] - ax, dz = g.zs[k + 1] - az, L2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        if (Math.hypot(x - ax - dx * t, z - az - dz * t) > hw + Math.max(g.hwL[k], g.hwR[k])) continue;
        const below = g.h[k] + (g.h[k + 1] - g.h[k]) * t, lift = below + Hc.overpassClearance - h[i];
        // (only what's under it: a road far above or below isn't the one it crosses)
        if (lift > 0 && lift < Hc.overpassClearance + 3) { need[i] = Math.max(need[i], lift); any = true; }
      }
    }
    if (!any) continue;
    stats.lifted++;
    // (a smooth hump: each need spread along the deck, no further than the structure)
    const S = ch.S;
    // (how far each point needing a lift may spread it: to the far end of its structure, 10–150 m — each structure's
    // ends found once)
    const runStart = new Array(n).fill(0), runEnd = new Array(n).fill(0);
    for (let i = 0; i < n; i++) runStart[i] = ch.isStruct[i] && i > 0 && ch.isStruct[i - 1] ? runStart[i - 1] : i;
    for (let i = n - 1; i >= 0; i--) runEnd[i] = ch.isStruct[i] && i + 1 < n && ch.isStruct[i + 1] ? runEnd[i + 1] : i;
    const lifts: { q: number; reach: number }[] = [];
    for (let q = 0; q < n; q++) if (need[q] > 0) lifts.push({ q, reach: Math.max(10, Math.min(150, ch.isStruct[q] ? Math.max(S[runEnd[q]] - S[q], S[q] - S[runStart[q]]) : 0)) });
    const bump = S.map((s: number, i: number) => { if (!ch.isStruct[i]) return 0; let m = 0; for (const { q, reach } of lifts) { const d = Math.abs(S[q] - s); if (d >= reach) continue; const u = 1 - d / reach, f = u * u * (3 - 2 * u); m = Math.max(m, need[q] * Math.min(1, f * 1.6)); } return m; });
    for (let i = 0; i < n; i++) h[i] += bump[i];
    relax(S, h, ch.fixed, ch.isStruct, Hc, stats);
    P.forEach((p: any, i: number) => { p.seg.h[p.k] = h[i]; if (p.also) p.also.seg.h[p.also.k] = h[i]; });
  }
}

// each chain's heights (straight between its points) averaged over Hc.drawnSmooth m either side, sampled along each of
// its segments every Hc.drawnStep m and at its own points (seg.vs: s along it, seg.vh: the height); seg.h at its points
// the same. Never past the chain's trims — the window shrinks towards them, so each end's height is exactly as solved
// (a junction's plane) — and a joint's point the same in both its segments
function drawnProfiles(chains: any[], Hc: any) {
  const R = Hc.drawnSmooth, step = Hc.drawnStep;
  if (!(R > 0) || !(step > 0)) return;
  for (const ch of chains) {
    const S: number[] = ch.S, h: number[] = ch.h, n = S?.length ?? 0;
    if (n < 2) continue;
    // (the polyline's integral from the chain's start, at each point; between points a quadratic)
    const I = new Float64Array(n);
    for (let i = 1; i < n; i++) I[i] = I[i - 1] + (S[i] - S[i - 1]) * (h[i] + h[i - 1]) / 2;
    const seg = (s: number) => { let lo = 0, hi = n - 1; if (s <= S[0]) return 0; if (s >= S[hi]) return hi - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; } return lo; };
    const at = (s: number) => { const i = seg(s), d = S[i + 1] - S[i]; return d > 1e-9 ? h[i] + (h[i + 1] - h[i]) * Math.max(0, Math.min(1, (s - S[i]) / d)) : h[i]; };
    const integ = (s: number) => { const i = seg(s), d = S[i + 1] - S[i], t = Math.max(0, Math.min(d, s - S[i])), g = d > 1e-9 ? (h[i + 1] - h[i]) / d : 0; return I[i] + t * (h[i] + g * t / 2); };
    const lo = ch.cycle ? S[0] : ch.S0, hi = ch.cycle ? S[n - 1] : ch.S1;
    const drawn = (s: number) => { if (s <= lo || s >= hi) return at(s); const r = Math.min(R, s - lo, hi - s); return r < 0.05 ? at(s) : (integ(s + r) - integ(s - r)) / (2 * r); };
    let base = 0;
    for (const { seg: g, fwd } of ch.parts) {
      const L = g.s[g.s.length - 1], chainS = (sl: number) => base + (fwd ? sl : L - sl);
      const st = new Set<number>(g.s);
      for (let v = step; v < L - step / 2; v += step) if (!g.s.some((q: number) => Math.abs(q - v) < step / 4)) st.add(v);
      const vs = [...st].sort((a, b) => a - b);
      g.vs = vs; g.vh = vs.map(v => drawn(chainS(v)));
      g.h = g.s.map((v: number) => drawn(chainS(v)));
      base += L;
    }
  }
}
// a quadratic's terms over a plane fitted at (mx, mz): least squares on what the plane leaves (weighted as the plane's
// fit), its curvature (the largest |eigenvalue| of its second derivatives) held to maxCurvature
function fitQuadratic(pts: number[][], mx: number, mz: number, plane: any, maxCurvature: number) {
  // (normal equations for [qa, qb, qc, da, db, dc]: the plane's own terms refitted with it)
  const A = Array.from({ length: 6 }, () => new Array(7).fill(0));
  for (const p of pts) {
    const dx = p[0] - mx, dz = p[1] - mz, w = p[3], f = [dx * dx, dx * dz, dz * dz, dx, dz, 1], r = p[2] - (plane.a * dx + plane.b * dz + plane.c);
    for (let i = 0; i < 6; i++) { for (let j = 0; j < 6; j++) A[i][j] += w * f[i] * f[j]; A[i][6] += w * f[i] * r; }
  }
  for (let i = 0; i < 6; i++) A[i][i] += 1e-6 * (A[i][i] || 1);
  for (let c = 0; c < 6; c++) {
    let piv = c; for (let r = c + 1; r < 6; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-12) return null;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < 6; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let k = c; k < 7; k++) A[r][k] -= f * A[c][k]; }
  }
  const x = A.map((row, i) => row[6] / row[i]);
  let [qa, qb, qc] = x;
  // (curvature: the Hessian [[2qa, qb], [qb, 2qc]]'s largest |eigenvalue|)
  const tr = qa + qc, det = 4 * qa * qc - qb * qb, disc = Math.sqrt(Math.max(0, tr * tr - det)), k = Math.max(Math.abs(tr + disc), Math.abs(tr - disc));
  if (k > maxCurvature) { const f = maxCurvature / k; qa *= f; qb *= f; qc *= f; }
  // (the plane's terms fitted again under the quadratic as it now is — fitted jointly with a curvature since cut back,
  // they'd tilt to make up for it)
  let W = 0, sx = 0, sz = 0, sh = 0;
  const rest = pts.map(p => { const dx = p[0] - mx, dz = p[1] - mz; return [dx, dz, p[2] - (qa * dx * dx + qb * dx * dz + qc * dz * dz), p[3]]; });
  for (const [dx, dz, h, w] of rest) { W += w; sx += w * dx; sz += w * dz; sh += w * h; }
  const ox = sx / W, oz = sz / W, oh = sh / W;
  let xx = 0, xz = 0, zz = 0, xh = 0, zh = 0;
  for (const [dx, dz, h, w] of rest) { const u = dx - ox, v = dz - oz, e = h - oh; xx += w * u * u; xz += w * u * v; zz += w * v * v; xh += w * u * e; zh += w * v * e; }
  const det2 = xx * zz - xz * xz;
  if (Math.abs(det2) < 1e-9) return null;
  const a = (xh * zz - zh * xz) / det2, b = (zh * xx - xh * xz) / det2;
  return { qa, qb, qc, a, b, c: oh - a * ox - b * oz };
}

// Map v5's bridges (Step 1d): every deck point over another road or a railway needs its surface clearance + deckDepth
// over it. That need falls away along the chain at approachGrade — onto the deck's approaches, not within the deck only —
// so the road rises on an embankment to meet it; where a chain ends at a junction lower than the need there, the junction
// is raised and every road round it solved again. A few rounds; what still falls short is counted (stats).
function clearancePass(G: { nodes: MNode[]; segs: Seg[] }, T: { clusters: Cluster[] }, chains: any[], clusterOf: (k: number) => any, demAt: (x: number, z: number) => number, Hc: any, stats: any, rails: { xs: number[]; zs: number[] }[]) {
  void T;
  const C = 40, grid = new Map<number, [any, number, boolean][]>(), key = (i: number, j: number) => (i + 5000) * 10000 + j + 5000;
  const add = (g: any, k: number, rail: boolean) => { const xs = g.xs, zs = g.zs; for (let i = Math.floor(Math.min(xs[k], xs[k + 1]) / C); i <= Math.floor(Math.max(xs[k], xs[k + 1]) / C); i++) for (let j = Math.floor(Math.min(zs[k], zs[k + 1]) / C); j <= Math.floor(Math.max(zs[k], zs[k + 1]) / C); j++) (grid.get(key(i, j)) ?? grid.set(key(i, j), []).get(key(i, j))!).push([g, k, rail]); };
  // (a junction's own roads too — a deck over a big junction, the Superway over Grand Junction Road, crosses those, not
  // the roads leading into it: on the junction's surface, solved already)
  for (const g of G.segs) if (g.structure !== 'bridge') for (let k = 0; k + 1 < g.xs.length; k++) add(g, k, false);
  for (const r of rails) for (let k = 0; k + 1 < r.xs.length; k++) add(r, k, true);
  const clusterOfSeg = (g: any) => (g.internal ? clusterOf(g.from) ?? clusterOf(g.to) : null);
  const railH = (r: any, k: number, t: number) => demAt(r.xs[k] + (r.xs[k + 1] - r.xs[k]) * t, r.zs[k] + (r.zs[k + 1] - r.zs[k]) * t);
  const seen = new Map<any, Map<any, boolean>>();
  const crosses = (ch: any, g: any) => {
    const m = seen.get(ch) ?? seen.set(ch, new Map()).get(ch)!;
    if (m.has(g)) return m.get(g)!;
    const P = ch.P, xs = g.xs, zs = g.zs;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < xs.length; k++) { x0 = Math.min(x0, xs[k]); x1 = Math.max(x1, xs[k]); z0 = Math.min(z0, zs[k]); z1 = Math.max(z1, zs[k]); }
    let hit = false;
    for (let i = 0; i + 1 < P.length && !hit; i++) {
      if (P[i].structure !== 'bridge' && P[i + 1].structure !== 'bridge') continue;
      const ax = P[i].x, az = P[i].z, bx = P[i + 1].x, bz = P[i + 1].z;
      if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(az, bz) < z0 || Math.min(az, bz) > z1) continue;
      for (let k = 0; k + 1 < xs.length; k++) {
        const cx = xs[k], cz = zs[k], ex = xs[k + 1] - cx, ez = zs[k + 1] - cz, dx = bx - ax, dz = bz - az, den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((cx - ax) * ez - (cz - az) * ex) / den, u = ((cx - ax) * dz - (cz - az) * dx) / den;
        if (t > 1e-3 && t < 1 - 1e-3 && u >= -1e-6 && u <= 1 + 1e-6) { hit = true; break; }
      }
    }
    m.set(g, hit);
    return hit;
  };
  // (under: each road or railway under a deck point, as { i, g, k, t, rail, jc } — the underpass step's)
  const needsOf = (ch: any, under?: any[]) => {
    const P = ch.P, own = new Set(ch.parts.map((p: any) => p.seg.id)), out: { i: number; need: number }[] = [];
    // (not the junctions the chain itself comes down into: it lands on those)
    const landsOn = new Set([clusterOf(ch.start), clusterOf(ch.end)].filter(Boolean));
    // (the chain's own road counts where it comes back under itself — a loop ramp — far enough along it)
    const at = new Map<string, number>(); P.forEach((p: any, i: number) => at.set(`${p.seg.id}:${p.k}`, i));
    for (let i = 0; i < P.length; i++) {
      if (P[i].structure !== 'bridge') continue;
      const x = P[i].x, z = P[i].z, sg = P[i].seg, hw = Math.max(sg.hwL[P[i].k], sg.hwR[P[i].k]);
      let need = -Infinity;
      for (const [g, k, rail] of grid.get(key(Math.floor(x / C), Math.floor(z / C))) ?? []) {
        const jc = rail ? null : clusterOfSeg(g);
        if (jc && landsOn.has(jc)) continue;
        if (!rail && ((!g.h && !jc) || g.from === sg.from || g.to === sg.to || g.from === sg.to || g.to === sg.from)) continue;
        if (!rail && own.has(g.id) && !(Math.abs(ch.S[at.get(`${g.id}:${k}`) ?? i] - ch.S[i]) > Hc.selfCrossAlong)) continue;
        const ax = g.xs[k], az = g.zs[k], dx = g.xs[k + 1] - ax, dz = g.zs[k + 1] - az, L2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        const ohw = rail ? 2.5 : Math.max(g.hwL[k], g.hwR[k]);
        if (Math.hypot(x - ax - dx * t, z - az - dz * t) > hw + ohw) continue;
        // (crossing it, not beside it: a parallel carriageway, or the road a deck merges into, isn't under the deck —
        // what's under it is a road whose centre line crosses the deck's in plan)
        // (or along under it: a road whose centre line runs beneath the deck's surface — South Road under the Superway —
        // away from where the deck comes down to the ground it's anchored to, (clearance + deckDepth) / approachGrade m)
        if (!crosses(ch, g)) {
          const off = Math.hypot(x - ax - dx * t, z - az - dz * t);
          if (!(off < hw - 0.5 && anchorDist(P[i]) > (Hc.clearance + Hc.deckDepth) / Hc.approachGrade)) continue;
        }
        const below = rail ? railH(g, k, t) : jc ? planeAt(jc, ax + dx * t, az + dz * t) : g.h[k] + (g.h[k + 1] - g.h[k]) * t, want = below + (rail ? Hc.clearanceRail : Hc.clearance) + Hc.deckDepth;
        // (only what's under it: a road far above or below is another level — another deck, a tunnel)
        if (want > ch.h[i] - Hc.deckDepth - 12 && want < ch.h[i] + 12) { need = Math.max(need, want); under?.push({ i, g, k, t, rail, jc }); }
      }
      if (need > -Infinity) out.push({ i, need });
    }
    return out;
  };
  // (a viaduct stays up: the decks joined through nodes off the ground — a viaduct, its ramps and the junctions on it —
  // are one structure, every deck point of it at least its lowest need, less approachGrade from the ground it's anchored
  // to. Chain by chain, the Superway's 2.8 km over South Road came down to 1.7 m over the road it runs above, between its
  // crossings, at the junctions on it where its ramps join — those take their heights from the ground at its ends)
  const compOf = new Map<number, number>(), toAnchor = new Map<number, { d: number; h: number }>();
  // (on the ground: a road on the ground meets it there — a motorway's corridor profile runs across its decks too, so
  // its nodes up on the viaduct count as on its corridor, not on the ground, here)
  const onGround = (k: number) => G.nodes[k].segs.some(i => G.segs[i].structure === 'ground');
  {
    let next = 0;
    for (const g0 of G.segs) {
      if (g0.structure !== 'bridge' || compOf.has(g0.id)) continue;
      const id = next++, comp: any[] = [], stack = [g0]; compOf.set(g0.id, id);
      while (stack.length) { const g = stack.pop()!; comp.push(g); for (const nk of [g.from, g.to]) if (!onGround(nk)) for (const si of G.nodes[nk].segs) { const o = G.segs[si]; if (o.structure === 'bridge' && !compOf.has(o.id)) { compOf.set(o.id, id); stack.push(o); } } }
      // (each node's road distance to the nearest ground it's anchored to, and that ground's height)
      const q: number[] = [];
      for (const g of comp) for (const nk of [g.from, g.to]) if (onGround(nk) && !toAnchor.has(nk)) { toAnchor.set(nk, { d: 0, h: G.nodes[nk].h }); q.push(nk); }
      while (q.length) {
        q.sort((a, b) => toAnchor.get(a)!.d - toAnchor.get(b)!.d);
        const u = q.shift()!, du = toAnchor.get(u)!;
        for (const g of comp) { const v = g.from === u ? g.to : g.to === u ? g.from : -1; if (v < 0) continue; const nd = du.d + g.s[g.s.length - 1]; if (nd < (toAnchor.get(v)?.d ?? Infinity)) { toAnchor.set(v, { d: nd, h: du.h }); q.push(v); } }
      }
    }
  }
  let level = new Map<number, number>();
  const anchorDist = (p: any) => { const g = p.seg, s = g.s[p.k], L = g.s[g.s.length - 1], a = toAnchor.get(g.from), b = toAnchor.get(g.to); return Math.min(a ? a.d + s : Infinity, b ? b.d + L - s : Infinity); };
  const viaductFloor = (p: any) => {
    if (p.structure !== 'bridge') return -Infinity;
    const lv = level.get(compOf.get(p.seg.id)!); if (lv === undefined) return -Infinity;
    const g = p.seg, s = g.s[p.k], L = g.s[g.s.length - 1], a = toAnchor.get(g.from), b = toAnchor.get(g.to);
    const da = a ? a.d + s : Infinity, db = b ? b.d + L - s : Infinity, near = da <= db ? a : b;
    return near ? Math.min(lv, near.h + Hc.approachGrade * Math.min(da, db)) : lv;
  };
  // (and along one deck, between two of its needs, no lower than the lower of them: no dip between what it crosses)
  const floorOf = (ch: any, needs: { i: number; need: number }[]) => {
    const F = ch.S.map((s: number, i: number) => { let m = viaductFloor(ch.P[i]); for (const q of needs) m = Math.max(m, q.need - Hc.approachGrade * Math.abs(ch.S[q.i] - s)); return m; });
    const sorted = [...needs].sort((a, b) => a.i - b.i);
    for (let q = 0; q + 1 < sorted.length; q++) {
      const a = sorted[q], b = sorted[q + 1];
      if (b.i - a.i < 2) continue;
      let deck = true; for (let i = a.i; i <= b.i && deck; i++) deck = ch.P[i].structure === 'bridge';
      if (!deck) continue;
      const lo = Math.min(a.need, b.need);
      for (let i = a.i + 1; i < b.i; i++) F[i] = Math.max(F[i], lo);
    }
    return F;
  };
  const bridgeChains = chains.filter(ch => ch.P && ch.isStruct?.some((v: boolean, i: number) => v && ch.P[i].structure === 'bridge'));
  // (a junction is raised for a deck no more than every other road from it could climb, at raiseGrade, between its trims
  // — Anzac Highway's 2-road junction at the foot of its bridge over South Road went up 3.4 m with 4 m of road behind it,
  // a 37% ramp; what that leaves the deck short over the road it crosses, the road is lowered for: underpasses)
  const chainsAt = new Map<any, any[]>();
  for (const ch of chains) if (ch.P && !ch.cycle) for (const k of [ch.start, ch.end]) { const c = clusterOf(k); if (c) { const L = chainsAt.get(c) ?? chainsAt.set(c, []).get(c)!; if (!L.includes(ch)) L.push(ch); } }
  const raiseRoom = (c: any, ch: any) => {
    let room = Infinity;
    for (const o of chainsAt.get(c) ?? []) if (o !== ch) room = Math.min(room, Math.max(0, Hc.raiseGrade * (o.S1 - o.S0)));
    return room;
  };
  // (and from a junction that can't go up as far as a deck wants — held to its main road, or that far — the deck rises
  // at approachGrade: lifted at its very end instead, over the junction's plane, it was a ramp up to 66%; what it can't
  // reach, the road under it is lowered for)
  const heldDown = new Set<any>();
  const capHeld = (ch: any, F: number[]) => {
    if (ch.cycle) return F;
    for (const [k, sc] of [[ch.start, ch.S0], [ch.end, ch.S1]] as [number, number][]) {
      const c = clusterOf(k); if (!c || !heldDown.has(c)) continue;
      let i = 0; while (i + 1 < ch.S.length && ch.S[i] < sc - 1e-6) i++;
      const h0 = planeAt(c, ch.P[i].x, ch.P[i].z);
      for (let q = 0; q < F.length; q++) F[q] = Math.min(F[q], h0 + Hc.approachGrade * Math.abs(ch.S[q] - sc));
    }
    return F;
  };
  for (let round = 0; round < 3; round++) {
    const work: { ch: any; needs: { i: number; need: number }[] }[] = [];
    const all = bridgeChains.map(ch => ({ ch, needs: needsOf(ch) }));
    level = new Map();
    for (const { ch, needs } of all) for (const q of needs) { const c = compOf.get(ch.P[q.i].seg.id); if (c !== undefined && ch.P[q.i].structure === 'bridge') level.set(c, Math.min(level.get(c) ?? Infinity, q.need)); }
    for (const w of all) if (w.needs.length || w.ch.P.some((p: any) => p.structure === 'bridge' && level.has(compOf.get(p.seg.id)!))) work.push(w);
    if (!work.length) break;
    if (round === 0) for (const w of work) stats.crossings += w.needs.length;
    // (the junctions at the chains' ends, raised to meet their floors at the trims)
    const raise = new Map<any, number>();
    for (const { ch, needs } of work) {
      if (ch.cycle) continue;
      const F = floorOf(ch, needs);
      for (const [k, sc] of [[ch.start, ch.S0], [ch.end, ch.S1]] as [number, number][]) {
        const c = clusterOf(k); if (!c) continue;
        let i = 0; while (i + 1 < ch.S.length && ch.S[i] < sc - 1e-6) i++;
        const here = planeAt(c, ch.P[i].x, ch.P[i].z);
        if (F[i] > here + 0.05 && c.pinned) heldDown.add(c);
        else if (F[i] > here + 0.05) { const d = Math.min(F[i] - here, raiseRoom(c, ch)); if (d < F[i] - here - 0.05) { stats.raiseCapped++; heldDown.add(c); } if (d > 0.05) raise.set(c, Math.max(raise.get(c) ?? 0, d)); }
      }
    }
    if (raise.size) {
      for (const [c, d] of raise) { c.plane.c += d; for (const k of c.nodes) G.nodes[k].h = planeAt(c, G.nodes[k].x, G.nodes[k].z); stats.raisedJunctions++; }
      for (const ch of chains) if (!ch.cycle && [clusterOf(ch.start), clusterOf(ch.end)].some(c => c && raise.has(c))) solveChain(ch, G, clusterOf, demAt, Hc, stats);
    }
    // (each bridge chain: at least its floor, its grades held again with the floor's points fixed)
    for (const { ch, needs } of work) {
      const F = capHeld(ch, floorOf(ch, needs)), h = ch.h;
      for (let i = 0; i < h.length; i++) if (F[i] > h[i]) h[i] = F[i];
      const fixed = ch.fixed.map((f: boolean, i: number) => f || F[i] >= h[i] - 1e-6);
      for (let pass = 0; pass < 3; pass++) { relax(ch.S, h, fixed, ch.isStruct, Hc, stats, ch.lim); for (let i = 0; i < h.length; i++) if (F[i] > h[i]) h[i] = F[i]; }
      ch.P.forEach((p: any, i: number) => { p.seg.h[p.k] = h[i]; if (p.also) p.also.seg.h[p.also.k] = h[i]; });
      if (round === 0) stats.lifted++;
    }
  }
  // (what still falls short: a deck under its need anywhere)
  for (const ch of bridgeChains) for (const q of needsOf(ch)) if (ch.h[q.i] < q.need - 0.1) { stats.shortOfClearance++; break; }
  return { needsOf, bridgeChains };
}

// (Map v5) the road under a deck that can't rise enough, lowered under it: an underpass, as Adelaide's are. A deck eases
// onto a junction's plane over its last armEase m (map/model/surface.ts), so one crossing a road just past a junction
// held to its main road (pinned) is drawn lower than its profile — Torrens Road over Devonport Terrace, 12–20 m from its
// junction, came to 3.2 m over it. The deck's edges as drawn, every metre over the road under it, less deckDepth and
// underpass.clearance, are the most that road may be there: its chain is cut down to that, flat for drawnSmooth +
// underpass.flat m either side (its vertical curves don't round the dip back up) and back up at approachGrade, its grades
// held again with those points fixed. A ground road only — never its trims (a junction's surface), a railway or a road
// in a junction — and no more than underpass.maxDepth m down: what's still short is counted (stats.underpassShort).
// Returns the chains lowered (their drawn profiles made again).
function underpasses(G: { nodes: MNode[]; segs: Seg[] }, T: { clusters: Cluster[] }, chains: any[], { needsOf, bridgeChains }: { needsOf: (ch: any, under?: any[]) => any[]; bridgeChains: any[] }, Hc: any, stats: any) {
  const U = Hc.underpass, where = new Map<string, { ch: any; i: number }>();
  for (const ch of chains) ch.P?.forEach((p: any, i: number) => { where.set(`${p.seg.id}:${p.k}`, { ch, i }); if (p.also) where.set(`${p.also.seg.id}:${p.also.k}`, { ch, i }); });
  const caps = new Map<any, { sc: number; top: number }[]>();
  for (const ch of bridgeChains) {
    const under: any[] = [], done = new Set<string>();
    needsOf(ch, under);
    for (const u of under) {
      const g = u.g, sg = ch.P[u.i].seg;
      if (u.rail || u.jc || g.structure !== 'ground' || done.has(`${sg.id}:${g.id}`)) continue;
      done.add(`${sg.id}:${g.id}`);
      // (the deck's two edges as drawn, every metre along it: crossing at a skew, one edge is over the road well past
      // where its middle is — Anzac Highway's over South Road, near where the deck comes down)
      const { s0, s1, planes } = planesOf(sg, G, T, Hc);
      for (let s = s0; s <= s1 + 1e-6; s += 1) {
        const r = rowAt(sg, s);
        for (const off of [r.hwL, -r.hwR]) {
          const [x, z] = at(r, off), y = surfaceHeight(sg, s, off, x, z, Hc, planes);
          // (over the road: its nearest piece, within its half width)
          let best = Infinity, kk = -1, tt = 0;
          for (let k = 0; k + 1 < g.xs.length; k++) {
            const ax = g.xs[k], az = g.zs[k], dx = g.xs[k + 1] - ax, dz = g.zs[k + 1] - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1e-9))), d = Math.hypot(x - ax - dx * t, z - az - dz * t);
            if (d < best) { best = d; kk = k; tt = t; }
          }
          if (kk < 0 || best > Math.max(g.hwL[kk], g.hwR[kk]) + 0.3) continue;
          const w0 = where.get(`${g.id}:${kk}`), w1 = where.get(`${g.id}:${kk + 1}`);
          if (!w0 || !w1 || w0.ch !== w1.ch || w0.ch === ch || w0.ch.cycle) continue;
          const lc = w0.ch;
          (caps.get(lc) ?? caps.set(lc, []).get(lc)!).push({ sc: lc.S[w0.i] + (lc.S[w1.i] - lc.S[w0.i]) * tt, top: y - Hc.deckDepth - U.clearance });
        }
      }
    }
  }
  const lowered: any[] = [];
  for (const [lc, cs] of caps) {
    const S: number[] = lc.S, h: number[] = lc.h, n = h.length, flat = Hc.drawnSmooth + U.flat, h0 = h.slice();
    const cap = S.map(s => { let m = Infinity; for (const c of cs) m = Math.min(m, c.top + Hc.approachGrade * Math.max(0, Math.abs(s - c.sc) - flat)); return m; });
    const can = (i: number) => !lc.fixed[i] && lc.P[i].structure === 'ground', fixed = lc.fixed.slice();
    // (no deeper than the road can come down at its grade from where it can't move — a junction's surface at its trim, a
    // structure: by the South Eastern Freeway's Mount Osmond interchange it went back up to the junction at 16%)
    const room = new Array(n).fill(U.maxDepth);
    for (let i = 0; i < n; i++) if (!can(i)) for (let q = 0; q < n; q++) room[q] = Math.min(room[q], Math.max(0, (lc.lim?.[q] ?? Hc.maxGrade) * Math.abs(S[q] - S[i]) + h0[q] - h0[i]));
    let deepest = 0;
    for (let i = 0; i < n; i++) if (can(i) && h[i] > cap[i] + 1e-3) { h[i] = Math.max(cap[i], h0[i] - room[i]); fixed[i] = true; deepest = Math.max(deepest, h0[i] - h[i]); }
    if (!deepest) { stats.underpassShort += cs.length ? 1 : 0; continue; }
    for (let pass = 0; pass < 3; pass++) { relax(S, h, fixed, lc.isStruct, Hc, stats, lc.lim); for (let i = 0; i < n; i++) if (can(i) && h[i] > cap[i]) h[i] = Math.max(cap[i], h0[i] - room[i]); }
    lc.P.forEach((p: any, i: number) => { p.seg.h[p.k] = h[i]; if (p.also) p.also.seg.h[p.also.k] = h[i]; });
    stats.underpasses++; stats.underpassDeepest = Math.max(stats.underpassDeepest, +deepest.toFixed(2));
    if (cs.some(c => lerpAt(S, h, c.sc) > c.top + 0.05)) stats.underpassShort++;
    lowered.push(lc);
  }
  return lowered;
}

// (Map v5) the bridges over a run of points (a corridor's carriageway) carrying a main road of their own — held to its
// own profile and junctions, so a deck that can't rise for what's under it — where each, standing on the ground at both
// ends, crosses it: s along the run, and the most the run may be there (the ground at the deck's ends, between them as
// far along it as it crosses, less clearance and deckDepth). A lesser road's deck rises for it instead: the clearance pass
function decksOver(pts: { x: number; z: number; S: number; g: Seg }[], G: { nodes: MNode[]; segs: Seg[] }, demAt: (x: number, z: number) => number, Hc: any) {
  // (another road, crossing it: not its own other carriageway, whose deck can meet it at a shallow angle where they part)
  // (under a motorway, any road's: Tonsley Boulevard's decks over the Southern Expressway, Torrens Road's over the
  // North-South Motorway — held at their ends by junctions on South Road, they came down to 1.5 m over it, or rose 6 m
  // over the ground in a 17% ramp)
  const own = new Set(pts.map(p => p.g.id)), grounded = (k: number) => G.nodes[k].segs.some(i => G.segs[i].structure === 'ground'), name = pts[0]?.g.name ?? null;
  const main = new Set<string>((Hc.corridor.underAnyDeck ?? []).includes(pts[0]?.g.cls) ? Object.keys(Hc.maxGradeByClass).filter(c => c !== 'track' && c !== 'link') : Hc.corridor.classes);
  // (a deck in pieces — split where its ramps join, off the ground — stands on the ground where the bridge it's part of
  // comes down: along it through each node off the ground (the piece of the same name on, else any), its road distance
  // to there; none if it never does)
  const toGround = (d0: Seg, k0: number) => {
    let prev = d0, k = k0, dist = 0;
    for (let guard = 0; guard < 50; guard++) {
      if (grounded(k)) return { k, d: dist };
      const on = G.nodes[k].segs.map(i => G.segs[i]).filter(o => o !== prev && o.structure === 'bridge');
      const o = on.find(o => (o.name ?? null) === (prev.name ?? null)) ?? on[0];
      if (!o) return null;
      dist += o.s[o.s.length - 1]; k = o.from === k ? o.to : o.from; prev = o;
    }
    return null;
  };
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  const out: { sc: number; top: number }[] = [];
  for (const d of G.segs) {
    if (d.structure !== 'bridge' || own.has(d.id) || !main.has(d.cls) || (name && d.name === name)) continue;
    if (Math.max(...d.xs) < x0 || Math.min(...d.xs) > x1 || Math.max(...d.zs) < z0 || Math.min(...d.zs) > z1) continue;
    const A = toGround(d, d.from), B = toGround(d, d.to);
    if (!A || !B) continue;
    const Ld = d.s[d.s.length - 1], L = A.d + Ld + B.d, hA = demAt(G.nodes[A.k].x, G.nodes[A.k].z), hB = demAt(G.nodes[B.k].x, G.nodes[B.k].z);
    for (let k = 0; k + 1 < d.xs.length; k++) for (let i = 0; i + 1 < pts.length; i++) {
      const ax = d.xs[k], az = d.zs[k], dx = d.xs[k + 1] - ax, dz = d.zs[k + 1] - az, cx = pts[i].x, cz = pts[i].z, ex = pts[i + 1].x - cx, ez = pts[i + 1].z - cz, den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((cx - ax) * ez - (cz - az) * ex) / den, u = ((cx - ax) * dz - (cz - az) * dx) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1 || Math.abs(den) / (Math.hypot(dx, dz) * Math.hypot(ex, ez) || 1) < Math.sin(30 * Math.PI / 180)) continue;
      const f = (A.d + d.s[k] + (d.s[k + 1] - d.s[k]) * t) / (L || 1);
      out.push({ sc: pts[i].S + (pts[i + 1].S - pts[i].S) * u, top: hA + (hB - hA) * f - Hc.clearance - Hc.deckDepth });
    }
  }
  return out;
}

// (Map v5) main roads' height profiles along whole carriageways. Overture's copy of OSM splits a road at every
// junction and ramp, and each piece was fitted to the ground on its own, between junction planes fitted to the ground
// too — a freeway in a cutting got the hill's grade (the SE Freeway's 13% at the Heysen Tunnels; it's 6%). Here each
// carriageway of Hc.corridor.classes — the segments chained through each node to the one continuing it (the same name
// and class, turning no more than turn°) — is one profile: the elevation along it (none on a bridge or in a tunnel,
// nor within portalSkip m of a tunnel's mouth — the cutting there — nor bridgeSkip m of a bridge's ends; straight
// across those), a Gaussian of sigma m, then held to its class's grade (maxGradeByClass) by relaxation with nothing
// fixed. Sets seg.corr (a height per point). Returns the number of carriageways.
function corridorProfiles(G: { nodes: MNode[]; segs: Seg[] }, demAt: (x: number, z: number) => number, Hc: any) {
  const C = Hc.corridor, classes = new Set<string>(C.classes), segs = G.segs.filter(g => !g.internal && classes.has(g.cls));
  // (through a junction's own short pieces too: they're the same road)
  const dirAt = (g: Seg, atEnd: boolean) => { const n = g.xs.length, a = atEnd ? n - 2 : 0, b = atEnd ? n - 1 : 1; const dx = g.xs[b] - g.xs[a], dz = g.zs[b] - g.zs[a], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
  const used = new Set<number>();
  const next = (g: Seg, fwd: boolean) => {
    const k = fwd ? g.to : g.from, d = dirAt(g, fwd), u = fwd ? d : [-d[0], -d[1]];
    let best: { g: Seg; fwd: boolean; turn: number } | null = null;
    for (const i of G.nodes[k].segs) {
      const o = G.segs[i];
      if (o === g || used.has(o.id) || !classes.has(o.cls) || (o.name ?? '') !== (g.name ?? '') || o.cls !== g.cls) continue;
      const of = o.from === k; if (!of && o.to !== k) continue;
      if (o.oneway && g.oneway && of !== fwd) continue;
      const e = dirAt(o, !of), v = of ? e : [-e[0], -e[1]], turn = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]))) * 180 / Math.PI;
      if (turn > C.turn) continue;
      if (!best || turn < best.turn) best = { g: o, fwd: of, turn };
    }
    return best;
  };
  let count = 0;
  for (const g0 of segs) {
    if (used.has(g0.id)) continue;
    used.add(g0.id);
    // (the run both ways from g0)
    const fwdPart: { g: Seg; fwd: boolean }[] = [{ g: g0, fwd: true }], back: { g: Seg; fwd: boolean }[] = [];
    for (let cur = fwdPart[0], guard = 0; guard < 100000; guard++) { const n = next(cur.g, cur.fwd); if (!n) break; used.add(n.g.id); cur = { g: n.g, fwd: n.fwd }; fwdPart.push(cur); }
    for (let cur = { g: g0, fwd: false }, guard = 0; guard < 100000; guard++) { const n = next(cur.g, cur.fwd); if (!n) break; used.add(n.g.id); cur = { g: n.g, fwd: n.fwd }; back.push({ g: n.g, fwd: !n.fwd }); }
    const run = [...back.reverse(), ...fwdPart];
    // (its points, end to end; a shared end once)
    const pts: { x: number; z: number; S: number; g: Seg; k: number; st: string; also?: { g: Seg; k: number } }[] = [];
    let base = 0;
    for (const { g, fwd } of run) {
      const n = g.xs.length, L = g.s[n - 1];
      for (let q = 0; q < n; q++) { const k = fwd ? q : n - 1 - q; if (q === 0 && pts.length) { pts[pts.length - 1].also = { g, k }; continue; } pts.push({ x: g.xs[k], z: g.zs[k], S: base + (fwd ? g.s[k] : L - g.s[k]), g, k, st: g.structure }); }
      base += L;
    }
    const n = pts.length, S = pts.map(p => p.S);
    // (where the ground's elevation is the road's: not on or near a structure)
    const near = new Array(n).fill(Infinity);
    for (let i = 0; i < n; i++) if (pts[i].st !== 'ground') {
      const skip = pts[i].st === 'tunnel' ? C.portalSkip : C.bridgeSkip;
      for (let j = i; j >= 0 && S[i] - S[j] <= skip; j--) near[j] = 0;
      for (let j = i; j < n && S[j] - S[i] <= skip; j++) near[j] = 0;
    }
    const raw = pts.map((p, i) => (near[i] === 0 ? NaN : demAt(p.x, p.z)));
    if (raw.every(v => Number.isNaN(v))) { for (const p of pts) delete (p.g as any).corr; continue; }
    // (straight across the gaps; the ends level with their nearest)
    for (let i = 0; i < n; i++) if (Number.isNaN(raw[i])) {
      let a = i - 1; while (a >= 0 && Number.isNaN(raw[a])) a--;
      let b = i; while (b < n && Number.isNaN(raw[b])) b++;
      for (let q = i; q < b; q++) raw[q] = a < 0 ? raw[b] : b >= n ? raw[a] : raw[a] + (raw[b] - raw[a]) * (S[q] - S[a]) / ((S[b] - S[a]) || 1);
      i = b - 1;
    }
    const h = smoothProfile(S, raw, Hc.median, C.sigma);
    // (held to the grade exactly: halfway between the highest profile within the grade that's nowhere above it and
    // the lowest nowhere below it — each one forward and back pass; where it's within the grade already, both are it)
    const lim = pts.map(p => Hc.maxGradeByClass?.[p.g.link ? 'link' : p.g.cls] ?? Hc.maxGrade);
    const up = [...h], lo = [...h];
    for (let i = 1; i < n; i++) { const d = lim[i - 1] * (S[i] - S[i - 1]); up[i] = Math.min(up[i], up[i - 1] + d); lo[i] = Math.max(lo[i], lo[i - 1] - d); }
    for (let i = n - 2; i >= 0; i--) { const d = lim[i] * (S[i + 1] - S[i]); up[i] = Math.min(up[i], up[i + 1] + d); lo[i] = Math.max(lo[i], lo[i + 1] - d); }
    for (let i = 0; i < n; i++) h[i] = (up[i] + lo[i]) / 2;
    // (Map v5, corridor.underDecks: no higher under a main road's bridge over it than that bridge's ground less clearance
    // and its deck, and from there back up at its grade: Adelaide's newer motorways run in trenches the LiDAR predates,
    // and the North-South Motorway came up level with Port Road's deck over it)
    if (C.underDecks) for (const { sc, top } of decksOver(pts, G, demAt, Hc)) for (let i = 0; i < n; i++) h[i] = Math.min(h[i], top + lim[i] * Math.abs(S[i] - sc));
    for (const { g } of run) (g as any).corr = new Array(g.xs.length).fill(0);
    pts.forEach((p, i) => { (p.g as any).corr[p.k] = h[i]; if (p.also) (p.also.g as any).corr[p.also.k] = h[i]; });
    count++;
  }
  return count;
}
