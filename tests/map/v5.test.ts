// Map v5's own tests (MAP_README.md, MAP_V5_REPORT.md; Step 11 of the Map v5 brief), each on a Map v5 bake
// (assets/map/<region>/v5/, or --dir), decoded and collided with as the game does (tests/map/harness.ts). Every limit
// is data/map/v5.json's `tests`. Map v4's tests run on the same bake (npm run test:map4 -- --dir assets/map/adelaide/v5),
// those Map v5 replaces as said in MAP_V5_REPORT.md.
//
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
  if (!runs.length) { report('tunnels', 'tunnels in this bake', false, `no one-way tunnel of ${X.tunnelMinLength} m or more here (the Heysen Tunnels: --dir assets/map/adelaide/v5-heysen)`); return; }
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

if (want('tunnels')) await tunnelsTest();
const failed = rows.filter(r => !r.pass);
console.log(`\n${rows.length - failed.length} of ${rows.length} passed`);
if (opt('--json')) fs.writeFileSync(opt('--json')!, JSON.stringify(rows, null, 1));
process.exit(failed.length ? 1 : 0);
