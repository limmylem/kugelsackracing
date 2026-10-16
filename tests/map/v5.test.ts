// Map v5's own tests (MAP_README.md, MAP_V5_REPORT.md; Step 11 of the Map v5 brief), each on a Map v5 bake
// (assets/map/<region>/v5/, or --dir), decoded and collided with as the game does (tests/map/harness.ts). Every limit
// is data/map/v5.json's `tests`. Map v4's tests run on the same bake (npm run test:map4 -- --dir assets/map/adelaide/v5),
// those Map v5 replaces as said in MAP_V5_REPORT.md.
//
//   side        1g. traffic lights and regulatory signs on the driving side of the traffic they face
//   lanes       2. nothing standing in a lane: furniture, lamps, trees, place and street name signs off the road itself
//   floating    1h. car parks and paths on the ground (or a building, or a road, under them)
//   clearance   1d. bridges' decks clear of the roads under them, at their edges (minEdgeClearance m)
//   roundabouts 1j. a known roundabout's island a garden; a known crossing of divided roads none
//   buildings   3. every building a type (estimated ones marked)
//   tunnels     1e. every tunnel under thick ground driven through end to end by the autopilot: no fall through, no
//               climb onto the hill, out the far portal; from inside, a ceiling over the road and a wall either side
//               (all solid); the ground over it intact (the hill's own height, drawn and solid)
//
//   npm run test:map5 [-- --region adelaide] [--only tunnels] [--verbose] [--json out.json] [--dir <a bake elsewhere>]

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { mapHarness } from './harness.ts';
import { createAutopilot } from '../../route/autopilot.js';
import { resample } from '../../route/geometry.js';

const args = process.argv.slice(2), opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const only = opt('--only')?.split(',').map(s => s.trim()), verbose = args.includes('--verbose'), region = opt('--region') ?? 'adelaide';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'), DIR = opt('--dir') ? path.resolve(opt('--dir')!) : path.join(ROOT, 'assets/map', region, 'v5');
const M = await mapHarness(region, DIR), { H, manifest } = M;
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/map/v5.json'), 'utf8')), X = cfg.tests;
const style = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/map/styles', `${manifest.style?.id ?? 'australia'}.json`), 'utf8'));
const model = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DIR, manifest.files.roadModel))).toString());
const rows: any[] = [];
const report = (test: string, name: string, pass: boolean, detail: string, value: any = null) => { rows.push({ test, name, pass, detail, value }); console.log(`${pass ? '  ok  ' : ' FAIL '} ${name.padEnd(50)} ${detail}`); };
const note = (s: string) => { if (verbose) console.log(`         ${s}`); };
// (a test with nothing to test in this bake — a slice without tunnels — is skipped, not passed or failed)
const skip = (test: string, name: string, detail: string) => { skipped.push({ test, name, detail }); console.log(` skip  ${name.padEnd(50)} ${detail}`); };
const skipped: any[] = [];
const want = (k: string) => !only || only.includes(k);

// the road model's segments: points [x, z, y …], half-widths [left, right …]
const segById = new Map<number, any>(model.segs.map((g: any) => [g.id, g]));
const ptsOf = (g: any) => { const out: { x: number; z: number; h: number; w: number }[] = []; for (let k = 0; k < g.points.length / 3; k++) out.push({ x: g.points[k * 3], z: g.points[k * 3 + 1], h: g.points[k * 3 + 2], w: (g.half[k * 2] ?? 4) + (g.half[k * 2 + 1] ?? 4) }); return out; };
const lenOf = (g: any) => { const p = ptsOf(g); let L = 0; for (let k = 1; k < p.length; k++) L += Math.hypot(p[k].x - p[k - 1].x, p[k].z - p[k - 1].z); return L; };

