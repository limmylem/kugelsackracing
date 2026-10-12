// Car bodies built in code (2026-10-12; docs/MODELLING_GUIDE.md "Cars made in code"): a car in its proportions (its
// design: data/cars/<id>/design.json — the same numbers the placeholder cars were made from, and the same socket
// places: carSockets) as a racing game's car looks — a smooth body lofted along its length (its plan rounded at the
// nose and tail, its sides bulging and leaning in, a crowned bonnet and deck), wheel arches with the wells behind
// them, a glasshouse on top with its windscreen, side and rear windows, and the details projected onto it (lights,
// grilles, intakes, number plates, the badge, door handles). Split like a modelled car's source: the body shell and
// the glass and lights are the body; each panel (bonnet, doors, wings, bumpers, sills, boot or engine cover) is cut
// from the same surface, so they meet without a seam, and hangs under its socket; the stock parts (wheels with
// their rims, seats, the steering wheel, mirrors, the engine, the exhaust tip) are made here too. npm run import splits
// it like any car. Every design is fictional: no real car's shape, lights or badge.
//
//   const doc = await carBodyModel(design)        (tools/placeholder-car.mjs writes incoming/car_<id>.glb)
//
// design: as tools/content/placeholderCar.mjs's (socketsAt: sockets kept exactly where they are, { name: { position,
// rotation? } } — tools/placeholder-car.mjs gives car.json's for a design with keepSockets), and look (all optional — the
// style's own otherwise; STYLES):
//   { bulge, tumble, crown, shoulder, sill, nose, tail, plan, cabin: { tumble, rear }, lights: { head, tail },
//     grille, rim: { spokes, kind }, plates, vents, spoiler }

import { Document } from '@gltf-transform/core';
import { weldPrimitive } from '@gltf-transform/functions';
import sharp from 'sharp';
import { carSockets } from './placeholderCar.mjs';
import { PALETTE } from './shapes.mjs';

// ---------- small sums ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]), norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x)), lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const round = v => +v.toFixed(4);

