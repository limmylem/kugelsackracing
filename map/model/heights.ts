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
// Sets seg.h (per point), cluster.plane { cx, cz, a, b, c } (h = a·(x − cx) + b·(z − cz) + c), node.h.
//
//   solveHeights(G, T, demAt, cfg) → { chains, stats }
//   planeAt(cluster, x, z)

import type { MNode, Seg } from './graph.ts';
import type { Cluster } from './topology.ts';
import { rowAt } from './geom.ts';

export const planeAt = (c: Cluster | any, x: number, z: number) => { const p = c.plane; return p.a * (x - p.cx) + p.b * (z - p.cz) + p.c; };

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

export function solveHeights(G: { nodes: MNode[]; segs: Seg[] }, T: { clusters: Cluster[] }, demAt: (x: number, z: number) => number, cfg: any) {
  const Hc = cfg.heights, stats = { chains: 0, lifted: 0, gradeLimited: 0, cycles: 0, planesMoved: 0 };
  // ---- 1. each segment's own smoothed profile
  for (const g of G.segs) { g.raw = g.xs.map((x: number, k: number) => demAt(x, g.zs[k])); g.smooth = smoothProfile(g.s, g.raw, Hc.median, Hc.smooth); }
  // ---- 2. node heights: from the ground roads there; on structures, from the ground they're anchored to
  for (const n of G.nodes) {
    const ground = n.segs.map(i => G.segs[i]).filter(g => g.structure === 'ground');
    n.ground = ground.length > 0;
    const hs = ground.map(g => (G.nodes[g.from] === n ? g.smooth[0] : g.smooth[g.smooth.length - 1]));
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
    for (const k of c.nodes) { const n = G.nodes[k]; pts.push([n.x, n.z, n.h, 2]); }
    for (const A of c.arms) {
      const g = A.seg, s = A.atStart ? A.trim : g.s[g.s.length - 1] - A.trim, r = rowAt(g, s);
      const h = g.structure === 'ground' ? lerpAt(g.s, g.smooth, s) : G.nodes[A.node].h;
      pts.push([r.x, r.z, h, 1]);
    }
    let W = 0, mx = 0, mz = 0, mh = 0;
    for (const p of pts) { W += p[3]; mx += p[0] * p[3]; mz += p[1] * p[3]; mh += p[2] * p[3]; }
    mx /= W; mz /= W; mh /= W;
    let sxx = 0, sxz = 0, szz = 0, sxh = 0, szh = 0;
    for (const p of pts) { const x = p[0] - mx, z = p[1] - mz, h = p[2] - mh; sxx += p[3] * x * x; sxz += p[3] * x * z; szz += p[3] * z * z; sxh += p[3] * x * h; szh += p[3] * z * h; }
    const det = sxx * szz - sxz * sxz;
    let a = Math.abs(det) > 1e-6 ? (sxh * szz - szh * sxz) / det : 0, b = Math.abs(det) > 1e-6 ? (szh * sxx - sxh * sxz) / det : 0;
    // (one point's worth of roads — two nodes on a line — gives no cross slope: the line's own)
    if (Math.abs(det) <= 1e-6 && sxx + szz > 1e-6) { const k = (sxh + szh) / (sxx + szz); a = k * (sxx > szz ? 1 : 0); b = k * (sxx > szz ? 0 : 1); }
    const slope = Math.hypot(a, b);
    if (slope > Hc.junctionMaxSlope) { a *= Hc.junctionMaxSlope / slope; b *= Hc.junctionMaxSlope / slope; }
    (c as any).plane = { cx: mx, cz: mz, a, b, c: mh };
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
  liftBridges(G, chains, Hc, stats);
  // (internal roads of a cluster: on its plane)
  for (const g of G.segs) if (g.internal) { const c = clusterOf(g.from) ?? clusterOf(g.to); g.h = g.xs.map((x: number, k: number) => (c ? planeAt(c, x, g.zs[k]) : g.smooth[k])); }
  return { chains, stats };
}

// neighbouring junctions' planes held to the roads between them: where the road from one plane to the next (trim to
// trim) would rise or fall more than the ground does there, give or take planeGrade, both planes are moved towards
// each other (their heights, not their tilt) — planePasses rounds over every such road. A plane fitted to a noisy
// patch of ground can't leave a cliff, or a dip, for its road; a real hill stays.
function relaxPlanes(chains: any[], clusterOf: (k: number) => any, G: { nodes: MNode[]; segs: Seg[] }, Hc: any, stats: any, demAt: (x: number, z: number) => number) {
  const links: { cA: any; cB: any; pA: number[]; pB: number[]; span: number; rise: number }[] = [];
  for (const ch of chains) {
    if (ch.cycle) continue;
    const cA = clusterOf(ch.start), cB = clusterOf(ch.end);
    if (!cA || !cB || cA === cB) continue;
    const P = chainPoints(ch), n = P.length, S = P.map(p => p.S), first = ch.parts[0], last = ch.parts[ch.parts.length - 1];
    const S0 = Math.max(0, first.fwd ? first.seg.trim0 : first.seg.trim1), S1 = Math.min(S[n - 1], S[n - 1] - Math.max(0, last.fwd ? last.seg.trim1 : last.seg.trim0));
    const posAt = (sc: number) => { let i = 0; while (i + 2 < n && S[i + 1] < sc) i++; const t = Math.max(0, Math.min(1, (sc - S[i]) / ((S[i + 1] - S[i]) || 1))); return [P[i].x + (P[i + 1].x - P[i].x) * t, P[i].z + (P[i + 1].z - P[i].z) * t]; };
    // (structures aside: a bridge's or tunnel's ends are held by their own rules)
    if (ch.parts.some((p: any) => p.seg.structure !== 'ground')) continue;
    const pA = posAt(S0), pB = posAt(S1);
    links.push({ cA, cB, pA, pB, span: Math.max(0.5, S1 - S0), rise: demAt(pB[0], pB[1]) - demAt(pA[0], pA[1]) });
  }
  let moved = 0;
  for (let pass = 0; pass < Hc.planePasses; pass++) {
    let worst = 0;
    for (const L of links) {
      // (the road between them may rise as the ground does, give or take planeGrade — never more than maxGrade)
      const hA = planeAt(L.cA, L.pA[0], L.pA[1]), hB = planeAt(L.cB, L.pB[0], L.pB[1]), want = Hc.planeFollowsGround ? Math.max(-Hc.maxGrade * L.span, Math.min(Hc.maxGrade * L.span, L.rise)) : 0;
      const off = (hB - hA) - want, ex = Math.abs(off) - Hc.planeGrade * L.span;
      if (ex <= 1e-3) continue;
      worst = Math.max(worst, ex);
      const m = Math.sign(off) * ex / 2;
      L.cA.plane.c += m; L.cB.plane.c -= m; moved++;
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
  const raw = P.map(p => demAt(p.x, p.z)), smooth = smoothProfile(S, raw, Hc.median, Hc.smooth);
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
  const isStruct = P.map(p => p.structure !== 'ground');
  for (let i = 0; i < n; i++) {
    if (!isStruct[i]) continue;
    let j = i; while (j + 1 < n && isStruct[j + 1]) j++;
    const a = Math.max(0, i - 1), b = Math.min(n - 1, j + 1), ha = h[a], hb = h[b], Sa = S[a], Sb = S[b];
    for (let q = i; q <= j; q++) { const t = (S[q] - Sa) / ((Sb - Sa) || 1), e = t * t * (3 - 2 * t) * 0.5 + t * 0.5; h[q] = ha + (hb - ha) * e; }
    i = j;
  }
  const fixed = S.map(s => s <= S0 + 1e-6 || s >= S1 - 1e-6);
  relax(S, h, fixed, isStruct, Hc, stats);
  // (inside the junction, between the node and the trim: on the plane)
  const cA = clusterOf(ch.start), cB = clusterOf(ch.end);
  for (let i = 0; i < n; i++) { if (S[i] < S0 && cA) h[i] = planeAt(cA, P[i].x, P[i].z); if (S[i] > S1 && cB) h[i] = planeAt(cB, P[i].x, P[i].z); }
  // back onto the segments (a joint's point to both)
  for (const g of ch.parts.map((p: any) => p.seg)) g.h ??= new Array(g.xs.length).fill(0);
  P.forEach((p: any, i) => { p.seg.h[p.k] = h[i]; if (p.also) p.also.seg.h[p.also.k] = h[i]; });
  ch.P = P; ch.S = S; ch.S0 = S0; ch.S1 = S1; ch.h = h; ch.isStruct = isStruct; ch.fixed = fixed;
}

// the grade and its change held to their limits, a few dozen passes, the fixed points never moving
function relax(S: number[], h: number[], fixed: boolean[], isStruct: boolean[], Hc: any, stats: any) {
  const n = S.length;
  let touched = false;
  for (let pass = 0; pass < Hc.relaxPasses; pass++) {
    let worst = 0;
    for (let i = 0; i + 1 < n; i++) {
      const ds = S[i + 1] - S[i];
      if (ds < 1e-6) continue;
      const lim = (isStruct[i] || isStruct[i + 1] ? Hc.bridgeMaxGrade : Hc.maxGrade) * ds, d = h[i + 1] - h[i], ex = Math.abs(d) - lim;
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
    const bump = S.map((s: number, i: number) => { if (!ch.isStruct[i]) return 0; let m = 0; for (let q = 0; q < n; q++) if (need[q] > 0) { let reach = 0; for (let r = q; r < n && ch.isStruct[r]; r++) reach = Math.max(reach, S[r] - S[q]); for (let r = q; r >= 0 && ch.isStruct[r]; r--) reach = Math.max(reach, S[q] - S[r]); reach = Math.max(10, Math.min(150, reach)); const d = Math.abs(S[q] - s); if (d >= reach) continue; const u = 1 - d / reach, f = u * u * (3 - 2 * u); m = Math.max(m, need[q] * Math.min(1, f * 1.6)); } return m; });
    for (let i = 0; i < n; i++) h[i] += bump[i];
    relax(S, h, ch.fixed, ch.isStruct, Hc, stats);
    P.forEach((p: any, i: number) => { p.seg.h[p.k] = h[i]; if (p.also) p.also.seg.h[p.also.k] = h[i]; });
  }
}
