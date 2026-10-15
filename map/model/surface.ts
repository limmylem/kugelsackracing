// Map v4's road surface (the road surface model's mesh, map/model/): every road a ribbon of cross-sections from
// its trim at one end to its trim at the other (or its cap, or a joint's shared cross-section), each junction
// cluster one patch on its plane sharing the ribbons' end vertices exactly — one joined surface, no overlaps, no
// gaps, no steps. In world coordinates; the tiles cut it at their borders (map/bake/tilesV4.ts).
//
// A cross-section has 5 points: the visual edge, the drivable edge (between them the kerb band), the crown, and
// the same the other side (the camber is straight from crown to edge: nothing between needed); heights from the road's profile less its camber, eased onto the junction's
// plane over armEase m before the trim (so the trimmed end lies exactly on the plane, flat across). Each line of
// points along the road is kept from folding on a tight bend: where a line would run backwards, its points meet
// at one (the mesh's triangles there have no area and are dropped). Skirts (drawn, not solid) hang under the edges;
// bridges get deck sides. Markings: centre, lane and edge lines (solid or dashed by class; the region's style),
// zebra crossings and stop lines where OSM maps them, as one cheap vertex-coloured mesh just over the surface.
//
//   const S = buildSurface(G, T, cfg, { style, crossings, stops })
//   S.mesh { positions, colours, indices, surfaces (per triangle), solid (per triangle: 1 collides), level (per
//   triangle: 0 ground, 1 bridge, 2 tunnel), seg (per triangle: segment id or −1 − cluster) }, S.marks, S.edges

import type { MNode, Seg } from './graph.ts';
import type { Cluster } from './topology.ts';
import { at, polygonArea, rowAt } from './geom.ts';
import { armRow, triangulatePatch } from './topology.ts';
import { planeAt, planeGrad } from './heights.ts';

export const SURFACES = ['tarmac', 'concrete', 'cobbles', 'kerb', 'gravel', 'dirt', 'grass', 'sand', 'footpath'];
export const LEVELS = { ground: 0, bridge: 1, tunnel: 2 } as const;
const hex = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const smooth01 = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

export interface Mesh { positions: number[]; colours: number[]; indices: number[]; surfaces: number[]; solid: number[]; level: number[]; seg: number[] }
const newMesh = (): Mesh => ({ positions: [], colours: [], indices: [], surfaces: [], solid: [], level: [], seg: [] });

// the height of a road's surface at s m along it, `off` m to its left (− right): profile less camber, eased onto
// a junction's plane near its trims
export function profileAt(g: Seg, s: number) {
  // (the drawn profile when there is one — its vertical curves, map/model/heights.ts — else straight between points)
  const S: number[] = (g as any).vs ?? g.s, Hh: number[] = (g as any).vh ?? g.h;
  const L = S[S.length - 1], k = Math.max(0, Math.min(S.length - 2, idx(S, s))), t = Math.max(0, Math.min(1, (s - S[k]) / ((S[k + 1] - S[k]) || 1)));
  return s <= 0 ? Hh[0] : s >= L ? Hh[Hh.length - 1] : Hh[k] + (Hh[k + 1] - Hh[k]) * t;
}
// planes: the junctions' planes at the road's two trimmed ends (a: its start), and dA, dB: how far the road's own
// profile misses each at its trim (the profile's points can lie either side of a trim) — the profile is moved by them,
// in a straight line from one trim to the other (one plane only: eased out over armEase), so it meets them exactly
export function surfaceHeight(g: Seg, s: number, off: number, x: number, z: number, H: any, planes: { a: any; b: any; dA?: number; dB?: number; hermite?: number[] }) {
  const L = g.s[g.s.length - 1];
  // (a road between two junctions short enough that their eases meet: its middle a smooth curve from one plane to the
  // other, meeting each's height and slope — no dip or crest where two eases would join)
  let prof = profileAt(g, s);
  if (planes.hermite) {
    const [hA, mA, hB, mB, s0, len] = planes.hermite, u = Math.max(0, Math.min(1, (s - s0) / len)), u2 = u * u, u3 = u2 * u;
    prof = (2 * u3 - 3 * u2 + 1) * hA + (u3 - 2 * u2 + u) * mA * len + (-2 * u3 + 3 * u2) * hB + (u3 - u2) * mB * len;
  }
  const camber = (g.oneway ? H.camberOneWay : H.camber) * Math.abs(off);
  // (eased onto a junction's plane over the last armEase m before each trim — on a road shorter than twice that, half
  // its length from each end: the two eases never overlap, so each trim lies exactly on its own plane)
  const len = L - g.trim1 - g.trim0, E = planes.a && planes.b ? Math.min(H.armEase, len / 2) : Math.min(H.armEase, len);
  // (a road short enough that its two eases meet: the miss made up in a straight line from one trim to the other; a
  // longer one: eased out over each end's ease, its own profile — a bridge's lift, say — untouched in between)
  const u = Math.max(0, Math.min(1, (s - g.trim0) / Math.max(len, 1e-6)));
  const corr = planes.hermite ? 0 : planes.a && planes.b && len < 2 * H.armEase ? (planes.dA ?? 0) * (1 - u) + (planes.dB ?? 0) * u
    : (planes.a ? (planes.dA ?? 0) * smooth01(1 - (s - g.trim0) / Math.max(E, 1e-3)) : 0) + (planes.b ? (planes.dB ?? 0) * smooth01(1 - (L - g.trim1 - s) / Math.max(E, 1e-3)) : 0);
  let h = prof + corr - camber;
  for (const [plane, d] of [[planes.a, s - g.trim0], [planes.b, L - g.trim1 - s]] as [any, number][]) {
    if (!plane) continue;
    const w = smooth01(1 - d / Math.max(E, 1e-3));
    // (at the trim itself: the plane exactly, as the junction's patch has it)
    if (w >= 1) return planeAt({ plane }, x, z);
    if (w > 0) h = h + (planeAt({ plane }, x, z) - h) * w;
  }
  return h;
}
function idx(S: number[], s: number) { let lo = 0, hi = S.length - 1; if (s <= S[0]) return 0; if (s >= S[hi]) return hi - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; } return lo; }