// A smooth curve through knots [[x, y], …] (monotone cubic: no overshoot between knots), flat beyond the ends
export function curve(knots) {
  const k = knots.slice().sort((a, b) => a[0] - b[0]), n = k.length;
  const d = [], m = [];
  for (let i = 0; i < n - 1; i++) d.push((k[i + 1][1] - k[i][1]) / Math.max(1e-9, k[i + 1][0] - k[i][0]));
  for (let i = 0; i < n; i++) m.push(i === 0 ? d[0] ?? 0 : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(d[i]) < 1e-12) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return x => {
    if (x <= k[0][0]) return k[0][1];
    if (x >= k[n - 1][0]) return k[n - 1][1];
    let i = 0;
    while (x > k[i + 1][0]) i++;
    const h = k[i + 1][0] - k[i][0], t = (x - k[i][0]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * k[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * k[i + 1][1] + (t3 - t2) * h * m[i + 1];
  };
}

// ---------- the styles: how each kind of car is shaped and detailed (a design's look overrides any of it) ----------
// bulge: the sides' outward curve (m); tumble: how far the sides lean in from the sill to the shoulder (m); crown: the
// bonnet's and deck's rise to the middle (m); shoulder / sill: the radii of the top and bottom edges of the sides (m);
// nose / tail: how long the plan's rounding is at each end (m) and plan: its squareness (2 round … 6 square);
// cabin.tumble: how much narrower the roof is than the glasshouse's foot (m); lights, grille, rim: the details
export const STYLES = {
  coupe: { bulge: 0.025, tumble: 0.04, crown: 0.03, shoulder: 0.07, sill: 0.06, nose: 0.42, tail: 0.32, plan: 3.2, cabin: { tumble: 0.2 }, lights: { head: 'swept', tail: 'slim' }, grille: 'wide', rim: { spokes: 5, kind: 'split' }, fenderPeak: 0.015 },
  roadster: { bulge: 0.03, tumble: 0.035, crown: 0.025, shoulder: 0.08, sill: 0.07, nose: 0.5, tail: 0.38, plan: 2.6, cabin: { tumble: 0.18 }, lights: { head: 'oval', tail: 'round' }, grille: 'mouth', rim: { spokes: 6, kind: 'classic' }, fenderPeak: 0.03 },
  suv: { bulge: 0.02, tumble: 0.03, crown: 0.02, shoulder: 0.06, sill: 0.05, nose: 0.28, tail: 0.2, plan: 4.5, cabin: { tumble: 0.12 }, lights: { head: 'block', tail: 'tall' }, grille: 'bars', rim: { spokes: 6, kind: 'flat' }, cladding: true, fenderPeak: 0 },
  hatch: { bulge: 0.025, tumble: 0.04, crown: 0.025, shoulder: 0.06, sill: 0.06, nose: 0.36, tail: 0.18, plan: 3.6, cabin: { tumble: 0.17 }, lights: { head: 'sharp', tail: 'wrap' }, grille: 'mesh', rim: { spokes: 10, kind: 'thin' }, roofSpoiler: true, fenderPeak: 0.01 },
  muscle: { bulge: 0.02, tumble: 0.03, crown: 0.035, shoulder: 0.05, sill: 0.05, nose: 0.25, tail: 0.22, plan: 5, cabin: { tumble: 0.16 }, lights: { head: 'twin', tail: 'bar' }, grille: 'full', rim: { spokes: 5, kind: 'star' }, ducktail: true, fenderPeak: 0.02 },
  sedan: { bulge: 0.025, tumble: 0.035, crown: 0.025, shoulder: 0.06, sill: 0.06, nose: 0.36, tail: 0.3, plan: 3.4, cabin: { tumble: 0.17 }, lights: { head: 'block', tail: 'block' }, grille: 'rally', rim: { spokes: 6, kind: 'flat' }, bonnetVent: true, fenderPeak: 0.01 },
  mid: { bulge: 0.035, tumble: 0.05, crown: 0.02, shoulder: 0.09, sill: 0.07, nose: 0.42, tail: 0.3, plan: 3.1, cabin: { tumble: 0.22 }, lights: { head: 'slit', tail: 'bar' }, grille: 'splitter', rim: { spokes: 10, kind: 'thin' }, sideIntake: true, louvres: true, fenderPeak: 0.04, tailDrop: 0.07 },
};

// ---------- the shape: the lines it's lofted along ----------
export function bodyShape(D) {
  const S = { ...STYLES[D.style] ?? STYLES.coupe, ...(D.look ?? {}) }, cabinLook = { ...(STYLES[D.style] ?? STYLES.coupe).cabin, ...(D.look?.cabin ?? {}) };
  const L = D.length, front = L / 2, rear = -L / 2, W = D.width, c = D.clearance, belt = D.beltline, r = D.wheel.radius;
  const B = D.bonnet, R = D.roof, K = D.deck, mid = D.engine.at[2] < 0;
  const gap = 0.045 + r * 0.06, Ra = r + gap;                    // (the arch: round the tyre with room to move)
  const arches = [{ z: D.frontAxle, Ra, cy: r }, { z: D.rearAxle, Ra, cy: r }];
  // the glasshouse: from the windscreen's foot to the rear window's (a mid engine's: its engine cover's front)
  const cabinRear = cabinLook.rear ?? (mid ? lerp(R.rear, K.front, 0.62) : D.convertible ? R.front - 0.06 : Math.min(K.front, R.rear - 0.3 - (D.fastback ?? 0)));
  // the top line along the middle: the tail, the deck, the glasshouse's foot (the belt), the bonnet, the nose
  const deckH = K.height, noseTop = B.front;
  const top = curve([
    [rear, deckH - 0.12 - (S.tailDrop ?? 0.02)], [rear + 0.05, deckH - 0.035 - (S.tailDrop ?? 0.02)], [rear + 0.16, deckH - (S.tailDrop ?? 0.02)], [cabinRear - 0.02, Math.max(deckH, belt)],
    [cabinRear + 0.12, belt + 0.01], [B.rear - 0.05, belt + 0.005], [B.rear + 0.02, B.back],
    [lerp(B.rear, front - 0.25, 0.55), lerp(B.back, noseTop, 0.62)], [front - 0.22, noseTop + 0.01], [front - 0.07, noseTop - 0.03], [front, noseTop - 0.13],
  ]);
  // the underside: up at each end (the bumpers' lower edges, the diffuser)
  const bottom = curve([[rear, c + 0.12], [rear + 0.1, c + 0.07], [rear + 0.38, c + 0.02], [front - 0.42, c + 0.015], [front - 0.12, c + 0.06], [front, c + 0.14]]);
  // half the width, the plan rounded at the nose and tail (a superellipse), the hips a little wider over the wheels
  const halfW = W / 2 - 0.005, nose = S.nose, tail = S.tail, p = S.plan, pt = S.planTail ?? S.plan + 1.2;
  const hips = z => 0.012 * Math.exp(-(((z - D.rearAxle) / 0.55) ** 2)) + 0.006 * Math.exp(-(((z - D.frontAxle) / 0.5) ** 2)) - 0.008 * Math.exp(-(((z - (D.frontAxle + D.rearAxle) / 2) / 0.6) ** 2));
  const plan = z => {
    let k = 1;
    if (z > front - nose) k = Math.pow(Math.max(0, 1 - Math.pow((z - (front - nose)) / nose, p)), 1 / p);
    if (z < rear + tail) k = Math.pow(Math.max(0, 1 - Math.pow(((rear + tail) - z) / tail, pt)), 1 / pt);
    return (halfW + hips(z) - S.bulge * 0.5) * k;
  };
  // the shoulder (the sides' top edge): the belt down the middle; at the front the wings' line, a little above the bonnet
  // (fenderPeak); at the back the deck's
  const shoulder = z => {
    const t = top(z);
    if (z > B.rear) return Math.min(belt, t + (S.fenderPeak ?? 0.01) - S.crown);
    if (z < cabinRear) return Math.min(Math.max(deckH, belt), t) - S.crown;
    return belt - 0.005;
  };
  // the cabin's top line: the windscreen up from its foot, the roof (a little higher in its middle), the rear window down
  const roofMid = (R.front + R.rear) / 2;
  const cabinTop = D.convertible
    ? curve([[B.rear, belt], [R.front, R.height], [R.front - 0.06, R.height - 0.005]])
    : curve([[B.rear, belt - 0.005], [lerp(B.rear, R.front, 0.5), lerp(belt, R.height, 0.56)], [R.front, R.height - 0.012], [roofMid, R.height], [R.rear, R.height - 0.015], [lerp(R.rear, cabinRear, 0.55), lerp(R.height, Math.max(deckH, belt), 0.42)], [cabinRear, Math.max(deckH, belt) - 0.005]]);
  // the bonnet raised over a tall engine (a power bulge, at most 5 cm: the engine itself is made to fit under it), across
  // the engine's width and a little either side, faded out along the car past its ends
  const E = D.engine, eTop = E.at[1] + E.size[1] / 2 + 0.06 + 0.04, eHalf = E.size[0] / 2, eZ = E.at[2], eL = E.size[2] / 2 + 0.06;
  const need = mid ? 0 : Math.min(0.05, Math.max(0, ...[-1, -0.5, 0, 0.5, 1].map(t => eTop - top(eZ + t * eL))));
  const bulge = (x, z) => need && Math.abs(z - eZ) < eL + 0.25 && z > B.rear ? need * smooth(1 - (Math.abs(z - eZ) - eL) / 0.25) * smooth((eHalf + 0.13 - Math.abs(x)) / 0.13) : 0;
  return { S, cabinLook, L, front, rear, W, c, belt, r, B, R, K, mid, arches, cabinRear, top, bottom, plan, shoulder, cabinTop, deckH, bulge };
}

// the arch's height of the side's lower edge at z (null: not over a wheel)
function archAt(P, z) {
  for (const a of P.arches) if (Math.abs(z - a.z) < a.Ra - 1e-6) return a.cy + Math.sqrt(a.Ra * a.Ra - (z - a.z) ** 2);
  return null;
}

// ---------- the lower body's cross-section (half of it, x ≥ 0), from the middle underneath round to the middle on top ----------
// Every station has the same points (so stations loft into a grid): under 0–1, the well's inner wall 1–2 and roof 2–3
// (both nothing where there's no arch), the sill's roll 3–6, the side 6–12, the shoulder 12–15, the top 15–21.
const KIND = [];
const RING = (() => {
  const k = [['under', 1], ['wellWall', 1], ['wellRoof', 1], ['sill', 3], ['side', 6], ['shoulder', 3], ['top', 6]];
  for (const [kind, n] of k) for (let i = 0; i < n; i++) KIND.push(kind);
  return KIND.length + 1;          // 22 points
})();
function lowerSection(P, D, z) {
  const S = P.S, w = Math.max(0.0005, P.plan(z)), yb = P.bottom(z), arch = archAt(P, z);
  const yw = arch ?? yb, ysh = Math.max(P.shoulder(z), yw + 0.04), yt = Math.max(P.top(z), ysh - 0.02);
  const xi = Math.min(D.track / 2 - D.wheel.width / 2 - 0.02, w * 0.75);
  const span = ysh - yw, rb = Math.min(S.sill, span * 0.3), rs = Math.min(S.shoulder, span * 0.35, w * 0.4);
  const k = w / (P.W / 2);                                       // (shrinking toward the nose and tail: the details too)
  const tumble = S.tumble * k, bulge = S.bulge * k;
  const pts = [[0, yb], [xi * k, yb], [xi * k, yw]];
  // the sill's roll: from under the side round to its foot
  const wSill = w + bulge * 0.4;
  for (let i = 0; i <= 3; i++) { const a = -Math.PI / 2 + (i / 3) * Math.PI / 2; pts.push([wSill - rb + rb * Math.cos(a), yw + rb + rb * Math.sin(a)]); }
  // the side: out to the bulge, in to the shoulder (a quadratic curve)
  const s0 = pts[pts.length - 1], s2 = [w - tumble, ysh - rs], s1 = [w + bulge * 1.6, lerp(s0[1], s2[1], 0.45)];
  for (let i = 1; i <= 6; i++) { const t = i / 6, u = 1 - t; pts.push([u * u * s0[0] + 2 * u * t * s1[0] + t * t * s2[0], u * u * s0[1] + 2 * u * t * s1[1] + t * t * s2[1]]); }
  // the shoulder: round over onto the top
  const cx = s2[0] - rs;
  for (let i = 1; i <= 3; i++) { const a = (i / 3) * Math.PI / 2; pts.push([cx + rs * Math.cos(a), ysh - rs + rs * Math.sin(a)]); }
  // the top: from the shoulder in to the middle, crowned (flat across the middle)
  const x0 = cx;
  for (let i = 1; i <= 6; i++) { const t = i / 6, x = x0 * (1 - t); pts.push([x, yt - (yt - ysh) * (x / Math.max(1e-6, x0)) ** 2 + (P.bulge?.(x, z) ?? 0)]); }
  pts[3] = [Math.max(pts[2][0], pts[3][0]), pts[3][1]];          // (the sill's start: not inside the well)
  // (never past the middle; at the very nose and tail, on it: the two halves meet with no gap)
  for (const q of pts) q[0] = w <= 0.001 ? 0 : Math.max(0, q[0]);
  return pts;
}

// ---------- the cabin's cross-section (half): from its foot inside the body's shoulder, up the side, over the roof ----------
// foot 0, the side 0–5 (5 bands: the belt's trim, three of window, the frame's), the roof's edge 5–8, the roof 8–12
const CABIN_KIND = ['belt', 'window', 'window', 'window', 'frame', 'edge', 'edge', 'edge', 'roof', 'roof', 'roof', 'roof'];
function cabinSection(P, D, z) {
  const S = P.S, yb = P.belt - 0.035, yr = Math.max(yb + 0.002, P.cabinTop(z));
  const wb = Math.max(0.05, Math.min(P.plan(z) - S.tumble - S.shoulder * 0.55, P.W / 2 - 0.1));
  const h = yr - yb, wr = Math.max(0.05, wb - P.cabinLook.tumble * clamp(h / 0.35, 0, 1));
  const re = Math.min(0.07, h * 0.3, wr * 0.3);
  const pts = [[wb, yb]];
  const fr = [0.06, 0.32, 0.6, 0.86, 1];                         // (the side's bands: up to the roof's edge)
  for (const f of fr) { const y = lerp(yb, yr - re, f); pts.push([lerp(wb, wr, f) + 0.012 * Math.sin(f * Math.PI), y]); }
  const e = pts[pts.length - 1];
  for (let i = 1; i <= 3; i++) { const a = (i / 3) * Math.PI / 2; pts.push([e[0] - re + re * Math.cos(a), e[1] + re * Math.sin(a)]); }
  const x0 = pts[pts.length - 1][0], y0 = pts[pts.length - 1][1];
  for (let i = 1; i <= 4; i++) { const t = i / 4, x = x0 * (1 - t); pts.push([x, y0 + (yr - y0) * (1 - (x / Math.max(1e-6, x0)) ** 2) + 0.012 * (1 - (x / Math.max(1e-6, x0)) ** 2)]); }
  return pts;
}

// ---------- lofting: stations of sections into a surface, smooth within its patches, hard at its breaks ----------
// sections: [{ z, pts: [[x, y], …], wall?: true (the band after this station is a wall of its own: creased all round) }];
// kinds: each ring band's kind; both halves (x and -x). → faces [{ a, b, c, na, nb, nc, kind, i (station band), j (ring band), side (1 | -1) }]
function loft(sections, kinds, { hardRing = new Set() } = {}) {
  const faces = [];
  for (const side of [1, -1]) {
    const P = sections.map(s => s.pts.map(([x, y]) => [x * side, y, s.z]));
    // (each quad's normal, then each corner's from the quads round it in the same patch: stations split at hard ones,
    // ring points at hardRing)
    const nI = sections.length, nJ = P[0].length;
    const quadN = [];
    for (let i = 0; i < nI - 1; i++) {
      const row = [];
      for (let j = 0; j < nJ - 1; j++) {
        const a = P[i][j], b = P[i + 1][j], c = P[i + 1][j + 1], d = P[i][j + 1];
        let n = cross(sub(c, a), sub(b, d));          // (out of the body: along the ring × along the car)
        if (side < 0) n = scale(n, -1);
        row.push(n);
      }
      quadN.push(row);
    }
    const cornerN = (i, j, qi, qj) => {
      // (the quads round corner (i, j) in the same patch as quad (qi, qj): a wall band — sections[k].wall: the band
      // after station k, where an arch's edge drops — has its own; bands either side of a hard ring point too)
      let n = [0, 0, 0];
      for (const ii of [i - 1, i]) for (const jj of [j - 1, j]) {
        if (ii < 0 || jj < 0 || ii >= nI - 1 || jj >= nJ - 1) continue;
        if (ii !== qi && (sections[ii].wall || sections[qi].wall)) continue;
        if (jj !== qj && hardRing.has(j)) continue;
        n = add(n, quadN[ii][jj]);
      }
      return len(n) > 1e-12 ? norm(n) : norm(quadN[qi][qj]);
    };
    for (let i = 0; i < nI - 1; i++) for (let j = 0; j < nJ - 1; j++) {
      const a = P[i][j], b = P[i + 1][j], c = P[i + 1][j + 1], d = P[i][j + 1];
      const na = cornerN(i, j, i, j), nb = cornerN(i + 1, j, i, j), nc = cornerN(i + 1, j + 1, i, j), nd = cornerN(i, j + 1, i, j);
      const kind = kinds[j], q = scale(add(add(a, b), add(c, d)), 0.25);
      // (wound to face out: the right-hand side's mirror image turned round)
      const tri = (p, q2, r, np, nq, nr) => { const area = len(cross(sub(q2, p), sub(r, p))); if (area > 1e-9) faces.push({ p: [p, q2, r], n: [np, nq, nr], kind, i, j, side, q }); };
      if (side > 0) { tri(a, c, b, na, nc, nb); tri(a, d, c, na, nd, nc); } else { tri(a, b, c, na, nb, nc); tri(a, c, d, na, nc, nd); }
    }
  }
  return faces;
}

// the stations along the car: closer together at the ends and round the arches (a crease at each arch's ends, where the
// side's lower edge jumps up to the arch: a wall band)
function stations(P, extra = []) {
  const zs = new Set();
  const addRange = (a, b, step) => { const n = Math.max(1, Math.ceil((b - a) / step)); for (let k = 0; k <= n; k++) zs.add(round(a + (b - a) * k / n)); };
  addRange(P.rear, P.rear + P.S.tail, 0.025);
  addRange(P.rear + P.S.tail, P.front - P.S.nose, 0.075);
  addRange(P.front - P.S.nose, P.front, 0.02);
  for (const a of P.arches) addRange(a.z - a.Ra, a.z + a.Ra, 0.035);
  for (const z of [P.B.rear, P.cabinRear, P.R.front, P.R.rear, ...extra]) zs.add(round(z));
  const list = [...zs].filter(z => z >= P.rear && z <= P.front).sort((a, b) => a - b);
  // (each arch's ends twice: the side's foot, then the arch's)
  const out = [];
  for (const z of list) {
    const edge = P.arches.find(a => Math.abs(Math.abs(z - a.z) - a.Ra) < 1e-6);
    if (!edge) { out.push({ z }); continue; }
    const zIn = z < edge.z ? z + 1e-4 : z - 1e-4;
    if (z < edge.z) out.push({ z, wall: true }, { z: zIn }); else out.push({ z: zIn, wall: true }, { z });
  }
  return out;
}

// ---------- the model ----------
// Triangles gathered by node and material (car_atlas ones by their palette colour), with their own normals; a part's in
// its socket's frame (under: from the car's)
class SmoothMesher {
  constructor() { this.nodes = new Map(); }
  add(node, material, faces, parent = null, colour = 'grey') {
    if (!this.nodes.has(node)) this.nodes.set(node, { parent, groups: new Map() });
    const g = this.nodes.get(node).groups, key = material === 'car_atlas' ? 'car_atlas' : material;
    if (!g.has(key)) g.set(key, []);
    for (const f of faces) g.get(key).push({ p: f.p, n: f.n ?? null, colour: f.colour ?? colour });
    return this;
  }
}
const NAMES = Object.keys(PALETTE), SIDE = 4;
const uvOf = colour => { const i = Math.max(0, NAMES.indexOf(colour)); return [((i % SIDE) + 0.5) / SIDE, (Math.floor(i / SIDE) + 0.5) / SIDE]; };
const linear = hex => [...[1, 3, 5].map(i => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }), 1];
// (flat triangles from a list of [a, b, c]: their own normals)
const flat = tris => tris.map(([a, b, c]) => { const n = norm(cross(sub(b, a), sub(c, a))); return { p: [a, b, c], n: [n, n, n] }; });

async function documentOf(m, D, sockets) {
  const doc = new Document(), scene = doc.createScene('Scene'), top = doc.createNode(D.id), buffer = doc.createBuffer();
  scene.addChild(top);
  const mats = new Map();
  const atlas = doc.createTexture('car_atlas').setMimeType('image/png').setImage(await palette());
  const material = name => {
    if (mats.has(name)) return mats.get(name);
    const x = doc.createMaterial(name);
    if (name === 'car_atlas') x.setBaseColorTexture(atlas).setRoughnessFactor(0.6).setMetallicFactor(0.05);
    else if (name === 'paint') x.setBaseColorFactor(linear(D.paint)).setRoughnessFactor(0.38).setMetallicFactor(0);
    else if (name === 'glass') x.setBaseColorFactor([0.016, 0.026, 0.034, 0.55]).setAlphaMode('BLEND').setRoughnessFactor(0.03).setMetallicFactor(0);
    else if (name === 'light_head') x.setBaseColorFactor([0.92, 0.92, 0.88, 1]).setEmissiveFactor([1, 0.94, 0.78]).setRoughnessFactor(0.1).setMetallicFactor(0);
    else if (name === 'light_tail') x.setBaseColorFactor([0.42, 0.012, 0.01, 1]).setEmissiveFactor([0.22, 0.004, 0.003]).setRoughnessFactor(0.15).setMetallicFactor(0);
    else if (name === 'rim_finish') x.setBaseColorFactor(linear('#b8bdc4')).setRoughnessFactor(0.3).setMetallicFactor(0.9);
    mats.set(name, x);
    return x;
  };
  const socketNodes = new Map(), use = D.sockets ? new Set(D.sockets) : null;
  for (const [name, s] of Object.entries(sockets)) {
    if (use && !use.has(name)) continue;
    const n = doc.createNode(name).setTranslation(s.position);
    if (s.rotation) n.setRotation(s.rotation);
    top.addChild(n);
    socketNodes.set(name, n);
  }
  for (const [name, { parent, groups }] of m.nodes) {
    const node = doc.createNode(name), mesh = doc.createMesh(name);
    for (const [mat, list] of groups) {
      if (!list.length) continue;
      const pos = [], nor = [], uv = [];
      for (const { p, n, colour } of list) {
        const fn = norm(cross(sub(p[1], p[0]), sub(p[2], p[0]))), [u, v] = uvOf(colour);
        for (let k = 0; k < 3; k++) { pos.push(...p[k]); nor.push(...(n?.[k] ?? fn)); uv.push(u, v); }
      }
      const prim = doc.createPrimitive().setMaterial(material(mat))
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
        .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buffer));
      if (mat === 'car_atlas') prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buffer));
      mesh.addPrimitive(prim);
    }
    node.setMesh(mesh);
    (parent ? socketNodes.get(parent) : top).addChild(node);
  }
  // (corners shared where they're the same point with the same normal: smaller files, the same look — not the wheels':
  // the split cuts their tyres off triangle by triangle)
  for (const node of doc.getRoot().listNodes()) if (node.getMesh() && !/^wheel_/.test(node.getName())) for (const prim of node.getMesh().listPrimitives()) weldPrimitive(prim);
  return doc;
}
async function palette() {
  const raw = Buffer.alloc(SIDE * SIDE * 4);
  NAMES.forEach((name, i) => { const h = PALETTE[name]; for (let k = 0; k < 3; k++) raw[i * 4 + k] = parseInt(h.slice(1 + 2 * k, 3 + 2 * k), 16); raw[i * 4 + 3] = 255; });
  return new Uint8Array(await sharp(raw, { raw: { width: SIDE, height: SIDE, channels: 4 } }).png().toBuffer());
}

