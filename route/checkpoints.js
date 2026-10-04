// A route's checkpoints and the shortcuts they guard against, pure.
//
//   findShortcuts(N, built, { loop }) → [{ kind: 'near' | 'road' | 'crossing', a, b, gap, saving, via }]
//       a → b: the stretch of the route a player could skip (b ahead of a; on a loop it may wrap)
//       near: the route passes close to itself (across a verge, a car park); road: another road joins two
//       parts of it; crossing: it crosses itself
//   autoCheckpoints(line, { loop, startS, finishS, spacing, shortcuts, keep, nodes }) → checkpoints
//       one every spacing m, and one inside every shortcut not already cut off (keep: the hand-placed ones)
//   isCovered(cut, checkpoints, L, loop) → a required checkpoint lies inside the skipped stretch

import { project } from './geometry.js';
import { Heap } from './network.js';

export const CHECKPOINTS = { spacing: 500, near: 12, minSkip: 200, minSaving: 150, roadReach: 1500, margin: 10 };

const aheadOf = (a, b, L, loop) => loop ? (((b - a) % L) + L) % L : b - a;

// keep the biggest of each bunch of shortcuts (the same cut seen from neighbouring points)
function bunch(cuts, L, loop, near = 80) {
  const kept = [];
  for (const c of cuts.sort((x, y) => y.saving - x.saving)) {
    const d = (p, q) => loop ? Math.min(Math.abs(p - q), L - Math.abs(p - q)) : Math.abs(p - q);
    if (!kept.some(k => d(k.a, c.a) < near && d(k.b, c.b) < near)) kept.push(c);
  }
  return kept.sort((x, y) => x.a - y.a);
}

// where the line crosses itself (proper crossings, not where it runs back along the same road)
export function crossings(line, loop = false) {
  const cell = 20, grid = new Map(), out = [], L = line.at(-1)?.s ?? 0;
  for (let k = 0; k + 1 < line.length; k++) {
    const a = line[k], b = line[k + 1];
    for (let i = Math.floor(Math.min(a.x, b.x) / cell); i <= Math.floor(Math.max(a.x, b.x) / cell); i++) for (let j = Math.floor(Math.min(a.z, b.z) / cell); j <= Math.floor(Math.max(a.z, b.z) / cell); j++) {
      const key = `${i},${j}`, list = grid.get(key) ?? grid.set(key, []).get(key);
      for (const m of list) {
        const c = line[m], d = line[m + 1];
        if (Math.abs(a.s - c.s) < 30 || (loop && L - Math.abs(a.s - c.s) < 30)) continue;
        const d1 = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x), d2 = (b.x - a.x) * (d.z - a.z) - (b.z - a.z) * (d.x - a.x);
        const d3 = (d.x - c.x) * (a.z - c.z) - (d.z - c.z) * (a.x - c.x), d4 = (d.x - c.x) * (b.z - c.z) - (d.z - c.z) * (b.x - c.x);
        if (d1 * d2 < 0 && d3 * d4 < 0) {
          // (and at a real angle: not two passes along the same road)
          const ux = b.x - a.x, uz = b.z - a.z, vx = d.x - c.x, vz = d.z - c.z, sin = Math.abs(ux * vz - uz * vx) / (Math.hypot(ux, uz) * Math.hypot(vx, vz) || 1);
          if (sin > 0.25) out.push({ kind: 'crossing', a: c.s, b: a.s, gap: 0, saving: a.s - c.s });
        }
      }
      list.push(k);
    }
  }
  return bunch(out, L, loop, 40);
}