// ---------- 1e. tunnels ----------
async function tunnelsTest() {
  console.log('\n1e. Tunnels: driven through, end to end');
  const C = cfg.terrain.tunnelCover, Hc = style.tunnel.height;
  // (each one-way run of tunnel segments, joined end to end, the same road before and after it)
  const tunnels = model.segs.filter((g: any) => g.structure === 'tunnel' && !g.internal && g.oneway);
  const byFrom = new Map<number, any[]>(), byTo = new Map<number, any[]>();
  for (const g of model.segs) { (byFrom.get(g.from) ?? byFrom.set(g.from, []).get(g.from)!).push(g); (byTo.get(g.to) ?? byTo.set(g.to, []).get(g.to)!).push(g); }
  const used = new Set<number>(), runs: any[][] = [];
  for (const g of tunnels) {
    if (used.has(g.id) || (byTo.get(g.from) ?? []).some((p: any) => p.structure === 'tunnel' && p.oneway && p.name === g.name)) continue;
    const run = [g]; used.add(g.id);
    for (let n = (byFrom.get(g.to) ?? []).find((q: any) => q.structure === 'tunnel' && q.name === g.name); n && !used.has(n.id); n = (byFrom.get(n.to) ?? []).find((q: any) => q.structure === 'tunnel' && q.name === g.name)) { run.push(n); used.add(n.id); }
    if (run.reduce((a, s) => a + lenOf(s), 0) >= X.tunnelMinLength) runs.push(run);
  }
  if (!runs.length) { skip('tunnels', 'tunnels in this bake', `no one-way tunnel of ${X.tunnelMinLength} m or more here (the Heysen Tunnels: --dir assets/map/adelaide/v5-heysen)`); return; }
  const extend = (seg: any, back: boolean, reach: number) => { const out: any[] = []; let at = seg, L = 0; while (L < reach) { const n = (back ? byTo.get(at.from) : byFrom.get(at.to))?.find((q: any) => q.name === seg.name && q.structure !== 'tunnel' && !out.includes(q)); if (!n) break; out.push(n); L += lenOf(n); at = n; } return back ? out.reverse() : out; };
  for (const run of runs) {
    const before = extend(run[0], true, X.tunnelApproach), after = extend(run[run.length - 1], false, X.tunnelApproach);
    const segs = [...before, ...run, ...after], raw = segs.flatMap((g: any) => ptsOf(g));
    const line = resample(raw, 4);
    const tunnelLen = run.reduce((a, s) => a + lenOf(s), 0), approachLen = before.reduce((a: number, s: any) => a + lenOf(s), 0);
    const name = `${run[0].name} (${tunnelLen.toFixed(0)} m, ${run.length} segments)`;
    // (its grade inside: the model's heights end to end)
    const tp = run.flatMap((g: any) => ptsOf(g)), grade = (tp[tp.length - 1].h - tp[0].h) / tunnelLen * 100;
    const xs = line.map(p => p.x), zs = line.map(p => p.z), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const radius = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2 + 150;
    const S = await M.simAround(cx, cz, { radius, spec: H.garage(null, 'starter_car').stats().spec });
    const sim = S.sim, v = sim.vehicle;
    // (on the road at the line's start, under whatever's over it)
    const p0 = line[0], p1 = line[3], [sx, sz] = S.toSim(p0.x, p0.z), y0 = S.ground(p0.x, p0.z, p0.h + 3, false, 20) ?? p0.h;
    sim.resetCar({ position: [sx, y0 + 0.4, sz], headingDeg: Math.atan2(p1.x - p0.x, p1.z - p0.z) * 180 / Math.PI });
    const A = createAutopilot(line, { loop: false }), dt = sim.dt;
    const L = line[line.length - 1].s, inFrom = approachLen, inTo = approachLen + tunnelLen;
    let t = 0, s = 0, worstY = 0, worstAt = '', inside = 0, k = 0;
    const lineH = (q: number) => { while (k < line.length - 2 && line[k + 1].s < q) k++; while (k > 0 && line[k].s > q) k--; const a = line[k], b = line[k + 1] ?? a, f = b.s > a.s ? (q - a.s) / (b.s - a.s) : 0; return a.h + (b.h - a.h) * f; };
    for (; t < X.tunnelTimeLimit && s < L - 20; t += dt) {
      const b = v.body, p = b.translation(), q = b.rotation(), lin = b.linvel();
      const fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y), fm = Math.hypot(fx, fz) || 1;
      const wx = p.x + S.origin[0], wz = p.z + S.origin[1], speed = lin.x * fx / fm + lin.z * fz / fm;
      const cmd = A.drive({ x: wx, z: wz, fx: fx / fm, fz: fz / fm, speed, dt });
      // (at most the tunnel's speed: X.tunnelSpeed km/h)
      if (speed * 3.6 > X.tunnelSpeed) cmd.throttle = 0;
      sim.step({ device: 'wheel', throttle: cmd.throttle, brake: cmd.brake, steer: cmd.steer, handbrake: false });
      // (how far along: the nearest point of the line ahead of the last)
      let best = Infinity, bs = s; for (let j = Math.max(0, Math.floor(s / 4) - 3); j < Math.min(line.length, Math.floor(s / 4) + 8); j++) { const d = Math.hypot(line[j].x - wx, line[j].z - wz); if (d < best) { best = d; bs = line[j].s; } }
      s = Math.max(s, bs);
      // (the car's body over the road under it: not fallen through, not up on the hill over the tunnel)
      const dy = p.y - lineH(s);
      if (s > inFrom && s < inTo) { inside++; if (Math.abs(dy) > Math.abs(worstY)) { worstY = dy; worstAt = `${s.toFixed(0)} m along`; } }
      if (verbose && Math.round(t / dt) % Math.round(2 / dt) === 0) note(`${t.toFixed(0)} s  ${s.toFixed(0)} / ${L.toFixed(0)} m  ${(speed * 3.6).toFixed(0)} km/h  over the road ${dy.toFixed(2)} m  ${s > inFrom && s < inTo ? 'in the tube' : ''}`);
    }
    if (verbose && s < L - 20) {
      // (what stopped it: rays along the road from 30 m before, at a few heights)
      const j = Math.max(0, Math.floor((s - 30) / 4)), a = line[j], b = line[j + 2], [px, pz] = S.toSim(a.x, a.z), dl = Math.hypot(b.x - a.x, b.z - a.z);
      for (const up of [0.3, 1, 2, 4]) { const r = S.ray([px, a.h + up, pz], [(b.x - a.x) / dl, 0, (b.z - a.z) / dl], 60); note(`ray along the road from ${(s - 30).toFixed(0)} m at ${up} m up: ${r ? `${r.kind} at ${r.d.toFixed(1)} m` : 'clear'}`); }
      note(`line: ${line.filter(q => q.s > s - 40 && q.s < s + 24).map(q => `${q.x.toFixed(1)},${q.z.toFixed(1)},${q.h.toFixed(1)}`).join(' ')}`);
      const pp = v.body.translation(); note(`car at ${(pp.x + S.origin[0]).toFixed(1)}, ${pp.y.toFixed(1)}, ${(pp.z + S.origin[1]).toFixed(1)}; line there h ${lineH(s).toFixed(1)}; tunnel run from ${inFrom.toFixed(0)} to ${inTo.toFixed(0)} m`);
    }
    const through = s >= L - 20 && Math.abs(worstY) < X.tunnelBodyOverRoad;
    report('tunnels', `${name}: driven through`, through, `${through ? 'out the far portal' : `stopped ${s.toFixed(0)} m along of ${L.toFixed(0)}`} in ${t.toFixed(0)} s; in the tube the body ${worstY.toFixed(2)} m over the road at worst (${worstAt}; limit ±${X.tunnelBodyOverRoad}); grade inside ${grade.toFixed(1)}%`, { s, L, worstY, grade });
    // from points along the tube's middle: a ray up hits its ceiling, rays out either side its walls, a ray from the
    // sky the hill's own ground over it (its natural height, drawn: the cover)
    // (where the first thing down from the sky is more than tunnelCover m over the road — the hill, drawn and solid —
    // the road's in its tube: a ceiling over it, a wall either side; elsewhere it's open, in a cutting, and the first
    // thing down is the road itself)
    let ceil = 0, walls = 0, n = 0, open = 0, openBad = 0;
    const bad: string[] = [];
    for (let q = inFrom + X.tunnelProbeEvery / 2; q < inTo; q += X.tunnelProbeEvery) {
      const j = Math.min(line.length - 2, Math.floor(q / 4)), a = line[j], b = line[j + 1], h = lineH(q), [px, pz] = S.toSim(a.x, a.z);
      const tx = b.x - a.x, tz = b.z - a.z, tl = Math.hypot(tx, tz) || 1, nx = -tz / tl, nz = tx / tl;
      const top = S.ray([px, h + 400, pz], [0, -1, 0], 400), over = top ? 400 - top.d : -Infinity;
      if (over < C - 0.3) { open++; if (over > 0.5) { openBad++; if (bad.length < 4) bad.push(`something ${over.toFixed(1)} m over the open road at ${q.toFixed(0)} m`); } continue; }
      n++;
      const up = S.ray([px, h + 1.5, pz], [0, 1, 0], 20), left = S.ray([px, h + 1.5, pz], [nx, 0, nz], 30), right = S.ray([px, h + 1.5, pz], [-nx, 0, -nz], 30);
      if (up && up.kind === 'tunnel' && Math.abs(up.d - (Hc - 1.5)) < 0.6) ceil++; else if (bad.length < 4) bad.push(`ceiling ${up ? `${up.kind} ${(up.d + 1.5).toFixed(1)}` : 'none'} m up at ${q.toFixed(0)} m (${a.x.toFixed(1)}, ${a.z.toFixed(1)}, ${h.toFixed(1)})`);
      if (left?.kind === 'tunnel' && right?.kind === 'tunnel' && left.d + right.d < a.w + 2) walls++; else if (bad.length < 4) bad.push(`walls ${left ? `${left.kind} ${left.d.toFixed(1)}` : 'none'} / ${right ? `${right.kind} ${right.d.toFixed(1)}` : 'none'} m at ${q.toFixed(0)} m (${a.x.toFixed(1)}, ${a.z.toFixed(1)}, ${h.toFixed(1)}; left ${nx.toFixed(2)}, ${nz.toFixed(2)})`);
    }
    report('tunnels', `${name}: solid all round, hill intact`, n > 0 && ceil === n && walls === n && openBad === 0, `${n} points under the hill (≥ ${C} m of it over the road): ceiling ${ceil}, both walls ${walls}; ${open} in its cuttings, open to the sky (${openBad} not)${bad.length ? ` — ${bad.join('; ')}` : ''}`, { n, ceil, walls, open, openBad });
    S.free();
  }
}