// ---------- details projected onto the body ----------
// A projector over the body's faces: decal(outline, { dir, lift }) lays a flat outline (points [u, v] in the plane across
// dir) onto the body along dir, lift (m) off its surface — following its curves, round its corners. dir: '+z' (onto the
// front: u = x, v = y), '-z' (the back), '+x' / '-x' (the left / right side: u = z, v = y), '+y' (from above: u = x,
// v = z). A point that misses the body leaves its triangles out.
function projector(faces, P) {
  const F = faces.map(f => {
    const [a, b, c] = f.p, lo = [0, 1, 2].map(k => Math.min(a[k], b[k], c[k])), hi = [0, 1, 2].map(k => Math.max(a[k], b[k], c[k]));
    return { a, b, c, n: f.n, lo, hi };
  });
  const far = Math.max(P.L, P.W, 3);
  const ray = (o, d) => {
    let best = Infinity, out = null;
    // (only faces whose box the ray's line passes: the two axes across it)
    const ax = d[0] ? [1, 2] : d[1] ? [0, 2] : [0, 1];
    for (const f of F) {
      if (o[ax[0]] < f.lo[ax[0]] - 1e-6 || o[ax[0]] > f.hi[ax[0]] + 1e-6 || o[ax[1]] < f.lo[ax[1]] - 1e-6 || o[ax[1]] > f.hi[ax[1]] + 1e-6) continue;
      const e1 = sub(f.b, f.a), e2 = sub(f.c, f.a), pv = cross(d, e2), det = dot(e1, pv);
      if (Math.abs(det) < 1e-12) continue;
      const tv = sub(o, f.a), u = dot(tv, pv) / det;
      if (u < -1e-6 || u > 1 + 1e-6) continue;
      const qv = cross(tv, e1), v = dot(d, qv) / det;
      if (v < -1e-6 || u + v > 1 + 1e-6) continue;
      const t = dot(e2, qv) / det;
      if (t > 0 && t < best) {
        best = t;
        const w = 1 - u - v, n = f.n ? norm(add(add(scale(f.n[0], w), scale(f.n[1], u)), scale(f.n[2], v))) : norm(cross(e1, e2));
        out = Math.abs(dot(n, d)) < 0.3 ? null : { p: add(o, scale(d, t)), n: dot(n, d) > 0 ? scale(n, -1) : n };
      }
    }
    return out;
  };
  const frame = dir => ({
    '+z': [(u, v) => [u, v, P.front + far], [0, 0, -1]], '-z': [(u, v) => [u, v, P.rear - far], [0, 0, 1]],
    '+x': [(u, v) => [far, v, u], [-1, 0, 0]], '-x': [(u, v) => [-far, v, u], [1, 0, 0]],
    '+y': [(u, v) => [u, far, v], [0, -1, 0]],
  })[dir];
  return function decal(outline, { dir = '+z', lift = 0.004, rings = 3, maxDepth = 0.22 } = {}) {
    const [at, d] = frame(dir), n = outline.length;
    const mid = outline.reduce((m, q) => [m[0] + q[0] / n, m[1] + q[1] / n], [0, 0]);
    // (rings from the middle out: the outline shrunk toward its middle, so a curved surface is followed inside it too)
    const grid = [[mid]];
    for (let r = 1; r <= rings; r++) grid.push(outline.map(q => [lerp(mid[0], q[0], r / rings), lerp(mid[1], q[1], r / rings)]));
    const h0 = ray(at(...mid), d);
    if (!h0) return [];
    const depth = q => dot(sub(q, h0.p), d);
    const hit = grid.map(row => row.map(([u, v]) => { const h = ray(at(u, v), d); return h && Math.abs(depth(h.p)) < maxDepth ? { p: add(h.p, scale(h.n, lift)), n: h.n } : null; }));
    const faces = [];
    const tri = (A, B, C) => {
      if (!A || !B || !C) return;
      let p = [A.p, B.p, C.p], nn = [A.n, B.n, C.n];
      const fn = cross(sub(p[1], p[0]), sub(p[2], p[0]));
      if (len(fn) < 1e-10) return;
      if (dot(fn, add(add(A.n, B.n), C.n)) < 0) { p = [p[0], p[2], p[1]]; nn = [nn[0], nn[2], nn[1]]; }
      faces.push({ p, n: nn });
    };
    for (let k = 0; k < n; k++) tri(hit[0][0], hit[1][k], hit[1][(k + 1) % n]);
    for (let r = 1; r < rings; r++) for (let k = 0; k < n; k++) {
      const a = hit[r][k], b = hit[r][(k + 1) % n], c2 = hit[r + 1][(k + 1) % n], e = hit[r + 1][k];
      tri(a, e, c2); tri(a, c2, b);
    }
    return faces;
  };
}
// outlines (points [u, v], round the middle): a rounded rectangle (slant: its top moved along u), an ellipse
const roundRect = (cu, cv, w, h, r = 0.02, slant = 0, seg = 4) => {
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4);
  const out = [], corners = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, Math.PI / 2], [-w / 2 + r, -h / 2 + r, Math.PI], [w / 2 - r, -h / 2 + r, Math.PI * 1.5]];
  for (const [x, y, a0] of corners) for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * Math.PI / 2, py = y + r * Math.sin(a); out.push([cu + x + r * Math.cos(a) + slant * (py / (h / 2)), cv + py]); }
  return out;
};
const ellipse = (cu, cv, w, h, seg = 24) => Array.from({ length: seg }, (_, i) => { const a = (i / seg) * Math.PI * 2; return [cu + (w / 2) * Math.cos(a), cv + (h / 2) * Math.sin(a)]; });
const mirrorU = outline => outline.map(([u, v]) => [-u, v]).reverse();