// a road's planes at its two trimmed ends (a: its start) and how far its own profile misses each at its trim (made up
// along the road: surfaceHeight), and where its surface starts and ends (s0, s1: its trims, or past its ends by a cap)
export function planesOf(g: Seg, G: { nodes: MNode[] }, T: { clusters: Cluster[] }, H: any) {
  const planeOf = (k: number) => (G.nodes[k].kind === 'junction' ? (T.clusters[G.nodes[k].cluster] as any)?.plane ?? null : null);
  const L = g.s[g.s.length - 1], s0 = g.trim0 > 0 ? g.trim0 : -Math.max(0, -g.trim0), s1 = g.trim1 > 0 ? L - g.trim1 : L + Math.max(0, -g.trim1);
  const pa = g.trim0 > 0 ? planeOf(g.from) : null, pb = g.trim1 > 0 ? planeOf(g.to) : null;
  const rA = pa ? rowAt(g, s0) : null, rB = pb ? rowAt(g, s1) : null;
  const planes: any = { a: pa, b: pb, dA: rA ? planeAt({ plane: pa }, rA.x, rA.z) - profileAt(g, s0) : 0, dB: rB ? planeAt({ plane: pb }, rB.x, rB.z) - profileAt(g, s1) : 0 };
  // (short, between two planes: the curve's ends — each plane's height at the road's middle and its slope along it)
  if (H.shortRoadCurve && pa && pb && s1 - s0 < 2 * H.armEase && g.structure === 'ground') {
    const slope = (p: any, r: any) => { const [gx, gz] = planeGrad(p, r.x, r.z); return gx * r.nz + gz * (-r.nx); };
    planes.hermite = [planeAt({ plane: pa }, rA!.x, rA!.z), slope(pa, rA), planeAt({ plane: pb }, rB!.x, rB!.z), slope(pb, rB), s0, s1 - s0];
  }
  return { s0, s1, planes };
}

// the drawn road's height down each road's middle (seg.hd: the navigation graph's and the model file's) — eased onto
// the planes, inside a junction its plane — so whatever reads a road's height reads what's drawn; seg.h, the solved
// profile the surface is built from, stays as it is. Every road's, once (map/model/index.ts): the surface itself is
// built a block at a time
export function drawnHeights(G: { nodes: MNode[]; segs: Seg[] }, T: { clusters: Cluster[] }, cfg: any) {
  const H = cfg.heights;
  for (const g of G.segs) {
    if (g.internal) continue;
    const L = g.s[g.s.length - 1], s0 = g.trim0 > 0 ? g.trim0 : 0, s1 = g.trim1 > 0 ? L - g.trim1 : L, pl = planesOf(g, G, T, H).planes;
    (g as any).hd = g.s.map((sv: number, k: number) => (sv < s0 && pl.a ? planeAt({ plane: pl.a }, g.xs[k], g.zs[k]) : sv > s1 && pl.b ? planeAt({ plane: pl.b }, g.xs[k], g.zs[k]) : surfaceHeight(g, sv, 0, g.xs[k], g.zs[k], H, pl)));
  }
}

