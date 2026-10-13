// Map v4: the road surface model for a small area, drawn top down to a PNG (2D, flat ground unless --dem) — for
// looking at junctions, clusters, widths and markings without a bake.
//
//   node map/debug/modelSlice.ts --region adelaide --at -34.9899,138.6104 --size 160 [--out output/model/x.png]

import fs from 'node:fs';
import path from 'node:path';
import { readOsm } from '../bake/osmData.ts';
import { transverseMercator } from '../format/projection.ts';
import { buildRoadModel } from '../model/index.ts';
import { plot } from './plot.ts';

const args = process.argv.slice(2), opt = (n: string, d: string | null = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const region = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/map/regions', `${opt('--region', 'adelaide')}.json`), 'utf8'));
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/map/v4.json'), 'utf8')), v3 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/map/bake.json'), 'utf8'));
const [w, s, e, n] = region.bbox, P = transverseMercator(+((s + n) / 2).toFixed(6), +((w + e) / 2).toFixed(6));
const [la, lo] = opt('--at', '-34.9899,138.6104')!.split(',').map(Number), size = +opt('--size', '160')!, [cx, cz] = P.toXZ(la, lo);
let osm: any;
const cache = path.join(ROOT, '.cache/map', region.id, 'osm-read.json');
console.time('osm');
osm = readOsm(path.join(ROOT, '.cache/map', region.id, `${region.id}.osm.pbf`), P);
console.timeEnd('osm');
// (the roads with any point within 400 m of the window)
const R = size / 2 + 400, near = (p: any) => Math.abs(p.x - cx) < R && Math.abs(p.z - cz) < R;
const roads = osm.roads.filter((r: any) => r.nodes.some(near)), points = osm.points.filter(near);
void cache;
const M = buildRoadModel({ roads, points, demAt: () => 0, cfg, v3roads: v3.roads, tileSize: region.tileSize, P, log: console.log });
const pl = plot(cx - size / 2, cz - size / 2, size, 1000);
pl.fill([150, 175, 120]);
const Pm = M.surface.mesh.positions, I = M.surface.mesh.indices;
for (let t = 0; t < I.length; t += 3) {
  if (!M.surface.mesh.solid[t / 3]) continue;
  const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, sg = M.surface.mesh.seg[t / 3];
  const col = sg < 0 ? [70, 70, 95] : M.surface.mesh.surfaces[t / 3] === 3 ? [160, 158, 150] : [60, 62, 66];
  pl.tri(Pm[a], Pm[a + 2], Pm[b], Pm[b + 2], Pm[c], Pm[c + 2], col);
}
const Mk = M.surface.marks.positions, Ik = M.surface.marks.indices;
for (let t = 0; t < Ik.length; t += 3) { const a = Ik[t] * 3, b = Ik[t + 1] * 3, c = Ik[t + 2] * 3; pl.tri(Mk[a], Mk[a + 2], Mk[b], Mk[b + 2], Mk[c], Mk[c + 2], [235, 235, 230]); }
if (args.includes('--wire')) for (let t = 0; t < I.length; t += 3) { if (!M.surface.mesh.solid[t / 3]) continue; const v = [I[t], I[t + 1], I[t + 2]].map(q => [Pm[q * 3], Pm[q * 3 + 2]]); for (let q = 0; q < 3; q++) pl.line(v[q][0], v[q][1], v[(q + 1) % 3][0], v[(q + 1) % 3][1], [255, 220, 0]); }
for (const c of M.clusters) for (const poly of c.rings) for (const r of poly) for (let q = 0; q < r.length; q++) { const a = r[q], b = r[(q + 1) % r.length]; pl.line(a[0], a[1], b[0], b[1], [0, 220, 255]); }
for (const g of M.segs) for (let k = 0; k + 1 < g.xs.length; k++) pl.line(g.xs[k], g.zs[k], g.xs[k + 1], g.zs[k + 1], [255, 60, 200]);
for (const nd of M.nodes) pl.dot(nd.x, nd.z, nd.kind === 'junction' ? [255, 0, 0] : nd.kind === 'joint' ? [255, 255, 0] : [0, 0, 255], 2);
const out = opt('--out', path.join(ROOT, 'output/model', `slice-${la}_${lo}.png`))!;
fs.mkdirSync(path.dirname(out), { recursive: true });
pl.save(out);
console.log(`wrote ${path.relative(ROOT, out)}`);
console.log("patch holes", JSON.stringify(M.surface.stats.patchHoleAt), "fallbacks", (await import("../model/topology.ts")).triangulatePatch.fallbacks);
if (args.includes("--check")) {
  const { checkSurface } = await import('../model/checks.ts');
  const r = size / 2, c = checkSurface(M.surface.mesh, { segs: M.segs, region: [cx - r, cz - r, cx + r, cz + r] });
  console.log(`check (the window): ${c.triangles} triangles, ${c.boundaryEdges} boundary edges, cracks ${c.crackCount}, overlaps ${c.overlapCount} of ${c.sampled}, folds ${c.folds.length}`);
  console.log('  cracks', JSON.stringify(c.cracks.slice(0, 6)));
  console.log('  overlaps', JSON.stringify(c.overlaps.slice(0, 6)));
  console.log('  folds', JSON.stringify(c.folds.slice(0, 6)));
}