// ---------- simple solid shapes for the parts (smooth where they're round) ----------
// A profile [[r, h], …] turned round an axis (h along it), with smooth normals round and along it
function revolve(profile, segs, axis = 'x', { colour = 'grey', sharp = false } = {}) {
  const at = (r, h, a) => { const cA = Math.cos(a), sA = Math.sin(a); return axis === 'x' ? [h, r * sA, r * cA] : axis === 'y' ? [r * cA, h, r * sA] : [r * cA, r * sA, h]; };
  const nAt = (nr, nh, a) => { const cA = Math.cos(a), sA = Math.sin(a); return axis === 'x' ? [nh, nr * sA, nr * cA] : axis === 'y' ? [nr * cA, nh, nr * sA] : [nr * cA, nr * sA, nh]; };
  const faces = [];
  for (let j = 0; j < profile.length - 1; j++) {
    const [r0, h0] = profile[j], [r1, h1] = profile[j + 1];
    const t = [r1 - r0, h1 - h0], nl = Math.hypot(...t) || 1, n2 = [t[1] / nl, -t[0] / nl];        // (out of the profile's left)
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
      const A = at(r0, h0, a0), B = at(r0, h0, a1), C = at(r1, h1, a1), E = at(r1, h1, a0);
      const nA = nAt(n2[0], n2[1], a0), nB = nAt(n2[0], n2[1], a1);
      const push = (p, n) => { const fn = cross(sub(p[1], p[0]), sub(p[2], p[0])); if (len(fn) < 1e-12) return; if (dot(fn, n[0]) < 0) { p = [p[0], p[2], p[1]]; n = [n[0], n[2], n[1]]; } faces.push({ p, n: sharp ? null : n, colour }); };
      push([A, B, C], [nA, nB, nB]); push([A, C, E], [nA, nB, nA]);
    }
  }
  return faces;
}
// a box with rounded-off look: flat faces (min, max corners)
function boxFaces(min, max, colour) {
  const [x0, y0, z0] = min, [x1, y1, z1] = max, v = (x, y, z) => [x ? x1 : x0, y ? y1 : y0, z ? z1 : z0];
  const quads = [[v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)], [v(0, 0, 1), v(0, 1, 1), v(0, 1, 0), v(0, 0, 0)], [v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)],
    [v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)], [v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)], [v(1, 0, 0), v(0, 0, 0), v(0, 1, 0), v(1, 1, 0)]];
  const mid = scale(add(min, max), 0.5), out = [];
  for (const [a, b, c, d] of quads) for (const t of [[a, b, c], [a, c, d]]) {
    const fn = cross(sub(t[1], t[0]), sub(t[2], t[0])), cen = scale(add(add(t[0], t[1]), t[2]), 1 / 3);
    out.push({ p: dot(fn, sub(cen, mid)) < 0 ? [t[0], t[2], t[1]] : t, n: null, colour });
  }
  return out;
}
// the inside of a surface: its faces turned round, `by` in from it
const inside = (faces, by, colour) => faces.map(f => {
  const n = f.n ?? [norm(cross(sub(f.p[1], f.p[0]), sub(f.p[2], f.p[0])))].flatMap(x => [x, x, x]);
  const p = f.p.map((q, k) => sub(q, scale(n[k], by)));
  return { p: [p[0], p[2], p[1]], n: [scale(n[0], -1), scale(n[2], -1), scale(n[1], -1)], colour };
});
const moveFaces = (faces, d) => faces.map(f => ({ ...f, p: f.p.map(q => add(q, d)) }));
const mirrorX = faces => faces.map(f => ({ ...f, p: [f.p[0], f.p[2], f.p[1]].map(q => [-q[0], q[1], q[2]]), n: f.n ? [f.n[0], f.n[2], f.n[1]].map(q => [-q[0], q[1], q[2]]) : null }));