// ---------- every tile: what it holds, tile-local ----------
const tiles: { i: number; j: number; cx: number; cz: number; t: any }[] = [];
for (const e of manifest.tiles) { const t = await M.tile(e.i, e.j); if (t) tiles.push({ i: e.i, j: e.j, cx: (e.i + 0.5) * M.T, cz: (e.j + 0.5) * M.T, t }); }
const FURN: Record<string, number> = await import('../../map/format/furniture.ts').then(m => m.FURN as any);
const FURN_NAME = Object.fromEntries(Object.entries(FURN).map(([k, v]) => [v, k]));
// (a tile's triangles of a mesh by cell, for "which of them is over (x, z)": with each one's height there)
function triIndex(m: any, keep: (t: number) => boolean = () => true, C = 8) {
  const grid = new Map<number, number[]>(), P = m?.positions, I = m?.indices, key = (a: number, b: number) => a * 100003 + b;
  if (!P) return () => [] as number[];
  for (let t = 0; t < I.length; t += 3) {
    if (!keep(t / 3)) continue;
    const xs = [P[I[t] * 3], P[I[t + 1] * 3], P[I[t + 2] * 3]], zs = [P[I[t] * 3 + 2], P[I[t + 1] * 3 + 2], P[I[t + 2] * 3 + 2]];
    for (let a = Math.floor(Math.min(...xs) / C); a <= Math.floor(Math.max(...xs) / C); a++) for (let b = Math.floor(Math.min(...zs) / C); b <= Math.floor(Math.max(...zs) / C); b++) (grid.get(key(a, b)) ?? grid.set(key(a, b), []).get(key(a, b))!).push(t);
  }
  return (x: number, z: number) => {
    const out: number[] = [];
    for (const t of grid.get(key(Math.floor(x / C), Math.floor(z / C))) ?? []) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, d = (P[b + 2] - P[c + 2]) * (P[a] - P[c]) + (P[c] - P[b]) * (P[a + 2] - P[c + 2]);
      if (Math.abs(d) < 1e-12) continue;
      const l1 = ((P[b + 2] - P[c + 2]) * (x - P[c]) + (P[c] - P[b]) * (z - P[c + 2])) / d, l2 = ((P[c + 2] - P[a + 2]) * (x - P[c]) + (P[a] - P[c]) * (z - P[c + 2])) / d, l3 = 1 - l1 - l2;
      if (l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) out.push(l1 * P[a + 1] + l2 * P[b + 1] + l3 * P[c + 1]);
    }
    return out;
  };
}
const groundOf = (t: any) => { const hf = t.heightfield, T = M.T, half = T / 2; return (x: number, z: number) => { const n = hf.n, N1 = n + 1, cell = T / n, fx = Math.max(0, Math.min(n - 1e-3, (x + half) / cell)), fz = Math.max(0, Math.min(n - 1e-3, (z + half) / cell)), c = Math.floor(fx), r = Math.floor(fz), u = fx - c, v = fz - r, h = (cc: number, rr: number) => hf.heights[rr + cc * N1]; return h(c, r) * (1 - u) * (1 - v) + h(c + 1, r) * u * (1 - v) + h(c, r + 1) * (1 - u) * v + h(c + 1, r + 1) * u * v; }; };
// (the road model's centre lines by cell: the nearest piece to a world point, with its direction)
const RC = 30, rgrid = new Map<string, number[][]>();
for (const g of model.segs) { if (g.internal) continue; const p = ptsOf(g); for (let k = 0; k + 1 < p.length; k++) { const key = `${Math.floor(p[k].x / RC)},${Math.floor(p[k].z / RC)}`; (rgrid.get(key) ?? rgrid.set(key, []).get(key)!).push([p[k].x, p[k].z, p[k + 1].x, p[k + 1].z]); } }
// (along dir, when given: a road running that way, within 45° — a sign at a corner faces its own road, not the cross street)
const nearestRoad = (x: number, z: number, r = 25, dir: number[] | null = null) => { let best: any = null; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const [ax, az, bx, bz] of rgrid.get(`${Math.floor(x / RC) + a},${Math.floor(z / RC) + b}`) ?? []) { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9; if (dir && Math.abs((dx * dir[0] + dz * dir[1]) / Math.sqrt(l2)) < Math.SQRT1_2) continue; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(x - ax - dx * t, z - az - dz * t); if (d < r && (!best || d < best.d)) best = { d, px: ax + dx * t, pz: az + dz * t }; } return best; };

