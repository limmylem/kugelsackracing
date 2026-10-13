// Map v4: a baked region's drawn road surface round a place, top down, coloured by height (blue low … red high) with
// its triangles' edges — for looking at steps and holes the tests find.
//
//   node map/debug/tileHeights.ts --region adelaide --at x,z --size 40 [--out output/heights.png] [--range 1]

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MeshoptDecoder } from 'meshoptimizer';
import { decodeTile } from '../format/tileFormat.ts';
import { plot } from './plot.ts';

const args = process.argv.slice(2), opt = (n: string, d: string | null = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'), dir = path.join(ROOT, 'assets/map', opt('--region', 'adelaide')!, opt('--map', 'v4') === 'v4' ? 'v4' : '');
const [cx, cz] = opt('--at')!.split(',').map(Number), size = +opt('--size', '40')!, T = 512;
await MeshoptDecoder.ready;
const tris: number[][][] = [];
for (let i = Math.floor((cx - size) / T); i <= Math.floor((cx + size) / T); i++) for (let j = Math.floor((cz - size) / T); j <= Math.floor((cz + size) / T); j++) {
  const f = path.join(dir, 'tiles', `${i}_${j}.m3t`);
  if (!fs.existsSync(f)) continue;
  const t: any = await decodeTile(zlib.gunzipSync(fs.readFileSync(f)), MeshoptDecoder), R = t.meshes.roads;
  if (!R) continue;
  const ox = (i + 0.5) * T, oz = (j + 0.5) * T, P = R.positions, I = R.indices;
  for (let k = 0; k < I.length; k += 3) {
    const v = [I[k], I[k + 1], I[k + 2]].map(q => [P[q * 3] + ox, P[q * 3 + 1], P[q * 3 + 2] + oz]);
    if (v.every(p => Math.abs(p[0] - cx) > size || Math.abs(p[2] - cz) > size)) continue;
    tris.push(v);
  }
}
const ys = tris.flatMap(t => t.map(p => p[1])).sort((a, b) => a - b), mid = opt('--mid') ? +opt('--mid')! : ys[Math.floor(ys.length / 2)], range = +opt('--range', '1')!;
const pl = plot(cx - size / 2, cz - size / 2, size, 900);
pl.fill([30, 30, 30]);
const col = (y: number) => { const t = Math.max(0, Math.min(1, (y - mid) / range / 2 + 0.5)); return [Math.round(255 * t), Math.round(255 * (1 - Math.abs(t - 0.5) * 2)), Math.round(255 * (1 - t))]; };
for (const t of tris) pl.tri(t[0][0], t[0][2], t[1][0], t[1][2], t[2][0], t[2][2], col((t[0][1] + t[1][1] + t[2][1]) / 3));
for (const t of tris) for (let q = 0; q < 3; q++) pl.line(t[q][0], t[q][2], t[(q + 1) % 3][0], t[(q + 1) % 3][2], [0, 0, 0]);
pl.dot(cx, cz, [255, 255, 255], 3);
const out = opt('--out', path.join(ROOT, 'output/heights.png'))!;
fs.mkdirSync(path.dirname(out), { recursive: true }); pl.save(out);
console.log(`wrote ${out}: heights ${(mid - range).toFixed(2)} (blue) … ${(mid + range).toFixed(2)} (red), ${tris.length} triangles`);