// only: the roads and junction patches to build (by id) — a block of the region (map/bake/bakeV4.ts); each piece is the
// same whichever others are built with it
export function buildSurface(G: { nodes: MNode[]; segs: Seg[] }, T: { clusters: Cluster[] }, cfg: any, { style = 'AU', crossings = new Map<number, string>(), only = null as null | { segs: Set<number>; clusters: Set<number> } } = {}) {
  const Sf = cfg.surface, H = cfg.heights, C = Sf.colours, mesh = newMesh(), marks = newMesh(), edges: number[] = [];
  // (the classes' numbers: the widths table's order, the same in every block's tiles; anything else after them)
  const classIdx: string[] = Object.keys(cfg.widths.classes).filter(k => !k.startsWith('_'));
  const M = Sf.markingStyles[style] ?? Sf.markingStyles.AU, white = hex(M.lane), centreC = hex(M.centre), edgeC = hex(M.edge);
  const colourOf = (g: Seg) => hex(g.surface === 'concrete' ? C.concrete : g.surface === 'gravel' || g.surface === 'dirt' ? C.gravel : g.surface === 'cobbles' ? C.cobbles : C.asphalt);
  const surfIdx = (g: Seg) => Math.max(0, SURFACES.indexOf(g.surface === 'grass' || g.surface === 'sand' ? 'dirt' : g.surface));
  const cls = (name: string) => { let k = classIdx.indexOf(name); if (k < 0) { k = classIdx.length; classIdx.push(name); } return k; };
  const vtx = (Mh: Mesh, x: number, y: number, z: number, c: number[]) => { Mh.positions.push(x, y, z); Mh.colours.push(c[0], c[1], c[2], 255); return Mh.positions.length / 3 - 1; };
  // (a triangle facing up — or, for upright pieces, as given; one with no area dropped)
  const tri = (Mh: Mesh, a: number, b: number, c: number, surface: number, solid: number, level: number, seg: number, up = true) => {
    const P = Mh.positions, ax = P[a * 3], az = P[a * 3 + 2], ny = (P[b * 3 + 2] - az) * (P[c * 3] - ax) - (P[b * 3] - ax) * (P[c * 3 + 2] - az);
    if (up && Math.abs(ny) < 1e-8) return;
    if (up && ny < 0) Mh.indices.push(a, c, b); else Mh.indices.push(a, b, c);
    Mh.surfaces.push(surface); Mh.solid.push(solid); Mh.level.push(level); Mh.seg.push(seg);
  };
  const planeOf = (k: number) => (G.nodes[k].kind === 'junction' ? (T.clusters[G.nodes[k].cluster] as any)?.plane ?? null : null);
  const kerbC = hex(C.kerb), deckC = hex(C.deck);
  const stats: any = { ribbons: 0, rows: 0, folds: 0, patches: 0, patchTris: 0, markings: 0, tJunctions: 0, patchHoles: 0 };
  // (each piece's outline in plan — a ribbon's two drawn edges, a patch's rings — with its level: what the road covers,
  // for Map v5's cross-section)
  const outlines: { level: number; rings: number[][][] }[] = [];

  // ---------- ribbons ----------
  const segPlanes = new Map<number, any>();
  for (const g of G.segs) {
    if (g.internal || (only && !only.segs.has(g.id))) continue;
    const { s0, s1, planes } = planesOf(g, G, T, H), pa = planes.a, pb = planes.b;
    if (s1 - s0 < 0.05) continue;
    segPlanes.set(g.id, planes);
    // the rows: the trims, every point between, and every 2 m through the ease onto a plane
    const ss = new Set<number>([s0, s1]);
    for (const v of g.s) if (v > s0 + 0.05 && v < s1 - 0.05) ss.add(v);
    // (closer together near the trim, where the ease bends most: the drawn road follows it, no kink at the patch)
    const easeRows = Sf.easeRows as number[];
    if (pa) for (const d of easeRows) if (d < H.armEase && s0 + d < s1 - 0.05) ss.add(s0 + d);
    if (pb) for (const d of easeRows) if (d < H.armEase && s1 - d > s0 + 0.05) ss.add(s1 - d);
    // (and through each vertical curve, wherever the drawn profile's grade changes by more than curveRows between
    // its samples — none along a steady grade — but none within curveRowGap m of a row already there)
    const vs = (g as any).vs as number[] | undefined, vh = (g as any).vh as number[] | undefined;
    if (vs && vh && Sf.curveRows > 0) {
      const have = [...ss];
      for (let i = 1; i + 1 < vs.length; i++) {
        const v = vs[i];
        if (v <= s0 + 0.05 || v >= s1 - 0.05) continue;
        const g1 = (vh[i] - vh[i - 1]) / ((vs[i] - vs[i - 1]) || 1), g2 = (vh[i + 1] - vh[i]) / ((vs[i + 1] - vs[i]) || 1);
        if (Math.abs(g2 - g1) <= Sf.curveRows || have.some(q => Math.abs(q - v) < Sf.curveRowGap)) continue;
        ss.add(v); have.push(v);
      }
    }
    const rows = [...ss].sort((a, b) => a - b).map(s => rowAt(g, s));
    // each line's points, kept from folding (the first and last rows — shared with a patch or a joint — never move)
    const OFF = (r: any) => [r.hwL, r.dL, 0, -r.dR, -r.hwR];
    const lines = Array.from({ length: 5 }, (_, c) => rows.map(r => at(r, OFF(r)[c])));
    for (const line of lines) stats.folds += unfold(line, rows);
    const heights = lines.map((line, c) => line.map((p, q) => surfaceHeight(g, rows[q].s, OFF(rows[q])[c], p[0], p[1], H, planes)));
    outlines.push({ level: LEVELS[g.structure], rings: [[...lines[0].map(p => [p[0], p[1]]), ...lines[4].slice().reverse().map(p => [p[0], p[1]])]] });
    // (the first and last rows on a plane: exactly the plane, as the patch has them)
    const col = colourOf(g), sf = surfIdx(g), lv = LEVELS[g.structure], kerbS = SURFACES.indexOf('kerb');
    const ids = rows.map((_, q) => lines.map((line, c) => vtx(mesh, line[q][0], heights[c][q], line[q][1], c === 0 || c === 4 ? kerbC : col)));
    // (the kerb band's inner edge twice: kerb coloured outside it, the road's colour inside)
    const inner = rows.map((_, q) => [1, 3].map(c => vtx(mesh, lines[c][q][0], heights[c][q], lines[c][q][1], kerbC)));
    for (let q = 0; q + 1 < rows.length; q++) {
      // kerb bands (0–1, 5–6) and the road (1–5)
      tri(mesh, ids[q][0], ids[q + 1][0], inner[q + 1][0], kerbS, 1, lv, g.id); tri(mesh, ids[q][0], inner[q + 1][0], inner[q][0], kerbS, 1, lv, g.id);
      tri(mesh, inner[q][1], inner[q + 1][1], ids[q + 1][4], kerbS, 1, lv, g.id); tri(mesh, inner[q][1], ids[q + 1][4], ids[q][4], kerbS, 1, lv, g.id);
      for (let c = 1; c < 3; c++) { tri(mesh, ids[q][c], ids[q + 1][c], ids[q + 1][c + 1], sf, 1, lv, g.id); tri(mesh, ids[q][c], ids[q + 1][c + 1], ids[q][c + 1], sf, 1, lv, g.id); }
    }
    stats.ribbons++; stats.rows += rows.length;
    // skirts (drawn only) under both edges; a bridge's deck sides instead
    for (const c of [0, 4]) for (let q = 0; q + 1 < rows.length; q++) {
      const a = lines[c][q], b = lines[c][q + 1], ya = heights[c][q], yb = heights[c][q + 1], depth = g.structure === 'bridge' ? 1.1 : Sf.skirtDepth, colr = g.structure === 'bridge' ? deckC : kerbC;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-4) continue;
      const i0 = vtx(mesh, a[0], ya, a[1], colr), i1 = vtx(mesh, b[0], yb, b[1], colr), i2 = vtx(mesh, b[0], yb - depth, b[1], colr), i3 = vtx(mesh, a[0], ya - depth, a[1], colr);
      // (one face: the road's material is drawn from both sides)
      tri(mesh, i0, i1, i2, kerbS, 0, lv, g.id, false); tri(mesh, i0, i2, i3, kerbS, 0, lv, g.id, false);
    }
    // a bridge's underside (drawn only)
    if (g.structure === 'bridge') for (let q = 0; q + 1 < rows.length; q++) {
      const v = [[0, q], [4, q], [4, q + 1], [0, q + 1]].map(([c, r]) => vtx(mesh, lines[c][r][0], heights[c][r] - 1.1, lines[c][r][1], deckC));
      tri(mesh, v[0], v[2], v[1], kerbS, 0, lv, g.id, false); tri(mesh, v[0], v[3], v[2], kerbS, 0, lv, g.id, false);
    }
    // the debug view's edges: [ax, ay, az, bx, by, bz, class, kind]
    const ci = cls(g.link ? 'link' : g.cls), kind = g.structure === 'bridge' ? 3 : g.structure === 'tunnel' ? 4 : 0;
    for (const c of [0, 4]) for (let q = 0; q + 1 < rows.length; q++) edges.push(lines[c][q][0], heights[c][q], lines[c][q][1], lines[c][q + 1][0], heights[c][q + 1], lines[c][q + 1][1], ci, kind);
    for (const q of [0, rows.length - 1]) if ((q === 0 && pa) || (q > 0 && pb)) edges.push(lines[0][q][0], heights[0][q], lines[0][q][1], lines[4][q][0], heights[4][q], lines[4][q][1], ci, 2);
    // markings
    stats.markings += markRibbon(g, rows, lines, heights, { s0, s1, pa, pb, planes });
  }

  // ---------- junction patches ----------
  for (const c of T.clusters) {
    const plane = (c as any).plane;
    if (!plane || (only && !only.clusters.has(c.id))) continue;
    // (its colour: its main road's)
    const main = c.arms.slice().sort((p, q) => q.seg.rank - p.seg.rank)[0]?.seg, col = main ? colourOf(main) : hex(C.asphalt), sf = main ? surfIdx(main) : 0;
    const lv = c.arms.every(A => A.seg.structure === 'bridge') ? 1 : c.arms.every(A => A.seg.structure === 'tunnel') ? 2 : 0;
    const tris = triangulatePatch(c.rings), key = new Map<string, number>();
    for (const poly of c.rings) outlines.push({ level: lv, rings: poly });
    const v = (p: number[]) => { const k = `${p[0]},${p[1]}`; let i = key.get(k); if (i === undefined) { i = vtx(mesh, p[0], planeAt(c, p[0], p[1]), p[1], col); key.set(k, i); } return i; };
    for (const t of tris) tri(mesh, v(t[0]), v(t[1]), v(t[2]), sf, 1, lv, -1 - c.id);
    // (its triangles cover its outline: else a hole in the road — counted, with where)
    const want = c.rings.reduce((a, poly) => a + Math.abs(polygonArea(poly[0])) - poly.slice(1).reduce((h, r) => h + Math.abs(polygonArea(r)), 0), 0), got = tris.reduce((a, t) => a + Math.abs(polygonArea(t)), 0);
    if (Math.abs(got - want) > Math.max(0.1, want * 0.005)) { stats.patchHoles++; stats.patchHoleAt ??= []; if (stats.patchHoleAt.length < 20) stats.patchHoleAt.push({ at: c.centre.map((v: number) => +v.toFixed(1)), missing: +(want - got).toFixed(2) }); }
    stats.patches++; stats.patchTris += tris.length;
    // its outline (the debug view; and skirts under it, drawn only)
    for (const poly of c.rings) for (const r of poly) for (let q = 0; q < r.length; q++) {
      const a = r[q], b = r[(q + 1) % r.length], ya = planeAt(c, a[0], a[1]), yb = planeAt(c, b[0], b[1]);
      edges.push(a[0], ya, a[1], b[0], yb, b[1], 0, 1);
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-4) continue;
      const i0 = vtx(mesh, a[0], ya, a[1], kerbC), i1 = vtx(mesh, b[0], yb, b[1], kerbC), i2 = vtx(mesh, b[0], yb - Sf.skirtDepth, b[1], kerbC), i3 = vtx(mesh, a[0], ya - Sf.skirtDepth, a[1], kerbC);
      tri(mesh, i0, i1, i2, 3, 0, lv, -1 - c.id, false); tri(mesh, i0, i2, i3, 3, 0, lv, -1 - c.id, false);
    }
    // stop lines where OSM maps a stop or give way on an arm (just short of the patch, across the arm's lanes in)
    for (const A of c.arms) {
      const g = A.seg, nodeId = G.nodes[A.node].id, kind = crossings.get(nodeId);
      if (kind !== 'stop' && kind !== 'give_way') continue;
      const sp = A.trim + 0.6, s = A.atStart ? sp : g.s[g.s.length - 1] - sp, r = rowAt(g, s);
      // (the lanes coming in: the right of the arm looking out — the left looking in — on a two-way road; all of a one-way)
      const lo = g.oneway ? -r.dR : (A.atStart ? 0 : -r.dR), hi = g.oneway ? r.dL : (A.atStart ? r.dL : 0);
      quad(g, r, r, lo, hi, s, s, Sf.stopLineWidth, white, segPlanes.get(g.id) ?? { a: planeOf(g.from), b: planeOf(g.to) }, true);
    }
  }

  // ---------- markings ----------
  function quad(g: Seg, ra: any, rb: any, oa: number, ob: number, sa: number, sb: number, w: number, colour: number[], planes: any, across = false) {
    // along: from (sa, offset oa) to (sb, oa), w wide; across: at row ra, from offset oa to ob, w deep along the road
    const P = (r: any, o: number, along: number) => { const p = at(r, o), dx = r.nz, dz = -r.nx; return [p[0] + dx * along, p[1] + dz * along]; };
    const pts = across ? [P(ra, oa, -w / 2), P(ra, ob, -w / 2), P(ra, ob, w / 2), P(ra, oa, w / 2)] : [P(ra, oa - w / 2, 0), P(rb, oa - w / 2, 0), P(rb, oa + w / 2, 0), P(ra, oa + w / 2, 0)];
    const offs = across ? [oa, ob, ob, oa] : [oa, oa, oa, oa], sss = across ? [sa, sa, sa, sa] : [sa, sb, sb, sa];
    const ids = pts.map((p, q) => vtx(marks, p[0], surfaceHeight(g, sss[q], offs[q], p[0], p[1], H, planes) + Sf.markingLift, p[1], colour));
    tri(marks, ids[0], ids[1], ids[2], 0, 0, 0, g.id); tri(marks, ids[0], ids[2], ids[3], 0, 0, 0, g.id);
    void ob;
  }
  function markRibbon(g: Seg, rows: any[], _lines: number[][][], _h: number[][], { s0, s1, pa, pb, planes }: any) {
    if (g.cls === 'service' || g.cls === 'track' || g.surface === 'gravel' || g.surface === 'dirt') return 0;
    const W = cfg.widths, lw = (W.classes[g.link ? 'link' : g.cls]?.lane ?? W.laneWidth) * W.multiplier, lanes = Math.max(1, g.lanes);
    // (marked lanes: from the centre (two-way) or across the carriageway (one-way), within the drivable width)
    const lines: { off: number; dashed: boolean; colour: number[] }[] = [], half = (lanes * lw) / 2;
    if (!g.oneway) {
      if (lanes >= 2) lines.push({ off: 0, dashed: g.rank < M.centreDashedBelowRank, colour: centreC });
      for (let l = 1; l < lanes / 2; l++) lines.push({ off: l * lw, dashed: true, colour: white }, { off: -l * lw, dashed: true, colour: white });
    } else for (let l = 1; l < lanes; l++) lines.push({ off: -half + l * lw, dashed: true, colour: white });
    if (g.rank >= 5 && !g.link) lines.push({ off: half, dashed: false, colour: edgeC }, { off: -half, dashed: false, colour: edgeC });
    if (!lines.length) return 0;
    const period = Sf.dash + Sf.gap, a0 = s0 + (pa ? 1 : 0.2), a1 = s1 - (pb ? 1 : 0.2);
    let n = 0;
    for (const ln of lines) {
      for (let q = 0; q + 1 < rows.length; q++) {
        const sa = Math.max(a0, rows[q].s), sb = Math.min(a1, rows[q + 1].s);
        if (sb <= sa + 0.05) continue;
        const parts: [number, number][] = [];
        if (!ln.dashed) parts.push([sa, sb]);
        else for (let p = Math.floor(sa / period) * period; p < sb; p += period) { const x = Math.max(sa, p), y = Math.min(sb, p + Sf.dash); if (y > x + 0.1) parts.push([x, y]); }
        for (const [x, y] of parts) {
          const ra = rowAt(g, x), rb = rowAt(g, y);
          // (never past the drivable edge: a narrowed side keeps its lines inside)
          const lim = (r: any) => (ln.off >= 0 ? r.dL : r.dR) - 0.3;
          if (Math.abs(ln.off) > Math.min(lim(ra), lim(rb))) continue;
          quad(g, ra, rb, ln.off, ln.off, x, y, Sf.markingWidth, ln.colour, planes); n++;
        }
      }
    }
    // zebra crossings where OSM maps a crossing on the road (a node of it), across the whole drivable width
    for (let k = 0; k < g.xs.length; k++) {
      const id = g.osmNodes[k], kind = id != null ? crossings.get(id) : null;
      if (kind !== 'crossing' || g.s[k] < a0 + 2 || g.s[k] > a1 - 2) continue;
      const r = rowAt(g, g.s[k]);
      for (let o = -r.dR + 0.3; o < r.dL - 0.5; o += Sf.crossingStripe * 2) quad(g, r, r, o, o + Sf.crossingStripe, g.s[k], g.s[k], 3, white, planes, true);
    }
    return n;
  }
  // (on the tiles' grid first — map/format's 1 cm quantum — so the vertices the repair shares stay shared in the tiles;
  // then the repair, until no side is left to split)
  const q = cfg.surface.quantum ?? 0.01;
  for (const m of [mesh, marks]) for (let i = 0; i < m.positions.length; i++) m.positions[i] = Math.round(m.positions[i] / q) * q;
  // (the tessellator's own stitches — solid triangles of no area along a T-junction — are kept: the tiles keep them too)
  stats.tJunctions = 0;
  for (let pass = 0; pass < 4; pass++) { const n = repairTJunctions(mesh, cfg.junctions.tJunction ?? q * 1.2); stats.tJunctions += n; if (!n) break; }
  return { mesh, marks, edges, outlines, classes: classIdx, stats };
}