// ---------- 1g / Step 5. the driving side ----------
function sideTest() {
  console.log('\n1g. Signs and lights on the driving side, facing their traffic');
  // (a piece faces its traffic — map/format/furniture.ts: yaw = atan2(−tx, −tz) for traffic going (tx, tz) — and stands
  // on that traffic's kerb side: its left where traffic keeps left (x east, z south: left of (tx, tz) is (tz, −tx)))
  const left = style.drivingSide !== 'right', kinds = [FURN.trafficLight, FURN.stop, FURN.giveWay, FURN.speed, FURN.roundabout, FURN.noEntry];
  const by: Record<string, [number, number]> = {}, wrong: Record<string, string[]> = {};
  for (const { cx, cz, t } of tiles) {
    const F = t.lists.furniture; if (!F) continue;
    for (let k = 0; k < F.data.length; k += F.stride) {
      const kind = F.data[k + 4]; if (!kinds.includes(kind)) continue;
      const x = F.data[k] + cx, z = F.data[k + 2] + cz, yaw = F.data[k + 3], tx = -Math.sin(yaw), tz = -Math.cos(yaw), r = nearestRoad(x, z, 25, [tx, tz]);
      if (!r) continue;
      const side = (x - r.px) * tz + (z - r.pz) * -tx, ok = left ? side > 0 : side < 0, c = (by[FURN_NAME[kind]] ??= [0, 0]);
      c[0]++; if (ok) c[1]++; else if ((wrong[FURN_NAME[kind]] ??= []).length < 3) { const [la, lo] = M.P.toLatLon(x, z); wrong[FURN_NAME[kind]].push(`${la.toFixed(6)},${lo.toFixed(6)}`); }
    }
  }
  for (const [name, [n, ok]] of Object.entries(by)) report('side', `${name}: on the driving side`, n === 0 || ok / n >= X.drivingSideShare || n - ok <= 1, `${ok} of ${n} (${n ? (ok / n * 100).toFixed(1) : 100}%; at least ${(X.drivingSideShare * 100).toFixed(0)}%, or all but one) on the ${left ? 'left' : 'right'} of the traffic they face${wrong[name] ? ` — not: ${wrong[name].join('; ')}` : ''}`, { n, ok });
  if (!Object.keys(by).length) skip('side', 'signs and lights in this bake', 'none here');
}