// ---------- the parts ----------
// A wheel in its socket's frame (the axle along x, its outer face toward +x): the tyre round it (rubber: the split
// cuts it off, the game makes each tyre itself), the rim's barrel, lip, spokes (style's rim: spokes, kind), hub,
// lug nuts and centre cap, and a brake disc behind
function wheelFaces(D, P) {
  const Wd = D.wheel.width, r = D.wheel.radius, rim = D.wheel.rimDiameter * 0.0254 / 2, look = P.S.rim ?? { spokes: 5, kind: 'split' };
  const out = [];
  // (the tyre: as the placeholder's, measured by the split against the stock tyre)
  out.push(...revolve([[rim, -Wd / 2], [r, -Wd / 2 + 0.02], [r, Wd / 2 - 0.02], [rim, Wd / 2], [rim, -Wd / 2]], 32, 'x', { colour: 'rubber' }));
  // the barrel (dark inside), the lip (polished), the brake disc behind
  out.push(...revolve([[rim * 0.97, Wd * 0.36], [rim * 0.97, -Wd * 0.42]], 32, 'x', { colour: 'dark' }).map(f => ({ ...f, p: [f.p[0], f.p[2], f.p[1]], n: f.n && [scale(f.n[0], -1), scale(f.n[2], -1), scale(f.n[1], -1)] })));
  out.push(...revolve([[rim * 0.97, Wd * 0.36], [rim * 1.005, Wd * 0.39], [rim * 1.005, Wd * 0.44], [rim * 0.95, Wd * 0.45]], 32, 'x', { colour: 'silver' }).map(f => ({ ...f, material: 'rim_finish' })));
  out.push(...revolve([[rim * 0.78, -0.02], [rim * 0.78, 0.0], [rim * 0.3, 0.0], [rim * 0.3, 0.025], [0.0, 0.03]], 24, 'x', { colour: 'grey', sharp: true }));
  // the spokes: from the hub out to the lip, dished (the hub further in than the rim's face)
  const n = look.spokes ?? 5, hubR = Math.max(0.07, rim * 0.33), outR = rim * 0.96, xHub = Wd * 0.26, xRim = Wd * 0.4, th = 0.024;
  const split = look.kind === 'split' ? [-0.11, 0.11] : look.kind === 'star' ? [-0.07, 0.07] : [0];
  const wHub = look.kind === 'thin' ? 0.026 : look.kind === 'classic' ? 0.05 : look.kind === 'flat' ? 0.06 : 0.04, wRim = look.kind === 'thin' ? 0.02 : look.kind === 'flat' ? 0.07 : 0.034;
  for (let k = 0; k < n; k++) for (const da of split) {
    const a = (k / n) * Math.PI * 2 + da, dir = [0, Math.sin(a), Math.cos(a)], perp = [0, Math.cos(a), -Math.sin(a)];
    const p = (rr, w, x) => add(add([x, 0, 0], scale(dir, rr)), scale(perp, w / 2));
    const q = (rr, w, x) => add(add([x, 0, 0], scale(dir, rr)), scale(perp, -w / 2));
    const A = p(hubR, wHub, xHub), B = q(hubR, wHub, xHub), C = q(outR, wRim, xRim), E = p(outR, wRim, xRim);
    const back = v => sub(v, [th, 0, 0]);
    const quads = [[A, E, C, B], [back(B), back(C), back(E), back(A)], [A, back(A), back(E), E], [B, C, back(C), back(B)]];
    // (each face wound out of the spoke: away from its middle)
    const mid = scale(add(add(A, B), add(C, E)), 0.25).map((v, i) => i === 0 ? v - th / 2 : v);
    for (const [a1, b1, c1, d1] of quads) for (const t of [[a1, b1, c1], [a1, c1, d1]]) {
      const fn = cross(sub(t[1], t[0]), sub(t[2], t[0])), cen = scale(add(add(t[0], t[1]), t[2]), 1 / 3);
      out.push({ p: dot(fn, sub(cen, mid)) < 0 ? [t[0], t[2], t[1]] : t, n: null, colour: 'silver', material: 'rim_finish' });
    }
  }
  // the hub: a dished disc, five lug nuts, the centre cap
  out.push(...revolve([[0.0, xHub + 0.012], [hubR * 0.98, xHub + 0.004], [hubR, xHub - th]], 24, 'x', { colour: 'silver' }).map(f => ({ ...f, material: 'rim_finish' })));
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2, c = [xHub + 0.012, Math.sin(a) * hubR * 0.6, Math.cos(a) * hubR * 0.6];
    out.push(...moveFaces(revolve([[0.011, 0], [0.011, 0.014], [0.0, 0.016]], 6, 'x', { colour: 'dark', sharp: true }), c));
  }
  out.push(...moveFaces(revolve([[0.028, 0], [0.026, 0.01], [0.0, 0.014]], 16, 'x', { colour: 'dark' }), [xHub + 0.012, 0, 0]));
  return out;
}

// A bucket seat in its socket's frame (its base's middle, facing +z): cushion, backrest leaning back, side bolsters
function seatFaces() {
  const out = [], lean = 0.22;
  out.push(...boxFaces([-0.23, 0, -0.24], [0.23, 0.09, 0.26], 'dark'));
  for (const x of [-1, 1]) out.push(...boxFaces([x > 0 ? 0.17 : -0.25, 0.05, -0.24], [x > 0 ? 0.25 : -0.17, 0.16, 0.22], 'black'));
  // (the backrest: a box leaning back from the cushion's back edge, bolstered)
  const back = [...boxFaces([-0.23, 0, -0.06], [0.23, 0.66, 0.04], 'dark'), ...boxFaces([0.17, 0.08, -0.07], [0.26, 0.6, 0.1], 'black'), ...boxFaces([-0.26, 0.08, -0.07], [-0.17, 0.6, 0.1], 'black'), ...boxFaces([-0.13, 0.66, -0.05], [0.13, 0.8, 0.03], 'dark')];
  const c = Math.cos(lean), s = Math.sin(lean);
  out.push(...back.map(f => ({ ...f, p: f.p.map(([x, y, z]) => [x, 0.06 + y * c + z * s, -0.2 + z * c - y * s]) })));
  return out;
}
// The steering wheel in its socket's frame (the column along z): rim, three spokes, the boss, a small badge
function steeringFaces() {
  const out = [], R = 0.18, t = 0.017;
  const ring = Array.from({ length: 9 }, (_, i) => { const a = (i / 8) * Math.PI * 2; return [R + t * Math.cos(a), t * Math.sin(a)]; });
  out.push(...revolve(ring, 32, 'z', { colour: 'black' }));
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    const d = [Math.cos(a), Math.sin(a), 0], pp = [-Math.sin(a), Math.cos(a), 0];
    const P0 = scale(d, 0.04), P1 = scale(d, R - 0.005);
    const corners = [add(P0, scale(pp, 0.022)), add(P1, scale(pp, 0.016)), add(P1, scale(pp, -0.016)), add(P0, scale(pp, -0.022))];
    const f = corners.map(q => add(q, [0, 0, 0.008])), b = corners.map(q => add(q, [0, 0, -0.008]));
    for (const [A, B, C, E] of [[f[0], f[1], f[2], f[3]], [b[3], b[2], b[1], b[0]], [f[0], b[0], b[1], f[1]], [f[3], f[2], b[2], b[3]]]) out.push({ p: [A, B, C], n: null, colour: 'dark' }, { p: [A, C, E], n: null, colour: 'dark' });
  }
  out.push(...revolve([[0.0, 0.03], [0.05, 0.022], [0.055, -0.02], [0.03, -0.05]], 20, 'z', { colour: 'dark' }));
  out.push(...revolve([[0.0, 0.034], [0.016, 0.031]], 12, 'z', { colour: 'silver' }));
  return out;
}
// A door mirror in its socket's frame (the left one: it reaches out toward +x): the housing (paint), its arm, the glass
function mirrorFaces() {
  const house = revolve(Array.from({ length: 9 }, (_, i) => { const a = (i / 8) * Math.PI; return [0.055 * Math.sin(a), 0.07 * -Math.cos(a)]; }), 16, 'z')
    .map(f => ({ ...f, p: f.p.map(([x, y, z]) => [0.11 + x * 1.35, y * 0.8 - 0.035, z * 0.8 + 0.005]), n: f.n?.map(([x, y, z]) => norm([x / 1.35, y / 0.8, z / 0.8])) }));
  const glass = revolve([[0.0, 0], [0.05, 0]], 16, 'z', { colour: 'silver' }).map(f => ({ ...f, p: f.p.map(([x, y, z]) => [0.11 + x * 1.3, y * 0.75 - 0.035, -0.052]) }));
  // (its arm: from the door's top, below it, out to the housing)
  const arm = [...boxFaces([-0.02, -0.12, -0.035], [0.025, -0.06, 0.03], 'black'), ...boxFaces([0.0, -0.075, -0.025], [0.06, -0.045, 0.02], 'black')];
  return { paint: house.filter(f => f.p.every(q => q[2] > -0.05)), trim: [...arm, ...glass.map(f => ({ ...f, p: [f.p[0], f.p[2], f.p[1]], n: f.n?.map(q => [0, 0, -1]) }))] };
}

