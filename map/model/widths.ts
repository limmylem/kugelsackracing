// Map v4's road widths (the road surface model, map/model/): each segment's drivable width (lanes and shoulders —
// where cars go) and visual width (that plus a kerb band each side — what's drawn), from data/map/v4.json's
// table by class: the OSM width tag when there is one, else its lanes tag × the lane width, else the class's lanes
// (per direction on a one-way carriageway) — marked estimated. Then roads side by side that don't meet there
// (the two carriageways of a divided road, a service road beside a street): the sides facing each other are
// narrowed so the real gap between them stays (a median kept, never filled in), eased along the road — marked
// adjusted (Map v5, acrossLevels: a bridge beside a road on the ground too, where they run alongside). Each segment
// ends with per-point half widths each side: hwL / hwR (visual), dL / dR (drivable),
// "left" being the side of the normal (−dz, dx) to its direction from → to.
//
//   assignWidths(G, cfg)  (sets seg.lanes, lanesEstimated, drivable, visual, kerb, widthEstimated, hwL, hwR, dL, dR, adjusted)

import type { Seg, MNode } from './graph.ts';

export function classOf(g: Seg) { return g.link ? 'link' : g.cls; }

export function baseWidth(g: Seg, W: any) {
  const C = W.classes[classOf(g)] ?? W.classes.road, lane = C.lane ?? W.laneWidth;
  const perDir = g.oneway ? C.oneWay : C.twoWay;
  const lanes = g.lanesTag && g.lanesTag > 0 && g.lanesTag < 12 ? Math.round(g.lanesTag) : perDir;
  let drivable = lanes * lane + 2 * C.shoulder;
  let widthEstimated = true;
  // (OSM's width: the carriageway, kerb to kerb — believed when it's plausible for the lanes)
  if (g.widthTag && g.widthTag >= 2.5 && g.widthTag <= 60) { drivable = Math.max(g.widthTag - 2 * C.kerb, lanes * 2.6); widthEstimated = false; }
  drivable = Math.min(W.maxDrivable, Math.max(W.minDrivable, drivable * W.multiplier));
  const kerb = C.kerb * Math.min(1, W.multiplier);
  return { lanes, lanesEstimated: !(g.lanesTag && g.lanesTag > 0), drivable, visual: drivable + 2 * kerb, kerb, widthEstimated };
}

const levelOf = (g: Seg) => `${g.structure}|${g.layer}`;

export function assignWidths(G: { nodes: MNode[]; segs: Seg[] }, cfg: any) {
  const W = cfg.widths;
  for (const g of G.segs) {
    Object.assign(g, baseWidth(g, W));
    const n = g.xs.length;
    g.hwL = new Array(n).fill(g.visual / 2); g.hwR = new Array(n).fill(g.visual / 2);
    g.adjusted = false;
  }
  // ---- side by side: a coarse grid of every segment's pieces
  const C = 32, grid = new Map<string, [Seg, number][]>();
  for (const g of G.segs) for (let k = 0; k + 1 < g.xs.length; k++) {
    const x0 = Math.min(g.xs[k], g.xs[k + 1]), x1 = Math.max(g.xs[k], g.xs[k + 1]), z0 = Math.min(g.zs[k], g.zs[k + 1]), z1 = Math.max(g.zs[k], g.zs[k + 1]);
    for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) for (let j = Math.floor(z0 / C); j <= Math.floor(z1 / C); j++) { const key = `${i},${j}`; (grid.get(key) ?? grid.set(key, []).get(key)!).push([g, k]); }
  }
  // (segments that meet this one at a node, and how near that node a point must be for them to count as meeting there)
  const nodeSegs = (n: number) => G.nodes[n].segs;
  for (const g of G.segs) {
    const n = g.xs.length, hw = g.visual / 2, reach = hw + 22;
    const rawL = new Array(n).fill(hw), rawR = new Array(n).fill(hw);
    const near = new Set<number>([...nodeSegs(g.from), ...nodeSegs(g.to)]);
    const L = g.s[n - 1];
    for (let k = 0; k < n; k++) {
      const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1), dx = g.xs[b] - g.xs[a], dz = g.zs[b] - g.zs[a], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
      const x = g.xs[k], z = g.zs[k];
      const seen = new Set<Seg>();
      for (let i = Math.floor((x - reach) / C); i <= Math.floor((x + reach) / C); i++) for (let j = Math.floor((z - reach) / C); j <= Math.floor((z + reach) / C); j++) for (const [o, q] of grid.get(`${i},${j}`) ?? []) {
        // (another level — a bridge beside a road on the ground — only with W.acrossLevels (Map v5), and only alongside:
        // their centre lines apart by at least acrossLevelsShare of their half-widths, not one over the other)
        const across = levelOf(o) !== levelOf(g);
        if (o === g || (across && !W.acrossLevels)) continue;
        // (a road meeting this one at its end node: only beyond where their surfaces part — the junction takes the rest)
        if (near.has(o.id)) {
          const shared = [g.from, g.to].find(nn => nn === o.from || nn === o.to);
          if (shared !== undefined) { const sAt = shared === g.from ? g.s[k] : L - g.s[k]; if (sAt < (hw + o.visual / 2) * 4 + 15) continue; }
        }
        // the ray from this point along the normal (both ways) against that piece
        const ax = o.xs[q], az = o.zs[q], ex = o.xs[q + 1] - ax, ez = o.zs[q + 1] - az;
        const den = nx * ez - nz * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((ax - x) * ez - (az - z) * ex) / den, u = ((ax - x) * nz - (az - z) * nx) / den;
        if (u < -1e-6 || u > 1 + 1e-6 || Math.abs(t) > reach) continue;
        // (only roads alongside: within 35° of parallel — one crossing it is a different matter)
        const el = Math.hypot(ex, ez) || 1, cos = Math.abs((ex * dx + ez * dz) / (el * l));
        if (cos < 0.82) continue;
        const d = Math.abs(t), ho = o.visual / 2, need = hw + ho + W.medianMin;
        if (d >= need || (across && d < (hw + ho) * W.acrossLevelsShare)) continue;
        const allowed = Math.max(W.minHalf, (d - W.medianMin) * hw / (hw + ho));
        if (t > 0) rawL[k] = Math.min(rawL[k], allowed); else rawR[k] = Math.min(rawR[k], allowed);
        seen.add(o);
      }
    }
    // eased: each narrowing ramps back to the full width over easeLength m along the road
    const ease = (raw: number[]) => g.s.map((sk, k) => { let v = raw[k]; for (let q = 0; q < n; q++) if (raw[q] < hw) v = Math.min(v, raw[q] + (hw - raw[q]) * Math.min(1, Math.abs(g.s[q] - sk) / W.easeLength)); return v; });
    if (rawL.some(v => v < hw - 0.01) || rawR.some(v => v < hw - 0.01)) { g.hwL = ease(rawL); g.hwR = ease(rawR); g.adjusted = true; }
  }
  for (const g of G.segs) { const dk = g.kerb; g.dL = g.hwL.map((v: number) => Math.max(0.5, v - dk)); g.dR = g.hwR.map((v: number) => Math.max(0.5, v - dk)); }
}