// ---------- Step 2 / 5 / 7. nothing in a lane ----------
function lanesTest() {
  console.log('\n2. Nothing standing in a lane (furniture, signs, lamps, trees)');
  const counts: Record<string, [number, number]> = {}, bad: string[] = [];
  for (const { i, j, cx, cz, t } of tiles) {
    const names: string[] = t.header.surfaceNames ?? [], tarmac = names.indexOf('tarmac'), R = t.meshes.roads;
    if (!R) continue;
    const onLane = triIndex(R, q => R.surfaces?.[q] === tarmac);
    const check = (what: string, x: number, y: number, z: number) => {
      const c = (counts[what] ??= [0, 0]); c[0]++;
      // (on the road's own surface, at its foot's height — a deck over it, a tunnel under it, don't count)
      if (onLane(x, z).some(h => Math.abs(h - y) < 1.0)) { c[1]++; if (bad.length < 6) bad.push(`${what} at (${(x + cx).toFixed(1)}, ${(z + cz).toFixed(1)}) in tile ${i}_${j}`); }
    };
    const F = t.lists.furniture;
    if (F) for (let k = 0; k < F.data.length; k += F.stride) { const kind = F.data[k + 4]; if (kind === FURN.canopy) continue; check(FURN_NAME[kind] ?? 'furniture', F.data[k], F.data[k + 1], F.data[k + 2]); }
    // (a tunnel's lamps hang on its walls — map/model/lamps.ts flags 2 — by design)
    const L = t.lists.lamps; if (L) for (let k = 0; k < L.data.length; k += L.stride) if (!(L.data[k + 5] & 2)) check('lamp', L.data[k], L.data[k + 1], L.data[k + 2]);
    const Tr = t.lists.trees; if (Tr) for (let k = 0; k < Tr.data.length; k += Tr.stride) check('tree', Tr.data[k], Tr.data[k + 1], Tr.data[k + 2]);
    const Ps = t.lists.placeSigns; if (Ps) for (let k = 0; k < Ps.data.length; k += Ps.stride) check('place sign', Ps.data[k], Ps.data[k + 1], Ps.data[k + 2]);
    const Sg = t.lists.signs; if (Sg) for (let k = 0; k < Sg.data.length; k += Sg.stride) check('street name sign', Sg.data[k], Sg.data[k + 1], Sg.data[k + 2]);
  }
  const total = Object.values(counts).reduce((a, c) => a + c[1], 0), all = Object.values(counts).reduce((a, c) => a + c[0], 0);
  report('lanes', 'nothing in a lane', total <= X.inLaneAllowed, `${total} of ${all} pieces stand on a lane (${Object.entries(counts).filter(([, c]) => c[1]).map(([k, c]) => `${k} ${c[1]}`).join(', ') || 'none'})${bad.length ? ` — ${bad.join('; ')}` : ''}`, { counts });
}