// T-junctions closed: a vertex of the surface's outline lying on another piece's outline edge (within tol m, a
// patch's corner on a road's side, say) — that edge's triangle split there, so the two pieces share the vertex and
// no crack is left between them. Solid triangles only. Returns how many were split.
export function repairTJunctions(mesh: Mesh, tol: number) {
  const P = mesh.positions, I = mesh.indices, nV = P.length / 3;
  // (vertices welded by position, 1 mm; edges by their welded ends, as numbers)
  const wid = new Int32Array(nV), weld = welder(nV);
  for (let v = 0; v < nV; v++) wid[v] = weld(Math.round(P[v * 3] * 1000), Math.round(P[v * 3 + 1] * 1000), Math.round(P[v * 3 + 2] * 1000));
  const W = weld.count();
  // (each edge kept with its lower welded end: the edges only one solid triangle has — the outline — by that triangle's
  // slot + side, in the order they come)
  const deg = new Int32Array(W + 1);
  for (let t = 0; t < I.length; t += 3) { if (!mesh.solid[t / 3]) continue; for (let e = 0; e < 3; e++) deg[Math.min(wid[I[t + e]], wid[I[t + (e + 1) % 3]]) + 1]++; }
  for (let p = 0; p < W; p++) deg[p + 1] += deg[p];
  const fill = deg.slice(0, W), other = new Int32Array(deg[W]), slotOf = new Int32Array(deg[W]);
  for (let t = 0; t < I.length; t += 3) { if (!mesh.solid[t / 3]) continue; for (let e = 0; e < 3; e++) { const p = wid[I[t + e]], q = wid[I[t + (e + 1) % 3]], lo = Math.min(p, q), at = fill[lo]++; other[at] = Math.max(p, q); slotOf[at] = t + e; } }
  const outline: number[] = [];
  for (let p = 0; p < W; p++) for (let i = deg[p]; i < deg[p + 1]; i++) { let c = 0; for (let j = deg[p]; j < deg[p + 1]; j++) if (other[j] === other[i]) c++; if (c === 1) outline.push(slotOf[i]); }
  outline.sort((a, b) => a - b);
  // the outline's edges, by triangle and side, and its vertices
  const C = 2, cell = (x: number, z: number) => (Math.floor(x / C) + 1e5) * 2e5 + Math.floor(z / C) + 1e5;
  // (an outline edge as one number: its triangle's first slot + its side)
  const grid = new Map<number, number[]>(), verts = new Map<number, number>();
  for (const te of outline) {
    const e = te % 3, t = te - e, a = I[t + e], b = I[t + (e + 1) % 3];
    verts.set(wid[a], a); verts.set(wid[b], b);
    for (let x = Math.floor(Math.min(P[a * 3], P[b * 3]) / C); x <= Math.floor(Math.max(P[a * 3], P[b * 3]) / C); x++) for (let z = Math.floor(Math.min(P[a * 3 + 2], P[b * 3 + 2]) / C); z <= Math.floor(Math.max(P[a * 3 + 2], P[b * 3 + 2]) / C); z++) { const g = cell(x * C, z * C); (grid.get(g) ?? grid.set(g, []).get(g)!).push(te); }
  }
  // each outline vertex against the outline edges near it: [triangle, side] → the vertices to put into that side
  const splits = new Map<number, { t: number; e: number; vs: { v: number; u: number }[] }>();
  for (const v of verts.values()) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    for (const te of grid.get(cell(x, z)) ?? []) {
      const e = te % 3, t = te - e;
      const a = I[t + e], b = I[t + (e + 1) % 3], dx = P[b * 3] - P[a * 3], dz = P[b * 3 + 2] - P[a * 3 + 2], L2 = dx * dx + dz * dz;
      if (L2 < 1e-10 || a === v || b === v) continue;
      const u = ((x - P[a * 3]) * dx + (z - P[a * 3 + 2]) * dz) / L2;
      if (u <= 1e-6 || u >= 1 - 1e-6) continue;
      const d = Math.abs((x - P[a * 3]) * dz - (z - P[a * 3 + 2]) * dx) / Math.sqrt(L2), dy = Math.abs(P[a * 3 + 1] + (P[b * 3 + 1] - P[a * 3 + 1]) * u - y);
      if (d > tol || dy > 0.05) continue;
      const entry = splits.get(te) ?? splits.set(te, { t, e, vs: [] }).get(te)!;
      if (!entry.vs.some(q => q.v === v)) entry.vs.push({ v, u });
    }
  }
  // (each triangle split along its side at those vertices — a fan from its opposite corner; a triangle with more than
  // one side to split: the first, the others next time round — rare)
  const done = new Set<number>();
  let n = 0;
  for (const { t, e, vs } of splits.values()) {
    if (done.has(t)) continue;
    done.add(t);
    const a = I[t + e], b = I[t + (e + 1) % 3], c = I[t + (e + 2) % 3], chain = [a, ...vs.sort((p, q) => p.u - q.u).map(q => q.v), b];
    const surf = mesh.surfaces[t / 3], solid = mesh.solid[t / 3], level = mesh.level[t / 3], seg = mesh.seg[t / 3];
    // (the first piece reuses the triangle's slot, the rest are added)
    I[t] = chain[0]; I[t + 1] = chain[1]; I[t + 2] = c;
    const part = (mesh as any).part?.[t / 3];
    for (let q = 1; q + 1 < chain.length; q++) { I.push(chain[q], chain[q + 1], c); mesh.surfaces.push(surf); mesh.solid.push(solid); mesh.level.push(level); mesh.seg.push(seg); if (part !== undefined) (mesh as any).part.push(part); }
    n += vs.length;
  }
  return n;
}