// the route close to itself: points less than a road's width or so apart, far apart along it
function nearItself(line, loop) {
  const step = 8, cell = 40, L = line.at(-1).s, pts = [], grid = new Map(), out = [];
  for (let k = 0; k < line.length; k += Math.max(1, Math.round(step / (line[1].s - line[0].s || 4)))) pts.push(line[k]);
  pts.forEach((p, i) => { const key = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`; (grid.get(key) ?? grid.set(key, []).get(key)).push(i); });
  for (const p of pts) {
    const ci = Math.floor(p.x / cell), cj = Math.floor(p.z / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const j of grid.get(`${ci + a},${cj + b}`) ?? []) {
      const q = pts[j];
      if (q.s <= p.s) continue;
      const gap = Math.hypot(q.x - p.x, q.z - p.z), reach = Math.max(CHECKPOINTS.near, (p.w + q.w) / 2 + 6);
      if (gap > reach) continue;
      // either way round: p → q ahead, and on a loop q → p (over the line) too
      for (const [s0, s1] of loop ? [[p.s, q.s], [q.s, p.s]] : [[p.s, q.s]]) {
        const skip = aheadOf(s0, s1, L, loop);
        if (skip >= CHECKPOINTS.minSkip && (!loop || L - skip >= CHECKPOINTS.minSkip) && skip > 4 * gap && skip - gap >= CHECKPOINTS.minSaving) out.push({ kind: 'near', a: s0, b: s1, gap: Math.round(gap), saving: Math.round(skip - gap) });
      }
    }
  }
  return bunch(out, L, loop);
}

// another road joining two parts of the route: from each junction it passes, the shortest way over roads
// it doesn't use (whichever way they run: a player can drive the wrong way) to a later part of it
function overRoads(N, built, loop) {
  const used = new Set(built.segments.map(s => s.key)), L = built.length, out = [];
  const at = new Map();
  for (const nd of built.nodes) (at.get(nd.node) ?? at.set(nd.node, []).get(nd.node)).push(nd.s);
  const dist = new Map();
  for (const [u, sus] of at) {
    if (N.degree[u] < 3) continue;
    // (a small Dijkstra: within reach, stopping at the route)
    dist.clear(); dist.set(u, 0);
    const queue = new Heap(), best = new Map();
    queue.push(0, [u, null]);
    while (queue.size) {
      const [d, [v, via]] = queue.pop();
      if (d > (dist.get(v) ?? Infinity)) continue;
      if (v !== u && at.has(v)) { if (!best.has(v) || best.get(v).d > d) best.set(v, { d, via }); continue; }
      for (const e of N.adj[v]) {
        if (used.has(N.keyOf(e.sg)) || e.sg.class === 'ferry') continue;
        const nd = d + e.sg.length;
        if (nd > CHECKPOINTS.roadReach || nd >= (dist.get(e.to) ?? Infinity)) continue;
        dist.set(e.to, nd); queue.push(nd, [e.to, via ?? e.sg.name ?? null]);
      }
    }
    for (const [v, { d, via }] of best) for (const su of sus) for (const sv of at.get(v)) {
      const skip = aheadOf(su, sv, L, loop);
      if (skip - d >= CHECKPOINTS.minSaving && skip > 1.5 * d && (!loop || L - skip >= CHECKPOINTS.minSkip)) out.push({ kind: 'road', a: su, b: sv, gap: Math.round(d), saving: Math.round(skip - d), via });
    }
  }
  return bunch(out, L, loop);
}

// the same shortcut, near enough: of those that mostly skip the same stretch, the one that saves most
export function mergeCuts(cuts, L, loop = false) {
  const kept = [];
  for (const c of [...cuts].sort((x, y) => y.saving - x.saving)) {
    const cl = aheadOf(c.a, c.b, L, loop);
    const same = kept.some(k => {
      const kl = aheadOf(k.a, k.b, L, loop), o0 = aheadOf(k.a, c.a, L, loop), lo = Math.max(0, loop && o0 > kl ? o0 - L : o0), hi = Math.min(kl, (loop && o0 > kl ? o0 - L : o0) + cl);
      return hi - lo > 0.5 * Math.min(kl, cl);
    });
    if (!same) kept.push(c);
  }
  return kept.sort((x, y) => x.a - y.a);
}

export function findShortcuts(N, built, { loop = built.loop } = {}) {
  if (!built.line?.length) return [];
  const all = [...crossings(built.line, loop), ...nearItself(built.line, loop), ...(N ? overRoads(N, built, loop) : [])];
  // (a crossing is also near itself: keep it as the crossing)
  return bunch(all.map(c => ({ ...c, saving: c.saving + (c.kind === 'crossing' ? 1e6 : 0) })), built.length, loop).map(c => ({ ...c, saving: c.kind === 'crossing' ? c.saving - 1e6 : c.saving }));
}

export function isCovered(cut, checkpoints, L, loop = false) {
  const skip = aheadOf(cut.a, cut.b, L, loop), m = Math.min(CHECKPOINTS.margin, skip / 4);
  return checkpoints.some(c => c.required !== false && aheadOf(cut.a, c.s, L, loop) > m && aheadOf(cut.a, c.s, L, loop) < skip - m);
}

export function autoCheckpoints(line, { loop = false, startS = 0, finishS = null, spacing = CHECKPOINTS.spacing, shortcuts = [], keep = [], nodes = [] } = {}) {
  const L = line.at(-1)?.s ?? 0, end = loop ? startS + L : (finishS ?? L), wrap = s => loop ? ((s % L) + L) % L : s;
  const out = keep.map(c => ({ ...c }));
  const near = (s, d) => out.some(c => Math.min(Math.abs(c.s - s), loop ? L - Math.abs(c.s - s) : Infinity) < d);
  const junction = s => nodes.some(n => n.degree >= 3 && Math.abs(n.s - s) < 12);
  // (a little way off any junction: a gate across a crossroads is easy to miss)
  const settle = (s, lo, hi) => { for (const o of [0, 20, -20, 40, -40, 60, -60]) { const t = s + o; if (t > lo && t < hi && !junction(wrap(t))) return t; } return s; };
  const span = end - startS, n = spacing > 0 ? Math.max(0, Math.round(span / spacing) - 1) : 0;
  for (let k = 1; k <= n; k++) {
    const s = settle(startS + span * k / (n + 1), startS + 30, end - 30);
    if (!near(wrap(s), spacing / 3)) out.push({ s: wrap(s), required: true, timeExtension: 0, auto: true, reason: 'spacing' });
  }
  for (const cut of shortcuts) {
    if (isCovered(cut, out, L, loop)) continue;
    // (the middle of what it would skip; inside the race, before the finish)
    const skip = aheadOf(cut.a, cut.b, L, loop);
    let s = settle(cut.a + skip / 2, cut.a + CHECKPOINTS.margin, cut.a + skip - CHECKPOINTS.margin);
    if (!loop && (s <= startS || s >= end)) continue;
    out.push({ s: wrap(s), required: true, timeExtension: 0, auto: true, reason: cut.kind === 'road' ? 'shortcut' : cut.kind });
  }
  const order = c => loop ? (((c.s - startS) % L) + L) % L : c.s;
  out.sort((a, b) => order(a) - order(b));
  let k = 0;
  for (const c of out) c.id ??= `cp_${c.auto ? 'a' : 'm'}${k++}_${Math.round(c.s)}`;
  return out;
}

// checkpoints kept by place (lat/lon) through an edit of the route: back onto the new line, or dropped
export function reattach(line, checkpoints, toXZ, reach = 30) {
  const kept = [], lost = [];
  for (const c of checkpoints) {
    if (c.lat == null) { kept.push(c); continue; }
    const [x, z] = toXZ(c.lat, c.lon), p = project(line, x, z);
    if (p && p.dist <= reach) kept.push({ ...c, s: p.s }); else lost.push(c);
  }
  return { kept, lost };
}