// ---------- 1h. nothing floats ----------
function floatingTest() {
  console.log('\n1h. Nothing floating over the ground');
  let n = 0, high = 0, worst = 0;
  const bad: string[] = [];
  for (const { i, j, cx, cz, t } of tiles) {
    if (!t.heightfield) continue;
    const ground = groundOf(t);
    // (inside a building — its collider's footprint — a car park or a path is the building's own floor)
    const hulls: number[][][] = [], Hl = t.lists.hulls?.data ?? [];
    for (let k = 0; k < Hl.length; ) { const nP = Hl[k]; const pts: number[][] = []; for (let q = 0; q < nP; q++) pts.push([Hl[k + 3 + q * 2], Hl[k + 4 + q * 2]]); hulls.push(pts); k += 3 + nP * 2; }
    const inHull = (x: number, z: number) => hulls.some(r => { let c = false; for (let a = 0, b = r.length - 1; a < r.length; b = a++) if ((r[a][1] > z) !== (r[b][1] > z) && x < (r[b][0] - r[a][0]) * (z - r[a][1]) / (r[b][1] - r[a][1]) + r[a][0]) c = !c; return c; });
    // (over a road — a car park deck, a path on a bridge — is held up by it)
    const R = t.meshes.roads, overRoad = triIndex(R);
    for (const name of ['paved', 'paths']) {
      const m = t.meshes[name]; if (!m) continue;
      const P = m.positions, I = m.indices;
      for (let q = 0; q < I.length; q += 3) {
        let x = 0, y = 0, z = 0; for (let e = 0; e < 3; e++) { x += P[I[q + e] * 3] / 3; y += P[I[q + e] * 3 + 1] / 3; z += P[I[q + e] * 3 + 2] / 3; }
        n++;
        const d = y - ground(x, z);
        if (d <= X.floatingOver || inHull(x, z) || overRoad(x, z).some(h => h < y - 0.3)) continue;
        high++; worst = Math.max(worst, d);
        if (bad.length < 6) bad.push(`${name} ${d.toFixed(2)} m up at (${(x + cx).toFixed(1)}, ${(z + cz).toFixed(1)}) in tile ${i}_${j}`);
      }
    }
  }
  report('floating', 'car parks and paths on the ground', high <= n * X.floatingShare, `${high} of ${n} triangles more than ${X.floatingOver} m over the ground with nothing under them (highest ${worst.toFixed(2)} m; at most ${(X.floatingShare * 100).toFixed(3)}%: ${Math.floor(n * X.floatingShare)})${bad.length ? ` — ${bad.join('; ')}` : ''}`, { n, high, worst });
}