// a line of points along a road kept from running backwards: where one goes back past the one before (along the
// row's direction), the run is gathered into one point (their middle; the first or last row's own point if the
// run includes it — those are shared). Returns how many points moved.
function unfold(line: number[][], rows: any[]) {
  const n = line.length;
  let moved = 0;
  for (let pass = 0; pass < 50; pass++) {
    let changed = false;
    for (let q = 0; q + 1 < n; q++) {
      const r = rows[q], r2 = rows[q + 1], tx = r.nz + r2.nz, tz = -(r.nx + r2.nx);
      const dx = line[q + 1][0] - line[q][0], dz = line[q + 1][1] - line[q][1];
      if (dx * tx + dz * tz >= -1e-9) continue;
      // (a run backwards: gather q and q+1, then grow while the next one still runs back)
      let a = q, b = q + 1;
      const back = (i: number, j: number) => { const rr = rows[i], r3 = rows[j], ux = rr.nz + r3.nz, uz = -(rr.nx + r3.nx); return (line[j][0] - line[i][0]) * ux + (line[j][1] - line[i][1]) * uz < -1e-9; };
      while (a > 0 && back(a - 1, b)) a--;
      while (b + 1 < n && back(a, b + 1)) b++;
      const fixed = a === 0 ? line[0] : b === n - 1 ? line[n - 1] : null;
      let mx = 0, mz = 0; for (let i = a; i <= b; i++) { mx += line[i][0]; mz += line[i][1]; }
      const p = fixed ? [fixed[0], fixed[1]] : [mx / (b - a + 1), mz / (b - a + 1)];
      for (let i = a; i <= b; i++) if (line[i][0] !== p[0] || line[i][1] !== p[1]) { line[i] = [p[0], p[1]]; moved++; changed = true; }
      q = b;
    }
    if (!changed) break;
  }
  return moved;
}