// ---------- the model ----------
export async function carBodyModel(D) {
  const P = bodyShape(D), m = new SmoothMesher();
  // (where the sockets are: from the design — or, for a car whose physics was tuned on its own (socketsAt: car.json's),
  // exactly there)
  const S = Object.fromEntries(Object.entries({ ...Object.fromEntries(Object.keys(D.socketsAt ?? {}).map(k => [k, {}])), ...carSockets(D) }).map(([k, v]) => [k, D.socketsAt?.[k] ? { ...v, position: D.socketsAt[k].position.map(round), ...(D.socketsAt[k].rotation && { rotation: D.socketsAt[k].rotation }) } : v]));
  const pos = n => S[n].position, has = n => !D.sockets || D.sockets.includes(n);
  const under = (socket, node, material, faces, colour = 'grey') => m.add(node, material, faces.map(f => ({ ...f, p: f.p.map(q => sub(q, pos(socket))) })), socket, colour);
  const { front, rear, belt, c, B, R, K, mid } = P, fa = D.frontAxle, ra = D.rearAxle, Ra = P.arches[0].Ra, look = P.S;
  const doorFront = pos('socket_door_left')[2], doorBack = D.doorBack ?? Math.max(R.rear - 0.05, doorFront - 1.2);

  // --- where the panels' edges are along the car (each a station, so every edge runs along the surface's own lines)
  const zBF = fa + Ra + 0.004, zBR = ra - Ra - 0.004, bonnetFront = round(front - Math.max(0.13, look.nose * 0.32)), bootRear = round(rear + 0.15);
  const bootLid = has('socket_boot') && !mid && K.front > bootRear + 0.1;
  const cover = mid && has('socket_engine_cover') ? [round(K.front + 0.06), round((D.engineCover ?? R.rear - 0.1) - 0.01)] : null;
  // (the cockpit's opening: a convertible's back past its seats — the soft top covers it)
  const openFrom = D.convertible ? Math.min(R.rear - 0.02, (D.seatZ ?? R.rear) - 0.72) : P.cabinRear + 0.15, openTo = B.rear - 0.03;
  // --- the surfaces
  const lowerSt = stations(P, [doorFront, doorBack, bonnetFront, bootRear, K.front, ...(cover ?? [])]).map(s => ({ ...s, pts: lowerSection(P, D, s.z) }));
  const lower = loft(lowerSt, KIND, { hardRing: new Set([1, 2, 3]) });
  const cabinFrom = D.convertible ? R.front - 0.07 : P.cabinRear, cabinTo = B.rear;
  const cz = [];
  for (let k = 0, n = Math.ceil((cabinTo - cabinFrom) / 0.035); k <= n; k++) cz.push(cabinFrom + (cabinTo - cabinFrom) * k / n);
  for (const z of [R.front, R.rear, doorBack]) if (z > cabinFrom + 0.01 && z < cabinTo - 0.01) cz.push(z);
  cz.sort((a, b) => a - b);
  const cabin = loft(cz.map(z => ({ z, pts: cabinSection(P, D, z) })), CABIN_KIND, { hardRing: new Set([1, 5]) });
  const footAt = z => cabinSection(P, D, clamp(z, cabinFrom, cabinTo))[0][0];

  // --- the lower body, cut into its panels: along stations and the ring's own lines (j: KIND's bands — sill 3–5, side
  // 6–11, shoulder 12–14, top 15–20); the bumpers up to the side's middle line, the front one all of the nose ahead of
  // the bonnet
  const centre = f => scale(add(add(f.p[0], f.p[1]), f.p[2]), 1 / 3);
  const groups = new Map();
  const put = (key, f, colour, inner = null) => { if (!groups.has(key)) groups.set(key, []); groups.get(key).push({ ...f, colour, inner }); };
  for (const f of lower) {
    const [x, , z] = f.q, side = x >= 0 ? 'left' : 'right', k = f.kind, j = f.j, F = side[0].toUpperCase();
    const trim = look.cladding && j <= 6 ? 'black' : null;
    if (k === 'under' || k === 'wellWall' || k === 'wellRoof') {
      // (under the rear bumper, the bumper's own: the exhaust leaves through it — tools/generators/lib/fitcheck.js THROUGH;
      // the front one's lowest edge is its lip, which the front lip and canards are made to — lib/car.js bumperOutline)
      if (z < zBR && has('socket_bumper_rear')) put('socket_bumper_rear|panel_bumper_rear|black', f, 'black');
      else put('body|car_atlas', f, 'black');
      continue;
    }
    // (the cockpit's opening: the glasshouse stands on it)
    if (k === 'top' && z > openFrom && z < openTo && f.p.every(q => Math.abs(q[0]) < footAt(q[2]) - 0.006)) continue;
    const inCabin = z > openFrom && z < openTo;
    if (has('socket_bumper_front') && ((z > zBF && j < 9) || z > bonnetFront)) { put(`socket_bumper_front|panel_bumper_front|${trim ?? 'paint'}`, f, trim); continue; }
    if (has('socket_bumper_rear') && z < zBR && j < 10) { put(`socket_bumper_rear|panel_bumper_rear|${trim ?? 'paint'}`, f, trim); continue; }
    if (k === 'top') {
      if (z > B.rear && z < bonnetFront && has('socket_bonnet')) { put('socket_bonnet|panel_bonnet|paint', f, null); continue; }
      if (bootLid && z > bootRear && z < K.front) { put('socket_boot|panel_boot|paint', f, null); continue; }
      if (cover && z > cover[0] && z < cover[1]) { put('socket_engine_cover|panel_engine_cover|paint', f, null); continue; }
      if (inCabin && z > doorBack && z < doorFront && has(`socket_door_${side}`)) { put(`socket_door_${side}|panel_door_${side}|paint`, f, null, 'dark'); continue; }
      put('body|paint', f, null, inCabin ? 'dark' : null); continue;
    }
    // the sides: the sills between the arches, the front wings, the doors, the rear quarters
    if (k === 'sill' && z > ra + Ra && z < fa - Ra && has(`socket_skirt_${side}`)) { put(`socket_skirt_${side}|panel_skirt_${side}|${look.cladding ? 'black' : 'paint'}`, f, look.cladding ? 'black' : null); continue; }
    if (z > doorFront && has(`socket_fender_F${F}`)) { put(`socket_fender_F${F}|panel_fender_F${F}|${trim ?? 'paint'}`, f, trim); continue; }
    if (z > doorBack && z < doorFront && has(`socket_door_${side}`)) { put(`socket_door_${side}|panel_door_${side}|paint`, f, null, 'dark'); continue; }
    put(`body|${trim ?? 'paint'}`, f, trim, inCabin ? 'dark' : null);
  }
  // --- the glasshouse: glass, its trim, the pillars and roof (lined inside)
  const cPillar = R.rear + (['suv', 'hatch'].includes(D.style) ? 0.1 : 0.2), sail = lerp(R.front, B.rear, 0.62);
  for (const f of cabin) {
    const [x, y, z] = centre(f), side = x >= 0 ? 'left' : 'right', k = f.kind;
    if (D.convertible) {
      if (k === 'belt' || k === 'window' || k === 'frame') continue;
      if (k === 'roof' && z > R.front + 0.012) { put(f.j === 8 ? 'body|car_atlas' : 'glass_windscreen|glass', f, f.j === 8 ? 'black' : null); continue; }
      put('body|paint', f, null, 'dark'); continue;
    }
    if (k === 'belt' || k === 'frame') { put('body|car_atlas', f, 'black', 'dark'); continue; }
    if (k === 'window') {
      if (z < cPillar) { put('body|paint', f, null, 'dark'); continue; }
      if (z > sail || Math.abs(z - doorBack) < 0.035) { put('body|car_atlas', f, 'black', 'dark'); continue; }
      put(`glass_side_${side}|glass`, f, null); continue;
    }
    if (k === 'edge') { put('body|paint', f, null, 'grey'); continue; }
    if (z > R.front + 0.01) { put(f.j === 8 ? 'body|car_atlas' : 'glass_windscreen|glass', f, f.j === 8 ? 'black' : null); continue; }
    if (z < R.rear - 0.01) { put(f.j === 8 ? 'body|car_atlas' : 'glass_rear|glass', f, f.j === 8 ? 'black' : null); continue; }
    put('body|paint', f, null, 'grey');
  }
  // the shut lines: a thin dark line along each panel's edge where it meets the body or another panel (on the panel:
  // it comes off with it)
  const keyOf = q => q.map(v => Math.round(v * 2e4)).join(','), edges = new Map();
  for (const [key, list] of groups) {
    const parts = key.split('|');
    if (parts.length !== 3 && !(parts[0] === 'body' && parts[1] === 'paint')) continue;
    const owner = parts.length === 3 ? parts[1] : 'body_shell';
    for (const f of list) for (let k = 0; k < 3; k++) {
      const A = f.p[k], Bq = f.p[(k + 1) % 3], e = [keyOf(A), keyOf(Bq)].sort().join('|');
      if (!edges.has(e)) edges.set(e, []);
      edges.get(e).push({ owner, key, f, k });
    }
  }
  const lines = new Map();
  for (const list of edges.values()) {
    if (list.length !== 2 || list[0].owner === list[1].owner) continue;
    for (const { owner, key, f, k } of list) {
      if (owner === 'body_shell') continue;
      const A = f.p[k], Bq = f.p[(k + 1) % 3], C = f.p[(k + 2) % 3], nA = f.n[k], nB = f.n[(k + 1) % 3];
      const e = norm(sub(Bq, A)), toC = sub(C, A), u = norm(sub(toC, scale(e, dot(toC, e)))), w = 0.0035, lift = 0.0007;
      const a2 = add(A, scale(nA, lift)), b2 = add(Bq, scale(nB, lift)), c2 = add(b2, scale(u, w)), d2 = add(a2, scale(u, w));
      const socket = key.split('|')[0];
      if (!lines.has(owner)) lines.set(owner, { socket, faces: [] });
      lines.get(owner).faces.push({ p: [a2, b2, c2], n: [nA, nB, nB], colour: 'black' }, { p: [a2, c2, d2], n: [nA, nB, nA], colour: 'black' });
    }
  }
  for (const [node, { socket, faces }] of lines) under(socket, node, 'car_atlas', faces.map(f => {
    const fn = cross(sub(f.p[1], f.p[0]), sub(f.p[2], f.p[0]));
    return dot(fn, f.n[0]) < 0 ? { ...f, p: [f.p[0], f.p[2], f.p[1]], n: [f.n[0], f.n[2], f.n[1]] } : f;
  }));
  // (each group into its node: a panel under its socket, in the socket's frame; the insides lined)
  for (const [key, list] of groups) {
    const parts = key.split('|');
    const [socket, node, material] = parts.length === 3 ? parts : [null, parts[0] === 'body' ? 'body_shell' : parts[0], parts[1]];
    const mat = material === 'paint' || material === 'glass' ? material : 'car_atlas';
    const colourOf = f => f.colour ?? (mat === 'car_atlas' ? material : 'grey');
    const faces = list.map(f => ({ p: f.p, n: f.n, colour: colourOf(f) }));
    const lined = list.filter(f => f.inner);
    const insideFaces = lined.length ? inside(lined, 0.012, null).map((f, i) => ({ ...f, colour: lined[i].inner })) : [];
    if (socket) { under(socket, node, mat, faces); if (insideFaces.length) under(socket, node, 'car_atlas', insideFaces); }
    else { m.add(node, mat, faces); if (insideFaces.length) m.add(node, 'car_atlas', insideFaces); }
  }

  // --- details projected onto the body (lights, grilles, plates, badges, handles, vents)
  const decal = projector([...lower, ...cabin], P);
  const W2 = P.W / 2, add2 = (node, material, faces, socket = null, colour = 'grey') => { if (!faces.length) return; if (socket) under(socket, node, material, faces.map(f => ({ ...f, colour }))); else m.add(node, material, faces.map(f => ({ ...f, colour }))); };
  // (the nose's and the tail's faces: how high they reach where the lights go)
  const yTF = P.top(front - 0.05), yBF = P.bottom(front - 0.05), yTR = P.top(rear + 0.05), yBR = P.bottom(rear + 0.05);
  const hl = look.lights?.head ?? 'block', tl = look.lights?.tail ?? 'block', noseY = Math.min(lerp(yBF, yTF, 0.66), yTF - 0.075), tailY = Math.min(lerp(yBR, yTR, 0.72), yTR - 0.07);
  // headlights: their housing (dark), then the lamp
  for (const [sx, n] of [[1, 'left'], [-1, 'right']]) {
    const shapes = {
      swept: [roundRect(sx * (W2 - 0.27), noseY + 0.005, 0.4, 0.085, 0.03, 0.04 * sx)],
      oval: [ellipse(sx * (W2 - 0.3), noseY - 0.01, 0.22, 0.14)],
      block: [roundRect(sx * (W2 - 0.26), noseY, 0.34, 0.12, 0.015)],
      sharp: [roundRect(sx * (W2 - 0.27), noseY + 0.01, 0.38, 0.1, 0.01, 0.06 * sx)],
      twin: [ellipse(sx * (W2 - 0.24), noseY - 0.01, 0.15, 0.15), ellipse(sx * (W2 - 0.42), noseY - 0.01, 0.13, 0.13)],
      slit: [roundRect(sx * (W2 - 0.25), noseY + 0.02, 0.38, 0.05, 0.02, 0.05 * sx)],
    }[hl] ?? [roundRect(sx * (W2 - 0.26), noseY, 0.34, 0.12, 0.015)];
    for (const o of shapes) {
      const mid2 = o.reduce((q, v) => [q[0] + v[0] / o.length, q[1] + v[1] / o.length], [0, 0]), grow = (k, kv = k) => o.map(([u, v]) => [lerp(mid2[0], u, k), lerp(mid2[1], v, kv)]);
      const w = Math.max(...o.map(q => q[0])) - Math.min(...o.map(q => q[0])), h = Math.max(...o.map(q => q[1])) - Math.min(...o.map(q => q[1]));
      add2(`light_head_${n}`, 'car_atlas', decal(grow(1.08, 1.14), { dir: '+z', lift: 0.003, rings: 4 }), null, 'black');
      add2(`light_head_${n}`, 'car_atlas', decal(o, { dir: '+z', lift: 0.005, rings: 4 }), null, 'silver');
      // (the lamps: round projectors in the unit, a running-light strip along its lower edge)
      const lamps = Math.max(1, Math.min(2, Math.round(w / Math.max(0.09, h * 1.1)))), lr = Math.min(h * 0.36, 0.045);
      for (let k = 0; k < lamps; k++) add2(`light_head_${n}`, 'light_head', decal(ellipse(mid2[0] + (lamps > 1 ? (k - 0.5) * w * 0.42 : 0) * (hl === 'oval' ? 0 : 1), mid2[1] + h * 0.08, lr * 2, lr * 2, 18), { dir: '+z', lift: 0.008 }));
      if (h < 0.17 && hl !== 'oval' && hl !== 'twin') add2(`light_head_${n}`, 'light_head', decal(grow(0.86, 0.16).map(([u, v]) => [u, v - h * 0.3]), { dir: '+z', lift: 0.008 }));
    }
    // tail lights
    const tails = {
      slim: [roundRect(sx * (W2 - 0.22), tailY, 0.34, 0.07, 0.025)],
      round: [ellipse(sx * (W2 - 0.2), tailY, 0.11, 0.11), ellipse(sx * (W2 - 0.36), tailY, 0.1, 0.1)],
      tall: [roundRect(sx * (W2 - 0.1), tailY - 0.12, 0.13, 0.34, 0.02)],
      wrap: [roundRect(sx * (W2 - 0.16), tailY + 0.02, 0.3, 0.1, 0.02)],
      bar: [roundRect(sx * (W2 / 2 - 0.02), tailY + 0.01, W2 - 0.06, 0.055, 0.02)],
      block: [roundRect(sx * (W2 - 0.27), tailY, 0.32, 0.12, 0.015)],
    }[tl] ?? [roundRect(sx * (W2 - 0.27), tailY, 0.32, 0.12, 0.015)];
    // (each on the tail's face, not round its corner — a wrap-round one is the style's own)
    for (const o of tails) {
      const deep = tl === 'wrap' ? 0.2 : 0.07;
      add2(`light_tail_${n}`, 'car_atlas', decal(o.map(([u, v]) => [u * 1.0, v]).map(([u, v], i, all) => { const mu = all.reduce((q, w) => q + w[0], 0) / all.length, mv = all.reduce((q, w) => q + w[1], 0) / all.length; return [lerp(mu, u, 1.06), lerp(mv, v, 1.18)]; }), { dir: '-z', lift: 0.003, maxDepth: deep, rings: 4 }), null, 'black');
      add2(`light_tail_${n}`, 'light_tail', decal(o, { dir: '-z', lift: 0.006, maxDepth: deep, rings: 4 }));
    }
    // door handles, indicators on the wings
    if (has(`socket_door_${n}`)) add2(`panel_door_${n}`, 'car_atlas', decal(roundRect(doorBack + 0.17, belt - 0.07, 0.13, 0.026, 0.012), { dir: sx > 0 ? '+x' : '-x', lift: 0.004 }), `socket_door_${n}`, 'dark');
    if (look.sideIntake) add2('body_shell', 'car_atlas', decal(roundRect(ra + Ra + 0.28, c + 0.42, 0.42, 0.17, 0.05, -0.06), { dir: sx > 0 ? '+x' : '-x', lift: 0.003 }), null, 'black');
  }
  // the grille and lower intakes (on the front bumper), the plates, the badges
  const gY = Math.max(lerp(yBF, yTF, 0.24), yBF + 0.09), grilles = {
    wide: [[roundRect(0, gY, 1.05, 0.15, 0.04), 'black'], [roundRect(0, noseY - 0.02, 0.5, 0.07, 0.02), 'dark']],
    mouth: [[ellipse(0, gY + 0.04, 0.55, 0.17), 'black']],
    bars: [[roundRect(0, noseY - 0.01, 0.8, 0.13, 0.02), 'black'], ...[-0.035, 0.015].map(dy => [roundRect(0, noseY + dy, 0.74, 0.022, 0.008), 'grey']), [roundRect(0, yBF + 0.15, 1.1, 0.09, 0.02), 'dark']],
    mesh: [[roundRect(0, noseY - 0.02, 0.62, 0.09, 0.03), 'black'], [roundRect(0, gY, 1.15, 0.17, 0.05), 'black']],
    full: [[roundRect(0, noseY - 0.01, P.W - 0.22, 0.17, 0.02), 'black'], [roundRect(0, yBF + 0.15, 1.1, 0.09, 0.02), 'dark']],
    rally: [[roundRect(0, gY, 1.25, 0.22, 0.05), 'black'], [roundRect(0, noseY - 0.01, 0.42, 0.06, 0.02), 'black']],
    splitter: [[roundRect(0, gY - 0.04, 1.25, 0.12, 0.05), 'black'], ...[-1, 1].map(sx => [roundRect(sx * (W2 - 0.3), gY - 0.02, 0.32, 0.12, 0.04), 'black'])],
  }[look.grille] ?? [[roundRect(0, gY, 1, 0.15, 0.04), 'black']];
  for (const [o, colour] of grilles) add2('panel_bumper_front', 'car_atlas', decal(o, { dir: '+z', lift: colour === 'black' ? 0.003 : 0.006 }), 'socket_bumper_front', colour);
  const plateF = look.grille === 'full' || look.grille === 'bars' ? yBF + 0.07 : gY + 0.02;
  add2('panel_bumper_front', 'car_atlas', decal(roundRect(0, plateF, 0.48, 0.105, 0.008), { dir: '+z', lift: 0.012 }), 'socket_bumper_front', 'white');
  add2('panel_bumper_rear', 'car_atlas', decal(roundRect(0, lerp(yBR, tailY, 0.5), 0.48, 0.105, 0.008), { dir: '-z', lift: 0.008 }), 'socket_bumper_rear', 'white');
  add2('panel_bumper_rear', 'car_atlas', decal(roundRect(0, yBR + 0.06, P.W - 0.5, 0.09, 0.03), { dir: '-z', lift: 0.003 }), 'socket_bumper_rear', 'black');
  const badgeF = look.grille === 'full' || look.grille === 'bars' ? noseY - 0.02 : noseY + 0.02;
  add2('panel_bumper_front', 'car_atlas', decal(ellipse(0, badgeF, 0.08, 0.05, 16), { dir: '+z', lift: 0.014 }), 'socket_bumper_front', 'silver');
  add2('body_shell', 'car_atlas', decal(ellipse(0, tailY + 0.06, 0.07, 0.045, 16), { dir: '-z', lift: 0.008 }), null, 'silver');
  if (look.bonnetVent && has('socket_bonnet')) add2('panel_bonnet', 'car_atlas', decal(roundRect(0, lerp(B.rear, bonnetFront, 0.55), 0.36, 0.2, 0.03), { dir: '+y', lift: 0.003 }), 'socket_bonnet', 'black');
  if (look.louvres && cover) for (let k = 0; k < 5; k++) { const zz = lerp(cover[0], Math.min(cover[1], P.cabinRear - 0.05), 0.2 + k * 0.13); add2('panel_engine_cover', 'car_atlas', decal(roundRect(0, zz, 0.7, 0.04, 0.015), { dir: '+y', lift: 0.003 }), 'socket_engine_cover', 'black'); }
  // windscreen wipers
  for (const sx of [0.32, -0.12]) m.add('body_shell', 'car_atlas', boxFaces([sx - 0.25, belt + 0.005, B.rear - 0.03], [sx + 0.25, belt + 0.02, B.rear - 0.01], 'black'));

  // --- the inside: the floor, the dashboard (its gauges' hood ahead of the driver), the console, the rear shelf
  const seatZ = pos('socket_seat_driver')[2], floorY = pos('socket_seat_driver')[1], foot = footAt((P.cabinRear + B.rear) / 2) - 0.02;
  const wellIn = D.track / 2 - D.wheel.width / 2 - 0.04;
  m.add('body_shell', 'car_atlas', boxFaces([-Math.min(foot, wellIn), floorY - 0.04, Math.max(openFrom, ra + Ra) + 0.02], [Math.min(foot, wellIn), floorY, Math.min(B.rear - 0.1, fa - Ra - 0.02)], 'dark'));
  m.add('dashboard', 'car_atlas', [...boxFaces([-foot, belt - 0.24, B.rear - 0.36], [foot, belt - 0.005, B.rear - 0.02], 'dark'), ...boxFaces([pos('socket_steering_wheel')[0] - 0.17, belt - 0.03, B.rear - 0.4], [pos('socket_steering_wheel')[0] + 0.17, belt + 0.045, B.rear - 0.22], 'black')]);
  m.add('body_shell', 'car_atlas', boxFaces([-0.11, floorY, seatZ - 0.15], [0.11, floorY + 0.24, B.rear - 0.3], 'black'));

  // --- the stock parts in their sockets
  const wheel = wheelFaces(D, P), byMat = (list, mat) => list.filter(f => (f.material ?? 'car_atlas') === mat);
  for (const k of ['FL', 'FR', 'RL', 'RR']) {
    if (!has(`socket_wheel_${k}`)) continue;
    m.add(`wheel_${k}`, 'car_atlas', byMat(wheel, 'car_atlas'), `socket_wheel_${k}`);
    m.add(`wheel_${k}`, 'rim_finish', byMat(wheel, 'rim_finish'), `socket_wheel_${k}`);
  }
  for (const [socket, name] of [['socket_seat_driver', 'seat_driver'], ['socket_seat_passenger', 'seat_passenger']]) if (has(socket)) m.add(name, 'car_atlas', seatFaces(), socket);
  if (has('socket_steering_wheel')) m.add('steering_wheel', 'car_atlas', steeringFaces(), 'socket_steering_wheel');
  const mir = mirrorFaces();
  for (const [n, sx] of [['left', 1], ['right', -1]]) {
    if (!has(`socket_mirror_${n}`)) continue;
    const f = x => sx > 0 ? x : mirrorX(x);
    m.add(`mirror_${n}`, 'paint', f(mir.paint), `socket_mirror_${n}`);
    m.add(`mirror_${n}`, 'car_atlas', f(mir.trim), `socket_mirror_${n}`);
  }
  // the engine: its block and cam covers, under the bonnet (raised a little over it where it needs the room: bodyShape's
  // bulge), cut down to fit where it still doesn't
  const [ew, eh0, el] = D.engine.size, eAt = pos('socket_engine');
  const lid = Math.min(...[-el / 2, 0, el / 2].map(dz => P.top(eAt[2] + dz) + P.bulge(0, eAt[2] + dz))) - 0.04 - eAt[1], eh = Math.max(0.2, Math.min(eh0, lid - 0.06));
  if (has('socket_engine')) m.add('engine_block', 'car_atlas', [...boxFaces([-ew / 2, 0, -el / 2], [ew / 2, eh, el / 2], 'grey'), ...boxFaces([-ew / 2 + 0.05, eh, -el / 2 + 0.05], [ew / 2 - 0.05, eh + 0.06, el / 2 - 0.05], 'dark')], 'socket_engine');
  if (has('socket_exhaust_tip')) m.add('exhaust_tip', 'car_atlas', moveFaces(revolve([[0.03, 0.1], [0.045, 0.1], [0.048, 0.0], [0.04, -0.005], [0.034, 0.0], [0.03, 0.1]], 16, 'z', { colour: 'silver' }), [0, 0, -0.1]), 'socket_exhaust_tip');
  // a convertible's soft top: the fabric roof from the windscreen's top back down behind the seats
  if (D.convertible && has('socket_roof')) {
    const back = Math.min(R.rear - 0.45, openFrom - 0.03);
    const zs = Array.from({ length: 14 }, (_, i) => lerp(back, R.front - 0.04, i / 13));
    const topAt = curve([[back, belt + 0.02], [R.rear - 0.12, R.height - 0.02], [lerp(R.rear, R.front, 0.5), R.height - 0.005], [R.front - 0.04, R.height - 0.01]]);
    const secs = zs.map(z => ({ z, pts: cabinSection({ ...P, cabinTop: topAt }, D, z) }));
    const roof = loft(secs, CABIN_KIND).filter(f => f.kind !== 'belt');
    under('socket_roof', 'soft_top', 'car_atlas', [...roof.map(f => ({ ...f, colour: 'black' })), ...inside(roof, 0.01, 'dark').map(f => ({ ...f, colour: 'dark' }))]);
  }
  return documentOf(m, D, S);
}

export { lowerSection, cabinSection, loft, stations, archAt, documentOf, SmoothMesher, flat, KIND, CABIN_KIND, RING, projector };