// ---------- 1d. clearance under bridges ----------
function clearanceTest() {
  console.log('\n1d. Clearance under bridges over roads');
  let decks = 0, over = 0, low = 0, worst = Infinity;
  const lows: [number, string][] = [];
  for (const { i, j, cx, cz, t } of tiles) {
    const E = t.lists.roadEdges?.data, R = t.meshes.roads; if (!E || !R) continue;
    const names: string[] = t.header.surfaceNames ?? [], tarmac = names.indexOf('tarmac'), under = triIndex(R, q => R.surfaces?.[q] === tarmac);
    for (let k = 0; k < E.length; k += 8) {
      if (Math.round(E[k + 7]) !== 3) continue;
      decks++;
      // (a road under the deck's edge, more than a deck's depth below it: the gap from it to the deck's underside)
      const x = (E[k] + E[k + 3]) / 2, y = (E[k + 1] + E[k + 4]) / 2, z = (E[k + 2] + E[k + 5]) / 2, below = under(x, z).filter(h => h < y - X.deckDepth - 0.5);
      if (!below.length) continue;
      over++;
      const gap = y - X.deckDepth - Math.max(...below); worst = Math.min(worst, gap);
      if (gap < X.minEdgeClearance) { low++; const [la, lo] = M.P.toLatLon(x + cx, z + cz); lows.push([gap, `${gap.toFixed(2)} m at ${la.toFixed(6)},${lo.toFixed(6)}`]); }
    }
  }
  report('clearance', 'bridges clear of the roads under them', over === 0 || low / over <= X.lowClearanceShare, `${over} of ${decks} deck edge pieces over a road: ${low} under ${X.minEdgeClearance} m at the deck's edge (${over ? (low / over * 100).toFixed(1) : 0}%; at most ${(X.lowClearanceShare * 100).toFixed(0)}%), the lowest ${Number.isFinite(worst) ? worst.toFixed(2) : '—'} m${lows.length ? ` — ${lows.sort((a, b) => a[0] - b[0]).slice(0, 6).map(l => l[1]).join('; ')}` : ''}`, { decks, over, low, worst });
}

