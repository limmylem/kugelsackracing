// WebGPU or WebGL 2 (Phase 8 Step 2; docs/PERFORMANCE.md): dev/renderer-bench.html with each renderer — 300, 1,000 and
// 3,000 meshes, drawn one by one and instanced — the CPU's time to submit a frame and the frame time, printed as a table
// and written to reports/performance/renderers.json. On a machine with a graphics card it's the real comparison; without
// one (--swiftshader: Chromium's software Vulkan and GL) only the CPU's side means anything.
//
//   node tools/renderer-bench.mjs [--swiftshader] [--n 300,1000,3000]

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname, args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
let pw;
try { pw = await import('playwright-core'); } catch { try { pw = await import('playwright'); } catch { pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.mjs'); } }
const chromium = pw.chromium ?? pw.default?.chromium;
const exe = process.env.CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const server = spawn(process.execPath, [path.join(ROOT, 'tools/serve.mjs'), String(port)], { env: { ...process.env, HOST: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/data/performance.json`); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
const soft = args.includes('--swiftshader');
const flags = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', ...(soft ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader'] : ['--enable-features=Vulkan'])];
const browser = await chromium.launch({ executablePath: exe, args: flags });
const nm = path.join(ROOT, 'node_modules'), rows = [];
try {
  for (const n of opt('--n', '300,1000,3000').split(',').map(Number)) for (const mode of ['meshes', 'instanced']) for (const renderer of ['webgl', 'webgpu']) {
    const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
    await ctx.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', r => r.fulfill({ path: `${nm}/three/${new URL(r.request().url()).pathname.replace('/npm/three@0.160.0/', '')}`, contentType: 'text/javascript' }));
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e.message ?? e).slice(0, 160)));
    await page.goto(`http://127.0.0.1:${port}/dev/renderer-bench.html?renderer=${renderer}&n=${n}&mode=${mode}&seconds=4`);
    const r = await page.waitForFunction(() => window.__result, null, { timeout: 120000 }).then(h => h.jsonValue(), () => ({ renderer, n, mode, supported: false, why: errors[0] ?? 'timed out' }));
    rows.push({ ...r, errors: errors.slice(0, 2) });
    console.log(`${renderer.padEnd(6)} ${mode.padEnd(9)} ${String(n).padStart(5)} meshes: ${r.supported ? `${r.backend}: CPU ${r.cpuMs} ms a frame (95%: ${r.cpuP95Ms}), frame ${r.frameMs} ms, ${r.frames} frames` : `not available (${r.why ?? 'no adapter'})`}${errors.length ? ` · ${errors[0]}` : ''}`);
    await ctx.close();
  }
} finally { await browser.close(); server.kill(); }
fs.mkdirSync(path.join(ROOT, 'reports/performance'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'reports/performance/renderers.json'), JSON.stringify({ at: new Date().toISOString(), software: soft, flags, rows }, null, 1));
