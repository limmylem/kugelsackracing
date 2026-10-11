// Before and after (Phase 8 Step 2; docs/PERFORMANCE.md's report): two benchmark runs (reports/performance/*.json,
// tools/bench.mjs) as a Markdown table — each scene's figures in the first, the second, and the change.
//
//   node tools/perf-report.mjs reports/performance/baseline.json reports/performance/after-high.json [--title "…"]

import fs from 'node:fs';

const [a, b] = process.argv.slice(2).filter(x => !x.startsWith('--')), args = process.argv.slice(2);
const title = args.includes('--title') ? args[args.indexOf('--title') + 1] : `${a} → ${b}`;
const A = JSON.parse(fs.readFileSync(a, 'utf8')), B = JSON.parse(fs.readFileSync(b, 'utf8'));
const M = [
  ['draw calls (picture + shadows)', r => r.draws ? r.draws.total.calls + r.draws.total.shadow : r.calls, 0],
  ['…of them for the shadows', r => r.draws?.total.shadow, 0],
  ['triangles (k)', r => r.triangles / 1000, 0],
  ['physics ms a frame', r => r.stages?.physics, 2], ['AI ms', r => r.stages?.ai, 2], ['game ms', r => r.stages?.game, 2], ['render (CPU) ms', r => r.stages?.render, 2],
  ['streaming ms', r => r.stages?.streaming, 2], ['network ms', r => r.stages?.network, 2], ['audio (main thread) ms', r => r.stages?.audio, 2], ['effects ms', r => r.stages?.effects, 2],
  ['physics per 60th of a second, ms', r => r.physicsStep?.per60thMs, 2],
  ['heap MB', r => r.memory?.heapMB, 0], ['meshes MB', r => r.memory?.meshMB, 0], ['textures MB', r => r.memory?.textureMB, 0],
  ['garbage MB/s', r => r.allocMBps, 1], ['GC stutters', r => r.stutters?.byCause?.['garbage collection'] ?? 0, 0], ['shader-compile stutters', r => r.stutters?.byCause?.['shader compile'] ?? 0, 0],
  ['audio thread', r => r.audio?.share != null ? r.audio.share * 100 : null, 1, '%'],
  ['frame (software rendering) ms', r => r.avgMs, 0], ['drivable in s', r => r.loadMs / 1000, 1],
];
const names = Object.keys({ ...A.scenes, ...B.scenes });
const out = [`#### ${title}`, '', `| | ${names.join(' | ')} |`, `|---|${names.map(() => '---').join('|')}|`];
for (const [label, f, d, u = ''] of M) {
  const cell = name => {
    const x = A.scenes[name], y = B.scenes[name], v0 = x ? f(x) : null, v1 = y ? f(y) : null, s = v => v == null || Number.isNaN(v) ? '—' : `${v.toFixed(d)}${u}`;
    if (v0 == null || v1 == null) return `${s(v0)} → ${s(v1)}`;
    const ch = v0 ? Math.round((v1 - v0) / v0 * 100) : 0;
    return `${s(v0)} → ${s(v1)}${v0 && Math.abs(ch) >= 5 ? ` (${ch > 0 ? '+' : ''}${ch}%)` : ''}`;
  };
  out.push(`| ${label} | ${names.map(cell).join(' | ')} |`);
}
console.log(out.join('\n'));