// ---------- 1j. roundabouts' islands ----------
function roundaboutsTest() {
  console.log('\n1j. Roundabouts: a garden in the middle, none where there is no roundabout');
  const check = (name: string, lat: number, lon: number, r: number, want: boolean) => {
    const [x, z] = M.P.toXZ(lat, lon), i = Math.floor(x / M.T), j = Math.floor(z / M.T), e = tiles.find(q => q.i === i && q.j === j);
    if (!e?.t.meshes.roads) { note(`${name}: not in this bake`); return; }
    const R = e.t.meshes.roads, names: string[] = e.t.header.surfaceNames ?? [], dirt = names.indexOf('dirt'), garden = triIndex(R, q => R.surfaces?.[q] === dirt);
    let hits = 0, n = 0; for (let a = 0; a < 16; a++) for (const d of [r * 0.3, r * 0.6]) { n++; if (garden(x - e.cx + Math.cos(a / 16 * 2 * Math.PI) * d, z - e.cz + Math.sin(a / 16 * 2 * Math.PI) * d).length) hits++; }
    report('roundabouts', name, want ? hits >= n / 2 : hits === 0, `${hits} of ${n} points within ${r} m of its middle in a garden bed (${want ? 'a roundabout: most' : 'not a roundabout: none'})`, { hits, n });
  };
  for (const c of X.roundabouts ?? []) check(c.name, c.lat, c.lon, c.r, c.garden);
  if (!rows.some(r => r.test === 'roundabouts')) skip('roundabouts', 'roundabouts in this bake', 'none of the known ones here');
}

// ---------- Step 3. every building a type ----------
function buildingsTest() {
  console.log('\n3. Buildings: every one a type');
  let n = 0, untyped = 0, estimated = 0, landmarks = 0;
  const byType: Record<string, number> = {};
  for (const { t } of tiles) {
    const L = t.lists.buildingInfo, types: string[] = t.header.buildingTypes ?? []; if (!L) continue;
    for (let k = 0; k < L.data.length; k += L.stride) { n++; const ty = types[L.data[k + 3]]; if (!ty) untyped++; else byType[ty] = (byType[ty] ?? 0) + 1; const f = L.data[k + 4]; if (f & 1) estimated++; if (f & 2) landmarks++; }
  }
  report('buildings', 'every building a type', n > 0 && untyped === 0, `${n} buildings: ${untyped} with no type; ${estimated} (${n ? (estimated / n * 100).toFixed(0) : 0}%) estimated (marked so); ${landmarks} landmarks; ${Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(', ')}`, { n, untyped, estimated, byType });
}

if (want('side')) sideTest();
if (want('lanes')) lanesTest();
if (want('floating')) floatingTest();
if (want('clearance')) clearanceTest();
if (want('roundabouts')) roundaboutsTest();
if (want('buildings')) buildingsTest();
if (want('tunnels')) await tunnelsTest();
const failed = rows.filter(r => !r.pass);
console.log(`\n${rows.length - failed.length} of ${rows.length} passed${skipped.length ? `, ${skipped.length} skipped (nothing of theirs in this bake)` : ''}`);
if (opt('--json')) fs.writeFileSync(opt('--json')!, JSON.stringify(rows, null, 1));
process.exit(failed.length ? 1 : 0);