// vertices welded by position (whole numbers — mm, cm: the caller's — and anything else that must match, a colour),
// each new one numbered from 0: weld(x, y, z, c?) → its number; weld.count() → how many. An open-addressed table of
// typed arrays (a Map of large numbers, or of strings, spends most of its time making them)
export function welder(capacity = 1 << 16) {
  let cap = 1 << Math.ceil(Math.log2(Math.max(16, capacity * 2))), slots = new Int32Array(cap).fill(-1), n = 0;
  let X = new Int32Array(cap >> 1), Y = new Int32Array(cap >> 1), Z = new Int32Array(cap >> 1), Cc = new Int32Array(cap >> 1);
  const hash = (x: number, y: number, z: number, c: number) => { let h = Math.imul(x, 0x9e3779b1) ^ Math.imul(z, 0x85ebca77) ^ Math.imul(y, 0xc2b2ae3d) ^ Math.imul(c, 0x27d4eb2f); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; return h >>> 0; };
  const grow = () => {
    cap *= 2; slots = new Int32Array(cap).fill(-1);
    const nx = new Int32Array(cap >> 1), ny = new Int32Array(cap >> 1), nz = new Int32Array(cap >> 1), nc = new Int32Array(cap >> 1);
    nx.set(X); ny.set(Y); nz.set(Z); nc.set(Cc); X = nx; Y = ny; Z = nz; Cc = nc;
    for (let id = 0; id < n; id++) { let h = hash(X[id], Y[id], Z[id], Cc[id]) & (cap - 1); while (slots[h] >= 0) h = (h + 1) & (cap - 1); slots[h] = id; }
  };
  const weld = (xi: number, yi: number, zi: number, ci = 0) => {
    if (xi > 2147483647 || xi < -2147483648 || zi > 2147483647 || zi < -2147483648 || yi > 2147483647 || yi < -2147483648) throw new Error(`welder: ${xi}, ${yi}, ${zi} out of range`);
    let h = hash(xi, yi, zi, ci) & (cap - 1);
    for (;;) {
      const id = slots[h];
      if (id < 0) break;
      if (X[id] === xi && Z[id] === zi && Y[id] === yi && Cc[id] === ci) return id;
      h = (h + 1) & (cap - 1);
    }
    if (n >= cap >> 1) { grow(); return weld(xi, yi, zi, ci); }
    X[n] = xi; Y[n] = yi; Z[n] = zi; Cc[n] = ci; slots[h] = n;
    return n++;
  };
  weld.count = () => n;
  return weld;
}
